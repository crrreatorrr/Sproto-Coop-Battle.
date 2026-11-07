// Sproto Coop Battle — app shell: title, lobby (local / host / guest), game loop and netcode glue.
(function () {
'use strict';
const S = Sim, R = Render, I = Input, A = Audio2, M = MANIFEST;
const cv = document.getElementById('game'), g = cv.getContext('2d');
g.imageSmoothingEnabled = false;
const STEP = 1000 / 60;

const app = {
  screen: 'loading', role: 'local', net: null, myId: 0, code: '', msg: '', msgT: 0,
  slots: [], sim: null, snap: null, prevSnap: null, snapAt: 0, snapGap: 33,
  menu: 0, remoteIn: {}, guestNames: {}, lobbyDirty: true, paused: false, acc: 0, last: 0, sendTick: 0, pendingEv: [], t: 0,
};
function defaultSlots() {
  return Array.from({ length: 6 }, (_, i) => ({ ctrl: 'cpu', owner: 0, dev: '', fid: i % M.fighters.length, weapon: i }));
}
app.slots = defaultSlots();
// Static hosts without the relay server set window.SPROTO_OFFLINE: only local play is offered.
const MENU = window.SPROTO_OFFLINE ? ['LOCAL PLAY'] : ['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE'];
const fname = fid => M.fighters[fid].name;
function toast(s) { app.msg = s; app.msgT = 240; }

// ---------- canvas sizing ----------
function fit() {
  const s = Math.max(1, Math.min(innerWidth / S.W, innerHeight / S.H));
  const k = s >= 2 ? Math.floor(s) : s;
  cv.style.width = Math.floor(S.W * k) + 'px'; cv.style.height = Math.floor(S.H * k) + 'px';
}
addEventListener('resize', fit); fit();

// ---------- slots ----------
function slotOf(owner, dev) { return app.slots.findIndex(s => s.ctrl !== 'cpu' && s.owner === owner && s.dev === dev); }
function claimSlot(ctrl, owner, dev) {
  if (slotOf(owner, dev) >= 0) return -1;
  const i = app.slots.findIndex(s => s.ctrl === 'cpu');
  if (i < 0) return -1;
  Object.assign(app.slots[i], { ctrl, owner, dev, label: ctrl === 'remote' ? (app.guestNames[owner] || 'Online') + ' · ' + (I.DEVICE_NAMES[dev] || dev) : I.DEVICE_NAMES[dev] });
  if (app.sim) { const p = app.sim.players[i]; p.ctrl = ctrl; p.owner = owner; if (!p.dead) p.lives = Math.max(p.lives, 2); }
  app.lobbyDirty = true; A.play('join');
  toast(`P${i + 1} joined (${ctrl === 'remote' ? (app.guestNames[owner] || 'online') : I.DEVICE_NAMES[dev]})`);
  return i;
}
function releaseSlot(i) {
  Object.assign(app.slots[i], { ctrl: 'cpu', owner: 0, dev: '', label: '' });
  if (app.sim) { app.sim.players[i].ctrl = 'cpu'; }
  app.lobbyDirty = true;
}
function cycle(i, key, d) {
  const s = app.slots[i];
  if (key === 'fid') s.fid = (s.fid + d + M.fighters.length) % M.fighters.length; else s.weapon = (s.weapon + d + S.WEAPONS.length) % S.WEAPONS.length;
  app.lobbyDirty = true; A.play('menu');
}

// ---------- networking ----------
function hostOnline() {
  app.msg = 'Connecting…'; app.msgT = 9999;
  app.net = Net.connect({
    open: n => n.send({ t: 'host' }),
    message: onHostMessage,
    error: e => { toast(e); app.screen = 'title'; },
    close: () => { if (app.role === 'host') toast('Disconnected from server — playing locally'); app.role = 'local'; app.net = null; },
  });
  app.role = 'host'; app.screen = 'lobby'; app.slots = defaultSlots();
}
function onHostMessage(m) {
  if (m.t === 'room') { app.code = m.code; app.myId = m.id; toast('Room ' + m.code + ' — share this code'); app.lobbyDirty = true; }
  else if (m.t === 'peer') { app.guestNames[m.id] = m.name; app.remoteIn[m.id] = {}; toast(m.name + ' connected'); app.lobbyDirty = true; }
  else if (m.t === 'left') { app.slots.forEach((s, i) => { if (s.ctrl === 'remote' && s.owner === m.id) releaseSlot(i); }); delete app.remoteIn[m.id]; toast((app.guestNames[m.id] || 'Guest') + ' left'); }
  else if (m.t === 'want') claimSlot('remote', m.from, String(m.dev));
  else if (m.t === 'leave') { const i = slotOf(m.from, String(m.dev)); if (i >= 0 && app.screen === 'lobby') releaseSlot(i); }
  else if (m.t === 'pick') { const i = slotOf(m.from, String(m.dev)); if (i >= 0 && app.screen === 'lobby') cycle(i, m.key === 'fid' ? 'fid' : 'weapon', m.d > 0 ? 1 : -1); }
  else if (m.t === 'in') { app.remoteIn[m.from] = m.inp || {}; }
  else if (m.t === 'god' && app.sim) S.toggleGod(app.sim);
}
function joinOnline(code, name) {
  app.net = Net.connect({
    open: n => n.send({ t: 'join', code, name }),
    message: onGuestMessage,
    error: e => { toast(e); app.screen = 'title'; },
    close: () => { if (app.role === 'guest') { toast('Connection closed'); app.role = 'local'; app.screen = 'title'; app.snap = null; } app.net = null; },
  });
  app.role = 'guest'; app.screen = 'lobby'; app.code = code; app.slots = defaultSlots(); app.msg = 'Joining ' + code + '…'; app.msgT = 9999;
}
function onGuestMessage(m) {
  if (m.t === 'joined') { app.myId = m.id; toast('Joined room ' + m.code + ' — press ATTACK to take a slot'); }
  else if (m.t === 'error') { toast(m.error); app.role = 'local'; app.screen = 'title'; app.net && app.net.close(); }
  else if (m.t === 'lobby') { app.slots = m.slots; app.screen = 'lobby'; }
  else if (m.t === 'snap') {
    app.prevSnap = app.snap; app.snap = m.s; const now = performance.now();
    app.snapGap = app.snapAt ? Math.min(100, Math.max(16, now - app.snapAt)) : 33; app.snapAt = now;
    app.slots = m.slots || app.slots; app.screen = 'game';
    for (const e of m.ev || []) A.play(e);
  }
}
function broadcastLobby() {
  if (app.role !== 'host' || !app.net || !app.net.open) return;
  app.net.send({ t: 'lobby', slots: app.slots, code: app.code });
  app.lobbyDirty = false;
}

// ---------- game start / step ----------
function startGame() {
  const cfg = app.slots.map((s, i) => ({ fid: s.fid, weapon: s.weapon, ctrl: s.ctrl, owner: s.owner, name: fname(s.fid) }));
  app.sim = S.create(cfg, (Math.random() * 2 ** 31) | 0);
  app.screen = 'game'; app.paused = false; app.acc = 0;
  M.bosses.forEach((b, i) => { if (i < 2) R.bossImages(i); });
}
function hostStep() {
  const sim = app.sim;
  for (let i = 0; i < 6; i++) {
    const s = app.slots[i], p = sim.players[i];
    p.ctrl = s.ctrl;
    if (s.ctrl === 'local') p.in = I.read(s.dev);
    else if (s.ctrl === 'remote') p.in = I.unpack(((app.remoteIn[s.owner] || {})[s.dev]) | 0);
  }
  S.step(sim);
  // Preload the next bosses' sheets as the campaign advances.
  R.bossImages(sim.stageIdx); if (sim.stageIdx < 11) R.bossImages(sim.stageIdx + 1);
  for (const e of sim.events) { A.play(e); app.pendingEv.push(e); }
  sim.events.length = 0;
  if (app.role === 'host' && app.net && app.net.open && ++app.sendTick % 2 === 0) {
    app.net.send({ t: 'snap', s: S.snapshot(sim), ev: app.pendingEv.splice(0), slots: app.slots });
  } else if (app.role !== 'host') app.pendingEv.length = 0;
}

// ---------- per-frame device handling ----------
function localDevicesInput() {
  const devs = I.devices();
  const owner = app.role === 'guest' ? app.myId : 0;
  for (const d of devs) {
    const p = I.pressed(d);
    const i = slotOf(owner, d);
    if (app.screen === 'title') {
      const n = MENU.length;
      if (p.u) { app.menu = (app.menu + n - 1) % n; A.play('menu'); }
      if (p.d) { app.menu = (app.menu + 1) % n; A.play('menu'); }
      if (p.a || p.start) { A.ensure(); chooseMenu(app.menu, d); return; }
    } else if (app.screen === 'lobby') {
      if (app.role === 'guest') {
        if (i < 0 && p.a) app.net && app.net.send({ t: 'want', dev: d });
        if (i >= 0) {
          if (p.l || p.r) app.net.send({ t: 'pick', dev: d, key: 'fid', d: p.r ? 1 : -1 });
          if (p.u || p.d) app.net.send({ t: 'pick', dev: d, key: 'weapon', d: p.d ? 1 : -1 });
          if (p.j) app.net.send({ t: 'leave', dev: d });
        }
      } else {
        if (i < 0 && p.a) { A.ensure(); claimSlot('local', 0, d); continue; }
        if (i >= 0) {
          if (p.l || p.r) cycle(i, 'fid', p.r ? 1 : -1);
          if (p.u || p.d) cycle(i, 'weapon', p.d ? 1 : -1);
          if (p.j) releaseSlot(i);
        }
        if (p.start) { startGame(); return; }
      }
    } else if (app.screen === 'game') {
      // Drop-in: any unassigned device presses ATTACK to take over a CPU Sproto.
      if (i < 0 && p.a) {
        if (app.role === 'guest') app.net && app.net.send({ t: 'want', dev: d });
        else claimSlot('local', 0, d);
      }
      const mode = app.role === 'guest' ? app.snap && app.snap.mode : app.sim && app.sim.mode;
      if (p.start && (mode === 'gameover' || mode === 'victory') && app.role !== 'guest') { app.screen = 'lobby'; app.sim = null; app.lobbyDirty = true; }
    }
  }
}
function chooseMenu(k, dev) {
  if (k === 0) { app.role = 'local'; app.screen = 'lobby'; app.slots = defaultSlots(); claimSlot('local', 0, dev); }
  else if (k === 1) { hostOnline(); claimSlot('local', 0, dev); }
  else showJoin();
}

// ---------- join dialog (DOM) ----------
const joinBox = document.getElementById('join');
function showJoin() {
  joinBox.hidden = false; app.screen = 'join';
  const code = document.getElementById('code'); code.value = new URLSearchParams(location.search).get('room') || ''; code.focus();
}
document.getElementById('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase(), name = document.getElementById('name').value.trim() || 'Guest';
  if (!code) return;
  joinBox.hidden = true; A.ensure(); joinOnline(code, name);
});
document.getElementById('cancelJoin').addEventListener('click', () => { joinBox.hidden = true; app.screen = 'title'; });

// God mode: press 9 twice within 0.75 s during a battle (same input as Sproto Arcade).
let lastNine = -Infinity;
addEventListener('keydown', e => {
  if ((e.code === 'Digit9' || e.code === 'Numpad9') && !e.repeat && app.screen === 'game') {
    if (e.timeStamp - lastNine <= 750) {
      lastNine = -Infinity;
      if (app.role === 'guest') app.net && app.net.send({ t: 'god' });
      else if (app.sim) S.toggleGod(app.sim);
    } else lastNine = e.timeStamp;
  } else if (!e.repeat) lastNine = -Infinity;
  if (e.code === 'Escape' && app.screen === 'lobby') { if (app.net) app.net.close(); app.net = null; app.role = 'local'; app.screen = 'title'; }
  if (e.code === 'KeyP' && app.screen === 'game' && app.role === 'local') app.paused = !app.paused;
  if (e.code === 'KeyM') A.toggle();
});

// ---------- drawing screens ----------
const T = R.text;
function drawTitle() {
  R.drawBackground(g, Math.floor(app.t / 600) % 12, app.t * 0.6);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, S.W, S.H);
  T(g, 'SPROTO', S.W / 2, 56, 34, '#ffd23d', 'center');
  T(g, 'COOP BATTLE', S.W / 2, 96, 22, '#ff5a5a', 'center');
  T(g, '6 armed Sprotos  vs  12 machine bosses', S.W / 2, 124, 7, '#fff', 'center');
  for (let i = 0; i < 6; i++) {
    const o = { f: i % M.fighters.length, st: 'idle', t: app.t + i * 13, z: 0, fc: 1 };
    R.drawFighter(g, o, 120 + i * 80, 268, 0, S.WEAPONS[i].id, S.WEAPONS[i]);
  }
  const items = MENU;
  items.forEach((s, i) => T(g, (app.menu === i ? '> ' : '  ') + s, S.W / 2 - 70, 296 + i * 18, 10, app.menu === i ? '#ffd23d' : '#c8c6e0'));
  T(g, 'WASD+F/G/H  ·  ARROWS+,/./  ·  GAMEPADS', S.W / 2, 352, 6, '#9a98b8', 'center');
}
function drawLobby() {
  R.drawBackground(g, 4, app.t * 0.3);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, S.W, S.H);
  const title = app.role === 'host' ? 'ONLINE LOBBY' : app.role === 'guest' ? 'ONLINE LOBBY (GUEST)' : 'LOCAL LOBBY';
  T(g, title, 12, 16, 12, '#ffd23d');
  if (app.code) T(g, 'ROOM ' + app.code, S.W - 12, 16, 12, '#7aff8a', 'right');
  const cw = 100;
  app.slots.forEach((s, i) => {
    const x = 8 + i * (cw + 4), y = 36;
    const col = S.SLOT_COLORS[i];
    g.fillStyle = 'rgba(10,8,22,.85)'; g.fillRect(x, y, cw, 236);
    g.fillStyle = col; g.fillRect(x, y, cw, 3);
    T(g, 'P' + (i + 1), x + 6, y + 14, 10, col);
    const mine = app.role === 'guest' && s.ctrl === 'remote' && s.owner === app.myId;
    const who = s.ctrl === 'cpu' ? 'CPU' : mine ? 'YOU · ' + I.DEVICE_NAMES[s.dev] : app.role === 'guest' && s.ctrl === 'local' ? 'HOST · ' + s.label : s.label;
    T(g, String(who).slice(0, 14), x + 6, y + 30, 6, s.ctrl === 'cpu' ? '#8a88a8' : '#fff');
    let variant = 0; for (let k = 0; k < i; k++) if (app.slots[k].fid === s.fid) variant++;
    R.drawFighter(g, { f: s.fid, st: 'idle', t: app.t + i * 9, z: 0, fc: 1 }, x + cw / 2 - 4, y + 150, variant, S.WEAPONS[s.weapon].id, S.WEAPONS[s.weapon]);
    const nm = fname(s.fid);
    T(g, nm.length > 10 ? nm : '< ' + nm + ' >', x + cw / 2, y + 172, nm.length > 10 ? 6 : 7, '#fff', 'center');
    if (nm.length > 10) { T(g, '<', x + 6, y + 150, 8, '#8a88a8'); T(g, '>', x + cw - 6, y + 150, 8, '#8a88a8', 'right'); }
    T(g, S.WEAPONS[s.weapon].name, x + cw / 2, y + 190, 7, '#ffd23d', 'center');
    if (s.ctrl === 'cpu' && Math.floor(app.t / 30) % 2) T(g, 'PRESS ATTACK', x + cw / 2, y + 216, 6, '#7aff8a', 'center');
    if (s.ctrl !== 'cpu') T(g, 'JUMP = leave', x + cw / 2, y + 216, 5, '#8a88a8', 'center');
  });
  const lines = app.role === 'guest'
    ? ['ATTACK: join a slot   LEFT/RIGHT: Sproto   UP/DOWN: weapon', 'Waiting for the host to start…']
    : ['ATTACK: join   LEFT/RIGHT: Sproto   UP/DOWN: weapon   JUMP: leave', 'START / ENTER: begin — empty slots are CPU Sprotos. ESC: back'];
  lines.forEach((l, k) => T(g, l, S.W / 2, 292 + k * 14, 6, '#c8c6e0', 'center'));
  if (app.role === 'host' && app.code) T(g, 'Friends open this page, pick JOIN ONLINE and enter ' + app.code, S.W / 2, 332, 6, '#7aff8a', 'center');
}
function lerpSnap(a, b, k) {
  if (!a || k >= 1) return b;
  const L = (x, y) => x + (y - x) * k;
  const byId = (arr, key) => { const m = new Map(); for (const o of arr) m.set(o[key], o); return m; };
  const pa = byId(a.players, 's'), ea = byId(a.enemies, 'id'), ra = byId(a.projs, 'id');
  const mix = (o, p) => (p ? Object.assign({}, o, { x: L(p.x, o.x), y: L(p.y, o.y), z: L(p.z, o.z) }) : o);
  return Object.assign({}, b, {
    camX: a.si === b.si ? L(a.camX, b.camX) : b.camX,
    players: b.players.map(o => mix(o, pa.get(o.s))), enemies: b.enemies.map(o => mix(o, ea.get(o.id))), projs: b.projs.map(o => mix(o, ra.get(o.id))),
    boss: b.boss && a.boss ? Object.assign({}, b.boss, { x: L(a.boss.x, b.boss.x), y: L(a.boss.y, b.boss.y) }) : b.boss,
  });
}
function drawGame() {
  let snap;
  if (app.role === 'guest') {
    if (!app.snap) return;
    snap = lerpSnap(app.prevSnap, app.snap, (performance.now() - app.snapAt) / app.snapGap);
  } else snap = S.snapshot(app.sim);
  R.bossImages(snap.si);
  R.drawWorld(g, snap);
  if (app.paused) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, S.W, S.H); T(g, 'PAUSED', S.W / 2, S.H / 2, 20, '#fff', 'center'); }
  const free = app.slots.some(s => s.ctrl === 'cpu');
  if (free && Math.floor(app.t / 40) % 2) T(g, 'PRESS ATTACK TO JOIN', S.W / 2, S.H - 30, 6, '#7aff8a', 'center');
  if (app.code) T(g, 'ROOM ' + app.code, S.W - 6, S.H - 6, 6, '#7aff8a', 'right');
}

