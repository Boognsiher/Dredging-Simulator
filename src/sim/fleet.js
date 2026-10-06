import { CONFIG, SHIPS, shipById } from '../config.js';

// Flotte: gemietete Pontons arbeiten selbstständig. Jeder fährt zur nächsten Engstelle der Ausbauklasse, ankert, lässt die Automatik
// mit dem passenden Gerät (Saugkopf, bei Fels der Löffel) auf die Solltiefe baggern und sucht danach die nächste offene Stelle.
// Sie nutzen dieselbe Physik wie dein eigener Ponton (DredgeSim/SliceSim), nur ohne Anzeige. Das Ausbauziel ist eine Schiffsklasse
// (Standard: die kleinste Klasse, die noch nicht fährt). Pontons ohne Arbeit warten und melden, was fehlt.
// Zustände: 'idle' (sucht Arbeit), 'travel' (fährt zur Stelle), 'work' (baggert). Die Simulation (u.sim) ist abgeleitet und wird nicht gespeichert.
export const createFleet = () => ({ units: [], seq: 0, goal: null, widen: false, widenW: CONFIG.fleet.widenRows });

export const nextHireCost = (g) => CONFIG.fleet.costs[g.fleet.units.length] ?? null;

// Warum lässt sich gerade kein Ponton mieten? null = geht
export function hireBlock(g) {
  if (g.status !== 'playing') return 'Spiel beendet';
  if (g.fleet.units.length >= CONFIG.fleet.max) return 'Flotte ist voll';
  if (g.stats.autoLevel < 1) return 'Braucht die Automatik (Ausrüstung)';
  const cost = nextHireCost(g);
  if (g.money < cost) return `Braucht ${cost.toLocaleString('de-CH')} CHF`;
  return null;
}

export function hireUnit(g) {
  if (hireBlock(g)) return null;
  const cost = nextHireCost(g), F = g.fleet;
  g.money -= cost;
  const u = { id: ++F.seq, name: `Ponton ${F.units.length + 2}`, x: 1.5, y: g.river.centerY(1), state: 'idle', site: null, idle: 0, note: 'startet', skip: {}, removed: 0 };
  F.units.push(u);
  g.say(`${u.name} gemietet (−${cost.toLocaleString('de-CH')} CHF): arbeitet selbstständig.`, 'upgrade');
  return u;
}

export function dismissUnit(g, id) {
  const F = g.fleet, i = F.units.findIndex((u) => u.id === id);
  if (i < 0) return false;
  F.units[i].sim?.leave();
  F.units.splice(i, 1);
  return true;
}

export function setWiden(g, on, w) { g.fleet.widen = !!on; if (w) g.fleet.widenW = Math.max(1, Math.min(5, Math.round(w))); }
export function setGoal(g, clsId) { g.fleet.goal = SHIPS.some((s) => s.id === clsId) ? clsId : null; }

// Ausbauklasse: gewählt oder die kleinste, die noch nicht fährt (und endlich ist)
export function targetClass(g) {
  if (g.fleet.goal && g.level.classes.includes(g.fleet.goal)) return shipById(g.fleet.goal);
  return SHIPS.filter((s) => g.level.classes.includes(s.id)).find((s) => g.fair?.[s.id] && !g.fair[s.id].passable && g.fair[s.id].volume < Infinity) ?? null;
}

const canRock = (g) => g.stats.loeffel > 0 || g.stats.rockFirmness >= CONFIG.fleet.rockFirmnessMin;

// Spalten der Rinne der Klasse, in denen noch Sohle über der nötigen Tiefe liegt (aufsteigend); rock = Fels im Weg
export function openColumns(g, cls) {
  const f = g.fair?.[cls.id];
  if (!f?.nodes) return [];
  const r = g.river, needTop = g.wl - f.need + 0.06, lo = Math.floor((cls.beam - 1) / 2), hi = cls.beam - 1 - lo, cols = new Map();
  for (const p of f.nodes) {
    for (let k = p.y - lo; k <= p.y + hi; k++) {
      const i = k * r.cols + p.x;
      if (!r.zone[i] || r.top[i] <= needTop) continue;
      const c = cols.get(p.x) ?? { x: p.x, rock: false, armor: false, y: p.y + (hi - lo) / 2 + 0.5 };
      if (r.rock[i] > needTop) c.rock = true;
      if (r.armor[i] > 0) c.armor = true; // Beton muss aufgebrochen werden
      cols.set(p.x, c);
    }
  }
  return [...cols.values()].sort((a, b) => a.x - b.x);
}

