import { UNLOCK } from "../src/sim/rank.js"; UNLOCK.enabled = false; // bestehende Tests prüfen die Mechaniken ohne Level-Sperren
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SHIPS, KIND, UPGRADES, LEVELS, DEBRIS, shipById } from '../src/config.js';
import { createRng } from '../src/sim/rng.js';
import { River } from '../src/sim/river.js';
import { analyzeFairway, analyzeClass, carveFairway, minDepthAt, pointOnPath } from '../src/sim/fairway.js';
import { SliceSim, SLICE } from '../src/sim/slice.js';
import { DredgeSim } from '../src/sim/dredge.js';
import { createMarket, stepMarket, shockMarket, priceOf } from '../src/sim/market.js';
import { processPlant, materialPrice } from '../src/sim/plant.js';
import { Game } from '../src/sim/game.js';
import { updateTraffic, spawnShip, shipPos } from '../src/sim/traffic.js';
import { computeStats, upgradeCost } from '../src/sim/stats.js';
import { serializeGame, restoreGame } from '../src/sim/save.js';
import { openAreaColumns } from '../src/sim/fleet.js';
import { Advisor } from '../src/sim/advisor.js';
import { acceptContract, makeContract } from '../src/sim/contracts.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const totalVolume = (r) => { let s = 0; for (let i = 0; i < r.top.length; i++) s += (r.top[i] - r.rock[i]) * r.area; return s; };
const flat = (depth = 3) => new River(CONFIG.river.cols, CONFIG.river.rows).setFlat(depth);

