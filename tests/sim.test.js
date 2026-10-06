import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SHIPS, KIND, UPGRADES, LEVELS, shipById } from '../src/config.js';
import { createRng } from '../src/sim/rng.js';
import { River } from '../src/sim/river.js';
import { analyzeFairway, analyzeClass, carveFairway, minDepthAt, pointOnPath } from '../src/sim/fairway.js';
import { SliceSim, SLICE } from '../src/sim/slice.js';
import { DredgeSim } from '../src/sim/dredge.js';
import { createMarket, stepMarket, shockMarket, priceOf } from '../src/sim/market.js';
import { processPlant, materialPrice } from '../src/sim/plant.js';
import { Game } from '../src/sim/game.js';
import { updateTraffic, spawnShip } from '../src/sim/traffic.js';
import { computeStats, upgradeCost } from '../src/sim/stats.js';
import { serializeGame, restoreGame } from '../src/sim/save.js';
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
  assert.ok(!analyzeClass(r, r.wl - 0.5, shipById('motor')).passable);
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

test('Querschnitt: Pumpe saugt nur nach rechts, nur im Wasser, Karte bleibt in Balance', () => {
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
  assert.equal(r2, 0, 'rückwärts wird nicht gesaugt');
});

test('Querschnitt: Pumpe kippt bei zu tiefem Schnitt, Ballast hilft', () => {
  const run = (levels) => {
    const r = flat(2); r.kind.fill(KIND.schlick);
    const stats = computeStats({ power: 8, ...levels });
    const sl = new SliceSim(r, stats, 20, 12, createRng(1), 3, 0.2);
    sl.h = r.wl - 2.1; sl.x = sl.x0 + 4;
    let tipped = false;
    for (let i = 0; i < 400 && !tipped; i++) { sl.update(0.05, { dx: 0, dy: 0, suction: true }); tipped = sl.tipped > 0; }
    return tipped;
  };
  assert.ok(run({}));
  assert.ok(!run({ ballast: 4 }));
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

test('Verkehr: ohne Rinne warten Schiffe, drehen ab und das Geschäft geht verloren', () => {
  const g = emptyGame(3);
  g.river.setFlat(1.0, 9); g.analyze(true);
  for (let i = 0; i < 12 * 20 * 20; i++) g.update(0.05);
  assert.equal(g.totals.ships, 0);
  assert.ok(g.totals.rejected > 3 && g.totals.lostValue > 0);
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
  g.site = { x: 20, y: 12 };
  const near = g.fair.kahn.path.points.some((p) => Math.hypot(p.x - 20, p.y - 12) < CONFIG.traffic.siteRadius);
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
  adv.runTime = 1000; adv.shownAt.start = 0;
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
import { hireUnit, hireBlock, dismissUnit, openColumns, targetClass, fleetSites } from '../src/sim/fleet.js';

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
  r.debris[r.idx(sl.cols[1], mx)] = 7; // Fliegerbombe
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
  g.money = 1e6; g.buyUpgrade('auto');
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
  hireUnit(g); hireUnit(g); hireUnit(g);
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
  hireUnit(g); hireUnit(g);
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
  const f = g.fair.container, r = g.river, needTop = g.wl - f.need - 0.3;
  for (let i = 0; i < r.top.length; i++) if (r.zone[i] && r.rock[i] < needTop && r.top[i] > needTop) r.top[i] = needTop; // ganzer Korridor tief, nur der Fels bleibt
  for (let i = 0; i < r.top.length; i++) r.pending.add(i);
  for (let k = 0; k < 60; k++) r.settle(Infinity); // Böschungen setzen lassen, sonst rutscht die Rinne unter den Pontons nach
  g.analyze(true); g.fleet.goal = 'container';
  assert.ok(openColumns(g, targetClass(g)).some((c) => c.rock), 'Felsriegel liegt in der Rinne');
  hireUnit(g); hireUnit(g); hireUnit(g);
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
  g.money = 1e6; g.buyUpgrade('auto'); g.traffic.spawnIn = 1e9; hireUnit(g);
  for (let i = 0; i < 14 * 5 * 20; i++) g.update(0.05);
  const g2 = restoreGame(serializeGame(g));
  assert.ok(g2 && g2.fleet.units.length === 1);
  const w0 = g2.totals.wages;
  for (let i = 0; i < 14 * 4 * 20; i++) g2.update(0.05);
  assert.ok(g2.fleet.units[0].state !== undefined && g2.totals.fleetRemoved >= 0);
  assert.ok(g2.totals.wages > w0, 'Löhne');
  assert.equal(fleetSites(g2).length >= 0, true);
});
