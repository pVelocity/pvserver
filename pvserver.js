"use strict";

/*globals Buffer: true, require: true, module: true */

var prom = require('bluebird');
var qs = require('querystring');
var formData = require('form-data');

//====== Private Functions ====================================================================

var jsonToXML = function(json) {

    var resArray = [];

    var emitArrayOfObjects = function(json, res) {

        var printValue = function(v) {
            var result = null;
            if (typeof(v) === "function") {
                result = "<![CDATA[";
                result = result + v.toString();
                result = result + "]]>";
            } else {
                result = v;
                if (typeof(v) !== "string") {
                    result = v.toString();
                }
                result = result.replace(/[&]/g, "&amp;");
                result = result.replace(/[<]/g, "&lt;");
                result = result.replace(/[>]/g, "&gt;");
                result = result.replace(/[%]/g, "&#37;");
            }
            return result;
        };

        var emitSimple = function(elemName, value, res) {
            if (value) {
                res.push(`<${elemName}>`);
                res.push(printValue(value));
                res.push(`</${elemName}>`);
            } else {
                res.push(`<${elemName}/>`);
            }
        };

        var emitElement = function(elemName, subElemList, res) {
            if (Array.isArray(subElemList)) {
                subElemList.forEach(function(subElem) {
                    emitElement(elemName, subElem, res);
                });
            } else if (typeof subElemList === 'object' && subElemList !== null) {
                var attrs = [];
                var textValue = "";
                if (subElemList._attrs) {
                    for (var attrName in subElemList._attrs) {
                        if (subElemList._attrs.hasOwnProperty(attrName)) {
                            attrs.push(`${attrName}='${subElemList._attrs[attrName]}'`);
                        }
                    }
                }
                if (subElemList._text) {
                    textValue = subElemList._text;
                }
                var attrString = attrs.length > 0 ? attrs.join(" ") : "";
                res.push(attrs.length > 0 ? `<${elemName} ${attrString}>` : `<${elemName}>`);
                emitArrayOfObjects(subElemList, res);
                res.push(textValue);
                res.push(`</${elemName}>`);

            } else {
                emitSimple(elemName, subElemList, res);
            }
        };

        for (var key in json) {
            if (json.hasOwnProperty(key) && key !== '_attrs' && key !== '_text') {
                emitElement(key, json[key], res);
            }
        }
    };

    emitArrayOfObjects(json, resArray);
    return resArray.join("");
};

//Get the header for an RPM API XML request as an array with optional sessionId inclusion.
var getXmlReqHeader = function() {
    var reqHeader = ['<?xml version="1.0" encoding="utf-8"?>',
        '<PVRequest xmlns:xsd="http://www.w3.org/2001/XMLSchema" ',
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ',
        'xmlns="http://pvelocity.com/rpm/pvrequest" '
    ];
    if (this.sessionId) {
        reqHeader.push('sessionId="', this.sessionId, '"');
    }
    reqHeader.push('>');

    return reqHeader;
};

// Create an XML request string for the RPM API, note that the parameters are in XML.
var buildXmlReqStr = function(operation, parameters) {
    var req;

    req = getXmlReqHeader.call(this);
    req.push('<Operation><Name>', operation, '</Name>', '<Params>');
    if (parameters) {
        // don't send raw '&', but don't change '&amp;', '&lt;', etc.
        req.push(
            parameters.replace(/&/g, "&amp;")
            .replace(/&amp;(amp|lt|gt|quot);/g, "&$1;")
        );
    }
    req.push('</Params></Operation></PVRequest>');

    return req.join('');
};

var setHostURL = function(urlString) {
    var refUrl = urlString;
    if (typeof urlString === "string") {
        var url = require('url');
        refUrl = url.parse(urlString);
    }

    var server = this;

    server.hostName = refUrl.hostname || server.hostName;
    server.urlPath = (refUrl.pathname || server.urlPath) + "/RPM";
    server.urlPath = server.urlPath.replace("//", "/");
    server.urlScheme = refUrl.protocol || server.urlScheme;
    server.urlScheme = server.urlScheme.replace(":", "");

    server.http = null;
    if (server.urlScheme === 'https') {
        server.http = require('https');
        server.hostPort = 443;
    } else {
        server.http = require('http');
        server.hostPort = 80;
    }
    server.hostPort = refUrl.port || server.hostPort;
};

var genHeaders = function(post_data) {
    var headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(post_data),
        'Connection': 'Keep-Alive',
        'X-PVClient-Version': this.version,
        "X-PVClient-Platform": this.device
    };

    if (this.cookie) {
        headers.Cookie = this.cookie[0];
    }

    return headers;
};

var genRequestOptions = function(headers) {
    return {
        host: this.hostName,
        port: this.hostPort,
        path: this.urlPath,
        method: 'POST',
        headers: headers
    };
};

var stripTextNode = function(json) {

    if (typeof(json) === "object") {
        if (Object.keys(json).length == 1 && json.hasOwnProperty("text")) {
            return json.text;
        }

        for (var key in json) {
            if (json.hasOwnProperty(key)) {
                json[key] = stripTextNode(json[key]);
            }
        }
    }

    return json;
};

