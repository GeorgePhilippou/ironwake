// Ironwake — match state machine. Pure and JSON-serialisable so a game in
// progress can be saved after every move and restored exactly.

import {
  CELLS, FLEET, UNKNOWN, MISS, HIT,
  createBoard, isFleetComplete, randomFleet, fire, countShots, isSunk, inBounds,
} from './engine.js';
import { LEVELS } from './ai.js';

export const SAVE_VERSION = 1;

export function newGame({ mode = 'solo', difficulty = 'normal', hitAndGoAgain = false } = {}) {
  return {
    v: SAVE_VERSION,
    id: Math.random().toString(36).slice(2, 10),
    mode: mode === 'duo' ? 'duo' : 'solo',
    difficulty: LEVELS.includes(difficulty) ? difficulty : 'normal',
    hitAndGoAgain: hitAndGoAgain === true,
    phase: 'placement', // placement → battle → over
    placing: 0,
    turn: 0,
    winner: null,
    cover: false, // pass-and-play: screen must stay hidden until the next player confirms
    last: null, // most recent shot { by, cell, result, shipId }
    elapsedMs: 0,
    recorded: false, // result already written to lifetime stats
    draft: [], // ships placed so far by whoever is placing
    boards: [createBoard(), createBoard()],
  };
}

/**
 * Lock in a fleet for player `p`. Solo: the computer deploys and battle starts.
 * Duo: player 1 hands over to player 2, then battle starts with player 1.
 */
export function commitFleet(game, p, ships, rng = Math.random) {
  if (game.phase !== 'placement' || p !== game.placing) return { ok: false, reason: 'phase' };
  if (!isFleetComplete(ships)) return { ok: false, reason: 'incomplete' };
  game.boards[p] = createBoard(ships);
  game.draft = [];
  if (game.mode === 'solo') {
    game.boards[1] = createBoard(randomFleet(rng));
    game.phase = 'battle';
    game.turn = 0;
  } else if (p === 0) {
    game.placing = 1;
    game.cover = true;
  } else {
    game.phase = 'battle';
    game.turn = 0;
    game.cover = true;
  }
  return { ok: true };
}

/** The player whose turn it is fires at cell `i` of the other player's board. */
export function takeShot(game, i) {
  if (game.phase !== 'battle') return { ok: false, reason: 'phase' };
  const by = game.turn;
  const res = fire(game.boards[1 - by], i);
  if (!res.ok) return res;
  game.last = { by, cell: i, result: res.result, shipId: res.ship ? res.ship.id : null };
  if (res.allSunk) {
    game.phase = 'over';
    game.winner = by;
    game.cover = false;
  } else if (!game.hitAndGoAgain || res.result === 'miss') {
    game.turn = 1 - by;
    if (game.mode === 'duo') game.cover = true;
  }
  return { ...res, by, winner: game.winner };
}

export function playerStats(game, p) {
  const { shots, hits } = countShots(game.boards[1 - p]);
  const theirs = game.boards[1 - p];
  const mine = game.boards[p];
  return {
    shots,
    hits,
    accuracy: shots ? hits / shots : 0,
    sunk: theirs.ships.filter((s) => isSunk(theirs, s)).length,
    lost: mine.ships.filter((s) => isSunk(mine, s)).length,
  };
}

function validShips(ships, mustBeComplete) {
  if (!Array.isArray(ships)) return false;
  if (mustBeComplete) return isFleetComplete(ships);
  const seen = new Set();
  for (const s of ships) {
    const spec = s && FLEET.find((f) => f.id === s.id);
    if (!spec || spec.len !== s.len || seen.has(s.id) || !inBounds(s)) return false;
    seen.add(s.id);
  }
  return true;
}

/**
 * Check a save loaded from storage. Anything malformed, from an older format,
 * or internally inconsistent returns null rather than a half-working game.
 */
export function reviveGame(raw) {
  try {
    const g = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!g || g.v !== SAVE_VERSION) return null;
    if (!['solo', 'duo'].includes(g.mode) || !LEVELS.includes(g.difficulty)) return null;
    if (!['placement', 'battle', 'over'].includes(g.phase)) return null;
    if (![0, 1].includes(g.turn) || ![0, 1].includes(g.placing)) return null;
    if (!Array.isArray(g.boards) || g.boards.length !== 2) return null;
    const battle = g.phase !== 'placement';
    for (let p = 0; p < 2; p++) {
      const b = g.boards[p];
      if (!b || !Array.isArray(b.shots) || b.shots.length !== CELLS) return null;
      if (!b.shots.every((s) => s === UNKNOWN || s === MISS || s === HIT)) return null;
      const needFleet = battle || (g.mode === 'duo' && g.placing === 1 && p === 0);
      if (!validShips(b.ships, needFleet)) return null;
      if (!battle && b.shots.some((s) => s !== UNKNOWN)) return null;
      // Every recorded result must agree with where the ships actually are.
      if (battle) {
        const occupied = new Set();
        for (const s of b.ships) {
          for (let k = 0; k < s.len; k++) occupied.add((s.r + (s.horiz ? 0 : k)) * 10 + s.c + (s.horiz ? k : 0));
        }
        for (let i = 0; i < CELLS; i++) {
          if (b.shots[i] === HIT && !occupied.has(i)) return null;
          if (b.shots[i] === MISS && occupied.has(i)) return null;
        }
      }
    }
    if (g.hitAndGoAgain !== undefined && typeof g.hitAndGoAgain !== 'boolean') return null;
    g.hitAndGoAgain ??= false;
    if (!validShips(g.draft || [], false)) return null;
    if (g.phase === 'over' && ![0, 1].includes(g.winner)) return null;
    if (g.phase !== 'over') g.winner = null;
    g.draft = g.draft || [];
    g.elapsedMs = Number.isFinite(g.elapsedMs) && g.elapsedMs >= 0 ? g.elapsedMs : 0;
    g.cover = !!g.cover;
    g.recorded = !!g.recorded;
    if (g.last && !(Number.isInteger(g.last.cell) && g.last.cell >= 0 && g.last.cell < CELLS)) g.last = null;
    return g;
  } catch {
    return null;
  }
}
