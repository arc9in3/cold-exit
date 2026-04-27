// 3D model manifest — maps items to .fbx files extracted from the animpic
// POLY packs via tools/unity_to_gltf.py. Three.js loads .fbx natively via
// FBXLoader (wired in src/gltf_cache.js).
//
// Resolution order mirrors iconForItem in inventory.js:
//   per-name override > per-id override > per-type fallback > null
// Falling through returns null, which tells loot.js to keep the primitive
// box placeholder.
//
// To add a new model: drop the .fbx under Assets/models/<category>/,
// then add one line to the appropriate table. No other code changes.

const MODEL_BASE = 'Assets/models/';

// Per-weapon-name model override. Exact match against `item.name` on
// ranged/melee weapons. Names come from tunables.weapons[*].name.
// Lowpoly entries are tagged matches from the user's weapon_assigner
// session — see Assets/Weapons/weapon_assignments.json for the audit.
export const MODEL_BY_WEAPON_NAME = {
  // Pistols
  'Makarov':            'weapons/SM_Civilian_Pistol.fbx',
  'Glock 17':           'weapons/SM_Army_Pistol.fbx',
  'M1911':              'weapons/SM_Police_Gun.fbx',
  'Desert Eagle .50':   'weapons/SM_Hunting_Pistol.fbx',
  'Colt Anaconda .44':  'lowpolyguns/Revolver_5.fbx',           // user: colt six shooter (.44 visual)
  'Colt Python':        'lowpolyguns/Revolver_3.fbx',
  'Colt 357':           'lowpolyguns/Revolver_1.fbx',
  '.38 Special':        'lowpolyguns/Revolver_4.fbx',
  'Colt Six Shooter':   'lowpolyguns/Revolver_5.fbx',

  // SMGs
  'PDW':                'weapons/SM_Civilian_Submachine_Gun.fbx',
  'P90':                'weapons/SM_Police_Submachine_Gun.fbx',
  'UMP45':              'weapons/SM_Army_Submachine_Gun.fbx',
  'Spectre':            'lowpolyguns/SubmachineGun_2.fbx',
  'Spectre CQB':        'lowpolyguns/SubmachineGun_1.fbx',
  'SPC9':               'lowpolyguns/SubmachineGun_3.fbx',
  'SPCA3':              'lowpolyguns/SubmachineGun_4.fbx',          // SIG SPC AR-style 9mm
  'SPC223':             'lowpolyguns/SubmachineGun_5.fbx',          // SIG SPC .223 carbine

  // Rifles
  'AK47':               'lowpolyguns/AssaultRifle_2.fbx',
  'AKS-47':             'lowpolyguns/AssaultRifle_3.fbx',         // folding-stock AK47 sibling
  'AKS-74':             'lowpolyguns/AssaultRifle_4.fbx',
  'AK104':              'lowpolyguns/AssaultRifle_5.fbx',
  'Draco NAK9':         'lowpolyguns/AssaultRifle_1.fbx',         // 9mm AK-pattern compact
  'AS VAL':             'weapons/SM_Assault_Rifle_9x39.fbx',
  'VSS':                'weapons/SM_Police_Sniper_Rifle.fbx',     // user-tagged FBX = "VSS vintorez"
  'M16':                'weapons/Assault_Rifle_5_56_Prototype.fbx',
  'M4':                 'lowpolyguns/AssaultRifle2_2.fbx',         // Apr-26: re-introduced with proper FBX
  'AR-15 SBR':          'lowpolyguns/AssaultRifle2_4.fbx',         // short-barrel AR-15
  'AR-15 Pistol':       'lowpolyguns/AssaultRifle2_3.fbx',         // AR pistol — pistol class for size
  'AUG A3-CQC':         'weapons/SM_Bulpam_Assault_Rifle.fbx',
  'CAR-15':             'lowpolyguns/AssaultRifle2_1.fbx',
  'JARD J67':           'lowpolyguns/Bullpup_2.fbx',
  'JARD J68':           'lowpolyguns/Bullpup_1.fbx',
  'JARD J56':           'lowpolyguns/Bullpup_3.fbx',

  // LMGs
  'Type 80 LMG':        'weapons/SM_Heavy_Machine_Gun.fbx',
  'M249':               'weapons/SM_Light_Machine_Gun.fbx',

  // Snipers
  // Apr-26: Remington 700's art swapped to the user-tagged
  // SniperRifle_1 FBX. Tactical chassis variant added as a sibling.
  'Remington 700':      'lowpolyguns/SniperRifle_1.fbx',
  'Remington 700 Tactical': 'lowpolyguns/SniperRifle_2.fbx',
  'SVD Dragunov':       'weapons/SM_Army_Sniper_Rifle.fbx',
  'Cheytac Intervention':'weapons/SM_High_Precision_Sniper_Rifle.fbx',
  'AWP':                'lowpolyguns/SniperRifle_3.fbx',
  '.338 Lapua':         'lowpolyguns/SniperRifle_5.fbx',
  'Hunting Rifle':      'lowpolyguns/SniperRifle_6.fbx',

  // Shotguns
  'AA-12':              'weapons/SM_Assault_Shotgun.fbx',
  'Benelli M4':         'weapons/SM_Army_Shotgun.fbx',
  'Mossberg 500':       'lowpolyguns/Shotgun_1.fbx',
  'Remington 870':      'lowpolyguns/Shotgun_3.fbx',
  'Sawed-Off Shotgun':  'lowpolyguns/Shotgun_SawedOff.fbx',
  'KSG-12':             'weapons/Modern_Pump_Action_Shotgun.fbx',
  // Henry single-shot 12-gauge slug rifle. Class: shotgun (slug).
  'Henry Slug Rifle':   'lowpolyguns/Shotgun_4.fbx',

  // Exotic
  'Widowmaker Rocket Launcher': 'weapons/SM_Rocket_Launchers_01.fbx',

  // Legendary artifact pistol.
  "Jessica's Rage":     'weapons/SM_Hunting_Pistol.fbx',

  // SMGs (cont.)
  'Kriss Vector':       'weapons/SM_Tactical_Submachine_Gun.fbx',

  // Melee.
  // Combat Knife: per the Apr-26 dupe rule, the Bayonet_2 FBX tagged
  // "combat knife" supersedes the older SM_Combat_Knife model.
  'Combat Knife':       'lowpolyguns_accessories/Bayonet_2.fbx',
  'Survival Knife':     'lowpolyguns_accessories/Bayonet.fbx',
  'Pocket Knife':       'weapons/SM_Flick_Knife.fbx',
  'Hammer':             'melee/SM_Hammer.fbx',
  'Baseball Bat':       'melee/SM_Baseball_bat_Nails_reinforced_.fbx',
  'katana':             'melee/SM_Katana.fbx',
  'Brass Knuckles':     'melee/SM_Brass_Knuckles_02.fbx',
  'Crowbar':            'melee/SM_Tire_iron.fbx',
  'Kukri':              'weapons/SM_Kukri.fbx',
  'Tomahawk':           'weapons/SM_Combat_Axe.fbx',
  'Fire Axe':           'melee/SM_Fire_Axe.fbx',
  'Sledgehammer':       'tools/SM_Sledgehammer.fbx',
  'Chainsaw':           'tools/SM_Chainsaw.fbx',
  'Scimitar':           'melee/SM_Handcrafted_Curved_Sword.fbx',

  // Mythic kept around (Dragonbreath has no in-class shotgun model
  // distinct from the others; reuse Benelli silhouette).
  'Dragonbreath':       'weapons/SM_Army_Shotgun.fbx',
};

