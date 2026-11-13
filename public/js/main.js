// Sproto Coop Battle — app shell: title, lobby (local / host / guest), game loop and netcode glue.
(function () {
'use strict';
const S = Sim, R = Render, I = Input, A = Audio2, M = MANIFEST, P = Progress;
const cv = document.getElementById('game'), g = cv.getContext('2d');
g.imageSmoothingEnabled = false;
const STEP = 1000 / 60;
// crash.js (loaded first) counts uncaught errors and opens the "Something broke" panel.
const C = window.CrashGuard, crash = C.guard;
// feedback-link.js: the hub's feedback window (N twice). Absent or not installed, these do nothing.
const F = window.CoopFeedback || null;
const crumb = (type, data) => { if (F) F.breadcrumb(type, data); };

const app = {
  screen: 'loading', role: 'local', net: null, myId: 0, code: '', msg: '', msgT: 0,
  slots: [], sim: null, snap: null, prevSnap: null, snapAt: 0, snapGap: 33,
  menu: 0, stageSel: 0, remoteIn: {}, guestNames: {}, lobbyDirty: true, paused: false, acc: 0, last: 0, sendTick: 0, pendingEv: [], t: 0,
  hub: { kind: 'offline', label: 'OFFLINE', balance: null, confirming: false, message: '' },
  pauseMenu: null, // pause menu while open: { dev: pad id or 'keys', sel, held }
  joinCursor: 0,
  runId: '', // one id per local/hosted run, or per relay run a guest watches; keys the Relic report
  killLatch: null, // { run, si, out }: was this device's account out when the stage's boss fell
  // Stage unlocks and the best run, owned by the live hub player or by this browser (audio.js).
  // A hub visit holds them in memory until hub-link.js knows the player. Change them only through
  // progress.update. Free play is a setting and stays on this device.
  progress: P.createStore({ hubVisit: !!(window.CoopHub && window.CoopHub.visitStarting()) }),
  settings: P.loadSettings(),
  summary: null, godSeen: false, // end-of-run panel for the run on screen
  frozen: false, // the feedback window is open over local play: no sim step, no menu input
  view: null, // the snapshot drawGame last drew, for the feedback note's context
  controls: null, // controller settings while open: { dev, screen, tab, row, cap, msg }
  confirmMain: false, // "leave the run for the main menu?" over the pause menu
  fsCalls: 0, mouseAt: -Infinity,
};
function defaultSlots() {
  return Array.from({ length: S.SLOTS }, (_, i) => ({ ctrl: 'cpu', owner: 0, dev: '', fid: i % M.fighters.length, weapon: i }));
}
app.slots = defaultSlots();
// Static hosts without the relay server set window.SPROTO_OFFLINE: only local play is offered.
// LOCAL / HOST / JOIN keep their original indexes. Hub items sit between them and the Bar return.
const MENU = (window.SPROTO_OFFLINE ? ['LOCAL PLAY'] : ['LOCAL PLAY', 'HOST ONLINE', 'JOIN ONLINE']).concat(['HUB QUICK', 'HUB ROOM', 'JOIN HUB', 'RETURN TO BAR']);
const fname = fid => M.fighters[fid].name;
function toast(s) { app.msg = s; app.msgT = 240; }
const newRunId = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
// Marina Anchor Relic: a stage 1 clear in local, hosted or relay play is reported once per run
// through the hub link, only when the hub opened this page and this device has a human in the run.
// No Tickets. Banked runs never get here: the hub's server grants the Relic for them.
// A player who was out when the boss fell gets no report for that clear: the same rule as the
// sim's per-encounter `out` latch (net-protocol.js latchKill / participationFacts). At the first
// moment the boss is dead (the 'bossdown' event, or the 'clear' itself if that was missed), this
// device's account is out when none of its seats is anything but 'dead'. A downed seat is not out.
// The run is not marked reported, so a later stage 1 clear where they were not out still reports.
const mySeat = () => app.role === 'guest' ? s => s.ctrl === 'remote' && s.owner === app.myId : s => s.ctrl === 'local';
function latchKill(stageIdx, players) {
  const k = app.killLatch;
  if (k && k.run === app.runId && k.si === stageIdx) return;
  const mine = mySeat();
  const standing = (players || []).some((p, i) => {
    const slot = app.slots[p.slot != null ? p.slot : p.s != null ? p.s : i];
    return slot && mine(slot) && p.st !== 'dead';
  });
  app.killLatch = { run: app.runId, si: stageIdx, out: !standing };
}
function stageClear(stageIdx, god, players) {
  const hub = window.CoopHub && window.CoopHub.session;
  if (!hub || !hub.reportStageClear || app.role === 'banked' || !app.runId) return;
  const mine = mySeat();
  if (!app.slots.some(mine)) return;
  latchKill(stageIdx, players);
  if (app.killLatch.out) return;
  try {
    hub.reportStageClear(stageIdx, !!god, app.runId).then(r => { if (r && r.granted === 'marina_anchor') toast('Relic: Marina Anchor'); });
  } catch (err) { console.warn('[hub] stage clear report failed', err); }
}

// ---------- canvas sizing and full screen ----------
// The 640x360 canvas fills the window at the largest scale that fits; the spare bars show the page
// background. Pixels stay square (no stretch) and nothing is cropped.
function fit() {
  const k = Math.min(innerWidth / S.W, innerHeight / S.H);
  cv.style.width = Math.floor(S.W * k) + 'px'; cv.style.height = Math.floor(S.H * k) + 'px';
}
addEventListener('resize', fit); fit();
// FULL SCREEN in every menu. Keys and clicks call this from their own event handler (see fsKey
// and the canvas click); a pad press comes from the frame loop, which a browser may refuse.
const fsAvail = () => !!document.fullscreenEnabled;
const fsLabel = () => 'FULL SCREEN: ' + (document.fullscreenElement ? 'ON' : 'OFF');
let fsLeftAt = -Infinity; // when the page last left full screen (Esc, F11 or the menu)
function toggleFullscreen() {
  app.fsCalls++;
  app.fsActive = navigator.userActivation ? navigator.userActivation.isActive : null;
  const refused = () => toast('Full screen was refused. Try a key, a click or F11.');
  try {
    const job = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    if (job && job.catch) job.catch(refused);
  } catch (err) { refused(); }
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) fsLeftAt = performance.now(); fit(); });
// Items every menu shares, after its own.
const sharedItems = () => ['CONTROLLER SETTINGS'].concat(fsAvail() ? [fsLabel()] : []);
const titleItems = () => MENU.concat(sharedItems());

// ---------- mouse ----------
// Canvas menus register clickable boxes while they draw; a dialog drawn on top clears the ones
// under it (modal), so only what is visible on top answers the mouse.
const hits = [];
const hit = (x, y, w, h, act, hover) => hits.push({ x, y, w, h, act, hover });
const modal = () => { hits.length = 0; };
function hitAt(e) {
  const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * S.W / r.width, y = (e.clientY - r.top) * S.H / r.height;
  for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h; }
  return null;
}
cv.addEventListener('click', e => { if (app.frozen) return; const h = hitAt(e); if (h) { A.ensure(); h.act(); } });
cv.addEventListener('mousemove', e => {
  app.mouseAt = performance.now();
  const h = app.frozen ? null : hitAt(e);
  if (h && h.hover) h.hover();
  cv.style.cursor = h ? 'pointer' : '';
});

