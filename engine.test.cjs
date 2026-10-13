'use strict';
/*
 * engine.test.cjs —— 纯 Node 运行：node engine.test.cjs
 * 通过数打印，失败 exit 1。
 */
var Engine = require('./engine.js');
var CONFIG = Engine.CONFIG;
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

function noSpawn(fn) {
  var s0 = CONFIG.spawn.baseInterval, s1 = CONFIG.spawn.minInterval;
  CONFIG.spawn.baseInterval = 1e9; CONFIG.spawn.minInterval = 1e9;
  try { return fn(); } finally { CONFIG.spawn.baseInterval = s0; CONFIG.spawn.minInterval = s1; }
}

function makeMonster(id, type, x, y, hp, blades) {
  return { id: id, type: type, x: x, y: y, hp: hp, maxHp: hp, radius: CONFIG.monsters[type].radius,
    speed: 0, hurtFlash: 0, angle: 0, blades: blades || [] };
}

/* ===================================================================== */
test('createGame: 初始 state (hp5 / 刀2 / 有石头和树)', function () {
  var s = Engine.createGame(12345);
  eq(s.status, 'running');
  eq(s.time, 0);
  eq(s.difficultyTier, 0);
  eq(s.world.w, 1800); eq(s.world.h, 1400);
  eq(s.player.hp, 5); eq(s.player.maxHp, 5);
  eq(s.player.blades.length, 2);
  eq(s.player.blades[0].active, true);
  eq(s.player.blades[1].active, true);
  eq(s.player.level, 1);
  eq(s.player.xpToNext, 5);
  ok(s.terrain.rocks.length > 0, 'rocks');
  ok(s.terrain.trees.length > 0, 'trees');
  ok(Array.isArray(s.events));
  eq(s.events.length, 0);
  eq(s.pendingLevelUps, 0);
  // 出生点无地形
  for (var i = 0; i < s.terrain.rocks.length; i++) {
    var r = s.terrain.rocks[i];
    ok(I.dist2(r.x, r.y, s.player.x, s.player.y) > (130 + r.radius) * (130 + r.radius) - 1e-6, 'rock clear of spawn');
  }
});

test('determinism: 同 seed 完全一致，不同 seed 地形不同', function () {
  function fp(s) {
    return JSON.stringify({
      t: s.time,
      p: [s.player.x, s.player.y, s.player.hp, s.player.xp, s.player.level, s.player.bladeCount],
      m: s.monsters.length,
      types: s.monsters.map(function (m) { return m.type; }),
      kills: s.stats.kills,
      orbN: s.orbs.length
    });
  }
  var a = Engine.createGame(777), b = Engine.createGame(777);
  for (var i = 0; i < 400; i++) {
    var inp = { x: Math.sin(i / 20), y: Math.cos(i / 33) };
    Engine.step(a, inp, 1 / 60);
    Engine.step(b, inp, 1 / 60);
  }
  eq(fp(a), fp(b), 'same seed fingerprint');
  var c = Engine.createGame(778), d = Engine.createGame(779);
  ok(JSON.stringify(c.terrain) !== JSON.stringify(d.terrain), 'different seed terrain');
  eq(JSON.stringify(Engine.createGame(777).terrain), JSON.stringify(Engine.createGame(777).terrain), 'same seed terrain');
});

test('player.move: 按 input 移动，斜向不加速', function () {
  var s = Engine.createGame(9);
  var p = s.player, x0 = p.x, y0 = p.y;
  Engine.step(s, { x: 1, y: 0 }, 0.5);
  ok(p.x > x0, 'moved +x');
  near(p.y, y0, 1e-9, 'no y drift');
  near(p.x - x0, p.speed * 0.5, 1e-9, 'distance = speed*dt');

  var s2 = Engine.createGame(9), p2 = s2.player, ax = p2.x, ay = p2.y;
  Engine.step(s2, { x: 1, y: 1 }, 0.5);
  var dist = Math.hypot(p2.x - ax, p2.y - ay);
  near(dist, p2.speed * 0.5, 1e-6, 'diagonal normalized');
});

test('_internals.circleOverlap', function () {
  eq(I.circleOverlap(0, 0, 1, 1, 0, 1), true, 'overlap');
  eq(I.circleOverlap(0, 0, 1, 5, 0, 1), false, 'far');
  eq(I.circleOverlap(0, 0, 1, 2, 0, 1), false, 'exact touch not overlap');
});

