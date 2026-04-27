import * as THREE from 'three';
import { inferRarity, rarityColor, weaponImageMirrorStyle, SLOT_LABEL, SET_DEFS, countEquippedSetPieces } from './inventory.js';
import { thumbnailFor } from './item_thumbnails.js';
import { modelForItem, rotationOverrideForModelPath } from './model_manifest.js';
import { loadModelClone, fitToRadius, applyEmissiveTint, addOutlines } from './gltf_cache.js';
import { BASE_STATS } from './skills.js';

// Verbose item details panel — opens on right-click. Shows lore, full
// stat breakdown, affixes/perks, set bonus progress, and (when the item
// is picked from a loot source or a merchant cell) a live diff against
// whatever the player is currently wearing in the same slot.

// Lore flavor keyed by item name. New items can add an entry here to
// avoid having to edit the core defs.
export const ITEM_LORE = {
  // Pistols
  'Glock 17': 'Polymer-frame service pistol. Light, fast, and forgiving — the sidearm rookies train on and veterans still trust.',
  'Makarov': 'Cold-war service pistol. Stamped, simple, never not in a drawer somewhere.',
  'Colt Anaconda .44': 'Stainless double-action wheelgun chambered in .44 Magnum. Six rounds that ring through ear pro.',
  'Desert Eagle .50': 'Gas-operated .50 monster. Recoil is its own muzzle discipline.',
  'M1911': 'Single-action .45 ACP. Hundred-year-old design, still prints the tightest group on most ranges.',
  'Colt Python': 'Polished steel revolver, six-inch vent rib. The wheelgun connoisseurs argue about.',
  'Colt 357': 'Service revolver in .357 Magnum. Steady, accurate, never in a hurry.',
  '.38 Special': 'Snub-nose chambered in .38. Backup piece — small, light, always there.',
  'Colt Six Shooter': 'Single-action frontier revolver. Slow as conversation, hits like the punchline.',
  'PDW': 'Pistol-caliber carbine. Armor-piercing rounds from a frame your hands already know.',
  // SMGs
  'UMP45': '.45 ACP submachine gun. Heavy round, slow rate, rooms-clearing trade-off.',
  'P90': 'Bullpup 5.7×28 — huge magazine, flat trajectory, and the ergonomics of a shampoo bottle.',
  'Spectre': 'Italian double-stack SMG. Compact, mag-heavy, surprisingly polite.',
  'Spectre CQB': 'Snub-barrel Spectre. Eats short range alive, hates everything past 20m.',
  'SPC9': 'Pistol-caliber carbine in 9mm. Sub-sonic with a can, paper-quiet with the right ammo.',
  // Rifles
  'AK47': 'Stamped receiver, sloppy tolerances, eternal reliability. Punches harder than it has any right to.',
  'AKS-74': 'Folding-stock AK-74 in 5.45×39. Lighter than the 47, faster on follow-ups.',
  'AK104': 'Shortened AK-103. 7.62×39 punch in a carbine package.',
  'AS VAL': 'Integrally suppressed 9×39 carbine. Subsonic, quiet, mean at short range.',
  'VSS': 'Integrally suppressed 9×39 marksman rifle. Slower trigger, heavier hit, whispers across rooftops.',
  'M16': 'A-profile, fixed carry handle, 20-inch barrel. Old-school rifle DNA — long reach, single-shot discipline.',
  'AUG A3-CQC': 'Bullpup carbine, integrated optic, modular muzzle. Reads small, hits like a full-length rifle.',
  'CAR-15': 'Vietnam-era M16 carbine. Telescoping stock, 14-inch barrel, slick rate.',
  'JARD J67': 'Modern straight-pull bullpup. Tight tolerances, eerily smooth trigger.',
  // Snipers
  'Remington 700': 'Bolt-action hunting rifle. Not tactical — just effective at distance.',
  'SVD Dragunov': 'Soviet semi-auto DMR. Tight groups at 300m, unmistakable silhouette.',
  'Cheytac Intervention': 'Anti-materiel bolt-action. Turns cover into a suggestion.',
  'AWP': 'Olympic-grade .338 bolt-action. Single shot answers most questions.',
  '.338 Lapua': 'Long-action magnum platform. Spins-stable past a kilometer.',
  'Hunting Rifle': 'Wooden-stock bolt-action. Built for deer; takes humans without complaint.',
  // LMG / shotgun
  'Type 80 LMG': 'Chinese GPMG, PKM-derivative. Belt-fed 7.62×54R, won\'t stop chewing.',
  'M249': 'SAW. Light machine gun, 200-round box, the rifleman\'s best friend.',
  'AA-12': 'Full-auto combat shotgun. Twelve-round drum, low-recoil system — dumps buckshot faster than anyone expects.',
  'Benelli M4': 'Semi-auto combat shotgun, gas-operated. Issued; reliable; loud.',
  'Mossberg 500': 'Pump-action shotgun. Tube-fed, hardware-store reliable.',
  'Remington 870': 'Pump shotgun, the other classic. Indistinguishable utility from the Mossberg.',
  'Sawed-Off Shotgun': 'Two barrels, no stock. The kind of weapon nobody admits owning.',
  'KSG-12': 'Bullpup pump shotgun, twin tubes. Fourteen rounds in a stacked-deck profile.',
  'Widowmaker Rocket Launcher': 'Shoulder-launched HE rocket. Reusable launcher, single-use rooms.',
  // Melee
  'Combat Knife': 'Plain utility blade. Won\'t stop a charge, but it rarely jams.',
  'Hammer': 'Hardwood bludgeon. Simple, heavy, honest.',
  'Scimitar': 'Curved single-edged sword. Built for sweeping cuts from horseback; works fine on foot.',
  'Baseball Bat': 'Aluminum with a fresh coat of tape. Makes a satisfying ting on helmets.',
  'katana': 'Forged for a duel, stolen for a job. Reach and bleed damage that outclasses anything a grunt can grab.',
  'Brass Knuckles': 'Cast bronze across the knuckles. Fists get heavier; the rest of the hand stays honest.',
  'Crowbar': 'Bent tempered steel. Pries doors open, cracks collarbones, doesn\'t care which.',
  'Kukri': 'Forward-heavy Gurkha blade. Cuts deep with a short swing.',
  'Tomahawk': 'Balanced one-hand axe. Made to throw if you committed, made to chop if you didn\'t.',
  'Fire Axe': 'Red-handled, wedge-headed. Breaks doors. Breaks people.',
  'Sledgehammer': 'Twenty-pound maul. Ignores armor, ignores stance, ignores subtle.',
  'Chainsaw': 'Two-stroke snarl. No finesse. Ends arguments loud.',
  // Artifact
  "Jessica's Rage": 'Four toys, one soul, eternal grievance. The Great Bear only gave her up to a hunter willing to collect.',

  // Armor / gear
  'Kevlar Helmet':       'Layered aramid. Will stop a pistol round — once.',
  'Tactical Helmet':     'Night-vision cut, earpro mount, rail on the bridge. Weight you learn to ignore.',
  'Ballistic Helmet':    'Plate-ready head bucket. Heavy. You can hear your own blood.',
  'Ghillie Hood':        'Shredded burlap and twine. Nobody\'s looking at heads anyway.',
  'Gas Mask':            'CBRN-grade filter. Tastes like rubber forever, but your lungs thank you.',
  'Tactical Goggles':    'Strapped polycarbonate optics. Cuts flash, sharpens contrast, fogs in the rain.',
  'War Paint':           'Black and ochre stripes. Makes your pupils look bigger than they are.',
  'Balaclava':           'Anonymity, warmth, and a slight muffle on your shouting.',
  'Respirator':          'Half-mask filter. Cuts smoke and flame particulates.',
  'Comtacs':             'Active hearing pro. Cuts gunshots, amplifies footsteps.',
  'Silver Earring':      'Small jeweled hoop. Catches the light when you dodge.',
  'Sound Amplifier':     'Directional mic and a tiny DSP. Walls become slightly less opaque.',
  'Surveillance Headset':'Milspec listening kit wired into a wrist display.',
  'Wraith Earpiece':     'Unregistered prototype. Nobody admits to making it.',
  'Combat Earplugs':     'Disposable foam wedges. Dulls the roar, barely touches the hiss.',
  'Shoulder Pads':       'Kevlar cheaters. Shoulders aren\'t vital, but they sure look nice.',
  'Holster Rig':         'Leather pull rig that lets you change mags while running.',
  'Iron Epaulettes':     'Dress uniform brass layered over soft armor.',
  'Light Vest':          'Concealable soft armor. Bulks you out a pocket or two.',
  'Tactical Vest':       'Plate carrier cut for fit. Front, back, and two side pouches.',
  'Plate Armor':         'Ceramic steel-composite plate. Stops rifle. Slows everything.',
  'Ghillie Suit':        'Strips of burlap and fresh foliage. Moves like a tumbleweed; hides like one.',
  'Spetsnaz Plate Carrier': 'Former frontline armor. Someone stripped it off a body and it\'s on its second owner.',
  'Juggernaut Plating':  'Prototype steel suit. Hurts to carry, harder to kill.',
  'Thorned Harness':     'Spiked chest rig. Bad idea to grapple.',
  'Arm Pads':            'Light foam cups — elbows survive a fall.',
  'Assault Sleeves':     'Impact-absorbing tactical sleeves. Helps your hands stop shaking.',
  'Padded Sleeves':      'Quilted cotton and kevlar. Breathes in summer.',
  'Tactical Gloves':     'Knuckle-reinforced shooting gloves. Grip doesn\'t slip.',
  'Gauntlets':           'Plate-back gauntlets. Heavy enough to punch with.',
  'Trigger Gloves':      'Finger-cut gloves with micro-grip beading on the pad.',
  'Climber Gloves':      'Sticky rubber palms. Move like you know where you\'re going.',
  'Stonefist Gauntlets': 'Weighted knuckles, reinforced wrist. Turns hands into hammers.',
  'Combat Belt':         'Wide webbing with MOLLE loops. Carries what the pants can\'t.',
  'Ammo Belt':           'Bandolier loops for spare mags.',
  'Utility Belt':        'Layered webbing, general-purpose. Somehow always has one more pocket.',
  'Combat Pants':        'Ripstop with padded knees. Runs with you, falls with you.',
  'Runner Pants':        'Light, fast, a little too loud.',
  'Quilted Pants':       'Insulated and padded. Takes the edge off a boot.',
  'Knee Pads':           'Strapped foam. The kind that saves a meniscus.',
  'Reinforced Knees':    'Hard-shell knee plates with gel lining.',
  'Light Boots':         'Soft-sole tread. Turns a sprint into a sneak.',
  'Heavy Boots':         'Steel toe, ankle lock. Loud but durable.',
  'Silent Treads':       'Experimental sole compound that absorbs footfalls.',
  'Zephyr Boots':        'Running shoes with a classified compound. Faster than anything should be.',
  'Small Pack':          'Just enough to carry lunch and a spare mag.',
  'Combat Pack':         'MOLLE everything. Keeps the back straight.',
  'Large Rucksack':      'Expedition-grade haul bag. Barely fits through doorways.',
  'Focus Lens':          'Stabilized reticle monocle. Makes far targets feel close.',
  'Vampiric Mask':       'Chipped enamel and old blood. It remembers everything it touches.',

  // Consumables
  'Bandage':   'Clean gauze wrap. Stops a bleed; heals little.',
  'Painkillers':'Over-the-counter. Takes the sting, not the wound.',
  'Splint':    'Aluminum brace with cloth straps. Realigns a cracked bone.',
  'Medkit':    'Field kit — gauze, clotting agent, suture thread. The reliable fix.',
  'Trauma Kit':'Chest-seal, saline, morphine. Field surgery in a bag.',
  'Adrenaline Shot':'Auto-injector. Heart rate doubles; caution evaporates.',
  'Combat Stim':'Military-grade cocktail. Makes every punch land harder.',
  'Energy Drink':'Sugar, caffeine, dubious vitamins. Runs you ragged later.',
  'IFAK':      'Individual First Aid Kit. The pouch every grunt wears and every grunt forgets.',
  'Defibrillator': 'Two paddles, one shock, no apologies. For when bandages run out of arguments.',
  'Morphine Injector': 'Auto-injector pulled from a dead medic. Pain stops mattering for a while.',
  'Regen Injector': 'Black-market peptides in a hand-warm syringe. The healing keeps coming long after the needle.',

  // Throwables
  'Frag Grenade': 'M67-pattern fragmentation. Pull, count to three, and donate it to the room.',
  'Molotov Cocktail': 'Fuel and oil in a bottle, rag for a wick. Crude. Effective. Loud about it.',
  'Flashbang': 'M84 stun device. One bang, one flash, one room of blind men.',
  'Stun Grenade': 'Russian-pattern dazer. Less light, more concussion — the room forgets you for a beat.',

  // Mythic
  'Dragonbreath':      'Pump shotgun loaded with incendiary slug shells. Each shot leaves a lane of fire and apologies.',

  // Gear — face / head / ears / hands / belts / pants / boots
  'Combat Helmet':       'Military-issue half-shell, scuffed paint, replaceable padding. Standard issue, standard luck.',
  'Tactical Helmet NVG': 'Combat helmet with a forward-mounted NVG bracket. Heavier than it looks, lighter than nothing.',
  'NVG Rig':             'Quad-tube night vision strapped to a forehead mount. Green-and-white world, blind spots in colour.',
  'Tactical Shades':     'Polarised ballistic eyewear. Cuts a flashbang to a mild headache.',
  'Earmuffs':            'Bulk passive earpro. Less situational awareness, less ringing.',
  "Captain's Hat":       'Embroidered peaked cap. Costs nothing, says everything. The grunts hand over their tips.',
  'Reinforced Pants':    'Plate inserts behind the thighs. Heavier walk, fewer femoral artery problems.',

  // Belt / chest gear (rigs)
  'Quickdraw Rig':       'Holster harness with a forward release. Reload faster than the room reacts.',
  'Mag Pouch':           'Triple-mag MOLLE pouch. Small, loud, full.',
  'Grenade Pouch':       'Two velcro slots, one stays full. The other one is the answer.',

  // Junk — sells for credits, occasionally part of an artifact recipe
  'Scrap Metal':         'Twisted rebar and rusted steel. The merchant takes it all.',
  'Copper Scrap':        'Stripped wire and pipe ends. Sells slow, sells steady.',
  'Brass Lighter':       'Zippo-style with somebody\'s initials engraved. Still sparks.',
  'Silver Coin':         'Old commemorative round. Probably not worth the silver content. Probably.',
  'Silver Cigarette Case': 'Engraved hinged case, mostly empty. Smells faintly of someone else\'s lungs.',
  'Gold Watch':          'Stopped at 2:47. Doesn\'t matter — the band is the part the merchant wants.',
  'Diamond Ring':        'Solitaire setting, simple band. Whatever promise it carried isn\'t yours to keep.',
  'Jeweled Monocle':     'Antique brass eyepiece, tiny gem inlay. Useless. Beautiful. Sells.',
  'Antique Vase':        'Hairline crack along the rim, painted river scene. Older than the war.',
  'Duck Statue':         'Painted ceramic mallard. Heavier than it looks. Has a story it isn\'t telling.',
  'Emerald Skull':       'Polished obsidian carved into a grin and inlaid with green stone. Black-market collectors line up.',
  'Dog Tags':            'Stamped name and serial. The next of kin already got the letter.',
  'Encrypted Drive':     'Sealed thumb drive, military stamp. Worth more than its data — somebody pays for the silence.',
  'Classified Document': 'Sealed envelope, redaction tape across the flap. Still warm.',
  'Field Radio':         'Handset and battery pack. Heavy, scratched, wired to a frequency nobody monitors anymore.',
  'Car Battery':         '12-volt lead-acid. Surprisingly hard to ignore in a backpack.',

  // Toys — feed Jessica's Rage at the Great Bear
  'Beary Doll':          'Stitched plush bear, one button eye. Found in a duffel bag the courier never came back for.',
  'Joke Bear':           'Wind-up novelty bear, cracked grin. The mechanism still cycles, but the laughter\'s gone wrong somewhere.',
  'Sleep Duck':          'Felt-and-bean sleep companion. Smells like a child\'s room. Doesn\'t belong in this one.',
  'Defibrillator Toy':   'Toy paddles, plastic shock. Children\'s playset, except for the blood under the handles.',

  // Attachments — small, telegraphic, focus on what they FEEL like
  'Suppressor':       'Threaded baffle stack. Drops the report to a hiss; bullets still bite.',
  'Compensator':      'Slotted muzzle brake. Pushes the muzzle climb back where it belongs.',
  'Long Barrel':      'Free-float extension. Faster bullets, longer reach, slower handling.',
  'Short Barrel':     'Cut-down rebarrel. Faster swings, looser groups.',
  'Red Dot':          'Unmagnified parallax-free reticle. Both eyes open.',
  'Reflex Sight':     'Wide-window holographic with a circle-and-dot. Fast on the move.',
  'Holographic':      'Battery-powered holosight. Crisp at any zoom — when the battery holds.',
  'Mid Scope':        'Variable 1-6×. The compromise optic — close enough for room work, long enough for hallways.',
  'Red Laser':        'Visible laser module. Dot on target, no excuses.',
  'Green Laser':      'High-visibility green dot, daylight-readable. Brighter at the cost of battery life.',
  'Blue Laser':       'Tactical blue beam. Subtle in daylight, vivid in shadow.',
  'Laser Module':     'Generic IR/visible combo. Cheap, common, works.',
  'Tactical Light':   'Weapon-mounted 600-lumen torch. White-out for whoever\'s in the cone.',
  'Strobe Light':     'Pulsing high-intensity bulb. Makes the room into a stop-motion you don\'t want to be in.',
  'Flashlight':       'Plain weapon light. Throws a clean cone. Doesn\'t do much else.',
  'Vertical Foregrip': 'Polymer broomstick under the rail. Recoil control for the price of a mounting screw.',
  'Bipod':            'Spring-loaded folding bipod. Worth its weight when you stop moving.',
  'Heavy Stock':      'Hydraulic-buffered replacement stock. Soaks up recoil at the cost of a slower swing.',
  'Match Grip':       'Stippled rubber wrap. Wet hands stop being a problem.',
  'Match Trigger':    'Polished competition trigger. Lighter pull, faster reset, no creep.',
  'Extended Mag':     'Welded base plate adds rounds. Loads slower, runs longer.',
  'Drum Magazine':    'Twin-stack rotary mag. Ugly silhouette, generous capacity.',
};

