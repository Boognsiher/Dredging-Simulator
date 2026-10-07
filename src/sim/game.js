import { CONFIG, UPGRADES, SHIPS, KIND, ENDLESS, DEPOSITS, levelById } from '../config.js';
import { toolAvailable } from './slice.js';
import { River } from './river.js';
import { carveFairway, analyzeFairway, zonePlan } from './fairway.js';
import { DredgeSim } from './dredge.js';
import { EVENTS } from './events.js';
import { computeStats, upgradeCost } from './stats.js';
import { createRng } from './rng.js';
import { createMarket, stepMarket } from './market.js';
import { createPort, portDay, refundFrac, updatePort, carveBay, plantLimit } from './port.js';
import { createShipping, updateShipping } from './shipping.js';
import { createTraffic, updateTraffic, maxZones, zoneClasses, zoneSupports, activeClasses } from './traffic.js';
import { processPlant, stockTotal, materialPrice } from './plant.js';
import { updateContracts } from './contracts.js';
import { createFleet, updateFleet } from './fleet.js';

// Zufallsfluss für den Endlos-Modus: Parameter aus (Seed, Kartennummer); spätere Karten sind schwerer
const MAP_NAMES = ['Rheinfelden', 'Laufenburg', 'Kembs', 'Aare-Mündung', 'Thur-Enge', 'Bingen', 'Wesel', 'Eisernes Tor', 'Straubing', 'Passau', 'Basel', 'Koblenz'];
export const mapSeed = (seed, k) => ((seed >>> 0) * 2654435761 + k * 40503 + 12345) >>> 0;
export function endlessRiver(seed, k) {
  const r = createRng(mapSeed(seed, k)), hard = Math.min(1, k / 5);
  const bars = [8, 22, 36].map((x) => ({ x: Math.round(x + r.range(-2, 2)), w: +r.range(3, 4).toFixed(1), raise: +r.range(0.45, 0.6).toFixed(2) }));
  const ridgeN = k === 0 ? 1 : 1 + (k >= 2 ? 1 : 0) + (k >= 4 ? 1 : 0), ridges = [];
  for (let i = 0; i < ridgeN; i++) ridges.push({ x: Math.round(((i + 1) * 44) / (ridgeN + 1) + r.range(-3, 3)), w: +r.range(3, 5).toFixed(1), depth: +Math.max(3.1, 4.3 - 0.22 * k + r.range(-0.2, 0.2)).toFixed(2) });
  const kinds = ['kiesbank', 'quarz', 'seife'], deposits = ['kiesbank'];
  for (let i = 0; i < 2 + (k >= 2 ? 1 : 0); i++) deposits.push(kinds[r.int(0, 2)]);
  return { halfWidth: +(r.range(6.2, 7.4) - 0.7 * hard).toFixed(2), depthMax: +r.range(2.2, 2.6).toFixed(2), rockDepth: +(r.range(5.4, 6.6) - 1.0 * hard).toFixed(2), meander: +r.range(2.0, 3.0).toFixed(2),
    bars, ridges, shoals: r.int(4, 6), altlast: 2 + k, hardBlobs: 3 + k, debris: 14 + 2 * k, deposits };
}
// Regionale Preise (Endlos): dauerhafter Aufschlag/Abschlag je Fracht und Karte, aus Seed und Kartennummer
export const BIAS_SPAN = { kies: 0.4, oel: 0.25, container: 0.3 }; // max. Abweichung des regionalen Preises
export function regionBias(seed, k) {
  const br = createRng(mapSeed(seed, k) ^ 0x9e3779b9), span = BIAS_SPAN, bias = {};
  for (const id of ['kies', 'oel', 'container']) bias[id] = +br.range(-span[id], span[id]).toFixed(2);
  return bias;
}
const freshDay = () => ({ ships: 0, tons: 0, income: 0, costs: 0, plant: 0, pay: 0, rejected: 0 });

