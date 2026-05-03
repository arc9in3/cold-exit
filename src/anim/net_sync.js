// ============================================================
// net_sync.js — coop animation tuple encode/decode (L6)
// ============================================================
//
// Packs per-actor animation state into a 5-byte tuple appended to
// each enemy's snapshot entry by src/coop/snapshot.js:
//
//   { ab: u8, au: u8, ac: u8, af: u8 }
//
//   ab    base-layer state index (locomotion: idle/walk/run/...)
//   au    upper-layer state index (combat: aim/fire/relaxed/...)
//   ac    clip-time quantized to [0..255] over the active clip's loop
//   af    flags — bit0=looping, bit1=mirrored, bit2=additive_aim,
//                 bit3=recoil_pulse, bit4=reload_pulse
//
// State indices are derived from the SM JSON's `layers[i].states`
// declaration order — stable across host + joiners because they
// share the same JSON. The SM hash is sent at lobby join and
// joiners refuse mismatched majors (per plan risk note).
//
// Bandwidth: 4 bytes × 24 enemies × 20 Hz = ~1.9 KB/s. Negligible.

export const ANIM_FLAG = {
  LOOPING:       1 << 0,
  MIRRORED:      1 << 1,
  ADDITIVE_AIM:  1 << 2,
  RECOIL_PULSE:  1 << 3,
  RELOAD_PULSE:  1 << 4,
};

// Build a stable id table for a layered SM cfg. Returns:
//   { layerName: { stateId -> index, indexToState: [name,...] } }
// State names come in JSON declaration order so host + joiner agree.
export function buildStateIndex(smCfg) {
  const out = {};
  if (!smCfg || !smCfg.layers) return out;
  for (const L of smCfg.layers) {
    const indexToState = Object.keys(L.states || {});
    const map = {};
    indexToState.forEach((name, i) => { map[name] = i; });
    out[L.name] = { map, indexToState };
  }
  return out;
}

// Hash the SM config for the lobby handshake. djb2-style; not
// cryptographic, just enough to detect mismatch.
export function smHash(smCfg) {
  if (!smCfg) return 0;
  let h = 5381;
  const walk = (v) => {
    if (v === null) return;
    if (typeof v === 'string') {
      for (let i = 0; i < v.length; i++) h = ((h << 5) + h + v.charCodeAt(i)) | 0;
    } else if (typeof v === 'number') {
      h = ((h << 5) + h + v) | 0;
    } else if (typeof v === 'boolean') {
      h = ((h << 5) + h + (v ? 1 : 0)) | 0;
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (typeof v === 'object') {
      for (const k of Object.keys(v).sort()) {
        for (let i = 0; i < k.length; i++) h = ((h << 5) + h + k.charCodeAt(i)) | 0;
        walk(v[k]);
      }
    }
  };
  walk(smCfg);
  return h >>> 0;
}

// Encode an actor's animation state into a tuple.
//
// graph    : an AnimationGraph instance (from src/anim/graph.js)
// smIndex  : the result of buildStateIndex(smCfg)
// stateNameByLayer : { base: 'walk', upper: 'fire_stand' } — the
//                    currently selected SM state per layer (the
//                    selection logic is in player.js / npc code)
// flags    : bit-packed ANIM_FLAG.* — caller asserts which apply
export function encodeAnimTuple(graph, smIndex, stateNameByLayer, flags = 0) {
  if (!graph || !smIndex) return null;
  const baseLayer = smIndex.base;
  const upperLayer = smIndex.combat || smIndex.upper;
  const baseId = baseLayer && baseLayer.map[stateNameByLayer.base] != null
    ? baseLayer.map[stateNameByLayer.base] : 0;
  const upperId = upperLayer && upperLayer.map[stateNameByLayer.upper] != null
    ? upperLayer.map[stateNameByLayer.upper] : 0;
  // clip-time q from the dominant base-layer track.
  let timeQ = 0;
  const baseTrackIdx = graph.layerByName.get('base');
  if (baseTrackIdx != null) {
    const tr = graph.tracks[baseTrackIdx];
    if (tr.action) {
      const dur = tr.action.getClip().duration || 1;
      timeQ = Math.max(0, Math.min(255, Math.floor((tr.action.time / dur) * 255))) | 0;
    }
  }
  return {
    base: baseId & 0xff,
    upper: upperId & 0xff,
    timeQ: timeQ & 0xff,
    flags: flags & 0xff,
  };
}

// Apply a tuple to a remote actor's graph. Authoritative for state
// IDs + flags; clip time is interpolated from the snapshot buffer
// upstream so callers pass the alpha-blended timeQ.
//
// remoteGraph : the joiner's local graph for this actor
// smIndex     : same as host
// tuple       : { base, upper, timeQ, flags }
export function applyAnimTuple(remoteGraph, smIndex, smCfg, tuple) {
  if (!remoteGraph || !smIndex || !smCfg || !tuple) return;
  const baseLayer = smIndex.base;
  const upperLayer = smIndex.combat || smIndex.upper;
  if (baseLayer && smCfg.layers) {
    const baseStateName = baseLayer.indexToState[tuple.base];
    const upperStateName = upperLayer ? upperLayer.indexToState[tuple.upper] : null;
    const baseLayerCfg = smCfg.layers.find(L => L.name === 'base');
    const upperLayerCfg = smCfg.layers.find(L => L.name === 'combat' || L.name === 'upper');
    if (baseLayerCfg && baseStateName && baseLayerCfg.states[baseStateName]) {
      const clip = baseLayerCfg.states[baseStateName].clip;
      const cur = remoteGraph.tracks[remoteGraph.layerByName.get('base')];
      if (cur?.action?.getClip().name !== clip) {
        remoteGraph.playOnLayer('base', clip, { loop: true });
      }
      // Snap clip time from the quantized tuple.
      if (cur?.action) {
        const dur = cur.action.getClip().duration || 1;
        cur.action.time = (tuple.timeQ / 255) * dur;
      }
    }
    if (upperLayerCfg && upperStateName && upperLayerCfg.states[upperStateName]) {
      const clip = upperLayerCfg.states[upperStateName].clip;
      const lyrName = upperLayerCfg.name;
      const cur = remoteGraph.tracks[remoteGraph.layerByName.get(lyrName)];
      if (cur?.action?.getClip().name !== clip) {
        remoteGraph.playOnLayer(lyrName, clip, { loop: true });
      }
    }
  }
}
