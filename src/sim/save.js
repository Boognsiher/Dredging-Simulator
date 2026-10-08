import { Game, endlessRiver } from './game.js';
import { createRng } from './rng.js';
import { createMarket } from './market.js';
import { createPort, ensurePort } from './port.js';
import { ensureHarbor } from './harbor.js';
import { levelById } from '../config.js';
import { River } from './river.js';

// Spielstand: reine Umwandlung Game <-> JSON-Text (kein DOM, kein Speicher). Gespeichert wird der Management-Zustand (Geld, Zeit, Upgrades,
// Markt, Schiffe, Aufträge ...) und die Flusssohle. Abgeleitetes (Fahrrinnen, Pfade, Nachrutschen) wird nach dem Laden neu berechnet.
// Die laufende Pontonfahrt wird nicht gespeichert: nach dem Laden steht der Ponton wieder auf der Karte.
export const SAVE_VERSION = 7; // 7: Karte mit 36 statt 24 Zeilen (ältere Spielstände passen nicht mehr)

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
  data.maps = game.maps.map(({ river, fair, site, port, ...rest }) => ({ ...rest, port: port && { ...port, harbor: port.harbor && { ...port.harbor, river: undefined } } })); // Flussbett je Karte (und Hafenbecken) separat (Typed Arrays)
  const rivers = game.maps.map((m) => packRiver(m.river));
  const harborRivers = game.maps.map((m) => (m.port?.harbor ? packRiver(m.port.harbor.river) : null));
  return JSON.stringify({ version: SAVE_VERSION, rng: game.rng.getState(), data, rivers, harborRivers }, (k, v) => (k === 'path' || k === 'sim' ? undefined : v));
}

// Gibt ein Game zurück oder null, wenn der Text kaputt oder von einer anderen Version ist.
export function restoreGame(text) {
  try {
    const s = JSON.parse(text);
    if (s?.version !== SAVE_VERSION) return null;
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
      m.market ??= i === 0 ? (topMarket ?? createMarket()) : createMarket(); m.port ??= i === 0 ? (topPort ?? createPort()) : createPort(); ensurePort(m.port);
      m.fairClock = m.fairClock ?? 0; m.sedClock = m.sedClock ?? 0;
      const hs = s.harborRivers?.[i];
      if (hs && m.port.harbor) { const hr = new River(hs.cols, hs.rows); for (const [k, v] of Object.entries(hs)) hr[k] = v && v.b64 !== undefined ? fromB64(v.b64, types[v.type]) : v; m.port.harbor.river = hr; hr.wl = game.wl; } else if (m.port.harbor) m.port.harbor = null; // kaputter Stand: neu anlegen lassen
    });
    for (const m of game.maps) ensureHarbor(m.port, game.wl); // ältere Stände mit geöffnetem Hafen bekommen die Hafenkarte nachträglich
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
