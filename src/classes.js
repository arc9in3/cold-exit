// Weapon-class mastery. Each weapon belongs to a class; kills credit XP to
// that class. Hitting a level threshold unlocks a class perk that applies
// only when wielding a weapon of the same class.
//
// Class identities (post-rebalance) — each class targets a distinct play
// pattern rather than overlapping damage-stat stacks:
//   • pistol    — sidearm specialist; capstone = paired-pistol akimbo
//   • smg       — hipfire / fire-rate brawler; capstone = SMG akimbo
//   • shotgun   — point-blank breacher; capstone = quad-load reload
//   • rifle     — full-auto crit chain (NON-headshot); capstone = ramping
//                 crit damage that builds up with consecutive hits
//   • lmg       — sustained-fire suppressor; capstone = spread bleeds to
//                 zero the longer you hold the trigger
//   • sniper    — headshot king with penetration; capstone = aim-and-hold
//                 damage ramp on stationary targets
//   • exotic    — flamethrower / grenade launcher / rocket launcher / dart /
//                 flare; capstone = chain detonations on kill
//   • melee     — close-quarters brawler; capstone = halved stamina on
//                 attacks + kill refunds
//
// Each class still uses 5 ladder tiers at the same XP thresholds, so the
// pacing is unchanged.

export const CLASS_THRESHOLDS = [80, 200, 420, 800, 1500];

// Helper: each class has 5 level entries. `apply(stats)` runs only if the
// player is wielding a weapon of the class — the wrapper in `CLASS_DEFS.apply`
// handles the class-match gate.
function tier(level, name, desc, apply) {
  return { level, name, desc, apply };
}

