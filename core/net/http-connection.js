/**
 * @author Phuluong
 * December 27, 2015
 */

/** Exports **/
module.exports = new HttpConnection();
/** Imports **/
var event = require(__dir + "/core/app/event");
var UrlPattern = require("url-pattern");
/** Classes **/
function HttpConnection() {
    this.methods = ["get", "post", "put", "delete", "options"];
    this.requestCallbacks = [];
    this.assetAPI = null;
    this.init = function () {
        this.initRequestCallbacks();
    }
    this.listen = function (httpServer) {
        httpServer.addConnectionListener(this);
    };
    this.onConnection = function (req, res) {
        // Fire event
        event.fire("connection.http.request", req);
        // Pass to listeners
        var self = this;
        var url = req.url;
        var body = "";
        var contentType = req.headers["content-type"];
        req.on("data", function (data) {
            body += data;
            // Too much POST data, close the connection!
            if (body.length > 512000000) {
                console.log("body.length > 500MB", body.length);
                req.connection.destroy();
            }
        });
        req.on("end", function () {
            var callback = getCallback.bind(self)(req.method, url);
            if (callback.fn != null) {
                req.inputs = callback.urlInputs;
                var inputs = getInputs(body == "" ? null : body, url, req.method, contentType);
                if (typeof inputs === "object") {
                    for (var property in inputs) {
                        req.inputs[property] = inputs[property];
                    }
                }
                req.baseUrl = getBaseUrl(url);
                callback.fn(req, res);
            } else {
                res.writeHead(404, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    status: 404,
                    result: "page not found"
                }));
            }
        });
    };
    this.initRequestCallbacks = function () {
        var self = this;
        for (var i = 0; i < self.methods.length; i++) {
            var method = self.methods[i];
            self[method] = function (method) {
                return function (url, callback) {
                    self.addRequestCallback(method, url, callback);
                };
            }(method);
        }
    };
    this.asset = function (callback) {
        this.assetAPI = callback;
    };
    /** Utils **/
    this.addRequestCallback = function (method, url, callbackFn) {
        method = method.toUpperCase();
        var methodCallbacks = null;
        if (this.requestCallbacks[method] == null) {
            methodCallbacks = [];
        } else {
            methodCallbacks = this.requestCallbacks[method];
        }
        methodCallbacks[url] = callbackFn;
        this.requestCallbacks[method] = methodCallbacks;
    }
    function getCallback(method, url) {
        var retval = {
            urlInputs: {},
            url: url,
            fn: null
        };
        method = method.toUpperCase();
        url = url.split("?")[0];
        if (method === "GET") {
            try {
                retval.fn = this.requestCallbacks[method][url];                
            } catch (error) {}
            // Match url with params
            if (retval.fn == null) {
                getCallbackWithRoutePattern(retval, url, this.requestCallbacks[method]);
            }
            // Match asset url
            if (retval.fn == null && retval.urlInputs.length === 0) {
                retval.fn = this.assetAPI;
            }
        } else {
            try {
                retval.fn = this.requestCallbacks[method][url];                
            } catch (error) {}
            // Match url with params
            if (retval.fn == null) {
                getCallbackWithRoutePattern(retval, url, this.requestCallbacks[method]);
            }
        }
        return retval;
    }
    function getCallbackWithRoutePattern(retval, url, methodCallbacks) {
        for (var route in methodCallbacks) {
            var pattern = new UrlPattern(route);
            var matching = pattern.match(url);
            if (matching != null) {
                retval.urlInputs = matching;
                retval.fn = methodCallbacks[route];
                break;
            }
        }
        return retval;
    }
    function getInputs(body, inputString, method, contentType) {
        var retval = {};
        if (inputString != null) {
            try {
                inputString = decodeURIComponent(inputString);
                inputString.replace(/[?&]+([^=&]+)=([^&]*)/gi,
                    function (m, key, value) {
                        retval[key] = value;
                    }
                );
            } catch (exc) { }
        }
        if (body != null) {
            if (contentType != null && contentType.indexOf("json") > 0) {
                retval = { ...retval, ...JSON.parse(body) };
            } else if (contentType != null && contentType.indexOf("form-data") > 0) {
                retval["form-data"] = Buffer.from(body).toString('base64');;
            } else {
                retval["data-raw"] = body;
            }
        }
        return retval;
    }
    function getBaseUrl(url) {
        return url.split("?")[0];
    }
    this.init();
}
