// Ironwake — two-device play. Pure protocol logic, no networking or DOM, so it
// can be tested by wiring two games together in memory.
//
// Each device only ever holds its own fleet. A shot goes out as `fire`; the
// defending device works out the outcome against its own ships and answers with
// `result`. A ship's position is only sent once it has been sunk, and the
// winner sends the rest of its fleet when the game ends.
//
// Local perspective: boards[0] is always "my" fleet, boards[1] is what I know of
// the opponent's; turn 0 means my turn. Both devices derive whose turn it is from
// the same sequence of results, so they never need to negotiate it.
//
// Every message is safe to receive twice and every exchange can be repeated after
// a reconnect: `hello` carries any shot still waiting for an answer, and a `fire`
// for a square already hit is answered again rather than refused.

import {
  CELLS, FLEET, UNKNOWN, MISS, HIT,
  createBoard, fire, isFleetComplete, isSunk, allSunk, shipAt, shipCells, inBounds,
} from './engine.js';

export const PROTOCOL = 1;
export const SAVE_VERSION = 1;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: easy to read aloud

export const newMatchId = () => Math.random().toString(36).slice(2, 10);

export function newRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return code;
}

/** Normalise what someone typed; returns a four-letter code or null. */
export function cleanRoomCode(text) {
  const code = String(text || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/O/g, 'Q');
  return code.length === 4 && [...code].every((ch) => CODE_ALPHABET.includes(ch)) ? code : null;
}

export function newOnlineGame({ role, room, match = newMatchId(), first = 'host', prev = null, hitAndGoAgain = false, keepShipsApart = false }) {
  return {
    v: SAVE_VERSION,
    id: match,
    mode: 'online',
    difficulty: 'normal',
    hitAndGoAgain: hitAndGoAgain === true,
    keepShipsApart: keepShipsApart === true,
    phase: 'placement',
    placing: 0,
    turn: first === role ? 0 : 1,
    winner: null,
    cover: false,
    last: null,
    elapsedMs: 0,
    recorded: false,
    draft: [],
    boards: [createBoard(), createBoard()],
    net: {
      role: role === 'guest' ? 'guest' : 'host',
      room,
      match,
      first: first === 'guest' ? 'guest' : 'host',
      prev: typeof prev === 'string' ? prev : null, // the match this one is a rematch of
      ready: false, // my fleet is locked in
      themReady: false,
      pending: null, // square I fired at, still waiting for the answer
      rematch: null, // my outstanding rematch request { match, first }
      offer: null, // their rematch request, waiting for me
    },
  };
}

export function hello(game) {
  const { net } = game;
  return {
    t: 'hello',
    v: PROTOCOL,
    match: net.match,
    prev: net.prev,
    first: net.first,
    rules: { hitAndGoAgain: game.hitAndGoAgain, keepShipsApart: game.keepShipsApart },
    ready: net.ready,
    pending: net.pending,
  };
}

/** Guest side: build a fresh game from the host's hello. */
export function gameFromHello(msg, room) {
  if (!msg || msg.t !== 'hello' || msg.v !== PROTOCOL || typeof msg.match !== 'string' || !msg.match) return null;
  const rules = msg.rules || {};
  return newOnlineGame({
    role: 'guest',
    room,
    match: msg.match,
    first: msg.first === 'guest' ? 'guest' : 'host',
    hitAndGoAgain: rules.hitAndGoAgain === true,
    keepShipsApart: rules.keepShipsApart === true,
  });
}

function maybeStart(game, events) {
  if (game.phase === 'placement' && game.net.ready && game.net.themReady) {
    game.phase = 'battle';
    game.turn = game.net.first === game.net.role ? 0 : 1;
    events.push({ type: 'battle' });
  }
}

/** Lock in my fleet. */
export function commitOnline(game, ships) {
  if (game.phase !== 'placement' || game.net.ready) return { ok: false, reason: 'phase', send: [], events: [] };
  if (!isFleetComplete(ships, game.keepShipsApart)) return { ok: false, reason: 'incomplete', send: [], events: [] };
  game.boards[0] = createBoard(ships);
  game.draft = [];
  game.net.ready = true;
  const events = [];
  maybeStart(game, events);
  return { ok: true, send: [{ t: 'ready' }], events };
}

export const canFireOnline = (game) => game.phase === 'battle' && game.turn === 0 && game.net.pending === null;

