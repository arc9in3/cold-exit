// Central store of live-tunable values. Modules read from this object each
// frame so the debug panel can mutate values without re-wiring anything.
export const tunables = {
  // Live lighting tunables — scene.js reads these when building the
  // scene, main.js's syncLighting() updates the live light refs each
  // frame so console edits take effect without a reload. Press F3
  // in-game to dump the current values to the browser console.
  lighting: {
    hemiSky:             0x4a1575,
    hemiGround:          0x1e1f25,
    hemiIntensity:       0.000,
    keyColor:            0xaec4d8,
    keyIntensity:        3.000,
    fillColor:           0x191a48,
    fillIntensity:       2.000,
    rimColor:            0xf358df,
    rimIntensity:        2.000,
    fogColor:            0x22252a,
    fogDensity:          0.0000,
    playerAuraColor:     0xffffff,
    playerAuraIntensity: 0.000,
    playerAuraDistance:  15.00,
    playerAuraDecay:     3.35,
  },
  move: {
    walkSpeed: 5,
    sprintSpeed: 10,
    crouchSpeed: 3,
    crouchSprintSpeed: 5.5,  // held crouch + sprint — faster than sneak, noisier
    // Accel + friction softened from 50/20 → 32/14 so direction changes
    // and stops have a small carry. Snap-stop arcade feel was reading
    // weightless and undermining the cel-shooter aesthetic. The hit-stop
    // and impact frames also read cleaner when the character isn't
    // already moving the next frame.
    accel: 32,
    friction: 14,
    standMuzzleY: 1.18,
    crouchMuzzleY: 0.78,
  },
  dash: {
    speed: 15,
    duration: 0.2,
    cooldown: 0.25,
    doubleTapWindow: 0.22,
    iFrames: 0.12,
  },
  roll: {
    speed: 15,
    duration: 0.45,
    cooldown: 0.75,
    iFrames: 0.3,
  },
  slide: {
    entrySpeedMin: 8,
    startBoost: 1.25,
    friction: 5,
    minDuration: 0.25,
    maxDuration: 1.2,
    steerStrength: 3,
  },
  jump: {
    impulse: 7.0,
    gravity: 22.0,
  },
  crouch: {
    heightScale: 0.55,
  },
  ads: {
    moveMultiplier: 0.55,
    enterTime: 0.28,
  },
  attack: {
    headMultiplier: 2.5,
    tracerLife: 0.07,
    muzzleFlashLife: 0.05,
    impactLife: 0.18,
  },
  zones: {
    head:  { damageMult: 2.5 },
    torso: { damageMult: 1.0 },
    legs:  { damageMult: 0.85, slowDuration: 2.0, slowFactor: 0.45 },
    arm:   { damageMult: 0.7,  disarmChance: 0.7 },
  },
  enemy: {
    maxHealth: 100,
    respawnDelay: 2.0,
    hitFlashTime: 0.08,
    knockback: 0.25,
  },
  player: {
    maxHealth: 100,
    regenDelay: 3.5,
    regenRate: 7,
    regenLossFactor: 0.5,   // fraction of each hit that locks out of natural regen
    hitFlashTime: 0.15,
    collisionRadius: 0.4,
  },
  status: {
    bleedDps: 3,            // current-HP DoT while bleeding
    brokenDps: 2,           // current-HP DoT while broken
    brokenCapDps: 1.2,      // regenCap DoT while broken (makes it urgent)
    bleedDuration: 12,      // seconds a bleed lasts untreated
    brokenDuration: 20,     // seconds a broken bone lasts untreated
    meleeBleedChance: 0.22, // chance a melee enemy swing inflicts bleed
    meleeBrokenChance: 0.10,// chance a melee swing cracks a bone
    bulletBleedChance: 0.08,// chance a bullet hit causes a bleed
  },
  stamina: {
    max: 100,
    regenRate: 35,
    regenDelay: 0.7,
    dodgeCost: 20,
    rollCost: 28,
    comboCosts: [5, 6, 14],     // per combo step index — halved from [10,12,28]
    blockDrainRate: 5,           // per second held
    deflectCost: 6,              // extra per absorbed projectile
    parryCost: 10,
    minToAct: 8,                 // below this, new actions are gated
  },
  block: {
    moveMultiplier: 0.4,
    parryWindow: 0.28,
    spinSpeed: 9,
    redirectDamageMult: 1.6,
    deflectFlashLife: 0.18,
  },
  ai: {
    active: true,
    spreadMultiplier: 2.2,     // makes AI aim noticeably worse than player
    flankChance: 0.55,
    maxHealth: 100,
    respawnDelay: 10.0,
    detectionRange: 18,          // ~one room; was 32 before the room-scale rework
    detectionAngleDeg: 140,
    // Point-blank "presence" bubble — LoS within this distance forces
    // detection regardless of cone, rear-blindspot, or stealth mult.
    // Keeps a crouched-in-shadow player from walking right up to an
    // enemy's face undetected.
    proximityRange: 3.0,
    loseTargetTime: 2.0,
    reactionTime: 0.35,
    preferredRange: 15,
    rangeTolerance: 2.5,
    maxFireRange: 50,          // longest distance AI will attempt a shot
    moveSpeed: 3.4,
    strafeSpeed: 2.2,          // sideways component when flanking
    collisionRadius: 0.45,
  },
  meleeEnemy: {
    maxHealth: 100,
    respawnDelay: 9.0,
    moveSpeed: 5.6,
    detectionRange: 14,          // ~one room; was 22 before room-scale rework
    proximityRange: 3.0,         // LoS within this distance forces detection regardless of stealth
    swingRange: 1.9,
    swingWindup: 0.22,
    swingDamage: 16,
    swingCooldown: 0.5,
    collisionRadius: 0.42,
    dashRange: 5.0,       // start a dash-close inside this distance
    dashSpeed: 11.0,      // boost speed while dashing
    dashDuration: 0.28,
    dashCooldown: 1.6,
  },
  melee: {
    // Player's F-swipe. Single melee weapon for now — per-weapon variants later.
    swipeRange: 2.6,
    swipeAngleDeg: 95,
    swipeDamage: 40,
    swipeCooldown: 0.35,
    swipeKnockback: 4.5,
    swipePenetration: 999,     // arc hits everything in cone by default
    swipeArcLife: 0.14,
  },
  procgen: {
    arenaSize: 44,
    fullWalls: 7,
    lowCovers: 10,
    gapWalls: 3,
    meleeEnemies: 5,
    rangedEnemies: 2,
  },
  loot: {
    pickupRadius: 2.2,
    bobAmplitude: 0.08,
  },
  camera: {
    // Iso ortho frustum height in world units. Held at 16 — the wider
    // LoS RAY_RANGE (los_mask.js, 48m) is reached via ADS edge-pan
    // and the optic frustum push-in. The default zoom stays tight so
    // the moment-to-moment combat read is the same; ADS rewards you
    // with extra reach that the new LoS budget can actually fill.
    viewHeight: 16,
    followLerp: 9,
  },
  xp: {
    level1Cost: 80,
    perLevel: 50,
    killValue: { gunman: 30, melee: 18 },
  },
  stealth: {
    crouchDetectionMult: 0.5,   // crouched player's effective detection distance
    crouchSprintDetectionMult: 0.88,  // sprinting while crouched — extra noise
    executeRange: 1.7,
    executeBackDot: -0.15,       // dot(enemy.forward, toPlayer) must be below this
  },
  currency: {
    // credits dropped per enemy kill, roll in [min, max] range.
    dropChance: 0.7,
    amounts: {
      normal:  [4, 12],
      subBoss: [35, 65],
      boss:    [110, 180],
    },
    sellMult: 0.35,
    // Shop prices, set so a rare/epic/legendary purchase is a real
    // commitment rather than a casual pickup. Roughly 5–10× the
    // pre-rebalance numbers; rare gear is intentionally a big spend.
    basePrice: {
      common:    1500,
      uncommon:  4500,
      rare:      12000,
      epic:      32000,
      legendary: 80000,
    },
    // Random ±% price fluctuation rolled when a merchant's stock is generated.
    priceFluxRange: 0.25,
    // Per-level shop price ramp — every level past 1 adds this to the
    // price multiplier. priceFor(item, shopMult) gets shopMult that
    // already includes this factor (computed in main.js via getShopMult).
    levelPriceRamp: 0.18,
  },
  healer: {
    smallHeal: 40,
    smallCost: 20,
    fullCost:  55,
  },
  merchant: {
    stockSize: 6,
  },
  // Gunsmith / armorer affix-transfer pricing. See src/smiths.js for
  // the full formula. 10× the original draft so the smith reads as
  // a high-stakes economic decision (it lets the player skip the
  // random affix roll, so the gold cost has to bite).
  smith: {
    transfer: {
      base: 2500,        // flat charge per transfer
      perValue: 200,     // gold per |affix.value| point
      rarityMult: 1500,  // gold per target-rarity tier (common=0..mythic=5)
      mcMult: 1.5,       // extra multiplier when target is mastercraft
    },
  },
  rarity: {
    tiers: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
    colors: {
      common:    0x8a8f99,
      uncommon:  0x4a9a5a,
      rare:      0x4a7ac9,
      epic:      0x9a5ac9,
      legendary: 0xd0a038,
    },
  },
  durability: {
    weaponDecayPerShot: 0.020,   // weapons drain noticeably (4× prior); base 200 HP still ≈10k shots
    weaponDecayPerSwipe: 0.02,
    armorDamageRatio: 0.85,      // fraction of incoming dmg routed to armor HP — gear drains 55% faster
    minRepairability: 0.85,      // doc'd here for the store later
  },
  burn: {
    // Burn now stacks per fire-damage instance — each stack contributes
    // `dps` per second, and the stack count decays when burnT hits 0.
    // Duration is the timer window per stack-refresh; longer exposure
    // = bigger stack = bigger total DoT.
    duration: 12.0,
    dps: 6,
  },
  // Pixel-aim mode. When `pixelMode` is true and the cursor is on an
  // enemy mesh, fireOneShot multiplies the angular spread cone by the
  // tighten factors below — single-pellet weapons collapse to ~20% of
  // baseline cone (shots reliably land on the pixel under the
  // cursor), multi-pellet weapons (shotguns) collapse to ~50%
  // (cluster the pattern on the chosen body part instead of fanning
  // across the whole silhouette). Set pixelMode = false to restore
  // the legacy quadrant-feel spread behaviour.
  aim: {
    pixelMode: true,
    enemyTightenSingle: 0.20,
    enemyTightenPellet: 0.50,
    // Head-aim assist. When the cursor is within `headAssistRadiusPx`
    // pixels of an enemy head's screen-space center, snap the aim
    // point onto that head (and stamp zone='head' for the damage
    // multiplier). Stops "I was clearly hovering over the head but
    // the system says I missed it" feedback. Asymmetric:
    // headAssistTopBias > 1 makes the radius extend further ABOVE
    // the head than to the sides — the top of the cranium is the
    // pixel most often brushed past while trying to land headshots.
    headAssistEnabled: true,
    headAssistRadiusPx: 30,
    headAssistTopBias: 1.8,
  },
  medkit: {
    smallHeal: 30,
    largeHeal: 65,
  },
  weapons: [
    {
      name: 'Makarov',
      type: 'ranged',
      class: 'pistol',
      rarity: 'common',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi',
      fireRate: 4.0,
      damage: 28,
      range: 28,
      hipSpread: 0.075,
      adsSpread: 0.011,
      adsZoom: 0.82,
      adsPeekDistance: 3.5,
      tracerColor: 0xffd27a,
      muzzleLength: 0.5,
      muzzleGirth: 0.12,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 8,
      reloadTime: 1.0,
    },
    {
      name: 'Benelli M4',
      type: 'ranged',
      class: 'shotgun',
      rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'underRail', 'topRail', 'stock', 'magazine'],
      fireMode: 'semi',
      fireRate: 3.0,
      damage: 15,
      range: 18,
      hipSpread: 0.2,
      adsSpread: 0.1,
      adsZoom: 0.85,
      adsPeekDistance: 3.0,
      tracerColor: 0xff7a3a,
      muzzleLength: 0.85,
      muzzleGirth: 0.17,
      pelletCount: 8,
      burstCount: 1,
      burstInterval: 0,
      magSize: 7,
      reloadTime: 3.0,
    },
    {
      name: 'M249',
      type: 'ranged',
      class: 'lmg',
      rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
      fireMode: 'auto',
      fireRate: 13,
      damage: 24,
      range: 60,
      hipSpread: 0.2,
      adsSpread: 0.024,
      adsZoom: 0.65,
      adsPeekDistance: 6.0,
      tracerColor: 0xffae5a,
      muzzleLength: 1.05,
      muzzleGirth: 0.16,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 200,
      reloadTime: 4.8,
    },
    {
      // Renamed Apr-26: this entry was mistakenly named "Widowmaker
      // Rocket Launcher" but its stats are pure flamethrower
      // (fireMode 'flame', per-tick damage, cone). Renamed to its
      // actual identity. The flamer boss archetype still finds it
      // via `tunables.weapons.find(w => w.fireMode === 'flame')`,
      // so the `name` change is purely cosmetic to the player.
      name: 'Flamethrower',
      type: 'ranged',
      // Reclassed under the unified 'exotic' mastery family (flame, GL,
      // RL, dart, flare). Gameplay-side flame behaviour (fire spread,
      // burn ticks) gates on `fireMode === 'flame'` so re-tagging the
      // class here is safe.
      class: 'exotic',
      rarity: 'rare',
      attachmentSlots: ['underRail', 'sideRail', 'magazine'],
      fireMode: 'flame',
      fireRate: 0.6,
      damage: 5,                  // per tick
      // 8m effective range — realistic flamethrower, also matches the
      // aiFireFlame fallback (6.5m). The previous 80m value made the
      // visible flame cone cover half the arena and let "The Burn"
      // boss reach across rooms (compounded by the missing LOS check).
      range: 8,
      hipSpread: 0,
      adsSpread: 0,
      adsZoom: 0.95,
      adsPeekDistance: 1.5,
      tracerColor: 0xff6020,
      muzzleLength: 0.95,
      muzzleGirth: 0.18,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      // tickFlame deducts 1 ammo per tick at flameTickRate. magSize was
      // accidentally carried over from the Widowmaker entry this slot
      // used to hold (which was a single-shot rocket — magSize: 1 → 2);
      // for flame the comment's "5s of held fire" intent at tickRate 20
      // requires a 100-tick mag.
      magSize: 100,
      reloadTime: 4.0,            // long swap-tank reload — flamer is a commit
      flameAngleDeg: 36,
      flameTickRate: 20,          // 5s of held fire before dry; was 12 (~8s)
      // Loudness — `alertEnemiesFromShot` reads `weapon.noiseRange` when
      // present. A roaring flame jet is plainly louder than a pistol;
      // wakes the whole next room.
      noiseRange: 36,
    },
    {
      // Widowmaker Rocket Launcher — actual rocket launcher this time.
      // Single-shot, slow flat-flying projectile, big AoE on impact.
      // Reads through the firePlayerProjectile path (main.js:4108)
      // because fireMode === 'projectile'.
      name: 'Widowmaker Rocket Launcher',
      type: 'ranged',
      class: 'exotic',
      rarity: 'rare',
      attachmentSlots: ['underRail', 'sideRail', 'topRail', 'stock'],
      fireMode: 'projectile',
      projectile: 'rocket',
      projectileSpeed: 22,        // slow enough to read in flight
      projectileGrav: 0,           // straight + level
      projectileFuse: 4.0,         // self-detonate after 4s if no impact
      projectileBounce: 0,
      aoeRadius: 5.5,
      aoeDamage: 240,
      aoeShake: 0.75,
      fireRate: 0.5,               // one rocket every 2s
      damage: 240,                 // direct-impact damage
      range: 70,
      hipSpread: 0.06,
      adsSpread: 0.02,
      adsZoom: 0.62,
      adsPeekDistance: 6.5,
      tracerColor: 0xff8040,
      muzzleLength: 1.4,
      muzzleGirth: 0.22,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 1,
      reloadTime: 3.6,
      noiseRange: 42,
    },
    // --- Extended pistol lineup ---
    {
      name: 'Glock 17', type: 'ranged', class: 'pistol', rarity: 'common',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi', fireRate: 5.0, damage: 32, range: 34,
      hipSpread: 0.07, adsSpread: 0.008,
      adsZoom: 0.82, adsPeekDistance: 3.2,
      tracerColor: 0xe0d080, muzzleLength: 0.48, muzzleGirth: 0.12,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 17, reloadTime: 0.9,
    },
    // --- Extended SMG lineup ---
    {
      name: 'UMP45', type: 'ranged', class: 'smg', rarity: 'common',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 10, damage: 22, range: 28,
      hipSpread: 0.13, adsSpread: 0.026,
      adsZoom: 0.75, adsPeekDistance: 4.4,
      tracerColor: 0xc0cbd8, muzzleLength: 0.7, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 25, reloadTime: 1.6,
    },
    {
      name: 'PDW', type: 'ranged', class: 'smg', rarity: 'common',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 14, damage: 15, range: 28,
      hipSpread: 0.13, adsSpread: 0.028,
      adsZoom: 0.72, adsPeekDistance: 4.6,
      tracerColor: 0xdbe5f0, muzzleLength: 0.72, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.3,
    },
    {
      name: 'P90', type: 'ranged', class: 'smg', rarity: 'rare',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
      fireMode: 'auto', fireRate: 15, damage: 14, range: 30,
      hipSpread: 0.12, adsSpread: 0.024,
      adsZoom: 0.74, adsPeekDistance: 4.2,
      tracerColor: 0xeaf0d0, muzzleLength: 0.6, muzzleGirth: 0.15,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 50, reloadTime: 1.5,
    },
    // --- Extended rifle lineup ---
    {
      name: 'AK47', type: 'ranged', class: 'rifle', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 10, damage: 32, range: 58,
      hipSpread: 0.12, adsSpread: 0.018,
      adsZoom: 0.58, adsPeekDistance: 7.0,
      tracerColor: 0xe08030, muzzleLength: 0.96, muzzleGirth: 0.15,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.6,
    },
    {
      name: 'AS VAL', type: 'ranged', class: 'rifle', rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 15, damage: 32, range: 50,
      hipSpread: 0.1, adsSpread: 0.014,
      adsZoom: 0.56, adsPeekDistance: 7.4,
      tracerColor: 0xf0a050, muzzleLength: 0.88, muzzleGirth: 0.14,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.3,
      suppressedByDefault: true,
    },
    {
      // 9×39 DMR sibling of the AS VAL — shares the integrally-
      // suppressed 9×39 FBX (they use the same platform IRL). Slower
      // fire rate, higher per-shot damage, tighter ADS spread, longer
      // range; semi-auto only so it reads as a marksman rifle vs. the
      // VAL's close-range auto role.
      name: 'VSS', type: 'ranged', class: 'rifle', rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi', fireRate: 4.0, damage: 58, range: 72,
      hipSpread: 0.08, adsSpread: 0.007,
      adsZoom: 0.48, adsPeekDistance: 9.2,
      tracerColor: 0xe8a060, muzzleLength: 0.98, muzzleGirth: 0.12,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 10, reloadTime: 1.6,
      suppressedByDefault: true,
    },
    // --- Revolvers ---
    {
      name: 'Colt Anaconda .44', type: 'ranged', class: 'pistol', rarity: 'common',
      attachmentSlots: ['sideRail', 'topRail', 'grip', 'trigger'],
      fireMode: 'semi', fireRate: 2.6, damage: 82, range: 38,
      hipSpread: 0.06, adsSpread: 0.005,
      adsZoom: 0.84, adsPeekDistance: 3.0,
      tracerColor: 0xd2b48c, muzzleLength: 0.32, muzzleGirth: 0.11,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 6, reloadTime: 2.0,
    },
    {
      name: 'Desert Eagle .50', type: 'ranged', class: 'pistol', rarity: 'rare',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi', fireRate: 2.4, damage: 110, range: 42,
      hipSpread: 0.085, adsSpread: 0.006,
      adsZoom: 0.7, adsPeekDistance: 4.8,
      tracerColor: 0xffd060, muzzleLength: 0.72, muzzleGirth: 0.17,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 7, reloadTime: 1.5,
    },
    {
      name: 'M1911', type: 'ranged', class: 'pistol', rarity: 'common',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi', fireRate: 4.0, damage: 52, range: 34,
      hipSpread: 0.068, adsSpread: 0.007,
      adsZoom: 0.8, adsPeekDistance: 3.4,
      tracerColor: 0xe8c878, muzzleLength: 0.55, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 7, reloadTime: 1.1,
    },

    // --- Extended SMG lineup ---

    // --- Marksman / bolt lineup (still class: rifle — rides the rifle mastery tree) ---
    {
      name: 'Remington 700', type: 'ranged', class: 'sniper', rarity: 'common',
      attachmentSlots: ['muzzle', 'barrel', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi', fireRate: 1.3, damage: 72, range: 80,
      hipSpread: 0.13, adsSpread: 0.005,
      adsZoom: 0.5, adsPeekDistance: 8.0,
      tracerColor: 0xd8b890, muzzleLength: 1.1, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 5, reloadTime: 2.4,
    },
    {
      name: 'SVD Dragunov', type: 'ranged', class: 'sniper', rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi', fireRate: 4.0, damage: 78, range: 82,
      hipSpread: 0.1, adsSpread: 0.005,
      adsZoom: 0.44, adsPeekDistance: 9.0,
      tracerColor: 0xe0a050, muzzleLength: 1.25, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 10, reloadTime: 2.4,
    },
    {
      name: 'Cheytac Intervention', type: 'ranged', class: 'sniper', rarity: 'epic',
      attachmentSlots: ['muzzle', 'topRail', 'stock', 'trigger', 'underRail'],
      // .408 CheyTac is a bolt-action anti-materiel platform. ~0.4/s
      // = one round every ~2.5s including bolt cycle. Reload bumped
      // to 4.5s to match the heft of the magazine swap.
      fireMode: 'semi', fireRate: 0.4, damage: 210, range: 100,
      hipSpread: 0.18, adsSpread: 0.003,
      adsZoom: 0.36, adsPeekDistance: 10.0,
      tracerColor: 0xffe030, muzzleLength: 1.6, muzzleGirth: 0.2,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 7, reloadTime: 4.5,
    },

    // --- Extended rifle lineup ---
    {
      name: 'M16', type: 'ranged', class: 'rifle', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 12, damage: 26, range: 70,
      hipSpread: 0.09, adsSpread: 0.011,
      adsZoom: 0.58, adsPeekDistance: 7.2,
      tracerColor: 0x90b0c8, muzzleLength: 0.92, muzzleGirth: 0.14,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.4,
    },
    {
      // CQC variant — bumped RoF, wider spread, shorter effective
      // range than the standard rifle baseline. Per-platform CQB/CQC
      // rule: trade reach for in-room cyclic suppression.
      name: 'AUG A3-CQC', type: 'ranged', class: 'rifle', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 14, damage: 24, range: 48,
      hipSpread: 0.14, adsSpread: 0.020,
      adsZoom: 0.58, adsPeekDistance: 7.0,
      tracerColor: 0xd88838, muzzleLength: 0.88, muzzleGirth: 0.14,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.3,
    },

    // --- LMG lineup ---
    {
      name: 'Type 80 LMG', type: 'ranged', class: 'lmg', rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip'],
      fireMode: 'auto', fireRate: 12, damage: 36, range: 65,
      hipSpread: 0.22, adsSpread: 0.028,
      adsZoom: 0.58, adsPeekDistance: 7.2,
      tracerColor: 0xe85020, muzzleLength: 1.12, muzzleGirth: 0.17,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 100, reloadTime: 4.5,
    },

    // --- Extended shotgun ---
    {
      name: 'AA-12', type: 'ranged', class: 'shotgun', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
      fireMode: 'auto', fireRate: 5.0, damage: 14, range: 18,
      hipSpread: 0.2, adsSpread: 0.1,
      adsZoom: 0.82, adsPeekDistance: 3.8,
      tracerColor: 0xc89060, muzzleLength: 0.82, muzzleGirth: 0.16,
      pelletCount: 8, burstCount: 1, burstInterval: 0,
      magSize: 8, reloadTime: 3.5,
    },
    {
      // Unique artifact — infinite ammo, headshots pop heads, crouch turns
      // the wielder effectively invisible to AI.
      name: "Jessica's Rage",
      type: 'ranged',
      class: 'pistol',
      rarity: 'legendary',
      artifact: true,
      infiniteAmmo: true,
      artifactPerks: ['phantomCrouch', 'popperHead'],
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'grip', 'trigger'],
      fireMode: 'semi',
      fireRate: 3.2,
      damage: 125,
      range: 48,
      hipSpread: 0.028,
      adsSpread: 0.002,
      adsZoom: 0.62,
      adsPeekDistance: 6,
      tracerColor: 0xff2a2a,
      muzzleLength: 0.75,
      muzzleGirth: 0.16,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 999,
      reloadTime: 0.01,
    },

    // --- MYTHIC-tier weapons -------------------------------------------
    // Dropped only by major bosses (see main.js rollMythicDrop). Each is
    // a "signature" weapon with a unique mechanical twist. Jessica's
    // Rage stays apex and is NOT in this pool.
    {
      name: 'Dragonbreath',
      type: 'ranged', class: 'shotgun', rarity: 'mythic',
      igniteOnHit: true,         // sets hit enemies on fire via burn DoT
      mythic: true,
      attachmentSlots: ['muzzle', 'barrel', 'sideRail', 'stock'],
      fireMode: 'semi',
      fireRate: 1.4,
      damage: 34,
      range: 22,
      hipSpread: 0.18,
      adsSpread: 0.10,
      adsZoom: 0.82,
      adsPeekDistance: 4.5,
      tracerColor: 0xff6020,
      muzzleLength: 0.78, muzzleGirth: 0.18,
      pelletCount: 9,
      burstCount: 1, burstInterval: 0,
      magSize: 6, reloadTime: 2.1,
    },

    // Low-tier melee — common drops from basic enemies. Shorter range and
    // weaker combos than the katana; shared combo structure so the player
    // can still swing them.
    {
      name: 'Combat Knife',
      type: 'melee', class: 'melee', rarity: 'common',
      meleeThreshold: 2.8,
      tracerColor: 0xc0c0c8,
      muzzleLength: 0.55, muzzleGirth: 0.05,
      adsZoom: 0.8, adsPeekDistance: 2.4,
      combo: [
        { close: { damage: 10, range: 1.8, angleDeg: 90,  advance: 0.5,
                   startup: 0.04, active: 0.07, recovery: 0.14, window: 0.32, knockback: 1.2 },
          far:   { damage: 14, range: 2.4, angleDeg: 55,  advance: 1.6,
                   startup: 0.06, active: 0.08, recovery: 0.16, window: 0.34, knockback: 1.5 } },
        { close: { damage: 13, range: 1.9, angleDeg: 95,  advance: 0.6,
                   startup: 0.05, active: 0.08, recovery: 0.16, window: 0.34, knockback: 1.5 },
          far:   { damage: 17, range: 2.5, angleDeg: 60,  advance: 1.8,
                   startup: 0.07, active: 0.09, recovery: 0.18, window: 0.34, knockback: 1.8 } },
        { close: { damage: 22, range: 2.0, angleDeg: 120, advance: 0.4,
                   startup: 0.10, active: 0.12, recovery: 0.30, window: 0.14, knockback: 3.2 },
          far:   { damage: 28, range: 2.8, angleDeg: 70,  advance: 2.0,
                   startup: 0.12, active: 0.12, recovery: 0.32, window: 0.14, knockback: 3.5 } },
      ],
    },
    {
      name: 'Hammer',
      type: 'melee', class: 'melee', rarity: 'common',
      meleeThreshold: 2.9,
      tracerColor: 0x8a6a3c,
      muzzleLength: 0.8, muzzleGirth: 0.08,
      adsZoom: 0.82, adsPeekDistance: 2.6,
      combo: [
        { close: { damage: 14, range: 2.0, angleDeg: 95,  advance: 0.55,
                   startup: 0.06, active: 0.10, recovery: 0.20, window: 0.34, knockback: 2.2 },
          far:   { damage: 18, range: 2.6, angleDeg: 55,  advance: 1.7,
                   startup: 0.09, active: 0.10, recovery: 0.22, window: 0.34, knockback: 2.6 } },
        { close: { damage: 18, range: 2.1, angleDeg: 100, advance: 0.6,
                   startup: 0.07, active: 0.11, recovery: 0.22, window: 0.36, knockback: 2.8 },
          far:   { damage: 22, range: 2.8, angleDeg: 60,  advance: 1.9,
                   startup: 0.10, active: 0.11, recovery: 0.22, window: 0.36, knockback: 3.2 } },
        { close: { damage: 30, range: 2.3, angleDeg: 140, advance: 0.3,
                   startup: 0.13, active: 0.14, recovery: 0.38, window: 0.14, knockback: 5.0 },
          far:   { damage: 36, range: 3.0, angleDeg: 65,  advance: 2.2,
                   startup: 0.15, active: 0.13, recovery: 0.40, window: 0.14, knockback: 5.4 } },
      ],
    },
    {
      name: 'Baseball Bat',
      type: 'melee', class: 'melee', rarity: 'uncommon',
      meleeThreshold: 3.0,
      tracerColor: 0xb98a5c,
      muzzleLength: 0.95, muzzleGirth: 0.06,
      adsZoom: 0.8, adsPeekDistance: 2.7,
      combo: [
        { close: { damage: 16, range: 2.1, angleDeg: 95,  advance: 0.6,
                   startup: 0.06, active: 0.10, recovery: 0.20, window: 0.36, knockback: 2.5 },
          far:   { damage: 20, range: 2.9, angleDeg: 55,  advance: 1.9,
                   startup: 0.09, active: 0.11, recovery: 0.22, window: 0.36, knockback: 2.8 } },
        { close: { damage: 20, range: 2.2, angleDeg: 100, advance: 0.7,
                   startup: 0.08, active: 0.10, recovery: 0.22, window: 0.38, knockback: 3.0 },
          far:   { damage: 24, range: 3.1, angleDeg: 58,  advance: 2.1,
                   startup: 0.10, active: 0.11, recovery: 0.24, window: 0.38, knockback: 3.4 } },
        { close: { damage: 34, range: 2.5, angleDeg: 140, advance: 0.3,
                   startup: 0.13, active: 0.15, recovery: 0.40, window: 0.14, knockback: 5.5 },
          far:   { damage: 42, range: 3.4, angleDeg: 60,  advance: 2.5,
                   startup: 0.16, active: 0.14, recovery: 0.42, window: 0.14, knockback: 6.0 } },
      ],
    },
    {
      // Cursor distance from player picks a 'close' or 'far' variant per step.
      // Each step: startup (rooted) → active (lunges + deals damage once) →
      // recovery (rooted) → window (LMB chains to next step; timeout resets).
      name: 'katana',
      type: 'melee',
      class: 'melee',
      rarity: 'rare',
      meleeThreshold: 3.2,
      tracerColor: 0x9dd0ff,
      muzzleLength: 1.1,
      muzzleGirth: 0.06,
      adsZoom: 0.78,
      adsPeekDistance: 3.0,
      combo: [
        {
          close: { damage: 18, range: 2.2, angleDeg: 85, advance: 0.7,
                   startup: 0.05, active: 0.09, recovery: 0.18, window: 0.38,
                   knockback: 2.0 },
          far:   { damage: 24, range: 3.2, angleDeg: 50, advance: 2.2,
                   startup: 0.08, active: 0.10, recovery: 0.22, window: 0.40,
                   knockback: 2.5 },
        },
        {
          close: { damage: 22, range: 2.3, angleDeg: 100, advance: 0.9,
                   startup: 0.06, active: 0.10, recovery: 0.20, window: 0.40,
                   knockback: 2.5 },
          far:   { damage: 28, range: 3.4, angleDeg: 55, advance: 2.4,
                   startup: 0.10, active: 0.12, recovery: 0.24, window: 0.40,
                   knockback: 3.0 },
        },
        {
          close: { damage: 40, range: 2.7, angleDeg: 150, advance: 0.4,
                   startup: 0.14, active: 0.18, recovery: 0.45, window: 0.12,
                   knockback: 6.0,
                   shockwaveRadius: 3.6, shockwaveDamage: 28, shockwaveKnockback: 7 },
          far:   { damage: 48, range: 3.8, angleDeg: 60, advance: 2.8,
                   startup: 0.16, active: 0.14, recovery: 0.5, window: 0.12,
                   knockback: 6.0,
                   shockwaveRadius: 4.2, shockwaveDamage: 24, shockwaveKnockback: 6 },
        },
      ],
    },
    // --- Extended melee lineup ---
    {
      name: 'Brass Knuckles',
      type: 'melee', class: 'melee', rarity: 'common',
      meleeThreshold: 2.5,
      tracerColor: 0xc99030,
      muzzleLength: 0.3, muzzleGirth: 0.05,
      adsZoom: 0.82, adsPeekDistance: 2.2,
      combo: [
        { close: { damage: 8,  range: 1.5, angleDeg: 80, advance: 0.4,
                   startup: 0.03, active: 0.06, recovery: 0.10, window: 0.26, knockback: 1.0 },
          far:   { damage: 10, range: 1.9, angleDeg: 50, advance: 1.2,
                   startup: 0.04, active: 0.06, recovery: 0.12, window: 0.28, knockback: 1.2 } },
        { close: { damage: 11, range: 1.6, angleDeg: 85, advance: 0.45,
                   startup: 0.04, active: 0.07, recovery: 0.12, window: 0.26, knockback: 1.2 },
          far:   { damage: 14, range: 2.0, angleDeg: 55, advance: 1.3,
                   startup: 0.05, active: 0.07, recovery: 0.14, window: 0.28, knockback: 1.4 } },
        { close: { damage: 18, range: 1.8, angleDeg: 110, advance: 0.3,
                   startup: 0.07, active: 0.10, recovery: 0.24, window: 0.12, knockback: 2.4 },
          far:   { damage: 22, range: 2.4, angleDeg: 60, advance: 1.5,
                   startup: 0.09, active: 0.10, recovery: 0.26, window: 0.12, knockback: 2.8 } },
      ],
    },
    {
      name: 'Crowbar',
      type: 'melee', class: 'melee', rarity: 'common',
      meleeThreshold: 2.9,
      tracerColor: 0x7a4a30,
      muzzleLength: 0.9, muzzleGirth: 0.05,
      adsZoom: 0.82, adsPeekDistance: 2.6,
      combo: [
        { close: { damage: 12, range: 2.0, angleDeg: 90, advance: 0.55,
                   startup: 0.05, active: 0.09, recovery: 0.18, window: 0.32, knockback: 1.8 },
          far:   { damage: 16, range: 2.7, angleDeg: 55, advance: 1.8,
                   startup: 0.08, active: 0.10, recovery: 0.22, window: 0.34, knockback: 2.2 } },
        { close: { damage: 15, range: 2.1, angleDeg: 95, advance: 0.6,
                   startup: 0.06, active: 0.10, recovery: 0.20, window: 0.34, knockback: 2.2 },
          far:   { damage: 19, range: 2.8, angleDeg: 60, advance: 2.0,
                   startup: 0.09, active: 0.10, recovery: 0.22, window: 0.34, knockback: 2.6 } },
        { close: { damage: 26, range: 2.3, angleDeg: 130, advance: 0.35,
                   startup: 0.12, active: 0.13, recovery: 0.36, window: 0.14, knockback: 4.4 },
          far:   { damage: 32, range: 3.0, angleDeg: 65, advance: 2.2,
                   startup: 0.14, active: 0.12, recovery: 0.38, window: 0.14, knockback: 4.8 } },
      ],
    },
    {
      name: 'Kukri',
      type: 'melee', class: 'melee', rarity: 'uncommon',
      meleeThreshold: 2.9,
      tracerColor: 0xb8b0a0,
      muzzleLength: 0.7, muzzleGirth: 0.05,
      adsZoom: 0.8, adsPeekDistance: 2.6,
      combo: [
        { close: { damage: 14, range: 2.0, angleDeg: 95, advance: 0.6,
                   startup: 0.04, active: 0.08, recovery: 0.14, window: 0.32, knockback: 1.4 },
          far:   { damage: 18, range: 2.8, angleDeg: 55, advance: 1.9,
                   startup: 0.06, active: 0.09, recovery: 0.18, window: 0.34, knockback: 1.6 } },
        { close: { damage: 18, range: 2.1, angleDeg: 100, advance: 0.65,
                   startup: 0.05, active: 0.08, recovery: 0.16, window: 0.32, knockback: 1.6 },
          far:   { damage: 22, range: 2.9, angleDeg: 58, advance: 2.0,
                   startup: 0.07, active: 0.09, recovery: 0.18, window: 0.34, knockback: 1.8 } },
        { close: { damage: 28, range: 2.3, angleDeg: 125, advance: 0.4,
                   startup: 0.10, active: 0.12, recovery: 0.30, window: 0.14, knockback: 3.2 },
          far:   { damage: 34, range: 3.0, angleDeg: 65, advance: 2.3,
                   startup: 0.12, active: 0.12, recovery: 0.32, window: 0.14, knockback: 3.6 } },
      ],
    },
    {
      name: 'Tomahawk',
      type: 'melee', class: 'melee', rarity: 'uncommon',
      meleeThreshold: 3.0,
      tracerColor: 0x8a5a2a,
      muzzleLength: 0.85, muzzleGirth: 0.08,
      adsZoom: 0.8, adsPeekDistance: 2.7,
      combo: [
        { close: { damage: 18, range: 2.1, angleDeg: 90, advance: 0.55,
                   startup: 0.06, active: 0.10, recovery: 0.20, window: 0.34, knockback: 2.0 },
          far:   { damage: 22, range: 2.8, angleDeg: 55, advance: 1.9,
                   startup: 0.09, active: 0.11, recovery: 0.22, window: 0.36, knockback: 2.4 } },
        { close: { damage: 22, range: 2.2, angleDeg: 100, advance: 0.6,
                   startup: 0.07, active: 0.11, recovery: 0.22, window: 0.36, knockback: 2.4 },
          far:   { damage: 26, range: 2.9, angleDeg: 58, advance: 2.0,
                   startup: 0.10, active: 0.11, recovery: 0.22, window: 0.36, knockback: 2.8 } },
        { close: { damage: 34, range: 2.5, angleDeg: 130, advance: 0.35,
                   startup: 0.13, active: 0.14, recovery: 0.40, window: 0.14, knockback: 5.0 },
          far:   { damage: 40, range: 3.1, angleDeg: 62, advance: 2.4,
                   startup: 0.15, active: 0.13, recovery: 0.42, window: 0.14, knockback: 5.4 } },
      ],
    },
    {
      name: 'Fire Axe',
      type: 'melee', class: 'melee', rarity: 'uncommon',
      meleeThreshold: 3.1,
      tracerColor: 0xb04030,
      muzzleLength: 1.0, muzzleGirth: 0.08,
      adsZoom: 0.78, adsPeekDistance: 2.7,
      combo: [
        { close: { damage: 22, range: 2.3, angleDeg: 100, advance: 0.55,
                   startup: 0.08, active: 0.12, recovery: 0.24, window: 0.36, knockback: 2.6 },
          far:   { damage: 28, range: 3.0, angleDeg: 58, advance: 2.1,
                   startup: 0.11, active: 0.13, recovery: 0.26, window: 0.38, knockback: 3.0 } },
        { close: { damage: 27, range: 2.4, angleDeg: 105, advance: 0.6,
                   startup: 0.09, active: 0.13, recovery: 0.26, window: 0.38, knockback: 3.0 },
          far:   { damage: 33, range: 3.1, angleDeg: 60, advance: 2.3,
                   startup: 0.12, active: 0.13, recovery: 0.28, window: 0.38, knockback: 3.4 } },
        { close: { damage: 42, range: 2.6, angleDeg: 140, advance: 0.3,
                   startup: 0.15, active: 0.16, recovery: 0.44, window: 0.14, knockback: 6.0 },
          far:   { damage: 50, range: 3.3, angleDeg: 62, advance: 2.6,
                   startup: 0.18, active: 0.15, recovery: 0.46, window: 0.14, knockback: 6.4 } },
      ],
    },
    {
      name: 'Sledgehammer',
      type: 'melee', class: 'melee', rarity: 'rare',
      meleeThreshold: 3.3,
      tracerColor: 0x505868,
      muzzleLength: 1.1, muzzleGirth: 0.12,
      adsZoom: 0.76, adsPeekDistance: 2.8,
      combo: [
        { close: { damage: 28, range: 2.3, angleDeg: 100, advance: 0.5,
                   startup: 0.10, active: 0.14, recovery: 0.28, window: 0.36, knockback: 3.6 },
          far:   { damage: 36, range: 3.1, angleDeg: 55, advance: 2.1,
                   startup: 0.14, active: 0.15, recovery: 0.32, window: 0.38, knockback: 4.2 } },
        { close: { damage: 34, range: 2.4, angleDeg: 105, advance: 0.55,
                   startup: 0.11, active: 0.15, recovery: 0.30, window: 0.38, knockback: 4.2 },
          far:   { damage: 42, range: 3.2, angleDeg: 58, advance: 2.3,
                   startup: 0.15, active: 0.15, recovery: 0.32, window: 0.38, knockback: 4.8 } },
        { close: { damage: 56, range: 2.7, angleDeg: 150, advance: 0.3,
                   startup: 0.18, active: 0.20, recovery: 0.50, window: 0.12, knockback: 7.5,
                   shockwaveRadius: 3.2, shockwaveDamage: 22, shockwaveKnockback: 5 },
          far:   { damage: 64, range: 3.5, angleDeg: 62, advance: 2.7,
                   startup: 0.20, active: 0.16, recovery: 0.52, window: 0.12, knockback: 8.0,
                   shockwaveRadius: 3.8, shockwaveDamage: 20, shockwaveKnockback: 5 } },
      ],
    },
    {
      name: 'Chainsaw',
      type: 'melee', class: 'melee', rarity: 'epic',
      meleeThreshold: 3.0,
      tracerColor: 0xd08020,
      muzzleLength: 0.95, muzzleGirth: 0.14,
      adsZoom: 0.8, adsPeekDistance: 2.6,
      // Chainsaw: stupid-high DPS, loud. Shorter swings trade knockback
      // for faster follow-ups; the 3rd step stays committed but without a
      // shockwave (its damage is already extreme).
      combo: [
        { close: { damage: 24, range: 1.9, angleDeg: 85, advance: 0.5,
                   startup: 0.05, active: 0.09, recovery: 0.16, window: 0.26, knockback: 1.2 },
          far:   { damage: 30, range: 2.6, angleDeg: 50, advance: 1.8,
                   startup: 0.07, active: 0.10, recovery: 0.18, window: 0.28, knockback: 1.4 } },
        { close: { damage: 30, range: 2.0, angleDeg: 90, advance: 0.55,
                   startup: 0.06, active: 0.09, recovery: 0.18, window: 0.28, knockback: 1.4 },
          far:   { damage: 36, range: 2.7, angleDeg: 52, advance: 1.9,
                   startup: 0.08, active: 0.10, recovery: 0.18, window: 0.28, knockback: 1.6 } },
        { close: { damage: 48, range: 2.1, angleDeg: 110, advance: 0.4,
                   startup: 0.11, active: 0.13, recovery: 0.30, window: 0.12, knockback: 2.2 },
          far:   { damage: 56, range: 2.8, angleDeg: 60, advance: 2.0,
                   startup: 0.13, active: 0.13, recovery: 0.32, window: 0.12, knockback: 2.6 } },
      ],
    },
    {
      name: 'Colt Python',
      type: 'ranged',
      class: 'pistol',
      rarity: 'uncommon',
      attachmentSlots: ['sideRail', 'topRail', 'grip', 'trigger'],
      fireMode: 'semi',
      fireRate: 3.2,
      damage: 64,
      range: 40,
      hipSpread: 0.058,
      adsSpread: 0.005,
      adsZoom: 0.78,
      adsPeekDistance: 4.0,
      tracerColor: 0xc8b070,
      muzzleLength: 0.62,
      muzzleGirth: 0.13,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 6,
      reloadTime: 1.7,
    },
    {
      name: 'Colt 357',
      type: 'ranged',
      class: 'pistol',
      rarity: 'common',
      attachmentSlots: ['sideRail', 'topRail', 'grip', 'trigger'],
      fireMode: 'semi',
      fireRate: 3.4,
      damage: 58,
      range: 36,
      hipSpread: 0.06,
      adsSpread: 0.006,
      adsZoom: 0.8,
      adsPeekDistance: 3.8,
      tracerColor: 0xd0a060,
      muzzleLength: 0.55,
      muzzleGirth: 0.13,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 6,
      reloadTime: 1.7,
    },
    {
      name: '.38 Special',
      type: 'ranged',
      class: 'pistol',
      rarity: 'common',
      attachmentSlots: ['sideRail', 'topRail', 'grip', 'trigger'],
      fireMode: 'semi',
      fireRate: 4.0,
      damage: 34,
      range: 24,
      hipSpread: 0.085,
      adsSpread: 0.012,
      adsZoom: 0.84,
      adsPeekDistance: 3.2,
      tracerColor: 0xc09060,
      muzzleLength: 0.4,
      muzzleGirth: 0.11,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 6,
      reloadTime: 1.6,
    },
    {
      name: 'Colt Six Shooter',
      type: 'ranged',
      class: 'pistol',
      rarity: 'uncommon',
      attachmentSlots: ['grip', 'trigger'],
      fireMode: 'semi',
      fireRate: 2.4,
      damage: 58,
      range: 32,
      hipSpread: 0.07,
      adsSpread: 0.007,
      adsZoom: 0.8,
      adsPeekDistance: 3.6,
      tracerColor: 0xb87a3a,
      muzzleLength: 0.62,
      muzzleGirth: 0.12,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 6,
      reloadTime: 2.4,
    },
    {
      name: 'Spectre',
      type: 'ranged',
      class: 'smg',
      rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
      fireMode: 'auto',
      fireRate: 14,
      damage: 16,
      range: 26,
      hipSpread: 0.13,
      adsSpread: 0.028,
      adsZoom: 0.74,
      adsPeekDistance: 4.4,
      tracerColor: 0xc8d0e0,
      muzzleLength: 0.66,
      muzzleGirth: 0.13,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 50,
      reloadTime: 1.4,
    },
    {
      // CQB variant — bumped RoF, wider spread, shorter range than
      // the standard Spectre. Per the CQB/CQC rule: trade reach for
      // in-room cyclic suppression.
      name: 'Spectre CQB',
      type: 'ranged',
      class: 'smg',
      rarity: 'common',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'grip', 'magazine'],
      fireMode: 'auto',
      fireRate: 19,
      damage: 12,
      range: 18,
      hipSpread: 0.20,
      adsSpread: 0.050,
      adsZoom: 0.78,
      adsPeekDistance: 4.0,
      tracerColor: 0xb8c0d0,
      muzzleLength: 0.52,
      muzzleGirth: 0.13,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 30,
      reloadTime: 1.2,
    },
    {
      name: 'SPC9',
      type: 'ranged',
      class: 'smg',
      rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto',
      fireRate: 13,
      damage: 18,
      range: 32,
      hipSpread: 0.11,
      adsSpread: 0.022,
      adsZoom: 0.72,
      adsPeekDistance: 4.8,
      tracerColor: 0xc0c8d8,
      muzzleLength: 0.74,
      muzzleGirth: 0.13,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 32,
      reloadTime: 1.3,
    },
    {
      name: 'CAR-15',
      type: 'ranged',
      class: 'rifle',
      rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto',
      fireRate: 13,
      damage: 22,
      range: 52,
      hipSpread: 0.1,
      adsSpread: 0.014,
      adsZoom: 0.62,
      adsPeekDistance: 7.0,
      tracerColor: 0xa8c0e0,
      muzzleLength: 0.78,
      muzzleGirth: 0.14,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 30,
      reloadTime: 1.2,
    },
    {
      name: 'AKS-74',
      type: 'ranged',
      class: 'rifle',
      rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto',
      fireRate: 11,
      damage: 26,
      range: 58,
      hipSpread: 0.1,
      adsSpread: 0.014,
      adsZoom: 0.58,
      adsPeekDistance: 7.0,
      tracerColor: 0xd88848,
      muzzleLength: 0.92,
      muzzleGirth: 0.14,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 30,
      reloadTime: 1.4,
    },
    {
      name: 'AK104',
      type: 'ranged',
      class: 'rifle',
      rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto',
      fireRate: 10,
      damage: 30,
      range: 48,
      hipSpread: 0.12,
      adsSpread: 0.02,
      adsZoom: 0.58,
      adsPeekDistance: 7.0,
      tracerColor: 0xe08838,
      muzzleLength: 0.86,
      muzzleGirth: 0.15,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 30,
      reloadTime: 1.5,
    },
    {
      name: 'JARD J67',
      type: 'ranged',
      class: 'rifle',
      rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi',
      fireRate: 4.5,
      damage: 42,
      range: 72,
      hipSpread: 0.08,
      adsSpread: 0.007,
      adsZoom: 0.55,
      adsPeekDistance: 7.6,
      tracerColor: 0xc0a888,
      muzzleLength: 0.82,
      muzzleGirth: 0.14,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 10,
      reloadTime: 1.5,
    },
    {
      name: 'Mossberg 500',
      type: 'ranged',
      class: 'shotgun',
      rarity: 'common',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
      fireMode: 'semi',
      fireRate: 1.4,
      damage: 15,
      range: 16,
      hipSpread: 0.2,
      adsSpread: 0.1,
      adsZoom: 0.85,
      adsPeekDistance: 3.4,
      tracerColor: 0xb88858,
      muzzleLength: 0.92,
      muzzleGirth: 0.16,
      pelletCount: 8,
      burstCount: 1,
      burstInterval: 0,
      magSize: 6,
      reloadTime: 3.4,
    },
    // --- Apr-26 EOD batch: Kriss Vector ----------------------------------
    {
      // Kriss USA's Super-V recoil-mitigation SMG. .45 ACP, ~1200 RPM
      // cyclic (very high for a pistol caliber), 25-round stick. Even
      // recoil from the in-line bolt makes it remarkably controllable
      // for the rate of fire.
      name: 'Kriss Vector', type: 'ranged', class: 'smg', rarity: 'rare',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 20, damage: 22, range: 28,
      hipSpread: 0.13, adsSpread: 0.025,
      adsZoom: 0.74, adsPeekDistance: 4.5,
      tracerColor: 0xc8d2e0, muzzleLength: 0.66, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 25, reloadTime: 1.4,
    },
    {
      name: 'Remington 870',
      type: 'ranged',
      class: 'shotgun',
      rarity: 'common',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'stock', 'grip', 'magazine'],
      fireMode: 'semi',
      fireRate: 1.4,
      damage: 15,
      range: 17,
      hipSpread: 0.2,
      adsSpread: 0.1,
      adsZoom: 0.85,
      adsPeekDistance: 3.4,
      tracerColor: 0xb87a4a,
      muzzleLength: 0.95,
      muzzleGirth: 0.16,
      pelletCount: 8,
      burstCount: 1,
      burstInterval: 0,
      magSize: 6,
      reloadTime: 3.2,
    },
    {
      name: 'Sawed-Off Shotgun',
      type: 'ranged',
      class: 'shotgun',
      rarity: 'common',
      attachmentSlots: ['grip'],
      fireMode: 'semi',
      fireRate: 1.6,
      damage: 18,
      range: 10,
      hipSpread: 0.34,
      adsSpread: 0.2,
      adsZoom: 0.92,
      adsPeekDistance: 2.6,
      tracerColor: 0xa07050,
      muzzleLength: 0.5,
      muzzleGirth: 0.17,
      pelletCount: 10,
      burstCount: 1,
      burstInterval: 0,
      magSize: 2,
      reloadTime: 2.0,
    },
    {
      name: 'KSG-12',
      type: 'ranged',
      class: 'shotgun',
      rarity: 'rare',
      attachmentSlots: ['muzzle', 'sideRail', 'topRail', 'stock', 'grip'],
      fireMode: 'semi',
      fireRate: 1.6,
      damage: 16,
      range: 18,
      hipSpread: 0.18,
      adsSpread: 0.09,
      adsZoom: 0.84,
      adsPeekDistance: 3.6,
      tracerColor: 0x707880,
      muzzleLength: 0.86,
      muzzleGirth: 0.16,
      pelletCount: 8,
      burstCount: 1,
      burstInterval: 0,
      magSize: 14,
      reloadTime: 4.0,
    },
    {
      name: 'AWP',
      type: 'ranged',
      class: 'sniper',
      rarity: 'epic',
      attachmentSlots: ['muzzle', 'topRail', 'stock', 'trigger', 'underRail'],
      fireMode: 'semi',
      // .338 Lapua bolt action. Slow on purpose — a magnum-caliber
      // bolt-action commits to each shot. Was 0.65; 0.55 keeps the
      // tier ordering (Cheytac slowest, AWP next, .338 Lapua then SVD).
      fireRate: 0.55,
      damage: 145,
      range: 95,
      hipSpread: 0.15,
      adsSpread: 0.004,
      adsZoom: 0.36,
      adsPeekDistance: 9.6,
      tracerColor: 0xd0d0d0,
      muzzleLength: 1.45,
      muzzleGirth: 0.18,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 5,
      reloadTime: 3.8,
    },
    {
      name: '.338 Lapua',
      type: 'ranged',
      class: 'sniper',
      rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi',
      // Same caliber as AWP but a generic bolt-action chassis. 0.65/s
      // ≈ one round every ~1.5s. Was 0.75 — knocked down another
      // notch to keep the magnum-bolt commit feel.
      fireRate: 0.65,
      damage: 130,
      range: 92,
      hipSpread: 0.14,
      adsSpread: 0.005,
      adsZoom: 0.38,
      adsPeekDistance: 9.4,
      tracerColor: 0xe0c080,
      muzzleLength: 1.35,
      muzzleGirth: 0.17,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 5,
      reloadTime: 3.4,
    },
    {
      name: 'Hunting Rifle',
      type: 'ranged',
      class: 'sniper',
      rarity: 'common',
      attachmentSlots: ['muzzle', 'topRail', 'stock', 'trigger'],
      fireMode: 'semi',
      fireRate: 1.4,
      damage: 66,
      range: 72,
      hipSpread: 0.12,
      adsSpread: 0.008,
      adsZoom: 0.46,
      adsPeekDistance: 8.2,
      tracerColor: 0x9a7a4a,
      muzzleLength: 1.15,
      muzzleGirth: 0.13,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 5,
      reloadTime: 2.4,
    },
    {
      name: 'Scimitar',
      type: 'melee',
      class: 'melee',
      rarity: 'uncommon',
      meleeThreshold: 3.1,
      tracerColor: 0xd8d0a8,
      muzzleLength: 1.0,
      muzzleGirth: 0.06,
      adsZoom: 0.78,
      adsPeekDistance: 2.8,
      combo: [
        { close: { damage: 18, range: 2.2, angleDeg: 95, advance: 0.65,
                   startup: 0.05, active: 0.09, recovery: 0.18, window: 0.34, knockback: 1.8 },
          far:   { damage: 24, range: 3.1, angleDeg: 55, advance: 2.1,
                   startup: 0.08, active: 0.10, recovery: 0.22, window: 0.36, knockback: 2.2 } },
        { close: { damage: 22, range: 2.3, angleDeg: 100, advance: 0.7,
                   startup: 0.06, active: 0.10, recovery: 0.20, window: 0.36, knockback: 2.2 },
          far:   { damage: 28, range: 3.3, angleDeg: 60, advance: 2.3,
                   startup: 0.09, active: 0.11, recovery: 0.22, window: 0.36, knockback: 2.6 } },
        { close: { damage: 36, range: 2.6, angleDeg: 140, advance: 0.4,
                   startup: 0.13, active: 0.15, recovery: 0.40, window: 0.14, knockback: 5.0 },
          far:   { damage: 44, range: 3.5, angleDeg: 65, advance: 2.5,
                   startup: 0.15, active: 0.13, recovery: 0.42, window: 0.14, knockback: 5.4 } },
      ],
    },
    // --- Apr-26 EOD batch: small/utility melees ---------------------------
    {
      // Folding switchblade. 3" blade. Light, fast, low damage —
      // pocket knife rather than combat knife. Common drop tier.
      name: 'Pocket Knife',
      type: 'melee', class: 'melee', rarity: 'common',
      meleeThreshold: 2.4,
      tracerColor: 0xb0b0b8,
      muzzleLength: 0.40, muzzleGirth: 0.04,
      adsZoom: 0.85, adsPeekDistance: 2.0,
      combo: [
        { close: { damage: 8,  range: 1.5, angleDeg: 80, advance: 0.4,
                   startup: 0.03, active: 0.06, recovery: 0.10, window: 0.28, knockback: 0.9 },
          far:   { damage: 11, range: 2.0, angleDeg: 50, advance: 1.3,
                   startup: 0.04, active: 0.06, recovery: 0.12, window: 0.30, knockback: 1.1 } },
        { close: { damage: 11, range: 1.6, angleDeg: 85, advance: 0.45,
                   startup: 0.04, active: 0.07, recovery: 0.12, window: 0.30, knockback: 1.1 },
          far:   { damage: 14, range: 2.1, angleDeg: 55, advance: 1.4,
                   startup: 0.05, active: 0.07, recovery: 0.14, window: 0.30, knockback: 1.4 } },
        { close: { damage: 18, range: 1.8, angleDeg: 100, advance: 0.3,
                   startup: 0.07, active: 0.10, recovery: 0.22, window: 0.12, knockback: 2.4 },
          far:   { damage: 22, range: 2.3, angleDeg: 60, advance: 1.6,
                   startup: 0.09, active: 0.10, recovery: 0.24, window: 0.12, knockback: 2.6 } },
      ],
    },
    {
      // Fixed-blade survival / utility knife. 6-8" blade. Heavier
      // than a pocket knife, lighter than a combat knife. Uncommon.
      name: 'Survival Knife',
      type: 'melee', class: 'melee', rarity: 'uncommon',
      meleeThreshold: 2.7,
      tracerColor: 0xc0c4cc,
      muzzleLength: 0.62, muzzleGirth: 0.05,
      adsZoom: 0.82, adsPeekDistance: 2.4,
      combo: [
        { close: { damage: 12, range: 1.9, angleDeg: 90, advance: 0.5,
                   startup: 0.04, active: 0.08, recovery: 0.14, window: 0.32, knockback: 1.3 },
          far:   { damage: 16, range: 2.5, angleDeg: 55, advance: 1.6,
                   startup: 0.06, active: 0.08, recovery: 0.16, window: 0.34, knockback: 1.6 } },
        { close: { damage: 15, range: 2.0, angleDeg: 95, advance: 0.55,
                   startup: 0.05, active: 0.08, recovery: 0.16, window: 0.32, knockback: 1.6 },
          far:   { damage: 19, range: 2.6, angleDeg: 58, advance: 1.7,
                   startup: 0.07, active: 0.09, recovery: 0.18, window: 0.34, knockback: 1.9 } },
        { close: { damage: 24, range: 2.1, angleDeg: 120, advance: 0.4,
                   startup: 0.10, active: 0.12, recovery: 0.30, window: 0.14, knockback: 3.4 },
          far:   { damage: 30, range: 2.8, angleDeg: 65, advance: 2.0,
                   startup: 0.12, active: 0.12, recovery: 0.32, window: 0.14, knockback: 3.8 } },
      ],
    },

    // ================================================================
    // Apr-26 lineup expansion — turning all the tagged-but-unused
    // FBXes from weapon_assignments.json into spawnable items. Stats
    // are real-world inspired (caliber → damage curve, barrel length
    // → range, action → fireRate). Slots match the existing rifle /
    // SMG / sniper / shotgun templates so attachments work uniformly.
    // ================================================================
    {
      // 14.5" 5.56 NATO M4 carbine — bread-and-butter US service
      // weapon. Common-uncommon spawn so it's the rifle the player
      // sees most often early. Balanced fire rate, average range.
      name: 'M4', type: 'ranged', class: 'rifle', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 12, damage: 26, range: 56,
      hipSpread: 0.11, adsSpread: 0.016,
      adsZoom: 0.58, adsPeekDistance: 7.2,
      tracerColor: 0xf0a84a, muzzleLength: 0.92, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.7,
    },
    {
      // 10.5" SBR — same platform, shorter barrel. Less range, more
      // hip-fire spread, faster reload from compact handling.
      name: 'AR-15 SBR', type: 'ranged', class: 'rifle', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 13, damage: 24, range: 46,
      hipSpread: 0.13, adsSpread: 0.020,
      adsZoom: 0.62, adsPeekDistance: 6.4,
      tracerColor: 0xf0a84a, muzzleLength: 0.78, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.5,
    },
    {
      // 7.5" AR pistol with no stock. Treated as a pistol-class for
      // its size + brace-only ergos. Bigger mag than other pistols
      // (30) since it takes AR mags; weaker damage from short barrel.
      name: 'AR-15 Pistol', type: 'ranged', class: 'pistol', rarity: 'rare',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 13, damage: 22, range: 36,
      hipSpread: 0.16, adsSpread: 0.028,
      adsZoom: 0.70, adsPeekDistance: 5.0,
      tracerColor: 0xf0a84a, muzzleLength: 0.62, muzzleGirth: 0.12,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.6,
    },
    {
      // Romanian Draco NAK9 — 9×19 AK-pattern pistol. AK furniture
      // on a pistol-caliber platform. Higher mag than typical pistols,
      // poor accuracy at range, decent close-quarters chaos.
      name: 'Draco NAK9', type: 'ranged', class: 'pistol', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'underRail', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 14, damage: 20, range: 32,
      hipSpread: 0.18, adsSpread: 0.030,
      adsZoom: 0.72, adsPeekDistance: 4.6,
      tracerColor: 0xe89040, muzzleLength: 0.58, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 33, reloadTime: 1.7,
    },
    {
      // AKS-47 — folding-stock variant of the AK47. Same ballistics,
      // slightly bumpier hip-fire because of the lighter stock when
      // folded out, marginally faster handling.
      name: 'AKS-47', type: 'ranged', class: 'rifle', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 9, damage: 32, range: 56,
      hipSpread: 0.13, adsSpread: 0.019,
      adsZoom: 0.58, adsPeekDistance: 7.0,
      tracerColor: 0xe08030, muzzleLength: 0.94, muzzleGirth: 0.15,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.6,
    },
    {
      // JARD J68 — bullpup chambered in 5.56. Compact, integral rail.
      name: 'JARD J68', type: 'ranged', class: 'rifle', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 11, damage: 28, range: 60,
      hipSpread: 0.10, adsSpread: 0.014,
      adsZoom: 0.56, adsPeekDistance: 7.5,
      tracerColor: 0xeaa050, muzzleLength: 0.84, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.7,
    },
    {
      // JARD J56 — heavier-caliber bullpup variant (.308 platform).
      // Slower fire, more damage, longer range, smaller mag.
      name: 'JARD J56', type: 'ranged', class: 'rifle', rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 8, damage: 42, range: 72,
      hipSpread: 0.10, adsSpread: 0.012,
      adsZoom: 0.52, adsPeekDistance: 8.4,
      tracerColor: 0xf0b060, muzzleLength: 0.88, muzzleGirth: 0.14,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 25, reloadTime: 1.9,
    },
    {
      // Henry single-shot 12-gauge slug — break-action, one round at
      // a time, slug round (single high-damage projectile, not pellets
      // like a regular shotgun). Long reload, very high per-shot dmg.
      name: 'Henry Slug Rifle', type: 'ranged', class: 'shotgun', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'topRail', 'stock', 'trigger'],
      fireMode: 'semi', fireRate: 1.0, damage: 110, range: 60,
      hipSpread: 0.05, adsSpread: 0.005,
      adsZoom: 0.50, adsPeekDistance: 7.0,
      tracerColor: 0xd28040, muzzleLength: 1.10, muzzleGirth: 0.14,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 1, reloadTime: 2.4,
    },
    {
      // Remington 700 in tactical chassis — same action as base 700,
      // but with the lowpoly tactical-furniture FBX. Slightly faster
      // fire and tighter ADS spread thanks to chassis ergonomics.
      name: 'Remington 700 Tactical', type: 'ranged', class: 'sniper', rarity: 'rare',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'semi', fireRate: 1.6, damage: 92, range: 110,
      hipSpread: 0.09, adsSpread: 0.005,
      adsZoom: 0.42, adsPeekDistance: 12.0,
      tracerColor: 0xe0c070, muzzleLength: 1.18, muzzleGirth: 0.13,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 5, reloadTime: 2.6,
    },
    {
      // SIG SPCA3 — 9mm AR-style carbine. Treated as SMG class for
      // its caliber + role (close-quarters PCC). Decent fire rate,
      // larger mag than typical pistols.
      name: 'SPCA3', type: 'ranged', class: 'smg', rarity: 'common',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 13, damage: 18, range: 38,
      hipSpread: 0.14, adsSpread: 0.022,
      adsZoom: 0.66, adsPeekDistance: 5.6,
      tracerColor: 0xd8c060, muzzleLength: 0.78, muzzleGirth: 0.12,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 30, reloadTime: 1.6,
    },
    {
      // SIG SPC chambered in .223 — rifle round in an SMG-form-factor
      // body. Higher damage than the 9mm SPCA3, faster bullet, smaller
      // mag. Still SMG class for the ergonomics.
      name: 'SPC223', type: 'ranged', class: 'smg', rarity: 'uncommon',
      attachmentSlots: ['muzzle', 'barrel', 'underRail', 'sideRail', 'topRail', 'stock', 'grip', 'trigger', 'magazine'],
      fireMode: 'auto', fireRate: 12, damage: 22, range: 48,
      hipSpread: 0.13, adsSpread: 0.018,
      adsZoom: 0.62, adsPeekDistance: 6.2,
      tracerColor: 0xeacb70, muzzleLength: 0.84, muzzleGirth: 0.12,
      pelletCount: 1, burstCount: 1, burstInterval: 0,
      magSize: 25, reloadTime: 1.7,
    },

    // -----------------------------------------------------------------
    // Pain — mythic mace. Pact reward from selling the Demon Bear toy
    // to the Great Bear merchant. Every swing — close OR far, opener
    // OR finisher — deals exactly 666 damage. Equip-time `equipMods`
    // grant 66% melee lifesteal AND multiply max HP by 0.5; main.js
    // recomputeStats reads equipMods off the equipped weapon and
    // routes them into derivedStats.
    // -----------------------------------------------------------------
    {
      // pactReward flag keeps Pain out of the random mythic-drop pool
      // (rollMythicDrop in main.js) and the mythic-run starter offer.
      // The only legitimate way to acquire it is the Demon Bear →
      // Great Bear trade chain set up by the Priest encounter.
      name: 'Pain', mythic: true, pactReward: true,
      type: 'melee', class: 'melee', rarity: 'mythic',
      meleeThreshold: 3.3,
      tracerColor: 0x806878,
      muzzleLength: 0.95, muzzleGirth: 0.18,
      adsZoom: 0.78, adsPeekDistance: 2.6,
      // equipMods are applied in recomputeStats from the currently
      // equipped weapon. lifesteal stacks onto derivedStats.lifesteal-
      // MeleePercent (already consumed by the on-hit heal at main.js
      // ~4704). maxHealthMult is applied as a final-pass scalar so
      // it composes with gear bonuses cleanly.
      equipMods: {
        lifestealMeleePercent: 66,
        maxHealthMult: 0.5,
      },
      combo: [
        { close: { damage: 666, range: 2.4, angleDeg: 100, advance: 0.5,
                   startup: 0.10, active: 0.14, recovery: 0.28, window: 0.36, knockback: 3.6 },
          far:   { damage: 666, range: 3.1, angleDeg: 55, advance: 2.1,
                   startup: 0.14, active: 0.15, recovery: 0.32, window: 0.38, knockback: 4.2 } },
        { close: { damage: 666, range: 2.5, angleDeg: 105, advance: 0.55,
                   startup: 0.11, active: 0.15, recovery: 0.30, window: 0.38, knockback: 4.2 },
          far:   { damage: 666, range: 3.2, angleDeg: 58, advance: 2.3,
                   startup: 0.15, active: 0.15, recovery: 0.32, window: 0.38, knockback: 4.8 } },
        { close: { damage: 666, range: 2.7, angleDeg: 150, advance: 0.3,
                   startup: 0.18, active: 0.20, recovery: 0.50, window: 0.12, knockback: 7.5,
                   shockwaveRadius: 3.4, shockwaveDamage: 222, shockwaveKnockback: 6 },
          far:   { damage: 666, range: 3.5, angleDeg: 62, advance: 2.7,
                   startup: 0.20, active: 0.16, recovery: 0.52, window: 0.12, knockback: 8.0,
                   shockwaveRadius: 4.0, shockwaveDamage: 200, shockwaveKnockback: 6 } },
      ],
      description: 'A mace made of soft grey felt, seems to emit pure evil.',
    },
    {
      // Zipline Gun — exotic grappling hook. Pulls enemies to the
      // player on hit, OR pulls the player to terrain on miss-into-
      // wall. Single shot, 5s reload, medium-short range. mythic +
      // encounterOnly tags keep it out of every random pool — the
      // ONLY way to acquire it is the 'love_actually' encounter.
      name: 'Zipline Gun', mythic: true, encounterOnly: true,
      type: 'ranged', class: 'exotic', rarity: 'mythic',
      fireMode: 'grapple',
      grappleRange: 14,
      grappleEnemyDamage: 35,
      grappleSpeed: 32,        // pull travel speed (m/s) — 14m crossed in ~0.45s
      fireRate: 0.2,           // single-shot pacing (one shot per ~5s incl. reload)
      damage: 35,
      range: 14,
      hipSpread: 0.0,
      adsSpread: 0.0,
      adsZoom: 0.78,
      adsPeekDistance: 5.0,
      tracerColor: 0xffd040,
      muzzleLength: 0.85,
      muzzleGirth: 0.20,
      pelletCount: 1,
      burstCount: 1,
      burstInterval: 0,
      magSize: 1,
      reloadTime: 5.0,
      attachmentSlots: ['topRail', 'sideRail', 'underRail', 'stock'],
      description: 'Adventure 360° prototype. Hits an enemy → reels them in. Hits a wall → reels you to it. One shot, long reload.',
    },
  ],
};
