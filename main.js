'use strict';

const http = require('http');
const crypto = require('crypto');

let servers = [{
    "address": "122.0.65.73",
    "port": 7911
}];

let pending = null;
http.createServer((req, res) => {
    try {
        let credentials = new Buffer(req.headers['authorization'].split(' ')[1], 'base64').toString().split(':');
        let username = credentials[0];
        let password = credentials[1];
        if (!username || !password) {
            throw 'auth';
        }
        //TODO: Auth
        console.log(username + ' requested match.');
        res.username = username;
        res.password = password;
    } catch (error) {
        res.statusCode = 403;
        res.end();
        return;
    }

    if (pending) {
        let server = servers[Math.floor(Math.random() * servers.length)];

        let room_id = crypto.randomBytes(9).toString('base64').slice(0, 11).replace('+','-').replace('/', '_');
        let options_buffer = new Buffer(6);
        options_buffer.writeUInt8(4 << 4, 1);
        let checksum = 0;
        for (let i = 1; i < options_buffer.length; i++) {
            checksum -= options_buffer.readUInt8(i)
        }
        options_buffer.writeUInt8(checksum & 0xFF, 0);

        for (let client of [res, pending]) {
            let buffer = new Buffer(6);
            let secret = parseInt(client.password) % 65535 + 1;
            for (let i = 0; i < options_buffer.length; i += 2) {
                buffer.writeUInt16LE(options_buffer.readUInt16LE(i) ^ secret, i)
            }
            let password = buffer.toString('base64') + room_id;
            let result = JSON.stringify({
                "address": server.address,
                "port": server.port,
                "password": password
            });

            client.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'});
            client.end(result)
        }
        pending = null;
        console.log('matched ' + room_id);

    } else {
        pending = res;
        res.on('close', ()=> {
            console.log('connection closed.');
            if (pending == res) {
                pending = null;
            }
        })
    }
}).listen(80);
