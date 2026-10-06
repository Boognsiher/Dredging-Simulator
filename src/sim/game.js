import { CONFIG, UPGRADES, SHIPS, KIND, levelById } from '../config.js';
import { toolAvailable } from './slice.js';
import { River } from './river.js';
import { carveFairway, analyzeFairway, zonePlan } from './fairway.js';
import { DredgeSim } from './dredge.js';
import { EVENTS } from './events.js';
import { computeStats, upgradeCost } from './stats.js';
import { createRng } from './rng.js';
import { createMarket, stepMarket } from './market.js';
import { createTraffic, updateTraffic, maxZones, zoneClasses, zoneSupports, activeClasses } from './traffic.js';
import { processPlant, stockTotal, materialPrice } from './plant.js';
import { updateContracts } from './contracts.js';
import { createFleet, updateFleet } from './fleet.js';

const freshDay = () => ({ ships: 0, tons: 0, income: 0, costs: 0, plant: 0, pay: 0, rejected: 0 });

// Gesamtzustand des Spiels (Management-Ebene), läuft in Echtzeit. Kein DOM, kein Canvas.
// Gewonnen hat, wer am Ende am meisten Geld hat; das Verkehrsziel (goalTons) schaltet das nächste Level frei.
export class Game {
  constructor(seed = Date.now() & 0xffffff, levelId = 'hochrhein') {
    this.seed = seed;
    this.levelId = levelById(levelId).id;
    this.rng = createRng(seed);
    const L = levelById(this.levelId);
    this.river = River.generate(this.rng, L.river);
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
    this.tool = 'pump'; // zuletzt gewähltes Gerät des eigenen Pontons
    this.concrete = 0; // Betonvorrat in m³ (gekauft oder im Betonwerk gemischt)
    this.agg = { kies: 0, sand: 0 }; // Lager für das Betonwerk (m³)
    this.divertAgg = true; // Kies und Sand ins Betonwerk statt verkaufen
    this.market = createMarket();
    this.traffic = createTraffic();
    this.fleet = createFleet();
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
    this.analyze();
    carveFairway(this.river, this.wl, SHIPS.find((s) => s.id === L.classes[0])); // die kleinste Klasse kann von Anfang an fahren
    this.analyze(true);
  }

  get level() { return levelById(this.levelId); }
  get stats() { return (this._stats ??= computeStats(this.levels)); }
  get stockTotal() { return stockTotal(this.stock); }
  get bufferRoom() { return Math.max(0, this.stats.bufferCapacity - this.stockTotal); }
  get deadlineDays() { return this.level.deadlineDays ?? CONFIG.deadlineDays; }
  get totalSeconds() { return this.deadlineDays * CONFIG.daySeconds; }
  get timeLeft() { return Math.max(0, this.totalSeconds - this.time); }
  get goalReached() { return this.totals.tons >= this.level.goalTons; }

  notify(text, kind = 'info') { this.notes.push({ text, kind }); }
  say(text, kind = 'info') { this.log.unshift({ day: this.day, text, kind }); this.log.length = Math.min(this.log.length, 60); }

  setWater(target, days) { this.water = { target, until: this.time + days * CONFIG.daySeconds }; }

  nextUpgradeCost(id) { return this.levels[id] >= UPGRADES[id].maxLevel ? null : upgradeCost(id, this.levels[id]); }

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
        if (!silent && was !== undefined) { this.say(`Neue Schiffsklasse freigeschaltet: ${cls.name}! Reedereien schicken ab jetzt solche Schiffe.`, 'good'); this.notify(`${cls.icon} ${cls.name} freigeschaltet: ab jetzt kommen solche Schiffe`, 'good'); }
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
  concessionBlock(id) {
    const d = this.river.deposits[id - 1];
    if (!d || !d.known) return 'Erst erkunden';
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
    this.river.wl = this.wl;
    const wasClosed = this.closed;
    this.closed = this.wl > K.base + K.floodClose;
    if (this.closed !== wasClosed) { this.say(this.closed ? 'Schifffahrt gesperrt (Hochwasser).' : 'Schifffahrt wieder frei.', this.closed ? 'bad' : 'good'); if (!this.closed) this.notify('Schifffahrt wieder frei', 'good'); }

    const mixerOn = this.stats.mixer > 0 && this.divertAgg, C = CONFIG.concrete;
    const divert = mixerOn ? { [KIND.kies]: { room: C.aggCap - this.agg.kies }, [KIND.sand]: { room: C.aggCap - this.agg.sand } } : null;
    const pl = processPlant(this.stock, dt, this.stats, this.market, divert);
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
      for (let k = 0; k < 5; k++) { if (pl.by[k] >= 0) this.totals.sold += pl.by[k]; else this.totals.disposal -= pl.by[k]; }
    }

    this.river.settle();
    this.sedClock += dt;
    if (this.sedClock >= 1) { this.river.deposit(this.sedClock); this.sedClock = 0; }

    this.fairClock -= dt;
    if (this.fairClock <= 0) { this.analyze(); this.fairClock = 0.6; }

    updateFleet(this, dt);
    updateTraffic(this, dt);

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
    const wages = CONFIG.fleet.wage * this.fleet.units.length;
    this.money -= cost + wages; t.opCost += cost; t.wages += wages;
    const y = this.today;
    y.costs += cost + wages;
    this.say(`Tag ${this.day - 1}: ${y.ships} Schiffe, ${y.tons.toLocaleString('de-CH')} t · Verkehr +${y.income.toLocaleString('de-CH')} · Anlage ${y.plant >= 0 ? '+' : '−'}${Math.abs(Math.round(y.plant)).toLocaleString('de-CH')} · Kosten −${Math.round(y.costs).toLocaleString('de-CH')}${y.rejected ? ` · ${y.rejected} abgewiesen` : ''}`, 'info');
    this.today = freshDay();
    stepMarket(this.market, this.rng);
    for (const e of this.eventsOn ? EVENTS : []) {
      if (this.rng() < e.chance && (!e.when || e.when(this))) {
        const r = e.apply(this);
        if (r) { this.say(r.text, r.kind); this.notify(r.text, r.kind); }
      }
    }
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
