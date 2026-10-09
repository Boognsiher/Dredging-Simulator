// Zeichnet Karte und Querschnitt. Kennt keine Spiellogik, liest nur Zustand.
import { SLICE } from '../sim/slice.js';
import { CONFIG, SHIPS, KIND, CARGOS, shipById, cargoById, depositType } from '../config.js';
import { shipPos, queuePos, bayCapacity } from '../sim/traffic.js';
import { needDepth, minNeedDepth, trasseY } from '../sim/fairway.js';
import { drawTerrain, drawWaterFx, drawShipSprite, drawPontoonSprite, drawAmbient } from './gfx.js';
import { PORT, bayDepth, bayReady, bayTarget, dockPos, berthsOf, waitsOf, isDocked, kaiLevel, bridgeLevel } from '../sim/port.js';
import { HARBOR, berthPos, waitPos } from '../sim/harbor.js';
import { areaWork, wallSpans } from '../sim/fleet.js';
import { LAND, landOf, connectedRoads, hallConnected, roadBlock, hallBlock } from '../sim/land.js';
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

// Beschriftungen auf der Karte weichen einander aus: jede neue Beschriftung sucht von ihrer Wunschstelle aus die nächste freie Stelle (erst nach unten, dann nach oben)
let LABELS = [];
function labelDy(x, y, w, h) {
  const hit = (yy) => LABELS.some((b) => x < b.x + b.w && b.x < x + w && yy < b.y + b.h && b.y < yy + h);
  let dy = 0;
  for (let k = 0; k < 9; k++) { const o = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (h + 1); if (y + o >= 0 && !hit(y + o)) { dy = o; break; } }
  LABELS.push({ x, y: y + dy, w, h });
  return dy;
}
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
  if (drawTerrain(ctx, game)) drawWaterFx(ctx, ui); // weiches Gelände und Wasser (gfx.js)
  else { ctx.fillStyle = rgb(pal.land); ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < rows; y++) for (let x = -MARGIN; x < cols + MARGIN; x++) { const cx = Math.min(cols - 1, Math.max(0, x)), i = y * cols + cx; ctx.fillStyle = rgb(cellColor(r, i, pal)); ctx.fillRect(OX + x * CELL, y * CELL, CELL + 0.5, CELL + 0.5); } }
  // Baggerkorridor: ausserhalb (Ufer und Flachwasser) liegt die Naturschutzzone
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (r.isWater(i) && !r.zone[i]) { ctx.fillStyle = 'rgba(70,230,110,.2)'; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); if ((x + y) % 2 === 0) { ctx.fillStyle = 'rgba(200,255,200,.22)'; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); } }
      else if (!r.isWater(i) && r.ext[i] === 1) { ctx.fillStyle = 'rgba(235,200,70,.16)'; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); } // Ausbaustreifen am Ufer (Löffelbagger)
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
      if (r.armor[i] > 0) { // Beton: Betonblock mit hellem Rand oben links und Schatten unten rechts
        const bg = ctx.createLinearGradient(px, py, px + CELL, py + CELL); bg.addColorStop(0, 'rgba(214,217,222,.82)'); bg.addColorStop(1, 'rgba(150,155,162,.82)');
        ctx.fillStyle = bg; ctx.fillRect(px, py, CELL, CELL);
        ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(px, py, CELL, 1.5); ctx.fillRect(px, py, 1.5, CELL);
        ctx.fillStyle = 'rgba(40,46,54,.35)'; ctx.fillRect(px, py + CELL - 1.5, CELL, 1.5); ctx.fillRect(px + CELL - 1.5, py, 1.5, CELL);
      }
      if (r.debris[i]) { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(px + 5, py + 5, 6, 6); ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(px + 5.5, py + 5.5, 5, 5); }
    }
  }
  LABELS = [];
  drawTribs(ctx, game, ui);
  drawDeposits(ctx, game, ui);
  // Auswahl einer Schiffsklasse: wo fehlt Tiefe, wo läuft die günstigste Rinne
  const sel = ui.classSel && game.fair?.[ui.classSel] ? shipById(ui.classSel) : null;
  if (sel) drawClassOverlay(ctx, game, sel);
  drawZones(ctx, game, ui);
  drawHarbor(ctx, game);
  drawPiles(ctx, game, ui); drawTrasse(ctx, game);
  drawAreas(ctx, game, ui);
  drawLandSide(ctx, game, ui);
  drawShips(ctx, game, ui);
  drawFleet(ctx, game, ui);
  if (sim) drawPontoon(ctx, game, sim, ui);
  // schwebende Beträge
  ctx.font = font(15); ctx.textAlign = 'center';
  for (const f of ui.floaters ?? []) {
    ctx.globalAlpha = Math.min(1, f.life / 0.6);
    const p = mapPx(f.x, f.y - (1.6 - f.life) * 1.2);
    ctx.fillStyle = '#000a'; ctx.fillText(f.text, p.x + 1, p.y + 1); ctx.fillStyle = f.color; ctx.fillText(f.text, p.x, p.y);
  }
  ctx.globalAlpha = 1; ctx.textAlign = 'start';
  drawAmbient(ctx, game, ui);
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
  // Kreuzungsmöglichkeit: Spalten, in denen zwei Rinnen nebeneinander Platz haben (limegrüne Marke am oberen Rand)
  if (f.cross && f.path) { // limegrüne Marken über der Rinne dort, wo zwei Rinnen nebeneinander Platz haben
    ctx.fillStyle = 'rgba(190,255,90,.85)';
    for (let x = 0; x < r.cols; x++) { if (!f.cross[x]) continue; const q = f.path.points.find((pt) => Math.floor(pt.x) >= x) ?? f.path.points[f.path.points.length - 1]; ctx.fillRect(OX + x * CELL + 1, q.y * CELL - (cls.beam * CELL) / 2 - 9, CELL - 2, 5); }
  }
  if (f.secondPath) { // zweite, getrennte Rinne (Gegenverkehr ohne Warten): orange; noch nicht tief genug: blass gestrichelt mit der fehlenden Menge
    const sp = f.secondPath.points;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = f.twoWay ? 1 : 0.55; ctx.strokeStyle = 'rgba(255,170,70,.28)'; ctx.lineWidth = cls.beam * CELL * 0.9;
    ctx.beginPath(); sp.forEach((p, k) => (k ? ctx.lineTo(OX + p.x * CELL, p.y * CELL) : ctx.moveTo(OX + p.x * CELL, p.y * CELL))); ctx.stroke();
    ctx.strokeStyle = '#ffb04d'; ctx.lineWidth = 2; ctx.setLineDash(f.twoWay ? [8, 6] : [3, 7]); ctx.stroke(); ctx.restore();
    const mid = sp[Math.floor(sp.length / 2)]; ctx.font = font(11); const t = f.twoWay ? '2. Rinne' : `2. Rinne möglich: fehlt ${Math.round(f.secondVolume)} m³`, tw = ctx.measureText(t).width + 8;
    const rdy = labelDy(OX + mid.x * CELL - tw / 2, mid.y * CELL - fs(11) - 6, tw, fs(11) + 4);
    ctx.fillStyle = '#000b'; ctx.fillRect(OX + mid.x * CELL - tw / 2, mid.y * CELL - fs(11) - 6 + rdy, tw, fs(11) + 4); ctx.fillStyle = '#ffd9a8'; ctx.fillText(t, OX + mid.x * CELL - tw / 2 + 4, mid.y * CELL - 8 + rdy);
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
    if (s.state === 'queue') { const rank = ranks[s.dir]++; p = queuePos(game, s, rank); counts[s.dir]++; } else if (s.state === 'dock') p = dockPos(game, s); else p = shipPos(s);
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
  const q = mapPx(p.x, p.y), L = cls.len * CELL;
  drawShipSprite(ctx, cls, ship, p, ui, game, cargoById(ship.cargo)?.color);
  if (ship.state === 'grounded') {
    const pulse = 0.5 + 0.5 * Math.sin((ui.t ?? 0) * 5), near = ui.towShip === ship.id;
    ctx.strokeStyle = near ? `rgba(120,255,160,${0.5 + 0.4 * pulse})` : `rgba(255,120,100,${0.35 + 0.4 * pulse})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(q.x, q.y, L / 2 + 8 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
    ctx.font = font(18); ctx.textAlign = 'center'; ctx.fillStyle = (Math.floor((ui.t ?? 0) * 3) % 2) ? '#ff7a6b' : '#fff';
    ctx.fillText('⚠', q.x, q.y - 12);
    ctx.font = font(12); ctx.fillStyle = near ? '#9bf5b8' : '#ffb4a8'; ctx.fillText(near ? 'Schleppen: T' : 'aufgelaufen', q.x, q.y + L / 2 + 20); ctx.textAlign = 'start';
  }
}


// Ponton neben der Rinne zeichnen: liegt der Arbeitspunkt in der Fahrrinne, sitzt der Ponton daneben (auf der Seite mit Wasser) und das Saugrohr führt zur Arbeitsstelle.
// Nur die Darstellung: gebaggert wird an der echten Stelle, Schiffe fahren so nicht durch den Ponton.
function besideLane(game, x, y) {
  const r = game.river, cls = [...SHIPS].reverse().find((c) => game.level.classes.includes(c.id) && game.fair?.[c.id]?.passable) ?? SHIPS[0], pts = game.fair?.[cls.id]?.path?.points;
  if (!pts?.length || x < 0 || x > r.cols) return { x, y, moved: false };
  let best = pts[0]; for (const q of pts) if (Math.abs(q.x - x) < Math.abs(best.x - x)) best = q;
  const half = cls.beam / 2 + 1.6;
  if (Math.abs(y - best.y) >= half) return { x, y, moved: false };
  const water = (yy) => yy > 0.6 && yy < r.rows - 0.6 && r.depthAt(r.idx(Math.min(r.cols - 1, Math.max(0, Math.floor(x))), Math.floor(yy))) >= 0.8;
  const first = y >= best.y ? 1 : -1;
  for (const sg of [first, -first]) { const ny = best.y + sg * half; if (water(ny)) return { x, y: ny, moved: true }; }
  return { x, y, moved: false };
}
function hose(ctx, from, to, ui) {
  ctx.save(); ctx.strokeStyle = '#2b2f33'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.quadraticCurveTo((from.x + to.x) / 2 + 6, (from.y + to.y) / 2, to.x, to.y); ctx.stroke();
  const pulse = 0.5 + 0.5 * Math.sin((ui.t ?? 0) * 5); ctx.strokeStyle = `rgba(255,214,90,${0.5 + 0.4 * pulse})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(to.x, to.y, 4 + pulse * 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}
function drawPontoon(ctx, game, sim, ui) {
  if ((game.fleet?.units ?? []).some((u) => u.self)) return; // dein Ponton arbeitet für die Flotte: gezeichnet wird er als Flottenponton (nicht doppelt)
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
  const lent = (game.fleet?.units ?? []).some((u) => u.self); // dein Ponton arbeitet für die Flotte: dort wird er gezeichnet (nicht doppelt)
  const bl = sim.mode === 'slice' ? besideLane(game, sim.x, sim.y) : { moved: false };
  if (lent) { /* gezeichnet von drawFleet */ } else if (bl.moved) { const q = mapPx(bl.x, bl.y); hose(ctx, q, { x: px, y: py }, ui); drawPontoonSprite(ctx, q.x, q.y, true, sim.slice.suctioning, ui); }
  else drawPontoonSprite(ctx, px, py, true, sim.mode === 'slice' && sim.slice.suctioning, ui);
  if (ui.mapTarget && sim.mode === 'map') {
    const t = mapPx(ui.mapTarget.x, ui.mapTarget.y);
    ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.x, t.y, 10, 0, Math.PI * 2);
    ctx.moveTo(t.x - 14, t.y); ctx.lineTo(t.x + 14, t.y); ctx.moveTo(t.x, t.y - 14); ctx.lineTo(t.x, t.y + 14); ctx.stroke();
  }
}

// Vom Spieler festgelegte Rinnenlinien (Hauptrinne türkis, 2. Rinne orange) mit ±1-Zellen-Toleranzband
function drawTrasse(ctx, game) {
  const T = game.river.trasse ?? [];
  T.forEach((pts, k) => {
    if (!pts || pts.length < 2) return;
    const col = k ? '#ffb347' : '#5ee6d6', x0 = -OX / CELL, x1 = game.river.cols;
    const yAt = (x) => trasseY(pts, x - 0.5);
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash([2, 5]); ctx.lineCap = 'round'; ctx.beginPath();
    for (let x = Math.max(0.5, x0); x <= x1 - 0.5; x += 0.5) (x <= 0.5 ? ctx.moveTo(OX + x * CELL, yAt(x) * CELL) : ctx.lineTo(OX + x * CELL, yAt(x) * CELL));
    ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col; for (const p of pts) { ctx.beginPath(); ctx.arc(OX + p.x * CELL, p.y * CELL, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = font(12); const t = k ? '🧭 2. Rinne (festgelegt)' : '🧭 Hauptrinne (festgelegt)', tw = ctx.measureText(t).width + 8, p0 = pts[0];
    ctx.fillStyle = '#000b'; ctx.fillRect(OX + p0.x * CELL, Math.max(0, p0.y * CELL - fs(12) - 8), tw, fs(12) + 3); ctx.fillStyle = col; ctx.fillText(t, OX + p0.x * CELL + 4, Math.max(fs(12), p0.y * CELL - 8));
    ctx.restore();
  });
}

// Pfahlwand: gesetzte Pfähle (Beton mit Nieten), gesicherte Streifen zwischen Pfahl und Ufer (bläulich), geplante Pfähle (gestrichelt), im Planungsmodus Raster, Maus und Linienvorschau
function drawPiles(ctx, game, ui) {
  const r = game.river, cols = r.cols, plan = game.fleet?.pilePlan ?? [];
  if (!r.pile) return;
  for (let i = 0; i < r.pile.length; i++) {
    const x = OX + (i % cols) * CELL, y = ((i / cols) | 0) * CELL;
    if (r.lim[i] > -90 && !r.pile[i]) { ctx.fillStyle = 'rgba(110,150,200,.22)'; ctx.fillRect(x, y, CELL, CELL); }
    if (r.pile[i]) {
      ctx.fillStyle = '#9aa0a8'; ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2); ctx.strokeStyle = '#3d4249'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3);
      ctx.fillStyle = '#3d4249'; ctx.fillRect(x + 4, y + 4, 2.5, 2.5); ctx.fillRect(x + CELL - 7, y + CELL - 7, 2.5, 2.5);
    }
  }
  for (const i of game.fleet?.pileRemove ?? []) { const x = OX + (i % cols) * CELL, y = ((i / cols) | 0) * CELL; ctx.strokeStyle = '#ff7a6b'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]); ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2); ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + CELL - 3, y + CELL - 3); ctx.moveTo(x + CELL - 3, y + 3); ctx.lineTo(x + 3, y + CELL - 3); ctx.stroke(); } // Rückbau vorgemerkt
  for (const i of plan) { const x = OX + (i % cols) * CELL, y = ((i / cols) | 0) * CELL; ctx.fillStyle = 'rgba(120,200,255,.28)'; ctx.fillRect(x, y, CELL, CELL); ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2); ctx.setLineDash([]); }
  if (!ui.pileMode) return;
  ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = 0; x <= cols; x++) { ctx.moveTo(OX + x * CELL, 0); ctx.lineTo(OX + x * CELL, r.rows * CELL); }
  for (let y = 0; y <= r.rows; y++) { ctx.moveTo(OX, y * CELL); ctx.lineTo(OX + cols * CELL, y * CELL); }
  ctx.stroke();
  // Rinne zwischen den Wänden: Breite und welche Klassen fahren (Symbol) bzw. kreuzen können (Symbol mit ↔)
  for (const sp of wallSpans(game)) {
    const x0 = OX + sp.x0 * CELL, x1 = OX + (sp.x1 + 1) * CELL, y0 = sp.rows[0] * CELL, y1 = (sp.rows[1] + 1) * CELL, ok = sp.pass.length > 0;
    ctx.fillStyle = sp.cross.length ? 'rgba(120,230,150,.20)' : ok ? 'rgba(255,224,120,.18)' : 'rgba(255,110,100,.22)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = sp.cross.length ? '#7be39a' : ok ? '#ffe08a' : '#ff8a7a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, (y0 + y1) / 2); ctx.lineTo(x1, (y0 + y1) / 2); ctx.stroke();
    const icons = (ids) => (ids.length ? ids.map((id) => shipById(id).icon).join('') : '–'), lines = [`Breite ${sp.w}${sp.x1 > sp.x0 ? ` · Sp. ${sp.x0 + 1}–${sp.x1 + 1}` : ''}`, `fahren ${icons(sp.pass)}`, `kreuzen ${icons(sp.cross)}`];
    const k0 = 0.9 / (ui.pileZoom || 1); // die Beschriftung bleibt unabhängig vom Zoom lesbar klein
    ctx.save(); ctx.font = font(12); ctx.textAlign = 'center'; const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10, lh = fs(12) + 3, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, bw = tw * k0, bh = (lh * lines.length + 4) * k0, dy = labelDy(cx - bw / 2, cy - bh / 2, bw, bh);
    ctx.translate(cx, cy + dy); ctx.scale(k0, k0); const top = -(lh * lines.length + 4) / 2;
    ctx.fillStyle = '#000c'; ctx.fillRect(-tw / 2, top, tw, lh * lines.length + 4);
    lines.forEach((l, k) => { ctx.fillStyle = k === 0 ? '#fff' : k === 1 ? '#ffe9a0' : '#b9f5c9'; ctx.fillText(l, 0, top + (k + 1) * lh); }); ctx.restore();
  }
  const H = ui.hoverCell, A = ui.pileA;
  if (A && H) { // Linienvorschau
    const x1 = Math.floor(H.x), y1 = Math.floor(H.y), n = Math.max(Math.abs(x1 - A.x), Math.abs(y1 - A.y), 1);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (let s = 0; s <= n; s++) { const x = Math.round(A.x + ((x1 - A.x) * s) / n), y = Math.round(A.y + ((y1 - A.y) * s) / n); ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); }
  } else if (A) { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(OX + A.x * CELL, A.y * CELL, CELL, CELL); }
  if (H) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(OX + Math.floor(H.x) * CELL, Math.floor(H.y) * CELL, CELL, CELL); }
  ctx.font = font(13); const t = A ? 'Zweiten Punkt der Linie antippen' : 'Pfahlwand planen: Zellen antippen (nochmals antippen = aus dem Plan) · Joystick/Pfeile verschieben, ± zoomt'; ctx.textAlign = 'start';
  ctx.fillStyle = '#000b'; ctx.fillRect(OX + 6, H0() - fs(13) - 14, Math.min(ctx.measureText(t).width + 18, W - OX - 12), fs(13) + 8); ctx.fillStyle = '#bfeaff'; ctx.fillText(t, OX + 14, H0() - 12);
}

