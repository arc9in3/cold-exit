// ============================================================
// recruiter.js — agent + special-merc generation for the agency
// ============================================================
//
// Generates the daily roster shown at the recruiter NPC. Three slots:
//   slot 1 — always low tier  (cheap, low stats — first-floor fodder)
//   slot 2 — always mid tier  (balanced, common hire)
//   slot 3 — RNG: 10% mid / 70% mid+ / 18% high / 2% special merc
//
// Agents are anonymous procgen — codename, class, stats, quirk.
// Special mercs are HAND-AUTHORED with a signature weapon and unlock
// goals. Each special merc carries a unique weapon that doesn't exist
// in the agency armory until unlocked.
//
// State lives on agencyState (consumer wires this up to save/load):
//   roster        — agents currently under contract
//   namedCast     — special mercs permanently rostered
//   mercProgress  — { mercId: { contracts: N, weaponKills: N, unlocked: bool, weaponUnlocked: bool } }
//   refreshT      — countdown to next free roster refresh

const CODENAMES = [
  'Cobalt', 'Reefer', 'Static', 'Halo', 'Drift', 'Cipher', 'Echo', 'Frost',
  'Vesper', 'Marrow', 'Kiln', 'Gristle', 'Rook', 'Pylon', 'Lattice', 'Tundra',
  'Smolder', 'Brick', 'Vector', 'Pith', 'Coyote', 'Wick', 'Fern', 'Glasswork',
  'Quill', 'Junker', 'Sable', 'Loam', 'Ribbon', 'Tinder', 'Wraith', 'Halftone',
];

const QUIRKS_FLAVOR = [
  'ex-medic, still flinches at blood',
  'never reloads — claims it\'s superstition',
  'hums during firefights',
  'won\'t eat in front of strangers',
  'sleeps with the lights on',
  'former corp security, fired for cause',
  'speaks four languages, none well',
  'has a kid in the city — won\'t talk about it',
  'left an arm somewhere in Floor 6',
  'doesn\'t like elevators',
  'owes the agency more than they\'ll admit',
  'whispers to their gun',
  'collects buttons',
  'won\'t look you in the eye',
  'thinks they saw something on Floor 9',
];

const CLASSES = ['assault', 'recon', 'breacher', 'medic', 'heavy'];

// Tier definitions — base ranges for stats + price.
const TIERS = {
  low:  { aim: [20, 45], mob: [25, 50], nrv: [30, 55], price: [80, 180],   contractMissions: 5  },
  mid:  { aim: [40, 65], mob: [40, 65], nrv: [45, 70], price: [200, 450],  contractMissions: 5  },
  midp: { aim: [55, 75], mob: [50, 75], nrv: [55, 80], price: [500, 900],  contractMissions: 10 },
  high: { aim: [70, 90], mob: [65, 90], nrv: [70, 95], price: [1100, 2200], contractMissions: 10 },
};

const REFRESH_COST = 50;            // chips to manually re-roll the roster
const FREE_REFRESH_INTERVAL_S = 1;  // free auto-refresh between contracts (consumer ticks this)