test('_internals.resolveCircleOut', function () {
  var r = I.resolveCircleOut(0, 0, 1, 0.5, 0, 1);
  near(Math.hypot(r.x - 0.5, r.y - 0), 2, 1e-9, 'pushed to r+sr');
  var r2 = I.resolveCircleOut(10, 0, 1, 0, 0, 1);
  eq(r2.x, 10); eq(r2.y, 0);
});

test('blade kill: 刀击杀普通怪 -> kills++ 且生成经验球', function () {
  noSpawn(function () {
    var s = Engine.createGame(1);
    var p = s.player;
    p.angle = 0; p.rotationSpeed = 0;
    var bx = p.x + (p.orbitRadius + p.bladeLength * 0.5);
    s.monsters.push(makeMonster(1000, 'normal', bx, p.y, 1, []));
    Engine.step(s, { x: 0, y: 0 }, 1 / 60);
    eq(s.stats.kills, 1, 'kills');
    ok(s.orbs.length >= 1, 'orb generated');
    ok(s.orbs[0].value === CONFIG.monsters.normal.xp, 'orb value = xp');
    ok(s.events.some(function (e) { return e.type === 'kill'; }), 'kill event');
    ok(s.events.some(function (e) { return e.type === 'hit'; }), 'hit event');
  });
});

test('blade vs blade: 精英敌刀与玩家刀互相抵消', function () {
  noSpawn(function () {
    var s = Engine.createGame(2);
    var p = s.player;
    p.angle = 0; p.rotationSpeed = 0;
    var elite = makeMonster(2000, 'elite', p.x + 18, p.y, 1000,
      [{ active: true, angle: 0, _respawn: 0 }]);
    s.monsters.push(elite);
    Engine.step(s, { x: 0, y: 0 }, 1 / 60);
    eq(p.blades[0].active, false, 'player blade broken');
    eq(elite.blades[0].active, false, 'enemy blade cancelled');
    ok(s.events.some(function (e) { return e.type === 'bladeBreak'; }), 'bladeBreak event');
    ok(s.events.some(function (e) { return e.type === 'bladeCancel'; }), 'bladeCancel event');
  });
});

test('recovery: 断刀到点恢复 active', function () {
  noSpawn(function () {
    var s = Engine.createGame(3);
    var p = s.player;
    p.blades[0].active = false;
    p.blades[0]._inProgress = false;
    p.blades[0].recoverProgress = 0;
    s._recoveryQueue.push(0);
    var frames = Math.ceil(CONFIG.player.recoveryTime / (1 / 60)) + 3;
    for (var i = 0; i < frames; i++) Engine.step(s, { x: 0, y: 0 }, 1 / 60);
    eq(p.blades[0].active, true, 'recovered');
    eq(p.blades[0].recoverProgress, 1);
  });
});

test('recovery: 并行额度限制 (slots=1 时第二把等待)', function () {
  noSpawn(function () {
    var s = Engine.createGame(31);
    var p = s.player;
    eq(p.bladeCount, 2, '起始 2 把');
    Engine.applyCard(s, 'bladeCount'); // bladeCount=3
    eq(p.bladeCount, 3);
    // 断掉全部 3 把
    for (var i = 0; i < 3; i++) { p.blades[i].active = false; p.blades[i]._inProgress = false; s._recoveryQueue.push(i); }
    eq(p.recoverySlots, 1);
    Engine.step(s, { x: 0, y: 0 }, 1 / 60);
    var inProg = p.blades.filter(function (b) { return !b.active && b._inProgress; }).length;
    eq(inProg, 1, 'only one in progress');
  });
});

test('level: pendingLevelUps / rollCards 去重 / 满血无 heal', function () {
  noSpawn(function () {
    var s = Engine.createGame(4);
    var p = s.player;
    p.xp = 100;
    Engine.step(s, { x: 0, y: 0 }, 1 / 60);
    ok(s.pendingLevelUps >= 1, 'pendingLevelUps > 0');
    ok(s.events.some(function (e) { return e.type === 'levelup'; }), 'levelup event');
    eq(p.xp < p.xpToNext, true, 'xp rolled over');

    var cards = Engine.rollCards(s);
    ok(cards.length <= 3, 'at most 3');
    var ids = cards.map(function (c) { return c.id; });
    eq(new Set(ids).size, ids.length, 'unique');
    eq(ids.indexOf('heal'), -1, 'no heal when full hp');

    // applyCard 使 pendingLevelUps -= 1
    var before = s.pendingLevelUps;
    Engine.applyCard(s, ids[0]);
    eq(s.pendingLevelUps, before - 1, 'pending decremented');

    // 受伤后 heal 可用
    p.hp = p.maxHp - 1;
    eq(I.isCardAvailable(s, 'heal'), true, 'heal available when hurt');
  });
});