// Per-item-id override — consumables, armor pieces, junk — anything with a
// stable id. Keys line up with CONSUMABLE_DEFS / ARMOR_DEFS / GEAR_DEFS /
// JUNK_DEFS in inventory.js.
export const MODEL_BY_ITEM_ID = {
  // Consumables — medical pack coverage.
  cons_bandage:      'medical/SM_Bandage.fbx',
  cons_pain:         'medical/SM_Bottle_Of_Pills_Painkiller.fbx',
  cons_splint:       'medical/SM_Bandage.fbx',
  cons_medkit:       'medical/SM_Car_First_Aid_Kit.fbx',
  cons_trauma:       'medical/SM_Blood_Bag.fbx',
  cons_adrenaline:   'medical/SM_Ampoule_With_Solution_01.fbx',
  cons_combat_stim:  'medical/SM_Ampoule_With_Solution_02.fbx',
  cons_energy:       'medical/SM_Bottle_Of_Pills_Syrup.fbx',
  cons_tourniquet:   'medical/SM_Tourniquet.fbx',
  cons_afak:         'medical/SM_INDIVIDUAL_TACTICAL_AID_KIT.fbx',
  cons_defib:        'medical/SM_Defibrillator.fbx',
  cons_morphine:     'medical/SM_Injector_With_Morphine.fbx',
  cons_regen:        'medical/SM_Injector_With_Regeneration.fbx',
  junk_carbatt:      'tools/SM_Car_Battery.fbx',
  junk_scrap:        'tools/SM_Scrap_Metal_02.fbx',
  // Throwables — user-tagged per the Apr 2026 weapon-assigner pass.
  thr_frag:          'weapons/SM_Frag_Grenade.fbx',
  thr_flash:         'weapons/SM_Stun_Grenade.fbx',     // user-tagged "flashbang"
  thr_stun:          'weapons/SM_Stun_Grenade.fbx',
  thr_molotov:       'weapons/SM_Molotov_02.fbx',
  thr_maotai:        'weapons/SM_Molotov_01.fbx',     // Maotai-bottle variant
  thr_claymore:      'weapons/SM_Infantry_Mine.fbx',
  thr_elven_knife:   'weapons/SM_Throwing_Knife.fbx',

  // Attachments — user-tagged FBXes from the Apr 2026 pass. Mapping
  // reads attachment.id to FBX path; the inventory grid + customize
  // screen render the same model.
  // -- Muzzle: comps / brakes / flash hiders
  att_compensator:        'weapons/SM_Compensator_For_Large_Caliber_Sniper_Rifle.fbx',
  att_brake_a2:           'weapons/SM_Muzzle_Brake_Compensator_01.fbx',
  att_brake_ak:           'weapons/SM_Muzzle_Brake_Compensator_03.fbx',
  att_brake_sniper:       'weapons/SM_Muzzle_Brake_Compensator_02.fbx',
  att_comp_linear:        'weapons/SM_Muzzle_Brake_Compensator_05.fbx',
  att_flash_hider:        'weapons/SM_Muzzle_Brake_Compensator_06.fbx',
  att_flash_hider_long:   'weapons/SM_Muzzle_Brake_Compensator_07.fbx',
  // -- Muzzle: suppressors (lowpoly + animpic)
  att_suppressor:         'lowpolyguns_accessories/Silencer_1.fbx',
  att_suppressor_short:   'lowpolyguns_accessories/Silencer_Short.fbx',
  att_suppressor_long:    'lowpolyguns_accessories/Silencer_long.fbx',
  att_suppressor_qd:      'lowpolyguns_accessories/Silencer_2.fbx',
  att_suppressor_fluted:  'lowpolyguns_accessories/Silencer_3.fbx',
  att_suppressor_osprey:  'weapons/SM_Muffler_04.fbx',
  att_suppressor_tactical:'weapons/SM_Muffler_05.fbx',
  // -- Side rail
  att_laser:              'weapons/SM_Tactical_Laser_Designator.fbx',
  att_laser_red:          'weapons/SM_Tactical_Laser_Designator.fbx',
  att_laser_green:        'weapons/SM_Tactical_Laser_Designator.fbx',
  att_laser_blue:         'weapons/SM_Tactical_Laser_Designator.fbx',
  att_laser_pistol:       'weapons/SM_Tactical_Laser_Designator.fbx',
  att_flashlight:         'weapons/SM_Tactical_Flashlight_01.fbx',
  att_tac_light:          'weapons/SM_Tactical_Flashlight_03.fbx',
  att_strobe:             'weapons/SM_Tactical_Flashlight_02.fbx',
  // -- Under rail (foregrips / bipod)
  att_foregrip:           'weapons/SM_Vertical_Handle_01.fbx',
  att_foregrip_angled:    'weapons/SM_Horizontal_Handle_01.fbx',
  att_foregrip_stubby:    'lowpolyguns_accessories/Grip.fbx',
  att_grip_canted:        'weapons/SM_Side_Handle.fbx',
  att_bipod:              'weapons/SM_Bipod__ForHigh_Precision_Sniper_Rifle.fbx',
  // -- Top rail (sights)
  att_reddot:             'weapons/SM_Cylindrical_Collimator_Sight.fbx',
  att_reflex:             'weapons/SM_Square_Dot_Sight.fbx',
  att_holo:               'weapons/SM_Optical_Sight_01.fbx',
  att_scope:              'lowpolyguns_accessories/Scope_2.fbx',
  att_long_scope:         'lowpolyguns_accessories/Scope_3.fbx',
  // Apr-26 EOD batch — extra sight + side-rail variants. Names
  // distinguish 'Amazon Special' (cheap), 'Prism' (etched-glass),
  // 'UH-1' (premium holo), 'PSO' (Soviet 4×).
  att_reddot_amazon:      'weapons/SM_Cylindrical_Collimator_Sight.fbx',
  att_prism:              'weapons/SM_Optical_Sight_01.fbx',
  att_holo_uh1:           'weapons/SM_Square_Dot_Sight.fbx',
  att_scope_pso:          'weapons/SM_Scope_For_Police_Sniper_Rifle.fbx',
  att_peq15:              'weapons/SM_Tactical_Block.fbx',
  // -- Stock
  att_stock_heavy:        'weapons/SM_Wooden_Butt_01.fbx',
  att_stock_skeleton:     'lowpolyguns_accessories/Stock.fbx',
  att_stock_cqb:          'weapons/SM_Butt_Of_The_Rifle_For_Special_Submachine_Gun_Clean.fbx',
  att_stock_folding:      'weapons/SM_Telescopic_Stock.fbx',
  att_stock_crane:        'weapons/SM_Telescopic_Universal_Butt_01.fbx',
  // -- Grip (pistol grip)
  att_grip_match:         'weapons/SM_Pistol_Grip_Prototype.fbx',
  att_grip_stippled:      'weapons/SM_Pistol_Grip_01_5_45.fbx',
  att_grip_skeleton:      'weapons/SM_Polymer_Handle.fbx',
  att_grip_rubberized:    'weapons/SM_Pistol_Grip_01_5_56.fbx',
  // -- Magazine
  att_mag_extended:       'weapons/SM_Larfe_For_Assault_Rifle_5_56.fbx',
  att_mag_drum:           'weapons/SM_Large_Magazine_For_Assault_Rifle_5_45.fbx',
  att_mag_banana:         'weapons/SM_Paired_For_Assault_Rifle_5_45.fbx',
  att_mag_fast:           'weapons/SM_Magazine__For_Bulpam_Assault_Rifle.fbx',
  att_mag_lmg_box:        'weapons/SM_Cartridge_Box_For_Light_Machine_Gun.fbx',
  att_mag_hmg_box:        'weapons/SM_Cartridge_Box_For_Heavy_Machine_Gun.fbx',
};

