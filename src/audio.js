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

// Per-key rate limit for high-rate SFX. Each `burstNoise` / `tone` call
// allocates 3-4 AudioNodes; under heavy combat (8+ AI firing autos +
// player rifle + impacts), the GC churn from short-lived nodes was
// piling up into perceptible main-thread hitches between frames. Cap
// each key at 1 play per `minGap` seconds — overlapping calls in the
// same window are silently dropped. The audio mix doesn't degrade
// because layered identical samples below the gap are already a wash.
const _sfxRate = {
  enemyFire:  { last: 0, minGap: 0.045 },   // ~22/sec global cap
  hit:        { last: 0, minGap: 0.040 },
  headshot:   { last: 0, minGap: 0.080 },
  bulletImpact: { last: 0, minGap: 0.045 },
};
function _rateOk(key) {
  const r = _sfxRate[key];
  if (!r || !ctx) return true;
  const now = ctx.currentTime;
  if (now - r.last < r.minGap) return false;
  r.last = now;
  return true;
}

// Duck the ambient bed when combat fires. The room tone gain ramps to
// `_DUCK_LO` over `_DUCK_DOWN` seconds, holds while shots keep coming,
// and ramps back to its baseline over `_DUCK_UP` after the last shot.
// Audio scheduling lives on the audio thread — once we set the target,
// the gain follows it without per-frame work.
const _DUCK_LO = 0.025;       // ducked ambient gain (baseline is 0.11)
const _DUCK_HI = 0.11;
const _DUCK_DOWN = 0.04;      // ramp-down (snappy on first shot)
const _DUCK_UP   = 0.85;      // ramp-up (slow restore — silence after a fight reads as relief)
let _duckHoldUntil = 0;
function _duckAmbient() {
  if (!ambientNodes || !ctx) return;
  const now = ctx.currentTime;
  ambientNodes.g1.gain.cancelScheduledValues(now);
  // Hold ducked level for 350ms past the last shot. Restoring sooner
  // makes a sustained burst pulse with the rate-limit, which reads as
  // the audio mixer flapping rather than a cohesive duck.
  ambientNodes.g1.gain.setTargetAtTime(_DUCK_LO, now, _DUCK_DOWN);
  _duckHoldUntil = now + 0.35;
  // Schedule the restore. setTargetAtTime is exponential, so we just
  // queue the un-duck after the hold window.
  ambientNodes.g1.gain.setTargetAtTime(_DUCK_HI, _duckHoldUntil, _DUCK_UP);
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
    _duckAmbient();
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
    if (!_rateOk('hit')) return;
    burstNoise({ dur: 0.05, lp: 600, gain: 0.35 });
  },
  headshot() {
    if (!_rateOk('headshot')) return;
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
  // `distance` (optional, meters from listener) drives a hard cull at
  // 30m and a gain falloff inside that. Off-screen volleys pay zero
  // SFX cost. Rate-limited globally to ~22/sec so a swarm of autos
  // doesn't churn AudioNodes faster than the GC can clean them up.
  enemyFire(weaponClass = 'pistol', distance = 0) {
    if (!unlocked || !ensureCtx()) return;
    if (distance > 30) return;
    if (!_rateOk('enemyFire')) return;
    // Ducks too — even a distant volley should drop the room tone,
    // which makes the player tuning into "where are they" easier.
    _duckAmbient();
    // Linear gain falloff 0m → 1.0, 30m → 0.0.
    const distAtten = distance > 0 ? Math.max(0, 1 - distance / 30) : 1;
    if (weaponClass === 'shotgun') {
      burstNoise({ dur: 0.12, lp: 900, gain: 0.55 * distAtten, lpDecay: true });
    } else if (weaponClass === 'smg' || weaponClass === 'rifle') {
      burstNoise({ dur: 0.04, lp: 3000, gain: 0.26 * distAtten });
    } else if (weaponClass === 'lmg') {
      burstNoise({ dur: 0.06, lp: 1800, gain: 0.38 * distAtten });
    } else {
      burstNoise({ dur: 0.05, lp: 2400, gain: 0.30 * distAtten });
    }
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
    if (!_rateOk('bulletImpact')) return;
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
    // Sub drone — DRASTICALLY attenuated. Original 0.05 gain was
    // perceived as a "mechanical droning" sound that fatigued the
    // ear. Pulled to 0.008 (84% reduction) so the bed reads as
    // "quiet room" not "engine room hum". LFO modulation also
    // scaled down proportionally.
    const d1 = ctx.createOscillator();
    d1.type = 'sine'; d1.frequency.value = 45;
    const d2 = ctx.createOscillator();
    d2.type = 'sine'; d2.frequency.value = 46.8;
    const dg = ctx.createGain();
    dg.gain.value = 0.008;
    d1.connect(dg); d2.connect(dg); dg.connect(master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;     // ~12s cycle
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.003;        // proportionally smaller LFO swing
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

  // ---- Music ----
  // Procedural background music — no audio files. Each track is a
  // small synth ensemble: pad chord, slow arpeggio, optional bass.
  // Tracks: 'menu' (sparse, contemplative), 'run' (low-key tension),
  // 'boss' (faster tempo, urgent). Volume is independent of master
  // so player can scale music separately if we add a slider later.
  musicPlay(track = 'menu') {
    if (!unlocked || !ensureCtx()) return;
    if (musicNodes && musicNodes.track === track) return;
    if (musicNodes) this.musicStop();
    const cfg = MUSIC_TRACKS[track] || MUSIC_TRACKS.menu;
    musicNodes = _buildMusicNodes(cfg);
    musicNodes.track = track;
  },
  musicStop() {
    if (!musicNodes) return;
    try {
      const now = ctx.currentTime;
      musicNodes.bus.gain.linearRampToValueAtTime(0.0001, now + 0.6);
      const ref = musicNodes;
      setTimeout(() => {
        try { for (const o of ref.oscs) o.stop(); } catch (_) {}
        try { clearInterval(ref.intervalId); } catch (_) {}
      }, 700);
      musicNodes = null;
    } catch (_) { musicNodes = null; }
  },
};

// ---- Music track definitions ----
let musicNodes = null;
const MUSIC_TRACKS = {
  // Sparse minor-key pad. Contemplative; suits the hideout / menu.
  menu: {
    tempo: 70,
    chord: [220.00, 261.63, 329.63],   // A3 / C4 / E4 — A minor
    arp:   [440.00, 523.25, 659.25, 523.25],
    busGain: 0.16,
    padGain: 0.06,
    arpGain: 0.045,
    arpInterval: 0.85,
  },
  // Low-key tension. In-run combat; restrained so it doesn't fight
  // with gunfire SFX.
  run: {
    tempo: 95,
    chord: [196.00, 246.94, 293.66],   // G3 / B3 / D4 — G major
    arp:   [392.00, 493.88, 587.33, 783.99],
    busGain: 0.12,
    padGain: 0.045,
    arpGain: 0.05,
    arpInterval: 0.55,
  },
  // Faster + brighter for boss fights.
  boss: {
    tempo: 130,
    chord: [146.83, 174.61, 220.00],   // D3 / F3 / A3 — D minor
    arp:   [293.66, 349.23, 440.00, 523.25],
    busGain: 0.18,
    padGain: 0.055,
    arpGain: 0.07,
    arpInterval: 0.32,
  },
};
function _buildMusicNodes(cfg) {
  // Bus — single output gain so musicStop fades cleanly.
  const bus = ctx.createGain();
  bus.gain.value = cfg.busGain;
  bus.connect(master);
  // Wet send — small amount through reverb for room feel.
  if (wet?._input) {
    const send = ctx.createGain();
    send.gain.value = cfg.busGain * 0.4;
    bus.connect(send);
    send.connect(wet._input);
  }
  const oscs = [];
  // Pad — sustained chord. Each note is a sine + slightly detuned
  // saw mixed for warmth. Long attack/release for "drift" feel.
  const padG = ctx.createGain();
  padG.gain.value = cfg.padGain;
  const padLP = ctx.createBiquadFilter();
  padLP.type = 'lowpass';
  padLP.frequency.value = 1200;
  padG.connect(padLP).connect(bus);
  for (const f of cfg.chord) {
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 1.005;
    const ng = ctx.createGain(); ng.gain.value = 0;
    o1.connect(ng); o2.connect(ng); ng.connect(padG);
    // Slow attack for swell feel.
    ng.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 1.2);
    o1.start(); o2.start();
    oscs.push(o1, o2);
  }
  // Arpeggio — single oscillator that re-pitches via a JS interval.
  // Uses a short envelope per note to keep it from droning.
  const arpG = ctx.createGain();
  arpG.gain.value = 0;
  const arpFilter = ctx.createBiquadFilter();
  arpFilter.type = 'lowpass';
  arpFilter.frequency.value = 2400;
  arpG.connect(arpFilter).connect(bus);
  const arpO = ctx.createOscillator();
  arpO.type = 'triangle';
  arpO.frequency.value = cfg.arp[0];
  arpO.connect(arpG);
  arpO.start();
  oscs.push(arpO);
  let arpStep = 0;
  const intervalId = setInterval(() => {
    if (!ctx) return;
    arpStep = (arpStep + 1) % cfg.arp.length;
    arpO.frequency.setValueAtTime(cfg.arp[arpStep], ctx.currentTime);
    const t = ctx.currentTime;
    arpG.gain.cancelScheduledValues(t);
    arpG.gain.setValueAtTime(0, t);
    arpG.gain.linearRampToValueAtTime(cfg.arpGain, t + 0.02);
    arpG.gain.exponentialRampToValueAtTime(0.0001, t + cfg.arpInterval * 0.85);
  }, cfg.arpInterval * 1000);
  return { bus, oscs, intervalId };
}
