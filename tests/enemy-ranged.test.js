// Shadow Sproto shots run on the host and must stay dodgeable on every seat.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
globalThis.window = globalThis;
require('../public/js/manifest.js');
const Sim = require('../public/js/sim.js');

function arena(weapon, { humans = 1, left = false, height = 32 } = {}) {
  const config = Array.from({ length: Sim.SLOTS }, (_, slot) => ({
    fid: 0, weapon: 0, ctrl: slot === 0 ? 'local' : slot < humans ? 'remote' : Sim.EMPTY,
  }));
  const game = Sim.create(config, 12, 1);
  game.stage.waves = [];
  game.items = [];
  const player = game.players[0];
  Object.assign(player, { x: 250, y: 65, inv: 0 });
  const enemy = {
    id: game.nextId++, fid: 0, weapon, x: left ? 395 : 108, y: height, z: 0,
    vx: 0, vy: 0, vz: 0, face: left ? -1 : 1, hp: 100, maxHp: 100, st: 'walk',
    t: 0, cd: 0, target: player, inv: 0, offX: 0, offY: 0,
  };
  game.enemies.push(enemy);
  return { game, player, enemy, shot: Sim.ENEMY_WEAPONS[weapon].ranged };
}

function run(game, ticks) {
  for (let i = 0; i < ticks; i++) Sim.step(game);
}

for (const [weapon, left] of [[3, true], [4, false]]) {
  const { game, player, enemy, shot } = arena(weapon, { left });
  const hp = player.hp;
  Sim.step(game);
  assert.equal(enemy.st, 'ranged');
  assert.equal(enemy.face, left ? -1 : 1);
  assert.ok(game.events.some(event => event.startsWith('warn:')));
  const origin = enemy.x + enemy.face * 16;
  const pathSlope = (enemy.aimY - enemy.y) / (enemy.aimX - origin);
  assert.ok(Math.abs(pathSlope - (player.y - enemy.y) / (player.x - origin)) < 1e-10);
  const telegraph = Sim.snapshot(game).enemies[0];
  assert.ok(Math.abs(telegraph.ax - enemy.aimX) < 0.06 && Math.abs(telegraph.ay - enemy.aimY) < 0.06,
    'guest snapshots carry the locked warning path');

  run(game, shot.startup - 1);
  assert.equal(game.projs.length, 0, 'the entire windup is safe');
  assert.equal(player.hp, hp);
  const restored = Sim.importState(Sim.exportState(game));
  Sim.step(game);
  Sim.step(restored);
  assert.deepEqual(restored.projs, game.projs, 'a restored windup releases the same shot');
  assert.equal(game.projs[0].kind, shot.kind);
  assert.equal(game.projs[0].enemy, true);
  assert.equal(game.projs[0].vx < 0, left);
  assert.ok(game.projs[0].vy > 0, 'the shot can cross belt depth');
  assert.ok(Sim.snapshot(game).projs[0].vy > 0, 'guests can orient the projectile along its path');

  run(game, 40);
  assert.ok(player.hp < hp, 'staying in the aimed lane costs health');
  assert.ok(player.hp >= hp - shot.dmg, 'one attack cannot damage a player twice');
  assert.equal(game.projs.length, 0, 'the shot is consumed on a hit');
  assert.ok(enemy.cd >= shot.cooldown - 40, 'shooter recovers before aiming again');
}

{
  const { game, player, enemy, shot } = arena(4, { height: 65 });
  const hp = player.hp;
  Sim.step(game);
  const path = [enemy.aimX, enemy.aimY];
  player.in.d = 1;
  run(game, shot.startup);
  player.in.d = 0;
  assert.deepEqual([enemy.aimX, enemy.aimY], path, 'the telegraph stays locked when the target moves');
  assert.equal(game.projs[0].vy, 0);
  run(game, 60);
  assert.equal(player.hp, hp, 'the player can step out of the lane after the warning');
  assert.equal(game.projs.length, 0, 'a missed shot expires');
}