// Gesamtzustand des Spiels (Management-Ebene), läuft in Echtzeit. Kein DOM, kein Canvas.
// Gewonnen hat, wer am Ende am meisten Geld hat; das Verkehrsziel (goalTons) schaltet das nächste Level frei.
export class Game {
  constructor(seed = Date.now() & 0xffffff, levelId = 'hochrhein') {
    this.seed = seed;
    this.levelId = levelById(levelId).id;
    this.rng = createRng(seed);
    const L = levelById(this.levelId);
    this.maps = [{ id: 0, name: MAP_NAMES[(seed >>> 0) % MAP_NAMES.length], seed, difficulty: 0 }]; // Karten (Engstellen); die Felder river, traffic, fleet, zones ... gehören zur aktuellen Karte (mapIdx)
    this.mapIdx = 0;
    this.river = River.generate(this.rng, L.endless ? endlessRiver(seed, 0) : L.river);
    this.wl = this.river.wl;
    this.water = { target: CONFIG.water.base, until: 0 };
    this.closed = false; // Hochwasser: Schifffahrt gesperrt
    this.strikeUntil = 0;
    this.time = 0;
    this.day = 1;
    this.money = L.startMoney ?? CONFIG.startMoney;
    this.levels = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
    this.stock = [0, 0, 0, 0, 0]; // Puffer vor der Anlage in m³ je Material
    this.targetDepth = CONFIG.echolot.defaultDepth;
    this.pumpSpeed = CONFIG.pumpSpeed.default;
    this.autoRange = null; // Automatik-Bereich des Spielers (Zeilen quer zum Fluss)
    this.tool = 'pump'; // zuletzt gewähltes Gerät des eigenen Pontons
    this.concrete = 0; // Betonvorrat in m³ (gekauft oder im Betonwerk gemischt)
    this.agg = { kies: 0, sand: 0 }; // Lager für das Betonwerk (m³)
    this.divertAgg = true; // Kies und Sand ins Betonwerk statt verkaufen
    this.market = createMarket(L.endless ? regionBias(seed, 0) : {});
    this.traffic = createTraffic();
    this.fleet = createFleet();
    this.shipping = createShipping(); // eigene Reederei (global)
    this.port = createPort(); // Hafen an Land (Kai, Lager, Handel)
    this.zones = []; // Kreuzungsstellen: { id, x (Spalte der Mitte), w }
    this.zoneSeq = 0;
    this.unlocked = {}; // Schiffsklassen, die schon einmal fahren konnten
    this.contracts = [];
    this.contractSeq = 0;
    this.nextContractAt = CONFIG.contracts.firstAtDay * CONFIG.daySeconds;
    this.rejectedBy = {};
    this.totals = { removed: 0, pay: 0, fines: 0, repairs: 0, protectFines: 0, plantNet: 0, sold: 0, disposal: 0, tons: 0, ships: 0, trafficIncome: 0, spawned: 0, turnedAway: 0, rejected: 0, lostValue: 0, groundings: 0, towed: 0, salvage: 0, contractsPaid: 0, contractsPenalty: 0, contractsDone: 0, contractsFailed: 0, opCost: 0, eventCosts: 0, eventGains: 0, bombs: 0, premium: 0, sunk: 0, sunkFines: 0, concreteBought: 0, concreteSpend: 0, concreteUsed: 0, concreteMixed: 0, cementCost: 0, rescued: 0, rescueRefund: 0, landFees: 0, landRemoved: 0, fleetRemoved: 0, wages: 0, byCargo: {}, byClass: {}, byKind: [0, 0, 0, 0, 0] };
    this.today = freshDay();
    this.eventsOn = true; // Zufallsereignisse (Tests schalten sie ab)
    this.goalSeen = false;
    this.fairSig = {}; // zuletzt bekannter Zustand je Klasse (für Meldungen "jetzt befahrbar")
    this.status = 'playing'; // 'playing' | 'ended'
    this.end = null; // { reason: 'goal' | 'deadline' | 'bankrupt', finalMoney, goalReached }
    this.log = [];
    this.notes = []; // Meldungen für die Oberfläche (Toast): { text, kind } (nicht gespeichert)
    this.flash = []; // schwebende Beträge auf der Karte (nicht gespeichert)
    this.site = null; // Position des verankerten Pontons (setzt die Oberfläche)
    this.fairClock = 0;
    this.sedClock = 0;
    this.port.bay = carveBay(this.river, this.wl); // Hafenbecken (Bucht) am Ufer, flach: muss für den Hafenbetrieb vertieft werden
    this.analyze();
    carveFairway(this.river, this.wl, SHIPS.find((s) => s.id === L.classes[0])); // die kleinste Klasse kann von Anfang an fahren
    this.analyze(true);
  }

  get level() { return levelById(this.levelId); }
  get endless() { return !!this.level.endless; }
  get map() { return this.maps[this.mapIdx]; }

