// Gear perks (roll on rare+ loot) and special perks (unlocked with skill
// tree points from sub-boss kills). Both pools share an `apply` shape that
// mutates the derived-stats bag; a few have event-based triggers handled
// directly in main (e.g. Headhunter refunds ammo when a headshot lands).

// --- Gear perks -------------------------------------------------------------
// Each entry MAY define `_lvl` — a minimum loot level before the perk
// is allowed in the roll pool. Without it the perk is always-on.
// Numeric perks SHOULD multiply by `mastercraft ? 1.5 : 1.0` so the
// rare mastercraft tier reads as visibly stronger.
export const GEAR_PERKS = {
  quickdraw: {
    id: 'quickdraw', name: 'Quickdraw',
    description: '−25% reload time',
    apply(s) { s.reloadSpeedMult = (s.reloadSpeedMult || 1) * (1 / 0.75); },
  },
  glassCannon: {
    id: 'glassCannon', name: 'Glass Cannon',
    description: '+25% ranged dmg, −20 max HP',
    apply(s) {
      s.rangedDmgMult *= 1.25;
      s.maxHealthBonus -= 20;
    },
  },
  berserk: {
    id: 'berserk', name: 'Berserker',
    description: '+30% dmg while below 50% HP (player)',
    apply(s) { s.berserkBonus = (s.berserkBonus || 0) + 0.30; },
  },
  vampiric: {
    id: 'vampiric', name: 'Vampiric Strikes',
    description: '+6% melee lifesteal',
    apply(s) { s.lifestealMeleePercent += 6; },
  },
  headhunter: {
    id: 'headhunter', name: 'Headhunter',
    description: 'Headshots refund 1 ammo',
    apply(_s) { /* trigger-based — flag checked in main */ },
    trigger: 'headshot',
  },
  // --- New perks (post-rebalance) ----------------------------------
  // Designed to spread across the new class identities — body crit
  // for rifles, sustained-fire for LMG, AoE for exotics, throwable
  // amplifiers, sniper hold-fire bonus, defensive perks.
  steadyHand: {
    id: 'steadyHand', name: 'Steady Hand', _lvl: 2,
    description: '−15% spread, +5% range',
    apply(s) {
      s.rangedSpreadMult *= 0.85;
      s.rangeMult = (s.rangeMult || 1) * 1.05;
    },
  },
  ironLungs: {
    id: 'ironLungs', name: 'Iron Lungs', _lvl: 2,
    description: '+25% stamina regen, +10 max stamina',
    apply(s) { s.staminaRegenMult *= 1.25; s.maxStaminaBonus += 10; },
  },
  ricochet: {
    id: 'ricochet', name: 'Ricochet Round', _lvl: 3,
    description: '20% chance bullets ricochet to a 2nd target',
    apply(s) {
      s.ricochetChance = Math.max(s.ricochetChance, 0.20);
      s.ricochetCount  = Math.max(s.ricochetCount, 1);
    },
  },
  feverDream: {
    id: 'feverDream', name: 'Fever Dream', _lvl: 3,
    description: '+50% burn duration, +12% fire resist',
    apply(s) {
      s.burnDurationBonus = (s.burnDurationBonus || 1) * 1.5;
      s.fireResist = Math.min(0.8, s.fireResist + 0.12);
    },
  },
  boneBreaker: {
    id: 'boneBreaker', name: 'Bone Breaker', _lvl: 3,
    description: '+25% knockback, +15% melee dmg',
    apply(s) {
      s.knockbackMult *= 1.25;
      s.meleeDmgMult *= 1.15;
    },
  },
  bodyCritter: {
    id: 'bodyCritter', name: 'Center Mass', _lvl: 4,
    description: '+8% crit chance, +20% crit dmg on body shots',
    apply(s) {
      s.bodyCritChanceBonus = (s.bodyCritChanceBonus || 0) + 0.08;
      s.bodyCritDamageBonus = (s.bodyCritDamageBonus || 0) + 0.20;
    },
  },
  walkingFire: {
    id: 'walkingFire', name: 'Walking Fire', _lvl: 4,
    description: '+15% LMG mag size, −12% LMG spread',
    apply(s) {
      // Always-on broad bumps so it benefits any auto build, not
      // just LMG. Naming nods to the LMG capstone identity.
      s.magSizeMult = (s.magSizeMult || 1) * 1.15;
      s.rangedSpreadMult *= 0.88;
    },
  },
  freeRefill: {
    id: 'freeRefill', name: 'Free Refill', _lvl: 4,
    description: 'Kills refill 30% of current mag',
    apply(s) { s.reloadOnKill = Math.max(s.reloadOnKill, 0.30); },
  },
  payload: {
    id: 'payload', name: 'Heavy Payload', _lvl: 5,
    description: '+25% AoE radius, +1 throwable charge',
    apply(s) {
      s.exoticRadiusMult = (s.exoticRadiusMult || 1) * 1.25;
      s.throwableChargeBonus += 1;
    },
  },
  resoluteHold: {
    id: 'resoluteHold', name: 'Resolute Hold', _lvl: 5,
    description: '+25% damage on full-HP targets',
    apply(s) { s.fullHpDmgBonus = (s.fullHpDmgBonus || 0) + 0.25; },
  },
  twinFangs: {
    id: 'twinFangs', name: 'Twin Fangs', _lvl: 5,
    description: '+1 pellet, −5% fire rate',
    apply(s) {
      s.pelletCountBonus = (s.pelletCountBonus || 0) + 1;
      s.fireRateMult = (s.fireRateMult || 1) * 0.95;
    },
  },
  goldenChance: {
    id: 'goldenChance', name: 'Golden Chance', _lvl: 6,
    description: '1.5% chance for instant-kill on non-bosses',
    apply(s) { s.goldenBulletChance = Math.max(s.goldenBulletChance, 0.015); },
  },
  secondHeart: {
    id: 'secondHeart', name: 'Second Heart', _lvl: 6,
    description: '+50% health regen, −1.5s regen delay',
    apply(s) {
      s.healthRegenMult *= 1.5;
      s.healthRegenDelayBonus -= 1.5;
    },
  },
  scavenger: {
    id: 'scavenger', name: 'Scavenger\'s Eye', _lvl: 7,
    description: '+15% ammo on hit, +2 backpack pockets',
    apply(s) {
      s.ammoOnHitChance = Math.max(s.ammoOnHitChance, 0.15);
      s.pocketsBonus += 2;
    },
  },
  duskCloak: {
    id: 'duskCloak', name: 'Dusk Cloak', _lvl: 7,
    description: '−25% detection range, +20% crouch dmg',
    apply(s) {
      s.stealthMult *= 0.75;
      s.crouchDmgMult *= 1.20;
    },
  },
  apexPredator: {
    id: 'apexPredator', name: 'Apex Predator', _lvl: 8,
    description: '+15% all dmg, +10% move speed',
    apply(s) {
      s.rangedDmgMult *= 1.15;
      s.meleeDmgMult *= 1.15;
      s.moveSpeedMult *= 1.10;
    },
  },
};

