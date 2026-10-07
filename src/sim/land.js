// Landseite des Hafens (pro Karte): Strassen und Lagerhallen auf dem Land neben dem Hafenbecken.
// Strassen verbinden Lagerhallen mit dem Hafenbecken (Kai); nur angebundene Hallen zählen. Hallen erweitern die Zwischenlager (Container, Kies),
// jede angebundene Strassenzelle beschleunigt den Umschlag der Mannschaft. Erdarbeiten (Einebnen) sind im Bau enthalten.
export const LAND = {
  road: { cost: 350 },
  hall: { name: 'Lagerhalle', icon: '🏭', w: 2, h: 2, cost: 9000, up: [14000, 26000], cap: { container: [300, 700, 1500], kies: [200, 500, 1100] } },
  earthwork: 400, // CHF je m Höhenunterschied und Zelle beim Einebnen
  roadBoost: 0.05, maxBoost: 0.8, maxPath: 40,
};
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const landOf = (g) => (g.port.land ??= { roads: [], halls: [], seq: 0 });
const idx = (g, x, y) => y * g.river.cols + x;
const inMap = (g, x, y) => x >= 0 && y >= 0 && x < g.river.cols && y < g.river.rows;
// Land: nicht Wasser, kein Becken, kein Korridor, kein Rohstoffvorkommen
export function isLand(g, x, y) {
  if (!inMap(g, x, y)) return false;
  const r = g.river, i = idx(g, x, y);
  return !r.isWater(i) && !r.zone[i] && !r.bay[i] && !r.dep[i];
}
function occupied(g) {
  const L = landOf(g), set = new Map();
  for (const i of L.roads) set.set(i, 'road');
  for (const h of L.halls) for (let dy = 0; dy < LAND.hall.h; dy++) for (let dx = 0; dx < LAND.hall.w; dx++) set.set(idx(g, h.x + dx, h.y + dy), h.id);
  return set;
}
const bayCells = (g) => new Set(g.port.bay?.cells ?? []);
const touchesBay = (g, x, y, bay) => N4.some(([dx, dy]) => inMap(g, x + dx, y + dy) && bay.has(idx(g, x + dx, y + dy)));

// Strassenzellen, die über Nachbarzellen mit dem Hafenbecken verbunden sind
export function connectedRoads(g) {
  const L = landOf(g), bay = bayCells(g), roads = new Set(L.roads), seen = new Set(), queue = [];
  for (const i of L.roads) { const x = i % g.river.cols, y = (i / g.river.cols) | 0; if (touchesBay(g, x, y, bay)) { seen.add(i); queue.push(i); } }
  while (queue.length) {
    const i = queue.pop(), x = i % g.river.cols, y = (i / g.river.cols) | 0;
    for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy; if (!inMap(g, nx, ny)) continue; const j = idx(g, nx, ny); if (roads.has(j) && !seen.has(j)) { seen.add(j); queue.push(j); } }
  }
  return seen;
}
export function hallConnected(g, h, conn = connectedRoads(g)) {
  const bay = bayCells(g);
  for (let dy = 0; dy < LAND.hall.h; dy++) for (let dx = 0; dx < LAND.hall.w; dx++) {
    const x = h.x + dx, y = h.y + dy;
    if (touchesBay(g, x, y, bay)) return true;
    for (const [ax, ay] of N4) if (inMap(g, x + ax, y + ay) && conn.has(idx(g, x + ax, y + ay))) return true;
  }
  return false;
}
// Zusatzlager durch angebundene Hallen
export function hallCapacity(g, id) {
  if (!g.port.land) return 0;
  const conn = connectedRoads(g);
  return landOf(g).halls.reduce((a, h) => a + (hallConnected(g, h, conn) ? (LAND.hall.cap[id]?.[h.level - 1] ?? 0) : 0), 0);
}
// Umschlagstempo der Mannschaft: jede angebundene Strassenzelle gibt einen Zuschlag
export const roadFactor = (g) => (g.port.land ? 1 + Math.min(LAND.maxBoost, LAND.roadBoost * connectedRoads(g).size) : 1);

const baseBlock = (g) => (!g.port.open ? 'Erst das Hafengelände erwerben (Hafen)' : g.status !== 'playing' ? 'Spiel beendet' : null);

