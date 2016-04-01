#!/usr/bin/env node

"use strict";

/*globals require: true */

var queryParams = ['<Currency>USD</Currency>',
    '<ProfitModel>PipelineProduct</ProfitModel>',
    '<Category>Sales</Category>',
    '<Groups>',
    '<Group name="Res1">PV_Industry</Group>',
    '</Groups>',
    '<Fields>',
    '<Field>PV_Order_Margin</Field>',
    '</Fields>',
    '<SearchCriteria>',
    '<DateRange ignoreBaseQuery="true">',
    '<From>',
    '<Year>1000</Year>',
    '<Month>01</Month>',
    '</From>',
    '<To>',
    '<Year>2999</Year>',
    '<Month>06</Month>',
    '</To>',
    '</DateRange>',
    '</SearchCriteria>'
].join("");

var doWork = function(err, json) {

    if (!this.isOkay(err)) {
        console.log("Login Failed.");
        return;
    }

    console.log(JSON.stringify(json));

    this.sendRequestAsync('Query', queryParams, function(err, json) {

        console.log(JSON.stringify(json));

        if (this.isOkay(err)) {

            this.logout(function(err, json) {

                console.log(JSON.stringify(json));

                // Invalid session test
                this.sendRequestAsync('Query', queryParams, function(err, json) {
                    console.log(JSON.stringify(json));
                    if (err === "RPM_PE_INVALID_SESSION") {
                        console.log("Test Successful.");
                    } else {
                        console.log("Test Failed.");
                    }
                });
            });

        } else {
            console.log("Query Failed.");
        }
    });
};

const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

var userid = null;
var passwd = null;
var hostname = null;

rl.question('Host URL (e.g. http://xxxx.pvelocity.com): ', (answer) => {
    if (answer) {
        hostname = answer;
        rl.question('User Id: ', (answer) => {
            if (answer) {
                userid = answer;
                rl.question('Password: ', (answer) => {
                    if (answer) {
                        var pv = require('../');
                        passwd = answer;

                        // Login into the server
                        pv.setHostURL(hostname);
                        pv.login(userid, passwd, null, doWork.bind(pv));
                    } else {
                        console.log('Password is required.');
                    }
                    rl.close();
                });
            } else {
                console.log('User Id is required.');
                process.exit(1);
                rl.close();
            }
        });
    } else {
        console.log('Host is required.');
        process.exit(1);
        rl.close();

    }
});