// Artifacts — Wizard-of-Legend-style permanent run buffs. Each one is a
// one-per-run acquisition whose effect stays with the player until they
// die. Artifacts don't live in the inventory; acquiring one just adds
// its id to a Set that recomputeStats reads each frame.

export const ARTIFACT_DEFS = {
  iron_faith: {
    id: 'iron_faith', name: 'Iron Faith',
    lore: 'A dead saint\'s palm medallion. Cold enough to make bullets flinch.',
    short: '+15% dmg reduction above 80% HP',
    tint: 0x7a8a9a,
    price: 4800,
    apply(s) { s.highHpReduction = (s.highHpReduction || 0) + 0.15; },
  },
  bloodied_rosary: {
    id: 'bloodied_rosary', name: 'Bloodied Rosary',
    lore: 'Prayer beads strung on piano wire. Every bead was someone\'s last breath.',
    short: 'Clearing a room heals 12% max HP',
    tint: 0xb03050,
    price: 5200,
    apply(s) { s.roomClearHealFrac = Math.max(s.roomClearHealFrac || 0, 0.12); },
    trigger: 'roomClear',
  },
  silver_tongue: {
    id: 'silver_tongue', name: 'Silver Tongue',
    lore: 'A folded contract. Merchants forget how to haggle when it\'s on the table.',
    short: '−22% shop prices',
    tint: 0xc9c0a8,
    price: 3500,
    apply(s) { s.shopPriceMult = Math.min(s.shopPriceMult || 1, 0.78); },
  },
  cracked_lens: {
    id: 'cracked_lens', name: 'Cracked Lens',
    lore: 'A shattered spotter\'s monocle. Sees the weak points nobody admits are there.',
    short: '+15% crit chance, +40% crit damage',
    tint: 0x9dd0ff,
    price: 5400,
    apply(s) { s.critChance += 0.15; s.critDamageMult += 0.4; },
  },
  red_string: {
    id: 'red_string', name: 'Red String',
    lore: 'A length of crimson thread. Binds two kills into a single breath.',
    short: 'Kills grant +50% dmg for 4s',
    tint: 0xff4040,
    price: 4200,
    apply(_s) { /* trigger-based — see onEnemyKilled */ },
    trigger: 'kill',
  },
  reapers_scythe: {
    id: 'reapers_scythe', name: "Reaper's Scythe",
    lore: 'Ceremonial blade from a funeral parlor. Remembers every cut.',
    short: '+35% melee damage, +10% execute range',
    tint: 0x2a2230,
    price: 5000,
    apply(s) {
      s.meleeDmgMult *= 1.35;
      s.executeRangeBonus = (s.executeRangeBonus || 0) + 1.0;
    },
  },
  obsidian_watch: {
    id: 'obsidian_watch', name: 'Obsidian Watch',
    lore: 'Pocket watch frozen at 11:58. Time listens to whoever holds it.',
    short: '+18% move speed',
    tint: 0x1a1a20,
    price: 4600,
    apply(s) { s.moveSpeedMult *= 1.18; },
  },
  ghost_key: {
    id: 'ghost_key', name: 'Ghost Key',
    lore: 'Skeleton key carved from bone. Nobody admits where the bone came from.',
    short: 'Sense enemies +20m through walls',
    tint: 0xe8dfc8,
    price: 3800,
    apply(s) { s.hearingRange += 20; s.hearingAlpha += 0.18; },
  },
  marked_coin: {
    id: 'marked_coin', name: 'Marked Coin',
    lore: 'A gold coin stamped with a skull. Whoever carries it spends luck.',
    short: '+40% credits from kills',
    tint: 0xd0a060,
    price: 3400,
    apply(s) { s.creditDropMult = (s.creditDropMult || 1) * 1.40; },
  },
  black_badge: {
    id: 'black_badge', name: 'Black Badge',
    lore: 'Tarnished lawman\'s shield. Still works on the right people.',
    short: '+40 max HP, +30% health regen',
    tint: 0x1e2430,
    price: 4400,
    apply(s) {
      s.maxHealthBonus += 40;
      s.healthRegenMult *= 1.30;
    },
  },
  // Three new artifacts patching gaps flagged in the rebalance review:
  // stamina identity, throwable identity, reload identity.
  pale_locket: {
    id: 'pale_locket', name: 'Pale Locket',
    lore: 'A faded tin locket. The hair inside isn\'t hers — but you keep it anyway.',
    short: '+40 max stamina, +30% stamina regen',
    tint: 0xc8d4e8,
    price: 4000,
    apply(s) { s.maxStaminaBonus += 40; s.staminaRegenMult *= 1.30; },
  },
  bandolier: {
    id: 'bandolier', name: 'Saint\'s Bandolier',
    lore: 'Twelve cells of leather and stitched faith. One charge per martyr.',
    short: '+1 throwable charge, −25% throwable cooldown',
    tint: 0x8a6a3c,
    price: 4200,
    apply(s) {
      s.throwableChargeBonus += 1;
      s.throwableCooldownMult *= 0.75;
    },
  },
  speed_loader: {
    id: 'speed_loader', name: 'Brass Speed-Loader',
    lore: 'Polished brass cylinder. Worn smooth by every panicked reload.',
    short: '−30% reload time, −10% spread',
    tint: 0xd0a060,
    price: 3800,
    apply(s) {
      s.reloadSpeedMult *= 1.43;
      s.rangedSpreadMult *= 0.90;
    },
  },
  // -----------------------------------------------------------------
  // Encounter rewards — Duck encounter rolls one of these two.
  // (Not normally available from the relic-seller stock; the
  // encounter is the only path. They appear in the standard Set + UI
  // surfaces once owned, just not in the shop pool.)
  innocent_heart: {
    id: 'innocent_heart', name: 'Innocent Heart',
    lore: 'Just doing my best.',
    short: 'Damage no longer lowers your regen cap',
    tint: 0xffb0c8,
    price: 4500,
    encounterOnly: true,
    apply(s) { s.regenCapImmune = true; },
  },
  unused_rocket_ticket: {
    id: 'unused_rocket_ticket', name: 'Unused Rocket Ticket',
    lore: 'An unpunched ticket to space.',
    short: 'Double dash distance',
    tint: 0x80c0ff,
    price: 4500,
    encounterOnly: true,
    apply(s) { s.dashDistanceMult = (s.dashDistanceMult || 1) * 2; },
  },
};