export const ALL_GEAR_PERKS = Object.values(GEAR_PERKS);

const PERK_COUNT_BY_RARITY = {
  common: 0, uncommon: 0, rare: 1, epic: 2, legendary: 3,
};

export function rollPerks(rarity, opts = {}) {
  let count = PERK_COUNT_BY_RARITY[rarity] ?? 0;
  // Mastercraft items get one extra perk.
  if (opts.mastercraft) count += 1;
  if (count === 0) return [];
  // Filter the perk pool by the player's loot level — early levels
  // see only the basic 5 perks; higher-tier perks come online with
  // progression. Each perk has an optional `_lvl` minimum.
  const lv = (typeof window !== 'undefined' && window.__lootLevel) || 1;
  const pool = ALL_GEAR_PERKS.filter(p => !p._lvl || p._lvl <= lv);
  const usable = pool.length ? [...pool] : [...ALL_GEAR_PERKS];
  const out = [];
  for (let i = 0; i < count && usable.length; i++) {
    const idx = Math.floor(Math.random() * usable.length);
    const perk = usable.splice(idx, 1)[0];
    out.push({ id: perk.id, name: perk.name, description: perk.description });
  }
  return out;
}

// --- Special perks (SP shop) -----------------------------------------------
export const SPECIAL_PERKS = {
  ghost: {
    id: 'ghost', name: 'Ghost', cost: 1,
    description: 'Crouch stealth multiplier halved (much harder to detect)',
    apply(s) { s.stealthExtraCrouchMult = 0.5; },
  },
  marksman: {
    id: 'marksman', name: 'Marksman', cost: 1,
    description: '−10% weapon spread on every weapon',
    apply(s) { s.rangedSpreadMult *= 0.9; },
  },
  ironWill: {
    id: 'ironWill', name: 'Iron Will', cost: 1,
    description: '+25 max HP',
    apply(s) { s.maxHealthBonus += 25; },
  },
  bloodlust: {
    id: 'bloodlust', name: 'Bloodlust', cost: 1,
    description: 'Melee kills grant +30% move speed for 3s',
    apply(_s) { /* trigger-based */ },
    trigger: 'meleeKill',
  },
  executionerMastery: {
    id: 'executionerMastery', name: 'Executioner Mastery', cost: 1,
    description: 'Executes grant +30% all damage for 6s',
    apply(_s) { /* trigger-based */ },
    trigger: 'execute',
  },
  pointBlank: {
    id: 'pointBlank', name: 'Point Blank', cost: 1,
    description: '+40% ranged dmg within 6m',
    apply(_s) { /* applied at fire time */ },
    trigger: 'rangedHit',
  },
};