// Per-type fallback — coarse category model when no name/id override
// exists. Intentionally sparse so missing-model items stay visibly
// primitive (a reminder to fill them in), not silently wrong.
export const MODEL_BY_TYPE = {
  // Intentionally empty. Populate selectively if you want every item of
  // a type to get a generic 3D model regardless of specificity.
};

// Per-FBX grip offset + rotation override. fitToRadius centers each
// model's bounding box at the hand, but some weapons have their grip
// offset from that centroid (a long buttstock skews the centroid away
// from the pistol grip) or are authored with a barrel axis that
// doesn't match the game's default (barrel along +Z after a +π/2 yaw).
//
// Use `window.__debug.tuneWeapon(...)` to adjust live, then copy the
// values into this table. Values are in inHandModel-local units (same
// scale as clone.position) and radians for rotation.
//
// Key = FBX path relative to Assets/models/ (same form as the tables
// above, exactly as returned by modelForItem).
export const MODEL_GRIP_OFFSET = {
  // SMG lineup — the fitToRadius pass centres the mesh's bounding
  // box at the hand, but animpic SMG meshes all have their pistol
  // grip well behind the bbox centre (long receiver + barrel push
  // the centroid forward of where the hand ought to sit). Negative
  // Z pulls the mesh back toward the wrist so the hand lands on the
  // grip instead of the buttstock. Values are in inHandModel-local
  // units; use `__debug.tuneWeapon` to dial any of these in live
  // and copy the numbers back here.
  // Convention established empirically: NEGATIVE Z pulls the mesh
  // forward along the weapon's long axis (moving the muzzle past
  // the hand), which lands the grip (behind the bbox center for
  // every SMG in this set) at the hand. Positive flipped the
  // whole gun backward and the flip read as "muzzle pointing at
  // the shooter" on the MP7. Earlier negative values (−0.14 to
  // −0.20) weren't aggressive enough — bumping to around −0.32
  // to clearly seat the grip.
  'weapons/SM_Civilian_Submachine_Gun.fbx': { x: 0, y: 0, z: -0.32 },   // PDW / generic SMG (shared w/ MP7)
  'weapons/SM_Army_Submachine_Gun.fbx':     { x: 0, y: 0, z: -0.30 },   // AKS-74U
  'weapons/SM_Police_Submachine_Gun.fbx':   { x: 0, y: 0, z: -0.38 },   // P90 (bullpup — need deeper push)
  'weapons/SM_Special_Submachine_Gun.fbx':       { x: 0, y: 0, z: -0.28 },   // MP7 fallback
  'weapons/SM_Special_Submachine_Gun_Clean.fbx': { x: 0, y: 0, z: -0.28 },   // MP7 active mesh
  'weapons/SM_Tactical_Submachine_Gun.fbx': { x: 0, y: 0, z: -0.30 },   // Vector
  // Lowpolyguns SMG variants — same negative-Z convention to pull
  // the grip into the hand (otherwise held by the stock end).
  'lowpolyguns/SubmachineGun_1.fbx':         { x: 0, y: 0, z: -0.30 },  // Spectre CQB
  'lowpolyguns/SubmachineGun_2.fbx':         { x: 0, y: 0, z: -0.30 },  // Spectre
  'lowpolyguns/SubmachineGun_3.fbx':         { x: 0, y: 0, z: -0.30 },  // SPC9
  'lowpolyguns/SubmachineGun_4.fbx':         { x: 0, y: 0, z: -0.30 },  // SPCA3
  'lowpolyguns/SubmachineGun_5.fbx':         { x: 0, y: 0, z: -0.30 },  // SPC223
  // Melee — handle is at one end of the mesh, but fitToRadius
  // centres the bbox at the hand, so the handle ends up ~half the
  // mesh length away. Negative Z shifts the model back so the grip
  // lands on the hand. Use `__debug.tuneWeapon(...)` live to refine.
  'melee/SM_Tire_iron.fbx':                    { x: 0, y: 0, z: -0.28 },  // crowbar
  'melee/SM_Baseball_bat_Nails_reinforced_.fbx': { x: 0, y: 0, z: -0.32 },
  'melee/SM_Katana.fbx':                       { x: 0, y: 0, z: -0.30 },
  'melee/SM_Fire_Axe.fbx':                     { x: 0, y: 0, z: -0.26 },
  'melee/SM_Hammer.fbx':                       { x: 0, y: 0, z: -0.20 },  // club
  'melee/SM_Combat_Knife.fbx':                 { x: 0, y: 0, z: -0.10 },
};

