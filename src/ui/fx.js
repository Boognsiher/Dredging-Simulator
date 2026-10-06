// Effekte für den Querschnitt: Material fliegt in den Saugmund, Beträge schweben hoch, Brocken platzen weg,
// der Bildschirm wackelt bei harten Schichten. Reine Logik mit Zeichenfunktion, keine Spiellogik (darf fehlen).
import { CONFIG } from '../config.js';
const COLORS = { hard: '#9aa1a8', dust: '#8c7a5c', ...Object.fromEntries(CONFIG.materials.map((m) => [m.id, m.particle])) };

export class Fx {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.colors = { ...COLORS };
    this.view = 1; // CSS-Pixel je logischem Pixel (kleine Bildschirme: grössere Schrift)
    this.parts = []; // { x, y, vx, vy, life, max, size, color, home: {x, y} | null }
    this.floaters = []; // { x, y, text, life, color }
    this.shake = 0; // 0..1
    this.pay = 0; // gesammelte Vergütung, wird gebündelt als Zahl gezeigt
    this.payClock = 0;
  }

  // Einen Schritt Saugen: m = Saugmund (px), surfY = Bodenhöhe am Mund (px), d = Ergebnis von DredgeSim.update
  feed(m, surfY, d, dt, pay = 0) {
    this.pay += pay;
    this.payClock += dt;
    if (this.pay >= 1 && this.payClock > 0.6) { this.floaters.push({ x: m.x + 10, y: m.y - 30, text: `+${Math.round(this.pay)}`, life: 1.2, color: '#7bd88f' }); this.pay = 0; this.payClock = 0; }
    if (d.removed > 0) {
      const n = Math.min(10, Math.ceil(d.removed * 8)), r = this.rng, by = d.by, tot = by.reduce((x, y) => x + y, 0) || 1;
      for (let i = 0; i < n && this.parts.length < 260; i++) {
        let pick = r() * tot, k = 0;
        for (; k < by.length - 1; k++) { pick -= by[k]; if (pick <= 0) break; }
        const kind = d.hard > 0 && r() < d.hard / d.removed ? 'hard' : CONFIG.materials[k].id;
        this.parts.push({ x: m.x + (r() - 0.5) * 70, y: surfY + r() * 10, vx: (r() - 0.5) * 30, vy: -r() * 30, life: 0, max: 0.7 + r() * 0.5, size: 2 + r() * 2.5, color: this.colors[kind], home: m });
      }
      if (d.hard > 0) this.shake = Math.max(this.shake, 0.25);
      if (by[3] > 0 && r() < 0.3) this.floaters.push({ x: m.x + (r() - 0.5) * 30, y: m.y - 14, text: '☢', life: 0.9, color: '#ff7a3d' });
    }
  }

  // Brocken fliegen weg (Verstopfung) oder Staubwolke (Umkippen)
  burst(x, y, count, kind = 'hard', power = 160) {
    for (let i = 0; i < count && this.parts.length < 260; i++) {
      const a = this.rng() * Math.PI * 2, v = power * (0.3 + this.rng() * 0.7);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: 0.6 + this.rng() * 0.6, size: 3 + this.rng() * 4, color: this.colors[kind], home: null });
    }
    this.shake = Math.max(this.shake, kind === 'dust' ? 1 : 0.6);
  }

  update(dt) {
    for (const p of this.parts) {
      p.life += dt;
      if (p.home) { // saugt sich in Richtung Mund
        const dx = p.home.x - p.x, dy = p.home.y - p.y, d = Math.hypot(dx, dy) || 1, pull = 900 * (0.3 + p.life / p.max);
        p.vx += (dx / d) * pull * dt; p.vy += (dy / d) * pull * dt;
        p.vx *= 0.92; p.vy *= 0.92;
        if (d < 10) p.life = p.max;
      } else p.vy += 420 * dt; // Brocken fallen
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const f of this.floaters) { f.life -= dt; f.y -= 28 * dt; }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }

  // Versatz für das Wackeln in px
  offset() { return this.shake > 0 ? { x: (this.rng() - 0.5) * 8 * this.shake, y: (this.rng() - 0.5) * 8 * this.shake } : { x: 0, y: 0 }; }

  draw(ctx) {
    for (const p of this.parts) {
      ctx.globalAlpha = Math.min(1, (p.max - p.life) / 0.25);
      ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = `bold ${Math.round(Math.max(18, 14 / Math.max(0.2, this.view)))}px system-ui, sans-serif`; ctx.textAlign = 'center';
    for (const f of this.floaters) {
      ctx.globalAlpha = Math.min(1, f.life / 0.4);
      ctx.fillStyle = '#000a'; ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'start';
  }

  clear() { this.parts = []; this.floaters = []; this.shake = 0; this.pay = 0; }
}
