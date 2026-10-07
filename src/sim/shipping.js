import { CONFIG, shipById } from '../config.js';
import { minNeedDepth } from './fairway.js';
import { PORT, hasKai, capacity, bayDepth, buy as portBuy, buyPrice, sellPrice, marketImpact } from './port.js';

// Eigene Reederei: Frachter fahren Ware zwischen den Häfen verschiedener Karten (Endlos-Modus). Jede Karte hat eigene Preise (Markt mit Bias),
// der Gewinn ist der Preisunterschied minus Spread und Frachtkosten. Wie viel ein Schiff laden darf, hängt von der Tiefe der Fahrrinne auf beiden Karten ab
// (Teilbeladung): bei Niedrigwasser sinkt die Ladung, die Fracht pro Tonne wird teurer. Zwischenlager = Lager im Hafen (Kies, Tank), ausbaubar.
export const SHIPPING = {
  maxShips: 6, baseDays: 1.0, daysPerHop: 0.6, minLoad: 0.3, idleUpkeep: 0.3, sellShare: 0.6,
  types: {
    kahn: { name: 'Frachtkahn', icon: '🛶', cost: 28000, cap: 240, perDay: 120, cargos: ['kies'] },
    motor: { name: 'Motorfrachter', icon: '🚤', cost: 70000, cap: 640, perDay: 260, cargos: ['kies'] },
    container: { name: 'Containerschiff', icon: '🚢', cost: 220000, cap: 800, perDay: 700, cargos: ['container'] },
    tank: { name: 'Tankschiff', icon: '🛢️', cost: 220000, cap: 560, perDay: 800, cargos: ['oel'] },
  },
};

export const createShipping = () => ({ ships: [], seq: 0, trips: 0, profit: 0 });

// Funktion fn im Kontext der Karte i ausführen (Markt, Hafen und Flussbett sind je Karte)
export function withMap(g, i, fn) { const c = g.mapIdx; g.mapIdx = i; try { return fn(); } finally { g.mapIdx = c; } }

export function shipBlock(g, type) {
  const T = SHIPPING.types[type];
  if (!T) return 'Unbekannt';
  if (g.status !== 'playing') return 'Spiel beendet';
  if (g.shipping.ships.length >= SHIPPING.maxShips) return 'Die Reederei ist voll';
  return g.money < T.cost ? `Braucht ${T.cost.toLocaleString('de-CH')} CHF` : null;
}
export function buyShip(g, type) {
  if (shipBlock(g, type)) return null;
  const T = SHIPPING.types[type], S = g.shipping;
  g.money -= T.cost;
  const s = { id: ++S.seq, type, name: `${T.name} ${S.seq}`, from: 0, to: Math.min(1, g.maps.length - 1), cargo: T.cargos[0], autoBuy: true, toStock: false, backhaul: true, minMargin: 1, state: 'idle', leg: 'out', t: 0, dur: 0, load: 0, basis: 0, trips: 0, profit: 0, note: 'startet' };
  S.ships.push(s);
  g.say(`${s.name} gekauft (−${T.cost.toLocaleString('de-CH')} CHF): Route im Menü unter «Reederei» einstellen.`, 'upgrade');
  return s;
}
export function sellShip(g, id) {
  const S = g.shipping, i = S.ships.findIndex((s) => s.id === id);
  if (i < 0 || S.ships[i].state === 'sail') return false;
  g.money += Math.round(SHIPPING.types[S.ships[i].type].cost * SHIPPING.sellShare); S.ships.splice(i, 1);
  return true;
}
export function setRoute(g, id, r) {
  const s = g.shipping.ships.find((q) => q.id === id); if (!s) return false;
  if (r.from !== undefined && g.maps[r.from]) s.from = r.from;
  if (r.to !== undefined && g.maps[r.to]) s.to = r.to;
  if (r.autoBuy !== undefined) s.autoBuy = !!r.autoBuy;
  if (r.toStock !== undefined) s.toStock = !!r.toStock;
  if (r.backhaul !== undefined) s.backhaul = !!r.backhaul;
  if (r.minMargin !== undefined) s.minMargin = Math.max(-50, Math.min(200, +r.minMargin || 0));
  if (r.cargo !== undefined && SHIPPING.types[s.type].cargos.includes(r.cargo)) s.cargo = r.cargo;
  return true;
}

