// Sproto Coop Battle — dev/practice static server and WebSocket relay.
// The host browser still runs the simulation. This process only serves files
// from public/ and forwards practice messages. It has no accounts, tickets,
// scores, or hub economy, and it must never gain one.
// Marker: SPROTO_PRACTICE_RELAY_NO_ECONOMY
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = path.resolve(__dirname, '..', 'public');
const ROOT_WITH_SEP = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = new RegExp('^[' + CODE_CHARS + ']{4}$');
const DEV_RE = /^(k1|k2|gp[0-3])$/;
const PRACTICE = Object.freeze({
  mode: 'practice',
  economy: 'none',
  hubRewards: false,
});
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const GUEST_TYPES = new Set(['want', 'leave', 'pick', 'in', 'god']);
const HOST_TYPES = new Set(['lobby', 'snap']);
const HIGH_RATE_TYPES = new Set(['in', 'snap', 'lobby']);

// Caps sit above the measured practice traffic: snapshots peaked near 4 KB,
// guest inputs are one small frame per animation frame, and startup fetches
// the current 274-image preload. Anything past these limits is dropped.
const limits = {
  maxPayload: 32 * 1024,
  maxSockets: 48,
  maxSocketsPerIp: 8,
  maxRooms: 24,
  maxRoomsPerIp: 4,
  maxGuests: 3, // the host plus three guests fill the four seats
  messageRate: 240,
  messageBurst: 120,
  controlRate: 10,
  controlBurst: 20,
  godRate: 2,
  godBurst: 4,
  joinRate: 4,
  joinBurst: 8,
  hostRate: 2,
  hostBurst: 4,
  httpRate: 500,
  httpBurst: 2000,
  maxAbuse: 8,
  maxName: 12,
  maxUrl: 2048,
};

const rooms = new Map();
const allSockets = new Set();
const ipBuckets = new Map();
let nextId = 1;

function clientIp(req) {
  const raw = (req.socket && req.socket.remoteAddress) || '';
  return raw.replace(/^::ffff:/, '');
}

function takeToken(state, now, rate, burst) {
  const bucket = state || { tokens: burst, ts: now };
  const elapsed = Math.max(0, now - bucket.ts) / 1000;
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * rate);
  bucket.ts = now;
  if (bucket.tokens < 1) return { ok: false, state: bucket };
  bucket.tokens -= 1;
  return { ok: true, state: bucket };
}

function allowIp(ip, key, rate, burst, now) {
  let rec = ipBuckets.get(ip);
  if (!rec) { rec = {}; ipBuckets.set(ip, rec); }
  const result = takeToken(rec[key], now == null ? Date.now() : now, rate, burst);
  rec[key] = result.state;
  return result.ok;
}

function allowSocket(ws, key, rate, burst) {
  if (!ws.buckets) ws.buckets = {};
  const result = takeToken(ws.buckets[key], Date.now(), rate, burst);
  ws.buckets[key] = result.state;
  return result.ok;
}

function noteAbuse(ws) {
  ws.abuse = (ws.abuse || 0) + 1;
  if (ws.abuse >= limits.maxAbuse) {
    try { ws.close(1008, 'rejected'); } catch (err) { /* already closing */ }
  }
}

function socketsOn(ip) {
  let n = 0;
  for (const sock of allSockets) if (sock.ip === ip) n++;
  return n;
}

