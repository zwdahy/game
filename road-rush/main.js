/* ============================================================
   公路突围 / Road Rush — 主循环与游戏流程 (window.RoadGame)
   固定时间步 + 累加器；标题 / 暂停 / 结算时不推进引擎，但持续渲染。
   传统 IIFE 脚本，暴露 RoadGame 并在 DOMContentLoaded 自启动。
   依赖（按加载顺序）：RoadEngine / RoadRender / RoadInput。
   ============================================================ */
(function () {
  'use strict';

  var Engine = window.RoadEngine;
  var Render = window.RoadRender;
  var Input = window.RoadInput;

  var Game = {};
  window.RoadGame = Game;

  // -------- 主循环参数 --------
  var FIXED = 1 / 60;       // 固定步长
  var MAX_SUB = 8;          // 单帧最多子步
  var MAX_DT = 0.25;        // 单帧 dt 上限（防止切后台后死亡螺旋）
  var BANNER_MS = 1800;     // 关卡横幅显示时长

  var PROGRESS_KEY = 'roadrush.progress.v1';

  // -------- 运行时 --------
  var state = null;
  var mode = 'title';           // title | playing | paused | result
  var currentLevel = 0;
  var selectedLevel = 0;
  var levelStartCarry = null;   // 本关开始时的队伍/武器快照，供重打使用
  var progress = { unlocked: 1, bestScore: 0 };

  var acc = 0;
  var last = 0;
  var rafId = 0;
  var vvRaf = 0;
  var orientationTimer = 0;
  var bannerTimer = 0;
  var booted = false;

  // -------- HUD 变更缓存（减少 DOM 写入） --------
  var hudCache = {};

  // -------- DOM --------
  var canvas, hud, peopleNum, weaponNum, levelNum, progressFill;
  var bossWrap, bossFill, bossName, pauseBtn;
  var startOverlay, levelRow, startBtn;
  var pauseOverlay, resumeBtn, restartBtn;
  var resultOverlay, resultTitle, resultSub, resultPeople, resultKills;
  var resultScore, resultBest, nextBtn, retryBtn;
  var banner;

  // =============================================================
  // 工具
  // =============================================================
  function levelCount() {
    return (Engine && Engine.LEVELS && Engine.LEVELS.length) ? Engine.LEVELS.length : 0;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function hide(el) {
    if (el) el.hidden = true;
  }

  function cloneCarry(carry) {
    if (!carry) return null;
    return { people: carry.people, weaponLevel: carry.weaponLevel };
  }

  function weaponName(level) {
    var n = Math.floor(level || 1);
    if (!(n >= 1)) n = 1;
    var tiers = Engine && Engine.WEAPON_TIERS;
    if (tiers && tiers[n - 1] && tiers[n - 1].name) return tiers[n - 1].name;
    return '武器';
  }

  // =============================================================
  // 进度存档
  // =============================================================
  function loadProgress() {
    var p = { unlocked: 1, bestScore: 0 };
    try {
      var raw = window.localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        var v = JSON.parse(raw);
        if (v && typeof v === 'object') {
          if (typeof v.unlocked === 'number' && isFinite(v.unlocked)) {
            p.unlocked = Math.floor(v.unlocked);
          }
          if (typeof v.bestScore === 'number' && isFinite(v.bestScore)) {
            p.bestScore = Math.max(0, Math.floor(v.bestScore));
          }
        }
      }
    } catch (e) { /* 隐私模式 / 损坏数据：使用默认值 */ }

    var n = levelCount() || 3;
    p.unlocked = clamp(p.unlocked, 1, n);
    return p;
  }

  function saveProgress() {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (e) { /* ignore */ }
  }

  // =============================================================
  // 启动
  // =============================================================
  function boot() {
    if (booted) return;
    booted = true;

    cacheDom();

    if (!canvas || !Engine || typeof Engine.createRun !== 'function' ||
        !Render || typeof Render.draw !== 'function' ||
        !Input || typeof Input.getSteer !== 'function') {
      showFatal('无法启动：缺少游戏引擎或渲染接口。请确认 road-rush 目录下的脚本都已正确加载。');
      return;
    }

    progress = loadProgress();
    selectedLevel = clamp(progress.unlocked - 1, 0, Math.max(0, levelCount() - 1));

    // 初始界面：标题页 + 隐藏的 HUD / 弹层
    if (hud) hud.hidden = true;
    hide(pauseOverlay);
    hide(resultOverlay);
    if (startOverlay) startOverlay.hidden = false;

    Render.init(canvas);
    Input.init(canvas);

    refreshLevelRow();
    bindEvents();

    rafId = requestAnimationFrame(loop);
  }

  function cacheDom() {
    canvas = document.getElementById('game');
    hud = document.getElementById('hud');
    peopleNum = document.getElementById('peopleNum');
    weaponNum = document.getElementById('weaponNum');
    levelNum = document.getElementById('levelNum');
    progressFill = document.getElementById('progressFill');
    bossWrap = document.getElementById('bossWrap');
    bossFill = document.getElementById('bossFill');
    bossName = document.getElementById('bossName');
    pauseBtn = document.getElementById('pauseBtn');

    startOverlay = document.getElementById('startOverlay');
    levelRow = document.getElementById('levelRow');
    startBtn = document.getElementById('startBtn');

    pauseOverlay = document.getElementById('pauseOverlay');
    resumeBtn = document.getElementById('resumeBtn');
    restartBtn = document.getElementById('restartBtn');

    resultOverlay = document.getElementById('resultOverlay');
    resultTitle = document.getElementById('resultTitle');
    resultSub = document.getElementById('resultSub');
    resultPeople = document.getElementById('resultPeople');
    resultKills = document.getElementById('resultKills');
    resultScore = document.getElementById('resultScore');
    resultBest = document.getElementById('resultBest');
    nextBtn = document.getElementById('nextBtn');
    retryBtn = document.getElementById('retryBtn');

    banner = document.getElementById('banner');
  }

  function showFatal(message) {
    if (startOverlay) {
      startOverlay.hidden = false;
      var box = document.createElement('div');
      box.className = 'fatal';
      box.textContent = message;
      startOverlay.appendChild(box);
    }
    if (hud) hud.hidden = true;
    if (pauseOverlay) pauseOverlay.hidden = true;
    if (resultOverlay) resultOverlay.hidden = true;
  }

  function bindEvents() {
    if (startBtn) startBtn.addEventListener('click', onStartClick);
    if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
    if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
    if (restartBtn) restartBtn.addEventListener('click', onPauseRestart);
    if (nextBtn) nextBtn.addEventListener('click', onNextClick);
    if (retryBtn) retryBtn.addEventListener('click', onRetryClick);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrientationChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportChange);
      window.visualViewport.addEventListener('scroll', onViewportChange);
    }

    if (window.ResizeObserver) {
      try { new ResizeObserver(onResize).observe(canvas); } catch (e) { /* ignore */ }
    }
  }

  // =============================================================
  // 关卡选择
  // =============================================================
  function refreshLevelRow() {
    if (!levelRow || !Engine || !Engine.LEVELS) return;
    levelRow.innerHTML = '';

    var n = levelCount();
    for (var i = 0; i < n; i++) {
      if (i >= progress.unlocked) continue;
      (function (idx) {
        var level = Engine.LEVELS[idx] || {};
        var name = level.name || ('第 ' + (idx + 1) + ' 关');

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'level-btn' + (idx === selectedLevel ? ' active' : '');
        btn.setAttribute('aria-pressed', idx === selectedLevel ? 'true' : 'false');
        btn.setAttribute('data-level', String(idx));
        btn.textContent = '第 ' + (idx + 1) + ' 关 · ' + name;
        btn.title = name;
        btn.addEventListener('click', function () { selectLevel(idx); });
        levelRow.appendChild(btn);
      })(i);
    }
  }

  function selectLevel(index) {
    var n = levelCount();
    if (index < 0 || index >= n || index >= progress.unlocked) return;
    selectedLevel = index;

    if (!levelRow) return;
    for (var i = 0; i < levelRow.children.length; i++) {
      var btn = levelRow.children[i];
      var idx = parseInt(btn.getAttribute('data-level'), 10);
      var on = idx === selectedLevel;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function onStartClick() {
    if (mode !== 'title') return;
    startLevel(selectedLevel, null);
  }

  // =============================================================
  // 关卡流程
  // =============================================================
  function startLevel(index, carry) {
    if (!Engine || typeof Engine.createRun !== 'function') return;

    var n = levelCount();
    if (typeof index !== 'number' || !isFinite(index) || index < 0 || index >= n) {
      index = 0;
    }

    state = Engine.createRun(index, carry || undefined);
    currentLevel = index;
    selectedLevel = index;

    // 重打本关时恢复到这里开始时的人数与武器等级
    levelStartCarry = {
      people: state.people,
      weaponLevel: state.weaponLevel
    };

    if (Render && Render.reset) Render.reset();
    hide(startOverlay);
    hide(pauseOverlay);
    hide(resultOverlay);
    if (hud) hud.hidden = false;

    mode = 'playing';
    acc = 0;
    last = 0;
    hudCache = {};
    Input.reset();
    updateHUD(state);
    showBanner(index);
  }

  function showBanner(index) {
    if (!banner) return;
    clearBanner();

    var level = (Engine && Engine.LEVELS && Engine.LEVELS[index]) || null;
    var name = (state && state.levelName) || (level && level.name) || '';
    banner.textContent = '第 ' + (index + 1) + ' 关' + (name ? (' · ' + name) : '');

    // 重复进入同一关时也重新播放出现动画
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');

    bannerTimer = window.setTimeout(function () {
      bannerTimer = 0;
      if (banner) banner.classList.remove('show');
    }, BANNER_MS);
  }

  function clearBanner() {
    if (bannerTimer) {
      window.clearTimeout(bannerTimer);
      bannerTimer = 0;
    }
    if (banner) banner.classList.remove('show');
  }

  function stepOnce() {
    var input = { steer: Input.getSteer() };
    Engine.step(state, input, FIXED);

    // 引擎每步重置 events，必须转发给渲染层做特效/音效表现
    if (Render.emitEvents) Render.emitEvents(state.events || [], state);

    if (state.status === 'won') { onWin(); return; }
    if (state.status === 'dead') { onDead(); return; }
  }

  // -------- 胜利结算 --------
  function onWin() {
    if (mode === 'result') return;
    mode = 'result';
    clearBanner();

    var idx = (state && typeof state.levelIndex === 'number') ? state.levelIndex : currentLevel;
    currentLevel = idx;
    var n = levelCount() || 3;
    var finalLevel = idx >= n - 1;
    var score = (state && state.score) || 0;
    var people = (state && state.people) || 0;
    var kills = (state && state.kills) || 0;

    // 解锁下一关 + 记录最高分
    progress.unlocked = clamp(Math.max(progress.unlocked, idx + 2), 1, n);
    progress.bestScore = Math.max(progress.bestScore, score);
    saveProgress();
    refreshLevelRow();

    if (hud) hud.hidden = true;
    hide(pauseOverlay);

    if (resultTitle) resultTitle.textContent = finalLevel ? '全部通关' : '关卡突破';
    if (resultSub) {
      var sub = '剩余 ' + people + ' 人 · 武器 ' + weaponName(state && state.weaponLevel);
      if (finalLevel) sub += ' · 总分 ' + score;
      resultSub.textContent = sub;
    }
    if (resultPeople) resultPeople.textContent = String(people);
    if (resultKills) resultKills.textContent = String(kills);
    if (resultScore) resultScore.textContent = String(score);
    if (resultBest) resultBest.textContent = String(progress.bestScore);

    if (nextBtn) {
      nextBtn.hidden = false;
      nextBtn.textContent = finalLevel ? '再玩一次' : '下一关';
    }
    if (retryBtn) {
      retryBtn.hidden = false;
      retryBtn.textContent = finalLevel ? '再来一次' : '重打本关';
    }
    if (resultOverlay) resultOverlay.hidden = false;
  }

  // -------- 失败结算 --------
  function onDead() {
    if (mode === 'result') return;
    mode = 'result';
    clearBanner();

    var idx = (state && typeof state.levelIndex === 'number') ? state.levelIndex : currentLevel;
    currentLevel = idx;
    var score = (state && state.score) || 0;
    var people = (state && state.people) || 0;
    var kills = (state && state.kills) || 0;

    progress.bestScore = Math.max(progress.bestScore, score);
    saveProgress();

    if (hud) hud.hidden = true;
    hide(pauseOverlay);

    if (resultTitle) resultTitle.textContent = '突围失败';
    if (resultSub) resultSub.textContent = '队伍被打散了，再试一次';
    if (resultPeople) resultPeople.textContent = String(people);
    if (resultKills) resultKills.textContent = String(kills);
    if (resultScore) resultScore.textContent = String(score);
    if (resultBest) resultBest.textContent = String(progress.bestScore);

    if (nextBtn) nextBtn.hidden = true;
    if (retryBtn) {
      retryBtn.hidden = false;
      retryBtn.textContent = '再来一次';
    }
    if (resultOverlay) resultOverlay.hidden = false;
  }

  // 结算按钮统一读取当前 state / currentLevel，避免旧闭包
  function onNextClick() {
    if (mode !== 'result' || !state) return;
    if (state.status !== 'won') return;

    var idx = (typeof state.levelIndex === 'number') ? state.levelIndex : currentLevel;
    var n = levelCount();

    if (idx + 1 < n) {
      startLevel(idx + 1, {
        people: state.people,
        weaponLevel: state.weaponLevel
      });
    } else {
      // 最后一关通关：从头再来
      startLevel(0, null);
    }
  }

  function onRetryClick() {
    if (mode !== 'result') return;
    startLevel(currentLevel, cloneCarry(levelStartCarry));
  }

  // =============================================================
  // 暂停
  // =============================================================
  function togglePause() {
    if (mode === 'playing') {
      mode = 'paused';
      acc = 0;
      last = 0;
      Input.reset();
      if (pauseOverlay) pauseOverlay.hidden = false;
    } else if (mode === 'paused') {
      resumeGame();
    }
  }

  function resumeGame() {
    if (mode !== 'paused') return;
    hide(pauseOverlay);
    mode = 'playing';
    acc = 0;
    last = 0;
    Input.reset();
  }

  function onPauseRestart() {
    if (mode !== 'paused') return;
    startLevel(currentLevel, cloneCarry(levelStartCarry));
  }

  // =============================================================
  // 全局事件
  // =============================================================
  function onKeyDown(e) {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (mode === 'playing' || mode === 'paused') {
        if (e.cancelable) e.preventDefault();
        togglePause();
      }
    }
  }

  function onResize() {
    if (Render && Render.resize) Render.resize();
  }

  function onOrientationChange() {
    if (orientationTimer) window.clearTimeout(orientationTimer);
    orientationTimer = window.setTimeout(function () {
      orientationTimer = 0;
      onResize();
    }, 60);
  }

  function onViewportChange() {
    // 移动端地址栏显隐会连续触发，合并到一帧内只调整一次
    if (vvRaf) return;
    vvRaf = requestAnimationFrame(function () {
      vvRaf = 0;
      onResize();
    });
  }

  function onVisibilityChange() {
    last = 0;
    acc = 0;
    if (document.hidden && mode === 'playing') togglePause();
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

    if (mode === 'playing' && state && state.status === 'running') {
      acc += dt;
      var steps = 0;
      while (acc >= FIXED && steps < MAX_SUB) {
        acc -= FIXED;
        steps++;
        stepOnce();
        if (mode !== 'playing') break;
      }
      // 子步用尽仍有大量积压：丢弃，避免追帧雪崩
      if (acc > FIXED * MAX_SUB) acc = 0;
    } else {
      acc = 0;
    }

    // 标题页 state 为 null；暂停/结算保留最后一帧画面
    Render.draw(state, dt);

    if (state && (mode === 'playing' || mode === 'paused')) updateHUD(state);
  }

  // =============================================================
  // HUD
  // =============================================================
  function setText(el, key, val) {
    if (!el) return;
    if (hudCache[key] === val) return;
    hudCache[key] = val;
    el.textContent = val;
  }

  function setHidden(el, key, hidden) {
    if (!el) return;
    if (hudCache[key] === hidden) return;
    hudCache[key] = hidden;
    el.hidden = hidden;
  }

  function updateHUD(st) {
    if (!st) return;

    var people = st.people || 0;
    setText(peopleNum, 'people', String(people));

    // 人数偏低时给数字一个视觉提示（样式由 CSS 决定，缺失也无副作用）
    var low = people <= 1;
    if (hudCache._lowPeople !== low) {
      hudCache._lowPeople = low;
      if (peopleNum) peopleNum.classList.toggle('low', low);
    }

    var wlevel = st.weaponLevel || 1;
    setText(weaponNum, 'weapon', 'Lv.' + wlevel + ' ' + weaponName(wlevel));
    setText(levelNum, 'level', ((st.levelIndex || 0) + 1) + '/' + (levelCount() || 3));

    // 关卡进度
    var len = st.trackLength || 0;
    var pct = len > 0 ? (st.distance || 0) / len * 100 : 0;
    pct = clamp(pct, 0, 100);
    var pctStr = pct.toFixed(1) + '%';
    if (progressFill && hudCache.progress !== pctStr) {
      hudCache.progress = pctStr;
      progressFill.style.width = pctStr;
    }

    // BOSS 血条
    var boss = st.boss;
    var bossOn = !!(boss && !boss.dead && st.phase === 'boss');
    setHidden(bossWrap, 'bossWrap', !bossOn);
    if (bossOn) {
      var hpPct = boss.maxHp > 0 ? clamp(boss.hp / boss.maxHp * 100, 0, 100) : 0;
      var hpStr = hpPct.toFixed(1) + '%';
      if (bossFill && hudCache.bossHp !== hpStr) {
        hudCache.bossHp = hpStr;
        bossFill.style.width = hpStr;
      }
      setText(bossName, 'bossName', boss.name || '');
    }
  }

  // =============================================================
  // 调试/测试辅助（只读）
  // =============================================================
  Game.getMode = function () { return mode; };
  Game.getState = function () { return state; };
  Game.getProgress = function () { return { unlocked: progress.unlocked, bestScore: progress.bestScore }; };

  // =============================================================
  // 自启动
  // =============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
