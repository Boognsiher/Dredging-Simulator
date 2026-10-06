import { CONFIG, SHIPS, KIND } from '../config.js';

// Fahrrinnen-Analyse: Für jede Schiffsklasse wird die günstigste Rinne von links nach rechts gesucht (Dijkstra über die Zellen).
// Eine Rinnenposition (x, y) deckt `beam` Zellen quer zum Fluss ab; jede davon muss im Baggerkorridor liegen und genug Wasser
// haben (Tiefgang + Kielfreiheit). Kosten = fehlende Tiefe (m·Zellen, Fels zählt mehr), damit die Suche an den Schwachstellen baggert.
// Ergebnis je Klasse: passable (Rinne ohne Baggern), volume (m³ bis zur Passierbarkeit), twoWay (zwei getrennte Rinnen: Gegenverkehr),
// path (geglättete Mittellinie in Zellkoordinaten, zum Fahren und Zeichnen), weakest (engste Stelle: Spalte, die am meisten fehlt).
const EPS = 0.06; // m: so viel darf die Sohle über der nötigen Tiefe liegen (Verlandung im Zentimeterbereich sperrt die Rinne nicht)
const INF = Infinity;

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop() {
    const k = this.k, v = this.v, top = [k[0], v[0]], lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m;
      }
    }
    return top;
  }
}

export const needDepth = (cls) => cls.draught + CONFIG.clearance; // Tiefe für volle Ladung
export const minNeedDepth = (cls) => needDepth(cls) - CONFIG.partialDepth; // darunter fährt das Schiff nicht mehr (Mindestladung)
const lanes = (beam) => { const lo = Math.floor((beam - 1) / 2); return { lo, hi: beam - 1 - lo }; };

// Fehlende Tiefe je Zelle (m) für Klasse cls; Zellen ausserhalb des Korridors sind gesperrt (-1)
function deficits(river, wl, need) {
  const def = new Float32Array(river.cols * river.rows), needTop = wl - need;
  for (let i = 0; i < def.length; i++) {
    if (!river.zone[i]) { def[i] = -1; continue; }
    const miss = river.top[i] - needTop - EPS; // wie viel Sohle noch zu hoch liegt
    if (miss <= 0) { def[i] = 0; continue; }
    const rockMiss = Math.max(0, river.rock[i] - needTop); // davon steckt im Fels
    def[i] = miss + rockMiss * 2;
  }
  return def;
}

// Günstigste Rinne; blocked = Zellen, die nicht benutzt werden dürfen (zweite Rinne neben der ersten)
function bestPath(river, def, beam, flow, blocked) {
  const { cols, rows } = river, { lo, hi } = lanes(beam);
  const n = cols * rows, cost = new Float32Array(n).fill(INF);
  for (let x = 0; x < cols; x++) {
    for (let y = lo; y < rows - hi; y++) {
      let s = 0, f = 0, ok = true;
      for (let k = y - lo; k <= y + hi; k++) {
        const i = k * cols + x;
        if (def[i] < 0 || (blocked && blocked[i])) { ok = false; break; }
        s += def[i]; f += flow[i];
      }
      if (ok) cost[y * cols + x] = s * 10 + 0.05 + 0.12 * (1 - f / beam);
    }
  }
  const dist = new Float64Array(n).fill(INF), prev = new Int32Array(n).fill(-1), heap = new Heap();
  for (let y = 0; y < rows; y++) { const i = y * cols; if (cost[i] < INF) { dist[i] = cost[i]; heap.push(dist[i], i); } }
  let goal = -1;
  while (heap.size) {
    const [d, i] = heap.pop();
    if (d > dist[i]) continue;
    const x = i % cols, y = (i / cols) | 0;
    if (x === cols - 1) { goal = i; break; }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (cost[j] === INF) continue;
        const nd = d + cost[j] * (dx && dy ? 1.2 : 1);
        if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(nd, j); }
      }
    }
  }
  if (goal < 0) return null;
  const nodes = [];
  for (let i = goal; i >= 0; i = prev[i]) nodes.push({ x: i % cols, y: (i / cols) | 0 });
  return nodes.reverse();
}

// Alle Zellen, die die Rinne belegt (Fenster entlang des Weges), als Menge
function covered(river, nodes, beam, margin = 0) {
  const { lo, hi } = lanes(beam), set = new Set();
  for (const p of nodes) for (let k = p.y - lo - margin; k <= p.y + hi + margin; k++) if (k >= 0 && k < river.rows) set.add(k * river.cols + p.x);
  return set;
}

