import { CONFIG } from '../config.js';
import { PORT, machineOf, loadHit, hasKai, capacity, buyPrice, sellPrice, openBlock, openPort, buildBlock, build, upgradeBlock, upgrade, demolish, buy, sell, refundFrac } from '../sim/port.js';
import { priceOf, ratioOf } from '../sim/market.js';

// Hafen-Seite: Vollbild-Overlay mit Bauplätzen, Lagern, Handel und Automatik. Die Simulation läuft im Hintergrund weiter.
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;
const t = (n) => `${Math.round(n).toLocaleString('de-CH')} t`;

export function setupPort(root, getGame, onChange) {
  let sig = '', pick = null, phase = 0, zone = 0.5, flashMsg = '', flashT = 0; // pick = Bauplatz, für den das Baumenü offen ist
  const hit = () => {
    const g = getGame(), M = PORT.machines[machineOf(g)], pos = 0.5 + 0.5 * Math.sin(phase), d = Math.abs(pos - zone) / (M.zone / 2);
    const q = d <= 1 ? 1 - d * 0.5 : 0, got = loadHit(g, q);
    flashMsg = q <= 0 ? 'Daneben!' : q > 0.85 ? `Voltreffer! +${Math.round(got)} t` : `+${Math.round(got)} t`; flashT = 1.2;
    zone = 0.2 + Math.random() * 0.6; onChange?.();
  };
  // Pendel und Fristanzeige (ohne die Seite neu zu bauen)
  const tick = (dt) => {
    const g = getGame(), M = PORT.machines[machineOf(g)], mark = root.querySelector('#pg-mark');
    phase += dt * M.speed * 2.2;
    if (mark) {
      mark.style.left = `${(0.5 + 0.5 * Math.sin(phase)) * 100}%`;
      const z = root.querySelector('#pg-zone'); z.style.left = `${(zone - M.zone / 2) * 100}%`; z.style.width = `${M.zone * 100}%`;
      flashT = Math.max(0, flashT - dt); const msg = root.querySelector('#pg-msg'); if (msg) msg.textContent = flashT > 0 ? flashMsg : '';
    }
    for (const j of g.port.jobs ?? []) {
      const el = root.querySelector(`[data-job="${j.id}"]`); if (!el) continue;
      el.querySelector('.jb').style.width = `${(j.done / j.tons) * 100}%`; el.querySelector('.jl').textContent = Math.max(0, Math.round(j.left));
    }
  };
  addEventListener('keydown', (e) => {
    if (root.hidden || e.code !== 'Space') return;
    e.preventDefault(); e.stopImmediatePropagation(); // Leertaste gehört dem Minispiel, solange die Hafenseite offen ist
    if (!e.repeat && root.querySelector('#pg-hit')) hit();
  }, true);
  addEventListener('keyup', (e) => { if (!root.hidden && e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  const render = (force = false) => {
    const g = getGame(), p = g.port;
    const s = JSON.stringify([p, Math.floor(g.money / 200), Object.keys(PORT.commodities).map((id) => Math.round(priceOf(g.market, id))), (p.jobs ?? []).map((j) => j.id), pick, !!g.unlocked.motor]);
    if (s === sig && !force) return;
    sig = s;
    let h = `<div class="port-head"><h2>🏗 Hafen</h2><span class="port-money">${chf(g.money)}</span><button id="port-close">✕ Schliessen (H)</button></div>`;
    if (!p.open) {
      const b = openBlock(g);
      h += `<div class="port-card"><p>Ein eigener Hafen an Land: Kai mit Verladestation, Kies-Lager, Tanklager und Sanierungsanlage. Du kaufst Waren, wenn sie günstig sind, lagerst sie und verkaufst sie an die Schiffe oder von Hand, sobald der Preis steigt.</p>
        <p><small>Voraussetzung: das Motorschiff fährt schon durch die Rinne.</small></p>
        <button class="primary" data-act="open" ${b ? 'disabled' : ''}>Hafengelände erwerben · ${chf(PORT.openCost)}</button>${b ? `<small class="warn"> ${b}</small>` : ''}</div>`;
    } else {
      h += `<div class="port-plots">`;
      p.slots.forEach((sl, i) => {
        if (!sl) { h += `<div class="plot empty"><b>Bauplatz ${i + 1}</b>${pick === i ? Object.entries(PORT.buildings).map(([k, B]) => { const bl = buildBlock(g, i, k); return `<button data-act="build" data-slot="${i}" data-type="${k}" ${bl ? 'disabled' : ''} title="${B.text} ${bl ?? ''}">${B.icon} ${B.name} · ${chf(B.cost)}</button>`; }).join('') + `<button data-act="pick" data-slot="-1">Abbrechen</button>` : `<button data-act="pick" data-slot="${i}">+ Bauen</button>`}</div>`; return; }
        const B = PORT.buildings[sl.type], cm = B.commodity, up = B.up && sl.level <= B.up.length;
        h += `<div class="plot"><div class="plot-icon">${B.icon}</div><b>${B.name}</b> <small>Stufe ${sl.level}</small><small>${B.cap ? 'Kapazität ' + t(B.cap[sl.level - 1]) : sl.type === 'sanierung' ? `spart ${Math.round(B.refund[sl.level - 1] * 100)} % der Altlast-Entsorgung` : B.text}</small>
          ${up ? `<button data-act="up" data-slot="${i}" ${upgradeBlock(g, i) ? 'disabled' : ''}>Ausbauen · ${chf(B.up[sl.level - 1])}</button>` : ''}<button class="ghost" data-act="demo" data-slot="${i}">Abreissen</button></div>`;
      });
      h += `</div>`;
      if (!hasKai(g)) h += `<div class="port-card"><b>Ohne Kai kein Handel.</b> Baue zuerst einen Kai mit Verladestation.</div>`;
      else {
        const jobs = p.jobs ?? [], M = PORT.machines[machineOf(g)];
        h += `<div class="port-card"><b>${M.icon} Verladen mit ${M.name}</b> <small>${jobs.length ? 'Leertaste oder Knopf, wenn der Zeiger im grünen Bereich ist: mehr Tonnen pro Treffer, schneller fertig gibt Zeitbonus' : 'Kein Schiff am Kai. Kommen Schiffe mit Kies oder Öl vorbei, entstehen hier Aufträge.'}</small>`;
        if (jobs.length) {
          h += jobs.map((j, k) => `<div class="job" data-job="${j.id}"><small>${k === 0 ? '▶ ' : ''}${PORT.commodities[j.cargo].icon} ${j.out ? 'Laden' : 'Entladen'} ${t(j.tons)} · Frist <span class="jl">${Math.max(0, Math.round(j.left))}</span> s</small><div class="bar"><i class="jb" style="width:${(j.done / j.tons) * 100}%"></i></div></div>`).join('');
          h += `<div class="track" id="pg-track"><div id="pg-zone"></div><div id="pg-mark"></div></div><button class="primary" id="pg-hit" data-act="hit">${M.icon} Laden! (Leertaste)</button><small id="pg-msg"></small>`;
        }
        h += `</div><div class="port-trade">`;
        for (const [id, C] of Object.entries(PORT.commodities)) {
          const cap = capacity(g, id), st = p.stock[id], r = ratioOf(g.market, id), a = p.auto[id];
          if (cap <= 0) { h += `<div class="port-card"><b>${C.icon} ${C.name}</b><small> braucht ein ${id === 'oel' ? 'Tanklager' : 'Kieslager'}</small></div>`; continue; }
          const gain = p.cost[id] > 0 ? st * (sellPrice(g, id) - p.cost[id]) : 0;
          h += `<div class="port-card"><b>${C.icon} ${C.name}</b> <span class="${r > 1.1 ? 'tr-up' : r < 0.9 ? 'tr-down' : ''}">${Math.round(priceOf(g.market, id))} CHF/t (${Math.round(r * 100)} %)</span>
            <div class="bar"><i style="width:${(st / cap) * 100}%"></i></div><small>Lager ${t(st)} von ${t(cap)}${p.cost[id] > 0 ? ` · Einstand ${Math.round(p.cost[id])} CHF/t · ${gain >= 0 ? 'Gewinn' : 'Verlust'} bei Verkauf ${chf(Math.abs(gain))}` : ''}</small>
            <div class="row"><button data-act="buy" data-id="${id}" data-n="${C.lot}">Kaufen ${C.lot} t · ${chf(C.lot * buyPrice(g, id))}</button><button data-act="sell" data-id="${id}" data-n="${C.lot}" ${st <= 0 ? 'disabled' : ''}>Verkaufen ${C.lot} t · ${chf(C.lot * sellPrice(g, id))}</button><button data-act="sell" data-id="${id}" data-n="999999" ${st <= 0 ? 'disabled' : ''}>Alles verkaufen</button></div>
            <div class="row auto"><label><input type="checkbox" data-act="auto" data-id="${id}" ${a.on ? 'checked' : ''}> 🤖 Automatisch</label>
              <label>kaufen unter <input type="range" min="50" max="100" step="5" value="${Math.round(a.buyBelow * 100)}" data-act="lo" data-id="${id}"> <b>${Math.round(a.buyBelow * 100)} %</b></label>
              <label>verkaufen ab <input type="range" min="100" max="180" step="5" value="${Math.round(a.sellAbove * 100)}" data-act="hi" data-id="${id}"> <b>${Math.round(a.sellAbove * 100)} %</b></label></div></div>`;
        }
        h += `</div>`;
      }
      h += `<div class="port-card"><small>Schiffe mit Kies oder Öl laden bei Preis ≥ 100 % aus deinem Lager (du verkaufst, mit Aufschlag) und entladen bei tieferem Preis (du kaufst günstig); der Kai verdient pro Schiff zusätzlich eine Umschlaggebühr.<br>
        Bisher: ${p.ships} Schiffe umgeschlagen · ${t(p.handled)} · Handelserlös ${chf(p.earned)} · Einkäufe/Bauten ${chf(p.spent)} · Gebühren ${chf(p.fees)}${refundFrac(g) > 0 ? ` · Sanierung spart ${chf(p.refunded ?? 0)}` : ''}</small></div>
        <div class="port-card"><small>Demnächst: Baumaschinen im Gelände (Planieren und Nivellieren), eigene Lagerhallen, Verträge mit Reedereien.</small></div>`;
    }
    root.innerHTML = h;
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT') return;
    const g = getGame(), a = b.dataset.act, slot = +b.dataset.slot, id = b.dataset.id;
    if (a === 'hit') { hit(); return; }
    if (a === 'open') openPort(g);
    else if (a === 'pick') pick = slot < 0 ? null : slot;
    else if (a === 'build') { if (build(g, slot, b.dataset.type)) pick = null; }
    else if (a === 'up') upgrade(g, slot);
    else if (a === 'demo') { if (confirm('Abreissen? Es gibt kein Geld zurück.')) demolish(g, slot); }
    else if (a === 'buy') buy(g, id, +b.dataset.n);
    else if (a === 'sell') sell(g, id, +b.dataset.n);
    render(true); onChange?.();
  });
  root.addEventListener('input', (e) => {
    const el = e.target, g = getGame(), a = el.dataset.act, id = el.dataset.id; if (!a || !id) return;
    const au = g.port.auto[id];
    if (a === 'auto') au.on = el.checked;
    else if (a === 'lo') au.buyBelow = Math.min(+el.value / 100, 1);
    else if (a === 'hi') au.sellAbove = Math.max(+el.value / 100, 1);
    el.parentElement.querySelector('b').textContent = `${el.value} %`;
    sig = '';
  });
  root.addEventListener('change', () => render(true));
  return { render, tick };
}
