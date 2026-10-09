import { CONFIG, CARGOS, shipById } from '../config.js';
import { minNeedDepth } from './fairway.js';
import { hallCapacity, roadFactor } from './land.js';
import { priceOf, ratioOf } from './market.js';
import { createRng } from './rng.js';
import { rankOf, NEED, rankName } from './rank.js';
import { ensureHarbor, harborDepth, harborAccepts, harborTarget, HARBOR } from './harbor.js';

// Hafen an Land: Kai mit Verladestation plus Lager (Kies, Tanklager) und Sanierungsanlage (Altlasten). Reine Daten und Logik, speicherbar.
// Der Hafen handelt mit Waren: Schiffe der passenden Fracht laden bei hohen Preisen aus deinem Lager (du verkaufst) und entladen bei tiefen
// Preisen in dein Lager (du kaufst). Zusätzlich kannst du von Hand kaufen/verkaufen oder den Handel automatisieren (Kauf-/Verkaufsschwelle).
export const PORT = {
  storageCost: { kies: 0.08, oel: 0.4, container: 0.6 }, // Einlagerkosten in CHF je Tonne und Tag (Lager voll = teuer; Ware zur rechten Zeit verkaufen)
  ownCost: { oel: 0.35, container: 0.6 }, // Förder- bzw. Bahnkosten als Anteil des Basispreises (Eigenproduktion)
  openCost: 30000, slots: 6, spread: 0.05, reserve: 5000, shipShare: 0.15,
  // Umschlagaufträge: Die Mannschaft lädt langsam (t/s), du kannst mit Radlader/Kran im Minispiel schneller sein und Zeit gewinnen
  waitMax: 90, // s: so lange wartet ein Schiff im Warteraum, dann gibt es auf
  jobs: { max: 4, deadline: 40, crewRate: { kies: 6, oel: 3, container: 2.5 }, fee: { kies: 5, oel: 6, container: 9 }, lateFactor: 0.5, bonusMax: 2 },
  // Baugrund: Jeder Bauplatz ist unebenes Gelände (Höhen relativ zur Sollhöhe) und muss mit der Baumaschine planiert werden, bevor gebaut werden darf
  site: { w: 5, h: 4, maxCarry: 4, fillCost: 35, autoCost: 70, act: 0.3, travel: 0.1 },
  machines: { radlader: { name: 'Radlader', icon: '🚜', speed: 1.6, zone: 0.28, bucket: 14 }, kran: { name: 'Kran', icon: '🏗', speed: 2.3, zone: 0.16, bucket: 32 }, bruecke: { name: 'Containerbrücke', icon: '🏗', speed: 2.6, zone: 0.12, bucket: 60 } },
  buildings: {
    kai: { name: 'Kai & Verladestation', icon: '🏗', cost: 12000, max: 1, up: [16000, 40000], berths: [2, 3, 5], text: 'Pflicht: Hier laden und entladen die Schiffe. Jede Stufe schafft mehr Liegeplätze: Schiffe legen nur an, wenn ein Platz frei ist (er wird für sie reserviert), und stehen nicht im Fahrwasser.' },
    kies: { name: 'Kieslager', icon: '⛰', commodity: 'kies', cost: 9000, up: [14000, 30000], cap: [600, 1600, 3600], text: 'Lager für Kies und Sand. Billig im Einkauf, wenig Marge pro Tonne, dafür viel Menge.' },
    tank: { name: 'Tanklager', icon: '🛢', commodity: 'oel', cost: 20000, up: [28000, 60000], cap: [500, 1300, 3000], text: 'Lager für Mineralöl. Teuer, aber hohe Preise und grosse Preisausschläge.' },
    kran: { name: 'Portalkran', icon: '🏗', cost: 14000, max: 1, text: 'Grosse Greifer: im Verlade-Minispiel 32 t pro Treffer statt 14 t (aber schnelleres Pendel).' },
    container: { name: 'Containerterminal', icon: '📦', commodity: 'container', cost: 32000, up: [45000, 90000], cap: [300, 800, 1800], text: 'Umschlag und Lager für Container (Stückgut). Hoher Wert pro Tonne, braucht tiefe Hafenbecken für die grossen Containerschiffe.' },
    werk: { name: 'Aufbereitungshalle', icon: '🏭', cost: 24000, up: [45000, 90000], max: 1, text: 'Erweitert die Anlage an Land: Jede Stufe schaltet zwei weitere Ausbaustufen der Aufbereitungsanlage frei (über Stufe 6 hinaus).' },
    cbruecke: { name: 'Containerbrücke', icon: '🏗', cost: 38000, max: 1, up: [65000], text: 'Spezialkran für Container: Containerschiffe legen nur mit Brücke an, Container werden 3× (Stufe 2: 5×) schneller umgeschlagen, im Minispiel 60 t pro Treffer.' },
    oelfeld: { name: 'Ölfeld (Förderpumpen)', icon: '🛢', cost: 60000, max: 1, up: [90000, 140000], rate: [8, 16, 28], text: 'Fördert Mineralöl aus dem Ölvorkommen dieser Karte ins Tanklager (Förderkosten 35 % des Basispreises je Tonne). Das Vorkommen ist endlich; es gibt nicht auf jeder Karte eines.' },
    bahn: { name: 'Container-Bahnterminal', icon: '🚆', cost: 120000, max: 1, up: [180000], rate: [20, 45], text: 'Bahnanschluss: bringt täglich Container ins Containerlager (Einstand 60 % des Basispreises je Tonne). Braucht ein Containerterminal; du verkaufst über den Hafen.' },
    sanierung: { name: 'Sanierungsanlage', icon: '☢', cost: 16000, up: [30000], refund: [0.5, 0.8], text: 'Reinigt Altlasten aus dem Baggergut: spart einen Teil der Entsorgungskosten.' },
  },
  commodities: { kies: { name: 'Kies & Sand', lot: 200, icon: '⛰' }, oel: { name: 'Mineralöl', lot: 50, icon: '🛢' }, container: { name: 'Container', lot: 40, icon: '📦' } },
  storage: { kies: 'kies', oel: 'tank', container: 'container' }, label: { kies: 'Kies', oel: 'Öl', container: 'Container' }, // Gebäude je Ware, Anzeigenamen
};