// ---------- slots ----------
function slotOf(owner, dev) { return app.slots.findIndex(s => s.ctrl !== 'cpu' && s.owner === owner && s.dev === dev); }
function claimSlot(ctrl, owner, dev) {
  if (slotOf(owner, dev) >= 0) return -1;
  const i = app.slots.findIndex(s => s.ctrl === 'cpu');
  if (i < 0) return -1;
  Object.assign(app.slots[i], { ctrl, owner, dev, label: ctrl === 'remote' ? (app.guestNames[owner] || 'Online') + ' · ' + (I.DEVICE_NAMES[dev] || dev) : I.DEVICE_NAMES[dev] });
  // A drop-in after the stage's human count was taken grows what is left of the stage to match.
  if (app.sim) { const p = app.sim.players[i]; p.ctrl = ctrl; p.owner = owner; if (!p.dead) p.lives = Math.max(p.lives, 2); S.rescaleHumans(app.sim); }
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
    if (app.screen !== 'game') app.runId = newRunId();
    app.slots = m.slots || app.slots; app.screen = 'game';
    for (const e of m.ev || []) { A.play(e); if (e === 'bossdown' && m.s) latchKill(m.s.si, m.s.players); if (e === 'clear' && m.s) stageClear(m.s.si, m.s.god === 1, m.s.players); }
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
  app.runId = newRunId();
  app.screen = 'game'; app.paused = false; app.acc = 0;
  R.enterStage(app.sim.stageIdx); // C2: current stage + next, not the old eager pair
}
function hostStep() {
  const sim = app.sim;
  for (let i = 0; i < S.SLOTS; i++) {
    const s = app.slots[i], p = sim.players[i];
    p.ctrl = s.ctrl;
    if (s.ctrl === 'local') p.in = I.read(s.dev);
    else if (s.ctrl === 'remote') p.in = I.unpack(((app.remoteIn[s.owner] || {})[s.dev]) | 0);
  }
  S.step(sim);
  // Preload the next bosses' sheets as the campaign advances.
  R.bossImages(sim.stageIdx); if (sim.stageIdx < 11) R.bossImages(sim.stageIdx + 1);
  for (const e of sim.events) { A.play(e); app.pendingEv.push(e); if (e === 'bossdown') latchKill(sim.stageIdx, sim.players); if (e === 'clear') stageClear(sim.stageIdx, sim.god, sim.players); }
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
    A.music('');
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
      if (p.ok || p.start) { requestHubReturn(true); return; }
      if (p.back) {
        const hub = window.CoopHub && window.CoopHub.session;
        if (hub) hub.cancelReturn();
        app.hub.confirming = false;
        return;
      }
    }
    return;
  }
  if (app.confirmMain) {
    for (const d of devs) {
      const p = I.pressed(d);
      if (p.ok || p.start) { toMainMenu(true); return; }
      if (p.back) { app.confirmMain = false; return; }
    }
    return;
  }
  const menu = app.pauseMenu;
  if (menu && (app.screen !== menu.screen || (menu.dev !== 'keys' && devs.indexOf(menu.dev) < 0))) closePauseMenu();
  if (app.controls && app.screen !== app.controls.screen) app.controls = null;
  if (app.controls) { controlsInput(devs); return; }
  const keysMenu = !!(app.pauseMenu && app.pauseMenu.dev === 'keys');
  if (keysMenu) {
    // Both keyboard layouts drive the menu as one device, so a shared Enter counts once.
    const a = I.pressed('k1'), b = I.pressed('k2'), p = {};
    for (const k in a) p[k] = a[k] | b[k];
    pauseMenuInput(p, true);
  }
  const ctx = app.screen === 'game' ? 'game' : 'menu';
  for (const d of devs) {
    if (keysMenu && !I.isPad(d)) continue; // the keyboard already spent this frame on the menu
    const p = I.pressed(d, ctx);
    const i = slotOf(owner, d);
    if (app.pauseMenu && app.pauseMenu.dev === d) { pauseMenuInput(p, false); continue; }
    if (I.isPad(d) && p.view && MENU_SCREENS.indexOf(app.screen) >= 0) { openPauseMenu(d); return; }
    if (app.screen === 'title') {
      const n = titleItems().length;
      if (p.u) { app.menu = (app.menu + n - 1) % n; A.play('menu'); }
      if (p.d) { app.menu = (app.menu + 1) % n; A.play('menu'); }
      if (p.ok || p.start) { A.ensure(); chooseMenu(app.menu, d); return; }
    } else if (app.screen === 'lobby') {
      if (app.role === 'banked' && app.authority) {
        const view = app.authority.view();
        if (view.offerPractice && p.start) { abandonBanked(); return; }
        if (i < 0 && (p.a || p.ok)) { app.authority.claim(d); continue; }
        if (i < 0 && I.isPad(d) && p.back) { leaveLobby(); return; }
        if (i >= 0) {
          if (p.l || p.r) app.authority.cycle(d, 'fid', p.r ? 1 : -1);
          if (p.u || p.d) app.authority.cycle(d, 'weapon', p.d ? 1 : -1);
          if (p.back) app.authority.release(d);
        }
        if (p.start) { app.authority.ready(); return; }
        continue;
      }
      if (app.role === 'guest') {
        if (i < 0 && (p.a || p.ok)) app.net && app.net.send({ t: 'want', dev: d });
        if (i < 0 && I.isPad(d) && p.back) { leaveLobby(); return; }
        if (i >= 0) {
          if (p.l || p.r) app.net.send({ t: 'pick', dev: d, key: 'fid', d: p.r ? 1 : -1 });
          if (p.u || p.d) app.net.send({ t: 'pick', dev: d, key: 'weapon', d: p.d ? 1 : -1 });
          if (p.back) app.net.send({ t: 'leave', dev: d });
        }
      } else {
        if (i < 0 && (p.a || p.ok)) { A.ensure(); claimSlot('local', 0, d); continue; }
        if (i < 0 && I.isPad(d) && p.back) { leaveLobby(); return; }
        if (i >= 0) {
          if (p.l || p.r) cycle(i, 'fid', p.r ? 1 : -1);
          if (p.u || p.d) cycle(i, 'weapon', p.d ? 1 : -1);
          if (p.back) releaseSlot(i);
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
      // Power toggles free play: every stage open, for groups that just want to pick one.
      if (p.p) { app.settings.freePlay = !app.settings.freePlay; P.saveSettings(app.settings); A.play('menu'); }
      if (p.ok || p.start) {
        if (!P.isOpen(app.progress.get(), app.stageSel, app.settings.freePlay)) { A.play('hurt'); return; } // the screen says why
        startGame(); return;
      }
      if (p.back) { app.screen = 'lobby'; app.lobbyDirty = true; return; }
    } else if (app.screen === 'game') {
      if (app.role === 'banked' && app.authority) {
        const view = app.authority.view();
        if (view.offerPractice && p.start) { abandonBanked(); return; }
        if (I.isPad(d) && p.start) { openPauseMenu(d); return; }
        if (i < 0 && (p.a || (I.isPad(d) && p.ok)) && view.phase === 'playing') { app.authority.claim(d); I.latch(d); }
        // Jump is only a jump here. It used to release the seat to the AI mid-match.
        continue;
      }
      // Drop-in: any unassigned device presses ATTACK to take over a CPU Sproto.
      // A pad can also press A: a fresh pad has nothing else to do here.
      if (i < 0 && (p.a || (I.isPad(d) && p.ok))) {
        if (app.role === 'guest') app.net && app.net.send({ t: 'want', dev: d });
        else claimSlot('local', 0, d);
        I.latch(d); // the join press must not also swing or jump
      }
      const mode = app.role === 'guest' ? app.snap && app.snap.mode : app.sim && app.sim.mode;
      const over = mode === 'gameover' || mode === 'victory';
      if (p.start && over && app.role !== 'guest') { app.screen = 'lobby'; app.sim = null; app.lobbyDirty = true; return; }
      if (I.isPad(d) && p.start) { openPauseMenu(d); return; }
    }
  }
}
// Lobby -> title (Esc on a keyboard, B on a pad that holds no slot).
function leaveLobby() {
  if (app.role === 'banked' && app.authority) { app.authority.leave(); app.authority = null; }
  if (app.net) app.net.close();
  app.net = null; app.role = 'local'; app.screen = 'title';
}

// ---------- pause menu (and the menu on the lobby and stage screens) ----------
// Start on a pad, or Esc / P on the keyboard, during a run; View on a pad, Tab on the keyboard, or
// the MENU box with the mouse on the lobby, the stage select and in a run. Local play pauses.
// Online and server matches keep running, so the opener's inputs are held instead (both keyboard
// layouts when the keyboard opened it: it is one shared keyboard). dev is a pad id or 'keys'.
const KEY_DEVS = ['k1', 'k2'];
const MENU_SCREENS = ['lobby', 'stages', 'game'];
const menuDevs = dev => (dev === 'keys' ? KEY_DEVS : [dev]);
function pauseMenuItems() {
  const game = app.screen === 'game';
  const items = [game ? 'RESUME' : 'BACK', A.isMuted && A.isMuted() ? 'SOUND: OFF' : 'SOUND: ON'];
  if (game && F && F.ready() && app.hub.kind === 'account') items.push('SEND FEEDBACK'); // signed-in hub players only
  return items.concat(sharedItems(), ['MAIN MENU', 'RETURN TO BAR']);
}
function openPauseMenu(dev) {
  if (app.pauseMenu || app.hub.confirming || MENU_SCREENS.indexOf(app.screen) < 0) return;
  const m = { dev, sel: 0, held: false, screen: app.screen };
  if (app.screen === 'game') {
    if (app.role === 'local') app.paused = true;
    else if (app.role === 'banked' && app.authority && !app.authority.view().held) { app.authority.toggleHold(); m.held = true; }
  }
  for (const d of menuDevs(dev)) I.setMuted(d, true);
  app.pauseMenu = m;
  A.play('menu');
}
function closePauseMenu() {
  const m = app.pauseMenu;
  if (!m) return;
  app.pauseMenu = null; app.controls = null; app.confirmMain = false;
  if (m.screen === 'game') {
    if (app.role === 'local') app.paused = false;
    else if (m.held && app.role === 'banked' && app.authority && app.authority.view().held) app.authority.toggleHold();
  }
  for (const d of menuDevs(m.dev)) { I.setMuted(d, false); I.latch(d); } // the A that picked RESUME must not also jump
}
// p: one frame of menu edges. Pads: A selects, B, Start or View resumes. Keyboard: Enter / Space
// or Attack selects, Jump resumes (Esc, P and Tab resume from onKeyDown).
function pauseMenuInput(p, keyboard) {
  const m = app.pauseMenu, n = pauseMenuItems().length;
  if (p.u) { m.sel = (m.sel + n - 1) % n; A.play('menu'); }
  if (p.d) { m.sel = (m.sel + 1) % n; A.play('menu'); }
  if (p.back || (!keyboard && (p.start || p.view))) { closePauseMenu(); return; }
  if (!(p.ok || (keyboard && p.start))) return;
  pauseMenuChoose(pauseMenuItems()[m.sel]);
}
function pauseMenuChoose(item) {
  const m = app.pauseMenu;
  if (item === 'RESUME' || item === 'BACK') closePauseMenu();
  else if (item.startsWith('SOUND')) { A.toggle(); A.play('menu'); }
  else if (item === 'SEND FEEDBACK') {
    // Close the menu so the screenshot shows the game, and put it back when the window closes.
    const dev = m.dev;
    closePauseMenu();
    if (!F.open(() => openPauseMenu(dev))) openPauseMenu(dev);
  }
  else if (item === 'CONTROLLER SETTINGS') openControls(m.dev);
  else if (item.startsWith('FULL SCREEN')) toggleFullscreen();
  else if (item === 'MAIN MENU') toMainMenu(false);
  else if (item === 'RETURN TO BAR') { closePauseMenu(); requestHubReturn(runLive()); }
}
// MAIN MENU: back to the title. A live run asks first, like RETURN TO BAR; the pause menu stays
// open under the question, so local play stays paused until it is answered.
function toMainMenu(sure) {
  if (!sure && runLive()) { app.confirmMain = true; A.play('menu'); return; }
  closePauseMenu();
  leaveLobby();
  Object.assign(app, { sim: null, snap: null, prevSnap: null, paused: false, code: '', hostChoosing: null, msgT: 0 });
  app.slots = defaultSlots();
  A.play('menu');
}

// ---------- controller settings ----------
// One tab per device: both keyboard layouts and four pad slots. Every action can be rebound
// (press-to-bind), pads also have the left-stick dead zone. Saved in localStorage by input.js
// (Input.Controls) and applied at once. The game has no vibration, so there is no rumble switch.
const CC = I.Controls;
const CTRL_TABS = ['k1', 'k2', 'gp0', 'gp1', 'gp2', 'gp3'];
const ACTION_NAMES = { l: 'LEFT', r: 'RIGHT', u: 'UP', d: 'DOWN', a: 'ATTACK', j: 'JUMP', s: 'SPECIAL / BLOCK', p: 'POWER', start: 'START / CONFIRM' };
const controlsRows = () => CC.ACTIONS.concat(I.isPad(CTRL_TABS[app.controls.tab]) ? ['dz'] : [], ['reset', 'back']);
const devName = d => (I.DEVICE_NAMES[d] || d).toUpperCase();
function openControls(dev, from) {
  const tab = CTRL_TABS.indexOf(from || dev);
  app.controls = { dev, screen: app.screen, tab: tab < 0 ? 0 : tab, row: 0, cap: null, msg: '' };
  A.play('menu');
}
function closeControls() { app.controls = null; A.play('menu'); }
function setControls(cfg, msg) {
  CC.apply(cfg);
  app.controls.msg = CC.save(CC.get()) ? msg || 'SAVED' : 'APPLIED (THIS BROWSER CANNOT SAVE IT)';
  A.play('menu');
}
const bindLabel = (d, b) => (I.isPad(d) ? CC.padLabel(b) : CC.keyLabel(b));
function bound(r, d, action, b) {
  const moved = r.moved.map(m => bindLabel(d, b) + ' LEFT ' + (m.dev === d ? '' : devName(m.dev) + ' ') + ACTION_NAMES[m.action] + (m.to === '' || m.to === -1 ? ' (NOW UNBOUND)' : ' (NOW ' + bindLabel(d, m.to) + ')'));
  setControls(r.cfg, moved.length ? moved.join(' · ') : ACTION_NAMES[action] + ' = ' + bindLabel(d, b));
  app.controls.cap = null;
}
function controlsChoose(row) {
  const c = app.controls, d = CTRL_TABS[c.tab];
  if (row === 'back') closeControls();
  else if (row === 'reset') setControls(CC.reset(CC.get(), d), 'DEFAULTS RESTORED FOR ' + (I.isPad(d) ? devName(d) : 'THE KEYBOARD'));
  else if (row === 'dz') nudgeDeadzone(1, true);
  else {
    c.cap = { action: row, t: performance.now() };
    if (I.isPad(d)) CC.rawEdge(+d.slice(2)); // what is held now does not count
    c.msg = '';
    A.play('menu');
  }
}
function nudgeDeadzone(dir, wrap) {
  const c = app.controls, i = +CTRL_TABS[c.tab].slice(2), cfg = CC.get();
  let v = Math.round((cfg.dz[i] + dir * CC.DZ.step) * 100) / 100;
  if (v > CC.DZ.max) v = wrap ? CC.DZ.min : CC.DZ.max;
  if (v < CC.DZ.min) v = CC.DZ.min;
  cfg.dz[i] = v;
  setControls(cfg, 'DEAD ZONE ' + Math.round(v * 100) + '%');
}
function controlsInput(devs) {
  const c = app.controls, d = CTRL_TABS[c.tab];
  if (c.cap) {
    // Keys are caught in onKeyDown. Pads: the next button on the pad being set; View cancels.
    let cancel = performance.now() - c.cap.t > 8000;
    if (I.isPad(d)) {
      const b = CC.rawEdge(+d.slice(2));
      if (b === PadMap.BTN.VIEW) cancel = true;
      else if (b >= 0) { bound(CC.bindPad(CC.get(), +d.slice(2), c.cap.action, b), d, c.cap.action, b); I.latch(d); }
    }
    for (const x of devs) if (I.pressed(x).view && I.isPad(x)) cancel = true; // spends this frame's edges
    if (cancel && c.cap) { c.cap = null; c.msg = 'NOT CHANGED'; }
    return;
  }
  const p = {};
  for (const x of devs) {
    if (c.dev !== 'any' && menuDevs(c.dev).indexOf(x) < 0) continue;
    const e = I.pressed(x);
    for (const k in e) p[k] = (p[k] | 0) | e[k];
  }
  const rows = controlsRows(), n = rows.length;
  if (p.u) { c.row = (c.row + n - 1) % n; A.play('menu'); }
  if (p.d) { c.row = (c.row + 1) % n; A.play('menu'); }
  if (rows[c.row] === 'dz' && (p.l || p.r)) nudgeDeadzone(p.r ? 1 : -1, false);
  else if (p.l || p.r) { c.tab = (c.tab + (p.r ? 1 : CTRL_TABS.length - 1)) % CTRL_TABS.length; c.row = Math.min(c.row, controlsRows().length - 1); c.msg = ''; A.play('menu'); }
  if (p.back || p.view) { closeControls(); return; }
  if (p.ok || p.start) controlsChoose(controlsRows()[c.row]);
}
// Keyboard press-to-bind, from onKeyDown. Returns true when the key was spent here.
function controlsKey(e) {
  const c = app.controls;
  if (!c || !c.cap) return false;
  if (e.preventDefault) e.preventDefault();
  if (e.repeat) return true;
  const d = CTRL_TABS[c.tab];
  I.swallow(e.code);
  if (e.code === 'Escape') { c.cap = null; c.msg = 'NOT CHANGED'; return true; }
  if (I.isPad(d)) return true; // waiting for a pad button
  const r = CC.bindKey(CC.get(), d, c.cap.action, e.code);
  if (r.error) { c.msg = CC.keyLabel(e.code) + ' IS RESERVED (MENUS, SOUND, BAR, FEEDBACK, GOD MODE). PICK ANOTHER KEY'; A.play('hurt'); return true; }
  bound(r, d, c.cap.action, e.code);
  return true;
}

// ---------- feedback breadcrumbs ----------
// A few run events for the feedback note, read off the snapshot being drawn, so every role
// (local, host, guest, server match) reports the same way. A handful of compares per frame.
const seen = { role: 'local', run: false, si: -1, mode: '', lock: 0, boss: -1, down: false };
function noteRole() {
  if (app.role === seen.role) return;
  crumb('role_change', { from: seen.role, to: app.role });
  seen.role = app.role;
}
function noteRun(snap) {
  if (!seen.run || snap.si !== seen.si) {
    crumb('stage_start', { stage: snap.si + 1, name: M.bosses[snap.si] ? M.bosses[snap.si].stage : '', role: app.role });
    Object.assign(seen, { run: true, si: snap.si, mode: '', lock: 0, boss: -1, down: false });
  }
  if (snap.mode !== seen.mode) {
    if (snap.mode === 'clear') crumb('stage_clear', { stage: snap.si + 1 });
    else if (snap.mode === 'gameover' || snap.mode === 'victory') crumb('run_end', { result: snap.mode, stage: snap.si + 1 });
    seen.mode = snap.mode;
  }
  const boss = snap.boss ? snap.boss.ph : -1;
  if (boss !== seen.boss) {
    if (boss >= 0) crumb(seen.boss < 0 ? 'boss_start' : 'boss_phase', { stage: snap.si + 1, phase: boss + 1 });
    seen.boss = boss;
  }
  const lock = snap.lock ? 1 : 0;
  if (lock !== seen.lock) {
    if (lock && !snap.boss) crumb('wave_start', { stage: snap.si + 1, x: Math.round(snap.camX) });
    seen.lock = lock;
  }
  const acct = app.role === 'banked' && app.authority ? app.authority.accountId() : null;
  const down = snap.players.some(p => {
    const s = app.slots[p.s];
    const mine = !!s && (app.role === 'guest' ? s.ctrl === 'remote' && s.owner === app.myId : app.role === 'banked' ? s.ctrl !== 'cpu' && s.owner === acct : s.ctrl === 'local');
    return mine && p.st === 'down';
  });
  if (down !== seen.down) {
    if (down) crumb('player_down', { stage: snap.si + 1 });
    seen.down = down;
  }
}

// ---------- gamepad on the join dialog and the load-error screen ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // relay and hub room codes use the same set
function joinPadInput() {
  const code = document.getElementById('code');
  for (const d of I.devices()) {
    if (!I.isPad(d)) continue;
    const p = I.pressed(d);
    if (p.back) { document.getElementById('cancelJoin').click(); return; }
    if (p.ok || p.start) {
      if (code.value.trim()) document.getElementById('joinForm').requestSubmit();
      else toast('Enter the room code first');
      return;
    }
    if (p.u || p.d || p.l || p.r || p.a) {
      const r = PadMap.editCode(code.value, app.joinCursor, { u: p.u, d: p.d, l: p.l, r: p.r, del: p.a }, CODE_ALPHABET, code.maxLength);
      code.value = r.value; app.joinCursor = r.cursor;
      code.focus();
      code.setSelectionRange(r.cursor, Math.min(r.value.length, r.cursor + 1));
    }
  }
}
function loadErrorPadInput() {
  for (const d of I.devices()) {
    if (!I.isPad(d)) continue;
    const p = I.pressed(d);
    if (p.ok || p.a || p.start) { bootAssets(); return; }
  }
}

function chooseMenu(k, dev) {
  const item = titleItems()[k];
  if (item === 'RETURN TO BAR') { requestHubReturn(false); return; }
  if (item === 'CONTROLLER SETTINGS') { openControls('any', dev); return; }
  if (item && item.startsWith('FULL SCREEN')) { toggleFullscreen(); return; }
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
  if (note) note.textContent = app.joinKind === 'hub' ? '12-character code. It finds the match. It does not sign you in.' : 'Practice relay. No Tickets.';
  app.joinCursor = Math.min(code.value.length, code.maxLength - 1);
  const padHint = document.getElementById('joinPad');
  if (padHint) padHint.hidden = !I.devices().some(I.isPad);
  code.focus();
}
document.getElementById('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase(), name = document.getElementById('name').value.trim() || 'Guest';
  if (!code) return;
  hideJoin(); A.ensure();
  if (app.joinKind === 'hub' && app.authority) {
    app.authority.joinCode(code).catch(err => {
      toast((err && err.message) || 'Room not found');
      if (!app.authority || !app.authority.view().matchId) { app.role = 'local'; app.screen = 'title'; }
    });
    return;
  }
  joinOnline(code, name);
});
document.getElementById('cancelJoin').addEventListener('click', () => { hideJoin(); app.screen = 'title'; });
// Esc backs out of the dialog. The page key handler skips text fields, so it is caught here.
joinBox.addEventListener('keydown', e => {
  if (e.code !== 'Escape') return;
  e.preventDefault();
  document.getElementById('cancelJoin').click();
});
// Give the keyboard back to the game once the dialog closes.
function hideJoin() {
  joinBox.hidden = true;
  const el = document.activeElement;
  if (el && joinBox.contains(el) && el.blur) el.blur();
}

