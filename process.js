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
    for (const name in data.modules) {
        const mod = data.modules[name];
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
    ['$and', '$or', '$xor', '$xnor'].forEach((nm) => out[nm] = binmap);
    ['$not'].forEach((nm) => out[nm] = unmap);
    for (const name in data.modules) {
        const mod = data.modules[name];
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
    const typemap = {};
    const out = {};
    for (const name in data.modules) {
        let n = 0;
        function gen_name() {
            return 'dev' + n++;
        }
        const nets = new HashMap();
        function get_net(k) {
            if (!nets.has(k))
                nets.set(k, {source: undefined, targets: []});
            return nets.get(k);
        }
        function add_net_source(k, d, p) {
            const net = get_net(k);
            assert(net.source === undefined);
            net.source = { id: d, port: p };
        }
        function add_net_target(k, d, p) {
            const net = get_net(k);
            net.targets.push({ id: d, port: p });
        }
        const mod = data.modules[name];
        const mout = {
            devices: {},
            connectors: []
        }
        out[name] = mout;
        for (const pname in mod.ports) {
            const port = mod.ports[pname];
            const dname = gen_name();
            let dev = {
                label: pname,
                net: pname,
                order: n,
                bits: port.bits.length
            };
            switch (port.direction) {
                case 'input':
                    dev.type = '$input';
                    add_net_source(port.bits, dname, 'out');
                    break;
                case 'output':
                    dev.type = '$output';
                    add_net_target(port.bits, dname, 'in');
                    break;
                default: throw Error('Invalid port direction: ' + port.direction);
            }
            mout.devices[dname] = dev;
        }
        for (const cname in mod.cells) {
            const cell = mod.cells[cname];
            const portmap = portmaps[cell.type];
            const dname = gen_name();
            let dev = {
                label: cname
            };
            if (cell.type in typemap)
                dev.type = typemap[cell.type];
            else
                dev.type = cell.type;
            switch (cell.type) {
                case '$not':
                    assert(cell.connections.A.length == cell.connections.Y.length);
                    assert(cell.port_directions.A == 'input');
                    assert(cell.port_directions.Y == 'output');
                    dev.bits = cell.connections.Y.length;
                    break;
                case '$and': case '$or': case '$xor': case '$xnor':
                    assert(cell.connections.A.length == cell.connections.Y.length);
                    assert(cell.connections.B.length == cell.connections.Y.length);
                    assert(cell.port_directions.A == 'input');
                    assert(cell.port_directions.B == 'input');
                    assert(cell.port_directions.Y == 'output');
                    dev.bits = cell.connections.Y.length;
                    break;
                default:
                    //throw Error('Invalid cell type: ' + cell.type);
            }
            for (const pname in cell.port_directions) {
                const pdir = cell.port_directions[pname];
                const pconn = cell.connections[pname];
                switch (pdir) {
                    case 'input':
                        add_net_target(pconn, dname, portmap[pname]);
                        break;
                    case 'output':
                        add_net_source(pconn, dname, portmap[pname]);
                        break;
                    default:
                        throw Error('Invalid port direction: ' + pdir);
                }
            }
            mout.devices[dname] = dev;
        }
        for (const net of nets.values()) {
            for (const target in net.targets)
                mout.connectors.push({to: net.targets[target], from: net.source});
        }
    }
    return out
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
for (const name in output.devices) {
    const dev = output.devices[name];
    if (dev.type == '$input')
        dev.type = dev.bits == 1 ? '$button' : '$numentry';
    if (dev.type == '$output')
        dev.type = dev.bits == 1 ? '$lamp' : '$numdisplay';
}
output.subcircuits = {};
for (const x of toporder) output.subcircuits[x] = out[x];
console.log(header);
console.log('<div id="paper"></div><script>const circuit = new digitaljs.Circuit(');
console.log(JSON.stringify(out[toplevel], null, 2));
console.log(');const paper = circuit.displayOn($(\'#paper\'));</script></body></html>');

