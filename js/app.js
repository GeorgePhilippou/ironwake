// Ironwake — app controller: screens, input, animation sequencing, persistence.

import {
  FLEET, CELLS, UNKNOWN, MISS, HIT, cellName, shipName, shipCells, isSunk,
  validatePlacement, isFleetComplete, randomFleet, randomSpot, rotatedPlacement,
  createBoard, publicView, afloat,
} from './engine.js';
import { chooseShot, LEVELS } from './ai.js';
import { newGame, commitFleet, takeShot, playerStats } from './game.js';
import {
  loadSettings, saveSettings, loadStats, saveStats, blankStats, recordSolo,
  loadGame, saveGame, clearGame,
} from './storage.js';
import { shipSVG, EMBLEM, ICONS } from './art.js';
import { Sfx } from './audio.js';
import { Fx } from './fx.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?speed=N shortens every scripted delay. Used only for automated play-testing.
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const wait = (ms) => new Promise((r) => setTimeout(r, ms / SPEED));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const IS_IPAD = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const DEVICE = IS_IPAD ? 'iPad' : 'device';

const LEVEL_INFO = {
  easy: { name: 'Easy', blurb: 'Fires at random. A gentle shakedown cruise.' },
  normal: { name: 'Normal', blurb: 'Hunts in a pattern and chases down every hit.' },
  hard: { name: 'Hard', blurb: 'Calculates where your ships are most likely to be.' },
};

// ───────── State ─────────
let settings = loadSettings();
let stats = loadStats();
let game = loadGame();
let viewer = 0; // whose eyes the battle screen is drawn for
let gen = 0; // bumped whenever the current match flow is abandoned; stale async steps check it
let busy = false; // a shot is resolving
let covered = false; // pass-and-play handover screen is up
let screen = 'title';
let sheetOpen = false;
let lastBests = { shots: false, time: false };
let log = [];
let underFire = false; // solo: the computer is taking its shot

if (game && game.phase === 'over') { game = null; clearGame(); }
if (game && game.mode === 'duo') game.cover = true; // never reopen straight on to someone's fleet

const sfx = new Sfx();
const fx = new Fx($('fx'));

const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mqLight = window.matchMedia('(prefers-color-scheme: light)');
const reduced = () => (settings.reducedMotion === null ? mqMotion.matches : settings.reducedMotion);
const isLight = () => (settings.theme === 'auto' ? mqLight.matches : settings.theme === 'light');
const timing = () => (reduced()
  ? { aim: 120, hold: 560, sunkHold: 1000, think: 380, result: 500 }
  : { aim: 280, hold: 760, sunkHold: 1650, think: 720, result: 900 });

function applySettings() {
  const root = document.documentElement;
  if (settings.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = settings.theme;
  root.dataset.motion = reduced() ? 'reduced' : 'full';
  sfx.enabled = settings.sound;
  fx.reduced = reduced();
  fx.light = isLight();
  $('theme-color').setAttribute('content', isLight() ? '#e4dfd0' : '#04090d');
}
mqMotion.addEventListener('change', applySettings);
mqLight.addEventListener('change', applySettings);

function persist() {
  if (game && game.phase !== 'over') saveGame(game); else clearGame();
}

function bumpGen() {
  gen++;
  busy = false;
  underFire = false;
  fx.clear();
  $('callout').className = 'callout';
}

// ───────── Feedback: haptics, toast, callout ─────────
const HAPTIC = { tap: 10, place: 14, miss: 18, hit: [30, 40, 70], sunk: [70, 50, 70, 50, 180], error: [18, 40, 18], win: [40, 60, 40, 60, 220] };
const GESTURE_HAPTICS = new Set(['tap', 'place', 'error']);
function haptic(kind) {
  if (!settings.haptics) return;
  try {
    if (navigator.vibrate) {
      // Browsers refuse (and log) vibration before the first real tap.
      if (!navigator.userActivation || navigator.userActivation.hasBeenActive) navigator.vibrate(HAPTIC[kind] || 10);
    }
    // iOS has no vibrate(); toggling a native switch gives a system tick, but only inside a tap.
    else if (GESTURE_HAPTICS.has(kind)) $('hx-label').click();
  } catch { /* unsupported */ }
}

let toastTimer = 0;
let toastAction = null;
function toast(msg, { warn = false, action = null, ms = 2600 } = {}) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `show${warn ? ' warn' : ''}${action ? ' action' : ''}`;
  toastAction = action;
  clearTimeout(toastTimer);
  if (!action) toastTimer = setTimeout(() => { el.className = ''; }, ms);
}
$('toast').addEventListener('click', () => { if (toastAction) toastAction(); });

