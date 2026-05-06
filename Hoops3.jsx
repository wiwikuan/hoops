import React, { useEffect, useRef } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

// =============================================================================
// CONFIG — 預設值，可以從 props 覆蓋
// =============================================================================
const DEFAULT_CONFIG = {
  GAME_DURATION: 60,
  COOLDOWN: 0.5,
  JUMP_DURATION: 0.5,
  JUMP_HEIGHT_RATIO: 0.25,  
  PERFECT_WINDOW_T: 0.28,
  PERFECT_TOLERANCE: 0.001,
  MAX_DRIFT_T: 0.35,
  GRAVITY_RATIO: 5,   
  BALL_RADIUS_RATIO: 0.03,
  RESTITUTION_RIM: 0.75,
  RESTITUTION_BOARD: 0.75,
  RESTITUTION_BALL: 0.7,
  AIR_DRAG: 0,
  SHOT_TARGET_TIME: 0.75,
  SHOT_DRIFT_VEL: 0.4,
  SHOT_DRIFT_ANGLE: 0.6,
  BALL_IMG_SRC: null,
  PERFECT_JITTER_VEL: 0.002,    // perfect 時速度的隨機浮動範圍（±1.5%）
  PERFECT_JITTER_ANGLE: 0.0015,  // perfect 時角度的隨機浮動（±0.012 弧度，約 0.7 度）
  EULER_COMPENSATION: 0.011,  // semi-implicit Euler 的初幀重力補償（秒）。偏短就調大、偏長就調小。
};

const COLORS = {
  ink: '#1a1a1a',
  paper: '#fafaf7',
  ball: '#c2410c',
  rim: '#991b1b',
  net: '#999',
  gray: '#ccc',
};

// 遊戲階段
const PHASE = {
  TITLE: 'title',         // 模式選擇畫面
  PLAYING: 'playing',     // 遊戲中
  OVER: 'over',           // 結束畫面（只有限時模式會用到）
};

// 模式
const MODE = {
  TIMED: 'timed',
  PRACTICE: 'practice',
};

// =============================================================================
// Inline styles — 不需要額外 CSS 檔
// =============================================================================
const styles = {
  stage: {
    display: 'block',
    width: '100%',
    padding: '1rem 0 2rem',
    touchAction: 'none',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
  },
  wrap: {
    position: 'relative',
    width: '100%',
    margin: '0 auto',
  },
  canvas: {
    display: 'block',
    background: COLORS.paper,
    cursor: 'pointer',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    width: '100%',
    height: 'auto',
    touchAction: 'none', // 確保 pointer events 能完整接管,瀏覽器不會搶去做手勢
  },
  hint: {
    position: 'absolute',
    left: '50%',
    bottom: '-24px',
    transform: 'translateX(-50%)',
    fontSize: '11px',
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    opacity: 0.45,
    whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    color: COLORS.ink,
  },
};

