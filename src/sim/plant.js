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

export function processPlant(stock, dt, stats, market) {
  const total = stockTotal(stock);
  if (total <= 1e-9) return { vol: 0, net: 0, by: [0, 0, 0, 0, 0] };
  const take = Math.min(total, stats.plantCapacity * dt), share = take / total;
  let net = 0;
  const by = [0, 0, 0, 0, 0];
  for (let k = 0; k < stock.length; k++) {
    const v = stock[k] * share;
    stock[k] -= v;
    by[k] = v * materialPrice(k, stats, market);
    net += by[k];
  }
  return { vol: take, net, by };
}
