// Weapon-class mastery. Each weapon belongs to a class; kills credit XP to
// that class. Hitting a level threshold unlocks a class perk that applies
// only when wielding a weapon of the same class.

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
      tier(5, 'Akimbo',           'Capstone — pistols fire a paired round (+1 pellet) and +20% damage',
        (s) => {
          s.pelletCountBonus = (s.pelletCountBonus || 0) + 1;
          s.rangedDmgMult *= 1.20;
        }),
    ],
  },
  smg: {
    id: 'smg', label: 'Submachine Gunner',
    levels: [
      tier(1, 'Hipfire Drills',   '−20% hip spread on SMGs',
        (s) => { s.hipSpreadOnlyMult = (s.hipSpreadOnlyMult || 1) * 0.8; }),
      tier(2, 'Light Frame',      '+8% move speed with an SMG',
        (s) => { s.moveSpeedMult *= 1.08; }),
      tier(3, 'Run-and-Gun',      '+12% move speed with an SMG',
        (s) => { s.moveSpeedMult *= 1.12; }),
      tier(4, 'Extended Loadout', '+25% SMG magazine size',
        (s) => { s.magSizeMult = (s.magSizeMult || 1) * 1.25; }),
      tier(5, 'Ghost Arm',        'Capstone — autonomous second SMG: +1 pellet per shot, +15% fire rate',
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
        (s) => { s.dmgReduction += 0.2; }),
      tier(4, 'Barrel Stuffed','+1 pellet per shot',
        (s) => { s.pelletCountBonus = (s.pelletCountBonus || 0) + 1; }),
      tier(5, 'Breacher',     'Capstone — +2 pellets and +25% damage',
        (s) => {
          s.pelletCountBonus = (s.pelletCountBonus || 0) + 2;
          s.rangedDmgMult *= 1.25;
        }),
    ],
  },
  rifle: {
    id: 'rifle', label: 'Marksman',
    levels: [
      tier(1, 'Sight Picture', '−15% ADS spread on rifles',
        (s) => { s.adsSpreadOnlyMult = (s.adsSpreadOnlyMult || 1) * 0.85; }),
      tier(2, 'Stable Stance', '+15% rifle range',
        (s) => { s.rangeMult = (s.rangeMult || 1) * 1.15; }),
      tier(3, 'Long Reach',    '+20% rifle range',
        (s) => { s.rangeMult = (s.rangeMult || 1) * 1.20; }),
      tier(4, 'One Shot',      '+30% rifle headshot dmg',
        (s) => { s.headMultBonus = (s.headMultBonus || 0) + 0.30; }),
      tier(5, 'Slide Shoot',   'Capstone — crouching grants +60% rifle damage and zero spread',
        (s) => {
          s.crouchDmgMult = (s.crouchDmgMult || 1) * 1.60;
          s.crouchSpreadMult = (s.crouchSpreadMult || 1) * 0.0;
        }),
    ],
  },
  lmg: {
    id: 'lmg', label: 'Heavy',
    levels: [
      tier(1, 'Quick Drum',   '−10% reload time on LMGs',
        (s) => { s.reloadSpeedMult = (s.reloadSpeedMult || 1) * 1.111; }),
      tier(2, 'Heavy Frame',  '−10% incoming damage with LMG out',
        (s) => { s.dmgReduction += 0.10; }),
      tier(3, 'Suppression',  '+15% LMG damage',
        (s) => { s.rangedDmgMult *= 1.15; }),
      tier(4, 'Belt Fed',     '+30% LMG magazine size',
        (s) => { s.magSizeMult = (s.magSizeMult || 1) * 1.3; }),
      tier(5, 'Auto-Shoot',   'Capstone — +25% fire rate and +25% reload speed',
        (s) => {
          s.fireRateMult = (s.fireRateMult || 1) * 1.25;
          s.reloadSpeedMult = (s.reloadSpeedMult || 1) * 1.25;
        }),
    ],
  },
  flame: {
    id: 'flame', label: 'Pyromaniac',
    levels: [
      tier(1, 'Long Burn',       '+20% flamethrower range',
        (s) => { s.rangeMult = (s.rangeMult || 1) * 1.2; }),
      tier(2, 'Superheat',       '+15% flame damage',
        (s) => { s.rangedDmgMult *= 1.15; }),
      tier(3, 'Lingering',       '+50% burn duration',
        (s) => { s.burnDurationBonus = (s.burnDurationBonus || 1) * 1.5; }),
      tier(4, 'Pressurized Tank','+25% magazine size',
        (s) => { s.magSizeMult = (s.magSizeMult || 1) * 1.25; }),
      tier(5, 'Inferno',         'Capstone — +40% flame damage and +30% range',
        (s) => {
          s.rangedDmgMult *= 1.40;
          s.rangeMult = (s.rangeMult || 1) * 1.30;
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
      tier(5, 'Reaper Step',    'Capstone — +1m execute range and +25% melee damage',
        (s) => {
          s.executeRangeBonus = (s.executeRangeBonus || 0) + 1.0;
          s.meleeDmgMult *= 1.25;
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