export const ALL_SPECIAL_PERKS = Object.values(SPECIAL_PERKS);

export class SpecialPerkLoadout {
  constructor() {
    this.unlocked = new Set();
  }
  has(id) { return this.unlocked.has(id); }
  unlock(id) { this.unlocked.add(id); }
  applyTo(stats) {
    for (const id of this.unlocked) {
      const p = SPECIAL_PERKS[id];
      if (p) p.apply(stats);
    }
  }
}

// Temporary buff envelope used by trigger-based perks.
export class BuffState {
  constructor() {
    this.buffs = [];  // { id, damageMult, moveSpeedMult, t, life }
  }
  grant(id, mods, life) {
    // Replace existing buff with same id.
    this.buffs = this.buffs.filter(b => b.id !== id);
    this.buffs.push({ id, ...mods, t: 0, life });
  }
  tick(dt) {
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      this.buffs[i].t += dt;
      if (this.buffs[i].t >= this.buffs[i].life) this.buffs.splice(i, 1);
    }
  }
  applyTo(stats) {
    // Every stat a consumable / skill buff might grant. Prior
    // revision only handled damageMult + moveSpeedMult — which meant
    // Energy Drink (stamina regen), Painkillers (dmg reduction),
    // and Regen Injector (health regen) granted a buff that ticked
    // the timer but never actually modified the corresponding stat.
    for (const b of this.buffs) {
      if (b.damageMult) {
        stats.meleeDmgMult  *= b.damageMult;
        stats.rangedDmgMult *= b.damageMult;
      }
      if (b.moveSpeedMult)    stats.moveSpeedMult   *= b.moveSpeedMult;
      if (b.staminaRegenMult) stats.staminaRegenMult *= b.staminaRegenMult;
      if (b.healthRegenMult)  stats.healthRegenMult  *= b.healthRegenMult;
      if (b.fireRateMult)     stats.fireRateMult    *= b.fireRateMult;
      if (b.reloadSpeedMult)  stats.reloadSpeedMult *= b.reloadSpeedMult;
      if (b.rangedDmgMult)    stats.rangedDmgMult   *= b.rangedDmgMult;
      if (b.meleeDmgMult)     stats.meleeDmgMult    *= b.meleeDmgMult;
      if (b.dmgReduction)     stats.dmgReduction = Math.min(0.9, stats.dmgReduction + b.dmgReduction);
      if (b.critChance)       stats.critChance += b.critChance;
    }
  }
  has(id) { return this.buffs.some(b => b.id === id); }
}