export const CLASS_DEFS = {
  pistol: {
    id: 'pistol', label: 'Sidearms',
    levels: [
      tier(1, 'Steady Aim',       '−15% spread on pistols',
        (s) => { s.rangedSpreadMult *= 0.85; }),
      tier(2, 'Fast Hands',       '−20% reload time on pistols',
        (s) => { s.reloadSpeedMult = (s.reloadSpeedMult || 1) * 1.25; }),
      tier(3, "Headhunter's Eye", '+25% pistol headshot dmg',
        (s) => { s.headMultBonus = (s.headMultBonus || 0) + 0.25; }),
      tier(4, 'Trigger Squeeze',  '+15% pistol fire rate',
        (s) => { s.fireRateMult = (s.fireRateMult || 1) * 1.15; }),
      tier(5, 'Akimbo',           'Capstone — fire a paired pistol shot (+1 pellet) and +20% damage',
        (s) => {
          s.pelletCountBonus = (s.pelletCountBonus || 0) + 1;
          s.rangedDmgMult *= 1.20;
        }),
    ],
  },
  smg: {
    id: 'smg', label: 'Submachine Gunner',
    levels: [
      tier(1, 'Hipfire Drills',   '−25% hip spread on SMGs',
        (s) => { s.hipSpreadOnlyMult = (s.hipSpreadOnlyMult || 1) * 0.75; }),
      tier(2, 'Light Frame',      '+8% move speed with an SMG',
        (s) => { s.moveSpeedMult *= 1.08; }),
      tier(3, 'Trigger Discipline','+12% SMG fire rate',
        (s) => { s.fireRateMult = (s.fireRateMult || 1) * 1.12; }),
      tier(4, 'Extended Loadout', '+25% SMG magazine size',
        (s) => { s.magSizeMult = (s.magSizeMult || 1) * 1.25; }),
      tier(5, 'Dual Wield',       'Capstone — SMG akimbo: +1 pellet per shot, +15% fire rate',
        (s) => {
          s.pelletCountBonus = (s.pelletCountBonus || 0) + 1;
          s.fireRateMult = (s.fireRateMult || 1) * 1.15;
        }),
    ],
  },
  shotgun: {
    id: 'shotgun', label: 'Pointman',
    levels: [
      tier(1, 'Concussion',   '+15% knockback with shotguns',
        (s) => { s.knockbackMult *= 1.15; }),
      tier(2, 'Open Choke',   '+10% shotgun damage',
        (s) => { s.rangedDmgMult *= 1.10; }),
      tier(3, 'Plate Carry',  '−20% incoming damage with shotgun out',
        (s) => { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.2); }),
      tier(4, 'Barrel Stuffed','+1 pellet per shot',
        (s) => { s.pelletCountBonus = (s.pelletCountBonus || 0) + 1; }),
      tier(5, 'Quad Load',    'Capstone — reload 4 shells per pump at +50% reload speed',
        (s) => {
          s.shotgunShellsPerPump = Math.max(s.shotgunShellsPerPump || 1, 4);
          s.reloadSpeedMult = (s.reloadSpeedMult || 1) * 1.5;
        }),
    ],
  },
  rifle: {
    id: 'rifle', label: 'Marksman',
    // Reworked away from headshot/range stacking — this class now owns
    // the BODY-shot crit identity. Rifle crits are non-headshot crits
    // by default; the capstone builds a ramping crit-damage chain
    // while you hold full-auto on the same target.
    levels: [
      tier(1, 'Sight Picture', '−15% rifle spread',
        (s) => { s.rangedSpreadMult *= 0.85; }),
      tier(2, 'Stable Stance', '+8% crit chance on body shots (rifle)',
        (s) => { s.bodyCritChanceBonus = (s.bodyCritChanceBonus || 0) + 0.08; }),
      tier(3, 'Steady Hold',   '−20% rifle reload time',
        (s) => { s.reloadSpeedMult = (s.reloadSpeedMult || 1) * 1.25; }),
      tier(4, 'Killshot',      '+30% crit damage on body shots',
        (s) => { s.bodyCritDamageBonus = (s.bodyCritDamageBonus || 0) + 0.30; }),
      tier(5, 'Burst Concentration', 'Capstone — consecutive full-auto hits on one target add +5% crit dmg, capped at +50%; resets after 1.5s without firing',
        (s) => {
          s.rifleAutoChainPerHit = Math.max(s.rifleAutoChainPerHit || 0, 0.05);
          s.rifleAutoChainCap    = Math.max(s.rifleAutoChainCap || 0, 0.50);
          s.rifleAutoChainResetT = Math.max(s.rifleAutoChainResetT || 0, 1.5);
        }),
    ],
  },
  lmg: {
    id: 'lmg', label: 'Heavy',
    levels: [
      tier(1, 'Quick Drum',   '−15% LMG reload time',
        (s) => { s.reloadSpeedMult = (s.reloadSpeedMult || 1) * 1.176; }),
      tier(2, 'Heavy Frame',  '−10% incoming damage with LMG out',
        (s) => { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.10); }),
      tier(3, 'Drum Magazine','+30% LMG magazine size',
        (s) => { s.magSizeMult = (s.magSizeMult || 1) * 1.30; }),
      tier(4, 'Spray Discipline', '−15% LMG spread',
        (s) => { s.rangedSpreadMult *= 0.85; }),
      tier(5, 'Walking Fire', 'Capstone — sustained fire bleeds spread to zero (−15% / sec); resets if you stop firing for 1s',
        (s) => {
          s.lmgSustainedSpreadDecay = Math.max(s.lmgSustainedSpreadDecay || 0, 0.15);
          s.lmgSustainedResetT      = Math.max(s.lmgSustainedResetT || 0, 1.0);
        }),
    ],
  },
  sniper: {
    id: 'sniper', label: 'Recon',
    // New class — bolt/semi-auto long guns. Snipers were previously
    // bucketed under rifle, which hid the headshot-king identity behind
    // the marksman tree. They now own the headshot-multiplier chain
    // plus penetration; rifle keeps body-crit ramps.
    levels: [
      tier(1, 'Cheek Weld',   '−25% sniper spread',
        (s) => { s.rangedSpreadMult *= 0.75; }),
      tier(2, 'Head Tracker', '+30% sniper headshot damage',
        (s) => { s.headMultBonus = (s.headMultBonus || 0) + 0.30; }),
      tier(3, 'Penetrator',   'Sniper rounds pierce 1 enemy',
        (s) => { s.penetration = Math.max(s.penetration || 0, 1); }),
      tier(4, 'Lung Drag',    '+25% ADS speed, −15% sway',
        (s) => {
          s.adsSpeedMult = (s.adsSpeedMult || 1) * 1.25;
          s.swayMult     = (s.swayMult || 1) * 0.85;
        }),
      tier(5, 'Marked Target','Capstone — every 0.25s of stationary aim on a target adds +10% damage, capping at +200%',
        (s) => {
          s.sniperAimRampPerTick = Math.max(s.sniperAimRampPerTick || 0, 0.10);
          s.sniperAimTickT       = Math.max(s.sniperAimTickT || 0, 0.25);
          s.sniperAimRampCap     = Math.max(s.sniperAimRampCap || 0, 2.00);
        }),
    ],
  },
  exotic: {
    id: 'exotic', label: 'Demolitions',
    // New class for unconventional ranged tools — flamethrower today,
    // grenade launcher / rocket launcher / dart gun / flare gun as
    // they land. Gameplay-class strings (e.g. fireMode === 'flame')
    // still drive per-weapon behaviour; this mastery is the perk
    // ladder that wraps them all.
    levels: [
      tier(1, 'Volatile Compound','+20% AoE radius on exotics',
        (s) => { s.exoticRadiusMult = (s.exoticRadiusMult || 1) * 1.20; }),
      tier(2, 'Ignition',         '+25% burn / status duration',
        (s) => { s.burnDurationBonus = (s.burnDurationBonus || 1) * 1.25; }),
      tier(3, 'Pressurized Tank', '+30% magazine / fuel capacity',
        (s) => { s.magSizeMult = (s.magSizeMult || 1) * 1.30; }),
      tier(4, 'Reactor',          '+20% exotic damage',
        (s) => { s.rangedDmgMult *= 1.20; }),
      tier(5, 'Cascade',          'Capstone — exotic kills mark the corpse: 50% chance any kill within 4m and 3s triggers a chain explosion (24 dmg)',
        (s) => {
          s.exoticChainKillChance = Math.max(s.exoticChainKillChance || 0, 0.50);
          s.exoticChainKillRadius = Math.max(s.exoticChainKillRadius || 0, 4);
          s.exoticChainKillDmg    = Math.max(s.exoticChainKillDmg || 0, 24);
          s.exoticChainKillWindow = Math.max(s.exoticChainKillWindow || 0, 3.0);
        }),
    ],
  },
  melee: {
    id: 'melee', label: 'Close Quarters',
    levels: [
      tier(1, 'Heavy Hands',    '+20% melee knockback',
        (s) => { s.knockbackMult *= 1.2; }),
      tier(2, 'Forceful Blows', '+10% melee damage',
        (s) => { s.meleeDmgMult *= 1.10; }),
      tier(3, 'Long Reach',     '+0.5m execute range',
        (s) => { s.executeRangeBonus = (s.executeRangeBonus || 0) + 0.5; }),
      tier(4, 'Bloodthirst',    '+3% melee lifesteal',
        (s) => { s.lifestealMeleePercent += 3; }),
      tier(5, 'Battle Trance',  'Capstone — melee actions cost 50% stamina; kills refund 25 stamina',
        (s) => {
          s.meleeStaminaMult = Math.min(s.meleeStaminaMult || 1, 0.5);
          s.meleeStaminaRefundOnKill = Math.max(s.meleeStaminaRefundOnKill || 0, 25);
        }),
    ],
  },
};

