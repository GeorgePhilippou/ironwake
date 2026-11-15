import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELLS, UNKNOWN, MISS, HIT, idx, createBoard, randomFleet, fire, publicView, mulberry32,
} from '../js/engine.js';
import { LEVELS, chooseShot, density, liveHits } from '../js/ai.js';

function playOut(level, seed) {
  const rng = mulberry32(seed);
  const board = createBoard(randomFleet(rng));
  const fired = new Set();
  for (let n = 1; n <= CELLS; n++) {
    const cell = chooseShot(level, publicView(board), rng);
    assert.ok(Number.isInteger(cell) && cell >= 0 && cell < CELLS, `${level} seed ${seed}: bad cell ${cell}`);
    assert.ok(!fired.has(cell), `${level} seed ${seed}: fired at ${cell} twice`);
    fired.add(cell);
    const res = fire(board, cell);
    assert.ok(res.ok);
    if (res.allSunk) return n;
  }
  assert.fail(`${level} seed ${seed}: did not finish in ${CELLS} shots`);
}

const averages = {};

for (const level of LEVELS) {
  test(`${level} AI never fires at the same square twice and always finishes`, () => {
    let total = 0;
    const games = 300;
    for (let seed = 1; seed <= games; seed++) total += playOut(level, seed * 7919);
    averages[level] = total / games;
  });
}

test('difficulty levels are genuinely ordered: hard < normal < easy shots to win', () => {
  assert.ok(averages.hard < averages.normal - 5, `hard ${averages.hard} vs normal ${averages.normal}`);
  assert.ok(averages.normal < averages.easy - 15, `normal ${averages.normal} vs easy ${averages.easy}`);
  assert.ok(averages.hard < 50, `hard averages ${averages.hard}`);
});

function viewWith(marks, sunk = [], remaining = [5, 4, 3, 3, 2]) {
  const shots = new Array(CELLS).fill(UNKNOWN);
  for (const [cell, v] of marks) shots[cell] = v;
  return { shots, sunk, remaining };
}

test('normal and hard follow up next to a fresh hit', () => {
  const hit = idx(4, 4);
  const neighbours = [idx(3, 4), idx(5, 4), idx(4, 3), idx(4, 5)];
  for (const level of ['normal', 'hard']) {
    for (let seed = 1; seed <= 50; seed++) {
      const shot = chooseShot(level, viewWith([[hit, HIT]]), mulberry32(seed));
      assert.ok(neighbours.includes(shot), `${level} fired at ${shot}`);
    }
  }
});

test('normal and hard extend a line of two hits', () => {
  const view = viewWith([[idx(4, 4), HIT], [idx(4, 5), HIT]]);
  const ends = [idx(4, 3), idx(4, 6)];
  for (const level of ['normal', 'hard']) {
    for (let seed = 1; seed <= 50; seed++) {
      assert.ok(ends.includes(chooseShot(level, view, mulberry32(seed))), level);
    }
  }
});

test('hits on sunk ships are not chased', () => {
  const sunk = [{ id: 'corvette', len: 2, cells: [0, 1] }];
  const view = viewWith([[0, HIT], [1, HIT]], sunk, [5, 4, 3, 3]);
  assert.deepEqual(liveHits(view), []);
  const w = density(view);
  assert.equal(w[0], 0);
  assert.equal(w[1], 0);
  assert.ok(w[idx(4, 4)] > w[idx(0, 2)], 'open centre beats a cramped corner');
});

test('hard only considers squares where a remaining ship can still fit', () => {
  // Only the carrier is left; a lone gap of 4 fenced by misses cannot hold it.
  const marks = [];
  for (let c = 0; c < 10; c++) marks.push([idx(1, c), MISS]);
  marks.push([idx(0, 4), MISS]);
  const view = viewWith(marks, [], [5]);
  const w = density(view);
  for (let c = 0; c < 4; c++) assert.equal(w[idx(0, c)], 0, `A${c + 1} cannot hold a carrier`);
  assert.ok(w[idx(0, 5)] > 0);
  for (let seed = 1; seed <= 30; seed++) {
    const shot = chooseShot('hard', view, mulberry32(seed));
    assert.ok(w[shot] > 0);
  }
});

test('every level copes with a nearly full or full board', () => {
  for (const level of LEVELS) {
    const shots = new Array(CELLS).fill(MISS);
    shots[57] = UNKNOWN;
    assert.equal(chooseShot(level, { shots, sunk: [], remaining: [2] }, mulberry32(1)), 57);
    shots[57] = MISS;
    assert.equal(chooseShot(level, { shots, sunk: [], remaining: [2] }, mulberry32(1)), -1);
  }
});

test('unknown level names fall back to a legal shot', () => {
  const shot = chooseShot('impossible', viewWith([[0, MISS]]), mulberry32(3));
  assert.ok(shot > 0 && shot < CELLS);
});
