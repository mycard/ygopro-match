http = require("http")
url  = require("url")
_    = require("underscore")
settings = require("./config")

room_index = 0
waiting = []
server = http.createServer (request, response)->
  console.log "#{new Date()} Received request for #{request.url} from #{request.connection.remoteAddress})"

  if url.parse(request.url).pathname != '/match.json'
    response.writeHead(404);
    response.end();
    return

  response.writeHead(200, {"Content-Type": "application/json"})
  if waiting.length == 0
    waiting.push response
    request.connection.addListener 'close', ->
      index = waiting.indexOf(response);
      if index != -1
        waiting.splice(response, 1);
        console.log "#{new Date()} Peer #{request.connection.remoteAddress} disconnected during waiting."
    response.connection.setTimeout(0)
  else
    s = settings.servers[0]
    room = "mycard://#{s.ip}:#{s.port}/M##{room_index}$#{Math.floor(Math.random()*1000)}"   #new Buffer("Hello World").toString('base64'));
    console.log "matched: #{room}"
    opponent_response = waiting.pop()
    opponent_response.end room
    response.end room
    room_index = room_index + 1 % 100000



.listen(settings.port)
