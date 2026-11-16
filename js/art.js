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

// ───────── Royal Navy, 1939–45 ─────────
// Period top-down plans of the five ships, in Western Approaches style
// camouflage (pale blues and greys broken by darker panels). Camouflage is
// clipped to the hull, so each drawing gets its own clipPath id.
let clipSeq = 0;
const rnHull = (L, b, bow = 70) =>
  `M10 ${50 - b}L${L - bow} ${50 - b}C${L - bow * 0.45} ${50 - b} ${L - 16} ${50 - b * 0.45} ${L - 3} 50`
  + `C${L - 16} ${50 + b * 0.45} ${L - bow * 0.45} ${50 + b} ${L - bow} ${50 + b}L10 ${50 + b}C3 ${50 + b} 3 ${50 - b} 10 ${50 - b}Z`;
const subHull = (L) => `M8 50C14 40 40 36 70 36L${L - 70} 36C${L - 30} 36 ${L - 10} 44 ${L - 3} 50C${L - 10} 56 ${L - 30} 64 ${L - 70} 64L70 64C40 64 14 60 8 50Z`;

/** A turret at x, guns pointing +1 (bow) or -1 (stern), `n` barrels. */
const rnTurret = (x, dir, n = 2, r = 13, len = 30) => {
  const gaps = n === 3 ? [-6, 0, 6] : n === 2 ? [-4, 4] : [0];
  const guns = gaps.map((g) => `<rect class="gun" x="${dir > 0 ? x : x - len}" y="${50 + g - 1.6}" width="${len}" height="3.2" rx="1.2"/>`).join('');
  return `${guns}<path class="dark" d="M${x - r * dir * 0.9} ${50 - r}h${r * dir * 1.2}a${r} ${r} 0 0 ${dir > 0 ? 1 : 0} 0 ${r * 2}h${-r * dir * 1.2}z"/>`;
};

/** Western Approaches style panels: diagonal light/dark slabs across the hull. */
const camo = (L, seed) => {
  const cuts = [];
  for (let x = seed; x < L; x += 110) cuts.push(`<path class="cam2" d="M${x} 0L${x + 46} 0L${x + 6} 100L${x - 40} 100Z"/>`);
  for (let x = seed + 55; x < L; x += 110) cuts.push(`<path class="cam1" d="M${x} 0L${x + 22} 0L${x - 12} 100L${x - 34} 100Z"/>`);
  return cuts.join('');
};

const plane = (x, y) =>
  `<path class="plane" d="M${x - 9} ${y}h18M${x} ${y - 13}v26M${x - 7} ${y - 13}h14M${x - 5} ${y + 11}h10" />`;