{
  const { game, player, shot } = arena(4, { height: 65 });
  const hp = player.hp;
  run(game, shot.startup + 1);
  const arrow = game.projs[0];
  for (let tick = 0; tick < arrow.life && player.x - arrow.x > 42; tick++) Sim.step(game);
  assert.ok(player.x - arrow.x <= 42 && game.projs.includes(arrow), 'arrow approaches the jump window');
  player.in.j = 1;
  run(game, 38);
  assert.equal(player.hp, hp, 'a timed jump clears the projectile');
}

{
  const { game, player, enemy, shot } = arena(4, { humans: 2, height: 65 });
  const guest = game.players[1];
  const hp = player.hp, guestHp = guest.hp;
  Sim.step(game);
  Object.assign(guest, { x: 197, y: 65, inv: 0 });
  run(game, shot.startup + 27);
  assert.equal(player.hp, hp, 'a shot checks the whole team, not only its aim target');
  assert.ok(guest.hp < guestHp);
  assert.equal(game.projs.length, 0);
  assert.notEqual(enemy.st, 'ranged', 'the shooter leaves its attack after recovery');
}

{
  const { game, player, enemy, shot } = arena(4, { height: 65 });
  const hp = player.hp;
  enemy.x = player.x - 21;
  Sim.step(game);
  assert.equal(enemy.st, 'attack', 'a cornered archer can fight up close');
  run(game, shot.startup);
  assert.ok(player.hp < hp);
  assert.equal(game.projs.length, 0, 'no point-blank shot');
}

{
  const { game, player, enemy, shot } = arena(4, { height: 65 });
  Sim.step(game);
  Object.assign(player, { x: enemy.x + 24, face: -1 });
  player.in.a = 1;
  run(game, Sim.WEAPONS[player.weapon].startup + 2);
  assert.equal(enemy.st, 'hit', 'player attacks interrupt the windup');
  run(game, shot.startup);
  assert.equal(game.projs.length, 0, 'interrupted windup does not fire');
}

{
  const { game, player } = arena(4, { height: 65 });
  game.enemies.length = 0;
  const hp = player.hp;
  const arrow = { id: game.nextId++, kind: 'enemyArrow', x: player.x + 66, y: player.y, z: 18,
    vx: -5.2, vy: 0, vz: 0, t: 0, life: 60, dmg: 8, enemy: true };
  game.projs.push(arrow);
  player.in.a = 1;
  run(game, Sim.WEAPONS[player.weapon].startup + 2);
  assert.equal(game.projs.length, 0, 'a melee swing can knock the arrow out of the air');
  assert.equal(player.hp, hp);
}

{
  const { game, player } = arena(4, { height: 65 });
  game.enemies.length = 0;
  const hp = player.hp;
  game.projs.push({ id: game.nextId++, kind: 'enemyArrow', x: player.x - 45, y: player.y, z: 18,
    vx: 90, vy: 0, vz: 0, t: 0, life: 4, dmg: 8, enemy: true });
  Sim.step(game);
  assert.equal(player.hp, hp - 8, 'a hit between ticks cannot tunnel through a player');
  assert.ok(game.fx.some(f => f.kind === 'enemyShotHit'));
}

{
  const { game, player, enemy, shot } = arena(3, { height: 65 });
  game.enemies.push({ ...enemy, id: game.nextId++, x: 391, weapon: 4, target: player });
  Sim.step(game);
  assert.equal(game.enemies.filter(e => e.st === 'ranged').length, 1, 'solo pressure allows only one windup at a time');
  run(game, shot.startup + 1);
  assert.ok(game.enemies[1].st === 'ranged', 'the other shooter gets a turn after release');
}

