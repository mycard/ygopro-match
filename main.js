'use strict';

const request = require('request');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const url = require('url');

const config = JSON.parse(fs.readFileSync("./config.json"));
let athleticUserPool = [];
let entertainUserPool = [];

let getUserConfig = function(user, callback) {
    // HTTP GET 抓取数据。
    // 原 HTTP POST 抓取数据保留
    let address = config.arena.address;
    // let ak = config.arena.ak;
    request.get(address + user.username, function (err, res, body) {
        if (err)
        {
            console.log ("failed to load user data for" + user + "for error" + res.error);
            // Kick out
            errorUser(user);
        }
        else if (res.statusCode != 200)
        {
            console.log ("failed to load user data for " + user + " with code " + res.statusCode);
            // Kick out
            errorUser(user);
        }
        else
        {
            try {
                let value = JSON.parse(body);
                callback(value);
            }
            catch(e)
            {
                console.log("failed to call back user " + user);
                console.log(e);
                errorUser(user);
            }
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
        masks[value.i] = true;
        masks[value.j] = true;
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
    console.log(userARes.username + " and " + userBRes.username + " matched on room " + room_id);
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
        client.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'});
        client.end(result);
    }
};

// 将用户加入待回池
let joinPool = function (res, data, pool) {
    // 辣鸡性能，先迁就前面的 TrueSKill 算法
    for(let i = 0; i < pool.length; i++)
    {
        let user = pool[i];
        if (user.client.username === res.username)
        {
            rejectUser(user.client);
            // 脏
            pool.splice(i, 1);
            i -= 1;
        }
    }
    pool.push({
        client: res,
        data: data
    });
};

// 当用户双开时，回绝之
let rejectUser = function(res) {
    console.log(res.username + " is kicked for over 1 client requested.");
    res.statusCode = 409;
    res.end();
};

// 当没有正确收到消息时，
let errorUser = function(res) {
    console.log(res.username + " errored for get user information.");
    res.statusCode = 400;
    res.end();
}

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
        let arg = url.parse(req.url, true).query;
        if (!arg.arena) arg.arena = 'entertain';
        console.log(username + ' apply for a ' + arg.arena + ' match.');
        res.username = username;
        res.password = password;
        // 送读取数据
        // 如果收到了奇怪的数据，一概认为是娱乐对局
        if (arg.arena == 'athletic')
            getUserConfig(res, (ans) => {
                joinPool(res, ans, athleticUserPool);
            });
        else
            getUserConfig(res, (ans) => {
                joinPool(res, ans, entertainUserPool);
            });
    }
    catch (error)
    {
        console.log(error);
        res.statusCode = 500;
        res.end();
        return;
    }

}).listen(1025);

setInterval(update, config.match.timeInterval);