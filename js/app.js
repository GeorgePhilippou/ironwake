// Ironwake — app controller: screens, input, animation sequencing, persistence.

import {
  FLEET, CELLS, UNKNOWN, MISS, HIT, cellName, shipName, shipCells, isSunk,
  validatePlacement, isFleetComplete, randomFleet, randomSpot, rotatedPlacement,
  createBoard, publicView, afloat, shipAt,
} from './engine.js';
import { chooseShot, LEVELS } from './ai.js';
import { newGame, commitFleet, takeShot, playerStats } from './game.js';
import {
  loadSettings, saveSettings, loadStats, saveStats, blankStats, recordSolo,
  loadGame, saveGame, clearGame,
} from './storage.js';
import { shipSVG, EMBLEM, RN_EMBLEM, ICONS, unionJack, sideFlag, sideEnsign } from './art.js';
import {
  setContext, historical, era as ctxEra, mySide, theirSide, myArt, theirArt, sideInfo, ERAS, ERA_IDS,
  t as say, ownShip, ownType, enemyShip,
} from './skins.js';
import { Sfx } from './audio.js';
import { Fx } from './fx.js';
import { VERSION } from './version.js';
import {
  PROTOCOL, newOnlineGame, newRoomCode, cleanRoomCode, gameFromHello, hello, commitOnline,
  fireOnline, canFireOnline, receive, requestRematch,
} from './online.js';
import { openLink, supportsOnline } from './net.js';

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
let link = null; // connection to the other iPad (online mode)
let netStatus = 'off';
let joining = null; // { room, since } while a guest looks for a host and has no game yet
let chain = Promise.resolve(); // online: shot animations play one after another
let onSheetClose = null;
let lastNetStatus = 'off';
const online = () => !!game && game.mode === 'online';

if (game && game.phase === 'over') { game = null; clearGame(); }
if (game && game.mode === 'duo') game.cover = true; // never reopen straight on to someone's fleet

const sfx = new Sfx();
const screenFx = new Fx($('fx'));

const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const mqLight = window.matchMedia('(prefers-color-scheme: light)');
const reduced = () => (settings.reducedMotion === null ? mqMotion.matches : settings.reducedMotion);
const isLight = () => (settings.theme === 'auto' ? mqLight.matches : settings.theme === 'light');
const timing = () => (reduced()
  ? { aim: 120, hold: 800, sunkHold: 1600, think: 380, result: 500 }
  : { aim: 280, hold: 950, sunkHold: 1900, think: 720, result: 900 });

