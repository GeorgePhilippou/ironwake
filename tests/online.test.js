import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CELLS, UNKNOWN, randomFleet, shipCells, publicView, mulberry32, isSunk } from '../js/engine.js';
import { chooseShot } from '../js/ai.js';
import {
  newOnlineGame, gameFromHello, hello, commitOnline, fireOnline, canFireOnline, receive,
  requestRematch, reviveOnline, cleanRoomCode, newRoomCode, PROTOCOL,
} from '../js/online.js';

/**
 * Two devices joined by an in-memory link. `rng` (optional) makes the link
 * lossy: messages can be dropped or delivered twice. `reconnect()` replays what
 * a real reconnection does — both sides say hello again.
 */
function link({ rules = {}, rng = null, dropRate = 0, dupRate = 0 } = {}) {
  const host = newOnlineGame({ role: 'host', room: 'ABCD', ...rules });
  const guest = gameFromHello(hello(host), 'ABCD');
  const devices = [host, guest];
  const queues = [[], []]; // queues[i]: messages waiting to reach device i
  const wire = []; // every message sent, for privacy checks: { to, msg, phase }
  const events = [[], []];
  const send = (from, msgs) => {
    for (const msg of msgs) {
      const to = 1 - from;
      wire.push({ to, msg: JSON.parse(JSON.stringify(msg)), senderPhase: devices[from].phase });
      if (rng && rng() < dropRate) continue;
      queues[to].push(JSON.parse(JSON.stringify(msg)));
      if (rng && rng() < dupRate) queues[to].push(JSON.parse(JSON.stringify(msg)));
    }
  };
  const flush = () => {
    for (let guard = 0; guard < 10000 && (queues[0].length || queues[1].length); guard++) {
      for (const i of [0, 1]) {
        const msg = queues[i].shift();
        if (!msg) continue;
        const out = receive(devices[i], msg);
        events[i].push(...out.events);
        send(i, out.send);
      }
    }
  };
  const reconnect = () => {
    queues[0].length = 0;
    queues[1].length = 0;
    send(0, [hello(host)]);
    send(1, [hello(guest)]);
    flush();
  };
  return { host, guest, devices, send, flush, reconnect, wire, events };
}

function deployBoth(l, seed = 1) {
  l.send(0, commitOnline(l.host, randomFleet(mulberry32(seed), l.host.keepShipsApart)).send);
  l.send(1, commitOnline(l.guest, randomFleet(mulberry32(seed + 1000), l.guest.keepShipsApart)).send);
  l.flush();
}

/** Play to the end; whoever's turn it is fires the hard AI's choice. */
function playOut(l, seed = 1, { reconnectEvery = 0 } = {}) {
  const rng = mulberry32(seed);
  for (let step = 0; step < 2000; step++) {
    if (l.host.phase === 'over' && l.guest.phase === 'over') return step;
    const i = l.devices.findIndex((g) => canFireOnline(g));
    if (i < 0 || (reconnectEvery && step % reconnectEvery === 0)) { l.reconnect(); continue; }
    const g = l.devices[i];
    const res = fireOnline(g, chooseShot('hard', publicView(g.boards[1]), rng));
    assert.ok(res.ok);
    l.send(i, res.send);
    l.flush();
  }
  assert.fail('game did not finish');
}

function assertMirrored(l) {
  assert.deepEqual(l.host.boards[1].shots, l.guest.boards[0].shots, 'host view of guest');
  assert.deepEqual(l.guest.boards[1].shots, l.host.boards[0].shots, 'guest view of host');
}

test('room codes are four easy-to-read letters, and typing is forgiving', () => {
  for (let s = 1; s < 200; s++) assert.match(newRoomCode(mulberry32(s)), /^[A-HJ-NP-Z]{4}$/);
  assert.equal(cleanRoomCode(' abcd '), 'ABCD');
  assert.equal(cleanRoomCode('ab-cd'), 'ABCD');
  assert.equal(cleanRoomCode('AB0D'), null);
  assert.equal(cleanRoomCode('ABC'), null);
  assert.equal(cleanRoomCode('ABCDE'), null);
  assert.equal(cleanRoomCode('ABCI'), null);
});

