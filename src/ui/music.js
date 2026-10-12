// Musik: je Jahreszeit eine eigene Melodie, im Browser synthetisch erzeugt (Web Audio, keine Dateien nötig).
// Liegen Dateien in music/ (frühling|sommer|herbst|winter .mp3 oder .ogg), werden diese stattdessen abgespielt (Schleife, weiche Überblendung).
// Aufbau je Stück: 8 Takte (Melodie A und B über vier Akkorden), Melodie als Stufen der Tonleiter in Achteln (null = Pause).
const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
const mid2f = (m) => 440 * 2 ** ((m - 69) / 12);
const deg2mid = (root, scale, d) => root + scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);

export const TUNES = {
  spring: { file: 'fruehling', bpm: 96, root: 60, scale: MAJ, voice: 'pluck', pad: 0.5, // C-Dur: heiter, laufende Achtel
    chords: [[0, 2, 4], [4, 6, 8], [5, 7, 9], [3, 5, 7]], bass: [0, 4, 5, 3],
    A: [[4, 7, 9, 7, 4, 2, 4, null], [6, 8, 9, 8, 6, 4, 6, null], [5, 7, 9, 7, 5, 4, 5, null], [3, 5, 7, 5, 4, 2, 0, null]],
    B: [[9, 7, 9, 11, 9, 7, 4, 7], [8, 6, 8, 9, 8, 6, 4, 6], [9, 7, 5, 7, 9, 7, 5, null], [7, 5, 3, 5, 4, 2, 0, null]] },
  summer: { file: 'sommer', bpm: 76, root: 55, scale: MAJ, voice: 'flute', pad: 0.7, // G-Dur: warm, ruhig, lange Töne
    chords: [[0, 2, 4], [5, 7, 9], [3, 5, 7], [4, 6, 8]], bass: [0, 5, 3, 4],
    A: [[4, null, null, null, 2, null, 4, null], [7, null, null, null, 5, null, null, null], [5, null, 3, null, 5, null, 7, null], [6, null, null, null, 4, null, null, null]],
    B: [[7, null, 9, null, 7, null, 4, null], [9, null, null, null, 7, null, 5, null], [7, null, 5, null, 3, null, 5, null], [4, null, 6, null, 8, null, null, null]] },
  autumn: { file: 'herbst', bpm: 68, root: 57, scale: MIN, voice: 'string', pad: 0.8, // a-Moll: wehmütig, fallende Linien
    chords: [[0, 2, 4], [5, 7, 9], [2, 4, 6], [6, 8, 10]], bass: [0, 5, 2, 6],
    A: [[7, null, 9, 7, 4, null, 2, null], [7, null, 5, null, 7, 9, 7, null], [4, null, 6, null, 4, 2, 4, null], [6, null, 8, 6, 4, null, null, null]],
    B: [[9, null, 11, 9, 7, null, 4, null], [9, 7, 5, null, 7, null, 9, null], [6, null, 4, 2, 4, null, 6, null], [8, 6, 4, null, 2, 0, null, null]] },
  winter: { file: 'winter', bpm: 54, root: 52, scale: MIN, voice: 'bell', pad: 0.9, // e-Moll: still, klirrend, wenige Glockentöne
    chords: [[0, 2, 4], [5, 7, 9], [2, 4, 6], [6, 8, 10]], bass: [0, 5, 2, 6],
    A: [[7, null, null, null, null, null, 4, null], [5, null, null, null, 7, null, null, null], [9, null, null, null, 6, null, null, null], [8, null, null, null, null, null, null, null]],
    B: [[11, null, null, 9, null, null, 7, null], [9, null, null, null, 7, null, 5, null], [6, null, 9, null, null, null, 4, null], [3, null, null, null, 0, null, null, null]] },
};

// ---- Stimmen ----
const env = (g, t, a, d, peak, end = 0.0008) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(end, t + a + d); };
const note = (ctx, out, voice, t, midi, dur, v) => {
  const f = mid2f(midi);
  if (voice === 'pluck') { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f; env(g, t, 0.01, dur * 0.9, 0.2 * v); o.connect(g).connect(out); o.start(t); o.stop(t + dur); }
  else if (voice === 'flute') { const o = ctx.createOscillator(), l = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; l.frequency.value = 5; lg.gain.value = f * 0.006; l.connect(lg).connect(o.frequency); env(g, t, 0.08, dur, 0.18 * v); o.connect(g).connect(out); o.start(t); l.start(t); o.stop(t + dur + 0.3); l.stop(t + dur + 0.3); }
  else if (voice === 'string') { const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = 900; env(g, t, 0.12, dur * 1.1, 0.13 * v); o.connect(fl).connect(g).connect(out); o.start(t); o.stop(t + dur * 1.3 + 0.2); }
  else { for (const [k, a] of [[1, 0.16], [2.76, 0.06], [5.4, 0.025]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * k; env(g, t, 0.005, dur * 2, a * v, 0.0005); o.connect(g).connect(out); o.start(t); o.stop(t + dur * 2 + 0.1); } } // Glocke
};
const pad = (ctx, out, t, midis, dur, level) => {
  for (const m of midis) for (const det of [-4, 4]) {
    const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = mid2f(m); o.detune.value = det; fl.type = 'lowpass'; fl.frequency.value = 700;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045 * level, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    o.connect(fl).connect(g).connect(out); o.start(t); o.stop(t + dur * 1.1);
  }
};
const bassNote = (ctx, out, t, midi, dur) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = mid2f(midi); env(g, t, 0.02, dur, 0.16); o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.1); };

