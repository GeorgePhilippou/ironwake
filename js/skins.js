// Ironwake — presentation themes. The rules never change; a theme only renames
// things, redraws them and changes the words used to describe them.
//
//   sonar    — the original modern sonar console
//   history  — three real naval wars of the Royal Navy. Each player commands
//              one side, with ships that actually served in that war.
//
// Historical notes are kept beside the data so the roster can be checked.
// Germany is shown with the Balkenkreuz, the cross that marked German forces,
// rather than the swastika war ensign of 1935–45.

import { FLEET } from './engine.js';

export const SKINS = ['sonar', 'history'];

export const ERAS = {
  1805: {
    id: '1805',
    title: 'Trafalgar',
    years: '1805',
    tagline: 'Trafalgar · 21 October 1805',
    blurb: 'Nelson against the Franco-Spanish fleet off Cape Trafalgar.',
    sides: ['gb', 'fr'],
  },
  1940: {
    id: '1940',
    title: 'Second World War',
    years: '1939–45',
    tagline: 'The Battle of the Atlantic · 1939–1945',
    blurb: 'The Home Fleet against the Kriegsmarine’s raiders and U-boats.',
    sides: ['gb', 'de'],
  },
  1982: {
    id: '1982',
    title: 'Falklands',
    years: '1982',
    tagline: 'South Atlantic · 1982',
    blurb: 'The British task force against the Armada Argentina.',
    sides: ['gb', 'ar'],
  },
};
export const ERA_IDS = Object.keys(ERAS);

// Ships per side, in FLEET order: 5, 4, 3, 3, 2 squares. Every ship served in
// that war; longer slots hold the larger ships.
const SIDES = {
  1805: {
    // All present at Trafalgar, 21 October 1805.
    gb: {
      name: 'Royal Navy', short: 'British', rank: 'Captain', flag: 'union', ensign: 'white',
      ships: [
        ['HMS Victory', 'First-rate, 104 guns · Nelson’s flagship'],
        ['HMS Temeraire', 'Second-rate, 98 guns'],
        ['HMS Euryalus', 'Frigate, 36 guns'],
        ['HMS Naiad', 'Frigate, 38 guns'],
        ['HMS Pickle', 'Schooner · carried the news home'],
      ],
    },
    fr: {
      name: 'Marine Impériale', short: 'French', rank: 'Capitaine', flag: 'tricolore', ensign: 'tricolore',
      ships: [
        ['Bucentaure', '80 guns · Villeneuve’s flagship'],
        ['Redoutable', '74 guns'],
        ['Hermione', 'Frigate'],
        ['Hortense', 'Frigate'],
        ['Argus', 'Brig'],
      ],
    },
  },
  1940: {
    gb: {
      name: 'Royal Navy', short: 'British', rank: 'Captain', flag: 'union', ensign: 'white',
      ships: [
        ['HMS Ark Royal', 'Aircraft carrier'],
        ['HMS Warspite', 'Battleship'],
        ['HMS Belfast', 'Light cruiser'],
        ['HMS Upholder', 'U-class submarine'],
        ['HMS Gladiolus', 'Flower-class corvette'],
      ],
    },
    de: {
      // Germany commissioned no aircraft carrier, so its two battleships lead.
      name: 'Kriegsmarine', short: 'German', rank: 'Kapitän', flag: 'balkenkreuz', ensign: 'balkenkreuz',
      ships: [
        ['Bismarck', 'Battleship'],
        ['Scharnhorst', 'Battleship'],
        ['Prinz Eugen', 'Heavy cruiser'],
        ['U-47', 'Type VIIB U-boat'],
        ['S-38', 'Schnellboot'],
      ],
    },
  },
  1982: {
    gb: {
      name: 'Royal Navy', short: 'British', rank: 'Captain', flag: 'union', ensign: 'white',
      ships: [
        ['HMS Hermes', 'Aircraft carrier · task force flagship'],
        ['HMS Invincible', 'Aircraft carrier'],
        ['HMS Sheffield', 'Type 42 destroyer'],
        ['HMS Conqueror', 'Nuclear submarine'],
        ['HMS Ardent', 'Type 21 frigate'],
      ],
    },
    ar: {
      name: 'Armada Argentina', short: 'Argentine', rank: 'Capitán', flag: 'argentina', ensign: 'argentina',
      ships: [
        ['ARA 25 de Mayo', 'Aircraft carrier'],
        ['ARA General Belgrano', 'Cruiser'],
        ['ARA Hércules', 'Type 42 destroyer'],
        ['ARA Santa Fe', 'Submarine'],
        ['ARA Guerrico', 'A69 corvette'],
      ],
    },
  },
};

