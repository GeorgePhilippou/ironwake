// Ironwake — all artwork, drawn here as SVG. Nothing is loaded from elsewhere.

import { FLEET } from './engine.js';

// Each ship is drawn bow-right in a box 100 units tall and 100 units per cell long.
const hull = (L) =>
  `M5 50C5 32 13 23 30 21L${L - 44} 21C${L - 22} 23 ${L - 8} 38 ${L - 4} 50C${L - 8} 62 ${L - 22} 77 ${L - 44} 79L30 79C13 77 5 68 5 50Z`;

const turret = (x, dir = 1) =>
  `<rect class="dark" x="${dir > 0 ? x : x - 30}" y="46" width="30" height="8" rx="3"/><circle class="dark" cx="${x}" cy="50" r="12"/>`;

const DRAW = {
  carrier: (L) => `
    <path class="hull" d="${hull(L)}"/>
    <path class="deck" d="M26 28L${L - 60} 28L${L - 26} 50L${L - 60} 72L26 72Z"/>
    <path class="mark" d="M44 50H${L - 70}" stroke-dasharray="20 14"/>
    <path class="mark" d="M70 66L330 35"/>
    <rect class="dark" x="262" y="59" width="76" height="14" rx="4"/>
    <rect class="dark" x="120" y="33" width="34" height="14" rx="2" opacity=".55"/>
    <rect class="dark" x="372" y="53" width="30" height="13" rx="2" opacity=".55"/>`,
  dreadnought: (L) => `
    <path class="hull" d="${hull(L)}"/>
    <rect class="deck" x="140" y="32" width="112" height="36" rx="8"/>
    <circle class="dark" cx="172" cy="50" r="9"/><circle class="dark" cx="206" cy="50" r="9"/>
    ${turret(92, -1)}${turret(282)}${turret(326)}`,
  cruiser: (L) => `
    <path class="hull" d="${hull(L)}"/>
    <rect class="deck" x="108" y="33" width="78" height="34" rx="8"/>
    <circle class="dark" cx="136" cy="50" r="8"/>
    <rect class="dark" x="156" y="44" width="18" height="12" rx="2"/>
    ${turret(74, -1)}${turret(222)}`,
  submarine: (L) => `
    <path class="hull" d="M6 50C6 38 20 33 42 32L${L - 62} 31C${L - 30} 32 ${L - 8} 42 ${L - 4} 50C${L - 8} 58 ${L - 30} 68 ${L - 62} 69L42 68C20 67 6 62 6 50Z"/>
    <path class="deck" d="M${L - 76} 32l10-11h16l-6 11zM${L - 76} 68l10 11h16l-6-11z"/>
    <path class="deck" d="M30 33l-12-10h14l12 10zM30 67l-12 10h14l12-10z"/>
    <ellipse class="dark" cx="168" cy="50" rx="34" ry="10"/>
    <path class="mark" d="M60 50H118M214 50H${L - 44}"/>`,
  corvette: (L) => `
    <path class="hull" d="${hull(L)}"/>
    <rect class="deck" x="58" y="34" width="56" height="32" rx="7"/>
    <circle class="dark" cx="80" cy="50" r="7"/>
    ${turret(142)}`,
};

export function shipSVG(id, horiz = true) {
  const spec = FLEET.find((s) => s.id === id);
  const L = spec.len * 100;
  const art = DRAW[id](L);
  return horiz
    ? `<svg viewBox="0 0 ${L} 100" preserveAspectRatio="none" aria-hidden="true">${art}</svg>`
    : `<svg viewBox="0 0 100 ${L}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(100 0) rotate(90)">${art}</g></svg>`;
}

/** Sonar-and-wake emblem. Uses currentColor so it follows the theme. */
export const EMBLEM = `
<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
  <circle cx="60" cy="60" r="56" stroke="currentColor" stroke-width="2.5"/>
  <circle cx="60" cy="60" r="39" stroke="currentColor" stroke-width="1.2" opacity=".5"/>
  <circle cx="60" cy="60" r="22" stroke="currentColor" stroke-width="1.2" opacity=".35"/>
  <path d="M60 2v10M60 108v10M2 60h10M108 60h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M60 60L60 4A56 56 0 0 1 108.5 32Z" fill="currentColor" opacity=".16"/>
  <path d="M60 60L108.5 32" stroke="currentColor" stroke-width="1.6" opacity=".8"/>
  <path d="M60 26c7 9 10 19 10 31v17H50V57c0-12 3-22 10-31Z" fill="currentColor"/>
  <path d="M47 70C40 82 31 90 20 95M73 70c7 12 16 20 27 25" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M53 82C49 90 44 96 37 101M67 82c4 8 9 14 16 19" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".55"/>
</svg>`;

const icon = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${extra}<path d="${d}"/></svg>`;

export const ICONS = {
  pause: icon('M9 5v14M15 5v14'),
  back: icon('M15 5l-7 7 7 7'),
  close: icon('M6 6l12 12M18 6L6 18'),
  gear: icon('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1', '<circle cx="12" cy="12" r="3.5"/>'),
  chart: icon('M5 20V11M12 20V4M19 20v-6'),
  help: icon('M9.2 9a3 3 0 1 1 4.6 2.5c-1 .7-1.8 1.3-1.8 2.7M12 18h.01', '<circle cx="12" cy="12" r="9.5"/>'),
  shuffle: icon('M3 7h3c5 0 6 10 11 10h4M3 17h3c1.6 0 2.8-1 3.9-2.4M14.2 9.2C15 8 16 7 17 7h4M18 4l3 3-3 3M18 14l3 3-3 3'),
  clear: icon('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'),
};
