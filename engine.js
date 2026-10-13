/*
 * 《转刀生存》纯逻辑引擎 (Spin Blade Survival)
 * ---------------------------------------------------------------------------
 * 传统脚本 (无 ES module)。浏览器端 window.Engine, Node 端 module.exports。
 * 纯逻辑：不使用 document / canvas / Date / Math.random / performance。
 * 时间推进只依赖外部传入的 dt，随机数使用注入种子的 mulberry32。
 * 坐标系：左上 (0,0)，x 向右，y 向下；世界 1800x1400；角度弧度，0 指向 +x，顺时针为正。
 */
(function (root) {
  'use strict';

  /* ======================================================================
   * RNG (mulberry32) —— 确定性、可注入种子
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

  /* ======================================================================
   * CONFIG
   * ==================================================================== */
  var CONFIG = {
    world: { w: 1800, h: 1400 },
    spawnPoint: { x: 900, y: 700 },
    player: {
      startHp: 5, maxHpCap: 10, speed: 165, pickupRadius: 78, attack: 14,
      orbitRadius: 42, bladeLength: 54, rotationSpeed: 3.6, bladeCount: 2, bladeCountCap: 50,
      recoverySlots: 1, recoverySlotsCap: 6, recoveryTime: 2.5,
      hitCooldown: 0.22, radius: 14, invuln: 1.6
    },
    orb: { radius: 6, speed: 260 },
    heal: { radius: 10 },
    monsters: {
      normal: { hp: 14, speed: 34, radius: 11, contactDamage: 1, xp: 3, blades: 0, orbitRadius: 0, bladeLength: 0, rotationSpeed: 0, bladeDamage: 0, healthDropChance: 0, bladeRespawn: 4 },
      elite: { hp: 84, speed: 62, radius: 17, contactDamage: 1, xp: 12, blades: 1, orbitRadius: 30, bladeLength: 22, rotationSpeed: 1.6, bladeDamage: 1, healthDropChance: 0.12, bladeRespawn: 4 },
      boss: { hp: 560, speed: 48, radius: 32, contactDamage: 2, xp: 60, blades: 3, orbitRadius: 52, bladeLength: 34, rotationSpeed: 1.9, bladeDamage: 1, healthDropChance: 0.6, bladeRespawn: 4 }
    },
    spawn: {
      baseInterval: 2.0, minInterval: 0.18, intervalDecayPerSec: 0.008, tierSeconds: 30,
      hpMultPerTier: 0.18, speedMultPerTier: 0.06,
      eliteChanceBase: 0.03, eliteChancePerTier: 0.012, eliteChanceCap: 0.2,
      maxAliveMonsters: 450, spawnRingMin: 760, spawnRingMax: 960, bossInterval: 75
    },
    orbLimit: 400,
    level: { baseXp: 5, xpGrowth: 4 },
    bossScore: 400, eliteScore: 60, normalScore: 10,
    terrain: { rocks: 12, trees: 14, minGap: 32, spawnClear: 130, rockRMin: 20, rockRMax: 34, treeRadius: 20, crownMin: 30, crownMax: 36 }
  };

  /* ======================================================================
   * CARDS —— 升级卡定义 (id 固定)
   * ==================================================================== */
  var CARDS = [
    { id: 'speed',         title: '疾风', desc: '移动速度 +12%',           icon: 'SPD' },
    { id: 'bladeCount',    title: '增刃', desc: '刀刃数量 +1 (上限 50)',    icon: 'CNT' },
    { id: 'bladeLength',   title: '长刃', desc: '刀刃长度 +15%',           icon: 'LEN' },
    { id: 'attack',        title: '利刃', desc: '攻击力 +18%',             icon: 'ATK' },
    { id: 'rotationSpeed', title: '疾旋', desc: '旋转速度 +12%',           icon: 'ROT' },
    { id: 'maxHp',         title: '强体', desc: '血量上限 +1 并回复 1 点',  icon: 'HP'  },
    { id: 'pickupRadius',  title: '磁力', desc: '拾取范围 +20%',           icon: 'MAG' },
    { id: 'heal',          title: '回春', desc: '立即回复 1 点血量',       icon: 'HEAL' },
    { id: 'recoverySlots', title: '韧性', desc: '断刀并行恢复数 +1',       icon: 'SLOT' }
  ];
  var CARD_BY_ID = {};
  (function () { for (var i = 0; i < CARDS.length; i++) CARD_BY_ID[CARDS[i].id] = CARDS[i]; })();
  var CARD_WEIGHT = { heal: 0.7 };

  /* ======================================================================
   * 纯函数工具 (供 _internals 暴露 / 内部复用)
   * ==================================================================== */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  function circleOverlap(ax, ay, ar, bx, by, br) {
    var dx = ax - bx, dy = ay - by, rr = ar + br;
    return dx * dx + dy * dy < rr * rr;
  }

  // 把圆 (x,y,r) 从静态圆 (sx,sy,sr) 推出，返回新坐标（纯函数，不修改入参）
  function resolveCircleOut(x, y, r, sx, sy, sr) {
    var dx = x - sx, dy = y - sy, minD = r + sr, d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) return { x: x, y: y };
    if (d2 === 0) return { x: sx + minD, y: sy };
    var d = Math.sqrt(d2), push = (minD - d) / d;
    return { x: x + dx * push, y: y + dy * push };
  }

  // 原地把实体 e 从静态圆 (sx,sy,sr) 推出（热路径，避免临时对象）
  function pushOut(e, sx, sy, sr, er) {
    var dx = e.x - sx, dy = e.y - sy, minD = er + sr, d2 = dx * dx + dy * dy;
    if (d2 >= minD * minD) return false;
    if (d2 === 0) { e.x = sx + minD; e.y = sy; return true; }
    var d = Math.sqrt(d2), push = (minD - d) / d;
    e.x += dx * push; e.y += dy * push;
    return true;
  }

  // 移动方向归一化并裁剪长度 <= 1（斜向不加速）
  function normalizeInput(input) {
    var ix = (input && typeof input.x === 'number' && isFinite(input.x)) ? input.x : 0;
    var iy = (input && typeof input.y === 'number' && isFinite(input.y)) ? input.y : 0;
    var len2 = ix * ix + iy * iy;
    if (len2 > 1) { var inv = 1 / Math.sqrt(len2); ix *= inv; iy *= inv; }
    return { x: ix, y: iy };
  }

  function tierAt(time) { return Math.floor(time / CONFIG.spawn.tierSeconds); }
  function spawnInterval(time) {
    var s = CONFIG.spawn, v = s.baseInterval - s.intervalDecayPerSec * time;
    return v < s.minInterval ? s.minInterval : v;
  }
  function monsterHpMult(tier) { return 1 + CONFIG.spawn.hpMultPerTier * tier; }
  function monsterSpeedMult(tier) { return 1 + CONFIG.spawn.speedMultPerTier * tier; }
  function eliteChance(tier) {
    var s = CONFIG.spawn, v = s.eliteChanceBase + s.eliteChancePerTier * tier;
    return v > s.eliteChanceCap ? s.eliteChanceCap : v;
  }
  function xpToNext(level) { return CONFIG.level.baseXp + (level - 1) * CONFIG.level.xpGrowth; }

  // 刀刃碰撞圆：以 origin 为中心、距 orbitRadius + bladeLength*0.5 为圆心、半径 bladeLength*0.5 + 8
  function bladeCollider(ox, oy, angle, orbitRadius, bladeLength) {
    var radius = bladeLength * 0.5 + 8;
    var d = orbitRadius + bladeLength * 0.5;
    return { x: ox + Math.cos(angle) * d, y: oy + Math.sin(angle) * d, r: radius };
  }

  function weightedPick(rng, items, weightFn) {
    var total = 0, i, w;
    for (i = 0; i < items.length; i++) { w = weightFn ? weightFn(items[i]) : 1; total += w; }
    var r = rng() * total;
    for (i = 0; i < items.length; i++) { r -= (weightFn ? weightFn(items[i]) : 1); if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }

  /* ======================================================================
   * 均匀空间网格 (cell≈64) —— 复用数组，避免每帧大量临时对象
   * ==================================================================== */
  function makeGrid(w, h, cell) {
    var cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
    var cells = new Array(cols * rows);
    for (var i = 0; i < cells.length; i++) cells[i] = [];
    return { cell: cell, cols: cols, rows: rows, cells: cells };
  }
  function gridClear(grid) {
    var c = grid.cells;
    for (var i = 0; i < c.length; i++) c[i].length = 0;
  }

  // 静态地形网格（只构建一次）
  function buildTerrainGrid(terrain) {
    var grid = makeGrid(CONFIG.world.w, CONFIG.world.h, 64);
    var circles = terrain.rocks.concat(terrain.trees);
    grid.circles = circles;
    grid._stamp = new Int32Array(circles.length);
    grid._stampId = 0;
    var cell = grid.cell;
    for (var i = 0; i < circles.length; i++) {
      var c = circles[i];
      var x0 = Math.max(0, Math.floor((c.x - c.radius) / cell));
      var x1 = Math.min(grid.cols - 1, Math.floor((c.x + c.radius) / cell));
      var y0 = Math.max(0, Math.floor((c.y - c.radius) / cell));
      var y1 = Math.min(grid.rows - 1, Math.floor((c.y + c.radius) / cell));
      for (var gy = y0; gy <= y1; gy++)
        for (var gx = x0; gx <= x1; gx++) grid.cells[gy * grid.cols + gx].push(i);
    }
    return grid;
  }

  // 查询 (x,y,r) 附近的地形圆，结果写入 state._queryOut（复用，去重）
  function terrainQuery(state, x, y, r) {
    var grid = state._terrainGrid;
    var out = state._queryOut; out.length = 0;
    var cell = grid.cell;
    var x0 = Math.max(0, Math.floor((x - r) / cell)), x1 = Math.min(grid.cols - 1, Math.floor((x + r) / cell));
    var y0 = Math.max(0, Math.floor((y - r) / cell)), y1 = Math.min(grid.rows - 1, Math.floor((y + r) / cell));
    var id = ++grid._stampId;
    var circles = grid.circles, stamp = grid._stamp;
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        var arr = grid.cells[gy * grid.cols + gx];
        for (var k = 0; k < arr.length; k++) {
          var idx = arr[k];
          if (stamp[idx] === id) continue;
          stamp[idx] = id;
          out.push(circles[idx]);
        }
      }
    }
    return out;
  }

  function overlapsTerrain(state, x, y, r) {
    var cand = terrainQuery(state, x, y, r);
    for (var i = 0; i < cand.length; i++) {
      if (circleOverlap(x, y, r, cand[i].x, cand[i].y, cand[i].radius)) return true;
    }
    return false;
  }

  function rebuildMonsterGrid(state) {
    var grid = state._grid;
    gridClear(grid);
    var ms = state.monsters, cell = grid.cell, cols = grid.cols, rows = grid.rows;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var gx = clamp(Math.floor(m.x / cell), 0, cols - 1);
      var gy = clamp(Math.floor(m.y / cell), 0, rows - 1);
      grid.cells[gy * cols + gx].push(m);
    }
  }

  // 查询 (x,y,r) 附近的怪，结果写入 state._monsterQuery（复用）
  function gridQuery(state, x, y, r) {
    var grid = state._grid;
    var out = state._monsterQuery; out.length = 0;
    var cell = grid.cell;
    var x0 = Math.max(0, Math.floor((x - r) / cell)), x1 = Math.min(grid.cols - 1, Math.floor((x + r) / cell));
    var y0 = Math.max(0, Math.floor((y - r) / cell)), y1 = Math.min(grid.rows - 1, Math.floor((y + r) / cell));
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        var arr = grid.cells[gy * grid.cols + gx];
        for (var k = 0; k < arr.length; k++) out.push(arr[k]);
      }
    }
    return out;
  }

  /* ======================================================================
   * 地形生成
   * ==================================================================== */
  function generateTerrain(rng) {
    var W = CONFIG.world.w, H = CONFIG.world.h, tc = CONFIG.terrain;
    var sp = CONFIG.spawnPoint;
    var rocks = [], trees = [];

    function farEnough(x, y, r, list) {
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        var minD = o.radius + r + tc.minGap;
        if (dist2(x, y, o.x, o.y) < minD * minD) return false;
      }
      return true;
    }
    function nearSpawn(x, y, r) {
      var minD = tc.spawnClear + r;
      return dist2(x, y, sp.x, sp.y) < minD * minD;
    }
    function place(count, rMin, rMax, crown, target) {
      var tries = 0, maxTries = count * 300;
      while (target.length < count && tries < maxTries) {
        tries++;
        var r = rMin + rng() * (rMax - rMin);
        var x = r + 8 + rng() * (W - 2 * r - 16);
        var y = r + 8 + rng() * (H - 2 * r - 16);
        if (nearSpawn(x, y, r)) continue;
        if (!farEnough(x, y, r, target)) continue;
        if (!farEnough(x, y, r, rocks)) continue;
        if (!farEnough(x, y, r, trees)) continue;
        var obj = { x: x, y: y, radius: r };
        if (crown) obj.crownRadius = crown.min + rng() * (crown.max - crown.min);
        target.push(obj);
      }
    }

    place(tc.rocks, tc.rockRMin, tc.rockRMax, null, rocks);
    place(tc.trees, tc.treeRadius, tc.treeRadius, { min: tc.crownMin, max: tc.crownMax }, trees);
    return { rocks: rocks, trees: trees };
  }

  /* ======================================================================
   * 刀刃同步 / 恢复
   * ==================================================================== */
  function newBlade() {
    return { active: true, recoverProgress: 0, angle: 0, _inProgress: false, _breakSeq: 0 };
  }
  function syncBlades(p) {
    while (p.blades.length < p.bladeCount) p.blades.push(newBlade());
    while (p.blades.length > p.bladeCount) p.blades.pop();
  }

  /* ======================================================================
   * createGame
   * ==================================================================== */
  function createGame(seed) {
    if (seed === undefined || seed === null) seed = 0x5EED; // 固定常量，不使用 Date
    seed = seed >>> 0;
    var rng = mulberry32(seed);
    var p = CONFIG.player, sp = CONFIG.spawnPoint;

    var state = {
      seed: seed,
      time: 0,
      status: 'running',
      difficultyTier: 0,
      world: { w: CONFIG.world.w, h: CONFIG.world.h },
      player: {
        x: sp.x, y: sp.y,
        hp: p.startHp, maxHp: p.startHp,
        speed: p.speed, pickupRadius: p.pickupRadius, attack: p.attack,
        orbitRadius: p.orbitRadius, bladeLength: p.bladeLength,
        rotationSpeed: p.rotationSpeed, bladeCount: p.bladeCount,
        recoverySlots: p.recoverySlots,
        level: 1, xp: 0, xpToNext: xpToNext(1),
        angle: 0, invulnTimer: 0, hurtFlash: 0,
        blades: []
      },
      monsters: [],
      orbs: [],
      heals: [],
      terrain: generateTerrain(rng),
      stats: { kills: 0, score: 0, killScore: 0 },
      pendingLevelUps: 0,
      events: [],
      // ---- 内部字段 (UI 不应依赖) ----
      _rng: rng,
      _nextId: 1,
      _spawnTimer: 0,
      _bossTimer: 0,
      _breakSeq: 0,
      _recoveryQueue: [],
      _queryOut: [],
      _monsterQuery: [],
      _grid: makeGrid(CONFIG.world.w, CONFIG.world.h, 64),
      _terrainGrid: null
    };

    syncBlades(state.player);
    state._terrainGrid = buildTerrainGrid(state.terrain);
    return state;
  }

  function pushEvent(state, ev) { state.events.push(ev); }

  /* ======================================================================
   * 玩家移动 / 受伤
   * ==================================================================== */
  function updatePlayer(state, input, dt) {
    var p = state.player;
    var dir = normalizeInput(input);
    p.x += dir.x * p.speed * dt;
    p.y += dir.y * p.speed * dt;
    resolveTerrainEntity(state, p, CONFIG.player.radius);
    p.x = clamp(p.x, CONFIG.player.radius, CONFIG.world.w - CONFIG.player.radius);
    p.y = clamp(p.y, CONFIG.player.radius, CONFIG.world.h - CONFIG.player.radius);
    p.angle += p.rotationSpeed * dt;
    if (p.invulnTimer > 0) p.invulnTimer -= dt;
    if (p.hurtFlash > 0) p.hurtFlash -= dt;
  }

  function resolveTerrainEntity(state, e, radius) {
    for (var pass = 0; pass < 2; pass++) {
      var cand = terrainQuery(state, e.x, e.y, radius + 40);
      var moved = false;
      for (var i = 0; i < cand.length; i++) {
        if (pushOut(e, cand[i].x, cand[i].y, cand[i].radius, radius)) moved = true;
      }
      if (!moved) break;
    }
  }

  function hurtPlayer(state, amount, x, y) {
    var p = state.player;
    if (p.invulnTimer > 0) return false;
    p.hp -= amount;
    p.invulnTimer = CONFIG.player.invuln;
    p.hurtFlash = 0.2;
    pushEvent(state, { type: 'playerHurt', x: x, y: y, amount: amount });
    return true;
  }

  /* ======================================================================
   * 怪物生成 / AI
   * ==================================================================== */
  function spawnMonster(state, forceBoss) {
    var s = CONFIG.spawn, mcfg = CONFIG.monsters, tier = state.difficultyTier, p = state.player;
    var type;
    if (forceBoss) type = 'boss';
    else if (state._rng() < eliteChance(tier)) type = 'elite';
    else type = 'normal';

    var base = mcfg[type];
    var W = CONFIG.world.w, H = CONFIG.world.h;
    var x = p.x, y = p.y, ok = false;
    for (var attempt = 0; attempt < 12; attempt++) {
      var ang = state._rng() * Math.PI * 2;
      var dist = s.spawnRingMin + state._rng() * (s.spawnRingMax - s.spawnRingMin);
      x = p.x + Math.cos(ang) * dist;
      y = p.y + Math.sin(ang) * dist;
      if (x < base.radius + 8 || x > W - base.radius - 8 || y < base.radius + 8 || y > H - base.radius - 8) continue;
      if (!overlapsTerrain(state, x, y, base.radius + 6)) { ok = true; break; }
    }
    if (!ok) {
      x = clamp(x, base.radius + 8, W - base.radius - 8);
      y = clamp(y, base.radius + 8, H - base.radius - 8);
    }

    var hp = Math.round(base.hp * monsterHpMult(tier));
    var m = {
      id: state._nextId++,
      type: type,
      x: x, y: y,
      hp: hp, maxHp: hp,
      radius: base.radius,
      speed: base.speed * monsterSpeedMult(tier),
      hurtFlash: 0,
      angle: state._rng() * Math.PI * 2,
      blades: []
    };
    for (var b = 0; b < base.blades; b++) m.blades.push({ active: true, angle: 0, _respawn: 0 });
    state.monsters.push(m);
  }

  function updateMonsters(state, dt) {
    var ms = state.monsters, p = state.player, mcfg = CONFIG.monsters;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.hurtFlash > 0) m.hurtFlash -= dt;
      if (m._hitCd) {
        for (var k in m._hitCd) {
          m._hitCd[k] -= dt;
          if (m._hitCd[k] <= 0) delete m._hitCd[k];
        }
      }
      var dx = p.x - m.x, dy = p.y - m.y;
      var d2 = dx * dx + dy * dy;
      if (d2 > 1e-9) {
        var d = Math.sqrt(d2);
        var step = m.speed * dt;
        m.x += dx / d * step;
        m.y += dy / d * step;
      }
      var rot = mcfg[m.type].rotationSpeed;
      if (rot) m.angle += rot * dt;
      resolveTerrainEntity(state, m, m.radius);
      m.x = clamp(m.x, m.radius, CONFIG.world.w - m.radius);
      m.y = clamp(m.y, m.radius, CONFIG.world.h - m.radius);
    }
  }

  // 空间网格轻度分离，避免堆叠（每对只处理一次）
  function separateMonsters(state) {
    var ms = state.monsters;
    for (var i = 0; i < ms.length; i++) {
      var a = ms[i];
      var cand = gridQuery(state, a.x, a.y, a.radius + 40);
      for (var j = 0; j < cand.length; j++) {
        var b = cand[j];
        if (b === a || a.id > b.id) continue;
        var dx = b.x - a.x, dy = b.y - a.y;
        var minD = a.radius + b.radius, d2 = dx * dx + dy * dy;
        if (d2 >= minD * minD || d2 === 0) continue;
        var d = Math.sqrt(d2);
        var push = (minD - d) * 0.5;
        var nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  function monsterPlayerContact(state) {
    var p = state.player, ms = state.monsters, mcfg = CONFIG.monsters;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var dx = m.x - p.x, dy = m.y - p.y;
      var minD = CONFIG.player.radius + m.radius, d2 = dx * dx + dy * dy;
      if (d2 < minD * minD) {
        hurtPlayer(state, mcfg[m.type].contactDamage, m.x, m.y);
        var d = Math.sqrt(d2);
        if (d > 1e-6) { var push = (minD - d) / d; m.x += dx * push; m.y += dy * push; }
        else { m.x = p.x + minD; }
      }
    }
  }

  /* ======================================================================
   * 玩家刀 -> 怪
   * ==================================================================== */
  function updatePlayerBlades(state) {
    var p = state.player, pb = p.blades, count = pb.length;
    var pr = p.bladeLength * 0.5 + 8;
    var d = p.orbitRadius + p.bladeLength * 0.5;
    var stepAngle = (Math.PI * 2) / count;
    for (var i = 0; i < count; i++) {
      var b = pb[i];
      var ang = p.angle + i * stepAngle;
      b.angle = ang;
      if (!b.active) continue;
      var bx = p.x + Math.cos(ang) * d;
      var by = p.y + Math.sin(ang) * d;
      var cand = gridQuery(state, bx, by, pr + 40);
      for (var k = 0; k < cand.length; k++) {
        var m = cand[k];
        if (m.hp <= 0) continue;
        if (m._hitCd && m._hitCd[i] > 0) continue;
        var ddx = m.x - bx, ddy = m.y - by, minD = pr + m.radius;
        if (ddx * ddx + ddy * ddy >= minD * minD) continue;
        m.hp -= p.attack;
        m.hurtFlash = 0.12;
        if (!m._hitCd) m._hitCd = {};
        m._hitCd[i] = CONFIG.player.hitCooldown;
        pushEvent(state, { type: 'hit', x: m.x, y: m.y, amount: p.attack, monsterType: m.type });
        if (m.hp <= 0) killMonster(state, m);
      }
    }
  }

  function killMonster(state, m) {
    state.stats.kills++;
    state.stats.killScore += m.type === 'boss' ? CONFIG.bossScore : (m.type === 'elite' ? CONFIG.eliteScore : CONFIG.normalScore);
    pushEvent(state, { type: 'kill', x: m.x, y: m.y, monsterType: m.type });
    var mcfg = CONFIG.monsters[m.type];
    if (state.orbs.length < CONFIG.orbLimit) {
      state.orbs.push({ id: state._nextId++, x: m.x, y: m.y, value: mcfg.xp, radius: CONFIG.orb.radius });
    }
    if (state._rng() < mcfg.healthDropChance) {
      state.heals.push({ id: state._nextId++, x: m.x, y: m.y, radius: CONFIG.heal.radius });
    }
    m.hp = -1; // 标记死亡
  }

  // swap-remove，避免数组中部 splice
  function swapRemove(arr, i) {
    arr[i] = arr[arr.length - 1];
    arr.pop();
  }

  function removeDeadMonsters(state) {
    var ms = state.monsters;
    for (var i = ms.length - 1; i >= 0; i--) {
      if (ms[i].hp <= 0) swapRemove(ms, i);
    }
  }

  /* ======================================================================
   * 敌刀 -> 玩家
   * ==================================================================== */
  function updateMonsterBlades(state, dt) {
    var ms = state.monsters, p = state.player, mcfg = CONFIG.monsters;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      var cnt = m.blades.length;
      if (!cnt) continue;
      var base = mcfg[m.type];
      var stepAngle = (Math.PI * 2) / cnt;
      var d = base.orbitRadius + base.bladeLength * 0.5;
      var rr = base.bladeLength * 0.5 + 8;
      for (var j = 0; j < cnt; j++) {
        var b = m.blades[j];
        if (!b.active) {
          if (b._respawn > 0) { b._respawn -= dt; if (b._respawn <= 0) b.active = true; }
          continue;
        }
        var ang = m.angle + j * stepAngle;
        b.angle = ang;
        var cx = m.x + Math.cos(ang) * d;
        var cy = m.y + Math.sin(ang) * d;
        var ddx = p.x - cx, ddy = p.y - cy, minD = rr + CONFIG.player.radius;
        if (ddx * ddx + ddy * ddy < minD * minD) {
          hurtPlayer(state, base.bladeDamage, p.x, p.y);
        }
      }
    }
  }

  /* ======================================================================
   * 刀 vs 刀 抵消
   * ==================================================================== */
  function resolveBladeBlade(state) {
    var p = state.player, pb = p.blades, count = pb.length, mcfg = CONFIG.monsters;
    var pr = p.bladeLength * 0.5 + 8;
    var pd = p.orbitRadius + p.bladeLength * 0.5;
    var pStep = (Math.PI * 2) / count;
    for (var i = 0; i < count; i++) {
      var b = pb[i];
      if (!b.active) continue;
      var ang = p.angle + i * pStep;
      b.angle = ang;
      var bx = p.x + Math.cos(ang) * pd;
      var by = p.y + Math.sin(ang) * pd;
      var ms = state.monsters, cancelled = false;
      for (var mi = 0; mi < ms.length && !cancelled; mi++) {
        var m = ms[mi];
        var cnt = m.blades.length;
        if (!cnt) continue;
        var base = mcfg[m.type];
        var stepAngle = (Math.PI * 2) / cnt;
        var ed = base.orbitRadius + base.bladeLength * 0.5;
        var er = base.bladeLength * 0.5 + 8;
        for (var j = 0; j < cnt; j++) {
          var eb = m.blades[j];
          if (!eb.active) continue;
          var eang = m.angle + j * stepAngle;
          var ex = m.x + Math.cos(eang) * ed;
          var ey = m.y + Math.sin(eang) * ed;
          var ddx = ex - bx, ddy = ey - by, minD = pr + er;
          if (ddx * ddx + ddy * ddy < minD * minD) {
            // 玩家刀断掉，进入恢复队列
            b.active = false;
            b.recoverProgress = 0;
            b._inProgress = false;
            b._breakSeq = state._breakSeq++;
            state._recoveryQueue.push(i);
            pushEvent(state, { type: 'bladeBreak', x: bx, y: by });
            // 敌刀失效并计时重生
            eb.active = false;
            eb._respawn = base.bladeRespawn;
            pushEvent(state, { type: 'bladeCancel', x: ex, y: ey });
            cancelled = true;
            break;
          }
        }
      }
    }
  }

  /* ======================================================================
   * 断刀恢复（并行队列）
   * ==================================================================== */
  function updateRecovery(state, dt) {
    var p = state.player, blades = p.blades, slots = p.recoverySlots;
    var inProgress = 0, i, b;
    for (i = 0; i < blades.length; i++) {
      if (!blades[i].active && blades[i]._inProgress) inProgress++;
    }
    var queue = state._recoveryQueue;
    while (inProgress < slots && queue.length > 0) {
      var idx = queue.shift();
      var cand = blades[idx];
      if (!cand || cand.active) continue;
      cand._inProgress = true;
      inProgress++;
    }
    for (i = 0; i < blades.length; i++) {
      b = blades[i];
      if (!b.active && b._inProgress) {
        b.recoverProgress += dt / CONFIG.player.recoveryTime;
        if (b.recoverProgress >= 1) {
          b.recoverProgress = 1;
          b.active = true;
          b._inProgress = false;
        }
      }
    }
  }

  /* ======================================================================
   * 经验球 / 红心 / 升级
   * ==================================================================== */
  function updatePickups(state, dt) {
    var p = state.player, pr = p.pickupRadius, pr2 = pr * pr;
    var stepMax = CONFIG.orb.speed * dt;

    var orbs = state.orbs;
    for (var i = orbs.length - 1; i >= 0; i--) {
      var o = orbs[i];
      var dx = p.x - o.x, dy = p.y - o.y, d2 = dx * dx + dy * dy;
      if (d2 > pr2) continue;
      var reach = CONFIG.player.radius + o.radius;
      if (d2 <= reach * reach) {
        p.xp += o.value;
        swapRemove(orbs, i);
        continue;
      }
      var d = Math.sqrt(d2) || 1;
      var step = stepMax < d ? stepMax : d;
      o.x += dx / d * step; o.y += dy / d * step;
    }

    var heals = state.heals;
    for (var h = heals.length - 1; h >= 0; h--) {
      var it = heals[h];
      var hx = p.x - it.x, hy = p.y - it.y, hd2 = hx * hx + hy * hy;
      if (hd2 > pr2) continue;
      var hreach = CONFIG.player.radius + it.radius;
      if (hd2 <= hreach * hreach) {
        if (p.hp < p.maxHp) p.hp++;
        pushEvent(state, { type: 'heal', x: p.x, y: p.y });
        swapRemove(heals, h);
        continue;
      }
      var hd = Math.sqrt(hd2) || 1;
      var hstep = stepMax < hd ? stepMax : hd;
      it.x += hx / hd * hstep; it.y += hy / hd * hstep;
    }

    levelCheck(state);
  }

  function levelCheck(state) {
    var p = state.player;
    while (p.xp >= p.xpToNext) {
      p.xp -= p.xpToNext;
      p.level += 1;
      p.xpToNext = xpToNext(p.level);
      state.pendingLevelUps += 1;
      pushEvent(state, { type: 'levelup', x: p.x, y: p.y, amount: p.level });
    }
  }

  /* ======================================================================
   * 刷怪
   * ==================================================================== */
  function updateSpawning(state, dt) {
    var s = CONFIG.spawn;
    state._spawnTimer += dt;
    var interval = spawnInterval(state.time);
    var guard = 0;
    while (state._spawnTimer >= interval && guard < 1000) {
      guard++;
      state._spawnTimer -= interval;
      if (state.monsters.length < s.maxAliveMonsters) spawnMonster(state, false);
    }
    state._bossTimer += dt;
    while (state._bossTimer >= s.bossInterval) {
      state._bossTimer -= s.bossInterval;
      if (state.monsters.length < s.maxAliveMonsters) spawnMonster(state, true);
    }
  }

  function updateScore(state) {
    state.stats.score = state.stats.killScore;
  }

  /* ======================================================================
   * step —— 推进一帧
   * ==================================================================== */
  function step(state, input, dt) {
    if (!state || state.status !== 'running') return;
    state.events.length = 0;
    if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) dt = 0;

    state.time += dt;
    state.difficultyTier = tierAt(state.time);

    updatePlayer(state, input, dt);
    updateMonsters(state, dt);

    rebuildMonsterGrid(state);
    separateMonsters(state);
    monsterPlayerContact(state);

    updatePlayerBlades(state);
    removeDeadMonsters(state);
    updateMonsterBlades(state, dt);
    resolveBladeBlade(state);
    updateRecovery(state, dt);

    updatePickups(state, dt);
    updateSpawning(state, dt);
    updateScore(state);

    if (state.player.hp <= 0) state.status = 'dead';
  }

  /* ======================================================================
   * 升级选卡
   * ==================================================================== */
  function isCardAvailable(state, id) {
    var p = state.player;
    switch (id) {
      case 'bladeCount': return p.bladeCount < CONFIG.player.bladeCountCap;
      case 'maxHp': return p.maxHp < CONFIG.player.maxHpCap;
      case 'heal': return p.hp < p.maxHp;
      case 'recoverySlots': return p.recoverySlots < CONFIG.player.recoverySlotsCap;
      default: return !!CARD_BY_ID[id];
    }
  }

  function cardWeight(item) { return CARD_WEIGHT[item.id] || 1; }

  function rollCards(state) {
    var pool = [], i;
    for (i = 0; i < CARDS.length; i++) {
      if (isCardAvailable(state, CARDS[i].id)) pool.push(CARDS[i]);
    }
    var picked = [];
    var n = pool.length < 3 ? pool.length : 3;
    for (i = 0; i < n; i++) {
      var chosen = weightedPick(state._rng, pool, cardWeight);
      picked.push(chosen);
      var at = pool.indexOf(chosen);
      if (at >= 0) pool.splice(at, 1);
    }
    return picked;
  }

  function applyCard(state, id) {
    var p = state.player;
    switch (id) {
      case 'speed': p.speed *= 1.12; break;
      case 'bladeCount':
        if (p.bladeCount < CONFIG.player.bladeCountCap) { p.bladeCount += 1; syncBlades(p); }
        break;
      case 'bladeLength': p.bladeLength *= 1.15; break;
      case 'attack': p.attack *= 1.18; break;
      case 'rotationSpeed': p.rotationSpeed *= 1.12; break;
      case 'maxHp':
        if (p.maxHp < CONFIG.player.maxHpCap) { p.maxHp += 1; p.hp = Math.min(p.maxHp, p.hp + 1); }
        break;
      case 'pickupRadius': p.pickupRadius *= 1.2; break;
      case 'heal': p.hp = Math.min(p.maxHp, p.hp + 1); break;
      case 'recoverySlots':
        if (p.recoverySlots < CONFIG.player.recoverySlotsCap) p.recoverySlots += 1;
        break;
      default: break;
    }
    state.pendingLevelUps -= 1;
    if (state.pendingLevelUps < 0) state.pendingLevelUps = 0;
  }

  /* ======================================================================
   * 导出
   * ==================================================================== */
  var Engine = {
    CONFIG: CONFIG,
    CARDS: CARDS,
    createGame: createGame,
    step: step,
    rollCards: rollCards,
    applyCard: applyCard,
    _internals: {
      mulberry32: mulberry32,
      clamp: clamp,
      dist2: dist2,
      circleOverlap: circleOverlap,
      resolveCircleOut: resolveCircleOut,
      pushOut: pushOut,
      normalizeInput: normalizeInput,
      tierAt: tierAt,
      spawnInterval: spawnInterval,
      monsterHpMult: monsterHpMult,
      monsterSpeedMult: monsterSpeedMult,
      eliteChance: eliteChance,
      xpToNext: xpToNext,
      bladeCollider: bladeCollider,
      weightedPick: weightedPick,
      cardById: function (id) { return CARD_BY_ID[id] || null; },
      isCardAvailable: isCardAvailable,
      cardWeight: cardWeight,
      generateTerrain: generateTerrain,
      makeGrid: makeGrid,
      buildTerrainGrid: buildTerrainGrid,
      terrainQuery: terrainQuery,
      gridQuery: gridQuery
    }
  };

  if (typeof window !== 'undefined') { window.Engine = Engine; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = Engine; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
