import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, UNKNOWN, HIT, randomFleet, shipCells, publicView, mulberry32, isFleetComplete } from '../js/engine.js';
import { chooseShot } from '../js/ai.js';
import { newGame, commitFleet, takeShot, playerStats, reviveGame } from '../js/game.js';

const fleet = (seed) => randomFleet(mulberry32(seed));

function soloInBattle(seed = 1) {
  const g = newGame({ mode: 'solo', difficulty: 'hard' });
  assert.ok(commitFleet(g, 0, fleet(seed), mulberry32(seed + 1)).ok);
  return g;
}

test('solo: committing a fleet deploys the computer and starts with the player', () => {
  const g = soloInBattle();
  assert.equal(g.phase, 'battle');
  assert.equal(g.turn, 0);
  assert.ok(isFleetComplete(g.boards[1].ships));
  assert.equal(g.cover, false);
});

test('an incomplete or illegal fleet cannot be committed', () => {
  const g = newGame({ mode: 'solo' });
  assert.equal(commitFleet(g, 0, fleet(1).slice(0, 4)).ok, false);
  assert.equal(commitFleet(g, 1, fleet(1)).ok, false, 'not player 2\'s turn to place');
  assert.equal(g.phase, 'placement');
});

test('turns alternate after every legal shot, hit or miss', () => {
  const g = soloInBattle();
  const target = shipCells(g.boards[1].ships[0])[0];
  assert.equal(takeShot(g, target).result, 'hit');
  assert.equal(g.turn, 1);
  takeShot(g, 0);
  assert.equal(g.turn, 0);
});

test('hit and go again: hits and sinkings retain the turn, while a miss triggers handover', () => {
  const g = newGame({ mode: 'duo', hitAndGoAgain: true });
  commitFleet(g, 0, fleet(3));
  commitFleet(g, 1, fleet(4));
  g.cover = false;

  const target = g.boards[1];
  const occupied = target.ships.flatMap(shipCells);
  const [first, last] = shipCells(target.ships.find((ship) => ship.len === 2));
  assert.equal(takeShot(g, first).result, 'hit');
  assert.equal(g.turn, 0);
  assert.equal(g.cover, false);

  const resumed = reviveGame(JSON.stringify(g));
  assert.equal(resumed.hitAndGoAgain, true);
  assert.equal(takeShot(resumed, last).result, 'sunk');
  assert.equal(resumed.turn, 0);
  assert.equal(resumed.cover, false);

  const water = [...Array(CELLS).keys()].find((i) => !occupied.includes(i));
  assert.equal(takeShot(resumed, water).result, 'miss');
  assert.equal(resumed.turn, 1);
  assert.equal(resumed.cover, true);
});

test('saves created before hit and go again resume with classic rules', () => {
  const legacy = soloInBattle();
  delete legacy.hitAndGoAgain;
  const g = reviveGame(JSON.stringify(legacy));
  assert.equal(g.hitAndGoAgain, false);
  const cell = shipCells(g.boards[1].ships[0])[0];
  assert.equal(takeShot(g, cell).result, 'hit');
  assert.equal(g.turn, 1);
});

test('an illegal shot does not use up the turn', () => {
  const g = soloInBattle();
  takeShot(g, 5); // player
  takeShot(g, 5); // computer, on the other board
  assert.equal(g.turn, 0);
  const snapshot = JSON.stringify(g);
  assert.equal(takeShot(g, 5).reason, 'repeat');
  assert.equal(takeShot(g, 400).reason, 'invalid');
  assert.equal(JSON.stringify(g), snapshot);
});

test('shots are refused before battle and after the game ends', () => {
  const g = newGame({ mode: 'solo' });
  assert.equal(takeShot(g, 0).reason, 'phase');
  const done = soloInBattle();
  const targets = done.boards[1].ships.flatMap(shipCells);
  const mine = done.boards[0].ships.flatMap(shipCells);
  const misses = [...Array(CELLS).keys()].filter((i) => !mine.includes(i));
  targets.forEach((t, n) => {
    takeShot(done, t);
    if (done.phase === 'battle') takeShot(done, misses[n]);
  });
  assert.equal(done.phase, 'over');
  assert.equal(done.winner, 0);
  assert.equal(takeShot(done, 99).reason, 'phase');
  const s = playerStats(done, 0);
  assert.deepEqual([s.shots, s.hits, s.accuracy, s.sunk, s.lost], [17, 17, 1, 5, 0]);
  assert.equal(playerStats(done, 1).shots, 16);
});

