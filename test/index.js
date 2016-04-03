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

var mainFunc = function(userid, passwd, url) {
    var pvserver = require('../');
    var pv = new pvserver(url);
    pv.login(userid, passwd, null).
    then(function(json) {

        return pv.sendRequest('Query', queryParams);

    }).
    then(function(json) {

        console.log(JSON.stringify(json));
        return pv.logout();
    }).
    then(function(json) {

        console.log(JSON.stringify(json));

        // Invalid session test
        return pv.sendRequest('Query', queryParams);
    }).
    then(function(json) {
        console.log(JSON.stringify(json));
        console.log("Test Failed.");
        process.exit(0);
    }).
    catch(function(err) {
        console.log(`Error: ${err.message}`);
        if (err.message === "RPM_PE_INVALID_SESSION") {
            console.log("Test Successful.");
        } else {
            console.log("Test Failed.");
        }
        process.exit(0);
    });
};

var nodename = process.argv[0].replace(/^.*[/]/, '');
var procname = process.argv[1].replace(/^.*[/]/, '');
var args = process.argv.slice(2);
if (args.length != 3) {
    console.log(`usage: ${nodename} ${procname} hosturl userid password`);
    process.exit(1);
}

mainFunc(args[1], args[2], args[0]);