const RN_DRAW = {
  carrier: (L, id) => `
    <path class="hull" d="${rnHull(L, 25, 80)}"/>
    <g clip-path="url(#${id})">${camo(L, 30)}</g>
    <path class="deck" d="M22 27H${L - 70}C${L - 50} 27 ${L - 34} 40 ${L - 30} 50C${L - 34} 60 ${L - 50} 73 ${L - 70} 73H22Z"/>
    <path class="mark" d="M40 50H${L - 60}" stroke-dasharray="16 12"/>
    <rect class="lift" x="96" y="40" width="22" height="20"/><rect class="lift" x="${L - 160}" y="40" width="22" height="20"/>
    ${plane(150, 50)}${plane(185, 41)}${plane(185, 59)}
    <rect class="dark" x="276" y="60" width="74" height="12" rx="3"/><ellipse class="funnel" cx="322" cy="66" rx="11" ry="5"/><rect class="bridge" x="290" y="62" width="14" height="8" rx="1.5"/>`,
  dreadnought: (L, id) => `
    <path class="hull" d="${rnHull(L, 27, 90)}"/>
    <g clip-path="url(#${id})">${camo(L, 20)}</g>
    <path class="wood" d="M24 33H${L - 96}C${L - 60} 33 ${L - 40} 42 ${L - 28} 50C${L - 40} 58 ${L - 60} 67 ${L - 96} 67H24Z"/>
    ${rnTurret(96, -1)}${rnTurret(136, -1)}
    <rect class="dark" x="168" y="36" width="92" height="28" rx="5"/>
    <ellipse class="funnel" cx="198" cy="50" rx="15" ry="9"/>
    <rect class="bridge" x="234" y="40" width="22" height="20" rx="3"/>
    ${rnTurret(286, 1)}${rnTurret(330, 1)}`,
  cruiser: (L, id) => `
    <path class="hull" d="${rnHull(L, 23, 70)}"/>
    <g clip-path="url(#${id})">${camo(L, 0)}</g>
    ${rnTurret(52, -1, 3, 10, 22)}${rnTurret(84, -1, 3, 10, 22)}
    <rect class="dark" x="104" y="38" width="76" height="24" rx="4"/>
    <ellipse class="funnel" cx="122" cy="50" rx="10" ry="7"/><ellipse class="funnel" cx="152" cy="50" rx="10" ry="7"/>
    <rect class="bridge" x="168" y="41" width="16" height="18" rx="2"/>
    ${rnTurret(206, 1, 3, 10, 22)}${rnTurret(236, 1, 3, 10, 22)}`,
  submarine: (L, id) => `
    <path class="hull sub" d="${subHull(L)}"/>
    <g clip-path="url(#${id})"><path class="cam2" d="M0 50H${L}V64H0Z" opacity=".5"/></g>
    <path class="mark" d="M40 50H118M196 50H${L - 40}"/>
    <path class="dark" d="M128 43H176C184 43 188 47 188 50C188 53 184 57 176 57H128C122 57 120 53 120 50C120 47 122 43 128 43Z"/>
    <rect class="gun" x="200" y="48.4" width="20" height="3.2" rx="1.2"/><circle class="dark" cx="200" cy="50" r="6"/>`,
  corvette: (L, id) => `
    <path class="hull" d="${rnHull(L, 25, 60)}"/>
    <g clip-path="url(#${id})">${camo(L, -10)}</g>
    <path class="deck" d="M${L - 64} 30C${L - 36} 31 ${L - 18} 40 ${L - 10} 50C${L - 18} 60 ${L - 36} 69 ${L - 64} 70Z"/>
    <rect class="dark" x="80" y="37" width="46" height="26" rx="4"/>
    <ellipse class="funnel" cx="94" cy="50" rx="10" ry="8"/>
    <rect class="bridge" x="112" y="40" width="14" height="20" rx="2"/>
    ${rnTurret(L - 50, 1, 1, 8, 20)}
    <path class="mark" d="M16 40H40M16 60H40"/>`,
};

// ───────── Age of sail, 1805 ─────────
// Seen from above: a black hull with the painted bands of the period showing
// along the rails (ochre for Nelson's ships, red for the French), planked deck,
// masts with their yards and sails, and a bowsprit.
const sailHull = (L, b) =>
  `M14 ${50 - b * 0.8}C22 ${50 - b} 40 ${50 - b} 60 ${50 - b}L${L - 90} ${50 - b}C${L - 50} ${50 - b} ${L - 28} ${50 - b * 0.5} ${L - 18} 50`
  + `C${L - 28} ${50 + b * 0.5} ${L - 50} ${50 + b} ${L - 90} ${50 + b}L60 ${50 + b}C40 ${50 + b} 22 ${50 + b} 14 ${50 + b * 0.8}Z`;
const square = (x, b) => `<path class="sail" d="M${x - 14} ${50 - b - 9}Q${x} 50 ${x - 14} ${50 + b + 9}L${x + 8} ${50 + b + 9}Q${x + 24} 50 ${x + 8} ${50 - b - 9}Z"/>`
  + `<path class="yard" d="M${x - 14} ${50 - b - 11}V${50 + b + 11}"/>`
  + `<circle class="mast" cx="${x - 10}" cy="50" r="4.5"/>`;
