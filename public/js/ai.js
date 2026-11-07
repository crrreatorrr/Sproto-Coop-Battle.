// CPU teammates: any slot not held by a human is a CPU Sproto, so every battle is six-strong.
(function (root) {
'use strict';
function think(state, p) {
  const S = root.Sim, inp = p.in;
  inp.l = inp.r = inp.u = inp.d = inp.a = inp.j = inp.s = 0;
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

  // CPU Sprotos revive human players only (never other CPUs), and only once per life.
  // The first time a human goes down, the nearest CPU Sproto is sent to save them.
  p.ai.rescue = false;
  for (const o of state.players) {
    if (o.st !== 'down' || o.ctrl === 'cpu' || o.npcRevived) continue;
    let best = null, bd = 1e9;
    for (const c of state.players) {
      if (c.ctrl !== 'cpu' || !S.alive(c) || c.st === 'ufo') continue;
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
  const item = state.items.find(i => ((i.kind === 'snack' && p.hp < 35) || i.kind === 'gem') && Math.abs(i.x - p.x) < 160);
  if (item) { go(item.x, item.y, 6); return; }

  const foe = nearestFoe(state, p);
  if (!foe) {
    // Advance with the team, spread across the belt.
    const crate = state.items.find(i => i.kind === 'crate' && i.x > p.x - 20 && i.x - p.x < 160);
    if (crate) { if (go(crate.x - 30, crate.y, 6)) { p.face = 1; inp.a = ai.t % 14 === 0 ? 1 : 0; } return; }
    go(state.camX + 420 + p.slot * 24, 12 + p.slot * 19 + ai.jitter * 0.3, 12);
    return;
  }
  const w = S.WEAPONS[p.weapon];
  const isBoss = foe.isBoss;
  const reach = isBoss ? foe.w * 0.42 + w.reach * 0.55 : w.reach * 0.7;
  const side = p.x < foe.x ? -1 : 1;
  const laneOff = isBoss ? [-26, 26, -12, 12, 0, -20][p.slot] : 0;
  // Step out of a warned boss lane (CPUs react late, so they still get caught sometimes).
  const bs = state.boss;
  if (bs && bs.st === 'fire' && bs.warn && bs.t > 12 && S.rng(state) < 0.7) {
    const inLane = bs.warn.find(ly => Math.abs(ly - p.y) < 12);
    if (inLane !== undefined) { if (p.y > inLane || inLane < 18) inp.d = 1; else inp.u = 1; return; }
  }
  // Dodge incoming shots by jumping.
  for (const pr of state.projs) if (pr.enemy && Math.abs(pr.y - p.y) < 12 && Math.sign(p.x - pr.x) === Math.sign(pr.vx) && Math.abs(pr.x - p.x) < 50 && p.st !== 'jump' && S.rng(state) < 0.06) { inp.j = 1; return; }
  const inPlace = go(foe.x + side * reach, foe.y + laneOff + (isBoss ? ai.jitter * 0.2 : 0), isBoss ? 14 : 6);
  if (inPlace || (Math.abs(foe.x - p.x) < reach + 6 && Math.abs(foe.y + laneOff - p.y) < (isBoss ? 14 : 10))) {
    inp.l = inp.r = 0;
    if (p.face !== -side) { if (side < 0) inp.r = 1; else inp.l = 1; }
    const crowd = state.enemies.filter(e => !e.dead && Math.abs(e.x - p.x) < 50 && Math.abs(e.y - p.y) < 16).length;
    if (crowd >= 3 && p.hp > 40 && S.rng(state) < 0.02) inp.s = 1;
    else if ((ai.t + p.slot * 5) % 17 === 0 && S.rng(state) < 0.8) inp.a = 1;
  }
}
function nearestFoe(state, p) {
  let best = null, bd = 1e9;
  for (const e of state.enemies) {
    if (e.dead || e.st === 'lying') continue;
    const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y) * 2;
    if (d < bd) { bd = d; best = e; }
  }
  const b = state.boss;
  if (b && b.hp > 0 && b.st !== 'enter' && b.st !== 'dead') {
    const d = Math.abs(b.x - p.x) * 0.8 + 40;
    if (d < bd || (p.slot % 2 === 0)) return { x: b.x, y: b.y, isBoss: true, w: b.w };
  }
  return best;
}
root.SproAI = { think };
if (typeof module !== 'undefined') module.exports = root.SproAI;
})(typeof window !== 'undefined' ? window : globalThis);