// God mode: press 9 twice within 0.75 s during a battle (same input as Sproto Arcade).
let lastNine = -Infinity;
// FULL SCREEN picked with a key: toggled here, inside the key's own handler, because browsers
// only grant full screen to a user gesture. The key is swallowed so the frame does not act on it.
function fsKey(e) {
  if (e.repeat || app.frozen || app.hub.confirming || app.confirmMain || app.controls) return false;
  const m = app.pauseMenu;
  const item = m ? (m.dev === 'keys' ? pauseMenuItems()[m.sel] : '') : app.screen === 'title' ? titleItems()[app.menu] : '';
  if (!item || !item.startsWith('FULL SCREEN')) return false;
  const L = I.LAYOUTS;
  if ([].concat(L.k1.a, L.k1.start, L.k2.a, L.k2.start).indexOf(e.code) < 0) return false;
  I.swallow(e.code);
  toggleFullscreen();
  return true;
}
function onKeyDown(e) {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (controlsKey(e) || fsKey(e)) return;
  // In browser full screen Esc belongs to the browser: it leaves full screen and does nothing else.
  if (e.code === 'Escape' && (document.fullscreenElement || performance.now() - fsLeftAt < 500)) return;
  if (app.controls) { if (e.code === 'Escape' && !e.repeat) closeControls(); if (e.code === 'Tab') e.preventDefault(); return; }
  if (app.confirmMain) { if (e.code === 'Escape') app.confirmMain = false; return; }
  if (e.code === 'Tab') {
    if (e.preventDefault) e.preventDefault();
    if (!e.repeat && !app.hub.confirming && MENU_SCREENS.indexOf(app.screen) >= 0) { if (app.pauseMenu) closePauseMenu(); else openPauseMenu('keys'); }
    return;
  }
  if (e.code === 'Escape' && app.pauseMenu && app.screen !== 'game') { closePauseMenu(); return; }
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
  if (e.code === 'Escape' && app.screen === 'lobby') leaveLobby();
  // Esc or P opens the pause menu in a run and closes any open one. Local play pauses; online and
  // server matches keep running with the keyboard's inputs held (what P alone used to do there).
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat && app.screen === 'game') {
    if (app.pauseMenu) closePauseMenu(); else openPauseMenu('keys');
    return;
  }
  if (e.code === 'KeyM') A.toggle();
}
addEventListener('keydown', onKeyDown);

