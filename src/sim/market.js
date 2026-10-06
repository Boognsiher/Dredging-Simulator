import { CONFIG, CARGOS } from '../config.js';

// Frachtmarkt: jeder Preis schwankt um seinen Basispreis (Mean-Reversion + Zufall) und kann durch Ereignisse einen Schock bekommen.
// Hohe Preise locken mehr Schiffe dieser Fracht an (demand), der Frachtwert bestimmt deine Abgabe. Reine Daten, damit speicherbar.
const gauss = (rng) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());

export function createMarket() {
  const m = { dev: {}, history: {} };
  for (const c of CARGOS) { m.dev[c.id] = 0; m.history[c.id] = [c.base]; }
  return m;
}

export const priceOf = (m, id) => {
  const c = CARGOS.find((x) => x.id === id), K = CONFIG.market;
  return c.base * Math.min(K.maxRatio, Math.max(K.minRatio, 1 + (m.dev[id] ?? 0)));
};
export const ratioOf = (m, id) => priceOf(m, id) / CARGOS.find((x) => x.id === id).base;

// Ein Tag vergeht
export function stepMarket(m, rng) {
  const K = CONFIG.market;
  for (const c of CARGOS) {
    m.dev[c.id] += (0 - m.dev[c.id]) * K.revert + K.sigma * gauss(rng);
    m.dev[c.id] = Math.min(K.maxRatio - 1, Math.max(K.minRatio - 1, m.dev[c.id]));
    const h = m.history[c.id];
    h.push(priceOf(m, c.id));
    if (h.length > K.history) h.shift();
  }
}

// Ereignis: Preis springt (factor 1.4 = 40 % teurer)
export function shockMarket(m, id, factor) {
  m.dev[id] = Math.min(CONFIG.market.maxRatio - 1, Math.max(CONFIG.market.minRatio - 1, (1 + m.dev[id]) * factor - 1));
}

// Pfeil für die Anzeige: Veränderung gegenüber gestern
export function trend(m, id) {
  const h = m.history[id];
  if (h.length < 2) return 0;
  const d = h[h.length - 1] / h[h.length - 2] - 1;
  return d > 0.02 ? 1 : d < -0.02 ? -1 : 0;
}
