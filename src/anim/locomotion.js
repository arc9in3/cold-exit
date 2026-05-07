// ============================================================
// locomotion.js — Directional 8-way locomotion selector (Phase D)
// ============================================================
//
// Picks a clip for the LOWER body based on:
//   - speed magnitude     → bucket (idle / walk / run / sprint)
//   - movement direction  → 8-way sector relative to body facing
//   - crouched flag       → 'crouch_' prefix overrides walk/run
//
// The user wants a "backpedal when shooting and moving in opposite
// directions" — that's the BACK direction (180° from facing). The
// 8-way scheme gives F, FL, FR, B, BL, BR (and L, R if available)
// which automatically covers backpedal cases since velocity is
// computed in BODY-LOCAL space (= rotated by -bodyYaw).
//
// When the player is aiming forward (=bodyYaw faces +Z) but moving
// backward (velocity along -Z in world), the body-local velocity
// projects onto -Z → angle = 180° → state = 'walk_B' / 'run_B'. The
// upper body keeps facing the cursor via the IK pass.

const _DIRS_8 = ['F', 'FR', 'R', 'BR', 'B', 'BL', 'L', 'FL'];
// Sector centers in body-local angle (radians), where 0 = forward
// (along body's +Z when group.rotation.y == 0). 8 sectors of 45°.
const _DIR_ANGLES = [
  0,                  // F
  -Math.PI * 0.25,    // FR (right of forward)
  -Math.PI * 0.5,     // R
  -Math.PI * 0.75,    // BR
   Math.PI,           // B
   Math.PI * 0.75,    // BL
   Math.PI * 0.5,     // L
   Math.PI * 0.25,    // FL
];

