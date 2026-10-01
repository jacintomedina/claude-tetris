'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // Tuerca - metal gray
  '#ff7043', // Bomba
  '#fff176', // Rayo
  '#f06292', // Tinte
  '#a1887f', // Gravedad
  '#80deea', // Congelar
  '#f5f5f5', // Comodín
];

const POWER_CHANCE = 0.05;
const FREEZE_MS = 5000;
const FLASH_BLINKS = 3;
const FLASH_HALF_MS = 100;
const WILDCARD = 14;
const POWERS = [
  { type: 9,  name: 'Bomba',    icon: '💣' },
  { type: 10, name: 'Rayo',     icon: '⚡' },
  { type: 11, name: 'Tinte',    icon: '🎨' },
  { type: 12, name: 'Gravedad', icon: '⬇' },
  { type: 13, name: 'Congelar', icon: '❄' },
];
const POWER_ICONS = { [WILDCARD]: '★' };
for (const p of POWERS) POWER_ICONS[p.type] = p.icon;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Tuerca
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [400, 800, 1200, 1600];
const PC_SCORES = [0, 800, 1200, 1800, 2000];
const B2B_FACTOR = 1.5;
const POPUP_MS = 1000;
const FLASH_PC_MS = 300;
const FALL_MS_PER_ROW = 35;
const FALL_MIN_MS = 120;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const powerEl = document.getElementById('power');
const comboEl = document.getElementById('combo');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, frozenUntil, pausedAt, powerMsg, anim;
let combo, b2b, lastRotate, spin, popups, flashUntil, fall;
let audio = null, muted = false;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  if (Math.random() < POWER_CHANCE) {
    const p = POWERS[Math.floor(Math.random() * POWERS.length)];
    return { type: p.type, power: p, shape: [[p.type]], x: Math.floor(COLS / 2), y: 0 };
  }
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastRotate = true;
      return;
    }
  }
}

// T-spin: pieza T, última acción fue rotar y ≥3 esquinas de la caja 3x3 ocupadas.
function isTSpin() {
  if (current.type !== 3 || !lastRotate) return false;
  let filled = 0;
  for (const [dy, dx] of [[0, 0], [0, 2], [2, 0], [2, 2]]) {
    const nx = current.x + dx, ny = current.y + dy;
    if (nx < 0 || nx >= COLS || ny >= ROWS || (ny >= 0 && board[ny][nx])) filled++;
  }
  return filled >= 3;
}

function popup(text, color) {
  popups.push({ text, color, start: performance.now() });
}

function tone(freq, dur, type = 'square', delay = 0) {
  if (muted || !audio) return;
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.001, t);
  gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function sfx(kind, n = 1) {
  const base = 392 * Math.pow(2, Math.min(n - 1, 12) / 12);
  const arp = (ratios) => ratios.forEach((m, i) => tone(base * m, 0.18, 'triangle', i * 0.08));
  switch (kind) {
    case 'clear': tone(base, 0.15, 'square'); break;
    case 'combo': arp([1, 1.25]); break;
    case 'big':   arp([1, 1.25, 1.5]); break;
    case 'b2b':   arp([1, 1.25, 1.5, 2]); break;
    case 'pc':    arp([1, 1.25, 1.5, 2, 2.5, 3]); break;
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function tintTarget(x, y) {
  let target = y + 1 < ROWS ? board[y + 1][x] : 0;
  if (!target || target === WILDCARD) {
    const counts = {};
    for (const row of board)
      for (const v of row)
        if (v && v !== WILDCARD) counts[v] = (counts[v] || 0) + 1;
    let best = 0;
    for (const k in counts) if (counts[k] > (counts[best] || 0)) best = +k;
    target = best;
  }
  return target;
}

// Celdas del tablero que el power-up hace desaparecer (para animarlas antes).
function powerTargets(piece) {
  const x = piece.x, y = piece.y;
  const cells = [];
  const add = (r, c) => {
    if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c]) cells.push([r, c]);
  };
  switch (piece.power.type) {
    case 9:
      for (let r = y - 1; r <= y + 1; r++)
        for (let c = x - 1; c <= x + 1; c++) add(r, c);
      break;
    case 10:
      for (let c = 0; c < COLS; c++) add(y, c);
      for (let r = 0; r < ROWS; r++) if (r !== y) add(r, x);
      break;
    case 11: {
      const target = tintTarget(x, y);
      if (target)
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) if (board[r][c] === target) cells.push([r, c]);
      break;
    }
  }
  return cells;
}

