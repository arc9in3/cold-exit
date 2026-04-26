import { tunables } from './tunables.js';
import { rollPerks, GEAR_PERKS } from './perks.js';
import { GridContainer, stampItemDims, deriveGridLayout } from './grid_container.js';

// Slot-based inventory aligned to a body silhouette. Each item carries a
// `slot` (for armor/gear) or a `type` (ranged/melee/consumable). Equipment
// slots are fixed; backpack is a flat list capped at `maxBackpack`.
//
// Items also carry per-instance durability (`current`, `max`, `repairability`)
// — armor decays when the wearer takes damage, weapons decay tiny amounts per
// shot.

// Gear trimmed to the slots that produce meaningful choices: head/face/ears
// for the upper silhouette, chest/hands for torso armour, belt/pants/boots
// for lower body, backpack for capacity, plus melee + weapon1/weapon2.
// Previous 11-slot layout (shoulders/arms/knees added ~3% DR each) was
// producing filler drops the player auto-equipped without thinking.
export const SLOT_IDS = [
  'head', 'face', 'ears',
  'chest', 'hands',
  'belt', 'pants', 'boots',
  'backpack',
  'melee',
  'weapon1', 'weapon2',
];

export const SLOT_LABEL = {
  head: 'Head', face: 'Face', ears: 'Ears',
  chest: 'Chest', hands: 'Hands',
  belt: 'Belt', pants: 'Pants', boots: 'Boots',
  backpack: 'Backpack', melee: 'Melee',
  weapon1: 'Weapon 1', weapon2: 'Weapon 2',
};

// Slot positions on a 3-column × 6-row grid. Col 1 is the left side-rail
// (upper body / armour), col 2 sits behind the silhouette, col 3 is the
// right side-rail (weapons / lower body).
export const SLOT_POSITIONS = {
  // Left rail — upper body.
  head:      { row: 1, col: 1 },
  face:      { row: 2, col: 1 },
  ears:      { row: 3, col: 1 },
  chest:     { row: 4, col: 1 },
  hands:     { row: 5, col: 1 },
  // Right rail — weapons + lower body.
  backpack:  { row: 1, col: 3 },
  weapon1:   { row: 2, col: 3 },
  weapon2:   { row: 3, col: 3 },
  melee:     { row: 4, col: 3 },
  belt:      { row: 5, col: 3 },
  pants:     { row: 6, col: 3 },
  boots:     { row: 7, col: 3 },
};

// Unicode glyph per slot — shown as the placeholder in empty cells and on the
// slot label so the UI is readable at a glance without sprite art.
export const SLOT_ICONS = {
  head: '◑', face: '◉', ears: '◜◝',
  chest: '◼', hands: '✋',
  belt: '▬', pants: '⊓', boots: '⌦',
  backpack: '⎈', melee: '⚔', weapon1: '▶', weapon2: '▶',
};

export const TYPE_ICONS = {
  ranged: '▶', melee: '⚔', armor: '⛨', gear: '✪',
  consumable: '✚', attachment: '⌬', backpack: '⎈',
};

// Map items to PNG icons. The original Icons/ folder has broad category art;
// the Military/ pack adds a much finer library (specific pistols, rifles,
// armor, status effects, map pins, etc.). Prefer the granular ones per
// weapon name / class and fall back to the category icons.
const ICON_BASE = 'Assets/UI/Icons/';
const MIL_BASE  = 'Assets/UI/Military/';

// Per-weapon-name overrides — uses the SM_Wep_* BattleRoyale/Military art
// so each weapon has a distinct silhouette in the inventory grid. The
// cell renderer prefers the Clean (color) sibling of whatever path we
// return here, so keep the Underlay form.
const WEAPON_ICON_BY_NAME = {
  // Generic-class weapons (tunables.weapons[0..5]).
  'pistol':       'ICON_SM_Wep_Pistol_01_Military_Underlay.png',
  'smg':          'ICON_SM_Wep_SubMGun_01_BattleRoyale_Underlay.png',
  'shotgun':      'ICON_SM_Wep_Shotgun_01_Military_Underlay.png',
  'rifle':        'ICON_SM_Wep_Rifle_01_Military_Underlay.png',
  'lmg':          'ICON_SM_Wep_MachineGun_USA_01_Military_Underlay.png',
  'flamethrower': 'ICON_SM_Wep_Preset_B_Heavy_01_Military_Underlay.png',
  // Pistols
  'Glock':             'ICON_SM_Wep_Pistol_Small_01_Military_Underlay.png',
  'Sig P320':          'ICON_SM_Wep_Pistol_01_Military_Underlay.png',
  'Beretta 92':        'ICON_SM_Wep_Pistol_Metal_01_Military_Underlay.png',
  'M1911':             'ICON_SM_Wep_Pistol_01_Military_Underlay.png',
  'Revolver':          'ICON_SM_Wep_Pistol_Revolver_01_BattleRoyale_Underlay.png',
  'Snub Revolver':     'ICON_SM_Wep_Revolver_Snub_01_BattleRoyale_Underlay.png',
  'Desert Eagle':      'ICON_SM_Wep_Pistol_Heavy_01_BattleRoyale_Underlay.png',
  'Flare Gun':         'ICON_SM_Wep_Pistol_Flare_01_BattleRoyale_Underlay.png',
  // SMGs — icons drive the weapon identity since that's the authored art.
  'AKS-74U':           'ICON_SM_Wep_Preset_B_SMG_01_Military_Underlay.png',
  'PDW':               'ICON_SM_Wep_Preset_A_SMG_01_Military_Underlay.png',
  'MP7':               'ICON_SM_Wep_SubMGun_Lite_01_BattleRoyale_Underlay.png',
  'P90':               'ICON_SM_Wep_SubMGun_01_BattleRoyale_Underlay.png',
  // Rifles
  'M4':                'ICON_SM_Wep_Rifle_Assault_01_BattleRoyale_Underlay.png',
  'AK47':              'ICON_SM_Wep_Rifle_Assault_02_BattleRoyale_Underlay.png',
  'AS VAL':            'ICON_SM_Wep_Rifle_Assault_03_BattleRoyale_Underlay.png',
  'VSS':               'ICON_SM_Wep_Rifle_Assault_03_BattleRoyale_Underlay.png',
  'Remington 700':     'ICON_SM_Wep_Rifle_01_Military_Underlay.png',
  'M4 Block II':       'ICON_SM_Wep_Preset_A_Complex_01_Military_Underlay.png',
  'AK47 ACOG':         'ICON_SM_Wep_Preset_B_Rifle_01_Military_Underlay.png',
  'Tavor':             'ICON_SM_Wep_Preset_B_Rifle_03_Military_Underlay.png',
  'M16':               'ICON_SM_Wep_Rifle_Assault_05_BattleRoyale_Underlay.png',
  'M16A4':             'ICON_SM_Wep_Rifle_Assault_04_BattleRoyale_Underlay.png',
  // LMGs
  'M240':              'ICON_SM_Wep_MachineGun_01_BattleRoyale_Underlay.png',
  'PKM':               'ICON_SM_Wep_MachineGun_Bandit_01_Military_Underlay.png',
  'RPK':               'ICON_SM_Wep_Preset_B_Heavy_01_Military_Underlay.png',
  // Marksman / snipers
  'Mosin':             'ICON_SM_Wep_Sniper_01_Military_Underlay.png',
  'SVD':               'ICON_SM_Wep_Preset_B_Sniper_01_Military_Underlay.png',
  'Cheytac Intervention': 'ICON_SM_Wep_Sniper_Heavy_01_BattleRoyale_Underlay.png',
  // Shotguns
  'AA-12':             'ICON_SM_Wep_Shotgun_01_BattleRoyale_Underlay.png',
  // Melee — expanded lineup
  'Brass Knuckles':    'ICON_MilitaryCombat_Inventory_Melee_01_Underlay.png',
  'Crowbar':           'ICON_SM_Wep_Crowbar_01_BattleRoyale_Underlay.png',
  'Kukri':             'ICON_SM_Wep_Knife_Kukri_01_Military_Underlay.png',
  'Tomahawk':          'ICON_SM_Wep_Fireaxe_01_BattleRoyale_Underlay.png',
  'Fire Axe':          'ICON_SM_Wep_Fireaxe_01_BattleRoyale_Underlay.png',
  'Sledgehammer':      'ICON_SM_Wep_Pickaxe_01_BattleRoyale_Underlay.png',
  'Chainsaw':          'ICON_MilitaryCombat_Inventory_Melee_01_Underlay.png',
  // Legendary artifact — keep the desert-eagle silhouette.
  "Jessica's Rage":   'ICON_SM_Wep_Pistol_Heavy_01_BattleRoyale_Underlay.png',
  // Melee
  'Knife':         'ICON_SM_Wep_Knife_01_Military_Underlay.png',
  'Club':          'ICON_SM_Wep_Pan_01_BattleRoyale_Underlay.png',
  'Baseball Bat':  'ICON_SM_Wep_Bat_01_BattleRoyale_Underlay.png',
  'katana':        'ICON_SM_Wep_Sword_01_Military_Underlay.png',
};

// Per-slot fallback for armor and gear.
const ARMOR_ICON_BY_SLOT = {
  head:      'ICON_MilitaryCombat_Inventory_Helmets_01_Underlay.png',
  face:      'ICON_MilitaryCombat_Inventory_Abilities_01_Underlay.png',
  ears:      'ICON_MilitaryCombat_Inventory_Comms_01_Underlay.png',
  chest:     'ICON_MilitaryCombat_Inventory_Armor_01_Underlay.png',
  hands:     'ICON_MilitaryCombat_Inventory_Armor_01_Underlay.png',
  belt:      'ICON_MilitaryCombat_Inventory_Melee_01_Underlay.png',
  pants:     'ICON_MilitaryCombat_Inventory_Armor_01_Underlay.png',
  boots:     'ICON_MilitaryCombat_Inventory_Armor_01_Underlay.png',
};

// Per-item-id overrides — each lookup returns a distinct icon so the
// inventory grid shows visual variety even when two items share a slot.
const ARMOR_GEAR_ICON_BY_ID = {
  helmet_kevlar:     'ICON_MilitaryCombat_Inventory_Helmets_01_Underlay.png',
  helmet_tactical:   'ICON_MilitaryCombat_Special_Drone_01_Underlay.png',
  helmet_ballistic:  'ICON_MilitaryCombat_Status_Defense_01_Underlay.png',
  helmet_ghillie:    'ICON_MilitaryCombat_Map_Plants_01_Underlay.png',
  mask_balaclava:    'ICON_MilitaryCombat_Status_Cold_01_Underlay.png',
  mask_respirator:   'ICON_SM_Chr_Attach_GasMask_01_BattleRoyale.png',
  mask_gas:          'ICON_SM_Chr_Attach_Gas_Mask_01_Military.png',
  face_warpaint:     'ICON_MilitaryCombat_Status_Attack_01_Underlay.png',
  gear_vampiric:     'ICON_MilitaryCombat_Status_Bleeding_01_Underlay.png',
  gear_focus:        'ICON_MilitaryCombat_Stat_Accuracy_01_Underlay.png',
  comtacs:           'ICON_MilitaryCombat_Inventory_Comms_01_Underlay.png',
  ears_plugs:        'ICON_MilitaryCombat_Status_Shocked_01_Underlay.png',
  ears_trinket:      'ICON_MilitaryCombat_Stat_Luck_01_Underlay.png',
  ears_amp:          'ICON_MilitaryCombat_Special_DroneAmmo_01_Underlay.png',
  ears_surveil:      'ICON_MilitaryCombat_Special_Drone_02_Underlay.png',
  ears_wraith:       'ICON_MilitaryCombat_Stat_Spirit_01_Underlay.png',
  chest_light:       'ICON_MilitaryCombat_Inventory_Armor_01_Underlay.png',
  chest_med:         'ICON_MilitaryCombat_Status_Armour_01_Underlay.png',
  chest_heavy:       'ICON_MilitaryCombat_Status_DefenseUp_01_Underlay.png',
  chest_ghillie:     'ICON_MilitaryCombat_Map_Plants_01_Underlay.png',
  chest_spetsnaz:    'ICON_MilitaryCombat_Status_DefenseUp_01_Underlay.png',
  gear_juggernaut:   'ICON_MilitaryCombat_Stat_Strength_03_Underlay.png',
  gear_thorns:       'ICON_MilitaryCombat_Status_AttackUp_01_Underlay.png',
  gloves_tac:        'ICON_MilitaryCombat_Inventory_Melee_01_Underlay.png',
  gauntlets:         'ICON_MilitaryCombat_Stat_Strength_01_Underlay.png',
  hands_trigger:     'ICON_MilitaryCombat_Stat_Speed_01_Underlay.png',
  hands_climber:     'ICON_MilitaryCombat_Stat_Speed_03_Underlay.png',
  gear_stonefist:    'ICON_MilitaryCombat_Stat_Strength_02_Underlay.png',
  belt_rig:          'ICON_MilitaryCombat_Inventory_Melee_01_Underlay.png',
  belt_ammo:         'ICON_MilitaryCombat_Inventory_Ammo_Bullets_02_Underlay.png',
  belt_utility:      'ICON_MilitaryCombat_Inventory_Crafting_01_Underlay.png',
  pants_combat:      'ICON_MilitaryCombat_Inventory_Armor_01_Underlay.png',
  pants_runner:      'ICON_MilitaryCombat_Stat_Speed_03_Underlay.png',
  pants_quilt:       'ICON_MilitaryCombat_Status_Cold_01_Underlay.png',
  boots_light:       'ICON_MilitaryCombat_Stat_Speed_01_Underlay.png',
  boots_heavy:       'ICON_MilitaryCombat_Stat_Strength_03_Underlay.png',
  boots_silent:      'ICON_MilitaryCombat_Status_Up_01_Underlay.png',
  gear_zephyr:       'ICON_MilitaryCombat_Stat_Speed_02_Underlay.png',
  // Chr_Attach (character-attachment) art for the newer gear.
  helmet_combat:     'ICON_SM_Chr_Attach_Helmet_04_Military.png',
  helmet_tac_nvg:    'ICON_SM_Chr_Attach_Helmet_01_Goggles_01_Military.png',
  face_tac_goggles:  'ICON_SM_Chr_Attach_Helmet_01_Goggles_02_Military.png',
  hat_captain:       'ICON_SM_Chr_Attach_Hat_Captian_01_BattleRoyale.png',
  face_shades:       'ICON_SM_Chr_Attach_Glasses_01_Military.png',
  face_nvg_rig:      'ICON_SM_Chr_Attach_NVG_01_Military.png',
  ears_earmuffs:     'ICON_SM_Chr_Attach_Earmuffs_01_Military.png',
  belt_mag_pouch:    'ICON_SM_Chr_Attach_Pouch_Mag_01_Military.png',
  belt_grenade_pouch:'ICON_SM_Chr_Attach_Pouch_Grenade_01_Military.png',
};