export function roadBlock(g, x, y) {
  const b = baseBlock(g); if (b) return b;
  if (!isLand(g, x, y)) return 'Strassen gehen nur auf Land';
  if (occupied(g).has(idx(g, x, y))) return 'Platz ist belegt';
  return g.money < LAND.road.cost ? `Braucht ${LAND.road.cost} CHF` : null;
}
export function buildRoad(g, x, y) {
  if (roadBlock(g, x, y)) return false;
  g.money -= LAND.road.cost; g.port.spent += LAND.road.cost; landOf(g).roads.push(idx(g, x, y)); return true;
}
// Erdarbeiten für die 2×2-Fläche: Höhenunterschied zum Mittel
function earthwork(g, x, y) {
  const r = g.river, cells = []; for (let dy = 0; dy < LAND.hall.h; dy++) for (let dx = 0; dx < LAND.hall.w; dx++) cells.push(idx(g, x + dx, y + dy));
  const avg = cells.reduce((a, i) => a + r.top[i], 0) / cells.length;
  return { cells, avg, fee: Math.round(cells.reduce((a, i) => a + Math.abs(r.top[i] - avg), 0) * LAND.earthwork) };
}
export function hallBlock(g, x, y) {
  const b = baseBlock(g); if (b) return b;
  const occ = occupied(g);
  for (let dy = 0; dy < LAND.hall.h; dy++) for (let dx = 0; dx < LAND.hall.w; dx++) {
    if (!isLand(g, x + dx, y + dy)) return 'Die Halle braucht 2×2 Zellen Land';
    if (occ.has(idx(g, x + dx, y + dy))) return 'Platz ist belegt';
  }
  const c = LAND.hall.cost + earthwork(g, x, y).fee;
  return g.money < c ? `Braucht ${c.toLocaleString('de-CH')} CHF` : null;
}
export const hallCost = (g, x, y) => LAND.hall.cost + earthwork(g, x, y).fee;
export function buildHall(g, x, y) {
  if (hallBlock(g, x, y)) return false;
  const e = earthwork(g, x, y), c = LAND.hall.cost + e.fee, r = g.river;
  for (const i of e.cells) { r.top[i] = Math.max(e.avg, r.rock[i]); r.pending.add(i); }
  g.money -= c; g.port.spent += c;
  const L = landOf(g); L.halls.push({ id: `H${++L.seq}`, x, y, level: 1 });
  return true;
}
export function hallUpgradeBlock(g, id) {
  const h = landOf(g).halls.find((q) => q.id === id);
  if (!h) return 'Unbekannt';
  if (h.level > LAND.hall.up.length) return 'Voll ausgebaut';
  const c = LAND.hall.up[h.level - 1];
  return g.money < c ? `Braucht ${c.toLocaleString('de-CH')} CHF` : g.status !== 'playing' ? 'Spiel beendet' : null;
}
export function upgradeHall(g, id) {
  if (hallUpgradeBlock(g, id)) return false;
  const h = landOf(g).halls.find((q) => q.id === id), c = LAND.hall.up[h.level - 1];
  g.money -= c; g.port.spent += c; h.level++; return true;
}
export function demolishAt(g, x, y) {
  const L = landOf(g), i = idx(g, x, y), ri = L.roads.indexOf(i);
  if (ri >= 0) { L.roads.splice(ri, 1); return 'road'; }
  const hi = L.halls.findIndex((h) => x >= h.x && x < h.x + LAND.hall.w && y >= h.y && y < h.y + LAND.hall.h);
  if (hi >= 0) { L.halls.splice(hi, 1); return 'hall'; }
  return null;
}
// Strasse automatisch: kürzester Weg über freies Land von der Halle zum Hafenbecken oder zu einer angebundenen Strasse
export function autoRoad(g, hallId) {
  const L = landOf(g), h = L.halls.find((q) => q.id === hallId); if (!h) return { ok: false, why: 'Halle nicht gefunden' };
  if (hallConnected(g, h)) return { ok: false, why: 'Halle ist schon angebunden' };
  const occ = occupied(g), bay = bayCells(g), conn = connectedRoads(g), cols = g.river.cols;
  const goal = (x, y) => touchesBay(g, x, y, bay) || N4.some(([dx, dy]) => inMap(g, x + dx, y + dy) && conn.has(idx(g, x + dx, y + dy)));
  const prev = new Map(), queue = [];
  for (let dy = 0; dy < LAND.hall.h; dy++) for (let dx = 0; dx < LAND.hall.w; dx++) for (const [ax, ay] of N4) {
    const x = h.x + dx + ax, y = h.y + dy + ay, i = idx(g, x, y);
    if (isLand(g, x, y) && !occ.has(i) && !prev.has(i)) { prev.set(i, -1); queue.push(i); }
  }
  let found = -1;
  for (let q = 0; q < queue.length && found < 0; q++) {
    const i = queue[q], x = i % cols, y = (i / cols) | 0;
    if (goal(x, y)) { found = i; break; }
    for (const [dx, dy] of N4) { const nx = x + dx, ny = y + dy, j = idx(g, nx, ny); if (inMap(g, nx, ny) && isLand(g, nx, ny) && !occ.has(j) && !prev.has(j)) { prev.set(j, i); queue.push(j); } }
  }
  if (found < 0) return { ok: false, why: 'Kein Weg über freies Land zum Hafenbecken' };
  const path = []; for (let i = found; i !== -1; i = prev.get(i)) path.push(i);
  if (path.length > LAND.maxPath) return { ok: false, why: 'Zu weit vom Hafenbecken' };
  const cost = path.length * LAND.road.cost;
  if (g.money < cost) return { ok: false, why: `Braucht ${cost.toLocaleString('de-CH')} CHF` };
  g.money -= cost; g.port.spent += cost; for (const i of path) L.roads.push(i);
  return { ok: true, cells: path.length, cost };
}
