/* globals module */

var _ = require('lodash');

module.exports = {

    getBackend: function (name) {
        var backend = this.base;
        try { backend = _.extend({}, backend, require('./' + name + '.js')); } catch (e) {}
        return backend;
    },

    base: {

        /**
         * Get the URL for the backend.
         * Every backend must implement this method.
         */
        getUrl: function () {
            throw new Error('No URL defined');
        },

        /**
         * Called when a recording is saving a particular call allowing the URL
         * which was requested to be modified
         *
         * @param url string The regex-escaped url string
         * @returns string The modified url
         */
        parseUrl: function (url) {
            return url;
        },

        /**
         * Called when a recording is saving a particular call and allows
         * the raw response body content to be modified. This modified body
         * is saved to file and returned to the calling client.
         *
         * @param rawBody string The response body content
         * @returns string The modified body
         */
        parseBody: function (rawBody) {
            return rawBody;
        }
    }
};