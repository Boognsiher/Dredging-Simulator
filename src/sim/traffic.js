import { reserveBerth, dockShip } from './port.js';
import { CONFIG, UPGRADES, SHIPS, CARGOS, DEBRIS, shipById, cargoById } from '../config.js';
import { priceOf, ratioOf } from './market.js';
import { minDepthAt, pointOnPath } from './fairway.js';
import { creditContracts } from './contracts.js';
import { fleetSites } from './fleet.js';

// Schiffsverkehr. Schiffe erscheinen an beiden Enden des Abschnitts (Fracht, Richtung und Klasse nach Marktnachfrage), warten vor der Einfahrt,
// bis für ihre Klasse eine Fahrrinne da ist (sonst drehen sie nach `patience` Sekunden ab: Fracht geht auf die Bahn), fahren die Rinne ab
// und zahlen beim Verlassen Gebühr + Anteil am Frachtwert. Reine Daten in g.traffic (speicherbar); Pfade sind abgeleitet und werden nicht gespeichert.
// Zustände: 'queue' (wartet), 'sail' (fährt), 'grounded' (aufgelaufen), 'done' / 'left' (fertig, wird entfernt).
// Neu: Es kommen nur Klassen, für die gerade eine Rinne frei ist (so schalten sich neue Klassen von selbst frei). Der Warteplatz an jedem Ende fasst
// anfangs ein Schiff (Rotlichter und Schlepper bauen ihn aus). In einer Einbahnrinne dürfen sich Schiffe nur an ausgewiesenen Kreuzungsstellen
// (g.zones, genug Platz für zwei Rinnen) begegnen: eines wartet dort, bis das andere in der Zone ist. Schlepper machen grosse Schiffe schneller.
export const createTraffic = () => ({ ships: [], seq: 0, spawnIn: 5 });

export const bayCapacity = (g) => CONFIG.traffic.bay + g.stats.signals + g.stats.tugs;
export const maxZones = (g) => CONFIG.zones.baseMax + g.stats.signals;

const rate = (g) => CONFIG.traffic.shipsPerDay * g.level.traffic * g.stats.trafficMult * (g.time < (g.strikeUntil ?? 0) ? 0.3 : 1);

