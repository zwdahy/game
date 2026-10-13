/* ============================================================
   转刀生存 — 渲染层 (window.Render)
   职责：相机、烘焙背景、分批发光、视锥剔除、粒子/飘字池、刀刃拖尾、屏幕特效。
   只读消费 engine 的 state，不修改任何引擎状态。
   传统脚本，必须在 sprites.js 之后加载。
   ============================================================ */
(function () {
  'use strict';

  var Sprites = window.Sprites;

  var Render = {};
  window.Render = Render;

  // -------- 常量 --------
  var P_CAP = 300;        // 粒子上限
  var T_CAP = 30;         // 飘字上限
  var TRAIL_MAX = 12;     // 每把刀拖尾采样点
  var FONT = '"DIN Alternate","Bahnschrift","Oswald",ui-monospace,Menlo,Consolas,monospace';
  var TAU = Math.PI * 2;

  // -------- 配色 --------
  var C = {
    player:     '#35f0e0',
    playerCore: '#eafffb',
    blade:      '#5ffcf0',
    bladeCore:  '#ffffff',
    enemyBlade: '#ff2d55',
    enemyCore:  '#ffb4c2',
    normal:     '#cfd6e4',
    normalRim:  'rgba(232,240,250,0.45)',
    elite:      '#ffcc4d',
    eliteRim:   '#fff2c2',
    eliteGlow:  '#ffb020',
    boss:       '#ff3ea5',
    bossRim:    '#ffc2e6',
    bossGlow:   '#b026ff',
    orb:        '#46e6c0',
    heart:      '#ff4d6d',
    flash:      '#ff2d50'
  };

  function mobColor(t) {
    return t === 'elite' ? C.elite : (t === 'boss' ? C.boss : C.normal);
  }

  // -------- 状态 --------
  var canvas = null, g = null;
  var vw = 800, vh = 600, dpr = 1;
  var world = { w: 1800, h: 1400 };
  var bgCanvas = null, bgWorldW = 0, bgWorldH = 0;

  var camX = 0, camY = 0;          // 相机左上角（世界坐标）
  var camTX = 0, camTY = 0;        // 目标
  var time = 0;

  var flashA = 0;
  var shakeA = 0;

  // -------- 粒子池 --------
  var particles = new Array(P_CAP);
  for (var pi = 0; pi < P_CAP; pi++) {
    particles[pi] = { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 6, color: '#fff', alpha: 1, drag: 0.9 };
  }
  var pHead = 0;
  var pGlow = Object.create(null); // color -> baked glow sprite

  // -------- 飘字池 --------
  var texts = new Array(T_CAP);
  for (var ti = 0; ti < T_CAP; ti++) {
    texts[ti] = { active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1, text: '', color: '#fff', size: 16 };
  }
  var tHead = 0;

  // -------- 刀刃拖尾 --------
  var trails = [];

  // =============================================================
  // 初始化 / 尺寸
  // =============================================================
  Render.init = function (cv) {
    canvas = cv;
    g = canvas.getContext('2d', { alpha: false });
    Render.resize();
    ensureBackground();
  };

  Render.resize = function () {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    vw = Math.max(1, Math.round(rect.width || window.innerWidth));
    vh = Math.max(1, Math.round(rect.height || window.innerHeight));
    dpr = Math.min(window.devicePixelRatio || 1, 2); // DPR 上限 2
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    if (Sprites && Sprites.configure) Sprites.configure(dpr);
    g = canvas.getContext('2d', { alpha: false });
    g.imageSmoothingEnabled = true;
  };

  Render.dpr = function () { return dpr; };
  Render.viewport = { w: 800, h: 600 };

  Render.setWorld = function (w) {
    if (!w) return;
    world.w = w.w || world.w;
    world.h = w.h || world.h;
    ensureBackground();
  };

  // =============================================================
  // 静态背景烘焙（网格 + 竞技场边界），每帧只做一次子区域 drawImage
  // =============================================================
  function ensureBackground() {
    if (bgCanvas && bgWorldW === world.w && bgWorldH === world.h) return;
    bgWorldW = world.w; bgWorldH = world.h;
    var w = world.w, h = world.h;
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var bg = c.getContext('2d');

    var base = bg.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#0b1526');
    base.addColorStop(0.5, '#080e1a');
    base.addColorStop(1, '#05080f');
    bg.fillStyle = base;
    bg.fillRect(0, 0, w, h);

    var rg = bg.createRadialGradient(w / 2, h / 2, 60, w / 2, h / 2, Math.max(w, h) * 0.62);
    rg.addColorStop(0, 'rgba(38,120,140,0.16)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    bg.fillStyle = rg;
    bg.fillRect(0, 0, w, h);

    bg.lineWidth = 1;
    for (var x = 0; x <= w; x += 50) {
      bg.strokeStyle = (x % 100 === 0) ? 'rgba(110,160,215,0.13)' : 'rgba(80,120,170,0.06)';
      bg.beginPath(); bg.moveTo(x + 0.5, 0); bg.lineTo(x + 0.5, h); bg.stroke();
    }
    for (var y = 0; y <= h; y += 50) {
      bg.strokeStyle = (y % 100 === 0) ? 'rgba(110,160,215,0.13)' : 'rgba(80,120,170,0.06)';
      bg.beginPath(); bg.moveTo(0, y + 0.5); bg.lineTo(w, y + 0.5); bg.stroke();
    }

    var m = 26, rr = 44;
    function roundRect(ctx, x, y, ww, hh, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + ww, y, x + ww, y + hh, r);
      ctx.arcTo(x + ww, y + hh, x, y + hh, r);
      ctx.arcTo(x, y + hh, x, y, r);
      ctx.arcTo(x, y, x + ww, y, r);
      ctx.closePath();
    }
    roundRect(bg, m, m, w - m * 2, h - m * 2, rr);
    bg.lineWidth = 7; bg.strokeStyle = 'rgba(53,240,224,0.09)'; bg.stroke();
    bg.lineWidth = 2; bg.strokeStyle = 'rgba(53,240,224,0.36)'; bg.stroke();

    // 四角强调（青 + 品红）
    var L = 60;
    bg.lineWidth = 4;
    var corners = [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]];
    for (var i = 0; i < corners.length; i++) {
      var cx0 = corners[i][0], cy0 = corners[i][1], sx = corners[i][2], sy = corners[i][3];
      bg.strokeStyle = i % 2 === 0 ? 'rgba(53,240,224,0.85)' : 'rgba(255,62,165,0.8)';
      bg.beginPath();
      bg.moveTo(cx0 + sx * L, cy0);
      bg.lineTo(cx0, cy0);
      bg.lineTo(cx0, cy0 + sy * L);
      bg.stroke();
    }

    bgCanvas = c;
  }

  // =============================================================
  // 相机
  // =============================================================
  function updateCamera(st) {
    var px = 0, py = 0;
    if (st && st.player) { px = st.player.x; py = st.player.y; }
    else { px = world.w / 2; py = world.h / 2; }

    var tx = px - vw / 2;
    var ty = py - vh / 2;
    if (world.w <= vw) tx = (world.w - vw) / 2;
    else tx = Math.max(0, Math.min(world.w - vw, tx));
    if (world.h <= vh) ty = (world.h - vh) / 2;
    else ty = Math.max(0, Math.min(world.h - vh, ty));

    camTX = tx; camTY = ty;
    // 轻微平滑跟随（约 1/60 步长的固定系数，主循环本身已是固定步长）
    var k = 0.18;
    camX += (tx - camX) * k;
    camY += (ty - camY) * k;
    if (Math.abs(camX - tx) < 0.04) camX = tx;
    if (Math.abs(camY - ty) < 0.04) camY = ty;
  }

  function visible(x, y, pad) {
    return x + pad > camX && x - pad < camX + vw &&
           y + pad > camY && y - pad < camY + vh;
  }

  // =============================================================
  // 池操作
  // =============================================================
  function glowSprite(color) {
    var s = pGlow[color];
    if (!s) { s = Sprites.glow(color, 16); pGlow[color] = s; }
    return s;
  }

  function spawnParticle(x, y, vx, vy, life, size, color, alpha, drag) {
    var p = particles[pHead];
    pHead = (pHead + 1) % P_CAP;         // 覆盖最旧
    p.active = true;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life;
    p.size = size; p.color = color;
    p.alpha = alpha == null ? 1 : alpha;
    p.drag = drag == null ? 0.9 : drag;
  }

  function burst(x, y, color, count, speed, size, life) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * TAU;
      var sp = speed * (0.35 + Math.random() * 0.85);
      spawnParticle(
        x, y, Math.cos(a) * sp, Math.sin(a) * sp,
        life * (0.6 + Math.random() * 0.7),
        size * (0.6 + Math.random() * 0.8),
        color, 0.9, 0.88
      );
    }
  }

  function spawnText(x, y, text, color, size) {
    var t = texts[tHead];
    tHead = (tHead + 1) % T_CAP;         // 覆盖最旧
    t.active = true;
    t.x = x; t.y = y;
    t.vy = -34;
    t.life = 0.9; t.maxLife = 0.9;
    t.text = text; t.color = color;
    t.size = size || 17;
  }

  // =============================================================
  // 事件 -> 粒子 / 飘字
  // =============================================================
  Render.emitEvents = function (events, st) {
    if (!events || !events.length) return;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var col = mobColor(e.monsterType);
      switch (e.type) {
        case 'hit':
          spawnText(e.x, e.y, '-' + Math.max(1, Math.round(e.amount || 0)), '#ffe9a8', 16);
          burst(e.x, e.y, col, 4, 90, 4, 0.28);
          break;
        case 'kill':
          var big = e.monsterType === 'boss';
          var mid = e.monsterType === 'elite';
          burst(e.x, e.y, col, big ? 42 : (mid ? 20 : 10), big ? 260 : 180, big ? 9 : 6, big ? 0.7 : 0.45);
          if (big || mid) {
            spawnText(e.x, e.y - 18, big ? '击杀' : '+', col, big ? 22 : 18);
          }
          if (big) Render.shake(9);
          break;
        case 'playerHurt':
          Render.flash(0.55);
          Render.shake(6);
          burst(e.x, e.y, '#ff5570', 12, 150, 5, 0.4);
          if (e.amount) spawnText(e.x, e.y - 22, '-' + Math.max(1, Math.round(e.amount)), '#ff8098', 18);
          break;
        case 'bladeBreak':
          burst(e.x, e.y, '#ff2d55', 10, 160, 5, 0.4);
          burst(e.x, e.y, C.blade, 6, 120, 4, 0.32);
          break;
        case 'bladeCancel':
          burst(e.x, e.y, C.blade, 8, 130, 4, 0.3);
          break;
        case 'heal':
          burst(e.x, e.y, '#5ef08a', 12, 120, 5, 0.5);
          spawnText(e.x, e.y - 20, '+' + Math.max(1, Math.round(e.amount || 0)), '#8dffb0', 18);
          break;
        case 'levelup':
          burst(e.x, e.y, '#ffd76a', 26, 200, 6, 0.7);
          spawnText(e.x, e.y - 26, '升级', '#ffe08a', 22);
          break;
        default:
          break;
      }
    }
  };

  Render.flash = function (a) { flashA = Math.min(0.85, flashA + a); };
  Render.shake = function (a) { shakeA = Math.min(16, shakeA + a); };

  Render.reset = function () {
    for (var i = 0; i < P_CAP; i++) particles[i].active = false;
    for (var j = 0; j < T_CAP; j++) texts[j].active = false;
    trails.length = 0;
    flashA = 0; shakeA = 0;
    time = 0;
    camX = camY = camTX = camTY = 0;
  };

  // =============================================================
  // 每帧更新
  // =============================================================
  function updateParticles(dt) {
    for (var i = 0; i < P_CAP; i++) {
      var p = particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      var d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function updateTexts(dt) {
    for (var i = 0; i < T_CAP; i++) {
      var t = texts[i];
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; continue; }
      t.vy *= Math.pow(0.9, dt * 60);
      t.y += t.vy * dt;
    }
  }

  // =============================================================
  // 主绘制
  // =============================================================
  Render.draw = function (st, dt) {
    if (!g) return;
    if (dt == null) dt = 1 / 60;
    time += dt;

    updateCamera(st);
    updateParticles(dt);
    updateTexts(dt);
    if (flashA > 0) flashA = Math.max(0, flashA - dt * 2.4);
    if (shakeA > 0) shakeA = Math.max(0, shakeA - dt * 34);

    var shx = shakeA > 0 ? (Math.random() * 2 - 1) * shakeA : 0;
    var shy = shakeA > 0 ? (Math.random() * 2 - 1) * shakeA : 0;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#060a12';
    g.fillRect(0, 0, vw, vh);

    var cx = camX + shx, cy = camY + shy;

    drawBackground(cx, cy);

    g.save();
    g.translate(-cx, -cy);

    if (st) drawWorld(st);
    drawParticles();
    drawTexts();

    g.restore();

    drawScreenFX();
    drawJoystick();
  };

  function drawBackground(cx, cy) {
    var sx = Math.max(0, Math.min(world.w, cx));
    var sy = Math.max(0, Math.min(world.h, cy));
    var sw = Math.min(vw, world.w - sx);
    var sh = Math.min(vh, world.h - sy);
    if (sw <= 0 || sh <= 0) return;
    g.drawImage(bgCanvas, sx, sy, sw, sh, sx - cx, sy - cy, sw, sh);
  }

  // -------- 世界绘制 --------
  function drawWorld(st) {
    var player = st.player;
    var monsters = st.monsters || [];
    var orbs = st.orbs || [];
    var heals = st.heals || [];
    var terrain = st.terrain || {};

    // 1) 地形
    var rocks = terrain.rocks || [];
    for (var ri = 0; ri < rocks.length; ri++) {
      var rk = rocks[ri];
      if (!visible(rk.x, rk.y, rk.radius + 8)) continue;
      var variant = (Math.abs((rk.x * 13 + rk.y * 7) | 0)) % 4;
      Sprites.draw(g, Sprites.rock(rk.radius, variant), rk.x, rk.y);
    }
    var trees = terrain.trees || [];
    for (var tj = 0; tj < trees.length; tj++) {
      var tr = trees[tj];
      var pad = (tr.crownRadius || tr.radius) + 16;
      if (!visible(tr.x, tr.y, pad)) continue;
      var crownR = tr.crownRadius || (tr.radius * 2.2);
      Sprites.draw(g, Sprites.tree(crownR, crownR * 0.9), tr.x, tr.y);
    }

    // 2) 实体（正常混合）
    drawBodies(st);

    // 3) 发光批（lighter）
    g.globalCompositeOperation = 'lighter';
    drawGlowBatch(st, monsters, orbs, heals);
    drawPlayerBlades(player);
    drawEnemyBlades(monsters);
    g.globalCompositeOperation = 'source-over';

    // 4) 玩家核心
    drawPlayerCore(player);
  }

  // 身体层：怪物本体 + 受击闪白 + 掉落心形
  function drawBodies(st) {
    var monsters = st.monsters || [];
    for (var i = 0; i < monsters.length; i++) {
      var m = monsters[i];
      if (!visible(m.x, m.y, m.radius + 20)) continue;
      var type = m.type || 'normal';
      var col = type === 'elite' ? C.elite : (type === 'boss' ? C.boss : C.normal);
      var rim = type === 'elite' ? C.eliteRim : (type === 'boss' ? C.bossRim : C.normalRim);
      Sprites.draw(g, Sprites.disc(col, m.radius, rim), m.x, m.y);
      if (m.hurtFlash > 0) {
        g.globalAlpha = Math.min(0.85, m.hurtFlash);
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(m.x, m.y, m.radius, 0, TAU); g.fill();
        g.globalAlpha = 1;
      }
      // 精英/Boss 的状态点，弱化说明其血量
      if (type !== 'normal' && m.maxHp) {
        var frac = Math.max(0, Math.min(1, m.hp / m.maxHp));
        if (frac < 1) {
          var bw = m.radius * 2.4, bh = 3;
          g.fillStyle = 'rgba(0,0,0,0.5)';
          g.fillRect(m.x - bw / 2, m.y - m.radius - 10, bw, bh);
          g.fillStyle = type === 'boss' ? C.boss : C.elite;
          g.fillRect(m.x - bw / 2, m.y - m.radius - 10, bw * frac, bh);
        }
      }
    }

    var heals = st.heals || [];
    for (var h = 0; h < heals.length; h++) {
      var hh = heals[h];
      if (!visible(hh.x, hh.y, 20)) continue;
      Sprites.draw(g, Sprites.heart(C.heart, hh.radius * 4.2), hh.x, hh.y);
    }
  }

  // 发光层：全部用 lighter 分批
  function drawGlowBatch(st, monsters, orbs, heals) {
    var player = st.player;

    // 玩家光晕
    if (player && visible(player.x, player.y, 60)) {
      Sprites.draw(g, Sprites.glow(C.player, 30), player.x, player.y, 1, 0.55);
    }

    // 怪物光晕
    for (var i = 0; i < monsters.length; i++) {
      var m = monsters[i];
      var type = m.type || 'normal';
      if (type === 'normal') continue; // 普通怪几乎无光
      if (!visible(m.x, m.y, m.radius + 80)) continue;
      var qr = Math.round(m.radius / 2) * 2;
      if (type === 'elite') {
        Sprites.draw(g, Sprites.glow(C.eliteGlow, Math.max(12, qr * 3)), m.x, m.y, 1, 0.5);
        Sprites.draw(g, Sprites.ring(C.elite, qr * 1.7, Math.max(1.5, qr * 0.16)), m.x, m.y, 1, 0.9);
      } else {
        // Boss 脉动帧序列
        var frames = Sprites.bossFrames(C.bossGlow, Math.max(14, qr), 24);
        var fi = Math.floor((time * 18) % frames.length);
        Sprites.draw(g, frames[fi], m.x, m.y, 1, 0.95);
        Sprites.draw(g, Sprites.glow(C.boss, Math.max(16, qr * 3.4)), m.x, m.y, 1, 0.55);
      }
    }

    // 经验球
    for (var o = 0; o < orbs.length; o++) {
      var ob = orbs[o];
      if (!visible(ob.x, ob.y, 24)) continue;
      var pulse = 1 + 0.18 * Math.sin(time * 4 + ob.x * 0.1);
      Sprites.draw(g, Sprites.orb(C.orb, Math.max(4, ob.radius)), ob.x, ob.y, pulse, 0.95);
    }

    // 红心微光
    for (var he = 0; he < heals.length; he++) {
      var hl = heals[he];
      if (!visible(hl.x, hl.y, 30)) continue;
      Sprites.draw(g, Sprites.glow(C.heart, Math.max(10, hl.radius * 3)), hl.x, hl.y, 1, 0.45);
    }
  }

  // 玩家刀：拖尾 + 刀身
  // 引擎把刀心放在 orbitRadius + bladeLength*0.5 处，刀身以刀心为中心、尖端朝外。
  function drawPlayerBlades(player) {
    if (!player || !player.blades) return;
    var blades = player.blades;
    var L = Math.round(player.bladeLength || 30);
    var W = Math.max(5, L * 0.34);
    var d = (player.orbitRadius || 42) + L * 0.5;   // 刀心到玩家距离
    var half = L * 0.5;
    var spr = Sprites.blade(C.blade, L, W, C.bladeCore);
    var ghost = Sprites.blade(C.blade, L, W, C.bladeCore);

    for (var i = 0; i < blades.length; i++) {
      var b = blades[i];
      var tr = ensureTrail(i);
      var ang = b.angle || 0;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var cx = player.x + ca * d;
      var cy = player.y + sa * d;

      if (b.active) {
        var baseX = cx - ca * half;
        var baseY = cy - sa * half;
        var tipx = cx + ca * half;
        var tipy = cy + sa * half;
        pushTrail(tr, tipx, tipy);
        drawTrail(tr, C.blade);
        if (visible(cx, cy, L + 20)) {
          Sprites.draw(g, spr, baseX, baseY, 1, 1, ang);
          Sprites.draw(g, Sprites.glow(C.player, 14), tipx, tipy, 1, 0.7);
        }
      } else {
        // 抵消：拖尾快速消散；恢复中画低透明残影
        decayTrail(tr);
        if (tr.count > 1) drawTrail(tr, C.blade);
        if (b.recoverProgress > 0 || b._inProgress) {
          var a = Math.max(0, Math.min(1, b.recoverProgress || 0));
          var gx = cx - ca * half;
          var gy = cy - sa * half;
          // 残影随恢复进度增强透明度
          Sprites.draw(g, ghost, gx, gy, 0.72 + 0.28 * a, 0.10 + 0.42 * a, ang);
        }
      }
    }
    // 多余的拖尾（刀数减少）消散
    for (var k = blades.length; k < trails.length; k++) {
      var extra = trails[k];
      if (extra) { decayTrail(extra); if (extra.count > 1) drawTrail(extra, C.blade); }
    }
  }

  function drawEnemyBlades(monsters) {
    var mcfg = (window.Engine && window.Engine.CONFIG && window.Engine.CONFIG.monsters) || null;
    for (var i = 0; i < monsters.length; i++) {
      var m = monsters[i];
      if (!m.blades || !m.blades.length) continue;
      if (!visible(m.x, m.y, m.radius + 90)) continue;
      var base = mcfg && mcfg[m.type];
      var bl = base ? base.bladeLength : m.radius * 1.2;
      var od = base ? base.orbitRadius : m.radius * 1.4;
      var W = Math.max(4, bl * 0.34);
      var d = od + bl * 0.5;
      var half = bl * 0.5;
      var spr = Sprites.blade(C.enemyBlade, bl, W, C.enemyCore);
      for (var j = 0; j < m.blades.length; j++) {
        var b = m.blades[j];
        if (!b.active) continue;
        var ang = b.angle || 0;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var bx = m.x + ca * d - ca * half;
        var by = m.y + sa * d - sa * half;
        Sprites.draw(g, spr, bx, by, 1, 0.95, ang);
        Sprites.draw(g, Sprites.glow(C.enemyBlade, 12), bx + ca * half, by + sa * half, 1, 0.6);
      }
    }
  }

  function drawPlayerCore(player) {
    if (!player) return;
    if (!visible(player.x, player.y, 60)) return;
    var blink = 1;
    if (player.invulnTimer > 0) blink = 0.45 + 0.55 * Math.abs(Math.sin(time * 18));
    var pcfg = (window.Engine && window.Engine.CONFIG && window.Engine.CONFIG.player) || null;
    var radius = (pcfg && pcfg.radius) || 14;
    var core = Sprites.disc(C.player, radius, 'rgba(234,255,251,0.7)');
    g.globalAlpha = blink;
    Sprites.draw(g, core, player.x, player.y);
    if (player.hurtFlash > 0) {
      g.globalAlpha = Math.min(0.9, player.hurtFlash) * blink;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(player.x, player.y, radius, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    // 细光环
    g.globalCompositeOperation = 'lighter';
    Sprites.draw(g, Sprites.ring(C.playerCore, radius + 4, 1.4), player.x, player.y, 1, 0.5 * blink);
    g.globalCompositeOperation = 'source-over';
  }

  // -------- 拖尾环缓 --------
  function ensureTrail(i) {
    var tr = trails[i];
    if (!tr) {
      tr = { buf: new Float32Array(TRAIL_MAX * 2), head: 0, count: 0, lastX: 0, lastY: 0 };
      trails[i] = tr;
    }
    return tr;
  }

  function pushTrail(tr, x, y) {
    if (tr.count > 0) {
      var dx = x - tr.lastX, dy = y - tr.lastY;
      if (dx * dx + dy * dy < 0.35) return; // 静止时避免堆积
    }
    tr.head = (tr.head + 1) % TRAIL_MAX;
    tr.buf[tr.head * 2] = x;
    tr.buf[tr.head * 2 + 1] = y;
    if (tr.count < TRAIL_MAX) tr.count++;
    tr.lastX = x; tr.lastY = y;
  }

  function decayTrail(tr) {
    if (tr.count > 0) tr.count--;
  }

  function drawTrail(tr, color) {
    if (!tr || tr.count < 2) return;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (var k = 0; k < tr.count - 1; k++) {
      var i1 = (tr.head - k + TRAIL_MAX * 2) % TRAIL_MAX;
      var i2 = (tr.head - k - 1 + TRAIL_MAX * 2) % TRAIL_MAX;
      var a = 1 - k / tr.count;
      g.strokeStyle = Sprites.rgba(color, 0.42 * a * a);
      g.lineWidth = Math.max(1, 6 * a);
      g.beginPath();
      g.moveTo(tr.buf[i2 * 2], tr.buf[i2 * 2 + 1]);
      g.lineTo(tr.buf[i1 * 2], tr.buf[i1 * 2 + 1]);
      g.stroke();
    }
  }

  // -------- 粒子 --------
  function drawParticles() {
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < P_CAP; i++) {
      var p = particles[i];
      if (!p.active) continue;
      var k = p.life / p.maxLife;
      if (k <= 0) continue;
      var s = p.size * (0.5 + 0.7 * k) * 2.2;
      g.globalAlpha = Math.min(1, p.alpha * k);
      var spr = glowSprite(p.color);
      g.drawImage(spr.cv, p.x - s / 2, p.y - s / 2, s, s);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // -------- 飘字 --------
  function drawTexts() {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (var i = 0; i < T_CAP; i++) {
      var t = texts[i];
      if (!t.active) continue;
      var k = t.life / t.maxLife;
      var a = k > 0.6 ? 1 : k / 0.6;
      a = Math.max(0, Math.min(1, a));
      g.globalAlpha = a;
      g.font = '900 ' + t.size + 'px ' + FONT;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(2,5,10,0.7)';
      g.strokeText(t.text, t.x, t.y);
      g.fillStyle = t.color;
      g.fillText(t.text, t.x, t.y);
    }
    g.globalAlpha = 1;
  }

  // -------- 屏幕特效 --------
  function drawScreenFX() {
    if (flashA > 0.001) {
      g.fillStyle = Sprites.rgba(C.flash, flashA * 0.5);
      g.fillRect(0, 0, vw, vh);
    }
  }

  // -------- 虚拟摇杆 --------
  function drawJoystick() {
    var js = window.Input && window.Input.joystick;
    if (!js || !js.active) return;
    var maxR = (window.Input && window.Input.maxRadius) || 56;
    var dx = js.x - js.ox, dy = js.y - js.oy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }

    g.globalCompositeOperation = 'lighter';
    // 底座
    Sprites.draw(g, Sprites.ring(C.player, maxR, 2), js.ox, js.oy, 1, 0.35);
    // 方向光晕
    Sprites.draw(g, Sprites.glow(C.player, 20), js.ox + dx, js.oy + dy, 0.7, 0.8);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.beginPath();
    g.arc(js.ox + dx, js.oy + dy, 18, 0, TAU);
    g.fillStyle = 'rgba(90,250,235,0.85)';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(234,255,251,0.8)';
    g.stroke();
  }

})();