const RARITY_COLORS = {
  common:    '#b9b9b9',
  uncommon:  '#6abe5a',
  rare:      '#6aaedc',
  epic:      '#c97a5a',
  legendary: '#e6b94a',
};

// Stat key → render config for the apply()-driven effect surfacer below.
// Each entry says how to label a base-stats key, the math used to
// convert the raw delta into a player-facing number, the suffix unit,
// and which direction reads as a "good" change for the diff colouring
// in the comparison panel ('+' = higher is better, '-' = lower is
// better). When a key isn't listed we skip it rather than printing
// `magicMult: 1.234567` — the goal is readability.
const APPLY_STAT_LABELS = {
  // Movement / survival
  moveSpeedMult:        { label: 'Move Speed',         kind: 'mult', dir: '+' },
  staminaRegenMult:     { label: 'Stamina Regen',      kind: 'mult', dir: '+' },
  maxStaminaBonus:      { label: 'Max Stamina',        kind: 'add',  dir: '+' },
  maxHealthBonus:       { label: 'Max HP',             kind: 'add',  dir: '+' },
  healthRegenMult:      { label: 'Health Regen',       kind: 'mult', dir: '+' },
  healthRegenDelayBonus:{ label: 'Regen Delay',        kind: 'addS', dir: '-' },
  dmgReduction:         { label: 'Damage Reduction',   kind: 'pct',  dir: '+' },
  highHpReduction:      { label: 'Full-HP Reduction',  kind: 'pct',  dir: '+' },
  cornerReduction:      { label: 'Low-HP Reduction',   kind: 'pct',  dir: '+' },
  fireResist:           { label: 'Fire Resist',        kind: 'pct',  dir: '+' },
  ballisticResist:      { label: 'Ballistic Resist',   kind: 'pct',  dir: '+' },
  flashResist:          { label: 'Flash Resist',       kind: 'pct',  dir: '+' },
  // Combat
  rangedDmgMult:        { label: 'Ranged Damage',      kind: 'mult', dir: '+' },
  meleeDmgMult:         { label: 'Melee Damage',       kind: 'mult', dir: '+' },
  knockbackMult:        { label: 'Knockback',          kind: 'mult', dir: '+' },
  critChance:           { label: 'Crit Chance',        kind: 'pct',  dir: '+' },
  fireRateMult:         { label: 'Fire Rate',          kind: 'mult', dir: '+' },
  reloadSpeedMult:      { label: 'Reload Speed',       kind: 'mult', dir: '+' },
  magSizeMult:          { label: 'Magazine',           kind: 'mult', dir: '+' },
  rangeMult:            { label: 'Range',              kind: 'mult', dir: '+' },
  rangedSpreadMult:     { label: 'Spread',             kind: 'mult', dir: '-' },
  hipSpreadOnlyMult:    { label: 'Hip Spread',         kind: 'mult', dir: '-' },
  adsSpreadOnlyMult:    { label: 'ADS Spread',         kind: 'mult', dir: '-' },
  // Stealth / sense
  stealthMult:          { label: 'Detection',          kind: 'mult', dir: '-' },
  hearingRange:         { label: 'Sense Range',        kind: 'addM', dir: '+' },
  hearingAlpha:         { label: 'Ghost Visibility',   kind: 'addF', dir: '+' },
  crouchDmgMult:        { label: 'Crouched Damage',    kind: 'mult', dir: '+' },
  crouchMoveBonus:      { label: 'Crouched Speed',     kind: 'mult', dir: '+' },
  // Throwables
  throwableChargeBonus: { label: 'Throwable Charges',  kind: 'add',  dir: '+' },
  throwableCooldownMult:{ label: 'Throwable Cooldown', kind: 'mult', dir: '-' },
  // Economy
  creditDropMult:       { label: 'Credit Drops',       kind: 'mult', dir: '+' },
  shopPriceMult:        { label: 'Shop Prices',        kind: 'mult', dir: '-' },
  pocketsBonus:         { label: 'Pockets',            kind: 'add',  dir: '+' },
};

