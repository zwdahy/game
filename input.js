/* ============================================================
   转刀生存 — 输入层 (window.Input)
   键盘 WASD / 方向键 + 触屏左半屏动态虚拟摇杆（鼠标拖动亦可）。
   getVector() 返回 {x,y}，方向 -1..1，斜向已归一化。
   传统脚本，必须在 render.js 之后、main.js 之前加载。
   ============================================================ */
(function () {
  'use strict';

  var Input = {};
  window.Input = Input;

  var maxRadius = 56;          // 摇杆最大半径（逻辑像素）
  var DEAD = 0.001;

  // 供 render 绘制摇杆：{active, ox, oy, x, y}
  var joystick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
  Input.joystick = joystick;
  Input.maxRadius = maxRadius;

  var canvas = null;
  var keys = Object.create(null);
  var touchId = null;          // 当前摇杆对应的触摸标识
  var mouseActive = false;

  // -------------------------------------------------------------
  // 键盘
  // -------------------------------------------------------------
  function keyDown(e) {
    var k = normKey(e);
    if (k) { keys[k] = true; }
  }
  function keyUp(e) {
    var k = normKey(e);
    if (k) { keys[k] = false; }
  }
  function normKey(e) {
    var k = e.key;
    if (k === ' ') return 'space';
    if (k === 'Esc') k = 'Escape';
    return k ? k.toLowerCase() : null;
  }
  function clearKeys() { keys = Object.create(null); }

  // -------------------------------------------------------------
  // 摇杆定位
  // -------------------------------------------------------------
  function startStick(x, y) {
    joystick.active = true;
    joystick.ox = x; joystick.oy = y;
    joystick.x = x; joystick.y = y;
  }
  function moveStick(x, y) {
    var dx = x - joystick.ox;
    var dy = y - joystick.oy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxRadius) {
      dx = dx / d * maxRadius;
      dy = dy / d * maxRadius;
    }
    joystick.x = joystick.ox + dx;
    joystick.y = joystick.oy + dy;
  }
  function endStick() {
    joystick.active = false;
  }

  // -------------------------------------------------------------
  // 触摸事件（左半屏动态摇杆）
  // -------------------------------------------------------------
  function onTouchStart(e) {
    if (e.cancelable) e.preventDefault();
    if (joystick.active && touchId !== null) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.clientX < window.innerWidth * 0.5) {
        touchId = t.identifier;
        startStick(t.clientX, t.clientY);
        break;
      }
    }
  }
  function onTouchMove(e) {
    if (e.cancelable) e.preventDefault();
    if (touchId === null) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (t.identifier === touchId) { moveStick(t.clientX, t.clientY); break; }
    }
  }
  function onTouchEnd(e) {
    if (e.cancelable) e.preventDefault();
    if (touchId === null) return;
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchId) {
        touchId = null;
        endStick();
        break;
      }
    }
  }

  // -------------------------------------------------------------
  // 鼠标拖动（桌面便捷操作，任意位置按下即原点）
  // -------------------------------------------------------------
  function onPointerDown(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    mouseActive = true;
    startStick(e.clientX, e.clientY);
  }
  function onPointerMove(e) {
    if (!mouseActive) return;
    moveStick(e.clientX, e.clientY);
  }
  function onPointerUp(e) {
    if (!mouseActive) return;
    mouseActive = false;
    endStick();
  }

  // -------------------------------------------------------------
  // 初始化
  // -------------------------------------------------------------
  Input.init = function (cv) {
    canvas = cv || canvas || document.getElementById('game');
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clearKeys);

    if (canvas) {
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd, { passive: false });
      canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

      if (window.PointerEvent) {
        canvas.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
      }
    }

    // 阻止双指缩放 / 双击缩放
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  };

  // -------------------------------------------------------------
  // 方向向量
  // -------------------------------------------------------------
  Input.getVector = function () {
    var x = 0, y = 0;

    // 键盘优先
    if (keys['a'] || keys['arrowleft']) x -= 1;
    if (keys['d'] || keys['arrowright']) x += 1;
    if (keys['w'] || keys['arrowup']) y -= 1;
    if (keys['s'] || keys['arrowdown']) y += 1;

    if (x !== 0 || y !== 0) {
      var len = Math.sqrt(x * x + y * y);
      if (len > 1) { x /= len; y /= len; }
      return { x: x, y: y };
    }

    // 摇杆
    if (joystick.active) {
      var dx = joystick.x - joystick.ox;
      var dy = joystick.y - joystick.oy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > DEAD) {
        var m = Math.min(1, d / maxRadius);
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }

    return { x: x, y: y };
  };

  Input.isDown = function (k) { return !!keys[k]; };

})();