// Consumable overrides keyed by id — healing items, stims, etc.
const CONSUMABLE_ICON_BY_ID = {
  cons_bandage: 'ICON_MilitaryCombat_Inventory_Repair_01_Underlay.png',
  cons_pain:    'ICON_MilitaryCombat_Inventory_Chemistry_01_Underlay.png',
  cons_splint:  'ICON_MilitaryCombat_Inventory_Repair_01_Underlay.png',
  cons_medkit:  'ICON_MilitaryCombat_Inventory_Healing_01_Underlay.png',  // legacy Icons folder already has this one
  cons_trauma:  'ICON_MilitaryCombat_Status_Health_01_Underlay.png',
  cons_adrenaline: 'ICON_MilitaryCombat_Status_AttackUp_01_Underlay.png',
  cons_combat_stim: 'ICON_MilitaryCombat_Status_Attack_01_Underlay.png',
  cons_energy:  'ICON_MilitaryCombat_Status_SpeedUp_01_Underlay.png',
  cons_tourniquet: 'ICON_MilitaryCombat_Inventory_Repair_01_Underlay.png',
  cons_afak:       'ICON_MilitaryCombat_Inventory_Healing_02_Underlay.png',
  cons_defib:      'ICON_MilitaryCombat_Status_Health_01_Underlay.png',
  cons_morphine:   'ICON_MilitaryCombat_Inventory_Chemistry_01_Underlay.png',
  cons_regen:      'ICON_MilitaryCombat_Status_Health_02_Underlay.png',
};

// Attachments get distinct art from the Wep_Mod_* catalog. Keys match
// ATTACHMENT_DEFS[*].id in attachments.js. These PNGs ship as single
// files (no Underlay/Clean/Stroke tri-layer), so the path ends directly
// in `_Military.png` instead of `_Military_Underlay.png`.
const ATTACHMENT_ICON_BY_ID = {
  att_compensator:   'ICON_SM_Wep_Mod_B_Barrel_01_Military.png',
  att_suppressor:    'ICON_SM_Wep_Mod_Silencer_01_Military.png',
  att_barrel_long:   'ICON_SM_Wep_Mod_A_Barrel_03_Military.png',
  att_barrel_short:  'ICON_SM_Wep_Mod_A_Barrel_01_Military.png',
  att_laser:         'ICON_SM_Wep_Mod_Laser_01_Military.png',
  att_flashlight:    'ICON_SM_Wep_Mod_Flashlight_01_Military.png',
  att_tac_light:     'ICON_SM_Wep_Mod_Flashlight_02_Military.png',
  att_strobe:        'ICON_SM_Wep_Mod_Laser_02_Military.png',
  att_foregrip:      'ICON_SM_Wep_Mod_A_Grip_01_Military.png',
  att_reddot:        'ICON_SM_Wep_Mod_Scope_10_Military.png',
  att_reflex:        'ICON_SM_Wep_Mod_Reddot_04_Military.png',
  att_holo:          'ICON_SM_Wep_Mod_Reddot_01_Military.png',
  att_scope:         'ICON_SM_Wep_Mod_Scope_01_Military.png',
  att_stock_heavy:   'ICON_SM_Wep_Mod_A_Stock_03_Military.png',
  att_grip_match:    'ICON_SM_Wep_Mod_A_Handle_01_Military.png',
  att_trigger_match: 'ICON_SM_Wep_Mod_A_Trigger_01_Military.png',
  att_mag_extended:  'ICON_SM_Wep_Mod_A_Mag_03_Military.png',
  att_mag_drum:      'ICON_SM_Wep_Mod_A_Mag_08_Military.png',
  att_bipod:         'ICON_SM_Wep_Mod_Bipod_01_Military.png',
};

// Junk variants — spread across trophy / notes / crafting / currency icons.
const JUNK_ICON_BY_ID = {
  junk_silver:   'ICON_MilitaryCombat_Inventory_Currency_02_Underlay.png',
  junk_dogtags:  'ICON_MilitaryCombat_Inventory_Notes_01_Underlay.png',
  junk_copper:   'ICON_MilitaryCombat_Inventory_Crafting_01_Underlay.png',
  junk_lighter:  'ICON_MilitaryCombat_Inventory_Crafting_01_Underlay.png',
  junk_watch:    'ICON_MilitaryCombat_Inventory_Trophy_01_Underlay.png',
  junk_drive:    'ICON_MilitaryCombat_Inventory_Notes_02_Underlay.png',
  junk_monocle:  'ICON_MilitaryCombat_Inventory_Trophy_01_Underlay.png',
  junk_cigcase:  'ICON_MilitaryCombat_Inventory_Trophy_01_Underlay.png',
  junk_doc:      'ICON_MilitaryCombat_Inventory_Notes_02_Underlay.png',
  junk_ring:     'ICON_MilitaryCombat_Inventory_Trophy_01_Underlay.png',
  junk_skull:    'ICON_MilitaryCombat_Status_Targeted_01_Underlay.png',
  junk_vase:     'ICON_MilitaryCombat_Inventory_Trophy_01_Underlay.png',
  junk_kingring: 'ICON_MilitaryCombat_Map_Star_01_Underlay.png',
  junk_walkie:   'ICON_SM_Chr_Attach_Pouch_WalkieTalkie_01_Military.png',
  junk_radio:    'ICON_SM_Chr_Attach_Radio_01_Military.png',
  junk_carbatt:  'ICON_SM_Chr_Attach_Battery_01_Military.png',
  junk_scrap:    'ICON_MilitaryCombat_Inventory_Crafting_01_Underlay.png',
};

export function iconForItem(item) {
  if (!item) return null;
  if (item.artifact) return ICON_BASE + 'ICON_MilitaryCombat_Status_Critical_01_Underlay.png';

  // Weapons — try a per-name icon first, then class, then category.
  if (item.type === 'ranged') {
    const byName = WEAPON_ICON_BY_NAME[item.name];
    if (byName) return MIL_BASE + byName;
    switch (item.class) {
      case 'smg':     return MIL_BASE + 'ICON_SM_Wep_Preset_A_SMG_01_Military_Underlay.png';
      case 'rifle':   return MIL_BASE + 'ICON_SM_Wep_Rifle_Assault_01_BattleRoyale_Underlay.png';
      case 'shotgun': return MIL_BASE + 'ICON_SM_Wep_Shotgun_01_Military_Underlay.png';
      case 'lmg':     return MIL_BASE + 'ICON_SM_Wep_MachineGun_USA_01_Military_Underlay.png';
      case 'flame':   return MIL_BASE + 'ICON_SM_Wep_Preset_B_Heavy_01_Military_Underlay.png';
      case 'pistol':
      default:        return MIL_BASE + 'ICON_SM_Wep_Pistol_01_Military_Underlay.png';
    }
  }
  if (item.type === 'melee') {
    const byName = WEAPON_ICON_BY_NAME[item.name];
    return MIL_BASE + (byName || 'ICON_SM_Wep_Knife_Kukri_01_Military_Underlay.png');
  }
  if (item.type === 'consumable') {
    const byId = CONSUMABLE_ICON_BY_ID[item.id];
    if (byId) return MIL_BASE + byId;
    return ICON_BASE + 'ICON_MilitaryCombat_Inventory_Healing_01_Underlay.png';
  }
  if (item.type === 'throwable') {
    // No dedicated art yet — reuse the grenade-ish medical icon so
    // the cell at least has a bomb-silhouette. Replace per-id later.
    return ICON_BASE + 'ICON_MilitaryCombat_Inventory_Minerals_01_Underlay.png';
  }
  if (item.type === 'junk') {
    const byId = JUNK_ICON_BY_ID[item.id];
    if (byId) return MIL_BASE + byId;
    return ICON_BASE + 'ICON_MilitaryCombat_Inventory_Minerals_01_Underlay.png';
  }
  if (item.type === 'attachment') {
    const byId = ATTACHMENT_ICON_BY_ID[item.id];
    if (byId) return MIL_BASE + byId;
    return MIL_BASE + 'ICON_MilitaryCombat_Inventory_Ammo_Bullets_02_Underlay.png';
  }
  if (item.slot === 'backpack') return ICON_BASE + 'ICON_MilitaryCombat_Inventory_Backpack_01_Underlay.png';
  if (item.type === 'armor' || item.type === 'gear') {
    const byId = ARMOR_GEAR_ICON_BY_ID[item.id];
    if (byId) return MIL_BASE + byId;
    const bySlot = ARMOR_ICON_BY_SLOT[item.slot];
    if (bySlot) return MIL_BASE + bySlot;
    return ICON_BASE + (item.type === 'armor'
      ? 'ICON_MilitaryCombat_Inventory_Shields_01_Underlay.png'
      : 'ICON_MilitaryCombat_Inventory_Items_01_Underlay.png');
  }
  return null;
}

// Status badge / HUD icons — exported so the HUD can paint PNG badges
// instead of plain colored pills.
export const STATUS_ICONS = {
  bleed:  MIL_BASE + 'ICON_MilitaryCombat_Status_Bleeding_01_Underlay.png',
  broken: MIL_BASE + 'ICON_MilitaryCombat_Status_DefenseBroken_01_Underlay.png',
  burn:   MIL_BASE + 'ICON_MilitaryCombat_Status_Burning_01_Underlay.png',
  shock:  MIL_BASE + 'ICON_MilitaryCombat_Status_Shocked_01_Underlay.png',
  hidden: MIL_BASE + 'ICON_MilitaryCombat_Status_Up_01_Underlay.png',
  spotted:MIL_BASE + 'ICON_MilitaryCombat_Status_Targeted_01_Underlay.png',
  xp:     MIL_BASE + 'ICON_MilitaryCombat_Status_XP_01_Underlay.png',
  health: MIL_BASE + 'ICON_MilitaryCombat_Stat_Health_01_Underlay.png',
};

export function randomJunk() {
  const pick = ALL_JUNK[Math.floor(Math.random() * ALL_JUNK.length)];
  return maybeApplyMastercraft(stampItemDims(jitterJunkValue({ ...pick })));
}

// Convenience: build an item with default durability fields.
function dur(max, repairability = 0.92) {
  return { current: max, max, repairability };
}

// --- Loot scaling context --------------------------------------------------
// Centralised "what level are we on" used by every roll function so we
// don't have to thread the level argument through 30 callers. main.js
// calls setLootLevel(level.index) once per regeneration.
let _lootLevel = 1;
export function setLootLevel(lv) {
  _lootLevel = Math.max(1, lv | 0);
  // Mirror onto window so cross-module perks.js / future loot tables
  // can read the current level without an explicit import dance.
  if (typeof window !== 'undefined') window.__lootLevel = _lootLevel;
}
export function getLootLevel() { return _lootLevel; }

// Affix-roll value scalar — early levels narrow rolls, late levels
// widen the upper bound. Floor stays at 1.0 so common-tier roll
// remains a meaningful baseline; ceiling grows linearly with level.
function _affixLevelScale() {
  const lv = _lootLevel;
  return Math.min(2.2, 1 + 0.06 * Math.max(0, lv - 1));
}
// Mastercraft: 0.5% chance per loot roll. Tagged with mastercraft:true
// so the cell renderer can render the rainbow-glow border, and every
// affix value / numeric perk roll bumps by 1.5×.
const MASTERCRAFT_CHANCE = 0.005;
export function rollMastercraft() { return Math.random() < MASTERCRAFT_CHANCE; }
// Backwards-compatible internal alias used by withAffixes / wrapWeapon.
function _rollMastercraft() { return rollMastercraft(); }

// Universal mastercraft application — works for any item that doesn't
// go through withAffixes/wrapWeapon (consumables, throwables, junk,
// toys, attachments). Adds the visual tag + bumps numeric stats by
// 1.5× where applicable. For items WITH affixes/perks the roll
// happens internally (withAffixes/wrapWeapon) and this helper just
// short-circuits if already tagged.
// Bridge for circular-import-shy modules (attachments.js) to call
// maybeApplyMastercraft without triggering the load cycle.
if (typeof window !== 'undefined') {
  window.__inv = window.__inv || {};
  // Populated below the function definition — see end of module.
}
export function maybeApplyMastercraft(item) {
  if (!item || item.mastercraft) return item;
  if (!rollMastercraft()) return item;
  item.mastercraft = true;
  // Stamp the visible MASTERCRAFT tag once.
  if (typeof item.name === 'string' && !item.name.includes('mastercraft-tag')) {
    item.name = `<span class="mastercraft-tag">MASTERCRAFT</span> ${item.name}`;
  }
  // Numeric boosts. Each item kind gets the bump in the field that
  // makes it visibly stronger:
  //   consumables → heal / amplitude / duration
  //   throwables  → aoeRadius, aoeDamage, charges, blind/stun durations
  //   junk        → sellValue
  //   attachments → no per-affix path; modifier already lives in
  //                 attachment def, leave as-is unless caller boosts.
  const e = item.useEffect;
  if (e) {
    if (typeof e.amount === 'number')   e.amount   = Math.round(e.amount * 1.5);
    if (typeof e.duration === 'number') e.duration = Math.max(1, Math.round(e.duration * 1.5));
    // dmgMult is a damage multiplier (e.g. 1.5×); leave fractional.
    if (typeof e.dmgMult === 'number')  e.dmgMult  = +(e.dmgMult  * 1.5).toFixed(2);
    if (typeof e.regen === 'number')    e.regen    = Math.max(1, Math.round(e.regen * 1.5));
  }
  if (typeof item.aoeRadius === 'number') item.aoeRadius = Math.max(1, Math.round(item.aoeRadius * 1.5));
  if (typeof item.aoeDamage === 'number') item.aoeDamage = Math.round(item.aoeDamage * 1.5);
  if (typeof item.maxCharges === 'number') item.maxCharges = Math.max(1, Math.round(item.maxCharges * 1.5));
  if (typeof item.blindDuration === 'number') item.blindDuration = Math.max(1, Math.round(item.blindDuration * 1.5));
  if (typeof item.stunDuration === 'number')  item.stunDuration  = Math.max(1, Math.round(item.stunDuration  * 1.5));
  if (typeof item.fireDuration === 'number')  item.fireDuration  = Math.max(1, Math.round(item.fireDuration  * 1.5));
  if (typeof item.fireTickDps === 'number')   item.fireTickDps   = Math.max(1, Math.round(item.fireTickDps   * 1.5));
  if (typeof item.sellValue === 'number')     item.sellValue     = Math.round(item.sellValue * 1.5);
  // Throwable charges in flight may already be set (charges = maxCharges
  // at construction). Re-sync so the in-hand stack matches the bumped
  // ceiling.
  if (typeof item.maxCharges === 'number' && typeof item.charges === 'number') {
    item.charges = item.maxCharges;
  }
  return item;
}

