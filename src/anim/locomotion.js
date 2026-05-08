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

// Resolve the base + layered clip pair for the active weapon class.
// Returns { baseClip, layeredClip } where:
//   • baseClip drives the FULL body. Rifle / SMG / shotgun / sniper /
//     LMG / two-handed all use the rifle-8way base. The Rifle suffix
//     path also performs the GASP-naming `_Pistol → _Rifle` swap so
//     gasp_lower_body's pistol-base clips become rifle-base for those
//     weapons.
//   • layeredClip drives the UPPER body only and is played alongside
//     baseClip. Used by pistol/revolver class — the lower body keeps
//     the tuned rifle-8way cadence (real game speed), while the upper
//     body holds the pistol grip and swings to match the gait. The
//     layered clip's lower-body tracks are stripped at load time so
//     it can't fight the base's stride. Returns null when no layer
//     is needed (rifle-class, default-class).
//
// REGRESSION: anim-pistol-base-replaces-stride — earlier passes had
// pistol-locomotion clips taking over the BASE slot, which gave a
// pistol-pack-authored stride speed that didn't match the game's
// tuned movement cadence. Layering on top of rifle keeps stride
// timing tied to runner_lower_body.json's speedRefs.
function _pickClipsForWeapon(state, wantSuffix, smCfg, isMoving, ads, crouched) {
  const base = state?.clip;
  // During MOVEMENT, force a layered upper-body idle clip so the upper
  // body holds idle/aim pose instead of inheriting the locomotion
  // clip's run-cycle arm swing. Reload / fire / hit-react / melee
  // overlays still take over this layered slot when triggered (those
  // are one-shots that fade in/out around the idle layer).
  let movementUpper = null;
  if (isMoving) {
    if (wantSuffix === 'OneHand_Pistol') {
      movementUpper = 'pistol-locomotion/pistol-idle';
    } else {
      // Rifle / Pistol-suffix (smg / flame / melee / default) all use
      // the rifle-8way idle-upper derivatives. Crouch + ADS pick the
      // matching variant so the gun reads correctly in posture.
      if (crouched && ads) movementUpper = 'rifle-8way/idle-crouching-aiming-upper';
      else if (crouched)   movementUpper = 'rifle-8way/idle-crouching-upper';
      else if (ads)        movementUpper = 'rifle-8way/idle-aiming-upper';
      else                 movementUpper = 'rifle-8way/idle-upper';
    }
  }
  if (wantSuffix === 'Rifle') {
    if (state?.adsClip) return { baseClip: state.adsClip, layeredClip: movementUpper };
    if (base && base.endsWith('_Pistol')) {
      const candidate = base.slice(0, -'_Pistol'.length) + '_Rifle';
      if (smCfg?._availableClips?.has(candidate)) return { baseClip: candidate, layeredClip: movementUpper };
    }
    return { baseClip: base, layeredClip: movementUpper };
  }
  if (wantSuffix === 'OneHand_Pistol') {
    // Idle states keep their authored oneHandClip (pistol-idle on
    // stand_idle / crouch_idle); movement uses pistol-idle too.
    return { baseClip: base, layeredClip: state?.oneHandClip || movementUpper };
  }
  return { baseClip: base, layeredClip: movementUpper };
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
    const { baseClip, layeredClip } = _pickClipsForWeapon(s, wantSuffix, smCfg, false, false, crouched);
    return { stateId: id, clip: baseClip, layeredClip, loop: s.loop !== false, speedRef: null,
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

  // Weapon-class clip resolution — picks base (full-body) and an
  // optional layered (upper-body) clip. See _pickClipsForWeapon for
  // the policy. Rifle-class swaps base; OneHand_Pistol keeps the
  // rifle base for tuned stride and adds a layered upper-body clip.
  const weaponClass = playerState?.equipped?.class;
  const wantSuffix = _clipSuffixForWeapon(weaponClass);
  const { baseClip, layeredClip } = _pickClipsForWeapon(s, wantSuffix, smCfg, true, ads, crouched);

  return {
    stateId: id,
    clip: baseClip,
    layeredClip,
    loop: s.loop !== false,
    speedRef: s.speedRef ?? null,
    sector,
    bucket: prefix,
    weaponClass,
  };
}
