// Pure presentation selection from serialized projectile, effect and boss ages.
(function (root) {
'use strict';
const rows = Object.freeze({ lane: 0, spread: 1, homing: 2, impact: 3,
  signature: 4, special: 5, hurt: 6, death: 7 });
// Hand and muzzle positions in the left-facing Last Call actor cels.
const barPorts = [
  [
    [[34, 63], [37, 54], [42, 55]], // Snack burst follows the throwing hand through the burst.
    [[117, 27]], // Raised hand for the beer lob.
    [[51, 70]], [[44, 90]], [[38, 51]],
  ],
  [
    [[16, 27], [18, 27]], // Bill tip.
    [[59, 30], [58, 32]], // Dorsal launcher in its two firing poses.
    [[64, 61], [64, 61]], // Speaker below the bill.
  ],
];
// A short visual lead-in joins the authoritative flight path. The
// simulation and serialized snapshots remain untouched.
const BAR_RELEASE_TRAVEL = 16;
const ageOf = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const owner = value => value && Number.isSafeInteger(value.bi) && value.bi >= 0 &&
  (value.ph === 0 || value.ph === 1);

function selected(value, purpose, age, life, loop = false) {
  if (!owner(value)) return null;
  return { bossIndex: value.bi, phase: value.ph, purpose, row: rows[purpose],
    age: ageOf(age), life, loop, ended: life !== null && ageOf(age) >= life };
}
function projectile(value) {
  if (value?.k !== 'boss') return null;
  return selected(value, value.r === 3 ? 'homing' : value.r === 1 ? 'spread' : 'lane', value.t, null, true);
}
function barFireColumn(phase, attack, tick) {
  if (tick < 30) return Math.min(3, Math.floor(tick / 7.5));
  const age = tick - 30;
  if (phase && attack === 1) {
    return age <= 20 ? 4 + Math.floor(age / 5) % 2 : age < 32 ? 6 : 7;
  }
  return 4 + Math.min(3, Math.floor(age / 7));
}

function projectileOrigin(boss, shot, manifest, extent, players = []) {
  if (boss?.st !== 'fire' || !owner(shot) || shot.k !== 'boss' ||
      shot.bi !== boss.bi || shot.ph !== boss.ph || !Number.isFinite(shot.t) ||
      shot.t < 0 || shot.t > BAR_RELEASE_TRAVEL || (boss.fc !== -1 && boss.fc !== 1)) return null;
  const info = manifest?.bosses?.[boss.bi];
  const attack = boss.ph ? shot.ma : shot.ba;
  if (info?.attacks !== 'bar' || attack !== boss.ba) return null;
  const ports = barPorts[boss.ph]?.[attack];
  if (!ports) return null;

  const age = Math.max(0, shot.t - 1);
  const releaseTick = Math.round(boss.t - age);
  const cel = barFireColumn(boss.ph, attack, releaseTick) - 4;
  const [x, y] = ports[Math.max(0, Math.min(cel, ports.length - 1))];
  const { actorCell, actorFoot } = info.phases[boss.ph];
  const scale = extent / actorCell;
  const startX = boss.x - boss.fc * (x * scale - Math.round(extent / 2));
  const startZ = Math.round(actorFoot * scale) - y * scale;
  let remaining = 1 - age / BAR_RELEASE_TRAVEL;
  if (age > 0 && shot.ba !== 1) {
    // Shorten the lead-in when a nearby player could already be hit.
    for (const player of players) {
      if (player.c === 'none' || player.st === 'dead' || player.st === 'down' ||
          player.st === 'ufo' || shot.z > player.z + 65 || shot.z < player.z - 14) continue;
      const distance = Math.hypot(shot.x - player.x, shot.y - player.y);
      remaining = Math.min(remaining, Math.max(0, (distance - 25) / 55));
    }
    if (remaining === 0) return null;
  }
  const blend = 1 - remaining ** 2;
  const follow = (start, target) => start + (target - start) * blend;
  return {
    x: follow(startX + shot.vx * age, shot.x),
    y: follow(boss.y, shot.y),
    z: follow(startZ, shot.z),
  };
}
function effect(value) {
  if (value?.k === 'bossSpecialImpact') return selected(value, 'special', value.t, 36);
  if (value?.k === 'bossImpact') {
    // The event owns this marker and phase. Its actor may already be idle,
    // attacking differently, transforming, gone, or replaced by another boss.
    return selected(value, value.sm === 70 ? 'signature' : 'impact', value.t, 24);
  }
  return null;
}
function overlays(boss) {
  if (!owner(boss) || boss.st === 'transform') return [];
  if (boss.st === 'dead') {
    const choice = selected(boss, 'death', boss.t, 151);
    return choice.ended ? [] : [choice];
  }
  if (Number.isFinite(boss.fl) && boss.fl > 0) {
    return [selected(boss, 'hurt', 6 - Math.min(6, boss.fl), 6)];
  }
  return [];
}
function clipFor(registry, manifest, choice) {
  if (!choice) return null;
  const key = manifest?.bosses?.[choice.bossIndex]?.key;
  return key && registry?.bosses?.[key]?.phases?.[choice.phase]?.fx?.[choice.purpose] || null;
}

root.CoopBossFxSelection = { rows, projectile, barFireColumn, projectileOrigin, effect, overlays, clipFor };
if (typeof module !== 'undefined') module.exports = root.CoopBossFxSelection;
})(typeof window !== 'undefined' ? window : globalThis);
