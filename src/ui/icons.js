// Einheitliche Linien-Icons statt Geräte-Emojis: Beim Laden und bei jeder Textänderung in den Knopfleisten werden bekannte Emojis durch kleine SVGs ersetzt.
// Die Texte im Spielcode bleiben unverändert; unbekannte Emojis bleiben stehen.
const P = {
  '⚓': '<circle cx="12" cy="5" r="2.2"/><path d="M12 7.5V21M7 11h10M4.5 15c.6 3.5 3.6 6 7.5 6s6.9-2.5 7.5-6"/>',
  '🏗': '<path d="M4 21h16M7 21V8l8-4M7 8h12M15 4v4M15 8v6M13 14h4"/>',
  '🚤': '<path d="M3 15l2.5 5h13L21 15zM6 15V9h7l4 6M9 9V5h3"/>',
  '🛟': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  '📍': '<path d="M12 21s7-6.200 7-11a7 7 0 10-14 0c0 4.800 7 11 7 11z"/><circle cx="12" cy="10" r="2.500"/>',
  '🧭': '<circle cx="12" cy="12" r="9"/><path d="M15.500 8.500l-2 5-5 2 2-5z"/>',
  '🧱': '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9.700h18M3 14.300h18M9 5v4.700M15 9.700v4.600M9 14.300V19"/>',
  '🔧': '<path d="M14.500 6.500a4 4 0 005 5l-9.500 9.500a2.100 2.100 0 01-3-3z"/>',
  '🌀': '<path d="M12 12a1 1 0 112 0 3 3 0 11-6 0 5 5 0 0110 0 7 7 0 11-14 0"/>',
  '🛣': '<path d="M8 3L5 21M16 3l3 18M12 4v3M12 10v4M12 17v3"/>',
  '🧑‍✈': '<circle cx="12" cy="7" r="3"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/>',
  '▭': '<rect x="3" y="7" width="18" height="10" rx="1.500"/>',
  '〰': '<path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>',
  '🔊': '<path d="M4 9v6h4l5 4V5L8 9zM16.500 9a4 4 0 010 6M18.500 6.500a8 8 0 010 11"/>',
  '🔇': '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>',
  '⏸': '<path d="M8 5v14M16 5v14"/>',
  '↩': '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>',
  '↔': '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  '✔': '<path d="M5 12.500l4.500 4.500L19 7"/>',
  'ⓘ': '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.1"/>',
  '🤖': '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M9 13h.01M15 13h.01M9 16.500h6"/>',
  '🏭': '<path d="M3 21V11l6 3V11l6 3V6h6v15zM7 17h2M12 17h2M17 17h2"/>',
  '🌿': '<path d="M12 21V9M12 13c-4 0-6-3-6-6 4 0 6 2 6 6zM12 16c3 0 5-2 5-5-3 0-5 2-5 5z"/>',
};
const keys = Object.keys(P).sort((a, b) => b.length - a.length);
const RE = new RegExp(`(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\uFE0F?`, 'g');
const SEL = '#shift-actions, #tool-row, #pile-bar, #load-bar, #harbor-back, #legend-btn, #btn-menu';

function iconify(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (RE.test(n.nodeValue)) nodes.push(n);
  RE.lastIndex = 0;
  for (const n of nodes) {
    const frag = document.createDocumentFragment(), text = n.nodeValue; let last = 0; RE.lastIndex = 0;
    for (let m = RE.exec(text); m; m = RE.exec(text)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const span = document.createElement('span'); span.className = 'ico'; span.setAttribute('aria-hidden', 'true');
      span.innerHTML = `<svg viewBox="0 0 24 24">${P[m[1]]}</svg>`; frag.append(span); last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    n.replaceWith(frag);
  }
}

export function startIcons() {
  if (typeof document === 'undefined') return;
  const roots = [...document.querySelectorAll(SEL)]; let queued = false;
  const run = () => { queued = false; obs.disconnect(); for (const el of roots) iconify(el); watch(); };
  const obs = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } });
  const watch = () => { for (const el of roots) obs.observe(el, { childList: true, characterData: true, subtree: true }); };
  // Zuweisungen mit unverändertem Text ändern nichts: verhindert Flackern, wenn der Spielcode Knopftexte jedes Bild neu setzt
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  for (const el of roots) for (const b of [el, ...el.querySelectorAll('button')]) {
    if (b.tagName !== 'BUTTON' || b.__raw !== undefined) continue;
    b.__raw = null;
    Object.defineProperty(b, 'textContent', { configurable: true, get() { return desc.get.call(this); }, set(v) { if (this.__raw === String(v)) return; this.__raw = String(v); desc.set.call(this, v); } });
  }
  run();
}
