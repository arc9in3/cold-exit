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
  // --- procedural NORMAL map (micro-relief) ---
  normalEnabled: true,
  normalScale: 0.4,  // tangent-space normal influence. Kept subtle so it
                     // adds worn-metal / concrete micro-relief without
                     // fighting the cel-shaded toon banding.
  // --- procedural ROUGHNESS variation map ---
  roughnessEnabled: true,
  roughnessAmount: 0.35, // 0 = ignore map, 1 = full [base..1] modulation
};

// ----- shared noise primitives -----
// Factored to module scope so the detail / normal / roughness generators
// all draw from the SAME value-noise field, keeping their relief visually
// coherent (a height bump in the detail multiply lines up with a bump in
// the normal map). Cheap pure functions; no allocation.
const _nRand = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const _nSmooth = (a, b, t) => a + (b - a) * (t * t * (3 - 2 * t));
function _valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = _nRand(xi, yi),     b = _nRand(xi + 1, yi);
  const c2 = _nRand(xi, yi + 1), d = _nRand(xi + 1, yi + 1);
  const i1 = _nSmooth(a, b, xf), i2 = _nSmooth(c2, d, xf);
  return _nSmooth(i1, i2, yf);
}
// 4-octave fbm height in [0,1], matching the detail texture's octave setup
// so all three maps share the same underlying relief.
function _fbmHeight(x, y) {
  let v = 0, amp = 0.55, freq = 0.04;
  for (let oct = 0; oct < 4; oct++) {
    v += amp * _valueNoise(x * freq, y * freq);
    amp *= 0.5; freq *= 2.0;
  }
  return v;
}

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
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = Math.max(0, Math.min(1, _fbmHeight(x, y) + 0.15));
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

// ============================================================
// NORMAL MAP — procedural tangent-space micro-relief. Builds the same
// fbm height field as the detail texture, runs a Sobel filter to derive
// surface gradients, and packs them as a tangent-space normal
// (RGB = normal.xyz mapped to [0,1]). Sampled triplanar in the same
// shader injection as the detail overlay, so it does not depend on mesh
// UVs (these world-space surfaces lack reliable UVs — see detail overlay
// rationale above). Generated lazily/once and shared.
// ============================================================
let _normalTex = null;
function _getNormalTexture() {
  if (_normalTex) return _normalTex;
  const SIZE = 256;
  const c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!c) return null;  // SSR / no DOM
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  // Precompute the height field once (tileable wrap via modulo so the
  // Sobel kernel reads neighbours across the seam without a discontinuity).
  const h = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      h[y * SIZE + x] = _fbmHeight(x, y);
    }
  }
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  // Strength of the height->slope conversion. Larger = steeper apparent
  // relief in the packed normal; the runtime normalScale still gates the
  // final influence, so keep this moderate to leave headroom.
  const STR = 2.0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Sobel gradient.
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l  = at(x - 1, y),                       r  = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const gy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      // Tangent-space normal: -gradient in XY, Z up.
      let nx = -gx * STR;
      let ny = -gy * STR;
      let nz = 1.0;
      const inv = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * SIZE + x) * 4;
      img.data[i]   = ((nx * 0.5 + 0.5) * 255) | 0;
      img.data[i+1] = ((ny * 0.5 + 0.5) * 255) | 0;
      img.data[i+2] = ((nz * 0.5 + 0.5) * 255) | 0;
      img.data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;  // normals are not color data
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  _normalTex = tex;
  return tex;
}