test('the guest adopts the host\'s match, rules and turn order', () => {
  const host = newOnlineGame({ role: 'host', room: 'WXYZ', hitAndGoAgain: true, keepShipsApart: true });
  const guest = gameFromHello(hello(host), 'WXYZ');
  assert.equal(guest.net.match, host.net.match);
  assert.equal(guest.hitAndGoAgain, true);
  assert.equal(guest.keepShipsApart, true);
  assert.equal(guest.net.role, 'guest');
  assert.equal(host.turn, 0);
  assert.equal(guest.turn, 1);
  assert.equal(gameFromHello({ ...hello(host), v: PROTOCOL + 1 }, 'WXYZ'), null, 'incompatible versions refuse');
  assert.equal(gameFromHello({ t: 'fire', cell: 3 }, 'WXYZ'), null);
});

test('battle starts only when both fleets are locked in, whichever order', () => {
  const l = link();
  l.send(1, commitOnline(l.guest, randomFleet(mulberry32(1))).send);
  l.flush();
  assert.equal(l.host.phase, 'placement');
  assert.equal(l.guest.phase, 'placement');
  assert.ok(l.events[0].some((e) => e.type === 'their-ready'));
  const res = commitOnline(l.host, randomFleet(mulberry32(2)));
  assert.ok(res.events.some((e) => e.type === 'battle'));
  l.send(0, res.send);
  l.flush();
  assert.equal(l.host.phase, 'battle');
  assert.equal(l.guest.phase, 'battle');
  assert.ok(canFireOnline(l.host));
  assert.ok(!canFireOnline(l.guest));
  assert.equal(commitOnline(l.host, randomFleet(mulberry32(3))).ok, false, 'cannot redeploy');
});

test('a full game: both devices agree on every shot and on the winner', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const l = link();
    deployBoth(l, seed);
    playOut(l, seed);
    assertMirrored(l);
    assert.equal(l.host.winner, 1 - l.guest.winner, 'one winner, seen from both sides');
    const loser = l.devices[l.host.winner === 0 ? 1 : 0];
    assert.ok(loser.boards[0].ships.every((s) => isSunk(loser.boards[0], s)));
  }
});

test('turns alternate in classic play and stay with the shooter after a hit with go-again', () => {
  const classic = link();
  deployBoth(classic, 9);
  const hitCell = shipCells(classic.guest.boards[0].ships[0])[0];
  classic.send(0, fireOnline(classic.host, hitCell).send);
  classic.flush();
  assert.equal(classic.host.turn, 1);
  assert.equal(classic.guest.turn, 0);

  const again = link({ rules: { hitAndGoAgain: true } });
  deployBoth(again, 9);
  again.send(0, fireOnline(again.host, hitCell).send);
  again.flush();
  assert.equal(again.host.turn, 0, 'hit: host fires again');
  assert.equal(again.guest.turn, 1);
  const water = [...Array(CELLS).keys()].find((i) => !again.guest.boards[0].ships.flatMap(shipCells).includes(i));
  again.send(0, fireOnline(again.host, water).send);
  again.flush();
  assert.equal(again.host.turn, 1, 'miss: turn passes');
  assert.equal(again.guest.turn, 0);
  playOut(again, 9);
  assertMirrored(again);
});

test('no unsunk ship position ever crosses the wire before the game ends', () => {
  const l = link();
  deployBoth(l, 21);
  playOut(l, 21);
  let reveals = 0;
  for (const { msg, senderPhase } of l.wire) {
    if (msg.t === 'result' && msg.ship) assert.equal(msg.result, 'sunk', 'ship details only accompany a sinking');
    if (msg.t === 'reveal') { reveals++; assert.equal(senderPhase, 'over', 'full fleet only after the game ends'); }
    else assert.ok(!('ships' in msg) && !('boards' in msg), `${msg.t} carries a fleet`);
  }
  assert.ok(reveals >= 1);
});

test('the loser sees the winner\'s surviving ships once the game ends', () => {
  const l = link();
  deployBoth(l, 33);
  playOut(l, 33);
  const loser = l.devices[l.host.winner === 0 ? 1 : 0];
  const winner = l.devices[l.host.winner === 0 ? 0 : 1];
  assert.equal(loser.boards[1].ships.length, 5);
  assert.deepEqual(
    loser.boards[1].ships.map((s) => s.id).sort(),
    winner.boards[0].ships.map((s) => s.id).sort(),
  );
});

test('every message delivered twice changes nothing', () => {
  const l = link({ rng: mulberry32(7), dupRate: 1 });
  deployBoth(l, 7);
  playOut(l, 7);
  assertMirrored(l);
  assert.equal(l.host.winner, 1 - l.guest.winner);
});

