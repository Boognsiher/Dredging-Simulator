// Ton: Pumpenbrummen (Rauschen, Tonhöhe und Lautstärke folgen der Last) und kurze Signale. Startet erst nach der ersten Eingabe
// des Spielers (Browser-Vorgabe). Fehlt WebAudio oder ist der Ton aus, passiert nichts.
export function createAudio() {
  let ac = null, hum = null, gain = null, filt = null, muted = false;
  try { muted = localStorage.getItem('dredging.mute') === '1'; } catch { /* egal */ }
  const init = () => {
    if (ac || typeof AudioContext === 'undefined') return;
    try {
      ac = new AudioContext();
      const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      hum = ac.createBufferSource(); hum.buffer = buf; hum.loop = true;
      filt = ac.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 200;
      gain = ac.createGain(); gain.gain.value = 0;
      hum.connect(filt).connect(gain).connect(ac.destination); hum.start();
    } catch { ac = null; }
  };
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { init(); ac?.resume?.(); }, { passive: true });
  const blip = (freq, dur, type = 'square', vol = 0.12, slide = 0) => {
    if (!ac || muted) return;
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
  };
  return {
    // load 0..1: wie viel die Pumpe gerade wirklich saugt; on = Pumpe läuft
    hum(on, load) {
      if (!gain) return;
      const t = ac.currentTime, v = muted || !on ? 0 : 0.05 + 0.14 * load;
      gain.gain.setTargetAtTime(v, t, 0.08); filt.frequency.setTargetAtTime(160 + 700 * load, t, 0.1);
    },
    clog() { blip(180, 0.25, 'sawtooth', 0.18, -120); },
    tip() { blip(220, 0.7, 'sawtooth', 0.22, -170); },
    pay() { blip(880, 0.08, 'triangle', 0.06, 300); },
    free(r) { if (r === 'miss') blip(150, 0.15, 'sawtooth', 0.12, -60); else if (r === 'hit') blip(520, 0.1, 'triangle', 0.1, 260); else { blip(660, 0.12, 'triangle', 0.12, 330); setTimeout(() => blip(990, 0.2, 'triangle', 0.12, 200), 110); } },
    toggle(on) { blip(on ? 300 : 500, 0.12, 'square', 0.08, on ? 200 : -200); },
    get muted() { return muted; },
    setMuted(m) { muted = m; try { localStorage.setItem('dredging.mute', m ? '1' : '0'); } catch { /* egal */ } if (m) gain?.gain.setTargetAtTime(0, ac.currentTime, 0.05); },
  };
}
