// 3D model manifest — maps items to .glb files extracted from the animpic
// POLY packs via tools/unity_to_gltf.py. Three.js loads .glb natively via
// FBXLoader (wired in src/gltf_cache.js).
//
// Resolution order mirrors iconForItem in inventory.js:
//   per-name override > per-id override > per-type fallback > null
// Falling through returns null, which tells loot.js to keep the primitive
// box placeholder.
//
// To add a new model: drop the .glb under Assets/models/<category>/,
// then add one line to the appropriate table. No other code changes.

const MODEL_BASE = 'Assets/models/';

// Per-weapon-name model override. Exact match against `item.name` on
// ranged/melee weapons. Names come from tunables.weapons[*].name.
// Lowpoly entries are tagged matches from the user's weapon_assigner
// session — see Assets/Weapons/weapon_assignments.json for the audit.
export const MODEL_BY_WEAPON_NAME = {
  // ===== lowpoly_v2 pack swap (gun-pack-swap branch, 2026-05-13) =====
  // All ranged weapons repoint at the recolored low_poly_guns_fbx pack
  // under Assets/models/lowpoly_v2/. Pack has 29 meshes — stand-ins
  // are used where the pack has no shape match (revolvers → auto;
  // LMG → heavy rifle). Prior mapping (animpic SM_* + lowpolyguns/)
  // preserved in git history on main.

  // Pistols — pistol_1..6
  'Makarov':            'lowpoly_v2/pistol_6.glb',
  'Glock 17':           'lowpoly_v2/pistol_3.glb',
  'M1911':              'lowpoly_v2/pistol_2.glb',
  'Desert Eagle .50':   'lowpoly_v2/fusil_3.glb',     // fusil_3 has hand-cannon bulk
  'Sig P320':           'lowpoly_v2/pistol_1.glb',
  'Beretta 92':         'lowpoly_v2/pistol_1.glb',
  'AR-15 Pistol':       'lowpoly_v2/pistol_5.glb',    // pistol_5 has tactical attachments
  'Flare Gun':          'lowpoly_v2/pistol_4.glb',
  // Revolver family — no wheel-gun in pack. pistol_4 reads bulkiest,
  // share across the family until a dedicated revolver mesh is sourced.
  'Colt Anaconda .44':  'lowpoly_v2/pistol_4.glb',
  'Colt Python':        'lowpoly_v2/pistol_4.glb',
  'Colt 357':           'lowpoly_v2/pistol_4.glb',
  '.38 Special':        'lowpoly_v2/pistol_4.glb',
  'Colt Six Shooter':   'lowpoly_v2/pistol_4.glb',
  'Snub Revolver':      'lowpoly_v2/pistol_4.glb',

  // SMGs — subfusil_1..10
  'PDW':                'lowpoly_v2/subfusil_3.glb',
  'MP7':                'lowpoly_v2/subfusil_4.glb',
  'UMP45':              'lowpoly_v2/subfusil_6.glb',
  'P90':                'lowpoly_v2/subfusil_10.glb',  // bullpup-style
  'Spectre':            'lowpoly_v2/subfusil_2.glb',
  'Spectre CQB':        'lowpoly_v2/subfusil_1.glb',
  'SPC9':               'lowpoly_v2/subfusil_3.glb',
  'SPCA3':              'lowpoly_v2/subfusil_4.glb',
  'SPC223':             'lowpoly_v2/subfusil_8.glb',
  'AKS-74U':            'lowpoly_v2/subfusil_5.glb',   // AK-style short
  'Kriss Vector':       'lowpoly_v2/subfusil_6.glb',
  'Draco NAK9':         'lowpoly_v2/subfusil_5.glb',   // 9mm AK-pattern compact

  // Rifles — fusil_1..7
  'AK47':               'lowpoly_v2/fusil_5.glb',     // AK-pattern anchor
  'AKS-47':             'lowpoly_v2/fusil_5.glb',
  'AKS-74':             'lowpoly_v2/fusil_5.glb',
  'AK104':              'lowpoly_v2/fusil_5.glb',
  'AS VAL':             'lowpoly_v2/subfusil_7.glb',  // suppressed long-arm
  'VSS':                'lowpoly_v2/subfusil_7.glb',
  'M16':                'lowpoly_v2/fusil_6.glb',     // AR-pattern
  'M4':                 'lowpoly_v2/fusil_6.glb',
  'AR-15 SBR':          'lowpoly_v2/fusil_6.glb',
  'CAR-15':             'lowpoly_v2/fusil_6.glb',
  'AUG A3-CQC':         'lowpoly_v2/fusil_7.glb',     // bullpup
  'JARD J67':           'lowpoly_v2/fusil_7.glb',
  'JARD J68':           'lowpoly_v2/fusil_7.glb',
  'JARD J56':           'lowpoly_v2/fusil_7.glb',
  'Tavor':              'lowpoly_v2/fusil_7.glb',

  // LMGs — no belt-fed shape in pack; sub the heaviest rifle silhouettes.
  'Type 80 LMG':        'lowpoly_v2/fusil_2.glb',
  'M249':               'lowpoly_v2/fusil_4.glb',

  // Snipers — sniper_0..2
  'Remington 700':      'lowpoly_v2/sniper_1.glb',
  'Remington 700 Tactical': 'lowpoly_v2/sniper_2.glb',
  'SVD Dragunov':       'lowpoly_v2/sniper_2.glb',
  'Cheytac Intervention':'lowpoly_v2/sniper_0.glb',   // sci-fi anti-material fits the top-tier rifle
  'AWP':                'lowpoly_v2/sniper_1.glb',
  '.338 Lapua':         'lowpoly_v2/sniper_2.glb',
  'Hunting Rifle':      'lowpoly_v2/sniper_1.glb',

  // Shotguns — shotgun_1 (lever) + shotgun_2 (pump)
  'AA-12':              'lowpoly_v2/shotgun_2.glb',
  'Benelli M4':         'lowpoly_v2/shotgun_2.glb',
  'Mossberg 500':       'lowpoly_v2/shotgun_2.glb',
  'Remington 870':      'lowpoly_v2/shotgun_2.glb',
  'KSG-12':             'lowpoly_v2/shotgun_2.glb',
  'Sawed-Off Shotgun':  'lowpoly_v2/shotgun_1.glb',
  'Henry Slug Rifle':   'lowpoly_v2/shotgun_1.glb',   // lever-action shape
  'Dragonbreath':       'lowpoly_v2/shotgun_2.glb',

  // Exotic
  'Flamethrower':       'lowpoly_v2/flamethrower.glb', // direct match
  'Widowmaker Rocket Launcher': 'lowpoly_v2/subfusil_9.glb', // heavy weapon read
  // Grenade Launcher — shares the heavy-weapon read with Widowmaker;
  // scale override (line ~472) already tuned for subfusil_9. Without
  // this entry the weapon falls through to a primitive box placeholder
  // when equipped.
  'Grenade Launcher':   'lowpoly_v2/subfusil_9.glb',
  // Ricochet Revolver — share revolver stand-in across family
  'RX-1 Rebound':       'lowpoly_v2/pistol_4.glb',
  'RX-2 Caroma':        'lowpoly_v2/pistol_4.glb',
  'RX-3 Pinball':       'lowpoly_v2/pistol_4.glb',
  // Charge Cannon family — sci-fi anti-material reads as energy heavy
  'VC-7 Volt':          'lowpoly_v2/sniper_0.glb',
  'VC-9 Surge':         'lowpoly_v2/sniper_0.glb',
  'VC-12 Nova':         'lowpoly_v2/sniper_0.glb',
  // Gauss Rifle family — heavy bullpup-style assault read
  'GR-4 Slug':          'lowpoly_v2/fusil_4.glb',
  'GR-6 Coil':          'lowpoly_v2/fusil_4.glb',
  'GR-9 Mag':           'lowpoly_v2/fusil_4.glb',
  // Explosive Crossbow — long-barrel single-shot via sniper_2
  'EX-3 Bolt':          'lowpoly_v2/sniper_2.glb',
  'EX-5 Spike':         'lowpoly_v2/sniper_2.glb',
  'EX-8 Stinger':       'lowpoly_v2/sniper_2.glb',

  // Legendary artifact pistol — share fusil_3's hand-cannon shape
  "Jessica's Rage":     'lowpoly_v2/fusil_3.glb',

  // Melee.
  // Combat Knife: per the Apr-26 dupe rule, the Bayonet_2 FBX tagged
  // "combat knife" supersedes the older SM_Combat_Knife model.
  'Combat Knife':       'lowpolyguns_accessories/Bayonet_2.glb',
  'Survival Knife':     'lowpolyguns_accessories/Bayonet.glb',
  'Pocket Knife':       'weapons/SM_Flick_Knife.glb',
  'Hammer':             'melee/SM_Hammer.glb',
  'Baseball Bat':       'melee/SM_Baseball_bat_Nails_reinforced_.glb',
  'katana':             'melee/SM_Katana.glb',
  'Brass Knuckles':     'melee/SM_Brass_Knuckles_02.glb',
  'Crowbar':            'melee/SM_Tire_iron.glb',
  'Kukri':              'weapons/SM_Kukri.glb',
  'Tomahawk':           'weapons/SM_Combat_Axe.glb',
  'Fire Axe':           'melee/SM_Fire_Axe.glb',
  'Sledgehammer':       'tools/SM_Sledgehammer.glb',
  'Chainsaw':           'tools/SM_Chainsaw.glb',
  'Scimitar':           'melee/SM_Handcrafted_Curved_Sword.glb',

};

