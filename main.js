/* ============================================================
   转刀生存 — 主循环与流程 (window.Game)
   固定时间步 + 累加器，暂停/升级/死亡/开始页均不推进引擎。
   只读消费 state，事件驱动表现层。
   传统脚本，最后加载。
   ============================================================ */
(function () {
  'use strict';

  var Engine = window.Engine;
  var Render = window.Render;
  var Input = window.Input;

  var Game = {};
  window.Game = Game;

  // -------- 主循环参数 --------
  var FIXED = 1 / 60;      // 固定步长
  var MAX_SUB = 8;         // 单帧最多子步
  var MAX_DT = 0.25;       // dt 上限（死亡螺旋保护）
  var MAX_HP_HEARTS = 10;

  // -------- 运行时 --------
  var state = null;
  var mode = 'title';       // title | playing | paused | levelup | dead
  var acc = 0;
  var last = 0;
  var rafId = 0;

  // -------- DOM --------
  var canvas, hud, heartsEl, xpFill, lvlNum, timeNum, killNum, scoreNum, bladeNum;
  var startOverlay, levelOverlay, pauseOverlay, endOverlay, cardsEl;
  var endScore, endTime, endKills, endBest, bestLine;

  // -------- HUD 变更缓存 --------
  var hudCache = {};
  var heartNodes = [];
  var heartShown = -1;

  // -------- 最高分 --------
  var BEST_KEY = 'spinblade.best.v1';
  function loadBest() {
    try {
      var v = JSON.parse(localStorage.getItem(BEST_KEY));
      if (v && typeof v.score === 'number') return v;
    } catch (e) { /* ignore */ }
    return { score: 0, time: 0, kills: 0 };
  }
  function saveBest(b) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ }
  }

  function fmtTime(t) {
    t = Math.max(0, Math.floor(t || 0));
    var m = Math.floor(t / 60), s = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // =============================================================
  // 启动
  // =============================================================
  function boot() {
    canvas = document.getElementById('game');
    hud = document.getElementById('hud');
    heartsEl = document.getElementById('hearts');
    xpFill = document.getElementById('xpFill');
    lvlNum = document.getElementById('lvlNum');
    timeNum = document.getElementById('timeNum');
    killNum = document.getElementById('killNum');
    scoreNum = document.getElementById('scoreNum');
    bladeNum = document.getElementById('bladeNum');
    startOverlay = document.getElementById('startOverlay');
    levelOverlay = document.getElementById('levelOverlay');
    pauseOverlay = document.getElementById('pauseOverlay');
    endOverlay = document.getElementById('endOverlay');
    cardsEl = document.getElementById('cards');
    endScore = document.getElementById('endScore');
    endTime = document.getElementById('endTime');
    endKills = document.getElementById('endKills');
    endBest = document.getElementById('endBest');
    bestLine = document.getElementById('bestLine');

    if (!Engine || typeof Engine.createGame !== 'function' || !Render || !Input) {
      showFatal();
      return;
    }

    Render.init(canvas);
    Input.init(canvas);

    // 按钮
    document.getElementById('startBtn').addEventListener('click', newGame);
    document.getElementById('againBtn').addEventListener('click', newGame);
    document.getElementById('restartBtn2').addEventListener('click', newGame);
    document.getElementById('resumeBtn').addEventListener('click', resume);
    document.getElementById('pauseBtn').addEventListener('click', togglePause);

    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', function () { setTimeout(onResize, 60); });
    document.addEventListener('visibilitychange', onVisibility);

    if (window.ResizeObserver) {
      try { new ResizeObserver(onResize).observe(canvas); } catch (e) { /* ignore */ }
    }

    rafId = requestAnimationFrame(loop);
  }

  function showFatal() {
    var panel = startOverlay && startOverlay.querySelector('.panel');
    if (panel) {
      panel.innerHTML =
        '<h2 class="title small">无法启动</h2>' +
        '<p class="lead">没有找到引擎接口。请确认 engine.js 与本页面在同一目录，并先于其它脚本加载。</p>';
    }
    if (startOverlay) startOverlay.hidden = false;
  }

  function onResize() {
    if (Render && Render.resize) Render.resize();
  }
  function onVisibility() {
    // 切后台/回前台：清空累加器，避免大跳步
    last = 0;
    acc = 0;
  }
  function onKey(e) {
    if (e.key === 'Escape') {
      if (mode === 'playing' || mode === 'paused') { togglePause(); e.preventDefault(); }
    }
  }

  // =============================================================
  // 流程
  // =============================================================
  function newGame() {
    state = Engine.createGame(Date.now());
    if (Render.setWorld && state.world) Render.setWorld(state.world);
    Render.reset();
    hide(startOverlay); hide(levelOverlay); hide(pauseOverlay); hide(endOverlay);
    if (hud) hud.hidden = false;
    mode = 'playing';
    acc = 0; last = 0;
    hudCache = {};
    heartShown = -1;
    updateHUD(state);
  }

  function resume() {
    if (mode === 'paused' || mode === 'levelup') {
      hide(pauseOverlay); hide(levelOverlay);
      mode = 'playing';
      acc = 0; last = 0;
    }
  }

  function togglePause() {
    if (mode === 'playing') {
      mode = 'paused';
      pauseOverlay.hidden = false;
      last = 0; acc = 0;
    } else if (mode === 'paused') {
      resume();
    }
  }

  function openLevelUp() {
    mode = 'levelup';
    buildCards();
    levelOverlay.hidden = false;
    last = 0; acc = 0;
  }

  function buildCards() {
    var cards = [];
    try { cards = Engine.rollCards(state) || []; } catch (e) { cards = []; }
    cardsEl.innerHTML = '';
    if (!cards.length) { return; }
    for (var i = 0; i < cards.length; i++) {
      (function (card) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'card';
        var icon = document.createElement('div');
        icon.className = 'card-icon';
        icon.textContent = card.icon || '';
        var text = document.createElement('div');
        text.className = 'card-text';
        var name = document.createElement('div');
        name.className = 'card-name';
        name.textContent = card.title || card.id || '强化';
        var desc = document.createElement('div');
        desc.className = 'card-desc';
        desc.textContent = card.desc || '';
        text.appendChild(name);
        text.appendChild(desc);
        btn.appendChild(icon);
        btn.appendChild(text);
        btn.addEventListener('click', function () { pickCard(card.id); });
        cardsEl.appendChild(btn);
      })(cards[i]);
    }
  }

  function pickCard(id) {
    try { Engine.applyCard(state, id); } catch (e) { /* ignore */ }
    if (state && state.status === 'dead') { onDeath(); return; }
    if (state && state.pendingLevelUps > 0) {
      buildCards();            // 仍有待处理升级，继续弹卡
    } else {
      hide(levelOverlay);
      mode = 'playing';
      last = 0; acc = 0;
    }
  }

  function onDeath() {
    mode = 'dead';
    hide(levelOverlay);
    if (hud) hud.hidden = true;

    var score = (state.stats && state.stats.score) || 0;
    var kills = (state.stats && state.stats.kills) || 0;
    var secs = state.time || 0;

    var best = loadBest();
    var isNew = score > best.score;
    if (isNew) {
      best = { score: score, time: secs, kills: kills };
      saveBest(best);
    }

    endScore.textContent = String(score);
    endTime.textContent = fmtTime(secs);
    endKills.textContent = String(kills);
    endBest.textContent = String(best.score);
    bestLine.textContent = isNew ? '新纪录' : (best.score > 0 ? ('距离最高分还差 ' + (best.score - score)) : '');

    endOverlay.hidden = false;
  }

  function stepOnce(h) {
    var v = Input.getVector();
    Engine.step(state, v, h);
    if (state.events && state.events.length) Render.emitEvents(state.events, state);

    if (state.status === 'dead') { onDeath(); return; }
    if (state.pendingLevelUps > 0) { openLevelUp(); return; }
  }

  // =============================================================
  // 主循环
  // =============================================================
  function loop(ts) {
    rafId = requestAnimationFrame(loop);

    if (!last) last = ts;
    var dt = (ts - last) / 1000;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > MAX_DT) dt = MAX_DT;

    if (mode === 'playing' && state && state.status !== 'dead') {
      acc += dt;
      var steps = 0;
      while (acc >= FIXED && steps < MAX_SUB) {
        acc -= FIXED;
        steps++;
        stepOnce(FIXED);
        if (mode !== 'playing') break;
      }
      if (acc > FIXED * MAX_SUB) acc = 0;
    } else {
      acc = 0;
    }

    Render.draw(state, dt);
    if (state && (mode === 'playing' || mode === 'paused' || mode === 'levelup')) updateHUD(state);
  }

  // =============================================================
  // HUD
  // =============================================================
  function setText(el, val) {
    if (!el) return;
    var key = el.id;
    if (hudCache[key] === val) return;
    hudCache[key] = val;
    el.textContent = val;
  }

  function buildHearts(shown) {
    heartsEl.innerHTML = '';
    heartNodes = [];
    for (var i = 0; i < shown; i++) {
      var s = document.createElement('span');
      s.className = 'heart';
      heartsEl.appendChild(s);
      heartNodes.push(s);
    }
  }

  function updateHUD(st) {
    if (!st || !st.player) return;
    var p = st.player;

    // 生命
    var shown = Math.min(MAX_HP_HEARTS, Math.max(1, Math.ceil(p.maxHp || 1)));
    if (shown !== heartShown) { buildHearts(shown); heartShown = shown; }
    var filled = 0;
    if (p.maxHp > 0) filled = Math.ceil((p.hp / p.maxHp) * shown);
    filled = Math.max(0, Math.min(shown, filled));
    if (hudCache._hearts !== filled) {
      for (var i = 0; i < heartNodes.length; i++) {
        heartNodes[i].classList.toggle('full', i < filled);
      }
      hudCache._hearts = filled;
    }

    // 经验
    var xpPct = p.xpToNext > 0 ? Math.max(0, Math.min(100, (p.xp / p.xpToNext) * 100)) : 0;
    var xpStr = xpPct.toFixed(1) + '%';
    if (hudCache._xp !== xpStr) { xpFill.style.width = xpStr; hudCache._xp = xpStr; }

    setText(lvlNum, String(p.level || 1));
    setText(timeNum, fmtTime(st.time));

    var stats = st.stats || {};
    setText(killNum, String(stats.kills || 0));
    setText(scoreNum, String(stats.score || 0));

    var active = 0;
    if (p.blades) {
      for (var b = 0; b < p.blades.length; b++) if (p.blades[b].active) active++;
    }
    setText(bladeNum, active + '/' + (p.bladeCount != null ? p.bladeCount : active));
  }

  function hide(el) { if (el) el.hidden = true; }

  // =============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
