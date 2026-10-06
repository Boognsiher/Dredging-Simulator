import { CONFIG, shipById } from '../config.js';
import { shipPos } from './traffic.js';

// Minispiel «Aufläufer freischleppen»: Der Ponton liegt mit einer Schleppleine am aufgelaufenen Schiff. Wer die Zugtaste hält, baut Zugspannung auf,
// loslassen lässt sie sinken. Nur im grünen Band bewegt sich das Schiff von der Untiefe weg; zu wenig Zug bringt nichts, zu viel lässt die Leine reissen
// (Strafe, Fortschritt geht zurück). Schwere Schiffe haben ein schmaleres Band und brauchen länger. Wellengang rüttelt an der Spannung.
// Schafft man es in der Zeit, ist das Schiff sofort frei und ein Teil der Bergungskosten kommt zurück; sonst bleibt das Schiff aufgelaufen und
// die Schlepper kommen wie gewohnt (teuer, langsam). Reine Logik ohne DOM.
export class TowSim {
  constructor(game, ship, rng = Math.random) {
    const T = CONFIG.tow, cls = shipById(ship.cls);
    this.game = game; this.shipId = ship.id; this.cls = cls;
    this.rng = rng;
    this.tension = 0;
    this.progress = 0;
    this.need = T.need * (0.6 + cls.draught / 4); // Sekunden im grünen Band
    const half = (T.band[1] - T.band[0]) / 2, mid = (T.band[0] + T.band[1]) / 2, narrow = 1 - Math.min(0.4, (cls.draught - 1.4) * 0.12);
    this.band = [mid - half * narrow, mid + half * narrow];
    this.timeLeft = T.seconds;
    this.t = 0;
    this.snaps = 0;
    this.over = false;
    this.success = false;
    this.events = []; // { kind: 'snap' | 'free' | 'lost' | 'gone' }
  }

  get ship() { return this.game.traffic.ships.find((s) => s.id === this.shipId); }

  update(dt, hold) {
    if (this.over) return;
    const T = CONFIG.tow, ship = this.ship;
    if (!ship || ship.state !== 'grounded') { this.over = true; this.events.push({ kind: 'gone' }); return; } // von selbst frei oder abgeschleppt
    this.t += dt;
    this.timeLeft -= dt;
    this.tension += (hold ? T.gain : -T.drain) * dt + Math.sin(this.t * 3.1 + this.shipId) * 0.18 * dt; // Wellengang
    this.tension = Math.min(1.05, Math.max(0, this.tension));
    if (this.tension >= T.snapAt) {
      this.tension = 0; this.snaps++;
      this.progress = Math.max(0, this.progress - 1.2);
      this.game.money -= T.snapPenalty; this.game.totals.salvage += T.snapPenalty;
      this.events.push({ kind: 'snap' });
    } else if (this.tension >= this.band[0] && this.tension <= this.band[1]) this.progress += dt;
    else if (this.tension > this.band[1]) this.progress += dt * 0.25; // zu viel Zug: das Schiff rückt kaum
    if (this.progress >= this.need) {
      this.over = true; this.success = true;
      this.game.rescueShip(ship.id);
      this.events.push({ kind: 'free' });
    } else if (this.timeLeft <= 0) { this.over = true; this.events.push({ kind: 'lost' }); }
  }
}

// Aufgelaufenes Schiff in Reichweite des Pontons (Kartenkoordinaten), sonst null
export function groundedNear(game, x, y) {
  let best = null, bd = CONFIG.tow.range;
  for (const s of game.traffic.ships) {
    if (s.state !== 'grounded' || !s.path) continue;
    const p = shipPos(s), d = Math.hypot(p.x - x, p.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