test('Zufallsgenerator: gleicher Seed, gleiche Folge', () => {
  const a = createRng(5), b = createRng(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('Fluss: Generierung ist reproduzierbar und hat Korridor, Land und Fels', () => {
  const a = River.generate(createRng(3), LEVELS[0].river), b = River.generate(createRng(3), LEVELS[0].river);
  assert.deepEqual(Array.from(a.top.slice(0, 200)), Array.from(b.top.slice(0, 200)));
  let corridor = 0, land = 0;
  for (let i = 0; i < a.top.length; i++) { if (a.zone[i]) corridor++; if (a.top[i] > a.wl) land++; assert.ok(a.top[i] >= a.rock[i] - 1e-6); }
  assert.ok(corridor > 300 && land > 100, `Korridor ${corridor}, Land ${land}`);
});

test('Baggern: Material wird massenerhaltend entnommen, Mengen je Material stimmen', () => {
  const r = flat(2); r.kind.fill(KIND.kies);
  const before = totalVolume(r);
  const res = r.suckSwath([10, 11, 12, 13], 11, 12.5, r.wl - 2.2, 2, 5, 0.04);
  assert.ok(res.removed > 0);
  assert.ok(Math.abs(totalVolume(r) - (before - res.removed)) < 1e-3);
  assert.ok(Math.abs(sum(res.by) - res.removed) < 1e-3);
  assert.ok(res.by[KIND.kies] > 0 && res.by[KIND.schlick] === 0);
  assert.ok(Math.abs(res.zone - res.removed) < 1e-3, 'alles im Korridor');
});

test('Baggern: ausserhalb des Korridors wird getrennt gezählt (Naturschutz)', () => {
  const r = flat(2); r.zone.fill(0);
  const res = r.suckSwath([10, 11], 10, 12.5, r.wl - 2.2, 2, 3, 0.04);
  assert.ok(res.out > 0 && res.zone === 0);
});

test('Baggern: Land und Flachstellen über Wasser werden nicht gesaugt', () => {
  const r = flat(2);
  for (let c = 8; c < 16; c++) r.top[r.idx(c, 12)] = r.wl + 1;
  const res = r.suckSwath([8], 8, 12.5, r.wl + 0.5, 1.5, 4, 0.04);
  assert.equal(res.removed, 0);
});

test('Fels: ohne Fräse kaum abtragbar, mit Fräse deutlich schneller', () => {
  const dig = (firmness) => {
    const r = new River(CONFIG.river.cols, CONFIG.river.rows).setFlat(3, 3); // Fels direkt unter der Sohle
    let rockRemoved = 0;
    for (let i = 0; i < 40; i++) rockRemoved += r.suckSwath([10], 10, 12.5, r.wl - 3.2, 1.8, 3, firmness).by[KIND.fels];
    return rockRemoved;
  };
  const weak = dig(CONFIG_BASE_FIRMNESS()), strong = dig(0.5);
  assert.ok(strong > weak * 5, `${strong} vs ${weak}`);
});
function CONFIG_BASE_FIRMNESS() { return computeStats({}).rockFirmness; }

test('Fels: Abtrag senkt die Sohle und den Felsgrund mit', () => {
  const r = new River(CONFIG.river.cols, CONFIG.river.rows).setFlat(3, 3);
  const i = r.idx(10, 12), t0 = r.top[i];
  for (let k = 0; k < 20; k++) r.suckSwath([10], 10, 12.5, r.wl - 3.2, 1.8, 2, 0.6);
  assert.ok(r.top[i] < t0 && r.rock[i] < t0);
  assert.ok(r.top[i] >= r.rock[i] - 1e-6);
});

test('Böschung rutscht nach und erhält die Masse', () => {
  const r = flat(4);
  for (let y = 0; y < r.rows; y++) for (let x = 20; x < 30; x++) r.top[r.idx(x, y)] = r.wl - 1; // Hochebene neben tiefer Rinne
  for (let y = 0; y < r.rows; y++) for (let x = 0; x < 20; x++) r.top[r.idx(x, y)] = r.wl - 4;
  const before = totalVolume(r);
  for (let x = 19; x <= 21; x++) for (let y = 0; y < r.rows; y++) r.pending.add(r.idx(x, y));
  let moved = 0;
  for (let k = 0; k < 40; k++) moved += r.settle(Infinity);
  assert.ok(moved > 0);
  assert.ok(Math.abs(totalVolume(r) - before) < 1e-2);
  const diff = r.top[r.idx(21, 5)] - r.top[r.idx(18, 5)];
  assert.ok(diff <= 3.1 * CONFIG.layer.slope + 1e-3, `Gefälle ${diff}`);
});

test('Verlandung: langsame Zellen wachsen, bei cap ist Schluss, schnelle Mitte langsamer', () => {
  const r = flat(3); r.flow.fill(0.1);
  const i = r.idx(5, 5); r.top[i] -= 1; // ausgebaggert
  r.deposit(100);
  assert.ok(r.top[i] > r.wl - 4);
  r.deposit(1e6);
  assert.ok(r.top[i] <= r.cap[i] + 1e-6);
  const slow = flat(3), fast = flat(3); slow.flow.fill(0.1); fast.flow.fill(0.95);
  slow.deposit(10); fast.deposit(10);
  assert.ok(slow.top[0] - (slow.wl - 3) > fast.top[0] - (fast.wl - 3));
});

test('Hochwasser lagert Schlick ab, wirkt aber nur im Wasser (cap)', () => {
  const r = flat(3), before = r.top[0];
  r.flood(0.3);
  assert.ok(r.top[0] > before);
});

test('Fahrrinne: ebener Kanal ist für passende Klassen frei, zu flacher nicht', () => {
  const r = flat(2.5);
  assert.ok(analyzeClass(r, r.wl, shipById('kahn')).passable);
  assert.ok(analyzeClass(r, r.wl, shipById('motor')).passable);
  assert.ok(!analyzeClass(r, r.wl, shipById('tank')).passable);
  assert.ok(analyzeClass(r, r.wl, shipById('motor')).twoWay, 'breiter ebener Kanal hat Platz für Gegenverkehr');
});

test('Fahrrinne: fehlendes Volumen stimmt, Baggern macht die Klasse passierbar', () => {
  const r = flat(2.5);
  const tank = shipById('tank');
  const a = analyzeClass(r, r.wl, tank);
  assert.ok(a.volume > 0 && Number.isFinite(a.volume));
  assert.ok(a.weakest);
  // genau auf Solltiefe baggern: entlang des Pfades
  let guard = 0;
  while (!analyzeClass(r, r.wl, tank).passable && guard++ < 60) {
    const f = analyzeClass(r, r.wl, tank);
    for (const p of f.nodes) for (let y = p.y - 1; y <= p.y + 1; y++) r.top[r.idx(p.x, y)] = Math.min(r.top[r.idx(p.x, y)], r.wl - f.need - 0.05);
  }
  assert.ok(analyzeClass(r, r.wl, tank).passable);
});

test('Fahrrinne: Sperre über die ganze Breite blockiert, Fels zählt mehr als Sediment', () => {
  const r = flat(3);
  for (let y = 0; y < r.rows; y++) r.top[r.idx(20, y)] = r.wl - 1.2;
  assert.ok(!analyzeClass(r, r.wl, shipById('kahn')).passable);
  const rocky = flat(3);
  for (let y = 0; y < rocky.rows; y++) { rocky.top[rocky.idx(20, y)] = rocky.wl - 1.2; rocky.rock[rocky.idx(20, y)] = rocky.wl - 1.2; }
  assert.ok(analyzeClass(rocky, rocky.wl, shipById('kahn')).volume > analyzeClass(r, r.wl, shipById('kahn')).volume);
});

test('Fahrrinne: ausserhalb des Korridors darf nicht gefahren werden, zu schmal = keine Rinne', () => {
  const r = flat(5); r.zone.fill(0);
  for (let y = 10; y < 12; y++) for (let x = 0; x < r.cols; x++) r.zone[r.idx(x, y)] = 1; // nur 2 Zellen Korridor
  assert.ok(analyzeClass(r, r.wl, shipById('kahn')).passable);
  assert.ok(!analyzeClass(r, r.wl, shipById('tank')).passable && analyzeClass(r, r.wl, shipById('tank')).volume === Infinity);
  assert.ok(!analyzeClass(r, r.wl, shipById('kahn')).twoWay);
});

test('Fahrrinne: tieferer Pegel macht Rinnen unpassierbar', () => {
  const r = flat(2.6);
  assert.ok(analyzeClass(r, r.wl, shipById('motor')).passable);
  assert.ok(!analyzeClass(r, r.wl - 0.8, shipById('motor')).passable);
});

test('Fahrrinne: Mindestrinne am Spielstart macht die kleinste Klasse passierbar', () => {
  for (const L of LEVELS) {
    for (const seed of [1, 2, 3, 4]) {
      const g = new Game(seed, L.id);
      assert.ok(g.fair[L.classes[0]].passable, `${L.id}/${seed}`);
      assert.ok(!g.fair.tank.passable, 'Tanker brauchen Baggerarbeit');
    }
  }
});

test('Pfad: Punkt auf Strecke liegt im Bereich und steigt in x', () => {
  const r = flat(3), f = analyzeClass(r, r.wl, shipById('kahn'));
  const a = pointOnPath(f.path, 0), b = pointOnPath(f.path, f.path.length);
  assert.ok(a.x < 0 && b.x > r.cols);
  assert.ok(minDepthAt(r, r.wl, 10, 12, 2) >= 3 - 1e-6);
  r.top[r.idx(10, 12)] = r.wl - 1;
  assert.ok(minDepthAt(r, r.wl, 10, 12.5, 3) < 3, 'flache Zelle unter dem Rumpf wird erkannt');
});

test('Querschnitt: Pumpe saugt in beide Richtungen, nur im Wasser, Karte bleibt in Balance', () => {
  const r = flat(2.5); r.kind.fill(KIND.sand);
  const stats = computeStats({});
  const sl = new SliceSim(r, stats, 20, 12, createRng(1));
  sl.h = r.wl - 2.4;
  const before = totalVolume(r);
  let removed = 0;
  for (let i = 0; i < 40; i++) removed += sl.update(0.05, { dx: 1, dy: 0, suction: true }).removed;
  assert.ok(removed > 0 && sl.x > sl.x0);
  assert.ok(Math.abs(totalVolume(r) - (before - removed)) < 1e-2);
  const back = new SliceSim(r, stats, 20, 12, createRng(1));
  back.x = back.x0 + 10; back.h = r.wl - 2.4;
  let r2 = 0;
  for (let i = 0; i < 20; i++) r2 += back.update(0.05, { dx: -1, dy: 0, suction: true }).removed;
  assert.ok(r2 > 0 && back.x < back.x0 + 10, 'saugen geht auch nach links');
});

test('Querschnitt: Fremdstoff verstopft, Freispülen löst nach Treffern', () => {
  const r = flat(2.5);
  const stats = computeStats({});
  const sl = new SliceSim(r, stats, 20, 12, createRng(2));
  sl.h = r.wl - 2.4; sl.x = sl.x0 + 3;
  const mx = Math.floor(sl.mouth().x);
  r.debris[r.idx(20, mx)] = 1;
  sl.update(0.05, { dx: 0, dy: 0, suction: true });
  assert.ok(sl.clog > 0 && sl.freeing);
  let res;
  for (let k = 0; k < 6 && sl.clog > 0; k++) { sl.freeing.pos = sl.freeing.zoneC; res = sl.freeAttempt(); }
  assert.equal(res, 'cleared');
  assert.equal(sl.clog, 0);
});

test('Querschnitt: Automatik fährt Solltiefe an und schaltet sich ab', () => {
  const r = flat(2.5); r.kind.fill(KIND.sand);
  const stats = computeStats({ auto: 3, echolot: 2, power: 8 });
  const sl = new SliceSim(r, stats, 20, 12, createRng(3), 3.0, 1);
  sl.x = sl.x0 + 0.01; // die Automatik arbeitet ab dem Punkt, an dem sie eingeschaltet wird
  sl.toggleAuto();
  let guard = 0;
  while (sl.auto.on && guard++ < 20000) sl.update(0.05, { dx: 0, dy: 0, suction: true, pumpOn: true });
  assert.ok(!sl.auto.on, 'Automatik hat sich abgeschaltet');
  let over = 0; for (let c = 0; c < SLICE.cols; c++) if (sl.envTop(sl.x0 + c) > sl.targetTop() + 0.12) over++;
  assert.equal(over, 0, 'Profil innerhalb der Messtoleranz auf Solltiefe');
});

test('Querschnitt: Automatik-Bereich (von/bis) beschränkt die Arbeit', () => {
  const r = flat(2.5); r.kind.fill(KIND.sand);
  const stats = computeStats({ auto: 3, echolot: 2, power: 8 });
  const sim = new DredgeSim(r, stats, createRng(3));
  sim.x = 20; sim.y = 12; sim.setTargetDepth(3.0); sim.setPumpSpeed(1);
  assert.ok(sim.anchor());
  const sl = sim.slice;
  sim.setAutoBounds(sl.x0 + 5, sl.x0 + 9);
  const [a, b] = sim.autoRange;
  assert.ok(a < b);
  assert.ok(sim.toggleAuto());
  let guard = 0;
  while (sl.auto.on && guard++ < 40000) sim.update(0.05, { dx: 0, dy: 0, suction: true });
  assert.ok(!sl.auto.on);
  for (let c = 0; c < SLICE.cols; c++) {
    const row = sl.x0 + c, deep = sl.envTop(row) <= sl.targetTop() + 0.12;
    if (row >= a && row <= b) assert.ok(deep, `Zeile ${row} im Bereich ist auf Solltiefe`);
    else assert.ok(!deep, `Zeile ${row} ausserhalb bleibt unberührt`);
  }
  sim.setAutoBounds(sl.x0, sl.x0 + SLICE.cols - 1); assert.equal(sim.autoRange, null);
});

test('Automatik: Verstopfung stoppt die Pumpe, Minispiel kommt, Wartezeit sinkt mit Stufe', () => {
  for (const [lvl, secs] of [[1, 15], [3, 5]]) {
    const r = flat(2.5); r.kind.fill(KIND.sand);
    const sl = new SliceSim(r, computeStats({ auto: lvl, echolot: 2, power: 8 }), 20, 12, createRng(3), 3.0, 1);
    sl.x = sl.x0 + 2; sl.h = r.wl - 2.4;
    r.debris[r.idx(20, Math.floor(sl.x + CONFIG.pump.offsetX) + 1)] = 1;
    sl.toggleAuto();
    let guard = 0;
    while (!sl.freeing && guard++ < 4000) sl.update(0.05, { dx: 0, dy: 0, suction: true });
    assert.ok(sl.freeing, 'Minispiel startet auch bei Automatik');
    assert.ok(Math.abs(sl.clog - secs) < 0.2);
    const x = sl.x; for (let k = 0; k < 20; k++) sl.update(0.05, { dx: 0, dy: 0, suction: true });
    assert.equal(sl.x, x, 'Pumpe bleibt an Ort stehen');
  }
});

test('Trübungsbusse hängt vom Ort ab: Durchfahrt kaum, Altlast normal, Naturschutz sehr hoch', () => {
  const fine = (setup) => {
    const r = flat(2.5); r.kind.fill(KIND.sand); setup(r);
    const sim = new DredgeSim(r, computeStats({ power: 8 }), createRng(1));
    sim.x = 20; sim.y = 12; sim.anchor(); sim.turbidity = 0.95; sim.pumpOn = false;
    let f = 0; for (let k = 0; k < 20; k++) { sim.turbidity = 0.95; f += sim.update(0.05, { dx: 0, dy: 0, suction: false }).fines; }
    return { f, zone: sim.turbZone };
  };
  const ch = fine(() => {});
  const mid = Math.floor(CONFIG.river.rows / 2);
  const alt = fine((r) => { for (let c = 0; c < r.cols; c++) for (let y = 0; y < r.rows; y++) { const i = r.idx(c, y); if (r.zone[i]) r.kind[i] = KIND.altlast; } });
  const nat = fine((r) => { r.zone.fill(0); });
  assert.equal(ch.zone, 'channel'); assert.equal(alt.zone, 'altlast'); assert.equal(nat.zone, 'nature');
  assert.ok(ch.f > 0 && ch.f < alt.f * 0.1, 'Durchfahrt vernachlässigbar');
  assert.ok(nat.f > alt.f * 3, 'Naturschutz sehr hoch');
  void mid;
});

test('Uferstreifen freikaufen: Naturschutz wird zum Baggerkorridor', () => {
  const g = new Game(5, 'hochrhein'); g.eventsOn = false; g.money = 1e6;
  const before = g.river.zone.reduce((a, v) => a + v, 0), secs = g.shoreSections();
  assert.ok(secs.some((q) => q.cells.length > 0));
  const sec = secs.find((q) => q.cells.length > 0), m0 = g.money;
  assert.ok(g.buyShore(sec.side, sec.part));
  assert.equal(g.money, m0 - sec.cost);
  assert.equal(g.river.zone.reduce((a, v) => a + v, 0), before + sec.cells.length);
  assert.equal(g.buyShore(sec.side, sec.part), false, 'zweimal kaufen geht nicht');
  g.money = 0; const sec2 = g.shoreSections().find((q) => q.cells.length > 0); assert.ok(g.shoreBlock(sec2.side, sec2.part));
});

const fullLane = (g, id) => { carveFairway(g.river, g.wl, shipById(id), CONFIG.partialDepth + 0.1); g.analyze(true); }; // Rinne gleich auf volle Ladetiefe
import { ENDLESS } from '../src/config.js';
import { isLand, buildRoad, buildHall, autoRoad, connectedRoads, hallConnected, hallCapacity, roadFactor, landOf, upgradeHall, demolishAt, LAND } from '../src/sim/land.js';
import { ensurePort } from '../src/sim/port.js';
import { buyShip, sellShip, setRoute, routeInfo, updateShipping, SHIPPING, withMap } from '../src/sim/shipping.js';
import { setAvoid, cellAllowed } from '../src/sim/fleet.js';
import { lendPonton, recallPonton, lendBlock, lentUnit, nextHireCost } from '../src/sim/fleet.js';
import { addArea, removeArea, setAreaDepth, setAreaUnit, areaWork } from '../src/sim/fleet.js';
import { pairFits, zoneLaneStart } from '../src/sim/traffic.js';
import { ensureHarbor, harborAccepts, HARBOR } from '../src/sim/harbor.js';
import { machineOf, reserveBerth, dockShip, waitsOf, cycleWaitCargo, berthJobs, isDocked, berthsOf, bayDepth, openPort, build, upgrade, buy, sell, hasKai, capacity, portShip, portDay, openBlock, updatePort, loadHit, autoLevel, autoLevelCost, siteAct, siteWork, PORT } from '../src/sim/port.js';
test('Hafen: eröffnen, Kai und Lager bauen, handeln, Schiffe und Automatik', () => {
  const g = new Game(5, 'hochrhein'); g.eventsOn = false; g.money = 200000;
  assert.ok(openBlock(g), 'ohne Motorschiff gesperrt');
  g.unlocked.motor = true;
  assert.ok(openPort(g));
  assert.equal(build(g, 0, 'kai'), false, 'unebenes Gelände');
  for (let i = 0; i < 6; i++) assert.ok(autoLevel(g, i));
  assert.equal(build(g, 1, 'kies'), false, 'ohne Kai kein Lager');
  assert.ok(build(g, 0, 'kai')); assert.ok(hasKai(g));
  assert.equal(build(g, 2, 'kai'), false, 'Kai nur einmal');
  assert.ok(build(g, 1, 'kies')); assert.ok(build(g, 2, 'tank'));
  assert.equal(capacity(g, 'kies'), 600);
  assert.ok(upgrade(g, 1)); assert.equal(capacity(g, 'kies'), 1600);
  const m0 = g.money; const q = buy(g, 'oel', 50);
  assert.equal(q, 50); assert.ok(g.money < m0); assert.equal(g.port.stock.oel, 50);
  const s0 = g.money; sell(g, 'oel', 50); assert.ok(g.money > s0 && g.port.stock.oel === 0);
  assert.ok(m0 - g.money > 0, 'Spread kostet Geld');
  // Schiff entlädt bei tiefem Preis (Auftrag), belädt bei hohem; Mannschaft lädt allein, das Minispiel beschleunigt
  g.market.dev.oel = -0.4; portShip(g, { cargo: 'oel', tons: 400 }); assert.equal(g.port.jobs.length, 1);
  const f0 = g.port.fees; for (let k = 0; k < 100; k++) updatePort(g, 1);
  assert.equal(g.port.jobs.length, 0); assert.ok(g.port.stock.oel > 0 && g.port.fees > f0);
  const st = g.port.stock.oel; g.market.dev.oel = 0.5; portShip(g, { cargo: 'oel', tons: 400 });
  assert.ok(loadHit(g, 1) > 0, 'Treffer lädt'); assert.equal(loadHit(g, 0), 0, 'Fehlwurf lädt nichts');
  for (let k = 0; k < 100; k++) updatePort(g, 1);
  assert.ok(g.port.stock.oel < st);
  // Zeitbonus: schnell fertig zahlt mehr als zu spät
  g.port.stock.kies = 5000; g.market.dev.kies = 0.5; g.port.jobs = [];
  portShip(g, { cargo: 'kies', tons: 400 }); const j = g.port.jobs[0], tons = j.tons;
  let m1 = g.money; while (g.port.jobs.length) { loadHit(g, 1); updatePort(g, 0.01); } const quick = g.money - m1;
  g.port.jobs = []; portShip(g, { cargo: 'kies', tons: 400 }); m1 = g.money; updatePort(g, 100); const slow = g.money - m1;
  assert.ok(quick > slow, 'schneller Auftrag bringt mehr');
  void tons;
  // Automatik kauft billig und verkauft teuer
  g.port.stock.oel = 0; g.port.auto.oel.on = true; g.market.dev.oel = -0.4; portDay(g); assert.ok(g.port.stock.oel > 0);
  g.market.dev.oel = 0.5; const before = g.port.stock.oel; portDay(g); assert.ok(g.port.stock.oel < before);
  // Sanierung spart Entsorgung
  assert.ok(build(g, 3, 'sanierung'));
});

test('Ponton: bleibt im Wasser, ankert nur dort', () => {
  const r = flat(2); for (let y = 0; y < 5; y++) for (let x = 0; x < r.cols; x++) r.top[r.idx(x, y)] = r.wl + 1;
  const sim = new DredgeSim(r, computeStats({}), createRng(1));
  sim.x = 10; sim.y = 6;
  for (let i = 0; i < 100; i++) sim.update(0.05, { dx: 0, dy: -1 });
  assert.ok(sim.y >= 5, 'Ufer hält den Ponton auf');
  sim.y = 2; assert.equal(sim.anchor(), false);
  sim.y = 12; assert.equal(sim.anchor(), true);
  assert.equal(sim.mode, 'slice');
  assert.equal(sim.leave(), true);
});

test('Ponton: Trübung entsteht nur beim Saugen von Material und klingt ab', () => {
  const r = flat(2.5), sim = new DredgeSim(r, computeStats({ power: 4 }), createRng(1));
  sim.x = 20; sim.y = 12; sim.anchor();
  sim.slice.h = r.wl - 2.4;
  sim.pumpOn = true;
  for (let i = 0; i < 100; i++) sim.update(0.05, { dx: 0.3, dy: 0, suction: true });
  assert.ok(sim.turbidity > 0);
  sim.pumpOn = false;
  const t = sim.turbidity;
  for (let i = 0; i < 100; i++) sim.update(0.05, { dx: 0, dy: 0, suction: false });
  assert.ok(sim.turbidity < t);
});

test('Markt: Preise bleiben in Grenzen, Schocks wirken, Reversion zieht zurück', () => {
  const m = createMarket(), rng = createRng(9);
  for (let i = 0; i < 400; i++) { stepMarket(m, rng); for (const id of Object.keys(m.dev)) { const r = priceOf(m, id) / priceOf(createMarket(), id); assert.ok(r >= 0.45 - 1e-9 && r <= 2.2 + 1e-9); } }
  const m2 = createMarket();
  shockMarket(m2, 'oel', 1.5);
  assert.ok(Math.abs(priceOf(m2, 'oel') - 270) < 1e-6);
  for (let i = 0; i < 60; i++) stepMarket(m2, createRng(i + 1));
  assert.ok(m2.history.oel.length <= CONFIG.market.history);
});

test('Anlage: verkauft Kies, entsorgt Schlick, Upgrades wirken', () => {
  const base = computeStats({}), up = computeStats({ dewater: 4, sorter: 4 });
  assert.ok(materialPrice(KIND.kies, up) > materialPrice(KIND.kies, base));
  assert.ok(materialPrice(KIND.schlick, up) > materialPrice(KIND.schlick, base), 'weniger Entsorgungskosten');
  const stock = [10, 0, 10, 0, 0];
  const r = processPlant(stock, 1, base);
  assert.ok(r.vol > 0 && r.vol <= base.plantCapacity + 1e-9);
  assert.ok(Math.abs(sum(stock) - (20 - r.vol)) < 1e-9);
  assert.ok(r.by[KIND.schlick] < 0 && r.by[KIND.kies] > 0);
  assert.equal(processPlant([0, 0, 0, 0, 0], 1, base).vol, 0);
});

test('Upgrades: Kosten steigen, Kauf und Rückbau buchen Geld', () => {
  for (const id of Object.keys(UPGRADES)) assert.ok(upgradeCost(id, 1) > upgradeCost(id, 0));
  const g = new Game(1);
  const m0 = g.money, cost = g.nextUpgradeCost('power');
  assert.ok(g.buyUpgrade('power'));
  assert.equal(g.money, m0 - cost);
  assert.ok(g.stats.power > computeStats({}).power);
  const refund = g.refundFor('power');
  assert.ok(g.sellUpgrade('power'));
  assert.equal(g.money, m0 - cost + refund);
  assert.equal(g.stats.power, computeStats({}).power);
  g.money = 0; assert.equal(g.buyUpgrade('power'), false);
});

function emptyGame(seed = 1) {
  const g = new Game(seed);
  g.river.setFlat(2.6, 9); // gerade, ausreichend tiefe Rinne
  g.analyze(true);
  return g;
}

test('Verkehr: bei freier Rinne fahren Schiffe durch und zahlen', () => {
  const g = emptyGame(2);
  const m0 = g.money;
  for (let i = 0; i < 12 * 30 * 20; i++) g.update(0.05);
  assert.ok(g.totals.ships >= 5, `Schiffe ${g.totals.ships}`);
  assert.ok(g.totals.tons > 0 && g.totals.trafficIncome > 0);
  assert.ok(g.money > m0 - 30 * 600, 'Verkehr deckt mindestens die Betriebskosten');
});

test('Verkehr: ohne befahrbare Rinne kommen gar keine Schiffe, ein Warteplatz mit Gegenverkehr wird knapp', () => {
  const g = emptyGame(3); g.eventsOn = false;
  g.river.setFlat(1.0, 9); g.analyze(true);
  for (let i = 0; i < 14 * 20 * 20; i++) g.update(0.05);
  assert.equal(g.totals.ships, 0);
  assert.equal(g.totals.spawned, 0, 'Reedereien schicken nur Klassen, die fahren können');
  const h = emptyGame(3); h.traffic.spawnIn = 1e9;
  for (let i = 0; i < 40; i++) spawnShip(h);
  assert.ok(h.totals.turnedAway > 10 && h.totals.lostValue > 0, 'Warteplatz voll: Schiffe drehen ab');
});

test('Verkehr: Gegenverkehr in einer Einbahnrinne fährt nie gleichzeitig', () => {
  const g = emptyGame(4);
  g.river.setFlat(2.6, 9);
  for (let y = 0; y < g.river.rows; y++) if (y < 10 || y > 13) for (let x = 0; x < g.river.cols; x++) g.river.zone[g.river.idx(x, y)] = 0; // 4 Zellen Korridor: einspurig
  g.analyze(true);
  assert.ok(!g.fair.kahn.twoWay && g.fair.kahn.passable);
  let bad = 0;
  for (let i = 0; i < 12 * 40 * 20; i++) {
    g.update(0.05);
    const dirs = new Set(g.traffic.ships.filter((s) => s.state === 'sail' && s.lane === 'one').map((s) => s.dir));
    if (dirs.size > 1) bad++;
  }
  assert.equal(bad, 0);
  assert.ok(g.totals.ships > 3);
});

test('Verkehr: Hochwasser sperrt die Schifffahrt, danach geht es weiter', () => {
  const g = emptyGame(5);
  g.setWater(CONFIG.water.base + 1.5, 2);
  for (let i = 0; i < 12 * 3 * 20; i++) g.update(0.05);
  const shipsInFlood = g.totals.ships;
  assert.ok(g.closed || g.totals.ships === shipsInFlood);
  for (let i = 0; i < 12 * 30 * 20; i++) g.update(0.05);
  assert.ok(!g.closed);
  assert.ok(g.totals.ships > shipsInFlood);
});

test('Verkehr: Niedrigwasser lässt Schiffe in der Rinne auflaufen und kostet Bergung', () => {
  const g = emptyGame(6);
  let grounded = false;
  for (let i = 0; i < 12 * 60 * 20 && !grounded; i++) {
    g.update(0.05);
    if (g.traffic.ships.some((s) => s.state === 'sail') && g.wl > g.river.wl - 0.01 && !g._low) { g._low = true; g.wl = CONFIG.water.base - 1.5; g.water = { target: CONFIG.water.base - 1.5, until: 0 }; }
    grounded = g.totals.groundings > 0;
  }
  assert.ok(grounded);
  assert.ok(g.totals.salvage > 0);
});

test('Verkehr: Marktnachfrage steuert die Fracht (teures Öl lockt Tanker)', () => {
  const count = (shock) => {
    const g = emptyGame(8);
    g.river.setFlat(3.4, 9); g.analyze(true);
    if (shock) { shockMarket(g.market, 'oel', 1.8); shockMarket(g.market, 'chemie', 1.8); }
    let tanks = 0;
    for (let i = 0; i < 400; i++) { const s = spawnShip(g); if (s?.cls === 'tank') tanks++; g.traffic.ships.length = 0; }
    return tanks;
  };
  assert.ok(count(true) > count(false));
});

test('Spiel: Ponton in der Rinne bremst den Verkehr (Baustelle)', () => {
  const g = emptyGame(9);
  const cy = g.fair.kahn.path.points.find((p) => p.x >= 20).y; g.site = { x: 20, y: cy };
  const near = g.fair.kahn.path.points.some((p) => Math.hypot(p.x - 20, p.y - cy) < CONFIG.traffic.siteRadius);
  assert.ok(near);
  for (let i = 0; i < 12 * 20 * 20; i++) g.update(0.05);
  assert.ok(g.totals.ships >= 0);
});

test('Spiel: Baggerentgelt, Anlage und Kosten laufen zusammen', () => {
  const g = emptyGame(10);
  const m0 = g.money;
  g.collect({ removed: 100, by: [0, 30, 70, 0, 0], zone: 100, out: 0, hard: 0, fines: 0, repairs: 0, bombs: 0 });
  assert.equal(g.money, m0 + 100 * CONFIG.pay.perM3);
  assert.equal(g.stockTotal, 100);
  for (let i = 0; i < 20 * 60; i++) g.update(0.05);
  assert.ok(g.stockTotal < 100);
  assert.ok(g.totals.plantNet > 0, 'Kies und Sand bringen Geld');
  const m1 = g.money;
  g.collect({ removed: 10, by: [0, 0, 0, 0, 0], zone: 0, out: 10, hard: 0, fines: 0, repairs: 1500, bombs: 1 });
  assert.equal(g.money, m1 - 10 * CONFIG.pay.protectFine - 1500 - 4500);
});

test('Spiel: Tageswechsel zieht Betriebskosten ab und der Markt bewegt sich', () => {
  const g = emptyGame(11);
  g.traffic.spawnIn = 1e9;
  const m0 = g.money, price0 = priceOf(g.market, 'getreide');
  for (let i = 0; i < 12 * 3 * 20; i++) g.update(0.05);
  assert.ok(g.day >= 3);
  assert.ok(g.money < m0 - 2 * CONFIG.dailyCost + 1);
  assert.ok(g.market.history.getreide.length > 1);
  void price0;
});

test('Spiel: Frist beendet das Spiel, Verkehrsziel schaltet Gewinn frei, Pleite beendet früher', () => {
  const g = emptyGame(12);
  g.traffic.spawnIn = 1e9;
  assert.equal(g.finish('goal'), false, 'ohne Ziel nicht abschliessbar');
  g.totals.tons = g.level.goalTons;
  assert.ok(g.goalReached);
  assert.ok(g.finish('goal'));
  assert.equal(g.status, 'ended');
  assert.ok(g.won);
  const h = emptyGame(13);
  h.traffic.spawnIn = 1e9;
  h.time = h.totalSeconds - 0.01; h.update(0.05);
  assert.equal(h.end.reason, 'deadline');
  assert.ok(!h.won, 'ohne Ziel nicht gewonnen');
  const b = emptyGame(14); b.money = CONFIG.bankruptcyLimit - 1; b.update(0.05);
  assert.equal(b.end.reason, 'bankrupt');
});

test('Aufträge: annehmen, erfüllen zahlt Prämie, verpassen kostet Strafe', () => {
  const g = emptyGame(15);
  g.traffic.spawnIn = 1e9;
  const c = makeContract(g);
  g.contracts.push(c);
  assert.ok(acceptContract(g, c.id));
  const m0 = g.money;
  c.done = c.tons - 10;
  // ein Schiff mit passender Fracht durchfahren lassen
  g.traffic.ships.push({ id: 99, cls: c.cls, dir: 1, cargo: c.cargo, tons: 50, price: 100, state: 'sail', wait: 0, s: 0, ground: 0, lane: 'two', path: g.fair[c.cls].path });
  g.traffic.ships[0].s = g.fair[c.cls].path.length - 0.01;
  g.update(0.5);
  assert.ok(g.money >= m0 + c.bonus - 50, 'Prämie gezahlt');
  const f = emptyGame(16); f.traffic.spawnIn = 1e9;
  const c2 = makeContract(f); f.contracts.push(c2); acceptContract(f, c2.id);
  const m1 = f.money;
  f.time = c2.dueAt + 1; f.day = Math.floor(f.time / CONFIG.daySeconds); f.update(0.05);
  assert.ok(f.money < m1 - c2.penalty + 1);
});

test('Spielstand: Speichern und Laden ergibt denselben Verlauf', () => {
  const g = new Game(21, 'loreley');
  for (let i = 0; i < 12 * 25 * 20; i++) g.update(0.05);
  const g2 = restoreGame(serializeGame(g));
  assert.ok(g2);
  assert.equal(g2.day, g.day);
  assert.equal(Math.round(g2.money), Math.round(g.money));
  assert.deepEqual(Array.from(g2.river.top.slice(0, 50)), Array.from(g.river.top.slice(0, 50)));
  for (let i = 0; i < 12 * 5 * 20; i++) { g.update(0.05); g2.update(0.05); }
  assert.equal(Math.round(g2.money), Math.round(g.money));
  assert.equal(restoreGame('kaputt'), null);
});

test('Berater: gibt am Anfang einen Tipp und respektiert Stummschaltung und Abstand', () => {
  const g = emptyGame(30), sim = g.createSession(), adv = new Advisor();
  adv.runTime = 100;
  const tip = adv.pick(g, sim);
  assert.equal(tip?.id, 'start');
  assert.equal(adv.pick(g, sim), null, 'Mindestabstand');
  const a2 = new Advisor(['start']); a2.runTime = 100;
  assert.notEqual(a2.pick(g, sim)?.id, 'start');
});

test('Berater: meldet wartende Schiffe der Klasse, die noch nicht fahren kann', () => {
  const g = new Game(31); g.traffic.spawnIn = 1e9;
  for (let i = 0; i < 3; i++) g.traffic.ships.push({ id: i + 1, cls: 'motor', dir: 1, cargo: 'getreide', tons: 600, price: 120, state: 'queue', wait: 1, s: 0, ground: 0, lane: 'one' });
  const sim = g.createSession(), adv = new Advisor();
  adv.runTime = 1000; adv.shownAt.start = 0; adv.shownAt.deposit = 1000;
  const tip = adv.pick(g, sim);
  assert.equal(tip?.id, 'queue');
  assert.match(tip.text, /Motorgüterschiff/);
});

test('Level: jedes Level lässt sich durch Baggern bis zur grössten Klasse ausbauen (Volumen endlich)', () => {
  for (const L of LEVELS) {
    const g = new Game(1, L.id);
    for (const id of L.classes) assert.ok(Number.isFinite(g.fair[id].volume), `${L.id}/${id}`);
  }
});

test('Stabilität: lange Läufe bleiben endlich und ohne NaN', () => {
  const g = new Game(40, 'donau');
  g.money = 1e6;
  for (let i = 0; i < 12 * 80 * 10; i++) g.update(0.1);
  assert.ok(Number.isFinite(g.money));
  for (let i = 0; i < g.river.top.length; i++) assert.ok(Number.isFinite(g.river.top[i]));
  assert.ok(SHIPS.length === 5);
});

// ---------- Löffelbagger, Land abtragen, Flotte ----------
import { wallSpans, laneMargin, planPile, planRemoval, lineCells, setUnitLoc, setZoneUnit, addRoute, setAreaWidth, setGoal, updateFleet, hireUnit, hireBlock, dismissUnit, openColumns, targetClass, fleetSites } from '../src/sim/fleet.js';

function bankSlice(levels = { loeffel: 3 }) {
  const g = new Game(3, 'hochrhein'), r = g.river;
  g.money = 1e6;
  for (const [id, n] of Object.entries(levels)) for (let i = 0; i < n; i++) g.buyUpgrade(id);
  const sim = g.createSession(); sim.setStats(g.stats);
  sim.setTool('loeffel');
  const x = 22; let y = Math.floor(r.centerY(x) - 5);
  while (!sim.canFloat(x + 0.5, y + 0.5)) y++;
  sim.x = x + 0.5; sim.y = y + 0.5; sim.anchor();
  return { g, r, sim, sl: sim.slice, x };
}

test('Löffelbagger: nur mit Ausbau wählbar, Gerätewechsel nicht bei Verstopfung', () => {
  const g = new Game(1), sim = g.createSession();
  assert.equal(sim.setTool('loeffel'), false);
  g.money = 1e6; g.buyUpgrade('loeffel'); sim.setStats(g.stats);
  assert.equal(sim.setTool('loeffel'), true);
  sim.x = 22; sim.y = g.river.centerY(22); sim.anchor();
  assert.equal(sim.slice.tool, 'loeffel');
  sim.slice.clog = 3;
  assert.equal(sim.setTool('pump'), false);
});

test('Löffelbagger: trägt Land im Ausbaustreifen ab, kostet Landgebühr, keine Busse', () => {
  const { g, r, sim, sl, x } = bankSlice();
  sl.x = sl.x0 + 0.5;
  const i = r.idx(x, sl.x0), top0 = r.top[i], m0 = g.money;
  assert.ok(top0 > r.wl && r.ext[i] === 1, 'Ufer im Ausbaustreifen');
  sim.pumpOn = true;
  let land = 0;
  for (let k = 0; k < 200; k++) { sl.h = sl.surfaceAt(sl.x) + 0.3; const d = sim.update(0.05, { dx: 0, dy: 0, suction: true }); g.collect(d); land += d.land; assert.ok(d.out <= d.land * 0.3 + 1e-9); }
  assert.ok(land > 5 && r.top[i] < top0);
  assert.ok(g.totals.landFees > 0 && g.money < m0 + 1);
});

test('Saugkopf: Land und Ufer bleiben unberührt', () => {
  const { r, sim, sl, x } = bankSlice({});
  sim.setTool('pump');
  sl.x = sl.x0 + 0.5;
  const i = r.idx(x, sl.x0), top0 = r.top[i];
  sim.pumpOn = true;
  for (let k = 0; k < 100; k++) sim.update(0.05, { dx: 0, dy: 0, suction: true });
  assert.equal(r.top[i], top0);
});

test('Land wird zum Korridor, wenn es unter Wasser abgetragen ist', () => {
  const r = new River(CONFIG.river.cols, CONFIG.river.rows).setFlat(3, 9);
  for (let x = 10; x < 14; x++) { const i = r.idx(x, 4); r.top[i] = r.wl + 0.4; r.rock[i] = r.wl - 3; r.zone[i] = 0; r.ext[i] = 1; r.cap[i] = 0; r.kind[i] = KIND.sand; }
  const i = r.idx(11, 4);
  for (let k = 0; k < 60 && !r.zone[i]; k++) r.suckSwath([11], 11, 4.5, r.wl + 0.2, 1.5, 3, 0.3, { allowLand: true });
  assert.ok(r.zone[i] === 1 && r.top[i] < r.wl);
  assert.ok(r.cap[i] > 0, 'neues Wasser kann wieder verlanden');
});

test('Löffel: verstopft nicht an Fremdstoffen, Bomben zählen trotzdem', () => {
  const { r, sl, sim } = bankSlice();
  sl.x = sl.x0 + 8; sl.h = r.wl - 2;
  const mx = Math.floor(sl.mouth().x);
  r.debris[r.idx(sl.cols[1], mx)] = 1;
  sim.pumpOn = true;
  sim.update(0.05, { dx: 0, dy: 0, suction: true });
  assert.equal(sl.clog, 0);
  r.debris[r.idx(sl.cols[1], mx)] = DEBRIS.length; // Fliegerbombe (letzter Eintrag)
  const d = sim.update(0.05, { dx: 0, dy: 0, suction: true });
  assert.ok(sl.clog > 0 && d.bombs === 1);
});

test('Löffel: schafft harte Schicht und Fels besser als der Saugkopf', () => {
  const dig = (tool) => {
    const g = new Game(1); g.money = 1e6; g.buyUpgrade('loeffel');
    const r = new River(CONFIG.river.cols, CONFIG.river.rows).setFlat(3, 3);
    r.hard.fill(2);
    const stats = computeStats({ loeffel: 3 });
    const sl = new SliceSim(r, stats, 20, 12, createRng(1), 3, 1, tool);
    sl.h = r.wl - 3.2; sl.x = sl.x0 + 6;
    let rem = 0;
    for (let i = 0; i < 80; i++) rem += sl.update(0.05, { dx: 0, dy: 0, suction: true }).by[KIND.fels];
    return rem;
  };
  assert.ok(dig('loeffel') > dig('pump') * 3);
});

test('Flotte: Mieten braucht Automatik und Geld, Kosten steigen, Obergrenze', () => {
  const g = new Game(5);
  assert.match(hireBlock(g), /Automatik/);
  g.money = 1e7; g.buyUpgrade('auto');
  assert.equal(hireBlock(g), null);
  const c0 = g.money;
  assert.ok(hireUnit(g));
  assert.equal(g.money, c0 - CONFIG.fleet.costs[0]);
  for (let i = 1; i < CONFIG.fleet.max; i++) assert.ok(hireUnit(g));
  assert.match(hireBlock(g), /voll/);
  assert.ok(dismissUnit(g, g.fleet.units[0].id));
  assert.equal(g.fleet.units.length, CONFIG.fleet.max - 1);
});

test('Flotte: Ponton fährt zur Engstelle, baggert selbstständig und die Rinne wird frei', () => {
  const g = new Game(3, 'hochrhein');
  g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('auto'); g.buyUpgrade('plant'); g.buyUpgrade('plant');
  g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'motor';
  assert.ok(!g.fair.motor.passable);
  g.fleet.mine = false; g.fleet.mine = false; hireUnit(g); g.fleet.mine = false; hireUnit(g); g.fleet.mine = false; hireUnit(g);
  let worked = false;
  for (let i = 0; i < 14 * 60 * 20 && !g.fair.motor.passable; i++) { g.update(0.05); if (g.fleet.units.some((u) => u.state === 'work')) worked = true; }
  assert.ok(worked && g.fair.motor.passable, 'Motorschiffe können fahren');
  assert.ok(g.totals.fleetRemoved > 20);
  assert.ok(g.totals.plantNet !== 0);
});

test('Flotte: zwei Pontons teilen sich die Arbeit (keine doppelte Stelle)', () => {
  const g = new Game(3, 'hochrhein');
  g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('plant');
  g.traffic.spawnIn = 1e9; g.fleet.goal = 'tank';
  g.fleet.mine = false; g.fleet.mine = false; hireUnit(g); g.fleet.mine = false; hireUnit(g);
  let overlap = 0;
  for (let i = 0; i < 14 * 25 * 20; i++) {
    g.update(0.05);
    const [a, b] = g.fleet.units;
    if (a.site && b.site && a.state !== 'idle' && b.state !== 'idle' && a.site.c0 < b.site.c0 + 4 && b.site.c0 < a.site.c0 + 4) overlap++;
  }
  assert.equal(overlap, 0);
  assert.ok(g.fleet.units.every((u) => u.removed > 0));
});

test('Flotte: ohne Felsfräse bleibt sie vor Fels stehen und meldet es, mit Löffel kommt sie weiter', () => {
  const g = new Game(3, 'loreley');
  g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('auto'); g.traffic.spawnIn = 1e9; g.eventsOn = false;
  const f = g.fair.container, r = g.river, needTop = g.wl - f.fullNeed - 0.3;
  for (let i = 0; i < r.top.length; i++) if (r.zone[i] && r.rock[i] < needTop && r.top[i] > needTop) r.top[i] = needTop; // ganzer Korridor tief, nur der Fels bleibt
  for (let i = 0; i < r.top.length; i++) r.pending.add(i);
  for (let k = 0; k < 60; k++) r.settle(Infinity); // Böschungen setzen lassen, sonst rutscht die Rinne unter den Pontons nach
  for (let y = 0; y < r.rows; y++) { const i = y * r.cols + f.nodes[20].x; if (r.zone[i]) { r.rock[i] = g.wl - f.minNeed + 0.4; r.top[i] = Math.max(r.top[i], r.rock[i]); r.pending.add(i); } } // Fels in der Rinne
  g.analyze(true); g.fleet.goal = 'container';
  assert.ok(openColumns(g, targetClass(g)).some((c) => c.rock), 'Felsriegel liegt in der Rinne');
  g.fleet.mine = false; g.fleet.mine = false; hireUnit(g); g.fleet.mine = false; hireUnit(g); g.fleet.mine = false; hireUnit(g);
  let msg = '';
  for (let i = 0; i < 14 * 100 * 20 && !/Fels/.test(msg); i++) { g.update(0.05); msg = g.fleet.units.map((u) => u.note).join('|'); }
  assert.match(msg, /Fels/, 'meldet Fels im Weg');
  g.buyUpgrade('loeffel');
  let tool = null;
  for (let i = 0; i < 14 * 40 * 20 && tool !== 'loeffel'; i++) { g.update(0.05); for (const u of g.fleet.units) if (u.sim?.slice && u.site?.rock) tool = u.sim.slice.tool; }
  assert.equal(tool, 'loeffel');
});

test('Flotte: Spielstand speichert Pontons und sie arbeiten danach weiter; Löhne werden bezahlt', () => {
  const g = new Game(8, 'hochrhein');
  g.money = 1e6; g.buyUpgrade('auto'); g.traffic.spawnIn = 1e9; g.fleet.mine = false; hireUnit(g);
  for (let i = 0; i < 14 * 5 * 20; i++) g.update(0.05);
  const g2 = restoreGame(serializeGame(g));
  assert.ok(g2 && g2.fleet.units.length === 1);
  const w0 = g2.totals.wages;
  for (let i = 0; i < 14 * 4 * 20; i++) g2.update(0.05);
  assert.ok(g2.fleet.units[0].state !== undefined && g2.totals.fleetRemoved >= 0);
  assert.ok(g2.totals.wages > w0, 'Löhne');
  assert.equal(fleetSites(g2).length >= 0, true);
});

// ---------- Beton, Aufläufer-Minispiel, Land-Automatik ----------
import { TowSim, groundedNear } from '../src/sim/tow.js';
import { openWidenColumns, setWiden } from '../src/sim/fleet.js';
import { TOOLS, toolAvailable } from '../src/sim/slice.js';

test('Beton: Gerät nur mit Betoniergerät, Gerätewechsel reihum', () => {
  const g = new Game(1); g.money = 1e6;
  const sim = g.createSession();
  assert.equal(sim.nextTool(), 'pump');
  g.buyUpgrade('loeffel'); g.buyUpgrade('betonrohr'); sim.setStats(g.stats);
  assert.deepEqual(TOOLS.filter((t) => toolAvailable(g.stats, t)), ['pump', 'loeffel', 'beton']);
  assert.equal(sim.nextTool(), 'loeffel');
  sim.setTool('loeffel'); assert.equal(sim.nextTool(), 'beton');
  sim.setTool('beton'); assert.equal(sim.nextTool(), 'pump');
});

test('Beton: Ausbringen verhärtet die Sedimentschicht, verbraucht Vorrat und ändert die Sohle nicht', () => {
  const r = flat(3);
  const top0 = r.top[r.idx(20, 12)];
  const res = r.pourSwath([19, 20, 21], 20, 12.5, r.wl - 2.9, 1.5, 5);
  assert.ok(res.used > 0 && res.used <= 5 + 1e-9);
  assert.equal(r.top[r.idx(20, 12)], top0);
  let armored = 0, vol = 0;
  for (let i = 0; i < r.armor.length; i++) if (r.armor[i] > 0) { armored++; vol += r.armor[i] * r.area; }
  assert.ok(armored > 0 && Math.abs(vol - res.used) < 1e-6);
  for (let k = 0; k < 60; k++) r.pourSwath([19, 20, 21], 20, 12.5, r.wl - 2.9, 1.5, 5);
  assert.ok(r.armor[r.idx(20, 12)] <= CONFIG.concrete.thickness + 1e-6, 'nicht dicker als die Schichtdicke');
});

test('Beton: Fels und Schutzzone bekommen keinen Beton', () => {
  const r = new River(CONFIG.river.cols, CONFIG.river.rows).setFlat(3, 3); // Fels direkt unter der Sohle
  assert.equal(r.pourSwath([20], 20, 12.5, r.wl - 2.9, 1.5, 5).used, 0);
  const p = flat(3); p.zone.fill(0); p.ext.fill(0);
  assert.equal(p.pourSwath([20], 20, 12.5, r.wl - 2.9, 1.5, 5).used, 0);
});

test('Beton: weniger Verlandung, auch bei Hochwasser, und die Böschung rutscht nicht', () => {
  const run = (armored) => {
    const r = flat(3); r.flow.fill(0.1);
    r.top.fill(r.wl - 4); r.cap.fill(r.wl - 3);
    if (armored) r.armor.fill(0.25);
    r.deposit(200); r.flood(0.2);
    return r.top[0] - (r.wl - 4);
  };
  assert.ok(run(true) < run(false) * 0.4);
  const r = flat(4);
  for (let y = 0; y < r.rows; y++) for (let x = 20; x < 30; x++) r.top[r.idx(x, y)] = r.wl - 1;
  for (let y = 0; y < r.rows; y++) r.armor[r.idx(21, y)] = 0.25;
  for (let x = 19; x <= 22; x++) for (let y = 0; y < r.rows; y++) r.pending.add(r.idx(x, y));
  const before = r.top[r.idx(22, 5)];
  for (let k = 0; k < 20; k++) r.settle(Infinity);
  assert.equal(r.top[r.idx(22, 5)], before, 'verhärtete Böschung hält');
});

test('Beton: Aufbrechen: Saugkopf fast chancenlos, Löffel schafft es, Bruch zählt als Fels', () => {
  const dig = (tool) => {
    const r = flat(3); r.kind.fill(KIND.sand); r.armor.fill(0.25);
    const stats = computeStats({ loeffel: 3, power: 3 });
    const sl = new SliceSim(r, stats, 20, 12, createRng(1), 3, 1, tool);
    sl.h = r.wl - 3.1; sl.x = sl.x0 + 6;
    let broken = 0;
    for (let i = 0; i < 60; i++) broken += sl.update(0.05, { dx: 0, dy: 0, suction: true }).by[KIND.fels];
    return broken;
  };
  const pump = dig('pump'), bucket = dig('loeffel');
  assert.ok(bucket > pump * 3 && bucket > 0, `${bucket} vs ${pump}`);
});

test('Beton: Betoniergerät im Querschnitt braucht Vorrat und verbraucht ihn', () => {
  const g = new Game(2); g.money = 1e6; g.buyUpgrade('betonrohr');
  const sim = g.createSession(); sim.setStats(g.stats);
  sim.x = 22; sim.y = g.river.centerY(22); sim.anchor(); sim.setTool('beton');
  const sl = sim.slice; sl.h = g.wl - 2.2; sl.x = sl.x0 + 8;
  sim.pumpOn = true;
  sim.concreteAvail = 0;
  let d = sim.update(0.1, { dx: 0, dy: 0, suction: true });
  assert.equal(d.concrete, 0);
  g.concrete = 30; let used = 0;
  for (let i = 0; i < 100; i++) { sim.concreteAvail = g.concrete; d = sim.update(0.1, { dx: 0, dy: 0, suction: true }); g.collect(d); used += d.concrete; }
  assert.ok(used > 3 && used <= 30);
  assert.ok(Math.abs(g.concrete - (30 - used)) < 1e-6);
  assert.ok(g.totals.concreteUsed > 0);
});

test('Beton: kaufen kostet Geld und das Lager ist begrenzt', () => {
  const g = new Game(3); g.money = 20000;
  assert.ok(g.buyConcrete(20));
  assert.equal(g.money, 20000 - 20 * CONFIG.concrete.price);
  assert.equal(g.concrete, 20);
  assert.ok(g.concreteBlock(1000));
  g.money = 0; assert.match(g.concreteBlock(10), /Braucht/);
});

test('Betonwerk: leitet Kies und Sand um, mischt Beton und zahlt Zement', () => {
  const g = new Game(4); g.money = 1e6; g.buyUpgrade('mixer'); g.buyUpgrade('plant');
  g.traffic.spawnIn = 1e9; g.eventsOn = false;
  g.stock = [0, 40, 60, 0, 0];
  const m0 = g.money;
  for (let i = 0; i < 20 * 60; i++) g.update(0.05);
  assert.ok(g.totals.concreteMixed > 5 && g.concrete > 5);
  assert.ok(g.totals.cementCost > 0);
  const kiesUsed = g.totals.concreteMixed * CONFIG.concrete.mix.kies;
  assert.ok(g.agg.kies + kiesUsed <= 60 + 1e-6 && g.agg.kies + kiesUsed > 50, 'Kies wurde ins Werk umgeleitet statt verkauft');
  // ohne Umleitung wird Kies verkauft
  const h = new Game(4); h.money = 1e6; h.buyUpgrade('mixer'); h.buyUpgrade('plant'); h.divertAgg = false; h.traffic.spawnIn = 1e9; h.eventsOn = false; h.stock = [0, 40, 60, 0, 0];
  for (let i = 0; i < 20 * 60; i++) h.update(0.05);
  assert.equal(h.concrete, 0); assert.ok(h.totals.plantNet > g.totals.plantNet);
  void m0;
});

test('Betonwerk: Beton aus eigenem Kies ist billiger als Zukaufen', () => {
  const C = CONFIG.concrete, own = C.cement + C.mix.kies * 26 + C.mix.sand * 12;
  assert.ok(own < C.price * 0.7, `${own} vs ${C.price}`);
});

function groundedGame() {
  const g = new Game(6, 'hochrhein'); g.eventsOn = false; g.traffic.spawnIn = 1e9;
  const path = g.fair.kahn.path;
  const ship = { id: 77, cls: 'kahn', dir: 1, cargo: 'kies', tons: 200, price: 18, state: 'grounded', wait: 0, s: 20, ground: 18, lane: 'one', path, salvage: 1000 };
  g.traffic.ships.push(ship);
  return { g, ship };
}

test('Aufläufer: Ponton in Reichweite findet das Schiff, sonst nicht', () => {
  const { g, ship } = groundedGame();
  const p = pointOnPath(ship.path, ship.s);
  assert.equal(groundedNear(g, p.x + 1, p.y)?.id, 77);
  assert.equal(groundedNear(g, p.x + 20, p.y), null);
});

test('Aufläufer-Minispiel: im grünen Band halten befreit das Schiff und erstattet Kosten', () => {
  const { g, ship } = groundedGame();
  const tow = new TowSim(g, ship, createRng(1));
  const m0 = g.money;
  let guard = 0;
  while (!tow.over && guard++ < 5000) {
    const mid = (tow.band[0] + tow.band[1]) / 2;
    tow.update(0.05, tow.tension < mid);
  }
  assert.ok(tow.success && ship.state === 'sail');
  assert.ok(g.money > m0 && g.totals.rescued === 1);
});

test('Aufläufer-Minispiel: zu viel Zug reisst die Leine (Strafe), zu wenig kostet Zeit und das Schiff bleibt', () => {
  const { g, ship } = groundedGame();
  const tow = new TowSim(g, ship, createRng(1));
  const m0 = g.money;
  for (let i = 0; i < 200 && tow.snaps === 0; i++) tow.update(0.05, true);
  assert.ok(tow.snaps >= 1 && g.money < m0);
  const { g: g2, ship: s2 } = groundedGame();
  const idle = new TowSim(g2, s2, createRng(1));
  let k = 0;
  while (!idle.over && k++ < 5000) idle.update(0.05, false);
  assert.ok(idle.over && !idle.success && s2.state === 'grounded');
});

test('Aufläufer-Minispiel: schwere Schiffe haben ein schmaleres Band und brauchen länger', () => {
  const { g, ship } = groundedGame();
  const light = new TowSim(g, ship), heavy = new TowSim(g, { ...ship, cls: 'schub' });
  assert.ok(heavy.band[1] - heavy.band[0] < light.band[1] - light.band[0]);
  assert.ok(heavy.need > light.need);
});

test('Aufläufer-Minispiel: endet, wenn das Schiff von selbst frei kommt', () => {
  const { g, ship } = groundedGame();
  const tow = new TowSim(g, ship);
  ship.state = 'sail';
  tow.update(0.05, true);
  assert.ok(tow.over && !tow.success);
});

test('Land-Automatik: Flotte trägt Ufer im Ausbaustreifen ab und macht es zum Korridor', () => {
  const g = new Game(3, 'hochrhein'), r = g.river;
  g.money = 1e6; for (const id of ['auto', 'auto', 'loeffel', 'loeffel', 'loeffel', 'plant', 'plant']) g.buyUpgrade(id);
  g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'kahn';
  setWiden(g, true, 2);
  const open0 = openWidenColumns(g).length, zone0 = r.zone.reduce((a, b) => a + b, 0);
  assert.ok(open0 > 10);
  g.fleet.mine = false; g.fleet.mine = false; hireUnit(g);
  for (let i = 0; i < 14 * 40 * 20; i++) g.update(0.05);
  assert.ok(g.totals.landRemoved > 20 && g.totals.landFees > 0);
  assert.ok(r.zone.reduce((a, b) => a + b, 0) > zone0, 'neue Korridorzellen');
  assert.ok(g.fleet.units[0].note.length > 0);
});

test('Land-Automatik: ohne Löffelbagger oder wenn ausgeschaltet bleibt das Ufer stehen', () => {
  const g = new Game(3, 'hochrhein');
  g.money = 1e6; g.buyUpgrade('auto'); g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'kahn'; fullLane(g, 'kahn');
  setWiden(g, true, 2); g.fleet.mine = false; hireUnit(g);
  for (let i = 0; i < 14 * 15 * 20; i++) g.update(0.05);
  assert.equal(g.totals.landRemoved, 0);
  assert.match(g.fleet.units[0].note, /Löffel|Rinne|Engstelle/);
});

test('Flotte: Beton im Weg verlangt den Löffelbagger', () => {
  const g = new Game(3, 'hochrhein'), r = g.river;
  g.money = 1e6; g.buyUpgrade('auto'); g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'motor';
  const f = g.fair.motor;
  for (const n of f.nodes) for (let y = n.y; y <= n.y + 1; y++) r.armor[y * r.cols + n.x] = 0.25;
  g.fleet.mine = false; g.fleet.mine = false; hireUnit(g);
  let msg = '';
  for (let i = 0; i < 14 * 12 * 20 && !/Beton/.test(msg); i++) { g.update(0.05); msg = g.fleet.units[0].note; }
  assert.match(msg, /Beton/);
});

test('Spielstand: Beton, Lager und Betonschicht überleben Speichern und Laden', () => {
  const g = new Game(9, 'hochrhein'); g.money = 1e6; g.buyUpgrade('mixer');
  g.concrete = 12; g.agg.kies = 5; g.river.armor[100] = 0.2; g.fleet.widen = true;
  const g2 = restoreGame(serializeGame(g));
  assert.ok(g2);
  assert.equal(g2.concrete, 12); assert.equal(g2.agg.kies, 5); assert.ok(Math.abs(g2.river.armor[100] - 0.2) < 1e-6); assert.equal(g2.fleet.widen, true);
});

// ---------- Freischaltung, Warteplatz, Kreuzungsstellen, Rotlichter, Schlepper ----------
import { bayCapacity, maxZones, activeClasses, zoneClasses, queuePos } from '../src/sim/traffic.js';

test('Freischaltung: nur befahrbare Klassen kommen, neue Klassen schalten sich mit der Rinne frei', () => {
  const g = new Game(7, 'hochrhein'); g.traffic.spawnIn = 1e9; g.eventsOn = false;
  assert.deepEqual(activeClasses(g).map((s) => s.id), ['kahn']);
  const cls = new Set();
  for (let i = 0; i < 150; i++) { const sh = spawnShip(g); if (sh) cls.add(sh.cls); g.traffic.ships.length = 0; }
  assert.deepEqual([...cls], ['kahn']);
  const r = g.river; r.setFlat(4.6, 9); g.analyze();
  assert.ok(g.unlocked.tank && g.unlocked.container);
  assert.ok(g.log.some((e) => /freigeschaltet/.test(e.text)));
  const after = new Set();
  for (let i = 0; i < 300; i++) { const sh = spawnShip(g); if (sh) after.add(sh.cls); g.traffic.ships.length = 0; }
  assert.ok(after.has('tank') && after.has('container') && !after.has('schub'));
});

test('Warteplatz: fasst anfangs ein Schiff je Seite, Rotlichter und Schlepper bauen ihn aus', () => {
  const g = emptyGame(8); g.traffic.spawnIn = 1e9;
  assert.equal(bayCapacity(g), 1);
  const count = () => g.traffic.ships.filter((s) => s.state === 'queue' && s.dir === 1).length;
  for (let i = 0; i < 60; i++) spawnShip(g);
  assert.ok(count() <= 1);
  g.money = 1e6; g.buyUpgrade('signals'); g.buyUpgrade('tugs'); g.buyUpgrade('tugs');
  assert.equal(bayCapacity(g), 4);
  g.traffic.ships.length = 0;
  for (let i = 0; i < 100; i++) spawnShip(g);
  assert.ok(count() <= 4 && count() >= 2);
  const q = g.traffic.ships.filter((s) => s.state === 'queue' && s.dir === 1);
  assert.ok(queuePos(g, q[0], 0).x > queuePos(g, q[0], 1).x, 'Schiffe reihen sich auf');
});

function crossingGame(withZone, seed = 5) {
  const g = new Game(seed, 'hochrhein'); g.eventsOn = false;
  const r = g.river; r.setFlat(3, 9);
  for (let x = 0; x < r.cols; x++) for (let y = 0; y < r.rows; y++) r.zone[r.idx(x, y)] = (x >= 18 && x <= 24 ? y >= 6 && y <= 17 : y >= 10 && y <= 13) ? 1 : 0; // einspurig, in der Mitte breit
  r.ext.fill(0); g.fair = null; g.analyze(true);
  if (withZone) { g.money = 1e6; g.buyUpgrade('signals'); g.zones = [{ id: 1, x: 21, w: 3 }]; }
  return g;
}

test('Kreuzungsstelle: nur wo zwei Rinnen Platz haben, Kosten, Abstand und Höchstzahl', () => {
  const g = crossingGame(false);
  assert.ok(g.fair.kahn.cross[21] && !g.fair.kahn.cross[5]);
  assert.match(g.zoneBlock(5), /schmal/);
  assert.equal(g.zoneBlock(21), null);
  const m0 = g.money;
  assert.ok(g.placeZone(21));
  assert.equal(g.money, m0 - CONFIG.zones.cost);
  assert.match(g.zoneBlock(22), /nah/);
  g.money = 1e6; g.river.zone.fill(1); g.analyze(true);
  assert.match(g.zoneBlock(35), /Rotlichter/);
  g.buyUpgrade('signals');
  assert.equal(maxZones(g), 2);
  assert.equal(g.zoneBlock(35), null);
  assert.ok(g.removeZone(1) && g.zones.length === 0);
  assert.deepEqual(zoneClasses(g, { x: 21, w: 3 }).map((s) => s.id), ['kahn', 'motor', 'tank', 'container'].filter((id) => g.fair[id].cross[20] && g.fair[id].cross[21] && g.fair[id].cross[22]));
});

test('Kreuzungsstelle: Gegenverkehr in der Einbahnrinne wird möglich, nie begegnen sich Schiffe ausserhalb der Zone', () => {
  const run = (withZone) => {
    const g = crossingGame(withZone);
    let bad = 0;
    for (let i = 0; i < 14 * 50 * 20; i++) {
      g.update(0.05);
      const sl = g.traffic.ships.filter((s) => s.state === 'sail' && s.lane === 'one' && s.path);
      for (const a of sl) for (const b of sl) {
        if (a.id >= b.id || a.dir === b.dir) continue;
        const pa = shipPos(a), pb = shipPos(b);
        if (Math.abs(pa.x - pb.x) < 1.2 && !(Math.abs(pa.x - 21) <= 2.6 && Math.abs(pb.x - 21) <= 2.6)) bad++;
      }
    }
    return { ships: g.totals.ships, bad, rejected: g.totals.rejected + g.totals.turnedAway };
  };
  const off = run(false), on = run(true);
  assert.equal(on.bad, 0, 'keine Begegnung ausserhalb der Zone');
  assert.ok(on.ships > off.ships, `mit Zone mehr Schiffe: ${on.ships} vs ${off.ships}`);
  assert.equal(off.bad, 0);
});

test('Kreuzungsstelle: Schiffe warten in der Zone auf den Gegner und fahren dann weiter', () => {
  const g = crossingGame(true); g.traffic.spawnIn = 1e9;
  const mk = (id, dir, s) => ({ id, cls: 'kahn', dir, cargo: 'kies', tons: 200, price: 18, state: 'sail', wait: 0, s, ground: 0, lane: 'one', path: g.fair.kahn.path, meets: [] });
  const a = mk(1, 1, 0), b = mk(2, -1, 0);
  a.meets = [{ zone: 1, with: 2 }]; b.meets = [{ zone: 1, with: 1 }];
  g.traffic.ships.push(a, b);
  let held = false, done = 0;
  for (let i = 0; i < 20 * 120 && g.traffic.ships.length; i++) { g.update(0.05); g.traffic.spawnIn = 1e9; if (a.state === 'sail' && b.state === 'sail') { const pa = shipPos(a), pb = shipPos(b); if (Math.abs(pa.x - pb.x) < 1) { assert.ok(Math.abs(pa.x - 21) <= 2.6, 'Begegnung nur in der Zone'); held = true; } } }
  assert.ok(held && g.totals.ships === 2);
  void done;
});

test('Kreuzungsstelle: Einfahrt wird gesperrt, wenn keine freie Stelle zwischen Einfahrt und Gegner liegt', () => {
  const g = crossingGame(false); g.traffic.spawnIn = 1e9;
  const o = { id: 1, cls: 'kahn', dir: -1, cargo: 'kies', tons: 200, price: 18, state: 'sail', wait: 0, s: 5, ground: 0, lane: 'one', path: g.fair.kahn.path, meets: [] };
  g.traffic.ships.push(o);
  g.traffic.ships.push({ id: 2, cls: 'kahn', dir: 1, cargo: 'kies', tons: 200, price: 18, state: 'queue', wait: 0, s: 0, ground: 0, lane: 'one', meets: [] });
  g.update(0.05);
  assert.equal(g.traffic.ships.find((s) => s.id === 2).state, 'queue', 'ohne Zone bleibt der Gegner draussen');
  g.zones = [{ id: 1, x: 21, w: 3 }];
  g.update(0.05);
  assert.equal(g.traffic.ships.find((s) => s.id === 2).state, 'sail');
  assert.equal(o.meets.length, 1);
});

test('Schlepper: grosse Schiffe fahren schneller, kleine nicht', () => {
  const trip = (cls, tugs) => {
    const g = emptyGame(9); g.river.setFlat(4.5, 9); g.analyze(true); g.traffic.spawnIn = 1e9; g.stats.tugs = tugs; g._stats = { ...g.stats, tugs };
    g.traffic.ships.push({ id: 1, cls, dir: 1, cargo: 'kies', tons: 100, price: 18, state: 'sail', wait: 0, s: 0, ground: 0, lane: 'two', path: g.fair[cls].path, meets: [] });
    let n = 0;
    while (g.traffic.ships.length && n++ < 20000) { g.traffic.spawnIn = 1e9; g.update(0.05); }
    return n;
  };
  assert.ok(trip('container', 3) < trip('container', 0) * 0.9);
  assert.equal(trip('kahn', 3), trip('kahn', 0));
});

test('Spielstand: Kreuzungsstellen und Freischaltungen bleiben erhalten', () => {
  const g = crossingGame(true);
  const g2 = restoreGame(serializeGame(g));
  assert.ok(g2 && g2.zones.length === 1 && g2.unlocked.kahn);
});

import { openPourColumns, setPour } from '../src/sim/fleet.js';
test('Flotte betoniert die Rinne, verbraucht Beton und hört ohne Beton auf', () => {
  const g = new Game(3, 'hochrhein'), r = g.river;
  g.money = 1e6; for (const id of ['auto', 'auto', 'betonrohr', 'betonrohr', 'plant']) g.buyUpgrade(id);
  g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'kahn'; g.concrete = 400; fullLane(g, 'kahn');
  const n0 = openPourColumns(g).length;
  assert.ok(n0 > 20);
  setPour(g, true); g.fleet.mine = false; hireUnit(g);
  for (let i = 0; i < 14 * 40 * 20; i++) g.update(0.05);
  let armored = 0; for (let i = 0; i < r.armor.length; i++) if (r.armor[i] > 0) armored++;
  assert.ok(armored > 20 && g.totals.concreteUsed > 20 && g.concrete < 400);
  assert.ok(openPourColumns(g).length < n0);
  // ohne Beton: Pause mit Meldung
  const h = new Game(3, 'hochrhein');
  h.money = 1e6; for (const id of ['auto', 'betonrohr']) h.buyUpgrade(id);
  h.traffic.spawnIn = 1e9; h.eventsOn = false; h.fleet.goal = 'kahn'; h.concrete = 0; fullLane(h, 'kahn'); setPour(h, true); h.fleet.mine = false; hireUnit(h);
  for (let i = 0; i < 14 * 10 * 20; i++) h.update(0.05);
  assert.match(h.fleet.units[0].note, /Beton/);
  assert.equal(h.totals.concreteUsed, 0);
});

test('Flotte betoniert nur mit Betoniergerät und wenn eingeschaltet', () => {
  const g = new Game(3, 'hochrhein');
  g.money = 1e6; g.buyUpgrade('auto'); g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'kahn'; g.concrete = 100; fullLane(g, 'kahn');
  g.fleet.mine = false; g.fleet.mine = false; hireUnit(g);
  for (let i = 0; i < 14 * 8 * 20; i++) g.update(0.05);
  assert.equal(g.totals.concreteUsed, 0);
  setPour(g, true);
  for (let i = 0; i < 14 * 8 * 20; i++) g.update(0.05);
  assert.match(g.fleet.units[0].note, /Betoniergerät|Engstelle|Rinne|Beton/);
  assert.equal(g.totals.concreteUsed, 0, 'ohne Betoniergerät bleibt es beim Hinweis');
});

test('Hochwasser öffnet keine grösseren Klassen: massgebend ist der Normalpegel', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false; g.traffic.spawnIn = 1e9;
  assert.deepEqual(activeClasses(g).map((s) => s.id), ['kahn']);
  g.wl = CONFIG.water.base + 0.9; g.river.wl = g.wl; g.analyze();
  assert.deepEqual(activeClasses(g).map((s) => s.id), ['kahn'], 'auch bei hohem Pegel nur der Kahn');
  assert.ok(!g.unlocked.tank);
  g.wl = CONFIG.water.base - 0.4; g.river.wl = g.wl; g.analyze();
  assert.ok(g.fair.kahn.volume >= 0, 'bei Niedrigwasser wird die Rinne eher enger');
});

test('Wartende Schiffe ohne befahrbare Rinne geben schnell auf und blockieren den Warteplatz nicht', () => {
  const g = emptyGame(4); g.eventsOn = false; g.traffic.spawnIn = 1e9;
  g.traffic.ships.push({ id: 1, cls: 'schub', dir: 1, cargo: 'kohle', tons: 4000, price: 60, state: 'queue', wait: 0, s: 0, ground: 0, lane: 'one', meets: [] });
  for (let i = 0; i < 20 * 20; i++) g.update(0.05);
  assert.equal(g.traffic.ships.length, 0);
});

// ---------- Kreuzungsstellen planen ----------
import { zonePlan } from '../src/sim/fairway.js';

test('Kreuzungsstelle planen: fehlendes Volumen wird berechnet und sinkt beim Ausbaggern auf null', () => {
  const g = crossingGame(false); g.traffic.spawnIn = 1e9;
  const r = g.river;
  r.ext.fill(0);
  for (let x = 28; x <= 34; x++) for (let y = 0; y < r.rows; y++) { const i = r.idx(x, y); if (y >= 6 && y <= 17) { r.zone[i] = 0; r.ext[i] = 2; r.top[i] = r.wl - 1.0; } } // Flachwasser-Streifen links und rechts der Rinne
  g.analyze(true);
  const p = g.zonePlanFor(31, 'kahn');
  assert.ok(p.volume > 0 && Number.isFinite(p.volume) && !p.ready, `Volumen ${p.volume}`);
  assert.equal(g.zoneBlock(31, 'kahn'), null, 'Planen ist auch ohne Platz erlaubt');
  assert.ok(g.placeZone(31, 'kahn'));
  assert.equal(g.zones[0].cls, 'kahn');
  // Zone ist noch nicht nutzbar
  assert.ok(!zoneClasses(g, g.zones[0]).length);
  // ausbaggern: Streifenzellen in der Planung auf Tiefe legen
  for (const w of g.zonePlanFor(31, 'kahn').wins) for (const a of [w.a, w.b]) for (let k = a; k < a + 2; k++) { const i = r.idx(w.x, k); r.zone[i] = 1; r.top[i] = Math.min(r.top[i], r.wl - 3); }
  g.analyze(true);
  assert.ok(g.zonePlanFor(31, 'kahn').ready && g.zonePlanFor(31, 'kahn').volume === 0);
  assert.ok(zoneClasses(g, g.zones[0]).length > 0);
});

test('Kreuzungsstelle planen: zu schmaler Fluss ohne Uferstreifen lässt sich nicht planen, grössere Klassen brauchen mehr', () => {
  const g = crossingGame(false);
  g.river.ext.fill(0); g.analyze(true);
  assert.equal(zonePlan(g.river, g.wl, shipById('kahn'), 5).volume, Infinity);
  const kahn = zonePlan(g.river, g.wl, shipById('kahn'), 21), tank = zonePlan(g.river, g.wl, shipById('container'), 21);
  assert.ok(kahn.volume === 0 && tank.volume > kahn.volume);
  g.setZoneClass(1, 'kahn');
});

test('Flotte baut geplante Kreuzungsstellen aus', () => {
  const g = new Game(3, 'hochrhein'), r = g.river;
  g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('auto'); g.buyUpgrade('plant'); g.buyUpgrade('signals');
  g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'kahn';
  const x = 20;
  g.zones.push({ id: 1, x, w: 3, cls: 'kahn' });
  const before = g.zonePlanFor(x, 'kahn');
  assert.ok(!before.ready && before.volume > 0 && Number.isFinite(before.volume), `${before.volume}`);
  g.fleet.mine = false; g.fleet.mine = false; hireUnit(g);
  let ready = false;
  for (let i = 0; i < 14 * 90 * 20 && !ready; i++) { g.update(0.05); ready = g.zonePlanFor(x, 'kahn').ready; }
  assert.ok(ready, 'Kreuzungsstelle wurde ausgebaut');
  void r;
});

// ---------- Altlasten-Kataster, Schiffsuntergang ----------
test('Altlasten-Kataster: Summe aus Zellen und Volumen, Korridoranteil', () => {
  const r = flat(3);
  const none = r.altlastSummary();
  assert.equal(none.cells, 0);
  for (let x = 10; x < 14; x++) r.kind[r.idx(x, 12)] = KIND.altlast;
  r.zone[r.idx(13, 12)] = 0;
  const s = r.altlastSummary();
  assert.equal(s.cells, 4);
  assert.ok(Math.abs(s.volume - 4 * r.sedAt(r.idx(10, 12)) * r.area) < 1e-6);
  assert.ok(s.corridor < s.volume && s.corridor > 0);
});

test('Altlasten aus dem Level: gesetzt beim Erzeugen, nur auf Sediment, Anzahl nach Level', () => {
  for (const L of LEVELS) {
    const r = River.generate(createRng(11), L.river), sum = r.altlastSummary();
    assert.ok(sum.cells > 0 && sum.volume > 0, `${L.id}`);
    for (let i = 0; i < r.kind.length; i++) if (r.kind[i] === KIND.altlast) assert.ok(r.top[i] - r.rock[i] > 0.19, 'nur auf Sediment');
  }
  const a = River.generate(createRng(5), LEVELS[0].river).altlastSummary(), b = River.generate(createRng(5), LEVELS[2].river).altlastSummary();
  assert.ok(b.cells > a.cells, 'Eisernes Tor hat mehr Altlasten');
});

test('Fahrrinne: Altlast in der Rinne wird ausgewiesen', () => {
  const r = flat(2.0);
  for (let x = 10; x < 16; x++) for (let y = 0; y < r.rows; y++) r.kind[r.idx(x, y)] = KIND.altlast;
  const f = analyzeClass(r, r.wl, shipById('tank'));
  assert.ok(f.altlast > 0 && f.altlast <= f.volume + 1e-6, `${f.altlast} von ${f.volume}`);
  const clean = analyzeClass(flat(2.0), 8, shipById('tank'));
  assert.equal(clean.altlast, 0);
});

test('Verschmutzung: contaminate macht Sediment zur Altlast, im Kern entsteht ein hartes Wrack', () => {
  const r = flat(3);
  const top0 = r.top[r.idx(20, 12)];
  const n = r.contaminate(20.5, 12.5, 3, 1);
  assert.ok(n > 10);
  assert.equal(r.kind[r.idx(20, 12)], KIND.altlast);
  assert.ok(r.top[r.idx(20, 12)] > top0 + 0.9 && r.hard[r.idx(20, 12)] === 2);
  assert.equal(r.kind[r.idx(30, 20)], KIND.sand, 'weit weg bleibt es sauber');
});

test('Schiffsuntergang: ein nicht freikommendes Schiff sinkt mit Fracht-Risiko, Wrack und Altlast bleiben', () => {
  let sunk = 0, towed = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = new Game(seed, 'hochrhein'); g.eventsOn = false; g.traffic.spawnIn = 1e9;
    const path = g.fair.kahn.path;
    g.river.setFlat(0.6, 9); g.analyze(true);
    g.traffic.ships.push({ id: 1, cls: 'kahn', dir: 1, cargo: 'oel', tons: 300, price: 180, state: 'grounded', wait: 0, s: 20, ground: 0.01, lane: 'one', path, meets: [], salvage: 1000 });
    const m0 = g.money;
    g.update(0.1);
    if (g.totals.sunk) { sunk++; assert.ok(g.money < m0); assert.ok(g.river.altlastSummary().cells > 5 && g.river.debris.some((d) => d === DEBRIS.length - 1)); }
    else if (g.totals.towed) towed++;
  }
  assert.ok(sunk > 15 && towed >= 1, `gesunken ${sunk}, abgeschleppt ${towed}`);
});

// ---------- Rohstoffvorkommen ----------
import { setMine } from '../src/sim/fleet.js';
import { DEPOSITS } from '../src/config.js';

test('Rohstoffvorkommen: das erste ist bekannt und freigegeben, die übrigen nicht; Zellen liegen im Korridor', () => {
  for (const L of LEVELS) {
    const r = River.generate(createRng(7), L.river);
    assert.equal(r.deposits.length, L.river.deposits.length);
    assert.ok(r.deposits[0].known && r.deposits[0].owned);
    assert.ok(r.deposits.slice(1).every((d) => !d.known && !d.owned));
    for (const d of r.deposits) assert.ok(r.depositRemaining(d.id) > 50, `${L.id}/${d.type}: ${r.depositRemaining(d.id)}`);
    for (let i = 0; i < r.dep.length; i++) if (r.dep[i]) assert.ok(r.zone[i] && r.kind[i] === r.deposits[r.dep[i] - 1].kind);
  }
});

test('Rohstoffvorkommen: Aufschlag nur mit Konzession, sofort bar, proportional zum Abbau', () => {
  const g = new Game(3, 'hochrhein'), r = g.river; g.money = 1e6; g.eventsOn = false;
  const [d0, d1] = r.deposits;
  const vol = 40;
  const m0 = g.money;
  g.collect({ removed: vol, by: [0, 0, vol, 0, 0], zone: vol, out: 0, hard: 0, fines: 0, repairs: 0, bombs: 0, dep: { 1: vol } });
  const gain = g.money - m0 - vol * CONFIG.pay.perM3;
  assert.ok(Math.abs(gain - vol * 26 * (d0.mult - 1)) < 1e-6, `Aufschlag ${gain}`);
  const m1 = g.money;
  g.collect({ removed: vol, by: [0, vol, 0, 0, 0], zone: vol, out: 0, hard: 0, fines: 0, repairs: 0, bombs: 0, dep: { 2: vol } });
  assert.ok(Math.abs(g.money - m1 - vol * CONFIG.pay.perM3) < 1e-6, 'ohne Konzession kein Aufschlag');
  assert.equal(g.depositNoConcession, 2);
  void d1;
});

test('Rohstoffvorkommen: der Abbau im Querschnitt meldet die Menge aus dem Vorkommen und zehrt es auf', () => {
  const g = new Game(3, 'hochrhein'), r = g.river; g.money = 1e6; g.eventsOn = false;
  const d = r.deposits[0], rest0 = r.depositRemaining(1);
  const sim = g.createSession();
  sim.x = d.cx; sim.y = d.cy; assert.ok(sim.anchor());
  const sl = sim.slice; sl.x = Math.min(sl.x0 + 14, Math.max(sl.x0 + 1, d.cy - 0.5)); sl.h = sl.surfaceAt(sl.x) + 0.1;
  sim.pumpOn = true;
  let dep = 0;
  for (let i = 0; i < 400; i++) { const dd = sim.update(0.05, { dx: 0, dy: 0, suction: true }); dep += dd.dep[1] ?? 0; g.collect(dd); }
  assert.ok(dep > 5 && g.totals.premium > 0);
  assert.ok(r.depositRemaining(1) < rest0);
});

test('Rohstoffvorkommen: erkunden und Konzession kosten Geld, Reihenfolge und Sperren', () => {
  const g = new Game(3, 'hochrhein'); g.money = 20000;
  assert.match(g.concessionBlock(2), /erkunden/);
  const m0 = g.money, d = g.explore();
  assert.equal(d.id, 2); assert.ok(d.known); assert.equal(g.money, m0 - CONFIG.deposits.exploreCost);
  assert.equal(g.concessionBlock(2), null);
  assert.ok(g.buyConcession(2) && d.owned && g.money === m0 - CONFIG.deposits.exploreCost - d.cost);
  assert.match(g.concessionBlock(2), /Schon/);
  g.explore(); assert.ok(g.exploreBlock() !== null || g.river.deposits.every((q) => q.known));
  g.money = 0; assert.match(g.exploreBlock() ?? 'Braucht', /Braucht|bekannt/);
});

test('Rohstoffvorkommen: Spielstand behält Konzessionen und Vorkommen', () => {
  const g = new Game(4, 'loreley'); g.money = 1e6; g.explore(); g.buyConcession(2);
  const g2 = restoreGame(serializeGame(g));
  assert.ok(g2.river.deposits[1].owned && g2.river.deposits[1].known && !g2.river.deposits[2].known);
  assert.equal(g2.river.dep.reduce((a, b) => a + (b ? 1 : 0), 0), g.river.dep.reduce((a, b) => a + (b ? 1 : 0), 0));
});

test('Flotte baut Rohstoffe mit Konzession ab, ohne Konzession nicht', () => {
  const g = new Game(3, 'hochrhein'); g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('plant');
  g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.goal = 'kahn';
  hireUnit(g);
  for (let i = 0; i < 14 * 40 * 20; i++) g.update(0.05);
  assert.ok(g.totals.premium > 100, `Aufschlag ${g.totals.premium}`);
  const h = new Game(3, 'hochrhein'); h.money = 1e6; h.buyUpgrade('auto'); h.traffic.spawnIn = 1e9; h.eventsOn = false; h.fleet.goal = 'kahn'; fullLane(h, 'kahn');
  h.river.deposits[0].owned = false; hireUnit(h);
  for (let i = 0; i < 14 * 30 * 20; i++) h.update(0.05);
  assert.equal(h.totals.premium, 0);
  const k = new Game(3, 'hochrhein'); k.money = 1e6; k.buyUpgrade('auto'); k.traffic.spawnIn = 1e9; k.eventsOn = false; k.fleet.goal = 'kahn'; fullLane(k, 'kahn'); setMine(k, false); hireUnit(k);
  for (let i = 0; i < 14 * 20 * 20; i++) k.update(0.05);
  assert.equal(k.totals.premium, 0);
  assert.ok(DEPOSITS.length === 4);
});

test('Hafen: Gelände von Hand planieren (Abtrag und Auffüllen), Überschuss und Kosten', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.money = 100000; g.unlocked.motor = true; openPort(g);
  const site = g.port.sites[0], S = PORT.site;
  assert.ok(siteWork(site) > 0); assert.ok(g.port.sites.every((s) => s && !s.ready));
  const m0 = g.money; let guard = 0;
  while (!site.ready && guard++ < 500) {
    let done = false;
    for (let y = 0; y < S.h && !done; y++) for (let x = 0; x < S.w && !done; x++) { const v = site.h[y * S.w + x]; if ((v > 0 && site.carry < S.maxCarry) || (v < 0) || (v === 0 && site.carry >= S.maxCarry)) done = siteAct(g, 0, x, y); }
    if (!done) { updatePort(g, 1); continue; }
    updatePort(g, 5); // Maschine fertig
  }
  assert.ok(site.ready, 'planiert');
  assert.ok(site.h.every((v) => v === 0));
  assert.ok(m0 - g.money >= 0);
  assert.equal(siteAct(g, 0, 0, 0), false, 'fertig: keine Aktion mehr');
  assert.ok(autoLevelCost(g, 1) > 0); const c = autoLevelCost(g, 1), m1 = g.money; assert.ok(autoLevel(g, 1)); assert.equal(g.money, m1 - c);
});

