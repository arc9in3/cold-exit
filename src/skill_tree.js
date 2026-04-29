// Unified skill tree. Two kinds of nodes:
//   - kind: 'general'  → spent with Skill Points (SP) from sub-boss kills
//   - kind: <classId>  → unlocked via class mastery offers (no SP cost)
//
// Every node has a `levels` array; `apply(level, stats, weapon)` mutates the
// derived-stats bag in the player's tick (weapon is the live wielded item, so
// class nodes gate their own activation).
//
// Class trees are intentionally NON-overlapping with mastery tiers — a node
// here either layers a NEW perk on top of mastery or fills out a sub-theme.
// Each class identity is documented in src/classes.js.

// Short-hand helpers ---------------------------------------------------------
function g(id, name, icon, levels, opts = {}) {
  return { id, name, icon, kind: 'general', disc: opts.disc || 'utility', levels, requires: opts.requires || [] };
}
function c(id, classId, name, levels, opts = {}) {
  return { id, name, icon: '◇', kind: classId, levels, requires: opts.requires || [] };
}
// `levels` entries are { desc, cost, apply(stats, weapon) }.
function lvl(desc, cost, apply) { return { desc, cost, apply }; }

export const SKILL_TREE = [
  // ── General perks (SP cost, arranged in mini-trees by theme) ───────────
  g('ghost', 'Ghost', '◐', [
    lvl('−15% enemy detection range',  1, (s) => { s.stealthMult *= 0.85; }),
    lvl('−30% enemy detection range',  1, (s) => { s.stealthMult *= 0.82; }),
    lvl('−50% enemy detection range',  2, (s) => { s.stealthMult *= 0.72; }),
  ], { disc: 'stealth' }),
  g('crouchSpeed', 'Silent Steps', '∴', [
    lvl('+10% move speed while crouched',  1, (s) => { s.crouchMoveBonus = (s.crouchMoveBonus || 1) * 1.10; }),
    lvl('+25% move speed while crouched',  1, (s) => { s.crouchMoveBonus = (s.crouchMoveBonus || 1) * 1.136; }),
    lvl('+50% move speed while crouched',  2, (s) => { s.crouchMoveBonus = (s.crouchMoveBonus || 1) * 1.20; }),
  ], { disc: 'stealth', requires: [{ id: 'ghost', level: 1 }] }),
  g('shadowStrike', 'Shadow Strike', '☽', [
    lvl('Crouched ranged hits deal +30% dmg',  2, (s) => { s.crouchDmgMult *= 1.30; }),
    lvl('Crouched ranged hits deal +60% dmg',  2, (s) => { s.crouchDmgMult *= 1.23; }),
  ], { disc: 'stealth', requires: [{ id: 'ghost', level: 2 }] }),

  g('marksman', 'Marksman', '◎', [
    lvl('−10% spread on all weapons',  1, (s) => { s.rangedSpreadMult *= 0.90; }),
    lvl('−20% spread on all weapons',  1, (s) => { s.rangedSpreadMult *= 0.89; }),
    lvl('−35% spread on all weapons',  2, (s) => { s.rangedSpreadMult *= 0.82; }),
  ], { disc: 'precision' }),
  g('deadeye', 'Deadeye', '⌖', [
    lvl('+5% crit chance',  1, (s) => { s.critChance += 0.05; }),
    lvl('+10% crit chance',  1, (s) => { s.critChance += 0.05; }),
    lvl('+15% crit chance',  2, (s) => { s.critChance += 0.05; }),
  ], { disc: 'precision', requires: [{ id: 'marksman', level: 1 }] }),
  g('finisher', 'Finisher', '✸', [
    lvl('+30% crit damage',  1, (s) => { s.critDamageMult += 0.3; }),
    lvl('+60% crit damage',  2, (s) => { s.critDamageMult += 0.3; }),
  ], { disc: 'precision', requires: [{ id: 'deadeye', level: 1 }] }),
  g('ricochet', 'Ricochet Rounds', '↯', [
    lvl('Shots ricochet once (20% chance)',  2,
      (s) => { s.ricochetCount = Math.max(s.ricochetCount, 1); s.ricochetChance = Math.max(s.ricochetChance, 0.20); }),
    lvl('Shots ricochet once (45% chance)',  2,
      (s) => { s.ricochetChance = Math.max(s.ricochetChance, 0.45); }),
    lvl('Shots ricochet up to twice (60% chance)', 3,
      (s) => { s.ricochetCount = 2; s.ricochetChance = Math.max(s.ricochetChance, 0.60); }),
  ], { disc: 'precision', requires: [{ id: 'marksman', level: 2 }] }),
  g('headshotHeal', 'Vampiric Aim', '♥', [
    lvl('Headshots heal 6 HP',  2, (s) => { s.headshotHeal = Math.max(s.headshotHeal, 6); }),
    lvl('Headshots heal 14 HP', 3, (s) => { s.headshotHeal = Math.max(s.headshotHeal, 14); }),
  ], { disc: 'precision', requires: [{ id: 'deadeye', level: 1 }] }),
  g('shockCrit', 'Shock Rounds', '⚡', [
    lvl('Crits dazzle for 1.0s',  2, (s) => { s.shockOnCrit = Math.max(s.shockOnCrit, 1.0); }),
    lvl('Crits dazzle for 2.0s',  2, (s) => { s.shockOnCrit = Math.max(s.shockOnCrit, 2.0); }),
  ], { disc: 'precision', requires: [{ id: 'deadeye', level: 2 }] }),
  g('goldenBullet', 'Golden Bullet', '★', [
    lvl('2% chance a shot instantly kills non-boss enemies', 3,
      (s) => { s.goldenBulletChance = Math.max(s.goldenBulletChance, 0.02); }),
    lvl('5% chance a shot instantly kills non-boss enemies', 3,
      (s) => { s.goldenBulletChance = Math.max(s.goldenBulletChance, 0.05); }),
  ], { disc: 'precision', requires: [{ id: 'finisher', level: 1 }] }),

  g('ironWill', 'Iron Will', '♥', [
    lvl('+15 max HP',  1, (s) => { s.maxHealthBonus += 15; }),
    lvl('+30 max HP total',  1, (s) => { s.maxHealthBonus += 15; }),
    lvl('+50 max HP total',  2, (s) => { s.maxHealthBonus += 20; }),
  ], { disc: 'toughness' }),
  g('fortitude', 'Fortitude', '◈', [
    lvl('5% damage reduction',  1, (s) => { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.05); }),
    lvl('10% damage reduction',  1, (s) => { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.05); }),
    lvl('15% damage reduction',  2, (s) => { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.05); }),
  ], { disc: 'toughness', requires: [{ id: 'ironWill', level: 2 }] }),
  g('cornered', 'Cornered', '◉', [
    lvl('+15% dmg reduction below 30% HP',  1,
      (s) => { s.cornerReduction = (s.cornerReduction || 0) + 0.15; }),
    lvl('+25% dmg reduction below 30% HP',  2,
      (s) => { s.cornerReduction = (s.cornerReduction || 0) + 0.10; }),
  ], { disc: 'toughness', requires: [{ id: 'ironWill', level: 1 }] }),
  g('resolveTree', 'Resolve', '✚', [
    lvl('+20% health regen',  1, (s) => { s.healthRegenMult *= 1.20; }),
    lvl('+50% health regen, −1s regen delay',  2,
      (s) => { s.healthRegenMult *= 1.25; s.healthRegenDelayBonus -= 1.0; }),
  ], { disc: 'toughness', requires: [{ id: 'ironWill', level: 1 }] }),
  g('secondWind', 'Second Wind', '☯', [
    lvl('Fatal damage is prevented once per run (revive to 40% HP)', 3,
      (s) => { s.secondWindCharges = Math.max(s.secondWindCharges, 1); }),
    lvl('Two revives per run',  3,
      (s) => { s.secondWindCharges = Math.max(s.secondWindCharges, 2); }),
  ], { disc: 'toughness', requires: [{ id: 'ironWill', level: 3 }] }),
  g('adrenalRush', 'Adrenal Rush', '❂', [
    lvl('+25% fire rate while below 35% HP',  2,
      (s) => { s.adrenalOnLowHp = Math.max(s.adrenalOnLowHp, 0.25); }),
    lvl('+50% fire rate while below 35% HP',  3,
      (s) => { s.adrenalOnLowHp = Math.max(s.adrenalOnLowHp, 0.50); }),
  ], { disc: 'toughness', requires: [{ id: 'cornered', level: 1 }] }),

  g('quickHands', 'Quick Hands', '⟳', [
    lvl('−10% reload time',  1, (s) => { s.reloadSpeedMult *= 1.111; }),
    lvl('−20% reload time',  1, (s) => { s.reloadSpeedMult *= 1.125; }),
    lvl('−30% reload time',  2, (s) => { s.reloadSpeedMult *= 1.143; }),
  ], { disc: 'combat' }),
  g('berserkerPerk', 'Berserker', '⚔', [
    lvl('+20% dmg below 50% HP',  1, (s) => { s.berserkBonus = (s.berserkBonus || 0) + 0.20; }),
    lvl('+40% dmg below 50% HP',  2, (s) => { s.berserkBonus = (s.berserkBonus || 0) + 0.20; }),
  ], { disc: 'combat' }),
  g('reloadOnKill', 'Fast Magazine', '⚙', [
    lvl('Kills refill 7% of the current mag', 2,
      (s) => { s.reloadOnKill = Math.max(s.reloadOnKill, 0.07); }),
    lvl('Kills refill 15% of the current mag', 3,
      (s) => { s.reloadOnKill = Math.max(s.reloadOnKill, 0.15); }),
  ], { disc: 'combat' }),
  g('ammoOnHit', 'Scavenged Rounds', '⊕', [
    lvl('10% chance body hits refund 1 round', 1,
      (s) => { s.ammoOnHitChance = Math.max(s.ammoOnHitChance, 0.10); }),
    lvl('20% chance body hits refund 1 round', 2,
      (s) => { s.ammoOnHitChance = Math.max(s.ammoOnHitChance, 0.20); }),
  ], { disc: 'combat' }),

  g('scavenger', 'Scavenger', '⛀', [
    lvl('+1 backpack pocket',  1, (s) => { s.pocketsBonus += 1; }),
    lvl('+2 backpack pockets', 1, (s) => { s.pocketsBonus += 1; }),
    lvl('+3 backpack pockets', 2, (s) => { s.pocketsBonus += 1; }),
  ], { disc: 'utility' }),
  g('ballisticResistTree', 'Ballistic Weave', '◊', [
    lvl('−10% bullet damage',  1, (s) => { s.ballisticResist = Math.min(0.7, s.ballisticResist + 0.10); }),
    lvl('−20% bullet damage',  1, (s) => { s.ballisticResist = Math.min(0.7, s.ballisticResist + 0.10); }),
    lvl('−30% bullet damage',  2, (s) => { s.ballisticResist = Math.min(0.7, s.ballisticResist + 0.10); }),
  ], { disc: 'utility' }),
  g('staminaTraining', 'Endurance', '●', [
    lvl('+15 max stamina, +10% regen',  1,
      (s) => { s.maxStaminaBonus += 15; s.staminaRegenMult *= 1.10; }),
    lvl('+30 max stamina, +25% regen',  2,
      (s) => { s.maxStaminaBonus += 15; s.staminaRegenMult *= 1.136; }),
  ], { disc: 'utility' }),
  g('grenadierMaster', 'Demolitions Master', '✹', [
    lvl('Throwable kills refund 1 charge',  2,
      (s) => { s.throwableRefundOnKill = Math.max(s.throwableRefundOnKill || 0, 1); }),
    lvl('Throwable kills fully reset cooldowns', 3,
      (s) => { s.throwableResetOnKill = 1; }),
  ], { disc: 'utility' }),
  g('explodeKill', 'Final Blast', '✹', [
    lvl('20% chance kills trigger a 3m AoE (18 dmg)',  2,
      (s) => { s.explodeOnKillChance = Math.max(s.explodeOnKillChance, 0.20);
               s.explodeOnKillDmg = Math.max(s.explodeOnKillDmg, 18);
               s.explodeOnKillRadius = Math.max(s.explodeOnKillRadius, 3); }),
    lvl('40% chance kills trigger a 4m AoE (34 dmg)',  3,
      (s) => { s.explodeOnKillChance = Math.max(s.explodeOnKillChance, 0.40);
               s.explodeOnKillDmg = Math.max(s.explodeOnKillDmg, 34);
               s.explodeOnKillRadius = Math.max(s.explodeOnKillRadius, 4); }),
  ], { disc: 'utility' }),
  // Reaper / Bloodletter / Bloodlust / Executioner moved into the melee
  // class tree below — they thematically belong with melee builds and
  // the general tree was getting top-heavy on damage perks.

  // ── Class perks (earned via mastery offers, no SP cost) ────────────────
  // Pistol — Sidearms. Capstone (Akimbo) is mastery only; tree fills out
  // mobility / reload utility.
  c('pst_steady', 'pistol', 'Steady Aim',      [lvl('−15% pistol spread',     0, (s, w) => { if (w?.class === 'pistol') s.rangedSpreadMult *= 0.85; })]),
  c('pst_footwork', 'pistol', 'Footwork',      [
    lvl('+50% backpedal mobility (pistols)', 0, (s, w) => { if (w?.class === 'pistol') s.backpedalRelief = Math.min(1, (s.backpedalRelief || 0) + 0.5); }),
    lvl('+90% backpedal mobility (pistols)', 0, (s, w) => { if (w?.class === 'pistol') s.backpedalRelief = Math.min(1, (s.backpedalRelief || 0) + 0.9); }),
  ], { requires: [{ id: 'pst_steady', level: 1 }] }),
  c('pst_fast',   'pistol', 'Fast Hands',      [lvl('−20% pistol reload',     0, (s, w) => { if (w?.class === 'pistol') s.reloadSpeedMult *= 1.25; })],
    { requires: [{ id: 'pst_steady', level: 1 }] }),
  c('pst_head',   'pistol', "Headhunter's Eye",[lvl('+25% pistol head dmg',    0, (s, w) => { if (w?.class === 'pistol') s.headMultBonus = (s.headMultBonus || 0) + 0.25; })],
    { requires: [{ id: 'pst_fast', level: 1 }] }),
  c('pst_trig',   'pistol', 'Trigger Squeeze', [lvl('+15% pistol fire rate',   0, (s, w) => { if (w?.class === 'pistol') s.fireRateMult *= 1.15; })],
    { requires: [{ id: 'pst_head', level: 1 }] }),
  // No tree-side capstone — Akimbo is mastery-only to remove the
  // double-stack flagged in the rebalance review.

  // SMG — hipfire / fire-rate brawler. Tree owns hip-spread polish and
  // the point-blank damage cone. Capstone (Dual Wield) lives in mastery.
  c('smg_hipfire', 'smg', 'Hipfire Drills',  [lvl('−20% SMG hip spread',  0, (s, w) => { if (w?.class === 'smg') s.hipSpreadOnlyMult = (s.hipSpreadOnlyMult || 1) * 0.8; })]),
  c('smg_point',   'smg', 'Point Blank',     [lvl('+35% SMG dmg within 6m', 0, (s, w) => { if (w?.class === 'smg') s.pointBlankBonus = (s.pointBlankBonus || 0) + 0.35; })],
    { requires: [{ id: 'smg_hipfire', level: 1 }] }),
  c('smg_light',   'smg', 'Light Frame',     [lvl('+8% move speed w/ SMG',0, (s, w) => { if (w?.class === 'smg') s.moveSpeedMult *= 1.08; })],
    { requires: [{ id: 'smg_point', level: 1 }] }),
  c('smg_rof',     'smg', 'Trigger Discipline', [lvl('+12% SMG fire rate', 0, (s, w) => { if (w?.class === 'smg') s.fireRateMult *= 1.12; })],
    { requires: [{ id: 'smg_light', level: 1 }] }),
  c('smg_mag',     'smg', 'Extended Loadout',[lvl('+25% SMG mag size',    0, (s, w) => { if (w?.class === 'smg') s.magSizeMult = (s.magSizeMult || 1) * 1.25; })],
    { requires: [{ id: 'smg_rof', level: 1 }] }),

  // Shotgun — Pointman. Quad Load capstone is mastery; tree adds knockback
  // and pellet sub-themes.
  c('sh_knock', 'shotgun', 'Concussion',    [lvl('+15% shotgun knockback', 0, (s, w) => { if (w?.class === 'shotgun') s.knockbackMult *= 1.15; })]),
  c('sh_open',  'shotgun', 'Open Choke',    [lvl('+10% shotgun damage',    0, (s, w) => { if (w?.class === 'shotgun') s.rangedDmgMult *= 1.10; })],
    { requires: [{ id: 'sh_knock', level: 1 }] }),
  c('sh_plate', 'shotgun', 'Plate Carry',   [lvl('−20% dmg w/ shotgun out', 0, (s, w) => { if (w?.class === 'shotgun') s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.2); })],
    { requires: [{ id: 'sh_open', level: 1 }] }),
  c('sh_bore',  'shotgun', 'Barrel Stuffed',[lvl('+1 shotgun pellet',      0, (s, w) => { if (w?.class === 'shotgun') s.pelletCountBonus = (s.pelletCountBonus || 0) + 1; })],
    { requires: [{ id: 'sh_plate', level: 1 }] }),
  // No tree-side capstone — Quad Load is mastery-only.

  // Rifle — Marksman (full-auto crit chain on body shots). Tree adds
  // fundamentals: spread polish, body-crit chance, body-crit damage.
  c('rf_sight', 'rifle', 'Sight Picture',  [lvl('−15% rifle spread',  0, (s, w) => { if (w?.class === 'rifle') s.rangedSpreadMult *= 0.85; })]),
  c('rf_steady', 'rifle', 'Steady Hold',   [lvl('−15% rifle reload time', 0, (s, w) => { if (w?.class === 'rifle') s.reloadSpeedMult *= 1.176; })],
    { requires: [{ id: 'rf_sight', level: 1 }] }),
  c('rf_bodycrit', 'rifle', 'Marksman\'s Edge', [
    lvl('+8% body-shot crit chance', 0, (s, w) => { if (w?.class === 'rifle') s.bodyCritChanceBonus = (s.bodyCritChanceBonus || 0) + 0.08; }),
    lvl('+15% body-shot crit chance total', 0, (s, w) => { if (w?.class === 'rifle') s.bodyCritChanceBonus = (s.bodyCritChanceBonus || 0) + 0.07; }),
  ], { requires: [{ id: 'rf_steady', level: 1 }] }),
  c('rf_killshot', 'rifle', 'Killshot',  [lvl('+30% body-shot crit damage', 0, (s, w) => { if (w?.class === 'rifle') s.bodyCritDamageBonus = (s.bodyCritDamageBonus || 0) + 0.30; })],
    { requires: [{ id: 'rf_bodycrit', level: 1 }] }),
  c('rf_tracer', 'rifle', 'Tracer Pattern', [lvl('+15% rifle fire rate', 0, (s, w) => { if (w?.class === 'rifle') s.fireRateMult *= 1.15; })],
    { requires: [{ id: 'rf_killshot', level: 1 }] }),

  // LMG — Heavy. Sustained-fire spread bleed is mastery; tree owns the
  // brute-mag / suppression sub-themes.
  c('lmg_drum',  'lmg', 'Quick Drum',   [lvl('−15% LMG reload',        0, (s, w) => { if (w?.class === 'lmg') s.reloadSpeedMult *= 1.176; })]),
  c('lmg_frame', 'lmg', 'Heavy Frame',  [lvl('−10% dmg w/ LMG out',     0, (s, w) => { if (w?.class === 'lmg') s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.10); })],
    { requires: [{ id: 'lmg_drum', level: 1 }] }),
  c('lmg_supp',  'lmg', 'Suppression',  [lvl('+15% LMG damage',        0, (s, w) => { if (w?.class === 'lmg') s.rangedDmgMult *= 1.15; })],
    { requires: [{ id: 'lmg_frame', level: 1 }] }),
  c('lmg_belt',  'lmg', 'Belt Fed',     [lvl('+30% LMG mag size',      0, (s, w) => { if (w?.class === 'lmg') s.magSizeMult = (s.magSizeMult || 1) * 1.30; })],
    { requires: [{ id: 'lmg_supp', level: 1 }] }),
  c('lmg_spray', 'lmg', 'Spray Discipline', [lvl('−15% LMG spread',    0, (s, w) => { if (w?.class === 'lmg') s.rangedSpreadMult *= 0.85; })],
    { requires: [{ id: 'lmg_belt', level: 1 }] }),

  // Sniper — Recon (NEW). Aim-ramp capstone is mastery; tree fills out
  // headshot uplift and stationary-shooter perks.
  c('sn_cheek',   'sniper', 'Cheek Weld',     [lvl('−25% sniper spread', 0, (s, w) => { if (w?.class === 'sniper') s.rangedSpreadMult *= 0.75; })]),
  c('sn_head',    'sniper', 'Head Tracker',   [lvl('+30% sniper headshot dmg', 0, (s, w) => { if (w?.class === 'sniper') s.headMultBonus = (s.headMultBonus || 0) + 0.30; })],
    { requires: [{ id: 'sn_cheek', level: 1 }] }),
  c('sn_pierce',  'sniper', 'Penetrator',     [
    lvl('Sniper rounds pierce 1 enemy', 0, (s, w) => { if (w?.class === 'sniper') s.penetration = Math.max(s.penetration || 0, 1); }),
    lvl('Sniper rounds pierce 2 enemies', 0, (s, w) => { if (w?.class === 'sniper') s.penetration = Math.max(s.penetration || 0, 2); }),
  ], { requires: [{ id: 'sn_head', level: 1 }] }),
  c('sn_ads',     'sniper', 'Lung Drag',      [lvl('+25% ADS speed, −15% sway', 0, (s, w) => { if (w?.class === 'sniper') { s.adsSpeedMult = (s.adsSpeedMult || 1) * 1.25; s.swayMult = (s.swayMult || 1) * 0.85; } })],
    { requires: [{ id: 'sn_pierce', level: 1 }] }),
  c('sn_oneshot', 'sniper', 'One Shot',       [lvl('+30% sniper damage on full-HP targets', 0, (s, w) => { if (w?.class === 'sniper') s.fullHpDmgBonus = (s.fullHpDmgBonus || 0) + 0.30; })],
    { requires: [{ id: 'sn_ads', level: 1 }] }),

  // Exotic — Demolitions (NEW). Replaces the old flame-only tree; covers
  // every unconventional weapon class via `weapon.class === 'exotic'`.
  // Cascade capstone is mastery-only.
  c('ex_long',     'exotic', 'Long Burn',       [lvl('+20% exotic range',    0, (s, w) => { if (w?.class === 'exotic') s.rangeMult = (s.rangeMult || 1) * 1.20; })]),
  c('ex_resist',   'exotic', 'Fire Resistance', [lvl('−40% fire damage taken', 0, (s) => { s.fireResist = Math.min(0.8, s.fireResist + 0.40); })],
    { requires: [{ id: 'ex_long', level: 1 }] }),
  c('ex_super',    'exotic', 'Superheat',       [lvl('+15% exotic damage',   0, (s, w) => { if (w?.class === 'exotic') s.rangedDmgMult *= 1.15; })],
    { requires: [{ id: 'ex_resist', level: 1 }] }),
  c('ex_ling',     'exotic', 'Lingering',       [lvl('+50% burn / status duration', 0, (s, w) => { if (w?.class === 'exotic') s.burnDurationBonus = (s.burnDurationBonus || 1) * 1.50; })],
    { requires: [{ id: 'ex_super', level: 1 }] }),
  c('ex_radius',   'exotic', 'Wide Yield',      [lvl('+25% exotic AoE radius', 0, (s, w) => { if (w?.class === 'exotic') s.exoticRadiusMult = (s.exoticRadiusMult || 1) * 1.25; })],
    { requires: [{ id: 'ex_ling', level: 1 }] }),

  // Melee — Close Quarters. Battle Trance capstone is mastery. Tree now
  // absorbs Bloodlust / Executioner / Bloodletter from the old general tree
  // so a melee build's identity lives in one place.
  c('ml_heavy', 'melee', 'Heavy Hands',    [lvl('+20% melee knockback', 0, (s, w) => { if (w?.class === 'melee') s.knockbackMult *= 1.20; })]),
  c('ml_swift', 'melee', 'Swift',          [lvl('+12% move speed w/ melee', 0, (s, w) => { if (w?.class === 'melee') s.moveSpeedMult *= 1.12; })],
    { requires: [{ id: 'ml_heavy', level: 1 }] }),
  c('ml_force', 'melee', 'Forceful Blows', [lvl('+10% melee damage',    0, (s, w) => { if (w?.class === 'melee') s.meleeDmgMult *= 1.10; })],
    { requires: [{ id: 'ml_swift', level: 1 }] }),
  c('ml_reach', 'melee', 'Long Reach',     [lvl('+0.5m execute range',  0, (s, w) => { if (w?.class === 'melee') s.executeRangeBonus = (s.executeRangeBonus || 0) + 0.5; })],
    { requires: [{ id: 'ml_force', level: 1 }] }),
  c('ml_thirst','melee', 'Bloodletter',    [
    lvl('+5% melee lifesteal',  0, (s, w) => { if (w?.class === 'melee') s.lifestealMeleePercent += 5; }),
    lvl('+10% melee lifesteal total', 0, (s, w) => { if (w?.class === 'melee') s.lifestealMeleePercent += 5; }),
  ], { requires: [{ id: 'ml_reach', level: 1 }] }),
  c('ml_lust',  'melee', 'Bloodlust',      [
    lvl('Melee kills: +30% move speed for 3s', 0, (_s, _w) => { /* trigger-based (meleeKill) */ }),
    lvl('Melee kills: +50% move speed for 4s', 0, (_s, _w) => { /* trigger-based (meleeKill) */ }),
  ], { requires: [{ id: 'ml_thirst', level: 1 }] }),
  c('ml_exec',  'melee', 'Executioner',    [
    lvl('Executes grant +30% all dmg for 6s', 0, (_s, _w) => { /* trigger-based (execute) */ }),
    lvl('+0.5m execute range',                0, (s, w) => { if (w?.class === 'melee') s.executeRangeBonus = (s.executeRangeBonus || 0) + 0.5; }),
  ], { requires: [{ id: 'ml_lust', level: 1 }] }),
];

