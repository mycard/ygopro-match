http = require "http"
url  = require "url"
path = require 'path'
fs = require 'fs'
spawn = require('child_process').spawn

_    = require "underscore"
freeport = require 'freeport'
Inotify = require('inotify').Inotify
inotify = new Inotify()

settings = require "./config.json"


#match
waiting = []
rooms = {}
server = http.createServer (request, response)->
  headers = {"Access-Control-Allow-Origin":"*","Content-Type": "text/plain"}
  if request.method == 'OPTIONS'
    response.writeHead(204, headers);
    response.end();

  
  if url.parse(request.url).pathname == '/count.json'
    response.writeHead(200,headers);
    response.end(_.keys(rooms).length.toString())
    return

  if url.parse(request.url).pathname != '/match.json'
    response.writeHead(404,headers);
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
        response.writeHead(500,headers)
        response.end err
        opponent_response.writeHead(500,headers)
        opponent_response.end err
      else
        room = spawn './ygopro', [port, 0, 0, 1, 'F', 'F', 'F', 8000, 5, 1], cwd: 'ygocore'
        room.alive = true
        rooms[port] = room
        room.on 'exit', (code)->
          delete rooms[port]
          console.log "room #{port} exited with code #{code}"
        room = "mycard://#{settings.ip}:#{port}/"
        console.log "matched: #{room}"
        response.writeHead(200, headers)
        response.end room
        opponent_response.writeHead(200, headers)
        opponent_response.end room

.listen(settings.port)


inotify.addWatch
  path: 'ygocore/replay',
  watch_for: Inotify.IN_CLOSE_WRITE | Inotify.IN_CREATE | Inotify.IN_MODIFY,
  callback: (event)->
    mask = event.mask
    if event.name
      port = parseInt path.basename(event.name, '.yrp')
      room = rooms[port]
      if room
        if mask & Inotify.IN_CREATE
          console.log "#{port} duel start"
          #welcome message coding here
        else if mask & Inotify.IN_CLOSE_WRITE
          console.log "#{port} duel end"
          #parse replay coding here
          fs.unlink path.join('ygocore/replay'), (err)->
        else if mask & Inotify.IN_MODIFY
          room.alive = true
    else
      console.log '[warn] event without filename'

setInterval ()->
  for port, room of rooms
    if room.alive
      room.alive = false
    else
      console.log "killed #{port} #{room}"
      room.kill()
, 900000