const foreAft = (x, len) => `<path class="sail" d="M${x} 50L${x - len} 44Q${x - len * 0.55} 30 ${x} 40Z"/><path class="yard" d="M${x} 50L${x - len} 44"/><circle class="mast" cx="${x}" cy="50" r="4"/>`;
const sailShip = (L, b, masts, rig = 'square') => `
    <path class="bowsprit" d="M${L - 30} 50H${L - 2}"/><path class="jib" d="M${L - 4} 50L${L - 42} 44L${L - 46} 50Z"/>
    <path class="hull" d="${sailHull(L, b)}"/>
    <path class="band" d="${sailHull(L, b - 3)}"/>
    <path class="wood" d="${sailHull(L, b - 7)}"/>
    <path class="mark seams" d="M40 50H${L - 70}M40 ${50 - b * 0.45}H${L - 80}M40 ${50 + b * 0.45}H${L - 80}"/>
    <rect class="dark" x="26" y="${50 - b * 0.45}" width="22" height="${b * 0.9}" rx="3"/>
    <circle class="dark" cx="${L * 0.62}" cy="50" r="5"/>
    ${masts.map((f) => (rig === 'square' ? square(L * f, b) : foreAft(L * f, L * 0.22))).join('')}`;
const SAIL_DRAW = {
  carrier: (L) => sailShip(L, 27, [0.24, 0.5, 0.74]),
  dreadnought: (L) => sailShip(L, 26, [0.24, 0.5, 0.74]),
  cruiser: (L) => sailShip(L, 21, [0.24, 0.5, 0.74]),
  submarine: (L) => sailShip(L, 21, [0.24, 0.5, 0.74]),
  corvette: (L, side) => (side === 'gb' ? sailShip(L, 17, [0.42, 0.72], 'fore') : sailShip(L, 18, [0.4, 0.7])),
};
const SAIL_HULL = { carrier: 27, dreadnought: 26, cruiser: 21, submarine: 21, corvette: 18 };

// ───────── Kriegsmarine, 1939–45 ─────────
// Bismarck sailed in May 1941 in Baltic camouflage: black and white bands
// fore and aft and a false bow wave. The others wear plain fleet grey.
const baltic = (L) => [0.08, 0.17, 0.78, 0.87].map((f, i) =>
  `<path class="${i % 2 ? 'cam1' : 'cam2'}" d="M${L * f} 0L${L * f + 34} 0L${L * f + 14} 100L${L * f - 20} 100Z"/>`).join('');
const DE_DRAW = {
  carrier: (L, id) => `
    <path class="hull" d="${rnHull(L, 27, 95)}"/>
    <g clip-path="url(#${id})">${baltic(L)}</g>
    <path class="wood" d="M26 34H${L - 104}C${L - 66} 34 ${L - 44} 43 ${L - 30} 50C${L - 44} 57 ${L - 66} 66 ${L - 104} 66H26Z"/>
    ${rnTurret(110, -1)}${rnTurret(152, -1)}
    <rect class="dark" x="186" y="35" width="128" height="30" rx="6"/>
    <circle class="dark" cx="216" cy="34" r="6"/><circle class="dark" cx="216" cy="66" r="6"/><circle class="dark" cx="290" cy="34" r="6"/><circle class="dark" cx="290" cy="66" r="6"/>
    <ellipse class="funnel" cx="250" cy="50" rx="17" ry="10"/>
    <rect class="bridge" x="290" y="41" width="22" height="18" rx="3"/>
    ${rnTurret(350, 1)}${rnTurret(394, 1)}`,
  dreadnought: (L, id) => `
    <path class="hull" d="${rnHull(L, 25, 90)}"/>
    <path class="wood" d="M26 35H${L - 98}C${L - 62} 35 ${L - 42} 43 ${L - 30} 50C${L - 42} 57 ${L - 62} 65 ${L - 98} 65H26Z"/>
    ${rnTurret(88, -1, 3, 13, 28)}
    <rect class="dark" x="124" y="37" width="122" height="26" rx="5"/>
    <ellipse class="funnel" cx="170" cy="50" rx="14" ry="8"/>
    <rect class="bridge" x="222" y="41" width="20" height="18" rx="3"/>
    ${rnTurret(282, 1, 3, 13, 28)}${rnTurret(324, 1, 3, 13, 28)}`,
  cruiser: (L) => `
    <path class="hull" d="${rnHull(L, 22, 72)}"/>
    ${rnTurret(50, -1, 2, 9, 20)}${rnTurret(78, -1, 2, 9, 20)}
    <rect class="dark" x="100" y="39" width="84" height="22" rx="4"/>
    <ellipse class="funnel" cx="136" cy="50" rx="12" ry="7"/>
    <rect class="bridge" x="166" y="42" width="16" height="16" rx="2"/>
    ${rnTurret(206, 1, 2, 9, 20)}${rnTurret(234, 1, 2, 9, 20)}`,
  submarine: (L) => `
    <path class="hull sub" d="${subHull(L)}"/>
    <path class="mark" d="M40 50H120M190 50H${L - 40}"/>
    <path class="dark" d="M132 44H170C178 44 182 47 182 50C182 53 178 56 170 56H132C126 56 124 53 124 50C124 47 126 44 132 44Z"/>
    <rect class="gun" x="196" y="48.4" width="22" height="3.2" rx="1.2"/><circle class="dark" cx="196" cy="50" r="5.5"/>`,
  corvette: (L) => `
    <path class="hull" d="${rnHull(L, 17, 70)}"/>
    <rect class="gun" x="${L - 84}" y="34" width="36" height="5" rx="2"/><rect class="gun" x="${L - 84}" y="61" width="36" height="5" rx="2"/>
    <rect class="dark" x="74" y="40" width="40" height="20" rx="4"/>
    <circle class="dark" cx="44" cy="50" r="6"/><rect class="gun" x="28" y="48.6" width="16" height="2.8"/>`,
};
const DE_HULL = { carrier: [27, 95], dreadnought: [25, 90], cruiser: [22, 72], corvette: [17, 70] };

