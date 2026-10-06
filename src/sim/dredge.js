import { CONFIG, KIND } from '../config.js';
import { SliceSim, TOOLS, toolAvailable, toolName } from './slice.js';

// Baggersitzung mit zwei Ansichten, die in Echtzeit laufen (die Uhr gehört dem Game):
//  - mode 'map':   Draufsicht, Ponton positionieren (nur auf Wasser mit genug Tiefe)
//  - mode 'slice': Querschnitt an der Ankerposition, hier wird abgesaugt
// update() liefert, was in diesem Schritt passiert ist (Delta); Game.collect() verbucht es. Kein Rendering, kein DOM.
export class DredgeSim {
  constructor(river, stats, rng = Math.random) {
    this.river = river;
    this.stats = stats;
    this.rng = rng;
    this.notes = [];
    this.targetDepth = CONFIG.echolot.defaultDepth;
    this.pumpSpeed = CONFIG.pumpSpeed.default;
    this.bufferRoom = Infinity;
    this.concreteAvail = 0; // Betonvorrat (m³), setzt das Game
    this.mode = 'map';
    this.slice = null;
    this.pumpOn = false;
    this.x = 3; // Ponton-Position in Zellenkoordinaten (x = Flussrichtung)
    this.y = river.rows / 2;
    this.turbidity = 0;
    this.turbidityMult = 1;
    this.autoStartedPump = false;
    this.tool = 'pump'; // gewähltes Gerät (Saugkopf oder Löffelbagger), gilt für die nächste Verankerung
    this.removed = 0; this.clogs = 0; this.tips = 0; this.outside = 0;
  }

  get cellX() { return Math.min(this.river.cols - 1, Math.max(0, Math.floor(this.x))); }
  get cellY() { return Math.min(this.river.rows - 1, Math.max(0, Math.floor(this.y))); }
  get bufferFull() { return this.bufferRoom <= 1e-6; }
  get suctioning() { return this.mode === 'slice' && this.slice.suctioning; }

  // Genug Wasser für den Ponton an dieser Stelle?
  canFloat(x, y) {
    const r = this.river;
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return false;
    return r.depthAt(r.idx(Math.floor(x), Math.floor(y))) >= 0.8;
  }

  setStats(stats) { this.stats = stats; if (this.slice) this.slice.stats = stats; }

  anchor() {
    if (this.mode !== 'map') return false;
    if (!this.canFloat(this.x, this.y)) return false;
    this.slice = new SliceSim(this.river, this.stats, this.x, this.y, this.rng, this.targetDepth, this.pumpSpeed, this.tool);
    this.mode = 'slice';
    this.pumpOn = false;
    return true;
  }

  leave() {
    if (this.mode !== 'slice') return false;
    this.slice = null;
    this.mode = 'map';
    this.pumpOn = false; this.autoStartedPump = false;
    return true;
  }

  // Gerät wechseln: im Querschnitt sofort, auf der Karte für die nächste Verankerung
  setTool(tool) {
    if (!toolAvailable(this.stats, tool)) return false;
    if (this.mode === 'slice') { if (!this.slice.setTool(tool)) return false; this.pumpOn = false; }
    this.tool = tool;
    return true;
  }

  // Nächstes verfügbares Gerät (Saugkopf → Löffel → Beton → Saugkopf)
  nextTool() {
    for (let k = 1; k <= TOOLS.length; k++) { const t = TOOLS[(TOOLS.indexOf(this.tool) + k) % TOOLS.length]; if (toolAvailable(this.stats, t)) return t; }
    return this.tool;
  }

  setTargetDepth(v) {
    this.targetDepth = Math.min(CONFIG.echolot.maxDepth, Math.max(CONFIG.echolot.minDepth, v));
    if (this.slice) this.slice.targetDepth = this.targetDepth;
  }

  togglePump() { if (this.mode !== 'slice') return false; this.pumpOn = !this.pumpOn; return true; }

  setPumpSpeed(v) {
    const P = CONFIG.pumpSpeed;
    this.pumpSpeed = Math.min(P.max, Math.max(P.min, v));
    if (this.slice) this.slice.speedSetting = this.pumpSpeed;
  }

  freeAttempt() { return this.mode === 'slice' ? this.slice.freeAttempt() : null; }

  toggleAuto() {
    if (this.mode !== 'slice' || !this.slice.toggleAuto()) return false;
    if (this.slice.auto.on && !this.pumpOn) { this.pumpOn = true; this.autoStartedPump = true; }
    return true;
  }
  fixAuto() { return this.mode === 'slice' && this.slice.fixAuto(); }

  // input: { dx, dy in -1..1, suction: bool }
  update(dt, input) {
    const s = this.stats;
    const d = { removed: 0, by: [0, 0, 0, 0, 0], zone: 0, out: 0, land: 0, hard: 0, concrete: 0, fines: 0, repairs: 0, tips: 0, clogs: 0, clogItems: [], bombs: 0 };

    if (this.mode === 'map') {
      let dx = input.dx || 0, dy = input.dy || 0;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      const nx = this.x + dx * s.speed * dt, ny = this.y + dy * s.speed * dt;
      if (this.canFloat(nx, this.y)) this.x = nx; // Land und Flachwasser halten den Ponton auf
      if (this.canFloat(this.x, ny)) this.y = ny;
    } else {
      this.slice.blocked = this.bufferFull && this.slice.tool !== 'beton';
      this.slice.concreteAvail = this.concreteAvail;
      const r = this.slice.update(dt, { ...input, suction: input.suction || this.pumpOn, pumpOn: this.pumpOn });
      if (this.autoStartedPump && !this.slice.auto.on) { this.pumpOn = false; this.autoStartedPump = false; }
      for (const n of this.slice.notes.splice(0)) {
        this.notes.push(n);
        if (n.kind === 'clog') { d.clogs++; d.clogItems.push(n.item); if (n.bomb) d.bombs++; }
        if (n.kind === 'tip') { d.tips++; d.repairs += CONFIG.pump.repairCost; this.pumpOn = false; }
      }
      d.removed = r.removed; d.by = r.by; d.zone = r.zone; d.out = r.out; d.land = r.land; d.hard = r.hard; d.concrete = r.concrete ?? 0;
      // Trübung entsteht nur, wenn die Pumpe am Boden wirklich Material saugt; Mehr Leistung, Bewegung und Altlasten = mehr Trübung.
      const T = this.slice.toolParams(), use = T.power * dt > 0 ? Math.min(1, Math.max(0, r.removed / (T.power * dt))) : 0;
      if (this.slice.suctioning && use > 0) {
        const boost = (this.slice.moving ? 1.4 : 1) * (r.by[KIND.altlast] > 0 ? 1.5 : 1);
        this.turbidity += (T.power / CONFIG.turbidityGain) * this.turbidityMult * T.turb * boost * (1 - s.curtain) * use * dt;
      }
    }

    this.turbidity = Math.min(1, Math.max(0, this.turbidity - CONFIG.turbidityDecay * dt));
    if (this.turbidity > CONFIG.turbidityFineThreshold) d.fines = CONFIG.turbidityFinePerSecond * dt;

    this.removed += d.removed; this.outside += d.out;
    this.clogs += d.clogs; this.tips += d.tips;
    return d;
  }
}

export { TOOLS, toolName };
