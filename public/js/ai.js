// CPU teammates: any slot not held by a human is a CPU Sproto, so every battle is four-strong.
(function (root) {
'use strict';
function think(state, p) {
  const S = root.Sim, inp = p.in;
  inp.l = inp.r = inp.u = inp.d = inp.a = inp.j = inp.s = inp.p = 0;
  if (p.st === 'dead') return;
  if (p.st === 'down') return;
  const ai = p.ai;
  ai.t++;
  if (ai.t % 30 === 0) ai.jitter = (S.rng(state) - 0.5) * 30;

  const go = (tx, ty, tol) => {
    const dx = tx - p.x, dy = ty - p.y;
    if (dx > (tol || 4)) inp.r = 1; else if (dx < -(tol || 4)) inp.l = 1;
    if (dy > 3) inp.d = 1; else if (dy < -3) inp.u = 1;
    return Math.abs(dx) <= (tol || 4) && Math.abs(dy) <= 3;
  };

  if (p.st === 'ufo') {
    const t = nearestFoe(state, p);
    if (t) { go(t.x - Math.sign(t.x - p.x || 1) * 120, t.y, 30); if (Math.abs(t.y - p.y) < 10) { p.face = t.x > p.x ? 1 : -1; inp.a = 1; } if (ai.t % 90 === 0) inp.s = 1; }
    return;
  }

  // CPU Sprotos revive humans and each other, once per life and stage for each downed Sproto.
  // The nearest CPU Sproto is sent; a downed human is always served before a downed CPU.
  p.ai.rescue = false;
  let downed = null;
  for (const o of state.players) if (o.st === 'down' && !o.npcRevived) (downed || (downed = [])).push(o);
  if (downed) downed.sort((a, b) => (a.ctrl === 'cpu') - (b.ctrl === 'cpu') || a.slot - b.slot);
  for (const o of downed || []) {
    let best = null, bd = 1e9;
    for (const c of state.players) {
      if (c === o || c.ctrl !== 'cpu' || !S.alive(c) || c.st === 'ufo') continue;
      const dd = Math.abs(c.x - o.x) + Math.abs(c.y - o.y);
      if (dd < bd) { bd = dd; best = c; }
    }
    if (best === p) {
      if (o.rescuer !== p.slot) { o.rescuer = p.slot; state.fx.push({ id: state.nextId++, kind: 'text', x: p.x, y: p.y, z: 80, t: 0, text: 'ON MY WAY!' }); }
      p.ai.rescue = true; go(o.x, o.y, 8); return;
    }
  }

  // Grab the UFO or a snack when useful.
  // CPUs never go for the UFO: it is for human players only.
  // Only items still on screen: one the camera has passed can never be reached.
  const item = state.items.find(i => ((i.kind === 'snack' && p.hp < 35) || i.kind === 'gem') && Math.abs(i.x - p.x) < 160 && i.x > state.camX + 16 && i.x < state.camX + S.W - 16);
  if (item) { go(item.x, item.y, 6); return; }

  const foe = nearestFoe(state, p);
  if (!foe) {
    // Advance with the team, spread across the belt, but never far ahead of a human who is
    // playing: the screen follows the leader, and CPUs must not start the next wave under them.
    // A human who has pressed nothing for five seconds is not waited for, so a run with only idle
    // humans still moves on and ends like an all-CPU run.
    let lead = -1e9;
    for (const o of state.players) if (o !== p && o.ctrl !== 'cpu' && S.alive(o) && (o.idle || 0) < S.IDLE_AFTER && o.x > lead) lead = o.x;
    const ahead = lead > -1e9 ? lead + 50 + p.slot * 18 : 1e9;
    const crate = state.items.find(i => i.kind === 'crate' && i.x > p.x - 20 && i.x - p.x < 160 && i.x < ahead + 40);
    if (crate) { if (go(crate.x - 30, crate.y, 6)) { p.face = 1; inp.a = ai.t % 14 === 0 ? 1 : 0; } return; }
    go(Math.min(state.camX + 420 + p.slot * 24, ahead), 12 + p.slot * 19 + ai.jitter * 0.3, 12);
    return;
  }
  const w = S.WEAPONS[p.weapon];
  const isBoss = foe.isBoss;
  // Teammates fan out: each seat keeps its own distance and lane offset from the same foe.
  const reach = isBoss ? foe.w * 0.42 + w.reach * 0.55 : w.reach * [0.7, 0.58, 0.8, 0.64, 0.76, 0.52][p.slot];
  // When a teammate is on the same Shadow Sproto, even seats take its left and odd seats its
  // right (unless that side is off screen), so the team surrounds instead of stacking.
  let side = p.x < foe.x ? -1 : 1;
  if (!isBoss && foe.mates) {
    const pref = p.slot % 2 ? 1 : -1, px = foe.x + pref * reach;
    if (px > state.camX + 24 && px < state.camX + S.W - 24) side = pref;
  }
  // A guarding elite is attacked from behind when a teammate holds its attention.
  if (foe.guard && foe.aim !== p.slot) side = -foe.face;
  const laneOff = isBoss ? [-26, 26, -12, 12, 0, -20][p.slot] : [-6, 6, -3, 3, 0, -5][p.slot];
  // Step out of a warned boss lane (CPUs react late, so they still get caught sometimes).
  const bs = state.boss;
  if (bs && bs.st === 'fire' && bs.warn && bs.t > 12 && S.rng(state) < 0.7) {
    const inLane = bs.warn.find(ly => Math.abs(ly - p.y) < 12);
    if (inLane !== undefined) { if (p.y > inLane || inLane < 18) inp.d = 1; else inp.u = 1; return; }
  }
  // Get out of the lane of a boss that is winding up a charge (not every time).
  // Each CPU decides once per charge whether it saw it coming.
  if (bs && bs.st === 'charge') {
    if (ai.charge !== bs.cycle) { ai.charge = bs.cycle; ai.dodge = S.rng(state) < 0.75; }
    // Out of its lane, and stay out until it has gone past.
    if (ai.dodge && (p.x - bs.x) * bs.tx > -40) { if (Math.abs(bs.y - p.y) < 26) { if (p.y > bs.y || bs.y < 28) inp.d = 1; else inp.u = 1; } return; }
  }
  // Step out of a burning lane or off a bomb mark (late, and not every time).
  for (const h of state.hazards || []) {
    if (p.x > h.x0 - 6 && p.x < h.x1 + 6 && Math.abs(p.y - h.y) < h.half + 2 && S.rng(state) < 0.7) { if (p.y > h.y || h.y < 20) inp.d = 1; else inp.u = 1; return; }
  }
  for (const pr of state.projs) {
    if (pr.lob && pr.t > 14 && Math.abs(pr.tx - p.x) < 34 && Math.abs(pr.ty - p.y) < 16 && S.rng(state) < 0.7) { if (p.x < pr.tx) inp.l = 1; else inp.r = 1; return; }
  }
  // Jump the boss's rear sweep when caught behind it (late, like every CPU reaction).
  if (bs && bs.st === 'sweep' && (p.x - bs.x) * bs.tx > 0 && bs.t >= S.SWEEP_WARN - 8 && bs.t <= S.SWEEP_WARN - 4 && p.st !== 'jump' && S.rng(state) < 0.35) { inp.j = 1; return; }
  // Dodge incoming shots by jumping.
  for (const pr of state.projs) if (pr.enemy && Math.abs(pr.y - p.y) < 12 && Math.sign(p.x - pr.x) === Math.sign(pr.vx) && Math.abs(pr.x - p.x) < 50 && p.st !== 'jump' && S.rng(state) < 0.06) { inp.j = 1; return; }
  // Wait a little inside the screen edge, each seat at its own depth, rather than all on the rim.
  const rim = isBoss ? 16 : 34 + p.slot * 13;
  // Never line up inside a burning lane: stand just beside it instead.
  let ty = foe.y + laneOff + (isBoss ? ai.jitter * 0.2 : 0);
  for (const h of state.hazards || []) if (Math.abs(ty - h.y) < h.half + 4 && p.x > h.x0 - 30 && p.x < h.x1 + 30) ty = h.y + (p.y >= h.y && h.y < S.DEPTH - 24 || h.y < 24 ? 1 : -1) * (h.half + 7);
  const inPlace = go(S.clamp(foe.x + side * reach, state.camX + rim, state.camX + S.W - rim), ty, isBoss ? 14 : 6);
  if (inPlace || (Math.abs(foe.x - p.x) < reach + 6 && Math.abs(ty - p.y) < (isBoss ? 14 : 10))) {
    inp.l = inp.r = 0;
    const at = p.x < foe.x ? -1 : 1; // the side this Sproto is actually on
    if (p.face !== -at) { if (at < 0) inp.r = 1; else inp.l = 1; }
    const crowd = state.enemies.filter(e => !e.dead && Math.abs(e.x - p.x) < 50 && Math.abs(e.y - p.y) < 16).length;
    if (crowd >= 3 && p.hp > 40 && S.rng(state) < 0.02) inp.s = 1;
    else if ((ai.t + p.slot * 5) % 17 === 0 && S.rng(state) < 0.8) { inp.a = 1; if (foe.guard && (p.x - foe.x) * foe.face >= 0) { inp.u = 1; inp.d = 0; } } // launcher: under the guard
  }
}
function nearestFoe(state, p) {
  // A Shadow Sproto a teammate is already on counts as further away, and the current one as a
  // little nearer, so four Sprotos spread over the wave and do not swap targets every tick.
  const taken = {};
  for (const o of state.players) if (o !== p && o.ai.foe && o.st !== 'down' && o.st !== 'dead') taken[o.ai.foe] = (taken[o.ai.foe] || 0) + 1;
  let best = null, bd = 1e9;
  for (const e of state.enemies) {
    if (e.dead || e.st === 'lying') continue;
    const off = e.x < state.camX + 10 || e.x > state.camX + root.Sim.W - 10 ? 200 : 0; // still walking on: let it come
    const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y) * 2 + (taken[e.id] || 0) * 45 - (p.ai.foe === e.id ? 25 : 0) + off;
    if (d < bd) { bd = d; best = e; }
  }
  p.ai.foe = best ? best.id : 0;
  if (best) best = { x: best.x, y: best.y, id: best.id, mates: taken[best.id] || 0, face: best.face, guard: best.elite && best.guard > 0 ? 1 : 0, aim: best.target ? best.target.slot : -1 };
  const b = state.boss;
  if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'dead') {
    const d = Math.abs(b.x - p.x) * 0.8 + 40;
    if (d < bd || (p.slot % 2 === 0)) { p.ai.foe = 0; return { x: b.x, y: b.y, isBoss: true, w: b.w }; }
  }
  return best;
}
root.SproAI = { think };
if (typeof module !== 'undefined') module.exports = root.SproAI;
})(typeof window !== 'undefined' ? window : globalThis);