// Index by id for O(1) lookup.
export const SKILL_NODES = Object.fromEntries(SKILL_TREE.map(n => [n.id, n]));

export function classNodes(classId) {
  return SKILL_TREE.filter(n => n.kind === classId);
}
export function generalNodes() {
  return SKILL_TREE.filter(n => n.kind === 'general');
}

// Loadout tracker ------------------------------------------------------------
export class SkillTreeLoadout {
  constructor() {
    this.levels = Object.create(null); // id → integer level
  }
  level(id) { return this.levels[id] | 0; }
  isAtMax(id) {
    const n = SKILL_NODES[id];
    return n ? this.level(id) >= n.levels.length : true;
  }
  // `perkRequirementsMet` is strictly about node deps, not SP cost.
  requirementsMet(node) {
    for (const r of node.requires || []) {
      if (this.level(r.id) < (r.level | 0)) return false;
    }
    return true;
  }
  // Check if the next level is affordable for `sp` — only relevant for
  // general-kind (class nodes are free, unlocked via mastery offers).
  nextCost(id) {
    const n = SKILL_NODES[id];
    if (!n) return Infinity;
    const lv = this.level(id);
    if (lv >= n.levels.length) return Infinity;
    return n.levels[lv].cost | 0;
  }
  canPurchaseGeneral(id, sp) {
    const n = SKILL_NODES[id];
    if (!n || n.kind !== 'general') return false;
    if (this.isAtMax(id)) return false;
    if (!this.requirementsMet(n)) return false;
    return sp >= this.nextCost(id);
  }
  canUnlockClass(id) {
    const n = SKILL_NODES[id];
    if (!n || n.kind === 'general') return false;
    if (this.isAtMax(id)) return false;
    return this.requirementsMet(n);
  }
  bump(id) {
    const n = SKILL_NODES[id];
    if (!n) return false;
    if (this.isAtMax(id)) return false;
    this.levels[id] = this.level(id) + 1;
    return true;
  }
  applyTo(stats, weapon) {
    for (const id in this.levels) {
      const n = SKILL_NODES[id];
      if (!n) continue;
      const lv = this.levels[id] | 0;
      for (let i = 0; i < lv; i++) {
        n.levels[i].apply(stats, weapon);
      }
    }
  }
  // Triggered perks need a flag table; main.js checks these at event time.
  triggerFlags() {
    const flags = {};
    for (const id in this.levels) {
      if (this.level(id) > 0) flags[id] = this.level(id);
    }
    return flags;
  }
}

