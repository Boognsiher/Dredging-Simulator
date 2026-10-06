// Kleiner seedbarer Zufallsgenerator (mulberry32) -> reproduzierbare Tests & Seeds
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (min, max) => min + next() * (max - min);
  next.int = (min, max) => Math.floor(next.range(min, max + 1));
  next.chance = (p) => next() < p;
  next.getState = () => a; // für Spielstände: Zufallsfolge an derselben Stelle weiterführen
  next.setState = (v) => { a = v >>> 0; };
  return next;
}