function pickWeighted(items, weightOf, rng) {
  const w = items.map(weightOf);
  let r = rng() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

// Klassen, die gerade fahren können (nur diese schicken Reedereien Schiffe)
export const activeClasses = (g) => SHIPS.filter((s) => g.level.classes.includes(s.id) && (!g.fair || g.fair[s.id]?.passable));

export function spawnShip(g) {
  const T = g.traffic, C = CONFIG.traffic, rng = g.rng;
  const classes = activeClasses(g);
  if (!classes.length) return null;
  const demand = (s) => s.cargo.reduce((a, c) => a + Math.min(1.8, Math.max(0.5, ratioOf(g.market, c))), 0) / s.cargo.length;
  const cls = pickWeighted(classes, (s) => s.share * demand(s), rng);
  const cargo = cargoById(pickWeighted(cls.cargo, (c) => ratioOf(g.market, c) ** 2, rng));
  const dir = rng() < 0.5 ? 1 : -1;
  const load = g.fair?.[cls.id]?.loadFactor ?? 1; // Teilbeladung je nach Rinnentiefe
  const tons = Math.max(10, Math.round((cls.tons * rng.range(0.7, 1) * load) / 10) * 10);
  const ship = { id: ++T.seq, cls: cls.id, dir, cargo: cargo.id, tons, price: priceOf(g.market, cargo.id), load, state: 'queue', wait: 0, s: 0, ground: 0, lane: 'one', meets: [] };
  if (T.ships.filter((x) => x.state === 'queue' && x.dir === dir).length >= bayCapacity(g) || T.ships.length >= C.maxShips) { // Warteplatz voll: das Schiff dreht ab
    g.totals.turnedAway++; g.totals.lostValue += income(g, ship); g.today.rejected++;
    return null;
  }
  T.ships.push(ship);
  g.totals.spawned++;
  return ship;
}

function income(g, ship) {
  const cls = shipById(ship.cls), k = 1 + 0.15 * g.stats.pilot;
  return Math.round(((cls.fee * (ship.load ?? 1) + CONFIG.traffic.levy * ship.tons * ship.price) * k) / 10) * 10;
}

// Position eines fahrenden Schiffs auf seinem Pfad (Strecke s in Fahrtrichtung)
export function shipPos(ship) {
  if (!ship.path) return null;
  const sp = ship.dir > 0 ? ship.s : ship.path.length - ship.s, p = pointOnPath(ship.path, sp), y = p.y + (ship.lat ?? 0); // lat: seitlicher Versatz in der Kreuzungsstelle
  return ship.dir > 0 ? { ...p, y } : { ...p, y, angle: p.angle + Math.PI };
}

// Warteplatz vor der Einfahrt: die Schiffe reihen sich vor dem Ende der Rinne auf
export function queuePos(g, ship, rank) {
  const cls = shipById(ship.cls), f = g.fair?.[ship.cls];
  const pts = f?.path?.points, edge = ship.dir > 0 ? pts?.[0] : pts?.[pts.length - 1], y = edge?.y ?? g.river.rows / 2;
  const back = rank * (cls.len + 0.6);
  return ship.dir > 0 ? { x: -0.3 - back, y, angle: 0 } : { x: g.river.cols + 0.3 + back, y, angle: Math.PI };
}

// Kreuzungsstellen: eine Zone (Mitte x, Breite CONFIG.zones.width) gilt für ein Schiffspaar, wenn beide Klassen dort Platz für zwei Rinnen haben
export function zoneSupports(g, z, clsId) {
  const cross = g.fair?.[clsId]?.cross;
  if (!cross) return false;
  for (let x = z.x - 1; x <= z.x + 1; x++) if (x < 0 || x >= g.river.cols || !cross[x]) return false;
  return true;
}
export const zoneClasses = (g, z) => SHIPS.filter((s) => g.level.classes.includes(s.id) && zoneSupports(g, z, s.id));

// Fahrspur einer Klasse in der Kreuzungsstelle: erstes Fenster (beam Zeilen), das in allen drei Spalten tief genug ist.
// Schiffe talwärts (dir > 0) nehmen die obere, bergwärts die untere Spur. -1 = kein Platz
export function zoneLaneStart(g, z, clsId, dir) {
  const def = g.fair?.[clsId]?.def, beam = shipById(clsId).beam, r = g.river;
  if (!def) return -1;
  for (let k = 0; k <= r.rows - beam; k++) {
    const a = dir > 0 ? k : r.rows - beam - k;
    let ok = true;
    for (let x = z.x - 1; x <= z.x + 1 && ok; x++) { if (x < 0 || x >= r.cols) { ok = false; break; } for (let y = a; y < a + beam; y++) if (def[y * r.cols + x] !== 0) { ok = false; break; } }
    if (ok) return a;
  }
  return -1;
}
// Können sich zwei Schiffe (A talwärts, B bergwärts) hier kreuzen: beide Spuren frei, mit mindestens einer Zeile Abstand dazwischen?
export function pairFits(g, z, clsA, clsB) {
  const a = zoneLaneStart(g, z, clsA, 1), b = zoneLaneStart(g, z, clsB, -1);
  return a >= 0 && b >= 0 && b >= a + shipById(clsA).beam + 1;
}

// Strecke s (in Fahrtrichtung gemessen), bei der ein Schiff auf seinem Pfad die Karten-Spalte x erreicht
function sAtX(path, x, dir) {
  const pts = path.points;
  let sx = pts[pts.length - 1].s;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x >= x) { const a = pts[i - 1], b = pts[i], t = b.x > a.x ? (x - a.x) / (b.x - a.x) : 0; sx = a.s + t * (b.s - a.s); break; }
  }
  return dir > 0 ? sx : path.length - sx;
}

