// Roguelike skill catalog. Each skill has up to 10 levels; picking the same
// skill again advances its level. `apply` mutates the shared stats bag read
// by gameplay systems each frame.
export const SKILLS = {
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    icon: '⚔',
    maxLevel: 10,
    descriptionAt: (lv) => `+${5 * lv}% melee damage`,
    apply(lv, s) { s.meleeDmgMult *= 1 + 0.05 * lv; },
  },
  sharpshooter: {
    id: 'sharpshooter',
    name: 'Sharpshooter',
    icon: '◎',
    maxLevel: 10,
    descriptionAt: (lv) => `−${3 * lv}% spread, +${3 * lv}% ranged damage`,
    apply(lv, s) {
      s.rangedSpreadMult *= Math.max(0.1, 1 - 0.03 * lv);
      s.rangedDmgMult *= 1 + 0.03 * lv;
    },
  },
  swift: {
    id: 'swift',
    name: 'Swift',
    icon: '»',
    maxLevel: 10,
    descriptionAt: (lv) => `+${3 * lv}% move speed`,
    apply(lv, s) { s.moveSpeedMult *= 1 + 0.03 * lv; },
  },
  tenacity: {
    id: 'tenacity',
    name: 'Tenacity',
    icon: '♥',
    maxLevel: 10,
    descriptionAt: (lv) => `+${8 * lv} max HP`,
    apply(lv, s) { s.maxHealthBonus += 8 * lv; },
  },
  endurance: {
    id: 'endurance',
    name: 'Endurance',
    icon: '◉',
    maxLevel: 10,
    descriptionAt: (lv) => `+${6 * lv} max stamina, +${5 * lv}% regen`,
    apply(lv, s) {
      s.maxStaminaBonus += 6 * lv;
      s.staminaRegenMult *= 1 + 0.05 * lv;
    },
  },
  vampire: {
    id: 'vampire',
    name: 'Bloodletter',
    icon: '†',
    maxLevel: 10,
    descriptionAt: (lv) => `Melee heals ${2 * lv}% damage dealt`,
    apply(lv, s) { s.lifestealMeleePercent += 2 * lv; },
  },
  shrapnel: {
    id: 'shrapnel',
    name: 'Shrapnel',
    icon: '⊕',
    maxLevel: 10,
    // Used to be a plain +dmg stat that overlapped with Sharpshooter.
    // Reworked to fragment shots: each hit has a chance to ricochet
    // to a nearby target for 60% damage. Scales ricochet chance per
    // level + adds an extra bounce at tier breakpoints so a maxed
    // Shrapnel turns a single well-placed shot into three-target
    // spray — a multiplicative damage boost through extra targets,
    // not a flat multiplier.
    descriptionAt: (lv) => {
      const chance = Math.min(100, 10 * lv);
      const bounces = Math.max(1, 1 + Math.floor(lv / 4));
      return `${chance}% chance per hit to splinter → ${bounces} bounce${bounces > 1 ? 's' : ''}, 60% damage each`;
    },
    apply(lv, s) {
      s.ricochetChance = Math.min(1.0, (s.ricochetChance || 0) + 0.10 * lv);
      const addBounces = Math.max(1, 1 + Math.floor(lv / 4));
      s.ricochetCount = Math.max(s.ricochetCount || 0, addBounces);
    },
  },
  iron: {
    id: 'iron',
    name: 'Iron Skin',
    icon: '◈',
    maxLevel: 10,
    descriptionAt: (lv) => `${3 * lv}% damage reduction`,
    apply(lv, s) { s.dmgReduction = Math.min(0.7, s.dmgReduction + 0.03 * lv); },
  },
  resolve: {
    id: 'resolve',
    name: 'Resolve',
    icon: '✚',
    maxLevel: 10,
    descriptionAt: (lv) => `+${3 * lv}% health regen rate, −${0.2 * lv}s regen delay`,
    apply(lv, s) {
      s.healthRegenMult *= 1 + 0.03 * lv;
      s.healthRegenDelayBonus -= 0.2 * lv;
    },
  },
  silentSteps: {
    id: 'silentSteps',
    name: 'Silent Steps',
    icon: '∴',
    maxLevel: 10,
    descriptionAt: (lv) => `−${3 * lv}% detection range`,
    apply(lv, s) { s.stealthMult *= 1 + 0.03 * lv; },
  },
  critChance: {
    id: 'critChance',
    name: 'Critical Strike',
    icon: '✦',
    maxLevel: 10,
    descriptionAt: (lv) => `+${3 * lv}% crit chance`,
    apply(lv, s) { s.critChance += 0.03 * lv; },
  },
  critDamage: {
    id: 'critDamage',
    name: 'Critical Damage',
    icon: '✸',
    maxLevel: 10,
    descriptionAt: (lv) => `+${10 * lv}% crit damage`,
    apply(lv, s) { s.critDamageMult += 0.1 * lv; },
  },
  fireResist: {
    id: 'fireResist',
    name: 'Fire Resistance',
    icon: '♨',
    maxLevel: 10,
    descriptionAt: (lv) => `−${6 * lv}% fire damage taken`,
    apply(lv, s) { s.fireResist = Math.min(0.8, s.fireResist + 0.06 * lv); },
  },
  ballisticResist: {
    id: 'ballisticResist',
    name: 'Ballistic Resistance',
    icon: '◊',
    maxLevel: 10,
    descriptionAt: (lv) => `−${3 * lv}% bullet damage taken`,
    apply(lv, s) { s.ballisticResist = Math.min(0.7, s.ballisticResist + 0.03 * lv); },
  },
  grenadier: {
    id: 'grenadier',
    name: 'Grenadier',
    icon: '✹',
    maxLevel: 10,
    // Each level shaves 4% off throwable cooldown; every third level
    // adds a bonus charge (so 1/2/3 extra charges at Lv3/6/9). Stacks
    // with the item's base charges and cooldown.
    descriptionAt: (lv) =>
      `−${4 * lv}% throwable cooldown, +${Math.floor(lv / 3)} bonus charges`,
    apply(lv, s) {
      s.throwableCooldownMult *= Math.max(0.2, 1 - 0.04 * lv);
      s.throwableChargeBonus += Math.floor(lv / 3);
    },
  },
};

