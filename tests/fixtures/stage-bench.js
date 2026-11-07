const list = Scenarios.caseList();
let spec = null;
for (let i = 0; i < list.length; i++) if (list[i].id === 'human-seed3-stage1') spec = list[i];
const started = Date.now();
const row = Scenarios.runCase(spec);
console.log(JSON.stringify({
  id: row.id,
  tick: row.tick,
  mode: row.mode,
  stateBytes: row.stateBytes,
  stateHash: row.stateHash,
  simMs: Date.now() - started,
  ufo: row.flags.ufo,
  revive: row.flags.revive,
  dead: row.flags.dead,
  power: row.flags.power,
  bossPhase: row.flags.bossPhase,
}));
