// buildings.js — Pass 1C of the level-gen overhaul. Building-mass
// system that groups cell-graph rooms into 1-3 distinct "buildings"
// and surfaces the inter-building connector edges that the skybridge
// generator turns into walkable bridges / catwalks / fire escapes.
//
// IMPORTANT: this layer NEVER alters cell-graph topology. It only
// stamps `room.building = 'A' | 'B' | 'C'` and reports which
// neighbor-edges cross a building boundary. The chain + branch
// builder in level.js owns the graph; we annotate it.
//
// Selection rules (matching the design doc):
//   - Default: every cell is its own building → entire level reads
//     as one continuous interior. (One-building chain, no bridges.)
//   - Levels with index >= 3 roll MULTI_BUILDING_CHANCE. On hit, we
//     split the chain so the back half (boss + extraction) is in a
//     SEPARATE building from the spawn. The split point is biased
//     toward the chain midpoint so each building has ≥2 rooms.
//   - Branch rooms (subBoss / shops) inherit the building tag of the
//     chain room they branch off, so a shop never floats on its own.
//
// Building partitions stay convex at the cell-grid level (the brief
// invariant "Buildings stay convex"): we split the chain at a single
// ordered cut, never by quadrant, so each building's cells form a
// contiguous segment of the chain plus their own branches.

// Building registry — small theme tag + density hint per slot. The
// renderer / prop placer doesn't yet read these; surface is here so
// later passes (Pass 1D theming?) can branch on building identity.
export const BUILDING_TYPES = {
  A: { tag: 'A', theme: 'primary',   propDensity: 1.0 },
  B: { tag: 'B', theme: 'secondary', propDensity: 0.9 },
  C: { tag: 'C', theme: 'tertiary',  propDensity: 0.85 },
};

const MULTI_BUILDING_CHANCE = 0.35;

// Partition the level into buildings. Idempotent — calling twice on
// the same level is harmless because we assign every room a tag every
// time. Branch rooms inherit their chain-anchor's tag in pass 2.
//
// Mutates `level.rooms[*].building` in place. Returns the set of
// distinct building tags actually used so callers can iterate them.
export function assignBuildings(level) {
  const rooms = level.rooms || [];
  const lvIdx = Math.max(1, level.index || 1);

  // Default — single building, every room tagged 'A'.
  for (const r of rooms) r.building = 'A';

  if (lvIdx < 3 || Math.random() >= MULTI_BUILDING_CHANCE) {
    return new Set(['A']);
  }

  // Multi-building: split the chain. The chain is rooms with id 0..N
  // in order (start=0, boss=last chain id BEFORE branches). Branches
  // (subBoss, shops, etc.) appear AFTER the chain in `rooms` but they
  // were attached to a specific chain room — we recover the anchor via
  // the lowest-id neighbor and inherit its tag.
  const chainRooms = [];
  for (const r of rooms) {
    if (r.id < 0) continue;                      // synthetic (extraction)
    if (r.type === 'start' || r.type === 'combat'
        || r.type === 'boss' || r.type === 'encounter') {
      chainRooms.push(r);
    }
  }
  // Sort by id so chain order is preserved (the chain is built id
  // ascending in level.js).
  chainRooms.sort((a, b) => a.id - b.id);

  if (chainRooms.length < 4) {
    // Too short to split safely — keep one building.
    return new Set(['A']);
  }

  // Cut point — middle third of the chain. cut = first index in
  // building B. We require both halves to have at least 2 rooms.
  const minHalf = 2;
  const cutMin = minHalf;
  const cutMax = chainRooms.length - minHalf;
  const cut = cutMin + Math.floor(Math.random() * (cutMax - cutMin + 1));

  for (let i = 0; i < chainRooms.length; i++) {
    chainRooms[i].building = i < cut ? 'A' : 'B';
  }

  // Branch rooms — inherit from anchor. Anchor = lowest-id neighbor
  // (the chain room they branched off; branch rooms have a single
  // neighbor by construction in level.js's addBranch).
  for (const r of rooms) {
    if (r.id < 0) continue;
    if (r.type === 'subBoss' || r.type === 'merchant' || r.type === 'healer'
        || r.type === 'gunsmith' || r.type === 'armorer' || r.type === 'tailor'
        || r.type === 'relicSeller' || r.type === 'blackMarket'
        || r.type === 'bearMerchant') {
      // Already-set building stays; default to anchor tag.
      let anchorId = Infinity;
      for (const n of r.neighbors || []) {
        if (n.otherId < anchorId) anchorId = n.otherId;
      }
      const anchor = rooms.find(x => x.id === anchorId);
      if (anchor && anchor.building) r.building = anchor.building;
    }
  }

  // Stamp the synthetic extraction room (id < 0) with the boss's tag
  // if it exists — the extraction chamber lives in the same building
  // as the boss.
  for (const r of rooms) {
    if (r.id < 0) {
      // Find boss room
      const boss = rooms.find(x => x.type === 'boss');
      if (boss && boss.building) r.building = boss.building;
    }
  }

  const used = new Set(rooms.map(r => r.building).filter(Boolean));
  return used;
}

// Walk every neighbor edge in the level. Return the subset whose two
// endpoints belong to DIFFERENT buildings (those are the connector
// edges that the skybridge generator will substitute a bridge room
// for, replacing the regular doorway). Each entry includes a `kind`
// rolled from a small palette.
//
// Returns: [{ fromRoom, toRoom, kind }, ...]
//
// The same edge appears once (deduplicated by sorted id pair).
export function connectorEdgesFor(level) {
  const rooms = level.rooms || [];
  const edges = [];
  const seen = new Set();

  // Pre-bucket rooms by id for O(1) lookup. Synthetic rooms (id < 0)
  // are skipped — extraction connectors are owned by the boss-clear
  // flow, not by the building-bridge system.
  const byId = new Map();
  for (const r of rooms) {
    if (r.id >= 0) byId.set(r.id, r);
  }

  for (const r of rooms) {
    if (r.id < 0 || !r.neighbors) continue;
    for (const n of r.neighbors) {
      const other = byId.get(n.otherId);
      if (!other) continue;
      if (r.building === other.building) continue;
      const k = [Math.min(r.id, n.otherId), Math.max(r.id, n.otherId)].join('-');
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push({
        fromRoom: r,
        toRoom: other,
        kind: pickConnectorKind(r, other),
      });
    }
  }
  return edges;
}

// Pick a connector kind. Theme-aware: rooftop-y levels lean toward
// open catwalks / crane arms; sewer-y levels get sewer tunnels;
// industrial / parking levels get fire escapes / glass tunnels. We
// don't have direct theme info on the rooms here, but we can read
// `level.theme.name` via the boss room's anchor — for now keep it
// simple and roll a uniform pick. The full theme weighting can land
// in a follow-up.
function pickConnectorKind(_a, _b) {
  const KINDS = ['skybridge-glass', 'skybridge-open',
                 'crane-arm', 'fire-escape', 'sewer-tunnel'];
  return KINDS[Math.floor(Math.random() * KINDS.length)];
}