// ───────── South Atlantic, 1982 ─────────
// Both navies in light grey. Carriers with Harriers (British, ski-jump bow) or
// Skyhawks (Argentine, straight-deck carrier with an angled landing line).
const harrier = (x, y) => `<path class="plane" d="M${x + 12} ${y}L${x - 10} ${y}M${x + 2} ${y - 9}L${x - 2} ${y}L${x + 2} ${y + 9}M${x - 10} ${y - 4}V${y + 4}"/>`;
const skyhawk = (x, y) => `<path class="plane" d="M${x + 12} ${y}L${x - 10} ${y}M${x + 6} ${y}L${x - 4} ${y - 10}M${x + 6} ${y}L${x - 4} ${y + 10}M${x - 10} ${y - 4}V${y + 4}"/>`;
const seaDart = (x, dir = 1) => `<rect class="dark" x="${x - 8}" y="42" width="16" height="16" rx="3"/><rect class="gun" x="${dir > 0 ? x : x - 18}" y="45" width="18" height="3"/><rect class="gun" x="${dir > 0 ? x : x - 18}" y="52" width="18" height="3"/>`;
const modernGun = (x) => `<path class="dark" d="M${x - 9} 42h10a8 8 0 0 1 0 16h-10z"/><rect class="gun" x="${x + 6}" y="48.5" width="20" height="3"/>`;
const heloDeck = (x, w) => `<rect class="deck" x="${x}" y="31" width="${w}" height="38" rx="3"/><circle class="mark" cx="${x + w / 2}" cy="50" r="12"/>`;
const type42 = (L) => `
    <path class="hull" d="${rnHull(L, 21, 80)}"/>
    ${heloDeck(18, 56)}
    <rect class="dark" x="82" y="37" width="96" height="26" rx="5"/>
    <ellipse class="funnel" cx="120" cy="50" rx="14" ry="9"/>
    <circle class="bridge" cx="160" cy="50" r="7"/><circle class="bridge" cx="96" cy="50" r="5"/>
    ${seaDart(204)}${modernGun(250)}`;
