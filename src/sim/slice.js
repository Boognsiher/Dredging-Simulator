import { CONFIG, DEBRIS, KIND } from '../config.js';

// Querschnitt: Seitenansicht quer zum Fluss. Die Pumpe fährt über die Flussbreite (x = Zellkoordinate quer zum Fluss, absolut),
// Höhe h in m über dem Bezugshorizont. Der Kasten umfasst CONFIG.box.cols Spalten in Flussrichtung; die Pumpenleistung
// verteilt sich auf alle. Die Anzeige zeigt die Hüllkurve (höchster Punkt = engste Stelle für Schiffe).
// work = Arbeitsrichtung: nur nach rechts wird gesaugt; der Rückweg saugt nicht.
export const SLICE = { cols: 16, viewH: 7.6, below: 6.1, work: { x: 1, y: 1 }, returnBoost: 1.6, minWaterDepth: 0.5 };

const ZERO = { removed: 0, by: [0, 0, 0, 0, 0], zone: 0, out: 0, land: 0, hard: 0, concrete: 0, dep: {} };

// Geräte: Saugkopf, Löffelbagger (Upgrade loeffel), Betoniergerät (Upgrade betonrohr)
export const TOOLS = ['pump', 'loeffel', 'beton'];
export const toolAvailable = (stats, tool) => tool === 'pump' || (tool === 'loeffel' && stats.loeffel > 0) || (tool === 'beton' && stats.betonrohr > 0);
export const toolName = (tool) => ({ pump: 'Saugkopf', loeffel: 'Löffelbagger', beton: 'Betoniergerät' })[tool] ?? tool;

