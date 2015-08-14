# bbc-wwstubber

Stub recording and playback server.
* Allows recording "journeys" which can then be played back
* Controllable via a simple JSON web API
* Supports talking to backends via a proxy server
* Supports Client SSL authentication for backends

## Installing 

Clone the repo and install node modules:

`npm install`

## Example

You can see an example usage of the server in `example.js`

## Creating a server

Simplest way to start up a stub server

```js
var server = new Stubber({
    journeyPath: 'journeys'
});
```

## Default Options

```js
{
  readOnly: false, // Run the server in read only mode, recording won't be allowed
  root: process.cwd(), // The root path from which directory manipulation will take place
  journeyPath: null, // Directory in which to save recorded journeys
  port: 3000,
  clientCert: false,
  clientKey: false,
  proxy: false
}
```

## Backends
Backends must be registered with the server. When the server receives a request, it will try to lookup which 
backend to forward the request onto. A backend is registered as an object which extends the following prototype:
```js
{
  /**
   * Return the root URL of the backend
   */
  getUrl: function () {
    throw new Error('Backends must implement a getUrl method');
  },
  
  /**
   * How to determine whether to use this backend for a given request. 
   * Defaults to returning true but if you register more than one backend 
   * you should use some logic here otherwise only the first registered one will be used.
   *
   * @param string url The requested URL
   * @return boolean
   */
  match: function (url) {
    return true;
  },
  
  /**
   * Manipulate the URL which is saved in the journey file
   * 
   * @param string url The requested URL
   * @return string The manipulated URL
   */
  parseUrl: function (url) {
    return url;
  },
  
  /**
   * Manipulate the response body for each request.
   *
   * @param string body The response body from the upstream request
   * @return string The manipulated body
   */
  parseBody: function (body) {
    return body;
  }
}
```

### Adding a simple backend
Adding the following backend to the server alone will mean all requests are forwarded to http://jsonplaceholder.typicode.com/

```js
server.registerBackend('jsonplaceholder', {
  getUrl: function () {
    return 'http://jsonplaceholder.typicode.com/';
  }
});
```

## Web API

### Record a journey
```
http://localhost:3000/record/test
```
To start recording a new journey called test. The test directory will be created in whichever directory was configured when
creating the stub server. If the test directory already exists, an error will be returned.

### Check status of stub server
```
http://localhost:3000/stats
```
Return the status of the stub server and any currently recording or playing journey.

### Play journey
```
http://localhost:3000/play/test
```
Start playing back a recorded journey. Requests are served back sequentually by URL.
