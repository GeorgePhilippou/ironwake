import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZE, CELLS, FLEET, FLEET_CELLS, UNKNOWN, MISS, HIT, idx, cellName,
  validatePlacement, isFleetComplete, randomFleet, randomSpot, rotatedPlacement,
  createBoard, shipCells, fire, allSunk, isSunk, publicView, countShots, mulberry32,
} from '../js/engine.js';

const ship = (id, r, c, horiz) => ({ id, len: FLEET.find((f) => f.id === id).len, r, c, horiz });

// A fixed legal fleet used across tests.
const FIXED = [
  ship('carrier', 0, 0, true), // A1–A5
  ship('dreadnought', 2, 3, false), // C4–F4
  ship('cruiser', 9, 7, true), // J8–J10
  ship('submarine', 5, 9, false), // F10–H10
  ship('corvette', 7, 0, true), // H1–H2
];

test('fleet is the classic 5/4/3/3/2 on a 10×10 grid', () => {
  assert.equal(SIZE, 10);
  assert.deepEqual(FLEET.map((s) => s.len), [5, 4, 3, 3, 2]);
  assert.equal(FLEET_CELLS, 17);
  assert.equal(cellName(0), 'A1');
  assert.equal(cellName(99), 'J10');
});

test('placement: legal positions are accepted, including touching ships', () => {
  assert.ok(isFleetComplete(FIXED));
  const touching = [ship('carrier', 0, 0, true), ship('dreadnought', 1, 0, true)];
  assert.ok(validatePlacement(touching, touching[1]).ok);
});

test('placement: every edge rejects a ship that runs off the grid', () => {
  const off = [
    ship('carrier', 0, 6, true), // off the right
    ship('carrier', 6, 0, false), // off the bottom
    ship('corvette', -1, 0, true),
    ship('corvette', 0, -1, false),
    ship('corvette', 10, 0, true),
    ship('corvette', 0, 10, true),
  ];
  for (const s of off) assert.deepEqual(validatePlacement([], s), { ok: false, reason: 'bounds' });
  // Exactly fitting against each edge is fine.
  assert.ok(validatePlacement([], ship('carrier', 0, 5, true)).ok);
  assert.ok(validatePlacement([], ship('carrier', 5, 9, false)).ok);
});

test('placement: garbage coordinates are rejected', () => {
  for (const bad of [{ r: 1.5, c: 0 }, { r: NaN, c: 0 }, { r: '1', c: 0 }, { r: 0, c: undefined }]) {
    assert.equal(validatePlacement([], { id: 'cruiser', len: 3, horiz: true, ...bad }).ok, false);
  }
});

test('placement: overlap is rejected and names the ship in the way', () => {
  const placed = [ship('carrier', 4, 2, true)];
  const res = validatePlacement(placed, ship('cruiser', 3, 4, false));
  assert.deepEqual(res, { ok: false, reason: 'overlap', with: 'carrier' });
});

test('placement: moving a ship does not collide with its own old position', () => {
  const placed = [ship('carrier', 4, 2, true)];
  assert.ok(validatePlacement(placed, ship('carrier', 4, 3, true)).ok);
});

test('fleet completeness: missing, duplicated or wrong-length ships fail', () => {
  assert.equal(isFleetComplete(FIXED.slice(0, 4)), false);
  assert.equal(isFleetComplete([...FIXED.slice(0, 4), FIXED[0]]), false);
  const wrongLen = FIXED.map((s) => (s.id === 'corvette' ? { ...s, len: 3 } : s));
  assert.equal(isFleetComplete(wrongLen), false);
  const overlapping = FIXED.map((s) => (s.id === 'corvette' ? { ...s, r: 0, c: 0 } : s));
  assert.equal(isFleetComplete(overlapping), false);
  assert.equal(isFleetComplete(null), false);
});

test('auto-place always produces a complete legal fleet', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const fleet = randomFleet(mulberry32(seed));
    assert.ok(isFleetComplete(fleet), `seed ${seed}`);
    assert.equal(new Set(fleet.flatMap(shipCells)).size, FLEET_CELLS);
  }
});

test('randomSpot finds a legal place or reports none', () => {
  const rng = mulberry32(7);
  const placed = FIXED.slice(0, 4);
  const spot = randomSpot(placed, FLEET[4], rng);
  assert.ok(validatePlacement(placed, spot).ok);
  // Fill the board with misses-as-ships: a full wall leaves no room for a carrier.
  const wall = [];
  for (let r = 0; r < SIZE; r++) wall.push({ id: `w${r}`, len: 10, r, c: 0, horiz: true });
  assert.equal(randomSpot(wall, FLEET[0], rng), null);
});

test('rotation: ship in open water pivots on its bow', () => {
  const s = ship('cruiser', 4, 4, true);
  assert.deepEqual(rotatedPlacement([s], s), { id: 'cruiser', len: 3, r: 4, c: 4, horiz: false });
});