test('the computer can win too, and the winner is recorded as player 2', () => {
  const g = soloInBattle(11);
  const rng = mulberry32(99);
  const enemy = g.boards[1].ships.flatMap(shipCells);
  const water = [...Array(CELLS).keys()].filter((i) => !enemy.includes(i));
  let n = 0;
  while (g.phase === 'battle') {
    if (g.turn === 0) takeShot(g, water[n++]);
    else takeShot(g, chooseShot('hard', publicView(g.boards[0]), rng));
  }
  assert.equal(g.winner, 1);
  assert.equal(playerStats(g, 0).lost, 5);
});

test('pass-and-play: both players place, and the screen is covered at every handover', () => {
  const g = newGame({ mode: 'duo' });
  assert.ok(commitFleet(g, 0, fleet(3)).ok);
  assert.equal(g.phase, 'placement');
  assert.equal(g.placing, 1);
  assert.equal(g.cover, true);
  g.cover = false;
  assert.ok(commitFleet(g, 1, fleet(4)).ok);
  assert.equal(g.phase, 'battle');
  assert.equal(g.turn, 0);
  assert.equal(g.cover, true);
  g.cover = false;
  takeShot(g, 0);
  assert.equal(g.turn, 1);
  assert.equal(g.cover, true, 'covered before player 2 sees anything');
});

test('pass-and-play: the winning shot uncovers the screen for the result', () => {
  const g = newGame({ mode: 'duo' });
  commitFleet(g, 0, fleet(3));
  commitFleet(g, 1, fleet(4));
  const p0targets = g.boards[1].ships.flatMap(shipCells);
  const p1water = [...Array(CELLS).keys()].filter((i) => !g.boards[0].ships.flatMap(shipCells).includes(i));
  for (let n = 0; g.phase === 'battle'; n++) {
    takeShot(g, p0targets[n]);
    if (g.phase === 'battle') takeShot(g, p1water[n]);
  }
  assert.equal(g.winner, 0);
  assert.equal(g.cover, false);
});

test('a rematch starts completely clean', () => {
  const first = soloInBattle(5);
  for (let i = 0; i < 20; i++) takeShot(first, first.turn === 0 ? i : 99 - i);
  const second = newGame({ mode: first.mode, difficulty: first.difficulty });
  assert.notEqual(second.id, first.id);
  assert.equal(second.phase, 'placement');
  assert.equal(second.last, null);
  assert.equal(second.elapsedMs, 0);
  assert.equal(second.winner, null);
  for (const b of second.boards) {
    assert.equal(b.ships.length, 0);
    assert.ok(b.shots.every((s) => s === UNKNOWN));
  }
  assert.notEqual(second.boards[0].shots, first.boards[0].shots, 'no shared arrays');
  takeShot(first, 50);
  assert.ok(second.boards.every((b) => b.shots.every((s) => s === UNKNOWN)));
});

test('save and resume: a game in progress restores exactly', () => {
  const g = soloInBattle(8);
  takeShot(g, 12);
  takeShot(g, 40);
  takeShot(g, shipCells(g.boards[1].ships[2])[1]);
  g.elapsedMs = 4321;
  const back = reviveGame(JSON.stringify(g));
  assert.deepEqual(back, g);
  // …and carries on correctly from there.
  assert.equal(back.turn, 1);
  assert.equal(takeShot(back, 40).reason, 'repeat');
});

test('save and resume: mid-placement drafts survive', () => {
  const g = newGame({ mode: 'duo' });
  g.draft = fleet(2).slice(0, 3);
  const back = reviveGame(JSON.stringify(g));
  assert.equal(back.draft.length, 3);
});

test('corrupt or tampered saves are thrown away, not half-loaded', () => {
  const good = JSON.stringify(soloInBattle(2));
  const broken = [
    '', 'null', '{', '[]', '{"v":0}',
    good.replace('"phase":"battle"', '"phase":"limbo"'),
    good.replace('"turn":0', '"turn":3'),
    good.replace('"mode":"solo"', '"mode":"online"'),
    good.replace('"difficulty":"hard"', '"difficulty":"godlike"'),
  ];
  for (const raw of broken) assert.equal(reviveGame(raw), null, raw.slice(0, 40));

  const noFleet = JSON.parse(good);
  noFleet.boards[1].ships.pop();
  assert.equal(reviveGame(noFleet), null);

  const shortShots = JSON.parse(good);
  shortShots.boards[0].shots.length = 50;
  assert.equal(reviveGame(shortShots), null);

  const lyingHit = JSON.parse(good);
  const water = [...Array(CELLS).keys()].find((i) => !lyingHit.boards[1].ships.flatMap(shipCells).includes(i));
  lyingHit.boards[1].shots[water] = HIT;
  assert.equal(reviveGame(lyingHit), null, 'a hit recorded on open water');

  const noWinner = JSON.parse(good);
  noWinner.phase = 'over';
  assert.equal(reviveGame(noWinner), null);
});