// Per-item-id override — consumables, armor pieces, junk — anything with a
// stable id. Keys line up with CONSUMABLE_DEFS / ARMOR_DEFS / GEAR_DEFS /
// JUNK_DEFS in inventory.js.
export const MODEL_BY_ITEM_ID = {
  // Consumables — medical pack coverage.
  cons_bandage:      'medical/SM_Bandage.glb',
  cons_pain:         'medical/SM_Bottle_Of_Pills_Painkiller.glb',
  cons_splint:       'medical/SM_Bandage.glb',
  cons_medkit:       'medical/SM_Car_First_Aid_Kit.glb',
  cons_trauma:       'medical/SM_Blood_Bag.glb',
  cons_adrenaline:   'medical/SM_Ampoule_With_Solution_01.glb',
  cons_combat_stim:  'medical/SM_Ampoule_With_Solution_02.glb',
  cons_energy:       'medical/SM_Bottle_Of_Pills_Syrup.glb',
  cons_tourniquet:   'medical/SM_Tourniquet.glb',
  cons_afak:         'medical/SM_INDIVIDUAL_TACTICAL_AID_KIT.glb',
  cons_defib:        'medical/SM_Defibrillator.glb',
  cons_morphine:     'medical/SM_Injector_With_Morphine.glb',
  cons_regen:        'medical/SM_Injector_With_Regeneration.glb',
  junk_carbatt:      'tools/SM_Car_Battery.glb',
  junk_scrap:        'tools/SM_Scrap_Metal_02.glb',
  // Throwables — user-tagged per the Apr 2026 weapon-assigner pass.
  thr_frag:          'weapons/SM_Frag_Grenade.glb',
  thr_flash:         'weapons/SM_Stun_Grenade.glb',     // user-tagged "flashbang"
  thr_stun:          'weapons/SM_Stun_Grenade.glb',
  thr_molotov:       'weapons/SM_Molotov_02.glb',
  thr_maotai:        'weapons/SM_Molotov_01.glb',     // Maotai-bottle variant
  thr_claymore:      'weapons/SM_Infantry_Mine.glb',
  thr_elven_knife:   'weapons/SM_Throwing_Knife.glb',

  // Attachments — user-tagged FBXes from the Apr 2026 pass. Mapping
  // reads attachment.id to FBX path; the inventory grid + customize
  // screen render the same model.
  // -- Muzzle: comps / brakes / flash hiders
  att_compensator:        'weapons/SM_Compensator_For_Large_Caliber_Sniper_Rifle.glb',
  att_brake_a2:           'weapons/SM_Muzzle_Brake_Compensator_01.glb',
  att_brake_ak:           'weapons/SM_Muzzle_Brake_Compensator_03.glb',
  att_brake_sniper:       'weapons/SM_Muzzle_Brake_Compensator_02.glb',
  att_comp_linear:        'weapons/SM_Muzzle_Brake_Compensator_05.glb',
  att_flash_hider:        'weapons/SM_Muzzle_Brake_Compensator_06.glb',
  att_flash_hider_long:   'weapons/SM_Muzzle_Brake_Compensator_07.glb',
  // -- Muzzle: suppressors (lowpoly + animpic)
  att_suppressor:         'lowpolyguns_accessories/Silencer_1.glb',
  att_suppressor_short:   'lowpolyguns_accessories/Silencer_Short.glb',
  att_suppressor_long:    'lowpolyguns_accessories/Silencer_long.glb',
  att_suppressor_qd:      'lowpolyguns_accessories/Silencer_2.glb',
  att_suppressor_fluted:  'lowpolyguns_accessories/Silencer_3.glb',
  att_suppressor_osprey:  'weapons/SM_Muffler_04.glb',
  att_suppressor_tactical:'weapons/SM_Muffler_05.glb',
  // Apr-26 second-pass — extra muzzle/suppressor variants from
  // weapon_assignments.json (chinese / russian / KA QD cans, plus
  // a precision sniper brake and an alternate AK slant brake).
  att_brake_precision:    'weapons/SM_Compensator_For_High_Precision_Sniper_Rifle.glb',
  att_brake_ak2:          'weapons/SM_Muzzle_Brake_Compensator_04.glb',
  att_suppressor_chinese: 'weapons/SM_Muffler_01.glb',
  att_suppressor_russian: 'weapons/SM_Muffler_02.glb',
  att_suppressor_ka_qd:   'weapons/SM_Muffler_03.glb',
  // -- Side rail
  att_laser:              'weapons/SM_Tactical_Laser_Designator.glb',
  att_laser_red:          'weapons/SM_Tactical_Laser_Designator.glb',
  att_laser_green:        'weapons/SM_Tactical_Laser_Designator.glb',
  att_laser_blue:         'weapons/SM_Tactical_Laser_Designator.glb',
  att_laser_pistol:       'weapons/SM_Tactical_Laser_Designator.glb',
  att_flashlight:         'weapons/SM_Tactical_Flashlight_01.glb',
  att_tac_light:          'weapons/SM_Tactical_Flashlight_03.glb',
  att_strobe:             'weapons/SM_Tactical_Flashlight_02.glb',
  att_flashlight_olight:  'lowpolyguns_accessories/Flashlight.glb',
  // -- Under rail (foregrips / bipod)
  att_foregrip:           'weapons/SM_Vertical_Handle_01.glb',
  att_foregrip_angled:    'weapons/SM_Horizontal_Handle_01.glb',
  att_foregrip_stubby:    'lowpolyguns_accessories/Grip.glb',
  att_grip_canted:        'weapons/SM_Side_Handle.glb',
  att_bipod:              'weapons/SM_Bipod__ForHigh_Precision_Sniper_Rifle.glb',
  // Apr-26 second-pass foregrip variants (tan colorways + a folding
  // grip + a short vertical alternative).
  att_foregrip_tan:           'weapons/SM_Vertical_Handle_02.glb',
  att_foregrip_angled_tan:    'weapons/SM_Horizontal_Handle_02.glb',
  att_foregrip_vert_alt:      'weapons/SM_Horizontal_Handle_03.glb',
  att_foregrip_folding:       'weapons/SM_Horizontal_Handle_04.glb',
  // -- Top rail (sights)
  att_reddot:             'weapons/SM_Cylindrical_Collimator_Sight.glb',
  att_reflex:             'weapons/SM_Square_Dot_Sight.glb',
  att_holo:               'weapons/SM_Optical_Sight_01.glb',
  att_scope:              'lowpolyguns_accessories/Scope_2.glb',
  att_long_scope:         'lowpolyguns_accessories/Scope_3.glb',
  // Apr-26 EOD batch — extra sight + side-rail variants. Names
  // distinguish 'Amazon Special' (cheap), 'Prism' (etched-glass),
  // 'UH-1' (premium holo), 'PSO' (Soviet 4×).
  att_reddot_amazon:      'weapons/SM_Cylindrical_Collimator_Sight.glb',
  att_prism:              'weapons/SM_Optical_Sight_01.glb',
  att_holo_uh1:           'weapons/SM_Square_Dot_Sight.glb',
  att_scope_pso:          'weapons/SM_Scope_For_Police_Sniper_Rifle.glb',
  att_peq15:              'weapons/SM_Tactical_Block.glb',
  // Apr-26 second-pass top-rail variants (6× lowpoly scope, bullpup
  // tube scope, and an alt long-range scope from animpic).
  att_scope_6x:           'lowpolyguns_accessories/Scope_1.glb',
  att_scope_tube:         'weapons/SM_SM_Sight_Bulpam_Assault_Rifle.glb',
  att_scope_sniper:       'weapons/SM_Sniper_Scope.glb',
  // -- Barrel: handguard rail kits (Apr-26 second pass)
  att_rails_quad:         'weapons/SM_Forend_With_Picatinny_Rails_01.glb',
  att_rails_mlok:         'weapons/SM_Forend_With_Picatinny_Rails_02.glb',
  att_rails_ak:           'weapons/SM_Forend_With_Picatinny_Rails_5_45.glb',
  // -- Stock
  att_stock_heavy:        'weapons/SM_Wooden_Butt_01.glb',
  att_stock_skeleton:     'lowpolyguns_accessories/Stock.glb',
  att_stock_cqb:          'weapons/SM_Butt_Of_The_Rifle_For_Special_Submachine_Gun_Clean.glb',
  att_stock_folding:      'weapons/SM_Telescopic_Stock.glb',
  att_stock_crane:        'weapons/SM_Telescopic_Universal_Butt_01.glb',
  // -- Grip (pistol grip)
  att_grip_match:         'weapons/SM_Pistol_Grip_Prototype.glb',
  att_grip_stippled:      'weapons/SM_Pistol_Grip_01_5_45.glb',
  att_grip_skeleton:      'weapons/SM_Polymer_Handle.glb',
  att_grip_rubberized:    'weapons/SM_Pistol_Grip_01_5_56.glb',
  // -- Magazine
  att_mag_extended:       'weapons/SM_Larfe_For_Assault_Rifle_5_56.glb',
  att_mag_drum:           'weapons/SM_Large_Magazine_For_Assault_Rifle_5_45.glb',
  att_mag_banana:         'weapons/SM_Paired_For_Assault_Rifle_5_45.glb',
  att_mag_fast:           'weapons/SM_Magazine__For_Bulpam_Assault_Rifle.glb',
  att_mag_lmg_box:        'weapons/SM_Cartridge_Box_For_Light_Machine_Gun.glb',
  att_mag_hmg_box:        'weapons/SM_Cartridge_Box_For_Heavy_Machine_Gun.glb',
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
  'weapons/SM_Civilian_Submachine_Gun.glb': { x: 0, y: 0, z: -0.32 },   // PDW / generic SMG (shared w/ MP7)
  'weapons/SM_Army_Submachine_Gun.glb':     { x: 0, y: 0, z: -0.30 },   // AKS-74U
  'weapons/SM_Police_Submachine_Gun.glb':   { x: 0, y: 0, z: -0.38 },   // P90 (bullpup — need deeper push)
  'weapons/SM_Special_Submachine_Gun.glb':       { x: 0, y: 0, z: -0.28 },   // MP7 fallback
  'weapons/SM_Special_Submachine_Gun_Clean.glb': { x: 0, y: 0, z: -0.28 },   // MP7 active mesh
  'weapons/SM_Tactical_Submachine_Gun.glb': { x: 0, y: 0, z: -0.30 },   // Vector
  // Lowpolyguns SMG variants — same negative-Z convention to pull
  // the grip into the hand (otherwise held by the stock end).
  'lowpolyguns/SubmachineGun_1.glb':         { x: 0, y: 0, z: -0.30 },  // Spectre CQB
  'lowpolyguns/SubmachineGun_2.glb':         { x: 0, y: 0, z: -0.30 },  // Spectre
  'lowpolyguns/SubmachineGun_3.glb':         { x: 0, y: 0, z: -0.30 },  // SPC9
  'lowpolyguns/SubmachineGun_4.glb':         { x: 0, y: 0, z: -0.30 },  // SPCA3
  'lowpolyguns/SubmachineGun_5.glb':         { x: 0, y: 0, z: -0.30 },  // SPC223
  // PISTOLS — fitToRadius centers the bbox at the hand. For pistols
  // the bbox center sits roughly between the grip and the muzzle, so
  // the grip ends up about half the gun-length BEHIND the hand.
  // Negative Z pulls the model forward so the grip lands at the palm.
  'weapons/SM_Police_Gun.glb':               { x: 0, y: 0.04, z: 0.02 },  // 1911 — up + forward iteration
  'weapons/SM_Civilian_Pistol.glb':          { x: 0, y: 0, z: -0.08 },  // Makarov
  'weapons/SM_Special_Pistol.glb':           { x: 0, y: 0, z: -0.10 },  // .357 Magnum / Desert Eagle
  // Melee — handle is at one end of the mesh, but fitToRadius
  // centres the bbox at the hand, so the handle ends up ~half the
  // mesh length away. Negative Z shifts the model back so the grip
  // lands on the hand. Use `__debug.tuneWeapon(...)` live to refine.
  'melee/SM_Tire_iron.glb':                    { x: 0, y: 0, z: -0.28 },  // crowbar
  'melee/SM_Baseball_bat_Nails_reinforced_.glb': { x: 0, y: 0, z: -0.32 },
  'melee/SM_Katana.glb':                       { x: 0, y: 0, z: -0.30 },
  'melee/SM_Fire_Axe.glb':                     { x: 0, y: 0, z: -0.26 },
  'melee/SM_Hammer.glb':                       { x: 0, y: 0, z: -0.20 },  // club
  'melee/SM_Combat_Knife.glb':                 { x: 0, y: 0, z: -0.10 },

  // ── lowpoly_v2 pack per-mesh grip nudges (2026-05-13) ──
  // Pack-uniform alignment falls out of class gripOffset; per-mesh
  // entries here only correct meshes whose pivot differs from the
  // pack's typical pistol_2 baseline.
  'lowpoly_v2/pistol_3.glb':   { x: -0.03, y: 0.00, z: -0.08 },  // Glock 17
};