// Hafenbecken: Bucht am Ufer (Karte), flach angelegt. Sie muss ausgebaggert werden, damit Schiffe anlegen können.
PORT.bay = { w: 4, h: 3, depth0: 2.6, target: 2.3 }; // Einfahrt am Ufer der Hauptkarte (tief); gebaggert wird im Becken der Hafenkarte
export function carveBay(river, wl) {
  const B = PORT.bay, bx = Math.round(river.cols * 0.62) - 1, rimArmor = CONFIG.concrete.thickness;
  const edge = (x) => { let a = -1, b = -1; for (let y = 0; y < river.rows; y++) if (river.zone[y * river.cols + x]) { if (a < 0) a = y; b = y; } return [a, b]; };
  const cols = []; for (let x = bx; x < bx + B.w; x++) cols.push(x);
  const mid = edge(bx + 1), north = mid[0] - 1 - B.h >= 0, south = mid[1] + 1 + B.h < river.rows;
  const side = north && (!south || mid[0] >= river.rows - 1 - mid[1]) ? -1 : 1;
  const cells = [];
  for (const x of cols) {
    const [a, b] = edge(x);
    for (let k = 1; k <= B.h; k++) {
      const y = side < 0 ? a - k : b + k; if (y < 0 || y >= river.rows) continue;
      const i = y * river.cols + x;
      river.top[i] = wl - B.depth0; river.rock[i] = Math.min(river.rock[i], wl - 8); river.zone[i] = 1; river.bay[i] = 1; river.ext[i] = 0; river.flow[i] = 0.15;
      river.cap[i] = river.top[i] + 0.6; river.kind[i] = 1; river.hard[i] = 0; river.debris[i] = 0; river.dep[i] = 0; river.armor[i] = 0; cells.push(i);
    }
  }
  // Hafenzone: das Schutz-Flachwasser neben dem Becken gehört dazu (kein Naturschutz beim Baggern am Hafen)
  for (let x = bx - 2; x < bx + B.w + 2; x++) {
    if (x < 0 || x >= river.cols) continue;
    const [a, b] = edge(x); if (a < 0) continue;
    for (let k = 1; k <= B.h + 1; k++) {
      const y = side < 0 ? a - k : b + k; if (y < 0 || y >= river.rows) continue;
      const i = y * river.cols + x;
      if (!river.zone[i] && river.ext[i] === 2 && !river.bay[i]) { river.zone[i] = 1; river.bay[i] = 1; river.ext[i] = 0; }
    }
  }
  for (const i of cells) { // Kaimauer: Rand ausser zur Wasserseite betoniert, damit die Bucht nicht zurutscht
    const x = i % river.cols, y = (i / river.cols) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, side]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= river.cols || ny >= river.rows) continue; const j = ny * river.cols + nx; if (!river.bay[j] && !river.zone[j]) river.armor[j] = rimArmor; }
  }
  const xs = cells.map((i) => i % river.cols), ys = cells.map((i) => (i / river.cols) | 0);
  return { cells, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), side };
}
// Tiefe, die 80 % des Hafenbeckens mindestens haben (m unter Wasser)
export function bayDepth(g) {
  if (g.port.harbor) return harborDepth(g.port, g.wl); // Hafenkarte: Tiefe des eigenen Beckens
  const bay = g.port.bay; if (!bay?.cells?.length) return PORT.bay.target; // alte Spielstände: kein Becken, kein Hindernis
  const d = bay.cells.map((i) => g.wl - g.river.top[i]).sort((a, b) => a - b); // der Hafen liegt an der ersten Karte
  return d[Math.floor(d.length * 0.2)];
}
export const kaiLevel = (g) => slotsOf(g.port, 'kai')[0]?.level ?? 0;
export const bayTarget = (g) => (g.port.harbor ? harborTarget(Math.max(1, kaiLevel(g))) : PORT.bay.target);
export const bayReady = (g) => bayDepth(g) >= bayTarget(g) - 0.12;

