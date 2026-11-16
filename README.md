# Ironwake

A naval strategy game for iPad: hunt the enemy fleet on a 10 × 10 sonar grid.
Solo against three computer opponents, or two-player pass-and-play on one device.

**Play:** https://georgephilippou.github.io/ironwake/

Install on iPad: open the link in Safari → Share → **Add to Home Screen**. It then
runs full-screen and works offline.

## Two iPads

Each player can use their own iPad. One chooses **Two iPads → Host a game** and
reads out the four-letter room code; the other chooses **Join a game** and types
it in. Both iPads should be on the same Wi-Fi.

How it connects: the free public [PeerJS](https://peerjs.com) broker introduces
the two iPads using the room code, then the game runs over a direct WebRTC
connection between them. The broker sees only the room code and the devices'
network addresses — never the game. Each iPad keeps its own fleet; a ship's
position is only sent to the other iPad when it is sunk, and the winner's
remaining ships are revealed at the end. If an iPad sleeps or the app is closed,
the game reconnects and carries on (`js/online.js` explains how).

For testing on one computer, open the game as `localhost` in one tab and
`127.0.0.1` in another (separate storage), or add `?net=local` to both to link
two tabs without the internet.

## What's here

Plain HTML, CSS and JavaScript modules — no build step, no dependencies.

| Path | What it is |
| --- | --- |
| `index.html`, `css/style.css` | Page shell and the whole visual design (dark "night watch" and light "day chart") |
| `js/engine.js` | Rules: placement, firing, sinking, win detection |
| `js/ai.js` | Easy (random), Normal (hunt and target), Hard (probability density) |
| `js/game.js` | Match state machine; save/restore validation |
| `js/app.js` | Screens, drag-and-drop, animation sequencing |
| `js/art.js`, `js/fx.js`, `js/audio.js` | SVG artwork, canvas effects, Web Audio sound synthesis |
| `js/online.js`, `js/net.js`, `vendor/peerjs.min.js` | Two-iPad protocol (pure, tested) and the WebRTC link (PeerJS 1.5.4, MIT) |
| `js/storage.js` | Settings, statistics and the saved game (localStorage) |
| `sw.js`, `manifest.webmanifest`, `icons/`, `splash/` | Offline support and home-screen install |
| `tests/` | Automated tests (`npm test`, needs Node 20+) |

## Releasing a change

```bash
npm run stamp   # rewrites the version hash + offline file list in sw.js
npm test        # fails if the stamp is stale, so you can't forget
```

Then commit and push. Installed copies pick up the new version the next time
they are opened online: the new service worker downloads a complete fresh copy,
swaps over, and the app reloads itself (or offers a "tap to reload" if a battle
is in progress — the game in progress is kept).

`python3 tools/make-art.py` regenerates the icon PNGs and iPad launch images from
`icons/icon.svg` (needs `rsvg-convert`). Only needed if the artwork changes.

All artwork and sound is original: ships and icons are hand-written SVG, and every
sound effect is synthesised at runtime with the Web Audio API.

![Ironwake battle screen](docs/screenshots/3-battle-night.jpg)