export const MODEL_ROTATION_OVERRIDE = {
  // Key -> { x, y, z } in radians. Replaces the default (0, π/2, 0).
};

// Per-pack rotation defaults. Applied when a model path matches the
// prefix and no per-weapon override above wins. lowpoly_v2 pack
// (low_poly_guns_fbx) authors muzzle along the Z axis pre-Y-up;
// after GLB Y-up conversion the muzzle ends up along -Z, so a π yaw
// around Y puts the muzzle on +Z = forward in the hand local frame.
const PACK_ROTATION_DEFAULTS = {
  'lowpoly_v2/': { x: 0, y: Math.PI, z: 0 },
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
// Per-weapon overrides for icon mirroring. The pack-prefix rule above
// works for in-hand mesh display, but the inventory icon is a separate
// hand-authored PNG that may already be drawn left-facing — mirroring
// it again flips it to point right while every other gun stays left.
// Names listed here force the mirror OFF for the icon path. (#45)
const ICON_MIRROR_OVERRIDE = new Set([
  'Remington 700',
  'Remington 700 Tactical',
]);
export function shouldMirrorInHand(item) {
  if (!item) return false;
  const path = MODEL_BY_WEAPON_NAME[item.baseName || item.name];
  if (!path) return false;
  return IN_HAND_MIRROR_PACK_PREFIXES.some(p => path.startsWith(p));
}
// Separate predicate for the inventory / customize icon path. Default
// matches in-hand, but ICON_MIRROR_OVERRIDE forces off for weapons whose
// authored PNG is already correct unmirrored.
export function shouldMirrorIcon(item) {
  if (!item) return false;
  const name = item.baseName || item.name;
  if (ICON_MIRROR_OVERRIDE.has(name)) return false;
  return shouldMirrorInHand(item);
}

export function gripOffsetForModelPath(fullPath) {
  if (!fullPath) return null;
  const key = fullPath.startsWith(MODEL_BASE) ? fullPath.slice(MODEL_BASE.length) : fullPath;
  return MODEL_GRIP_OFFSET[key] || null;
}

export function rotationOverrideForModelPath(fullPath) {
  if (!fullPath) return null;
  const key = fullPath.startsWith(MODEL_BASE) ? fullPath.slice(MODEL_BASE.length) : fullPath;
  if (MODEL_ROTATION_OVERRIDE[key]) return MODEL_ROTATION_OVERRIDE[key];
  for (const prefix of Object.keys(PACK_ROTATION_DEFAULTS)) {
    if (key.startsWith(prefix)) return PACK_ROTATION_DEFAULTS[prefix];
  }
  return null;
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
  'weapons/':                 0.85,   // animpic POLY weapons (attachments + a few melee)
  'lowpolyguns_accessories/': 1.00,   // attachment-only pack
  'melee/':                   0.95,   // animpic POLY melee
  'tools/':                   1.00,
};
// Per-mesh size overrides — applied on top of fitToRadius and the
// class-wide sizeMul in ANIM_TUNE. Reserve these for outliers: meshes
// whose authored bounding-box proportions differ enough that the class
// sizeMul leaves them visibly off-class. Empty by default — entries
// land here only after eyeballing in-game and confirming the class
// tune can't absorb the correction without breaking siblings.
export const MODEL_SCALE_OVERRIDE = {
  // ── lowpoly_v2 pack per-mesh size overrides ──
  // Computed 2026-05-17 from per-mesh visible bbox measurements taken
  // via Playwright. Target visible-length-along-longest-axis per class:
  //   pistol 0.22m, smg 0.45m, rifle 0.60m, shotgun 0.60m, sniper 0.80m,
  //   lmg 0.65m, exotic 0.60-0.65m. Each entry = target / measured
  //   (×prior scale where present). Tunes for the DOMINANT class user
  //   of each mesh — shared-mesh secondary classes (e.g. RX-* exotics
  //   on pistol_4.glb, GR-* exotics on fusil_4.glb) get the same
  //   scaleForModelPath and end up smaller because their sizeMul is
  //   lower. Touch up via per-name overrides if needed later.
  // PISTOLS — tune target 0.22m visible length
  'lowpoly_v2/pistol_2.glb':                0.42,  // M1911 (anchor)
  'lowpoly_v2/pistol_3.glb':                1.01,  // Glock 17
  'lowpoly_v2/pistol_4.glb':                0.79,  // Colt revolvers + RX-* (exotic, smaller)
  'lowpoly_v2/pistol_5.glb':                0.86,  // AR-15 Pistol
  'lowpoly_v2/pistol_6.glb':                1.05,  // Makarov
  'lowpoly_v2/fusil_3.glb':                 0.76,  // Desert Eagle / Jessica's Rage (pistol-class)
  // SMGs — target 0.45m
  'lowpoly_v2/subfusil_1.glb':              0.88,  // Spectre CQB
  'lowpoly_v2/subfusil_2.glb':              0.69,  // Spectre
  'lowpoly_v2/subfusil_3.glb':              0.63,  // PDW / SPC9
  'lowpoly_v2/subfusil_4.glb':              0.58,  // SPCA3
  'lowpoly_v2/subfusil_5.glb':              1.91,  // Draco NAK9 (small mesh, big bump)
  'lowpoly_v2/subfusil_6.glb':              0.65,  // UMP45 / Kriss Vector
  'lowpoly_v2/subfusil_8.glb':              0.54,  // SPC223
  'lowpoly_v2/subfusil_10.glb':             0.76,  // P90
  // RIFLES — target 0.60m
  'lowpoly_v2/fusil_5.glb':                 0.89,  // AK family
  'lowpoly_v2/fusil_6.glb':                 0.92,  // M16 / M4 / AR-15 SBR / CAR-15
  'lowpoly_v2/fusil_7.glb':                 0.96,  // AUG / JARD family
  'lowpoly_v2/subfusil_7.glb':              0.95,  // AS VAL / VSS (rifle-class on SMG mesh)
  // LMGs — target 0.65m
  'lowpoly_v2/fusil_2.glb':                 0.81,  // Type 80 LMG
  'lowpoly_v2/fusil_4.glb':                 0.86,  // M249 / GR-* exotics (smaller)
  // SNIPERS — target 0.80m
  'lowpoly_v2/sniper_0.glb':                0.71,  // Cheytac / VC-* exotics (smaller)
  'lowpoly_v2/sniper_1.glb':                0.81,  // Remington 700 / AWP / Hunting Rifle
  'lowpoly_v2/sniper_2.glb':                0.94,  // SVD / .338 Lapua / EX-* exotics (smaller)
  // SHOTGUNS — target 0.60m
  'lowpoly_v2/shotgun_1.glb':               0.84,  // Sawed-Off / Henry Slug Rifle
  'lowpoly_v2/shotgun_2.glb':               0.46,  // Mossberg / Benelli / AA-12 / etc (long pump)
  // EXOTICS — long-arm shapes, target 0.60m
  'lowpoly_v2/flamethrower.glb':            0.92,  // Flamethrower
  'lowpoly_v2/subfusil_9.glb':              0.68,  // Widowmaker Rocket Launcher
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
  'Draco NAK9':             'Draco_NAK9.png',
  'AR-15 Pistol':           'AR-15_Pistol.png',

  // SMGs
  'PDW':                    'PDW.png',
  'P90':                    'P90.png',
  'UMP45':                  'UMP45.png',
  'Spectre':                'Spectre.png',
  'Spectre CQB':            'Spectre_CQB.png',
  'SPC9':                   'SPC9.png',
  'SPCA3':                  'SPCA3.png',
  'SPC223':                 'SPC223.png',

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
  'JARD J68':               'JARD_J68.png',
  'JARD J56':               'JARD_J56.png',
  'M4':                     'M4.png',
  'Mini-14':                'Mini-14.png',
  'AKS-47':                 'AKS-47.png',
  'AR-15 SBR':              'AR-15_SBR.png',

  // LMGs
  'Type 80 LMG':            'Type_80_LMG.png',
  'M249':                   'M249.png',

  // Snipers
  'Remington 700':          'Remington_700.png',
  'Remington 700 Tactical': 'Remington_700_Tactical.png',
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
  'Flamethrower':           'flamethrower.png',
  'Dragonbreath':           'Dragonbreath.png',
  // New exotic families — most still use placeholder renders that
  // reuse the closest matching existing weapon image. Proper UI
  // renders being authored in #cold-exit-art-2d and swapped in as
  // they land. RX-1/RX-2/RX-3 now have real art; VC-* use the
  // Widowmaker rocket launcher render (closest heavy-energy
  // shape); GR-* use the CAR-15 carbine; EX-* use the AS_VAL
  // silhouette (long-barrel single-shot read).
  'RX-1 Rebound':           'RX-1_Rebound.png',
  'RX-2 Caroma':            'RX-2_Caroma.png',
  'RX-3 Pinball':           'RX-3_Pinball.png',
  'VC-7 Volt':              'VC-7_Volt.png',
  'VC-9 Surge':             'VC-9_Surge.png',
  'VC-12 Nova':             'Widowmaker_Rocket_Launcher.png',
  'GR-4 Slug':              'GR-4_Slug.png',
  'GR-6 Coil':              'GR-6_Coil.png',
  'GR-9 Mag':               'GR-9_Mag.png',
  'EX-3 Bolt':              'EX-3_Bolt.png',
  'EX-5 Spike':             'EX-5_Spike.png',
  'EX-8 Stinger':           'EX-8_Stinger.png',

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
