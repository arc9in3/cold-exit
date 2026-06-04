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
  // --- REAL CC0 PBR textures (Assets/textures/<surface>/) ---
  // When a material is assigned a surface type, real albedo/normal/rough
  // maps are streamed in (async) and sampled triplanar in the SAME shader
  // injection as the procedural overlay above. While a real surface is
  // active the procedural normal/rough are gated OFF for that material to
  // avoid double-applying relief (the real normal map already carries it);
  // the procedural detail multiply still rides along as fine wear variation.
  realTexEnabled: true,
  // World-space tiling: texture repeats per world meter. Walls are ~3m
  // tall; 0.4 → one full repeat per 2.5m, so brick/concrete reads at human
  // scale rather than as a giant single tile or tiny noise.
  realTexScale: 0.4,
  // Albedo is blended MULTIPLICATIVELY with the material base color so
  // per-material tinting + theme colors still read. 0 = ignore real albedo
  // (base color only), 1 = full real albedo modulation around mid-grey.
  realAlbedoStrength: 0.85,
  // Real normal influence. Kept subtle so micro-relief doesn't fight the
  // cel-shaded toon banding (standard materials only).
  realNormalScale: 0.5,
  // Real roughnessMap influence: lerp base roughness toward the real map.
  realRoughAmount: 0.7,
  anisotropy: 6,     // real-texture anisotropic filtering (4-8)
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

// ============================================================
// REAL CC0 PBR TEXTURE REGISTRY
//
// Seven surface sets live under Assets/textures/<type>/ as
// { albedo.jpg (sRGB), normal.jpg (OpenGL/+Y), rough.jpg (linear) },
// each 1024². They are loaded LAZILY (first material that needs a given
// surface triggers its load) and ASYNCHRONOUSLY — the game keeps
// rendering while they stream in. Each loaded THREE.Texture is cached
// ONCE in _surfaceRegistry and shared across every material that uses
// that surface (never per-material).
//
// Async safety: the textures start null. Materials bind a shared
// `uRealEnabled` flag uniform that stays 0 until ALL THREE maps for the
// surface have finished loading; the shader skips the (null) samplers
// while the flag is 0. When the set finishes we flip the flag to 1 on
// every material already using that surface and call needsUpdate(). The
// scene therefore renders the procedural-only look first, then upgrades
// in place — never black, never sampling a null sampler.
// ============================================================
const SURFACE_TYPES = ['concrete', 'metal', 'brick', 'tile', 'wood', 'fabric', 'paintedmetal'];
const _SURFACE_SET = new Set(SURFACE_TYPES);

// Registry entry shape:
//   { albedo, normal, rough, ready (bool), materials (Set of mats using it) }
const _surfaceRegistry = new Map();
let _texLoader = null;

function _applyTexCommon(tex, srgb) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.max(1, Math.min(8, DETAIL_TUNE.anisotropy || 6));
  return tex;
}

// Lazily kick off loading a surface set. Returns the registry entry
// (which may not be `ready` yet). SSR/no-DOM safe → returns null.
function _ensureSurface(type) {
  if (!_SURFACE_SET.has(type)) return null;
  if (typeof document === 'undefined') return null; // SSR / no DOM
  let entry = _surfaceRegistry.get(type);
  if (entry) return entry;
  entry = { albedo: null, normal: null, rough: null, ready: false, materials: new Set() };
  _surfaceRegistry.set(type, entry);
  if (!_texLoader) _texLoader = new THREE.TextureLoader();
  const base = `Assets/textures/${type}/`;
  let remaining = 3;
  const onOne = () => {
    remaining -= 1;
    if (remaining === 0) _onSurfaceReady(type, entry);
  };
  const onErr = (which) => () => {
    // A missing/failed map leaves the entry not-ready; materials keep the
    // procedural fallback. Log once so it's diagnosable but don't throw.
    if (typeof console !== 'undefined') console.warn(`[material_pool] failed to load ${base}${which}`);
    onOne();
  };
  entry.albedo = _texLoader.load(base + 'albedo.jpg', (t) => { _applyTexCommon(t, true);  t.needsUpdate = true; onOne(); }, undefined, onErr('albedo.jpg'));
  entry.normal = _texLoader.load(base + 'normal.jpg', (t) => { _applyTexCommon(t, false); t.needsUpdate = true; onOne(); }, undefined, onErr('normal.jpg'));
  entry.rough  = _texLoader.load(base + 'rough.jpg',  (t) => { _applyTexCommon(t, false); t.needsUpdate = true; onOne(); }, undefined, onErr('rough.jpg'));
  // TextureLoader returns the Texture object synchronously (image fills in
  // later), so set color space immediately too — the onLoad re-applies it
  // after the image is known, but binding before that is harmless.
  _applyTexCommon(entry.albedo, true);
  _applyTexCommon(entry.normal, false);
  _applyTexCommon(entry.rough, false);
  return entry;
}