// Was geht auf dieser Route gerade? ok/reason, erlaubte Ladung, Dauer, Frachtkosten je Tonne, erwartete Marge je Tonne
export function routeInfo(g, s) {
  const T = SHIPPING.types[s.type], cid = s.type, out = { ok: false, reason: '', lf: 0, eff: 0, days: 0, perT: 0, priceFrom: 0, priceTo: 0, margin: 0 };
  if (s.from === s.to) { out.reason = 'Start und Ziel sind dieselbe Karte'; return out; }
  const ends = [s.from, s.to];
  for (const i of ends) {
    const m = g.maps[i], f = m.fair?.[cid];
    if (!f?.passable) { out.reason = `Rinne ${m.name} gesperrt für ${T.name}`; return out; }
    const why = withMap(g, i, () => (!hasKai(g) ? 'Kai fehlt' : capacity(g, s.cargo) <= 0 ? `Lager für ${PORT.label[s.cargo]} fehlt` : bayDepth(g) < minNeedDepth(shipById(cid)) ? 'Hafenbecken zu flach' : ''));
    if (why) { out.reason = `${why} (${m.name})`; return out; }
  }
  out.lf = Math.min(...ends.map((i) => g.maps[i].fair[cid].loadFactor));
  out.eff = T.cap * out.lf;
  out.days = SHIPPING.baseDays + SHIPPING.daysPerHop * Math.abs(s.from - s.to);
  out.perT = (T.perDay * 2 * out.days) / Math.max(1, out.eff); // Fracht je Tonne: wenig Ladung (Niedrigwasser) = teurer
  out.priceFrom = withMap(g, s.from, () => buyPrice(g, s.cargo));
  out.priceTo = withMap(g, s.to, () => sellPrice(g, s.cargo));
  out.margin = out.priceTo - out.priceFrom - out.perT;
  out.ok = true;
  return out;
}

// Ware im Hafen der Karte i aufnehmen (aus dem Lager, sonst einkaufen). Gibt die geladene Menge zurück (0 = zu wenig)
function loadAt(g, s, i, info) {
  return withMap(g, i, () => {
    const p = g.port, id = s.cargo;
    if (s.autoBuy && p.stock[id] < info.eff) portBuy(g, id, info.eff - p.stock[id]);
    const take = Math.min(info.eff, p.stock[id]);
    if (take < info.eff * SHIPPING.minLoad) return 0;
    s.basis = p.cost[id] > 0 ? p.cost[id] : buyPrice(g, id);
    p.stock[id] -= take; if (p.stock[id] < 1e-6) { p.stock[id] = 0; p.cost[id] = 0; }
    return take;
  });
}
// Ladung im Hafen der Karte i abliefern (verkaufen oder einlagern). Gibt den Erlös (bzw. Marktwert) zurück
function unloadAt(g, s, i) {
  return withMap(g, i, () => {
    const p = g.port, id = s.cargo, price = sellPrice(g, id);
    let rest = s.load;
    if (s.toStock && hasKai(g)) {
      const put = Math.max(0, Math.min(rest, capacity(g, id) - p.stock[id]));
      if (put > 0) { p.cost[id] = (p.cost[id] * p.stock[id] + s.basis * put) / (p.stock[id] + put); p.stock[id] += put; rest -= put; }
      g.money += rest * price; if (rest > 0) marketImpact(g, id, rest, -1);
      return s.load * price; // eingelagerte Ware zählt zum Marktwert
    }
    g.money += rest * price; marketImpact(g, id, rest, -1); return rest * price;
  });
}
function deliver(g, s, at) {
  const S = g.shipping, revenue = unloadAt(g, s, at), gain = revenue - s.load * s.basis;
  s.profit += gain; S.profit += gain; s.trips++; S.trips++; g.today.income += Math.max(0, gain);
  s.note = `lieferte ${Math.round(s.load)} t (${gain >= 0 ? '+' : '−'}${Math.abs(Math.round(gain)).toLocaleString('de-CH')} CHF vor Unterhalt)`;
  s.load = 0;
}

export function updateShipping(g, dt) {
  const S = g.shipping; if (!S?.ships.length) return;
  const day = CONFIG.daySeconds;
  for (const s of S.ships) {
    const T = SHIPPING.types[s.type];
    const up = (T.perDay * dt * (s.state === 'idle' ? SHIPPING.idleUpkeep : 1)) / day; g.money -= up; g.today.costs += up;
    if (s.state === 'idle') {
      const info = routeInfo(g, s);
      if (!info.ok) { s.note = info.reason; continue; }
      if (info.margin < (s.minMargin ?? 0)) { s.note = `Marge ${info.margin.toFixed(1)} CHF/t unter ${s.minMargin ?? 0}: wartet auf bessere Preise`; continue; } // Preise hängen von Marktwirkung und Schwankungen ab
      const q = loadAt(g, s, s.from, info);
      if (q <= 0) { s.note = 'Zu wenig Ware im Lager (kaufen oder Auto-Einkauf, Geld/Lagerplatz prüfen)'; continue; }
      s.load = q; s.state = 'sail'; s.leg = 'out'; s.t = 0; s.dur = info.days * day;
      s.note = `fährt ${Math.round(q)} t ${g.maps[s.to].name}`;
    } else if (s.state === 'sail') {
      s.t += dt;
      if (s.t < s.dur) continue;
      if (s.leg === 'out') {
        deliver(g, s, s.to);
        s.leg = 'back'; s.t = 0;
        if (s.backhaul !== false) { // Rückfracht: in die Gegenrichtung laden, wenn sich das lohnt
          const rev = { ...s, from: s.to, to: s.from }, ri = routeInfo(g, rev);
          if (ri.ok && ri.margin >= (s.minMargin ?? 0)) { const q = loadAt(g, rev, s.to, ri); if (q > 0) { s.load = q; s.basis = rev.basis; s.note += ` · Rückfracht ${Math.round(q)} t`; } }
        }
      } else {
        if (s.load > 0) deliver(g, s, s.from);
        s.state = 'idle'; s.leg = 'out'; s.t = 0;
      }
    }
  }
}
