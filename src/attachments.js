import { tunables } from './tunables.js';

// Weapon attachments. Each attachment has a `slot` (where it can fit) and a
// `modifier` object that's rolled into the weapon's effective stats each fire.
//
// Light attachments are special: they have a `lightTier` and a `lightCone` —
// per frame main.js sweeps a cone ahead of the player and applies `blindT` /
// `dazzleT` to enemies that fall inside it.
//
// Slot list per weapon is declared on the weapon tunable as `attachmentSlots`.

export const ATTACHMENT_DEFS = {
  // --- Muzzle ---
  muzzle_compensator: {
    id: 'att_compensator', name: 'Compensator', type: 'attachment',
    slot: 'muzzle', tint: 0x7a7a80,
    description: '−15% spread',
    modifier: { hipSpreadMult: 0.85, adsSpreadMult: 0.85 },
  },
  muzzle_suppressor: {
    id: 'att_suppressor', name: 'Suppressor', type: 'attachment',
    slot: 'muzzle', tint: 0x404040,
    description: '−10% spread, −5% damage, quiet',
    modifier: { hipSpreadMult: 0.9, adsSpreadMult: 0.9, damageMult: 0.95, suppressed: true },
  },

  // --- Barrel ---
  barrel_long: {
    id: 'att_barrel_long', name: 'Long Barrel', type: 'attachment',
    slot: 'barrel', tint: 0x60646a,
    description: '+15% range, +8% damage, −5% fire rate',
    modifier: { rangeMult: 1.15, damageMult: 1.08, fireRateMult: 0.95 },
  },
  barrel_short: {
    id: 'att_barrel_short', name: 'Short Barrel', type: 'attachment',
    slot: 'barrel', tint: 0x60646a,
    description: '+10% fire rate, +10% spread',
    modifier: { fireRateMult: 1.10, hipSpreadMult: 1.10, adsSpreadMult: 1.10 },
  },

  // --- Side rail (typical home for lights/lasers) ---
  // Laser sights — three variants tiered by range. Shorter beams
  // give steadier hands at close range; longer beams sacrifice a bit
  // of spread control for reach. All three block on walls + fade
  // along the beam (handled in updateBeamAndCone / laser mesh).
  side_laser_red: {
    id: 'att_laser_red', name: 'Red Laser', type: 'attachment',
    slot: 'sideRail', tint: 0xff3030,
    description: '−30% hip spread · 10m beam (close-quarters)',
    modifier: { hipSpreadMult: 0.70 },
    kind: 'laser', laserColor: 0xff3030, laserRange: 10,
  },
  side_laser_green: {
    id: 'att_laser_green', name: 'Green Laser', type: 'attachment',
    slot: 'sideRail', tint: 0x30ff60,
    description: '−22% hip spread · 18m beam (mid range)',
    modifier: { hipSpreadMult: 0.78 },
    kind: 'laser', laserColor: 0x30ff60, laserRange: 18,
  },
  side_laser_blue: {
    id: 'att_laser_blue', name: 'Blue Laser', type: 'attachment',
    slot: 'sideRail', tint: 0x4080ff,
    description: '−15% hip spread · 28m beam (long range)',
    modifier: { hipSpreadMult: 0.85 },
    kind: 'laser', laserColor: 0x4080ff, laserRange: 28,
  },
  // Legacy id kept so saves with `att_laser` still resolve; aliases
  // the red variant.
  side_laser: {
    id: 'att_laser', name: 'Laser Module', type: 'attachment',
    slot: 'sideRail', tint: 0xff3030,
    description: '−25% hip spread',
    modifier: { hipSpreadMult: 0.75 },
    kind: 'laser', laserColor: 0xff3030, laserRange: 10,
  },
  side_flashlight: {
    id: 'att_flashlight', name: 'Flashlight', type: 'attachment',
    slot: 'sideRail', tint: 0xf0e0a0,
    description: 'Bright cone (no combat effect)',
    modifier: {},
    lightTier: 'basic',
    lightCone: { range: 9, angleDeg: 40 },
  },
  side_tac_light: {
    id: 'att_tac_light', name: 'Tactical Light', type: 'attachment',
    slot: 'sideRail', tint: 0xffe060,
    description: 'Blinds enemies → wider enemy spread',
    modifier: {},
    lightTier: 'tactical',
    lightCone: { range: 10, angleDeg: 42 },
    blindDuration: 1.5,
  },
  side_strobe: {
    id: 'att_strobe', name: 'Strobe Light', type: 'attachment',
    slot: 'sideRail', tint: 0xffffff,
    description: 'Dazzles → enemies briefly cannot fire',
    modifier: {},
    lightTier: 'strobe',
    lightCone: { range: 9, angleDeg: 38 },
    blindDuration: 1.8,
    dazzleDuration: 0.9,
  },

  // --- Under rail ---
  under_foregrip: {
    id: 'att_foregrip', name: 'Vertical Foregrip', type: 'attachment',
    slot: 'underRail', tint: 0x2a2a2e,
    description: '−18% spread, +8% ADS zoom',
    modifier: { hipSpreadMult: 0.82, adsSpreadMult: 0.82, adsZoomMult: 0.92 },
  },
  under_bipod: {
    id: 'att_bipod', name: 'Bipod', type: 'attachment',
    slot: 'underRail', tint: 0x2e2e32,
    description: '−30% ADS spread, −8% move speed',
    modifier: { adsSpreadMult: 0.7, moveSpeedMult: 0.92 },
  },

  // --- Top rail (sights) ---
  sight_reddot: {
    id: 'att_reddot', name: 'Red Dot', type: 'attachment',
    slot: 'topRail', tint: 0xff4040,
    description: '−15% ADS spread',
    modifier: { adsSpreadMult: 0.85 },
  },
  sight_reflex: {
    id: 'att_reflex', name: 'Reflex Sight', type: 'attachment',
    slot: 'topRail', tint: 0xff6060,
    description: '−12% hip spread, −18% ADS spread',
    modifier: { hipSpreadMult: 0.88, adsSpreadMult: 0.82 },
  },
  sight_holo: {
    id: 'att_holo', name: 'Holographic', type: 'attachment',
    slot: 'topRail', tint: 0x60a0ff,
    description: '−20% ADS spread, +10% ADS zoom',
    modifier: { adsSpreadMult: 0.8, adsZoomMult: 0.9 },
  },
  sight_scope: {
    id: 'att_scope', name: 'Mid Scope', type: 'attachment',
    slot: 'topRail', tint: 0x404a60,
    description: '−30% ADS spread, +35% ADS zoom',
    modifier: { adsSpreadMult: 0.7, adsZoomMult: 0.65, adsPeekBonus: 3 },
  },

  // --- Stock ---
  stock_heavy: {
    id: 'att_stock_heavy', name: 'Heavy Stock', type: 'attachment',
    slot: 'stock', tint: 0x30241a,
    description: '−12% spread, −6% move speed',
    modifier: { hipSpreadMult: 0.88, adsSpreadMult: 0.88, moveSpeedMult: 0.94 },
  },

  // --- Grip ---
  grip_match: {
    id: 'att_grip_match', name: 'Match Grip', type: 'attachment',
    slot: 'grip', tint: 0x5a4a3a,
    description: '−8% ADS spread, +5% reload speed',
    modifier: { adsSpreadMult: 0.92, reloadTimeMult: 0.95 },
  },

  // --- Trigger ---
  trigger_match: {
    id: 'att_trigger_match', name: 'Match Trigger', type: 'attachment',
    slot: 'trigger', tint: 0x2e2a24,
    description: '+12% fire rate',
    modifier: { fireRateMult: 1.12 },
  },

  // --- Magazine ---
  mag_extended: {
    id: 'att_mag_extended', name: 'Extended Mag', type: 'attachment',
    slot: 'magazine', tint: 0x40464e,
    description: '+40% magazine, +10% reload time',
    modifier: { magSizeMult: 1.4, reloadTimeMult: 1.1 },
  },
  mag_drum: {
    id: 'att_mag_drum', name: 'Drum Magazine', type: 'attachment',
    slot: 'magazine', tint: 0x505660,
    description: '+100% magazine, +25% reload, −5% move',
    modifier: { magSizeMult: 2.0, reloadTimeMult: 1.25, moveSpeedMult: 0.95 },
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

function _scaleModifierByRarity(mod, rarity) {
  if (!mod) return;
  const k = RARITY_BOOST[rarity] || 1.0;
  if (k === 1.0) return;
  for (const key of Object.keys(mod)) {
    const v = mod[key];
    if (typeof v !== 'number') continue;
    if (v > 1) {
      // Bonus multiplier — grow by (k − 1) above 1.
      mod[key] = +(1 + (v - 1) * k).toFixed(3);
    } else if (v < 1) {
      // Penalty / reduction multiplier — shrink the gap below 1.
      mod[key] = +(1 - (1 - v) * k).toFixed(3);
    } else {
      // Flat additive (rare in this system) — scale by k.
      mod[key] = +(v * k).toFixed(3);
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

// Compute the *effective* (base × attachments) version of a weapon. Returns a
// fresh object each call; callers mutate `ammo`/`reloadingT` on the original
// weapon, not on the effective copy.
export function effectiveWeapon(w) {
  if (!w) return null;
  const eff = { ...w };
  const atts = w.attachments || {};
  let lightAtt = null;
  for (const slot in atts) {
    const a = atts[slot];
    if (!a) continue;
    if (a.lightTier) lightAtt = a;
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
  }
  eff.lightAttachment = lightAtt;  // expose for main's cone test
  return eff;
}
