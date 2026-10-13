/* ============================================================
   转刀生存 — 精灵烘焙层 (window.Sprites)
   所有发光/圆环/形状预先烘焙到离屏 canvas，按 颜色+尺寸 缓存。
   运行时只做 drawImage，禁止逐实体 shadowBlur、禁止逐帧渐变。
   传统脚本，必须在 engine.js 之后、render.js 之前加载。
   ============================================================ */
(function () {
  'use strict';

  var Sprites = {};
  window.Sprites = Sprites;

  var scale = 1;                 // 设备像素比（上限 2），改变时清空缓存
  var cache = Object.create(null);
  var PAD = 2;                   // 逻辑内边距，避免发光被裁切

  // -------------------------------------------------------------
  // 颜色工具
  // -------------------------------------------------------------
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

  // amt > 0 提亮趋白，amt < 0 压暗
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

  Sprites.rgba = rgba;

  // -------------------------------------------------------------
  // 缓存与构建
  // -------------------------------------------------------------
  function configure(s) {
    if (!(s > 0)) s = 1;
    if (s > 2) s = 2;
    if (s < 1) s = 1;
    if (s !== scale) {
      scale = s;
      cache = Object.create(null);
    }
  }
  Sprites.configure = configure;
  Sprites.scale = function () { return scale; };

  function newCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * scale));
    c.height = Math.max(1, Math.ceil(h * scale));
    var g = c.getContext('2d');
    g.scale(scale, scale);
    return { cv: c, g: g };
  }

  // draw(g, w, h)；ox/oy 为旋转/裁切原点（逻辑单位，相对左上角）
  function build(key, w, h, ox, oy, draw) {
    var hit = cache[key];
    if (hit) return hit;
    var c = newCanvas(w, h);
    draw(c.g, w, h);
    var spr = { cv: c.cv, w: w, h: h, ox: (ox == null ? w / 2 : ox), oy: (oy == null ? h / 2 : oy) };
    cache[key] = spr;
    return spr;
  }

  // 把精灵以 x,y 为中心绘制到 ctx（逻辑坐标由调用方已设好变换）
  function draw(ctx, spr, x, y, s, alpha, rot) {
    s = s || 1;
    if (alpha != null && alpha < 1) ctx.globalAlpha = alpha;
    var w = spr.w * s, h = spr.h * s;
    if (rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(spr.cv, -spr.ox * s, -spr.oy * s, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(spr.cv, x - spr.ox * s, y - spr.oy * s, w, h);
    }
    if (alpha != null && alpha < 1) ctx.globalAlpha = 1;
  }
  Sprites.draw = draw;

  Sprites.clear = function () { cache = Object.create(null); };

  // -------------------------------------------------------------
  // 基础形状（离屏烘焙）
  // -------------------------------------------------------------

  // 柔和光晕（叠加时用 lighter）
  Sprites.glow = function (color, radius) {
    radius = Math.max(4, radius);
    var key = 'glow|' + color + '|' + radius;
    var size = radius * 2 + PAD * 2;
    return build(key, size, size, null, null, function (g, w, h) {
      var cx = w / 2, cy = h / 2;
      var grd = g.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grd.addColorStop(0.0, rgba(color, 0.85));
      grd.addColorStop(0.28, rgba(color, 0.42));
      grd.addColorStop(0.6, rgba(color, 0.13));
      grd.addColorStop(1.0, rgba(color, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
  };

  // 实心圆体 + 描边环 + 高光点（普通怪/精英/Boss/玩家球心都用它）
  Sprites.disc = function (color, radius, rimColor) {
    radius = Math.max(2, radius);
    var key = 'disc|' + color + '|' + radius + '|' + (rimColor || '');
    var size = radius * 2 + PAD * 2;
    return build(key, size, size, null, null, function (g, w, h) {
      var cx = w / 2, cy = h / 2;
      var grd = g.createRadialGradient(cx - radius * 0.34, cy - radius * 0.4, radius * 0.1, cx, cy, radius);
      grd.addColorStop(0, shade(color, 0.42));
      grd.addColorStop(0.65, color);
      grd.addColorStop(1, shade(color, -0.42));
      g.beginPath();
      g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.fillStyle = grd;
      g.fill();
      if (rimColor) {
        g.lineWidth = Math.max(1, radius * 0.2);
        g.strokeStyle = rimColor;
        g.stroke();
      }
      // 高光
      g.beginPath();
      g.arc(cx - radius * 0.34, cy - radius * 0.38, radius * 0.24, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fill();
    });
  };

  // 描边圆环（精英光环）
  Sprites.ring = function (color, radius, width) {
    radius = Math.max(3, radius);
    width = Math.max(1, width);
    var key = 'ring|' + color + '|' + radius + '|' + width;
    var size = radius * 2 + width * 2 + PAD * 2;
    return build(key, size, size, null, null, function (g, w, h) {
      var cx = w / 2, cy = h / 2;
      // 外柔光
      g.lineWidth = width * 2.6;
      g.strokeStyle = rgba(color, 0.16);
      g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2); g.stroke();
      // 主环
      g.lineWidth = width;
      g.strokeStyle = rgba(color, 0.85);
      g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2); g.stroke();
      // 内亮线
      g.lineWidth = Math.max(1, width * 0.5);
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.arc(cx, cy, radius - width * 0.35, 0, Math.PI * 2); g.stroke();
    });
  };

  // 锥形刀刃：底在原点一侧，尖端朝 +x 方向。角度 0 = +x。
  Sprites.blade = function (color, L, W, coreColor) {
    L = Math.max(8, L); W = Math.max(4, W);
    coreColor = coreColor || '#ffffff';
    var key = 'blade|' + color + '|' + L + '|' + W + '|' + coreColor;
    var w = L + W + PAD * 2;
    var h = W * 2.4 + PAD * 2;
    var baseX = PAD + W * 0.6;
    var tipX = baseX + L;
    var cy = h / 2;
    return build(key, w, h, baseX, cy, function (g) {
      // 外光晕（描边三角形 + lighter）
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.beginPath();
      g.moveTo(baseX, cy - W * 0.75);
      g.lineTo(baseX, cy + W * 0.75);
      g.lineTo(tipX + W * 0.5, cy);
      g.closePath();
      g.fillStyle = rgba(color, 0.22);
      g.fill();
      g.restore();

      // 刀身
      var grd = g.createLinearGradient(baseX, 0, tipX, 0);
      grd.addColorStop(0.0, rgba(color, 0.98));
      grd.addColorStop(0.55, rgba(color, 0.78));
      grd.addColorStop(1.0, rgba(color, 0.06));
      g.beginPath();
      g.moveTo(baseX, cy - W * 0.5);
      g.lineTo(baseX, cy + W * 0.5);
      g.lineTo(tipX, cy);
      g.closePath();
      g.fillStyle = grd;
      g.fill();

      // 亮芯
      var core = g.createLinearGradient(baseX, 0, tipX, 0);
      core.addColorStop(0.0, rgba(coreColor, 0.95));
      core.addColorStop(0.7, rgba(coreColor, 0.35));
      core.addColorStop(1.0, rgba(coreColor, 0));
      g.beginPath();
      g.moveTo(baseX, cy - W * 0.16);
      g.lineTo(baseX, cy + W * 0.16);
      g.lineTo(tipX - 1, cy);
      g.closePath();
      g.fillStyle = core;
      g.fill();
    });
  };

  // 心形（红色掉落物）
  Sprites.heart = function (color, size) {
    size = Math.max(8, size);
    var key = 'heart|' + color + '|' + size;
    var w = size * 1.4, h = size * 1.4;
    return build(key, w, h, null, null, function (g) {
      var s = size / 16;
      g.save();
      g.translate(w / 2, h / 2 - size * 0.05);
      g.scale(s, s);
      g.beginPath();
      g.moveTo(0, 5);
      g.bezierCurveTo(-2, 1, -9, -1, -9, -5);
      g.bezierCurveTo(-9, -10, -2, -10, 0, -5.5);
      g.bezierCurveTo(2, -10, 9, -10, 9, -5);
      g.bezierCurveTo(9, -1, 2, 1, 0, 5);
      g.closePath();
      g.fillStyle = shade(color, -0.1);
      g.fill();
      // 高光
      g.beginPath();
      g.ellipse(-3.5, -5, 2.4, 3.2, -0.5, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
      g.restore();
    });
  };

  // 经验球：小蓝绿光点（光晕 + 亮核）
  Sprites.orb = function (color, radius) {
    radius = Math.max(3, radius);
    var key = 'orb|' + color + '|' + radius;
    var size = radius * 3 + PAD * 2;
    return build(key, size, size, null, null, function (g, w, h) {
      var cx = w / 2, cy = h / 2;
      var grd = g.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.5);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.35, rgba(color, 0.9));
      grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
  };

  // 石头：灰色不规则圆（带高光），variant 提供形状差异
  Sprites.rock = function (radius, variant) {
    radius = Math.max(6, radius);
    var key = 'rock|' + radius + '|' + variant;
    var size = radius * 2.6 + PAD * 2;
    return build(key, size, size, null, null, function (g, w, h) {
      var cx = w / 2, cy = h / 2;
      var seed = (radius * 73.13 + variant * 19.7) | 0;
      function rnd() {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return (seed / 0x7fffffff);
      }
      var n = 9;
      g.beginPath();
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2;
        var r = radius * (0.78 + rnd() * 0.34);
        var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      var grd = g.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
      grd.addColorStop(0, '#8b94a3');
      grd.addColorStop(0.5, '#5f6875');
      grd.addColorStop(1, '#39414d');
      g.fillStyle = grd;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(20,26,36,0.7)';
      g.stroke();
      // 高光斑
      g.beginPath();
      g.ellipse(cx - radius * 0.3, cy - radius * 0.35, radius * 0.34, radius * 0.22, -0.6, 0, Math.PI * 2);
      g.fillStyle = 'rgba(200,214,230,0.35)';
      g.fill();
    });
  };

  // 树：棕色树干 + 绿色树冠，原点在底部中心
  Sprites.tree = function (crownRadius, trunkH) {
    crownRadius = Math.max(10, crownRadius);
    trunkH = Math.max(6, trunkH);
    var key = 'tree|' + crownRadius + '|' + trunkH;
    var w = crownRadius * 2.6 + PAD * 2;
    var h = trunkH + crownRadius * 2.2 + PAD * 2;
    var ox = w / 2, oy = h - PAD;
    return build(key, w, h, ox, oy, function (g) {
      var cx = ox;
      var baseY = oy;
      var trunkTop = baseY - trunkH;
      var trunkW = Math.max(6, crownRadius * 0.4);
      // 树干
      var tg = g.createLinearGradient(cx - trunkW / 2, 0, cx + trunkW / 2, 0);
      tg.addColorStop(0, '#5a371c');
      tg.addColorStop(0.45, '#7c4c26');
      tg.addColorStop(1, '#3f2614');
      g.fillStyle = tg;
      g.beginPath();
      g.moveTo(cx - trunkW / 2, baseY);
      g.lineTo(cx - trunkW * 0.38, trunkTop);
      g.lineTo(cx + trunkW * 0.38, trunkTop);
      g.lineTo(cx + trunkW / 2, baseY);
      g.closePath();
      g.fill();
      // 树冠：多个重叠圆
      var cy = trunkTop - crownRadius * 0.35;
      var blobs = [
        [0, 0, 1.0], [-0.62, 0.28, 0.72], [0.62, 0.28, 0.72],
        [-0.32, -0.5, 0.66], [0.34, -0.48, 0.68], [0, 0.5, 0.6]
      ];
      for (var i = 0; i < blobs.length; i++) {
        var bx = cx + blobs[i][0] * crownRadius;
        var by = cy + blobs[i][1] * crownRadius;
        var br = crownRadius * blobs[i][2];
        var cg = g.createRadialGradient(bx - br * 0.3, by - br * 0.35, br * 0.15, bx, by, br);
        cg.addColorStop(0, '#63c47a');
        cg.addColorStop(0.6, '#2f9e5b');
        cg.addColorStop(1, '#186a3c');
        g.beginPath();
        g.arc(bx, by, br, 0, Math.PI * 2);
        g.fillStyle = cg;
        g.fill();
      }
      // 顶部受光
      g.beginPath();
      g.arc(cx - crownRadius * 0.35, cy - crownRadius * 0.5, crownRadius * 0.32, 0, Math.PI * 2);
      g.fillStyle = 'rgba(190,255,205,0.28)';
      g.fill();
    });
  };

  var bossCache = Object.create(null);
  // Boss 脉动光环：预渲染帧序列（循环播放），避免每帧建渐变/shadowBlur
  Sprites.bossFrames = function (color, radius, count) {
    radius = Math.max(12, radius);
    count = count || 24;
    var key = 'boss|' + color + '|' + radius + '|' + count;
    if (bossCache[key] && bossCache[key].scale === scale) return bossCache[key].frames;
    var frames = [];
    var size = radius * 2.6 + PAD * 2;
    for (var i = 0; i < count; i++) {
      var t = i / count;
      (function (t) {
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.ceil(size * scale));
        cv.height = Math.max(1, Math.ceil(size * scale));
        var g = cv.getContext('2d');
        g.scale(scale, scale);
        var cx = size / 2, cy = size / 2;
        // 主脉动环：由内向外扩张并淡出
        var R = radius * (0.72 + 0.55 * t);
        var a = 1 - t;
        g.lineWidth = Math.max(2, radius * 0.18 * (1 - 0.55 * t));
        g.strokeStyle = rgba(color, 0.6 * a);
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
        // 柔光外圈
        g.lineWidth = Math.max(3, radius * 0.5 * (1 - 0.6 * t));
        g.strokeStyle = rgba(color, 0.14 * a);
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
        // 内圈常驻
        g.lineWidth = Math.max(1.5, radius * 0.09);
        g.strokeStyle = rgba(color, 0.5);
        g.beginPath(); g.arc(cx, cy, radius * 0.66, 0, Math.PI * 2); g.stroke();
        frames.push({ cv: cv, w: size, h: size, ox: cx, oy: cy });
      })(t);
    }
    bossCache[key] = { scale: scale, frames: frames };
    return frames;
  };

  Sprites.clearBoss = function () { bossCache = Object.create(null); };

})();