// ============================================================
// SPECIAL MERCS — hand-authored
// ============================================================
// Each merc has: id, codename, class, signature stats, quirk + bio,
// weapon they carry, merc-permanent unlock goal, weapon-unlock goal.
// Spawn as the 2% slot in the recruiter when conditions met.
//
// Hire price for special mercs is ~10x mid+ tier — they're a splurge.
// ============================================================
export const SPECIAL_MERCS = {
  pyre: {
    id: 'pyre', codename: 'The Pyre',
    class: 'heavy', tier: 'special',
    stats: { aim: 55, mob: 45, nrv: 85, hp: 120, armor: 60 },
    quirk: 'lights matches between contracts. doesn\'t blow them out.',
    bio: 'Burned a corporate compound off the books. Cleared in court, blacklisted everywhere. Now she works for chips.',
    weapon: { id: 'flamethrower', label: 'Flamethrower', flavor: 'home-built. No serial. Don\'t ask.' },
    ability: { name: 'Heat Sink', desc: 'Burn DoTs you apply tick 50% faster. Immune to fire damage.' },
    relic: { id: 'pyre_match', name: 'Lit Match', desc: 'On reload, the next 3 rounds are incendiary.' },
    startingItems: ['flamethrower', 'thr_molotov', 'med_burn_salve'],
    hirePrice: 6500,
    unlock: { contractsComplete: 5 },
    weaponUnlock: { stat: 'burnKills', target: 200 },
  },
  long_sleep: {
    id: 'long_sleep', codename: 'Long Sleep',
    class: 'recon', tier: 'special',
    stats: { aim: 95, mob: 55, nrv: 70, hp: 80, armor: 25 },
    quirk: 'blinks slowly. never first to speak.',
    bio: 'Three years off the grid in a winter town. Came back when the bills did. The intervention came back with her.',
    weapon: { id: 'intervention', label: 'Intervention', flavor: 'milspec sniper. Punches through cover.' },
    ability: { name: 'Hold Breath', desc: 'ADS time slows to 50% for 4s. Headshots within window are guaranteed crits.' },
    relic: { id: 'long_sleep_lens', name: 'Cold Lens', desc: 'First shot of every encounter has +200% damage and pierces walls.' },
    startingItems: ['intervention', 'thr_smoke', 'med_stim'],
    hirePrice: 7200,
    unlock: { longRangeKills: 30 },
    weaponUnlock: { stat: 'oneShotKills', target: 10 },
  },
  cardinal: {
    id: 'cardinal', codename: 'Cardinal',
    class: 'assault', tier: 'special',
    stats: { aim: 80, mob: 90, nrv: 60, hp: 60, armor: 0 },
    quirk: 'wears red. always red. no exceptions.',
    bio: 'Bouncer at a sin-strip nightclub turned solo operator. Trades HP for muzzle velocity. Half a clip in each hand.',
    weapon: { id: 'twin_pistols', label: 'Twin Sins', flavor: 'matched compensated pistols. Shoots both at once.' },
    ability: { name: 'Akimbo Mastery', desc: 'Always dual-wields. Hip fire spread halved. +30% movement while firing.' },
    relic: { id: 'cardinal_red', name: 'Red Memorabilia', desc: 'Below 50% HP, fire rate +40% and movement speed +20%.' },
    startingItems: ['m1911', 'm1911', 'med_painkillers'],
    hirePrice: 6800,
    unlock: { soloFloor10: 1 },
    weaponUnlock: { stat: 'hipFireKills', target: 100 },
  },
  black_box: {
    id: 'black_box', codename: 'Black Box',
    class: 'recon', tier: 'special',
    stats: { aim: 60, mob: 70, nrv: 90, hp: 90, armor: 30 },
    quirk: 'never carries a phone.',
    bio: 'Used to break encryption for a three-letter agency. Broke the wrong file. Now they break locks for chips.',
    weapon: { id: 'silenced_smg', label: 'Mute', flavor: 'integral suppressor, 3-round burst. Ghosts don\'t hear themselves die.' },
    ability: { name: 'Disable Comms', desc: 'Hack any door/turret/camera with E. Suppressed kills don\'t alert other enemies.' },
    relic: { id: 'black_box_drive', name: 'Encrypted Drive', desc: 'Stealth kills give 25 chips. Hacked terminals reveal floor map.' },
    startingItems: ['silenced_smg', 'thr_emp', 'tool_lockpick'],
    hirePrice: 5800,
    unlock: { hackContractsComplete: 1 },
    weaponUnlock: { stat: 'stealthKills', target: 50 },
  },
  slag: {
    id: 'slag', codename: 'Slag',
    class: 'heavy', tier: 'special',
    stats: { aim: 50, mob: 50, nrv: 80, hp: 110, armor: 50 },
    quirk: 'has scars where eyebrows used to be.',
    bio: 'Demolitions. Twenty years of it. Still has all his fingers, somehow.',
    weapon: { id: 'rocket_launcher', label: 'Anvil', flavor: 'shoulder-fired, no guidance. Aim center mass and pray for splash.' },
    ability: { name: 'Blast Resistance', desc: 'Take 70% less damage from explosions. Own explosions ignore self.' },
    relic: { id: 'slag_pin', name: 'Pulled Pin', desc: 'Throwables explode for +50% radius. Carry +2 of each thrown item.' },
    startingItems: ['rocket_launcher', 'thr_frag', 'thr_frag', 'thr_claymore'],
    hirePrice: 7500,
    unlock: { explosiveContractsComplete: 3 },
    weaponUnlock: { stat: 'explosionKills', target: 100 },
  },
  howitzer: {
    id: 'howitzer', codename: 'Howitzer',
    class: 'assault', tier: 'special',
    stats: { aim: 70, mob: 60, nrv: 75, hp: 100, armor: 40 },
    quirk: 'counts to three before every shot. out loud.',
    bio: 'Trained for siege warfare in a country that no longer exists. The grenade launcher came back with him.',
    weapon: { id: 'grenade_launcher', label: 'Echo Six', flavor: '6-round drum, fragmentation rounds. Bounces off walls.' },
    ability: { name: 'Bounce Trajectory', desc: 'Grenade-launcher rounds bounce 2x before detonating. Visible arc indicator.' },
    relic: { id: 'howitzer_drum', name: 'Spare Drum', desc: 'Grenade launcher reload time -50%. Capacity +3.' },
    startingItems: ['grenade_launcher', 'thr_flash', 'med_stim'],
    hirePrice: 6900,
    unlock: { roomLeveledFloor8: 1 },
    weaponUnlock: { stat: 'grenadeKills', target: 200 },
  },
  mule: {
    id: 'mule', codename: 'Mule',
    class: 'heavy', tier: 'special',
    stats: { aim: 60, mob: 30, nrv: 95, hp: 160, armor: 90 },
    quirk: 'has never been seen running.',
    bio: 'Stands behind the barrel. Keeps standing. The minigun spins, the room empties, the chips arrive.',
    weapon: { id: 'minigun', label: 'Mule\'s Mule', flavor: '6 barrels. 4000 RPM. spin-up cost is the whole game.' },
    ability: { name: 'Heavy Walk', desc: 'Cannot sprint. While firing the minigun, take 50% less damage.' },
    relic: { id: 'mule_belt', name: 'Ammo Belt', desc: 'Minigun magazine size +200%. Spin-up time -33%.' },
    startingItems: ['minigun', 'med_painkillers', 'med_painkillers', 'armor_plate'],
    hirePrice: 8500,
    unlock: { heat5Survived60s: 1 },
    weaponUnlock: { stat: 'minigunKills', target: 500 },
  },
  mortician: {
    id: 'mortician', codename: 'Mortician',
    class: 'breacher', tier: 'special',
    stats: { aim: 40, mob: 95, nrv: 70, hp: 75, armor: 15 },
    quirk: 'wears gloves indoors. never takes them off.',
    bio: 'Trained as an embalmer. Made a career change after a bad night. The blade came with the job.',
    weapon: { id: 'signature_blade', label: 'The Lesson', flavor: 'curved monomolecular blade. Cuts armor like fabric.' },
    ability: { name: 'Silent Step', desc: 'Crouch movement is fully silent. Backstabs are instant kills regardless of HP.' },
    relic: { id: 'mortician_gloves', name: 'Embalmer\'s Gloves', desc: 'Melee kills heal 8 HP. Bleed DoTs deal 200% damage.' },
    startingItems: ['signature_blade', 'thr_smoke', 'med_stim'],
    hirePrice: 5500,
    unlock: { executions: 20 },
    weaponUnlock: { stat: 'meleeKills', target: 100 },
  },
  bunker: {
    id: 'bunker', codename: 'Bunker',
    class: 'heavy', tier: 'special',
    stats: { aim: 75, mob: 35, nrv: 90, hp: 140, armor: 80 },
    quirk: 'sets up a folding chair before every fight.',
    bio: 'Held a position for eight hours during the corp wars. Eight hours, one HMG, one nap. Still does it.',
    weapon: { id: 'hmg', label: 'Old Faithful', flavor: 'tripod-mounted heavy machine gun. Aim by laying down fire.' },
    ability: { name: 'Suppressing Fire', desc: 'Enemies hit by HMG fire are slowed 40% for 2s. Recoil reduced 60% while crouched.' },
    relic: { id: 'bunker_chair', name: 'Folding Chair', desc: 'Standing still for 2s grants +100% accuracy and +20% damage until you move.' },
    startingItems: ['hmg', 'med_painkillers', 'armor_plate'],
    hirePrice: 7800,
    unlock: { roomHeld90s: 1 },
    weaponUnlock: { stat: 'hmgKills', target: 300 },
  },
  carrion: {
    id: 'carrion', codename: 'Carrion',
    class: 'breacher', tier: 'special',
    stats: { aim: 65, mob: 80, nrv: 65, hp: 95, armor: 35 },
    quirk: 'whistles old hymns at close range.',
    bio: 'Came up on a slaughterhouse floor. Comfortable in close quarters. The shotgun was a graduation gift.',
    weapon: { id: 'dragons_breath', label: 'Hymnal', flavor: 'dragon\'s breath rounds — incendiary buckshot. Lights\'em on the way down.' },
    ability: { name: 'Hymn Sing', desc: 'Within 4m, every shotgun pellet sets target on fire. Outside 4m, damage falls off 80%.' },
    relic: { id: 'carrion_hymn', name: 'Hymnbook', desc: 'Burning enemies grant +1 shotgun shell on kill (auto-loaded).' },
    startingItems: ['dragons_breath', 'thr_molotov', 'med_burn_salve'],
    hirePrice: 6400,
    unlock: { closeRangeKills: 50 },
    weaponUnlock: { stat: 'fireShotgunKills', target: 100 },
  },
  static_op: {
    id: 'static_op', codename: 'Static',
    class: 'assault', tier: 'special',
    stats: { aim: 75, mob: 70, nrv: 80, hp: 100, armor: 50 },
    quirk: 'speaks in radio brevity codes even off-comms.',
    bio: 'Career operator. No story you haven\'t heard. The rifle, though — that\'s yours to find out about.',
    weapon: { id: 'burst_rifle', label: 'Trinity', flavor: 'three-round burst, custom optic. The most reliable thing in the agency.' },
    ability: { name: 'Trained Operator', desc: 'No reload tax — first shot after reload always hits crit zone. Iron sights = 100% accuracy.' },
    relic: { id: 'static_radio', name: 'Field Radio', desc: 'Reveal next floor\'s contract type 100c discount on extract.' },
    startingItems: ['burst_rifle', 'm1911', 'med_stim'],
    hirePrice: 7000,
    unlock: { contractsComplete: 10 },
    weaponUnlock: { stat: 'rifleKills', target: 250 },
  },
};

