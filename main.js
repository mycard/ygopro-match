'use strict';

const request = require('request');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const url = require('url');

const config = JSON.parse(fs.readFileSync("./config.json"));
let athleticUserPool = [];
let entertainUserPool = [];
let deadUserPool = [];
let playingPlayerPool = new Map();
let playingPlayerOpponents = new Map();
let playingPlayerTimeout = new Map();
let predictedEntertainTime = 600, predictedAthleticTime = 600;
let entertainRequestCountInTime = 0, athleticRequestCountInTime = 0;

let localLog = function (content) {
    console.log("[" + new Date().toLocaleString() + "] " + content)
};

let getUserConfig = function (user, callback) {
    // HTTP GET 抓取数据。
    // 原 HTTP POST 抓取数据保留
    let address = config.arena.address;
    // let ak = config.arena.ak;
    request.get(address + encodeURIComponent(user.username), function (err, res, body) {
        if (err) {
            localLog("failed to load user data for" + user.username + "for error" + err);
            // Kick out
            errorUser(user);
        }
        else if (res.statusCode !== 200) {
            try {
                localLog("failed to load user data for " + user.username + " with code " + res.statusCode);
                localLog("response: " + JSON.stringify(res) + "\nBODY: " + body);
            }
            catch (e) {

            }
            // Kick out
            errorUser(user);
        }
        else {
            try {
                let value = JSON.parse(body);
                setUserLimit(value);
                callback(value);
            }
            catch (e) {
                localLog("failed to call back user " + user.username);
                localLog(e);
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

let setUserLimit = function(data) {
    if (Array.isArray(config.match.atheleticPtGate))
        data.limit = config.match.atheleticPtGate[0];
    else if (Number.isInteger(config.match.atheleticPtGate))
        data.limit = config.match.atheleticPtGate;
    else
        data.limit = 500;
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
let updateAthleticMatch = function () {
    let length = athleticUserPool.length;
    // 数量少于 2，什么都不做
    if (length < 2) return;
    // 生成对称表
    let values = [];
    for (let i = 0; i < length; i++)
        for (let j = 0; j < length; j++)
            if (i === j)
                values[length * j + i] = {i, j, value: 0};
            else
                values[length * j + i] = {
                    i,
                    j,
                    value: athleticTrueSkillMatchPoint(athleticUserPool[i].data, athleticUserPool[j].data)
                };
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
        pair(athleticUserPool[value.i].client, athleticUserPool[value.j].client, 'athletic');
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

// 依照 PT 暂时重新计算竞技玩家池
updateAthleticMatch = function () {
    let length = athleticUserPool.length;
    if (length < 2) return;
    athleticUserPool.sort((a, b) => b.data.pt - a.data.pt);
    let newPool = [];
    for (let i = 0; i < length; i++) {
        let userA = athleticUserPool[i];
        let userB = athleticUserPool[i + 1];
        // 移出边界时的处理
        if (userA === undefined)
            break;
        if (userB === undefined) {
            newPool.push(userA);
            break;
        }
        // 若 pt 之差小于门限，则匹配房间
        let delta = userA.data.pt - userB.data.pt;
        if (delta < userA.data.limit && delta < userB.data.limit) {
            pair(userA.client, userB.client, 'athletic');
            i += 1;
        }
        // 否则留存
        else
            newPool.push(userA);
    }
    if (Array.isArray(config.match.atheleticPtGate))
        for (let user of newPool)
            user.data.limit = Math.min(user.data.limit + config.match.atheleticPtGate[1], config.match.atheleticPtGate[2])
    athleticUserPool = newPool;
};

// 刷新娱乐玩家池
let updateEntertainMatch = function () {
    let length = entertainUserPool.length;
    if (length < 2) return;
    // 根据用户等级进行排序
    entertainUserPool.sort((a, b) => b.data.exp - a.data.exp);
    // 从高到低进行贪心配对
    let newPool = [];
    // TODO: 加入时间分界
    for (let i = 0; i < length; i++) {
        let userA = entertainUserPool[i];
        let userB = entertainUserPool[i + 1];
        // 移出边界时的处理
        if (userA === undefined)
            break;
        if (userB === undefined) {
            newPool.push(userA);
            break;
        }
        // 若 exp 之差小于门限，则匹配房间
        if (userA.data.exp - userB.data.exp < config.match.entertainExpGate) {
            pair(userA.client, userB.client, 'entertain');
            i += 1;
        }
        // 否则留存
        else
            newPool.push(userA);
    }
    entertainUserPool = newPool;
};

let update = function () {
    updateAthleticMatch();
    updateEntertainMatch();
};

// 为两名玩家匹配房间
let pair = function (userARes, userBRes, serverName) {
    let servers = config.servers;
    let server = servers[serverName];
    if (Object.prototype.toString.call(server) === '[object Array]')
        server = server[Math.random() * server.length];
    let room_id = crypto.randomBytes(6).toString('base64').slice(0, 11).replace('+', '-').replace('/', '_');
    let options_buffer = new Buffer(6);
    options_buffer.writeUInt8(4 << 4, 1);
    let checksum = 0;
    for (let i = 1; i < options_buffer.length; i++) {
        checksum -= options_buffer.readUInt8(i)
    }
    options_buffer.writeUInt8(checksum & 0xFF, 0);
    localLog(userARes.username + " and " + userBRes.username + " matched on room " + room_id);
    playingPlayerOpponents.set(userARes.username, userBRes.username);
    playingPlayerOpponents.set(userBRes.username, userARes.username);
    for (let client of [userARes, userBRes]) {
        let buffer = new Buffer(6);
        let secret = parseInt(client.password) % 65535 + 1;
        for (let i = 0; i < options_buffer.length; i += 2) {
            buffer.writeUInt16LE(options_buffer.readUInt16LE(i) ^ secret, i)
        }
        let password = buffer.toString('base64') + room_id;
        let result = JSON.stringify({
            "address": server.address,
            "port": server.port,
            "password": password,
        });
        playingPlayerPool.set(client.username, result);
        playingPlayerTimeout.set(client.username, setTimeout(timeoutUser, config.match.longestMatchTime, client.username));
        client.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'});
        client.end(result);
    }
};

// 将用户加入待回池
let joinPool = function (res, data, pool) {
    // 辣鸡性能，先迁就前面的 TrueSKill 算法
    // 检查用户是否已被挂黑名单
    let index = deadUserPool.indexOf(res);
    if (index > 0) {
        localLog(res.username + " has closed the connection. Reject joining the pool.")
        deadUserPool.splice(index, 1);
        return;
    }
    // 检查用户是否已在匹配池中
    for (let i = 0; i < pool.length; i++) {
        let user = pool[i];
        if (user.client.username === res.username) {
            rejectUser(user.client);
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
let rejectUser = function (res) {
    localLog(res.username + " is kicked for over 1 client requested.");
    res.statusCode = 409;
    res.end();
};

// 当没有正确收到消息时，
let errorUser = function (res) {
    localLog(res.username + " errored for get user information.");
    res.statusCode = 400;
    res.end();
};

// 当用户断开连接时
let closedUser = function (res, pool) {
    let index = -1;
    // 查询用户是否已在匹配池中
    for (let i = 0; i < pool.length; i++)
        if (pool[i].client === res)
            index = i;
    // 若用户已在匹配池中，移除
    if (index >= 0) {
        localLog(res.username + " has closed the connection. Removed from the pool.");
        pool.splice(index, 1);
    }
    // 若用户未在匹配池中，挂黑名单
    else
        deadUserPool.push(res);
};

// 当 srvpro 通知本服务器游戏已正常结束时
let finishUser = function (json) {
    let userA = json.usernameA ? decodeURIComponent(json.usernameA) : undefiend;
    let userB = json.usernameB ? decodeURIComponent(json.usernameB) : undefined;
    if (!userA && !userB) return;
    if (!userA && playingPlayerOpponents.has(userB)) userA = playingPlayerOpponents.get(userB);
    if (!userB && playingPlayerOpponents.has(userA)) userB = playingPlayerOpponents.get(userA);
    for (let user of [userA, userB]) {
        if (!user) continue;
        if (!playingPlayerPool.delete(user))
            localLog("Unknown player left the game: " + user);
        clearTimeout(playingPlayerTimeout.get(user));
        playingPlayerTimeout.delete(user);
    }
    localLog("Player " + userA + " and " + userB + " finished the game.");
};

// 当超过时间，而 srvpro 从未通知基本服务器游戏已结束时
let timeoutUser = function(user) {
    if (playingPlayerPool.delete(user))
        localLog("With timeout, user is seen as had left the game: " + user);
    playingPlayerOpponents.delete(user);
    playingPlayerTimeout.delete(user);
};

// 计算预期时间
let calculatePredictedTime = function() {
    if (entertainRequestCountInTime === 0)
        predictedEntertainTime = 600;
    else {
        predictedEntertainTime = 600 / entertainRequestCountInTime;
        entertainRequestCountInTime = 0;
    }
    localLog("entertain adjust predicted time to " + predictedEntertainTime + "s.");
    if (athleticRequestCountInTime === 0)
        predictedAthleticTime = 600;
    else {
        predictedAthleticTime = 600 / athleticRequestCountInTime;
        athleticRequestCountInTime = 0;
    }
    localLog("athletic adjust predicted time to " + predictedAthleticTime + "s.");
};

// 匹配（POST /）
let matchResponse = function(req, res) {
    try {
        // 读取数据
        let credentials = new Buffer(req.headers['authorization'].split(' ')[1], 'base64').toString().split(':');
        let username = credentials[0];
        let password = credentials[1];
        if (!username || !password) {
            throw 'auth';
        }
        res.username = username;
        res.password = password;
        // 检定是否掉线重连
        if (playingPlayerPool.has(username)) {
            switch (config.match.reconnect) {
                case "reconnect":
                    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-cache'});
                    let message = playingPlayerPool.get(username);
                    localLog(username + " is relining to: " + message);
                    res.end(message);
                    return;
                case "drop":
                    rejectUser(res);
                    localLog(username + " is droped due to try relining.");
                    return;
                default:
                    break; // 什么都不做，继续加入匹配池。
            }
        }
        let arg = url.parse(req.url, true).query;
        if (!arg.arena) arg.arena = 'entertain';
        localLog(username + ' apply for a ' + arg.arena + ' match.');
        // 选择匹配池
        let pool = null;
        if (arg.arena === 'athletic')
            pool = athleticUserPool;
        else
            pool = entertainUserPool;
        // 如果连接断开了，把它从匹配池中移除
        res.on('close', () => {
            closedUser(res, pool);
        });
        // 送读取数据
        // 如果收到了奇怪的数据，一概认为是娱乐对局
        getUserConfig(res, (ans) => {
            joinPool(res, ans, pool);
        });
        // 统计器
        if (arg.arena === 'athletic') athleticRequestCountInTime += 1;
        else entertainRequestCountInTime += 1;
    }
    catch (error) {
        localLog(error);
        res.statusCode = 500;
        res.end();
        return;
    }
};

// 时间（GET /stats）
let getTimeResponse = function(parsedUrl, res) {
    if (parsedUrl.pathname === '/stats/entertain')
        textResponse(res, predictedEntertainTime.toString());
    else if (parsedUrl.pathname === '/stats/athletic')
        textResponse(res, predictedAthleticTime.toString());
    else
        notFoundResponse(res);
};

let textResponse = function (res, text) {
    res.statusCode = 200;
    res.contentType = 'text/plain';
    res.end(text);
};

// 结束游戏 (POST /finish）
let endUserResponse = function(req, res) {
    let form = '';
    req.on('data', (data) => form += data);
    req.on('end', function () {
        let json = {};
        let hashes = form.slice(form.indexOf('?') + 1).split('&');
        for (let i = 0; i < hashes.length; i++) {
            let hash = hashes[i].split('=');
            json[hash[0]] = hash[1];
        }
        let result = finishUser(json);
        res.statusCode = 200;
        res.end('ok');
    })
};

let notFoundResponse = function(res) {
    res.statusCode = 404;
    res.end();
};

// 创建服务器
const server = http.createServer((req, res) => {
    let parsedUrl = url.parse(req.url);
    if (req.method === 'POST' && parsedUrl.pathname === '/')
        matchResponse(req, res);
    else if (req.method === 'GET' && parsedUrl.pathname.startsWith('/stats'))
        getTimeResponse(parsedUrl, res);
    else if (req.method === 'POST' && parsedUrl.pathname.startsWith('/finish'))
        endUserResponse(req, res);
    else
        notFoundResponse(res);

});
server.timeout = 0;
server.listen(1025);

setInterval(update, config.match.timeInterval);
setInterval(calculatePredictedTime, 600000);

