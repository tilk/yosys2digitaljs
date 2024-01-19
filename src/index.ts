#!/usr/bin/env node
"use strict";

import * as tmp from 'tmp-promise';
import * as child_process from 'child_process';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as HashMap from 'hashmap';
import * as bigInt from 'big-integer';
import {promisify} from 'util';
import {Vector3vl, Mem3vl} from '3vl';

const topsort: <T>(edges:T[][], options?:{continueOnCircularDependency: boolean}) => T[] = require('topsort');
const sanitize = require("sanitize-filename");

const unary_gates = new Set([
    '$not', '$neg', '$pos', '$reduce_and', '$reduce_or', '$reduce_xor',
    '$reduce_xnor', '$reduce_bool', '$logic_not']);
const binary_gates = new Set([
    '$and', '$or', '$xor', '$xnor',
    '$add', '$sub', '$mul', '$div', '$mod', '$pow',
    '$lt', '$le', '$eq', '$ne', '$ge', '$gt', '$eqx', '$nex',
    '$shl', '$shr', '$sshl', '$sshr', '$shift', '$shiftx',
    '$logic_and', '$logic_or']);
const gate_subst = new Map([
    ['$not', 'Not'],
    ['$and', 'And'],
    ['$nand', 'Nand'],
    ['$or', 'Or'],
    ['$nor', 'Nor'],
    ['$xor', 'Xor'],
    ['$xnor', 'Xnor'],
    ['$reduce_and', 'AndReduce'],
    ['$reduce_nand', 'NandReduce'],
    ['$reduce_or', 'OrReduce'],
    ['$reduce_nor', 'NorReduce'],
    ['$reduce_xor', 'XorReduce'],
    ['$reduce_xnor', 'XnorReduce'],
    ['$reduce_bool', 'OrReduce'],
    ['$logic_not', 'NorReduce'],
    ['$repeater', 'Repeater'],
    ['$shl', 'ShiftLeft'],
    ['$shr', 'ShiftRight'],
    ['$lt', 'Lt'],
    ['$le', 'Le'],
    ['$eq', 'Eq'],
    ['$ne', 'Ne'],
    ['$gt', 'Gt'],
    ['$ge', 'Ge'],
    ['$constant', 'Constant'],
    ['$neg', 'Negation'],
    ['$pos', 'UnaryPlus'],
    ['$add', 'Addition'],
    ['$sub', 'Subtraction'],
    ['$mul', 'Multiplication'],
    ['$div', 'Division'],
    ['$mod', 'Modulo'],
    ['$pow', 'Power'],
    ['$mux', 'Mux'],
    ['$pmux', 'Mux1Hot'],
    ['$mem', 'Memory'],
    ['$mem_v2', 'Memory'],
    ['$lut', 'Memory'],
    ['$fsm', 'FSM'],
    ['$clock', 'Clock'],
    ['$button', 'Button'],
    ['$lamp', 'Lamp'],
    ['$numdisplay', 'NumDisplay'],
    ['$numentry', 'NumEntry'],
    ['$input', 'Input'],
    ['$output', 'Output'],
    ['$busgroup', 'BusGroup'],
    ['$busungroup', 'BusUngroup'],
    ['$busslice', 'BusSlice'],
    ['$zeroextend', 'ZeroExtend'],
    ['$signextend', 'SignExtend'],
    ['$reduce_bool', 'OrReduce'],
    ['$eqx', 'Eq'],
    ['$nex', 'Ne'],
    ['$sshl', 'ShiftLeft'],
    ['$sshr', 'ShiftRight'],
    ['$shift', 'ShiftRight'],
    ['$shiftx', 'ShiftRight'],
    ['$logic_and', 'And'],
    ['$logic_or', 'Or'],
    ['$dff', 'Dff'],
    ['$dffe', 'Dff'],
    ['$adff', 'Dff'],
    ['$adffe', 'Dff'],
    ['$sdff', 'Dff'],
    ['$sdffe', 'Dff'],
    ['$sdffce', 'Dff'],
    ['$dlatch', 'Dff'],
    ['$adlatch', 'Dff'],
    ['$sr', 'Dff'],
    ['$dffsr', 'Dff'],
    ['$dffsre', 'Dff'],
    ['$aldff', 'Dff'],
    ['$aldffe', 'Dff']]);
const gate_negations = new Map([
    ['And', 'Nand'],
    ['Nand', 'And'],
    ['Nor', 'Or'],
    ['Or', 'Nor'],
    ['Xor', 'Xnor'],
    ['Xnor', 'Xor'],
    ['AndReduce', 'NandReduce'],
    ['NandReduce', 'AndReduce'],
    ['NorReduce', 'OrReduce'],
    ['OrReduce', 'NorReduce'],
    ['XorReduce', 'XnorReduce'],
    ['XnorReduce', 'XorReduce']]);

namespace Digitaljs {

    export type FilePosition = {
        line: number,
        column: number
    };

    export type SourcePosition = {
        name: string,
        from: FilePosition,
        to: FilePosition
    };

    export type MemReadPort = {
        clock_polarity?: boolean,
        enable_polarity?: boolean,
        arst_polarity?: boolean,
        srst_polarity?: boolean,
        enable_srst?: boolean,
        transparent?: boolean | boolean[],
        collision?: boolean | boolean[],
        init_value?: string,
        arst_value?: string,
        srst_value?: string
    };
    
    export type MemWritePort = {
        clock_polarity?: boolean,
        enable_polarity?: boolean,
        no_bit_enable?: boolean
    };
    
    export type Device = {
        type: string,
        source_positions?: SourcePosition[],
        [key: string]: any
    };
    
    export type Port = {
        id: string,
        port: string
    };
    
    export type Connector = {
        from: Port,
        to: Port,
        name?: string,
        source_positions?: SourcePosition[]
    };
    
    export type Module = {
        devices: { [key: string]: Device },
        connectors: Connector[]
    };
    