// ============================================================
// NAMED RANDOM RECRUITS — 20 hand-authored agents (basic→epic)
// ============================================================
// Procgen agents (generateAgent) cover the bulk of slot 1+2. These
// 20 named recruits seed the recruiter's "named pool" — a curated
// set of recurring characters with consistent stats, quirks, and
// hire prices. They appear randomly mixed into the daily roster
// (~30% of slot 2 picks) so players see familiar faces over time.
// Each carries a personality + a small mechanical perk. None have
// the rarity-class signature weapons (those are SPECIAL_MERCS only).
// ============================================================
export const NAMED_RECRUITS = [
  // BASIC (low tier — cheap, raw)
  { id: 'recruit_jasper', codename: 'Jasper', class: 'assault', tier: 'low',
    stats: { aim: 35, mob: 50, nrv: 40, hp: 80, armor: 20 },
    quirk: 'twenty-three. eager. asks too many questions.',
    perk: 'Eager: +20% XP from kills.', hirePrice: 140 },
  { id: 'recruit_vega', codename: 'Vega', class: 'recon', tier: 'low',
    stats: { aim: 45, mob: 55, nrv: 35, hp: 70, armor: 15 },
    quirk: 'left a private military firm. won\'t say why.',
    perk: 'Watcher: enemies marked stay marked through walls for 3s.', hirePrice: 165 },
  { id: 'recruit_brick', codename: 'Brick', class: 'heavy', tier: 'low',
    stats: { aim: 30, mob: 25, nrv: 60, hp: 110, armor: 50 },
    quirk: 'massive. quiet. doesn\'t fit through standard doorways.',
    perk: 'Tank: damage reduction +10%.', hirePrice: 180 },
  { id: 'recruit_finch', codename: 'Finch', class: 'medic', tier: 'low',
    stats: { aim: 40, mob: 50, nrv: 45, hp: 75, armor: 15 },
    quirk: 'pre-med dropout. still has the textbooks.',
    perk: 'Field Medic: med-kits heal 25% more.', hirePrice: 155 },
  { id: 'recruit_rust', codename: 'Rust', class: 'breacher', tier: 'low',
    stats: { aim: 38, mob: 60, nrv: 35, hp: 80, armor: 20 },
    quirk: 'always smells faintly of motor oil.',
    perk: 'Breach: doors open 40% faster.', hirePrice: 140 },
  // MID (balanced, common hire)
  { id: 'recruit_specter', codename: 'Specter', class: 'recon', tier: 'mid',
    stats: { aim: 60, mob: 70, nrv: 55, hp: 90, armor: 30 },
    quirk: 'former corp scout. knows the inside of a hideout.',
    perk: 'Pathfinder: minimap reveals containers within 8m.', hirePrice: 380 },
  { id: 'recruit_atlas', codename: 'Atlas', class: 'heavy', tier: 'mid',
    stats: { aim: 55, mob: 40, nrv: 70, hp: 120, armor: 60 },
    quirk: 'shoulder used to dislocate. now it\'s pinned.',
    perk: 'Steady: heavy weapon recoil -20%.', hirePrice: 420 },
  { id: 'recruit_ember', codename: 'Ember', class: 'assault', tier: 'mid',
    stats: { aim: 65, mob: 60, nrv: 50, hp: 90, armor: 35 },
    quirk: 'blacklisted from three corps. wears it like a badge.',
    perk: 'Aggressive: +15% damage at <50% HP.', hirePrice: 360 },
  { id: 'recruit_sable', codename: 'Sable', class: 'medic', tier: 'mid',
    stats: { aim: 50, mob: 65, nrv: 65, hp: 95, armor: 30 },
    quirk: 'doesn\'t take her gloves off. ever.',
    perk: 'Triage: revives are 50% faster, +20 HP on revive.', hirePrice: 400 },
  { id: 'recruit_jericho', codename: 'Jericho', class: 'breacher', tier: 'mid',
    stats: { aim: 60, mob: 65, nrv: 55, hp: 85, armor: 35 },
    quirk: 'was a SWAT entry man. left after a bad warrant.',
    perk: 'First Through: +25% damage in first 3s after entering a room.', hirePrice: 410 },
  // MID+ (refined, expensive)
  { id: 'recruit_marrow', codename: 'Marrow', class: 'recon', tier: 'midp',
    stats: { aim: 75, mob: 70, nrv: 65, hp: 95, armor: 35 },
    quirk: 'reads tarot before contracts. claims it works.',
    perk: 'Recon: precision rifle headshots refund 50% of ammo cost.', hirePrice: 700 },
  { id: 'recruit_kiln', codename: 'Kiln', class: 'heavy', tier: 'midp',
    stats: { aim: 70, mob: 50, nrv: 75, hp: 130, armor: 65 },
    quirk: 'forearms scarred from a metal foundry job.',
    perk: 'Anvil: armor regenerates 5/s out of combat.', hirePrice: 780 },
  { id: 'recruit_quill', codename: 'Quill', class: 'assault', tier: 'midp',
    stats: { aim: 78, mob: 75, nrv: 60, hp: 100, armor: 40 },
    quirk: 'taps her trigger finger between rounds. never stops.',
    perk: 'Quickdraw: weapon swaps and reloads -25%.', hirePrice: 820 },
  { id: 'recruit_loam', codename: 'Loam', class: 'medic', tier: 'midp',
    stats: { aim: 60, mob: 70, nrv: 75, hp: 110, armor: 40 },
    quirk: 'plants something in every safehouse she visits.',
    perk: 'Recovery: out-of-combat HP regen +50%.', hirePrice: 760 },
  { id: 'recruit_tundra', codename: 'Tundra', class: 'breacher', tier: 'midp',
    stats: { aim: 70, mob: 75, nrv: 60, hp: 95, armor: 40 },
    quirk: 'speaks four languages. won\'t use them on the job.',
    perk: 'Quiet: stealth detection radius -30%.', hirePrice: 690 },
  // HIGH (rare, expensive — almost as good as specials)
  { id: 'recruit_wraith', codename: 'Wraith', class: 'recon', tier: 'high',
    stats: { aim: 88, mob: 80, nrv: 75, hp: 100, armor: 40 },
    quirk: 'no records. corp claims she\'s never existed.',
    perk: 'Phantom: backstabs deal 300% damage. First 5s of any contract = 90% stealth.', hirePrice: 1700 },
  { id: 'recruit_anvil', codename: 'Anvil', class: 'heavy', tier: 'high',
    stats: { aim: 80, mob: 50, nrv: 85, hp: 150, armor: 90 },
    quirk: 'slept through a megaboss attack once. survived. swore an oath.',
    perk: 'Bulwark: melee attacks against you stagger the attacker.', hirePrice: 1900 },
  { id: 'recruit_halo', codename: 'Halo', class: 'assault', tier: 'high',
    stats: { aim: 90, mob: 75, nrv: 70, hp: 110, armor: 50 },
    quirk: 'won the last corp war\'s sharpshooter prize. doesn\'t talk about it.',
    perk: 'Marksman: ADS spread halved. Crit rate +15%.', hirePrice: 2100 },
  { id: 'recruit_fern', codename: 'Fern', class: 'medic', tier: 'high',
    stats: { aim: 75, mob: 80, nrv: 80, hp: 130, armor: 50 },
    quirk: 'used to be a corp doctor. left without notice.',
    perk: 'Last Stand: at 1 HP, you have 2s of immortality.', hirePrice: 2000 },
  { id: 'recruit_ribbon', codename: 'Ribbon', class: 'breacher', tier: 'high',
    stats: { aim: 82, mob: 85, nrv: 70, hp: 105, armor: 45 },
    quirk: 'wears a single red ribbon on her wrist. won\'t say why.',
    perk: 'Velocity: dash distance +50%, dash cooldown -25%.', hirePrice: 1850 },
];