export const MODEL_ROTATION_OVERRIDE = {
  // Key -> { x, y, z } in radians. Replaces the default (0, π/2, 0).
};

// In-hand mirror rule, by FBX source pack. The lowpolyguns.zip pack
// authors every weapon mesh muzzle-on-+X — under the default in-hand
// yaw of +π/2, that points the muzzle along world -Z (backward). So
// every lowpoly weapon needs scale.x = -1 in-hand. The animpic POLY
// weapons pack (weapons/*) authors muzzle-on-(-X) — the default
// yaw already points it +Z (forward), no mirror needed.
//
// This is an INDEPENDENT axis from the user's MIRROR_X_BY_NAME list
// (which captures PNG / UI orientation per the user's manual tool
// toggle). The pack rule for in-hand is uniform per pack and
// doesn't need per-weapon exceptions.
const IN_HAND_MIRROR_PACK_PREFIXES = [
  'lowpolyguns/',
  'lowpolyguns_accessories/',
];
export function shouldMirrorInHand(item) {
  if (!item) return false;
  const path = MODEL_BY_WEAPON_NAME[item.baseName || item.name];
  if (!path) return false;
  return IN_HAND_MIRROR_PACK_PREFIXES.some(p => path.startsWith(p));
}

export function gripOffsetForModelPath(fullPath) {
  if (!fullPath) return null;
  const key = fullPath.startsWith(MODEL_BASE) ? fullPath.slice(MODEL_BASE.length) : fullPath;
  return MODEL_GRIP_OFFSET[key] || null;
}

