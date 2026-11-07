// Sproto Coop Battle — static file server + WebSocket relay for online play.
// The host browser runs the authoritative simulation. This server only creates
// rooms and forwards messages: guest -> host (inputs, join requests) and
// host -> guests (snapshots, slot assignments).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.end('ok'); return; }
  if (url.endsWith('/')) url += 'index.html';
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const rooms = new Map(); // code -> { host, guests: Map<id, ws> }
let nextId = 1;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });
wss.on('connection', ws => {
  ws.id = nextId++;
  ws.room = null;
  ws.isHost = false;
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const room = ws.room && rooms.get(ws.room);
    if (msg.t === 'host' && !ws.room) {
      const code = newCode();
      rooms.set(code, { host: ws, guests: new Map() });
      ws.room = code; ws.isHost = true;
      send(ws, { t: 'room', code, id: ws.id });
    } else if (msg.t === 'join' && !ws.room) {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) { send(ws, { t: 'error', error: 'Room ' + code + ' not found' }); return; }
      if (r.guests.size >= 5) { send(ws, { t: 'error', error: 'Room is full' }); return; }
      r.guests.set(ws.id, ws);
      ws.room = code;
      send(ws, { t: 'joined', code, id: ws.id });
      send(r.host, { t: 'peer', id: ws.id, name: String(msg.name || 'Guest').slice(0, 12) });
    } else if (room && ws.isHost) {
      // Host -> one guest (msg.to) or everyone.
      const out = JSON.stringify(msg);
      if (msg.to) send(room.guests.get(msg.to), out);
      else for (const g of room.guests.values()) send(g, out);
    } else if (room) {
      msg.from = ws.id;
      send(room.host, msg);
    }
  });
  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    if (ws.isHost) {
      for (const g of room.guests.values()) { send(g, { t: 'error', error: 'Host left the game' }); g.room = null; }
      rooms.delete(ws.room);
    } else {
      room.guests.delete(ws.id);
      send(room.host, { t: 'left', id: ws.id });
    }
  });
});

server.listen(PORT, () => console.log(`Sproto Coop Battle on http://localhost:${PORT}`));