// Mittellinie glätten und über den Kartenrand verlängern, damit Schiffe von ausserhalb ein- und ausfahren.
// Die geglättete Linie bleibt so nah an der Rinne, dass der Rumpf (beam - 1 Zellen) im geprüften Fenster der Rinnenzelle liegt:
// sonst würden Schiffe über Zellen fahren, die nie auf Tiefe geprüft wurden.
function smoothPath(river, nodes, beam) {
  const { lo, hi } = lanes(beam), off = (hi - lo) / 2 + 0.5, n = Math.max(1, beam - 1);
  const pts = nodes.map((p) => ({ x: p.x + 0.5, y: p.y + off }));
  const out = pts.map((p, i) => {
    let sx = 0, sy = 0, c = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(pts.length - 1, i + 3); k++) { sx += pts[k].x; sy += pts[k].y; c++; }
    const node = nodes[i], yMin = node.y - lo + n / 2, yMax = node.y + hi + 1 - n / 2;
    return { x: sx / c, y: Math.min(yMax, Math.max(yMin, sy / c)) };
  });
  out.unshift({ x: -2.5, y: out[0].y }); out.push({ x: river.cols + 2.5, y: out[out.length - 1].y });
  let len = 0;
  out[0].s = 0;
  for (let i = 1; i < out.length; i++) { len += Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y); out[i].s = len; }
  return { points: out, length: len };
}

// Spalten, in denen zwei Rinnen nebeneinander Platz haben (Tiefe stimmt, im Korridor, Breite für zwei Schiffe plus Abstand): dort können sich Schiffe kreuzen
export function crossColumns(river, def, beam) {
  const out = new Uint8Array(river.cols);
  for (let x = 0; x < river.cols; x++) {
    let lanes = 0, run = 0;
    for (let y = 0; y <= river.rows; y++) {
      const ok = y < river.rows && def[y * river.cols + x] === 0;
      if (ok) run++;
      else { lanes += Math.floor((run + 1) / (beam + 1)); run = 0; }
    }
    out[x] = lanes >= 2 ? 1 : 0;
  }
  return out;
}

// Planung einer Kreuzungsstelle (Mitte xc, drei Spalten) für eine Klasse: in jeder Spalte müssen zwei getrennte Rinnen (je beam Zeilen, eine Zeile Abstand)
// tief genug sein. Berechnet je Spalte die günstigsten zwei Fenster und das fehlende Volumen (m³). Zellen im Ausbaustreifen (Land, Flachwasser) zählen mit,
// sie müssen dafür abgetragen werden; Zellen ausserhalb davon sperren. volume = Infinity, wenn auch so kein Platz ist.
export function zonePlan(river, wl, cls, xc, w = 3) {
  const needTop = wl - needDepth(cls) + EPS, beam = cls.beam, rows = river.rows, wins = [];
  let volume = 0, land = false, rock = false, armor = false;
  for (let x = xc - Math.floor(w / 2); x <= xc + Math.floor(w / 2); x++) {
    if (x < 0 || x >= river.cols) return { volume: Infinity, wins: null };
    const c = new Array(rows);
    for (let y = 0; y < rows; y++) {
      const i = y * river.cols + x;
      c[y] = river.zone[i] ? Math.max(0, river.top[i] - needTop) : river.ext[i] ? Math.max(0.05, river.top[i] - needTop) : Infinity;
    }
    const wc = [];
    for (let a = 0; a + beam <= rows; a++) { let t = 0; for (let k = a; k < a + beam; k++) t += c[k]; wc.push(t); }
    let best = Infinity, ba = -1, bb = -1;
    for (let a = 0; a < wc.length; a++) for (let b = a + beam + 1; b < wc.length; b++) if (wc[a] + wc[b] < best) { best = wc[a] + wc[b]; ba = a; bb = b; }
    if (best === Infinity) return { volume: Infinity, wins: null };
    volume += best * river.area;
    wins.push({ x, a: ba, b: bb });
    for (const a of [ba, bb]) for (let k = a; k < a + beam; k++) {
      const i = k * river.cols + x;
      if (!river.zone[i]) land = true;
      if (river.top[i] > needTop) { if (river.rock[i] > needTop) rock = true; if (river.armor[i] > 0) armor = true; }
    }
  }
  return { volume, wins, land, rock, armor, needTop, beam };
}

