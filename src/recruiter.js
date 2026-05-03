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
    stats: { aim: 55, mob: 45, nrv: 85 },
    quirk: 'lights matches between contracts. doesn\'t blow them out.',
    bio: 'Burned a corporate compound off the books. Cleared in court, blacklisted everywhere. Now she works for chips.',
    weapon: { id: 'flamethrower', label: 'Flamethrower', flavor: 'home-built. No serial. Don\'t ask.' },
    hirePrice: 6500,
    unlock: { contractsComplete: 5 },
    weaponUnlock: { stat: 'burnKills', target: 200 },
  },
  long_sleep: {
    id: 'long_sleep', codename: 'Long Sleep',
    class: 'recon', tier: 'special',
    stats: { aim: 95, mob: 55, nrv: 70 },
    quirk: 'blinks slowly. never first to speak.',
    bio: 'Three years off the grid in a winter town. Came back when the bills did. The intervention came back with her.',
    weapon: { id: 'intervention', label: 'Intervention', flavor: 'milspec sniper. Punches through cover.' },
    hirePrice: 7200,
    unlock: { longRangeKills: 30 },
    weaponUnlock: { stat: 'oneShotKills', target: 10 },
  },
  cardinal: {
    id: 'cardinal', codename: 'Cardinal',
    class: 'assault', tier: 'special',
    stats: { aim: 80, mob: 90, nrv: 60 },
    quirk: 'wears red. always red. no exceptions.',
    bio: 'Bouncer at a sin-strip nightclub turned solo operator. Trades HP for muzzle velocity. Half a clip in each hand.',
    weapon: { id: 'twin_pistols', label: 'Twin Sins', flavor: 'matched compensated pistols. Shoots both at once.' },
    hirePrice: 6800,
    unlock: { soloFloor10: 1 },
    weaponUnlock: { stat: 'hipFireKills', target: 100 },
  },
  black_box: {
    id: 'black_box', codename: 'Black Box',
    class: 'recon', tier: 'special',
    stats: { aim: 60, mob: 70, nrv: 90 },
    quirk: 'never carries a phone.',
    bio: 'Used to break encryption for a three-letter agency. Broke the wrong file. Now they break locks for chips.',
    weapon: { id: 'silenced_smg', label: 'Mute', flavor: 'integral suppressor, 3-round burst. Ghosts don\'t hear themselves die.' },
    hirePrice: 5800,
    unlock: { hackContractsComplete: 1 },
    weaponUnlock: { stat: 'stealthKills', target: 50 },
  },
  slag: {
    id: 'slag', codename: 'Slag',
    class: 'heavy', tier: 'special',
    stats: { aim: 50, mob: 50, nrv: 80 },
    quirk: 'has scars where eyebrows used to be.',
    bio: 'Demolitions. Twenty years of it. Still has all his fingers, somehow.',
    weapon: { id: 'rocket_launcher', label: 'Anvil', flavor: 'shoulder-fired, no guidance. Aim center mass and pray for splash.' },
    hirePrice: 7500,
    unlock: { explosiveContractsComplete: 3 },
    weaponUnlock: { stat: 'explosionKills', target: 100 },
  },
  howitzer: {
    id: 'howitzer', codename: 'Howitzer',
    class: 'assault', tier: 'special',
    stats: { aim: 70, mob: 60, nrv: 75 },
    quirk: 'counts to three before every shot. out loud.',
    bio: 'Trained for siege warfare in a country that no longer exists. The grenade launcher came back with him.',
    weapon: { id: 'grenade_launcher', label: 'Echo Six', flavor: '6-round drum, fragmentation rounds. Bounces off walls.' },
    hirePrice: 6900,
    unlock: { roomLeveledFloor8: 1 },
    weaponUnlock: { stat: 'grenadeKills', target: 200 },
  },
  mule: {
    id: 'mule', codename: 'Mule',
    class: 'heavy', tier: 'special',
    stats: { aim: 60, mob: 30, nrv: 95 },
    quirk: 'has never been seen running.',
    bio: 'Stands behind the barrel. Keeps standing. The minigun spins, the room empties, the chips arrive.',
    weapon: { id: 'minigun', label: 'Mule\'s Mule', flavor: '6 barrels. 4000 RPM. spin-up cost is the whole game.' },
    hirePrice: 8500,
    unlock: { heat5Survived60s: 1 },
    weaponUnlock: { stat: 'minigunKills', target: 500 },
  },
  mortician: {
    id: 'mortician', codename: 'Mortician',
    class: 'breacher', tier: 'special',
    stats: { aim: 40, mob: 95, nrv: 70 },
    quirk: 'wears gloves indoors. never takes them off.',
    bio: 'Trained as an embalmer. Made a career change after a bad night. The blade came with the job.',
    weapon: { id: 'signature_blade', label: 'The Lesson', flavor: 'curved monomolecular blade. Cuts armor like fabric.' },
    hirePrice: 5500,
    unlock: { executions: 20 },
    weaponUnlock: { stat: 'meleeKills', target: 100 },
  },
  bunker: {
    id: 'bunker', codename: 'Bunker',
    class: 'heavy', tier: 'special',
    stats: { aim: 75, mob: 35, nrv: 90 },
    quirk: 'sets up a folding chair before every fight.',
    bio: 'Held a position for eight hours during the corp wars. Eight hours, one HMG, one nap. Still does it.',
    weapon: { id: 'hmg', label: 'Old Faithful', flavor: 'tripod-mounted heavy machine gun. Aim by laying down fire.' },
    hirePrice: 7800,
    unlock: { roomHeld90s: 1 },
    weaponUnlock: { stat: 'hmgKills', target: 300 },
  },
  carrion: {
    id: 'carrion', codename: 'Carrion',
    class: 'breacher', tier: 'special',
    stats: { aim: 65, mob: 80, nrv: 65 },
    quirk: 'whistles old hymns at close range.',
    bio: 'Came up on a slaughterhouse floor. Comfortable in close quarters. The shotgun was a graduation gift.',
    weapon: { id: 'dragons_breath', label: 'Hymnal', flavor: 'dragon\'s breath rounds — incendiary buckshot. Lights\'em on the way down.' },
    hirePrice: 6400,
    unlock: { closeRangeKills: 50 },
    weaponUnlock: { stat: 'fireShotgunKills', target: 100 },
  },
  static_op: {
    id: 'static_op', codename: 'Static',
    class: 'assault', tier: 'special',
    stats: { aim: 75, mob: 70, nrv: 80 },
    quirk: 'speaks in radio brevity codes even off-comms.',
    bio: 'Career operator. No story you haven\'t heard. The rifle, though — that\'s yours to find out about.',
    weapon: { id: 'burst_rifle', label: 'Trinity', flavor: 'three-round burst, custom optic. The most reliable thing in the agency.' },
    hirePrice: 7000,
    unlock: { contractsComplete: 10 },
    weaponUnlock: { stat: 'rifleKills', target: 250 },
  },
};

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