function roomsOn(ip) {
  let n = 0;
  for (const room of rooms.values()) if (room.ip === ip) n++;
  return n;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (origin == null || origin === '') return true;
  let parsed;
  try { parsed = new URL(origin); } catch (err) { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = req.headers.host;
  return !!host && parsed.host === host;
}

function baseHeaders(type) {
  const headers = {
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Sproto-Relay': 'practice; economy=none',
    'Referrer-Policy': 'no-referrer',
  };
  if (type) headers['Content-Type'] = type;
  return headers;
}

function sendJson(res, status, body, extra) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign(baseHeaders(typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8'), extra));
  res.end(payload);
}

function resolvePublic(rawUrl) {
  const raw = String(rawUrl || '/');
  const pathOnly = raw.split('?')[0].split('#')[0];
  if (pathOnly.length === 0 || pathOnly.length > limits.maxUrl) return { status: 400 };
  if (pathOnly.includes('\\') || pathOnly.includes('\0')) return { status: 400 };
  if (/%00/i.test(pathOnly)) return { status: 400 };
  if (/%(?![0-9a-fA-F]{2})/.test(pathOnly)) return { status: 400 };
  let decoded;
  try { decoded = decodeURIComponent(pathOnly); } catch (err) { return { status: 400 }; }
  if (/[\u0000-\u001f]/.test(decoded) || decoded.includes('\\')) return { status: 400 };
  if (decoded.startsWith('//')) return { status: 400 };
  let rel = decoded.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  if (/^[a-zA-Z]:/.test(rel) || rel.startsWith('\\\\')) return { status: 400 };
  const parts = rel.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) return { status: 403 };
  const file = path.resolve(ROOT, ...parts);
  if (file !== ROOT && !file.startsWith(ROOT_WITH_SEP)) return { status: 403 };
  return { status: 200, file };
}

function contained(file) {
  return file === ROOT || file.startsWith(ROOT_WITH_SEP);
}

const server = http.createServer((req, res) => {
  try {
    if (!originAllowed(req)) { sendJson(res, 403, 'forbidden'); return; }
    const ip = clientIp(req);
    if (!allowIp(ip, 'http', limits.httpRate, limits.httpBurst)) {
      sendJson(res, 429, 'too many requests', { 'Retry-After': '1' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
      return;
    }
    const pathname = String(req.url || '/').split('?')[0];
    if (pathname === '/healthz') {
      sendJson(res, 200, 'ok');
      return;
    }
    const resolved = resolvePublic(req.url || '/');
    if (resolved.status !== 200) { sendJson(res, resolved.status, resolved.status === 400 ? 'bad request' : 'forbidden'); return; }
    fs.realpath(resolved.file, (realErr, real) => {
      if (realErr || !contained(real)) {
        sendJson(res, realErr && realErr.code === 'ENOENT' ? 404 : 403, realErr && realErr.code === 'ENOENT' ? 'not found' : 'forbidden');
        return;
      }
      fs.stat(real, (statErr, st) => {
        if (statErr || !st.isFile()) { sendJson(res, 404, 'not found'); return; }
        if (req.method === 'HEAD') {
          res.writeHead(200, Object.assign(baseHeaders(TYPES[path.extname(real)] || 'application/octet-stream'), { 'Content-Length': st.size }));
          res.end();
          return;
        }
        fs.readFile(real, (readErr, data) => {
          if (readErr) { sendJson(res, 404, 'not found'); return; }
          res.writeHead(200, baseHeaders(TYPES[path.extname(real)] || 'application/octet-stream'));
          res.end(data);
        });
      });
    });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 400, 'bad request');
    else res.destroy();
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

function newCode() {
  for (let i = 0; i < 10000; i++) {
    let code = '';
    for (let n = 0; n < 4; n++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
};

function devOk(value) { return typeof value === 'string' && DEV_RE.test(value); }

function inpOk(inp) {
  if (!inp || typeof inp !== 'object' || Array.isArray(inp)) return false;
  const keys = Object.keys(inp);
  if (keys.length > 6) return false;
  return keys.every(key => DEV_RE.test(key) && Number.isInteger(inp[key]) && inp[key] >= 0 && inp[key] <= 255);
}

function sanitizeGuest(msg) {
  if (msg.t === 'want' || msg.t === 'leave') {
    if (!devOk(msg.dev)) return null;
    return { t: msg.t, dev: msg.dev };
  }
  if (msg.t === 'pick') {
    if (!devOk(msg.dev) || (msg.key !== 'fid' && msg.key !== 'weapon') || (msg.d !== 1 && msg.d !== -1)) return null;
    return { t: 'pick', dev: msg.dev, key: msg.key, d: msg.d };
  }
  if (msg.t === 'in') {
    if (!inpOk(msg.inp)) return null;
    return { t: 'in', inp: msg.inp };
  }
  if (msg.t === 'god') return { t: 'god' };
  return null;
}

function sanitizeHost(msg) {
  if (msg.t === 'lobby') {
    if (!Array.isArray(msg.slots) || msg.slots.length !== 4) return null;
    const sel = Number.isInteger(msg.sel) ? Math.max(0, Math.min(11, msg.sel)) : 0;
    return {
      t: 'lobby',
      slots: msg.slots,
      code: typeof msg.code === 'string' ? msg.code.slice(0, 4) : '',
      choosing: msg.choosing === true,
      sel,
      practice: true,
      economy: 'none',
    };
  }
  if (msg.t === 'snap') {
    if (!msg.s || typeof msg.s !== 'object' || Array.isArray(msg.s)) return null;
    if (msg.slots != null && (!Array.isArray(msg.slots) || msg.slots.length !== 4)) return null;
    if (msg.ev != null && !Array.isArray(msg.ev)) return null;
    const ev = (msg.ev || []).filter(item => typeof item === 'string' && item.length > 0 && item.length <= 24).slice(0, 64);
    return { t: 'snap', s: msg.s, ev, slots: msg.slots || null, practice: true, economy: 'none' };
  }
  return null;
}

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: limits.maxPayload,
  perMessageDeflate: false,
  verifyClient: (info, cb) => {
    if (!originAllowed(info.req)) { cb(false, 403, 'Forbidden'); return; }
    const ip = clientIp(info.req);
    if (socketsOn(ip) >= limits.maxSocketsPerIp || allSockets.size >= limits.maxSockets) {
      cb(false, 429, 'Too Many Requests');
      return;
    }
    cb(true);
  },
});

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if (socketsOn(ip) >= limits.maxSocketsPerIp || allSockets.size >= limits.maxSockets) {
    ws.close(1008, 'limit');
    return;
  }
  allSockets.add(ws);
  ws.ip = ip;
  ws.id = nextId++;
  ws.room = null;
  ws.isHost = false;
  ws.abuse = 0;
  ws.on('error', () => {});
  ws.on('close', () => {
    allSockets.delete(ws);
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    if (ws.isHost && room.host === ws) {
      for (const guest of room.guests.values()) {
        send(guest, { t: 'error', error: 'Host left the game', practice: true, economy: 'none' });
        guest.room = null;
        guest.isHost = false;
      }
      rooms.delete(ws.room);
    } else if (room.guests.has(ws.id)) {
      room.guests.delete(ws.id);
      send(room.host, { t: 'left', id: ws.id, practice: true, economy: 'none' });
    }
  });
  ws.on('message', (raw, isBinary) => {
    if (isBinary) { ws.close(1008, 'binary'); return; }
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    if (text.length > limits.maxPayload) { ws.close(1009, 'too big'); return; }
    let msg;
    try { msg = JSON.parse(text); } catch (err) { noteAbuse(ws); return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string' || msg.t.length > 16) {
      noteAbuse(ws);
      return;
    }
    const room = ws.room && rooms.get(ws.room);
    if (msg.t === 'host' && !ws.room) {
      if (!allowIp(ws.ip, 'host', limits.hostRate, limits.hostBurst)) {
        send(ws, { t: 'error', error: 'Too many rooms', practice: true, economy: 'none' });
        return;
      }
      if (rooms.size >= limits.maxRooms || roomsOn(ws.ip) >= limits.maxRoomsPerIp) {
        send(ws, { t: 'error', error: 'Too many rooms', practice: true, economy: 'none' });
        return;
      }
      const code = newCode();
      if (!code) { send(ws, { t: 'error', error: 'Too many rooms', practice: true, economy: 'none' }); return; }
      rooms.set(code, { host: ws, guests: new Map(), ip: ws.ip });
      ws.room = code;
      ws.isHost = true;
      send(ws, { t: 'room', code, id: ws.id, practice: true, economy: PRACTICE.economy, hubRewards: false });
      return;
    }
    if (msg.t === 'join' && !ws.room) {
      if (!allowIp(ws.ip, 'join', limits.joinRate, limits.joinBurst)) {
        send(ws, { t: 'error', error: 'Too many attempts', practice: true, economy: 'none' });
        return;
      }
      const code = String(msg.code || '').trim().toUpperCase();
      if (!CODE_RE.test(code)) {
        send(ws, { t: 'error', error: 'Room code is invalid', practice: true, economy: 'none' });
        return;
      }
      const found = rooms.get(code);
      if (!found) { send(ws, { t: 'error', error: 'Room ' + code + ' not found', practice: true, economy: 'none' }); return; }
      if (found.guests.size >= limits.maxGuests) {
        send(ws, { t: 'error', error: 'Room is full', practice: true, economy: 'none' });
        return;
      }
      found.guests.set(ws.id, ws);
      ws.room = code;
      const name = String(msg.name || 'Guest').replace(/[\u0000-\u001f]/g, '').slice(0, limits.maxName) || 'Guest';
      send(ws, { t: 'joined', code, id: ws.id, practice: true, economy: PRACTICE.economy, hubRewards: false });
      send(found.host, { t: 'peer', id: ws.id, name, practice: true, economy: 'none' });
      return;
    }
    if (!room) { noteAbuse(ws); return; }
    if (ws.isHost) {
      if (!HOST_TYPES.has(msg.t)) { noteAbuse(ws); return; }
      const bucket = HIGH_RATE_TYPES.has(msg.t) ? 'frames' : 'control';
      const rate = bucket === 'frames' ? limits.messageRate : limits.controlRate;
      const burst = bucket === 'frames' ? limits.messageBurst : limits.controlBurst;
      if (!allowSocket(ws, bucket, rate, burst)) return;
      const out = sanitizeHost(msg);
      if (!out) { noteAbuse(ws); return; }
      if (msg.to != null) {
        const target = msg.to;
        if (!Number.isInteger(target) || !room.guests.has(target)) { noteAbuse(ws); return; }
        send(room.guests.get(target), out);
      } else {
        for (const guest of room.guests.values()) send(guest, out);
      }
      return;
    }
    if (!GUEST_TYPES.has(msg.t)) { noteAbuse(ws); return; }
    let bucket = 'control';
    let rate = limits.controlRate;
    let burst = limits.controlBurst;
    if (msg.t === 'in') { bucket = 'frames'; rate = limits.messageRate; burst = limits.messageBurst; }
    else if (msg.t === 'god') { bucket = 'god'; rate = limits.godRate; burst = limits.godBurst; }
    if (!allowSocket(ws, bucket, rate, burst)) return;
    const out = sanitizeGuest(msg);
    if (!out) { noteAbuse(ws); return; }
    out.from = ws.id;
    send(room.host, out);
  });
});

function resetForTests() {
  for (const sock of allSockets) {
    try { sock.close(1001, 'reset'); } catch (err) { /* ignore */ }
  }
  rooms.clear();
  ipBuckets.clear();
}

function setLimitsForTests(partial) {
  const saved = {};
  for (const key of Object.keys(partial)) {
    if (!Object.prototype.hasOwnProperty.call(limits, key)) continue;
    saved[key] = limits[key];
    limits[key] = partial[key];
  }
  return saved;
}

function restoreLimits(saved) {
  Object.assign(limits, saved);
}

function listen(port, host, cb) {
  if (typeof host === 'function') { cb = host; host = undefined; }
  return host ? server.listen(port, host, cb) : server.listen(port, cb);
}

if (require.main === module) {
  const rawPort = process.env.PORT;
  const port = rawPort === undefined || rawPort === '' ? 8080 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Invalid PORT');
    process.exit(1);
  }
  server.listen(port, () => {
    const addr = server.address();
    console.log('Sproto Coop Battle practice relay on http://localhost:' + addr.port);
  });
}

module.exports = {
  server,
  wss,
  ROOT,
  PRACTICE,
  limits,
  resolvePublic,
  takeToken,
  resetForTests,
  setLimitsForTests,
  restoreLimits,
  listen,
};
