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
function _pickClipsForWeapon(state, wantSuffix, smCfg, crouched, ads) {
  const base = state?.clip;
  // Always-on upper-body layered clip — keeps the arms in their idle
  // pose regardless of locomotion (run / walk / sprint / crouch). The
  // movement clips have their upper-body tracks stripped at boot so
  // this layered is the sole writer for upper bones during movement;
  // during stand_idle the base clip ALSO writes upper but the mixer
  // weighted-blends the two same-pose contributions to the same pose.
  // One-shot overlays (reload / fire / hit-react / melee swings) take
  // over this slot via `_layeredLockUntil` in player.js.
  let alwaysUpper;
  if (wantSuffix === 'OneHand_Pistol') {
    alwaysUpper = 'pistol-locomotion/pistol-idle';
  } else if (wantSuffix === 'Rifle') {
    // Rifle / SMG / shotgun / sniper / LMG — eye-line aim pose.
    if (crouched) alwaysUpper = 'rifle-8way/idle-crouching-aiming-upper';
    else          alwaysUpper = 'rifle-8way/idle-aiming-upper';
  } else {
    // Pistol-suffix bucket — melee / flame / default. Low-ready idle.
    if (crouched) alwaysUpper = 'rifle-8way/idle-crouching-upper';
    else          alwaysUpper = 'rifle-8way/idle-upper';
  }
  if (wantSuffix === 'Rifle') {
    if (state?.adsClip) return { baseClip: state.adsClip, layeredClip: alwaysUpper };
    if (base && base.endsWith('_Pistol')) {
      const candidate = base.slice(0, -'_Pistol'.length) + '_Rifle';
      if (smCfg?._availableClips?.has(candidate)) return { baseClip: candidate, layeredClip: alwaysUpper };
    }
    return { baseClip: base, layeredClip: alwaysUpper };
  }
  return { baseClip: base, layeredClip: alwaysUpper };
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

  const adsIdle = (playerState?.adsAmount || 0) > 0.5;
  if (!moving) {
    const id = crouched ? 'crouch_idle' : 'stand_idle';
    const s  = smCfg.states[id];
    if (!s) return null;
    const weaponClass = playerState?.equipped?.class;
    const wantSuffix = _clipSuffixForWeapon(weaponClass);
    const { baseClip, layeredClip } = _pickClipsForWeapon(s, wantSuffix, smCfg, crouched, adsIdle);
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
  const { baseClip, layeredClip } = _pickClipsForWeapon(s, wantSuffix, smCfg, crouched, ads);

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
