import { tunables } from './tunables.js';

// Weapon attachments. Each attachment has a `slot` (where it can fit) and a
// `modifier` object that's rolled into the weapon's effective stats each fire.
//
// Type-rooted bonuses: each category exists for one design reason. Suppressors
// trade damage for noise reduction and accuracy. Muzzle devices wrangle spread
// and recoil. Lasers trim hip-fire bloom. Lights blind/dazzle enemies (rarity
// scales BOTH duration and magnitude — a legendary tac light blinds longer and
// degrades enemy aim more severely than a common one). Stocks tame ADS recoil.
// Triggers boost fire rate. Grips reduce ADS spread. Sights drive both ADS
// camera push-in (sightZoom) and the maximum drag distance (adsPeekBonus).
// Bipods and barrel swaps occupy their own niches.
//
// Slot list per weapon is declared on the weapon tunable as `attachmentSlots`.

export const ATTACHMENT_DEFS = {
  // ============================================================
  // MUZZLE — Compensators / brakes / flash hiders
  //   Job: spread + recoil control. No noise reduction (suppressors
  //   live in the same slot below — only one muzzle device fits).
  // ============================================================
  muzzle_compensator: {
    id: 'att_compensator', name: 'Compensator', type: 'attachment',
    slot: 'muzzle', tint: 0x7a7a80,
    description: 'Vented gas-port device. Cuts vertical climb so follow-up shots stay on target. −15% spread.',
    modifier: { hipSpreadMult: 0.85, adsSpreadMult: 0.85 },
  },
  muzzle_brake_a2: {
    id: 'att_brake_a2', name: 'A2 Birdcage', type: 'attachment',
    slot: 'muzzle', tint: 0x484850,
    description: 'GI-pattern flash suppressor. Modest spread reduction with a hint of flash control. −10% spread.',
    modifier: { hipSpreadMult: 0.90, adsSpreadMult: 0.90 },
  },
  muzzle_brake_ak: {
    id: 'att_brake_ak', name: 'AK Brake', type: 'attachment',
    slot: 'muzzle', tint: 0x46464c,
    description: 'Slant-cut Soviet brake. Drives muzzle down and right, predictable on follow-ups. −18% ADS spread.',
    modifier: { adsSpreadMult: 0.82, hipSpreadMult: 0.92 },
  },
  muzzle_brake_sniper: {
    id: 'att_brake_sniper', name: 'Sniper Brake', type: 'attachment',
    slot: 'muzzle', tint: 0x40444c,
    description: 'Heavy radial brake for high-recoil rifles. Tames .338+ class follow-ups. −22% ADS spread, +5% recoil control.',
    modifier: { adsSpreadMult: 0.78, hipSpreadMult: 0.95 },
  },
  muzzle_compensator_linear: {
    id: 'att_comp_linear', name: 'Linear Compensator', type: 'attachment',
    slot: 'muzzle', tint: 0x55555c,
    description: 'Pushes blast forward instead of sideways — quieter to your own ears, no real recoil benefit. −5% spread.',
    modifier: { hipSpreadMult: 0.95, adsSpreadMult: 0.95 },
  },
  muzzle_flash_hider: {
    id: 'att_flash_hider', name: 'Flash Hider', type: 'attachment',
    slot: 'muzzle', tint: 0x3c3c44,
    description: 'Three-prong cage. Hides muzzle flash in low light, modest spread benefit. −12% ADS spread.',
    modifier: { adsSpreadMult: 0.88, hipSpreadMult: 0.95 },
  },
  muzzle_flash_hider_long: {
    id: 'att_flash_hider_long', name: 'Long Flash Hider', type: 'attachment',
    slot: 'muzzle', tint: 0x383840,
    description: 'Extended flash cage. More effective night-fighting than the standard hider. −15% ADS spread.',
    modifier: { adsSpreadMult: 0.85, hipSpreadMult: 0.94 },
  },

  // ============================================================
  // MUZZLE — Suppressors (silencers)
  //   Job: noise reduction (matters for AI hearing radius), small
  //   spread benefit, tradeoff is damage drop and slight range cut.
  //   Premium variants (osprey, tactical) reduce noise more without
  //   the same damage penalty.
  // ============================================================
  muzzle_suppressor_short: {
    id: 'att_suppressor_short', name: 'Short Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x383838,
    description: 'Compact baffle stack. Halves report range, costs a sliver of muzzle velocity. −50% noise, −4% damage.',
    modifier: { hipSpreadMult: 0.94, adsSpreadMult: 0.94, damageMult: 0.96, noiseRangeMult: 0.50, suppressed: true },
  },
  muzzle_suppressor: {
    id: 'att_suppressor', name: 'Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x404040,
    description: 'Standard tube can. Drops report below carry distance, eats damage with the velocity loss. −65% noise, −7% damage.',
    modifier: { hipSpreadMult: 0.92, adsSpreadMult: 0.92, damageMult: 0.93, noiseRangeMult: 0.35, suppressed: true },
  },
  muzzle_suppressor_long: {
    id: 'att_suppressor_long', name: 'Long Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x303030,
    description: 'Extended dual-chamber can. Whisper-quiet at the cost of a noticeable damage hit. −75% noise, −10% damage, +5% range.',
    modifier: { hipSpreadMult: 0.90, adsSpreadMult: 0.88, damageMult: 0.90, rangeMult: 1.05, noiseRangeMult: 0.25, suppressed: true },
  },
  muzzle_suppressor_qd: {
    id: 'att_suppressor_qd', name: 'QD Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x383844,
    description: 'Quick-detach can. Less time on the receiver, less metallic ring on the report. −60% noise, −5% damage.',
    modifier: { hipSpreadMult: 0.93, adsSpreadMult: 0.91, damageMult: 0.95, noiseRangeMult: 0.40, suppressed: true },
  },
  muzzle_suppressor_fluted: {
    id: 'att_suppressor_fluted', name: 'Fluted Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x303a3a,
    description: 'Fluted aluminum, gas porting trades blast pressure for tighter groups. −60% noise, −6% damage, −12% spread.',
    modifier: { hipSpreadMult: 0.88, adsSpreadMult: 0.85, damageMult: 0.94, noiseRangeMult: 0.40, suppressed: true },
  },
  muzzle_suppressor_osprey: {
    id: 'att_suppressor_osprey', name: 'Osprey Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x36363c,
    description: 'Eccentric pistol can — sits low so the sights stay clear. Best-in-class noise control. −80% noise, −5% damage.',
    modifier: { hipSpreadMult: 0.92, adsSpreadMult: 0.90, damageMult: 0.95, noiseRangeMult: 0.20, suppressed: true },
  },
  muzzle_suppressor_tactical: {
    id: 'att_suppressor_tactical', name: 'Tactical Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x2a2e2e,
    description: 'Mil-grade Inconel can. Quiet, accurate, expensive. −70% noise, −4% damage, −8% spread.',
    modifier: { hipSpreadMult: 0.90, adsSpreadMult: 0.86, damageMult: 0.96, noiseRangeMult: 0.30, suppressed: true },
  },

  // ============================================================
  // BARREL — Range / RoF / accuracy tradeoffs
  // ============================================================
  barrel_long: {
    id: 'att_barrel_long', name: 'Long Barrel', type: 'attachment',
    slot: 'barrel', tint: 0x60646a,
    description: 'Heavier profile, more dwell time. Buys range and damage at the cost of cyclic rate. +18% range, +10% damage, −7% fire rate.',
    modifier: { rangeMult: 1.18, damageMult: 1.10, fireRateMult: 0.93 },
  },
  barrel_short: {
    id: 'att_barrel_short', name: 'Short Barrel', type: 'attachment',
    slot: 'barrel', tint: 0x60646a,
    description: 'Lopped barrel. Quicker on target with a wider bullet cone. +12% fire rate, +12% spread, −10% range.',
    modifier: { fireRateMult: 1.12, hipSpreadMult: 1.12, adsSpreadMult: 1.10, rangeMult: 0.90 },
  },
  barrel_match: {
    id: 'att_barrel_match', name: 'Match Barrel', type: 'attachment',
    slot: 'barrel', tint: 0x6c7078,
    description: 'Hand-lapped, tighter chamber. Pure accuracy upgrade for precision shooters. −20% ADS spread, +8% damage.',
    modifier: { adsSpreadMult: 0.80, damageMult: 1.08 },
  },

  // ============================================================
  // SIDE RAIL — Lasers (hipfire control) + Lights (AI debuff)
  //   Lasers: no AI effect, all about player accuracy on the move.
  //   Lights: rarity scales DURATION (already) AND MAGNITUDE
  //   (blindSpreadMul / dazzleSpreadMul) so a legendary tac light
  //   debuffs enemy spread harder than a common one.
  // ============================================================
  side_laser_red: {
    id: 'att_laser_red', name: 'Red Laser', type: 'attachment',
    slot: 'sideRail', tint: 0xff3030,
    description: 'Visible red dot, 10m beam. Best hip-fire control inside knife range. −30% hip spread.',
    modifier: { hipSpreadMult: 0.70 },
    kind: 'laser', laserColor: 0xff3030, laserRange: 10,
  },
  side_laser_green: {
    id: 'att_laser_green', name: 'Green Laser', type: 'attachment',
    slot: 'sideRail', tint: 0x30ff60,
    description: 'Brighter green photons, 18m beam. Splits the difference between control and reach. −22% hip spread.',
    modifier: { hipSpreadMult: 0.78 },
    kind: 'laser', laserColor: 0x30ff60, laserRange: 18,
  },
  side_laser_blue: {
    id: 'att_laser_blue', name: 'Blue Laser', type: 'attachment',
    slot: 'sideRail', tint: 0x4080ff,
    description: 'Blue diode, 28m beam. Long reach, less hip-fire correction. −15% hip spread.',
    modifier: { hipSpreadMult: 0.85 },
    kind: 'laser', laserColor: 0x4080ff, laserRange: 28,
  },
  side_laser_pistol: {
    id: 'att_laser_pistol', name: 'Pistol Laser', type: 'attachment',
    slot: 'sideRail', tint: 0xff5050,
    description: 'Compact frame-mounted unit. Fits where rail mounts won\'t, modest 8m beam. −25% hip spread.',
    modifier: { hipSpreadMult: 0.75 },
    kind: 'laser', laserColor: 0xff5050, laserRange: 8,
  },
  // Legacy alias preserved so old saves keep loading.
  side_laser: {
    id: 'att_laser', name: 'Laser Module', type: 'attachment',
    slot: 'sideRail', tint: 0xff3030,
    description: 'Generic visible laser sight. −25% hip spread.',
    modifier: { hipSpreadMult: 0.75 },
    kind: 'laser', laserColor: 0xff3030, laserRange: 10,
  },
  side_flashlight: {
    id: 'att_flashlight', name: 'Flashlight', type: 'attachment',
    slot: 'sideRail', tint: 0xf0e0a0,
    description: 'Bright weapon-mounted lumen cone. Lights dark rooms — no combat effect.',
    modifier: {},
    lightTier: 'basic',
    lightCone: { range: 9, angleDeg: 40 },
  },
  side_tac_light: {
    id: 'att_tac_light', name: 'Tactical Light', type: 'attachment',
    slot: 'sideRail', tint: 0xffe060,
    description: 'High-output tactical beam. Enemies caught in the cone are blinded — their aim degrades for the duration. Higher rarity = longer blind AND worse enemy spread while blind.',
    modifier: {},
    lightTier: 'tactical',
    lightCone: { range: 10, angleDeg: 42 },
    blindDuration: 1.6,
    blindSpreadMul: 2.0,   // enemy spread × this while blinded
  },
  side_strobe: {
    id: 'att_strobe', name: 'Strobe Light', type: 'attachment',
    slot: 'sideRail', tint: 0xffffff,
    description: 'Pulsed strobe disorients beyond just blinding — enemies in the cone briefly cannot fire. Rarity scales the dazzle window AND the blind aim penalty.',
    modifier: {},
    lightTier: 'strobe',
    lightCone: { range: 9, angleDeg: 38 },
    blindDuration: 1.8,
    blindSpreadMul: 2.4,
    dazzleDuration: 0.9,
    dazzleSpreadMul: 3.0,  // dazzle is supposed to feel WORSE than blind
  },
  // Apr-26 EOD batch — PEQ-15 IR designator combo (visible + IR laser).
  side_peq15: {
    id: 'att_peq15', name: 'AN/PEQ-15', type: 'attachment',
    slot: 'sideRail', tint: 0x4a4030,
    description: 'AN/PEQ-15 designator. Visible laser + IR illuminator combo, milspec block. Best hip-fire reach in the slot. −20% hip spread, 22m visible beam.',
    modifier: { hipSpreadMult: 0.80 },
    kind: 'laser', laserColor: 0xff8060, laserRange: 22,
  },

  // ============================================================
  // UNDER RAIL — Foregrips (spread control) + Bipod (sniper aid)
  // ============================================================
  under_foregrip: {
    id: 'att_foregrip', name: 'Vertical Foregrip', type: 'attachment',
    slot: 'underRail', tint: 0x2a2a2e,
    description: 'Vertical handle on the under-rail. Best ADS spread reduction in the slot. −18% spread, +8% ADS zoom.',
    modifier: { hipSpreadMult: 0.82, adsSpreadMult: 0.82, adsZoomMult: 0.92 },
  },
  under_foregrip_angled: {
    id: 'att_foregrip_angled', name: 'Angled Foregrip', type: 'attachment',
    slot: 'underRail', tint: 0x2c2c30,
    description: 'Forward-leaning grip. Better hip control than vertical, slightly less ADS reduction. −15% hip spread, −10% ADS spread.',
    modifier: { hipSpreadMult: 0.85, adsSpreadMult: 0.90 },
  },
  under_foregrip_stubby: {
    id: 'att_foregrip_stubby', name: 'Stubby Grip', type: 'attachment',
    slot: 'underRail', tint: 0x2e2e32,
    description: 'Compact polymer nub. Light, mobile, modest spread benefit. −10% spread, +3% move speed.',
    modifier: { hipSpreadMult: 0.90, adsSpreadMult: 0.90, moveSpeedMult: 1.03 },
  },
  under_grip_canted: {
    id: 'att_grip_canted', name: 'Canted Grip', type: 'attachment',
    slot: 'underRail', tint: 0x2c2c34,
    description: '45-degree grip — natural wrist angle. Light spread bonus, faster transitions. −12% hip spread, +5% reload speed.',
    modifier: { hipSpreadMult: 0.88, reloadTimeMult: 0.95 },
  },
  under_bipod: {
    id: 'att_bipod', name: 'Bipod', type: 'attachment',
    slot: 'underRail', tint: 0x2e2e32,
    description: 'Folding bipod. Massive ADS spread reduction at the cost of footspeed. −30% ADS spread, −8% move speed.',
    modifier: { adsSpreadMult: 0.7, moveSpeedMult: 0.92 },
  },

  // ============================================================
  // TOP RAIL — Sights
  //   sightZoom = ADS frustum push-in (1.05 iron / 1.10 RDS / 1.15
  //   holo / 1.20 mid / 1.30 long). Drives camera close-in. Drag
  //   distance is independent and bumped by adsPeekBonus.
  // ============================================================
  sight_reddot: {
    id: 'att_reddot', name: 'Red Dot', type: 'attachment',
    slot: 'topRail', tint: 0xff4040,
    description: 'Tube-mounted red dot. Faster acquisition, no magnification penalty. −15% ADS spread, 1.10× ADS zoom.',
    modifier: { adsSpreadMult: 0.85 },
    sightZoom: 1.10,
  },
  sight_reflex: {
    id: 'att_reflex', name: 'Reflex Sight', type: 'attachment',
    slot: 'topRail', tint: 0xff6060,
    description: 'Open-emitter reflex sight. Cleaner sight picture than a tube dot. −12% hip spread, −18% ADS spread, 1.10× ADS zoom.',
    modifier: { hipSpreadMult: 0.88, adsSpreadMult: 0.82 },
    sightZoom: 1.10,
  },
  sight_holo: {
    id: 'att_holo', name: 'Holographic', type: 'attachment',
    slot: 'topRail', tint: 0x60a0ff,
    description: 'Heads-up holographic reticle. Mid-range edge, slight magnification. −20% ADS spread, 1.15× ADS zoom.',
    modifier: { adsSpreadMult: 0.8, adsZoomMult: 0.9 },
    sightZoom: 1.15,
  },
  sight_scope: {
    id: 'att_scope', name: 'Mid Scope', type: 'attachment',
    slot: 'topRail', tint: 0x404a60,
    description: 'Variable-power 1-6× optic. Tighter groups at distance, longer ADS drag. −30% ADS spread, 1.20× ADS zoom, +3m drag.',
    modifier: { adsSpreadMult: 0.7, adsZoomMult: 0.65, adsPeekBonus: 3 },
    sightZoom: 1.20,
  },
  sight_long_scope: {
    id: 'att_long_scope', name: 'Long Scope', type: 'attachment',
    slot: 'topRail', tint: 0x2a3140,
    description: 'High-power glass for sniper class. Best ADS group, longest drag. −40% ADS spread, 1.30× ADS zoom, +6m drag.',
    modifier: { adsSpreadMult: 0.6, adsZoomMult: 0.5, adsPeekBonus: 6 },
    sightZoom: 1.30,
  },
  // Apr-26 EOD batch — sights from the Apr 2026 weapon-assigner pass.
  sight_amazon_reddot: {
    id: 'att_reddot_amazon', name: 'Amazon Special Red Dot', type: 'attachment',
    slot: 'topRail', tint: 0xa04040,
    description: 'Mass-market parallax-free dot. Works fine. The stitching on the bag matches the budget.',
    modifier: { adsSpreadMult: 0.92 },
    sightZoom: 1.08,
  },
  sight_prism: {
    id: 'att_prism', name: 'Prism Sight', type: 'attachment',
    slot: 'topRail', tint: 0x4a5060,
    description: 'Etched-glass prism sight. Always-on reticle, zero parallax, slight tube weight. −18% ADS spread, 1.12× ADS zoom.',
    modifier: { adsSpreadMult: 0.82 },
    sightZoom: 1.12,
  },
  sight_holo_uh1: {
    id: 'att_holo_uh1', name: 'Vortex UH-1', type: 'attachment',
    slot: 'topRail', tint: 0x40508a,
    description: 'Vortex Razor UH-1 holographic. EBR-7C reticle, big window, no batteries-out worries. −25% ADS spread, 1.18× ADS zoom.',
    modifier: { adsSpreadMult: 0.75, adsZoomMult: 0.88 },
    sightZoom: 1.18,
  },
  sight_pso: {
    id: 'att_scope_pso', name: 'PSO Scope', type: 'attachment',
    slot: 'topRail', tint: 0x303a30,
    description: 'Soviet 4× PSO sniper scope. Distinctive chevron-and-rangefinder reticle, illuminated tritium dots. −28% ADS spread, 1.22× ADS zoom, +3m drag.',
    modifier: { adsSpreadMult: 0.72, adsZoomMult: 0.65, adsPeekBonus: 3 },
    sightZoom: 1.22,
  },

  // ============================================================
  // STOCK — ADS spread / recoil control with mobility tradeoffs
  // ============================================================
  stock_heavy: {
    id: 'att_stock_heavy', name: 'Heavy Stock', type: 'attachment',
    slot: 'stock', tint: 0x30241a,
    description: 'Solid wood / steel stock. Best ADS spread reduction at the cost of footspeed. −15% ADS spread, −7% spread, −7% move speed.',
    modifier: { hipSpreadMult: 0.93, adsSpreadMult: 0.85, moveSpeedMult: 0.93 },
  },
  stock_skeleton: {
    id: 'att_stock_skeleton', name: 'Skeleton Stock', type: 'attachment',
    slot: 'stock', tint: 0x2a2a30,
    description: 'Skeletonized polymer / steel. Lighter than wood, gives up some ADS control. −10% ADS spread.',
    modifier: { adsSpreadMult: 0.90 },
  },
  stock_cqb: {
    id: 'att_stock_cqb', name: 'CQB Stock', type: 'attachment',
    slot: 'stock', tint: 0x2c2c34,
    description: 'Truncated stub stock. Trades ADS control for mobility — good on close-quarters builds. −5% ADS spread, +5% move speed.',
    modifier: { adsSpreadMult: 0.95, moveSpeedMult: 1.05 },
  },
  stock_folding: {
    id: 'att_stock_folding', name: 'Folding Stock', type: 'attachment',
    slot: 'stock', tint: 0x32323a,
    description: 'Side-folding stock. Balanced — modest ADS reduction, slight reload boost. −8% ADS spread, +5% reload.',
    modifier: { adsSpreadMult: 0.92, reloadTimeMult: 0.95 },
  },
  stock_crane: {
    id: 'att_stock_crane', name: 'Crane Stock', type: 'attachment',
    slot: 'stock', tint: 0x36363e,
    description: 'Adjustable telescoping stock. Length-of-pull tunes per shooter. −12% ADS spread.',
    modifier: { adsSpreadMult: 0.88 },
  },

  // ============================================================
  // GRIP — Pistol grip variants (ADS spread / reload / recovery)
  // ============================================================
  grip_match: {
    id: 'att_grip_match', name: 'Match Grip', type: 'attachment',
    slot: 'grip', tint: 0x5a4a3a,
    description: 'Competition-cut match grip. Tightens shot recovery between trigger pulls. −8% ADS spread, +5% reload.',
    modifier: { adsSpreadMult: 0.92, reloadTimeMult: 0.95 },
  },
  grip_stippled: {
    id: 'att_grip_stippled', name: 'Stippled Grip', type: 'attachment',
    slot: 'grip', tint: 0x4a3a2a,
    description: 'Hand-stippled polymer. Better lock-up under sweat, modest spread benefit. −10% hip spread.',
    modifier: { hipSpreadMult: 0.90 },
  },
  grip_skeleton: {
    id: 'att_grip_skeleton', name: 'Skeleton Grip', type: 'attachment',
    slot: 'grip', tint: 0x3a3a40,
    description: 'Skeletonized aluminum frame. Lighter, faster handling. +5% reload, +3% move speed.',
    modifier: { reloadTimeMult: 0.95, moveSpeedMult: 1.03 },
  },
  grip_rubberized: {
    id: 'att_grip_rubberized', name: 'Rubberized Grip', type: 'attachment',
    slot: 'grip', tint: 0x2a221c,
    description: 'Rubber wrap absorbs recoil pulse. Best for high-caliber pistols. −15% ADS spread.',
    modifier: { adsSpreadMult: 0.85 },
  },

  // ============================================================
  // TRIGGER — Fire rate / shot crispness
  // ============================================================
  trigger_match: {
    id: 'att_trigger_match', name: 'Match Trigger', type: 'attachment',
    slot: 'trigger', tint: 0x2e2a24,
    description: 'Crisp single-stage trigger. Faster cyclic rate, no spread penalty. +12% fire rate.',
    modifier: { fireRateMult: 1.12 },
  },
  trigger_adjustable: {
    id: 'att_trigger_adjustable', name: 'Adjustable Trigger', type: 'attachment',
    slot: 'trigger', tint: 0x322e28,
    description: 'Adjustable pull weight. Highest cyclic uplift, modest spread cost from pre-travel hunt. +15% fire rate, +5% ADS spread.',
    modifier: { fireRateMult: 1.15, adsSpreadMult: 1.05 },
  },

  // ============================================================
  // MAGAZINE — Capacity / reload tradeoffs
  // ============================================================
  mag_extended: {
    id: 'att_mag_extended', name: 'Extended Mag', type: 'attachment',
    slot: 'magazine', tint: 0x40464e,
    description: 'Standard +10 capacity floorplate. +40% mag size, +10% reload time.',
    modifier: { magSizeMult: 1.4, reloadTimeMult: 1.1 },
  },
  mag_drum: {
    id: 'att_mag_drum', name: 'Drum Magazine', type: 'attachment',
    slot: 'magazine', tint: 0x505660,
    description: 'High-capacity drum. Doubles loadout at the cost of reload speed and footspeed. +100% mag size, +25% reload, −5% move speed.',
    modifier: { magSizeMult: 2.0, reloadTimeMult: 1.25, moveSpeedMult: 0.95 },
  },
  mag_banana: {
    id: 'att_mag_banana', name: 'Banana Clip', type: 'attachment',
    slot: 'magazine', tint: 0x3c3a32,
    description: 'Curved 40-round AK-pattern mag. Big capacity boost, tolerable reload. +60% mag size, +15% reload.',
    modifier: { magSizeMult: 1.6, reloadTimeMult: 1.15 },
  },
  mag_lmg_box: {
    id: 'att_mag_lmg_box', name: 'LMG Box Mag', type: 'attachment',
    slot: 'magazine', tint: 0x4a505a,
    description: 'LMG box magazine. Holds two-and-a-half drums in a steel can — sustained fire without reloads. +150% mag size, +35% reload, −5% move speed.',
    modifier: { magSizeMult: 2.5, reloadTimeMult: 1.35, moveSpeedMult: 0.95 },
  },
  mag_hmg_box: {
    id: 'att_mag_hmg_box', name: 'HMG Box Mag', type: 'attachment',
    slot: 'magazine', tint: 0x40464e,
    description: 'Heavy-machine-gun box mag. 250-round count, lugged shoulder strap. Hauling it slows you down; running dry doesn\'t happen. +250% mag size, +60% reload, −12% move speed.',
    modifier: { magSizeMult: 3.5, reloadTimeMult: 1.60, moveSpeedMult: 0.88 },
  },
  mag_fast: {
    id: 'att_mag_fast', name: 'Fast Mag', type: 'attachment',
    slot: 'magazine', tint: 0x484854,
    description: 'Tape-pulled fast mag. Slightly fewer rounds, much faster swap. −10% mag size, −20% reload time.',
    modifier: { magSizeMult: 0.9, reloadTimeMult: 0.80 },
  },

  // ================================================================
  // Apr-26 second-pass batch — wires the remaining tagged FBXes from
  // weapon_assignments.json that didn't have an attachment def yet.
  // Same schema, same modifier conventions; rarity-scaling kicks in
  // automatically via _rollAttachmentRarity / _scaleByRarity.
  // ================================================================

  // -- MUZZLE: brake / suppressor variants ---------------------------
  muzzle_brake_precision: {
    id: 'att_brake_precision', name: 'Precision Muzzle Brake', type: 'attachment',
    slot: 'muzzle', tint: 0x4a4a52,
    description: 'Heavy radial brake for high-precision sniper rifles. Maximum vertical recoil control on a single platform.',
    modifier: { adsSpreadMult: 0.75, hipSpreadMult: 0.94 },
  },
  muzzle_brake_ak2: {
    id: 'att_brake_ak2', name: 'AK Slant Brake', type: 'attachment',
    slot: 'muzzle', tint: 0x44444a,
    description: 'Angled-cut Soviet brake — pushes blast right to counter the platform\'s natural climb.',
    modifier: { adsSpreadMult: 0.80, hipSpreadMult: 0.92 },
  },
  muzzle_suppressor_chinese: {
    id: 'att_suppressor_chinese', name: 'PRC Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x383840,
    description: 'Chinese-issue full-length can. Heavy steel baffle stack. Cuts noise hard at the cost of muzzle velocity.',
    modifier: { rangeMult: 0.90, damageMult: 0.95, noiseRangeMult: 0.40 },
  },
  muzzle_suppressor_russian: {
    id: 'att_suppressor_russian', name: 'PBS Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x363640,
    description: 'Russian PBS-pattern subsonic-tuned can. Best paired with heavy-bullet platforms.',
    modifier: { rangeMult: 0.88, damageMult: 0.93, noiseRangeMult: 0.35 },
  },
  muzzle_suppressor_ka_qd: {
    id: 'att_suppressor_ka_qd', name: 'KA QD Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x3a3a44,
    description: 'Knight\'s Armament quick-detach can. Trades suppression depth for fast on/off swaps.',
    modifier: { rangeMult: 0.95, damageMult: 0.97, noiseRangeMult: 0.50 },
  },

  // -- BARREL: handguard rail kits -----------------------------------
  // Rails replace the standard handguard with a more accessory-
  // friendly platform. Modest spread benefit (better grip indexing)
  // and a small hipfire bonus from the extra mounting weight.
  barrel_rails_quad: {
    id: 'att_rails_quad', name: 'Quad Picatinny Rail', type: 'attachment',
    slot: 'barrel', tint: 0x484850,
    description: 'Four-side milspec picatinny handguard. Heavy, but you can hang anything off it.',
    modifier: { hipSpreadMult: 0.92, adsSpreadMult: 0.92 },
  },
  barrel_rails_mlok: {
    id: 'att_rails_mlok', name: 'M-LOK Handguard', type: 'attachment',
    slot: 'barrel', tint: 0x42424a,
    description: 'M-LOK slot pattern — lighter than a quad rail, same accessory flexibility.',
    modifier: { adsSpreadMult: 0.90, moveSpeedMult: 1.03 },
  },
  barrel_rails_ak: {
    id: 'att_rails_ak', name: 'AK Rail Handguard', type: 'attachment',
    slot: 'barrel', tint: 0x3a3a40,
    description: 'AK-pattern bolt-on rail handguard. Lets older platforms mount modern accessories.',
    modifier: { hipSpreadMult: 0.93, adsSpreadMult: 0.93 },
  },

  // -- SIDE RAIL: extra light variant --------------------------------
  side_flashlight_olight: {
    id: 'att_flashlight_olight', name: 'OLIGHT Pistol Light', type: 'attachment',
    slot: 'sideRail', tint: 0xf0eaa0,
    description: 'Compact pistol-frame light, magnetic rail mount. Wide flood pattern. Lights dark rooms — no combat effect.',
    modifier: {},
    lightTier: 'basic',
    lightCone: { range: 8, angleDeg: 50 },
  },

  // -- UNDER RAIL: extra foregrip variants ---------------------------
  under_foregrip_tan: {
    id: 'att_foregrip_tan', name: 'Vertical Foregrip (Tan)', type: 'attachment',
    slot: 'underRail', tint: 0x6a5a40,
    description: 'Tan-polymer vertical handle. Same control as the black version, different cosmetic.',
    modifier: { hipSpreadMult: 0.82, adsSpreadMult: 0.82, adsZoomMult: 0.92 },
  },
  under_foregrip_angled_tan: {
    id: 'att_foregrip_angled_tan', name: 'Angled Foregrip (Tan)', type: 'attachment',
    slot: 'underRail', tint: 0x6c5e44,
    description: 'Tan forward-leaning grip. Mirrors the black angled grip\'s feel.',
    modifier: { hipSpreadMult: 0.85, adsSpreadMult: 0.90 },
  },
  under_foregrip_vert_alt: {
    id: 'att_foregrip_vert_alt', name: 'Short Vertical Grip', type: 'attachment',
    slot: 'underRail', tint: 0x2a2a30,
    description: 'Short vertical grip — between full-length and stubby. Balanced spread vs mobility.',
    modifier: { hipSpreadMult: 0.88, adsSpreadMult: 0.88, moveSpeedMult: 1.01 },
  },
  under_foregrip_folding: {
    id: 'att_foregrip_folding', name: 'Folding Foregrip', type: 'attachment',
    slot: 'underRail', tint: 0x303034,
    description: 'Folds flat against the handguard when stowed — low-profile carry without sacrificing grip control.',
    modifier: { hipSpreadMult: 0.90, adsSpreadMult: 0.90, moveSpeedMult: 1.05 },
  },

  // -- TOP RAIL: extra scope variants --------------------------------
  sight_scope_6x: {
    id: 'att_scope_6x', name: '6× Sniper Scope', type: 'attachment',
    slot: 'topRail', tint: 0x303a48,
    description: '6× fixed-power glass. Sits between mid-power and long-range scopes — focused on rifle DMR builds.',
    modifier: { adsSpreadMult: 0.68, adsZoomMult: 0.6, adsPeekBonus: 4 },
    sightZoom: 1.24,
  },
  sight_tube: {
    id: 'att_scope_tube', name: 'Tube Scope', type: 'attachment',
    slot: 'topRail', tint: 0x383844,
    description: 'Bullpup-style integrated tube scope. Thin profile, clean reticle, no parallax.',
    modifier: { adsSpreadMult: 0.78, adsZoomMult: 0.85 },
    sightZoom: 1.15,
  },
  sight_sniper_alt: {
    id: 'att_scope_sniper', name: 'Long-Range Scope', type: 'attachment',
    slot: 'topRail', tint: 0x282e3a,
    description: 'Heavy long-range scope — same role as the Long Scope, milled-aluminum body.',
    modifier: { adsSpreadMult: 0.62, adsZoomMult: 0.55, adsPeekBonus: 5 },
    sightZoom: 1.28,
  },
};