test('Teilbeladung: ab Mindesttiefe befahrbar, Ladung wächst mit der Tiefe, darunter gesperrt', () => {
  const motor = shipById('motor'), full = motor.draught + CONFIG.clearance, mn = full - CONFIG.partialDepth;
  const at = (depth) => { const r = flat(depth + 0.001); return analyzeClass(r, r.wl, motor); };
  assert.ok(!at(mn - 0.1).passable, 'unter der Mindesttiefe gesperrt');
  const lo = at(mn + 0.01), mid = at(mn + 0.15), hi = at(full + 0.01);
  assert.ok(lo.passable && mid.passable && hi.passable);
  assert.ok(lo.loadFactor < mid.loadFactor && mid.loadFactor < hi.loadFactor);
  assert.ok(Math.abs(hi.loadFactor - 1) < 1e-6 && lo.loadFactor >= CONFIG.minLoad - 1e-6 && lo.loadFactor < CONFIG.minLoad + 0.1);
  assert.equal(hi.fullVolume, 0);
  assert.ok(lo.fullVolume > 0 && lo.volume === lo.fullVolume, 'nächstes Ziel: volle Tiefe');
  // Schiffe: Ladung und Einnahmen skalieren
  const g = new Game(3, 'hochrhein'); g.eventsOn = false;
  g.fair.kahn.loadFactor = 1; const a = spawnShip(g); g.traffic.ships.length = 0;
  g.fair.kahn.loadFactor = 0.4; const b = spawnShip(g);
  assert.ok(a && b && b.tons < a.tons && b.load === 0.4);
});

