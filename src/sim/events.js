import { CONFIG } from '../config.js';
import { shockMarket } from './market.js';

// Zufallsereignisse beim Tageswechsel. Neue Ereignisse = neuer Eintrag in der Liste.
// chance = Wahrscheinlichkeit pro Tag; apply(g) liefert den Text (oder null), der im Journal landet.
const round100 = (v) => Math.round(v / 100) * 100;

export const EVENTS = [
  {
    id: 'flood', chance: 0.022, when: (g) => !g.water.until,
    apply: (g) => {
      const days = g.rng.range(2, 3.5);
      g.setWater(CONFIG.water.base + CONFIG.water.floodMax * g.rng.range(0.8, 1), days);
      g.river.flood(g.rng.range(...CONFIG.sediment.floodDeposit));
      return { kind: 'bad', text: `Hochwasser! Die Schifffahrt ist gesperrt, und der Fluss lagert Schlick in der Rinne ab (${days.toFixed(0)} Tage).` };
    },
  },
  {
    id: 'drought', chance: 0.022, when: (g) => !g.water.until,
    apply: (g) => {
      const days = g.rng.range(4, 6), drop = g.rng.range(0.3, g.level.lowWater ?? 0.6);
      g.setWater(CONFIG.water.base - drop, days);
      return { kind: 'bad', text: `Niedrigwasser: der Pegel sinkt, grosse Schiffe finden zu wenig Wasser unter dem Kiel (${days.toFixed(0)} Tage).` };
    },
  },
  {
    id: 'strike', chance: 0.03,
    apply: (g) => { g.strikeUntil = g.time + 3 * CONFIG.daySeconds; return { kind: 'bad', text: 'Streik der Hafenarbeiter: drei Tage kaum Schiffe.' }; },
  },
  {
    id: 'oilshock', chance: 0.035,
    apply: (g) => { shockMarket(g.market, 'oel', 1.5); shockMarket(g.market, 'chemie', 1.2); return { kind: 'info', text: 'Ölpreis springt: Tankschiffe sind gefragt (und deine Abgabe auch).' }; },
  },
  {
    id: 'cropfail', chance: 0.035,
    apply: (g) => { shockMarket(g.market, 'getreide', 1.45); return { kind: 'info', text: 'Missernte im Süden: Getreide wird teuer, mehr Frachter unterwegs.' }; },
  },
  {
    id: 'construction', chance: 0.035,
    apply: (g) => { shockMarket(g.market, 'kies', 1.6); shockMarket(g.market, 'container', 1.15); return { kind: 'info', text: 'Bauboom: Kies und Container sind gefragt.' }; },
  },
  {
    id: 'recession', chance: 0.025,
    apply: (g) => { for (const id of ['container', 'kohle', 'erz']) shockMarket(g.market, id, 0.75); return { kind: 'bad', text: 'Konjunkturdelle: Container, Kohle und Erz werden billiger.' }; },
  },
  {
    id: 'pump_repair', chance: 0.06,
    apply: (g) => { const c = round100(g.rng.range(1500, 4500)); g.money -= c; g.totals.eventCosts += c; g.today.costs += c; return { kind: 'bad', text: `Werkstatt: Der Schlepper brauchte neue Lager (−${c} CHF)` }; },
  },
  {
    id: 'subsidy', chance: 0.04,
    apply: (g) => { const c = round100(g.rng.range(3000, 8000)); g.money += c; g.totals.eventGains += c; return { kind: 'good', text: `Der Bund findet im Budget einen Zuschuss für die Wasserstrasse (+${c} CHF)` }; },
  },
];