// ============================================================
// ROUGHNESS MAP — procedural single-channel variation. A smooth low-freq
// base (broad worn/clean zones) with sparse high-frequency scratch/wear
// patches punched in via a thresholded high-octave noise. Stored grayscale
// (R channel sampled in shader). Generated lazily/once and shared.
// ============================================================
let _roughTex = null;
function _getRoughnessTexture() {
  if (_roughTex) return _roughTex;
  const SIZE = 256;
  const c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!c) return null;  // SSR / no DOM
  c.width = SIZE; c.height = SIZE;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Smooth base — low frequency, gentle swing around mid.
      const base = _valueNoise(x * 0.025, y * 0.025);
      let v = 0.45 + base * 0.35;  // ~[0.45, 0.80]
      // Sparse high-frequency wear: a high-octave noise thresholded so
      // only the upper tail shows, producing scattered scratch patches
      // that drive roughness up locally (matte scuffing).
      const hi = _valueNoise(x * 0.45 + 100, y * 0.45 + 100);
      if (hi > 0.72) {
        v += (hi - 0.72) * 2.2;  // lift toward fully-rough scratches
      }
      v = Math.max(0, Math.min(1, v));
      const g = (v * 255) | 0;
      const i = (y * SIZE + x) * 4;
      img.data[i] = g; img.data[i+1] = g; img.data[i+2] = g; img.data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;  // roughness is linear data
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  _roughTex = tex;
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
function _attachDetailOverlay(material, opts = {}) {
  if (!material || material._detailAttached) return material;
  if (!material.isMeshStandardMaterial) return material; // PBR only
  const detail = _getDetailTexture();
  if (!detail) return material;
  // Per-material opt-outs. The maps are otherwise shared singletons.
  const wantNormal = !opts.skipNormal;
  const wantRough  = !opts.skipRoughness;
  const normalTex = wantNormal ? _getNormalTexture() : null;
  const roughTex  = wantRough ? _getRoughnessTexture() : null;
  material._detailAttached = true;
  // Persist a reference so the tuner can find these. Three.js shares
  // uniforms between actions but onBeforeCompile binds to the per-
  // material scope — we keep an outer object so live edits flow in.
  material.userData = material.userData || {};
  material.userData.detail = {
    strength: DETAIL_TUNE.strength,
    scale: DETAIL_TUNE.scale,
    enabled: DETAIL_TUNE.enabled ? 1 : 0,
    // Map influence is gated by both the global enable AND whether this
    // material attached the map at all (opt-out → forced 0).
    normalScale: normalTex ? DETAIL_TUNE.normalScale : 0,
    normalEnabled: (normalTex && DETAIL_TUNE.normalEnabled) ? 1 : 0,
    roughAmount: roughTex ? DETAIL_TUNE.roughnessAmount : 0,
    roughEnabled: (roughTex && DETAIL_TUNE.roughnessEnabled) ? 1 : 0,
  };
  // Record which maps this material has so refreshDetailOverlay() does
  // not re-enable a map a caller explicitly opted out of.
  material.userData._detailHasNormal = !!normalTex;
  material.userData._detailHasRough  = !!roughTex;
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
    shader.uniforms.uNormalMapTex   = { value: normalTex || detail };
    shader.uniforms.uNormalScaleD   = { value: ud.normalScale };
    shader.uniforms.uNormalEnabled  = { value: ud.normalEnabled };
    shader.uniforms.uRoughMapTex    = { value: roughTex || detail };
    shader.uniforms.uRoughAmount    = { value: ud.roughAmount };
    shader.uniforms.uRoughEnabled   = { value: ud.roughEnabled };
    material.userData._detailUniforms = {
      strength: shader.uniforms.uDetailStrength,
      scale:    shader.uniforms.uDetailScale,
      enabled:  shader.uniforms.uDetailEnabled,
      normalScale: shader.uniforms.uNormalScaleD,
      normalEnabled: shader.uniforms.uNormalEnabled,
      roughAmount: shader.uniforms.uRoughAmount,
      roughEnabled: shader.uniforms.uRoughEnabled,
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
        uniform sampler2D uNormalMapTex;
        uniform float uNormalScaleD;
        uniform float uNormalEnabled;
        uniform sampler2D uRoughMapTex;
        uniform float uRoughAmount;
        uniform float uRoughEnabled;
        varying vec3 vDetailWorldPos;
        varying vec3 vDetailWorldNormal;
        // Triplanar blend weights from the world normal — shared by the
        // detail / normal / roughness samplers below.
        vec3 ceTriWeights() {
          vec3 nAbs = abs(vDetailWorldNormal);
          float wSum = nAbs.x + nAbs.y + nAbs.z + 1e-5;
          return nAbs / wSum;
        }
      `)
      // Roughness modulation. Injected after the engine sets
      // roughnessFactor so we modulate the final value. Triplanar sample
      // of the procedural roughness map; lerp from the base toward the
      // map value by uRoughAmount.
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        if (uRoughEnabled > 0.5) {
          vec3 wR = ceTriWeights();
          float rxz = texture2D(uRoughMapTex, vDetailWorldPos.xz * uDetailScale).r;
          float ryz = texture2D(uRoughMapTex, vDetailWorldPos.yz * uDetailScale).r;
          float rxy = texture2D(uRoughMapTex, vDetailWorldPos.xy * uDetailScale).r;
          float rMap = rxz * wR.y + ryz * wR.x + rxy * wR.z;
          roughnessFactor = mix(roughnessFactor, rMap, clamp(uRoughAmount, 0.0, 1.0));
        }
      `)
      // Normal perturbation. Injected after the engine computes the
      // (possibly mapped) shading normal. We build a tangent-space
      // detail normal from the procedural map (triplanar), then perturb
      // the world-space 'normal' along the surface tangent basis. Kept
      // subtle (uNormalScaleD ~0.4) to preserve the cel-shaded banding.
      .replace('#include <normal_fragment_maps>', `
        #include <normal_fragment_maps>
        if (uNormalEnabled > 0.5) {
          vec3 wN = ceTriWeights();
          // Sample tangent-space normals on each plane, unpack to [-1,1].
          vec3 nXZ = texture2D(uNormalMapTex, vDetailWorldPos.xz * uDetailScale).xyz * 2.0 - 1.0;
          vec3 nYZ = texture2D(uNormalMapTex, vDetailWorldPos.yz * uDetailScale).xyz * 2.0 - 1.0;
          vec3 nXY = texture2D(uNormalMapTex, vDetailWorldPos.xy * uDetailScale).xyz * 2.0 - 1.0;
          // Whiteout-style triplanar blend: route each plane's tangent
          // gradient onto the matching world axes, accumulate the
          // perturbation, keep the geometric normal as the base.
          vec3 gn = normalize(vDetailWorldNormal);
          vec3 perturb = vec3(0.0);
          perturb.zx += nXZ.xy * wN.y; // top/bottom faces -> X,Z
          perturb.zy += nYZ.xy * wN.x; // +/-X faces       -> Z,Y
          perturb.xy += nXY.xy * wN.z; // +/-Z faces       -> X,Y
          vec3 nDetail = normalize(gn + perturb * uNormalScaleD);
          normal = normalize(mix(normal, nDetail, clamp(uNormalScaleD, 0.0, 1.0)));
        }
      `)
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        if (uDetailEnabled > 0.5) {
          // Triplanar — sample on XZ (top/floor), YZ (X-walls), XY (Z-walls).
          // Blend by absolute world normal so each face uses the projection
          // that doesn't visibly stretch.
          vec3 nAbs = ceTriWeights();
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
    const hasN = m.userData._detailHasNormal;
    const hasR = m.userData._detailHasRough;
    const normalScale = hasN ? DETAIL_TUNE.normalScale : 0;
    const normalEnabled = (hasN && DETAIL_TUNE.normalEnabled) ? 1 : 0;
    const roughAmount = hasR ? DETAIL_TUNE.roughnessAmount : 0;
    const roughEnabled = (hasR && DETAIL_TUNE.roughnessEnabled) ? 1 : 0;
    m.userData.detail.strength = DETAIL_TUNE.strength;
    m.userData.detail.scale = DETAIL_TUNE.scale;
    m.userData.detail.enabled = DETAIL_TUNE.enabled ? 1 : 0;
    m.userData.detail.normalScale = normalScale;
    m.userData.detail.normalEnabled = normalEnabled;
    m.userData.detail.roughAmount = roughAmount;
    m.userData.detail.roughEnabled = roughEnabled;
    const u = m.userData._detailUniforms;
    if (u) {
      u.strength.value = DETAIL_TUNE.strength;
      u.scale.value = DETAIL_TUNE.scale;
      u.enabled.value = DETAIL_TUNE.enabled ? 1 : 0;
      if (u.normalScale)   u.normalScale.value = normalScale;
      if (u.normalEnabled) u.normalEnabled.value = normalEnabled;
      if (u.roughAmount)   u.roughAmount.value = roughAmount;
      if (u.roughEnabled)  u.roughEnabled.value = roughEnabled;
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
    // Procedural-map opt-outs change the attached shader maps, so they
    // must be in the key — an opted-out material must not collide with a
    // default (fully-mapped) one.
    opts.skipDetail ? 'nd' : '_',
    opts.skipNormal ? 'nn' : '_',
    opts.skipRoughness ? 'nr' : '_',
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
  if (opts.roughness != null) {
    // When the procedural roughness map is active (not opted out) it
    // mixes the base value toward the map (~[0.45,1.0+]). Nudge the base
    // down slightly so the map has headroom to add scuffing/wear without
    // pushing everything maximally rough. Clamp to keep it sane.
    const useRoughMap = !opts.skipDetail && !opts.skipRoughness;
    args.roughness = useRoughMap ? Math.max(0.05, opts.roughness - 0.08) : opts.roughness;
  }
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
  // flat). The normal + roughness micro-relief maps ride the same
  // shader injection and can be disabled independently via
  // opts.skipNormal / opts.skipRoughness. Toon / basic / lambert types
  // skip naturally.
  if (!opts.skipDetail) _attachDetailOverlay(m, opts);
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