const TEXT = {
  sonar: {
    tagline: 'Find the fleet · Sink the fleet',
    deployTitle: 'Deploy your fleet',
    deployButton: 'Deploy fleet',
    battleStations: 'Battle stations',
    yourTurn: 'Your turn',
    choose: 'Choose a square to fire on',
    fireAgain: 'Fire again',
    enemyTurn: 'Enemy turn',
    incoming: 'Incoming fire…',
    theirTurn: 'Their turn',
    miss: 'Miss',
    hit: 'Hit',
    theyMissed: 'They missed',
    victory: 'Victory',
    defeat: 'Defeat',
    fleetDeployed: 'Fleet deployed',
    yourFleet: 'Your fleet',
    enemyFleet: 'Enemy fleet',
    passTo: (device) => `Pass the ${device} to`,
    afloat: 'AFLOAT',
    sunk: 'SUNK',
  },
  1805: {
    deployTitle: 'Form the line of battle',
    deployButton: 'Make sail',
    battleStations: 'Clear for action!',
    yourTurn: (rank) => `Your broadside, ${rank}`,
    choose: 'Choose your mark and fire as she bears',
    fireAgain: 'Reload and fire again',
    enemyTurn: 'Enemy broadside',
    incoming: 'Round shot incoming!',
    theirTurn: 'Enemy broadside',
    miss: 'Wide of the mark',
    hit: 'A hit!',
    theyMissed: 'Wide of us',
    victory: 'A famous victory',
    defeat: 'Colours struck',
    fleetDeployed: 'Line of battle formed',
    passTo: (device) => `Sealed orders · hand the ${device} to`,
    sunk: 'SUNK',
  },
  1940: {
    deployTitle: 'Muster the fleet',
    deployButton: 'Put to sea',
    battleStations: 'Action stations!',
    yourTurn: (rank) => `Your shot, ${rank}`,
    choose: 'Mark the chart and give the order to fire',
    fireAgain: 'Fire again — keep at them',
    enemyTurn: 'Enemy salvo',
    incoming: 'Shells incoming — brace!',
    theirTurn: 'Enemy salvo',
    miss: 'Splash',
    hit: 'Direct hit!',
    theyMissed: 'Near miss',
    victory: 'Victory at sea',
    defeat: 'Fleet lost',
    fleetDeployed: 'Fleet at sea',
    passTo: (device) => `Most secret · hand the ${device} to`,
  },
  1982: {
    deployTitle: 'Deploy the task group',
    deployButton: 'Sail',
    battleStations: 'Action stations!',
    yourTurn: (rank) => `Weapons free, ${rank}`,
    choose: 'Designate a target and fire',
    fireAgain: 'Target again',
    enemyTurn: 'Incoming',
    incoming: 'Air and missile threat — brace!',
    theirTurn: 'Incoming',
    miss: 'Miss',
    hit: 'Hit confirmed',
    theyMissed: 'They missed',
    victory: 'Victory',
    defeat: 'Task group lost',
    fleetDeployed: 'Task group at sea',
    passTo: (device) => `Restricted · hand the ${device} to`,
  },
};

// ───────── Current context ─────────
let current = { skin: 'sonar', era: '1940', mine: 'gb', theirs: 'de' };

export const otherSide = (era, side) => (ERAS[era] ? ERAS[era].sides.find((s) => s !== side) : 'de');
export const validEra = (era) => (ERAS[era] ? String(era) : '1940');
export const validSide = (era, side) => (ERAS[validEra(era)].sides.includes(side) ? side : ERAS[validEra(era)].sides[0]);

/** Who is looking at the screen: their era and which side they command. */
export function setContext({ skin, era, mine, theirs }) {
  const s = SKINS.includes(skin) ? skin : 'sonar';
  const e = validEra(era ?? current.era);
  const m = validSide(e, mine ?? current.mine);
  current = { skin: s, era: e, mine: m, theirs: theirs && ERAS[e].sides.includes(theirs) && theirs !== m ? theirs : otherSide(e, m) };
}
export const skin = () => current.skin;
export const era = () => current.era;
export const mySide = () => current.mine;
export const theirSide = () => current.theirs;
export const historical = () => current.skin === 'history';
export const sideInfo = (side, e = current.era) => SIDES[validEra(e)][side];
/** Art key for a side's ships, e.g. 'gb1805'. 'sonar' outside the historical theme. */
export const artFor = (side) => (historical() ? `${side}${current.era}` : 'sonar');
export const myArt = () => artFor(current.mine);
export const theirArt = () => artFor(current.theirs);

export const t = (key, ...args) => {
  const table = historical() ? TEXT[current.era] : TEXT.sonar;
  let v = table[key] ?? TEXT.sonar[key];
  if (historical()) {
    if (key === 'tagline') v = ERAS[current.era].tagline;
    if (key === 'yourFleet') v = sideInfo(current.mine).name;
    if (key === 'enemyFleet') v = sideInfo(current.theirs).name;
  }
  if (typeof v !== 'function') return v;
  return key === 'yourTurn' ? v(historical() ? sideInfo(current.mine).rank : 'Captain') : v(...args);
};

const base = (id) => (FLEET.find((s) => s.id === id) || { name: id }).name;
const slot = (id) => FLEET.findIndex((s) => s.id === id);
const shipOf = (side, id) => {
  const row = sideInfo(side) && sideInfo(side).ships[slot(id)];
  return row || [base(id), ''];
};

/** Name of one of the viewer's own ships. */
export const ownShip = (id) => (historical() ? shipOf(current.mine, id)[0] : base(id));
/** What one of the viewer's own ships is ('First-rate, 104 guns'), or ''. */
export const ownType = (id) => (historical() ? shipOf(current.mine, id)[1] : '');
/** Name of an enemy ship. */
export const enemyShip = (id) => (historical() ? shipOf(current.theirs, id)[0] : base(id));
