import { CONFIG, SHIPS, shipById } from '../config.js';

// Flotte: gemietete Pontons arbeiten selbstständig. Jeder fährt zur nächsten Engstelle der Ausbauklasse, ankert, lässt die Automatik
// mit dem passenden Gerät (Saugkopf, bei Fels der Löffel) auf die Solltiefe baggern und sucht danach die nächste offene Stelle.
// Sie nutzen dieselbe Physik wie dein eigener Ponton (DredgeSim/SliceSim), nur ohne Anzeige. Das Ausbauziel ist eine Schiffsklasse
// (Standard: die kleinste Klasse, die noch nicht fährt). Pontons ohne Arbeit warten und melden, was fehlt.
// Zustände: 'idle' (sucht Arbeit), 'travel' (fährt zur Stelle), 'work' (baggert). Die Simulation (u.sim) ist abgeleitet und wird nicht gespeichert.
export const createFleet = () => ({ units: [], seq: 0, goal: null });

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
      const c = cols.get(p.x) ?? { x: p.x, rock: false, y: p.y + (hi - lo) / 2 + 0.5 };
      if (r.rock[i] > needTop) c.rock = true;
      cols.set(p.x, c);
    }
  }
  return [...cols.values()].sort((a, b) => a.x - b.x);
}

const reservedBy = (g, me) => g.fleet.units.filter((u) => u !== me && u.site && (u.state === 'travel' || u.state === 'work')).map((u) => u.site);

function pickSite(g, u) {
  const cls = targetClass(g);
  if (!cls) return { none: 'Keine Engstelle: alle Klassen fahren' };
  const open = openColumns(g, cls), res = reservedBy(g, u), B = CONFIG.box.cols;
  if (!open.length) return { none: `${cls.name}: Rinne ist frei` };
  let rockSkipped = 0;
  for (const c of open) {
    if (u.skip[c.x] && g.time < u.skip[c.x]) continue;
    if (c.rock && !canRock(g)) { rockSkipped++; continue; }
    const c0 = Math.min(Math.max(0, c.x), g.river.cols - B);
    if (res.some((s) => c0 < s.c0 + B && s.c0 < c0 + B)) continue;
    const f = g.fair[cls.id];
    return { c0, col: c.x, y: c.y, cls: cls.id, depth: Math.min(CONFIG.echolot.maxDepth, f.need + CONFIG.fleet.margin), tool: c.rock && g.stats.loeffel > 0 ? 'loeffel' : 'pump', rock: c.rock };
  }
  return { none: rockSkipped ? 'Fels im Weg: braucht Felsfräse oder Löffelbagger' : 'Alle offenen Stellen sind vergeben' };
}

function makeSim(g, u) {
  const sim = g.createSession();
  sim.x = u.x; sim.y = u.y; sim.tool = 'pump';
  u.state = 'idle'; u.site = null; u.idle = 0;
  return sim;
}

// Mittelpunkt der Rinnenzelle in der Spalte x (Kartenkoordinaten), nächste vorhandene Spalte
function laneAt(g, clsId, x) {
  const f = g.fair?.[clsId], cls = shipById(clsId);
  if (!f?.nodes) return null;
  const lo = Math.floor((cls.beam - 1) / 2), hi = cls.beam - 1 - lo, off = (hi - lo) / 2 + 0.5;
  let best = f.nodes[0];
  for (const n of f.nodes) if (Math.abs(n.x - x) < Math.abs(best.x - x)) best = n;
  return { x: best.x + 0.5, y: best.y + off, nx: best.x };
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
      else { u.site = s; u.state = 'travel'; u.note = `fährt zu Spalte ${s.col + 1}`; }
    }
  } else if (u.state === 'travel') {
    const s = u.site, f = g.fair?.[s.cls];
    if (!f?.nodes || sim.mode !== 'map') { u.state = 'idle'; u.idle = 0; }
    else {
      const targetX = Math.min(g.river.cols - 1, s.c0 + Math.floor(CONFIG.box.cols / 2)), goal = laneAt(g, s.cls, targetX);
      // entlang der Rinne fahren: nächster Knoten Richtung Ziel (Land und Flachwasser halten den Ponton auf)
      let near = f.nodes[0], nd = Infinity, ni = 0;
      f.nodes.forEach((n, i) => { const d = Math.hypot(n.x + 0.5 - sim.x, n.y + 0.5 - sim.y); if (d < nd) { nd = d; near = n; ni = i; } });
      let aim;
      if (nd > 1.2) aim = { x: near.x + 0.5, y: near.y + 0.5 }; // erst zur Rinne
      else {
        const gi = f.nodes.findIndex((n) => n.x === goal.nx), step = Math.sign(gi - ni);
        aim = step === 0 ? goal : laneAt(g, s.cls, f.nodes[Math.min(f.nodes.length - 1, Math.max(0, ni + step))].x);
      }
      const dx = aim.x - sim.x, dy = aim.y - sim.y, dist = Math.hypot(dx, dy);
      if (Math.hypot(goal.x - sim.x, goal.y - sim.y) < 0.5) { // angekommen: ankern, Automatik an
        sim.x = s.c0 + Math.floor(CONFIG.box.cols / 2); sim.y = goal.y; // ganzzahlig: der Kasten beginnt dann genau bei c0
        sim.targetDepth = s.depth; sim.pumpSpeed = 1;
        sim.tool = s.tool === 'loeffel' && g.stats.loeffel > 0 ? 'loeffel' : 'pump';
        if (sim.anchor()) {
          const sl = sim.slice;
          sl.soundNoise = CONFIG.fleet.soundNoise; sl.sound();
          const lane = g.fair[s.cls], cls = shipById(s.cls), lo = Math.floor((cls.beam - 1) / 2), hi = cls.beam - 1 - lo, B = CONFIG.box.cols;
          let r0 = Infinity, r1 = -Infinity;
          for (const n of lane.nodes) if (n.x >= s.c0 - 1 && n.x <= s.c0 + B) { r0 = Math.min(r0, n.y - lo); r1 = Math.max(r1, n.y + hi); }
          if (r0 <= r1) sl.autoRange = [r0 - 1, r1 + 1]; // nur die Rinne (mit einer Zelle Böschung) ausheben
          sl.x = sl.bounds().min; sl.h = Math.min(sl.maxH(), sl.surfaceAt(sl.x) + 1.5);
          sim.toggleAuto();
          u.state = 'work'; u.workT = 0; u.note = `baggert bei Spalte ${s.col + 1} (${s.tool === 'loeffel' ? 'Löffel' : 'Saugkopf'})`;
        } else { u.skip[s.col] = g.time + 40; u.state = 'idle'; u.idle = CONFIG.fleet.idleRetry; u.note = 'kein Platz zum Ankern'; }
      } else if (dist > 1e-6) {
        const k = CONFIG.fleet.speedMult; inp = { dx: (dx / dist) * k, dy: (dy / dist) * k, suction: false };
      }
    }
  } else if (u.state === 'work') {
    u.workT += dt;
    if (sim.mode === 'slice' && !sim.pumpOn && sim.slice.auto.on && sim.slice.tipped <= 0) { sim.pumpOn = true; sim.autoStartedPump = true; } // nach dem Kippen schaltet die Mannschaft die Pumpe wieder ein
    if (sim.mode !== 'slice' || !sim.slice.auto.on || u.workT > 140) {
      if (u.workT > 140 && u.site) u.skip[u.site.col] = g.time + 90; // hängt fest (z. B. Fels): später wieder versuchen
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
