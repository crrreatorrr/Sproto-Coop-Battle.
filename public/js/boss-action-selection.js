// Presentation selection uses only fields present in local/online snapshots.
(function (root) {
'use strict';
function select(boss, width = 640, screenX = boss?.x) {
  if (!boss || boss.st === 'transform') return null;
  const age = Number.isFinite(boss.t) ? Math.max(0, boss.t) : 0;
  if (boss.st === 'fire') {
    return { action: boss.mi ? 'homing' : boss.row === 2 ? 'spread' : 'lane', age };
  }
  if (boss.st === 'charge') {
    const warning = boss.ar === 1 ? 36 : 24;
    if (age < warning) return { action: 'charge-windup', age };
    const remaining = boss.fc < 0 ? screenX - 60 : width - 60 - screenX;
    if (remaining < 34) {
      // The existing simulation moves8.5px/tick toward this stop. Position
      // gives late/online snapshots the same short braking sequence directly.
      return { action: 'charge-brake', age: Math.min(4, Math.max(0, (34 - remaining) / 8.5)) };
    }
    return { action: 'charge-rush', age: age - warning, loop: true };
  }
  if (['sweep', 'signature', 'special', 'dead'].includes(boss.st)) {
    return { action: boss.st, age };
  }
  if (boss.st === 'idle') {
    if (boss.ar === 2 && boss.su !== undefined) return { action: 'summon', age: boss.su };
    // The first idle tick is the transformation and action handoff to the approved standing sprite.
    if (age === 0) return null;
  }
  return { action: 'walk', age, loop: true };
}
root.CoopBossActionSelection = { select };
if (typeof module !== 'undefined') module.exports = root.CoopBossActionSelection;
})(typeof window !== 'undefined' ? window : globalThis);