// Celdas que desaparecen al limpiar líneas: filas llenas + comodines.
function lineClearCells() {
  const cells = [];
  for (let r = 0; r < ROWS; r++)
    if (board[r].every(v => v !== 0))
      for (let c = 0; c < COLS; c++) cells.push([r, c]);
  if (!cells.length) return cells;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c] === WILDCARD && board[r].some(v => v === 0)) cells.push([r, c]);
  return cells;
}

function animate(cells, done) {
  anim = { cells: new Set(cells.map(([r, c]) => r * COLS + c)), start: performance.now(), done };
}

// Compacta cada columna hacia abajo. Devuelve los movimientos para animarlos.
function settleColumns() {
  const moves = [];
  for (let c = 0; c < COLS; c++) {
    let to = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      const v = board[r][c];
      if (!v) continue;
      if (r !== to) {
        board[to][c] = v;
        board[r][c] = 0;
        moves.push({ c, from: r, to, v });
      }
      to--;
    }
  }
  return moves;
}

// El tablero ya está en su estado final; fall solo anima los bloques desde su origen.
function runFall(moves, done) {
  if (!moves.length) { done(); return; }
  const dist = Math.max(...moves.map(m => m.to - m.from));
  fall = {
    moves,
    skip: new Set(moves.map(m => m.to * COLS + m.c)),
    start: performance.now(),
    dur: Math.max(FALL_MIN_MS, FALL_MS_PER_ROW * dist),
    done,
  };
}

function applyPower(piece) {
  const x = piece.x, y = piece.y;
  switch (piece.power.type) {
    case 9: // Bomba 3x3
      for (let r = y - 1; r <= y + 1; r++)
        for (let c = x - 1; c <= x + 1; c++)
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS) board[r][c] = 0;
      score += 50 * level;
      break;
    case 10: // Rayo fila + columna
      if (y >= 0) board[y].fill(0);
      for (let r = 0; r < ROWS; r++) board[r][x] = 0;
      score += 100 * level;
      break;
    case 11: { // Tinte
      const target = tintTarget(x, y);
      if (target)
        for (const row of board)
          for (let c = 0; c < COLS; c++)
            if (row[c] === target) row[c] = WILDCARD;
      break;
    }
    case 12: // Gravedad: la compactación la hace lockPiece (settleColumns)
      break;
    case 13: // Congelar
      frozenUntil = performance.now() + FREEZE_MS;
      break;
  }
  powerMsg = piece.power.name;
}

function clearLines() {
  const wasSpin = spin;
  spin = false;
  let cleared = 0;
  const moves = [];
  let below = 0; // filas llenas debajo de la fila actual
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) { below++; continue; }
    if (!below) continue;
    for (let c = 0; c < COLS; c++)
      if (board[r][c]) moves.push({ c, from: r, to: r + below, v: board[r][c] });
  }
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (board[r][c] === WILDCARD) {
          board[r][c] = 0;
          score += 25 * level;
        }
    lines += cleared;
    combo++;
    const difficult = cleared === 4 || wasSpin;
    let base = wasSpin ? TSPIN_SCORES[cleared] : LINE_SCORES[cleared];
    const backToBack = difficult && b2b;
    if (backToBack) base *= B2B_FACTOR;
    b2b = difficult;
    base *= combo;
    const perfect = board.every(row => row.every(v => !v));
    score += Math.round(base + (perfect ? PC_SCORES[cleared] : 0)) * level;

    if (wasSpin) popup('T-SPIN', '#ba68c8');
    else if (cleared === 4) popup('TETRIS', '#4dd0e1');
    if (backToBack) popup('B2B x1.5', '#ffd54f');
    if (combo >= 2) popup(`COMBO x${combo}`, combo >= 5 ? '#ff7043' : combo >= 3 ? '#ffb74d' : '#fff176');
    if (perfect) {
      popup('PERFECT CLEAR', '#f5f5f5');
      flashUntil = performance.now() + FLASH_PC_MS;
    }
    if (perfect) sfx('pc', combo);
    else if (backToBack) sfx('b2b', combo);
    else if (difficult) sfx('big', combo);
    else if (combo >= 2) sfx('combo', combo);
    else sfx('clear', combo);

    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  } else {
    combo = 0;
    if (wasSpin) {
      score += TSPIN_SCORES[0] * level;
      popup('T-SPIN', '#ba68c8');
      sfx('big', 1);
    }
    updateHUD();
  }
  // los comodines eliminados ya no existen: no se animan
  return moves.filter(m => board[m.to][m.c] === m.v);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastRotate = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  if (current.power) {
    spin = false;
    const after = () => {
      applyPower(current);
      const t = current.power.type;
      runFall(t === 9 || t === 10 || t === 12 ? settleColumns() : [], finishLock);
    };
    const cells = powerTargets(current);
    if (cells.length) animate(cells, after);
    else after();
  } else {
    spin = isTSpin();
    merge();
    finishLock();
  }
}

