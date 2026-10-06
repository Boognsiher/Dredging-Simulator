import { CONFIG } from '../config.js';
import { priceOf, ratioOf } from './market.js';

// Hafen an Land: Kai mit Verladestation plus Lager (Kies, Tanklager) und Sanierungsanlage (Altlasten). Reine Daten und Logik, speicherbar.
// Der Hafen handelt mit Waren: Schiffe der passenden Fracht laden bei hohen Preisen aus deinem Lager (du verkaufst) und entladen bei tiefen
// Preisen in dein Lager (du kaufst). Zusätzlich kannst du von Hand kaufen/verkaufen oder den Handel automatisieren (Kauf-/Verkaufsschwelle).
export const PORT = {
  openCost: 30000, slots: 6, spread: 0.06, reserve: 5000, shipShare: 0.15,
  // Umschlagaufträge: Die Mannschaft lädt langsam (t/s), du kannst mit Radlader/Kran im Minispiel schneller sein und Zeit gewinnen
  jobs: { max: 4, deadline: 40, crewRate: { kies: 6, oel: 3 }, fee: { kies: 5, oel: 6 }, lateFactor: 0.5, bonusMax: 2 },
  machines: { radlader: { name: 'Radlader', icon: '🚜', speed: 1.6, zone: 0.28, bucket: 14 }, kran: { name: 'Kran', icon: '🏗', speed: 2.3, zone: 0.16, bucket: 32 } },
  buildings: {
    kai: { name: 'Kai & Verladestation', icon: '🏗', cost: 12000, max: 1, text: 'Pflicht: Hier laden und entladen die Schiffe. Ohne Kai kein Handel.' },
    kies: { name: 'Kieslager', icon: '⛰', commodity: 'kies', cost: 9000, up: [14000, 30000], cap: [600, 1600, 3600], text: 'Lager für Kies und Sand. Billig im Einkauf, wenig Marge pro Tonne, dafür viel Menge.' },
    tank: { name: 'Tanklager', icon: '🛢', commodity: 'oel', cost: 20000, up: [28000, 60000], cap: [500, 1300, 3000], text: 'Lager für Mineralöl. Teuer, aber hohe Preise und grosse Preisausschläge.' },
    kran: { name: 'Portalkran', icon: '🏗', cost: 14000, max: 1, text: 'Grosse Greifer: im Verlade-Minispiel 32 t pro Treffer statt 14 t (aber schnelleres Pendel).' },
    sanierung: { name: 'Sanierungsanlage', icon: '☢', cost: 16000, up: [30000], refund: [0.5, 0.8], text: 'Reinigt Altlasten aus dem Baggergut: spart einen Teil der Entsorgungskosten.' },
  },
  commodities: { kies: { name: 'Kies & Sand', lot: 200, icon: '⛰' }, oel: { name: 'Mineralöl', lot: 50, icon: '🛢' } },
};

export function createPort() {
  const auto = () => ({ on: false, buyBelow: 0.85, sellAbove: 1.2 });
  return {
    open: false, slots: Array(PORT.slots).fill(null), stock: { kies: 0, oel: 0 }, cost: { kies: 0, oel: 0 }, // cost = Einstandspreis je t (Durchschnitt)
    auto: { kies: auto(), oel: auto() }, jobs: [], jobSeq: 0, jobsDone: 0, jobsLate: 0, bonus: 0, earned: 0, spent: 0, ships: 0, handled: 0, fees: 0,
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

// Ein Schiff hat die Rinne durchfahren: bei passender Fracht entsteht ein Umschlagauftrag (Kai). Ladet die Mannschaft allein, dauert es;
// im Minispiel (Radlader/Kran) geht es schneller, und es gibt einen Zeitbonus.
export const machineOf = (g) => (slotsOf(g.port, 'kran').length ? 'kran' : 'radlader');
export function portShip(g, ship) {
  const p = g.port, J = PORT.jobs; p.jobs ??= []; if (!hasKai(g) || !PORT.commodities[ship.cargo] || capacity(g, ship.cargo) <= 0) return;
  if (p.jobs.length >= J.max) return; // Kai ausgelastet: Schiff fährt ohne Umschlag weiter
  const id = ship.cargo, price = priceOf(g.market, id), out = ratioOf(g.market, id) >= 1;
  p.jobs.push({ id: ++p.jobSeq, cargo: id, tons: Math.max(10, Math.round(ship.tons * PORT.shipShare)), done: 0, out, price, left: J.deadline, fee: 0, ship: shipLabel(ship) });
  p.jobs[p.jobs.length - 1].fee = p.jobs[p.jobs.length - 1].tons * J.fee[id];
  p.ships++;
}
const shipLabel = (ship) => ship.cls ?? '';

// Verlademenge bewegen: Ware aus dem Lager aufs Schiff (out) oder vom Schiff ins Lager (in). Gibt die wirklich bewegte Menge zurück.
function moveGoods(g, job, q) {
  const p = g.port, id = job.cargo, price = job.price;
  q = Math.min(q, job.tons - job.done);
  if (job.out) q = Math.min(q, p.stock[id]);
  else q = Math.min(q, capacity(g, id) - p.stock[id], Math.max(0, (g.money - PORT.reserve) / (price * (1 - PORT.spread / 2))));
  if (q <= 1e-9) { job.done = job.tons; return 0; } // nichts mehr möglich (Lager leer/voll/kein Geld): Auftrag endet
  if (job.out) { const r = q * price * (1 + PORT.spread / 2); p.stock[id] -= q; g.money += r; p.earned += r; g.today.income += r; }
  else { const c = q * price * (1 - PORT.spread / 2); p.cost[id] = (p.cost[id] * p.stock[id] + c) / (p.stock[id] + q); p.stock[id] += q; g.money -= c; p.spent += c; g.today.costs += c; }
  job.done += q; p.handled += q;
  return q;
}
function finishJob(g, job) {
  const p = g.port, J = PORT.jobs, late = job.left <= 0;
  const frac = Math.max(0, job.left) / J.deadline, pay = late ? job.fee * J.lateFactor : job.fee * (1 + J.bonusMax * frac);
  g.money += pay; p.fees += pay; g.today.income += pay; if (!late) p.bonus += pay - job.fee; else p.jobsLate++;
  p.jobsDone++;
  g.flash.push({ x: 0, y: 0, text: `+${Math.round(pay)}`, color: late ? '#e0a040' : '#7bd88f' });
}
// Minispiel-Treffer: quality 0..1 (0 = Fehlwurf). Lädt den ersten Auftrag.
export function loadHit(g, quality) {
  const job = g.port.jobs[0]; if (!job || quality <= 0) return 0;
  const M = PORT.machines[machineOf(g)];
  return moveGoods(g, job, M.bucket * (0.5 + 0.5 * quality) * (quality > 0.85 ? 1.3 : 1));
}
// Zeit vergeht: Mannschaft lädt den ersten Auftrag, die Frist läuft für alle
export function updatePort(g, dt) {
  const p = g.port; if (!p.jobs?.length) return;
  for (const j of p.jobs) j.left -= dt;
  const first = p.jobs[0]; moveGoods(g, first, PORT.jobs.crewRate[first.cargo] * dt);
  for (let k = p.jobs.length - 1; k >= 0; k--) if (p.jobs[k].done >= p.jobs[k].tons - 1e-6) { finishJob(g, p.jobs[k]); p.jobs.splice(k, 1); }
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