const MODERN_DRAW = {
  gb: {
    carrier: (L) => `
      <path class="hull" d="${rnHull(L, 25, 70)}"/>
      <path class="deck" d="M20 27H${L - 60}L${L - 24} 34V66L${L - 60} 73H20Z"/>
      <path class="ramp" d="M${L - 90} 28H${L - 60}L${L - 24} 34V66L${L - 60} 72H${L - 90}Z"/>
      <path class="mark" d="M36 50H${L - 100}" stroke-dasharray="14 10"/>
      ${harrier(120, 40)}${harrier(160, 60)}${harrier(220, 40)}
      <rect class="dark" x="240" y="60" width="96" height="13" rx="3"/><ellipse class="funnel" cx="288" cy="66" rx="12" ry="5"/>`,
    dreadnought: (L) => `
      <path class="hull" d="${rnHull(L, 24, 64)}"/>
      <path class="deck" d="M18 28H${L - 56}L${L - 22} 36V64L${L - 56} 72H18Z"/>
      <path class="ramp" d="M${L - 80} 29H${L - 56}L${L - 22} 36V58L${L - 80} 60Z"/>
      ${seaDart(L - 52)}
      <path class="mark" d="M34 46H${L - 100}" stroke-dasharray="12 9"/>
      ${harrier(100, 40)}${harrier(150, 40)}
      <rect class="dark" x="170" y="59" width="110" height="13" rx="3"/><ellipse class="funnel" cx="206" cy="65" rx="10" ry="5"/><ellipse class="funnel" cx="250" cy="65" rx="10" ry="5"/>`,
    cruiser: (L) => type42(L),
    submarine: (L) => `
      <path class="hull sub" d="M6 50C10 40 40 37 80 37L${L - 50} 38C${L - 22} 40 ${L - 6} 46 ${L - 3} 50C${L - 6} 54 ${L - 22} 60 ${L - 50} 62L80 63C40 63 10 60 6 50Z"/>
      <path class="dark" d="M${L - 120} 45H${L - 84}C${L - 78} 45 ${L - 76} 48 ${L - 76} 50C${L - 76} 52 ${L - 78} 55 ${L - 84} 55H${L - 120}C${L - 124} 55 ${L - 126} 52 ${L - 126} 50C${L - 126} 48 ${L - 124} 45 ${L - 120} 45Z"/>
      <path class="dark" d="M14 50L4 40M14 50L4 60"/>`,
    corvette: (L) => `
      <path class="hull" d="${rnHull(L, 20, 60)}"/>
      ${heloDeck(14, 40)}
      <rect class="dark" x="60" y="38" width="56" height="24" rx="4"/><ellipse class="funnel" cx="84" cy="50" rx="9" ry="7"/>
      <rect class="gun" x="122" y="38" width="16" height="6"/><rect class="gun" x="122" y="56" width="16" height="6"/>
      ${modernGun(160)}`,
  },
  ar: {
    carrier: (L) => `
      <path class="hull" d="${rnHull(L, 25, 80)}"/>
      <path class="deck" d="M20 27H${L - 70}C${L - 50} 27 ${L - 36} 40 ${L - 32} 50C${L - 36} 60 ${L - 50} 73 ${L - 70} 73H20Z"/>
      <path class="mark" d="M30 62L${L - 170} 34" stroke-dasharray="14 10"/>
      <path class="mark" d="M${L - 150} 50H${L - 60}"/>
      ${skyhawk(110, 40)}${skyhawk(150, 58)}${skyhawk(L - 90, 44)}
      <rect class="dark" x="250" y="60" width="78" height="13" rx="3"/><ellipse class="funnel" cx="296" cy="66" rx="11" ry="5"/>`,
    dreadnought: (L) => `
      <path class="hull" d="${rnHull(L, 25, 86)}"/>
      ${rnTurret(70, -1, 3, 12, 26)}${rnTurret(108, -1, 3, 12, 26)}
      <rect class="dark" x="142" y="37" width="98" height="26" rx="5"/>
      <ellipse class="funnel" cx="168" cy="50" rx="11" ry="8"/><ellipse class="funnel" cx="204" cy="50" rx="11" ry="8"/>
      <rect class="bridge" x="222" y="41" width="16" height="18" rx="2"/>
      ${rnTurret(268, 1, 3, 12, 26)}${rnTurret(302, 1, 3, 12, 26)}${rnTurret(336, 1, 3, 12, 26)}`,
    cruiser: (L) => type42(L),
    submarine: (L) => `
      <path class="hull sub" d="${subHull(L)}"/>
      <path class="mark" d="M40 50H118M196 50H${L - 40}"/>
      <path class="dark" d="M128 44H174C182 44 186 47 186 50C186 53 182 56 174 56H128C122 56 120 53 120 50C120 47 122 44 128 44Z"/>`,
    corvette: (L) => `
      <path class="hull" d="${rnHull(L, 19, 58)}"/>
      <rect class="gun" x="22" y="40" width="22" height="7"/><rect class="gun" x="22" y="53" width="22" height="7"/>
      <rect class="dark" x="60" y="38" width="54" height="24" rx="4"/><ellipse class="funnel" cx="80" cy="50" rx="9" ry="7"/>
      ${modernGun(150)}`,
  },
};