// ---------- drawing screens ----------
const T = R.text;
const padUI = () => I.lastKind() === 'pad'; // the last device used picks the prompts
function drawTitle() {
  R.drawBackground(g, Math.floor(app.t / 600) % 12, app.t * 0.6);
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, S.W, S.H);
  T(g, 'SPROTO', S.W / 2, 56, 34, '#ffd23d', 'center');
  T(g, 'COOP BATTLE', S.W / 2, 96, 22, '#ff5a5a', 'center');
  T(g, S.SLOTS + ' armed Sprotos  vs  12 machine bosses', S.W / 2, 124, 7, '#fff', 'center');
  for (let i = 0; i < S.SLOTS; i++) {
    const o = { f: i % M.fighters.length, st: 'idle', t: app.t + i * 13, z: 0, fc: 1 };
    R.drawFighter(g, o, S.W / 2 - (S.SLOTS - 1) * 40 + i * 80, 214, 0, S.WEAPONS[i].id, S.WEAPONS[i]);
  }
  const items = titleItems();
  if (app.menu >= items.length) app.menu = 0;
  items.forEach((s, i) => {
    const y = 230 + i * 12;
    T(g, (app.menu === i ? '> ' : '  ') + s, S.W / 2 - 110, y, 8, app.menu === i ? '#ffd23d' : '#c8c6e0');
    hit(S.W / 2 - 114, y - 6, 240, 12, () => { app.menu = i; chooseMenu(i, 'k1'); }, () => { app.menu = i; });
  });
  T(g, padUI() ? 'PAD: A SELECT  ·  IN BATTLE  X ATTACK  A JUMP  B SPECIAL  Y POWER  START MENU' : 'WASD + F ATTACK  G/SPACE JUMP  H SPECIAL  R POWER  ·  ARROWS + , . /  \'  ·  ESC PAUSE', S.W / 2, 348, 6, '#9a98b8', 'center');
}
function drawLobby() {
  R.drawBackground(g, 4, app.t * 0.3);
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, S.W, S.H);
  const title = app.role === 'banked' ? 'SERVER LOBBY' : app.role === 'host' ? 'PRACTICE LOBBY' : app.role === 'guest' ? 'PRACTICE LOBBY (RELAY)' : 'LOCAL PRACTICE';
  T(g, title, 12, 22, 12, '#ffd23d');
  if (app.code) T(g, 'ROOM ' + app.code, S.W - 12, 22, 12, '#7aff8a', 'right');
  // One card per seat, centred: four seats get wider cards.
  const gap = 8, cw = Math.min(148, Math.floor((S.W - 16 - gap * (S.SLOTS - 1)) / S.SLOTS)), x0 = Math.round((S.W - S.SLOTS * cw - gap * (S.SLOTS - 1)) / 2);
  app.slots.forEach((s, i) => {
    const x = x0 + i * (cw + gap), y = 36;
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
    T(g, S.WEAPONS[s.weapon].name, x + cw / 2, y + 188, 7, '#ffd23d', 'center');
    const pv = S.PASSIVES[s.fid % S.PASSIVES.length]; // each Sproto's passive
    T(g, pv.name.toUpperCase(), x + cw / 2, y + 200, 5, '#8ef8d6', 'center');
    T(g, pv.text, x + cw / 2, y + 208, 4.5, '#c8c6e0', 'center');
    if (s.ctrl === 'cpu' && Math.floor(app.t / 30) % 2) T(g, padUI() ? 'PRESS A' : 'PRESS ATTACK', x + cw / 2, y + 222, 6, '#7aff8a', 'center');
    if (s.ctrl !== 'cpu') T(g, padUI() ? 'B = leave' : 'JUMP = leave', x + cw / 2, y + 222, 5, '#8a88a8', 'center');
  });
  const lines = padUI() ? padLobbyLines() : app.role === 'banked'
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
  const back = padUI() ? ' PAD: B WITH NO SLOT FOR TITLE, THEN RETURN TO BAR.' : ' B RETURNS TO THE BAR.';
  T(g, app.role === 'banked' ? bankedPayLine() + '.' + back : 'PRACTICE — NO TICKETS.' + back, S.W / 2, 346, 6, '#9a98b8', 'center');
}
function padLobbyLines() {
  if (app.role === 'banked') return ['A: take a pad   LEFT/RIGHT: Sproto   UP/DOWN: weapon   B: give it to AI', 'START: ready. The server owns seats, lives, and stage 1. B with no seat leaves.'];
  if (app.role === 'guest') return ['A: join a slot   LEFT/RIGHT: Sproto   UP/DOWN: weapon   B: leave', 'Waiting for the host to start…'];
  return ['A: join   LEFT/RIGHT: Sproto   UP/DOWN: weapon   B: leave', 'START: choose a stage — empty slots are CPU Sprotos. B with no slot: back'];
}
function drawStages() {
  const prog = app.progress.get();
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
    const open = P.isOpen(prog, i, app.settings.freePlay);
    g.fillStyle = !open ? 'rgba(0,0,0,.8)' : on ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.55)'; g.fillRect(x, y, cw, ch);
    if (!open) T(g, 'LOCKED', x + cw / 2, y + 32, 8, '#8a88a8', 'center');
    g.fillStyle = 'rgba(8,6,16,.9)'; g.fillRect(x, y + 62, cw, 20);
    T(g, String(i + 1), x + 6, y + 10, 8, on ? '#ffd23d' : '#fff');
    T(g, M.bosses[i].stage, x + 6, y + 72, M.bosses[i].stage.length > 17 ? 5 : 6, on ? '#ffd23d' : '#e8e6f8');
    g.strokeStyle = on ? (Math.floor(app.t / 10) % 2 ? '#ffd23d' : '#fff') : 'rgba(255,255,255,.18)'; g.lineWidth = on ? 3 : 1;
    g.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
  }
  const b = M.bosses[app.stageSel];
  if (P.isOpen(prog, app.stageSel, app.settings.freePlay)) T(g, 'BOSS: ' + b.machines[0].toUpperCase() + '  >  ' + b.machines[1].toUpperCase(), S.W / 2, 316, 8, '#ff8a8a', 'center');
  else T(g, 'LOCKED: CLEAR STAGE ' + app.stageSel + ' FIRST, OR TURN ON FREE PLAY', S.W / 2, 316, 7, '#ff8a8a', 'center');
  const fp = app.settings.freePlay;
  T(g, (fp ? 'FREE PLAY: ALL STAGES OPEN' : 'CLEAR A STAGE TO UNLOCK THE NEXT · ' + prog.unlocked + ' OF 12 OPEN') + '   ' + (padUI() ? 'Y' : 'POWER') + ': FREE PLAY ' + (fp ? 'OFF' : 'ON'), S.W / 2, 330, 5, fp ? '#7aff8a' : '#ffd23d', 'center');
  T(g, padUI() ? 'STICK / D-PAD: choose   A / START: fight   B: back to lobby' : 'ARROWS / STICK: choose   ATTACK / START: fight   JUMP / ESC: back to lobby', S.W / 2, 344, 6, '#c8c6e0', 'center');
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
  app.view = snap;
  noteRun(snap);
  R.bossImages(snap.si);
  // Seats played on this device get a marker so they can be found in a crowd.
  const mine = [];
  app.slots.forEach((sl, i) => { if (app.role === 'guest' ? sl.ctrl === 'remote' && sl.owner === app.myId : sl.ctrl === 'local') mine.push(i); });
  // End of run: stage reached, time, per-player totals and this browser's best run.
  const over = snap.mode === 'gameover' || snap.mode === 'victory';
  A.music(over ? '' : snap.boss && snap.boss.st !== 'dead' ? 'boss' : 'stage', snap.si);
  // A klaxon the moment the boss telegraphs a shot (lanes or a missile lock), not when it lands.
  const aiming = !!(snap.boss && snap.boss.st === 'fire' && snap.boss.t < 30);
  if (aiming && !app.aiming) A.play('warn');
  app.aiming = aiming;
  if (snap.god) app.godSeen = true;
  if (!over) app.summary = null;
  else if (!app.summary) {
    const sum = P.summarize(snap), god = app.godSeen || !mine.length; // watching or God Mode: not a record
    let res = P.recordRun(app.progress.get(), sum, god);
    if (res.newBest) app.progress.update(d => (res = P.recordRun(d, sum, god)).data);
    app.summary = { sum, res };
  }
  // Clearing stage N opens stage N + 1 for this player (not in God Mode, and only if you played).
  if (snap.mode === 'clear' && !app.godSeen && mine.length && P.clearStage(app.progress.get(), snap.si + 1).opened) {
    let opened = false;
    const next = app.progress.update(d => { const c = P.clearStage(d, snap.si + 1); opened = c.opened; return c.data; });
    if (opened) toast('STAGE ' + next.unlocked + ' UNLOCKED');
  }
  R.drawWorld(g, snap, { local: mine, noBanner: over });
  if (over) {
    const why = String((snap.banner && snap.banner.sub) || '').replace(' · press START', '');
    const menuKey = (padUI() ? 'VIEW' : 'ESC') + ': MENU';
    const prompt = app.role === 'guest' ? 'WAITING FOR THE HOST · ' + menuKey : app.role === 'banked' ? menuKey : (padUI() ? 'START' : 'ENTER') + ': BACK TO THE LOBBY · ' + menuKey;
    R.drawSummary(g, app.summary.sum, { why, prompt, local: mine, best: app.summary.res.best, newBest: app.summary.res.newBest, god: app.godSeen, blink: Math.floor(app.t / 30) % 2 });
  }
  if (app.role === 'banked' && banked) {
    T(g, banked.payout || bankedPayLine(), S.W / 2, 46, 6, '#ffd23d', 'center'); // under the player panels
    const note = banked.background ? 'TAB IN BACKGROUND — MATCH CONTINUES' : banked.held ? 'YOUR INPUTS ARE HELD — MATCH CONTINUES' : banked.phase === 'reconnecting' ? (banked.restarting ? 'SERVER RESTARTING — RECONNECTING' + (banked.resumeMs > 0 ? ' IN ' + Math.ceil(banked.resumeMs / 1000) + 's' : '…') : 'RECONNECTING ' + Math.ceil((banked.reconnectMs || 0) / 1000) + 's — NOT A LOCAL HOST') : '';
    if (note) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 64, S.W, 16); T(g, note, S.W / 2, 72, 6, '#ffd23d', 'center'); }
    if (banked.offerPractice) T(g, 'START BEGINS A NEW PRACTICE RUN', S.W / 2, 88, 6, '#fff', 'center');
  } else if (app.paused && !app.pauseMenu) { g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, S.W, S.H); T(g, 'PAUSED', S.W / 2, S.H / 2, 20, '#fff', 'center'); }
  const free = app.slots.some(s => s.ctrl === 'cpu');
  if (free && Math.floor(app.t / 40) % 2) T(g, padUI() ? 'PRESS A TO JOIN' : 'PRESS ATTACK TO JOIN', S.W / 2, S.H - 30, 6, '#7aff8a', 'center');
  if (app.code) T(g, 'ROOM ' + app.code, S.W - 6, S.H - 6, 6, '#7aff8a', 'right');
}

