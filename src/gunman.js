import * as THREE from 'three';
import { tunables } from './tunables.js';
import { buildRig, initAnim, updateAnim, pokeHit, pokeRecoil, pokeDeath } from './actor_rig.js';
import { spawnSpeechBubble } from './hud.js';
import { loadModelClone, fitToRadius } from './gltf_cache.js';
import { modelForItem, shouldMirrorInHand,
         rotationOverrideForModelPath, scaleForModelPath,
         gripOffsetForModelPath } from './model_manifest.js';
import { buildMeleePrimitive } from './melee_primitives.js';
import { swapInBakedCorpse } from './corpse_bake.js';
import { rigInstancer } from './rig_instancer.js';

// Strip the held weapon meshes off a dead enemy — detach the primitive
// gun box, the FBX weaponModel group, and the muzzle anchor from the
// rig so the renderer stops walking them. Cuts the per-corpse draw
// calls down to just the body silhouette, which compounds on dense
// late-game rooms with several downed enemies.
//
// References are intentionally left intact (g.gun, g.muzzle still
// resolve) so any defensive code path that still touches them after
// death doesn't crash on a null. Geometry / materials aren't disposed
// either — level regen drops the gunman array and the meshes get GC'd
// in one batch, which is cheaper than disposing per-node here. Safe to
// call multiple times via the _weaponStripped guard.
function _stripDeadEnemyWeapon(g) {
  if (!g || g._weaponStripped) return;
  g._weaponStripped = true;
  const meshes = g._heldWeaponMeshes;
  if (!meshes) return;
  for (const m of meshes) {
    if (m && m.parent) m.parent.remove(m);
  }
}

// Module-level scratch vectors. The gunman update loop runs once per
// alive enemy per frame and previously allocated 5+ Vector3 instances
// per call (eye, target, toPlayer, dir2d, fwd, etc.). With 10-20
// gunmen alive on late-game floors that's hundreds of throwaway
// vectors per second going to GC. Reusing module-scope scratches
// removes that pressure entirely. Safe because none of these escape
// the function scope they're used in.
const _g_eye         = new THREE.Vector3();
const _g_target      = new THREE.Vector3();
const _g_toPlayer    = new THREE.Vector3();
const _g_dir2d       = new THREE.Vector3();
const _g_fwd         = new THREE.Vector3();
// Scratch reused for the per-frame approach-direction copy in chase
// — was `dir2d.clone()`, allocating one Vector3 per active gunman per
// frame. The vector is consumed within the same iteration of the
// gunman loop, so reuse is safe.
const _g_approachDir = new THREE.Vector3();
// Fire-path scratches — gunmen shoot every ~0.4s with up to 7 pellets
// per fire, each previously allocating a fresh Vector3. Reuse one
// instance per role across the per-volley loop. The onFireAt callback
// reads them synchronously so reuse is safe.
const _g_muzzle      = new THREE.Vector3();
const _g_aim         = new THREE.Vector3();
const _g_shotDir     = new THREE.Vector3();
const _g_jittered    = new THREE.Vector3();
// Speech-bubble head position scratch — separate from _g_eye so a
// bubble call later in the tick doesn't clobber an eye write earlier.
const _g_head        = new THREE.Vector3();
// Muzzle world-position scratch for the AI fire LoS pre-check.
// Distinct from _g_muzzle (used inside the actual fire path) because
// the LoS pre-check happens in the same tick before the fire branch.
const _g_muzzleTest  = new THREE.Vector3();
// Aim-test scratch for the LoS pre-check — paired with _g_muzzleTest.
const _g_aimTest     = new THREE.Vector3();

// NOTE: Skinned-rig path has been removed from the live code — we're
// committing to the primitive rig as the shipping art style. The
// tooling (`tools/rebind_hanging.py`, `tools/retarget_character.md`)
// and the bridge module (`src/character_model.js`) remain in the
// tree for reference if we ever revive the pipeline with a proper
// retargeter, but none of that runs in-game anymore.

// Idle-chatter phrases rolled on a per-enemy cooldown. Kept short
// enough to read at a glance; mixed terse + narrative for flavor.
const CHATTER_LINES = [
  'All quiet.', 'Stay sharp.', 'You hear that?', 'Just the wind.',
  'Shift change yet?', 'I need a smoke.', 'Anyone on radio?',
  '*coughs*', 'Boss says keep eyes up.', 'Hate this detail.',
  'Thought I saw something.', "This place gives me the creeps.",
  'Relax, rookie.', 'Another long one.', '...', "Can't wait to clock out.",
];

// Ranged AI with simple flanking. Two roles: 'rusher' (approaches straight
// along the line to the player) and 'flanker' (approaches while maintaining
// an angular offset). Aim is intentionally worse than the player's — weapon
// spread multiplied by `tunables.ai.spreadMultiplier`.
const STATE = { IDLE: 'idle', ALERTED: 'alerted', FIRING: 'firing', DEAD: 'dead', SLEEP: 'sleep' };

// Per-variant profile overlay. `standard` is baseline; others tweak stats and
// enable/disable behaviors (burst settle, dash, cover reposition).
// Variants that get the doorway-choke awareness — the smart / fast
// archetypes that should know not to dance in the kill zone. Standard
// grunts + tanks + shielded keep their existing chase behaviour.
const TUCK_VARIANTS = new Set(['dasher', 'runner', 'coverSeeker', 'sniper']);
// 50 lines of "wait out the player" flavour. Used by both the
// far-corner tuck (after taking cross-doorway hits) and the
// side-of-door suppression hold (when player camping is detected).
// Mostly grim, occasionally cheeky to match the John-Wick-via-CRPG
// tone the rest of the chatter uses.
const TUCK_BARKS = [
  'I can wait all day!',
  'You come to me!',
  'Taking cover.',
  "I'm not coming out there.",
  'Hold this corner.',
  'Try peeking again, hero.',
  "I've got time.",
  'You poke your head out, you lose it.',
  "I'm holding this room. You pay rent or you leave.",
  'Bring lunch next time.',
  "I've got a chair. You bring the orange juice.",
  'Camping is two-player.',
  'Smart move, kid. Now what?',
  "I'll be here. Take your time.",
  'You blink first.',
  "Doorway's cute. Real defensive.",
  'Step in. I dare you.',
  'My grandma had better aim.',
  "I'm not the one in a hurry.",
  "Come over here and say it again.",
  'Sit down. Stay a while.',
  "I can hear you breathing.",
  "Shoot all you want. Walls are free.",
  "The wall and I are best friends now.",
  "I'm not falling for that.",
  "Nice try.",
  "Plenty of ammo. You?",
  "Run out yet?",
  "I'm comfortable.",
  "Got nowhere to be.",
  "Make me come out there.",
  "You first.",
  "Tag, you're sitting.",
  "Bored already?",
  "Got a sandwich. You hungry?",
  "I'll be here when you give up.",
  "Watch the door. Or don't.",
  "I see your boots, you know.",
  "Wave the white flag whenever.",
  "Polishing my barrel. Unrelated.",
  "You stay there. I'll stay here. Beautiful.",
  "Patience is a weapon too.",
  "Half a magazine left and a coffee.",
  "You come in, you leave in pieces.",
  "Nothing personal. Just doors.",
  "Time's on my side.",
  "I've got a clock. You have one?",
  "Counting your shots.",
  "Cover's a good investment.",
  "I'll be right here. Forever, if needed.",
];

const VARIANT_PROFILES = {
  standard: {
    scale: 1.0, hp: 1.0, dmg: 1.0,
    moveSpeedMult: 1.0, preferredRange: null, rangeTolerance: null,
    reactionMult: 1.0, settlePause: true,
    strafe: false, dash: false, coverSeek: false,
    tint: null,
  },
  tank: {
    // Broad and stout — tall enough to read as "big" but not so tall that
    // shots fly over a crouched player. scaleY is deliberately modest.
    scale: 1.6, scaleY: 0.95, hp: 3.0, dmg: 1.4,
    moveSpeedMult: 0.55, preferredRange: 7, rangeTolerance: 1.5,
    reactionMult: 1.2, settlePause: false,
    strafe: false, dash: false, coverSeek: false,
    tint: 0x3a241a,
  },
  dasher: {
    scale: 0.9, hp: 0.55, dmg: 0.9,
    moveSpeedMult: 1.85, preferredRange: 15, rangeTolerance: 4,
    reactionMult: 0.4, settlePause: false,
    strafe: true, dash: true, coverSeek: false,
    tint: 0x1f3a4a,
  },
  coverSeeker: {
    scale: 1.0, hp: 1.0, dmg: 1.0,
    moveSpeedMult: 1.1, preferredRange: 13, rangeTolerance: 3,
    reactionMult: 0.8, settlePause: true,
    strafe: false, dash: false, coverSeek: true,
    tint: 0x2a3a22,
  },
  // Runner — close cousin of the dasher at human-normal mobility.
  // Normal run speed + the dash burst, aggressive strafe, zero settle
  // pause so they commit to mag-dump bursts instead of trickling shots.
  // Pairs best with auto weapons (SMG, rifle, LMG) where the sustained
  // fire reads as an aggressive player-mirror.
  runner: {
    scale: 1.0, hp: 0.95, dmg: 0.95,
    moveSpeedMult: 1.0, preferredRange: 11, rangeTolerance: 3.5,
    reactionMult: 0.55, settlePause: false,
    strafe: true, dash: true, coverSeek: false,
    tint: 0x3a1e4a,
  },
  shieldedPistol: {
    // Partial shield reduces frontal damage until broken. Fills the role of
    // a tanky pistol rusher who closes while eating chip damage.
    scale: 1.1, hp: 1.8, dmg: 0.9,
    moveSpeedMult: 1.15, preferredRange: 6, rangeTolerance: 2,
    reactionMult: 0.7, settlePause: false,
    strafe: false, dash: false, coverSeek: false,
    tint: 0x6a5a3a,
    shield: 'partial',
  },
  sniper: {
    // Long-distance laser-paint specialist. Sees the player at any
    // range LoS allows, paints them with a tracking laser for
    // ~1.6s, then fires a non-hitscan slow projectile that the
    // player can dodge with a roll. Backs up if the player closes.
    // Frail on purpose — the counter is "close the distance fast."
    scale: 1.0, hp: 0.7, dmg: 1.0,
    moveSpeedMult: 0.9, preferredRange: 22, rangeTolerance: 6,
    reactionMult: 0.6, settlePause: true,
    strafe: false, dash: false, coverSeek: true,
    tint: 0x554020,
    sniper: true,
  },
};

export class GunmanManager {
  constructor(scene) {
    this.scene = scene;
    this.gunmen = [];
    this._normalBodyColor = new THREE.Color(0x3a2530);
    this._normalHeadColor = new THREE.Color(0x2a1820);
    this._hurt = new THREE.Color(0xff4a4a);
  }

  _pickWeapon() {
    const ws = tunables.weapons;
    return ws[Math.floor(Math.random() * ws.length)];
  }

  // Force a gunman into the disarmed state — used by the tutorial
  // tick to guarantee the disarm lesson completes after 2 arm hits.
  // Mirrors the natural disarm path inside applyHit so visual +
  // behavioural side-effects stay consistent.
  forceDisarm(g) {
    if (!g || g.disarmed || !g.weapon) return;
    g.disarmed = true;
    if (g.rightArmGroup) g.rightArmGroup.visible = false;
    else if (g.rightArm) g.rightArm.visible = false;
    if (g.gun) g.gun.visible = false;
    const _ri = rigInstancer && rigInstancer();
    if (_ri && g.rig?.rightArmMeshes) {
      _ri.hideMeshes(g.rig.rightArmMeshes, true);
    }
    g.weapon = null;
    g.burstLeft = 0;
    g.fireT = 0.8;
  }