/** Fire at the opponent. The outcome arrives later as a `result`. */
export function fireOnline(game, cell) {
  if (!canFireOnline(game)) return { ok: false, reason: 'turn', send: [] };
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return { ok: false, reason: 'invalid', send: [] };
  if (game.boards[1].shots[cell] !== UNKNOWN) return { ok: false, reason: 'repeat', send: [] };
  game.net.pending = cell;
  return { ok: true, send: [{ t: 'fire', cell }] };
}

const shipOut = (s) => ({ id: s.id, len: s.len, r: s.r, c: s.c, horiz: !!s.horiz });

/** The answer for a square of my board that has already been fired on. */
function resultFor(game, cell) {
  const board = game.boards[0];
  const ship = board.shots[cell] === HIT ? shipAt(board, cell) : null;
  const sunk = ship && isSunk(board, ship);
  return {
    t: 'result',
    cell,
    result: !ship ? 'miss' : sunk ? 'sunk' : 'hit',
    ship: sunk ? shipOut(ship) : null,
    all: allSunk(board),
  };
}

function passTurn(game, result, to) {
  if (!game.hitAndGoAgain || result === 'miss') game.turn = to;
}

function incoming(game, cell, out) {
  const board = game.boards[0];
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return;
  if (board.shots[cell] !== UNKNOWN) { // already answered once; the answer may have been lost
    out.send.push(resultFor(game, cell));
    return;
  }
  if (game.phase !== 'battle' || game.turn !== 1) {
    out.events.push({ type: 'desync', why: 'fire out of turn' });
    return;
  }
  const res = fire(board, cell);
  game.last = { by: 1, cell, result: res.result, shipId: res.ship ? res.ship.id : null };
  if (res.allSunk) {
    game.phase = 'over';
    game.winner = 1;
  } else {
    passTurn(game, res.result, 0);
  }
  out.send.push(resultFor(game, cell));
  out.events.push({ type: 'incoming', cell, result: res.result, ship: res.ship, over: res.allSunk });
}

function validEnemyShip(s) {
  const spec = s && FLEET.find((f) => f.id === s.id);
  return !!spec && spec.len === s.len && typeof s.horiz === 'boolean' && inBounds(s);
}

function answer(game, msg, out) {
  const { cell } = msg;
  if (game.net.pending === null || cell !== game.net.pending) return; // duplicate or stale
  if (!['miss', 'hit', 'sunk'].includes(msg.result)) return;
  const theirs = game.boards[1];
  theirs.shots[cell] = msg.result === 'miss' ? MISS : HIT;
  game.net.pending = null;
  let ship = null;
  if (msg.result === 'sunk' && validEnemyShip(msg.ship) && shipCells(msg.ship).includes(cell)) {
    ship = shipOut(msg.ship);
    if (!theirs.ships.some((s) => s.id === ship.id)) theirs.ships.push(ship);
  }
  game.last = { by: 0, cell, result: msg.result, shipId: ship ? ship.id : null };
  const over = msg.all === true;
  if (over) {
    game.phase = 'over';
    game.winner = 0;
    out.send.push({ t: 'reveal', ships: game.boards[0].ships.map(shipOut) });
  } else {
    passTurn(game, msg.result, 1);
  }
  out.events.push({ type: 'outgoing', cell, result: msg.result, ship, over });
}

function reveal(game, msg, out) {
  if (game.phase !== 'over' || !Array.isArray(msg.ships)) return;
  const theirs = game.boards[1];
  for (const s of msg.ships) {
    if (validEnemyShip(s) && !theirs.ships.some((k) => k.id === s.id)) theirs.ships.push(shipOut(s));
  }
  out.events.push({ type: 'reveal' });
}

const flip = (first) => (first === 'host' ? 'guest' : 'host');

/** Ask for (or accept) a rematch. Returns { send, start? } — `start` means begin it now. */
export function requestRematch(game) {
  const { net } = game;
  if (game.phase !== 'over') return { send: [] };
  if (net.offer) {
    const start = net.offer;
    return { send: [{ t: 'rematch', ...start }], start };
  }
  if (!net.rematch) net.rematch = { match: newMatchId(), first: flip(net.first) };
  return { send: [{ t: 'rematch', ...net.rematch }] };
}

function rematch(game, msg, out) {
  if (game.phase !== 'over' || typeof msg.match !== 'string' || !msg.match) return;
  const theirs = { match: msg.match, first: msg.first === 'guest' ? 'guest' : 'host' };
  const mine = game.net.rematch;
  if (mine) {
    // Accepted, or both asked at once: both sides settle on the same request.
    const start = mine.match === theirs.match || mine.match < theirs.match ? mine : theirs;
    out.events.push({ type: 'start', ...start });
  } else {
    game.net.offer = theirs;
    out.events.push({ type: 'offer' });
  }
}