export const ALL_ATTACHMENTS = Object.values(ATTACHMENT_DEFS);
function clone(def) { return { ...def, modifier: { ...def.modifier } }; }

// Lazy import — attachments.js loads before inventory.js, so we
// require the helper at call time to dodge the import cycle.
let _maybeApplyMastercraft = null;
function _lazyMC() {
  if (_maybeApplyMastercraft) return _maybeApplyMastercraft;
  try {
    // dynamic require pattern via window.__inv shim populated in inventory.js
    _maybeApplyMastercraft = (typeof window !== 'undefined' && window.__inv?.maybeApplyMastercraft) || null;
  } catch (_) {}
  return _maybeApplyMastercraft;
}

// Roll a rarity for a freshly-spawned attachment. Distribution mirrors
// loot rarity weights (most common, occasional rare+, very rare epic+).
function _rollAttachmentRarity() {
  const r = Math.random();
  if (r < 0.65) return 'common';
  if (r < 0.88) return 'uncommon';
  if (r < 0.97) return 'rare';
  if (r < 0.997) return 'epic';
  return 'legendary';
}

// Per-rarity scaling factor for an attachment's mechanical modifier.
// Bonuses (mults > 1) grow further; penalties / spread reductions
// (mults < 1) tighten further toward 0; flat additive bonuses scale
// up. A common attachment sits at the authored values; a legendary
// roughly doubles the effect strength.
const RARITY_BOOST = {
  common:    1.00,
  uncommon:  1.15,
  rare:      1.35,
  epic:      1.65,
  legendary: 2.00,
};

