/* globals require */
var Stubber = require('./index.js').Stubber;

var test = new Stubber({
    port: 8080,
    journeyPath: __dirname + '/journeys/',
    proxy: 'http://www-cache-wdl.reith.bbc.co.uk:80'
});

test.registerBackend('jsonplaceholder', {

    getUrl: function () {
        return 'http://jsonplaceholder.typicode.com/';
    }
});

test.start(function () {
    console.log('listening...');
});