const reservedBy = (g, me) => g.fleet.units.filter((u) => u !== me && u.site && (u.state === 'travel' || u.state === 'work')).map((u) => u.site);
const overlaps = (res, c0) => res.some((s) => c0 < s.c0 + CONFIG.box.cols && s.c0 < c0 + CONFIG.box.cols);
const skipKey = (s) => (s.land ? `L${s.col}${s.side}` : s.col);

// Land-Automatik: Spalten, in denen im Ausbaustreifen neben dem ursprünglichen Korridor noch Land über der Tiefe der Ausbauklasse liegt.
// Pro Spalte und Ufer die ersten `widenW` Zeilen des Streifens (ext > 0); ursprünglicher Korridor = zone && !ext (umgewandeltes Land zählt nicht dazu).
export function openWidenColumns(g) {
  const base = targetClass(g) ?? [...SHIPS.filter((s) => g.level.classes.includes(s.id) && g.fair?.[s.id]?.passable)].pop();
  if (!base) return [];
  const f = g.fair[base.id], r = g.river, needTop = g.wl - (f?.need ?? base.draught + CONFIG.clearance) + 0.06, W = g.fleet.widenW, out = [];
  for (let x = 0; x < r.cols; x++) {
    for (const side of [-1, 1]) {
      let edge = null;
      for (let k = 0; k < r.rows; k++) { const y = side < 0 ? k : r.rows - 1 - k, i = y * r.cols + x; if (r.zone[i] && !r.ext[i]) { edge = y; break; } }
      if (edge === null) continue;
      const rows = [];
      for (let k = 1; k <= W; k++) { const y = edge + side * k; if (y < 0 || y >= r.rows || !r.ext[y * r.cols + x]) break; rows.push(y); }
      let open = false, rock = false, armor = false;
      for (const y of rows) { const i = y * r.cols + x; if (r.top[i] > needTop) { open = true; if (r.rock[i] > needTop) rock = true; if (r.armor[i] > 0) armor = true; } }
      if (open) out.push({ x, side, edge, rows, rock, armor, depth: Math.min(CONFIG.echolot.maxDepth, (f?.need ?? base.draught + CONFIG.clearance) + CONFIG.fleet.margin) });
    }
  }
  return out;
}

function pickLane(g, u) {
  const cls = targetClass(g);
  if (!cls) return { none: 'Keine Engstelle: alle Klassen fahren' };
  const open = openColumns(g, cls), res = reservedBy(g, u), B = CONFIG.box.cols;
  if (!open.length) return { none: `${cls.name}: Rinne ist frei` };
  let rockSkipped = 0, armorSkipped = 0;
  for (const c of open) {
    if (u.skip[c.x] && g.time < u.skip[c.x]) continue;
    if (c.armor && g.stats.loeffel <= 0) { armorSkipped++; continue; }
    if (c.rock && !canRock(g)) { rockSkipped++; continue; }
    const c0 = Math.min(Math.max(0, c.x), g.river.cols - B);
    if (overlaps(res, c0)) continue;
    const f = g.fair[cls.id];
    return { c0, col: c.x, y: c.y, cls: cls.id, depth: Math.min(CONFIG.echolot.maxDepth, f.need + CONFIG.fleet.margin), tool: (c.rock || c.armor) && g.stats.loeffel > 0 ? 'loeffel' : 'pump', rock: c.rock || c.armor };
  }
  return { none: armorSkipped ? 'Beton im Weg: braucht den Löffelbagger' : rockSkipped ? 'Fels im Weg: braucht Felsfräse oder Löffelbagger' : 'Alle offenen Stellen sind vergeben' };
}