// Per-modifier-field policy: which direction is "good" for the player.
// Higher rarity amplifies the good direction and softens the tradeoff
// (moves it toward neutral 1.0). Without this, a legendary suppressor
// would have WORSE damage penalty than a common one, which is wrong.
const GOOD_WHEN = {
  damageMult: 'higher',
  rangeMult: 'higher',
  fireRateMult: 'higher',
  magSizeMult: 'higher',
  reloadTimeMult: 'lower',     // less time = good
  hipSpreadMult: 'lower',
  adsSpreadMult: 'lower',
  noiseRangeMult: 'lower',
  moveSpeedMult: 'higher',
  adsZoomMult: 'lower',        // smaller frustum = more zoom = good
};

function _scaleModifierByRarity(mod, rarity) {
  if (!mod) return;
  const k = RARITY_BOOST[rarity] || 1.0;
  if (k === 1.0) return;
  for (const key of Object.keys(mod)) {
    const v = mod[key];
    if (typeof v !== 'number') continue;
    const goodWhen = GOOD_WHEN[key];
    if (!goodWhen) {
      // Unknown field — flat additive scale, keep old behavior.
      if (v === 0) continue;
      if (v > 1)      mod[key] = +(1 + (v - 1) * k).toFixed(3);
      else if (v < 1) mod[key] = +Math.max(0.1, 1 - (1 - v) * k).toFixed(3);
      continue;
    }
    const isBenefit = (goodWhen === 'higher' && v > 1) || (goodWhen === 'lower' && v < 1);
    if (isBenefit) {
      // Amplify away from 1.0 — same as before, with a small floor.
      if (v > 1) mod[key] = +(1 + (v - 1) * k).toFixed(3);
      else       mod[key] = +Math.max(0.1, 1 - (1 - v) * k).toFixed(3);
    } else {
      // Tradeoff — soften toward 1.0 at higher rarity (less bad).
      // At k=1 unchanged, at k=2 about half the gap closed.
      const closeBy = (k - 1) / k;
      mod[key] = +(v + (1 - v) * closeBy).toFixed(3);
    }
  }
}