const RN_HULL = { carrier: [25, 80], dreadnought: [27, 90], cruiser: [23, 70], corvette: [25, 60] };

/**
 * Draw ship `id`. `art` is 'sonar' or a side and era such as 'gb1805',
 * 'fr1805', 'gb1940', 'de1940', 'gb1982' or 'ar1982' ('rn' = 'gb1940').
 */
export function shipSVG(id, horiz = true, art = 'sonar') {
  const spec = FLEET.find((s) => s.id === id);
  const L = spec.len * 100;
  if (art === 'rn') art = 'gb1940';
  const side = art.slice(0, 2);
  const era = art.slice(2);
  let body;
  const clip = `shipclip${++clipSeq}`;
  const clipped = (hullPath, inner) => `<defs><clipPath id="${clip}"><path d="${hullPath}"/></clipPath></defs><g class="rn ${art}">${inner}</g>`;
  if (era === '1805') {
    body = clipped(sailHull(L, SAIL_HULL[id]), SAIL_DRAW[id](L, side));
  } else if (era === '1940' && side === 'de') {
    const [b, bow] = DE_HULL[id] || [14, 60];
    body = clipped(id === 'submarine' ? subHull(L) : rnHull(L, b, bow), DE_DRAW[id](L, clip));
  } else if (era === '1940') {
    const [b, bow] = RN_HULL[id] || [14, 60];
    body = clipped(id === 'submarine' ? subHull(L) : rnHull(L, b, bow), RN_DRAW[id](L, clip));
  } else if (era === '1982') {
    body = clipped(subHull(L), MODERN_DRAW[side === 'ar' ? 'ar' : 'gb'][id](L));
  } else {
    body = DRAW[id](L);
  }
  return horiz
    ? `<svg viewBox="0 0 ${L} 100" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`
    : `<svg viewBox="0 0 100 ${L}" preserveAspectRatio="none" aria-hidden="true"><g transform="translate(100 0) rotate(90)">${body}</g></svg>`;
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
  sonar: icon('M12 12L19 5', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5" opacity=".6"/>'),
  back: icon('M15 5l-7 7 7 7'),
  close: icon('M6 6l12 12M18 6L6 18'),
  gear: icon('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1', '<circle cx="12" cy="12" r="3.5"/>'),
  chart: icon('M5 20V11M12 20V4M19 20v-6'),
  help: icon('M9.2 9a3 3 0 1 1 4.6 2.5c-1 .7-1.8 1.3-1.8 2.7M12 18h.01', '<circle cx="12" cy="12" r="9.5"/>'),
  shuffle: icon('M3 7h3c5 0 6 10 11 10h4M3 17h3c1.6 0 2.8-1 3.9-2.4M14.2 9.2C15 8 16 7 17 7h4M18 4l3 3-3 3M18 14l3 3-3 3'),
  clear: icon('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'),
};

// ───────── Flags and emblem for the Royal Navy theme ─────────
let flagSeq = 0;

/**
 * The Union Flag, drawn to its official 1:2 construction: the red saltire is
 * counterchanged (offset clockwise) within the white one. `fit` is an SVG
 * preserveAspectRatio value; 'xMidYMid slice' fills a backdrop without distortion.
 */
export function unionJack(fit = 'xMidYMid meet', cls = '') {
  const n = ++flagSeq;
  return `<svg class="${cls}" viewBox="0 0 60 30" preserveAspectRatio="${fit}" aria-hidden="true">
  <clipPath id="ujs${n}"><path d="M0 0v30h60V0z"/></clipPath>
  <clipPath id="ujt${n}"><path d="M30 15H60V30ZM30 15V30H0ZM30 15H0V0ZM30 15V0H60Z"/></clipPath>
  <g clip-path="url(#ujs${n})">
    <path d="M0 0v30h60V0z" fill="#012169"/>
    <path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/>
    <path d="M0 0l60 30m0-30L0 30" clip-path="url(#ujt${n})" stroke="#C8102E" stroke-width="4"/>
    <path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/>
    <path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/>
  </g></svg>`;
}

/** The White Ensign: St George's cross with the Union Flag in the canton. */
export function whiteEnsign(cls = '') {
  const n = ++flagSeq;
  return `<svg class="${cls}" viewBox="0 0 120 60" aria-hidden="true">
  <rect width="120" height="60" fill="#fff"/>
  <path d="M0 30h120M60 0v60" stroke="#C8102E" stroke-width="12"/>
  <clipPath id="wec${n}"><rect width="60" height="30"/></clipPath>
  <g clip-path="url(#wec${n})"><svg width="60" height="30" viewBox="0 0 60 30">${unionJack().replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg></g>
  <rect x=".5" y=".5" width="119" height="59" fill="none" stroke="rgba(0,0,0,.18)"/>
  </svg>`;
}

/** Fouled anchor in a rope roundel. Uses currentColor. */
export const RN_EMBLEM = `
<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
  <circle cx="60" cy="60" r="55" stroke="currentColor" stroke-width="3"/>
  <circle cx="60" cy="60" r="48" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3.5 3"/>
  <circle cx="60" cy="28" r="6" stroke="currentColor" stroke-width="4"/>
  <path d="M60 34v58M44 44h32" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  <path d="M30 70c4 16 16 24 30 24s26-8 30-24" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
  <path d="M24 74l8-10 6 11zM96 74l-8-10-6 11z" fill="currentColor"/>
  <path d="M66 26c18 4 22 22 8 32-12 9-30 6-34 20-3 10 6 16 14 13" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>
</svg>`;

/** French tricolour, as flown by the Marine Impériale (2:3). */
export function tricolore(fit = 'xMidYMid meet', cls = '') {
  return `<svg class="${cls}" viewBox="0 0 90 60" preserveAspectRatio="${fit}" aria-hidden="true">
  <rect width="30" height="60" fill="#002f6c"/><rect x="30" width="30" height="60" fill="#fff"/><rect x="60" width="30" height="60" fill="#c8102e"/></svg>`;
}

/** Argentine flag with the Sun of May (9:14). */
export function argentina(fit = 'xMidYMid meet', cls = '') {
  const rays = Array.from({ length: 32 }, (_, i) => {
    const a = (i * Math.PI) / 16;
    const r0 = 6.2;
    const r1 = i % 2 ? 10.2 : 11.6;
    return `M${(70 + Math.cos(a) * r0).toFixed(2)} ${(45 + Math.sin(a) * r0).toFixed(2)}L${(70 + Math.cos(a) * r1).toFixed(2)} ${(45 + Math.sin(a) * r1).toFixed(2)}`;
  }).join('');
  return `<svg class="${cls}" viewBox="0 0 140 90" preserveAspectRatio="${fit}" aria-hidden="true">
  <rect width="140" height="90" fill="#fff"/><rect width="140" height="30" fill="#74acdf"/><rect y="60" width="140" height="30" fill="#74acdf"/>
  <path d="${rays}" stroke="#f6b40e" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="70" cy="45" r="6.4" fill="#f6b40e" stroke="#85340a" stroke-width=".6"/></svg>`;
}

/**
 * The Balkenkreuz, the straight-armed cross that marked German ships, aircraft
 * and vehicles. Used for the Kriegsmarine instead of the swastika war ensign.
 */
export function balkenkreuz(fit = 'xMidYMid meet', cls = '', field = true) {
  return `<svg class="${cls}" viewBox="0 0 90 60" preserveAspectRatio="${fit}" aria-hidden="true">
  ${field ? '<rect width="90" height="60" fill="#5a6166"/>' : ''}
  <path d="M38 10h14v13h13v14H52v13H38V37H25V23h13z" fill="#fff"/>
  <path d="M40.5 12.5h9v13h13v9h-13v13h-9v-13h-13v-9h13z" fill="#111"/></svg>`;
}

/** The flag that represents a side: on the title screen and the fleet panels. */
export function sideFlag(side, fit = 'xMidYMid meet', cls = '') {
  if (side === 'fr') return tricolore(fit, cls);
  if (side === 'ar') return argentina(fit, cls);
  if (side === 'de') return balkenkreuz(fit, cls);
  return unionJack(fit, cls);
}
/** The small flag beside a fleet's name (the White Ensign for the Royal Navy). */
export const sideEnsign = (side) => (side === 'gb' ? whiteEnsign() : sideFlag(side));
