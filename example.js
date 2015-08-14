/* globals require */
var Stubber = require('./index.js').Stubber;

var test = new Stubber({
    port: 8080,
    journeyPath: 'journeys'
});

test.registerBackend('jsonplaceholder', {

    getUrl: function () {
        return 'http://jsonplaceholder.typicode.com/';
    }
});

test.start(function () {
    console.log('listening...');
});
