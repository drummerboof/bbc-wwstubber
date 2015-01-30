/* globals require */

var express = require('express'),
    request = require('request'),
    path = require('path'),
    url = require('url'),
    fs = require('fs'),
    _ = require('lodash'),
    md5 = require('MD5'),
    rimraf = require('rimraf'),
    mkdirp = require('mkdirp'),
    mime = require('mime-types'),
    config = require('./config.json'),
    backends = require('./backends');

var app = express(),
    root = __dirname,
    certFile = path.join(root, config.clientCert),
    keyFile = path.join(root, config.clientKey);

var currentJourney = {
    recording: false,
    playing: false,
    backend: null,
    journey: null,
    content: null,
    fileHandle: null
};

mime.extensions['text/xml'] = ['xml'];

function journeyFile (backend, journey) {
    return path.join(root, 'journies', backend, journey, 'journey.json');
}

function startRecording (backend, journeyName) {
    var journey = {
        backend: backend,
        journey: journeyName,
        recording: true,
        playing: false,
        content: {}
    };

    journey.fileHandle = fs.openSync(journeyFile(backend, journeyName), 'w+');
    fs.writeSync(journey.fileHandle, JSON.stringify(journey.content, null, 4), 0);

    return journey;
}

function startPlaying (backend, journeyName) {
    var journey = {
        backend: backend,
        journey: journeyName,
        recording: false,
        playing: true
    };

    if (journey.fileHandle) {
        fs.closeSync(journey.fileHandle);
    }

    journey.fileHandle = null;
    journey.content = JSON.parse(fs.readFileSync(journeyFile(backend, journeyName), { encoding: 'utf8' }));

    return journey;
}

function record (journey, req, res) {
    var backend = backends.getBackend(journey.backend),
        forwardUrl = url.resolve(backend.getUrl(), req.url.substr(1)),
        useCert = forwardUrl.indexOf('https') === 0 && config.clientCert && config.clientKey,
        options = {
            method: req.method,
            proxy: config.proxy,
            url: forwardUrl
        };

    if (req.method !== 'GET') {
        options.body = req.rawBody;
    }

    if (useCert) {
        _.extend(options, {
            cert: fs.readFileSync(certFile),
            key: fs.readFileSync(keyFile)
        });
    }

    request(options, function callback(error, response, body) {
        var itemPath = path.join('journies', journey.backend, journey.journey),
            regexUrl = backend.parseUrl(_.escapeRegExp(req.url)),
            extension = 'rec';

        if (error) {
            error(res, 500, error.message);
            return;
        }

        if (!_.has(journey.content, regexUrl)) {
            journey.content[regexUrl] = [];
        }

        if (_.has(response.headers, 'content-type')) {
            extension = mime.extension(response.headers['content-type']) || extension;
        }

        itemPath = path.join(itemPath, journey.content[regexUrl].length + '-' + md5(regexUrl).substring(0, 8) + '.' + extension);

        journey.content[regexUrl].push({
            method: req.method,
            statusCode: response.statusCode,
            headers: response.headers,
            file: itemPath
        });

        fs.writeFileSync(itemPath, backend.parseBody(body));
        fs.writeSync(journey.fileHandle, JSON.stringify(journey.content, null, 4), 0);

        res.status(response.statusCode);
        res.set(response.headers);
        res.send(backend.parseBody(body));
    });
}

function play (journey, req, res) {
    var matchedCall;

    _.each(journey.content, function (calls, urlRegex) {
        if ((new RegExp(urlRegex)).test(req.url)) {
            _.each(calls, function (call) {
                if (!call.played && req.method === call.method) {
                    matchedCall = call;
                    return false;
                }
            })
        }
        if (!_.isUndefined(matchedCall)) {
            return false;
        }
    });

    if (_.isUndefined(matchedCall)) {
        error(res, 500, 'cannot find url ' + req.url + ' in journey ' + journey.journey);
        return;
    }

    matchedCall.played = true;

    res.status(matchedCall.statusCode);
    res.set(matchedCall.headers);
    res.send(fs.readFileSync(matchedCall.file));
}

function error (res, code, message) {
    res.status(code).send(JSON.stringify({ error: message }, null, 4));
}

app.use(function(req, res, next) {
    req.rawBody = '';
    req.setEncoding('utf8');

    req.on('data', function(chunk) {
        req.rawBody += chunk;
    });

    req.on('end', function() {
        next();
    });
});

app.all('/*', function (req, res, next) {
    console.log('Request', JSON.stringify(_.pick(req, ['method', 'url', 'rawBody']), null, 4));
    res.type('json');
    next();
});

app.get('/favicon.ico', function (req, res) {
    res.status(200).end();
});

app.get('/record/:backend/:journey', function (req, res, next) {
    if (config.backends.indexOf(req.params.backend) < 0) {
        error(res, 500, 'unknown backend: ' + req.params.backend);
        return;
    }
    console.log(path.dirname(journeyFile(req.params.backend, req.params.journey)));
    if (fs.existsSync(path.dirname(journeyFile(req.params.backend, req.params.journey)))) {
        error(res, 500, 'Journey with name ' + req.params.journey + ' already exists. Delete it first.');
        return;
    }
    currentJourney = startRecording(req.params.backend, req.params.journey);
    res.send(JSON.stringify(currentJourney, null, 4));
});

app.get('/load/:backend/:journey', function (req, res, next) {
    if (config.backends.indexOf(req.params.backend) < 0) {
        error(res, 500, 'unknown backend: ' + req.params.backend);
        return;
    }
    currentJourney = startPlaying(req.params.backend, req.params.journey);
    res.send(JSON.stringify(currentJourney, null, 4));
});

app.get('/status', function (req, res) {
    res.type('json').send(JSON.stringify(currentJourney, null, 4));
});

app.all('/*', function (req, res, next) {
    if (currentJourney.recording) {
        record(currentJourney, req, res)
    } else if (currentJourney.playing) {
        play(currentJourney, req, res);
    } else {
        error(res, 404, 'not found');
    }
});

var server = app.listen(config.port || 3000, function () {
    var host = server.address().address,
        port = server.address().port;
    console.log('WW Stubber listening at http://%s:%s', host, port)
});