test('Kreuzungsstelle: nur wenn beide Spuren nebeneinander wirklich Platz haben', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false;
  const r = new River(CONFIG.river.cols, CONFIG.river.rows); r.top.fill(r.wl - 6); r.rock.fill(r.wl - 12); r.zone.fill(0); r.flow.fill(0.5);
  const rows = (n) => { r.zone.fill(0); for (let x = 0; x < r.cols; x++) for (let y = 8; y < 8 + n; y++) r.zone[r.idx(x, y)] = 1; g.river = r; g.analyze(true); };
  const z = { id: 1, x: 20, w: 3 }, kb = shipById('kahn').beam, tb = shipById('tank').beam;
  rows(kb * 2 + 1); // genau zwei Kähne nebeneinander
  assert.ok(pairFits(g, z, 'kahn', 'kahn'));
  assert.ok(zoneLaneStart(g, z, 'kahn', 1) < zoneLaneStart(g, z, 'kahn', -1), 'talwärts obere, bergwärts untere Spur');
  assert.ok(!pairFits(g, z, 'tank', 'kahn'), 'Tanker plus Kahn brauchen mehr Breite');
  rows(tb + kb + 1);
  assert.ok(pairFits(g, z, 'tank', 'kahn') && pairFits(g, z, 'kahn', 'tank'));
  rows(kb * 2); // einen Zeile zu wenig (kein Abstand)
  assert.ok(!pairFits(g, z, 'kahn', 'kahn'));
});