export function createPort() {
  const auto = () => ({ on: false, buyBelow: 0.85, sellAbove: 1.2 });
  return {
    open: false, slots: Array(PORT.slots).fill(null), stock: { kies: 0, oel: 0, container: 0 }, cost: { kies: 0, oel: 0, container: 0 }, // cost = Einstandspreis je t (Durchschnitt)
    auto: { kies: auto(), oel: auto(), container: auto() }, waitCargo: [null, null, null, null], priority: null, jobs: [], sites: Array(PORT.slots).fill(null), jobSeq: 0, jobsDone: 0, jobsLate: 0, bonus: 0, earned: 0, spent: 0, ships: 0, handled: 0, fees: 0,
  };
}

const slotsOf = (p, type) => p.slots.filter((s) => s?.type === type);
// ältere Spielstände: neue Waren nachrüsten
export function ensurePort(p) { for (const id of Object.keys(PORT.commodities)) { p.stock[id] ??= 0; p.cost[id] ??= 0; p.auto[id] ??= { on: false, buyBelow: 0.85, sellAbove: 1.2 }; } p.waitCargo ??= [null, null, null, null]; p.priority ??= null; return p; }
// Liegeplätze am Kai (Stufe des Kais); Schiffe laufen den Hafen nur an, wenn ein Platz frei ist
export const berthsOf = (g) => { const s = slotsOf(g.port, 'kai')[0]; return g.port.open && s ? PORT.buildings.kai.berths[s.level - 1] : 0; };
export const isDocked = (j) => j.state !== 'reserved' && j.state !== 'waiting'; // alte Spielstände: Aufträge ohne Zustand gelten als angelegt
// Warteräume (Kai-Stufe): Schiffe ohne freien Liegeplatz warten dort im Becken und rücken nach; je Raum lässt sich eine Fracht zuweisen
export const waitsOf = (g) => { const k = kaiLevel(g); return g.port.open && k ? HARBOR.waits[k - 1] : 0; };
export const berthJobs = (g) => (g.port.jobs ?? []).filter((j) => !j.wait); // Aufträge, die einen Liegeplatz belegen oder für einen reserviert haben
export const waitJobs = (g) => (g.port.jobs ?? []).filter((j) => j.wait || j.state === 'waiting');
const CARGO_CYCLE = [null, 'kies', 'oel', 'container'];
export function cycleWaitCargo(g, i) { const p = g.port; p.waitCargo ??= [null, null, null, null]; if (i < 0 || i >= waitsOf(g)) return false; p.waitCargo[i] = CARGO_CYCLE[(CARGO_CYCLE.indexOf(p.waitCargo[i] ?? null) + 1) % CARGO_CYCLE.length]; return true; }
export function cyclePriority(g) { const p = g.port; p.priority = CARGO_CYCLE[(CARGO_CYCLE.indexOf(p.priority ?? null) + 1) % CARGO_CYCLE.length]; return true; }
const freeWaitSlot = (g, cargo) => { const used = new Set(waitJobs(g).map((j) => j.slot)); for (let i = 0; i < waitsOf(g); i++) if (!used.has(i) && (g.port.waitCargo?.[i] == null || g.port.waitCargo[i] === cargo)) return i; return -1; };
export const hasKai = (g) => g.port.open && slotsOf(g.port, 'kai').length > 0;
export const capacity = (g, id) => slotsOf(g.port, PORT.storage[id]).reduce((a, s) => a + PORT.buildings[s.type].cap[s.level - 1], 0) + hallCapacity(g, id); // plus angebundene Lagerhallen (Landseite)
export const refundFrac = (g) => Math.max(0, ...(g.maps ?? [{ port: g.port }]).map((m) => { const s = slotsOf(m.port, 'sanierung')[0]; return s ? PORT.buildings.sanierung.refund[s.level - 1] : 0; })); // beste Sanierungsanlage aller Karten
// Anlage: ohne Halle ist bei Stufe 6 Schluss, jede Hallenstufe (beste aller Karten) erlaubt zwei Stufen mehr
export const PLANT_BASE = 6;
export const werkLevel = (g) => Math.max(0, ...(g.maps ?? [{ port: g.port }]).map((m) => slotsOf(m.port, 'werk')[0]?.level ?? 0));
export const werkLevels = (g) => (g.maps ?? [{ port: g.port }]).reduce((a, m) => a + (slotsOf(m.port, 'werk')[0]?.level ?? 0), 0); // Summe aller Hallenstufen (jede Karte hat ihren eigenen Hafen)
export const plantLimit = (g) => PLANT_BASE + 2 * werkLevels(g);
export const buyPrice = (g, id) => priceOf(g.market, id) * (1 + PORT.spread);
export const sellPrice = (g, id) => priceOf(g.market, id) * (1 - PORT.spread);