function drawPauseMenu() {
  const m = app.pauseMenu, items = pauseMenuItems(), game = m.screen === 'game';
  if (m.sel >= items.length) m.sel = 0;
  modal();
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, S.W, S.H);
  const w = 280, h = 64 + items.length * 18, x = (S.W - w) / 2, y = (S.H - h) / 2;
  g.fillStyle = 'rgba(10,8,22,.95)'; g.fillRect(x, y, w, h);
  g.fillStyle = '#ffd23d'; g.fillRect(x, y, w, 3);
  T(g, game && app.role === 'local' ? 'PAUSED' : 'MENU', S.W / 2, y + 18, 12, '#ffd23d', 'center');
  const held = app.role === 'banked' ? 'YOUR INPUTS ARE HELD' : (m.dev === 'keys' ? 'KEYBOARD' : I.DEVICE_NAMES[m.dev] || m.dev).toUpperCase() + ' IS HELD';
  if (game && app.role !== 'local') T(g, 'THE MATCH CONTINUES · ' + held, S.W / 2, y + 34, 5, '#c8c6e0', 'center');
  items.forEach((s, i) => {
    const iy = y + 50 + i * 18;
    T(g, (m.sel === i ? '> ' : '  ') + s, x + 60, iy, 8, m.sel === i ? '#ffd23d' : '#c8c6e0');
    hit(x, iy - 9, w, 18, () => { m.sel = i; pauseMenuChoose(s); }, () => { m.sel = i; });
  });
  T(g, m.dev === 'keys' ? 'ENTER SELECT   ESC ' + (game ? 'RESUME' : 'BACK') : 'A SELECT   B ' + (game ? 'RESUME' : 'BACK'), S.W / 2, y + h - 10, 5, '#9a98b8', 'center');
}
// A small MENU box for the mouse (and a reminder of the keys) on the lobby, stage select and runs.
function drawMenuButton() {
  if (app.pauseMenu || app.controls || MENU_SCREENS.indexOf(app.screen) < 0) return;
  const game = app.screen === 'game';
  if (game && performance.now() - app.mouseAt > 3000) return; // in a run only while the mouse is used
  const label = (padUI() ? 'VIEW' : game ? 'ESC' : 'TAB') + ' MENU', w = label.length * 5 + 10, x = S.W - w - 2, y = game ? 54 : 1;
  g.fillStyle = 'rgba(10,8,22,.85)'; g.fillRect(x, y, w, 12);
  g.strokeStyle = '#ffd23d'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, 11);
  T(g, label, x + w / 2, y + 6, 5, '#ffd23d', 'center');
  hit(x, y, w, 12, () => openPauseMenu('keys'));
}
// A yes / no question in the style of the RETURN TO THE BAR? box, with mouse buttons.
function drawConfirm(title, yes, no) {
  modal();
  g.fillStyle = 'rgba(10,8,22,.97)'; g.fillRect(48, 140, S.W - 96, 72);
  g.fillStyle = '#ffd23d'; g.fillRect(48, 140, S.W - 96, 3);
  T(g, title, S.W / 2, 156, 10, '#ffd23d', 'center');
  T(g, padUI() ? 'A CONFIRMS    B CANCELS' : 'ATTACK CONFIRMS    JUMP CANCELS', S.W / 2, 174, 6, '#fff', 'center');
  [['YES', yes, S.W / 2 - 70], ['NO', no, S.W / 2 + 10]].forEach(([s, act, bx]) => {
    g.strokeStyle = '#ffd23d'; g.lineWidth = 1; g.strokeRect(bx + 0.5, 186.5, 59, 15);
    T(g, s, bx + 30, 194, 7, '#fff', 'center');
    hit(bx, 186, 60, 16, act);
  });
}
function drawControls() {
  const c = app.controls, d = CTRL_TABS[c.tab], pad = I.isPad(d), rows = controlsRows(), cfg = CC.get();
  if (c.row >= rows.length) c.row = rows.length - 1;
  modal();
  g.fillStyle = '#0a0816'; g.fillRect(0, 0, S.W, S.H);
  g.fillStyle = '#ffd23d'; g.fillRect(0, 0, S.W, 3);
  T(g, 'CONTROLLER SETTINGS', 12, 16, 12, '#ffd23d');
  T(g, 'SAVED IN THIS BROWSER', S.W - 12, 16, 5, '#9a98b8', 'right');
  CTRL_TABS.forEach((t, i) => {
    const x = 12 + i * 103, on = i === c.tab, live = !I.isPad(t) || CC.padPresent(+t.slice(2));
    g.fillStyle = on ? 'rgba(255,210,61,.22)' : 'rgba(255,255,255,.08)'; g.fillRect(x, 28, 99, 14);
    if (on) { g.strokeStyle = '#ffd23d'; g.lineWidth = 1; g.strokeRect(x + 0.5, 28.5, 98, 13); }
    T(g, devName(t), x + 50, 35, 6, on ? '#ffd23d' : live ? '#fff' : '#6a6888', 'center');
    hit(x, 28, 99, 14, () => { c.tab = i; c.cap = null; c.msg = ''; });
  });
  const list = pad ? cfg.pads[+d.slice(2)] : cfg.keys[d];
  rows.forEach((r, i) => {
    const y = 54 + i * 17, on = i === c.row, capping = on && c.cap;
    if (on) { g.fillStyle = capping ? 'rgba(255,90,90,.25)' : 'rgba(255,210,61,.14)'; g.fillRect(12, y - 8, S.W - 24, 16); }
    const col = on ? '#ffd23d' : '#e8e6f8';
    hit(12, y - 8, S.W - 24, 16, () => { c.row = i; controlsChoose(r); }, () => { if (!c.cap) c.row = i; });
    if (r === 'back') { T(g, 'BACK', 24, y, 7, col); return; }
    if (r === 'reset') { T(g, 'RESET TO DEFAULTS' + (pad ? '' : ' (BOTH KEYBOARD SIDES)'), 24, y, 7, col); return; }
    if (r === 'dz') {
      T(g, 'LEFT STICK DEAD ZONE', 24, y, 7, col);
      T(g, '<  ' + Math.round(cfg.dz[+d.slice(2)] * 100) + '%  >', 260, y, 7, '#fff');
      hit(250, y - 8, 30, 16, () => { c.row = i; nudgeDeadzone(-1, false); });
      hit(300, y - 8, 30, 16, () => { c.row = i; nudgeDeadzone(1, false); });
      return;
    }
    T(g, ACTION_NAMES[r], 24, y, 7, col);
    let keys = (list[r] || []).map(b => bindLabel(d, b)).join('  ') || 'NONE';
    if (pad && 'lrud'.indexOf(r) >= 0) keys += '  + LEFT STICK';
    if (!pad && r === 'j' && I.GAME_LAYOUTS[d].j.length > list.j.length) keys += '  (+ SPACE IN BATTLE)';
    T(g, capping ? (pad ? 'PRESS A BUTTON ON ' + devName(d) + '…' : 'PRESS A KEY…') : keys, 260, y, 7, capping ? '#ff8a8a' : '#fff');
  });
  const info = pad
    ? ['MENUS: A OK, B BACK. START: PAUSE MENU. VIEW: MENU. THE LEFT STICK ALWAYS MOVES.', 'DOUBLE-TAP LEFT/RIGHT: DASH · DOWN+SPECIAL: SAVED POWER-UP · TAP SPECIAL: SPIN']
    : ['FIXED KEYS: ESC / P PAUSE · TAB MENU · M SOUND · B BAR · N N FEEDBACK · 9 9 GOD MODE', 'DOUBLE-TAP LEFT/RIGHT: DASH · DOWN+SPECIAL: SAVED POWER-UP · TAP SPECIAL: SPIN'];
  info.forEach((l, k) => T(g, l, S.W / 2, 268 + k * 11, 5, '#9a98b8', 'center'));
  const msg = c.cap ? (pad ? 'PRESS THE NEW BUTTON FOR ' + ACTION_NAMES[c.cap.action] + ' · VIEW OR ESC CANCELS' : 'PRESS THE NEW KEY FOR ' + ACTION_NAMES[c.cap.action] + ' · ESC CANCELS')
    : pad && !CC.padPresent(+d.slice(2)) ? devName(d) + ' IS NOT CONNECTED. PRESS ANY BUTTON ON IT.' : c.msg;
  if (msg) T(g, msg.length > 104 ? msg.slice(0, 103) + '…' : msg, S.W / 2, 300, 5, c.cap ? '#ff8a8a' : '#7aff8a', 'center');
  T(g, padUI() ? 'UP/DOWN CHOOSE · LEFT/RIGHT DEVICE · A CHANGE · B BACK' : 'UP/DOWN CHOOSE · LEFT/RIGHT DEVICE · ENTER / ATTACK CHANGE · ESC BACK', S.W / 2, 340, 6, '#c8c6e0', 'center');
}

