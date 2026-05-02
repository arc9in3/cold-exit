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
    price: 96000,
    permitGated: true,   // Black Market permit required to enter relic-merchant rotation
    apply(s) { s.highHpReduction = (s.highHpReduction || 0) + 0.15; },
  },
  bloodied_rosary: {
    id: 'bloodied_rosary', name: 'Bloodied Rosary',
    lore: 'Prayer beads strung on piano wire. Every bead was someone\'s last breath.',
    short: 'Clearing a room heals 12% max HP',
    tint: 0xb03050,
    price: 104000,
    apply(s) { s.roomClearHealFrac = Math.max(s.roomClearHealFrac || 0, 0.12); },
    trigger: 'roomClear',
  },
  silver_tongue: {
    id: 'silver_tongue', name: 'Silver Tongue',
    lore: 'A folded contract. Merchants forget how to haggle when it\'s on the table.',
    short: '−22% shop prices',
    tint: 0xc9c0a8,
    price: 70000,
    apply(s) { s.shopPriceMult = Math.min(s.shopPriceMult || 1, 0.78); },
  },
  cracked_lens: {
    id: 'cracked_lens', name: 'Cracked Lens',
    lore: 'A shattered spotter\'s monocle. Sees the weak points nobody admits are there.',
    short: '+15% crit chance, +40% crit damage',
    tint: 0x9dd0ff,
    price: 108000,
    apply(s) { s.critChance += 0.15; s.critDamageMult += 0.4; },
  },
  red_string: {
    id: 'red_string', name: 'Red String',
    lore: 'A length of crimson thread. Binds two kills into a single breath.',
    short: 'Kills grant +50% dmg for 4s',
    tint: 0xff4040,
    price: 84000,
    apply(_s) { /* trigger-based — see onEnemyKilled */ },
    trigger: 'kill',
  },
  reapers_scythe: {
    id: 'reapers_scythe', name: "Reaper's Scythe",
    lore: 'Ceremonial blade from a funeral parlor. Remembers every cut.',
    short: '+35% melee damage, +10% execute range',
    tint: 0x2a2230,
    price: 100000,
    permitGated: true,
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
    price: 92000,
    apply(s) { s.moveSpeedMult *= 1.18; },
  },
  ghost_key: {
    id: 'ghost_key', name: 'Ghost Key',
    lore: 'Skeleton key carved from bone. Nobody admits where the bone came from.',
    short: 'Sense enemies +20m through walls',
    tint: 0xe8dfc8,
    price: 76000,
    apply(s) { s.hearingRange += 20; s.hearingAlpha += 0.18; },
  },
  marked_coin: {
    id: 'marked_coin', name: 'Marked Coin',
    lore: 'A gold coin stamped with a skull. Whoever carries it spends luck.',
    short: '+40% credits from kills',
    tint: 0xd0a060,
    price: 68000,
    apply(s) { s.creditDropMult = (s.creditDropMult || 1) * 1.40; },
  },
  black_badge: {
    id: 'black_badge', name: 'Black Badge',
    lore: 'Tarnished lawman\'s shield. Still works on the right people.',
    short: '+40 max HP, +30% health regen',
    tint: 0x1e2430,
    price: 88000,
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
    price: 80000,
    apply(s) { s.maxStaminaBonus += 40; s.staminaRegenMult *= 1.30; },
  },
  bandolier: {
    id: 'bandolier', name: 'Saint\'s Bandolier',
    lore: 'Twelve cells of leather and stitched faith. One charge per martyr.',
    short: '+1 throwable charge, −25% throwable cooldown',
    tint: 0x8a6a3c,
    price: 84000,
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
    price: 76000,
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
    price: 90000,
    encounterOnly: true,
    apply(s) { s.regenCapImmune = true; },
  },
  rocket_shoes: {
    id: 'rocket_shoes', name: 'Rocket Shoes',
    lore: 'Built from a ticket nobody ever used.',
    short: 'Double dash distance',
    tint: 0x80c0ff,
    price: 90000,
    encounterOnly: true,
    apply(s) { s.dashDistanceMult = (s.dashDistanceMult || 1) * 2; },
  },
  // Wishing Well reward — sells for one cooldown halving across every
  // throwable the player owns. Stacks multiplicatively with Grenadier
  // skill-tree throwableCooldownMult perks.
  tims_bag: {
    id: 'tims_bag', name: "Tim's Bag",
    lore: 'Always heavier than it looks. Always lighter than it should be.',
    short: '−50% throwable cooldown',
    tint: 0x808060, price: 90000, encounterOnly: true,
    apply(s) { s.throwableCooldownMult = (s.throwableCooldownMult || 1) * 0.5; },
  },
  // Path of Fire reward — every shot / melee hit stacks a burn DoT
  // on the target. Combos with Pyromaniac set + Fever Dream perk for
  // truly nasty fire builds.
  undying_embers: {
    id: 'undying_embers', name: 'Undying Embers',
    lore: 'A handful of warmth that refuses to cool.',
    short: 'Any damage dealt applies a stacking burn',
    tint: 0xff8030, price: 90000, encounterOnly: true,
    apply(s) { s.appliesBurnOnHit = true; },
  },
  // Choices and Consequences — Indecision relic. Drives a 10s ticker
  // in main.js that grants one of the standard short-buff defs. Pure
  // marker artifact; no per-stat apply.
  indecision: {
    id: 'indecision', name: 'Indecision',
    lore: 'Some choices echo. Some refuse to be made.',
    short: 'Every 10s, gain a random short buff',
    tint: 0x808a98,
    price: 100000,
    encounterOnly: true,
    apply(_s) { /* trigger-based — see _tickIndecisionRelic in main.js */ },
    trigger: 'indecision',
  },

  // ================================================================
  // Apr-26 batch — themed performance relics + a paired meta synth.
  // ================================================================

  // First round in any mag deals double. Implemented in main.js fire
  // path via derivedStats.openingActActive flag.
  opening_act: {
    id: 'opening_act', name: 'Opening Act',
    lore: 'open with a bang.',
    short: 'First bullet of every mag deals +100% damage',
    tint: 0xf2c060, price: 96000,
    apply(s) { s.openingActActive = true; },
  },
  // Last round in any mag deals double. Same flag pattern.
  closing_act: {
    id: 'closing_act', name: 'Closing Act',
    lore: 'close with a bang.',
    short: 'Last bullet of every mag deals +100% damage',
    tint: 0xc04830, price: 96000,
    apply(s) { s.closingActActive = true; },
  },
  // Synthetic — auto-granted by ArtifactCollection.acquire when both
  // Opening Act and Closing Act are owned. Never appears in shop pools
  // (synthetic flag) and isn't manually acquireable. Hold-fire past
  // empty mag costs 3 HP/s; full-auto only.
  magnum_opus: {
    id: 'magnum_opus', name: 'Magnum Opus',
    lore: 'perfection takes sacrifice.',
    short: 'Hold-fire past empty on full-auto. 3 HP/s.',
    tint: 0xe8e8ff, price: 0,
    synthetic: true,
    apply(s) { s.magnumOpusActive = true; },
  },

  // 4% lifesteal on ranged hits — mirrors the existing melee
  // lifesteal that lives in derivedStats.lifestealMeleePercent.
  vampires_mark: {
    id: 'vampires_mark', name: "Vampire's Mark",
    lore: 'Brand burned into your wrist. Drinks where it bites.',
    short: 'Ranged hits heal 4% of damage dealt',
    tint: 0x801818, price: 88000,
    permitGated: true,
    apply(s) { s.lifestealRangedPercent = (s.lifestealRangedPercent || 0) + 4; },
  },

  // +30% move speed while crouched. Routes through derivedStats.crouch-
  // MoveBonus, which player.js multiplies into crouchSpeed each frame.
  swift_shadows: {
    id: 'swift_shadows', name: 'Swift Shadows',
    lore: 'A thief\'s prayer. The patient never get caught.',
    short: '+30% move speed while crouched',
    tint: 0x303040, price: 80000,
    apply(s) { s.crouchMoveBonus = (s.crouchMoveBonus || 1) * 1.30; },
  },

  // Player attacks (ranged hits AND melee swings — including quick
  // melee while a gun is equipped) slow nearby enemies for 1s.
  // Implemented via derivedStats.dervishSlowRadius — main.js sweeps
  // gunmen within radius and stamps slowT.
  dervish_prayer: {
    id: 'dervish_prayer', name: 'Dervish Prayer',
    lore: 'Whispered while spinning. Time hesitates around you.',
    short: 'Attacks briefly slow enemies within 4m',
    tint: 0xc8a0e8, price: 90000,
    apply(s) {
      s.dervishSlowRadius = Math.max(s.dervishSlowRadius || 0, 4);
      s.dervishSlowDuration = Math.max(s.dervishSlowDuration || 0, 1.0);
    },
  },

  // Reflect 25% of melee damage taken back as bleed on the attacker.
  // Implemented in main.js onPlayerHit for melee enemies.
  thread_cuts: {
    id: 'thread_cuts', name: 'Thread Cuts Both Ways',
    lore: 'A length of red string wrapped twice. The price of binding two things.',
    short: 'Melee hits taken bleed the attacker for 25%',
    tint: 0xb02040, price: 90000,
    apply(s) { s.meleeReflectBleedPercent = Math.max(s.meleeReflectBleedPercent || 0, 25); },
  },

  // Quick-melee with a ranged weapon equipped tops the mag up by 1.
  // No kill / hit requirement — the swing itself triggers it.
  bloody_mag: {
    id: 'bloody_mag', name: 'Bloody Mag',
    lore: 'always save one bullet.',
    short: 'Quick-melee reloads 1 bullet into your mag',
    tint: 0xc9a868, price: 84000,
    apply(s) { s.oneInChamberActive = true; },
  },

  // Cursed bell — flavor-cloaked nerf. Inspect text shows "???"; the
  // real effect is +30% incoming damage and a buffed mythic-drop floor
  // (3% → 6%). main.js damagePlayer + rollMythicDrop read the flags.
  mourners_bell: {
    id: 'mourners_bell', name: "Mourner's Bell",
    lore: 'A quiet reminder of a life well lived.',
    short: '???',
    tint: 0x404048, price: 110000,
    permitGated: true,
    apply(s) {
      s.incomingDmgMult = (s.incomingDmgMult || 1) * 1.30;
      s.mythicDropChanceFloor = Math.max(s.mythicDropChanceFloor || 0, 0.06);
    },
  },
  // -------------------------------------------------------------
  // Duck reward — every stamina drain (dodge, block, melee) pays
  // half. Pairs naturally with the dodge / parry-counter playstyle
  // the duck encounter ends up rewarding.
  // -------------------------------------------------------------
  carbon_cycle: {
    id: 'carbon_cycle', name: 'Carbon Cycle',
    lore: 'A small green sprig in a bullet casing. Breath in, breath out.',
    short: 'All stamina costs halved',
    tint: 0x60c070,
    price: 104000,
    encounterOnly: true,    // Loose Duck encounter only — no shop pool
    apply(s) { s.staminaCostMult = (s.staminaCostMult || 1) * 0.5; },
  },
  // -------------------------------------------------------------
  // The Lamp curse — granted from the cursed chest of the three.
  // Every shot drains 3 ammo from the magazine (the bullet you fire
  // plus 2 more). Floored at 0 — a near-empty mag still fires the
  // last round. Tagged `curse: true` so the Curse Breaker encounter
  // can detect + remove it; `synthetic: true` keeps it out of shops
  // and random pools (only path is the cursed chest).
  // -------------------------------------------------------------
  brass_prisoner: {
    id: 'brass_prisoner', name: 'Brass Prisoner',
    lore: 'A small brass figure curled inside a bullet casing. He pays your debts in lead.',
    short: 'CURSED — every shot drains 2 bullets',
    tint: 0x8a6028,
    price: 0,
    curse: true,
    synthetic: true,
    apply(_s) { /* effect is at the fire callsite — see tickShooting */ },
  },

  // -------------------------------------------------------------
  // Djinn's Blessing — granted by the Curse Breaker on success
  // (the gypsy traps the freed djinn in a charm and bonds it to
  // the player). A small orb floats around the player and fires
  // a parallel shot every time the player fires, dealing 25% of
  // the player weapon's damage and able to crit.
  //
  // synthetic: true keeps it out of shops + random pools — the
  // only acquisition path is the curse-breaker reward, so the
  // player has to take the curse + pay 8000c to lift it before
  // they earn the blessing.
  // -------------------------------------------------------------
  djinns_blessing: {
    id: 'djinns_blessing', name: "Djinn's Blessing",
    lore: 'A grateful echo of the brass prisoner, freed and bound. It floats at your shoulder and shoots when you do.',
    short: 'Spectral orb fires alongside you · 25% damage · can crit',
    tint: 0x80c0ff,
    price: 0,
    synthetic: true,
    apply(_s) { /* effect is at the fire callsite — see tickShooting */ },
  },

  // -------------------------------------------------------------
  // Lucky Dice — Brian encounter reward (the "take off the hat"
  // path). A small set of weighted dice that hum in your pocket.
  // Every kill grants 2-12 extra credits on top of the base roll.
  // synthetic: true keeps it out of shops + random pools — only
  // path is the Brian encounter.
  // -------------------------------------------------------------
  lucky_dice: {
    id: 'lucky_dice', name: 'Lucky Dice',
    lore: 'A loaded pair Brian rolled when he could still sleep. They roll for you now.',
    short: 'Every kill drops 2-12 extra credits',
    tint: 0xe8d060,
    price: 0,
    synthetic: true,
    apply(_s) { /* effect is in onEnemyKilled — see main.js */ },
  },

  // -------------------------------------------------------------
  // Bloody Jigsaw — Spaces Inbetween chain reward (puppet stands
  // up, drops this when handed the Shitty Bike). Full immunity to
  // bleed status from any damage source. Broken bones still apply.
  // synthetic: true — only path is the encounter chain.
  // -------------------------------------------------------------
  bloody_jigsaw: {
    id: 'bloody_jigsaw', name: 'Bloody Jigsaw',
    lore: '"I\'ve been looking for this thing all over." His grin doesn\'t move when he talks.',
    short: 'Immune to bleeding',
    tint: 0xb02020,
    price: 0,
    synthetic: true,
    apply(s) { s.bleedImmune = true; },
  },

  // -------------------------------------------------------------
  // Durability-overhaul relic pair — Patcher (gear) + Charlene
  // (weapons) both halve the relevant drain. Owning both auto-grants
  // Covetous, a synthetic that flips the indestructible flags.
  // Mirrors the Opening Act / Closing Act → Magnum Opus chain in
  // ArtifactCollection.acquire below.
  // -------------------------------------------------------------
  patcher: {
    id: 'patcher', name: 'Patcher',
    lore: 'A roll of olive-drab tape and three needles. He swore by patches over plates.',
    short: '−50% armor durability drain',
    tint: 0x80c8a0,
    price: 90000,
    apply(s) { s.armorDurabilityMult = (s.armorDurabilityMult || 1) * 0.5; },
  },
  charlene: {
    id: 'charlene', name: 'Charlene',
    lore: 'this is my weapon, there are many like it but this one is mine.',
    short: '−50% weapon durability drain',
    tint: 0xa88060,
    price: 90000,
    apply(s) { s.weaponDurabilityMult = (s.weaponDurabilityMult || 1) * 0.5; },
  },
  covetous: {
    id: 'covetous', name: 'Covetous',
    lore: 'He knew how to take care of his things.',
    short: 'All gear and weapons are indestructible',
    tint: 0xe6c870,
    price: 0,
    synthetic: true,
    apply(s) { s.indestructibleGear = true; s.indestructibleWeapons = true; },
  },
  way_of_the_worrier: {
    id: 'way_of_the_worrier', name: 'Way of the Worrier',
    lore: "you're so worried you're constantly flinching at everything that comes your way",
    short: '30% chance bullets miss you',
    tint: 0xa07a8a,
    price: 0,
    encounterOnly: true,    // Spicy Arena reward only — no shop / merchant rotation
    // Sets the dodge-chance derived stat. damagePlayer reads this
    // and rolls before applying any incoming damage; on dodge, the
    // entire damage event is voided (durability + recap untouched).
    apply(s) { s.flinchDodgeChance = Math.max(s.flinchDodgeChance || 0, 0.30); },
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
    // Synth chain — owning both Acts auto-grants Magnum Opus. The
    // synthetic isn't shoppable; this is the only acquisition path.
    if ((id === 'opening_act' || id === 'closing_act')
        && this.owned.has('opening_act')
        && this.owned.has('closing_act')
        && !this.owned.has('magnum_opus')) {
      this.owned.add('magnum_opus');
    }
    // Synth chain — owning Patcher + Charlene auto-grants Covetous,
    // which flips the indestructible flags on every drain site.
    if ((id === 'patcher' || id === 'charlene')
        && this.owned.has('patcher')
        && this.owned.has('charlene')
        && !this.owned.has('covetous')) {
      this.owned.add('covetous');
    }
    return true;
  }
  // Remove a single relic from the owned set. Used by the Curse
  // Breaker encounter to lift Brass Prisoner. Returns true if the
  // relic was present and removed; false otherwise.
  remove(id) {
    if (!this.owned.has(id)) return false;
    this.owned.delete(id);
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

// Build a relic pickup item. A relic is a permanent run modifier —
// the shop buy flow + the floor pickup path both recognise items
// with `type === 'relic'` and grant the artifact directly to the
// player's owned set rather than putting it in the inventory grid.
// `relicFor` is the canonical builder; `artifactScrollFor` is kept
// as a backwards-compat alias for any caller that still uses the
// old name.
export function relicFor(id) {
  const def = ARTIFACT_DEFS[id];
  if (!def) return null;
  return {
    id: `relic_${id}`,
    artifactId: id,
    name: def.name,
    type: 'relic',
    tint: def.tint,
    rarity: 'legendary',
    description: def.short,
    lore: def.lore,
    basePrice: def.price,
  };
}
export const artifactScrollFor = relicFor;