  // Stau auf der Karte: Bei Niedrigwasser, gesperrter Rinne oder Hochwasser-Sperre können die Schiffe nicht fahren, die Ware staut sich
  // und der Preis vor Ort sinkt (bis -30 %): günstig einkaufen und im Hafenlager einlagern, bis die Schiffe wieder fahren
  glutTarget() {
    const K = CONFIG.water;
    if (this.closed) return 0.3;
    const low = Math.min(1, Math.max(0, (K.base - 0.1 - this.wl) / 0.5)), act = SHIPS.filter((s) => this.unlocked[s.id]);
    const blocked = act.length ? act.filter((s) => !this.fair?.[s.id]?.passable).length / act.length : 0;
    return Math.max(0.25 * low, 0.2 * blocked);
  }
  updateGlut(dt) { const m = this.market; m.glut = (m.glut ?? 0) + (this.glutTarget() - (m.glut ?? 0)) * Math.min(1, dt * 0.1); }

  // Weitere Karte (Engstelle) erschliessen: nur im Endlos-Modus; jede kostet mehr und ist schwerer
  mapCost() { return this.maps.length >= (ENDLESS.maxMaps) ? null : ENDLESS.mapCosts[this.maps.length]; }
  mapBlock() {
    if (!this.endless) return 'Nur im Endlos-Modus';
    if (this.status !== 'playing') return 'Spiel beendet';
    const c = this.mapCost();
    if (c === null) return 'Das Flussnetz ist vollständig erschlossen';
    return this.money < c ? `Braucht ${c.toLocaleString('de-CH')} CHF` : null;
  }
  addMap() {
    if (this.mapBlock()) return false;
    const k = this.maps.length, cost = this.mapCost(), seed = mapSeed(this.seed, k), cur = this.mapIdx;
    this.money -= cost;
    let name = MAP_NAMES[((this.seed >>> 0) + k * 5) % MAP_NAMES.length]; while (this.maps.some((m) => m.name === name)) name += '+';
    const river = River.generate(createRng(seed), endlessRiver(this.seed, k)); river.wl = this.wl;
    const bias = regionBias(this.seed, k); // regionale Preise: Handel zwischen den Karten lohnt sich
    this.maps.push({ id: k, name, seed, difficulty: k, river, traffic: createTraffic(), fleet: createFleet(), zones: [], zoneSeq: 0, unlocked: {}, fairSig: {}, fair: null, fairClock: 0, sedClock: 0, rejectedBy: {}, site: null, market: createMarket(bias), port: createPort() });
    this.mapIdx = k;
    this.port.bay = carveBay(this.river, this.wl);
    this.analyze();
    carveFairway(this.river, this.wl, SHIPS.find((s) => s.id === this.level.classes[0]));
    this.analyze(true);
    this.mapIdx = cur;
    this.say(`Neue Karte erschlossen: ${name} (−${cost.toLocaleString('de-CH')} CHF). Schwierigkeit ${k + 1}.`, 'upgrade');
    return k;
  }
  switchMap(i) { if (i < 0 || i >= this.maps.length || i === this.mapIdx) return false; this.mapIdx = i; return true; }
  get stats() { return (this._stats ??= computeStats(this.levels)); }
  get stockTotal() { return stockTotal(this.stock); }
  get bufferRoom() { return Math.max(0, this.stats.bufferCapacity - this.stockTotal); }
  get deadlineDays() { return this.level.deadlineDays ?? CONFIG.deadlineDays; }
  get totalSeconds() { return this.deadlineDays * CONFIG.daySeconds; }
  get timeLeft() { return Math.max(0, this.totalSeconds - this.time); }
  get goalReached() { return this.totals.tons >= this.level.goalTons; }

  notify(text, kind = 'info', extra = null) { this.notes.push({ text, kind, ...extra }); }
  say(text, kind = 'info') { this.log.unshift({ day: this.day, text, kind }); this.log.length = Math.min(this.log.length, 60); }

  setWater(target, days) { this.water = { target, until: this.time + days * CONFIG.daySeconds }; }

  // gesperrt: Anlage über Stufe 6 braucht die Aufbereitungshalle im Hafen
  upgradeLocked(id) { return id === 'plant' && this.levels.plant >= plantLimit(this) && this.levels.plant < UPGRADES.plant.maxLevel; }
  nextUpgradeCost(id) { return this.levels[id] >= UPGRADES[id].maxLevel || this.upgradeLocked(id) ? null : upgradeCost(id, this.levels[id]); }

