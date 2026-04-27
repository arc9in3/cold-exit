// Lightweight synth audio. We generate all game sounds via WebAudio
// oscillators + noise buffers — no external files. Each sound is a short
// gain-enveloped burst.
//
// Browsers require a user gesture before AudioContext can start, so the
// context is created lazily on first `play()` call that follows an
// interaction. We tolerate pre-interaction play calls by no-op'ing.

let ctx = null;
let master = null;
let wet = null;             // reverb return bus
let noiseBuffer = null;
let irBuffer = null;        // convolver impulse response
let ambientNodes = null;    // handles for the running ambient bed
let unlocked = false;
let masterVolume = 0.45;

export function setMasterVolume(v) {
  masterVolume = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = masterVolume;
}
export function getMasterVolume() { return masterVolume; }

function ensureCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = masterVolume;
    master.connect(ctx.destination);
    const sr = ctx.sampleRate;
    // Pre-generate ~0.5s of white noise for gun/hit sounds.
    const nlen = Math.floor(sr * 0.5);
    noiseBuffer = ctx.createBuffer(1, nlen, sr);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < nlen; i++) d[i] = Math.random() * 2 - 1;
    // Synthetic impulse response — exponential-decay noise, ~0.8s.
    // Short indoor-room reverb, not a hall. The decay exponent is
    // sharp so the tail is intimate, not cavernous.
    const irLen = Math.floor(sr * 0.8);
    irBuffer = ctx.createBuffer(2, irLen, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        const t = i / irLen;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 4);
      }
    }
    // Reverb send bus — a convolver with the synthetic IR, summed
    // back to master at low amplitude. Individual sounds route via
    // `connectToWet(node, sendGain)` to feed the tail.
    const conv = ctx.createConvolver();
    conv.buffer = irBuffer;
    wet = ctx.createGain();
    wet.gain.value = 0.32;     // overall wet-mix strength
    conv.connect(wet);
    wet.connect(master);
    wet._input = conv;         // nodes feeding reverb connect here
    // Prime — fire one inaudible burst of each node type so the
    // first real shot doesn't pay first-time JIT/buffer-source/biquad
    // setup costs on the gameplay frame. Routed through a near-zero
    // gain so the player doesn't hear the warmup pop.
    try {
      const primeGain = ctx.createGain();
      primeGain.gain.value = 0.00001;
      primeGain.connect(master);
      const ps = ctx.createBufferSource();
      ps.buffer = noiseBuffer;
      const pf = ctx.createBiquadFilter();
      pf.type = 'lowpass'; pf.frequency.value = 2400;
      ps.connect(pf).connect(primeGain);
      ps.start(); ps.stop(ctx.currentTime + 0.01);
      const po = ctx.createOscillator();
      po.type = 'square'; po.frequency.value = 320;
      po.connect(primeGain);
      po.start(); po.stop(ctx.currentTime + 0.01);
    } catch (_) { /* prime is best-effort */ }
  } catch (_) { ctx = null; }
  return ctx;
}

// Route a source through the reverb bus at the given send gain. Dry
// signal still goes to master directly in the caller — this adds the
// wet tail on top.
function connectToWet(src, send = 0.25) {
  if (!wet || !wet._input) return;
  const sg = ctx.createGain();
  sg.gain.value = send;
  src.connect(sg).connect(wet._input);
}

// Unlock on first user gesture so play() works for real after that.
// Listens on `document` (not just the renderer canvas) so main-menu
// button clicks warm the AudioContext + noise/IR buffers BEFORE the
// first in-game shot. Previously the canvas-only listener meant the
// first shot triggered ~95k samples of buffer init + convolver setup
// mid-frame, which was the visible "first-shot hitch".
export function attachUnlock(domEl) {
  const targets = [document, domEl];
  const unlock = () => {
    unlocked = true;
    ensureCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    for (const t of targets) {
      t.removeEventListener('pointerdown', unlock);
      t.removeEventListener('keydown', unlock);
    }
  };
  for (const t of targets) {
    t.addEventListener('pointerdown', unlock);
    t.addEventListener('keydown', unlock);
  }
}