// Stamp a rolled rarity onto an attachment instance and scale its
// modifier to match. No-op if rarity is already set so callers can
// safely run this on attachments that came from other paths
// (shop-stock generators, debug spawns, etc.) without double-scaling.
// Exported so every attachment-spawn site in the game funnels through
// the same rolling logic.
export function rollAttachmentRarity(att) {
  if (!att || att.rarity) return att;
  att.rarity = _rollAttachmentRarity();
  _scaleModifierByRarity(att.modifier, att.rarity);
  // Light attachments — blind / dazzle durations live OUTSIDE the
  // modifier block (the cone-sweep code reads them directly off the
  // instance), so the modifier scaler doesn't touch them. Scale them
  // here so a legendary strobe / tactical light reads as visibly
  // longer-lasting than a common roll.
  const k = RARITY_BOOST[att.rarity] || 1.0;
  if (k !== 1.0) {
    if (typeof att.blindDuration === 'number') {
      att.blindDuration = +(att.blindDuration * k).toFixed(2);
    }
    if (typeof att.dazzleDuration === 'number') {
      att.dazzleDuration = +(att.dazzleDuration * k).toFixed(2);
    }
    // Magnitude — how bad the blinded enemy's spread gets while
    // affected. Common = baseline; legendary scales the *bonus*
    // above the baseline of 1.0 by k. So blindSpreadMul: 2.0 (a
    // +1.0 inflation over no-effect) becomes 2.0 + 1.0 * (k-1)
    // for legendary = 2.0 + 1.0 * 1.0 = 3.0.
    if (typeof att.blindSpreadMul === 'number') {
      const bonus = att.blindSpreadMul - 1.0;
      att.blindSpreadMul = +(1.0 + bonus * k).toFixed(2);
    }
    if (typeof att.dazzleSpreadMul === 'number') {
      const bonus = att.dazzleSpreadMul - 1.0;
      att.dazzleSpreadMul = +(1.0 + bonus * k).toFixed(2);
    }
  }
  return att;
}