// Für ein einfahrendes Schiff und die Gegenverkehr-Schiffe in der Rinne je eine freie Kreuzungsstelle dazwischen suchen (sonst null = Einfahrt gesperrt)
function assignMeets(g, ship, opposing, ships) {
  const reserved = new Set(), used = new Set(), res = [], cls = shipById(ship.cls), entryX = ship.dir > 0 ? 0 : g.river.cols;
  for (const s of ships) for (const m of s.meets ?? []) reserved.add(m.zone);
  for (const o of opposing) {
    if (o.state !== 'sail') return null; // aufgelaufene Schiffe versperren die Rinne
    const xo = shipPos(o).x, oc = shipById(o.cls);
    let best = null, bs = Infinity;
    for (const z of g.zones) {
      if (reserved.has(z.id) || used.has(z.id) || !(ship.dir > 0 ? pairFits(g, z, ship.cls, o.cls) : pairFits(g, z, o.cls, ship.cls))) continue; // beide Spuren nebeneinander müssen Platz haben
      if (!(ship.dir > 0 ? z.x < xo - 1 : z.x > xo + 1)) continue; // die Stelle muss zwischen Einfahrt und Gegenverkehr liegen
      const score = Math.max(Math.abs(z.x - entryX) / cls.speed, Math.abs(xo - z.x) / oc.speed);
      if (score < bs) { bs = score; best = z; }
    }
    if (!best) return null;
    used.add(best.id); res.push({ zone: best.id, with: o.id });
  }
  return res;
}

const C0 = CONFIG;
// Schiff sinkt: Wrack als Untiefe in der Rinne (Hindernis für die Pumpe), Altlast ringsum, Umweltbusse
function sinkShip(g, ship, p) {
  const K = CONFIG.sinking, cls = shipById(ship.cls), hazard = ship.cargo === 'oel' || ship.cargo === 'chemie', r = g.river;
  const n = r.contaminate(p.x, p.y, hazard ? K.spillRadius : K.leakRadius, K.raise);
  const hx = Math.min(r.cols - 1, Math.max(0, Math.floor(p.x))), hy = Math.min(r.rows - 1, Math.max(0, Math.floor(p.y)));
  r.debris[r.idx(hx, hy)] = DEBRIS.length - 1; // Schiffswrack (die Bombe bleibt der letzte Eintrag)
  const fine = Math.round((cls.fee * 3 + (hazard ? K.fineHazard : K.fineBase)) / 100) * 100;
  g.money -= fine; g.totals.sunk++; g.totals.sunkFines += fine; g.today.costs += fine;
  const what = hazard ? (ship.cargo === 'oel' ? 'Öl' : 'Chemie') : 'Treibstoff';
  g.say(`${cls.name} gesunken bei Spalte ${hx + 1}! ${what} läuft aus: ${n} Zellen Altlast, Wrack in der Rinne, Umweltbusse −${fine} CHF`, 'bad');
  g.notify(`${cls.name} gesunken! Wrack und Altlast bei Spalte ${hx + 1} (−${fine.toLocaleString('de-CH')} CHF)`, 'bad');
  g.flash.push({ x: p.x, y: p.y, text: '☢', color: '#ff9d4a' });
}

