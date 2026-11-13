// Practice-relay containment. This server never mints hub money.
'use strict';

const http = require('http');
const assert = require('assert');
const { WebSocket } = require('ws');
const relay = require('../server/server.js');

function check(cond, message) {
  if (!cond) throw new Error(message);
}

function get(port, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
  });
}

function request(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

function openWs(port, options) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws', options);
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('open timeout')); }, 3000);
    ws.on('open', () => { clearTimeout(timer); resolve(ws); });
    ws.on('error', err => { clearTimeout(timer); reject(err); });
    ws.on('unexpected-response', (req, res) => {
      clearTimeout(timer);
      const err = new Error('HTTP ' + res.statusCode);
      err.status = res.statusCode;
      res.resume();
      reject(err);
    });
  });
}

function nextMsg(ws, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('message timeout')), timeout || 2000);
    ws.once('message', data => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function noMsg(ws, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', on); resolve(); }, ms || 120);
    function on() { clearTimeout(timer); reject(new Error('unexpected message ' + arguments[0])); }
    ws.on('message', on);
  });
}

function waitClose(ws, timeout) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) { resolve(); return; }
    const timer = setTimeout(() => reject(new Error('close timeout')), timeout || 2000);
    ws.once('close', () => { clearTimeout(timer); resolve(); });
  });
}

async function closeAll() {
  const open = [];
  relay.wss.clients.forEach(ws => open.push(ws));
  relay.resetForTests();
  await Promise.all(open.map(ws => waitClose(ws).catch(() => {})));
}

