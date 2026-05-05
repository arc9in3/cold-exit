// Quality tiers. Three tiers, each strictly cheaper than the next:
//
//   high   — desktop default; all postfx, soft shadows, full pixel ratio.
//   low    — integrated GPUs / weak laptops; no postfx, no shadows, no
//            outlines, no muzzle lights, lower pixel ratio. Existing tier.
//   potato — phone-class targets (iPhone X / A11 / Apple GPU 3-core era).
//            Adds: half-resolution backbuffer (render scale 0.7), no fog,
//            no muzzle flashes (lights AND mesh sprites), reduced rig
//            pool, no ambient SFX, fewer concurrent enemies. Visually
//            stripped, but PLAYABLE on a 2017 phone.
//
// `antialias` is a WebGLRenderer *construction* option — it can't be
// flipped once the renderer exists. For that specific flag we read
// `getQualityPref()` BEFORE the renderer is built (see main.js) and
// any change requires a reload. Everything else applies live.

import { setCelShading } from './gltf_cache.js';

const STORAGE_KEY = 'tacticalrogue_quality';
const VALID = new Set(['potato', 'low', 'high']);

// Heuristic — best guess at whether we're running on a phone-class
// target. Two signals: UA "Mobile" string + navigator.deviceMemory <= 4.
// Either alone defaults to potato; both together is high confidence.
// User can always override via setQualityPref. Returns the suggested
// default tier when no explicit pref exists.
function _detectDefault() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isMobileUA = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
    const mem = (typeof navigator !== 'undefined' && Number(navigator.deviceMemory)) || 0;
    if (isMobileUA && mem && mem <= 4) return 'potato';
    if (isMobileUA) return 'low';
    if (mem && mem <= 4) return 'low';
  } catch (_) {}
  return 'high';
}

export function getQualityPref() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (VALID.has(raw)) return raw;
  } catch (_) {}
  return _detectDefault();
}

export function setQualityPref(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, VALID.has(mode) ? mode : 'high');
  } catch (_) {}
}

// Apply the selected quality to every runtime-tweakable knob. Takes
// a `ctx` bag so the caller can pass whatever they have — anything
// missing is silently skipped so partial setup (e.g. during init)
// still works.
//
//   ctx.renderer  — THREE.WebGLRenderer
//   ctx.scene     — THREE.Scene (for fog)
//   ctx.keyLight  — the DirectionalLight with shadowMap
//   ctx.gridHelper — optional THREE.GridHelper to hide in low mode
//
// `qualityFlags` is also written to a shared module state other
// systems can read (e.g. to skip per-frame raycasts).
export const qualityFlags = {
  // Live tier — useful for callsites that need >2-tier branching.
  // Always one of 'high' / 'low' / 'potato'.
  tier: 'high',
  shadows: true,
  outlines: true,
  wallOcclusionForEnemies: true,
  enemyVisibilityEveryFrame: true,
  highPixelRatio: true,
  // When false, player + AI muzzle flashes spawn no PointLight. Keeps
  // the visual flash mesh + tracer. Cuts per-frame light count to
  // just the scene's static directional lights + hemisphere.
  muzzleLights: true,
  // When false, fill + rim directional lights are disabled — scene
  // relies on the key light + hemisphere only. Big shader win.
  sideLights: true,
  // Post-processing chain (bloom + vignette + grain + chromatic).
  // Off in low / potato — the extra render targets + composite cost
  // double GPU time on integrated cards.
  postFx: true,
  // ----- POTATO-tier additions (off only when tier === 'potato') -----
  // When false: muzzle-flash sprite meshes don't render either. On
  // 'low' the lights are off but flash sprite still draws (~3-5
  // additive draws per shot). On 'potato' the sprites are also cut.
  muzzleFlashSprites: true,
  // When false: tracer particles for hitscan weapons are skipped.
  // The damage still applies; only the visual line is cut. Saves a
  // line-strip draw + per-frame buffer update per active tracer.
  tracerParticles: true,
  // When false: scene fog uniform is bypassed entirely. Fog is per-
  // fragment and on TBDR mobile GPUs each shader does the math even
  // when the camera is past `fog.far`. Killing it is a fragment win.
  sceneFog: true,
  // When false: ambient/positional sound is muted. Saves audio mixer
  // CPU + GC pressure from per-frame distance attenuation.
  ambientAudio: true,
  // Multiplier applied to the render-target backing buffer size. 1.0
  // = full canvas resolution; 0.7 = render at 70% then upscale via
  // CSS. Biggest single fillrate save on mobile GPUs (which are
  // bandwidth-limited far before they're shader-limited).
  renderScale: 1.0,
  // Hard cap on simultaneously-rendered enemies. Above this, spawn
  // is throttled / older enemies are reaped. Default = unlimited
  // for high; mobile clamps so phone GPUs don't choke on 30+ rigs.
  maxConcurrentEnemies: Infinity,
};