function callout(text, kind, anchor, dur = 1100, small = false) {
  const el = $('callout');
  const r = anchor.getBoundingClientRect();
  el.className = `callout ${kind}${small ? ' small' : ''}`;
  el.textContent = text;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top + r.height / 2}px`;
  el.style.setProperty('--dur', `${dur / SPEED}ms`);
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
}

function shake(el, big = false) {
  if (reduced()) return;
  el.classList.remove('shake', 'big');
  void el.offsetWidth;
  el.classList.add('shake');
  if (big) el.classList.add('big');
}

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pct = (x) => `${Math.round(x * 100)}%`;

// ───────── Board component ─────────
function shipHTML(s, cls = '') {
  return `<div class="ship ${cls}" data-id="${s.id}" style="left:${s.c * 10}%;top:${s.r * 10}%;width:${(s.horiz ? s.len : 1) * 10}%;height:${(s.horiz ? 1 : s.len) * 10}%">${shipSVG(s.id, s.horiz)}</div>`;
}

function makeBoard(host, { buttons = false, onCell = null } = {}) {
  const cols = Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join('');
  const rows = [...'ABCDEFGHIJ'].map((l) => `<span>${l}</span>`).join('');
  host.innerHTML = `<div class="labels cols" aria-hidden="true">${cols}</div><div class="labels rows" aria-hidden="true">${rows}</div>
    <div class="grid"><i class="sweep"></i><div class="ships"></div><div class="preview" hidden></div><div class="cells"></div></div>`;
  const grid = host.querySelector('.grid');
  const cellsEl = host.querySelector('.cells');
  const shipsEl = host.querySelector('.ships');
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    const el = document.createElement(buttons ? 'button' : 'div');
    el.className = 'cell';
    el.style.setProperty('--n', (i * 7) % 11);
    if (buttons) { el.type = 'button'; el.dataset.i = i; }
    cellsEl.append(el);
    cells.push(el);
  }
  if (onCell) {
    // iPad Safari can suppress the synthesized click after slight finger movement.
    // Keep the square where the finger landed and cancel gestures that move farther.
    let tap = null;
    const tapSlop = 12;
    const movedTooFar = (touch) => Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) > tapSlop;

    cellsEl.addEventListener('touchstart', (e) => {
      tap = null;
      const cell = e.target.closest('.cell');
      if (!cell || e.touches.length !== 1 || !canFire()) return;
      const touch = e.changedTouches[0];
      tap = { cell, id: touch.identifier, x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    cellsEl.addEventListener('touchmove', (e) => {
      if (!tap) return;
      const touch = Array.from(e.touches).find((t) => t.identifier === tap.id);
      if (e.touches.length !== 1 || !touch || movedTooFar(touch)) tap = null;
    }, { passive: true });
    cellsEl.addEventListener('touchcancel', () => { tap = null; });
    cellsEl.addEventListener('touchend', (e) => {
      // Handle touch here and suppress its synthetic click. Mouse and keyboard use click below.
      if (!e.cancelable) { tap = null; return; }
      e.preventDefault();
      const touch = tap && Array.from(e.changedTouches).find((t) => t.identifier === tap.id);
      const cell = touch && e.touches.length === 0 && !movedTooFar(touch) ? tap.cell : null;
      tap = null;
      if (cell) onCell(Number(cell.dataset.i), cell);
    }, { passive: false });
    cellsEl.addEventListener('click', (e) => {
      const c = e.target.closest('.cell');
      if (c) onCell(Number(c.dataset.i), c);
    });
  }
  let shipKey = null;
  return {
    host, grid, cells, shipsEl, preview: host.querySelector('.preview'),
    /** ships: 'all' shows every ship; 'sunk' shows wrecks only; reveal adds the survivors as outlines. */
    paint(board, { ships = 'all', last = -1, fresh = -1, freshShip = null, reveal = false } = {}) {
      const sunkCells = new Set();
      const sunkIds = new Set();
      for (const s of board.ships) {
        if (isSunk(board, s)) { sunkIds.add(s.id); for (const c of shipCells(s)) sunkCells.add(c); }
      }
      for (let i = 0; i < CELLS; i++) {
        const v = board.shots[i];
        let cls = 'cell';
        if (v === MISS) cls += ' miss';
        else if (v === HIT) cls += sunkCells.has(i) ? ' hit sunk' : ' hit';
        if (i === last) cls += ' last';
        if (i === fresh) cls += ' fresh';
        const el = cells[i];
        if (el.className !== cls) el.className = cls;
        if (buttons) {
          const label = `${cellName(i)}${v === MISS ? ', miss' : v === HIT ? (sunkCells.has(i) ? ', sunk' : ', hit') : ''}`;
          if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
        }
      }
      const list = board.ships
        .filter((s) => ships === 'all' || sunkIds.has(s.id) || reveal)
        .map((s) => ({ s, cls: sunkIds.has(s.id) ? 'wreck' : ships === 'all' ? '' : 'revealed' }));
      const key = list.map(({ s, cls }) => `${s.id}.${s.r}.${s.c}.${s.horiz ? 1 : 0}.${cls}`).join('|');
      if (key !== shipKey) {
        shipKey = key;
        shipsEl.innerHTML = list.map(({ s, cls }) => shipHTML(s, cls)).join('');
        if (freshShip) {
          const el = shipsEl.querySelector(`[data-id="${freshShip}"]`);
          if (el) el.classList.add('fresh');
        }
      }
    },
    resetShips() { shipKey = null; },
    cellCenter(i) {
      const r = cells[i].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    cellSize() { return grid.getBoundingClientRect().width / 10; },
  };
}

const placeBoard = makeBoard($('place-board'));
const targetBoard = makeBoard($('target-board'), { buttons: true, onCell: playerFire });
const ownBoard = makeBoard($('own-board'));

// ───────── Screens ─────────
function showScreen(name) {
  screen = name;
  for (const id of ['title', 'place', 'battle']) $(id).hidden = id !== name;
}

function showTitle() {
  showScreen('title');
  const live = game && game.phase !== 'over';
  $('btn-resume').hidden = !live;
  $('btn-solo').classList.toggle('primary', !live);
  if (live) {
    const mode = game.mode === 'solo' ? `Solo · ${LEVEL_INFO[game.difficulty].name}` : 'Pass & play';
    const shots = game.boards.reduce((n, b) => n + b.shots.filter((s) => s !== UNKNOWN).length, 0);
    const where = game.phase === 'placement' ? 'Deploying fleet' : `${shots} shot${shots === 1 ? '' : 's'} fired · ${fmtTime(game.elapsedMs)}`;
    $('resume-detail').textContent = `${mode} · ${where}`;
  }
}

async function requestNewGame(mode) {
  sfx.play('click');
  if (game && game.phase !== 'over') {
    const ok = await confirmDialog({
      title: 'Start a new game?',
      text: 'Your battle in progress will be abandoned.',
      yes: 'New game',
      danger: true,
    });
    if (!ok) return;
  }
  openSetup(mode);
}

function startGame(options) {
  bumpGen();
  covered = false;
  log = [];
  $('result').hidden = true;
  $('cover').hidden = true;
  closeSheet();
  game = newGame(options);
  persist();
  enterPlacement();
}

function resumeGame() {
  if (!game) return showTitle();
  sfx.play('click');
  if (game.phase === 'placement') enterPlacement(); else enterBattle();
}

function quitToMenu() {
  bumpGen();
  covered = false;
  if (game && game.phase === 'over') game = null;
  else if (game && game.mode === 'duo') game.cover = true;
  persist();
  closeSheet();
  $('result').hidden = true;
  $('cover').hidden = true;
  showTitle();
}

// ───────── Placement ─────────
let drag = null;
const draft = () => game.draft;

function enterPlacement() {
  showScreen('place');
  const duo = game.mode === 'duo';
  $('place-eyebrow').textContent = duo ? `Pass & play · Player ${game.placing + 1}` : `Solo mission · ${LEVEL_INFO[game.difficulty].name}`;
  $('place-title').textContent = 'Deploy your fleet';
  $('place-hint').textContent = game.keepShipsApart
    ? 'Leave a one-square gap between ships, including at corners. Tap to rotate.'
    : 'Drag to place · tap to rotate · drag off the grid to remove';
  renderPlacement();
  if (duo && game.cover) showCover();
}

function renderPlacement(pop = null) {
  const ships = draft();
  placeBoard.shipsEl.innerHTML = ships.map((s) => shipHTML(s, pop === 'all' || pop === s.id ? 'dropped' : '')).join('');
  $('tray').innerHTML = FLEET.map((spec) => {
    const placed = ships.some((s) => s.id === spec.id);
    return `<button type="button" class="tray-item${placed ? ' placed' : ''}" data-id="${spec.id}" style="--len:${spec.len}"${placed ? ' tabindex="-1"' : ''}>
      <span class="ship">${shipSVG(spec.id)}</span><span class="nm">${spec.name}</span><span class="ln">${placed ? 'ON GRID' : `${spec.len} CELLS`}</span></button>`;
  }).join('');
  $('tray-count').textContent = `${ships.length} / ${FLEET.length}`;
  $('btn-deploy').disabled = !isFleetComplete(ships, game.keepShipsApart);
  $('btn-clear').disabled = ships.length === 0;
}

function setDraftShip(ship) {
  game.draft = draft().filter((s) => s.id !== ship.id).concat(ship);
  persist();
}

function beginPress(e, id, source, el) {
  if (drag || !e.isPrimary || e.button > 0 || covered || sheetOpen) return;
  const spec = FLEET.find((s) => s.id === id);
  const placed = draft().find((s) => s.id === id);
  if (!spec || (source === 'tray' && placed)) return;
  sfx.unlock();
  const art = source === 'tray' ? el.querySelector('.ship') : el;
  const rect = art.getBoundingClientRect();
  const horiz = placed ? placed.horiz : true;
  const frac = horiz ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
  drag = {
    id, len: spec.len, horiz, source, el,
    pointerId: e.pointerId, x0: e.clientX, y0: e.clientY,
    grab: clamp(Math.floor(frac * spec.len), 0, spec.len - 1),
    moved: false, ghost: null, cand: null, touch: e.pointerType === 'touch',
  };
  e.preventDefault();
}

function dragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8) return;
    d.moved = true;
    d.cell = placeBoard.cellSize();
    d.ghost = document.createElement('div');
    d.ghost.className = 'ship drag-ghost';
    d.ghost.style.width = `${(d.horiz ? d.len : 1) * d.cell}px`;
    d.ghost.style.height = `${(d.horiz ? 1 : d.len) * d.cell}px`;
    d.ghost.innerHTML = shipSVG(d.id, d.horiz);
    document.body.append(d.ghost);
    d.el.classList.add('lifted');
  }
  const cell = d.cell;
  const lift = d.touch ? cell * 0.75 : 0; // keep the ship visible above a fingertip
  const gx = e.clientX - (d.horiz ? (d.grab + 0.5) * cell : cell / 2);
  const gy = e.clientY - lift - (d.horiz ? cell / 2 : (d.grab + 0.5) * cell);
  d.ghost.style.transform = `translate(${gx}px, ${gy}px)`;

  const g = placeBoard.grid.getBoundingClientRect();
  const px = e.clientX - g.left;
  const py = e.clientY - lift - g.top;
  const slack = cell * 0.8;
  const pv = placeBoard.preview;
  if (px > -slack && py > -slack && px < g.width + slack && py < g.height + slack) {
    const c = clamp(Math.floor(px / cell) - (d.horiz ? d.grab : 0), 0, 10 - (d.horiz ? d.len : 1));
    const r = clamp(Math.floor(py / cell) - (d.horiz ? 0 : d.grab), 0, 10 - (d.horiz ? 1 : d.len));
    d.cand = { id: d.id, len: d.len, r, c, horiz: d.horiz };
    const ok = validatePlacement(draft(), d.cand, game.keepShipsApart).ok;
    pv.hidden = false;
    pv.className = `preview${ok ? '' : ' bad'}`;
    pv.style.cssText = `left:${c * 10}%;top:${r * 10}%;width:${(d.horiz ? d.len : 1) * 10}%;height:${(d.horiz ? 1 : d.len) * 10}%`;
    d.ghost.classList.toggle('bad', !ok);
  } else {
    d.cand = null;
    pv.hidden = true;
    d.ghost.classList.remove('bad');
  }
}

function refuse(id, message) {
  sfx.play('error');
  haptic('error');
  toast(message, { warn: true });
  const el = placeBoard.shipsEl.querySelector(`[data-id="${id}"]`) || $('tray').querySelector(`[data-id="${id}"]`);
  if (el) el.classList.add('refuse');
}

function dragEnd(e, cancelled = false) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (d.ghost) d.ghost.remove();
  placeBoard.preview.hidden = true;
  if (screen !== 'place' || !game || game.phase !== 'placement') return;
  let pop = null;
  let refusal = null;

  if (cancelled) {
    // leave everything where it was
  } else if (!d.moved) {
    if (d.source === 'board') {
      const ship = draft().find((s) => s.id === d.id);
      const rot = ship && rotatedPlacement(draft(), ship, game.keepShipsApart);
      if (rot) { setDraftShip(rot); pop = d.id; sfx.play('rotate'); haptic('tap'); }
      else refusal = 'No room to rotate that ship here.';
    } else {
      const spot = randomSpot(draft(), FLEET.find((s) => s.id === d.id), Math.random, game.keepShipsApart);
      if (spot) { setDraftShip(spot); pop = d.id; sfx.play('place'); haptic('place'); }
    }
  } else if (d.cand) {
    const v = validatePlacement(draft(), d.cand, game.keepShipsApart);
    if (v.ok) { setDraftShip(d.cand); pop = d.id; sfx.play('place'); haptic('place'); }
    else if (v.reason === 'overlap') refusal = `That overlaps your ${shipName(v.with)}.`;
    else if (v.reason === 'touching') refusal = `Leave a one-square gap around your ${shipName(v.with)}.`;
    else refusal = 'That would put the ship off the grid.';
  } else if (d.source === 'board') {
    game.draft = draft().filter((s) => s.id !== d.id);
    persist();
    sfx.play('rotate');
  }
  renderPlacement(pop);
  if (refusal) refuse(d.id, refusal);
}

placeBoard.shipsEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.ship');
  if (el) beginPress(e, el.dataset.id, 'board', el);
});
$('tray').addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.tray-item');
  if (el) beginPress(e, el.dataset.id, 'tray', el);
});
// Keyboard users: Enter/Space on a tray ship places it.
$('tray').addEventListener('click', (e) => {
  const el = e.target.closest('.tray-item');
  if (!el || e.detail !== 0 || draft().some((s) => s.id === el.dataset.id)) return;
  const spot = randomSpot(draft(), FLEET.find((s) => s.id === el.dataset.id), Math.random, game.keepShipsApart);
  if (spot) { setDraftShip(spot); renderPlacement(spot.id); }
});
window.addEventListener('pointermove', dragMove);
window.addEventListener('pointerup', (e) => dragEnd(e));
window.addEventListener('pointercancel', (e) => dragEnd(e, true));

$('btn-auto').addEventListener('click', () => {
  if (drag) return;
  game.draft = randomFleet(Math.random, game.keepShipsApart);
  persist();
  sfx.play('place');
  haptic('place');
  renderPlacement('all');
});
$('btn-clear').addEventListener('click', () => {
  if (drag) return;
  game.draft = [];
  persist();
  sfx.play('rotate');
  renderPlacement();
});
$('btn-deploy').addEventListener('click', () => {
  if (drag || !game || game.phase !== 'placement') return;
  const res = commitFleet(game, game.placing, draft());
  if (!res.ok) return toast('Place all five ships first.', { warn: true });
  persist();
  sfx.play('deploy');
  haptic('place');
  if (game.phase === 'battle') enterBattle(true); else enterPlacement();
});
$('place-back').addEventListener('click', () => { sfx.play('click'); quitToMenu(); });

// ───────── Battle ─────────
const nameOf = (p) => (game.mode === 'solo' ? (p === 0 ? 'You' : 'Enemy') : `Player ${p + 1}`);

function canFire() {
  return screen === 'battle' && game && game.phase === 'battle' && !busy && !covered && !sheetOpen
    && (game.mode === 'duo' || game.turn === 0);
}

function setTurn(state, main, sub) {
  $('turn').dataset.state = state;
  $('turn-main').textContent = main;
  $('turn-sub').textContent = sub;
  refreshLive();
}

function refreshLive() {
  targetBoard.host.classList.toggle('live', canFire());
  ownBoard.host.classList.toggle('under-fire', underFire && screen === 'battle');
}

function fleetRows(board, justSunk) {
  return FLEET.map((spec) => {
    const ship = board.ships.find((s) => s.id === spec.id);
    const sunk = ship && isSunk(board, ship);
    return `<div class="fleet-row${sunk ? ' sunk' : ''}${justSunk === spec.id ? ' just' : ''}" style="--len:${spec.len}">
      <span class="ship${sunk ? ' wreck' : ''}">${shipSVG(spec.id)}</span><span class="nm">${spec.name}</span><span class="st">${sunk ? 'SUNK' : 'AFLOAT'}</span></div>`;
  }).join('');
}

function paintBattle({ fresh = -1, freshShip = null, freshOn = null } = {}) {
  const over = game.phase === 'over';
  const theirs = game.boards[1 - viewer];
  const mine = game.boards[viewer];
  const last = game.last;
  targetBoard.paint(theirs, {
    ships: 'sunk', reveal: over,
    last: last && last.by === viewer ? last.cell : -1,
    fresh: freshOn === 'target' ? fresh : -1,
    freshShip: freshOn === 'target' ? freshShip : null,
  });
  ownBoard.paint(mine, {
    ships: 'all',
    last: last && last.by !== viewer ? last.cell : -1,
    fresh: freshOn === 'own' ? fresh : -1,
    freshShip: freshOn === 'own' ? freshShip : null,
  });
  $('enemy-fleet').innerHTML = fleetRows(theirs, freshOn === 'target' ? freshShip : null);
  $('enemy-count').textContent = `${afloat(theirs).length} / ${FLEET.length} afloat`;
  $('own-count').textContent = `${afloat(mine).length} / ${FLEET.length} afloat`;
  const st = playerStats(game, viewer);
  $('ro-shots').textContent = st.shots;
  $('ro-acc').textContent = st.shots ? pct(st.accuracy) : '–';
  $('ro-time').textContent = fmtTime(game.elapsedMs);
  $('ticker').innerHTML = log.slice(0, 2).join('');
  refreshLive();
}

function blankBattle() {
  targetBoard.paint(createBoard());
  ownBoard.paint(createBoard());
  $('enemy-fleet').innerHTML = '';
  $('ticker').innerHTML = '';
  for (const id of ['enemy-count', 'own-count']) $(id).textContent = '';
  $('ro-shots').textContent = '0';
  $('ro-acc').textContent = '–';
  setTurn('', 'Stand by', '');
}

function logShot(by, cell, result, shipId) {
  const what = result === 'miss' ? 'miss' : result === 'hit' ? '<span class="hit">hit</span>' : `<span class="hit">${shipName(shipId)} sunk</span>`;
  log.unshift(`<div><b>${nameOf(by)}</b> → ${cellName(cell)} · ${what}</div>`);
  log.length = Math.min(log.length, 4);
}

function enterBattle(fresh = false) {
  showScreen('battle');
  log = [];
  if (game.last) logShot(game.last.by, game.last.cell, game.last.result, game.last.shipId);
  viewer = game.mode === 'solo' ? 0 : game.turn;
  if (game.mode === 'duo' && game.cover) {
    blankBattle();
    showCover();
    return;
  }
  beginTurn();
  if (fresh) {
    sfx.play('ping');
    callout('Battle stations', 'info', targetBoard.grid, 1300);
  }
}

function beginTurn() {
  viewer = game.mode === 'solo' ? 0 : game.turn;
  underFire = false;
  paintBattle();
  const extraShot = game.hitAndGoAgain && game.last?.by === viewer;
  const prompt = extraShot ? 'Fire again' : 'Choose a square to fire on';
  if (game.mode === 'solo') {
    if (game.turn === 0) setTurn('you', 'Your turn', prompt);
    else aiTurn();
  } else {
    setTurn(viewer === 0 ? 'you' : 'p2', `Player ${viewer + 1}`, prompt);
  }
}

async function aiTurn() {
  const myGen = gen;
  busy = true;
  underFire = true;
  setTurn('enemy', 'Enemy turn', 'Incoming fire…');
  await wait(timing().think);
  if (myGen !== gen || !game || game.phase !== 'battle' || game.turn !== 1) return;
  const cell = chooseShot(game.difficulty, publicView(game.boards[0]));
  busy = false;
  await resolveShot(cell);
}

function playerFire(i, cellEl) {
  sfx.unlock();
  if (!canFire() || !Number.isInteger(i)) return;
  if (game.boards[1 - game.turn].shots[i] !== UNKNOWN) {
    cellEl.classList.remove('nope');
    void cellEl.offsetWidth;
    cellEl.classList.add('nope');
    sfx.play('error');
    return;
  }
  resolveShot(i);
}

async function resolveShot(i) {
  if (busy) return;
  const myGen = gen;
  const res = takeShot(game, i);
  if (!res.ok) return;
  busy = true;
  // State is final and saved before any animation plays, so closing the app
  // mid-shot can never lose or duplicate a move.
  if (game.phase === 'over') recordResult();
  persist();
  logShot(res.by, i, res.result, res.ship && res.ship.id);
  refreshLive();

  const t = timing();
  const incoming = res.by !== viewer;
  const ui = incoming ? ownBoard : targetBoard;
  const aim = ui.cellCenter(i);
  sfx.play('fire');
  if (!incoming) haptic('tap');
  fx.aim(aim.x, aim.y, ui.cellSize(), t.aim / SPEED);
  await wait(t.aim);
  if (myGen !== gen) return;

  const freshOn = incoming ? 'own' : 'target';
  paintBattle({ fresh: i, freshShip: res.result === 'sunk' ? res.ship.id : null, freshOn });
  const to = ui.cellCenter(i);
  const scale = clamp(ui.cellSize() / 58, 0.45, 1.25);
  if (res.result === 'miss') {
    fx.splash(to.x, to.y, scale);
    sfx.play('splash');
    haptic('miss');
    callout(incoming ? 'They missed' : 'Miss', 'miss', ui.grid, 900, incoming);
  } else if (res.result === 'hit') {
    fx.explosion(to.x, to.y, scale);
    sfx.play('hit');
    haptic('hit');
    shake(ui.host);
    callout(incoming ? `${shipName(res.ship.id)} hit` : 'Hit', 'hit', ui.grid, 900, incoming);
  } else {
    sfx.play('sunk');
    haptic('sunk');
    shake(ui.host, true);
    fx.explosion(to.x, to.y, scale * 1.1);
    shipCells(res.ship).filter((c) => c !== i).forEach((c, n) => {
      setTimeout(() => {
        if (myGen !== gen) return;
        const p = ui.cellCenter(c);
        fx.explosion(p.x, p.y, scale * 1.1);
      }, ((n + 1) * 110) / SPEED);
    });
    callout(incoming ? `${shipName(res.ship.id)} lost` : `${shipName(res.ship.id)} sunk`, 'sunk', ui.grid, 1500, incoming);
  }

  await wait(res.result === 'sunk' ? t.sunkHold : t.hold);
  if (myGen !== gen) return;
  busy = false;
  if (game.phase === 'over') return showResult();
  if (game.cover) return showCover();
  beginTurn();
}

// ───────── Pass-and-play handover ─────────
function showCover() {
  covered = true;
  refreshLive();
  const placing = game.phase === 'placement';
  const p = placing ? game.placing : game.turn;
  $('cover-card').dataset.p = p;
  $('cover-eyebrow').textContent = `Pass the ${DEVICE} to`;
  $('cover-who').textContent = `Player ${p + 1}`;
  $('cover-text').textContent = placing
    ? `Deploy your fleet in secret. Player ${2 - p}, look away.`
    : `Your turn to fire. Player ${2 - p}, look away.`;
  const last = game.last;
  const lastEl = $('cover-last');
  if (!placing && last && last.by !== p) {
    const what = last.result === 'miss' ? 'MISS' : last.result === 'hit' ? 'HIT' : `${shipName(last.shipId).toUpperCase()} SUNK`;
    lastEl.textContent = `Player ${last.by + 1} fired at ${cellName(last.cell)} — ${what}`;
    lastEl.hidden = false;
  } else {
    lastEl.hidden = true;
  }
  const btn = $('cover-ready');
  btn.textContent = `I'm Player ${p + 1} — ${placing ? 'deploy' : 'ready'}`;
  // Brief lock-out so the previous player's last tap can't dismiss the cover.
  btn.disabled = true;
  const myGen = gen;
  setTimeout(() => { if (myGen === gen && covered) btn.disabled = false; }, 650 / SPEED);
  $('cover').hidden = false;
}

