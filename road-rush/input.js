/* ============================================================
   公路突围 / Road Rush — 输入层 (window.RoadInput)
   仅横向转向：画布拖拽（鼠标/触屏/触控笔）+ A/D 与 左右方向键。
   射击由引擎自动进行，因此没有射击按键。
   传统 IIFE 脚本，暴露 RoadInput.init / getSteer / reset。
   ============================================================ */
(function () {
  'use strict';

  var RoadInput = {};
  window.RoadInput = RoadInput;

  // 拖拽满舵所需的横向距离占视口宽度的比例（可通过 RoadInput.maxDrag 调整）
  RoadInput.maxDrag = 0.20;

  var canvas = null;
  var initialized = false;

  // 键盘状态
  var keys = Object.create(null);

  // 指针/触摸拖拽状态（共用同一份 steer，保证只有一路输入生效）
  var dragging = false;
  var dragPointerId = null;
  var startX = 0;
  var dragSteer = 0;

  // 触摸回退（仅在浏览器不支持 PointerEvent 时启用）
  var touchId = null;

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  // 拖拽满舵距离（CSS 像素）
  function dragWidth() {
    var w = window.innerWidth || 0;
    if (!w && document.documentElement) w = document.documentElement.clientWidth || 0;
    if (!w) w = 1;
    return Math.max(1, w * RoadInput.maxDrag);
  }

  // -------------------------------------------------------------
  // 键盘
  // -------------------------------------------------------------
  function normKey(e) {
    var k = e.key;
    if (!k) return null;
    if (k === 'Esc') k = 'Escape';
    return k.toLowerCase();
  }

  function onKeyDown(e) {
    var k = normKey(e);
    if (k === 'a' || k === 'arrowleft' || k === 'd' || k === 'arrowright') {
      keys[k] = true;
      if (e.cancelable) e.preventDefault();
    }
  }

  function onKeyUp(e) {
    var k = normKey(e);
    if (k === 'a' || k === 'arrowleft' || k === 'd' || k === 'arrowright') {
      keys[k] = false;
      if (e.cancelable) e.preventDefault();
    }
  }

  // -------------------------------------------------------------
  // 拖拽结束
  // -------------------------------------------------------------
  function endDrag() {
    dragging = false;
    dragPointerId = null;
    touchId = null;
    dragSteer = 0;
  }

  // -------------------------------------------------------------
  // PointerEvent 路径（现代浏览器，鼠标 / 触屏 / 触控笔统一处理）
  // -------------------------------------------------------------
  function onPointerDown(e) {
    if (dragging) return;                       // 只跟踪第一根手指/第一个指针
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    dragPointerId = e.pointerId;
    startX = e.clientX;
    dragSteer = 0;
    if (e.cancelable) e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    if (e.cancelable) e.preventDefault();
    dragSteer = clamp((e.clientX - startX) / dragWidth(), -1, 1);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    if (dragPointerId !== null && e.pointerId !== undefined &&
        e.pointerId !== dragPointerId) return;
    endDrag();
  }

  // -------------------------------------------------------------
  // 触摸回退路径（旧 iOS / 无 PointerEvent 的浏览器）
  // -------------------------------------------------------------
  function findTouch(list, id) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  }

  function onTouchStart(e) {
    if (dragging) return;
    var t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    dragging = true;
    touchId = t.identifier;
    dragPointerId = null;
    startX = t.clientX;
    dragSteer = 0;
    if (e.cancelable) e.preventDefault();
  }

  function onTouchMove(e) {
    if (!dragging || touchId === null) return;
    var t = findTouch(e.changedTouches, touchId);
    if (!t) return;
    if (e.cancelable) e.preventDefault();
    dragSteer = clamp((t.clientX - startX) / dragWidth(), -1, 1);
  }

  function onTouchEnd(e) {
    if (!dragging || touchId === null) return;
    var t = findTouch(e.changedTouches, touchId);
    if (!t) return;
    if (e.cancelable) e.preventDefault();
    endDrag();
  }

  // 任何窗口级触摸结束都兜底清理，避免松手后卡住转向
  function onWindowTouchEnd() {
    endDrag();
  }

  // -------------------------------------------------------------
  // 公共接口
  // -------------------------------------------------------------
  RoadInput.init = function (cv) {
    canvas = cv || canvas || document.getElementById('game');
    if (initialized) return;
    initialized = true;

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // 失焦 / 切后台 / 页面隐藏：立即松开所有输入
    window.addEventListener('blur', RoadInput.reset);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) RoadInput.reset();
    });

    if (canvas) {
      if (window.PointerEvent) {
        canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', onPointerUp, { passive: false });
        window.addEventListener('pointercancel', onPointerUp, { passive: false });
        // 触摸事件在 PointerEvent 环境下也会触发，作为兜底
        window.addEventListener('touchend', onWindowTouchEnd, { passive: false });
        window.addEventListener('touchcancel', onWindowTouchEnd, { passive: false });
      } else {
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', onTouchEnd, { passive: false });
        window.addEventListener('touchcancel', onTouchEnd, { passive: false });
      }
    }
  };

  RoadInput.getSteer = function () {
    var s = dragSteer;

    var kx = 0;
    if (keys['a'] || keys['arrowleft']) kx -= 1;
    if (keys['d'] || keys['arrowright']) kx += 1;

    // 键盘与拖拽叠加后限幅；A+D 同时按下时 kx 为 0
    return clamp(s + kx, -1, 1);
  };

  RoadInput.reset = function () {
    keys = Object.create(null);
    endDrag();
  };

})();
