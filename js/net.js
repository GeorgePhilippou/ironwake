// Ironwake — the connection between two devices.
//
// Uses WebRTC data channels through PeerJS (vendor/peerjs.min.js, MIT). PeerJS's
// free public broker introduces the two devices using the room code; after that
// the game talks device to device. On the same Wi-Fi the traffic stays local.
//
// The link keeps itself alive: it pings every few seconds, notices a silent
// drop (iPads suspend backgrounded pages), and keeps redialling. The game
// protocol (online.js) is built to resume from any point, so the link never has
// to buffer or replay anything — it just says `onOpen` again.
//
// `?net=local` swaps in a BroadcastChannel link between tabs of one browser,
// used for testing without the internet.

const PING_MS = 2000;
const DEAD_MS = 9000;
const RETRY_MS = 2500;
const DIAL_TIMEOUT_MS = 9000;

let peerjsLoading = null;
function loadPeerJS() {
  if (window.peerjs) return Promise.resolve(window.peerjs);
  peerjsLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs.min.js';
    s.onload = () => (window.peerjs ? resolve(window.peerjs) : reject(new Error('PeerJS missing')));
    s.onerror = () => { peerjsLoading = null; s.remove(); reject(new Error('PeerJS failed to load')); };
    document.head.append(s);
  });
  return peerjsLoading;
}

export const supportsOnline = () => typeof RTCPeerConnection === 'function' || 'BroadcastChannel' in window;

/**
 * Open a link for a room.
 *   role: 'host' | 'guest'
 *   onOpen(): connected (again) — say hello
 *   onMessage(msg): a message from the other device
 *   onStatus(status): 'connecting' | 'waiting' | 'searching' | 'connected' | 'offline' | 'unsupported'
 */
export function openLink({ role, room, onOpen, onMessage, onStatus, local = false }) {
  const base = createBase({ role, onOpen, onMessage, onStatus });
  const driver = local ? localDriver(base, role, room) : peerDriver(base, role, room);
  base.driver = driver;
  driver.start();
  return {
    send: (msg) => base.send(msg),
    close: (farewell) => base.close(farewell),
    poke: () => base.poke(),
    get status() { return base.status; },
  };
}

function createBase({ role, onOpen, onMessage, onStatus }) {
  const base = {
    role,
    status: 'connecting',
    closed: false,
    conn: null, // { send(obj), close() } for the current channel
    lastSeen: 0,
    driver: null,
    setStatus(s) {
      if (base.closed || s === base.status) return;
      base.status = s;
      try { onStatus(s); } catch (e) { console.error(e); }
    },
    opened(conn) {
      if (base.closed) { conn.close(); return; }
      if (base.conn && base.conn !== conn) base.conn.close();
      base.conn = conn;
      base.lastSeen = Date.now();
      base.setStatus('connected');
      try { onOpen(); } catch (e) { console.error(e); }
    },
    received(conn, data) {
      if (conn !== base.conn || base.closed) return;
      base.lastSeen = Date.now();
      if (!data || typeof data !== 'object' || data.t === 'ping') return;
      try { onMessage(data); } catch (e) { console.error(e); }
    },
    lost(conn) {
      if (conn !== base.conn) return;
      base.conn = null;
      if (base.closed) return;
      base.setStatus(role === 'host' ? 'waiting' : 'searching');
      base.driver.lost();
    },
    send(msg) {
      if (!base.conn || base.closed) return false;
      try { base.conn.send(msg); return true; } catch { base.lost(base.conn); return false; }
    },
    poke() {
      if (base.closed) return;
      if (base.conn && Date.now() - base.lastSeen > DEAD_MS) base.lost(base.conn);
      base.driver.poke();
      base.send({ t: 'ping' });
    },
    close(farewell) {
      if (base.closed) return;
      if (farewell) base.send(farewell);
      base.closed = true;
      clearInterval(base.timer);
      document.removeEventListener('visibilitychange', base.onVis);
      const c = base.conn;
      base.conn = null;
      // Give a farewell message a moment to leave before tearing down.
      setTimeout(() => { try { c && c.close(); } catch { /* ignore */ } base.driver.stop(); }, farewell ? 300 : 0);
    },
  };
  base.timer = setInterval(() => {
    if (!base.conn) return;
    if (Date.now() - base.lastSeen > DEAD_MS) { const c = base.conn; try { c.close(); } catch { /* ignore */ } base.lost(c); return; }
    base.send({ t: 'ping' });
  }, PING_MS);
  base.onVis = () => { if (!document.hidden) base.poke(); };
  document.addEventListener('visibilitychange', base.onVis);
  return base;
}

