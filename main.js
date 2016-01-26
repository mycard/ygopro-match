/**
 * Created by zh99998 on 16/1/25.
 */
const http = require('http');
const crypto = require('crypto');

// Create an HTTP tunneling proxy

var servers = [{
    "address": "122.0.65.73",
    "port": 233
}];

var pending = null;
http.createServer((req, res) => {
    try {
        var credentials = new Buffer(req.headers['authorization'].split(' ')[1], 'base64').toString().split(':');
        var username = credentials[0];
        var password = credentials[1];
        if (!username || !password) {
            throw 'auth';
        }
        //TODO: Auth
        console.log(username + ' requested match.');
    } catch (error) {
        res.statusCode = 403;
        res.end();
        return;
    }

    if (pending) {
        var server = servers[Math.floor(Math.random() * servers.length)];
        var result = JSON.stringify({
            "address": server.address,
            "port": server.port,
            "password": crypto.randomBytes(12).toString('base64')
        });

        for (var client of [res, pending]) {
            client.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'});
            client.end(result)
        }
        pending = null;
        console.log('matched ' + result);

    } else {
        pending = res;
        res.on('close', ()=> {
            console.log('connection closed.')
            if (pending == res) {
                pending = null;
            }
        })
    }
}).listen(3001);