export function analyzeClass(river, wl, cls) {
  const full = needDepth(cls), minN = minNeedDepth(cls), def = deficits(river, wl, minN), beam = cls.beam;
  const nodes = bestPath(river, def, beam, river.flow, null);
  const res = { id: cls.id, need: minN, minNeed: minN, fullNeed: full, loadFrac: 0, loadFactor: 0, fullVolume: INF, beam, passable: false, twoWay: false, def, volume: INF, path: null, length: 0, weakest: null, cross: crossColumns(river, def, beam) };
  if (!nodes) return res; // Baggerkorridor ist zu schmal für dieses Schiff
  const cov = covered(river, nodes, beam);
  let miss = 0, worst = 0, worstX = nodes[0].x, altlast = 0;
  const perCol = new Map();
  for (const i of cov) { const m = def[i]; miss += m; if (m > 0 && river.kind[i] === KIND.altlast) altlast += Math.min(m, river.top[i] - river.rock[i]) * river.area; if (m > 0) perCol.set(i % river.cols, (perCol.get(i % river.cols) ?? 0) + m); }
  for (const [x, m] of perCol) if (m > worst) { worst = m; worstX = x; }
  res.volume = miss * river.area; res.altlast = altlast; // davon Altlast (m³); bis passable: fehlende Menge für die Mindesttiefe
  res.passable = miss <= 1e-6;
  if (res.passable) { // Stufe 2: Teilbeladung. Wie tief ist die Rinne wirklich, und was fehlt noch für volle Ladung?
    const def2 = deficits(river, wl, full); let m2 = 0, minAvail = INF;
    for (const i of cov) { m2 += def2[i]; minAvail = Math.min(minAvail, wl - river.top[i]); }
    res.need = full; res.fullVolume = m2 * river.area; res.volume = res.fullVolume; // nächstes Ziel: volle Tiefe
    res.loadFrac = Math.min(1, Math.max(0, (minAvail - minN) / (full - minN)));
    res.loadFactor = CONFIG.minLoad + (1 - CONFIG.minLoad) * res.loadFrac;
  }
  const sp = smoothPath(river, nodes, beam);
  res.path = sp; res.length = sp.length; res.nodes = nodes;
  res.weakest = worst > 0 ? { x: worstX, miss: worst } : null;
  if (res.passable) { // zweite, getrennte Rinne daneben: Gegenverkehr ohne Wartezeit
    const blocked = new Uint8Array(river.cols * river.rows);
    for (const i of covered(river, nodes, beam, 1)) blocked[i] = 1;
    const second = bestPath(river, def, beam, river.flow, blocked);
    if (second) {
      let m2 = 0;
      for (const i of covered(river, second, beam)) m2 += def[i];
      res.twoWay = m2 <= 1e-6;
    }
  }
  return res;
}

export function analyzeFairway(river, wl) {
  const out = {};
  for (const cls of SHIPS) out[cls.id] = analyzeClass(river, wl, cls);
  return out;
}

// Geringste Wassertiefe (m) unter dem Rumpf eines Schiffs der Breite beam bei (x, yMid). Der Rumpf ist schmaler als die Rinnenbreite
// (beam - 1 Zellen um die Mittellinie): die geglättete Fahrlinie weicht an Kurven etwas von der Rinnenzelle ab
export function minDepthAt(river, wl, x, yMid, beam) {
  const cx = Math.min(river.cols - 1, Math.max(0, Math.floor(x))), n = Math.max(1, beam - 1);
  const y0 = Math.floor(yMid - n / 2 + 0.5);
  let m = INF;
  for (let k = 0; k < n; k++) {
    const y = Math.min(river.rows - 1, Math.max(0, y0 + k));
    m = Math.min(m, wl - river.top[y * river.cols + cx]);
  }
  return m;
}

// Punkt auf dem Pfad bei Strecke s (Richtung + / -), mit Fahrtrichtung als Winkel
export function pointOnPath(path, s) {
  const pts = path.points, total = path.length;
  s = Math.max(0, Math.min(total, s));
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].s <= s) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

// Mindestrinne ausheben (Spielstart): hebt die günstigste Rinne der Klasse genau auf die nötige Tiefe aus, damit die kleinste Klasse von Anfang an fahren kann
export function carveFairway(river, wl, cls, margin = 0.15) {
  const res = analyzeClass(river, wl, cls);
  if (!res.nodes) return res;
  const needTop = wl - minNeedDepth(cls) - margin, { lo, hi } = lanes(cls.beam); // Start: auf Mindesttiefe, das Schiff fährt mit Teilladung
  for (const p of res.nodes) {
    for (let k = p.y - lo; k <= p.y + hi; k++) {
      const i = k * river.cols + p.x;
      if (river.zone[i] && river.top[i] > needTop && river.rock[i] <= needTop) river.top[i] = needTop;
      river.pending.add(i);
    }
  }
  return analyzeClass(river, wl, cls);
}
