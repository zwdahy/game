/* ============================================================
   公路突围 / Road Rush — Canvas 2.5D 渲染层
   ------------------------------------------------------------
   · 传统 IIFE，无模块、无外部资源、无 DOM 查询（canvas 尺寸除外）。
   · 伪透视：纵深 z 越大越远，屏幕 y 越靠近地平线。
   · 精灵全部来自 window.RoadSprites（缺失时使用本地回退造型）。
   · 只读消费 engine 状态；绝不在渲染层修改引擎数据。
   ============================================================ */
(function (root) {
  'use strict';

  var RoadRender = {};
  root.RoadRender = RoadRender;

  /* ==========================================================
   * 常量 / 调色板
   * ========================================================== */
  var TAU = Math.PI * 2;

  var HORIZON_RATIO = 0.30;
  var GROUND_RATIO = 0.94;
  var ROAD_HALF_RATIO = 0.52;
  var DEPTH_K = 0.028;

  var MAX_DEPTH = 120;
  var MIN_DEPTH = -4;

  var P_CAP = 240;
  var T_CAP = 48;
  var RING_CAP = 16;
  var TEL_CAP = 8;
  var BOOM_CAP = 6;
  var SQUAD_CAP = 24;
  var SQUAD_UNIT_H = 62;

  var FONT_UI = '"DIN Alternate","Bahnschrift","Oswald","Arial Narrow","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
  var FONT_CJK = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

  var TIER_COLORS = ['#FFD166', '#FFB347', '#FF8C69', '#7EF0FF', '#FFA94D', '#C77DFF'];
  var WEAPON_NAMES = ['手枪', '双管', '机关枪', '火箭筒', '坦克炮', '等离子'];

  var PALETTES = {
    day: {
      skyTop: '#2C74C2', skyMid: '#7CBDEA', skyLow: '#FFD36E', skyEdge: '#FFE9B0',
      sun: '#FFF6D0', sunGlow: '#FFD36E',
      cloud: '#FFFFFF', cloudShade: '#B9D2E6',
      skyline: '#5E7992', skylineFar: '#93AEC4',
      groundFar: '#7B7458', ground: '#333C31',
      roadFar: '#666A70', road: '#424750', roadDark: '#32363E',
      shoulder: '#9C8461', shoulderDark: '#756147',
      edge: '#F0D98E', lane: '#F7E9BC',
      shadow: '#1C2638', fog: '#FFE1A0',
      lamp: '#FFD08A', neon: '#65E6FF', danger: '#FF5068', good: '#4DFFC4'
    },
    sunset: {
      skyTop: '#332A64', skyMid: '#6A4C93', skyLow: '#FF9E6D', skyEdge: '#FFC48C',
      sun: '#FFE0A8', sunGlow: '#FF8E60',
      cloud: '#FFC3A0', cloudShade: '#8F5F7D',
      skyline: '#2B2340', skylineFar: '#5A4568',
      groundFar: '#5C4747', ground: '#2D252D',
      roadFar: '#5D4C5B', road: '#39313E', roadDark: '#29232E',
      shoulder: '#7D5C52', shoulderDark: '#5A4038',
      edge: '#FFB27A', lane: '#FFD8A8',
      shadow: '#1E1222', fog: '#FF9E6D',
      lamp: '#FFC078', neon: '#FF6FA8', danger: '#FF5068', good: '#5CFFD0'
    },
    night: {
      skyTop: '#070D22', skyMid: '#101A3A', skyLow: '#433C82', skyEdge: '#5C4E9F',
      sun: '#EAF3FF', sunGlow: '#8FB4FF',
      cloud: '#2A3566', cloudShade: '#1A2148',
      skyline: '#0A1228', skylineFar: '#182246',
      groundFar: '#1A2038', ground: '#0B1020',
      roadFar: '#2B3550', road: '#1C2233', roadDark: '#121827',
      shoulder: '#2A2C3C', shoulderDark: '#1C1E2B',
      edge: '#5DE1FF', lane: '#BFEFFF',
      shadow: '#040612', fog: '#6E7BC8',
      lamp: '#FFB35C', neon: '#FF5FB0', danger: '#FF4D6A', good: '#4DFFC4'
    }
  };

  /* ==========================================================
   * 运行时状态
   * ========================================================== */
  var canvas = null;
  var g = null;

  var vw = 1, vh = 1, dpr = 1, cx = 0;
  var horizonY = 0, groundY = 0, roadHalf = 0, viewScale = 1;

  var time = 0;
  var ambientDist = 0;
  var scrollDist = 0;
  var currentTheme = 'day';
  var reducedMotion = false;

  var shakeA = 0;
  var flashA = 0;
  var flashColor = '#FFFFFF';
  var bossPoseTimer = 0;
  var dustTimer = 0;
  var dustSeq = 0;
  var fireKick = 0;
  var muzzleTimer = 0;
  var muzzleTier = 1;

  var skyCache = { key: '', sky: null, haze: null, ground: null, road: null };
  var vignetteCv = null;
  var vignetteKey = '';
  var grainCv = null;
  var cloudCache = Object.create(null);
  var glowCache = Object.create(null);
  var sprCache = Object.create(null);
  var warned = Object.create(null);

  /* ==========================================================
   * 小工具
   * ========================================================== */
  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }

  function hash(n) {
    n = n | 0;
    n = Math.imul(n ^ (n >>> 16), 0x45D9F3B);
    n = Math.imul(n ^ (n >>> 16), 0x45D9F3B);
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
  }

  function hexA(hex, a) {
    if (typeof hex !== 'string' || hex.charAt(0) !== '#') return hex;
    var h = hex.slice(1);
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    var n = parseInt(h, 16);
    if (!isFinite(n)) return hex;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function pal() {
    return PALETTES[currentTheme] || PALETTES.day;
  }

  function depthScale(z) {
    return 1 / (1 + z * DEPTH_K);
  }

  function screenX(x, sc) {
    return cx + x * roadHalf * sc;
  }

  function screenY(sc) {
    return horizonY + (groundY - horizonY) * sc;
  }

  function fogAlpha(z) {
    if (z > 88) return clamp((MAX_DEPTH - z) / 32, 0.12, 1);
    return 1;
  }

  function makeCanvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function warnOnce(name) {
    if (warned.any) return;
    warned.any = 1;
    warned.first = name;
    if (root.console && root.console.warn) {
      root.console.warn('[RoadRender] RoadSprites.' + name + ' 不可用，后续缺失精灵将静默使用回退绘制。');
    }
  }

  /* ==========================================================
   * 精灵适配（RoadSprites 可能晚到 / 缺失 / 抛错）
   * ========================================================== */
  function getSprite(name, a, b) {
    var key = name + '|' + (a === undefined ? '' : a) + '|' + (b === undefined ? '' : b);
    var hit = sprCache[key];
    if (hit) return hit;

    var lib = root.RoadSprites;
    if (!lib || typeof lib[name] !== 'function') {
      warnOnce(name);
      return null;
    }
    try {
      var spr = (a === undefined) ? lib[name]() : lib[name](a, b);
      if (spr) sprCache[key] = spr;
      return spr || null;
    } catch (e) {
      warnOnce(name);
      return null;
    }
  }

  function spriteH(spr) {
    if (!spr) return 0;
    if (spr.h > 0) return spr.h;
    if (spr.cv && spr.cv.height > 0) return spr.cv.height / dpr;
    return 0;
  }

  function drawSprite(spr, x, y, s, alpha, rot) {
    if (!spr) return false;
    var lib = root.RoadSprites;
    if (!lib || typeof lib.draw !== 'function') {
      warnOnce('draw');
      return false;
    }
    var prevAlpha = g.globalAlpha;
    try {
      if (alpha == null) alpha = 1;
      lib.draw(g, spr, x, y, s, alpha, rot || 0);
      g.globalAlpha = prevAlpha;
      return true;
    } catch (e) {
      g.globalAlpha = prevAlpha;
      warnOnce('draw');
      return false;
    }
  }

  // 按“目标像素高度”绘制，避免精灵原始尺寸未知导致比例失控
  function drawSpriteFit(spr, x, y, targetH, alpha, rot) {
    if (!spr || targetH <= 0.2) return false;
    var h = spriteH(spr);
    var s = h > 0 ? targetH / h : targetH / 64;
    return drawSprite(spr, x, y, s, alpha, rot);
  }

  function drawNamedFit(name, a, b, x, y, targetH, alpha, rot) {
    var spr = getSprite(name, a, b);
    if (!spr) return false;
    return drawSpriteFit(spr, x, y, targetH, alpha, rot);
  }

  /* ==========================================================
   * 粒子 / 飘字 / 冲击环 / 预警 / 爆炸精灵
   * ========================================================== */
  var particles = new Array(P_CAP);
  var pHead = 0;
  var texts = new Array(T_CAP);
  var tHead = 0;
  var rings = new Array(RING_CAP);
  var rHead = 0;
  var teles = new Array(TEL_CAP);
  var telHead = 0;
  var booms = new Array(BOOM_CAP);
  var bHead = 0;

  var ii;
  for (ii = 0; ii < P_CAP; ii++) {
    particles[ii] = {
      active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
      size: 2, color: '#fff', kind: 0, grav: 0, drag: 0, rot: 0, vr: 0
    };
  }
  for (ii = 0; ii < T_CAP; ii++) {
    texts[ii] = {
      active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1,
      text: '', color: '#fff', size: 16, weight: 800, pop: 0
    };
  }
  for (ii = 0; ii < RING_CAP; ii++) {
    rings[ii] = { active: false, x: 0, y: 0, life: 0, maxLife: 1, r0: 4, r1: 40, color: '#fff', width: 2, flat: true, alpha: 1 };
  }
  for (ii = 0; ii < TEL_CAP; ii++) {
    teles[ii] = { active: false, kind: 'slam', x: 0, z: 18, life: 0, maxLife: 1 };
  }
  for (ii = 0; ii < BOOM_CAP; ii++) {
    booms[ii] = { active: false, x: 0, y: 0, life: 0, maxLife: 0.5, size: 100 };
  }

  function spawnP(x, y, vx, vy, life, size, color, kind, grav, drag) {
    var p = particles[pHead];
    pHead = (pHead + 1) % P_CAP;
    p.active = true;
    p.x = x; p.y = y;
    p.vx = vx; p.vy = vy;
    p.life = life; p.maxLife = life;
    p.size = size; p.color = color;
    p.kind = kind || 0;
    p.grav = grav || 0;
    p.drag = drag || 0;
    p.rot = 0; p.vr = 0;
    return p;
  }

  function addText(text, x, y, color, size, life, vy, weight) {
    var t = texts[tHead];
    tHead = (tHead + 1) % T_CAP;
    t.active = true;
    t.x = x; t.y = y;
    t.vy = (vy == null ? -46 : vy);
    t.life = life; t.maxLife = life;
    t.text = String(text);
    t.color = color || '#fff';
    t.size = size || 16;
    t.weight = weight || 800;
    t.pop = 0;
    return t;
  }

  function addRing(x, y, r0, r1, color, life, width, flat) {
    var r = rings[rHead];
    rHead = (rHead + 1) % RING_CAP;
    r.active = true;
    r.x = x; r.y = y;
    r.r0 = r0; r.r1 = r1;
    r.color = color;
    r.life = life; r.maxLife = life;
    r.width = width || 3;
    r.flat = flat !== false;
    r.alpha = 1;
    return r;
  }

  function addTele(kind, x, z, life) {
    var t = teles[telHead];
    telHead = (telHead + 1) % TEL_CAP;
    t.active = true;
    t.kind = kind;
    t.x = x;
    t.z = z;
    t.life = life || 0.9;
    t.maxLife = t.life;
    return t;
  }

  function addBoom(x, y, size) {
    var b = booms[bHead];
    bHead = (bHead + 1) % BOOM_CAP;
    b.active = true;
    b.x = x; b.y = y;
    b.life = 0.5; b.maxLife = 0.5;
    b.size = size || 110;
  }

  function clearFX() {
    var k;
    for (k = 0; k < P_CAP; k++) particles[k].active = false;
    for (k = 0; k < T_CAP; k++) texts[k].active = false;
    for (k = 0; k < RING_CAP; k++) rings[k].active = false;
    for (k = 0; k < TEL_CAP; k++) teles[k].active = false;
    for (k = 0; k < BOOM_CAP; k++) booms[k].active = false;
    pHead = 0; tHead = 0; rHead = 0; telHead = 0; bHead = 0;
    shakeA = 0; flashA = 0;
    bossPoseTimer = 0; dustTimer = 0; dustSeq = 0;
    fireKick = 0; muzzleTimer = 0; muzzleTier = 1;
  }

  function updateFX(dt) {
    var k, p, t, r, b, f;
    for (k = 0; k < P_CAP; k++) {
      p = particles[k];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.grav * dt;
      if (p.drag > 0) {
        f = 1 - p.drag * dt;
        if (f < 0) f = 0;
        p.vx *= f;
        p.vy *= f;
      }
      p.rot += p.vr * dt;
    }

    for (k = 0; k < T_CAP; k++) {
      t = texts[k];
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) { t.active = false; continue; }
      t.y += t.vy * dt;
      t.vy *= 0.985;
      t.pop = Math.min(1, t.pop + dt * 8);
    }

    for (k = 0; k < RING_CAP; k++) {
      r = rings[k];
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) r.active = false;
    }

    for (k = 0; k < TEL_CAP; k++) {
      t = teles[k];
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) t.active = false;
    }

    for (k = 0; k < BOOM_CAP; k++) {
      b = booms[k];
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) b.active = false;
    }

    var decay = 1 - Math.min(1, dt * 5.5);
    shakeA *= decay;
    if (shakeA < 0.05) shakeA = 0;
    flashA -= dt * 1.9;
    if (flashA < 0) flashA = 0;
    if (bossPoseTimer > 0) bossPoseTimer = Math.max(0, bossPoseTimer - dt);
    if (muzzleTimer > 0) muzzleTimer = Math.max(0, muzzleTimer - dt);
    fireKick *= (1 - Math.min(1, dt * 14));
    if (fireKick < 0.01) fireKick = 0;
  }

  /* ==========================================================
   * 基础绘制
   * ========================================================== */
  function roundRectPath(x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function fillRound(x, y, w, h, r, color, alpha) {
    if (w <= 0 || h <= 0) return;
    g.save();
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.fillStyle = color;
    roundRectPath(x, y, w, h, r);
    g.fill();
    g.restore();
  }

  function shadowEllipse(x, y, rx, alpha) {
    if (rx < 0.6) return;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = pal().shadow;
    g.translate(x, y);
    g.scale(1, 0.32);
    g.beginPath();
    g.arc(0, 0, rx, 0, TAU);
    g.fill();
    g.restore();
  }

  function ringEllipse(x, y, rx, ry, color, alpha, width) {
    if (rx < 1) return;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = Math.max(0.6, width || 1);
    g.beginPath();
    if (g.ellipse) {
      g.ellipse(x, y, rx, ry, 0, 0, TAU);
    } else {
      g.translate(x, y);
      g.scale(1, ry / rx);
      g.arc(0, 0, rx, 0, TAU);
    }
    g.stroke();
    g.restore();
  }

  function softGlow(x, y, radius, color, alpha) {
    if (radius < 1 || alpha <= 0.01) return;
    var q = Math.max(8, Math.round(radius / 8) * 8);
    var key = color + '|' + q;
    var cv = glowCache[key];
    if (!cv) {
      cv = makeCanvas(q * 2, q * 2);
      if (cv) {
        var cg = cv.getContext('2d');
        var grd = cg.createRadialGradient(q, q, 0, q, q, q);
        grd.addColorStop(0, hexA(color, 0.9));
        grd.addColorStop(0.28, hexA(color, 0.42));
        grd.addColorStop(0.62, hexA(color, 0.12));
        grd.addColorStop(1, hexA(color, 0));
        cg.fillStyle = grd;
        cg.fillRect(0, 0, q * 2, q * 2);
        glowCache[key] = cv;
      }
    }
    if (cv) {
      g.save();
      g.globalAlpha = alpha;
      g.drawImage(cv, x - q, y - q, q * 2, q * 2);
      g.restore();
    } else {
      g.save();
      g.globalAlpha = alpha * 0.25;
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, radius * 0.6, 0, TAU);
      g.fill();
      g.restore();
    }
  }

  function setFont(size, weight, family) {
    g.font = (weight || 700) + ' ' + Math.max(1, Math.round(size)) + 'px ' + (family || FONT_UI);
  }

  function fitSize(text, maxW, start, weight, family) {
    var size = start;
    setFont(size, weight, family);
    while (size > 8 && g.measureText(text).width > maxW) {
      size -= 1;
      setFont(size, weight, family);
    }
    return size;
  }

  function drawLabel(text, x, y, size, color, align, weight, family, stroke) {
    g.save();
    setFont(size, weight || 800, family);
    g.textAlign = align || 'center';
    g.textBaseline = 'middle';
    if (stroke !== false) {
      g.lineWidth = Math.max(1.6, size * 0.16);
      g.strokeStyle = 'rgba(3,6,12,0.66)';
      g.strokeText(text, x, y);
    }
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.restore();
  }

  /* ==========================================================
   * 初始化 / 尺寸 / 重置
   * ========================================================== */
  RoadRender.init = function (cv) {
    canvas = cv || null;
    if (!canvas || !canvas.getContext) return;
    g = canvas.getContext('2d', { alpha: false });
    RoadRender.resize();
    RoadRender.reset();
  };

  RoadRender.resize = function () {
    if (!canvas) return;

    var rect = null;
    try {
      if (canvas.getBoundingClientRect) rect = canvas.getBoundingClientRect();
    } catch (e) { rect = null; }

    vw = Math.max(1, Math.round((rect && rect.width) || root.innerWidth || 480));
    vh = Math.max(1, Math.round((rect && rect.height) || root.innerHeight || 800));
    dpr = Math.min(root.devicePixelRatio || 1, 2);

    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);

    g = canvas.getContext('2d', { alpha: false }) || g;
    if (g) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = true;
    }

    reducedMotion = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

    cx = vw * 0.5;
    horizonY = vh * HORIZON_RATIO;
    groundY = vh * GROUND_RATIO;
    roadHalf = Math.min(vw * ROAD_HALF_RATIO, vh * 0.46);
    viewScale = clamp(Math.min(vw, vh * 0.92) / 470, 0.72, 1.32);

    skyCache.key = '';
    vignetteCv = null;
    vignetteKey = '';
    cloudCache = Object.create(null);
    glowCache = Object.create(null);
    sprCache = Object.create(null);

    if (root.RoadSprites && typeof root.RoadSprites.configure === 'function') {
      try {
        root.RoadSprites.configure(dpr);
      } catch (e) { /* 精灵层异常不阻塞主循环 */ }
    }
  };

  RoadRender.reset = function () {
    time = 0;
    ambientDist = 0;
    scrollDist = 0;
    currentTheme = 'day';
    clearFX();
    sortList.length = 0;
    sceneCount = 0;
    gateList.length = 0;
    skyCache.key = '';
  };

  /* ==========================================================
   * 天空 / 云 / 天际线
   * ========================================================== */
  function ensureSky() {
    var key = currentTheme + '|' + vw + 'x' + vh;
    if (skyCache.key === key) return;
    skyCache.key = key;

    var p = pal();
    var sky = g.createLinearGradient(0, 0, 0, horizonY + vh * 0.08);
    if (currentTheme === 'day') {
      sky.addColorStop(0, p.skyTop);
      sky.addColorStop(0.52, p.skyMid);
      sky.addColorStop(0.86, p.skyLow);
      sky.addColorStop(1, p.skyEdge);
    } else if (currentTheme === 'sunset') {
      sky.addColorStop(0, p.skyTop);
      sky.addColorStop(0.44, p.skyMid);
      sky.addColorStop(0.82, p.skyLow);
      sky.addColorStop(1, p.skyEdge);
    } else {
      sky.addColorStop(0, p.skyTop);
      sky.addColorStop(0.55, p.skyMid);
      sky.addColorStop(0.90, p.skyLow);
      sky.addColorStop(1, p.skyEdge);
    }
    skyCache.sky = sky;

    var haze = g.createLinearGradient(0, horizonY - vh * 0.13, 0, horizonY + vh * 0.09);
    haze.addColorStop(0, hexA(p.fog, 0));
    haze.addColorStop(0.48, hexA(p.fog, currentTheme === 'night' ? 0.13 : 0.30));
    haze.addColorStop(0.72, hexA(p.fog, currentTheme === 'night' ? 0.10 : 0.22));
    haze.addColorStop(1, hexA(p.fog, 0));
    skyCache.haze = haze;

    var ground = g.createLinearGradient(0, horizonY, 0, vh);
    ground.addColorStop(0, p.groundFar);
    ground.addColorStop(0.4, hexA(p.ground, 0.98));
    ground.addColorStop(1, p.ground);
    skyCache.ground = ground;

    var road = g.createLinearGradient(0, horizonY, 0, vh);
    road.addColorStop(0, p.roadFar);
    road.addColorStop(0.34, p.road);
    road.addColorStop(1, p.roadDark);
    skyCache.road = road;
  }

  function drawSun() {
    var p = pal();
    var sx, sy, rad;
    if (currentTheme === 'sunset') {
      sx = cx - vw * 0.21;
      sy = horizonY - vh * 0.035;
      rad = vh * 0.072;
    } else if (currentTheme === 'night') {
      sx = cx + vw * 0.26;
      sy = horizonY - vh * 0.175;
      rad = vh * 0.043;
    } else {
      sx = cx + vw * 0.27;
      sy = horizonY - vh * 0.105;
      rad = vh * 0.046;
    }

    softGlow(sx, sy, rad * 5.4, p.sunGlow, currentTheme === 'night' ? 0.34 : 0.52);

    g.save();
    g.fillStyle = p.sun;
    g.globalAlpha = 0.95;
    g.beginPath();
    g.arc(sx, sy, rad, 0, TAU);
    g.fill();

    if (currentTheme === 'night') {
      g.globalAlpha = 0.14;
      g.fillStyle = '#7D8AB8';
      g.beginPath();
      g.arc(sx - rad * 0.28, sy - rad * 0.12, rad * 0.22, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(sx + rad * 0.3, sy + rad * 0.25, rad * 0.15, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(sx + rad * 0.06, sy - rad * 0.38, rad * 0.1, 0, TAU);
      g.fill();
    } else {
      g.globalAlpha = 0.22;
      g.fillStyle = p.sunGlow;
      g.beginPath();
      g.arc(sx, sy, rad * 1.35, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawStars() {
    if (currentTheme !== 'night') return;
    g.save();
    g.fillStyle = '#DDE8FF';
    var k, sx, sy, a;
    for (k = 0; k < 76; k++) {
      sx = hash(k * 7 + 1) * vw;
      sy = hash(k * 11 + 9) * horizonY * 0.88;
      a = 0.18 + 0.62 * Math.abs(Math.sin(time * (0.5 + hash(k) * 0.8) + k));
      if (sy > horizonY * 0.74) a *= 0.45;
      g.globalAlpha = a;
      if (k % 11 === 0) g.fillRect(sx - 1, sy, 2, 2);
      else g.fillRect(sx, sy, 1.2, 1.2);
    }
    g.restore();
  }

  function getCloudSprite() {
    var key = currentTheme;
    if (cloudCache[key]) return cloudCache[key];
    var c = makeCanvas(280, 130);
    if (!c) return null;
    var cg = c.getContext('2d');
    var p = pal();

    function blob(bx, by, br, color, alpha) {
      var grd = cg.createRadialGradient(bx, by, br * 0.06, bx, by, br);
      grd.addColorStop(0, hexA(color, alpha));
      grd.addColorStop(0.55, hexA(color, alpha * 0.62));
      grd.addColorStop(1, hexA(color, 0));
      cg.fillStyle = grd;
      cg.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    blob(48, 92, 28, p.cloud, 0.55);
    blob(76, 82, 36, p.cloud, 0.72);
    blob(106, 72, 42, p.cloud, 0.82);
    blob(138, 66, 44, p.cloud, 0.86);
    blob(172, 74, 38, p.cloud, 0.78);
    blob(204, 84, 32, p.cloud, 0.66);
    blob(230, 94, 24, p.cloud, 0.45);
    blob(132, 96, 54, p.cloud, 0.72);
    blob(84, 102, 38, p.cloudShade, 0.18);
    blob(178, 102, 40, p.cloudShade, 0.16);

    var spr = { cv: c, w: 280, h: 130 };
    cloudCache[key] = spr;
    return spr;
  }

  var CLOUDS = [
    { x: 0.02, y: 0.13, s: 1.15, sp: 0.55, a: 0.72 },
    { x: 0.52, y: 0.24, s: 0.78, sp: 0.42, a: 0.55 },
    { x: 0.78, y: 0.06, s: 1.45, sp: 0.74, a: 0.46 },
    { x: 0.32, y: 0.32, s: 0.55, sp: 0.88, a: 0.34 },
    { x: 0.90, y: 0.30, s: 0.64, sp: 0.62, a: 0.30 }
  ];

  function drawClouds() {
    var spr = getCloudSprite();
    var k, c, x, y, w, h, alpha;
    for (k = 0; k < CLOUDS.length; k++) {
      c = CLOUDS[k];
      x = ((c.x * vw + time * c.sp * 5.6 + scrollDist * 0.11 * (0.4 + c.sp)) % (vw + 360)) - 180;
      y = horizonY - horizonY * c.y - 20;
      w = 280 * c.s * viewScale;
      h = 130 * c.s * viewScale;
      alpha = c.a * (currentTheme === 'night' ? 0.5 : 1);
      if (spr) {
        g.save();
        g.globalAlpha = alpha;
        g.drawImage(spr.cv, x - w * 0.5, y - h * 0.5, w, h);
        g.restore();
      } else {
        g.save();
        g.globalAlpha = alpha * 0.35;
        g.fillStyle = pal().cloud;
        g.beginPath();
        if (g.ellipse) g.ellipse(x, y, w * 0.42, h * 0.18, 0, 0, TAU);
        else g.arc(x, y, w * 0.4, 0, TAU);
        g.fill();
        g.restore();
      }
    }
  }

  function drawProcSkyline(dist, near) {
    var p = pal();
    var unit = Math.max(26, vw * (near ? 0.054 : 0.072));
    var speed = near ? 2.1 : 0.9;
    var scroll = dist * speed + time * (near ? 3.2 : 1.1);
    var off = scroll % unit;
    var base = Math.floor(scroll / unit);
    var count = Math.ceil(vw / unit) + 3;
    var fill = near ? p.skyline : p.skylineFar;
    var alpha = near ? (currentTheme === 'night' ? 0.98 : 0.9) : 0.42;
    var k, idx, r1, r2, bw, bh, bx, by, win, wx, wy, ww, wh, j;

    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = fill;

    for (k = -1; k < count; k++) {
      idx = base + k;
      r1 = hash(idx * 17 + (near ? 3 : 11));
      r2 = hash(idx * 29 + 7);
      bw = unit * (0.72 + r1 * 0.62);
      bh = (near ? 0.082 : 0.055) * vh * (0.5 + r2 * 1.55);
      bx = k * unit - off - (bw - unit) * 0.5;
      by = horizonY - bh;

      g.fillRect(bx, by, bw, bh + 3);

      if (near && r1 > 0.62) {
        g.fillRect(bx + bw * 0.2, by - bh * 0.09, bw * 0.12, bh * 0.1);
        g.fillRect(bx + bw * 0.55, by - bh * 0.16, bw * 0.08, bh * 0.17);
      }
      if (near && r2 > 0.84) {
        g.fillRect(bx + bw * 0.48, by - bh * 0.42, Math.max(1, bw * 0.025), bh * 0.42);
      }
      if (near && currentTheme === 'night') {
        win = Math.floor(r1 * 5) + 2;
        for (j = 0; j < win; j++) {
          wx = bx + bw * (0.12 + hash(idx * 41 + j) * 0.72);
          wy = by + bh * (0.16 + hash(idx * 53 + j) * 0.62);
          ww = Math.max(1, bw * 0.055);
          wh = Math.max(1, bh * 0.045);
          g.globalAlpha = 0.22 + hash(idx * 61 + j) * 0.35;
          g.fillStyle = (j % 4 === 0) ? p.neon : p.lamp;
          g.fillRect(wx, wy, ww, wh);
        }
        g.globalAlpha = alpha;
        g.fillStyle = fill;
      }
    }

    if (near) {
      g.globalAlpha = 0.16;
      g.fillStyle = p.fog;
      g.fillRect(0, horizonY - vh * 0.035, vw, vh * 0.045);
    }
    g.restore();
  }

  function drawSkylineSprite(dist) {
    var spr = getSprite('skyline', currentTheme);
    if (!spr) return false;

    var sh = spriteH(spr);
    var sw = 0;
    if (spr.w > 0) sw = spr.w;
    else if (spr.cv && spr.cv.width > 0) sw = spr.cv.width / dpr;
    if (!sh || !sw || sw < 12) return false;

    var targetH = Math.min(vh * 0.17, horizonY * 0.72);
    var sc = targetH / sh;
    var tw = sw * sc;
    if (tw < 12) return false;

    var ox = (typeof spr.ox === 'number') ? spr.ox : sw * 0.5;
    var oy = (typeof spr.oy === 'number') ? spr.oy : sh * 0.5;
    var y = horizonY + 2 - (sh - oy) * sc;
    var scroll = (dist * 3.1 + time * 4.2) % tw;
    var left = -scroll;
    var alpha = currentTheme === 'night' ? 0.96 : 0.9;
    var guard = 0;

    while (left < vw + tw && guard < 24) {
      drawSprite(spr, left + ox * sc, y, sc, alpha);
      left += tw;
      guard++;
    }
    return true;
  }

  function drawSkyline(dist) {
    drawProcSkyline(dist, false);
    if (!drawSkylineSprite(dist)) drawProcSkyline(dist, true);
  }

  function drawGroundBase() {
    ensureSky();
    g.fillStyle = skyCache.ground;
    g.fillRect(0, horizonY - 1, vw, vh - horizonY + 1);

    g.save();
    g.fillStyle = skyCache.haze;
    g.fillRect(0, horizonY - vh * 0.13, vw, vh * 0.22);
    g.restore();
  }

  /* ==========================================================
   * 道路
   * ========================================================== */
  function roadTrap(x0, x1, sBot, fill, alpha) {
    g.save();
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(cx, horizonY);
    g.lineTo(cx + x1 * roadHalf * sBot, vh);
    g.lineTo(cx + x0 * roadHalf * sBot, vh);
    g.closePath();
    g.fill();
    g.restore();
  }

  function roadBand(x0, x1, sFar, sNear, color, alpha) {
    var yF = horizonY + (groundY - horizonY) * sFar;
    var yN = horizonY + (groundY - horizonY) * sNear;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(cx + x0 * roadHalf * sFar, yF);
    g.lineTo(cx + x1 * roadHalf * sFar, yF);
    g.lineTo(cx + x1 * roadHalf * sNear, yN);
    g.lineTo(cx + x0 * roadHalf * sNear, yN);
    g.closePath();
    g.fill();
    g.restore();
  }

  function drawRoad(dist) {
    var p = pal();
    ensureSky();

    var sBot = (vh - horizonY) / (groundY - horizonY);

    roadTrap(-1.18, 1.18, sBot, p.shoulderDark, 1);
    roadTrap(-1.10, 1.10, sBot, p.shoulder, 1);
    roadTrap(-1, 1, sBot, skyCache.road, 1);

    roadBand(-0.74, -0.56, 0.04, sBot, '#FFFFFF', currentTheme === 'night' ? 0.018 : 0.032);
    roadBand(0.56, 0.74, 0.04, sBot, '#FFFFFF', currentTheme === 'night' ? 0.018 : 0.032);

    roadBand(-0.988, -0.952, 0.03, sBot, p.edge, 0.72);
    roadBand(0.952, 0.988, 0.03, sBot, p.edge, 0.72);

    var period = 8.4;
    var phase = dist % period;
    var z = 1.6 - phase;
    var laneX = [-1 / 3, 1 / 3];
    var k, j, za, zb, sA, sB, yA, yB, xa, xb, hwA, hwB, fade;

    for (; z < 108; z += period) {
      za = z;
      zb = z + 3.1;
      if (zb <= 0.4) continue;
      if (za < 0.4) za = 0.4;
      sA = depthScale(zb);
      sB = depthScale(za);
      yA = screenY(sA);
      yB = screenY(sB);
      fade = clamp(1.2 - za / 118, 0.06, 1);
      for (j = 0; j < 2; j++) {
        hwA = Math.max(0.7, 0.013 * roadHalf * sA);
        hwB = Math.max(0.9, 0.013 * roadHalf * sB);
        xa = screenX(laneX[j], sA);
        xb = screenX(laneX[j], sB);
        g.save();
        g.globalAlpha = 0.72 * fade;
        g.fillStyle = p.lane;
        g.beginPath();
        g.moveTo(xa - hwA, yA);
        g.lineTo(xa + hwA, yA);
        g.lineTo(xb + hwB, yB);
        g.lineTo(xb - hwB, yB);
        g.closePath();
        g.fill();
        g.restore();
      }
    }

    g.save();
    g.fillStyle = currentTheme === 'night' ? '#B9D7FF' : '#F4E8C8';
    g.globalAlpha = currentTheme === 'night' ? 0.09 : 0.11;
    for (k = 0; k < 54; k++) {
      var h1 = hash(k * 7 + 11);
      var h2 = hash(k * 13 + 5);
      var zz = (3 + h1 * 96 - (dist % 3.2) + 3.2) % 99;
      var ss = depthScale(zz);
      var px = screenX(h2 * 1.84 - 0.92, ss);
      var py = screenY(ss);
      var sz = Math.max(0.6, 2.3 * ss);
      g.fillRect(px, py, sz, sz * 0.55);
    }
    g.restore();

    if (currentTheme === 'night') {
      var sheen = g.createLinearGradient(cx, horizonY, cx, vh);
      sheen.addColorStop(0, hexA(p.neon, 0));
      sheen.addColorStop(0.45, hexA(p.neon, 0.035));
      sheen.addColorStop(1, hexA(p.neon, 0));
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = sheen;
      g.fillRect(cx - roadHalf * 0.52, horizonY, roadHalf * 0.34, vh - horizonY);
      sheen = g.createLinearGradient(cx, horizonY, cx, vh);
      sheen.addColorStop(0, hexA(p.lamp, 0));
      sheen.addColorStop(0.5, hexA(p.lamp, 0.03));
      sheen.addColorStop(1, hexA(p.lamp, 0));
      g.fillStyle = sheen;
      g.fillRect(cx + roadHalf * 0.18, horizonY, roadHalf * 0.3, vh - horizonY);
      g.restore();
    }

    // 地平线柔光带：用椭圆光晕盖住道路收敛点，避免任何硬边三角形
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(cx, horizonY + vh * 0.020);
    g.scale(1, 0.24);
    softGlow(0, 0, roadHalf * 0.92, p.fog, currentTheme === 'night' ? 0.16 : 0.26);
    g.translate(0, -vh * 0.018);
    softGlow(0, 0, roadHalf * 0.46, p.fog, currentTheme === 'night' ? 0.10 : 0.16);
    g.restore();

    if (currentTheme === 'night') {
      for (k = 0; k < 12; k++) {
        var dz = (k * 9 + 8 - (dist % 9) + 9) % 108;
        var dsc = depthScale(dz);
        if (dsc < 0.24) continue;
        var dy = screenY(dsc);
        var dl = screenX(-0.972, dsc);
        var dr = screenX(0.972, dsc);
        softGlow(dl, dy, 9 * dsc * viewScale, p.edge, 0.42);
        softGlow(dr, dy, 9 * dsc * viewScale, p.edge, 0.42);
      }
    }
  }

  /* ==========================================================
   * 路边景物（确定性摆放，绝不占用行车道）
   * ========================================================== */
  var scenePool = [];
  var sceneCount = 0;

  function pushScene(type, side, z, seed) {
    var it = scenePool[sceneCount];
    if (!it) {
      it = {};
      scenePool[sceneCount] = it;
    }
    sceneCount++;
    it.type = type;
    it.side = side;
    it.z = z;
    it.seed = seed;
    it.x = side * (1.16 + hash(seed * 31 + 3) * 0.52);
    if (type === 'car') it.x = side * (1.30 + hash(seed * 31 + 3) * 0.34);
    if (type === 'billboard' || type === 'banner') it.x = side * (1.34 + hash(seed * 31 + 3) * 0.44);
  }

  function buildScenery(dist) {
    sceneCount = 0;
    var SEG = 12;
    var base = Math.floor((dist - 8) / SEG);
    var k, idx, dd, z, r, side, type, r2, t2;

    for (k = 11; k >= -1; k--) {
      idx = base + k;
      dd = idx * SEG + hash(idx * 37 + 5) * 8;
      z = dd - dist;
      if (z < MIN_DEPTH || z > MAX_DEPTH) continue;

      r = hash(idx * 13 + 2);
      side = hash(idx * 19 + 7) < 0.5 ? -1 : 1;

      if (r < 0.20) type = 'lamp';
      else if (r < 0.37) type = 'fence';
      else if (r < 0.49) type = 'billboard';
      else if (r < 0.59) type = 'banner';
      else if (r < 0.73) type = 'car';
      else if (r < 0.87) type = 'sandbag';
      else type = 'cone';

      pushScene(type, side, z, idx);

      if (hash(idx * 23 + 11) < 0.38) {
        r2 = hash(idx * 43 + 17);
        t2 = r2 < 0.4 ? 'fence' : (r2 < 0.66 ? 'cone' : 'sandbag');
        pushScene(t2, -side, z + hash(idx * 5 + 1) * 2.5, idx + 91);
      }
    }
  }

  function sceneryInfo(type, seed) {
    switch (type) {
      case 'lamp': return { name: 'lamp', h: 172 };
      case 'fence': return { name: 'fence', h: 48 };
      case 'billboard': return { name: 'billboard', arg: seed % 3, h: 104 };
      case 'banner': return { name: 'banner', arg: seed % 3, h: 116 };
      case 'car': return { name: 'car', arg: seed % 3, h: 68 };
      case 'sandbag': return { name: 'sandbag', h: 36 };
      default: return { name: 'cone', h: 28 };
    }
  }

  function drawScenery(farPass) {
    var p = pal();
    var k, it, z, sc, x, y, alpha, info, targetH, spr, drew, lx, ly, neonCol, tail;

    for (k = 0; k < sceneCount; k++) {
      it = scenePool[k];
      if ((it.z > 38) !== !!farPass) continue;

      z = it.z;
      sc = depthScale(z);
      if (sc <= 0.04) continue;
      x = screenX(it.x, sc);
      y = screenY(sc);
      alpha = fogAlpha(z) * (currentTheme === 'night' ? 0.94 : 0.97);
      info = sceneryInfo(it.type, it.seed);
      targetH = info.h * sc * viewScale;
      if (targetH < 1) continue;

      shadowEllipse(x, y, targetH * 0.20, 0.26 * alpha);

      spr = getSprite(info.name, info.arg !== undefined ? info.arg : undefined);
      drew = spr ? drawSpriteFit(spr, x, y, targetH, alpha) : false;
      if (!drew) drawFallbackScenery(info.name, x, y, targetH, alpha, it.seed, it.side);

      if (info.name === 'lamp') {
        lx = x + (it.side > 0 ? -targetH * 0.20 : targetH * 0.20);
        ly = y - targetH * 0.91;
        softGlow(lx, ly, targetH * 0.24, p.lamp, currentTheme === 'night' ? 0.62 : 0.34);
        softGlow(x, y, targetH * 0.26, p.lamp, currentTheme === 'night' ? 0.13 : 0.07);
      } else if (info.name === 'billboard' || info.name === 'banner') {
        neonCol = (it.seed % 2 === 0) ? p.neon : p.danger;
        softGlow(x, y - targetH * 0.55, targetH * 0.32, neonCol, currentTheme === 'night' ? 0.28 : 0.12);
      } else if (info.name === 'car') {
        tail = currentTheme === 'night' ? 0.6 : 0.28;
        softGlow(x - targetH * 0.16, y - targetH * 0.31, targetH * 0.09, '#FF445F', tail);
        softGlow(x + targetH * 0.16, y - targetH * 0.31, targetH * 0.09, '#FF445F', tail);
      }
    }
  }

  /* ==========================================================
   * 门
   * ========================================================== */
  var gatePool = [];
  var gateList = [];
  var gateRectPool = [];

  function gateLayout(z) {
    var sc = depthScale(z);
    var gy = screenY(sc);
    var leftX = screenX(-1, sc);
    var rightX = screenX(1, sc);
    var panelH = vh * 0.185 * sc;
    return {
      sc: sc, gy: gy, leftX: leftX, rightX: rightX, midX: cx,
      panelH: panelH,
      panelTop: gy - panelH - 10 * sc * viewScale,
      panelBottom: gy - panelH * 0.10
    };
  }

  function drawGatePost(x, baseY, height, sc, alpha) {
    var pw = Math.max(2, 8 * sc * viewScale);
    var top = baseY - height;
    g.save();
    g.globalAlpha = alpha == null ? 1 : alpha;
    g.fillStyle = '#1B202B';
    g.fillRect(x - pw * 0.5, top, pw, height);
    g.fillStyle = '#4E596B';
    g.fillRect(x - pw * 0.5, top, Math.max(1, pw * 0.22), height);
    g.fillStyle = '#7E8DA2';
    g.fillRect(x - pw * 0.5, top, pw, Math.max(1.5, pw * 0.16));
    g.fillStyle = '#0E1219';
    g.fillRect(x - pw * 0.9, baseY - Math.max(2, pw * 0.35), pw * 1.8, Math.max(2, pw * 0.35));
    g.restore();
  }

  function drawGatePanel(x, y, w, h, eff, sc, alpha) {
    if (!eff || w < 4 || h < 4) return;
    alpha = alpha == null ? 1 : alpha;
    var good = !!eff.good;
    var col = good ? (currentTheme === 'night' ? '#5CFFD0' : '#29D9A6') : (currentTheme === 'night' ? '#FF6380' : '#E7415C');
    var dark = 'rgba(5,9,16,0.86)';
    var r = Math.min(w, h) * 0.10;

    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = dark;
    roundRectPath(x, y, w, h, r);
    g.fill();

    g.globalAlpha = (good ? 0.12 : 0.15) * alpha;
    g.fillStyle = col;
    roundRectPath(x + 1, y + 1, w - 2, h - 2, Math.max(1, r - 1));
    g.fill();
    g.globalAlpha = alpha;

    g.save();
    roundRectPath(x, y, w, h, r);
    g.clip();
    g.globalAlpha = 0.12 * alpha;
    g.strokeStyle = col;
    g.lineWidth = 1;
    var sy;
    for (sy = y + 4; sy < y + h; sy += 6) {
      g.beginPath();
      g.moveTo(x, sy);
      g.lineTo(x + w, sy);
      g.stroke();
    }
    g.restore();

    g.shadowColor = col;
    g.shadowBlur = Math.max(4, 12 * sc * viewScale);
    g.strokeStyle = col;
    g.lineWidth = Math.max(1.2, 2.4 * sc * viewScale);
    roundRectPath(x, y, w, h, r);
    g.stroke();
    g.shadowBlur = 0;

    g.fillStyle = col;
    g.globalAlpha = 0.85 * alpha;
    g.fillRect(x + w * 0.14, y + 2, w * 0.72, Math.max(1.5, h * 0.018));
    g.globalAlpha = alpha;

    var tagSize = Math.max(7, Math.min(h * 0.14, 16 * viewScale, w * 0.11));
    drawLabel(good ? '增益' : '风险', x + w * 0.5, y + h * 0.115, tagSize, col, 'center', 800, FONT_CJK);

    var iconSize = h * 0.30;
    var iconY = y + h * 0.36;
    var iconSpr = getSprite('gateIcon', eff.kind);
    var iconDrew = iconSpr ? drawSpriteFit(iconSpr, x + w * 0.5, iconY, iconSize, alpha) : false;
    if (!iconDrew) {
      g.save();
      g.globalAlpha = alpha;
      drawFallbackGateIcon(eff.kind, x + w * 0.5, iconY, iconSize * 0.82, col, good);
      g.restore();
    }

    var label = eff.label || (good ? '+1' : '-1');
    var labelSize = Math.max(h * 0.215, Math.min(w * 0.11, h * 0.34));
    if (labelSize < 9) labelSize = 9;
    labelSize = fitSize(label, w * 0.84, labelSize, 800, FONT_UI);
    g.globalAlpha = alpha;
    drawLabel(label, x + w * 0.5, y + h * 0.72, labelSize, '#F4F8FF', 'center', 800, FONT_UI);

    g.save();
    g.globalAlpha = 0.85 * alpha;
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = Math.max(1, 1.8 * sc * viewScale);
    var ay = y + h * 0.885;
    if (good) {
      var aw = Math.min(w * 0.12, 11 * sc * viewScale);
      g.beginPath();
      g.moveTo(x + w * 0.5, ay + aw);
      g.lineTo(x + w * 0.5 - aw, ay);
      g.lineTo(x + w * 0.5 - aw * 0.35, ay);
      g.lineTo(x + w * 0.5 - aw * 0.35, ay - aw);
      g.lineTo(x + w * 0.5 + aw * 0.35, ay - aw);
      g.lineTo(x + w * 0.5 + aw * 0.35, ay);
      g.lineTo(x + w * 0.5 + aw, ay);
      g.closePath();
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(x + w * 0.5, ay - 5 * sc * viewScale);
      g.lineTo(x + w * 0.5 + 6 * sc * viewScale, ay + 4 * sc * viewScale);
      g.lineTo(x + w * 0.5 - 6 * sc * viewScale, ay + 4 * sc * viewScale);
      g.closePath();
      g.fill();
      g.fillStyle = '#1A0A10';
      g.fillRect(x + w * 0.5 - 0.8, ay - 2.4 * sc * viewScale, Math.max(1.2, 1.6 * sc * viewScale), 3.2 * sc * viewScale);
    }
    g.restore();

    g.globalAlpha = 0.5 * alpha;
    g.fillStyle = '#FFFFFF';
    g.fillRect(x + w * 0.08, y + 3, w * 0.22, Math.max(1, h * 0.008));
    g.restore();
  }

  function drawGate(gate, z, alpha) {
    var L = gateLayout(z);
    var sc = L.sc;
    if (sc <= 0.05) return;
    alpha = alpha == null ? 1 : alpha;
    var p = pal();
    var gy = L.gy;
    var leftX = L.leftX;
    var rightX = L.rightX;
    var midX = L.midX;
    var panelH = L.panelH;
    var panelTop = L.panelTop;
    var panelBottom = L.panelBottom;
    var inset = Math.max(2, 5 * sc * viewScale);
    var gap = Math.max(2, 5 * sc * viewScale);
    var lw, rw, ph;

    if (panelH < 7 || (rightX - leftX) < 25) return;

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.10 * alpha;
    g.fillStyle = gate.left.good ? p.good : p.danger;
    g.fillRect(leftX + inset, gy, (midX - gap - leftX) * 0.92, panelH * 0.30);
    g.fillStyle = gate.right.good ? p.good : p.danger;
    g.fillRect(midX + gap, gy, (rightX - midX - gap) * 0.92, panelH * 0.30);
    g.restore();

    drawGatePost(leftX, gy, panelH * 1.10, sc, alpha);
    drawGatePost(midX, gy, panelH * 1.12, sc, alpha);
    drawGatePost(rightX, gy, panelH * 1.10, sc, alpha);

    lw = midX - gap - (leftX + inset);
    rw = (rightX - inset) - (midX + gap);
    ph = panelBottom - panelTop;

    drawGatePanel(leftX + inset, panelTop, lw, ph, gate.left, sc, alpha);
    drawGatePanel(midX + gap, panelTop, rw, ph, gate.right, sc, alpha);

    g.save();
    g.globalAlpha = 0.26 * alpha;
    g.strokeStyle = '#9BE8FF';
    g.lineWidth = Math.max(0.8, 1.5 * sc * viewScale);
    g.beginPath();
    g.moveTo(midX, panelTop + 2);
    g.lineTo(midX, gy);
    g.stroke();
    g.restore();
  }

  function drawGates(state) {
    var dist = num(state.distance, 0);
    var gates = state.gates || [];
    var k, m, gx, z, item, L, r, b, overlap, alpha, drawn;

    gateList.length = 0;
    for (k = 0; k < gates.length; k++) {
      gx = gates[k];
      if (!gx || gx.applied || !isFinite(gx.d)) continue;
      z = gx.d - dist;
      if (z < MIN_DEPTH || z > MAX_DEPTH) continue;
      item = gatePool[gateList.length];
      if (!item) {
        item = {};
        gatePool[gateList.length] = item;
      }
      item.gate = gx;
      item.z = z;
      gateList.push(item);
    }

    // 从近到远：只绘制 2 扇最近的门，且跳过屏幕矩形会与近门重叠的门
    gateList.sort(function (a, b) { return a.z - b.z; });
    drawn = 0;
    for (k = 0; k < gateList.length && drawn < 2; k++) {
      z = gateList[k].z;
      L = gateLayout(z);
      if (L.panelH < 7 || (L.rightX - L.leftX) < 25) continue;

      r = gateRectPool[drawn];
      if (!r) {
        r = {};
        gateRectPool[drawn] = r;
      }
      r.x0 = L.leftX;
      r.x1 = L.rightX;
      r.y0 = L.panelTop;
      r.y1 = L.gy;

      overlap = false;
      for (m = 0; m < drawn; m++) {
        b = gateRectPool[m];
        if (r.x0 < b.x1 - 4 && r.x1 > b.x0 + 4 && r.y0 < b.y1 - 4 && r.y1 > b.y0 + 4) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      alpha = z > 72 ? clamp(1 - (z - 72) / 48 * 0.45, 0.55, 1) : 1;
      drawGate(gateList[k].gate, z, alpha);
      drawn++;
    }
  }

  /* ==========================================================
   * 实体深度排序
   * ========================================================== */
  var sortPool = [];
  var sortList = [];

  function sortPush(kind, obj, z) {
    var e = sortPool[sortList.length];
    if (!e) {
      e = {};
      sortPool[sortList.length] = e;
    }
    e.kind = kind;
    e.obj = obj;
    e.z = z;
    sortList.push(e);
  }

  function drawEntities(state, dist) {
    var k, list, e, z;
    sortList.length = 0;

    list = state.enemies || [];
    for (k = 0; k < list.length; k++) {
      e = list[k];
      if (!e || e.dead || !isFinite(e.d)) continue;
      z = e.d - dist;
      if (z < MIN_DEPTH || z > MAX_DEPTH) continue;
      sortPush('enemy', e, z);
    }

    list = state.props || [];
    for (k = 0; k < list.length; k++) {
      e = list[k];
      if (!e || e.dead || !isFinite(e.d)) continue;
      z = e.d - dist;
      if (z < MIN_DEPTH || z > MAX_DEPTH) continue;
      sortPush('prop', e, z);
    }

    list = state.pickups || [];
    for (k = 0; k < list.length; k++) {
      e = list[k];
      if (!e || e.dead || !isFinite(e.d)) continue;
      z = e.d - dist;
      if (z < MIN_DEPTH || z > MAX_DEPTH) continue;
      sortPush('pickup', e, z);
    }

    list = state.bullets || [];
    for (k = 0; k < list.length; k++) {
      e = list[k];
      if (!e || e.dead || !isFinite(e.d)) continue;
      z = e.d - dist;
      if (z < MIN_DEPTH || z > MAX_DEPTH) continue;
      sortPush('bullet', e, z);
    }

    list = state.enemyShots || [];
    for (k = 0; k < list.length; k++) {
      e = list[k];
      if (!e || e.dead || !isFinite(e.d)) continue;
      z = e.d - dist;
      if (z < MIN_DEPTH || z > MAX_DEPTH) continue;
      sortPush('shot', e, z);
    }

    if (state.boss && !state.boss.dead && isFinite(state.boss.d)) {
      z = state.boss.d - dist;
      if (z >= MIN_DEPTH && z <= MAX_DEPTH) sortPush('boss', state.boss, z);
    }

    sortList.sort(function (a, b) { return b.z - a.z; });

    for (k = 0; k < sortList.length; k++) {
      e = sortList[k];
      if (e.kind === 'enemy') drawEnemy(e.obj, e.z);
      else if (e.kind === 'prop') drawProp(e.obj, e.z);
      else if (e.kind === 'pickup') drawPickup(e.obj, e.z);
      else if (e.kind === 'bullet') drawBullet(e.obj, e.z);
      else if (e.kind === 'shot') drawEnemyShot(e.obj, e.z);
      else if (e.kind === 'boss') drawBoss(state.boss, e.z);
    }
  }

  /* ==========================================================
   * 敌人 / Boss / 弹药 / 道具
   * ========================================================== */
  function drawEnemy(e, z) {
    var sc = depthScale(z);
    if (sc <= 0.03) return;
    var x = screenX(num(e.x, 0), sc);
    var y = screenY(sc);
    var vs = sc * viewScale;
    var alpha = fogAlpha(z);
    var isElite = !!e.elite;
    var baseH = e.type === 'tank' ? 102 : (e.type === 'runner' ? 66 : 78);
    if (isElite) baseH *= 1.18;
    var targetH = baseH * vs;
    var id = num(e.id, 1);
    var animRate = e.type === 'runner' ? 7.7 : 4.9;
    var bob = Math.sin(time * animRate + id * 1.7) * targetH * (e.type === 'runner' ? 0.030 : 0.018);
    if (reducedMotion) bob *= 0.2;
    var frame = Math.floor(((time * animRate + id * 1.3) % 4 + 4) % 4);
    var spr = getSprite('zombie', e.type, frame);
    var drew, fa;

    shadowEllipse(x, y, targetH * (e.type === 'tank' ? 0.34 : 0.27), 0.34 * alpha);

    if (isElite) {
      softGlow(x, y - targetH * 0.48, targetH * 0.62, '#FFC94D', 0.22 * alpha);
      ringEllipse(x, y, targetH * 0.34, targetH * 0.11, '#FFC94D', 0.42 * alpha, Math.max(1.2, 2.2 * vs));
    }

    drew = spr ? drawSpriteFit(spr, x, y - bob, targetH, alpha) : false;
    if (!drew) drawFallbackZombie(x, y - bob, targetH, e.type, frame, alpha, false);

    if (e.hitFlash > 0) {
      fa = clamp(e.hitFlash / 0.1, 0, 1);
      g.save();
      g.globalCompositeOperation = 'lighter';
      if (spr) drawSpriteFit(spr, x, y - bob, targetH, 0.66 * fa);
      else drawFallbackZombie(x, y - bob, targetH, e.type, frame, fa * 0.85, true);
      g.restore();
    }

    if (e.type === 'tank' || isElite) {
      drawHpBar(x, y - targetH * 1.02, Math.max(18, targetH * 0.55), e.hp / Math.max(1, e.maxHp), alpha);
    }
    if (isElite) {
      drawLabel('精英', x, y - targetH * 1.16, Math.max(10, 12 * viewScale), '#FFD166', 'center', 900, FONT_UI, true);
    }
  }

  function drawHpBar(x, y, w, frac, alpha) {
    frac = clamp(frac, 0, 1);
    var h = Math.max(3, w * 0.10);
    g.save();
    g.globalAlpha = alpha * 0.92;
    g.fillStyle = 'rgba(4,8,14,0.72)';
    g.fillRect(x - w * 0.5, y, w, h);
    g.fillStyle = frac < 0.34 ? '#FF5B6E' : (frac < 0.66 ? '#FFC14D' : '#63F0A8');
    g.fillRect(x - w * 0.5 + 1, y + 1, (w - 2) * frac, Math.max(1, h - 2));
    g.globalAlpha = alpha * 0.35;
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = 1;
    g.strokeRect(x - w * 0.5, y, w, h);
    g.restore();
  }

  function drawBoss(b, z) {
    var sc = depthScale(z);
    if (sc <= 0.03) return;
    var x = screenX(num(b.x, 0), sc);
    var y = screenY(sc);
    var alpha = fogAlpha(z);
    var pulse = reducedMotion ? 1 : (1 + Math.sin(time * 2.15) * 0.016);
    var targetH = 238 * sc * viewScale * pulse;
    var id = num(b.id, 1);
    var pose = bossPoseTimer > 0 ? 1 : 0;
    var p = pal();
    var bob, spr, drew, fa;

    shadowEllipse(x, y, targetH * 0.43, 0.44 * alpha);

    g.save();
    g.globalAlpha = alpha * (0.16 + 0.08 * Math.abs(Math.sin(time * 2.4)));
    g.strokeStyle = p.danger;
    g.lineWidth = Math.max(1.5, 3 * sc * viewScale);
    ringEllipse(x, y, targetH * 0.42, targetH * 0.12, p.danger, 0.35, Math.max(1.5, 3 * sc * viewScale));
    g.restore();

    bob = reducedMotion ? 0 : Math.sin(time * 1.6 + id) * targetH * 0.008;
    spr = getSprite('boss', b.type, pose);
    drew = spr ? drawSpriteFit(spr, x, y - bob, targetH, alpha) : false;
    if (!drew) drawFallbackBoss(x, y - bob, targetH, b.type, pose, alpha, false);

    if (b.hitFlash > 0) {
      fa = clamp(b.hitFlash / 0.1, 0, 1);
      g.save();
      g.globalCompositeOperation = 'lighter';
      if (spr) drawSpriteFit(spr, x, y - bob, targetH, 0.60 * fa);
      else drawFallbackBoss(x, y - bob, targetH, b.type, pose, fa * 0.8, true);
      g.restore();
    }
  }

  function drawBullet(b, z) {
    var sc = depthScale(z);
    if (sc <= 0.03) return;
    var tier = clamp(Math.round(num(b.tier, 1)), 1, 6);
    var color = TIER_COLORS[tier - 1];
    var x = screenX(num(b.x, 0), sc);
    var y = screenY(sc) - 33 * sc * viewScale;
    var vs = sc * viewScale;
    var alpha = fogAlpha(z);
    var speed = num(b.speed, 90);
    var j, f, px, py, glowR;

    var tz = clamp(z - speed * 0.045, MIN_DEPTH, z);
    var tsc = depthScale(tz);
    var tx = screenX(num(b.x, 0), tsc);
    var ty = screenY(tsc) - 33 * tsc * viewScale;

    g.save();
    g.globalCompositeOperation = 'lighter';

    // 重武器：先铺一段烟雾/尾焰，让火箭弹和坦克炮弹有重量感。
    if (tier >= 4) {
      for (j = 0; j < 4; j++) {
        f = j / 4;
        px = tx + (x - tx) * f;
        py = ty + (y - ty) * f;
        g.globalAlpha = (0.20 - f * 0.04) * alpha;
        g.fillStyle = tier === 5 ? '#FFD08A' : '#C9D6E4';
        g.beginPath();
        g.arc(px, py, (3 + f * 5) * vs, 0, TAU);
        g.fill();
      }
      softGlow(tx, ty, Math.max(7, 18 * vs), tier === 5 ? '#FFB24D' : '#5FE0FF', 0.42 * alpha);
    }

    // 主体拖尾：轻武器细亮，重武器更粗。
    g.globalAlpha = (tier >= 4 ? 0.66 : 0.50) * alpha;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, (tier >= 4 ? 6.5 : 4.2) * vs);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(x, y);
    g.stroke();

    // 白色弹芯（带一点渐细的错觉）。
    g.globalAlpha = 0.9 * alpha;
    g.strokeStyle = '#FFFFFF';
    g.lineWidth = Math.max(0.8, (tier >= 4 ? 2.2 : 1.4) * vs);
    g.beginPath();
    g.moveTo(tx + (x - tx) * 0.38, ty + (y - ty) * 0.38);
    g.lineTo(x, y);
    g.stroke();

    // 等离子：脉冲环，区别于普通曳光。
    if (tier === 6) {
      glowR = (9 + Math.sin(time * 18 + num(b.id, 1)) * 3) * vs;
      g.globalAlpha = 0.45 * alpha;
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, 1.8 * vs);
      g.beginPath();
      g.arc(x, y, glowR, 0, TAU);
      g.stroke();
    }

    softGlow(x, y, Math.max(8, (tier >= 4 ? 28 : 21) * vs), color, 0.62 * alpha);
    g.globalAlpha = alpha;
    g.fillStyle = '#FFFFFF';
    g.beginPath();
    g.arc(x, y, Math.max(1, (tier >= 4 ? 3.2 : 2.2) * vs), 0, TAU);
    g.fill();

    // 坦克炮弹：弹头前方再压一圈冲击波，命中更有存在感。
    if (tier === 5) {
      g.globalAlpha = 0.35 * alpha;
      ringEllipse(x, y + 2 * vs, 16 * vs, 6 * vs, '#FFD08A', 0.5 * alpha, Math.max(1, 2 * vs));
    }

    g.restore();

    drawNamedFit('bullet', tier, undefined, x, y, Math.max(4, (tier >= 4 ? 20 : 15) * vs), alpha);
  }

  function drawEnemyShot(s, z) {
    var sc = depthScale(z);
    if (sc <= 0.03) return;
    var x = screenX(num(s.x, 0), sc);
    var speed = num(s.speed, 15);
    var gy = screenY(sc);
    var vs = sc * viewScale;
    var alpha = fogAlpha(z);
    var id = num(s.id, 1);
    var kind = s.kind || 'acid';
    var color = (kind === 'acid' || kind === 'rain') ? '#A6FF4D' : '#FF6B3D';
    var j, w, ang;

    var tz = clamp(z + speed * 0.075, z, MAX_DEPTH);
    var tsc = depthScale(tz);
    var tx = screenX(num(s.x, 0), tsc) + (reducedMotion ? 0 : Math.sin(time * 10 + id) * 2 * tsc * viewScale);
    var ty = screenY(tsc) - ((kind === 'shockwave' || kind === 'charge') ? 0 : 23 * tsc * viewScale);
    var y = gy - ((kind === 'shockwave' || kind === 'charge') ? 0 : 23 * sc * viewScale);

    g.save();

    // 地面冲击波 / 冲锋波：宽而扁，带尘土，明确表示要横向躲开。
    if (kind === 'shockwave' || kind === 'charge') {
      w = (kind === 'charge' ? 130 : 90) * vs;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = (kind === 'charge' ? 0.42 : 0.34) * alpha;
      g.strokeStyle = '#FF8A4D';
      g.lineWidth = Math.max(2, 6 * vs);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(x, y);
      g.stroke();
      g.globalAlpha = 0.7 * alpha;
      ringEllipse(x, y, w, w * 0.26, '#FF5A3C', 0.85 * alpha, Math.max(1.5, 3.4 * vs));
      ringEllipse(x, y, w * 0.55, w * 0.15, '#FFE3B0', 0.5 * alpha, Math.max(1, 2 * vs));
      softGlow(x, y, w * 0.9, '#FF7A3D', 0.5 * alpha);
      g.globalAlpha = 0.8 * alpha;
      g.fillStyle = '#B2552F';
      for (j = 0; j < 3; j++) {
        ang = (id + j) * 1.7;
        g.fillRect(x + Math.cos(ang) * w * 0.35 - 2 * vs,
          y + Math.sin(ang) * w * 0.08, 4 * vs, 4 * vs);
      }
      g.restore();
      return;
    }

    // 酸雨：从上方落下的绿色弹体。
    if (kind === 'rain') {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.48 * alpha;
      g.strokeStyle = '#A6FF4D';
      g.lineWidth = Math.max(1, 3 * vs);
      g.beginPath();
      g.moveTo(x - 4 * vs, y - 90 * vs);
      g.lineTo(x, y);
      g.stroke();
      softGlow(x, y, Math.max(10, 24 * vs), '#A6FF4D', 0.48 * alpha);
      g.globalAlpha = alpha;
      g.fillStyle = '#B8FF6A';
      g.beginPath();
      g.arc(x, y, Math.max(2, 5.5 * vs), 0, TAU);
      g.fill();
      g.fillStyle = '#2A4A12';
      g.beginPath();
      g.arc(x, y, Math.max(1, 2.4 * vs), 0, TAU);
      g.fill();
      g.restore();
      return;
    }

    // 电锯：旋转三叶刀片 + 拖尾，比普通酸弹更醒目。
    if (kind === 'cleaver') {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.4 * alpha;
      g.strokeStyle = '#FF6B3D';
      g.lineWidth = Math.max(1, 4 * vs);
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(x, y);
      g.stroke();
      softGlow(x, y, Math.max(9, 22 * vs), '#FF8A4D', 0.36 * alpha);
      g.restore();

      g.save();
      g.translate(x, y);
      g.rotate(time * 14 + id * 1.3);
      g.fillStyle = '#E8EEF5';
      g.strokeStyle = '#8B1E2B';
      g.lineWidth = Math.max(1, 1.8 * vs);
      for (j = 0; j < 3; j++) {
        g.save();
        g.rotate(j * TAU / 3);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(16 * vs, -5 * vs);
        g.lineTo(16 * vs, 5 * vs);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
      g.fillStyle = '#FF5A3C';
      g.beginPath();
      g.arc(0, 0, Math.max(1.5, 3 * vs), 0, TAU);
      g.fill();
      g.restore();
      return;
    }

    // 普通酸弹。
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.48 * alpha;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1, 4 * vs);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(x, y);
    g.stroke();
    softGlow(x, y, Math.max(8, 21 * vs), color, 0.46 * alpha);
    g.globalAlpha = alpha;
    g.fillStyle = '#B8FF6A';
    g.beginPath();
    g.arc(x, y, Math.max(1.8, 5 * vs), 0, TAU);
    g.fill();
    g.fillStyle = '#2A4A12';
    g.beginPath();
    g.arc(x, y, Math.max(1, 2.4 * vs), 0, TAU);
    g.fill();
    g.restore();
  }

  function drawProp(prop, z) {
    var sc = depthScale(z);
    if (sc <= 0.03) return;
    var x = screenX(num(prop.x, 0), sc);
    var y = screenY(sc);
    var vs = sc * viewScale;
    var alpha = fogAlpha(z);
    var isBarrel = prop.type === 'barrel';
    var isWeapon = prop.type === 'weaponCrate';
    var tier = clamp(Math.round(num(prop.tier, 3)), 3, 6);
    var tierColor = TIER_COLORS[tier - 1];
    var targetH = (isWeapon ? 54 : (isBarrel ? 48 : 44)) * vs;
    var id = num(prop.id, 1);
    var gl, name, drew, hpFrac, labelY, labelText, labelSize, labelW;

    shadowEllipse(x, y, targetH * (isWeapon ? 0.34 : 0.28), 0.30 * alpha);

    if (isBarrel) {
      gl = 0.16 + 0.10 * Math.abs(Math.sin(time * 2.2 + id));
      softGlow(x, y - targetH * 0.45, targetH * 0.55, '#FF7A3D', gl * alpha);
    } else if (isWeapon) {
      gl = 0.20 + 0.12 * Math.abs(Math.sin(time * 2.0 + id * 1.3));
      softGlow(x, y - targetH * 0.48, targetH * 0.68, tierColor, gl * alpha);
      ringEllipse(x, y, targetH * 0.38, targetH * 0.13, tierColor, 0.24 * alpha, Math.max(1, 1.5 * vs));
    }

    if (isWeapon) {
      drew = drawNamedFit('weaponCrate', tier, undefined, x, y, targetH, alpha);
      if (!drew) drawFallbackWeaponCrate(x, y, targetH, alpha, tier);

      if (prop.maxHp > 0 && prop.hp < prop.maxHp) {
        hpFrac = clamp(num(prop.hp, 0) / Math.max(1, num(prop.maxHp, 1)), 0, 1);
        drawHpBar(x, y - targetH * 1.04, Math.max(20, targetH * 0.62), hpFrac, alpha);
      }

      labelText = WEAPON_NAMES[tier - 1] || ('T' + tier);
      labelSize = Math.max(9, 11 * viewScale);
      setFont(labelSize, 900, FONT_UI);
      labelW = g.measureText(labelText).width;
      labelY = y - targetH * 1.22 + (reducedMotion ? 0 : Math.sin(time * 2.6 + id) * 2.5 * vs);
      fillRound(x - labelW * 0.5 - 5 * viewScale, labelY - labelSize * 0.82,
        labelW + 10 * viewScale, labelSize * 1.64, labelSize * 0.82, 'rgba(5,9,16,0.74)', 0.9);
      drawLabel(labelText, x, labelY, labelSize, tierColor, 'center', 900, FONT_UI, false);
    } else {
      name = isBarrel ? 'barrel' : 'crate';
      drew = drawNamedFit(name, undefined, undefined, x, y, targetH, alpha);
      if (!drew) drawFallbackScenery(name, x, y, targetH, alpha, id, prop.x < 0 ? -1 : 1);
    }
  }

  function drawPickup(pk, z) {
    var sc = depthScale(z);
    if (sc <= 0.03) return;
    var x = screenX(num(pk.x, 0), sc);
    var y = screenY(sc);
    var vs = sc * viewScale;
    var alpha = fogAlpha(z);
    var id = num(pk.id, 1);
    var med = pk.type !== 'ammo';
    var color = med ? '#5CFFA6' : '#FFD166';
    var bob = reducedMotion ? 0 : Math.sin(time * 3.1 + id * 1.7) * 4 * vs;
    var targetH = 30 * vs;
    var name, drew;

    shadowEllipse(x, y, targetH * 0.34, 0.24 * alpha);

    g.save();
    g.globalAlpha = 0.22 * alpha;
    ringEllipse(x, y, targetH * 0.42, targetH * 0.14, color, 0.5 * alpha, Math.max(0.8, 1.6 * vs));
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.10 * alpha;
    g.fillStyle = color;
    g.fillRect(x - targetH * 0.08, y - targetH * 1.0, targetH * 0.16, targetH);
    g.restore();

    softGlow(x, y - targetH * 0.45 + bob, targetH * 0.8, color, 0.36 * alpha);

    name = med ? 'medkit' : 'ammo';
    drew = drawNamedFit(name, undefined, undefined, x, y - bob, targetH, alpha);
    if (!drew) drawFallbackScenery(name, x, y - bob, targetH, alpha, id, 0);
  }

  /* ==========================================================
   * 小队
   * ========================================================== */
  function playerScreen(state) {
    var lateral = clamp(num(state && state.x, 0), -1, 1) * 0.86;
    var formHalf = (2.5 * 0.135 + 0.060) * roadHalf + SQUAD_UNIT_H * viewScale * 0.34;
    var half = Math.min(formHalf, vw * 0.42);
    return {
      x: clamp(cx + lateral * roadHalf, half, vw - half),
      y: vh * 0.862
    };
  }

  function drawSquad(state, dt) {
    var people = Math.max(0, Math.floor(num(state.people, 0)));
    var visible = Math.min(SQUAD_CAP, people);
    var lead, p, tier, tierColor;
    var k, j, row, col, ox, targetH, sx, sy, sc, bob, frame, variant, spr, drew, alpha, dr, dx, dy;

    if (visible <= 0) {
      if (state.status === 'running') drawSquadTag(state, 0);
      return;
    }

    lead = playerScreen(state);
    p = pal();
    tier = clamp(Math.round(num(state.weaponLevel, 1)), 1, 6);
    tierColor = TIER_COLORS[tier - 1];

    if (state.status === 'running' && !reducedMotion) {
      dustTimer += dt;
      if (dustTimer > 0.106) {
        dustTimer = 0;
        dustSeq++;
        for (j = 0; j < 2; j++) {
          dr = hash(dustSeq * 17 + j * 5);
          dx = lead.x + (dr - 0.5) * 90 * viewScale;
          dy = lead.y - 2 * viewScale;
          spawnP(dx, dy, (dr - 0.5) * 26, -12 - hash(dustSeq * 31 + j) * 22,
            0.36 + dr * 0.3, 5 + dr * 7, hexA(p.shoulder, 0.5), 2, -12, 2.2);
        }
      }
    }

    for (k = visible - 1; k >= 0; k--) {
      if (k === 0) {
        row = 0;
        ox = 0;
      } else {
        j = k - 1;
        row = Math.floor(j / 6) + 1;
        col = j % 6;
        ox = (col - 2.5) * 0.135 + (row % 2 ? 0.060 : 0);
      }

      sc = 1 + row * 0.045;
      targetH = SQUAD_UNIT_H * viewScale * sc * (k === 0 ? 1.04 : 1);
      sx = lead.x + ox * roadHalf * (1 + row * 0.015);
      sx = clamp(sx, targetH * 0.42, vw - targetH * 0.42);
      sy = lead.y + row * 0.026 * vh + (k === 0 ? -5 * viewScale : 0);
      if (k === 0) sy += fireKick * 3.2 * viewScale;
      bob = Math.sin(time * 7 + k * 1.35 + num(state.distance, 0) * 0.06) * 1.8 * viewScale;
      if (reducedMotion) bob *= 0.25;
      sy += bob;
      alpha = 1;

      frame = Math.floor(((time * 6.2 + k * 0.8 + num(state.distance, 0) * 0.5) % 4 + 4) % 4);
      variant = (k * 7 + 2) % 3;

      shadowEllipse(sx, sy + 1, targetH * 0.24, 0.28);

      spr = getSprite('soldier', variant, frame);
      drew = spr ? drawSpriteFit(spr, sx, sy, targetH, alpha) : false;
      if (!drew) drawFallbackSoldier(sx, sy, targetH, variant, frame, alpha, false);

      if (k === 0) {
        softGlow(sx + targetH * 0.17, sy - targetH * 0.63, targetH * 0.18, tierColor, 0.30);
        softGlow(sx - targetH * 0.17, sy - targetH * 0.63, targetH * 0.12, tierColor, 0.16);
      }
    }

    // 枪口火光：随每次齐射闪一下，重武器更明显。
    if (muzzleTimer > 0 && state.status === 'running') {
      var ma = clamp(muzzleTimer / 0.11, 0, 1);
      var mh = SQUAD_UNIT_H * viewScale * 1.04;
      var mx = lead.x + mh * 0.16;
      var my = lead.y - mh * 0.66 + fireKick * 2 * viewScale;
      drawNamedFit('muzzle', muzzleTier, undefined, mx, my,
        mh * (muzzleTier >= 4 ? 0.42 : 0.32), ma, -0.18);
      softGlow(mx, my, mh * (muzzleTier >= 4 ? 0.30 : 0.20),
        TIER_COLORS[muzzleTier - 1], 0.55 * ma);
    }

    drawSquadTag(state, people);
  }

  function drawSquadTag(state, people) {
    if (people <= SQUAD_CAP) return;
    var lead = playerScreen(state);
    var extra = people - SQUAD_CAP;
    var size = 12 * viewScale;
    var text = '+' + extra;
    setFont(size, 800, FONT_UI);
    var tw = g.measureText(text).width;
    var w = tw + size * 1.1;
    var h = size * 1.75;
    var x = clamp(lead.x + 72 * viewScale, w * 0.5 + 6, vw - w * 0.5 - 6);
    var y = lead.y - 58 * viewScale;

    fillRound(x - w * 0.5, y - h * 0.5, w, h, h * 0.5, 'rgba(6,12,20,0.82)', 0.88);
    g.save();
    g.strokeStyle = 'rgba(140,255,205,0.55)';
    g.lineWidth = 1;
    roundRectPath(x - w * 0.5, y - h * 0.5, w, h, h * 0.5);
    g.stroke();
    g.restore();
    drawLabel(text, x, y + 0.5, size, '#8CFFCD', 'center', 800, FONT_UI, false);
  }

  /* ==========================================================
   * 预警 / 冲击波 / 粒子 / 飘字
   * ========================================================== */
  function drawTelegraphs(state) {
    var p = pal();
    var k, j, t, z, sc, x, y, prog, alpha, lead, dashY, ax, rr, rr2;

    for (k = 0; k < TEL_CAP; k++) {
      t = teles[k];
      if (!t.active) continue;
      z = clamp(t.z, MIN_DEPTH, MAX_DEPTH);
      sc = depthScale(z);
      x = screenX(t.x, sc);
      y = screenY(sc);
      prog = 1 - t.life / t.maxLife;
      alpha = 0.35 + 0.55 * Math.abs(Math.sin(time * 9 + prog * 4));
      if (t.life < 0.15) alpha *= t.life / 0.15;

      if (t.kind === 'charge') {
        lead = playerScreen(state);
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.10 + 0.16 * alpha;
        g.fillStyle = p.danger;
        g.beginPath();
        g.moveTo(x - 12 * sc * viewScale, y);
        g.lineTo(x + 12 * sc * viewScale, y);
        g.lineTo(lead.x + 34 * viewScale, lead.y);
        g.lineTo(lead.x - 34 * viewScale, lead.y);
        g.closePath();
        g.fill();
        g.restore();

        dashY = y + (lead.y - y) * ((time * 2.2) % 1);
        g.save();
        g.globalAlpha = 0.7 * alpha;
        g.strokeStyle = p.danger;
        g.lineWidth = Math.max(1.5, 3 * sc * viewScale);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(lead.x, lead.y);
        g.stroke();
        g.fillStyle = '#FFE3E8';
        g.beginPath();
        g.arc(x + (lead.x - x) * ((dashY - y) / Math.max(1, lead.y - y)), dashY, 3 * viewScale, 0, TAU);
        g.fill();
        g.restore();
      } else if (t.kind === 'acid') {
        for (j = -1; j <= 1; j++) {
          ax = screenX(t.x + j * 0.20, sc);
          rr = (24 + 42 * prog) * sc * viewScale;
          ringEllipse(ax, y, rr, rr * 0.35, '#9DFF4D', 0.45 * alpha, Math.max(1, 2.2 * sc * viewScale));
          softGlow(ax, y, rr * 0.8, '#9DFF4D', 0.10 * alpha);
        }
      } else {
        rr2 = (28 + 88 * prog) * sc * viewScale;
        ringEllipse(x, y, rr2, rr2 * 0.34, p.danger, 0.55 * alpha, Math.max(1.4, 3 * sc * viewScale));
        ringEllipse(x, y, rr2 * 0.62, rr2 * 0.21, p.danger, 0.3 * alpha, Math.max(1, 1.6 * sc * viewScale));
        softGlow(x, y, rr2 * 0.8, p.danger, 0.10 * alpha);
        drawLabel('!', x, y - 34 * sc * viewScale, Math.max(12, 26 * sc * viewScale), p.danger, 'center', 900, FONT_UI);
      }
    }
  }

  function drawFX() {
    var k, b, r, p, t, ratio, alpha, size, rr, frame, alphaB, scaleIn;

    for (k = 0; k < BOOM_CAP; k++) {
      b = booms[k];
      if (!b.active) continue;
      ratio = 1 - b.life / b.maxLife;
      frame = Math.min(5, Math.floor(ratio * 6));
      alphaB = Math.min(1, b.life / 0.18);
      if (!drawNamedFit('explosion', frame, undefined, b.x, b.y, b.size, alphaB)) {
        softGlow(b.x, b.y, b.size * 0.56, '#FFB24D', 0.35 * alphaB);
      }
    }

    for (k = 0; k < RING_CAP; k++) {
      r = rings[k];
      if (!r.active) continue;
      ratio = 1 - r.life / r.maxLife;
      rr = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - ratio, 2.2));
      alpha = (1 - ratio) * 0.9 * r.alpha;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = alpha;
      g.strokeStyle = r.color;
      g.lineWidth = Math.max(1, r.width * (1 - ratio * 0.55));
      g.beginPath();
      if (r.flat) {
        if (g.ellipse) g.ellipse(r.x, r.y, rr, rr * 0.34, 0, 0, TAU);
        else g.arc(r.x, r.y, rr, 0, TAU);
      } else {
        g.arc(r.x, r.y, rr, 0, TAU);
      }
      g.stroke();
      g.restore();
    }

    for (k = 0; k < P_CAP; k++) {
      p = particles[k];
      if (!p.active) continue;
      ratio = p.life / p.maxLife;
      alpha = ratio * (p.kind === 2 ? 0.34 : 0.86);
      size = p.size * (p.kind === 2 ? (1.5 - ratio * 0.65) : (0.55 + ratio * 0.45));

      if (p.kind === 1) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = alpha;
        g.strokeStyle = p.color;
        g.lineWidth = Math.max(0.8, size * 0.34);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
        g.stroke();
        g.restore();
      } else if (p.kind === 3) {
        g.save();
        g.globalAlpha = alpha * 0.55;
        g.fillStyle = p.color;
        g.beginPath();
        if (g.ellipse) g.ellipse(p.x, p.y, size * 1.8, size * 0.48, p.rot, 0, TAU);
        else g.arc(p.x, p.y, size, 0, TAU);
        g.fill();
        g.restore();
      } else {
        g.save();
        g.globalAlpha = alpha;
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, size, 0, TAU);
        g.fill();
        g.restore();
      }
    }

    for (k = 0; k < T_CAP; k++) {
      t = texts[k];
      if (!t.active) continue;
      ratio = t.life / t.maxLife;
      alpha = Math.min(1, t.life * 2.6) * Math.min(1, (t.maxLife - t.life) * 7 + 0.2);
      scaleIn = 0.75 + 0.25 * Math.min(1, t.pop * 1.25);
      g.save();
      g.globalAlpha = alpha;
      setFont(t.size * scaleIn, t.weight, FONT_UI);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = Math.max(2, t.size * 0.16);
      g.strokeStyle = 'rgba(3,6,12,0.72)';
      g.strokeText(t.text, t.x, t.y);
      g.fillStyle = t.color;
      g.fillText(t.text, t.x, t.y);
      g.restore();
    }
  }

  /* ==========================================================
   * 速度线 / 覆盖层
   * ========================================================== */
  function drawSpeedLines(state) {
    if (!state || state.status !== 'running') return;
    var sp = num(state.speed, 0);
    if (sp < 8) return;
    var intensity = clamp((sp - 8) / 8, 0, 1) * (reducedMotion ? 0.35 : 1);
    if (intensity <= 0.01) return;

    var k, ang, ca, sa, r1, r2, x1, y1, x2, y2;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (k = 0; k < 14; k++) {
      ang = hash(k * 7 + 3) * TAU;
      ca = Math.cos(ang);
      sa = Math.sin(ang);
      if (Math.abs(ca) < 0.55 && sa > 0) ang += 0.8;
      ca = Math.cos(ang);
      sa = Math.sin(ang);
      r1 = Math.max(vw, vh) * (0.38 + hash(k * 11 + 5) * 0.18);
      r2 = r1 + 36 + hash(k * 13 + 9) * 140;
      x1 = cx + ca * r1;
      y1 = vh * 0.6 + sa * r1 * 0.85;
      x2 = cx + ca * r2;
      y2 = vh * 0.6 + sa * r2 * 0.85;
      g.globalAlpha = (0.045 + hash(k * 17 + 2) * 0.08) * intensity;
      g.strokeStyle = '#FFFFFF';
      g.lineWidth = 1 + hash(k * 19 + 4) * 2;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    g.restore();
  }

  function ensureVignette() {
    var key = vw + 'x' + vh;
    if (vignetteCv && vignetteKey === key) return;
    vignetteKey = key;
    vignetteCv = makeCanvas(vw, vh);
    if (!vignetteCv) return;
    var vg = vignetteCv.getContext('2d');
    var grd = vg.createRadialGradient(cx, vh * 0.54, Math.min(vw, vh) * 0.22, cx, vh * 0.54, Math.max(vw, vh) * 0.74);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.56, 'rgba(0,0,0,0.05)');
    grd.addColorStop(0.82, 'rgba(0,0,0,0.26)');
    grd.addColorStop(1, 'rgba(0,0,0,0.58)');
    vg.fillStyle = grd;
    vg.fillRect(0, 0, vw, vh);

    var top = vg.createLinearGradient(0, 0, 0, vh * 0.22);
    top.addColorStop(0, 'rgba(0,0,0,0.20)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    vg.fillStyle = top;
    vg.fillRect(0, 0, vw, vh * 0.22);
  }

  function ensureGrain() {
    if (grainCv) return;
    grainCv = makeCanvas(128, 128);
    if (!grainCv) return;
    var gg = grainCv.getContext('2d');
    var img = gg.createImageData(128, 128);
    var d = img.data;
    var k, v;
    for (k = 0; k < d.length; k += 4) {
      v = Math.random() * 255;
      d[k] = v;
      d[k + 1] = v;
      d[k + 2] = v;
      d[k + 3] = 30;
    }
    gg.putImageData(img, 0, 0);
  }

  function drawOverlays(state) {
    var p = pal();

    if (state && state.status === 'dead') {
      g.save();
      g.globalAlpha = 0.17;
      g.fillStyle = '#5A0014';
      g.fillRect(0, 0, vw, vh);
      g.restore();
    } else if (state && state.status === 'won') {
      g.save();
      g.globalAlpha = 0.07;
      g.fillStyle = '#FFD36E';
      g.fillRect(0, 0, vw, vh);
      g.restore();
    }

    ensureGrain();
    if (grainCv) {
      g.save();
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = currentTheme === 'night' ? 0.045 : 0.032;
      g.drawImage(grainCv, 0, 0, vw, vh);
      g.restore();
    }

    if (flashA > 0) {
      g.save();
      g.globalAlpha = Math.min(0.62, flashA);
      g.fillStyle = flashColor;
      g.fillRect(0, 0, vw, vh);
      g.restore();
    }

    // 暗角最后叠加
    ensureVignette();
    if (vignetteCv) {
      g.save();
      g.globalAlpha = currentTheme === 'night' ? 1 : 0.9;
      g.drawImage(vignetteCv, 0, 0, vw, vh);
      g.restore();
    }
  }

  /* ==========================================================
   * 本地回退造型（精灵缺失时保证画面完整）
   * ========================================================== */
  function drawFallbackSoldier(x, y, h, variant, frame, alpha, flash) {
    var body = ['#3D4C48', '#464A3C', '#4A404A'][variant % 3];
    var pack = ['#2B3937', '#353A2F', '#39303A'][variant % 3];
    var skin = '#C79A78';
    var rim = currentTheme === 'night' ? '#8FB4FF' : (currentTheme === 'sunset' ? '#FFB27A' : '#FFE6B0');
    var stride = (frame === 1 ? 1 : (frame === 3 ? -1 : 0));

    g.save();
    g.translate(x, y);
    g.scale(h, h);
    g.globalAlpha = alpha;

    // 腿
    g.fillStyle = '#29332F';
    g.fillRect(-0.115, -0.42, 0.09, 0.42 + stride * 0.018);
    g.fillRect(0.025, -0.42, 0.09, 0.42 - stride * 0.018);
    g.fillStyle = '#1B2321';
    g.fillRect(-0.135, -0.06, 0.13, 0.06);
    g.fillRect(0.005, -0.06, 0.13, 0.06);

    // 躯干
    g.fillStyle = body;
    roundRectPath(-0.17, -0.80, 0.34, 0.46, 0.09);
    g.fill();

    // 背包
    g.fillStyle = pack;
    roundRectPath(-0.13, -0.77, 0.26, 0.34, 0.055);
    g.fill();
    g.strokeStyle = hexA('#000000', 0.35);
    g.lineWidth = 0.012;
    g.beginPath();
    g.moveTo(-0.10, -0.70);
    g.lineTo(-0.10, -0.47);
    g.moveTo(0.10, -0.70);
    g.lineTo(0.10, -0.47);
    g.stroke();

    // 手臂
    g.fillStyle = body;
    g.fillRect(-0.235, -0.76, 0.075, 0.30);
    g.fillRect(0.16, -0.76, 0.075, 0.30);

    // 头盔 / 头
    g.fillStyle = skin;
    g.beginPath();
    g.arc(0, -0.87, 0.105, 0, TAU);
    g.fill();
    g.fillStyle = '#2E3A3A';
    g.beginPath();
    g.arc(0, -0.895, 0.115, Math.PI, TAU);
    g.fill();
    g.fillRect(-0.115, -0.90, 0.23, 0.035);

    // 枪管（后视，略向左前伸出）
    g.strokeStyle = '#1A2024';
    g.lineWidth = 0.045;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0.15, -0.70);
    g.lineTo(0.28, -0.94);
    g.stroke();
    g.strokeStyle = '#59636C';
    g.lineWidth = 0.013;
    g.beginPath();
    g.moveTo(0.165, -0.715);
    g.lineTo(0.285, -0.945);
    g.stroke();

    // 轮廓光
    g.strokeStyle = hexA(rim, 0.30);
    g.lineWidth = 0.016;
    g.beginPath();
    g.arc(0, -0.87, 0.108, Math.PI * 0.9, Math.PI * 1.65);
    g.stroke();
    g.beginPath();
    g.moveTo(-0.17, -0.76);
    g.lineTo(-0.17, -0.40);
    g.stroke();

    if (flash) {
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(255,255,255,0.75)';
      roundRectPath(-0.17, -0.80, 0.34, 0.46, 0.09);
      g.fill();
      g.beginPath();
      g.arc(0, -0.87, 0.105, 0, TAU);
      g.fill();
    }

    g.restore();
  }

  function drawFallbackZombie(x, y, h, type, frame, alpha, flash) {
    var tank = type === 'tank';
    var runner = type === 'runner';
    var body = tank ? '#3B4A32' : (runner ? '#6A5343' : '#55664A');
    var dark = tank ? '#28331F' : (runner ? '#49382D' : '#3A4933');
    var rim = currentTheme === 'night' ? '#9EC2FF' : (currentTheme === 'sunset' ? '#FFAD7A' : '#E7F0C8');
    var sway = runner ? (frame % 2 ? 0.06 : -0.05) : (frame === 1 ? 0.025 : (frame === 3 ? -0.025 : 0));
    var armUp = runner ? 0.18 : 0.10;
    var w = tank ? 0.30 : 0.20;
    var hh = tank ? 1.06 : (runner ? 0.94 : 1);

    g.save();
    g.translate(x, y);
    g.scale(h, h);
    g.globalAlpha = alpha;
    g.rotate(sway * 0.20);

    // 腿
    g.strokeStyle = dark;
    g.lineWidth = tank ? 0.10 : 0.065;
    g.lineCap = 'round';
    var step = (frame === 1 ? 0.05 : (frame === 3 ? -0.05 : 0));
    g.beginPath();
    g.moveTo(-w * 0.45, -0.40);
    g.lineTo(-w * 0.52 - step, -0.02);
    g.moveTo(w * 0.45, -0.40);
    g.lineTo(w * 0.52 + step, -0.02);
    g.stroke();

    // 躯干
    g.fillStyle = body;
    g.beginPath();
    g.ellipse ? g.ellipse(0, -0.58 * hh, w * 0.78, 0.28 * hh, 0, 0, TAU) : g.arc(0, -0.58, w * 0.7, 0, TAU);
    g.fill();

    // 破烂下摆
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(-w * 0.72, -0.40);
    g.lineTo(-w * 0.40, -0.52);
    g.lineTo(-w * 0.10, -0.42);
    g.lineTo(w * 0.18, -0.53);
    g.lineTo(w * 0.46, -0.42);
    g.lineTo(w * 0.70, -0.50);
    g.lineTo(w * 0.64, -0.34);
    g.lineTo(-w * 0.62, -0.34);
    g.closePath();
    g.fill();

    // 手臂前伸（后视也能读到姿态）
    g.strokeStyle = body;
    g.lineWidth = tank ? 0.105 : 0.07;
    g.beginPath();
    g.moveTo(-w * 0.62, -0.70);
    g.lineTo(-w * 1.15, -0.82 - armUp);
    g.moveTo(w * 0.62, -0.70);
    g.lineTo(w * 1.15, -0.80 - armUp * 0.6);
    g.stroke();

    // 头
    g.fillStyle = tank ? '#596B48' : '#728466';
    g.beginPath();
    g.arc(0, -0.90 * hh, tank ? 0.13 : 0.105, 0, TAU);
    g.fill();
    g.fillStyle = dark;
    g.beginPath();
    g.arc(0, -0.895 * hh, tank ? 0.132 : 0.107, Math.PI * 1.05, Math.PI * 1.78);
    g.fill();

    // 伤口 / 血斑
    g.fillStyle = 'rgba(120,22,36,0.65)';
    g.beginPath();
    g.arc(w * 0.28, -0.62, 0.045, 0, TAU);
    g.fill();
    if (tank) {
      g.fillStyle = 'rgba(160,30,40,0.5)';
      g.beginPath();
      g.arc(-w * 0.32, -0.50, 0.06, 0, TAU);
      g.fill();
      // 厚肩
      g.fillStyle = '#2F3D26';
      g.beginPath();
      g.arc(-w * 0.74, -0.74, 0.115, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(w * 0.74, -0.74, 0.115, 0, TAU);
      g.fill();
    }

    // 轮廓光
    g.strokeStyle = hexA(rim, 0.26);
    g.lineWidth = 0.014;
    g.beginPath();
    g.arc(0, -0.90 * hh, tank ? 0.132 : 0.107, Math.PI * 1.05, Math.PI * 1.7);
    g.stroke();

    if (flash) {
      g.fillStyle = 'rgba(255,255,255,0.72)';
      g.beginPath();
      g.ellipse ? g.ellipse(0, -0.58 * hh, w * 0.80, 0.29 * hh, 0, 0, TAU) : g.arc(0, -0.58, w * 0.7, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(0, -0.90 * hh, tank ? 0.13 : 0.105, 0, TAU);
      g.fill();
    }

    g.restore();
  }

  function drawFallbackBoss(x, y, h, type, pose, alpha, flash) {
    var rim = currentTheme === 'night' ? '#A8C6FF' : (currentTheme === 'sunset' ? '#FFB27A' : '#FFE2A0');
    var main, dark, accent;
    if (type === 'butcher') {
      main = '#4C3A35'; dark = '#302320'; accent = '#D9524F';
    } else if (type === 'mother') {
      main = '#4A3B57'; dark = '#2C2237'; accent = '#C77DFF';
    } else {
      main = '#3F4A3E'; dark = '#273026'; accent = '#FF6347';
    }
    var lift = pose ? 0.10 : 0;

    g.save();
    g.translate(x, y);
    g.scale(h, h);
    g.globalAlpha = alpha;

    // 腰腿
    g.fillStyle = dark;
    roundRectPath(-0.22, -0.52, 0.44, 0.52, 0.08);
    g.fill();
    g.fillStyle = '#1A1E1D';
    g.fillRect(-0.20, -0.05, 0.16, 0.05);
    g.fillRect(0.05, -0.05, 0.16, 0.05);

    // 躯干
    g.fillStyle = main;
    g.beginPath();
    g.ellipse ? g.ellipse(0, -0.58, 0.29, 0.34, 0, 0, TAU) : g.arc(0, -0.58, 0.30, 0, TAU);
    g.fill();

    // 巨肩
    g.fillStyle = main;
    g.beginPath();
    g.arc(-0.27, -0.76, 0.16, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(0.27, -0.76, 0.16, 0, TAU);
    g.fill();

    // 手臂
    g.strokeStyle = dark;
    g.lineWidth = 0.13;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-0.30, -0.72);
    g.lineTo(-0.42, -0.50 - lift);
    g.moveTo(0.30, -0.72);
    g.lineTo(0.43, -0.48 - lift);
    g.stroke();

    // 头 / 面罩
    g.fillStyle = dark;
    g.beginPath();
    g.arc(0, -0.96, 0.135, 0, TAU);
    g.fill();
    g.fillStyle = accent;
    g.globalAlpha = alpha * 0.55;
    g.fillRect(-0.09, -0.99, 0.18, 0.03);
    g.globalAlpha = alpha;

    if (type === 'brute') {
      // 背部的钢筋/路障
      g.strokeStyle = '#8D959E';
      g.lineWidth = 0.03;
      g.beginPath();
      g.moveTo(-0.20, -0.74);
      g.lineTo(-0.30, -1.12);
      g.moveTo(0.16, -0.76);
      g.lineTo(0.30, -1.08);
      g.stroke();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(-0.30, -1.12, 0.05, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(0.30, -1.08, 0.045, 0, TAU);
      g.fill();
    } else if (type === 'butcher') {
      // 围裙
      g.fillStyle = 'rgba(206,210,204,0.30)';
      g.beginPath();
      g.moveTo(-0.20, -0.72);
      g.lineTo(0.20, -0.72);
      g.lineTo(0.24, -0.28);
      g.lineTo(-0.24, -0.28);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(140,20,30,0.55)';
      g.beginPath();
      g.arc(0.03, -0.48, 0.07, 0, TAU);
      g.fill();
      // 大砍刀
      g.save();
      g.translate(0.43, -0.70 - lift);
      g.rotate(-0.22);
      g.fillStyle = '#8E99A6';
      g.fillRect(-0.03, -0.35, 0.12, 0.38);
      g.fillStyle = '#3E2C25';
      g.fillRect(-0.02, 0.02, 0.10, 0.16);
      g.restore();
    } else {
      // 母体：背部囊泡与触须
      g.fillStyle = 'rgba(160,90,220,0.45)';
      g.beginPath();
      g.arc(-0.14, -0.70, 0.09, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(0.16, -0.56, 0.11, 0, TAU);
      g.fill();
      g.strokeStyle = '#6B4B84';
      g.lineWidth = 0.045;
      g.beginPath();
      g.moveTo(-0.18, -0.45);
      g.quadraticCurveTo(-0.42, -0.32, -0.30, -0.10);
      g.moveTo(0.20, -0.48);
      g.quadraticCurveTo(0.48, -0.28, 0.34, -0.04);
      g.stroke();
      g.fillStyle = accent;
      g.globalAlpha = alpha * 0.5;
      g.beginPath();
      g.arc(-0.14, -0.70, 0.045, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(0.16, -0.56, 0.05, 0, TAU);
      g.fill();
      g.globalAlpha = alpha;
    }

    // 轮廓光
    g.strokeStyle = hexA(rim, 0.28);
    g.lineWidth = 0.018;
    g.beginPath();
    g.moveTo(-0.29, -0.48);
    g.quadraticCurveTo(-0.36, -0.66, -0.26, -0.78);
    g.stroke();
    g.beginPath();
    g.arc(0, -0.96, 0.14, Math.PI * 0.95, Math.PI * 1.72);
    g.stroke();

    if (flash) {
      g.fillStyle = 'rgba(255,255,255,0.66)';
      g.beginPath();
      g.ellipse ? g.ellipse(0, -0.58, 0.30, 0.35, 0, 0, TAU) : g.arc(0, -0.58, 0.30, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(0, -0.96, 0.135, 0, TAU);
      g.fill();
    }

    g.restore();
  }

  function drawFallbackScenery(name, x, y, h, alpha, seed, side) {
    var p = pal();
    side = side || 1;

    g.save();
    g.translate(x, y);
    g.scale(h, h);
    g.globalAlpha = alpha;

    if (name === 'barrel') {
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath();
      g.ellipse ? g.ellipse(0, 0, 0.34, 0.08, 0, 0, TAU) : g.arc(0, 0, 0.2, 0, TAU);
      g.fill();
      g.fillStyle = '#B63A2A';
      roundRectPath(-0.28, -0.84, 0.56, 0.84, 0.06);
      g.fill();
      g.fillStyle = '#7E2418';
      g.fillRect(-0.28, -0.62, 0.56, 0.07);
      g.fillRect(-0.28, -0.24, 0.56, 0.07);
      g.fillStyle = '#F2C14E';
      g.fillRect(-0.28, -0.50, 0.56, 0.12);
      g.fillStyle = '#2A1410';
      g.beginPath();
      g.arc(0, -0.44, 0.07, 0, TAU);
      g.fill();
      g.fillStyle = '#DDDDDD';
      g.beginPath();
      g.arc(0, -0.44, 0.028, 0, TAU);
      g.fill();
      g.fillStyle = '#8F2E20';
      g.beginPath();
      g.ellipse ? g.ellipse(0, -0.84, 0.28, 0.07, 0, 0, TAU) : g.arc(0, -0.84, 0.2, 0, TAU);
      g.fill();
    } else if (name === 'crate') {
      g.fillStyle = '#7A5230';
      g.fillRect(-0.42, -0.78, 0.84, 0.78);
      g.strokeStyle = '#4C2F19';
      g.lineWidth = 0.05;
      g.strokeRect(-0.42, -0.78, 0.84, 0.78);
      g.beginPath();
      g.moveTo(-0.42, -0.78);
      g.lineTo(0.42, 0);
      g.moveTo(0.42, -0.78);
      g.lineTo(-0.42, 0);
      g.stroke();
      g.fillStyle = '#9B6C3D';
      g.fillRect(-0.42, -0.78, 0.84, 0.10);
    } else if (name === 'medkit') {
      g.fillStyle = '#EFF3F4';
      roundRectPath(-0.38, -0.56, 0.76, 0.50, 0.06);
      g.fill();
      g.fillStyle = '#D8E0E2';
      g.fillRect(-0.38, -0.56, 0.76, 0.09);
      g.fillStyle = '#2ECC71';
      g.fillRect(-0.06, -0.49, 0.12, 0.34);
      g.fillRect(-0.18, -0.36, 0.36, 0.12);
    } else if (name === 'ammo') {
      g.fillStyle = '#4B5532';
      roundRectPath(-0.38, -0.48, 0.76, 0.42, 0.045);
      g.fill();
      g.fillStyle = '#2F3820';
      g.fillRect(-0.38, -0.36, 0.76, 0.05);
      g.fillStyle = '#F4C95D';
      g.fillRect(-0.25, -0.34, 0.10, 0.19);
      g.fillRect(-0.08, -0.36, 0.10, 0.21);
      g.fillRect(0.09, -0.33, 0.10, 0.18);
    } else if (name === 'cone') {
      g.fillStyle = '#E8622A';
      g.beginPath();
      g.moveTo(0, -0.92);
      g.lineTo(0.28, 0);
      g.lineTo(-0.28, 0);
      g.closePath();
      g.fill();
      g.fillStyle = '#F4F0E6';
      g.beginPath();
      g.moveTo(-0.11, -0.58);
      g.lineTo(0.11, -0.58);
      g.lineTo(0.16, -0.40);
      g.lineTo(-0.16, -0.40);
      g.closePath();
      g.fill();
      g.fillStyle = '#C94D1E';
      g.fillRect(-0.32, -0.05, 0.64, 0.05);
    } else if (name === 'sandbag') {
      g.fillStyle = '#8C7A55';
      var bag, bx, by;
      for (bag = 0; bag < 3; bag++) {
        bx = bag === 1 ? -0.10 : 0.10;
        by = -0.15 - bag * 0.22;
        g.beginPath();
        g.ellipse ? g.ellipse(bx, by, 0.34, 0.16, 0, 0, TAU) : g.arc(bx, by, 0.24, 0, TAU);
        g.fill();
      }
      g.strokeStyle = '#6A5A3F';
      g.lineWidth = 0.015;
      g.beginPath();
      g.moveTo(-0.24, -0.34);
      g.lineTo(0.24, -0.34);
      g.stroke();
    } else if (name === 'car') {
      g.fillStyle = '#2D3440';
      g.beginPath();
      g.moveTo(-0.46, 0);
      g.lineTo(-0.44, -0.44);
      g.lineTo(-0.22, -0.70);
      g.lineTo(0.24, -0.70);
      g.lineTo(0.45, -0.44);
      g.lineTo(0.46, 0);
      g.closePath();
      g.fill();
      g.fillStyle = '#1A202A';
      g.beginPath();
      g.moveTo(-0.20, -0.48);
      g.lineTo(-0.10, -0.65);
      g.lineTo(0.16, -0.65);
      g.lineTo(0.27, -0.48);
      g.closePath();
      g.fill();
      g.fillStyle = '#FF445F';
      g.fillRect(-0.38, -0.34, 0.12, 0.06);
      g.fillRect(0.26, -0.34, 0.12, 0.06);
      g.fillStyle = '#0F1319';
      g.fillRect(-0.48, -0.15, 0.12, 0.15);
      g.fillRect(0.36, -0.15, 0.12, 0.15);
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(-0.44, -0.42, 0.88, 0.03);
    } else if (name === 'lamp') {
      g.strokeStyle = '#343B46';
      g.lineWidth = 0.055;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -0.95);
      g.quadraticCurveTo(0, -1.01, side * 0.16, -1.01);
      g.stroke();
      g.fillStyle = '#4A525F';
      g.fillRect(-0.05, -0.07, 0.10, 0.07);
      g.fillStyle = '#FFD08A';
      g.beginPath();
      g.ellipse ? g.ellipse(side * 0.17, -0.98, 0.075, 0.045, 0, 0, TAU) : g.arc(side * 0.17, -0.98, 0.05, 0, TAU);
      g.fill();
    } else if (name === 'billboard') {
      g.strokeStyle = '#3C424C';
      g.lineWidth = 0.045;
      g.beginPath();
      g.moveTo(-0.18, 0);
      g.lineTo(-0.18, -0.62);
      g.moveTo(0.18, 0);
      g.lineTo(0.18, -0.62);
      g.stroke();
      g.fillStyle = '#161C26';
      roundRectPath(-0.48, -0.98, 0.96, 0.42, 0.035);
      g.fill();
      g.strokeStyle = (seed % 2 === 0) ? p.neon : p.danger;
      g.lineWidth = 0.02;
      roundRectPath(-0.48, -0.98, 0.96, 0.42, 0.035);
      g.stroke();
      g.fillStyle = hexA(p.neon, 0.35);
      g.fillRect(-0.36, -0.86, 0.52, 0.05);
      g.fillRect(-0.36, -0.76, 0.34, 0.04);
      g.fillStyle = hexA(p.danger, 0.30);
      g.fillRect(-0.36, -0.66, 0.42, 0.035);
    } else if (name === 'banner') {
      g.strokeStyle = '#3C424C';
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -1.02);
      g.stroke();
      g.fillStyle = hexA((seed % 2 === 0) ? p.neon : p.danger, 0.62);
      g.beginPath();
      g.moveTo(0.02, -0.98);
      g.lineTo(0.38, -0.92);
      g.lineTo(0.36, -0.58);
      g.lineTo(0.02, -0.64);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(0.08, -0.84, 0.20, 0.025);
      g.fillRect(0.08, -0.77, 0.15, 0.02);
    } else {
      // fence
      g.strokeStyle = '#5A6470';
      g.lineWidth = 0.05;
      g.beginPath();
      g.moveTo(-0.34, 0);
      g.lineTo(-0.34, -0.62);
      g.moveTo(0.34, 0);
      g.lineTo(0.34, -0.62);
      g.stroke();
      g.strokeStyle = '#414A55';
      g.lineWidth = 0.03;
      g.beginPath();
      g.moveTo(-0.36, -0.48);
      g.lineTo(0.36, -0.48);
      g.moveTo(-0.36, -0.26);
      g.lineTo(0.36, -0.26);
      g.stroke();
    }

    g.restore();
  }

  function drawFallbackWeaponCrate(x, y, h, alpha, tier) {
    var col = TIER_COLORS[clamp(Math.round(num(tier, 3)), 1, 6) - 1];
    var k, bx;

    g.save();
    g.translate(x, y);
    g.scale(h, h);
    g.globalAlpha = alpha;

    // 装甲箱体
    g.fillStyle = '#202830';
    roundRectPath(-0.46, -0.74, 0.92, 0.74, 0.055);
    g.fill();

    // 顶盖 / 金属包边
    g.fillStyle = '#3A4650';
    g.fillRect(-0.46, -0.74, 0.92, 0.11);
    g.fillStyle = '#4B5964';
    g.fillRect(-0.46, -0.63, 0.12, 0.63);
    g.fillRect(0.34, -0.63, 0.12, 0.63);
    g.fillStyle = '#5D6B76';
    g.fillRect(-0.46, -0.63, 0.92, 0.045);
    g.fillRect(-0.46, -0.12, 0.92, 0.05);

    // 等级色环带
    g.fillStyle = col;
    g.globalAlpha = alpha * 0.88;
    g.fillRect(-0.34, -0.55, 0.68, 0.075);
    g.fillRect(-0.34, -0.23, 0.68, 0.035);
    g.globalAlpha = alpha;

    // 中央菱形徽记
    g.save();
    g.translate(0, -0.38);
    g.rotate(Math.PI * 0.25);
    g.fillStyle = col;
    g.fillRect(-0.085, -0.085, 0.17, 0.17);
    g.fillStyle = '#0B1016';
    g.fillRect(-0.036, -0.036, 0.072, 0.072);
    g.restore();

    // 等级刻度（T3 = 0 格，T6 = 3 格）
    g.fillStyle = col;
    for (k = 0; k < (tier - 3); k++) {
      bx = -0.22 + k * 0.16;
      g.fillRect(bx, -0.16, 0.09, 0.045);
    }

    // 底部警示斜纹
    g.fillStyle = '#D9A441';
    g.globalAlpha = alpha * 0.75;
    for (k = 0; k < 3; k++) {
      bx = -0.34 + k * 0.23;
      g.beginPath();
      g.moveTo(bx, -0.06);
      g.lineTo(bx + 0.075, -0.06);
      g.lineTo(bx + 0.13, -0.005);
      g.lineTo(bx + 0.055, -0.005);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = alpha;

    // 铆钉
    g.fillStyle = '#A7B3BD';
    g.beginPath();
    g.arc(-0.37, -0.66, 0.018, 0, TAU);
    g.arc(0.37, -0.66, 0.018, 0, TAU);
    g.arc(-0.37, -0.10, 0.018, 0, TAU);
    g.arc(0.37, -0.10, 0.018, 0, TAU);
    g.fill();

    // 缝隙高光
    g.strokeStyle = hexA(col, 0.55);
    g.lineWidth = 0.014;
    roundRectPath(-0.44, -0.72, 0.88, 0.70, 0.045);
    g.stroke();

    g.restore();
  }

  function drawFallbackGateIcon(kind, x, y, size, color, good) {
    var s = size;
    g.save();
    g.translate(x, y);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineWidth = Math.max(1.2, s * 0.08);
    g.lineCap = 'round';
    g.lineJoin = 'round';

    if (kind === 'weapon') {
      g.fillRect(-s * 0.44, -s * 0.10, s * 0.70, s * 0.18);
      g.fillRect(-s * 0.12, -s * 0.26, s * 0.20, s * 0.20);
      g.fillRect(s * 0.18, -s * 0.10, s * 0.22, s * 0.10);
      g.fillRect(-s * 0.32, s * 0.08, s * 0.14, s * 0.28);
    } else if (kind === 'fireRate') {
      g.beginPath();
      g.moveTo(s * 0.06, -s * 0.52);
      g.lineTo(-s * 0.30, s * 0.02);
      g.lineTo(-s * 0.02, s * 0.02);
      g.lineTo(-s * 0.12, s * 0.52);
      g.lineTo(s * 0.32, -s * 0.10);
      g.lineTo(s * 0.04, -s * 0.10);
      g.closePath();
      g.fill();
    } else if (kind === 'multiply' || kind === 'divide') {
      setFont(s * 0.78, 900, FONT_UI);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind === 'multiply' ? '×' : '÷', 0, -s * 0.02);
    } else if (kind === 'people') {
      g.beginPath();
      g.arc(-s * 0.18, -s * 0.22, s * 0.13, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(s * 0.16, -s * 0.28, s * 0.10, 0, TAU);
      g.fill();
      roundRectPath(-s * 0.36, -s * 0.06, s * 0.36, s * 0.44, s * 0.10);
      g.fill();
      roundRectPath(s * 0.02, -s * 0.10, s * 0.30, s * 0.38, s * 0.08);
      g.fill();
    } else {
      g.beginPath();
      g.moveTo(0, -s * 0.42);
      g.lineTo(s * 0.34, 0);
      g.lineTo(0, s * 0.42);
      g.lineTo(-s * 0.34, 0);
      g.closePath();
      g.fill();
      if (!good) {
        g.fillStyle = '#200A10';
        g.fillRect(-s * 0.025, -s * 0.20, s * 0.05, s * 0.24);
        g.beginPath();
        g.arc(0, s * 0.17, s * 0.035, 0, TAU);
        g.fill();
      }
    }
    g.restore();
  }

  /* ==========================================================
   * 天空整体
   * ========================================================== */
  function drawSky() {
    ensureSky();
    g.fillStyle = skyCache.sky;
    g.fillRect(0, 0, vw, horizonY + vh * 0.12);
    drawStars();
    drawSun();
    drawClouds();
  }

  function drawBirds() {
    if (currentTheme === 'night') return;
    var k, x, y, flap, dir;
    g.save();
    g.strokeStyle = currentTheme === 'sunset' ? hexA('#3A2340', 0.65) : hexA('#29435C', 0.55);
    g.lineWidth = Math.max(1, 1.5 * viewScale);
    g.lineCap = 'round';
    for (k = 0; k < 3; k++) {
      x = ((time * (5 + k * 1.5) + k * 173 + scrollDist * 0.15) % (vw + 180)) - 90;
      y = horizonY * (0.22 + hash(k * 7 + 3) * 0.34);
      flap = Math.sin(time * 6 + k * 1.8) * 4 * viewScale;
      dir = k % 2 ? 1 : -1;
      g.beginPath();
      g.moveTo(x - 7 * viewScale, y + flap);
      g.quadraticCurveTo(x - 3 * viewScale, y - 3 * viewScale, x, y);
      g.quadraticCurveTo(x + 3 * viewScale, y - 3 * viewScale, x + 7 * viewScale, y + flap);
      g.stroke();
      if (dir > 0) {
        g.globalAlpha = 0.6;
        g.beginPath();
        g.moveTo(x + 26 * viewScale - 5 * viewScale, y + 8 * viewScale + flap * 0.7);
        g.quadraticCurveTo(x + 26 * viewScale, y + 6 * viewScale, x + 26 * viewScale + 5 * viewScale, y + 8 * viewScale + flap * 0.7);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }

  function drawMotes() {
    var k, x, y, a, r;
    g.save();
    g.fillStyle = currentTheme === 'night' ? '#9CC4FF' : '#FFE9B0';
    for (k = 0; k < 20; k++) {
      x = ((hash(k * 13 + 2) * vw + time * (2 + hash(k * 5 + 1) * 5) * (k % 2 ? 1 : -1)) % (vw + 40) + vw + 40) % (vw + 40) - 20;
      y = horizonY + hash(k * 17 + 9) * (vh - horizonY) * 0.92;
      a = 0.10 + 0.22 * Math.abs(Math.sin(time * 0.8 + k * 1.4));
      r = 1 + hash(k * 23 + 11) * 1.8;
      g.globalAlpha = a;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  /* ==========================================================
   * 标题页环境场景（state 为 null）
   * ========================================================== */
  function drawAmbientScene(dt) {
    var dist = ambientDist;
    var k, sx, sy, targetH, variant, frame, bob, spr, drew, alpha;

    drawSky();
    drawBirds();
    drawSkyline(dist);
    drawGroundBase();

    buildScenery(dist);
    drawScenery(true);
    drawRoad(dist);
    drawScenery(false);

    // 道路尽头的微弱车灯 / 战斗余光
    softGlow(cx + roadHalf * 0.10, horizonY + vh * 0.09, 36 * viewScale, '#FF8A5C', 0.20);
    softGlow(cx - roadHalf * 0.16, horizonY + vh * 0.08, 26 * viewScale, '#FFE0A8', 0.16);

    // 小队剪影
    for (k = 17; k >= 0; k--) {
      var row = Math.floor(k / 6);
      var col = k % 6;
      sx = cx + (col - 2.5) * 28 * viewScale + (row % 2 ? 14 * viewScale : 0);
      sy = vh * 0.858 + row * 14 * viewScale;
      targetH = 56 * viewScale * (1 + row * 0.04);
      bob = Math.sin(time * 4.2 + k * 1.25) * 1.5 * viewScale;
      if (reducedMotion) bob *= 0.2;
      variant = (k * 5 + 1) % 3;
      frame = Math.floor(((time * 4.2 + k * 0.7) % 4 + 4) % 4);
      alpha = 0.84 - row * 0.04;

      shadowEllipse(sx, sy + 1, targetH * 0.22, 0.24);
      spr = getSprite('soldier', variant, frame);
      drew = spr ? drawSpriteFit(spr, sx, sy + bob, targetH, alpha) : false;
      if (!drew) drawFallbackSoldier(sx, sy + bob, targetH, variant, frame, alpha, false);
    }

    // 队伍后的暖色轮廓光
    softGlow(cx, vh * 0.80, vw * 0.30, currentTheme === 'night' ? '#4D6AFF' : '#FFB45C', 0.10);
    drawMotes();
  }

  /* ==========================================================
   * 游戏场景
   * ========================================================== */
  function drawGameScene(state, dt) {
    var dist = num(state.distance, 0);

    drawSky();
    drawSkyline(dist);
    drawGroundBase();

    buildScenery(dist);
    drawScenery(true);
    drawRoad(dist);
    drawScenery(false);

    drawGates(state);
    drawTelegraphs(state);
    drawEntities(state, dist);
    drawSquad(state, dt);
    drawFX();
    drawSpeedLines(state);
    drawMotes();
  }

  /* ==========================================================
   * 事件 -> 表现
   * ========================================================== */
  function eventPoint(x, d, state) {
    var dist = num(state && state.distance, 0);
    var z = num(d, dist + 6) - dist;
    if (!isFinite(z)) z = 6;
    z = clamp(z, MIN_DEPTH, MAX_DEPTH);
    var sc = depthScale(z);
    return {
      x: screenX(clamp(num(x, 0), -1.6, 1.6), sc),
      y: screenY(sc),
      s: sc
    };
  }

  RoadRender.emitEvents = function (events, state) {
    if (!g || !events || !events.length) return;

    var k, ev, type, pt, lead, col, color, score, side, px, py, j, amount;
    var p = pal();

    for (k = 0; k < events.length; k++) {
      ev = events[k];
      if (!ev || !ev.type) continue;
      type = ev.type;

      if (type === 'shot') {
        lead = playerScreen(state);
        px = lead.x + 4 * viewScale;
        py = lead.y - 55 * viewScale;
        var shotTier = clamp(Math.round(num(ev.tier, 1)), 1, 6);
        var flashScale = shotTier >= 5 ? 1.35 : (shotTier >= 4 ? 1.15 : 1);
        muzzleTier = shotTier;
        muzzleTimer = shotTier >= 4 ? 0.11 : 0.075;
        fireKick = Math.min(1, fireKick + (shotTier >= 4 ? 0.95 : 0.46));
        spawnP(px, py, 0, -8, 0.075, 11 * viewScale * flashScale, '#FFF0B0', 0, 0, 2);
        spawnP(px, py, 30 * viewScale, -36 * viewScale, 0.16, 3 * viewScale * flashScale, TIER_COLORS[shotTier - 1], 1, 40, 1.5);
        spawnP(px, py, -24 * viewScale, -44 * viewScale, 0.13, 2.4 * viewScale * flashScale, '#FFD87A', 1, 40, 1.5);
        if (shotTier <= 3) {
          // 弹壳抛出，轻武器连射时更有节奏感。
          spawnP(px - 12 * viewScale, py + 10 * viewScale,
            (26 + hash(k * 19) * 34) * viewScale,
            (-70 - hash(k * 23) * 40) * viewScale,
            0.38, 2 * viewScale, '#E8C36A', 0, 420, 0.7);
        }
      } else if (type === 'hit') {
        pt = eventPoint(ev.x, ev.d, state);
        color = ev.kind === 'prop' ? '#FFB15C' : '#FFE7B0';
        for (j = 0; j < 4; j++) {
          col = (j % 2 === 0) ? color : '#FF8A5C';
          spawnP(pt.x, pt.y - 26 * pt.s * viewScale,
            (hash(k * 17 + j) - 0.5) * 140 * pt.s * viewScale,
            (-20 - hash(k * 31 + j) * 90) * pt.s * viewScale,
            0.22 + hash(k * 7 + j) * 0.18,
            (1.6 + hash(k * 5 + j) * 2.6) * pt.s * viewScale,
            col, 1, 280, 1.2);
        }
        var hitTier = clamp(Math.round(num(state && state.weaponLevel, 1)), 1, 6);
        addRing(pt.x, pt.y - 26 * pt.s * viewScale, 2, 26 * pt.s * viewScale,
          TIER_COLORS[hitTier - 1], 0.24, 2, true);
      } else if (type === 'kill') {
        pt = eventPoint(ev.x, ev.d, state);
        score = ev.kind === 'tank' ? 50 : (ev.kind === 'runner' ? 15 : 10);
        for (j = 0; j < 12; j++) {
          spawnP(pt.x, pt.y - 26 * pt.s * viewScale,
            (hash(k * 23 + j) - 0.5) * 190 * pt.s * viewScale,
            (-35 - hash(k * 41 + j) * 150) * pt.s * viewScale,
            0.34 + hash(k * 11 + j) * 0.32,
            (2 + hash(k * 3 + j) * 4) * Math.max(0.5, pt.s * viewScale),
            (j % 3 === 0) ? '#E0485C' : (j % 3 === 1 ? '#9D1D2B' : '#5C1018'),
            0, 480, 1.4);
        }
        spawnP(pt.x, pt.y - 10 * pt.s * viewScale, 0, 0, 0.34, 7 * pt.s * viewScale, 'rgba(86,10,18,0.7)', 3, 0, 0);
        addText('+' + score, pt.x, pt.y - 46 * pt.s * viewScale, '#FFE9A8', Math.max(12, 17 * viewScale), 0.62, -52, 900);
        shakeA = Math.max(shakeA, reducedMotion ? 0.6 : 2.2);
      } else if (type === 'hurt') {
        amount = Math.max(1, Math.round(num(ev.amount, 1)));
        lead = playerScreen(state);
        flashColor = '#FF1E3C';
        flashA = Math.max(flashA, reducedMotion ? 0.16 : 0.42);
        shakeA = Math.max(shakeA, reducedMotion ? 2 : 10);
        addText('-' + amount, lead.x - 30 * viewScale, lead.y - 64 * viewScale, '#FF7A8A', 23 * viewScale, 0.8, -58, 900);
        addRing(lead.x, lead.y, 20 * viewScale, 80 * viewScale, '#FF3D5A', 0.4, 3, true);
        for (j = 0; j < 8; j++) {
          spawnP(lead.x + (hash(k * 13 + j) - 0.5) * 46 * viewScale,
            lead.y - 42 * viewScale,
            (hash(k * 17 + j) - 0.5) * 120 * viewScale,
            (-30 - hash(k * 29 + j) * 90) * viewScale,
            0.3 + hash(k * 7 + j) * 0.22,
            (2 + hash(k * 5 + j) * 3) * viewScale,
            '#C51E39', 0, 440, 1.5);
        }
      } else if (type === 'gate') {
        side = ev.side === 'left' ? -1 : 1;
        px = cx + side * roadHalf * 0.34;
        py = vh * 0.862 - 54 * viewScale;
        col = ev.good ? '#5CFFD0' : '#FF5A78';
        flashColor = col;
        flashA = Math.max(flashA, reducedMotion ? 0.10 : 0.26);
        shakeA = Math.max(shakeA, reducedMotion ? 0.8 : 3);
        addText(ev.label || (ev.good ? '增益' : '风险'), px, py, col, 30 * viewScale, 1.05, -58, 900);
        addRing(px, vh * 0.882, 18 * viewScale, 130 * viewScale, col, 0.55, 4, true);
        for (j = 0; j < 18; j++) {
          spawnP(px + (hash(k * 31 + j) - 0.5) * 100 * viewScale,
            vh * 0.86 + (hash(k * 43 + j) - 0.5) * 20 * viewScale,
            (hash(k * 11 + j) - 0.5) * 170 * viewScale,
            (-60 - hash(k * 19 + j) * 210) * viewScale,
            0.42 + hash(k * 5 + j) * 0.4,
            (2 + hash(k * 7 + j) * 4) * viewScale,
            ev.good ? (j % 2 ? col : '#FFFFFF') : (j % 2 ? col : '#FFD0D8'),
            1, 160, 1.4);
        }
      } else if (type === 'explode') {
        pt = eventPoint(ev.x, ev.d, state);
        addBoom(pt.x, pt.y - 38 * pt.s * viewScale, 126 * pt.s * viewScale);
        addRing(pt.x, pt.y, 10 * pt.s * viewScale, 110 * pt.s * viewScale, '#FFB24D', 0.5, 4, true);
        addRing(pt.x, pt.y, 4, 56 * pt.s * viewScale, '#FFFFFF', 0.26, 2, false);
        flashColor = '#FF9A3D';
        flashA = Math.max(flashA, reducedMotion ? 0.08 : 0.20);
        shakeA = Math.max(shakeA, reducedMotion ? 2 : 7);
        for (j = 0; j < 12; j++) {
          spawnP(pt.x + (hash(k * 17 + j) - 0.5) * 60 * pt.s * viewScale,
            pt.y - 24 * pt.s * viewScale,
            (hash(k * 23 + j) - 0.5) * 150 * pt.s * viewScale,
            (-40 - hash(k * 29 + j) * 150) * pt.s * viewScale,
            0.4 + hash(k * 7 + j) * 0.45,
            (4 + hash(k * 5 + j) * 7) * Math.max(0.5, pt.s * viewScale),
            (j % 2) ? 'rgba(92,90,86,0.55)' : '#FFB24D', 2, -20, 1.0);
        }
      } else if (type === 'pickup') {
        pt = eventPoint(ev.x, ev.d, state);
        if (ev.kind === 'weapon') {
          var wtier = clamp(Math.round(num(ev.value, 4)), 1, 6);
          var wcolor = TIER_COLORS[wtier - 1];
          var wlabel = ev.label || ('T' + wtier);
          addText(wlabel, pt.x, pt.y - 60 * pt.s * viewScale, wcolor, 30 * viewScale, 1.15, -54, 900);
          addRing(pt.x, pt.y, 14, 104 * pt.s * viewScale, wcolor, 0.62, 4, true);
          addRing(pt.x, pt.y, 4, 58 * pt.s * viewScale, '#FFFFFF', 0.32, 2, false);
          flashColor = wcolor;
          flashA = Math.max(flashA, reducedMotion ? 0.10 : 0.24);
          shakeA = Math.max(shakeA, reducedMotion ? 0.8 : 3.5);
          for (j = 0; j < 16; j++) {
            spawnP(pt.x + (hash(k * 23 + j) - 0.5) * 34 * pt.s * viewScale,
              pt.y - 22 * pt.s * viewScale + (hash(k * 29 + j) - 0.5) * 20 * pt.s * viewScale,
              (hash(k * 13 + j) - 0.5) * 170 * pt.s * viewScale,
              (-50 - hash(k * 31 + j) * 150) * pt.s * viewScale,
              0.38 + hash(k * 17 + j) * 0.38,
              (1.8 + hash(k * 3 + j) * 3.6) * Math.max(0.5, pt.s * viewScale),
              (j % 3 === 0) ? '#FFFFFF' : wcolor, 1, 170, 1.35);
          }
        } else {
          color = ev.kind === 'ammo' ? '#FFD166' : '#5CFFA6';
          addText(ev.kind === 'ammo' ? '+射速' : '+8 人', pt.x, pt.y - 44 * pt.s * viewScale, color, 20 * viewScale, 0.8, -48, 900);
          addRing(pt.x, pt.y, 8, 52 * pt.s * viewScale, color, 0.38, 2, true);
          for (j = 0; j < 10; j++) {
            spawnP(pt.x, pt.y - 18 * pt.s * viewScale,
              (hash(k * 13 + j) - 0.5) * 100 * pt.s * viewScale,
              (-30 - hash(k * 31 + j) * 100) * pt.s * viewScale,
              0.3 + hash(k * 17 + j) * 0.28,
              (1.6 + hash(k * 3 + j) * 3) * Math.max(0.5, pt.s * viewScale),
              color, 1, 140, 1.4);
          }
        }
      } else if (type === 'bossSpawn') {
        flashColor = '#FF3D5A';
        flashA = Math.max(flashA, reducedMotion ? 0.14 : 0.30);
        shakeA = Math.max(shakeA, reducedMotion ? 3 : 13);
        bossPoseTimer = 1.2;
        addText(ev.name || 'BOSS 来袭', cx, vh * 0.42, '#FF7A8A', 28 * viewScale, 1.4, -24, 900);
        addRing(cx, vh * 0.72, 30 * viewScale, 190 * viewScale, '#FF3D5A', 0.7, 4, true);
      } else if (type === 'bossAttack') {
        var wind = Math.max(0.3, num(ev.windup, 0.95));
        var telKind = (ev.kind === 'rain' || ev.kind === 'summon') ? 'acid' : (ev.kind || 'slam');
        var atkX = (telKind === 'acid') ? num(state && state.x, 0) : num(ev.x, 0);
        var atkZ = (telKind === 'acid') ? 8 : num(state && state.boss ? state.boss.d - state.distance : 18, 18);
        addTele(telKind, atkX, atkZ, wind + 0.12);
        bossPoseTimer = Math.max(0.8, wind + 0.15);
        shakeA = Math.max(shakeA, reducedMotion ? 0.8 : 3.5);
      } else if (type === 'bossStrike') {
        var strikeType = ev.kind || 'slam';
        var stX = (strikeType === 'acid' || strikeType === 'rain') ? num(state && state.x, 0) : num(ev.x, 0);
        var stZ = num(state && state.boss ? state.boss.d - state.distance : 18, 18);
        var stSc = depthScale(clamp(stZ, MIN_DEPTH, MAX_DEPTH));
        var stPX = screenX(stX, stSc);
        var stPY = screenY(stSc);
        var stCol = (strikeType === 'acid' || strikeType === 'rain') ? '#9DFF4D' : '#FF5A3C';
        addRing(stPX, stPY, 14 * viewScale, (strikeType === 'charge' ? 190 : 125) * stSc * viewScale, stCol, 0.55, 4, true);
        addRing(stPX, stPY, 4, 62 * stSc * viewScale, '#FFFFFF', 0.28, 2, false);
        var strikeName = strikeType === 'slam' ? '重击'
          : (strikeType === 'charge' ? '冲锋'
          : (strikeType === 'rain' ? '酸雨'
          : (strikeType === 'summon' ? '召唤'
          : (strikeType === 'cleaver' ? '飞锯' : '酸液'))));
        addText(strikeName, stPX, stPY - 62 * viewScale, stCol,
          Math.max(14, 19 * viewScale), 0.55, -44, 900);
        flashColor = stCol;
        flashA = Math.max(flashA, reducedMotion ? 0.10 : 0.22);
        shakeA = Math.max(shakeA, reducedMotion ? 2 : 9);
        bossPoseTimer = 0.65;
        for (j = 0; j < 10; j++) {
          spawnP(stPX + (hash(k * 13 + j) - 0.5) * 90 * viewScale,
            stPY - 6 * viewScale,
            (hash(k * 17 + j) - 0.5) * 170 * viewScale,
            (-24 - hash(k * 29 + j) * 100) * viewScale,
            0.3 + hash(k * 7 + j) * 0.28,
            (2 + hash(k * 5 + j) * 4) * Math.max(0.6, stSc * viewScale),
            (j % 2) ? stCol : '#FFE0A0', 0, 420, 1.5);
        }
      } else if (type === 'bossHit') {
        pt = eventPoint(ev.x, ev.d, state);
        for (j = 0; j < 7; j++) {
          spawnP(pt.x, pt.y - 80 * pt.s * viewScale,
            (hash(k * 19 + j) - 0.5) * 230 * pt.s * viewScale,
            (-20 - hash(k * 37 + j) * 150) * pt.s * viewScale,
            0.25 + hash(k * 7 + j) * 0.28,
            (2 + hash(k * 5 + j) * 3) * Math.max(0.6, pt.s * viewScale),
            (j % 2) ? '#FFE9A8' : '#FF7A5C', 1, 220, 1.2);
        }
        shakeA = Math.max(shakeA, reducedMotion ? 0.5 : 1.8);
      } else if (type === 'win') {
        flashColor = '#FFE08A';
        flashA = Math.max(flashA, reducedMotion ? 0.22 : 0.72);
        shakeA = Math.max(shakeA, reducedMotion ? 1 : 5);
        addRing(cx, vh * 0.64, 20 * viewScale, 260 * viewScale, '#FFE08A', 0.8, 5, true);
        for (j = 0; j < 24; j++) {
          spawnP(cx + (hash(k * 13 + j) - 0.5) * vw * 0.45,
            vh * 0.62 + (hash(k * 23 + j) - 0.5) * vh * 0.16,
            (hash(k * 29 + j) - 0.5) * 180 * viewScale,
            (-80 - hash(k * 31 + j) * 190) * viewScale,
            0.7 + hash(k * 7 + j) * 0.6,
            (2 + hash(k * 3 + j) * 4) * viewScale,
            (j % 3 === 0) ? '#FFFFFF' : (j % 3 === 1 ? '#FFD166' : '#FF8A5C'),
            1, 130, 1.1);
        }
      } else if (type === 'dead') {
        flashColor = '#C31230';
        flashA = Math.max(flashA, reducedMotion ? 0.24 : 0.72);
        shakeA = Math.max(shakeA, reducedMotion ? 2 : 12);
        addRing(cx, vh * 0.78, 20 * viewScale, 230 * viewScale, '#FF3D5A', 0.8, 5, true);
      }
      // 未知事件安全忽略
    }
  };

  /* ==========================================================
   * 主绘制
   * ========================================================== */
  RoadRender.draw = function (state, dt) {
    if (!g) return;

    dt = clamp(num(dt, 0), 0, 0.08);
    time += dt;
    updateFX(dt);

    if (state) {
      currentTheme = (state.theme === 'sunset' || state.theme === 'night' || state.theme === 'day') ? state.theme : 'day';
      scrollDist = num(state.distance, 0);
    } else {
      currentTheme = 'day';
      ambientDist += (10 + Math.sin(time * 0.23) * 2.4) * dt * (reducedMotion ? 0.35 : 1);
      scrollDist = ambientDist;
    }

    if (!vw || !vh) return;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = PALETTES[currentTheme].skyTop;
    g.fillRect(0, 0, vw, vh);

    g.save();

    if (shakeA > 0.05) {
      var mul = reducedMotion ? 0.18 : 1;
      g.translate(Math.sin(time * 91) * shakeA * mul, Math.cos(time * 73) * shakeA * 0.7 * mul);
    }

    if (state) drawGameScene(state, dt);
    else drawAmbientScene(dt);

    g.restore();

    drawOverlays(state);
  };

})(typeof window !== 'undefined' ? window : this);