    export type TopModule = Module & {
        subcircuits: { [key: string]: Module }
    };

};

namespace Yosys {

    export const ConstChars = ["0", "1", "x", "z"] as const;

    export type BitChar = (typeof ConstChars)[number];

    export type Bit = number | BitChar;

    export type BitVector = Bit[];

    export type Port = {
        direction: 'input' | 'output' | 'inout',
        bits: any
    };

    export type Parameters = {
        WIDTH?: JsonConstant,
        A_WIDTH?: JsonConstant,
        B_WIDTH?: JsonConstant,
        S_WIDTH?: JsonConstant,
        Y_WIDTH?: JsonConstant,
        A_SIGNED?: JsonConstant,
        B_SIGNED?: JsonConstant,
        CLK_POLARITY?: JsonConstant,
        EN_POLARITY?: JsonConstant,
        ARST_POLARITY?: JsonConstant,
        ARST_VALUE: JsonConstant,
        CTRL_IN_WIDTH?: JsonConstant,
        CTRL_OUT_WIDTH?: JsonConstant,
        TRANS_NUM?: JsonConstant,
        STATE_NUM?: JsonConstant,
        STATE_NUM_LOG2?: JsonConstant,
        STATE_RST?: JsonConstant,
        RD_PORTS?: JsonConstant,
        WR_PORTS?: JsonConstant,
        RD_CLK_POLARITY?: JsonConstant,
        RD_CLK_ENABLE?: JsonConstant,
        RD_CLK_TRANSPARENT?: JsonConstant,
        WR_CLK_POLARITY?: JsonConstant,
        WR_CLK_ENABLE?: JsonConstant,
        [key: string]: any
    };

    export type JsonConstant = number | string;

    export type Attributes = {
        init: JsonConstant,
        [key: string]: any
    };
    
    export type Cell = {
        hide_name: 0 | 1,
        type: string,
        parameters: Parameters,
        attributes: Attributes,
        port_directions: { [key: string]: 'input' | 'output' },
        connections: { [key: string]: BitVector }
    };
    
    export type Net = {
        hide_name: 0 | 1,
        bits: BitVector,
        attributes: { [key: string]: string }
    };
    
    export type Module = {
        ports: { [key: string]: Port },
        cells: { [key: string]: Cell },
        netnames: { [key: string]: Net }
    };
    
    export type Output = {
        modules: { [key: string]: Module }
    };

};

type ConvertOptions = {
    propagation?: number,
};

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

type Portmap = { [key: string]: string };
type Portmaps = { [key: string]: Portmap };

type Bit = Yosys.Bit | `bit${number}`;

type Net = Bit[];

type NetInfo = {
    source: undefined | Digitaljs.Port,
    targets: Digitaljs.Port[],
    name: undefined | string,
    source_positions: Digitaljs.SourcePosition[]
};

type BitInfo = {
    id: string,
    port: string,
    num: number
};

type LintMessage = {
    type: string,
    file: string,
    line: number,
    column: number,
    message: string
};

function chunkArray(a, chunk_size){
    let results = [];
	let ca = a.splice();
    
    while (ca.length) {
        results.push(ca.splice(0, chunk_size));
    }
    
    return results;
}

function module_deps(data: Yosys.Output): [string, string | number][] {
    const out: [string, string | number][] = [];
    for (const [name, mod] of Object.entries(data.modules)) {
        out.push([name, 1/0]);
        for (const cname in mod.cells) {
            const cell = mod.cells[cname];
            if (cell.type in data.modules)
                out.push([cell.type, name]);
        }
    }
    return out;
}

function order_ports(data: Yosys.Output): Portmaps {
    const unmap = {A: 'in', Y: 'out'};
    const binmap = {A: 'in1', B: 'in2', Y: 'out'};
    const out = {
        '$mux': {A: 'in0', B: 'in1', S: 'sel', Y: 'out'},
        '$dff': {CLK: 'clk', D: 'in', Q: 'out'},
        '$dffe': {CLK: 'clk', EN: 'en', D: 'in', Q: 'out'},
        '$adff': {CLK: 'clk', ARST: 'arst', D: 'in', Q: 'out'},
        '$adffe': {CLK: 'clk', EN: 'en', ARST: 'arst', D: 'in', Q: 'out'},
        '$sdff': {CLK: 'clk', SRST: 'srst', D: 'in', Q: 'out'},
        '$sdffe': {CLK: 'clk', EN: 'en', SRST: 'srst', D: 'in', Q: 'out'},
        '$sdffce': {CLK: 'clk', EN: 'en', SRST: 'srst', D: 'in', Q: 'out'},
        '$dlatch': {EN: 'en', D: 'in', Q: 'out'},
        '$adlatch': {EN: 'en', ARST: 'arst', D: 'in', Q: 'out'},
        '$dffsr': {CLK: 'clk', SET: 'set', CLR: 'clr', D: 'in', Q: 'out'},
        '$dffsre': {CLK: 'clk', EN: 'en', SET: 'set', CLR: 'clr', D: 'in', Q: 'out'},
        '$aldff': {CLK: 'clk', ALOAD: 'aload', AD: 'ain', D: 'in', Q: 'out'},
        '$aldffe': {CLK: 'clk', EN: 'en', ALOAD: 'aload', AD: 'ain', D: 'in', Q: 'out'},
        '$sr': {SET: 'set', CLR: 'clr', Q: 'out'},
        '$fsm': {ARST: 'arst', CLK: 'clk', CTRL_IN: 'in', CTRL_OUT: 'out'}
    };
    binary_gates.forEach((nm) => out[nm] = binmap);
    unary_gates.forEach((nm) => out[nm] = unmap);
    for (const [name, mod] of Object.entries(data.modules)) {
        const portmap: Portmap = {};
        const ins = [], outs = [];
        for (const pname in mod.ports) {
            portmap[pname] = pname;
        }
        out[name] = portmap;
    }
    return out;
}