// Pick the closest 8-way sector for a body-local angle. Returns one
// of 'F' / 'FR' / 'R' / 'BR' / 'B' / 'BL' / 'L' / 'FL'.
export function pickSector(bodyLocalAngle) {
  let best = 'F';
  let bestDelta = Infinity;
  for (let i = 0; i < _DIRS_8.length; i++) {
    let d = bodyLocalAngle - _DIR_ANGLES[i];
    while (d >  Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const a = Math.abs(d);
    if (a < bestDelta) { bestDelta = a; best = _DIRS_8[i]; }
  }
  return best;
}

// Compute body-local angle from a world-space velocity vector and
// the body's yaw. Returns 0..2π (0 = forward).
export function bodyLocalAngle(velocity, bodyYaw) {
  if (!velocity) return 0;
  // Body forward = (sin(yaw), 0, cos(yaw)) per Three.js Y-up convention.
  // In Cold Exit, the rig.group rotation.y rotates the character so
  // that local +Z faces forward. World velocity projected:
  //   localZ = vx * sin(yaw) + vz * cos(yaw)   (forward component)
  //   localX = vx * cos(yaw) - vz * sin(yaw)   (right component)
  const sy = Math.sin(bodyYaw);
  const cy = Math.cos(bodyYaw);
  const localZ = velocity.x * sy + velocity.z * cy;
  const localX = velocity.x * cy - velocity.z * sy;
  // atan2 with (right=+, forward) → 0 when forward, π when back.
  return Math.atan2(-localX, localZ);
}

// Pick the rifle / one-hand variant of a base clip given the active
// weapon class. Resolution order:
//   1. s.adsClip / s.oneHandClip — explicit per-state override (runner
//      pack JSON wires these directly because its base clips don't
//      end in '_Pistol' and the suffix-swap path can't construct a
//      valid candidate).
//   2. Suffix swap on '_Pistol' base clips (gasp_lower_body convention)
//      — replace trailing '_Pistol' with '_Rifle' / '_OneHand_Pistol'
//      and verify against _availableClips before committing.
//   3. Fall through to the original base clip.
//
// REGRESSION: anim-onehand-explicit-clip — the gating used to require
// the base clip to end in '_Pistol' even when an explicit oneHandClip
// was set, so runner_lower_body's pistol-walk / pistol-run mappings
// never engaged and the lower body fell back to rifle stride.
function _swapForWeaponClass(state, baseClip, wantSuffix, smCfg) {
  if (wantSuffix === 'Rifle') {
    if (state?.adsClip) return state.adsClip;
    if (baseClip.endsWith('_Pistol')) {
      const candidate = baseClip.slice(0, -'_Pistol'.length) + '_Rifle';
      if (smCfg?._availableClips?.has(candidate)) return candidate;
    }
    return baseClip;
  }
  if (wantSuffix === 'OneHand_Pistol') {
    if (state?.oneHandClip) return state.oneHandClip;
    if (baseClip.endsWith('_Pistol')) {
      const candidate = baseClip.slice(0, -'_Pistol'.length) + '_OneHand_Pistol';
      if (smCfg?._availableClips?.has(candidate)) return candidate;
    }
    return baseClip;
  }
  return baseClip;
}

// Map a weapon.class to a GASP clip-set suffix.
//   Rifle           → two-handed shouldered (rifle/shotgun/sniper/lmg)
//   OneHand_Pistol  → one-handed pistol grip (pistol/revolver)
//   Pistol          → two-handed low-ready (smg/flame/melee/default)
function _clipSuffixForWeapon(weaponClass) {
  switch (weaponClass) {
    // SMGs share Rifle clips for now — they're two-handed and the
    // shouldered Rifle pose reads better than the two-handed-low-ready
    // Pistol clip set. Author dedicated SMG clips later if needed.
    case 'rifle': case 'shotgun': case 'sniper': case 'lmg': case 'smg':
      return 'Rifle';
    case 'pistol': case 'revolver':
      return 'OneHand_Pistol';
    case 'flame':
    case 'melee': case undefined: case null:
    default:
      return 'Pistol';
  }
}

// Select the lower-body clip from a GASP-style state machine config
// + per-frame playerState/velocity/bodyYaw.
//
// Returns:
//   { stateId, clip, loop, speedRef, sector, bucket }
//
// Falls back to 'stand_idle' / 'crouch_idle' if no movement.
export function selectGaspLocomotion(smCfg, playerState, planarSpeed, velocity, bodyYaw) {
  if (!smCfg || !smCfg.states) return null;
  const T = smCfg.thresholds || {};
  const moving    = planarSpeed > (T.moving ?? 0.2);
  const crouched  = !!playerState?.crouched;

  if (!moving) {
    const id = crouched ? 'crouch_idle' : 'stand_idle';
    const s  = smCfg.states[id];
    if (!s) return null;
    // Apply weapon-class swap to idle just like the moving path —
    // rifle-class weapons should idle in shouldered Rifle pose,
    // pistol/revolver should idle in OneHand_Pistol stance, otherwise
    // the GASP _Pistol clip (two-handed low-ready) wins on upper-body
    // bones and overrides the layered pistol-locomotion/pistol-idle
    // (insertion order: layer was added before GASP clips → GASP wins).
    // REGRESSION: anim-pistol-idle — keep these two branches symmetric
    // with the moving path below or pistols idle in two-handed pose.
    const weaponClass = playerState?.equipped?.class;
    const wantSuffix = _clipSuffixForWeapon(weaponClass);
    const clipName = _swapForWeaponClass(s, s.clip, wantSuffix, smCfg);
    return { stateId: id, clip: clipName, loop: s.loop !== false, speedRef: null,
             sector: 'F', bucket: 'idle', weaponClass };
  }

  // Speed bucket.
  //   - Sprint: high speed, no ADS (sprint pose with a shouldered
  //     rifle reads jarring; gun whips around).
  //   - Run: mid speed, not ADS.
  //   - Walk: low speed OR any ADS speed.
  // ADS forces walk regardless of how fast the player is actually
  // moving. Real shooters slow you down under ADS, so the speed
  // numerically lands in walk anyway, but capping here means we
  // don't trigger the run/sprint clips at slow-motion timeScale
  // when the ADS speed sits just above walkMax. Without this clamp
  // a forward-ADS at ~2.0 m/s plays the run clip at ~0.57x speed.
  const ads = (playerState?.adsAmount || 0) > 0.5;
  let bucket;
  if      (ads)                                              bucket = 'walk';
  else if (planarSpeed <= (T.walkMax ?? 1.6))                bucket = 'walk';
  else if (planarSpeed <= (T.runMax ?? 3.5))                 bucket = 'run';
  else                                                       bucket = 'sprint';

  // Direction: project velocity into body-local frame, pick 8-way.
  const ang = bodyLocalAngle(velocity, bodyYaw || 0);
  let sector = pickSector(ang);

  // Crouch override: prefix 'crouch_' instead of bucket name. Also
  // collapse sprint→run since GASP doesn't ship crouch-sprint.
  let prefix = bucket;
  if (crouched) prefix = 'crouch';
  else if (bucket === 'sprint' && sector !== 'F') prefix = 'run';

  // L/R-only sectors aren't authored in our subset (GASP ships only
  // F/B + 4 diagonals). Collapse to forward-diagonal by default
  // (pure side strafe = no back component); fold to back-diagonal
  // only when ang clearly indicates back-of-side.
  if (sector === 'L') sector = ang >  Math.PI * 3 / 4 ? 'BL' : 'FL';
  if (sector === 'R') sector = ang < -Math.PI * 3 / 4 ? 'BR' : 'FR';

  const id = `${prefix}_${sector}`;
  let s = smCfg.states[id];
  if (!s) {
    // Fall back: try `walk_<sector>` if `run_<sector>` missing, etc.
    s = smCfg.states[`walk_${sector}`] || smCfg.states[`run_${sector}`] || smCfg.states[`${prefix}_F`] || smCfg.states['stand_idle'];
  }
  if (!s) return null;

  // Weapon-class swap — substitute the base clip with the rifle /
  // one-hand variant based on weapon class. Two paths:
  //   • explicit s.adsClip / s.oneHandClip wins (runner_lower_body
  //     wires these directly per state).
  //   • else: if the base clip name ends in '_Pistol' (gasp_lower_body
  //     naming), build candidate by suffix-swap and check
  //     _availableClips.
  const weaponClass = playerState?.equipped?.class;
  const wantSuffix = _clipSuffixForWeapon(weaponClass);
  const clipName = _swapForWeaponClass(s, s.clip, wantSuffix, smCfg);

  return {
    stateId: id,
    clip: clipName,
    loop: s.loop !== false,
    speedRef: s.speedRef ?? null,
    sector,
    bucket: prefix,
    weaponClass,
  };
}