function burstNoise({ dur = 0.08, lp = 1800, gain = 0.6, lpDecay = false } = {}) {
  if (!unlocked || !ensureCtx()) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = lp;
  if (lpDecay) filt.frequency.linearRampToValueAtTime(lp * 0.3, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  src.connect(filt).connect(g).connect(master);
  src.start();
  src.stop(ctx.currentTime + dur);
}

function tone({ freq, dur = 0.12, type = 'square', gain = 0.25, sweep = 0 } = {}) {
  if (!unlocked || !ensureCtx()) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  if (sweep) o.frequency.linearRampToValueAtTime(freq + sweep, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(ctx.currentTime + dur);
}

export const sfx = {
  fire(weaponClass = 'pistol') {
    // Different spectral character per class.
    if (weaponClass === 'shotgun') {
      burstNoise({ dur: 0.16, lp: 900, gain: 0.9, lpDecay: true });
      tone({ freq: 90, dur: 0.1, type: 'triangle', gain: 0.25, sweep: -40 });
    } else if (weaponClass === 'smg' || weaponClass === 'rifle') {
      burstNoise({ dur: 0.05, lp: 3000, gain: 0.4 });
      tone({ freq: 240, dur: 0.04, type: 'square', gain: 0.12, sweep: -60 });
    } else if (weaponClass === 'lmg') {
      burstNoise({ dur: 0.08, lp: 1800, gain: 0.6 });
      tone({ freq: 130, dur: 0.06, type: 'sawtooth', gain: 0.18, sweep: -20 });
    } else if (weaponClass === 'flame') {
      burstNoise({ dur: 0.12, lp: 800, gain: 0.35, lpDecay: true });
    } else {
      // pistol default
      burstNoise({ dur: 0.06, lp: 2400, gain: 0.5 });
      tone({ freq: 320, dur: 0.04, type: 'square', gain: 0.12, sweep: -80 });
    }
  },
  empty(opts = {}) {
    // Held-trigger dry-fire (`loud: true`) plays a meatier, longer
    // mechanical click at higher gain — a sustained "I'm pulling
    // empty here" cue. Tap dry-fire is the original sharp tick.
    if (opts.loud) {
      tone({ freq: 130, dur: 0.09, type: 'square', gain: 0.42 });
      // Tail thump that gives the click body — sounds like the
      // hammer hitting an empty chamber.
      setTimeout(() => burstNoise({ dur: 0.05, lp: 350, gain: 0.20 }), 35);
    } else {
      tone({ freq: 180, dur: 0.05, type: 'square', gain: 0.2 });
    }
  },
  reload() {
    tone({ freq: 420, dur: 0.08, type: 'square', gain: 0.18, sweep: 60 });
    setTimeout(() => tone({ freq: 300, dur: 0.06, type: 'square', gain: 0.18 }), 140);
  },
  hit() {
    burstNoise({ dur: 0.05, lp: 600, gain: 0.35 });
  },
  headshot() {
    burstNoise({ dur: 0.12, lp: 500, gain: 0.6, lpDecay: true });
    tone({ freq: 80, dur: 0.1, type: 'sine', gain: 0.3, sweep: -30 });
  },
  pickup() {
    tone({ freq: 680, dur: 0.06, type: 'triangle', gain: 0.2, sweep: 200 });
    setTimeout(() => tone({ freq: 880, dur: 0.06, type: 'triangle', gain: 0.2 }), 60);
  },
  ui() {
    tone({ freq: 440, dur: 0.03, type: 'square', gain: 0.1 });
  },
  uiAccept() {
    tone({ freq: 520, dur: 0.05, type: 'triangle', gain: 0.15, sweep: 120 });
  },
  // Stadium-style airhorn — triple-blast harsh sawtooth burst.
  // Used by Hoop Dreams encounter on a successful 2-of-2 score.
  airhorn() {
    if (!unlocked || !ensureCtx()) return;
    const blast = (delay, dur) => setTimeout(() => {
      tone({ freq: 280, dur, type: 'sawtooth', gain: 0.42 });
      tone({ freq: 420, dur, type: 'sawtooth', gain: 0.28 });
      tone({ freq: 560, dur, type: 'square',   gain: 0.18 });
    }, delay);
    blast(0,    0.45);
    blast(550,  0.32);
    blast(1000, 0.55);
  },
  death() {
    tone({ freq: 220, dur: 0.5, type: 'sawtooth', gain: 0.35, sweep: -180 });
  },
  execute() {
    burstNoise({ dur: 0.18, lp: 700, gain: 0.55, lpDecay: true });
    tone({ freq: 120, dur: 0.2, type: 'sawtooth', gain: 0.2, sweep: -60 });
  },
  // Short whoosh as the weapon starts its active swing.
  meleeSwing() {
    burstNoise({ dur: 0.14, lp: 1600, gain: 0.22, lpDecay: true });
  },
  // Heavier thud for a successful melee hit — flesh / armour quality.
  meleeImpact() {
    burstNoise({ dur: 0.10, lp: 420, gain: 0.5, lpDecay: true });
    tone({ freq: 100, dur: 0.1, type: 'sine', gain: 0.28, sweep: -30 });
  },
  // AI fire — softer than the player's fire so a gun battle layers
  // cleanly without drowning out the player's own shots.
  enemyFire(weaponClass = 'pistol') {
    if (!unlocked || !ensureCtx()) return;
    const prev = masterVolume;
    // Temporary gain duck via direct-to-master routing would be
    // heavier to plumb; instead, play softer noise + tone profiles.
    if (weaponClass === 'shotgun') {
      burstNoise({ dur: 0.12, lp: 900, gain: 0.55, lpDecay: true });
    } else if (weaponClass === 'smg' || weaponClass === 'rifle') {
      burstNoise({ dur: 0.04, lp: 3000, gain: 0.26 });
    } else if (weaponClass === 'lmg') {
      burstNoise({ dur: 0.06, lp: 1800, gain: 0.38 });
    } else {
      burstNoise({ dur: 0.05, lp: 2400, gain: 0.30 });
    }
    void prev;
  },
  // Enemy death — downward sweep, shorter + quieter than player death.
  enemyDeath() {
    tone({ freq: 280, dur: 0.22, type: 'sawtooth', gain: 0.22, sweep: -120 });
    burstNoise({ dur: 0.08, lp: 800, gain: 0.18 });
  },
  // Satisfying mechanical click when a door unlocks after a clear.
  doorUnlock() {
    tone({ freq: 120, dur: 0.06, type: 'square', gain: 0.28 });
    setTimeout(() => tone({ freq: 640, dur: 0.09, type: 'triangle', gain: 0.18, sweep: -200 }), 80);
  },
  // Rising chime on "room cleared".
  roomClear() {
    tone({ freq: 520, dur: 0.08, type: 'triangle', gain: 0.22, sweep: 180 });
    setTimeout(() => tone({ freq: 780, dur: 0.14, type: 'triangle', gain: 0.2, sweep: 120 }), 70);
    setTimeout(() => tone({ freq: 1040, dur: 0.18, type: 'triangle', gain: 0.18, sweep: 80 }), 160);
  },
  // Bullet impact on solid (wall/prop). Short tick, dry.
  bulletImpact() {
    burstNoise({ dur: 0.05, lp: 2000, gain: 0.22 });
  },
  // Explosion — low thump layered over filtered noise for the "whumpf".
  explode() {
    tone({ freq: 80, dur: 0.35, type: 'sine', gain: 0.55, sweep: -55 });
    burstNoise({ dur: 0.5, lp: 900, gain: 0.5 });
    setTimeout(() => burstNoise({ dur: 0.25, lp: 400, gain: 0.25 }), 70);
  },
  // Footstep — short muffled thud. `run=true` spikes the transient so
  // running steps read heavier than a walk. Kept intentionally quiet
  // so they layer under gunfire instead of cluttering the mix.
  footstep(run = false) {
    if (!unlocked || !ensureCtx()) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = run ? 260 : 180;
    bp.Q.value = 2.0;
    const g = ctx.createGain();
    const peak = run ? 0.22 : 0.14;
    g.gain.setValueAtTime(peak, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    src.connect(bp).connect(g).connect(master);
    connectToWet(g, 0.18);
    src.start();
    src.stop(ctx.currentTime + 0.15);
  },
  // Start the ambient room-tone bed. Low-pass filtered pink-ish noise
  // running at very low gain plus a slow-LFO-modulated sub drone.
  // Idempotent — subsequent calls are no-ops while a bed is already
  // running.
  ambientStart() {
    if (!unlocked || !ensureCtx()) return;
    if (ambientNodes) return;
    // Noise bed — looped white noise through a heavy low-pass +
    // band-reject to pull out mids so it reads as "HVAC hum".
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 200; lp.Q.value = 0.5;
    const g1 = ctx.createGain();
    g1.gain.value = 0.11;
    src.connect(lp).connect(g1).connect(master);
    connectToWet(g1, 0.15);
    src.start();
    // Sub drone — slow-swelling sine at ~45 Hz with a second detuned
    // layer for movement. Keeps rooms feeling "inhabited".
    const d1 = ctx.createOscillator();
    d1.type = 'sine'; d1.frequency.value = 45;
    const d2 = ctx.createOscillator();
    d2.type = 'sine'; d2.frequency.value = 46.8;
    const dg = ctx.createGain();
    dg.gain.value = 0.05;
    d1.connect(dg); d2.connect(dg); dg.connect(master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;     // ~12s cycle
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.02;
    lfo.connect(lfoG).connect(dg.gain);
    d1.start(); d2.start(); lfo.start();
    ambientNodes = { src, d1, d2, lfo, g1, dg };
  },
  ambientStop() {
    if (!ambientNodes) return;
    try {
      const now = ctx.currentTime;
      ambientNodes.g1.gain.linearRampToValueAtTime(0.0001, now + 0.4);
      ambientNodes.dg.gain.linearRampToValueAtTime(0.0001, now + 0.4);
      setTimeout(() => {
        try { ambientNodes.src.stop(); } catch (_) {}
        try { ambientNodes.d1.stop(); } catch (_) {}
        try { ambientNodes.d2.stop(); } catch (_) {}
        try { ambientNodes.lfo.stop(); } catch (_) {}
        ambientNodes = null;
      }, 450);
    } catch (_) { ambientNodes = null; }
  },
};
