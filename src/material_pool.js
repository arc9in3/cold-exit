// Shared material pool — collapses per-mesh material allocations into
// a small set of cached instances keyed by (color, roughness, type, ...).
//
// Why this exists:
//   A typical level used to mint ~1000 unique MeshStandardMaterial /
//   MeshBasicMaterial instances during generation — every prop, wall
//   ornament, container detail, kiosk panel, etc. The renderer pays
//   per-material shader binding and uniform setup per draw call, so
//   colliding all these clones onto a small set of shared materials
//   meaningfully reduces GPU state churn.
//
// Usage:
//   import { sharedMaterial } from './material_pool.js';
//   const mat = sharedMaterial({ color: 0x6a4828, roughness: 0.85 });
//
// IMPORTANT:
//   - DO NOT mutate the returned material in-place (color, opacity,
//     emissive, etc.). Other call sites with identical args are
//     receiving the SAME instance — mutating one corrupts everyone.
//   - If you need transient state (hit-flash, opacity tween, shatter
//     fade), `sharedMaterial(opts).clone()` is still cheaper than a
//     fresh `new` because Three.js shader compilation is keyed by
//     defines/flags, and clone preserves those.
//   - Properties that change shader compilation (transparent, side,
//     depthWrite) MUST be in the cache key — they're non-trivial to
//     toggle on a shared instance.
//
// Four material types supported. Default to 'standard' which matches
// the renderer's PBR pipeline used by walls / props elsewhere:
//   - 'standard' — MeshStandardMaterial (PBR, lit). Default.
//   - 'basic'    — MeshBasicMaterial (unlit). Use for emissive things
//                  (lamps, glass, signage) where lighting would dim them.
//   - 'lambert'  — MeshLambertMaterial (cheap diffuse). Reserved for
//                  call sites that explicitly want it.
//   - 'toon'     — MeshToonMaterial. props.js uses this for furniture
//                  bodies; opts.gradientMap is identity-keyed (the
//                  caller provides a singleton texture).

import * as THREE from 'three';

const _pool = new Map();

// ============================================================
// DETAIL OVERLAY — procedural noise multiply on every standard
// material's diffuseColor. Walls, floors, and props all gain
// surface variation (worn paint / fine grain) without any per-
// material art. Single shared CanvasTexture, generated once on
// demand. Strength + scale live-tunable via DETAIL_TUNE so the
// tweakpane panel can hook it.
// ============================================================
export const DETAIL_TUNE = {
  enabled: true,
  strength: 0.18,    // 0 = no effect, 1 = full multiply darkening
  scale: 1.6,        // texture repeats per world meter
};

let _detailTex = null;
function _getDetailTexture() {
  if (_detailTex) return _detailTex;
  const SIZE = 256;
  const c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!c) return null;  // SSR / no DOM
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  // 4-octave fbm value-noise — soft variation with sharper detail bands.
  // Done CPU-side once at module load; ~30ms one-time cost on a normal
  // device, vs shipping a 16-32 KB PNG in the build.
  const rand = (x, y) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
  const valueNoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = rand(xi, yi),     b = rand(xi + 1, yi);
    const c2 = rand(xi, yi + 1), d = rand(xi + 1, yi + 1);
    const i1 = smooth(a, b, xf), i2 = smooth(c2, d, xf);
    return smooth(i1, i2, yf);
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0, amp = 0.55, freq = 0.04;
      for (let oct = 0; oct < 4; oct++) {
        v += amp * valueNoise(x * freq, y * freq);
        amp *= 0.5; freq *= 2.0;
      }
      v = Math.max(0, Math.min(1, v + 0.15));
      const g = (v * 255) | 0;
      const i = (y * SIZE + x) * 4;
      img.data[i] = g; img.data[i+1] = g; img.data[i+2] = g; img.data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  _detailTex = tex;
  return tex;
}

