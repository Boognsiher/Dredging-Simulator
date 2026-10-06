import { CONFIG, UPGRADES, SHIPS, shipById, cargoById } from '../config.js';
import { upgradeCost } from './stats.js';
import { waitingByClass } from './traffic.js';
import { ratioOf } from './market.js';
import { hireBlock, nextHireCost } from './fleet.js';

// Flussmeister Fritz: gibt Tipps (Gag im Stil einer Büroklammer mit Kapitänsmütze). Reine Logik ohne DOM, damit testbar.
// observe() sammelt laufend Messwerte (geglättet), pick() liefert höchstens einen Tipp, wenn Pause, Abstand und Bedingung passen.
const ema = (x, v, dt, tau) => x + (v - x) * Math.min(1, dt / tau);
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;

export class Advisor {
  constructor(muted = []) {
    this.muted = new Set(muted);
    this.enabled = true;
    this.runTime = 0;
    this.lastShown = -Infinity;
    this.shownAt = {};
    this.t = { bufFull: 0, turb: 0, tips: [], clogs: [], outRate: 0 };
  }

  observe(dt, d, game, sim) {
    this.runTime += dt;
    const t = this.t, tau = CONFIG.advisor.tau;
    t.bufFull = ema(t.bufFull, sim.bufferFull ? 1 : 0, dt, tau);
    t.turb = ema(t.turb, sim.turbidity ?? 0, dt, tau);
    t.outRate = ema(t.outRate, dt > 0 ? (d?.out ?? 0) / dt : 0, dt, tau);
    for (let i = 0; i < (d?.tips ?? 0); i++) t.tips.push(game.time);
    for (let i = 0; i < (d?.clogs ?? 0); i++) t.clogs.push(game.time);
    const cut = game.time - CONFIG.advisor.eventWindow;
    t.tips = t.tips.filter((x) => x >= cut); t.clogs = t.clogs.filter((x) => x >= cut);
  }

  // Passendes Upgrade zu den Messwerten, nur wenn es bezahlbar ist: { id, cost } oder null
  recommend(game) {
    const t = this.t, L = game.levels, A = CONFIG.advisor;
    const order = [];
    if (t.bufFull > A.bufferFull) order.push('plant', 'dewater');
    if (t.turb > A.turbidity) order.push('curtain');
    if (t.tips.length >= 1) order.push('ballast');
    if (this.rockBlocked(game)) order.push('cutter', 'loeffel');
    if (L.auto === 0 && game.totals.removed > 400) order.push('auto');
    order.push('power', 'beacons', 'sorter', 'speed', 'radius', 'winch', 'pilot', 'vts', 'echolot', 'plant');
    for (const id of order) {
      if (!UPGRADES[id] || L[id] >= UPGRADES[id].maxLevel) continue;
      const cost = upgradeCost(id, L[id]);
      if (cost <= game.money) return { id, cost };
    }
    return null;
  }