// Run the item's apply() on a sentinel BASE_STATS object and surface
// every meaningful diff. Without this, gear that grants its effects
// through apply() (most belts, gloves, boots, and the entire ears
// slot) showed nothing in the structured Stats section — players had
// to read the description to learn what the item did. This bridges
// that gap so the description can stop carrying numbers.
function applyDrivenStats(item) {
  if (!item || typeof item.apply !== 'function') return [];
  const before = BASE_STATS();
  const after = BASE_STATS();
  try { item.apply(after); } catch (_) { return []; }
  const rows = [];
  for (const [key, cfg] of Object.entries(APPLY_STAT_LABELS)) {
    const a = after[key], b = before[key];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (Math.abs(a - b) < 1e-6) continue;
    let val, suffix;
    switch (cfg.kind) {
      case 'mult': val = Math.round((a / b - 1) * 100); suffix = '%'; break;
      case 'pct':  val = Math.round((a - b) * 100);     suffix = '%'; break;
      case 'add':  val = Math.round(a - b);             suffix = '';  break;
      case 'addM': val = Math.round(a - b);             suffix = 'm'; break;
      case 'addS': val = Math.round(a - b);             suffix = 's'; break;
      case 'addF': val = Math.round(a - b);             suffix = '';  break;
      default: continue;
    }
    rows.push([cfg.label, +val, cfg.dir, suffix]);
  }
  return rows;
}