// Slot-availability gate. Until the player reaches certain levels,
// only the "core" body slots (head, chest, hands, boots, pants) drop
// from the loot tables. Face / ears / belt / backpack come online as
// the run progresses, so an early-game player isn't drowning in
// glasses they can't tell apart from earrings. By L8+ everything is
// in the pool — uniform distribution thereafter.
const ALWAYS_DROP_SLOTS = ['head', 'chest', 'hands', 'boots', 'pants'];
const SLOT_UNLOCK_LEVEL = {
  belt: 3, face: 4, ears: 5, backpack: 6,
};
function _slotAllowedAtLevel(slot, lv) {
  if (ALWAYS_DROP_SLOTS.includes(slot)) return true;
  const need = SLOT_UNLOCK_LEVEL[slot];
  if (need === undefined) return true;       // unknown slot — let it through
  return lv >= need;
}

// Random affix pool. Each affix has a `kind`, a label template, and an
// `apply` function that mutates the shared stats bag.
const AFFIX_POOL = [
  { kind: 'moveSpeed', roll: () => Math.round(3 + Math.random() * 7),
    label: v => `+${v}% move speed`,
    apply: (v, s) => { s.moveSpeedMult *= 1 + v / 100; } },
  { kind: 'maxHealth', roll: () => Math.round(5 + Math.random() * 15),
    label: v => `+${v} max HP`,
    apply: (v, s) => { s.maxHealthBonus += v; } },
  { kind: 'rangedDmg', roll: () => Math.round(4 + Math.random() * 8),
    label: v => `+${v}% ranged dmg`,
    apply: (v, s) => { s.rangedDmgMult *= 1 + v / 100; } },
  { kind: 'meleeDmg', roll: () => Math.round(5 + Math.random() * 10),
    label: v => `+${v}% melee dmg`,
    apply: (v, s) => { s.meleeDmgMult *= 1 + v / 100; } },
  { kind: 'staminaRegen', roll: () => Math.round(5 + Math.random() * 10),
    label: v => `+${v}% stamina regen`,
    apply: (v, s) => { s.staminaRegenMult *= 1 + v / 100; } },
  { kind: 'dmgReduction', roll: () => Math.round(2 + Math.random() * 4),
    label: v => `+${v}% dmg reduction`,
    apply: (v, s) => { s.dmgReduction += v / 100; } },
  { kind: 'maxStamina', roll: () => Math.round(5 + Math.random() * 15),
    label: v => `+${v} max stamina`,
    apply: (v, s) => { s.maxStaminaBonus += v; } },
  { kind: 'knockback', roll: () => Math.round(8 + Math.random() * 12),
    label: v => `+${v}% knockback`,
    apply: (v, s) => { s.knockbackMult *= 1 + v / 100; } },
];

// Common items roll 1 affix so they always spawn with at least one
// bonus stat on top of the intrinsic slot buff baked into ARMOR_DEFS /
// GEAR_DEFS. Without this, common-rarity gear often felt empty — the
// higher tiers keep their existing counts so the power curve stays put.
const AFFIX_COUNT_BY_RARITY = {
  common: 1, uncommon: 1, rare: 2, epic: 3, legendary: 4,
};

// Named armor/gear sets — each item that rolls a `setMark` affix counts
// toward set totals. Equipping multiple set pieces unlocks the tiered
// bonuses below. Ties into the wild-perk stat flags so set bonuses feel
// like the powerful perks naturally.
export const SET_DEFS = {
  reaper: {
    id: 'reaper', name: 'Reaper',
    tiers: [
      { pieces: 2, desc: '2pc: +10% crit chance',
        apply(s) { s.critChance += 0.10; } },
      { pieces: 4, desc: '4pc: kills heal 10% missing HP',
        apply(s) { s.fatalToFullHealMissing = Math.max(s.fatalToFullHealMissing || 0, 0.10); } },
    ],
  },
  gunslinger: {
    id: 'gunslinger', name: 'Gunslinger',
    tiers: [
      { pieces: 2, desc: '2pc: +12% fire rate',
        apply(s) { s.fireRateMult *= 1.12; } },
      { pieces: 4, desc: '4pc: kills refill 40% of mag',
        apply(s) { s.reloadOnKill = Math.max(s.reloadOnKill || 0, 0.40); } },
    ],
  },
  shadow: {
    id: 'shadow', name: 'Shadow',
    tiers: [
      { pieces: 2, desc: '2pc: −20% detection range',
        apply(s) { s.stealthMult *= 0.80; } },
      { pieces: 4, desc: '4pc: +25% dmg while crouched',
        apply(s) { s.crouchDmgMult *= 1.25; } },
    ],
  },
  warden: {
    id: 'warden', name: 'Warden',
    tiers: [
      { pieces: 2, desc: '2pc: +30 max HP',
        apply(s) { s.maxHealthBonus += 30; } },
      { pieces: 4, desc: '4pc: 10% dmg reduction, −15% incoming dmg below 30% HP',
        apply(s) { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.10);
                   s.cornerReduction = (s.cornerReduction || 0) + 0.15; } },
    ],
  },
  pyromaniac: {
    id: 'pyromaniac', name: 'Pyromaniac',
    tiers: [
      { pieces: 2, desc: '2pc: +50% burn duration, +20% fire resist',
        apply(s) { s.burnDurationBonus = (s.burnDurationBonus || 1) * 1.5;
                   s.fireResist = Math.min(0.8, s.fireResist + 0.20); } },
      { pieces: 4, desc: '4pc: +25% exotic damage, +25% explosion radius',
        apply(s) { s.rangedDmgMult *= 1.25;
                   s.exoticRadiusMult = (s.exoticRadiusMult || 1) * 1.25; } },
    ],
  },
  juggernaut: {
    id: 'juggernaut', name: 'Juggernaut',
    tiers: [
      { pieces: 2, desc: '2pc: +60 max HP, +20% knockback',
        apply(s) { s.maxHealthBonus += 60; s.knockbackMult *= 1.2; } },
      { pieces: 4, desc: '4pc: +20% dmg reduction, +20% melee dmg, −10% move speed',
        apply(s) { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.20);
                   s.meleeDmgMult *= 1.20;
                   s.moveSpeedMult *= 0.90; } },
    ],
  },
  ronin: {
    id: 'ronin', name: 'Ronin',
    tiers: [
      { pieces: 2, desc: '2pc: +20% melee dmg, +10% move speed',
        apply(s) { s.meleeDmgMult *= 1.20; s.moveSpeedMult *= 1.10; } },
      { pieces: 4, desc: '4pc: melee kills refund 25 stamina, +30% melee crit dmg',
        apply(s) {
          s.meleeStaminaRefundOnKill = Math.max(s.meleeStaminaRefundOnKill || 0, 25);
          s.bodyCritDamageBonus = (s.bodyCritDamageBonus || 0) + 0.30;
        } },
    ],
  },
  alchemist: {
    id: 'alchemist', name: 'Alchemist',
    tiers: [
      { pieces: 2, desc: '2pc: +1 throwable charge, −20% throwable cooldown',
        apply(s) { s.throwableChargeBonus += 1;
                   s.throwableCooldownMult *= 0.80; } },
      { pieces: 4, desc: '4pc: throwable kills refund a charge',
        apply(s) { s.throwableRefundOnKill = Math.max(s.throwableRefundOnKill || 0, 1); } },
    ],
  },
  oracle: {
    id: 'oracle', name: 'Oracle',
    tiers: [
      { pieces: 2, desc: '2pc: +20m hearing range, +0.15 ghost alpha',
        apply(s) { s.hearingRange += 20; s.hearingAlpha += 0.15; } },
      { pieces: 4, desc: '4pc: +30% crit chance, crits dazzle for 1.5s',
        apply(s) { s.critChance += 0.30;
                   s.shockOnCrit = Math.max(s.shockOnCrit || 0, 1.5); } },
    ],
  },
};
const SET_IDS = Object.keys(SET_DEFS);

// Set-piece affix — doesn't apply a stat on its own, just records the set
// membership. Inventory.applyTo counts pieces across equipped gear.
function rollSetMark() {
  const setId = SET_IDS[Math.floor(Math.random() * SET_IDS.length)];
  return { kind: 'setMark', setId, label: `● ${SET_DEFS[setId].name} Set` };
}

const SET_ROLL_CHANCE = {
  common: 0, uncommon: 0.10, rare: 0.20, epic: 0.35, legendary: 0.60,
};

export function rollAffixes(rarity, opts = {}) {
  const count = AFFIX_COUNT_BY_RARITY[rarity] ?? 0;
  if (count === 0) return [];
  const pool = [...AFFIX_POOL];
  const out = [];
  // Higher-rarity gear has a chance to roll a set-piece affix in place of
  // one of its normal affixes.
  const setChance = SET_ROLL_CHANCE[rarity] || 0;
  const hasSetAffix = Math.random() < setChance;
  // Per-level upper-bound widening — the FLOOR stays at the def's
  // base roll, so early levels can still hit baseline values; the
  // CEILING expands. Implementation: roll 0..1 of the base range,
  // scale to (base..base*levelScale), so the spread between weakest
  // and strongest legendary widens with progression.
  const levelScale = _affixLevelScale();
  const mcMult = opts.mastercraft ? 1.5 : 1.0;
  for (let i = 0; i < count && pool.length; i++) {
    if (i === 0 && hasSetAffix) { out.push(rollSetMark()); continue; }
    const idx = Math.floor(Math.random() * pool.length);
    const def = pool.splice(idx, 1)[0];
    let value = def.roll();
    // Bias the upper end of the value: each affix roll gets multiplied
    // by a random in [1, levelScale] so on average +0..1× of base.
    const widen = 1 + (levelScale - 1) * Math.random();
    value = value * widen * mcMult;
    out.push({ kind: def.kind, value, label: def.label(value) });
  }
  return out;
}

function applyAffix(aff, stats) {
  if (aff.kind === 'setMark') return; // set bonuses applied separately
  const def = AFFIX_POOL.find(a => a.kind === aff.kind);
  if (def) def.apply(aff.value, stats);
}

// Count equipped set pieces grouped by setId — used by the details panel
// so tooltips can show "2 / 4 equipped" next to each tier.
export function countEquippedSetPieces(equipment) {
  const counts = Object.create(null);
  for (const slot in equipment) {
    const it = equipment[slot];
    if (!it || !it.affixes) continue;
    for (const a of it.affixes) {
      if (a.kind === 'setMark' && a.setId) {
        counts[a.setId] = (counts[a.setId] || 0) + 1;
      }
    }
  }
  return counts;
}

// Apply set-bonus tiers based on how many equipped items share a setId.
// Called from Inventory.applyTo alongside the per-affix apply pass.
export function applySetBonuses(equipment, stats) {
  const counts = Object.create(null);
  for (const slot in equipment) {
    const it = equipment[slot];
    if (!it || !it.affixes) continue;
    for (const a of it.affixes) {
      if (a.kind === 'setMark' && a.setId) {
        counts[a.setId] = (counts[a.setId] || 0) + 1;
      }
    }
  }
  for (const setId in counts) {
    const def = SET_DEFS[setId];
    if (!def) continue;
    for (const tier of def.tiers) {
      if (counts[setId] >= tier.pieces) tier.apply(stats);
    }
  }
}

// Every weapon can now roll any rarity on pickup, weighted independent of
// the weapon's base rarity floor. Rolled rarity scales multiple stats so
// rarer weapons feel distinctly better, not just flavor.
// Rarity sort order, lowest → highest. Mythic sits above legendary
// and is only awarded by major-boss drops (see main.js rollMythicDrop).
// Jessica's Rage keeps its own `artifact: true` apex slot and never
// rolls into the mythic pool.
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export function rollWeaponRarity() {
  // Level-driven weighting — early levels are dominated by common
  // drops; rarer tiers come online slowly. By L8+ the distribution
  // approaches uniform-ish across the lower 4 tiers and legendary
  // becomes a real possibility on a normal pickup. Mythic remains
  // boss-locked (rollMythicDrop in main.js).
  const lv = _lootLevel;
  const r = Math.random();
  if (lv <= 1) {
    // L1 — almost everything is common, the occasional uncommon.
    if (r < 0.005) return 'rare';
    if (r < 0.10)  return 'uncommon';
    return 'common';
  }
  if (lv <= 3) {
    if (r < 0.005) return 'epic';
    if (r < 0.04)  return 'rare';
    if (r < 0.30)  return 'uncommon';
    return 'common';
  }
  if (lv <= 5) {
    if (r < 0.005) return 'legendary';
    if (r < 0.04)  return 'epic';
    if (r < 0.16)  return 'rare';
    if (r < 0.50)  return 'uncommon';
    return 'common';
  }
  if (lv <= 8) {
    if (r < 0.015) return 'legendary';
    if (r < 0.07)  return 'epic';
    if (r < 0.24)  return 'rare';
    if (r < 0.58)  return 'uncommon';
    return 'common';
  }
  // L9+: original-ish distribution as the late-game baseline.
  if (r < 0.03) return 'legendary';
  if (r < 0.11) return 'epic';
  if (r < 0.30) return 'rare';
  if (r < 0.62) return 'uncommon';
  return 'common';
}