function decode_json_bigint(param: string | number): bigInt.BigInteger {
    if (typeof param == 'string')
        return bigInt(param, 2)
    else if (typeof param == 'number')
        return bigInt(param)
    else assert(false);
}

function decode_json_number(param: Yosys.JsonConstant): number {
    if (typeof param == 'string')
        return Number.parseInt(param, 2);
    else if (typeof param == 'number')
        return param
    else assert(false);
}

function decode_json_bigint_as_array(param: string | number): number[] {
    return decode_json_bigint(param).toArray(2).value;
}

function decode_json_constant(param: Yosys.JsonConstant, bits: number, fill : Yosys.BitChar = '0'): string {
    if (typeof param == 'number')
        return bigInt(param).toArray(2).value.map(String).reverse()
            .concat(Array(bits).fill(fill)).slice(0, bits).reverse().join('');
    else
        return param;
}

function parse_source_positions(str: string): Digitaljs.SourcePosition[] {
    const ret = [];
    for (const entry of str.split('|')) {
        const colonIdx = entry.lastIndexOf(':');
        const name = entry.slice(0, colonIdx);
        const pos = entry.slice(colonIdx+1);
        const [from, to] = pos.split('-').map(s => s.split('.').map(v => Number(v))).map(([line, column]) => ({line, column}));
        ret.push({name, from, to});
    }
    return ret;
}

function yosys_to_digitaljs(data: Yosys.Output, portmaps: Portmaps, options: ConvertOptions = {}): {[key: string]: Digitaljs.Module} {
    const out = {};
    for (const [name, mod] of Object.entries(data.modules)) {
        out[name] = yosys_to_digitaljs_mod(name, mod, portmaps, options);
    }
    return out
}