  buyUpgrade(id) {
    const cost = this.nextUpgradeCost(id);
    if (cost === null || this.money < cost || this.status !== 'playing') return false;
    this.money -= cost; this.levels[id]++; this._stats = null;
    this.say(`${UPGRADES[id].name} auf Stufe ${this.levels[id]} (−${cost} CHF)`, 'upgrade');
    return true;
  }

  refundFor(id) { return this.levels[id] <= 0 ? null : Math.round((upgradeCost(id, this.levels[id] - 1) * CONFIG.refundShare) / 10) * 10; }

  sellUpgrade(id) {
    const refund = this.refundFor(id);
    if (refund === null || this.status !== 'playing') return false;
    this.levels[id]--; this._stats = null; this.money += refund;
    this.say(`${UPGRADES[id].name} auf Stufe ${this.levels[id]} zurückgebaut (+${refund} CHF)`, 'upgrade');
    return true;
  }

  createSession() {
    const sim = new DredgeSim(this.river, this.stats, this.rng);
    sim.targetDepth = this.targetDepth;
    sim.pumpSpeed = this.pumpSpeed;
    sim.bufferRoom = this.bufferRoom;
    sim.turbidityMult = this.level.turbidityMult ?? 1;
    if (toolAvailable(this.stats, this.tool)) sim.tool = this.tool;
    sim.concreteAvail = this.concrete;
    return sim;
  }

  // Fahrrinnen neu auswerten; meldet, wenn eine Klasse befahrbar wird oder die Rinne wieder zu flach wird
  analyze(silent = false) {
    this.fair = analyzeFairway(this.river, Math.min(this.wl, CONFIG.water.base)); // Hochwasser öffnet keine Klassen: massgebend ist der Normalpegel (Niedrigwasser sperrt)
    for (const cls of SHIPS) {
      if (!this.level.classes.includes(cls.id)) continue;
      const f = this.fair[cls.id], was = this.fairSig[cls.id];
      if (f.passable && !this.unlocked[cls.id]) {
        this.unlocked[cls.id] = true;
        if (!silent && was !== undefined) { const at = this.maps.length > 1 ? ` (${this.map.name})` : ''; this.say(`Neue Schiffsklasse freigeschaltet: ${cls.name}${at}! Reedereien schicken ab jetzt solche Schiffe.`, 'good'); this.notify(`${cls.icon} ${cls.name} freigeschaltet${at}: ab jetzt kommen solche Schiffe`, 'good'); }
      } else if (was !== undefined && !silent && f.passable !== was) {
        if (f.passable) { this.say(`Fahrrinne wieder frei für ${cls.name}.`, 'good'); }
        else if (!this.closed) this.say(`Rinne für ${cls.name} ist zu flach geworden (Pegel oder Verlandung).`, 'bad');
      }
      this.fairSig[cls.id] = f.passable;
    }
  }

  // Klasse, für die neue Kreuzungsstellen geplant werden (gewählt, sonst die grösste Klasse, die schon fährt)
  get zoneClassId() {
    const ids = this.level.classes;
    if (this.zoneClass && ids.includes(this.zoneClass)) return this.zoneClass;
    const act = activeClasses(this);
    return (act[act.length - 1] ?? SHIPS.find((s) => s.id === ids[0])).id;
  }

  // Plan einer Kreuzungsstelle für eine Klasse: fehlendes Volumen (m³) und Fenster; bereit = zwei Rinnen sind schon da
  zonePlanFor(x, clsId = this.zoneClassId) {
    const cls = SHIPS.find((s) => s.id === clsId), z = { x, w: CONFIG.zones.width };
    return { ...zonePlan(this.river, Math.min(this.wl, CONFIG.water.base), cls, x, z.w), ready: zoneSupports(this, z, clsId), cls: clsId };
  }

