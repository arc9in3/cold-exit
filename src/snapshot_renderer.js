// Shared offscreen WebGLRenderer for one-shot snapshots.
//
// Three places in the UI used to instantiate their own WebGLRenderer
// for dataURL captures: item_thumbnails (per item), ui_shop keeperPortrait
// (per kind), and the no-longer-used preview path. Each spawn cost a
// fresh WebGL context that lingered until GC, eventually exhausting
// the browser's ~16-context cap on long sessions and killing the main
// renderer. Funnelling all snapshot work through this singleton means
// the game holds at most ONE offscreen context regardless of how many
// items / portraits the player inspects.
//
// API:
//   snapshotToDataURL(scene, camera, w, h, opts?) → 'data:image/png;...'
//
// Caller owns the scene + camera lifecycle. The renderer is shared,
// so callers must NOT keep references to it or modify its state
// outside of the snapshot call.

import * as THREE from 'three';

let _renderer = null;
let _ctxLost = false;

function _ensureRenderer() {
  if (_renderer && !_ctxLost) return _renderer;
  if (_renderer && _ctxLost) {
    // Recover from a lost context by reconstructing the renderer.
    try { _renderer.dispose(); } catch (_) {}
    _renderer = null;
    _ctxLost = false;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  _renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true, preserveDrawingBuffer: true,
  });
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Self-recovery — if the shared offscreen context dies (e.g. GPU
  // sleep), next snapshot call rebuilds it instead of returning blank
  // forever.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    _ctxLost = true;
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    _ctxLost = false;
  }, false);
  return _renderer;
}

export function snapshotToDataURL(scene, camera, width, height, opts = {}) {
  const r = _ensureRenderer();
  if (_ctxLost) return null;
  // Resize only if needed to avoid unnecessary buffer churn.
  if (r.domElement.width !== width || r.domElement.height !== height) {
    r.setSize(width, height, false);
  }
  const clearColor = opts.clearColor ?? 0x000000;
  const clearAlpha = opts.clearAlpha ?? 0;
  r.setClearColor(clearColor, clearAlpha);
  try {
    r.render(scene, camera);
    return r.domElement.toDataURL('image/png');
  } catch (_) {
    return null;
  }
}