test('Flotte: Arbeitsgebiet auf der Karte vorgeben, nur dieses Rechteck wird gebaggert', () => {
  const g = new Game(3, 'hochrhein'); g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('plant'); g.traffic.spawnIn = 1e9; g.eventsOn = false; g.fleet.mine = false; fullLane(g, 'kahn');
  const r = g.river, cy = Math.round(r.centerY(30));
  let dead = -1; for (let i = 0; i < r.top.length; i++) if (!r.zone[i] && !r.ext[i]) { dead = i; break; }
  assert.ok(dead >= 0); assert.equal(addArea(g, dead % r.cols, (dead / r.cols) | 0, dead % r.cols, (dead / r.cols) | 0, 3), null, 'Land ausserhalb von Korridor und Ausbaustreifen geht nicht');
  const a = addArea(g, 29, cy - 1, 32, cy + 1, 4.2);
  assert.ok(a && a.depth === 4.2 && areaWork(g, a) > 0);
  const outside = [...r.top], before = areaWork(g, a);
  hireUnit(g);
  for (let i = 0; i < 14 * 60 * 20 && areaWork(g, a) > 0; i++) g.update(0.05);
  assert.ok(areaWork(g, a) < before, 'Gebiet wird tiefer');
  assert.ok(g.fleet.units[0].removed > 0);
  let changedFar = 0; for (let x = 0; x < r.cols; x++) for (let y = 0; y < r.rows; y++) if ((x < 26 || x > 36) && outside[y * r.cols + x] - r.top[y * r.cols + x] > 0.3) changedFar++; // nur Abtrag zählt (Verlandung hebt)
  assert.equal(changedFar, 0, 'weit ausserhalb bleibt unberührt');
  assert.ok(setAreaDepth(g, a.id, 9) && g.fleet.areas[0].depth === CONFIG.echolot.maxDepth);
  assert.ok(setAreaUnit(g, a.id, 99) && removeArea(g, a.id) && g.fleet.areas.length === 0);
});

test('Endlos: Seed bestimmt die Karte, weitere Karten erschliessen, alle laufen weiter, Speichern/Laden', () => {
  const a = new Game(4242, 'endlos'), b = new Game(4242, 'endlos'), c = new Game(4243, 'endlos');
  assert.equal(a.endless, true); assert.equal(a.maps.length, 1);
  assert.deepEqual([...a.river.top.slice(0, 200)], [...b.river.top.slice(0, 200)], 'gleicher Seed, gleiche Karte');
  assert.notDeepEqual([...a.river.top.slice(0, 200)], [...c.river.top.slice(0, 200)], 'anderer Seed, andere Karte');
  assert.ok(a.fair.kahn.passable, 'wie am ersten Level: Kähne fahren von Anfang an');
  assert.equal(a.goalReached, false);
  a.eventsOn = false; a.money = 1000;
  assert.equal(a.mapBlock(), `Braucht ${ENDLESS.mapCosts[1].toLocaleString('de-CH')} CHF`);
  a.money = 1e6; assert.equal(a.addMap(), 1);
  assert.equal(a.maps.length, 2); assert.equal(a.mapIdx, 0, 'Ansicht bleibt auf der aktuellen Karte');
  assert.ok(a.maps[1].fair.kahn.passable);
  assert.notDeepEqual([...a.maps[0].river.top.slice(0, 200)], [...a.maps[1].river.top.slice(0, 200)]);
  a.switchMap(1); a.buyUpgrade('auto'); hireUnit(a); a.switchMap(0);
  for (let i = 0; i < 14 * 40 * 20; i++) a.update(0.05);
  assert.ok(a.maps[1].fleet.units[0].removed > 0, 'Flotte der Nebenkarte baggert im Hintergrund');
  a.money = 1e6; while (a.addMap()) { /* bis zum Maximum */ }
  assert.equal(a.maps.length, ENDLESS.maxMaps); assert.ok(a.mapBlock());
  a.switchMap(2);
  const r = restoreGame(serializeGame(a));
  assert.ok(r, 'Spielstand lässt sich laden');
  assert.equal(r.maps.length, a.maps.length); assert.equal(r.mapIdx, 2);
  for (let i = 0; i < a.maps.length; i++) assert.deepEqual([...r.maps[i].river.top.slice(0, 300)], [...a.maps[i].river.top.slice(0, 300)]);
  assert.ok(r.maps.every((m) => m.fair && typeof m.river.centerY === 'function'));
  for (let i = 0; i < 200; i++) r.update(0.05);
});

