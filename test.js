/*
request = require('request');

request.get("http://www.baidu.com", function (err, res, body) {
    console.log(err);
    console.log(res);
});
*/
const fs = require('fs');
const request = require('request');
const config = JSON.parse(fs.readFileSync("./config.json"));
request.get("http://mycard.moe/ygopro/arena/index.php/Home/query?username=userB", function (err, res, body) {
    console.log(err);
    console.log(body);
});