export function openBlock(g) {
  if (g.port.open) return 'Hafen ist schon eröffnet';
  if (!g.unlocked.motor) return 'Erst muss das Motorschiff die Rinne befahren';
  if (rankOf(g) < NEED.port) return `Der Hafen braucht Level ${NEED.port} (${rankName(NEED.port)} fährt)`;
  if (g.money < PORT.openCost) return `Braucht ${PORT.openCost.toLocaleString('de-CH')} CHF`;
  return g.status === 'playing' ? null : 'Spiel beendet';
}
export function openPort(g) {
  if (openBlock(g)) return false;
  g.money -= PORT.openCost; g.port.open = true; g.port.spent += PORT.openCost; ensureHarbor(g.port, g.wl);
  for (let i = 0; i < PORT.slots; i++) g.port.sites[i] = makeSite(g);
  g.say('Hafengelände erworben: Baue zuerst einen Kai mit Verladestation.', 'upgrade');
  return true;
}

// ---------- Gelände planieren ----------
function makeSite(g) {
  const S = PORT.site, h = new Array(S.w * S.h).fill(0);
  for (let i = 0; i < h.length; i++) h[i] = Math.round((g.rng() - 0.5) * 6); // -3..+3
  const sum = h.reduce((a, v) => a + Math.abs(v), 0);
  if (sum < 6) h[0] = 3, h[h.length - 1] = -3;
  return { h, mx: 0, my: 0, carry: 0, busy: 0, ready: false };
}
export const siteWork = (site) => site.h.reduce((a, v) => a + Math.abs(v), 0);
export const siteReady = (g, slot) => !!g.port.sites?.[slot]?.ready;
// Ein Klick der Baumaschine auf Zelle (x, y): hohe Zelle abtragen (Ladung +1), tiefe Zelle auffüllen (Ladung −1, sonst Schüttgut aus dem Kieslager oder zugekauft)
export function siteAct(g, slot, x, y) {
  const S = PORT.site, p = g.port, site = p.sites?.[slot];
  if (!site || site.ready || site.busy > 0 || x < 0 || y < 0 || x >= S.w || y >= S.h) return false;
  const i = y * S.w + x, v = site.h[i];
  if (v === 0) { // ebene Zelle: Ladung abkippen (geht ins Kieslager, falls vorhanden)
    if (site.carry <= 0) return false;
    site.carry--; if (capacity(g, 'kies') > 0) p.stock.kies = Math.min(capacity(g, 'kies'), p.stock.kies + 1);
  } else if (v > 0) { if (site.carry >= S.maxCarry) return false; site.h[i]--; site.carry++; }
  else {
    if (site.carry > 0) site.carry--;
    else if (p.stock.kies >= 1) p.stock.kies -= 1;
    else { if (g.money < S.fillCost) return false; g.money -= S.fillCost; p.spent += S.fillCost; g.today.costs += S.fillCost; }
    site.h[i]++;
  }
  site.busy = S.act + S.travel * (Math.abs(site.mx - x) + Math.abs(site.my - y)); site.mx = x; site.my = y;
  if (siteWork(site) === 0) finishSite(g, site);
  return true;
}
function finishSite(g, site) {
  site.ready = true;
  if (site.carry > 0 && capacity(g, 'kies') > 0) g.port.stock.kies = Math.min(capacity(g, 'kies'), g.port.stock.kies + site.carry); // Überschuss ins Kieslager
  site.carry = 0;
  g.say('Baugrund planiert: Hier kann jetzt gebaut werden.', 'upgrade');
}
export const autoLevelCost = (g, slot) => { const s = g.port.sites?.[slot]; return s && !s.ready ? Math.round(siteWork(s) * PORT.site.autoCost) : 0; };
// Planierraupe samt Fahrer mieten: planiert den Platz sofort, kostet je Höheneinheit
export function autoLevel(g, slot) {
  const site = g.port.sites?.[slot], c = autoLevelCost(g, slot);
  if (!site || site.ready || g.money < c || g.status !== 'playing') return false;
  g.money -= c; g.port.spent += c; g.today.costs += c; site.h.fill(0); site.carry = 0; site.ready = true;
  g.say(`Planierraupe hat Bauplatz ${slot + 1} geebnet (−${c.toLocaleString('de-CH')} CHF).`, 'upgrade');
  return true;
}

