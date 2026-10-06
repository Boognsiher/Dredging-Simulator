import { CONFIG } from '../config.js';
import { priceOf } from './market.js';

// Anlage an Land: Das Baggergut liegt im Puffer (m³ je Material), die Anlage verarbeitet es mit ihrem Durchsatz.
// Kies, Sand und Fels werden verkauft (Sortieranlage hebt den Erlös, Kies folgt dem Markt), Schlick und Altlast kosten Entsorgung
// (Entwässerung senkt sie). Gibt den Nettoerlös des Schritts zurück.
export const stockTotal = (stock) => stock.reduce((a, b) => a + b, 0);

export function materialPrice(kindIdx, stats, market) {
  const m = CONFIG.materials[kindIdx];
  if (m.price < 0) return m.price * stats.disposalFactor;
  const marketMult = m.id === 'kies' && market ? priceOf(market, 'kies') / 18 : 1;
  return m.price * stats.sortBonus * marketMult;
}

// divert: { [Materialindex]: { room } }: so viel (m³) dieses Materials wird statt verkauft ins Betonwerk-Lager umgeleitet
export function processPlant(stock, dt, stats, market, divert = null) {
  const total = stockTotal(stock);
  const moved = [0, 0, 0, 0, 0];
  if (total <= 1e-9) return { vol: 0, net: 0, by: [0, 0, 0, 0, 0], moved };
  const take = Math.min(total, stats.plantCapacity * dt), share = take / total;
  let net = 0;
  const by = [0, 0, 0, 0, 0];
  for (let k = 0; k < stock.length; k++) {
    let v = stock[k] * share;
    stock[k] -= v;
    if (divert?.[k] && divert[k].room > 0) { const d = Math.min(v, divert[k].room); divert[k].room -= d; moved[k] = d; v -= d; }
    by[k] = v * materialPrice(k, stats, market);
    net += by[k];
  }
  return { vol: take, net, by, moved };
}