export const ALL_ARTIFACTS = Object.values(ARTIFACT_DEFS);

export class ArtifactCollection {
  constructor() { this.owned = new Set(); }
  has(id) { return this.owned.has(id); }
  acquire(id) {
    if (!ARTIFACT_DEFS[id]) return false;
    if (this.owned.has(id)) return false;
    this.owned.add(id);
    return true;
  }
  reset() { this.owned.clear(); }
  applyTo(stats) {
    for (const id of this.owned) {
      const a = ARTIFACT_DEFS[id];
      if (a && typeof a.apply === 'function') a.apply(stats);
    }
  }
  list() {
    return [...this.owned].map(id => ARTIFACT_DEFS[id]).filter(Boolean);
  }
}

// Build an artifact-scroll item (merchant-facing). The shop buy flow
// recognizes items with `type === 'artifact-scroll'` and grants the
// artifact instead of putting it in the backpack.
export function artifactScrollFor(id) {
  const def = ARTIFACT_DEFS[id];
  if (!def) return null;
  return {
    id: `scroll_${id}`,
    artifactId: id,
    name: def.name,
    type: 'artifact-scroll',
    tint: def.tint,
    rarity: 'legendary',
    description: def.short,
    lore: def.lore,
    basePrice: def.price,
  };
}
