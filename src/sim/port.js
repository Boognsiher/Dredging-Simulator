import { CONFIG } from '../config.js';
import { priceOf, ratioOf } from './market.js';

// Hafen an Land: Kai mit Verladestation plus Lager (Kies, Tanklager) und Sanierungsanlage (Altlasten). Reine Daten und Logik, speicherbar.
// Der Hafen handelt mit Waren: Schiffe der passenden Fracht laden bei hohen Preisen aus deinem Lager (du verkaufst) und entladen bei tiefen
// Preisen in dein Lager (du kaufst). Zusätzlich kannst du von Hand kaufen/verkaufen oder den Handel automatisieren (Kauf-/Verkaufsschwelle).
export const PORT = {
  openCost: 30000, slots: 6, spread: 0.06, handlingFee: 0.012, reserve: 5000, shipShare: 0.3,
  buildings: {
    kai: { name: 'Kai & Verladestation', icon: '🏗', cost: 12000, max: 1, text: 'Pflicht: Hier laden und entladen die Schiffe. Ohne Kai kein Handel.' },
    kies: { name: 'Kieslager', icon: '⛰', commodity: 'kies', cost: 9000, up: [14000, 30000], cap: [600, 1600, 3600], text: 'Lager für Kies und Sand. Billig im Einkauf, wenig Marge pro Tonne, dafür viel Menge.' },
    tank: { name: 'Tanklager', icon: '🛢', commodity: 'oel', cost: 20000, up: [28000, 60000], cap: [500, 1300, 3000], text: 'Lager für Mineralöl. Teuer, aber hohe Preise und grosse Preisausschläge.' },
    sanierung: { name: 'Sanierungsanlage', icon: '☢', cost: 16000, up: [30000], refund: [0.5, 0.8], text: 'Reinigt Altlasten aus dem Baggergut: spart einen Teil der Entsorgungskosten.' },
  },
  commodities: { kies: { name: 'Kies & Sand', lot: 200, icon: '⛰' }, oel: { name: 'Mineralöl', lot: 50, icon: '🛢' } },
};

export function createPort() {
  const auto = () => ({ on: false, buyBelow: 0.85, sellAbove: 1.2 });
  return {
    open: false, slots: Array(PORT.slots).fill(null), stock: { kies: 0, oel: 0 }, cost: { kies: 0, oel: 0 }, // cost = Einstandspreis je t (Durchschnitt)
    auto: { kies: auto(), oel: auto() }, earned: 0, spent: 0, ships: 0, handled: 0, fees: 0,
  };
}

const slotsOf = (p, type) => p.slots.filter((s) => s?.type === type);
export const hasKai = (g) => g.port.open && slotsOf(g.port, 'kai').length > 0;
export const capacity = (g, id) => slotsOf(g.port, id === 'oel' ? 'tank' : 'kies').reduce((a, s) => a + PORT.buildings[s.type].cap[s.level - 1], 0);
export const refundFrac = (g) => { const s = slotsOf(g.port, 'sanierung')[0]; return s ? PORT.buildings.sanierung.refund[s.level - 1] : 0; };
export const buyPrice = (g, id) => priceOf(g.market, id) * (1 + PORT.spread);
export const sellPrice = (g, id) => priceOf(g.market, id) * (1 - PORT.spread);

export function openBlock(g) {
  if (g.port.open) return 'Hafen ist schon eröffnet';
  if (!g.unlocked.motor) return 'Erst muss das Motorschiff die Rinne befahren';
  if (g.money < PORT.openCost) return `Braucht ${PORT.openCost.toLocaleString('de-CH')} CHF`;
  return g.status === 'playing' ? null : 'Spiel beendet';
}
export function openPort(g) {
  if (openBlock(g)) return false;
  g.money -= PORT.openCost; g.port.open = true; g.port.spent += PORT.openCost;
  g.say('Hafengelände erworben: Baue zuerst einen Kai mit Verladestation.', 'upgrade');
  return true;
}

