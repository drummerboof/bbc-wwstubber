/* globals module */

module.exports = {

    getUrl: function () {
        return 'https://api.test.bbc.co.uk';
    },

    parseUrl: function (url) {
        return url.replace(/\/[0-9]{12}/, '/([0-9]{12})');
    },

    parseBody: function (body) {
        return body;
    }
}