// Zuflüsse: Bach vom Rand bis zur Mündung, dahinter eine Fahne aus Sand/Kies in der Rinne (je stärker, desto mehr Material kommt an)
function drawTribs(ctx, game, ui) {
  const r = game.river, t0 = ui?.t ?? 0;
  for (const t of r.tribs ?? []) {
    for (let k = 0; k < t.cells.length; k++) { const i = t.cells[k], x = i % r.cols, y = (i / r.cols) | 0; ctx.fillStyle = `rgba(226,196,120,${0.1 + 0.26 * t.w[k]})`; ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL); }
    const y0 = t.side < 0 ? 0 : r.rows * CELL, y1 = (t.side < 0 ? t.my : t.my + 1) * CELL, x0 = OX + (t.x + 0.5) * CELL;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2f77a8'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let s = 1; s <= 8; s++) { const f = s / 8; ctx.lineTo(x0 + Math.sin(f * 7 + t.x) * 6 * (1 - f * 0.4), y0 + (y1 - y0) * f); } ctx.stroke();
    ctx.strokeStyle = '#8fd0f5'; ctx.lineWidth = 3; ctx.setLineDash([6, 8]); ctx.lineDashOffset = -t0 * 14 * (t.side < 0 ? 1 : -1) * -1;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let s = 1; s <= 8; s++) { const f = s / 8; ctx.lineTo(x0 + Math.sin(f * 7 + t.x) * 6 * (1 - f * 0.4), y0 + (y1 - y0) * f); } ctx.stroke(); ctx.restore();
  }
}

