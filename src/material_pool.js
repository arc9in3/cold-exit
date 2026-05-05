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
// Three material types supported. Default to 'standard' which matches
// the renderer's PBR pipeline used by walls / props elsewhere:
//   - 'standard' — MeshStandardMaterial (PBR, lit). Default.
//   - 'basic'    — MeshBasicMaterial (unlit). Use for emissive things
//                  (lamps, glass, signage) where lighting would dim them.
//   - 'lambert'  — MeshLambertMaterial (cheap diffuse). Reserved for
//                  call sites that explicitly want it.

import * as THREE from 'three';

const _pool = new Map();

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
  _pool.set(k, m);
  return m;
}

// Public — pool stats for the perf probe. Returns { size, byType }.
export function poolStats() {
  const byType = { standard: 0, basic: 0, lambert: 0 };
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
