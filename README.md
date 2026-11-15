# Ironwake

A naval strategy game for iPad: hunt the enemy fleet on a 10 × 10 sonar grid.
Solo against three computer opponents, or two-player pass-and-play on one device.

**Play:** https://georgephilippou.github.io/ironwake/

Install on iPad: open the link in Safari → Share → **Add to Home Screen**. It then
runs full-screen and works offline.

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
