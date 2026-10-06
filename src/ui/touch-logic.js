// Reine Logik der Touch-Steuerung (ohne DOM, deshalb testbar).

// Daumen-Stick: rastet auf eine der vier Richtungen ein, weil der Saugkopf immer nur auf einer Achse fährt.
// Hysterese: eine bereits gewählte Achse bleibt, bis die andere deutlich stärker ausschlägt (kein Flackern bei Diagonalen).
export function snapStick(vx, vy, dead = 14, prev = { dx: 0, dy: 0 }, stickiness = 1.4) {
  if (Math.hypot(vx, vy) < dead) return { dx: 0, dy: 0 };
  const ax = Math.abs(vx), ay = Math.abs(vy);
  let useX = ax >= ay;
  if (prev.dx !== 0 && ax * stickiness >= ay) useX = true; // war horizontal: bleibt es, solange nicht klar vertikal
  else if (prev.dy !== 0 && ay * stickiness >= ax) useX = false;
  return useX ? { dx: Math.sign(vx), dy: 0 } : { dx: 0, dy: Math.sign(vy) };
}

// Automatisch zu einem Ziel fahren (Tippen auf die Karte): Richtung in Karten-Zellen, `arrived` bei Ankunft.
export function steerToward(cur, target, stopDist = 0.3) {
  const tx = target.x - cur.x, ty = target.y - cur.y, d = Math.hypot(tx, ty);
  if (d <= stopDist) return { dx: 0, dy: 0, arrived: true };
  return { dx: tx / d, dy: ty / d, arrived: false };
}

// War es ein Tippen (kurz, kaum bewegt) und kein Ziehen?
export function isTap(dist, ms, maxDist = 12, maxMs = 400) { return dist <= maxDist && ms <= maxMs; }
