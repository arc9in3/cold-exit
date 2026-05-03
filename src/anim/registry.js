// ============================================================
// registry.js — JSON manifest loader for the anim system
// ============================================================
//
// Centralized fetch + cache for every JSON config under
// Assets/anim_data/. Other anim modules ASK the registry for configs
// by id; the registry handles fetch, parse, version check, cache.
//
// Schema version: see Assets/anim_data/_version.json. Loader
// refuses configs from incompatible major versions.
//
// Usage:
//   const reg = await Registry.create('Assets/anim_data/');
//   const mixamoCfg = reg.rig('mixamo');
//   const stateMachineCfg = reg.stateMachine('cold_exit_player');
//
// All loads are async; the create() promise resolves once the
// version + rig configs (small) have been fetched. Larger configs
// (clip metadata, cutscenes) are loaded on-demand.

const SCHEMA_COMPATIBLE_DEFAULT = [1];

export class Registry {
  constructor(basePath, version) {
    this.basePath = basePath.endsWith('/') ? basePath : basePath + '/';
    this.version = version;
    this._rigs = new Map();           // id → parsed rig config
    this._stateMachines = new Map();  // id → parsed SM config
    this._overrides = new Map();      // id → parsed override config
    this._rigParts = new Map();       // id → parsed rig part config
    this._composes = new Map();       // id → parsed compose config
    this._scenes = new Map();         // id → parsed scene config
    this._clipMeta = new Map();       // (rigId, clipName) → metadata
  }

  // Async factory. Loads schema version + all rig configs (small set,
  // worth eager-loading so synchronous lookups work after init).
  static async create(basePath = 'Assets/anim_data/') {
    const ver = await fetchJson(`${basePath}_version.json`).catch(() => null);
    if (!ver || !ver.schemaVersion) {
      throw new Error(`[anim/registry] missing or invalid _version.json at ${basePath}`);
    }
    const compatible = ver.compatible || SCHEMA_COMPATIBLE_DEFAULT;
    if (!compatible.includes(ver.schemaVersion)) {
      throw new Error(`[anim/registry] schema version ${ver.schemaVersion} not in compatible set ${compatible}`);
    }
    const reg = new Registry(basePath, ver);
    // Eager-load rig configs — there are only a handful and consumers
    // expect synchronous lookup via reg.rig(id).
    for (const id of ['mixamo', 'motus', 'biped', 'procgen']) {
      try {
        const cfg = await fetchJson(`${reg.basePath}rigs/${id}.json`);
        reg._rigs.set(id, cfg);
      } catch (e) {
        console.warn(`[anim/registry] rig ${id} not loaded: ${e.message}`);
      }
    }
    return reg;
  }

  // Synchronous lookup (rig configs are eager-loaded).
  rig(id) {
    return this._rigs.get(id) || null;
  }

  // Lazy loaders for less-frequently-used configs.
  async stateMachine(id) {
    if (this._stateMachines.has(id)) return this._stateMachines.get(id);
    const cfg = await fetchJson(`${this.basePath}states/${id}.json`);
    this._stateMachines.set(id, cfg);
    return cfg;
  }
  async overrides(id) {
    if (this._overrides.has(id)) return this._overrides.get(id);
    const cfg = await fetchJson(`${this.basePath}overrides/${id}.json`);
    this._overrides.set(id, cfg);
    return cfg;
  }
  async rigPart(id) {
    if (this._rigParts.has(id)) return this._rigParts.get(id);
    const cfg = await fetchJson(`${this.basePath}rig_parts/${id}.json`);
    this._rigParts.set(id, cfg);
    return cfg;
  }
  async compose(id) {
    if (this._composes.has(id)) return this._composes.get(id);
    const cfg = await fetchJson(`${this.basePath}rig_compose/${id}.json`);
    this._composes.set(id, cfg);
    return cfg;
  }
  async scene(id) {
    if (this._scenes.has(id)) return this._scenes.get(id);
    const cfg = await fetchJson(`${this.basePath}scenes/${id}.json`);
    this._scenes.set(id, cfg);
    return cfg;
  }
  async clipMeta(rigId, clipName) {
    const key = `${rigId}/${clipName}`;
    if (this._clipMeta.has(key)) return this._clipMeta.get(key);
    const cfg = await fetchJson(`${this.basePath}clips/${rigId}/${clipName}.json`).catch(() => null);
    this._clipMeta.set(key, cfg);
    return cfg;
  }

  // Detect which rig config matches a loaded skeleton (by trying each
  // rig's prefix-strip + boneMap and counting matched bones). Used by
  // the FBX/GLB loader when no rigId is explicitly specified.
  detectRigId(boneNames) {
    let bestId = null, bestHits = 0;
    for (const [id, cfg] of this._rigs) {
      if (!cfg.boneMap || !Object.keys(cfg.boneMap).length) continue;
      const hits = countBoneMatches(boneNames, cfg);
      if (hits > bestHits) { bestId = id; bestHits = hits; }
    }
    return bestId;
  }
}

// Strip prefixes + suffix-regex per a rig config. Mirrors the
// bareBone() helper in character_fbx.js but driven from the JSON
// config rather than hardcoded.
export function bareBoneFor(name, rigCfg) {
  if (!name || !rigCfg) return name;
  let n = name;
  for (const p of (rigCfg.bonePrefixStrip || [])) {
    if (n.startsWith(p)) { n = n.slice(p.length); break; }
  }
  if (rigCfg.boneSuffixStripRegex) {
    n = n.replace(new RegExp(rigCfg.boneSuffixStripRegex), '');
  }
  return n;
}

function countBoneMatches(boneNames, rigCfg) {
  let hits = 0;
  for (const raw of boneNames) {
    const bare = bareBoneFor(raw, rigCfg);
    if (rigCfg.boneMap[bare]) hits++;
  }
  return hits;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return await res.json();
}