// ---------- main loop ----------
// Runs through the crash guard: it always reschedules, a throw ends that frame (no further fixed
// steps), and after three failing frames in a row the game pauses behind the panel.
function frameStep(now) {
  const dt = Math.min(250, now - (app.last || now)); app.last = now; app.t++;
  I.poll(now);
  noteRole();
  if (app.screen !== 'game') { seen.run = false; app.summary = null; app.godSeen = false; A.music(app.screen === 'loading' ? '' : 'menu'); }
  // The feedback window is open over local play: the game holds still and reads no input.
  if (app.frozen) { /* frozen */ }
  else if (app.screen === 'join') joinPadInput();
  else if (app.screen === 'loading') { if (app.loadErr) loadErrorPadInput(); }
  else localDevicesInput();
  I.endFrame();
  // Whether the crash guard counts this frame as good: while the host sim runs, only a frame in
  // which a fixed step ran cleanly does, so a step that always throws still trips the panel at
  // 120/144 Hz. A throwing step drops the backlog instead of rerunning on a half-applied tick.
  let judged = true;
  if (app.screen === 'game' && app.role !== 'guest' && app.role !== 'banked' && app.sim && !app.paused && !app.frozen && !app.hub.confirming) {
    judged = C.fixedSteps(app, STEP, dt, hostStep) > 0 || dt === 0;
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

  hits.length = 0;
  g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false;
  g.fillStyle = '#000'; g.fillRect(0, 0, S.W, S.H);
  if (app.screen === 'loading') {
    T(g, app.loadErr ? 'COULD NOT LOAD ART' : 'LOADING SPROTOS…', S.W / 2, S.H / 2 - 8, 10, '#fff', 'center');
    g.fillStyle = '#3a3558'; g.fillRect(170, S.H / 2 + 16, 300, 6);
    g.fillStyle = '#ffd23d'; g.fillRect(170, S.H / 2 + 16, 300 * (app.loadK || 0), 6);
    if (app.loadErr) T(g, padUI() ? 'A RETRIES' : 'ATTACK OR ENTER RETRIES', S.W / 2, S.H / 2 + 40, 7, '#ff8a8a', 'center');
  }
  else if (app.screen === 'title' || app.screen === 'join') drawTitle();
  else if (app.screen === 'lobby') drawLobby();
  else if (app.screen === 'stages') drawStages();
  else if (app.screen === 'game') drawGame();
  if (!app.controls) drawHubStatus();
  drawMenuButton();
  if (app.pauseMenu) drawPauseMenu();
  if (app.controls) drawControls();
  if (app.confirmMain) drawConfirm('LEAVE THE RUN FOR THE MAIN MENU?', () => toMainMenu(true), () => { app.confirmMain = false; });
  if (app.msgT > 0) { app.msgT--; g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, S.H - 52, S.W, 16); T(g, app.msg, S.W / 2, S.H - 44, 6, '#fff', 'center'); }
  if (app.hub.confirming) drawConfirm('RETURN TO THE BAR?', () => requestHubReturn(true), cancelHubReturn);
  return judged;
}
function bankedPayLine() {
  const view = app.authority && app.authority.view && app.authority.view();
  if (window.NetHub && window.NetHub.payoutCopy) return window.NetHub.payoutCopy(view && view.receipt);
  return 'TICKETS PAID BY SERVER, SEE BALANCE';
}
function drawHubStatus() {
  const h = app.hub;
  const who = h.kind === 'account' ? 'ACCOUNT ' + h.label : h.kind === 'guest' ? 'GUEST' : h.kind === 'error' ? 'HUB ERROR' : 'OFFLINE';
  const bal = (h.kind === 'account' || h.kind === 'guest') && typeof h.balance === 'number' ? '   TICKETS ' + h.balance : '';
  const mode = app.role === 'banked' ? '   ·   ' + bankedPayLine() : '   ·   PRACTICE';
  if (app.screen === 'game') {
    // In a run the strip is a short tag under the player panels, so it never hides the P1-P6 labels.
    // The banked payout line is already drawn by drawGame.
    const line = who + bal + (app.role === 'banked' ? '' : mode);
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 41, line.length * 5 + 12, 10);
    T(g, line, 6, 46, 5, '#c8c6e0');
  } else {
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, S.W, 14);
    T(g, who + bal + mode, 6, 4, 5, '#c8c6e0');
  }
}
function cancelHubReturn() {
  const hub = window.CoopHub && window.CoopHub.session;
  if (hub) hub.cancelReturn();
  app.hub.confirming = false;
}
const frame = C.frameLoop(frameStep, crash);
requestAnimationFrame(frame);
const fontReady = document.fonts ? document.fonts.load('10px "Press Start 2P"').catch(() => {}) : Promise.resolve();
// C2 load boundary: title waits on lobby art; a failed critical file stays on this screen until retry.
function bootAssets() {
  if (app.loadErr) C.dismiss();
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
  }, err => {
    app.loadErr = (err && err.message) || 'asset failed'; app.screen = 'loading';
    crash.report(err, 'boot'); // the same panel, with Retry
  });
}
C.setRetry(bootAssets);
const hubJob = window.CoopHub ? window.CoopHub.boot({ release: releaseForHub, onChange: syncHub, progress: app.progress }) : null;
// Another tab saved this player's progress (or this browser's): take it in. Settings stay per tab
// until reload; only progress has to agree across tabs.
addEventListener('storage', e => { if (app.progress.watches(e.key)) app.progress.refresh(); });
if (F && hubJob) F.boot(app, hubJob);
bootAssets();
// The labels of the menu on screen (title or pause menu), for browser tests.
app.menuItems = () => (app.pauseMenu ? pauseMenuItems() : app.screen === 'title' ? titleItems() : []);
window.SprotoApp = app; // handy for debugging and browser tests
})();
