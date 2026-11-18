// Pure presentation selection from serialized projectile, effect and boss ages.
(function (root) {
'use strict';
const rows = Object.freeze({ lane: 0, spread: 1, homing: 2, impact: 3,
  signature: 4, special: 5, hurt: 6, death: 7 });
// Positions are measured in world pixels from the actor's foot anchor in
// the left-facing release frame. The renderer mirrors them with the actor.
// Slots follow lane, spread and homing, or Last Call's own attack rows.
// A pair of front ports lists the lower outlet first and the upper outlet second.
const launchPorts = {
  '01-marina-bront': { color: '#b7ef61', phases: [
    { front: [[-108, 38], [-95, 114], [-88, 161]], rear: [[75, 95], [86, 97], [78, 96]], legacyLane: [[-106, 67], [87, 98]] },
    { front: [[-92, 57], [-95, 53], [[-85, 65], [-79, 157]]], rear: [[91, 71], [91, 71], [91, 71]] },
  ] },
  '02-last-light-vela': { color: '#4bffc7', phases: [
    { front: [[-85, 76], [-82, 50], null], rear: [[91, 148], [91, 148], null] },
    { front: [[-92, 106], [-84, 52], [[-83, 57], [-80, 168]]], rear: [[92, 67], [87, 73], [87, 74]] },
  ] },
  '03-mudline-crapto': { color: '#e279fa', phases: [
    { front: [[-96, 47], [-100, 101], [-84, 153]], rear: [[97, 126], [97, 126], [97, 126]] },
    { front: [[-101, 87], [-78, 43], [-84, 161]], rear: [[84, 130], [94, 146], [94, 147]] },
  ] },
  '04-ranch-zephyr': { color: '#ffac45', phases: [
    { front: [[-63, 68], [-80, 143], [-79, 143]], rear: [null, [75, 95], [82, 92]], legacyLane: [[-84, 121], null] },
    { front: [[-88, 143], [-82, 144], [-80, 159]], rear: [null, [83, 105], [83, 103]] },
  ] },
  '05-neon-sproto102': { color: '#ff824a', phases: [
    { front: [[-86, 108], [-89, 108], [-93, 149]], rear: [[92, 130], [92, 130], [92, 130]] },
    { front: [[-62, 70], [-84, 66], [[-80, 69], [-93, 116]]], rear: [[90, 90], [90, 90], [90, 90]] },
  ] },
  '06-circuit-rune': { color: '#f65a76', phases: [
    { front: [[-111, 86], [-102, 8], null], rear: [[74, 63], [74, 63], null] },
    { front: [[-47, 25], [-84, 46], [[-75, 28], [-94, 142]]], rear: [[76, 101], [76, 101], [76, 101]] },
  ] },
  '07-moonkeep-bigswole': { color: '#c58bfd', phases: [
    { front: [[-103, 42], [-82, 126], [-92, 112]], rear: [[70, 88], [70, 88], [70, 88]] },
    { front: [[-87, 59], [-84, 41], [[-95, 71], [-2, 167]]], rear: [[64, 85], [64, 85], [64, 85]] },
  ] },
  '08-crown-alpha777': { color: '#daee54', phases: [
    { front: [[-104, 68], [-96, 50], [-70, 163]], rear: [null, [72, 111], [72, 111]], legacyLane: [[-72, 163], null] },
    { front: [[-86, 73], [-96, 28], [-85, 45]], rear: [null, [76, 125], [76, 125]] },
  ] },
  '09-hatchery-highsproto': { color: '#4df3dc', phases: [
    { front: [[-96, 54], [-88, 116], [-61, 150]], rear: [[74, 100], [74, 100], [74, 100]] },
    { front: [[-104, 43], [[-105, 39], [-85, 114]], [[-80, 47], [-87, 124]]], rear: [[72, 106], [72, 106], [72, 106]] },
  ] },
  '10-verse-sprotosales': { color: '#fcb450', phases: [
    { front: [[-93, 61], [[-98, 40], [-96, 113]], null], rear: [[49, 107], [49, 107], null] },
    { front: [[-99, 43], [[-98, 30], [-72, 146]], [[-99, 53], [-96, 106]]], rear: [[69, 96], [69, 96], [69, 96]] },
  ] },
  '11-rooftop-sproto1668': { color: '#df8bff', phases: [
    { front: [[-101, 16], [-109, 70], [-99, 63]], rear: [[75, 88], [75, 88], [75, 88]] },
    { front: [[-93, 19], [-98, 112], [-84, 103]], rear: [[76, 87], [76, 87], [76, 87]] },
  ] },
  '12-codebreak-sproto3106': { color: '#7fdfff', phases: [
    { front: [[-70, 158], [-36, 27], [-65, 119]], rear: [null, [47, 139], [47, 139]] },
    { front: [[-87, 118], [-90, 99], [-88, 99]], rear: [null, [80, 100], [69, 134]] },
  ] },
  '13-last-call-sprotelbitcoin': { color: '#7afeff', phases: [
    { front: [[-73, 138], [-41, 196], [-50, 114], [-70, 106], [-76, 150]], rear: [[49, 115], [49, 115], [49, 115], [49, 115], [49, 115]] },
    { front: [null, [-43, 175], null], rear: [[64, 112], [64, 112], [64, 112]] },
  ] },
};
const LAUNCH_TICKS = 8;
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
function launch(boss, shot, manifest, authored = false) {
  if (boss?.st !== 'fire' || !owner(shot) || shot.k !== 'boss' ||
      shot.bi !== boss.bi || shot.ph !== boss.ph || !Number.isFinite(shot.t) ||
      shot.t < 0 || shot.t >= LAUNCH_TICKS || (boss.fc !== -1 && boss.fc !== 1)) return null;
  const config = launchPorts[manifest?.bosses?.[boss.bi]?.key];
  const phase = config?.phases[boss.ph];
  if (!phase) return null;
  const bespoke = shot.ba !== undefined || shot.ma !== undefined;
  // Bombs leave the front launcher even when their arc goes to a rear target.
  const lob = !bespoke && boss.ar === 3 && shot.r === 0;
  const front = lob || (shot.x - boss.x) * boss.fc >= 0;
  const row = bespoke ? (shot.ma ?? shot.ba) : projectile(shot).row;
  let port = (front ? phase.front : phase.rear)[row];
  if (row === 0 && !authored && phase.legacyLane) port = phase.legacyLane[front ? 0 : 1] ?? port;
  if (Array.isArray(port?.[0])) port = port[shot.y < boss.y ? 1 : 0];
  if (!port) return null;
  return { x: boss.x - boss.fc * port[0], y: boss.y, z: port[1],
    color: config.color, strength: 1 - shot.t / LAUNCH_TICKS };
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

root.CoopBossFxSelection = { rows, projectile, launch, effect, overlays, clipFor };
if (typeof module !== 'undefined') module.exports = root.CoopBossFxSelection;
})(typeof window !== 'undefined' ? window : globalThis);