// ---------- main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(250, now - (app.last || now)); app.last = now; app.t++;
  if (app.screen !== 'loading' && app.screen !== 'join') localDevicesInput();
  I.endFrame();
  if (app.screen === 'game' && app.role !== 'guest' && app.sim && !app.paused) {
    app.acc += dt;
    while (app.acc >= STEP) { hostStep(); app.acc -= STEP; }
  }
  if (app.role === 'guest' && app.net && app.net.open && app.screen === 'game') {
    const inp = {}; for (const s of app.slots) if (s.ctrl === 'remote' && s.owner === app.myId) inp[s.dev] = I.pack(I.read(s.dev));
    app.net.send({ t: 'in', inp });
  }
  if (app.screen === 'lobby' && app.role === 'host' && (app.lobbyDirty || app.t % 60 === 0)) broadcastLobby();

  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
  g.fillStyle = '#000'; g.fillRect(0, 0, S.W, S.H);
  if (app.screen === 'loading') { T(g, 'LOADING SPROTOS…', S.W / 2, S.H / 2, 10, '#fff', 'center'); g.fillStyle = '#ffd23d'; g.fillRect(170, S.H / 2 + 16, 300 * (app.loadK || 0), 6); }
  else if (app.screen === 'title' || app.screen === 'join') drawTitle();
  else if (app.screen === 'lobby') drawLobby();
  else if (app.screen === 'game') drawGame();
  if (app.msgT > 0) { app.msgT--; g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, S.H - 52, S.W, 16); T(g, app.msg, S.W / 2, S.H - 44, 6, '#fff', 'center'); }
}
requestAnimationFrame(frame);
const fontReady = document.fonts ? document.fonts.load('10px "Press Start 2P"').catch(() => {}) : Promise.resolve();
Promise.all([R.preload(k => (app.loadK = k)), fontReady]).then(() => {
  app.screen = 'title';
  const q = new URLSearchParams(location.search);
  if (q.get('room')) showJoin();
  if (q.get('demo')) { app.role = 'local'; startGame(); } // all-CPU attract mode
});
window.SprotoApp = app; // handy for debugging and browser tests
})();