// ---- Takte planen ----
const scheduleBar = (ctx, out, T, t, bar) => {
  const beat = 60 / T.bpm, barLen = beat * 4, i = bar % 4, form = Math.floor(bar / 4) % 2 ? T.B : T.A;
  pad(ctx, out, t, T.chords[i].map((d) => deg2mid(T.root - 12, T.scale, d)), barLen, T.pad);
  bassNote(ctx, out, t, deg2mid(T.root - 24, T.scale, T.bass[i]), beat * 1.6); bassNote(ctx, out, t + beat * 2, deg2mid(T.root - 24, T.scale, T.bass[i]), beat * 1.2);
  form[i].forEach((d, k) => { if (d == null) return; const nxt = form[i].findIndex((x, j) => j > k && x != null), len = ((nxt < 0 ? 8 : nxt) - k) * beat * 0.5; note(ctx, out, T.voice, t + k * beat * 0.5, deg2mid(T.root, T.scale, d), Math.min(len, T.voice === 'pluck' ? beat : beat * 2.2), k % 2 ? 0.8 : 1); });
  return barLen;
};


// Ein Stück für `seconds` Sekunden in einen (auch Offline-)AudioContext schreiben: für Hörproben und Tests
export function renderTune(ctx, season, seconds) {
  const T = TUNES[season], out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination);
  const barLen = (60 / T.bpm) * 4; let t = 0.05, bar = 0;
  while (t < seconds) { scheduleBar(ctx, out, T, t, bar); t += barLen; bar++; }
}

export function createMusic(audio) {
  let on = true, vol = 0.9, cur = null, want = null, files = {}, tried = {};
  try { on = localStorage.getItem('dredging.music') !== '0'; } catch { /* egal */ }
  const ac = () => audio.ctx?.();

  const startSynth = (ctx, season) => {
    const T = TUNES[season], gain = ctx.createGain(); gain.gain.value = 0.0001; gain.connect(ctx.destination);
    let next = ctx.currentTime + 0.3, bar = 0;
    const tick = () => { while (next < ctx.currentTime + 1.5) { next += scheduleBar(ctx, gain, T, next, bar); bar++; } };
    tick(); const timer = setInterval(tick, 400);
    return { season, gain, stop: () => { clearInterval(timer); setTimeout(() => gain.disconnect(), 6000); } };
  };
  const startFile = (ctx, season, buf) => {
    const gain = ctx.createGain(); gain.gain.value = 0.0001; gain.connect(ctx.destination);
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(gain); src.start();
    return { season, gain, stop: () => { try { src.stop(ctx.currentTime + 3.5); } catch { /* egal */ } setTimeout(() => gain.disconnect(), 4500); } };
  };
  // Dateien suchen (einmal je Jahreszeit): music/<name>.mp3 oder .ogg
  const probe = async (ctx, season) => {
    if (tried[season]) return; tried[season] = true;
    if (typeof fetch === 'undefined' || (typeof location !== 'undefined' && location.protocol === 'file:')) return;
    for (const ext of ['mp3', 'ogg']) {
      try { const r = await fetch(`music/${TUNES[season].file}.${ext}`); if (!r.ok) continue; files[season] = await ctx.decodeAudioData(await r.arrayBuffer()); return; } catch { /* keine Datei */ }
    }
  };
  const fade = (p, to, secs) => { const c = ac(); if (p && c) p.gain.gain.setTargetAtTime(Math.max(0.0001, to), c.currentTime, secs / 3); };

  return {
    get on() { return on; },
    setOn(v) { on = !!v; try { localStorage.setItem('dredging.music', on ? '1' : '0'); } catch { /* egal */ } if (!on && cur) { fade(cur, 0, 0.6); const c = cur; setTimeout(() => c.stop(), 900); cur = null; } },
    // Jede Sekunde aufrufen: season = aktuelle Jahreszeit, active = Spiel läuft (sonst leiser)
    update(season, active = true) {
      const ctx = ac(); if (!ctx || !on || audio.muted) { if (cur && (audio.muted)) fade(cur, 0, 0.4); return; }
      if (want !== season) { want = season; probe(ctx, season); }
      if (!cur || cur.season !== season) { // Jahreszeitwechsel: alte Musik ausblenden, neue einblenden
        if (cur) { fade(cur, 0, 4); const old = cur; setTimeout(() => old.stop(), 6000); }
        cur = files[season] ? startFile(ctx, season, files[season]) : startSynth(ctx, season);
      }
      fade(cur, (active ? 0.45 : 0.16) * vol, 2);
    },
  };
}
