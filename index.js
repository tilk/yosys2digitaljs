#!/usr/bin/env node
"use strict";

const tmp = require('tmp-promise');
const child_process = require('child_process');
const assert = require('assert');
const topsort = require('topsort');
const fs = require('fs');
const sanitize = require("sanitize-filename");
const path = require('path');
const HashMap = require('hashmap');
const bigInt = require('big-integer');
const {promisify} = require('util');

const ltr2bit = {
    '1': 1,
    'x': 0,
    '0': -1
};

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
    ['$reduce_bool', '$reduce_or'],
    ['$eqx', '$eq'],
    ['$nex', '$ne'],
    ['$sshl', '$shl'],
    ['$sshr', '$shr'],
    ['$shift', '$shr'],
    ['$shiftx', '$shr'],
    ['$logic_and', '$and'],
    ['$logic_or', '$or'],
    ['$dffe', '$dff'],
    ['$adff', '$dff'],
    ['$dlatch', '$dff']]);

function chunkArray(a, chunk_size){
    let results = [];
	let ca = a.splice();
    
    while (ca.length) {
        results.push(ca.splice(0, chunk_size));
    }
    
    return results;
}

function module_deps(data) {
    const out = [];
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

function order_ports(data) {
    const unmap = {A: 'in', Y: 'out'};
    const binmap = {A: 'in1', B: 'in2', Y: 'out'};
    const out = {
        '$mux': {A: 'in0', B: 'in1', S: 'sel', Y: 'out'},
        '$dff': {CLK: 'clk', D: 'in', Q: 'out'},
        '$dffe': {CLK: 'clk', EN: 'en', D: 'in', Q: 'out'},
        '$adff': {CLK: 'clk', ARST: 'arst', D: 'in', Q: 'out'},
        '$dlatch': {EN: 'en', D: 'in', Q: 'out'},
    };
    binary_gates.forEach((nm) => out[nm] = binmap);
    unary_gates.forEach((nm) => out[nm] = unmap);
    for (const [name, mod] of Object.entries(data.modules)) {
        const portmap = {};
        const ins = [], outs = [];
        for (const pname in mod.ports) {
            portmap[pname] = pname;
        }
        out[name] = portmap;
    }
    return out;
}

function decode_json_bigint(param) {
    if (typeof param == 'string')
        return bigInt(param, 2)
    else if (typeof param == 'number')
        return bigInt(param)
    else assert(false);
}

function decode_json_bigint_as_array(param) {
    return decode_json_bigint(param).toArray(2).value;
}

function yosys_to_simcir(data, portmaps) {
    const out = {};
    for (const [name, mod] of Object.entries(data.modules)) {
        out[name] = yosys_to_simcir_mod(name, mod, portmaps);
    }
    return out
}

function yosys_to_simcir_mod(name, mod, portmaps) {
    function constbit(bit) {
        return bit == '0' || bit == '1' || bit == 'x';
    }
    const nets = new HashMap();
    const bits = new Map();
    const devnets = new Map();
    let n = 0, pn = 0;
    function gen_name() {
        const nm = 'dev' + n++;
        devnets.set(nm, new Map());
        return nm;
    }
    function gen_bitname() {
        return 'bit' + pn++;
    }
    function get_net(k) {
        // create net if does not exist yet
        if (!nets.has(k))
            nets.set(k, {source: undefined, targets: [], name: undefined});
        return nets.get(k);
    }
    function add_net_source(k, d, p, primary) {
        const net = get_net(k);
        assert(net.source === undefined);
        net.source = { id: d, port: p };
        if (primary) for (const [nbit, bit] of k.entries()) {
            bits.set(bit, { id: d, port: p, num: nbit });
        }
        devnets.get(d).set(p, k);
    }
    function add_net_target(k, d, p) {
        const net = get_net(k);
        net.targets.push({ id: d, port: p });
        devnets.get(d).set(p, k);
    }
    const mout = {
        devices: {},
        connectors: []
    }
    function add_device(dev) {
        const dname = gen_name();
        mout.devices[dname] = dev;
        return dname;
    }
    function add_busgroup(nbits, groups) {
        const dname = add_device({
            celltype: '$busgroup',
            groups: groups.map(g => g.length)
        });
        add_net_source(nbits, dname, 'out');
        for (const [gn, group] of groups.entries()) {
            add_net_target(group, dname, 'in' + gn);
        }
    }
    function connect_device(dname, cell, portmap) {
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
    function connect_pmux(dname, cell) {
        add_net_target(cell.connections.A, dname, 'in0');
        add_net_target(cell.connections.S.slice().reverse(), dname, 'sel');
        add_net_source(cell.connections.Y, dname, 'out', true);
        for (const i of Array(cell.parameters.S_WIDTH).keys()) {
            const p = (cell.parameters.S_WIDTH-i-1) * cell.parameters.WIDTH;
            add_net_target(cell.connections.B.slice(p, p + cell.parameters.WIDTH),
                dname, 'in' + (i+1));
        }
    }
    function connect_mem(dname, cell, dev) {
        for (const [k, port] of dev.rdports.entries()) {
            const portname = "rd" + k;
            add_net_target(cell.connections.RD_ADDR.slice(dev.abits * k, dev.abits * (k+1)),
                dname, portname + "addr");
            add_net_source(cell.connections.RD_DATA.slice(dev.bits * k, dev.bits * (k+1)),
                dname, portname + "data");
            if ('clock_polarity' in port)
                add_net_target([cell.connections.RD_CLK[k]], dname, portname + "clk");
            if ('enable_polarity' in port)
                add_net_target([cell.connections.RD_EN[k]], dname, portname + "en");
        }
        for (const [k, port] of dev.wrports.entries()) {
            const portname = "wr" + k;
            add_net_target(cell.connections.WR_ADDR.slice(dev.abits * k, dev.abits * (k+1)),
                dname, portname + "addr");
            add_net_target(cell.connections.WR_DATA.slice(dev.bits * k, dev.bits * (k+1)),
                dname, portname + "data");
            if ('clock_polarity' in port)
                add_net_target([cell.connections.WR_CLK[k]], dname, portname + "clk");
            if ('enable_polarity' in port)
                add_net_target(cell.connections.WR_EN.slice(dev.bits * k, dev.bits * (k+1)),
                    dname, portname + "en");
        }
    }
    // Add inputs/outputs
    for (const [pname, port] of Object.entries(mod.ports)) {
        const dname = add_device({
            celltype: '$' + port.direction,
            label: pname,
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
        const dev = {
            label: cname,
            celltype: gate_subst.has(cell.type) ? gate_subst.get(cell.type) : cell.type
        };
        const dname = add_device(dev);
        function match_port(con, sig, sz) {
            if (con.length > sz)
                con.splice(sz);
            else if (con.length < sz) {
                const ccon = con.slice();
                const pad = sig ? con.slice(-1)[0] : '0';
                con.splice(con.length, 0, ...Array(sz - con.length).fill(pad));
                const extname = add_device({
                    celltype: sig ? '$signextend' : '$zeroextend',
                    extend: { input: ccon.length, output: con.length }
                });
                add_net_target(ccon, extname, 'in');
                add_net_source(con, extname, 'out');
            }
        }
        function zero_extend_output(con) {
            if (con.length > 1) {
                const ccon = con.slice();
                con.splice(1);
                const extname = add_device({
                    celltype: '$zeroextend',
                    extend: { input: con.length, output: ccon.length }
                });
                add_net_source(ccon, extname, 'out');
                add_net_target(con, extname, 'in');
            }
        }
        if (unary_gates.has(cell.type)) {
                assert(cell.connections.A.length == cell.parameters.A_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.Y_WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.Y == 'output');
        }
        if (binary_gates.has(cell.type)) {
                assert(cell.connections.A.length == cell.parameters.A_WIDTH);
                assert(cell.connections.B.length == cell.parameters.B_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.Y_WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.Y == 'output');
        }
        if (['$dff', '$dffe', '$adff', '$dlatch'].includes(cell.type)) {
            assert(cell.connections.D.length == cell.parameters.WIDTH);
            assert(cell.connections.Q.length == cell.parameters.WIDTH);
            assert(cell.port_directions.D == 'input');
            assert(cell.port_directions.Q == 'output');
            if (cell.type != '$dlatch') {
                assert(cell.connections.CLK.length == 1);
                assert(cell.port_directions.CLK == 'input');
            }
        }
        switch (cell.type) {
            case '$neg': case '$pos':
                dev.bits = {
                    in: cell.connections.A.length,
                    out: cell.connections.Y.length
                };
                dev.signed = Boolean(cell.parameters.A_SIGNED);
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
                    in1: Boolean(cell.parameters.A_SIGNED),
                    in2: Boolean(cell.parameters.B_SIGNED)
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
                break;
            case '$eq': case '$ne': case '$lt': case '$le': case 'gt': case 'ge':
            case '$eqx': case '$nex':
                dev.bits = {
                    in1: cell.connections.A.length,
                    in2: cell.connections.B.length
                };
                dev.signed = {
                    in1: Boolean(cell.parameters.A_SIGNED),
                    in2: Boolean(cell.parameters.B_SIGNED)
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
                    in1: Boolean(cell.parameters.A_SIGNED),
                    in2: Boolean(cell.parameters.B_SIGNED && ['$shift', '$shiftx'].includes(cell.type)),
                    out: Boolean(cell.parameters.A_SIGNED && ['$sshl', '$sshr'].includes(cell.type))
                };
                dev.fillx = cell.type == '$shiftx';
                break;
            case '$logic_and': case '$logic_or': {
                function reduce_input(con) {
                    const ccon = con.slice();
                    con.splice(0, con.length, gen_bitname());
                    const extname = add_device({
                        celltype: '$reduce_or',
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
                assert(cell.connections.A.length == cell.parameters.WIDTH);
                assert(cell.connections.B.length == cell.parameters.WIDTH);
                assert(cell.connections.Y.length == cell.parameters.WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.Y == 'output');
                dev.bits = {
                    in: cell.parameters.WIDTH,
                    sel: 1
                };
                break;
            case '$pmux':
                assert(cell.connections.B.length == cell.parameters.WIDTH * cell.parameters.S_WIDTH);
                assert(cell.connections.A.length == cell.parameters.WIDTH);
                assert(cell.connections.S.length == cell.parameters.S_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.S == 'input');
                assert(cell.port_directions.Y == 'output');
                dev.bits = {
                    in: cell.parameters.WIDTH,
                    sel: cell.parameters.S_WIDTH
                };
                break;
            case '$dff':
                dev.bits = cell.parameters.WIDTH;
                dev.polarity = {
                    clock: Boolean(cell.parameters.CLK_POLARITY)
                };
                break;
            case '$dffe':
                assert(cell.connections.EN.length == 1);
                assert(cell.port_directions.EN == 'input');
                dev.bits = cell.parameters.WIDTH;
                dev.polarity = {
                    clock: Boolean(cell.parameters.CLK_POLARITY),
                    enable: Boolean(cell.parameters.EN_POLARITY)
                };
                break;
            case '$adff':
                assert(cell.connections.ARST.length == 1);
                assert(cell.port_directions.ARST == 'input');
                dev.bits = cell.parameters.WIDTH;
                dev.polarity = {
                    clock: Boolean(cell.parameters.CLK_POLARITY),
                    arst: Boolean(cell.parameters.ARST_POLARITY)
                };
                dev.arst_value = typeof(cell.parameters.ARST_VALUE) == 'number'
                    ? bigInt(cell.parameters.ARST_VALUE).toArray(2).value.map(String).reverse()
                        .concat(Array(dev.bits).fill('0')).slice(0, dev.bits).reverse().join('')
                    : cell.parameters.ARST_VALUE;
                break;
            case '$dlatch':
                assert(cell.connections.EN.length == 1);
                assert(cell.port_directions.EN == 'input');
                dev.bits = cell.parameters.WIDTH;
                dev.polarity = {
                    enable: Boolean(cell.parameters.EN_POLARITY)
                };
                break;
            case '$mem': {
                assert(cell.connections.RD_EN.length == cell.parameters.RD_PORTS);
                assert(cell.connections.RD_CLK.length == cell.parameters.RD_PORTS);
                assert(cell.connections.RD_DATA.length == cell.parameters.RD_PORTS * cell.parameters.WIDTH);
                assert(cell.connections.RD_ADDR.length == cell.parameters.RD_PORTS * cell.parameters.ABITS);
                assert(cell.connections.WR_EN.length == cell.parameters.WR_PORTS * cell.parameters.WIDTH);
                assert(cell.connections.WR_CLK.length == cell.parameters.WR_PORTS);
                assert(cell.connections.WR_DATA.length == cell.parameters.WR_PORTS * cell.parameters.WIDTH);
                assert(cell.connections.WR_ADDR.length == cell.parameters.WR_PORTS * cell.parameters.ABITS);
                dev.bits = cell.parameters.WIDTH;
                dev.abits = cell.parameters.ABITS;
                dev.words = cell.parameters.SIZE;
                dev.offset = cell.parameters.OFFSET;
                dev.rdports = [];
                dev.wrports = [];
                const rdpol = decode_json_bigint_as_array(cell.parameters.RD_CLK_POLARITY).reverse();
                const rden  = decode_json_bigint_as_array(cell.parameters.RD_CLK_ENABLE).reverse();
                const rdtr  = decode_json_bigint_as_array(cell.parameters.RD_TRANSPARENT).reverse();
                const wrpol = decode_json_bigint_as_array(cell.parameters.WR_CLK_POLARITY).reverse();
                const wren  = decode_json_bigint_as_array(cell.parameters.WR_CLK_ENABLE).reverse();
                const init  = typeof(cell.parameters.INIT) == 'number'
                    ? bigInt(cell.parameters.INIT).toArray(2).value.map(String).reverse()
                    : cell.parameters.INIT.split('').reverse();
                if (cell.parameters.INIT) {
                    const l = init.slice(-1)[0] == 'x' ? 'x' : '0';
                    dev.memdata = [];
                    for (const k of Array(dev.words).keys()) {
                        const wrd = init.slice(dev.bits * k, dev.bits * (k+1));
                        while (wrd.length < dev.bits) wrd.push(l);
                        dev.memdata.push(wrd.reverse().join(''));
                    }
                }
                for (const k of Array(cell.parameters.RD_PORTS).keys()) {
                    const port = {
                    };
                    if (rden[k]) {
                        port.clock_polarity = Boolean(rdpol[k]);
                        if (cell.connections.RD_EN[k] != '1')
                            port.enable_polarity = true;
                    };
                    if (rdtr[k])
                        port.transparent = true;
                    dev.rdports.push(port);
                }
                for (const k of Array(cell.parameters.WR_PORTS).keys()) {
                    const port = {
                    };
                    if (wren[k]) {
                        port.clock_polarity = Boolean(wrpol[k]);
                        if (cell.connections.WR_EN.slice(dev.bits * k, dev.bits * (k+1))
                                .some(z => z != '1'))
                            port.enable_polarity = true;
                    };
                    dev.wrports.push(port);
                }
                break;
            }
            default:
        }
        const portmap = portmaps[cell.type];
        if (portmap) connect_device(dname, cell, portmap);
        else if (cell.type == '$pmux') connect_pmux(dname, cell);
        else if (cell.type == '$mem') connect_mem(dname, cell, dev);
        else throw Error('Invalid cell type: ' + cell.type);
    }
    // Group bits into nets for complex sources
    for (const [nbits, net] of nets.entries()) {
        if (net.source !== undefined) continue;
        const groups = [[]];
        let group = [];
        let pbitinfo = undefined;
        for (const bit of nbits) {
            let bitinfo = bits.get(bit);
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
                celltype: '$zeroextend',
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
            celltype: '$constant',
            constant: nbits.join('')
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
            celltype: '$busslice',
            slice: {
                first: bitinfos[0].num,
                count: bitinfos.length,
                total: cconn.length
            }
        });
        add_net_source(nbits, dname, 'out');
        add_net_target(cconn, dname, 'in');
    }
    // Label nets
    for (const [nname, data] of Object.entries(mod.netnames)) {
        if (data.hide_name) continue;
        const net = nets.get(data.bits);
        if (!net) continue;
        net.name = nname;
    }
    // Generate connections between devices
    for (const [nbits, net] of nets.entries()) {
        if (net.source === undefined) {
            console.warn('Undriven net in ' + name + ': ' + nbits);
            continue;
        }
        for (const target in net.targets) {
            const conn = {
                to: net.targets[target],
                from: net.source
            };
            if (net.name) conn.name = net.name;
            mout.connectors.push(conn);
        }
    }
    return mout;
}

async function process(filenames, dirname) {
    const tmpjson = await tmp.tmpName({ postfix: '.json' });
    const yosys_result = await promisify(child_process.exec)(
        'yosys -p "hierarchy; proc; fsm; memory -nomap" -o "' + tmpjson + '" ' + filenames.join(' '),
        {maxBuffer: 1000000, cwd: dirname || null});
    const obj = JSON.parse(fs.readFileSync(tmpjson, 'utf8'));
    await promisify(fs.unlink)(tmpjson);
    const portmaps = order_ports(obj);
    const out = yosys_to_simcir(obj, portmaps);
    const toporder = topsort(module_deps(obj));
    toporder.pop();
    const toplevel = toporder.pop();
    const output = out[toplevel];
    for (const [name, dev] of Object.entries(output.devices)) {
        // use clock for clocky named inputs
        if (dev.celltype == '$input' && dev.bits == 1 && (dev.label == 'clk' || dev.label == 'clock')) {
            dev.celltype = '$clock';
            dev.propagation = 100;
        }
        if (dev.celltype == '$input')
            dev.celltype = dev.bits == 1 ? '$button' : '$numentry';
        if (dev.celltype == '$output')
            dev.celltype = dev.bits == 1 ? '$lamp' : '$numdisplay';
    }
    output.subcircuits = {};
    for (const x of toporder) output.subcircuits[x] = out[x];
    return {
        status: true,
        output: output,
        yosys_stdout: yosys_result.stdout,
        yosys_stderr: yosys_result.stderr
    };
}

async function process_files(data) {
    const dir = await tmp.dir();
    const names = [];
    try {
        for (const [name, content] of Object.entries(data)) {
            const sname = sanitize(name);
            await promisify(fs.writeFile)(path.resolve(dir.path, sname), content);
            names.push(sname);
        }
        return await process(names, dir.path);
    } finally {
        for (const name of names) {
            await promisify(fs.unlink)(path.resolve(dir.path, name));
        }
        dir.cleanup();
    }
}

async function process_sv(text) {
    const tmpsv = await tmp.file({ postfix: '.sv' });
    try {
        await promisify(fs.write)(tmpsv.fd, text);
        await promisify(fs.close)(tmpsv.fd);
        return await process([tmpsv.path]);
    } finally {
        tmpsv.cleanup();
    }
}

exports.process = process;
exports.process_files = process_files;
exports.process_sv = process_sv;

