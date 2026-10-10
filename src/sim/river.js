import { CONFIG, KIND, DEBRIS, DEPOSITS } from '../config.js';

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
    this.trasse = [null, null]; // vom Spieler festgelegte Rinnenlinien: [Hauptrinne, 2. Rinne], je Liste von {x, y} (Zellkoordinaten)
    this.wl = CONFIG.water.base;
    this.top = new Float32Array(n);
    this.rock = new Float32Array(n);
    this.cap = new Float32Array(n); // Höhe, bis zu der die Sohle wieder verlanden kann (0 = Land, keine Ablagerung)
    this.flow = new Float32Array(n); // 0..1, Strömung: in der Mitte schnell, am Rand langsam
    this.kind = new Uint8Array(n);
    this.hard = new Uint8Array(n); // 0 weich, 1 verdichtet, 2 hart (mehrere Überfahrten)
    this.debris = new Uint8Array(n); // 0 nichts, sonst Index in DEBRIS + 1
    this.zone = new Uint8Array(n);
    this.bay = new Uint8Array(n); // Hafenbecken (zählt als Korridor zum Baggern, aber nicht zur Fahrrinne der Schiffe)
    this.dep = new Uint8Array(n); // Rohstoffvorkommen: 0 = keins, sonst Nummer in this.deposits
    this.depLeft = new Float32Array(n); // wie viele Meter des Vorkommens (von oben) in dieser Zelle noch Aufschlag bringen
    this.pile = new Uint8Array(n); // Pfahlwand: 1 = Betonpfahl (fest, wird nicht abgetragen, hält die Böschung)
    this.lim = new Float32Array(n).fill(-99); // tiefste erlaubte Höhe der Sohle (Abtragsperre zwischen Pfahlwand und Ufer: nicht tiefer als Oberkante Beton)
    this.tribs = []; // Zuflüsse: { x, side, my, cells: [Zellen], w: [Gewichte], kind, rate }: bringen laufend Sand/Kies in die Rinne
    this.deposits = []; // { id, type, name, kind, mult, cx, cy, rx, ry, owned, known, cost }
    this.armor = new Float32Array(n); // Dicke der Betonschicht (m), die die Oberfläche der Zelle verhärtet; 0 = unbehandelt
    this.ext = new Uint8Array(n); // Ausbaustreifen am Ufer: 1 = Land, 2 = Flachwasser. Mit dem Löffelbagger abtragbar (wird dann zum Korridor), sonst Schutzgebiet
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
          r.ext[i] = rel >= 0.82 ? 2 : 0; // Flachwasser am Ufer: Schutzzone für den Saugbagger, mit dem Löffel als Ausbaustreifen abtragbar
          r.rock[i] = WL - (cfg.rockDepth + 0.8 * (1 - rel) + 0.25 * noise(y, x));
        } else {
          r.top[i] = Math.min(WL + 7, WL + 0.4 + (rel - 1) * (rel < 1.9 ? 2.0 : 6) + 0.1 * noise(x, y)); // flaches Ufer im Ausbaustreifen, dahinter steiler
          r.rock[i] = WL - 3; // Ufer: viel Sediment, rutscht nach, wenn man zu nah baggert
          r.flow[i] = 0;
          r.ext[i] = rel < 1.9 ? 1 : 0;
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
    // Rohstoffvorkommen: das erste (Kiesbank) liegt früh am Fluss, ist bekannt und freigegeben; die weiteren müssen erkundet und erworben werden
    (cfg.deposits ?? []).forEach((typeId, k) => {
      const T = DEPOSITS.find((d) => d.id === typeId) ?? DEPOSITS[0];
      const x = k === 0 ? rng.range(7, 12) : rng.range(8 + k * 7, 14 + k * 7), y = yc(x) + rng.range(-0.35, 0.35) * hw(x);
      const rx = rng.range(3, 4.2) * (T.big ? 1.6 : 1), ry = rng.range(2.2, 3.2) * (T.big ? 1.4 : 1);
      each(Math.min(r.cols - 4, x), y, rx, ry, (i) => { if (water[i] && r.zone[i] && r.top[i] - r.rock[i] > 0.6) { r.dep[i] = k + 1; r.kind[i] = T.kind; r.depLeft[i] = Math.min(r.top[i] - r.rock[i], rng.range(0.9, 1.5)); } });
      r.deposits.push({ id: k + 1, type: T.id, name: T.name, kind: T.kind, mult: T.mult, cx: Math.min(r.cols - 4, x), cy: y, rx, ry, owned: k === 0, known: k === 0, cost: T.cost, regen: T.regen ?? 0 });
    });
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
    // Zuflüsse (nur wenn die Karte welche hat): am Ufer mündende Bäche, die täglich Sand und Kies in die Rinne tragen; sie als Letztes erzeugen, damit bestehende Flüsse unverändert bleiben
    for (let n = 0; n < (cfg.tribs ?? 0); n++) {
      let x = rng.int(9, r.cols - 12); const side = rng.chance(0.5) ? -1 : 1;
      const bx = Math.round(r.cols * 0.62) - 1; if (x >= bx - 4 && x <= bx + 7) x = 9 + (x % 8); // nicht in den Hafenbereich (Einfahrt) münden
      const spot = r.tribSpot(x, side, water); if (!spot) continue;
      r.tribs.push({ x, side, ...spot, kind: rng.chance(0.5) ? KIND.kies : KIND.sand, rate: cfg.tribRate ?? 0.008 });
    }
    return r;
  }

  idx(x, y) { return y * this.cols + x; }
  isWater(i) { return this.top[i] < this.wl - 0.05; }
  // Mündungsstelle eines Baches an Spalte x und Seite side: erste Zone-Zelle vom Rand her und die Zellen des Schwemmfächers (null, wenn die Spalte keine Rinne hat)
  tribSpot(x, side, water = null) {
    const isW = (i) => (water ? water[i] : this.isWater(i));
    let my = -1; for (let k = 0; k < this.rows; k++) { const y = side < 0 ? k : this.rows - 1 - k; if (this.zone[y * this.cols + x]) { my = y; break; } }
    if (my < 0) return null;
    const cx = x + 2.2, cy = my - side * 1.6, rx = 5, ry = 3.4, cells = [], w = [];
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(this.rows - 1, Math.ceil(cy + ry)); y++) for (let xx = Math.max(0, Math.floor(cx - rx)); xx <= Math.min(this.cols - 1, Math.ceil(cx + rx)); xx++) {
      const i = y * this.cols + xx, d = Math.hypot((xx + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      if (d < 1 && this.zone[i] && isW(i)) { cells.push(i); w.push(+(1 - d).toFixed(2)); }
    }
    return { my, cells, w };
  }
  // Bäche, die im Hafenbereich (Einfahrt) münden würden, an eine freie Stelle versetzen; findet sich keine, entfällt der Bach
  moveTribsFromBay(bay) {
    if (!bay?.cells?.length || !this.tribs?.length) return 0;
    const near = (t) => t.side === bay.side && t.x >= bay.x0 - 5 && t.x <= bay.x1 + 4;
    let moved = 0;
    for (const t of this.tribs) {
      if (!near(t)) continue;
      let best = null;
      for (let x = 9; x <= this.cols - 12; x++) {
        if (x >= bay.x0 - 5 && x <= bay.x1 + 4) continue;
        if (this.tribs.some((o) => o !== t && Math.abs(o.x - x) < 5 && o.side === t.side)) continue;
        const sp = this.tribSpot(x, t.side); if (!sp) continue;
        const dist = Math.abs(x - t.x); if (!best || dist < best.dist) best = { x, dist, sp };
      }
      if (best) { Object.assign(t, { x: best.x, ...best.sp }); moved++; } else t.dead = true;
    }
    this.tribs = this.tribs.filter((t) => !t.dead);
    return moved;
  }
  depthAt(i) { return this.wl - this.top[i]; }
  sedAt(i) { return Math.max(0, this.top[i] - this.rock[i]); }

  // Testhilfe: ebener Kanal (alles Korridor), Tiefe `depth`, Fels bei `rockDepth`
  setFlat(depth = 3, rockDepth = 8, kind = KIND.sand) {
    const WL = this.wl;
    this.top.fill(WL - depth); this.rock.fill(WL - rockDepth); this.cap.fill(WL - depth + CONFIG.sediment.maxAbove);
    this.zone.fill(1); this.bay.fill(0); this.flow.fill(0.7); this.kind.fill(kind); this.hard.fill(0); this.debris.fill(0);
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
        if (diff <= S + 1e-6 || this.armor[hi] > 0 || this.armor[lo] > 0 || this.bay[hi] || this.bay[lo] || this.pile[hi] || this.pile[lo]) continue; // Beton und die Spundwände des Hafenbeckens halten die Böschung
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
      const k = a * (1.1 - this.flow[i]) ** S.flowPower * (this.armor[i] > 0 ? CONFIG.concrete.depositFactor : 1) * (this.bay[i] ? 0.25 : 1); // Hafenbecken verlandet langsam
      if (this.top[i] - this.rock[i] < 0.05) this.kind[i] = KIND.schlick;
      this.top[i] = Math.min(this.cap[i], this.top[i] + k);
      this.pending.add(i);
    }
  }

  // Zuflüsse tragen laufend Sand/Kies ein (auch über die normale Obergrenze hinaus), bis zu 0,8 m über der Ausgangssohle
  tribDeposit(dt) {
    for (const t of this.tribs ?? []) {
      for (let k = 0; k < t.cells.length; k++) {
        const i = t.cells[k]; if (this.cap[i] <= 0 || this.armor[i] > 0 || this.bay[i]) continue;
        const lim = Math.min(this.wl - 0.6, this.cap[i] + 0.8);
        if (this.top[i] >= lim) continue;
        this.top[i] = Math.min(lim, this.top[i] + t.rate * t.w[k] * dt);
        if (this.kind[i] !== KIND.altlast) this.kind[i] = t.kind;
        this.pending.add(i);
      }
    }
  }

  // Hochwasser bringt auf einen Schlag Schwebstoffe: am Rand mehr als in der Mitte
  flood(amount) {
    for (let i = 0; i < this.top.length; i++) {
      if (this.cap[i] <= 0) continue;
      this.top[i] = Math.min(this.cap[i] + 0.25, this.top[i] + amount * (1 - 0.5 * this.flow[i]) * (this.armor[i] > 0 ? CONFIG.concrete.depositFactor : 1));
      if (this.top[i] - this.rock[i] < 0.05) this.kind[i] = KIND.schlick;
      this.pending.add(i);
    }
  }

  // Leeres Vorkommen verschwindet (Markierung und Zellen); die Nummer bleibt vergeben, weil Vorkommen über ihren Index gefunden werden
  retireDeposit(id) {
    const d = this.deposits[id - 1]; if (!d || d.depleted) return false;
    for (let i = 0; i < this.dep.length; i++) if (this.dep[i] === id) { this.dep[i] = 0; this.depLeft[i] = 0; }
    d.depleted = true; d.owned = false;
    return true;
  }
  // Neues Vorkommen mit dicker Sedimentschicht im Baggerkorridor (bekannt, Konzession kostet); null, wenn keine passende Stelle gefunden wird
  spawnDeposit(rng, T) {
    if (this.deposits.length >= 250) return null;
    for (let tries = 0; tries < 14; tries++) {
      const x = Math.floor(rng.range(6, this.cols - 6)), y = this.centerY(x) + rng.range(-0.3, 0.3) * this.halfW(x), rx = rng.range(3, 4.2) * (T.big ? 1.6 : 1), ry = rng.range(2.2, 3.2) * (T.big ? 1.4 : 1), cells = [];
      for (let yy = Math.max(0, Math.floor(y - ry)); yy <= Math.min(this.rows - 1, Math.ceil(y + ry)); yy++) for (let xx = Math.max(0, Math.floor(x - rx)); xx <= Math.min(this.cols - 1, Math.ceil(x + rx)); xx++) {
        const i = yy * this.cols + xx;
        if (((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2 <= 1 && this.zone[i] && !this.bay[i] && !this.dep[i] && this.kind[i] !== 3 && this.top[i] - this.rock[i] > 0.6) cells.push(i);
      }
      if (cells.length < 8) continue;
      const id = this.deposits.length + 1;
      for (const i of cells) { this.dep[i] = id; this.kind[i] = T.kind; this.depLeft[i] = Math.min(this.top[i] - this.rock[i], rng.range(0.9, 1.5)); }
      const d = { id, type: T.id, name: T.name, kind: T.kind, mult: T.mult, cx: x, cy: y, rx, ry, owned: false, known: true, cost: T.cost, regen: T.regen ?? 0 };
      this.deposits.push(d); return d;
    }
    return null;
  }

  // Pfahlwand: Pfähle sind feste Zellen mit Oberkante `pileTop` unter dem Wasserspiegel. In jeder Spalte mit Pfahl ist die Sohle zwischen Pfahl und Ufer
  // gesichert: sie rutscht nicht nach und darf nicht tiefer als die Oberkante abgetragen werden. Spalten ohne Pfahl bleiben unverändert (Teilstrecken möglich).
  setPile(i, on, pileTop = 0.5) {
    if (on) { this.pile[i] = 1; this.top[i] = Math.max(this.top[i], this.wl - pileTop); this.rock[i] = Math.min(this.rock[i], this.top[i]); this.cap[i] = this.top[i]; this.armor[i] = 0; }
    else { this.pile[i] = 0; this.cap[i] = this.top[i] + CONFIG.sediment.maxAbove; } // Rückbau: die Zelle ist wieder normales Flachwasser
    this.updateLims(pileTop);
  }
  updateLims(pileTop = 0.5) {
    this.lim.fill(-99);
    for (let i = 0; i < this.pile.length; i++) {
      if (!this.pile[i]) continue;
      const x = i % this.cols, y = (i / this.cols) | 0, side = y < this.centerY(x) ? -1 : 1, lim = this.wl - pileTop;
      for (let yy = y + side; yy >= 0 && yy < this.rows; yy += side) { // vom Pfahl zum Ufer, bis ein weiterer Pfahl oder das Kartenende kommt
        const j = yy * this.cols + x; if (this.pile[j]) break;
        this.lim[j] = Math.max(this.lim[j], lim); this.pending.add(j);
      }
    }
  }
  // Restmenge (m³) eines Vorkommens
  depositRemaining(id) {
    let v = 0;
    for (let i = 0; i < this.dep.length; i++) if (this.dep[i] === id) v += Math.min(this.sedAt(i), this.depLeft[i]);
    return v * this.area;
  }

  // Altlasten-Kataster: Zellen und Volumen (m³) belasteten Sediments, gesamt und im Baggerkorridor
  altlastSummary() {
    let cells = 0, all = 0, corridor = 0;
    for (let i = 0; i < this.top.length; i++) {
      if (this.kind[i] !== KIND.altlast) continue;
      const sed = this.sedAt(i);
      if (sed <= 0.05) continue;
      cells++; all += sed; if (this.zone[i]) corridor += sed;
    }
    return { cells, volume: all * this.area, corridor: corridor * this.area };
  }

  // Verschmutzung rund um (cx, cy) (Zellkoordinaten, Radius in Zellen): Sediment wird zur Altlast. raise > 0: im Kern (Wrack) wächst die Sohle um raise Meter, hart.
  contaminate(cx, cy, radius, raise = 0) {
    let n = 0;
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(this.rows - 1, Math.ceil(cy + radius)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(this.cols - 1, Math.ceil(cx + radius)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius, i = this.idx(x, y);
        if (d >= 1 || !this.isWater(i)) continue;
        if (this.sedAt(i) < 0.3) this.top[i] = this.rock[i] + 0.3;
        this.kind[i] = KIND.altlast; this.hard[i] = Math.max(this.hard[i], 1); this.armor[i] = 0;
        if (raise > 0 && d < 0.55) { this.top[i] += raise; this.hard[i] = 2; }
        this.pending.add(i); n++;
      }
    }
    return n;
  }

  // Gesamtes Sedimentvolumen im Baggerkorridor in m³ (Anzeige, Tests)
  corridorSediment() {
    let s = 0;
    for (let i = 0; i < this.top.length; i++) if (this.zone[i]) s += this.sedAt(i);
    return s * this.area;
  }

  // Zellen [index, gewicht] einer Spalte `cx` im Saugbereich um (headY, headH). Gesaugt wird nur Sohle unter Wasser.
  _profileCells(cx, headY, headH, radius, allowLand = false) {
    const cells = [];
    const y0 = Math.max(0, Math.floor(headY - radius)), y1 = Math.min(this.rows - 1, Math.ceil(headY + radius));
    for (let y = y0; y <= y1; y++) {
      const i = this.idx(cx, y), s = this.top[i];
      if (s >= this.wl - 0.05 && !(allowLand && s - this.rock[i] > 1e-6)) continue;
      const d = Math.hypot(y + 0.5 - headY, s - headH) / radius;
      if (d < 1) cells.push([i, 1 - d * d]);
    }
    return cells;
  }

  // Fels bekommt nur den Anteil `firmness` der Saugkraft: Zellen ohne Sediment zählen weniger
  _adj(cells, firmness) { return cells.map(([i, w]) => [i, this.top[i] - this.rock[i] > 1e-6 ? w : w * firmness]); }

  // Gewichtetes Abtragen: verteilt `amount` (Höhe in m) auf die Zellen. Liefert Höhen je Material (by) und Summen.
  _drain(cells, amount, firmness, adjusted = false, hardFactor = CONFIG.hard.factor, allowLand = false, armorEff = CONFIG.concrete.pumpBreak) {
    if (!adjusted) cells = this._adj(cells, firmness);
    const res = { by: [0, 0, 0, 0, 0], zone: 0, out: 0, land: 0, hard: 0, removed: 0, touched: [], dep: {} };
    let wSum = 0;
    for (const c of cells) wSum += c[1];
    if (wSum === 0) return res;
    amount *= Math.min(1, wSum / CONFIG.pump.fullDraw); // im freien Wasser über dem Boden ist die Saugkraft schwach
    for (const [i, w] of cells) {
      if (this.pile[i]) continue; // Pfähle sind fest
      const sed = this.top[i] - this.rock[i];
      let eff = 1 / (1 + this.hard[i] * hardFactor);
      if (sed <= 1e-6) eff *= firmness;
      const armor = this.armor[i];
      if (armor > 1e-6) eff *= armorEff; // Beton muss erst aufgebrochen werden
      let take = ((amount * w) / wSum) * eff;
      if (sed > 1e-6) take = Math.min(take, sed);
      if (this.lim[i] > -90) take = Math.min(take, Math.max(0, this.top[i] - this.lim[i])); // Abtragsperre: nicht tiefer als die Oberkante der Pfahlwand
      if (armor > 1e-6) take = Math.min(take, armor); // zuerst die Betonschicht // erst das Sediment, dann (im nächsten Schritt) der Fels darunter
      if (take <= 0) continue;
      const fromSed = Math.min(take, Math.max(0, sed)), fromRock = take - fromSed;
      this.top[i] -= take;
      if (fromRock > 0) this.rock[i] -= fromRock; // der Fels wird abgetragen, die Sohle sinkt mit
      const left = this.top[i] - this.rock[i];
      let snap = 0;
      if (fromRock === 0 && left > 0 && left < CONFIG.layer.snap) { snap = left; this.top[i] -= snap; } // winziger Rest gilt als erledigt
      if (armor > 1e-6) { this.armor[i] = Math.max(0, armor - take); if (this.armor[i] < 0.01) this.armor[i] = 0; res.by[KIND.fels] += fromSed; } // Betonbruch zählt wie Fels (Schotter)
      else res.by[this.kind[i]] += fromSed + snap;
      res.by[KIND.fels] += fromRock;
      if (this.dep[i] && fromSed > 0 && armor <= 1e-6) { // Vorkommen: nur die obersten Meter bringen Aufschlag, danach ausgebeutet
        const v = Math.min(fromSed + snap, this.depLeft[i]);
        res.dep[this.dep[i]] = (res.dep[this.dep[i]] ?? 0) + v; this.depLeft[i] -= v;
        if ((this.depLeft[i] < 0.02 && !this.deposits[this.dep[i] - 1]?.regen) || this.top[i] - this.rock[i] < 0.05) this.dep[i] = 0; // nachwachsende Vorkommen (Delta) behalten ihre Zellen
      }
      take += snap;
      res.removed += take;
      const strip = this.ext[i] === 1 || (this.ext[i] === 2 && allowLand);
      if (this.zone[i]) res.zone += take; else if (strip) res.land += take; else res.out += take;
      if (strip && !this.zone[i] && this.top[i] < this.wl - 0.1) { this.zone[i] = 1; this.flow[i] = 0.4; this.cap[i] = this.wl - 0.15; } // Land wird Wasser: neuer Korridor
      if (this.hard[i]) res.hard += fromSed;
      if (this.top[i] - this.rock[i] <= 1e-6) this.hard[i] = 0;
      res.touched.push(i);
    }
    for (const i of res.touched) this.pending.add(i);
    return res;
  }

  _vol(r) {
    const a = this.area;
    return { removed: r.removed * a, by: r.by.map((v) => v * a), zone: r.zone * a, out: r.out * a, land: r.land * a, hard: r.hard * a, dep: Object.fromEntries(Object.entries(r.dep ?? {}).map(([k, v]) => [k, v * a])) };
  }

  // Querschnitt: Der Kasten umfasst die Spalten `cols` (Flussrichtung); die Pumpenleistung verteilt sich nach Bedarf auf alle
  // Spalten, in denen an der Einsaugstelle etwas zu holen ist. Die Einsaugstelle folgt dem Gelände jeder Spalte
  // (gleicher Abstand zur lokalen Oberfläche wie in der Mittelspalte). amount in m³.
  suckSwath(cols, centerCol, headY, headH, radius, amount, firmness = CONFIG_BASE_FIRMNESS, opts = {}) {
    const { allowLand = false, hardFactor = CONFIG.hard.factor, armorEff = CONFIG.concrete.pumpBreak } = opts;
    const my = clamp(Math.floor(headY), 0, this.rows - 1), base = this.top[this.idx(centerCol, my)];
    const work = cols.map((c) => this._adj(this._profileCells(c, headY, Math.max(0, headH + (this.top[this.idx(c, my)] - base)), radius, allowLand), firmness)).filter((cells) => cells.length);
    const rowW = work.map((cells) => cells.reduce((a, c) => a + c[1], 0)), total = rowW.reduce((a, b) => a + b, 0);
    const sum = { removed: 0, by: [0, 0, 0, 0, 0], zone: 0, out: 0, land: 0, hard: 0, dep: {} };
    for (let k = 0; k < work.length; k++) {
      const res = this._vol(this._drain(work[k], (amount * rowW[k]) / total / this.area, firmness, true, hardFactor, allowLand, armorEff));
      sum.removed += res.removed; sum.zone += res.zone; sum.out += res.out; sum.land += res.land; sum.hard += res.hard;
      for (const [k, v] of Object.entries(res.dep)) sum.dep[k] = (sum.dep[k] ?? 0) + v;
      for (let m = 0; m < 5; m++) sum.by[m] += res.by[m];
    }
    return sum;
  }

  // Beton ausbringen: verhärtet die oberste Sedimentschicht (bis CONFIG.concrete.thickness) der Zellen im Bereich um (headY, headH).
  // Nur im Baggerkorridor und im Ausbaustreifen (sonst Schutzgebiet), nur auf Sediment (Fels trägt keinen Beton). amount in m³ Beton,
  // Rückgabe: verbrauchte Menge (m³) und Anzahl neu verhärteter Zellen. Die Höhe der Sohle ändert sich nicht.
  pourSwath(cols, centerCol, headY, headH, radius, amount) {
    const T = CONFIG.concrete.thickness, my = clamp(Math.floor(headY), 0, this.rows - 1), base = this.top[this.idx(centerCol, my)];
    const cells = [];
    for (const c of cols) {
      for (const [i, w] of this._profileCells(c, headY, Math.max(0, headH + (this.top[this.idx(c, my)] - base)), radius, true)) {
        const ok = this.zone[i] || this.ext[i] === 1 || this.ext[i] === 2;
        if (ok && this.top[i] - this.rock[i] > T * 0.5 && this.armor[i] < T - 1e-6) cells.push([i, w]);
      }
    }
    let wSum = 0;
    for (const [, w] of cells) wSum += w;
    if (!wSum) return { used: 0, cells: 0 };
    let left = amount, used = 0, done = 0;
    for (const [i, w] of cells) {
      const want = Math.min(T - this.armor[i], this.sedAt(i), (amount * (w / wSum)) / this.area);
      const dv = Math.min(left, want * this.area);
      if (dv <= 0) continue;
      this.armor[i] += dv / this.area; left -= dv; used += dv;
      if (this.armor[i] >= T - 1e-6) done++;
    }
    return { used, cells: done };
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