export function rotationOverrideForModelPath(fullPath) {
  if (!fullPath) return null;
  const key = fullPath.startsWith(MODEL_BASE) ? fullPath.slice(MODEL_BASE.length) : fullPath;
  return MODEL_ROTATION_OVERRIDE[key] || null;
}

// Per-pack relative size correction. fitToRadius normalizes meshes to
// a class-typical radius, but the animpic and lowpolyguns packs were
// authored with different baseline scales — animpic weapons end up
// visibly larger in-hand than lowpoly weapons even after fit. The
// per-pack multiplier adjusts the post-fit scale.
//
// Per-FBX overrides (MODEL_SCALE_OVERRIDE) win when present — used
// for outliers within a pack (Makarov is too big even by animpic
// standards; P90 is a tad small).
const PACK_SCALE_DEFAULTS = {
  'weapons/':                 0.85,   // animpic POLY weapons — slightly small
  'lowpolyguns/':             1.00,   // baseline reference
  'lowpolyguns_accessories/': 1.00,
  'melee/':                   0.95,   // animpic POLY melee
  'tools/':                   1.00,
};
export const MODEL_SCALE_OVERRIDE = {
  // Outliers within a pack — these win over PACK_SCALE_DEFAULTS.
  'weapons/SM_Civilian_Pistol.fbx':         0.55,  // Makarov — was way too big
  'weapons/SM_Police_Submachine_Gun.fbx':   1.10,  // P90 — was a tad small
};
export function scaleForModelPath(fullPath) {
  if (!fullPath) return 1.0;
  const key = fullPath.startsWith(MODEL_BASE) ? fullPath.slice(MODEL_BASE.length) : fullPath;
  if (MODEL_SCALE_OVERRIDE[key] != null) return MODEL_SCALE_OVERRIDE[key];
  for (const prefix of Object.keys(PACK_SCALE_DEFAULTS)) {
    if (key.startsWith(prefix)) return PACK_SCALE_DEFAULTS[prefix];
  }
  return 1.0;
}