test('a lost shot is recovered on reconnect', () => {
  const l = link();
  deployBoth(l, 5);
  const res = fireOnline(l.host, 44);
  // the fire never arrives
  assert.ok(!canFireOnline(l.host), 'cannot fire again while waiting');
  assert.equal(fireOnline(l.host, 45).ok, false);
  l.reconnect();
  assert.equal(l.host.net.pending, null);
  assert.notEqual(l.host.boards[1].shots[44], UNKNOWN);
  assertMirrored(l);
  assert.ok(res.ok);
});

test('a lost answer is recovered on reconnect without firing twice', () => {
  const l = link();
  deployBoth(l, 6);
  l.send(0, fireOnline(l.host, 44).send);
  // deliver the fire but throw the answer away
  const out = receive(l.guest, l.wire.at(-1).msg);
  assert.equal(out.send[0].t, 'result');
  assert.notEqual(l.guest.boards[0].shots[44], UNKNOWN);
  const guestShots = l.guest.boards[0].shots.filter((s) => s !== UNKNOWN).length;
  l.reconnect();
  assert.equal(l.guest.boards[0].shots.filter((s) => s !== UNKNOWN).length, guestShots, 'not counted twice');
  assert.equal(l.host.net.pending, null);
  assertMirrored(l);
});

test('a lost winning shot still ends the game on both devices after reconnect', () => {
  const l = link();
  deployBoth(l, 12);
  // Host sinks everything except the final square; guest only misses.
  const targets = l.guest.boards[0].ships.flatMap(shipCells);
  const water = [...Array(CELLS).keys()].filter((i) => !l.host.boards[0].ships.flatMap(shipCells).includes(i));
  targets.forEach((cell, n) => {
    const res = fireOnline(l.host, cell);
    if (n < targets.length - 1) {
      l.send(0, res.send);
      l.flush();
      l.send(1, fireOnline(l.guest, water[n]).send);
      l.flush();
    } else {
      receive(l.guest, res.send[0]); // guest learns it lost; host never hears
    }
  });
  assert.equal(l.guest.phase, 'over');
  assert.equal(l.host.phase, 'battle');
  l.reconnect();
  assert.equal(l.host.phase, 'over');
  assert.equal(l.host.winner, 0);
  assert.equal(l.guest.winner, 1);
  assert.equal(l.guest.boards[1].ships.length, 5, 'the reveal also arrives');
});

test('random loss, duplication and reconnects: games always finish in step', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = mulberry32(seed * 31);
    const l = link({ rng, dropRate: 0.15, dupRate: 0.15, rules: { hitAndGoAgain: seed % 2 === 0 } });
    deployBoth(l, seed);
    for (let k = 0; k < 3 && (l.host.phase !== 'battle' || l.guest.phase !== 'battle'); k++) l.reconnect();
    assert.equal(l.host.phase, 'battle', `seed ${seed}: deployment recovered`);
    playOut(l, seed, { reconnectEvery: 7 });
    for (let k = 0; k < 5; k++) l.reconnect();
    assertMirrored(l);
    assert.equal(l.host.winner, 1 - l.guest.winner, `seed ${seed}`);
  }
});

test('a fire out of turn is refused and flagged', () => {
  const l = link();
  deployBoth(l, 2);
  const before = JSON.stringify(l.host);
  const out = receive(l.host, { t: 'fire', cell: 10 }); // it's the host's turn, not the guest's
  assert.deepEqual(out.send, []);
  assert.ok(out.events.some((e) => e.type === 'desync'));
  assert.equal(JSON.stringify(l.host), before);
  for (const junk of [null, {}, { t: 'fire' }, { t: 'fire', cell: 400 }, { t: 'result', cell: 'x' }, { t: 'nonsense' }]) {
    const snap = JSON.stringify(l.host);
    receive(l.host, junk);
    assert.equal(JSON.stringify(l.host), snap);
  }
});

test('an answer for a shot never fired is ignored', () => {
  const l = link();
  deployBoth(l, 2);
  const out = receive(l.host, { t: 'result', cell: 7, result: 'sunk', ship: { id: 'corvette', len: 2, r: 0, c: 6, horiz: true }, all: true });
  assert.deepEqual(out.events, []);
  assert.equal(l.host.phase, 'battle');
});

