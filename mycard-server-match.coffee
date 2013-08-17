http = require("http")
url  = require("url")
_    = require("underscore")
spawn = require('child_process').spawn
freeport = require('freeport')
settings = require("./config.json")

waiting = []
rooms = {}
server = http.createServer (request, response)->
  console.log "#{new Date()} Received request for #{request.url} from #{request.connection.remoteAddress})"

  if url.parse(request.url).pathname != '/match.json'
    response.writeHead(404);
    response.end();
    return

  if waiting.length == 0
    waiting.push response
    request.connection.addListener 'close', ->
      index = waiting.indexOf(response);
      if index != -1
        waiting.splice(response, 1);
        console.log "#{new Date()} Peer #{request.connection.remoteAddress} disconnected during waiting."
    response.connection.setTimeout(0)
  else
    opponent_response = waiting.pop()

    freeport (err, port)->
      if(err)
        response.writeHead(500)
        response.end err
        opponent_response.writeHead(500)
        opponent_response.end err
      else
        room = spawn './ygopro', [port, 0, 0, 1, 'F', 'F', 'F', 8000, 5, 1], cwd: 'ygocore'#, detached: true
        room.on 'exit', (code)->
          console.log "room #{port} exited with code #{code}"
        response.writeHead(200, {"Content-Type": "application/json"})
        room = "mycard://#{settings.ip}:#{port}/"
        console.log "matched: #{room}"
        opponent_response.end room
        response.end room
.listen(settings.port)
