#!/usr/bin/node
"use strict";

function assert(){} // TODO

function yosys_to_simcir(data) {
    let n = 0;
    function gen_name() {
        return 'dev' + n++;
    }
    let out = {};
    for (const name in data.modules) {
        let nets = {};
        function get_net(k) {
            if (!(k in nets))
                nets[k] = {source: undefined, targets: []};
            return nets[k];
        }
        function add_net_source(k, d, p) {
            let net = get_net(k);
            assert(net.source === undefined);
            net.source = d+'.'+p;
        }
        function add_net_target(k, d, p) {
            let net = get_net(k);
            net.targets.push(d+'.'+p);
        }
        const mod = data.modules[name];
        out.width = 800;
        out.height = 500;
        out.devices = [];
        out.connectors = [];
        for (const pname in mod.ports) {
            const port = mod.ports[pname];
            const dname = gen_name();
            let dev = {
                id: dname,
                x: 0,
                y: 0,
                label: pname
            };
            assert(port.bits.length == 1);
            switch (port.direction) {
                case 'input':
                    dev.type = 'In';
                    add_net_source(port.bits[0], dname, 'out0');
                    break;
                case 'output':
                    dev.type = 'Out';
                    add_net_target(port.bits[0], dname, 'in0');
                    break;
                default: throw Error('Invalid port direction: ' + port.direction);
            }
            out.devices.push(dev);
        }
        for (const cname in mod.cells) {
            const cell = mod.cells[cname];
            const dname = gen_name();
            let dev = {
                id: dname,
                x: 0,
                y: 0,
                label: cname
            };
            switch (cell.type) {
                case '$and': dev.type = 'AND'; break;
                case '$xor': dev.type = 'XOR'; break;
                default: throw Error('Invalid cell type: ' + cell.type);
            }
            switch (cell.type) {
                case '$and': case '$xor':
                    assert(cell.connections.A.length == 1);
                    assert(cell.connections.B.length == 1);
                    assert(cell.connections.Y.length == 1);
                    add_net_target(cell.connections.A[0], dname, "in0");
                    add_net_target(cell.connections.B[0], dname, "in1");
                    add_net_source(cell.connections.Y[0], dname, "out0");
                    break;
                default: throw Error('Invalid cell type: ' + cell.type);
            }
            out.devices.push(dev);
        }
        for (const nnum in nets) {
            const net = nets[nnum];
            for (const target in net.targets)
                out.connectors.push({from: net.targets[target], to: net.source});
        }
    }
    return out
}

let fs = require('fs');
let obj = JSON.parse(fs.readFileSync('output.json', 'utf8'));
let out = yosys_to_simcir(obj);
console.log(JSON.stringify(out, null, 2));

