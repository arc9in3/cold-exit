// Quality tiers. `high` is the pre-existing default; `low` turns off
// or dials down every expensive knob we can toggle at runtime.
//
// `antialias` is a WebGLRenderer *construction* option — it can't be
// flipped once the renderer exists. For that specific flag we read
// `getQualityPref()` BEFORE the renderer is built (see main.js) and
// any change requires a reload. Everything else applies live.

import { setCelShading } from './gltf_cache.js';

const STORAGE_KEY = 'tacticalrogue_quality';

export function getQualityPref() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'low' || raw === 'high') return raw;
  } catch (_) {}
  return 'high';
}

export function setQualityPref(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode === 'low' ? 'low' : 'high');
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
  // Off in low mode — the extra render targets + composite cost
  // double GPU time on integrated cards.
  postFx: true,
};

export function applyQuality(mode, ctx = {}) {
  const low = mode === 'low';
  qualityFlags.shadows = !low;
  qualityFlags.outlines = !low;
  qualityFlags.wallOcclusionForEnemies = !low;
  qualityFlags.enemyVisibilityEveryFrame = !low;
  qualityFlags.highPixelRatio = !low;
  qualityFlags.muzzleLights = !low;
  qualityFlags.sideLights = !low;
  qualityFlags.postFx = !low;

  if (ctx.renderer) {
    ctx.renderer.shadowMap.enabled = !low;
    // High mode caps pixel ratio at 1.5 (down from 2). On a 4K display
    // the postFx chain (Kawase 4 fullscreen draws + finisher + output)
    // runs at width*height*dpr^2 — dropping 2.0 → 1.5 cuts that ~44%
    // for a barely-perceptible visual delta on the cel-shaded look.
    ctx.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.5));
  }
  if (ctx.fillLight) ctx.fillLight.visible = !low;
  if (ctx.rimLight)  ctx.rimLight.visible  = !low;
  if (ctx.scene && ctx.scene.fog) {
    // Keep fog NEAR at the default value so the player (camera is
    // ~32 units out) doesn't land in the fade band — tightening
    // near made the whole scene visibly muddy in low mode. Only
    // shrink FAR, which still culls distant rooms sooner.
    ctx.scene.fog.near = 30;
    ctx.scene.fog.far  = low ? 60 : 80;
  }
  if (ctx.keyLight) {
    // High mode dropped 1024 → 768 (~44% texel save) — the cel-shaded
    // look hides the resolution loss, and the soft PCF filter is the
    // dominant fragment cost so smaller map = noticeably cheaper
    // shadow render. Low mode unchanged.
    const res = low ? 512 : 768;
    if (ctx.keyLight.shadow.mapSize.x !== res) {
      ctx.keyLight.shadow.mapSize.set(res, res);
      if (ctx.keyLight.shadow.map) {
        ctx.keyLight.shadow.map.dispose();
        ctx.keyLight.shadow.map = null;
      }
    }
    // normalBias offsets shadow samples along the surface normal —
    // mitigates the "shadow acne" that PCF soft sometimes produces
    // on the rig's curved cylinders. Cheap one-uniform set.
    ctx.keyLight.shadow.normalBias = 0.02;
  }
  if (ctx.gridHelper) {
    ctx.gridHelper.visible = !low;
  }
  // Outlines add a back-face-culled inverted-hull sibling to every
  // cel-shaded mesh — dropping them halves the draw-call count.
  setCelShading(!low);
}
