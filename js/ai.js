// Ironwake — computer opponent. Stateless: every shot is worked out from the
// public view of the board, so a resumed game needs no saved AI memory and the
// AI can never know more than a human opponent would.

import { SIZE, CELLS, UNKNOWN, MISS, rowOf, colOf, idx } from './engine.js';

export const LEVELS = ['easy', 'normal', 'hard'];

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

function openCells(view) {
  const open = [];
  for (let i = 0; i < CELLS; i++) if (view.shots[i] === UNKNOWN) open.push(i);
  return open;
}

function sunkCellSet(view) {
  const set = new Set();
  for (const s of view.sunk) for (const c of s.cells) set.add(c);
  return set;
}

/** Hits that belong to ships still afloat — the ones worth following up. */
export function liveHits(view) {
  const sunk = sunkCellSet(view);
  const hits = [];
  for (let i = 0; i < CELLS; i++) {
    if (view.shots[i] !== UNKNOWN && view.shots[i] !== MISS && !sunk.has(i)) hits.push(i);
  }
  return hits;
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function step(i, dr, dc) {
  const r = rowOf(i) + dr;
  const c = colOf(i) + dc;
  return r < 0 || c < 0 || r >= SIZE || c >= SIZE ? -1 : idx(r, c);
}

// Normal: hunt on a checkerboard, then chase a hit — extending a line of hits
// first, otherwise probing the neighbours.
function normalShot(view, open, rng) {
  const hits = liveHits(view);
  if (hits.length) {
    const hitSet = new Set(hits);
    let best = [];
    let bestScore = 0;
    for (const h of hits) {
      for (const [dr, dc] of DIRS) {
        const n = step(h, dr, dc);
        if (n < 0 || view.shots[n] !== UNKNOWN) continue;
        const behind = step(h, -dr, -dc);
        const score = behind >= 0 && hitSet.has(behind) ? 2 : 1;
        if (score > bestScore) { bestScore = score; best = [n]; }
        else if (score === bestScore) best.push(n);
      }
    }
    if (best.length) return pick(best, rng);
  }
  const parity = open.filter((i) => (rowOf(i) + colOf(i)) % 2 === 0);
  return pick(parity.length ? parity : open, rng);
}

/**
 * Hard: for every ship still afloat, count each position it could legally
 * occupy given what's known. Squares covered by the most positions are the
 * likeliest to hold a ship. With a live hit on the board, only positions
 * running through it count, weighted up for each extra hit they explain.
 */
export function density(view, targeting = true) {
  const weights = new Float64Array(CELLS);
  const sunk = sunkCellSet(view);
  const live = new Set(liveHits(view));
  const chase = targeting && live.size > 0;
  const blocked = (i) => view.shots[i] === MISS || sunk.has(i);

  for (const len of view.remaining) {
    for (const horiz of [true, false]) {
      const maxR = horiz ? SIZE : SIZE - len + 1;
      const maxC = horiz ? SIZE - len + 1 : SIZE;
      for (let r = 0; r < maxR; r++) {
        for (let c = 0; c < maxC; c++) {
          let ok = true;
          let covered = 0;
          const cells = [];
          for (let k = 0; k < len; k++) {
            const i = idx(r + (horiz ? 0 : k), c + (horiz ? k : 0));
            if (blocked(i)) { ok = false; break; }
            if (live.has(i)) covered++;
            cells.push(i);
          }
          if (!ok) continue;
          if (chase && covered === 0) continue;
          const w = chase ? Math.pow(12, covered - 1) : 1;
          for (const i of cells) if (view.shots[i] === UNKNOWN) weights[i] += w;
        }
      }
    }
  }
  return weights;
}

function hardShot(view, open, rng) {
  for (const targeting of [true, false]) {
    const w = density(view, targeting);
    let max = 0;
    for (const i of open) if (w[i] > max) max = w[i];
    if (max > 0) return pick(open.filter((i) => w[i] >= max * 0.999999), rng);
  }
  return pick(open, rng);
}

/** Returns the cell to fire at, or -1 if the board has no unshot cells. */
export function chooseShot(level, view, rng = Math.random) {
  const open = openCells(view);
  if (!open.length) return -1;
  let shot;
  if (level === 'hard') shot = hardShot(view, open, rng);
  else if (level === 'normal') shot = normalShot(view, open, rng);
  else shot = pick(open, rng);
  // Belt and braces: whatever a strategy returns, never fire at a used square.
  if (!Number.isInteger(shot) || view.shots[shot] !== UNKNOWN) shot = pick(open, rng);
  return shot;
}
