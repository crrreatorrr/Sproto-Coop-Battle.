// Boss-specific state selection around the reusable, snapshot-aged sprite player.
(function (root) {
'use strict';
function create(loader, manifest, registry) {
  let selected = null;
  const stream = root.CoopSpriteClipPlayer.create(loader, {
    setPages: paths => loader.setActionPages(paths),
    planOptions: { anchorInside: true, maxTextureSide: 2048, maxPageBytes: 8 * 1024 * 1024,
      allowRepeatedSources: true,
      validateSource: src => /^assets\/bosses\/actions\/[a-z0-9/._-]+\.webp$/.test(src) && !src.split('/').includes('..') },
  });
  function sync(snapshot) {
    const b = snapshot.boss, key = manifest.bosses[snapshot.si]?.key;
    const pose = root.CoopBossActionSelection.select(b, 640, b ? b.x - snapshot.camX : 0);
    const clip = pose && registry?.bosses?.[key]?.phases?.[b.ph]?.actions?.[pose.action];
    if (!clip) { selected = null; stream.release(); return; }
    selected = { ...pose, key, phase: b.ph };
    stream.sync({ identity: `${key}/${b.ph}/${b.st}/${pose.action}`, clip, age: pose.age,
      loop: !!pose.loop });
  }
  function draw(g, key, phase, placement) {
    if (!selected || selected.key !== key || selected.phase !== phase) return false;
    return stream.draw(g, placement);
  }
  return { sync, draw, release: stream.release };
}
let singleton;
function shared() {
  if (!root.CoopSpriteTimeline?.plan || !root.CoopSpriteClipPlayer?.create ||
      !root.CoopBossActionSelection?.select) return null;
  if (!singleton) singleton = create(root.AssetLoader.shared(), root.MANIFEST, root.CoopBossTransformations?.animations);
  return singleton;
}
root.CoopBossActionPlayer = { create, shared };
})(typeof window !== 'undefined' ? window : globalThis);
