import { CONFIG, KIND, SHIPS, shipById } from '../config.js';
import { River } from './river.js';
import { minNeedDepth } from './fairway.js';

// Hafenkarte: eigenes Raster zum Hafen einer Karte. Von links führt die Zufahrt (tief) in das Hafenbecken (anfangs flach, muss ausgebaggert werden);
// ringsum ist Land (nicht abbaubar) mit Kaimauer. Die Pontons der Karte lassen sich zwischen Hauptkarte und Hafen aufteilen (unit.loc).
// Reine Daten und Logik: das Flussbett liegt im Hafen (port.harbor.river) und wird mit gespeichert.
export const HARBOR = {
  basin: { x0: 14, x1: 33, y0: 11, y1: 24 }, // Zellen des Hafenbeckens
  entrance: { x0: 0, x1: 13, y0: 16, y1: 19 }, // Zufahrt vom Fluss
  startDepth: 1.0, siltTo: 1.3, // das Becken verlandet wieder bis zu dieser Tiefe, wenn nicht gebaggert wird
  entranceDepth: 2.8,
  need: { kahn: 2.0, motor: 3.0, tank: 4.0, container: 5.0, schub: 6.2 }, // Beckentiefe (m), die die Klasse zum Anlegen braucht (tiefer als der Fluss: Kaimauer, grosse Schiffe)
  kaiClasses: [1, 2, 5], // so viele Schiffsklassen (der Reihe nach: Lastkahn, Motorschiff, Tankschiff, Containerschiff) nimmt der Kai je Stufe an
  waits: [1, 2, 4], // Warteräume je Kai-Stufe: dort warten Schiffe, wenn alle Liegeplätze belegt sind
  waitX: [17, 21, 25, 29], waitY: 21.2, // Warteplätze im südlichen Becken
  quayY: 10.5, berthX: [16, 20, 24, 28, 32], // Liegeplätze an der Nordkaimauer
  plots: [[3, 3], [12, 3], [21, 3], [30, 3], [8, 27], [27, 27]], // Bauplätze (Zelle links oben) für die 6 Hafenplätze, Grösse 8×5
  plotW: 8, plotH: 5,
};

export function createHarborRiver(wl) {
  const r = new River(CONFIG.river.cols, CONFIG.river.rows), n = r.cols * r.rows, B = HARBOR.basin, E = HARBOR.entrance;
  r.wl = wl;
  r.top.fill(wl + 1.4); r.rock.fill(wl - 8); r.cap.fill(0); r.flow.fill(0); r.kind.fill(KIND.sand); r.zone.fill(0); r.ext.fill(0); r.hard.fill(0); r.debris.fill(0); r.armor.fill(0);
  const water = (x0, x1, y0, y1, depth, cap, flow) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * r.cols + x; r.top[i] = wl - depth; r.cap[i] = wl - cap; r.zone[i] = 1; r.flow[i] = flow; r.kind[i] = KIND.sand; }
  };
  water(E.x0, E.x1, E.y0, E.y1, HARBOR.entranceDepth, HARBOR.entranceDepth - CONFIG.sediment.maxAbove, 0.45);
  water(B.x0, B.x1, B.y0, B.y1, HARBOR.startDepth, HARBOR.siltTo, 0.15);
  const rim = CONFIG.concrete.thickness; // Kaimauer: Landzellen am Wasser sind betoniert und rutschen nicht nach
  for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) {
    const i = y * r.cols + x; if (r.zone[i]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < r.cols && ny < r.rows && r.zone[ny * r.cols + nx]) { r.armor[i] = rim; break; } }
  }
  const cells = []; for (let y = B.y0; y <= B.y1; y++) for (let x = B.x0; x <= B.x1; x++) cells.push(y * r.cols + x);
  return { river: r, cells };
}
// Hafenkarte anlegen (ältere Spielstände mit geöffnetem Hafen bekommen sie nachträglich)
export function ensureHarbor(p, wl) { if (p.open && !p.harbor) p.harbor = createHarborRiver(wl); return p.harbor ?? null; }

// Tiefe, die 80 % des Beckens mindestens haben (m)
export function harborDepth(p, wl) {
  const h = p.harbor; if (!h) return null;
  const d = h.cells.map((i) => wl - h.river.top[i]).sort((a, b) => a - b);
  return d[Math.floor(d.length * 0.2)];
}
// Nimmt der Hafen diese Klasse an? Der Kai bestimmt, wie viele Klassen (Stufe 1: nur die einfachste), das Becken muss tief genug sein
export function harborAccepts(p, wl, kaiLevel, clsId) {
  const k = SHIPS.findIndex((s) => s.id === clsId); if (k < 0 || k >= HARBOR.kaiClasses[Math.max(0, kaiLevel - 1)]) return false;
  const d = harborDepth(p, wl); return d !== null && d >= HARBOR.need[clsId] - 0.02;
}
// Solltiefe für die Pontons im Becken: tief genug für die tiefste Klasse, die der Kai annimmt
export function harborTarget(kaiLevel, goal = null) {
  const k = HARBOR.kaiClasses[Math.max(0, kaiLevel - 1)];
  let cls = SHIPS.slice(0, k); const gi = goal ? cls.findIndex((s) => s.id === goal) : -1;
  if (gi >= 0) cls = cls.slice(0, gi + 1); // Ausbauziel: nur bis zu dieser Klasse baggern (ohne Vorgabe: tiefste Klasse, die der Kai annimmt)
  return Math.min(CONFIG.echolot.maxDepth, Math.max(...cls.map((s) => HARBOR.need[s.id])) + 0.1);
}
export const waitPos = (i) => ({ x: HARBOR.waitX[Math.min(i, HARBOR.waitX.length - 1)], y: HARBOR.waitY, angle: 0 });
// Liegeplatz i (Mitte des Schiffs, an der Nordkaimauer)
export const berthPos = (i) => ({ x: HARBOR.berthX[Math.min(i, HARBOR.berthX.length - 1)], y: HARBOR.basin.y0 + 1.1, angle: 0 });

// Ansicht der Hafenkarte: dasselbe Spiel, aber mit dem Flussbett des Hafens, den Pontons im Hafen und ohne Verkehr und Kreuzungen der Hauptkarte.
// Wird nur zum Zeichnen benutzt (die Simulation läuft unabhängig davon).
export function makeHarborView(g) {
  const h = g.port.harbor, v = Object.create(g);
  Object.defineProperties(v, {
    river: { value: h.river }, fair: { value: {} }, zones: { value: [] }, traffic: { value: { ships: [] } }, site: { value: null },
    fleet: { value: { units: g.fleet.units.filter((u) => (u.loc ?? 'main') === 'harbor'), areas: [] } },
    port: { value: Object.create(g.port, { bay: { value: null }, land: { value: { roads: [], halls: [], seq: 0 } } }) },
    isHarborView: { value: true },
  });
  return v;
}