// ============================================================
// ROLL ROSTER
// ============================================================
// Slot 1: low. Slot 2: mid. Slot 3: RNG. Optionally biases the
// special slot to a specific merc id (debug / story-driven force).
export function rollRoster(unlockedSpecials = new Set(), opts = {}) {
  const roster = [];
  roster.push(generateAgent('low'));
  roster.push(generateAgent('mid'));
  // Slot 3 RNG.
  const r = Math.random();
  let third;
  if (opts.forceSpecial && SPECIAL_MERCS[opts.forceSpecial]) {
    third = makeSpecialOffer(opts.forceSpecial);
  } else if (r < 0.02 && Object.keys(SPECIAL_MERCS).length > 0) {
    // Pick a random special merc that the player hasn't permanently
    // unlocked. Once unlocked, they show up in the named-cast pool
    // (cheaper) instead of as a 2% rare.
    const lockedIds = Object.keys(SPECIAL_MERCS).filter(id => !unlockedSpecials.has(id));
    const pickId = lockedIds.length ? pickFrom(lockedIds) : pickFrom(Object.keys(SPECIAL_MERCS));
    third = makeSpecialOffer(pickId);
  } else if (r < 0.20) {
    third = generateAgent('high');
  } else if (r < 0.90) {
    third = generateAgent('midp');
  } else {
    third = generateAgent('mid');
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