test('difficulty: 随 time 缩放', function () {
  ok(I.spawnInterval(0) > I.spawnInterval(100), 'spawn interval decreases');
  near(I.spawnInterval(0), CONFIG.spawn.baseInterval, 1e-9);
  eq(I.monsterHpMult(0), 1);
  ok(I.monsterHpMult(5) > I.monsterHpMult(0), 'hp mult rises');
  near(I.monsterHpMult(5), 1 + CONFIG.spawn.hpMultPerTier * 5, 1e-9);
  ok(I.monsterSpeedMult(4) > I.monsterSpeedMult(0), 'speed mult rises');
  eq(I.eliteChance(100000), CONFIG.spawn.eliteChanceCap, 'elite chance capped');
  eq(I.tierAt(0), 0);
  eq(I.tierAt(65), 2);
});

test('difficulty: 玩家所在 tier 随时间增长', function () {
  var s = Engine.createGame(6);
  s.player.hp = 1e9; // 保持存活以观察 tier 增长
  for (var i = 0; i < 60 * 61; i++) Engine.step(s, { x: 0, y: 0 }, 1 / 60);
  eq(s.status, 'running', 'still running');
  eq(s.difficultyTier, 2, 'tier after 61s');
});

test('maxAliveMonsters: 硬上限', function () {
  var s0 = CONFIG.spawn.maxAliveMonsters, b0 = CONFIG.spawn.baseInterval, m0 = CONFIG.spawn.minInterval;
  CONFIG.spawn.maxAliveMonsters = 15;
  CONFIG.spawn.baseInterval = 0.02;
  CONFIG.spawn.minInterval = 0.02;
  try {
    var s = Engine.createGame(5);
    for (var i = 0; i < 1800; i++) Engine.step(s, { x: Math.sin(i / 10), y: 0 }, 1 / 60);
    ok(s.monsters.length <= 15, 'never exceeds cap, got ' + s.monsters.length);
    ok(s.monsters.length > 5, 'monsters actually spawned');
  } finally {
    CONFIG.spawn.maxAliveMonsters = s0; CONFIG.spawn.baseInterval = b0; CONFIG.spawn.minInterval = m0;
  }
});

test('xpToNext: 曲线', function () {
  eq(I.xpToNext(1), 5);
  eq(I.xpToNext(2), 9);
  eq(I.xpToNext(3), 13);
  eq(I.xpToNext(10), 5 + 9 * 4);
});

test('cards: 定义完整 & 上限时不可用', function () {
  var s = Engine.createGame(8);
  eq(Engine.CARDS.length, 9);
  for (var i = 0; i < Engine.CARDS.length; i++) {
    var c = Engine.CARDS[i];
    ok(c.id && c.title && c.desc && c.icon, 'card fields');
  }
  s.player.bladeCount = CONFIG.player.bladeCountCap;
  s.player.maxHp = CONFIG.player.maxHpCap;
  s.player.recoverySlots = CONFIG.player.recoverySlotsCap;
  eq(I.isCardAvailable(s, 'bladeCount'), false);
  eq(I.isCardAvailable(s, 'maxHp'), false);
  eq(I.isCardAvailable(s, 'recoverySlots'), false);
  eq(I.isCardAvailable(s, 'attack'), true);
});

test('bladeCollider: 几何公式正确', function () {
  var c = I.bladeCollider(0, 0, 0, 40, 20);
  near(c.x, 50, 1e-9); near(c.y, 0, 1e-9); near(c.r, 18, 1e-9);
  var c2 = I.bladeCollider(100, 100, Math.PI / 2, 40, 20);
  near(c2.x, 100, 1e-9); near(c2.y, 150, 1e-9);
});

test('dead: hp<=0 -> status=dead 且停止推进', function () {
  var s = Engine.createGame(10);
  s.player.hp = 0;
  Engine.step(s, { x: 0, y: 0 }, 1 / 60);
  eq(s.status, 'dead');
  var t = s.time;
  Engine.step(s, { x: 1, y: 0 }, 1 / 60);
  eq(s.time, t, 'time frozen after death');
});

/* ===================================================================== */
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
