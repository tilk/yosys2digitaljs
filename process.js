#!/usr/bin/env node
"use strict";

const fs = require('fs');
const argv = require('minimist')(
    process.argv.slice(2), 
    {boolean: ["optimize", "yosys_out", "yosys_output", "html", "no_io_ui", "tmpdir", "noindent", "fsmexpand"],
     string: ["fsm"],
     default: {fsm: true}}
);
const util = require('util');

function read_files(l) {
    const ret = {};
    for (const name of l) {
        ret[name] = fs.readFileSync(name);
    };
    return ret;
}

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
const yosys2digitaljs = require('./dist/index.js');
const opts = {};
if (argv.optimize) opts.optimize = true;
if (argv.fsm) opts.fsm = argv.fsm;
if (argv.fsmexpand) opts.fsmexpand = true;
if (argv.lint) opts.lint = true;
if (argv.propagation !== undefined) opts.propagation = Number(argv.propagation);
const result = argv.tmpdir ? yosys2digitaljs.process_files(read_files(argv._), opts) : yosys2digitaljs.process(argv._, null, opts);
result.then(res => {
    if (argv.html) {
        console.log(header);
        console.log('<div id="paper"></div><script>const circuit = new digitaljs.Circuit(');
    };
    if (argv.yosys_out) {
        console.log('/*');
        console.log(res.yosys_stdout);
        console.log('*/');
    }
    if (argv.yosys_output) {
        console.log('/*');
        console.log(util.inspect(res.yosys_output, {showHidden: false, depth: null, colors: process.stdout.isTTY && process.stdout.hasColors()}));
        console.log('*/');
    }
    if (opts.lint && res.lint && res.lint.length) {
        console.log('/*');
        for (const lint of res.lint) {
            console.log(`${lint.type} ${lint.file}:${lint.line}:${lint.column} ${lint.message}`);
        }
        console.log('*/');
    }
    const output = res.output;
    if (!argv.no_io_ui) yosys2digitaljs.io_ui(output);
    console.log(JSON.stringify(output, null, argv.noindent ? 0 : 2));
    if (argv.html) {
        console.log(');const paper = circuit.displayOn($(\'#paper\'));circuit.start();</script></body></html>');
    };
})
.catch(res => {
    console.error('Yosys failed!');
    console.error(util.inspect(res, {showHidden: false, depth: null, colors: process.stdout.isTTY && process.stdout.hasColors()}));
    process.exit(1);
});