// Inject a triplanar detail multiply into a MeshStandardMaterial.
// Idempotent — flag-stamped on first attach. The shader samples
// the procedural detail texture in world-space XZ (good for floors),
// then YZ + XY for vertical surfaces, blended by the world normal.
// Result: a floor reads as concrete grain, walls as worn paint.
//
// Uniforms are SHARED references so DETAIL_TUNE updates apply live
// without re-creating the material.
function _attachDetailOverlay(material) {
  if (!material || material._detailAttached) return material;
  if (!material.isMeshStandardMaterial) return material; // PBR only
  const detail = _getDetailTexture();
  if (!detail) return material;
  material._detailAttached = true;
  // Persist a reference so the tuner can find these. Three.js shares
  // uniforms between actions but onBeforeCompile binds to the per-
  // material scope — we keep an outer object so live edits flow in.
  material.userData = material.userData || {};
  material.userData.detail = { strength: DETAIL_TUNE.strength, scale: DETAIL_TUNE.scale, enabled: DETAIL_TUNE.enabled ? 1 : 0 };
  const ud = material.userData.detail;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    // Share the userData refs by closure — onBeforeCompile only fires
    // once per material; the values are read every frame from the
    // userData object since shader.uniforms.uX.value can be reassigned
    // each render via onBeforeRender.
    shader.uniforms.uDetailStrength = { value: ud.strength };
    shader.uniforms.uDetailScale    = { value: ud.scale };
    shader.uniforms.uDetailEnabled  = { value: ud.enabled };
    material.userData._detailUniforms = {
      strength: shader.uniforms.uDetailStrength,
      scale:    shader.uniforms.uDetailScale,
      enabled:  shader.uniforms.uDetailEnabled,
    };
    // Pass world position + normal through to the fragment.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        varying vec3 vDetailWorldPos;
        varying vec3 vDetailWorldNormal;
      `)
      .replace('#include <worldpos_vertex>', `
        #include <worldpos_vertex>
        vDetailWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vDetailWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `
        #include <common>
        uniform sampler2D uDetail;
        uniform float uDetailStrength;
        uniform float uDetailScale;
        uniform float uDetailEnabled;
        varying vec3 vDetailWorldPos;
        varying vec3 vDetailWorldNormal;
      `)
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        if (uDetailEnabled > 0.5) {
          // Triplanar — sample on XZ (top/floor), YZ (X-walls), XY (Z-walls).
          // Blend by absolute world normal so each face uses the projection
          // that doesn't visibly stretch.
          vec3 nAbs = abs(vDetailWorldNormal);
          float wSum = nAbs.x + nAbs.y + nAbs.z + 1e-5;
          nAbs /= wSum;
          float dxz = texture2D(uDetail, vDetailWorldPos.xz * uDetailScale).r;
          float dyz = texture2D(uDetail, vDetailWorldPos.yz * uDetailScale).r;
          float dxy = texture2D(uDetail, vDetailWorldPos.xy * uDetailScale).r;
          float d = dxz * nAbs.y + dyz * nAbs.x + dxy * nAbs.z;
          // Map [0,1] noise → [-1, +1] additive then scale by strength
          // so half the time we lift highlights, half we crush shadows.
          // Reads as 'wear' rather than uniform darkening.
          float k = (d - 0.5) * 2.0 * uDetailStrength;
          diffuseColor.rgb *= (1.0 + k);
        }
      `);
  };
  // Mark for shader recompile (user might be calling on a material
  // already used in a frame).
  material.needsUpdate = true;
  return material;
}

// Public — push current DETAIL_TUNE values into every attached material's
// shader uniforms. Cheap (O(pool size) of pointer writes). Tuner sliders
// call this on change.
export function refreshDetailOverlay() {
  for (const m of _pool.values()) {
    if (!m._detailAttached) continue;
    m.userData.detail.strength = DETAIL_TUNE.strength;
    m.userData.detail.scale = DETAIL_TUNE.scale;
    m.userData.detail.enabled = DETAIL_TUNE.enabled ? 1 : 0;
    const u = m.userData._detailUniforms;
    if (u) {
      u.strength.value = DETAIL_TUNE.strength;
      u.scale.value = DETAIL_TUNE.scale;
      u.enabled.value = DETAIL_TUNE.enabled ? 1 : 0;
    }
  }
}

// Build the cache key. Only the actually-set fields appear in the key
// so two callers passing { color: 0x123 } get the same hit even if one
// of them happens to default `roughness` to 0.85 explicitly.
function _key(opts) {
  const t = opts.type || 'standard';
  // Order is fixed so { color, roughness } and { roughness, color }
  // produce the same key.
  return [
    t,
    opts.color ?? 0xffffff,
    opts.roughness ?? '_',
    opts.metalness ?? '_',
    opts.transparent ? 1 : 0,
    opts.opacity ?? '_',
    opts.emissive ?? '_',
    opts.emissiveIntensity ?? '_',
    opts.side ?? '_',
    opts.depthWrite === false ? 0 : 1,
    opts.gradientMap ? '_grad' : '_',
  ].join('|');
}

// Construct the actual material from opts. Branched per-type so we
// don't pass MeshBasic args (e.g. roughness) to MeshStandard and the
// other way around.
function _build(opts) {
  const t = opts.type || 'standard';
  if (t === 'toon') {
    const args = { color: opts.color };
    if (opts.gradientMap) args.gradientMap = opts.gradientMap;
    if (opts.transparent) args.transparent = true;
    if (opts.opacity != null) args.opacity = opts.opacity;
    if (opts.side != null) args.side = opts.side;
    if (opts.depthWrite === false) args.depthWrite = false;
    return new THREE.MeshToonMaterial(args);
  }
  if (t === 'basic') {
    const args = { color: opts.color };
    if (opts.transparent) args.transparent = true;
    if (opts.opacity != null) args.opacity = opts.opacity;
    if (opts.side != null) args.side = opts.side;
    if (opts.depthWrite === false) args.depthWrite = false;
    return new THREE.MeshBasicMaterial(args);
  }
  if (t === 'lambert') {
    const args = { color: opts.color };
    if (opts.transparent) args.transparent = true;
    if (opts.opacity != null) args.opacity = opts.opacity;
    if (opts.side != null) args.side = opts.side;
    if (opts.depthWrite === false) args.depthWrite = false;
    if (opts.emissive != null) args.emissive = opts.emissive;
    if (opts.emissiveIntensity != null) args.emissiveIntensity = opts.emissiveIntensity;
    return new THREE.MeshLambertMaterial(args);
  }
  // standard
  const args = { color: opts.color };
  if (opts.roughness != null) args.roughness = opts.roughness;
  if (opts.metalness != null) args.metalness = opts.metalness;
  if (opts.transparent) args.transparent = true;
  if (opts.opacity != null) args.opacity = opts.opacity;
  if (opts.side != null) args.side = opts.side;
  if (opts.depthWrite === false) args.depthWrite = false;
  if (opts.emissive != null) args.emissive = opts.emissive;
  if (opts.emissiveIntensity != null) args.emissiveIntensity = opts.emissiveIntensity;
  return new THREE.MeshStandardMaterial(args);
}

// Public — fetch a shared material. Returns the same instance for every
// call with identical opts. Stamp `userData.shared = true` so any
// traversal-based dispose loop can skip these (they outlive every
// individual mesh).
export function sharedMaterial(opts = {}) {
  const k = _key(opts);
  let m = _pool.get(k);
  if (m) return m;
  m = _build(opts);
  m.userData = m.userData || {};
  m.userData.shared = true;
  m.userData.sharedRigGeom = true;   // stamp matches existing dispose-skip flag
  // Auto-attach the procedural detail overlay on every new standard
  // material (PBR pipeline). Caller can opt out per material via
  // opts.skipDetail = true (e.g. emissive signage that should stay
  // flat). Toon / basic / lambert types skip naturally.
  if (!opts.skipDetail) _attachDetailOverlay(m);
  _pool.set(k, m);
  return m;
}

// Public — pool stats for the perf probe. Returns { size, byType }.
export function poolStats() {
  const byType = { standard: 0, basic: 0, lambert: 0, toon: 0 };
  for (const k of _pool.keys()) {
    const t = k.split('|')[0];
    if (byType[t] != null) byType[t] += 1;
  }
  return { size: _pool.size, byType };
}

// Public — drop the cache. Not normally needed (materials are cheap to
// keep alive across levels and GPU-side they're already shared), but
// useful for tests / perf probes that want a clean slate per run.
export function clearPool() {
  for (const m of _pool.values()) {
    try { m.dispose?.(); } catch (_) { /* ignore */ }
  }
  _pool.clear();
}

// Public — dispose-skipping helper. Use everywhere a level/encounter
// teardown previously did `mat.dispose()`. Pooled materials (those
// stamped userData.shared = true by sharedMaterial()) survive — they're
// owned by the pool and shared across many meshes, so disposing one
// would corrupt every other consumer.
//
// Returns true if the material was disposed, false if it was kept.
export function disposeIfNotShared(material) {
  if (!material) return false;
  if (material.userData && material.userData.shared) return false;
  try { material.dispose?.(); } catch (_) { /* ignore */ }
  return true;
}

// Convenience — handle the common "material may be array or single"
// shape that Three.js exposes on Mesh.material. Walks each entry and
// disposes only the non-shared ones.
export function disposeMaterialIfNotShared(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    for (const m of material) disposeIfNotShared(m);
  } else {
    disposeIfNotShared(material);
  }
}