$('cover-ready').addEventListener('click', () => {
  if (!covered || !game) return;
  sfx.unlock();
  covered = false;
  game.cover = false;
  persist();
  // Draw the new player's view first, then lift the cover.
  if (game.phase === 'battle') beginTurn(); else renderPlacement();
  $('cover').hidden = true;
  sfx.play('ping');
});

// ───────── Result ─────────
function recordResult() {
  if (game.recorded) return;
  game.recorded = true;
  lastBests = { shots: false, time: false };
  if (game.mode === 'solo') {
    const st = playerStats(game, 0);
    lastBests = recordSolo(stats, { difficulty: game.difficulty, won: game.winner === 0, shots: st.shots, hits: st.hits, ms: game.elapsedMs });
  } else {
    stats.duo.played++;
  }
  saveStats(stats);
}

const statTile = (value, label, best = false) => `<div class="stat${best ? ' best' : ''}"><b>${value}</b><span>${label}</span></div>`;

async function showResult() {
  const myGen = gen;
  const solo = game.mode === 'solo';
  const won = game.winner === 0;
  viewer = solo ? 0 : game.winner;
  underFire = false;
  paintBattle();
  setTurn(solo && !won ? 'enemy' : 'you', solo ? (won ? 'Victory' : 'Defeat') : `Player ${game.winner + 1} wins`, 'Tap for results');
  await wait(timing().result);
  if (myGen !== gen) return;

  const card = $('result-card');
  card.dataset.outcome = solo && !won ? 'lose' : 'win';
  $('verdict').textContent = solo ? (won ? 'Victory' : 'Defeat') : `Player ${game.winner + 1} wins`;
  const time = fmtTime(game.elapsedMs);
  if (solo) {
    const me = playerStats(game, 0);
    const foe = playerStats(game, 1);
    $('result-sub').textContent = won
      ? `Enemy fleet destroyed on ${LEVEL_INFO[game.difficulty].name}.`
      : `Your fleet was lost on ${LEVEL_INFO[game.difficulty].name}. ${5 - me.sunk} enemy ship${5 - me.sunk === 1 ? '' : 's'} survived.`;
    $('result-badges').innerHTML = [lastBests.shots && 'New best · fewest shots', lastBests.time && 'New best · fastest win']
      .filter(Boolean).map((b) => `<span class="badge">${b}</span> `).join('');
    $('result-stats').innerHTML = `<div class="stats">
      ${statTile(pct(me.accuracy), 'Accuracy')}${statTile(me.shots, 'Shots', lastBests.shots)}${statTile(me.hits, 'Hits')}
      ${statTile(time, 'Time', lastBests.time)}${statTile(`${me.lost}/5`, 'Ships lost')}${statTile(pct(foe.accuracy), 'Enemy acc.')}</div>`;
  } else {
    $('result-sub').textContent = `Battle time ${time}.`;
    $('result-badges').innerHTML = '';
    $('result-stats').innerHTML = `<div class="versus">${[0, 1].map((p) => {
      const s = playerStats(game, p);
      return `<div><h3>Player ${p + 1}${p === game.winner ? ' ★' : ''}</h3><div class="stats">
        ${statTile(pct(s.accuracy), 'Accuracy')}${statTile(s.shots, 'Shots')}${statTile(s.hits, 'Hits')}${statTile(`${s.sunk}/5`, 'Sunk')}</div></div>`;
    }).join('')}</div>`;
  }
  $('result').hidden = false;
  if (solo && !won) { sfx.play('lose'); }
  else { sfx.play('win'); haptic('win'); fx.fireworks(); }
}

