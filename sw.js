// Ironwake service worker — makes the installed app work fully offline.
//
// Update strategy: VERSION is a hash of every shipped file, written by
// `npm run stamp` (tools/stamp.mjs). Any change to the game changes this file,
// the browser notices on the next launch, the new worker downloads a complete
// fresh copy into its own cache, takes over, and the page reloads itself.
// A copy is therefore always all-old or all-new, never a mixture.

const VERSION = '1.0.0-865c36bc';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/ai.js',
  'js/app.js',
  'js/art.js',
  'js/audio.js',
  'js/engine.js',
  'js/fx.js',
  'js/game.js',
  'js/storage.js',
  'js/version.js',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

const CACHE = `ironwake-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ironwake-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
