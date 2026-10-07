import { CONFIG, SHIPS, KIND, shipById } from '../config.js';
import { toolAvailable } from './slice.js';
import { zoneSupports } from './traffic.js';

// Flotte: gemietete Pontons arbeiten selbstständig. Jeder fährt zur nächsten Engstelle der Ausbauklasse, ankert, lässt die Automatik
// mit dem passenden Gerät (Saugkopf, bei Fels der Löffel) auf die Solltiefe baggern und sucht danach die nächste offene Stelle.
// Sie nutzen dieselbe Physik wie dein eigener Ponton (DredgeSim/SliceSim), nur ohne Anzeige. Das Ausbauziel ist eine Schiffsklasse
// (Standard: die kleinste Klasse, die noch nicht fährt). Pontons ohne Arbeit warten und melden, was fehlt.
// Zustände: 'idle' (sucht Arbeit), 'travel' (fährt zur Stelle), 'work' (baggert). Die Simulation (u.sim) ist abgeleitet und wird nicht gespeichert.
export const createFleet = () => ({ units: [], seq: 0, goal: null, mine: true, pour: false, widen: false, widenW: CONFIG.fleet.widenRows, areas: [], areaSeq: 0, noNature: false, noAltlast: false });

const hiredCount = (g) => g.fleet.units.filter((u) => !u.self).length; // dein eigener Ponton (self) zählt nicht zu den gemieteten
export const nextHireCost = (g) => CONFIG.fleet.costs[hiredCount(g)] ?? null;

// Warum lässt sich gerade kein Ponton mieten? null = geht
export function hireBlock(g) {
  if (g.status !== 'playing') return 'Spiel beendet';
  if (hiredCount(g) >= CONFIG.fleet.max) return 'Flotte ist voll';
  if (g.stats.autoLevel < 1) return 'Braucht die Automatik (Ausrüstung)';
  const cost = nextHireCost(g);
  if (g.money < cost) return `Braucht ${cost.toLocaleString('de-CH')} CHF`;
  return null;
}

export function hireUnit(g) {
  if (hireBlock(g)) return null;
  const cost = nextHireCost(g), F = g.fleet;
  g.money -= cost;
  const u = { id: ++F.seq, name: `Ponton ${hiredCount(g) + 2}`, x: 1.5, y: g.river.centerY(1), state: 'idle', site: null, idle: 0, note: 'startet', skip: {}, removed: 0 };
  F.units.push(u);
  g.say(`${u.name} gemietet (−${cost.toLocaleString('de-CH')} CHF): arbeitet selbstständig.`, 'upgrade');
  return u;
}

// Den eigenen Ponton der Flotte zuteilen (arbeitet dann wie ein gemieteter, ohne Lohn) und wieder zurückrufen
export const lentUnit = (g) => g.fleet.units.find((u) => u.self) ?? null;
export function lendBlock(g) {
  if (g.status !== 'playing') return 'Spiel beendet';
  if (lentUnit(g)) return 'Schon der Flotte zugeteilt';
  return g.stats.autoLevel < 1 ? 'Braucht die Automatik (Ausrüstung)' : null;
}
export function lendPonton(g, x, y) {
  if (lendBlock(g)) return null;
  const F = g.fleet, u = { id: ++F.seq, name: 'Dein Ponton', self: true, x, y, state: 'idle', site: null, idle: 0, note: 'startet', skip: {}, removed: 0 };
  F.units.push(u);
  g.say('Dein Ponton arbeitet jetzt für die Flotte (kein Lohn). Zurückrufen im Panel «Flotte».', 'upgrade');
  return u;
}
export function recallPonton(g) {
  const u = lentUnit(g); if (!u) return null;
  u.sim?.leave(); g.fleet.units.splice(g.fleet.units.indexOf(u), 1);
  return { x: u.x, y: u.y };
}
export function dismissUnit(g, id) {
  const F = g.fleet, i = F.units.findIndex((u) => u.id === id);
  if (i < 0) return false;
  F.units[i].sim?.leave();
  F.units.splice(i, 1);
  return true;
}

