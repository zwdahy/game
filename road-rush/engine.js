/*
 * 《公路突围 / Road Rush》纯逻辑引擎
 * ---------------------------------------------------------------------------
 * 传统脚本 (无 ES module)。浏览器端 window.RoadEngine，Node 端 module.exports。
 * 纯逻辑：不使用 document / canvas / Date / Math.random / performance。
 * 时间推进只依赖外部 dt，所有随机数来自注入种子的 mulberry32。
 *
 * 坐标模型：
 *   - state.distance 为玩家绝对前进距离（米）。
 *   - 所有实体的 d 也是绝对距离；渲染层用 depth = entity.d - state.distance。
 *   - 横向 x 归一化：-1 左路沿，+1 右路沿。
 */
(function (root) {
  'use strict';

  /* ======================================================================
   * 关卡 / 武器数据
   * ==================================================================== */
  var LEVELS = [
    { index: 0, id: 1, name: '城郊公路', theme: 'day',    trackLength: 960, startPeople: 3, startWeapon: 1, difficulty: 1.0, boss: 'brute',   bossName: '路障巨尸', bossHp: 700 },
    { index: 1, id: 2, name: '废弃工业区', theme: 'sunset', trackLength: 1170, startPeople: 3, startWeapon: 2, difficulty: 1.3, boss: 'butcher', bossName: '电锯屠夫', bossHp: 1100 },
    { index: 2, id: 3, name: '城市高架', theme: 'night',  trackLength: 1410, startPeople: 3, startWeapon: 2, difficulty: 1.6, boss: 'mother',  bossName: '暴君母体', bossHp: 1600 }
  ];

  var WEAPON_TIERS = [
    { tier: 1, name: '手枪',   streams: 1, damage: 8.0,  rate: 0.85, pierce: 0, aoe: 0,    bulletSpeed: 90,  maxStreams: 16, spread: 0.07, color: '#ffd166' },
    { tier: 2, name: '双管',   streams: 2, damage: 6.5,  rate: 1.00, pierce: 0, aoe: 0,    bulletSpeed: 90,  maxStreams: 16, spread: 0.07, color: '#ffb347' },
    { tier: 3, name: '机关枪', streams: 1, damage: 3.6,  rate: 2.20, pierce: 0, aoe: 0,    bulletSpeed: 110, maxStreams: 16, spread: 0.05, color: '#ff8c69' },
    { tier: 4, name: '火箭筒', streams: 1, damage: 24.0, rate: 0.55, pierce: 0, aoe: 0.25, bulletSpeed: 55,  maxStreams: 3,  spread: 0.09, color: '#7ef0ff' },
    { tier: 5, name: '坦克炮', streams: 1, damage: 48.0, rate: 0.42, pierce: 0, aoe: 0.42, bulletSpeed: 45,  maxStreams: 2,  spread: 0.10, color: '#ffa94d' },
    { tier: 6, name: '等离子', streams: 1, damage: 12.0, rate: 1.50, pierce: 2, aoe: 0.18, bulletSpeed: 95,  maxStreams: 6,  spread: 0.08, color: '#c77dff' }
  ];

  // 武器箱：按关卡进度出现，越高级 HP 越高。
  var CRATE_SCHEDULE = [
    [{ tier: 3, frac: 0.22, hp: 40 }, { tier: 3, frac: 0.48, hp: 40 }, { tier: 4, frac: 0.74, hp: 90 }],
    [{ tier: 3, frac: 0.18, hp: 40 }, { tier: 4, frac: 0.40, hp: 90 }, { tier: 4, frac: 0.60, hp: 90 }, { tier: 5, frac: 0.82, hp: 160 }],
    [{ tier: 3, frac: 0.15, hp: 40 }, { tier: 4, frac: 0.33, hp: 90 }, { tier: 5, frac: 0.52, hp: 160 }, { tier: 5, frac: 0.70, hp: 160 }, { tier: 6, frac: 0.88, hp: 260 }]
  ];
  var GATE_COUNTS = [12, 14, 16];
  var WAVE_PATTERN_WEIGHTS = [
    { normal: 0.55, runnerRush: 0.15, tankEscort: 0.10, barrelChain: 0.20 },
    { normal: 0.35, runnerRush: 0.15, tankEscort: 0.28, barrelChain: 0.22 },
    { normal: 0.28, runnerRush: 0.34, tankEscort: 0.20, barrelChain: 0.18 }
  ];

  var ENEMY_STATS = {
    walker: { hp: 18, speed: 1.95, radius: 0.045, damage: 1, score: 10 },
    runner: { hp: 12, speed: 3.95, radius: 0.04,  damage: 1, score: 15 },
    tank:   { hp: 70, speed: 1.05, radius: 0.075, damage: 4, score: 50 }
  };

  var MAX_PEOPLE = 120;
  var MAX_WEAPON = 6;
  var BASE_SPEED = 9.2;
  var LATERAL_SPEED = 1.9;
  var FIRE_BASE = 0.32;
  var BOSS_ARENA = 120;
  var BOSS_MIN_HP = [3000, 4500, 5600];
  var BOSS_MAX_HP = [9000, 12000, 16000];
  var BOSS_TARGET_SECONDS = [13, 17, 18];
  var BOSS_HP_FACTOR = 0.60; // 约 60% 实际命中率
  var HEAVY_BOSS_MIN_FLOOR = 1200; // 火箭筒/坦克炮等低射流武器的动态下限
  var BOSS_HIT_RADIUS = 0.45; // Boss 子弹命中半径（视觉 radius 仍为 0.16）

  // 前期压力曲线：窗口越小，同时活跃的波次越少。
  var ACTIVATE_WINDOW = [60, 64, 68];
  var WAVE_CFG = [
    { min: 2, max: 4, gapMin: 28, gapRange: 10 },
    { min: 3, max: 5, gapMin: 24, gapRange: 8 },
    { min: 3, max: 6, gapMin: 26, gapRange: 8 }
  ];
  var MAX_EVENTS = 120;
  var MAX_ENEMIES = 180;
  var MAX_ACTIVE_BULLETS = 48; // 屏幕内并发子弹安全上限（约 3 个 16 发弹幕）
  var MAX_DROPS_PER_RUN = 16; // 长关卡单局掉落上限
  var MAX_ENEMY_SHOTS = 220;
  var MAX_PICKUPS = 60;

  /* ======================================================================
   * 纯函数工具
   * ==================================================================== */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // 安全数字：任何非有限值 -> fallback（避免 NaN 污染）
  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  function copyEffect(e) {
    return { kind: e.kind, value: e.value, label: e.label, good: e.good };
  }

  function pushEvent(state, ev) {
    if (state.events.length < MAX_EVENTS) state.events.push(ev);
  }

  function weaponAt(level) {
    var i = clamp(Math.floor(num(level, 1)) - 1, 0, WEAPON_TIERS.length - 1);
    return WEAPON_TIERS[i];
  }

  // 一梭子弹的单发伤害：人数越多越强（封顶按 120 人计算）
  function bulletDamageFor(tier, people) {
    return tier.damage * (1 + Math.min(Math.max(num(people, 0), 0), 120) * 0.005);
  }

  /* ======================================================================
   * 门 / 增益效果
   * ==================================================================== */
  function effect(kind, value, label, good) {
    return { kind: kind, value: value, label: label, good: good };
  }

  var GOOD_EFFECTS = [
    effect('people', 3, '+3', true),
    effect('people', 5, '+5', true),
    effect('people', 8, '+8', true),
    effect('multiply', 2, '×2', true),
    effect('weapon', 1, '枪械+1', true),
    effect('fireRate', 0.2, '射速+20%', true)
  ];

  // 开局教学门只用“人数型”增益，保证 3 人开局无论走哪侧都能扩编。
  var OPENING_GOOD_EFFECTS = [
    effect('people', 3, '+3', true),
    effect('people', 5, '+5', true),
    effect('people', 8, '+8', true),
    effect('multiply', 2, '×2', true)
  ];

  var BAD_EFFECTS = [
    effect('people', -3, '-3', false),
    effect('people', -5, '-5', false),
    effect('people', -8, '-8', false),
    effect('divide', 2, '÷2', false),
    effect('weapon', -1, '枪械-1', false),
    effect('fireRate', -0.15, '射速-15%', false)
  ];

  // L1 只使用温和惩罚，避免开局随机到 ÷2 / 枪械-1 直接雪崩。
  var MILD_BAD_EFFECTS = [
    effect('people', -3, '-3', false),
    effect('people', -5, '-5', false),
    effect('fireRate', -0.15, '射速-15%', false)
  ];

  // 惩罚严重度，用于 Lv3 “两个坏门选较轻”
  function severity(e) {
    if (e.kind === 'people') return Math.abs(e.value) / 3;
    if (e.kind === 'divide') return 5;
    if (e.kind === 'weapon') return 3;
    if (e.kind === 'fireRate') return 1;
    return 0;
  }

  function makeGatePair(levelIndex, rng, forceGood) {
    var a, b, pool;
    var mode; // 0 = 一好一坏, 1 = 双好, 2 = 双坏

    if (forceGood) {
      mode = 1;
    } else if (levelIndex >= 2) {
      var r = rng();
      mode = r < 0.25 ? 1 : (r < 0.5 ? 2 : 0);
    } else {
      mode = rng() < 0.35 ? 1 : 0;
    }

    if (mode === 1) {
      var poolGood = forceGood ? OPENING_GOOD_EFFECTS : GOOD_EFFECTS;
      var ai = Math.floor(rng() * poolGood.length) % poolGood.length;
      var bi = (ai + 1 + Math.floor(rng() * (poolGood.length - 1))) % poolGood.length;
      a = copyEffect(poolGood[ai]);
      b = copyEffect(poolGood[bi]);
    } else if (mode === 2) {
      a = copyEffect(pick(BAD_EFFECTS, rng));
      pool = [];
      for (var i = 0; i < BAD_EFFECTS.length; i++) {
        if (severity(BAD_EFFECTS[i]) !== severity(a)) pool.push(BAD_EFFECTS[i]);
      }
      b = copyEffect(pick(pool, rng));
    } else {
      a = copyEffect(pick(GOOD_EFFECTS, rng));
      b = copyEffect(pick(levelIndex === 0 ? MILD_BAD_EFFECTS : BAD_EFFECTS, rng));
    }

    // Lv1 安全约束：不允许 ÷2 和 枪械-1 同框（实际上“至少一个好门”已避免，
    // 这里仍做兜底，防止以后调整规则时出现）。
    if (levelIndex === 0 &&
        ((a.kind === 'divide' && b.kind === 'weapon' && b.value < 0) ||
         (b.kind === 'divide' && a.kind === 'weapon' && a.value < 0))) {
      b = copyEffect(GOOD_EFFECTS[0]);
    }

    if (rng() < 0.5) { var t = a; a = b; b = t; }
    return [a, b];
  }

  // 应用一个门效果（纯状态修改，不生成事件）
  function applyGateEffect(state, eff) {
    if (!state || !eff) return state;
    var v = num(eff.value, 0);
    var people = clamp(Math.round(num(state.people, 1)), 1, MAX_PEOPLE);
    var maxP = num(state.maxPeople, MAX_PEOPLE);
    if (maxP < 1) maxP = 1;

    switch (eff.kind) {
      case 'people':
        people = clamp(people + v, 1, maxP);
        break;
      case 'multiply':
        people = clamp(Math.ceil(people * v), 1, maxP);
        break;
      case 'divide':
        people = clamp(Math.ceil(people / (v || 1)), 1, maxP);
        break;
      case 'weapon':
        state.weaponLevel = clamp(Math.round(num(state.weaponLevel, 1)) + v, 1, MAX_WEAPON);
        break;
      case 'fireRate':
        state.fireRate = clamp(num(state.fireRate, 1) + v, 0.6, 2.2);
        break;
      default:
        break;
    }

    if (eff.kind === 'people' || eff.kind === 'multiply' || eff.kind === 'divide') {
      state.people = people;
    }
    return state;
  }

  function processGates(state, prevDistance) {
    var i, g, ev, side, eff, before;
    for (i = 0; i < state.gates.length; i++) {
      g = state.gates[i];
      if (g.applied || !g.d) continue;
      if (prevDistance <= g.d && state.distance >= g.d) {
        g.applied = true;
        side = state.x < 0 ? 'left' : 'right';
        eff = g[side];
        before = state.people;
        applyGateEffect(state, eff);
        state.stats.gates += 1;
        if (state.people > before) state.stats.peopleGained += state.people - before;
        pushEvent(state, {
          type: 'gate', side: side, kind: eff.kind, value: eff.value,
          label: eff.label, good: eff.good,
          people: state.people, weaponLevel: state.weaponLevel
        });
      }
    }
  }

  /* ======================================================================
   * 关卡生成：门 / 敌人波次 / 道具
   * ==================================================================== */
  function generateGates(state, rng) {
    var bossD = state.trackLength - BOSS_ARENA;
    var start = 52 + rng() * 4;
    var limit = bossD - 2;
    var span = Math.max(80, limit - start);
    var count = (GATE_COUNTS[state.levelIndex] || 12);
    var interval = span / (count - 1);
    var gates = [];
    var i, d, pair;

    for (i = 0; i < count; i++) {
      d = start + interval * i;
      if (i > 0 && i < count - 1) d += (rng() - 0.5) * 3;
      d = clamp(d, start - 2, limit);
      // L1 前三道门固定双增益，作为新手保护/教学，避免开局连续惩罚直接团灭。
      pair = makeGatePair(state.levelIndex, rng, state.levelIndex === 0 && i < 3);
      gates.push({
        id: state._nextId++,
        d: d,
        applied: false,
        left: pair[0],
        right: pair[1]
      });
    }

    gates.sort(function (a, b) { return a.d - b.d; });
    return gates;
  }

  function rollEnemyType(levelIndex, rng) {
    var r = rng();
    if (levelIndex <= 0) {
      if (r < 0.18) return 'runner';
      if (r > 0.96) return 'tank';
      return 'walker';
    }
    if (levelIndex === 1) {
      if (r < 0.30) return 'runner';
      if (r > 0.82) return 'tank';
      return 'walker';
    }
    if (r < 0.36) return 'runner';
    if (r > 0.66) return 'tank';
    return 'walker';
  }

  function generateSchedule(state, rng) {
    var bossD = state.trackLength - BOSS_ARENA;
    var cfg = WAVE_CFG[state.levelIndex] || WAVE_CFG[0];
    var weights = WAVE_PATTERN_WEIGHTS[state.levelIndex] || WAVE_PATTERN_WEIGHTS[0];
    var list = [];
    var waveD = 38 + rng() * 6;
    var waveIndex = 0;
    var chainWaves = 0;
    var chainBarrels = 0;
    var i, j, size, units, type, baseX, x, dd, pattern;

    function lane(i, n) {
      return clamp(-0.8 + (i + 0.5) * (1.6 / n) + (rng() - 0.5) * 0.14, -0.9, 0.9);
    }

    function pickPattern() {
      if (waveIndex === 3) return 'runnerRush';
      if (waveIndex === 4) return 'tankEscort';
      if (waveIndex === 5) return 'barrelChain';
      var r = rng();
      if (r < weights.normal) return 'normal';
      r -= weights.normal;
      if (r < weights.runnerRush) return 'runnerRush';
      r -= weights.runnerRush;
      if (r < weights.tankEscort) return 'tankEscort';
      return 'barrelChain';
    }

    // 敌人波次：普通 / 冲锋 / 坦克护送 / 油桶连锁
    while (waveD < bossD - 12) {
      pattern = (state.levelIndex === 0 && waveIndex < 2) ? 'normal' : pickPattern();
      if (pattern === 'barrelChain' && chainWaves >= 1) pattern = 'normal';
      units = [];

      if (pattern === 'runnerRush') {
        size = 5 + Math.floor(rng() * 4); // 5-8
        for (i = 0; i < size; i++) {
          x = lane(i, size);
          dd = clamp(waveD + (rng() - 0.5) * 3 + (i % 2) * 0.8, 2, bossD - 4);
          units.push({ type: 'runner', x: x, d: dd });
        }
      } else if (pattern === 'tankEscort') {
        units.push({ type: 'tank', x: clamp((rng() - 0.5) * 0.9, -0.55, 0.55), d: waveD });
        size = 3 + Math.floor(rng() * 2); // 3-4 walkers
        for (i = 0; i < size; i++) {
          x = lane(i, size);
          dd = clamp(waveD + (rng() - 0.5) * 4, 2, bossD - 4);
          units.push({ type: 'walker', x: x, d: dd });
        }
      } else if (pattern === 'barrelChain') {
        chainWaves += 1;
        var bx = clamp((rng() < 0.5 ? -1 : 1) * (0.2 + rng() * 0.35), -0.65, 0.65);
        for (i = 0; i < 3; i++) {
          list.push({
            kind: 'prop', type: 'barrel',
            d: clamp(waveD + i * 1.4, 2, bossD - 6),
            x: clamp(bx + (rng() - 0.5) * 0.08, -0.8, 0.8)
          });
          chainBarrels += 1;
        }
        for (i = 0; i < 2; i++) {
          units.push({
            type: 'walker', x: lane(i, 2),
            d: clamp(waveD + (rng() - 0.5) * 2, 2, bossD - 4)
          });
        }
      } else {
        size = cfg.min + Math.floor(rng() * (cfg.max - cfg.min + 1));
        if (waveIndex === 0) size = Math.min(size, 4);
        if (state.levelIndex === 0 && waveIndex === 0) size = 2;
        for (i = 0; i < size; i++) {
          type = rollEnemyType(state.levelIndex, rng);
          // 开局保护：各关第一波不出坦克；L1 前两波不出坦克，第一波纯 walker
          if (waveIndex === 0 && type === 'tank') type = 'walker';
          if (state.levelIndex === 0 && waveIndex < 2) {
            if (type === 'tank') type = 'walker';
            if (waveIndex === 0) type = 'walker';
          }
          x = lane(i, size);
          dd = clamp(waveD + (rng() - 0.5) * 4, 2, bossD - 4);
          units.push({ type: type, x: x, d: dd });
        }
      }

      list.push({
        kind: 'wave', d: waveD, units: units,
        index: waveIndex, pattern: pattern
      });
      waveD += cfg.gapMin + rng() * cfg.gapRange;
      waveIndex += 1;
    }

    // 精英坦克：约 60% 进度，3.5x HP，必掉 medkit + ammo
    var eliteD = clamp(state.trackLength * 0.60 + (rng() - 0.5) * 8, 40, bossD - 30);
    list.push({
      kind: 'wave', d: eliteD, pattern: 'elite', index: waveIndex,
      units: [{
        type: 'tank', x: clamp((rng() - 0.5) * 0.8, -0.5, 0.5),
        d: eliteD, elite: true, hpMult: 3.5
      }]
    });

    // 油桶总数 4-6：连锁波已提供 3 个，剩余补普通油桶
    var barrelsTarget = 4 + Math.floor(rng() * 3);
    var barrels = Math.max(0, barrelsTarget - chainBarrels);
    var propSpan = Math.max(20, bossD - 65);
    for (j = 0; j < barrels; j++) {
      list.push({
        kind: 'prop', d: 45 + rng() * propSpan, type: 'barrel',
        x: clamp((rng() - 0.5) * 1.4, -0.75, 0.75)
      });
    }

    // 武器箱：3-5 个，按进度阈值出现，偏置在 ±0.3..0.6
    var crates = CRATE_SCHEDULE[state.levelIndex] || [];
    for (j = 0; j < crates.length; j++) {
      var cd = crates[j];
      var crateD = clamp(state.trackLength * cd.frac + (rng() - 0.5) * 5, 30, bossD - 12);
      var cx = (rng() < 0.5 ? -1 : 1) * (0.3 + rng() * 0.15);
      list.push({
        kind: 'prop', type: 'weaponCrate', tier: cd.tier,
        hp: cd.hp, maxHp: cd.hp, d: crateD, x: cx
      });
    }

    list.sort(function (a, b) {
      if (a.d !== b.d) return a.d - b.d;
      if (a.kind === b.kind) return 0;
      return a.kind < b.kind ? -1 : 1;
    });
    return list;
  }

  /* ======================================================================
   * 实体工厂
   * ==================================================================== */
  function spawnEnemy(state, type, x, d, elite, hpMult) {
    if (state.enemies.length >= MAX_ENEMIES) return null;
    var base = ENEMY_STATS[type] || ENEMY_STATS.walker;
    var diff = num(state.difficulty, 1);
    // 难度只做温和放大：高难关卡不再让速度/伤害线性爆炸。
    var hpScale = 1 + (diff - 1) * 0.65;
    var speedScale = 1 + (diff - 1) * 0.5;
    var dmgScale = 1 + (diff - 1) * 0.5;
    var hp = base.hp * hpScale * (elite ? num(hpMult, 3.5) : 1);
    var e = {
      id: state._nextId++,
      type: ENEMY_STATS[type] ? type : 'walker',
      x: clamp(num(x, 0), -0.95, 0.95),
      d: num(d, state.distance + 30),
      hp: hp,
      maxHp: hp,
      speed: base.speed * speedScale,
      radius: base.radius,
      damage: Math.max(1, Math.floor(base.damage * dmgScale)),
      hitFlash: 0,
      dead: false
    };
    if (elite) e.elite = true;
    state.enemies.push(e);
    return e;
  }

  function spawnPickup(state, type, x, d, value) {
    if (state.pickups.length >= MAX_PICKUPS) return null;
    var fallback = type === 'medkit' ? 3 : 0.08;
    var p = {
      id: state._nextId++,
      type: type,
      x: clamp(num(x, 0), -0.95, 0.95),
      d: num(d, state.distance + 5),
      value: num(value, fallback),
      dead: false
    };
    state.pickups.push(p);
    state._dropsSpawned += 1;
    return p;
  }

  function spawnEnemyShot(state, x, d, speed, damage, radius, kind) {
    if (state.enemyShots.length >= MAX_ENEMY_SHOTS) return null;
    var s = {
      id: state._nextId++,
      x: clamp(num(x, 0), -1, 1),
      d: num(d, state.distance + 20),
      speed: num(speed, 15),
      damage: num(damage, 4),
      radius: num(radius, 0.1),
      kind: kind || 'acid',
      dead: false
    };
    state.enemyShots.push(s);
    return s;
  }

  function activateSchedule(state) {
    var sch = state._schedule;
    var win = ACTIVATE_WINDOW[state.levelIndex] || ACTIVATE_WINDOW[0];
    var i, item, j, u;
    while (state._scheduleIndex < sch.length &&
           sch[state._scheduleIndex].d - state.distance < win) {
      item = sch[state._scheduleIndex++];
      if (item.kind === 'wave') {
        for (j = 0; j < item.units.length; j++) {
          u = item.units[j];
          var se = spawnEnemy(state, u.type, u.x, u.d, u.elite, u.hpMult);
          if (u.elite) {
            pushEvent(state, {
              type: 'eliteSpawn', x: u.x, d: u.d,
              name: '精英坦克'
            });
          }
        }
      } else if (item.kind === 'prop') {
        var hp = item.maxHp || 1;
        state.props.push({
          id: state._nextId++,
          type: item.type,
          tier: item.tier,
          x: clamp(item.x, -0.9, 0.9),
          d: item.d,
          hp: hp,
          maxHp: hp,
          radius: item.type === 'weaponCrate' ? 0.13 : 0.085,
          dead: false
        });
      }
    }
  }

  /* ======================================================================
   * 伤害 / 死亡
   * ==================================================================== */
  function damageEnemy(state, e, dmg) {
    if (!e || e.dead) return false;
    e.hp -= dmg;
    e.hitFlash = 0.1;
    if (e.hp <= 0) {
      e.hp = 0;
      e.dead = true;
      state.kills += 1;
      state.stats.kills += 1;
      state.score += (ENEMY_STATS[e.type] || ENEMY_STATS.walker).score;
      pushEvent(state, { type: 'kill', x: e.x, d: e.d, kind: e.type, elite: !!e.elite });
      // 只有被子弹/爆炸击杀才掉落；接触减员不走 damageEnemy。
      if (e.elite) {
        spawnPickup(state, 'medkit', e.x - 0.03, e.d, 8);
        spawnPickup(state, 'ammo', e.x + 0.03, e.d, 0.10);
      } else {
        rollDrop(state, e);
      }
      return true;
    }
    return false;
  }

  // 击杀掉落：一次随机数决定是否掉、掉什么；保证确定性。
  function rollDrop(state, e) {
    if (state._dropsSpawned >= MAX_DROPS_PER_RUN) return;
    var r = state._rng();
    var type = null, value = 0;
    if (e.type === 'walker') {
      if (r < 0.18) { type = 'medkit'; value = 3; }
      else if (r < 0.26) { type = 'ammo'; value = 0.08; }
    } else if (e.type === 'runner') {
      if (r < 0.18) { type = 'medkit'; value = 3; }
      else if (r < 0.32) { type = 'ammo'; value = 0.08; }
    } else if (e.type === 'tank') {
      if (r < 0.60) { type = 'medkit'; value = 8; }
      else { type = 'ammo'; value = 0.10; }
    }
    if (type) spawnPickup(state, type, e.x, e.d, value);
  }

  function damageBoss(state, boss, dmg) {
    if (!boss || boss.dead) return;
    boss.hp -= dmg;
    boss.hitFlash = 0.1;
    pushEvent(state, { type: 'bossHit', x: boss.x, d: boss.d });
    if (boss.hp <= 0) {
      boss.hp = 0;
      killBoss(state);
    }
  }

  function killBoss(state) {
    if (state.status !== 'running') return;
    var b = state.boss;
    if (b) { b.hp = 0; b.dead = true; }
    state.status = 'won';
    state.phase = 'won';
    state.speed = 0;
    var beforePeople = state.people;
    state.people = clamp(state.people + 10, 1, MAX_PEOPLE);
    state.stats.peopleGained += Math.max(0, state.people - beforePeople);
    state.score += Math.round(1000 * num(state.difficulty, 1));
    state.stats.bossKills += 1;
    pushEvent(state, {
      type: 'win', clearBonus: 10, people: state.people
    });
  }

  function damageProp(state, prop, dmg) {
    if (!prop || prop.dead) return;
    prop.hp -= dmg;
    if (prop.hp > 0) return;
    prop.hp = 0;
    prop.dead = true;

    if (prop.type === 'barrel') {
      explodeBarrel(state, prop);
    } else if (prop.type === 'weaponCrate') {
      var tier = clamp(Math.floor(num(prop.tier, 1)), 1, WEAPON_TIERS.length);
      if (tier > state.weaponLevel) {
        state.weaponLevel = tier;
        pushEvent(state, {
          type: 'pickup', x: prop.x, d: prop.d,
          kind: 'weapon', value: tier, label: WEAPON_TIERS[tier - 1].name
        });
      } else {
        // 不降级：已经同级/更强时给少量火力与分数补偿。
        state.score += 75;
        state.fireRate = clamp(num(state.fireRate, 1) + 0.04, 0.6, 2.2);
        pushEvent(state, {
          type: 'pickup', x: prop.x, d: prop.d,
          kind: 'ammo', value: 0.04, label: '火力补给'
        });
      }
    }
  }

  // 油桶爆炸：伤害附近敌人与 boss，但绝不伤害玩家
  function explodeBarrel(state, prop) {
    var i, e, b;
    pushEvent(state, { type: 'explode', x: prop.x, d: prop.d });
    for (i = 0; i < state.enemies.length; i++) {
      e = state.enemies[i];
      if (e.dead) continue;
      if (Math.abs(e.d - prop.d) <= 7 && Math.abs(e.x - prop.x) <= 0.35) {
        damageEnemy(state, e, 80);
      }
    }
    b = state.boss;
    if (b && !b.dead && Math.abs(b.d - prop.d) <= 7 && Math.abs(b.x - prop.x) <= 0.35) {
      damageBoss(state, b, 50);
    }
    // 连锁爆炸：附近其他油桶也引爆
    for (i = 0; i < state.props.length; i++) {
      var p = state.props[i];
      if (!p || p === prop || p.dead || p.type !== 'barrel') continue;
      if (Math.abs(p.d - prop.d) <= 7 && Math.abs(p.x - prop.x) <= 0.35) {
        damageProp(state, p, 1);
      }
    }
  }

  function hurtPlayer(state, amount, x) {
    if (state.status !== 'running') return;
    // 群体受击后短暂无敌，避免一波怪在同一帧/连续帧瞬间清空人群。
    if (num(state._hurtCooldown, 0) > 0) return;
    var dmg = Math.max(0, Math.round(num(amount, 0)));
    if (dmg <= 0) return;
    var before = clamp(Math.round(num(state.people, 0)), 0, MAX_PEOPLE);
    var actual = Math.min(before, dmg);
    state.people = clamp(before - dmg, 0, MAX_PEOPLE);
    state._hurtCooldown = 0.45;
    pushEvent(state, { type: 'hurt', amount: actual, x: num(x, state.x) });
  }

  /* ======================================================================
   * 子弹
   * ==================================================================== */
  function hasTargetAhead(state) {
    var i, e, p, b;
    for (i = 0; i < state.enemies.length; i++) {
      e = state.enemies[i];
      if (!e.dead && e.d - state.distance >= 1 && e.d - state.distance <= 75) return true;
    }
    for (i = 0; i < state.props.length; i++) {
      p = state.props[i];
      if (!p.dead && p.d - state.distance >= 1 && p.d - state.distance <= 75) return true;
    }
    b = state.boss;
    if (b && !b.dead && b.d - state.distance >= 1 && b.d - state.distance <= 75) return true;
    return false;
  }

  function volleyStreams(state, tier) {
    var people = Math.floor(Math.max(num(state.people, 1), 1));
    return clamp(people + tier.streams - 1, 1, tier.maxStreams || 16);
  }

  function fireVolley(state) {
    if (state.bullets.length > MAX_ACTIVE_BULLETS) state.bullets.length = MAX_ACTIVE_BULLETS;
    var tier = weaponAt(state.weaponLevel);
    var dmg = bulletDamageFor(tier, state.people);
    var streams = volleyStreams(state, tier);
    var slots = MAX_ACTIVE_BULLETS - state.bullets.length;
    if (slots <= 0) return;
    var spawnCount = Math.min(streams, slots);
    // 并发上限抑制部分子弹时，提高单发伤害以保持近似 DPS。
    var shotDamage = dmg * (streams / spawnCount);
    var fanWidth = (streams - 1) * (tier.spread || 0.07);
    var i, x, b;

    for (i = 0; i < spawnCount; i++) {
      x = state.x + (((i + 0.5) / spawnCount - 0.5) * fanWidth);
      x = clamp(x, -0.96, 0.96);
      b = {
        id: state._nextId++,
        tier: tier.tier,
        x: x,
        d: state.distance + 2,
        speed: tier.bulletSpeed || 90,
        damage: shotDamage,
        pierce: tier.pierce,
        aoe: tier.aoe,
        dead: false,
        _hits: []
      };
      state.bullets.push(b);
      state.stats.shots += 1;
    }
    pushEvent(state, {
      type: 'shot', x: state.x, tier: tier.tier,
      streams: streams, fired: spawnCount
    });
  }

  function updateAutoFire(state, dt) {
    var tier = weaponAt(state.weaponLevel);
    var interval = FIRE_BASE / (tier.rate * clamp(num(state.fireRate, 1), 0.6, 2.2));
    state._fireTimer += dt;
    if (state._fireTimer > interval * 3) state._fireTimer = interval * 3;

    if (!hasTargetAhead(state)) {
      if (state._fireTimer > interval) state._fireTimer = interval;
      return;
    }

    var guard = 0;
    while (state._fireTimer >= interval && guard < 3) {
      state._fireTimer -= interval;
      fireVolley(state);
      guard += 1;
    }
  }

  function bulletTarget(state, bullet, prevD, curD) {
    var best = null, bestD = Infinity;
    var i, e, p, b, key, tol;

    function consider(kind, ent, radius) {
      if (!ent || ent.dead) return;
      key = kind.charAt(0) + ent.id;
      if (bullet._hits && bullet._hits.indexOf(key) >= 0) return;
      if (!isFinite(ent.d) || !isFinite(ent.x)) return;
      if (ent.d < state.distance - 1) return;
      tol = 1.6 + radius;
      if (ent.d < prevD - tol || ent.d > curD + tol) return;
      if (Math.abs(bullet.x - ent.x) >= 0.09 + radius) return;
      if (ent.d < bestD) {
        bestD = ent.d;
        best = { kind: kind, ent: ent, radius: radius };
      }
    }

    for (i = 0; i < state.enemies.length; i++) {
      e = state.enemies[i];
      consider('enemy', e, e.radius);
    }
    for (i = 0; i < state.props.length; i++) {
      p = state.props[i];
      consider('prop', p, p.radius);
    }
    b = state.boss;
    if (b) consider('boss', b, num(b.hitRadius, b.radius));
    return best;
  }

  function applyAoe(state, bullet, impactX, impactD) {
    var i, e, key;
    for (i = 0; i < state.enemies.length; i++) {
      e = state.enemies[i];
      if (e.dead) continue;
      key = 'e' + e.id;
      if (bullet._hits && bullet._hits.indexOf(key) >= 0) continue;
      if (Math.abs(e.d - impactD) <= 5 && Math.abs(e.x - impactX) <= 0.3) {
        if (bullet._hits) bullet._hits.push(key);
        damageEnemy(state, e, bullet.damage * 0.5);
      }
    }
  }

  function updateBullets(state, dt) {
    var i, b, prevD, curD, target, key;
    for (i = 0; i < state.bullets.length; i++) {
      b = state.bullets[i];
      if (b.dead) continue;

      prevD = b.d;
      curD = prevD + num(b.speed, 90) * dt;
      b.d = curD;

      if (curD > state.trackLength + 20 || curD < state.distance - 2) {
        b.dead = true;
        continue;
      }

      target = bulletTarget(state, b, prevD, curD);
      if (!target) continue;

      key = target.kind.charAt(0) + target.ent.id;
      if (!b._hits) b._hits = [];
      if (b._hits.indexOf(key) < 0) b._hits.push(key);

      if (target.kind === 'enemy') {
        damageEnemy(state, target.ent, b.damage);
        pushEvent(state, { type: 'hit', x: target.ent.x, d: target.ent.d, kind: 'enemy' });
      } else if (target.kind === 'prop') {
        pushEvent(state, { type: 'hit', x: target.ent.x, d: target.ent.d, kind: 'prop' });
        damageProp(state, target.ent, b.damage);
      } else if (target.kind === 'boss') {
        damageBoss(state, target.ent, b.damage);
      }

      if (b.aoe > 0) {
        applyAoe(state, b, target.ent.x, target.ent.d);
      }

      if (b.pierce > 0) b.pierce -= 1;
      else b.dead = true;
    }

    compact(state.bullets);
  }

  /* ======================================================================
   * 敌人 / 道具 / 掉落
   * ==================================================================== */
  function updateEnemies(state, dt) {
    var i, e, depth, dx;
    for (i = 0; i < state.enemies.length; i++) {
      e = state.enemies[i];
      if (e.dead) continue;

      e.hitFlash = Math.max(0, e.hitFlash - dt);
      e.d -= e.speed * dt;
      // 缓慢向玩家横向靠拢，制造压迫感
      dx = clamp(state.x - e.x, -1, 1);
      e.x = clamp(e.x + dx * dt * 0.03, -0.95, 0.95);

      if (!isFinite(e.d) || !isFinite(e.x)) { e.dead = true; continue; }
      if (e.d < state.distance - 8) { e.dead = true; continue; }

      depth = e.d - state.distance;
      if (depth < 1.2 && Math.abs(e.x - state.x) < 0.12) {
        hurtPlayer(state, e.damage, e.x);
        e.dead = true;
        state.kills += 1;
        state.stats.kills += 1;
        state.score += (ENEMY_STATS[e.type] || ENEMY_STATS.walker).score;
        pushEvent(state, { type: 'kill', x: e.x, d: e.d, kind: e.type });
      }
    }
    compact(state.enemies);
  }

  function updateItems(state, dt) {
    var i, p, depth;
    for (i = 0; i < state.props.length; i++) {
      p = state.props[i];
      if (p.dead) continue;
      if (!isFinite(p.d) || !isFinite(p.x) || p.d < state.distance - 10) {
        p.dead = true;
      }
    }

    for (i = 0; i < state.pickups.length; i++) {
      p = state.pickups[i];
      if (p.dead) continue;
      if (!isFinite(p.d) || !isFinite(p.x) || p.d < state.distance - 10) {
        p.dead = true;
        continue;
      }
      depth = p.d - state.distance;
      if (depth < 1 && depth > -1.5 && Math.abs(p.x - state.x) < 0.12) {
        if (p.type === 'medkit') {
          var before = state.people;
          state.people = clamp(state.people + p.value, 1, num(state.maxPeople, MAX_PEOPLE));
          state.stats.peopleGained += Math.max(0, state.people - before);
        } else {
          state.fireRate = clamp(state.fireRate + p.value, 0.6, 2.2);
        }
        p.dead = true;
        pushEvent(state, { type: 'pickup', x: p.x, kind: p.type, value: p.value });
      }
    }

    compact(state.props);
    compact(state.pickups);
  }

  /* ======================================================================
   * 敌方弹幕
   * ==================================================================== */
  function updateEnemyShots(state, dt) {
    var i, s, depth;
    for (i = 0; i < state.enemyShots.length; i++) {
      s = state.enemyShots[i];
      if (s.dead) continue;
      s.d -= s.speed * dt;
      if (!isFinite(s.d) || !isFinite(s.x) ||
          s.d < state.distance - 8 || s.d > state.distance + 120) {
        s.dead = true;
        continue;
      }
      depth = s.d - state.distance;
      if (depth < 1.5 && depth > -1 && Math.abs(s.x - state.x) < 0.11) {
        hurtPlayer(state, s.damage, s.x);
        s.dead = true;
      }
    }
    compact(state.enemyShots);
  }

  /* ======================================================================
   * Boss
   * ==================================================================== */
  // 估算玩家持续 DPS：实际武器、人群弹道数、射速、单发伤害。
  function estimatePlayerDps(state) {
    var tier = weaponAt(state.weaponLevel);
    var streams = volleyStreams(state, tier);
    var dmg = bulletDamageFor(tier, state.people);
    var rate = tier.rate * clamp(num(state.fireRate, 1), 0.6, 2.2);
    var interval = FIRE_BASE / Math.max(rate, 0.1);
    return streams * dmg / Math.max(interval, 1e-4);
  }

  // 自适应 Boss HP：在生成时一次性计算，战斗中途不改变。
  function bossHpFor(state) {
    var li = clamp(Math.floor(num(state.levelIndex, 0)), 0, 2);
    var tier = weaponAt(state.weaponLevel);
    var rawDps = estimatePlayerDps(state);
    var hp = rawDps * BOSS_TARGET_SECONDS[li] * BOSS_HP_FACTOR;
    var minHp = BOSS_MIN_HP[li];

    // 火箭筒 / 坦克炮射流很少，若仍用绝对下限会导致 30-40 秒 Boss 战。
    // 对这类武器改用相对 DPS 的软下限，让战斗回到 ~12-20 秒。
    if ((tier.maxStreams || 16) <= 3) {
      var dynamicMin = Math.round(rawDps * BOSS_TARGET_SECONDS[li] * 0.35);
      minHp = Math.min(minHp, Math.max(HEAVY_BOSS_MIN_FLOOR, dynamicMin));
    }

    return Math.round(clamp(hp, minHp, BOSS_MAX_HP[li]));
  }

  function scheduleBossAttack(state, b, kind, x, lanes, count, baseWindup) {
    var w = baseWindup * (b.phase === 1 ? 1 : (b.phase === 2 ? 0.8 : 0.65));
    b._windup = w;
    b._pending = {
      kind: kind, x: clamp(x, -0.7, 0.7),
      lanes: lanes, count: count, phase: b.phase, windup: w
    };
    pushEvent(state, {
      type: 'bossAttack', kind: kind, x: b._pending.x,
      phase: b.phase, windup: w, lanes: lanes, count: count
    });
  }

  function executeBossStrike(state, b, pending) {
    if (!pending) return;
    var i, lanes, count, speed, x;
    var phase = b.phase;
    var phaseSpeed = phase === 1 ? 1 : (phase === 2 ? 1.15 : 1.3);

    if (pending.kind === 'slam') {
      lanes = pending.lanes || [];
      count = lanes.length;
      for (i = 0; i < count; i++) {
        spawnEnemyShot(state, lanes[i], b.d - 1, 13 * phaseSpeed, 3, 0.12, 'shockwave');
      }
      if (Math.abs(pending.x - state.x) < 0.5) hurtPlayer(state, 5, pending.x);
      pushEvent(state, {
        type: 'bossStrike', kind: 'slam', x: pending.x, phase: phase,
        lanes: lanes, count: count, projectileKind: 'shockwave'
      });
    } else if (pending.kind === 'cleaver') {
      lanes = pending.lanes || [];
      count = lanes.length;
      speed = 16 * phaseSpeed;
      for (i = 0; i < count; i++) {
        spawnEnemyShot(state, lanes[i], b.d - 1, speed, 3, 0.1, 'cleaver');
      }
      pushEvent(state, {
        type: 'bossStrike', kind: 'cleaver', x: b.x, phase: phase,
        lanes: lanes, count: count, projectileKind: 'cleaver'
      });
    } else if (pending.kind === 'charge') {
      b._chargeTargetX = pending.x;
      b._chargeAnim = 0.7;
      if (Math.abs(pending.x - state.x) < 0.3) hurtPlayer(state, 6, pending.x);
      spawnEnemyShot(state, pending.x, b.d - 1, 18 * phaseSpeed, 5, 0.15, 'charge');
      pushEvent(state, {
        type: 'bossStrike', kind: 'charge', x: pending.x, phase: phase,
        lanes: [pending.x], count: 1, projectileKind: 'charge'
      });
    } else if (pending.kind === 'acid') {
      count = pending.count || 5;
      speed = 15 * (1 + 0.12 * (phase - 1));
      lanes = [];
      for (i = 0; i < count; i++) {
        x = clamp(state.x + (i - (count - 1) / 2) * 0.18, -0.95, 0.95);
        lanes.push(x);
        spawnEnemyShot(state, x, b.d - 1, speed, 2, 0.1, 'acid');
      }
      pushEvent(state, {
        type: 'bossStrike', kind: 'acid', x: b.x, phase: phase,
        lanes: lanes, count: count, projectileKind: 'acid'
      });
    } else if (pending.kind === 'rain') {
      lanes = pending.lanes || [];
      count = lanes.length;
      for (i = 0; i < count; i++) {
        spawnEnemyShot(state, lanes[i], b.d + 2 + (i % 3) * 1.5, 14, 2, 0.1, 'rain');
      }
      pushEvent(state, {
        type: 'bossStrike', kind: 'rain', x: b.x, phase: phase,
        lanes: lanes, count: count, projectileKind: 'rain'
      });
    } else if (pending.kind === 'summon') {
      count = pending.count || 2;
      lanes = pending.lanes || [];
      for (i = 0; i < count; i++) {
        spawnEnemy(state, (phase >= 3 && i === 1) ? 'runner' : 'walker',
          lanes[i], state.distance + 40 + i * 2);
      }
      pushEvent(state, {
        type: 'bossStrike', kind: 'summon', x: b.x, phase: phase,
        lanes: lanes, count: count
      });
    }
  }

  function updateBoss(state, dt) {
    var lvl = LEVELS[state.levelIndex];

    // 触发 Boss 竞技场
    if (state.phase === 'run') {
      if (state.distance >= state.trackLength - BOSS_ARENA) {
        state.distance = state.trackLength - BOSS_ARENA;
        state.speed = 0;
        state.phase = 'boss';
        state.boss = {
          id: state._nextId++,
          type: lvl.boss,
          name: lvl.bossName,
          x: 0,
          d: state.distance + 22,
          hp: bossHpFor(state),
          maxHp: bossHpFor(state),
          radius: 0.16,
          hitRadius: BOSS_HIT_RADIUS,
          hitFlash: 0,
          attackTimer: 0,
          phase: 1,
          dead: false,
          _movePhase: 0,
          _slamCount: 0,
          _chargeTimer: 0,
          _summonTimer: 0,
          _rainTimer: 0,
          _chargeCount: 0,
          _chargeTargetX: 0,
          _chargeAnim: 0,
          _windup: 0,
          _pending: null
        };
        // type 用于事件类型，bossType / boss 表示 Boss 种类（避免与事件 type 冲突）
        pushEvent(state, {
          type: 'bossSpawn', bossType: lvl.boss, boss: lvl.boss,
          name: lvl.bossName, x: 0, d: state.boss.d
        });
      }
      return;
    }

    if (state.phase !== 'boss') return;
    var b = state.boss;
    if (!b || b.dead) return;

    if (b.hp <= 0) { killBoss(state); return; }

    b.hitFlash = Math.max(0, b.hitFlash - dt);

    // 阶段：66% / 33% 时进入二阶段 / 三阶段
    var ratio = b.maxHp > 0 ? b.hp / b.maxHp : 1;
    var wantPhase = ratio <= 0.33 ? 3 : (ratio <= 0.66 ? 2 : 1);
    if (wantPhase > b.phase) {
      b.phase = wantPhase;
      b.attackTimer = 0;
      var tel = b.type === 'brute' ? 'slam' : (b.type === 'butcher' ? 'charge' : 'acid');
      pushEvent(state, {
        type: 'bossAttack', kind: tel, x: b.x,
        phase: b.phase, enrage: true
      });
    }
    var atkMult = b.phase === 1 ? 1 : (b.phase === 2 ? 0.78 : 0.6);
    var moveMult = b.phase === 1 ? 1 : (b.phase === 2 ? 1.2 : 1.4);
    b._movePhase += dt * moveMult;

    // 独立走位，绝不跟随玩家 x。所有 Boss 都限制在 ±0.7 路面内。
    if (b.type === 'brute') {
      // 缓慢巡逻，幅度大，节奏慢
      b.x = Math.sin(b._movePhase * 0.55) * 0.6;
    } else if (b.type === 'butcher') {
      // 固定区间乒乓巡逻；冲锋时快速冲向固定目标车道
      if (b._chargeAnim > 0) {
        b._chargeAnim -= dt;
        b.x += clamp(b._chargeTargetX - b.x, -1, 1) * dt * 3.2;
      } else {
        var per = 4.6;
        var pp = (b._movePhase % per) / per;
        b.x = pp < 0.5 ? -0.65 + pp * 2.6 : 0.65 - (pp - 0.5) * 2.6;
      }
    } else {
      // 母体：双正弦“8 字”悬浮
      b.x = Math.sin(b._movePhase * 0.8) * 0.5 + Math.sin(b._movePhase * 1.7) * 0.18;
    }
    b.x = clamp(b.x, -0.7, 0.7);
    b.d = state.distance + 22 + Math.sin(state.time * 0.6) * 2;
    // 前摇中：继续移动，但不触发新攻击；前摇结束才真正出招。
    if (num(b._windup, 0) > 0) {
      b._windup -= dt;
      if (b._windup <= 0) {
        b._windup = 0;
        var pending = b._pending;
        b._pending = null;
        executeBossStrike(state, b, pending);
      }
      if (b.hp <= 0) killBoss(state);
      return;
    }

    b.attackTimer += dt;
    var i, x, count, speed, off;

    if (b.type === 'brute') {
      var slamEvery = 2.8 * atkMult;
      if (b.attackTimer >= slamEvery) {
        b.attackTimer -= slamEvery;
        b._slamCount += 1;
        var wide = (b._slamCount % 3 === 0);
        var offs = wide ? [-0.7, -0.35, 0, 0.35, 0.7] : [-0.35, 0, 0.35];
        var lanes = [];
        for (i = 0; i < offs.length; i++) lanes.push(clamp(b.x + offs[i], -0.95, 0.95));
        scheduleBossAttack(state, b, 'slam', b.x, lanes, lanes.length, 0.55);
      }
    } else if (b.type === 'butcher') {
      b._chargeTimer += dt;
      var chargeEvery = 6 * atkMult;
      if (b._chargeTimer >= chargeEvery) {
        b._chargeTimer -= chargeEvery;
        b._chargeCount += 1;
        var chargeLanes = [-0.6, 0.6, -0.3, 0.3];
        var chargeX = chargeLanes[(b._chargeCount - 1) % chargeLanes.length];
        scheduleBossAttack(state, b, 'charge', chargeX, [chargeX], 1, 0.8);
      } else {
        var cleaverEvery = 2.3 * atkMult;
        if (b.attackTimer >= cleaverEvery) {
          b.attackTimer -= cleaverEvery;
          var cl = [-0.6, -0.2, 0.2, 0.6];
          if (b.phase >= 2) cl.push(0);
          if (b.phase >= 3) { cl.push(-0.4); cl.push(0.4); }
          scheduleBossAttack(state, b, 'cleaver', b.x, cl, cl.length, 0.5);
        }
      }
    } else if (b.type === 'mother') {
      b._rainTimer += dt;
      b._summonTimer += dt;
      var rainEvery = 8 * atkMult;
      var summonEvery = 6 * atkMult;
      var fanEvery = 2.2 * atkMult;

      if (b._rainTimer >= rainEvery) {
        b._rainTimer -= rainEvery;
        count = b.phase === 1 ? 4 : 5;
        var rx = count === 4 ? [-0.7, -0.35, 0.35, 0.7] : [-0.7, -0.35, 0, 0.35, 0.7];
        scheduleBossAttack(state, b, 'rain', b.x, rx, count, 0.7);
      } else if (b._summonTimer >= summonEvery) {
        b._summonTimer -= summonEvery;
        count = b.phase === 1 ? 2 : 3;
        var sx = count === 2 ? [-0.35, 0.35] : [-0.4, 0, 0.4];
        scheduleBossAttack(state, b, 'summon', b.x, sx, count, 0.6);
      } else if (b.attackTimer >= fanEvery) {
        b.attackTimer -= fanEvery;
        count = b.phase === 1 ? 5 : (b.phase === 2 ? 6 : 7);
        scheduleBossAttack(state, b, 'acid', b.x, null, count, 0.5);
      }
    }

    if (b.hp <= 0) killBoss(state);
  }

  /* ======================================================================
   * 工具 / 清理
   * ==================================================================== */
  function compact(arr) {
    var w = 0, i;
    for (i = 0; i < arr.length; i++) {
      if (!arr[i].dead) { arr[w++] = arr[i]; }
    }
    arr.length = w;
  }

  function cleanup(state) {
    compact(state.enemies);
    compact(state.bullets);
    // 硬上限兜底：即使外部注入或未来逻辑改动也不超过 32 发。
    if (state.bullets.length > MAX_ACTIVE_BULLETS) {
      state.bullets.length = MAX_ACTIVE_BULLETS;
    }
    compact(state.enemyShots);
    compact(state.props);
    compact(state.pickups);
  }

  /* ======================================================================
   * createRun
   * ==================================================================== */
  /*
   * carry: 可选 { people, weaponLevel }，可额外带 seed 便于复现/测试。
   * 第三个参数 seed 也接受（可选），优先级高于 carry.seed。
   */
  function createRun(levelIndex, carry, seedArg) {
    var li = Math.floor(num(levelIndex, 0));
    if (li < 0) li = 0;
    if (li > LEVELS.length - 1) li = LEVELS.length - 1;
    var level = LEVELS[li];

    var people = level.startPeople;
    var weapon = level.startWeapon;
    if (carry) {
      if (typeof carry.people === 'number' && isFinite(carry.people)) {
        people = clamp(Math.round(carry.people), 1, MAX_PEOPLE);
      }
      if (typeof carry.weaponLevel === 'number' && isFinite(carry.weaponLevel)) {
        weapon = clamp(Math.round(carry.weaponLevel), 1, MAX_WEAPON);
      }
    }

    var seed;
    if (typeof seedArg === 'number' && isFinite(seedArg)) {
      seed = seedArg >>> 0;
    } else if (carry && typeof carry.seed === 'number' && isFinite(carry.seed)) {
      seed = carry.seed >>> 0;
    } else {
      seed = (Math.imul(0x9E3779B1, li + 1) + 0x85EBCA77) >>> 0;
    }

    var state = {
      seed: seed,
      levelIndex: li,
      levelName: level.name,
      theme: level.theme,
      trackLength: level.trackLength,
      difficulty: level.difficulty,
      status: 'running',
      phase: 'run',
      time: 0,
      distance: 0,
      speed: BASE_SPEED,
      x: 0,
      people: people,
      maxPeople: MAX_PEOPLE,
      weaponLevel: weapon,
      fireRate: 1,
      score: 0,
      kills: 0,
      boss: null,
      enemies: [],
      bullets: [],
      enemyShots: [],
      gates: [],
      props: [],
      pickups: [],
      events: [],
      stats: { kills: 0, gates: 0, peopleGained: 0, shots: 0, bossKills: 0 },
      _rng: mulberry32(seed),
      _prevDistance: 0,
      _fireTimer: 0,
      _schedule: [],
      _scheduleIndex: 0,
      _nextId: 1,
      _dropsSpawned: 0,
      _hurtCooldown: 0
    };

    state.gates = generateGates(state, state._rng);
    state._schedule = generateSchedule(state, state._rng);
    return state;
  }

  /* ======================================================================
   * step
   * ==================================================================== */
  function step(state, input, dt) {
    if (!state || state.status !== 'running') return;

    state.events.length = 0;
    dt = num(dt, 0);
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;

    var steer = input && typeof input.steer === 'number' && isFinite(input.steer)
      ? clamp(input.steer, -1, 1) : 0;

    state.time += dt;
    state._hurtCooldown = Math.max(0, num(state._hurtCooldown, 0) - dt);

    // 1) 玩家横向
    state.x = clamp(num(state.x, 0) + steer * LATERAL_SPEED * dt, -1, 1);

    // 2) 前进 + 激活前方实体
    var prevDistance = num(state.distance, 0);
    state._prevDistance = prevDistance;
    if (state.phase === 'run') {
      state.speed = BASE_SPEED;
      state.distance = prevDistance + BASE_SPEED * dt;
      var bossD = state.trackLength - BOSS_ARENA;
      if (state.distance > bossD) state.distance = bossD;
      activateSchedule(state);
    } else {
      state.distance = prevDistance;
    }

    // 3) 子弹与命中
    updateBullets(state, dt);

    if (state.status === 'running') {
      // 4) 敌人移动 / 接触
      updateEnemies(state, dt);

      // 5) 道具 / 掉落
      updateItems(state, dt);

      // 6) 门
      processGates(state, prevDistance);

      // 7) 自动射击
      updateAutoFire(state, dt);

      // 8) 敌方弹幕
      updateEnemyShots(state, dt);

      // 9) Boss 触发 / AI
      updateBoss(state, dt);
    }

    // 10) 清理
    cleanup(state);

    // 11) 死亡判定（胜利在 killBoss 内已判定）
    if (state.status === 'running' && state.people <= 0) {
      state.people = 0;
      state.status = 'dead';
      pushEvent(state, { type: 'dead' });
    }
  }

  /* ======================================================================
   * 导出
   * ==================================================================== */
  var RoadEngine = {
    LEVELS: LEVELS,
    WEAPON_TIERS: WEAPON_TIERS,
    createRun: createRun,
    step: step,
    _internals: {
      mulberry32: mulberry32,
      clamp: clamp,
      num: num,
      bulletDamageFor: bulletDamageFor,
      volleyStreams: volleyStreams,
      fireVolley: fireVolley,
      rollDrop: rollDrop,
      applyGateEffect: applyGateEffect,
      processGates: processGates,
      generateGates: generateGates,
      generateSchedule: generateSchedule,
      makeGatePair: makeGatePair,
      spawnEnemy: spawnEnemy,
      spawnPickup: spawnPickup,
      spawnEnemyShot: spawnEnemyShot,
      damageEnemy: damageEnemy,
      damageBoss: damageBoss,
      damageProp: damageProp,
      explodeBarrel: explodeBarrel,
      hurtPlayer: hurtPlayer,
      killBoss: killBoss,
      activateSchedule: activateSchedule,
      hasTargetAhead: hasTargetAhead,
      ENEMY_STATS: ENEMY_STATS,
      BOSS_ARENA: BOSS_ARENA,
      BOSS_MIN_HP: BOSS_MIN_HP,
      BOSS_MAX_HP: BOSS_MAX_HP,
      BOSS_TARGET_SECONDS: BOSS_TARGET_SECONDS,
      BOSS_HP_FACTOR: BOSS_HP_FACTOR,
      HEAVY_BOSS_MIN_FLOOR: HEAVY_BOSS_MIN_FLOOR,
      estimatePlayerDps: estimatePlayerDps,
      bossHpFor: bossHpFor,
      MAX_ACTIVE_BULLETS: MAX_ACTIVE_BULLETS,
      MAX_DROPS_PER_RUN: MAX_DROPS_PER_RUN,
      CRATE_SCHEDULE: CRATE_SCHEDULE,
      BOSS_HIT_RADIUS: BOSS_HIT_RADIUS
    }
  };

  if (typeof window !== 'undefined') { window.RoadEngine = RoadEngine; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = RoadEngine; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