// Per-rarity stat scalars. `headBonus` is additive to the head-zone multiplier.
const RARITY_SCALARS = {
  common:    { dmg: 1.00, fireRate: 1.00, magSize: 1.00, headBonus: 0.00, rangeMult: 1.00 },
  uncommon:  { dmg: 1.10, fireRate: 1.04, magSize: 1.10, headBonus: 0.10, rangeMult: 1.05 },
  rare:      { dmg: 1.22, fireRate: 1.08, magSize: 1.20, headBonus: 0.20, rangeMult: 1.10 },
  epic:      { dmg: 1.42, fireRate: 1.14, magSize: 1.35, headBonus: 0.35, rangeMult: 1.18 },
  legendary: { dmg: 1.70, fireRate: 1.22, magSize: 1.55, headBonus: 0.50, rangeMult: 1.25 },
  mythic:    { dmg: 2.10, fireRate: 1.30, magSize: 1.75, headBonus: 0.70, rangeMult: 1.30 },
};
const RARITY_NAME_PREFIX = {
  common: '', uncommon: 'Refined', rare: 'Rare', epic: 'Epic',
  legendary: 'Legendary', mythic: 'Mythic',
};

// If an item omits `rarity`, pick a reasonable default so the UI can still
// colour the border.
export function inferRarity(item) {
  if (!item) return 'common';
  if (item.rarity) return item.rarity;
  if (item.type === 'ranged' || item.type === 'melee') return 'common';
  if (item.type === 'consumable') return 'common';
  return 'common';
}

// Armor pieces (have `reduction` and a body slot).
export const ARMOR_DEFS = {
  helmet_kevlar: { id: 'helmet_kevlar', name: 'Kevlar Helmet', slot: 'head', type: 'armor',
    tint: 0x7a8a9a, reduction: 0.18, durability: dur(80, 0.85),
    description: '−18% damage taken (head)' },
  helmet_tactical: { id: 'helmet_tactical', name: 'Tactical Helmet', slot: 'head', type: 'armor',
    tint: 0x556070, reduction: 0.26, speedMult: 0.97, durability: dur(120, 0.9),
    description: '−26% dmg, −3% move' },

  mask_balaclava: { id: 'mask_balaclava', name: 'Balaclava', slot: 'face', type: 'armor',
    tint: 0x222630, reduction: 0.05, durability: dur(40, 0.95),
    description: '−5% dmg (face)' },
  mask_respirator: { id: 'mask_respirator', name: 'Respirator', slot: 'face', type: 'gear',
    tint: 0x303a4c, durability: dur(60, 0.9),
    description: '+10% stamina regen',
    apply(s) { s.staminaRegenMult *= 1.1; } },

  comtacs: { id: 'ears_comtacs', name: 'Comtacs', slot: 'ears', type: 'gear',
    tint: 0x404040, durability: dur(60, 0.9),
    description: 'Sense enemies +8m, +10 max stamina',
    apply(s) { s.hearingRange += 8; s.hearingAlpha += 0.08; s.maxStaminaBonus += 10; } },

  chest_light: { id: 'chest_light', name: 'Light Vest', slot: 'chest', type: 'armor',
    tint: 0x8fa8c0, reduction: 0.14, durability: dur(80, 0.95), stealthMult: 1.05, pockets: 1,
    description: '−14% dmg, light, +1 pocket', rarity: 'common' },
  chest_med: { id: 'chest_med', name: 'Tactical Vest', slot: 'chest', type: 'armor',
    tint: 0x6a8aa5, reduction: 0.26, speedMult: 0.96, stealthMult: 0.92, pockets: 2,
    durability: dur(140, 0.9),
    description: '−26% dmg, −4% move, +2 pockets', rarity: 'uncommon' },
  chest_heavy: { id: 'chest_heavy', name: 'Plate Armor', slot: 'chest', type: 'armor',
    tint: 0x485f78, reduction: 0.38, speedMult: 0.9, stealthMult: 0.75, pockets: 3,
    durability: dur(220, 0.82),
    description: '−38% dmg, −10% move, loud, +3 pockets', rarity: 'rare' },

  gloves_tac: { id: 'gloves_tac', name: 'Tactical Gloves', slot: 'hands', type: 'gear',
    tint: 0x2a2c2e, durability: dur(50, 0.92),
    description: '+15% knockback',
    apply(s) { s.knockbackMult *= 1.15; } },
  gauntlets: { id: 'gauntlets', name: 'Gauntlets', slot: 'hands', type: 'armor',
    tint: 0x6a6068, reduction: 0.08, durability: dur(80, 0.9),
    description: '−8% dmg (hands)' },

  belt_rig: { id: 'belt_rig', name: 'Combat Belt', slot: 'belt', type: 'gear',
    tint: 0x6f5a3a, durability: dur(70, 0.9), pockets: 1,
    gridLayout: { w: 3, h: 1 },
    description: '+20 max stamina · 3 rig slots',
    apply(s) { s.maxStaminaBonus += 20; } },

  pants_combat: { id: 'pants_combat', name: 'Combat Pants', slot: 'pants', type: 'armor',
    tint: 0x4a5562, reduction: 0.10, speedMult: 0.97, durability: dur(80, 0.92), pockets: 2,
    description: '−10% dmg' },

  boots_light: { id: 'boots_light', name: 'Light Boots', slot: 'boots', type: 'gear',
    tint: 0x6a4a2c, durability: dur(60, 0.9),
    description: '+10% move speed',
    apply(s) { s.moveSpeedMult *= 1.1; } },
  boots_heavy: { id: 'boots_heavy', name: 'Heavy Boots', slot: 'boots', type: 'armor',
    tint: 0x3a2a18, reduction: 0.08, speedMult: 0.95, durability: dur(110, 0.88),
    description: '−8% dmg, −5% move' },

  backpack_small: { id: 'backpack_small', name: 'Small Pack', slot: 'backpack', type: 'backpack',
    tint: 0x6a5530, durability: dur(120, 0.95), pockets: 6, rarity: 'common',
    gridLayout: { w: 3, h: 2 },
    description: '6 pack slots' },
  backpack_med: { id: 'backpack_med', name: 'Combat Pack', slot: 'backpack', type: 'backpack',
    tint: 0x4a4028, durability: dur(170, 0.92), pockets: 10, rarity: 'uncommon',
    gridLayout: { w: 5, h: 2 },
    description: '10 pack slots' },
  backpack_large: { id: 'backpack_large', name: 'Large Rucksack', slot: 'backpack', type: 'backpack',
    tint: 0x3a3418, durability: dur(220, 0.88), pockets: 15, rarity: 'rare',
    gridLayout: { w: 5, h: 3 },
    description: '15 pack slots' },

  // Expanded lineup — distinct per-slot utility so build variety matters.
  helmet_ballistic: { id: 'helmet_ballistic', name: 'Ballistic Helmet', slot: 'head', type: 'armor',
    tint: 0x2f4030, reduction: 0.32, speedMult: 0.95, durability: dur(140, 0.88),
    description: '−32% dmg, −5% move', rarity: 'rare' },
  helmet_ghillie: { id: 'helmet_ghillie', name: 'Ghillie Hood', slot: 'head', type: 'gear',
    tint: 0x4a5a30, durability: dur(50, 0.9),
    description: '−12% detection', rarity: 'uncommon',
    apply(s) { s.stealthMult *= 0.88; } },
  mask_gas: { id: 'mask_gas', name: 'Gas Mask', slot: 'face', type: 'gear',
    tint: 0x3f4a52, durability: dur(70, 0.88),
    description: '−25% fire damage, +5% stam regen', rarity: 'uncommon',
    apply(s) { s.fireResist = Math.min(0.8, s.fireResist + 0.25); s.staminaRegenMult *= 1.05; } },
  face_warpaint: { id: 'face_warpaint', name: 'War Paint', slot: 'face', type: 'gear',
    tint: 0x5a2020, durability: dur(30, 0.98),
    description: '+8% crit, +8% move', rarity: 'rare',
    apply(s) { s.critChance += 0.08; s.moveSpeedMult *= 1.08; } },
  ears_plugs: { id: 'ears_plugs', name: 'Combat Earplugs', slot: 'ears', type: 'gear',
    tint: 0xc0b070, durability: dur(30, 0.98),
    description: '−8% detection, +6% stam regen', rarity: 'common',
    apply(s) { s.stealthMult *= 0.92; s.staminaRegenMult *= 1.06; } },
  ears_trinket: { id: 'ears_trinket', name: 'Silver Earring', slot: 'ears', type: 'gear',
    tint: 0xe0e0e0, durability: dur(40, 0.95),
    description: '+3% crit', rarity: 'uncommon',
    apply(s) { s.critChance += 0.03; } },
  ears_amp: { id: 'ears_amp', name: 'Sound Amplifier', slot: 'ears', type: 'gear',
    tint: 0x70aadc, durability: dur(55, 0.9),
    description: 'Sense enemies +5m through walls', rarity: 'uncommon',
    apply(s) { s.hearingRange += 5; s.hearingAlpha += 0.05; } },
  ears_surveil: { id: 'ears_surveil', name: 'Surveillance Headset', slot: 'ears', type: 'gear',
    tint: 0x40a0e0, durability: dur(75, 0.88),
    description: 'Sense enemies +12m through walls, brighter ghosts', rarity: 'rare',
    apply(s) { s.hearingRange += 12; s.hearingAlpha += 0.14; } },
  ears_wraith: { id: 'ears_wraith', name: 'Wraith Earpiece', slot: 'ears', type: 'gear',
    tint: 0x9a5ac9, durability: dur(90, 0.85),
    description: 'Sense enemies +24m, ghosts nearly solid', rarity: 'epic',
    apply(s) { s.hearingRange += 24; s.hearingAlpha += 0.30; } },
  // Re-homed from the old `shoulders` slot. Same reload perk, now
  // lives on belt where a holster rig makes anatomical sense.
  belt_quickdraw: { id: 'belt_quickdraw', name: 'Quickdraw Rig', slot: 'belt', type: 'gear',
    tint: 0x523820, durability: dur(70, 0.9), pockets: 1,
    gridLayout: { w: 3, h: 1 },
    description: '−20% reload · 3 rig slots', rarity: 'uncommon',
    apply(s) { s.reloadSpeedMult *= 1.25; } },
  chest_ghillie: { id: 'chest_ghillie', name: 'Ghillie Suit', slot: 'chest', type: 'gear',
    tint: 0x3a5030, durability: dur(90, 0.9), stealthMult: 0.7, pockets: 1,
    description: 'Deep stealth, −20% detection', rarity: 'rare',
    apply(s) { s.stealthMult *= 0.8; } },
  chest_spetsnaz: { id: 'chest_spetsnaz', name: 'Spetsnaz Plate Carrier', slot: 'chest', type: 'armor',
    tint: 0x2a3a2a, reduction: 0.32, speedMult: 0.93, stealthMult: 0.92, pockets: 2,
    durability: dur(180, 0.9),
    description: '−32% dmg, −7% move', rarity: 'rare' },
  hands_trigger: { id: 'hands_trigger', name: 'Trigger Gloves', slot: 'hands', type: 'gear',
    tint: 0x1a1a1a, durability: dur(50, 0.92),
    description: '+12% fire rate', rarity: 'uncommon',
    apply(s) { s.fireRateMult *= 1.12; } },
  hands_climber: { id: 'hands_climber', name: 'Climber Gloves', slot: 'hands', type: 'gear',
    tint: 0x4a3a2a, durability: dur(55, 0.92),
    description: '−5% dmg, +8% move, +10% stam regen', rarity: 'uncommon',
    apply(s) { s.dmgReduction += 0.05; s.moveSpeedMult *= 1.08; s.staminaRegenMult *= 1.10; } },
  belt_ammo: { id: 'belt_ammo', name: 'Ammo Belt', slot: 'belt', type: 'gear',
    tint: 0x403028, durability: dur(90, 0.9), pockets: 1,
    gridLayout: { w: 3, h: 2 },
    description: '+20% mag size · 6 rig slots', rarity: 'uncommon',
    apply(s) { s.magSizeMult = (s.magSizeMult || 1) * 1.20; } },
  belt_utility: { id: 'belt_utility', name: 'Utility Belt', slot: 'belt', type: 'gear',
    tint: 0x5a4a2a, durability: dur(80, 0.9), pockets: 2,
    gridLayout: { w: 3, h: 2 },
    description: '6 rig slots · +8% reload', rarity: 'rare',
    apply(s) { s.reloadSpeedMult *= 1.08; } },
  pants_runner: { id: 'pants_runner', name: 'Runner Pants', slot: 'pants', type: 'gear',
    tint: 0x3a4a5a, durability: dur(60, 0.92), pockets: 1,
    description: '+12% move', rarity: 'uncommon',
    apply(s) { s.moveSpeedMult *= 1.12; } },
  pants_quilt: { id: 'pants_quilt', name: 'Quilted Pants', slot: 'pants', type: 'armor',
    tint: 0x3f302a, reduction: 0.16, speedMult: 0.96, durability: dur(110, 0.9), pockets: 1,
    description: '−16% dmg', rarity: 'uncommon' },
  // Re-homed from the old `knees` slot — same perk on pants instead,
  // since the "reinforced pants" category already exists.
  pants_reinforced: { id: 'pants_reinforced', name: 'Reinforced Pants', slot: 'pants', type: 'armor',
    tint: 0x2c2c30, reduction: 0.16, durability: dur(110, 0.9), pockets: 1,
    description: '−16% dmg, +5% stam regen', rarity: 'rare',
    apply(s) { s.staminaRegenMult *= 1.05; } },
  boots_silent: { id: 'boots_silent', name: 'Silent Treads', slot: 'boots', type: 'gear',
    tint: 0x2a2018, durability: dur(70, 0.9),
    description: '−20% detection, +4% move', rarity: 'rare',
    apply(s) { s.stealthMult *= 0.80; s.moveSpeedMult *= 1.04; } },

  // --- Character-attachment gear (animpic Chr_Attach_* art) ---
  helmet_combat: { id: 'helmet_combat', name: 'Combat Helmet', slot: 'head', type: 'armor',
    tint: 0x4a5240, reduction: 0.22, durability: dur(100, 0.88),
    description: '−22% dmg (head)', rarity: 'common' },
  helmet_tac_nvg: { id: 'helmet_tac_nvg', name: 'Tactical Helmet NVG', slot: 'head', type: 'gear',
    tint: 0x304050, durability: dur(120, 0.85),
    description: '−18% dmg, reveals hidden enemies +8m', rarity: 'rare',
    apply(s) { s.dmgReduction += 0.18; s.hearingRange += 8; s.hearingAlpha += 0.12; } },
  face_tac_goggles: { id: 'face_tac_goggles', name: 'Tactical Goggles', slot: 'face', type: 'gear',
    tint: 0x3a4230, durability: dur(55, 0.92),
    description: '−20% flash duration, +6m spotter range', rarity: 'uncommon',
    apply(s) {
      s.flashResist = Math.min(0.9, (s.flashResist || 0) + 0.20);
      s.hearingRange += 6;
    } },
  hat_captain: { id: 'hat_captain', name: "Captain's Hat", slot: 'head', type: 'gear',
    tint: 0x2a3040, durability: dur(40, 0.95),
    description: 'Sense enemies +4m, +8% credits from kills', rarity: 'uncommon',
    apply(s) {
      s.creditDropMult = (s.creditDropMult || 1) * 1.08;
      s.hearingRange += 4; s.hearingAlpha += 0.04;
    } },

  face_shades: { id: 'face_shades', name: 'Tactical Shades', slot: 'face', type: 'gear',
    tint: 0x202020, durability: dur(30, 0.96),
    description: '−10% flash duration, +3% crit', rarity: 'common',
    apply(s) { s.flashResist = Math.min(0.9, (s.flashResist || 0) + 0.10); s.critChance += 0.03; } },
  face_nvg_rig: { id: 'face_nvg_rig', name: 'NVG Rig', slot: 'face', type: 'gear',
    tint: 0x1a3a28, durability: dur(70, 0.85),
    description: 'Sense enemies +18m, reveals stealthed', rarity: 'rare',
    apply(s) { s.hearingRange += 18; s.hearingAlpha += 0.25; s.detectStealth = true; } },

  ears_earmuffs: { id: 'ears_earmuffs', name: 'Earmuffs', slot: 'ears', type: 'gear',
    tint: 0x4a3a2a, durability: dur(55, 0.93),
    description: '−15% flash duration, +8% stam regen', rarity: 'common',
    apply(s) { s.flashResist = Math.min(0.9, (s.flashResist || 0) + 0.15); s.staminaRegenMult *= 1.08; } },

  belt_mag_pouch: { id: 'belt_mag_pouch', name: 'Mag Pouch', slot: 'belt', type: 'gear',
    tint: 0x3a2f1c, durability: dur(80, 0.9), pockets: 1,
    description: '+25% mag size, +1 pocket', rarity: 'uncommon',
    apply(s) { s.magSizeMult = (s.magSizeMult || 1) * 1.25; } },
  belt_grenade_pouch: { id: 'belt_grenade_pouch', name: 'Grenade Pouch', slot: 'belt', type: 'gear',
    tint: 0x3a4828, durability: dur(70, 0.9), pockets: 1,
    description: '+2 pockets, +15% throw range', rarity: 'uncommon',
    apply(s) { s.throwRangeMult = (s.throwRangeMult || 1) * 1.15; } },
};

