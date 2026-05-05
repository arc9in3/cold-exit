// windows.js — Pass 1C breakable-window prop kind. A window replaces
// a section of an exterior wall with a glass pane that:
//   - Stops bullets initially (WINDOW_HP hits to break)
//   - Shatters on damage, becomes a permanent walk-through opening
//   - Walkable as a sill once shattered (low sill = vault, high sill
//     = peek-only — see isWindowWalkable)
//
// IMPORTANT: this file owns window construction + damage state.
// level.js wires windows in along exterior walls; projectiles.js +
// main.js inspect userData.kind === 'window' to route bullets.
//
// All meshes are stamped with userData.kind = 'window' and
// userData.windowState pointing at the live state object so
// projectile + collision queries can find the same record from
// either the visual or the collision proxy.

import * as THREE from 'three';

// Hits to break a window. Tuned low so single-shot weapons can
// shatter in 1-2 rounds (sniper one-shots; pistol two-shots). Buffed
// later if playtesting wants tankier panes.
export const WINDOW_HP = 2;

const FRAME_COLOR = 0x3a3a44;
const GLASS_COLOR = 0x8ec5d8;
const FRAME_THICK = 0.18;       // mullion / sill thickness
const GLASS_THICK = 0.12;       // visible glass slab depth (matches WALL_THICK / 10)

// Build a window. Returns {group, collision, kind, breakable, state}.
// width / height are the visible aperture; sillHeight is how far up
// the sill sits from the floor (defaults to 1.0m so the window reads
// as chest-high — vaultable). Pass sillHeight=0 for floor-to-ceiling
// glass walls (skybridge tunnel panels).
//
// Both the group and the collision proxy carry userData.kind = 'window'
// so projectile / collision code can pick them out without walking
// the group's children.
export function buildWindow({ width = 4, height = 2.4, sillHeight = 1.0 } = {}) {
  const group = new THREE.Group();

  // Frame — sill (bottom) + lintel (top) + 2 mullions (sides).
  // Each frame piece is a small box; together they form a window
  // shape around the central glass pane.
  const frameMat = new THREE.MeshStandardMaterial({
    color: FRAME_COLOR, roughness: 0.7,
  });

  // Sill (bottom rail) — sits at sillHeight, full width, thick enough
  // to stand on once the glass is broken (low-sill vault).
  if (sillHeight > 0) {
    const sill = new THREE.Mesh(
      new THREE.BoxGeometry(width + FRAME_THICK * 2, FRAME_THICK, GLASS_THICK + FRAME_THICK),
      frameMat,
    );
    sill.position.set(0, sillHeight - FRAME_THICK / 2, 0);
    sill.castShadow = false;
    sill.receiveShadow = true;
    group.add(sill);
  }
  // Lintel (top)
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(width + FRAME_THICK * 2, FRAME_THICK, GLASS_THICK + FRAME_THICK),
    frameMat,
  );
  lintel.position.set(0, sillHeight + height + FRAME_THICK / 2, 0);
  lintel.castShadow = false;
  lintel.receiveShadow = true;
  group.add(lintel);
  // Left mullion
  const mLeft = new THREE.Mesh(
    new THREE.BoxGeometry(FRAME_THICK, height, GLASS_THICK + FRAME_THICK),
    frameMat,
  );
  mLeft.position.set(-(width / 2 + FRAME_THICK / 2), sillHeight + height / 2, 0);
  mLeft.castShadow = false;
  mLeft.receiveShadow = true;
  group.add(mLeft);
  // Right mullion
  const mRight = new THREE.Mesh(
    new THREE.BoxGeometry(FRAME_THICK, height, GLASS_THICK + FRAME_THICK),
    frameMat,
  );
  mRight.position.set(width / 2 + FRAME_THICK / 2, sillHeight + height / 2, 0);
  mRight.castShadow = false;
  mRight.receiveShadow = true;
  group.add(mRight);

  // Glass pane — translucent slab that the player can see through.
  // Stamped with userData.kind = 'window' so the projectile system's
  // window-damage branch picks it up from a raw raycast hit.
  const glassMat = new THREE.MeshStandardMaterial({
    color: GLASS_COLOR,
    roughness: 0.05,
    metalness: 0.0,
    transparent: true,
    opacity: 0.30,
    depthWrite: false,
  });
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, GLASS_THICK),
    glassMat,
  );
  glass.position.set(0, sillHeight + height / 2, 0);
  glass.castShadow = false;
  glass.receiveShadow = false;
  group.add(glass);

  // State record — shared between the visible mesh + the collision
  // proxy so both surfaces converge after damage. hp counts down on
  // applyWindowDamage; broken flips at 0.
  const state = {
    hp: WINDOW_HP,
    broken: false,
    sillHeight,
    width,
    height,
    glassMesh: glass,
    framePieces: group.children.filter(c => c !== glass),
    group,
    collisionProxy: null,    // set by buildWindow caller after wiring
  };

  // Stamp identifiers on the group + glass mesh. The collision proxy
  // is built by the caller (level.js) so its position is in world
  // coords; we attach state via userData.windowState there too.
  group.userData.kind = 'window';
  group.userData.windowState = state;
  glass.userData.kind = 'window';
  glass.userData.windowState = state;
  glass.userData.isWindowGlass = true;

  // Collision spec — passed back so the caller can build a proxy
  // matching the wall segment this window replaces. Width/height of
  // the collision = the full window aperture (frame is thin enough
  // that we treat the whole window as one solid slab pre-shatter).
  const collision = {
    w: width + FRAME_THICK * 2,
    h: height + FRAME_THICK * 2,
    d: GLASS_THICK + FRAME_THICK,
    sillHeight,
  };

  return {
    group,
    collision,
    kind: 'window',
    breakable: true,
    state,
  };
}

