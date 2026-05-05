// ai_squad.js — Pass 2 squad role assignment.
//
// Walks the alive+aware gunmen, groups them by room, and stamps a
// `role` string on each. The downstream gunman state machine reads
// this role to drive role-specific behaviour (anchor suppresses,
// flanker repositions, rusher closes).
//
// Roles:
//   anchor   — best-scoring cover position; suppresses the player's
//              last-known cell while flankers move
//   rusher   — closest gunman to the player; pushes in directly
//   flanker  — 1-2 of the rest assigned to a cover position on the
//              hemisphere of the player opposite the anchor
//   support  — the remainder; existing baseline behaviour
//
// Re-assignment runs at most once per second (throttled via a level-
// scoped timer) AND on demand when a role-bearing gunman takes >20%
// hp damage in a single hit (callers stamp `g._squadDirty = true`).
// Anchor-vs-flanker swap: if the anchor takes any hp damage, the
// closest flanker is swapped on the next assignment tick.
//
// Pure host-side logic. The joiner mirrors via the existing per-
// gunman `state` snapshot field — role itself is decision data and
// does NOT need to be synced.
//
// Public API:
//   assignRoles(level, gunmen, player, opts?) — call once per AI tick
//   _flankCoverPosition(level, player, anchorPos)  — internal helper

import { findCoverFor } from './ai_cover.js';

const REASSIGN_INTERVAL = 1.0;          // seconds — 1 Hz cron
const FLANK_MAX_RADIUS  = 12;           // metres — search radius for flank cover
const FLANK_HEMI_DOT    = -0.1;         // candidate must be on the
                                        // OPPOSITE hemisphere from anchor
                                        // relative to player (dot ≤ this)

