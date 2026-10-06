// Zeichnet Karte und Querschnitt. Kennt keine Spiellogik, liest nur Zustand.
import { SLICE } from '../sim/slice.js';
import { CONFIG, SHIPS, KIND, CARGOS, shipById, cargoById, depositType } from '../config.js';
import { shipPos, queuePos, bayCapacity } from '../sim/traffic.js';
import { needDepth, minNeedDepth } from '../sim/fairway.js';
import { Chain, drawChain } from './chain.js';
import { groundedNear } from '../sim/tow.js';

const chain = new Chain();

export const CELL = 16; // Karte: Pixel pro Zelle
export const MARGIN = 3; // Zellen Fluss links und rechts ausserhalb des Abschnitts (dort fahren Schiffe ein und aus)
export const OX = MARGIN * CELL;
export const W = (CONFIG.river.cols + 2 * MARGIN) * CELL; // 800
export const H = CONFIG.river.rows * CELL; // 384
const U = W / SLICE.cols; // Querschnitt: Pixel pro Zelle quer zum Fluss (50)
const PPM = 44; // Querschnitt: Pixel pro Meter Höhe
const SURF = 78; // Querschnitt: Bildzeile der Wasseroberfläche (darüber Ponton und Himmel)
const PW = 24, PH = 46; // Pumpe in Pixeln, hochkant

export function sizeCanvas(canvas) { canvas.logicalW = W; canvas.logicalH = H; canvas.width = W; canvas.height = H; }

// Schriftgrösse: das Bild wird auf kleinen Bildschirmen stark verkleinert (view.s = CSS-Pixel je logischem Pixel).
export const view = { s: 1 };
export const fs = (n, min = 12) => Math.round(Math.max(n, min / Math.max(0.2, view.s)));
const font = (n, bold = true, min = 12) => `${bold ? 'bold ' : ''}${fs(n, min)}px system-ui, sans-serif`;

const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const mapPx = (cx, cy) => ({ x: OX + cx * CELL, y: cy * CELL });
export const sliceY = (h, wl) => SURF + (wl - h) * PPM;

// ---------- Karte ----------
function cellColor(river, i, pal) {
  const top = river.top[i], depth = river.wl - top;
  if (depth <= 0.02) { // Land
    const e = Math.min(1, (top - river.wl) / 5);
    return mix(pal.land, [150, 140, 110], e * 0.8);
  }
  const t = Math.min(1, depth / 5);
  return mix([150, 205, 215], pal.water.map((v) => v * 0.55), Math.sqrt(t));
}