// Per-weapon-name PNG render — drives both the inventory icon AND
// the attachment screen schematic so the player sees the same
// silhouette everywhere. Generated by tools/weapon_assigner.html
// 'Export side-view PNGs' and dropped into Assets/UI/weapon_renders/.
// Filenames are sanitized weapon names ([^A-Za-z0-9_-] -> '_').
//
// When a weapon name is in this table, iconForItem returns the
// render path and layoutForWeapon embeds it as an <image> in the
// attachment screen instead of the procedural class silhouette.
const RENDER_BASE = 'Assets/UI/weapon_renders/';
// Each key is the canonical in-game weapon name; value is the PNG
// filename in Assets/UI/weapon_renders/. Most renders predate the
// rename pass — values like 'Glock.png' map to the renamed
// 'Glock 17' weapon. New weapons added from the lowpolyguns pack
// don't have renders yet and fall through to the icon fallback
// (re-run tools/weapon_assigner.html → 'Export side-view PNGs' to
// generate them).
export const WEAPON_RENDER_BY_NAME = {
  // Pistols
  'Makarov':                'Makarov.png',
  'Glock 17':               'Glock_17.png',
  'M1911':                  'M1911.png',
  'Desert Eagle .50':       'Desert_Eagle_50.png',
  'Colt Anaconda .44':      'Colt_Anaconda_44.png',
  'Colt Python':            'Colt_Python.png',
  'Colt 357':               'Colt_357.png',
  '.38 Special':            '_38_Special.png',
  'Colt Six Shooter':       'Colt_Six_Shooter.png',

  // SMGs
  'PDW':                    'PDW.png',
  'P90':                    'P90.png',
  'UMP45':                  'UMP45.png',
  'Spectre':                'Spectre.png',
  'Spectre CQB':            'Spectre_CQB.png',
  'SPC9':                   'SPC9.png',

  // Rifles
  'AK47':                   'AK47.png',
  'AKS-74':                 'AKS-74.png',
  'AK104':                  'AK104.png',
  'AS VAL':                 'AS_VAL.png',
  'VSS':                    'VSS.png',
  'M16':                    'M16.png',
  'AUG A3-CQC':             'AUG_A3-CQC.png',
  'CAR-15':                 'CAR-15.png',
  'JARD J67':               'JARD_J67.png',

  // LMGs
  'Type 80 LMG':            'Type_80_LMG.png',
  'M249':                   'M249.png',

  // Snipers
  'Remington 700':          'Remington_700.png',
  'SVD Dragunov':           'SVD_Dragunov.png',
  'Cheytac Intervention':   'Cheytac_Intervention.png',
  'AWP':                    'AWP.png',
  '.338 Lapua':             '_338_Lapua.png',
  'Hunting Rifle':          'Hunting_Rifle.png',

  // Shotguns
  'AA-12':                  'AA-12.png',
  'Benelli M4':             'Benelli_M4.png',
  'Mossberg 500':           'Mossberg_500.png',
  'Remington 870':          'Remington_870.png',
  'Sawed-Off Shotgun':      'Sawed-Off_Shotgun.png',
  'KSG-12':                 'KSG-12.png',

  // Exotic / mythic
  'Widowmaker Rocket Launcher': 'Widowmaker_Rocket_Launcher.png',
  'Dragonbreath':           'Dragonbreath.png',

  // Legendary artifact
  "Jessica's Rage":         'Jessica_s_Rage.png',

  // Melee
  'Combat Knife':           'Combat_Knife.png',
  'Hammer':                 'Hammer.png',
  'Baseball Bat':           'Baseball_Bat.png',
  'katana':                 'katana.png',
  'Brass Knuckles':         'Brass_Knuckles.png',
  'Crowbar':                'Crowbar.png',
  'Kukri':                  'Kukri.png',
  'Tomahawk':               'Tomahawk.png',
  'Fire Axe':               'Fire_Axe.png',
  'Sledgehammer':           'Sledgehammer.png',
  'Chainsaw':               'Chainsaw.png',
  'Scimitar':               'Scimitar.png',
};
export function renderForWeaponName(name) {
  if (!name) return null;
  const f = WEAPON_RENDER_BY_NAME[name];
  return f ? RENDER_BASE + f : null;
}
// Wrapper that prefers item.baseName (the original tunable name)
// over item.name (which carries the rarity / mastercraft prefixes
// like 'Refined Benelli M4'). Use this for any lookup keyed by a
// canonical weapon identity instead of touching the raw map.
export function renderForWeapon(item) {
  if (!item) return null;
  return renderForWeaponName(item.baseName || item.name);
}