async function main() {
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  const port = relay.server.address().port;
  const marker = 'SPROTO_PRACTICE_RELAY_NO_ECONOMY';
  try {
    const health = await get(port, '/healthz');
    check(health.status === 200 && health.body === 'ok', 'healthz');
    check(health.headers['x-sproto-relay'] === 'practice; economy=none', 'practice header');

    const index = await get(port, '/index.html');
    check(index.status === 200 && index.body.includes('id="game"'), 'index served');
    check(index.headers['content-type'].includes('text/html'), 'html type');
    const sim = await get(port, '/js/sim.js');
    check(sim.status === 200 && sim.headers['content-type'].includes('javascript'), 'js type');
    const png = await get(port, '/assets/fighters/sproto3106/00.png');
    check(png.status === 200 && png.headers['content-type'] === 'image/png', 'png type');
    const jpg = await get(port, '/assets/stages/01-back.jpg');
    check(jpg.status === 200 && jpg.headers['content-type'] === 'image/jpeg', 'jpeg type');

    const blocked = [
      '/../server/server.js',
      '/../../server/server.js',
      '/assets/../../server/server.js',
      '/%2e%2e/server/server.js',
      '/%2e%2e/%2e%2e/server/server.js',
      '/%2e%2e%2fserver%2fserver.js',
      '/..%2f..%2fserver/server.js',
      '/public/../server/server.js',
      '/foo/../../../server/server.js',
    ];
    for (const urlPath of blocked) {
      const res = await get(port, urlPath);
      check(res.status === 403 || res.status === 400, urlPath + ' -> ' + res.status);
      check(!res.body.includes(marker) && !res.body.includes('WebSocketServer'), urlPath + ' leaked server source');
    }
    const malformed = ['/%', '/%zz', '/%2', '/%00.png', '/foo%00/../server/server.js', '/%5c..%5cserver%5cserver.js'];
    for (const urlPath of malformed) {
      const res = await get(port, urlPath);
      check(res.status === 400, urlPath + ' -> ' + res.status);
      check(!res.body.includes(marker), urlPath + ' leaked');
    }
    const doubled = await get(port, '/%252e%252e/%252e%252e/server/server.js');
    check(doubled.status === 404 || doubled.status === 403, 'double decode status ' + doubled.status);
    check(!doubled.body.includes(marker) && !doubled.body.includes('newCode'), 'double decode leaked');
    const outsideName = await get(port, '/server/server.js');
    check(outsideName.status === 404, 'public/server/server.js must not exist');
    check(!outsideName.body.includes(marker), 'named server path leaked');

    const posted = await request(port, 'POST', '/healthz');
    check(posted.status === 405, 'POST healthz');
    const earn = await request(port, 'POST', '/tickets/earn');
    check(earn.status === 405, 'no earn route');
    const rpc = await get(port, '/rpc/session.event');
    check(rpc.status === 404, 'no rpc route');

    const foreign = await get(port, '/index.html', { origin: 'https://evil.example' });
    check(foreign.status === 403, 'foreign HTTP origin');
    const rejectedOrigin = err => err.status === 403 || /403/.test(String(err && err.message));
    await assert.rejects(openWs(port, { origin: 'https://evil.example' }), rejectedOrigin);
    await assert.rejects(openWs(port, { origin: 'null' }), rejectedOrigin);

    const host = await openWs(port, { origin: 'http://127.0.0.1:' + port });
    host.send(JSON.stringify({ t: 'host' }));
    const room = await nextMsg(host);
    check(room.t === 'room' && room.practice === true && room.economy === 'none' && room.hubRewards === false, 'practice room');
    check(/^[A-Z0-9]{4}$/.test(room.code), 'room code');

    const guest = await openWs(port, { origin: 'http://127.0.0.1:' + port });
    guest.send(JSON.stringify({ t: 'join', code: room.code.toLowerCase(), name: 'TesterNameThatIsWayTooLong' }));
    const joined = await nextMsg(guest);
    check(joined.t === 'joined' && joined.practice === true && joined.economy === 'none' && joined.hubRewards === false, 'practice join');
    const peer = await nextMsg(host);
    check(peer.t === 'peer' && peer.name === 'TesterNameTh' && peer.id === joined.id, 'name capped at 12');

    guest.send(JSON.stringify({ t: 'in', inp: { k2: 1 }, from: 999 }));
    const forwarded = await nextMsg(host);
    check(forwarded.t === 'in' && forwarded.from === joined.id && forwarded.inp.k2 === 1, 'from is the socket, not the client');

    guest.send(JSON.stringify({ t: 'snap', s: { mode: 'victory' }, slots: [{}, {}, {}, {}] }));
    await noMsg(host);
    host.send(JSON.stringify({ t: 'earnTickets', amount: 20 }));
    await noMsg(guest);

    const slots = Array.from({ length: 4 }, () => ({ ctrl: 'cpu' }));
    host.send(JSON.stringify({ t: 'lobby', slots, code: room.code, choosing: false, sel: 0 }));
    const lobby = await nextMsg(guest);
    check(lobby.t === 'lobby' && lobby.practice === true && lobby.economy === 'none' && lobby.slots.length === 4, 'lobby forwarded');
    host.send(JSON.stringify({ t: 'snap', s: { mode: 'play', si: 0 }, ev: ['swing'], slots }));
    const snap = await nextMsg(guest);
    check(snap.t === 'snap' && snap.s.mode === 'play' && snap.ev[0] === 'swing' && snap.economy === 'none', 'snap forwarded');

    // Four seats: the host plus three guests. Two more join after the first guest.
    const guests = [];
    for (let i = 0; i < 2; i++) {
      const extra = await openWs(port);
      extra.send(JSON.stringify({ t: 'join', code: room.code, name: 'G' + i }));
      const ok = await nextMsg(extra);
      check(ok.t === 'joined', 'extra guest ' + i);
      await nextMsg(host);
      guests.push(extra);
    }
    const overflow = await openWs(port);
    overflow.send(JSON.stringify({ t: 'join', code: room.code, name: 'Overflow' }));
    const full = await nextMsg(overflow);
    check(full.t === 'error' && full.error === 'Room is full', 'fourth guest socket rejected');

    guest.send(JSON.stringify({ t: 'god' }));
    const god = await nextMsg(host);
    check(god.t === 'god' && god.from === joined.id, 'single god toggle still arrives');
    let gods = 0;
    host.on('message', data => { if (JSON.parse(data.toString()).t === 'god') gods++; });
    for (let i = 0; i < 30; i++) guest.send(JSON.stringify({ t: 'god' }));
    await new Promise(resolve => setTimeout(resolve, 150));
    check(gods < 30 && gods <= relay.limits.godBurst, 'god flood dropped, got ' + gods);

    for (const extra of guests) extra.close();
    overflow.close();
    await Promise.all([...guests, overflow].map(sock => waitClose(sock).catch(() => {})));

    const floodHost = await openWs(port);
    floodHost.send(JSON.stringify({ t: 'host' }));
    const floodRoom = await nextMsg(floodHost);
    const floodGuest = await openWs(port);
    floodGuest.send(JSON.stringify({ t: 'join', code: floodRoom.code, name: 'Flood' }));
    await nextMsg(floodGuest);
    await nextMsg(floodHost);
    let frames = 0;
    floodHost.on('message', data => { if (JSON.parse(data.toString()).t === 'in') frames++; });
    const savedFrames = relay.setLimitsForTests({ messageRate: 0 });
    const sent = 400;
    for (let i = 0; i < sent; i++) floodGuest.send(JSON.stringify({ t: 'in', inp: { k1: i & 255 } }));
    await new Promise(resolve => setTimeout(resolve, 200));
    relay.restoreLimits(savedFrames);
    check(frames < sent && frames <= relay.limits.messageBurst, 'frame flood forwarded ' + frames + ' of ' + sent);

    const big = await openWs(port);
    const closed = waitClose(big);
    big.send(JSON.stringify({ t: 'in', pad: 'X'.repeat(40 * 1024) }));
    await closed;

    const bad = await openWs(port);
    const badClosed = waitClose(bad);
    for (let i = 0; i < relay.limits.maxAbuse; i++) bad.send('{');
    await badClosed;

    await closeAll();
    const buckets = [];
    for (let i = 0; i < relay.limits.hostBurst + 1; i++) {
      const sock = await openWs(port);
      sock.send(JSON.stringify({ t: 'host' }));
      buckets.push(await nextMsg(sock));
      sock._keep = sock;
    }
    const roomMsgs = buckets.filter(msg => msg.t === 'room');
    const deniedRooms = buckets.filter(msg => msg.t === 'error' && msg.error === 'Too many rooms');
    check(roomMsgs.length === relay.limits.maxRoomsPerIp, 'room cap created ' + roomMsgs.length);
    check(deniedRooms.length === 1, 'room cap denied the extra host');

    await closeAll();
    const joinerHost = await openWs(port);
    joinerHost.send(JSON.stringify({ t: 'host' }));
    const joinRoom = await nextMsg(joinerHost);
    const savedJoin = relay.setLimitsForTests({ joinRate: 0, joinBurst: 3 });
    let joinedOk = 0;
    let limited = 0;
    for (let i = 0; i < 5; i++) {
      const sock = await openWs(port);
      sock.send(JSON.stringify({ t: 'join', code: i % 2 === 0 ? joinRoom.code : 'IIII', name: 'J' }));
      const msg = await nextMsg(sock);
      if (msg.t === 'joined') joinedOk++;
      if (msg.t === 'error' && msg.error === 'Too many attempts') limited++;
      if (msg.t === 'error' && msg.error === 'Room code is invalid') joinedOk++;
      if (msg.t === 'joined') await nextMsg(joinerHost);
    }
    relay.restoreLimits(savedJoin);
    check(limited >= 1, 'join lookup rate limit did not trip');
    check(joinedOk === 3, 'join burst allowed ' + joinedOk);

    await closeAll();
    let token = null;
    const now = 1_000_000;
    let accepted = 0;
    for (let i = 0; i < 5; i++) {
      const step = relay.takeToken(token, now, 1, 5);
      token = step.state;
      if (step.ok) accepted++;
    }
    check(accepted === 5 && relay.takeToken(token, now, 1, 5).ok === false, 'pure bucket closes when empty');
    check(relay.takeToken(token, now + 1000, 1, 5).ok === true, 'pure bucket refills');

    const saved = relay.setLimitsForTests({ httpBurst: 20, httpRate: 0 });
    let ok = 0;
    let tooMany = 0;
    for (let i = 0; i < 30; i++) {
      const res = await get(port, '/healthz');
      if (res.status === 200) ok++;
      else if (res.status === 429) tooMany++;
    }
    relay.restoreLimits(saved);
    check(ok === 20 && tooMany === 10, 'http rate fail closed ' + ok + '/' + tooMany);

    await closeAll();
    const sockets = [];
    for (let i = 0; i < relay.limits.maxSocketsPerIp; i++) sockets.push(await openWs(port));
    await assert.rejects(openWs(port), err => err.status === 429 || /429/.test(String(err && err.message)));
    sockets.forEach(sock => sock.close());

    console.log('relay security ok');
  } finally {
    await new Promise(resolve => relay.wss.close(() => relay.server.close(resolve)));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
