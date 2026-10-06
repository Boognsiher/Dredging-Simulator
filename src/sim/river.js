import { CONFIG, KIND, DEBRIS } from '../config.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Flusssohle als Raster (Zelle = cellArea m²). Der Fluss fliesst in x-Richtung (links nach rechts), y ist die Breite.
// - top:  Oberfläche der Sohle (m über dem Bezugshorizont; Wasserspiegel = wl, Tiefe = wl - top)
// - rock: Felsgrund. Sediment = top - rock, darunter nur noch Fels (nur mit Felsfräse sinnvoll abtragbar)
// - kind: Material der Sedimentschicht (KIND), - zone: 1 = Baggerkorridor, 0 = Land oder Naturschutzzone (Ufer, Flachwasser)
// Alle öffentlichen Mengen sind in m³.
export class River {
  constructor(cols, rows) {
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.area = CONFIG.layer.cellArea;
    this.wl = CONFIG.water.base;
    this.top = new Float32Array(n);
    this.rock = new Float32Array(n);
    this.cap = new Float32Array(n); // Höhe, bis zu der die Sohle wieder verlanden kann (0 = Land, keine Ablagerung)
    this.flow = new Float32Array(n); // 0..1, Strömung: in der Mitte schnell, am Rand langsam
    this.kind = new Uint8Array(n);
    this.hard = new Uint8Array(n); // 0 weich, 1 verdichtet, 2 hart (mehrere Überfahrten)
    this.debris = new Uint8Array(n); // 0 nichts, sonst Index in DEBRIS + 1
    this.zone = new Uint8Array(n);
    this.pending = new Set(); // Zellen, deren Böschung noch nachrutscht (abgeleitet, wird nicht gespeichert)
    this.slumpedTotal = 0; // m³ nachgerutscht (Anzeige)
  }