function pickLand(g, u) {
  if (!g.fleet.widen) return { none: 'Ufer verbreitern ist aus' };
  if (g.stats.loeffel <= 0) return { none: 'Ufer verbreitern braucht den Löffelbagger' };
  const open = openWidenColumns(g), res = reservedBy(g, u), B = CONFIG.box.cols, r = g.river;
  if (!open.length) return { none: 'Ufer ist verbreitert (Ausbaustreifen fertig)' };
  for (const c of open) {
    const key = `L${c.x}${c.side}`;
    if (u.skip[key] && g.time < u.skip[key]) continue;
    const c0 = Math.min(Math.max(0, c.x), r.cols - B), px = c0 + Math.floor(B / 2);
    if (overlaps(res, c0)) continue;
    // Ponton neben dem Streifen im Wasser (Korridorrand), dort wo er schwimmt
    const cands = [c.edge - c.side * 1.5, c.edge - c.side * 0.5, c.edge - c.side * 2.5, r.centerY(px)];
    const y = cands.find((yy) => yy > 0 && yy < r.rows && r.depthAt(r.idx(px, Math.floor(yy))) >= 0.8);
    if (y === undefined) continue;
    return { land: true, c0, col: c.x, side: c.side, rows: c.rows, y, cls: g.level.classes[0], depth: c.depth, tool: 'loeffel', rock: c.rock || c.armor };
  }
  return { none: 'Alle Uferstellen sind vergeben' };
}

function pickSite(g, u) {
  const units = g.fleet.units, landRole = g.fleet.widen && g.stats.loeffel > 0 && units.indexOf(u) === units.length - 1;
  const order = landRole ? [pickLand, pickLane] : [pickLane, pickLand];
  let first = null;
  for (const f of order) { const s = f(g, u); if (!s.none) return s; first ??= s; }
  return first;
}

function makeSim(g, u) {
  const sim = g.createSession();
  sim.x = u.x; sim.y = u.y; sim.tool = 'pump';
  u.state = 'idle'; u.site = null; u.idle = 0;
  return sim;
}