{
  const { game, player, enemy, shot } = arena(6, { height: 65 });
  enemy.sh = MANIFEST.shadows.stages[game.stageIdx].findIndex(e => e.role === 'twin');
  assert.ok(enemy.sh >= 0, 'this stage contains a Fighter pair');
  const hp = player.hp;
  run(game, shot.startup + 1);
  const first = Sim.snapshot(game).projs[0];
  assert.equal(first.k, 'enemyTwin');
  assert.equal(first.sh, enemy.sh, 'the projectile keeps this Fighter pair’s art row on guests');
  run(game, shot.echo);
  const echo = Sim.snapshot(game).projs.find(p => p.id !== first.id && p.k === 'enemyTwin');
  assert.ok(echo && echo.vx === first.vx && echo.vy === first.vy, 'the second pulse follows the warned path');
  run(game, 55);
  assert.ok(player.hp < hp - Sim.ENEMY_WEAPONS[4].ranged.dmg, 'the double pulse punishes a player who stays in the lane');
}

{
  const roster = MANIFEST.shadows;
  const ids = roster.stages.flat().map(row => row.id);
  assert.equal(ids.length, 254, 'the complete playable Sproto Fighter roster was imported');
  assert.equal(new Set(ids).size, ids.length, 'each fighter belongs to exactly one stage');
  for (const row of MANIFEST.fighters) assert.ok(ids.includes(row.id), 'existing identities are included');
  assert.equal(roster.stages[0][0].id, 'buddhashadow');
  assert.equal(roster.stages[2][0].id, 'sproto2075');

  const slots = Array.from({ length: Sim.SLOTS }, (_, slot) => ({
    fid: 0, weapon: 0, ctrl: slot === 0 ? 'local' : Sim.EMPTY,
  }));
  const kinds = new Set();
  for (const [stage, lineup] of roster.stages.entries()) {
    const atlas = fs.readFileSync(path.join(__dirname, '../public', roster.sheets[stage]));
    assert.equal(atlas.readUInt32BE(16), 14 * roster.cell);
    assert.equal(atlas.readUInt32BE(20), lineup.length * roster.cell);
    const game = Sim.create(slots, 15 + stage, stage);
    game.camX = 100;
    game.stage.waves.forEach(w => { w.x = 420; });
    Object.assign(game.players[0], { x: 220, inv: 9999 });
    const seen = new Set(), styles = new Set();
    for (let tick = 0; tick < 1900 && game.stage.waves.some(w => !w.done); tick++) {
      Sim.step(game);
      for (const e of Sim.snapshot(game).enemies) {
        assert.ok(lineup[e.sh], 'every spawn identifies a valid stage sprite row');
        seen.add(e.sh);
        const ranged = Sim.ENEMY_WEAPONS[e.w].ranged;
        styles.add(ranged ? 'ranged' : 'melee');
        if (ranged) kinds.add(ranged.kind);
        if (lineup[e.sh].role === 'twin') assert.equal(ranged.kind, 'enemyTwin');
      }
      game.enemies.length = 0; // clear progress in this spawn-policy test
    }
    assert.equal(seen.size, lineup.length, 'normal wave counts can show the whole cast on stage ' + (stage + 1));
    assert.deepEqual([...styles].sort(), ['melee', 'ranged'], 'stage ' + (stage + 1) + ' mixes melee and ranged Shadows');
  }
  assert.ok(kinds.has('enemyArrow') && kinds.has('knife') && kinds.has('enemyBolt') && kinds.has('enemyTwin'));
}


