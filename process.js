#!/usr/bin/env node
"use strict";

const argv = require('minimist')(process.argv.slice(2));

const header = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html;charset=UTF-8" />
    <script type="text/javascript" src="main.js"></script>
    <title></title>
  </head>
  <body>`;

if (argv._.length === 0) {
    console.error('No Verilog files passed!');
    process.exit(1);
}
require('./index.js').process(argv._)
.then(res => {
    if (argv.html) {
        console.log(header);
        console.log('<div id="paper"></div><script>const circuit = new digitaljs.Circuit(');
    };
    if (argv.yosys_out) {
        console.log('/*');
        console.log(res.yosys_stdout);
        console.log('*/');
    }
    console.log(JSON.stringify(res.output, null, 2));
    if (argv.html) {
        console.log(');const paper = circuit.displayOn($(\'#paper\'));</script></body></html>');
    };
})
.catch(res => {
    console.error('Yosys failed!');
    console.error(res.stderr);
    process.exit(1);
});