// All in-game weapons currently have side-view PNG renders — see
// WEAPON_RENDER_BY_NAME above. To add a new weapon:
//   1) drop a side-view PNG into Assets/UI/weapon_renders/
//   2) add an entry to WEAPON_RENDER_BY_NAME mapping name -> filename
// The tool at tools/weapon_assigner.html exports the renders in a zip
// and the filename convention is sanitized weapon name + .png.

// ---------------------------------------------------------------
// Hand-pose defaults per weapon class. Fractions of the side-view
// render canvas (0..1, origin top-left). Authored from typical
// silhouette positions on the 16:9 export — main hand lands on the
// trigger; support hand lands on the foregrip / handguard; shoulder
// lands at the buttstock end. Pistols share the support-hand
// position with the main hand to read as a two-handed grip.
//
// Per-weapon overrides go in WEAPON_POSE_BY_NAME below — author
// those interactively via tools/weapon_assigner.html (click any
// model preview → drag the colored markers → 'Export all poses').
// ---------------------------------------------------------------
export const POSE_BY_CLASS = {
  pistol:  { mainHand: { x: 0.49, y: 0.62 }, supportHand: { x: 0.49, y: 0.62 } },
  smg:     { mainHand: { x: 0.46, y: 0.62 }, supportHand: { x: 0.62, y: 0.61 }, shoulder: { x: 0.30, y: 0.55 } },
  rifle:   { mainHand: { x: 0.42, y: 0.62 }, supportHand: { x: 0.66, y: 0.62 }, shoulder: { x: 0.18, y: 0.55 } },
  shotgun: { mainHand: { x: 0.42, y: 0.62 }, supportHand: { x: 0.66, y: 0.62 }, shoulder: { x: 0.18, y: 0.55 } },
  sniper:  { mainHand: { x: 0.45, y: 0.62 }, supportHand: { x: 0.70, y: 0.62 }, shoulder: { x: 0.18, y: 0.55 } },
  lmg:     { mainHand: { x: 0.45, y: 0.62 }, supportHand: { x: 0.65, y: 0.62 }, shoulder: { x: 0.20, y: 0.55 } },
  exotic:  { mainHand: { x: 0.42, y: 0.62 }, supportHand: { x: 0.66, y: 0.62 }, shoulder: { x: 0.18, y: 0.55 } },
  melee:   { mainHand: { x: 0.32, y: 0.62 } },
};