function stepUnit(g, u, dt) {
  const sim = (u.sim ??= makeSim(g, u));
  sim.setStats(g.stats); sim.bufferRoom = g.bufferRoom;
  let inp = { dx: 0, dy: 0, suction: false };
  if (u.state === 'idle') {
    u.idle -= dt;
    if (u.idle <= 0) {
      const s = pickSite(g, u);
      if (s.none) { u.idle = CONFIG.fleet.idleRetry; u.note = s.none; }
      else { u.site = s; u.state = 'travel'; u.travelT = 0; u.note = `fährt zu Spalte ${s.col + 1}`; }
    }
  } else if (u.state === 'travel') {
    const s = u.site, route = g.fair?.[g.level.classes[0]];
    if (!route?.nodes || sim.mode !== 'map') { u.state = 'idle'; u.idle = 0; }
    else {
      u.travelT = (u.travelT ?? 0) + dt;
      const B = CONFIG.box.cols, goal = { x: s.c0 + Math.floor(B / 2), y: s.y };
      // entlang der Rinne der kleinsten Klasse fahren (immer Wasser), zuletzt geradeaus zum Ziel
      let near = route.nodes[0], nd = Infinity, ni = 0;
      route.nodes.forEach((n, i) => { const d = Math.hypot(n.x + 0.5 - sim.x, n.y + 0.5 - sim.y); if (d < nd) { nd = d; near = n; ni = i; } });
      const gi = route.nodes.findIndex((n) => n.x >= Math.floor(goal.x));
      let aim = goal;
      if (nd > 1.2) aim = { x: near.x + 0.5, y: near.y + 0.5 }; // erst zur Rinne
      else if (Math.abs(gi - ni) > 2) { const n = route.nodes[ni + Math.sign(gi - ni)]; aim = { x: n.x + 0.5, y: n.y + 0.5 }; }
      const dx = aim.x - sim.x, dy = aim.y - sim.y, dist = Math.hypot(dx, dy);
      if (Math.hypot(goal.x - sim.x, goal.y - sim.y) < 0.5 || u.travelT > 90) { // angekommen (oder zu lange unterwegs): ankern, Automatik an
        u.travelT = 0;
        if (!sim.canFloat(goal.x, goal.y)) { u.skip[skipKey(s)] = g.time + 60; u.state = 'idle'; u.idle = CONFIG.fleet.idleRetry; u.note = 'kein Platz zum Ankern'; }
        else {
          sim.x = goal.x; sim.y = goal.y; // ganzzahlig: der Kasten beginnt dann genau bei c0
          sim.targetDepth = s.depth; sim.pumpSpeed = 1;
          sim.tool = s.tool === 'loeffel' && g.stats.loeffel > 0 ? 'loeffel' : 'pump';
          if (sim.anchor()) {
            const sl = sim.slice;
            sl.soundNoise = CONFIG.fleet.soundNoise; sl.sound();
            if (s.land) { sl.autoLand = true; sl.autoRange = [Math.min(...s.rows) - 1, Math.max(...s.rows) + 1]; } // nur der Uferstreifen
            else {
              const lane = g.fair[s.cls], cls = shipById(s.cls), lo = Math.floor((cls.beam - 1) / 2), hi = cls.beam - 1 - lo;
              let r0 = Infinity, r1 = -Infinity;
              for (const n of lane.nodes) if (n.x >= s.c0 - 1 && n.x <= s.c0 + B) { r0 = Math.min(r0, n.y - lo); r1 = Math.max(r1, n.y + hi); }
              if (r0 <= r1) sl.autoRange = [r0 - 1, r1 + 1]; // nur die Rinne (mit einer Zelle Böschung) ausheben
            }
            sl.x = Math.max(sl.bounds().min, (sl.autoRange?.[0] ?? 0) + 0.01); sl.h = Math.min(sl.maxH(), sl.surfaceAt(sl.x) + 1.5);
            sim.toggleAuto();
            u.state = 'work'; u.workT = 0; u.note = s.land ? `baut Ufer ab bei Spalte ${s.col + 1} (Löffel)` : `baggert bei Spalte ${s.col + 1} (${s.tool === 'loeffel' ? 'Löffel' : 'Saugkopf'})`;
          } else { u.skip[skipKey(s)] = g.time + 40; u.state = 'idle'; u.idle = CONFIG.fleet.idleRetry; u.note = 'kein Platz zum Ankern'; }
        }
      } else if (dist > 1e-6) {
        const k = CONFIG.fleet.speedMult; inp = { dx: (dx / dist) * k, dy: (dy / dist) * k, suction: false };
      }
    }
  } else if (u.state === 'work') {
    u.workT += dt;
    if (sim.mode === 'slice' && !sim.pumpOn && sim.slice.auto.on && sim.slice.tipped <= 0) { sim.pumpOn = true; sim.autoStartedPump = true; } // nach dem Kippen schaltet die Mannschaft die Pumpe wieder ein
    const limit = u.site?.land ? 420 : 140; // Landabtrag ist viel Material
    if (sim.mode !== 'slice' || !sim.slice.auto.on || u.workT > limit) {
      if (u.workT > limit && u.site) u.skip[skipKey(u.site)] = g.time + 90; // hängt fest (z. B. Fels): später wieder versuchen
      sim.leave(); u.state = 'idle'; u.idle = 0; u.note = 'sucht nächste Stelle';
    }
  }
  const d = sim.update(dt, inp);
  sim.notes.length = 0;
  g.collect(d);
  g.totals.fleetRemoved += d.removed; u.removed += d.removed;
  u.x = sim.x; u.y = sim.y;
}

export function updateFleet(g, dt) {
  for (const u of g.fleet.units) stepUnit(g, u, dt);
}

// Positionen verankerter Flottenpontons (bremsen den Verkehr in der Rinne wie dein eigener Ponton)
export function fleetSites(g) {
  return g.fleet.units.filter((u) => u.sim?.mode === 'slice').map((u) => ({ x: u.sim.x, y: u.sim.y }));
}
