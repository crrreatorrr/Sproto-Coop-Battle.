(function (root) {
'use strict';
// Portable combat rules. These use simulation ticks and numeric coordinates only;
// input, transport, animation, and the arena's collision boxes belong to adapters.
const Combat = Object.freeze({
  isActiveTick: (tick, startup, active) => tick > startup && tick <= startup + active,
  healthAfterHeal: (hp, maximum, amount) => Math.max(hp, Math.min(maximum, hp + Math.max(0, amount))),
  unlockedTier(clears, tierCount) {
    let tier = 1;
    while (tier < tierCount && (clears & (1 << (tier - 1)))) tier++;
    return tier;
  },
  aimVector(dx, dy, speed) {
    const length = Math.sqrt(dx * dx + dy * dy);
    return length > 0 ? { vx: dx * speed / length, vy: dy * speed / length } : { vx: 0, vy: 0 };
  },
  // Swept point vs. a box using the common interval along all three axes.
  segmentHitsBox(x0, y0, z0, x1, y1, z1, minX, maxX, minY, maxY, minZ, maxZ) {
    let enter = 0, exit = 1;
    for (let axis = 0; axis < 3; axis++) {
      const start = axis === 0 ? x0 : axis === 1 ? y0 : z0;
      const end = axis === 0 ? x1 : axis === 1 ? y1 : z1;
      const min = axis === 0 ? minX : axis === 1 ? minY : minZ;
      const max = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;
      const delta = end - start;
      if (!delta) { if (start < min || start > max) return false; continue; }
      const a = (min - start) / delta, b = (max - start) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) return false;
    }
    return true;
  },
});
if (typeof module !== 'undefined' && module.exports) module.exports = Combat;
root.CombatKernel = Combat;
})(typeof window !== 'undefined' ? window : globalThis);