// Sperren für die automatischen Pontons: Naturschutzzone (Flachwasser am Ufer) und Altlastenbereiche nicht abtragen
const bump = (g) => { g.fleet.rev = (g.fleet.rev ?? 0) + 1; }; // Einstellung geändert: arbeitende Pontons wählen sofort neu
export function setAvoid(g, nature, altlast) { g.fleet.noNature = !!nature; g.fleet.noAltlast = !!altlast; bump(g); }
export function cellAllowed(g, i) {
  const F = g.fleet, r = g.river;
  if (F.noAltlast && r.kind[i] === KIND.altlast && r.top[i] - r.rock[i] > 0.05) return false;
  if (F.noNature && !r.zone[i] && r.ext[i] === 2) return false;
  return true;
}
export function setMine(g, on) { g.fleet.mine = !!on; bump(g); }
export function setPour(g, on) { g.fleet.pour = !!on; bump(g); }
export function setWiden(g, on, w) { g.fleet.widen = !!on; if (w) g.fleet.widenW = Math.max(1, Math.min(5, Math.round(w))); bump(g); }
export function setGoal(g, clsId) { g.fleet.goal = SHIPS.some((s) => s.id === clsId) ? clsId : null; bump(g); }

// Ausbauklasse: gewählt oder die kleinste, die noch nicht fährt (und endlich ist)
export function targetClass(g) {
  if (g.fleet.goal && g.level.classes.includes(g.fleet.goal)) return shipById(g.fleet.goal);
  const cl = SHIPS.filter((s) => g.level.classes.includes(s.id));
  return cl.find((s) => g.fair?.[s.id] && !g.fair[s.id].passable && g.fair[s.id].volume < Infinity)
    ?? cl.find((s) => g.fair?.[s.id]?.passable && g.fair[s.id].loadFrac < 0.999 && g.fair[s.id].volume < Infinity) ?? null; // sonst: Rinne für volle Ladung vertiefen
}

const canRock = (g) => g.stats.loeffel > 0 || g.stats.rockFirmness >= CONFIG.fleet.rockFirmnessMin;

// Spalten der Rinne der Klasse, in denen noch Sohle über der nötigen Tiefe liegt (aufsteigend); rock = Fels im Weg
export function openColumns(g, cls) {
  const f = g.fair?.[cls.id];
  if (!f?.nodes) return [];
  const r = g.river, needTop = g.wl - f.need + 0.06, lo = Math.floor((cls.beam - 1) / 2), hi = cls.beam - 1 - lo, cols = new Map();
  let avoided = 0;
  for (const p of f.nodes) {
    for (let k = p.y - lo; k <= p.y + hi; k++) {
      const i = k * r.cols + p.x;
      if (!r.zone[i] || r.top[i] <= needTop) continue;
      if (!cellAllowed(g, i)) { avoided++; continue; }
      const c = cols.get(p.x) ?? { x: p.x, rock: false, armor: false, y: p.y + (hi - lo) / 2 + 0.5 };
      if (r.rock[i] > needTop) c.rock = true;
      if (r.armor[i] > 0) c.armor = true; // Beton muss aufgebrochen werden
      cols.set(p.x, c);
    }
  }
  const out = [...cols.values()].sort((a, b) => a.x - b.x);
  out.avoided = avoided; // so viele Zellen blieben wegen der Sperren (Altlast, Naturschutz) ausgelassen
  return out;
}

const reservedBy = (g, me) => g.fleet.units.filter((u) => u !== me && u.site && (u.state === 'travel' || u.state === 'work')).map((u) => u.site);
const overlaps = (res, c0) => res.some((s) => c0 < s.c0 + CONFIG.box.cols && s.c0 < c0 + CONFIG.box.cols);
const skipKey = (s) => (s.aid ? `A${s.aid}:${s.col}` : s.did ? `M${s.did}` : s.zid ? `Z${s.zid}` : s.pour ? `P${s.col}` : s.land ? `L${s.col}${s.side}` : s.col);

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
      for (let k = 1; k <= W; k++) { const y = edge + side * k; if (y < 0 || y >= r.rows || !r.ext[y * r.cols + x] || !cellAllowed(g, y * r.cols + x)) break; rows.push(y); }
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
  if (!open.length) return { none: open.avoided ? 'Altlast im Weg: Meiden ist aktiv (Flotte)' : `${cls.name}: Rinne ist frei` };
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

