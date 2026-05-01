// New gameplay-tuning home, per CLAUDE.md "Coding standards" rule 1.
// Numbers that *tune* the game (costs, durations, stat magnitudes,
// drop weights) live here so a balance retune is one file edit. Keep
// physics constants (gravity, fixed-tick) and one-off algorithm
// numbers (loop bounds, indices) inline in the modules that use them.
//
// `src/tunables.js` is the legacy config — it's still authoritative
// for the systems that already source from it (lighting, movement,
// combat, megabosses, weapons). Going forward, NEW tuning lands here;
// systems migrate over as they're touched for unrelated reasons.

export const BALANCE = {
  // Trainer (Recruiter) permanent unlocks. Each entry carries the
  // chip cost AND the stat magnitude so ui_hideout's blurb generator
  // and main.js's _applyTrainerUnlocks both read from the same source
  // of truth — no risk of label / effect drift.
  //
  // `cost` = persistent chips required to buy.
  // The remaining fields are read by _applyTrainerUnlocks to apply
  // the actual stat effect; the field name describes the multiplier
  // or bonus shape.
  trainer: {
    // Vitality — flat max-HP bonuses.
    vit_1:    { cost:  60, maxHpBonus: 10 },
    vit_2:    { cost: 140, maxHpBonus: 10 },
    vit_3:    { cost: 280, maxHpBonus: 10 },
    vit_4:    { cost: 220, maxHpBonus:  5 },
    vit_5:    { cost: 380, maxHpBonus:  5 },

    // Endurance — multiplicative stamina-regen bonus.
    end_1:    { cost:  80, staminaRegenAdd: 0.10 },
    end_2:    { cost: 180, staminaRegenAdd: 0.10 },
    end_3:    { cost: 280, staminaRegenAdd: 0.05 },
    end_4:    { cost: 480, staminaRegenAdd: 0.05 },

    // Conditioning — flat max-stamina bonus.
    stam_1:   { cost:  50, maxStaminaBonus:  5 },
    stam_2:   { cost: 100, maxStaminaBonus:  5 },
    stam_3:   { cost: 220, maxStaminaBonus: 10 },

    // Composure — stagger-duration shrink (multiplicative).
    comp_1:   { cost:  90, staggerDurationMult: 0.90 },
    comp_2:   { cost: 180, staggerDurationMult: 0.95 },
    comp_3:   { cost: 320, staggerDurationMult: 0.95 },

    // Quick Hands — multiplicative reload-speed bonus.
    reload_1: { cost:  70, reloadSpeedAdd: 0.05 },
    reload_2: { cost: 140, reloadSpeedAdd: 0.05 },
    reload_3: { cost: 280, reloadSpeedAdd: 0.10 },

    // Marksmanship — multiplicative spread reduction.
    aim_1:    { cost:  80, spreadMult: 0.97 },
    aim_2:    { cost: 180, spreadMult: 0.95 },
    aim_3:    { cost: 360, spreadMult: 0.93 },

    // Eye for Detail — flat crit-chance add.
    crit_1:   { cost: 120, critChanceBonus: 0.01 },
    crit_2:   { cost: 280, critChanceBonus: 0.02 },

    // Footwork — multiplicative move-speed bonus.
    move_1:   { cost: 100, moveSpeedAdd: 0.02 },
    move_2:   { cost: 220, moveSpeedAdd: 0.03 },

    // Scavenger — multiplicative credit-drop bonus on kills.
    carry_1:  { cost:  80, creditDropAdd: 0.05 },
    carry_2:  { cost: 200, creditDropAdd: 0.10 },

    // Field Recovery — out-of-combat HP regen rate + delay shave.
    regen_1: { cost: 100, healthRegenAdd:        0.10 },
    regen_2: { cost: 240, healthRegenAdd:        0.20 },
    regen_3: { cost: 420, healthRegenAdd:        0.20 },
    regen_4: { cost: 700, healthRegenAdd:        0.30 },

    // Quick Recovery — out-of-combat regen delay shave.
    regen_delay_1: { cost: 180, healthRegenDelayBonus: 0.5 },
    regen_delay_2: { cost: 360, healthRegenDelayBonus: 0.5 },
    // Save-compat: prior single-tier id 'regen_delay' is preserved so
    // existing players don't lose their bonus on the rename.
    regen_delay:   { cost: 180, healthRegenDelayBonus: 0.5 },

    // Plate Carrier — flat ballistic resistance (capped at 0.7 in damagePlayer).
    ballistic_1: { cost: 120, ballisticResist: 0.05 },
    ballistic_2: { cost: 260, ballisticResist: 0.05 },
    ballistic_3: { cost: 480, ballisticResist: 0.05 },

    // Asbestos Lung — flat fire resistance (capped at 0.95 in damagePlayer).
    fire_1: { cost: 100, fireResist: 0.05 },
    fire_2: { cost: 220, fireResist: 0.10 },
    fire_3: { cost: 420, fireResist: 0.15 },

    // Iron Will — flat damage reduction.
    will_1: { cost: 140, dmgReductionAdd: 0.04 },
    will_2: { cost: 320, dmgReductionAdd: 0.05 },
    will_3: { cost: 600, dmgReductionAdd: 0.06 },

    // Cleaver — flat melee damage multiplier add.
    melee_1: { cost:  90, meleeDmgAdd: 0.10 },
    melee_2: { cost: 200, meleeDmgAdd: 0.10 },
    melee_3: { cost: 380, meleeDmgAdd: 0.15 },

    // Heavy Hitter — knockback multiplier.
    knock_1: { cost:  80, knockbackAdd: 0.10 },
    knock_2: { cost: 180, knockbackAdd: 0.15 },

    // Killshot — extra headshot multiplier on top of base zone mult.
    head_1: { cost: 160, headMultAdd: 0.10 },
    head_2: { cost: 360, headMultAdd: 0.15 },
    head_3: { cost: 700, headMultAdd: 0.20 },

    // Sight Discipline — ADS-easing speed.
    ads_1: { cost:  90, adsSpeedAdd: 0.10 },
    ads_2: { cost: 200, adsSpeedAdd: 0.15 },

    // Quartermaster — extra pocket grid slots.
    pockets_1: { cost: 120, pocketsAdd: 1 },
    pockets_2: { cost: 280, pocketsAdd: 1 },
    pockets_3: { cost: 560, pocketsAdd: 1 },

    // Bandolier — extra throwable charges at run start.
    throw_1: { cost: 140, throwableChargeAdd: 1 },
    throw_2: { cost: 360, throwableChargeAdd: 1 },

    // Ghost Step — stealth detection multiplier (lower = better stealth).
    stealth_1: { cost: 110, stealthMult: 0.92 },
    stealth_2: { cost: 240, stealthMult: 0.90 },
    stealth_3: { cost: 460, stealthMult: 0.88 },

    // Backpedal Drill — restore movement speed while shooting backward.
    backpedal_1: { cost: 120, backpedalReliefAdd: 0.20 },
    backpedal_2: { cost: 280, backpedalReliefAdd: 0.30 },

    // Steady Aim — ADS sway dampener.
    sway_1: { cost: 100, swayMult: 0.92 },
    sway_2: { cost: 240, swayMult: 0.88 },

    // Class unlocks — pure cost gates; the run-start UI reads which
    // classes are unlocked from getRecruiterUnlocks() and adjusts
    // its picker accordingly. No stat effect at the trainer level.
    class_demolisher: { cost: 260 },
    class_marksman:   { cost: 260 },
    class_heavy:      { cost: 320 },
    class_recon:      { cost: 320 },
    class_medic:      { cost: 380 },
    class_pyro:       { cost: 420 },
  },

  // Body-loot rarity gates by floor index. The forced gear roll on
  // boss / sub-boss kills used to be floor-independent — a floor-1
  // sub-boss could drop a guaranteed-epic, and a floor-1 boss had a
  // 22% legendary chance flat. Now each tier's epic / legendary odds
  // scale with `levelIdx` and cap out late-game.
  //
  // For each tier, the resolution order is:
  //   1. Roll legendary (boss tier only)
  //   2. Else roll epic
  //   3. Else roll rare
  //   4. Else fall through to uncommon (or rare on boss primary gear)
  loot: {
    // Boss tier — primary gear roll (was 22% legendary / 38% epic / 40% rare).
    bossGear: {
      legendarySlope: 0.012, legendaryCap: 0.10,    // L1 ≈ 1%, L8+ = 10%
      epicBase:       0.04,  epicSlope:    0.025, epicCap: 0.22,  // L1 ≈ 6.5%, L8+ = 22%
      // floor for rare; below it falls to uncommon. Boss primary
      // gear should always at least be rare-tier in feel.
      rareFloor: true,
    },
    // Boss tier — second gear roll (was 10% epic / 40% rare / 50% uncommon).
    bossSecondGear: {
      epicSlope: 0.012, epicCap: 0.10,             // L1 ≈ 1%, L8+ = 10%
      rareBase:  0.10,  rareSlope: 0.04, rareCap: 0.50,  // L1 ≈ 14%, L8+ = 50%
    },
    // Sub-boss gear roll (was 20% epic / 45% rare / 35% uncommon).
    subBossGear: {
      epicSlope: 0.020, epicCap:  0.20,            // L1 ≈ 2%, L8+ = 20%
      rareBase:  0.10,  rareSlope: 0.045, rareCap: 0.65,  // L1 ≈ 14.5%, L8+ = 65%
    },
    // Armor "upgrade" chance — flat per-floor add + tier bonus, capped.
    armorUpgrade: {
      perFloorSlope: 0.025,
      cap:           0.25,
      bossBonus:     0.18,
      subBossBonus:  0.08,
      // Within an upgrade, rarity table by tier.
      bossRoll:    { epic: 0.10, rare: 0.40 },     // remainder uncommon
      subBossRoll: { rare: 0.15 },                 // remainder uncommon
      normalRoll:  {},                             // always uncommon
    },
  },

  // Mega-boss tuning that's NEW (existing Arboter HP / damage / phase
  // thresholds still live in tunables.megabossArboter — touched there
  // when the system was extracted; new attacks land here per the
  // current practice).
  megaboss: {
    // The General — phalanx + wave megaboss. Stationary commander
    // with 3 fixed shield bearers in front and an endless trickle of
    // melee grunts from behind. HP + wave cap scale with the run's
    // mega-boss-encounter index.
    general: {
      baseHp:                 5000,
      hpScalePerEncounter:    0.4,    // hp = base × (1 + slope·k)
      // Phalanx — 3 heavy shield bearers between player and General.
      phalanxCount:           3,
      phalanxHpMult:          3.0,    // 100 base × 3 = 300 HP each
      phalanxStandoffDist:    6.0,    // m in front of General
      phalanxSlotSpacing:     1.6,    // m between adjacent slots on the perpendicular line
      phalanxJitterAmp:       0.4,    // small breathing jitter
      phalanxJitterHz:        0.4,    // slow oscillation
      phalanxFollowRate:      1.4,    // m/s lerp toward target slot
      phalanxTurnRate:        1.0,    // rad/s — slow facing toward player
      // Wave system — melee grunts streaming from behind The General.
      firstWaveDelay:         3.0,    // first wave fires this many seconds after intro
      waveIntervalSec:        9.0,    // gap between waves
      waveBaseCount:          3,      // first wave size
      wavePerWaveBump:        1,      // count grows by this per wave
      waveBaseCap:            10,     // soft cap at first encounter
      waveCapPerEncounter:    2,      // +2 grunts/wave per re-encounter
      waveMaxCap:             20,     // hard cap regardless of difficulty
      troopHpMult:            0.6,    // 100 base × 0.6 = 60 HP grunts
      troopHpScalePerEncounter: 0.3,  // troops scale alongside the General
      troopDamageMult:        0.8,
      // Wave promotion — every wave, 1 grunt becomes a swordsman with
      // double HP (and a slight visual scale-up via melee variant).
      swordsmanHpFactor:      2.0,
      swordsmanScale:         1.25,
      // Bark cadence.
      barkCooldownSec:        1.5,
    },
    // Arboter "summon melee grunts" attack. Spawn count scales with
    // the run's mega-boss-encounter index (k = 0, 1, 2, ...). Capped
    // so a 5th-encounter Arboter doesn't drown the player in trash.
    arboterSummon: {
      baseCount:           2,    // first encounter
      perEncounterScale:   1,    // +1 per subsequent meeting
      maxCount:            6,    // hard cap
      ringRadius:          4.5,  // grunts spawn on a ring this far from boss
      ringJitter:          1.2,  // ±jitter on the radius for spread
      hpMult:              0.6,  // summoned grunts are slightly weaker than rolled grunts
      damageMult:          0.8,
      telegraphSec:        1.0,  // arms-up signal duration
      attackSec:           0.6,  // spawn-burst window
    },
  },
};
