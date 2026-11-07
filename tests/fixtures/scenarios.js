// Shared golden scenarios. Loaded after manifest, sim, ai, and sha256 in every engine.
(function (root) {
'use strict';
const N = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 };
function slots(kind) {
  const n = root.MANIFEST.fighters.length;
  const out = [];
  for (let i = 0; i < 6; i++) {
    const ctrl = kind === 'cpu' ? 'cpu' : kind === 'mixed' ? (i < 2 ? 'local' : 'cpu') : 'local';
    const name = kind === 'cpu' ? ('CPU' + (i + 1)) : ('P' + (i + 1));
    out.push({ fid: i % n, weapon: i, ctrl: ctrl, name: name });
  }
  return out;
}
function policy(state, p, tick) {
  const inp = { l: 0, r: 0, u: 0, d: 0, a: 0, j: 0, s: 0, p: 0 };
  if (p.ctrl === 'cpu' || p.st === 'dead' || p.st === 'down') return inp;
  let foe = null, bd = 1e9;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (e.dead || e.st === 'lying') continue;
    const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y) * 2;
    if (d < bd) { bd = d; foe = e; }
  }
  const b = state.boss;
  if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'dead') {
    const d = Math.abs(b.x - p.x) * 0.7 + 30;
    if (!foe || d < bd) foe = { x: b.x - (b.face || 1) * (b.w * 0.45), y: b.y, boss: true };
  }
  let ufo = null, pow = null;
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    if (item.taken) continue;
    if (!ufo && item.kind === 'ufo') ufo = item;
    if (!pow && item.kind === 'power') pow = item;
  }
  let goal = null;
  if (ufo && p.slot === 0) goal = ufo;
  else if (pow && p.powers.length < 3 && p.slot === (tick % 6)) goal = pow;
  else if (foe) goal = foe;
  if (!goal) { inp.r = 1; return inp; }
  const dx = goal.x - p.x, dy = goal.y - p.y;
  if (dx > 18) inp.r = 1; else if (dx < -18) inp.l = 1;
  if (dy > 6) inp.d = 1; else if (dy < -6) inp.u = 1;
  const near = Math.abs(dx) < (goal === foe ? 54 : 16) && Math.abs(dy) < 16;
  if (near && goal === foe && tick % 8 === p.slot % 8) inp.a = 1;
  if (p.powers.length && tick % 240 === p.slot * 3) inp.p = 1;
  if (tick % 5 === 0) {
    for (let i = 0; i < state.projs.length; i++) {
      const pr = state.projs[i];
      if (pr.enemy && Math.abs(pr.y - p.y) < 12 && Math.abs(pr.x - p.x) < 40) { inp.j = 1; break; }
    }
  }
  return inp;
}
function legacyLocal(tick) {
  return { l: 0, r: tick % 100 < 70 ? 1 : 0, u: 0, d: 0, a: tick % 10 === 0 ? 1 : 0, j: tick % 45 === 0 ? 1 : 0, s: 0, p: 0 };
}
function legacySix(tick, slot) {
  return {
    l: 0, r: tick % 100 < 70 ? 1 : 0,
    u: slot % 2 === 0 && tick % 30 < 8 ? 1 : 0,
    d: slot % 2 === 1 && tick % 30 < 8 ? 1 : 0,
    a: tick % 12 === slot ? 1 : 0,
    j: tick % 80 === slot * 3 ? 1 : 0,
    s: 0, p: 0,
  };
}
function scripted(tick, slot) {
  return { l: 0, r: tick % 100 < 70 ? 1 : 0, u: slot % 2 === 0 && tick % 30 < 8 ? 1 : 0, d: 0, a: tick % 12 === slot ? 1 : 0, j: 0, s: 0, p: 0 };
}
function apply(state, tick, mode) {
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    if (p.ctrl === 'cpu') continue;
    if (mode === 'legacy-mixed') p.in = legacyLocal(tick);
    else if (mode === 'legacy-six') p.in = legacySix(tick, i);
    else if (mode === 'script') p.in = scripted(tick, i);
    else p.in = policy(state, p, tick);
  }
}
function hexOf(value) { return root.Sha256.hex(JSON.stringify(value)); }
function resumeTwin(state) {
  const packed = JSON.stringify(root.Sim.exportState(state));
  const a = root.Sim.importState(JSON.parse(packed));
  const b = root.Sim.importState(JSON.parse(packed));
  let lives = 0, powers = 0, items = state.items.length;
  for (let i = 0; i < state.players.length; i++) {
    lives += state.players[i].lives;
    powers += state.players[i].powers.length;
    if (a.players[i].lives !== state.players[i].lives) throw new Error('resume-lives');
    if (a.players[i].powers.length !== state.players[i].powers.length) throw new Error('resume-powers');
    if (JSON.stringify(a.players[i].powers) !== JSON.stringify(state.players[i].powers)) throw new Error('resume-powers');
  }
  if (a.items.length !== items || b.items.length !== items) throw new Error('resume-items');
  for (let tick = 0; tick < 120; tick++) {
    apply(a, tick, 'script');
    apply(b, tick, 'script');
    root.Sim.step(a);
    root.Sim.step(b);
    a.events.length = 0;
    b.events.length = 0;
  }
  const ha = hexOf(root.Sim.exportState(a));
  const hb = hexOf(root.Sim.exportState(b));
  if (ha !== hb) throw new Error('resume-diverged');
  return { lives: lives, powers: powers, items: items, steps: 120, hash: ha };
}
function runCase(spec) {
  const state = root.Sim.create(slots(spec.kind), spec.seed, spec.stage || 0);
  const flags = { ufo: 0, revive: 0, dead: 0, power: 0, boss: 0, bossPhase: 0 };
  let resumed = null;
  const limit = spec.ticks;
  for (let i = 0; i < limit && state.mode !== 'victory' && state.mode !== 'gameover'; i++) {
    if (spec.resumeAt === state.t) resumed = resumeTwin(state);
    apply(state, i, spec.input || 'policy');
    root.Sim.step(state);
    if (state.players.some(p => p.st === 'ufo')) flags.ufo++;
    for (let e = 0; e < state.events.length; e++) if (String(state.events[e]).indexOf('revive') === 0) flags.revive++;
    if (state.players.some(p => p.dead)) flags.dead++;
    if (state.players.some(p => p.powers.length)) flags.power++;
    if (state.boss) {
      flags.boss++;
      if (state.boss.phase > flags.bossPhase) flags.bossPhase = state.boss.phase;
    }
    state.events.length = 0;
  }
  if (spec.resumeAt != null && !resumed) throw new Error('resume-missed');
  const exported = root.Sim.exportState(state);
  const snap = root.Sim.snapshot(state);
  return {
    id: spec.id,
    kind: spec.kind,
    seed: spec.seed,
    stage: spec.stage || 0,
    tick: state.t,
    mode: state.mode,
    stageNow: state.stageIdx,
    flags: flags,
    stateHash: hexOf(exported),
    snapHash: hexOf(snap),
    stateBytes: JSON.stringify(exported).length,
    resume: resumed,
  };
}
function caseList() {
  const list = [
    { id: 'cpu-seed42-terminal', kind: 'cpu', seed: 42, stage: 0, ticks: 60 * 60 * 40, input: 'cpu' },
    { id: 'mixed-seed7-1800', kind: 'mixed', seed: 7, stage: 0, ticks: 1800, input: 'legacy-mixed' },
    { id: 'six-local-seed99-1800', kind: 'local', seed: 99, stage: 0, ticks: 1800, input: 'legacy-six' },
    { id: 'human-seed3-stage1', kind: 'local', seed: 3, stage: 0, ticks: 20000, input: 'policy', resumeAt: 2000 },
  ];
  for (let stage = 0; stage < 12; stage++) {
    list.push({ id: 'stage-' + stage + '-human', kind: 'local', seed: 4000 + stage * 17, stage: stage, ticks: 900, input: 'policy' });
    list.push({ id: 'stage-' + stage + '-mixed', kind: 'mixed', seed: 4000 + stage * 17, stage: stage, ticks: 700, input: 'policy' });
    list.push({ id: 'stage-' + stage + '-cpu', kind: 'cpu', seed: 4000 + stage * 17, stage: stage, ticks: 500, input: 'cpu' });
  }
  return list;
}
function runAll() {
  const started = Date.now();
  const cases = caseList().map(runCase);
  return {
    protocol: root.CoopProtocol.PROTOCOL_VERSION,
    loopHz: root.CoopProtocol.LIMITS.loopHz,
    substeps: root.CoopProtocol.LIMITS.substeps,
    snapshotHz: root.CoopProtocol.LIMITS.snapshotHz,
    content: hexOf(root.CoopProtocol.contentManifest(root.MANIFEST)),
    ms: Date.now() - started,
    cases: cases,
  };
}
root.Scenarios = { runAll: runAll, runCase: runCase, caseList: caseList, policy: policy };
if (typeof module !== 'undefined' && module.exports) module.exports = root.Scenarios;
})(typeof window !== 'undefined' ? window : globalThis);
