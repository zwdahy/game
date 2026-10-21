'use strict';
/*
 * Road Rush 纯逻辑引擎测试：node road-rush/engine.test.cjs
 * 通过数打印，失败 exit 1。
 */
var Engine = require('./engine.js');
var I = Engine._internals;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   - ' + name); }
  catch (e) { failed++; console.error('  FAIL - ' + name + '\n        ' + (e && e.stack ? e.stack : e)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'not equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
}
function near(a, b, eps, msg) {
  if (Math.abs(a - b) > (eps === undefined ? 1e-6 : eps)) throw new Error((msg || 'not near') + ': ' + a + ' vs ' + b);
}
function isNum(v) { return typeof v === 'number' && isFinite(v); }

function cloneRun(seed, levelIndex) {
  var s = Engine.createRun(levelIndex === undefined ? 0 : levelIndex, { seed: seed === undefined ? 777 : seed });
  // 隔离外部生成实体，方便构造单点测试
  s._schedule = [];
  s._scheduleIndex = 0;
  s.enemies.length = 0;
  s.props.length = 0;
  s.pickups.length = 0;
  s.bullets.length = 0;
  s.enemyShots.length = 0;
  return s;
}

function fingerprint(s) {
  return JSON.stringify({
    time: s.time,
    distance: s.distance,
    x: s.x,
    people: s.people,
    weaponLevel: s.weaponLevel,
    fireRate: s.fireRate,
    score: s.score,
    kills: s.kills,
    gates: s.gates.map(function (g) { return [g.d, g.applied, g.left.label, g.right.label]; }),
    enemies: s.enemies.map(function (e) { return [e.type, e.x, e.d, e.hp, e.dead]; }),
    bullets: s.bullets.map(function (b) { return [b.tier, b.x, b.d, b.pierce, b.aoe, b.dead]; }),
    shots: s.enemyShots.map(function (p) { return [p.x, p.d, p.dead]; }),
    pickups: s.pickups.map(function (p) { return [p.type, p.x, p.d, p.dead]; }),
    stats: s.stats,
    events: s.events
  });
}

/* ===================================================================== */
test('createRun: 关卡数据 / 默认值 / carry 裁剪', function () {
  eq(Engine.LEVELS.length, 3);
  var expected = [
    [0, 1, '城郊公路', 'day', 960, 3, 1, 1.0, 'brute', '路障巨尸', 700],
    [1, 2, '废弃工业区', 'sunset', 1170, 3, 2, 1.3, 'butcher', '电锯屠夫', 1100],
    [2, 3, '城市高架', 'night', 1410, 3, 2, 1.6, 'mother', '暴君母体', 1600]
  ];
  for (var i = 0; i < expected.length; i++) {
    var lv = Engine.LEVELS[i], ex = expected[i];
    eq(lv.index, ex[0], 'index'); eq(lv.id, ex[1], 'id'); eq(lv.name, ex[2], 'name');
    eq(lv.theme, ex[3], 'theme'); eq(lv.trackLength, ex[4], 'trackLength');
    eq(lv.startPeople, ex[5], 'startPeople'); eq(lv.startWeapon, ex[6], 'startWeapon');
    eq(lv.difficulty, ex[7], 'difficulty'); eq(lv.boss, ex[8], 'boss');
    eq(lv.bossName, ex[9], 'bossName'); eq(lv.bossHp, ex[10], 'bossHp');
  }

  var s = Engine.createRun(0);
  eq(s.levelIndex, 0);
  eq(s.levelName, '城郊公路');
  eq(s.theme, 'day');
  eq(s.trackLength, 960);
  eq(s.difficulty, 1.0);
  eq(s.status, 'running');
  eq(s.phase, 'run');
  eq(s.time, 0);
  eq(s.distance, 0);
  eq(s.speed, 9.2);
  eq(s.x, 0);
  eq(s.people, 3);
  eq(s.maxPeople, 120);
  eq(s.weaponLevel, 1);
  eq(s.fireRate, 1);
  eq(s.score, 0);
  eq(s.kills, 0);
  eq(s.boss, null);
  ok(isNum(s.seed), 'seed number');
  ok(Array.isArray(s.enemies) && Array.isArray(s.bullets) && Array.isArray(s.enemyShots), 'arrays');
  ok(Array.isArray(s.gates) && Array.isArray(s.props) && Array.isArray(s.pickups), 'arrays 2');
  ok(Array.isArray(s.events) && s.events.length === 0, 'events empty');
  eq(s.stats.kills, 0); eq(s.stats.gates, 0); eq(s.stats.peopleGained, 0);
  eq(s.stats.shots, 0); eq(s.stats.bossKills, 0);

  // 每关 8–10 个门，全部在 Boss 竞技场之前
  for (i = 0; i < 3; i++) {
    var run = Engine.createRun(i);
    ok(run.gates.length >= 12 && run.gates.length <= 16, 'gate count level ' + i);
    eq(run.gates.length, [12, 14, 16][i], 'exact gate count level ' + i);
    var bossD = run.trackLength - 120;
    for (var g = 0; g < run.gates.length; g++) {
      ok(run.gates[g].d > 0 && run.gates[g].d < bossD, 'gate before arena');
      ok(run.gates[g].left && run.gates[g].right, 'gate sides');
    }
    if (i < 2) {
      for (g = 0; g < run.gates.length; g++) {
        ok(run.gates[g].left.good || run.gates[g].right.good, 'levels 1-2 have a good gate');
      }
    }
  }

  var c = Engine.createRun(2, { people: 999, weaponLevel: 99 });
  eq(c.people, 120, 'people cap');
  eq(c.weaponLevel, 6, 'weapon cap');
  var c2 = Engine.createRun(1, { people: 0, weaponLevel: 0 });
  eq(c2.people, 1, 'people floor');
  eq(c2.weaponLevel, 1, 'weapon floor');
  var c3 = Engine.createRun(1, { people: 17, weaponLevel: 4 });
  eq(c3.people, 17);
  eq(c3.weaponLevel, 4);
  eq(Engine.createRun(99).levelIndex, 2, 'level index clamp high');
  eq(Engine.createRun(-5).levelIndex, 0, 'level index clamp low');
});

test('L1 opening pressure: 首波 2 walkers、前两波无坦克、开局活跃敌人有界', function () {
  var s = Engine.createRun(0, { seed: 1 });
  var waves = s._schedule.filter(function (it) { return it.kind === 'wave'; });
  ok(waves.length > 0, 'waves generated');
  eq(waves[0].units.length, 2, 'first wave exactly 2');
  for (var w = 0; w < 2; w++) {
    for (var u = 0; u < waves[w].units.length; u++) {
      ok(waves[w].units[u].type !== 'tank', 'no tank in opening waves');
      if (w === 0) eq(waves[w].units[u].type, 'walker', 'first wave walkers only');
    }
  }
  ok(waves[0].units.length + waves[1].units.length <= 7, 'two-wave opening cap');
  for (var gi = 0; gi < 3; gi++) {
    ok(s.gates[gi].left.good && s.gates[gi].right.good, 'L1 opening gates are both good');
  }
  Engine.step(s, { steer: 0 }, 1 / 60);
  ok(s.enemies.length <= 8, 'active enemies at start <= 8, got ' + s.enemies.length);
});

test('determinism: 同 seed 同步 600 帧完全一致；不同 seed 不同', function () {
  var a = Engine.createRun(0, { seed: 777 });
  var b = Engine.createRun(0, { seed: 777 });
  for (var i = 0; i < 600; i++) {
    var inp = { steer: Math.sin(i / 17) };
    Engine.step(a, inp, 1 / 60);
    Engine.step(b, inp, 1 / 60);
  }
  eq(fingerprint(a), fingerprint(b), 'same seed fingerprint');

  var c = Engine.createRun(0, { seed: 778 });
  for (i = 0; i < 600; i++) Engine.step(c, { steer: Math.sin(i / 17) }, 1 / 60);
  ok(fingerprint(a) !== fingerprint(c), 'different seed differs');

  // 同 seed 重新生成的地图也一致
  eq(JSON.stringify(Engine.createRun(1, { seed: 42 }).gates),
     JSON.stringify(Engine.createRun(1, { seed: 42 }).gates), 'same seed gates');
});

test('applyGateEffect: 加 / 乘 / 除 / 人数与枪械、射速裁剪', function () {
  function st(people, weapon, fire) {
    var s = Engine.createRun(0);
    s.people = people; s.weaponLevel = weapon; s.fireRate = fire;
    return s;
  }
  var s = st(20, 1, 1);
  I.applyGateEffect(s, { kind: 'people', value: 8 });
  eq(s.people, 28, 'people +8');
  I.applyGateEffect(s, { kind: 'people', value: -8 });
  eq(s.people, 20, 'people -8');
  I.applyGateEffect(s, { kind: 'multiply', value: 2 });
  eq(s.people, 40, '×2');
  I.applyGateEffect(s, { kind: 'divide', value: 2 });
  eq(s.people, 20, '÷2');

  s.people = 21;
  I.applyGateEffect(s, { kind: 'divide', value: 2 });
  eq(s.people, 11, '÷2 ceil');

  s.people = 1;
  I.applyGateEffect(s, { kind: 'people', value: -8 });
  eq(s.people, 1, 'people floor 1');
  s.people = 110;
  I.applyGateEffect(s, { kind: 'multiply', value: 2 });
  eq(s.people, 120, 'people cap 120');

  s.weaponLevel = 6;
  I.applyGateEffect(s, { kind: 'weapon', value: 1 });
  eq(s.weaponLevel, 6, 'weapon cap');
  I.applyGateEffect(s, { kind: 'weapon', value: -9 });
  eq(s.weaponLevel, 1, 'weapon floor');

  s.fireRate = 2.2;
  I.applyGateEffect(s, { kind: 'fireRate', value: 0.2 });
  eq(s.fireRate, 2.2, 'fireRate cap');
  s.fireRate = 0.6;
  I.applyGateEffect(s, { kind: 'fireRate', value: -0.15 });
  eq(s.fireRate, 0.6, 'fireRate floor');
  s.fireRate = 1;
  I.applyGateEffect(s, { kind: 'fireRate', value: 0.2 });
  near(s.fireRate, 1.2, 1e-9, 'fireRate add');

  // 标签固定
  var labels = {};
  s.events.length = 0;
  I.applyGateEffect(s, { kind: 'people', value: 8 });
  eq(s.people, 120, 'people capped case');
  var all = Engine.createRun(2);
  for (var i = 0; i < all.gates.length; i++) {
    labels[all.gates[i].left.label] = true;
    labels[all.gates[i].right.label] = true;
  }
  var allowed = {
    '+3': 1, '+5': 1, '+8': 1, '-3': 1, '-5': 1, '-8': 1,
    '×2': 1, '÷2': 1, '枪械+1': 1, '枪械-1': 1,
    '射速+20%': 1, '射速-15%': 1
  };
  for (var k in labels) ok(allowed[k], 'label allowed: ' + k);
});

test('gate crossing: 左右侧选择正确，且只生效一次', function () {
  var s = Engine.createRun(0, { seed: 123 });
  var g = s.gates[0];
  s.people = 50;
  s.weaponLevel = 3;
  s.x = -0.5;
  I.processGates(s, g.d - 0.001);
  eq(g.applied, false, 'not crossed yet');
  s.distance = g.d + 0.001;
  I.processGates(s, g.d - 0.001);

  ok(g.applied, 'marked applied');
  eq(s.stats.gates, 1, 'stats gates');
  var evs = s.events.filter(function (e) { return e.type === 'gate'; });
  eq(evs.length, 1, 'one gate event');
  eq(evs[0].side, 'left', 'left chosen');
  eq(evs[0].kind, g.left.kind, 'left kind');
  eq(evs[0].value, g.left.value, 'left value');
  eq(evs[0].label, g.left.label, 'left label');
  eq(evs[0].people, s.people, 'event people snapshot');
  eq(evs[0].weaponLevel, s.weaponLevel, 'event weapon snapshot');

  var afterPeople = s.people, afterWeapon = s.weaponLevel;
  I.processGates(s, g.d - 0.001);
  eq(s.events.filter(function (e) { return e.type === 'gate'; }).length, 1, 'still one event');
  eq(s.people, afterPeople, 'people unchanged');
  eq(s.weaponLevel, afterWeapon, 'weapon unchanged');

  var s2 = Engine.createRun(0, { seed: 321 });
  var g2 = s2.gates[1];
  s2.x = 0;
  s2.distance = g2.d + 0.001;
  I.processGates(s2, g2.d - 0.001);
  var evs2 = s2.events.filter(function (e) { return e.type === 'gate'; });
  eq(evs2.length, 1);
  eq(evs2[0].side, 'right', 'right chosen');
  eq(evs2[0].label, g2.right.label, 'right label');
});

test('bullet kill: 击杀 walker -> kills / score / kill event', function () {
  var s = cloneRun(5);
  s.distance = 100;
  s.x = 0;
  s._fireTimer = 0;
  var e = I.spawnEnemy(s, 'walker', 0, s.distance + 18);
  e.hp = 5; e.maxHp = 5;
  var kills0 = s.kills, score0 = s.score, shots0 = s.stats.shots;
  var killEvent = null;

  for (var i = 0; i < 400 && !e.dead; i++) {
    Engine.step(s, { steer: 0 }, 1 / 60);
    for (var j = 0; j < s.events.length; j++) {
      if (s.events[j].type === 'kill' && s.events[j].kind === 'walker') killEvent = s.events[j];
    }
  }

  ok(e.dead, 'walker dead');
  eq(s.kills, kills0 + 1, 'kills +1');
  eq(s.stats.kills, 1, 'stats.kills');
  ok(s.score > score0, 'score increased');
  ok(s.stats.shots > shots0, 'shots recorded');
  ok(killEvent, 'kill event emitted');
  ok(isNum(killEvent.x) && isNum(killEvent.d), 'kill event coords');
});

test('people -> streams: 3 人 3 发、30 人 16 发；shot 事件反映实际流数', function () {
  var s = cloneRun(10);
  s.people = 3;
  s.bullets.length = 0;
  s.events.length = 0;
  I.fireVolley(s);
  eq(s.bullets.length, 3, '3 people -> 3 bullets');
  var ev = s.events.filter(function (e) { return e.type === 'shot'; })[0];
  ok(ev, 'shot event');
  eq(ev.streams, 3, '3 streams in event');

  s.people = 30;
  s.bullets.length = 0;
  s.events.length = 0;
  I.fireVolley(s);
  eq(s.bullets.length, 16, '30 people -> 16 bullets');
  ev = s.events.filter(function (e) { return e.type === 'shot'; })[0];
  eq(ev.streams, 16, '16 streams in event');
  eq(ev.fired, 16, '16 bullets fired');

  // 并发上限：已有 40 发时只补 8 发，且总并发不超过 48
  s.bullets.length = 0;
  for (var i = 0; i < 40; i++) {
    s.bullets.push({ id: 8000 + i, tier: 1, x: 0, d: 5, speed: 90, damage: 1,
      pierce: 0, aoe: 0, dead: false, _hits: [] });
  }
  s.events.length = 0;
  I.fireVolley(s);
  eq(s.bullets.length, 48, 'hard active-bullet cap');
  ev = s.events.filter(function (e) { return e.type === 'shot'; })[0];
  eq(ev.streams, 16, 'nominal streams kept in event');
  eq(ev.fired, 8, 'only 8 spawned under cap');
  ok(s.bullets[s.bullets.length - 1].damage > I.bulletDamageFor(Engine.WEAPON_TIERS[0], s.people),
    'damage compensated when cap suppresses spawns');
});

test('drops: 击杀掉落 / 无木箱 / 拾取 value 生效', function () {
  // 地图不再生成木箱，只有 2–3 个油桶
  for (var li = 0; li < 3; li++) {
    var run = Engine.createRun(li, { seed: 21 + li });
    var props = run._schedule.filter(function (it) { return it.kind === 'prop'; });
    var barrels = props.filter(function (it) { return it.type === 'barrel'; });
    eq(props.filter(function (it) { return it.type === 'crate'; }).length, 0, 'no old crates scheduled');
    ok(barrels.length >= 4 && barrels.length <= 6, '4-6 barrels per level');
  }

  // 强制子弹击杀 walker：rng=0.05 -> 12% medkit 分支，value=3
  var s = cloneRun(11);
  s.distance = 100;
  s.x = 0;
  s.people = 3;
  s._rng = function () { return 0.05; };
  var e = I.spawnEnemy(s, 'walker', 0, s.distance + 18);
  e.hp = 1; e.maxHp = 1;
  s.bullets.push({
    id: 9002, tier: 1, x: 0, d: s.distance + 16, speed: 90, damage: 99,
    pierce: 0, aoe: 0, dead: false, _hits: []
  });
  Engine.step(s, { steer: 0 }, 0.02);
  ok(e.dead, 'walker killed by bullet');
  eq(s.pickups.length, 1, 'one pickup dropped');
  eq(s.pickups[0].type, 'medkit', 'walker medkit drop');
  eq(s.pickups[0].value, 3, 'walker medkit value');
  eq(s._dropsSpawned, 1, 'drop counter');

  // 接触死亡不掉落
  var s2 = cloneRun(12);
  s2.distance = 100;
  s2.people = 10;
  s2._rng = function () { return 0.05; };
  I.spawnEnemy(s2, 'walker', 0, s2.distance + 0.6);
  Engine.step(s2, { steer: 0 }, 1 / 60);
  eq(s2.pickups.length, 0, 'contact death gives no drop');
  eq(s2._dropsSpawned, 0, 'no drop counter');

  // 拾取值：medkit +3 people，ammo +0.08 fireRate
  var s3 = cloneRun(13);
  s3.people = 10;
  s3.fireRate = 1;
  s3.pickups.push({ id: 9501, type: 'medkit', x: 0, d: s3.distance + 0.5, value: 3, dead: false });
  s3.pickups.push({ id: 9502, type: 'ammo', x: 0, d: s3.distance + 0.5, value: 0.08, dead: false });
  Engine.step(s3, { steer: 0 }, 1 / 60);
  eq(s3.people, 13, 'medkit uses pickup value');
  near(s3.fireRate, 1.08, 1e-9, 'ammo uses pickup value');
  ok(s3.events.some(function (x) { return x.type === 'pickup' && x.kind === 'medkit' && x.value === 3; }), 'medkit event value');
  ok(s3.events.some(function (x) { return x.type === 'pickup' && x.kind === 'ammo' && x.value === 0.08; }), 'ammo event value');
});

test('contact: 敌人接触扣人；人数归零 -> dead + dead event', function () {
  var s = cloneRun(6);
  s.distance = 100;
  s.people = 20;
  var e = I.spawnEnemy(s, 'walker', 0, s.distance + 0.6);
  Engine.step(s, { steer: 0 }, 1 / 60);
  eq(s.people, 19, 'contact damage');
  ok(e.dead, 'enemy consumed');
  ok(s.events.some(function (ev) { return ev.type === 'hurt'; }), 'hurt event');

  var s2 = cloneRun(7);
  s2.distance = 100;
  s2.people = 1;
  I.spawnEnemy(s2, 'walker', 0, s2.distance + 0.6);
  Engine.step(s2, { steer: 0 }, 1 / 60);
  eq(s2.people, 0, 'people zero');
  eq(s2.status, 'dead', 'dead status');
  ok(s2.events.some(function (ev) { return ev.type === 'dead'; }), 'dead event');
});

test('contact i-frame: 同一波群体接触只扣一次血', function () {
  var s = cloneRun(51);
  s.distance = 100;
  s.people = 20;
  s._hurtCooldown = 0;
  var a = I.spawnEnemy(s, 'walker', 0, s.distance + 0.6);
  var b = I.spawnEnemy(s, 'walker', 0.02, s.distance + 0.7);
  Engine.step(s, { steer: 0 }, 1 / 60);
  eq(s.people, 19, 'only first contact damages during i-frame');
  ok(a.dead && b.dead, 'both contact enemies consumed');
  eq(s.events.filter(function (e) { return e.type === 'hurt'; }).length, 1, 'one hurt event');
});

test('barrel explosion: 伤害附近敌人并发出 explode', function () {
  var s = cloneRun(8);
  s.distance = 100;
  s.x = 0;
  var barrel = { id: 9001, type: 'barrel', x: 0, d: 110, hp: 1, radius: 0.09, dead: false };
  s.props.push(barrel);
  var e = I.spawnEnemy(s, 'walker', 0.2, 111);
  e.hp = 50; e.maxHp = 50;
  s.bullets.push({
    id: 9002, tier: 1, x: 0, d: 108.5, speed: 90, damage: 5,
    pierce: 0, aoe: 0, dead: false, _hits: []
  });

  Engine.step(s, { steer: 0 }, 0.02);
  ok(barrel.dead, 'barrel destroyed');
  ok(e.dead, 'nearby enemy killed by blast');
  ok(s.events.some(function (ev) { return ev.type === 'explode'; }), 'explode event');
  ok(s.events.some(function (ev) { return ev.type === 'kill' && ev.kind === 'walker'; }), 'blast kill event');
});

test('weapon archetypes: 6 档名称 / 伤害 / 射速 / 倍率流上限', function () {
  eq(Engine.WEAPON_TIERS.length, 6);
  var names = ['手枪', '双管', '机关枪', '火箭筒', '坦克炮', '等离子'];
  var caps = [16, 16, 16, 3, 2, 6];
  for (var i = 0; i < 6; i++) {
    eq(Engine.WEAPON_TIERS[i].name, names[i], 'weapon name ' + i);
    eq(Engine.WEAPON_TIERS[i].maxStreams, caps[i], 'max streams ' + i);
    ok(Engine.WEAPON_TIERS[i].damage > 0 && Engine.WEAPON_TIERS[i].rate > 0, 'weapon stats');
    ok(Engine.WEAPON_TIERS[i].bulletSpeed > 0, 'bullet speed');
  }
  var s = cloneRun(31);
  s.people = 30;
  s.weaponLevel = 4;
  eq(I.volleyStreams(s, Engine.WEAPON_TIERS[3]), 3, 'rocket capped at 3');
  s.weaponLevel = 5;
  eq(I.volleyStreams(s, Engine.WEAPON_TIERS[4]), 2, 'tank capped at 2');
  s.weaponLevel = 6;
  eq(I.volleyStreams(s, Engine.WEAPON_TIERS[5]), 6, 'plasma capped at 6');
});

test('weapon crates: 阈值生成 / 高 HP / 击毁升级 / 不降级', function () {
  var expectTiers = [[3, 3, 4], [3, 4, 4, 5], [3, 4, 5, 5, 6]];
  for (var li = 0; li < 3; li++) {
    var run = Engine.createRun(li, { seed: 41 + li });
    var crates = run._schedule.filter(function (it) { return it.kind === 'prop' && it.type === 'weaponCrate'; });
    eq(crates.length, expectTiers[li].length, 'crate count L' + (li + 1));
    var bossD = run.trackLength - 120;
    for (var ci = 0; ci < crates.length; ci++) {
      eq(crates[ci].tier, expectTiers[li][ci], 'crate tier order');
      ok(crates[ci].maxHp > 0, 'crate maxHp');
      eq(crates[ci].hp, crates[ci].maxHp, 'crate hp starts full');
      ok(crates[ci].d > 0 && crates[ci].d < bossD, 'crate before arena');
      ok(Math.abs(crates[ci].x) >= 0.29 && Math.abs(crates[ci].x) <= 0.61, 'crate off-center');
    }
    for (ci = 1; ci < crates.length; ci++) {
      if (crates[ci].tier > crates[ci - 1].tier) {
        ok(crates[ci].maxHp > crates[ci - 1].maxHp, 'higher tier more HP');
      }
    }
  }

  // 伤害不足不破坏；击毁后装备对应 tier 并发出 weapon pickup 事件
  var s = cloneRun(32);
  s.weaponLevel = 1;
  var prop = { id: 9101, type: 'weaponCrate', tier: 3, x: 0.4, d: 110, hp: 40, maxHp: 40, radius: 0.13, dead: false };
  s.props.push(prop);
  I.damageProp(s, prop, 39);
  eq(prop.dead, false, 'crate survives 39 damage');
  eq(s.weaponLevel, 1, 'no upgrade before destruction');
  I.damageProp(s, prop, 1);
  eq(prop.dead, true, 'crate destroyed');
  eq(s.weaponLevel, 3, 'equipped crate tier');
  var ev = s.events.filter(function (e) { return e.type === 'pickup' && e.kind === 'weapon'; })[0];
  ok(ev, 'weapon pickup event');
  eq(ev.value, 3, 'weapon value');
  eq(ev.label, '机关枪', 'weapon name label');

  // 已有更高 tier：不降级，给火力补给
  var s2 = cloneRun(33);
  s2.weaponLevel = 5;
  var prop2 = { id: 9102, type: 'weaponCrate', tier: 3, x: -0.4, d: 110, hp: 40, maxHp: 40, radius: 0.13, dead: false };
  s2.props.push(prop2);
  var fire0 = s2.fireRate, score0 = s2.score;
  I.damageProp(s2, prop2, 40);
  eq(s2.weaponLevel, 5, 'no downgrade');
  ok(s2.score > score0, 'score compensation');
  ok(s2.fireRate > fire0, 'ammo compensation');
  ok(s2.events.some(function (e) { return e.type === 'pickup' && e.kind === 'ammo'; }), 'ammo event');
});

test('wave archetypes: runnerRush / tankEscort / barrelChain / elite', function () {
  for (var li = 0; li < 3; li++) {
    var run = Engine.createRun(li, { seed: 90 + li });
    var waves = run._schedule.filter(function (it) { return it.kind === 'wave'; });
    var counts = {};
    for (var i = 0; i < waves.length; i++) counts[waves[i].pattern] = (counts[waves[i].pattern] || 0) + 1;
    ok(counts.runnerRush >= 1, 'L' + (li + 1) + ' runnerRush');
    ok(counts.tankEscort >= 1, 'L' + (li + 1) + ' tankEscort');
    ok(counts.barrelChain >= 1, 'L' + (li + 1) + ' barrelChain');
    eq(counts.elite, 1, 'one elite wave');

    var barrels = run._schedule.filter(function (it) { return it.kind === 'prop' && it.type === 'barrel'; });
    ok(barrels.length >= 4 && barrels.length <= 6, 'barrel target count L' + (li + 1));
    var eliteWave = waves.filter(function (w) { return w.pattern === 'elite'; })[0];
    ok(eliteWave.units[0].elite, 'elite flag scheduled');
    eq(eliteWave.units[0].type, 'tank', 'elite is tank');
    ok(eliteWave.d > run.trackLength * 0.5 && eliteWave.d < run.trackLength * 0.7, 'elite at mid track');
  }
});

test('elite tank: elite flag + guaranteed medkit and ammo drop', function () {
  var s = cloneRun(96);
  s.distance = 100;
  var e = I.spawnEnemy(s, 'tank', 0.2, s.distance + 20, true, 3.5);
  ok(e.elite, 'elite flag on entity');
  ok(e.maxHp > 70 * 3, 'elite HP multiplier');
  s.pickups.length = 0;
  s._dropsSpawned = 0;
  I.damageEnemy(s, e, 99999);
  eq(s.pickups.length, 2, 'elite always drops two pickups');
  ok(s.pickups.some(function (p) { return p.type === 'medkit' && p.value === 8; }), 'elite medkit +8');
  ok(s.pickups.some(function (p) { return p.type === 'ammo' && p.value === 0.10; }), 'elite ammo');
  var killEv = s.events.filter(function (ev) { return ev.type === 'kill'; })[0];
  ok(killEv && killEv.elite, 'elite kill event flag');
});

test('drop cap: random drops stop at MAX_DROPS_PER_RUN', function () {
  var s = cloneRun(97);
  s.pickups.length = 0;
  s._dropsSpawned = 0;
  s._rng = function () { return 0.01; };
  for (var i = 0; i < 40; i++) {
    I.rollDrop(s, { type: 'walker', x: 0, d: 100 });
  }
  eq(s._dropsSpawned, I.MAX_DROPS_PER_RUN, 'random drops capped');
  ok(s.pickups.length <= I.MAX_DROPS_PER_RUN, 'pickup count capped');
});

test('boss: 触发 / 数据 / 强制 hp 0 -> won + win event', function () {
  var s = cloneRun(9);
  s.distance = s.trackLength - 120;
  s._fireTimer = 0;
  var expectedHp = I.bossHpFor(s);
  Engine.step(s, { steer: 0 }, 1 / 60);

  eq(s.phase, 'boss', 'boss phase');
  eq(s.speed, 0, 'speed zero');
  eq(s.distance, s.trackLength - 120, 'arena distance');
  ok(s.boss, 'boss exists');
  eq(s.boss.type, 'brute');
  eq(s.boss.name, '路障巨尸');
  eq(s.boss.hp, expectedHp);
  eq(s.boss.maxHp, expectedHp);
  eq(s.boss.dead, false);
  ok(s.boss.hitRadius >= 0.35, 'boss has generous hit radius');
  ok(s.events.some(function (ev) { return ev.type === 'bossSpawn'; }), 'bossSpawn event');

  s.boss.hp = 0;
  s.people = 20;
  var score0 = s.score;
  Engine.step(s, { steer: 0 }, 1 / 60);
  eq(s.status, 'won', 'won');
  eq(s.phase, 'won', 'phase won');
  eq(s.stats.bossKills, 1, 'bossKills');
  ok(s.boss.dead, 'boss dead');
  var winEv = s.events.filter(function (ev) { return ev.type === 'win'; })[0];
  ok(winEv, 'win event');
  eq(winEv.clearBonus, 10, 'level-clear people bonus');
  eq(s.people, 30, 'people bonus applied and capped');
  ok(s.score >= score0 + 1000, 'boss score');

  var t = s.time;
  Engine.step(s, { steer: 0 }, 1 / 60);
  eq(s.time, t, 'time frozen after win');
});

test('boss tuning: 三关实际 HP 落在目标区间，命中半径足够', function () {
  for (var li = 0; li < 3; li++) {
    var s = Engine.createRun(li, { seed: li + 1 });
    s._schedule = [];
    s.distance = s.trackLength - 120;
    Engine.step(s, { steer: 0 }, 1 / 60);
    ok(s.boss, 'boss spawned L' + (li + 1));
    ok(s.boss.hp >= I.BOSS_MIN_HP[li] && s.boss.hp <= I.BOSS_MAX_HP[li],
      'adaptive boss hp range L' + (li + 1) + ': ' + s.boss.hp);
    eq(s.boss.maxHp, s.boss.hp, 'maxHp matches');
    ok(s.boss.hitRadius >= 0.35 && s.boss.hitRadius <= 0.45, 'hit radius tuning');
  }
});

test('adaptive boss HP: scales with DPS, bounded, and fights land in target bands', function () {
  function hpFor(people, weapon, fireRate) {
    var s = cloneRun(100);
    s.people = people;
    s.weaponLevel = weapon;
    s.fireRate = fireRate || 1;
    return I.bossHpFor(s);
  }
  var low = hpFor(50, 1, 1);
  var high = hpFor(120, 6, 2.2);
  ok(high > low, 'higher DPS -> higher adaptive HP');
  for (var li = 0; li < 3; li++) {
    var s = cloneRun(101 + li, li);
    s.people = 80;
    s.weaponLevel = 6;
    s.fireRate = 1.5;
    var hp = I.bossHpFor(s);
    ok(hp >= I.BOSS_MIN_HP[li] && hp <= I.BOSS_MAX_HP[li], 'HP within bounds L' + (li + 1));
    s.distance = s.trackLength - 120;
    Engine.step(s, { steer: 0 }, 1 / 60);
    eq(s.boss.hp, hp, 'spawn uses adaptive HP L' + (li + 1));
    eq(s.boss.maxHp, hp, 'maxHp displayed L' + (li + 1));
  }

  function fight(people, weapon) {
    var s = cloneRun(120);
    s._schedule = [];
    s.people = people;
    s.weaponLevel = weapon;
    s.distance = s.trackLength - 120;
    s.x = 0;
    Engine.step(s, { steer: 0 }, 1 / 60);
    var start = s.time, guard = 0;
    while (s.status === 'running' && guard < 2400) {
      s.x = 0;
      Engine.step(s, { steer: 0 }, 1 / 60);
      guard += 1;
    }
    eq(s.status, 'won', 'boss defeated');
    return s.time - start;
  }
  var lowDur = fight(50, 1);
  var highDur = fight(120, 6);
  ok(lowDur >= 10 && lowDur <= 15, '50-person pistol fight target, got ' + lowDur.toFixed(2));
  ok(highDur >= 10 && highDur <= 16, '120-person plasma fight target, got ' + highDur.toFixed(2));
});

test('heavy-weapon boss HP: dynamic floor avoids 30s+ fights', function () {
  function hpFor(li, people, weapon) {
    var s = cloneRun(240 + li, li);
    s.people = people;
    s.weaponLevel = weapon;
    return I.bossHpFor(s);
  }
  var l2Rocket = hpFor(1, 80, 4);
  var l3Tank = hpFor(2, 80, 5);
  ok(l2Rocket < I.BOSS_MIN_HP[1], 'L2 rocket uses dynamic floor');
  ok(l3Tank < I.BOSS_MIN_HP[2], 'L3 tank uses dynamic floor');
  ok(l2Rocket >= I.HEAVY_BOSS_MIN_FLOOR, 'rocket above absolute floor');
  ok(l3Tank >= I.HEAVY_BOSS_MIN_FLOOR, 'tank above absolute floor');

  function fight(li, people, weapon) {
    var s = cloneRun(250 + li, li);
    s._schedule = [];
    s.people = people;
    s.weaponLevel = weapon;
    s.distance = s.trackLength - 120;
    s.x = 0;
    Engine.step(s, { steer: 0 }, 1 / 60);
    var start = s.time, guard = 0;
    while (s.status === 'running' && guard < 3000) {
      s.x = 0;
      Engine.step(s, { steer: 0 }, 1 / 60);
      guard += 1;
    }
    eq(s.status, 'won', 'heavy boss defeated');
    return s.time - start;
  }
  var rocketDur = fight(1, 80, 4);
  var tankDur = fight(2, 80, 5);
  ok(rocketDur <= 20, 'L2 80p rocket <=20s, got ' + rocketDur.toFixed(2));
  ok(tankDur <= 20, 'L3 80p tank <=20s, got ' + tankDur.toFixed(2));
});

test('boss independent movement / phase transitions / duration sanity', function () {
  var a = cloneRun(61);
  a.distance = a.trackLength - 120;
  Engine.step(a, { steer: 0 }, 1 / 60);
  var b = cloneRun(61);
  b.distance = b.trackLength - 120;
  Engine.step(b, { steer: 0 }, 1 / 60);
  ok(a.boss && b.boss, 'boss spawned');

  var x0 = a.boss.x;
  for (var i = 0; i < 40; i++) {
    a.x = 0.8;
    b.x = -0.8;
    Engine.step(a, { steer: 0 }, 1 / 60);
    Engine.step(b, { steer: 0 }, 1 / 60);
  }
  ok(Math.abs(a.boss.x - x0) > 0.02, 'boss x changes over time');
  ok(Math.abs(a.boss.x - a.x) > 0.05, 'boss does not mirror player x');
  near(a.boss.x, b.boss.x, 1e-9, 'boss movement independent of player position');

  // 66% / 33% thresholds
  a.boss.hp = a.boss.maxHp * 0.6;
  Engine.step(a, { steer: 0 }, 1 / 60);
  eq(a.boss.phase, 2, 'phase 2 at 66%');
  ok(a.events.some(function (ev) { return ev.type === 'bossAttack' && ev.enrage; }), 'enrage telegraph');
  a.boss.hp = a.boss.maxHp * 0.3;
  Engine.step(a, { steer: 0 }, 1 / 60);
  eq(a.boss.phase, 3, 'phase 3 at 33%');

  // 最低时长 sanity：满编机关枪也不能 1 秒秒杀 Boss
  var t = cloneRun(62);
  t._schedule = [];
  t.people = 120;
  t.weaponLevel = 3;
  t.distance = t.trackLength - 120;
  Engine.step(t, { steer: 0 }, 1 / 60);
  t.x = 0;
  var start = t.time, guard = 0;
  while (t.status === 'running' && guard < 3600) {
    t.x = 0;
    Engine.step(t, { steer: 0 }, 1 / 60);
    guard += 1;
  }
  eq(t.status, 'won', 'boss eventually dies');
  ok(t.time - start >= 3, 'boss fight minimum duration, got ' + (t.time - start).toFixed(2));
  for (i = 0; i < 3; i++) {
    ok(I.BOSS_MIN_HP[i] > 0 && I.BOSS_MAX_HP[i] > I.BOSS_MIN_HP[i], 'boss HP bounds L' + (i + 1));
  }
});

test('boss attacks: 前摇 / 出招 / 弹幕 / 阶段事件', function () {
  var levelKinds = [['shockwave'], ['cleaver', 'charge'], ['acid', 'rain']];
  for (var li = 0; li < 3; li++) {
    var s = cloneRun(70 + li, li);
    s.distance = s.trackLength - 120;
    Engine.step(s, { steer: 0 }, 1 / 60);
    ok(s.boss, 'boss L' + (li + 1));
    s.people = 120;
    s.weaponLevel = 1;
    s.x = 0;
    // 高 HP 保证 10 秒内不会被玩家打死，专注验证攻击循环
    s.boss.maxHp = 100000;
    s.boss.hp = 30000;
    Engine.step(s, { steer: 0 }, 1 / 60);
    eq(s.boss.phase, 3, 'forced phase 3');

    var attackCount = 0, strikeCount = 0, maxShots = 0, seenKind = {};
    for (var i = 0; i < 600; i++) {
      s.x = 0;
      Engine.step(s, { steer: 0 }, 1 / 60);
      if (s.enemyShots.length > maxShots) maxShots = s.enemyShots.length;
      for (var j = 0; j < s.enemyShots.length; j++) seenKind[s.enemyShots[j].kind] = true;
      for (j = 0; j < s.events.length; j++) {
        if (s.events[j].type === 'bossAttack') {
          attackCount += 1;
          ok(s.events[j].windup > 0, 'windup value');
        }
        if (s.events[j].type === 'bossStrike') {
          strikeCount += 1;
          eq(s.events[j].phase >= 2, true, 'strike phase present');
          ok(s.events[j].count >= 1, 'strike count');
        }
      }
    }
    ok(attackCount >= 3, 'boss L' + (li + 1) + ' >=3 bossAttack, got ' + attackCount);
    ok(strikeCount >= 3, 'boss L' + (li + 1) + ' >=3 bossStrike, got ' + strikeCount);
    ok(maxShots > 0, 'boss L' + (li + 1) + ' spawned projectiles');
    for (var ki = 0; ki < levelKinds[li].length; ki++) {
      ok(seenKind[levelKinds[li][ki]], 'saw projectile kind ' + levelKinds[li][ki]);
    }
  }
});

test('boss attacks threaten a stationary player (L1 15s)', function () {
  var s = cloneRun(80);
  s.distance = s.trackLength - 120;
  Engine.step(s, { steer: 0 }, 1 / 60);
  s.people = 120;
  s.weaponLevel = 1;
  s.boss.maxHp = 100000;
  s.boss.hp = 100000;
  s.x = 0;
  for (var i = 0; i < 900 && s.status === 'running'; i++) {
    s.x = 0;
    Engine.step(s, { steer: 0 }, 1 / 60);
  }
  ok(s.people < 120, 'stationary player took boss damage, people=' + s.people);
  ok(s.status === 'running' || s.status === 'dead', 'boss threat state valid');
});

test('3600 步稳定性: 无 NaN / 坐标合法 / 数组有界', function () {
  for (var li = 0; li < 3; li++) {
    var s = Engine.createRun(li, { seed: 2000 + li });
    var i, j, list, ent;
    for (i = 0; i < 3600; i++) {
      var steer = Math.sin(i / 23) * 0.8;
      if (i % 97 === 0) steer += 0.3;
      Engine.step(s, { steer: steer }, 1 / 60);

      ok(isNum(s.time) && isNum(s.distance) && isNum(s.x) && isNum(s.people), 'state finite lv' + li + ' step ' + i);
      ok(s.x >= -1 && s.x <= 1, 'player x range');
      ok(s.distance >= 0 && s.distance <= s.trackLength, 'distance range');
      ok(s.people >= 0 && s.people <= s.maxPeople, 'people range');
      ok(isNum(s.weaponLevel) && s.weaponLevel >= 1 && s.weaponLevel <= 6, 'weapon range');
      ok(isNum(s.fireRate) && s.fireRate >= 0.6 && s.fireRate <= 2.2, 'fireRate range');
      ok(isNum(s.score) && isNum(s.kills), 'score/kills finite');
      ok(s.enemies.length <= 300, 'enemies bounded');
      ok(s.bullets.length <= 48, 'active bullets capped at 48');
      ok(s.enemyShots.length <= 300, 'enemyShots bounded');
      ok(s.props.length <= 100 && s.pickups.length <= 100, 'items bounded');
      ok(s.events.length <= 120, 'events bounded');
      ok(s.gates.length >= 12 && s.gates.length <= 16, 'gates stable');

      list = [s.enemies, s.bullets, s.enemyShots, s.props, s.pickups];
      for (j = 0; j < list.length; j++) {
        for (var k = 0; k < list[j].length; k++) {
          ent = list[j][k];
          ok(isNum(ent.x) && ent.x >= -1.01 && ent.x <= 1.01, 'entity x range');
          ok(isNum(ent.d), 'entity d finite');
          if (ent.hp !== undefined) ok(isNum(ent.hp), 'entity hp finite');
        }
      }
      if (s.boss) {
        ok(isNum(s.boss.hp) && isNum(s.boss.x) && isNum(s.boss.d), 'boss finite');
        ok(s.boss.x >= -1 && s.boss.x <= 1, 'boss x');
      }
      if (s.status !== 'running') break;
    }
    ok(s.status === 'running' || s.status === 'won' || s.status === 'dead', 'valid status');
  }
});

test('events: 每步清空，不会无限累积', function () {
  var s = Engine.createRun(0, { seed: 55 });
  var maxSeen = 0;
  for (var i = 0; i < 600; i++) {
    Engine.step(s, { steer: Math.sin(i / 31) }, 1 / 60);
    if (s.events.length > maxSeen) maxSeen = s.events.length;
    ok(s.events.length <= 120, 'events bounded in step ' + i);
  }
  ok(maxSeen > 0, 'some events occurred');

  // 人为塞入大量事件，下一步也必须被清空
  for (i = 0; i < 1000; i++) s.events.push({ type: 'junk' });
  Engine.step(s, { steer: 0 }, 1 / 60);
  ok(s.events.length < 200, 'events reset and bounded');
  ok(!s.events.some(function (ev) { return ev.type === 'junk'; }), 'no stale junk events');
});

/* ===================================================================== */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