// Relic-style gear that goes in body slots (not chest armor).
export const GEAR_DEFS = {
  vampiric_face: { id: 'gear_vampiric', name: 'Vampiric Mask', slot: 'face', type: 'gear',
    tint: 0xb03050, durability: dur(60, 0.9),
    description: '+10% melee lifesteal',
    apply(s) { s.lifestealMeleePercent += 10; } },
  juggernaut_chest: { id: 'gear_juggernaut', name: 'Juggernaut Plating', slot: 'chest', type: 'gear',
    tint: 0x606876, durability: dur(180, 0.85),
    description: '+30 max HP, −10% move',
    apply(s) { s.maxHealthBonus += 30; s.moveSpeedMult *= 0.9; } },
  zephyr_boots: { id: 'gear_zephyr', name: 'Zephyr Boots', slot: 'boots', type: 'gear',
    tint: 0x70d0a0, durability: dur(70, 0.92),
    description: '+20% move, −10 max HP',
    apply(s) { s.moveSpeedMult *= 1.2; s.maxHealthBonus -= 10; } },
  stonefist: { id: 'gear_stonefist', name: 'Stonefist Gauntlets', slot: 'hands', type: 'gear',
    tint: 0xa87038, durability: dur(110, 0.88),
    description: '+25% melee dmg, +25% knockback',
    apply(s) { s.meleeDmgMult *= 1.25; s.knockbackMult *= 1.25; } },
  focus_lens: { id: 'gear_focus', name: 'Focus Lens', slot: 'head', type: 'gear',
    tint: 0x7ab0d8, durability: dur(50, 0.9),
    description: '−20% spread, +10% ranged dmg',
    apply(s) { s.rangedSpreadMult *= 0.8; s.rangedDmgMult *= 1.1; } },
  thorns_chest: { id: 'gear_thorns', name: 'Thorned Harness', slot: 'chest', type: 'gear',
    tint: 0x5c9040, durability: dur(120, 0.85),
    description: '+15% dmg reduction, −5% move',
    apply(s) { s.dmgReduction += 0.15; s.moveSpeedMult *= 0.95; } },
};

// Junk items — pure loot; drops in combat and sells to merchants. `sellValue`
// is a base; dropped copies fluctuate ±15% so identical items sell for
// varying amounts (see jitterJunkValue below).
// Per-def stackMax: roughly tracks "how many of these would you
// actually stuff in your bag without it getting absurd". Small loose
// pieces (coins, scraps, dog tags, drives, docs, rings) cap at 9;
// medium-bulky single items (watches, lighters, walkie-talkies) at
// 5; awkward / heavy / bulky items (vases, statues, skulls, radios,
// car batteries) at 3. Toys are intentionally absent here — the
// add() path treats anything without stackMax as non-stacking.
export const JUNK_DEFS = {
  // Common — cheap trinkets the player sees constantly.
  silverCoin:   { id: 'junk_silver',   name: 'Silver Coin',        type: 'junk', tint: 0xd0d0d0, sellValue: 55,   rarity: 'common',    description: 'Trinket · sells well',  stackMax: 9 },
  dogTags:      { id: 'junk_dogtags',  name: 'Dog Tags',           type: 'junk', tint: 0x8a8a8a, sellValue: 45,   rarity: 'common',    description: 'ID metal · low value',  stackMax: 9 },
  scrapCopper:  { id: 'junk_copper',   name: 'Copper Scrap',       type: 'junk', tint: 0xb87a4a, sellValue: 35,   rarity: 'common',    description: 'Scrap metal · fence it', stackMax: 9 },
  oldLighter:   { id: 'junk_lighter',  name: 'Brass Lighter',      type: 'junk', tint: 0xaa8a3a, sellValue: 70,   rarity: 'common',    description: 'Pocket curio',          stackMax: 5 },
  // Uncommon — small step up.
  goldWatch:    { id: 'junk_watch',    name: 'Gold Watch',         type: 'junk', tint: 0xe8c050, sellValue: 160,  rarity: 'uncommon',  description: 'Trinket · sells well',  stackMax: 5 },
  encryptedDrv: { id: 'junk_drive',    name: 'Encrypted Drive',    type: 'junk', tint: 0x60b0ff, sellValue: 260,  rarity: 'uncommon',  description: 'Data · valuable',       stackMax: 9 },
  monocle:      { id: 'junk_monocle',  name: 'Jeweled Monocle',    type: 'junk', tint: 0xf0d070, sellValue: 210,  rarity: 'uncommon',  description: 'Fancy eyewear',         stackMax: 3 },
  cigaretteCase:{ id: 'junk_cigcase',  name: 'Silver Cigarette Case', type: 'junk', tint: 0xbfbfbf, sellValue: 185, rarity: 'uncommon', description: 'Engraved silver',        stackMax: 5 },
  // Rare — meaningful fence money.
  rareDoc:      { id: 'junk_doc',      name: 'Classified Document',type: 'junk', tint: 0x8a9eff, sellValue: 400,  rarity: 'rare',      description: 'Intel · sells well',    stackMax: 9 },
  diamondRing:  { id: 'junk_ring',     name: 'Diamond Ring',       type: 'junk', tint: 0xeaeaff, sellValue: 580,  rarity: 'rare',      description: 'Jewelry · high value',  stackMax: 9 },
  emeraldSkull: { id: 'junk_skull',    name: 'Emerald Skull',      type: 'junk', tint: 0x30c080, sellValue: 640,  rarity: 'rare',      description: 'Cursed gemstone',       stackMax: 3 },
  // Epic — rare big payouts.
  antiqueVase:  { id: 'junk_vase',     name: 'Antique Vase',       type: 'junk', tint: 0xc99a6a, sellValue: 900,  rarity: 'epic',      description: 'Art · fence for credits', stackMax: 3 },
  kingsRing:    { id: 'junk_kingring', name: "King's Signet",      type: 'junk', tint: 0xd48040, sellValue: 1150, rarity: 'epic',      description: 'Royal seal · heirloom',  stackMax: 5 },
  // Chr_Attach electronics — mid-tier junk pickups.
  walkieTalkie: { id: 'junk_walkie',   name: 'Walkie-Talkie',      type: 'junk', tint: 0x2a2a30, sellValue: 220,  rarity: 'uncommon',  description: 'Battered comms · still works', stackMax: 5 },
  radio:        { id: 'junk_radio',    name: 'Field Radio',        type: 'junk', tint: 0x3a3a2a, sellValue: 340,  rarity: 'rare',      description: 'Encrypted military handset',   stackMax: 3 },
  carBattery:   { id: 'junk_carbatt',  name: 'Car Battery',        type: 'junk', tint: 0x6a6a70, sellValue: 420,  rarity: 'rare',      description: 'Lead-acid brick · heavy, valuable', stackMax: 3 },
  scrapMetal:   { id: 'junk_scrap',    name: 'Scrap Metal',        type: 'junk', tint: 0x8a8a8a, sellValue: 30,   rarity: 'common',    description: 'Mixed fragments · fence it', stackMax: 9 },
  // Encounter-trigger junk. Reads as a normal cheap pickup until
  // dropped inside the Duck encounter — then it triggers a toy
  // reward. Outside that room it's just sell-fodder.
  bagOfPeas:    { id: 'junk_peas',     name: 'Bag of Peas',         type: 'junk', tint: 0x8ac46a, sellValue: 25,   rarity: 'common',    description: 'A small canvas bag of dried peas. Smells of grass.', stackMax: 5 },
};
export const ALL_JUNK = Object.values(JUNK_DEFS);

// Randomize a junk drop's sellValue by ±15% so identical items vary.
export function jitterJunkValue(item) {
  if (item && typeof item.sellValue === 'number') {
    const flux = 1 + (Math.random() * 0.30 - 0.15);
    item.sellValue = Math.max(1, Math.round(item.sellValue * flux));
  }
  return item;
}

// Special boss-drop "toys" — very high value junk with unique ground visuals.
// The dropped mesh becomes a glowing stacked-primitive bear or duck.
export const TOY_DEFS = {
  jokeBear:   { id: 'toy_joke_bear',   name: 'Joke Bear',   type: 'junk', shape: 'bear', tint: 0xffffff, sellValue: 1700,  rarity: 'legendary', description: 'A suspiciously smiling bear' },
  bearyDoll:  { id: 'toy_beary_doll',  name: 'Beary Doll',  type: 'junk', shape: 'bear', tint: 0xffffff, sellValue: 1900,  rarity: 'legendary', description: 'Plush bear · glows faintly' },
  sleepDuck:  { id: 'toy_sleep_duck',  name: 'Sleep Duck',  type: 'junk', shape: 'duck', tint: 0xffe040, sellValue: 1800,  rarity: 'legendary', description: 'A duck with a dreamy look' },
  duckStatue: { id: 'toy_duck_statue', name: 'Duck Statue', type: 'junk', shape: 'duck', tint: 0xffe040, sellValue: 2000,  rarity: 'legendary', description: 'Polished ornamental duck' },
};
export const ALL_TOYS = Object.values(TOY_DEFS);
export function randomToy() {
  return maybeApplyMastercraft(stampItemDims({ ...ALL_TOYS[Math.floor(Math.random() * ALL_TOYS.length)] }));
}

// Consumables (live in backpack only).
export const CONSUMABLE_DEFS = {
  bandage: { id: 'cons_bandage', name: 'Bandage', type: 'consumable', rarity: 'common',
    tint: 0xd0d0d0,
    useEffect: { kind: 'heal', amount: tunables.medkit.smallHeal, cures: ['bleed'] },
    description: `Heal ${tunables.medkit.smallHeal} HP · stops bleed` },
  painkillers: { id: 'cons_pain', name: 'Painkillers', type: 'consumable', rarity: 'common',
    tint: 0xe0b060,
    useEffect: { kind: 'heal', amount: Math.round(tunables.medkit.smallHeal * 0.7) },
    description: `Heal ${Math.round(tunables.medkit.smallHeal * 0.7)} HP` },
  splint: { id: 'cons_splint', name: 'Splint', type: 'consumable', rarity: 'uncommon',
    tint: 0xd0c080,
    useEffect: { kind: 'heal', amount: Math.round(tunables.medkit.smallHeal * 0.5), cures: ['broken'] },
    description: `Mend broken bones · heal ${Math.round(tunables.medkit.smallHeal * 0.5)} HP` },
  medkit: { id: 'cons_medkit', name: 'Medkit', type: 'consumable', rarity: 'uncommon',
    tint: 0xff7070,
    useEffect: { kind: 'heal', amount: tunables.medkit.largeHeal, cures: ['bleed'] },
    description: `Heal ${tunables.medkit.largeHeal} HP · stops bleed` },
  trauma: { id: 'cons_trauma', name: 'Trauma Kit', type: 'consumable', rarity: 'rare',
    tint: 0xff4040,
    useEffect: { kind: 'heal', amount: Math.round(tunables.medkit.largeHeal * 1.6), cures: ['bleed', 'broken'] },
    description: `Heal ${Math.round(tunables.medkit.largeHeal * 1.6)} HP · cures all wounds` },
  adrenaline: { id: 'cons_adrenaline', name: 'Adrenaline Shot', type: 'consumable', rarity: 'uncommon',
    tint: 0xff80d0,
    useEffect: { kind: 'buff', id: 'adrenaline', mods: { moveSpeedMult: 1.45, staminaRegenMult: 1.4 }, life: 20 },
    description: '+20% move for 20s' },
  combatStim: { id: 'cons_combat_stim', name: 'Combat Stim', type: 'consumable', rarity: 'rare',
    tint: 0xff5050,
    useEffect: { kind: 'buff', id: 'combatStim', mods: { damageMult: 1.25 }, life: 15 },
    description: '+25% damage for 15s' },
  energyDrink: { id: 'cons_energy', name: 'Energy Drink', type: 'consumable', rarity: 'common',
    tint: 0x80e0ff,
    useEffect: { kind: 'buff', id: 'energy', mods: { staminaRegenMult: 1.5 }, life: 18 },
    description: '+50% stamina regen for 18s' },

  // --- Extended medical kit (new tiers + buff injectors) ---
  tourniquet: { id: 'cons_tourniquet', name: 'Tourniquet', type: 'consumable', rarity: 'common',
    tint: 0x9a2020,
    useEffect: { kind: 'heal', amount: 0, cures: ['bleed'] },
    description: 'Stops bleeding instantly' },
  afak: { id: 'cons_afak', name: 'IFAK', type: 'consumable', rarity: 'uncommon',
    tint: 0x8a1a1a,
    useEffect: { kind: 'heal', amount: Math.round(tunables.medkit.largeHeal * 0.85), cures: ['bleed'] },
    description: `Heal ${Math.round(tunables.medkit.largeHeal * 0.85)} HP · stops bleed · fast` },
  defibrillator: { id: 'cons_defib', name: 'Defibrillator', type: 'consumable', rarity: 'rare',
    tint: 0xffd060,
    useEffect: { kind: 'heal', amount: Math.round(tunables.medkit.largeHeal * 2.4), cures: ['bleed', 'broken'] },
    description: `Heal ${Math.round(tunables.medkit.largeHeal * 2.4)} HP · cures all wounds · loud` },
  morphineInjector: { id: 'cons_morphine', name: 'Morphine Injector', type: 'consumable', rarity: 'uncommon',
    tint: 0x70c0ff,
    useEffect: { kind: 'buff', id: 'morphine', mods: { dmgReduction: 0.25 }, life: 20 },
    description: '+25% damage reduction for 20s' },
  regenInjector: { id: 'cons_regen', name: 'Regen Injector', type: 'consumable', rarity: 'uncommon',
    tint: 0x40d080,
    useEffect: { kind: 'buff', id: 'regen', mods: { healthRegenMult: 2.5 }, life: 25 },
    description: '+150% health regen for 25s' },
};