function yosys_to_digitaljs_mod(name: string, mod: Yosys.Module, portmaps: Portmaps, options: ConvertOptions = {}): Digitaljs.Module {
    function constbit(bit: Bit) {
        return (Yosys.ConstChars as readonly string[]).includes(bit.toString());
    }
    const nets = new HashMap<Net, NetInfo>();
    const netnames = new HashMap<Net, string[]>();
    const netsrc = new HashMap<Net, Digitaljs.SourcePosition[]>();
    const bits = new Map<Bit, BitInfo>();
    const devnets = new Map<string, Map<string, Net>>();
    let n = 0, pn = 0;
    function gen_name(): string {
        const nm = `dev${n++}`;
        devnets.set(nm, new Map());
        return nm;
    }
    function gen_bitname(): Bit {
        return `bit${pn++}`;
    }
    function get_net(k: Net): NetInfo {
        // create net if does not exist yet
        if (!nets.has(k)) {
            const nms = netnames.get(k);
            const src = netsrc.get(k);
            nets.set(k, {source: undefined, targets: [], name: nms ? nms[0] : undefined, source_positions: src || []});
        }
        return nets.get(k);
    }
    function add_net_source(k: Net, d: string, p: string, primary: boolean = false) {
        if (k.length == 0) return; // for unconnected ports
        const net = get_net(k);
        if(net.source !== undefined) {
            // multiple sources driving one net, disallowed in digitaljs
            throw Error('Multiple sources driving net: ' + net.name);
        }
        net.source = { id: d, port: p };
        if (primary) for (const [nbit, bit] of k.entries()) {
            bits.set(bit, { id: d, port: p, num: nbit });
        }
        devnets.get(d).set(p, k);
    }
    function add_net_target(k: Net, d: string, p: string) {
        if (k.length == 0) return; // for unconnected ports
        const net = get_net(k);
        net.targets.push({ id: d, port: p });
        devnets.get(d).set(p, k);
    }
    const mout = {
        devices: {},
        connectors: []
    }
    function add_device(dev : Digitaljs.Device): string {
        const dname = gen_name();
        if (options.propagation !== undefined)
            dev.propagation = options.propagation;
        mout.devices[dname] = dev;
        return dname;
    }
    function add_busgroup(nbits: Net, groups: Net[]) {
        if (get_net(nbits).source !== undefined)
            return; // the bits were already grouped
        const dname = add_device({
            type: 'BusGroup',
            groups: groups.map(g => g.length)
        });
        add_net_source(nbits, dname, 'out');
        for (const [gn, group] of groups.entries()) {
            add_net_target(group, dname, 'in' + gn);
        }
    }
    function connect_device(dname: string, cell: Yosys.Cell, portmap: Portmap) {
        for (const [pname, pdir] of Object.entries(cell.port_directions)) {
            const pconn = cell.connections[pname];
            switch (pdir) {
                case 'input':
                    add_net_target(pconn, dname, portmap[pname]);
                    break;
                case 'output':
                    add_net_source(pconn, dname, portmap[pname], true);
                    break;
                default:
                    throw Error('Invalid port direction: ' + pdir);
            }
        }
    }
    function connect_pmux(dname: string, cell: Yosys.Cell) {
        add_net_target(cell.connections.A, dname, 'in0');
        add_net_target(cell.connections.S.slice().reverse(), dname, 'sel');
        add_net_source(cell.connections.Y, dname, 'out', true);
        for (const i of Array(decode_json_number(cell.parameters.S_WIDTH)).keys()) {
            const p = (decode_json_number(cell.parameters.S_WIDTH)-i-1) * decode_json_number(cell.parameters.WIDTH);
            add_net_target(cell.connections.B.slice(p, p + decode_json_number(cell.parameters.WIDTH)),
                dname, 'in' + (i+1));
        }
    }
    function connect_mem(dname: string, cell: Yosys.Cell, dev: Digitaljs.Device) {
        for (const [k, port] of dev.rdports.entries()) {
            const portname = "rd" + k;
            add_net_target(cell.connections.RD_ADDR.slice(dev.abits * k, dev.abits * (k+1)),
                dname, portname + "addr");
            add_net_source(cell.connections.RD_DATA.slice(dev.bits * k, dev.bits * (k+1)),
                dname, portname + "data", true);
            if ('clock_polarity' in port)
                add_net_target([cell.connections.RD_CLK[k]], dname, portname + "clk");
            if ('enable_polarity' in port)
                add_net_target([cell.connections.RD_EN[k]], dname, portname + "en");
            if ('arst_polarity' in port)
                add_net_target([cell.connections.RD_ARST[k]], dname, portname + "arst");
            if ('srst_polarity' in port)
                add_net_target([cell.connections.RD_SRST[k]], dname, portname + "srst");
        }
        for (const [k, port] of dev.wrports.entries()) {
            const portname = "wr" + k;
            add_net_target(cell.connections.WR_ADDR.slice(dev.abits * k, dev.abits * (k+1)),
                dname, portname + "addr");
            add_net_target(cell.connections.WR_DATA.slice(dev.bits * k, dev.bits * (k+1)),
                dname, portname + "data");
            if ('clock_polarity' in port)
                add_net_target([cell.connections.WR_CLK[k]], dname, portname + "clk");
            if ('enable_polarity' in port) {
                if (port.no_bit_enable)
                    add_net_target([cell.connections.WR_EN[dev.bits * k]], dname, portname + "en");
                else
                    add_net_target(cell.connections.WR_EN.slice(dev.bits * k, dev.bits * (k+1)),
                        dname, portname + "en");
            }
        }
    }
    // Find net names
    for (const [nname, data] of Object.entries(mod.netnames)) {
        if (data.hide_name) continue;
        let l = netnames.get(data.bits);
        if (l === undefined) {
            l = [];
            netnames.set(data.bits, l);
        }
        l.push(nname);
        if (typeof data.attributes == 'object' && data.attributes.src) {
            let l = netsrc.get(data.bits);
            if (l === undefined) {
                l = [];
                netsrc.set(data.bits, l);
            }
            const positions = parse_source_positions(data.attributes.src);
            l.push(...positions);
        }
    }
    // Add inputs/outputs
    for (const [pname, port] of Object.entries(mod.ports)) {
        const dir = port.direction == "input" ? "Input" :
                    port.direction == "output" ? "Output" : 
                    undefined;
        const dname = add_device({
            type: dir,
            net: pname,
            order: n,
            bits: port.bits.length
        });
        switch (port.direction) {
            case 'input':
                add_net_source(port.bits, dname, 'out', true);
                break;
            case 'output':
                add_net_target(port.bits, dname, 'in');
                break;
            default: throw Error('Invalid port direction: ' + port.direction);
        }
    }
    // Add gates
    for (const [cname, cell] of Object.entries(mod.cells)) {
        const dev : Digitaljs.Device = {
            label: cname,
            type: gate_subst.get(cell.type)
        };
        if (dev.type == undefined) {
            dev.type = 'Subcircuit';
            dev.celltype = cell.type;
        }
        if (typeof cell.attributes == 'object' && cell.attributes.src) {
            dev.source_positions = parse_source_positions(cell.attributes.src);
        }
        const dname = add_device(dev);
        function match_port(con: Net, nsig: Yosys.JsonConstant, sz: number) {
            const sig = decode_json_number(nsig);
            if (con.length > sz)
                con.splice(sz);
            else if (con.length < sz) {
                const ccon = con.slice();
                const pad = sig ? con.slice(-1)[0] : '0';
                con.splice(con.length, 0, ...Array(sz - con.length).fill(pad));
                if (!con.every(constbit) && get_net(con).source === undefined) {
                    // WARNING: potentially troublesome hack for readability
                    // handled generally in the grouping phase,
                    // but it's hard to add sign extensions there
                    const extname = add_device({
                        type: sig ? 'SignExtend' : 'ZeroExtend',
                        extend: { input: ccon.length, output: con.length }
                    });
                    add_net_target(ccon, extname, 'in');
                    add_net_source(con, extname, 'out');
                }
            }
        }
        function zero_extend_output(con: Net) {
            if (con.length > 1) {
                const ccon = con.slice();
                con.splice(1);
                const extname = add_device({
                    type: 'ZeroExtend',
                    extend: { input: con.length, output: ccon.length }
                });
                add_net_source(ccon, extname, 'out');
                add_net_target(con, extname, 'in');
            }
        }
        if (unary_gates.has(cell.type)) {
                assert(cell.connections.A.length == decode_json_number(cell.parameters.A_WIDTH));
                assert(cell.connections.Y.length == decode_json_number(cell.parameters.Y_WIDTH));
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.Y == 'output');
        }
        if (binary_gates.has(cell.type)) {
                assert(cell.connections.A.length == decode_json_number(cell.parameters.A_WIDTH));
                assert(cell.connections.B.length == decode_json_number(cell.parameters.B_WIDTH));
                assert(cell.connections.Y.length == decode_json_number(cell.parameters.Y_WIDTH));
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.Y == 'output');
        }
        if (['$dff', '$dffe', '$adff', '$adffe', '$sdff', '$sdffe', '$sdffce', '$dlatch', '$adlatch', '$dffsr', '$dffsre', '$aldff', '$aldffe'].includes(cell.type)) {
            assert(cell.connections.D.length == decode_json_number(cell.parameters.WIDTH));
            assert(cell.connections.Q.length == decode_json_number(cell.parameters.WIDTH));
            assert(cell.port_directions.D == 'input');
            assert(cell.port_directions.Q == 'output');
            if (cell.type != '$dlatch' && cell.type != '$adlatch') {
                assert(cell.connections.CLK.length == 1);
                assert(cell.port_directions.CLK == 'input');
            }
        }
        if (['$dffe', '$adffe', '$sdffe', '$sdffce', '$dffsre', '$aldffe', '$dlatch', '$adlatch'].includes(cell.type)) {
            assert(cell.connections.EN.length == 1);
            assert(cell.port_directions.EN == 'input');
        }
        if (['$adff', '$adffe', '$adlatch'].includes(cell.type)) {
            assert(cell.connections.ARST.length == 1);
            assert(cell.port_directions.ARST == 'input');
        }
        if (['$sdff', '$sdffe', '$sdffce'].includes(cell.type)) {
            assert(cell.connections.SRST.length == 1);
            assert(cell.port_directions.SRST == 'input');
        }
        if (['$dffsr', '$dffsre'].includes(cell.type)) {
            assert(cell.connections.SET.length == decode_json_number(cell.parameters.WIDTH));
            assert(cell.connections.CLR.length == decode_json_number(cell.parameters.WIDTH));
            assert(cell.port_directions.SET == 'input');
            assert(cell.port_directions.CLR == 'input');
        }
        switch (cell.type) {
            case '$neg': case '$pos':
                dev.bits = {
                    in: cell.connections.A.length,
                    out: cell.connections.Y.length
                };
                dev.signed = Boolean(decode_json_number(cell.parameters.A_SIGNED));
                break;
            case '$not':
                match_port(cell.connections.A, cell.parameters.A_SIGNED, cell.connections.Y.length);
                dev.bits = cell.connections.Y.length;
                break;
            case '$add': case '$sub': case '$mul': case '$div': case '$mod': case '$pow':
                dev.bits = {
                    in1: cell.connections.A.length,
                    in2: cell.connections.B.length,
                    out: cell.connections.Y.length
                };
                dev.signed = {
                    in1: Boolean(decode_json_number(cell.parameters.A_SIGNED)),
                    in2: Boolean(decode_json_number(cell.parameters.B_SIGNED))
                }
                break;
            case '$and': case '$or': case '$xor': case '$xnor':
                match_port(cell.connections.A, cell.parameters.A_SIGNED, cell.connections.Y.length);
                match_port(cell.connections.B, cell.parameters.B_SIGNED, cell.connections.Y.length);
                dev.bits = cell.connections.Y.length;
                break;
            case '$reduce_and': case '$reduce_or': case '$reduce_xor': case '$reduce_xnor':
            case '$reduce_bool': case '$logic_not':
                dev.bits = cell.connections.A.length;
                zero_extend_output(cell.connections.Y);
                if (dev.bits == 1) {
                    if (['$reduce_xnor', '$logic_not'].includes(cell.type))
                        dev.type = 'Not';
                    else
                        dev.type = 'Repeater';
                }
                break;
            case '$eq': case '$ne': case '$lt': case '$le': case '$gt': case '$ge':
            case '$eqx': case '$nex':
                dev.bits = {
                    in1: cell.connections.A.length,
                    in2: cell.connections.B.length
                };
                dev.signed = {
                    in1: Boolean(decode_json_number(cell.parameters.A_SIGNED)),
                    in2: Boolean(decode_json_number(cell.parameters.B_SIGNED))
                };
                zero_extend_output(cell.connections.Y);
                break;
            case '$shl': case '$shr': case '$sshl': case '$sshr':
            case '$shift': case '$shiftx':
                dev.bits = {
                    in1: cell.connections.A.length,
                    in2: cell.connections.B.length,
                    out: cell.connections.Y.length
                };
                dev.signed = {
                    in1: Boolean(decode_json_number(cell.parameters.A_SIGNED)),
                    in2: Boolean(decode_json_number(cell.parameters.B_SIGNED) && ['$shift', '$shiftx'].includes(cell.type)),
                    out: Boolean(decode_json_number(cell.parameters.A_SIGNED) && ['$sshl', '$sshr'].includes(cell.type))
                };
                dev.fillx = cell.type == '$shiftx';
                break;
            case '$logic_and': case '$logic_or': {
                function reduce_input(con: Net) {
                    const ccon = con.slice();
                    con.splice(0, con.length, gen_bitname());
                    const extname = add_device({
                        type: 'OrReduce',
                        bits: ccon.length
                    });
                    add_net_source(con, extname, 'out');
                    add_net_target(ccon, extname, 'in');
                }
                if (cell.connections.A.length > 1)
                    reduce_input(cell.connections.A);
                if (cell.connections.B.length > 1)
                    reduce_input(cell.connections.B);
                zero_extend_output(cell.connections.Y);
                break;
            }
            case '$mux':
                assert(cell.connections.A.length == decode_json_number(cell.parameters.WIDTH));
                assert(cell.connections.B.length == decode_json_number(cell.parameters.WIDTH));
                assert(cell.connections.Y.length == decode_json_number(cell.parameters.WIDTH));
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.Y == 'output');
                dev.bits = {
                    in: decode_json_number(cell.parameters.WIDTH),
                    sel: 1
                };
                break;
            case '$pmux':
                assert(cell.connections.B.length == decode_json_number(cell.parameters.WIDTH) * decode_json_number(cell.parameters.S_WIDTH));
                assert(cell.connections.A.length == decode_json_number(cell.parameters.WIDTH));
                assert(cell.connections.S.length == decode_json_number(cell.parameters.S_WIDTH));
                assert(cell.connections.Y.length == decode_json_number(cell.parameters.WIDTH));
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.S == 'input');
                assert(cell.port_directions.Y == 'output');
                dev.bits = {
                    in: decode_json_number(cell.parameters.WIDTH),
                    sel: decode_json_number(cell.parameters.S_WIDTH)
                };
                break;
            case '$dff':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY))
                };
                break;
            case '$dffe':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY))
                };
                break;
            case '$aldff':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    aload: Boolean(decode_json_number(cell.parameters.ALOAD_POLARITY))
                };
                break;
            case '$aldffe':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY)),
                    aload: Boolean(decode_json_number(cell.parameters.ALOAD_POLARITY))
                };
                break;
            case '$adff':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    arst: Boolean(decode_json_number(cell.parameters.ARST_POLARITY))
                };
                dev.arst_value = decode_json_constant(cell.parameters.ARST_VALUE, dev.bits);
                break;
            case '$sdff':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    srst: Boolean(decode_json_number(cell.parameters.SRST_POLARITY))
                };
                dev.srst_value = decode_json_constant(cell.parameters.SRST_VALUE, dev.bits);
                break;
            case '$adffe':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    arst: Boolean(decode_json_number(cell.parameters.ARST_POLARITY)),
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY))
                };
                dev.arst_value = decode_json_constant(cell.parameters.ARST_VALUE, dev.bits);
                break;
            case '$sdffe':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    srst: Boolean(decode_json_number(cell.parameters.SRST_POLARITY)),
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY))
                };
                dev.srst_value = decode_json_constant(cell.parameters.SRST_VALUE, dev.bits);
                break;
            case '$sdffce':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    srst: Boolean(decode_json_number(cell.parameters.SRST_POLARITY)),
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY))
                };
                dev.enable_srst = true;
                dev.srst_value = decode_json_constant(cell.parameters.SRST_VALUE, dev.bits);
                break;
            case '$dlatch':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY))
                };
                break;
            case '$adlatch':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY)),
                    arst: Boolean(decode_json_number(cell.parameters.ARST_POLARITY))
                };
                dev.arst_value = decode_json_constant(cell.parameters.ARST_VALUE, dev.bits);
                break;
            case '$dffsr':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    set: Boolean(decode_json_number(cell.parameters.SET_POLARITY)),
                    clr: Boolean(decode_json_number(cell.parameters.CLR_POLARITY))
                };
                break;
            case '$dffsre':
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    enable: Boolean(decode_json_number(cell.parameters.EN_POLARITY)),
                    set: Boolean(decode_json_number(cell.parameters.SET_POLARITY)),
                    clr: Boolean(decode_json_number(cell.parameters.CLR_POLARITY))
                };
                break;
            case '$sr':
                assert(cell.connections.Q.length == decode_json_number(cell.parameters.WIDTH));
                assert(cell.port_directions.Q == 'output');
                dev.no_data = true;
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.polarity = {
                    set: Boolean(decode_json_number(cell.parameters.SET_POLARITY)),
                    clr: Boolean(decode_json_number(cell.parameters.CLR_POLARITY))
                };
                break;
            case '$fsm': {
                assert(cell.connections.ARST.length == 1);
                assert(cell.connections.CLK.length == 1);
                assert(cell.connections.CTRL_IN.length == decode_json_number(cell.parameters.CTRL_IN_WIDTH));
                assert(cell.connections.CTRL_OUT.length == decode_json_number(cell.parameters.CTRL_OUT_WIDTH));
                const TRANS_NUM = decode_json_number(cell.parameters.TRANS_NUM);
                const STATE_NUM_LOG2 = decode_json_number(cell.parameters.STATE_NUM_LOG2);
                const step = 2*STATE_NUM_LOG2 
                           + decode_json_number(cell.parameters.CTRL_IN_WIDTH)
                           + decode_json_number(cell.parameters.CTRL_OUT_WIDTH);
                const tt = typeof(cell.parameters.TRANS_TABLE) == "number"
                         ? Vector3vl.fromBin(bigInt(cell.parameters.TRANS_TABLE).toString(2), TRANS_NUM * step).toBin() // workaround for yosys silliness
                         : cell.parameters.TRANS_TABLE;
                assert(tt.length == TRANS_NUM * step);
                dev.polarity = {
                    clock: Boolean(decode_json_number(cell.parameters.CLK_POLARITY)),
                    arst: Boolean(decode_json_number(cell.parameters.ARST_POLARITY))
                };
                dev.wirename = cell.parameters.NAME;
                dev.bits = {
                    in: decode_json_number(cell.parameters.CTRL_IN_WIDTH),
                    out: decode_json_number(cell.parameters.CTRL_OUT_WIDTH)
                };
                dev.states = decode_json_number(cell.parameters.STATE_NUM);
                dev.init_state = decode_json_number(cell.parameters.STATE_RST);
                dev.trans_table = [];
                for (let i = 0; i < TRANS_NUM; i++) {
                    let base = i * step;
                    const f = (sz) => {
                        const ret = tt.slice(base, base + sz);
                        base += sz;
                        return ret;
                    };
                    const o = {
                        state_in: parseInt(f(STATE_NUM_LOG2), 2),
                        ctrl_in: f(decode_json_number(cell.parameters.CTRL_IN_WIDTH)).replace(/-/g, 'x'),
                        state_out: parseInt(f(STATE_NUM_LOG2), 2),
                        ctrl_out: f(decode_json_number(cell.parameters.CTRL_OUT_WIDTH))
                    };
                    dev.trans_table.push(o);
                }
                break;
            }
            case '$mem':
            case '$mem_v2': {
                const RD_PORTS = decode_json_number(cell.parameters.RD_PORTS);
                const WR_PORTS = decode_json_number(cell.parameters.WR_PORTS);
                assert(cell.connections.RD_EN.length == RD_PORTS);
                assert(cell.connections.RD_CLK.length == RD_PORTS);
                assert(cell.connections.RD_DATA.length == RD_PORTS * decode_json_number(cell.parameters.WIDTH));
                assert(cell.connections.RD_ADDR.length == RD_PORTS * decode_json_number(cell.parameters.ABITS));
                assert(cell.connections.WR_EN.length == WR_PORTS * decode_json_number(cell.parameters.WIDTH));
                assert(cell.connections.WR_CLK.length == WR_PORTS);
                assert(cell.connections.WR_DATA.length == WR_PORTS * decode_json_number(cell.parameters.WIDTH));
                assert(cell.connections.WR_ADDR.length == WR_PORTS * decode_json_number(cell.parameters.ABITS));
                if (cell.type == "$mem_v2") {
                    assert(cell.connections.RD_ARST.length == RD_PORTS);
                    assert(cell.connections.RD_SRST.length == RD_PORTS);
                }
                dev.bits = decode_json_number(cell.parameters.WIDTH);
                dev.abits = decode_json_number(cell.parameters.ABITS);
                dev.words = decode_json_number(cell.parameters.SIZE);
                dev.offset = decode_json_number(cell.parameters.OFFSET);
                dev.rdports = [];
                dev.wrports = [];
                const rdpol = decode_json_bigint_as_array(cell.parameters.RD_CLK_POLARITY).reverse();
                const rden  = decode_json_bigint_as_array(cell.parameters.RD_CLK_ENABLE).reverse();
                const rdtr  = cell.type == "$mem_v2" 
                            ? []
                            : decode_json_bigint_as_array(cell.parameters.RD_TRANSPARENT).reverse();
                const wrpol = decode_json_bigint_as_array(cell.parameters.WR_CLK_POLARITY).reverse();
                const wren  = decode_json_bigint_as_array(cell.parameters.WR_CLK_ENABLE).reverse();
                const init  = typeof(cell.parameters.INIT) == 'number'
                            ? bigInt(cell.parameters.INIT).toArray(2).value.map(String).reverse()
                            : cell.parameters.INIT.split('').reverse();
                const v2_feature = (param) => cell.type == "$mem_v2" ? decode_json_bigint_as_array(param).reverse() : [];
                const v2_feature_const = (param, size) => cell.type == "$mem_v2" ? decode_json_constant(param, size) : "";
                const rdtrmask  = v2_feature(cell.parameters.RD_TRANSPARENCY_MASK);
                const rdcolmask = v2_feature(cell.parameters.RD_COLLISION_X_MASK);
                const rdensrst  = v2_feature(cell.parameters.RD_CE_OVER_SRST);
                const rdinit    = v2_feature_const(cell.parameters.RD_INIT_VALUE, dev.bits * RD_PORTS);
                const rdarst    = v2_feature_const(cell.parameters.RD_ARST_VALUE, dev.bits * RD_PORTS);
                const rdsrst    = v2_feature_const(cell.parameters.RD_SRST_VALUE, dev.bits * RD_PORTS);
                if (cell.parameters.INIT) {
                    const l = init.slice(-1)[0] == 'x' ? 'x' : '0';
                    const memdata = new Mem3vl(dev.bits, dev.words);
                    for (const k of Array(dev.words).keys()) {
                        const wrd = init.slice(dev.bits * k, dev.bits * (k+1));
                        while (wrd.length < dev.bits) wrd.push(l);
                        memdata.set(k, Vector3vl.fromBin(wrd.reverse().join('')));
                    }
                    dev.memdata = memdata.toJSON();
                }
                for (const k of Array(RD_PORTS).keys()) {
                    const port: Digitaljs.MemReadPort = {
                    };
                    if (rden[k]) {
                        port.clock_polarity = Boolean(rdpol[k]);
                        if (cell.connections.RD_EN[k] != '1')
                            port.enable_polarity = true;
                    };
                    if (rdtr[k])
                        port.transparent = true;
                    if (cell.type == "$mem_v2") {
                        if (rdensrst[k])
                            port.enable_srst = true;
                        function mk_init(s: string, f: (v: string) => void) {
                            const v = s.slice(dev.bits * k, dev.bits * (k+1));
                            if (!v.split('').every(c => c == 'x'))
                                f(v);
                        };
                        mk_init(rdinit, v => port.init_value = v);
                        if (cell.connections.RD_ARST[k] != '0') {
                            port.arst_polarity = true;
                            mk_init(rdarst, v => port.arst_value = v);
                        }
                        if (cell.connections.RD_SRST[k] != '0') {
                            port.srst_polarity = true;
                            mk_init(rdsrst, v => port.srst_value = v);
                        }
                        function mk_mask(s: number[], f: (v: boolean | boolean[]) => void) {
                            const v = Array(WR_PORTS).fill(0);
                            s.slice(WR_PORTS * k, WR_PORTS * (k+1)).map((c, i) => { v[i] = c });
                            if (v.every(c => c))
                                f(true);
                            else if (v.some(c => c))
                                f(v.map(c => Boolean(c)));
                        }
                        mk_mask(rdtrmask, v => port.transparent = v);
                        mk_mask(rdcolmask, v => port.collision = v);
                    }
                    dev.rdports.push(port);
                }
                for (const k of Array(WR_PORTS).keys()) {
                    const port: Digitaljs.MemWritePort = {
                    };
                    if (wren[k]) {
                        port.clock_polarity = Boolean(wrpol[k]);
                        const wr_en_connections = cell.connections.WR_EN.slice(dev.bits * k, dev.bits * (k+1));
                        if (wr_en_connections.some(z => z != '1')) {
                            port.enable_polarity = true;
                            if (wr_en_connections.every(z => z == wr_en_connections[0]))
                                port.no_bit_enable = true;
                        }
                    };
                    dev.wrports.push(port);
                }
                break;
            }
            case '$lut':
                assert(cell.connections.A.length == decode_json_number(cell.parameters.WIDTH));
                assert(cell.connections.Y.length == 1);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.Y == 'output');
                dev.abits = cell.connections.A.length;
                dev.bits = cell.connections.Y.length;
                dev.rdports = [{}];
                dev.wrports = [];
                dev.memdata = cell.parameters.LUT.split('').reverse();
                assert(dev.memdata.length == Math.pow(2, dev.abits));

                // Rewrite cell connections to be $mem compatible for port mapping
                cell.connections.RD_ADDR = cell.connections.A;
                cell.connections.RD_DATA = cell.connections.Y;
                delete cell.connections.A;
                delete cell.connections.Y;
                break;
            default:
        }
        if (dev.type == 'Dff') {
            // find register initial value, if exists
            // Yosys puts initial values in net attributes; there can be many for single actual net!
            const nms = netnames.get(cell.connections.Q);
            if (nms !== undefined) {
                for (const nm of nms) {
                    if (mod.netnames[nm].attributes.init !== undefined)
                        dev.initial = decode_json_constant(mod.netnames[nm].attributes.init, dev.bits);
                }
            }
        }
        const portmap = portmaps[cell.type];
        if (portmap) connect_device(dname, cell, portmap);
        else if (cell.type == '$pmux') connect_pmux(dname, cell);
        else if (cell.type == '$mem') connect_mem(dname, cell, dev);
        else if (cell.type == '$mem_v2') connect_mem(dname, cell, dev);
        else if (cell.type == '$lut') connect_mem(dname, cell, dev);
        else throw Error('Invalid cell type: ' + cell.type);
    }
    // Group bits into nets for complex sources
    for (const [nbits, net] of nets.entries()) {
        if (net.source !== undefined) continue;
        const groups: Net[] = [[]];
        let pbitinfo: BitInfo | 'const' | undefined = undefined;
        for (const bit of nbits) {
            let bitinfo: BitInfo | 'const' = bits.get(bit);
            if (bitinfo == undefined && constbit(bit))
                bitinfo = 'const';
            if (groups.slice(-1)[0].length > 0 && 
                   (typeof bitinfo != typeof pbitinfo ||
                        typeof bitinfo == 'object' &&
                        typeof pbitinfo == 'object' &&
                            (bitinfo.id != pbitinfo.id ||
                             bitinfo.port != pbitinfo.port ||
                             bitinfo.num != pbitinfo.num + 1))) {
                groups.push([]);
            }
            groups.slice(-1)[0].push(bit);
            pbitinfo = bitinfo;
        }
        if (groups.length == 1) continue;
        if (groups.slice(-1)[0].every(x => x == '0')) {
            // infer zero-extend
            const ilen = nbits.length - groups.slice(-1)[0].length;
            const dname = add_device({
                type: 'ZeroExtend',
                extend: { output: nbits.length, input: ilen }
            });
            const zbits = nbits.slice(0, ilen);
            add_net_source(nbits, dname, 'out');
            add_net_target(zbits, dname, 'in');
            if (groups.length > 2)
                add_busgroup(zbits, groups.slice(0, groups.length - 1));
        } else add_busgroup(nbits, groups);
    }
    // Add constants
    for (const [nbits, net] of nets.entries()) {
        if (net.source !== undefined) continue;
        if (!nbits.every(constbit))
            continue;
        const dname = add_device({
//            label: String(val), // TODO
            type: 'Constant',
            constant: nbits.slice().reverse().join('')
        });
        add_net_source(nbits, dname, 'out');
    }
    // Select bits from complex targets
    for (const [nbits, net] of nets.entries()) {
        if (net.source !== undefined) continue;
        // constants should be already handled!
        assert(nbits.every(x => x > 1));
        const bitinfos = nbits.map(x => bits.get(x));
        if (!bitinfos.every(x => typeof x == 'object'))
            continue; // ignore not fully driven ports
        // complex sources should be already handled!
        assert(bitinfos.every(info => info.id == bitinfos[0].id &&
                                      info.port == bitinfos[0].port));
        const cconn = devnets.get(bitinfos[0].id).get(bitinfos[0].port);
        const dname = add_device({
            type: 'BusSlice',
            slice: {
                first: bitinfos[0].num,
                count: bitinfos.length,
                total: cconn.length
            }
        });
        add_net_source(nbits, dname, 'out');
        add_net_target(cconn, dname, 'in');
    }
    // Generate connections between devices
    for (const [nbits, net] of nets.entries()) {
        if (net.source === undefined) {
            console.warn('Undriven net in ' + name + ': ' + nbits);
            continue;
        }
        let first = true;
        for (const target in net.targets) {
            const conn: Digitaljs.Connector = {
                to: net.targets[target],
                from: net.source
            };
            if (net.name) conn.name = net.name;
            if (net.source_positions) conn.source_positions = net.source_positions;
            if (!first && mout.devices[conn.from.id].type == "Constant") {
                // replicate constants for better clarity
                const dname = add_device({
                    type: 'Constant',
                    constant: mout.devices[conn.from.id].constant
                });
                conn.from = {id: dname, port: 'out'};
            }
            mout.connectors.push(conn);
            first = false;
        }
    }
    return mout;
}

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