// ---------- Arbeitsgebiete: auf der Karte vorgegebene Rechtecke, die ein (oder jedes) Ponton auf die gewählte Tiefe baggert ----------
export const MAX_AREAS = 4;
export function addArea(g, xa, ya, xb, yb, depth) {
  const r = g.river, F = g.fleet; F.areas ??= [];
  if (F.areas.length >= MAX_AREAS) return null;
  const x0 = Math.max(0, Math.min(Math.floor(xa), Math.floor(xb))), x1 = Math.min(r.cols - 1, Math.max(Math.floor(xa), Math.floor(xb)));
  const y0 = Math.max(0, Math.min(Math.floor(ya), Math.floor(yb))), y1 = Math.min(r.rows - 1, Math.max(Math.floor(ya), Math.floor(yb)));
  let any = false; for (let y = y0; y <= y1 && !any; y++) for (let x = x0; x <= x1; x++) { const i = y * r.cols + x; if (r.zone[i] || r.ext[i]) { any = true; break; } }
  if (!any) return null; // nur Wasser im Baggerkorridor oder Ausbaustreifen lässt sich bearbeiten
  const cls = targetClass(g), d = depth ?? Math.min(CONFIG.echolot.maxDepth, (cls ? cls.draught + CONFIG.clearance : CONFIG.echolot.defaultDepth) + 0.2);
  const a = { id: ++F.areaSeq, x0, x1, y0, y1, depth: Math.round(d * 10) / 10, unit: null };
  F.areas.push(a); bump(g);
  return a;
}
export function removeArea(g, id) { const F = g.fleet, i = (F.areas ?? []).findIndex((a) => a.id === id); if (i < 0) return false; F.areas.splice(i, 1); bump(g); return true; }
export function setAreaDepth(g, id, d) { const a = (g.fleet.areas ?? []).find((q) => q.id === id); if (!a) return false; a.depth = Math.round(Math.min(CONFIG.echolot.maxDepth, Math.max(CONFIG.echolot.minDepth, d)) * 10) / 10; bump(g); return true; }
// ---------- Baggerroute: eine gezeichnete Linie (Wegpunkte) mit Breite; die Pontons baggern sie auf Tiefe aus, auch durch Ufer und Land im Ausbaustreifen ----------
// Zellen der Route: alle abbaubaren Zellen (Korridor, Ausbaustreifen) im Abstand w/2 von der Linie; lost = Zellen auf nicht abbaubarem Land
export function rasterRoute(r, pts, w) {
  const cells = new Set(), seen = new Set(), rad = w / 2; let lost = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25) + 1;
    for (let s = 0; s <= n; s++) {
      const px = a.x + ((b.x - a.x) * s) / n, py = a.y + ((b.y - a.y) * s) / n;
      for (let y = Math.max(0, Math.floor(py - rad)); y <= Math.min(r.rows - 1, Math.floor(py + rad)); y++) for (let x = Math.max(0, Math.floor(px - rad)); x <= Math.min(r.cols - 1, Math.floor(px + rad)); x++) {
        if (Math.hypot(x + 0.5 - px, y + 0.5 - py) > rad + 0.01) continue;
        const i = y * r.cols + x; if (seen.has(i)) continue; seen.add(i);
        if (r.zone[i] || r.ext[i]) cells.add(i); else lost++;
      }
    }
  }
  return { cells: [...cells].sort((p, q) => p - q), lost };
}
export function addRoute(g, pts, depth, w) {
  const r = g.river, F = g.fleet; F.areas ??= [];
  if (F.areas.length >= MAX_AREAS || pts.length < 2) return null;
  const cls = targetClass(g), width = Math.max(2, Math.min(9, Math.round(w ?? (cls ? cls.beam : 5))));
  const ras = rasterRoute(r, pts, width);
  if (!ras.cells.length) return null;
  const xs = ras.cells.map((i) => i % r.cols), ys = ras.cells.map((i) => (i / r.cols) | 0);
  const d = depth ?? Math.min(CONFIG.echolot.maxDepth, (cls ? cls.draught + CONFIG.clearance : CONFIG.echolot.defaultDepth) + 0.2);
  const a = { id: ++F.areaSeq, route: true, pts: pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })), w: width, cells: ras.cells, lost: ras.lost, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), depth: Math.round(d * 10) / 10, unit: null };
  F.areas.push(a); bump(g);
  return a;
}
export function setAreaWidth(g, id, w) {
  const a = (g.fleet.areas ?? []).find((q) => q.id === id); if (!a?.route) return false;
  const r = g.river, ras = rasterRoute(r, a.pts, Math.max(2, Math.min(9, Math.round(w)))); if (!ras.cells.length) return false;
  const xs = ras.cells.map((i) => i % r.cols), ys = ras.cells.map((i) => (i / r.cols) | 0);
  Object.assign(a, { w: Math.max(2, Math.min(9, Math.round(w))), cells: ras.cells, lost: ras.lost, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }); bump(g);
  return true;
}
export function setAreaUnit(g, id, unitId) { const a = (g.fleet.areas ?? []).find((q) => q.id === id); if (!a) return false; a.unit = unitId ?? null; bump(g); return true; }