  // Kreuzungsstelle planen (Mitte in Spalte x). Geplant werden darf überall, wo auch mit Uferstreifen genug Breite entstehen kann;
  // benutzt wird sie erst, wenn die zwei Rinnen ausgebaggert sind. Anzahl begrenzt (Rotlichter erhöhen sie).
  zoneBlock(x, clsId = this.zoneClassId) {
    const Z = CONFIG.zones;
    if (this.status !== 'playing') return 'Spiel beendet';
    if (x < 2 || x > this.river.cols - 3) return 'Zu nah am Rand';
    if (this.zones.some((z) => Math.abs(z.x - x) < Z.width + 1)) return 'Zu nah an einer anderen Kreuzungsstelle';
    if (this.zones.length >= maxZones(this)) return 'Mehr Kreuzungsstellen brauchen Rotlichter (Wasserstrasse ausbauen)';
    if (this.zonePlanFor(x, clsId).volume === Infinity) return 'Hier ist die Rinne auch mit dem Uferstreifen zu schmal für zwei Schiffe';
    if (this.money < Z.cost) return `Braucht ${Z.cost.toLocaleString('de-CH')} CHF`;
    return null;
  }
  placeZone(x, clsId = this.zoneClassId) {
    if (this.zoneBlock(x, clsId)) return false;
    this.money -= CONFIG.zones.cost;
    this.zones.push({ id: ++this.zoneSeq, x, w: CONFIG.zones.width, cls: clsId });
    const p = this.zonePlanFor(x, clsId);
    this.say(`Kreuzungsstelle bei Spalte ${x + 1} geplant (−${CONFIG.zones.cost} CHF): ${p.ready ? 'sofort nutzbar' : `noch ${Math.round(p.volume)} m³ auszutragen`}`, 'upgrade');
    return true;
  }
  setZoneClass(id, clsId) { const z = this.zones.find((q) => q.id === id); if (z && SHIPS.some((s) => s.id === clsId)) z.cls = clsId; return !!z; }
  removeZone(id) {
    const i = this.zones.findIndex((z) => z.id === id);
    if (i < 0) return false;
    this.zones.splice(i, 1);
    return true;
  }

  // Rohstoffvorkommen erkunden (das nächste unbekannte) und Konzession erwerben
  exploreBlock() {
    if (this.status !== 'playing') return 'Spiel beendet';
    if (!this.river.deposits.some((d) => !d.known)) return 'Alle Vorkommen sind bekannt';
    if (this.money < CONFIG.deposits.exploreCost) return `Braucht ${CONFIG.deposits.exploreCost.toLocaleString('de-CH')} CHF`;
    return null;
  }
  explore() {
    if (this.exploreBlock()) return null;
    const d = this.river.deposits.find((q) => !q.known);
    this.money -= CONFIG.deposits.exploreCost; d.known = true; this.totals.explored = (this.totals.explored ?? 0) + 1;
    this.say(`Erkundet: ${d.name} bei Spalte ${Math.round(d.cx) + 1} (Aufschlag ×${d.mult}). Mit Konzession lohnt sich der Abbau.`, 'good');
    this.notify(`Vorkommen gefunden: ${d.name}`, 'good');
    return d;
  }
  // Täglich: leere Vorkommen verschwinden, mit der Zeit erscheinen neue zum Kauf (bekannt, Konzession kostet), solange weniger als drei aktiv sind
  depositsDay() {
    const D = CONFIG.deposits;
    for (const m of this.maps) {
      const r = m.river, name = this.maps.length > 1 ? `${m.name}: ` : '';
      for (const d of r.deposits) if (!d.depleted && d.known && r.depositRemaining(d.id) < D.emptyBelow) { r.retireDeposit(d.id); this.say(`${name}${d.name} ist abgebaut und verschwindet von der Karte.`, 'info'); }
      const active = r.deposits.filter((d) => !d.depleted).length;
      if (active < D.maxActive && this.rng() < D.spawnChance) {
        const T = DEPOSITS[Math.floor(this.rng() * DEPOSITS.length)], d = r.spawnDeposit(this.rng, T);
        if (d) { this.say(`${name}Neues Vorkommen entdeckt: ${d.name} bei Spalte ${Math.round(d.cx) + 1}. Konzession ${d.cost.toLocaleString('de-CH')} CHF.`, 'good'); this.notify(`${name}Neues Vorkommen: ${d.name}`, 'good'); }
      }
    }
  }
  concessionBlock(id) {
    const d = this.river.deposits[id - 1];
    if (!d || !d.known || d.depleted) return d?.depleted ? 'Vorkommen ist abgebaut' : 'Erst erkunden';
    if (d.owned) return 'Schon erworben';
    if (this.money < d.cost) return `Braucht ${d.cost.toLocaleString('de-CH')} CHF`;
    return this.status === 'playing' ? null : 'Spiel beendet';
  }
  buyConcession(id) {
    if (this.concessionBlock(id)) return false;
    const d = this.river.deposits[id - 1];
    this.money -= d.cost; d.owned = true;
    this.say(`Konzession für ${d.name} erworben (−${d.cost} CHF): Aufschlag ×${d.mult} auf den Abbau.`, 'upgrade');
    return true;
  }

