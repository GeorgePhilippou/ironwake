// Ironwake — persistence. Everything lives in localStorage on this device;
// every read is defensive so a corrupt or missing value can never stop the app.

import { LEVELS } from './ai.js';
import { reviveGame } from './game.js';
import { reviveOnline } from './online.js';

const KEYS = { settings: 'ironwake.settings.v1', stats: 'ironwake.stats.v1', game: 'ironwake.game.v1' };

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export const DEFAULT_SETTINGS = {
  sound: true,
  haptics: true,
  reducedMotion: null, // null = follow the system setting
  difficulty: 'normal',
  theme: 'auto', // auto | dark | light
};

export function loadSettings() {
  const raw = read(KEYS.settings) || {};
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw.sound === 'boolean') s.sound = raw.sound;
  if (typeof raw.haptics === 'boolean') s.haptics = raw.haptics;
  if (typeof raw.reducedMotion === 'boolean') s.reducedMotion = raw.reducedMotion;
  if (LEVELS.includes(raw.difficulty)) s.difficulty = raw.difficulty;
  if (['auto', 'dark', 'light'].includes(raw.theme)) s.theme = raw.theme;
  return s;
}
export const saveSettings = (s) => write(KEYS.settings, s);

const blankLevel = () => ({ played: 0, won: 0, shots: 0, hits: 0, bestShots: null, bestMs: null });
export const blankStats = () => ({
  solo: { easy: blankLevel(), normal: blankLevel(), hard: blankLevel() },
  duo: { played: 0 },
  online: { played: 0, won: 0 },
  streak: 0,
  bestStreak: 0,
});

const num = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);

export function loadStats() {
  const raw = read(KEYS.stats) || {};
  const s = blankStats();
  for (const lv of LEVELS) {
    const r = (raw.solo && raw.solo[lv]) || {};
    const t = s.solo[lv];
    t.played = num(r.played);
    t.won = Math.min(num(r.won), t.played);
    t.shots = num(r.shots);
    t.hits = Math.min(num(r.hits), t.shots);
    t.bestShots = Number.isFinite(r.bestShots) && r.bestShots >= 17 ? r.bestShots : null;
    t.bestMs = Number.isFinite(r.bestMs) && r.bestMs > 0 ? r.bestMs : null;
  }
  s.duo.played = num(raw.duo && raw.duo.played);
  s.online.played = num(raw.online && raw.online.played);
  s.online.won = Math.min(num(raw.online && raw.online.won), s.online.played);
  s.streak = num(raw.streak);
  s.bestStreak = Math.max(num(raw.bestStreak), s.streak);
  return s;
}
export const saveStats = (s) => write(KEYS.stats, s);

/**
 * Fold a finished solo game into lifetime stats.
 * Returns which personal bests it set, for the result screen.
 */
export function recordSolo(stats, { difficulty, won, shots, hits, ms }) {
  const t = stats.solo[difficulty];
  const best = { shots: false, time: false };
  t.played++;
  t.shots += shots;
  t.hits += hits;
  if (won) {
    t.won++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    if (t.bestShots === null || shots < t.bestShots) { best.shots = t.bestShots !== null; t.bestShots = shots; }
    if (ms > 0 && (t.bestMs === null || ms < t.bestMs)) { best.time = t.bestMs !== null; t.bestMs = ms; }
  } else {
    stats.streak = 0;
  }
  return best;
}

export function loadGame() {
  let raw = null;
  try { raw = localStorage.getItem(KEYS.game); } catch { return null; }
  if (!raw) return null;
  let mode = null;
  try { mode = JSON.parse(raw).mode; } catch { /* corrupt */ }
  const game = mode === 'online' ? reviveOnline(raw) : reviveGame(raw);
  if (!game) clearGame();
  return game;
}
export const saveGame = (g) => write(KEYS.game, g);
export function clearGame() {
  try { localStorage.removeItem(KEYS.game); } catch { /* ignore */ }
}