export function applyQuality(mode, ctx = {}) {
  const tier = VALID.has(mode) ? mode : 'high';
  const low    = tier !== 'high';      // anything below high
  const potato = tier === 'potato';    // hardest cuts
  qualityFlags.tier = tier;
  qualityFlags.shadows = !low;
  qualityFlags.outlines = !low;
  qualityFlags.wallOcclusionForEnemies = !low;
  qualityFlags.enemyVisibilityEveryFrame = !low;
  qualityFlags.highPixelRatio = !low;
  qualityFlags.muzzleLights = !low;
  qualityFlags.sideLights = !low;
  qualityFlags.postFx = !low;
  // POTATO-only additions — visual identity sacrificed for fillrate.
  qualityFlags.muzzleFlashSprites = !potato;
  qualityFlags.tracerParticles = !potato;
  qualityFlags.sceneFog = !potato;
  qualityFlags.ambientAudio = !potato;
  qualityFlags.renderScale = potato ? 0.7 : 1.0;
  // Concurrent-enemy clamp. Profiling at 14 gunmen on 6× CPU throttle
  // (≈ A11 single-thread) showed ~16 FPS — half the idle rate. Real
  // A11 GPU is also weaker, so 8 is the playability ceiling for now.
  // Sub-bosses + bosses + tutorial dummies + key-holders bypass the
  // cap (objective-bearing — see spawn loop in main.js).
  qualityFlags.maxConcurrentEnemies = potato ? 8 : Infinity;

  if (ctx.renderer) {
    ctx.renderer.shadowMap.enabled = !low;
    // Pixel ratio progression: high = 1.25, low = 1.0, potato = 1.0
    // (potato also cuts via renderScale so the backbuffer is yet
    // smaller). High dropped 1.5 → 1.25 to compensate for the postFx
    // scale moving back to 1.0; low/potato hold at 1 so the upscale
    // pass to display is the only stretch.
    ctx.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.25));
    // Apply renderScale as an additional backbuffer-size multiplier
    // on top of pixel ratio. We can't change pixelRatio sub-1, so
    // we resize the canvas with `updateStyle=false` to keep the CSS
    // size while shrinking the backing buffer. Caller must re-call
    // setSize() on viewport changes.
    if (typeof window !== 'undefined') {
      const w = window.innerWidth | 0;
      const h = window.innerHeight | 0;
      const s = qualityFlags.renderScale;
      ctx.renderer.setSize(Math.max(1, (w * s) | 0), Math.max(1, (h * s) | 0), false);
      // Force CSS to fill the viewport regardless of backing buffer.
      const c = ctx.renderer.domElement;
      if (c && c.style) {
        c.style.width = w + 'px';
        c.style.height = h + 'px';
      }
    }
  }
  if (ctx.fillLight) ctx.fillLight.visible = !low;
  if (ctx.rimLight)  ctx.rimLight.visible  = !low;
  if (ctx.scene && ctx.scene.fog) {
    // High keeps the rich fog falloff. Low shrinks far. Potato
    // pushes far so high it disables fog visually without removing
    // the THREE.Fog object (cheaper than scene.fog = null toggling).
    ctx.scene.fog.near = 30;
    ctx.scene.fog.far  = potato ? 1e6 : (low ? 60 : 80);
  }
  if (ctx.keyLight) {
    // Shadow map size scales down per tier. High = 768 (down from
    // legacy 1024). Low = 512. Potato unused since shadows are off,
    // but if a future tier flips them on the slot is here.
    const res = potato ? 256 : (low ? 512 : 768);
    if (ctx.keyLight.shadow.mapSize.x !== res) {
      ctx.keyLight.shadow.mapSize.set(res, res);
      if (ctx.keyLight.shadow.map) {
        ctx.keyLight.shadow.map.dispose();
        ctx.keyLight.shadow.map = null;
      }
    }
    ctx.keyLight.shadow.normalBias = 0.02;
  }
  if (ctx.gridHelper) {
    ctx.gridHelper.visible = !low;
  }
  setCelShading(!low);
}