// Each class's apply routine: gate on the wielded weapon's class, then run
// every level entry whose threshold has been reached.
for (const def of Object.values(CLASS_DEFS)) {
  def.apply = function (level, stats, weapon) {
    if (!weapon || weapon.class !== def.id) return;
    for (const t of def.levels) {
      if (level >= t.level) t.apply(stats);
    }
  };
}

export const CLASS_IDS = Object.keys(CLASS_DEFS);

export class ClassMastery {
  constructor() {
    this.xp = Object.fromEntries(CLASS_IDS.map(id => [id, 0]));
  }

  level(id) {
    const xp = this.xp[id] || 0;
    let lv = 0;
    for (const t of CLASS_THRESHOLDS) {
      if (xp >= t) lv++;
      else break;
    }
    return lv;
  }

  xpFor(id) { return this.xp[id] || 0; }
  nextThreshold(id) {
    const lv = this.level(id);
    return CLASS_THRESHOLDS[lv] ?? null;
  }

  awardXp(id, amount) {
    if (!(id in this.xp)) return false;
    const before = this.level(id);
    this.xp[id] += amount;
    return this.level(id) > before; // true if leveled up this kill
  }

  applyTo(stats, weapon) {
    for (const id of CLASS_IDS) {
      const lv = this.level(id);
      if (lv > 0) CLASS_DEFS[id].apply(lv, stats, weapon);
    }
  }
}