$('btn-rematch').addEventListener('click', () => { sfx.play('click'); startGame(game); });
$('btn-review').addEventListener('click', () => { sfx.play('click'); $('result').hidden = true; });
$('btn-result-menu').addEventListener('click', () => { sfx.play('click'); quitToMenu(); });
$('turn').addEventListener('click', () => {
  if (game && game.phase === 'over' && screen === 'battle' && !busy) $('result').hidden = false;
});

// ───────── Sheets ─────────
function openSheet(title, html) {
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = html;
  $('sheet-body').scrollTop = 0;
  $('sheet').hidden = false;
  sheetOpen = true;
  refreshLive();
  return $('sheet-body');
}
function closeSheet() {
  $('sheet').hidden = true;
  sheetOpen = false;
  refreshLive();
}
$('sheet-close').addEventListener('click', () => { sfx.play('click'); closeSheet(); });
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) closeSheet(); });

let confirmResolve = null;
function confirmDialog({ title, text, yes = 'OK', no = 'Cancel', danger = false }) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-yes').textContent = yes;
  $('confirm-no').textContent = no;
  $('confirm-yes').classList.toggle('danger', danger);
  $('confirm-yes').classList.toggle('primary', !danger);
  $('confirm').hidden = false;
  if (confirmResolve) confirmResolve(false);
  return new Promise((resolve) => { confirmResolve = resolve; });
}
function settleConfirm(value) {
  $('confirm').hidden = true;
  const r = confirmResolve;
  confirmResolve = null;
  if (r) r(value);
}
$('confirm-yes').addEventListener('click', () => { sfx.play('click'); settleConfirm(true); });
$('confirm-no').addEventListener('click', () => { sfx.play('click'); settleConfirm(false); });

