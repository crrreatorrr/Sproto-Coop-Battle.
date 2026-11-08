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
  menu: 0, stageSel: 0, remoteIn: {}, guestNames: {}, lobbyDirty: true, paused: false, acc: 0, last: 0, sendTick: 0, pendingEv: [], t: 0,
  hub: { kind: 'offline', label: 'OFFLINE', balance: null, confirming: false, message: '' },
};
function defaultSlots() {
  return Array.from({ length: 6 }, (_, i) => ({ ctrl: 'cpu', owner: 0, dev: '', fid: i % M.fighters.length, weapon: i }));
}
app.slots = defaultSlots();
// Static hosts without the relay server set window.SPROTO_OFFLINE: only local play is offered.
// LOCAL / HOST / JOIN keep their original indexes. Hub items sit between them and the Bar return.
const MENU = (window.SPROTO_OFFLINE ? ['LOCAL PLAY'] : ['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE']).concat(['HUB QUICK', 'HUB ROOM', 'JOIN HUB', 'RETURN TO BAR']);
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
  else if (m.t === 'lobby') { app.slots = m.slots; app.screen = 'lobby'; app.hostChoosing = m.choosing ? m.sel : null; }
  else if (m.t === 'snap') {
    app.prevSnap = app.snap; app.snap = m.s; const now = performance.now();
    app.snapGap = app.snapAt ? Math.min(100, Math.max(16, now - app.snapAt)) : 33; app.snapAt = now;
    app.slots = m.slots || app.slots; app.screen = 'game';
    for (const e of m.ev || []) A.play(e);
  }
}
function broadcastLobby() {
  if (app.role !== 'host' || !app.net || !app.net.open) return;
  app.net.send({ t: 'lobby', slots: app.slots, code: app.code, choosing: app.screen === 'stages', sel: app.stageSel });
  app.lobbyDirty = false;
}