// Per-weapon overrides. Empty until authored via the pose modal.
export const WEAPON_POSE_BY_NAME = {
};

export function poseForWeapon(weapon) {
  if (!weapon) return null;
  const override = WEAPON_POSE_BY_NAME[weapon.name];
  if (override) return override;
  const klass = weapon.class || (weapon.type === 'melee' ? 'melee' : 'pistol');
  return POSE_BY_CLASS[klass] || POSE_BY_CLASS.pistol;
}

// Weapons whose FBX is authored with the muzzle on +X — these need
// scale.x = -1 to render correctly muzzle-LEFT in side-view exports
// AND to point muzzle FORWARD when held in-game (the default in-hand
// yaw of π/2 assumes muzzle-on-(-X)). Populated from the user's
// 'Copy mirror list' export from tools/weapon_assigner.html. 43/56
// weapons after the Apr-26 batch — the tool's vertex-count heuristic
// guesses wrong on most lowpoly + animpic FBXes.
export const MIRROR_X_BY_NAME = new Set([
  '.338 Lapua', '.38 Special', 'AA-12', 'AK104', 'AK47', 'AKS-74',
  'AS VAL', 'AUG A3-CQC', 'AWP', 'Benelli M4', 'CAR-15', 'Chainsaw',
  'Cheytac Intervention', 'Colt 357', 'Colt Anaconda .44',
  'Colt Python', 'Colt Six Shooter', 'Combat Knife', 'Desert Eagle .50',
  'Dragonbreath', 'Glock 17', 'Hunting Rifle', 'JARD J67',
  "Jessica's Rage", 'KSG-12', 'Kriss Vector', 'Kukri', 'M16', 'M1911',
  'M249', 'Mossberg 500', 'PDW', 'Remington 700', 'Remington 870',
  'SPC9', 'Sawed-Off Shotgun', 'Spectre', 'Spectre CQB',
  'Survival Knife', 'Tomahawk', 'Type 80 LMG', 'UMP45', 'VSS',
]);
export function shouldMirrorWeapon(item) {
  if (!item) return false;
  return MIRROR_X_BY_NAME.has(item.baseName || item.name);
}

export function modelForItem(item) {
  if (!item) return null;
  if (item.model) return item.model;  // callers can override inline

  if (item.type === 'ranged' || item.type === 'melee') {
    // Prefer baseName (the original tunable name) so rarity / master-
    // craft prefixes don't break the lookup ('Refined Benelli M4'
    // still resolves the Benelli M4 FBX).
    const lookupName = item.baseName || item.name;
    if (lookupName) {
      const byName = MODEL_BY_WEAPON_NAME[lookupName];
      if (byName) return MODEL_BASE + byName;
    }
  }
  if (item.id) {
    const byId = MODEL_BY_ITEM_ID[item.id];
    if (byId) return MODEL_BASE + byId;
  }
  if (item.type) {
    const byType = MODEL_BY_TYPE[item.type];
    if (byType) return MODEL_BASE + byType;
  }
  return null;
}