function levelCards(selected) {
  return `<div class="levels">${LEVELS.map((lv, n) => `
    <button type="button" class="level" data-level="${lv}" aria-pressed="${lv === selected}">
      <span class="pips">${[0, 1, 2].map((k) => `<i class="${k <= n ? 'on' : ''}"></i>`).join('')}</span>
      <b>${LEVEL_INFO[lv].name}</b><span>${LEVEL_INFO[lv].blurb}</span>
    </button>`).join('')}</div>`;
}

function openSetup(mode) {
  const solo = mode === 'solo';
  const ruleSwitch = (id, title, description) => `<div class="row">
    <div class="lbl"><b>${title}</b><span>${description}</span></div>
    <button type="button" id="${id}" class="switch" role="switch" aria-checked="false" aria-label="${title}"></button></div>`;
  const body = openSheet(solo ? 'Solo mission' : 'Pass & play', `
    ${solo ? levelCards(settings.difficulty) : ''}
    ${ruleSwitch('hit-and-go-again', 'Hit and go again', 'Hit or sink a ship to fire again. A miss ends your turn.')}
    ${ruleSwitch('keep-ships-apart', 'Keep ships apart', 'Leave a one-square gap between ships, including at corners.')}
    <div class="card-actions"><button class="btn primary" id="setup-go">Deploy fleet</button></div>`);
  body.querySelectorAll('.level').forEach((b) => b.addEventListener('click', () => {
    settings.difficulty = b.dataset.level;
    saveSettings(settings);
    sfx.play('toggle');
    body.querySelectorAll('.level').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  const enabled = (button) => button.getAttribute('aria-checked') === 'true';
  body.querySelectorAll('.switch').forEach((button) => button.addEventListener('click', () => {
    button.setAttribute('aria-checked', !enabled(button));
    sfx.play('toggle');
  }));
  body.querySelector('#setup-go').addEventListener('click', () => {
    sfx.play('click');
    startGame({
      mode,
      difficulty: settings.difficulty,
      hitAndGoAgain: enabled(body.querySelector('#hit-and-go-again')),
      keepShipsApart: enabled(body.querySelector('#keep-ships-apart')),
    });
  });
}

function openSettings() {
  const sw = (key, on, title, sub) => `<div class="row"><div class="lbl"><b>${title}</b><span>${sub}</span></div>
    <button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${title}" data-key="${key}"></button></div>`;
  const seg = (key, value, options) => `<div class="seg" data-key="${key}">${options.map(([v, label]) =>
    `<button type="button" data-value="${v}" aria-pressed="${v === value}">${label}</button>`).join('')}</div>`;
  const body = openSheet('Settings', `
    ${sw('sound', settings.sound, 'Sound effects', 'Guns, splashes and sonar')}
    ${sw('haptics', settings.haptics, 'Haptics', 'Vibration feedback, where the device supports it')}
    ${sw('reducedMotion', reduced(), 'Reduce motion', 'Skip targeting pulses, shake and particles')}
    <div class="row col"><div class="lbl"><b>Difficulty</b><span>For your next solo mission</span></div>
      ${seg('difficulty', settings.difficulty, LEVELS.map((l) => [l, LEVEL_INFO[l].name]))}</div>
    <div class="row col"><div class="lbl"><b>Appearance</b><span>Night watch, day chart, or follow the ${DEVICE}</span></div>
      ${seg('theme', settings.theme, [['auto', 'Auto'], ['dark', 'Night'], ['light', 'Day']])}</div>
    <p class="meta">Ironwake ${VERSION} · plays fully offline</p>`);
  body.querySelectorAll('.switch').forEach((b) => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', on);
    settings[b.dataset.key] = on;
    saveSettings(settings);
    applySettings();
    sfx.play('toggle');
    haptic('tap');
  }));
  body.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    const key = b.parentElement.dataset.key;
    settings[key] = b.dataset.value;
    saveSettings(settings);
    applySettings();
    sfx.play('toggle');
    b.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
}

function openStats() {
  const all = LEVELS.map((l) => stats.solo[l]);
  const played = all.reduce((n, t) => n + t.played, 0);
  const won = all.reduce((n, t) => n + t.won, 0);
  const rows = LEVELS.map((l) => {
    const t = stats.solo[l];
    return `<tr><td>${LEVEL_INFO[l].name}</td><td>${t.played}</td><td>${t.won}</td><td>${t.bestShots ?? '–'}</td>
      <td>${t.bestMs ? fmtTime(t.bestMs) : '–'}</td><td>${t.shots ? pct(t.hits / t.shots) : '–'}</td></tr>`;
  }).join('');
  const body = openSheet('Service record', `
    <div class="stats">
      ${statTile(played, 'Solo battles')}${statTile(won, 'Victories')}${statTile(played ? pct(won / played) : '–', 'Win rate')}
      ${statTile(stats.streak, 'Win streak')}${statTile(stats.bestStreak, 'Best streak')}${statTile(stats.duo.played, 'Pass & play')}
    </div>
    <table class="rec"><thead><tr><th>Level</th><th>Played</th><th>Won</th><th>Best</th><th>Fastest</th><th>Accuracy</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="card-actions"><button class="btn danger" id="stats-reset"${played || stats.duo.played ? '' : ' disabled'}>Reset record</button></div>`);
  body.querySelector('#stats-reset').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Reset your record?', text: 'All saved statistics will be erased. This cannot be undone.', yes: 'Reset', danger: true });
    if (!ok) return;
    stats = blankStats();
    saveStats(stats);
    openStats();
  });
}

