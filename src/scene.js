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
  // player; this offset rides on top. On press, snaps to the cursor's
  // world delta from the player (camera "locks into" the click
  // point, capped at the weapon's drag budget). While held, cursor
  // SCREEN motion (NDC delta) accumulates onto the offset 1:1 in
  // world units — drag the cursor and the camera pans with it. Hard-
  // clamps at weaponPeek so the camera stops at the zoom edge. The
  // final lookAt lerps toward player+offset with an exp ease that
  // reads as a critically-damped spring.
  const _adsOffset = new THREE.Vector3();
  let _adsPrevNdcX = 0;
  let _adsPrevNdcY = 0;
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

    // ADS camera model — cursor leads, camera springs:
    //   1. Pivot is ALWAYS the player (`base`); ADS just rides an
    //      offset on top.
    //   2. On press (rising edge of adsEased), the offset SNAPS to
    //      the cursor's world delta from the player, hard-clamped to
    //      `weaponPeek`. The camera "locks into" the click point.
    //   3. While held, cursor SCREEN motion (NDC delta) accumulates
    //      onto the offset 1:1 in world units. Drag right by N px →
    //      offset gains N px worth of world →  camera pans right.
    //      No drift when the mouse is still: NDC delta is zero, the
    //      offset holds.
    //   4. The offset is hard-clamped to weaponPeek every frame —
    //      camera STOPS at the zoom edge. Pulling back unclamps.
    //   5. lookAt lerps toward player+offset with an exp ease (rate
    //      7.0) that reads as a critically-damped spring — moves
    //      with the cursor, no overshoot, settles in ~0.4s.
    //   6. Release bleeds the offset back to zero.
    const desired = _desiredScratch.copy(base);
    const ndc = opts.cursorNDC;
    if (adsEased > 0.01 && opts.aim && ndc) {
      if (!_adsHeld) {
        // PRESS — lock onto the cursor's world position. Cap at the
        // weapon's drag budget so a click at extreme distance still
        // parks the camera at the budget edge in that direction.
        _adsOffset.set(opts.aim.x - base.x, 0, opts.aim.z - base.z);
        _clampAdsOffsetToWeaponPeek(weaponPeek);
        _adsPrevNdcX = ndc.x;
        _adsPrevNdcY = ndc.y;
        _adsHeld = true;
      } else {
        // DRAG — convert NDC motion to world motion via the current
        // ortho frustum half-extents. NDC y points UP; iso forward
        // is roughly -Z, so +ndc.y → -Z world.
        const dNdcX = ndc.x - _adsPrevNdcX;
        const dNdcY = ndc.y - _adsPrevNdcY;
        _adsPrevNdcX = ndc.x;
        _adsPrevNdcY = ndc.y;
        const halfW = halfH * aspect;
        _adsOffset.x += dNdcX * halfW;
        _adsOffset.z += -dNdcY * halfH;
        _clampAdsOffsetToWeaponPeek(weaponPeek);
      }
      desired.x += _adsOffset.x * adsEased;
      desired.z += _adsOffset.z * adsEased;
    } else {
      // RELEASE — bleed offset back to zero so the next press starts
      // cleanly at the new click point.
      _adsHeld = false;
      _adsOffset.x *= 0.85;
      _adsOffset.z *= 0.85;
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

  function _clampAdsOffsetToWeaponPeek(maxMag) {
    const m = Math.sqrt(_adsOffset.x * _adsOffset.x + _adsOffset.z * _adsOffset.z);
    if (m > maxMag) {
      const k = maxMag / m;
      _adsOffset.x *= k;
      _adsOffset.z *= k;
    }
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
  return { scene, camera, updateCamera, resize, groundPlane,
    hemiLight: hemi, keyLight: key, fillLight: fill, rimLight: rim,
    gridHelper: grid };
}