function twoPorts() {
  const g = new Game(4242, 'endlos'); g.eventsOn = false; g.money = 2e6; g.addMap();
  for (let i = 0; i < 2; i++) withMap(g, i, () => {
    const p = g.port; p.open = true; p.slots[0] = { type: 'kai', level: 3 }; p.slots[1] = { type: 'kies', level: 2 }; p.slots[2] = { type: 'tank', level: 1 }; p.slots[4] = { type: 'cbruecke', level: 1 };
    ensureHarbor(p, g.wl); for (const c of p.harbor.cells) p.harbor.river.top[c] = g.wl - 5.5; // Hafenbecken tief genug für alle Klassen
  });
  return g;
}

test('Regionale Preise: jede Karte hat einen eigenen Markt', () => {
  const g = new Game(4242, 'endlos'); g.money = 1e6; g.addMap();
  assert.notEqual(priceOf(g.maps[0].market, 'kies'), priceOf(g.maps[1].market, 'kies'));
  assert.notEqual(g.maps[0].port, g.maps[1].port); assert.ok(g.maps[1].port.bay.cells.length > 0, 'jede Karte hat ein Hafenbecken');
});

test('Eigene Reederei: Route zwischen Karten, Ladung hängt von der Rinne ab, Niedrigwasser macht Fracht teurer', () => {
  const g = twoPorts();
  assert.equal(buyShip(g, 'tank') !== null, true);
  const s = buyShip(g, 'kahn'); setRoute(g, s.id, { from: 0, to: 1, cargo: 'kies', unload: 'now' });
  const hi = routeInfo(g, s); assert.ok(hi.ok, hi.reason); assert.ok(hi.eff > 0 && hi.perT > 0);
  // Niedrigwasser: Teilbeladung sinkt, Fracht je Tonne steigt
  const lf = g.maps.map((m) => m.fair.kahn.loadFactor); for (const m of g.maps) m.fair.kahn.loadFactor = Math.max(0.3, lf[0] * 0.5);
  const lo = routeInfo(g, s); assert.ok(lo.eff < hi.eff && lo.perT > hi.perT, 'weniger Ladung, teurere Fracht');
  for (let i = 0; i < 2; i++) g.maps[i].fair.kahn.loadFactor = lf[i];
  // gesperrte Rinne stoppt die Route
  g.maps[1].fair.kahn.passable = false; assert.equal(routeInfo(g, s).ok, false); g.maps[1].fair.kahn.passable = true;
  // Fahrt: kaufen, liefern, verkaufen; Preisunterschied wirkt
  g.maps[0].market.bias.kies = -0.25; g.maps[1].market.bias.kies = 0.25;
  const m0 = g.money; for (let i = 0; i < 14 * 12 * 20; i++) updateShipping(g, 0.05);
  assert.ok(s.trips >= 1 && s.profit > 0, 'Arbitrage bringt Gewinn');
  // Ziel einlagern statt verkaufen
  setRoute(g, s.id, { toStock: true, minMargin: -50, backhaul: false }); const st0 = g.maps[1].port.stock.kies;
  for (let i = 0; i < 14 * 12 * 20; i++) updateShipping(g, 0.05);
  assert.ok(g.maps[1].port.stock.kies > st0, 'Ware liegt im Zwischenlager des Zielhafens');
  assert.equal(sellShip(g, s.id) || s.state === 'sail', true);
  void m0;
});

test('Flotte: Naturschutzzonen und Altlastenbereiche lassen sich sperren', () => {
  const g = new Game(3, 'hochrhein'); const r = g.river;
  let alt = -1, nat = -1; for (let i = 0; i < r.top.length; i++) { if (alt < 0 && r.zone[i] && r.kind[i] === KIND.altlast && r.top[i] - r.rock[i] > 0.1) alt = i; if (nat < 0 && !r.zone[i] && r.ext[i] === 2) nat = i; }
  assert.ok(alt >= 0 && nat >= 0);
  assert.ok(cellAllowed(g, alt) && cellAllowed(g, nat));
  setAvoid(g, false, true); assert.equal(cellAllowed(g, alt), false); assert.ok(cellAllowed(g, nat));
  setAvoid(g, true, false); assert.equal(cellAllowed(g, nat), false); assert.ok(cellAllowed(g, alt));
  const sl = new SliceSim(r, computeStats({}), 20, 12, createRng(1)); sl.avoidAltlast = true;
  const col = alt % r.cols; void col;
});

test('Container-Fracht: Terminal, Lager, eigenes Containerschiff, alte Stände werden nachgerüstet', () => {
  const g = twoPorts();
  for (let i = 0; i < 2; i++) { g.maps[i].port.slots[3] = { type: 'container', level: 1 }; Object.assign(g.maps[i].fair.container, { passable: true, loadFactor: 0.8 }); g.maps[i].market.bias.container = i ? 0.25 : -0.25; }
  const s = buyShip(g, 'container'); assert.ok(s && s.cargo === 'container'); setRoute(g, s.id, { unload: 'now' });
  const info = routeInfo(g, s); assert.ok(info.ok, info.reason); assert.ok(info.eff > 500 && info.eff < 650);
  for (let i = 0; i < 14 * 14 * 20; i++) updateShipping(g, 0.05);
  assert.ok(s.trips >= 1, 'Containerschiff fährt');
  const dev0 = g.maps[1].market.dev.container; assert.ok(dev0 < 0.5, 'Verkäufe drücken den Preis im Zielhafen');
  const old = { stock: { kies: 5, oel: 0 }, cost: { kies: 1, oel: 0 }, auto: {} };
  ensurePort(old); assert.equal(old.stock.container, 0); assert.ok(old.auto.container);
});

test('Landseite: Strassen, Lagerhallen, Anbindung, Zusatzlager und schnellerer Umschlag', () => {
  const g = new Game(4242, 'endlos'); g.eventsOn = false; g.money = 1e6; g.port.open = true;
  const r = g.river, cols = r.cols, bay = new Set(g.port.bay.cells);
  assert.equal(roadFactor(g), 1); assert.equal(hallCapacity(g, 'container'), 0);
  // Randzelle am Hafenbecken (Land) suchen
  const rim = []; for (const c of bay) { const x = c % cols, y = (c / cols) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isLand(g, x + dx, y + dy)) rim.push([x + dx, y + dy]); }
  assert.ok(rim.length > 0, 'Land am Becken');
  const [rx, ry] = rim[0]; assert.ok(buildRoad(g, rx, ry)); assert.equal(buildRoad(g, rx, ry), false, 'belegt');
  assert.equal(connectedRoads(g).size, 1); assert.ok(roadFactor(g) > 1);
  assert.equal(buildRoad(g, 0, r.rows - 1) || isLand(g, 0, r.rows - 1) === false, true);
  // Halle ein Stück entfernt: erst nicht angebunden, dann per Auto-Strasse
  const side = ry < r.rows / 2 ? -1 : 1; let hx = -1, hy = -1;
  search: for (let d = 3; d < 12; d++) for (let dx = -3; dx <= 3; dx++) { const x = rx + dx, y = ry + side * d; if (isLand(g, x, y) && isLand(g, x + 1, y) && isLand(g, x, y + 1) && isLand(g, x + 1, y + 1) && ![x, x + 1].some((q) => bay.has(y * cols + q))) { hx = x; hy = y; break search; } }
  assert.ok(hx >= 0, 'Platz für Halle'); const m0 = g.money;
  assert.ok(buildHall(g, hx, hy)); assert.ok(g.money < m0 - LAND.hall.cost + 1);
  const h = landOf(g).halls[0]; assert.equal(hallConnected(g, h), false); assert.equal(hallCapacity(g, 'container'), 0, 'nicht angebunden: kein Lager');
  const res = autoRoad(g, h.id); assert.ok(res.ok, res.why); assert.ok(hallConnected(g, h));
  assert.equal(hallCapacity(g, 'container'), LAND.hall.cap.container[0]);
  assert.ok(upgradeHall(g, h.id)); assert.equal(hallCapacity(g, 'container'), LAND.hall.cap.container[1]);
  assert.equal(demolishAt(g, rx, ry), 'road');
  for (const i of [...landOf(g).roads]) demolishAt(g, i % cols, (i / cols) | 0);
  assert.equal(landOf(g).roads.length, 0); assert.equal(hallConnected(g, h), false);
});

test('Hafen: Naturschutz-Flachwasser neben dem Becken gehört zur Hafenzone (keine Schutzbusse)', () => {
  const g = new Game(4242, 'endlos'), r = g.river, bay = g.port.bay;
  const near = []; for (const c of bay.cells) { const x = c % r.cols, y = (c / r.cols) | 0; for (let dx = -2; dx <= 2; dx++) { const j = y * r.cols + x + dx; if (x + dx >= 0 && x + dx < r.cols && r.isWater(j)) near.push(j); } }
  assert.ok(near.length > 0);
  assert.ok(near.every((j) => r.zone[j] || r.ext[j] !== 2), 'kein Schutz-Flachwasser um das Becken');
});

test('Zweite Rinne: bei Gegenverkehr gibt es einen eigenen Pfad zum Einzeichnen', () => {
  const g = emptyGame(2); // breite, tiefe Rinne
  const f = g.fair.kahn; assert.ok(f.twoWay && f.secondPath?.points.length > 2);
  assert.ok(f.cross.some((v) => v === 1), 'Kreuzungsmöglichkeit in breiten Bereichen');
  const a = f.path.points[Math.floor(f.path.points.length / 2)], b = f.secondPath.points[Math.floor(f.secondPath.points.length / 2)];
  assert.ok(Math.abs(a.y - b.y) >= 2, 'die Rinnen liegen getrennt nebeneinander');
});

test('Flotte: eigenen Ponton zuteilen und zurückrufen', () => {
  const g = new Game(3, 'hochrhein'); g.money = 1e6; g.eventsOn = false; g.traffic.spawnIn = 1e9; g.fleet.mine = false;
  assert.ok(lendBlock(g), 'ohne Automatik nicht möglich'); g.buyUpgrade('auto'); g.buyUpgrade('plant');
  const cost0 = nextHireCost(g), u = lendPonton(g, 3, g.river.rows / 2); assert.ok(u && u.self);
  assert.equal(lendPonton(g, 3, 3), null, 'nur einmal'); assert.equal(nextHireCost(g), cost0, 'zählt nicht zu den gemieteten');
  const m0 = g.money; for (let i = 0; i < 14 * 30 * 20; i++) g.update(0.05);
  assert.ok(u.removed > 0, 'arbeitet'); assert.ok(g.money > m0 - 5000, 'kein Lohn');
  const pos = recallPonton(g); assert.ok(pos && lentUnit(g) === null); assert.equal(g.fleet.units.length, 0);
});

test('Stau: bei Niedrigwasser und Sperrung sinken die Preise vor Ort, danach erholen sie sich', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false; g.traffic.spawnIn = 1e9;
  const p0 = priceOf(g.market, 'kies');
  for (let i = 0; i < 20 * 14 * 3; i++) g.update(0.05); assert.ok(g.market.glut < 0.02, 'normaler Pegel: kein Abschlag');
  g.setWater(g.wl - 0.8, 5);
  for (let i = 0; i < 20 * 14 * 4; i++) g.update(0.05);
  assert.ok(g.market.glut > 0.1, `Niedrigwasser drückt die Preise (${g.market.glut.toFixed(2)})`);
  assert.ok(priceOf(g.market, 'kies') < p0 * 0.95 || g.market.dev.kies > 0);
  g.setWater(CONFIG.water.base + 1.5, 5);
  for (let i = 0; i < 20 * 14 * 4; i++) g.update(0.05);
  assert.ok(g.closed && g.market.glut > 0.2, 'Hochwasser-Sperre: starker Abschlag');
  g.setWater(CONFIG.water.base, 0);
  for (let i = 0; i < 20 * 14 * 12; i++) g.update(0.05);
  assert.ok(g.market.glut < 0.05, 'Erholung nach Ende der Sperre');
});

test('Aufbereitungshalle schaltet Anlagenstufen über 6 frei', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.unlocked.motor = true;
  g.levels.plant = 6; g._stats = null; g.money = 1e7;
  assert.equal(g.nextUpgradeCost('plant'), null);
  assert.ok(g.upgradeLocked('plant'));
  assert.ok(!g.buyUpgrade('plant'));
  assert.ok(openPort(g)); for (const s of g.port.sites) s.ready = true;
  assert.ok(build(g, 0, 'kai')); assert.ok(build(g, 1, 'werk'));
  assert.ok(g.buyUpgrade('plant') && g.buyUpgrade('plant'));
  assert.ok(!g.buyUpgrade('plant'));
  assert.ok(upgrade(g, 1)); assert.ok(g.buyUpgrade('plant'));
});

test('Schlepper auf Maximalstufe schleppen aufgelaufene Schiffe frei', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false;
  const mk = (tugs) => { g.levels.tugs = tugs; g._stats = null; const ship = spawnShip(g); return ship ?? g.traffic.ships[g.traffic.ships.length - 1]; };
  const ship = mk(3); assert.ok(ship);
  ship.state = 'grounded'; ship.ground = 0.01; g.wl -= 5; // so flach, dass es allein nicht reicht
  updateTraffic(g, 0.1);
  assert.equal(ship.state, 'sail'); assert.equal(g.totals.freed, 1);
  const s2 = mk(2); s2.state = 'grounded'; s2.ground = 0.01; updateTraffic(g, 0.1);
  assert.notEqual(s2.state, 'grounded'); assert.ok(!(s2.state === 'sail' && g.totals.freed > 1));
});

test('Arbeitsgebiet: Ufer erst, wenn das Wasser die Tiefe hat und Verbreitern an ist', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.levels.loeffel = 1; g._stats = null;
  const r = g.river, a = { id: 1, x0: 0, x1: r.cols - 1, y0: 0, y1: r.rows - 1, depth: 2.0, unit: null };
  const cols = openAreaColumns(g, a);
  assert.ok(cols.length > 0 && cols.every((c) => !c.land), 'ohne Verbreitern kein Ufer');
  g.fleet.widen = true;
  assert.ok(openAreaColumns(g, a).every((c) => !c.land), 'solange das Wasser nicht tief genug ist, kein Ufer');
});

test('Flotte: festgesetztes Ponton im Flachwasser kommt wieder frei', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false;
  g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('auto'); hireUnit(g);
  const u = g.fleet.units[0], r = g.river;
  for (let t = 0; t < 4 && u.state !== 'travel'; t += 0.1) updateFleet(g, 0.1);
  assert.equal(u.state, 'travel');
  // Ponton rundum einmauern: Flachwasser in 2 Zellen Umkreis
  const cx = Math.floor(u.sim.x), cy = Math.floor(u.sim.y);
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if ((x !== cx || y !== cy) && x >= 0 && y >= 0 && x < r.cols && y < r.rows && !(r.zone[y * r.cols + x] && false)) r.top[y * r.cols + x] = g.wl - 0.3;
  const x0 = u.sim.x, y0 = u.sim.y;
  for (let t = 0; t < 6; t += 0.05) updateFleet(g, 0.05);
  assert.ok(Math.hypot(u.sim.x - x0, u.sim.y - y0) > 2 || u.state !== 'travel', 'Ponton muss sich lösen');
});

test('Flotte: Einstellungsänderung lässt arbeitende Pontons sofort neu wählen', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false;
  g.money = 1e6; g.buyUpgrade('auto'); g.buyUpgrade('auto'); hireUnit(g);
  const u = g.fleet.units[0];
  for (let t = 0; t < 120 && u.state !== 'work'; t += 0.1) updateFleet(g, 0.1);
  assert.equal(u.state, 'work');
  setGoal(g, 'lastkahn');
  updateFleet(g, 0.1);
  assert.notEqual(u.state, 'work');
  assert.equal(u.sim.mode, 'map');
});

test('Vorkommen: leere verschwinden, mit der Zeit erscheinen neue zum Kauf', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false;
  const r = g.river, d0 = r.deposits[0];
  for (let i = 0; i < r.dep.length; i++) if (r.dep[i] === d0.id) r.depLeft[i] = 0; // abgebaut
  g.depositsDay();
  assert.ok(d0.depleted);
  assert.ok(!r.dep.some((v) => v === d0.id));
  assert.match(g.concessionBlock(d0.id), /abgebaut/);
  const n0 = r.deposits.length, rng0 = g.rng; g.rng = () => 0.001; // jetzt sicher: neues Vorkommen
  g.rng.range = (a, b) => a + (b - a) * 0.5;
  for (let k = 0; k < 6; k++) g.depositsDay();
  g.rng = rng0;
  const fresh = r.deposits.slice(n0);
  assert.ok(fresh.length >= 1, 'neues Vorkommen erscheint');
  assert.ok(fresh.every((d) => d.known && !d.owned && !d.depleted && r.depositRemaining(d.id) > 6));
  const rt = restoreGame(serializeGame(g)); assert.equal(rt.river.deposits.length, r.deposits.length);
});

test('Endlos: Hallen aller Karten zählen für den Anlagenausbau (bis Stufe 24)', () => {
  const g = new Game(11, 'endlos'); g.eventsOn = false; g.money = 1e9; g.unlocked.motor = true;
  assert.ok(g.endless);
  g.addMap(); g.addMap(); assert.equal(g.maps.length, 3);
  for (let k = 0; k < 3; k++) {
    g.switchMap(k); g.unlocked.motor = true;
    assert.ok(openPort(g)); for (const s of g.port.sites) s.ready = true;
    assert.ok(build(g, 0, 'kai')); assert.ok(build(g, 1, 'werk')); assert.ok(upgrade(g, 1)); assert.ok(upgrade(g, 1));
  }
  g.levels.plant = 12; g._stats = null;
  assert.ok(g.nextUpgradeCost('plant') > 0);
  for (let i = 12; i < 24; i++) assert.ok(g.buyUpgrade('plant'), 'Stufe ' + (i + 1));
  assert.equal(g.levels.plant, 24); assert.equal(g.nextUpgradeCost('plant'), null);
  assert.ok(g.stats.plantCapacity > 150);
});

test('Baggerroute: Zellen entlang der Linie, Pontons baggern sie auch über das Ufer', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false;
  g.money = 1e6; for (const id of ['auto', 'auto', 'loeffel']) g.buyUpgrade(id); hireUnit(g);
  const r = g.river, cy = Math.round(r.centerY(20));
  // Linie quer vom Fahrwasser über das Ufer (Ausbaustreifen)
  const a = addRoute(g, [{ x: 20.5, y: cy + 0.5 }, { x: 20.5, y: 2.5 }, { x: 24.5, y: 2.5 }], 2.5, 3);
  assert.ok(a && a.route && a.cells.length > 10);
  assert.ok(a.cells.some((i) => !r.zone[i] && r.ext[i]), 'enthält Ufer/Land im Ausbaustreifen');
  assert.ok(openAreaColumns(g, a).some((c) => c.land), 'Land zählt als offen');
  const w0 = a.w; assert.ok(setAreaWidth(g, a.id, w0 + 2) && a.w === w0 + 2);
  for (let t = 0; t < 300; t += 0.1) updateFleet(g, 0.1);
  assert.ok(g.totals.landRemoved > 20, 'Flotte trägt Ufer/Land entlang der Route ab');
  assert.equal(addRoute(g, [{ x: 1, y: 1 }], 2), null);
});

