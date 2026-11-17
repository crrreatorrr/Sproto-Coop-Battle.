// A renderer-owned sprite stream. The simulation supplies every playback age.
(function (root) {
'use strict';

function create(loader, options) {
  const timeline = root.CoopSpriteTimeline;
  if (!timeline || !options || typeof options.setPages !== 'function') {
    throw new Error('Sprite playback needs a timeline and a page owner');
  }
  const plans = new WeakMap();
  let identity = null, previousAge = 0, previousPlan = null;
  let held = null, heldFrame = -1, current = null;

  function release() {
    identity = null;
    previousPlan = null;
    current = null;
    held = null;
    heldFrame = -1;
    options.setPages([]);
  }
  function planFor(clip) {
    let plan = plans.get(clip);
    if (!plan) {
      plan = timeline.plan(clip, options.planOptions);
      plans.set(clip, plan);
    }
    return plan;
  }
  function sync(selection) {
    if (!selection?.clip) { release(); return null; }
    const plan = planFor(selection.clip);
    const age = Number.isFinite(selection.age) ? Math.max(0, selection.age) : 0;
    // A different encounter/state, phase change, rewind or reconnect cannot
    // display a retained cel from a previous animation while its page loads.
    if (identity !== selection.identity || previousPlan !== plan || age < previousAge) {
      held = null;
      heldFrame = -1;
    }
    identity = selection.identity;
    previousPlan = plan;
    previousAge = age;
    const frame = plan.at(age, !!selection.loop);
    const nextIndex = frame.pageIndex + 1;
    const next = plan.pages[nextIndex] || (selection.loop ? plan.pages[0] : null);
    const pages = [frame.page.src];
    if (next && next.src !== frame.page.src) pages.push(next.src);
    options.setPages(pages);
    current = { selection, plan, frame };
    return current;
  }
  function remember(image, plan, frame) {
    if (heldFrame === frame.frame) return;
    if (!held) {
      held = (options.createCanvas || (() => root.document.createElement('canvas')))();
      [held.width, held.height] = plan.cell;
    }
    const g = held.getContext('2d');
    g.clearRect(0, 0, held.width, held.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(image, frame.x, frame.y, ...plan.cell, 0, 0, ...plan.cell);
    heldFrame = frame.frame;
  }
  function draw(g, placement) {
    if (!current) return false;
    const { plan, frame } = current;
    const decoded = loader.loaded(frame.page.src);
    if (decoded && (decoded.naturalWidth !== frame.page.width || decoded.naturalHeight !== frame.page.height)) {
      throw new Error('Sprite page dimensions disagree: ' + frame.page.src);
    }
    if (decoded) remember(decoded, plan, frame);
    const picture = decoded || held;
    if (!picture) return false;
    const [w, h] = plan.cell, [ax, ay] = plan.anchor;
    const scale = placement.extent / Math.max(w, h);
    g.save();
    g.imageSmoothingEnabled = false;
    g.translate(Math.round(placement.x), Math.round(placement.y));
    if (placement.facing > 0) g.scale(-1, 1);
    if (placement.alpha !== undefined) g.globalAlpha *= placement.alpha;
    if (placement.filter) g.filter = placement.filter;
    g.drawImage(picture, decoded ? frame.x : 0, decoded ? frame.y : 0, w, h,
      -Math.round(ax * scale), -Math.round(ay * scale), Math.round(w * scale), Math.round(h * scale));
    g.restore();
    return true;
  }
  return { sync, draw, release, planFor };
}

root.CoopSpriteClipPlayer = { create };
if (typeof module !== 'undefined') module.exports = root.CoopSpriteClipPlayer;
})(typeof window !== 'undefined' ? window : globalThis);