// =============================================================================
// 遊戲主體 — 接收 canvas + config,回傳 cleanup function
// =============================================================================
function initGame(canvas, userConfig) {
  const CONFIG = { ...DEFAULT_CONFIG, ...userConfig };
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  
  function resize() {
      const parent = canvas.parentElement;
      const parentW = parent ? parent.clientWidth : 600;
      const px = Math.max(280, Math.floor(parentW));
      DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      canvas.style.width = px + 'px';
      canvas.style.height = px + 'px';
      canvas.width = Math.floor(px * DPR);
      canvas.height = Math.floor(px * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      W = px; H = px;
  }
  resize();

  // Ball image (optional)
  let ballImg = null;
  if (CONFIG.BALL_IMG_SRC) {
    const img = new Image();
    img.onload = () => { ballImg = img; };
    img.src = CONFIG.BALL_IMG_SRC;
  }

  // Audio
  let actx = null;
  function audio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { actx = null; }
    }
    return actx;
  }
  function blip({ freq = 440, dur = 0.08, type = 'sine', vol = 0.15, sweep = 0, delay = 0 } = {}) {
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const SFX = {
    jump: () => blip({ freq: 220, dur: 0.06, type: 'triangle', vol: 0.08, sweep: 60 }),
    shoot: () => blip({ freq: 380, dur: 0.09, type: 'square', vol: 0.07, sweep: 200 }),
    rim:   () => blip({ freq: 900, dur: 0.05, type: 'square', vol: 0.06, sweep: -300 }),
    board: () => blip({ freq: 140, dur: 0.07, type: 'sine', vol: 0.12, sweep: -40 }),
    swish: () => {
      blip({ freq: 660, dur: 0.08, type: 'sine', vol: 0.10 });
      blip({ freq: 990, dur: 0.10, type: 'sine', vol: 0.08, delay: 0.04 });
      blip({ freq: 1320, dur: 0.12, type: 'sine', vol: 0.06, delay: 0.09 });
    },
    score: () => {
      blip({ freq: 523, dur: 0.10, type: 'triangle', vol: 0.10 });
      blip({ freq: 784, dur: 0.14, type: 'triangle', vol: 0.10, delay: 0.08 });
    },
    end: () => {
      blip({ freq: 220, dur: 0.18, type: 'sawtooth', vol: 0.08 });
      blip({ freq: 165, dur: 0.22, type: 'sawtooth', vol: 0.08, delay: 0.12 });
    },
  };

  function geom() {
      const hoopX = W * 0.78;
      const hoopW = W * 0.085;
      const rimR = W * 0.008;
      const armLength = W * 0.018;  // 連接臂的長度（rim 後緣到籃板的距離）
  
      return {
        ballR:    W * CONFIG.BALL_RADIUS_RATIO,
        ballX:    W * 0.18,
        groundY:  H * 0.72,
        hoopX:    hoopX,
        hoopY:    H * 0.42,
        hoopW:    hoopW,
        rimR:     rimR,
        armLength: armLength,
        // 籃板往右推，騰出空間讓 rim 後緣有「後面」可以彈
        boardX:   hoopX + hoopW / 2 + rimR + armLength,
        boardTop: H * 0.42 - H * 0.18,
        boardBot: H * 0.42 + H * 0.04,
        netDepth: H * 0.06,
      };
    }

  const state = {
    phase: PHASE.TITLE,
    mode: MODE.TIMED,        // 目前選的模式
    timeLeft: CONFIG.GAME_DURATION,
    score: 0,
    attempts: 0,             // 已出手球數（球真的飛出去才算）
    lastScoreFlash: 0,
    holding: false,
    holdT: 0,
    holdStartTime: 0,
    jumpDone: false,
    cooldown: 0,
    ready: true,
    balls: [],
    netPhase: 0,
    netImpulse: 0,
    nextBallId: 1,
  };

  // 給想作弊的讀者
    if (typeof window !== 'undefined') {
      window.__hoops = { state, CONFIG };
    }

  // ===== 標題畫面按鈕區域（給 pointer 用） =====
  // 在 drawTitle 計算過後存起來，pressDown 時用來判斷點到哪個按鈕
  let titleButtons = null; // { timed: {x, y, w, h}, practice: {x, y, w, h} }
  // 練習模式右下角的「回主畫面」按鈕
  let exitButton = null;   // { x, y, w, h }

  function startGame(mode) {
    state.phase = PHASE.PLAYING;
    state.mode = mode;
    state.timeLeft = CONFIG.GAME_DURATION;
    state.score = 0;
    state.attempts = 0;
    state.lastScoreFlash = 0;
    state.holding = false;
    state.holdT = 0;
    state.holdStartTime = 0;
    state.jumpDone = false;
    state.cooldown = 0;
    state.ready = true;
    state.balls = [];
    state.netImpulse = 0;
  }

  function backToTitle() {
    state.phase = PHASE.TITLE;
    state.holding = false;
    state.jumpDone = false;
    state.balls = [];
  }

  function pressDown(pointerPos) {
    audio();

    // 結束畫面（限時模式）：任何輸入都回標題
    if (state.phase === PHASE.OVER) {
      backToTitle();
      return;
    }

    // 標題畫面：用 pointer 位置判斷點到哪個按鈕；沒有 pointerPos（鍵盤）就忽略
    if (state.phase === PHASE.TITLE) {
      if (pointerPos && titleButtons) {
        const { x, y } = pointerPos;
        const inBtn = (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
        if (inBtn(titleButtons.timed)) { startGame(MODE.TIMED); return; }
        if (inBtn(titleButtons.practice)) { startGame(MODE.PRACTICE); return; }
      }
      return;
    }

    // 遊戲中：練習模式下，先檢查是否點到「回主畫面」按鈕
    if (state.mode === MODE.PRACTICE && pointerPos && exitButton) {
      const { x, y } = pointerPos;
      const b = exitButton;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        backToTitle();
        return;
      }
    }

    if (!state.ready || state.holding) return;
    state.holding = true;
    state.holdT = 0;
    state.holdStartTime = performance.now();
    state.jumpDone = false;
    SFX.jump();
  }
  function pressUp() {
    if (!state.holding) return;
    state.holding = false;
    if (state.jumpDone) return;
    const realHoldT = (performance.now() - state.holdStartTime) / 1000;
    releaseShot(Math.min(realHoldT, CONFIG.JUMP_DURATION));
  }

 // ===== Event handlers =====
  // 鍵盤:留在 window(canvas 拿不到鍵盤焦點)。
  // 關鍵:只要是空白鍵且不在輸入框,就先無條件 preventDefault,
  // 否則 cooldown 中或按住不放(repeat)時,瀏覽器會拿去捲動頁面。
  const isEditableTarget = (target) => {
    if (!target) return false;
    const tag = target.tagName || '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
  };
  
  const onKeyDown = (e) => {
    if (isEditableTarget(e.target)) return;
    if (!inViewport) return;

    // 標題畫面：1 / 2 選模式
    if (state.phase === PHASE.TITLE) {
      if (e.code === 'Digit1' || e.code === 'Numpad1') {
        e.preventDefault();
        if (e.repeat) return;
        audio();
        startGame(MODE.TIMED);
        return;
      }
      if (e.code === 'Digit2' || e.code === 'Numpad2') {
        e.preventDefault();
        if (e.repeat) return;
        audio();
        startGame(MODE.PRACTICE);
        return;
      }
      // 標題畫面下空白鍵不做事，但仍 preventDefault 避免捲動
      if (e.code === 'Space') {
        e.preventDefault();
      }
      return;
    }

    // 結束畫面（限時模式）：空白鍵回標題
    if (state.phase === PHASE.OVER) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        audio();
        backToTitle();
      }
      return;
    }

    // 遊戲中：練習模式可用 Esc 直接回主畫面
    if (state.mode === MODE.PRACTICE && e.code === 'Escape') {
      e.preventDefault();
      if (e.repeat) return;
      backToTitle();
      return;
    }

    // 遊戲中：空白鍵蓄力
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (e.repeat) return;
    pressDown();
  };
  const onKeyUp = (e) => {
    if (e.code !== 'Space') return;
    if (isEditableTarget(e.target)) return;
    if (!inViewport) return;
    e.preventDefault();
    if (state.phase !== PHASE.PLAYING) return;
    pressUp();
  };
  
  // Pointer events:用 setPointerCapture 把後續事件鎖在 canvas 上,
  // 滑出邊界放開也還是會送回 canvas,window 完全不需要監聽,
  // 也就不會干擾頁面其他連結的點擊(這就是 Android 連結失效的原因)。
  const getPointerPos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const onPointerDown = (e) => {
    // 只接受主要按鍵(滑鼠左鍵、手指、筆)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      // 某些舊瀏覽器或特殊情境會丟錯,忽略即可
    }
    pressDown(getPointerPos(e));
  };
  const onPointerUp = (e) => {
    // 沒在蓄力就不該攔截事件,直接讓事件正常冒泡
    if (!state.holding) return;
    e.preventDefault();
    pressUp();
  };
  const onPointerCancel = () => {
    // 系統取消觸控(來電、手勢中斷等),靜默結束蓄力,不投籃
    if (state.holding) {
      state.holding = false;
      state.jumpDone = false;
    }
  };
  
  const onResize = () => resize();

  // ===== Viewport 偵測:canvas 不在畫面上時,就不要攔截空白鍵 =====
  // 否則玩家捲到文章下方想用空白鍵翻頁時,會被遊戲吃掉。
  let inViewport = true; // 預設視為在畫面內,IntersectionObserver 第一次回呼會修正
  let io = null;
  if (typeof IntersectionObserver !== 'undefined') {
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          inViewport = entry.isIntersecting;
          // 離開畫面時,如果正在蓄力就靜默結束(避免捲回來時球自己飛出去)
          if (!inViewport && state.holding) {
            state.holding = false;
            state.jumpDone = false;
          }
        }
      },
      { threshold: 0 } // 只要有一個像素在畫面內就算
    );
    io.observe(canvas);
  }
  
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);

  function releaseShot(holdT) {
    const g = geom();
    const tNorm = Math.min(1, holdT / CONFIG.JUMP_DURATION);
    const offset = tNorm - CONFIG.PERFECT_WINDOW_T;
    const absOff = Math.abs(offset);

	// console.log 顯示投籃資訊
    console.log(`[shot] 按了 ${(tNorm * CONFIG.JUMP_DURATION * 1000).toFixed(0)}ms / 完美時機 ${(CONFIG.PERFECT_WINDOW_T * CONFIG.JUMP_DURATION * 1000).toFixed(0)}ms ${absOff < CONFIG.PERFECT_TOLERANCE ? '✨ PERFECT' : offset < 0 ? `⏪ 太早 ${Math.abs(offset * CONFIG.JUMP_DURATION * 1000).toFixed(0)}ms` : `⏩ 太晚 ${(offset * CONFIG.JUMP_DURATION * 1000).toFixed(0)}ms`}`);

    const jumpY = jumpOffset(tNorm) * (W * CONFIG.JUMP_HEIGHT_RATIO);
    const bx = g.ballX;
    const by = g.groundY - jumpY;

    const tx = g.hoopX;
    const ty = g.hoopY;
    const T = CONFIG.SHOT_TARGET_TIME;
    const vx0 = (tx - bx) / T;
    const G = W * CONFIG.GRAVITY_RATIO;
    const vy0 = (ty - by - 0.5 * G * T * T) / T - G * CONFIG.EULER_COMPENSATION;

    const driftMag = absOff < CONFIG.PERFECT_TOLERANCE
      ? 0
      : Math.min(1, (absOff - CONFIG.PERFECT_TOLERANCE) / (CONFIG.MAX_DRIFT_T - CONFIG.PERFECT_TOLERANCE));

    const sign = Math.sign(offset) || (Math.random() < 0.5 ? -1 : 1);
    const rand = (Math.random() - 0.5) * 0.4;

    const speed = Math.hypot(vx0, vy0);
    const angle = Math.atan2(vy0, vx0);

    // 基礎 jitter — 所有球都會有，讓每次投籃略微不同
    const baseJitter = (Math.random() - 0.5) * 2; // -1 ~ 1
    const baseJitter2 = (Math.random() - 0.5) * 2;

    // drift — 釋放時機不準時的額外偏移
    const driftSpeed = (sign * driftMag * CONFIG.SHOT_DRIFT_VEL) + rand * 0.05 * driftMag;
    const driftAngle = (sign * driftMag * CONFIG.SHOT_DRIFT_ANGLE) + rand * 0.15 * driftMag;

    const newSpeed = speed
      * (1 + baseJitter * CONFIG.PERFECT_JITTER_VEL)
      * (1 + driftSpeed);
    const newAngle = angle
      + baseJitter2 * CONFIG.PERFECT_JITTER_ANGLE
      + driftAngle;

	const vx = Math.cos(newAngle) * newSpeed;
    const vy = Math.sin(newAngle) * newSpeed;

    state.balls.push({
      id: state.nextBallId++,
      x: bx, y: by,
      vx, vy,
      r: g.ballR,
      spin: (Math.random() - 0.5) * 8,
      rot: 0,
      passedRimTopAt: null,
      scored: false,
      lastBoardHit: 0,
      lastRimHit: 0,
      bornAt: performance.now(),
    });

    state.attempts += 1;

    state.cooldown = CONFIG.COOLDOWN;
    state.ready = false;
    SFX.shoot();
  }

  function jumpOffset(tNorm) {
    if (tNorm <= 0 || tNorm >= 1) return 0;
    return Math.sin(tNorm * Math.PI);
  }

  function step(dt) {
    if (state.phase !== PHASE.PLAYING) return;

    // 限時模式：扣時間
    if (state.mode === MODE.TIMED) {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        state.phase = PHASE.OVER;
        SFX.end();
      }
    }

    if (state.holding) {
      state.holdT += dt;
      if (state.holdT >= CONFIG.JUMP_DURATION) {
        state.holdT = CONFIG.JUMP_DURATION;
        state.jumpDone = true;
      }
    }

    if (state.cooldown > 0) {
      state.cooldown -= dt;
      if (state.cooldown <= 0) { state.cooldown = 0; state.ready = true; }
    }

    const g = geom();
    for (const b of state.balls) {
      b.prevX = b.x;
      b.prevY = b.y;
      b.vy += W * CONFIG.GRAVITY_RATIO * dt;
      b.vx *= (1 - CONFIG.AIR_DRAG * dt * 60);
      b.vy *= (1 - CONFIG.AIR_DRAG * dt * 60);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.spin * dt;

      collideBackboard(b, g);
      collideRim(b, g);
      detectScore(b, g);
    }

    for (let i = 0; i < state.balls.length; i++) {
      for (let j = i + 1; j < state.balls.length; j++) {
        collideBalls(state.balls[i], state.balls[j]);
      }
    }

    state.balls = state.balls.filter(b => {
      const margin = b.r * 4;
      return b.x > -margin && b.x < W + margin && b.y < H + margin;
    });

    state.netImpulse *= Math.exp(-dt * 4);
    state.netPhase += dt * 14;

    if (state.lastScoreFlash > 0) state.lastScoreFlash -= dt;
  }

  function collideBackboard(b, g) {
    if (b.x + b.r < g.boardX) return;
    if (b.x - b.r > g.boardX) return;
    if (b.y < g.boardTop - b.r || b.y > g.boardBot + b.r) return;

    const cy = Math.max(g.boardTop, Math.min(g.boardBot, b.y));
    const dx = b.x - g.boardX;
    const dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    if (d > b.r) return;
    if (d === 0) return;

    const nx = dx / d, ny = dy / d;
    const overlap = b.r - d;
    b.x += nx * overlap;
    b.y += ny * overlap;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + CONFIG.RESTITUTION_BOARD) * vn * nx;
      b.vy -= (1 + CONFIG.RESTITUTION_BOARD) * vn * ny;
      const now = performance.now();
      if (now - b.lastBoardHit > 80) {
        SFX.board();
        b.lastBoardHit = now;
      }
    }
  }

 function collideRim(b, g) {
      const front = { x: g.hoopX - g.hoopW / 2, y: g.hoopY };
      const back  = { x: g.hoopX + g.hoopW / 2, y: g.hoopY };
  
      // 兩個 rim 端點的圓形碰撞
      for (const p of [front, back]) {
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const d = Math.hypot(dx, dy);
        const minD = b.r + g.rimR;
        if (d < minD && d > 0) {
          const nx = dx / d, ny = dy / d;
          const overlap = minD - d;
          b.x += nx * overlap;
          b.y += ny * overlap;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= (1 + CONFIG.RESTITUTION_RIM) * vn * nx;
            b.vy -= (1 + CONFIG.RESTITUTION_RIM) * vn * ny;
            const now = performance.now();
            if (now - b.lastRimHit > 80) {
              SFX.rim();
              b.lastRimHit = now;
            }
          }
        }
      }
  
      // 連接臂：從 rim 後緣 (back.x, back.y) 到籃板 (boardX, hoopY) 的水平線段
      // 球從上方或下方接近時要反彈
      const armLeft = back.x;
      const armRight = g.boardX;
      if (b.x > armLeft - b.r && b.x < armRight + b.r) {
        // 找出球到這條水平線段的最近點
        const cx = Math.max(armLeft, Math.min(armRight, b.x));
        const dx = b.x - cx;
        const dy = b.y - g.hoopY;
        const d = Math.hypot(dx, dy);
        // 連接臂視為很細的線（半徑近 0），所以最小距離就是 b.r
        if (d < b.r && d > 0) {
          const nx = dx / d, ny = dy / d;
          const overlap = b.r - d;
          b.x += nx * overlap;
          b.y += ny * overlap;
          const vn = b.vx * nx + b.vy * ny;
          if (vn < 0) {
            b.vx -= (1 + CONFIG.RESTITUTION_RIM) * vn * nx;
            b.vy -= (1 + CONFIG.RESTITUTION_RIM) * vn * ny;
            const now = performance.now();
            if (now - b.lastRimHit > 80) {
              SFX.rim();
              b.lastRimHit = now;
            }
          }
        }
      }
    }

 function detectScore(b, g) {
      if (b.scored) return;
      const rimY = g.hoopY;
      const xL = g.hoopX - g.hoopW / 2 + g.rimR;
      const xR = g.hoopX + g.hoopW / 2 - g.rimR;
  
      // 階段一：放寬條件——只要球中心曾經在籃框平面上方就算
      if (b.passedRimTopAt === null && b.y < rimY && b.x > xL - b.r && b.x < xR + b.r) {
        b.passedRimTopAt = b.y;
      }
  
      // 階段二：用實際的前一幀位置判斷下穿，不再用固定 0.016 回推
      const prevY = b.prevY != null ? b.prevY : b.y;
      if (
        !b.scored &&
        b.passedRimTopAt !== null &&
        b.vy > 0 &&
        prevY <= rimY &&
        b.y > rimY
      ) {
        if (b.x > xL && b.x < xR) {
          b.scored = true;
          state.score += 1;
          state.lastScoreFlash = 0.5;
          state.netImpulse = 1;
          const now = performance.now();
          const recentlyHit = (now - b.lastRimHit < 250) || (now - b.lastBoardHit < 250);
          if (recentlyHit) SFX.score();
          else SFX.swish();
        }
      }
    }

  function collideBalls(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const minD = a.r + b.r;
    if (d >= minD || d === 0) return;
    const nx = dx / d, ny = dy / d;
    const overlap = minD - d;
    a.x -= nx * overlap / 2;
    a.y -= ny * overlap / 2;
    b.x += nx * overlap / 2;
    b.y += ny * overlap / 2;
    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn > 0) return;
    const e = CONFIG.RESTITUTION_BALL;
    const j = -(1 + e) * vn / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
  }

  // ===== Rendering =====
  function draw() {
    const g = geom();
    ctx.clearRect(0, 0, W, H);
    drawFrame();
    drawScore();
    drawBottomRight();
    drawHoop(g);
    drawShooterBall(g);
    for (const b of state.balls) drawBall(b);
    if (state.phase === PHASE.PLAYING) drawAccuracyBottomLeft();
    if (state.phase === PHASE.TITLE) drawTitle();
    else if (state.phase === PHASE.OVER) drawGameOver();
  }

  function drawFrame() {
    ctx.save();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    ctx.restore();
  }

  function drawScore() {
    ctx.save();
    ctx.fillStyle = COLORS.ink;
    const flash = Math.max(0, state.lastScoreFlash);
    const scale = 1 + flash * 0.4;
    const fontSize = Math.floor(W * 0.085 * scale);
    ctx.font = `700 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(state.score), W / 2, H * 0.05);
    ctx.restore();
  }

  // 右下角：限時模式顯示倒數，練習模式顯示「回主畫面 (esc)」按鈕
  function drawBottomRight() {
    if (state.phase !== PHASE.PLAYING) {
      exitButton = null;
      return;
    }
    ctx.save();

    if (state.mode === MODE.TIMED) {
      ctx.fillStyle = COLORS.ink;
      const fontSize = Math.floor(W * 0.05);
      ctx.font = `500 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      const t = Math.max(0, state.timeLeft);
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      const txt = `${m}:${String(s).padStart(2, '0')}`;
      ctx.fillText(txt, W - W * 0.05, H - H * 0.04);
      exitButton = null;
    } else {
      // 練習模式：小小的「回主畫面 (esc)」按鈕
      const label = '回主畫面 (esc)';
      const fontSize = Math.floor(W * 0.026);
      ctx.font = `500 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
      const padX = W * 0.018;
      const padY = W * 0.012;
      const textW = ctx.measureText(label).width;
      const btnW = textW + padX * 2;
      const btnH = fontSize + padY * 2;
      const btnX = W - W * 0.05 - btnW;
      const btnY = H * 0.04;

      exitButton = { x: btnX, y: btnY, w: btnW, h: btnH };

      ctx.lineWidth = Math.max(1, W * 0.002);
      ctx.strokeStyle = COLORS.gray;
      ctx.fillStyle = COLORS.paper;
      ctx.beginPath();
      ctx.rect(btnX, btnY, btnW, btnH);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = COLORS.gray;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, btnX + btnW / 2, btnY + btnH / 2);
    }

    ctx.restore();
  }

  // 左下角：命中率（遊戲中才顯示）
  function drawAccuracyBottomLeft() {
    ctx.save();
    ctx.fillStyle = COLORS.gray;
    const fontSize = Math.floor(W * 0.035);
    ctx.font = `500 ${fontSize}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const pct = state.attempts > 0
      ? Math.round((state.score / state.attempts) * 100)
      : 0;
    const txt = `${state.score}/${state.attempts} (${pct}%)`;
    ctx.fillText(txt, W * 0.05, H - H * 0.04);
    ctx.restore();
  }

  function drawHoop(g) {
    ctx.save();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(2, W * 0.005);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(g.boardX, g.boardTop);
    ctx.lineTo(g.boardX, g.boardBot);
    ctx.stroke();

    // 連接臂：rim 後緣到籃板（用 ink 色，視覺上跟籃板統一）
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1, W * 0.003);
    ctx.beginPath();
    ctx.moveTo(g.hoopX + g.hoopW / 2, g.hoopY);
    ctx.lineTo(g.boardX, g.hoopY);
    ctx.stroke();

    // 籃框（rim）— 比連接臂粗、用 rim 色
    ctx.strokeStyle = COLORS.rim;
    ctx.lineWidth = Math.max(2, W * 0.006);
    ctx.beginPath();
    ctx.moveTo(g.hoopX - g.hoopW / 2, g.hoopY);
    ctx.lineTo(g.hoopX + g.hoopW / 2, g.hoopY);
    ctx.stroke();

    ctx.strokeStyle = COLORS.net;
    ctx.lineWidth = Math.max(1, W * 0.0025);
    const netLines = 7;
    const baseY = g.hoopY;
    const bottomY = g.hoopY + g.netDepth;
    const leftX = g.hoopX - g.hoopW / 2;
    const rightX = g.hoopX + g.hoopW / 2;
    const wiggle = state.netImpulse * 4;
    for (let i = 0; i <= netLines; i++) {
      const t = i / netLines;
      const topX = leftX + t * (rightX - leftX);
      const bx = leftX + g.hoopW * 0.2 + t * (g.hoopW * 0.6);
      const phaseOff = i * 0.7;
      const dx = Math.sin(state.netPhase + phaseOff) * wiggle;
      ctx.beginPath();
      ctx.moveTo(topX, baseY);
      ctx.lineTo(bx + dx, bottomY + Math.abs(dx) * 0.3);
      ctx.stroke();
    }
    for (let k = 1; k <= 2; k++) {
      const yy = baseY + (g.netDepth * k / 3);
      ctx.beginPath();
      const dx = Math.sin(state.netPhase + k) * wiggle * 0.6;
      ctx.moveTo(leftX + g.hoopW * 0.08 * k, yy);
      ctx.lineTo(rightX - g.hoopW * 0.08 * k + dx, yy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawShooterBall(g) {
    if (state.phase !== PHASE.PLAYING) return;
    if (!state.ready && !state.holding) return;
    let yOff = 0;
    if (state.holding) {
      const tNorm = Math.min(1, state.holdT / CONFIG.JUMP_DURATION);
      yOff = jumpOffset(tNorm) * (W * CONFIG.JUMP_HEIGHT_RATIO);
    }
    drawBallAt(g.ballX, g.groundY - yOff, g.ballR, 0);
  }

  function drawBall(b) {
    drawBallAt(b.x, b.y, b.r, b.rot);
  }

  function drawBallAt(x, y, r, rot) {
    ctx.save();
    if (ballImg) {
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(ballImg, -r, -r, r * 2, r * 2);
    } else {
      ctx.fillStyle = COLORS.ball;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.75, rot, rot + Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTitle() {
    ctx.save();
    ctx.fillStyle = 'rgba(250,250,247,0.85)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 標題 emoji
    ctx.font = `700 ${Math.floor(W * 0.14)}px sans-serif`;
    ctx.fillText('🏀🏀🏀', W / 2, H * 0.22);

    // 兩個按鈕：限時模式 / 練習模式
    const btnW = W * 0.7;
    const btnH = H * 0.11;
    const btnX = (W - btnW) / 2;
    const btnGap = H * 0.025;
    const btn1Y = H * 0.4;
    const btn2Y = btn1Y + btnH + btnGap;

    titleButtons = {
      timed:    { x: btnX, y: btn1Y, w: btnW, h: btnH },
      practice: { x: btnX, y: btn2Y, w: btnW, h: btnH },
    };

    const drawBtn = (b, label, sub) => {
      ctx.lineWidth = Math.max(1.5, W * 0.003);
      ctx.strokeStyle = COLORS.ink;
      ctx.fillStyle = COLORS.paper;
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${Math.floor(W * 0.04)}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 - W * 0.012);
      ctx.font = `400 ${Math.floor(W * 0.026)}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.fillText(sub, b.x + b.w / 2, b.y + b.h / 2 + W * 0.022);
    };

    drawBtn(
      titleButtons.timed,
      '1. 限時模式',
      `${CONFIG.GAME_DURATION} 秒內投進越多越好`
    );
    drawBtn(
      titleButtons.practice,
      '2. 練習模式',
      '不限時，自由輕鬆投'
    );

    // 提示
    ctx.font = `400 ${Math.floor(W * 0.027)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillStyle = 'rgba(26,26,26,0.55)';
    ctx.fillText('鍵盤 1 / 2，或點按鈕', W / 2, H * 0.88);

    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(250,250,247,0.9)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 限時模式：原本的畫面，完全不動
    ctx.font = `500 ${Math.floor(W * 0.045)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillText('時間到', W / 2, H * 0.36);
    ctx.font = `700 ${Math.floor(W * 0.22)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillText(String(state.score), W / 2, H * 0.5);
    ctx.font = `400 ${Math.floor(W * 0.03)}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.fillText('空白鍵 / 滑鼠 / 觸控再玩一次', W / 2, H * 0.66);
    ctx.restore();
  }

  // ===== Loop =====
  let last = performance.now();
  let rafId = 0;
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;
    step(dt);
    draw();
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  // ===== Cleanup =====
  return () => {
    cancelAnimationFrame(rafId);
    if (io) io.disconnect(); 
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    if (actx && actx.state !== 'closed') {
      actx.close().catch(() => {});
    }
  };
}

// =============================================================================
// React component
// =============================================================================
function HoopsInner({ config }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cleanup = initGame(canvas, config || {});
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={styles.stage}>
      <div style={styles.wrap}>
        <canvas ref={canvasRef} style={styles.canvas} />
        <div style={styles.hint}>投籃：按鍵後放開</div>
      </div>
    </div>
  );
}

export default function Hoops(props) {
  return (
    <BrowserOnly fallback={<div style={{ height: 400 }} />}>
      {() => <HoopsInner {...props} />}
    </BrowserOnly>
  );
}