const AUTO_ERRORS = [
  { id: 'stuck', text: 'Automatik hängt sich auf und starrt aufs Wasser' },
  { id: 'wrongway', text: 'Automatik saugt rückwärts und ist sehr stolz darauf' },
  { id: 'high', text: 'Automatik hebt den Kopf und saugt Wasser (sehr sauber, aber nutzlos)' },
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class SliceSim {
  constructor(river, stats, mapX, mapY, rng = Math.random, targetDepth = CONFIG.echolot.defaultDepth, speedSetting = CONFIG.pumpSpeed.default, tool = 'pump') {
    this.river = river;
    this.tool = toolAvailable(stats, tool) ? tool : 'pump'; // Gerät: Saugkopf, Löffelbagger oder Betoniergerät
    this.concreteAvail = 0; // Betonvorrat (m³), setzt die Sitzung
    this.stats = stats;
    this.rng = rng;
    const B = CONFIG.box.cols;
    this.c0 = clamp(Math.round(mapX) - Math.floor(B / 2), 0, river.cols - B);
    this.cols = Array.from({ length: B }, (_, k) => this.c0 + k); // Spalten des Kastens
    this.centerCol = this.cols[Math.floor(B / 2)];
    this.x0 = clamp(Math.round(mapY) - SLICE.cols / 2, 0, river.rows - SLICE.cols); // linke Zelle des Fensters (quer zum Fluss)
    const b = this.bounds();
    this.x = clamp(mapY - 0.5, b.min, b.max); // Pumpe startet an der Pontonposition
    this.h = Math.min(this.maxH(), this.surfaceAt(this.x) + 1.5);
    this.suctioning = false;
    this.moving = false;
    this.speedSetting = speedSetting;
    this.targetDepth = targetDepth; // Solltiefe (m unter Wasser) für die Automatik
    this.sounding = null;
    this.sound();
    this.blocked = false; // Puffer voll: kein Saugen
    this.tilt = 0;
    this.tipped = 0;
    this.overNote = 0;
    this.clog = 0;
    this.freeing = null;
    this.auto = { on: false, dir: 'sweep', error: null, errLeft: 0, startX: this.x, didWork: false };
    this.autoPour = false; // Betonier-Automatik (Flotte, Betoniergerät)
    this.autoLand = false; // Land-Automatik: auch Zellen im Ausbaustreifen zählen als offen (Flotte, Löffelbagger)
    this.soundNoise = null; // überschreibt die Messungenauigkeit (Flottenpontons haben ein Peilgerät an Bord)
    this.autoRange = null; // [erste, letzte Zeile quer zum Fluss], auf die sich die Automatik beschränkt (Flotte: nur die Rinne), sonst null = alles im Korridor
    this.notes = [];
  }

  get h() { return this._h; }
  set h(v) { this._h = v; this.setH = v; }

  get wl() { return this.river.wl; }
  get reaches() { return this.tool !== 'pump'; } // Löffel und Betoniergerät reichen über Wasser und über das ganze Fenster
  maxH() { return this.reaches ? this.wl + CONFIG.bucket.reachAbove : this.wl - CONFIG.pump.maxHeightBelowWater; }

  // Kennwerte des gewählten Geräts. Der Löffel verstopft nicht, kippt kaum, trübt wenig, schafft harte Schicht und Fels besser und reicht über Wasser.
  toolParams() {
    const s = this.stats, B = CONFIG.bucket;
    if (this.tool === 'beton') return { power: s.pourPower, radius: CONFIG.concrete.radius, firmness: 0, hardFactor: 0, allowLand: true, turb: 0.1, stability: 99, clogs: false, pour: true, armorEff: 0 };
    if (this.tool === 'loeffel') return { armorEff: CONFIG.concrete.bucketBreak, power: s.bucketPower, radius: s.bucketRadius, firmness: s.bucketRock, hardFactor: B.hardFactor, allowLand: true, turb: B.turbidity, stability: s.stability * B.stability, clogs: false };
    return { armorEff: CONFIG.concrete.pumpBreak, power: s.power, radius: s.radius, firmness: s.rockFirmness, hardFactor: CONFIG.hard.factor, allowLand: false, turb: 1, stability: s.stability, clogs: true };
  }

  // Gerät wechseln (nur mit ausgebautem Löffel; nicht während Verstopfung oder Kippen)
  setTool(tool) {
    if (tool === this.tool || this.tipped > 0 || this.clog > 0) return false;
    if (!toolAvailable(this.stats, tool)) return false;
    this.tool = tool; this.suctioning = false; this.auto.on = false;
    const b = this.bounds();
    this.x = clamp(this.x, b.min, b.max - CONFIG.pump.offsetX);
    this.h = Math.min(this.maxH(), this.surfaceAt(this.x) + 1.5);
    this.say('info', { loeffel: 'Löffelbagger eingeschwenkt: verstopft nie, reicht über Wasser, bricht Beton auf.', beton: 'Betoniergerät eingeschwenkt: verhärtet Boden und Ufer (Leertaste).', pump: 'Saugkopf eingeschwenkt.' }[tool]);
    return true;
  }
  // Erlaubter Bereich quer zum Fluss: nur dort, wo genug Wasser ist (Ufer und Flachstellen gehen nicht)
  bounds() {
    if (this.reaches) return { min: this.x0 + 0.01, max: this.x0 + SLICE.cols - 0.01 }; // der Ausleger reicht über das ganze Fenster, auch ans Ufer
    let min = Infinity, max = -Infinity;
    for (let c = 0; c < SLICE.cols; c++) {
      if (this.wl - this.envTop(this.x0 + c) >= SLICE.minWaterDepth) { min = Math.min(min, this.x0 + c + 0.01); max = Math.max(max, this.x0 + c + 0.99); }
    }
    if (min > max) return { min: this.x0 + 0.01, max: this.x0 + SLICE.cols - 0.01 };
    return { min, max };
  }

  _debrisNames() { return DEBRIS; }

  _startFreeing(idx) {
    const U = CONFIG.unclog, info = CONFIG.debrisInfo[idx] ?? {};
    const f = { pos: 0, dir: 1, speed: info.speed ?? U.speed, zone: info.zone ?? U.zone, hits: 0, need: info.hits ?? U.hits, item: DEBRIS[idx] ?? null };
    this.freeing = f;
    f.zoneC = this._zone(f);
  }
  _zone(f = this.freeing) { const half = (f?.zone ?? CONFIG.unclog.zone) / 2; return half + this.rng() * (1 - 2 * half); }
  freeAttempt() {
    const f = this.freeing, U = CONFIG.unclog;
    if (!f || this.clog <= 0) return null;
    if (Math.abs(f.pos - f.zoneC) <= f.zone / 2) {
      f.hits++;
      if (f.hits >= f.need) { this.clog = 0; this.freeing = null; this.say('good', 'Pfropfen gelöst! Die Pumpe spuckt den Fremdstoff aus.'); return 'cleared'; }
      f.speed *= U.speedUp; f.zoneC = this._zone();
      return 'hit';
    }
    this.clog += U.missPenalty;
    return 'miss';
  }

  say(kind, text, extra = {}) { this.notes.push({ kind, text, ...extra }); }

  // Höchster Punkt der Sohle in der Zelle y über alle Spalten des Kastens (Hüllkurve)
  envTop(y) {
    const r = this.river, yy = clamp(Math.floor(y), 0, r.rows - 1);
    let m = -Infinity;
    for (const c of this.cols) m = Math.max(m, r.top[r.idx(c, yy)]);
    return m;
  }
  envLow(y) {
    const r = this.river, yy = clamp(Math.floor(y), 0, r.rows - 1);
    let m = Infinity;
    for (const c of this.cols) m = Math.min(m, r.top[r.idx(c, yy)]);
    return m;
  }
  surfaceAt(x) { return this.envTop(x); }

  mouth() { return { x: this.x + CONFIG.pump.offsetX, h: this.h - CONFIG.pump.offsetY }; }
  mouthCol() { return clamp(Math.floor(this.mouth().x) - this.x0, 0, SLICE.cols - 1); }
  autoFromCol() { return clamp(Math.floor(this.auto.startX + CONFIG.pump.offsetX - this.x0), 0, SLICE.cols - 1); }
  targetTop() { return this.wl - this.targetDepth; }

  // Echolot: lotet das Profil aus (mit Messfehler je nach Stufe); ohne Echolot ist die Peilung grob
  sound() {
    const amp = this.soundNoise ?? CONFIG.echolot.noise[this.stats.echolot] ?? 0;
    this.sounding = new Float32Array(SLICE.cols);
    for (let c = 0; c < SLICE.cols; c++) this.sounding[c] = this.envTop(this.x0 + c) + (this.rng() - 0.5) * 2 * amp;
  }

  // Ist die Spalte c des Fensters nach Peilung auf Solltiefe (oder gehört nicht zum Korridor)?
  _inZone(c) { const r = this.river; return this.cols.some((k) => r.zone[r.idx(k, this.x0 + c)]); }
  _inLand(c) { const r = this.river; return this.cols.some((k) => r.zone[r.idx(k, this.x0 + c)] || r.ext[r.idx(k, this.x0 + c)]); } // Korridor oder Ausbaustreifen (Land-Automatik)
  // Betonier-Automatik: offen ist eine Querzeile, solange in einer Zelle des Kastens (Korridor oder Ausbaustreifen) die Betonschicht noch fehlt
  _needsPour(c) {
    const r = this.river, T = CONFIG.concrete.thickness;
    return this.cols.some((k) => { const i = r.idx(k, this.x0 + c); return (r.zone[i] || r.ext[i]) && r.armor[i] < T * 0.9 && r.top[i] - r.rock[i] > T * 0.5; });
  }
  _colOpen(c) { if (this.autoRange && (this.x0 + c < this.autoRange[0] || this.x0 + c > this.autoRange[1])) return false; if (this.autoPour) return this._needsPour(c); return (this.autoLand ? this._inLand(c) : this._inZone(c)) && this.sounding[c] > this.targetTop() + CONFIG.echolot.doneEps; }
  colDone(c) { return !this._colOpen(c); }
  allDone() { for (let c = this.auto.on ? this.autoFromCol() : 0; c < SLICE.cols; c++) if (this._colOpen(c)) return false; return true; }
  _openLeft() { for (let c = 0; c < this.autoFromCol(); c++) if (this._colOpen(c)) return c; return -1; }

  // Wirklicher Stand (ohne Messfehler) für die Anzeige: so viele Zellen quer liegen noch über der Solltiefe
  restCount() {
    let n = 0;
    for (let c = 0; c < SLICE.cols; c++) if (this._inZone(c) && this.envTop(this.x0 + c) > this.targetTop() + CONFIG.echolot.doneEps) n++;
    return n;
  }

  toggleAuto() {
    if (this.stats.autoLevel <= 0) return false;
    this.auto.on = !this.auto.on;
    this.auto.error = null;
    this.auto.startX = this.x;
    this.auto.didWork = false;
    this.auto.dir = 'sweep';
    if (this.auto.on) { this.sound(); this.say('info', `Peilung: Automatik fährt auf ${this.targetDepth.toFixed(1)} m Tiefe.`); }
    else this.say('info', 'Automatik aus.');
    return true;
  }

  fixAuto() {
    if (!this.auto.error) return false;
    this.auto.error = null;
    this.say('good', 'Aus- und wieder einschalten hilft auch hier.');
    return true;
  }

  _autoControl(dt) {
    const a = this.auto, lvl = this.stats.autoLevel;
    if (a.error) {
      a.errLeft -= dt;
      if (a.errLeft <= 0) { a.error = null; this.say('info', 'Automatik hat sich von selbst gefangen.'); }
    } else if (this.rng() < CONFIG.auto.errorRate[lvl] * dt) {
      const e = AUTO_ERRORS[Math.floor(this.rng() * AUTO_ERRORS.length)];
      a.error = e.id; a.errLeft = CONFIG.auto.errorSeconds;
      this.say('bad', `${e.text}! (R = Reset)`);
    }
    if (a.error === 'stuck') return { dx: 0, dy: 0, suction: false };
    if (a.error === 'wrongway') return { dx: -1, dy: 0, suction: true };
    if (a.error === 'high') return { dx: 0, dy: -1, suction: true };
    if (lvl >= 2 && this.tilt > 0.5) return { dx: 0, dy: -1, suction: false };
    const b = this.bounds(), R = this.autoRange; // mit Arbeitsbereich fährt die Automatik nur über diesen Streifen
    const lo = R ? Math.max(b.min, R[0] + 0.01) : b.min, hiX = R ? Math.min(b.max, R[1] + 1) : b.max;
    if (a.dir === 'sweep' && this.x >= hiX - CONFIG.pump.offsetX - 0.05) a.dir = 'return';
    else if (a.dir === 'return' && this.x <= Math.max(a.startX, lo) + 0.05) { a.dir = 'sweep'; this.sound(); }
    const need = this._colOpen(this.mouthCol());
    return a.dir === 'sweep' ? { dx: 1, dy: 0, suction: need } : { dx: -1, dy: 0, suction: false };
  }

  // input: { dx, dy (dy>0 = nach unten), suction }
  update(dt, input) {
    const s = this.stats, a = this.auto, lvl = s.autoLevel, P = CONFIG.pump, R = this.river;
    if (this.tipped > 0) {
      this.tipped -= dt;
      this.suctioning = false; this.moving = false;
      this.h = Math.min(this.maxH(), this.h + 3 * dt);
      if (this.tipped <= 0) { this.tipped = 0; this.tilt = 0; this.say('info', 'Pumpe steht wieder. Sie tut so, als wäre nichts gewesen.'); }
      return ZERO;
    }
    this.overNote = Math.max(0, this.overNote - dt);
    let ctl = input;
    if (a.on) {
      const manual = Math.abs(input.dx || 0) > 0.2 || Math.abs(input.dy || 0) > 0.2;
      if (manual) { a.on = false; a.error = null; this.say('info', 'Du übernimmst das Steuer.'); }
      else if (this.allDone()) {
        const left = a.didWork ? -1 : this._openLeft();
        if (left >= 0) {
          a.startX = Math.max(this.x0 + 0.01, this.x0 + left - P.offsetX + 0.01); a.dir = 'return';
          this.say('info', 'Ab hier ist alles fertig. Automatik fährt zur nächsten offenen Stelle.');
          ctl = this._autoControl(dt);
        } else {
          a.on = false;
          this.say('good', 'Profil auf Solltiefe. Automatik meldet Feierabend.');
        }
      } else ctl = this._autoControl(dt);
    }
    const clogged = this.clog > 0;
    if (clogged) this.clog = Math.max(0, this.clog - dt);
    if (this.freeing) {
      const f = this.freeing;
      if (this.clog <= 0) this.freeing = null;
      else { f.pos += f.dir * f.speed * dt; if (f.pos >= 1) { f.pos = 1; f.dir = -1; } else if (f.pos <= 0) { f.pos = 0; f.dir = 1; } }
    }

    let dx = ctl.dx || 0, dy = ctl.dy || 0;
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
    dx = clamp(dx, -1, 1); dy = clamp(dy, -1, 1);
    this.moving = Math.abs(dx) + Math.abs(dy) > 0.01;

    const along = dx * SLICE.work.x + dy * SLICE.work.y;
    const pumpOk = !a.on || input.pumpOn !== false;
    const working = !!ctl.suction && pumpOk && !clogged && !this.blocked && along > -0.05;
    const af = a.on ? CONFIG.auto.speedFactor[lvl] : 1;
    const speed = s.headSpeed * this.speedSetting * af * (working ? s.suctionSpeedFactor : along < -0.05 ? SLICE.returnBoost : 1);

    const oldX = this.x, b = this.bounds();
    this.x = clamp(this.x + dx * speed * dt, b.min, b.max - P.offsetX);
    const floor = this.surfaceAt(this.x);
    const top = this.maxH();
    if (dy) { this._h = clamp(this._h - dy * speed * dt, Math.min(floor, top), top); this.setH = this._h; }
    if (a.on && !a.error && this.tilt <= 0.5) {
      const v = s.headSpeed * this.speedSetting * af * 0.8, target = floor + (lvl === 1 ? 0.4 : 0);
      this._h += clamp(target - this._h, -v * dt, v * dt);
      this.setH = this._h;
    }
    if (this._h < floor) this._h = floor;
    else if (this._h > this.setH && !dy) this._h = Math.max(this.setH, floor, this._h - s.headSpeed * this.speedSetting * 0.8 * dt);
    this._h = Math.min(this._h, Math.max(top, floor));
    const lift = Math.max(0, this._h - this.setH - P.liftTolerance), liftGain = lift * P.liftTiltRate * dt;

    if (a.on && working) a.didWork = true;
    this.suctioning = working;
    if (!this.suctioning) {
      if (liftGain > 0) this.tilt += liftGain; else this.tilt = Math.max(0, this.tilt - P.tiltRecover * dt);
      if (this.tilt >= 1) this._tip();
      return ZERO;
    }

    // Fremdstoff an der Einsaugstelle? Wer den Kopf anhebt, fährt drüber weg. Der Löffel hebt Fremdstoffe einfach aus (ausser Bomben).
    const T = this.toolParams();
    if (T.pour) { // Beton ausbringen (kein Saugen, keine Fremdstoffe, kein Kippen)
      const m0 = this.mouth(), avail = this.concreteAvail ?? 0;
      if (avail <= 1e-9) { if (this.overNote <= 0) { this.say('bad', 'Kein Beton mehr: im Panel kaufen oder im Betonwerk mischen.'); this.overNote = 8; } this.suctioning = false; return ZERO; }
      const pr = R.pourSwath(this.cols, this.centerCol, m0.x, m0.h, T.radius, Math.min(avail, T.power * dt));
      if (pr.used <= 0) this.suctioning = false;
      return { ...ZERO, concrete: pr.used };
    }
    const m = this.mouth(), my = clamp(Math.floor(m.x), 0, R.rows - 1);
    let di;
    for (const c of this.cols) { const i = R.idx(c, my); if (R.debris[i]) { di = i; break; } }
    const d = di === undefined ? 0 : R.debris[di];
    if (d && m.h <= this.surfaceAt(m.x) + 1.5) {
      const bomb = d === DEBRIS.length;
      R.debris[di] = 0;
      if (T.clogs || bomb) {
        this.clog = a.on ? CONFIG.auto.clogSeconds[lvl] : (CONFIG.debrisInfo[d - 1]?.clog ?? CONFIG.debris.clogSeconds);
        if (!a.on) this._startFreeing(d - 1);
        this.suctioning = false;
        this.say('clog', `${T.clogs ? 'Pumpe verstopft' : 'Löffel blockiert'}: ${DEBRIS[d - 1]}!`, { item: DEBRIS[d - 1], bomb });
        return ZERO;
      }
      this.say('info', `Löffel hebt aus: ${DEBRIS[d - 1]}`);
    }
    const res = R.suckSwath(this.cols, this.centerCol, m.x, m.h, T.radius, T.power * dt, T.firmness, { allowLand: T.allowLand, hardFactor: T.hardFactor, armorEff: T.armorEff });

    // Zu tief abgetragen: pro gefahrene Zelle wird zu viel weggesaugt, der Boden bricht vor der Pumpe weg und sie kippt.
    const dist = Math.max(Math.abs(this.x - oldX), P.minTravel * dt), cut = res.removed / R.area / dist;
    if (cut > T.stability || liftGain > 0) this.tilt += Math.max(0, cut - T.stability) * P.tiltRate * dt + liftGain;
    else this.tilt = Math.max(0, this.tilt - P.tiltRecover * dt);
    if (res.out > 1e-6 && this.overNote <= 0) {
      this.say('bad', this.tool === 'loeffel' ? 'Schutzgebiet! Hier darf nicht abgetragen werden (Busse pro m³).' : 'Naturschutzzone! Die Fischereiaufsicht schaut zu (Busse pro m³).');
      this.overNote = 8;
    }
    if (this.tilt >= 1) this._tip();
    return res;
  }

  _tip() {
    this.tilt = 1; this.tipped = CONFIG.pump.tipSeconds; this.suctioning = false;
    this.say('tip', this.tool === 'loeffel' ? 'Bagger gekippt! Der Löffel liegt im Wasser.' : 'Pumpe gekippt! Sie liegt jetzt am Grund und nennt es Mittagspause.');
  }
}

export { KIND };