export function randomAttachment() {
  const att = clone(ALL_ATTACHMENTS[Math.floor(Math.random() * ALL_ATTACHMENTS.length)]);
  // Stamp a rolled rarity and scale the modifier to match — common
  // sits at the authored balance, legendary roughly doubles the
  // mechanical effect. Sight reticles read uniformly clear at every
  // rarity (rarity is mechanical, not cosmetic, for attachments).
  rollAttachmentRarity(att);
  // Apply universal mastercraft roll. Mastercraft attachments boost
  // every numeric modifier toward the player (multipliers >1 × 1.5,
  // <1 multipliers tightened by 1.5× toward zero) so the mod sheet
  // reads as a clearly-better roll.
  const mc = _lazyMC();
  if (mc) {
    const before = !!att.mastercraft;
    mc(att);
    if (att.mastercraft && !before && att.modifier) {
      const m = att.modifier;
      // Numeric boost — bump values that the player perceives as
      // "stronger." Mults >1 grow, <1 shrink further (more bonus).
      const grow = (k) => { if (typeof m[k] === 'number') m[k] = +(m[k] * 1.5).toFixed(3); };
      const tighten = (k) => { if (typeof m[k] === 'number' && m[k] < 1) m[k] = +(m[k] / 1.5).toFixed(3); };
      grow('damageMult'); grow('rangeMult'); grow('fireRateMult'); grow('magSizeMult');
      tighten('hipSpreadMult'); tighten('adsSpreadMult'); tighten('reloadTimeMult');
      if (typeof m.magSizeBonus === 'number') m.magSizeBonus = Math.round(m.magSizeBonus * 1.5);
    }
  }
  return att;
}