// Readable list of (key,value) stat rows. `item` is any inventory entry.
// Translate an attachment def's `modifier` bag + ancillary fields
// (sightZoom, lightCone, blindDuration, laserRange, etc.) into compact
// stat rows. Rendered both in the details panel and in the customize-
// weapon slot summary so there's a single source of truth for "what
// does this attachment do" — descriptions stay as prose flavour, the
// numbers come from the actual modifier object.
//
// Multiplier convention:
//   spread / reload / zoom / noise → less is better, displayed as
//     "−X% Spread"
//   move / damage / range / mag / fireRate → more is better, "+X% Damage"
//   adsZoomMult is 0..1 representing zoom-in (smaller fov), so we flip
//     the sign in display so the player reads "more zoom" as positive.
const _ATTACH_MOD_LABELS = {
  hipSpreadMult:  { label: 'Hip Spread',    invert: true  },
  adsSpreadMult:  { label: 'ADS Spread',    invert: true  },
  moveSpeedMult:  { label: 'Move Speed',    invert: false },
  reloadTimeMult: { label: 'Reload Time',   invert: true  },
  magSizeMult:    { label: 'Mag Size',      invert: false },
  fireRateMult:   { label: 'Fire Rate',     invert: false },
  damageMult:     { label: 'Damage',        invert: false },
  rangeMult:      { label: 'Range',         invert: false },
  noiseRangeMult: { label: 'Noise Range',   invert: true  },
  // ADS zoom mult is a divisor on FOV — smaller value = bigger zoom.
  // Flip the displayed sign so the row reads as a player-facing buff.
  adsZoomMult:    { label: 'ADS Zoom',      invert: true  },
};
export function attachmentStatRows(item) {
  const rows = [];
  if (!item || item.type !== 'attachment') return rows;
  const mod = item.modifier || {};
  for (const [key, def] of Object.entries(_ATTACH_MOD_LABELS)) {
    const v = mod[key];
    if (typeof v !== 'number' || v === 1) continue;
    // Display raw % delta of the multiplier. Negative deltas read
    // as "−15% Spread" (buff for spread / reload / noise — players
    // intuitively know less is better) and positive as "+10% Damage".
    let raw = Math.round((v - 1) * 100);
    let label = def.label;
    // ADS Zoom is a foot-gun: smaller adsZoomMult = TIGHTER FOV =
    // MORE zoom. So 0.65× = +35% zoom power, not −35% zoom. Flip
    // the displayed sign and rename so the row reads as a buff.
    if (key === 'adsZoomMult') {
      raw = -raw;
      label = 'Zoom Power';
    }
    if (raw === 0) continue;
    const sign = raw > 0 ? '+' : '−';
    rows.push([label, `${sign}${Math.abs(raw)}`, '+', '%']);
  }
  // Sights — adsPeekBonus is extra metres of cursor lead while ADSed.
  // Renamed from 'Drag' so the player can map it to the on-screen
  // peek behaviour without needing the engine vocabulary.
  if (typeof mod.adsPeekBonus === 'number' && mod.adsPeekBonus !== 0) {
    rows.push(['ADS Peek', `+${mod.adsPeekBonus}`, '+', 'm']);
  }
  // Sight zoom — the sightZoom field on the def, not modifier. >1 = zoom in.
  if (typeof item.sightZoom === 'number' && item.sightZoom !== 1) {
    rows.push(['Sight Zoom', `${item.sightZoom.toFixed(2)}×`, '+']);
  }
  // Lasers — kind:'laser' carries laserRange (metres of beam).
  if (item.kind === 'laser' && typeof item.laserRange === 'number') {
    rows.push(['Laser Range', `${item.laserRange}`, '+', 'm']);
  }
  // Lights — lightCone.{range, angleDeg} for the visible cone.
  // Width row added so flood-vs-spot lights read distinct (a 50°
  // OLIGHT cone vs a 35° tactical beam differ at a glance).
  if (item.lightCone) {
    if (typeof item.lightCone.range === 'number') {
      rows.push(['Light Range', `${item.lightCone.range}`, '+', 'm']);
    }
    if (typeof item.lightCone.angleDeg === 'number') {
      rows.push(['Cone Width', `${item.lightCone.angleDeg}`, '+', '°']);
    }
  }
  // Blind / dazzle windows (tactical lights / strobes).
  if (typeof item.blindDuration === 'number') {
    rows.push(['Blind', `${item.blindDuration}`, '+', 's']);
  }
  if (typeof item.blindSpreadMul === 'number') {
    rows.push(['Blind Spread×', `${item.blindSpreadMul}`, '+', '×']);
  }
  if (typeof item.dazzleDuration === 'number') {
    rows.push(['Dazzle', `${item.dazzleDuration}`, '+', 's']);
  }
  if (typeof item.dazzleSpreadMul === 'number') {
    rows.push(['Dazzle Spread×', `${item.dazzleSpreadMul}`, '+', '×']);
  }
  return rows;
}