export function yosys2digitaljs(obj: Yosys.Output, options: ConvertOptions = {}): Digitaljs.TopModule {
    const portmaps = order_ports(obj);
    const out = yosys_to_digitaljs(obj, portmaps, options);
    const toporder = topsort(module_deps(obj));
    toporder.pop();
    const toplevel = toporder.pop();
    const output: Digitaljs.TopModule = { subcircuits: {}, ... out[toplevel] };
    for (const x of toporder)
        output.subcircuits[x] = out[x];
    return output;
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

export function io_ui(output: Digitaljs.Module) {
    for (const [name, dev] of Object.entries(output.devices)) {
        if (dev.type == 'Input' || dev.type == 'Output') {
            dev.label = dev.net;
        }
        // use clock for clocky named inputs
        if (dev.type == 'Input' && dev.bits == 1 && (dev.label == 'clk' || dev.label == 'clock')) {
            dev.type = 'Clock';
            dev.propagation = 100;
        }
        if (dev.type == 'Input')
            dev.type = dev.bits == 1 ? 'Button' : 'NumEntry';
        if (dev.type == 'Output') {
            if (dev.bits == 1)
                dev.type = 'Lamp';
            else if (dev.bits == 8 && (dev.label == 'display7' || dev.label.startsWith('display7_')))
                dev.type = 'Display7';
            else
                dev.type = 'NumDisplay';
        }
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

