import { Game, endlessRiver } from './game.js';
import { createRng } from './rng.js';
import { createMarket } from './market.js';
import { createPort } from './port.js';
import { levelById } from '../config.js';
import { River } from './river.js';

// Spielstand: reine Umwandlung Game <-> JSON-Text (kein DOM, kein Speicher). Gespeichert wird der Management-Zustand (Geld, Zeit, Upgrades,
// Markt, Schiffe, Aufträge ...) und die Flusssohle. Abgeleitetes (Fahrrinnen, Pfade, Nachrutschen) wird nach dem Laden neu berechnet.
// Die laufende Pontonfahrt wird nicht gespeichert: nach dem Laden steht der Ponton wieder auf der Karte.
export const SAVE_VERSION = 6;

const SKIP = new Set(['rng', 'notes', 'flash', '_stats']);
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

const packRiver = (river) => {
  const out = {};
  for (const [k, v] of Object.entries(river)) {
    if (k === 'pending' || k === 'centerY' || k === 'halfW') continue;
    out[k] = ArrayBuffer.isView(v) ? { type: v.constructor.name, b64: toB64(v) } : v;
  }
  return out;
};

export function serializeGame(game) {
  const data = {};
  for (const [k, v] of Object.entries(game)) if (!SKIP.has(k)) data[k] = v;
  data.maps = game.maps.map(({ river, fair, site, ...rest }) => rest); // Flussbett je Karte separat (Typed Arrays)
  const rivers = game.maps.map((m) => packRiver(m.river));
  return JSON.stringify({ version: SAVE_VERSION, rng: game.rng.getState(), data, rivers }, (k, v) => (k === 'path' || k === 'sim' ? undefined : v));
}

// Gibt ein Game zurück oder null, wenn der Text kaputt oder von einer anderen Version ist.
export function restoreGame(text) {
  try {
    const s = JSON.parse(text);
    if (s?.version !== SAVE_VERSION && s?.version !== 5) return null;
    if (s.version === 5) { // Spielstand vor den Mehrkarten-Spielen: alles gehört zu Karte 1
      const d = s.data, m = { id: 0, name: 'Karte 1', seed: d.seed, difficulty: 0 };
      for (const k of ['traffic', 'fleet', 'zones', 'zoneSeq', 'unlocked', 'fairSig', 'fairClock', 'sedClock', 'rejectedBy']) { m[k] = d[k]; delete d[k]; }
      d.maps = [m]; d.mapIdx = 0; s.rivers = [s.river];
    }
    const topPort = s.data.port, topMarket = s.data.market; delete s.data.port; delete s.data.market; // ältere Stände: Hafen und Markt gehörten dem ganzen Spiel (jetzt je Karte)
    const game = new Game(s.data.seed, s.data.levelId);
    const fresh = game.maps[0].river; // gleicher Seed: liefert die Anzeige-Hilfen (Mittellinie, Breite) der ersten Karte
    Object.assign(game, s.data);
    game._stats = null;
    game.notes = []; game.flash = []; game.mapIdx = Math.min(game.mapIdx ?? 0, game.maps.length - 1);
    const types = { Float32Array, Uint8Array };
    game.maps.forEach((m, i) => {
      const src = s.rivers[i], river = new River(src.cols, src.rows);
      for (const [k, v] of Object.entries(src)) river[k] = v && v.b64 !== undefined ? fromB64(v.b64, types[v.type]) : v;
      const ref = i === 0 ? fresh : River.generate(createRng(m.seed), game.level.endless ? endlessRiver(game.seed, i) : game.level.river);
      river.centerY = ref.centerY; river.halfW = ref.halfW;
      m.river = river; m.site = null; m.fair = null;
      m.market ??= i === 0 ? (topMarket ?? createMarket()) : createMarket(); m.port ??= i === 0 ? (topPort ?? createPort()) : createPort();
      m.fairClock = m.fairClock ?? 0; m.sedClock = m.sedClock ?? 0;
    });
    game.rng.setState(s.rng);
    const cur = game.mapIdx;
    for (let i = 0; i < game.maps.length; i++) { game.mapIdx = i; game.analyze(true); game.fairClock = 0; }
    game.mapIdx = cur;
    return game;
  } catch { return null; }
}

export const savedSummary = (text) => {
  try { const d = JSON.parse(text); return d.version === SAVE_VERSION ? { day: d.data.day, money: d.data.money, status: d.data.status, level: levelById(d.data.levelId).short } : null; } catch { return null; }
};