function finishLock() {
  const cells = lineClearCells();
  const after = () => runFall(clearLines(), spawn);
  if (cells.length) animate(cells, after);
  else after();
}

function spawn() {
  lastRotate = false;
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  const comboText = combo >= 2 ? `x${combo}${b2b ? ' B2B' : ''}` : (b2b ? 'B2B' : '—');
  if (comboEl.textContent !== comboText) comboEl.textContent = comboText;
  comboEl.classList.toggle('combo-hot', combo >= 3);
}

function updatePowerHUD() {
  const left = frozenUntil - performance.now();
  const text = left > 0 ? `${powerMsg} ${Math.ceil(left / 1000)}s` : (powerMsg || '—');
  if (powerEl.textContent !== text) powerEl.textContent = text;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const icon = POWER_ICONS[colorIndex];
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  if (icon) {
    context.fillStyle = '#000';
    context.font = `${Math.floor(size * 0.6)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(icon, x * size + size / 2, y * size + size / 2 + 1);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--grid');
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  updatePowerHUD();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (!fall || !fall.skip.has(r * COLS + c)) drawBlock(ctx, c, r, board[r][c], BLOCK);

  // bloques en caída: de su origen a su destino con aceleración
  if (fall) {
    const t = Math.min(1, (performance.now() - fall.start) / fall.dur);
    for (const m of fall.moves)
      drawBlock(ctx, m.c, m.from + (m.to - m.from) * t * t, m.v, BLOCK);
  }

  // parpadeo: los bloques que van a desaparecer destellan en blanco
  if (anim) {
    const phase = Math.floor((performance.now() - anim.start) / FLASH_HALF_MS);
    if (phase % 2 === 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      for (const k of anim.cells) {
        const r = Math.floor(k / COLS), c = k % COLS;
        ctx.fillRect(c * BLOCK + 1, r * BLOCK + 1, BLOCK - 2, BLOCK - 2);
      }
    }
  }

  drawEffects();

  if (gameOver) return;

  if (anim) {
    // solo el power-up sigue visible mientras parpadea
    if (current.power) drawBlock(ctx, current.x, current.y, current.type, BLOCK);
    return;
  }

  if (fall) return;

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

// Destello de Perfect Clear y textos flotantes de combo/bonus.
function drawEffects() {
  const now = performance.now();
  const flashLeft = flashUntil - now;
  if (flashLeft > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.6 * flashLeft / FLASH_PC_MS})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  popups = popups.filter(p => now - p.start < POPUP_MS);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  popups.forEach((p, i) => {
    const t = (now - p.start) / POPUP_MS;
    ctx.globalAlpha = 1 - t * t;
    ctx.font = 'bold 26px sans-serif';
    const y = canvas.height / 2 - 40 * t + i * 32 - (popups.length - 1) * 16;
    ctx.strokeText(p.text, canvas.width / 2, y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, canvas.width / 2, y);
  });
  ctx.globalAlpha = 1;
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    if (frozenUntil > pausedAt) frozenUntil += lastTime - pausedAt;
    if (anim) anim.start += lastTime - pausedAt;
    if (fall) fall.start += lastTime - pausedAt;
    for (const p of popups) p.start += lastTime - pausedAt;
    if (flashUntil > pausedAt) flashUntil += lastTime - pausedAt;
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    pausedAt = performance.now();
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (anim) {
    dropAccum = 0;
    if (ts - anim.start >= FLASH_BLINKS * 2 * FLASH_HALF_MS) {
      const done = anim.done;
      anim = null;
      done();
      if (gameOver) { draw(); return; }
    }
  } else if (fall) {
    dropAccum = 0;
    if (ts - fall.start >= fall.dur) {
      const done = fall.done;
      fall = null;
      done();
      if (gameOver) { draw(); return; }
    }
  } else if (ts < frozenUntil) dropAccum = 0;
  else if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      lastRotate = false;
    } else {
      lockPiece();
      if (gameOver) { draw(); return; }
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  frozenUntil = 0;
  pausedAt = 0;
  anim = null;
  fall = null;
  combo = 0;
  b2b = false;
  lastRotate = false;
  spin = false;
  popups = [];
  flashUntil = 0;
  powerMsg = '';
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (!audio && window.AudioContext) audio = new AudioContext();
  if (e.code === 'KeyM') { muted = !muted; return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver || anim || fall) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastRotate = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastRotate = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

themeToggle.addEventListener('click', () => {
  const light = themeToggle.getAttribute('aria-checked') !== 'true';
  themeToggle.setAttribute('aria-checked', light);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  themeToggle.blur(); // evita que Space (caída) reactive el botón
  if (paused || gameOver) draw();
});

init();