// ---------- game start / step ----------
function startGame() {
  const cfg = app.slots.map((s, i) => ({ fid: s.fid, weapon: s.weapon, ctrl: s.ctrl, owner: s.owner, name: fname(s.fid) }));
  app.sim = S.create(cfg, (Math.random() * 2 ** 31) | 0, app.stageSel);
  app.screen = 'game'; app.paused = false; app.acc = 0;
  R.enterStage(app.sim.stageIdx); // C2: current stage + next, not the old eager pair
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
function runLive() {
  if (app.screen !== 'game') return false;
  const mode = app.role === 'guest' ? (app.snap && app.snap.mode) : (app.sim && app.sim.mode);
  return mode === 'play' || mode === 'boss' || (!!mode && mode !== 'gameover' && mode !== 'victory');
}
function syncHub(state) {
  app.hub.kind = state.kind;
  app.hub.label = state.label;
  app.hub.balance = state.balance;
  app.hub.confirming = !!state.confirming;
  app.hub.message = state.message || '';
  if (app.authority) app.authority.setConfirming(!!state.confirming);
  if (app._hubPlayer && state.playerId && app._hubPlayer !== state.playerId && app.role === 'banked') {
    if (app.authority) app.authority.leave();
    app.authority = null;
    app.role = 'local';
    app.screen = 'title';
    app.sim = null;
    toast('Hub account changed. The server kept the run.');
  }
  app._hubPlayer = state.playerId || '';
}
function requestHubReturn(live) {
  const hub = window.CoopHub && window.CoopHub.session;
  if (!hub) return;
  const result = hub.requestReturn(!!live);
  app.hub.confirming = !!(result && result.confirm);
}
function releaseForHub() {
  if (app.authority) { try { app.authority.leave(); } catch (err) { /* already leaving */ } app.authority = null; }
  if (app.net) { try { app.net.close(); } catch (err) { /* already closed */ } app.net = null; }
  try {
    const ctx = A.ensure && A.ensure();
    if (ctx && ctx.close && ctx.state !== 'closed') ctx.close();
  } catch (err) { /* audio already stopped */ }
  removeEventListener('keydown', onKeyDown);
  removeEventListener('resize', fit);
}
function hubReady() {
  const session = window.CoopHub && window.CoopHub.session && window.CoopHub.session.state;
  if (session && (session.kind === 'account' || session.kind === 'guest')) return true;
  return typeof window.SPROTO_COOP_REALTIME === 'function';
}
function startHub(item, dev) {
  if (!window.NetHub) { toast('Hub client missing'); return; }
  if (!hubReady()) { toast('Hub session required — local play stays practice'); return; }
  app.role = 'banked';
  app.sim = null;
  app.snap = null;
  app.slots = defaultSlots();
  app.screen = 'lobby';
  const ctl = NetHub.attach(app, { toast, accountId: app._hubPlayer || '' });
  ctl.claim(dev);
  const job = item === 'HUB QUICK' ? ctl.quickQueue() : item === 'HUB ROOM' ? ctl.createRoom() : Promise.resolve();
  if (item === 'JOIN HUB') { showJoin('hub'); return; }
  job.catch(err => {
    toast((err && err.message) || 'Hub match failed');
    if (app.role === 'banked' && (!app.authority || !app.authority.view().matchId)) {
      app.role = 'local';
      app.screen = 'title';
      app.authority = null;
    }
  });
}
function abandonBanked() {
  if (app.authority) app.authority.abandonToPractice();
  app.authority = null;
  app.role = 'local';
  app.sim = null;
  app.snap = null;
  app.code = '';
  app.screen = 'lobby';
  app.slots = defaultSlots();
  toast('New practice run. The server match was not taken over.');
}
function localDevicesInput() {
  const devs = I.devices();
  const owner = app.role === 'guest' ? app.myId : app.role === 'banked' && app.authority ? app.authority.accountId() : 0;
  if (app.hub.confirming) {
    for (const d of devs) {
      const p = I.pressed(d);
      if (p.a || p.start) { requestHubReturn(true); return; }
      if (p.j) {
        const hub = window.CoopHub && window.CoopHub.session;
        if (hub) hub.cancelReturn();
        app.hub.confirming = false;
        return;
      }
    }
    return;
  }
  for (const d of devs) {
    const p = I.pressed(d);
    const i = slotOf(owner, d);
    if (app.screen === 'title') {
      const n = MENU.length;
      if (p.u) { app.menu = (app.menu + n - 1) % n; A.play('menu'); }
      if (p.d) { app.menu = (app.menu + 1) % n; A.play('menu'); }
      if (p.a || p.start) { A.ensure(); chooseMenu(app.menu, d); return; }
    } else if (app.screen === 'lobby') {
      if (app.role === 'banked' && app.authority) {
        const view = app.authority.view();
        if (view.offerPractice && p.start) { abandonBanked(); return; }
        if (i < 0 && p.a) { app.authority.claim(d); continue; }
        if (i >= 0) {
          if (p.l || p.r) app.authority.cycle(d, 'fid', p.r ? 1 : -1);
          if (p.u || p.d) app.authority.cycle(d, 'weapon', p.d ? 1 : -1);
          if (p.j) app.authority.release(d);
        }
        if (p.start) { app.authority.ready(); return; }
        continue;
      }
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
        if (p.start) { app.screen = 'stages'; app.msgT = 0; app.lobbyDirty = true; A.play('menu'); return; }
      }
    } else if (app.screen === 'stages') {
      if (app.role === 'banked') { app.screen = 'lobby'; return; }
      // Stage select: 4 x 3 grid of the twelve Sproto Arcade stages.
      const sel = app.stageSel;
      if (p.l) app.stageSel = (sel + 11) % 12; if (p.r) app.stageSel = (sel + 1) % 12;
      if (p.u) app.stageSel = (sel + 8) % 12; if (p.d) app.stageSel = (sel + 4) % 12;
      if (app.stageSel !== sel) { A.play('menu'); app.lobbyDirty = true; }
      if (p.a || p.start) { startGame(); return; }
      if (p.j) { app.screen = 'lobby'; app.lobbyDirty = true; return; }
    } else if (app.screen === 'game') {
      if (app.role === 'banked' && app.authority) {
        const view = app.authority.view();
        if (view.offerPractice && p.start) { abandonBanked(); return; }
        if (i < 0 && p.a && view.phase === 'playing') app.authority.claim(d);
        if (i >= 0 && p.j && view.phase === 'playing') app.authority.release(d);
        continue;
      }
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
  const item = MENU[k];
  if (item === 'RETURN TO BAR') { requestHubReturn(false); return; }
  if (item === 'LOCAL PLAY') { app.role = 'local'; app.screen = 'lobby'; app.slots = defaultSlots(); claimSlot('local', 0, dev); }
  else if (item === 'HOST ONLINE') { hostOnline(); claimSlot('local', 0, dev); }
  else if (item === 'JOIN ONLINE') showJoin('practice');
  else if (item === 'HUB QUICK' || item === 'HUB ROOM' || item === 'JOIN HUB') startHub(item, dev);
}

// ---------- join dialog (DOM) ----------
const joinBox = document.getElementById('join');
function showJoin(kind) {
  app.joinKind = kind === 'hub' ? 'hub' : 'practice';
  joinBox.hidden = false; app.screen = 'join';
  const code = document.getElementById('code');
  const title = document.getElementById('joinTitle');
  const note = document.getElementById('joinNote');
  code.maxLength = app.joinKind === 'hub' ? 12 : 4;
  code.value = app.joinKind === 'hub' ? '' : (new URLSearchParams(location.search).get('room') || '');
  if (title) title.textContent = app.joinKind === 'hub' ? 'JOIN HUB ROOM' : 'JOIN ONLINE';
  if (note) note.textContent = app.joinKind === 'hub' ? '12-character code. It finds the match. It does not sign you in.' : 'Practice relay. No hub rewards.';
  code.focus();
}
document.getElementById('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase(), name = document.getElementById('name').value.trim() || 'Guest';
  if (!code) return;
  joinBox.hidden = true; A.ensure();
  if (app.joinKind === 'hub' && app.authority) {
    app.authority.joinCode(code).catch(err => {
      toast((err && err.message) || 'Room not found');
      if (!app.authority || !app.authority.view().matchId) { app.role = 'local'; app.screen = 'title'; }
    });
    return;
  }
  joinOnline(code, name);
});
document.getElementById('cancelJoin').addEventListener('click', () => { joinBox.hidden = true; app.screen = 'title'; });

// God mode: press 9 twice within 0.75 s during a battle (same input as Sproto Arcade).
let lastNine = -Infinity;
function onKeyDown(e) {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (app.screen === 'loading' && app.loadErr && !e.repeat && (e.code === 'Enter' || e.code === 'KeyF' || e.code === 'Space')) { bootAssets(); return; }
  if (!e.repeat && e.code === 'KeyB') { requestHubReturn(runLive()); return; }
  if (app.hub.confirming && e.code === 'Escape') {
    const hub = window.CoopHub && window.CoopHub.session;
    if (hub) hub.cancelReturn();
    app.hub.confirming = false;
    return;
  }
  if ((e.code === 'Digit9' || e.code === 'Numpad9') && !e.repeat && app.screen === 'game') {
    if (e.timeStamp - lastNine <= 750) {
      lastNine = -Infinity;
      if (app.role === 'banked' && app.authority) app.authority.command('god');
      else if (app.role === 'guest') app.net && app.net.send({ t: 'god' });
      else if (app.sim) S.toggleGod(app.sim);
    } else lastNine = e.timeStamp;
  } else if (!e.repeat) lastNine = -Infinity;
  if (e.code === 'Escape' && app.screen === 'stages') { app.screen = 'lobby'; app.lobbyDirty = true; return; }
  if (e.code === 'Escape' && app.screen === 'lobby') {
    if (app.role === 'banked' && app.authority) { app.authority.leave(); app.authority = null; }
    if (app.net) app.net.close();
    app.net = null; app.role = 'local'; app.screen = 'title';
  }
  if (e.code === 'KeyP' && app.screen === 'game' && app.role === 'banked' && app.authority) { app.authority.toggleHold(); return; }
  if (e.code === 'KeyP' && app.screen === 'game' && app.role === 'local') app.paused = !app.paused;
  if (e.code === 'KeyM') A.toggle();
}
addEventListener('keydown', onKeyDown);

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
    R.drawFighter(g, o, 120 + i * 80, 214, 0, S.WEAPONS[i].id, S.WEAPONS[i]);
  }
  const items = MENU;
  items.forEach((s, i) => T(g, (app.menu === i ? '> ' : '  ') + s, S.W / 2 - 110, 236 + i * 14, 8, app.menu === i ? '#ffd23d' : '#c8c6e0'));
  T(g, 'WASD + F/G/H, R power  ·  ARROWS + , . /  \' power  ·  GAMEPADS', S.W / 2, 348, 6, '#9a98b8', 'center');
}
function drawLobby() {
  R.drawBackground(g, 4, app.t * 0.3);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, S.W, S.H);
  const title = app.role === 'banked' ? 'SERVER LOBBY — REWARDS 0' : app.role === 'host' ? 'PRACTICE LOBBY' : app.role === 'guest' ? 'PRACTICE LOBBY (RELAY)' : 'LOCAL PRACTICE';
  T(g, title, 12, 22, 12, '#ffd23d');
  if (app.code) T(g, 'ROOM ' + app.code, S.W - 12, 22, 12, '#7aff8a', 'right');
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
  const lines = app.role === 'banked'
    ? ['ATTACK: take a device   LEFT/RIGHT: Sproto   UP/DOWN: weapon   JUMP: give it to AI', 'START: ready. The server owns seats, lives, and stage 1. ESC leaves the match.']
    : app.role === 'guest'
    ? ['ATTACK: join a slot   LEFT/RIGHT: Sproto   UP/DOWN: weapon', 'Waiting for the host to start…']
    : ['ATTACK: join   LEFT/RIGHT: Sproto   UP/DOWN: weapon   JUMP: leave', 'START / ENTER: choose a stage — empty slots are CPU Sprotos. ESC: back'];
  lines.forEach((l, k) => T(g, l, S.W / 2, 292 + k * 14, 6, '#c8c6e0', 'center'));
  if (app.role === 'guest' && app.hostChoosing != null) {
    g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(0, 150, S.W, 40);
    T(g, 'HOST IS CHOOSING: STAGE ' + (app.hostChoosing + 1) + ' · ' + M.bosses[app.hostChoosing].stage.toUpperCase(), S.W / 2, 170, 8, '#ffd23d', 'center');
  }
  if (app.role === 'host' && app.code) T(g, 'Friends open this page, pick JOIN ONLINE and enter ' + app.code, S.W / 2, 328, 6, '#7aff8a', 'center');
  if (app.role === 'banked' && app.code) T(g, 'Share the 12-character code. It finds the room. It does not sign anyone in.', S.W / 2, 328, 6, '#7aff8a', 'center');
  T(g, app.role === 'banked' ? 'BANKED CANDIDATE — NO PAYOUT UNTIL H3-C. B RETURNS TO THE BAR.' : 'PRACTICE — NO HUB REWARDS. B RETURNS TO THE BAR.', S.W / 2, 346, 6, '#9a98b8', 'center');
}
function drawStages() {
  R.drawBackground(g, app.stageSel, app.t * 0.4);
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, S.W, S.H);
  T(g, 'CHOOSE A STAGE', 12, 22, 12, '#ffd23d');
  T(g, 'STAGE ' + (app.stageSel + 1) + ' OF 12', S.W - 12, 22, 8, '#c8c6e0', 'right');
  const cw = 148, ch = 82;
  for (let i = 0; i < 12; i++) {
    const c = i % 4, r = Math.floor(i / 4), x = 8 + c * (cw + 8), y = 34 + r * (ch + 8), on = i === app.stageSel;
    const back = R.img('assets/stages/' + String(i + 1).padStart(2, '0') + '-back.jpg');
    g.fillStyle = '#000'; g.fillRect(x, y, cw, ch);
    if (R.ready(back)) { const sh = back.height, sw = Math.min(back.width, sh * (cw / 62)); g.drawImage(back, 0, 0, sw, sh, x, y, cw, 62); }
    g.fillStyle = on ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.55)'; g.fillRect(x, y, cw, ch);
    g.fillStyle = 'rgba(8,6,16,.9)'; g.fillRect(x, y + 62, cw, 20);
    T(g, String(i + 1), x + 6, y + 10, 8, on ? '#ffd23d' : '#fff');
    T(g, M.bosses[i].stage, x + 6, y + 72, M.bosses[i].stage.length > 17 ? 5 : 6, on ? '#ffd23d' : '#e8e6f8');
    g.strokeStyle = on ? (Math.floor(app.t / 10) % 2 ? '#ffd23d' : '#fff') : 'rgba(255,255,255,.18)'; g.lineWidth = on ? 3 : 1;
    g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
  }
  const b = M.bosses[app.stageSel];
  T(g, 'BOSS: ' + b.machines[0].toUpperCase() + '  >  ' + b.machines[1].toUpperCase(), S.W / 2, 318, 8, '#ff8a8a', 'center');
  T(g, 'ARROWS / STICK: choose   ATTACK / START: fight   JUMP / ESC: back to lobby', S.W / 2, 340, 6, '#c8c6e0', 'center');
}
function lerpSnap(a, b, k) {
  return R.interpolateSnapshot(a, b, k);
}
function drawGame() {
  let snap;
  let banked = null;
  if (app.role === 'banked') {
    banked = app.authority ? app.authority.view() : null;
    if (!banked || !banked.snapshot) return;
    snap = lerpSnap(banked.prevSnapshot, banked.snapshot, (performance.now() - banked.snapAt) / (banked.snapGap || 100));
  } else if (app.role === 'guest') {
    if (!app.snap) return;
    snap = lerpSnap(app.prevSnap, app.snap, (performance.now() - app.snapAt) / app.snapGap);
  } else snap = S.snapshot(app.sim);
  R.bossImages(snap.si);
  R.drawWorld(g, snap);
  if (app.role === 'banked' && banked) {
    const note = banked.background ? 'TAB IN BACKGROUND — MATCH CONTINUES' : banked.held ? 'YOUR INPUTS ARE HELD — MATCH CONTINUES' : banked.phase === 'reconnecting' ? 'RECONNECTING ' + Math.ceil((banked.reconnectMs || 0) / 1000) + 's — NOT A LOCAL HOST' : '';
    if (note) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 40, S.W, 16); T(g, note, S.W / 2, 44, 6, '#ffd23d', 'center'); }
    if (banked.offerPractice) T(g, 'START BEGINS A NEW PRACTICE RUN', S.W / 2, 64, 6, '#fff', 'center');
  } else if (app.paused) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, S.W, S.H); T(g, 'PAUSED', S.W / 2, S.H / 2, 20, '#fff', 'center'); }
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
  if (app.screen === 'game' && app.role !== 'guest' && app.role !== 'banked' && app.sim && !app.paused && !app.hub.confirming) {
    app.acc += dt;
    while (app.acc >= STEP) { hostStep(); app.acc -= STEP; }
  }
  if (app.role === 'banked' && app.authority) {
    app.authority.setBackground(document.visibilityState === 'hidden');
    app.authority.pump(now);
  }
  if (app.role === 'guest' && app.net && app.net.open && app.screen === 'game' && !app.hub.confirming) {
    const inp = {}; for (const s of app.slots) if (s.ctrl === 'remote' && s.owner === app.myId) inp[s.dev] = I.pack(I.read(s.dev));
    app.net.send({ t: 'in', inp });
  }
  if ((app.screen === 'lobby' || app.screen === 'stages') && app.role === 'host' && (app.lobbyDirty || app.t % 60 === 0)) broadcastLobby();

  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
  g.fillStyle = '#000'; g.fillRect(0, 0, S.W, S.H);
  if (app.screen === 'loading') {
    T(g, app.loadErr ? 'COULD NOT LOAD ART' : 'LOADING SPROTOS…', S.W / 2, S.H / 2 - 8, 10, '#fff', 'center');
    g.fillStyle = '#3a3558'; g.fillRect(170, S.H / 2 + 16, 300, 6);
    g.fillStyle = '#ffd23d'; g.fillRect(170, S.H / 2 + 16, 300 * (app.loadK || 0), 6);
    if (app.loadErr) T(g, 'ATTACK OR ENTER RETRIES', S.W / 2, S.H / 2 + 40, 7, '#ff8a8a', 'center');
  }
  else if (app.screen === 'title' || app.screen === 'join') drawTitle();
  else if (app.screen === 'lobby') drawLobby();
  else if (app.screen === 'stages') drawStages();
  else if (app.screen === 'game') drawGame();
  if (app.msgT > 0) { app.msgT--; g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, S.H - 52, S.W, 16); T(g, app.msg, S.W / 2, S.H - 44, 6, '#fff', 'center'); }
  drawHubStatus();
}
function drawHubStatus() {
  const h = app.hub;
  const who = h.kind === 'account' ? 'ACCOUNT ' + h.label : h.kind === 'guest' ? 'GUEST' : h.kind === 'error' ? 'HUB ERROR' : 'OFFLINE';
  const bal = (h.kind === 'account' || h.kind === 'guest') && typeof h.balance === 'number' ? '   TICKETS ' + h.balance : '';
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, S.W, 14);
  const mode = app.role === 'banked' ? '   ·   BANKED CANDIDATE · REWARDS 0' : '   ·   PRACTICE';
  T(g, who + bal + mode, 6, 4, 5, '#c8c6e0');
  if (h.confirming) {
    g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(48, 148, S.W - 96, 56);
    T(g, 'RETURN TO THE BAR?', S.W / 2, 166, 10, '#ffd23d', 'center');
    T(g, 'ATTACK CONFIRMS    JUMP CANCELS', S.W / 2, 186, 6, '#fff', 'center');
  }
}
requestAnimationFrame(frame);
const fontReady = document.fonts ? document.fonts.load('10px "Press Start 2P"').catch(() => {}) : Promise.resolve();
// C2 load boundary: title waits on lobby art; a failed critical file stays on this screen until retry.
function bootAssets() {
  app.loadErr = '';
  app.loadK = 0;
  app.screen = 'loading';
  return Promise.all([R.preload(k => (app.loadK = k)), fontReady]).then(() => {
    if (app.booted) return;
    app.booted = true;
    app.screen = 'title';
    const q = new URLSearchParams(location.search);
    if (q.get('room')) showJoin();
    if (q.get('demo')) { app.role = 'local'; startGame(); } // all-CPU attract mode
  }, err => { app.loadErr = (err && err.message) || 'asset failed'; app.screen = 'loading'; });
}
if (window.CoopHub) window.CoopHub.boot({ release: releaseForHub, onChange: syncHub });
bootAssets();
window.SprotoApp = app; // handy for debugging and browser tests
})();