// Mastery offers -------------------------------------------------------------
// Returns up to 3 node-ids: 2 from the triggering class + 1 from another
// class. Falls back to whatever's unlockable if a bucket runs dry.
// Requirements ARE enforced — a capstone only shows up after its chain
// predecessor is unlocked. Earlier revision bypassed requires here and
// let a first-pick mastery roll include the capstone, which skipped the
// whole tree.
export function makeMasteryOffers(classId, tree) {
  const eligible = (n) => !tree.isAtMax(n.id) && tree.requirementsMet(n);
  const classOptions = classNodes(classId).filter(eligible);
  const otherClasses = [...new Set(SKILL_TREE.map(n => n.kind).filter(k => k !== 'general' && k !== classId))];
  const otherOptions = [];
  for (const cid of otherClasses) {
    for (const n of classNodes(cid)) {
      if (eligible(n)) otherOptions.push(n);
    }
  }

  const picks = [];
  const pool = [...classOptions];
  for (let i = 0; i < 2 && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  if (otherOptions.length) {
    const idx = Math.floor(Math.random() * otherOptions.length);
    picks.push(otherOptions[idx]);
  }
  // If still short (class maxed, no cross-class options), pad.
  if (picks.length < 3) {
    const leftovers = [...classOptions, ...otherOptions].filter(n => !picks.includes(n));
    while (picks.length < 3 && leftovers.length) {
      const idx = Math.floor(Math.random() * leftovers.length);
      picks.push(leftovers.splice(idx, 1)[0]);
    }
  }
  return picks;
}
