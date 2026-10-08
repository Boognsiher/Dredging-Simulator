import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapStick, steerToward, isTap } from '../src/ui/touch-logic.js';
import { fitSize, renderQuality } from '../src/ui/layout.js';
import { hintsFor } from '../src/ui/hints.js';

test('Stick gibt die Richtung frei (auch schräg) und hat eine Totzone', () => {
  assert.deepEqual(snapStick(2, 1, 14), { dx: 0, dy: 0 });
  assert.deepEqual(snapStick(30, 0), { dx: 1, dy: 0 });
  const d = snapStick(30, 30);
  assert.ok(Math.abs(d.dx - Math.SQRT1_2) < 1e-9 && Math.abs(d.dy - Math.SQRT1_2) < 1e-9, 'diagonal');
  assert.ok(Math.abs(Math.hypot(snapStick(-5, -40).dx, snapStick(-5, -40).dy) - 1) < 1e-9);
});

test('Zielfahrt: Richtung zum Ziel, Ankunft in der Nähe', () => {
  const s = steerToward({ x: 0, y: 0 }, { x: 10, y: 0 });
  assert.equal(s.dx, 1); assert.equal(s.arrived, false);
  assert.equal(steerToward({ x: 9.9, y: 0 }, { x: 10, y: 0 }).arrived, true);
});

test('Tippen: kurz und kaum bewegt', () => {
  assert.ok(isTap(3, 100)); assert.ok(!isTap(30, 100)); assert.ok(!isTap(3, 900));
});

test('Spielfeldgrösse: Seitenverhältnis bleibt, Auflösung ganzzahlig', () => {
  const s = fitSize(400, 1000, 800, 384);
  assert.equal(Math.round(s.w), 400); assert.equal(Math.round(s.h), 192);
  assert.equal(renderQuality(2, 400, 800), 1);
  assert.equal(renderQuality(3, 800, 800), 3);
});

test('Steuerungsanzeige: Karte und Querschnitt haben Hinweise für Tastatur und Touch', () => {
  for (const mode of ['map', 'slice']) for (const touch of [false, true]) assert.ok(hintsFor(mode, touch).length >= 3);
  assert.deepEqual(hintsFor('unbekannt', false), []);
});

test('PWA: Manifest, Symbole und Service Worker sind vorhanden und passen zusammen', () => {
  const root = new URL('../', import.meta.url), m = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(m.display, 'standalone'); assert.ok(m.start_url && m.scope);
  for (const ic of m.icons) assert.ok(existsSync(new URL(ic.src, root)), ic.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  const sw = readFileSync(new URL('sw.js', root), 'utf8'), html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(sw, /addEventListener\('fetch'/); assert.match(html, /rel="manifest"/); assert.match(html, /serviceWorker/);
  for (const f of ['index.html', 'style.css', 'icons/icon-192.png']) assert.ok(sw.includes(f), `${f} im Vorab-Cache`);
});