var processResponse = function(res) {
    var server = this.server;
    var completionCallback = this.completionCallback;
    var operation = this.operation;
    var data = "";
    var code = null;

    res.setEncoding('utf8');

    res.on('data', function(chunk) {
        data += chunk;
    });

    res.on('end', function() {
        var json = null;
        try {
            json = JSON.parse(data);
            json = stripTextNode(json);
        } catch (err) {
            json = data;
        }
        var status = (json && json.PVResponse) ? json.PVResponse.PVStatus : null;
        code = (status && status.Code) ? status.Code : null;
        if (server.isOkay(code)) {
            server.sessionId = status.SessionId;
            if (operation === 'Login' && res.headers['set-cookie']) {
                server.cookie = res.headers['set-cookie'];
            }
            code = null;
        } else {
            code = new PVServerError(code, status, json);
        }
        completionCallback.call(server, code, json);
    });
    res.on('error', function(err) {
        completionCallback.call(server, err, null);
    });
};

function PVServerAPI(urlString) {

    this.user = null;
    this.role = null;

    if (!urlString) {
        urlString = "http://localhost";
    }

    this.configPath = "/PE/DKC/";

    this.device = "node";
    this.sessionId = null;
    this.cookie = null;
    this.version = "3.4";
    this.privileges = {};
    this.timeOut = 30 * 60;

    this.UomMap = {
        A: "Sq.Ft.",
        C: "$",
        L: "Ft",
        T: "Hr",
        W: "lb"
    };

    setHostURL.call(this, urlString);
}

function PVServerError(code, status, json) {
    if (this) {
        this.code = code;
        this.status = status;
        this.json = json;
    }
    return true;
}

PVServerError.prototype.message = function() {
    return (this.status && this.status.Message && this.status.Message) ? this.status.Message : 'No relevant message';
};

/**
 * Given a JSON response object, determine if the result status is okay or not
 *
 * @param {Object}
 *            The response object
 * @return {boolean}
 *            true if it is okay, false otherwise
 */
PVServerAPI.prototype.isOkay = function(code) {
    return (code === "RPM_PE_STATUS_OK");
};

/**
 * This is a convenience function that will send an async RPM API request to the
 * server.
 *
 * @param {String}
 *            operation The name of the operation
 * @param {String}
 *            parameters An XML string containing the contents of the parameters
 * @param {Function}
              The call back function to execute when the async request completes (err, result)
 */
PVServerAPI.prototype.sendRequestAsync = function(operation, parameters, completionCallback) {

    var server = this;

    if (typeof parameters === 'object') {
        parameters = jsonToXML(parameters);
    }

    var requestStr = buildXmlReqStr.call(server, operation, parameters);

    var post_data = qs.stringify({
        "dataformat": "json",
        "request": requestStr
    });

    var headers = genHeaders.call(server, post_data);
    var reqOptions = genRequestOptions.call(server, headers);

    var post = server.http.request(reqOptions, processResponse.bind({
        "server": server,
        "operation": operation,
        "completionCallback": completionCallback
    }));

    post.on('error', function(err) {
        completionCallback.call(server, err, null);
    });

    post.write(post_data);
    post.end();
};
PVServerAPI.prototype.sendRequest = prom.promisify(PVServerAPI.prototype.sendRequestAsync);

PVServerAPI.prototype.sendFormRequestAsync = function(operation, parameters, completionCallback) {
    var server = this;

    var form = new formData();
    form.append('SessionId', server.sessionId);
    form.append('Operation', operation);
    form.append('dataformat', 'json');

    for (var key in parameters) {
        if (parameters.hasOwnProperty(key)) {
            form.append(key, parameters[key]);
        }
    }

    var formOptions = {
        host: server.hostName,
        port: server.hostPort,
        path: server.urlPath
    };
    if (server.cookie) {
        formOptions.headers = {
            'Cookie': server.cookie[0]
        };
    }

    form.submit(formOptions, function(err, res) {
        if (err) {
            completionCallback.call(server, err, null);
        } else {
            processResponse.call({
                "server": server,
                "operation": operation,
                "completionCallback": completionCallback
            }, res);
        }
    });
};
PVServerAPI.prototype.sendFormRequest = prom.promisify(PVServerAPI.prototype.sendFormRequestAsync);

PVServerAPI.prototype.loginAsync = function(user, password, credKey, completionCallback) {

    var params = {};

    if (user) {
        params.User = user;
    }
    if (password) {
        params.Password = password;
    }
    if (credKey) {
        params.CredentialKey = credKey;
    }
    params.TimeOut = this.timeOut;
    params.DeviceName = this.device;

    var server = this;
    server.sendRequest("Login", params).then(function(json) {
        server.user = json.PVResponse.PVStatus.User;
        server.role = json.PVResponse.PVStatus.UserGroup;
        completionCallback.call(this, null, json);
    }).catch(function(err) {
        completionCallback.call(this, err, null);
    });
};
PVServerAPI.prototype.login = prom.promisify(PVServerAPI.prototype.loginAsync);

PVServerAPI.prototype.logout = function(completionCallback) {

    this.sendRequestAsync("Logout", null, function(err, json) {
        this.user = null;
        this.role = null;
        this.cookie = null;
        this.sessionId = null;
        completionCallback.call(this, err, json);
    });
};
PVServerAPI.prototype.logout = prom.promisify(PVServerAPI.prototype.logout);

module.exports = {
    'PVServerAPI': PVServerAPI,
    'PVServerError': PVServerError,
    'jsonToXML': jsonToXML
};