// Apply damage to a window. Decrements hp, spawns a small impact
// burst, and (at 0) calls shatter(). dmg defaults to 1 hit; weapons
// with a heavyHit flag could pass 2+ to shatter in one round.
export function applyWindowDamage(windowState, dmg = 1, hitPoint = null) {
  if (!windowState || windowState.broken) return false;
  windowState.hp -= dmg;
  // Optional cosmetic crack — a thin line decal on the pane. Skipped
  // for now (would need texture + shader work); HP visual is implicit
  // (1 hit = wobble, 2 hits = shatter).
  // Wobble the glass slightly on each hit so the player gets feedback.
  const g = windowState.glassMesh;
  if (g) {
    const orig = g.userData._wobbleOrigY;
    if (orig === undefined) {
      g.userData._wobbleOrigY = g.position.y;
    }
    // Wobble wears off the next frame the renderer touches the mesh;
    // keep it minimal so we don't perma-displace the glass.
    g.position.y = (orig ?? g.position.y) + (Math.random() - 0.5) * 0.04;
  }
  if (windowState.hp <= 0) {
    shatter(windowState);
    return true;
  }
  return false;
}

// Shatter — remove the glass pane (visually) + null the collision
// proxy so bullets + bodies can pass through. Frame stays as ragged
// edge. Idempotent.
export function shatter(windowState) {
  if (!windowState || windowState.broken) return;
  windowState.broken = true;
  const g = windowState.glassMesh;
  if (g) {
    if (g.parent) g.parent.remove(g);
    g.geometry?.dispose?.();
    g.material?.dispose?.();
    windowState.glassMesh = null;
  }
  // Flip collision proxy to walk-through. The level.js wrapper that
  // wires the proxy stamps `windowState.collisionProxy = proxy` so we
  // can null its collisionXZ here.
  const proxy = windowState.collisionProxy;
  if (proxy) {
    proxy.userData.collisionXZ = null;
    proxy.visible = false;
    // Stamp a flag so any downstream LOS / sealing pass that looks
    // for "broken windows" can skip them.
    proxy.userData.windowBroken = true;
  }
  // Tag the group too so downstream queries can read state directly.
  windowState.group.userData.windowBroken = true;
}

// Is the window walkable? Returns:
//   - false        : intact, can't pass
//   - true         : broken AND sill ≤ 1.0m → step / vault through
//   - 'vault-only' : broken AND sill > 1.0m → must mantle (Pass 1C.4)
export function isWindowWalkable(windowState) {
  if (!windowState || !windowState.broken) return false;
  if (windowState.sillHeight <= 1.0) return true;
  return 'vault-only';
}