export function drawMap(ctx, game, sim, ui = {}) {
  const r = game.river, pal = game.level.palette, { cols, rows } = r;
  ctx.fillStyle = rgb(pal.land); ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < rows; y++) {
    for (let x = -MARGIN; x < cols + MARGIN; x++) {
      const cx = Math.min(cols - 1, Math.max(0, x)), i = y * cols + cx;
      ctx.fillStyle = rgb(cellColor(r, i, pal));
      ctx.fillRect(OX + x * CELL, y * CELL, CELL + 0.5, CELL + 0.5);
    }
  }
  // Baggerkorridor: ausserhalb (Ufer und Flachwasser) liegt die Naturschutzzone
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (r.isWater(i) && !r.zone[i]) { ctx.fillStyle = 'rgba(70,230,110,.38)'; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); if ((x + y) % 2 === 0) { ctx.fillStyle = 'rgba(200,255,200,.22)'; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); } }
      else if (!r.isWater(i) && r.ext[i] === 1) { ctx.fillStyle = 'rgba(235,200,70,.30)'; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); } // Ausbaustreifen am Ufer (Löffelbagger)
    }
  }
  // Materialhinweise: Altlasten orange, Fels grau, harte Schichten schraffiert, Fremdstoffe weiss
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!r.isWater(i) && !r.armor[i]) continue;
      const px = OX + x * CELL, py = y * CELL;
      if (r.kind[i] === KIND.altlast && r.top[i] - r.rock[i] > 0.05) {
        ctx.fillStyle = 'rgba(255,120,40,.5)'; ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        if ((x + y) % 2 === 0) { ctx.fillStyle = 'rgba(60,20,0,.85)'; ctx.font = `bold ${CELL - 4}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('☢', px + CELL / 2, py + CELL - 3); ctx.textAlign = 'start'; } // Altlast-Kennzeichnung
      }
      if (r.top[i] - r.rock[i] < 0.05) { ctx.fillStyle = 'rgba(90,95,105,.55)'; ctx.fillRect(px, py, CELL, CELL); }
      if (r.hard[i] && r.top[i] - r.rock[i] > 0.05) {
        ctx.strokeStyle = 'rgba(10,20,30,.45)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(px, py + CELL); ctx.lineTo(px + CELL, py);
        if (r.hard[i] > 1) { ctx.moveTo(px, py); ctx.lineTo(px + CELL, py + CELL); }
        ctx.stroke();
      }
      if (r.armor[i] > 0) { // Beton: hellgrau mit Kreuzschraffur
        ctx.fillStyle = 'rgba(205,208,214,.5)'; ctx.fillRect(px, py, CELL, CELL);
        ctx.strokeStyle = 'rgba(90,95,105,.65)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px + 2, py + 2); ctx.lineTo(px + CELL - 2, py + CELL - 2); ctx.moveTo(px + CELL - 2, py + 2); ctx.lineTo(px + 2, py + CELL - 2); ctx.stroke();
      }
      if (r.debris[i]) { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(px + 5, py + 5, 6, 6); ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(px + 5.5, py + 5.5, 5, 5); }
    }
  }
  drawDeposits(ctx, game, ui);
  // Auswahl einer Schiffsklasse: wo fehlt Tiefe, wo läuft die günstigste Rinne
  const sel = ui.classSel && game.fair?.[ui.classSel] ? shipById(ui.classSel) : null;
  if (sel) drawClassOverlay(ctx, game, sel);
  drawZones(ctx, game, ui);
  drawShips(ctx, game, ui);
  drawFleet(ctx, game);
  if (sim) drawPontoon(ctx, game, sim, ui);
  // schwebende Beträge
  ctx.font = font(15); ctx.textAlign = 'center';
  for (const f of ui.floaters ?? []) {
    ctx.globalAlpha = Math.min(1, f.life / 0.6);
    const p = mapPx(f.x, f.y - (1.6 - f.life) * 1.2);
    ctx.fillStyle = '#000a'; ctx.fillText(f.text, p.x + 1, p.y + 1); ctx.fillStyle = f.color; ctx.fillText(f.text, p.x, p.y);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'start';
  drawMapHud(ctx, game);
  if (sim) turbidityVeil(ctx, sim);
}

function drawClassOverlay(ctx, game, cls) {
  const r = game.river, f = game.fair[cls.id], needTop = game.wl - f.need, stage2 = f.passable; // bis passierbar: Mindesttiefe (rot), danach Volllast-Tiefe (gelb)
  const lo = Math.floor((cls.beam - 1) / 2), hi = cls.beam - 1 - lo, lane = new Set();
  for (const p of f.nodes ?? []) for (let k = p.y - lo; k <= p.y + hi; k++) lane.add(k * r.cols + p.x);
  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) {
      const i = y * r.cols + x;
      if (!r.zone[i]) continue;
      const miss = r.top[i] - needTop;
      if (miss <= 0.02) continue;
      const strong = lane.has(i), a = strong ? Math.min(0.7, 0.3 + miss * 0.3) : 0.08; // die günstigste Rinne kräftig, der Rest nur angedeutet
      ctx.fillStyle = r.rock[i] > needTop ? `rgba(150,90,200,${a})` : stage2 ? `rgba(255,190,60,${a})` : `rgba(255,70,60,${a})`; // lila = Fels im Weg
      ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL);
    }
  }
  if (f.path) {
    const pts = f.path.points;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = f.passable ? 'rgba(120,255,160,.30)' : 'rgba(255,255,255,.22)'; ctx.lineWidth = cls.beam * CELL * 0.9;
    ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(OX + p.x * CELL, p.y * CELL) : ctx.moveTo(OX + p.x * CELL, p.y * CELL))); ctx.stroke();
    ctx.strokeStyle = f.passable ? '#7bf0a0' : '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.stroke(); ctx.restore();
    if (f.weakest) { // engste Stelle
      const p = mapPx(f.weakest.x + 0.5, f.path.points.find((q) => Math.floor(q.x) === f.weakest.x)?.y ?? r.rows / 2);
      ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y - 4); ctx.lineTo(p.x - 7, p.y - 18); ctx.lineTo(p.x + 7, p.y - 18); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
}

function drawShips(ctx, game, ui) {
  const ships = game.traffic.ships;
  const ranks = { 1: 0, '-1': 0 };
  const queue = ships.filter((s) => s.state === 'queue').sort((a, b) => b.wait - a.wait);
  const counts = { 1: 0, '-1': 0 };
  for (const s of ships) {
    const cls = shipById(s.cls);
    let p;
    if (s.state === 'queue') { const rank = ranks[s.dir]++; p = queuePos(game, s, rank); counts[s.dir]++; } else p = shipPos(s);
    if (!p) continue;
    drawShip(ctx, cls, s, p, game, ui);
  }
  if (queue.length) { // Anzahl Wartende an den Enden
    ctx.font = font(13); ctx.textAlign = 'center';
    for (const dir of [1, -1]) {
      if (!counts[dir]) continue;
      const first = queue.find((s) => s.dir === dir), p = queuePos(game, first, 0), q = mapPx(p.x, p.y);
      const w = first.wait / CONFIG.traffic.patience;
      ctx.fillStyle = '#000b'; ctx.fillRect(q.x - 18, q.y - 30, 36, 5);
      ctx.fillStyle = w > 0.7 ? '#ff7a6b' : '#ffd24d'; ctx.fillRect(q.x - 18, q.y - 30, 36 * (1 - Math.min(1, w)), 5);
      ctx.fillStyle = '#fff'; ctx.fillText(`${counts[dir]} wartend`, q.x, q.y - 34);
    }
    ctx.textAlign = 'start';
  }
}

function drawShip(ctx, cls, ship, p, game, ui) {
  const q = mapPx(p.x, p.y), L = cls.len * CELL, B = cls.beam * CELL * 0.78;
  ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(p.angle);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(1, 3, L / 2 + 2, B / 2 + 1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = cls.color; ctx.strokeStyle = '#10202c'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-L / 2, -B / 2); ctx.lineTo(L / 2 - B * 0.6, -B / 2); ctx.lineTo(L / 2, 0); ctx.lineTo(L / 2 - B * 0.6, B / 2); ctx.lineTo(-L / 2, B / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  const cargo = cargoById(ship.cargo);
  ctx.fillStyle = cargo?.color ?? '#999'; // Ladung
  if (cls.id === 'container') { for (let k = 0; k < 4; k++) for (let m = 0; m < 2; m++) { ctx.fillStyle = ['#e0803a', '#3a7ae0', '#d94a4a', '#e0c33a'][(k + m) % 4]; ctx.fillRect(-L / 2 + 4 + k * (L - B) / 4.4, -B / 2 + 3 + m * (B - 6) / 2, (L - B) / 4.6, (B - 6) / 2 - 1); } }
  else ctx.fillRect(-L / 2 + 4, -B / 2 + 3, L - B * 0.9 - 6, B - 6);
  ctx.fillStyle = '#f4f4f0'; ctx.fillRect(L / 2 - B * 0.95, -B * 0.28, B * 0.34, B * 0.56); // Brücke
  ctx.restore();
  if (ship.state === 'grounded') {
    const pulse = 0.5 + 0.5 * Math.sin((ui.t ?? 0) * 5), near = ui.towShip === ship.id;
    ctx.strokeStyle = near ? `rgba(120,255,160,${0.5 + 0.4 * pulse})` : `rgba(255,120,100,${0.35 + 0.4 * pulse})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(q.x, q.y, L / 2 + 8 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
    ctx.font = font(18); ctx.textAlign = 'center'; ctx.fillStyle = (Math.floor((ui.t ?? 0) * 3) % 2) ? '#ff7a6b' : '#fff';
    ctx.fillText('⚠', q.x, q.y - 12);
    ctx.font = font(12); ctx.fillStyle = near ? '#9bf5b8' : '#ffb4a8'; ctx.fillText(near ? 'Schleppen: T' : 'aufgelaufen', q.x, q.y + L / 2 + 20); ctx.textAlign = 'start';
  }
}

function drawPontoon(ctx, game, sim, ui) {
  const r = game.river, px = OX + sim.x * CELL, py = sim.y * CELL;
  const B = CONFIG.box.cols;
  let c0, x0;
  if (sim.mode === 'slice') { c0 = sim.slice.c0; x0 = sim.slice.x0; }
  else { c0 = Math.min(Math.max(Math.round(sim.x) - Math.floor(B / 2), 0), r.cols - B); x0 = Math.min(Math.max(Math.round(sim.y) - SLICE.cols / 2, 0), r.rows - SLICE.cols); }
  const bx = OX + c0 * CELL, by = x0 * CELL, bw = B * CELL, bh = SLICE.cols * CELL; // der Kasten: 4 Spalten × 16 Zellen quer
  ctx.fillStyle = 'rgba(217,222,227,.16)'; ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = sim.mode === 'slice' ? '#7fe3ff' : '#7fe3ff99'; ctx.lineWidth = 2; ctx.setLineDash(sim.mode === 'slice' ? [] : [6, 4]); ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2); ctx.setLineDash([]);
  if (sim.mode === 'slice') { // Position der Pumpe im Kasten
    const sy = by + (sim.slice.x - x0) * CELL;
    ctx.strokeStyle = sim.slice.suctioning ? '#ffd24d' : '#7fe3ffcc'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx - 3, sy); ctx.lineTo(bx + bw + 3, sy); ctx.stroke();
  }
  // Ponton (Boot mit Kran), quer zum Fluss gedreht
  ctx.save(); ctx.translate(px, py);
  ctx.fillStyle = '#e8c33a'; ctx.strokeStyle = '#3b2f08'; ctx.lineWidth = 1.5;
  ctx.fillRect(-CELL * 1.4, -CELL * 0.9, CELL * 2.8, CELL * 1.8); ctx.strokeRect(-CELL * 1.4, -CELL * 0.9, CELL * 2.8, CELL * 1.8);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-CELL * 0.5, -CELL * 0.5, CELL, CELL);
  if (sim.mode === 'slice') { ctx.fillStyle = sim.pumpOn ? '#7bd88f' : '#ff7a6b'; ctx.beginPath(); ctx.arc(CELL * 0.9, -CELL * 0.5, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  if (ui.mapTarget && sim.mode === 'map') {
    const t = mapPx(ui.mapTarget.x, ui.mapTarget.y);
    ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.x, t.y, 10, 0, Math.PI * 2);
    ctx.moveTo(t.x - 14, t.y); ctx.lineTo(t.x + 14, t.y); ctx.moveTo(t.x, t.y - 14); ctx.lineTo(t.x, t.y + 14); ctx.stroke();
  }
}