  // Naturschutzstreifen (Flachwasser am Ufer) abschnittsweise freikaufen: wird zum Baggerkorridor, die Rinne kann breiter werden
  shoreSections() {
    const r = this.river, P = CONFIG.zones.shoreParts, out = [];
    for (let side = 0; side < 2; side++) for (let part = 0; part < P; part++) out.push({ side, part, cells: [] });
    for (let x = 0; x < r.cols; x++) {
      const part = Math.min(P - 1, Math.floor((x / r.cols) * P));
      for (let y = 0; y < r.rows; y++) {
        const i = r.idx(x, y);
        if (r.isWater(i) && !r.zone[i] && r.ext[i] === 2) out[(y + 0.5 < r.centerY(x) ? 0 : P) + part].cells.push(i);
      }
    }
    for (const sec of out) sec.cost = sec.cells.length * CONFIG.zones.shoreCell;
    return out;
  }
  shoreBlock(side, part) {
    const sec = this.shoreSections().find((q) => q.side === side && q.part === part);
    if (!sec || !sec.cells.length) return 'Schon freigegeben';
    if (this.status !== 'playing') return 'Spiel beendet';
    return this.money < sec.cost ? `Braucht ${Math.round(sec.cost).toLocaleString('de-CH')} CHF` : null;
  }
  buyShore(side, part) {
    if (this.shoreBlock(side, part)) return false;
    const sec = this.shoreSections().find((q) => q.side === side && q.part === part), r = this.river;
    for (const i of sec.cells) { r.zone[i] = 1; r.ext[i] = 0; }
    this.money -= sec.cost; this.totals.shoreSpend = (this.totals.shoreSpend ?? 0) + sec.cost;
    this.say(`Naturschutzstreifen freigegeben (−${Math.round(sec.cost)} CHF): ${sec.cells.length} Zellen sind jetzt Baggerkorridor.`, 'upgrade');
    this.analyze(true);
    return true;
  }

  // Beton zukaufen (m³): kostet CONFIG.concrete.price pro m³, Lager hat eine Obergrenze
  concreteBlock(m3) {
    const C = CONFIG.concrete;
    if (this.status !== 'playing') return 'Spiel beendet';
    if (this.concrete + m3 > C.stockCap + 1e-9) return 'Betonlager voll';
    if (this.money < m3 * C.price) return `Braucht ${Math.round(m3 * C.price).toLocaleString('de-CH')} CHF`;
    return null;
  }
  buyConcrete(m3) {
    if (this.concreteBlock(m3)) return false;
    const cost = m3 * CONFIG.concrete.price;
    this.money -= cost; this.concrete += m3; this.totals.concreteBought += m3; this.totals.concreteSpend += cost;
    this.say(`${m3} m³ Beton gekauft (−${Math.round(cost).toLocaleString('de-CH')} CHF)`, 'upgrade');
    return true;
  }

  // Aufgelaufenes Schiff vom Ponton freigeschleppt (Minispiel): sofort flott, ein Teil der Bergungskosten kommt zurück
  rescueShip(id) {
    const ship = this.traffic.ships.find((s) => s.id === id);
    if (!ship || ship.state !== 'grounded') return false;
    ship.state = 'sail'; ship.ground = 0;
    const refund = Math.round(((ship.salvage ?? 0) * CONFIG.tow.refund) / 10) * 10;
    this.money += refund; this.totals.rescued++; this.totals.rescueRefund += refund; this.totals.salvage -= refund;
    this.say(`Schiff freigeschleppt! Bergungskosten −${refund} CHF gespart.`, 'good');
    this.notify(`Schiff frei! +${refund.toLocaleString('de-CH')} CHF zurück`, 'good');
    this.flash.push({ x: 2, y: 2, text: `+${refund}`, color: '#7bd88f' });
    return true;
  }