function collectStats(item) {
  const rows = [];
  if (!item) return rows;
  if (item.type === 'attachment') {
    return attachmentStatRows(item);
  }
  if (item.type === 'ranged') {
    rows.push(['Damage', item.damage, '+']);
    rows.push(['Fire Rate', item.fireRate, '+', '/s']);
    rows.push(['Range', item.range, '+']);
    rows.push(['Magazine', item.magSize, '+']);
    rows.push(['Reload', item.reloadTime, '-', 's']);
    if (typeof item.pelletCount === 'number') rows.push(['Pellets', item.pelletCount, '+']);
    if (item.hipSpread != null) rows.push(['Hip Spread', item.hipSpread, '-']);
    if (item.adsSpread != null) rows.push(['ADS Spread', item.adsSpread, '-']);
  } else if (item.type === 'melee') {
    // Pull representative combo step for a summary.
    const step = item.combo?.[0]?.close || item.combo?.[0]?.far;
    if (step) {
      rows.push(['Damage', step.damage, '+']);
      rows.push(['Range', step.range, '+']);
      rows.push(['Knockback', step.knockback, '+']);
    }
  } else if (item.type === 'armor' || item.type === 'gear' || item.slot === 'backpack') {
    if (typeof item.reduction === 'number') rows.push(['Damage Reduction', Math.round(item.reduction * 100), '+', '%']);
    if (typeof item.pockets === 'number') rows.push(['Pockets', item.pockets, '+']);
    if (typeof item.speedMult === 'number') rows.push(['Move Speed', Math.round((item.speedMult - 1) * 100), '+', '%']);
    if (typeof item.stealthMult === 'number') rows.push(['Detection', Math.round((1 - item.stealthMult) * 100), '-', '%']);
  } else if (item.type === 'consumable') {
    const e = item.useEffect;
    if (e?.kind === 'heal') rows.push(['Heal', e.amount, '+', ' HP']);
    if (e?.cures?.length) rows.push(['Cures', e.cures.join(', '), '']);
  } else if (item.type === 'junk') {
    if (typeof item.sellValue === 'number') rows.push(['Sell Value', item.sellValue, '+', 'c']);
  }
  // Add any stats granted via apply() that weren't already covered by
  // the structured fields above. Dedupe by label so a belt that has
  // both `pockets: 1` and `apply(s) { s.pocketsBonus++ }` doesn't show
  // Pockets twice.
  const seen = new Set(rows.map(r => r[0]));
  for (const row of applyDrivenStats(item)) {
    if (!seen.has(row[0])) { rows.push(row); seen.add(row[0]); }
  }
  return rows;
}