  // Hängt eine Klasse nur noch am Fels?
  rockBlocked(game) {
    return SHIPS.some((s) => game.level.classes.includes(s.id) && game.fair?.[s.id] && !game.fair[s.id].passable && game.fair[s.id].volume < Infinity && game.stats.rockFirmness < 0.3 && this.rockShare(game, s.id) > 0.25);
  }
  rockShare(game, id) {
    const f = game.fair?.[id]; if (!f?.path) return 0;
    const r = game.river, needTop = game.wl - f.need;
    let rock = 0, n = 0;
    for (const p of f.path.points) {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) continue;
      n++; if (r.rock[r.idx(x, y)] > needTop) rock++;
    }
    return n ? rock / n : 0;
  }

  // Alle Tipps: prio = Dringlichkeit (grösser zuerst), when = Bedingung, text = Spruch, upgrade = Kaufknopf (optional)
  tips(game, sim) {
    const t = this.t, A = CONFIG.advisor, rec = this.recommend(game), name = (id) => UPGRADES[id].name;
    const waiting = waitingByClass(game);
    // Klasse mit den meisten Wartenden, die noch nicht fahren kann (und am wenigsten Baggerarbeit braucht)
    const stuck = SHIPS.filter((s) => game.level.classes.includes(s.id) && game.fair?.[s.id] && !game.fair[s.id].passable && (waiting[s.id] ?? 0) + (game.rejectedBy[s.id] ?? 0) > 0)
      .sort((a, b) => game.fair[a.id].volume - game.fair[b.id].volume)[0];
    const next = SHIPS.filter((s) => game.level.classes.includes(s.id) && game.fair?.[s.id] && !game.fair[s.id].passable && game.fair[s.id].volume < Infinity).sort((a, b) => game.fair[a.id].volume - game.fair[b.id].volume)[0];
    const hot = [...new Set(SHIPS.flatMap((s) => s.cargo))].filter((c) => ratioOf(game.market, c) > 1.3)[0];
    return [
      { id: 'start', prio: 100, when: () => game.totals.removed < 1 && game.day <= 3 && this.runTime > A.firstAfter,
        text: () => 'Willkommen an der Wasserstrasse, ich bin Fritz, dein Flussmeister! Oben siehst du, was jede Schiffsklasse braucht. Wähle eine, fahr mit dem Ponton zu den roten Engstellen, wirf den Anker und schalte die Pumpe ein. Je tiefer die Rinne, desto grössere Schiffe, desto mehr Gebühren.' },
      { id: 'buffer', prio: 90, when: () => t.bufFull > A.bufferFull && sim.mode !== 'map',
        text: () => `Der Puffer ist schon wieder voll, die Pumpe steht rum wie ein Schleusenwärter im Feierabend. ${rec && ['plant', 'dewater'].includes(rec.id) ? `Wie wäre es mit mehr ${name(rec.id)}?` : 'Eine bessere Aufbereitungsanlage bringt das Baggergut schneller durch.'}`,
        upgrade: () => (rec && ['plant', 'dewater'].includes(rec.id) ? rec : null) },
      { id: 'tipover', prio: 85, when: () => t.tips.length >= 1,
        text: () => `Die Pumpe ist umgekippt. Das passiert, wenn man pro Zelle zu viel abträgt: Tempo-Regler hoch, die Pumpe nicht tiefer hängen als nötig${game.levels.ballast < UPGRADES.ballast.maxLevel ? ' oder Ballast kaufen' : ''}.`,
        upgrade: () => (game.levels.ballast < UPGRADES.ballast.maxLevel && upgradeCost('ballast', game.levels.ballast) <= game.money ? { id: 'ballast', cost: upgradeCost('ballast', game.levels.ballast) } : null) },
      { id: 'grounding', prio: 88, when: () => game.totals.groundings >= 1 && game.totals.groundings > (this.shownAt._g ?? 0),
        text: () => { this.shownAt._g = game.totals.groundings; return 'Ein Schiff ist aufgelaufen und hat die Rinne versperrt, die Bergung kostet. Meist ist Niedrigwasser oder die Verlandung schuld: lieber ein Stück tiefer baggern, als nur gerade so viel wie nötig. Ein Verkehrsleitsystem macht die Bergung schneller.'; } },
      { id: 'queue', prio: 80, when: () => !!stuck && (waiting[stuck.id] ?? 0) >= 2,
        text: () => `Am Ufer warten ${waiting[stuck.id]}× ${shipById(stuck.id).name}, sie brauchen ${(shipById(stuck.id).draught + CONFIG.clearance).toFixed(1)} m Wasser und eine ${shipById(stuck.id).beam} Zellen breite Rinne. ${game.fair[stuck.id].volume === Infinity ? 'Der Baggerkorridor ist dafür zu schmal: mit dem Löffelbagger (V) kannst du Ufer im gelben Ausbaustreifen abtragen, dann wird der Fluss breiter.' : `Dir fehlen noch ca. ${Math.round(game.fair[stuck.id].volume)} m³ Baggerarbeit (Karte: Klasse wählen, rote Stellen).`} Wer nicht durchkommt, dreht ab und die Fracht geht auf die Bahn.` },
      { id: 'silt', prio: 76, when: () => !!game.fair && SHIPS.some((s) => game.level.classes.includes(s.id) && (game.totals.byClass[s.id] ?? 0) > 0 && !game.fair[s.id].passable && game.fair[s.id].volume < 120),
        text: () => 'Die Rinne verlandet: der Fluss lagert in langsamem Wasser Schlick ab. Kurz nachbaggern (Karte: rote Stellen), bevor die ersten Schiffe auflaufen. Etwas tiefer als nötig baggern hält länger.' },
      { id: 'flood', prio: 74, when: () => game.closed,
        text: () => 'Hochwasser, die Schifffahrt ist gesperrt. Das Gute: Jetzt stört kein Verkehr beim Baggern. Das Schlechte: Der Fluss bringt Schlick mit, schau nach der Flut, wo die Rinne wieder zu ist.' },
      { id: 'low', prio: 72, when: () => game.wl < CONFIG.water.base - 0.25,
        text: () => `Niedrigwasser (Pegel ${game.wl.toFixed(1)} m statt ${CONFIG.water.base} m): grosse Schiffe finden zu wenig Wasser. Wer jetzt tiefer baggert, hat auch beim nächsten Tief Reserve.` },
      { id: 'rock', prio: 70, when: () => this.rockBlocked(game) && sim.mode === 'slice',
        text: () => `Hier steckt Fels in der Rinne. Ohne Felsfräse oder Löffelbagger (Schaufel, schafft Fels besser) kommst du da kaum durch.${rec && ['cutter', 'loeffel'].includes(rec.id) ? ' Das könntest du dir leisten.' : ''}`,
        upgrade: () => (rec && ['cutter', 'loeffel'].includes(rec.id) ? rec : null) },
      { id: 'protect', prio: 68, when: () => t.outRate > 0.02 && sim.mode === 'slice',
        text: () => 'Du baggerst in die Naturschutzzone (schraffiert, Ufer und Flachwasser): jeder m³ kostet Busse. Bleib im Korridor und lass die Böschung stehen, sonst rutscht sie ohnehin nach.' },
      { id: 'slump', prio: 66, when: () => game.river.slumpedTotal > 400 && sim.mode === 'slice',
        text: () => 'Die Böschung rutscht nach und füllt deine Rinne wieder auf. Wer schmal und tief baggert, baggert doppelt: lieber breit und flach, oder die Kanten schräg ziehen.' },
      { id: 'turb', prio: 62, when: () => t.turb > A.turbidity,
        text: () => `Das Wasser sieht aus wie Milchkaffee, die Busse kommt bestimmt. Langsamer fahren hilft, oder ein Trübungsschutz um den Ponton.${rec && rec.id === 'curtain' ? ' Den könntest du dir leisten.' : ''}`,
        upgrade: () => (rec && rec.id === 'curtain' ? rec : null) },
      { id: 'clog', prio: 60, when: () => t.clogs.length >= 3 && sim.mode === 'slice',
        text: () => 'Schon wieder verstopft? Zieh die Pumpe höher, bevor du über Fremdstoffe fährst. Und beim Freispülen: im grünen Bereich drücken, nicht hektisch hämmern. Bei einer Fliegerbombe gilt: ruhig bleiben.' },
      { id: 'fleet', prio: 64, when: () => game.stats.autoLevel >= 1 && game.fleet.units.length === 0 && game.day > 8 && !hireBlock(game),
        text: () => `Du hast die Automatik und ${chf(game.money)} auf dem Konto: Miete einen Ponton (${chf(nextHireCost(game))}, Panel, Flotte). Er baggert selbstständig an den Engstellen, du musst nicht mehr in den Querschnitt. Mehrere Pontons arbeiten gleichzeitig.` },
      { id: 'fleetrock', prio: 63, when: () => game.fleet.units.some((u) => /Fels/.test(u.note)),
        text: () => 'Ein Flottenponton steht still: Fels im Weg. Mit Felsfräse oder Löffelbagger kommt er weiter.' },
      { id: 'contract', prio: 58, when: () => game.contracts.some((c) => c.status === 'offer'),
        text: () => `Eine Reederei bietet dir einen Frachtauftrag an (Panel, Aufträge). Die Prämie gibt es nur, wenn die Schiffe rechtzeitig durchkommen, schau also, ob die Klasse schon fahren kann.` },
      { id: 'market', prio: 50, when: () => !!hot && game.day > 5,
        text: () => `${cargoById(hot).name} ist gerade ${Math.round((ratioOf(game.market, hot) - 1) * 100)} % teurer als normal: mehr Schiffe unterwegs und mehr Abgabe pro Fahrt. Gut, wenn die passende Klasse fahren kann.` },
      { id: 'next', prio: 45, when: () => !!next && game.day > 8 && next.volume !== Infinity,
        text: () => `Als Nächstes lohnt sich die Rinne für ${next.name}: noch ca. ${Math.round(game.fair[next.id].volume)} m³ Baggerarbeit. Das bringt ${chf(next.fee)} Gebühr pro Schiff plus Anteil an der Fracht.`,
        _next: next },
      { id: 'auto', prio: 40, when: () => game.levels.auto === 0 && game.totals.removed > 600 && rec && rec.id === 'auto',
        text: () => 'Du pumpst schon eine Weile von Hand. Mit der Automatik kannst du Kaffee trinken (ich übernehme keine Haftung, wenn sie sich aufhängt). Sie fährt auf die Solltiefe, die du am Regler einstellst.', upgrade: () => rec },
      { id: 'late', prio: 78, when: () => game.day > game.deadlineDays * 0.7 && game.totals.tons < game.level.goalTons * 0.4,
        text: () => `Die Frist rückt näher, und erst ${Math.round((game.totals.tons / game.level.goalTons) * 100)} % des Verkehrsziels sind geschafft. Jetzt zählen die grossen Klassen: dort ist pro Schiff am meisten zu holen.` },
      { id: 'rich', prio: 30, when: () => game.money > A.richMoney && !!rec,
        text: () => `Du hast ${chf(game.money)} auf dem Konto. Geld ohne Zinsen ist wie Schlick ohne Pumpe. Ich empfehle: ${name(rec.id)} (${chf(rec.cost)}).`,
        upgrade: () => rec },
    ];
  }

  pick(game, sim) {
    const A = CONFIG.advisor;
    if (!this.enabled || game.status !== 'playing') return null;
    if (this.runTime < A.firstAfter || this.runTime - this.lastShown < A.gap) return null;
    const list = this.tips(game, sim).filter((tip) => !this.muted.has(tip.id) && this.runTime - (this.shownAt[tip.id] ?? -Infinity) >= (tip.id === 'start' ? Infinity : A.tipCooldown) && tip.when());
    list.sort((a, b) => b.prio - a.prio);
    const tip = list[0];
    if (!tip) return null;
    this.lastShown = this.runTime; this.shownAt[tip.id] = this.runTime;
    return { id: tip.id, text: tip.text(), upgrade: tip.upgrade?.() ?? null };
  }

  mute(id) { this.muted.add(id); }
}