  static generate(rng, p = {}) {
    const cfg = { ...CONFIG.river, halfWidth: 6.8, depthMax: 2.4, rockDepth: 6.4, meander: 2.4, bars: [], ridges: [], shoals: 5, altlast: 2, hardBlobs: 3, debris: CONFIG.debris.count, ...p };
    const r = new River(cfg.cols, cfg.rows);
    const WL = r.wl;
    const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
    const each = (cx, cy, rx, ry, fn) => {
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(r.rows - 1, Math.ceil(cy + ry)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(r.cols - 1, Math.ceil(cx + rx)); x++) {
          const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
          if (d < 1) fn(r.idx(x, y), d);
        }
      }
    };
    const yc = (x) => r.rows / 2 + cfg.meander * Math.sin(x * 0.16 + ph[0]) + cfg.meander * 0.8 * Math.sin(x * 0.07 + ph[1]);
    const hw = (x) => cfg.halfWidth + 1.2 * Math.sin(x * 0.12 + ph[2]);
    r.centerY = (x) => yc(x); r.halfW = (x) => hw(x); // Hilfen für Anzeige und Tests
    const noise = (x, y) => Math.sin(x * 0.9 + y * 1.7) * Math.cos(x * 1.3 - y * 0.8);
    const water = new Uint8Array(r.cols * r.rows);
    for (let x = 0; x < r.cols; x++) {
      for (let y = 0; y < r.rows; y++) {
        const i = r.idx(x, y), rel = Math.abs(y + 0.5 - yc(x)) / hw(x);
        if (rel < 1) {
          water[i] = 1;
          const depth = Math.max(0.5, cfg.depthMax * (1 - rel ** 2.2) + 0.08 * noise(x, y));
          r.top[i] = WL - depth;
          r.flow[i] = clamp(1 - rel, 0, 1);
          r.zone[i] = rel < 0.82 ? 1 : 0;
          r.rock[i] = WL - (cfg.rockDepth + 0.8 * (1 - rel) + 0.25 * noise(y, x));
        } else {
          r.top[i] = Math.min(WL + 7, WL + 0.5 + (rel - 1) * 3.2 + 0.1 * noise(x, y));
          r.rock[i] = WL - 3; // Ufer: viel Sediment, rutscht nach, wenn man zu nah baggert
          r.flow[i] = 0;
        }
        const f = r.flow[i];
        r.kind[i] = !water[i] ? KIND.sand : f + 0.12 * noise(y, x) > 0.55 ? KIND.kies : f + 0.12 * noise(y, x) > 0.25 ? KIND.sand : KIND.schlick;
      }
    }
    // Barren: über die ganze Breite erhöhte Sohle, hier wird die Rinne zuerst eng
    for (const b of cfg.bars) {
      for (let x = Math.max(0, Math.floor(b.x - b.w)); x <= Math.min(r.cols - 1, Math.ceil(b.x + b.w)); x++) {
        const along = 1 - Math.abs(x + 0.5 - b.x) / b.w;
        if (along <= 0) continue;
        for (let y = 0; y < r.rows; y++) {
          const i = r.idx(x, y), rel = Math.abs(y + 0.5 - yc(x)) / hw(x);
          if (water[i]) r.top[i] += b.raise * Math.sqrt(along) * (1 - rel ** 4);
        }
      }
    }
    // Sandbänke am Rand und kleine Hügel in der Rinne
    for (let i = 0; i < cfg.shoals; i++) {
      const x = rng.range(2, r.cols - 2), y = yc(x) + rng.range(-1, 1) * hw(x) * 0.8;
      const a = rng.range(0.4, 1.0);
      each(x, y, rng.range(2.5, 4.5), rng.range(2, 3.5), (k, d) => { if (water[k]) r.top[k] += a * (1 - d * d); });
    }
    // Felsriegel: unter dieser Tiefe beginnt Fels
    for (const g of cfg.ridges) {
      for (let x = Math.max(0, Math.floor(g.x - g.w)); x <= Math.min(r.cols - 1, Math.ceil(g.x + g.w)); x++) {
        const along = clamp(1 - Math.abs(x + 0.5 - g.x) / g.w, 0, 1);
        if (along <= 0) continue;
        for (let y = 0; y < r.rows; y++) {
          const i = r.idx(x, y);
          if (!water[i]) continue;
          const wanted = WL - g.depth, blend = Math.min(1, along * 1.8);
          r.rock[i] = Math.max(r.rock[i], r.rock[i] + (wanted - r.rock[i]) * blend);
        }
      }
    }
    for (let k = 0; k < r.top.length; k++) {
      if (r.top[k] < r.rock[k]) r.top[k] = r.rock[k]; // Fels ragt heraus
      r.cap[k] = water[k] ? r.top[k] + CONFIG.sediment.maxAbove : 0;
    }
    // Altlasten (alte Industrie, Schlackenhalden), harte Schichten, Fremdstoffe
    for (let i = 0; i < cfg.altlast; i++) {
      const x = rng.range(3, r.cols - 3);
      each(x, yc(x) + rng.range(-0.6, 0.6) * hw(x), rng.range(1.8, 3), rng.range(1.5, 2.6), (k) => { if (water[k] && r.top[k] - r.rock[k] > 0.2) r.kind[k] = KIND.altlast; });
    }
    for (let i = 0; i < cfg.hardBlobs; i++) {
      const x = rng.range(2, r.cols - 2);
      each(x, yc(x) + rng.range(-0.7, 0.7) * hw(x), rng.range(2, 4), rng.range(1.5, 3), (k, d) => { if (water[k]) r.hard[k] = Math.max(r.hard[k], d < 0.5 ? 2 : 1); });
    }
    for (let n = 0, tries = 0; n < cfg.debris && tries < 2000; tries++) {
      const k = r.idx(rng.int(0, r.cols - 1), rng.int(0, r.rows - 1));
      if (water[k] && r.zone[k] && !r.debris[k] && r.top[k] - r.rock[k] > 0.3) { r.debris[k] = rng.int(1, DEBRIS.length - 1) + (rng.chance(0.07) ? 1 : 0); n++; }
    }
    for (let k = 0; k < r.top.length; k++) r.pending.add(k);
    for (let p = 0; p < 12; p++) r.settle(Infinity); // Anfangsböschungen setzen, ohne dass es im Spiel rutscht
    r.slumpedTotal = 0;
    return r;
  }

  idx(x, y) { return y * this.cols + x; }
  isWater(i) { return this.top[i] < this.wl - 0.05; }
  depthAt(i) { return this.wl - this.top[i]; }
  sedAt(i) { return Math.max(0, this.top[i] - this.rock[i]); }

  // Testhilfe: ebener Kanal (alles Korridor), Tiefe `depth`, Fels bei `rockDepth`
  setFlat(depth = 3, rockDepth = 8, kind = KIND.sand) {
    const WL = this.wl;
    this.top.fill(WL - depth); this.rock.fill(WL - rockDepth); this.cap.fill(WL - depth + CONFIG.sediment.maxAbove);
    this.zone.fill(1); this.flow.fill(0.7); this.kind.fill(kind); this.hard.fill(0); this.debris.fill(0);
    this.pending.clear();
    return this;
  }

  // Nachrutschen: zu steile Böschungen gleichen sich aus (Material wandert vom höheren zum tieferen Nachbarn).
  // Massenerhaltend. Verarbeitet höchstens `limit` Zellen pro Aufruf und gibt das bewegte Volumen (m³) zurück.
  settle(limit = CONFIG.layer.relaxPerTick) {
    if (!this.pending.size) return 0;
    const S = CONFIG.layer.slope, cols = this.cols, rows = this.rows;
    const batch = [];
    for (const i of this.pending) { batch.push(i); if (batch.length >= limit) break; }
    for (const i of batch) this.pending.delete(i);
    let moved = 0;
    for (const i of batch) {
      const x = i % cols, y = (i / cols) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        const hi = this.top[i] > this.top[j] ? i : j, lo = hi === i ? j : i, diff = this.top[hi] - this.top[lo];
        if (diff <= S + 1e-6) continue;
        const sed = this.top[hi] - this.rock[hi];
        if (sed <= 1e-6) continue; // Fels rutscht nicht
        const m = Math.min(sed, (diff - S) / 2);
        if (this.top[lo] - this.rock[lo] < 0.05) this.kind[lo] = this.kind[hi];
        this.top[hi] -= m; this.top[lo] += m; moved += m;
        this.pending.add(hi); this.pending.add(lo);
      }
    }
    const vol = moved * this.area;
    this.slumpedTotal += vol;
    return vol;
  }

  // Sedimentation: langsames Wasser lagert ab, die Sohle wächst bis zu `cap`. Schnelle Mitte verlandet kaum.
  deposit(dt, mult = 1) {
    const S = CONFIG.sediment, a = S.rate * dt * mult;
    for (let i = 0; i < this.top.length; i++) {
      if (this.cap[i] <= 0 || this.top[i] >= this.cap[i]) continue;
      const k = a * (1.1 - this.flow[i]) ** S.flowPower;
      if (this.top[i] - this.rock[i] < 0.05) this.kind[i] = KIND.schlick;
      this.top[i] = Math.min(this.cap[i], this.top[i] + k);
      this.pending.add(i);
    }
  }

  // Hochwasser bringt auf einen Schlag Schwebstoffe: am Rand mehr als in der Mitte
  flood(amount) {
    for (let i = 0; i < this.top.length; i++) {
      if (this.cap[i] <= 0) continue;
      this.top[i] = Math.min(this.cap[i] + 0.25, this.top[i] + amount * (1 - 0.5 * this.flow[i]));
      if (this.top[i] - this.rock[i] < 0.05) this.kind[i] = KIND.schlick;
      this.pending.add(i);
    }
  }

  // Gesamtes Sedimentvolumen im Baggerkorridor in m³ (Anzeige, Tests)
  corridorSediment() {
    let s = 0;
    for (let i = 0; i < this.top.length; i++) if (this.zone[i]) s += this.sedAt(i);
    return s * this.area;
  }

  // Zellen [index, gewicht] einer Spalte `cx` im Saugbereich um (headY, headH). Gesaugt wird nur Sohle unter Wasser.
  _profileCells(cx, headY, headH, radius) {
    const cells = [];
    const y0 = Math.max(0, Math.floor(headY - radius)), y1 = Math.min(this.rows - 1, Math.ceil(headY + radius));
    for (let y = y0; y <= y1; y++) {
      const i = this.idx(cx, y), s = this.top[i];
      if (s >= this.wl - 0.05) continue;
      const d = Math.hypot(y + 0.5 - headY, s - headH) / radius;
      if (d < 1) cells.push([i, 1 - d * d]);
    }
    return cells;
  }

  // Fels bekommt nur den Anteil `firmness` der Saugkraft: Zellen ohne Sediment zählen weniger
  _adj(cells, firmness) { return cells.map(([i, w]) => [i, this.top[i] - this.rock[i] > 1e-6 ? w : w * firmness]); }

  // Gewichtetes Abtragen: verteilt `amount` (Höhe in m) auf die Zellen. Liefert Höhen je Material (by) und Summen.
  _drain(cells, amount, firmness, adjusted = false) {
    if (!adjusted) cells = this._adj(cells, firmness);
    const res = { by: [0, 0, 0, 0, 0], zone: 0, out: 0, hard: 0, removed: 0, touched: [] };
    let wSum = 0;
    for (const c of cells) wSum += c[1];
    if (wSum === 0) return res;
    amount *= Math.min(1, wSum / CONFIG.pump.fullDraw); // im freien Wasser über dem Boden ist die Saugkraft schwach
    for (const [i, w] of cells) {
      const sed = this.top[i] - this.rock[i];
      let eff = 1 / (1 + this.hard[i] * CONFIG.hard.factor);
      if (sed <= 1e-6) eff *= firmness;
      let take = ((amount * w) / wSum) * eff;
      if (sed > 1e-6) take = Math.min(take, sed); // erst das Sediment, dann (im nächsten Schritt) der Fels darunter
      if (take <= 0) continue;
      const fromSed = Math.min(take, Math.max(0, sed)), fromRock = take - fromSed;
      this.top[i] -= take;
      if (fromRock > 0) this.rock[i] -= fromRock; // der Fels wird abgetragen, die Sohle sinkt mit
      const left = this.top[i] - this.rock[i];
      let snap = 0;
      if (fromRock === 0 && left > 0 && left < CONFIG.layer.snap) { snap = left; this.top[i] -= snap; } // winziger Rest gilt als erledigt
      res.by[this.kind[i]] += fromSed + snap; res.by[KIND.fels] += fromRock;
      take += snap;
      res.removed += take;
      if (this.zone[i]) res.zone += take; else res.out += take;
      if (this.hard[i]) res.hard += fromSed;
      if (this.top[i] - this.rock[i] <= 1e-6) this.hard[i] = 0;
      res.touched.push(i);
    }
    for (const i of res.touched) this.pending.add(i);
    return res;
  }

  _vol(r) {
    const a = this.area;
    return { removed: r.removed * a, by: r.by.map((v) => v * a), zone: r.zone * a, out: r.out * a, hard: r.hard * a };
  }

  // Querschnitt: Der Kasten umfasst die Spalten `cols` (Flussrichtung); die Pumpenleistung verteilt sich nach Bedarf auf alle
  // Spalten, in denen an der Einsaugstelle etwas zu holen ist. Die Einsaugstelle folgt dem Gelände jeder Spalte
  // (gleicher Abstand zur lokalen Oberfläche wie in der Mittelspalte). amount in m³.
  suckSwath(cols, centerCol, headY, headH, radius, amount, firmness = CONFIG_BASE_FIRMNESS) {
    const my = clamp(Math.floor(headY), 0, this.rows - 1), base = this.top[this.idx(centerCol, my)];
    const work = cols.map((c) => this._adj(this._profileCells(c, headY, Math.max(0, headH + (this.top[this.idx(c, my)] - base)), radius), firmness)).filter((cells) => cells.length);
    const rowW = work.map((cells) => cells.reduce((a, c) => a + c[1], 0)), total = rowW.reduce((a, b) => a + b, 0);
    const sum = { removed: 0, by: [0, 0, 0, 0, 0], zone: 0, out: 0, hard: 0 };
    for (let k = 0; k < work.length; k++) {
      const res = this._vol(this._drain(work[k], (amount * rowW[k]) / total / this.area, firmness, true));
      sum.removed += res.removed; sum.zone += res.zone; sum.out += res.out; sum.hard += res.hard;
      for (let m = 0; m < 5; m++) sum.by[m] += res.by[m];
    }
    return sum;
  }

  // Hüllkurven der Spalten `cols` über die Querschnittsfenster-Zellen y0..y0+n-1: höchster Punkt (= die engste Stelle für Schiffe) und tiefster
  envelope(cols, y0, n) {
    const hi = new Float32Array(n), lo = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let mx = -Infinity, mn = Infinity;
      for (const c of cols) { const t = this.top[this.idx(c, y0 + k)]; if (t > mx) mx = t; if (t < mn) mn = t; }
      hi[k] = mx; lo[k] = mn;
    }
    return { hi, lo };
  }
}

const CONFIG_BASE_FIRMNESS = 0.04;