export const BASE_STATS = () => ({
  meleeDmgMult: 1,
  rangedDmgMult: 1,
  rangedSpreadMult: 1,
  moveSpeedMult: 1,
  maxHealthBonus: 0,
  maxStaminaBonus: 0,
  staminaRegenMult: 1,
  healthRegenMult: 1,
  healthRegenDelayBonus: 0,
  lifestealMeleePercent: 0,
  dmgReduction: 0,
  knockbackMult: 1,
  stealthMult: 1,
  stealthExtraCrouchMult: 1,
  reloadSpeedMult: 1,
  berserkBonus: 0,
  triggerPerks: {},
  hipSpreadOnlyMult: 1,
  adsSpreadOnlyMult: 1,
  pelletCountBonus: 0,
  magSizeMult: 1,
  rangeMult: 1,
  headMultBonus: 0,
  burnDurationBonus: 1,
  executeRangeBonus: 0,
  critChance: 0,
  critDamageMult: 2.0,  // base crit multiplier
  fireResist: 0,
  ballisticResist: 0,
  pocketsBonus: 0,
  fireRateMult: 1,
  crouchDmgMult: 1,
  crouchSpreadMult: 1,
  crouchMoveBonus: 1,
  cornerReduction: 0,
  pointBlankBonus: 0,
  hearingRange: 0,      // meters beyond LoS at which enemies show as ghost
  hearingAlpha: 0,      // additional alpha on the ghost render (base 0.12)
  highHpReduction: 0,   // extra dmg reduction while above 80% HP
  roomClearHealFrac: 0, // fraction of max HP healed on room clear
  shopPriceMult: 1,     // merchant price multiplier
  creditDropMult: 1,    // credit payout multiplier on kills
  throwableCooldownMult: 1,  // Grenadier / perks: <1 speeds recharge
  throwableChargeBonus: 0,   // Grenadier: +N max charges on every throwable
  throwableRefundOnKill: 0,  // grenadierMaster tier 1: +N charges per kill
  throwableResetOnKill: 0,   // grenadierMaster tier 2: reset all cooldowns on kill (boolean)
  // Rifle full-auto crit chain — main.js tracks consecutive hits on a
  // single target while firing in auto and adds `rifleAutoChainPerHit`
  // crit damage per stack (capped at `rifleAutoChainCap`). Resets when
  // the target swaps OR `rifleAutoChainResetT` seconds pass without
  // firing. Wired in main.js bullet-hit code.
  rifleAutoChainPerHit: 0,
  rifleAutoChainCap: 0,
  rifleAutoChainResetT: 0,
  // LMG sustained-fire spread bleed — while holding the trigger,
  // current spread is multiplied by max(0, 1 - decay * heldSec).
  // Resets after `lmgSustainedResetT` seconds of not firing.
  lmgSustainedSpreadDecay: 0,
  lmgSustainedResetT: 0,
  // Sniper aim-and-hold ramp — once the cursor stops on a target,
  // every `sniperAimTickT` seconds adds `sniperAimRampPerTick` to the
  // damage multiplier, capped at `sniperAimRampCap`. Movement or
  // target-swap resets the stack.
  sniperAimRampPerTick: 0,
  sniperAimTickT: 0,
  sniperAimRampCap: 0,
  // Sniper one-shot bonus — extra damage against full-HP targets.
  fullHpDmgBonus: 0,
  // Rifle body-shot crit identity — separate from generic crit so
  // headshot multipliers don't double-dip with the rifle ladder.
  bodyCritChanceBonus: 0,
  bodyCritDamageBonus: 0,
  // Penetration — bullets pierce N enemies before stopping.
  penetration: 0,
  // ADS speed / sway — sniper QoL.
  adsSpeedMult: 1,
  swayMult: 1,
  // Shotgun reload depth — shells loaded per pump animation. Quad-load
  // capstone bumps to 4. Default 1 (one shell per pump).
  shotgunShellsPerPump: 1,
  // Exotic / demolitions stat fields.
  exoticRadiusMult: 1,
  exoticChainKillChance: 0,
  exoticChainKillRadius: 0,
  exoticChainKillDmg: 0,
  exoticChainKillWindow: 0,
  // Melee stamina — Battle Trance halves attack costs and refunds on kill.
  meleeStaminaMult: 1,
  meleeStaminaRefundOnKill: 0,
  // Backpedal — when a player shoots in one direction and moves in the
  // opposite, ground movement collapses to a slow backpedal and dash
  // distance halves. Pistol-class skills raise `backpedalRelief` from
  // 0 (full penalty) toward 1 (no penalty) so a sidearm build can
  // kite. Lerps the penalty multiplier back toward 1.0.
  backpedalRelief: 0,
  // Wild-perk flags — main.js reads these at event time.
  ricochetCount: 0,
  ricochetChance: 0,
  reloadOnKill: 0,         // fraction of mag refilled on a kill
  headshotHeal: 0,         // heal on headshot (flat HP)
  explodeOnKillChance: 0,  // chance kill triggers a small AoE
  explodeOnKillDmg: 0,
  explodeOnKillRadius: 0,
  goldenBulletChance: 0,   // chance a single bullet one-shots
  shockOnCrit: 0,          // dazzle duration on crit (seconds)
  ammoOnHitChance: 0,      // chance a body hit refunds a round
  secondWindCharges: 0,    // revives with partial HP on fatal damage
  fatalToFullHealMissing: 0, // heal missing HP on kill (%)
  adrenalOnLowHp: 0,       // fire rate boost below 35% HP
});

export class SkillLoadout {
  constructor() {
    this.levels = Object.create(null); // id → integer level (0..maxLevel)
  }

  level(id) { return this.levels[id] | 0; }

  atMax(id) {
    const s = SKILLS[id];
    return s ? this.level(id) >= s.maxLevel : true;
  }

  levelUp(id) {
    const s = SKILLS[id];
    if (!s) return false;
    const cur = this.level(id);
    if (cur >= s.maxLevel) return false;
    this.levels[id] = cur + 1;
    return true;
  }

  applyTo(stats) {
    for (const id in this.levels) {
      const s = SKILLS[id];
      if (s && this.levels[id] > 0) s.apply(this.levels[id], stats);
    }
  }

  // Pick up to `count` distinct skill ids that aren't at max.
  randomOffers(count = 3) {
    const ids = Object.keys(SKILLS).filter(id => !this.atMax(id));
    // Fisher–Yates style shuffle.
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, Math.min(count, ids.length));
  }

  // Serialized list of [id, level] for display.
  entries() {
    return Object.entries(this.levels).filter(([, lv]) => lv > 0);
  }
}
