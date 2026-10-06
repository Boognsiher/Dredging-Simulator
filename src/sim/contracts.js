import { CONFIG, SHIPS, cargoById, shipById } from '../config.js';
import { priceOf } from './market.js';
import { activeClasses } from './traffic.js';

// Frachtaufträge: Eine Reederei will bis zu einem Termin X Tonnen einer Fracht durch deine Strecke bringen. Angenommen
// zählt jedes Schiff mit dieser Fracht; geschafft = Prämie, verpasst = Konventionalstrafe.
// status: 'offer' | 'active'
export function makeContract(g) {
  const C = CONFIG.contracts, active = activeClasses(g), classes = active.length ? active : [SHIPS.find((s) => s.id === g.level.classes[0])]; // nur Klassen, die fahren können
  const weights = classes.map(() => 1);
  let pick = g.rng() * weights.reduce((a, b) => a + b, 0), cls = classes[0];
  for (let i = 0; i < classes.length; i++) { pick -= weights[i]; if (pick <= 0) { cls = classes[i]; break; } }
  const cargo = cargoById(cls.cargo[Math.floor(g.rng() * cls.cargo.length)]);
  const tons = Math.round((cls.tons * g.rng.range(C.tons[0], C.tons[1])) / 100) * 100;
  const bonus = Math.round((tons * priceOf(g.market, cargo.id) * C.bonusShare) / 100) * 100;
  const client = ['Rheintransport AG', 'Reederei Schaffhauser', 'Binnenschiff GmbH', 'Alpen-Logistik', 'Stromfracht & Söhne', 'Donau-Kontor'][Math.floor(g.rng() * 6)];
  return { id: ++g.contractSeq, status: 'offer', client, cargo: cargo.id, cls: cls.id, tons, done: 0, bonus, penalty: Math.round((bonus * C.penaltyShare) / 100) * 100, offerExpiresAt: g.time + C.offerDays * CONFIG.daySeconds, dueAt: 0 };
}

export function acceptContract(g, id) {
  const c = g.contracts.find((x) => x.id === id);
  if (!c || c.status !== 'offer' || g.status !== 'playing') return false;
  if (g.contracts.filter((x) => x.status === 'active').length >= CONFIG.contracts.maxOpen) return false;
  c.status = 'active'; c.dueAt = g.time + CONFIG.contracts.dueDays * CONFIG.daySeconds;
  g.say(`Auftrag angenommen: ${c.tons} t ${cargoById(c.cargo).name} für ${c.client}`, 'good');
  return true;
}

// Ein Schiff hat den Abschnitt durchfahren: Ladung wird angerechnet
export function creditContracts(g, cargoId, tons) {
  for (const c of g.contracts) {
    if (c.status !== 'active' || c.cargo !== cargoId) continue;
    c.done += tons;
    if (c.done >= c.tons) {
      c.status = 'done';
      g.money += c.bonus; g.totals.contractsPaid += c.bonus; g.totals.contractsDone++;
      g.say(`Auftrag erfüllt: ${c.tons} t ${cargoById(c.cargo).name} (+${c.bonus} CHF)`, 'good');
      g.notify(`Auftrag erfüllt: +${c.bonus.toLocaleString('de-CH')} CHF`, 'good');
      return; // die Tonnage zählt für einen Auftrag, damit zwei nicht dieselbe Ladung bekommen
    }
  }
}

// Läuft einmal pro Spieltag und beim Zeitablauf: Angebote verfallen, verpasste Aufträge kosten Strafe, neue kommen
export function updateContracts(g) {
  const C = CONFIG.contracts;
  for (const c of g.contracts) {
    if (c.status === 'offer' && g.time >= c.offerExpiresAt) { c.status = 'expired'; g.say(`Auftrag verfallen: ${c.client}`, 'info'); }
    else if (c.status === 'active' && g.time >= c.dueAt) {
      c.status = 'failed'; g.money -= c.penalty; g.totals.contractsPenalty += c.penalty; g.totals.contractsFailed++;
      g.say(`Auftrag verpasst (${c.done}/${c.tons} t): Konventionalstrafe −${c.penalty} CHF`, 'bad');
      g.notify(`Auftrag verpasst: −${c.penalty.toLocaleString('de-CH')} CHF`, 'bad');
    }
  }
  g.contracts = g.contracts.filter((c) => c.status === 'offer' || c.status === 'active');
  if (g.time >= g.nextContractAt && g.contracts.filter((c) => c.status === 'offer').length < 2) {
    g.contracts.push(makeContract(g));
    g.nextContractAt = g.time + g.rng.range(C.everyDays[0], C.everyDays[1]) * CONFIG.daySeconds;
  }
}

export { shipById };
