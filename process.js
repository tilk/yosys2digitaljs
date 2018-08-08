#!/usr/bin/node
"use strict";

const assert = require('assert');
const topsort = require('topsort');
const fs = require('fs');
const dagre = require('dagre');
const HashMap = require('hashmap');

const header = `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html;charset=UTF-8" />
    <script type="text/javascript" src="main.js"></script>
    <title></title>
  </head>
  <body>`;

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
    const out = {};
    ['$and', '$or', '$xor', '$xnor',
     '$add', '$sub', '$mul', '$div', '$mod', '$pow'].forEach((nm) => out[nm] = binmap);
    ['$not', '$neg', '$pos', '$reduce_and', '$reduce_or', '$reduce_xor',
     '$reduce_xnor', '$reduce_bool', '$logic_not'].forEach((nm) => out[nm] = unmap);
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

function yosys_to_simcir(data, portmaps) {
    const out = {};
    for (const [name, mod] of Object.entries(data.modules)) {
        out[name] = yosys_to_simcir_mod(mod);
    }
    return out
}

function yosys_to_simcir_mod(mod) {
    function constbit(bit) {
        return bit == '0' || bit == '1' || bit == 'x';
    }
    const nets = new HashMap();
    const bits = new Map();
    const devnets = new Map();
    let n = 0;
    function gen_name() {
        const nm =  'dev' + n++;
        devnets.set(nm, new Map());
        return nm;
    }
    function get_net(k) {
        // create net if does not exist yet
        if (!nets.has(k))
            nets.set(k, {source: undefined, targets: []});
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
        const portmap = portmaps[cell.type];
        const dev = {
            label: cname,
            celltype: cell.type
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
        switch (cell.type) {
            case '$neg': case '$pos':
                assert(cell.connections.A.length == cell.parameters.A_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.Y_WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.Y == 'output');
                dev.bits = {
                    in: cell.connections.A.length,
                    out: cell.connections.Y.length
                };
                dev.signed = Boolean(cell.parameters.A_SIGNED);
                break;
            case '$not':
                assert(cell.connections.A.length == cell.parameters.A_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.Y_WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.Y == 'output');
                match_port(cell.connections.A, cell.parameters.A_SIGNED, cell.connections.Y.length);
                dev.bits = cell.connections.Y.length;
                break;
            case '$add': case '$sub': case '$mul': case '$div': case '$mod': case '$pow':
                assert(cell.connections.A.length == cell.parameters.A_WIDTH);
                assert(cell.connections.B.length == cell.parameters.B_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.Y_WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.Y == 'output');
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
                assert(cell.connections.A.length == cell.parameters.A_WIDTH);
                assert(cell.connections.B.length == cell.parameters.B_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.Y_WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.B == 'input');
                assert(cell.port_directions.Y == 'output');
                match_port(cell.connections.A, cell.parameters.A_SIGNED, cell.connections.Y.length);
                match_port(cell.connections.B, cell.parameters.B_SIGNED, cell.connections.Y.length);
                dev.bits = cell.connections.Y.length;
                break;
            case '$reduce_and': case '$reduce_or': case '$reduce_xor': case '$reduce_xnor':
                assert(cell.connections.A.length == cell.parameters.A_WIDTH);
                assert(cell.connections.Y.length == cell.parameters.Y_WIDTH);
                assert(cell.port_directions.A == 'input');
                assert(cell.port_directions.Y == 'output');
                dev.bits = cell.connections.A.length;
                zero_extend_output(cell.connections.Y);
                break;
            default:
                //throw Error('Invalid cell type: ' + cell.type);
        }
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
        const val = nbits.map(x => x == '1' ? 1 : x == '0' ? -1 : 0);
        const dname = add_device({
//            label: String(val), // TODO
            celltype: '$constant',
            constant: val
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
    // Generate connections between devices
    for (const [nbits, net] of nets.entries()) {
        if (net.source === undefined) {
            console.warn('Undriven net: ' + nbits);
            continue;
        }
        for (const target in net.targets)
            mout.connectors.push({to: net.targets[target], from: net.source});
    }
    return mout;
}

function layout_circuit(circ) {
    const g = new dagre.graphlib.Graph();
    const devmap = {};
    let maxx = 0, maxy = 0;

    g.setGraph({rankdir: 'RL'});
    g.setDefaultEdgeLabel(function() { return {}; });

    for (const dev of circ.devices) {
        g.setNode(dev.id, {
            id: dev.id,
            width: 32,
            height: 32
        });
        devmap[dev.id] = dev;
    }

    for (const conn of circ.connectors) {
        g.setEdge(conn.from.id, conn.to.id);
    }

    dagre.layout(g);

    for (const nname of g.nodes()) {
        const node = g.node(nname);
        devmap[node.id].x = node.x;
        devmap[node.id].y = node.y;
        maxx = Math.max(maxx, node.x);
        maxy = Math.max(maxy, node.y);
        //console.log(nname + ":" + JSON.stringify(node));
    }

    circ.width = maxx + 256;
    circ.height = maxy + 64;
}

function layout_circuits(circs) {
    for (const name in circs) {
        layout_circuit(circs[name]);
    }
}

let obj = JSON.parse(fs.readFileSync('output.json', 'utf8'));
let portmaps = order_ports(obj);
let out = yosys_to_simcir(obj, portmaps);
//layout_circuits(out);
let toporder = topsort(module_deps(obj));
toporder.pop();
let toplevel = toporder.pop();
let output = out[toplevel];
for (const [name, dev] of Object.entries(output.devices)) {
    if (dev.celltype == '$input')
        dev.celltype = dev.bits == 1 ? '$button' : '$numentry';
    if (dev.celltype == '$output')
        dev.celltype = dev.bits == 1 ? '$lamp' : '$numdisplay';
}
output.subcircuits = {};
for (const x of toporder) output.subcircuits[x] = out[x];
console.log(header);
console.log('<div id="paper"></div><script>const circuit = new digitaljs.Circuit(');
console.log(JSON.stringify(out[toplevel], null, 2));
console.log(');const paper = circuit.displayOn($(\'#paper\'));</script></body></html>');

