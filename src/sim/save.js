import { Game } from './game.js';
import { levelById } from '../config.js';
import { River } from './river.js';

// Spielstand: reine Umwandlung Game <-> JSON-Text (kein DOM, kein Speicher). Gespeichert wird der Management-Zustand (Geld, Zeit, Upgrades,
// Markt, Schiffe, Aufträge ...) und die Flusssohle. Abgeleitetes (Fahrrinnen, Pfade, Nachrutschen) wird nach dem Laden neu berechnet.
// Die laufende Pontonfahrt wird nicht gespeichert: nach dem Laden steht der Ponton wieder auf der Karte.
export const SAVE_VERSION = 4;

const SKIP = new Set(['rng', 'river', 'notes', 'flash', 'site', 'fair', '_stats']);
const toB64 = (arr) => {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64, Type) => {
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Type(bytes.buffer);
};

export function serializeGame(game) {
  const data = {};
  for (const [k, v] of Object.entries(game)) if (!SKIP.has(k)) data[k] = v;
  const river = {};
  for (const [k, v] of Object.entries(game.river)) {
    if (k === 'pending' || k === 'centerY' || k === 'halfW') continue;
    river[k] = ArrayBuffer.isView(v) ? { type: v.constructor.name, b64: toB64(v) } : v;
  }
  return JSON.stringify({ version: SAVE_VERSION, rng: game.rng.getState(), data, river }, (k, v) => (k === 'path' || k === 'sim' ? undefined : v));
}

// Gibt ein Game zurück oder null, wenn der Text kaputt oder von einer anderen Version ist.
export function restoreGame(text) {
  try {
    const s = JSON.parse(text);
    if (s?.version !== SAVE_VERSION) return null;
    const game = new Game(s.data.seed, s.data.levelId);
    Object.assign(game, s.data);
    game._stats = null;
    game.notes = []; game.flash = []; game.site = null;
    const river = new River(s.river.cols, s.river.rows);
    const types = { Float32Array, Uint8Array };
    for (const [k, v] of Object.entries(s.river)) river[k] = v && v.b64 !== undefined ? fromB64(v.b64, types[v.type]) : v;
    // Anzeige-Hilfen (Mittellinie, Breite) stammen aus der Generierung: aus einem frisch erzeugten Fluss gleichen Seeds übernehmen
    river.centerY = game.river.centerY; river.halfW = game.river.halfW;
    game.river = river;
    game.rng.setState(s.rng);
    game.analyze(true);
    game.fairClock = 0;
    return game;
  } catch { return null; }
}

export const savedSummary = (text) => {
  try { const d = JSON.parse(text); return d.version === SAVE_VERSION ? { day: d.data.day, money: d.data.money, status: d.data.status, level: levelById(d.data.levelId).short } : null; } catch { return null; }
};