  // Verbucht, was der Ponton in einem Schritt getan hat (siehe DredgeSim.update)
  collect(d) {
    if (this.status !== 'playing') return;
    for (let k = 0; k < 5; k++) { this.stock[k] += d.by[k]; this.totals.byKind[k] += d.by[k]; }
    if (d.concrete) { this.concrete = Math.max(0, this.concrete - d.concrete); this.totals.concreteUsed += d.concrete; }
    const pay = d.zone * CONFIG.pay.perM3, protect = d.out * CONFIG.pay.protectFine, land = (d.land ?? 0) * CONFIG.pay.landFee;
    let bomb = 0;
    if (d.bombs) { bomb = 4500 * d.bombs; this.totals.bombs += d.bombs; this.say(`Blindgänger! Der Kampfmittelräumdienst rückt aus (−${bomb} CHF).`, 'bad'); this.notify('Fliegerbombe! Kampfmittelräumdienst −4500 CHF', 'bad'); }
    this.money += pay - protect - land - d.fines - d.repairs - bomb;
    // Rohstoffvorkommen mit Konzession: der Preisaufschlag wird sofort bar bezahlt
    let premium = 0;
    for (const [id, vol] of Object.entries(d.dep ?? {})) {
      const dep = this.river.deposits[id - 1];
      if (!dep) continue;
      if (dep.owned) premium += vol * materialPrice(dep.kind, this.stats, this.market) * (dep.mult - 1);
      else if (vol > 0.5) this.depositNoConcession = dep.id;
    }
    if (premium) { this.money += premium; this.totals.premium += premium; if (premium > 40) this.flash.push({ x: this.site?.x ?? 3, y: this.site?.y ?? 3, text: `+${Math.round(premium)}`, color: '#ffd24d' }); }
    const t = this.totals, y = this.today;
    t.pay += pay; t.removed += d.removed; t.fines += d.fines; t.repairs += d.repairs; t.protectFines += protect; t.landFees += land; t.landRemoved += d.land ?? 0;
    y.pay += pay; y.costs += protect + land + d.fines + d.repairs + bomb;
  }

  update(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    const K = CONFIG.water, W = this.water;
    if (W.until && this.time >= W.until) { W.target = K.base; W.until = 0; }
    this.wl += (W.target - this.wl) * Math.min(1, dt * K.followRate);
    for (const m of this.maps) m.river.wl = this.wl;
    const wasClosed = this.closed;
    this.closed = this.wl > K.base + K.floodClose;
    if (this.closed !== wasClosed) { this.say(this.closed ? 'Schifffahrt gesperrt (Hochwasser).' : 'Schifffahrt wieder frei.', this.closed ? 'bad' : 'good'); if (!this.closed) this.notify('Schifffahrt wieder frei', 'good'); }

    const mixerOn = this.stats.mixer > 0 && this.divertAgg, C = CONFIG.concrete;
    const divert = mixerOn ? { [KIND.kies]: { room: C.aggCap - this.agg.kies }, [KIND.sand]: { room: C.aggCap - this.agg.sand } } : null;
    const pl = processPlant(this.stock, dt, this.stats, this.maps[0].market, divert); // die Anlage verkauft zu den Preisen der ersten Karte
    if (mixerOn) { this.agg.kies += pl.moved[KIND.kies]; this.agg.sand += pl.moved[KIND.sand]; }
    if (this.stats.mixer > 0) { // Betonwerk: mischt aus Kies und Sand des Flusses (plus Zement)
      const m = Math.min(this.stats.mixRate * dt, C.stockCap - this.concrete, this.agg.kies / C.mix.kies, this.agg.sand / C.mix.sand);
      if (m > 1e-9) {
        this.agg.kies -= m * C.mix.kies; this.agg.sand -= m * C.mix.sand; this.concrete += m;
        const cost = m * C.cement; this.money -= cost; this.totals.cementCost += cost; this.totals.concreteMixed += m; this.today.costs += cost;
      }
    }
    if (pl.vol > 0) {
      this.money += pl.net; this.totals.plantNet += pl.net; this.today.plant += pl.net;
      const rf = refundFrac(this); if (rf > 0 && pl.by[KIND.altlast] < 0) { const back = -pl.by[KIND.altlast] * rf; this.money += back; this.totals.plantNet += back; this.today.plant += back; this.port.refunded = (this.port.refunded ?? 0) + back; } // Sanierungsanlage
      for (let k = 0; k < 5; k++) { if (pl.by[k] >= 0) this.totals.sold += pl.by[k]; else this.totals.disposal -= pl.by[k]; }
    }

    const cur = this.mapIdx; // alle Karten laufen weiter: Flotte, Verkehr und Flussbett der anderen Karten arbeiten im Hintergrund
    for (let k = 0; k < this.maps.length; k++) {
      this.mapIdx = k;
      this.river.wl = this.wl;
      this.river.settle();
      this.sedClock += dt;
      if (this.sedClock >= 1) { this.river.deposit(this.sedClock); this.sedClock = 0; }
      this.fairClock -= dt;
      if (this.fairClock <= 0) { this.analyze(); this.fairClock = 0.6; }
      this.updateGlut(dt);
      updatePort(this, dt);
      updateFleet(this, dt);
      updateTraffic(this, dt);
    }
    updateShipping(this, dt);
    this.mapIdx = cur;

    const day = Math.floor(this.time / CONFIG.daySeconds) + 1;
    while (this.day < day && this.status === 'playing') { this.day++; this.dayEnd(); }
    if (this.status === 'playing') {
      if (this.money < CONFIG.bankruptcyLimit) this.finish('bankrupt');
      else if (this.time >= this.totalSeconds) this.finish('deadline');
    }
  }