function openHelp() {
  const sw = (cls) => `<div class="swatch"><i class="cell ${cls}" style="position:absolute;inset:0"></i></div>`;
  openSheet('How to play', `<div class="help">
    <h3>Deploy</h3>
    <p>Each side hides five ships on a 10 × 10 grid: Carrier (5), Dreadnought (4), Cruiser (3), Submarine (3) and Corvette (2). Drag a ship on to the grid, tap it to rotate, or let Auto-place do it. Ships may touch in classic play. With Keep ships apart enabled, leave a one-square gap between ships, including at corners.</p>
    <h3>Engage</h3>
    <p>Tap any square you haven't tried. In classic play, you take one shot per turn. With Hit and go again enabled, a hit or sinking earns another shot and a miss passes the turn.</p>
    <div class="legend">
      ${sw('miss')}<span><b>Miss</b> — open water.</span>
      ${sw('hit')}<span><b>Hit</b> — part of a ship is burning. Keep firing nearby.</span>
      ${sw('hit sunk')}<span><b>Sunk</b> — every square of that ship was hit; its wreck is revealed.</span>
    </div>
    <h3>Win</h3>
    <p>Sink all five enemy ships before yours go down. The fleet panel shows what's still afloat.</p>
    <h3>Pass &amp; play</h3>
    <p>Two players share one ${DEVICE}. When the turn passes, a handover screen hides both fleets until the next player says they're ready.</p>
    <h3>Opponents</h3>
    <p><b>Easy</b> fires at random. <b>Normal</b> hunts, then follows up its hits. <b>Hard</b> works out the odds of a ship on every square from the ships still afloat.</p>
  </div>`);
}

