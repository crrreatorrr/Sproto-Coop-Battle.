// Pure presentation selection from serialized projectile, effect and boss ages.
(function (root) {
'use strict';
const rows = Object.freeze({ lane: 0, spread: 1, homing: 2, impact: 3,
  signature: 4, special: 5, hurt: 6, death: 7 });
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

root.CoopBossFxSelection = { rows, projectile, effect, overlays, clipFor };
if (typeof module !== 'undefined') module.exports = root.CoopBossFxSelection;
})(typeof window !== 'undefined' ? window : globalThis);