export function buildBlock(g, slot, type) {
  const p = g.port, B = PORT.buildings[type];
  if (!p.open) return 'Hafen noch nicht eröffnet';
  if (!B || slot < 0 || slot >= PORT.slots) return 'Ungültig';
  if (p.slots[slot]) return 'Platz ist belegt';
  if (type !== 'kai' && !hasKai(g)) return 'Zuerst einen Kai bauen';
  if (B.max && slotsOf(p, type).length >= B.max) return 'Gibt es nur einmal';
  if (g.money < B.cost) return `Braucht ${B.cost.toLocaleString('de-CH')} CHF`;
  return g.status === 'playing' ? null : 'Spiel beendet';
}
export function build(g, slot, type) {
  if (buildBlock(g, slot, type)) return false;
  const B = PORT.buildings[type];
  g.money -= B.cost; g.port.spent += B.cost; g.port.slots[slot] = { type, level: 1 };
  g.say(`${B.name} gebaut (−${B.cost.toLocaleString('de-CH')} CHF).`, 'upgrade');
  return true;
}
export function upgradeBlock(g, slot) {
  const s = g.port.slots[slot], B = s && PORT.buildings[s.type];
  if (!s || !B.up) return 'Nicht ausbaubar';
  if (s.level > B.up.length) return 'Voll ausgebaut';
  const c = B.up[s.level - 1];
  if (g.money < c) return `Braucht ${c.toLocaleString('de-CH')} CHF`;
  return g.status === 'playing' ? null : 'Spiel beendet';
}
export function upgrade(g, slot) {
  if (upgradeBlock(g, slot)) return false;
  const s = g.port.slots[slot], c = PORT.buildings[s.type].up[s.level - 1];
  g.money -= c; g.port.spent += c; s.level++;
  g.say(`${PORT.buildings[s.type].name} ausgebaut (Stufe ${s.level}).`, 'upgrade');
  return true;
}
export function demolish(g, slot) { // Abriss: Lagerinhalt, der nicht mehr reinpasst, wird zum Marktpreis verkauft
  const p = g.port; if (!p.slots[slot]) return false;
  const t = p.slots[slot].type; p.slots[slot] = null;
  if (t === 'kai') for (const id of Object.keys(p.stock)) sell(g, id, p.stock[id]);
  for (const id of Object.keys(p.stock)) { const over = p.stock[id] - capacity(g, id); if (over > 0) sell(g, id, over); }
  return true;
}

// Von Hand kaufen/verkaufen (Tonnen)
export function buy(g, id, tons) {
  const p = g.port; if (!hasKai(g) || !PORT.commodities[id]) return 0;
  const room = capacity(g, id) - p.stock[id], price = buyPrice(g, id);
  const q = Math.max(0, Math.min(tons, room, Math.floor((g.money - PORT.reserve) / price)));
  if (q <= 0) return 0;
  const c = q * price;
  p.cost[id] = (p.cost[id] * p.stock[id] + c) / (p.stock[id] + q); p.stock[id] += q;
  g.money -= c; p.spent += c; g.today.costs += c;
  return q;
}
export function sell(g, id, tons) {
  const p = g.port; if (!PORT.commodities[id]) return 0;
  const q = Math.max(0, Math.min(tons, p.stock[id]));
  if (q <= 0) return 0;
  const r = q * sellPrice(g, id);
  p.stock[id] -= q; g.money += r; p.earned += r; g.today.income += r;
  if (p.stock[id] < 1e-6) { p.stock[id] = 0; p.cost[id] = 0; }
  return q;
}

// Ein Schiff hat die Rinne durchfahren: bei passender Fracht und Lager wird umgeschlagen
export function portShip(g, ship) {
  const p = g.port; if (!hasKai(g) || !PORT.commodities[ship.cargo] || capacity(g, ship.cargo) <= 0) return;
  const id = ship.cargo, amount = ship.tons * PORT.shipShare, price = priceOf(g.market, id), fee = ship.tons * price * PORT.handlingFee;
  g.money += fee; p.fees += fee; g.today.income += fee; p.ships++;
  if (ratioOf(g.market, id) >= 1) { // Preis hoch: Schiff lädt aus deinem Lager
    const q = Math.min(amount, p.stock[id]), r = q * price * (1 + PORT.spread / 2);
    if (q > 0) { p.stock[id] -= q; g.money += r; p.earned += r; g.today.income += r; p.handled += q; }
  } else { // Preis tief: Schiff entlädt, du kaufst günstig
    const q = Math.min(amount, capacity(g, id) - p.stock[id], Math.max(0, Math.floor((g.money - PORT.reserve) / (price * (1 - PORT.spread / 2)))));
    if (q > 0) { const c = q * price * (1 - PORT.spread / 2); p.cost[id] = (p.cost[id] * p.stock[id] + c) / (p.stock[id] + q); p.stock[id] += q; g.money -= c; p.spent += c; g.today.costs += c; p.handled += q; }
  }
}

// Tagesende: automatischer Handel nach den eingestellten Schwellen
export function portDay(g) {
  const p = g.port; if (!hasKai(g)) return;
  for (const id of Object.keys(PORT.commodities)) {
    const a = p.auto[id], cap = capacity(g, id); if (!a.on || cap <= 0) continue;
    const r = ratioOf(g.market, id);
    if (r <= a.buyBelow) buy(g, id, cap * 0.3);
    else if (r >= a.sellAbove) sell(g, id, p.stock[id] * 0.5);
  }
}