// Spalten des Gebiets, in denen noch Sohle über der Gebietstiefe liegt. Ufer (Ausbaustreifen) kommt erst dran, wenn das Wasser im Gebiet
// die Tiefe hat und "Ufer verbreitern" mit Löffelbagger an ist; vorher baggern die Pontons nur die Rinne.
export function openAreaColumns(g, a) {
  const r = g.river, needTop = g.wl - a.depth + 0.06;
  if (a.route) { // Route: Zellen der Linie (Korridor und Ausbaustreifen), Land braucht den Löffelbagger
    const cols = new Map();
    for (const i of a.cells) {
      if (r.top[i] <= needTop || !cellAllowed(g, i)) continue;
      const x = i % r.cols, y = (i / r.cols) | 0, c = cols.get(x) ?? { x, rows: [y, y], rock: false, armor: false, land: false };
      c.rows[0] = Math.min(c.rows[0], y); c.rows[1] = Math.max(c.rows[1], y);
      if (!r.zone[i]) c.land = true; if (r.rock[i] > needTop) c.rock = true; if (r.armor[i] > 0) c.armor = true;
      cols.set(x, c);
    }
    return [...cols.values()].sort((p, q) => p.x - q.x);
  }
  const scan = (withLand) => {
    const out = [];
    for (let x = a.x0; x <= a.x1; x++) {
      let open = false, rock = false, armor = false, land = false, y0 = Infinity, y1 = -Infinity;
      for (let y = a.y0; y <= a.y1; y++) {
        const i = y * r.cols + x;
        if (!(r.zone[i] || (withLand && r.ext[i])) || r.top[i] <= needTop || !cellAllowed(g, i)) continue;
        if (withLand && r.zone[i]) continue; // Landphase: nur das Ufer
        open = true; y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        if (!r.zone[i]) land = true;
        if (r.rock[i] > needTop) rock = true;
        if (r.armor[i] > 0) armor = true;
      }
      if (open) out.push({ x, rows: [y0, y1], rock, armor, land });
    }
    return out;
  };
  const water = scan(false);
  if (water.length || !(g.fleet.widen && g.stats.loeffel > 0)) return water;
  return scan(true);
}
export const areaWork = (g, a) => openAreaColumns(g, a).length;