// Called once all three maps of a surface finish loading. Bind the real
// textures into every material's shader uniforms and flip its enable flag.
function _onSurfaceReady(type, entry) {
  // Require all three to be present (non-null with an image). If a load
  // errored the texture exists but has no image; guard by checking image.
  const ok = entry.albedo && entry.normal && entry.rough &&
             entry.albedo.image && entry.normal.image && entry.rough.image;
  entry.ready = !!ok;
  if (!entry.ready) return;
  for (const m of entry.materials) _bindRealUniforms(m, entry);
}

// Push a ready surface's textures + enable flag into a single material's
// live shader uniforms (if its shader has compiled). Safe to call before
// the shader exists — the values are also read from userData at compile.
function _bindRealUniforms(m, entry) {
  if (!m || !m.userData) return;
  const r = m.userData.real;
  if (!r) return;
  r.albedo = entry.albedo;
  r.normal = entry.normal;
  r.rough = entry.rough;
  r.ready = 1;
  const u = m.userData._realUniforms;
  if (u) {
    if (u.albedo)  u.albedo.value  = entry.albedo;
    if (u.normal)  u.normal.value  = entry.normal;
    if (u.rough)   u.rough.value   = entry.rough;
    if (u.enabled) u.enabled.value = DETAIL_TUNE.realTexEnabled ? 1 : 0;
  }
  m.needsUpdate = true;
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
  // Real CC0 surface (may be null if none assigned / SSR / unknown type).
  // When a real surface is active we gate the PROCEDURAL normal + rough
  // maps OFF for this material — the real normal/rough carry the relief,
  // and double-applying would compound it. The procedural detail multiply
  // still rides along (fine per-material wear that the tiled photo lacks).
  const surfaceType = (opts._resolvedSurface && _SURFACE_SET.has(opts._resolvedSurface))
    ? opts._resolvedSurface : null;
  const realEntry = surfaceType ? _ensureSurface(surfaceType) : null;
  const hasReal = !!realEntry;
  // Per-material opt-outs. The maps are otherwise shared singletons.
  // Procedural normal/rough suppressed when a real surface drives them.
  const wantNormal = !opts.skipNormal && !hasReal;
  const wantRough  = !opts.skipRoughness && !hasReal;
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
  // Real-texture state. `ready` stays 0 until the surface set finishes
  // streaming; the shader skips the (null) real samplers while it's 0.
  material.userData._realSurface = surfaceType;
  material.userData.real = {
    albedo: (realEntry && realEntry.ready) ? realEntry.albedo : null,
    normal: (realEntry && realEntry.ready) ? realEntry.normal : null,
    rough:  (realEntry && realEntry.ready) ? realEntry.rough  : null,
    ready:  (realEntry && realEntry.ready) ? 1 : 0,
    scale: DETAIL_TUNE.realTexScale,
    albedoStrength: DETAIL_TUNE.realAlbedoStrength,
    normalScale: DETAIL_TUNE.realNormalScale,
    roughAmount: DETAIL_TUNE.realRoughAmount,
    enabled: DETAIL_TUNE.realTexEnabled ? 1 : 0,
  };
  // Subscribe this material to the surface set so it gets upgraded in
  // place when the async load completes.
  if (realEntry) realEntry.materials.add(material);
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
    // --- real CC0 PBR maps ---
    // Samplers are NEVER null: until the real set loads we bind the
    // procedural `detail` texture as a harmless placeholder and keep the
    // enable flag (uReal*Active) at 0 so the shader never reads them.
    const rd = material.userData.real;
    shader.uniforms.uRealAlbedo     = { value: rd.albedo || detail };
    shader.uniforms.uRealNormal     = { value: rd.normal || detail };
    shader.uniforms.uRealRough      = { value: rd.rough  || detail };
    shader.uniforms.uRealReady      = { value: rd.ready };           // 1 once loaded
    shader.uniforms.uRealEnabled    = { value: rd.enabled };         // global toggle
    shader.uniforms.uRealScale      = { value: rd.scale };
    shader.uniforms.uRealAlbedoStr  = { value: rd.albedoStrength };
    shader.uniforms.uRealNormalScale= { value: rd.normalScale };
    shader.uniforms.uRealRoughAmount= { value: rd.roughAmount };
    material.userData._realUniforms = {
      albedo:      shader.uniforms.uRealAlbedo,
      normal:      shader.uniforms.uRealNormal,
      rough:       shader.uniforms.uRealRough,
      ready:       shader.uniforms.uRealReady,
      enabled:     shader.uniforms.uRealEnabled,
      scale:       shader.uniforms.uRealScale,
      albedoStr:   shader.uniforms.uRealAlbedoStr,
      normalScale: shader.uniforms.uRealNormalScale,
      roughAmount: shader.uniforms.uRealRoughAmount,
    };
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
        // --- real CC0 PBR maps ---
        uniform sampler2D uRealAlbedo;
        uniform sampler2D uRealNormal;
        uniform sampler2D uRealRough;
        uniform float uRealReady;
        uniform float uRealEnabled;
        uniform float uRealScale;
        uniform float uRealAlbedoStr;
        uniform float uRealNormalScale;
        uniform float uRealRoughAmount;
        varying vec3 vDetailWorldPos;
        varying vec3 vDetailWorldNormal;
        // Triplanar blend weights from the world normal — shared by the
        // detail / normal / roughness samplers below.
        vec3 ceTriWeights() {
          vec3 nAbs = abs(vDetailWorldNormal);
          float wSum = nAbs.x + nAbs.y + nAbs.z + 1e-5;
          return nAbs / wSum;
        }
        // Gate: real maps only contribute when loaded AND globally enabled.
        bool ceRealActive() { return uRealReady > 0.5 && uRealEnabled > 0.5; }
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
        // Real roughnessMap (triplanar, world-scaled). Only when the real
        // set is loaded + enabled — otherwise the procedural path above
        // (which is itself gated off for real-surface materials) handles it.
        if (ceRealActive()) {
          vec3 wRR = ceTriWeights();
          float s = uRealScale;
          float rrxz = texture2D(uRealRough, vDetailWorldPos.xz * s).r;
          float rryz = texture2D(uRealRough, vDetailWorldPos.yz * s).r;
          float rrxy = texture2D(uRealRough, vDetailWorldPos.xy * s).r;
          float rrMap = rrxz * wRR.y + rryz * wRR.x + rrxy * wRR.z;
          roughnessFactor = mix(roughnessFactor, rrMap, clamp(uRealRoughAmount, 0.0, 1.0));
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
        // Real normal map (triplanar tangent-space blend, same whiteout
        // routing as the procedural path). Subtle by design so the photo
        // relief doesn't fight the cel-shaded toon banding.
        if (ceRealActive()) {
          vec3 wRN = ceTriWeights();
          float s = uRealScale;
          vec3 rnXZ = texture2D(uRealNormal, vDetailWorldPos.xz * s).xyz * 2.0 - 1.0;
          vec3 rnYZ = texture2D(uRealNormal, vDetailWorldPos.yz * s).xyz * 2.0 - 1.0;
          vec3 rnXY = texture2D(uRealNormal, vDetailWorldPos.xy * s).xyz * 2.0 - 1.0;
          vec3 rgn = normalize(vDetailWorldNormal);
          vec3 rPerturb = vec3(0.0);
          rPerturb.zx += rnXZ.xy * wRN.y; // top/bottom faces -> X,Z
          rPerturb.zy += rnYZ.xy * wRN.x; // +/-X faces       -> Z,Y
          rPerturb.xy += rnXY.xy * wRN.z; // +/-Z faces       -> X,Y
          vec3 rNDetail = normalize(rgn + rPerturb * uRealNormalScale);
          normal = normalize(mix(normal, rNDetail, clamp(uRealNormalScale, 0.0, 1.0)));
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
        // Real albedo — TINT, do not replace. Sampled triplanar, world
        // scaled, blended multiplicatively against the material base color
        // so per-material tint + theme colors still read. We normalize the
        // photo around its mid so a mid-grey texel leaves the base color
        // unchanged; lighter/darker texels lift/crush it. uRealAlbedoStr
        // fades the whole effect (0 = base color only).
        if (ceRealActive()) {
          vec3 wRA = ceTriWeights();
          float s = uRealScale;
          vec3 axz = texture2D(uRealAlbedo, vDetailWorldPos.xz * s).rgb;
          vec3 ayz = texture2D(uRealAlbedo, vDetailWorldPos.yz * s).rgb;
          vec3 axy = texture2D(uRealAlbedo, vDetailWorldPos.xy * s).rgb;
          vec3 albedo = axz * wRA.y + ayz * wRA.x + axy * wRA.z;
          // Multiply by 2x so a mid-grey (~0.5) photo is roughly neutral,
          // preserving the base/theme color while adding photographic
          // detail. Fade between neutral (vec3 1.0) and the texture by str.
          vec3 tint = mix(vec3(1.0), albedo * 2.0, clamp(uRealAlbedoStr, 0.0, 1.0));
          diffuseColor.rgb *= tint;
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
    // --- real-texture live tuning ---
    if (m.userData.real) {
      const r = m.userData.real;
      r.scale = DETAIL_TUNE.realTexScale;
      r.albedoStrength = DETAIL_TUNE.realAlbedoStrength;
      r.normalScale = DETAIL_TUNE.realNormalScale;
      r.roughAmount = DETAIL_TUNE.realRoughAmount;
      r.enabled = DETAIL_TUNE.realTexEnabled ? 1 : 0;
      const ru = m.userData._realUniforms;
      if (ru) {
        if (ru.scale)       ru.scale.value = r.scale;
        if (ru.albedoStr)   ru.albedoStr.value = r.albedoStrength;
        if (ru.normalScale) ru.normalScale.value = r.normalScale;
        if (ru.roughAmount) ru.roughAmount.value = r.roughAmount;
        if (ru.enabled)     ru.enabled.value = r.enabled;
      }
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
    // Real surface changes the attached maps → must be in the key so two
    // call sites differing only by surface don't collide on one material.
    opts._resolvedSurface || '_',
  ].join('|');
}

// ============================================================
// SURFACE AUTO-ASSIGN
//
// Resolve which real CC0 surface a material should use. Honors an explicit
// opts.surface, an opt-out, and otherwise applies a simple, documented
// heuristic from the material's existing params so the ~1000 existing call
// sites benefit WITHOUT edits.
//
// Heuristic (standard materials only — real maps are PBR-only):
//   - opts.skipSurface OR opts.surface === 'none'  → no real texture
//   - opts.surface is a known type                 → use it
//   - type !== 'standard' (toon/basic/lambert)     → no real texture
//   - opts.skipDetail (flat/emissive/glass)        → no real texture
//   - metalness >= 0.5                             → 'metal'
//   - everything else (walls, floors, props)       → 'concrete'
//
// Returns a known surface string, or null for "no real texture".
// ============================================================
function _resolveSurface(opts) {
  if (opts.skipSurface) return null;
  if (opts.surface === 'none') return null;
  if (opts.surface && _SURFACE_SET.has(opts.surface)) return opts.surface;
  if (opts.surface) return null; // unknown explicit string → opt out, don't guess
  // No explicit surface → auto-assign by heuristic.
  const t = opts.type || 'standard';
  if (t !== 'standard') return null;       // real maps are PBR-only
  if (opts.skipDetail) return null;         // flat/emissive/special → leave clean
  if ((opts.metalness ?? 0) >= 0.5) return 'metal';
  return 'concrete';                        // sensible default for walls/props
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
  // Resolve the real surface up-front (explicit or heuristic) and fold it
  // into the cache key. Stamped onto opts so _attachDetailOverlay sees the
  // resolved value rather than re-running the heuristic.
  if (opts._resolvedSurface === undefined) {
    opts = { ...opts, _resolvedSurface: _resolveSurface(opts) || '' };
  }
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
