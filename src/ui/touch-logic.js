// Reine Logik der Touch-Steuerung (ohne DOM, deshalb testbar).

// Daumen-Stick: gibt die Richtung frei (auch schräg) zurück; Totzone in der Mitte. Auf der Karte fährt der Ponton in jede Richtung,
// im Querschnitt bleibt das Steuerkreuz (dort mit Diagonaltasten).
export function snapStick(vx, vy, dead = 14) {
  const len = Math.hypot(vx, vy);
  if (len < dead) return { dx: 0, dy: 0 };
  return { dx: vx / len, dy: vy / len };
}

// Automatisch zu einem Ziel fahren (Tippen auf die Karte): Richtung in Karten-Zellen, `arrived` bei Ankunft.
export function steerToward(cur, target, stopDist = 0.3) {
  const tx = target.x - cur.x, ty = target.y - cur.y, d = Math.hypot(tx, ty);
  if (d <= stopDist) return { dx: 0, dy: 0, arrived: true };
  return { dx: tx / d, dy: ty / d, arrived: false };
}

// War es ein Tippen (kurz, kaum bewegt) und kein Ziehen?
export function isTap(dist, ms, maxDist = 12, maxMs = 400) { return dist <= maxDist && ms <= maxMs; }