function openPause() {
  if (game && game.phase === 'over') { $('result').hidden = false; return; }
  const body = openSheet('Paused', `
    <p>Your battle is saved automatically — you can close the app and pick it up later.</p>
    <div class="card-actions">
      <button class="btn primary" data-act="resume">Resume</button>
      <button class="btn" data-act="help">How to play</button>
      <button class="btn" data-act="settings">Settings</button>
      <button class="btn" data-act="quit">Save &amp; exit to menu</button>
    </div>`);
  const acts = { resume: closeSheet, help: openHelp, settings: openSettings, quit: quitToMenu };
  body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { sfx.play('click'); acts[b.dataset.act](); }));
}

// ───────── Wiring ─────────
document.querySelectorAll('[data-emblem]').forEach((el) => { el.innerHTML = EMBLEM; });
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] + el.innerHTML; });
$('duo-detail').textContent = `Two players, one ${DEVICE}`;
$('foot').textContent = `v${VERSION}`;

$('btn-resume').addEventListener('click', resumeGame);
$('btn-solo').addEventListener('click', () => requestNewGame('solo'));
$('btn-duo').addEventListener('click', () => requestNewGame('duo'));
$('btn-stats').addEventListener('click', () => { sfx.play('click'); openStats(); });
$('btn-help').addEventListener('click', () => { sfx.play('click'); openHelp(); });
$('btn-settings').addEventListener('click', () => { sfx.play('click'); openSettings(); });
$('battle-menu').addEventListener('click', () => { sfx.play('click'); openPause(); });

