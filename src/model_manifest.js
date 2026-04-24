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

// Per-weapon-name override. Exact match against `item.name` on ranged/melee
// weapons. These names come from tunables.weapons[*].name.
export const MODEL_BY_WEAPON_NAME = {
  // Generic class weapons (the first of each class in tunables).
  'pistol':          'weapons/SM_Civilian_Pistol.fbx',
  'smg':             'weapons/SM_Civilian_Submachine_Gun.fbx',
  'shotgun':         'weapons/SM_Army_Shotgun.fbx',
  'rifle':           'weapons/SM_Assault_Rifle_5_56.fbx',
  'lmg':             'weapons/SM_Light_Machine_Gun.fbx',
  'flamethrower':    'weapons/SM_Rocket_Launchers_01.fbx',  // no flame model; rocket launcher silhouette

  // Pistols. Identities confirmed against user's model_annotations.
  'Glock':           'weapons/SM_Army_Pistol.fbx',         // user: glock 17
  'Sig P320':        'weapons/SM_Civilian_Pistol.fbx',     // shares Makarov visual
  'Beretta 92':      'weapons/SM_Civilian_Pistol.fbx',     // close visual match
  'M1911':           'weapons/SM_Police_Gun.fbx',          // user: 1911
  'Snub Revolver':   'weapons/SM_Revolver.fbx',            // shares revolver visual
  'Revolver':        'weapons/SM_Revolver.fbx',            // user: 44 revolver
  'Desert Eagle':    'weapons/SM_Hunting_Pistol.fbx',      // user: desert eagle
  'Flare Gun':       'weapons/SM_Civilian_Pistol.fbx',     // fallback

  // SMGs. Models chosen against the user's annotations:
  // Army_SMG=ump45, Civilian_SMG=roni(pcc), Police_SMG=p90, Tactical_SMG=vector.
  'AKS-74U':         'weapons/SM_Army_Submachine_Gun.fbx',   // no AK-74U model; UMP silhouette stands in
  'PDW':             'weapons/SM_Civilian_Submachine_Gun.fbx', // Roni PCC
  'MP7':             'weapons/SM_Special_Submachine_Gun.fbx', // unannotated slot; compact visual
  'P90':             'weapons/SM_Police_Submachine_Gun.fbx',  // user-confirmed P90

  // Rifles.
  'M4':              'weapons/SM_Assault_Rifle_5_56.fbx',
  'M4 Block II':     'weapons/Assault_Rifle_5_56_Prototype.fbx',   // placeholder — reuses M16 model until a block-II specific one lands
  'AK47':            'weapons/SM_Assault_Rifle_5_45.fbx',       // user: ak47
  'AK47 ACOG':       'weapons/SM_Assault_Rifle_5_45_Clean.fbx',
  'AS VAL':          'weapons/SM_Assault_Rifle_9x39.fbx',       // user: as val
  'VSS':             'weapons/SM_Assault_Rifle_9x39.fbx',       // shares the 9×39 platform with the AS VAL IRL
  'Tavor':           'weapons/SM_Bulpam_Assault_Rifle.fbx',     // user: bullpup ar
  'M16':             'weapons/Assault_Rifle_5_56_Prototype.fbx', // user: m16
  'M16A4':           'weapons/Assault_Rifle_5_56_Prototype.fbx',   // placeholder — reuses M16 mesh, the _Clean variant FBX is broken

  // Marksman / bolt.
  'Remington 700':   'weapons/SM_Hunting_Sniper_Rifle.fbx',     // user: m700
  'Mosin':           'weapons/SM_Large_Caliber_Sniper_Rifle.fbx',
  'SVD':             'weapons/SM_Army_Sniper_Rifle.fbx',        // user: svd
  'Cheytac Intervention': 'weapons/SM_High_Precision_Sniper_Rifle.fbx', // user: cheytac intervention

  // LMG.
  'M240':            'weapons/SM_Light_Machine_Gun.fbx',        // user: 240m lmg
  'PKM':             'weapons/SM_Heavy_Machine_Gun.fbx',        // user: pkm with a bipod
  'RPK':             'weapons/SM_Light_Machine_Gun.fbx',        // shares M240 visual

  // Shotgun.
  'AA-12':           'weapons/SM_Assault_Shotgun.fbx',          // user: aa-12

  // Legendary artifact pistol.
  "Jessica's Rage":  'weapons/SM_Hunting_Pistol.fbx',

  // Melee.
  'Knife':           'melee/SM_Combat_Knife.fbx',
  'Club':            'melee/SM_Hammer.fbx',
  'Baseball Bat':    'melee/SM_Baseball_bat_Nails_reinforced_.fbx',
  'katana':          'melee/SM_Katana.fbx',
  'Brass Knuckles':  'melee/SM_Brass_Knuckles_02.fbx',
  'Crowbar':         'melee/SM_Tire_iron.fbx',          // closest visual — bent steel rod
  'Kukri':           'weapons/SM_Kukri.fbx',
  'Tomahawk':        'weapons/SM_Combat_Axe.fbx',
  'Fire Axe':        'melee/SM_Fire_Axe.fbx',
  'Sledgehammer':    'tools/SM_Sledgehammer.fbx',
  'Chainsaw':        'tools/SM_Chainsaw.fbx',
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
  'weapons/SM_Civilian_Submachine_Gun.fbx': { x: 0, y: 0, z: -0.18 },   // PDW / generic SMG
  'weapons/SM_Army_Submachine_Gun.fbx':     { x: 0, y: 0, z: -0.16 },   // AKS-74U (UMP stand-in)
  'weapons/SM_Police_Submachine_Gun.fbx':   { x: 0, y: 0, z: -0.20 },   // P90 (bullpup — grip closer to centre)
  'weapons/SM_Special_Submachine_Gun.fbx':  { x: 0, y: 0, z: -0.14 },   // MP7 (compact)
  'weapons/SM_Tactical_Submachine_Gun.fbx': { x: 0, y: 0, z: -0.16 },   // Vector
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

export function modelForItem(item) {
  if (!item) return null;
  if (item.model) return item.model;  // callers can override inline

  if ((item.type === 'ranged' || item.type === 'melee') && item.name) {
    const byName = MODEL_BY_WEAPON_NAME[item.name];
    if (byName) return MODEL_BASE + byName;
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