/** Apply a message from the opponent. Mutates `game`; returns what to send and what happened. */
export function receive(game, msg) {
  const out = { send: [], events: [] };
  if (!msg || typeof msg.t !== 'string') return out;
  const { net } = game;
  switch (msg.t) {
    case 'hello':
      if (msg.v !== PROTOCOL) { out.events.push({ type: 'version' }); break; }
      if (msg.match !== net.match) {
        // They already started the rematch of this game; the message saying so was lost.
        if (game.phase === 'over' && typeof msg.match === 'string' && msg.match && msg.prev === net.match) {
          out.events.push({ type: 'start', match: msg.match, first: msg.first === 'guest' ? 'guest' : 'host' });
        } else {
          out.events.push({ type: 'other-match' });
        }
        break;
      }
      if (msg.ready === true) {
        if (!net.themReady) {
          net.themReady = true;
          out.events.push({ type: 'their-ready' });
          maybeStart(game, out.events);
        }
      } else if (net.themReady && game.phase !== 'placement') {
        out.events.push({ type: 'desync', why: 'opponent lost their fleet' });
        break;
      }
      if (Number.isInteger(msg.pending)) incoming(game, msg.pending, out);
      if (game.phase === 'over' && game.winner === 0) out.send.push({ t: 'reveal', ships: game.boards[0].ships.map(shipOut) });
      break;
    case 'ready':
      if (!net.themReady) {
        net.themReady = true;
        out.events.push({ type: 'their-ready' });
        maybeStart(game, out.events);
      }
      break;
    case 'fire': incoming(game, msg.cell, out); break;
    case 'result': answer(game, msg, out); break;
    case 'reveal': reveal(game, msg, out); break;
    case 'rematch': rematch(game, msg, out); break;
    case 'bye': out.events.push({ type: 'left' }); break;
    default: break;
  }
  return out;
}

/** Validate an online game loaded from storage; null if anything is off. */
export function reviveOnline(raw) {
  try {
    const g = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!g || g.v !== SAVE_VERSION || g.mode !== 'online' || !g.net) return null;
    const n = g.net;
    if (!['host', 'guest'].includes(n.role) || !['host', 'guest'].includes(n.first)) return null;
    if (typeof n.room !== 'string' || !/^[A-Z]{4}$/.test(n.room) || typeof n.match !== 'string') return null;
    if (!['placement', 'battle', 'over'].includes(g.phase) || ![0, 1].includes(g.turn)) return null;
    if (typeof g.hitAndGoAgain !== 'boolean' || typeof g.keepShipsApart !== 'boolean') return null;
    if (!Array.isArray(g.boards) || g.boards.length !== 2) return null;
    for (const b of g.boards) {
      if (!b || !Array.isArray(b.ships) || !Array.isArray(b.shots) || b.shots.length !== CELLS) return null;
      if (!b.shots.every((s) => s === UNKNOWN || s === MISS || s === HIT)) return null;
    }
    const [mine, theirs] = g.boards;
    if (n.ready || g.phase !== 'placement') {
      if (!isFleetComplete(mine.ships, g.keepShipsApart)) return null;
      const occupied = new Set(mine.ships.flatMap(shipCells));
      for (let i = 0; i < CELLS; i++) {
        if (mine.shots[i] === HIT && !occupied.has(i)) return null;
        if (mine.shots[i] === MISS && occupied.has(i)) return null;
      }
    }
    for (const s of theirs.ships) {
      if (!validEnemyShip(s)) return null;
      if (g.phase !== 'over' && !isSunk(theirs, s)) return null; // only wrecks are known mid-game
    }
    if (n.pending !== null && !(Number.isInteger(n.pending) && theirs.shots[n.pending] === UNKNOWN)) return null;
    if (g.phase === 'over' && ![0, 1].includes(g.winner)) return null;
    if (g.phase !== 'over') g.winner = null;
    if (!Array.isArray(g.draft)) g.draft = [];
    g.elapsedMs = Number.isFinite(g.elapsedMs) && g.elapsedMs >= 0 ? g.elapsedMs : 0;
    g.cover = false;
    g.recorded = !!g.recorded;
    n.ready = !!n.ready;
    n.prev = typeof n.prev === 'string' ? n.prev : null;
    n.themReady = !!n.themReady;
    n.rematch = n.rematch && typeof n.rematch.match === 'string' ? n.rematch : null;
    n.offer = n.offer && typeof n.offer.match === 'string' ? n.offer : null;
    return g;
  } catch {
    return null;
  }
}