// Audio can only start from a gesture; keep trying in case iOS suspended it.
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });
window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.key !== 'Escape') return;
  if (!$('confirm').hidden) settleConfirm(false);
  else if (sheetOpen) closeSheet();
});

// Keep it feeling like an app: no zoom, no callouts, no rubber-banding.
for (const type of ['gesturestart', 'gesturechange', 'dblclick', 'contextmenu', 'dragstart', 'selectstart']) {
  document.addEventListener(type, (e) => e.preventDefault());
}
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 || !e.target.closest('.scroll')) e.preventDefault();
}, { passive: false });

// Battle clock: runs only while a battle is actually on screen.
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = now - lastTick;
  lastTick = now;
  if (screen === 'battle' && game && game.phase === 'battle' && !covered && !sheetOpen && !document.hidden) {
    game.elapsedMs += Math.min(dt, 1000);
    $('ro-time').textContent = fmtTime(game.elapsedMs);
  }
}, 250);

function onHide() { if (game) persist(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else lastTick = performance.now(); });
window.addEventListener('pagehide', onHide);

// Offline support + updates. Skipped on localhost so development never serves stale files
// (add ?sw=1 to test it locally).
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!local || params.has('sw'))) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install: nothing to refresh
    const reload = () => { reloading = true; persist(); location.reload(); };
    if (screen === 'title' && !sheetOpen) reload();
    else toast('Update installed — tap to reload', { action: reload });
  });
}

applySettings();
showTitle();

// Small inspection hook for automated play-testing.
window.__ironwake = {
  get game() { return game; },
  get state() { return { screen, viewer, busy, covered, sheetOpen, gen }; },
  get stats() { return stats; },
};