{
  const pathToAtlas = 'assets/fx/enemy-projectiles.png';
  const images = new Map([['assets/fx/combat.png', { tag: 'combat', naturalWidth: 512, naturalHeight: 1152 }]]);
  const atlas = { tag: 'enemy', naturalWidth: 256, naturalHeight: 256 };
  const requests = [], calls = [], stack = [];
  const g = new Proxy({
    x: 0, y: 0, angle: 0, imageSmoothingEnabled: true,
    save() { stack.push({ x: this.x, y: this.y, angle: this.angle, imageSmoothingEnabled: this.imageSmoothingEnabled }); },
    restore() { Object.assign(this, stack.pop()); },
    translate(x, y) { this.x += x; this.y += y; },
    rotate(angle) { this.angle += angle; },
    drawImage(image, ...rect) {
      calls.push({ tag: image.tag, rect, x: this.x, y: this.y, angle: this.angle, smooth: this.imageSmoothingEnabled });
    },
  }, { get: (target, key) => target[key] ?? (() => {}) });
  const scope = { Sim, MANIFEST, CoopBossTransformations: {}, Render: {
    img(src) { requests.push(src); return images.get(src); },
    ready: image => Boolean(image?.naturalWidth),
    text() {}, frameCanvas() { return null; }, canFilter() { return false; }, drawFighter() {}, drawBackground() {},
  } };
  scope.window = scope;
  for (const script of ['asset-loader', 'render-fx']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js', script + '.js'), 'utf8'), scope);
  }
  function draw(snapshot, projectile) {
    requests.length = calls.length = 0;
    const scene = { ...snapshot, players: [], enemies: [], projs: [projectile] };
    const before = JSON.stringify(scene);
    scope.RenderFx.drawWorld(g, scene, { noBanner: true });
    assert.equal(JSON.stringify(scene), before, 'render leaves the authoritative shot and age intact');
    assert.equal(stack.length, 0);
    assert.equal(g.imageSmoothingEnabled, true, 'nearest-neighbor sampling does not leak to other draws');
    return calls[0];
  }
  assert.ok(!scope.AssetLoader.groups(MANIFEST).fx.includes(pathToAtlas));
  for (const [row, size] of [41, 41, 53, 59].entries()) {
    const { game, enemy, shot } = arena(row + 3, { left: row % 2 === 0 });
    enemy.sh = 0;
    run(game, shot.startup + 1);
    const snapshot = Sim.snapshot(game);
    const shadowSource = MANIFEST.shadows.sheets[MANIFEST.bosses[snapshot.si].shadowStage ?? snapshot.si];
    images.set(shadowSource, { tag: 'shadow', naturalWidth: 896, naturalHeight: 1408 });
    const release = snapshot.projs[0];
    assert.equal(release.k, shot.kind, 'the real release reaches the expected enemy-FX row');
    scope.CoopBossTransformations.enemyProjectileSheet = false;
    const legacy = draw(snapshot, release);
    assert.equal(legacy.tag, row < 2 ? 'combat' : 'shadow');
    assert.ok(!requests.includes(pathToAtlas), 'the game does not request an unregistered sheet');
    scope.CoopBossTransformations.enemyProjectileSheet = true;
    const groups = scope.AssetLoader.groups(MANIFEST);
    assert.ok(groups.fx.includes(pathToAtlas) && groups.all.includes(pathToAtlas), 'registered atlas is prefetched and inventoried');
    images.delete(pathToAtlas);
    assert.deepEqual(draw(snapshot, release), legacy, 'cold sheet keeps the complete legacy projectile');
    images.set(pathToAtlas, { ...atlas, naturalHeight: 192 });
    assert.deepEqual(draw(snapshot, release), legacy, 'wrong grid dimensions keep the legacy projectile');
    images.set(pathToAtlas, atlas);
    for (let frame = 0; frame <= 4; frame++) {
      while (game.projs[0].t < 3 * frame) Sim.step(game);
      const now = Sim.snapshot(game);
      const p = now.projs[0];
      const fresh = draw(now, p);
      assert.equal(fresh.tag, 'enemy');
      assert.deepEqual(fresh.rect, [(frame % 4) * 64, row * 64, 64, 64, -size / 2, -size / 2, size, size]);
      assert.equal(fresh.x, Math.round(p.x - now.camX));
      assert.equal(fresh.y, Math.round(Sim.FLOOR_TOP + p.y - p.z));
      assert.equal(fresh.angle, Math.atan2(p.vy || 0, p.vx) + (row === 0 ? p.t * 0.55 * Math.sign(p.vx) : 0));
      assert.equal(fresh.smooth, false);
    }
    const playerArrow = draw(snapshot, { ...release, k: 'arrow' });
    assert.equal(playerArrow.tag, 'combat', 'authored enemy sheets never replace player arrows');
    assert.ok(!requests.includes(pathToAtlas), 'a player arrow does not request enemy art');
  }
}

console.log('Enemy ranged attacks and projectile rendering passed');