// Ölvorkommen der aktuellen Karte (Endlos): nicht jede Karte hat eines, die Menge ist endlich und aus dem Kartensamen festgelegt
export function oilInfo(g) {
  const m = g.maps?.[g.mapIdx];
  if (!m || !g.endless) return { has: false, left: 0, start: 0 };
  if (m.oilStart === undefined) { const r = createRng(((m.seed ?? 1) ^ 0x51ed270b) >>> 0); m.oilStart = r() < 0.55 ? Math.round(r.range(2500, 6000)) : 0; m.oilLeft = m.oilStart; }
  return { has: m.oilStart > 0, left: m.oilLeft ?? 0, start: m.oilStart };
}
export function buildBlock(g, slot, type) {
  const p = g.port, B = PORT.buildings[type];
  if (!p.open) return 'Hafen noch nicht eröffnet';
  if (!B || slot < 0 || slot >= PORT.slots) return 'Ungültig';
  if (p.slots[slot]) return 'Platz ist belegt';
  if (!siteReady(g, slot)) return 'Gelände muss erst planiert werden';
  if (type !== 'kai' && !hasKai(g)) return 'Zuerst einen Kai bauen';
  if (type === 'oelfeld') { if (!g.endless) return 'Ölfelder gibt es nur im Endlos-Modus'; if (!oilInfo(g).has) return 'Kein Ölvorkommen auf dieser Karte'; if (!slotsOf(p, 'tank').length) return 'Zuerst ein Tanklager bauen'; }
  if (type === 'bahn' && !slotsOf(p, 'container').length) return 'Zuerst ein Containerterminal bauen';
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
// Marktwirkung: grosse Käufe treiben den Preis der Karte hoch, grosse Verkäufe drücken ihn (je 1000 t); die Abweichung klingt täglich ab
export const IMPACT = { kies: 0.18, oel: 0.075, container: 0.06 };
export function marketImpact(g, id, tons, dir) {
  const K = CONFIG.market, m = g.market; if (!m?.dev || !(id in IMPACT)) return;
  m.imp ??= {}; m.imp[id] = Math.min(0.6, Math.max(-0.6, (m.imp[id] ?? 0) + dir * (tons / 1000) * IMPACT[id])); // wirkt nur kurz: erholt sich täglich um impactRecover
}
export function buy(g, id, tons) {
  const p = g.port; if (!hasKai(g) || !PORT.commodities[id]) return 0;
  const room = capacity(g, id) - p.stock[id], price = buyPrice(g, id);
  const q = Math.max(0, Math.min(tons, room, Math.floor((g.money - PORT.reserve) / price)));
  if (q <= 0) return 0;
  const c = q * price;
  p.cost[id] = (p.cost[id] * p.stock[id] + c) / (p.stock[id] + q); p.stock[id] += q;
  g.money -= c; p.spent += c; g.today.costs += c; marketImpact(g, id, q, +1);
  return q;
}
export function sell(g, id, tons) {
  const p = g.port; if (!PORT.commodities[id]) return 0;
  const q = Math.max(0, Math.min(tons, p.stock[id]));
  if (q <= 0) return 0;
  const r = q * sellPrice(g, id);
  p.stock[id] -= q; g.money += r; p.earned += r; g.today.income += r; marketImpact(g, id, q, -1);
  if (p.stock[id] < 1e-6) { p.stock[id] = 0; p.cost[id] = 0; }
  return q;
}

// Ein Schiff hat die Rinne durchfahren: bei passender Fracht entsteht ein Umschlagauftrag (Kai). Ladet die Mannschaft allein, dauert es;
// im Minispiel (Radlader/Kran) geht es schneller, und es gibt einen Zeitbonus.
export const bridgeLevel = (g) => slotsOf(g.port, 'cbruecke')[0]?.level ?? 0;
// Gerät für einen Umschlag: Containerbrücke für Container, sonst Portalkran bzw. Radlader (ohne Angabe: Fracht des ersten angelegten Auftrags)
export const machineOf = (g, cargo) => { cargo ??= (g.port.jobs ?? []).find(isDocked)?.cargo; return cargo === 'container' && bridgeLevel(g) ? 'bruecke' : slotsOf(g.port, 'kran').length ? 'kran' : 'radlader'; };
// Reservierung: nur ein Schiff, für das ein Liegeplatz frei ist, steuert den Hafen an (der Platz gehört ihm ab der Einfahrt in die Rinne)
export function reserveBerth(g, ship) {
  const p = g.port, J = PORT.jobs; p.jobs ??= []; if (!hasKai(g) || !PORT.commodities[ship.cargo] || capacity(g, ship.cargo) <= 0) return null;
  ensureHarbor(p, g.wl);
  if (ship.cls && (p.harbor ? !harborAccepts(p, g.wl, kaiLevel(g), ship.cls) : bayDepth(g) < minNeedDepth(shipById(ship.cls)))) return null; // Becken zu flach oder Klasse vom Kai nicht angenommen
  if (ship.cls === 'container' && !bridgeLevel(g)) return null; // Containerschiffe brauchen die Containerbrücke
  let wait = false, slot = null;
  if (berthJobs(g).length >= berthsOf(g)) { // alle Liegeplätze belegt oder reserviert: freien Warteplatz suchen, sonst fährt das Schiff vorbei (kein Stau)
    slot = freeWaitSlot(g, ship.cargo); if (slot < 0) return null; wait = true;
  }
  const id = ship.cargo, price = priceOf(g.market, id), out = ratioOf(g.market, id) >= 1;
  const job = { id: ++p.jobSeq, cargo: id, tons: Math.max(10, Math.round(ship.tons * PORT.shipShare)), done: 0, out, price, left: J.deadline, fee: 0, ship: shipLabel(ship), shipId: ship.id ?? null, state: 'reserved', wait, slot, waited: 0 };
  job.fee = job.tons * J.fee[id];
  p.jobs.push(job); p.ships++;
  return job;
}
// Ohne Schiff im Fahrwasser (Tests, ältere Aufrufe): Auftrag sofort angelegt
export function portShip(g, ship) { const j = reserveBerth(g, { ...ship, id: null }); if (j) { j.state = 'docked'; j.shipId = null; } return j; }
// Schiff erreicht das Becken: legt an (verlässt das Fahrwasser), die Frist des Auftrags läuft
export function dockShip(g, ship) {
  const j = (g.port.jobs ?? []).find((q) => q.shipId === ship.id && q.state === 'reserved'); if (!j) return false;
  j.left = PORT.jobs.deadline; ship.state = 'dock';
  j.state = j.wait ? 'waiting' : 'docked'; if (j.wait) j.waited = 0;
  return true;
}
// Position eines angelegten Schiffs im Hafenbecken (Liegeplatz nach Reihenfolge)
export function dockPos(g, ship) {
  const bay = g.port.bay; if (!bay?.cells?.length) return null;
  const docked = (g.port.jobs ?? []).filter((q) => q.state !== 'reserved' && q.shipId != null), k = Math.max(0, docked.findIndex((q) => q.shipId === ship.id)); // angelegte und wartende Schiffe im Becken der Hauptkarte
  const col = k % 2, row = Math.floor(k / 2), w = bay.x1 - bay.x0 + 1, h = bay.y1 - bay.y0 + 1;
  return { x: bay.x0 + w * (0.28 + 0.44 * col), y: bay.y0 + h * Math.min(0.85, 0.2 + 0.3 * row) + 0.2, angle: 0 };
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
  const job = g.port.jobs.find(isDocked); if (!job || quality <= 0) return 0;
  const M = PORT.machines[machineOf(g, job.cargo)];
  return moveGoods(g, job, M.bucket * (0.5 + 0.5 * quality) * (quality > 0.85 ? 1.3 : 1));
}
// Zeit vergeht: Mannschaft lädt den ersten Auftrag, die Frist läuft für alle
export function updatePort(g, dt) {
  const p = g.port; for (const st of p.sites ?? []) if (st && st.busy > 0) st.busy = Math.max(0, st.busy - dt);
  if (!p.jobs?.length) return;
  for (let k = p.jobs.length - 1; k >= 0; k--) { // Reservierung verfällt, wenn das Schiff nicht mehr unterwegs ist (aufgelaufen, gesunken, weg)
    const j = p.jobs[k]; if (j.state !== 'reserved') continue;
    const s = (g.traffic?.ships ?? []).find((q) => q.id === j.shipId);
    if (!s || (s.state !== 'sail' && s.state !== 'queue')) p.jobs.splice(k, 1);
  }
  for (const j of p.jobs) if (isDocked(j)) j.left -= dt;
  for (const j of p.jobs) if (isDocked(j)) moveGoods(g, j, PORT.jobs.crewRate[j.cargo] * (j.cargo === 'container' && bridgeLevel(g) ? [3, 5][bridgeLevel(g) - 1] : 1) * dt * roadFactor(g)); // jeder Liegeplatz hat seine Mannschaft; Strassenanbindung beschleunigt
  for (let k = p.jobs.length - 1; k >= 0; k--) if (isDocked(p.jobs[k]) && p.jobs[k].done >= p.jobs[k].tons - 1e-6) {
    const j = p.jobs[k]; finishJob(g, j); p.jobs.splice(k, 1);
    const s = j.shipId != null ? (g.traffic?.ships ?? []).find((q) => q.id === j.shipId) : null;
    if (s && s.state === 'dock') { s.state = 'sail'; s.berth = null; s.lat = 0; s.safeT = 3; } // Schiff legt ab und fährt weiter (kurz geschützt beim Einfädeln)
  }
  // Warteräume: wer zu lange wartet, gibt auf und fährt weiter; sonst rückt das Schiff nach, sobald ein Liegeplatz frei ist (Vorrang-Fracht zuerst, dann am längsten Wartende)
  const releaseShip = (j) => { const s = (g.traffic?.ships ?? []).find((q) => q.id === j.shipId); if (s && s.state === 'dock') { s.state = 'sail'; s.berth = null; s.lat = 0; s.safeT = 3; } };
  for (let k = p.jobs.length - 1; k >= 0; k--) {
    const j = p.jobs[k]; if (j.state !== 'waiting') continue;
    j.waited = (j.waited ?? 0) + dt;
    if (j.waited > PORT.waitMax || !(g.traffic?.ships ?? []).some((q) => q.id === j.shipId)) { releaseShip(j); p.jobs.splice(k, 1); g.totals.waitGaveUp = (g.totals.waitGaveUp ?? 0) + 1; }
  }
  while (berthJobs(g).length < berthsOf(g)) {
    const w = waitJobs(g).filter((j) => j.state === 'waiting').sort((a, b) => (b.cargo === p.priority) - (a.cargo === p.priority) || b.waited - a.waited)[0];
    if (!w) break;
    w.wait = false; w.state = 'docked'; w.left = PORT.jobs.deadline; w.slot = null;
  }
}

// Tagesende: automatischer Handel nach den eingestellten Schwellen
export function portDay(g) {
  const p = g.port; if (!hasKai(g)) return;
  // Eigenproduktion: Ölfeld (Förderpumpen) und Bahnterminal liefern täglich Ware ins Lager; Kosten je Tonne werden sofort bezahlt und gehen in den Einstand ein
  const prod = (id, amt, unitCost) => {
    let q = Math.min(amt, capacity(g, id) - p.stock[id], Math.floor(Math.max(0, g.money - PORT.reserve) / Math.max(1, unitCost)));
    if (!(q > 0)) return 0;
    const c = q * unitCost; p.cost[id] = (p.cost[id] * p.stock[id] + c) / (p.stock[id] + q); p.stock[id] += q; g.money -= c; p.spent += c; g.today.costs += c;
    return q;
  };
  const oil = slotsOf(p, 'oelfeld')[0], oi = oilInfo(g);
  if (oil && oi.left > 0) { const q = prod('oel', Math.min(PORT.buildings.oelfeld.rate[oil.level - 1], oi.left), PORT.ownCost.oel * cargoBase('oel')); g.maps[g.mapIdx].oilLeft -= q; g.totals.oilProduced = (g.totals.oilProduced ?? 0) + q; }
  const rail = slotsOf(p, 'bahn')[0];
  if (rail) { const q = prod('container', PORT.buildings.bahn.rate[rail.level - 1], PORT.ownCost.container * cargoBase('container')); g.totals.railDelivered = (g.totals.railDelivered ?? 0) + q; }
  for (const id of Object.keys(PORT.commodities)) { // Einlagerkosten
    const c = (p.stock[id] ?? 0) * (PORT.storageCost[id] ?? 0); if (c <= 0) continue;
    g.money -= c; p.spent += c; g.today.costs += c; g.totals.storageCost = (g.totals.storageCost ?? 0) + c;
  }
  for (const id of Object.keys(PORT.commodities)) {
    const a = p.auto[id], cap = capacity(g, id); if (!a.on || cap <= 0) continue;
    const r = ratioOf(g.market, id);
    if (r <= a.buyBelow) buy(g, id, cap * 0.3);
    else if (r >= a.sellAbove) sell(g, id, p.stock[id] * 0.5);
  }
}
const cargoBase = (id) => CARGOS.find((c) => c.id === id)?.base ?? 1;
