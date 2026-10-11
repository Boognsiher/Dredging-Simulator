import { BOOK } from '../sim/game.js';

// Dashboard «Bilanz»: Gesamtbilanz pro Tag (letzte 10 Tage), je Kategorie, und Hochrechnung auf die nächsten 30 Tage.
// Quelle: game.history (je Tagesende) und die laufenden Zahlen von heute (game.today.cat). «Investitionen & Sonstiges» = Geldveränderung, die keine Kategorie ist (Käufe, Bauten).
const DAYS = 10, AHEAD = 30;
const n0 = (v) => Math.round(v).toLocaleString('de-CH');
const cls = (v) => (Math.round(v) > 0 ? 'pos' : Math.round(v) < 0 ? 'neg' : 'zero');
const cell = (v) => `<td class="${cls(v)}">${Math.round(v) === 0 ? '–' : (v > 0 ? '+' : '−') + n0(Math.abs(v))}</td>`;

export function bookData(g, scope = 'all') {
  const M = scope === 'all' ? null : g.maps?.[scope], src = M ? (M.history ?? []) : (g.history ?? []), hist = src.slice(-DAYS), cur = (M ? M.cat : g.today?.cat) ?? {};
  const days = hist.map((h) => ({ day: h.day, cat: h.cat ?? {}, net: h.net ?? Object.values(h.cat ?? {}).reduce((a, b) => a + b, 0) })); // je Karte gibt es nur das Betriebsergebnis (Investitionen sind nicht einer Karte zugeordnet)
  const keys = Object.keys(BOOK).filter((k) => days.some((d) => d.cat[k]) || cur[k]);
  const rows = keys.map((k) => {
    const vals = days.map((d) => d.cat[k] ?? 0), sum = vals.reduce((a, b) => a + b, 0), avg = days.length ? sum / days.length : 0;
    return { key: k, name: BOOK[k], vals, today: cur[k] ?? 0, avg, proj: avg * AHEAD };
  });
  const op = days.map((d) => Object.values(d.cat).reduce((a, b) => a + b, 0));
  const other = days.map((d, i) => d.net - op[i]);
  const sum = (a) => a.reduce((x, y) => x + y, 0), avg = (a) => (a.length ? sum(a) / a.length : 0);
  return { days, rows, op, other, net: days.map((d) => d.net), avgOp: avg(op), avgOther: avg(other), avgNet: avg(days.map((d) => d.net)), todayOp: Object.values(cur).reduce((a, b) => a + b, 0) };
}

export function booksHtml(g, scope = 'all') {
  const D = bookData(g, scope), tabs = g.maps?.length > 1 ? `<div class="books-tabs">${['all', ...g.maps.map((_, i) => i)].map((k) => `<button data-books-scope="${k}" class="${String(k) === String(scope) ? 'on' : ''}">${k === 'all' ? 'Gesamt' : g.maps[k].name}</button>`).join('')}</div>` : '';
  if (!D.days.length) return `<div class="books-head"><h2>📊 Bilanz</h2><button data-books="close">✕</button></div>${tabs}<p>Noch keine abgeschlossenen Tage. Nach dem ersten Tag erscheint hier, wo du Geld machst und wo Verlust.</p>`;
  const head = `<tr><th>Kategorie</th>${D.days.map((d) => `<th>T${d.day}</th>`).join('')}<th>Heute</th><th>Ø/Tag</th><th>30 Tage</th></tr>`;
  const body = D.rows.map((r) => `<tr><th>${r.name}</th>${r.vals.map(cell).join('')}${cell(r.today)}${cell(r.avg)}${cell(r.proj)}</tr>`).join('');
  const sumRow = (label, vals, today, avg, extra = '') => `<tr class="sum ${extra}"><th>${label}</th>${vals.map(cell).join('')}${cell(today)}${cell(avg)}${cell(avg * AHEAD)}</tr>`;
  const maxAbs = Math.max(1, ...D.rows.map((r) => Math.abs(r.proj)));
  const bars = [...D.rows].sort((a, b) => b.proj - a.proj).map((r) => `<div class="bar-row"><span>${r.name}</span><div class="bar-track"><i class="${r.proj >= 0 ? 'p' : 'n'}" style="width:${(Math.abs(r.proj) / maxAbs) * 100}%"></i></div><b class="${cls(r.proj)}">${r.proj >= 0 ? '+' : '−'}${n0(Math.abs(r.proj))}</b></div>`).join('');
  const verdict = D.avgOp >= 0 ? `Im Schnitt <b class="pos">+${n0(D.avgOp)} CHF pro Tag</b> im Betrieb: Hochrechnung <b class="pos">+${n0(D.avgOp * AHEAD)} CHF</b> in 30 Tagen.` : `Im Schnitt <b class="neg">−${n0(-D.avgOp)} CHF pro Tag</b> im Betrieb: Hochrechnung <b class="neg">−${n0(-D.avgOp * AHEAD)} CHF</b> in 30 Tagen. Verlustbringer unten prüfen.`;
  return `<div class="books-head"><h2>📊 Bilanz</h2><button data-books="close" aria-label="Schliessen">✕</button></div>${tabs}
    <p class="books-sum">${verdict}</p>
    <div class="books-scroll"><table class="books"><thead>${head}</thead><tbody>${body}
      ${sumRow('Betriebsergebnis', D.op, D.todayOp, D.avgOp)}
      ${scope === 'all' ? sumRow('Investitionen & Sonstiges', D.other, 0, D.avgOther, 'dim') + sumRow('Geldveränderung gesamt', D.net, D.todayOp, D.avgNet) : ''}
    </tbody></table></div>
    <h3>Hochrechnung 30 Tage (Ø der letzten ${D.days.length} Tage)</h3><div class="bars">${bars}</div>
    <small>Hochrechnung = Durchschnitt der letzten ${D.days.length} Tage × 30, ohne Investitionen. «Heute» läuft noch. Der Hafenhandel zeigt den Gewinn beim Verkauf (Verkaufserlös minus Einstand), nicht den Einkauf.</small>`;
}

export function setupBooks(getGame) {
  const el = document.createElement('div'); el.id = 'books'; el.hidden = true; document.body.append(el);
  let open = false, acc = 0, scope = 'all';
  const render = () => { const g = getGame(); if (scope !== 'all' && !g.maps?.[scope]) scope = 'all'; el.innerHTML = `<div class="books-card">${booksHtml(g, scope)}</div>`; };
  const set = (v) => { open = v; el.hidden = !v; if (v) render(); };
  el.addEventListener('click', (e) => { const sb = e.target.closest('[data-books-scope]'); if (sb) { scope = sb.dataset.booksScope === 'all' ? 'all' : +sb.dataset.booksScope; render(); return; } if (e.target === el || e.target.closest('[data-books="close"]')) set(false); });
  addEventListener('keydown', (e) => { if (open && e.code === 'Escape') set(false); });
  const btn = document.getElementById('btn-books'); if (btn) btn.onclick = () => set(!open);
  return { toggle: () => set(!open), isOpen: () => open, tick: (dt) => { if (!open) return; acc += dt; if (acc > 1.5) { acc = 0; const sc = el.querySelector('.books-scroll'), x = sc?.scrollLeft ?? 0, y = el.scrollTop; render(); const n = el.querySelector('.books-scroll'); if (n) n.scrollLeft = x; el.scrollTop = y; } } };
}
