"use strict";

/*globals Buffer: true, require: true, module: true */

var prom = require('bluebird');
var qs = require('querystring');
var FormData = require('form-data');

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

function PVServerAPI(urlString) {

    this.user = null;
    this.role = null;

    if (!urlString) {
        urlString = "http://localhost";
    }

    this.configPath = "/PE/DKC/";

    this.device = "HTML5";
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

    this.setHostURL(urlString);
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
    return (this.status && this.status.Message && this.status.Message) ? this.status.Message.text : 'No relevant message';
};

PVServerAPI.prototype.setHostURL = function(urlString) {
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
    var requestStr = buildXmlReqStr.call(server, operation, parameters);

    var post_data = qs.stringify({
        "dataformat": "json",
        "request": requestStr
    });

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

    var post = this.http.request({
            host: this.hostName,
            port: this.hostPort,
            path: this.urlPath,
            method: 'POST',
            headers: headers
        },
        function(res) {
            res.setEncoding('utf8');
            var data = "";
            var code = null;
            res.on('data', function(chunk) {
                data += chunk;

            });
            res.on('end', function() {
                var json = null;
                try {
                    json = JSON.parse(data);
                } catch (err) {
                    json = data;
                }
                var status = (json && json.PVResponse) ? json.PVResponse.PVStatus : null;
                code = (status && status.Code) ? status.Code.text : null;
                if (server.isOkay(code)) {
                    server.sessionId = status.SessionId.text;
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
        }
    );

    post.on('error', function(err) {
        completionCallback.call(server, err, null);
    });

    post.write(post_data);
    post.end();
};
PVServerAPI.prototype.sendRequest = prom.promisify(PVServerAPI.prototype.sendRequestAsync);


PVServerAPI.prototype.loginAsync = function(user, password, credKey, completionCallback) {

    var params = ['<User>', user, '</User>'];
    if (password) {
        params.push('<Password>', password, '</Password>');
    }
    if (credKey) {
        params.push('<CredentialKey>', credKey, '</CredentialKey>');
    }
    params.push('<TimeOut>', this.timeOut.toString(), '</TimeOut>');
    params.push('<DeviceName>', this.device, '</DeviceName>');

    var server = this;
    server.sendRequest("Login", params.join("")).then(function(json) {
        server.user = json.PVResponse.PVStatus.User.text;
        server.role = json.PVResponse.PVStatus.UserGroup.text;
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
    'PVFormData' : FormData
};