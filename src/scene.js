import * as THREE from 'three';
import { tunables } from './tunables.js';

export function createScene() {
  const scene = new THREE.Scene();
  // Very dark blue-black — same colour the fog fades to so distant
  // geometry blends into the background seamlessly. The reference
  // splash has no visible horizon line; this matches.
  scene.background = new THREE.Color(0x06080f);
  // Exponential fog hides distance much faster than linear — geometry
  // starts fading almost immediately and is effectively invisible
  // past ~25m, so rooms feel enclosed and atmospheric instead of the
  // whole map rendering at once. Density = 0.035 gives the "visible
  // haze" read around light pools without making close objects
  // foggy.
  // Fog + global lights are driven by `tunables.lighting` so the F3
  // export + console tweaks can retune the whole look without a
  // reload. Initial values come from the tunable defaults.
  const L = tunables.lighting;
  scene.fog = new THREE.FogExp2(L.fogColor, L.fogDensity);

  const halfH = tunables.camera.viewHeight / 2;
  const aspect = window.innerWidth / window.innerHeight;
  const camera = new THREE.OrthographicCamera(
    -halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 200,
  );

  const isoOffset = new THREE.Vector3(20, 16.5, 20);
  const lookAt = new THREE.Vector3();

  function resize() {
    const aspect = window.innerWidth / window.innerHeight;
    const halfH = tunables.camera.viewHeight / 2;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
  }

  // ADS camera offset (world units, X+Z plane). Pivot is always the
  // player; this offset rides on top. Two contributions:
  //   1. Press-time zoom compensation — when the frustum shrinks,
  //      the world point under the cursor would otherwise drift
  //      toward the lookAt center. We add a small lateral shift in
  //      the cursor's NDC direction so the world point under the
  //      cursor stays put as the zoom engages. Captured ONCE on
  //      press; doesn't change as the cursor moves afterward.
  //   2. Edge-pan accumulator — only when the cursor is in the
  //      OUTER band (NDC magnitude past EDGE_THRESHOLD) does the
  //      offset grow per-frame. Cursor in the inner deadzone moves
  //      freely without panning the camera. Hard-capped at
  //      weaponPeek (the equipped optic's reach budget).
  const _adsOffset = new THREE.Vector3();
  const _adsPressComp = new THREE.Vector3();
  let _adsHeld = false;
  // Scratch reused for the per-frame `desired` target — was a
  // `base.clone()` allocation every camera tick.
  const _desiredScratch = new THREE.Vector3();

  function updateCamera(dt, opts = {}) {
    const adsAmt = opts.adsAmount ?? 0;
    const weaponPeek = opts.adsPeekDistance ?? 5;
    // ADS frustum push-in driven by the equipped sight. sightZoom is
    // the multiplier on apparent size (iron 1.05, red dot 1.10, holo
    // 1.15, mid scope 1.20, long scope 1.30). Frustum shrinks to
    // 1/sightZoom so 1.20× zoom = 0.833× frustum height. Drag
    // distance (weaponPeek) is decoupled — better sights also bump
    // the peek budget so you can pan further.
    const sightZoom = opts.sightZoom ?? 1.05;
    const adsFrustumShrink = 1 / sightZoom;
    const adsEased = adsAmt * adsAmt * (3 - 2 * adsAmt);
    const base = opts.target || new THREE.Vector3();
    const zoomK = THREE.MathUtils.lerp(1, adsFrustumShrink, adsEased);
    const halfH = (tunables.camera.viewHeight * zoomK) / 2;
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();

    // ADS camera model — deadzone + edge pan:
    //   1. Pivot is ALWAYS the player (`base`).
    //   2. PRESS — engage the sight-driven frustum push-in (handled
    //      above). Compute a small lateral offset that compensates
    //      for the zoom-in so the world point under the cursor
    //      doesn't drift toward screen center as the zoom engages.
    //      Cursor's screen position doesn't move; cursor's world
    //      point doesn't move; the camera shifts under both.
    //   3. HOLD + cursor in the inner deadzone (|NDC| ≤ EDGE_THRESHOLD)
    //      — no edge-pan growth. Cursor moves freely; camera holds
    //      steady. The user can sweep the crosshair around the
    //      target without yanking the view.
    //   4. HOLD + cursor in the OUTER band (|NDC| > EDGE_THRESHOLD)
    //      — accumulate offset velocity in that direction, scaled by
    //      how far past the threshold (smoothstep). Pan at PAN_SPEED
    //      m/sec at full edge; a sniper budget (35m) takes ~1s to
    //      traverse.
    //   5. Offset is hard-capped at weaponPeek. Camera stops at the
    //      zoom limit; pulling cursor back into deadzone holds in
    //      place.
    //   6. RELEASE — bleed offset + compensation back to zero.
    const desired = _desiredScratch.copy(base);
    const ndc = opts.cursorNDC;
    if (adsEased > 0.01 && ndc) {
      if (!_adsHeld) {
        // Press-time compensation. Zoom shrinks the half-extents
        // from baseHalfH to baseHalfH/sightZoom. The cursor at
        // NDC.x maps to lookAt + NDC.x * halfWidth in world. To
        // keep that world point fixed across the zoom transition,
        // the camera must shift by NDC * (oldHalf − newHalfAtFull).
        const baseHalfH = tunables.camera.viewHeight / 2;
        const baseHalfW = baseHalfH * aspect;
        const fullHalfH = baseHalfH * adsFrustumShrink;
        const fullHalfW = fullHalfH * aspect;
        _adsPressComp.x =  ndc.x * (baseHalfW - fullHalfW);
        _adsPressComp.z = -ndc.y * (baseHalfH - fullHalfH);
        _adsOffset.copy(_adsPressComp);
        _adsHeld = true;
      } else {
        // Edge-pan accumulator. Inner EDGE_THRESHOLD is the
        // deadzone — cursor moves freely there with no camera
        // response. Past that, smoothstep ramps the pan velocity.
        const EDGE_THRESHOLD = 0.6;
        const computeAxis = (v) => {
          const a = Math.abs(v);
          if (a <= EDGE_THRESHOLD) return 0;
          const t = Math.min(1, (a - EDGE_THRESHOLD) / (1 - EDGE_THRESHOLD));
          // Quadratic in-curve so the band starts gently and ramps.
          return Math.sign(v) * t * t;
        };
        const ex = computeAxis(ndc.x);
        const ey = computeAxis(ndc.y);
        // PAN_SPEED = m/sec at full edge. Scaled to weaponPeek so
        // bigger optics traverse their bigger budget at roughly the
        // same wall-clock pace (~1s edge-to-cap).
        const PAN_SPEED = weaponPeek;
        _adsOffset.x += ex * PAN_SPEED * dt;
        _adsOffset.z += -ey * PAN_SPEED * dt;
        // Hard cap on total offset magnitude — camera stops dead at
        // the zoom edge. Pull cursor back in to drift back below.
        const m = Math.sqrt(_adsOffset.x * _adsOffset.x + _adsOffset.z * _adsOffset.z);
        if (m > weaponPeek) {
          const k = weaponPeek / m;
          _adsOffset.x *= k;
          _adsOffset.z *= k;
        }
      }
      desired.x += _adsOffset.x * adsEased;
      desired.z += _adsOffset.z * adsEased;
    } else {
      // RELEASE — bleed offset back to zero.
      _adsHeld = false;
      _adsOffset.x *= 0.85;
      _adsOffset.z *= 0.85;
      _adsPressComp.set(0, 0, 0);
    }

    // Spring lerp toward player+offset. Higher rate = snappier
    // chase; 7.0 settles in roughly 0.4s with no overshoot.
    const ADS_SPRING_RATE = 7.0;
    const adsLerpRate = adsEased > 0.01 ? ADS_SPRING_RATE : tunables.camera.followLerp;
    const k = 1 - Math.exp(-adsLerpRate * dt);
    lookAt.lerp(desired, k);

    camera.position.copy(lookAt).add(isoOffset);
    camera.lookAt(lookAt);
  }

  // Cold-Exit palette: unlit surfaces fall to near-black. Global fill
  // lights are dialled WAY down so SpotLights (streetlamp cones in the
  // world) do the heavy lifting — walls only light up where a real
  // source falls on them, corridors between lights drop into cool
  // darkness, and the player silhouettes against fog-lit backgrounds.
  // Previous values had a 0.70-intensity key directional that was
  // effectively an outdoor sun, which washed the whole map evenly
  // and killed contrast.
  const hemi = new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemiIntensity);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(L.keyColor, L.keyIntensity);
  key.position.set(30, 40, 20);
  key.castShadow = true;
  // Shadow map dropped 1024² → 512² (4× fewer pixels rendered per
  // shadow pass). Combined with the corpse + wall castShadow flips
  // below, the shadow render pass cost is roughly 25% of what it
  // was. Visual loss at iso angle is minor — soft-PCF filtering
  // hides the resolution drop on low-frequency wall shadows.
  key.shadow.mapSize.set(512, 512);
  const s = 40;
  key.shadow.camera.left = -s;
  key.shadow.camera.right = s;
  key.shadow.camera.top = s;
  key.shadow.camera.bottom = -s;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 140;
  key.shadow.bias = -0.0005;
  scene.add(key);

  // Fill keeps shadow side from blocking into the fog as an
  // indistinct blob, but stays cool so it doesn't fight the warm
  // SpotLights visually.
  const fill = new THREE.DirectionalLight(L.fillColor, L.fillIntensity);
  fill.position.set(-20, 15, -25);
  scene.add(fill);

  // Rim stays — it's THE thing that carves characters out against the
  // dark ground in the reference image.
  const rim = new THREE.DirectionalLight(L.rimColor, L.rimIntensity);
  rim.position.set(-10, 22, 35);
  scene.add(rim);

  // Floor catches warm SpotLight as a wet-concrete streak. Lowered
  // roughness and a touch of metalness give lamp pools a visible
  // specular falloff across the ground — sells the neon-noir look
  // far more than any single lighting change.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({
      color: 0x0a0c12,
      roughness: 0.6,
      metalness: 0.35,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(300, 150, 0x1a1c24, 0x0e1014);
  grid.position.y = 0.01;
  scene.add(grid);

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // `ground` exposed so the level can re-tint the floor per theme on
  // each regen (per-level visual theming, see LEVEL_THEMES in props.js).
  return { scene, camera, updateCamera, resize, groundPlane,
    hemiLight: hemi, keyLight: key, fillLight: fill, rimLight: rim,
    gridHelper: grid, ground, gridLines: grid };
}