// Map of named recruit ids for fast lookup.
export const NAMED_RECRUITS_BY_ID = Object.fromEntries(NAMED_RECRUITS.map(r => [r.id, r]));

// ============================================================
// PROCGEN — random agents
// ============================================================
function pickFrom(list) { return list[Math.floor(Math.random() * list.length)]; }
function pickRange([lo, hi]) { return lo + Math.round(Math.random() * (hi - lo)); }

let _agentSeq = 1;
export function generateAgent(tier = 'mid') {
  const t = TIERS[tier];
  if (!t) throw new Error(`unknown tier ${tier}`);
  const id = `agent_${_agentSeq++}`;
  return {
    id, kind: 'agent',
    codename: pickFrom(CODENAMES),
    class: pickFrom(CLASSES),
    tier,
    stats: {
      aim: pickRange(t.aim),
      mob: pickRange(t.mob),
      nrv: pickRange(t.nrv),
    },
    quirk: pickFrom(QUIRKS_FLAVOR),
    hirePrice: pickRange(t.price),
    contract: { type: t.contractMissions === 99 ? 'lifetime' : `${t.contractMissions}-mission` },
    portraitSeed: Math.floor(Math.random() * 1e9),
  };
}

// Convert a NAMED_RECRUITS entry to a hire-card. Includes a fresh
// instance id and a contract type derived from tier.
function makeNamedOffer(named) {
  const contractByTier = { low: '5-mission', mid: '5-mission', midp: '10-mission', high: '10-mission' };
  return {
    id: `${named.id}_hire_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    kind: 'named',
    namedId: named.id,
    codename: named.codename,
    class: named.class,
    tier: named.tier,
    stats: { ...named.stats },
    quirk: named.quirk,
    perk: named.perk,
    hirePrice: named.hirePrice,
    contract: { type: contractByTier[named.tier] || '5-mission' },
    portraitSeed: named.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 37,
  };
}

// ============================================================
// ROLL ROSTER
// ============================================================
// Slot 1: low. Slot 2: mid. Slot 3: RNG.
// Each slot has a 30% chance of pulling a NAMED recruit of the
// appropriate tier instead of a procgen one — players see familiar
// faces over time. Slot 3 also has the 2% special-merc chance.
// Optionally biases the special slot to a specific merc id (debug /
// story-driven force).
export function rollRoster(unlockedSpecials = new Set(), opts = {}) {
  const roster = [];
  // Helper — 30% pull from named recruits matching tier, else procgen
  const slotForTier = (tier) => {
    const nameds = NAMED_RECRUITS.filter(r => r.tier === tier);
    if (nameds.length && Math.random() < 0.30) {
      return makeNamedOffer(pickFrom(nameds));
    }
    return generateAgent(tier);
  };
  roster.push(slotForTier('low'));
  roster.push(slotForTier('mid'));
  // Slot 3 RNG — broader range with rare special-merc chance.
  const r = Math.random();
  let third;
  if (opts.forceSpecial && SPECIAL_MERCS[opts.forceSpecial]) {
    third = makeSpecialOffer(opts.forceSpecial);
  } else if (r < 0.02 && Object.keys(SPECIAL_MERCS).length > 0) {
    const lockedIds = Object.keys(SPECIAL_MERCS).filter(id => !unlockedSpecials.has(id));
    const pickId = lockedIds.length ? pickFrom(lockedIds) : pickFrom(Object.keys(SPECIAL_MERCS));
    third = makeSpecialOffer(pickId);
  } else if (r < 0.20) {
    third = slotForTier('high');
  } else if (r < 0.90) {
    third = slotForTier('midp');
  } else {
    third = slotForTier('mid');
  }
  roster.push(third);
  return roster;
}

function makeSpecialOffer(id) {
  const m = SPECIAL_MERCS[id];
  if (!m) return generateAgent('high');
  // Return a HIRE-CARD shape (not the static merc def) — clones the
  // relevant fields and adds an instance id so the consumer can track
  // the specific hire.
  return {
    id: `${m.id}_hire_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    kind: 'special',
    mercId: m.id,
    codename: m.codename,
    class: m.class,
    tier: 'special',
    stats: { ...m.stats },
    quirk: m.quirk,
    bio: m.bio,
    weapon: m.weapon,
    hirePrice: m.hirePrice,
    contract: { type: '1-mission' },
    portraitSeed: m.id.charCodeAt(0) * 1000,
  };
}

// ============================================================
// PROGRESS TRACKING
// ============================================================
// Consumer (game code) increments these counters as the player plays
// with a special merc. When a goal is hit, mercUnlocks() returns true
// for that merc id and the recruiter starts spawning them as named
// cast (cheaper, persistent). When the weapon goal is hit, the weapon
// becomes available in the agency armory.
export function checkMercUnlock(mercId, progress) {
  const m = SPECIAL_MERCS[mercId];
  if (!m || !progress) return false;
  for (const [k, target] of Object.entries(m.unlock)) {
    if ((progress[k] || 0) < target) return false;
  }
  return true;
}

export function checkWeaponUnlock(mercId, progress) {
  const m = SPECIAL_MERCS[mercId];
  if (!m || !progress) return false;
  const { stat, target } = m.weaponUnlock;
  return (progress[stat] || 0) >= target;
}
