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
  // ----- Sub-high cuts (off on 'low' AND 'potato') -----
  // Non-essential combat fluff: brass eject + muzzle smoke puff.
  // Pure visual juice, no gameplay information. Off on low+potato
  // since per-shot particle pool churn isn't free even when
  // pooled — material updates, draw calls, GC pressure.
  combatVfx: true,
  // ----- POTATO-only cuts (off only when tier === 'potato') -----
  // NOTE: muzzleFlashSprites + tracerParticles are KEPT on every
  // tier including potato. Both are gameplay-readability cues, not
  // visual fluff: the flash tells the player which direction an
  // enemy fired from, the tracer tells them where a hitscan landed.
  // Cutting either felt like the game was being "lied to about" by
  // the renderer. Flags retained for future opt-in cuts but the
  // applyQuality assignment leaves them true on all tiers.
  muzzleFlashSprites: true,
  tracerParticles: true,
  // Scene fog uniform. Fog is per-fragment and on TBDR mobile GPUs
  // each shader does the math even past fog.far. Killing it is a
  // fragment win. Low keeps it (it shrinks fog.far).
  sceneFog: true,
  // Ambient/positional sound. Off on potato; low keeps it.
  ambientAudio: true,
  // Backing-buffer scale. 1.0 = full canvas; 0.7 = render at 70%
  // then upscale via CSS. Biggest single fillrate save on mobile
  // GPUs (bandwidth-limited far before shader-limited).
  renderScale: 1.0,
  // Hard cap on simultaneously-spawned enemies. Sub-bosses,
  // bosses, tutorial dummies, and key-holders bypass the cap.
  // High = unlimited; low = 24 (eases integrated GPU + weak laptop);
  // potato = 8 (phone-class).
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
  // Post-FX chain (Kawase bloom + ASC-CDL grade + Sobel outline +
  // vignette + LoS darken) used to be the high-tier flagship. Playtest
  // call: "currently the low performance mode looks superior to the
  // high. whatever post effects are happening in high … does not look
  // good." Sobel outline at 0.78 strength was the loudest contributor,
  // adding fuzzy dark edges across every cel-band cliff. Bloom + grade
  // on top combined into "muddier than the raw render."
  //
  // 2026-05-28: re-tuned + re-enabled for high tier. The loud Sobel
  // outline (0.78) is down to 0.30, grade 0.40 → 0.15, bloom 0.40 →
  // 0.20, and ACES tone mapping now sits in front so bloom reads as
  // light instead of white clip. Default ON for high; opt OUT per
  // session via `localStorage.coldExitPostFx = '0'` if it regresses
  // (opt IN with '1' still forces it on a low tier for testing).
  let _postFxPref = null;
  try {
    const v = localStorage.getItem('coldExitPostFx');
    if (v === '0') _postFxPref = false;
    else if (v === '1') _postFxPref = true;
  } catch (_) {}
  qualityFlags.postFx = (_postFxPref !== null ? _postFxPref : true) && !low;
  // Off on low + potato: pure visual fluff with no gameplay signal.
  qualityFlags.combatVfx = !low;
  // muzzleFlashSprites + tracerParticles stay TRUE on every tier
  // (including potato) — both are gameplay-readability cues, not
  // visual fluff. Kept as flags for future tunability but the
  // assignment is constant true today.
  qualityFlags.muzzleFlashSprites = true;
  qualityFlags.tracerParticles = true;
  // POTATO-only: cuts that hurt visual identity but don't carry
  // gameplay information.
  qualityFlags.sceneFog = !potato;
  qualityFlags.ambientAudio = !potato;
  qualityFlags.renderScale = potato ? 0.7 : 1.0;
  // Concurrent-enemy clamp progression: high = unlimited; low = 24
  // (covers any realistic floor density on integrated GPU); potato
  // = 8 (phone-class). Throttled-CPU profiling showed potato wave
  // FPS roughly halves between 8 and 14 enemies; 8 is the
  // playability ceiling on a 6× CPU throttle ≈ A11 single-thread.
  qualityFlags.maxConcurrentEnemies = potato ? 8 : (low ? 24 : Infinity);

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
  // Grid helper stays hidden across quality modes — the per-room
  // floor patches + dark void make the 300×300 grid lines fight the
  // intended look. Kept in the scene as a debug-toggle handle, not
  // a quality-tier visual.
  setCelShading(!low);
}
