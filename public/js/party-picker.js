// Deferred lobby and roster editor. The host and the network adapters own the selections.
(function (root) {
'use strict';
const { Sim: S, MANIFEST: M, Render: R } = root;
const GOLD = '#ffd35a', TEXT = '#f8efff', MUTED = '#cfc3dd', PANEL = '#130f24';
const COLS = 4;

function rect(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, h);
}

function trimLabel(value, max) {
  const name = String(value || '');
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

function seatLabel(app, seat, ui) {
  if (ui.cpuSeat(seat)) return 'CPU';
  if (ui.canEditSeat(seat)) return 'YOU';
  if (app.role === 'guest' && seat.ctrl === 'local') return 'HOST';
  return 'ONLINE';
}

function preview(g, seat, fid, time, x, y, variant) {
  const role = S.classOf(seat);
  const index = S.weaponFor(role.id, seat.weapon);
  const weapon = S.WEAPONS[index];
  R.drawFighter(g, { f: fid, cl: role.id, w: index, st: 'idle', t: time, z: 0, fc: 1 },
    x, y, variant || 0, weapon.id, weapon);
  return { role, index, weapon };
}

function button(g, ui, x, y, w, h, label, action) {
  rect(g, x, y, w, h, action ? GOLD : '#4f4661');
  ui.T(g, label, x + w / 2, y + h / 2, 7, action ? '#21152d' : TEXT, 'center');
  if (action) ui.hit(x, y, w, h, action);
}

function notice(g, app, T, x, w) {
  if (app.msgT <= 0 || !app.msg) return;
  rect(g, x, 17, w, 23, '#130f24ef');
  T(g, trimLabel(app.msg, Math.floor((w - 12) / 6)), x + w / 2, 28, 6, TEXT, 'center');
}

function drawParty(g, app, ui) {
  const { T, hit } = ui;
  T(g, 'CO-OP PARTY', 14, 28, 13, GOLD);
  if (app.code) T(g, 'ROOM ' + app.code, S.W - 14, 28, 9, '#90f7ad', 'right');
  notice(g, app, T, 167, app.code ? 271 : 459);
  const first = app.slots.findIndex(ui.canEditSeat);
  app.slots.forEach((seat, i) => {
    if (!M.fighters[seat.fid]) return;
    const x = 10 + i * 156, y = 48, w = 148, edge = S.SLOT_COLORS[i];
    const editable = ui.canEditSeat(seat), label = seatLabel(app, seat, ui);
    rect(g, x, y, w, 208, '#100e1ceb');
    rect(g, x, y, w, 3, edge);
    T(g, 'P' + (i + 1), x + 8, y + 17, 10, edge);
    T(g, label, x + w - 8, y + 17, 7, label === 'CPU' ? MUTED : TEXT, 'right');
    const variant = app.slots.slice(0, i).filter(other => other.fid === seat.fid).length;
    const { role, index, weapon } = preview(g, seat, seat.fid, app.t + i * 9, x + w / 2 - 6, y + 112, variant);
    T(g, trimLabel(M.fighters[seat.fid].name, 18), x + w / 2, y + 126, 7, TEXT, 'center');
    T(g, role.name.toUpperCase(), x + w / 2, y + 144, 8, weapon.tint || edge, 'center');
    T(g, trimLabel(weapon.name, 20), x + w / 2, y + 157, 6.5, TEXT, 'center');
    T(g, S.classShotPower(role.id, index, false) + ' DMG · TIER ' + weapon.tier, x + w / 2, y + 170, 6.2, MUTED, 'center');
    if (editable) {
      hit(x, y, w, 181, () => ui.openRoster(i));
      button(g, ui, x + 10, y + 183, w - 20, 17, 'EDIT LOADOUT', () => ui.openRoster(i));
    }
  });

  const next = app.role === 'guest' ? 'WAITING FOR HOST' : app.role === 'banked' ? 'READY' : 'CHOOSE STAGE';
  button(g, ui, 145, 266, 170, 24, 'OPEN ROSTER', first < 0 ? null : () => ui.openRoster(first));
  button(g, ui, 325, 266, 170, 24, next, app.role === 'guest' ? null : ui.confirmLobby);
  const pad = ui.padUI();
  rect(g, 31, 294, 578, 57, '#130f24ef');
  T(g, pad ? 'A JOIN · LB ROSTER · Y CLASS · START CONTINUE' : 'ATTACK JOIN · SPECIAL ROSTER · POWER CLASS · ENTER CONTINUE',
    S.W / 2, 304, 7, TEXT, 'center');
  const tier = first < 0 ? 1 : ui.tierForSlot(app.slots[first]);
  T(g, tier < 13 ? 'CLEAR STAGE ' + tier + ' TO UNLOCK THE NEXT WEAPON SET' : 'ALL WEAPONS UNLOCKED',
    S.W / 2, 321, 6, GOLD, 'center');
  T(g, app.role === 'banked' ? ui.bankedPayLine() : ui.practiceTag, S.W / 2, 340, 6, MUTED, 'center');

  if (app.role === 'guest' && app.hostChoosing != null) {
    ui.modal();
    rect(g, 0, 147, S.W, 52, '#0c0916eb');
    const stage = M.bosses[app.hostChoosing];
    T(g, 'HOST IS CHOOSING' + (stage ? ' · ' + stage.stage.toUpperCase() : ''), S.W / 2, 173, 8, GOLD, 'center');
  }
}

function drawRoster(g, app, ui) {
  const { T, hit } = ui;
  const focus = app.roster;
  const seat = app.slots[focus.slot];
  if (!seat || !M.fighters[focus.fid]) return;
  T(g, 'SELECT A SPROTO', 14, 28, 12, GOLD);
  notice(g, app, T, 213, 321);
  button(g, ui, 547, 18, 79, 21, 'DONE', ui.closeRoster);
  app.slots.forEach((slot, i) => {
    const x = 14 + i * 153, current = i === focus.slot;
    const label = 'P' + (i + 1) + ' ' + seatLabel(app, slot, ui);
    rect(g, x, 45, 146, 26, current ? S.SLOT_COLORS[i] : PANEL);
    T(g, label, x + 73, 58, 8, current ? '#21152d' : MUTED, 'center');
    if (ui.canEditSeat(slot)) hit(x, 45, 146, 26, () => ui.openRoster(i, focus.dev));
  });

  M.fighters.forEach((fighter, fid) => {
    const x = 14 + fid % COLS * 96, y = 81 + Math.floor(fid / COLS) * 61;
    const hovered = fid === focus.fid && !focus.gear;
    const selected = seat.fid === fid;
    rect(g, x, y, 90, 55, hovered ? GOLD : selected ? S.SLOT_COLORS[focus.slot] : '#554863');
    rect(g, x + 2, y + 2, 86, 51, hovered ? '#352545' : PANEL);
    if (!R.drawPortrait || !R.drawPortrait(g, fid, x + 45, y + 21, 36)) {
      T(g, fighter.name.slice(0, 2).toUpperCase(), x + 45, y + 22, 9, fighter.color || TEXT, 'center');
    }
    if (selected) T(g, 'P' + (focus.slot + 1), x + 5, y + 8, 5.5, GOLD);
    T(g, trimLabel(fighter.name, 13), x + 45, y + 44, 6, TEXT, 'center');
    const focusPortrait = () => {
      const current = app.roster;
      if (!current) return;
      current.fid = fid; current.gear = null;
      return current;
    };
    hit(x, y, 90, 55, () => {
      const current = focusPortrait();
      if (current) ui.selectFighter(current.slot, fid);
    }, focusPortrait);
  });

  rect(g, 400, 81, 226, 238, PANEL);
  rect(g, 400, 81, 226, 3, S.SLOT_COLORS[focus.slot]);
  const fighter = M.fighters[focus.fid];
  T(g, trimLabel(fighter.name, 22).toUpperCase(), 513, 99, 9, TEXT, 'center');
  rect(g, 410, 112, 206, 88, '#271c38');
  const { role, weapon, index } = preview(g, seat, focus.fid, app.t, 506, 193);
  const passive = S.PASSIVES[focus.fid % S.PASSIVES.length];
  T(g, passive.text, 513, 211, 6.5, '#86efd4', 'center');
  const adjust = (key, y, label, detail) => {
    rect(g, 410, y, 206, 35, focus.gear === key ? '#4a3553' : '#29203c');
    T(g, trimLabel(label, 20), 513, y + 10, 8, TEXT, 'center');
    T(g, detail, 513, y + 24, 6, MUTED, 'center');
    T(g, '<', 422, y + 17, 8, GOLD, 'center');
    T(g, '>', 605, y + 17, 8, GOLD, 'center');
    for (const [x, dir] of [[410, -1], [592, 1]]) hit(x, y, 24, 35, () => {
      if (!app.roster) return;
      app.roster.gear = key;
      ui.pickLobby(app.roster.slot, key, dir);
    });
  };
  adjust('classId', 226, role.name, role.text);
  adjust('weapon', 267, weapon.name, 'TIER ' + weapon.tier + ' · ' + S.classShotPower(role.id, index, false) + ' DMG');
  const pad = ui.padUI();
  rect(g, 14, 326, 612, 26, '#130f24ef');
  T(g, pad ? 'STICK / D-PAD MOVE · A PICK · LB NEXT SEAT · Y CLASS · B BACK' : 'WASD / ARROWS MOVE · ATTACK PICK · SPECIAL NEXT SEAT · POWER CLASS · ESC BACK',
    320, 334, 6.5, TEXT, 'center');
  T(g, 'MOVE BELOW THE GRID TO CHANGE CLASS AND WEAPON', 320, 346, 6, GOLD, 'center');
}

function draw(g, app, ui) {
  R.drawBackground(g, 4, app.t * 0.3);
  rect(g, 0, 0, S.W, S.H, '#080612b5');
  if (app.roster) drawRoster(g, app, ui);
  else drawParty(g, app, ui);
}

function input(app, ui, keys) {
  const focus = app.roster;
  if (keys.s) {
    for (let offset = 1; offset < app.slots.length; offset++) {
      const i = (focus.slot + offset) % app.slots.length;
      if (ui.canEditSeat(app.slots[i])) { ui.openRoster(i, focus.dev); return; }
    }
  }
  if (keys.p) ui.pickLobby(focus.slot, 'classId', 1);
  if (focus.gear) {
    if (keys.l || keys.r || keys.ok || keys.a) ui.pickLobby(focus.slot, focus.gear, keys.l ? -1 : 1);
    if (keys.u) focus.gear = focus.gear === 'weapon' ? 'classId' : null;
    if (keys.d) focus.gear = 'weapon';
    return;
  }
  const count = M.fighters.length;
  if (keys.l) focus.fid = (focus.fid + count - 1) % count;
  if (keys.r) focus.fid = (focus.fid + 1) % count;
  if (keys.u && focus.fid >= COLS) focus.fid -= COLS;
  if (keys.d) {
    if (focus.fid + COLS >= count) focus.gear = 'classId';
    else focus.fid += COLS;
  }
  if (keys.ok || keys.a) ui.selectFighter(focus.slot, focus.fid);
}

root.PartyPicker = { draw, input };
})(window);