// Throwables — equippable tossable items with charges + cooldown.
// Infinite use: a throwable stays in your inventory after use, but
// each throw consumes one charge and starts a per-charge cooldown.
// When cooldownT reaches zero, a charge refills; cooldown restarts
// as long as charges < max. Share `type: 'throwable'` so the
// inventory / action-bar flow can special-case them (different icon,
// separate use path from heal consumables). Each defines a
// `throwKind` that main.js dispatches at throw time to produce the
// correct on-landing effect.
//
// Base charges / cooldown (before Grenadier skill modifiers):
//   frag       1 charge · 180s  — rarest, biggest blast
//   molotov    2 charges · 120s — area denial
//   flashbang  2 charges · 120s — utility
//   stun       1 charge · 60s   — fast disable
export const THROWABLE_DEFS = {
  fragGrenade: {
    id: 'thr_frag', name: 'Frag Grenade', type: 'throwable', rarity: 'uncommon',
    tint: 0x4a5040,
    throwKind: 'frag',
    aoeRadius: 5.0, aoeDamage: 90, aoeShake: 0.55,
    // Fuse runs from first ground contact now (fuseAfterLand). 1.5s
    // gives the grenade visible bounce + settle before going off.
    fuse: 1.5,
    maxCharges: 1, cooldownSec: 90,
    description: 'Timed fragmentation grenade · 5m blast · 90s cooldown',
  },
  molotov: {
    id: 'thr_molotov', name: 'Molotov Cocktail', type: 'throwable', rarity: 'uncommon',
    tint: 0xc86830,
    throwKind: 'molotov',
    aoeRadius: 3.5, fuse: 0.6,   // shatters on impact
    fireDuration: 6.0, fireTickDps: 14,
    maxCharges: 2, cooldownSec: 60,
    description: 'Pool of fire on impact · 6s burn zone · 2 charges, 60s each',
  },
  flashbang: {
    id: 'thr_flash', name: 'Flashbang', type: 'throwable', rarity: 'uncommon',
    tint: 0xe0e0a0,
    throwKind: 'flash',
    aoeRadius: 7.5, fuse: 1.0,   // counts from landing (fuseAfterLand)
    blindDuration: 4.0,
    maxCharges: 2, cooldownSec: 60,
    description: 'Blinds enemies in radius for 4s · 2 charges, 60s each',
  },
  stunGrenade: {
    id: 'thr_stun', name: 'Stun Grenade', type: 'throwable', rarity: 'uncommon',
    tint: 0x6080e0,
    throwKind: 'stun',
    aoeRadius: 5.5, fuse: 1.2,   // counts from landing (fuseAfterLand)
    stunDuration: 2.5,
    maxCharges: 1, cooldownSec: 30,
    description: 'Dazes enemies in radius for 2.5s · 30s cooldown',
  },
  smokeGrenade: {
    id: 'thr_smoke', name: 'Smoke Grenade', type: 'throwable', rarity: 'uncommon',
    tint: 0xa0a8b0,
    throwKind: 'smoke',
    aoeRadius: 4.5, fuse: 0.8,   // pops fast on land, then lingers
    smokeDuration: 9.0,
    maxCharges: 2, cooldownSec: 60,
    description: 'Vision-blocking smoke for 9s · breaks enemy line of sight',
  },
  decoy: {
    id: 'thr_decoy', name: 'Decoy Beacon', type: 'throwable', rarity: 'uncommon',
    tint: 0xe0c040,
    throwKind: 'decoy',
    aoeRadius: 1.2, fuse: 0.8,   // arms quickly on land
    decoyDuration: 7.0,
    maxCharges: 2, cooldownSec: 50,
    description: 'Audio + visual lure pulls enemies to a location for 7s',
  },
  claymore: {
    id: 'thr_claymore', name: 'Claymore', type: 'throwable', rarity: 'uncommon',
    tint: 0x4a8030,
    throwKind: 'claymore',
    // Place-not-throw: short fuse just covers the toss arc. The mine
    // is the persistent prop; arming happens on first ground contact.
    aoeRadius: 4.5, aoeDamage: 110, aoeShake: 0.55, fuse: 0.4,
    triggerRadius: 2.6,                    // proximity sphere
    triggerConeDeg: 90,                    // detonates only for enemies in front
    maxCharges: 2, cooldownSec: 60,
    description: 'Place a directional mine · proximity-triggered cone blast · 2 charges, 60s each',
  },
};
export const ALL_THROWABLES = Object.values(THROWABLE_DEFS);
// Clone a throwable def into a live item instance — sets initial
// charges, zeroes the cooldown timer, and stamps the 1×1 grid dims.
export function makeThrowable(def) {
  const item = { ...def };
  item.charges = def.maxCharges | 0;
  item.cooldownT = 0;
  // Throwables roll the universal mastercraft chance — boosted aoe /
  // charges / duration on a hit. Skip when the caller forces no-roll
  // (e.g. starter inventory packs that should always be vanilla).
  return maybeApplyMastercraft(stampItemDims(item));
}
export function randomThrowable() {
  return makeThrowable(ALL_THROWABLES[Math.floor(Math.random() * ALL_THROWABLES.length)]);
}

// Expose the mastercraft helper on a window bridge so attachments.js
// (and any other late-loading module) can consume it without the
// circular-import dance.
if (typeof window !== 'undefined') {
  window.__inv = window.__inv || {};
  window.__inv.maybeApplyMastercraft = maybeApplyMastercraft;
}
export const ALL_ARMOR = Object.values(ARMOR_DEFS);
export const ALL_GEAR = Object.values(GEAR_DEFS);
export const ALL_CONSUMABLES = Object.values(CONSUMABLE_DEFS);

// Random pickers used by enemy drop logic.
function clone(def) {
  // Deep-ish clone — durability gets its own object, item methods preserved.
  const copy = { ...def };
  if (def.durability) copy.durability = { ...def.durability };
  return copy;
}
export function withAffixes(item) {
  const rarity = inferRarity(item);
  // Mastercraft is a one-in-200 roll that boosts every numeric affix
  // by 1.5× and bumps perk count by 1. Tags `item.mastercraft = true`
  // so the cell renderer can paint the special border.
  const mastercraft = _rollMastercraft();
  if (mastercraft) {
    item.mastercraft = true;
    // Stamp the yellow MASTERCRAFT tag at the front of the name once
    // — re-running withAffixes would otherwise dupe the prefix.
    if (typeof item.name === 'string' && !item.name.includes('mastercraft-tag')) {
      item.name = `<span class="mastercraft-tag">MASTERCRAFT</span> ${item.name}`;
    }
  }
  item.affixes = rollAffixes(rarity, { mastercraft });
  item.perks = rollPerks(rarity, { mastercraft });
  stampItemDims(item);
  return item;
}
// Belts and chest plates have a chance to grant an extra quick-action slot.
// Higher rarity ↑ roll odds so late-game gear becomes more valuable.
function rollActionSlotBonus(item) {
  if (!item) return item;
  const eligible = item.slot === 'belt' || item.slot === 'chest';
  if (!eligible) return item;
  const r = inferRarity(item);
  const odds = r === 'legendary' ? 1.0 : r === 'epic' ? 0.65 : r === 'rare' ? 0.35 : r === 'uncommon' ? 0.18 : 0.08;
  if (Math.random() < odds) {
    item.actionSlotBonus = 1;
    item.description = (item.description ? item.description + ' · ' : '') + '+1 quick slot';
  }
  return item;
}
// Level-aware random pickers — filter the source pool to slots that
// have unlocked at the player's current loot level. With the gate, an
// L1 random pull is guaranteed to be one of the core slots (head,
// chest, hands, boots, pants); face/ears/etc. trickle in only at the
// configured unlock levels.
function _filterBySlotGate(list, lv) {
  return list.filter(def => _slotAllowedAtLevel(def.slot, lv));
}
export function randomArmor() {
  const lv = _lootLevel;
  const pool = _filterBySlotGate(ALL_ARMOR, lv);
  const src = pool.length ? pool : ALL_ARMOR;
  return rollActionSlotBonus(withAffixes(clone(src[Math.floor(Math.random() * src.length)])));
}
export function randomGear() {
  const lv = _lootLevel;
  const pool = _filterBySlotGate(ALL_GEAR, lv);
  const src = pool.length ? pool : ALL_GEAR;
  return rollActionSlotBonus(withAffixes(clone(src[Math.floor(Math.random() * src.length)])));
}
export function randomConsumable() {
  return maybeApplyMastercraft(stampItemDims(clone(ALL_CONSUMABLES[Math.floor(Math.random() * ALL_CONSUMABLES.length)])));
}

// Wraps a weapon tunable into an inventory item with per-instance state
// (ammo, durability, reload). The instance is decoupled from the tunable so
// each picked-up weapon has its own state.
export function wrapWeapon(w, opts = {}) {
  const attachments = {};
  for (const s of w.attachmentSlots || []) attachments[s] = null;
  // Artifacts keep their declared rarity and scalars — they're supposed to be
  // specific legendary items, not rolled. Callers can force a rarity (e.g.
  // starter weapons are always common) via opts.rarity.
  const rolledRarity = opts.rarity
    || (w.artifact ? (w.rarity || 'legendary') : rollWeaponRarity());
  const sc = RARITY_SCALARS[rolledRarity];
  const namePrefix = w.artifact ? '' : RARITY_NAME_PREFIX[rolledRarity];
  const scaledCombo = w.combo ? w.combo.map(step => ({
    close: { ...step.close, damage: step.close.damage * sc.dmg },
    far:   { ...step.far,   damage: step.far.damage   * sc.dmg },
  })) : undefined;
  const newMag = typeof w.magSize === 'number' ? Math.max(1, Math.round(w.magSize * sc.magSize)) : w.magSize;
  const newDmg = typeof w.damage === 'number' ? Math.max(1, Math.round(w.damage * sc.dmg)) : w.damage;
  const newFireRate = typeof w.fireRate === 'number' ? Math.max(1, Math.round(w.fireRate * sc.fireRate)) : w.fireRate;
  const newRange = typeof w.range === 'number' ? Math.max(1, Math.round(w.range * sc.rangeMult)) : w.range;
  // Mastercraft weapon — same 0.5% gate as armor/gear. Boosts every
  // affix value 1.5×, bumps perk count by 1, and tags the item so the
  // cell renderer paints the rainbow-glow border.
  const mastercraft = !opts.skipMastercraft && _rollMastercraft();
  // Mastercraft prefixes the visible name with a yellow tag so it
  // jumps off the inventory grid even at thumbnail size. Other UI
  // surfaces (details panel, loot drop) read item.mastercraft and
  // paint additional glow themselves.
  const mcPrefix = mastercraft ? '<span class="mastercraft-tag">MASTERCRAFT</span> ' : '';
  const out = {
    ...w,
    itemCategory: 'weapon',
    rarity: rolledRarity,
    mastercraft: mastercraft || undefined,
    name: mcPrefix + (namePrefix ? `${namePrefix} ${w.name}` : w.name),
    tint: w.tracerColor,
    damage: newDmg,
    fireRate: newFireRate,
    range: newRange,
    magSize: newMag,
    headBonus: sc.headBonus,          // added to head zone multiplier in main
    combo: scaledCombo || w.combo,
    description: w.type === 'melee'
      ? `Melee · ${rolledRarity}`
      : `${w.fireMode} · ${newFireRate ? newFireRate + '/s' : 'continuous'} · ${rolledRarity}`,
    ammo: newMag,
    reloadingT: 0,
    durability: dur(200, 0.95),
    attachments,
    perks: rollPerks(rolledRarity, { mastercraft }),
    affixes: rollAffixes(rolledRarity, { mastercraft }),
  };
  // Stamp grid footprint so the item can be placed without further
  // resolution at insertion time.
  stampItemDims(out);
  return out;
}

// "Pockets" are what the player carries on their body without any
// gear — always present, small fixed grid. Phase 2 adds separate
// container grids for equipped rigs/backpacks so pockets no longer
// scale with gear.
const BASE_POCKET_W = 4;
const BASE_POCKET_H = 2;
const BASE_POCKETS = BASE_POCKET_W * BASE_POCKET_H;
// Eight unified hotbar slots — keys 1-4 map to indices 0-3 (the
// "weapon bar" cluster), keys 5-8 to indices 4-7 (the "quick bar"
// cluster). Both clusters accept any usable item (consumable,
// throwable, weapon — press to swap-to). The split exists in the HUD
// for visual rhythm only; under the hood it's one `actionBar` array.
export const ACTION_SLOT_COUNT = 8;      // total hotbar slots
export const BASE_ACTION_SLOT_COUNT = 8; // all slots always usable

