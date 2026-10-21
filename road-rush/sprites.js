/* ============================================================
   公路突围 / Road Rush — 程序化卡通精灵图集 (window.RoadSprites)
   全部美术由 Canvas 2D 提前烘焙到离屏画布，运行时只做 drawImage。
   无外部图片 / 字体 / CDN。确定性绘制，不使用 Math.random。
   传统 IIFE / ES5，加载后即可使用。
   ============================================================ */
(function () {
  'use strict';

  var RoadSprites = {};
  window.RoadSprites = RoadSprites;

  // -------------------------------------------------------------
  // 调色板
  // -------------------------------------------------------------
  var PAL = {
    outline: '#1B2430',
    blue: '#2F80ED',
    cyan: '#56CCF2',
    walker: '#7BC96F',
    runner: '#D7E36B',
    tank: '#9B6BFF',
    brute: '#C44569',
    bruteAccent: '#FF9F1C',
    butcher: '#E63946',
    mother: '#9D4EDD',
    hazard: '#E63946',
    wood: '#B07A45',
    metal: '#6B7A8F',
    gold: '#F2C94C',
    cream: '#FFF4DC',
    paper: '#F7EED8',
    white: '#FFFFFF',
    skin: '#F2C9A0',
    skinWarm: '#E8A07E',
    navy: '#24354D',
    shirt: '#4A5568',
    concrete: '#B8BFC6',
    olive: '#6B7A45',
    smoke: '#4B5563',
    darkGreen: '#2F6B3A'
  };
  RoadSprites.palette = PAL;

  var PAD = 2;                 // 逻辑内边距，防止描边/发光被裁切
  var dpr = 1;                 // 设备像素比（上限 2）
  var cache = Object.create(null);

  // -------------------------------------------------------------
  // 基础工具
  // -------------------------------------------------------------
  function clampInt(v, lo, hi) {
    v = Math.floor(+v || 0);
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function normHex(hex) {
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return h;
  }

  function rgba(hex, a) {
    var h = normHex(hex);
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // amt > 0 提亮，amt < 0 压暗
  function shade(hex, amt) {
    var h = normHex(hex);
    var n = parseInt(h, 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) {
      r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt;
    } else {
      r *= 1 + amt; g *= 1 + amt; b *= 1 + amt;
    }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  // 稳定伪随机：用于天际线等大面积细节，种子固定，结果完全确定
  function prng(seed) {
    seed = (seed | 0) || 1;
    return function () {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }

  // -------------------------------------------------------------
  // 绘制小工具（烘焙期使用）
  // -------------------------------------------------------------
  function rrPath(g, x, y, w, h, r) {
    r = Math.min(r == null ? 3 : r, w * 0.5, h * 0.5);
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

  function box(g, x, y, w, h, r, fill, lw) {
    rrPath(g, x, y, w, h, r);
    if (fill != null) { g.fillStyle = fill; g.fill(); }
    if (lw) { g.strokeStyle = PAL.outline; g.lineWidth = lw; g.stroke(); }
  }

  function ell(g, cx, cy, rx, ry, rot, fill, lw) {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2);
    if (fill != null) { g.fillStyle = fill; g.fill(); }
    if (lw) { g.strokeStyle = PAL.outline; g.lineWidth = lw; g.stroke(); }
  }

  function poly(g, pts, fill, lw) {
    var i;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill != null) { g.fillStyle = fill; g.fill(); }
    if (lw) { g.strokeStyle = PAL.outline; g.lineWidth = lw; g.stroke(); }
  }

  function line(g, x1, y1, x2, y2, color, lw) {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.stroke();
  }

  function capsule(g, x1, y1, x2, y2, w, fill, lw) {
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (lw) {
      g.strokeStyle = PAL.outline;
      g.lineWidth = w + lw * 2;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
    g.strokeStyle = fill;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  }

  // 柔和椭圆地面阴影（宽扁，避免“悬浮球”感）
  function ground(g, cx, cy, rx, ry) {
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    var grd = g.createRadialGradient(0, 0, rx * 0.12, 0, 0, rx);
    grd.addColorStop(0, 'rgba(11,17,27,0.30)');
    grd.addColorStop(0.55, 'rgba(11,17,27,0.15)');
    grd.addColorStop(1, 'rgba(11,17,27,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // 圆角斜纹矩形（路障 / 危险条纹）
  function stripedRect(g, x, y, w, h, r, base, stripe, step, lw) {
    rrPath(g, x, y, w, h, r);
    g.fillStyle = base;
    g.fill();
    g.save();
    rrPath(g, x, y, w, h, r);
    g.clip();
    for (var i = -h - step; i < w + h + step; i += step * 2) {
      poly(g, [[x + i, y + h], [x + i + step, y + h], [x + i + step + h, y], [x + i + h, y]], stripe, 0);
    }
    g.restore();
    rrPath(g, x, y, w, h, r);
    g.strokeStyle = PAL.outline;
    g.lineWidth = lw;
    g.stroke();
  }

  // 不规则多边形条纹（Boss 肩甲）
  function stripedPoly(g, pts, base, stripe, step, lw) {
    var i, minX = 9999, maxX = -9999, minY = 9999, maxY = -9999;
    poly(g, pts, base, 0);
    g.save();
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.clip();
    for (i = 0; i < pts.length; i++) {
      if (pts[i][0] < minX) minX = pts[i][0];
      if (pts[i][0] > maxX) maxX = pts[i][0];
      if (pts[i][1] < minY) minY = pts[i][1];
      if (pts[i][1] > maxY) maxY = pts[i][1];
    }
    for (var s = minX - 40; s < maxX + 40; s += step * 2) {
      poly(g, [[s, maxY + 6], [s + step, maxY + 6], [s + step + 70, minY - 6], [s + 70, minY - 6]], stripe, 0);
    }
    g.restore();
    poly(g, pts, null, lw);
  }

  // 星形 / 放射爆炸形
  function starPath(g, cx, cy, spikes, outer, inner, rot) {
    var i, a, r, x, y;
    g.beginPath();
    for (i = 0; i < spikes * 2; i++) {
      a = (rot || 0) + (i / (spikes * 2)) * Math.PI * 2;
      r = (i % 2 === 0) ? outer : inner;
      x = cx + Math.cos(a) * r;
      y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  }

  // -------------------------------------------------------------
  // 缓存 / 烘焙 / 绘制
  // -------------------------------------------------------------
  function configure(s) {
    s = +s || 1;
    if (s > 2) s = 2;
    if (s < 1) s = 1;
    if (s !== dpr) {
      dpr = s;
      cache = Object.create(null);
    }
  }
  RoadSprites.configure = configure;

  RoadSprites.clear = function () {
    cache = Object.create(null);
  };

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * dpr));
    c.height = Math.max(1, Math.ceil(h * dpr));
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    return { cv: c, g: g };
  }

  function bake(key, w, h, ox, oy, paint) {
    var hit = cache[key];
    if (hit) return hit;
    var c = newCanvas(w, h);
    paint(c.g, w, h);
    var spr = {
      cv: c.cv,
      w: w,
      h: h,
      ox: ox == null ? w / 2 : ox,
      oy: oy == null ? h / 2 : oy
    };
    cache[key] = spr;
    return spr;
  }

  function bakeBottom(key, w, h, paint) {
    return bake(key, w, h, w / 2, h, paint);
  }

  function bakeCenter(key, w, h, paint) {
    return bake(key, w, h, w / 2, h / 2, paint);
  }

  // 以 (x,y) 为锚点绘制；角色/道具为底部中心，弹道/特效为中心
  function draw(ctx, spr, x, y, scale, alpha, rot) {
    if (!spr || !spr.cv) return;
    scale = scale == null ? 1 : +scale;
    if (!(scale > 0)) return;
    alpha = alpha == null ? 1 : +alpha;
    if (!(alpha > 0)) return;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha *= alpha;
    var w = spr.w * scale, h = spr.h * scale;
    if (rot) {
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(spr.cv, -spr.ox * scale, -spr.oy * scale, w, h);
    } else {
      ctx.drawImage(spr.cv, x - spr.ox * scale, y - spr.oy * scale, w, h);
    }
    ctx.restore();
  }
  RoadSprites.draw = draw;

  // =============================================================
  // 角色：士兵（背面 3/4 奔跑）
  // =============================================================
  var SOLDIER_GAIT = [
    { bob: 0, lx: -5, ly: 0, rx: 4, ry: -3, aim: 0 },
    { bob: -2, lx: -1, ly: -1, rx: 1, ry: -5, aim: 0.8 },
    { bob: 0, lx: 4, ly: -3, rx: -5, ry: 0, aim: 0.2 },
    { bob: -2, lx: 1, ly: -5, rx: -1, ry: -1, aim: 0.5 }
  ];

  // 枪身角度：负值 = 朝画面上方偏右。恒定角度保证跑动中枪口不左右甩。
  var GUN_ANG = -1.22;
  var GUN_COS = Math.cos(GUN_ANG);
  var GUN_SIN = Math.sin(GUN_ANG);

  function gunPoint(lx, ly, aim) {
    return {
      x: 42 + lx * GUN_COS - ly * GUN_SIN,
      y: 52 + aim + lx * GUN_SIN + ly * GUN_COS
    };
  }

  function soldierRifle(g, aim) {
    g.save();
    g.translate(42, 52 + aim);
    g.rotate(GUN_ANG);

    // 枪托压在右肩/背包边，加厚以强化步枪识别
    poly(g, [[-11, 0], [-3, -5], [1, -3.2], [1, 3.2], [-3, 5]], PAL.wood, 2.2);
    box(g, -11.5, -4.2, 2.6, 8.4, 0.8, PAL.outline, 0);
    line(g, -8, -3.2, -2.5, -3.2, shade(PAL.wood, 0.3), 1.2);

    // 机匣
    box(g, -2, -5, 16, 10, 2.4, '#5E7186', 2.4);
    box(g, 0.5, -6.5, 8.5, 2.3, 0.8, PAL.metal, 1.6);
    box(g, 2, -2.1, 5.2, 3.5, 0.8, '#2B3A4A', 0);
    box(g, 3.6, 4.4, 5, 7.4, 1, '#2B3A4A', 1.8);
    line(g, 1, -4.1, 12, -4.1, 'rgba(255,255,255,0.45)', 1.2);
    line(g, 2, 3.8, 8.5, 3.8, rgba(PAL.cyan, 0.55), 1);

    // 护木 + 青色队标
    box(g, 13, -4, 11, 8, 2.2, shade(PAL.metal, 0.1), 2.4);
    box(g, 15.4, -4.2, 3.4, 8.4, 0.8, PAL.cyan, 1.2);
    line(g, 14.5, -3.2, 22.5, -3.2, 'rgba(255,255,255,0.35)', 1.1);

    // 长枪管 + 准星 + 金色枪口箍
    box(g, 23, -2.9, 17, 5.8, 1.5, '#566B80', 2.2);
    line(g, 24.5, -2.2, 38, -2.2, 'rgba(255,255,255,0.35)', 1.1);
    box(g, 25, -4.9, 3, 2.2, 0.6, PAL.metal, 1.4);
    poly(g, [[32, -2.7], [34, -7], [36, -2.7]], PAL.metal, 1.8);
    box(g, 39, -4.1, 3.4, 8.2, 1, PAL.gold, 2);
    box(g, 42.2, -3.3, 3.2, 6.6, 1, '#2B3A4A', 1.8);
    line(g, 43, -1, 44.7, -1, PAL.cream, 1.1);
    g.restore();
  }

  function soldierLeg(g, hipX, hipY, footX, lift, base) {
    var kneeX = hipX + (footX - hipX) * 0.45;
    var kneeY = hipY + 10;
    var ankleY = base - 8 + lift;
    capsule(g, hipX, hipY, kneeX, kneeY, 9.5, PAL.navy, 2.2);
    capsule(g, kneeX, kneeY, footX, ankleY, 8.2, PAL.navy, 2.2);
    box(g, footX - 6.8, ankleY - 1, 13.6, 9, 3, PAL.outline, 0);
    box(g, footX - 6.8, ankleY - 1, 13.6, 6, 3, '#31445C', 2.2);
    line(g, footX - 6.3, ankleY + 5.3, footX + 6.3, ankleY + 5.3, rgba(PAL.cyan, 0.55), 1.2);
  }

  function soldierHead(g, variant, cy) {
    box(g, 29, cy + 10, 6, 7, 2, PAL.skin, 2);

    if (variant === 0) {
      ell(g, 32, cy, 15, 13.5, 0, PAL.cyan, 2.6);
      box(g, 17, cy + 6, 30, 7.5, 3, shade(PAL.cyan, -0.24), 2.6);
      box(g, 20, cy + 7.4, 24, 2.2, 1, shade(PAL.cyan, 0.5), 0);
      ell(g, 27, cy - 4, 5.5, 3.2, -0.55, 'rgba(255,255,255,0.48)', 0);
      line(g, 19, cy - 1, 45, cy - 1, rgba(PAL.outline, 0.5), 1.4);
    } else if (variant === 1) {
      ell(g, 32, cy + 2.5, 13, 10, 0, PAL.skin, 2.55);
      poly(g, [[18, cy + 2], [19.5, cy - 6], [26, cy - 11.5], [38, cy - 10.5], [45, cy - 3.5], [46, cy + 2]], PAL.blue, 2.6);
      poly(g, [[42, cy - 1], [51, cy + 2.5], [49, cy + 6], [40, cy + 4.5]], shade(PAL.cyan, -0.08), 2.4);
      box(g, 19, cy - 0.5, 26, 2.6, 1, PAL.cyan, 0);
      ell(g, 32, cy - 11, 2.2, 2.2, 0, PAL.gold, 1.8);
      ell(g, 27, cy - 5, 4, 2.2, -0.5, 'rgba(255,255,255,0.38)', 0);
    } else {
      ell(g, 32, cy + 2.5, 13, 10, 0, PAL.skin, 2.55);
      ell(g, 32, cy - 3, 14, 11, 0, PAL.gold, 2.6);
      box(g, 18, cy + 2, 28, 7.5, 3.5, shade(PAL.gold, -0.14), 2.6);
      box(g, 20, cy + 3.6, 24, 2.1, 1, PAL.cyan, 0);
      ell(g, 32, cy - 14.5, 4.3, 4.3, 0, shade(PAL.gold, -0.08), 2.1);
      ell(g, 27, cy - 7, 4.5, 2.4, -0.5, 'rgba(255,255,255,0.35)', 0);
    }
  }

  RoadSprites.soldier = function (variant, frame) {
    var v = clampInt(variant, 0, 2);
    var f = clampInt(frame, 0, 3);
    return bakeBottom('soldier|' + v + '|' + f, 64, 92, function (g) {
      var base = 90;
      var gd = SOLDIER_GAIT[f];
      ground(g, 32, base - 4.4, 17, 4.2);
      soldierLeg(g, 26.5, 64 + gd.bob, 26.5 + gd.lx, gd.ly, base);
      soldierLeg(g, 37.5, 64 + gd.bob, 37.5 + gd.rx, gd.ry, base);

      g.save();
      g.translate(0, gd.bob);

      // 支撑手那侧的上臂藏在躯干后，只露出外张的肘部
      capsule(g, 18.5, 42, 12.5, 54, 6.8, shade(PAL.blue, -0.04), 2.2);

      poly(g, [[18, 66], [15.5, 43], [22, 35.5], [42, 35.5], [48.5, 43], [46, 66]], PAL.blue, 2.6);
      poly(g, [[18, 66], [15.5, 43], [22, 35.5], [27, 35.5], [24, 45], [24.5, 66]], shade(PAL.blue, -0.16), 0);
      box(g, 18, 59, 28, 7, 2, PAL.outline, 0);
      box(g, 29, 60.5, 6, 4, 1, PAL.gold, 1.5);

      ell(g, 17.5, 41, 6.8, 8, 0.12, shade(PAL.blue, 0.05), 2.3);
      ell(g, 46.5, 41, 6.8, 8, -0.12, shade(PAL.blue, 0.05), 2.3);

      box(g, 21, 37, 22, 25, 6, '#215694', 2.6);
      box(g, 21, 37, 22, 7, 4, '#173D70', 2.2);
      box(g, 20.5, 46.5, 23, 5.5, 1, PAL.cyan, 0);
      line(g, 21, 46.5, 43, 46.5, rgba(PAL.outline, 0.35), 1);
      poly(g, [[29, 54], [32, 51], [35, 54], [33.4, 55.4], [32, 54.2], [30.6, 55.4]], PAL.cyan, 0);
      box(g, 23, 55, 7, 5, 1.5, '#2F6FB8', 1.4);
      box(g, 33, 55, 7, 5, 1.5, '#2F6FB8', 1.4);
      poly(g, [[23, 40], [27, 40], [24.5, 61], [21.5, 61]], 'rgba(255,255,255,0.18)', 0);

      soldierHead(g, v, 23);

      var aim = gd.aim;
      var handR = gunPoint(3.5, 0, aim);
      var handL = gunPoint(19, 0, aim);

      // 右臂画在枪后，枪身完整露出；袖口和手再压回枪上
      capsule(g, 45.5, 42, 56, 50, 7, PAL.blue, 2.2);
      capsule(g, 56, 50, handR.x + 1.5, handR.y + 1, 6, shade(PAL.blue, 0.04), 2.2);
      soldierRifle(g, aim);
      capsule(g, handR.x + 3.6, handR.y + 1.5, handR.x + 1.3, handR.y + 0.6, 5, shade(PAL.blue, 0.02), 1.6);
      ell(g, handR.x, handR.y, 4.1, 3.7, -0.22, PAL.skin, 1.9);
      line(g, handR.x + 1.4, handR.y - 1.6, handR.x + 2.1, handR.y + 1.3, rgba(PAL.outline, 0.5), 1.1);

      // 左手从背后绕到护木，短袖口把手臂和枪连起来
      capsule(g, 45, 37.4 + aim * 0.7, handL.x - 0.8, handL.y + 0.8, 5.2, PAL.blue, 1.9);
      ell(g, handL.x, handL.y, 4, 3.6, 0.18, PAL.skin, 1.9);
      line(g, handL.x - 1.5, handL.y + 1.2, handL.x + 1.7, handL.y + 0.9, rgba(PAL.outline, 0.45), 1.1);

      // 肩部高光 + 枪口附近的青色反光
      ell(g, 47.5, 43.5, 2.4, 1.3, -0.5, 'rgba(255,255,255,0.3)', 0);
      var glint = gunPoint(40, 0, aim);
      ell(g, glint.x - 1, glint.y + 3.5, 1.2, 2.2, -0.2, rgba(PAL.cyan, 0.35), 0);
      g.restore();
    });
  };

  // =============================================================
  // 僵尸：Walker
  // =============================================================
  var WALKER_GAIT = [
    { sway: -2, bob: 0, lx: -2, ly: 0, rx: 3, ry: -3, reach: 0, head: 0.10 },
    { sway: 0.5, bob: -1.5, lx: 1, ly: -4, rx: -1, ry: -1, reach: -2, head: -0.10 },
    { sway: 2, bob: 0, lx: 3, ly: -3, rx: -2, ry: 0, reach: 1, head: 0.14 },
    { sway: -1, bob: -1.5, lx: -1, ly: -1, rx: 1, ry: -4, reach: 2, head: -0.12 }
  ];

  function zombieLeg(g, hipX, hipY, footX, lift, base, pant, boot) {
    var kneeX = hipX + (footX - hipX) * 0.4;
    var kneeY = hipY + 9;
    var ankleY = base - 8 + lift;
    capsule(g, hipX, hipY, kneeX, kneeY, 8.5, pant, 2.2);
    capsule(g, kneeX, kneeY, footX, ankleY, 7.2, pant, 2.2);
    if (boot) {
      box(g, footX - 6.5, ankleY - 1, 13, 8.8, 3, boot, 2.2);
      line(g, footX - 6, ankleY + 5.2, footX + 6, ankleY + 5.2, 'rgba(0,0,0,0.25)', 1.2);
    } else {
      ell(g, footX + 1, ankleY + 2.5, 7, 4.4, 0, PAL.walker, 2.2);
      ell(g, footX - 5, ankleY + 2, 2.4, 2, 0, shade(PAL.walker, 0.08), 1.4);
    }
  }

  function walkerHead(g, cx, cy, tilt) {
    g.save();
    g.translate(cx, cy);
    g.rotate(tilt || 0);
    ell(g, 0, 0, 13.5, 12, 0, PAL.walker, 2.6);
    ell(g, 0.5, 7.5, 9.5, 6.5, 0, shade(PAL.walker, -0.05), 0);
    ell(g, -13, 1.5, 3.3, 4.8, 0.2, PAL.walker, 2);
    ell(g, -13, 1.5, 1.4, 2.2, 0, shade(PAL.walker, -0.28), 0);
    ell(g, -5, -3, 3.8, 3.4, 0, PAL.outline, 0);
    ell(g, 5, -2, 4.2, 3.8, 0, PAL.outline, 0);
    ell(g, -4.6, -2.7, 1.2, 1.3, 0, PAL.gold, 0);
    ell(g, 4.4, -1.7, 1.1, 1.2, 0, PAL.gold, 0);
    line(g, -9, -6.4, -2, -5, PAL.outline, 1.6);
    line(g, 2, -6.2, 9, -7.2, PAL.outline, 1.6);
    line(g, 9, 2, 12, 5, shade(PAL.walker, -0.4), 1.4);
    poly(g, [[-7, 7], [7, 7], [4.5, 11.5], [-4, 11]], PAL.outline, 0);
    poly(g, [[-4.5, 7.2], [-2.2, 7.2], [-2.4, 10.4], [-3.8, 10.4]], PAL.cream, 0);
    poly(g, [[0, 7.2], [2.2, 7.2], [2, 10.6], [0.2, 10.5]], PAL.cream, 0);
    poly(g, [[4, 7.2], [6, 7.2], [5.2, 10], [3.8, 9.8]], PAL.cream, 0);
    poly(g, [[-10, -7], [-8, -13], [-5.5, -9]], PAL.darkGreen, 1.8);
    poly(g, [[-2.5, -10], [0.5, -15], [3, -9.5]], PAL.darkGreen, 1.8);
    poly(g, [[6, -8.5], [9.5, -12.5], [10, -7]], PAL.darkGreen, 1.8);
    g.restore();
  }

  RoadSprites.zombie = function (type, frame) {
    var f = clampInt(frame, 0, 3);
    if (type === 'runner') return runnerSprite(f);
    if (type === 'tank') return tankSprite(f);
    return walkerSprite(f);
  };

  function walkerSprite(f) {
    return bakeBottom('zombie|walker|' + f, 60, 92, function (g) {
      var base = 90;
      var gd = WALKER_GAIT[f];
      ground(g, 30, base - 4, 15.5, 4);
      g.save();
      g.translate(gd.sway, gd.bob);
      var lb = base - gd.bob;

      zombieLeg(g, 35, 65, 34 + gd.rx, gd.ry, lb, '#3C4654', PAL.outline);
      zombieLeg(g, 25, 65, 26 + gd.lx, gd.ly, lb, '#4A5568', null);

      poly(g, [[17, 41], [15.5, 58], [19, 69], [22, 65], [25.5, 70], [30, 65], [34.5, 70], [39, 66], [43, 69], [44.5, 57], [43, 40], [36, 35], [24, 35]], PAL.shirt, 2.6);
      poly(g, [[17, 41], [15.5, 58], [19, 69], [22, 65], [21, 58], [21, 42]], shade(PAL.shirt, -0.17), 0);
      poly(g, [[24, 35], [30, 42], [36, 35]], shade(PAL.walker, -0.08), 0);
      ell(g, 30, 56, 6.5, 7, 0, PAL.walker, 1.8);
      line(g, 25, 53, 34, 53, PAL.cream, 1.6);
      line(g, 24.5, 56, 34.5, 56, PAL.cream, 1.6);
      line(g, 25.5, 59, 34, 59, shade(PAL.walker, -0.2), 1.5);
      ell(g, 20, 62, 3.2, 2.4, 0.4, shade(PAL.shirt, -0.28), 0);
      ell(g, 40, 46, 2.8, 4, -0.3, shade(PAL.shirt, -0.2), 0);
      box(g, 19, 64, 24, 4.5, 1.5, '#6B5A42', 1.8);

      capsule(g, 43, 42, 46.5, 56, 6.4, PAL.shirt, 2.2);
      capsule(g, 46.5, 56, 46.5, 61, 5.4, PAL.walker, 2);
      ell(g, 46.5, 63, 4.2, 4.8, 0.15, PAL.walker, 2);
      capsule(g, 17, 42, 13.5, 53 + gd.reach * 0.5, 7.4, PAL.shirt, 2.2);
      capsule(g, 13.5, 53 + gd.reach * 0.5, 13, 59 + gd.reach, 6.6, PAL.walker, 2.1);
      ell(g, 12.5, 62 + gd.reach, 6.6, 6.2, -0.2, PAL.walker, 2.2);
      line(g, 8, 64 + gd.reach, 9.5, 68 + gd.reach, shade(PAL.walker, -0.28), 1.5);
      line(g, 12.5, 66.5 + gd.reach, 12.8, 69 + gd.reach, shade(PAL.walker, -0.28), 1.4);
      line(g, 16.5, 65.5 + gd.reach, 16, 68.5 + gd.reach, shade(PAL.walker, -0.28), 1.4);

      walkerHead(g, 30, 24 + (gd.head * 4), gd.head);
      g.restore();
    });
  }

  // =============================================================
  // 僵尸：Runner
  // =============================================================
  var RUNNER_GAIT = [
    { bob: 0, lx: -6, lrx: 5, ly: 0, rx: 5, rry: -4, arm: -3 },
    { bob: -3, lx: -1, lrx: 2, ly: -5, rx: 2, rry: -2, arm: 0 },
    { bob: 0, lx: 5, lrx: -6, ly: -4, rx: -5, rry: 0, arm: 3 },
    { bob: -3, lx: 1, lrx: -1, ly: -2, rx: -1, rry: -5, arm: 0 }
  ];

  function runnerHead(g, cx, cy) {
    g.save();
    g.translate(cx, cy);
    g.rotate(0.06);
    ell(g, 0, 0, 11.5, 11, 0, PAL.runner, 2.6);
    ell(g, 1, 7.3, 7.5, 5.4, 0, shade(PAL.runner, -0.05), 0);
    ell(g, -10.8, 1, 2.8, 4, 0.2, PAL.runner, 1.9);
    ell(g, -4, -2.4, 3.2, 3.6, 0, PAL.cream, 1.4);
    ell(g, 4.2, -1.8, 3, 3.4, 0, PAL.cream, 1.4);
    ell(g, -3.6, -2, 1.4, 1.7, 0, PAL.outline, 0);
    ell(g, 4.6, -1.4, 1.3, 1.6, 0, PAL.outline, 0);
    poly(g, [[-4.5, 6.3], [5, 6.3], [3.4, 10.5], [-2.5, 10]], PAL.outline, 0);
    poly(g, [[-2.2, 6.6], [0, 6.6], [0, 9.4]], PAL.cream, 0);
    poly(g, [[-9, -6.5], [-11, -13], [-6, -9], [-4, -16], [-1, -9], [3, -15], [5, -8], [10, -11], [9, -5]], '#6E7A2E', 2);
    ell(g, 8.5, -8, 1.7, 2.4, 0.3, PAL.cyan, 1.2);
    g.restore();
  }

  function runnerSprite(f) {
    return bakeBottom('zombie|runner|' + f, 56, 88, function (g) {
      var base = 86;
      var gd = RUNNER_GAIT[f];
      ground(g, 28, base - 3.4, 14.5, 3.8);
      g.save();
      g.translate(0, gd.bob);
      var lb = base - gd.bob;

      capsule(g, 30, 58, 34 + gd.lrx, 71, 6.8, '#3E4A52', 2.2);
      capsule(g, 34 + gd.lrx, 71, 39 + gd.rx, lb - 8 + gd.rry, 5.8, '#3E4A52', 2.1);
      ell(g, 40 + gd.rx, lb - 4 + gd.rry, 5.8, 3.8, 0.15, PAL.runner, 2);
      capsule(g, 25, 58, 19 + gd.lrx, 66, 7, '#55636B', 2.2);
      capsule(g, 19 + gd.lrx, 66, 17 + gd.lx, lb - 7 + gd.ly, 5.8, '#55636B', 2.1);
      ell(g, 16 + gd.lx, lb - 4 + gd.ly, 5.8, 3.8, -0.1, PAL.runner, 2);

      poly(g, [[20, 54], [35, 54], [38, 63], [22, 63]], '#6B7A8F', 2.4);
      poly(g, [[21, 56], [24, 42], [32, 37], [38, 40], [40, 47], [35, 57]], '#2E6B63', 2.6);
      poly(g, [[21, 56], [24, 42], [28, 38], [27, 49], [26, 56]], shade('#2E6B63', -0.16), 0);
      line(g, 26, 47, 36, 46, shade('#2E6B63', 0.2), 1.6);
      line(g, 27, 50, 35, 49, shade('#2E6B63', 0.2), 1.6);
      ell(g, 33, 51, 3.4, 3, 0.3, PAL.runner, 1.3);

      capsule(g, 36, 40, 42 - gd.arm, 49, 5.4, PAL.runner, 2.1);
      capsule(g, 42 - gd.arm, 49, 40 - gd.arm * 1.6, 58, 4.6, PAL.runner, 2);
      ell(g, 39.5 - gd.arm * 1.7, 60, 3.6, 4.3, 0.2, PAL.runner, 1.9);
      capsule(g, 23, 41, 16 + gd.arm, 49, 5.2, PAL.runner, 2.1);
      capsule(g, 16 + gd.arm, 49, 17 + gd.arm * 1.5, 56, 4.4, PAL.runner, 2);
      ell(g, 17 + gd.arm * 1.6, 58.5, 3.5, 4.2, -0.2, PAL.runner, 1.9);

      capsule(g, 32, 35, 34, 39, 5.4, PAL.runner, 2);
      runnerHead(g, 35, 26 + (f % 2 ? -1 : 0));
      line(g, 4, 46, 9, 44, rgba(PAL.cream, 0.5), 1.4);
      line(g, 3, 52, 8, 51, rgba(PAL.cream, 0.4), 1.2);
      g.restore();
    });
  }

  // =============================================================
  // 僵尸：Tank
  // =============================================================
  var TANK_GAIT = [
    { bob: 0, lf: 0, rf: 0, lfy: 0, rfy: 0, sway: 0 },
    { bob: -2, lf: -5, rf: 0, lfy: -4, rfy: 0, sway: -1.5 },
    { bob: 0, lf: 0, rf: 0, lfy: 0, rfy: 0, sway: 0 },
    { bob: -2, lf: 0, rf: -5, lfy: 0, rfy: -4, sway: 1.5 }
  ];

  function tankHead(g, cx, cy) {
    g.save();
    g.translate(cx, cy);
    ell(g, 0, 0, 12, 10.5, 0, PAL.tank, 2.6);
    line(g, -7, -6, 6, -5, shade(PAL.tank, -0.32), 1.3);
    line(g, -5, -8.5, -5, -3.5, shade(PAL.tank, -0.32), 1.2);
    line(g, 1, -9, 1, -4, shade(PAL.tank, -0.32), 1.2);
    line(g, 6, -7.5, 6, -3, shade(PAL.tank, -0.32), 1.2);
    ell(g, -4, 0, 2.4, 2.1, 0, PAL.cream, 0);
    ell(g, 4, 0, 2.4, 2.1, 0, PAL.cream, 0);
    ell(g, -3.6, 0.2, 1, 1.1, 0, PAL.outline, 0);
    ell(g, 4.4, 0.2, 1, 1.1, 0, PAL.outline, 0);
    line(g, -8, -3, -1, -2, PAL.outline, 1.6);
    line(g, 1, -2.5, 8, -4, PAL.outline, 1.6);
    poly(g, [[-8, 5], [8, 5], [6, 10], [-6, 10]], shade(PAL.tank, -0.1), 2);
    poly(g, [[-5, 5], [-3, 5], [-3.5, 8]], PAL.cream, 0);
    poly(g, [[0, 5], [2, 5], [1.5, 8.2]], PAL.cream, 0);
    poly(g, [[4, 5], [6, 5], [5, 7.8]], PAL.cream, 0);
    ell(g, -11.5, 0, 2.5, 3.4, 0, PAL.tank, 1.8);
    ell(g, 11.5, 0, 2.5, 3.4, 0, PAL.tank, 1.8);
    g.restore();
  }

  function tankSprite(f) {
    return bakeBottom('zombie|tank|' + f, 90, 108, function (g) {
      var base = 106;
      var gd = TANK_GAIT[f];
      // 画布左右各留 2px，避免巨拳描边被裁切
      g.translate(2, 0);
      ground(g, 43, base - 5.5, 27, 5.6);
      g.save();
      g.translate(gd.sway, gd.bob);
      var lb = base - gd.bob;

      capsule(g, 31, 84, 29 + gd.lf, 97 + gd.lfy, 14, '#3D2F55', 2.4);
      box(g, 20 + gd.lf, lb - 12 + gd.lfy, 20, 12, 4, PAL.outline, 0);
      box(g, 20 + gd.lf, lb - 12 + gd.lfy, 20, 9, 4, '#4A3A6B', 2.4);
      capsule(g, 55, 84, 57 + gd.rf, 97 + gd.rfy, 14, '#3D2F55', 2.4);
      box(g, 47 + gd.rf, lb - 12 + gd.rfy, 20, 12, 4, PAL.outline, 0);
      box(g, 47 + gd.rf, lb - 12 + gd.rfy, 20, 9, 4, '#4A3A6B', 2.4);

      poly(g, [[15, 84], [13, 55], [23, 42], [63, 42], [73, 55], [71, 84], [57, 91], [29, 91]], PAL.tank, 2.8);
      poly(g, [[15, 84], [13, 55], [23, 42], [30, 42], [25, 57], [27, 84]], shade(PAL.tank, -0.17), 0);
      poly(g, [[22, 55], [26, 44], [60, 44], [64, 56], [58, 77], [28, 77]], '#4A3A6B', 2.2);
      box(g, 22, 76, 42, 7, 2, PAL.outline, 0);
      box(g, 38, 77.5, 10, 4, 1, PAL.gold, 1.5);
      ell(g, 29, 60, 2, 2, 0, '#8B7BB0', 1.2);
      ell(g, 43, 58, 2, 2, 0, '#8B7BB0', 1.2);
      ell(g, 57, 60, 2, 2, 0, '#8B7BB0', 1.2);
      poly(g, [[49, 68], [57, 64], [59, 73], [51, 75]], PAL.tank, 1.6);

      capsule(g, 19, 48, 12, 69, 12, PAL.tank, 2.4);
      capsule(g, 12, 69, 12, 80, 15.5, PAL.tank, 2.4);
      ell(g, 12, 85, 10, 9, 0, shade(PAL.tank, 0.05), 2.5);
      line(g, 7, 82, 17, 81, shade(PAL.tank, -0.3), 1.5);
      line(g, 7, 86, 17, 85.5, shade(PAL.tank, -0.3), 1.4);
      line(g, 9, 89, 16, 89, shade(PAL.tank, -0.25), 1.3);
      capsule(g, 67, 48, 74, 69, 12, shade(PAL.tank, 0.03), 2.4);
      capsule(g, 74, 69, 74, 80, 15.5, shade(PAL.tank, 0.03), 2.4);
      ell(g, 74, 85, 10, 9, 0, shade(PAL.tank, 0.08), 2.5);
      line(g, 69, 82, 79, 81, shade(PAL.tank, -0.28), 1.5);
      line(g, 69, 86, 79, 85.5, shade(PAL.tank, -0.28), 1.4);

      ell(g, 20, 46, 11, 9, 0.3, shade(PAL.tank, 0.06), 2.4);
      ell(g, 66, 46, 11, 9, -0.3, shade(PAL.tank, 0.03), 2.4);

      tankHead(g, 43, 28);
      capsule(g, 43, 36, 43, 43, 8, shade(PAL.tank, -0.12), 2);
      ell(g, 35, 33, 4, 2, -0.5, 'rgba(255,255,255,0.28)', 0);
      g.restore();
    });
  }

  // =============================================================
  // Boss：Brute（路障肩甲 + 混凝土拳）
  // =============================================================
  function concreteFist(g, cx, cy, r) {
    var i;
    ell(g, cx, cy, r, r * 0.95, 0, PAL.concrete, 3);
    for (i = -1; i <= 1; i++) {
      ell(g, cx + i * r * 0.42, cy - r * 0.48, r * 0.19, r * 0.16, 0, shade(PAL.concrete, -0.1), 1.4);
    }
    line(g, cx - r * 0.7, cy + r * 0.15, cx + r * 0.62, cy + r * 0.08, shade(PAL.concrete, -0.3), 1.8);
    line(g, cx - r * 0.15, cy - r * 0.3, cx + r * 0.12, cy + r * 0.55, shade(PAL.concrete, -0.25), 1.4);
    line(g, cx + r * 0.36, cy - r * 0.6, cx + r * 0.25, cy - r * 0.1, shade(PAL.concrete, -0.22), 1.3);
    ell(g, cx - r * 0.4, cy - r * 0.45, r * 0.26, r * 0.18, -0.4, 'rgba(255,255,255,0.35)', 0);
    box(g, cx - r * 0.8, cy + r * 0.6, r * 1.6, r * 0.34, r * 0.16, PAL.bruteAccent, 2);
  }

  function bruteHead(g, cx, cy, attack) {
    g.save();
    g.translate(cx, cy);
    ell(g, 0, 0, 19, 17, 0, PAL.brute, 3);
    ell(g, 0, 9, 14, 8, 0, shade(PAL.brute, -0.06), 0);
    ell(g, -19, 2, 4.6, 7, 0.2, PAL.brute, 2.4);
    ell(g, 19, 2, 4.6, 7, -0.2, PAL.brute, 2.4);
    poly(g, [[-10, -13], [-7, -25], [-3, -14], [1, -27], [5, -14], [10, -22], [10, -11]], PAL.bruteAccent, 2.4);
    line(g, -12, -4, -3, -1.5, PAL.outline, 2.2);
    line(g, 12, -4, 3, -1.5, PAL.outline, 2.2);
    ell(g, -6, 1, 3.1, 2.6, 0, PAL.cream, 1.2);
    ell(g, 6, 1, 3.1, 2.6, 0, PAL.cream, 1.2);
    ell(g, -5.6, 1.2, 1.4, 1.5, 0, PAL.outline, 0);
    ell(g, 6.4, 1.2, 1.4, 1.5, 0, PAL.outline, 0);
    poly(g, [[-2, 4], [2, 4], [0, 8]], shade(PAL.brute, -0.25), 1.2);
    if (attack) {
      poly(g, [[-8, 10], [8, 10], [5, 17], [-5, 17]], PAL.outline, 0);
      poly(g, [[-5, 10.5], [-2, 10.5], [-2.5, 14]], PAL.cream, 0);
      poly(g, [[0, 10.5], [3, 10.5], [2.4, 14.4]], PAL.cream, 0);
      poly(g, [[5, 10.5], [7, 10.5], [5.8, 13.4]], PAL.cream, 0);
    } else {
      line(g, -7, 12, 7, 12, PAL.outline, 2.2);
      poly(g, [[-5, 15], [-2, 15], [-2.6, 11.5]], PAL.cream, 0);
      poly(g, [[3, 15], [6, 15], [5, 11.5]], PAL.cream, 0);
    }
    line(g, 9, -9, 14, -3, shade(PAL.brute, -0.35), 1.6);
    ell(g, -7, -8, 3.2, 2, -0.5, 'rgba(255,255,255,0.25)', 0);
    g.restore();
  }

  function bruteSprite(pose) {
    return bakeBottom('boss|brute|' + pose, 180, 200, function (g) {
      var attack = pose === 1;
      var base = 198;
      ground(g, 90, base - 7, 64, 7.5);

      var lFoot = attack ? 62 : 64, rFoot = attack ? 120 : 116;
      capsule(g, 66, 146, lFoot, 170, 22, '#3A2B3F', 3);
      box(g, lFoot - 17, 183, 34, 14, 5, PAL.outline, 0);
      box(g, lFoot - 17, 183, 34, 10, 5, '#4A3A4F', 2.8);
      capsule(g, 114, 146, rFoot, 170, 22, '#3A2B3F', 3);
      box(g, rFoot - 17, 183, 34, 14, 5, PAL.outline, 0);
      box(g, rFoot - 17, 183, 34, 10, 5, '#4A3A4F', 2.8);

      poly(g, [[54, 150], [42, 100], [51, 72], [129, 72], [138, 100], [126, 150]], PAL.brute, 3.2);
      poly(g, [[54, 150], [42, 100], [51, 72], [62, 72], [55, 104], [67, 150]], shade(PAL.brute, -0.16), 0);
      poly(g, [[72, 78], [108, 78], [112, 92], [68, 98]], PAL.bruteAccent, 2.4);
      box(g, 76, 82, 28, 5, 1, shade(PAL.bruteAccent, -0.18), 0);
      ell(g, 90, 126, 25, 18, 0, shade(PAL.brute, 0.1), 0);

      var lArmor = [[22, 96], [34, 68], [76, 64], [70, 86], [34, 100]];
      var rArmor = [[158, 96], [146, 68], [104, 64], [110, 86], [146, 100]];
      stripedPoly(g, lArmor, PAL.cream, PAL.hazard, 11, 3);
      stripedPoly(g, rArmor, PAL.cream, PAL.hazard, 11, 3);
      poly(g, [[22, 96], [34, 100], [37, 94], [27, 92]], PAL.metal, 2);
      poly(g, [[158, 96], [146, 100], [143, 94], [153, 92]], PAL.metal, 2);
      ell(g, 48, 78, 2.2, 2.2, 0, PAL.gold, 1.2);
      ell(g, 132, 78, 2.2, 2.2, 0, PAL.gold, 1.2);

      if (attack) {
        capsule(g, 48, 95, 38, 114, 22, PAL.brute, 3);
        capsule(g, 38, 114, 47, 119, 20, shade(PAL.brute, 0.03), 3);
        concreteFist(g, 49, 126, 23);
        capsule(g, 132, 95, 142, 114, 22, PAL.brute, 3);
        capsule(g, 142, 114, 133, 119, 20, shade(PAL.brute, 0.04), 3);
        concreteFist(g, 131, 126, 23);
      } else {
        capsule(g, 49, 96, 34, 128, 21, PAL.brute, 3);
        capsule(g, 34, 128, 33, 142, 19, shade(PAL.brute, 0.03), 3);
        concreteFist(g, 32, 155, 22);
        capsule(g, 131, 96, 146, 128, 21, PAL.brute, 3);
        capsule(g, 146, 128, 147, 142, 19, shade(PAL.brute, 0.04), 3);
        concreteFist(g, 148, 155, 22);
      }

      capsule(g, 90, 64, 90, 78, 15, shade(PAL.brute, -0.12), 2.6);
      bruteHead(g, 90, 54, attack);
      ell(g, 76, 112, 5, 9, -0.2, 'rgba(255,255,255,0.14)', 0);
    });
  }

  // =============================================================
  // Boss：Butcher（围裙 + 电锯 / 菜刀）
  // =============================================================
  function chainsaw(g, x, y, ang) {
    var i;
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    poly(g, [[-16, -4], [-24, -11], [-17, -16], [-6, -7]], PAL.outline, 2);
    box(g, -8, -12, 25, 24, 5, PAL.butcher, 3);
    box(g, -5, -9, 13, 8, 2, shade(PAL.butcher, 0.18), 0);
    box(g, 4, 2, 9, 6, 1.5, PAL.outline, 0);
    box(g, 14, -7, 47, 13, 6, PAL.metal, 3);
    box(g, 18, -4, 39, 5, 2, shade(PAL.metal, 0.25), 0);
    for (i = 0; i < 7; i++) {
      poly(g, [[19 + i * 5.6, 6], [23 + i * 5.6, 6], [21 + i * 5.6, 11]], PAL.gold, 1.2);
    }
    ell(g, 61, -0.5, 4.5, 6.5, 0, shade(PAL.metal, -0.16), 2.2);
    line(g, 0, -8, 18, -8, 'rgba(255,255,255,0.35)', 1.4);
    g.restore();
  }

  function cleaver(g, x, y, ang) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    box(g, -15, -4, 17, 8, 3, PAL.wood, 2.4);
    ell(g, -12, 0, 2, 2, 0, PAL.gold, 1.2);
    poly(g, [[0, -5], [24, -12], [30, 6], [27, 18], [2, 10]], PAL.concrete, 2.8);
    poly(g, [[5, -3], [22, -8], [26, 5], [24, 13], [7, 7]], shade(PAL.concrete, 0.18), 0);
    ell(g, 17, 3, 5.5, 4, 0.3, PAL.butcher, 0);
    ell(g, 23, 9, 2.6, 3, 0, shade(PAL.butcher, -0.12), 0);
    ell(g, 5, 0, 1.7, 1.7, 0, PAL.gold, 0);
    g.restore();
  }

  function butcherHead(g, cx, cy, attack) {
    g.save();
    g.translate(cx, cy);
    ell(g, 0, 0, 18.5, 17, 0, PAL.skinWarm, 3);
    ell(g, 0, 9.5, 13, 7.5, 0, shade(PAL.skinWarm, -0.04), 0);
    box(g, -14, -22, 28, 8, 4, PAL.cream, 2.6);
    ell(g, -9, -25, 8, 7, 0, PAL.cream, 2.6);
    ell(g, 1, -27, 10, 8, 0, PAL.cream, 2.6);
    ell(g, 11, -24, 7.5, 6.5, 0, PAL.cream, 2.6);
    poly(g, [[-10, 5], [10, 5], [8, 15], [-8, 15]], shade(PAL.skinWarm, -0.18), 2.2);
    line(g, -7, 8, 7, 8, PAL.outline, 1.4);
    line(g, -6, 11, 6, 11, PAL.outline, 1.3);
    line(g, -5, 14, 5, 14, PAL.outline, 1.2);
    ell(g, -6, -3, 3.2, 3.4, 0, PAL.cream, 1.3);
    ell(g, 6, -3, 3.2, 3.4, 0, PAL.cream, 1.3);
    ell(g, -5.6, -2.8, 1.4, 1.6, 0, PAL.outline, 0);
    ell(g, 6.4, -2.8, 1.4, 1.6, 0, PAL.outline, 0);
    line(g, -12, -8, -3, -6, PAL.outline, 2);
    line(g, 12, -8, 3, -6, PAL.outline, 2);
    ell(g, 13, 6, 2.2, 1.8, 0.3, PAL.butcher, 0);
    ell(g, -13, -10, 2, 1.5, 0, PAL.butcher, 0);
    if (attack) line(g, 9, 2, 14, 6, PAL.butcher, 2);
    g.restore();
  }

  function butcherSprite(pose) {
    return bakeBottom('boss|butcher|' + pose, 180, 210, function (g) {
      var attack = pose === 1;
      var base = 208;
      ground(g, 90, base - 8, 58, 7.2);

      capsule(g, 68, 158, 62, 182, 22, '#3C3038', 3);
      box(g, 46, 194, 33, 12, 4, PAL.outline, 0);
      box(g, 46, 194, 33, 8, 4, '#55454D', 2.6);
      capsule(g, 112, 158, 118, 182, 22, '#3C3038', 3);
      box(g, 101, 194, 33, 12, 4, PAL.outline, 0);
      box(g, 101, 194, 33, 8, 4, '#55454D', 2.6);

      poly(g, [[54, 156], [46, 102], [58, 74], [122, 74], [134, 102], [126, 156]], '#3A2E3A', 3.2);
      poly(g, [[56, 98], [68, 84], [112, 84], [124, 98], [130, 158], [114, 166], [66, 166], [50, 158]], PAL.paper, 3);
      line(g, 56, 100, 112, 80, PAL.cream, 4);
      line(g, 124, 100, 68, 80, PAL.cream, 4);
      box(g, 60, 132, 60, 22, 3, shade(PAL.paper, -0.08), 2);
      ell(g, 76, 116, 8, 6, 0.4, PAL.butcher, 0);
      ell(g, 101, 120, 5, 8, -0.3, shade(PAL.butcher, -0.05), 0);
      ell(g, 91, 144, 9, 5, 0.2, PAL.butcher, 0);
      ell(g, 114, 102, 3, 4, 0, PAL.butcher, 0);
      ell(g, 66, 148, 3.5, 2.5, 0, PAL.butcher, 0);
      line(g, 66, 90, 66, 158, 'rgba(27,36,48,0.35)', 1.2);
      line(g, 114, 90, 114, 158, 'rgba(27,36,48,0.35)', 1.2);

      if (attack) {
        capsule(g, 54, 100, 40, 78, 20, PAL.skinWarm, 3);
        capsule(g, 40, 78, 47, 66, 17, shade(PAL.skinWarm, 0.04), 3);
        chainsaw(g, 50, 62, -2.1);
        capsule(g, 126, 100, 143, 108, 20, PAL.skinWarm, 3);
        capsule(g, 143, 108, 142, 92, 17, shade(PAL.skinWarm, 0.03), 3);
        cleaver(g, 142, 92, -0.15);
      } else {
        // 左手电锯垂在身侧
        capsule(g, 54, 104, 40, 128, 20, PAL.skinWarm, 3);
        capsule(g, 40, 128, 40, 140, 17, shade(PAL.skinWarm, 0.04), 3);
        chainsaw(g, 40, 140, 2.05);
        capsule(g, 126, 104, 140, 128, 20, PAL.skinWarm, 3);
        capsule(g, 140, 128, 143, 140, 17, shade(PAL.skinWarm, 0.03), 3);
        cleaver(g, 145, 142, 1.2);
      }
      ell(g, 55, 101, 10, 8, 0.2, '#4A3946', 2.4);
      ell(g, 125, 101, 10, 8, -0.2, '#4A3946', 2.4);

      capsule(g, 90, 66, 90, 80, 14, shade(PAL.skinWarm, -0.08), 2.6);
      butcherHead(g, 90, 54, attack);
      ell(g, 74, 118, 4, 10, -0.2, 'rgba(255,255,255,0.18)', 0);
    });
  }

  // =============================================================
  // Boss：Mother（肿胀囊袋 + 触须）
  // =============================================================
  function tendril(g, x0, y0, c1x, c1y, c2x, c2y, x1, y1, w, color) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.bezierCurveTo(c1x, c1y, c2x, c2y, x1, y1);
    g.strokeStyle = PAL.outline;
    g.lineWidth = w + 4.5;
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = w;
    g.stroke();
    ell(g, x1, y1, w * 0.62, w * 0.62, 0, color, 0);
    ell(g, x1 - w * 0.16, y1 - w * 0.18, w * 0.22, w * 0.2, 0, 'rgba(255,255,255,0.3)', 0);
  }

  function motherHead(g, cx, cy, attack) {
    g.save();
    g.translate(cx, cy);
    // 有机触须发丝（避免“王冠”剪影）
    g.beginPath();
    g.moveTo(-12, -10);
    g.bezierCurveTo(-24, -20, -27, -31, -19, -35);
    g.strokeStyle = PAL.outline;
    g.lineWidth = 7.2;
    g.stroke();
    g.strokeStyle = shade(PAL.mother, 0.12);
    g.lineWidth = 3.8;
    g.stroke();
    ell(g, -19, -35, 2.8, 2.8, 0, shade(PAL.mother, 0.24), 1.4);

    g.beginPath();
    g.moveTo(-4, -13);
    g.bezierCurveTo(-10, -27, -2, -35, 4, -33);
    g.strokeStyle = PAL.outline;
    g.lineWidth = 7.2;
    g.stroke();
    g.strokeStyle = shade(PAL.mother, 0.15);
    g.lineWidth = 3.8;
    g.stroke();
    ell(g, 4, -33, 2.6, 2.6, 0, shade(PAL.mother, 0.26), 1.4);

    g.beginPath();
    g.moveTo(7, -12);
    g.bezierCurveTo(18, -21, 24, -30, 20, -35);
    g.strokeStyle = PAL.outline;
    g.lineWidth = 7.2;
    g.stroke();
    g.strokeStyle = shade(PAL.mother, 0.1);
    g.lineWidth = 3.8;
    g.stroke();
    ell(g, 20, -35, 2.6, 2.6, 0, shade(PAL.mother, 0.22), 1.4);

    ell(g, 0, 0, 18.5, 17, 0, shade(PAL.mother, 0.14), 3);
    ell(g, 0, 9, 13, 7.5, 0, shade(PAL.mother, 0.06), 0);
    ell(g, -6, -1, 4, 4.2, 0, PAL.cream, 1.4);
    ell(g, 6, -1, 4, 4.2, 0, PAL.cream, 1.4);
    ell(g, -5.6, -0.6, 1.6, 2, 0, PAL.outline, 0);
    ell(g, 6.4, -0.6, 1.6, 2, 0, PAL.outline, 0);
    if (attack) {
      poly(g, [[-7, 8], [7, 8], [4, 15], [-4, 15]], PAL.outline, 0);
      poly(g, [[-4.5, 8.4], [-2, 8.4], [-2.6, 12]], PAL.cream, 0);
      poly(g, [[2, 8.4], [4.5, 8.4], [3.4, 12]], PAL.cream, 0);
    } else {
      line(g, -6, 10, 6, 10, PAL.outline, 2);
    }
    ell(g, -12, 5, 2.2, 1.7, 0, shade(PAL.mother, -0.2), 0);
    ell(g, 12, 6, 1.8, 1.4, 0, shade(PAL.mother, -0.2), 0);
    g.restore();
  }

  function motherSprite(pose) {
    return bakeBottom('boss|mother|' + pose, 190, 220, function (g) {
      var attack = pose === 1;
      var base = 218;
      ground(g, 95, base - 8, 66, 7.5);

      if (attack) {
        tendril(g, 60, 156, 32, 172, 14, 182, 12, 160, 9, PAL.mother);
        tendril(g, 130, 156, 158, 172, 178, 182, 178, 160, 9, PAL.mother);
        tendril(g, 78, 176, 58, 196, 40, 204, 26, 196, 8, PAL.mother);
        tendril(g, 112, 176, 134, 196, 152, 204, 166, 196, 8, PAL.mother);
        tendril(g, 48, 130, 30, 112, 22, 96, 34, 86, 7, PAL.mother);
        tendril(g, 142, 130, 160, 112, 168, 96, 156, 86, 7, PAL.mother);
      } else {
        tendril(g, 60, 158, 40, 182, 26, 192, 34, 204, 9, PAL.mother);
        tendril(g, 130, 158, 150, 182, 164, 192, 156, 204, 9, PAL.mother);
        tendril(g, 80, 178, 66, 200, 52, 210, 44, 206, 8, PAL.mother);
        tendril(g, 110, 178, 124, 200, 138, 210, 146, 206, 8, PAL.mother);
      }

      ell(g, 95, 142, 54, 52, 0, PAL.mother, 3.2);
      ell(g, 54, 132, 31, 34, -0.15, shade(PAL.mother, 0.05), 2.8);
      ell(g, 136, 132, 31, 34, 0.15, shade(PAL.mother, 0.05), 2.8);
      ell(g, 95, 169, 38, 29, 0, shade(PAL.mother, 0.1), 2.8);
      ell(g, 95, 108, 37, 32, 0, shade(PAL.mother, 0.06), 2.8);

      // 腹部小囊袋，强化“母体”轮廓
      ell(g, 74, 170, 13, 12, -0.15, shade(PAL.mother, 0.16), 2.2);
      ell(g, 108, 174, 15, 13, 0.1, shade(PAL.mother, 0.13), 2.2);
      ell(g, 91, 181, 10, 9, 0, shade(PAL.mother, 0.2), 2);
      ell(g, 73, 169, 4.5, 3.4, -0.4, 'rgba(255,255,255,0.3)', 0);
      ell(g, 106, 172, 5, 3.8, 0.2, 'rgba(255,255,255,0.28)', 0);
      ell(g, 91, 179, 3.2, 2.4, 0, 'rgba(255,255,255,0.35)', 0);

      ell(g, 48, 124, 12, 9, -0.5, 'rgba(255,255,255,0.22)', 0);
      ell(g, 141, 125, 10, 8, 0.4, 'rgba(255,255,255,0.18)', 0);
      ell(g, 88, 160, 14, 10, -0.2, 'rgba(255,255,255,0.14)', 0);
      ell(g, 67, 142, 5, 4, 0.3, shade(PAL.mother, -0.22), 0);
      ell(g, 122, 148, 4, 3.3, 0, shade(PAL.mother, -0.22), 0);
      ell(g, 55, 144, 3.2, 2.4, 0, shade(PAL.mother, -0.2), 0);
      ell(g, 95, 118, 3.4, 2.6, 0, shade(PAL.mother, -0.2), 0);

      g.beginPath();
      g.moveTo(76, 108);
      g.bezierCurveTo(74, 128, 62, 138, 58, 154);
      g.strokeStyle = rgba('#E0AAFF', 0.55);
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.moveTo(114, 108);
      g.bezierCurveTo(118, 126, 130, 138, 132, 152);
      g.strokeStyle = rgba('#E0AAFF', 0.5);
      g.lineWidth = 2;
      g.stroke();

      capsule(g, 57, 117, 42, 126, 10, shade(PAL.mother, 0.1), 2.2);
      capsule(g, 42, 126, 34, 121, 7, shade(PAL.mother, 0.14), 2);
      ell(g, 32, 120, 5, 4, -0.3, shade(PAL.mother, 0.16), 2);
      capsule(g, 133, 117, 148, 126, 10, shade(PAL.mother, 0.08), 2.2);
      capsule(g, 148, 126, 156, 121, 7, shade(PAL.mother, 0.12), 2);
      ell(g, 158, 120, 5, 4, 0.3, shade(PAL.mother, 0.14), 2);

      capsule(g, 95, 75, 95, 92, 12, shade(PAL.mother, -0.08), 2.4);
      motherHead(g, 95, 62, attack);
      ell(g, 72, 128, 7, 14, -0.25, 'rgba(255,255,255,0.12)', 0);
    });
  }

  RoadSprites.boss = function (type, pose) {
    var p = clampInt(pose, 0, 1);
    if (type === 'butcher') return butcherSprite(p);
    if (type === 'mother') return motherSprite(p);
    return bruteSprite(p);
  };

  // =============================================================
  // 道具
  // =============================================================
  RoadSprites.barrel = function () {
    return bakeBottom('prop|barrel', 40, 48, function (g) {
      ground(g, 20, 43.8, 13, 2.9);
      poly(g, [[9, 12], [8, 20], [8, 36], [10, 44], [30, 44], [32, 36], [32, 20], [31, 12]], PAL.hazard, 2.6);
      poly(g, [[9, 12], [8, 20], [8, 36], [10, 44], [14, 44], [13, 30], [14, 13]], shade(PAL.hazard, -0.18), 0);
      box(g, 7, 14, 26, 4.5, 2, '#8A3038', 2);
      box(g, 7, 35, 26, 4.5, 2, '#8A3038', 2);
      box(g, 7.5, 22, 25, 9, 1, PAL.gold, 2);
      line(g, 10, 30, 17, 23, PAL.outline, 1.5);
      line(g, 18, 30, 25, 23, PAL.outline, 1.5);
      line(g, 26, 30, 31, 25, PAL.outline, 1.2);
      ell(g, 20, 12, 11.5, 4.5, 0, '#3A4757', 2.4);
      ell(g, 20, 11, 7.5, 2.5, 0, '#526477', 0);
      poly(g, [[11, 17], [14, 17], [13.5, 34], [11, 34]], 'rgba(255,255,255,0.28)', 0);
      ell(g, 24, 25, 2, 5, 0, 'rgba(255,255,255,0.14)', 0);
    });
  };

  RoadSprites.crate = function () {
    return bakeBottom('prop|crate', 44, 42, function (g) {
      ground(g, 22, 37.8, 15, 3.1);
      box(g, 5, 5, 34, 33, 3, PAL.wood, 2.6);
      line(g, 5.8, 13, 38.2, 13, shade(PAL.wood, -0.26), 1.6);
      line(g, 5.8, 22, 38.2, 22, shade(PAL.wood, -0.26), 1.6);
      line(g, 5.8, 30, 38.2, 30, shade(PAL.wood, -0.26), 1.6);
      poly(g, [[7, 35], [12, 35], [37, 8], [32, 7]], shade(PAL.wood, 0.14), 1.8);
      poly(g, [[5, 5], [14, 5], [14, 10], [5, 10]], PAL.metal, 2);
      poly(g, [[30, 5], [39, 5], [39, 10], [30, 10]], PAL.metal, 2);
      poly(g, [[5, 33], [14, 33], [14, 38], [5, 38]], PAL.metal, 2);
      poly(g, [[30, 33], [39, 33], [39, 38], [30, 38]], PAL.metal, 2);
      box(g, 13, 11, 18, 18, 3, shade(PAL.wood, 0.16), 1.5);
      poly(g, [[20, 14], [24, 14], [24, 19], [29, 19], [29, 23], [24, 23], [24, 28], [20, 28], [20, 23], [15, 23], [15, 19], [20, 19]], PAL.cream, 0);
      ell(g, 9, 8, 1.1, 1.1, 0, '#D9DEE5', 0);
      ell(g, 35, 8, 1.1, 1.1, 0, '#D9DEE5', 0);
      ell(g, 9, 35, 1.1, 1.1, 0, '#D9DEE5', 0);
      ell(g, 35, 35, 1.1, 1.1, 0, '#D9DEE5', 0);
    });
  };

  RoadSprites.medkit = function () {
    return bakeBottom('prop|medkit', 38, 32, function (g) {
      ground(g, 19, 28, 12, 2.6);
      g.beginPath();
      g.moveTo(14, 8);
      g.quadraticCurveTo(19, 1.5, 24, 8);
      g.strokeStyle = PAL.outline;
      g.lineWidth = 5;
      g.stroke();
      g.strokeStyle = PAL.metal;
      g.lineWidth = 2.4;
      g.stroke();
      box(g, 4, 7, 30, 21, 4, PAL.paper, 2.6);
      box(g, 4, 7, 30, 5, 3, shade(PAL.paper, -0.1), 0);
      box(g, 15.5, 10, 7, 15, 1, PAL.hazard, 1.6);
      box(g, 11.5, 14, 15, 7, 1, PAL.hazard, 1.6);
      line(g, 7, 11, 7, 24, 'rgba(255,255,255,0.6)', 1.8);
      box(g, 17, 24.5, 4, 3, 1, PAL.gold, 1.2);
    });
  };

  RoadSprites.ammo = function () {
    return bakeBottom('prop|ammo', 38, 30, function (g) {
      ground(g, 19, 26, 12, 2.6);
      box(g, 3, 7, 32, 19, 3, PAL.olive, 2.6);
      box(g, 3, 7, 32, 5, 2, shade(PAL.olive, 0.16), 0);
      poly(g, [[11, 16], [11, 11], [14, 9], [17, 11], [17, 16], [14, 18]], PAL.gold, 1.8);
      box(g, 9, 17, 10, 4, 1, shade(PAL.gold, -0.15), 1.4);
      box(g, 27, 11, 6, 5, 1.5, PAL.gold, 1.6);
      line(g, 22, 13, 28, 13, 'rgba(255,255,255,0.25)', 1.2);
      line(g, 6, 10, 6, 22, 'rgba(255,255,255,0.22)', 1.8);
      ell(g, 7, 9.5, 1, 1, 0, PAL.metal, 0);
      ell(g, 31, 9.5, 1, 1, 0, PAL.metal, 0);
    });
  };

  // =============================================================
  // 武器补给箱 / 武器图标
  // =============================================================
  var CRATE_TIERS = {
    3: { body: '#F2994A', dark: '#C46A1E', lid: '#FFB35C', panel: '#3A2415', accent: '#FF9F1C', glow: '#FF9F1C', pips: 3, armor: 0 },
    4: { body: '#2F80ED', dark: '#1F5FB5', lid: '#56CCF2', panel: '#102B4A', accent: '#56CCF2', glow: '#56CCF2', pips: 4, armor: 1 },
    5: { body: '#B9A874', dark: '#6B7A45', lid: '#F2C94C', panel: '#2E3320', accent: '#F2C94C', glow: '#F2C94C', pips: 5, armor: 2 },
    6: { body: '#9D4EDD', dark: '#6A2FA8', lid: '#D946EF', panel: '#2B123D', accent: '#6FE7C8', glow: '#D946EF', pips: 6, armor: 3 }
  };

  function weaponGlyph(g, tier, cx, cy, s) {
    var cfg = CRATE_TIERS[tier];
    var light = PAL.cream;
    var accent = cfg.accent;
    var dark = PAL.outline;
    var i;
    g.save();
    g.translate(cx, cy);
    g.scale(s, s);

    if (tier === 3) {
      // 机关枪
      poly(g, [[-16, -3], [-12, -5], [-10, 3], [-15, 4]], PAL.wood, 1.6);
      box(g, -10, -4, 12, 8, 1.6, light, 1.7);
      box(g, -6, -6.3, 4, 2.3, 0.6, accent, 1.2);
      box(g, 1, -2.2, 12, 4.4, 1.2, light, 1.7);
      box(g, 12.5, -3, 3.3, 6, 1, accent, 1.4);
      box(g, 2, -1, 4, 2, 0.5, dark, 0);
      box(g, 4, 3.6, 5, 5.8, 1, dark, 1.2);
      line(g, 9, 2, 6, 8.2, dark, 1.4);
      line(g, 9, 2, 12, 8.2, dark, 1.4);
      line(g, -8, -1, 0, -1, 'rgba(27,36,48,0.4)', 1);
    } else if (tier === 4) {
      // 火箭筒
      box(g, -17, -4, 26, 8, 3, light, 1.7);
      box(g, -18.5, -3.2, 3.5, 6.4, 1, dark, 1.4);
      ell(g, 8, 0, 4.2, 4.8, 0, accent, 1.6);
      poly(g, [[9, -3.2], [18, 0], [9, 3.2]], accent, 1.6);
      ell(g, 11.5, 0, 1.5, 2, 0, light, 0);
      box(g, -2, 4, 5, 5.5, 1, dark, 1.3);
      box(g, -1, -6.8, 5, 2.2, 0.6, accent, 1.2);
      poly(g, [[-14, -4], [-11, -7], [-12, -4]], dark, 1.2);
      poly(g, [[-14, 4], [-11, 7], [-12, 4]], dark, 1.2);
      line(g, -12, -1.5, 4, -1.5, 'rgba(255,255,255,0.4)', 1);
    } else if (tier === 5) {
      // 坦克炮
      box(g, -17, 2.5, 31, 6.2, 3, '#6B7A45', 1.6);
      var wheels = [-12, -5, 2, 9];
      for (i = 0; i < wheels.length; i++) {
        ell(g, wheels[i], 5.6, 2.1, 2.1, 0, dark, 0);
        ell(g, wheels[i], 5.6, 1, 1, 0, PAL.metal, 0);
      }
      poly(g, [[-14, -4], [10, -4], [13, 2], [-16, 2]], light, 1.7);
      poly(g, [[-6, -3], [-3, -8], [6, -8], [9, -3]], accent, 1.5);
      box(g, 7, -6.2, 11, 2.8, 1, light, 1.5);
      box(g, 17, -6.8, 2.6, 4, 0.8, accent, 1.2);
      ell(g, 0, -7.4, 2, 1.2, 0, dark, 0);
      line(g, -11, -1, 6, -1, 'rgba(27,36,48,0.35)', 1);
    } else {
      // 等离子线圈
      ell(g, 2, 0, 11, 9, 0, rgba(accent, 0.14), 0);
      poly(g, [[-16, -2], [-10, -6], [-8, -2], [-8, 2], [-10, 6], [-16, 2]], dark, 1.4);
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.beginPath(); g.ellipse(2, 0, 10, 7, -0.2, -2.4, -0.7); g.stroke();
      g.beginPath(); g.ellipse(2, 0, 10, 7, -0.2, 0.7, 2.4); g.stroke();
      ell(g, 2, 0, 6.5, 6.5, 0, light, 1.8);
      ell(g, 2, 0, 3, 3, 0, '#FFFFFF', 0);
      poly(g, [[2, -10], [5, -6], [2, -5]], accent, 1.2);
      poly(g, [[2, 10], [5, 6], [2, 5]], accent, 1.2);
      ell(g, -12, -6, 1.3, 1.3, 0, light, 0);
      ell(g, 14, -5, 1.5, 1.5, 0, accent, 0);
      ell(g, 12, 6, 1, 1, 0, light, 0);
    }
    g.restore();
  }

  RoadSprites.weaponCrate = function (tier) {
    var t = clampInt(tier, 3, 6);
    var cfg = CRATE_TIERS[t];
    return bakeBottom('weaponCrate|' + t, 64, 58, function (g) {
      var i;
      ground(g, 32, 53.5, 21, 2.8);

      // 稀有度辉光从箱体背后透出
      if (t >= 4) {
        glowSpot(g, 32, 33, 24, cfg.glow, t === 6 ? 0.3 : (t === 5 ? 0.14 : 0.11));
      }

      // 底托
      box(g, 10, 51.5, 44, 3.8, 1.5, '#3A4757', 2.2);

      // 主箱体（切角装甲箱）
      poly(g, [[7, 18], [13, 11], [51, 11], [57, 18], [57, 50], [51, 55], [13, 55], [7, 50]], cfg.body, 2.8);
      poly(g, [[7, 18], [13, 11], [13, 55], [7, 50]], shade(cfg.body, -0.18), 0);
      box(g, 11, 46.5, 42, 5.5, 1.8, shade(cfg.body, -0.3), 0);

      // 重型箱盖
      poly(g, [[13, 11], [51, 11], [55, 17], [9, 17]], cfg.lid, 2.4);
      line(g, 10, 17.2, 54, 17.2, rgba(PAL.outline, 0.45), 1.3);
      if (cfg.armor >= 2) {
        poly(g, [[12, 9.5], [52, 9.5], [55, 14], [9, 14]], shade(cfg.dark, -0.18), 2.3);
        line(g, 14, 11.5, 50, 11.5, rgba(PAL.cream, 0.18), 1);
      }

      // 危险条纹带
      stripedRect(g, 10.5, 19, 43, 5.4, 1.4, PAL.cream, PAL.outline, 4, 2);

      // 前部暗色武器面板
      box(g, 12, 25.5, 40, 20, 3, cfg.panel, 2.4);
      rrPath(g, 14.7, 28, 34.6, 15, 2);
      g.strokeStyle = rgba(cfg.accent, 0.62);
      g.lineWidth = 1.2;
      g.stroke();

      if (t === 6) glowSpot(g, 32, 35.5, 17, cfg.accent, 0.16);
      weaponGlyph(g, t, 32, 35.8, 0.92);

      // 侧装甲 / 稀有度重量感
      if (cfg.armor >= 1) {
        var out = cfg.armor >= 2 ? 3 : 4;
        poly(g, [[out, 25], [8, 22], [8, 48], [out, 45]], PAL.metal, 2.2);
        poly(g, [[64 - out, 25], [56, 22], [56, 48], [64 - out, 45]], PAL.metal, 2.2);
        for (i = 0; i < (cfg.armor >= 2 ? 3 : 2); i++) {
          ell(g, out + 2.1, 30 + i * 6.3, 1.15, 1.15, 0, PAL.cream, 0);
          ell(g, 64 - out - 2.1, 30 + i * 6.3, 1.15, 1.15, 0, PAL.cream, 0);
        }
      }
      if (cfg.armor >= 3) {
        // 顶部散热口 + 品红内芯
        box(g, 17.5, 10, 6.5, 2.6, 0.8, '#1B2430', 1.2);
        box(g, 40, 10, 6.5, 2.6, 0.8, '#1B2430', 1.2);
        ell(g, 20.7, 11.3, 1.5, 0.9, 0, cfg.accent, 0);
        ell(g, 43.2, 11.3, 1.5, 0.9, 0, cfg.accent, 0);
      }

      // 金属包角
      poly(g, [[7, 18], [13, 11], [21, 11], [9, 20]], PAL.metal, 2.2);
      poly(g, [[57, 18], [51, 11], [43, 11], [55, 20]], PAL.metal, 2.2);
      poly(g, [[7, 49], [11, 45], [11, 55], [7, 55]], shade(PAL.metal, -0.22), 2.2);
      poly(g, [[57, 49], [53, 45], [53, 55], [57, 55]], shade(PAL.metal, -0.22), 2.2);
      ell(g, 15, 14, 1.2, 1.2, 0, PAL.cream, 0);
      ell(g, 49, 14, 1.2, 1.2, 0, PAL.cream, 0);

      // 中央金色锁扣
      box(g, 28.5, 13, 7, 8.5, 1.6, PAL.gold, 2.2);
      ell(g, 32, 18, 1.2, 1.7, 0, PAL.outline, 0);
      line(g, 30, 15, 34, 15, 'rgba(255,255,255,0.45)', 1.1);

      // 阶级识别 pips
      var pw = 4.2, gap = 2.2;
      var total = cfg.pips * pw + (cfg.pips - 1) * gap;
      var x0 = 32 - total / 2;
      for (i = 0; i < cfg.pips; i++) {
        box(g, x0 + i * (pw + gap), 47.4, pw, pw, 1, cfg.accent, 1.2);
        line(g, x0 + i * (pw + gap) + 0.9, 48.3, x0 + i * (pw + gap) + 2.8, 48.3, 'rgba(255,255,255,0.5)', 0.9);
      }

      // 箱体高光
      line(g, 15, 21, 49, 21, 'rgba(255,255,255,0.18)', 1.2);
      line(g, 9, 36, 9, 46, 'rgba(255,255,255,0.16)', 1.2);
    });
  };

  RoadSprites.weaponIcon = function (tier) {
    var t = clampInt(tier, 3, 6);
    var cfg = CRATE_TIERS[t];
    return bakeCenter('weaponIcon|' + t, 32, 32, function (g) {
      ell(g, 16, 16.5, 13.5, 13.5, 0, 'rgba(10,16,24,0.28)', 0);
      ell(g, 16, 16, 13.5, 13.5, 0, '#16202B', 2.4);
      g.beginPath();
      g.arc(16, 16, 11.2, 0, Math.PI * 2);
      g.strokeStyle = cfg.accent;
      g.lineWidth = 2;
      g.stroke();
      weaponGlyph(g, t, 16, 16, 0.62);
      ell(g, 9.5, 9.5, 1.6, 1.1, -0.6, 'rgba(255,255,255,0.28)', 0);
    });
  };

  RoadSprites.cone = function () {
    return bakeBottom('prop|cone', 28, 38, function (g) {
      ground(g, 14, 34, 10, 2.4);
      box(g, 3, 30, 22, 6, 2, '#2F3A48', 2.4);
      box(g, 6, 28, 16, 5, 2, '#3D4A5A', 2);
      poly(g, [[10, 4], [18, 4], [24, 30], [4, 30]], PAL.bruteAccent, 2.6);
      poly(g, [[11.5, 11], [16.5, 11], [18, 17], [10, 17]], PAL.cream, 1.6);
      poly(g, [[9, 21], [19, 21], [20.3, 26], [7.7, 26]], PAL.cream, 1.6);
      poly(g, [[11, 6], [13.2, 6], [10, 28], [8, 28]], 'rgba(255,255,255,0.28)', 0);
      line(g, 15, 6, 16, 9, shade(PAL.bruteAccent, -0.25), 1.2);
    });
  };

  RoadSprites.sandbag = function () {
    return bakeBottom('prop|sandbag', 58, 34, function (g) {
      ground(g, 29, 30, 21, 3.2);
      box(g, 3, 16, 26, 13, 6, '#B9A874', 2.5);
      box(g, 29, 16, 26, 13, 6, '#AE9D6B', 2.5);
      box(g, 14, 5, 30, 14, 7, '#C2B280', 2.5);
      line(g, 7, 22, 24, 22, '#8A7B50', 1.4);
      line(g, 33, 22, 50, 22, '#8A7B50', 1.4);
      line(g, 19, 12, 39, 12, '#8A7B50', 1.4);
      line(g, 14, 6, 12, 18, '#8A7B50', 1.2);
      line(g, 44, 6, 46, 18, '#8A7B50', 1.2);
      line(g, 8, 18.5, 22, 18.5, 'rgba(255,255,255,0.28)', 1.5);
      line(g, 36, 18.5, 50, 18.5, 'rgba(255,255,255,0.2)', 1.3);
      line(g, 19, 8, 37, 8, 'rgba(255,255,255,0.28)', 1.5);
    });
  };

  RoadSprites.barrier = function () {
    return bakeBottom('prop|barrier', 66, 40, function (g) {
      ground(g, 33, 36, 25, 3.7);
      poly(g, [[13, 20], [18, 20], [13, 37], [8, 37]], PAL.metal, 2.2);
      poly(g, [[48, 20], [53, 20], [58, 37], [53, 37]], PAL.metal, 2.2);
      box(g, 5, 33, 15, 4, 2, PAL.outline, 0);
      box(g, 46, 33, 15, 4, 2, PAL.outline, 0);
      stripedRect(g, 4, 9, 58, 21, 3, PAL.cream, PAL.hazard, 9, 2.6);
      box(g, 27, 4, 12, 7, 3, '#3A4757', 2);
      ell(g, 33, 5.5, 3.2, 2.3, 0, PAL.gold, 1.2);
      line(g, 14, 26, 22, 26, shade(PAL.hazard, -0.3), 1.2);
      line(g, 40, 26, 51, 26, shade(PAL.hazard, -0.28), 1.2);
      line(g, 8, 12, 57, 12, 'rgba(255,255,255,0.3)', 1.4);
    });
  };

  RoadSprites.car = function (variant) {
    var v = clampInt(variant, 0, 2);
    var colors = [PAL.hazard, PAL.gold, PAL.cyan];
    var body = colors[v];
    return bakeBottom('prop|car|' + v, 150, 78, function (g) {
      ground(g, 75, 71, 62, 5.5);
      var roofPts = v === 0
        ? [[38, 42], [50, 22], [94, 18], [112, 40]]
        : (v === 1
          ? [[36, 42], [54, 18], [104, 20], [116, 41]]
          : [[35, 42], [48, 24], [90, 20], [108, 40]]);
      poly(g, [[12, 42], [24, 38], [36, 41], [114, 40], [130, 39], [140, 48], [140, 63], [130, 69], [22, 69], [9, 61], [9, 49]], body, 2.8);
      poly(g, roofPts, shade(body, -0.16), 2.8);
      poly(g, [[45, 40], [54, 26], [68, 24], [67, 40]], '#23364A', 2.2);
      poly(g, [[73, 24], [91, 23], [99, 40], [72, 40]], '#23364A', 2.2);
      line(g, 58, 26, 54, 34, rgba(PAL.cyan, 0.85), 1.5);
      line(g, 54, 34, 60, 39, rgba(PAL.cyan, 0.8), 1.3);
      line(g, 79, 25, 84, 32, rgba(PAL.cyan, 0.8), 1.4);
      line(g, 84, 32, 80, 39, rgba(PAL.cyan, 0.75), 1.2);
      box(g, 132, 45, 8, 8, 2, PAL.cream, 2);
      box(g, 130, 57, 9, 5, 1.5, shade(body, -0.3), 1.8);
      box(g, 4, 58, 10, 6, 2, PAL.metal, 2.2);
      box(g, 136, 61, 9, 5, 2, PAL.metal, 2.2);

      var i, wx;
      for (i = 0; i < 2; i++) {
        wx = i === 0 ? 34 : 111;
        ell(g, wx, 64, 14, i === 0 ? 12 : 13, 0, PAL.outline, 0);
        ell(g, wx, 64, 11.5, i === 0 ? 9.5 : 10.5, 0, '#2A3441', 0);
        ell(g, wx, 64, 5.5, 5.5, 0, PAL.metal, 1.8);
        ell(g, wx, 64, 2.2, 2.2, 0, '#3F4D5D', 0);
      }

      ell(g, 26, 55, 6, 4, 0.3, '#8C4B32', 0);
      ell(g, 115, 55, 4.5, 3, -0.2, '#8C4B32', 0);
      line(g, 120, 44, 128, 50, '#8C4B32', 1.6);
      line(g, 24, 45, 126, 43, 'rgba(255,255,255,0.28)', 2);
      line(g, 44, 36, 104, 34, 'rgba(255,255,255,0.12)', 1.6);
    });
  };

  RoadSprites.lamp = function () {
    return bakeBottom('prop|lamp', 76, 134, function (g) {
      ground(g, 27, 130, 17, 3.4);
      var grd = g.createRadialGradient(52, 34, 2, 52, 34, 22);
      grd.addColorStop(0, rgba(PAL.gold, 0.42));
      grd.addColorStop(0.55, rgba(PAL.bruteAccent, 0.18));
      grd.addColorStop(1, rgba(PAL.bruteAccent, 0));
      g.fillStyle = grd;
      g.fillRect(28, 10, 48, 48);

      box(g, 16, 124, 22, 7, 2, PAL.metal, 2.4);
      box(g, 21, 116, 12, 9, 2, shade(PAL.metal, -0.18), 2.2);
      g.beginPath();
      g.moveTo(27, 120);
      g.lineTo(27, 54);
      g.quadraticCurveTo(27, 33, 48, 30);
      g.lineTo(53, 30);
      g.strokeStyle = PAL.outline;
      g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = PAL.metal;
      g.lineWidth = 4.6;
      g.stroke();
      poly(g, [[46, 26], [62, 28], [60, 38], [46, 38]], '#3A4757', 2.4);
      ell(g, 53, 39, 8, 3.6, 0, PAL.gold, 2.2);
      ell(g, 51, 38, 4, 1.8, 0, PAL.cream, 0);
      line(g, 27, 92, 27, 104, '#8C4B32', 1.6);
      line(g, 35, 31, 42, 27, '#8C4B32', 1.3);
      g.beginPath();
      g.moveTo(58, 34);
      g.bezierCurveTo(64, 44, 58, 48, 63, 54);
      g.strokeStyle = PAL.outline;
      g.lineWidth = 1.8;
      g.stroke();
      line(g, 25, 62, 25, 112, 'rgba(255,255,255,0.25)', 1.4);
    });
  };

  RoadSprites.fence = function () {
    return bakeBottom('prop|fence', 88, 64, function (g) {
      ground(g, 44, 60, 37, 3.2);
      box(g, 3, 7, 6, 52, 2, PAL.metal, 2.4);
      box(g, 79, 7, 6, 52, 2, PAL.metal, 2.4);
      box(g, 1.5, 54, 9, 6, 2, shade(PAL.metal, -0.24), 2.2);
      box(g, 77.5, 54, 9, 6, 2, shade(PAL.metal, -0.24), 2.2);
      box(g, 5, 11, 78, 4, 2, shade(PAL.metal, 0.12), 2);
      box(g, 5, 51, 78, 3.5, 2, shade(PAL.metal, -0.1), 2);
      g.save();
      g.beginPath();
      g.rect(7, 14, 74, 39);
      g.clip();
      var i;
      for (i = -46; i <= 92; i += 9) {
        line(g, i, 14, i + 40, 53, rgba(PAL.metal, 0.95), 1.4);
        line(g, i, 53, i + 40, 14, rgba(PAL.metal, 0.8), 1.4);
      }
      g.restore();
      line(g, 56, 21, 70, 38, shade(PAL.metal, 0.1), 1.8);
      line(g, 68, 18, 58, 34, shade(PAL.metal, 0.12), 1.7);
      line(g, 5, 12.5, 82, 12.5, 'rgba(255,255,255,0.32)', 1.2);
    });
  };

  RoadSprites.billboard = function (variant) {
    var v = clampInt(variant, 0, 2);
    var accents = [PAL.hazard, PAL.blue, PAL.gold];
    var backs = [PAL.cream, '#DCEAF5', '#F6E2B8'];
    var acc = accents[v];
    var back = backs[v];
    return bakeBottom('prop|billboard|' + v, 164, 140, function (g) {
      ground(g, 82, 134.5, 54, 4.5);
      box(g, 32, 78, 8, 58, 2, PAL.wood, 2.6);
      box(g, 124, 78, 8, 58, 2, PAL.wood, 2.6);
      line(g, 34, 88, 34, 128, shade(PAL.wood, -0.28), 1.4);
      line(g, 128, 88, 128, 128, shade(PAL.wood, -0.28), 1.4);

      poly(g, [[10, 12], [154, 9], [157, 82], [8, 86]], back, 3);
      poly(g, [[10, 12], [154, 9], [154, 18], [10, 21]], acc, 2.2);
      poly(g, [[20, 28], [144, 26], [145, 69], [20, 71]], 'rgba(255,255,255,0.26)', 1.6);
      poly(g, [[130, 10], [152, 9], [154, 34], [146, 31], [142, 20]], 'rgba(107,122,143,0.35)', 0);
      line(g, 22, 74, 31, 62, '#9C7B4A', 1.5);
      line(g, 31, 62, 35, 72, '#9C7B4A', 1.4);
      ell(g, 52, 61, 8, 5, -0.2, 'rgba(156,123,74,0.25)', 0);
      ell(g, 112, 57, 6, 4, 0.3, 'rgba(156,123,74,0.2)', 0);
      // 磨损铆钉
      ell(g, 17, 17, 1.5, 1.5, 0, PAL.metal, 0);
      ell(g, 147, 14, 1.5, 1.5, 0, PAL.metal, 0);
      ell(g, 17, 78, 1.5, 1.5, 0, PAL.metal, 0);
      ell(g, 148, 77, 1.5, 1.5, 0, PAL.metal, 0);
      // 底部危险条
      poly(g, [[11, 74], [155, 71], [156, 82], [10, 85]], acc, 2);
      line(g, 28, 81, 38, 75, PAL.paper, 2);
      line(g, 58, 80, 68, 74, PAL.paper, 2);
      line(g, 88, 79, 98, 73, PAL.paper, 2);
      line(g, 118, 78, 128, 72, PAL.paper, 2);
    });
  };

  RoadSprites.banner = function (variant) {
    var v = clampInt(variant, 0, 2);
    var cloths = [PAL.hazard, PAL.blue, PAL.gold];
    var cloth = cloths[v];
    var ink = v === 2 ? PAL.outline : PAL.cream;
    return bakeBottom('prop|banner|' + v, 144, 64, function (g) {
      // 吊绳
      g.beginPath();
      g.moveTo(8, 4);
      g.quadraticCurveTo(22, 10, 30, 14);
      g.moveTo(136, 4);
      g.quadraticCurveTo(122, 10, 114, 14);
      g.strokeStyle = PAL.outline;
      g.lineWidth = 3.2;
      g.stroke();
      g.strokeStyle = '#C9B58E';
      g.lineWidth = 1.8;
      g.stroke();
      // 布面（下缘撕裂）
      poly(g, [[24, 12], [120, 12], [124, 48], [116, 54], [108, 50], [100, 57], [90, 52], [80, 58], [70, 52], [60, 57], [50, 51], [40, 56], [30, 50], [20, 47]], cloth, 2.8);
      // 空白展示条（渲染器可叠字）
      poly(g, [[32, 22], [112, 22], [114, 40], [30, 40]], 'rgba(255,248,232,0.9)', 1.8);
      poly(g, [[32, 22], [112, 22], [112, 25], [32, 25]], rgba(ink === PAL.cream ? PAL.outline : PAL.cream, 0.35), 0);
      // 上沿缝线 + 金属环
      line(g, 26, 16, 118, 16, rgba(PAL.outline, 0.55), 1.4);
      ell(g, 27, 14, 3.2, 3.2, 0, PAL.gold, 1.6);
      ell(g, 117, 14, 3.2, 3.2, 0, PAL.gold, 1.6);
      // 磨损
      ell(g, 48, 49, 4, 2.4, 0.2, 'rgba(27,36,48,0.18)', 0);
      ell(g, 94, 45, 3.4, 2.2, -0.2, 'rgba(27,36,48,0.2)', 0);
      line(g, 60, 45, 64, 38, 'rgba(27,36,48,0.25)', 1.2);
      line(g, 104, 46, 100, 39, 'rgba(27,36,48,0.22)', 1.2);
    });
  };

  // =============================================================
  // 弹道 / 枪口焰 / 爆炸
  // =============================================================
  var TIERS = [null,
    { core: '#F2C94C', glow: '#FFD166' },
    { core: '#FF9F1C', glow: '#FFB35C' },
    { core: '#56CCF2', glow: '#9BE7FF' },
    { core: '#D946EF', glow: '#F0A6FF' },
    { core: '#FF5C8A', glow: '#FF9AAF' },
    { core: '#6FE7C8', glow: '#B8FFF0' }
  ];

  function glowSpot(g, cx, cy, r, color, a) {
    var grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, rgba(color, a == null ? 0.5 : a));
    grd.addColorStop(0.45, rgba(color, (a == null ? 0.5 : a) * 0.42));
    grd.addColorStop(1, rgba(color, 0));
    g.fillStyle = grd;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  RoadSprites.bullet = function (tier) {
    var t = clampInt(tier, 1, 6);
    var c = TIERS[t].core;
    var gl = TIERS[t].glow;
    var sizes = [null, [24, 14], [28, 20], [30, 22], [34, 18], [28, 26], [34, 26]];
    var w = sizes[t][0], h = sizes[t][1];
    return bakeCenter('bullet|' + t, w, h, function (g) {
      var cx = w / 2, cy = h / 2;
      // 辉光半径内收，保证紧画布下也不切边，同时让弹体在屏幕尺寸更醒目
      glowSpot(g, cx, cy, Math.min(w, h) * 0.42, gl, 0.55);

      if (t === 1) {
        // 黄色手枪弹
        box(g, 5, cy - 2.6, 12, 5.2, 2.6, c, 1.8);
        poly(g, [[15, cy - 3], [20, cy], [15, cy + 3]], PAL.cream, 1.6);
        line(g, 7, cy - 1.2, 15, cy - 1.2, 'rgba(255,255,255,0.6)', 1.1);
      } else if (t === 2) {
        // 橙色双发
        box(g, 8, cy - 7, 12, 4.6, 2.2, c, 1.6);
        poly(g, [[19, cy - 7.2], [24, cy - 4.7], [19, cy - 2.4]], PAL.cream, 1.4);
        box(g, 6, cy + 2.4, 12, 4.6, 2.2, shade(c, -0.08), 1.6);
        poly(g, [[17, cy + 2.2], [22, cy + 4.7], [17, cy + 7.2]], PAL.cream, 1.4);
        line(g, 9, cy - 5, 16, cy - 5, 'rgba(255,255,255,0.5)', 1);
      } else if (t === 3) {
        // 青色三向散射
        var angs = [-0.38, 0, 0.38], i, a, sx, sy, ex, ey;
        for (i = 0; i < 3; i++) {
          a = angs[i];
          sx = cx - 8;
          sy = cy + Math.sin(a) * 9;
          ex = cx + 9;
          ey = cy + Math.sin(a) * 9;
          g.lineCap = 'round';
          g.strokeStyle = PAL.outline;
          g.lineWidth = 5.4;
          g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
          g.strokeStyle = c;
          g.lineWidth = 3;
          g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
          ell(g, ex, ey, 2.6, 2.6, 0, PAL.cream, 1.2);
        }
      } else if (t === 4) {
        // 品红穿刺针
        poly(g, [[4, cy - 2], [20, cy - 4], [30, cy], [20, cy + 4], [4, cy + 2]], c, 1.8);
        line(g, 6, cy, 26, cy, PAL.cream, 1.6);
        poly(g, [[4, cy - 2], [9, cy - 7], [10, cy - 2]], shade(c, 0.25), 1.4);
        poly(g, [[4, cy + 2], [9, cy + 7], [10, cy + 2]], shade(c, 0.25), 1.4);
      } else if (t === 5) {
        // 粉红爆裂弹
        ell(g, cx + 2, cy, 9, 8.5, 0, c, 2.2);
        ell(g, cx + 2, cy, 5, 5, 0, PAL.gold, 0);
        box(g, cx - 9, cy - 2, 5, 4, 1.5, PAL.metal, 1.6);
        line(g, cx - 10, cy - 4, cx - 7, cy - 7, PAL.bruteAccent, 1.8);
        ell(g, cx - 7, cy - 7, 1.7, 1.7, 0, PAL.cream, 0);
        line(g, cx - 11, cy - 7, cx - 7, cy - 4, PAL.bruteAccent, 1.4);
        ell(g, cx - 1, cy - 3, 2.6, 1.7, -0.5, 'rgba(255,255,255,0.55)', 0);
      } else {
        // 薄荷等离子彗星：长尾焰 + 亮核
        poly(g, [
          [cx - 15, cy], [cx - 9, cy - 7], [cx - 5, cy - 3], [cx, cy - 8],
          [cx + 4, cy - 5], [cx + 7, cy], [cx + 4, cy + 5], [cx, cy + 8],
          [cx - 5, cy + 3], [cx - 9, cy + 7]
        ], c, 1.8);
        poly(g, [
          [cx - 11, cy], [cx - 6, cy - 3.2], [cx - 2, cy], [cx - 6, cy + 3.2]
        ], PAL.cream, 0);
        ell(g, cx + 7, cy, 6.5, 6.2, 0, c, 2.2);
        ell(g, cx + 7, cy - 1.4, 3.4, 3, 0, PAL.cream, 0);
        ell(g, cx + 8, cy - 2, 1.7, 1.5, 0, '#FFFFFF', 0);
        ell(g, cx - 13, cy - 5, 1.6, 1.6, 0, PAL.cream, 0);
        ell(g, cx - 14, cy + 3, 1.2, 1.2, 0, c, 0);
        line(g, cx - 11, cy + 6, cx - 4, cy + 8, rgba(PAL.cream, 0.5), 1.1);
      }
    });
  };

  RoadSprites.muzzle = function (tier) {
    var t = clampInt(tier, 1, 6);
    var c = TIERS[t].core;
    var gl = TIERS[t].glow;
    return bakeCenter('muzzle|' + t, 46, 42, function (g) {
      var cx = 22, cy = 21;
      glowSpot(g, cx + 2, cy, 19, gl, 0.62);

      if (t === 1) {
        // 单星 + 短锥
        poly(g, [[cx + 1, cy - 6], [42, cy - 9], [39, cy], [42, cy + 9], [cx + 1, cy + 6]], c, 2);
        starPath(g, cx, cy, 5, 11, 4.5, -0.2);
        g.fillStyle = c; g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 1.8; g.stroke();
        starPath(g, cx, cy, 5, 5.5, 2.3, -0.2);
        g.fillStyle = PAL.cream; g.fill();
      } else if (t === 2) {
        // 双星
        starPath(g, cx - 2, cy - 6, 5, 8, 3.2, 0.1);
        g.fillStyle = c; g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 1.8; g.stroke();
        starPath(g, cx + 2, cy + 6, 5, 9, 3.4, -0.1);
        g.fillStyle = shade(c, 0.12); g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 1.8; g.stroke();
        poly(g, [[cx + 1, cy - 5], [41, cy - 12], [36, cy - 1], [41, cy + 12], [cx + 1, cy + 5]], rgba(c, 0.9), 2);
        ell(g, cx + 2, cy, 4, 4, 0, PAL.cream, 0);
      } else if (t === 3) {
        // 三叉青色
        var angs = [-0.26, 0, 0.26], i, a;
        for (i = 0; i < 3; i++) {
          a = angs[i];
          poly(g, [
            [cx - 2, cy + Math.sin(a) * 10 - 3],
            [cx + 20 * Math.cos(a), cy + 20 * Math.sin(a)],
            [cx - 2, cy + Math.sin(a) * 10 + 3]
          ], c, 1.9);
        }
        starPath(g, cx, cy, 6, 10, 4, 0.2);
        g.fillStyle = shade(c, 0.3); g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 1.8; g.stroke();
        ell(g, cx, cy, 3.4, 3.4, 0, PAL.cream, 0);
      } else if (t === 4) {
        // 长针
        poly(g, [[cx - 6, cy - 4], [43, cy], [cx - 6, cy + 4]], c, 2);
        poly(g, [[cx - 6, cy - 4], [cx - 3, cy - 11], [cx + 3, cy - 4]], shade(c, 0.3), 1.8);
        poly(g, [[cx - 6, cy + 4], [cx - 3, cy + 11], [cx + 3, cy + 4]], shade(c, 0.3), 1.8);
        ell(g, cx, cy, 4.4, 4.4, 0, PAL.cream, 0);
      } else if (t === 5) {
        // 圆爆
        starPath(g, cx, cy, 8, 14, 8, 0.3);
        g.fillStyle = c; g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 2; g.stroke();
        ell(g, cx, cy, 7, 7, 0, PAL.gold, 1.8);
        ell(g, cx, cy, 3.4, 3.4, 0, PAL.cream, 0);
        ell(g, 9, 9, 2.2, 2.2, 0, c, 1.2);
        ell(g, 38, 33, 2.8, 2.8, 0, shade(c, 0.25), 1.3);
      } else {
        // 薄荷等离子弧
        g.strokeStyle = rgba(PAL.cream, 0.88);
        g.lineWidth = 2;
        g.beginPath(); g.ellipse(cx, cy, 15, 9, -0.2, -2.3, -0.7); g.stroke();
        g.beginPath(); g.ellipse(cx, cy, 15, 9, -0.2, 0.7, 2.3); g.stroke();
        starPath(g, cx + 2, cy, 6, 12, 5, 0.15);
        g.fillStyle = c; g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 2; g.stroke();
        poly(g, [[cx + 2, cy - 5], [42, cy - 8], [38, cy], [42, cy + 8], [cx + 2, cy + 5]], c, 1.8);
        ell(g, cx + 2, cy, 5, 5, 0, PAL.cream, 0);
        ell(g, cx + 2, cy, 2.4, 2.4, 0, '#FFFFFF', 0);
      }
    });
  };

  function smokePuff(g, cx, cy, r, color, alpha) {
    ell(g, cx, cy, r, r * 0.92, 0, rgba(color, alpha), 0);
    ell(g, cx - r * 0.25, cy - r * 0.25, r * 0.48, r * 0.4, -0.4, 'rgba(255,255,255,0.12)', 0);
  }

  RoadSprites.explosion = function (frame) {
    var f = clampInt(frame, 0, 5);
    return bakeCenter('explosion|' + f, 112, 112, function (g) {
      var cx = 56, cy = 56, i, a;
      if (f === 0) {
        glowSpot(g, cx, cy, 30, '#FFD166', 0.7);
        starPath(g, cx, cy, 7, 22, 8, 0.2);
        g.fillStyle = '#FFD166'; g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 2.4; g.stroke();
        starPath(g, cx, cy, 7, 12, 4.5, 0.2);
        g.fillStyle = '#FFF4DC'; g.fill();
        ell(g, cx, cy, 7, 7, 0, '#FFFFFF', 0);
      } else if (f === 1) {
        glowSpot(g, cx, cy, 40, '#FF9F1C', 0.55);
        var pts = 11;
        starPath(g, cx, cy, pts, 32, 17, 0.15);
        g.fillStyle = '#FF9F1C'; g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 2.6; g.stroke();
        starPath(g, cx, cy, 8, 22, 12, 0.3);
        g.fillStyle = '#F2C94C'; g.fill();
        ell(g, cx - 2, cy - 3, 10, 8, 0, '#FFF4DC', 0);
        ell(g, cx + 30, cy - 24, 5, 4, 0, '#FFD166', 1.4);
        ell(g, cx - 32, cy + 22, 4, 3.4, 0, '#FF9F1C', 1.2);
        ell(g, cx + 18, cy + 31, 3.4, 3, 0, '#FFD166', 1.1);
      } else if (f === 2) {
        glowSpot(g, cx, cy, 46, '#FF9F1C', 0.4);
        var j;
        for (j = 0; j < 8; j++) {
          a = (j / 8) * Math.PI * 2 + 0.15;
          smokePuff(g, cx + Math.cos(a) * 33, cy + Math.sin(a) * 31, 13, PAL.smoke, 0.75);
        }
        starPath(g, cx, cy, 9, 35, 20, 0.25);
        g.fillStyle = '#E63946'; g.fill();
        g.strokeStyle = PAL.outline; g.lineWidth = 2.6; g.stroke();
        starPath(g, cx, cy, 8, 25, 15, 0.35);
        g.fillStyle = '#FF9F1C'; g.fill();
        ell(g, cx - 2, cy - 2, 13, 11, 0, '#F2C94C', 0);
        ell(g, cx - 3, cy - 4, 7, 6, 0, '#FFF4DC', 0);
      } else if (f === 3) {
        // 连贯烟环 + 边缘火屑
        g.strokeStyle = 'rgba(27,36,48,0.4)';
        g.lineWidth = 26;
        g.beginPath(); g.arc(cx, cy + 2, 30, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = rgba('#77828F', 0.92);
        g.lineWidth = 20;
        g.beginPath(); g.arc(cx, cy, 30, 0, Math.PI * 2); g.stroke();
        for (i = 0; i < 9; i++) {
          a = (i / 9) * Math.PI * 2 + 0.3;
          smokePuff(g, cx + Math.cos(a) * 30, cy + Math.sin(a) * 28, 14 + (i % 3) * 2, '#77828F', 0.95);
        }
        for (i = 0; i < 5; i++) {
          a = (i / 5) * Math.PI * 2 - 0.4;
          ell(g, cx + Math.cos(a) * 19, cy + Math.sin(a) * 17, 5, 4, 0, rgba('#FF9F1C', 0.8), 0);
        }
        ell(g, cx, cy, 14, 12, 0, rgba('#3A404C', 0.72), 0);
        ell(g, cx - 4, cy - 5, 9, 6, 0, rgba('#FFD166', 0.4), 0);
      } else if (f === 4) {
        g.strokeStyle = 'rgba(27,36,48,0.24)';
        g.lineWidth = 20;
        g.beginPath(); g.arc(cx, cy + 1, 33, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = rgba('#7D8896', 0.82);
        g.lineWidth = 15;
        g.beginPath(); g.arc(cx, cy + 1, 33, 0, Math.PI * 2); g.stroke();
        for (i = 0; i < 8; i++) {
          a = (i / 8) * Math.PI * 2 + 0.1;
          smokePuff(g, cx + Math.cos(a) * 33, cy + Math.sin(a) * 30 - 2, 14 + (i % 4) * 2.2, '#7D8896', 0.86);
        }
        for (i = 0; i < 5; i++) {
          a = (i / 5) * Math.PI * 2 + 0.5;
          smokePuff(g, cx + Math.cos(a) * 33 - 3, cy + Math.sin(a) * 29 - 5, 7, '#A9B3BF', 0.46);
        }
        ell(g, cx, cy, 18, 15, 0, rgba('#4B5563', 0.45), 0);
      } else {
        // 消散：断开的烟弧
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(27,36,48,0.18)';
        g.lineWidth = 15;
        for (i = 0; i < 5; i++) {
          a = (i / 5) * Math.PI * 2 + 0.2;
          g.beginPath(); g.arc(cx, cy - 2, 37, a, a + 0.78); g.stroke();
        }
        g.strokeStyle = 'rgba(149,160,172,0.68)';
        g.lineWidth = 11;
        for (i = 0; i < 5; i++) {
          a = (i / 5) * Math.PI * 2 + 0.2;
          g.beginPath();
          g.arc(cx, cy - 2, 37, a, a + 0.78);
          g.stroke();
        }
        for (i = 0; i < 6; i++) {
          a = (i / 6) * Math.PI * 2 + 0.4;
          smokePuff(g, cx + Math.cos(a) * 37, cy + Math.sin(a) * 31 - 7, 11 + (i % 3) * 3, '#95A0AC', 0.58);
        }
        ell(g, cx - 2, cy - 8, 16, 11, 0, rgba('#95A0AC', 0.24), 0);
      }
    });
  };

  // =============================================================
  // 视差云
  // =============================================================
  var CLOUD_SHAPES = [
    [[52, 62, 28], [86, 47, 33], [124, 52, 37], [163, 63, 27], [108, 69, 29], [70, 38, 19], [146, 37, 21]],
    [[68, 57, 26], [103, 40, 30], [139, 46, 33], [172, 61, 24], [91, 70, 25], [129, 73, 27], [157, 30, 16]],
    [[54, 57, 25], [76, 44, 27], [103, 58, 23], [139, 45, 25], [166, 57, 29], [127, 66, 26], [184, 42, 15]],
    [[54, 61, 19], [85, 49, 25], [117, 56, 27], [149, 45, 23], [180, 61, 19], [100, 71, 22], [137, 73, 20]]
  ];

  RoadSprites.cloud = function (variant) {
    var v = clampInt(variant, 0, 3);
    var shapes = CLOUD_SHAPES[v];
    return bakeBottom('cloud|' + v, 220, 104, function (g) {
      var i, s;
      // 底部阴影层（云底压深，避免一团死白）
      for (i = 0; i < shapes.length; i++) {
        s = shapes[i];
        ell(g, s[0], s[1] + 5, s[2], s[2] * 0.78, 0, '#C9DCE4', 0);
      }
      // 主云体
      for (i = 0; i < shapes.length; i++) {
        s = shapes[i];
        ell(g, s[0], s[1], s[2], s[2] * 0.9, 0, PAL.cream, 0);
      }
      // 顶部受光
      for (i = 0; i < shapes.length; i += 2) {
        s = shapes[i];
        ell(g, s[0] - s[2] * 0.22, s[1] - s[2] * 0.36, s[2] * 0.55, s[2] * 0.32, -0.25, 'rgba(255,255,255,0.7)', 0);
      }
      // 少量微暖反光
      for (i = 1; i < shapes.length; i += 3) {
        s = shapes[i];
        ell(g, s[0] + s[2] * 0.2, s[1] + s[2] * 0.42, s[2] * 0.44, s[2] * 0.2, 0, 'rgba(242,201,76,0.08)', 0);
      }
    });
  };

  // =============================================================
  // 天际线（宽幅背景条，顶部透明）
  // =============================================================
  var SKY_THEMES = {
    day: {
      far: '#B8D6D1', mount: '#8FB3B1', mountHi: '#A9CBC9',
      mid: '#6F95AB', near: '#3F6178', roof: '#33536A',
      win: '#FFF4DC', winA: 0.62, haze: null,
      rubble: '#2C4859', seed: 17
    },
    sunset: {
      far: '#D2A5B8', mount: '#A9779B', mountHi: '#C28AA6',
      mid: '#805778', near: '#4A2F4F', roof: '#3D263F',
      win: '#FFD166', winA: 0.9, haze: 'rgba(255,159,28,0.10)',
      rubble: '#35213A', seed: 41
    },
    night: {
      far: '#39406B', mount: '#272D4D', mountHi: '#2E3558',
      mid: '#1D2440', near: '#11162A', roof: '#0C1120',
      win: '#F2C94C', winA: 0.92, haze: null,
      rubble: '#0B0F1E', seed: 73
    }
  };

  function cityLayer(g, cfg, rnd, base, minH, maxH, bodyColor, roofColor, withWindows, winScale) {
    var x = -8, w, h, top, i, j, wx, wy, lit;
    while (x < 1032) {
      w = 24 + Math.floor(rnd() * 52);
      h = minH + Math.floor(rnd() * (maxH - minH));
      top = base - h;
      // 主体
      g.fillStyle = bodyColor;
      g.fillRect(x, top, w, h);
      // 阶梯 / 断口屋顶
      if (rnd() < 0.34) {
        var sw = w * (0.36 + rnd() * 0.3);
        var sh = 8 + rnd() * 16;
        g.fillRect(x + (w - sw) / 2, top - sh, sw, sh);
        if (rnd() < 0.5) {
          g.fillStyle = roofColor;
          g.fillRect(x + (w - sw) / 2, top - sh - 4, sw, 4);
        }
      }
      if (rnd() < 0.22) {
        // 破损斜顶
        poly(g, [
          [x, top + 7], [x + w * 0.45, top], [x + w, top + 13], [x + w, top + 30], [x, top + 30]
        ], bodyColor, 0);
      }
      // 屋顶设备
      if (rnd() < 0.4) {
        var tx = x + 5 + rnd() * Math.max(1, w - 16);
        g.fillStyle = roofColor;
        g.fillRect(tx, top - 7, 6 + rnd() * 5, 7);
      }
      // 天线
      if (h > (minH + maxH) * 0.55 && rnd() < 0.45) {
        var ax = x + w * (0.3 + rnd() * 0.4);
        g.strokeStyle = roofColor;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(ax, top);
        g.lineTo(ax, top - 13 - rnd() * 18);
        g.stroke();
        g.beginPath();
        g.moveTo(ax - 4, top - 12);
        g.lineTo(ax + 4, top - 12);
        g.stroke();
      }
      // 窗
      if (withWindows) {
        var stepX = Math.max(6, winScale * 6.2);
        var stepY = Math.max(8, winScale * 8.4);
        for (wy = top + 10; wy < base - 8; wy += stepY) {
          for (wx = x + 5; wx < x + w - 4; wx += stepX) {
            lit = rnd();
            if (lit < 0.52) {
              g.fillStyle = rgba(cfg.win, cfg.winA * (0.4 + rnd() * 0.6));
              g.fillRect(wx, wy, 2.6, 3.6);
            } else if (lit < 0.64) {
              g.fillStyle = 'rgba(86,204,242,0.35)';
              g.fillRect(wx, wy, 2.6, 3.6);
            }
          }
        }
      }
      x += w + (rnd() < 0.2 ? 3 + rnd() * 8 : 0);
    }
  }

  RoadSprites.skyline = function (theme) {
    var name = (theme === 'sunset' || theme === 'night') ? theme : 'day';
    var cfg = SKY_THEMES[name];
    return bakeBottom('skyline|' + name, 1024, 220, function (g) {
      var base = 220;
      var rnd = prng(cfg.seed);

      // 远山
      var ridge = [
        [0, 184], [62, 150], [128, 112], [190, 146], [246, 96], [318, 142],
        [382, 126], [452, 80], [520, 130], [586, 150], [654, 104], [724, 140],
        [790, 118], [858, 156], [918, 108], [980, 138], [1024, 122]
      ];
      var pts = [[0, base]], i;
      for (i = 0; i < ridge.length; i++) pts.push(ridge[i]);
      pts.push([1024, base]);
      poly(g, pts, cfg.mount, 0);

      // 山脊受光
      g.strokeStyle = cfg.mountHi;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, 186);
      for (i = 1; i < ridge.length; i++) {
        g.lineTo(ridge[i][0], ridge[i][1] + 2);
      }
      g.stroke();

      // 远处低丘
      var hill = [[0, base], [0, 192], [120, 178], [215, 186], [330, 170], [440, 188], [560, 176], [690, 190], [820, 174], [940, 186], [1024, 178], [1024, base]];
      poly(g, hill, cfg.far, 0);

      // 远景城市
      cityLayer(g, cfg, prng(cfg.seed + 5), base, 34, 82, cfg.mid, cfg.mid, true, 0.75);

      // 夜空星点（不铺底，保持顶部透明）
      if (name === 'night') {
        var sr = prng(cfg.seed + 99);
        for (i = 0; i < 34; i++) {
          var sx = sr() * 1016 + 4;
          var sy = 8 + sr() * 104;
          var ss = sr() < 0.15 ? 1.6 : 1;
          g.fillStyle = rgba(PAL.cream, 0.45 + sr() * 0.45);
          g.fillRect(sx, sy, ss, ss);
        }
      }

      // 近景城市
      cityLayer(g, cfg, prng(cfg.seed + 21), base, 58, 152, cfg.near, cfg.roof, true, 1);

      // 地标：水塔 / 吊塔（固定位置，避免重复感）
      var tx = name === 'sunset' ? 742 : (name === 'night' ? 286 : 812);
      g.fillStyle = cfg.roof;
      g.fillRect(tx, 118, 5, 92);
      g.beginPath();
      g.moveTo(tx - 22, 112);
      g.lineTo(tx - 16, 88);
      g.lineTo(tx + 20, 88);
      g.lineTo(tx + 26, 112);
      g.closePath();
      g.fill();
      g.fillRect(tx - 22, 112, 48, 8);
      g.strokeStyle = cfg.roof;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(tx - 18, 120);
      g.lineTo(tx + 20, 120);
      g.stroke();

      // 地平线雾/暖光
      if (cfg.haze) {
        g.fillStyle = cfg.haze;
        g.fillRect(0, 176, 1024, 44);
      }

      // 底部瓦砾带
      g.fillStyle = cfg.rubble;
      g.fillRect(0, 210, 1024, 10);
      var rr = prng(cfg.seed + 55);
      for (i = 0; i < 46; i++) {
        var bx = rr() * 1020;
        var bw = 8 + rr() * 26;
        var bh = 3 + rr() * 6;
        g.fillRect(bx, 210 - bh, bw, bh + 1);
      }
    });
  };

  // =============================================================
  // 关卡门图标
  // =============================================================
  RoadSprites.gateIcon = function (kind) {
    var k = (kind === 'multiply' || kind === 'divide' || kind === 'weapon' || kind === 'fireRate') ? kind : 'people';
    var accents = {
      people: PAL.cyan,
      multiply: PAL.hazard,
      divide: PAL.mother,
      weapon: PAL.gold,
      fireRate: PAL.bruteAccent
    };
    var acc = accents[k];
    return bakeCenter('gate|' + k, 48, 48, function (g) {
      ell(g, 24, 25.5, 19, 19, 0, 'rgba(11,17,27,0.18)', 0);
      ell(g, 24, 24, 20, 20, 0, PAL.cream, 2.8);
      g.beginPath();
      g.arc(24, 24, 16.2, 0, Math.PI * 2);
      g.strokeStyle = acc;
      g.lineWidth = 2.4;
      g.stroke();

      var i;
      if (k === 'people') {
        // 后景人物
        ell(g, 28.5, 17.5, 4.4, 4.4, 0, PAL.outline, 0);
        poly(g, [[23.5, 23], [33.5, 23], [35, 32.5], [22, 32.5]], PAL.outline, 0);
        // 前景人物
        ell(g, 19, 18.5, 4.8, 4.8, 0, acc, 1.8);
        poly(g, [[13.5, 24.5], [24.5, 24.5], [26, 34], [12, 34]], PAL.blue, 2);
        ell(g, 18, 27.5, 2, 1.8, 0, 'rgba(255,255,255,0.35)', 0);
      } else if (k === 'multiply') {
        capsule(g, 15, 15, 33, 33, 7.5, PAL.outline, 0);
        capsule(g, 33, 15, 15, 33, 7.5, PAL.outline, 0);
        capsule(g, 15, 15, 33, 33, 3.4, acc, 0);
        capsule(g, 33, 15, 15, 33, 3.4, acc, 0);
      } else if (k === 'divide') {
        box(g, 13, 22.2, 22, 3.8, 1.6, PAL.outline, 0);
        ell(g, 24, 14.5, 3.8, 3.8, 0, acc, 1.8);
        ell(g, 24, 33.5, 3.8, 3.8, 0, acc, 1.8);
      } else if (k === 'weapon') {
        // 简化步枪
        poly(g, [[11, 22], [18, 20], [19, 25], [14, 28]], PAL.wood, 2);
        box(g, 17, 19.5, 13, 7, 1.5, '#3A4757', 2.2);
        box(g, 28, 20.5, 9, 4, 1, PAL.metal, 1.8);
        box(g, 21, 26, 4.5, 6.5, 1, PAL.outline, 1.4);
        line(g, 19, 22, 27, 22, 'rgba(255,255,255,0.35)', 1.2);
        ell(g, 34.5, 22.5, 1.8, 1.8, 0, acc, 1);
      } else {
        // 射速：闪电 + 速度线
        poly(g, [[25, 10], [16, 24], [22.5, 24], [19, 38], [31, 21], [24, 21], [29, 10]], acc, 2.4);
        line(g, 12, 17, 7, 17, PAL.outline, 2);
        line(g, 12, 23, 8, 23, PAL.outline, 1.8);
        line(g, 13, 29, 10, 29, PAL.outline, 1.6);
      }
    });
  };

  // =============================================================
  // 简易 UI 图标（居中锚点）
  // =============================================================
  RoadSprites.icon = function (name) {
    var n = (name === 'heart' || name === 'gun' || name === 'pause' || name === 'crowd') ? name : 'crowd';
    return bakeCenter('icon|' + n, 30, 30, function (g) {
      var cx = 15, cy = 15, i;
      if (n === 'crowd') {
        ell(g, 11, 11, 4.3, 4.3, 0, PAL.cream, 2);
        poly(g, [[5, 25], [7, 17], [11, 16], [15, 17], [17, 25]], PAL.cream, 2);
        ell(g, 20, 10, 4, 4, 0, PAL.cream, 2);
        poly(g, [[14.5, 24], [16.5, 16], [20, 15], [24, 16], [25.5, 24]], PAL.cream, 2);
        line(g, 10, 20, 13, 20, PAL.outline, 1.4);
      } else if (n === 'heart') {
        g.beginPath();
        g.moveTo(15, 24);
        g.bezierCurveTo(5, 17, 4, 9, 9, 7.5);
        g.bezierCurveTo(12, 6.8, 14, 9.5, 15, 11.5);
        g.bezierCurveTo(16, 9.5, 18, 6.8, 21, 7.5);
        g.bezierCurveTo(26, 9, 25, 17, 15, 24);
        g.closePath();
        g.fillStyle = PAL.hazard;
        g.fill();
        g.strokeStyle = PAL.outline;
        g.lineWidth = 2.2;
        g.stroke();
        ell(g, 10.5, 11.5, 2.6, 1.8, -0.5, 'rgba(255,255,255,0.55)', 0);
      } else if (n === 'gun') {
        poly(g, [[3, 15], [8, 13.5], [9, 17], [5, 19]], PAL.wood, 1.8);
        box(g, 8, 12.5, 12, 5.5, 1.2, '#3A4757', 2);
        box(g, 19, 13.5, 8, 3.4, 1, PAL.metal, 1.6);
        box(g, 12, 17.5, 4, 5, 1, PAL.outline, 1.2);
        line(g, 10, 14.4, 18, 14.4, 'rgba(255,255,255,0.4)', 1);
        ell(g, 24, 15, 1.4, 1.4, 0, PAL.gold, 0);
      } else {
        box(g, 8, 7, 5.5, 16, 2, PAL.cream, 2.2);
        box(g, 16.5, 7, 5.5, 16, 2, PAL.cream, 2.2);
      }
    });
  };

  // 供外部调试/扩展使用
  RoadSprites.pad = PAD;
  RoadSprites.shade = shade;
  RoadSprites.rgba = rgba;
})();
