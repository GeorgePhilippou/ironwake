// Ironwake — rules engine. Pure functions, no DOM, shared by the app and the tests.

export const SIZE = 10;
export const CELLS = SIZE * SIZE;

export const FLEET = [
  { id: 'carrier', name: 'Carrier', len: 5 },
  { id: 'dreadnought', name: 'Dreadnought', len: 4 },
  { id: 'cruiser', name: 'Cruiser', len: 3 },
  { id: 'submarine', name: 'Submarine', len: 3 },
  { id: 'corvette', name: 'Corvette', len: 2 },
];
export const FLEET_CELLS = FLEET.reduce((n, s) => n + s.len, 0);

export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2;

export const idx = (r, c) => r * SIZE + c;
export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;
export const cellName = (i) => 'ABCDEFGHIJ'[rowOf(i)] + (colOf(i) + 1);
export const shipName = (id) => (FLEET.find((s) => s.id === id) || { name: id }).name;

const isInt = Number.isInteger;

export function inBounds(ship) {
  if (!ship || !isInt(ship.r) || !isInt(ship.c) || !isInt(ship.len) || ship.len < 1) return false;
  const endR = ship.r + (ship.horiz ? 0 : ship.len - 1);
  const endC = ship.c + (ship.horiz ? ship.len - 1 : 0);
  return ship.r >= 0 && ship.c >= 0 && endR < SIZE && endC < SIZE;
}

/** Cell indexes a ship covers. Only meaningful for in-bounds ships. */
export function shipCells(ship) {
  const cells = [];
  for (let k = 0; k < ship.len; k++) {
    cells.push(idx(ship.r + (ship.horiz ? 0 : k), ship.c + (ship.horiz ? k : 0)));
  }
  return cells;
}

/**
 * Can `cand` sit on the grid alongside `ships`? A ship with the same id as the
 * candidate is ignored, so moving a ship never collides with its old position.
 * Ships may touch (classic rules); they may not overlap or leave the grid.
 */
export function validatePlacement(ships, cand) {
  if (!inBounds(cand)) return { ok: false, reason: 'bounds' };
  const mine = new Set(shipCells(cand));
  for (const other of ships) {
    if (other.id === cand.id) continue;
    for (const cell of shipCells(other)) {
      if (mine.has(cell)) return { ok: false, reason: 'overlap', with: other.id };
    }
  }
  return { ok: true };
}

/** True when `ships` is exactly the standard fleet, legally placed. */
export function isFleetComplete(ships) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return false;
  for (const spec of FLEET) {
    const matches = ships.filter((s) => s && s.id === spec.id);
    if (matches.length !== 1 || matches[0].len !== spec.len) return false;
  }
  return ships.every((s) => validatePlacement(ships, s).ok);
}

export function randomFleet(rng = Math.random) {
  for (;;) {
    const ships = [];
    let stuck = false;
    for (const spec of FLEET) {
      let placed = false;
      for (let attempt = 0; attempt < 400 && !placed; attempt++) {
        const horiz = rng() < 0.5;
        const r = Math.floor(rng() * (horiz ? SIZE : SIZE - spec.len + 1));
        const c = Math.floor(rng() * (horiz ? SIZE - spec.len + 1 : SIZE));
        const cand = { id: spec.id, len: spec.len, r, c, horiz };
        if (validatePlacement(ships, cand).ok) {
          ships.push(cand);
          placed = true;
        }
      }
      if (!placed) { stuck = true; break; }
    }
    if (!stuck) return ships;
  }
}

/** A random legal spot for one ship among already-placed `ships`, or null. */
export function randomSpot(ships, spec, rng = Math.random) {
  const options = [];
  for (const horiz of [true, false]) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cand = { id: spec.id, len: spec.len, r, c, horiz };
        if (validatePlacement(ships, cand).ok) options.push(cand);
      }
    }
  }
  return options.length ? options[Math.floor(rng() * options.length)] : null;
}

/**
 * Rotate a placed ship. Keeps the bow where it is when it can; otherwise slides
 * the ship the shortest distance that makes the turn legal (so a ship against
 * the edge still rotates). Returns the new placement, or null if nothing fits
 * within one ship-length of where it was.
 */
export function rotatedPlacement(ships, ship) {
  const horiz = !ship.horiz;
  const tries = [];
  for (let along = -(ship.len - 1); along <= ship.len - 1; along++) {
    for (let across = -(ship.len - 1); across <= ship.len - 1; across++) {
      tries.push({ along, across, cost: Math.abs(along) + Math.abs(across) * 1.01 + (along > 0 || across > 0 ? 0.001 : 0) });
    }
  }
  tries.sort((a, b) => a.cost - b.cost);
  for (const t of tries) {
    const cand = {
      id: ship.id,
      len: ship.len,
      horiz,
      r: ship.r + (horiz ? t.across : t.along),
      c: ship.c + (horiz ? t.along : t.across),
    };
    if (validatePlacement(ships, cand).ok) return cand;
  }
  return null;
}

export function createBoard(ships = []) {
  return {
    ships: ships.map((s) => ({ id: s.id, len: s.len, r: s.r, c: s.c, horiz: !!s.horiz })),
    shots: new Array(CELLS).fill(UNKNOWN),
  };
}

export function shipAt(board, i) {
  for (const ship of board.ships) {
    if (shipCells(ship).includes(i)) return ship;
  }
  return null;
}

export const shipHits = (board, ship) => shipCells(ship).filter((i) => board.shots[i] === HIT).length;
export const isSunk = (board, ship) => shipHits(board, ship) === ship.len;
export const allSunk = (board) => board.ships.length > 0 && board.ships.every((s) => isSunk(board, s));
export const afloat = (board) => board.ships.filter((s) => !isSunk(board, s));

/**
 * Fire at cell `i`. Mutates board.shots only when the shot is legal.
 * → { ok:false, reason:'invalid'|'repeat' }
 * → { ok:true, result:'miss'|'hit'|'sunk', cell, ship?, allSunk }
 */
export function fire(board, i) {
  if (!isInt(i) || i < 0 || i >= CELLS) return { ok: false, reason: 'invalid' };
  if (board.shots[i] !== UNKNOWN) return { ok: false, reason: 'repeat' };
  const ship = shipAt(board, i);
  if (!ship) {
    board.shots[i] = MISS;
    return { ok: true, result: 'miss', cell: i, ship: null, allSunk: false };
  }
  board.shots[i] = HIT;
  const sunk = isSunk(board, ship);
  return { ok: true, result: sunk ? 'sunk' : 'hit', cell: i, ship, allSunk: sunk && allSunk(board) };
}

export function countShots(board) {
  let shots = 0;
  let hits = 0;
  for (const s of board.shots) {
    if (s !== UNKNOWN) shots++;
    if (s === HIT) hits++;
  }
  return { shots, hits };
}

/** What an opponent is entitled to know: shot results, and ships already sunk. */
export function publicView(board) {
  const sunk = board.ships.filter((s) => isSunk(board, s));
  return {
    shots: board.shots.slice(),
    sunk: sunk.map((s) => ({ id: s.id, len: s.len, cells: shipCells(s) })),
    remaining: board.ships.filter((s) => !isSunk(board, s)).map((s) => s.len),
  };
}

/** Small seedable PRNG so tests and simulations are repeatable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