let skinDrawn = false;
function applySettings() {
  const root = document.documentElement;
  if (settings.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = settings.theme;
  root.dataset.motion = reduced() ? 'reduced' : 'full';
  sfx.enabled = settings.sound;
  for (const fx of [screenFx, targetBoard.fx, ownBoard.fx]) {
    fx.reduced = reduced();
    fx.light = isLight();
  }
  const changed = !skinDrawn || themeKey !== `${settings.skin}.${settings.era}.${settings.side}`;
  skinDrawn = true;
  themeKey = `${settings.skin}.${settings.era}.${settings.side}`;
  root.dataset.skin = settings.skin;
  syncContext();
  if (changed) applySkin();
}

/**
 * Point the theme at whoever is looking at the screen: their battle and their
 * navy. Without a game (title screen) it follows the choice in Settings.
 */
function syncContext() {
  let era = settings.era;
  let mine = settings.side;
  let theirs = null;
  if (game && screen !== 'title') {
    era = game.era;
    const p = game.mode === 'duo' ? (screen === 'place' ? game.placing : viewer) : 0;
    mine = game.sides[p];
    theirs = game.sides[1 - p];
  }
  setContext({ skin: settings.skin, era, mine, theirs });
  const root = document.documentElement;
  const hist = historical();
  root.dataset.era = hist ? ctxEra() : '';
  root.dataset.side = hist ? mySide() : '';
  sfx.skin = hist ? `h${ctxEra()}` : 'sonar';
  const light = isLight();
  const colours = { 1805: ['#e6d6b0', '#1d140c'], 1940: ['#e9dfc4', '#0b1626'], 1982: ['#dfe2e1', '#101614'] };
  $('theme-color').setAttribute('content', hist ? colours[ctxEra()][light ? 0 : 1] : light ? '#e4dfd0' : '#04090d');
  // Words and flags that live in the page itself.
  const key = `${settings.skin}|${ctxEra()}|${mySide()}|${theirSide()}`;
  if (key === lastContextKey) return;
  lastContextKey = key;
  document.querySelectorAll('[data-emblem]').forEach((el) => { el.innerHTML = hist ? RN_EMBLEM : EMBLEM; });
  $('title-flag').innerHTML = hist ? sideFlag(mySide(), 'xMidYMid slice', 'flag-svg') : '';
  $('own-ensign').innerHTML = hist ? sideEnsign(mySide()) : '';
  $('enemy-ensign').innerHTML = hist ? sideEnsign(theirSide()) : '';
  $('tagline').textContent = say('tagline');
  $('btn-deploy').textContent = say('deployButton');
  $('own-title').textContent = say('yourFleet');
  $('enemy-title').textContent = say('enemyFleet');
  if (screen === 'place') $('place-title').textContent = say('deployTitle');
  const sk = $('btn-skin');
  sk.innerHTML = hist ? ICONS.sonar : unionJack('xMidYMid meet', 'mini-flag');
  sk.setAttribute('aria-label', hist ? 'Switch to the sonar theme' : 'Switch to the historical theme');
  sk.title = hist ? 'Sonar theme' : 'Historical theme';
  for (const b of [placeBoard, targetBoard, ownBoard]) b && b.resetShips();
}
let lastContextKey = '';
let themeKey = '';

/** Redraw what is on screen after the theme changes. */
function applySkin() {
  lastContextKey = '';
  syncContext();
  if (!game) return;
  if (screen === 'place') renderPlacement();
  else if (screen === 'battle' && !covered && !busy) {
    if (game.phase === 'battle') beginTurn(); else paintBattle();
  }
}
mqMotion.addEventListener('change', applySettings);
mqLight.addEventListener('change', applySettings);

function persist() {
  // A game whose opponent has left is kept on screen but not saved for resuming.
  if (game && game.phase !== 'over' && !(game.net && game.net.gone)) saveGame(game); else clearGame();
}

function bumpGen() {
  gen++;
  busy = false;
  underFire = false;
  chain = Promise.resolve();
  screenFx.clear();
  for (const board of [targetBoard, ownBoard]) {
    board.fx.clear();
    board.callout.className = 'callout';
  }
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
    else if (GESTURE_HAPTICS.has(kind)) {
      $('hx-label').click();
      $('hx-switch').blur(); // never leave focus on it: Safari may scroll to a focused control
    }
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

function callout(text, kind, board, dur = 1100, small = false) {
  const el = board.callout;
  el.className = `callout ${kind}${small || text.length > 18 ? ' small' : ''}`;
  el.textContent = text;
  // Long enough to read: at least 1.2 s plus a little per letter, so longer messages stay longer.
  const readable = Math.min(2400, Math.max(dur, 900 + text.length * 30));
  el.style.setProperty('--dur', `${readable / SPEED}ms`);
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
}

function flashImpact(el, big = false) {
  if (reduced()) return;
  el.classList.remove('impact', 'big');
  void el.offsetWidth;
  el.classList.add('impact');
  if (big) el.classList.add('big');
}

const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const pct = (x) => `${Math.round(x * 100)}%`;

// ───────── Board component ─────────
function shipHTML(s, cls = '', art = myArt()) {
  return `<div class="ship ${cls}" data-id="${s.id}" style="left:${s.c * 10}%;top:${s.r * 10}%;width:${(s.horiz ? s.len : 1) * 10}%;height:${(s.horiz ? 1 : s.len) * 10}%">${shipSVG(s.id, s.horiz, art)}</div>`;
}

const FX_BOARD_SIZE = 580;
const FX_CELL_SIZE = FX_BOARD_SIZE / 10;

function makeBoard(host, { buttons = false, onCell = null, effects = false } = {}) {
  const cols = Array.from({ length: 10 }, (_, i) => `<span>${i + 1}</span>`).join('');
  const rows = [...'ABCDEFGHIJ'].map((l) => `<span>${l}</span>`).join('');
  host.innerHTML = `<div class="labels cols" aria-hidden="true">${cols}</div><div class="labels rows" aria-hidden="true">${rows}</div>
    <div class="grid"><i class="sweep"></i><div class="ships"></div><div class="preview" hidden></div><div class="cells"></div></div>`;
  const grid = host.querySelector('.grid');
  if (effects) {
    grid.insertAdjacentHTML('beforeend',
      '<canvas class="board-fx" aria-hidden="true"></canvas><div class="callout" aria-hidden="true"></div>');
  }
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
    fx: effects ? new Fx(grid.querySelector('.board-fx'), FX_BOARD_SIZE) : null,
    callout: grid.querySelector('.callout'),
    /** ships: 'all' shows every ship; 'sunk' shows wrecks only; reveal adds the survivors as outlines. */
    paint(board, { ships = 'all', last = -1, fresh = -1, freshShip = null, reveal = false, art = myArt() } = {}) {
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
      const key = art + '|' + list.map(({ s, cls }) => `${s.id}.${s.r}.${s.c}.${s.horiz ? 1 : 0}.${cls}`).join('|');
      if (key !== shipKey) {
        shipKey = key;
        shipsEl.innerHTML = list.map(({ s, cls }) => shipHTML(s, cls, art)).join('');
        if (freshShip) {
          const el = shipsEl.querySelector(`[data-id="${freshShip}"]`);
          if (el) el.classList.add('fresh');
        }
      }
    },
    resetShips() { shipKey = null; },
    cellSize() { return grid.getBoundingClientRect().width / 10; },
  };
}

const placeBoard = makeBoard($('place-board'));
const targetBoard = makeBoard($('target-board'), { buttons: true, onCell: playerFire, effects: true });
const ownBoard = makeBoard($('own-board'), { effects: true });

// ───────── Screens ─────────
function showScreen(name) {
  screen = name;
  for (const id of ['title', 'place', 'battle']) $(id).hidden = id !== name;
  const scroller = $(name).querySelector('.stage') || $(name);
  scroller.scrollTop = 0;
}

function showTitle() {
  showScreen('title');
  syncContext();
  const live = game && game.phase !== 'over';
  $('btn-resume').hidden = !live;
  $('btn-solo').classList.toggle('primary', !live);
  if (live) {
    const mode = game.mode === 'solo' ? `Solo · ${LEVEL_INFO[game.difficulty].name}`
      : game.mode === 'online' ? `Two iPads · Room ${game.net.room}` : 'Pass & play';
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
  if (mode === 'online') openOnline(); else openSetup(mode);
}

function startGame(options) {
  dropLink(true);
  joining = null;
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
  if (online()) connect();
  if (game.phase === 'placement' && !(online() && game.net.ready)) enterPlacement(); else enterBattle();
}

function quitToMenu() {
  bumpGen();
  covered = false;
  joining = null;
  dropLink(!!game && game.phase === 'over');
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
  $('place-eyebrow').textContent = online() ? `Two iPads · ${game.net.role === 'host' ? 'Hosting' : 'Joined'} room ${game.net.room}`
    : duo ? `Pass & play · Player ${game.placing + 1}` : `Solo mission · ${LEVEL_INFO[game.difficulty].name}`;
  $('place-title').textContent = say('deployTitle');
  $('place-hint').textContent = game.keepShipsApart
    ? 'Leave a one-square gap between ships, including at corners. Tap to rotate.'
    : 'Drag to place · tap to rotate · drag off the grid to remove';
  renderPlacement();
  renderNet();
  if (duo && game.cover) showCover();
}

function renderPlacement(pop = null) {
  syncContext();
  const ships = draft();
  placeBoard.shipsEl.innerHTML = ships.map((s) => shipHTML(s, pop === 'all' || pop === s.id ? 'dropped' : '')).join('');
  $('tray').innerHTML = FLEET.map((spec) => {
    const placed = ships.some((s) => s.id === spec.id);
    return `<button type="button" class="tray-item${placed ? ' placed' : ''}" data-id="${spec.id}" style="--len:${spec.len}"${placed ? ' tabindex="-1"' : ''}>
      <span class="ship">${shipSVG(spec.id, true, myArt())}</span><span class="nm" title="${ownType(spec.id)}">${ownShip(spec.id)}</span><span class="ln">${placed ? 'ON GRID' : `${spec.len} CELLS`}</span></button>`;
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
    d.ghost.innerHTML = shipSVG(d.id, d.horiz, myArt());
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
    else if (v.reason === 'overlap') refusal = `That overlaps your ${ownShip(v.with)}.`;
    else if (v.reason === 'touching') refusal = `Leave a one-square gap around your ${ownShip(v.with)}.`;
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
new ResizeObserver(() => {
  if (drag) dragEnd(drag, true);
}).observe(placeBoard.grid);

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
  if (online()) {
    const r = commitOnline(game, draft());
    if (!r.ok) return toast('Place all five ships first.', { warn: true });
    persist();
    r.send.forEach(send);
    sfx.play('deploy');
    haptic('place');
    enterBattle(r.events.some((e) => e.type === 'battle'));
    return;
  }
  const res = commitFleet(game, game.placing, draft());
  if (!res.ok) return toast('Place all five ships first.', { warn: true });
  persist();
  sfx.play('deploy');
  haptic('place');
  if (game.phase === 'battle') enterBattle(true); else enterPlacement();
});
$('place-back').addEventListener('click', () => { sfx.play('click'); quitToMenu(); });

// ───────── Battle ─────────
const nameOf = (p) => (game.mode === 'solo' ? (p === 0 ? 'You' : 'Enemy') : game.mode === 'online' ? (p === 0 ? 'You' : 'Opponent') : `Player ${p + 1}`);

function canFire() {
  if (!(screen === 'battle' && game && game.phase === 'battle' && !busy && !covered && !sheetOpen)) return false;
  if (game.mode === 'online') return canFireOnline(game) && netStatus === 'connected';
  return game.mode === 'duo' || game.turn === 0;
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
      <span class="ship${sunk ? ' wreck' : ''}">${shipSVG(spec.id, true, theirArt())}</span><span class="nm">${enemyShip(spec.id)}</span><span class="st">${sunk ? say('sunk') : say('afloat')}</span></div>`;
  }).join('');
}

function paintBattle({ fresh = -1, freshShip = null, freshOn = null } = {}) {
  syncContext();
  const over = game.phase === 'over';
  const theirs = game.boards[1 - viewer];
  const mine = game.boards[viewer];
  const last = game.last;
  targetBoard.paint(theirs, {
    art: theirArt(),
    ships: 'sunk', reveal: over,
    last: last && last.by === viewer ? last.cell : -1,
    fresh: freshOn === 'target' ? fresh : -1,
    freshShip: freshOn === 'target' ? freshShip : null,
  });
  ownBoard.paint(mine, {
    art: myArt(),
    ships: 'all',
    last: last && last.by !== viewer ? last.cell : -1,
    fresh: freshOn === 'own' ? fresh : -1,
    freshShip: freshOn === 'own' ? freshShip : null,
  });
  $('enemy-fleet').innerHTML = fleetRows(theirs, freshOn === 'target' ? freshShip : null);
  const theirAfloat = online() && viewer === 0 ? FLEET.length - theirs.ships.filter((s) => isSunk(theirs, s)).length : afloat(theirs).length;
  $('enemy-count').innerHTML = `${theirAfloat} / ${FLEET.length}<span class="long"> afloat</span>`;
  $('own-count').innerHTML = `${afloat(mine).length} / ${FLEET.length}<span class="long"> afloat</span>`;
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
  const sunkName = shipId ? (by === viewer ? enemyShip(shipId) : ownShip(shipId)) : 'Ship';
  const what = result === 'miss' ? 'miss' : result === 'hit' ? '<span class="hit">hit</span>' : `<span class="hit">${sunkName} sunk</span>`;
  log.unshift(`<div><b>${nameOf(by)}</b> → ${cellName(cell)} · ${what}</div>`);
  log.length = Math.min(log.length, 4);
}

function enterBattle(fresh = false) {
  showScreen('battle');
  log = [];
  if (game.last) logShot(game.last.by, game.last.cell, game.last.result, game.last.shipId);
  viewer = game.mode === 'duo' ? game.turn : 0;
  renderNet();
  if (online() && game.phase === 'placement') {
    underFire = false;
    paintBattle();
    setTurn('p2', say('fleetDeployed'), 'Waiting for your opponent to deploy…');
    return;
  }
  if (game.mode === 'duo' && game.cover) {
    blankBattle();
    showCover();
    return;
  }
  beginTurn();
  if (fresh) {
    sfx.play('stations');
    callout(say('battleStations'), 'info', targetBoard, 1500);
  }
}

function beginTurn() {
  if (online()) return beginOnlineTurn();
  viewer = game.mode === 'solo' ? 0 : game.turn;
  underFire = false;
  paintBattle();
  const extraShot = game.hitAndGoAgain && game.last?.by === viewer;
  const prompt = extraShot ? say('fireAgain') : say('choose');
  if (game.mode === 'solo') {
    if (game.turn === 0) setTurn('you', say('yourTurn'), prompt);
    else aiTurn();
  } else {
    setTurn(viewer === 0 ? 'you' : 'p2', `Player ${viewer + 1}`, prompt);
  }
}

async function aiTurn() {
  const myGen = gen;
  busy = true;
  underFire = true;
  setTurn('enemy', say('enemyTurn'), say('incoming'));
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
  if (online()) return fireAtOpponent(i);
  resolveShot(i);
}

async function resolveShot(i) {
  if (busy) return;
  const res = takeShot(game, i);
  if (!res.ok) return;
  busy = true;
  // State is final and saved before any animation plays, so closing the app
  // mid-shot can never lose or duplicate a move.
  if (game.phase === 'over') recordResult();
  persist();
  logShot(res.by, i, res.result, res.ship && res.ship.id);
  refreshLive();
  if (!(await playShot(i, res.result, res.ship, res.by !== viewer, true))) return;
  busy = false;
  if (game.phase === 'over') return showResult();
  if (game.cover) return showCover();
  beginTurn();
}

function shotPoint(i) {
  return [(i % 10 + 0.5) * FX_CELL_SIZE, (Math.floor(i / 10) + 0.5) * FX_CELL_SIZE];
}

/** Animate one shot landing. Resolves false if the match was abandoned meanwhile. */
async function playShot(i, result, ship, incoming, withAim) {
  const myGen = gen;
  const t = timing();
  const ui = incoming ? ownBoard : targetBoard;
  const point = shotPoint(i);
  if (withAim) {
    sfx.play('fire');
    if (!incoming) haptic('tap');
    ui.fx.aim(...point, FX_CELL_SIZE, t.aim / SPEED);
    await wait(t.aim);
    if (myGen !== gen) return false;
  }
  const name = ship ? (incoming ? ownShip(ship.id) : enemyShip(ship.id)) : 'Ship';
  const freshOn = incoming ? 'own' : 'target';
  paintBattle({ fresh: i, freshShip: result === 'sunk' && ship ? ship.id : null, freshOn });
  if (result === 'miss') {
    ui.fx.splash(...point);
    sfx.play('splash');
    haptic('miss');
    callout(incoming ? say('theyMissed') : say('miss'), 'miss', ui, 1250, incoming);
  } else if (result === 'hit') {
    ui.fx.explosion(...point);
    sfx.play('hit');
    haptic('hit');
    flashImpact(ui.host);
    callout(incoming ? `${name} hit` : say('hit'), 'hit', ui, 1250, incoming);
  } else {
    sfx.play('sunk');
    haptic('sunk');
    flashImpact(ui.host, true);
    ui.fx.explosion(...point, 1.1);
    (ship ? shipCells(ship) : []).filter((c) => c !== i).forEach((c, n) => {
      setTimeout(() => {
        if (myGen === gen) ui.fx.explosion(...shotPoint(c), 1.1);
      }, ((n + 1) * 110) / SPEED);
    });
    callout(incoming ? `${name} lost` : `${name} sunk`, 'sunk', ui, 2000, incoming);
  }
  await wait(result === 'sunk' ? t.sunkHold : t.hold);
  return myGen === gen;
}

// ───────── Two iPads ─────────
function send(msg) { if (link) link.send(msg); }

function connect() {
  const role = online() ? game.net.role : 'guest';
  const room = online() ? game.net.room : joining && joining.room;
  if (!room) return;
  if (link && link.room === room && link.role === role) { link.poke(); return; }
  dropLink(false);
  const me = openLink({
    role,
    room,
    local: params.get('net') === 'local',
    onOpen: () => {
      if (link !== me) return;
      if (online()) {
        send(hello(game));
        if (game.net.rematch) send({ t: 'rematch', ...game.net.rematch });
      } else if (joining) {
        send({ t: 'hello', v: PROTOCOL, match: null });
      }
    },
    onMessage: (msg) => { if (link === me) onNet(msg); },
    onStatus: (status) => { if (link === me) { netStatus = status; renderNet(); } },
  });
  me.room = room;
  me.role = role;
  link = me;
  netStatus = 'connecting';
  renderNet();
}

function dropLink(farewell) {
  if (link) link.close(farewell ? { t: 'bye' } : null);
  link = null;
  netStatus = 'off';
  renderNet();
}

const NET_TEXT = {
  connecting: () => 'Connecting…',
  waiting: (room) => `Room <b>${room}</b><span class="long"> · waiting for the other iPad</span>`,
  searching: (room) => `Looking for room <b>${room}</b>`,
  connected: (room) => `Connected<span class="long"> · room ${room}</span>`,
  offline: () => 'No connection',
  unsupported: () => 'Not supported here',
  left: () => 'Opponent left',
  off: () => 'Not connected',
};

function renderNet() {
  const room = online() ? game.net.room : joining ? joining.room : '';
  const show = !!room && (online() || joining);
  const html = (NET_TEXT[netStatus] || NET_TEXT.off)(room);
  for (const id of ['place-net', 'battle-net']) {
    const el = $(id);
    el.hidden = !show;
    if (!show) continue;
    el.dataset.s = netStatus;
    const span = el.querySelector('span');
    if (span.innerHTML !== html) span.innerHTML = html;
  }
  const wait = $('net-wait');
  if (wait) {
    wait.querySelector('span').innerHTML = netStatus === 'connected' ? 'Connected!' : html;
    wait.querySelector('i').style.background = netStatus === 'connected' ? 'var(--accent)' : '';
  }
  if (screen === 'battle' && online() && !busy) refreshOnlineTurn();
  else refreshLive();
  // Host: the other iPad just arrived while the room card is up.
  const arrived = netStatus === 'connected' && lastNetStatus !== 'connected';
  lastNetStatus = netStatus;
  if (arrived && sheetOpen && $('room-card')) {
    const myGen = gen;
    setTimeout(() => { if (myGen === gen && $('room-card')) closeSheet(); }, 900 / SPEED);
  }
}

function onNet(msg) {
  if (!msg || typeof msg.t !== 'string') return;
  // Guest: the host tells us which match we're in.
  if (msg.t === 'hello' && link && link.role === 'guest' && typeof msg.match === 'string' && msg.match
      && (!online() || (game.net.match !== msg.match && msg.prev !== game.net.match && game.net.prev !== msg.match))) {
    if (msg.v !== PROTOCOL) return versionMismatch();
    return adoptHostGame(msg);
  }
  if (!online()) return;
  const out = receive(game, msg);
  persist();
  out.send.forEach(send);
  for (const e of out.events) onNetEvent(e);
}

function adoptHostGame(msg) {
  const fresh = gameFromHello(msg, link.room);
  if (!fresh) return;
  const wasOnline = online();
  bumpGen();
  joining = null;
  game = fresh;
  log = [];
  persist();
  send(hello(game));
  onSheetClose = null;
  closeSheet();
  $('result').hidden = true;
  sfx.play('ping');
  toast(wasOnline ? 'The host started a new game' : `Joined room ${game.net.room}`);
  enterPlacement();
}

function queue(fn) {
  const myGen = gen;
  chain = chain.then(() => (myGen === gen ? fn() : null)).catch((e) => console.error(e));
}

function onNetEvent(e) {
  switch (e.type) {
    case 'their-ready':
      if (game.phase === 'placement' && !game.net.ready) toast('Your opponent has deployed their fleet');
      break;
    case 'battle':
      queue(() => {
        if (screen !== 'battle') return;
        beginTurn();
        sfx.play('stations');
        callout(say('battleStations'), 'info', targetBoard, 1500);
      });
      break;
    case 'incoming':
    case 'outgoing':
      queue(() => animateOnline(e));
      break;
    case 'reveal':
      queue(() => { if (screen === 'battle') paintBattle(); });
      break;
    case 'offer':
      renderRematch();
      sfx.play('ping');
      break;
    case 'start':
      beginRematch(e);
      break;
    case 'left':
      opponentLeft();
      break;
    case 'desync':
      outOfStep();
      break;
    case 'version':
      versionMismatch();
      break;
    default:
      break;
  }
}

function fireAtOpponent(i) {
  const r = fireOnline(game, i);
  if (!r.ok) return;
  persist();
  r.send.forEach(send);
  sfx.play('fire');
  haptic('tap');
  targetBoard.fx.aim(...shotPoint(i), FX_CELL_SIZE, timing().aim / SPEED);
  refreshOnlineTurn();
}

async function animateOnline(e) {
  busy = true;
  refreshLive();
  const incoming = e.type === 'incoming';
  logShot(incoming ? 1 : 0, e.cell, e.result, e.ship && e.ship.id);
  if (e.over) recordResult();
  const ship = e.ship || (incoming ? shipAt(game.boards[0], e.cell) : null);
  if (!(await playShot(e.cell, e.result, ship, incoming, incoming))) return;
  busy = false;
  if (game.phase === 'over') return showResult();
  beginTurn();
}

function beginOnlineTurn() {
  viewer = 0;
  paintBattle();
  refreshOnlineTurn();
}

function refreshOnlineTurn() {
  if (!online() || game.phase !== 'battle') { refreshLive(); return; }
  const linked = netStatus === 'connected';
  const away = netStatus === 'left' ? 'Your opponent left this game' : 'Reconnecting to the other iPad…';
  underFire = game.turn === 1;
  if (game.turn === 0) {
    const extra = game.hitAndGoAgain && game.last && game.last.by === 0;
    if (game.net.pending !== null) setTurn('you', 'Firing…', linked ? `${cellName(game.net.pending)} — waiting for the result` : away);
    else setTurn('you', say('yourTurn'), linked ? (extra ? say('fireAgain') : say('choose')) : away);
  } else {
    setTurn('enemy', say('theirTurn'), linked ? 'Waiting for their shot…' : away);
  }
}

function beginRematch({ match, first }) {
  const old = game;
  bumpGen();
  $('result').hidden = true;
  closeSheet();
  game = newOnlineGame({
    role: old.net.role,
    room: old.net.room,
    match,
    first,
    prev: old.net.match,
    hitAndGoAgain: old.hitAndGoAgain,
    keepShipsApart: old.keepShipsApart,
    era: old.era,
    hostSide: old.net.hostSide,
  });
  log = [];
  persist();
  send(hello(game));
  enterPlacement();
  toast(first === game.net.role ? 'Rematch! You fire first this time.' : 'Rematch! They fire first this time.');
}

function renderRematch() {
  if (!online()) return;
  const btn = $('btn-rematch');
  const { net } = game;
  const gone = netStatus === 'left';
  btn.disabled = gone || (!!net.rematch && !net.offer);
  btn.textContent = gone ? 'Opponent left' : net.offer ? 'Accept rematch' : net.rematch ? 'Waiting for opponent…' : 'Rematch';
  $('result-badges').innerHTML = net.offer && !gone ? '<p class="offer">Your opponent wants a rematch</p>' : '';
}

async function opponentLeft() {
  dropLink(false); // they left on purpose: stop redialling
  game.net.gone = true;
  persist();
  netStatus = 'left';
  renderNet();
  if (game.phase === 'over') { renderRematch(); toast('Your opponent left'); return; }
  const back = await confirmDialog({ title: 'Your opponent left', text: 'They ended this game on their iPad.', yes: 'Back to menu', no: 'Stay here' });
  if (back) leaveOnline(false);
}

async function outOfStep() {
  const back = await confirmDialog({
    title: 'Game out of step',
    text: 'The other iPad no longer has this game. Go back to the menu and start a new one together.',
    yes: 'Back to menu',
    no: 'Stay here',
  });
  if (back) leaveOnline(true);
}

function versionMismatch() {
  toast('The two iPads have different versions of Ironwake. Open it on both while online to update, then try again.', { warn: true, ms: 6000 });
}

function leaveOnline(farewell) {
  bumpGen();
  dropLink(farewell);
  joining = null;
  game = null;
  clearGame();
  closeSheet();
  $('result').hidden = true;
  showTitle();
}

function openOnline() {
  if (!supportsOnline()) {
    openSheet('Two iPads', '<p>This browser cannot make direct connections. Open Ironwake in Safari on each iPad.</p>');
    return;
  }
  const body = openSheet('Two iPads', `
    <p>Play against someone on another iPad. Both iPads should be on the same Wi-Fi. One of you hosts and the other joins with the room code.</p>
    <div class="choice" style="margin-top:16px">
      <button class="btn primary stack" id="on-host">Host a game<small>Get a room code to share</small></button>
      <button class="btn stack" id="on-join">Join a game<small>Enter the code from the other iPad</small></button>
    </div>`);
  body.querySelector('#on-host').addEventListener('click', () => { sfx.play('click'); openHostSetup(); });
  body.querySelector('#on-join').addEventListener('click', () => { sfx.play('click'); openJoin(); });
}

function openHostSetup() {
  const ruleSwitch = (id, title, description) => `<div class="row">
    <div class="lbl"><b>${title}</b><span>${description}</span></div>
    <button type="button" id="${id}" class="switch" role="switch" aria-checked="false" aria-label="${title}"></button></div>`;
  const body = openSheet('Host a game', `
    ${battlePicker('You command — the other iPad gets the other side')}
    ${ruleSwitch('hit-and-go-again', 'Hit and go again', 'Hit or sink a ship to fire again. A miss ends your turn.')}
    ${ruleSwitch('keep-ships-apart', 'Keep ships apart', 'Leave a one-square gap between ships, including at corners.')}
    <p style="margin-top:12px">The battle and rules you choose apply to both iPads. You fire first.</p>`,
    '<button class="btn primary" id="host-go">Create room</button>', true);
  bindBattlePicker(body);
  const enabled = (b) => b.getAttribute('aria-checked') === 'true';
  body.querySelectorAll('.switch').forEach((b) => b.addEventListener('click', () => {
    b.setAttribute('aria-checked', !enabled(b));
    sfx.play('toggle');
  }));
  $('host-go').addEventListener('click', () => {
    sfx.play('click');
    startHost({
      hitAndGoAgain: enabled(body.querySelector('#hit-and-go-again')),
      keepShipsApart: enabled(body.querySelector('#keep-ships-apart')),
      era: settings.era,
      hostSide: settings.side,
    });
  });
}

function startHost(rules) {
  dropLink(true);
  joining = null;
  bumpGen();
  covered = false;
  log = [];
  $('result').hidden = true;
  $('cover').hidden = true;
  game = newOnlineGame({ role: 'host', room: newRoomCode(), ...rules });
  persist();
  connect();
  enterPlacement();
  openRoomCard();
}

function openRoomCard() {
  if (!online()) return;
  const room = game.net.room;
  const host = game.net.role === 'host';
  const body = openSheet(host ? 'Your room' : `Room ${room}`, `<div id="room-card">
    ${host ? '<p>On the other iPad, open Ironwake, choose <b>Two iPads → Join a game</b> and enter:</p>' : '<p>You joined this room.</p>'}
    <div class="room-code" aria-label="Room code ${room.split('').join(' ')}">${[...room].map((ch) => `<b>${ch}</b>`).join('')}</div>
    <div class="wait-line" id="net-wait"><i></i><span></span></div>
    <p style="margin-top:12px;font-size:14px">You can deploy your fleet while you wait. Both iPads need to be on the same Wi-Fi.</p>
    <div class="card-actions"><button class="btn primary" id="room-ok">${host ? 'Start deploying' : 'OK'}</button></div></div>`);
  body.querySelector('#room-ok').addEventListener('click', () => { sfx.play('click'); closeSheet(); });
  renderNet();
}

function openJoin(prefill = '') {
  const body = openSheet('Join a game', `
    <p>Enter the four-letter room code shown on the other iPad.</p>
    <input class="code-input" id="join-code" maxlength="6" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" inputmode="text" enterkeyhint="go" aria-label="Room code" value="${prefill}">
    <p id="join-error" style="color:var(--red);min-height:1.4em;font-size:14px"></p>
    <div class="card-actions"><button class="btn primary" id="join-go">Join</button></div>`);
  const input = body.querySelector('#join-code');
  const go = () => {
    const code = cleanRoomCode(input.value);
    if (!code) {
      body.querySelector('#join-error').textContent = 'Room codes are four letters, like KXRT.';
      sfx.play('error');
      return;
    }
    input.blur();
    sfx.play('click');
    startJoin(code);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  input.addEventListener('input', () => { body.querySelector('#join-error').textContent = ''; });
  body.querySelector('#join-go').addEventListener('click', go);
  setTimeout(() => { if (input.isConnected && sheetOpen) input.focus(); }, 60);
}

function startJoin(code) {
  if (online() && game.net.room === code && game.net.role === 'guest') {
    closeSheet();
    resumeGame();
    return;
  }
  dropLink(online());
  bumpGen();
  game = null;
  clearGame();
  log = [];
  joining = { room: code, since: Date.now() };
  connect();
  const body = openSheet(`Joining ${code}`, `
    <div class="wait-line" id="net-wait"><i></i><span></span></div>
    <p style="margin-top:14px">Make sure the other iPad has created room <b>${code}</b> and is showing it, and that both iPads are on the same Wi-Fi.</p>
    <div class="card-actions two">
      <button class="btn" id="join-cancel">Cancel</button>
      <button class="btn" id="join-edit">Change code</button>
    </div>`);
  onSheetClose = () => { if (joining) { joining = null; dropLink(false); showTitle(); } };
  body.querySelector('#join-cancel').addEventListener('click', () => { sfx.play('click'); closeSheet(); });
  body.querySelector('#join-edit').addEventListener('click', () => {
    sfx.play('click');
    onSheetClose = null;
    joining = null;
    dropLink(false);
    openJoin(code);
  });
  renderNet();
}

// ───────── Pass-and-play handover ─────────
function showCover() {
  covered = true;
  refreshLive();
  const placing = game.phase === 'placement';
  const p = placing ? game.placing : game.turn;
  $('cover-card').dataset.p = p;
  $('cover-eyebrow').textContent = say('passTo', DEVICE);
  $('cover-who').textContent = `Player ${p + 1}`;
  const coverSide = game.sides[p];
  $('cover-flag').innerHTML = settings.skin === 'history' ? sideFlag(coverSide) : '';
  $('cover-navy').textContent = settings.skin === 'history' ? sideInfo(coverSide, game.era).name : '';
  $('cover-text').textContent = placing
    ? `Deploy your fleet in secret. Player ${2 - p}, look away.`
    : `Your turn to fire. Player ${2 - p}, look away.`;
  const last = game.last;
  const lastEl = $('cover-last');
  if (!placing && last && last.by !== p) {
    const what = last.result === 'miss' ? 'MISS' : last.result === 'hit' ? 'HIT' : `${ownShip(last.shipId).toUpperCase()} SUNK`;
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
  } else if (game.mode === 'online') {
    stats.online.played++;
    if (game.winner === 0) stats.online.won++;
  } else {
    stats.duo.played++;
  }
  saveStats(stats);
}

const statTile = (value, label, best = false) => `<div class="stat${best ? ' best' : ''}"><b>${value}</b><span>${label}</span></div>`;

async function showResult() {
  const myGen = gen;
  const solo = game.mode === 'solo' || game.mode === 'online';
  const vsHuman = game.mode === 'online';
  const won = game.winner === 0;
  viewer = solo ? 0 : game.winner;
  underFire = false;
  paintBattle();
  setTurn(solo && !won ? 'enemy' : 'you', solo ? (won ? say('victory') : say('defeat')) : `Player ${game.winner + 1} wins`, 'Tap for results');
  await wait(timing().result);
  if (myGen !== gen) return;

  const card = $('result-card');
  card.dataset.outcome = solo && !won ? 'lose' : 'win';
  // The flag of the winner; after a defeat, your own colours, lowered.
  const flagSide = solo ? game.sides[0] : game.sides[game.winner];
  $('result-flag').innerHTML = settings.skin === 'history' ? sideFlag(flagSide) : '';
  $('verdict').textContent = solo ? (won ? say('victory') : say('defeat')) : `Player ${game.winner + 1} wins`;
  const time = fmtTime(game.elapsedMs);
  if (solo) {
    const me = playerStats(game, 0);
    const foe = playerStats(game, 1);
    const where = vsHuman ? '' : ` on ${LEVEL_INFO[game.difficulty].name}`;
    $('result-sub').textContent = won
      ? (vsHuman ? 'You sank their whole fleet.' : `Enemy fleet destroyed${where}.`)
      : `Your fleet was lost${where}. ${5 - me.sunk} ${vsHuman ? 'of their ships' : `enemy ship${5 - me.sunk === 1 ? '' : 's'}`} survived.`;
    $('result-badges').innerHTML = vsHuman ? '' : [lastBests.shots && 'New best · fewest shots', lastBests.time && 'New best · fastest win']
      .filter(Boolean).map((b) => `<span class="badge">${b}</span> `).join('');
    $('result-stats').innerHTML = `<div class="stats">
      ${statTile(pct(me.accuracy), 'Accuracy')}${statTile(me.shots, 'Shots', lastBests.shots)}${statTile(me.hits, 'Hits')}
      ${statTile(time, 'Time', !vsHuman && lastBests.time)}${statTile(`${me.lost}/5`, 'Ships lost')}${statTile(pct(foe.accuracy), vsHuman ? 'Their acc.' : 'Enemy acc.')}</div>`;
    if (vsHuman) renderRematch(); else { $('btn-rematch').textContent = 'Rematch'; $('btn-rematch').disabled = false; }
  } else {
    $('btn-rematch').textContent = 'Rematch';
    $('btn-rematch').disabled = false;
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
  else { sfx.play('win'); haptic('win'); screenFx.fireworks(); }
}

$('btn-rematch').addEventListener('click', () => {
  sfx.play('click');
  if (!online()) { startGame({ ...game, side: game.sides[0] }); return; }
  const r = requestRematch(game);
  r.send.forEach(send);
  if (r.start) beginRematch(r.start); else renderRematch();
});
$('btn-review').addEventListener('click', () => { sfx.play('click'); $('result').hidden = true; });
$('btn-result-menu').addEventListener('click', () => { sfx.play('click'); quitToMenu(); });
$('turn').addEventListener('click', () => {
  if (game && game.phase === 'over' && screen === 'battle' && !busy) $('result').hidden = false;
});

// ───────── Sheets ─────────
/** `foot` is pinned below the scrolling body, so its button can never end up off screen. */
function openSheet(title, html, foot = '', wide = false) {
  if (sheetOpen && onSheetClose) { const hook = onSheetClose; onSheetClose = null; hook(); }
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = html;
  $('sheet-foot').innerHTML = foot;
  $('sheet-foot').hidden = !foot;
  $('sheet').firstElementChild.classList.toggle('wide', wide);
  $('sheet-body').scrollTop = 0;
  $('sheet').hidden = false;
  sheetOpen = true;
  refreshLive();
  return $('sheet-body');
}
function closeSheet() {
  const wasOpen = sheetOpen;
  $('sheet').hidden = true;
  sheetOpen = false;
  refreshLive();
  const hook = onSheetClose;
  onSheetClose = null;
  if (wasOpen && hook) hook();
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


// ───────── Historical battle and side ─────────
function battlePicker(commandLabel) {
  if (settings.skin !== 'history') return '';
  const eras = ERA_IDS.map((id) => `<button type="button" class="era-card" data-era="${id}" aria-pressed="${id === settings.era}">
      <b>${ERAS[id].title}</b><span class="yr">${ERAS[id].years}</span><span class="bl">${ERAS[id].blurb}</span></button>`).join('');
  return `<div class="row col"><div class="lbl"><b>Battle</b></div><div class="eras">${eras}</div></div>
    <div class="row col"><div class="lbl"><b>${commandLabel}</b></div><div class="sides" id="side-pick">${sideCards()}</div></div>`;
}
function sideCards() {
  return ERAS[settings.era].sides.map((side) => `<button type="button" class="side-card" data-side="${side}" aria-pressed="${side === settings.side}">
    <span class="sf">${sideFlag(side)}</span><b>${sideInfo(side, settings.era).name}</b></button>`).join('');
}
function bindBattlePicker(body) {
  const save = () => { saveSettings(settings); applySettings(); sfx.play('toggle'); };
  const bindSides = () => body.querySelectorAll('.side-card').forEach((b) => b.addEventListener('click', () => {
    settings.side = b.dataset.side;
    body.querySelectorAll('.side-card').forEach((x) => x.setAttribute('aria-pressed', x === b));
    save();
  }));
  body.querySelectorAll('.era-card').forEach((b) => b.addEventListener('click', () => {
    settings.era = b.dataset.era;
    if (!ERAS[settings.era].sides.includes(settings.side)) settings.side = ERAS[settings.era].sides[0];
    body.querySelectorAll('.era-card').forEach((x) => x.setAttribute('aria-pressed', x === b));
    body.querySelector('#side-pick').innerHTML = sideCards();
    bindSides();
    save();
  }));
  bindSides();
}

function openSetup(mode) {
  const solo = mode === 'solo';
  const ruleSwitch = (id, title, description) => `<div class="row">
    <div class="lbl"><b>${title}</b><span>${description}</span></div>
    <button type="button" id="${id}" class="switch" role="switch" aria-checked="false" aria-label="${title}"></button></div>`;
  const body = openSheet(solo ? 'Solo mission' : 'Pass & play', `
    ${battlePicker(solo ? 'You command' : 'Player 1 commands')}
    ${solo ? `<div class="row col"><div class="lbl"><b>Computer</b></div>${levelCards(settings.difficulty)}</div>` : ''}
    ${ruleSwitch('hit-and-go-again', 'Hit and go again', 'Hit or sink a ship to fire again. A miss ends your turn.')}
    ${ruleSwitch('keep-ships-apart', 'Keep ships apart', 'Leave a one-square gap between ships, including at corners.')}`,
    '<button class="btn primary" id="setup-go">Deploy fleet</button>', true);
  bindBattlePicker(body);
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
  $('setup-go').addEventListener('click', () => {
    sfx.play('click');
    startGame({
      mode,
      difficulty: settings.difficulty,
      hitAndGoAgain: enabled(body.querySelector('#hit-and-go-again')),
      keepShipsApart: enabled(body.querySelector('#keep-ships-apart')),
      era: settings.era,
      side: settings.side,
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
    <div class="row col"><div class="lbl"><b>Theme</b><span>The modern sonar console, or real naval battles: Trafalgar, the Second World War and the Falklands</span></div>
      ${seg('skin', settings.skin, [['sonar', 'Sonar'], ['history', 'Historical']])}</div>
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
      ${statTile(stats.streak, 'Win streak')}${statTile(stats.bestStreak, 'Best streak')}${statTile(stats.duo.played, 'Pass & play')}${statTile(`${stats.online.won}/${stats.online.played}`, 'Two-iPad wins')}
    </div>
    <table class="rec"><thead><tr><th>Level</th><th>Played</th><th>Won</th><th>Best</th><th>Fastest</th><th>Accuracy</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="card-actions"><button class="btn danger" id="stats-reset"${played || stats.duo.played || stats.online.played ? '' : ' disabled'}>Reset record</button></div>`);
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
    <p>Each side hides five ships on a 10 × 10 grid: ${FLEET.map((f) => `${ownShip(f.id)} (${f.len})`).join(', ').replace(/, ([^,]*)$/, ' and $1')}. Drag a ship on to the grid, tap it to rotate, or let Auto-place do it. Ships may touch in classic play. With Keep ships apart enabled, leave a one-square gap between ships, including at corners.</p>
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
    <h3>Historical battles</h3>
    <p>Choose <b>Historical</b> in Settings → Theme, then pick a battle and a side when you start a game. Each navy fights with ships that served in that war:</p>
    <p><b>Trafalgar, 1805</b> — Royal Navy (HMS Victory, Temeraire, Euryalus, Naiad, Pickle) against the Marine Impériale (Bucentaure, Redoutable, Hermione, Hortense, Argus).<br>
    <b>Second World War</b> — Royal Navy (HMS Ark Royal, Warspite, Belfast, Upholder, Gladiolus) against the Kriegsmarine (Bismarck, Scharnhorst, Prinz Eugen, U-47, S-38).<br>
    <b>Falklands, 1982</b> — Royal Navy (HMS Hermes, Invincible, Sheffield, Conqueror, Ardent) against the Armada Argentina (ARA 25 de Mayo, General Belgrano, Hércules, Santa Fe, Guerrico).</p>
    <p>Solo, the computer takes the other side; in pass &amp; play, Player 2 does; on two iPads, the iPad that joins does. Bigger ships fill longer spaces on the grid; the rules are the same as ever.</p>
    <h3>Two iPads</h3>
    <p>Each player uses their own iPad on the same Wi-Fi. One chooses <b>Two iPads → Host a game</b> and reads out the four-letter room code; the other chooses <b>Join a game</b> and types it in. Your fleet never leaves your iPad until a ship is sunk. If an iPad goes to sleep, the game reconnects by itself when it wakes.</p>
    <h3>Opponents</h3>
    <p><b>Easy</b> fires at random. <b>Normal</b> hunts, then follows up its hits. <b>Hard</b> works out the odds of a ship on every square from the ships still afloat.</p>
  </div>`);
}

function openPause() {
  if (game && game.phase === 'over') { $('result').hidden = false; return; }
  const net = online();
  const body = openSheet(net ? 'Menu' : 'Paused', `
    <p>${net ? 'The game keeps going on the other iPad. It is saved here, so you can come back to it.' : 'Your battle is saved automatically — you can close the app and pick it up later.'}</p>
    <div class="card-actions">
      <button class="btn primary" data-act="resume">${net ? 'Back to the game' : 'Resume'}</button>
      ${net ? '<button class="btn" data-act="room">Room code</button>' : ''}
      <button class="btn" data-act="help">How to play</button>
      <button class="btn" data-act="settings">Settings</button>
      <button class="btn" data-act="quit">Save &amp; exit to menu</button>
      ${net ? '<button class="btn danger" data-act="leave">Leave this game</button>' : ''}
    </div>`);
  const leave = async () => {
    const ok = await confirmDialog({ title: 'Leave this game?', text: 'It ends for both of you, and your opponent is told you left.', yes: 'Leave', danger: true });
    if (ok) leaveOnline(true);
  };
  const acts = { resume: closeSheet, help: openHelp, settings: openSettings, quit: quitToMenu, room: openRoomCard, leave };
  body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { sfx.play('click'); acts[b.dataset.act](); }));
}

// ───────── Wiring ─────────
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] + el.innerHTML; });
$('duo-detail').textContent = `Two players, one ${DEVICE}`;
$('foot').textContent = `v${VERSION}`;

$('btn-resume').addEventListener('click', resumeGame);
$('btn-solo').addEventListener('click', () => requestNewGame('solo'));
$('btn-duo').addEventListener('click', () => requestNewGame('duo'));
$('btn-online').addEventListener('click', () => requestNewGame('online'));
for (const id of ['place-net', 'battle-net']) $(id).addEventListener('click', () => { sfx.play('click'); openRoomCard(); });
$('btn-stats').addEventListener('click', () => { sfx.play('click'); openStats(); });
$('btn-help').addEventListener('click', () => { sfx.play('click'); openHelp(); });
$('btn-settings').addEventListener('click', () => { sfx.play('click'); openSettings(); });
$('btn-skin').addEventListener('click', () => {
  settings.skin = settings.skin === 'history' ? 'sonar' : 'history';
  saveSettings(settings);
  applySettings();
  sfx.play('ping');
  haptic('tap');
  toast(settings.skin === 'history' ? `${sideInfo(settings.side, settings.era).name} · ${ERAS[settings.era].title}, ${ERAS[settings.era].years}` : 'Sonar console');
});
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

const viewport = window.visualViewport;
if (viewport) {
  const sheet = $('sheet');
  const fitKeyboard = () => {
    const typingCode = document.activeElement?.id === 'join-code';
    if (typingCode && Math.abs(viewport.scale - 1) < 0.01 && viewport.height < sheet.parentElement.clientHeight - 1) {
      sheet.style.setProperty('--keyboard-top', `${Math.max(0, viewport.offsetTop)}px`);
      sheet.style.setProperty('--keyboard-height', `${viewport.height}px`);
    } else {
      sheet.style.removeProperty('--keyboard-top');
      sheet.style.removeProperty('--keyboard-height');
    }
  };
  viewport.addEventListener('resize', fitKeyboard);
  viewport.addEventListener('scroll', fitKeyboard);
  sheet.addEventListener('focusout', () => requestAnimationFrame(fitKeyboard));
}

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
  get state() { return { screen, viewer, busy, covered, sheetOpen, gen, netStatus, joining: !!joining }; },
  get stats() { return stats; },
};
