'use strict';

const request = require('request');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync("./config.json"));
let athleticUserPool = [];
let entertainUserPool = [];

let getUserConfig = function(user, callback) {
    // HTTP GET 抓取数据。
    // 原 HTTP POST 抓取数据保留
    let address = config.arena.address;
    // let ak = config.arena.ak;
    request.get(address + user.username, function (err, res, body) {
        if (res.statusCode != 200)
        {
            console.log ("failed to load user data for #{user}");
        }
        else
        {
            callback(JSON.parse(body));
        }
    });
    /*
    request.post(address, {form:{ ak, username: user.username, password: user.password }}, function (err, res, body) {
        callback();
    });
    */
};


// TrueSkill
// 参考于 https://zh.wikipedia.org/zh-hans/TrueSkill评分系统

let athleticTrueSkillMatchPoint = function (userA, userB) {
    let trueSkillA = userA.trueskill;
    let trueSkillB = userB.trueskill;
    let b2 = (Math.pow(trueSkillA.variance, 2) + Math.pow(trueSkillB.variance, 2)) / 2;
    let c2 = 2 * b2 + trueSkillA.mean * trueSkillA.mean + trueSkillB.mean * trueSkillB.mean;
    return Math.exp(-Math.pow((trueSkillA.mean - trueSkillB.mean), 2) / 2 / c2) * Math.sqrt(2 * b2 / c2)
};

// 刷新竞技玩家池
let updateAthleticMatch = function() {
    let length = athleticUserPool.length;
    // 数量少于 2，什么都不做
    if (length < 2) return;
    // 生成对称表
    let values = [];
    for (let i = 0; i < length; i++)
        for (let j = 0; j < length; j++)
            if (i === j)
                values[length * j + i] = { i, j, value: 0 };
            else
                values[length * j + i] = { i, j, value: athleticTrueSkillMatchPoint(athleticUserPool[i].data, athleticUserPool[j].data) };
    // 含参排序
    values.sort((a, b) => b.value - a.value);
    // 生成 mask 表
    let masks = [];
    for (let i = 0; i < length; i++)
        masks[i] = false;
    // 开始返回
    for (let value of values) {
        if (value.value < config.match.gate)
            break;
        if (masks[value.i] || masks[value.j])
            continue;
        pair(athleticUserPool[value.i].client, athleticUserPool[value.j].client);
        masks[i] = true;
        masks[j] = true;
    }
    // 移除用户
    let newPool = [];
    for (let i = 0; i < masks.length; i++)
        if (!(masks[i]))
            newPool.push(athleticUserPool[i]);
    athleticUserPool = newPool;
};

// 刷新娱乐玩家池
let updateEntertainMatch = function () {
    let length = entertainUserPool.length;
    if (length < 2) return;
    // 根据用户等级进行排序
    entertainUserPool.sort((a, b) => b.level - a.level);
    // 从高到低进行贪心配对
    let newPool = [];
    // TODO: 加入时间分界
    for (let i = 0; i < length; i++)
    {
        let userA = entertainUserPool[i];
        let userB = entertainUserPool[i + 1];
        // 移出边界时的处理
        if (userA === undefined)
            break;
        if (userB === undefined)
        {
            newPool.push(userA);
            break;
        }
        // 若 exp 之差小于门限，则匹配房间
        if (userA.data.exp - userB.data.exp < config.match.entertainExpGate)
        {
            pair(userA.client, userB.client);
            i += 1;
        }
        // 否则留存
        else
            newPool.add(userA);
    }
    entertainUserPool = newPool;
};

let update = function () {
    updateAthleticMatch();
    updateEntertainMatch();
};

// 为两名玩家匹配房间
let pair = function (userARes, userBRes) {
    let servers = config.servers;
    let server = servers[Math.floor(Math.random() * servers.length)];
    let room_id = crypto.randomBytes(9).toString('base64').slice(0, 11).replace('+', '-').replace('/', '_');
    let options_buffer = new Buffer(6);
    options_buffer.writeUInt8(4 << 4, 1);
    let checksum = 0;
    for (let i = 1; i < options_buffer.length; i++) {
        checksum -= options_buffer.readUInt8(i)
    }
    options_buffer.writeUInt8(checksum & 0xFF, 0);
    for (let client of [userARes, userBRes])
    {
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
        console.log(userARes.username + " and " + userBRes.username + " matched on room " + room_id);
        client.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'});
        client.end(result);
    }
};

// 创建服务器
http.createServer((req, res) => {
    try
    {
        // 读取数据
        let credentials = new Buffer(req.headers['authorization'].split(' ')[1], 'base64').toString().split(':');
        let username = credentials[0];
        let password = credentials[1];
        if (!username || !password) {
            throw 'auth';
        }
        console.log(username + ' apply for a match.');
        res.username = username;
        res.password = password;
        // 送读取数据
        getUserConfig(res, (ans) => {
            athleticUserPool.push({client: res, data: ans});
        });
    }
    catch (error)
    {
        res.statusCode = 403;
        res.end();
        return;
    }

});

setInterval(update, config.match.timeInterval);

getUserConfig({username: "userA"}, (ans) => {
    entertainUserPool.push({client: {}, data: ans});
});
getUserConfig({username: "userB"}, (ans) => {
    entertainUserPool.push({client: {}, data: ans});
});