// Stacking cap for consumables (bandages / medkits / stims). Picking
// up a consumable when an existing stack of the same id is in the
// inventory merges into that stack first; only the spillover lands
// as a fresh instance. Throwables stay charges-based and don't
// participate in stacking.
export const CONSUMABLE_STACK_MAX = 5;


export class Inventory {
  constructor() {
    this.equipment = Object.fromEntries(SLOT_IDS.map(s => [s, null]));
    this.basePockets = BASE_POCKETS;
    this.maxBackpack = BASE_POCKETS;
    // Three separate grids, Tarkov-style:
    //
    //   pocketsGrid  — always on, small, represents "what fits in
    //                   your pants / jacket without gear" (4×2)
    //   rigGrid      — provided by an equipped vest/belt (the tactical
    //                   rig). Dimensions come from the rig's
    //                   gridLayout (or are derived from `pockets`).
    //   backpackGrid — provided by an equipped backpack. Generally
    //                   the largest grid.
    //
    // All three are independent; items live in whichever grid they
    // were placed. `add()` tries pockets → rig → backpack.
    this.pocketsGrid = new GridContainer(BASE_POCKET_W, BASE_POCKET_H);
    this.rigGrid = null;
    this.backpackGrid = null;
    // Persistent pouch — variable 1..9 slot grid whose contents survive
    // death AND restart-level. Serialises to localStorage on every
    // _bump. Slot count is a chip-funded meta upgrade (see prefs
    // `getPouchSlots`). `setPouchCapacity(n)` resizes while preserving
    // existing entries.
    this.pouchGrid = new GridContainer(1, 1);
    this._pouchRestored = false;
    // Legacy flat-array view of ALL items across all three grids,
    // in insertion order (pockets → rig → backpack). Kept as a
    // readable cache for older call sites (medkit hotkey, shop
    // iteration, etc.). The grids are authoritative; this view is
    // refreshed each _bump().
    this.backpack = [];
    // Action bar holds direct references to consumable items that
    // still live somewhere in the inventory. Using a slot pulls the
    // item out of wherever it lives.
    this.actionBar = new Array(ACTION_SLOT_COUNT).fill(null);
    this.version = 0;
    this._syncBackpackView();
  }

  // Every throwable item currently held by the player (pockets /
  // rig / backpack / pouch). Used by the cooldown ticker so charges
  // refill regardless of whether the item is bound to an action slot.
  allThrowables() {
    const out = [];
    for (const g of this.allGridsIncludingPouch()) {
      for (const it of g.items()) if (it && it.type === 'throwable') out.push(it);
    }
    return out;
  }

  // All container grids, in preferred auto-placement order. The
  // persistent pouch is DELIBERATELY excluded from auto-placement —
  // only an explicit drop / equip path should put items into it, so
  // new loot doesn't accidentally land in the death-safe slot.
  allGrids() {
    const out = [this.pocketsGrid];
    if (this.rigGrid) out.push(this.rigGrid);
    if (this.backpackGrid) out.push(this.backpackGrid);
    return out;
  }
  // All grids INCLUDING the pouch — used by UI lookups like
  // `gridOf` that need to find an item regardless of which grid
  // owns it, and by death-cleanup code that wipes everything
  // except the pouch.
  allGridsIncludingPouch() {
    const out = this.allGrids();
    out.push(this.pouchGrid);
    return out;
  }
  // Find which grid currently owns an item (or null).
  gridOf(item) {
    for (const g of this.allGridsIncludingPouch()) if (g.contains(item)) return g;
    return null;
  }

  // --- Persistent pouch (localStorage-backed) --------------------------
  // Shape: { entries: [{ item, x, y, rotated }] }. We only serialise the
  // pouch — never the main inventory — since the pouch is the only
  // grid that should outlive a death.
  savePouch() {
    try {
      const snap = {
        entries: this.pouchGrid.entries().map((e) => ({
          item: e.item, x: e.x, y: e.y, rotated: !!e.rotated,
        })),
      };
      localStorage.setItem('tacticalrogue_pouch_v1', JSON.stringify(snap));
    } catch (_) { /* private mode / quota — fail silently */ }
  }
  loadPouch() {
    if (this._pouchRestored) return;
    this._pouchRestored = true;
    try {
      const raw = localStorage.getItem('tacticalrogue_pouch_v1');
      if (!raw) return;
      const snap = JSON.parse(raw);
      if (!snap || !Array.isArray(snap.entries)) return;
      for (const e of snap.entries) {
        if (!e || !e.item) continue;
        if (!this.pouchGrid.place(e.item, e.x, e.y, !!e.rotated)) {
          this.pouchGrid.autoPlace(e.item);
        }
      }
    } catch (_) {}
  }

  // Resize the pouch to N slots total (1..9). Laid out as a single
  // horizontal row so upgrades read as a widening strip. Items that
  // no longer fit fall back to autoPlace, or stay in place if the
  // new grid still covers their coord.
  setPouchCapacity(n) {
    const clamped = Math.max(1, Math.min(9, n | 0));
    if (this.pouchGrid.w === clamped && this.pouchGrid.h === 1) return;
    // Grab current items, clear, resize, re-place each.
    const items = this.pouchGrid.items();
    this.pouchGrid.clear();
    this.pouchGrid.resize(clamped, 1);
    for (const it of items) this.pouchGrid.autoPlace(it);
    this._bump();
  }

  // Swap two action-bar slots' contents. Accepts null contents on either
  // side so it doubles as "move to empty slot".
  swapActionSlots(a, b) {
    const max = this.maxActionSlots();
    if (a < 0 || b < 0 || a >= max || b >= max || a === b) return false;
    const tmp = this.actionBar[a];
    this.actionBar[a] = this.actionBar[b];
    this.actionBar[b] = tmp;
    this._bump();
    return true;
  }

  assignActionSlot(slotIdx, item) {
    if (slotIdx < 0 || slotIdx >= this.maxActionSlots()) return false;
    // Action slots accept anything the player would actively use:
    // consumables and throwables (single-press use), weapons (press to
    // swap-to). Pure gear / armour stays barred — equipping that
    // happens through the paperdoll, not the hotbar.
    if (item) {
      const t = item.type;
      const ok = t === 'consumable' || t === 'throwable'
        || t === 'ranged' || t === 'melee';
      if (!ok) return false;
    }
    // Don't allow same item on two slots.
    for (let i = 0; i < this.actionBar.length; i++) {
      if (this.actionBar[i] === item) this.actionBar[i] = null;
    }
    this.actionBar[slotIdx] = item;
    this._bump();
    return true;
  }

  // Look up the item currently bound to a given action slot; returns null if
  // the bound item is no longer in any inventory grid (stale reference).
  actionSlotItem(slotIdx) {
    const it = this.actionBar[slotIdx];
    if (!it) return null;
    if (!this.gridOf(it)) {
      this.actionBar[slotIdx] = null;
      return null;
    }
    return it;
  }

  consumeActionSlot(slotIdx) {
    const it = this.actionSlotItem(slotIdx);
    if (!it) return null;
    // Stack-aware consume — if the bound consumable is part of a
    // stack of multiple, decrement the count and keep the slot bound
    // to the same item. Only when the stack hits zero do we remove
    // the item from the grid and try to auto-refill the slot from
    // another matching consumable in the inventory.
    if (it.type === 'consumable' && ((it.count | 0) || 1) > 1) {
      // Return a freshly-cloned item for the caller to apply (so the
      // caller's path can mutate / consume it independently of the
      // stack). count: 1 since the caller is using exactly one.
      const single = { ...it, count: 1 };
      it.count = (it.count | 0) - 1;
      this._bump();
      return single;
    }
    const g = this.gridOf(it);
    if (g) g.remove(it);
    this.actionBar[slotIdx] = null;
    // Auto-refill — find another consumable of the same id anywhere
    // in the inventory and bind it to the now-empty slot. Players
    // expect their bandage hotkey to keep being a bandage hotkey
    // until they're physically out of bandages.
    if (it.type === 'consumable') {
      const replacement = this._findReplacementConsumable(it);
      if (replacement) this.assignActionSlot(slotIdx, replacement);
    }
    this._bump();
    return it;
  }

  // Walk every grid + the pouch looking for a consumable matching
  // `like.id` (same item kind). Returns the first match or null.
  // Used by consumeActionSlot's auto-refill path.
  _findReplacementConsumable(like) {
    if (!like || !like.id) return null;
    for (const g of this.allGridsIncludingPouch()) {
      for (const e of g.entries()) {
        const it = e.item;
        if (!it || it.type !== 'consumable') continue;
        if (it.id === like.id) return it;
      }
    }
    return null;
  }
  _bump() {
    this.version += 1;
    this._recomputeCapacity();
    this._syncBackpackView();
    // Persist the pouch whenever anything changes so a page reload
    // mid-run keeps pouched items safe.
    this.savePouch();
  }
  // Rebuild the legacy `backpack` array view from ALL grids. Order:
  // pockets → rig → backpack, insertion order within each. Legacy
  // callers see a compact list.
  _syncBackpackView() {
    const out = this.pocketsGrid.items();
    if (this.rigGrid) out.push(...this.rigGrid.items());
    if (this.backpackGrid) out.push(...this.backpackGrid.items());
    this.backpack = out;
  }

  // Legacy hook — gear can still flag actionSlotBonus, but we now
  // surface all 4 quickslots unconditionally so the drag-to-bind UX
  // stays consistent. Without this, players hit a silent rejection
  // when dropping a grenade into slot 4 unless the right belt/chest
  // was equipped, which felt like a bug rather than a mechanic.
  bonusActionSlotActive() {
    for (const slot of SLOT_IDS) {
      const it = this.equipment[slot];
      if (it && it.actionSlotBonus) return true;
    }
    return false;
  }
  maxActionSlots() {
    return ACTION_SLOT_COUNT;
  }

  _recomputeCapacity() {
    this._refreshContainerGrid('belt',     'rigGrid');
    this._refreshContainerGrid('backpack', 'backpackGrid');
    // maxBackpack/basePockets kept as "total cells available
    // anywhere" for legacy callers. Tarkov UIs don't use them.
    let total = this.pocketsGrid.capacity();
    if (this.rigGrid)      total += this.rigGrid.capacity();
    if (this.backpackGrid) total += this.backpackGrid.capacity();
    this.maxBackpack = total;
  }

  // Make sure the grid attached to an equipment slot matches the
  // equipped item's gridLayout. Items that were in the old grid but
  // don't fit the new one spill to pockets; if pockets are full,
  // they're permanently dropped (matches what swapping packs does
  // in Tarkov — your old pack contents fall out if you can't catch
  // them).
  _refreshContainerGrid(slot, field) {
    const item = this.equipment[slot];
    const layout = item ? deriveGridLayout(item) : null;
    const existing = this[field];
    // Container persistence: if the current live grid belongs to a
    // different item than is now equipped (e.g. swap or unequip),
    // snapshot the existing grid's entries onto that former owner's
    // `_contents` so re-equipping it restores the layout.
    if (existing && existing._owner && existing._owner !== item) {
      existing._owner._contents = existing.entries().map(e => ({
        item: e.item, x: e.x, y: e.y, rotated: e.rotated,
      }));
    }
    if (!layout) {
      // Slot empty. The grid's contents (if any) have been saved to
      // the former owner above; drop the live grid.
      this[field] = null;
      return;
    }
    // Already have a live grid owned by THIS item with matching
    // dimensions — nothing to do.
    if (existing && existing._owner === item
        && existing.w === layout.w && existing.h === layout.h) {
      return;
    }
    // Build fresh grid for this container, tagged with its owner.
    const fresh = new GridContainer(layout.w, layout.h);
    fresh._owner = item;
    // Same-item layout change (rare: pack got resized while worn) —
    // migrate from the existing grid. Otherwise existing belonged to
    // a different owner and its contents are already saved off.
    if (existing && existing._owner === item) {
      for (const entry of existing.entries()) {
        if (!fresh.place(entry.item, entry.x, entry.y, entry.rotated)) {
          if (!fresh.autoPlace(entry.item)) {
            this.pocketsGrid.autoPlace(entry.item);
          }
        }
      }
    }
    // Restore the new item's saved contents (if any).
    if (item._contents && item._contents.length) {
      for (const c of item._contents) {
        if (!c || !c.item) continue;
        stampItemDims(c.item);
        if (!fresh.place(c.item, c.x | 0, c.y | 0, !!c.rotated)) {
          if (!fresh.autoPlace(c.item)) {
            this.pocketsGrid.autoPlace(c.item);
          }
        }
      }
      item._contents = null;
    }
    this[field] = fresh;
  }

  slotLabel(slot) { return SLOT_LABEL[slot] || slot; }

  canSlotHold(slot, item) {
    if (!item) return true;
    if (slot === 'weapon1' || slot === 'weapon2') return item.type === 'ranged';
    if (slot === 'melee') return item.type === 'melee';
    if (slot === 'backpack') return item.slot === 'backpack';
    return item.slot === slot;
  }

  firstCompatibleSlot(item) {
    if (item.type === 'ranged') return 'weapon1';
    if (item.type === 'melee') return 'melee';
    if (item.slot) return item.slot;
    return null;
  }

  firstEmptyCompatibleSlot(item) {
    if (item.type === 'ranged') {
      if (!this.equipment.weapon1) return 'weapon1';
      if (!this.equipment.weapon2) return 'weapon2';
      return null;
    }
    if (item.type === 'melee') return this.equipment.melee ? null : 'melee';
    if (item.slot && !this.equipment[item.slot]) return item.slot;
    return null;
  }

  // Legacy "somewhere in bag has room" check. Tries a 1×1 cell as
  // the canonical "does ANY container have room" signal. Returns
  // a flat index into the concatenated view when >= 0, or -1.
  firstFreeBackpackIdx() {
    for (const g of this.allGrids()) {
      const p = g.findEmpty({ w: 1, h: 1 }, false);
      if (p) return p.y * g.w + p.x;
    }
    return -1;
  }
  canAcceptInPockets(item) {
    if (!item) return false;
    stampItemDims(item);
    for (const g of this.allGrids()) {
      if (g.findEmpty(item, true)) return true;
    }
    return false;
  }
  // Try to drop the item into any container grid, in preference
  // order. Returns the placing grid + entry or null.
  autoPlaceAnywhere(item) {
    stampItemDims(item);
    for (const g of this.allGrids()) {
      const e = g.autoPlace(item);
      if (e) return { grid: g, entry: e };
    }
    return null;
  }