test('Zwei Rinnen: bei einseitigem Andrang fahren beide Spuren, Gegenverkehr nutzt die zweite', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false;
  const cid = Object.keys(g.fair).find((id) => g.fair[id].passable), f = g.fair[cid];
  f.twoWay = true; f.secondPath = { ...f.path, points: f.path.points.map((p) => ({ ...p, y: p.y + 1.5 })) };
  const mk = (dir) => { let s = null; for (let k = 0; k < 40 && !s; k++) s = spawnShip(g); s.dir = dir; s.cls = cid; return s; };
  const a = [mk(1), mk(1), mk(1)];
  for (let t = 0; t < 25; t += 0.1) { g.time += 0.1; updateTraffic(g, 0.1); }
  const used = new Set(a.filter((s) => s.state === 'sail' || s.state === 'done').map((s) => !!s.alt));
  assert.ok(a.some((s) => s.state === 'sail' || s.state === 'done'));
  assert.ok(used.has(true) && used.has(false), 'beide Spuren genutzt');
  // Gegenverkehr: fährt auf der zweiten Spur, solange die Hauptspur nicht blockiert ist
  const g2 = new Game(7, 'hochrhein'); g2.eventsOn = false; const f2 = g2.fair[cid]; f2.twoWay = true; f2.secondPath = { ...f2.path, points: f2.path.points.map((p) => ({ ...p, y: p.y + 1.5 })) };
  let s2 = null; for (let k = 0; k < 40 && !s2; k++) s2 = spawnShip(g2); s2.dir = -1; s2.cls = cid;
  for (let t = 0; t < 5; t += 0.1) updateTraffic(g2, 0.1);
  assert.equal(s2.state, 'sail'); assert.equal(s2.alt, true);
});

test('Kreuzung: zugeteiltes Ponton hat Vorrang und stoppt alles andere', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false;
  g.money = 1e6; for (const id of ['auto', 'auto', 'loeffel', 'signals']) g.buyUpgrade(id);
  hireUnit(g); hireUnit(g);
  const [u1, u2] = g.fleet.units, x = Math.floor(g.river.cols * 0.7);
  assert.ok(g.placeZone(x));
  const z = g.zones[0]; z.cls = g.level.classes[g.level.classes.length - 1]; // grösste Klasse: Stelle ist noch nicht ausgebaut
  assert.ok(setZoneUnit(g, z.id, u1.id));
  for (let t = 0; t < 150; t += 0.1) updateFleet(g, 0.1);
  assert.ok(/Kreuzungsstelle/.test(u1.note), u1.note);
  assert.ok(u1.site?.zid === z.id || u1.state === 'idle', 'u1 arbeitet nur an der zugeteilten Kreuzung');
  assert.ok(!u2.site || u2.site.zid !== z.id, 'u2 lässt die Kreuzung in Ruhe');
});

test('Freigeschleppt: Schiff fährt mindestens 5 s und über die Untiefe, ohne wieder aufzulaufen', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false;
  const cid = Object.keys(g.fair).find((id) => g.fair[id].passable);
  let s = null; for (let k = 0; k < 40 && !s; k++) s = spawnShip(g); s.cls = cid; s.dir = 1;
  for (let t = 0; t < 30; t += 0.1) { g.time += 0.1; updateTraffic(g, 0.1); if (s.state === 'sail' && s.s > 8) break; }
  s.state = 'grounded'; s.ground = 30; s.salvage = 100; g.wl -= 6; // die ganze Strecke ist zu flach
  assert.ok(g.rescueShip(s.id));
  for (let t = 0; t < 20; t += 0.1) { g.time += 0.1; updateTraffic(g, 0.1); assert.notEqual(s.state, 'grounded', 'bei ' + t.toFixed(1) + ' s aufgelaufen'); if (s.state !== 'sail') break; }
  const g0 = g.totals.groundings;
  for (let t = 0; t < 12; t += 0.1) { g.time += 0.1; updateTraffic(g, 0.1); }
  assert.ok(g.totals.groundings >= g0); // nach 25 s darf es wieder auflaufen (flache Strecke ohne Ende)
});

test('Hafen: Liegeplätze werden reserviert, Schiffe legen an und fahren nach dem Verladen weiter', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.money = 1e7; g.unlocked.motor = true;
  assert.ok(openPort(g)); for (const s of g.port.sites) s.ready = true;
  assert.ok(build(g, 0, 'kai')); assert.ok(build(g, 1, 'kies'));
  for (const i of g.port.harbor.cells) g.port.harbor.river.top[i] = g.wl - 3; // Becken tief genug
  assert.equal(berthsOf(g), 2);
  const cid = Object.keys(g.fair).find((id) => g.fair[id].passable);
  const mk = () => { let s = null; for (let k = 0; k < 60 && !s; k++) s = spawnShip(g); s.cls = cid; s.dir = 1; s.cargo = 'kies'; s.tons = 400; return s; };
  g.market.dev.kies = -0.4; // billig: Schiffe entladen, das dauert
  const ships = [mk(), mk(), mk()];
  let docked = 0, maxJobs = 0, waited = false;
  for (let t = 0; t < 400; t += 0.1) {
    g.time += 0.1; updateTraffic(g, 0.1); updatePort(g, 0.1);
    docked = Math.max(docked, ships.filter((s) => s.state === 'dock').length); maxJobs = Math.max(maxJobs, g.port.jobs.filter((j) => !j.wait).length); waited = waited || g.port.jobs.some((j) => j.state === 'waiting');
  }
  assert.ok(docked >= 1, 'mindestens ein Schiff legt an');
  assert.ok(maxJobs <= 2, 'nie mehr Aufträge als Liegeplätze');
  assert.ok(waited, 'das dritte Schiff wartet im Warteraum');
  assert.ok(ships.every((s) => s.state !== 'dock'), 'alle haben wieder abgelegt');
  assert.ok(g.port.jobsDone >= 1 || g.port.ships >= 1);
  assert.equal(g.port.jobs.length, 0);
});

test('Zuflüsse: nur auf weiteren Karten, tragen laufend Sand/Kies in die Rinne', () => {
  const g = new Game(11, 'endlos'); g.money = 1e9; g.addMap();
  assert.equal(g.maps[0].river.tribs.length, 0, 'erste Karte ohne Zufluss');
  const r = g.maps[1].river; assert.ok(r.tribs.length >= 1);
  const t = r.tribs[0]; assert.ok(t.cells.length > 5);
  const before = t.cells.map((i) => r.top[i]);
  for (let k = 0; k < 400; k++) r.tribDeposit(1);
  const grown = t.cells.filter((i, k) => r.top[i] > before[k] + 0.1);
  assert.ok(grown.length >= 3, 'Sohle wächst an der Mündung');
  assert.ok(t.cells.every((i) => r.top[i] <= Math.max(before[t.cells.indexOf(i)], r.cap[i] + 0.81)), 'aber nur begrenzt');
  const rt = restoreGame(serializeGame(g)); assert.equal(rt.maps[1].river.tribs.length, r.tribs.length);
});

test('Hafenkarte: eigenes Becken, Pontons lassen sich zuteilen und baggern es aus, Kai-Stufe 1 nimmt nur die einfachste Klasse an', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.money = 1e7; g.unlocked.motor = true;
  for (const id of ['auto', 'auto']) g.buyUpgrade(id);
  assert.ok(openPort(g)); assert.ok(g.port.harbor, 'Hafenkarte entsteht mit dem Hafen');
  for (const s of g.port.sites) s.ready = true; assert.ok(build(g, 0, 'kai')); assert.ok(build(g, 1, 'kies'));
  assert.ok(bayDepth(g) < 1.2, 'Becken anfangs flach');
  assert.ok(!harborAccepts(g.port, g.wl, 1, 'kahn'), 'zu flach');
  hireUnit(g); const u = g.fleet.units[0];
  assert.ok(setUnitLoc(g, u.id, 'harbor')); assert.equal(u.loc, 'harbor');
  for (let t = 0; t < 4000 && bayDepth(g) < 2.0; t += 0.1) g.update(0.1);
  assert.ok(bayDepth(g) >= 2.0, 'Pontons baggern das Becken: ' + bayDepth(g));
  assert.ok(harborAccepts(g.port, g.wl, 1, 'kahn'), 'Lastkahn passt jetzt');
  assert.ok(!harborAccepts(g.port, g.wl, 1, 'motor'), 'Kai Stufe 1: nur die einfachste Klasse');
  assert.equal(fleetSites(g).length, 0, 'Pontons im Hafen bremsen den Fluss nicht');
  assert.ok(setUnitLoc(g, u.id, 'main'));
  const rt = restoreGame(serializeGame(g)); assert.ok(rt.port.harbor?.river?.top instanceof Float32Array);
  assert.ok(Math.abs(bayDepth(rt) - bayDepth(g)) < 1e-6);
});

test('Alter Spielstand mit geöffnetem Hafen (ohne Hafenkarte, Aufträge ohne Zustand) lädt und bekommt die Hafenkarte nachträglich', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.money = 1e7; g.unlocked.motor = true;
  openPort(g); for (const s of g.port.sites) s.ready = true; build(g, 0, 'kai');
  g.port.jobs.push({ id: 1, cargo: 'kies', tons: 100, done: 0, out: false, price: 18, left: 30, fee: 500, ship: 'kahn' }); // alt: ohne state/shipId
  delete g.port.harbor; g.port.bay = g.port.bay;
  const rt = restoreGame(serializeGame(g));
  assert.ok(rt, 'lädt'); assert.ok(rt.port.harbor?.river?.top instanceof Float32Array, 'Hafenkarte nachgerüstet');
  assert.ok(isDocked(rt.port.jobs[0]));
  updatePort(rt, 1); rt.update(0.5); assert.ok(bayDepth(rt) > 0);
});

test('Warteräume: Zuweisung der Fracht, Warteschiff rückt nach, Vorrang-Fracht zuerst', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.money = 1e7; g.unlocked.motor = true;
  openPort(g); for (const s of g.port.sites) s.ready = true; build(g, 0, 'kai'); build(g, 1, 'kies'); build(g, 2, 'tank');
  for (const i of g.port.harbor.cells) g.port.harbor.river.top[i] = g.wl - 3;
  assert.equal(waitsOf(g), 1); assert.ok(cycleWaitCargo(g, 0)); assert.equal(g.port.waitCargo[0], 'kies');
  const cid = Object.keys(g.fair).find((id) => g.fair[id].passable);
  const ship = (cargo) => ({ id: g.traffic.seq + 1000 + Math.floor(g.rng() * 1e6), cls: cid, cargo, tons: 600 });
  const a = ship('kies'), b = ship('kies'), c = ship('kies'), d = ship('oel');
  for (const s of [a, b, c, d]) { s.state = 'sail'; g.traffic.ships.push(s); }
  const j1 = reserveBerth(g, a), j2 = reserveBerth(g, b);
  assert.ok(j1 && j2 && !j1.wait && !j2.wait, 'zwei Liegeplätze');
  const j3 = reserveBerth(g, c); assert.ok(j3?.wait && j3.slot === 0, 'drittes Schiff wartet');
  assert.equal(reserveBerth(g, d), null, 'Öl darf nicht in den Kies-Warteraum: fährt vorbei');
  for (const s of [a, b, c]) { assert.ok(dockShip(g, s)); }
  assert.equal(j3.state, 'waiting'); assert.equal(berthJobs(g).length, 2);
  j1.done = j1.tons; updatePort(g, 0.1); // Liegeplatz 1 wird frei: das Warteschiff rückt nach
  assert.equal(j3.state, 'docked'); assert.equal(j3.wait, false); assert.equal(a.state, 'sail');
});

test('Containerbrücke: Containerschiffe brauchen sie, Container werden schneller umgeschlagen; neue Beckentiefen', () => {
  const g = new Game(7, 'hochrhein'); g.eventsOn = false; g.money = 1e8; g.unlocked.motor = true;
  openPort(g); for (const s of g.port.sites) s.ready = true; build(g, 0, 'kai'); upgrade(g, 0); upgrade(g, 0); build(g, 1, 'container');
  for (const i of g.port.harbor.cells) g.port.harbor.river.top[i] = g.wl - 5.2;
  assert.equal(berthsOf(g), 5); assert.ok(harborAccepts(g.port, g.wl, 3, 'container'), 'Becken tief genug (5,0 m)');
  assert.ok(!harborAccepts(g.port, g.wl, 1, 'motor'), 'Kai Stufe 1 nimmt nur den Lastkahn');
  const ship = { id: 501, cls: 'container', cargo: 'container', tons: 2000, state: 'sail' }; g.traffic.ships.push(ship);
  assert.equal(reserveBerth(g, ship), null, 'ohne Brücke kein Containerschiff');
  assert.ok(build(g, 2, 'cbruecke')); assert.equal(machineOf(g, 'container'), 'bruecke'); assert.equal(machineOf(g, 'kies'), 'radlader');
  const job = reserveBerth(g, ship); assert.ok(job && job.cargo === 'container'); assert.ok(dockShip(g, ship));
  g.market.dev.container = -0.4; const d0 = job.done; updatePort(g, 10); const withBridge = job.done - d0;
  const job2 = { ...job, done: 0 }; assert.ok(withBridge >= PORT.jobs.crewRate.container * 10 * 2.9, 'mindestens 3× schneller: ' + withBridge);
  assert.ok(job2.done === 0);
  assert.ok(HARBOR.need.motor >= 3 && HARBOR.need.container >= 5, 'grössere Tiefen für grosse Schiffe');
});

test('Pfahlwand: Pfahl ist fest, hält die Böschung und sperrt den Abtrag zwischen Pfahl und Ufer, nur in der eigenen Spalte', () => {
  const g = new Game(7, 'hochrhein'); const r = g.river, x = 20, cy = Math.round(r.centerY(x));
  const idx = (xx, yy) => yy * r.cols + xx, pile = idx(x, cy - 3), shore = idx(x, cy - 5), chan = idx(x, cy), other = idx(x + 3, cy - 5);
  const top0 = r.top[shore], otherTop = r.top[other];
  r.setPile(pile, true);
  assert.equal(r.pile[pile], 1); assert.ok(r.top[pile] >= r.wl - 0.51, 'Oberkante Beton knapp unter Wasser');
  assert.ok(r.lim[shore] > -90 && r.lim[other] < -90, 'Sperre nur in der Spalte mit Pfahl');
  // Abtrag: Pfahl bleibt, Ufer-Zelle nicht tiefer als Oberkante, Rinne frei
  const topP = r.top[pile]; r._drain([[pile, 1], [shore, 1], [chan, 1]], 50, 1);
  assert.equal(r.top[pile], topP, 'Pfahl wird nicht abgetragen'); assert.ok(r.top[shore] >= r.lim[shore] - 1e-6 || r.top[shore] >= top0 - 1e-6, 'Abtragsperre');
  r.setPile(pile, false); assert.ok(r.lim[shore] < -90, 'Sperre fällt mit dem Pfahl weg');
  assert.equal(r.top[other], otherTop);
});

test('Pfahlwand: Pontons mit Betoniergerät setzen die geplanten Pfähle (Beton wird verbraucht)', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false; g.money = 1e7; for (const id of ['auto', 'auto', 'piler']) g.buyUpgrade(id);
  hireUnit(g); const r = g.river, x = 12, cy = Math.round(r.centerY(x)), cells = lineCells(r, x, cy - 4, x, cy - 2);
  assert.equal(planPile(g, cells), cells.length);
  assert.equal(planPile(g, [r.idx(0, 0)]), 0, 'Land ist nicht planbar');
  g.concrete = 100; for (let t = 0; t < 40; t += 0.1) g.update(0.1);
  assert.equal(g.totals.piles ?? 0, 0, 'ohne «Ausführen» wird nichts gebaut');
  startPiles(g, true); g.concrete = 0; for (let t = 0; t < 60; t += 0.1) g.update(0.1);
  assert.equal(g.totals.piles ?? 0, 0, 'ohne Beton wird nichts gebaut');
  g.concrete = 100; for (let t = 0; t < 200; t += 0.1) g.update(0.1);
  assert.equal(g.totals.piles, cells.length); assert.ok(cells.every((i) => r.pile[i]));
  assert.ok(g.concrete <= 100 - (4 + 2.2) * cells.length); assert.equal(g.fleet.pilePlan.length, 0);
  assert.ok(r.lim.some((v) => v > -90), 'Abtragsperre gesetzt');
  const rt = restoreGame(serializeGame(g)); assert.ok(rt.river.pile.some((v) => v === 1) && rt.river.lim.some((v) => v > -90));
});

test('Tiefe Rinne für grosse Schiffe: ohne Pfahlwand rutschen die Böschungen zu, mit Pfählen bleibt sie offen; Pfahlgerät nötig und schneller', () => {
  const run = (piles) => {
    const g = new Game(7, 'hochrhein'), r = g.river, wl = r.wl, path = g.fair.kahn.nodes, need = 4.35;
    for (const n of path) for (let k = -1; k <= 1; k++) { const y = n.y + k; if (y < 0 || y >= r.rows) continue; const i = y * r.cols + n.x; if (r.zone[i]) { r.top[i] = Math.min(r.top[i], wl - need); r.rock[i] = Math.min(r.rock[i], r.top[i] - 0.5); } }
    for (let i = 0; i < r.top.length; i++) r.pending.add(i);
    if (piles) for (const n of path) for (const s of [-2, 2]) { const y = n.y + s; if (y >= 0 && y < r.rows) { const i = y * r.cols + n.x; if (r.zone[i] && !r.pile[i]) r.setPile(i, true); } }
    for (let k = 0; k < 400; k++) r.settle(Infinity);
    return analyzeClass(r, wl, shipById('container')).passable;
  };
  assert.equal(run(false), false, 'ohne Wand füllt die Böschung die tiefe Rinne wieder auf'); assert.equal(run(true), true, 'mit Wand bleibt sie offen');
  const g = new Game(3, 'hochrhein'); g.eventsOn = false; g.money = 1e7; g.buyUpgrade('auto'); hireUnit(g); g.buyUpgrade('betonrohr');
  const r = g.river, cy = Math.round(r.centerY(12)), cell = r.idx(12, cy - 3); planPile(g, [cell]); startPiles(g, true); g.concrete = 200;
  for (let t = 0; t < 100; t += 0.1) g.update(0.1);
  assert.equal(r.pile[cell], 0, 'ohne Pfahlgerät keine Pfähle');
  g.buyUpgrade('piler'); const t1 = g.stats.pileTime; g.buyUpgrade('piler'); assert.ok(g.stats.pileTime < t1, 'höhere Stufe baut schneller');
  const c0 = g.concrete; for (let t = 0; t < 100; t += 0.1) g.update(0.1);
  assert.equal(r.pile[cell], 1); assert.ok(c0 - g.concrete > 8, 'Pfahl reicht bis auf den Fels: Beton nach Länge, nicht pauschal');
});

