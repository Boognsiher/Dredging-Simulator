import test from 'node:test';
import assert from 'node:assert/strict';
import { snapStick, steerToward, isTap } from '../src/ui/touch-logic.js';
import { fitSize, renderQuality } from '../src/ui/layout.js';
import { hintsFor } from '../src/ui/hints.js';

test('Stick rastet auf eine Achse ein und hat Totzone und Hysterese', () => {
  assert.deepEqual(snapStick(2, 1, 14), { dx: 0, dy: 0 });
  assert.deepEqual(snapStick(30, 10), { dx: 1, dy: 0 });
  assert.deepEqual(snapStick(-5, -40), { dx: 0, dy: -1 });
  assert.deepEqual(snapStick(30, 36, 14, { dx: 1, dy: 0 }), { dx: 1, dy: 0 }, 'bleibt horizontal, solange nicht klar vertikal');
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