// Rohstoffgebiete: bekannte Vorkommen goldgelb getönt, mit Konzession durchgezogener Rand; Name und Aufschlag darüber
function drawDeposits(ctx, game, ui) {
  const r = game.river;
  for (const d of r.deposits ?? []) {
    if (!d.known) continue;
    const T = depositType(d.type);
    for (let i = 0; i < r.dep.length; i++) {
      if (r.dep[i] !== d.id) continue;
      const x = i % r.cols, y = (i / r.cols) | 0;
      ctx.fillStyle = d.owned ? 'rgba(255,215,80,.38)' : 'rgba(255,215,80,.18)'; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL);
      if ((x + y) % 3 === 0) { ctx.fillStyle = d.owned ? '#fff4b8' : '#e8d27a'; ctx.beginPath(); ctx.arc(OX + x * CELL + CELL / 2, y * CELL + CELL / 2, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    const px = OX + d.cx * CELL, py = d.cy * CELL;
    ctx.strokeStyle = T.color; ctx.lineWidth = 2; ctx.setLineDash(d.owned ? [] : [6, 5]);
    ctx.beginPath(); ctx.ellipse(px, py, d.rx * CELL, d.ry * CELL, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const label = `${d.name.split(' (')[0]} ×${d.mult}${d.owned ? ' ✓' : ' (Konzession fehlt)'}`;
    ctx.font = font(12); ctx.textAlign = 'center'; const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = '#000b'; ctx.fillRect(px - tw / 2, py - d.ry * CELL - fs(12) - 8, tw, fs(12) + 6); ctx.fillStyle = d.owned ? '#ffe9a0' : '#e8d9a0'; ctx.fillText(label, px, py - d.ry * CELL - 7); ctx.textAlign = 'start';
  }
}

// Kreuzungsstellen: bereit = grün gestrichelt, geplant = gelb mit rot markierten Zellen, die noch ausgetragen werden müssen.
// Im Setz-Modus zeigt jede Spalte, ob (grün) und wie viel (gelb bis orange) fehlt; unter der Maus steht die Zahl.
function drawZoneWindows(ctx, game, plan, alpha = 0.45) {
  const r = game.river;
  for (const w of plan.wins ?? []) for (const a of [w.a, w.b]) for (let k = a; k < a + plan.beam; k++) {
    const i = k * r.cols + w.x;
    if (r.top[i] > plan.needTop || !r.zone[i]) { ctx.fillStyle = `rgba(255,70,60,${alpha})`; ctx.fillRect(OX + w.x * CELL, k * CELL, CELL, CELL); }
  }
  ctx.strokeStyle = 'rgba(255,230,120,.9)'; ctx.lineWidth = 1.5;
  for (const w of plan.wins ?? []) for (const a of [w.a, w.b]) ctx.strokeRect(OX + w.x * CELL + 1, a * CELL + 1, CELL - 2, plan.beam * CELL - 2);
}

function drawZones(ctx, game, ui) {
  const r = game.river, B = CONFIG.zones.width, cid = game.zoneClassId, cls = shipById(cid);
  if (ui.zoneMode) {
    for (let x = 2; x <= r.cols - 3; x++) {
      const p = game.zonePlanFor(x, cid), v = p.volume;
      const col = v === Infinity ? [255, 90, 80] : v <= 0 ? [160, 230, 90] : v < 300 ? [220, 230, 90] : v < 1200 ? [255, 190, 70] : [255, 140, 60];
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${v === Infinity ? 0.05 : 0.10})`; ctx.fillRect(OX + x * CELL, 0, CELL, H);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},.85)`; ctx.fillRect(OX + x * CELL + 3, 0, CELL - 6, 7);
    }
    const hx = ui.hoverX;
    if (hx != null && hx >= 2 && hx <= r.cols - 3) {
      const p = game.zonePlanFor(hx, cid);
      drawZoneWindows(ctx, game, p, 0.35);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(OX + (hx - 1) * CELL, 1, B * CELL, H - 2);
      const t = p.volume === Infinity ? `Hier zu schmal für ${cls.name} (auch mit Uferstreifen)` : p.volume <= 0 ? `Platz für ${cls.name} ist da` : `${cls.icon} fehlt noch ${Math.round(p.volume).toLocaleString('de-CH')} m³ Aushub${p.land ? ' (Ufer abtragen, Löffelbagger)' : ''}`;
      ctx.font = font(14); const w = ctx.measureText(t).width + 18, bx = Math.min(W - w - 6, Math.max(6, OX + hx * CELL - w / 2));
      ctx.fillStyle = '#000c'; ctx.fillRect(bx, 24, w, fs(14) + 10); ctx.fillStyle = p.volume === Infinity ? '#ffb4a8' : p.volume <= 0 ? '#d6f5a8' : '#ffe08a'; ctx.fillText(t, bx + 9, 24 + fs(14) + 2);
    }
    ctx.font = font(13); const t = `Kreuzungsstelle planen für ${cls.name} (${2 * cls.beam + 1} Zellen Breite nötig): Spalte antippen · grün = frei, gelb/orange = so viel fehlt noch`, w = ctx.measureText(t).width + 16;
    ctx.fillStyle = '#000b'; ctx.fillRect(OX + 6, H - fs(13) - 14, Math.min(w, W - OX - 12), fs(13) + 8); ctx.fillStyle = '#d6f5a8'; ctx.fillText(t, OX + 14, H - 12);
  }
  for (const z of game.zones ?? []) {
    const zc = z.cls ?? cid, p = game.zonePlanFor(z.x, zc), ready = p.ready, c = shipById(zc), x0 = OX + (z.x - z.w / 2 + 0.5) * CELL;
    if (!ready) drawZoneWindows(ctx, game, p);
    ctx.fillStyle = ready ? 'rgba(160,230,90,.13)' : 'rgba(255,200,70,.12)'; ctx.fillRect(x0, 0, z.w * CELL, H);
    ctx.strokeStyle = ready ? '#a6e65a' : '#ffc94d'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.moveTo(x0 + z.w * CELL, 0); ctx.lineTo(x0 + z.w * CELL, H); ctx.stroke(); ctx.setLineDash([]);
    const label = ready ? `Kreuzung ${c.icon} ✓` : `Kreuzung ${c.icon}: fehlt ${p.volume === Infinity ? '?' : Math.round(p.volume) + ' m³'}`;
    ctx.font = font(12); ctx.textAlign = 'center'; const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = '#000b'; ctx.fillRect(x0 + z.w * CELL / 2 - tw / 2, 3, tw, fs(12) + 6); ctx.fillStyle = ready ? '#d6f5a8' : '#ffe08a'; ctx.fillText(label, x0 + z.w * CELL / 2, 4 + fs(12)); ctx.textAlign = 'start';
  }
}

// Gemietete Pontons der Flotte: kleiner, cyan, mit Name; beim Baggern mit gestricheltem Kasten
function drawFleet(ctx, game) {
  for (const u of game.fleet?.units ?? []) {
    const px = OX + u.x * CELL, py = u.y * CELL, sim = u.sim;
    if (sim?.mode === 'slice') {
      const sl = sim.slice, B = CONFIG.box.cols;
      ctx.strokeStyle = '#7fe3ff88'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.strokeRect(OX + sl.c0 * CELL + 1, sl.x0 * CELL + 1, B * CELL - 2, SLICE.cols * CELL - 2); ctx.setLineDash([]);
      const sy = sl.x0 * CELL + (sl.x - sl.x0) * CELL;
      ctx.strokeStyle = sl.suctioning ? '#ffd24d' : '#7fe3ff99'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(OX + sl.c0 * CELL, sy); ctx.lineTo(OX + (sl.c0 + B) * CELL, sy); ctx.stroke();
    }
    ctx.save(); ctx.translate(px, py);
    ctx.fillStyle = '#4fc3d9'; ctx.strokeStyle = '#08323c'; ctx.lineWidth = 1.5;
    ctx.fillRect(-CELL * 1.1, -CELL * 0.7, CELL * 2.2, CELL * 1.4); ctx.strokeRect(-CELL * 1.1, -CELL * 0.7, CELL * 2.2, CELL * 1.4);
    ctx.fillStyle = '#1b2a33'; ctx.fillRect(-CELL * 0.35, -CELL * 0.35, CELL * 0.7, CELL * 0.7);
    ctx.restore();
    ctx.font = font(11); ctx.textAlign = 'center'; ctx.fillStyle = '#000b'; ctx.fillText(u.name, px + 1, py - CELL + 1); ctx.fillStyle = '#d9f7ff'; ctx.fillText(u.name, px, py - CELL); ctx.textAlign = 'start';
  }
}

function drawMapHud(ctx, game) {
  ctx.font = font(13);
  const lines = [];
  lines.push(`Pegel ${game.wl.toFixed(2)} m${game.wl > CONFIG.water.base + 0.25 ? ' ▲' : game.wl < CONFIG.water.base - 0.25 ? ' ▼' : ''}`);
  if (game.closed) lines.push('⛔ Hochwasser: Schifffahrt gesperrt');
  else if (game.time < (game.strikeUntil ?? 0)) lines.push('✊ Streik: kaum Verkehr');
  let y = 18;
  for (const t of lines) {
    const w = ctx.measureText(t).width + 14;
    ctx.fillStyle = '#000a'; ctx.fillRect(OX + 6, y - 14, w, fs(13) + 6);
    ctx.fillStyle = t.startsWith('⛔') ? '#ff9d8f' : '#fff'; ctx.fillText(t, OX + 13, y);
    y += fs(13) + 8;
  }
}

function turbidityVeil(ctx, sim) {
  if ((sim.turbidity ?? 0) > 0.02) { ctx.fillStyle = `rgba(140,110,70,${Math.min(0.55, sim.turbidity * 0.6)})`; ctx.fillRect(0, 0, W, H); }
}

// ---------- Querschnitt ----------
// Pixel-Positionen der beiden Automatik-Linien (linker und rechter Rand des Arbeitsbereichs)
export function autoLineX(sl) {
  const n = SLICE.cols, R = sl.autoRange;
  const a = R ? Math.max(R[0], sl.x0) : sl.x0, b = R ? Math.min(R[1], sl.x0 + n - 1) : sl.x0 + n - 1;
  return [(a - sl.x0) * U, (b + 1 - sl.x0) * U];
}
export function sliceHeadScreen(sl) {
  const wl = sl.wl;
  return { x: (sl.x - sl.x0) * U, y: sliceY(sl.h, wl) };
}
export function sliceMouthScreen(sl) {
  const m = sl.mouth();
  return { x: (m.x - sl.x0) * U, y: sliceY(m.h, sl.wl) };
}
const sx = (sl, x) => (x - sl.x0) * U;

export function drawSlice(ctx, game, sim, ui = {}) {
  const sl = sim.slice, r = game.river, wl = r.wl, n = SLICE.cols;
  const Y = (h) => sliceY(h, wl), xs = (c) => (c + 0.5) * U;
  // Himmel
  const sky = ctx.createLinearGradient(0, 0, 0, SURF);
  sky.addColorStop(0, '#6aa6d2'); sky.addColorStop(1, '#bcd9ee');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, SURF);
  // Wasser
  const wg = ctx.createLinearGradient(0, SURF, 0, H);
  wg.addColorStop(0, '#3a86ab'); wg.addColorStop(1, '#0d2c43');
  ctx.fillStyle = wg; ctx.fillRect(0, SURF, W, H - SURF);
  const hi = new Float32Array(n), cen = new Float32Array(n), lo = new Float32Array(n), rk = new Float32Array(n);
  for (let c = 0; c < n; c++) {
    hi[c] = sl.envTop(sl.x0 + c); lo[c] = sl.envLow(sl.x0 + c);
    rk[c] = r.rock[r.idx(sl.centerCol, sl.x0 + c)];
  }
  // Gelände: Profil als geschlossener Pfad (Hüllkurve = höchster Punkt über den Kasten); darin Sediment je Material und Fels
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0, H);
  ctx.lineTo(0, Y(hi[0]));
  for (let c = 0; c < n; c++) ctx.lineTo(xs(c), Y(hi[c]));
  ctx.lineTo(W, Y(hi[n - 1])); ctx.lineTo(W, H); ctx.closePath(); ctx.clip();
  const kindColor = (c) => hexToRgb(CONFIG.materials[r.kind[r.idx(sl.centerCol, sl.x0 + Math.min(n - 1, Math.max(0, c)))]].color);
  for (let c = 0; c < n; c++) { // Sediment je Material, an den Zellgrenzen weich ineinander übergehend
    const g = ctx.createLinearGradient(c * U, 0, (c + 1) * U, 0), mid = kindColor(c);
    g.addColorStop(0, rgb(mix(kindColor(c - 1), mid, 0.5))); g.addColorStop(0.5, rgb(mid)); g.addColorStop(1, rgb(mix(mid, kindColor(c + 1), 0.5)));
    ctx.fillStyle = g; ctx.fillRect(c * U - (c ? 0 : 60), Y(hi[c]) - 2, U + 1 + (c ? 0 : 60) + (c === n - 1 ? 60 : 0), H);
  }
  for (let c = 0; c < n; c++) {
    const i = r.idx(sl.centerCol, sl.x0 + c), top = Y(hi[c]), bottom = Y(Math.min(hi[c], Math.max(r.rock[i], wl - 20)));
    if (r.hard[i] && r.top[i] - r.rock[i] > 0.05) { ctx.fillStyle = r.hard[i] > 1 ? 'rgba(25,18,10,.5)' : 'rgba(25,18,10,.28)'; ctx.fillRect(c * U, top, U, Math.max(0, bottom - top)); }
    if (r.kind[i] === KIND.altlast) { ctx.fillStyle = 'rgba(255,140,60,.35)'; ctx.fillRect(c * U, top, U, Math.max(0, bottom - top)); }
  }
  ctx.fillStyle = '#5d6168'; ctx.beginPath(); // Fels darunter als glatte Fläche
  ctx.moveTo(-10, H + 10); ctx.lineTo(-10, Y(rk[0]));
  for (let c = 0; c < n; c++) ctx.lineTo(xs(c), Y(Math.min(hi[c], rk[c])));
  ctx.lineTo(W + 10, Y(Math.min(hi[n - 1], rk[n - 1]))); ctx.lineTo(W + 10, H + 10); ctx.closePath(); ctx.fill();
  const dark = ctx.createLinearGradient(0, SURF, 0, H); dark.addColorStop(0, 'rgba(0,0,0,0)'); dark.addColorStop(1, 'rgba(0,0,0,.4)');
  ctx.fillStyle = dark; ctx.fillRect(0, SURF, W, H - SURF);
  ctx.restore();
  for (let c = 0; c < n; c++) { // Rohstoffvorkommen: goldene Tönung und Kennzeichnung
    const dep = r.deposits?.[(r.dep[r.idx(sl.centerCol, sl.x0 + c)] || 0) - 1];
    if (dep?.known) { const top = Y(hi[c]); ctx.fillStyle = dep.owned ? 'rgba(255,215,80,.30)' : 'rgba(255,215,80,.14)'; ctx.fillRect(c * U, top, U, Math.max(0, Y(Math.min(hi[c], Math.max(r.rock[r.idx(sl.centerCol, sl.x0 + c)], wl - 20))) - top)); ctx.fillStyle = '#ffe9a0'; ctx.fillRect(c * U + 2, top + 2, U - 4, 3); }
  }
  // Land über Wasser: grüne Grasnarbe
  for (let c = 0; c < n; c++) {
    if (hi[c] > wl) { const strip = r.ext[r.idx(sl.centerCol, sl.x0 + c)] === 1; ctx.fillStyle = strip ? '#c9b050' : '#6fa05a'; ctx.fillRect(c * U, Y(hi[c]) - 3, U + 1, 8); }
  }
  // Naturschutzzone (Ufer, Flachwasser): kräftig grün getönt, schraffiert, mit Leuchtband auf der Sohle und Grenzlinien
  const prot = (c) => { const i = r.idx(sl.centerCol, sl.x0 + c); return !(r.zone[i] || (sl.tool === 'loeffel' && r.ext[i])) && hi[c] < wl; };
  for (let c = 0; c < n; c++) {
    if (!prot(c)) continue;
    const top = Math.max(SURF, Y(hi[c])), hgt = top - SURF;
    ctx.fillStyle = 'rgba(70,230,110,.26)'; ctx.fillRect(c * U, SURF, U, hgt);
    ctx.save(); ctx.beginPath(); ctx.rect(c * U, SURF, U, hgt); ctx.clip();
    ctx.strokeStyle = 'rgba(190,255,190,.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let k = -hgt; k < U; k += 9) { ctx.moveTo(c * U + k, SURF); ctx.lineTo(c * U + k + hgt, top); }
    ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(110,255,140,.85)'; ctx.fillRect(c * U, top - 5, U, 5); // Leuchtband auf der geschützten Sohle
  }
  ctx.strokeStyle = '#7dff9a'; ctx.lineWidth = 2; ctx.setLineDash([7, 4]);
  for (let c = 0; c <= n; c++) { // Grenzlinie, wo Schutzzone und Baggerkorridor aneinanderstossen
    const a = c > 0 && prot(c - 1), b = c < n && prot(c);
    if (a === b) continue;
    const x = c * U, cc = Math.min(n - 1, c), top = Math.max(SURF, Y(hi[a ? c - 1 : cc]));
    ctx.beginPath(); ctx.moveTo(x, SURF); ctx.lineTo(x, Math.min(H, top + 40)); ctx.stroke();
  }
  ctx.setLineDash([]);
  { // Beschriftung, wo Platz ist (zusammenhängende Strecken)
    ctx.font = font(12); ctx.textAlign = 'center';
    for (let c = 0, s0 = -1; c <= n; c++) {
      const p = c < n && prot(c);
      if (p && s0 < 0) s0 = c;
      if (!p && s0 >= 0) {
        if (c - s0 >= 2) { const x = ((s0 + c) / 2) * U, tx = '🌿 Naturschutz'; ctx.fillStyle = '#0a3a1acc'; const w = ctx.measureText(tx).width + 10; ctx.fillRect(x - w / 2, SURF + 6, w, fs(12) + 4); ctx.fillStyle = '#b8ffc6'; ctx.fillText(tx, x, SURF + 6 + fs(12)); }
        s0 = -1;
      }
    }
    ctx.textAlign = 'start';
  }
  // Automatik-Begrenzung: zwei ziehbare Linien (nur mit Automatik), ausserhalb abgedunkelt
  if (sl.stats.autoLevel > 0) {
    const [xa, xb] = autoLineX(sl);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    if (xa > 0) ctx.fillRect(0, SURF, xa, H - SURF);
    if (xb < W) ctx.fillRect(xb, SURF, W - xb, H - SURF);
    ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
    for (const [x, dir] of [[xa, 1], [xb, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, SURF); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#7fe3ff'; // Griff: Fähnchen oben, gut greifbar
      ctx.beginPath(); ctx.moveTo(x, SURF + 4); ctx.lineTo(x + dir * 24, SURF + 16); ctx.lineTo(x, SURF + 28); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#06324a'; ctx.font = font(11); ctx.textAlign = 'center'; ctx.fillText('🤖', x + dir * 9, SURF + 20); ctx.textAlign = 'start';
      ctx.setLineDash([4, 4]);
    }
    ctx.setLineDash([]);
  }
  // Profilkanten: dick = engste Stelle (höchster Punkt), dünn = tiefster Punkt im Kasten
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath();
  for (let c = 0; c < n; c++) (c ? ctx.lineTo(xs(c), Y(lo[c])) : ctx.moveTo(xs(c), Y(lo[c])));
  ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = '#f0e4c8'; ctx.lineWidth = 2.5; ctx.beginPath();
  for (let c = 0; c < n; c++) (c ? ctx.lineTo(xs(c), Y(hi[c])) : ctx.moveTo(xs(c), Y(hi[c])));
  ctx.stroke();
  for (let c = 0; c < n; c++) { // Betonschicht: graue Kappe auf der Sohle
    const a = r.armor[r.idx(sl.centerCol, sl.x0 + c)];
    if (a > 0 && hi[c] < wl + 1) { ctx.fillStyle = 'rgba(200,204,210,.92)'; ctx.fillRect(c * U, Y(hi[c]) - 1, U + 1, Math.max(3, a * PPM)); ctx.strokeStyle = 'rgba(70,75,85,.8)'; ctx.lineWidth = 1; ctx.strokeRect(c * U + 0.5, Y(hi[c]) - 0.5, U, Math.max(3, a * PPM)); }
  }
  // Wasserspiegel
  ctx.strokeStyle = '#d9f1ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, SURF); ctx.lineTo(W, SURF); ctx.stroke();

  // Klassen-Tiefenlinien (dünn) und Solltiefe (orange)
  ctx.font = font(12, false);
  ctx.textAlign = 'right';
  for (const cls of SHIPS) {
    if (!game.level.classes.includes(cls.id)) continue;
    const y = Y(wl - needDepth(cls)), on = ui.classSel === cls.id, ok = game.fair?.[cls.id]?.passable;
    ctx.strokeStyle = cls.color; ctx.globalAlpha = on ? 0.95 : 0.4; ctx.lineWidth = on ? 2 : 1; ctx.setLineDash([2, 6]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
    if (on) { const ym = Y(wl - minNeedDepth(cls)); ctx.globalAlpha = 0.55; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(0, ym); ctx.lineTo(W, ym); ctx.stroke(); ctx.setLineDash([]); } // Mindesttiefe
    ctx.globalAlpha = on ? 1 : 0.75; ctx.fillStyle = '#000a'; const lf = game.fair?.[cls.id]?.loadFactor, label = `${ok ? '✓ ' : ''}${cls.name} ${minNeedDepth(cls).toFixed(1)}–${needDepth(cls).toFixed(1)} m${ok ? ` · ${Math.round(lf * 100)} % Ladung` : ''}`; const tw = ctx.measureText(label).width;
    ctx.fillRect(W - tw - 12, y - fs(12) + 1, tw + 8, fs(12) + 3); ctx.fillStyle = on ? '#fff' : cls.color; ctx.fillText(label, W - 6, y);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'start';
  const ty = Y(sl.targetTop());
  ctx.strokeStyle = '#ffae3d'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
  ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffae3d'; ctx.font = font(13); ctx.fillText(`Solltiefe ${sl.targetDepth.toFixed(1)} m`, 8, ty - 5);

  // Markierungen: wo liegt noch Sohle über der Solltiefe (rot, cm), wo steckt Fels
  ctx.textAlign = 'center';
  for (let c = 0; c < n; c++) {
    const i = r.idx(sl.centerCol, sl.x0 + c);
    if (!r.zone[i] || hi[c] >= wl) continue;
    const miss = hi[c] - sl.targetTop();
    if (miss > 0.03) {
      const x = xs(c), y = Y(hi[c]) - 6;
      ctx.fillStyle = '#ff5d4d'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y - 10); ctx.lineTo(x + 6, y - 10); ctx.closePath(); ctx.fill();
      ctx.font = font(11); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000a'; ctx.lineWidth = 3; ctx.strokeText(`${Math.round(miss * 100)}`, x, y - 13); ctx.fillText(`${Math.round(miss * 100)}`, x, y - 13);
      if (rk[c] > sl.targetTop()) { ctx.fillStyle = '#c59aff'; ctx.fillText('Fels', x, y - 26); }
    }
  }
  ctx.textAlign = 'start';
  if (sl.tool === 'loeffel') { // Hinweis auf abtragbares Land
    ctx.font = font(12); ctx.textAlign = 'center'; ctx.fillStyle = '#e8d27a';
    for (let c = 0; c < n; c++) { const i = r.idx(sl.centerCol, sl.x0 + c); if (r.ext[i] === 1 && hi[c] > wl && (c === 0 || r.ext[r.idx(sl.centerCol, sl.x0 + c - 1)] !== 1)) ctx.fillText('Ausbaustreifen', c * U + 40, Y(hi[c]) - 10); }
    ctx.textAlign = 'start';
  }
  // Fremdstoffe
  for (let c = 0; c < n; c++) for (const col of sl.cols) {
    const i = r.idx(col, sl.x0 + c);
    if (r.debris[i] && r.isWater(i)) { ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(xs(c), Y(r.top[i]) - 6, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#222'; ctx.stroke(); break; }
  }

  drawPump(ctx, game, sim, ui);
  turbidityVeil(ctx, sim);
  if (sl.freeing && sl.clog > 0) drawFreeing(ctx, sl);
  // Kopfzeile
  ctx.font = font(13); ctx.fillStyle = '#000a'; const head = `Pegel ${wl.toFixed(2)} m · Spalten ${sl.cols[0] + 1}–${sl.cols[sl.cols.length - 1] + 1}`;
  ctx.fillRect(6, 6, ctx.measureText(head).width + 14, fs(13) + 8); ctx.fillStyle = '#fff'; ctx.fillText(head, 13, 6 + fs(13) + 1);
}

function drawPump(ctx, game, sim, ui) {
  if (sim.slice.tool === 'loeffel' || sim.slice.tool === 'beton') return drawBucket(ctx, game, sim, ui);
  const sl = sim.slice, wl = game.river.wl;
  const head = sliceHeadScreen(sl), pumpX = head.x + PW * 0.2, py = head.y;
  const dt = ui.dt ?? 1 / 60;
  // Ponton: Deck oben auf dem Wasser, Schiene, Laufkatze über der Pumpe
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(40, SURF - 22, W - 80, 26);
  ctx.fillStyle = '#9aa4ad'; ctx.fillRect(40, SURF - 22, W - 80, 6);
  ctx.fillStyle = '#222'; for (let i = 0; i < 24; i++) { ctx.beginPath(); ctx.arc(54 + i * ((W - 108) / 23), SURF - 6, 2.5, 0, Math.PI * 2); ctx.fill(); }
  const trolleyY = SURF - 28;
  ctx.fillStyle = '#e8c33a'; ctx.fillRect(pumpX - 16, trolleyY - 8, 32, 14); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(pumpX - 8, trolleyY + 7, 3, 0, 7); ctx.arc(pumpX + 8, trolleyY + 7, 3, 0, 7); ctx.fill();
  const tipOff = sl.tipped > 0 ? 1 : sl.tilt;
  chain.update(dt, pumpX, trolleyY + 6, pumpX, py - PH + 6);
  drawChain(ctx, chain);
  // Pumpe: hochkantes Rechteck, Einsaugöffnung unten vorne (rechts)
  const ang = sl.tipped > 0 ? Math.PI / 2 * 0.92 : Math.max(-0.4, Math.min(0.4, chain.endAngle())) * 0.5 + sl.tilt * 0.5 * (sl.tilt > 0.6 ? Math.sin(performance.now() / 70) * 0.15 + 0.6 : 0.3);
  ctx.save(); ctx.translate(pumpX, py); ctx.rotate(ang);
  ctx.fillStyle = sl.clog > 0 ? '#a64a3a' : '#e07a2a'; ctx.strokeStyle = '#3a1a05'; ctx.lineWidth = 2;
  ctx.fillRect(-PW / 2, -PH, PW, PH); ctx.strokeRect(-PW / 2, -PH, PW, PH);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-PW / 2 + 3, -PH + 8, PW - 6, 6); ctx.fillRect(-PW / 2 + 3, -PH + 18, PW - 6, 6);
  ctx.fillStyle = sl.suctioning ? '#7bd88f' : '#555'; ctx.fillRect(-PW / 2 + 3, -PH + 28, PW - 6, 6);
  ctx.fillStyle = '#444'; ctx.fillRect(PW / 2 - 2, -12, 10, 12); // Saugrohr
  ctx.restore();
  void tipOff;
  const m = sliceMouthScreen(sl);
  if (sl.suctioning) { // Sog
    ctx.fillStyle = 'rgba(255,230,160,.18)'; ctx.beginPath(); ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - 34, m.y + 46); ctx.lineTo(m.x + 34, m.y + 46); ctx.closePath(); ctx.fill();
  }
  // Saugradius als schwache Kontur
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(m.x, m.y, sl.toolParams().radius * U, sl.toolParams().radius * PPM, 0, 0, Math.PI * 2); ctx.stroke();
  // Schieflage und Hubhöhe
  if (sl.setH - sl.h < -0.05 || sl.h - sl.setH > 0.05) { const sy = sliceY(sl.setH, wl); ctx.strokeStyle = '#ffa94d'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pumpX - 22, sy); ctx.lineTo(pumpX + 22, sy); ctx.stroke(); ctx.setLineDash([]); }
  if (sl.auto.on) { ctx.font = font(13); ctx.fillStyle = '#7fe3ff'; ctx.fillText(sl.auto.error ? '🤖 Fehler! (R)' : '🤖 Automatik', pumpX + 20, py - PH - 4); }
}

// Löffelbagger: Ausleger von der Laufkatze mit Knick zur Schaufel; beim Graben schwingt die Schaufel
function drawBucket(ctx, game, sim, ui) {
  const sl = sim.slice, m = sliceMouthScreen(sl), head = sliceHeadScreen(sl);
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(40, SURF - 22, W - 80, 26);
  ctx.fillStyle = '#9aa4ad'; ctx.fillRect(40, SURF - 22, W - 80, 6);
  ctx.fillStyle = '#222'; for (let i = 0; i < 24; i++) { ctx.beginPath(); ctx.arc(54 + i * ((W - 108) / 23), SURF - 6, 2.5, 0, Math.PI * 2); ctx.fill(); }
  const bx = head.x, by = SURF - 26, tx = m.x, ty = m.y - 12;
  ctx.fillStyle = '#e8c33a'; ctx.fillRect(bx - 18, by - 12, 36, 18); ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(bx - 9, by + 7, 3, 0, 7); ctx.arc(bx + 9, by + 7, 3, 0, 7); ctx.fill();
  const mx = (bx + tx) / 2, my = (by + ty) / 2, dx = tx - bx, dy = ty - by, len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(60, len * 0.28) * (sl.suctioning ? 1 + 0.25 * Math.sin((ui.t ?? 0) * 7) : 1);
  const ex = mx + (dy / len) * bend, ey = my - (dx / len) * bend; // Knick zur Seite
  const pour = sl.tool === 'beton';
  ctx.strokeStyle = pour ? '#9aa1a8' : '#e8c33a'; ctx.lineWidth = pour ? 12 : 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.strokeStyle = '#3b2f08'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.lineCap = 'butt';
  if (pour) { // Schüttrohr: Düse und fallender Beton
    ctx.fillStyle = '#5c6168'; ctx.fillRect(tx - 9, ty - 4, 18, 22); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2; ctx.strokeRect(tx - 9, ty - 4, 18, 22);
    if (sl.suctioning) { ctx.fillStyle = 'rgba(190,194,200,.85)'; for (let k = 0; k < 7; k++) { const f = ((ui.t ?? 0) * 3 + k / 7) % 1; ctx.fillRect(tx - 5 + Math.sin(k * 5) * 6, ty + 18 + f * 46, 6, 8); } }
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(m.x, m.y, sl.toolParams().radius * U, sl.toolParams().radius * PPM, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.font = font(13); ctx.fillStyle = (sim.concreteAvail ?? 0) > 0.05 ? '#dfe3e8' : '#ff9d8f'; ctx.fillText(`Beton ${(sim.concreteAvail ?? 0).toFixed(0)} m³`, bx + 22, by - 14);
    return;
  }
  const swing = sl.suctioning ? Math.sin((ui.t ?? 0) * 7) * 0.5 : 0;
  ctx.save(); ctx.translate(tx, ty); ctx.rotate(0.3 + swing);
  ctx.fillStyle = '#6b6f73'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(16, -6); ctx.lineTo(20, 14); ctx.lineTo(-10, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9c9c9'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-8 + k * 8, 17); ctx.lineTo(-4 + k * 8, 17); ctx.lineTo(-6 + k * 8, 24); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(m.x, m.y, sl.toolParams().radius * U, sl.toolParams().radius * PPM, 0, 0, Math.PI * 2); ctx.stroke();
  if (sl.auto.on) { ctx.font = font(13); ctx.fillStyle = '#7fe3ff'; ctx.fillText(sl.auto.error ? '🤖 Fehler! (R)' : '🤖 Automatik', bx + 22, by - 14); }
}

function drawFreeing(ctx, sl) {
  const f = sl.freeing, bw = 360, bh = 26, x = (W - bw) / 2, y = 118;
  ctx.fillStyle = '#000c'; ctx.fillRect(x - 12, y - 34, bw + 24, bh + 50);
  ctx.fillStyle = '#fff'; ctx.font = font(15); ctx.textAlign = 'center'; ctx.fillText(`Freispülen: ${f.item ?? 'Fremdstoff'}`, W / 2, y - 12);
  ctx.fillStyle = '#34495e'; ctx.fillRect(x, y, bw, bh);
  ctx.fillStyle = '#4bd16a'; ctx.fillRect(x + (f.zoneC - f.zone / 2) * bw, y, f.zone * bw, bh);
  ctx.fillStyle = '#fff'; ctx.fillRect(x + f.pos * bw - 3, y - 4, 6, bh + 8);
  ctx.font = font(12, false); ctx.fillStyle = '#cfe'; ctx.fillText(`Treffer ${f.hits}/${f.need} · im grünen Bereich auslösen (Leertaste / Knopf)`, W / 2, y + bh + 16);
  ctx.textAlign = 'start';
}

export { CARGOS };

// ---------- Minispiel: Aufläufer freischleppen ----------
export function drawTowView(ctx, game, tow, ui = {}) {
  const t = ui.t ?? 0, SURFY = 150, cls = tow.cls;
  const sky = ctx.createLinearGradient(0, 0, 0, SURFY); sky.addColorStop(0, '#6aa6d2'); sky.addColorStop(1, '#bcd9ee');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, SURFY);
  const wg = ctx.createLinearGradient(0, SURFY, 0, H); wg.addColorStop(0, '#3a86ab'); wg.addColorStop(1, '#0d2c43');
  ctx.fillStyle = wg; ctx.fillRect(0, SURFY, W, H - SURFY);
  // Untiefe: links hoch, nach rechts tiefer
  const barY = (x) => (x < 360 ? 205 + x * 0.30 : 313 + (x - 360) * 0.02);
  ctx.fillStyle = '#c8b27c'; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, barY(0));
  for (let x = 0; x <= W; x += 20) ctx.lineTo(x, barY(x));
  ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#f0e4c8'; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = '#d9f1ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, SURFY); ctx.lineTo(W, SURFY); ctx.stroke();
  // Ponton mit Winde rechts
  const px = W - 110, py = SURFY;
  ctx.fillStyle = '#e8c33a'; ctx.strokeStyle = '#3b2f08'; ctx.lineWidth = 2; ctx.fillRect(px - 70, py - 22, 140, 30); ctx.strokeRect(px - 70, py - 22, 140, 30);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(px - 10, py - 40, 20, 20);
  // Schiff (Seitenansicht), rückt mit dem Fortschritt nach rechts
  const frac = Math.min(1, tow.progress / tow.need), sx = 90 + frac * 330, sy = barY(sx) - 16, ang = Math.atan2(barY(sx + 30) - barY(sx - 30), 60);
  const len = 150 + cls.len * 10, hh = 26 + cls.draught * 4;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
  ctx.fillStyle = cls.color; ctx.strokeStyle = '#10202c'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-len / 2, -hh * 0.5); ctx.lineTo(len / 2 - 14, -hh * 0.5); ctx.lineTo(len / 2 + 10, -hh * 0.1); ctx.lineTo(len / 2 - 20, hh * 0.5); ctx.lineTo(-len / 2 + 10, hh * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f4f4f0'; ctx.fillRect(-len / 2 + 8, -hh * 0.5 - 22, 34, 22); ctx.fillStyle = '#7fd3ff'; ctx.fillRect(-len / 2 + 14, -hh * 0.5 - 17, 22, 8);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-len / 2 + 50, -hh * 0.5 - 8, len - 90, 8);
  ctx.restore();
  // Schleppleine: Farbe nach Spannung, Durchhang bei wenig Zug
  const [b0, b1] = tow.band, tn = tow.tension, color = tn > b1 ? '#ff5d4d' : tn >= b0 ? '#7bf0a0' : '#ffd24d';
  const ax = sx + len / 2 - 10, ay = sy - 4, bx = px - 40, by = py - 8, sag = (1 - Math.min(1, tn)) * 38 + 4;
  ctx.strokeStyle = color; ctx.lineWidth = 3 + tn * 3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag + Math.sin(t * 9) * tn * 3, bx, by); ctx.stroke();
  // Spannungsanzeige mit grünem Band
  const gw = 420, gh = 26, gx = (W - gw) / 2, gy = H - 54;
  ctx.fillStyle = '#000b'; ctx.fillRect(gx - 14, gy - 58, gw + 28, 112);
  ctx.fillStyle = '#34495e'; ctx.fillRect(gx, gy, gw, gh);
  ctx.fillStyle = '#4bd16a'; ctx.fillRect(gx + b0 * gw, gy, (b1 - b0) * gw, gh);
  ctx.fillStyle = '#c0453a'; ctx.fillRect(gx + CONFIG_TOW_SNAP() * gw - 4, gy, 4, gh);
  ctx.fillStyle = '#fff'; ctx.fillRect(gx + Math.min(1, tn) * gw - 3, gy - 5, 6, gh + 10);
  ctx.fillStyle = '#34495e'; ctx.fillRect(gx, gy - 24, gw, 10);
  ctx.fillStyle = '#7fe3ff'; ctx.fillRect(gx, gy - 24, gw * frac, 10);
  ctx.font = font(14); ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
  ctx.fillText(`${cls.name} aufgelaufen · noch ${Math.ceil(tow.timeLeft)} s${tow.snaps ? ` · ${tow.snaps}× Leine gerissen` : ''}`, W / 2, gy - 34);
  ctx.font = font(12, false); ctx.fillStyle = '#cfe'; ctx.fillText('Zugtaste halten (Leertaste / Knopf): Spannung im grünen Bereich halten, nicht über die rote Marke', W / 2, gy + gh + 18);
  ctx.textAlign = 'start';
}
const CONFIG_TOW_SNAP = () => CONFIG.tow.snapAt;
export { groundedNear };