function pickArea(g, u) {
  const areas = (g.fleet.areas ?? []).filter((a) => a.unit === null || a.unit === u.id);
  if (!areas.length) return { none: 'Kein Arbeitsgebiet vorgegeben' };
  const res = reservedBy(g, u), B = CONFIG.box.cols, r = g.river;
  let note = 'Arbeitsgebiete sind fertig';
  for (const a of areas) {
    for (const c of openAreaColumns(g, a)) {
      const key = `A${a.id}:${c.x}`;
      if (u.skip[key] && g.time < u.skip[key]) continue;
      if ((c.armor || c.land) && g.stats.loeffel <= 0) { note = 'Beton im Weg: braucht den Löffelbagger'; continue; }
      if (c.rock && !canRock(g)) { note = 'Fels im Weg: braucht Felsfräse oder Löffelbagger'; continue; }
      const c0 = Math.min(Math.max(0, c.x), r.cols - B);
      if (overlaps(res, c0)) { note = 'Gebiet: Stelle ist vergeben'; continue; }
      const rr = a.route ? c.rows : [a.y0, a.y1], px = c0 + Math.floor(B / 2), mid = (rr[0] + rr[1]) / 2;
      const cands = [mid + 0.5]; for (let d = 1; d <= rr[1] - rr[0] + 3; d++) cands.push(mid + 0.5 + d, mid + 0.5 - d);
      const y = cands.find((yy) => yy > 0 && yy < r.rows && r.depthAt(r.idx(px, Math.floor(yy))) >= 0.8) ?? r.centerY(px);
      return { area: true, aid: a.id, land: c.land, c0, col: c.x, y, rows: rr, cls: g.level.classes[0], depth: a.depth, tool: c.land || c.rock || c.armor ? 'loeffel' : 'pump', rock: c.rock || c.armor };
    }
  }
  return { none: note };
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

// Betonier-Automatik: Spalten der Rinne (höchste Klasse, die fährt) samt zwei Zeilen Böschung beiderseits, in denen die Betonschicht noch fehlt
export function openPourColumns(g) {
  const base = [...SHIPS.filter((s) => g.level.classes.includes(s.id) && g.fair?.[s.id]?.passable)].pop();
  if (!base) return [];
  const f = g.fair[base.id], r = g.river, T = CONFIG.concrete.thickness, lo = Math.floor((base.beam - 1) / 2), hi = base.beam - 1 - lo, out = [];
  for (const p of f.nodes) {
    let open = false; const rows = [];
    for (let k = p.y - lo - 2; k <= p.y + hi + 2; k++) {
      if (k < 0 || k >= r.rows) continue;
      rows.push(k);
      const i = k * r.cols + p.x;
      if ((r.zone[i] || r.ext[i]) && r.armor[i] < T * 0.9 && r.top[i] - r.rock[i] > T * 0.5) open = true;
    }
    if (open) out.push({ x: p.x, y: p.y + (hi - lo) / 2 + 0.5, rows, cls: base.id });
  }
  return out;
}

function pickPour(g, u) {
  if (!g.fleet.pour) return { none: 'Betonieren ist aus' };
  if (g.stats.betonrohr <= 0) return { none: 'Betonieren braucht das Betoniergerät' };
  if (g.concrete < 8) return { none: 'Kein Beton im Lager (kaufen oder Betonwerk)' };
  const open = openPourColumns(g), res = reservedBy(g, u), B = CONFIG.box.cols;
  if (!open.length) return { none: 'Rinne ist betoniert' };
  for (const c of open) {
    if (u.skip[`P${c.x}`] && g.time < u.skip[`P${c.x}`]) continue;
    const c0 = Math.min(Math.max(0, c.x), g.river.cols - B);
    if (overlaps(res, c0)) continue;
    return { pour: true, c0, col: c.x, y: c.y, rows: c.rows, cls: c.cls, depth: CONFIG.echolot.defaultDepth, tool: 'beton', rock: false };
  }
  return { none: 'Alle Betonierstellen sind vergeben' };
}

// Geplante Kreuzungsstellen ausbauen: die zwei Rinnen in den drei Spalten der Zone auf die Tiefe der geplanten Klasse bringen (Ufer abtragen, wo nötig)
function pickZone(g, u) {
  const open = g.zones.filter((z) => !zoneSupports(g, z, z.cls ?? g.zoneClassId));
  if (!open.length) return { none: 'Keine geplante Kreuzungsstelle offen' };
  const res = reservedBy(g, u), B = CONFIG.box.cols, r = g.river;
  let note = 'Alle geplanten Kreuzungsstellen sind vergeben';
  for (const z of open) {
    if (u.skip[`Z${z.id}`] && g.time < u.skip[`Z${z.id}`]) continue;
    const cid = z.cls ?? g.zoneClassId, plan = g.zonePlanFor(z.x, cid);
    if (!plan.wins || plan.volume === Infinity) { note = 'Kreuzungsstelle: kein Platz'; continue; }
    const loeff = g.stats.loeffel > 0, needTopZ = plan.needTop;
    let blockedZ = false;
    for (const w of plan.wins) for (const a0 of [w.a, w.b]) for (let k = a0; k < a0 + plan.beam; k++) { const i = k * r.cols + w.x; if (r.top[i] > needTopZ && !cellAllowed(g, i)) blockedZ = true; }
    if (blockedZ) { note = 'Kreuzungsstelle: Altlast oder Naturschutz im Weg (Meiden aktiv)'; continue; }
    if ((plan.land || plan.armor) && !loeff) { note = plan.armor ? 'Beton im Weg: braucht den Löffelbagger' : 'Kreuzungsstelle braucht den Löffelbagger (Uferabtrag)'; continue; }
    if (plan.rock && !canRock(g)) { note = 'Fels im Weg: braucht Felsfräse oder Löffelbagger'; continue; }
    const c0 = Math.min(Math.max(0, z.x - 1), r.cols - B);
    if (overlaps(res, c0)) continue;
    let r0 = Infinity, r1 = -Infinity;
    for (const w of plan.wins) { r0 = Math.min(r0, w.a); r1 = Math.max(r1, w.b + plan.beam - 1); }
    const px = c0 + Math.floor(B / 2), mid = (r0 + r1) / 2;
    const cands = [mid + 0.5]; for (let d = 1; d <= r1 - r0; d++) cands.push(mid + 0.5 + d, mid + 0.5 - d);
    const y = cands.find((yy) => yy > 0 && yy < r.rows && r.depthAt(r.idx(px, Math.floor(yy))) >= 0.8) ?? r.centerY(px);
    const ship = shipById(cid), need = ship.draught + CONFIG.clearance;
    return { zone: true, zid: z.id, land: plan.land, c0, col: z.x, y, rows: [r0, r1], cls: cid, depth: Math.min(CONFIG.echolot.maxDepth, need + CONFIG.fleet.margin), tool: plan.land || plan.rock || plan.armor ? 'loeffel' : 'pump', rock: plan.rock || plan.armor };
  }
  return { none: note };
}

// Rohstoffvorkommen mit Konzession abbauen (bringt den Preisaufschlag): freie Pontons fahren zur Stelle mit dem meisten Rest
function pickMine(g, u) {
  if (!g.fleet.mine) return { none: 'Rohstoffabbau ist aus' };
  const r = g.river, res = reservedBy(g, u), B = CONFIG.box.cols;
  const list = r.deposits.filter((d) => d.owned).map((d) => ({ d, rest: r.depositRemaining(d.id) })).filter((x) => x.rest > 25).sort((a, b) => b.rest - a.rest);
  if (!list.length) return { none: 'Kein Vorkommen mit Konzession übrig' };
  for (const { d } of list) {
    if (u.skip[`M${d.id}`] && g.time < u.skip[`M${d.id}`]) continue;
    // Spalte mit dem meisten Rest im Vorkommen
    let bestX = -1, bestV = 0, r0 = Infinity, r1 = -Infinity;
    const perCol = new Map();
    for (let i = 0; i < r.dep.length; i++) if (r.dep[i] === d.id) { const x = i % r.cols, y = (i / r.cols) | 0; perCol.set(x, (perCol.get(x) ?? 0) + r.sedAt(i)); }
    for (const [x, v] of [...perCol].sort((a, b) => a[0] - b[0])) {
      const c0 = Math.min(Math.max(0, x - 1), r.cols - B);
      if (v > bestV && !overlaps(res, c0)) { bestV = v; bestX = x; }
    }
    if (bestX < 0 || bestV < 0.3) continue;
    for (let i = 0; i < r.dep.length; i++) if (r.dep[i] === d.id && Math.abs(i % r.cols - bestX) <= 2) { const y = (i / r.cols) | 0; r0 = Math.min(r0, y); r1 = Math.max(r1, y); }
    const c0 = Math.min(Math.max(0, bestX - 1), r.cols - B), px = c0 + Math.floor(B / 2), mid = (r0 + r1) / 2;
    const cands = [mid + 0.5]; for (let k = 1; k <= r1 - r0 + 2; k++) cands.push(mid + 0.5 + k, mid + 0.5 - k);
    const y = cands.find((yy) => yy > 0 && yy < r.rows && r.depthAt(r.idx(px, Math.floor(yy))) >= 0.8) ?? r.centerY(px);
    return { mine: true, did: d.id, c0, col: bestX, y, rows: [r0, r1], cls: g.level.classes[0], depth: CONFIG.echolot.maxDepth, tool: 'pump', rock: false };
  }
  return { none: 'Alle Vorkommen sind vergeben' };
}

function pickSite(g, u) {
  const units = g.fleet.units, landRole = g.fleet.widen && g.stats.loeffel > 0 && units.indexOf(u) === units.length - 1;
  const order = [pickArea, ...(landRole ? [pickZone, pickLand, pickLane] : [pickLane, pickZone, pickLand]), pickMine, pickPour];
  const msgs = [];
  for (const f of order) { const s = f(g, u); if (!s.none) return s; msgs.push(s); }
  const neutral = /ist aus$|^Keine geplante|^Kein Arbeitsgebiet|^Arbeitsgebiete sind fertig|^Kein Vorkommen|^Alle Vorkommen|Rinne ist frei$|alle Klassen fahren|ist betoniert|Ufer ist verbreitert|vergeben$/;
  return msgs.filter((m) => !neutral.test(m.none)).pop() ?? msgs.find((m) => !/ist aus$|^Keine geplante/.test(m.none)) ?? msgs[0]; // die aussagekräftigste Meldung (zeigt, woran es hängt)
}

function makeSim(g, u) {
  const sim = g.createSession();
  sim.x = u.x; sim.y = u.y; sim.tool = 'pump';
  u.state = 'idle'; u.site = null; u.idle = 0;
  return sim;
}

// Weg über schwimmfähige Zellen (8 Nachbarn, ohne Ecken zu schneiden) vom Ponton zum Ziel; null, wenn das Ziel nicht erreichbar ist
function floatPath(sim, from, to) {
  const r = sim.river, W = r.cols, Hh = r.rows, ok = (x, y) => x >= 0 && y >= 0 && x < W && y < Hh && sim.canFloat(x + 0.5, y + 0.5);
  const sx = Math.min(W - 1, Math.max(0, Math.floor(from.x))), sy = Math.min(Hh - 1, Math.max(0, Math.floor(from.y))), gx = Math.floor(to.x), gy = Math.floor(to.y);
  if (!ok(gx, gy)) return null;
  const prev = new Int32Array(W * Hh).fill(-2), q = [sy * W + sx]; prev[q[0]] = -1;
  for (let h = 0; h < q.length; h++) {
    const c = q[h], cx = c % W, cy = (c / W) | 0; if (cx === gx && cy === gy) break;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
      if (!ok(nx, ny) || prev[n] !== -2) continue;
      if (dx && dy && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue;
      prev[n] = c; q.push(n);
    }
  }
  const goal = gy * W + gx; if (prev[goal] === -2) return null;
  const path = []; for (let c = goal; c !== -1; c = prev[c]) path.push({ x: (c % W) + 0.5, y: ((c / W) | 0) + 0.5 });
  return path.reverse();
}

function stepUnit(g, u, dt) {
  const sim = (u.sim ??= makeSim(g, u));
  sim.setStats(g.stats); sim.bufferRoom = g.bufferRoom; sim.concreteAvail = g.concrete;
  let inp = { dx: 0, dy: 0, suction: false };
  if ((u.state === 'travel' || u.state === 'work') && u.rev !== (g.fleet.rev ?? 0)) { // Einstellungen geändert: Arbeit abbrechen und neu wählen
    if (sim.mode === 'slice') sim.leave();
    u.state = 'idle'; u.idle = 0; u.site = null; u.note = 'wählt neu (Einstellung geändert)';
  }
  if (u.state === 'idle') {
    u.idle -= dt;
    if (u.idle <= 0) {
      const s = pickSite(g, u);
      if (s.none) { u.idle = CONFIG.fleet.idleRetry; u.note = s.none; }
      else { u.site = s; u.rev = g.fleet.rev ?? 0; u.state = 'travel'; u.travelT = 0; u.note = `fährt zu Spalte ${s.col + 1}`; }
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
      let aim = goal, blocked = false;
      const key = skipKey(s);
      if (!u.path || u.pathKey !== key || g.time - u.pathT > 2) { u.path = floatPath(sim, { x: sim.x, y: sim.y }, goal); u.pathKey = key; u.pathT = g.time; }
      if (!u.path) { u.skip[key] = g.time + 45; u.state = 'idle'; u.idle = CONFIG.fleet.idleRetry; u.note = 'kein Weg zur Stelle'; u.path = null; blocked = true; aim = { x: sim.x, y: sim.y }; }
      else { let pi = 0, pd = Infinity; u.path.forEach((p, i) => { const d = Math.hypot(p.x - sim.x, p.y - sim.y); if (d < pd) { pd = d; pi = i; } }); const nx = u.path.slice(pi).find((p) => Math.hypot(p.x - sim.x, p.y - sim.y) > 0.8); aim = nx ?? goal; if (Math.hypot(goal.x - sim.x, goal.y - sim.y) < 1.2) aim = goal; }
      const dx = aim.x - sim.x, dy = aim.y - sim.y, dist = Math.hypot(dx, dy);
      if (!blocked && (Math.hypot(goal.x - sim.x, goal.y - sim.y) < 0.5 || u.travelT > 90)) { // angekommen (oder zu lange unterwegs): ankern, Automatik an
        u.travelT = 0;
        if (!sim.canFloat(goal.x, goal.y)) { u.skip[skipKey(s)] = g.time + 60; u.state = 'idle'; u.idle = CONFIG.fleet.idleRetry; u.note = 'kein Platz zum Ankern'; }
        else {
          sim.x = goal.x; sim.y = goal.y; // ganzzahlig: der Kasten beginnt dann genau bei c0
          sim.targetDepth = s.depth; sim.pumpSpeed = 1;
          sim.tool = toolAvailable(g.stats, s.tool) ? s.tool : 'pump';
          if (sim.anchor()) {
            const sl = sim.slice;
            sl.soundNoise = CONFIG.fleet.soundNoise; sl.avoidAltlast = !!g.fleet.noAltlast; sl.avoidNature = !!g.fleet.noNature; sl.sound();
            if (s.pour) { sl.autoPour = true; sl.autoRange = [Math.min(...s.rows) - 1, Math.max(...s.rows) + 1]; }
            else if (s.mine) { sl.autoRange = [s.rows[0] - 1, s.rows[1] + 1]; }
            else if (s.area) { if (s.land) sl.autoLand = true; sl.autoRange = [s.rows[0], s.rows[1]]; } // Arbeitsgebiet: genau das Rechteck
            else if (s.land || s.zid) { if (s.land) sl.autoLand = true; sl.autoRange = [Math.min(...s.rows) - 1, Math.max(...s.rows) + 1]; } // Uferstreifen bzw. Kreuzungsstelle
            else {
              const lane = g.fair[s.cls], cls = shipById(s.cls), lo = Math.floor((cls.beam - 1) / 2), hi = cls.beam - 1 - lo;
              let r0 = Infinity, r1 = -Infinity;
              for (const n of lane.nodes) if (n.x >= s.c0 - 1 && n.x <= s.c0 + B) { r0 = Math.min(r0, n.y - lo); r1 = Math.max(r1, n.y + hi); }
              if (r0 <= r1) sl.autoRange = [r0 - 1, r1 + 1]; // nur die Rinne (mit einer Zelle Böschung) ausheben
            }
            sl.x = Math.max(sl.bounds().min, (sl.autoRange?.[0] ?? 0) + 0.01); sl.h = Math.min(sl.maxH(), sl.surfaceAt(sl.x) + 1.5);
            sim.toggleAuto();
            u.state = 'work'; u.workT = 0; u.note = s.area ? `baggert Gebiet ${s.aid} bei Spalte ${s.col + 1}` : s.did ? `baut Rohstoffe ab bei Spalte ${s.col + 1}` : s.zid ? `baut Kreuzungsstelle aus bei Spalte ${s.col + 1}` : s.pour ? `betoniert bei Spalte ${s.col + 1}` : s.land ? `baut Ufer ab bei Spalte ${s.col + 1} (Löffel)` : `baggert bei Spalte ${s.col + 1} (${s.tool === 'loeffel' ? 'Löffel' : 'Saugkopf'})`;
          } else { u.skip[skipKey(s)] = g.time + 40; u.state = 'idle'; u.idle = CONFIG.fleet.idleRetry; u.note = 'kein Platz zum Ankern'; }
        }
      } else if (dist > 1e-6) {
        // Festhänger (Flachwasser/Land ringsum, Zittern auf der Stelle): nach kurzer Zeit auf die Rinne setzen und ein Stück Richtung Ziel weiter
        const moved = Math.hypot(sim.x - (u.px ?? sim.x), sim.y - (u.py ?? sim.y));
        u.stuckT = moved < 0.3 * g.stats.speed * CONFIG.fleet.speedMult * dt ? (u.stuckT ?? 0) + dt : 0;
        if (u.stuckT > 2) {
          u.stuckT = 0;
          const step = Math.sign(gi - ni) * (nd > 1.2 ? 0 : 3), n = route.nodes[Math.max(0, Math.min(route.nodes.length - 1, ni + step))];
          if (sim.canFloat(n.x + 0.5, n.y + 0.5)) { sim.x = n.x + 0.5; sim.y = n.y + 0.5; u.note = 'wurde freigesetzt'; }
        }
        const k = CONFIG.fleet.speedMult; inp = { dx: (dx / dist) * k, dy: (dy / dist) * k, suction: false };
      }
    }
  } else if (u.state === 'work') {
    u.workT += dt;
    if (sim.mode === 'slice' && !sim.pumpOn && sim.slice.auto.on) { sim.pumpOn = true; sim.autoStartedPump = true; }
    const limit = u.site?.area ? 300 : u.site?.did ? 300 : u.site?.land ? 420 : u.site?.zid ? 300 : u.site?.pour ? 240 : 140; // Landabtrag ist viel Material
    const noConcrete = u.site?.pour && g.concrete <= 0.05;
    if (noConcrete) u.note = 'Kein Beton mehr im Lager';
    if (sim.mode !== 'slice' || !sim.slice.auto.on || u.workT > limit || noConcrete) {
      if (u.workT > limit && u.site) u.skip[skipKey(u.site)] = g.time + 90; // hängt fest (z. B. Fels): später wieder versuchen
      sim.leave(); u.state = 'idle'; u.idle = noConcrete ? CONFIG.fleet.idleRetry : 0; if (!noConcrete) u.note = 'sucht nächste Stelle';
    }
  }
  const d = sim.update(dt, inp);
  sim.notes.length = 0;
  g.collect(d);
  g.totals.fleetRemoved += d.removed; u.removed += d.removed;
  u.x = sim.x; u.y = sim.y; u.px = sim.x; u.py = sim.y;
}

export function updateFleet(g, dt) {
  for (const u of g.fleet.units) stepUnit(g, u, dt);
}

// Positionen verankerter Flottenpontons (bremsen den Verkehr in der Rinne wie dein eigener Ponton)
export function fleetSites(g) {
  return g.fleet.units.filter((u) => u.sim?.mode === 'slice').map((u) => ({ x: u.sim.x, y: u.sim.y }));
}