  dayEnd() {
    const t = this.totals, levelSum = Object.values(this.levels).reduce((a, b) => a + b, 0);
    const cost = CONFIG.dailyCost + CONFIG.perUpgradeLevelCost * levelSum;
    const wages = CONFIG.fleet.wage * this.maps.reduce((a, m) => a + m.fleet.units.filter((u) => !u.self).length, 0);
    this.money -= cost + wages; t.opCost += cost; t.wages += wages;
    const y = this.today;
    y.costs += cost + wages;
    this.say(`Tag ${this.day - 1}: ${y.ships} Schiffe, ${y.tons.toLocaleString('de-CH')} t · Verkehr +${y.income.toLocaleString('de-CH')} · Anlage ${y.plant >= 0 ? '+' : '−'}${Math.abs(Math.round(y.plant)).toLocaleString('de-CH')} · Kosten −${Math.round(y.costs).toLocaleString('de-CH')}${y.rejected ? ` · ${y.rejected} abgewiesen` : ''}`, 'info');
    this.today = freshDay();
    { const c0 = this.mapIdx; for (let k = 0; k < this.maps.length; k++) { this.mapIdx = k; stepMarket(this.market, this.rng); portDay(this); } this.mapIdx = c0; }
    const cur = this.mapIdx;
    for (const e of this.eventsOn ? EVENTS : []) {
      if (this.rng() < e.chance && (!e.when || e.when(this))) {
        if (this.maps.length > 1) this.mapIdx = Math.floor(this.rng() * this.maps.length); // Ereignisse treffen eine zufällige Karte
        const r = e.apply(this);
        if (r) { const t = this.maps.length > 1 ? `${this.maps[this.mapIdx].name}: ${r.text}` : r.text; this.say(t, r.kind); this.notify(t, r.kind); }
        this.mapIdx = cur;
      }
    }
    this.depositsDay();
    updateContracts(this);
    if (this.goalReached && !this.goalSeen) {
      this.goalSeen = true;
      this.say(`Verkehrsziel erreicht (${this.level.goalTons.toLocaleString('de-CH')} t)! Du kannst abschliessen oder weiterspielen.`, 'good');
      this.notify('Verkehrsziel erreicht! Im Panel kannst du abschliessen.', 'good');
    }
  }

  // Spiel beenden: 'goal' = freiwillig nach erreichtem Ziel, 'deadline' = Frist abgelaufen, 'bankrupt' = Konzession entzogen
  finish(reason) {
    if (this.status !== 'playing') return false;
    if (reason === 'goal' && !this.goalReached) return false;
    this.status = 'ended';
    this.end = { reason, finalMoney: Math.round(this.money), goalReached: this.goalReached };
    return true;
  }

  get won() { return this.status === 'ended' && this.end.reason !== 'bankrupt' && this.end.goalReached && this.end.finalMoney > 0; }
}

// Felder der aktuellen Karte: Game.river, .traffic, .fleet, .zones ... lesen und schreiben in maps[mapIdx]
for (const key of ['market', 'port', 'river', 'traffic', 'fleet', 'zones', 'zoneSeq', 'unlocked', 'fairSig', 'fair', 'fairClock', 'sedClock', 'rejectedBy', 'site']) {
  Object.defineProperty(Game.prototype, key, { get() { return this.maps[this.mapIdx][key]; }, set(v) { this.maps[this.mapIdx][key] = v; }, enumerable: false, configurable: true });
}