  // Attach a front shield. `opts.full` = true for the impenetrable
  // riot-shield melee variant; otherwise it's the partial pistol-
  // rusher tactical shield.
  //
  // The single hit-target Mesh (`g.shield.mesh`) is a flat plate at
  // the shield centre — `combat.raycast` is non-recursive, so only
  // this mesh registers shield hits. All decorative bits (rim trim,
  // viewport window, banding, rivets, rear handle) are siblings on
  // the same group; they read visually but don't catch bullets,
  // which keeps the hitbox honest (player still aims at the central
  // plate area, not the trim).
  _attachShield(g, opts = {}) {
    const full = !!opts.full;
    const w = full ? 1.4 : 1.1;
    const h = full ? 2.0 : 1.3;
    const z = 0.75;                 // forward offset from gunman center
    const yMid = full ? 1.15 : 1.2;
    const baseColor = full ? 0x33547a : 0x6a5a3a;
    const trimColor = full ? 0x1a2a3a : 0x2a200f;
    const accentColor = full ? 0xe8e8ee : 0x9a824a;

    const root = new THREE.Group();
    root.position.set(0, 0, 0);
    g.group.add(root);

    // 1) Main plate — curved cylinder wedge so the riot shield reads
    //    as a real ballistic panel instead of a "massive square". The
    //    arc covers ~0.7 rad (~40°) which matches the melee
    //    shield-bearer's curve. Forward face sits at z + arcRadius *
    //    sin(arcSpan/2). Hit target stays this single mesh.
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor, roughness: 0.55, metalness: 0.35,
      emissive: full ? 0x0a1420 : 0x14100a,
      side: THREE.DoubleSide,
    });
    const arcRadius = full ? 0.95 : 0.85;
    const arcSpan = full ? 0.75 : 0.65;
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(arcRadius, arcRadius, h, 22, 1, true,
        -arcSpan / 2, arcSpan),
      mat,
    );
    // Push the cylinder back so its forward arc face sits at +z.
    plate.position.set(0, yMid, z - arcRadius);
    plate.castShadow = true;
    plate.userData = { zone: 'shield', owner: g };
    root.add(plate);

    // 2) Edge trim — four thin strips around the plate perimeter.
    //    Visually frames the shield as armour rather than a flat slab.
    const trimMat = new THREE.MeshStandardMaterial({
      color: trimColor, roughness: 0.45, metalness: 0.55,
    });
    const trimT = 0.04;
    const trimZ = z + 0.055;
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, trimT, 0.04), trimMat);
    top.position.set(0, yMid + h / 2, trimZ);
    const bot = top.clone();
    bot.position.set(0, yMid - h / 2, trimZ);
    const left = new THREE.Mesh(new THREE.BoxGeometry(trimT, h + 0.04, 0.04), trimMat);
    left.position.set(-w / 2, yMid, trimZ);
    const right = left.clone();
    right.position.set(w / 2, yMid, trimZ);
    root.add(top, bot, left, right);

    // 3) Variant-specific surface details.
    if (full) {
      // Riot shield: tinted viewport window in the upper third + a
      // single diagonal high-contrast stripe + rivets at the corners
      // + a vertical centre rib.
      const viewport = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.55, h * 0.18, 0.02),
        new THREE.MeshStandardMaterial({
          color: 0x0a1018, roughness: 0.2, metalness: 0.6,
          transparent: true, opacity: 0.55,
          emissive: 0x102030, emissiveIntensity: 0.4,
        }),
      );
      viewport.position.set(0, yMid + h * 0.28, trimZ + 0.005);
      root.add(viewport);
      // Diagonal stripe — single white slash for police readability.
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.05, 0.10, 0.025),
        new THREE.MeshStandardMaterial({
          color: accentColor, roughness: 0.7, metalness: 0.05,
        }),
      );
      stripe.position.set(0, yMid - h * 0.10, trimZ + 0.01);
      stripe.rotation.z = Math.PI * 0.10;
      root.add(stripe);
      // Vertical centre rib — adds a 3D-looking spine.
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, h * 0.96, 0.05),
        trimMat,
      );
      rib.position.set(0, yMid, trimZ + 0.01);
      root.add(rib);
      // Corner rivets — small dark hemispheres.
      const rivetGeom = new THREE.SphereGeometry(0.035, 6, 4);
      const rivetMat = new THREE.MeshStandardMaterial({
        color: 0x101418, roughness: 0.4, metalness: 0.7,
      });
      const corners = [
        [-w / 2 + 0.08,  h / 2 - 0.08],
        [ w / 2 - 0.08,  h / 2 - 0.08],
        [-w / 2 + 0.08, -h / 2 + 0.08],
        [ w / 2 - 0.08, -h / 2 + 0.08],
      ];
      for (const [cx, cy] of corners) {
        const r = new THREE.Mesh(rivetGeom, rivetMat);
        r.position.set(cx, yMid + cy, trimZ + 0.02);
        root.add(r);
      }
    } else {
      // Partial tactical shield: smaller, no viewport. A circular
      // boss reinforcement at centre + two horizontal bands sell
      // the "improvised plate carrier shield" look.
      const boss = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.20, 0.06, 12),
        new THREE.MeshStandardMaterial({
          color: trimColor, roughness: 0.45, metalness: 0.55,
        }),
      );
      boss.rotation.x = Math.PI / 2;
      boss.position.set(0, yMid, trimZ + 0.02);
      root.add(boss);
      // Two horizontal bands (top + bottom thirds).
      const bandGeom = new THREE.BoxGeometry(w * 0.95, 0.08, 0.04);
      const bandMat = new THREE.MeshStandardMaterial({
        color: trimColor, roughness: 0.55, metalness: 0.4,
      });
      const bandTop = new THREE.Mesh(bandGeom, bandMat);
      bandTop.position.set(0, yMid + h * 0.27, trimZ);
      const bandBot = new THREE.Mesh(bandGeom, bandMat);
      bandBot.position.set(0, yMid - h * 0.27, trimZ);
      root.add(bandTop, bandBot);
    }

    // 4) Rear handle — short horizontal grip behind the plate so the
    //    shield reads as held, not floating. Positioned BEHIND the
    //    plate (z slightly less than the plate's z).
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.30, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }),
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, yMid, z - 0.08);
    root.add(handle);

    g.shield = {
      mesh: plate,
      decorRoot: root,
      hp: full ? 220 : 80,
      maxHp: full ? 220 : 80,
      fullBlock: full,
    };
  }
  _disableShield(g) {
    if (!g.shield) return;
    if (g.shield.decorRoot) {
      g.group.remove(g.shield.decorRoot);
      g.shield.decorRoot.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
    } else if (g.shield.mesh) {
      g.group.remove(g.shield.mesh);
      g.shield.mesh.geometry.dispose();
      g.shield.mesh.material.dispose();
    }
    g.shield = null;
  }

  spawn(x, z, weapon, opts = {}) {
    const tier = opts.tier || 'normal';
    const roomId = opts.roomId ?? -1;
    const difficultyHp = opts.hpMult || 1;
    const baseDamageMult = opts.damageMult || 1;
    const levelReactionMult = opts.reactionMult ?? 1;
    const levelAimSpreadMult = opts.aimSpreadMult ?? 1;
    const aggression = opts.aggression ?? 1;
    const variantId = opts.variant && VARIANT_PROFILES[opts.variant] ? opts.variant : 'standard';
    // Clone the variant profile so we can overlay boss-tier tactical
    // traits (strafe + coverSeek) without mutating the shared
    // VARIANT_PROFILES entry for other enemies.
    const baseProfile = VARIANT_PROFILES[variantId];
    const profile = { ...baseProfile };
    if (tier === 'boss') {
      // Bosses always strafe while firing and reposition between
      // bursts so they feel like they're hunting, not lane-fighting.
      profile.strafe = true;
      profile.coverSeek = true;
      // Tighter settle — firing pauses shorter so there's always
      // pressure, but they still pause to "think" between bursts.
      profile.reactionMult = Math.min(profile.reactionMult ?? 1, 0.7);
    }
    if (tier === 'subBoss') {
      profile.coverSeek = true;   // mini-bosses weave in and out of cover
    }
    // Apply the per-level reaction tightening on top of variant /
    // tier overrides. Bosses already had the 0.7 cap; we floor at
    // 0.35 so even L20 enemies still have a perceptible reaction.
    profile.reactionMult = Math.max(0.35, (profile.reactionMult ?? 1) * levelReactionMult);
    // Per-enemy aim sharpening — read at fire time alongside the
    // global ai.spreadMultiplier.
    profile.aimSpreadMult = levelAimSpreadMult;

    const tierHp = (tier === 'boss' ? 3.2 : tier === 'subBoss' ? 1.8 : 1);
    const hpMult = tierHp * profile.hp * difficultyHp;
    const damageMult = baseDamageMult * profile.dmg;
    // Tier sizing was ballooning into "giant-robot" territory because
    // tier×variant compounded (tank=1.6 × boss=1.35 ≈ 2.2×). Clamp the
    // combined size so bosses read as "noticeably bigger" without
    // looking comedic.
    const tierScale = tier === 'boss' ? 1.18 : (tier === 'subBoss' ? 1.08 : 1);
    const MAX_SCALE = 1.45;
    const scaleXZ = Math.min(MAX_SCALE, tierScale * profile.scale);
    const scaleY  = Math.min(MAX_SCALE, tierScale * (profile.scaleY ?? profile.scale));

    const baseBodyHex = profile.tint ?? this._normalBodyColor.getHex();
    const baseHeadHex = profile.tint ? (profile.tint & 0x555555) : this._normalHeadColor.getHex();
    const bodyHex = tier === 'boss' ? 0x5a1a1a : (tier === 'subBoss' ? 0x3a1e58 : baseBodyHex);
    const headHex = tier === 'boss' ? 0x3a0f10 : (tier === 'subBoss' ? 0x22103e : baseHeadHex);
    // Per-tier gear accent — bosses get bronze kit, sub-bosses red,
    // variants pick up their profile tint. Makes tier readable at a
    // glance via the chest-plate / pauldrons / knee-pads alone.
    const gearHex = tier === 'boss' ? 0x7a5020
                  : tier === 'subBoss' ? 0x6a1e2a
                  : (profile.tint ? ((profile.tint & 0xf8f8f8) >> 1) : 0x2a2a30);

    // Jointed rig (shared actor_rig). The rig's root group is what we
    // position/scale; all hit-zone meshes already carry userData.zone
    // tags. We grab named parts below so the existing code paths
    // (hit-flash lerp, disarm visibility, weapon attach) keep working.
    const rigOpts = {
      scale: 0.77,          // ~1.85m baseline; outer scaleXZ/scaleY drives actor size
      bodyColor: bodyHex,
      headColor: headHex,
      legColor: 0x231418,
      armColor: bodyHex,
      handColor: 0x2a1f1a,
      gearColor: gearHex,
      bootColor: 0x0e0a08,
    };
    const rig = buildRig(rigOpts);
    initAnim(rig);
    const group = rig.group;
    group.position.set(x, 0, z);
    group.scale.set(scaleXZ, scaleY, scaleXZ);

    const leftLeg  = rig.leftLeg.thigh.mesh;
    const rightLeg = rig.rightLeg.thigh.mesh;
    const torso    = rig.chestMesh;
    const head     = rig.headMesh;
    const leftArm  = rig.leftArm.shoulder.mesh;
    const rightArm = rig.rightArm.shoulder.mesh;
    const { bodyMat, headMat, legMat } = rig.materials;

    // Visible gear — simple primitive helmet / chest plate cues parented
    // to the rig's head / chest so they track the animation pose.
    // Skipped for skinned rigs: the customization kit provides its own
    // clothing, and the primitive gear cues are sized for the primitive
    // 1.85m body so they'd float around the skinned model.
    const gearLevel = opts.gearLevel ?? 0;
    // Helmet + chest plate cues sized for the slimmer cylindrical
    // rig. Helmet is a half-sphere sitting just above the head
    // sphere; chest plate mirrors the rig's own chestPlate bounds.
    if (tier === 'boss' || Math.random() < 0.35 + gearLevel * 0.08) {
      const helmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
        new THREE.MeshStandardMaterial({
          color: tier === 'boss' ? 0x6a1a1a : 0x3f4a54,
          roughness: 0.55, metalness: 0.3,
        }),
      );
      helmet.position.y = 0.18;
      helmet.castShadow = true;
      rig.head.add(helmet);
    }
    if (tier === 'boss' || variantId === 'tank' || Math.random() < 0.28 + gearLevel * 0.08) {
      // Curved heavy plate sitting OVER the rig's default chestPlate —
      // open-ended cylinder arc centred on the front, slightly larger
      // radius than the chest so it stands proud. Matches the new
      // tapered cylindrical torso instead of a flat slab.
      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.32, 0.28,       // match chest taper + stand-off
          0.4,
          14, 1,
          true,
          -Math.PI / 2.4,   // -75°, centred on +Z front
          Math.PI / 1.2,    // 150° arc
        ),
        new THREE.MeshStandardMaterial({
          color: tier === 'boss' ? 0x7a2222 : 0x3a4a5c,
          roughness: 0.6, metalness: 0.35,
          side: THREE.DoubleSide,
        }),
      );
      plate.position.set(0, 0.24, 0);
      plate.scale.z = 0.72;         // match rig's torsoDepthRatio
      plate.castShadow = true;
      rig.chest.add(plate);
    }

    const chosen = weapon || this._pickWeapon();
    const gunMat = new THREE.MeshStandardMaterial({
      color: 0x111111, roughness: 0.45, metalness: 0.6,
      emissive: new THREE.Color(chosen.tracerColor).multiplyScalar(0.15),
    });
    // Weapon attachment — mirrors player.js setWeapon. Long guns
    // (rifle / shotgun / lmg / sniper) mount at the dominant shoulder
    // anchor with the stock at the shoulder and the barrel extending
    // +Z forward. Pistols / SMGs / flame stay at the wrist.
    const ws = rig.scale || 1.0;
    const cls = chosen.class;
    const isShouldered = cls === 'rifle' || cls === 'shotgun'
      || cls === 'lmg' || cls === 'sniper';
    const handPivot = isShouldered ? rig.rightShoulderAnchor : rig.rightArm.wrist;

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(chosen.muzzleGirth, chosen.muzzleGirth, chosen.muzzleLength),
      gunMat,
    );
    gun.scale.setScalar(ws);
    gun.castShadow = true;
    const muzzle = new THREE.Object3D();

    if (isShouldered) {
      gun.rotation.set(0, 0, 0);
      gun.position.set(0, 0, (0.1 + chosen.muzzleLength / 2) * ws);
      muzzle.position.set(0, 0, (0.1 + chosen.muzzleLength) * ws);
    } else {
      gun.rotation.set(Math.PI / 2, 0, 0);
      gun.position.set(0, -(0.1 + chosen.muzzleLength / 2) * ws, 0);
      muzzle.position.set(0, -(0.1 + chosen.muzzleLength) * ws, 0);
    }
    handPivot.add(gun);
    handPivot.add(muzzle);

    // FBX model for the enemy's equipped weapon — same load pipeline
    // as the player. Replaces the placeholder box once ready; failed
    // loads keep the primitive forever.
    const weaponModel = new THREE.Group();
    weaponModel.scale.setScalar(ws);
    if (isShouldered) weaponModel.rotation.set(0, 0, 0);
    else              weaponModel.rotation.set(Math.PI / 2, 0, 0);
    weaponModel.position.copy(gun.position);
    weaponModel.visible = false;
    handPivot.add(weaponModel);
    if (chosen.type === 'melee') {
      // Same procedural-primitive path as the player — see player.js
      // setWeapon for the rationale (FBX melee meshes don't seat
      // cleanly in the hand). Built along +Z, container takes care
      // of the π/2 rotation to align with the hand's forward axis.
      const prim = buildMeleePrimitive(chosen);
      weaponModel.add(prim);
      weaponModel.visible = true;
      gun.visible = false;
    } else {
      const modelUrl = modelForItem(chosen);
      if (modelUrl) {
        loadModelClone(modelUrl).then((clone) => {
          if (!clone) return;
          const CLASS_SCALE = {
            pistol: 0.45, smg: 0.65, rifle: 0.75, shotgun: 0.75,
            lmg: 0.75, flame: 0.7, melee: 0.7, sniper: 0.75,
          };
          const cs = CLASS_SCALE[chosen.class] ?? 0.7;
          // Mirror the player's setWeapon FBX-prep pipeline
          // (player.js ~360+): pack-scale on the fit radius,
          // rotation-override > tunable rotation > default,
          // mirror flag for lowpolyguns, and grip offset. Without
          // these, lowpoly weapons (AK, Spectre, SPC*) showed up
          // backwards in enemy hands.
          fitToRadius(clone, chosen.muzzleLength * cs * scaleForModelPath(modelUrl));
          const r = chosen.modelRotation;
          const rotOverride = rotationOverrideForModelPath(modelUrl);
          if (rotOverride) {
            clone.rotation.set(rotOverride.x || 0, rotOverride.y || 0, rotOverride.z || 0);
          } else if (r) {
            clone.rotation.set(r.x || 0, r.y || 0, r.z || 0);
          } else {
            clone.rotation.set(0, Math.PI / 2, 0);
          }
          if (shouldMirrorInHand(chosen)) clone.scale.x = -clone.scale.x;
          clone.position.set(0, 0, 0);
          const gripOff = gripOffsetForModelPath(modelUrl);
          if (gripOff) clone.position.set(gripOff.x || 0, gripOff.y || 0, gripOff.z || 0);
          weaponModel.add(clone);
          weaponModel.visible = true;
          gun.visible = false;
        }).catch(() => {});
      }
    }

    const alertMat = new THREE.MeshBasicMaterial({
      color: 0xff3030, transparent: true, opacity: 0, depthTest: false,
    });
    const alert = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 8), alertMat);
    alert.position.y = 2.45;
    alert.rotation.x = Math.PI;
    alert.renderOrder = 2;
    group.add(alert);

    // Sniper-only laser paint mesh — a long thin red box scaled down
    // the aim ray each frame while charging the shot. Hidden until
    // the sniper is in 'paint' phase.
    let snipLaser = null;
    if (profile.sniper) {
      const laserMat = new THREE.MeshBasicMaterial({
        color: 0xff2030, transparent: true, opacity: 0, depthWrite: false,
      });
      snipLaser = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1), laserMat);
      snipLaser.visible = false;
      snipLaser.renderOrder = 3;
      this.scene.add(snipLaser);   // world-space, not parented to body
    }

    this.scene.add(group);

    const role = Math.random() < tunables.ai.flankChance ? 'flanker' : 'rusher';
    // Flankers pick a signed angular offset so some circle left, some right.
    const flankAngle = role === 'flanker'
      ? (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 180) * (45 + Math.random() * 35)
      : 0;

    const g = {
      group, leftLeg, rightLeg, torso, head, leftArm, rightArm, gun, muzzle,
      alert, alertMat, bodyMat, headMat, legMat,
      // Held weapon meshes — referenced for the on-death strip pass
      // that pulls them off the rig to drop draw-call count once the
      // body is just a corpse. The actual loot drop comes from
      // enemy.loot (built in main.onEnemyKilled), independent of
      // these visual meshes.
      _heldWeaponMeshes: [gun, muzzle, weaponModel],
      rig,
      rightArmGroup: rig.rightArm.shoulder.pivot,
      weapon: chosen,
      disarmed: false,
      tier,
      roomId,
      damageMult,
      variant: variantId,
      profile,
      // Bosses (tier === 'boss') roam — they leave their arena to
      // hunt the player. Aggression scales fire frequency / pursuit
      // speed; ramps with level via opts.aggression.
      huntsPlayer: tier === 'boss',
      aggression,
      snipLaser,                  // null on non-snipers
      snipPhase: 'idle',          // 'idle' | 'paint' | 'cool'
      snipPhaseT: 0,
      hp: tunables.ai.maxHealth * hpMult,
      maxHp: tunables.ai.maxHealth * hpMult,
      alive: true,
      state: STATE.IDLE,
      role,
      flankAngle,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeSwitchT: 0.5 + Math.random() * 0.7,
      dashCdT: 1.5 + Math.random(),
      dashT: 0, dashVx: 0, dashVz: 0,
      repositionT: 0, repositionDirX: 0, repositionDirZ: 0,
      flashT: 0, deathT: 0,
      reactionT: 0, loseTargetT: 0,
      fireT: 0, burstLeft: 0,
      slowT: 0,
      knockVel: new THREE.Vector3(),
      burnT: 0,
      surpriseT: 0,   // brief freeze after a throwable detonation; see main.js
      blindT: 0,
      dazzleT: 0,
      patrolT: 1 + Math.random() * 2,
      patrolTargetX: x, patrolTargetZ: z,
      homeX: x, homeZ: z,
      // Suspicion meter — accumulates on partial detection (edge of
      // view cone, long range, stealth-reduced signal) and drains when
      // LoS drops. Binary cone test used to mean "sneaking behind a
      // patrolling guard was impossible if you ever crossed their
      // view"; with the meter you can cross briefly and sneak away
      // before it crests the aggro threshold (1.0).
      suspicion: 0,
      // Sleep system — idle enemies can nod off after a while, and
      // wake from shot noise or a close presence. Hits connecting on
      // a sleeping enemy are guaranteed crits (see applyHit).
      sleepCheckT: 6 + Math.random() * 10,   // next "should I nap?" roll
      // Per-actor chatter cooldown + seat at a shared conversation
      // line in main.js. Initialised lazily.
      chatterT: 4 + Math.random() * 8,
      // Stuck detection — records last world position + time since the
      // enemy last moved meaningfully. Main loop retargets on timeout.
      stuckX: x, stuckZ: z, stuckT: 0,
      // Major-boss flags (drives HP bar, loot tier, archetype AI).
      majorBoss: !!opts.majorBoss,
      archetype: opts.archetype || null,
      // Per-archetype state scratch.
      archT: 0,                           // general-purpose archetype timer
      archEvadeDir: Math.random() < 0.5 ? -1 : 1,
      archMagSize: 0, archMagLeft: 0,
      archReloadT: 0,
      archVolleyT: 0,
      assassinPhase: 'closing',
      assassinDmgTaken: 0,
    };
    g.manager = this;
    // Every rig mesh carries an owner pointer so raycasts resolve back
    // to the gunman record regardless of which part took the hit.
    if (rig) for (const m of rig.meshes) m.userData.owner = g;
    leftLeg.userData.owner = g;
    rightLeg.userData.owner = g;
    torso.userData.owner = g;
    head.userData.owner = g;
    leftArm.userData.owner = g;
    rightArm.userData.owner = g;

    if (profile.shield === 'partial') this._attachShield(g, { full: false });

    // Register with the global rig instancer — pools this actor's
    // ~36 source meshes into shared InstancedMesh draw calls keyed by
    // (geometry, role). Source meshes go .visible=false; their
    // matrixWorld feeds the instance buffer each frame in syncFrame.
    // Initial matrixWorld is computed here so the first render lands
    // the actor in the right place.
    const _ri = rigInstancer && rigInstancer();
    if (_ri && rig) {
      g.group.updateMatrixWorld(true);
      _ri.register(rig);
    }

    this.gunmen.push(g);
    return g;
  }

  removeAll() {
    // Traverse each gunman's group and dispose GPU resources so level
    // regenerations don't leak geometry/materials. Rig geometries are
    // pooled at module level (actor_rig.js _geomCache) and tagged with
    // userData.sharedRigGeom so we skip those — disposing a shared
    // buffer would crash every other actor still holding it.
    const _ri = rigInstancer && rigInstancer();
    for (const g of this.gunmen) {
      // Release rig-instancer slots first so the InstancedMeshes
      // park this actor's instances off-screen before we tear the
      // source meshes down.
      if (_ri && g.rig) _ri.unregister(g.rig);
      g.group.traverse((obj) => {
        if (obj.geometry && !obj.geometry.userData?.sharedRigGeom) {
          obj.geometry.dispose();
        }
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      this.scene.remove(g.group);
      // Sniper laser lives in world space, separate from the body group.
      if (g.snipLaser) {
        this.scene.remove(g.snipLaser);
        g.snipLaser.geometry.dispose();
        g.snipLaser.material.dispose();
      }
    }
    this.gunmen = [];
  }

  hittables() {
    const out = [];
    for (const g of this.gunmen) {
      if (!g.alive) continue;
      if (!g.rig) continue;
      // Hot path — called once per frame from main.allHittables (which
      // caches across all callers). Was rebuilding two Sets per gunman
      // every call (~7% of frame self-time in profile traces); now we
      // cache the full mesh array and a disarmed variant per gunman
      // and just push from whichever applies.
      let meshes = g._hitMeshes;
      if (!meshes) {
        meshes = g._hitMeshes = g.rig.meshes.slice();
      }
      if (g.disarmed) {
        let dm = g._hitMeshesDisarmed;
        if (!dm) {
          const ra = g.rig.rightArm;
          const right = new Set([
            ra.shoulder.mesh, ra.shoulderBulge, ra.shoulderPad,
            ra.forearm.mesh, ra.elbowBulge, ra.wristCuff, ra.hand.mesh,
          ]);
          dm = g._hitMeshesDisarmed = g.rig.meshes.filter(m => !right.has(m));
        }
        meshes = dm;
      }
      for (let i = 0, n = meshes.length; i < n; i++) out.push(meshes[i]);
      if (g.shield && g.shield.hp > 0) out.push(g.shield.mesh);
    }
    return out;
  }

  applyHit(g, damage, zone, hitDir, opts = {}) {
    const drops = [];
    if (!g.alive) return { drops, blocked: false };
    // Damage from the player aggros the boss → enters hunt mode. Lets
    // a stealth-execute opener take a boss out without ever
    // triggering the cross-room pursuit.
    if (g.huntsPlayer && !g.huntActive) g.huntActive = true;

    // Shield absorption — frontal hits + any bullet that lands on the
    // shield mesh itself get soaked until the shield breaks. Shotgun slugs
    // and melee swipes destroy the shield outright.
    if (g.shield && g.shield.hp > 0 && (zone === 'shield' || hitDir)) {
      const fx = Math.sin(g.group.rotation.y), fz = Math.cos(g.group.rotation.y);
      const frontDot = hitDir ? -hitDir.x * fx - hitDir.z * fz : 1;
      if (zone === 'shield' || frontDot > 0.2) {
        const wClass = opts.weaponClass;
        const shieldBreaker = wClass === 'shotgun' || wClass === 'melee';
        if (shieldBreaker) {
          g.shield.hp = 0;
          this._disableShield(g);
          return { drops, blocked: false, shieldBroke: true };
        }
        // Partial shield lets some damage bleed through.
        const reductionPct = g.shield.fullBlock ? 1.0 : 0.6;
        const absorbed = damage * reductionPct;
        g.shield.hp -= absorbed;
        damage -= absorbed;
        if (g.shield.hp <= 0) this._disableShield(g);
        if (damage <= 0) {
          g.flashT = tunables.enemy.hitFlashTime;
          if (g.state === STATE.IDLE) g.state = STATE.ALERTED;
          return { drops, blocked: g.shield === null, shieldHit: true };
        }
      }
    }

    // Sleep-crit — any hit that lands on a sleeping enemy deals
    // double damage and then wakes them. Rewards stealth approaches
    // on a nodded-off patrol.
    if (g.state === STATE.SLEEP) {
      damage *= 2.0;
      g.group.rotation.x = 0;
    }
    if ((g.stunT || 0) > 0) damage *= 1.25;
    g.hp -= damage;
    g.flashT = tunables.enemy.hitFlashTime;
    if (g.state === STATE.IDLE || g.state === STATE.SLEEP) g.state = STATE.ALERTED;
    g.loseTargetT = tunables.ai.loseTargetTime;
    // Doorway-choke awareness — track hits in a 4s rolling window.
    // Two+ hits within the window from a player in a different room
    // is the cue for the smarter variants to tuck behind cover.
    const _now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (!g._hitWinStart || _now - g._hitWinStart > 4.0) {
      g._hitWinStart = _now;
      g._hitsInWin = 0;
    }
    g._hitsInWin = (g._hitsInWin | 0) + 1;
    // Boss phase-2 transition — when a boss crosses 50% HP, rev
    // their tactical profile: faster movement, shorter settle, more
    // dashes. One-shot so it only fires once per boss.
    if (g.tier === 'boss' && !g.phase2 && g.hp <= g.maxHp * 0.5) {
      g.phase2 = true;
      g.profile.moveSpeedMult *= 1.25;
      g.profile.reactionMult *= 0.65;
      g.profile.dash = true;      // enable dashes if they weren't already
      g.reactionT = 0;
      g.aiSettleT = 0;
    }
    // Hand the hit to the animation layer so the body flinches in the
    // direction of the impact. Magnitude scales with damage relative to
    // max HP so heavy hits rotate further than chip damage. Melee hits
    // get a ~1.7× bump so a sword/fist reads as a visible stagger
    // rather than the small bullet-flinch reaction.
    const isMelee = opts.weaponClass === 'melee';
    let hitMag = Math.max(0.3, Math.min(1.5, damage / Math.max(1, g.maxHp * 0.25)));
    if (isMelee) hitMag = Math.min(2.5, hitMag * 1.7);
    if (hitDir && g.rig) pokeHit(g.rig, hitDir.x, hitDir.z, hitMag);
    if (hitDir) {
      // Melee hits carry bigger positional push — 3× the bullet nudge —
      // and pause the enemy's AI for a short stagger so the player gets
      // a clean follow-up window.
      const knockScale = isMelee ? 0.45 : 0.15;
      g.group.position.x += hitDir.x * tunables.enemy.knockback * knockScale;
      g.group.position.z += hitDir.z * tunables.enemy.knockback * knockScale;
      if (isMelee) {
        g.staggerT = Math.max(g.staggerT || 0, 0.4);
      }
    }
    if (zone === 'legs') {
      g.slowT = tunables.zones.legs.slowDuration;
    } else if (zone === 'arm' && !g.disarmed && g.weapon
      && Math.random() <= tunables.zones.arm.disarmChance
        * (g.tier === 'boss' ? 0.10 : g.tier === 'subBoss' ? 0.20 : 1)) {
      // Boss disarm is rare — the fight loses its teeth the moment
      // the boss is weaponless, so we gate the roll hard. 10× harder
      // for bosses, 5× for sub-bosses; grunts unchanged.
      drops.push({ weapon: g.weapon, position: g.group.position.clone() });
      g.disarmed = true;
      // Hide the whole right-arm chain (upper arm + forearm + hand) by
      // toggling the shoulder pivot group, not just the upper-arm mesh.
      if (g.rightArmGroup) g.rightArmGroup.visible = false;
      else g.rightArm.visible = false;
      g.gun.visible = false;
      // Source meshes go .visible=false above — but the InstancedMesh
      // doesn't honour source visibility. Flag the right-arm rig
      // meshes so syncFrame writes zero-scale matrices for those
      // instance slots and the disarmed arm actually disappears.
      const _riHide = rigInstancer && rigInstancer();
      if (_riHide && g.rig?.rightArmMeshes) {
        _riHide.hideMeshes(g.rig.rightArmMeshes, true);
      }
      g.weapon = null;
      g.burstLeft = 0;
      g.fireT = 0.8;
      // Boss / sub-boss disarm reaction — flee briefly, then look
      // for a replacement gun, else charge and melee. See the
      // disarm-AI block in _updateRanged below.
      if (g.tier === 'boss' || g.tier === 'subBoss') {
        g.disarmedPhase = 'flee';
        g.disarmedPhaseT = 1.2 + Math.random() * 0.6;
      }
    }
    if (g.hp <= 0) {
      g.alive = false;
      g.state = STATE.DEAD;
      g.deathT = 0;
      // Sniper paint laser is parented to the world (not the body
      // group), so it doesn't auto-hide when the corpse fades. Cut
      // it explicitly on death.
      if (g.snipLaser) {
        g.snipLaser.visible = false;
        g.snipPhase = 'idle';
      }
      // Seed the death-fall impulse for the animation layer — same
      // direction as the killing blow, heavier damage = further rotation.
      if (g.rig && hitDir) {
        const deathMag = Math.max(0.6, Math.min(3.0, damage / Math.max(1, g.maxHp * 0.3)));
        pokeDeath(g.rig, hitDir.x, hitDir.z, deathMag);
      }
      // Seed a brief ragdoll-lite physics pass: the body drifts in the
      // hit direction, falls under gravity, and tests XZ collision
      // against the same blockers the AI used. When it comes to rest
      // the physics flag flips off and the rig holds its final pose.
      g.deathPhys = {
        vx: (hitDir?.x || 0) * 3.2,
        vy: 2.6 + Math.random() * 0.8,
        vz: (hitDir?.z || 0) * 3.2,
        settled: false,
        settleT: 0,
      };
      // The visible weapon mesh on the rig isn't needed once the
      // body is a corpse — strip it for draw-call savings. Loot
      // generation pulls the weapon def from enemy.weapon, not the
      // visible mesh, so the body still drops it on search.
      _stripDeadEnemyWeapon(g);
    }
    return { drops, blocked: false };
  }

  applyKnockback(g, impulse) {
    g.knockVel.x += impulse.x;
    g.knockVel.z += impulse.z;
  }

  update(ctx) {
    const dt = ctx.dt;
    // LOD scheduler — distant idle gunmen tick at half rate. Cuts AI
    // cost roughly in half on big late-game rooms with 6+ gunmen
    // sprinkled across adjacent rooms. Active enemies (alerted /
    // firing / chasing / fighting) always tick every frame; only
    // patrol-state enemies far from the player downgrade.
    const px = ctx.playerPos?.x ?? 0;
    const pz = ctx.playerPos?.z ?? 0;
    const farSq = 28 * 28;
    if (this._frame === undefined) this._frame = 0;
    this._frame++;
    const odd = (this._frame & 1) === 1;
    for (const g of this.gunmen) {
      // Hidden ambush bosses + minions are visually + behaviourally
      // dormant until revealHiddenAmbush flips them. Skip the entire
      // per-frame tick — animation, AI, perception — until then.
      if (g.alive && g.hidden) continue;
      if (g.alive) {
        const isIdle = g.state === STATE.IDLE || g.state === STATE.SLEEP;
        if (isIdle) {
          const dx = g.group.position.x - px;
          const dz = g.group.position.z - pz;
          if (dx * dx + dz * dz > farSq && odd) continue;
        }
      }
      // Animation LOD — drop updateAnim entirely for entities the
      // player can't read in detail. Reverted from the aggressive
      // 18m idle threshold after a visibility-regression report —
      // some actors at distance were rendering without their body
      // mesh transforms. Conservative thresholds: skip far+idle on
      // odd frames (50% rate) instead of dropping animation outright.
      const _gdx = g.group.position.x - px;
      const _gdz = g.group.position.z - pz;
      const _gCamD2 = _gdx * _gdx + _gdz * _gdz;
      g._animSkip = (!g.alive && (g.deathT || 0) > 2.5)
        || (_gCamD2 > 35 * 35 && odd);
      if (g.flashT > 0) {
        g.flashT = Math.max(0, g.flashT - dt);
        const k = g.flashT / tunables.enemy.hitFlashTime;
        // Source meshes are invisible (rendered via InstancedMesh);
        // tinting their materials would have no visible effect. Drive
        // the flash through per-instance colour instead.
        const _ri = rigInstancer && rigInstancer();
        if (_ri && g.rig) {
          _ri.setActorFlash(g.rig, k);
        } else {
          // Fallback for any path that bypassed the instancer (baked
          // corpse, headless tests).
          g.bodyMat.color.copy(this._normalBodyColor).lerp(this._hurt, k);
          g.headMat.color.copy(this._normalHeadColor).lerp(this._hurt, k);
        }
      }
      g.slowT = Math.max(0, g.slowT - dt);
      g.blindT = Math.max(0, (g.blindT || 0) - dt);
      g.dazzleT = Math.max(0, (g.dazzleT || 0) - dt);
      g.aiSettleT = Math.max(0, (g.aiSettleT || 0) - dt);

      // Burn DoT (flamethrower etc.). Stacks per fire-damage instance
      // — per-tick = stacks × dps. Stacks reset when the timer drains.
      if (g.burnT > 0 && (g.burnStacks | 0) > 0 && g.alive) {
        g.burnT = Math.max(0, g.burnT - dt);
        const tickDmg = g.burnStacks * tunables.burn.dps * dt;
        g.hp -= tickDmg;
        if (g.burnT <= 0) g.burnStacks = 0;
        ctx.onBurnDamage?.(g, tickDmg);
        if (g.hp <= 0) {
          g.alive = false;
          g.state = STATE.DEAD;
          g.deathT = 0;
          if (g.snipLaser) { g.snipLaser.visible = false; g.snipPhase = 'idle'; }
          if (!g.disarmed && g.weapon && ctx.onBurnKill) ctx.onBurnKill(g);
          _stripDeadEnemyWeapon(g);
        }
      }

      // Knockback decay + collision-aware application.
      if (g.knockVel.lengthSq() > 0.001) {
        const nx = g.group.position.x + g.knockVel.x * dt;
        const nz = g.group.position.z + g.knockVel.z * dt;
        const res = ctx.resolveCollision(g.group.position.x, g.group.position.z, nx, nz, tunables.ai.collisionRadius);
        g.group.position.x = res.x;
        g.group.position.z = res.z;
        g.knockVel.multiplyScalar(Math.max(0, 1 - 10 * dt));
      }

      if (!g.alive) {
        // Settled corpses — body is at rest, rig is in its dying
        // pose. Skip the entire per-frame update for these. Only
        // touch them every ~16 frames so the corpse fade / cleanup
        // logic still progresses without paying the per-frame
        // animation + physics cost. Late-game rooms fill with 8+
        // corpses; that's 8 wasted updateAnim calls/frame otherwise.
        if (g.deathPhys && g.deathPhys.settled) {
          if ((this._frame & 15) === 0) g.deathT += dt * 16;
          continue;
        }
        g.deathT += dt;
        g.alertMat.opacity = 0;
        // Ragdoll-lite physics for the first fraction of a second:
        // gravity pulls the body down, hit-direction drift scoots it
        // off the kill spot, and the shared collision resolver stops
        // it against walls / props. Once the vertical velocity is
        // small and the body is on the ground, flag settled so the
        // rig stops updating and holds its final pose.
        const dp = g.deathPhys;
        if (dp && !dp.settled) {
          dp.vy -= 18 * dt;          // gravity
          // Drag — slight horizontal damping each frame so the slide
          // decays into a rest rather than continuing forever.
          const drag = 1 - Math.min(1, 3.5 * dt);
          dp.vx *= drag; dp.vz *= drag;
          const nx = g.group.position.x + dp.vx * dt;
          const nz = g.group.position.z + dp.vz * dt;
          const res = ctx.resolveCollision
            ? ctx.resolveCollision(g.group.position.x, g.group.position.z, nx, nz, tunables.ai.collisionRadius)
            : { x: nx, z: nz };
          g.group.position.x = res.x;
          g.group.position.z = res.z;
          g.group.position.y = Math.max(0, g.group.position.y + dp.vy * dt);
          if (g.group.position.y <= 0) {
            g.group.position.y = 0;
            dp.vy = 0;
            // Ground contact drags XZ velocity harder — friction.
            dp.vx *= 0.4; dp.vz *= 0.4;
            dp.settleT += dt;
            const horiz = Math.hypot(dp.vx, dp.vz);
            if (horiz < 0.3 && dp.settleT > 0.15) {
              dp.settled = true;
              // Drop the corpse from the shadow map pass — saves a
              // chunk of GPU per frame in late-game rooms with 8+
              // bodies. Shadows on prone corpses read poorly anyway.
              g.group.traverse((obj) => { if (obj.isMesh) obj.castShadow = false; });
              // Bake the now-frozen rig pose into a flat 1-mesh-per-
              // material corpse. Cuts ~12 meshes/corpse to ~3 (body /
              // head / leg materials, plus extras for any tier-specific
              // gear which keeps its own material). Each corpse retains
              // its individual tier colours and gear silhouette so
              // bosses still read distinctly.
              // Bake captures source-mesh world transforms into one
              // merged corpse mesh — but it skips meshes with
              // visible=false. Our instancer registered all the rig
              // source meshes as invisible, so without this restore
              // the bake would yield nothing and the dead actor would
              // disappear. Flip them back to visible (except meshes
              // intentionally hidden by disarm — _instHide stays true
              // for those, so the disarmed arm doesn't get baked into
              // the corpse).
              if (g.rig?.meshes) {
                for (const m of g.rig.meshes) {
                  if (m && !m.userData._instHide) m.visible = true;
                }
              }
              // Release rig-instancer slots BEFORE the bake replaces
              // the rig group with a static merged mesh — otherwise
              // the dead actor's instance slots would keep rendering
              // their last pose alongside the baked corpse.
              const _riBake = rigInstancer && rigInstancer();
              if (_riBake && g.rig) _riBake.unregister(g.rig);
              const baked = swapInBakedCorpse(g.group);
              if (baked) {
                g.group = baked;
                g.rig = null;          // rig is gone — no more updateAnim calls
                g._baked = true;
              }
            }
          }
        }
        // The rig's death-fall overrides body rotation based on the
        // directional impulse poked in applyHit. No manual tipping here.
        if (g.rig && !g._animSkip) updateAnim(g.rig, { dying: true }, dt);
        // No respawn — bodies persist for looting.
        continue;
      }

      if (!tunables.ai.active) {
        g.state = STATE.IDLE;
        g.alertMat.opacity = THREE.MathUtils.lerp(g.alertMat.opacity, 0, Math.min(1, dt * 10));
        if (g.rig && !g._animSkip) updateAnim(g.rig, { speed: 0 }, dt);
        continue;
      }

      // Melee-hit stagger — pause decision-making while the rig's
      // hit-flinch plays out.
      if ((g.staggerT || 0) > 0) {
        g.staggerT = Math.max(0, g.staggerT - dt);
        if (g.rig && !g._animSkip) {
          updateAnim(g.rig, { speed: 0, aiming: false, aimYaw: 0, aimPitch: 0 }, dt);
        }
        continue;
      }

      // Stun grenade lockdown — fully frozen for a random 1-5s window.
      // Blocks movement + fire + AI advancement. Visual stars (added
      // by main.js when stunT crosses 0→positive) keep ticking to
      // rotate above the head.
      if ((g.stunT || 0) > 0) {
        g.stunT = Math.max(0, g.stunT - dt);
        if (g.rig && !g._animSkip) {
          updateAnim(g.rig, { speed: 0, aiming: false, aimYaw: 0, aimPitch: 0 }, dt);
        }
        continue;
      }

      // Spawner boss — high HP, minimal direct damage. Periodically
      // teleports to a random point in the boss room and spawns 4-6
      // melee adds at its new position. Ticks UNCONDITIONALLY so the
      // necromancer keeps the pressure on even while the player breaks
      // LoS or hides behind cover. Drone-summoner uses the same pattern.
      if (g.archetype === 'spawner') {
        g.archT = (g.archT || 0) - dt;
        if (g.archT <= 0 && ctx.spawnerTeleportAndSummon) {
          const baseCd = 5.5;
          g.archT = Math.max(2.5, baseCd / Math.max(0.5, g.aggression || 1));
          ctx.spawnerTeleportAndSummon(g);
        }
      } else if (g.archetype === 'droneSummoner') {
        g.archT = (g.archT || 0) - dt;
        if (g.archT <= 0 && ctx.droneSummonAt) {
          const baseCd = 6.5;
          g.archT = Math.max(2.5, baseCd / Math.max(0.5, g.aggression || 1));
          ctx.droneSummonAt(g.group.position.x, g.group.position.z);
        }
      }

      this._updateRanged(g, ctx, dt);

      // Procedural animation layer — pose the limbs on top of whatever
      // position/yaw _updateRanged just resolved. Speed is derived from
      // the frame delta so we don't need the AI to explicitly report it.
      if (g.rig && !g._animSkip) {
        const lastX = g._animLastX ?? g.group.position.x;
        const lastZ = g._animLastZ ?? g.group.position.z;
        const dx = g.group.position.x - lastX;
        const dz = g.group.position.z - lastZ;
        const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
        g._animLastX = g.group.position.x;
        g._animLastZ = g.group.position.z;
        const aiming = g.state === STATE.ALERTED || g.state === STATE.FIRING;
        const wcls = g.weapon?.class;
        const rifleHold = wcls === 'rifle' || wcls === 'shotgun'
          || wcls === 'lmg' || wcls === 'sniper';
        updateAnim(g.rig, {
          speed,
          aiming,
          sleeping: g.state === STATE.SLEEP,
          rifleHold,
          aimYaw: 0, aimPitch: 0,
        }, dt);
      }
    }
  }

  _respawn(g) {
    g.alive = true;
    g.hp = tunables.ai.maxHealth;
    g.deathT = 0;
    g.group.rotation.x = 0;
    g.group.position.set(g.homeX, 0, g.homeZ);
    g.state = STATE.IDLE;
    g.reactionT = 0;
    g.loseTargetT = 0;
    g.fireT = 0;
    g.burstLeft = 0;
    g.slowT = 0;
    g.knockVel.set(0, 0, 0);
    g.weapon = this._pickWeapon();
    g.disarmed = false;
    if (g.rightArmGroup) g.rightArmGroup.visible = true;
    else g.rightArm.visible = true;
    g.gun.visible = true;
    // Restore right-arm instance slots so the InstancedMesh draws
    // them again after a respawn.
    const _riReArmA = rigInstancer && rigInstancer();
    if (_riReArmA && g.rig?.rightArmMeshes) {
      _riReArmA.hideMeshes(g.rig.rightArmMeshes, false);
    }
    g.gun.geometry.dispose();
    g.gun.geometry = new THREE.BoxGeometry(
      g.weapon.muzzleGirth, g.weapon.muzzleGirth, g.weapon.muzzleLength,
    );
    g.gun.position.z = 0.5 + g.weapon.muzzleLength / 2;
    g.muzzle.position.z = 0.5 + g.weapon.muzzleLength;
    g.gun.material.emissive.copy(new THREE.Color(g.weapon.tracerColor)).multiplyScalar(0.15);
  }

  _updateRanged(g, ctx, dt) {
    // Panic — dragonbreath / other ignite-on-hit weapons mark normal
    // enemies as `panicT > 0`. They flail + run in random directions
    // and can't attack until the timer drains (they typically die
    // to the burn DoT before it does). Bosses ignore panic.
    if ((g.panicT || 0) > 0) {
      g.panicT -= dt;
      if (!g.panicDir || Math.random() < 0.04) {
        const a = Math.random() * Math.PI * 2;
        g.panicDir = { x: Math.cos(a), z: Math.sin(a) };
      }
      const step = tunables.ai.moveSpeed * 1.35 * dt;
      const res = ctx.resolveCollision(
        g.group.position.x, g.group.position.z,
        g.group.position.x + g.panicDir.x * step,
        g.group.position.z + g.panicDir.z * step,
        tunables.ai.collisionRadius,
      );
      if (res.x === g.group.position.x && res.z === g.group.position.z) {
        // Hit a wall — pick a fresh direction next frame.
        g.panicDir = null;
      }
      g.group.position.x = res.x;
      g.group.position.z = res.z;
      g.group.rotation.y = Math.atan2(g.panicDir?.x || 0, g.panicDir?.z || 1);
      return;
    }
    // Sleep dart — force the enemy into SLEEP immediately.
    if (g.forceSleep && g.state !== STATE.SLEEP) {
      g.state = STATE.SLEEP;
      g.forceSleep = false;
      g.zzzT = 0;
    }
    // Deep-sleep timer (whisper dart). While > 0 the enemy is locked
    // in SLEEP; the alert + propagate paths in main.js skip them
    // entirely so neither sound nor witness wakes them. Tick down,
    // and on expiry release them back to IDLE so they resume patrol
    // (un-aggroed — the dart wiped suspicion + lastKnown at hit).
    if (g.deepSleepT && g.deepSleepT > 0) {
      g.deepSleepT -= dt;
      if (g.state !== STATE.SLEEP) g.state = STATE.SLEEP;
      if (g.deepSleepT <= 0) {
        g.deepSleepT = 0;
        g.state = STATE.IDLE;
      }
    }

    // Reuse module-scope scratch vectors (see _g_* above) instead of
    // newing one per gunman per frame.
    const eye = g.torso.getWorldPosition(_g_eye);
    // Lower aim when the player is crouched — body scales to ~55%, so the
    // torso sits around y ≈ 0.7. Standing body center ≈ 1.0.
    const aimY = ctx.playerCrouched ? 0.65 : 1.0;
    const target = _g_target.copy(ctx.playerPos); target.y = aimY;
    const toPlayer = _g_toPlayer.subVectors(target, eye);
    const dist = Math.hypot(toPlayer.x, toPlayer.z);
    const dir2d = _g_dir2d.set(toPlayer.x, 0, toPlayer.z);
    if (dir2d.lengthSq() > 0.0001) dir2d.normalize();

    // Door-state gating was removed with the keycard redesign —
    // doors are open by default now, so detection runs purely on
    // LoS + suspicion + shot-noise below.
    const roomActive = true;

    // Stealth multiplier only gates *initial* detection while idle. Once
    // alerted, the enemy keeps aggro as long as LoS holds — with the
    // caveat that they can't see through the back of their own head.
    // Smoke zones (player throwables) override the LoS test entirely:
    // if the player is standing in smoke, no detection check passes.
    const playerInSmoke = ctx.isInsideSmoke
      ? ctx.isInsideSmoke(ctx.playerPos.x, ctx.playerPos.z)
      : false;
    // Throttle hasLineOfSight to 20Hz per enemy. The LOS raycast was
    // the largest contributor to the trace's raycast cost (sum of
    // bvh raycast + intersectTriangle ≈ 3.7s self-time over the
    // recorded session) — most frames the answer doesn't change
    // between successive 16ms ticks. Cache per-enemy + refresh at a
    // 0.05s interval. The cached value still gates suspicion / fire
    // decisions correctly because a 50ms staleness is well below
    // human reaction time.
    g._losT = (g._losT || 0) - ctx.dt;
    if (g._losT <= 0 || g._losCached === undefined) {
      g._losT = 0.05;
      g._losCached = ctx.combat.hasLineOfSight(eye, target, ctx.obstacles);
    }
    const hasLos = roomActive && !playerInSmoke && g._losCached;
    const fwd = _g_fwd.set(Math.sin(g.group.rotation.y), 0, Math.cos(g.group.rotation.y));
    const facingDot = fwd.dot(dir2d);
    // Player is in the rear ~90° cone (45° each side of directly-behind).
    // Rear blindspot widened — facingDot < -0.4 is roughly anything
    // more than 115° off the enemy's forward, which reads to the
    // player as "clearly behind me". Prior -0.7 required nearly dead-
    // behind and let side-rear sneak attempts still trigger aggro.
    const inRearBlindspot = facingDot < -0.4;

    // --- suspicion ramp -----------------------------------------------
    // Compute the raw detection signal this frame: 0 when the enemy
    // absolutely cannot see the player, 1 when the player is dead-
    // center in the cone at close range with no stealth penalty.
    // Suspicion lerps toward the signal (fast up, slow down) so a
    // brief peek across the view cone doesn't instantly trigger
    // aggro — the player has a window to break LoS and decay it back.
    const stealthMult = ctx.playerStealthMult || 1;
    // Snipers see the player at huge range — ~3× normal — so they can
    // open fire from across rooms / off-screen and force the player
    // to close. Sniper still respects LoS / stealth multipliers.
    const sniperRangeMult = g.profile.sniper ? 3.2 : 1;
    const baseRange = tunables.ai.detectionRange * stealthMult * sniperRangeMult;
    const cosHalfCone = Math.cos((tunables.ai.detectionAngleDeg * Math.PI / 180) * 0.5);
    // Point-blank presence: if the player is within arm's reach with a
    // clear sight line AND isn't directly behind, the enemy notices
    // regardless of stealth or cone falloff. Still respects the rear
    // blindspot so a proper sneak-up from behind is rewarded.
    const proximity = hasLos && !inRearBlindspot && dist < tunables.ai.proximityRange;
    let signal = 0;
    if (proximity) {
      signal = 1;
    } else if (hasLos && !inRearBlindspot) {
      // Distance factor: full at center, fades out past 1.5× range.
      const maxRange = baseRange * 1.5;
      const distK = Math.max(0, 1 - dist / maxRange);
      // Cone factor: full at facing dead-on, fades at cone edge, 0 at
      // side. Allows peripheral noticing rather than a hard 0/1 cone.
      const coneSpan = 1 - cosHalfCone;
      const coneK = coneSpan > 0
        ? Math.max(0, (facingDot - cosHalfCone + coneSpan * 0.6) / (coneSpan * 1.6))
        : (facingDot >= cosHalfCone ? 1 : 0);
      signal = Math.min(1, distK * coneK);
    }
    // Alerted enemies keep saturating suspicion so they don't relax
    // while they still have LoS; idle enemies accept the raw signal.
    const suspTarget = g.state !== STATE.IDLE && hasLos && !inRearBlindspot
      ? 1 : signal;
    const rampRate = suspTarget > g.suspicion ? 1.8 : 0.35;  // up fast, down slow
    g.suspicion += Math.sign(suspTarget - g.suspicion)
      * Math.min(Math.abs(suspTarget - g.suspicion), rampRate * dt);
    g.suspicion = Math.max(0, Math.min(1.2, g.suspicion));  // tiny headroom

    // canSee fires only when suspicion crests full detection. Anything
    // below is pre-aggro — patrol keeps running, but the enemy may
    // rotate toward the player's last-seen direction (see below).
    let canSee = false;
    if (g.state !== STATE.IDLE) {
      const seeRange = tunables.ai.detectionRange * 2 * sniperRangeMult;
      canSee = hasLos && !inRearBlindspot && dist <= seeRange;
    } else if (g.suspicion >= 1.0) {
      canSee = true;
    }
    // Boss hunt — once a boss has aggro'd (taken damage, seen the
    // player normally, or had their suspicion crest into ALERTED
    // state), they switch into hunt mode and pursue the player
    // through walls / rooms / stealth. Stealth approach + execute
    // remains a viable opener until the player triggers them.
    // `g.huntActive` flips on first aggro and stays true until death.
    if (g.huntsPlayer && !g.huntActive && g.state !== STATE.IDLE) {
      g.huntActive = true;
    }
    if (g.huntsPlayer && g.huntActive && ctx.playerPos) {
      canSee = true;
    }
    // Chatter — idle enemies occasionally mutter to themselves. Uses
    // a per-enemy cooldown so squads don't all speak at once, and
    // skips entirely when canSee to keep the combat beat clean.
    if (g.state === STATE.IDLE && ctx.camera) {
      g.chatterT -= dt;
      if (g.chatterT <= 0) {
        g.chatterT = 9 + Math.random() * 14;
        if (Math.random() < 0.55) {
          const head = g.rig ? g.rig.head.getWorldPosition(_g_head)
                             : g.group.position.clone().setY(2);
          head.y += 0.5;
          const line = CHATTER_LINES[Math.floor(Math.random() * CHATTER_LINES.length)];
          spawnSpeechBubble(head, ctx.camera, line, 2.4);
        }
      }
    }

    // Disarmed-boss behavior — bosses & sub-bosses who've lost their
    // gun flee briefly, then look for a dropped weapon to pick up.
    // If nothing's nearby they charge the player and swing for a
    // short melee attack. Normal grunts don't get this logic (they
    // just stay disarmed + run).
    if (g.disarmed && (g.tier === 'boss' || g.tier === 'subBoss') && g.alive) {
      g.disarmedPhaseT = Math.max(0, (g.disarmedPhaseT || 0) - dt);
      const bossSpeed = tunables.ai.moveSpeed * g.profile.moveSpeedMult
        * (g.tier === 'boss' ? 1.35 : 1.15);
      // Phase 1 — flee straight away from the player.
      if (g.disarmedPhase === 'flee') {
        const fdx = g.group.position.x - ctx.playerPos.x;
        const fdz = g.group.position.z - ctx.playerPos.z;
        const fd = Math.hypot(fdx, fdz) || 1;
        const step = bossSpeed * 1.2 * dt;
        const res = ctx.resolveCollision(
          g.group.position.x, g.group.position.z,
          g.group.position.x + (fdx / fd) * step,
          g.group.position.z + (fdz / fd) * step,
          tunables.ai.collisionRadius,
        );
        g.group.position.x = res.x;
        g.group.position.z = res.z;
        g.group.rotation.y = Math.atan2(fdx / fd, fdz / fd);
        if (g.disarmedPhaseT <= 0) {
          // Decide fetch or rush based on what's around.
          let pickup = null;
          if (ctx.loot && ctx.loot.items) {
            let bestD = 15;
            for (const lt of ctx.loot.items) {
              const w = lt.item;
              if (!w || w.type !== 'ranged') continue;
              const dx = lt.group.position.x - g.group.position.x;
              const dz = lt.group.position.z - g.group.position.z;
              const d = Math.hypot(dx, dz);
              if (d < bestD) { bestD = d; pickup = lt; }
            }
          }
          g.disarmedPhase = pickup ? 'fetch' : 'rush';
          g.disarmedTarget = pickup;
          g.disarmedPhaseT = pickup ? 6 : 4;
          if (ctx.camera && g.rig) {
            const head = g.rig.head.getWorldPosition(_g_head);
            head.y += 0.6;
            const line = pickup ? 'Pick it up!' : 'Get over here!';
            spawnSpeechBubble(head, ctx.camera, line, 2.0);
          }
        }
      }
      // Phase 2a — fetch a dropped gun. Walk to it, then re-arm.
      else if (g.disarmedPhase === 'fetch' && g.disarmedTarget) {
        const target = g.disarmedTarget;
        if (!target.group || !ctx.loot.items.includes(target)) {
          // Someone else grabbed the pickup — escalate to rush.
          g.disarmedPhase = 'rush';
          g.disarmedPhaseT = 4;
        } else {
          const tdx = target.group.position.x - g.group.position.x;
          const tdz = target.group.position.z - g.group.position.z;
          const td = Math.hypot(tdx, tdz);
          if (td < 1.3) {
            // Re-arm: adopt the weapon, destroy the ground loot,
            // restore visibility + chatter a quip.
            g.weapon = target.item;
            g.disarmed = false;
            if (g.rightArmGroup) g.rightArmGroup.visible = true;
            else if (g.rightArm) g.rightArm.visible = true;
            if (g.gun) g.gun.visible = true;
            // Restore right-arm InstancedMesh slots so the
            // re-armed boss's arm actually re-appears.
            const _riReArmB = rigInstancer && rigInstancer();
            if (_riReArmB && g.rig?.rightArmMeshes) {
              _riReArmB.hideMeshes(g.rig.rightArmMeshes, false);
            }
            g.aiMagLeft = g.weapon?.magSize || 30;
            g.aiReloadT = 0;
            ctx.loot.remove?.(target);
            g.disarmedPhase = null;
            g.disarmedTarget = null;
            if (ctx.camera && g.rig) {
              const head = g.rig.head.getWorldPosition(_g_head);
              head.y += 0.6;
              spawnSpeechBubble(head, ctx.camera, 'Now you die.', 2.0);
            }
          } else if (td > 0.1) {
            const step = bossSpeed * 1.1 * dt;
            const res = ctx.resolveCollision(
              g.group.position.x, g.group.position.z,
              g.group.position.x + (tdx / td) * step,
              g.group.position.z + (tdz / td) * step,
              tunables.ai.collisionRadius,
            );
            g.group.position.x = res.x;
            g.group.position.z = res.z;
            g.group.rotation.y = Math.atan2(tdx / td, tdz / td);
          }
          // If the fetch path expires (target unreachable), drop to rush.
          if (g.disarmedPhaseT <= 0) {
            g.disarmedPhase = 'rush';
            g.disarmedPhaseT = 4;
          }
        }
      }
      // Phase 2b — melee rush. Charge the player; punch on contact.
      else if (g.disarmedPhase === 'rush') {
        const pdx = ctx.playerPos.x - g.group.position.x;
        const pdz = ctx.playerPos.z - g.group.position.z;
        const pd = Math.hypot(pdx, pdz) || 1;
        const step = bossSpeed * 1.35 * dt;    // faster when unarmed
        const res = ctx.resolveCollision(
          g.group.position.x, g.group.position.z,
          g.group.position.x + (pdx / pd) * step,
          g.group.position.z + (pdz / pd) * step,
          tunables.ai.collisionRadius,
        );
        g.group.position.x = res.x;
        g.group.position.z = res.z;
        g.group.rotation.y = Math.atan2(pdx / pd, pdz / pd);
        // Melee swing on contact, then internal cooldown.
        g.disarmedSwingT = Math.max(0, (g.disarmedSwingT || 0) - dt);
        if (pd < 1.6 && g.disarmedSwingT <= 0 && ctx.onMeleePlayer) {
          const meleeDmg = 18 * g.damageMult;
          ctx.onMeleePlayer(meleeDmg);
          g.disarmedSwingT = 0.9;   // punch cadence
        }
      }
      // Skip all other AI branches while handling disarm.
      return;
    }

    // Sleep — idle enemies occasionally nod off. Wakes on any
    // aggro signal (canSee, suspicion crest, or a nearby shot which
    // main.js routes through the usual alert()). Sleeping enemies
    // tip over slightly (rotation.x) so the silhouette reads as
    // "down" even with the rig static.
    if (g.state === STATE.IDLE) {
      g.sleepCheckT = (g.sleepCheckT || 0) - dt;
      if (g.sleepCheckT <= 0) {
        g.sleepCheckT = 5 + Math.random() * 8;
        if (Math.random() < 0.10 && g.suspicion < 0.1) {
          g.state = STATE.SLEEP;
          g.zzzT = 0;                    // kick first Zzz on next update
        }
      }
    }
    if (g.state === STATE.SLEEP) {
      // Near-proximity wake: player inside ~3m or suspicion climbing.
      const ddx = ctx.playerPos.x - g.group.position.x;
      const ddz = ctx.playerPos.z - g.group.position.z;
      const proximitySq = ddx * ddx + ddz * ddz;
      if (proximitySq < 9 || g.suspicion > 0.2 || hasLos) {
        g.state = STATE.ALERTED;
        g.reactionT = tunables.ai.reactionTime * 1.4;  // groggy
        ctx.onAlert?.(g);
      }
      // Zzz emitter — one letter every ~1.3s while sleeping. Random
      // case + extra z's so the effect feels handmade, not ticking.
      g.zzzT = (g.zzzT || 0) - dt;
      if (g.zzzT <= 0 && ctx.camera) {
        g.zzzT = 1.1 + Math.random() * 0.8;
        const head = g.rig ? g.rig.head.getWorldPosition(_g_head)
                           : g.group.position.clone().setY(2);
        head.y += 0.4;
        head.x += (Math.random() - 0.5) * 0.25;
        const zs = Math.random() < 0.3 ? 'ZZZ' : Math.random() < 0.5 ? 'zz' : 'z';
        spawnSpeechBubble(head, ctx.camera, zs, 1.6);
      }
      // Don't run any other AI logic while asleep.
      return;
    }

    // While suspicious but not yet aggroed, turn the head toward the
    // player — visible "wait, did I see something?" tell without
    // committing to a chase.
    if (!canSee && g.state === STATE.IDLE && g.suspicion > 0.25 && dir2d.lengthSq() > 0) {
      const lookYaw = Math.atan2(dir2d.x, dir2d.z);
      const curYaw = g.group.rotation.y;
      // Smoothly rotate toward the player over a few frames.
      let delta = lookYaw - curYaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      g.group.rotation.y += delta * Math.min(1, dt * 3);
    }

    // Boss aggression overlay — bosses react faster and push closer.
    // `g.aggression` ramps with level so a level-10 boss reacts and
    // pursues twice as hard as a level-1 boss without changing its
    // base profile. Compresses reaction further on top of the tier
    // bonus, and expands move speed.
    const bossAggro = g.tier === 'boss' ? 0.5 : (g.tier === 'subBoss' ? 0.75 : 1);
    const aggInv = 1 / Math.max(0.5, g.aggression || 1);
    const reactionT = tunables.ai.reactionTime * g.profile.reactionMult * bossAggro * aggInv;
    const preferredRange = (g.profile.preferredRange ?? tunables.ai.preferredRange)
      * (g.tier === 'boss' ? 0.75 : 1);
    const rangeTolerance = g.profile.rangeTolerance ?? tunables.ai.rangeTolerance;
    const moveSpeed = tunables.ai.moveSpeed * g.profile.moveSpeedMult
      * (g.tier === 'boss' ? 1.35 : g.tier === 'subBoss' ? 1.15 : 1)
      * (g.tier === 'boss' ? Math.min(1.6, g.aggression || 1) : 1)
      * (g._berserkMoveMult || 1);

    if (canSee) {
      if (g.state === STATE.IDLE) {
        g.state = STATE.ALERTED;
        g.reactionT = reactionT;
        ctx.onAlert?.(g);
      }
      g.loseTargetT = tunables.ai.loseTargetTime;
    } else if (g.state === STATE.IDLE) {
      // Patrol: wander within a small radius of the spawn point,
      // OR (25% of rolls) drift into an adjacent room so the squad
      // doesn't feel rooted to its spawn. Between-room drift uses
      // the neighbor's centre as the goal, and the door-seek pass
      // below picks the actual waypoint to get there.
      g.patrolT -= dt;
      if (g.patrolT <= 0) {
        g.patrolT = 2 + Math.random() * 3;
        // Idle enemies stay in their spawn room. The previous between-
        // room drift (25% chance to wander to a neighbour's centre with
        // no door-aware pathing) made everyone pile up at the first
        // choke point on level start. Cross-room movement happens when
        // they're *alerted* — door-graph pathing lives in that path.
        g.patrolTargetX = g.homeX + (Math.random() - 0.5) * 6;
        g.patrolTargetZ = g.homeZ + (Math.random() - 0.5) * 6;
      }
      const tx = g.patrolTargetX - g.group.position.x;
      const tz = g.patrolTargetZ - g.group.position.z;
      const td = Math.hypot(tx, tz);
      if (td > 0.4) {
        const pdir = { x: tx / td, z: tz / td };
        g.group.rotation.y = Math.atan2(pdir.x, pdir.z);
        const step = tunables.ai.moveSpeed * 0.35 * dt;
        const nx = g.group.position.x + pdir.x * step;
        const nz = g.group.position.z + pdir.z * step;
        const res = ctx.resolveCollision(g.group.position.x, g.group.position.z, nx, nz,
          tunables.ai.collisionRadius);
        g.group.position.x = res.x;
        g.group.position.z = res.z;
      }
    }

    // Once alerted, the enemy stays alerted for the rest of the fight —
    // they may lose line of sight, but they'll push toward the last known
    // position and keep engaging the moment LoS returns.
    if (!canSee && g.state !== STATE.IDLE) {
      if (g.lastKnownX === undefined) {
        g.lastKnownX = ctx.playerPos.x;
        g.lastKnownZ = ctx.playerPos.z;
      }
      g.noLosT = (g.noLosT || 0) + dt;
    } else {
      g.lastKnownX = ctx.playerPos.x;
      g.lastKnownZ = ctx.playerPos.z;
      g.noLosT = 0;
    }

    // Stuck detection — if the enemy has been trying to move but
    // hasn't shifted more than ~2cm/frame for over a second, pick
    // a fresh waypoint. Now also cancels mid-dash bursts so dashers
    // can't oscillate against a doorway for seconds at a time.
    const dmX = g.group.position.x - g.stuckX;
    const dmZ = g.group.position.z - g.stuckZ;
    const moved = dmX * dmX + dmZ * dmZ;
    if (moved < 0.0025) {
      g.stuckT = (g.stuckT || 0) + dt;
      // Cancel a stuck dash immediately and add a long cool-down so
      // the dasher has time to re-path before attempting another one.
      if (g.stuckT > 0.25 && (g.dashT || 0) > 0) {
        g.dashT = 0;
        g.dashVx = 0; g.dashVz = 0;
        g.dashCdT = 2.5 + Math.random() * 1.5;
      }
      if (g.stuckT > 1.2) {
        g.patrolTargetX = g.homeX + (Math.random() - 0.5) * 10;
        g.patrolTargetZ = g.homeZ + (Math.random() - 0.5) * 10;
        g.patrolT = 1 + Math.random() * 2;
        // Jiggle a tiny amount perpendicular to facing so the body
        // separation pass can finish the escape.
        const jx = -Math.cos(g.group.rotation.y) * 0.12;
        const jz = Math.sin(g.group.rotation.y) * 0.12;
        const jRes = ctx.resolveCollision(g.group.position.x, g.group.position.z,
          g.group.position.x + jx, g.group.position.z + jz,
          tunables.ai.collisionRadius);
        g.group.position.x = jRes.x;
        g.group.position.z = jRes.z;
        g.stuckT = 0;
      }
    } else {
      g.stuckT = 0;
    }
    g.stuckX = g.group.position.x;
    g.stuckZ = g.group.position.z;

    const targetAlpha =
      g.state === STATE.FIRING ? 1.0 :
      g.state === STATE.ALERTED ? 0.6 : 0;
    g.alertMat.opacity = THREE.MathUtils.lerp(g.alertMat.opacity, targetAlpha, Math.min(1, dt * 10));

    // Face the player only when they're actually visible. Otherwise face
    // the last-known direction (or pose idle) so the AI's gun doesn't
    // clip through walls pointing at a target they can't see.
    if (g.state !== STATE.IDLE) {
      // Smooth-turn toward the target yaw instead of snapping. Same
      // signed-shortest-arc lerp as the melee version. Default 5 rad/s
      // — gunmen track quickly but not instantly so the player has a
      // moment to break LoS or strafe past their barrel.
      const _smoothFace = (targetYaw) => {
        const cur = g.group.rotation.y;
        let delta = targetYaw - cur;
        while (delta > Math.PI)  delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const step = Math.sign(delta) * Math.min(Math.abs(delta), 5.0 * dt);
        g.group.rotation.y = cur + step;
      };
      if (canSee && dir2d.lengthSq() > 0) {
        _smoothFace(Math.atan2(dir2d.x, dir2d.z));
      } else if (typeof g.lastKnownX === 'number') {
        const lx = g.lastKnownX - g.group.position.x;
        const lz = g.lastKnownZ - g.group.position.z;
        const ll = Math.hypot(lx, lz);
        if (ll > 0.0001) _smoothFace(Math.atan2(lx / ll, lz / ll));
      }
    }

    // Door-seeking — when the player is in a different room, follow
    // a BFS path through the door-graph instead of aiming at the
    // single nearest door. This keeps the enemy on a *natural*
    // route instead of bee-lining into the nearest wall. Path is
    // cached per-enemy for ~0.6s so BFS isn't run every frame, and
    // is invalidated when the player crosses a room boundary.
    let doorTarget = null;
    if (!canSee && (g.noLosT || 0) > 0.6
        && ctx.level
        && typeof ctx.playerRoomId === 'number'
        && ctx.playerRoomId >= 0) {
      const here = ctx.level.roomAt(g.group.position.x, g.group.position.z);
      const hereId = here ? here.id : g.roomId;
      if (hereId !== ctx.playerRoomId) {
        g.pathCache = g.pathCache || { t: 0, toId: -1, nextDoor: null };
        g.pathCache.t -= dt;
        if (g.pathCache.t <= 0 || g.pathCache.toId !== ctx.playerRoomId) {
          // Committed routing — was 0.4-0.7s (twitchy re-evaluation
          // every ~half-second). Now 1.5-2.0s so the AI sees through
          // its initial decision before reassessing. Reads as
          // intentional movement instead of constant indecision.
          g.pathCache.t = 1.5 + Math.random() * 0.5;
          g.pathCache.toId = ctx.playerRoomId;
          const doors = ctx.level.pathDoorsFrom(hereId, ctx.playerRoomId);
          g.pathCache.nextDoor = (doors && doors.length) ? doors[0] : null;
        }
        const nd = g.pathCache.nextDoor;
        if (nd && nd.userData) {
          doorTarget = {
            x: nd.userData.cx, z: nd.userData.cz,
            unlocked: !!nd.userData.unlocked,
          };
        }
      }
    }
    // Fallback: if the path-graph couldn't find a route (e.g. the
    // rooms graph hit a key-gated dead end) still try the direct
    // nearest-door lookup so the enemy doesn't just stand still.
    if (!doorTarget && !canSee && (g.noLosT || 0) > 0.8
        && typeof ctx.playerRoomId === 'number'
        && ctx.playerRoomId !== g.roomId
        && ctx.findDoorToward) {
      const door = ctx.findDoorToward(g.roomId, g.group.position);
      if (door) doorTarget = door;
    }

    // Doorway-choke awareness — when a "smart" variant has been hit
    // twice in 4s by a player who's in a DIFFERENT room (i.e. firing
    // through a doorway choke), retreat to the room corner farthest
    // from the connecting door and bark defiance. Stay tucked until
    // (a) 12s timer expires OR (b) the player enters the gunman's
    // room and we re-engage. Standard / tank / shielded grunts skip
    // this — they're the dumb meat that keeps walking into the
    // killbox.
    let tuckTarget = null;
    if (TUCK_VARIANTS.has(g.variant)
        && g.state !== STATE.IDLE
        && typeof ctx.playerRoomId === 'number'
        && ctx.playerRoomId !== g.roomId) {
      const _now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      // Re-engage trigger — player walked into our room.
      if (g._tuckedT && ctx.playerRoomId === g.roomId) g._tuckedT = 0;
      const recentlyChoked = g._hitsInWin >= 2
        && (_now - (g._hitWinStart || 0)) <= 4.0;
      if (recentlyChoked && !g._tuckedT) {
        // Pick the room corner farthest from the connecting door so
        // bullets coming through the gap can't land. Cached so we
        // don't recompute the corner choice each frame.
        const room = ctx.level?.rooms?.[g.roomId];
        if (room && room.bounds) {
          const door = ctx.findDoorToward
            ? ctx.findDoorToward(g.roomId, g.group.position)
            : null;
          const dx = door ? door.x : ctx.playerPos.x;
          const dz = door ? door.z : ctx.playerPos.z;
          const b = room.bounds;
          const corners = [
            { x: b.minX + 1.5, z: b.minZ + 1.5 },
            { x: b.maxX - 1.5, z: b.minZ + 1.5 },
            { x: b.minX + 1.5, z: b.maxZ - 1.5 },
            { x: b.maxX - 1.5, z: b.maxZ - 1.5 },
          ];
          let best = corners[0], bestD2 = -1;
          for (const c of corners) {
            const cdx = c.x - dx, cdz = c.z - dz;
            const d2 = cdx * cdx + cdz * cdz;
            if (d2 > bestD2) { bestD2 = d2; best = c; }
          }
          g._tuckCorner = best;
          g._tuckedT = 12.0;
          g._tuckBarkT = 0;
          // Reset hit window so we don't immediately re-trigger.
          g._hitsInWin = 0;
          // Initial bark.
          if (ctx.camera) {
            const head = g.group.position.clone(); head.y = 1.9;
            const line = TUCK_BARKS[Math.floor(Math.random() * TUCK_BARKS.length)];
            spawnSpeechBubble(head, ctx.camera, line, 5.0);
          }
        }
      }
    }
    if (g._tuckedT > 0) {
      g._tuckedT -= dt;
      if (g._tuckedT > 0 && g._tuckCorner) {
        tuckTarget = g._tuckCorner;
        g._tuckBarkT = (g._tuckBarkT || 0) - dt;
        if (g._tuckBarkT <= 0 && ctx.camera) {
          g._tuckBarkT = 5.0 + Math.random() * 2.5;
          const head = g.group.position.clone(); head.y = 1.9;
          const line = TUCK_BARKS[Math.floor(Math.random() * TUCK_BARKS.length)];
          spawnSpeechBubble(head, ctx.camera, line, 5.0);
        }
      } else {
        g._tuckCorner = null;
      }
    }

    // Door-side suppression hold — when isPlayerCamping is true AND
    // the gunman is in a different room AND there's a connecting door
    // to walk to, advance to a point ~3m perpendicular to the door
    // (on this gunman's side) and hold there. Player can't see the
    // gunman from the corridor, but the gunman covers any peek
    // through the doorway with the existing fire-on-LoS logic. Same
    // bark cycle as the corner tuck.
    if (TUCK_VARIANTS.has(g.variant)
        && !tuckTarget
        && g.state !== STATE.IDLE
        && ctx.isPlayerCamping?.()
        && typeof ctx.playerRoomId === 'number'
        && ctx.playerRoomId !== g.roomId) {
      // Refresh the chosen door + side-of-door point every 1s so a
      // moving player still gets the right covering angle.
      g._suppressRefreshT = (g._suppressRefreshT || 0) - dt;
      if (g._suppressRefreshT <= 0 || !g._suppressTarget) {
        g._suppressRefreshT = 1.0;
        const door = ctx.findDoorToward
          ? ctx.findDoorToward(g.roomId, g.group.position)
          : null;
        if (door) {
          const ddx = door.x - g.group.position.x;
          const ddz = door.z - g.group.position.z;
          const ddLen = Math.hypot(ddx, ddz) || 1;
          // Perpendicular vector to the door-approach direction.
          const px = -ddz / ddLen;
          const pz =  ddx / ddLen;
          // Pick whichever side is farther from the player so the
          // gunman tucks behind the doorframe wall on the safer
          // angle. Side offset 3m from the door centre.
          const sideA = { x: door.x + px * 3.0, z: door.z + pz * 3.0 };
          const sideB = { x: door.x - px * 3.0, z: door.z - pz * 3.0 };
          const adx = sideA.x - ctx.playerPos.x, adz = sideA.z - ctx.playerPos.z;
          const bdx = sideB.x - ctx.playerPos.x, bdz = sideB.z - ctx.playerPos.z;
          g._suppressTarget = (adx * adx + adz * adz) > (bdx * bdx + bdz * bdz) ? sideA : sideB;
        }
      }
      if (g._suppressTarget) {
        tuckTarget = g._suppressTarget;
        g._tuckBarkT = (g._tuckBarkT || 0) - dt;
        if (g._tuckBarkT <= 0 && ctx.camera) {
          g._tuckBarkT = 6.0 + Math.random() * 3.0;
          const head = g.group.position.clone(); head.y = 1.9;
          const line = TUCK_BARKS[Math.floor(Math.random() * TUCK_BARKS.length)];
          spawnSpeechBubble(head, ctx.camera, line, 5.0);
        }
      }
    } else if (g._suppressTarget) {
      // Player stopped camping or entered our room — drop the side-
      // hold so the normal chase / fire logic resumes.
      g._suppressTarget = null;
    }

    // Escort formation — standard / cover-seeker gunmen will nestle behind
    // a shield bearer in the same room so the shield protects them from
    // the player's fire. Dashers and tanks ignore the escort urge.
    // Refresh the nearest-shield lookup every 0.5s instead of every
    // frame; with multiple gunmen and shield-bearers this saves the
    // O(gunmen × shieldBearers) scan every tick.
    let escortTarget = null;
    const escortish = g.variant === 'standard' || g.variant === 'coverSeeker';
    if (escortish && ctx.shieldBearers?.length && g.state !== STATE.IDLE) {
      g._shieldRefreshT = (g._shieldRefreshT || 0) - dt;
      if (g._shieldRefreshT <= 0 || !g._shieldRef || !g._shieldRef.alive) {
        g._shieldRefreshT = 0.5;
        let best = null, bestD = 40;
        for (const sb of ctx.shieldBearers) {
          if (sb.roomId !== undefined && g.roomId !== undefined && sb.roomId !== g.roomId) continue;
          const sdx = sb.group.position.x - g.group.position.x;
          const sdz = sb.group.position.z - g.group.position.z;
          const sd = Math.hypot(sdx, sdz);
          if (sd < bestD) { best = sb; bestD = sd; }
        }
        g._shieldRef = best;
      }
      const best = g._shieldRef;
      if (best && best.alive) {
        // FLANK-OUT trigger — when the player closes inside ~6m of
        // this gunman, drop the escort hide and break out to the side
        // for a clean shot. This is the "rush them once they're close"
        // behaviour the user asked for.
        if (dist > 6.0) {
          const sbPos = best.group.position;
          const toPlayerX = ctx.playerPos.x - sbPos.x;
          const toPlayerZ = ctx.playerPos.z - sbPos.z;
          const tLen = Math.hypot(toPlayerX, toPlayerZ) || 1;
          // Escort spot sits ~1.6m behind the shield from the player's side.
          escortTarget = {
            x: sbPos.x - (toPlayerX / tLen) * 1.6,
            z: sbPos.z - (toPlayerZ / tLen) * 1.6,
          };
        }
      }
    }

    if (g.state === STATE.ALERTED || g.state === STATE.FIRING) {
      // Flankers approach along a direction rotated by `flankAngle`. When
      // the player is hidden behind cover for a moment, everyone starts
      // flanking — the baseline angle widens so enemies detour sideways to
      // regain line of sight rather than waiting behind the same wall.
      //
      // Crouched player behind cover is a special case: the shorter
      // silhouette means LoS is being broken by low props the AI can
      // easily walk around. Trigger cover-flanking twice as fast and
      // push the angle wider so they commit to swinging around the
      // cover rather than standing still in front of it.
      const approachDir = _g_approachDir.copy(dir2d);
      const crouchedHiding = !!ctx.playerCrouched;
      const coverDelay = crouchedHiding ? 0.6 : 1.2;
      const coverFlanking = (g.noLosT || 0) > coverDelay && typeof g.lastKnownX === 'number';
      const crouchAngleBoost = crouchedHiding ? 1.35 : 1.0;
      const flankAng = g.role === 'flanker'
        ? (coverFlanking ? g.flankAngle * 1.5 * crouchAngleBoost : g.flankAngle)
        : (coverFlanking ? (g.coverFlankSide || 1) * (Math.PI * 0.35) * crouchAngleBoost : 0);
      if (flankAng !== 0) {
        const c = Math.cos(flankAng), s = Math.sin(flankAng);
        approachDir.set(dir2d.x * c - dir2d.z * s, 0, dir2d.x * s + dir2d.z * c);
      }
      if (coverFlanking && g.coverFlankSide === undefined) {
        g.coverFlankSide = Math.random() < 0.5 ? -1 : 1;
      }
      if (!coverFlanking) g.coverFlankSide = undefined;
      // Stuck-avoidance: if a recent move got clamped by a wall, deflect the
      // approach direction perpendicularly for a short window so they slide
      // around instead of pressing into geometry.
      if (g.stuckT > 0) {
        g.stuckT -= dt;
        const side = (g.stuckSide || 1);
        // perpendicular = (-z, x)
        const nx = -approachDir.z * side;
        const nz = approachDir.x * side;
        approachDir.set(
          approachDir.x * 0.4 + nx * 0.9,
          0,
          approachDir.z * 0.4 + nz * 0.9,
        );
        if (approachDir.lengthSq() > 0.0001) approachDir.normalize();
      }

      const pref = preferredRange;
      const tol = rangeTolerance;
      let moveSign = 0;
      // Priority of navigation targets:
      //   1. door-seeking — when the player is in another room, path to
      //      the door first rather than pushing into a wall.
      //   2. escort — stand behind the shield bearer if present.
      //   3. default — circle the preferred range around the player.
      if (doorTarget) {
        const ddx = doorTarget.x - g.group.position.x;
        const ddz = doorTarget.z - g.group.position.z;
        const dd = Math.hypot(ddx, ddz);
        if (dd > 0.6) {
          approachDir.set(ddx / dd, 0, ddz / dd);
          moveSign = 1;
        } else {
          // Standing in the doorway — earlier revision stopped here
          // (moveSign = 0) and a whole squad piled up at the threshold
          // instead of crossing. Keep moving toward the player so the
          // enemy actually passes through into the next room; the path
          // cache replans shortly after and picks up the next door.
          const pdx = ctx.playerPos.x - g.group.position.x;
          const pdz = ctx.playerPos.z - g.group.position.z;
          const pdL = Math.hypot(pdx, pdz);
          if (pdL > 0.0001) {
            approachDir.set(pdx / pdL, 0, pdz / pdL);
            moveSign = 1;
          } else {
            moveSign = 0;
          }
        }
      } else if (tuckTarget) {
        // Tucked-in-corner override beats escort + range-keeping. Walk
        // until we're within 0.5m of the corner, then hold position
        // and let the bark cycle play.
        const tdx = tuckTarget.x - g.group.position.x;
        const tdz = tuckTarget.z - g.group.position.z;
        const td = Math.hypot(tdx, tdz);
        if (td > 0.5) {
          approachDir.set(tdx / td, 0, tdz / td);
          moveSign = 1;
        } else {
          moveSign = 0;
        }
      } else if (escortTarget) {
        const edx = escortTarget.x - g.group.position.x;
        const edz = escortTarget.z - g.group.position.z;
        const ed = Math.hypot(edx, edz);
        if (ed > 0.5) {
          approachDir.set(edx / ed, 0, edz / ed);
          moveSign = 1;
        } else {
          moveSign = 0;
        }
      } else {
        if (dist > pref + tol) moveSign = 1;
        else if (dist < pref - tol) moveSign = -1;
      }
      const slowK = g.slowT > 0 ? tunables.zones.legs.slowFactor : 1;

      // Strafe (dasher/coverSeeker): perpendicular sidestep while in range.
      const strafeVec = { x: 0, z: 0 };
      if (g.profile.strafe && g.state === STATE.FIRING) {
        g.strafeSwitchT -= dt;
        if (g.strafeSwitchT <= 0) {
          g.strafeDir = -g.strafeDir;
          g.strafeSwitchT = 0.4 + Math.random() * 0.9;
        }
        const perpX = -dir2d.z * g.strafeDir;
        const perpZ = dir2d.x * g.strafeDir;
        strafeVec.x = perpX * moveSpeed * 0.7;
        strafeVec.z = perpZ * moveSpeed * 0.7;
      }

      // Dash (dasher): periodic burst of speed toward a random sidestep.
      g.dashCdT = Math.max(0, (g.dashCdT ?? 0) - dt);
      if (g.profile.dash && g.state === STATE.FIRING && g.dashCdT <= 0 && g.dashT <= 0) {
        const side = Math.random() < 0.5 ? -1 : 1;
        g.dashVx = -dir2d.z * side * moveSpeed * 2.2;
        g.dashVz = dir2d.x * side * moveSpeed * 2.2;
        g.dashT = 0.25;
        g.dashCdT = 1.8 + Math.random() * 1.5;
      }
      g.dashT = Math.max(0, (g.dashT ?? 0) - dt);

      // Cover reposition — coverSeeker flees perpendicular after a burst.
      g.repositionT = Math.max(0, (g.repositionT ?? 0) - dt);

      // --- major-boss archetype overrides ---------------------------
      // Evasive Gunner — read the player's facing vector and sidestep
      // perpendicular whenever the muzzle is lined up on the boss.
      // Pauses evasion during reload (vulnerable window, with chatter).
      if (g.archetype === 'evasive' && ctx.playerFacing && g.archReloadT <= 0) {
        const toBoss = new THREE.Vector3(
          g.group.position.x - ctx.playerPos.x, 0,
          g.group.position.z - ctx.playerPos.z,
        );
        if (toBoss.lengthSq() > 0.0001) {
          toBoss.normalize();
          // Dot > 0.55 ≈ player is pointing within ~56° of the boss.
          const aimedAt = toBoss.dot(ctx.playerFacing);
          if (aimedAt > 0.55) {
            const side = g.archEvadeDir;
            g.repositionDirX = -ctx.playerFacing.z * side;
            g.repositionDirZ =  ctx.playerFacing.x * side;
            g.repositionT = 0.35;
            // Flip-flop the dodge direction periodically so the boss
            // doesn't always juke the same way.
            g.archT -= dt;
            if (g.archT <= 0) {
              g.archEvadeDir = Math.random() < 0.5 ? -1 : 1;
              g.archT = 0.7 + Math.random() * 0.9;
            }
          }
        }
      }

      // Boss / sub-boss anti-camp throwable. When the player has
      // been roughly stationary for a few seconds, lob a random
      // throwable (frag / flash / stun) at them to force movement.
      // Per-enemy 8-12s cooldown so they don't spam, and each enemy
      // skips when they've LoS (no point throwing blind unless the
      // player is camping out of sight too — handled by the "camping"
      // check independent of LoS).
      if ((g.tier === 'boss' || g.tier === 'subBoss') && ctx.isPlayerCamping
          && ctx.spawnAiThrowable) {
        g.antiCampThrowT = (g.antiCampThrowT || 0) - dt;
        if (g.antiCampThrowT <= 0 && ctx.isPlayerCamping()) {
          const baseCd = g.tier === 'boss' ? 8 : 12;
          g.antiCampThrowT = baseCd + Math.random() * 4;
          ctx.spawnAiThrowable(g);
        }
      }

      // Drone-summoner boss — handled outside the FIRING gate (above)
      // so the swarm keeps coming even if the player breaks LoS.
      // Berserker boss — HP-driven phases. Above 60% HP: patient
      // pacer (no extra speed). Below 60%: sprints (movement +40%).
      // Below 30%: rage — extra speed, lifesteal on hits, knockback
      // immunity. Punishes spam tactics; rewards burst-kill builds.
      if (g.archetype === 'berserker') {
        const hpFrac = g.maxHp > 0 ? g.hp / g.maxHp : 1;
        g._berserkPhase = hpFrac < 0.30 ? 'rage'
                        : hpFrac < 0.60 ? 'sprint'
                                        : 'patient';
        // Speed multiplier — drives the move scale via a stash field
        // the AI tick honours below for its actual locomotion. Ramps
        // up smoothly so the transition reads as commitment, not a
        // snap.
        const targetMult = g._berserkPhase === 'rage' ? 1.55
                         : g._berserkPhase === 'sprint' ? 1.40
                         : 1.0;
        g._berserkMoveMult = (g._berserkMoveMult || 1) * 0.92
                           + targetMult * 0.08;
        // Knockback immunity in rage phase — clear any incoming
        // knock velocity so they keep advancing through hits.
        if (g._berserkPhase === 'rage' && g.knockVel) {
          g.knockVel.x *= 0.0; g.knockVel.z *= 0.0;
        }
      }
      // Spawner boss — handled outside the FIRING gate (above) so the
      // necromancer keeps summoning even while the player breaks LoS.
      // Original block here was a duplicate that only ran inside the
      // ALERTED/FIRING block, which silenced the boss whenever the
      // player ducked behind cover.

      // Grenadier boss — periodically lobs a frag at the player
      // while still firing their main weapon. Cooldown shortens with
      // aggression so a level-10 grenadier throws every ~1.4s, and
      // they keep dashing on the elite cadence so they aren't easy
      // to camp. Grenades route through ctx.spawnAiGrenade so
      // projectile physics + explosion logic come from main.js.
      if (g.archetype === 'grenadier') {
        g.grenadeT = (g.grenadeT || 0) - dt;
        if (g.grenadeT <= 0 && (g.canSeePlayer || canSee) && ctx.spawnAiGrenade) {
          const baseCd = 2.4;
          g.grenadeT = baseCd / Math.max(0.5, g.aggression || 1);
          ctx.spawnAiGrenade(g);
        }
        // Borrow the elite dash cadence — grenadier should feel just
        // as twitchy. Same code path so the visuals match.
        if ((g.dashCdT || 0) <= 0 && (g.dashT || 0) <= 0
            && g.state === STATE.FIRING) {
          const side = Math.random() < 0.5 ? -1 : 1;
          g.dashVx = -dir2d.z * side * moveSpeed * 2.2;
          g.dashVz =  dir2d.x * side * moveSpeed * 2.2;
          g.dashT = 0.22;
          g.dashCdT = 1.0 + Math.random() * 0.5;
        }
      }
      // Sniper — three-phase loop. Whenever the sniper has LoS to the
      // player, paint a tracking laser for ~1.6s, then fire a slow
      // non-hitscan projectile aimed at the player's CURRENT position
      // (so reading the laser + dodging right before the shot wins).
      // Cooldown after firing keeps them from chain-bursting. They
      // also retreat if the player closes inside ~10m.
      if (g.profile.sniper && ctx.spawnSniperShot && g.alive) {
        const dxs = ctx.playerPos.x - g.group.position.x;
        const dzs = ctx.playerPos.z - g.group.position.z;
        const distSn = Math.hypot(dxs, dzs);
        const seesPlayer = canSee && hasLos && !inRearBlindspot;
        // Backup behaviour — apply a small away-from-player nudge
        // each frame when the player is too close. The normal
        // movement logic still runs, but this overlay adds a tug.
        if (seesPlayer && distSn < 10 && distSn > 0.01) {
          const ux = -dxs / distSn, uz = -dzs / distSn;
          g.group.position.x += ux * moveSpeed * 0.6 * dt;
          g.group.position.z += uz * moveSpeed * 0.6 * dt;
        }
        // Phase machine — only advances while we have LoS. Lose LoS
        // and we reset to idle so the laser doesn't paint through
        // walls.
        if (seesPlayer) {
          if (g.snipPhase === 'idle') {
            g.snipPhase = 'paint';
            g.snipPhaseT = 1.6 / Math.max(0.5, g.aggression || 1);
          }
          if (g.snipPhase === 'paint') {
            g.snipPhaseT -= dt;
            // Update laser mesh: from the gun world position to the
            // player's chest, every frame, so it tracks perfectly
            // and reads as "I am aiming at you right now."
            if (g.snipLaser) {
              const from = new THREE.Vector3();
              g.muzzle.getWorldPosition(from);
              const to = new THREE.Vector3(ctx.playerPos.x, 1.0, ctx.playerPos.z);
              const mid = from.clone().add(to).multiplyScalar(0.5);
              const len = from.distanceTo(to);
              g.snipLaser.position.copy(mid);
              g.snipLaser.lookAt(to);
              g.snipLaser.scale.set(1, 1, len);
              g.snipLaser.material.opacity = 0.55 + Math.sin(performance.now() * 0.018) * 0.2;
              g.snipLaser.visible = true;
            }
            if (g.snipPhaseT <= 0) {
              ctx.spawnSniperShot(g);
              g.snipPhase = 'cool';
              g.snipPhaseT = 2.6 / Math.max(0.5, g.aggression || 1);
              if (g.snipLaser) g.snipLaser.visible = false;
            }
          } else if (g.snipPhase === 'cool') {
            g.snipPhaseT -= dt;
            if (g.snipPhaseT <= 0) g.snipPhase = 'idle';
          }
        } else {
          // No LoS — snap back to idle, hide laser.
          g.snipPhase = 'idle';
          if (g.snipLaser) g.snipLaser.visible = false;
        }
      }

      // Flamer boss — short engagement range and zero settle pause so
      // they keep walking forward through your fire. The flamethrower
      // weapon already enforces the long reload window the player
      // exploits to land hits. Push preferred range way down so they
      // lock onto closing distance instead of camping.
      if (g.archetype === 'flamer') {
        // overwrite per-frame range goal
        g.flamerOverrideRange = 4.0;
      }

      // Elite Gunman — always strafing, always dashing on a short
      // cadence. Override dasher's passive cooldown with a faster one.
      if (g.archetype === 'elite' && g.state === STATE.FIRING) {
        if ((g.dashCdT || 0) <= 0 && (g.dashT || 0) <= 0) {
          const side = Math.random() < 0.5 ? -1 : 1;
          g.dashVx = -dir2d.z * side * moveSpeed * 2.4;
          g.dashVz =  dir2d.x * side * moveSpeed * 2.4;
          g.dashT = 0.25;
          g.dashCdT = 0.9 + Math.random() * 0.6;   // ~half the normal cd
        }
      }

      let vx = approachDir.x * moveSpeed * slowK * moveSign
        + strafeVec.x * slowK
        + (g.dashT > 0 ? g.dashVx : 0)
        + (g.repositionT > 0 ? g.repositionDirX * moveSpeed * 0.9 * slowK : 0);
      let vz = approachDir.z * moveSpeed * slowK * moveSign
        + strafeVec.z * slowK
        + (g.dashT > 0 ? g.dashVz : 0)
        + (g.repositionT > 0 ? g.repositionDirZ * moveSpeed * 0.9 * slowK : 0);
      // Whisker steering — re-aim the velocity vector around props.
      // Was every 2 frames (~30Hz), which produced visible heading
      // twitch as the AI re-deflected on every probe. Bumped to
      // every ~12 frames (~5Hz at 60fps) so the AI commits to a
      // chosen heading and sees it through. Stuck-check at the end
      // forces an immediate re-steer if the actor hasn't moved much
      // since the last check, so wall-pinned enemies recover fast.
      g._steerPhase = (g._steerPhase || 0) + 1;
      const _stuckPos = g._steerLastPos || (g._steerLastPos = { x: g.group.position.x, z: g.group.position.z });
      const _stuckDx = g.group.position.x - _stuckPos.x;
      const _stuckDz = g.group.position.z - _stuckPos.z;
      const _stuckMoved = (_stuckDx * _stuckDx + _stuckDz * _stuckDz) > 0.01;     // >0.1m
      const _steerDue = (g._steerPhase % 12) === 0 || !_stuckMoved;
      if (_steerDue) {
        _stuckPos.x = g.group.position.x;
        _stuckPos.z = g.group.position.z;
      }
      if (_steerDue && ctx.level && ctx.level.steerAround
          && g.dashT <= 0 && g.variant !== 'tank') {
        const speed = Math.hypot(vx, vz);
        if (speed > 0.05) {
          const lookAhead = Math.max(0.8, speed * 0.35);
          const steered = ctx.level.steerAround(g.group.position.x, g.group.position.z,
            vx / speed, vz / speed,
            tunables.ai.collisionRadius + 0.15, lookAhead);
          // Cache the steered direction; the off-frames reuse it so
          // the heading stays committed for ~200ms.
          g._steerDirX = steered.x;
          g._steerDirZ = steered.z;
          vx = steered.x * speed;
          vz = steered.z * speed;
        }
      } else if (g._steerDirX !== undefined) {
        const speed = Math.hypot(vx, vz);
        if (speed > 0.05) {
          vx = g._steerDirX * speed;
          vz = g._steerDirZ * speed;
        }
      }
      const nx = g.group.position.x + vx * dt;
      const nz = g.group.position.z + vz * dt;
      const beforeX = g.group.position.x, beforeZ = g.group.position.z;
      const res = ctx.resolveCollision(beforeX, beforeZ, nx, nz, tunables.ai.collisionRadius);
      g.group.position.x = res.x;
      g.group.position.z = res.z;
      // (Bosses used to be clamped to their arena bounds here. Removed
      // so they can pursue the player through doorways into adjacent
      // rooms / corridors — without it, players could stand at a
      // doorway and shoot in without ever being engaged. The boss-
      // arena door-seal was dropped at the same time so the player
      // can't get sealed in with a boss stranded out in the hall.)
      // Detect clamp: wanted to move but barely did. Tanks don't wiggle —
      // they just shove straight in until they hit the player.
      if ((moveSign !== 0 || g.dashT > 0 || g.repositionT > 0) && g.variant !== 'tank') {
        const wantedLen = Math.hypot(nx - beforeX, nz - beforeZ);
        const actualLen = Math.hypot(res.x - beforeX, res.z - beforeZ);
        if (wantedLen > 0.01 && actualLen < wantedLen * 0.3 && g.stuckT <= 0) {
          g.stuckT = 0.8;
          g.stuckSide = Math.random() < 0.5 ? -1 : 1;
        }
      }

      // Grenade / flash / stun surprise — brief freeze before the
      // ALERTED-to-FIRING transition lands, so an unalerted enemy
      // caught by a throwable reads as "startled for a second, then
      // reacts" instead of snapping straight to full combat.
      if (g.surpriseT > 0) g.surpriseT = Math.max(0, g.surpriseT - dt);
      if (g.state === STATE.ALERTED) {
        if (g.surpriseT > 0) {
          // Hold — don't drain reactionT while surprised.
        } else {
          g.reactionT -= dt;
          if (g.reactionT <= 0) {
            g.state = STATE.FIRING;
            g.fireT = 0;
            g.burstLeft = 0;
          }
        }
      }

      // Suppressive fire — a short one-second flurry toward the
      // last-seen position immediately after LoS drops, then stop.
      // Previous implementation fired indefinitely at last-known
      // which read as "enemy shooting at nothing through walls".
      let suppressing = false;
      if (!canSee && g.state === STATE.FIRING
          && typeof g.lastKnownX === 'number'
          && (g.noLosT || 0) > 0.3
          && (g.noLosT || 0) < 1.1
          && dist <= (g.weapon?.range || 0) * 1.2) {
        const mTest = g.muzzle.getWorldPosition(_g_muzzleTest);
        const aTest = _g_aimTest.set(g.lastKnownX, mTest.y, g.lastKnownZ);
        if (ctx.combat.hasLineOfSight(mTest, aTest, ctx.obstacles)) {
          suppressing = true;
        }
      }

      // Final gate: only fire when we have a clean path to the aim point.
      // For visible targets, re-check from the muzzle so close-wall cases
      // (gun poking past a corner) don't let the shot through.
      //
      // Bullet Hell boss ignores the weapon's range gate — the whole
      // point of the archetype is to zone large open arenas, so a
      // random 20m-range pistol can't lock him out of firing.
      let muzzleLos = false;
      const rangeOk = g.archetype === 'bulletHell'
        ? true
        : dist <= (g.weapon?.range || 0) * 1.2;
      if (g.state === STATE.FIRING && g.weapon && rangeOk
          && (g.dazzleT || 0) <= 0) {
        const mTest = g.muzzle.getWorldPosition(_g_muzzleTest);
        if (canSee) {
          const aTest = _g_aimTest.set(ctx.playerPos.x, mTest.y, ctx.playerPos.z);
          muzzleLos = ctx.combat.hasLineOfSight(mTest, aTest, ctx.obstacles);
        } else if (suppressing) {
          muzzleLos = true; // already validated above
        }
      }

      // AI reload gate: once the magazine hits zero, pause firing for the
      // weapon's reloadTime (lightly penalized vs player so encounters
      // still feel threatening). Blocks the firing block entirely.
      if ((g.aiReloadT || 0) > 0) {
        g.aiReloadT -= dt;
        if (g.aiReloadT <= 0) {
          g.aiReloadT = 0;
          // Restore the same cycle count used on first load so the
          // volley-then-vulnerable rhythm is preserved each reload.
          g.aiMagLeft = g.archetype === 'bulletHell' ? 6 : (g.weapon?.magSize || 30);
        }
      }

      if (muzzleLos && (g.aiReloadT || 0) <= 0) {
        g.fireT -= dt;
        if (g.fireT <= 0) {
          // Snapshot — a parry-redirect could disarm *this* gunman mid-loop
          // (hit.owner.applyHit → g.weapon = null), so we can't read from
          // g.weapon again until we're done firing this burst.
          const weapon = g.weapon;
          const muzzleWorld = g.muzzle.getWorldPosition(_g_muzzle);
          // Suppressive shots aim at the last-known spot, not the live player.
          const aim = _g_aim;
          if (suppressing) {
            aim.set(g.lastKnownX, 0, g.lastKnownZ);
          } else {
            aim.copy(ctx.playerPos);
          }
          // Aim at body center vertically; when crouched that's lower so
          // shots don't fly over the player's head.
          aim.y = ctx.playerCrouched ? 0.65 : muzzleWorld.y;
          const shotDir = _g_shotDir.subVectors(aim, muzzleWorld);
          if (shotDir.lengthSq() > 0.0001) {
            shotDir.normalize();
            const pellets = weapon.pelletCount || 1;
            // Blind / dazzle spread inflation. Stored on the gunman
            // when the tac light cone hits — magnitude is rarity-
            // scaled per attachment, replaces the old binary 2.0×.
            // Dazzle (strobe) is harsher than blind (tac light).
            const blindMul = g.dazzleT > 0 ? (g.dazzleSpreadMul || 3.0)
                          : g.blindT > 0  ? (g.blindSpreadMul  || 2.0)
                          : 1.0;
            // Crouched target = smaller silhouette; tighten spread so AI
            // actually threatens the stealthed player once spotted.
            const crouchFocus = ctx.playerCrouched ? 0.7 : 1.0;
            // Suppressive shots intentionally scatter wider and fire less
            // frequently so cover isn't a free 100% safe space.
            const suppMul = suppressing ? 2.2 : 1.0;
            let volleyCount = pellets;
            let volleySpread = weapon.hipSpread * tunables.ai.spreadMultiplier * blindMul * crouchFocus * suppMul
                             * (g.profile.aimSpreadMult ?? 1);
            let evenSpacing = false;
            // Bullet Hell boss — fires a wide, evenly-spaced fan of
            // many shots instead of a single muzzle burst. Spacing
            // is deterministic so the player reads it as a volley
            // pattern to dodge, not random spread.
            if (g.archetype === 'bulletHell') {
              // Tighter fan that actually converges on the player —
              // was 14 shots across 114° which meant a clean miss
              // most of the time regardless of aim. 7 shots across
              // ~40° gives the "barrage" read AND lands 2-3 shots
              // on a stationary player at range.
              volleyCount = 7;
              volleySpread = 0.35;
              evenSpacing = true;
            }
            for (let i = 0; i < volleyCount; i++) {
              const a = evenSpacing
                ? (volleyCount <= 1 ? 0 : ((i / (volleyCount - 1)) - 0.5) * 2 * volleySpread)
                : (Math.random() - 0.5) * 2 * volleySpread;
              const c = Math.cos(a), s = Math.sin(a);
              _g_jittered.set(
                shotDir.x * c - shotDir.z * s,
                shotDir.y,
                shotDir.x * s + shotDir.z * c,
              );
              ctx.onFireAt(muzzleWorld, _g_jittered, weapon, g.damageMult, g);
            }
            // Kick the recoil spring once per fire tick (not per pellet
            // so shotguns don't get N× the visible kick).
            if (g.rig) pokeRecoil(g.rig);
          }
          // Magazine counter — drains one per fire tick; when empty,
          // trigger reload (firing gate above will short-circuit until
          // reload completes).
          if (g.aiMagLeft === undefined) {
            // Bullet Hell gets a tight 6-shot cycle so the fight
            // becomes "dodge the volley, rush him, punish during
            // reload" — the long reload (below) is the intended
            // counterplay window.
            g.aiMagLeft = g.archetype === 'bulletHell' ? 6 : (weapon.magSize || 30);
          }
          g.aiMagLeft -= 1;
          if (g.aiMagLeft <= 0 && weapon.fireMode !== 'flame' && weapon.class !== 'flame') {
            // Evasive Gunner boss reloads slowly (5–7 s) and tells
            // the player about it — the vulnerable window is the
            // intended counterplay. Normal enemies use the baseline.
            if (g.archetype === 'evasive') {
              g.aiReloadT = 5 + Math.random() * 2;
              if (ctx.camera && g.rig) {
                const head = g.rig.head.getWorldPosition(_g_head);
                head.y += 0.55;
                const EVA_RELOAD_LINES = [
                  'Reloading!', "Wait — I'm out!",
                  "Out of ammo again?!", 'Reload, reload!',
                  'Just a sec — fresh mag!', 'Cover me!',
                ];
                spawnSpeechBubble(
                  head, ctx.camera,
                  EVA_RELOAD_LINES[Math.floor(Math.random() * EVA_RELOAD_LINES.length)],
                  2.0,
                );
              }
            } else if (g.archetype === 'bulletHell') {
              // Long, committed reload — the "rush him now" window.
              g.aiReloadT = 3.5 + Math.random() * 0.6;
            } else {
              g.aiReloadT = (weapon.reloadTime || 1.0) * 1.3;
            }
          }

          // Bullet Hell — fast volleys (~0.7s between) so the pressure
          // is constant until he reloads. Was 2-3s which felt lazy.
          if (g.archetype === 'bulletHell') {
            g.fireT = 0.55 + Math.random() * 0.30;
          }
          // Flamethrowers have fireRate=0 in tunables — pull from the
          // dedicated flameTickRate so the AI actually streams flame.
          else if (weapon.fireMode === 'flame' || weapon.class === 'flame') {
            g.fireT = 1 / Math.max(1, weapon.flameTickRate || 12);
          } else if (weapon.burstCount > 1) {
            // Per-weapon burst cadence (e.g. rifle burst of 3) uses burstLeft.
            if (g.burstLeft <= 0) g.burstLeft = weapon.burstCount;
            g.burstLeft -= 1;
            g.fireT = g.burstLeft > 0
              ? (weapon.burstInterval || 0.07)
              : 1 / Math.max(0.1, weapon.fireRate);
          } else {
            g.fireT = 1 / Math.max(0.1, weapon.fireRate);
          }
          // Large bosses fire on a tighter cadence than a grunt with
          // the same weapon — compressing the gap between shots is the
          // main knob for "this fight feels relentless". bulletHell is
          // excluded because its volley pacing is the fight's rhythm.
          if (g.tier === 'boss' && g.archetype !== 'bulletHell') {
            g.fireT *= 0.55;
          } else if (g.tier === 'subBoss') {
            g.fireT *= 0.80;
          }
          // AI firing discipline: every 3-5 shots take a settle pause so
          // bloom doesn't balloon forever and the player gets a window to
          // reposition. Dashers and tanks skip the pause — they're meant to
          // feel relentless.
          if (g.aiShotsThisBurst === undefined) g.aiShotsThisBurst = 0;
          if (g.aiBurstLimit === undefined) g.aiBurstLimit = 3 + Math.floor(Math.random() * 3);
          g.aiShotsThisBurst += 1;
          if (g.aiShotsThisBurst >= g.aiBurstLimit && g.burstLeft <= 0) {
            g.aiShotsThisBurst = 0;
            g.aiBurstLimit = 3 + Math.floor(Math.random() * 3);
            if (g.profile.settlePause) {
              const settle = 0.7 + Math.random() * 0.8;
              g.aiSettleT = settle;
              g.aiSettleDur = settle;
              g.fireT += settle;
            }
            // Cover-seekers break contact between bursts. Try to find
            // an actual prop / column to tuck behind; fall back to a
            // blind perpendicular dart if there's nothing nearby.
            if (g.profile.coverSeek) {
              let coverDirX = 0, coverDirZ = 0;
              if (ctx.level && ctx.level.findCoverNear && ctx.playerPos) {
                const spot = ctx.level.findCoverNear(g.group.position, ctx.playerPos, 8);
                if (spot) {
                  const dxc = spot.x - g.group.position.x;
                  const dzc = spot.z - g.group.position.z;
                  const dl = Math.hypot(dxc, dzc);
                  if (dl > 0.001) { coverDirX = dxc / dl; coverDirZ = dzc / dl; }
                }
              }
              if (coverDirX === 0 && coverDirZ === 0) {
                const side = Math.random() < 0.5 ? -1 : 1;
                coverDirX = -dir2d.z * side;
                coverDirZ = dir2d.x * side;
              }
              g.repositionDirX = coverDirX;
              g.repositionDirZ = coverDirZ;
              g.repositionT = 1.0 + Math.random() * 0.7;
            }
          }
        }
      }
    }
  }
}
