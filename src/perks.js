// Gear perks (roll on rare+ loot) and special perks (unlocked with skill
// tree points from sub-boss kills). Both pools share an `apply` shape that
// mutates the derived-stats bag; a few have event-based triggers handled
// directly in main (e.g. Headhunter refunds ammo when a headshot lands).

// --- Gear perks -------------------------------------------------------------
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
};

export const ALL_GEAR_PERKS = Object.values(GEAR_PERKS);

const PERK_COUNT_BY_RARITY = {
  common: 0, uncommon: 0, rare: 1, epic: 2, legendary: 3,
};

export function rollPerks(rarity) {
  const count = PERK_COUNT_BY_RARITY[rarity] ?? 0;
  if (count === 0) return [];
  const pool = [...ALL_GEAR_PERKS];
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const perk = pool.splice(idx, 1)[0];
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
