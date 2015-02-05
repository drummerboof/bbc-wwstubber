/* globals require, module, process */

var express = require('express'),
    request = require('request'),
    path = require('path'),
    zlib = require('zlib'),
    url = require('url'),
    qfs = require('q-io/fs'),
    fs = require('fs'),
    _ = require('lodash'),
    Q = require('q'),
    md5 = require('MD5'),
    mime = require('mime-types');

mime.extensions['text/xml'] = ['xml'];

var JOURNEY = {
    recording: false,
    playing: false,
    backend: null,
    name: null,
    content: null
};

var DEFAULTS = {
    readOnly: false,
    root: process.cwd(),
    journeyPath: null,
    port: 3000,
    clientCert: false,
    clientKey: false,
    proxy: false
};

var BACKEND = {
    getUrl: function () {
        throw new Error('Backends must implement a getUrl method');
    },
    match: function () {
        return true;
    },
    parseUrl: function (url) {
        return url;
    },
    parseBody: function (body) {
        return body;
    }
};

var Stubber = function Stubber(options, app) {
    this.certificate = null;
    this.key = null;
    this.backends = {};
    this.currentJourney = _.extend({}, JOURNEY);
    this.options = _.extend({}, DEFAULTS, options || {});
    this.app = app || express();
    this._initRoutes();
};

Stubber.prototype.registerBackend = function (name, config) {
    this.backends[name] = _.extend({}, BACKEND, config);
    this.backends[name].name = name;
};

Stubber.prototype.getBackend = function (name) {
    return this.backends[name];
};

Stubber.prototype.matchBackend = function (url) {
    return _.find(_.values(this.backends), function (backend) {
        return backend.match(url);
    });
};

Stubber.prototype.start = function (callback) {
    var self = this;
    Q.allSettled([qfs.read(this.options.clientCert), qfs.read(self.options.clientKey)]).spread(function (cert, key) {
        self.certificate = cert.value || null;
        self.key = key.value || null;
        self.server = self.app.listen(self.options.port, function () {
            callback.apply(self, self);
        });
    });
};

Stubber.prototype.startRecording = function (journeyName, backend) {
    var self = this,
        deferred = Q.defer(),
        pathName = path.join(this.options.root, this.options.journeyPath, journeyName);

    qfs.makeDirectory(pathName).then(function () {
        self.currentJourney = {
            backend: backend,
            name: journeyName,
            recording: true,
            playing: false,
            content: {}
        };
        deferred.resolve(self.currentJourney);
    }).catch(deferred.reject);

    return deferred.promise;
};

Stubber.prototype.startPlaying = function (journeyName) {
    var self = this,
        deferred = Q.defer();

    qfs.read(this._getJourneyFilePath(journeyName)).then(function (content) {
        self.currentJourney = {
            name: journeyName,
            recording: false,
            playing: true,
            content: JSON.parse(content)
        };
        deferred.resolve(self.currentJourney);
    }).fail(deferred.reject);

    return deferred.promise;
};

Stubber.prototype._record = function (req, res) {
    var self = this,
        journey = this.currentJourney,
        backend = journey.backend ? this.getBackend(journey.backend) : this.matchBackend(req.url);

    if (_.isUndefined(backend)) {
        this._error(req, res, new Error('No backend found to match your request'));
        return;
    }

    var forwardUrl = url.resolve(backend.getUrl(), req.url.substr(1)),
        options = {
            headers: req.headers,
            method: req.method,
            proxy: this.options.proxy,
            url: forwardUrl,
            encoding: null
        };

    if (req.method !== 'GET') {
        options.body = req.rawBody;
    }

    if (forwardUrl.indexOf('https') === 0 && this.certificate && this.key) {
        _.extend(options, {
            cert: this.certificate,
            key: this.key
        });
    }

    var saveResponse = function (response) {
        var itemPath = path.join(self.options.root, self.options.journeyPath, journey.name, backend.name),
            regexUrl = backend.parseUrl('^' + _.escapeRegExp(req.url) + '$'),
            extension = 'rec';

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
            file: itemPath.replace(self.options.root, '').substr(1)
        });

        var fail = function (err) {
            self._error(req, res, err);
        };

        qfs.makeTree(path.dirname(itemPath))
            .then(function () {
                return qfs.write(itemPath, backend.parseBody(response.processedBody))
            }, fail)
            .then(function () {
                return qfs.write(self._getJourneyFilePath(journey.name), JSON.stringify(journey.content, null, 4));
            }, fail)
            .then(function () {
                return res.status(response.statusCode).set(response.headers).send(backend.parseBody(response.processedBody));
            }, fail);
    };

    request(options, function callback(err, response, body) {
        if (err) {
            self._error(req, res, err);
            return;
        }

        if (response.headers['content-encoding'] && response.headers['content-encoding'].indexOf('gzip') >= 0) {
            delete response.headers['content-encoding'];
            zlib.gunzip(body, function (gzerr, unzipped) {
                response.processedBody = unzipped.toString('utf-8');
                saveResponse(response);
            });
        } else {
            response.processedBody = body.toString('utf-8');
            saveResponse(response);
        }
    });
};

Stubber.prototype._play = function (req, res) {
    var matchedCall;

    _.each(this.currentJourney.content, function (calls, urlRegex) {
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

    console.log(matchedCall);

    if (_.isUndefined(matchedCall)) {
        this._error(req, res, new Error('cannot find url ' + req.url + ' in journey ' + this.currentJourney.name));
        return;
    }

    matchedCall.played = true;

    qfs.read(path.join(this.options.root, matchedCall.file)).then(function (content) {
        res.status(matchedCall.statusCode).set(matchedCall.headers).send(content);
    });
};

Stubber.prototype._getJourneyFilePath = function (name) {
    return path.join(this.options.journeyPath, name, 'journey.json');
};

Stubber.prototype._initRoutes = function () {
    var self = this;

    this.app.use(function(req, res, next) {
        req.rawBody = '';
        req.setEncoding('utf8');
        req.on('data', function(chunk) {
            req.rawBody += chunk;
        });
        req.on('end', function() {
            next();
        });
    });

    this.app.all('/*', function (req, res, next) {
        console.log('Request', JSON.stringify(_.pick(req, ['method', 'url', 'rawBody'])));
        next();
    });

    this.app.get('/favicon.ico', function (req, res) {
        res.status(200).end();
    });

    if (!this.options.readOnly) {
        this.app.get('/record/:journey/:backend?', function (req, res) {
            self.startRecording(req.params.journey, req.params.backend).then(function () {
                res.json(self.currentJourney);
            }, function (err) {
                self._error(req, res, err);
            });
        });
    }

    this.app.get('/play/:journey', function (req, res, next) {
        self.startPlaying(req.params.journey, req.params.backend).then(function () {
            res.json(self.currentJourney);
        }, function (err) {
            self._error(req, res, err);
        });
    });

    this.app.get('/status', function (req, res) {
        res.json(self.currentJourney);
    });

    this.app.all('/*', function (req, res, next) {
        if (self.currentJourney.recording && !self.options.readOnly) {
            self._record(req, res)
        } else if (self.currentJourney.playing) {
            self._play(req, res);
        } else {
            self._error(req, res, new Error('not found'), 404);
        }
    });
};

Stubber.prototype._error = function (req, res, err, status) {
    status = status || 500;
    res.status(status).type('json').send(JSON.stringify(err, ['message', 'type', 'name']));
};

module.exports.Stubber = Stubber;