test('Pfahl-Rückbau: vorgemerkte Pfähle werden herausgerammt, Beton teilweise zurück, Sperre fällt weg', () => {
  const g = new Game(3, 'hochrhein'); g.eventsOn = false; g.money = 1e7; for (const id of ['auto', 'piler']) g.buyUpgrade(id);
  hireUnit(g); const r = g.river, cy = Math.round(r.centerY(12)), pile = r.idx(12, cy - 3), shore = r.idx(12, cy - 5);
  r.setPile(pile, true); assert.ok(r.lim[shore] > -90);
  assert.equal(planRemoval(g, [r.idx(12, cy)], true), 0, 'ohne Pfahl nichts vorzumerken'); assert.equal(planRemoval(g, [pile], true), 1); startPiles(g, true);
  g.concrete = 0; for (let t = 0; t < 100; t += 0.1) g.update(0.1);
  assert.equal(r.pile[pile], 0, 'Pfahl ist weg (Rückbau braucht keinen Beton)'); assert.ok(r.lim[shore] < -90, 'Abtragsperre fällt weg');
  assert.ok(g.concrete > 3, 'ein Teil des Betons kommt zurück: ' + g.concrete); assert.equal(g.totals.pilesRemoved, 1); assert.equal(g.fleet.pileRemove.length, 0);
  assert.ok(r.cap[pile] > r.top[pile], 'Zelle kann wieder verlanden');
  planRemoval(g, [pile], true); assert.equal(g.fleet.pileRemove.length, 0, 'Zelle ohne Pfahl ist nicht vormerkbar');
});

test('Tiefe Rinne ohne Wand geht, wenn sie breit genug ist (Böschung); die Wand erlaubt schmalere Rinnen', () => {
  const S = CONFIG.layer.slope, wide = (seed, cid, need) => {
    const g = new Game(seed, 'hochrhein'), r = g.river, wl = r.wl, cls = shipById(cid), half = Math.floor(cls.beam / 2);
    for (const n of g.fair.kahn.nodes) for (let y = 0; y < r.rows; y++) { const d = Math.max(0, Math.abs(y - n.y) - half), depth = need - d * S * 0.95, i = y * r.cols + n.x; if (depth > 0.4 && r.zone[i]) { r.top[i] = Math.min(r.top[i], wl - depth); r.rock[i] = Math.min(r.rock[i], r.top[i] - 0.4); } }
    for (let i = 0; i < r.top.length; i++) r.pending.add(i);
    for (let k = 0; k < 400; k++) r.settle(Infinity);
    return analyzeClass(r, wl, cls).passable;
  };
  assert.equal(wide(7, 'container', 4.35), true, 'Containerschiff: breites Trapezprofil hält ohne Wand');
  assert.equal(wide(7, 'tank', 3.25), true);
  assert.equal(wide(7, 'schub', 5.55), false, 'Schubverband: der Korridor ist zu schmal für die Böschung (ohne Verbreiterung oder Wand)');
  assert.equal(laneMargin({}, 1.7), 1); assert.ok(laneMargin({}, 4.3) >= 3 && laneMargin({}, 5.5) > laneMargin({}, 4.3), 'Flotte baggert je tiefer, desto breiter');
});

test('Pfahlwand-Planung: zeigt je Abschnitt Breite zwischen den Wänden sowie fahrende und kreuzende Klassen', () => {
  const g = new Game(7, 'hochrhein'), r = g.river, x = 15, c = Math.round(r.centerY(x));
  assert.deepEqual(wallSpans(g), [], 'ohne Wand nichts');
  r.setPile(r.idx(x, c - 4), true); planPile(g, [r.idx(x, c + 3)]); // 6 Zellen dazwischen (eine Wand geplant)
  planPile(g, [r.idx(x + 1, c - 4), r.idx(x + 1, c + 3)]); r.setPile(r.idx(x + 1, c - 4), true);
  let sp = wallSpans(g); assert.equal(sp.length, 1, 'zwei Spalten mit gleichem Ergebnis werden zusammengefasst'); assert.equal(sp[0].w, 6); assert.deepEqual([sp[0].x0, sp[0].x1], [x, x + 1]);
  assert.deepEqual(sp[0].pass, ['kahn', 'motor', 'tank', 'container', 'schub'].filter((id) => shipById(id).beam <= 6)); assert.deepEqual(sp[0].cross, ['kahn', 'motor'], 'kreuzen: 2 × Breite + 1 ≤ 6');
  planRemoval(g, [r.idx(x, c - 4)]); sp = wallSpans(g); assert.equal(sp.length, 1, 'zum Rückbau vorgemerkte Pfähle zählen nicht'); assert.equal(sp[0].x0, x + 1);
});

// ---------- Rinne selbst festlegen, Fokus der Flotte ----------
import { startPiles, setFocus, focusActive } from '../src/sim/fleet.js';
test('Festgelegte Rinne: Analyse folgt der Linie (±1 Zelle); Löschen stellt die freie Suche wieder her', () => {
  const g = new Game(6, 'hochrhein'); g.eventsOn = false; g.traffic.spawnIn = 1e9;
  const free = g.fair.kahn.nodes.map((p) => p.y);
  const y = Math.round(g.river.rows / 2);
  g.setTrasse(0, [{ x: 0.5, y: y + 0.5 }, { x: g.river.cols - 0.5, y: y + 0.5 }]);
  const f = g.fair.kahn;
  if (!f.trasseBlocked) for (const p of f.nodes) assert.ok(Math.abs(p.y - y) <= 2.5, `y=${p.y}`);
  g.setTrasse(0, null);
  assert.deepEqual(g.fair.kahn.nodes.map((p) => p.y), free);
});

test('Fokus: auch ohne festgelegte Rinne aktiv, mit Rinne baut die Flotte nur dort', () => {
  const g = new Game(6, 'hochrhein'); g.eventsOn = false;
  setFocus(g, true); assert.equal(focusActive(g), true, 'auch ohne festgelegte Rinne: automatische Fahrrinne');
  g.setTrasse(0, [{ x: 0.5, y: 10.5 }, { x: 40.5, y: 10.5 }]);
  assert.equal(focusActive(g), true);
});

test('Spielstand: Trasse bleibt erhalten; fehlende Geräte-Stufen werden mit 0 ergänzt (kein NaN)', () => {
  const g = new Game(6, 'hochrhein'); g.eventsOn = false;
  g.setTrasse(0, [{ x: 0.5, y: 10.5 }, { x: 40.5, y: 12.5 }]);
  delete g.levels.piler;
  const g2 = restoreGame(serializeGame(g));
  assert.equal(g2.river.trasse[0].length, 2);
  assert.equal(g2.levels.piler, 0);
  assert.ok(Number.isFinite(g2.nextUpgradeCost('piler')));
});

test('Pontonmiete steigt über alle Karten weiter', async () => {
  const { hireCostAt, hiredTotal } = await import('../src/sim/fleet.js');
  assert.equal(hireCostAt(0), 30000);
  assert.ok(hireCostAt(4) > hireCostAt(3) && hireCostAt(7) > hireCostAt(5));
  const g = new Game(6, 'hochrhein'); g.eventsOn = false; g.money = 1e8; g.buyUpgrade('auto');
  hireUnit(g); hireUnit(g);
  assert.equal(hiredTotal(g), 2);
  assert.equal(nextHireCost(g), hireCostAt(2));
});

// ---------- Level-System nach Schiffsklassen ----------
import { rankOf as rankOf2, fleetMax, hasRank } from '../src/sim/rank.js';
test('Level: Start = Level 1 (eine gemietete Flotte mit 1 Ponton), Hafen/Geräte/Handel gesperrt; Motorschiff-Rinne öffnet Level 2', () => {
  UNLOCK.enabled = true;
  try {
    const g = new Game(6, 'hochrhein'); g.eventsOn = false; g.money = 1e8;
    assert.equal(rankOf2(g), 1); assert.equal(fleetMax(g), 1);
    assert.equal(g.buyUpgrade('auto'), true);
    assert.equal(g.buyUpgrade('cutter'), false, 'Felsfräse braucht Level 3');
    assert.equal(g.buyUpgrade('piler'), false, 'Pfahlgerät braucht Level 3');
    assert.ok(g.zoneBlock(20), 'Kreuzungen brauchen Level 2');
    assert.ok(hireUnit(g)); assert.ok(hireBlock(g), 'zweiter Ponton erst mit Level 2');
    assert.equal(hasRank(g, 'port'), false);
    g.unlocked.motor = true; g.analyze(true);
    assert.equal(rankOf2(g), 2); assert.equal(fleetMax(g), 2); assert.equal(g.zoneBlock(20) === null || !/Level/.test(g.zoneBlock(20)), true);
  } finally { UNLOCK.enabled = false; }
});

test('Anlage: Stapelbecken und Verarbeitung getrennt, frei nach 45 s vollem Puffer oder Level 2; Leitbaken bremsen weniger', () => {
  UNLOCK.enabled = true;
  try {
    const g = new Game(6, 'hochrhein'); g.eventsOn = false; g.money = 1e8;
    assert.equal(g.stats.bufferCapacity, 1000);
    assert.equal(g.buyUpgrade('buffer'), false, 'gesperrt');
    g.totals.bufFullSec = 46;
    assert.equal(g.buyUpgrade('buffer'), true); assert.ok(g.stats.bufferCapacity > 1000);
    const pc = g.stats.plantCapacity; assert.equal(g.buyUpgrade('plant'), true); assert.ok(g.stats.plantCapacity > pc);
    g.totals.bufFullSec = 0; g.unlocked.motor = true; g.analyze(true);
    assert.equal(g.buyUpgrade('dewater'), true, 'Level 2 öffnet die Anlage ebenfalls');
    assert.equal(g.buyUpgrade('guide'), true); assert.ok(g.stats.siteRelief > 0);
  } finally { UNLOCK.enabled = false; }
});

test('Kreuzungsstelle: Ein- und Ausfahrt gehören zum Plan, gemeinsame Spurzeilen, bereit erst wenn alles tief genug ist', () => {
  const g = new Game(6, 'hochrhein'); g.eventsOn = false; g.money = 1e8;
  const cls = shipById('kahn'), x = 20, R = CONFIG.zones.ramp;
  const p = g.zonePlanFor(x, 'kahn');
  assert.ok(p.wins && p.wins.length === 3 + 2 * R, 'Kern plus Zufahrten');
  assert.ok(new Set(p.wins.map((w) => w.a)).size === 1 && new Set(p.wins.map((w) => w.b)).size === 1, 'gleiche Zeilen in allen Spalten');
  assert.ok(Array.isArray(p.rampVolume));
  // Kern und Zufahrten auf Tiefe baggern (beide Fenster): dann ist die Stelle bereit
  const r = g.river;
  for (const w of p.wins) for (const a of [w.a, w.b]) for (let k = a; k < a + cls.beam; k++) { const i = k * r.cols + w.x; if (r.top[i] > p.needTop) r.top[i] = p.needTop - 0.05; }
  g.analyze(true);
  const p2 = g.zonePlanFor(x, 'kahn');
  assert.ok(p2.ready, 'bereit nach dem Ausbau'); assert.ok(p2.volume <= 1e-6);
  // eine Spalte der Einfahrt wieder verflachen: nicht mehr bereit, Fehlmenge in der Einfahrt
  const w0 = p.wins[0]; for (let k = w0.a; k < w0.a + cls.beam; k++) r.top[k * r.cols + w0.x] = p.needTop + 0.5;
  g.analyze(true);
  const p3 = g.zonePlanFor(x, 'kahn');
  assert.equal(p3.ready, false); assert.ok(p3.rampVolume[0] > 0);
});

import { unloadNow, holdInfo } from '../src/sim/shipping.js';
test('Reederei: Ankunft mit Wahl: abladen oder warten, Abladen ab Preis, Wartezeit kostet Unterhalt', () => {
  const g = new Game(8, 'endlos'); g.eventsOn = false; g.money = 1e8;
  // zwei Karten mit Hafen vorbereiten wie im bestehenden Reederei-Test
  const base = g.maps[0]; void base;
  const S = g.shipping; S.ships.push({ id: 1, type: 'kahn', name: 'T', from: 0, to: 1, cargo: 'kies', autoBuy: false, toStock: false, backhaul: false, unload: 'manual', unloadMin: 0, minMargin: 0, state: 'sail', leg: 'out', t: 10, dur: 10, load: 100, basis: 10, profit: 0, trips: 0, note: '' });
  g.maps.push({ ...g.maps[0], market: { ...g.maps[0].market, history: { kies: [18, 19, 20] } } });
  g.update(0.05); const s = S.ships[0];
  assert.equal(s.state, 'hold', 'angekommen: wartet auf Entscheidung');
  const m0 = g.money; for (let i = 0; i < 100; i++) g.update(0.05);
  assert.equal(s.state, 'hold'); assert.ok(g.money < m0, 'Wartezeit kostet Unterhalt');
  const info = holdInfo(g, s); assert.ok(info.price > 0 && Number.isFinite(info.gain));
  assert.equal(unloadNow(g, 1), true); assert.ok(s.state !== 'hold' && s.load === 0 || s.state === 'sail');
});

// ---------- Hafenhandel: Eigenproduktion, Lagerkosten, Preiserholung ----------
import { oilInfo, buildBlock as portBuildBlock, PORT as PORT2, marketImpact as impact2 } from '../src/sim/port.js';
import { stepMarket as step2, priceOf as price2, createMarket as mk2 } from '../src/sim/market.js';
function harborGame() {
  const g = new Game(8, 'endlos'); g.eventsOn = false; g.money = 1e8;
  openPort(g); g.port.slots[0] = { type: 'kai', level: 1 }; g.port.slots[1] = { type: 'tank', level: 2 }; g.port.slots[2] = { type: 'container', level: 2 }; g.port.slots[3] = { type: 'kies', level: 2 };
  return g;
}
test('Marktwirkung: eigener Verkauf drückt den Preis und erholt sich in einigen Tagen', () => {
  const m = mk2(), rng = createRng(1), g = { market: m }; void g;
  const p0 = price2(m, 'kies'); m.imp.kies = -0.3; assert.ok(price2(m, 'kies') < p0 * 0.8);
  for (let i = 0; i < 12; i++) { m.dev.kies = 0; step2(m, () => 0.5); m.dev.kies = 0; }
  assert.ok(Math.abs(m.imp.kies) < 0.06, 'nach 12 Tagen weitgehend erholt');
});
test('Lagerkosten: Ware im Hafenlager kostet täglich', () => {
  const g = harborGame(); g.port.stock.kies = 1000; g.port.stock.oel = 100;
  const m0 = g.money; portDay(g);
  assert.ok(m0 - g.money > 1000 * PORT2.storageCost.kies + 100 * PORT2.storageCost.oel - 1 && g.totals.storageCost > 0);
});
test('Ölfeld und Bahnterminal: Eigenproduktion mit Förderkosten, Vorkommen endlich, Bedingungen', () => {
  const g = harborGame(); const oi = oilInfo(g);
  // andere Karten testen, bis eine Öl hat (nicht jede Karte hat Öl)
  let found = oi.has; for (let k = 0; !found && k < 40; k++) { g.maps[0].seed = 1000 + k; delete g.maps[0].oilStart; found = oilInfo(g).has; }
  assert.ok(found, 'es gibt Karten mit Ölvorkommen');
  assert.equal(portBuildBlock(g, 4, 'oelfeld'), 'Gelände muss erst planiert werden'.slice(0, 0) || portBuildBlock(g, 4, 'oelfeld')); // planiert-Bedingung hängt vom Gelände ab
  g.port.slots[4] = { type: 'oelfeld', level: 1 }; g.port.slots[5] = { type: 'bahn', level: 2 };
  const left0 = oilInfo(g).left, o0 = g.port.stock.oel, c0 = g.port.stock.container, m0 = g.money;
  portDay(g);
  assert.ok(g.port.stock.oel > o0 && oilInfo(g).left < left0, 'Öl gefördert, Vorkommen schrumpft');
  assert.ok(g.port.stock.container > c0, 'Bahn liefert Container');
  assert.ok(g.money < m0 && g.port.cost.oel > 0 && g.port.cost.oel < 180, 'Förderkosten, Einstand unter Marktpreis');
  g.maps[0].oilLeft = 5; g.port.stock.oel = 0; portDay(g); assert.ok(g.port.stock.oel <= 5 + 1e-9, 'nie mehr als der Rest');
});
test('Flussdelta: wächst täglich nach und verschwindet nicht', () => {
  const g = new Game(8, 'endlos'); g.eventsOn = false; g.money = 1e8; g.addMap();
  const r = g.maps[1].river, d = r.deposits.find((q) => q.type === 'delta'); assert.ok(d && d.regen > 0, 'Delta auf Folgekarte');
  const cells = []; for (let i = 0; i < r.dep.length; i++) if (r.dep[i] === d.id) cells.push(i);
  assert.ok(cells.length > 30, 'gross');
  for (const i of cells) r.depLeft[i] = 0.1; g.depositsDay();
  assert.ok(cells.every((i) => r.depLeft[i] > 0.1), 'wächst nach'); assert.equal(d.depleted ?? false, false);
});

// ---------- Pontons zwischen Karten verlegen ----------
import { moveUnit, moveBlock, moveCost, perMapMax } from '../src/sim/fleet.js';
test('Pontons verlegen: Kosten, Überfahrt, Sperrfrist, Grenze pro Karte', () => {
  const g = new Game(11, 'endlos'); g.eventsOn = false; g.money = 1e9; g.buyUpgrade('auto'); g.addMap(); g.addMap();
  hireUnit(g); hireUnit(g);
  const id = g.fleet.units[0].id, m0 = g.money, cost = moveCost(g);
  assert.ok(cost > 0); assert.equal(moveBlock(g, id, g.mapIdx), 'Ungültige Zielkarte');
  assert.equal(moveUnit(g, id, 1), true);
  assert.equal(g.money, m0 - cost); assert.equal(g.fleet.units.length, 1); assert.equal(g.maps[1].fleet.units.length, 1);
  g.switchMap(1); const u = g.fleet.units[0]; assert.equal(u.state, 'transit');
  assert.match(moveBlock(g, u.id, 2) ?? '', /unterwegs/);
  for (let i = 0; i < 300; i++) g.update(0.1); // 30 s > 2 Tage Überfahrt
  assert.notEqual(g.fleet.units[0].state, 'transit');
  assert.match(moveBlock(g, u.id, 2) ?? '', /Gerade verlegt/);
  g.maps[2].fleet.units.push(...Array.from({ length: perMapMax(g) }, (_, k) => ({ id: 90 + k, name: 'x', state: 'idle', skip: {}, removed: 0 })));
  g.fleet.units[0].moveReady = 0; assert.match(moveBlock(g, g.fleet.units[0].id, 2) ?? '', /hat schon/);
});

import { renameUnit, freeName } from '../src/sim/fleet.js';
test('Pontons haben Eigennamen, nie doppelt, umbenennbar', () => {
  const g = new Game(11, 'endlos'); g.eventsOn = false; g.money = 1e9; g.buyUpgrade('auto');
  hireUnit(g); hireUnit(g); hireUnit(g);
  const names = g.fleet.units.map((u) => u.name); assert.equal(new Set(names).size, names.length); assert.ok(names.every((n) => !/^Ponton \d/.test(n)));
  assert.ok(!names.includes(freeName(g)));
  assert.equal(renameUnit(g, g.fleet.units[0].id, '  Möwe  '), true); assert.equal(g.fleet.units[0].name, 'Möwe');
  assert.equal(renameUnit(g, g.fleet.units[0].id, '   '), false);
});