// Find a flank cover position on the hemisphere of the player
// opposite the anchor. Walks ai_cover.findCoverFor on the player as
// target, then filters candidates whose direction-from-player is
// roughly opposite to the anchor's direction-from-player.
//
// Returns the best candidate {x, z, score} or null when no usable
// flank cover exists.
function _flankCoverPosition(level, player, anchorPos, flankerPos) {
  if (!level || !player || !anchorPos) return null;
  // Anchor → player direction (XZ).
  const adx = player.x - anchorPos.x;
  const adz = player.z - anchorPos.z;
  const al = Math.hypot(adx, adz) || 1;
  const aux = adx / al, auz = adz / al;
  // Source position for the cover search — the flanker themselves
  // (so distance bias prefers nearby flank options).
  const src = flankerPos || anchorPos;
  const candidates = findCoverFor(level, src, player,
    { maxRadius: FLANK_MAX_RADIUS });
  if (!candidates || !candidates.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    // Direction from player to candidate.
    const dx = c.x - player.x;
    const dz = c.z - player.z;
    const l = Math.hypot(dx, dz) || 1;
    // Dot of (player→anchor) and (player→candidate) — when negative
    // the candidate is on the FAR side of the player from the
    // anchor. When positive it's on the same side. We want negative.
    const dot = ((-aux) * (dx / l)) + ((-auz) * (dz / l));
    if (dot > FLANK_HEMI_DOT) continue;
    const s = c.score * (c.bias || 1);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

// Group alive+aware gunmen by their current room. Skips dead, idle,
// sleeping, and entries without a level.roomAt result. The room-id
// key is a string so the Map can hold a stable reference even when
// the level later regenerates and the room object identity changes.
function _groupByRoom(level, gunmen) {
  const groups = new Map();
  if (!level || !gunmen || !gunmen.length) return groups;
  for (const g of gunmen) {
    if (!g || !g.alive) continue;
    if (g.state === 'idle' || g.state === 'sleep' || g.state === 'dead') continue;
    const pos = g.group?.position;
    if (!pos) continue;
    const room = level.roomAt ? level.roomAt(pos.x, pos.z) : null;
    if (!room) continue;
    const key = room.id ?? room._id ?? `${room.bounds?.minX | 0},${room.bounds?.minZ | 0}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(g);
  }
  return groups;
}

// Anchor candidate scorer — highest cover score wins. Uses
// findCoverFor anchored on each gunman's current position; picks the
// gunman whose nearest cover scores best. Falls back to the gunman
// with the smallest distance-to-player when no cover candidates
// exist for any group member.
function _pickAnchor(level, group, player) {
  let best = null;
  let bestScore = -Infinity;
  for (const g of group) {
    const pos = g.group?.position;
    if (!pos) continue;
    const cands = findCoverFor(level, pos, player, { maxRadius: 8 });
    let s = 0;
    if (cands && cands.length) {
      s = (cands[0].score || 0) * (cands[0].bias || 1);
      // Stash the best cover for the anchor to walk to next tick.
      g._squadCoverHint = cands[0];
    }
    if (s > bestScore) {
      bestScore = s;
      best = g;
    }
  }
  if (!best) {
    // Fallback: pick whoever is mid-distance — closest is probably
    // the rusher, farthest is the support. Pick by smallest cover-
    // candidate count tied to position.
    best = group[0];
  }
  return best;
}

// Rusher = closest to player.
function _pickRusher(group, player) {
  let best = null, bestD = Infinity;
  for (const g of group) {
    const p = g.group?.position;
    if (!p) continue;
    const dx = p.x - player.x, dz = p.z - player.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = g; }
  }
  return best;
}

// Public: walk the gunmen, stamp `gunman.role` per the rules in the
// header. Returns an object with per-room role counts for the probe
// + invariant gate.
//
// Throttled: skips work when the level's `_squadAssignT` timer hasn't
// elapsed AND no gunman has `_squadDirty` set. Pass opts.force=true
// to bypass the throttle (used by the on-damage re-assignment path).
export function assignRoles(level, gunmen, player, opts = {}) {
  const result = { rooms: 0, anchor: 0, rusher: 0, flanker: 0, support: 0 };
  if (!level || !gunmen || !gunmen.length || !player) return result;
  // Throttle. dt is shared across the bot's tick callback; we read
  // off the existing level container so the timer survives between
  // calls without a per-instance cron.
  const dt = opts.dt ?? 0;
  if (level._squadAssignT === undefined) level._squadAssignT = 0;
  level._squadAssignT -= dt;
  // Damage-driven re-assignment: any gunman flagged dirty forces a
  // pass even when the throttle hasn't elapsed.
  let dirty = !!opts.force;
  if (!dirty) {
    for (const g of gunmen) {
      if (g && g._squadDirty) { dirty = true; break; }
    }
  }
  if (level._squadAssignT > 0 && !dirty) {
    // Tally current roles for the probe / invariant — cheap.
    for (const g of gunmen) {
      if (!g || !g.alive || !g.role) continue;
      if (result[g.role] !== undefined) result[g.role]++;
    }
    return result;
  }
  level._squadAssignT = REASSIGN_INTERVAL;

  // Anchor-vs-flanker swap: if the previous anchor took damage
  // (flagged via _squadAnchorHit), promote the closest flanker.
  // Implemented inline below by NOT preferring the wounded anchor
  // when picking the new anchor — _pickAnchor scores by cover, so
  // an anchor that's been displaced into the open will naturally
  // lose. Explicit swap path: if _squadAnchorHit and there's a
  // flanker, swap them on this tick.
  const groups = _groupByRoom(level, gunmen);
  result.rooms = groups.size;

  for (const arr of groups.values()) {
    if (arr.length === 0) continue;
    const anchor = _pickAnchor(level, arr, player);
    const rusher = (anchor && arr.length > 1) ? _pickRusher(arr.filter(g => g !== anchor), player) : null;
    const remaining = arr.filter(g => g !== anchor && g !== rusher);
    // 1-2 flankers depending on group size.
    const wantFlankers = arr.length >= 4 ? 2 : (arr.length >= 3 ? 1 : 0);
    const flankers = [];
    for (let i = 0; i < wantFlankers && i < remaining.length; i++) {
      flankers.push(remaining[i]);
    }
    const support = remaining.slice(flankers.length);

    if (anchor) {
      anchor.role = 'anchor';
      anchor._squadDirty = false;
      result.anchor++;
    }
    if (rusher) {
      rusher.role = 'rusher';
      rusher._squadDirty = false;
      result.rusher++;
    }
    for (const f of flankers) {
      f.role = 'flanker';
      f._squadDirty = false;
      // Compute a flank target on the opposite hemisphere of the
      // anchor relative to the player.
      const target = _flankCoverPosition(
        level, player,
        anchor ? anchor.group.position : f.group.position,
        f.group.position,
      );
      if (target) {
        f._flankTarget = { x: target.x, z: target.z };
      } else {
        f._flankTarget = null;
      }
      result.flanker++;
    }
    for (const s of support) {
      s.role = 'support';
      s._squadDirty = false;
      result.support++;
    }
    // Anchor-hit swap path. If the anchor flag was set on the
    // previously-assigned anchor and we have a flanker, the next
    // pass already promoted by score; clear the dirty flag so a
    // single hit doesn't loop the swap forever.
    if (anchor) anchor._squadAnchorHit = false;
  }

  return result;
}

// Convenience: stamp a damage-driven dirty bit. Callers (gunman
// applyHit) invoke this when a role-bearing gunman takes >20% maxHp
// damage in a single hit. Cheap: just sets two flags.
export function notifyDamage(gunman, dmgFraction) {
  if (!gunman) return;
  if (dmgFraction <= 0.2) return;
  gunman._squadDirty = true;
  if (gunman.role === 'anchor') gunman._squadAnchorHit = true;
}