test('rotation at the grid edge slides the ship back on to the grid', () => {
  // Vertical carrier in the last column → horizontal must shift left.
  const right = ship('carrier', 0, 9, false);
  const a = rotatedPlacement([right], right);
  assert.ok(a && a.horiz === true && validatePlacement([], a).ok);
  assert.equal(a.c, 5);
  // Horizontal carrier on the bottom row → vertical must shift up.
  const bottom = ship('carrier', 9, 0, true);
  const b = rotatedPlacement([bottom], bottom);
  assert.ok(b && b.horiz === false && validatePlacement([], b).ok);
  assert.equal(b.r, 5);
  // Bottom-right corner, both orientations, every ship.
  for (const spec of FLEET) {
    for (const horiz of [true, false]) {
      const s = { id: spec.id, len: spec.len, horiz, r: horiz ? 9 : 10 - spec.len, c: horiz ? 10 - spec.len : 9 };
      assert.ok(validatePlacement([], s).ok);
      const rot = rotatedPlacement([s], s);
      assert.ok(rot && validatePlacement([], rot).ok, `${spec.id} ${horiz}`);
    }
  }
});

test('rotation never lands on another ship, and gives up when boxed in', () => {
  const s = ship('cruiser', 4, 4, true);
  const blocker = ship('carrier', 5, 2, true); // directly beneath
  const rot = rotatedPlacement([s, blocker], s);
  assert.ok(rot);
  assert.ok(validatePlacement([s, blocker], rot).ok);

  // A corvette walled in by full-width rows above and below cannot turn.
  const pinned = { id: 'corvette', len: 2, r: 5, c: 4, horiz: true };
  const walls = [3, 4, 6, 7].map((r) => ({ id: `w${r}`, len: 10, r, c: 0, horiz: true }));
  assert.equal(rotatedPlacement([pinned, ...walls], pinned), null);
});

test('fire: miss, hit and sunk are reported and recorded', () => {
  const b = createBoard(FIXED);
  assert.deepEqual(fire(b, idx(1, 0)), { ok: true, result: 'miss', cell: 10, ship: null, allSunk: false });
  assert.equal(b.shots[10], MISS);

  const h = fire(b, idx(7, 0));
  assert.equal(h.result, 'hit');
  assert.equal(h.ship.id, 'corvette');
  assert.equal(b.shots[70], HIT);
  assert.equal(isSunk(b, h.ship), false);

  const s = fire(b, idx(7, 1));
  assert.equal(s.result, 'sunk');
  assert.equal(s.ship.id, 'corvette');
  assert.equal(s.allSunk, false);
  assert.deepEqual(countShots(b), { shots: 3, hits: 2 });
});

test('fire: the same square twice, or a square off the grid, is refused and changes nothing', () => {
  const b = createBoard(FIXED);
  fire(b, 0);
  const before = b.shots.slice();
  assert.deepEqual(fire(b, 0), { ok: false, reason: 'repeat' });
  for (const bad of [-1, 100, 3.5, NaN, undefined, '4']) {
    assert.deepEqual(fire(b, bad), { ok: false, reason: 'invalid' });
  }
  assert.deepEqual(b.shots, before);
});

test('win condition: only the 17th hit ends the game', () => {
  const b = createBoard(FIXED);
  const targets = FIXED.flatMap(shipCells);
  assert.equal(targets.length, 17);
  targets.forEach((cell, n) => {
    assert.equal(allSunk(b), false);
    const res = fire(b, cell);
    assert.equal(res.allSunk, n === 16, `shot ${n + 1}`);
  });
  assert.equal(allSunk(b), true);
  assert.equal(allSunk(createBoard()), false, 'an empty board is not a defeated one');
});

test('sinking needs every cell of that ship, regardless of order', () => {
  const b = createBoard(FIXED);
  assert.equal(fire(b, 2).result, 'hit');
  assert.equal(fire(b, 4).result, 'hit');
  assert.equal(fire(b, 0).result, 'hit');
  assert.equal(fire(b, 3).result, 'hit');
  assert.equal(fire(b, 1).result, 'sunk');
});

test('public view exposes results and sunk ships only', () => {
  const b = createBoard(FIXED);
  fire(b, idx(7, 0));
  fire(b, idx(7, 1));
  fire(b, 0);
  const v = publicView(b);
  assert.deepEqual(v.sunk, [{ id: 'corvette', len: 2, cells: [70, 71] }]);
  assert.deepEqual(v.remaining.sort(), [3, 3, 4, 5]);
  assert.equal(JSON.stringify(v).includes('"r"'), false, 'no ship coordinates leak');
  v.shots[5] = HIT;
  assert.equal(b.shots[5], UNKNOWN, 'view is a copy');
  assert.equal(v.shots.length, CELLS);
});

test('a board survives a JSON round trip', () => {
  const b = createBoard(FIXED);
  fire(b, 0);
  fire(b, 50);
  const copy = JSON.parse(JSON.stringify(b));
  assert.deepEqual(copy, b);
  assert.equal(fire(copy, 0).reason, 'repeat');
  assert.equal(fire(copy, 1).result, 'hit');
});
