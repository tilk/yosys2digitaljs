#!/usr/bin/env node
"use strict";

import * as tmp from 'tmp-promise';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { yosys2digitaljs, ConvertOptions, Digitaljs } from './core';
const sanitize = require('sanitize-filename');

type Options = ConvertOptions & {
    optimize?: boolean,
    fsmexpand?: boolean,
    fsm?: boolean | "nomap",
    timeout?: number,
    lint?: boolean
};

type Output = {
    output?: Digitaljs.TopModule,
    yosys_output?: any,
    yosys_stdout: string,
    yosys_stderr: string,
    lint?: LintMessage[]
};

type LintMessage = {
    type: string,
    file: string,
    line: number,
    column: number,
    message: string
};


function ansi_c_escape_contents(cmd: string): string {
    function func(ch: string) {
        if (ch == '\t') return '\\t';
        if (ch == '\r') return '\\r';
        if (ch == '\n') return '\\n';
        return '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0');
    }
    return cmd.replace(/(["'\\])/g,'\\$1')
              .replace(/[\x00-\x1F\x7F-\x9F]/g, func);
}

function ansi_c_escape(cmd: string): string {
    return '"' + ansi_c_escape_contents(cmd) + '"';
}

function shell_escape_contents(cmd: string): string {
    return cmd.replace(/(["\r\n$`\\])/g,'\\$1');
}

function shell_escape(cmd: string): string {
    return '"' + shell_escape_contents(cmd) + '"';
}

function process_filename(filename: string): string {
    const flags = /\.sv$/.test(filename) ? " -sv" : "";
    return "read_verilog" + flags + " " + ansi_c_escape(filename);
}

const verilator_re = /^%(Warning|Error)[^:]*: ([^:]*):([0-9]+):([0-9]+): (.*)$/;

export async function verilator_lint(filenames: string[], dirname?: string, options: Options = {}): Promise<LintMessage[]> {
    try {
        const output: LintMessage[] = [];
        const verilator_result: {stdout: string, stderr: string} = await promisify(child_process.exec)(
            'timeout -k10s 40s verilator -lint-only -Wall -Wno-DECLFILENAME -Wno-UNOPT -Wno-UNOPTFLAT ' + filenames.map(shell_escape).join(' '),
            {maxBuffer: 1000000, cwd: dirname || null, timeout: options.timeout || 60000})
            .catch(exc => exc);
        for (const line of verilator_result.stderr.split('\n')) {
            const result = line.match(verilator_re);
            if (result == null) continue;
            output.push({
                type: result[1],
                file: path.basename(result[2]),
                line: Number(result[3]),
                column: Number(result[4]),
                message: result[5]
            });
        }
        return output;
    } catch (exc) {
        return null;
    }
}

export async function process(filenames: string[], dirname?: string, options: Options = {}): Promise<Output> {
    const optimize_simp = options.optimize ? "; opt" : "; opt_clean";
    const optimize = options.optimize ? "; opt -full" : "; opt_clean";
    const fsmexpand = options.fsmexpand ? " -expand" : "";
    const fsmpass = options.fsm == "nomap" ? "; fsm -nomap" + fsmexpand
                  : options.fsm ? "; fsm" + fsmexpand
                  : "";
    const tmpjson = await tmp.tmpName({ postfix: '.json' });
    let obj = undefined;
    const yosys_result: {stdout: string, stderr: string, killed?: boolean, code?: number} = await promisify(child_process.exec)(
        'timeout -k10s 40s yosys -p "' + shell_escape_contents(filenames.map(process_filename).join('; ')) +
        '; hierarchy -auto-top; proc' + optimize_simp + fsmpass + '; memory -nomap; wreduce -memx' +
        optimize + '" -o "' + tmpjson + '"',
        {maxBuffer: 1000000, cwd: dirname || null, timeout: options.timeout || 60000})
        .catch(exc => exc);
    try {
        if (yosys_result instanceof Error) {
            if (yosys_result.killed) 
                yosys_result.message = "Yosys killed"
            else if (yosys_result.code)
                yosys_result.message = "Yosys failed with code " + yosys_result.code;
            else
                yosys_result.message = "Yosys failed";
            throw yosys_result;
        }
        obj = JSON.parse(fs.readFileSync(tmpjson, 'utf8'));
        await promisify(fs.unlink)(tmpjson);
        const output = yosys2digitaljs(obj, options);
        const ret: Output = {
            output: output,
            yosys_output: obj,
            yosys_stdout: yosys_result.stdout,
            yosys_stderr: yosys_result.stderr
        };
        if (options.lint)
            ret.lint = await verilator_lint(filenames, dirname, options);
        return ret;
    } catch (exc) {
        if (obj !== undefined) exc.yosys_output = obj;
        exc.yosys_stdout = yosys_result.stdout;
        exc.yosys_stderr = yosys_result.stderr;
        throw exc;
    }
}

export async function process_files(data: {[key: string]: string}, options: Options = {}): Promise<Output> {
    const dir = await tmp.dir();
    const names = [];
    try {
        for (const [name, content] of Object.entries(data)) {
            const sname = sanitize(name);
            await promisify(fs.writeFile)(path.resolve(dir.path, sname), content);
            if (/\.(v|sv)$/.test(sname)) names.push(sname);
        }
        return await process(names, dir.path, options);
    } finally {
        for (const name of Object.keys(data)) {
            await promisify(fs.unlink)(path.resolve(dir.path, name)).catch(exc => exc);
        }
        dir.cleanup();
    }
}

export async function process_sv(text: string, options: Options = {}): Promise<Output> {
    const tmpsv = await tmp.file({ postfix: '.sv' });
    try {
        await promisify(fs.write)(tmpsv.fd, text);
        await promisify(fs.close)(tmpsv.fd);
        return await process([tmpsv.path], undefined, options);
    } finally {
        tmpsv.cleanup();
    }
}