  add(item) {
    if (!item) return { placed: false };
    stampItemDims(item);
    // Stackable items — consumables (5 per stack universal) and
    // junk (per-def stackMax of 3 / 5 / 9 by realistic carry load).
    // Toys, throwables, and attachments deliberately don't stack:
    // toys are unique souvenirs, throwables use charges, attachments
    // each carry their own rolled stats.
    if (item.type === 'consumable' || (item.type === 'junk' && item.stackMax)) {
      const cap = item.type === 'consumable'
        ? CONSUMABLE_STACK_MAX
        : Math.max(1, item.stackMax | 0);
      let remaining = (item.count | 0) || 1;
      for (const g of this.allGridsIncludingPouch()) {
        for (const e of g.entries()) {
          const ex = e.item;
          if (!ex || ex.id !== item.id || ex.type !== item.type) continue;
          const exCount = (ex.count | 0) || 1;
          if (exCount >= cap) continue;
          const room = cap - exCount;
          const moved = Math.min(room, remaining);
          ex.count = exCount + moved;
          remaining -= moved;
          if (remaining <= 0) { this._bump(); return { placed: true, merged: true }; }
        }
      }
      // Anything left over places as a fresh instance with the
      // remaining count — autoPlaceAnywhere finds a spot.
      item.count = remaining;
      const r = this.autoPlaceAnywhere(item);
      if (!r) return { placed: false };
      this._bump();
      return { placed: true, pocketEntry: r.entry };
    }
    // Throwables, attachments, junk-without-stackMax (defensive),
    // and toys all live loose but never stack.
    if (item.type === 'throwable' || item.type === 'attachment'
        || item.type === 'junk'   || item.type === 'toy') {
      const r = this.autoPlaceAnywhere(item);
      if (!r) return { placed: false };
      this._bump();
      return { placed: true, pocketEntry: r.entry };
    }
    const slot = this.firstEmptyCompatibleSlot(item);
    if (slot) {
      this.equipment[slot] = item;
      this._bump();
      return { placed: true, slot };
    }
    const r = this.autoPlaceAnywhere(item);
    if (r) {
      this._bump();
      return { placed: true, pocketEntry: r.entry };
    }
    return { placed: false };
  }

  // Slot an attachment onto a weapon; any previously-slotted
  // attachment is returned to any free grid. Fails if the
  // attachment is incompatible or all grids are full.
  attachToWeapon(weapon, slot, attachment) {
    if (!weapon || !weapon.attachments) return false;
    if (!(slot in weapon.attachments)) return false;
    if (attachment.slot !== slot) return false;
    const previous = weapon.attachments[slot];
    if (previous) {
      stampItemDims(previous);
      if (!this.autoPlaceAnywhere(previous)) return false;
    }
    weapon.attachments[slot] = attachment;
    this._bump();
    return true;
  }

  detachFromWeapon(weapon, slot) {
    if (!weapon || !weapon.attachments) return false;
    const current = weapon.attachments[slot];
    if (!current) return false;
    stampItemDims(current);
    if (!this.autoPlaceAnywhere(current)) return false;
    weapon.attachments[slot] = null;
    this._bump();
    return true;
  }

  unequip(slot) {
    const item = this.equipment[slot];
    if (!item) return false;
    stampItemDims(item);
    // Container persistence is handled automatically by
    // _refreshContainerGrid via the `_owner` tag on each grid — when
    // the slot's item changes, the grid's previous owner gets its
    // contents snapshotted onto `_contents`.
    // Pre-flight: make sure the unequipped item itself can still fit
    // in the surviving grids. Contents travel inside it so no spill.
    const simGrids = [new GridContainer(this.pocketsGrid.w, this.pocketsGrid.h)];
    for (const e of this.pocketsGrid.entries())
      simGrids[0].place(e.item, e.x, e.y, e.rotated);
    if (slot !== 'belt' && this.rigGrid) {
      const g = new GridContainer(this.rigGrid.w, this.rigGrid.h);
      for (const e of this.rigGrid.entries())
        g.place(e.item, e.x, e.y, e.rotated);
      simGrids.push(g);
    }
    if (slot !== 'backpack' && this.backpackGrid) {
      const g = new GridContainer(this.backpackGrid.w, this.backpackGrid.h);
      for (const e of this.backpackGrid.entries())
        g.place(e.item, e.x, e.y, e.rotated);
      simGrids.push(g);
    }
    let placed = false;
    for (const g of simGrids) { if (g.autoPlace(item)) { placed = true; break; } }
    if (!placed) return false;   // nothing mutated yet — safe bail
    // Simulation passed. Commit: clear slot, tear down the dead
    // container grid (contents now live on item._contents), then
    // place the unequipped item.
    this.equipment[slot] = null;
    this._refreshContainerGrid('belt',     'rigGrid');
    this._refreshContainerGrid('backpack', 'backpackGrid');
    this.autoPlaceAnywhere(item);
    this._bump();
    return true;
  }

  // Equip an item currently in any grid. `ref` can be the item
  // itself OR (legacy) a flat-array index into this.backpack.
  //
  // Container-swap behaviour: when the slot is `belt` (rig) or
  // `backpack` and a container is already equipped, the OLD
  // container's live contents are migrated into the NEW container's
  // grid. If the new grid can't hold them all, the swap is REFUSED
  // (no mutation) and `lastEquipError` is set to 'tooSmallForRig' or
  // 'tooSmallForBag'. UI consumers read that error to surface the
  // "use the workspace to swap" hint.
  equipBackpack(ref) {
    this.lastEquipError = null;
    const item = (typeof ref === 'number') ? this.backpack[ref] : ref;
    if (!item) return false;
    // Consumables and attachments stay loose (attachments go onto
    // weapons through attachToWeapon).
    if (item.type === 'consumable' || item.type === 'throwable' || item.type === 'attachment') return false;
    const slot = this.firstEmptyCompatibleSlot(item) || this.firstCompatibleSlot(item);
    if (!slot) return false;
    const prev = this.equipment[slot];
    const isContainerSlot = (slot === 'backpack' || slot === 'belt');

    // Pull the new item out of its current grid up front so the
    // container-swap pre-flight below can't double-count it. Without
    // this, equipping a belt that lives inside the currently-worn
    // belt's rig grid causes the item to be migrated into the new
    // rig as well as equipped — the dupe path.
    const owningGrid = this.gridOf(item);
    if (owningGrid) owningGrid.remove(item);

    // Container swap pre-flight. If we're replacing an equipped
    // backpack/rig with a different one, sim-place every item that
    // currently lives in the old container into the new container's
    // grid (factoring in whatever was saved on the new bag's
    // `_contents` from a previous wear). Refuse the swap if anything
    // doesn't fit; on failure we restore `item` to its origin so the
    // bail is clean.
    let captureFromOld = null;
    if (isContainerSlot && prev) {
      const liveGrid = (slot === 'backpack') ? this.backpackGrid : this.rigGrid;
      const newLayout = deriveGridLayout(item);
      if (newLayout && liveGrid && liveGrid.entries().length > 0) {
        const sim = new GridContainer(newLayout.w, newLayout.h);
        // Pre-place anything the new bag remembers from a prior
        // doff — those slots get reserved before old contents try.
        if (item._contents) {
          for (const c of item._contents) {
            if (!c || !c.item) continue;
            stampItemDims(c.item);
            if (!sim.place(c.item, c.x | 0, c.y | 0, !!c.rotated)) {
              if (!sim.autoPlace(c.item)) {
                this.lastEquipError = (slot === 'backpack') ? 'tooSmallForBag' : 'tooSmallForRig';
                if (owningGrid) owningGrid.autoPlace(item);
                return false;
              }
            }
          }
        }
        for (const entry of liveGrid.entries()) {
          stampItemDims(entry.item);
          if (!sim.autoPlace(entry.item)) {
            this.lastEquipError = (slot === 'backpack') ? 'tooSmallForBag' : 'tooSmallForRig';
            if (owningGrid) owningGrid.autoPlace(item);
            return false;
          }
        }
        // Pre-flight passed. Snapshot the old bag's contents so we
        // can place them into the freshly-built new grid below, and
        // clear them out of the live grid so _refreshContainerGrid
        // doesn't mistakenly snapshot them onto the OLD item.
        captureFromOld = liveGrid.entries().map((e) => ({
          item: e.item, x: e.x, y: e.y, rotated: e.rotated,
        }));
        for (const e of captureFromOld) liveGrid.remove(e.item);
      }
    }

    this.equipment[slot] = item;
    // Refresh rig/backpack grids now (e.g., if we just equipped a
    // new rig, its grid must exist before we try to place the
    // displaced previous item).
    this._refreshContainerGrid('belt',     'rigGrid');
    this._refreshContainerGrid('backpack', 'backpackGrid');

    // Migrate the captured old-bag contents into the freshly built
    // new container grid. The pre-flight already proved every entry
    // fits, so autoPlace is a guaranteed success — but place at the
    // saved coordinates first to preserve layout when possible.
    if (captureFromOld) {
      const newGrid = (slot === 'backpack') ? this.backpackGrid : this.rigGrid;
      if (newGrid) {
        for (const e of captureFromOld) {
          stampItemDims(e.item);
          if (!newGrid.place(e.item, e.x, e.y, e.rotated)) newGrid.autoPlace(e.item);
        }
      }
      // Old bag is going back into inventory empty — wipe any saved
      // contents so re-equipping it doesn't dupe the migrated items.
      if (prev) prev._contents = null;
    }

    if (prev) {
      stampItemDims(prev);
      if (!this.autoPlaceAnywhere(prev)) {
        // No room for the previous equipment — rollback.
        this.equipment[slot] = prev;
        this._refreshContainerGrid('belt',     'rigGrid');
        this._refreshContainerGrid('backpack', 'backpackGrid');
        if (owningGrid && owningGrid === this.gridOf({})) {
          // owningGrid may have been destroyed during rebuild.
          this.autoPlaceAnywhere(item);
        } else if (owningGrid) {
          this.autoPlaceAnywhere(item);
        }
        this.lastEquipError = 'noRoomForOld';
        return false;
      }
    }
    this._bump();
    return true;
  }

  // Legacy counterpart to takeFromBackpack — accepts an item
  // reference OR a flat-array index. Removes from whichever grid
  // it currently lives in.
  takeFromBackpack(ref) {
    const item = (typeof ref === 'number') ? this.backpack[ref] : ref;
    if (!item) return null;
    const g = this.gridOf(item);
    if (g) g.remove(item);
    this._bump();
    return item;
  }

  // Q-cycle order: weapon1, weapon2, melee.
  getWeaponRotation() {
    const out = [];
    if (this.equipment.weapon1) out.push(this.equipment.weapon1);
    if (this.equipment.weapon2) out.push(this.equipment.weapon2);
    if (this.equipment.melee) out.push(this.equipment.melee);
    return out;
  }

  // Aggregate gear/armor stats. Broken items (durability.current <= 0)
  // contribute NOTHING — no reduction, no speed / stealth modifiers,
  // no apply() callback, no affixes, no perks. Players need to repair
  // broken gear at a shop to get the stats back. Set membership still
  // counts via countEquippedSetPieces (separate code path) so a broken
  // 4-piece set stays "equipped" for set-bonus tracking — design call
  // we can flip if it feels wrong.
  applyTo(stats) {
    for (const slot of SLOT_IDS) {
      const item = this.equipment[slot];
      if (!item) continue;
      const broken = item.durability && item.durability.current <= 0;
      if (broken) continue;
      if (item.reduction) stats.dmgReduction += item.reduction;
      if (item.speedMult) stats.moveSpeedMult *= item.speedMult;
      if (item.stealthMult) stats.stealthMult = (stats.stealthMult || 1) * item.stealthMult;
      if (typeof item.apply === 'function') item.apply(stats);
      // Random affixes (Diablo-style) — kind describes the stat it bumps.
      for (const aff of item.affixes || []) applyAffix(aff, stats);
      // Gear perks — each item can roll up to 3 on legendary.
      for (const p of item.perks || []) {
        const def = GEAR_PERKS[p.id];
        if (def) def.apply(stats);
        // Flag triggered perks so main can check them at event time.
        if (def && def.trigger) {
          stats.triggerPerks = stats.triggerPerks || {};
          stats.triggerPerks[def.trigger] = stats.triggerPerks[def.trigger] || [];
          stats.triggerPerks[def.trigger].push(p.id);
        }
      }
    }
    // Set-bonus tiers — applied once after per-item stats so the tier
    // apply() functions can stack correctly on the summed bag.
    applySetBonuses(this.equipment, stats);
  }

  // Used by the medkit hotkey: find the first usable consumable
  // across all containers. Returns the item + an idx into the
  // legacy flat view so old callers keep working.
  findFirstConsumable(predicate = () => true) {
    const all = this.backpack;   // flat view — pockets, rig, backpack
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      if (it && it.type === 'consumable' && predicate(it)) return { item: it, idx: i };
    }
    return null;
  }

  // ——— Phase 2 multi-grid API —————————————————————————————
  // Move an item within its own grid OR to a different grid. Pass
  // the target grid explicitly; moveInPockets and moveInGrid both
  // succeed only when the destination has room.
  moveInGrid(item, grid, newX, newY, rotated = null) {
    if (!grid) return false;
    const ownerGrid = this.gridOf(item);
    if (!ownerGrid) return false;
    if (ownerGrid === grid) {
      const entry = grid.entryForItem(item);
      const ok = grid.move(entry, newX, newY, rotated);
      if (ok) this._bump();
      return ok;
    }
    // Cross-grid move: remove from source, place in target.
    const oldEntry = ownerGrid.entryForItem(item);
    const rot = rotated === null ? oldEntry.rotated : rotated;
    if (!grid.canPlace(item, newX, newY, rot)) return false;
    ownerGrid.remove(item);
    const placed = grid.place(item, newX, newY, rot);
    if (!placed) {
      // Shouldn't happen since we just canPlaced — restore anyway.
      ownerGrid.autoPlace(item);
      return false;
    }
    this._bump();
    return true;
  }
  // Back-compat name kept from Phase 1 — defaults to the pockets grid.
  moveInPockets(item, newX, newY, rotated = null) {
    return this.moveInGrid(item, this.pocketsGrid, newX, newY, rotated);
  }
  placeInPockets(item, x, y, rotated = false) {
    stampItemDims(item);
    const entry = this.pocketsGrid.place(item, x, y, rotated);
    if (entry) this._bump();
    return !!entry;
  }
}