// Rohstoffgebiete: ohne Beschriftung, je Art eine eigene Farbe (Kiesbank sandgelb, Quarzsand hellblau, Erzseife orange); mit Konzession kräftig und
// durchgezogener Rand, ohne Konzession blass und gestrichelt. Name, Aufschlag und Rest stehen im Panel «Rohstoffgebiete».
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function drawDeposits(ctx, game) {
  const r = game.river;
  for (const d of r.deposits ?? []) {
    if (!d.known || d.depleted) continue;
    const T = depositType(d.type);
    for (let i = 0; i < r.dep.length; i++) {
      if (r.dep[i] !== d.id) continue;
      const x = i % r.cols, y = (i / r.cols) | 0;
      ctx.fillStyle = rgba(T.color, d.owned ? 0.5 : 0.24); ctx.fillRect(OX + x * CELL, y * CELL, CELL, CELL);
      if ((x + y) % 3 === 0) { ctx.fillStyle = rgba(T.color, d.owned ? 1 : 0.6); ctx.beginPath(); ctx.arc(OX + x * CELL + CELL / 2, y * CELL + CELL / 2, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.strokeStyle = T.color; ctx.lineWidth = d.owned ? 2.5 : 1.5; ctx.setLineDash(d.owned ? [] : [6, 5]);
    ctx.beginPath(); ctx.ellipse(OX + d.cx * CELL, d.cy * CELL, d.rx * CELL, d.ry * CELL, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
}

// Kreuzungsstellen: bereit = grün gestrichelt, geplant = gelb mit rot markierten Zellen, die noch ausgetragen werden müssen.
// Im Setz-Modus zeigt jede Spalte, ob (grün) und wie viel (gelb bis orange) fehlt; unter der Maus steht die Zahl.
function drawZoneWindows(ctx, game, plan, alpha = 0.45, outline = true) {
  const r = game.river;
  for (const w of plan.wins ?? []) for (const a of [w.a, w.b]) for (let k = a; k < a + plan.beam; k++) {
    const i = k * r.cols + w.x;
    if (r.top[i] > plan.needTop || !r.zone[i]) { ctx.fillStyle = `rgba(255,70,60,${alpha})`; ctx.fillRect(OX + w.x * CELL, k * CELL, CELL, CELL); }
  }
  if (!outline) return;
  ctx.strokeStyle = 'rgba(255,230,120,.9)'; ctx.lineWidth = 1.5;
  for (const w of plan.wins ?? []) for (const a of [w.a, w.b]) ctx.strokeRect(OX + w.x * CELL + 1, a * CELL + 1, CELL - 2, plan.beam * CELL - 2);
}

// Landseite des Hafens: Strassen (grau, angebunden heller), Lagerhallen (2×2) und im Baumodus die Vorschau
function drawLandSide(ctx, game, ui) {
  const L = game.port?.land, cols = game.river.cols;
  if (L && (L.roads.length || L.halls.length)) {
    const conn = connectedRoads(game);
    for (const i of L.roads) {
      const x = OX + (i % cols) * CELL, y = ((i / cols) | 0) * CELL, on = conn.has(i);
      ctx.fillStyle = on ? '#8d929b' : '#5f636b'; ctx.fillRect(x, y, CELL, CELL);
      ctx.fillStyle = on ? '#b9bec7' : '#7b7f87'; ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
    }
    for (const h of L.halls) {
      const x = OX + h.x * CELL, y = h.y * CELL, w = LAND.hall.w * CELL, hh = LAND.hall.h * CELL, ok = hallConnected(game, h, conn);
      ctx.fillStyle = ok ? '#9a7550' : '#6f5a46'; ctx.fillRect(x + 1, y + 1, w - 2, hh - 2);
      ctx.fillStyle = ok ? '#c29a68' : '#8a7560'; ctx.fillRect(x + 3, y + 3, w - 6, hh - 6);
      ctx.strokeStyle = '#3d2c1b'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
      ctx.font = font(14); ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText('🏭', x + w / 2, y + hh / 2 + fs(14) * 0.35);
      ctx.font = font(11); const ht = ok ? `Lager ${h.level} ✓` : 'nicht angebunden', hw = ctx.measureText(ht).width + 4, hdy2 = labelDy(x + w / 2 - hw / 2, y - 3 - fs(11), hw, fs(11) + 3);
      ctx.fillStyle = ok ? '#c7f5c9' : '#ffb4a8'; ctx.fillText(ht, x + w / 2, y - 3 + hdy2); ctx.textAlign = 'start';
    }
  }
  if (!ui.landMode) return;
  const H = ui.hoverCell, tool = ui.landTool;
  if (H) {
    const x = Math.floor(H.x), y = Math.floor(H.y), size = tool === 'hall' ? LAND.hall.w : 1;
    const why = tool === 'road' ? roadBlock(game, x, y) : tool === 'hall' ? hallBlock(game, x, y) : null, bad = !!why && (tool === 'road' || tool === 'hall');
    ctx.fillStyle = bad ? 'rgba(255,90,80,.35)' : 'rgba(120,255,160,.30)'; ctx.fillRect(OX + x * CELL, y * CELL, size * CELL, size * CELL);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(OX + x * CELL + 1, y * CELL + 1, size * CELL - 2, size * CELL - 2);
  }
  ctx.font = font(13); const t = { road: 'Strasse: Zellen antippen (nur Land, muss ans Hafenbecken anschliessen)', hall: 'Lagerhalle (2×2): Land antippen, Erdarbeiten sind inbegriffen', auto: 'Halle antippen: Strasse zum Hafenbecken wird automatisch gebaut', demo: 'Antippen: Strasse oder Halle abreissen' }[tool] ?? '';
  ctx.fillStyle = '#000b'; ctx.fillRect(OX + 6, H0() - fs(13) - 14 - 40, Math.min(ctx.measureText(t).width + 18, W - OX - 12), fs(13) + 8); ctx.fillStyle = '#ffe9b0'; ctx.fillText(t, OX + 14, H0() - 12 - 40);
}

// Arbeitsgebiete der gemieteten Pontons (Rechtecke) und die gerade aufgezogene Ecke
function drawAreas(ctx, game, ui) {
  ctx.font = font(12);
  for (const a of game.fleet.areas ?? []) {
    if (a.route) { // Baggerroute: betroffene Zellen schraffiert, Linie mit Wegpunkten
      const left = areaWork(game, a);
      ctx.fillStyle = left ? 'rgba(90,200,255,.22)' : 'rgba(120,230,150,.2)';
      for (const i of a.cells) ctx.fillRect(OX + (i % game.river.cols) * CELL, ((i / game.river.cols) | 0) * CELL, CELL, CELL);
      ctx.strokeStyle = left ? '#5ac8ff' : '#7be39a'; ctx.lineWidth = 2; ctx.setLineDash([7, 4]); ctx.beginPath();
      a.pts.forEach((p, k) => (k ? ctx.lineTo(OX + p.x * CELL, p.y * CELL) : ctx.moveTo(OX + p.x * CELL, p.y * CELL))); ctx.stroke(); ctx.setLineDash([]);
      for (const p of a.pts) { ctx.fillStyle = left ? '#5ac8ff' : '#7be39a'; ctx.beginPath(); ctx.arc(OX + p.x * CELL, p.y * CELL, 3, 0, Math.PI * 2); ctx.fill(); }
      const t = `〰 ${a.id} · ${a.depth.toFixed(1)} m${left ? '' : ' ✓'}`, tw = ctx.measureText(t).width + 8, p0 = a.pts[0], ty = Math.max(0, p0.y * CELL - fs(12) - 6);
      ctx.fillStyle = '#000b'; ctx.fillRect(OX + p0.x * CELL, ty, tw, fs(12) + 3); ctx.fillStyle = '#bfeaff'; ctx.fillText(t, OX + p0.x * CELL + 4, ty + fs(12));
      continue;
    }
    const x = OX + a.x0 * CELL, y = a.y0 * CELL, w = (a.x1 - a.x0 + 1) * CELL, h = (a.y1 - a.y0 + 1) * CELL, left = areaWork(game, a);
    ctx.fillStyle = left ? 'rgba(90,200,255,.14)' : 'rgba(120,230,150,.14)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = left ? '#5ac8ff' : '#7be39a'; ctx.lineWidth = 2; ctx.setLineDash([7, 4]); ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.setLineDash([]);
    const t = `▭ ${a.id} · ${a.depth.toFixed(1)} m${left ? '' : ' ✓'}`, tw = ctx.measureText(t).width + 8;
    ctx.fillStyle = '#000b'; ctx.fillRect(x, y - fs(12) - 3 < 0 ? y : y - fs(12) - 3, tw, fs(12) + 3); ctx.fillStyle = '#bfeaff'; ctx.fillText(t, x + 4, (y - fs(12) - 3 < 0 ? y : y - fs(12) - 3) + fs(12));
  }
  if (ui.areaMode && (ui.areaKind === 'route' || ui.areaKind === 'lane')) { // Route bzw. Rinne im Entstehen: Punkte, Linie, Vorschau zur Maus
    const P = ui.routePts ?? [], H = ui.hoverCell;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath();
    P.forEach((p, k) => (k ? ctx.lineTo(OX + p.x * CELL, p.y * CELL) : ctx.moveTo(OX + p.x * CELL, p.y * CELL))); if (P.length && H) ctx.lineTo(OX + (Math.floor(H.x) + 0.5) * CELL, (Math.floor(H.y) + 0.5) * CELL); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; for (const p of P) { ctx.beginPath(); ctx.arc(OX + p.x * CELL, p.y * CELL, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = font(13); const lane = ui.areaKind === 'lane', t = lane ? (P.length ? 'Nächsten Punkt weiter rechts antippen · letzten Punkt nochmals antippen oder «Rinne: fertig» (R)' : `${ui.laneSlot ? '2. Rinne' : 'Hauptrinne'}: ersten Punkt links antippen`) : P.length ? 'Nächsten Punkt antippen · letzten Punkt nochmals antippen oder «Route: fertig» (N)' : 'Baggerroute: ersten Punkt antippen (auch über Ufer und Land im Ausbaustreifen)';
    ctx.fillStyle = '#000b'; ctx.fillRect(OX + 6, H0() - fs(13) - 14, Math.min(ctx.measureText(t).width + 18, W - OX - 12), fs(13) + 8); ctx.fillStyle = '#bfeaff'; ctx.fillText(t, OX + 14, H0() - 12);
  } else if (ui.areaMode) {
    const A = ui.areaA, H = ui.hoverCell;
    if (A && H) {
      const x0 = Math.floor(Math.min(A.x, H.x)), x1 = Math.floor(Math.max(A.x, H.x)), y0 = Math.floor(Math.min(A.y, H.y)), y1 = Math.floor(Math.max(A.y, H.y));
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(OX + x0 * CELL, y0 * CELL, (x1 - x0 + 1) * CELL, (y1 - y0 + 1) * CELL);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(OX + x0 * CELL + 1, y0 * CELL + 1, (x1 - x0 + 1) * CELL - 2, (y1 - y0 + 1) * CELL - 2);
    } else if (A) { ctx.fillStyle = '#fff'; ctx.fillRect(OX + Math.floor(A.x) * CELL, Math.floor(A.y) * CELL, CELL, CELL); }
    ctx.font = font(13); const t = A ? 'Zweite Ecke wählen' : 'Arbeitsgebiet: erste Ecke wählen (Baggerkorridor, Ausbaustreifen mit Löffel)';
    ctx.fillStyle = '#000b'; ctx.fillRect(OX + 6, H0() - fs(13) - 14, Math.min(ctx.measureText(t).width + 18, W - OX - 12), fs(13) + 8); ctx.fillStyle = '#bfeaff'; ctx.fillText(t, OX + 14, H0() - 12);
  }
}
const H0 = () => H;

// Eigener Hafen: Hafenbecken (Bucht) am Ufer. Gelb gerahmt = muss noch vertieft werden, grün = bereit
function drawHarbor(ctx, game) {
  const bay = game.port?.bay; if (!bay?.cells?.length) return;
  const d = bayDepth(game), ready = bayReady(game), open = game.port.open;
  const x = OX + bay.x0 * CELL, y = bay.y0 * CELL, w = (bay.x1 - bay.x0 + 1) * CELL, h = (bay.y1 - bay.y0 + 1) * CELL;
  ctx.fillStyle = ready ? 'rgba(120,230,150,.22)' : 'rgba(255,200,70,.18)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = ready ? '#7be39a' : '#ffc94a'; ctx.lineWidth = 2; ctx.setLineDash(ready ? [] : [6, 4]); ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.setLineDash([]);
  const cx = x + w / 2, label = open ? (ready ? '⚓ Hafen' : `⚓ Hafen ${d.toFixed(1)}/${bayTarget(game).toFixed(1)} m`) : '⚓ Hafen (frei)';
  ctx.font = font(12); ctx.textAlign = 'center';
  const tw = ctx.measureText(label).width + 10, ty = bay.side < 0 ? y - 4 : y + h + fs(12) + 4;
  const hdy = labelDy(cx - tw / 2, ty - fs(12) - 1, tw, fs(12) + 5);
  ctx.fillStyle = '#000b'; ctx.fillRect(cx - tw / 2, ty - fs(12) - 1 + hdy, tw, fs(12) + 5); ctx.fillStyle = ready ? '#b9f5c9' : '#ffe08a'; ctx.fillText(label, cx, ty + 1 + hdy);
  ctx.textAlign = 'start';
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
    if (!ready) drawZoneWindows(ctx, game, p, 0.4, false); // nur die fehlenden Zellen rot, ohne Rahmen
    // Kreuzungsstelle = verbreiterte Rinne: ein einziges Band, das sich aus der Rinne aufweitet (Einfahrt), zwei Spuren bietet und wieder zuläuft (Ausfahrt)
    const R = CONFIG.zones.ramp ?? 0, f = game.fair?.[zc], wn = p.wins ?? [];
    if (wn.length && f?.path) {
      const top = Math.min(...wn.map((w) => w.a)) * CELL, bot = (Math.max(...wn.map((w) => w.b)) + p.beam) * CELL;
      let yc = (top + bot) / 2; for (const q of f.path.points) if (q.x >= z.x + 0.5) { yc = q.y * CELL; break; }
      const bw = c.beam * CELL * 0.9, xl = x0 - R * CELL, xr = x0 + z.w * CELL + R * CELL, x1 = x0 + z.w * CELL;
      ctx.beginPath(); ctx.moveTo(xl, yc - bw / 2); ctx.lineTo(x0, top); ctx.lineTo(x1, top); ctx.lineTo(xr, yc - bw / 2); ctx.lineTo(xr, yc + bw / 2); ctx.lineTo(x1, bot); ctx.lineTo(x0, bot); ctx.lineTo(xl, yc + bw / 2); ctx.closePath();
      ctx.fillStyle = ready ? 'rgba(160,230,90,.16)' : 'rgba(255,200,70,.15)'; ctx.fill();
      ctx.strokeStyle = ready ? 'rgba(166,230,90,.9)' : 'rgba(255,201,77,.9)'; ctx.lineWidth = 2; ctx.setLineDash(ready ? [] : [7, 5]); ctx.stroke(); ctx.setLineDash([]);
    }
    const rv = p.rampVolume ?? [0, 0], label = ready ? `Kreuzung ${c.icon} ✓` : `Kreuzung ${c.icon}: fehlt ${p.volume === Infinity ? '?' : Math.round(p.volume) + ' m³'}${p.wins && (rv[0] > 1e-6 || rv[1] > 1e-6) ? ` (Zufahrt ${Math.round(rv[0] + rv[1])})` : ''}`;
    ctx.font = font(12); ctx.textAlign = 'center'; const tw = ctx.measureText(label).width + 10;
    const zdy = labelDy(x0 + z.w * CELL / 2 - tw / 2, 3, tw, fs(12) + 6);
    ctx.fillStyle = '#000b'; ctx.fillRect(x0 + z.w * CELL / 2 - tw / 2, 3 + zdy, tw, fs(12) + 6); ctx.fillStyle = ready ? '#d6f5a8' : '#ffe08a'; ctx.fillText(label, x0 + z.w * CELL / 2, 4 + fs(12) + zdy); ctx.textAlign = 'start';
  }
}

// Gemietete Pontons der Flotte: kleiner, cyan, mit Name; beim Baggern mit gestricheltem Kasten
// Hafenkarte: Zufahrt, Becken mit Kaimauer, Bauplätze mit den gebauten Gebäuden und die angelegten Schiffe an ihren Liegeplätzen

// Hafengelände: gepflasterter Hof unter den Bauplätzen, Gebäude mit Schatten, Dach und Tor
function harborYard(ctx, game) {
  if (!game.port?.open) return;
  ctx.save(); ctx.fillStyle = 'rgba(150,152,150,.22)';
  for (const pl of HARBOR.plots) { const q = { x: OX + pl[0] * CELL, y: pl[1] * CELL }; ctx.beginPath(); ctx.roundRect(q.x - 6, q.y - 6, HARBOR.plotW * CELL + 12, HARBOR.plotH * CELL + 12, 10); ctx.fill(); }
  ctx.restore();
}
function harborBuilding(ctx, x, y, w, h, type, level) {
  const roof = { kies: '#c9b27a', tank: '#b86a5a', kran: '#e0a63a', container: '#e0803a', werk: '#8f8f9a', kai: '#9aa0a8', cbruecke: '#e9a23b', sanierung: '#6fa05a' }[type] ?? '#b79b6e';
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.roundRect(x + 4, y + 5, w, h, 6); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#d8c39a'); g.addColorStop(1, '#a58a5c');
  ctx.fillStyle = g; ctx.strokeStyle = '#4a3b22'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = roof; ctx.beginPath(); ctx.roundRect(x + 4, y + 4, w - 8, h * 0.45, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(x + 4 + ((w - 8) * k) / 6, y + 6); ctx.lineTo(x + 4 + ((w - 8) * k) / 6, y + 2 + h * 0.45); ctx.stroke(); }
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x + w / 2 - 9, y + h - 15, 18, 11); // Tor
  ctx.fillStyle = '#ffe9a0'; for (let k = 0; k < (level ?? 1); k++) { ctx.beginPath(); ctx.arc(x + 9 + k * 9, y + h * 0.5, 2.6, 0, 7); ctx.fill(); } // Stufe
}
export function drawHarborScene(ctx, game, ui = {}) {
  const g = game, p = g.port, B = HARBOR.basin, E = HARBOR.entrance, L = (x, y) => ({ x: OX + x * CELL, y: y * CELL });
  LABELS = [];
  const tag = (text, cx, cy, color = '#fff') => { ctx.font = font(12); ctx.textAlign = 'center'; const tw = ctx.measureText(text).width + 10, dy = labelDy(cx - tw / 2, cy - fs(12), tw, fs(12) + 5); ctx.fillStyle = 'rgba(10,28,44,.82)'; ctx.beginPath(); ctx.roundRect(cx - tw / 2, cy - fs(12) - 1 + dy, tw, fs(12) + 5, (fs(12) + 5) / 2); ctx.fill(); ctx.fillStyle = color; ctx.fillText(text, cx, cy + dy + 2); ctx.textAlign = 'start'; };
  // Becken: Rahmen gelb (zu flach) oder grün (bereit)
  const depth = bayDepth(g), ready = bayReady(g), a = L(B.x0, B.y0);
  harborYard(ctx, game);
  ctx.strokeStyle = ready ? 'rgba(123,227,154,.85)' : 'rgba(255,201,74,.85)'; ctx.lineWidth = 2; ctx.setLineDash(ready ? [] : [7, 5]); ctx.beginPath(); ctx.roundRect(a.x + 1, a.y + 1, (B.x1 - B.x0 + 1) * CELL - 2, (B.y1 - B.y0 + 1) * CELL - 2, 6); ctx.stroke(); ctx.setLineDash([]);
  tag(ready ? `⚓ Hafenbecken ${depth.toFixed(1)} m ✓` : `⚓ Hafenbecken ${depth.toFixed(1)}/${bayTarget(g).toFixed(1)} m: ausbaggern`, a.x + ((B.x1 - B.x0 + 1) * CELL) / 2, (B.y1 + 1) * CELL + 16, ready ? '#b9f5c9' : '#ffe08a');
  const en = L(E.x0, E.y0); tag('Zufahrt vom Fluss ➜', en.x + 70, E.y0 * CELL - 8, '#bfeaff');
  // Kai: Pier an der Nordseite des Beckens
  const hasKai = (p.slots ?? []).some((s) => s?.type === 'kai'), nb = berthsOf(g);
  if (hasKai) {
    const px0 = L(B.x0, B.y0 - 1.4), pw = (B.x1 - B.x0 + 1) * CELL, ph = CELL * 1.4;
    const pg = ctx.createLinearGradient(0, px0.y, 0, px0.y + ph); pg.addColorStop(0, '#c4c9ce'); pg.addColorStop(1, '#8f959b');
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(px0.x + 2, px0.y + ph, pw, 4); ctx.fillStyle = pg; ctx.beginPath(); ctx.roundRect(px0.x, px0.y, pw, ph, 4); ctx.fill(); ctx.strokeStyle = '#5c6268'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(px0.x + 3, px0.y + 2, pw - 6, 2);
    for (let x = px0.x + CELL; x < px0.x + pw - 4; x += CELL * 2) { ctx.fillStyle = '#3d4249'; ctx.beginPath(); ctx.arc(x, px0.y + ph - 5, 2.6, 0, 7); ctx.fill(); } // Poller
    for (let k = 0; k < HARBOR.berthX.length; k++) { // Liegeplätze: markiert, gesperrte grau
      const bp = berthPos(k), x = OX + (bp.x - 2) * CELL, y = B.y0 * CELL, on = k < nb;
      ctx.strokeStyle = on ? 'rgba(255,233,160,.9)' : 'rgba(255,255,255,.25)'; ctx.lineWidth = 1.5; ctx.setLineDash(on ? [] : [3, 4]); ctx.beginPath(); ctx.roundRect(x + 1, y + 1, 4 * CELL - 2, CELL * 3.2, 5); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = on ? 'rgba(255,233,160,.1)' : 'rgba(255,255,255,.04)'; ctx.fill();
      ctx.fillStyle = 'rgba(10,28,44,.8)'; ctx.beginPath(); ctx.arc(x + 2 * CELL, y - CELL * 0.55, 8, 0, 7); ctx.fill();
      ctx.fillStyle = on ? '#ffe9a0' : '#ffffff77'; ctx.font = font(11); ctx.textAlign = 'center'; ctx.fillText(on ? `${k + 1}` : '🔒', x + 2 * CELL, y - CELL * 0.55 + 4); ctx.textAlign = 'start';
    }
  }
  // Warteräume im südlichen Becken: Rahmen je Raum mit zugewiesener Fracht, wartende Schiffe mit Sanduhr
  const nw = waitsOf(g);
  for (let k = 0; k < HARBOR.waitX.length; k++) {
    const wp = waitPos(k), x = OX + (wp.x - 2) * CELL, y = (wp.y - 1.5) * CELL, on = k < nw, cg = p.waitCargo?.[k];
    ctx.strokeStyle = on ? 'rgba(155,224,255,.85)' : 'rgba(255,255,255,.2)'; ctx.lineWidth = 1.5; ctx.setLineDash(on ? [5, 4] : [3, 5]); ctx.beginPath(); ctx.roundRect(x + 1, y + 1, 4 * CELL - 2, 3 * CELL - 2, 8); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = on ? 'rgba(155,224,255,.07)' : 'rgba(255,255,255,.03)'; ctx.fill();
    ctx.fillStyle = on ? '#bfeaff' : '#ffffff55'; ctx.font = font(11); ctx.textAlign = 'center';
    ctx.fillText(on ? `⏳ Warteraum ${k + 1}: ${cg ? PORT.commodities[cg].icon + ' ' + PORT.commodities[cg].name.split(' ')[0] : 'alle'}` : '🔒', x + 2 * CELL, y + 3 * CELL + 13); ctx.textAlign = 'start';
  }
  for (const j of (p.jobs ?? []).filter((q) => q.state === 'waiting')) {
    const ship = g.maps[g.mapIdx].traffic.ships.find((s) => s.id === j.shipId); if (!ship) continue;
    drawShip(ctx, shipById(ship.cls), { ...ship, state: 'harbor' }, waitPos(j.slot ?? 0), g, ui);
    const q = mapPx(waitPos(j.slot ?? 0).x, waitPos(j.slot ?? 0).y), pct = Math.min(1, (j.waited ?? 0) / PORT.waitMax);
    ctx.fillStyle = '#000b'; ctx.fillRect(q.x - 24, q.y + CELL * 1.1, 48, 5); ctx.fillStyle = pct > 0.7 ? '#ff7a6b' : '#ffd24d'; ctx.fillRect(q.x - 24, q.y + CELL * 1.1, 48 * (1 - pct), 5); // Geduld
  }
  // Bauplätze und Gebäude
  (p.slots ?? []).forEach((sl, i) => {
    const pl = HARBOR.plots[i]; if (!pl) return; const q = L(pl[0], pl[1]), w = HARBOR.plotW * CELL, h = HARBOR.plotH * CELL;
    if (!sl) { ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.roundRect(q.x, q.y, w, h, 8); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = font(11); ctx.textAlign = 'center'; ctx.fillText(`Bauplatz ${i + 1}`, q.x + w / 2, q.y + h / 2 + 4); ctx.textAlign = 'start'; return; }
    const Bd = PORT.buildings[sl.type];
    harborBuilding(ctx, q.x, q.y, w, h, sl.type, sl.level);
    ctx.font = font(22); ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText(Bd.icon, q.x + w / 2, q.y + h / 2 + 4);
    ctx.font = font(11); ctx.fillStyle = '#fff'; ctx.shadowColor = '#000a'; ctx.shadowBlur = 4; const fill = Bd.commodity ? ` · ${Math.round(p.stock[Bd.commodity] ?? 0)} t` : ''; ctx.fillText(`${Bd.name.split(' ')[0]} ${sl.level}${fill}`, q.x + w / 2, q.y + h - 5); ctx.shadowBlur = 0; ctx.textAlign = 'start';
  });
  // angelegte Schiffe an den Liegeplätzen, mit Ladefortschritt
  const docked = (p.jobs ?? []).filter((j) => isDocked(j) && j.shipId != null);
  docked.forEach((j, k) => {
    const ship = (game.maps ? g.maps[g.mapIdx].traffic : g.traffic).ships.find((s) => s.id === j.shipId); if (!ship) return;
    const cls = shipById(ship.cls), bp = berthPos(k);
    drawShip(ctx, cls, { ...ship, state: 'harbor' }, bp, g, ui);
    const q = mapPx(bp.x, bp.y), wBar = 3 * CELL;
    ctx.fillStyle = '#000b'; ctx.fillRect(q.x - wBar / 2, q.y + CELL * 1.2, wBar, 5); ctx.fillStyle = '#7bd88f'; ctx.fillRect(q.x - wBar / 2, q.y + CELL * 1.2, wBar * Math.min(1, j.done / j.tons), 5);
    ctx.font = font(11); ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(`${PORT.commodities[j.cargo].icon} ${j.out ? 'lädt' : 'entlädt'}`, q.x, q.y + CELL * 1.2 + 16); ctx.textAlign = 'start';
  });
  // Umschlag: Kran bzw. Radlader fährt zwischen Lager und Schiff, Ladung wandert über den Kai (laden: Lager → Schiff, entladen: Schiff → Lager)
  const t = ui.t ?? 0, M = PORT.machines[(p.slots ?? []).some((s) => s?.type === 'kran') ? 'kran' : 'radlader'], pierY = (B.y0 - 0.7) * CELL;
  docked.forEach((j, k) => {
    const si = (p.slots ?? []).findIndex((s) => s?.type === PORT.storage[j.cargo]); if (si < 0) return;
    const pl = HARBOR.plots[si], sx = OX + (pl[0] + HARBOR.plotW / 2) * CELL, sy = (pl[1] + HARBOR.plotH) * CELL, bx = OX + berthPos(k).x * CELL, col = cargoById(j.cargo === 'oel' ? 'oel' : j.cargo === 'container' ? 'container' : 'kies')?.color ?? '#c9b27a';
    ctx.strokeStyle = '#ffffff55'; ctx.lineWidth = 2; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, pierY); ctx.lineTo(bx, pierY); ctx.stroke(); ctx.setLineDash([]);
    const len1 = Math.abs(pierY - sy), len2 = Math.abs(bx - sx), tot = len1 + len2;
    for (let n = 0; n < 3; n++) { // drei Pakete unterwegs
      let f = ((t * 0.35 + k * 0.31 + n / 3) % 1); if (!j.out) f = 1 - f; const d = f * tot;
      const x = d < len1 ? sx : sx + Math.sign(bx - sx) * (d - len1), y = d < len1 ? sy + (pierY - sy) * (d / len1) : pierY;
      ctx.fillStyle = col; ctx.strokeStyle = '#10202c'; ctx.lineWidth = 1; ctx.fillRect(x - 5, y - 5, 10, 10); ctx.strokeRect(x - 5, y - 5, 10, 10);
    }
    if (j.cargo === 'container' && bridgeLevel(g)) { // Containerbrücke: Portal über dem Liegeplatz, Laufkatze mit Container fährt zwischen Kai und Deck
      const w = 2.7 * CELL, topY = pierY - 0.9 * CELL, deckY = (B.y0 + 1.1) * CELL, f = 0.5 + 0.5 * Math.sin(t * 1.6 + k), ty = pierY + (deckY - pierY) * f;
      ctx.fillStyle = '#e9a23b'; ctx.strokeStyle = '#6b4a14'; ctx.lineWidth = 2; ctx.fillRect(bx - w, topY - 3, 2 * w, 6); ctx.strokeRect(bx - w, topY - 3, 2 * w, 6);
      ctx.fillRect(bx - w, topY, 5, pierY - topY + 4); ctx.fillRect(bx + w - 5, topY, 5, pierY - topY + 4);
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bx, topY + 3); ctx.lineTo(bx, ty); ctx.stroke();
      ctx.fillStyle = ['#e0803a', '#3a7ae0', '#d94a4a', '#e0c33a'][(k + Math.floor(t)) % 4]; ctx.fillRect(bx - 7, ty - 4, 14, 9); ctx.strokeStyle = '#10202c'; ctx.strokeRect(bx - 7, ty - 4, 14, 9);
    } else { ctx.font = font(18); ctx.textAlign = 'center'; ctx.fillStyle = '#000'; ctx.fillText(M.icon, bx, pierY - 3); ctx.textAlign = 'start'; } // Gerät am Liegeplatz
  });
  const res = (p.jobs ?? []).filter((j) => j.state === 'reserved').length;
  tag(`Liegeplätze ${(p.jobs ?? []).filter((q) => !q.wait).length}/${nb}${res ? ` · ${res} Schiff${res > 1 ? 'e' : ''} unterwegs` : ''} · Kai ${kaiLevel(g) || '–'}`, OX + 10 * CELL, 34 * CELL + 8, '#e8d9a0');
}

function drawFleet(ctx, game, ui = {}) {
  for (const u of game.fleet?.units ?? []) {
    if ((u.loc ?? 'main') !== (game.isHarborView ? 'harbor' : 'main')) continue; // Pontons im Hafen erscheinen nur auf der Hafenkarte
    const px = OX + u.x * CELL, py = u.y * CELL, sim = u.sim;
    if (sim?.mode === 'slice') {
      const sl = sim.slice, B = CONFIG.box.cols;
      ctx.strokeStyle = '#7fe3ff88'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.strokeRect(OX + sl.c0 * CELL + 1, sl.x0 * CELL + 1, B * CELL - 2, SLICE.cols * CELL - 2); ctx.setLineDash([]);
      const sy = sl.x0 * CELL + (sl.x - sl.x0) * CELL;
      ctx.strokeStyle = sl.suctioning ? '#ffd24d' : '#7fe3ff99'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(OX + sl.c0 * CELL, sy); ctx.lineTo(OX + (sl.c0 + B) * CELL, sy); ctx.stroke();
    }
    const bl = sim?.mode === 'slice' ? besideLane(game, u.x, u.y) : { moved: false }, q = bl.moved ? mapPx(bl.x, bl.y) : { x: px, y: py };
    if (bl.moved) hose(ctx, q, { x: px, y: py }, ui);
    drawPontoonSprite(ctx, q.x, q.y, !!u.self, sim?.mode === 'slice' && sim.slice.suctioning, ui);
    ctx.font = font(11); ctx.textAlign = 'center'; const nw = ctx.measureText(u.name).width + 4, ndy = labelDy(q.x - nw / 2, q.y - CELL - fs(11), nw, fs(11) + 3);
    ctx.fillStyle = '#000b'; ctx.fillText(u.name, q.x + 1, q.y - CELL + 1 + ndy); ctx.fillStyle = '#d9f7ff'; ctx.fillText(u.name, q.x, q.y - CELL + ndy); ctx.textAlign = 'start';
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
  const VX0 = ui.sliceView?.x0 ?? 0, VX1 = ui.sliceView?.x1 ?? W; // sichtbarer Ausschnitt (Handy: gezoomt): Beschriftungen bleiben im Bild
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
  for (let c = 0; c < n; c++) { // Pfahlwand: Betonpfahl vom Wasserspiegel bis auf den Fels; gesicherte Strecke dahinter bläulich getönt
    const i = r.idx(sl.centerCol, sl.x0 + c);
    if (r.pile?.[i]) {
      const g = ctx.createLinearGradient(c * U, 0, (c + 1) * U, 0); g.addColorStop(0, '#7d848c'); g.addColorStop(0.5, '#b4bac2'); g.addColorStop(1, '#6f767e');
      ctx.fillStyle = g; ctx.fillRect(c * U + 2, SURF - 14, U - 4, H - SURF + 14);
      ctx.strokeStyle = '#3d4249'; ctx.lineWidth = 2; ctx.strokeRect(c * U + 2, SURF - 14, U - 4, H - SURF + 14);
      ctx.fillStyle = '#3d4249'; for (let yy = SURF + 18; yy < H; yy += 46) { ctx.fillRect(c * U + 8, yy, 4, 4); ctx.fillRect(c * U + U - 12, yy + 18, 4, 4); }
    } else if (r.lim?.[i] > -90) { const top = Y(hi[c]); ctx.fillStyle = 'rgba(110,150,200,.25)'; ctx.fillRect(c * U, top, U, Math.max(0, H - top)); }
  }
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
    ctx.globalAlpha = on ? 1 : 0.75; ctx.fillStyle = '#000a'; const ff = game.fair?.[cls.id], lf = ff?.loadFactor, label = `${ok ? '✓ ' : ''}${cls.name} ${minNeedDepth(cls).toFixed(1)}–${needDepth(cls).toFixed(1)} m${ok ? ` · ${Math.round(lf * 100)} % Ladung${ff.loadFrac < 0.999 ? ` · +${Math.round(ff.fullVolume).toLocaleString('de-CH')} m³ bis voll` : ''}` : ff && ff.volume < Infinity ? ` · fehlt ${Math.round(ff.volume).toLocaleString('de-CH')} m³` : ''}`; const tw = ctx.measureText(label).width;
    ctx.fillRect(VX1 - tw - 12, y - fs(12) + 1, tw + 8, fs(12) + 3); ctx.fillStyle = on ? '#fff' : cls.color; ctx.fillText(label, VX1 - 6, y);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'start';
  const ty = Y(sl.targetTop());
  ctx.strokeStyle = '#ffae3d'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]);
  ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffae3d'; ctx.font = font(13); ctx.fillText(`Solltiefe ${sl.targetDepth.toFixed(1)} m`, VX0 + 8, ty - 5);

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
  chain.update(dt, pumpX, trolleyY + 6, pumpX, py - PH + 6);
  drawChain(ctx, chain);
  // Pumpe: hochkantes Rechteck, Einsaugöffnung unten vorne (rechts)
  const ang = Math.max(-0.4, Math.min(0.4, chain.endAngle())) * 0.5;
  ctx.save(); ctx.translate(pumpX, py); ctx.rotate(ang);
  ctx.fillStyle = sl.clog > 0 ? '#a64a3a' : '#e07a2a'; ctx.strokeStyle = '#3a1a05'; ctx.lineWidth = 2;
  ctx.fillRect(-PW / 2, -PH, PW, PH); ctx.strokeRect(-PW / 2, -PH, PW, PH);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(-PW / 2 + 3, -PH + 8, PW - 6, 6); ctx.fillRect(-PW / 2 + 3, -PH + 18, PW - 6, 6);
  ctx.fillStyle = sl.suctioning ? '#7bd88f' : '#555'; ctx.fillRect(-PW / 2 + 3, -PH + 28, PW - 6, 6);
  ctx.fillStyle = '#444'; ctx.fillRect(PW / 2 - 2, -12, 10, 12); // Saugrohr
  ctx.restore();
  const m = sliceMouthScreen(sl);
  if (sl.suctioning) { // Sog
    ctx.fillStyle = 'rgba(255,230,160,.18)'; ctx.beginPath(); ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - 34, m.y + 46); ctx.lineTo(m.x + 34, m.y + 46); ctx.closePath(); ctx.fill();
  }
  // Saugradius als schwache Kontur
  
  // Hubhöhe
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
    
    ctx.font = font(13); ctx.fillStyle = (sim.concreteAvail ?? 0) > 0.05 ? '#dfe3e8' : '#ff9d8f'; ctx.fillText(`Beton ${(sim.concreteAvail ?? 0).toFixed(0)} m³`, bx + 22, by - 14);
    return;
  }
  const swing = sl.suctioning ? Math.sin((ui.t ?? 0) * 7) * 0.5 : 0;
  ctx.save(); ctx.translate(tx, ty); ctx.rotate(0.3 + swing);
  ctx.fillStyle = '#6b6f73'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(16, -6); ctx.lineTo(20, 14); ctx.lineTo(-10, 18); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#c9c9c9'; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-8 + k * 8, 17); ctx.lineTo(-4 + k * 8, 17); ctx.lineTo(-6 + k * 8, 24); ctx.closePath(); ctx.fill(); }
  ctx.restore();
  
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
  // Flacher Grund und ein Felsen links: das Schiff liegt mit dem Rumpf darauf und wird von dort ins tiefe Wasser gezogen
  const SEAB = 405, FX = 170, FHW = 120, len = 150 + cls.len * 10, hh = 26 + cls.draught * 4;
  const floatBottom = SURFY + hh * 0.42, peakY = floatBottom - 26; // Felsspitze liegt über der Schwimmlinie des Rumpfs
  const rockTop = (x) => { const u = (x - FX) / FHW; if (Math.abs(u) >= 1) return SEAB; return SEAB - (1 - u ** 4) * (SEAB - peakY) + Math.sin(x * 0.37) * 2.5 * (1 - Math.abs(u)); };
  ctx.fillStyle = '#c8b27c'; ctx.fillRect(0, SEAB, W, H - SEAB);
  ctx.strokeStyle = '#f0e4c8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, SEAB); ctx.lineTo(W, SEAB); ctx.stroke();
  ctx.fillStyle = '#6f747c'; ctx.beginPath(); ctx.moveTo(FX - FHW - 10, SEAB + 2);
  for (let x = FX - FHW; x <= FX + FHW; x += 6) ctx.lineTo(x, rockTop(x));
  ctx.lineTo(FX + FHW + 10, SEAB + 2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3d4249'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#8a9099'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(FX - 60, SEAB - 40); ctx.lineTo(FX - 30, SEAB - 110); ctx.moveTo(FX + 30, SEAB - 20); ctx.lineTo(FX + 50, SEAB - 90); ctx.stroke();
  ctx.strokeStyle = '#d9f1ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, SURFY); ctx.lineTo(W, SURFY); ctx.stroke();
  // Ponton mit Winde rechts
  const px = W - 110, py = SURFY;
  ctx.fillStyle = '#e8c33a'; ctx.strokeStyle = '#3b2f08'; ctx.lineWidth = 2; ctx.fillRect(px - 70, py - 22, 140, 30); ctx.strokeRect(px - 70, py - 22, 140, 30);
  ctx.fillStyle = '#2b2b2b'; ctx.fillRect(px - 10, py - 40, 20, 20);
  // Schiff (Seitenansicht): liegt mit dem Rumpf auf dem Felsen (Bug/Heck stützen sich ab), rutscht mit dem Fortschritt herunter und schwimmt dann auf
  const frac = Math.min(1, tow.progress / tow.need), sx = 170 + frac * 330;
  const xs = sx - len * 0.38, xb = sx + len * 0.38, yS = Math.min(floatBottom, rockTop(xs)), yB = Math.min(floatBottom, rockTop(xb));
  const ang = Math.atan2(yB - yS, xb - xs), sy = (yS + yB) / 2 - hh * 0.5 + (frac >= 1 ? Math.sin(t * 3) * 1.5 : 0);
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