function diffStats(item, equipped) {
  if (!equipped) return new Map();
  const diffs = new Map();
  const a = collectStats(item);
  const b = collectStats(equipped);
  const bMap = Object.fromEntries(b.map(r => [r[0], r[1]]));
  for (const [key, val] of a) {
    if (typeof val !== 'number' || typeof bMap[key] !== 'number') continue;
    diffs.set(key, Math.round(val - bMap[key]));
  }
  return diffs;
}

function compareEquipped(item, inventory) {
  if (!inventory || !item) return null;
  // Weapon: compare against the current weapon of the same class if any.
  if (item.type === 'ranged' || item.type === 'melee') {
    const slot = item.type === 'melee' ? 'melee' : (inventory.equipment.weapon1 ? 'weapon1' : 'weapon2');
    return inventory.equipment[slot] || null;
  }
  if (item.slot) return inventory.equipment[item.slot] || null;
  return null;
}

export class DetailsUI {
  constructor({ inventory }) {
    this.inventory = inventory;
    this.root = document.createElement('div');
    this.root.id = 'details-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="details-card"></div>
    `;
    document.body.appendChild(this.root);
    this.cardEl = this.root.querySelector('#details-card');
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.hide();
    });
    this.root.addEventListener('contextmenu', (e) => {
      // Right-click anywhere in the overlay dismisses, so players can
      // close the panel with the same button they used to open it.
      e.preventDefault();
      this.hide();
    });
    // J / K hotkeys while the details panel is open — toggles the
    // mark-as-junk / mark-to-keep flags on the inspected item without
    // having to click the action-bar button.
    this._onKeyDown = (e) => {
      if (this.root.style.display === 'none') return;
      if (!this._item) return;
      const it = this._item;
      if (it.type === 'relic' || !this._isOwnedItem(it)) return;
      if (e.key === 'j' || e.key === 'J') {
        it.markedJunk = !it.markedJunk;
        if (it.markedJunk) it.markedKeep = false;
        this.inventory?._bump?.();
        this.show(it);
        window.__rerenderInventory?.();
        e.preventDefault();
      } else if (e.key === 'k' || e.key === 'K') {
        it.markedKeep = !it.markedKeep;
        if (it.markedKeep) it.markedJunk = false;
        this.inventory?._bump?.();
        this.show(it);
        window.__rerenderInventory?.();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  hide() {
    this.root.style.display = 'none';
    this._item = null;
    this._teardownPreview();
  }

  show(item) {
    if (!item) return;
    this._teardownPreview();
    this._item = item;
    const equipped = compareEquipped(item, this.inventory);
    this.cardEl.innerHTML = this._render(item, equipped);
    this.root.style.display = 'flex';
    const previewHost = this.cardEl.querySelector('.details-preview');
    if (previewHost) this._setupPreview(previewHost, item);
    this._wireMarkButtons(item);
  }

  // Mark-as-Junk / Mark-to-Keep — toggle one of two boolean flags on
  // the item itself. Sell All Junk + drop/sell guards read these flags
  // directly. Setting one clears the other so they read as opposites.
  _wireMarkButtons(item) {
    const junkBtn = this.cardEl.querySelector('[data-mark="junk"]');
    const keepBtn = this.cardEl.querySelector('[data-mark="keep"]');
    if (junkBtn) junkBtn.addEventListener('click', () => {
      item.markedJunk = !item.markedJunk;
      if (item.markedJunk) item.markedKeep = false;
      this.inventory?._bump?.();
      this.show(item);
      window.__rerenderInventory?.();
    });
    if (keepBtn) keepBtn.addEventListener('click', () => {
      item.markedKeep = !item.markedKeep;
      if (item.markedKeep) item.markedJunk = false;
      this.inventory?._bump?.();
      this.show(item);
      window.__rerenderInventory?.();
    });
  }

  // Rotating 3D preview of the item's model, if one is registered. Creates
  // a dedicated mini renderer per panel open; teardown on hide/replace.
  _setupPreview(host, item) {
    const url = modelForItem(item);
    // No FBX model — fall back to a static large version of the
    // inventory thumbnail (the procedural pants/chest/glove/junk
    // builders, or the side-view weapon PNG). Better than a blank
    // gap for armor / gear / junk items that don't carry a model.
    if (!url) {
      const thumb = thumbnailFor(item);
      if (thumb) {
        host.innerHTML = `<img src="${thumb}" alt=""
          style="display:block; width:100%; height:100%; object-fit:contain;
                 image-rendering:pixelated;">`;
        return;
      }
      host.remove();
      return;
    }

    const width  = host.clientWidth  || 380;
    const height = host.clientHeight || 160;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 5, 2); scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fbaff, 0.35); fill.position.set(-3, 2, -1); scene.add(fill);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(2.4, 1.6, 2.4);
    camera.lookAt(0, 0, 0);

    const state = { renderer, scene, camera, rafId: 0, disposed: false, obj: null };
    this._preview = state;

    loadModelClone(url).then(obj => {
      if (state.disposed || !obj) return;
      fitToRadius(obj, 1.0);
      addOutlines(obj);
      // No emissive tint — was washing weapon previews with the
      // tracerColor (orange on Benelli, etc.) instead of letting the
      // model's own materials show through. Same look as the
      // inventory side-view render now.
      // Without rotation the FBX often points along whatever axis it
      // was authored on — for animpic shotguns / rifles that's roughly
      // the camera's forward axis, so the preview shows just the
      // muzzle end-on as a thin diagonal stick. Apply the same default
      // rotation used in-hand so the preview reads as a side profile.
      const rotOverride = rotationOverrideForModelPath(url);
      if (rotOverride) {
        obj.rotation.set(rotOverride.x || 0, rotOverride.y || 0, rotOverride.z || 0);
      } else if (item.modelRotation) {
        obj.rotation.set(item.modelRotation.x || 0, item.modelRotation.y || 0, item.modelRotation.z || 0);
      } else {
        obj.rotation.set(0, Math.PI / 2, 0);
      }
      scene.add(obj);
      state.obj = obj;
    });

    let last = performance.now();
    const tick = (now) => {
      if (state.disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (state.obj) state.obj.rotation.y += dt * 0.7;
      renderer.render(scene, camera);
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  _teardownPreview() {
    const s = this._preview; if (!s) return;
    s.disposed = true;
    cancelAnimationFrame(s.rafId);
    // Active context release. dispose() alone leaves the GL context
    // alive in the browser's context cap until GC; forceContextLoss
    // tells the GL layer to drop the slot immediately, so rapid
    // open-close-open-close inspect loops over a long session don't
    // pile dead contexts up to the cap.
    try { s.renderer.forceContextLoss(); } catch (_) {}
    s.renderer.dispose();
    s.renderer.domElement.remove();
    this._preview = null;
  }

  _render(item, equipped) {
    // When the inspected item has a currently-equipped counterpart in
    // the same slot/role, render two panes side-by-side: the left
    // shows what's already worn (with a CURRENTLY EQUIPPED badge so
    // the player understands which is which); the right is the new
    // item with stat diffs in green/red and an explicit "Stats you'll
    // lose" callout for any stat the equipped item carries that this
    // one doesn't.
    const showCompare = !!equipped && equipped !== item;
    const markBar = this._renderMarkBar(item);
    if (!showCompare) {
      return `
        <div class="details-pane details-pane-solo">
          ${this._renderPane(item, { compareTo: null, isEquipped: false })}
        </div>
        ${markBar}
        <div class="details-footer">Right-click or click outside to close</div>
      `;
    }
    return `
      <div class="details-compare">
        <div class="details-pane details-pane-equipped">
          <div class="details-equipped-badge">CURRENTLY EQUIPPED</div>
          ${this._renderPane(equipped, { compareTo: null, isEquipped: true })}
        </div>
        <div class="details-pane details-pane-new">
          <div class="details-new-badge">REPLACING WITH</div>
          ${this._renderPane(item, { compareTo: equipped, isEquipped: false })}
        </div>
      </div>
      ${markBar}
      <div class="details-footer">Right-click or click outside to close</div>
    `;
  }

  // Action bar at the bottom of the details panel — two toggleable
  // buttons that stamp markedJunk / markedKeep on the item. Hidden for
  // items that aren't usefully markable (artifact-scrolls auto-consume,
  // shop-side items don't belong to the player).
  _renderMarkBar(item) {
    if (!item || item.type === 'relic') return '';
    // Skip if the item isn't actually in the player's inventory (so
    // shop browsing doesn't show controls that wouldn't apply). Treat
    // anything reachable via the inventory's owned-items flat view as
    // ours; otherwise fall through to no bar.
    const owned = this._isOwnedItem(item);
    if (!owned) return '';
    const junkActive = item.markedJunk ? ' active' : '';
    const keepActive = item.markedKeep ? ' active' : '';
    return `
      <div class="details-mark-bar">
        <button type="button" class="details-mark-btn mark-junk${junkActive}" data-mark="junk">
          ${item.markedJunk ? '✓ Marked as Junk (J)' : 'Mark as Junk (J)'}
        </button>
        <button type="button" class="details-mark-btn mark-keep${keepActive}" data-mark="keep">
          ${item.markedKeep ? '✓ Marked to Keep (K)' : 'Mark to Keep (K)'}
        </button>
      </div>
    `;
  }

  _isOwnedItem(item) {
    if (!this.inventory || !item) return false;
    if (this.inventory.backpack && this.inventory.backpack.includes(item)) return true;
    const eq = this.inventory.equipment || {};
    for (const k in eq) if (eq[k] === item) return true;
    return false;
  }

  // Render a single item pane. `compareTo` enables stat diffs against
  // the comparison item plus a "Stats you'll lose" section for any
  // stat the comparison has that this item doesn't.
  _renderPane(item, { compareTo, isEquipped }) {
    const rarity = inferRarity(item);
    const rColor = RARITY_COLORS[rarity] || '#b9b9b9';
    const icon = thumbnailFor(item);
    // Lore is purely flavor — only ever the curated ITEM_LORE entry.
    // The raw item.description field on most gear is a stat summary
    // (e.g. "−18% dmg, +5% stam regen") and now renders structurally
    // through collectStats, so showing it here too would duplicate
    // the same numbers the player already sees in the Stats section.
    // Artifacts (relics) carry their own lore + a stat-shaped description
    // on the item itself. The ITEM_LORE map is keyed by gear name and
    // doesn't have artifact entries, and the numeric-suppression
    // heuristic was wiping the only thing that explained what the
    // relic actually does. Special-case both lookups so a left-click on
    // a relic in the shop shows "what does this give me".
    const isArtifact = item.type === 'relic';
    const lore = isArtifact
      ? (item.lore || '')
      : (ITEM_LORE[item.name] || '');
    const descRaw = (item.description || '').trim();
    let noteText = '';
    if (isArtifact) {
      noteText = descRaw;
    } else {
      // Description is suppressed when it looks stat-like (any %, ×, or
      // signed-number token). Non-stat descriptions still render below
      // the stats section as plain notes — useful for items like backpacks
      // where the description is "5 pack slots" and that's already
      // covered, vs. consumables with prose-only flavour.
      const hasNumeric = /[+\-−]?\d/.test(descRaw) || /%/.test(descRaw);
      noteText = (descRaw && !hasNumeric && descRaw !== lore) ? descRaw : '';
    }
    const rows = collectStats(item);
    const diffs = diffStats(item, compareTo);
    // Cell background = rarity color, not item.tint.
    const tintStr = rarityColor(item);
    const slotLabel = item.slot ? (SLOT_LABEL[item.slot] || item.slot) : (item.type || '');

    const statRows = rows.map(([key, val, dir, suffix]) => {
      const unit = suffix || '';
      const d = diffs.get(key);
      let diffStr = '';
      if (typeof d === 'number' && Math.abs(d) > 0.005) {
        const good = (dir === '+' ? d > 0 : d < 0);
        const sign = d > 0 ? '+' : '';
        diffStr = `<span class="details-diff ${good ? 'good' : 'bad'}">(${sign}${d}${unit})</span>`;
      }
      return `<div class="details-stat-row"><span class="k">${key}</span><span class="v">${val}${unit}</span>${diffStr}</div>`;
    }).join('');

    // Stats only the equipped item carries — these would be lost on
    // the swap and need to be surfaced explicitly. Without this, a
    // helmet with +5 Move Speed silently downgrades to a plain helmet
    // and the player only finds out by feel.
    let lossRows = '';
    if (compareTo) {
      const myKeys = new Set(rows.map(r => r[0]));
      const otherRows = collectStats(compareTo);
      const losses = otherRows.filter(([key]) => !myKeys.has(key));
      if (losses.length) {
        lossRows = `
          <div class="details-section details-loss-section">
            <div class="details-section-title">Stats you'll lose</div>
            ${losses.map(([key, val, , suffix]) => {
              const unit = suffix || '';
              return `<div class="details-stat-row details-loss-row">
                <span class="k">${key}</span>
                <span class="v">−${val}${unit}</span>
              </div>`;
            }).join('')}
          </div>
        `;
      }
    }

    const affixes = (item.affixes || []).filter(a => a.kind !== 'setMark');
    const setAffix = (item.affixes || []).find(a => a.kind === 'setMark');
    const perks = item.perks || [];

    const affixBlock = affixes.length ? `
      <div class="details-section">
        <div class="details-section-title">Affixes</div>
        ${affixes.map(a => `<div class="details-affix">• ${a.label}</div>`).join('')}
      </div>
    ` : '';

    const perkBlock = perks.length ? `
      <div class="details-section">
        <div class="details-section-title">Perks</div>
        ${perks.map(p => `
          <div class="details-perk">
            <span class="details-perk-name">◆ ${p.name}</span>
            ${p.description ? `<span class="details-perk-desc"> — ${p.description}</span>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    let setBlock = '';
    if (setAffix && SET_DEFS[setAffix.setId]) {
      const def = SET_DEFS[setAffix.setId];
      const counts = countEquippedSetPieces(this.inventory.equipment);
      const have = counts[setAffix.setId] || 0;
      const tierRows = def.tiers.map(t => {
        const met = have >= t.pieces;
        return `<div class="details-set-tier ${met ? 'met' : 'missing'}">
          <span class="details-set-mark">${met ? '✓' : '✗'}</span>
          <span class="details-set-count">${t.pieces}pc</span>
          <span class="details-set-desc">${t.desc.replace(/^\d+pc:\s*/, '')}</span>
        </div>`;
      }).join('');
      setBlock = `
        <div class="details-section">
          <div class="details-section-title">${def.name} Set <span class="details-set-progress">${have} / ${def.tiers[def.tiers.length - 1].pieces} equipped</span></div>
          ${tierRows}
        </div>
      `;
    }

    const dur = item.durability;
    const durBlock = dur ? `
      <div class="details-durability">
        Durability <b>${Math.round(dur.current)}</b> / ${dur.max}
        <div class="details-dur-bar"><div style="width:${Math.max(0, (dur.current / dur.max) * 100).toFixed(0)}%"></div></div>
      </div>
    ` : '';

    // The non-equipped pane gets a preview block. If an FBX model is
    // registered for the item, it renders live and rotating. If not
    // (armor, gear, junk-with-no-FBX), it renders a larger version
    // of the inventory thumbnail so the player still sees a clear
    // preview instead of a blank gap. Weapons with side-view PNG
    // renders just show the PNG.
    const hasModel = !isEquipped && (
      !!modelForItem(item) ||
      item.type === 'ranged' || item.type === 'melee' ||
      item.type === 'armor' || item.type === 'gear' ||
      item.type === 'junk' || item.type === 'consumable' ||
      item.type === 'throwable' || item.type === 'attachment'
    );
    return `
      <div class="details-header" style="border-left: 4px solid ${rColor}">
        <div class="details-swatch" style="background:${tintStr}">
          ${icon ? `<img src="${icon}" alt="" style="${weaponImageMirrorStyle(item)}">` : ''}
        </div>
        <div class="details-title-col">
          <div class="details-name" style="color:${rColor}">${item.name}</div>
          <div class="details-subtitle">
            <span class="details-rarity">${rarity}</span>
            <span class="details-slot">${slotLabel}</span>
            ${item.class ? `<span class="details-class">${item.class}</span>` : ''}
          </div>
        </div>
      </div>
      ${hasModel ? `<div class="details-preview"></div>` : ''}
      ${lore ? `<div class="details-lore">"${lore}"</div>` : ''}
      ${rows.length ? `<div class="details-section">
        <div class="details-section-title">Stats</div>
        ${statRows}
      </div>` : ''}
      ${noteText ? `<div class="details-notes">${noteText}</div>` : ''}
      ${lossRows}
      ${affixBlock}
      ${perkBlock}
      ${setBlock}
      ${durBlock}
    `;
  }
}