// ───────── WebRTC via PeerJS ─────────
function peerDriver(base, role, room) {
  const hostId = `ironwake-v1-${room}`;
  let peer = null;
  let retry = 0;
  let dialTimer = 0;
  let stopped = false;

  const later = (fn, ms = RETRY_MS) => {
    clearTimeout(retry);
    retry = setTimeout(() => { if (!stopped && !base.closed) fn(); }, ms);
  };

  function wrap(c) {
    const conn = { send: (m) => c.send(m), close: () => { try { c.close(); } catch { /* ignore */ } } };
    c.on('open', () => { clearTimeout(dialTimer); base.opened(conn); });
    c.on('data', (d) => base.received(conn, d));
    c.on('close', () => base.lost(conn));
    c.on('error', () => base.lost(conn));
    return conn;
  }

  function dial() {
    if (stopped || base.closed || base.conn) return;
    if (!peer || peer.destroyed) return start();
    if (peer.disconnected) { try { peer.reconnect(); } catch { /* ignore */ } return later(dial); }
    base.setStatus('searching');
    let c;
    try { c = peer.connect(hostId, { reliable: true, serialization: 'json' }); } catch { return later(dial); }
    if (!c) return later(dial);
    const conn = wrap(c);
    clearTimeout(dialTimer);
    dialTimer = setTimeout(() => { if (base.conn !== conn) { conn.close(); later(dial, 200); } }, DIAL_TIMEOUT_MS);
  }

  async function start() {
    if (stopped || base.closed) return;
    base.setStatus('connecting');
    let lib;
    try { lib = await loadPeerJS(); } catch { base.setStatus('offline'); return later(start, 4000); }
    if (stopped || base.closed) return;
    try { if (peer) peer.destroy(); } catch { /* ignore */ }
    try {
      peer = role === 'host' ? new lib.Peer(hostId, { debug: 0 }) : new lib.Peer({ debug: 0 });
    } catch {
      base.setStatus('unsupported');
      return;
    }
    const me = peer;
    me.on('open', () => {
      if (me !== peer) return;
      if (role === 'host') { if (!base.conn) base.setStatus('waiting'); } else dial();
    });
    me.on('connection', (c) => {
      if (me !== peer || role !== 'host') return;
      wrap(c);
    });
    me.on('disconnected', () => {
      // Lost the broker, not necessarily the other device. Reconnect quietly.
      if (me !== peer || stopped) return;
      later(() => { try { if (!me.destroyed) me.reconnect(); } catch { start(); } }, 1500);
    });
    me.on('error', (err) => {
      if (me !== peer || stopped) return;
      const type = err && err.type;
      if (type === 'peer-unavailable') { base.setStatus('searching'); return later(dial); }
      if (type === 'unavailable-id') { base.setStatus('connecting'); return later(start, 3000); } // our old self, still registered
      if (type === 'browser-incompatible') { base.setStatus('unsupported'); return; }
      if (!base.conn) base.setStatus(navigator.onLine === false ? 'offline' : 'connecting');
      later(start, 3000);
    });
  }

  return {
    start,
    lost() { if (role === 'guest') later(dial, 600); },
    poke() {
      if (stopped) return;
      if (!peer || peer.destroyed) return start();
      if (peer.disconnected) { try { peer.reconnect(); } catch { start(); } }
      if (role === 'guest' && !base.conn) later(dial, 50);
    },
    stop() {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(dialTimer);
      try { if (peer) peer.destroy(); } catch { /* ignore */ }
      peer = null;
    },
  };
}

// ───────── Same-browser link for testing (?net=local) ─────────
function localDriver(base, role, room) {
  const me = Math.random().toString(36).slice(2, 10);
  let ch = null;
  let other = null;
  let knock = 0;
  let conn = null;

  const makeConn = (to) => ({
    send: (m) => ch && ch.postMessage({ k: 'data', from: me, to, d: m }),
    close: () => ch && ch.postMessage({ k: 'close', from: me, to }),
  });

  function onMsg({ data }) {
    if (!data || data.to && data.to !== me) return;
    if (data.k === 'knock' && role === 'host') {
      other = data.from;
      conn = makeConn(other);
      ch.postMessage({ k: 'welcome', from: me, to: other });
      base.opened(conn);
    } else if (data.k === 'welcome' && role === 'guest' && !base.conn) {
      clearInterval(knock);
      other = data.from;
      conn = makeConn(other);
      base.opened(conn);
    } else if (data.k === 'data' && data.from === other) {
      base.received(conn, data.d);
    } else if (data.k === 'close' && data.from === other) {
      base.lost(conn);
    }
  }

  function startKnocking() {
    clearInterval(knock);
    const go = () => ch && !base.conn && ch.postMessage({ k: 'knock', from: me });
    go();
    knock = setInterval(go, 700);
  }

  return {
    start() {
      ch = new BroadcastChannel(`ironwake-local-${room}`);
      ch.onmessage = onMsg;
      if (role === 'host') base.setStatus('waiting'); else { base.setStatus('searching'); startKnocking(); }
    },
    lost() { if (role === 'guest') startKnocking(); },
    poke() { if (role === 'guest' && !base.conn) startKnocking(); },
    stop() { clearInterval(knock); if (ch) ch.close(); ch = null; },
  };
}