test('rematch: asking and accepting starts the same new match on both sides, other player first', () => {
  const l = link();
  deployBoth(l, 4);
  playOut(l, 4);
  const ask = requestRematch(l.host);
  assert.equal(ask.start, undefined);
  const offer = receive(l.guest, ask.send[0]);
  assert.deepEqual(offer.events, [{ type: 'offer' }]);
  const accept = requestRematch(l.guest);
  assert.ok(accept.start);
  const confirm = receive(l.host, accept.send[0]);
  const started = confirm.events.find((e) => e.type === 'start');
  assert.equal(started.match, accept.start.match);
  assert.equal(started.first, 'guest', 'the other player opens the rematch');
  assert.notEqual(started.match, l.host.net.match);
});

test('rematch: both asking at once settles on one match', () => {
  const l = link();
  deployBoth(l, 8);
  playOut(l, 8);
  const a = requestRematch(l.host);
  const b = requestRematch(l.guest);
  const ea = receive(l.host, b.send[0]).events.find((e) => e.type === 'start');
  const eb = receive(l.guest, a.send[0]).events.find((e) => e.type === 'start');
  assert.ok(ea && eb);
  assert.deepEqual(ea, eb);
});

test('rematch: a lost acceptance is recovered when the devices next say hello', () => {
  const l = link();
  deployBoth(l, 10);
  playOut(l, 10);
  const ask = requestRematch(l.host);
  receive(l.guest, ask.send[0]);
  const accept = requestRematch(l.guest); // guest starts the new match; its reply is lost
  const next = newOnlineGame({ role: 'guest', room: 'ABCD', ...accept.start, prev: l.guest.net.match });
  const out = receive(l.host, hello(next));
  const started = out.events.find((e) => e.type === 'start');
  assert.deepEqual(started, { type: 'start', ...accept.start });
});

test('rematch requests during a battle are ignored', () => {
  const l = link();
  deployBoth(l, 8);
  assert.deepEqual(receive(l.host, { t: 'rematch', match: 'zzz', first: 'guest' }).events, []);
  assert.deepEqual(requestRematch(l.host).send, []);
});

test('a device that lost its game is noticed rather than played on', () => {
  const l = link();
  deployBoth(l, 3);
  const amnesiac = gameFromHello(hello(l.host), 'ABCD'); // guest reinstalled mid-battle
  const out = receive(l.host, hello(amnesiac));
  assert.ok(out.events.some((e) => e.type === 'desync'));
});

test('hellos from a different match are flagged and ignored', () => {
  const l = link();
  const other = newOnlineGame({ role: 'guest', room: 'ABCD' });
  assert.deepEqual(receive(l.host, hello(other)).events, [{ type: 'other-match' }]);
  assert.deepEqual(receive(l.host, { ...hello(l.guest), v: 99 }).events, [{ type: 'version' }]);
  assert.deepEqual(receive(l.host, { t: 'bye' }).events, [{ type: 'left' }]);
});

test('saved online games restore exactly, mid-shot included', () => {
  const l = link();
  deployBoth(l, 14);
  l.send(0, fireOnline(l.host, 0).send);
  l.flush();
  l.send(1, fireOnline(l.guest, 99).send);
  l.flush();
  fireOnline(l.host, 55); // waiting for the answer
  for (const g of l.devices) {
    const back = reviveOnline(JSON.stringify(g));
    assert.deepEqual(back, g);
  }
  assert.equal(reviveOnline(JSON.stringify(l.host)).net.pending, 55);
});

test('corrupt or tampered online saves are rejected', () => {
  const l = link();
  deployBoth(l, 15);
  const good = JSON.stringify(l.host);
  const bad = [
    '', '{', 'null',
    good.replace('"mode":"online"', '"mode":"solo"'),
    good.replace('"role":"host"', '"role":"spy"'),
    good.replace('"room":"ABCD"', '"room":"ab"'),
  ];
  for (const raw of bad) assert.equal(reviveOnline(raw), null, raw.slice(0, 30));
  const peek = JSON.parse(good);
  peek.boards[1].ships.push({ id: 'carrier', len: 5, r: 0, c: 0, horiz: true }); // an unsunk enemy ship
  assert.equal(reviveOnline(peek), null);
  const lost = JSON.parse(good);
  lost.boards[0].ships.pop();
  assert.equal(reviveOnline(lost), null);
  const pend = JSON.parse(good);
  pend.net.pending = 400;
  assert.equal(reviveOnline(pend), null);
});