// Mark a weapon's cached effective view as stale. Call after mutating
// `w.attachments[slot]`, mastercraft modifiers, or any base stat field
// `effectiveWeapon` reads (damage, hipSpread, range, fireRate, reloadTime,
// magSize, adsZoom, adsPeekDistance). `ammo` and `reloadingT` are
// mutated freely on the live weapon and are NOT read here, so those
// don't need to invalidate.
export function invalidateEffectiveWeapon(w) {
  if (w) w._effDirty = true;
}

// Compute the *effective* (base × attachments) version of a weapon.
// Cached on the weapon object — `effectiveWeapon` is called 10+ times
// per frame (HUD, AI vision, hud overlays, scene zoom, etc.) and each
// call previously did a full attachment-loop iteration plus a fresh
// object spread. The cache is invalidated by `invalidateEffectiveWeapon`
// at every mutation point. Callers mutate `ammo`/`reloadingT` on the
// original weapon, not on this cached copy.
export function effectiveWeapon(w) {
  if (!w) return null;
  if (w._effCache && !w._effDirty) return w._effCache;
  const eff = { ...w };
  const atts = w.attachments || {};
  let lightAtt = null;
  // Iron-sight default; overridden by any topRail sight that carries a
  // sightZoom value. Drives the ADS frustum shrink in scene.js so the
  // push-in matches the equipped optic.
  eff.sightZoom = 1.05;
  // noiseRangeMult is multiplicative across attachments. Default 1.0;
  // suppressors apply 0.20-0.50. Read by alertEnemiesFromShot.
  eff.noiseRangeMult = 1.0;
  for (const slot in atts) {
    const a = atts[slot];
    if (!a) continue;
    if (a.lightTier) lightAtt = a;
    if (typeof a.sightZoom === 'number') eff.sightZoom = a.sightZoom;
    const m = a.modifier || {};
    if (m.damageMult) eff.damage *= m.damageMult;
    if (m.hipSpreadMult) eff.hipSpread *= m.hipSpreadMult;
    if (m.adsSpreadMult) eff.adsSpread *= m.adsSpreadMult;
    if (m.rangeMult) eff.range *= m.rangeMult;
    if (m.fireRateMult) eff.fireRate *= m.fireRateMult;
    if (m.reloadTimeMult) eff.reloadTime *= m.reloadTimeMult;
    if (m.magSizeMult) eff.magSize = Math.round(eff.magSize * m.magSizeMult);
    if (m.magSizeBonus) eff.magSize += m.magSizeBonus;
    if (m.adsZoomMult) eff.adsZoom *= m.adsZoomMult;
    if (m.adsPeekBonus) eff.adsPeekDistance += m.adsPeekBonus;
    if (m.moveSpeedMult) eff.moveSpeedMult = (eff.moveSpeedMult || 1) * m.moveSpeedMult;
    if (m.noiseRangeMult) eff.noiseRangeMult *= m.noiseRangeMult;
    if (m.suppressed) eff.suppressed = true;
  }
  eff.lightAttachment = lightAtt;  // expose for main's cone test
  w._effCache = eff;
  w._effDirty = false;
  return eff;
}