export function updateTraffic(g, dt) {
  const T = g.traffic, C = CONFIG.traffic, ships = T.ships, vts = g.stats.vts;
  T.spawnIn -= dt;
  if (T.spawnIn <= 0) { spawnShip(g); T.spawnIn = (CONFIG.daySeconds / Math.max(0.05, rate(g))) * g.rng.range(0.5, 1.5); }

  const sites = [g.site, ...fleetSites(g)].filter(Boolean), near = {};
  for (const cls of SHIPS) { // liegt der Ponton in dieser Rinne?
    const pts = g.fair?.[cls.id]?.path?.points;
    near[cls.id] = !!(pts && sites.some((site) => pts.some((p) => Math.hypot(p.x - site.x, p.y - site.y) < C.siteRadius)));
    const pts2 = g.fair?.[cls.id]?.secondPath?.points; // Ponton in der zweiten Rinne?
    near[`${cls.id}:2`] = !!(pts2 && sites.some((site) => pts2.some((p) => Math.hypot(p.x - site.x, p.y - site.y) < C.siteRadius)));
  }
  const sailing = () => ships.filter((s) => s.state === 'sail' || s.state === 'grounded');
  const byId = new Map(ships.map((s) => [s.id, s]));

  for (const ship of ships) {
    if (ship.state !== 'sail' && ship.state !== 'grounded') continue;
    const cls = shipById(ship.cls);
    if (!ship.path) { // nach dem Laden: Pfad der Klasse wieder einsetzen
      ship.path = ship.alt ? g.fair?.[ship.cls]?.secondPath : g.fair?.[ship.cls]?.path;
      if (!ship.path) { ship.state = 'left'; continue; }
      ship.s = Math.min(ship.s, ship.path.length);
    }
    if (ship.state === 'grounded') {
      if (g.time - (ship.towT ?? -9) > 0.5) ship.ground -= dt; // solange du schleppst, läuft die Wartezeit nicht ab
      if (ship.ground <= 0) {
        const p = shipPos(ship), depth = minDepthAt(g.river, g.wl, p.x, p.y, cls.beam);
        if (depth >= cls.draught - C.groundMargin - 0.1 * vts) { ship.state = 'sail'; g.say(`${cls.name} ist wieder flott.`, 'info'); }
        else if (g.stats.tugs >= UPGRADES.tugs.maxLevel) { ship.state = 'sail'; ship.safeT = C.tugFreeMax; g.totals.freed = (g.totals.freed ?? 0) + 1; g.say(`Schlepper haben ${cls.name} freigeschleppt.`, 'good'); } // Schlepper auf Maximalstufe: das Schiff kommt auch aus dem Flachen frei, fährt weiter und sinkt nicht
        else if (g.rng() < (C0.sinking.risk[ship.cargo] ?? 0.2)) { sinkShip(g, ship, p); ship.state = 'left'; }
        else { ship.state = 'left'; g.totals.towed++; g.say(`${cls.name} wurde abgeschleppt (ohne Gebühr).`, 'bad'); }
      }
      continue;
    }
    let v = cls.speed * (ship.dir > 0 ? C.downFactor : C.upFactor) * (cls.draught >= 2.6 ? 1 + C.tugSpeed * g.stats.tugs : 1); // Schlepper beschleunigen grosse Schiffe
    if (ship.latZones?.length) { // seitlich auf die eigene Spur wechseln, solange die Kreuzungsstelle nah ist
      const raw = pointOnPath(ship.path, ship.dir > 0 ? ship.s : ship.path.length - ship.s); let target = 0;
      for (const id of ship.latZones) {
        const z = g.zones.find((zz) => zz.id === id); if (!z) continue;
        const ramp = Math.max(0, Math.min(1, 1 - (Math.abs(raw.x - z.x) - (z.w / 2 + 0.3)) / 2)), a = zoneLaneStart(g, z, ship.cls, ship.dir);
        if (ramp > 0 && a >= 0) target = ramp * (a + cls.beam / 2 - raw.y);
      }
      ship.lat = (ship.lat ?? 0) + (target - (ship.lat ?? 0)) * Math.min(1, dt * 4);
    }
    const p0 = shipPos(ship);
    if (sites.some((site) => Math.hypot(p0.x - site.x, p0.y - site.y) < C.siteRadius)) v *= C.siteSlow + (1 - C.siteSlow) * (g.stats.siteRelief ?? 0);
    let gapMin = Infinity;
    for (const o of ships) {
      if (o === ship || o.dir !== ship.dir || !!o.alt !== !!ship.alt || (o.state !== 'sail' && o.state !== 'grounded') || o.s <= ship.s) continue;
      const gap = o.s - ship.s - (shipById(o.cls).len + cls.len) / 2;
      if (gap < gapMin) gapMin = gap;
    }
    const safe = C.gap * (1 - 0.15 * vts);
    if (gapMin < safe) v = 0; else if (gapMin < safe + 1.5) v *= (gapMin - safe) / 1.5;
    if (ship.meets?.length) { // Begegnung an einer Kreuzungsstelle: wer zuerst da ist, wartet in der Zone, bis das andere Schiff eintrifft
      for (const m of ship.meets) {
        const z = g.zones.find((zz) => zz.id === m.zone), P = byId.get(m.with);
        if (!z || !P || (P.state !== 'sail' && P.state !== 'grounded')) { m.done = true; continue; }
        if (ship.dir > 0 ? p0.x > z.x + 0.2 : p0.x < z.x - 0.2) { m.done = true; continue; } // Zone durchfahren
        const pp = P.path ? shipPos(P) : null;
        if (!pp || Math.abs(pp.x - z.x) <= z.w / 2 + 0.5 || (P.dir > 0 ? pp.x > z.x : pp.x < z.x)) continue; // Gegner schon in oder hinter der Zone
        const room = sAtX(ship.path, z.x, ship.dir) - ship.s;
        v = Math.max(0, Math.min(v, (room - 0.05) / Math.max(dt, 1e-6)));
        if (room < 0.4) { m.holdT = (m.holdT ?? 0) + dt; if (m.holdT > C.holdTimeout) { m.done = true; g.say('Lotse drängelt: ein Schiff fährt ohne Begegnung weiter (Chaos)', 'bad'); } }
      }
      ship.meets = ship.meets.filter((m) => !m.done);
    }
    ship.s += v * dt;
    if (ship.berth && g.port?.bay?.cells?.length) { // Hafen erreicht: anlegen
      const bay = g.port.bay, bx = (bay.x0 + bay.x1 + 1) / 2, pn = shipPos(ship);
      if (pn && (ship.dir > 0 ? pn.x >= bx : pn.x <= bx)) { if (dockShip(g, ship)) continue; ship.berth = null; }
    }
    if (ship.s >= ship.path.length) {
      ship.state = 'done';
      const inc = income(g, ship);
      g.money += inc;
      const t = g.totals;
      t.ships++; t.tons += ship.tons; t.trafficIncome += inc; t.byCargo[ship.cargo] = (t.byCargo[ship.cargo] ?? 0) + ship.tons; t.byClass[ship.cls] = (t.byClass[ship.cls] ?? 0) + 1;
      g.today.ships++; g.today.tons += ship.tons; g.today.income += inc;
      creditContracts(g, ship.cargo, ship.tons);
      g.flash.push({ x: ship.dir > 0 ? g.river.cols : 0, y: p0.y, text: `+${inc.toLocaleString('de-CH')}`, color: '#7bd88f' });
      continue;
    }
    const p = shipPos(ship), depth = minDepthAt(g.river, g.wl, p.x, p.y, cls.beam);
    if (ship.safeT > 0) { // frisch freigeschleppt: geschützt vor erneutem Auflaufen, mindestens tugFreeSeconds lang, danach bis das Schiff die Untiefe hinter sich hat (höchstens tugFreeMax)
      ship.safeT -= dt;
      if (ship.safeT <= C.tugFreeMax - C.tugFreeSeconds && depth >= cls.draught - C.groundMargin - 0.1 * vts) ship.safeT = 0;
    }
    if (!(ship.safeT > 0) && p.x > 0 && p.x < g.river.cols && depth < cls.draught - C.groundMargin - 0.1 * vts) {
      const cost = Math.round((cls.fee * C.salvageFactor * (1 - 0.25 * vts)) / 10) * 10;
      ship.state = 'grounded'; ship.ground = C.groundSeconds; ship.salvage = cost;
      g.money -= cost; g.totals.groundings++; g.totals.salvage += cost; g.today.costs += cost;
      g.say(`Havarie: ${cls.name} auf Grund! Bergung −${cost} CHF`, 'bad');
      g.notify(`${g.maps.length > 1 ? `${g.map.name}: ` : ''}${cls.name} aufgelaufen bei Spalte ${Math.floor(p.x) + 1}! Bergung −${cost.toLocaleString('de-CH')} CHF`, 'bad', { goto: { map: g.mapIdx, ship: ship.id } });
      g.flash.push({ x: p.x, y: p.y, text: '⚠', color: '#ff7a6b' });
    }
  }

  // wartende Schiffe: das am längsten wartende zuerst
  const open = !g.closed;
  const queue = ships.filter((s) => s.state === 'queue').sort((a, b) => b.wait - a.wait);
  for (const ship of queue) {
    const cls = shipById(ship.cls), f = g.fair?.[ship.cls];
    if (open) ship.wait += dt * (f?.passable ? 1 : 6); // wartende Schiffe, für die die Rinne nicht mehr reicht, geben schnell auf und blockieren den Warteplatz nicht
    if (ship.wait > C.patience) {
      ship.state = 'left';
      g.totals.rejected++; g.totals.lostValue += income(g, ship); g.today.rejected++;
      g.rejectedBy[ship.cls] = (g.rejectedBy[ship.cls] ?? 0) + 1;
      continue;
    }
    if (!open || !f?.passable || !f.path) continue;
    // zwei getrennte Rinnen: Richtung > 0 fährt standardmässig die Hauptrinne, Richtung < 0 die zweite; ist die eigene Spur an der Einfahrt belegt,
    // weicht das Schiff auf die andere Spur aus, solange dort kein Gegenverkehr fährt (so fahren bei einseitigem Andrang beide Rinnen)
    const lane = f.twoWay && !near[ship.cls] && !near[`${ship.cls}:2`] && f.secondPath ? 'two' : 'one';
    let ok = true, meets = [], alt = false;
    const sl = sailing();
    const blockedAt = (a) => sl.some((o) => o.dir === ship.dir && !!o.alt === a && o.s < C.enterGap + (shipById(o.cls).len + cls.len) / 2);
    if (lane === 'two') {
      const own = ship.dir < 0, headOn = (a) => sl.some((o) => o.dir !== ship.dir && !!o.alt === a);
      if (!headOn(own) && !blockedAt(own)) alt = own;
      else if (!headOn(!own) && !blockedAt(!own)) alt = !own;
      else ok = false;
    } else for (const o of sl) if (o.dir === ship.dir && o.s < C.enterGap + (shipById(o.cls).len + cls.len) / 2) { ok = false; break; }
    if (ok && lane === 'one') { // Einbahnrinne: Gegenverkehr nur mit freier Kreuzungsstelle dazwischen
      const opposing = sl.filter((o) => o.dir !== ship.dir && o.lane === 'one');
      if (opposing.length) { const a = assignMeets(g, ship, opposing, ships); if (a) meets = a; else ok = false; }
    }
    if (ok && lane === 'one' && sl.some((o) => o.dir === ship.dir && o.lane === 'one')) { // Gegenseite wartet schon lange: keine neuen Schiffe mehr nachschieben
      const oppWait = Math.max(0, ...queue.filter((o) => o.dir !== ship.dir && o.wait > 0 && g.fair?.[o.cls]?.passable).map((o) => o.wait));
      if (oppWait > C.switchAfter && oppWait > ship.wait) ok = false;
    }
    if (!ok) continue;
    ship.meets = meets; ship.latZones = meets.map((m) => m.zone);
    for (const m of meets) { const o = byId.get(m.with); o?.meets?.push({ zone: m.zone, with: ship.id }); if (o) (o.latZones ??= []).push(m.zone); }
    ship.state = 'sail'; ship.s = 0; ship.lane = lane; ship.alt = lane === 'two' && alt; ship.path = ship.alt ? f.secondPath : f.path;
    ship.berth = reserveBerth(g, ship)?.id ?? null; // Liegeplatz im Hafen reservieren, falls einer frei ist
  }
  T.ships = ships.filter((s) => s.state !== 'done' && s.state !== 'left');
}

// Wie viele Schiffe warten gerade (je Klasse)?
export function waitingByClass(g) {
  const out = {};
  for (const s of g.traffic.ships) if (s.state === 'queue') out[s.cls] = (out[s.cls] ?? 0) + 1;
  return out;
}

export { CARGOS };
