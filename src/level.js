import * as THREE from 'three';
import { tunables } from './tunables.js';
import { buildProp, getLevelTheme, INWARD_FACING_KINDS, DESTRUCTIBLE_HP } from './props.js';
import { buildRig, initAnim, updateAnim } from './actor_rig.js';
import { makeContainer, pickContainerType, pickContainerSize, buildContainerMesh } from './containers.js';
import { StaticObstacleGrid2D } from './obstacle_grid.js';
import { pickTemplateForRoom, applyTemplate } from './room_templates.js';
import { buildExtractionRoom } from './extraction_room.js';
import { SHAPE_REGISTRY, pickShapeForRoom } from './level_shapes.js';
import { assignBuildings, connectorEdgesFor } from './buildings.js';
import { buildWindow } from './windows.js';
import { buildSkybridge } from './skybridges.js';
import { addLedge } from './ledges.js';
import { initWallInstancer, wallInstancer } from './wall_instancer.js';
import { sharedMaterial, disposeIfNotShared, disposeMaterialIfNotShared } from './material_pool.js';

// Shopkeeper palette per kind — body / head / pants / gear tint so
// each shop's NPC reads as a distinct role in the world. Exported so
// the portrait renderer (ui_shop) can render a tiny avatar that
// matches the world model exactly.
export const KEEPER_PALETTE = {
  merchant:    { body: 0x7a5a2e, skin: 0xc39066, pants: 0x2a1f18, gear: 0xd0a060, boots: 0x1a1510 },
  healer:      { body: 0x4a7a5a, skin: 0xd0b088, pants: 0x2a2a2e, gear: 0x70c8a0, boots: 0x1a1510 },
  gunsmith:    { body: 0x6a3a28, skin: 0xc39066, pants: 0x302018, gear: 0xdc6a3a, boots: 0x1a1510 },
  armorer:     { body: 0x4a5a6a, skin: 0xc39066, pants: 0x232830, gear: 0x6a8edc, boots: 0x1a1510 },
  tailor:      { body: 0x7a4a70, skin: 0xd8ba90, pants: 0x3a2a35, gear: 0xd070c8, boots: 0x2a1510 },
  relicSeller: { body: 0x5a4830, skin: 0xc39066, pants: 0x3a2a1a, gear: 0xe6b94a, boots: 0x1a1510 },
  blackMarket: { body: 0x2a1f24, skin: 0xb08060, pants: 0x1a0f14, gear: 0x9a5ac9, boots: 0x0a0a0a },
};

// Multi-room level. Generated as a chain of rectangular rooms connected by
// doorways; optional branch to a sub-boss room. Each room has four walls with
// a gap for each connected neighbor, plus a "door" wall segment that blocks
// the gap until the room is cleared of enemies.
//
// Enemies spawn once per room and do not respawn. The player must clear the
// current room before its doors open; the boss room reveals the extract.

// Wall + cover colours are now `let` so the theme system can re-
// tint them at the start of each generate(). Defaults match the
// pre-theme look so any code that runs before theme application
// (tutorial, edge-cases) still has reasonable values.
let FULL_WALL_COLOR = 0x2a2e38;
let LOW_COVER_COLOR = 0x3a3a34;
let OUTER_WALL_COLOR = 0x1a1e24;
const DOOR_COLOR = 0x8a3a2a;
const DOOR_OPEN_COLOR = 0x3a5a3a;
const EXIT_COLOR = 0x00ff88;

// Darken a hex colour by `k` (0..1). Used to derive outer wall
// (darker than inner) + low cover (slightly darker accent) from a
// theme's primary wall colour. Same helper pattern as actor_rig.
function _darkenHex(hex, k) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const m = 1 - k;
  return ((Math.round(r * m)) << 16) | ((Math.round(g * m)) << 8) | (Math.round(b * m));
}

const ROOM_W = 18;
const ROOM_H = 18;
const WALL_THICK = 1.2;
const WALL_HEIGHT = 3.0;
const DOOR_WIDTH = 4;
const PROJECTILE_OBSTACLE_CELL_SIZE = 5;

export class Level {
  constructor(scene, opts = {}) {
    this.scene = scene;
    // Optional reference to the global ground mesh from createScene.
    // Used to re-tint the floor on each level regen so the per-theme
    // colour palette extends underfoot, not just to walls/props.
    this.ground = opts.ground || null;
    // Active theme — assigned at the start of each generate() based
    // on this.index. Exposed so render code (HUD, props, encounters)
    // can read the palette if it needs to match.
    this.theme = null;
    this.obstacles = [];
    this.decorations = [];
    this.exitGroup = null;
    this.exitBounds = null;
    this.rooms = [];
    this.playerSpawn = new THREE.Vector3();
    this.enemySpawns = [];
    this.npcs = [];
    // Lootable containers — each entry is { container, group, x, z, r }
    // where `r` is the proximity-radius the player must be inside to
    // interact. Cleared every regenerate.
    this.containers = [];
    // Keep-out discs that prop placement must avoid. Pushed by the
    // generator (boss exit, encounter spawn) and by encounters.js
    // (NPC podiums, ritual centers). Each entry: { x, z, r }. Cleared
    // every regenerate.
    this._keepouts = [];
    // Visible-footprint registry — every placed prop pushes its world-
    // space AABB here regardless of whether it has a collision proxy.
    // Used by `_propFootprintFree` to prevent overlap between decoration-
    // only props (rugs, lamps, vases, TVs) which the obstacle list
    // doesn't track. Without this, two rugs can stack, a bookshelf can
    // land on a rug, etc. Each entry: { minX, maxX, minZ, maxZ }.
    this._propFootprints = [];
    // Phase J — destructible-prop sequential id counter. Stamped on
    // every collision proxy whose kind is in DESTRUCTIBLE_HP so the
    // coop snapshot can name destroyed entries by id (smaller +
    // stable across host/joiner because gen runs the same seeded
    // RNG path on both peers, so order matches). Reset in clear().
    this._destructiblePropIdNext = 0;
    this.index = 0;
    this.bossRoomId = -1;
    // Registered ambient light sources (ceiling lamps, prop lamps,
    // emergency flares) used by lightLevelAt() to evaluate how lit a
    // point is. Stealth math reads from this each frame.
    this.lights = [];
    this._solidCache = null;
    this._solidDirty = true;
    this._visionCache = null;
    this._visionDirty = true;
    this._projectileObstacleGrid = null;
    this._projectileObstacleSource = null;
    // Spatial hash for _collidesAt — lazily (re)built whenever
    // _dirtySolid() flips the flag. Cuts level-gen pickOpen() from
    // O(spawns × walls) to O(spawns × bucket-size). Profiling on
    // L10/15/20 showed ~200k _collidesAt calls per generate; without
    // the grid 90% of gen time was a linear scan of ~400 obstacles
    // per call.
    this._collidesGrid = null;
    this._collidesDirty = true;
    this._collidesScratch = [];
    // Dev-time probe exposer — lets the playwright level-gen probe pull
    // rooms / obstacles / decorations without crawling the THREE.scene.
    if (typeof window !== 'undefined') window.__level = this;
  }

  clear() {
    // Encounter visuals — every def.spawn() returns a state object
    // whose properties point to Three.js objects (npc, label, disc,
    // light, brazier, flame, hint, etc.) added directly to scene.
    // Walk every room's encounter state and remove anything that's
    // an Object3D so encounter props don't accumulate across regens.
    for (const r of this.rooms || []) {
      const enc = r && r._encounter;
      if (!enc || !enc.state) continue;
      this._teardownEncounterState(enc.state);
      r._encounter = null;
      r._encounterPlaceholder = false;
      r._encounterSpawn = null;
    }
    // Wall proxies (added by the wall instancer) live in obstacles[]
    // but are NOT real scene-graph members — their visual is rendered
    // via per-color InstancedMesh objects owned by the instancer. The
    // teardown() below tears down the InstancedMeshes; per-proxy
    // dispose() is a no-op so the loop can run uniformly across real
    // meshes + proxies without a branch.
    for (const m of this.obstacles) {
      if (m.isWallProxy) continue;     // owned by wall_instancer.teardown()
      this.scene.remove(m);
      m.geometry.dispose();
      // Pooled materials live across levels — disposeIfNotShared keeps
      // them alive while still freeing per-instance allocations.
      disposeIfNotShared(m.material);
    }
    if (wallInstancer()) wallInstancer().teardown();
    // Visible prop groups — _registerProp adds these to the scene
    // separately from the collision proxy. Without this loop the
    // proxies got cleared above but the visible meshes stayed,
    // accumulating across levels and rendering as orphaned bookshelves
    // / serverRacks / cabinets sitting in the dark void outside any
    // room. Tracked in _cullableProps so we can iterate them without
    // a separate registry.
    for (const cp of this._cullableProps || []) {
      const grp = cp.obj;
      if (!grp) continue;
      this.scene.remove(grp);
      grp.traverse?.((obj) => {
        if (obj.geometry?.dispose) obj.geometry.dispose();
        if (obj.material) disposeIfNotShared(obj.material);
      });
    }
    for (const m of this.decorations) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) disposeIfNotShared(m.material);
    }
    for (const npc of this.npcs) this.scene.remove(npc.group);
    for (const c of this.containers) this.scene.remove(c.group);
    this.obstacles = [];
    this.decorations = [];
    this.npcs = [];
    this.containers = [];
    this._keepouts = [];
    this._propFootprints = [];
    // Reset destructible-prop id counter — host + joiner walk the
    // same seeded gen path so ids assigned during placement match
    // 1:1, but we still wipe between floors so a previous run's
    // ids don't leak.
    this._destructiblePropIdNext = 0;
    if (this.exitGroup) {
      this.scene.remove(this.exitGroup);
      this.exitGroup = null;
    }
    this.rooms = [];
    this.enemySpawns = [];
    this.lights = [];
    this._roomLamps = [];
    this._cullableProps = [];
    this.exitBounds = null;
    // REGRESSION: mega-boss arenas had no exit because revealExit() saw
    // a stale exitRoom reference from the previous floor and took its
    // primary path (calling .reveal() on disposed meshes), bypassing the
    // legacy ring fallback that generateMegaArena stages via
    // _exitPendingBounds. Reset both here so subsequent gen paths start
    // clean and revealExit picks the right branch per floor.
    this.exitRoom = null;
    this._exitPendingBounds = null;
    this.bossRoomId = -1;
    this._solidCache = null;
    this._solidDirty = true;
    this._visionCache = null;
    this._visionDirty = true;
    this._projectileObstacleGrid = null;
    this._projectileObstacleSource = null;
    // Spatial hash for _collidesAt — lazily (re)built whenever
    // _dirtySolid() flips the flag. Cuts level-gen pickOpen() from
    // O(spawns × walls) to O(spawns × bucket-size). Profiling on
    // L10/15/20 showed ~200k _collidesAt calls per generate; without
    // the grid 90% of gen time was a linear scan of ~400 obstacles
    // per call.
    this._collidesGrid = null;
    this._collidesDirty = true;
    this._collidesScratch = [];
    // Pass 1C state — windows / connectors / ledges. Cleared every
    // regen so previous-floor refs don't leak into the new floor.
    this._windows = [];
    this._connectors = [];
    this.ledges = [];
  }

  // Phase M — wraps _generateBody with a hard walkability gate. After
  // each build, checkRealWalkability() floods from the player spawn
  // through the actual collision geometry. If any room is unreachable
  // we retry up to 3 times with a remixed seed; if all retries fail,
  // we degrade each unreachable room's shape to 'rect' and rebuild.
  // Final fallback (rare): accept the broken level + log critical so
  // the player can file a bug. Never crash gen.
  generate() {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Mix the seed for retries by perturbing Math.random() — we're
      // inside main.js's _withRunSeed wrapper so re-seeding the same
      // mulberry32 stream with a per-attempt salt produces a fresh
      // deterministic layout. attempt=0 keeps the original seed so
      // the common case (no retry) is byte-for-byte identical.
      let restoreRand = null;
      if (attempt > 0) {
        const orig = Math.random;
        const SALT = (0x9E3779B1 * attempt) >>> 0;
        let s = SALT;
        Math.random = () => {
          s = (s + 0x6D2B79F5) >>> 0;
          let t = s;
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        restoreRand = () => { Math.random = orig; };
      }
      try {
        this._generateBody();
      } finally {
        if (restoreRand) restoreRand();
      }
      // Tutorial / mega-arena paths bypass the chain generator; they
      // build their own room layout via _generateBody → generateTutorial
      // / generateMegaArena and don't need the walkability retry.
      if (typeof window !== 'undefined' && window.__tutorialMode && window.__tutorialMode()) {
        return;
      }
      let result = null;
      try {
        result = this.checkRealWalkability();
        if (typeof window !== 'undefined') window.__lastWalkabilityCheck = result;
      } catch (err) {
        console.warn('[level] checkRealWalkability threw:', err);
        return;   // accept whatever was built; don't loop on a probe bug
      }
      if (result.ok) {
        if (attempt > 0) {
          console.log(`[level] walkability OK after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}`);
        }
        return;
      }
      console.warn(`[level] checkRealWalkability FAIL (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        result.unreachable);
      if (attempt < MAX_RETRIES) {
        // Roll back so the next pass starts from a clean state. clear()
        // disposes scene objects, re-zeros obstacles, and the index
        // bump in _generateBody is what we want to undo (each retry
        // counts as the same floor). Decrement here so the next
        // _generateBody++ lands us back on this floor's index.
        this.clear();
        this.index -= 1;
        continue;
      }
      // Degrade: every unreachable chain room → rect. Run one final
      // _generateBody with a flag the body checks. Only degrade real
      // rooms (id >= 0); synthetic ones (extraction id=-1) can't be
      // degraded.
      const ids = result.unreachable.map(u => u.id).filter(id => id >= 0);
      console.warn('[level] degrading unreachable rooms to rect:', ids);
      this.clear();
      this.index -= 1;
      this._forceRectIds = new Set(ids);
      this._generateBody();
      this._forceRectIds = null;
      try {
        const final = this.checkRealWalkability();
        if (final.ok) {
          console.log('[level] walkability OK after degrade');
        } else {
          console.error('[level] CRITICAL: walkability still failing after degrade — accepting broken level',
            final.unreachable);
        }
        if (typeof window !== 'undefined') window.__lastWalkabilityCheck = final;
      } catch (_) { /* defensive */ }
      return;
    }
  }

  _generateBody() {
    this.clear();
    this.index += 1;
    // Wall instancer — fresh per generate() so per-color pools start
    // empty. clear() tore down the previous instancer; this re-init
    // creates a new one bound to the same scene.
    initWallInstancer(this.scene);
    // Tutorial mode override — build the practice room layout
    // instead of random-walking a normal chain.
    if (typeof window !== 'undefined' && window.__tutorialMode && window.__tutorialMode()) {
      return this.generateTutorial();
    }
    // Pick + apply this floor's visual theme. Tints walls, outer
    // walls, and low cover. The base 300×300 ground stays dark so
    // out-of-bounds (anywhere not under a per-room floor patch)
    // reads as void; per-room patches added later in _addRoomFloorPatch
    // take over the visible floor with the biome's color.
    this.theme = getLevelTheme(this.index);
    if (this.theme) {
      FULL_WALL_COLOR  = this.theme.wall;
      OUTER_WALL_COLOR = _darkenHex(this.theme.wall, 0.55);
      LOW_COVER_COLOR  = _darkenHex(this.theme.wall, 0.30);
      if (this.ground && this.ground.material && this.ground.material.color) {
        // Hold the ground at near-black regardless of biome — the
        // void underneath the level. Per-room patches paint the
        // playable area on top.
        this.ground.material.color.setHex(0x05060a);
      }
    }

    // --- Layout: random-walk chain so each level bends differently --------
    // Combat-room count grows with level. Retuned 2026-05-06 after
    // playtest: "early levels feel too 'big' now ... we had it at a
    // pretty sweet spot before we did the level overhaul. ~5 rooms
    // to start and steadily getting larger as we go felt about
    // right." Retuned slope is gentler — start lean, grow steadily:
    //   L1:  1-2 combat → 3-4 main rooms (+ ~1-2 side = 4-6 total)
    //   L3:  2-3 combat → 4-5 main
    //   L5:  3-4 combat → 5-6 main
    //   L10: 5-6 combat → 7-8 main
    //   L15: 6-7 combat → 8-9 main
    //   L20+:7-8 combat → 9-10 main (capped)
    const lvIdx = Math.max(1, this.index || 1);
    const minCombat = 1 + Math.min(6, Math.floor((lvIdx - 1) / 2));
    const maxCombat = 2 + Math.min(6, Math.floor((lvIdx - 1) / 2));
    const combatCount = minCombat + Math.floor(Math.random() * (maxCombat - minCombat + 1));
    const totalMain = 1 + combatCount + 1; // start + combats + boss
    const rooms = [];
    const pitch = ROOM_W + WALL_THICK;
    const DIR_DELTA = {
      east:  { dx:  1, dz:  0 },
      west:  { dx: -1, dz:  0 },
      north: { dx:  0, dz: -1 },
      south: { dx:  0, dz:  1 },
    };

    // Random walk the chain. We disallow immediate reverse to keep rooms
    // laid out without overlapping back on themselves; occupied cells block
    // revisits either way. Cells are also clamped to a box (CELL_MAX) so
    // the layout stays inside the ground plane bounds.
    const usedCells = new Set();
    const cells = [{ cx: 0, cz: 0 }];
    usedCells.add('0,0');
    let lastDir = null;
    const opposite = { east: 'west', west: 'east', north: 'south', south: 'north' };
    // Ground plane is 300x300 centered on origin (see scene.js). A cell is
    // `pitch` units wide, so clamping to ±4 keeps the farthest room edge
    // well within bounds even after branches and double-wide rooms.
    const CELL_MAX = 4;

    for (let i = 1; i < totalMain; i++) {
      const options = ['east', 'north', 'south', 'west'].filter(d => d !== (lastDir && opposite[lastDir]));
      // shuffle
      for (let k = options.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [options[k], options[j]] = [options[j], options[k]];
      }
      // Prefer straight lines ~50% of the time by biasing toward lastDir.
      if (lastDir && Math.random() < 0.5 && options.includes(lastDir)) {
        options.splice(options.indexOf(lastDir), 1);
        options.unshift(lastDir);
      }
      let placed = false;
      const prev = cells[cells.length - 1];
      for (const d of options) {
        const { dx, dz } = DIR_DELTA[d];
        const nx = prev.cx + dx, nz = prev.cz + dz;
        if (Math.abs(nx) > CELL_MAX || Math.abs(nz) > CELL_MAX) continue;
        const key = `${nx},${nz}`;
        if (usedCells.has(key)) continue;
        cells.push({ cx: nx, cz: nz, dirFromPrev: d });
        usedCells.add(key);
        lastDir = d;
        placed = true;
        break;
      }
      if (!placed) break; // extremely rare — boxed in
    }
    this._cellMax = CELL_MAX;

    // Instantiate room objects from cell positions.
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const type = i === 0 ? 'start' : (i === cells.length - 1 ? 'boss' : 'combat');
      // Layout variant — only combat rooms roll non-'open' layouts since
      // the start/boss/merchant rooms have their own built-in furnishing.
      let layout = 'open';
      if (type === 'combat') {
        // Weighted layout picker per the level-gen overhaul design.
        // Targets layout VARIETY — at least 6 distinct layouts on a
        // typical 8-12 room level. 'corridor' is moved here from the
        // giant-room mutation step so corridor-shaped combat rooms
        // exist regardless of giant-extension. lshape/closet/bunker
        // are intentionally dropped from the rotation — playtest
        // surfaced that they cornered the player too often.
        const r = Math.random();
        if      (r < 0.16) layout = 'open';
        else if (r < 0.24) layout = 'columns-4';
        else if (r < 0.32) layout = 'columns-6';
        else if (r < 0.39) layout = 'columns-cross';
        else if (r < 0.46) layout = 'split';
        else if (r < 0.52) layout = 'hallway';
        else if (r < 0.58) layout = 'partition';
        else if (r < 0.66) layout = 'corridor';
        else if (r < 0.72) layout = 'pillars-grid';
        else if (r < 0.77) layout = 'alcove';
        else if (r < 0.81) layout = 'center-pit';
        else if (r < 0.84) layout = 'zigzag';
        // New tactical layouts — emphasize cover + flanking lanes
        // rather than long divider walls. Together they account for
        // ~16% of combat rooms so the new geometry surfaces often
        // enough to feel like part of the rotation.
        else if (r < 0.88) layout = 'pillar-ring';
        else if (r < 0.92) layout = 'kill-box';
        else if (r < 0.96) layout = 'central-cover';
        else               layout = 'flank-pockets';
      } else if (type === 'boss') {
        // Boss room layout — 50/50 split between dedicated boss
        // arenas and wider combat layouts so bosses surface in many
        // different room types. Cramped variants (closet, alcove)
        // are explicitly excluded; partition can corner the boss
        // depending on door placement so it's also out. The
        // remaining pool guarantees enough open floor for the boss
        // to reposition without getting cornered against a wall —
        // critical safety promise the user called out.
        if (Math.random() < 0.5) {
          const bossPool = ['columns-6', 'columns-cross',
                            'boss-arena', 'boss-pillars', 'boss-perch'];
          layout = bossPool[Math.floor(Math.random() * bossPool.length)];
        } else {
          const altPool = ['open', 'split', 'hallway', 'lshape',
                           'bunker', 'pillars-grid', 'center-pit', 'zigzag'];
          layout = altPool[Math.floor(Math.random() * altPool.length)];
        }
      }
      rooms.push({
        id: i,
        type,
        layout,
        bounds: this._rectAt(c.cx * pitch, c.cz * pitch, ROOM_W, ROOM_H),
        cx: c.cx * pitch,
        cz: c.cz * pitch,
        cellX: c.cx, cellZ: c.cz,
        neighbors: [],
        cleared: type === 'start',
        entered: type === 'start',
        // Start rooms get an *interior* elevator box that holds the player
        // in a small space until they open its door. The box sits inside
        // full-size bounds so there are no exterior gaps.
        hasElevator: type === 'start',
      });
    }
    // Link consecutive chain rooms via the recorded direction.
    for (let i = 1; i < cells.length; i++) {
      this._linkRooms(rooms[i - 1], rooms[i], cells[i].dirFromPrev);
    }

    // Boss-room doubling — 35% chance to stretch the boss into an adjacent
    // free cell on the side opposite its entry. Perimeter + door builders
    // are neighbor-centric so asymmetric bounds still align with doors.
    const bossIdx = cells.length - 1;
    const bossCell = cells[bossIdx];
    if (bossCell && Math.random() < 0.35) {
      const entry = bossCell.dirFromPrev;
      // OPP maps the entry direction to the OPPOSITE offset — the boss
      // extends AWAY from the chain. Previously this table held the
      // same-direction offsets (east→+X, west→-X, …), which marked the
      // WRONG cell as used in `usedCells`: bounds extended one way and
      // the flag landed on the opposite cell. Branch placement would
      // then plant a new room on top of the boss extension, producing
      // the overlapping-rooms bug that shows up as a stray wall
      // cutting through the boss room.
      const OPP = { east:  { dx: -1, dz:  0 },
                    west:  { dx:  1, dz:  0 },
                    north: { dx:  0, dz:  1 },
                    south: { dx:  0, dz: -1 } };
      const opp = OPP[entry];
      if (opp) {
        const exX = bossCell.cx + opp.dx;
        const exZ = bossCell.cz + opp.dz;
        if (!usedCells.has(`${exX},${exZ}`)
            && Math.abs(exX) <= this._cellMax
            && Math.abs(exZ) <= this._cellMax) {
          usedCells.add(`${exX},${exZ}`);
          const boss = rooms[bossIdx];
          // Extend bounds into the opposite cell without moving cx/cz so
          // the existing door stays anchored to the previous room.
          if (entry === 'west') boss.bounds.maxX += pitch;
          else if (entry === 'east') boss.bounds.minX -= pitch;
          else if (entry === 'north') boss.bounds.maxZ += pitch;
          else if (entry === 'south') boss.bounds.minZ -= pitch;
          boss.doubled = true;
        }
      }
    }

    // Combat-room size variety — extend 25% of combat rooms over an
    // extra cell on a perpendicular axis, matching the boss-doubling
    // technique. Produces "giant rooms" and "long halls" without
    // breaking doorway alignment. We skip rooms with existing
    // perpendicular neighbors so the extension doesn't collide.
    const DIRS4 = [
      { dx:  1, dz:  0, name: 'east',  oppose: 'west'  },
      { dx: -1, dz:  0, name: 'west',  oppose: 'east'  },
      { dx:  0, dz: -1, name: 'north', oppose: 'south' },
      { dx:  0, dz:  1, name: 'south', oppose: 'north' },
    ];
    for (let ri = 1; ri < rooms.length - 1; ri++) {
      const room = rooms[ri];
      if (room.type !== 'combat') continue;
      if (Math.random() >= 0.25) continue;
      // Candidate extension dirs — anywhere we have a free neighbour
      // cell and no existing door on that side (don't trample links).
      const taken = new Set(room.neighbors.map(n => n.dir));
      const candidates = DIRS4.filter(({ dx, dz, name }) => {
        if (taken.has(name)) return false;
        const ex = room.cellX + dx, ez = room.cellZ + dz;
        if (Math.abs(ex) > this._cellMax || Math.abs(ez) > this._cellMax) return false;
        return !usedCells.has(`${ex},${ez}`);
      });
      if (candidates.length === 0) continue;
      const ext = candidates[Math.floor(Math.random() * candidates.length)];
      const ex = room.cellX + ext.dx, ez = room.cellZ + ext.dz;
      usedCells.add(`${ex},${ez}`);
      if (ext.name === 'east')       room.bounds.maxX += pitch;
      else if (ext.name === 'west')  room.bounds.minX -= pitch;
      else if (ext.name === 'north') room.bounds.minZ -= pitch;
      else                           room.bounds.maxZ += pitch;  // south
      room.giant = true;
      // About half of the extended rooms become "corridors" — an
      // interior pass narrows the perpendicular axis so they read
      // as long halls instead of giant squares. Skip if the room
      // already rolled into one of the layouts the corridor pass
      // would override (the new weighted picker covers corridor too,
      // so we only force-corridor when the rolled layout would feel
      // wrong on a stretched cell).
      if (Math.random() < 0.5 && (room.layout === 'open' || room.layout === 'columns-4'
          || room.layout === 'columns-6' || room.layout === 'columns-cross')) {
        room.layout = 'corridor';
      }
    }

    // Branch rooms: pick a chain room with an unused cardinal neighbour and
    // attach there. Each chain room gets at most one branch.
    const freeDirsFor = (room) => {
      const used = new Set(room.neighbors.map(n => n.dir));
      return ['east', 'west', 'north', 'south'].filter((d) => {
        if (used.has(d)) return false;
        const { dx, dz } = DIR_DELTA[d];
        const nx = room.cellX + dx, nz = room.cellZ + dz;
        if (Math.abs(nx) > this._cellMax || Math.abs(nz) > this._cellMax) return false;
        return !usedCells.has(`${nx},${nz}`);
      });
    };
    const addBranch = (type) => {
      // Pick a chain room (excluding start/boss, and excluding rooms already branched).
      const chainMid = rooms.slice(1, cells.length - 1).filter(r => !r._hasBranch);
      for (let tries = 0; tries < 6 && chainMid.length; tries++) {
        const pick = chainMid[Math.floor(Math.random() * chainMid.length)];
        const free = freeDirsFor(pick);
        if (!free.length) continue;
        const dir = free[Math.floor(Math.random() * free.length)];
        const { dx, dz } = DIR_DELTA[dir];
        const nx = pick.cellX + dx, nz = pick.cellZ + dz;
        usedCells.add(`${nx},${nz}`);
        pick._hasBranch = true;
        const room = {
          id: rooms.length,
          type,
          layout: 'open',
          bounds: this._rectAt(nx * pitch, nz * pitch, ROOM_W, ROOM_H),
          cx: nx * pitch, cz: nz * pitch,
          cellX: nx, cellZ: nz,
          neighbors: [],
          cleared: type !== 'subBoss',
          entered: false,
        };
        rooms.push(room);
        this._linkRooms(pick, room, dir);
        return room;
      }
      return null;
    };

    if (Math.random() < 0.85) addBranch('subBoss');
    // Track shop placements so we can guarantee at least one shop room
    // per level. With 8 independent rolls (merchant 70%, healer 50%,
    // gunsmith 35%, armorer 30%, tailor 25%, relicSeller 18%,
    // blackMarket 12%) the probability of every roll failing is small
    // (~2.6%) but non-zero, plus addBranch can silently fail when no
    // free door is available — bug #47 ("sometimes there is no shop").
    // Force a merchant placement at the end if nothing landed.
    let shopPlaced = false;
    const tryShop = (type, p) => {
      if (Math.random() < p) {
        if (addBranch(type)) shopPlaced = true;
      }
    };
    tryShop('merchant', 0.70);
    tryShop('healer', 0.50);
    // Specialty scatter rooms — each independently rolled so players see
    // different shop lineups between runs.
    tryShop('gunsmith', 0.35);
    tryShop('armorer', 0.30);
    tryShop('tailor', 0.25);
    tryShop('relicSeller', 0.18);
    tryShop('blackMarket', 0.12);
    // Treasure room — competes in the same roll as shops. Always
    // locked behind a keycard (see _assignKeycards prioritisation
    // below), filled with chests + lootable props that always
    // contain loot, with a slight rarity bias on top of the level
    // scalar. User: "stores are spawning almost every single level.
    // i think some of these should be replaced with loot/treasure
    // rooms locked behind the keycard doors. ... compete in the
    // same roll - it should just take the current chests and props
    // and fill the room with them, however these containers in
    // the treasure room should always have loot in them. slightly
    // higher chance of better items and gear."
    tryShop('treasure', 0.32);
    // Rare bear merchant branch — 25% per level. Doesn't satisfy the
    // shop guarantee (it's a bonus, not the regular merchant rotation).
    if (Math.random() < 0.25) addBranch('bearMerchant');
    // Guarantee at least one regular shop room. Falls back through the
    // shop types in order until one of them places (addBranch can
    // return null when the level is door-saturated).
    if (!shopPlaced) {
      for (const type of ['merchant', 'healer', 'gunsmith', 'armorer',
                          'tailor', 'relicSeller', 'blackMarket']) {
        if (addBranch(type)) { shopPlaced = true; break; }
      }
    }

    this.rooms = rooms;
    this.bossRoomId = rooms.find(r => r.type === 'boss').id;

    // Encounter conversion is deferred until AFTER interior walls + cover
    // are built (see `_pickAndMarkEncounterRoom` below). Without that
    // delay we couldn't validate that the room's encounter spawn point
    // is walkable, and lshape / partition / pillars-grid / center-pit
    // layouts placed the floor disc inside an interior wall.

    // Pass 1A — pick a shape per room. Default rect preserves the
    // pre-overhaul behavior; non-rect shapes override _buildRoomPerimeter
    // with their own outer + interior wall layout. Shape selection is
    // weighted per room.type by level_shapes.js. Shape build() output
    // (walkableBounds) is stashed on the room for the flood-fill
    // invariant check to consume.
    for (const room of rooms) {
      room.shape = pickShapeForRoom(room);
      // Tutorial rooms / synthetic rooms (extraction etc.) keep rect.
      // Giant or doubled rooms also stay rect — the shape templates
      // assume single-cell footprints and would tile poorly across a
      // 2-cell extension.
      if (room.giant || room.doubled) room.shape = 'rect';
      // Phase M degrade pass — generate() retry-on-fail forces these
      // ids back to 'rect' to recover from a wedged shape combination.
      if (this._forceRectIds && this._forceRectIds.has(room.id)) {
        room.shape = 'rect';
      }
    }

    // --- Build walls + doors ----------------------------------------------
    const builtPairs = new Set();
    for (const room of rooms) this._buildRoomPerimeter(room);
    for (const room of rooms) {
      for (const n of room.neighbors) {
        const key = [Math.min(room.id, n.otherId), Math.max(room.id, n.otherId)].join('-');
        if (builtPairs.has(key)) continue;
        builtPairs.add(key);
        this._buildDoor(room, rooms[n.otherId], n.dir);
      }
    }

    // --- Pass 1C — buildings + connectors + windows + ledges -----------
    // Tag every room with a building identity (default 'A'; level
    // index >= 3 may split into A/B). Then for each cross-building
    // edge, build a skybridge / connector. Then walk exterior walls
    // and replace 1-2 segments with windows + ledges so players can
    // shoot through and mantle around.
    try {
      assignBuildings(this);
      const connectorEdges = connectorEdgesFor(this);
      this._connectors = [];
      for (const edge of connectorEdges) {
        const conn = buildSkybridge(this, edge.fromRoom, edge.toRoom, edge.kind);
        if (conn) {
          this.rooms.push(conn);
          this._connectors.push(conn);
        }
      }
      // Windows + ledges along exterior walls.
      this._windows = [];
      this._addExteriorWindowsAndLedges();
      this._dirtySolid();
    } catch (err) {
      // Non-fatal — Pass 1C is purely additive on top of the cell
      // graph; if anything throws, fall back to vanilla rooms.
      console.warn('[level] Pass 1C wiring threw:', err);
    }

    // Interior variants (split walls, narrowing hallways) go up before the
    // cover scatter so that cover can avoid placing inside interior walls.
    //
    // Pass 1A: SHAPE rooms (lShape, rotunda, gallery, courtyard, ...)
    // skip the WALL-building interior layouts because the shape
    // template owns its perimeter + walkable polygon and a divider
    // wall could clobber its walkability (e.g. a 'split' wall
    // through a rotunda's chamfered corner). But COLUMN decorations
    // are point obstacles, not walls, so they're safe to layer on
    // top of any shape — `_decorateColumns` validates each candidate
    // against walkable bounds before placing.
    //
    // Earlier this whole block was `continue`-ed for shape rooms,
    // which silently dropped columns whenever a shape room got a
    // column-* layout — playtest noticed many levels had no pillars.
    // Layout buckets:
    //   WALL_LAYOUTS — build long interior walls (split's divider,
    //     hallway pinch, alcove L). UNSAFE for shape rooms — would
    //     clip the shape's own perimeter / cut-out.
    //   PILLAR_LAYOUTS — pure point obstacles (pillar grids, kill-box
    //     cover blocks, central cover). SAFE for shape rooms because
    //     each placement validates via _blocksDoor + _collidesAt; the
    //     `_buildInterior` post-pass also gets a walkable-bounds
    //     filter at the inner level via `_collidesAt` catching shape
    //     walls. The remaining risk is a pillar landing in a shape
    //     cut-out (lShape's empty quadrant) — accepted as a rare edge
    //     case; the pillar is solid+visible but inside the void, so
    //     it doesn't block gameplay.
    const WALL_LAYOUTS = new Set([
      'split', 'hallway', 'lshape', 'corridor', 'partition',
      'closet', 'bunker', 'alcove', 'center-pit', 'zigzag', 'boss-arena',
    ]);
    const PILLAR_LAYOUTS = new Set([
      'pillars-grid', 'boss-pillars', 'boss-perch',
      'pillar-ring', 'kill-box', 'central-cover', 'flank-pockets',
    ]);
    for (const room of rooms) {
      const isShape = !!(room.shape && room.shape !== 'rect');
      if (WALL_LAYOUTS.has(room.layout) && !isShape) {
        this._buildInterior(room);
      } else if (PILLAR_LAYOUTS.has(room.layout)) {
        // Pillar-only layouts run for both rect AND shape rooms.
        this._buildInterior(room);
      }
      if (room.layout === 'columns-4') this._decorateColumns(room, '4-corner');
      else if (room.layout === 'columns-6') this._decorateColumns(room, '6-line');
      else if (room.layout === 'columns-cross') this._decorateColumns(room, 'cross');
      if (room.hasElevator) this._buildElevator(room);
    }

    // Seed keep-out discs BEFORE every spawn pass (theme, cover,
    // container, sprinkle) so the boss-room exit ring — revealed
    // after boss death — never lands inside a low-cover block, a
    // chest, a pillar, or a couch. Exit lands at the boss centroid
    // with r=2.2; pad to 3.2m so the ring + player interact halo
    // both stay clear.
    {
      const boss = rooms[this.bossRoomId];
      if (boss) this._keepouts.push({ x: boss.cx, z: boss.cz, r: 3.2 });
    }

    // Themed props — pick a theme per combat-tier / shop room and drop
    // matching furniture against walls + interior anchors.
    //
    // Order matters: theme runs BEFORE cover + containers so its
    // wall-placement step has clean perimeter slots to choose from.
    // Earlier the order was layouts → cover → containers → theme,
    // which left theme templates competing with 1-2 random cover
    // blocks and a chest for wall slots and dropped placement to
    // ~3 props per room. Cover + containers run after now and avoid
    // theme props via the same _collidesAt rejection they already
    // used for layouts. Encounter rooms stay intentionally empty
    // (the encounter NPC + props are placed by main.js after gen).
    const SHOP_TYPES = new Set(['merchant', 'healer', 'gunsmith',
      'armorer', 'tailor', 'relicSeller', 'blackMarket']);
    for (const room of rooms) {
      if (room.type === 'combat' || room.type === 'subBoss'
          || room.type === 'boss' || SHOP_TYPES.has(room.type)) {
        this._themeRoom(room);
      }
    }

    // _scatterCover is disabled by default. User has reported
    // repeatedly (most recently F3 dump 2026-05-07) that the
    // anonymous low-cover blocks it drops feel like phantom thin
    // walls — they're untagged 1-2.5m × 0.8-2m boxes at chest
    // height with `kind: null`, and the player can't tell what
    // they're supposed to be. The theme-room props (desks, crates,
    // bookshelves, planters, pillars, etc.) already provide
    // identified cover. Opt-in via localStorage so the function
    // stays available for testing without re-introducing the bug.
    const _scatterCoverOn = (() => {
      try {
        return typeof localStorage !== 'undefined'
          && localStorage.getItem('coldExitScatterCover') === '1';
      } catch (_) { return false; }
    })();
    if (_scatterCoverOn) {
      for (const room of rooms) {
        if (room.type === 'start') continue;
        this._scatterCover(room);
      }
    }

    // Lootable containers — boxes / chests scattered through combat
    // and boss rooms. Density scales with room area; types and sizes
    // are rolled per spawn slot. Body drops were trimmed in this same
    // pass, so containers carry the bulk of the loot now.
    for (const room of rooms) {
      if (room.type === 'start') continue;
      this._scatterContainers(room);
    }

    // Per-room floor patches — biome-tinted plane covering each
    // room's interior. Hides the dark base ground; serves as cheap
    // per-room mood lighting via the patch's emissive tint without
    // adding more real lights to the shader. Out-of-bounds (any
    // area not under a patch) shows the dark base ground = void.
    // Skip synthetic rooms (id < 0) — extraction room is hidden
    // until boss death and adds its own floor as part of the reveal,
    // and skybridge connectors render their own walkway geometry.
    for (const room of rooms) {
      if (room.id < 0) continue;
      this._addRoomFloorPatch(room);
    }
    // Ambient lighting pass — every themed / combat room gets a
    // ceiling lamp roughly at its centre. Adds both a visible mesh
    // (small recessed spot) and a registered entry in this.lights
    // that the stealth math reads from.
    for (const room of rooms) {
      if (room.type === 'start') continue;
      this._addCeilingLamp(room);
    }

    // Symmetric floor-lamp pass — drops 2-4 floor lamps in a
    // designed configuration (corners + optional centre) per non-
    // start room. Replaces the old random `placeInterior(lamp)`
    // sprinkle, which produced lamps strewn at unpredictable
    // positions. Skips any slot that overlaps walls / props /
    // keepouts so a lamp never spawns inside a couch.
    for (const room of rooms) {
      if (room.type === 'start') continue;
      this._decorateRoomLamps(room);
    }

    // Safety pass — any obstacle (interior wall, column, stray cover) that
    // overlaps a doorway centre gets its collision nulled. Outer walls
    // already have door-sized gaps by construction, so they're untouched;
    // doors themselves are excluded.
    this._clearDoorCorridors();

    // Perimeter-seal pass — walk every room's 4 outer edges with a
    // sample step and verify there's a wall/door obstacle at each
    // sample. Missed segments get plugged with a short outer-wall
    // block. Catches the "gap that leads outside" case that could
    // otherwise happen when a giant-room extension, perimeter-gap
    // and interior-layout combination leaves an uncovered span.
    this._sealRoomPerimeters();

    // Second corridor clear — the seal pass *should* honor door
    // keepouts, but if any pass after the first _clearDoorCorridors
    // accidentally leaves a collision box in a doorway, this second
    // sweep nulls it. Cheap (one iteration per door × obstacles) and
    // fully idempotent — obstacles already nulled stay nulled.
    this._clearDoorCorridors();

    // Final explicit pass — for every door, null the collision of any
    // obstacle whose AABB actually intersects the door's gap span,
    // regardless of colour / "onDoorEdge" heuristics. This catches the
    // reported case where a plug wall or flanking segment lands
    // directly in the doorway: the earlier passes preserve OUTER-
    // colour walls on the door axis under the assumption that they
    // only flank, but a misaligned one was still sitting in the gap.
    this._repairDoorOverlaps();

    // Deferred encounter conversion — picks one combat room and tags
    // it as an encounter ROOM. Runs HERE (after walls + interior +
    // cover) so we can validate the encounter spawn point is actually
    // walkable instead of landing inside an interior wall, an outer
    // wall, or off the playable map.
    this._pickAndMarkEncounterRoom();

    // Build the extraction chamber BEFORE the outer perimeter so the
    // bounding walls wrap both the chain rooms AND the extraction
    // room. Walls + door + props are added to obstacles immediately
    // (so AI can't path through them) but kept invisible until the
    // boss dies and revealExit() flips them on. The connecting door
    // stays LOCKED (collision intact) until reveal.
    try {
      const bossRoom = rooms[this.bossRoomId];
      if (bossRoom) {
        const exit = buildExtractionRoom(this, bossRoom);
        if (exit) {
          this.exitRoom = exit;
          // Register the extraction room in this.rooms so roomAt()
          // finds the player after they walk inside. id stays at -1
          // to mark it as synthetic (not part of the chain graph).
          this.rooms.push(exit.room);
          this._dirtySolid();
          // The extraction door drops INTO the boss room's existing
          // perimeter wall — the boss's perimeter (rect or shape) was
          // already built without knowing this door would be added.
          // The original wall there was a single full-edge solid wall
          // (boss had no chain neighbour on that side). Replace it
          // with two short flanking segments around the door so the
          // boss arena still reads as enclosed during the fight: the
          // door panel sits in the middle, flanking walls on either
          // side, and only the door drops on revealExit.
          this._splitBossWallForExtractionDoor(bossRoom, exit);
          // Sweep interior props / columns / cover that landed in
          // the new door corridor. The split-wall pass above
          // already handled the perimeter wall itself; this catches
          // anything else (boss-room interior cover that happened
          // to land near the chamber edge).
          this._clearDoorCorridors();
          // Defensive sweep — anything still straddling the door
          // gap (interior props, columns, etc.) gets nulled.
          this._repairDoorOverlaps();
        }
      }
    } catch (err) {
      // Defensive — extraction-room build is purely additive; if it
      // throws, log and fall back to the legacy ring marker.
      console.warn('[level] extraction-room build failed; falling back to legacy ring:', err);
    }

    // Outer bounding wall — a ring of tall outer-colour walls just
    // past the aggregate room bounds so the player can't escape to
    // the void when a boss room (or any edge room) fails to seal
    // fully. Additive with `_sealRoomPerimeters`; if that pass did
    // its job the outer walls sit slightly outside any existing wall
    // and are redundant, but they cap the "open to outside" bug at
    // worst.
    this._buildOuterPerimeter();

    // Sanity check — any two non-sibling rooms with overlapping AABBs
    // means the giant-extension / branch placement let two rooms
    // claim the same cell. This is the class of bug that produces
    // "wall cutting across the map" (the sealer ends up plugging an
    // interior edge of one room inside another room's play space).
    // Surface it in the console so it's noticed even without F2.
    //
    // SKIP synthetic rooms (id < 0 — currently the extraction room).
    // The extraction chamber sits flush against the boss-room outer
    // wall and the bounds-touch heuristic treats them as overlapping
    // even though there's a wall between them. Real chain-room
    // overlaps still surface here.
    const rs = this.rooms;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].id < 0) continue;
      for (let j = i + 1; j < rs.length; j++) {
        if (rs[j].id < 0) continue;
        const a = rs[i].bounds, b = rs[j].bounds;
        if (!a || !b) continue;
        if (a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ) {
          console.warn('[level] room overlap detected — likely cause of stray interior wall:',
            { a: i, b: j, aBounds: a, bBounds: b });
        }
      }
    }

    // Graph-connectivity sanity check. If any room is unreachable
    // through the door graph from the start room, log a warning with
    // the offending ids so the level can be inspected. Doesn't attempt
    // to repair — the generator topology always produces a tree, so a
    // failure here points at a code bug, not a random gen unlucky.
    //
    // The extraction room is intentionally NOT reachable until the
    // boss is cleared (its door is locked), so we skip the synthetic
    // id=-1 entry from the unreachable list.
    const conn = this.validateConnectivity();
    if (!conn.ok && conn.unreachable.length) {
      const real = conn.unreachable.filter(r => r.id >= 0);
      if (real.length) {
        console.warn('[level] unreachable rooms:', real.map(r => r.id),
          '— this is a generator bug, not bad luck');
      }
    }

    // --- Populate with enemies -------------------------------------------
    for (const room of rooms) this._populateRoom(room);

    // --- Player spawn — inside the elevator if the start room built one.
    const start = rooms[0];
    if (start.elevatorCenter) {
      this.playerSpawn.set(start.elevatorCenter.x, 0, start.elevatorCenter.z);
    } else {
      this.playerSpawn.set(start.cx, 0, start.cz);
    }

    // --- Exit: hidden until boss is killed -------------------------------
    // Legacy ring marker — kept as an emergency fallback ONLY if the
    // extraction-room construction failed (boss room had every wall
    // taken by neighbours). revealExit() prefers the extraction room
    // when this.exitRoom is set.
    const boss = rooms[this.bossRoomId];
    this._exitPendingBounds = { cx: boss.cx, cz: boss.cz, r: 2.2 };

    // Default unlock policy — every regular door is open from the
    // start of the level; player freedom of movement trumps the old
    // "clear to unlock" gating. A small set of doors (1-2 usually,
    // rarely 3-4 on high-difficulty levels) get key-gated instead —
    // see _assignKeycards below. The assigned doors stay locked with
    // a coloured tint until the player interacts with them holding
    // a matching key token.
    //
    // Extraction-room doors are EXPLICITLY excluded from this default
    // unlock — the boss-clear flow opens them via revealExit() so the
    // player can't reach the extraction zone before killing the boss.
    for (const mesh of this.obstacles) {
      if (mesh.userData.isDoor && !mesh.userData.isExtractionDoor) {
        this._openDoor(mesh);
      }
    }
    this._assignKeycards();

    // Decoration LOD — push every decoration that isn't already a
    // _cullableProps entry into the cullable set so the per-frame
    // proximity sweep (`updateDecorationCulling`) can hide it when
    // the player is far away. Lights are explicitly skipped — light
    // culling lives in `_roomLamps` + main.js's `updateRoomLightCulling`
    // which uses different radii. Window groups and ceiling-lamp
    // fixtures otherwise sit in the renderer's per-frame visit list
    // even when the player is in a room two cells away.
    this._registerDecorationsAsCullable();

    // Pass 1A pathway-invariant stamp. Result is read-only — purely
    // informational for the dev console / probe HTML / future smoke
    // harness. Wrapped in try/catch so a bad shape doesn't break
    // generate(); the warn surfaces the problem either way.
    try {
      const outdoor = this.runOutdoorInvariants();
      if (typeof window !== 'undefined') window.__lastOutdoorInvariantCheck = outdoor;
      if (!outdoor.ok) {
        console.warn('[level] Pass 1C outdoor-invariants FAIL:', outdoor.failures);
      }
    } catch (err) {
      console.warn('[level] runOutdoorInvariants threw:', err);
    }
    try {
      const inv = this.checkPathwayInvariants();
      if (typeof window !== 'undefined') window.__lastInvariantCheck = inv;
      if (!inv.ok) {
        console.warn('[level] pathway-invariants FAIL after generate:', inv.failures);
      }
    } catch (err) {
      console.warn('[level] checkPathwayInvariants threw:', err);
    }
  }

  // Walk an encounter state object and remove any Three.js
  // Object3D values from the scene + dispose their GPU resources.
  // Used by clear() so encounter visuals don't persist across level
  // regens. Skips non-Object3D fields (numbers, strings, arrays of
  // gunmen / spawned entity refs that are already managed by their
  // own managers, etc.). Recurses one level into nested objects so
  // grouped fields like `disc: { disc, light, cx, cz }` are reached.
  _teardownEncounterState(state, depth = 0) {
    if (!state || typeof state !== 'object') return;
    const _disposeObj = (v) => {
      if (!v || !v.isObject3D) return;
      try {
        if (v.parent) v.parent.remove(v);
        v.traverse?.((obj) => {
          if (obj.geometry?.dispose) obj.geometry.dispose();
          if (obj.material) disposeMaterialIfNotShared(obj.material);
        });
      } catch (_) { /* defensive — keep tearing down siblings */ }
    };
    for (const key of Object.keys(state)) {
      const v = state[key];
      if (!v) continue;
      if (typeof v === 'object' && v.isObject3D) {
        _disposeObj(v);
      } else if (Array.isArray(v)) {
        // Arrays of Object3D (An Epic stage props, future encounter
        // prop bundles) need tearing down too. Non-Object3D entries
        // are skipped (loot state, line indices, etc.).
        for (const item of v) _disposeObj(item);
      } else if (depth < 1 && typeof v === 'object') {
        this._teardownEncounterState(v, depth + 1);
      }
    }
  }

  // Encounter conversion + spawn-point validation. Runs after all
  // walls / interior / cover are placed so `_collidesAt` reflects
  // the final geometry. Picks ONE eligible combat room and stamps a
  // verified walkable centroid on it via `_encounterSpawn` for the
  // encounter visuals to anchor to.
  _pickAndMarkEncounterRoom() {
    const eligible = this.rooms.filter(r =>
      r.type === 'combat' && !r.giant && r.bounds);
    if (!eligible.length) return;
    // Encounter spawn chance — base 80% per level (raised from 30%
    // because the pool is large and levels run longer than original
    // tuning assumed; a player should hit an encounter most floors,
    // not once every three). main.js still bumps via
    // `level._encounterChance` (encounterChanceBonus stacks per
    // encounter-less level, capped at 95%, resets when one spawns).
    const chance = typeof this._encounterChance === 'number'
      ? this._encounterChance : 0.80;
    if (Math.random() >= chance) return;
    // Shuffle so we don't always favour earlier rooms when the first
    // candidate's centroid is blocked.
    const order = eligible.slice().sort(() => Math.random() - 0.5);
    for (const r of order) {
      const spawn = this._findEncounterSpawn(r);
      if (!spawn) continue;
      r.type = 'encounter';
      r._encounterPlaceholder = true;
      r._encounterSpawn = spawn;
      // Strip props / cover / containers from the encounter room so
      // the encounter visuals (disc, NPC, altar, etc.) don't have to
      // compete with random scatter for the player's attention. Walls
      // and doors stay — those define the room.
      this._clearEncounterRoom(r);
      return;
    }
    // Every candidate's centre was blocked — leave the level without
    // an encounter rather than spawn one on top of an interior wall.
  }

  // Remove every prop / low-cover obstacle / container inside the
  // encounter room's bounds, leaving walls and doors intact. Called
  // right after the room is picked so the encounter visuals own the
  // entire space.
  _clearEncounterRoom(room) {
    const b = room.bounds;
    const inRoom = (x, z) =>
      x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
    // PERIMETER walls only — interior walls (split's divider,
    // alcove's L, center-pit's ring, partition, hallway pinch,
    // pillars-grid stubs, kill-box flank cubes, etc.) all sit
    // INSIDE the room and have to go too. The encounter UI relies
    // on a clean floor so the player can read the disc / NPC /
    // ritual prop without competing geometry.
    //
    // Heuristic: a perimeter wall sits within ~1.5m of the room
    // bounds edge. Anything more than 1.5m inside is interior.
    // Tolerance leaves room for WALL_THICK (1.2m) plus a tiny
    // buffer for sealRoomPerimeters plugs that overhang slightly.
    const PERIM_TOL = 1.5;
    const isPerimeterPos = (x, z) =>
         Math.abs(x - b.minX) < PERIM_TOL || Math.abs(x - b.maxX) < PERIM_TOL
      || Math.abs(z - b.minZ) < PERIM_TOL || Math.abs(z - b.maxZ) < PERIM_TOL;
    const keptObstacles = [];
    for (const m of this.obstacles) {
      const px = m.position.x, pz = m.position.z;
      if (!inRoom(px, pz)) { keptObstacles.push(m); continue; }
      const ud = m.userData || {};
      if (ud.isDoor) { keptObstacles.push(m); continue; }
      // Elevator panels — tagged isElevatorWall — never strip.
      // Encounters never get assigned to an elevator room, but
      // belt-and-braces.
      if (ud.isElevatorWall) { keptObstacles.push(m); continue; }
      // Shape-template "edge" features — railings (courtyard's
      // parapet, plaza/catwalk safety rails). Without these the
      // courtyard's no-wall side becomes a floating gap. The
      // y < 1.0 height meant the perimeter-tall check below would
      // remove them. Tag-based keep handles it.
      if (ud.isRailing || ud.isFallGuard) { keptObstacles.push(m); continue; }
      // Columns / pillars — explicitly stripped (any layout that
      // produced columns now leaves the encounter floor clean).
      // _addColumn uses real meshes, but `pillars-grid` etc.
      // route their stub pillars through _addObstacle (which goes
      // through the instancer) and tag them isColumn — those are
      // wall-instancer proxies, where scene.remove is a no-op.
      if (ud.isColumn) {
        // Belt-and-braces — null collisionXZ in addition to dropping
        // from this.obstacles. If anything still references the proxy
        // (cached list, stale grid index between rebuilds), the
        // collision check can't fire on a null bounds.
        ud.collisionXZ = null;
        if (m.isWallProxy) {
          m.visible = false;
        } else {
          this.scene.remove(m);
          m.geometry?.dispose?.();
          if (m.material) disposeMaterialIfNotShared(m.material);
        }
        continue;
      }
      // Wall vs interior obstacle — the prior heuristic was just
      // "y >= 1.0" which kept interior split / partition / alcove
      // walls. Now a wall must ALSO be on the room perimeter to
      // survive. Anything tall in the interior gets torn down.
      const isTall = !ud.isProp && !ud.containerRef && m.position.y >= 1.0;
      if (isTall && isPerimeterPos(px, pz)) {
        keptObstacles.push(m);
        continue;
      }
      // Interior wall / prop / cover / container — tear down.
      // Wall-instancer proxies aren't in the scene graph (the
      // pool's InstancedMesh is), so scene.remove() on the proxy
      // is a no-op. We have to flip `visible = false` to reach
      // the proxy's setter, which zero-scales the slot in the
      // InstancedMesh.
      //
      // Belt-and-braces — null collisionXZ in addition to dropping
      // from this.obstacles, in case any cached list still
      // references the proxy.
      ud.collisionXZ = null;
      if (m.isWallProxy) {
        m.visible = false;
      } else {
        this.scene.remove(m);
        m.geometry?.dispose?.();
        if (m.material) disposeMaterialIfNotShared(m.material);
      }
      // Visible prop group lives separate from the proxy when it was
      // registered via _registerProp.
      const grp = ud.propGroup;
      if (grp) {
        this.scene.remove(grp);
        grp.traverse?.((obj) => {
          if (obj.geometry?.dispose) obj.geometry.dispose();
          if (obj.material) disposeMaterialIfNotShared(obj.material);
        });
      }
    }
    this.obstacles = keptObstacles;
    this._dirtySolid();
    // Containers list — drop any whose center sits inside the room.
    if (this.containers && this.containers.length) {
      const keptContainers = [];
      for (const c of this.containers) {
        if (inRoom(c.x, c.z)) {
          this.scene.remove(c.group);
          c.group?.traverse?.((obj) => {
            if (obj.geometry?.dispose) obj.geometry.dispose();
            if (obj.material) disposeMaterialIfNotShared(obj.material);
          });
        } else {
          keptContainers.push(c);
        }
      }
      this.containers = keptContainers;
    }
    // Decorations (purely visual props w/ no collision) inside the
    // room — drop those too so the floor reads clean.
    //
    // EXCEPT the per-room floor patch — without it the dark base
    // ground shows through and the encounter room reads as a pitch-
    // black hole on the level map. The patch is still wanted; the
    // encounter visuals (disc, NPC, prop) sit on top of it. Same
    // for the ceiling lamp fixture — encounters need their ambient
    // light pool.
    if (this.decorations && this.decorations.length) {
      const keptDecor = [];
      for (const d of this.decorations) {
        const px = d.position?.x, pz = d.position?.z;
        if (typeof px === 'number' && inRoom(px, pz)) {
          const k = d.userData?.kind;
          if (k === 'room-floor' || k === 'ceiling-lamp-fixture'
              || k === 'ceiling-lamp-light' || k === 'ceiling-lamp-target') {
            keptDecor.push(d);
            continue;
          }
          this.scene.remove(d);
          d.geometry?.dispose?.();
          if (d.material) disposeMaterialIfNotShared(d.material);
        } else {
          keptDecor.push(d);
        }
      }
      this.decorations = keptDecor;
    }
  }

  // Search for a walkable point inside a room's bounds, biased toward
  // the bounds-centre. Returns { x, z } or null. The encounter floor
  // disc is ~3.6m radius; we test a 1.6m clearance to leave room for
  // the disc + the prop in the middle without intersecting walls.
  _findEncounterSpawn(room) {
    const b = room.bounds;
    const baseX = (b.minX + b.maxX) / 2;
    const baseZ = (b.minZ + b.maxZ) / 2;
    const insetX = Math.max(2.0, (b.maxX - b.minX) * 0.18);
    const insetZ = Math.max(2.0, (b.maxZ - b.minZ) * 0.18);
    const minX = b.minX + insetX, maxX = b.maxX - insetX;
    const minZ = b.minZ + insetZ, maxZ = b.maxZ - insetZ;
    const inBounds = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
    const CLEAR = 2.0;
    if (inBounds(baseX, baseZ) && !this._collidesAt(baseX, baseZ, CLEAR)) {
      return { x: baseX, z: baseZ };
    }
    // Spiral outward in 1m steps + 8 angular samples. ~6m radius is
    // enough for any room we'd convert.
    for (let r = 1; r <= 6; r++) {
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
        const x = baseX + Math.cos(ang) * r;
        const z = baseZ + Math.sin(ang) * r;
        if (!inBounds(x, z)) continue;
        if (this._collidesAt(x, z, CLEAR)) continue;
        return { x, z };
      }
    }
    return null;
  }

  // Flag specific branch doors as key-gated. Pick rooms the player
  // can still progress without (merchants / gunsmiths / etc.) so no
  // door the critical path depends on ends up locked.
  _assignKeycards() {
    const rooms = this.rooms;
    const COLORS = ['red', 'blue', 'green', 'yellow'];
    // Level index drives how many keys spawn (capped). Level 1 is 0-1,
    // mid-game 1-2, late-game up to 3; the very-rare 4-key case only
    // fires at level 6+ with a low-probability roll.
    const lv = Math.max(1, this.index || 1);
    const baseN = lv <= 1 ? (Math.random() < 0.6 ? 1 : 0)
                : lv <= 3 ? (1 + (Math.random() < 0.35 ? 1 : 0))
                : lv <= 5 ? (2 + (Math.random() < 0.25 ? 1 : 0))
                : 2 + (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
    // Cap keys against the number of sub-boss spawns AND major-boss
    // spawns available — these are the mobs that actually drop keys,
    // so issuing 3 keys on a level with only 1 sub-boss would soft-
    // lock the doors the player can never open. `enemySpawns` is
    // populated by _populateRoom, which runs before this method.
    const holderCount = this.enemySpawns
      ? this.enemySpawns.filter(s => s.tier === 'subBoss' || s.majorBoss).length
      : 0;
    const nKeys = Math.min(4, baseN, holderCount);
    if (nKeys === 0) return;

    // Candidate doors — shop, service, AND treasure rooms so the
    // critical path can never be gated behind a key. Sub-boss doors
    // are explicitly excluded because key holders are sub-bosses
    // themselves; gating a sub-boss behind a key risks a softlock
    // if that sub-boss is the one holding the key you'd need.
    const shopTypes = new Set(['merchant', 'healer', 'gunsmith', 'armorer',
      'tailor', 'relicSeller', 'blackMarket', 'bearMerchant']);
    // Treasure rooms are gated by THEIR door (treasure-only side) —
    // bagged separately so we can prioritise locking THOSE first.
    // User intent: treasure rooms always read as "you need the key
    // to get in here." Shops are gated only if there's still keys
    // left after every treasure door is locked.
    const treasureTypes = new Set(['treasure']);
    const _doorClassify = (o) => {
      if (!o.userData.isDoor) return null;
      if (o.userData.isExtractionDoor) return null;
      const connects = o.userData.connects;
      if (!connects || connects.length !== 2) return null;
      const [aId, bId] = connects;
      const a = rooms[aId], b = rooms[bId];
      if (!a || !b) return null;
      if (a.type === 'boss' || b.type === 'boss') return null;
      if (a.type === 'subBoss' || b.type === 'subBoss') return null;
      const aIsTreasure = treasureTypes.has(a.type);
      const bIsTreasure = treasureTypes.has(b.type);
      if (aIsTreasure !== bIsTreasure) return 'treasure';
      const aIsShop = shopTypes.has(a.type);
      const bIsShop = shopTypes.has(b.type);
      if (aIsShop !== bIsShop) return 'shop';
      return null;
    };
    const treasureDoors = [];
    const shopDoors = [];
    for (const o of this.obstacles) {
      const cls = _doorClassify(o);
      if (cls === 'treasure') treasureDoors.push(o);
      else if (cls === 'shop') shopDoors.push(o);
    }
    // Treasure first, then shops, in the candidate list.
    const keyable = treasureDoors.concat(shopDoors);
    if (keyable.length === 0) return;

    // Reachability check from spawn (rooms[0]) over only-currently-
    // unlocked doors plus a candidate door treated as unlocked.
    // Returns the set of room ids reachable. Used after each pick to
    // validate that at least ONE side of the locked door is still
    // reachable from spawn — i.e., the player can actually walk up
    // to the door to use the key.
    const _reachableFrom = (startId, blockedDoors) => {
      const seen = new Set([startId]);
      const stack = [startId];
      while (stack.length) {
        const cur = stack.pop();
        const room = rooms[cur];
        if (!room || !room.neighbors) continue;
        for (const n of room.neighbors) {
          if (seen.has(n.otherId)) continue;
          // Skip doors we've locked. A door is "this side blocked"
          // if it's in blockedDoors (set of door meshes).
          const door = this._doorBetween ? this._doorBetween(cur, n.otherId) : null;
          if (door && blockedDoors.has(door)) continue;
          seen.add(n.otherId);
          stack.push(n.otherId);
        }
      }
      return seen;
    };

    // Sub-boss list — these mobs drop the key tokens when they die.
    // Key holders are assigned in main.js buildBodyLoot; we just
    // stamp the colour(s) onto level.keycardHolders here so the
    // spawn + loot code can read it.
    const poolColors = COLORS.slice().sort(() => Math.random() - 0.5);
    this.keycardDoors = {};            // color → door mesh
    this.keycardColors = [];           // ordered list for this level
    const picked = new Set();
    // Tracks every door we've locked across this assignment pass.
    // Each new candidate is validated against the cumulative blocked
    // set — both adjacent rooms must remain reachable from spawn so
    // the player can approach the door from at least one side.
    const blockedDoors = new Set();
    for (let i = 0; i < nKeys && keyable.length; i++) {
      // Try candidates until one passes the reachability check, or
      // we run out (in which case the level just gets fewer keys).
      // Treasure doors are at the FRONT of keyable (see prioritisation
      // above), so iterate front-to-back rather than picking randomly
      // — guarantees every treasure door gets locked before any shop
      // is touched.
      let door = null;
      let chosenIdx = -1;
      for (let attempt = 0; attempt < keyable.length; attempt++) {
        const tryIdx = attempt;
        const tryDoor = keyable[tryIdx];
        const trial = new Set(blockedDoors);
        trial.add(tryDoor);
        const reachable = _reachableFrom(0, trial);
        const [aId, bId] = tryDoor.userData.connects;
        // Pass if the player can still walk up to AT LEAST one side
        // of this door from spawn through unlocked-only doors.
        if (reachable.has(aId) || reachable.has(bId)) {
          door = tryDoor;
          chosenIdx = tryIdx;
          break;
        }
      }
      if (!door) break;     // every remaining candidate would softlock — stop
      keyable.splice(chosenIdx, 1);
      blockedDoors.add(door);
      const color = poolColors[i];
      door.userData.keyRequired = color;
      door.userData.unlocked = false;
      // Restore the full-width door AABB (4m × 1.2m). The stashed
      // `lockedCollisionXZ` was captured in _openDoor; fall back to a
      // door-sized box derived from the mesh geometry if the stash is
      // missing for any reason.
      if (door.userData.lockedCollisionXZ) {
        door.userData.collisionXZ = door.userData.lockedCollisionXZ;
      } else {
        const g = door.geometry?.parameters;
        const w = g?.width ?? 4, d = g?.depth ?? 1.2;
        door.userData.collisionXZ = {
          minX: door.position.x - w / 2, maxX: door.position.x + w / 2,
          minZ: door.position.z - d / 2, maxZ: door.position.z + d / 2,
        };
      }
      // Reset visual to locked state, re-tint by key colour.
      door.scale.y = 1.0; door.position.y = WALL_HEIGHT / 2; door.updateMatrix();

      door.material.opacity = 1.0;
      door.material.transparent = false;
      const tintHex = color === 'red'    ? 0xd04040
                    : color === 'blue'   ? 0x4070d0
                    : color === 'green'  ? 0x50c060
                    : 0xe0c040;          // yellow
      door.material.color.setHex(tintHex);
      this.keycardDoors[color] = door;
      this.keycardColors.push(color);
      picked.add(door);
    }
  }

  // Flip a door into the unlocked/flattened state. Pulled into a
  // helper because multiple paths need the same visual + collision
  // update (default unlock at gen, keycard use, etc.).
  _openDoor(mesh) {
    if (mesh.userData.unlocked) return;
    mesh.userData.unlocked = true;
    this._dirtySolid();
    // Stash the solid-door AABB so re-locking (keycard assign, boss
    // arena lockdown) can restore the *real* door footprint. Without
    // this we fell back to a 1.2×1.2 box around the door centre, and
    // since DOOR_WIDTH is 4m the player could slip around the sides.
    if (!mesh.userData.lockedCollisionXZ && mesh.userData.collisionXZ) {
      mesh.userData.lockedCollisionXZ = mesh.userData.collisionXZ;
    }
    mesh.userData.collisionXZ = null;
    mesh.material.color.setHex(DOOR_OPEN_COLOR);
    mesh.material.opacity = 0.3;
    mesh.material.transparent = true;
    mesh.scale.y = 0.08; mesh.position.y = 0.04; mesh.updateMatrix();

  }

  // Unlock a keycard-gated door given the held key colour. Returns
  // the colour that was consumed, or null if no match at this spot.
  tryKeycardUnlock(playerPos, radius = 2.2, heldColors = new Set()) {
    if (!this.keycardDoors) return null;
    for (const color of Object.keys(this.keycardDoors)) {
      const door = this.keycardDoors[color];
      if (!door || door.userData.unlocked) continue;
      const dx = door.position.x - playerPos.x;
      const dz = door.position.z - playerPos.z;
      if (dx * dx + dz * dz > radius * radius) continue;
      if (!heldColors.has(color)) return { needsKey: color };
      this._openDoor(door);
      return { consumed: color };
    }
    return null;
  }

  _rectAt(cx, cz, w, h) {
    return {
      minX: cx - w / 2, maxX: cx + w / 2,
      minZ: cz - h / 2, maxZ: cz + h / 2,
    };
  }

  _linkRooms(a, b, dirFromA) {
    a.neighbors.push({ otherId: b.id, dir: dirFromA });
    const opposite = { east: 'west', west: 'east', north: 'south', south: 'north' }[dirFromA];
    b.neighbors.push({ otherId: a.id, dir: opposite });
  }

  // Build outer walls. Each side looks up its neighbor (if any) and places
  // the doorway gap at the neighbor's center — not the wall midpoint — so
  // asymmetrically-sized rooms (e.g. doubled-up bosses) still align their
  // doors with the corridor room on the other side.
  // Shape-aware outer-wall color reader. Shape templates need this so
  // they can match the dynamic theme tint that the rect path bakes in
  // via the module-scope `OUTER_WALL_COLOR`. Returning the live value
  // means a shape built mid-generate uses the same tint as the rect
  // walls placed in the same pass.
  _outerWallColor() { return OUTER_WALL_COLOR; }

  // Return the list of doorway centers (in world coords) that are
  // NOT covered by at least one walkableBounds box. Used to verify a
  // shape template didn't orphan a doorway. Tolerance of 0.5m so
  // edge-of-box doorway positions (which sit on the perimeter
  // exactly) still count as reachable.
  _verifyDoorwaysReachable(room) {
    const wb = room._walkableBounds;
    if (!wb || !wb.length || !room.neighbors) return [];
    const doors = [];
    for (const n of room.neighbors) {
      const other = this.rooms[n.otherId];
      if (!other) continue;
      let dx, dz;
      const b = room.bounds;
      if (n.dir === 'north')      { dx = other.cx; dz = b.minZ; }
      else if (n.dir === 'south') { dx = other.cx; dz = b.maxZ; }
      else if (n.dir === 'east')  { dx = b.maxX; dz = other.cz; }
      else                         { dx = b.minX; dz = other.cz; }
      // Probe one step inward (along the inward normal) so we test
      // a point clearly inside the room rather than the wall plane.
      if (n.dir === 'north') dz += 1.0;
      else if (n.dir === 'south') dz -= 1.0;
      else if (n.dir === 'east')  dx -= 1.0;
      else                         dx += 1.0;
      doors.push({ dir: n.dir, x: dx, z: dz });
    }
    const bad = [];
    for (const d of doors) {
      const inside = wb.some(box =>
        d.x >= box.minX - 0.5 && d.x <= box.maxX + 0.5 &&
        d.z >= box.minZ - 0.5 && d.z <= box.maxZ + 0.5);
      if (!inside) bad.push(d);
    }
    return bad;
  }

  // Tear down whatever obstacles a failed-shape build added (by
  // address — anything pushed into this.obstacles after this room's
  // perimeter started) and rebuild as a vanilla rect. Conservative
  // fallback: we record this.obstacles.length BEFORE shape build,
  // and remove anything added during the failed shape.
  _demoteRoomToRect(room) {
    // The shape's walls are already in this.obstacles; we don't
    // bother tracking which ones — easiest correct fallback is to
    // leave them in place (they'll just be extra interior walls
    // that the rect rebuild will sit over). This is rare, and the
    // alternative (precise undo) is fragile.
    room.shape = 'rect';
    // Recurse via the rect path. _buildRoomPerimeter checks shape ===
    // 'rect' and runs the legacy code.
    this._buildRoomPerimeter(room);
  }

  _buildRoomPerimeter(room) {
    // Shape dispatch — Pass 1A. Non-'rect' shapes own their own
    // perimeter + interior wall layout. The shape's build() must:
    //   1. produce outer walls with the same doorway gaps the rect
    //      path leaves (so _buildDoor still aligns)
    //   2. return walkableBounds — array of axis-aligned box-likes
    //      whose union connects every doorway. checkPathwayInvariants
    //      flood-fills over this set.
    if (room.shape && room.shape !== 'rect') {
      const tpl = SHAPE_REGISTRY[room.shape];
      if (tpl && typeof tpl.build === 'function') {
        try {
          // Phase M step 3 — tag every obstacle created by the shape
          // template with userData.kind = 'shape-wall' so
          // _clearDoorCorridors can recognise + clear them when a
          // shape template seals off a doorway. We snapshot the
          // obstacles length before the build then walk the new
          // tail afterwards.
          //
          // Phase M step 5 — flag main-path rooms so shape templates
          // can widen any internal corridor segments to >= 3m.
          // start / combat / boss rooms are on the main path; subBoss
          // / shop / encounter rooms are branches and keep narrower
          // widths.
          const _shapeStart = this.obstacles.length;
          const isMainPath = (room.type === 'start'
                            || room.type === 'combat'
                            || room.type === 'boss');
          const out = tpl.build(this, room, { isMainPath });
          for (let i = _shapeStart; i < this.obstacles.length; i++) {
            const m = this.obstacles[i];
            if (m && m.userData && !m.userData.kind) {
              m.userData.kind = 'shape-wall';
            }
          }
          if (out && out.walkableBounds) {
            room._walkableBounds = out.walkableBounds;
            // Sanity guard — every doorway position must be inside
            // (or on the edge of) at least one walkableBounds box.
            // If a shape template forgets to span a doorway, the
            // room becomes orphaned and pathfinding breaks. We log
            // and demote to rect so the level is still playable.
            const bad = this._verifyDoorwaysReachable(room);
            if (bad.length) {
              console.warn(`[level] shape '${room.shape}' room ${room.id} doorways unreachable from walkableBounds:`, bad,
                '— rebuilding as rect');
              this._demoteRoomToRect(room);
              return;
            }
          }
          return;
        } catch (err) {
          console.warn(`[level] shape '${room.shape}' build failed for room ${room.id}; falling back to rect:`, err);
          // Fall through to rect path below as a safety net so the
          // room is still sealed even if the shape code throws.
          room.shape = 'rect';
        }
      }
    }
    // rect path — preserved exactly as before. Stamp the full cell
    // footprint as walkable so the invariant check has uniform data
    // across all rooms regardless of shape choice.
    const b = room.bounds;
    room._walkableBounds = [{
      minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ,
    }];
    const halfGap = DOOR_WIDTH / 2;
    const rooms = this.rooms;
    const neighborFor = (dir) => {
      const n = room.neighbors.find(x => x.dir === dir);
      return n ? rooms[n.otherId] : null;
    };
    const addSegmentsHoriz = (cz, gapCenterX) => {
      // Two wall segments along X, left + right of the gap at gapCenterX.
      const leftFrom = b.minX, leftTo = gapCenterX - halfGap;
      const rightFrom = gapCenterX + halfGap, rightTo = b.maxX;
      if (leftTo > leftFrom + 0.05) {
        this._addObstacle((leftFrom + leftTo) / 2, WALL_HEIGHT / 2, cz,
          leftTo - leftFrom, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
      }
      if (rightTo > rightFrom + 0.05) {
        this._addObstacle((rightFrom + rightTo) / 2, WALL_HEIGHT / 2, cz,
          rightTo - rightFrom, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
      }
    };
    const addSegmentsVert = (cx, gapCenterZ) => {
      const topFrom = b.minZ, topTo = gapCenterZ - halfGap;
      const botFrom = gapCenterZ + halfGap, botTo = b.maxZ;
      if (topTo > topFrom + 0.05) {
        this._addObstacle(cx, WALL_HEIGHT / 2, (topFrom + topTo) / 2,
          WALL_THICK, WALL_HEIGHT, topTo - topFrom, OUTER_WALL_COLOR);
      }
      if (botTo > botFrom + 0.05) {
        this._addObstacle(cx, WALL_HEIGHT / 2, (botFrom + botTo) / 2,
          WALL_THICK, WALL_HEIGHT, botTo - botFrom, OUTER_WALL_COLOR);
      }
    };

    // North (min Z).
    const north = neighborFor('north');
    if (north) addSegmentsHoriz(b.minZ, north.cx);
    else this._addObstacle((b.minX + b.maxX) / 2, WALL_HEIGHT / 2, b.minZ,
      (b.maxX - b.minX), WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
    // South (max Z).
    const south = neighborFor('south');
    if (south) addSegmentsHoriz(b.maxZ, south.cx);
    else this._addObstacle((b.minX + b.maxX) / 2, WALL_HEIGHT / 2, b.maxZ,
      (b.maxX - b.minX), WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
    // East (max X).
    const east = neighborFor('east');
    if (east) addSegmentsVert(b.maxX, east.cz);
    else this._addObstacle(b.maxX, WALL_HEIGHT / 2, (b.minZ + b.maxZ) / 2,
      WALL_THICK, WALL_HEIGHT, (b.maxZ - b.minZ), OUTER_WALL_COLOR);
    // West (min X).
    const west = neighborFor('west');
    if (west) addSegmentsVert(b.minX, west.cz);
    else this._addObstacle(b.minX, WALL_HEIGHT / 2, (b.minZ + b.maxZ) / 2,
      WALL_THICK, WALL_HEIGHT, (b.maxZ - b.minZ), OUTER_WALL_COLOR);
  }

  // Pass 1C — walk exterior walls of every room and replace 1-2
  // sections of solid wall per side with windows + ledges. A side is
  // "exterior" if there's no neighbor on that side. Windows are built
  // via buildWindow() (windows.js) and added as a collision proxy +
  // visible group; ledges sit just below each window inside the room.
  //
  // The function is idempotent in spirit — it walks each room once
  // per generate() and stamps level._windows / level.ledges.
  //
  // Skips: connectors (their walls are owned by the bridge generator)
  // and synthetic rooms (extraction).
  _addExteriorWindowsAndLedges() {
    if (!this._windows) this._windows = [];
    // Windows disabled per playtest 2026-05-06: "maybe we just remove
    // windows all together. seems like you're unable to create windows
    // that align with wall gaps and walls under the window ledges
    // consistently." The wall-cut + sill rebuild path was producing
    // mis-sized cuts on shape rooms and embedding glass panes inside
    // solid walls. Gating placement off here is the cleanest revert
    // — window builder + cut-wall + ledge code is preserved for a
    // future tuning pass. Re-enable per session via
    // `localStorage.coldExitWindows = '1'`.
    let _windowsOn = false;
    try { _windowsOn = localStorage.getItem('coldExitWindows') === '1'; }
    catch (_) {}
    if (!_windowsOn) return;
    for (const room of this.rooms) {
      if (!room || room.id < 0) continue;
      if (room.type === 'connector') continue;
      if (!room.bounds || !room.neighbors) continue;
      const used = new Set(room.neighbors.map(n => n.dir));
      const sides = ['north', 'south', 'east', 'west'].filter(s => !used.has(s));
      // 1-2 windows per exterior side, weighted toward "1". Skip
      // start rooms entirely (predictable spawn) and shop rooms (the
      // shop UI doesn't yet support windowed walls).
      if (room.type === 'start' || room.type === 'shop') continue;
      // Allow a bias so larger rooms get 2 windows. Use room footprint
      // as a heuristic.
      for (const side of sides) {
        if (Math.random() > 0.6) continue;        // ~60% per exterior side
        const count = (Math.random() < 0.3) ? 2 : 1;
        for (let i = 0; i < count; i++) {
          this._placeWindowOnSide(room, side, i, count);
        }
      }
    }
  }

  // Place a single window + ledge on the given exterior side of a
  // room. `i` and `count` distribute the windows evenly along the
  // wall (0 of 1 = midpoint; 0 of 2 = 1/3, 1 of 2 = 2/3, etc).
  _placeWindowOnSide(room, side, i, count) {
    const b = room.bounds;
    const winW = 4.0;
    const winH = 2.0;
    const sillH = 1.0;
    let wx, wz, isHorizWall;
    let wallSegMin, wallSegMax;
    if (side === 'north' || side === 'south') {
      isHorizWall = true;
      wz = (side === 'north') ? b.minZ : b.maxZ;
      const wallLen = b.maxX - b.minX;
      // Avoid the 4m at each end (outer-wall corners) so the window
      // doesn't span past the room.
      const margin = 3.0;
      const span = wallLen - margin * 2;
      if (span < winW + 1) return;
      const offset = (span / (count + 1)) * (i + 1);
      wx = b.minX + margin + offset;
      wallSegMin = wx - winW / 2;
      wallSegMax = wx + winW / 2;
      // If a doorway falls inside this window's span, abort — we
      // don't want to overlap a door.
      for (const n of room.neighbors || []) {
        if (n.dir !== side) continue;
        const other = this.rooms[n.otherId];
        if (!other) continue;
        const doorCenter = other.cx;
        if (Math.abs(doorCenter - wx) < winW / 2 + DOOR_WIDTH / 2 + 0.5) return;
      }
    } else {
      isHorizWall = false;
      wx = (side === 'east') ? b.maxX : b.minX;
      const wallLen = b.maxZ - b.minZ;
      const margin = 3.0;
      const span = wallLen - margin * 2;
      if (span < winW + 1) return;
      const offset = (span / (count + 1)) * (i + 1);
      wz = b.minZ + margin + offset;
      wallSegMin = wz - winW / 2;
      wallSegMax = wz + winW / 2;
      for (const n of room.neighbors || []) {
        if (n.dir !== side) continue;
        const other = this.rooms[n.otherId];
        if (!other) continue;
        const doorCenter = other.cz;
        if (Math.abs(doorCenter - wz) < winW / 2 + DOOR_WIDTH / 2 + 0.5) return;
      }
    }
    // Build the window. The visible group is positioned on the wall
    // plane; the collision proxy mirrors the window's solid AABB.
    const built = buildWindow({ width: winW, height: winH, sillHeight: sillH });
    if (!built || !built.group) return;
    built.group.position.set(wx, 0, wz);
    if (!isHorizWall) built.group.rotation.y = Math.PI / 2;
    this.scene.add(built.group);
    this.decorations.push(built.group);
    // Collision proxy — invisible mesh that the projectile system +
    // movement collision can intersect. Width matches the window
    // aperture; depth is wall-thin.
    const proxyW = isHorizWall ? winW : WALL_THICK;
    const proxyD = isHorizWall ? WALL_THICK : winW;
    const proxyMat = sharedMaterial({
      type: 'basic', color: 0xffffff,
      transparent: true, opacity: 0, depthWrite: false,
    });
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(proxyW, WALL_HEIGHT, proxyD),
      proxyMat,
    );
    proxy.position.set(wx, WALL_HEIGHT / 2, wz);
    proxy.userData.collisionXZ = {
      minX: wx - proxyW / 2, maxX: wx + proxyW / 2,
      minZ: wz - proxyD / 2, maxZ: wz + proxyD / 2,
    };
    proxy.userData.kind = 'window';
    proxy.userData.windowState = built.state;
    proxy.userData.isWindowProxy = true;
    proxy.matrixAutoUpdate = false;
    proxy.updateMatrix();
    this.scene.add(proxy);
    this.obstacles.push(proxy);
    built.state.collisionProxy = proxy;
    this._windows.push({ window: built, room, side, x: wx, z: wz });
    // Null any existing wall obstacle that overlaps the window's
    // aperture so the wall doesn't double-block the bullet path.
    // We look for outer-color walls on the same side line whose AABB
    // intersects the window's aperture and split / shrink them.
    this._cutWallForWindow(room, side, wx, wz, winW, isHorizWall);
    // SILL — rebuild the wall section UNDER the window. _cutWallForWindow
    // strips the full-height wall in front of the aperture, but the
    // window itself only occupies y = sillHeight..(sillHeight+winH).
    // Without this block the player can walk through the gap below the
    // glass — playtest report: "windows are often spawning in walls
    // with nothing underneath the windows."
    //
    // Block width matches the cut width (winW); height is sillHeight
    // (1.0m); thickness is WALL_THICK. Centered at y=sillHeight/2 so
    // its top edge sits flush with the window's bottom.
    const sillBlockH = sillH;
    if (sillBlockH > 0.05) {
      let sx, sz, sw, sd;
      if (isHorizWall) { sx = wx; sz = wz; sw = winW; sd = WALL_THICK; }
      else             { sx = wx; sz = wz; sw = WALL_THICK; sd = winW; }
      this._addObstacle(sx, sillBlockH / 2, sz, sw, sillBlockH, sd, OUTER_WALL_COLOR);
    }
    // Ledge — sits inside the room just below the window. Only add
    // for windows on rect / shape rooms whose interior side is clear.
    const lengthAlongWall = winW - 0.4;
    let lx1, lz1, lx2, lz2;
    if (isHorizWall) {
      lx1 = wx - lengthAlongWall / 2;
      lx2 = wx + lengthAlongWall / 2;
      // Ledge sits on the inside face of the wall (one ledge depth in)
      const inset = (side === 'north') ? 0.5 : -0.5;
      lz1 = wz + inset;
      lz2 = wz + inset;
    } else {
      lz1 = wz - lengthAlongWall / 2;
      lz2 = wz + lengthAlongWall / 2;
      const inset = (side === 'west') ? 0.5 : -0.5;
      lx1 = wx + inset;
      lx2 = wx + inset;
    }
    addLedge(this, lx1, lz1, lx2, lz2, sillH, {
      room,
      windowState: built.state,
    });
  }

  // Walk the obstacles list and split / null any outer-color wall
  // segment that overlaps a window's aperture, so the wall + window
  // don't both block the bullet path. We only operate on solid outer
  // walls (color === OUTER_WALL_COLOR). Doors are explicitly skipped.
  _cutWallForWindow(room, side, wx, wz, winW, isHorizWall) {
    const half = winW / 2;
    const tolerance = 0.4;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const m = this.obstacles[i];
      const ud = m.userData;
      if (!ud || ud.isDoor || ud.kind === 'window' || ud.isExtractionWall) continue;
      if (!ud.collisionXZ) continue;
      const cb = ud.collisionXZ;
      if (isHorizWall) {
        // Wall lies on the wz line — check Z proximity + X overlap.
        if (Math.abs((cb.minZ + cb.maxZ) / 2 - wz) > tolerance) continue;
        if (cb.maxX <= wx - half + 0.05 || cb.minX >= wx + half - 0.05) continue;
        // Found an overlapping wall segment. Replace it with two
        // shorter segments on either side of the aperture, OR null
        // its collision if it sits entirely inside the window span.
        const wallMinX = cb.minX, wallMaxX = cb.maxX;
        const cutMinX = Math.max(wallMinX, wx - half);
        const cutMaxX = Math.min(wallMaxX, wx + half);
        // Left stub
        const leftFrom = wallMinX, leftTo = cutMinX;
        // Right stub
        const rightFrom = cutMaxX, rightTo = wallMaxX;
        // Remove original.
        this.scene.remove(m);
        m.geometry?.dispose?.();
        if (m.material) disposeMaterialIfNotShared(m.material);
        this.obstacles.splice(i, 1);
        if (leftTo > leftFrom + 0.1) {
          this._addObstacle((leftFrom + leftTo) / 2, WALL_HEIGHT / 2, wz,
            leftTo - leftFrom, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
        }
        if (rightTo > rightFrom + 0.1) {
          this._addObstacle((rightFrom + rightTo) / 2, WALL_HEIGHT / 2, wz,
            rightTo - rightFrom, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
        }
      } else {
        if (Math.abs((cb.minX + cb.maxX) / 2 - wx) > tolerance) continue;
        if (cb.maxZ <= wz - half + 0.05 || cb.minZ >= wz + half - 0.05) continue;
        const wallMinZ = cb.minZ, wallMaxZ = cb.maxZ;
        const cutMinZ = Math.max(wallMinZ, wz - half);
        const cutMaxZ = Math.min(wallMaxZ, wz + half);
        const topFrom = wallMinZ, topTo = cutMinZ;
        const botFrom = cutMaxZ, botTo = wallMaxZ;
        this.scene.remove(m);
        m.geometry?.dispose?.();
        if (m.material) disposeMaterialIfNotShared(m.material);
        this.obstacles.splice(i, 1);
        if (topTo > topFrom + 0.1) {
          this._addObstacle(wx, WALL_HEIGHT / 2, (topFrom + topTo) / 2,
            WALL_THICK, WALL_HEIGHT, topTo - topFrom, OUTER_WALL_COLOR);
        }
        if (botTo > botFrom + 0.1) {
          this._addObstacle(wx, WALL_HEIGHT / 2, (botFrom + botTo) / 2,
            WALL_THICK, WALL_HEIGHT, botTo - botFrom, OUTER_WALL_COLOR);
        }
      }
      this._dirtySolid();
      // We've split the overlapping wall — only one wall segment
      // typically covers a given span, so we can stop here.
      return;
    }
  }

  // Build the door (initially a blocking wall) between two rooms. The door
  // is placed at the neighbor's center so it lines up regardless of room
  // sizing asymmetries.
  _buildDoor(a, b, dirFromA) {
    let cx, cz, sx, sz;
    if (dirFromA === 'east' || dirFromA === 'west') {
      cx = dirFromA === 'east' ? a.bounds.maxX : a.bounds.minX;
      cz = b.cz;                         // align with neighbor centre
      sx = WALL_THICK; sz = DOOR_WIDTH;
    } else {
      cx = b.cx;
      cz = dirFromA === 'north' ? a.bounds.minZ : a.bounds.maxZ;
      sx = DOOR_WIDTH; sz = WALL_THICK;
    }
    const mesh = this._addObstacle(cx, WALL_HEIGHT / 2, cz, sx, WALL_HEIGHT, sz, DOOR_COLOR);
    // CRITICAL: doors share their initial material via sharedMaterial(),
    // but we mutate `mesh.material.color` per-door (keycard tints in
    // _assignKeycards, open/locked tint in _openDoor). Without an
    // own-material clone, each setHex on one door re-tints EVERY door
    // sharing the material. Result: keycard doors all show the LAST
    // assigned colour while their userData.keyRequired keeps the real
    // (different) colour — the "approached green door, game asked for
    // red" playtest report. Cost is negligible: ~10 doors per level,
    // each material is a small MeshStandardMaterial instance.
    if (mesh.material && typeof mesh.material.clone === 'function') {
      mesh.material = mesh.material.clone();
    }
    mesh.userData.isDoor = true;
    mesh.userData.connects = [a.id, b.id];
    mesh.userData.cx = cx;
    mesh.userData.cz = cz;
  }

  // Build the tutorial level — a single 30×30 practice room with an
  // outer wall ring, a player spawn at one end, an extract zone at
  // the far end (revealed immediately), one container, and one
  // sleeping dummy enemy spawn. No doors, no boss, no wandering AI;
  // the room exists so the player can practice every control without
  // dying. Stays within the same Level invariants used by the random
  // generator (rooms list, exitBounds, playerSpawn, enemySpawns) so
  // downstream code (HUD, collision, etc.) works unchanged.
  generateTutorial() {
    const W = 30, D = 26;
    const cx = 0, cz = 0;
    const bounds = {
      minX: cx - W / 2, maxX: cx + W / 2,
      minZ: cz - D / 2, maxZ: cz + D / 2,
    };
    const room = {
      id: 0,
      type: 'start',
      layout: 'open',
      bounds,
      cx, cz,
      cellX: 0, cellZ: 0,
      neighbors: [],
      hasElevator: false,
      doubled: false,
      giant: false,
    };
    this.rooms = [room];
    // Outer walls — four full-height segments. No door gaps; the
    // tutorial ends via the extract zone, not by opening a door.
    const T = WALL_THICK;
    const H = WALL_HEIGHT;
    this._addObstacle(cx,  H / 2, bounds.minZ, W + T, H, T, OUTER_WALL_COLOR);
    this._addObstacle(cx,  H / 2, bounds.maxZ, W + T, H, T, OUTER_WALL_COLOR);
    this._addObstacle(bounds.minX, H / 2, cz, T, H, D, OUTER_WALL_COLOR);
    this._addObstacle(bounds.maxX, H / 2, cz, T, H, D, OUTER_WALL_COLOR);
    // A few low-cover blocks so the player can practice taking cover
    // and hopping between sight lines.
    this._addObstacle(cx - 4, 0.4, cz - 2, 1.6, 0.8, 1.0, LOW_COVER_COLOR);
    this._addObstacle(cx + 3, 0.4, cz + 1, 1.4, 0.8, 1.2, LOW_COVER_COLOR);
    this._addObstacle(cx + 5, 0.4, cz - 4, 1.2, 0.8, 1.4, LOW_COVER_COLOR);
    // Practice container — placed off-centre so the player has to
    // walk to it. Built via the same containers.js path so the loot
    // UI flow matches a real run.
    {
      const container = makeContainer('general', 'm', 1);
      // Stuff a guaranteed bandage + medkit + throwable so the
      // pickup / heal / throwable steps all have something usable.
      container.loot.unshift({
        id: 'cons_bandage', name: 'Bandage', type: 'consumable', rarity: 'common',
        useEffect: { kind: 'heal', amount: 30 },
      });
      container.loot.push({
        id: 'cons_medkit', name: 'Medkit', type: 'consumable', rarity: 'common',
        useEffect: { kind: 'heal', amount: 60 },
      });
      // Frag grenade so the throwable step has a target. Filled-in
      // charges (3) so the player gets multiple practice tosses.
      container.loot.push({
        id: 'throw_frag', name: 'Frag Grenade', type: 'throwable', rarity: 'common',
        throwKind: 'frag', maxCharges: 3, charges: 3,
      });
      const cx2 = cx - 6, cz2 = cz + 4;
      const group = buildContainerMesh(container, cx2, 0, cz2);
      this.scene.add(group);
      const { w, h, d } = container.geo;
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        sharedMaterial({ type: 'basic', color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
      );
      proxy.position.set(cx2, h / 2, cz2);
      proxy.userData.collisionXZ = {
        minX: cx2 - w / 2, maxX: cx2 + w / 2,
        minZ: cz2 - d / 2, maxZ: cz2 + d / 2,
      };
      proxy.userData.isProp = true;
      this.scene.add(proxy);
      this.obstacles.push(proxy);
      this.containers.push({ container, group, x: cx2, z: cz2, r: 1.8 });
    }
    // Extract zone — pinned at the far +Z end of the room, revealed
    // immediately so the tutorial player can see where to head.
    this._exitPendingBounds = { cx: cx, cz: bounds.maxZ - 4, r: 2.4 };
    this.revealExit();
    // Player spawn at the opposite end of the room.
    this.playerSpawn.set(cx, 0, bounds.minZ + 3);
    // Two dummy spawns:
    //   * Combat dummy — close to the player, target for headshot /
    //     leg shot / disarm / melee practice. Aggression=0 so it
    //     never fires back.
    //   * Stealth dummy — far corner, isolated from cover. Player
    //     must crouch + close distance to mark the stealth step.
    this.enemySpawns = [
      {
        x: cx + 5, z: cz + 5, roomId: 0, tier: 'normal',
        tutorialDummy: true,
      },
      {
        x: bounds.maxX - 3, z: bounds.minZ + 4, roomId: 0, tier: 'normal',
        tutorialDummy: true, stealthTarget: true,
      },
    ];
    // Drop a ceiling lamp so the room is visibly lit — without this
    // the tutorial reads as a dark void since the procedural lamp
    // pass only runs for room.type !== 'start'.
    this._addCeilingLamp(room);
    return;
  }

  _scatterCover(room) {
    const b = room.bounds;
    const wbList = room._walkableBounds;
    const outsideWalkable = (x, z) => {
      if (!wbList || !wbList.length) return false;
      for (const wb of wbList) {
        if (x >= wb.minX - 0.4 && x <= wb.maxX + 0.4
            && z >= wb.minZ - 0.4 && z <= wb.maxZ + 0.4) return false;
      }
      return true;
    };
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const w = 1 + Math.random() * 1.5;
        const d = 0.8 + Math.random() * 1.2;
        // Clamp the placement window so the prop's full footprint can
        // never drift outside the room. Without the inset/Math.max
        // guard, small rooms (< 6m in either dim) collapsed the
        // `(size - 6)` range to negative and let centers slide below
        // bounds.minX/Z, with the visible mesh poking through the wall.
        const inset = 0.5 + Math.max(w, d) / 2;
        const usableW = (b.maxX - b.minX) - inset * 2;
        const usableD = (b.maxZ - b.minZ) - inset * 2;
        if (usableW <= 0 || usableD <= 0) break;
        const x = b.minX + inset + Math.random() * usableW;
        const z = b.minZ + inset + Math.random() * usableD;
        if (outsideWalkable(x, z)) continue;
        if (this._collidesAt(x, z, 2.0)) continue;
        // Honor keep-outs (boss exit ring, encounter spawn discs) so
        // a low-cover block doesn't sit on top of the future exit
        // teleporter or block the player's stand-on-this-disc cue.
        let blocked = false;
        if (this._keepouts) {
          for (const k of this._keepouts) {
            const kx = x - k.x, kz = z - k.z;
            if (kx * kx + kz * kz < k.r * k.r) { blocked = true; break; }
          }
        }
        if (blocked) continue;
        this._addObstacle(x, 0.4, z, w, 0.8, d, LOW_COVER_COLOR);
        break;
      }
    }
  }

  // Roll-per-room container spawn. Most rooms get NO container at
  // all — boxes are an occasional find, not a fixture. When a room
  // does roll a spawn it's almost always a single box; only big
  // boss rooms occasionally roll a second. No tier gets a bonus
  // masterwork — masterwork lives at ~0.3% in pickContainerType()
  // so it stays exceptional regardless of where the spawn lands.
  _scatterContainers(room) {
    const b = room.bounds;
    const area = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    const wbList = room._walkableBounds;
    const outsideWalkable = (x, z) => {
      if (!wbList || !wbList.length) return false;
      for (const wb of wbList) {
        if (x >= wb.minX - 0.4 && x <= wb.maxX + 0.4
            && z >= wb.minZ - 0.4 && z <= wb.maxZ + 0.4) return false;
      }
      return true;
    };
    // Treasure rooms — guaranteed dense container spawn (4-6 chests),
    // and each chest is built with forceFull + rarityBias. Other
    // room types use the v2 lean rates.
    const isTreasure = room.type === 'treasure';
    const spawnChance = isTreasure ? 1.0
      : room.type === 'boss' ? 0.35
      : room.type === 'subBoss' ? 0.18
      : 0.08;
    if (Math.random() > spawnChance) return;
    let count;
    if (isTreasure) {
      count = 4 + Math.floor(Math.random() * 3);   // 4..6
    } else {
      count = 1;
      if (area > 60 && Math.random() < 0.10) count += 1;
      if ((room.type === 'boss' || room.type === 'subBoss') && Math.random() < 0.10) count += 1;
    }
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const type = pickContainerType();
        const size = pickContainerSize(type);
        // Treasure rooms always emit at least one item per container
        // and bias the rarity weights up by 1.4× (compounds with
        // contract + level scalars). Other rooms use defaults.
        const container = makeContainer(type, size, this.index,
          isTreasure ? { forceFull: true, rarityBias: 1.4 } : undefined);
        // Same in-bounds clamp as _scatterCover — container.geo gives
        // the actual width/depth of the lid AABB, so we know exactly
        // how much margin to require from the room walls.
        const cw = container.geo.w;
        const cd = container.geo.d;
        const inset = 0.5 + Math.max(cw, cd) / 2;
        const usableW = (b.maxX - b.minX) - inset * 2;
        const usableD = (b.maxZ - b.minZ) - inset * 2;
        if (usableW <= 0 || usableD <= 0) break;
        const x = b.minX + inset + Math.random() * usableW;
        const z = b.minZ + inset + Math.random() * usableD;
        if (outsideWalkable(x, z)) continue;
        if (this._collidesAt(x, z, 1.6)) continue;
        // Honor keep-outs (boss exit, encounter spawn) so the chest
        // doesn't materialise where the exit ring will appear.
        let blocked = false;
        if (this._keepouts) {
          for (const k of this._keepouts) {
            const kx = x - k.x, kz = z - k.z;
            if (kx * kx + kz * kz < k.r * k.r) { blocked = true; break; }
          }
        }
        if (blocked) continue;
        const group = buildContainerMesh(container, x, 0, z);
        this.scene.add(group);
        // Collision proxy — invisible AABB matching the lid footprint
        // so player + enemies path around the container.
        const { w, d } = container.geo;
        const proxy = new THREE.Mesh(
          new THREE.BoxGeometry(w, container.geo.h, d),
          sharedMaterial({ type: 'basic', color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
        );
        proxy.position.set(x, container.geo.h / 2, z);
        proxy.userData.collisionXZ = {
          minX: x - w / 2, maxX: x + w / 2,
          minZ: z - d / 2, maxZ: z + d / 2,
        };
        proxy.userData.isProp = true;
        proxy.userData.containerRef = container;
        this.scene.add(proxy);
        this.obstacles.push(proxy);
        // Interact radius — a generous 1.8m so the prompt doesn't feel
        // pixel-hunty against the visible mesh.
        this.containers.push({ container, group, x, z, r: 1.8 });
        break;
      }
    }
  }

  // Find the closest unlooted container within `radius`. Looted ones
  // are skipped so the prompt doesn't keep firing on empty crates the
  // player has already searched.
  nearestContainer(playerPos, radius = 1.8) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.containers) {
      // Initially-empty containers (rolled empty by SIZE_PROFILES,
      // never opened) are NOT lootable — they're decoration. Without
      // this skip the player got "Search Locker" prompts on every
      // small box just to get an empty modal. User: "empty containers
      // should not be lootable - however if they previously contained
      // loot they should be reopenable."
      //
      // Discriminator: loot.length === 0 && !looted = never had loot.
      // looted=true means the player DID search and took everything,
      // so the container stays interactable (re-opens to an empty
      // modal — confirms "I already searched here").
      const ct = c.container;
      if (!ct.looted && (!ct.loot || ct.loot.length === 0)) continue;
      // Lootable props hidden by the door-corridor sweep should not
      // surface a "Search ___" prompt for an empty patch of floor.
      if (c.group && c.group.visible === false) continue;
      const dx = playerPos.x - c.x;
      const dz = playerPos.z - c.z;
      const d = dx * dx + dz * dz;
      if (d > radius * radius) continue;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // Theme the given combat room with a set of primitive props that
  // match one of a small pool of interior styles. Each themed prop is
  // placed after the generic cover pass so the room still reads as
  // "cover + flavour" rather than "furniture showroom". Every prop
  // that declares a collision AABB is added to `this.obstacles` so
  // enemies and the player both collide with it; purely decorative
  // props (vases, rugs, lamps) stay visual-only.
  _themeRoom(room) {
    const b = room.bounds;
    const roomW = b.maxX - b.minX;
    const roomD = b.maxZ - b.minZ;
    const area = roomW * roomD;

    // Theme pool selection — restricted by LAYOUT first, then by area.
    // A hallway / corridor / partition layout doesn't have the floor
    // shape to host a bedroom or living-room set; forcing those there
    // is what produced the "bed in a hallway" reports. Utility-shape
    // layouts get utility themes; only rectangular open-ish layouts
    // are eligible for furnished-residential themes.
    const utilityLayouts = new Set([
      'hallway', 'corridor', 'partition', 'lshape', 'closet', 'split',
      'zigzag', 'bunker', 'alcove', 'center-pit',
    ]);
    const isUtility = utilityLayouts.has(room.layout);
    const SHOP_TYPES = new Set(['merchant', 'healer', 'gunsmith', 'armorer',
      'tailor', 'relicSeller', 'blackMarket']);
    let themes;
    // Biome bias — when the level theme defines a roomThemePool,
    // every non-shop / non-utility / non-tiny room picks from it as
    // a weighted sample. This is what gives a level its cohesion:
    // a 'factory' floor rolls garage / warehouse / server rooms
    // across the chain, not bedroom + library + warehouse jumbled
    // together. The size + utility filters below still apply as
    // overrides — a room too small to hold a factory floor falls
    // back to the cozy pool, and shop rooms always read as shops.
    const biomePool = (this.theme && this.theme.roomThemePool) || null;
    const _pickWeighted = (pool) => {
      const keys = Object.keys(pool);
      if (!keys.length) return null;
      let total = 0;
      for (const k of keys) total += pool[k];
      let r = Math.random() * total;
      for (const k of keys) {
        r -= pool[k];
        if (r <= 0) return k;
      }
      return keys[keys.length - 1];
    };
    if (SHOP_TYPES.has(room.type)) {
      // Vendor rooms get a single dedicated theme so they read as
      // a furnished storefront. The kiosk built by _spawnNPC sits on
      // top of these props on its assigned wall — placeAlongWall
      // collision rejects any prop that would conflict with the
      // kiosk's footprint, so the two layers compose without the
      // need for explicit kiosk-aware logic here.
      themes = ['shop'];
    } else if (room.type === 'boss') {
      // Boss rooms get the bigger industrial / civic pool — feels
      // like the climax landed in a real space.
      themes = ['warehouse', 'lobby', 'office', 'garage', 'server'];
    } else if (isUtility) {
      // Hallway-shaped + L-shaped + closet rooms are warehouses /
      // offices / archive corridors / mailrooms. No beds, no couches,
      // no library reading nooks in a corridor.
      themes = ['warehouse', 'office', 'archive', 'mailroom'];
    } else if (area < 30) {
      // Tiny open rooms — cozy / utility themes only.
      themes = ['bedroom', 'lobby', 'kitchen', 'infirmary', 'security'];
    } else if (area < 60) {
      // Mid-size open rooms — broader residential + clinical pool.
      // (Rare in practice — standard rooms are 324 m² so they fall
      // through to the "big" branch.)
      themes = ['bedroom', 'livingRoom', 'lobby', 'library', 'office',
        'kitchen', 'lab', 'server', 'archive', 'infirmary', 'security',
        'mailroom', 'gym'];
    } else {
      // Large open rooms — most rooms land here. Mix public / utility
      // / industrial / clinical / records themes so the floor reads
      // as a varied building. Bedroom / livingRoom / kitchen are
      // intentionally NOT here — a king bed centred in a 18×18 room
      // looked silly in early playtests; cozy themes stay gated to
      // the tiny branch above.
      themes = ['warehouse', 'library', 'lobby', 'office', 'garage',
        'server', 'archive', 'gym', 'lab', 'infirmary', 'security',
        'mailroom'];
    }
    // Prefer the biome pool when it exists. The biome designer is
    // explicitly stating "rooms on this floor read as the same kind
    // of building" — trust their pick over the area-based size pool
    // even when the size pool would otherwise exclude a theme.
    //
    // Utility-shape layouts (hallways, corridors, partitions) get
    // a constrained slice of the biome pool: themes whose templates
    // read fine in a long thin space. A corridor full of beds is
    // broken regardless of biome intent, so we intersect the biome
    // pool with the utility-friendly set. If the intersection is
    // empty (the biome's pool has no utility-shaped themes — rare),
    // fall back to the legacy utility list. Shop rooms keep their
    // forced 'shop' theme.
    const UTILITY_FRIENDLY = new Set(['warehouse', 'office', 'archive',
      'mailroom', 'server', 'garage', 'security']);
    let theme;
    if (SHOP_TYPES.has(room.type)) {
      theme = 'shop';
    } else if (biomePool && isUtility) {
      const filtered = {};
      for (const [k, w] of Object.entries(biomePool)) {
        if (UTILITY_FRIENDLY.has(k)) filtered[k] = w;
      }
      theme = Object.keys(filtered).length
        ? _pickWeighted(filtered)
        : themes[Math.floor(Math.random() * themes.length)];
    } else if (biomePool) {
      theme = _pickWeighted(biomePool)
        || themes[Math.floor(Math.random() * themes.length)];
    } else {
      theme = themes[Math.floor(Math.random() * themes.length)];
    }
    room.theme = theme;

    // Helpers — `placeAlongWall` hugs an outer wall; `placeInterior`
    // picks a random interior point that doesn't already collide.
    // EDGE_CLEAR bumped 1.4 → 1.7 because pillars/lockers with widened
    // collision footprints + tight axis-rotated couches were leaking
    // their visual base flange past the wall. 1.7 gives ~0.4m breathing
    // room even for the widest perimeter prop.
    const EDGE_CLEAR = 1.7;
    const INTERIOR_CLEAR = 2.4;
    const elev = room.elevatorCenter;

    const tooCloseToElev = (x, z) => {
      if (!elev) return false;
      const dx = x - elev.x, dz = z - elev.z;
      return dx * dx + dz * dz < 4 * 4;  // 4m exclusion around elevator
    };

    // Honor every disc registered in this._keepouts (boss exit, encounter
    // spawn). Cheap linear scan — typical keepouts list is 1-3 entries.
    const inKeepOut = (x, z) => {
      for (const k of this._keepouts) {
        const dx = x - k.x, dz = z - k.z;
        if (dx * dx + dz * dz < k.r * k.r) return true;
      }
      return false;
    };

    // Corner keep-out — AI struggles to clear interior corners (it gets
    // pinned against orthogonal walls trying to path around chunky
    // furniture). 1.6m radius from each room corner gives the navmesh
    // enough breathing room that grunts can hug the corner without
    // wedging on a couch arm.
    const CORNER_CLEAR = 1.6;
    const corners = [
      { x: b.minX, z: b.minZ },
      { x: b.maxX, z: b.minZ },
      { x: b.minX, z: b.maxZ },
      { x: b.maxX, z: b.maxZ },
    ];
    const inCorner = (x, z) => {
      for (const c of corners) {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < CORNER_CLEAR * CORNER_CLEAR) return true;
      }
      return false;
    };

    // Reject candidates that fall outside the shape template's
    // walkableBounds (e.g. lShape's cut quadrant, plaza's dais ring,
    // multiTier's platform footprint). placeAlongWall / _propFitsInBounds
    // only knew about room.bounds, so a planter / chair / cover block
    // could land in the sealed corner the player can't actually reach.
    // 0.4 m tolerance lets a wall-hugging prop straddle the seam between
    // walkable boxes that meet at an inside corner (lShape's elbow).
    const wbList = room._walkableBounds;
    const outsideWalkable = (x, z) => {
      if (!wbList || !wbList.length) return false;     // rect rooms — no constraint
      for (const wb of wbList) {
        if (x >= wb.minX - 0.4 && x <= wb.maxX + 0.4
            && z >= wb.minZ - 0.4 && z <= wb.maxZ + 0.4) return false;
      }
      return true;
    };

    // True when a prop's full footprint fits inside the room's bbox
    // — accounts for axis-aligned vs rotated yaw via the same
    // square-bound rule _registerProp uses for collision proxies.
    // Without this guard, low-EDGE_CLEAR placements with wide props
    // (bookshelves, couches) could push their visible mesh past
    // a room's outer wall and read as floating in the void.
    const _propFitsInBounds = (prop, x, z, yaw) => {
      // `footprint` covers walkable-but-bounded props (pallets — flat
      // floor objects that should still respect room walls + doorway
      // clearance even though the player can step over them).
      const col = prop.collision || prop.footprint;
      if (!col) return true;
      let w = col.w, d = col.d;
      const yawAbs = Math.abs(yaw || 0) % Math.PI;
      const axisAligned = yawAbs < 0.05 || Math.abs(yawAbs - Math.PI / 2) < 0.05;
      if (!axisAligned) {
        const bound = Math.max(w, d);
        w = bound; d = bound;
      } else if (Math.abs(yawAbs - Math.PI / 2) < 0.05) {
        [w, d] = [d, w];
      }
      // PAD widened 0.05 → 0.30 so the visible mesh stays well off the
      // wall — many props (pillar base flanges, couch back rests, bed
      // headboards) extend a few cm past their declared collision AABB,
      // and the old 5cm margin was letting those visual extensions
      // poke past room perimeters.
      const PAD = 0.30;
      return (x - w / 2) >= b.minX + PAD && (x + w / 2) <= b.maxX - PAD
          && (z - d / 2) >= b.minZ + PAD && (z + d / 2) <= b.maxZ - PAD;
    };

    // AABB-vs-AABB rejection using the prop's actual rotated footprint
    // plus a margin. The center-radius `_collidesAt` test is still used
    // as a cheap coarse pass; this runs after to catch overlaps the
    // radius approximation misses (long thin props next to a column,
    // two desks placed corner-to-corner, etc.) and to enforce a real
    // walking gap between props instead of letting them touch.
    const PROP_GAP = 0.45;
    // Phase M step 4 — door clearance band. Cache every door's
    // footprint + axis once per call so the prop-placement test
    // can reject any candidate that lands within DOOR_WIDTH/2 + 1m
    // along the door's axis. Stops props from spawning inside the
    // doorway approach and pinning the player at the threshold.
    const _doorBands = [];
    {
      const halfBand = DOOR_WIDTH / 2 + 1.0;
      const inwardDepth = 2.5;   // band reach into both rooms
      for (const o of this.obstacles) {
        if (!o.userData?.isDoor) continue;
        const dx = o.userData.cx, dz = o.userData.cz;
        const geo = o.geometry?.parameters;
        const horiz = (geo?.width || 0) > (geo?.depth || 0);
        if (horiz) {
          _doorBands.push({
            minX: dx - halfBand, maxX: dx + halfBand,
            minZ: dz - inwardDepth, maxZ: dz + inwardDepth,
          });
        } else {
          _doorBands.push({
            minX: dx - inwardDepth, maxX: dx + inwardDepth,
            minZ: dz - halfBand, maxZ: dz + halfBand,
          });
        }
      }
    }
    const _propFootprintFree = (x, z, prop, yaw) => {
      const col = prop.collision || prop.footprint;
      if (!col) return true;
      let w = col.w, d = col.d;
      const yawAbs = Math.abs(yaw || 0) % Math.PI;
      const axisAligned = yawAbs < 0.05 || Math.abs(yawAbs - Math.PI / 2) < 0.05;
      if (!axisAligned) {
        const bound = Math.max(w, d);
        w = bound; d = bound;
      } else if (Math.abs(yawAbs - Math.PI / 2) < 0.05) {
        [w, d] = [d, w];
      }
      const halfW = w / 2 + PROP_GAP;
      const halfD = d / 2 + PROP_GAP;
      // Door clearance — reject if the prop's footprint overlaps
      // any door band.
      for (let i = 0; i < _doorBands.length; i++) {
        const db = _doorBands[i];
        if (x + halfW <= db.minX) continue;
        if (x - halfW >= db.maxX) continue;
        if (z + halfD <= db.minZ) continue;
        if (z - halfD >= db.maxZ) continue;
        return false;
      }
      for (const o of this.obstacles) {
        const ob = o.userData.collisionXZ;
        if (!ob) continue;
        if (x + halfW <= ob.minX) continue;
        if (x - halfW >= ob.maxX) continue;
        if (z + halfD <= ob.minZ) continue;
        if (z - halfD >= ob.maxZ) continue;
        return false;
      }
      // Also check decoration-only footprints (rugs, lamps, vases, TVs).
      // These don't have collision proxies in `obstacles`, so without
      // this pass two decoration props can stack and a substantive prop
      // can land on top of one.
      const fps = this._propFootprints;
      if (fps && fps.length) {
        for (let i = 0; i < fps.length; i++) {
          const fp = fps[i];
          if (x + halfW <= fp.minX) continue;
          if (x - halfW >= fp.maxX) continue;
          if (z + halfD <= fp.minZ) continue;
          if (z - halfD >= fp.maxZ) continue;
          return false;
        }
      }
      return true;
    };

    // Custom prop-vs-prop overlap check that skips perimeter walls.
    // Used by both placeAlongWall and placeBackToWall (the latter
    // duplicates this body inline for clarity, but the rules are
    // identical — they both want to avoid OTHER props + door
    // approaches without the perimeter wall counting as a
    // collision). PROP_GAP at 0.30 instead of the standard 0.45
    // because wall-hugging rows of props (e.g. lockers, server
    // racks) can sit close together along the same wall without
    // pathing problems.
    const _wallPropOverlap = (px, pz, pw, pd, pyaw) => {
      const yawAbs = Math.abs(pyaw || 0) % Math.PI;
      let aw = pw, ad = pd;
      const axisAligned = yawAbs < 0.05 || Math.abs(yawAbs - Math.PI / 2) < 0.05;
      if (!axisAligned) { const m = Math.max(aw, ad); aw = m; ad = m; }
      else if (Math.abs(yawAbs - Math.PI / 2) < 0.05) { const t = aw; aw = ad; ad = t; }
      const PG = 0.30;
      const halfW = aw / 2 + PG;
      const halfD = ad / 2 + PG;
      for (let i = 0; i < _doorBands.length; i++) {
        const db = _doorBands[i];
        if (px + halfW <= db.minX) continue;
        if (px - halfW >= db.maxX) continue;
        if (pz + halfD <= db.minZ) continue;
        if (pz - halfD >= db.maxZ) continue;
        return false;
      }
      for (const o of this.obstacles) {
        const ud = o.userData;
        if (!ud || !ud.collisionXZ) continue;
        if (!ud.isProp && !ud.containerRef) continue;
        const ob = ud.collisionXZ;
        if (px + halfW <= ob.minX) continue;
        if (px - halfW >= ob.maxX) continue;
        if (pz + halfD <= ob.minZ) continue;
        if (pz - halfD >= ob.maxZ) continue;
        return false;
      }
      const fps = this._propFootprints;
      if (fps && fps.length) {
        for (let i = 0; i < fps.length; i++) {
          const fp = fps[i];
          if (px + halfW <= fp.minX) continue;
          if (px - halfW >= fp.maxX) continue;
          if (pz + halfD <= fp.minZ) continue;
          if (pz - halfD >= fp.maxZ) continue;
          return false;
        }
      }
      return true;
    };

    const placeAlongWall = (prop, opts = {}) => {
      const yaw = opts.yaw;       // if provided, override rotation
      const col = prop.collision;
      // The coarse _collidesAt pass below was rejecting large props
      // (bed d=2.0, couch d=1.9) against the perimeter wall — the
      // radius ended up bigger than the prop's clearance to the
      // wall, so every wall-side candidate failed. _wallPropOverlap
      // does the fine-grained AABB pass with walls excluded; PROP_GAP
      // there enforces 0.30m prop-to-prop spacing without the
      // perimeter wall poisoning it. Bedroom / livingRoom / lobby
      // themes were averaging 1.9-2.9 props per room before this
      // fix because beds + couches kept failing.
      for (let tries = 0; tries < 25; tries++) {
        const side = Math.floor(Math.random() * 4);
        // Bias t away from corners (0.22 → 0.78 instead of 0.15 → 0.85)
        // so wall-hugging props don't stack into the corner bay where
        // AI has trouble pathing around them.
        const t = 0.22 + Math.random() * 0.56;
        let x, z, facing;
        if (side === 0)      { x = b.minX + t * roomW; z = b.minZ + EDGE_CLEAR; facing = 0; }
        else if (side === 1) { x = b.maxX - EDGE_CLEAR; z = b.minZ + t * roomD; facing = -Math.PI / 2; }
        else if (side === 2) { x = b.minX + t * roomW; z = b.maxZ - EDGE_CLEAR; facing = Math.PI; }
        else                 { x = b.minX + EDGE_CLEAR; z = b.minZ + t * roomD; facing = Math.PI / 2; }
        if (tooCloseToElev(x, z)) continue;
        if (inKeepOut(x, z)) continue;
        if (inCorner(x, z)) continue;
        if (outsideWalkable(x, z)) continue;
        const finalYaw = yaw ?? facing;
        if (!_propFitsInBounds(prop, x, z, finalYaw)) continue;
        if (col && !_wallPropOverlap(x, z, col.w, col.d, finalYaw)) continue;
        prop.group.position.set(x, 0, z);
        prop.group.rotation.y = finalYaw;
        return this._registerProp(prop);
      }
      return false;
    };

    // Variant of placeAlongWall that pins the prop's BACK to the wall
    // (center at depth/2 + small gap). placeAlongWall uses EDGE_CLEAR
    // ~1.7m for the prop center, which leaves ~1.5m of walkable space
    // BEHIND a thin bookshelf — visually reads as "shelf floating mid-
    // room with no collision." This placer accounts for the prop's
    // collision depth so the visible back panel is actually flush
    // with the wall.
    const placeBackToWall = (prop, opts = {}) => {
      const yaw = opts.yaw;
      const col = prop.collision;
      if (!col) return placeAlongWall(prop, opts);
      // The room's bounds.minX/Z mark the CENTRE of the perimeter
      // wall (thickness WALL_THICK = 1.2m, so the wall spans
      // bounds±0.6). wallGap puts the prop's back flush against
      // the wall's INTERIOR face. Same wall-collision avoidance as
      // placeAlongWall via _wallPropOverlap.
      const HALF_WALL = 0.6;
      const wallGap = col.d / 2 + HALF_WALL + 0.05;
      for (let tries = 0; tries < 25; tries++) {
        const side = Math.floor(Math.random() * 4);
        const t = 0.22 + Math.random() * 0.56;
        let x, z, facing;
        if (side === 0)      { x = b.minX + t * roomW; z = b.minZ + wallGap;       facing = 0; }
        else if (side === 1) { x = b.maxX - wallGap;   z = b.minZ + t * roomD;     facing = -Math.PI / 2; }
        else if (side === 2) { x = b.minX + t * roomW; z = b.maxZ - wallGap;       facing = Math.PI; }
        else                 { x = b.minX + wallGap;   z = b.minZ + t * roomD;     facing = Math.PI / 2; }
        if (tooCloseToElev(x, z)) continue;
        if (inKeepOut(x, z)) continue;
        if (inCorner(x, z)) continue;
        if (outsideWalkable(x, z)) continue;
        const finalYaw = yaw ?? facing;
        if (!_propFitsInBounds(prop, x, z, finalYaw)) continue;
        if (!_wallPropOverlap(x, z, col.w, col.d, finalYaw)) continue;
        prop.group.position.set(x, 0, z);
        prop.group.rotation.y = finalYaw;
        return this._registerProp(prop);
      }
      return false;
    };

    // Pick a yaw that points the prop's local +Z (its "front") toward
    // the room centre. Snapped to 0 / 90 / 180 / 270 so the prop stays
    // axis-aligned with walls and the AABB collision proxy works
    // cleanly. Centre is room.cx/cz; whichever axis has the bigger
    // delta picks the snap angle.
    const cxC = (b.minX + b.maxX) / 2;
    const czC = (b.minZ + b.maxZ) / 2;
    const yawTowardCenter = (x, z) => {
      const dx = cxC - x;
      const dz = czC - z;
      // Pick the dominant axis so a chair on the east wall faces
      // west (toward centre) instead of north/south.
      if (Math.abs(dx) > Math.abs(dz)) {
        return dx > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      return dz > 0 ? 0 : Math.PI;
    };

    const placeInterior = (prop) => {
      const col = prop.collision;
      const radius = col ? Math.max(col.w, col.d) * 0.7 + 0.6 : 1.2;
      // Directional props (chair, couch, desk, tv, bed) face the room
      // centre. Non-directional kinds (vase, lamp, planter, crate,
      // barrel, table, coffeeTable) still get a random yaw — they
      // read the same from every angle and a 4-way variety reads as
      // less canned.
      const facesInward = prop.kind && INWARD_FACING_KINDS.has(prop.kind);
      for (let tries = 0; tries < 25; tries++) {
        const x = b.minX + INTERIOR_CLEAR + Math.random() * (roomW - INTERIOR_CLEAR * 2);
        const z = b.minZ + INTERIOR_CLEAR + Math.random() * (roomD - INTERIOR_CLEAR * 2);
        if (tooCloseToElev(x, z)) continue;
        if (inKeepOut(x, z)) continue;
        if (inCorner(x, z)) continue;
        if (outsideWalkable(x, z)) continue;
        if (this._collidesAt(x, z, radius)) continue;
        const yaw = facesInward
          ? yawTowardCenter(x, z)
          : (Math.floor(Math.random() * 4)) * Math.PI / 2;
        if (!_propFitsInBounds(prop, x, z, yaw)) continue;
        if (!_propFootprintFree(x, z, prop, yaw)) continue;
        prop.group.position.set(x, 0, z);
        prop.group.rotation.y = yaw;
        return this._registerProp(prop);
      }
      return false;
    };

    // Lootable-prop integration. Some prop kinds *read* as places loot
    // would live — desks, lockers, bookshelves, cabinets, nightstands,
    // crates, barrels. After they're placed, roll a chance to mark them
    // as containers (the visible mesh stays; the player gets a "Search
    // <prop>" prompt instead of a separate chest). Cuts visual chest
    // clutter without losing loot density.
    // Per-prop chance to flag the placed prop as lootable. With themed
    // rooms placing 4-8 props each and most levels having 5+ themed
    // rooms, the prior values (30-55% per prop) were producing ~12-24
    // lootable props per level on top of the dedicated chests + body
    // drops. Playtest: "user is saying theres about 3x more loot than
    // before and its become unmanagable ... we need props to not
    // always have loot in them." Cut every chance to ~1/3 so the
    // typical level surfaces 4-8 lootable props instead of 12-24.
    const LOOT_PROP_CONFIG = {
      desk:       { p: 0.15, type: () => Math.random() < 0.4 ? 'weapon' : 'general',  size: 'm' },
      bookshelf:  { p: 0.10, type: () => Math.random() < 0.5 ? 'medical' : 'general', size: 'm' },
      cabinet:    { p: 0.15, type: () => Math.random() < 0.4 ? 'medical' : 'general', size: 'm' },
      locker:     { p: 0.18, type: () => Math.random() < 0.5 ? 'armor' : 'weapon',    size: 'm' },
      nightstand: { p: 0.12, type: () => Math.random() < 0.6 ? 'medical' : 'general', size: 's' },
      crate:      { p: 0.16, type: () => Math.random() < 0.4 ? 'weapon' : 'general',  size: 'm' },
      barrel:     { p: 0.12, type: () => 'general',                                    size: 's' },
      pallet:     { p: 0.13, type: () => 'general',                                    size: 'm' },
    };
    const placeLootable = (kind, placer) => {
      const prop = buildProp(kind);
      if (!prop) return false;
      prop._lootKind = kind;
      const ok = placer(prop);
      if (!ok) return false;
      const cfg = LOOT_PROP_CONFIG[kind];
      if (cfg && Math.random() < cfg.p) {
        this._markPropLootable(prop, cfg.type(), cfg.size);
      }
      return true;
    };

    // Pair a chair with the prop just placed (desk, table, coffeeTable).
    // Tries each of the 4 cardinal sides of the table; first slot that
    // passes collision + bounds gets the chair. Chair faces the table
    // (not the room centre — the table IS the focal point). Silent
    // failure if every side is blocked — pairing is a polish bonus.
    // Anchor's world-frame AABB extents. Reads from collision OR
    // footprint (so walkable-but-bounded props like pallets contribute
    // their visible size). Returns null if the prop has neither.
    const _anchorWD = (anchor) => {
      const col = anchor.collision || anchor.footprint;
      if (!col) return null;
      const yaw = anchor.group.rotation.y || 0;
      let w = col.w, d = col.d;
      const yawAbs = Math.abs(yaw) % Math.PI;
      if (Math.abs(yawAbs - Math.PI / 2) < 0.05) [w, d] = [d, w];
      return { w, d };
    };

    // Generic "place a prop adjacent to an anchor" helper. Tries each
    // of the 4 cardinal sides; first slot that passes collision +
    // bounds wins. `facing` controls how the new prop is rotated:
    //   - 'inward'  — local +Z points back at the anchor (chair behind
    //                 a desk, end-table beside a couch)
    //   - 'match'   — same yaw as the anchor (nightstand against the
    //                 same wall as the bed)
    //   - 'outward' — local +Z points away from the anchor
    // `preferSide` (optional, 'left'|'right'|'front'|'back') biases
    // toward one side and falls through if blocked.
    const _placeAdjacent = (anchor, kind, opts = {}) => {
      if (!anchor) return null;
      const wd = _anchorWD(anchor);
      if (!wd) return null;
      const ax = anchor.group.position.x;
      const az = anchor.group.position.z;
      const aYaw = anchor.group.rotation.y || 0;
      const prop = buildProp(kind);
      if (!prop) return null;
      const pcol = prop.collision || prop.footprint;
      const pw = pcol ? pcol.w : 0.4;
      const pd = pcol ? pcol.d : 0.4;
      const facing = opts.facing || 'inward';
      const gap = opts.gap ?? 0.05;
      const slots = [
        { dx:  (wd.w / 2 + pd / 2 + gap), dz: 0,                          dir:  Math.PI / 2 },
        { dx: -(wd.w / 2 + pd / 2 + gap), dz: 0,                          dir: -Math.PI / 2 },
        { dx: 0,                          dz:  (wd.d / 2 + pd / 2 + gap), dir:  0 },
        { dx: 0,                          dz: -(wd.d / 2 + pd / 2 + gap), dir:  Math.PI },
      ];
      const yawFor = (dir) => {
        if (facing === 'match')   return aYaw;
        if (facing === 'outward') return dir;
        return dir + Math.PI;       // inward — face back at the anchor
      };
      let order = slots;
      if (opts.preferSide) {
        const map = { right: 0, left: 1, back: 2, front: 3 };
        const i = map[opts.preferSide];
        if (i != null) order = [slots[i], ...slots.filter((_, k) => k !== i)];
      } else {
        order = slots.slice().sort(() => Math.random() - 0.5);
      }
      for (const s of order) {
        const x = ax + s.dx, z = az + s.dz;
        if (tooCloseToElev(x, z)) continue;
        if (inKeepOut(x, z)) continue;
        if (outsideWalkable(x, z)) continue;
        const radius = Math.max(pw, pd) * 0.7 + 0.4;
        if (this._collidesAt(x, z, radius)) continue;
        const yaw = yawFor(s.dir);
        if (!_propFitsInBounds(prop, x, z, yaw)) continue;
        if (!_propFootprintFree(x, z, prop, yaw)) continue;
        prop.group.position.set(x, 0, z);
        prop.group.rotation.y = yaw;
        if (this._registerProp(prop)) return prop;
        return null;
      }
      return null;
    };

    // Place a prop ACROSS the room from anchor — used for the
    // tv-across-from-couch pattern. Walks outward along the anchor's
    // local +Z (its "front") until a valid spot lands, points the new
    // prop back at the anchor.
    const _placeAcross = (anchor, kind, opts = {}) => {
      if (!anchor) return null;
      const ax = anchor.group.position.x;
      const az = anchor.group.position.z;
      const aYaw = anchor.group.rotation.y || 0;
      const fx = -Math.sin(aYaw);
      const fz =  Math.cos(aYaw);
      const prop = buildProp(kind);
      if (!prop) return null;
      const pcol = prop.collision || prop.footprint;
      const pw = pcol ? pcol.w : 0.6;
      const pd = pcol ? pcol.d : 0.6;
      const minDist = opts.minDist ?? 2.5;
      const maxDist = opts.maxDist ?? 6.0;
      // Try furthest first so the tv ends up against the far wall.
      for (let step = 6; step >= 0; step--) {
        const t = minDist + (maxDist - minDist) * (step / 6);
        const x = ax + fx * t, z = az + fz * t;
        if (tooCloseToElev(x, z)) continue;
        if (inKeepOut(x, z)) continue;
        if (outsideWalkable(x, z)) continue;
        const radius = Math.max(pw, pd) * 0.7 + 0.4;
        if (this._collidesAt(x, z, radius)) continue;
        const yaw = aYaw + Math.PI;
        if (!_propFitsInBounds(prop, x, z, yaw)) continue;
        if (!_propFootprintFree(x, z, prop, yaw)) continue;
        prop.group.position.set(x, 0, z);
        prop.group.rotation.y = yaw;
        if (this._registerProp(prop)) return prop;
        return null;
      }
      return null;
    };

    // Backwards-compatible chair-pairing wrapper.
    const _addChairBy = (anchor) => !!_placeAdjacent(anchor, 'chair', { facing: 'inward' });

    // Build a prop, place it via `placer`, then optionally pair a
    // chair next to it. Returns the placed prop (so the caller can
    // mark it lootable, etc.) or null on failure.
    const placeWithChair = (kind, placer, chairChance = 0.6) => {
      const prop = buildProp(kind);
      if (!prop) return null;
      const ok = placer(prop);
      if (!ok) return null;
      if (Math.random() < chairChance) _addChairBy(prop);
      return prop;
    };

    // Helper — anchor a prop placement, then optionally mark the
    // anchor lootable per LOOT_PROP_CONFIG. Wraps the common pattern
    // of "place X, roll loot chance" so each composed arrangement
    // reads as a recipe instead of a 4-line dance.
    // Treasure rooms force every lootable prop to surface loot (bypass
    // the per-prop probability gate) and pass forceFull+rarityBias
    // through _markPropLootable's container build. Same effect as
    // _scatterContainers's treasure branch but for the themed-prop
    // path (desks, lockers, cabinets, ...).
    const _isTreasureRoom = room.type === 'treasure';
    const _maybeLoot = (prop) => {
      if (!prop || !prop.kind) return prop;
      const cfg = LOOT_PROP_CONFIG[prop.kind];
      if (!cfg) return prop;
      const fire = _isTreasureRoom || (Math.random() < cfg.p);
      if (fire) {
        this._markPropLootable(prop, cfg.type(), cfg.size,
          _isTreasureRoom ? { forceFull: true, rarityBias: 1.4 } : undefined);
      }
      return prop;
    };

    // Per-theme placement scripts. Each theme composes a small
    // ARRANGEMENT instead of scattering pieces independently — the
    // bedroom's nightstand sits at the head of the bed, the living
    // room's coffee table sits in front of the couch, the office's
    // chair sits behind its desk.
    // Build + place + mark-loot in one call. Returns the placed prop
    // (or null) so a caller can chain adjacency placements off it.
    const _placeAndLoot = (kind, placer) => {
      const prop = buildProp(kind);
      if (!prop) return null;
      if (!placer(prop)) return null;
      _maybeLoot(prop);
      return prop;
    };

    // -----------------------------------------------------------------
    // Template dispatch — replaces the per-theme inline ladder with a
    // single call into room_templates.js. The templates encode the
    // same recipes (bookshelves on wall, desk + chair, couch +
    // coffeeTable + tv, etc.) but with bumped density per the design:
    //   - bookshelves min 2 max 4 instead of 1 max 2
    //   - tables guaranteed 4 chairs when space allows
    //   - warehouse stacks 2-3 crates not 1-2
    //   - office gets 2 workstations baseline (not 1 + chance for 2)
    //
    // If pickTemplateForRoom returns null (room is smaller than every
    // template's minSize, which is rare for normal 18x18 rooms) we
    // fall through to the legacy inline arrangement below.
    // -----------------------------------------------------------------
    const _templateHelpers = {
      placeAlongWall, placeBackToWall, placeInterior,
      _placeAdjacent, _placeAcross, _placeAndLoot,
      buildProp, _maybeLoot,
    };
    const _tpl = pickTemplateForRoom(room, theme);
    let _templateApplied = false;
    if (_tpl) {
      const result = applyTemplate(this, room, _tpl, _templateHelpers);
      // Stash the template id on the room so the smoke harness +
      // probe can verify a template ran.
      room._appliedTemplateId = _tpl.id;
      // Consider the template applied if at least one prop landed —
      // a 0-prop result usually means every wall slot was already
      // taken by cover, in which case the legacy inline path won't
      // do better either.
      _templateApplied = result.placed > 0;
    }
    if (!_templateApplied) {
      // Legacy inline arrangements — single-prop fallbacks per theme.
      // Kept thin because the templates above cover the rich cases;
      // this just guarantees a room isn't completely empty if the
      // template selection couldn't find a fit.
      if (theme === 'library') {
        _placeAndLoot('bookshelf', placeBackToWall);
        _placeAndLoot('bookshelf', placeBackToWall);
      } else if (theme === 'lobby') {
        const couch = buildProp('couch');
        if (couch && placeAlongWall(couch)) {
          _placeAdjacent(couch, 'coffeeTable', { facing: 'match', preferSide: 'front', gap: 0.30 });
        }
      } else if (theme === 'bedroom') {
        const bed = buildProp('bed');
        if (bed && placeAlongWall(bed)) {
          _placeAdjacent(bed, 'nightstand', { facing: 'match', preferSide: 'right', gap: 0.05 });
        }
      } else if (theme === 'livingRoom') {
        const couch = buildProp('couch');
        if (couch && placeAlongWall(couch)) {
          _placeAdjacent(couch, 'coffeeTable', { facing: 'match', preferSide: 'front', gap: 0.40 });
        }
      } else if (theme === 'warehouse') {
        const c1 = buildProp('crate');
        if (c1 && placeAlongWall(c1)) _maybeLoot(c1);
      } else if (theme === 'office') {
        const desk = buildProp('desk');
        if (desk && placeAlongWall(desk)) {
          _maybeLoot(desk);
          _placeAdjacent(desk, 'chair', { facing: 'inward', preferSide: 'front' });
        }
      } else if (theme === 'kitchen') {
        const table = buildProp('table');
        if (table && placeInterior(table)) {
          _placeAdjacent(table, 'chair', { facing: 'inward' });
          _placeAdjacent(table, 'chair', { facing: 'inward' });
        }
      } else if (theme === 'garage') {
        const bench = buildProp('bench');
        if (bench && placeAlongWall(bench)) {
          _placeAdjacent(bench, 'crate', { facing: 'match', preferSide: 'left' });
        }
      } else if (theme === 'gym') {
        // 1-2 lockers + a bench; minimum viable gym read.
        _placeAndLoot('locker', placeBackToWall);
        const bench = buildProp('bench');
        if (bench) placeInterior(bench);
      } else if (theme === 'lab') {
        const desk = buildProp('desk');
        if (desk && placeInterior(desk)) {
          _maybeLoot(desk);
          _placeAdjacent(desk, 'chair', { facing: 'inward', preferSide: 'right' });
        }
        _placeAndLoot('cabinet', placeBackToWall);
      } else if (theme === 'server') {
        // Two pillars (server racks) + a cabinet.
        const r1 = buildProp('pillar');
        if (r1) placeAlongWall(r1);
        const r2 = buildProp('pillar');
        if (r2) placeAlongWall(r2);
        _placeAndLoot('cabinet', placeBackToWall);
      } else if (theme === 'archive') {
        _placeAndLoot('bookshelf', placeBackToWall);
        _placeAndLoot('cabinet', placeBackToWall);
      } else if (theme === 'infirmary') {
        const cot = buildProp('bed');
        if (cot && placeAlongWall(cot)) {
          _placeAdjacent(cot, 'nightstand', { facing: 'match', preferSide: 'right' });
        }
        _placeAndLoot('cabinet', placeBackToWall);
      } else if (theme === 'security') {
        const desk = buildProp('desk');
        if (desk && placeAlongWall(desk)) {
          _maybeLoot(desk);
          _placeAdjacent(desk, 'chair', { facing: 'inward', preferSide: 'front' });
        }
        const tv = buildProp('tv');
        if (tv) placeAlongWall(tv);
      } else if (theme === 'mailroom') {
        // Sorting table + locker rows.
        const table = buildProp('table');
        if (table) placeInterior(table);
        _placeAndLoot('locker', placeBackToWall);
        _placeAndLoot('locker', placeBackToWall);
      } else if (theme === 'shop') {
        // Vendor fallback — display cabinets + stock shelves so the
        // shop never reads as an empty box even if templates miss.
        _placeAndLoot('cabinet', placeBackToWall);
        _placeAndLoot('cabinet', placeBackToWall);
        _placeAndLoot('bookshelf', placeBackToWall);
      }
    }

    // -----------------------------------------------------------------
    // Theme sprinkle — ARCHITECTURAL / AMBIENCE ONLY. The level theme's
    // propWeights is curated to skip furniture (props.js comment)
    // because scattering beds / couches / bookshelves across every
    // combat room produced visibly broken results: bed in a hallway,
    // bookshelf floating mid-room. Furniture is locked to the per-
    // room theme branch above; this sprinkle only places architectural
    // dressing (pillars / planters / lamps / windows / vases / rugs /
    // door frames / railings / neonSticks) plus the loot-container
    // ambience kinds (locker / crate / barrel / pallet).
    //
    // Placement rules:
    //   - Planters spawn in symmetric pairs flanking a door, OR in a
    //     room corner. Never strewn in the middle.
    //   - Pillars / railings / windows / neonSticks / doorFrames hug
    //     the perimeter. No interior fallback — if the wall slot is
    //     full, we just skip rather than dropping the prop in the
    //     middle of the floor.
    //   - Lamps + vases + rugs ARE allowed interior (small, decorative).
    //   - Loot ambience (locker / crate / barrel / pallet) goes against
    //     a wall first; falls back to interior only for crates / barrels
    //     which read fine free-standing.
    // -----------------------------------------------------------------
    if (this.theme && this.theme.propWeights && room.type !== 'start') {
      const weights = this.theme.propWeights;
      const kinds = Object.keys(weights);
      if (kinds.length) {
        let total = 0;
        const cumulative = kinds.map(k => (total += weights[k], total));
        const pickThemed = () => {
          const r = Math.random() * total;
          for (let i = 0; i < kinds.length; i++) {
            if (r < cumulative[i]) return kinds[i];
          }
          return kinds[kinds.length - 1];
        };

        // PERIMETER-ONLY — wall placement only, no interior fallback.
        const PERIMETER_KINDS = new Set([
          'pillar', 'railing', 'window', 'doorFrame', 'neonStick',
        ]);
        // No interior-friendly random kinds remain. Lamps go through
        // _decorateRoomLamps (symmetric corners). Vases were "bottles
        // on the floor." Rugs were "red carpet tiles, randomly
        // placed" — they need anchored placement (under a kiosk /
        // encounter disc) to read deliberate, so for now they only
        // come from the per-room theme branches that explicitly call
        // for them.
        const INTERIOR_OK = new Set();
        // Loot ambience — wall-first, but crates / barrels are OK
        // free-standing if the wall is full.
        const LOOT_AMBIENCE = new Set(['locker', 'crate', 'barrel', 'pallet']);

        // Symmetric door-flanking planters. Pick one of the room's
        // doors; place a planter on each side along the inner-room
        // axis perpendicular to the door normal. Reads as an entryway
        // welcome motif instead of "random plant in the corridor."
        const _flankDoorWithPlanters = () => {
          const doors = this.obstacles.filter(o =>
            o.userData.isDoor && o.userData.connects?.includes(room.id));
          if (!doors.length) return false;
          const door = doors[Math.floor(Math.random() * doors.length)];
          const dx = door.userData.cx, dz = door.userData.cz;
          // Door geometry width tells us which axis it spans.
          const horiz = (door.geometry?.parameters?.width || 4)
                      > (door.geometry?.parameters?.depth || 1.2);
          const offset = 1.1;
          const insetIntoRoom = 1.2;
          const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
          // Direction inward (room centre relative to door).
          const inDX = Math.sign(cx - dx);
          const inDZ = Math.sign(cz - dz);
          const slots = horiz
            ? [
                { x: dx - offset, z: dz + (inDZ || 1) * insetIntoRoom },
                { x: dx + offset, z: dz + (inDZ || 1) * insetIntoRoom },
              ]
            : [
                { x: dx + (inDX || 1) * insetIntoRoom, z: dz - offset },
                { x: dx + (inDX || 1) * insetIntoRoom, z: dz + offset },
              ];
          let placed = 0;
          for (const s of slots) {
            const prop = buildProp('planter');
            if (!prop) continue;
            if (tooCloseToElev(s.x, s.z)) continue;
            if (inKeepOut(s.x, s.z)) continue;
            if (outsideWalkable(s.x, s.z)) continue;
            const radius = Math.max(prop.collision.w, prop.collision.d) * 0.7 + 0.4;
            if (this._collidesAt(s.x, s.z, radius)) continue;
            if (!_propFitsInBounds(prop, s.x, s.z, 0)) continue;
            if (!_propFootprintFree(s.x, s.z, prop, 0)) continue;
            prop.group.position.set(s.x, 0, s.z);
            prop.group.rotation.y = 0;
            if (this._registerProp(prop)) placed++;
          }
          return placed > 0;
        };

        // Corner planter — try each of the 4 room corners offset
        // inward; first slot that fits wins. Falls back to a normal
        // wall placement if every corner is blocked.
        const _placeCornerPlanter = () => {
          const inset = 1.5;
          const corners = [
            { x: b.minX + inset, z: b.minZ + inset },
            { x: b.maxX - inset, z: b.minZ + inset },
            { x: b.minX + inset, z: b.maxZ - inset },
            { x: b.maxX - inset, z: b.maxZ - inset },
          ].sort(() => Math.random() - 0.5);
          for (const c of corners) {
            const prop = buildProp('planter');
            if (!prop) continue;
            if (tooCloseToElev(c.x, c.z)) continue;
            if (inKeepOut(c.x, c.z)) continue;
            if (outsideWalkable(c.x, c.z)) continue;
            const radius = Math.max(prop.collision.w, prop.collision.d) * 0.7 + 0.4;
            if (this._collidesAt(c.x, c.z, radius)) continue;
            if (!_propFitsInBounds(prop, c.x, c.z, 0)) continue;
            if (!_propFootprintFree(c.x, c.z, prop, 0)) continue;
            prop.group.position.set(c.x, 0, c.z);
            prop.group.rotation.y = 0;
            if (this._registerProp(prop)) return true;
          }
          // Last resort — wall slot.
          const prop = buildProp('planter');
          return prop ? placeAlongWall(prop) : false;
        };

        // Pair planters on either side of one door before the random
        // sprinkle runs — deliberate entryway dressing.
        if ((weights.planter || 0) > 0 && Math.random() < 0.65) {
          _flankDoorWithPlanters();
        }

        const count = (room.type === 'boss' ? 3 : 2)
                    + (Math.random() < 0.4 ? 1 : 0);
        for (let i = 0; i < count; i++) {
          const kind = pickThemed();

          if (kind === 'planter') {
            // Planter: try a corner; fall back to a wall slot. Never
            // drop interior.
            _placeCornerPlanter();
            continue;
          }

          if (PERIMETER_KINDS.has(kind)) {
            // Wall-only. Silently skip if no slot.
            const prop = buildProp(kind);
            if (prop) placeAlongWall(prop);
            continue;
          }

          if (LOOT_AMBIENCE.has(kind)) {
            const wallTry = placeLootable(kind, placeAlongWall);
            if (!wallTry && (kind === 'crate' || kind === 'barrel')) {
              placeLootable(kind, placeInterior);
            }
            continue;
          }

          if (INTERIOR_OK.has(kind)) {
            const prop = buildProp(kind);
            if (!prop) continue;
            // Lamps + vases + rugs interior — no fallback to wall (a
            // wall-mounted lamp reads odd in this catalog).
            placeInterior(prop);
            continue;
          }

          // Anything else (shouldn't fire under the new whitelist) —
          // wall-first, no fallback.
          const prop = buildProp(kind);
          if (prop) placeAlongWall(prop);
        }
      }
    }
  }



  // Register a built prop: add its group to the scene and, if it
  // carries a collision AABB, create an invisible collision proxy
  // mesh (one real box matching the prop's footprint) and push it
  // onto the obstacles list. Using a dedicated proxy means:
  //   1) A single raycast target for the whole prop (better than
  //      exposing only one random child mesh of a multi-part prop),
  //   2) Movement collision + LoS / bullet raycasts both work,
  //   3) The door-corridor clear pass can hide the whole prop group
  //      by flipping `propGroup.visible = false` when it touches a
  //      doorway strip.
  // Symmetric floor-lamp configuration. Tries each of the 4 inset
  // corners (1.4m off both walls) plus, for big rooms, two midpoints
  // along the long axis. Skips any slot blocked by walls, props,
  // elevators, or registered keep-outs. Lamps are visual-only
  // (collision: null) so they never affect movement; we still skip
  // overlapping slots so a lamp doesn't clip into a couch arm.
  //
  // Decorations[] tracks the visual group so a level regen tears
  // down the lamp meshes cleanly — buildProp returns a Group not
  // an obstacle proxy for collision-null props, so without this
  // tracking the lamps would leak across regens.
  _decorateRoomLamps(room) {
    const b = room.bounds;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const inset = 1.4;
    // Skip rooms too small to fit four corner lamps (smaller than
    // 2*inset+1m on either axis would clip the lamps into each other
    // or the elevator capsule).
    if (w < 2 * inset + 1 || d < 2 * inset + 1) return;
    const slots = [
      { x: b.minX + inset, z: b.minZ + inset },
      { x: b.maxX - inset, z: b.minZ + inset },
      { x: b.minX + inset, z: b.maxZ - inset },
      { x: b.maxX - inset, z: b.maxZ - inset },
    ];
    // Big rooms add 2 midpoint lamps along the longer axis to keep
    // the centre lit without breaking symmetry.
    if (w >= 14 && d >= 8) {
      slots.push(
        { x: (b.minX + b.maxX) / 2, z: b.minZ + inset },
        { x: (b.minX + b.maxX) / 2, z: b.maxZ - inset },
      );
    } else if (d >= 14 && w >= 8) {
      slots.push(
        { x: b.minX + inset, z: (b.minZ + b.maxZ) / 2 },
        { x: b.maxX - inset, z: (b.minZ + b.maxZ) / 2 },
      );
    }
    const elev = room.elevatorCenter;
    const ELEV_R2 = 4 * 4;
    for (const s of slots) {
      // Skip if too close to the elevator capsule.
      if (elev) {
        const ex = s.x - elev.x, ez = s.z - elev.z;
        if (ex * ex + ez * ez < ELEV_R2) continue;
      }
      // Skip keep-outs (boss exit ring, encounter spawn).
      let blocked = false;
      if (this._keepouts) {
        for (const k of this._keepouts) {
          const kx = s.x - k.x, kz = s.z - k.z;
          if (kx * kx + kz * kz < k.r * k.r) { blocked = true; break; }
        }
      }
      if (blocked) continue;
      // Skip slots overlapping walls / cover / props. 0.45m radius
      // covers the lamp base + a margin so the prop never visually
      // bites into a couch arm.
      if (this._collidesAt(s.x, s.z, 0.45)) continue;
      const lamp = buildProp('lamp');
      if (!lamp) continue;
      lamp.group.position.set(s.x, 0, s.z);
      // Tag the visible group so the smoke harness's "every decoration
      // has userData.kind" invariant holds — buildProp already sets
      // kind on the returned object, but the .group's userData is what
      // the harness walks after the build call returns.
      lamp.group.userData.kind = lamp.kind || 'lamp';
      this.scene.add(lamp.group);
      this.decorations.push(lamp.group);
    }
  }

  // Drop a simple ceiling lamp in the room — a thin disc for the
  // fixture plus a warm PointLight and a registered light source for
  // the stealth system. Placed near room centre and offset a bit
  // away from the elevator so the first lamp never overlaps the
  // spawn capsule.
  // Per-room floor patch. The base ground is held at near-black so
  // out-of-bounds (anywhere not under a patch) reads as void; the
  // patch paints the room's playable area in the biome color.
  //
  // Doubles as cheap "per-room lighting" — the patch's emissive
  // tint gives every room a visible mood (lab cools to teal, shop
  // warms to gold, factory leans amber) without adding real lights
  // to the shader. Free of per-frame cost; one mesh per room with a
  // shared MeshStandardMaterial keyed on the final tint color.
  _addRoomFloorPatch(room) {
    if (!room || !room.bounds) return;
    // Use walkableBounds when the shape template emitted them so
    // sealed-off areas (lShape's cut corner, plaza's dais ring,
    // multiTier's platform footprint) read as void instead of as
    // floor the player can't reach. Falls back to room.bounds for
    // rect rooms without a shape's walkableBounds set.
    const boxes = (room._walkableBounds && room._walkableBounds.length)
      ? room._walkableBounds
      : [room.bounds];
    // Base color: biome's floor; per-room theme nudges a subtle
    // emissive accent so different rooms read as distinct moods
    // even on the same floor.
    const baseHex = this.theme?.floor ?? 0x2a2a2e;
    const accents = {
      lab:        { tint: 0x60c8d8, emi: 0.18 },     // cool teal
      infirmary:  { tint: 0x80d8b0, emi: 0.14 },     // soft green
      server:     { tint: 0x6080d0, emi: 0.20 },     // cold blue
      security:   { tint: 0xd06060, emi: 0.10 },     // alarm red dim
      garage:     { tint: 0xe09040, emi: 0.10 },     // sodium amber
      shop:       { tint: 0xe6c060, emi: 0.18 },     // warm gold
      bedroom:    { tint: 0xb89070, emi: 0.10 },     // warm peach
      livingRoom: { tint: 0xb8a080, emi: 0.12 },     // hearth warm
      lobby:      { tint: 0xd0c890, emi: 0.14 },     // brass warm
      kitchen:    { tint: 0xd8b070, emi: 0.10 },     // warm tan
      library:    { tint: 0xa8804a, emi: 0.10 },     // wood warm
      office:     { tint: 0x8aa0c0, emi: 0.06 },     // fluorescent neutral
      archive:    { tint: 0x8a7a60, emi: 0.06 },     // dim warm
      mailroom:   { tint: 0x9aa080, emi: 0.06 },     // dim utility
      gym:        { tint: 0x60a0d0, emi: 0.10 },     // cool gym
      warehouse:  { tint: 0x808088, emi: 0.06 },     // neutral
    };
    const accent = accents[room.theme] || { tint: baseHex, emi: 0.0 };
    const mat = sharedMaterial({
      color: baseHex,
      emissive: accent.tint,
      emissiveIntensity: accent.emi,
      roughness: 0.85,
      metalness: 0.05,
    });
    // Inset 0.3m so each patch doesn't poke under the perimeter wall
    // (walls span bounds±0.6 in z; staying clear avoids z-fighting
    // with wall bases).
    const INSET = 0.3;
    for (const box of boxes) {
      const w = (box.maxX - box.minX) - INSET * 2;
      const d = (box.maxZ - box.minZ) - INSET * 2;
      if (w <= 0 || d <= 0) continue;
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, 0.01, cz);
      mesh.receiveShadow = true;
      mesh.userData.kind = 'room-floor';
      mesh.userData.roomId = room.id;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      this.decorations.push(mesh);
    }
  }

  _addCeilingLamp(room) {
    const b = room.bounds;
    let cx = (b.minX + b.maxX) * 0.5;
    let cz = (b.minZ + b.maxZ) * 0.5;
    if (room.elevatorCenter) {
      // Nudge lamp to a quadrant away from the elevator.
      cx += (cx - room.elevatorCenter.x) * 0.2;
      cz += (cz - room.elevatorCenter.z) * 0.2;
    }
    // Per-room lamp tint. The fixture color + light color shift by
    // theme so a lab reads cool-clinical-white from above, a factory
    // reads sodium-amber, a server room reads cold-blue, etc. Falls
    // back to the warm cream default when the theme has no entry.
    // Free in shader cost — same number of SpotLights, just
    // different color values per instance.
    const lampTints = {
      lab:        { fixture: 0xc8f0ff, light: 0xc8f0ff },     // clinical
      infirmary:  { fixture: 0xe0ffe8, light: 0xd8ffe0 },     // soft green-white
      server:     { fixture: 0xc0d8ff, light: 0xb0c8ff },     // cold blue
      security:   { fixture: 0xffe0d0, light: 0xffd0c0 },     // tungsten warm
      garage:     { fixture: 0xffc080, light: 0xffb060 },     // sodium amber
      shop:       { fixture: 0xfff0c0, light: 0xffe0a0 },     // gold pendant
      bedroom:    { fixture: 0xffd8a0, light: 0xffd0a0 },     // bedside warm
      livingRoom: { fixture: 0xffd8a0, light: 0xffd0a0 },     // hearth
      lobby:      { fixture: 0xfff0d0, light: 0xfff0c0 },     // chandelier
      kitchen:    { fixture: 0xffeec0, light: 0xffe6a0 },     // can lights
      library:    { fixture: 0xffd8a0, light: 0xffd0a0 },     // study lamp
      office:     { fixture: 0xf8f8ff, light: 0xf0f0ff },     // fluorescent
      archive:    { fixture: 0xffe6c0, light: 0xffd8a0 },     // dim warm
      mailroom:   { fixture: 0xfff0d0, light: 0xffe6c0 },     // utility warm
      gym:        { fixture: 0xe0eeff, light: 0xd8e8ff },     // gym overhead
      warehouse:  { fixture: 0xffd8a0, light: 0xffd0a0 },     // hi-bay
    };
    const tint = lampTints[room.theme] || { fixture: 0xffcf80, light: 0xffe6b0 };
    // Bright per-room SpotLight pointing straight down at the floor.
    // The earlier additive-cone mesh approach (Phase 4) read as a
    // hazy fog cone instead of a lit room and was scrapped at
    // playtest. A real SpotLight is the right tool here — it gives
    // the "pool of light on the floor" read that anchors the room
    // visually. Cost is bounded by light reduction work elsewhere
    // in the pass.
    const fixtureMat = sharedMaterial({
      color: tint.fixture,
      emissive: tint.fixture,
      emissiveIntensity: 1.6,
      roughness: 0.3,
    });
    const fixture = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 18),
      fixtureMat,
    );
    fixture.rotation.x = Math.PI / 2;     // face down from the ceiling
    fixture.position.set(cx, WALL_HEIGHT - 0.05, cz);
    fixture.userData.kind = 'ceiling-lamp-fixture';
    this.scene.add(fixture);
    this.decorations.push(fixture);
    // SpotLight — wider cone (Math.PI * 0.45 ≈ 81° full angle), high
    // intensity, soft penumbra so the edge doesn't read as a hard
    // ring. Distance comfortably covers an 18×18m room from ceiling
    // height. No shadows.
    const light = new THREE.SpotLight(
      tint.light,
      9.0,              // intensity — bright enough to compete with the
                        // hemi+key directionals
      14.0,             // distance
      Math.PI * 0.45,   // angle
      0.55,             // penumbra (soft edge)
      1.2,              // decay
    );
    light.position.set(cx, WALL_HEIGHT - 0.2, cz);
    light.target.position.set(cx, 0, cz);
    light.castShadow = false;
    // Lights are Object3D too; stamp kind so the harness sees them as
    // "owned by us" rather than anonymous decorations.
    light.userData.kind = 'ceiling-lamp-light';
    light.target.userData.kind = 'ceiling-lamp-target';
    this.scene.add(light);
    this.scene.add(light.target);
    this.decorations.push(light);
    this.decorations.push(light.target);
    // Track for proximity culling — main.js calls
    // updateRoomLightCulling(playerPos) each frame and toggles
    // .visible on far-room lamps so they drop out of the renderer's
    // active lights[] array. Every lit fragment shader iterates that
    // array regardless of distance, so culling 8-12 SpotLights from
    // far rooms is a real fragment-cost win.
    if (!this._roomLamps) this._roomLamps = [];
    this._roomLamps.push({ light, fixture, cx, cz });
    // Stealth sampling keeps the radial light entry so detection +
    // cover gameplay tracks the visible pool of light.
    this.lights.push({ x: cx, z: cz, radius: 8.0, intensity: 1.8 });
    // Return refs so callers that need to gate visibility (e.g. the
    // extraction chamber, which stays dark until the boss dies) can
    // flip fixture + light together at reveal time.
    return { fixture, light, target: light.target };
  }

  // Sample the ambient light level at a world point. Returns 0..1
  // where 0 = pitch black and 1 = directly under a lamp. The falloff
  // matches the visible PointLight decay so the stealth math tracks
  // the scene visually.
  lightLevelAt(x, z) {
    let total = 0;
    for (const l of this.lights) {
      const dx = x - l.x, dz = z - l.z;
      const d = Math.hypot(dx, dz);
      if (d >= l.radius) continue;
      const k = 1 - d / l.radius;
      total += l.intensity * k * k;
    }
    return Math.max(0, Math.min(1, total));
  }

  _registerProp(prop) {
    if (!prop || !prop.group) return false;
    this.scene.add(prop.group);
    // Track for proximity culling — far-room props hide via .visible
    // toggle so the renderer skips their per-mesh frustum cull +
    // matrixWorld walks. Bullets still hit them through level.obstacles
    // raycasts (separate path that iterates the obstacle list, not
    // the scene graph), so collision still works while invisible.
    if (!this._cullableProps) this._cullableProps = [];
    this._cullableProps.push({
      obj: prop.group,
      x: prop.group.position.x,
      z: prop.group.position.z,
    });
    // Harvest any PointLight inside the prop — lamps register their
    // glow into the ambient-light set so the stealth math treats a
    // lamp-lit spot the same as a ceiling-lit one.
    prop.group.traverse((obj) => {
      if (obj.isPointLight) {
        const wp = new THREE.Vector3();
        obj.getWorldPosition(wp);
        this.lights.push({
          x: wp.x, z: wp.z,
          radius: Math.max(3, obj.distance || 4),
          intensity: 0.7,
        });
      }
    });
    // Record a visible-footprint AABB for every placed prop, even when
    // collision is null — this stops the next prop's overlap test from
    // ignoring decoration-only props (rug, lamp, vase, TV) that aren't
    // in `obstacles`. We prefer prop.collision, then prop.footprint,
    // then fall back to the rendered mesh bbox so something is always
    // recorded. If a future code path explicitly opts out of the
    // footprint registration, set prop._noFootprint = true.
    if (!prop._noFootprint) {
      let fpW = null, fpD = null;
      const src = prop.collision || prop.footprint;
      if (src) { fpW = src.w; fpD = src.d; }
      else {
        try {
          prop.group.updateMatrixWorld(true);
          const bb = new THREE.Box3().setFromObject(prop.group);
          if (Number.isFinite(bb.min.x) && Number.isFinite(bb.max.x)) {
            fpW = Math.max(0.3, bb.max.x - bb.min.x);
            fpD = Math.max(0.3, bb.max.z - bb.min.z);
          }
        } catch (_) {}
      }
      if (fpW && fpD) {
        // Rotate dims to match the prop's actual yaw — same convention
        // as the collision-proxy path below.
        const yawAbs = Math.abs(prop.group.rotation.y || 0) % Math.PI;
        let aw = fpW, ad = fpD;
        const axisAligned = yawAbs < 0.05 || Math.abs(yawAbs - Math.PI / 2) < 0.05;
        if (!axisAligned) { const b = Math.max(aw, ad); aw = b; ad = b; }
        else if (Math.abs(yawAbs - Math.PI / 2) < 0.05) { const t = aw; aw = ad; ad = t; }
        const px = prop.group.position.x, pz = prop.group.position.z;
        if (!this._propFootprints) this._propFootprints = [];
        this._propFootprints.push({
          minX: px - aw / 2, maxX: px + aw / 2,
          minZ: pz - ad / 2, maxZ: pz + ad / 2,
        });
      }
    }
    if (!prop.collision) {
      // Decoration-only prop (rug, lamp, vase, TV) — no collision
      // proxy is built, so the prop never enters `obstacles` and
      // _clearDoorCorridors can't find + hide it. Track these on a
      // sibling list so the door sweep can still walk over them and
      // hide any that landed in a doorway corridor.
      if (!this._decorationProps) this._decorationProps = [];
      const fp = this._propFootprints?.[this._propFootprints.length - 1];
      if (fp) {
        this._decorationProps.push({
          group: prop.group,
          minX: fp.minX, maxX: fp.maxX,
          minZ: fp.minZ, maxZ: fp.maxZ,
        });
      }
      return true;
    }

    // Rotate the collision footprint by the prop's yaw — axis-aligned
    // at 0/90/180/270, bounded square for anything else (placeInterior
    // uses random yaws, so this keeps things conservative instead of
    // letting an oblique prop poke out of its listed bounds).
    let w = prop.collision.w;
    let d = prop.collision.d;
    const yawAbs = Math.abs(prop.group.rotation.y) % Math.PI;
    const axisAligned = yawAbs < 0.05 || Math.abs(yawAbs - Math.PI / 2) < 0.05;
    if (!axisAligned) {
      const bound = Math.max(w, d);
      w = bound; d = bound;
    } else if (Math.abs(yawAbs - Math.PI / 2) < 0.05) {
      [w, d] = [d, w];
    }

    // Invisible collision proxy. `opacity=0` still lets the raycaster
    // test its geometry (unlike `visible=false`, which Three.js skips
    // entirely). depthWrite off avoids interfering with the scene
    // depth buffer.
    //
    // Proxy HEIGHT is derived from the prop's actual rendered bbox —
    // a pallet (~0.4 m) used to get the same tall collision box as a
    // bookshelf (~2 m) and blocked chest-height shots. Now low props
    // let bullets fly over while still stopping movement.
    prop.group.updateMatrixWorld(true);
    const worldBbox = new THREE.Box3().setFromObject(prop.group);
    const propH = Math.max(0.15, worldBbox.max.y - worldBbox.min.y);
    const propMidY = (worldBbox.min.y + worldBbox.max.y) * 0.5;
    const proxyGeom = new THREE.BoxGeometry(w, propH, d);
    const proxyMat = sharedMaterial({
      type: 'basic', color: 0xffffff,
      transparent: true, opacity: 0, depthWrite: false,
    });
    const proxy = new THREE.Mesh(proxyGeom, proxyMat);
    proxy.position.set(
      prop.group.position.x,
      propMidY,
      prop.group.position.z,
    );
    proxy.userData.collisionXZ = {
      minX: prop.group.position.x - w / 2,
      maxX: prop.group.position.x + w / 2,
      minZ: prop.group.position.z - d / 2,
      maxZ: prop.group.position.z + d / 2,
    };
    proxy.userData.isProp = true;
    // Link back to the visible group so the door-corridor sweep can
    // hide the whole prop when it overlaps a doorway.
    proxy.userData.propGroup = prop.group;
    // Stamp the prop kind on BOTH the proxy and the visible group so
    // the level-invariants smoke harness, AI awareness, and stealth
    // code can read it without crawling material/geometry. Falls back
    // to the group's existing kind (for props built outside buildProp)
    // or 'unknown-prop' so we never leave an obstacle anonymous.
    const kind = prop.kind || prop.group?.userData?.kind || 'unknown-prop';
    proxy.userData.kind = kind;
    if (!prop.group.userData.kind) prop.group.userData.kind = kind;
    // Phase J — destructible-prop HP stamp. Kinds in DESTRUCTIBLE_HP
    // get a sequential propId + maxHp/hp/destroyed flags. We stamp
    // BOTH the proxy and the visible group so visuals + collision
    // agree (group.userData.destroyed flips when the prop pops).
    // Ordering is deterministic because generate() runs through
    // _withRunSeed (see main.js) and _registerProp is called
    // synchronously down a stable code path — host + joiner end up
    // assigning identical propIds.
    const dHp = DESTRUCTIBLE_HP[kind];
    if (dHp) {
      const propId = this._destructiblePropIdNext++;
      proxy.userData.propId = propId;
      proxy.userData.maxHp = dHp;
      proxy.userData.hp = dHp;
      proxy.userData.destroyed = false;
      prop.group.userData.propId = propId;
      prop.group.userData.maxHp = dHp;
      prop.group.userData.hp = dHp;
      prop.group.userData.destroyed = false;
    }
    this.scene.add(proxy);
    this.obstacles.push(proxy);
    return true;
  }

  // Phase J — break a destructible prop. Idempotent; safe to call on
  // an already-destroyed proxy (single-line guard early-out). Mutates
  // the proxy in place rather than splicing from `obstacles` so the
  // propId index stays stable for the coop snapshot apply path.
  //
  // Side effects:
  //   - userData.destroyed → true on both proxy + visible group
  //   - collisionXZ → null (movement, projectile, AI grids skip it)
  //   - propGroup.visible → false (renderer skips it)
  //   - debris VFX via combat.spawnImpact at the prop center + a
  //     0.6 m ring of follow-up impacts so the burst reads visually
  //   - audio: best-effort sfx.bulletImpact (no per-material breaks
  //     yet — the audio module synthesizes tones, not samples)
  //   - lootable + unsearched container: spawns a single combined
  //     ground pile via `level._spawnDestructibleLootSpill` (host-
  //     authoritative; joiner mirrors via the regular ground-loot
  //     snapshot path) and clears the prop's container ref so the
  //     "Search <prop>" prompt no longer offers it.
  //   - _dirtySolid() so the projectile / AI grids rebuild
  destroyProp(proxy) {
    if (!proxy || !proxy.userData) return;
    if (proxy.userData.destroyed) return;       // idempotent
    if (proxy.userData.maxHp == null) return;   // not a destructible
    proxy.userData.destroyed = true;
    proxy.userData.hp = 0;
    proxy.userData.collisionXZ = null;
    const group = proxy.userData.propGroup;
    if (group) {
      group.userData.destroyed = true;
      group.userData.hp = 0;
      group.visible = false;
    }
    // Loot-spill — find any container linked to this prop's group and
    // produce a single ground pile representing the whole bundle.
    // Resolves to a no-op if the prop wasn't lootable, was already
    // searched, or the spawner isn't wired (single-player + host run
    // it; joiner relies on the regular ground-loot snapshot).
    try {
      this._spawnDestructibleLootSpill(proxy);
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[level] destructible loot spill threw', err);
      }
    }
    // Debris VFX — best-effort; combat may not be wired in test envs.
    try {
      const combat = (typeof window !== 'undefined') ? window.__combat : null;
      const px = proxy.position?.x ?? group?.position?.x ?? 0;
      const pz = proxy.position?.z ?? group?.position?.z ?? 0;
      const py = (group ? (group.position?.y ?? 0) : 0) + 0.4;
      if (combat && typeof combat.spawnImpact === 'function') {
        const _hit = new THREE.Vector3(px, py, pz);
        combat.spawnImpact(_hit);
        // Cheap break-burst: 4 impacts in a 0.6 m ring around center.
        for (let i = 0; i < 4; i++) {
          const a = i * (Math.PI / 2);
          combat.spawnImpact(new THREE.Vector3(
            px + Math.cos(a) * 0.6, py, pz + Math.sin(a) * 0.6));
        }
      }
      // Audio. We don't yet have per-material break samples — the
      // audio module's synth has bulletImpact + explode but no
      // wood / metal / glass break. Use bulletImpact as a placeholder
      // until the asset pipeline lands real break samples.
      const sfx = (typeof window !== 'undefined') ? window.__sfx : null;
      if (sfx && typeof sfx.bulletImpact === 'function') sfx.bulletImpact();
    } catch (_) { /* defensive — VFX is non-critical */ }
    // Invalidate the projectile / AI / movement caches that key off
    // the obstacle list. Same flag the wall-instancer + door-open
    // paths use; cheap (just flips a dirty bit).
    if (typeof this._dirtySolid === 'function') this._dirtySolid();
  }

  // Spawn a single ground-pile for a destructible prop's loot (Phase J).
  // Per-design: ONE ground item representing the whole bundle, NOT one
  // pile per inventory slot. Looks up the linked container in
  // `level.containers`, spawns a single pile via the global ground-
  // loot helper, and clears the container ref so the "Search" prompt
  // no longer shows the destroyed prop.
  //
  // Joiner-side coop: skip the spawn — the host's spawn lands on the
  // regular ground-loot snapshot and the joiner mirrors it through
  // applyLootSnapshot. Otherwise both peers spawn duplicate piles.
  _spawnDestructibleLootSpill(proxy) {
    if (!proxy || !proxy.userData) return;
    const group = proxy.userData.propGroup;
    if (!group) return;
    // Find the matching container entry. Match by group reference
    // first (the lootable-prop path registers `group: prop.group`),
    // fall back to position match for paths that registered a
    // synthetic group.
    if (!this.containers) return;
    let entryIdx = -1;
    for (let i = 0; i < this.containers.length; i++) {
      const c = this.containers[i];
      if (!c) continue;
      if (c.group === group) { entryIdx = i; break; }
    }
    if (entryIdx < 0) return;       // not a lootable prop
    const entry = this.containers[entryIdx];
    if (!entry || !entry.container) return;
    if (entry.container.looted) return;       // already searched
    if (!entry.container.loot || !entry.container.loot.length) return;
    // Coop-host gate: only the host runs the actual ground-spawn.
    // Joiner path just clears the container ref so the prompt
    // disappears — they'll see the spilled pile via the host's
    // next loot snapshot tick.
    const isJoiner = (typeof window !== 'undefined' && window.__coopIsJoiner === true);
    if (!isJoiner) {
      const spawnFn = (typeof window !== 'undefined') ? window.__spawnGroundLootBundle : null;
      const px = proxy.position?.x ?? group.position?.x ?? 0;
      const pz = proxy.position?.z ?? group.position?.z ?? 0;
      if (typeof spawnFn === 'function') {
        try {
          spawnFn({ x: px, y: 0.4, z: pz }, entry.container.loot.slice());
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.warn('[level] ground-loot spill spawn threw', err);
          }
        }
      }
    }
    // Whichever side we're on, mark the source container as looted
    // so the "Search <prop>" prompt stops offering it. The container
    // entry itself stays in `level.containers` because nothing else
    // currently owns its lifecycle — keeping it around with looted=
    // true matches the regular post-search state and the existing
    // hint-system gate (line ~14421) skips looted containers cleanly.
    entry.container.looted = true;
    entry.container.loot = [];
  }

  // Public — register a keep-out disc so prop placement avoids the area.
  // Used by encounters.js to claim space around an NPC / podium / disc
  // before the level finishes furnishing. No-op once furnishing is done
  // (the keepouts list is consulted only inside _themeRoom).
  addKeepOut(x, z, r = 2.5) {
    if (!this._keepouts) this._keepouts = [];
    this._keepouts.push({ x, z, r });
  }

  // Public — register an invisible collision AABB at runtime. Returns the
  // proxy mesh so callers can stash a ref for cleanup. Used for encounter
  // NPCs / shop kiosks that should block both player + AI movement
  // without needing a visible prop attached.
  addEncounterCollider(x, z, w, d, h = 1.6) {
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      sharedMaterial({
        type: 'basic', color: 0xffffff,
        transparent: true, opacity: 0, depthWrite: false,
      }),
    );
    proxy.position.set(x, h / 2, z);
    proxy.userData.collisionXZ = {
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    };
    proxy.userData.isProp = true;
    proxy.userData.isEncounterCollider = true;
    this.scene.add(proxy);
    this.obstacles.push(proxy);
    if (typeof this._dirtySolid === 'function') this._dirtySolid();
    return proxy;
  }

  // Public — tear down a previously-registered encounter collider.
  // Idempotent: safe to call on a proxy that was already removed (e.g.
  // by level regen sweeping obstacles). Used by encounters whose NPC
  // disappears mid-run (Quiet Man burst, Sleepy Beauty wake-up moves
  // her position, etc.) so the leftover invisible collision box doesn't
  // keep blocking the player + AI from walking through.
  removeEncounterCollider(proxy) {
    if (!proxy) return;
    const idx = this.obstacles.indexOf(proxy);
    if (idx >= 0) this.obstacles.splice(idx, 1);
    if (proxy.parent) this.scene.remove(proxy);
    proxy.geometry?.dispose?.();
    if (proxy.material) disposeMaterialIfNotShared(proxy.material);
    if (typeof this._dirtySolid === 'function') this._dirtySolid();
  }

  // Convert a placed prop into a lootable container. The prop visual
  // stays as-is; the player just gets a "Search desk" prompt instead
  // of "Open chest." Helps eliminate redundant chest clutter — a
  // bookshelf / desk / locker reads as a place loot would live, so we
  // skip dropping a separate box on top of it.
  _markPropLootable(prop, type, size, opts) {
    if (!prop || !prop.group) return false;
    const container = makeContainer(type, size, this.index, opts);
    // Override the default container name with one that matches the prop.
    const PROP_LOOT_NAMES = {
      desk:        'Desk Drawers',
      bookshelf:   'Bookshelf',
      cabinet:     'Filing Cabinet',
      locker:      'Locker',
      nightstand:  'Nightstand',
      crate:       'Crate',
      barrel:      'Barrel',
      pallet:      'Supply Pallet',
    };
    const propKind = prop.kind || prop._lootKind;
    if (propKind && PROP_LOOT_NAMES[propKind]) {
      container.name = PROP_LOOT_NAMES[propKind];
    }
    // Use the prop's own world position + a generous interact radius
    // so the player can trigger from any side without pixel-hunting.
    const x = prop.group.position.x;
    const z = prop.group.position.z;
    this.containers.push({ container, group: prop.group, x, z, r: 1.8 });
    return true;
  }

  // Tall column — full-height cylinder treated as obstacle for collision and
  // LoS. Used by the symmetric "columns" decorator.
  _addColumn(x, z, radius) {
    const geom = new THREE.CylinderGeometry(radius, radius, WALL_HEIGHT, 12);
    const mat = sharedMaterial({ color: 0x2e3240, roughness: 0.7, metalness: 0.1 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, WALL_HEIGHT / 2, z);
    mesh.castShadow = false;     // see _addObstacle — walls don't cast
    mesh.receiveShadow = true;
    // Square AABB matching the column's full radius. Earlier the box
    // was 0.9× radius (so the player wouldn't feel "square corners"
    // hugging the pillar) but that left a 10% gap that prop placement
    // was sometimes squeezing tables into. The player rarely actually
    // hugs columns in combat, so accuracy wins here.
    mesh.userData.collisionXZ = { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
    // Tag so `_clearEncounterRoom` can drop pillars/columns when an
    // encounter conversion lands on a column-heavy layout. Columns
    // belong to combat rooms, not encounter spaces.
    mesh.userData.isColumn = true;
    this.obstacles.push(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  // Symmetric column decorations. `style` picks the pattern. Columns never
  // block the doorway corridors because they sit ≥2m from the walls.
  // Shape rooms (lShape, rotunda, ...) only place columns inside their
  // walkableBounds polygon — the cut-out corners of an L are off-limits.
  _decorateColumns(room, style) {
    const b = room.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const walkBounds = room._walkableBounds;
    const inWalkable = (x, z) => {
      if (!walkBounds || walkBounds.length === 0) return true;
      for (let i = 0; i < walkBounds.length; i++) {
        const w = walkBounds[i];
        // 0.6m margin so a column doesn't sit half-in a cut-out.
        if (x >= w.minX + 0.6 && x <= w.maxX - 0.6
         && z >= w.minZ + 0.6 && z <= w.maxZ - 0.6) return true;
      }
      return false;
    };
    const place = (x, z, r) => {
      if (this._blocksDoor(room, x, z)) return;
      if (!inWalkable(x, z)) return;
      // Don't drop a column on top of an existing wall / prop. Shape
      // templates may have built interior partitions and we don't want
      // to clip a pillar through one.
      if (this._collidesAt(x, z, r + 0.2)) return;
      this._addColumn(x, z, r);
    };
    if (style === '4-corner') {
      const dx = (b.maxX - b.minX) * 0.28;
      const dz = (b.maxZ - b.minZ) * 0.28;
      place(cx - dx, cz - dz, 0.45);
      place(cx + dx, cz - dz, 0.45);
      place(cx - dx, cz + dz, 0.45);
      place(cx + dx, cz + dz, 0.45);
    } else if (style === '6-line') {
      const longX = (b.maxX - b.minX) >= (b.maxZ - b.minZ);
      const axLen = longX ? (b.maxX - b.minX) : (b.maxZ - b.minZ);
      const offs = [-axLen * 0.28, 0, axLen * 0.28];
      const perpOff = longX ? (b.maxZ - b.minZ) * 0.22 : (b.maxX - b.minX) * 0.22;
      for (const o of offs) {
        if (longX) {
          place(cx + o, cz - perpOff, 0.4);
          place(cx + o, cz + perpOff, 0.4);
        } else {
          place(cx - perpOff, cz + o, 0.4);
          place(cx + perpOff, cz + o, 0.4);
        }
      }
    } else if (style === 'cross') {
      // Offset the cross diagonally instead of on the pure axes — on-axis
      // pillars sit directly in door-approach lines for centered doors.
      const arm = (b.maxX - b.minX) * 0.24;
      place(cx - arm, cz - arm, 0.42);
      place(cx + arm, cz - arm, 0.42);
      place(cx - arm, cz + arm, 0.42);
      place(cx + arm, cz + arm, 0.42);
    }
  }

  // Interior walls for layout variants (split / hallway). The perimeter is
  // already up by the time this runs. Each layout checks the room's doors
  // first and skips itself if it would block a doorway approach — better
  // to lose the flourish than to lock the player out of the next room.
  _buildInterior(room) {
    const b = room.bounds;
    const dirs = new Set(room.neighbors.map(n => n.dir));
    const longX = (b.maxX - b.minX) >= (b.maxZ - b.minZ);
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const halfGap = DOOR_WIDTH / 2;

    if (room.layout === 'split') {
      // A divider wall splits the room in half along the long axis, with a
      // 4-wide gap in the middle. Pick the axis that doesn't run through
      // any existing door — if both axes would run through a door, skip.
      const splitX = longX && !dirs.has('east') && !dirs.has('west');
      const splitZ = !longX && !dirs.has('north') && !dirs.has('south');
      if (splitX) {
        const seg = (b.maxX - b.minX) / 2 - halfGap;
        this._addObstacle(b.minX + seg / 2, WALL_HEIGHT / 2, cz, seg, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        this._addObstacle(b.maxX - seg / 2, WALL_HEIGHT / 2, cz, seg, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
      } else if (splitZ) {
        const seg = (b.maxZ - b.minZ) / 2 - halfGap;
        this._addObstacle(cx, WALL_HEIGHT / 2, b.minZ + seg / 2, WALL_THICK, WALL_HEIGHT, seg, FULL_WALL_COLOR);
        this._addObstacle(cx, WALL_HEIGHT / 2, b.maxZ - seg / 2, WALL_THICK, WALL_HEIGHT, seg, FULL_WALL_COLOR);
      }
    } else if (room.layout === 'lshape') {
      // Block off one corner with two interior walls to form an L-shaped
      // floor. Pick a corner that isn't adjacent to any doorway.
      // Each wall stops 2m short of the room boundary so the partitioned
      // corner cell is always reachable through one of the two
      // archways. Without this gap, an enemy / boss could spawn in the
      // sealed cell and the player couldn't reach them — repro'd from
      // a level-3 lshape boss room where the southeast corner was
      // fully enclosed.
      const corners = [
        { name: 'NE', cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, xSign: +1, zSign: -1, doors: ['east', 'north'] },
        { name: 'NW', cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, xSign: -1, zSign: -1, doors: ['west', 'north'] },
        { name: 'SE', cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, xSign: +1, zSign: +1, doors: ['east', 'south'] },
        { name: 'SW', cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, xSign: -1, zSign: +1, doors: ['west', 'south'] },
      ].filter(c => !c.doors.some(d => dirs.has(d)));
      if (corners.length === 0) return;
      const pick = corners[Math.floor(Math.random() * corners.length)];
      const centerX = (b.minX + b.maxX) / 2;
      const centerZ = (b.minZ + b.maxZ) / 2;
      const halfW = (b.maxX - b.minX) / 2;
      const halfD = (b.maxZ - b.minZ) / 2;
      const GAP = 2.0;                       // walkable archway at outer end
      // Horizontal wall: stops GAP short of the X edge so the corner
      // has an open passage along the room's outer wall.
      const hLen = Math.max(1.0, halfW - GAP);
      const hx = centerX + pick.xSign * hLen / 2;
      this._addObstacle(hx, WALL_HEIGHT / 2, centerZ, hLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
      // Vertical wall: stops GAP short of the Z edge for the same reason.
      const vLen = Math.max(1.0, halfD - GAP);
      const vz = centerZ + pick.zSign * vLen / 2;
      this._addObstacle(centerX, WALL_HEIGHT / 2, vz, WALL_THICK, WALL_HEIGHT, vLen, FULL_WALL_COLOR);
    } else if (room.layout === 'hallway') {
      // Two parallel interior walls narrow the passable corridor. They
      // would block door approaches on the short edges, so skip the
      // variant entirely when such a door exists.
      if (longX && (dirs.has('north') || dirs.has('south'))) return;
      if (!longX && (dirs.has('east') || dirs.has('west'))) return;
      if (longX) {
        const margin = 3.2;
        const walLen = (b.maxX - b.minX) * 0.72;
        this._addObstacle(cx, WALL_HEIGHT / 2, b.minZ + margin, walLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        this._addObstacle(cx, WALL_HEIGHT / 2, b.maxZ - margin, walLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
      } else {
        const margin = 3.2;
        const walLen = (b.maxZ - b.minZ) * 0.72;
        this._addObstacle(b.minX + margin, WALL_HEIGHT / 2, cz, WALL_THICK, WALL_HEIGHT, walLen, FULL_WALL_COLOR);
        this._addObstacle(b.maxX - margin, WALL_HEIGHT / 2, cz, WALL_THICK, WALL_HEIGHT, walLen, FULL_WALL_COLOR);
      }
    } else if (room.layout === 'partition') {
      // Partition — divide the cell into TWO linked sub-rooms with a
      // full interior wall and a single ~3m doorway gap roughly at
      // the long-axis centre. Pick the split axis so the interior
      // wall doesn't run through any external door.
      const splitX = !dirs.has('east') && !dirs.has('west');
      const splitZ = !dirs.has('north') && !dirs.has('south');
      // Prefer the long axis — splitting along the short side creates
      // more balanced halves.
      const pickSplitX = splitX && (!splitZ || longX);
      const pickSplitZ = splitZ && !pickSplitX;
      const doorGap = 3.0;
      if (pickSplitX) {
        // Vertical interior wall at x = cx, spans full Z with a gap
        // at ~40-60% of the Z range.
        const gapZ = b.minZ + (b.maxZ - b.minZ) * (0.4 + Math.random() * 0.2);
        const topLen = gapZ - doorGap / 2 - b.minZ;
        const botLen = b.maxZ - (gapZ + doorGap / 2);
        if (topLen > 0.5) {
          this._addObstacle(cx, WALL_HEIGHT / 2, b.minZ + topLen / 2,
            WALL_THICK, WALL_HEIGHT, topLen, FULL_WALL_COLOR);
        }
        if (botLen > 0.5) {
          this._addObstacle(cx, WALL_HEIGHT / 2, b.maxZ - botLen / 2,
            WALL_THICK, WALL_HEIGHT, botLen, FULL_WALL_COLOR);
        }
      } else if (pickSplitZ) {
        const gapX = b.minX + (b.maxX - b.minX) * (0.4 + Math.random() * 0.2);
        const leftLen = gapX - doorGap / 2 - b.minX;
        const rightLen = b.maxX - (gapX + doorGap / 2);
        if (leftLen > 0.5) {
          this._addObstacle(b.minX + leftLen / 2, WALL_HEIGHT / 2, cz,
            leftLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        }
        if (rightLen > 0.5) {
          this._addObstacle(b.maxX - rightLen / 2, WALL_HEIGHT / 2, cz,
            rightLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        }
      }
    } else if (room.layout === 'closet') {
      // Carve out a small corner closet — two interior walls form an
      // enclosed pocket in one corner, with a single doorway cut into
      // one of the walls. Skip corners adjacent to any external door.
      const closetSize = 5.5;
      const doorGap = 2.6;
      // Four corner options, filtered for "not blocking a door side".
      const corners = [
        { cornerX: b.maxX, cornerZ: b.minZ, sx: -1, sz:  1, blockDirs: ['east', 'north'] }, // NE
        { cornerX: b.minX, cornerZ: b.minZ, sx:  1, sz:  1, blockDirs: ['west', 'north'] }, // NW
        { cornerX: b.maxX, cornerZ: b.maxZ, sx: -1, sz: -1, blockDirs: ['east', 'south'] }, // SE
        { cornerX: b.minX, cornerZ: b.maxZ, sx:  1, sz: -1, blockDirs: ['west', 'south'] }, // SW
      ].filter(c => !c.blockDirs.some(d => dirs.has(d)));
      if (corners.length === 0) return;
      const pick = corners[Math.floor(Math.random() * corners.length)];
      // The two closet walls extend INWARD from the corner. One runs
      // parallel to X, one parallel to Z. Put the doorway in the
      // longer of the two (player walks in through a side, not the
      // far face).
      const wallX = pick.cornerX + pick.sx * closetSize;  // vertical wall at this X
      const wallZ = pick.cornerZ + pick.sz * closetSize;  // horizontal wall at this Z
      const doorOnZWall = Math.random() < 0.5;
      if (doorOnZWall) {
        // Vertical wall: solid (goes from cornerZ to wallZ). Horizontal
        // wall: split with gap at its centre.
        const vertLen = closetSize;
        this._addObstacle(wallX, WALL_HEIGHT / 2,
          pick.cornerZ + pick.sz * (closetSize / 2),
          WALL_THICK, WALL_HEIGHT, vertLen, FULL_WALL_COLOR);
        const horzMidX = pick.cornerX + pick.sx * (closetSize / 2);
        const segLen = (closetSize - doorGap) / 2;
        // Two short segments flanking the door gap at horzMidX.
        this._addObstacle(pick.cornerX + pick.sx * (segLen / 2), WALL_HEIGHT / 2, wallZ,
          segLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        this._addObstacle(pick.cornerX + pick.sx * (closetSize - segLen / 2), WALL_HEIGHT / 2, wallZ,
          segLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        void horzMidX;
      } else {
        // Door in the vertical wall.
        const horzLen = closetSize;
        this._addObstacle(pick.cornerX + pick.sx * (closetSize / 2), WALL_HEIGHT / 2,
          wallZ, horzLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        const segLen = (closetSize - doorGap) / 2;
        this._addObstacle(wallX, WALL_HEIGHT / 2, pick.cornerZ + pick.sz * (segLen / 2),
          WALL_THICK, WALL_HEIGHT, segLen, FULL_WALL_COLOR);
        this._addObstacle(wallX, WALL_HEIGHT / 2, pick.cornerZ + pick.sz * (closetSize - segLen / 2),
          WALL_THICK, WALL_HEIGHT, segLen, FULL_WALL_COLOR);
      }
    } else if (room.layout === 'corridor') {
      // Corridor layout for extended "giant" rooms — narrows the
      // short axis aggressively so a long room reads as a corridor
      // with perpendicular alcoves at each end. Assumes the room's
      // long axis came from a `room.giant` extension (see the combat-
      // room size-variety pass above).
      if (longX) {
        // Long on X: walls run parallel to X, shrinking Z-range.
        const margin = 4.5;
        const walLen = (b.maxX - b.minX) * 0.55;   // leaves ~22% at each end
        // Two strips near top/bottom, shortened so the ends open into
        // a pocket / alcove (giving the "corridor → alcove" feel).
        const stripZ1 = b.minZ + margin;
        const stripZ2 = b.maxZ - margin;
        this._addObstacle(cx, WALL_HEIGHT / 2, stripZ1, walLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
        this._addObstacle(cx, WALL_HEIGHT / 2, stripZ2, walLen, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
      } else {
        const margin = 4.5;
        const walLen = (b.maxZ - b.minZ) * 0.55;
        const stripX1 = b.minX + margin;
        const stripX2 = b.maxX - margin;
        this._addObstacle(stripX1, WALL_HEIGHT / 2, cz, WALL_THICK, WALL_HEIGHT, walLen, FULL_WALL_COLOR);
        this._addObstacle(stripX2, WALL_HEIGHT / 2, cz, WALL_THICK, WALL_HEIGHT, walLen, FULL_WALL_COLOR);
      }
    } else if (room.layout === 'bunker') {
      // Bunker — three half-height short walls staggered across the
      // room's long axis. Each is 3.5–4m long and offset alternately
      // toward the top and bottom edge so the player has to weave
      // through cover lanes. Walls are full-height for line-of-sight
      // breaks. Skipped if any segment would sit within a door's
      // approach strip.
      const segLen = 3.8;
      const offset = 2.6;
      const placeWall = (x, z, w, d) => {
        if (this._blocksDoor(room, x, z, 1.4)) return;
        this._addObstacle(x, WALL_HEIGHT / 2, z, w, WALL_HEIGHT, d, FULL_WALL_COLOR);
      };
      if (longX) {
        const span = b.maxX - b.minX;
        const x1 = b.minX + span * 0.25;
        const x2 = b.minX + span * 0.50;
        const x3 = b.minX + span * 0.75;
        placeWall(x1, cz - offset, segLen, WALL_THICK);
        placeWall(x2, cz + offset, segLen, WALL_THICK);
        placeWall(x3, cz - offset, segLen, WALL_THICK);
      } else {
        const span = b.maxZ - b.minZ;
        const z1 = b.minZ + span * 0.25;
        const z2 = b.minZ + span * 0.50;
        const z3 = b.minZ + span * 0.75;
        placeWall(cx - offset, z1, WALL_THICK, segLen);
        placeWall(cx + offset, z2, WALL_THICK, segLen);
        placeWall(cx - offset, z3, WALL_THICK, segLen);
      }
    } else if (room.layout === 'pillars-grid') {
      // Pillars grid — 2×3 arrangement of stub pillars across the
      // room. Each pillar is a 0.6×0.6 collidable obstacle at half
      // wall height so the player and enemies break LoS while moving
      // through. Centres skipped if too close to a doorway approach
      // OR if the spot already has a shape wall sitting on it (e.g.,
      // rotunda's chamfered 4.5×4.5 corner blocks). Without the
      // collision check, a rotunda+pillars-grid combo plants 4 of
      // its 6 pillars inside the corner blocks; F3 dump 2026-05-07
      // showed columns visibly poking through the chamfer faces.
      const cols = longX ? 3 : 2;
      const rows = longX ? 2 : 3;
      const pad = 3.0;
      const usableW = (b.maxX - b.minX) - pad * 2;
      const usableD = (b.maxZ - b.minZ) - pad * 2;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = b.minX + pad + (cols === 1 ? usableW / 2 : (usableW * i) / (cols - 1));
          const z = b.minZ + pad + (rows === 1 ? usableD / 2 : (usableD * j) / (rows - 1));
          if (this._blocksDoor(room, x, z, 1.6)) continue;
          // Spatial-hash check at the pillar's half-extent + a small
          // margin. If a shape wall (rotunda corner block, lShape
          // notch, etc.) is already there, skip.
          if (this._collidesAt(x, z, 0.6)) continue;
          const m = this._addObstacle(x, WALL_HEIGHT / 2, z, 0.6, WALL_HEIGHT, 0.6, FULL_WALL_COLOR);
          // Tag so encounter conversion strips this pillar from rooms
          // that get re-rolled as encounter spaces.
          if (m) m.userData.isColumn = true;
        }
      }
    } else if (room.layout === 'alcove') {
      // Alcove — a single mid-height L of two short walls in one
      // corner forming a small "hide spot". Useful as a 1-person
      // cover pocket without splitting room flow.
      const choices = [
        { x: b.minX, z: b.minZ, sx: +1, sz: +1 },
        { x: b.maxX, z: b.minZ, sx: -1, sz: +1 },
        { x: b.minX, z: b.maxZ, sx: +1, sz: -1 },
        { x: b.maxX, z: b.maxZ, sx: -1, sz: -1 },
      ];
      const corner = choices[Math.floor(Math.random() * choices.length)];
      const len = 3.5;
      const inset = 4.0;
      const wx = corner.x + corner.sx * inset;
      const wz = corner.z + corner.sz * inset;
      // Wall along Z axis at wx, spanning len starting from corner.z
      const zMid = corner.z + corner.sz * (len / 2);
      const xMid = corner.x + corner.sx * (len / 2);
      if (!this._blocksDoor(room, wx, zMid, 1.4)) {
        this._addObstacle(wx, WALL_HEIGHT / 2, zMid, WALL_THICK, WALL_HEIGHT, len, FULL_WALL_COLOR);
      }
      if (!this._blocksDoor(room, xMid, wz, 1.4)) {
        this._addObstacle(xMid, WALL_HEIGHT / 2, wz, len, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
      }
    } else if (room.layout === 'center-pit') {
      // Center pit — four short walls forming a rectangular cover
      // ring around the room centre, with a 1.6m walkable gap cut
      // into the middle of each wall so players + AI can pass
      // through to the centre instead of getting locked out. (Earlier
      // version relied on diagonal corner gaps, but those collapsed
      // to ~0.2m of axis-aligned clearance after AABB resolution and
      // the centre became unreachable — bug seen on a level-3 boss
      // room where the exit + boss were both inside the pit.)
      const halfW = (b.maxX - b.minX) * 0.18;
      const halfD = (b.maxZ - b.minZ) * 0.18;
      const segLen = halfW * 1.4;
      const segDepth = halfD * 1.4;
      const GAP = 1.6;
      const placeWall = (x, z, w, d) => {
        if (this._blocksDoor(room, x, z, 1.4)) return;
        this._addObstacle(x, WALL_HEIGHT / 2, z, w, WALL_HEIGHT, d, FULL_WALL_COLOR);
      };
      // Each wall split into two pieces with a centred GAP so the
      // pit reads as a courtyard with four open archways.
      const sideLen = (segLen - GAP) / 2;
      const sideDepth = (segDepth - GAP) / 2;
      if (sideLen > 0.4) {
        // North + south walls: split horizontally.
        placeWall(cx - (GAP / 2 + sideLen / 2), cz - halfD, sideLen, WALL_THICK);
        placeWall(cx + (GAP / 2 + sideLen / 2), cz - halfD, sideLen, WALL_THICK);
        placeWall(cx - (GAP / 2 + sideLen / 2), cz + halfD, sideLen, WALL_THICK);
        placeWall(cx + (GAP / 2 + sideLen / 2), cz + halfD, sideLen, WALL_THICK);
      }
      if (sideDepth > 0.4) {
        // West + east walls: split vertically.
        placeWall(cx - halfW, cz - (GAP / 2 + sideDepth / 2), WALL_THICK, sideDepth);
        placeWall(cx - halfW, cz + (GAP / 2 + sideDepth / 2), WALL_THICK, sideDepth);
        placeWall(cx + halfW, cz - (GAP / 2 + sideDepth / 2), WALL_THICK, sideDepth);
        placeWall(cx + halfW, cz + (GAP / 2 + sideDepth / 2), WALL_THICK, sideDepth);
      }
    } else if (room.layout === 'zigzag') {
      // Zigzag — three short walls offset along the room's long axis,
      // each angled to push the player into the next bay. Forces
      // engagements at fixed angles instead of clean line-of-sight.
      const longSpan = longX ? (b.maxX - b.minX) : (b.maxZ - b.minZ);
      const inset = longSpan * 0.18;
      const segLen = longSpan * 0.30;
      const placeWall = (x, z, w, d) => {
        if (this._blocksDoor(room, x, z, 1.6)) return;
        this._addObstacle(x, WALL_HEIGHT / 2, z, w, WALL_HEIGHT, d, FULL_WALL_COLOR);
      };
      if (longX) {
        const x1 = b.minX + inset;
        const x2 = cx;
        const x3 = b.maxX - inset;
        placeWall(x1, cz - 1.8, WALL_THICK, segLen);
        placeWall(x2, cz + 1.8, WALL_THICK, segLen);
        placeWall(x3, cz - 1.8, WALL_THICK, segLen);
      } else {
        const z1 = b.minZ + inset;
        const z2 = cz;
        const z3 = b.maxZ - inset;
        placeWall(cx - 1.8, z1, segLen, WALL_THICK);
        placeWall(cx + 1.8, z2, segLen, WALL_THICK);
        placeWall(cx - 1.8, z3, segLen, WALL_THICK);
      }
    } else if (room.layout === 'boss-arena') {
      // Boss arena — keep most of the room open for boss mobility,
      // but ring the perimeter with three or four low cover walls
      // sized like a sandbag emplacement. Player gets predictable
      // hides for resetting LoS; boss has the centre to roam.
      const segLen = 4.5;
      const inset = 3.6;
      const placeWall = (x, z, w, d) => {
        if (this._blocksDoor(room, x, z, 1.8)) return;
        this._addObstacle(x, WALL_HEIGHT * 0.40, z, w, WALL_HEIGHT * 0.80, d, LOW_COVER_COLOR);
      };
      placeWall(cx, b.minZ + inset, segLen, WALL_THICK);
      placeWall(cx, b.maxZ - inset, segLen, WALL_THICK);
      placeWall(b.minX + inset, cz, WALL_THICK, segLen);
      placeWall(b.maxX - inset, cz, WALL_THICK, segLen);
    } else if (room.layout === 'boss-pillars') {
      // Boss pillars — scatter ~7 tall pillars across the room. No
      // grid; each pillar tries a few placements until it doesn't
      // collide with another pillar or block a door. Great for dash
      // bosses where breaking line of sight mid-charge is the play.
      const pillarRadius = 0.45;
      const minSep = 3.0;
      const placed = [];
      const attempts = 7 * 6;
      let placedCount = 0;
      for (let a = 0; a < attempts && placedCount < 7; a++) {
        const x = b.minX + 2.5 + Math.random() * (b.maxX - b.minX - 5);
        const z = b.minZ + 2.5 + Math.random() * (b.maxZ - b.minZ - 5);
        if (this._blocksDoor(room, x, z, 1.8)) continue;
        let tooClose = false;
        for (const p of placed) {
          if (Math.hypot(p.x - x, p.z - z) < minSep) { tooClose = true; break; }
        }
        if (tooClose) continue;
        const geom = new THREE.CylinderGeometry(pillarRadius, pillarRadius, WALL_HEIGHT, 10);
        const mat = sharedMaterial({ color: 0x2a2e38, roughness: 0.7, metalness: 0.1 });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(x, WALL_HEIGHT / 2, z);
        mesh.castShadow = false;
        mesh.userData.collisionXZ = {
          minX: x - pillarRadius, maxX: x + pillarRadius,
          minZ: z - pillarRadius, maxZ: z + pillarRadius,
        };
        this.scene.add(mesh);
        this.obstacles.push(mesh);
        placed.push({ x, z });
        placedCount++;
      }
    } else if (room.layout === 'pillar-ring') {
      // Four chunky pillars arranged in a diamond around room centre,
      // pulled in 30% from each wall. Reads as a colonnade — the
      // player can break LoS by stepping behind any pillar and
      // enemies have to commit to a side. Different from `pillars-
      // grid` (which packs a 3×3 of small pillars in a tight square)
      // by using fewer, bigger blocks at wider spacing.
      const inset = 0.3;
      const px = (b.maxX - b.minX) * inset;
      const pz = (b.maxZ - b.minZ) * inset;
      const w = 1.2, d = 1.2, h = WALL_HEIGHT;
      const spots = [
        [b.minX + px, cz], [b.maxX - px, cz],
        [cx, b.minZ + pz], [cx, b.maxZ - pz],
      ];
      for (const [sx, sz] of spots) {
        // Skip any pillar that lands in a doorway approach.
        if (this._blocksDoor(room, sx, sz, 2.4)) continue;
        this._addObstacle(sx, h / 2, sz, w, h, d, FULL_WALL_COLOR);
      }
    } else if (room.layout === 'kill-box') {
      // For every doorway, drop a pair of cover blocks 3m inside the
      // room flanking the door's centerline. Channels enemy + player
      // movement through the same chokepoint per door without
      // sealing anything. Skip a pair if its slot would overlap an
      // adjacent perpendicular door's strip.
      const flankOffset = DOOR_WIDTH / 2 + 0.6;
      const inset = 3.0;
      for (const n of room.neighbors) {
        const other = this.rooms[n.otherId];
        if (!other) continue;
        const w = 1.0, d = 1.0, h = 1.2;     // chest-high cover blocks
        let p1, p2;
        if (n.dir === 'north' || n.dir === 'south') {
          const wallZ = (n.dir === 'north') ? b.minZ : b.maxZ;
          const inwardZ = (n.dir === 'north') ? wallZ + inset : wallZ - inset;
          const dCx = other.cx;
          p1 = [dCx - flankOffset, inwardZ];
          p2 = [dCx + flankOffset, inwardZ];
        } else {
          const wallX = (n.dir === 'east') ? b.maxX : b.minX;
          const inwardX = (n.dir === 'east') ? wallX - inset : wallX + inset;
          const dCz = other.cz;
          p1 = [inwardX, dCz - flankOffset];
          p2 = [inwardX, dCz + flankOffset];
        }
        for (const [sx, sz] of [p1, p2]) {
          if (sx < b.minX + 0.8 || sx > b.maxX - 0.8) continue;
          if (sz < b.minZ + 0.8 || sz > b.maxZ - 0.8) continue;
          this._addObstacle(sx, h / 2, sz, w, h, d, LOW_COVER_COLOR);
        }
      }
    } else if (room.layout === 'central-cover') {
      // Single chunky chest-high cover block dead-centre. The block
      // is bigger than scatter cover (3×3 vs. ~1.2×1.2) so it reads
      // as deliberate — forces the player and AI to flank rather
      // than peek over. Skip if room.cx/cz lands inside a keep-out
      // (boss exit, encounter spawn) — the central cover would
      // collide with the gameplay disc.
      const blockW = 3.2, blockD = 3.2, h = 1.2;
      let blocked = false;
      if (this._keepouts) {
        for (const k of this._keepouts) {
          const dx = cx - k.x, dz = cz - k.z;
          if (dx * dx + dz * dz < (k.r + 1.6) * (k.r + 1.6)) { blocked = true; break; }
        }
      }
      if (!blocked) {
        this._addObstacle(cx, h / 2, cz, blockW, h, blockD, LOW_COVER_COLOR);
      }
    } else if (room.layout === 'flank-pockets') {
      // Two short wall stubs jut out from opposite walls, creating
      // little inset cover pockets the player + AI can hug. The
      // stubs are perpendicular to the wall they grow from and
      // ~3m long. Skip a wall that has a doorway to keep the
      // approach clear.
      const stubLen = 3.0;
      const stubDepth = 1.2;
      const h = WALL_HEIGHT;
      // Each stub at 25% from one corner of the un-doored wall.
      const candidates = [];
      if (!dirs.has('north')) candidates.push({ side: 'north', cz: b.minZ + stubDepth / 2 });
      if (!dirs.has('south')) candidates.push({ side: 'south', cz: b.maxZ - stubDepth / 2 });
      if (!dirs.has('east'))  candidates.push({ side: 'east',  cx: b.maxX - stubDepth / 2 });
      if (!dirs.has('west'))  candidates.push({ side: 'west',  cx: b.minX + stubDepth / 2 });
      // Shuffle and pick up to 2 different walls so the room has
      // pockets on opposite or perpendicular faces.
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      const picks = candidates.slice(0, 2);
      for (const pk of picks) {
        if (pk.side === 'north' || pk.side === 'south') {
          // Stub runs along Z, jutting inward; placed at ~30% in X.
          const sx = b.minX + (b.maxX - b.minX) * (Math.random() < 0.5 ? 0.30 : 0.70);
          this._addObstacle(sx, h / 2, pk.cz + (pk.side === 'north' ? stubLen / 2 : -stubLen / 2),
            stubDepth, h, stubLen, FULL_WALL_COLOR);
        } else {
          const sz = b.minZ + (b.maxZ - b.minZ) * (Math.random() < 0.5 ? 0.30 : 0.70);
          this._addObstacle(pk.cx + (pk.side === 'east' ? -stubLen / 2 : stubLen / 2), h / 2, sz,
            stubLen, h, stubDepth, FULL_WALL_COLOR);
        }
      }
    } else if (room.layout === 'boss-perch') {
      // Boss perch — a raised platform along one wall the boss can
      // shoot from. Player has to break LoS or flank around the
      // platform's open end to engage. Pick whichever wall has no
      // doorway so the platform doesn't seal off a connection.
      const sides = [
        { name: 'north', cx, cz: b.minZ + 2.0, w: 7.5, d: 2.4, dirSafe: !dirs.has('north') },
        { name: 'south', cx, cz: b.maxZ - 2.0, w: 7.5, d: 2.4, dirSafe: !dirs.has('south') },
        { name: 'east',  cx: b.maxX - 2.0, cz, w: 2.4, d: 7.5, dirSafe: !dirs.has('east')  },
        { name: 'west',  cx: b.minX + 2.0, cz, w: 2.4, d: 7.5, dirSafe: !dirs.has('west')  },
      ].filter(s => s.dirSafe);
      if (sides.length > 0) {
        const pick = sides[Math.floor(Math.random() * sides.length)];
        const platformH = 1.0;
        // Visible platform (no top wall — bosses + AI navmesh both
        // ignore this collision, so the player can also walk onto it
        // off the edge by clipping over). Standard collision proxy
        // used so bullets / movement treat it as a low solid block.
        const geom = new THREE.BoxGeometry(pick.w, platformH, pick.d);
        const mat = sharedMaterial({ color: 0x3a3a34, roughness: 0.85 });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(pick.cx, platformH / 2, pick.cz);
        mesh.userData.collisionXZ = {
          minX: pick.cx - pick.w / 2, maxX: pick.cx + pick.w / 2,
          minZ: pick.cz - pick.d / 2, maxZ: pick.cz + pick.d / 2,
        };
        this.scene.add(mesh);
        this.obstacles.push(mesh);
      }
    }
  }

  // Skip column placement that would land in a doorway approach strip. Used
  // by `_decorateColumns` to suppress pillars that sit too close to a door.
  _blocksDoor(room, x, z, keepOut = 1.8) {
    for (const n of room.neighbors) {
      const b = room.bounds;
      let dx, dz;
      if (n.dir === 'east') { dx = b.maxX; dz = (b.minZ + b.maxZ) / 2; }
      else if (n.dir === 'west') { dx = b.minX; dz = (b.minZ + b.maxZ) / 2; }
      else if (n.dir === 'north') { dx = (b.minX + b.maxX) / 2; dz = b.minZ; }
      else { dx = (b.minX + b.maxX) / 2; dz = b.maxZ; }
      if (Math.hypot(dx - x, dz - z) < keepOut + DOOR_WIDTH / 2) return true;
    }
    return false;
  }

  _populateRoom(room) {
    const b = room.bounds;
    if (room.type === 'start') return;
    // Encounter rooms are intentionally enemy-free — main.js builds the
    // NPC + props from the chosen ENCOUNTER_DEFS entry after generation.
    if (room.type === 'encounter') return;
    if (['merchant', 'healer', 'gunsmith', 'armorer', 'tailor',
         'relicSeller', 'blackMarket'].includes(room.type)) {
      this._spawnNPC(room);
      return;
    }
    // Treasure rooms — no enemy spawns. Contents (chests + lootable
    // props) are handled by _scatterContainers's treasure-room
    // boost branch + the _maybeLoot override on themed props.
    if (room.type === 'treasure') return;
    if (room.type === 'bearMerchant') {
      this._spawnBearMerchant(room);
      return;
    }
    // Collect every door in this room — spawn positions must have a clear
    // walkable path to at least one of them, otherwise an enemy can land
    // behind an interior wall (L-shape corner, hallway-divider cell) and
    // the player can't reach them to finish the room.
    const doorPts = [];
    for (const o of this.obstacles) {
      if (!o.userData.isDoor) continue;
      if (!o.userData.connects?.includes(room.id)) continue;
      doorPts.push({ x: o.userData.cx, z: o.userData.cz });
    }
    if (doorPts.length === 0) {
      // Rooms with no door (shouldn't happen) — fall back to center.
      doorPts.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
    }
    const reachable = (sx, sz) => {
      for (const d of doorPts) {
        if (this._segmentClear(sx, sz, d.x, d.z, 0.8)) return true;
      }
      return false;
    };
    // Walkable check — shape rooms (lShape, tJunction, gallery, etc.)
    // have a `_walkableBounds` polygon (array of axis-aligned boxes)
    // covering only the playable cells. The room's `bounds` AABB is
    // the FULL cell footprint including the cut-out corners. Without
    // this gate, a random pick in the cut-out corner of a gallery-
    // shape sub-boss room would spawn the enemy behind a wall the
    // player can't reach (probe found ~6-12% of shape-room spawns
    // landing OOB until this check landed).
    const walkBounds = room._walkableBounds;
    const inWalkable = (sx, sz) => {
      if (!walkBounds || walkBounds.length === 0) return true;
      for (let i = 0; i < walkBounds.length; i++) {
        const w = walkBounds[i];
        if (sx >= w.minX && sx <= w.maxX && sz >= w.minZ && sz <= w.maxZ) return true;
      }
      return false;
    };
    // Exclusion radius around the elevator — otherwise every elevator
    // room tends to spawn mobs crowding the entrance. Only applies inside
    // the actual elevator room (start or boss, whichever the level uses).
    const EXCLUSION_R = 5.5;
    const elevC = room.elevatorCenter;
    const pickOpen = (margin = 2) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        const x = b.minX + margin + Math.random() * (b.maxX - b.minX - 2 * margin);
        const z = b.minZ + margin + Math.random() * (b.maxZ - b.minZ - 2 * margin);
        if (!inWalkable(x, z)) continue;
        if (this._collidesAt(x, z, 1.0)) continue;
        if (!reachable(x, z)) continue;
        if (elevC) {
          const ex = x - elevC.x, ez = z - elevC.z;
          if (ex * ex + ez * ez < EXCLUSION_R * EXCLUSION_R) continue;
        }
        return { x, z };
      }
      // Softer fallback — if 120 strict-reachable attempts fail, try
      // 40 more with the reachability check relaxed. Prior version
      // snapped every fallback to the first door, which stacked an
      // entire squad at the same threshold. Any non-colliding spot
      // inside the room beats a pile-up at one door.
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = b.minX + margin + Math.random() * (b.maxX - b.minX - 2 * margin);
        const z = b.minZ + margin + Math.random() * (b.maxZ - b.minZ - 2 * margin);
        if (!inWalkable(x, z)) continue;
        if (this._collidesAt(x, z, 1.0)) continue;
        if (elevC) {
          const ex = x - elevC.x, ez = z - elevC.z;
          if (ex * ex + ez * ez < EXCLUSION_R * EXCLUSION_R) continue;
        }
        return { x, z };
      }
      // Last-resort fallback — pick a door, but distribute across ALL
      // doors (hash by current spawn count) so a crowded room at least
      // spreads across thresholds instead of mashing one.
      const doorIdx = this.enemySpawns.length % doorPts.length;
      return { x: doorPts[doorIdx].x, z: doorPts[doorIdx].z };
    };

    // Level-index driven variant distribution — level 1 is almost all
    // vanilla "standard" grunts; dangerous variants (dashers, tanks,
    // shielded) drift in as the level index climbs. Pre-computing the
    // breakpoints means each pick is still a single random roll.
    const lv = Math.max(1, this.index || 1);
    const variantBoost = Math.min(0.5, (lv - 1) * 0.06);
    const pickGunmanVariant = () => {
      const r = Math.random();
      // Runner (human-normal mobility, mag-dump style) sits between
      // the standard grunt and the hyper dasher — shows up from L1
      // and climbs gently. Ordering matches the cut ranges below.
      const dasherCut      = 0.00 + variantBoost * 0.20;
      const runnerCut      = dasherCut + 0.08 + variantBoost * 0.14;
      const coverSeekerCut = runnerCut + 0.03 + variantBoost * 0.12;
      const tankCut        = coverSeekerCut + 0.01 + variantBoost * 0.10;
      const shieldedCut    = tankCut + 0.01 + variantBoost * 0.14;
      // Sniper — only appears from L3 onward and stays rare.
      // Designed as a pressure pick that forces the player to close
      // distance, so we don't double-stack them.
      const sniperBaseChance = lv >= 3 ? 0.06 + Math.min(0.12, (lv - 3) * 0.02) : 0;
      const sniperCut        = shieldedCut + sniperBaseChance;
      if (r < dasherCut)      return 'dasher';
      if (r < runnerCut)      return 'runner';
      if (r < coverSeekerCut) return 'coverSeeker';
      if (r < tankCut)        return 'tank';
      if (r < shieldedCut)    return 'shieldedPistol';
      if (r < sniperCut)      return 'sniper';
      return 'standard';
    };
    const pickMeleeVariant = () => {
      // Shield-bearer rate grows slowly with level; level 1 sees almost
      // none so the player isn't overwhelmed by cover before they know
      // how to deal with it.
      const shieldChance = 0.02 + variantBoost * 0.18;
      // Cloaked-assassin rate — gated to level > 3 (i.e. lv >= 4) so
      // the early-game teaches basic melee patterns before the
      // teleport variant shows up. Caps around ~12% so they stay a
      // notable threat rather than the default melee.
      const cloakedChance = lv >= 4 ? Math.min(0.12, 0.04 + (lv - 4) * 0.015) : 0;
      // Knife-thrower variant — same archetype as the cloaked
      // assassin but ranged. Gated one level higher (lv >= 6) so the
      // player meets the melee version first and recognises the
      // hood/cloak silhouette before the ranged twist shows up.
      // Caps around ~8%.
      const throwerChance = lv >= 6 ? Math.min(0.08, 0.03 + (lv - 6) * 0.012) : 0;
      const r = Math.random();
      if (r < throwerChance) return 'cloakedAssassinThrower';
      if (r < throwerChance + cloakedChance) return 'cloakedAssassin';
      if (r < throwerChance + cloakedChance + shieldChance) return 'shieldBearer';
      return 'standard';
    };

    if (room.type === 'combat') {
      // Enemy count ramps continuously past L4 instead of flatlining.
      // Past L4 we layer +1 melee per 3 levels and +1 gunman per 4
      // levels, capped so a level-20 room doesn't pack 15 bodies that
      // burn the AI tick budget. The cap keeps a tight max headcount
      // (~6 melee + ~3 gunmen) which the active AI loop handles fine.
      const meleeBase = lv <= 1 ? 1 : 2;
      const meleeBonus = lv <= 1 ? (Math.random() < 0.35 ? 1 : 0)
                        : lv <= 3 ? (Math.random() < 0.6 ? 1 : 0)
                        : 1 + (Math.random() < 0.4 ? 1 : 0);
      const meleeLevelExtra = Math.min(3, Math.floor(Math.max(0, lv - 4) / 3));
      // Active contract spawnDensityMult — Risky 'Press Wave' multiplies
      // counts. Read live so the modifier kicks in for the current run.
      const densityMult = window.__activeModifiers?.()?.spawnDensityMult || 1;
      // Active contract eliteChanceMult — promotes normal spawns to
      // subBoss tier with a per-enemy roll. Capped at 1 promotion per
      // 4 spawns so a 2x mult doesn't fill the room with mini-bosses.
      const eliteMult = window.__activeModifiers?.()?.eliteChanceMult || 1;
      const eliteRoll = (eliteMult > 1) ? (eliteMult - 1) * 0.15 : 0;
      const eliteCap  = (eliteMult > 1) ? Math.max(1, Math.floor(densityMult * 2)) : 0;
      let elitePromoted = 0;
      const _maybePromote = (entry) => {
        if (eliteRoll <= 0 || elitePromoted >= eliteCap) return entry;
        if (Math.random() < eliteRoll) {
          elitePromoted++;
          return { ...entry, tier: 'subBoss' };
        }
        return entry;
      };
      const meleesN = Math.round((meleeBase + meleeBonus + meleeLevelExtra) * densityMult);
      const gunmanChance = lv <= 1 ? 0.35 : lv <= 3 ? 0.65 : 0.85;
      const baseGunmen = Math.random() < gunmanChance
        ? (lv >= 4 && Math.random() < 0.25 ? 2 : 1)
        : 0;
      const gunmenLevelExtra = Math.min(2, Math.floor(Math.max(0, lv - 5) / 4));
      const gunmenN = Math.round((baseGunmen + gunmenLevelExtra) * densityMult);
      for (let i = 0; i < meleesN; i++) {
        const p = pickOpen();
        this.enemySpawns.push(_maybePromote({
          x: p.x, z: p.z, kind: 'melee', tier: 'normal', roomId: room.id,
          variant: pickMeleeVariant(),
        }));
      }
      for (let i = 0; i < gunmenN; i++) {
        const p = pickOpen();
        this.enemySpawns.push(_maybePromote({
          x: p.x, z: p.z, kind: 'gunman', tier: 'normal', roomId: room.id,
          variant: pickGunmanVariant(),
        }));
      }
    } else if (room.type === 'subBoss') {
      const p = pickOpen(3);
      // Sub-boss picks from the aggressive variants so they play distinct.
      const subVariant = Math.random() < 0.5 ? 'tank' : 'dasher';
      this.enemySpawns.push({
        x: p.x, z: p.z, kind: 'gunman', tier: 'subBoss', roomId: room.id,
        variant: subVariant,
      });
      // Level 1 sub-bosses solo; later levels get escorts.
      const escorts = lv <= 1 ? 0 : (lv <= 3 ? 1 : 2);
      for (let i = 0; i < escorts; i++) {
        const pi = pickOpen();
        this.enemySpawns.push({
          x: pi.x, z: pi.z, kind: 'melee', tier: 'normal', roomId: room.id,
          variant: pickMeleeVariant(),
        });
      }
    } else if (room.type === 'boss') {
      const p = pickOpen(4);
      // Boss variants favor tank + dasher for presence and pressure.
      // Major-boss archetype — four distinct playstyles instead of a
      // flat variant. `evasive` dodges aim vector + mag dumps;
      // `bulletHell` fat-target volley thrower; `assassin` dash-melee
      // (spawns as a melee enemy below); `elite` constant fire + dash.
      const archRoll = Math.random();
      // Nine archetypes in rotation. droneSummoner ("THE HIVEMASTER")
      // is back online after the drones.js pool refactor (shared geom
      // + materials, slot pool, no per-spawn allocs / disposals).
      // Necromancer (`spawner`) is gated to runs deeper than level 5
      // — early runs substitute berserker so the bucket isn't lost.
      let bossArchetype = archRoll < 0.11 ? 'evasive'
                        : archRoll < 0.22 ? 'bulletHell'
                        : archRoll < 0.33 ? 'elite'
                        : archRoll < 0.44 ? 'assassin'
                        : archRoll < 0.55 ? 'flamer'
                        : archRoll < 0.66 ? 'grenadier'
                        : archRoll < 0.76 ? 'droneSummoner'
                        : archRoll < 0.85 ? 'spawner'
                        : archRoll < 0.93 ? 'berserker'
                        :                   'shinigami';
      if (bossArchetype === 'spawner' && this.index <= 5) {
        bossArchetype = 'berserker';
      }
      // Hivemaster (drone summoner) is also lv-5+ gated — early runs
      // shouldn't face the swarm. Substitutes berserker on level <= 5
      // so the rotation slot isn't wasted.
      if (bossArchetype === 'droneSummoner' && this.index <= 5) {
        bossArchetype = 'berserker';
      }
      // Cloaked Assassin major boss — gated to level > 3 so the
      // teleport-cloak boss archetype doesn't show up in the
      // early-game rotation. Substitutes elite (close-range
      // pressure with steady fire) so the bucket isn't lost.
      if (bossArchetype === 'assassin' && this.index <= 3) {
        bossArchetype = 'elite';
      }
      // SHINIGAMI — late-game megaboss assassin variant. Gated to
      // lv >= 8 so the player has met the regular Cloaked Assassin
      // major boss + several encounter cycles before the named
      // teleport-shower-of-knives megaboss appears. Substitutes
      // the regular assassin archetype (which is already lv > 3
      // gated) on lv 4-7, falls back to elite below 4.
      if (bossArchetype === 'shinigami' && this.index < 8) {
        bossArchetype = this.index <= 3 ? 'elite' : 'assassin';
      }
      const archVariant =
        bossArchetype === 'bulletHell'    ? 'tank'
      : bossArchetype === 'shinigami'     ? 'cloakedAssassinThrower'   // always knife-thrower
      : bossArchetype === 'assassin'      ? (Math.random() < 0.5 ? 'cloakedAssassinThrower' : 'cloakedAssassin')
      : bossArchetype === 'elite'         ? 'dasher'
      : bossArchetype === 'flamer'        ? 'tank'        // beefy rush
      : bossArchetype === 'grenadier'     ? 'dasher'      // fast + dashy
      : bossArchetype === 'droneSummoner' ? 'coverSeeker' // hangs back, lets drones do work
      : bossArchetype === 'spawner'       ? 'tank'        // beefy because adds are the threat
      : bossArchetype === 'berserker'     ? 'standard'    // melee variant slot
      :                                     'coverSeeker';
      const bossVariant = archVariant;
      // Berserker spawns as a melee enemy (close-quarters tank).
      // Other archetypes use the gunman manager.
      const bossKind = (bossArchetype === 'assassin' || bossArchetype === 'shinigami' || bossArchetype === 'berserker') ? 'melee' : 'gunman';
      this.enemySpawns.push({
        x: p.x, z: p.z,
        kind: bossKind, tier: 'boss', roomId: room.id,
        variant: bossVariant,
        archetype: bossArchetype,
        majorBoss: true,
      });
      // Boss room escorts scale with level — level 1 boss is the boss
      // and a single melee so the final fight is tight but survivable.
      const bossMelees = lv <= 1 ? 1 : 2;
      const bossDashers = lv <= 1 ? 0 : 1;
      for (let i = 0; i < bossDashers; i++) {
        const pEscort = pickOpen(2);
        this.enemySpawns.push({
          x: pEscort.x, z: pEscort.z, kind: 'gunman', tier: 'normal', roomId: room.id,
          variant: 'dasher',
        });
      }
      for (let i = 0; i < bossMelees; i++) {
        const pi = pickOpen();
        this.enemySpawns.push({
          x: pi.x, z: pi.z, kind: 'melee', tier: 'normal', roomId: room.id,
          variant: pickMeleeVariant(),
        });
      }
    }
  }

  _spawnNPC(room) {
    const kind = room.type;
    // Per-kind palette for the sign / display cubes.
    const NPC_STYLE = {
      merchant:    { accent: 0xd0a060, displays: [0x6aaedc, 0xffd27a, 0x70d0a0] },
      healer:      { accent: 0x70c8a0, displays: [0xff7070, 0xff80d0, 0xd0d0d0] },
      gunsmith:    { accent: 0xdc6a3a, displays: [0x2e2e2e, 0xffc060, 0xdc6a3a] },
      armorer:     { accent: 0x6a8edc, displays: [0x4a5a6a, 0x8a9aad, 0x6a8edc] },
      tailor:      { accent: 0xd070c8, displays: [0xc9a87a, 0xe0a0d0, 0x9a5ac9] },
      relicSeller: { accent: 0xe6b94a, displays: [0xe6b94a, 0xd0a060, 0xffd27a] },
      blackMarket: { accent: 0x9a5ac9, displays: [0x1a0f24, 0x9a5ac9, 0x5a2a9a] },
    };
    const style = NPC_STYLE[kind] || NPC_STYLE.merchant;
    const accent = style.accent;
    const group = new THREE.Group();

    // Bipedal NPC standing behind the counter.
    const person = this._buildNpcPerson(kind);
    person.position.set(0, 0, -0.25);
    group.add(person);

    // Kiosk: low counter + vertical back panel with a sign.
    const counterMat = sharedMaterial({ color: 0x3a2a1e, roughness: 0.85 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 1.0), counterMat);
    counter.position.set(0, 0.4, 0.7);
    counter.castShadow = true;
    counter.receiveShadow = true;
    group.add(counter);

    const panelMat = sharedMaterial({ color: 0x24221a, roughness: 0.9 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.1), panelMat);
    panel.position.set(0, 1.5, -0.6);
    panel.castShadow = true;
    group.add(panel);

    // Sign on the back panel (a glowing colored rectangle).
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.45, 0.04),
      sharedMaterial({ type: 'basic', color: accent }),
    );
    sign.position.set(0, 1.8, -0.54);
    group.add(sign);

    // Display items on the counter — three floating tiny cubes tinted per
    // merchant type.
    style.displays.forEach((c, i) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.24, 0.24),
        sharedMaterial({ type: 'basic', color: c }),
      );
      m.position.set(-0.7 + i * 0.7, 0.96, 0.7);
      group.add(m);
    });

    // Sign tint is already MeshBasicMaterial (unlit, full-bright) and
    // bloom in postfx carries the glow. The per-shop PointLight that
    // used to live here cost ~6 shops × per-mesh shader recompile and
    // didn't add much over the bloom. Phase 4 light reduction policy:
    // shop kiosks are emissive-only, no real lights.

    // Pick a placement slot. Centre placement is dropped — the user
    // wants every merchant on a wall facing inward so the kiosk
    // signage and displays always read clearly. The Bear Merchant
    // keeps its centre placement (handled in _spawnBearMerchant).
    // East and south walls are excluded because the iso camera at
    // (+X, +Y, +Z) would frame the kiosk's back; only N/W placements
    // present the front to the camera.
    const b = room.bounds;
    const spots = [
      // West wall, face east — camera sees the front in 3/4 from the right.
      { x: b.minX + 2.2, z: (b.minZ + b.maxZ) / 2, rot: Math.PI / 2 },
      // North wall, face south — camera sees the front straight on.
      { x: (b.minX + b.maxX) / 2, z: b.minZ + 2.2, rot: 0 },
    ];
    const spot = spots[Math.floor(Math.random() * spots.length)];
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.rot;
    this.scene.add(group);

    // Kiosk collider — counter (2.4×1.0) + back panel (2.4×0.1) + the
    // NPC standing behind. Local footprint spans x: ±1.2,
    // z: -0.65 (back of panel) to +1.2 (front of counter), centered
    // at local (0, 0, 0.275). Rotate the offset and the bounding
    // dimensions by spot.rot so kiosks pressed against any wall
    // get a properly-aligned blocker. Without this the player could
    // walk straight through the counter onto the merchant.
    {
      const localCx = 0, localCz = 0.275;
      const localW = 2.55;     // padded a hair past visual width
      const localD = 1.95;     // -0.65 → +1.2 plus a small margin
      const cosY = Math.cos(spot.rot), sinY = Math.sin(spot.rot);
      const offX = localCx * cosY + localCz * sinY;
      const offZ = -localCx * sinY + localCz * cosY;
      const worldW = Math.abs(localW * cosY) + Math.abs(localD * sinY);
      const worldD = Math.abs(localW * sinY) + Math.abs(localD * cosY);
      this.addEncounterCollider(spot.x + offX, spot.z + offZ, worldW, worldD, 1.8);
    }

    this.npcs.push({
      kind, group, room,
      pos: new THREE.Vector3(spot.x, 0, spot.z),
      // Rig is stashed on the person group by `_buildNpcPerson`; surface
      // it on the npc record so `animateNPCs` can tick it each frame.
      rig: person.userData.rig || null,
    });
  }

  _buildNpcPerson(kind) {
    // Shopkeepers use the SAME rig as the player + enemies so they
    // read as actors in the world, not stacked boxes behind a
    // counter. Per-kind tint palette drives body/head/leg/gear
    // colours. `updateAnim` is called every tick from the level
    // animation pass (speed=0, aiming=false) so they breathe and
    // sway subtly instead of standing frozen.
    const palette = KEEPER_PALETTE[kind] || KEEPER_PALETTE.merchant;
    const rig = buildRig({
      scale: 0.78,
      bodyColor: palette.body,
      headColor: palette.skin,
      legColor:  palette.pants,
      armColor:  palette.body,
      handColor: palette.skin,
      gearColor: palette.gear,
      bootColor: palette.boots,
    });
    // Initialise the animation state so the walk/idle blend weights
    // start at zero and the breath cycle begins from a random phase
    // (so neighbouring NPCs don't breathe in perfect sync).
    initAnim(rig);
    // Healer wears a medical cross on the chest — only kind-specific
    // decoration we keep from the old prim-NPC code.
    if (kind === 'healer') {
      const whiteMat = sharedMaterial({ type: 'basic', color: 0xffffff });
      const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.01), whiteMat);
      cross1.position.set(0, 1.25, 0.19);
      rig.group.add(cross1);
      const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.01), whiteMat);
      cross2.position.set(0, 1.25, 0.19);
      rig.group.add(cross2);
    }
    // Attach the rig to an NPC record so the level animation pass
    // can tick it (hooked below in animateNPCs).
    const g = rig.group;
    g.userData.rig = rig;
    g.userData.npcKind = kind;
    return g;
  }

  // Giant glowing white bear — 'bearMerchant' NPC. Stacked primitives, big.
  _spawnBearMerchant(room) {
    const group = new THREE.Group();
    // Off-white fur — pure 0xffffff blew out the bloom threshold and
    // the bear glowed like a star. Slight warm tint reads as "holy"
    // without triggering the post-fx bloom.
    const mat = sharedMaterial({ type: 'basic', color: 0xb8b4a8 });
    const accent = sharedMaterial({ type: 'basic', color: 0xa89878 });
    const dark = sharedMaterial({ type: 'basic', color: 0x1a1a1a });

    const body = new THREE.Mesh(new THREE.SphereGeometry(1.5, 22, 16), mat);
    body.position.y = 1.6;
    group.add(body);

    // Larger, rounder head — sized roughly as wide as the body for
    // the chibi-mascot silhouette. Sits low against the body.
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 22, 16), mat);
    head.position.set(0, 3.55, 0.55);
    group.add(head);

    // Ears stay round + sit high on the dome of the head, spaced
    // out enough that they read as ears not horns.
    const earGeom = new THREE.SphereGeometry(0.45, 14, 10);
    const earL = new THREE.Mesh(earGeom, mat);
    earL.position.set(-1.05, 4.55, 0.45);
    group.add(earL);
    const earR = new THREE.Mesh(earGeom, mat);
    earR.position.set(1.05, 4.55, 0.45);
    group.add(earR);
    // Inner-ear detail — slightly darker accent inside each ear.
    const earInnerL = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), accent);
    earInnerL.position.set(-1.0, 4.50, 0.78);
    group.add(earInnerL);
    const earInnerR = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), accent);
    earInnerR.position.set(1.0, 4.50, 0.78);
    group.add(earInnerR);

    // Smaller snout pushed flat against the face — gives the head
    // a flatter, rounder profile rather than the muzzle-forward look.
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), accent);
    snout.position.set(0, 3.20, 1.78);
    group.add(snout);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), dark);
    nose.position.set(0, 3.32, 1.96);
    group.add(nose);

    // Eyes — bigger black ovals with a small white catchlight pupil
    // so they read as alive cartoon eyes rather than flat dots. Set
    // wide on the round face and slightly above midline for the
    // friendly mascot look.
    const eyeGeom = new THREE.SphereGeometry(0.20, 14, 10);
    const eyeL = new THREE.Mesh(eyeGeom, dark);
    eyeL.position.set(-0.55, 3.85, 1.55);
    group.add(eyeL);
    const eyeR = new THREE.Mesh(eyeGeom, dark);
    eyeR.position.set(0.55, 3.85, 1.55);
    group.add(eyeR);
    // Catchlights — small bright dots offset from the eye centre.
    const catchMat = sharedMaterial({ type: 'basic', color: 0xffffff });
    const catchGeom = new THREE.SphereGeometry(0.06, 8, 6);
    const catchL = new THREE.Mesh(catchGeom, catchMat);
    catchL.position.set(-0.50, 3.93, 1.72);
    group.add(catchL);
    const catchR = new THREE.Mesh(catchGeom, catchMat);
    catchR.position.set(0.60, 3.93, 1.72);
    group.add(catchR);
    // Cheek blush — small warm-tan circles for the mascot warmth.
    const blushMat = sharedMaterial({ type: 'basic', color: 0xd09080, transparent: true, opacity: 0.55 });
    const blushGeom = new THREE.SphereGeometry(0.18, 10, 8);
    const blushL = new THREE.Mesh(blushGeom, blushMat);
    blushL.position.set(-0.72, 3.45, 1.45);
    group.add(blushL);
    const blushR = new THREE.Mesh(blushGeom, blushMat);
    blushR.position.set(0.72, 3.45, 1.45);
    group.add(blushR);

    // Front legs / arms stub.
    const legGeom = new THREE.SphereGeometry(0.55, 14, 10);
    const armL = new THREE.Mesh(legGeom, mat);
    armL.position.set(-1.15, 1.3, 0.7);
    group.add(armL);
    const armR = new THREE.Mesh(legGeom, mat);
    armR.position.set(1.15, 1.3, 0.7);
    group.add(armR);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(2.7, 18, 14),
      sharedMaterial({ type: 'basic', color: 0xa89878, transparent: true, opacity: 0.06 }),
    );
    glow.position.y = 2.3;
    group.add(glow);

    const light = new THREE.PointLight(0xffd8a0, 0.9, 10);
    light.position.y = 3;
    group.add(light);

    // Halo — spinning torus above its head. Dimmed to a soft tan so
    // the bloom pass doesn't over-amp it either.
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.06, 10, 24),
      sharedMaterial({ type: 'basic', color: 0xd0b07a }),
    );
    halo.position.y = 5.4;
    halo.rotation.x = Math.PI / 2;
    group.add(halo);

    group.position.set(room.cx, 0, room.cz);
    this.scene.add(group);
    // Bear silhouette is roughly a 3m sphere — register a chunky
    // collider so the player + AI walk around the great bear instead
    // of through him.
    this.addEncounterCollider(room.cx, room.cz, 3.0, 3.0, 4.5);

    this.npcs.push({
      kind: 'bearMerchant', group, room,
      pos: new THREE.Vector3(room.cx, 0, room.cz),
      halo,
    });
  }

  animateNPCs(dt) {
    for (const npc of this.npcs) {
      if (npc.halo) npc.halo.rotation.z += dt * 1.2;
      // Shopkeepers use the shared rig — tick its updateAnim each
      // frame so the idle breath / sway cycles play. speed=0 +
      // aiming=false keeps them in the idle pose (no walk blend, no
      // weapon hold), and meleeStance=false + rifleHold=false skips
      // combat-specific overrides.
      if (npc.rig) {
        updateAnim(npc.rig, {
          speed: 0,
          aiming: 0,
          crouched: false,
          handedness: 'right',
          rifleHold: false,
          blockPose: false,
          meleeStance: false,
          swingProgress: 0,
          aimYaw: 0,
          aimPitch: 0,
        }, dt);
      }
    }
  }

  nearestNPC(playerPos, radius = 2.5) {
    let best = null, bestD = radius;
    for (const npc of this.npcs) {
      const dx = npc.pos.x - playerPos.x;
      const dz = npc.pos.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD) { bestD = d; best = npc; }
    }
    return best;
  }

  _addObstacle(x, y, z, w, h, d, color) {
    // Doors animate (scale.y on open, color flip on lock/unlock,
    // material.opacity tweaks). They MUST stay as real THREE.Mesh
    // objects — the wall instancer's static-bake model can't represent
    // per-frame matrix mutations cleanly. Branch by color so DOOR_*
    // and EXIT_COLOR route to the legacy mesh path; everything else
    // (outer walls, inner walls, low cover, columns, platforms,
    // elevator solid panels) goes through the instancer.
    const isDynamicColor = (color === DOOR_COLOR
                          || color === DOOR_OPEN_COLOR
                          || color === EXIT_COLOR);
    if (!isDynamicColor) {
      const inst = wallInstancer();
      if (inst) {
        const proxy = inst.addWall(x, y, z, w, h, d, color);
        if (proxy) {
          proxy.userData.collisionXZ = {
            minX: x - w / 2, maxX: x + w / 2,
            minZ: z - d / 2, maxZ: z + d / 2,
          };
          if (y + h / 2 < WALL_HEIGHT / 2) proxy.userData.isLowCover = true;
          this.obstacles.push(proxy);
          this._dirtySolid();
          return proxy;
        }
        // Pool overflow — fall through to legacy path so the wall is
        // still rendered (just not via instancing). One-shot warning
        // already fired inside the instancer.
      }
    }
    const mat = sharedMaterial({ color, roughness: 0.85 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    // Walls don't cast shadows. Iso camera angle + room boundaries
    // mean shadow contribution from walls is barely perceptible —
    // dropping them from the shadow map pass scales down the
    // shadow render cost linearly with wall count (often 100+
    // walls per level).
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.collisionXZ = {
      minX: x - w / 2, maxX: x + w / 2,
      minZ: z - d / 2, maxZ: z + d / 2,
    };
    // Tag obstacles whose top sits below half the wall height as low
    // cover. The aim system skips these when the player is crouching so
    // the shot resolves past the cover rather than into its near face.
    if (y + h / 2 < WALL_HEIGHT / 2) mesh.userData.isLowCover = true;
    // Walls + doors + columns don't move during gameplay. Disable
    // matrixAutoUpdate so Three.js skips the per-frame matrix
    // recompute cascade for hundreds of obstacles per level. We
    // call updateMatrix() once here so the world matrix is correct
    // for the lifetime of the mesh; door open/lock paths that move
    // the mesh re-set position then call updateMatrix manually.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.obstacles.push(mesh);
    this._dirtySolid();
    return mesh;
  }

  // Obstacles that still block raycasts (bullets + LoS). Three cases are
  // filtered out:
  //   1. Unlocked doors — mesh flattened but geometry still raycasts.
  //   2. collisionXZ === null — props cleared by _clearDoorCorridors so
  //      the player can walk through; bullets have to clear the same
  //      opening or they'll silently vanish into an invisible couch.
  //   3. visible === false — belt-and-suspenders for any future path
  //      that hides a prop without explicitly nulling its AABB.
  //
  // Called 8+ times per frame (every shot, every LoS test, every wall-
  // occlusion ray), so we cache the filtered array and invalidate it
  // only when an obstacle's unlocked/collision/visible state changes
  // (door lock/unlock, corridor clear, level regen). ~30x speedup on
  // hot frames.
  solidObstacles() {
    if (this._solidCache && !this._solidDirty) return this._solidCache;
    const out = [];
    for (const m of this.obstacles) {
      if (m.userData.unlocked) continue;
      if (m.userData.collisionXZ === null) continue;
      if (m.visible === false) continue;
      out.push(m);
    }
    this._solidCache = out;
    this._solidDirty = false;
    this._projectileObstacleGrid = null;
    this._projectileObstacleSource = null;
    return out;
  }
  // Mark the solid-obstacles cache stale. Cheap; no work until the
  // next solidObstacles() call.
  _dirtySolid() {
    this._solidDirty = true;
    this._visionDirty = true;
    this._projectileObstacleGrid = null;
    this._projectileObstacleSource = null;
    // Spatial-hash collision grid is now stale too. Rebuilt lazily on
    // the next _collidesAt query.
    this._collidesDirty = true;
  }

  projectileObstacleGrid() {
    const obstacles = this.solidObstacles();
    if (!this._projectileObstacleGrid) {
      this._projectileObstacleGrid = new StaticObstacleGrid2D(PROJECTILE_OBSTACLE_CELL_SIZE);
      this._projectileObstacleGrid.rebuild(obstacles, (o) => o.userData.collisionXZ);
      this._projectileObstacleSource = obstacles;
    } else if (this._projectileObstacleSource !== obstacles) {
      this._projectileObstacleGrid.rebuild(obstacles, (o) => o.userData.collisionXZ);
      this._projectileObstacleSource = obstacles;
    }
    return this._projectileObstacleGrid;
  }

  // Vision blockers — walls + closed doors + elevator panels, but NOT
  // props (bookshelves, couches) since the player can see over them.
  // Cached alongside solidObstacles on the same dirty flag.
  visionBlockers() {
    if (this._visionCache && !this._visionDirty) return this._visionCache;
    const out = [];
    for (const m of this.obstacles) {
      if (m.userData.isProp) continue;
      if (m.userData.unlocked) continue;
      out.push(m);
    }
    this._visionCache = out;
    this._visionDirty = false;
    return out;
  }

  // True if at least one door connecting to `roomId` has been unlocked.
  // Enemies gated on this stay dormant (patrol / idle only) while their
  // room is sealed; they wake up the moment a connecting door opens,
  // typically because a neighbouring room was just cleared.
  isRoomActive(roomId) {
    if (roomId === undefined || roomId < 0) return true;  // hallway wanderers
    for (const m of this.obstacles) {
      if (!m.userData.isDoor) continue;
      if (!m.userData.connects?.includes(roomId)) continue;
      if (m.userData.unlocked) return true;
    }
    return false;
  }

  // Unlock the doors connected to a cleared room by making the door obstacles
  // non-blocking and switching their color.
  // Re-lock doors connecting to a room — used for boss-arena lock-in.
  // Restores a blocking wall (non-transparent, scale Y back to 1,
  // collision AABB rebuilt from geometry). Skips doors that were
  // already unlocked via a keycard so the player can't be re-
  // trapped by a door they already opened manually.
  lockDoorsForRoom(roomId) {
    for (const mesh of this.obstacles) {
      if (!mesh.userData.isDoor) continue;
      if (!mesh.userData.connects?.includes(roomId)) continue;
      if (mesh.userData.keyRequired) continue;   // keep keycard doors honest
      mesh.userData.unlocked = false;
      const geom = mesh.geometry.parameters;
      const w = geom?.width || 1.2;
      const d = geom?.depth || 1.2;
      mesh.scale.y = 1.0;
      mesh.position.y = WALL_HEIGHT / 2;
      mesh.updateMatrix();
      mesh.material.color.setHex(DOOR_COLOR);
      mesh.material.opacity = 1.0;
      mesh.material.transparent = false;
      mesh.userData.collisionXZ = {
        minX: mesh.position.x - w / 2, maxX: mesh.position.x + w / 2,
        minZ: mesh.position.z - d / 2, maxZ: mesh.position.z + d / 2,
      };
    }
    this._dirtySolid();
  }

  unlockDoorsForRoom(roomId) {
    for (const mesh of this.obstacles) {
      if (!mesh.userData.isDoor) continue;
      // Connector / extraction-room doors built outside _buildDoor (e.g.
      // skybridges, extraction-room sealing door) don't carry a
      // `connects` array — they're not part of the chain-room unlock
      // graph and stay unlocked-on-condition (boss kill etc), not
      // room-clear. Skip them silently.
      const connects = mesh.userData.connects;
      if (!connects || typeof connects.includes !== 'function') continue;
      if (!connects.includes(roomId)) continue;
      if (mesh.userData.unlocked) continue;
      // Keycard-gated doors ignore room-clear unlocks — they only
      // open via tryKeycardUnlock with a matching held token.
      if (mesh.userData.keyRequired) continue;
      mesh.userData.unlocked = true;
      mesh.userData.collisionXZ = null;      // no longer a physical wall
      mesh.material.color.setHex(DOOR_OPEN_COLOR);
      mesh.material.opacity = 0.3;
      mesh.material.transparent = true;
      mesh.scale.y = 0.08;                    // flatten into the floor
      mesh.position.y = 0.04;
      mesh.updateMatrix();
    }
    this._dirtySolid();
  }

  // Flatten every interior "elevator" door panel (added by _buildElevator).
  openElevatorDoor() {
    let opened = false;
    for (const mesh of this.obstacles) {
      if (!mesh.userData.isElevatorDoor || mesh.userData.unlocked) continue;
      mesh.userData.unlocked = true;
      mesh.userData.collisionXZ = null;
      mesh.material.color.setHex(DOOR_OPEN_COLOR);
      mesh.material.opacity = 0.3;
      mesh.material.transparent = true;
      mesh.scale.y = 0.08;
      mesh.position.y = 0.04;
      mesh.updateMatrix();
      opened = true;
    }
    if (opened) this._dirtySolid();
    return opened;
  }

  // Look up the door mesh that sits between two adjacent rooms. Used
  // by path reconstruction so callers get a mesh with `.userData.cx`
  // / `.cz` ready to use as a waypoint.
  _doorBetween(aId, bId) {
    for (const mesh of this.obstacles) {
      if (!mesh.userData.isDoor) continue;
      const c = mesh.userData.connects;
      if (!c) continue;
      if ((c[0] === aId && c[1] === bId) || (c[0] === bId && c[1] === aId)) {
        return mesh;
      }
    }
    return null;
  }

  // BFS over the room-neighbor graph, from `fromId` to `toId`, only
  // traversing doors the enemy can actually use right now (unlocked,
  // or default-open; key-gated doors block unless the enemy somehow
  // has a key — which they never do). Returns an ordered array of
  // door meshes the traveller must pass through, or null if the
  // destination isn't reachable from the origin.
  //
  // Called from gunman / melee AI each time the player changes rooms
  // so enemies route around walls instead of piling up against one.
  pathDoorsFrom(fromId, toId) {
    if (fromId == null || toId == null || fromId === toId) return [];
    const rooms = this.rooms;
    if (!rooms[fromId] || !rooms[toId]) return null;
    const visited = new Map();
    visited.set(fromId, null);
    const queue = [fromId];
    let found = false;
    while (queue.length) {
      const cur = queue.shift();
      if (cur === toId) { found = true; break; }
      const room = rooms[cur];
      if (!room) continue;
      for (const n of room.neighbors) {
        if (visited.has(n.otherId)) continue;
        const door = this._doorBetween(cur, n.otherId);
        // Door must exist and be usable — key-gated doors without the
        // unlocked flag block the traversal; everything else (unlocked
        // standard doors, open doorways) passes.
        if (door) {
          if (door.userData.keyRequired && !door.userData.unlocked) continue;
        }
        visited.set(n.otherId, cur);
        queue.push(n.otherId);
      }
    }
    if (!found) return null;
    // Reconstruct the chain of rooms.
    const roomChain = [];
    let cur = toId;
    while (cur !== null && cur !== undefined) {
      roomChain.unshift(cur);
      cur = visited.get(cur);
    }
    // Translate adjacent pairs to the door mesh between them.
    const doors = [];
    for (let i = 0; i < roomChain.length - 1; i++) {
      const d = this._doorBetween(roomChain[i], roomChain[i + 1]);
      if (d) doors.push(d);
    }
    return doors;
  }

  // Return the door obstacle most useful for an enemy in `roomId` trying
  // to reach `playerPos`. Prefers unlocked doors (locked doors bounce
  // the AI off the wall). When `enemyPos` is given we pick the door
  // that minimises the total path length `enemy → door → player`, which
  // naturally spreads enemies across multiple doors instead of piling
  // every one of them at the nearest-to-player door. Falls back to the
  // player-nearest door when no enemyPos is supplied.
  findDoorToward(roomId, playerPos, enemyPos = null) {
    let best = null, bestScore = Infinity;
    for (const o of this.obstacles) {
      if (!o.userData.isDoor) continue;
      if (!o.userData.connects || !o.userData.connects.includes(roomId)) continue;
      const dx = o.userData.cx - playerPos.x;
      const dz = o.userData.cz - playerPos.z;
      const dPlayer = Math.hypot(dx, dz);
      let score;
      if (enemyPos) {
        const ex = o.userData.cx - enemyPos.x;
        const ez = o.userData.cz - enemyPos.z;
        const dEnemy = Math.hypot(ex, ez);
        score = dEnemy + dPlayer;
      } else {
        score = dPlayer;
      }
      // Locked doors are a last resort — heavy penalty so any open door
      // wins over the nearest-but-closed one.
      if (!o.userData.unlocked) score += 40;
      if (score < bestScore) { bestScore = score; best = o; }
    }
    if (!best) return null;
    return { x: best.userData.cx, z: best.userData.cz, unlocked: !!best.userData.unlocked };
  }

  // Guarantee every doorway has a clear corridor. For each door we sweep a
  // DOOR_WIDTH-wide strip extending 2m into both connecting rooms along
  // the door's perpendicular axis, and null collision on any obstacle
  // whose box overlaps that strip. Outer walls are exempted so the door
  // gap itself isn't filled. Elevator panels are also exempted (they're
  // intentional gates).
  // Walks each room's four outer edges with a 1m sample step. At
  // every sample we test whether the edge is already covered by a
  // wall/door obstacle within ~0.8m; if nothing is there, a plug
  // wall block fills the gap. Door gaps and their approach corridors
  // are explicitly excluded so the seal can never wall off a doorway.
  _sealRoomPerimeters() {
    const STEP = 1.0;
    const HALF_STEP = STEP / 2;
    // checkRadius must satisfy: PLUG_LEN/2 + checkRadius < STEP, so
    // freshly-placed plugs don't skip their own next-sample slot
    // (which produced a picket-fence with walkable gaps).
    //
    // Bumped checkRadius to 0.35 so plugs are suppressed near actual
    // existing walls, eliminating the "extra segment next to the
    // wall" artifact — a short plug placed right against a full wall
    // was visually reading as a separate block. With PLUG_LEN=1.25,
    // 0.35 is the maximum that still lets adjacent plugs (1m apart)
    // both place.
    const checkRadius = 0.35;
    const PLUG_LEN = STEP + 0.25;
    // Pre-gather door centres so the sampler can skip any sample
    // landing inside a door corridor. This is belt-and-braces: the
    // hasWallAt check already detects door collision boxes, but if
    // _clearDoorCorridors or a future pass nulled the door somehow,
    // the skip keeps us from plugging a real doorway.
    const doorKeepouts = [];
    for (const o of this.obstacles) {
      if (!o.userData.isDoor) continue;
      const g = o.geometry?.parameters;
      const halfW = (g?.width || 4) / 2 + 0.8;
      const halfD = (g?.depth || 1.2) / 2 + 0.8;
      doorKeepouts.push({ x: o.position.x, z: o.position.z, halfW, halfD });
    }
    const inDoorKeepout = (x, z) => {
      for (const k of doorKeepouts) {
        if (Math.abs(x - k.x) < k.halfW && Math.abs(z - k.z) < k.halfD) return true;
      }
      return false;
    };
    const hasWallAt = (x, z) => {
      for (const o of this.obstacles) {
        const b = o.userData.collisionXZ;
        if (!b) continue;
        // Only count real perimeter-style obstacles, not tiny props
        // / cover blocks in the room interior.
        if (o.userData.isProp) continue;
        if (x > b.minX - checkRadius && x < b.maxX + checkRadius
         && z > b.minZ - checkRadius && z < b.maxZ + checkRadius) return true;
      }
      return false;
    };
    for (const room of this.rooms) {
      const b = room.bounds;
      const sides = [
        { fixed: 'z', fxv: b.minZ, stepAxis: 'x', from: b.minX, to: b.maxX },
        { fixed: 'z', fxv: b.maxZ, stepAxis: 'x', from: b.minX, to: b.maxX },
        { fixed: 'x', fxv: b.minX, stepAxis: 'z', from: b.minZ, to: b.maxZ },
        { fixed: 'x', fxv: b.maxX, stepAxis: 'z', from: b.minZ, to: b.maxZ },
      ];
      for (const side of sides) {
        // Range now goes from `from` to `to` inclusive (was
        // `from + HALF_STEP` to `< to`), so the corner endpoints
        // are sampled. Old version skipped the first/last 0.5m of
        // every side, leaving four corners-per-room unverified —
        // shape-room chamfers + neighbour-room misalignments
        // produced visible gaps + odd geometry there. checkRadius
        // already suppresses redundant plugs next to existing
        // walls, so re-sampling the corners is safe.
        for (let s = side.from; s <= side.to + 0.001; s += STEP) {
          const sc = Math.min(s, side.to);    // clamp final sample
          const x = side.fixed === 'x' ? side.fxv : sc;
          const z = side.fixed === 'z' ? side.fxv : sc;
          if (inDoorKeepout(x, z)) continue;
          if (hasWallAt(x, z)) continue;
          if (side.fixed === 'x') {
            this._addObstacle(x, WALL_HEIGHT / 2, z,
              WALL_THICK, WALL_HEIGHT, PLUG_LEN, OUTER_WALL_COLOR);
          } else {
            this._addObstacle(x, WALL_HEIGHT / 2, z,
              PLUG_LEN, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
          }
        }
      }
      // Explicit 4-corner caps. After the side sweep, the corner
      // CELL (b.minX/maxX × b.minZ/maxZ) is the most failure-prone
      // spot: shape templates often end their perimeter walls just
      // short of the corner, and adjacent rooms with different
      // shapes can leave a tiny diagonal gap at the meeting cell.
      // Drop a WALL_THICK × WALL_THICK pillar block at each corner
      // unless something else is already there.
      const corners = [
        { x: b.minX, z: b.minZ },
        { x: b.maxX, z: b.minZ },
        { x: b.minX, z: b.maxZ },
        { x: b.maxX, z: b.maxZ },
      ];
      for (const c of corners) {
        if (inDoorKeepout(c.x, c.z)) continue;
        if (hasWallAt(c.x, c.z)) continue;
        this._addObstacle(c.x, WALL_HEIGHT / 2, c.z,
          WALL_THICK, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
      }
    }
  }

  _buildOuterPerimeter() {
    if (!this.rooms || this.rooms.length === 0) return;
    // Aggregate bounds across every room — the "map box".
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of this.rooms) {
      const b = r.bounds;
      if (!b) continue;
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }
    if (!isFinite(minX)) return;
    // Pad outward so the wall sits just past any edge-room's outer face
    // rather than sharing the same line (avoids z-fighting + keeps the
    // ring reading as a distinct boundary).
    const pad = 1.0;
    const x0 = minX - pad, x1 = maxX + pad;
    const z0 = minZ - pad, z1 = maxZ + pad;
    const width  = x1 - x0;
    const depth  = z1 - z0;
    const thick  = WALL_THICK * 1.5;
    // Four outer walls. Each is a single long obstacle — interior
    // door corridors never reach this far out so we don't need to
    // slice them. `isOuter` tag lets any later pass skip them cleanly.
    const spawn = (cx, cz, w, d) => {
      const m = this._addObstacle(cx, WALL_HEIGHT / 2, cz,
        w, WALL_HEIGHT, d, OUTER_WALL_COLOR);
      if (m) m.userData.isOuter = true;
    };
    spawn((x0 + x1) / 2, z0 - thick / 2, width + thick * 2, thick);  // north
    spawn((x0 + x1) / 2, z1 + thick / 2, width + thick * 2, thick);  // south
    spawn(x0 - thick / 2, (z0 + z1) / 2, thick, depth);              // west
    spawn(x1 + thick / 2, (z0 + z1) / 2, thick, depth);              // east
  }

  // Replace the boss room's solid edge wall (on the side the
  // extraction chamber attaches to) with two flanking segments that
  // hug the door. Without this, the entire boss-side edge would
  // stay rendered as one wall straddling the door — leading to the
  // playtest report "boss exit wall doesn't go down". The chamber
  // already has its own flanking walls; this method does the same
  // for the boss side. Hides the original wall (zero-scales the
  // instancer slot + nulls collision) and adds two new short
  // flanking obstacles. Both flanking segments stay solid forever;
  // only the door panel drops on revealExit().
  _splitBossWallForExtractionDoor(bossRoom, exit) {
    if (!bossRoom || !exit || !exit.doorMesh || !exit.dir) return;
    const door = exit.doorMesh;
    const dx = door.userData.cx;
    const dz = door.userData.cz;
    const geo = door.geometry?.parameters;
    if (!geo) return;
    const horizDoor = (geo.width || 0) > (geo.depth || 0);
    const halfDoorGap = DOOR_WIDTH / 2;
    const b = bossRoom.bounds;
    const dir = exit.dir;

    // Collect EVERY perimeter wall on the chamber-facing edge that
    // intersects (or sits within) the door's full gap span. We then
    // hide all of them — necessary because shape boss rooms (lShape,
    // gallery, rotunda, ...) build the perimeter as MULTIPLE
    // segments via SHAPE_REGISTRY.build, not a single full-edge
    // wall. Earlier this code only found ONE wall, so multi-segment
    // shape perimeters would leave 1+ visual walls in the doorway
    // even after the corridor-clearer ran (the corridor-clearer
    // preserves segments that don't span the gap, so each segment
    // individually survived).
    //
    // Tolerance bumped to 1.6m for the on-edge axis match so
    // chamfered shape walls (rotunda's outer arc, lShape's interior
    // corner) still register. For each hidden wall we also build
    // two flanking re-builds outside the door gap (capped to the
    // door's flanks plus a 0.5m overlap so adjacent segments meet
    // cleanly without z-fighting).
    const hits = [];
    for (const o of this.obstacles) {
      if (o.userData.isDoor) continue;
      if (o.userData.isProp) continue;
      if (!o.userData?.collisionXZ) continue;
      if (o.visible === false) continue;       // already hidden
      const cb = o.userData.collisionXZ;
      const wMidX = (cb.minX + cb.maxX) / 2;
      const wMidZ = (cb.minZ + cb.maxZ) / 2;
      const wW = cb.maxX - cb.minX;
      const wD = cb.maxZ - cb.minZ;
      // On-edge — wall sits on the chamber-facing side of the boss.
      let onEdge = false;
      if (dir === 'east'  && Math.abs(wMidX - b.maxX) < 1.6 && wD >= wW) onEdge = true;
      else if (dir === 'west'  && Math.abs(wMidX - b.minX) < 1.6 && wD >= wW) onEdge = true;
      else if (dir === 'north' && Math.abs(wMidZ - b.minZ) < 1.6 && wW >= wD) onEdge = true;
      else if (dir === 'south' && Math.abs(wMidZ - b.maxZ) < 1.6 && wW >= wD) onEdge = true;
      if (!onEdge) continue;
      // Overlap the door's FULL gap (not the shrunken passable strip
      // — we want segments that visually clip the doorway too,
      // including ones whose AABB ends precisely at the gap edge).
      const overlapsGap = horizDoor
        ? (cb.minX < dx + halfDoorGap && cb.maxX > dx - halfDoorGap)
        : (cb.minZ < dz + halfDoorGap && cb.maxZ > dz - halfDoorGap);
      if (!overlapsGap) continue;
      hits.push(o);
    }
    if (hits.length === 0) return;

    // Track the OUTER perpendicular extent of every hidden segment
    // so we can rebuild flanks that span ALL of it. For a single
    // full-edge wall this collapses to that wall's bounds; for a
    // multi-segment shape perimeter this captures the union.
    let unionFrom = Infinity, unionTo = -Infinity;
    let unionAxisMid = null;
    let perpThick = WALL_THICK;
    for (const o of hits) {
      const cb = o.userData.collisionXZ;
      o.userData.collisionXZ = null;
      o.visible = false;
      if (horizDoor) {
        if (cb.minX < unionFrom) unionFrom = cb.minX;
        if (cb.maxX > unionTo)   unionTo = cb.maxX;
        unionAxisMid = (cb.minZ + cb.maxZ) / 2;
        perpThick = cb.maxZ - cb.minZ;
      } else {
        if (cb.minZ < unionFrom) unionFrom = cb.minZ;
        if (cb.maxZ > unionTo)   unionTo = cb.maxZ;
        unionAxisMid = (cb.minX + cb.maxX) / 2;
        perpThick = cb.maxX - cb.minX;
      }
    }

    // Build flanking segments. They cover the union span minus the
    // door gap. A 0.5m extension past each edge reads as the
    // flanking wall butting INTO the door frame rather than ending
    // a half-metre short.
    const FLANK_GROW = 0.5;
    if (horizDoor) {
      const leftTo  = dx - halfDoorGap + FLANK_GROW;
      const rightFrom = dx + halfDoorGap - FLANK_GROW;
      const leftFrom = unionFrom;
      const rightTo  = unionTo;
      if (leftTo > leftFrom + 0.05) {
        const m = this._addObstacle((leftFrom + leftTo) / 2, WALL_HEIGHT / 2, unionAxisMid,
          leftTo - leftFrom, WALL_HEIGHT, perpThick, OUTER_WALL_COLOR);
        if (m) {
          m.userData.kind = m.userData.kind || 'boss-flank';
          m.userData.isBossFlank = true;
        }
      }
      if (rightTo > rightFrom + 0.05) {
        const m = this._addObstacle((rightFrom + rightTo) / 2, WALL_HEIGHT / 2, unionAxisMid,
          rightTo - rightFrom, WALL_HEIGHT, perpThick, OUTER_WALL_COLOR);
        if (m) {
          m.userData.kind = m.userData.kind || 'boss-flank';
          m.userData.isBossFlank = true;
        }
      }
    } else {
      const topTo    = dz - halfDoorGap + FLANK_GROW;
      const botFrom  = dz + halfDoorGap - FLANK_GROW;
      const topFrom  = unionFrom;
      const botTo    = unionTo;
      if (topTo > topFrom + 0.05) {
        const m = this._addObstacle(unionAxisMid, WALL_HEIGHT / 2, (topFrom + topTo) / 2,
          perpThick, WALL_HEIGHT, topTo - topFrom, OUTER_WALL_COLOR);
        if (m) {
          m.userData.kind = m.userData.kind || 'boss-flank';
          m.userData.isBossFlank = true;
        }
      }
      if (botFrom < botTo - 0.05) {
        const m = this._addObstacle(unionAxisMid, WALL_HEIGHT / 2, (botFrom + botTo) / 2,
          perpThick, WALL_HEIGHT, botTo - botFrom, OUTER_WALL_COLOR);
        if (m) {
          m.userData.kind = m.userData.kind || 'boss-flank';
          m.userData.isBossFlank = true;
        }
      }
    }
    this._dirtySolid();
  }

  _clearDoorCorridors() {
    const doors = this.obstacles.filter(o => o.userData.isDoor);
    // Even-wider corridor than before — 1m extra on each side of the door
    // mouth, 3.5m into both rooms. Kills any interior wall / column / cover
    // that could pin a player at the threshold.
    const halfGap = DOOR_WIDTH / 2 + 1.0;
    const depth = 3.5;
    // Pre-stash strip-bounds tests so the decoration sweep below can
    // reuse the same shape checks without duplicating the geometry.
    const _decoStrips = [];
    for (const d of doors) {
      const dx = d.userData.cx, dz = d.userData.cz;
      const geo = d.geometry.parameters;
      const horizDoor = (geo?.width || 0) > (geo?.depth || 0);
      let stripMinX, stripMaxX, stripMinZ, stripMaxZ;
      if (horizDoor) {
        stripMinX = dx - halfGap; stripMaxX = dx + halfGap;
        stripMinZ = dz - depth;   stripMaxZ = dz + depth;
      } else {
        stripMinX = dx - depth;   stripMaxX = dx + depth;
        stripMinZ = dz - halfGap; stripMaxZ = dz + halfGap;
      }
      // Stash this strip so the decoration-prop sweep below can
      // reuse the same bounds.
      _decoStrips.push({ stripMinX, stripMaxX, stripMinZ, stripMaxZ });
      for (const o of this.obstacles) {
        if (o === d || o.userData.isDoor) continue;
        if (o.userData.isBossFlank) continue;     // explicit gameplay walls — see _repairDoorOverlaps
        // Skip every elevator panel — doors AND the three solid walls —
        // so bullets can't shoot through a hidden side wall when the
        // elevator sits inside a door's corridor strip.
        if (o.userData.isElevatorWall) continue;
        const b = o.userData.collisionXZ;
        if (!b) continue;
        if (b.maxX < stripMinX || b.minX > stripMaxX) continue;
        if (b.maxZ < stripMinZ || b.minZ > stripMaxZ) continue;
        // Phase M step 3 — props that landed inside a door corridor
        // (despite the prop-overlap pass + door-clearance band)
        // get unconditionally cleared. Both the proxy collision is
        // nulled AND the visible propGroup is hidden so a stray
        // couch / bookshelf can't straddle a doorway.
        if (o.userData.isProp) {
          o.userData.collisionXZ = null;
          o.visible = false;
          if (o.userData.propGroup) o.userData.propGroup.visible = false;
          continue;
        }
        // Shape-built walls (level_shapes.js _addRectPerimeter) used
        // to be unconditionally cleared. That over-cleared them: a
        // shape room's perimeter builds proper flanking segments
        // around every doorway, and clearing the flanks left gaps
        // the player could slip through (the keycard-door bug).
        // Now shape walls follow the same wallSpansGap rule as
        // rect walls — flanks survive, anything actually straddling
        // the door's passable gap still gets nulled.
        //
        // Extraction-room walls are flanking segments around their
        // own door — they MUST stay collidable, otherwise the
        // player walks straight through the chamber wall instead of
        // through the door panel.
        const isExtractionWall = !!o.userData?.isExtractionWall;
        // Outer walls that sit directly ON the door axis are
        // candidates for preservation — they're typically the
        // flanking segments _buildRoomPerimeter built around the
        // door gap. BUT if the wall's perpendicular extent SPANS
        // the door's full passable gap (e.g. a single full-length
        // outer wall built when the room had no neighbour on that
        // side, like the boss room's wall on the extraction-door
        // side), it's a blocker, not a flanking segment, and it
        // must be cleared. Without this check rect boss rooms
        // ended up with a solid wall behind the open extraction
        // door.
        //
        // Color-based check now accepts BOTH level.js's biome-
        // dynamic OUTER_WALL_COLOR and extraction_room.js's
        // hard-coded 0x1a1e24. Earlier this only matched the level
        // value — chamber flanking walls use the extraction-room
        // constant and were silently cleared, leaving a hole the
        // player could walk around the door through. Tagged
        // isExtractionWall above is the more reliable signal but
        // we keep the colour test for legacy outer-wall flanking.
        const wallColor = o.material?.color?.getHex?.();
        const isOuterColor = wallColor === OUTER_WALL_COLOR
          || wallColor === 0x1a1e24
          || isExtractionWall;
        const onDoorEdge = horizDoor
          ? Math.abs(((b.minZ + b.maxZ) / 2) - dz) < 0.8
          : Math.abs(((b.minX + b.maxX) / 2) - dx) < 0.8;
        const halfDoorGap = DOOR_WIDTH / 2;
        const wallSpansGap = horizDoor
          ? (b.minX <= dx - halfDoorGap + 0.1 && b.maxX >= dx + halfDoorGap - 0.1)
          : (b.minZ <= dz - halfDoorGap + 0.1 && b.maxZ >= dz + halfDoorGap - 0.1);
        if (isOuterColor && onDoorEdge && !wallSpansGap) continue;
        o.userData.collisionXZ = null;
        o.visible = false;
        // Props register an invisible proxy mesh + a linked visible
        // group. When the proxy is cleared, hide the whole group too
        // so a bookshelf / couch doesn't straddle an open doorway.
        if (o.userData.propGroup) o.userData.propGroup.visible = false;
      }
    }
    // Decoration-prop sweep — props with no collision (rugs / lamps /
    // vases / TVs) skipped the obstacle-list registration in
    // _registerProp, so the doors-vs-obstacles loop above never saw
    // them. They sit in `_decorationProps` instead; walk that list
    // against the same strip bounds to hide any that landed in a
    // doorway. Without this pass the player walks through a rug-on-
    // the-threshold and through the no-collision lamp blocking the
    // boss-exit door.
    if (this._decorationProps && this._decorationProps.length && _decoStrips.length) {
      for (const dp of this._decorationProps) {
        if (!dp.group || !dp.group.visible) continue;
        for (const s of _decoStrips) {
          if (dp.maxX < s.stripMinX || dp.minX > s.stripMaxX) continue;
          if (dp.maxZ < s.stripMinZ || dp.minZ > s.stripMaxZ) continue;
          dp.group.visible = false;
          break;
        }
      }
    }
    this._dirtySolid();
  }

  // Defensive repair for "door spawns but a wall is still there".
  // For every door, compute its gap footprint (the passable span, not
  // its full bounds) and null the collision on any obstacle that
  // actively intersects it. Runs at the end of generation after
  // _clearDoorCorridors + _sealRoomPerimeters, so it has the final
  // pictoral state to inspect.
  _repairDoorOverlaps() {
    const doors = this.obstacles.filter(o => o.userData.isDoor);
    for (const d of doors) {
      const g = d.geometry?.parameters;
      const halfW = (g?.width || 4) / 2;
      const halfD = (g?.depth || 1.2) / 2;
      const dx = d.userData.cx, dz = d.userData.cz;
      // Passable gap. Shrink slightly so the flanking walls (which
      // butt against the door's edge) aren't counted as "in the gap".
      const gapMinX = dx - halfW + 0.1;
      const gapMaxX = dx + halfW - 0.1;
      const gapMinZ = dz - halfD + 0.1;
      const gapMaxZ = dz + halfD - 0.1;
      for (const o of this.obstacles) {
        if (o === d || o.userData.isDoor) continue;
        if (o.userData.isElevatorWall) continue;
        // Boss-flank walls are explicit gameplay geometry built by
        // _splitBossWallForExtractionDoor to flank the extraction
        // door. The 0.5m FLANK_GROW makes them visually butt against
        // the door panel — without this skip the repair pass saw the
        // overlap and nulled the flanks. F3 dump confirmed: flanks
        // showing collision:null, visible:false in the boss room
        // pre-reveal, leaving the boss arena open on that side.
        if (o.userData.isBossFlank) continue;
        const b = o.userData.collisionXZ;
        if (!b) continue;   // already non-blocking — nothing to repair
        // Strict AABB intersection with the gap span.
        if (b.maxX <= gapMinX || b.minX >= gapMaxX) continue;
        if (b.maxZ <= gapMinZ || b.minZ >= gapMaxZ) continue;
        // Overlap detected — kill the collision and hide the mesh so
        // the player / bullets / LoS all pass through cleanly.
        o.userData.collisionXZ = null;
        o.visible = false;
        if (o.userData.propGroup) o.userData.propGroup.visible = false;
      }
    }
    this._dirtySolid();
  }

  // BFS every chain room from the start and flag any disconnected room
  // reachable via door linkage. Currently informational — used by main.js
  // debug if the player reports unreachable rooms.
  validateConnectivity() {
    if (!this.rooms.length) return { ok: true, unreachable: [] };
    const startId = this.rooms.findIndex(r => r.type === 'start');
    if (startId < 0) return { ok: true, unreachable: [] };
    const visited = new Set([startId]);
    const q = [startId];
    while (q.length) {
      const id = q.shift();
      const room = this.rooms[id];
      for (const n of room.neighbors) {
        if (!visited.has(n.otherId)) {
          visited.add(n.otherId);
          q.push(n.otherId);
        }
      }
    }
    const unreachable = [];
    for (let i = 0; i < this.rooms.length; i++) {
      if (!visited.has(i)) unreachable.push(this.rooms[i]);
    }
    return { ok: unreachable.length === 0, unreachable };
  }

  // Pass 1A pathway-invariant check. Flood-fills a 0.5m grid from
  // playerSpawn over the union of every room's walkableBounds. Every
  // room's center must be reached, and every doorway gap (one
  // probe-point per neighbor, 1m inward from the wall) must be
  // reached. The result is also stamped on window.__lastInvariantCheck
  // so a dev can read the latest status from the console.
  //
  // This is INFORMATIONAL — it doesn't auto-repair. Smoke harnesses
  // call it; runtime never does.
  checkPathwayInvariants() {
    const failures = [];
    if (!this.rooms.length) return { ok: true, failures };

    const STEP = 0.5;
    // Build a sparse grid of walkable cells. Key = `${ix},${iz}`
    // where ix = round(x / STEP). We iterate every walkableBounds
    // box across every room and stamp its interior cells walkable.
    const walkable = new Set();
    const cellKey = (ix, iz) => ix + ',' + iz;
    for (const room of this.rooms) {
      const wbList = room._walkableBounds;
      if (!wbList || !wbList.length) continue;
      for (const wb of wbList) {
        const ix0 = Math.ceil(wb.minX / STEP);
        const ix1 = Math.floor(wb.maxX / STEP);
        const iz0 = Math.ceil(wb.minZ / STEP);
        const iz1 = Math.floor(wb.maxZ / STEP);
        for (let ix = ix0; ix <= ix1; ix++) {
          for (let iz = iz0; iz <= iz1; iz++) {
            walkable.add(cellKey(ix, iz));
          }
        }
      }
    }
    // Stamp doorway gap regions as walkable so the flood-fill can
    // cross from one room's bounds set into a neighbor's. Without
    // this, two rooms' walkable boxes touch at a wall plane but no
    // grid cell straddles the wall, so BFS can't traverse rooms.
    // Per door, paint a (DOOR_WIDTH+1) wide × (WALL_THICK+2*STEP)
    // deep strip centered on the doorway.
    const halfDoorPad = DOOR_WIDTH / 2 + STEP;
    const wallSpan    = WALL_THICK + STEP * 2;
    const seenDoors = new Set();
    for (const room of this.rooms) {
      if (!room.neighbors) continue;
      const b = room.bounds;
      for (const n of room.neighbors) {
        const other = this.rooms[n.otherId];
        if (!other) continue;
        const k = [Math.min(room.id, n.otherId), Math.max(room.id, n.otherId)].join('-');
        if (seenDoors.has(k)) continue;
        seenDoors.add(k);
        let cxw, czw, dW, dD;
        if (n.dir === 'north' || n.dir === 'south') {
          cxw = other.cx;
          czw = (n.dir === 'north') ? b.minZ : b.maxZ;
          dW = halfDoorPad; dD = wallSpan;
        } else {
          cxw = (n.dir === 'east') ? b.maxX : b.minX;
          czw = other.cz;
          dW = wallSpan; dD = halfDoorPad;
        }
        const ix0 = Math.ceil((cxw - dW) / STEP);
        const ix1 = Math.floor((cxw + dW) / STEP);
        const iz0 = Math.ceil((czw - dD) / STEP);
        const iz1 = Math.floor((czw + dD) / STEP);
        for (let ix = ix0; ix <= ix1; ix++) {
          for (let iz = iz0; iz <= iz1; iz++) {
            walkable.add(cellKey(ix, iz));
          }
        }
      }
    }

    // Seed BFS from the player spawn cell. If the spawn cell isn't in
    // walkable (rare — happens if start room shape orphans the spawn),
    // fall back to start room center. Any failure here is a bug.
    const start = this.playerSpawn;
    let sx = Math.round(start.x / STEP);
    let sz = Math.round(start.z / STEP);
    if (!walkable.has(cellKey(sx, sz))) {
      const startRoom = this.rooms.find(r => r.type === 'start');
      if (startRoom) {
        sx = Math.round(startRoom.cx / STEP);
        sz = Math.round(startRoom.cz / STEP);
      }
    }
    if (!walkable.has(cellKey(sx, sz))) {
      failures.push({ room: -1, reason: 'spawn point is not in any walkableBounds' });
      window.__lastInvariantCheck = { ok: false, failures };
      return { ok: false, failures };
    }

    const visited = new Set([cellKey(sx, sz)]);
    const queue = [[sx, sz]];
    while (queue.length) {
      const [cx, cz] = queue.shift();
      const neighbors = [[1,0], [-1,0], [0,1], [0,-1]];
      for (const [dx, dz] of neighbors) {
        const nx = cx + dx, nz = cz + dz;
        const k = cellKey(nx, nz);
        if (visited.has(k)) continue;
        if (!walkable.has(k)) continue;
        visited.add(k);
        queue.push([nx, nz]);
      }
    }

    // Assert every room center is reached. Synthetic rooms (id < 0,
    // currently the extraction room) are intentionally skipped because
    // the extraction door is locked until boss death.
    //
    // For rooms with shape templates (lShape, rotunda, plaza-with-dais
    // etc.), the geometric center room.cx/cz can fall on an impassable
    // feature (the plaza dais, the rotunda's centerpiece column, the
    // notch carved by lShape) even when the donut around the feature
    // is fully connected to the spawn. Probe a fan of points sampled
    // from the room's _walkableBounds before declaring it unreachable —
    // the conceptual contract is "is there ANY walkable cell of this
    // room reachable from spawn", not "is room.cx/cz specifically
    // reachable".
    for (const room of this.rooms) {
      if (room.id < 0) continue;
      const probes = [[room.cx, room.cz]];
      const wb = room._walkableBounds;
      if (wb && wb.length) {
        for (const box of wb) {
          probes.push([(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2]);
          // Inset corners — avoid landing exactly on the box edge
          // where wall expanded-AABB cells could leave the cell
          // unsampled.
          probes.push([box.minX + 0.6, box.minZ + 0.6]);
          probes.push([box.maxX - 0.6, box.maxZ - 0.6]);
        }
      }
      let reached = false;
      for (const [px, pz] of probes) {
        const ix = Math.round(px / STEP);
        const iz = Math.round(pz / STEP);
        if (visited.has(cellKey(ix, iz))) { reached = true; break; }
      }
      if (!reached) {
        failures.push({ room: room.id, reason: 'center unreachable from spawn' });
      }
    }
    // Assert every doorway probe (1m inward) is reached.
    for (const room of this.rooms) {
      if (room.id < 0 || !room.neighbors) continue;
      const b = room.bounds;
      for (const n of room.neighbors) {
        const other = this.rooms[n.otherId];
        if (!other || other.id < 0) continue;
        let dx, dz;
        if (n.dir === 'north')      { dx = other.cx; dz = b.minZ + 1; }
        else if (n.dir === 'south') { dx = other.cx; dz = b.maxZ - 1; }
        else if (n.dir === 'east')  { dx = b.maxX - 1; dz = other.cz; }
        else                         { dx = b.minX + 1; dz = other.cz; }
        const ix = Math.round(dx / STEP);
        const iz = Math.round(dz / STEP);
        if (!visited.has(cellKey(ix, iz))) {
          failures.push({ room: room.id, reason: `doorway ${n.dir} → ${n.otherId} unreachable` });
        }
      }
    }

    // ----- Flow-field reachability assertion (informational) -----
    // Pass 1 added an AI flow field (src/ai_spatial.js). The path BFS
    // above proves the level has door-graph reachability; the flow
    // field is a denser per-cell direction map that the AI samples
    // every frame. Some rooms are gated by locked doors (boss room,
    // shops, encounters) which the BFS treats as walkable but the
    // flow field treats as blocked because each door's locked-state
    // collisionXZ is non-null at level-gen time. AI never spawns
    // INSIDE a locked room (enemies only spawn in unlocked-by-then
    // chain rooms), so flow-field-unreachable rooms aren't actually
    // a failure for AI behaviour — they get classified as warnings.
    // We surface them on the level for tooling but never fail the
    // invariant gate on them.
    this._flowFieldWarnings = [];
    if (typeof window !== 'undefined' && window.__aiSpatial
        && this.playerSpawn && this.rooms.length > 1) {
      try {
        const aiSpatial = window.__aiSpatial;
        // Rebuild the spatial hash with no entries — we only care
        // about the flow field over the level's static walkability.
        aiSpatial.rebuild(this, {});
        const flow = aiSpatial.flowFieldTo(
          this.playerSpawn.x, this.playerSpawn.z);
        if (flow && flow.cellCount > 0) {
          // Probe every chain-room centre. A room whose centre cell
          // isn't on the field implies the flow field can't route
          // to/from it — locked-door rooms expected to land here.
          for (const room of this.rooms) {
            if (room.id < 0) continue;
            if (!flow.reachable(room.cx, room.cz)) {
              this._flowFieldWarnings.push({ room: room.id,
                reason: 'flow-field unreachable from spawn (likely locked door)' });
            }
          }
        } else {
          this._flowFieldWarnings.push({ room: -2,
            reason: 'flow-field empty (no walkable cells)' });
        }
      } catch (e) {
        // Don't gate the invariant on the AI module — log + continue.
        if (typeof console !== 'undefined') {
          console.warn('[invariants] flow-field check threw:', e);
        }
      }
    }

    const result = { ok: failures.length === 0, failures };
    if (typeof window !== 'undefined') window.__lastInvariantCheck = result;
    return result;
  }

  // HARD walkability gate (Phase M) — flood-fills the same _collidesAt
  // surface the player physics checks at runtime, so any "stuck on
  // level 1" repro is caught at gen-time. Independent of
  // checkPathwayInvariants which only inspects topology / walkableBounds
  // unions; this one tests the actual physics geometry the player will
  // walk on.
  //
  // Doors are treated as virtually open while the flood runs (their
  // collisionXZ is stashed and nulled, then restored). Without this,
  // locked doors would partition the level and report every gated room
  // as unreachable, but those rooms are reachable once unlocked at
  // runtime via the existing room-clear flow.
  //
  // For each room (including connectors + extraction): the flood must
  // reach the room centre OR any sample in a 3×3 grid around the centre
  // (covers cases where a centroid sits in a chamfered corner / on top
  // of a dais).
  //
  // Returns { ok, unreachable: [{id, type, shape}], visitedCells, totalCells }.
  checkRealWalkability() {
    const STEP = 0.5;
    const RAD  = 0.4;        // matches player collision radius @ 0.40m
    if (!this.rooms.length) {
      return { ok: true, unreachable: [], visitedCells: 0, totalCells: 0 };
    }

    // 1. Stash door collisions. Includes both locked + unlocked doors —
    //    locked doors have a non-null collisionXZ that would otherwise
    //    block the flood. The elevator door (`isElevatorDoor`) is the
    //    sealed panel of the start-room elevator box where the player
    //    spawns — at runtime the player taps E to open it, so during
    //    a generation-time walkability probe we MUST pretend it's open
    //    or BFS can't escape the 5.2m elevator interior. Without this
    //    every level fails the gate and ships through the
    //    "degrade-to-rect → accept-broken" branch with all shape
    //    variety stripped and console error 'CRITICAL: walkability
    //    still failing after degrade'.
    const stashed = [];
    for (const o of this.obstacles) {
      if (o.userData?.isDoor || o.userData?.isElevatorDoor) {
        stashed.push({ mesh: o, prev: o.userData.collisionXZ });
        o.userData.collisionXZ = null;
      }
    }

    let unreachable = [];
    let visitedCells = 0;
    let totalCells = 0;
    try {
      // 2. Build an aggregate level bbox covering every room (including
      //    synthetic id < 0 connectors + extraction).
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const r of this.rooms) {
        if (!r.bounds) continue;
        if (r.bounds.minX < minX) minX = r.bounds.minX;
        if (r.bounds.maxX > maxX) maxX = r.bounds.maxX;
        if (r.bounds.minZ < minZ) minZ = r.bounds.minZ;
        if (r.bounds.maxZ > maxZ) maxZ = r.bounds.maxZ;
      }
      if (!isFinite(minX)) {
        return { ok: true, unreachable: [], visitedCells: 0, totalCells: 0 };
      }
      // Pad so doorway corridors at edges fall inside the grid.
      minX -= STEP; maxX += STEP; minZ -= STEP; maxZ += STEP;
      const w = Math.ceil((maxX - minX) / STEP);
      const d = Math.ceil((maxZ - minZ) / STEP);
      totalCells = w * d;
      const idx = (i, j) => i * d + j;
      const visited = new Uint8Array(totalCells);

      // 3. Seed BFS at the player spawn. If the spawn cell itself is
      //    blocked (rare — e.g. spawn lands inside an elevator panel
      //    geometry that's reset later), nudge one cell in the +Z
      //    direction so BFS starts from a walkable seed.
      const sp = this.playerSpawn;
      let si = Math.max(0, Math.min(w - 1, Math.floor((sp.x - minX) / STEP)));
      let sj = Math.max(0, Math.min(d - 1, Math.floor((sp.z - minZ) / STEP)));
      const seedAt = (i, j) => {
        const cx = minX + (i + 0.5) * STEP;
        const cz = minZ + (j + 0.5) * STEP;
        return !this._collidesAt(cx, cz, RAD);
      };
      if (!seedAt(si, sj)) {
        // Try a 5×5 window around the spawn for an open seed.
        let found = false;
        for (let oi = -2; oi <= 2 && !found; oi++) {
          for (let oj = -2; oj <= 2 && !found; oj++) {
            const i = si + oi, j = sj + oj;
            if (i < 0 || i >= w || j < 0 || j >= d) continue;
            if (seedAt(i, j)) { si = i; sj = j; found = true; }
          }
        }
      }

      const queue = [[si, sj]];
      visited[idx(si, sj)] = 1;
      visitedCells = 1;
      while (queue.length) {
        const [i, j] = queue.shift();
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (const [di, dj] of dirs) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || ni >= w || nj < 0 || nj >= d) continue;
          if (visited[idx(ni, nj)]) continue;
          const cx = minX + (ni + 0.5) * STEP;
          const cz = minZ + (nj + 0.5) * STEP;
          if (this._collidesAt(cx, cz, RAD)) continue;
          visited[idx(ni, nj)] = 1;
          visitedCells++;
          queue.push([ni, nj]);
        }
      }

      // 4. Check every room. The room is "reached" iff at least one
      //    cell of the BFS visited set falls inside the room's known
      //    walkable region.
      //
      //    Strategy: enumerate sample points along an inset 3×3 grid
      //    of every walkable bounds box the shape template emitted
      //    (room._walkableBounds). For shapes like plaza-with-dais or
      //    extraction-with-centerprop, room.cx/cz lands on top of
      //    the impassable centerpiece; sampling room.cx alone produces
      //    a false negative even when the donut around the prop is
      //    entirely connected to the BFS frontier. Falling back to
      //    room.bounds (or room center) when no walkableBounds exist
      //    keeps legacy paths working.
      //
      //    Inset by 0.4m so the sample point is at least one player
      //    radius away from the box edge — otherwise a corner sample
      //    can land on a wall expanded-AABB cell that BFS skipped.
      const sampleReached = (room) => {
        const boxes = (room._walkableBounds && room._walkableBounds.length)
          ? room._walkableBounds
          : (room.bounds ? [room.bounds] : []);
        const INSET = 0.6;
        for (const box of boxes) {
          const bw = box.maxX - box.minX;
          const bd = box.maxZ - box.minZ;
          if (bw < INSET * 2 || bd < INSET * 2) {
            // Tiny box — single sample at its center.
            const sx = (box.minX + box.maxX) / 2;
            const sz = (box.minZ + box.maxZ) / 2;
            const ci = Math.floor((sx - minX) / STEP);
            const cj = Math.floor((sz - minZ) / STEP);
            if (ci >= 0 && ci < w && cj >= 0 && cj < d && visited[idx(ci, cj)]) return true;
            continue;
          }
          // 3×3 sample inset from the box edges.
          const xs = [box.minX + INSET, (box.minX + box.maxX) / 2, box.maxX - INSET];
          const zs = [box.minZ + INSET, (box.minZ + box.maxZ) / 2, box.maxZ - INSET];
          for (const sx of xs) {
            for (const sz of zs) {
              const ci = Math.floor((sx - minX) / STEP);
              const cj = Math.floor((sz - minZ) / STEP);
              if (ci < 0 || ci >= w || cj < 0 || cj >= d) continue;
              if (visited[idx(ci, cj)]) return true;
            }
          }
        }
        return false;
      };
      for (const r of this.rooms) {
        if (!r.bounds) continue;
        if (!sampleReached(r)) {
          unreachable.push({ id: r.id, type: r.type, shape: r.shape || 'rect' });
        }
      }

      // 5. Encounter spawns.
      for (const r of this.rooms) {
        const esp = r._encounterSpawn;
        if (!esp) continue;
        const ci = Math.floor((esp.x - minX) / STEP);
        const cj = Math.floor((esp.z - minZ) / STEP);
        let ok = false;
        for (let oi = -1; oi <= 1 && !ok; oi++) {
          for (let oj = -1; oj <= 1 && !ok; oj++) {
            const i = ci + oi, j = cj + oj;
            if (i < 0 || i >= w || j < 0 || j >= d) continue;
            if (visited[idx(i, j)]) ok = true;
          }
        }
        if (!ok) {
          unreachable.push({ id: r.id, type: 'encounter-spawn', shape: r.shape || 'rect' });
        }
      }
    } finally {
      // 6. Restore door collisions.
      for (const s of stashed) s.mesh.userData.collisionXZ = s.prev;
      this._dirtySolid();
    }

    return {
      ok: unreachable.length === 0,
      unreachable,
      visitedCells,
      totalCells,
    };
  }

  // Pass 1C invariants — outdoor / window / connector / ledge sanity.
  // Asserts on top of checkPathwayInvariants():
  //   a) Every room reachable from spawn via DOORS only — windows are
  //      treated as walls. Connectors are reachable via their two ends
  //      (the rewired neighbor edges from buildSkybridge ensure this).
  //   b) Every connector room has exactly two neighbors and both
  //      endpoints reach it through their own neighbor list.
  //   c) For each ledge: at least one mantle-up cell on the inside.
  //   d) skybridge-open connectors have non-empty railing decoration.
  //   e) Building partitions are convex — every chain room of building
  //      X has all its same-building chain neighbors form a contiguous
  //      segment of the chain (no inset L-shapes at the building level).
  runOutdoorInvariants() {
    const failures = [];
    if (!this.rooms || !this.rooms.length) return { ok: true, failures };
    // (a) Every room reachable via doors only — uses the existing
    // pathway invariant. Windows already aren't part of the door set,
    // so checkPathwayInvariants() naturally excludes them.
    const path = this.checkPathwayInvariants();
    if (!path.ok) {
      for (const f of path.failures) failures.push({ kind: 'pathway', ...f });
    }
    // (b) Every connector has 2 neighbors, both endpoints back-link.
    const conns = (this._connectors || []);
    for (const c of conns) {
      if (!c.neighbors || c.neighbors.length !== 2) {
        failures.push({ kind: 'connector', id: c.id, reason: 'wrong neighbor count' });
        continue;
      }
      for (const n of c.neighbors) {
        const other = this.rooms[n.otherId];
        if (!other || !(other.neighbors || []).some(nn => nn.otherId === c.id)) {
          failures.push({ kind: 'connector', id: c.id, reason: `endpoint ${n.otherId} doesn't back-link` });
        }
      }
    }
    // (c) Ledges — each has a defined inside drop-off + the slab
    // exists. We don't check walkability of the inside cell because
    // the ledge is anchored by the wall it hangs on; if the room's
    // walkableBounds covers the inside drop, that's enough.
    const ledges = this.ledges || [];
    for (const lg of ledges) {
      if (!lg.slab || !lg.room) {
        failures.push({ kind: 'ledge', reason: 'missing slab or room ref' });
        continue;
      }
      const b = lg.room.bounds;
      if (lg.insideX < b.minX - 0.5 || lg.insideX > b.maxX + 0.5
          || lg.insideZ < b.minZ - 0.5 || lg.insideZ > b.maxZ + 0.5) {
        failures.push({ kind: 'ledge', reason: 'inside drop outside room', room: lg.room.id });
      }
    }
    // (d) skybridge-open variants need railings — we count level
    // obstacles tagged isRailing whose AABB sits inside the connector
    // bounds. At least 2 expected (one per long side).
    //
    // Note: `_clearDoorCorridors` nulls `collisionXZ` for obstacles
    // that overlap a doorway corridor (lets bullets/players pass).
    // Connector doorways are right at the railing ends, so railings
    // there end up with null collision. Fall back to mesh.position
    // when the AABB is gone — the railing is still THERE visually +
    // for vision-block, the corridor just lets characters through.
    for (const c of conns) {
      if (c.connectorKind !== 'skybridge-open') continue;
      let railCount = 0;
      for (const m of this.obstacles) {
        if (!m.userData?.isRailing) continue;
        const cb = m.userData.collisionXZ;
        let cmx, cmz;
        if (cb) {
          cmx = (cb.minX + cb.maxX) / 2;
          cmz = (cb.minZ + cb.maxZ) / 2;
        } else if (m.position) {
          cmx = m.position.x;
          cmz = m.position.z;
        } else {
          continue;
        }
        if (cmx >= c.bounds.minX - 0.2 && cmx <= c.bounds.maxX + 0.2
            && cmz >= c.bounds.minZ - 0.2 && cmz <= c.bounds.maxZ + 0.2) {
          railCount++;
        }
      }
      if (railCount < 2) {
        failures.push({ kind: 'connector', id: c.id, reason: 'skybridge-open missing railings', count: railCount });
      }
    }
    // (e) Building convexity — for the chain rooms (start..boss in
    // ascending id order), the building tag should change at most
    // ONCE along the chain. If it flips A→B→A we have an inset.
    const chain = this.rooms
      .filter(r => r && r.id >= 0
        && (r.type === 'start' || r.type === 'combat'
            || r.type === 'boss' || r.type === 'encounter'))
      .sort((a, b) => a.id - b.id);
    let flips = 0;
    for (let i = 1; i < chain.length; i++) {
      if (chain[i].building !== chain[i - 1].building) flips++;
    }
    if (flips > 1) {
      failures.push({ kind: 'building-convex', reason: 'chain building tag flips > 1', flips });
    }
    // (f) Wall-proxy raycast smoke check — guards against the regression
    // class that #a45dbbf fixed (proxy.raycast returning a non-Vector3
    // hit.point that crashed downstream .distanceTo() / .clone() callers).
    // Walks 5-10 wall proxies and verifies a through-wall ray returns a
    // real THREE.Vector3 hit.point with sane distance.
    try {
      const rc = this.runRaycastInvariants();
      for (const f of rc.failures) failures.push(f);
    } catch (err) {
      failures.push({ kind: 'raycast', reason: 'runRaycastInvariants threw: ' + (err?.message || err) });
    }
    const result = { ok: failures.length === 0, failures };
    if (typeof window !== 'undefined') window.__lastOutdoorInvariantCheck = result;
    return result;
  }

  // Wall-proxy raycast smoke check. Pass 1C ships a wall_instancer that
  // proxies AABB hits via a custom Mesh.raycast — earlier bug a45dbbf
  // had the proxy returning a stub `{x,y,z}` for hit.point, which
  // crashed the resolveAim / hasLineOfSight callers that immediately
  // call .distanceTo() / .clone() on the point. Existing structural
  // invariants (pathway / outdoor) didn't exercise raycaster.intersect
  // at all, so the regression slipped through.
  //
  // This walks 5-10 wall proxies, fires a ray straight through each,
  // and asserts:
  //   - at least one hit registers (proxy isn't quietly skipped)
  //   - hits[0].point IS a real THREE.Vector3 (isVector3 + distanceTo)
  //   - hits[0].distance is finite, non-negative, ≤ ray length
  // Failures push to `failures` with kind='raycast' + a reason string,
  // matching the rest of runOutdoorInvariants's failure shape.
  runRaycastInvariants() {
    const failures = [];
    if (!this.obstacles || !this.obstacles.length) {
      return { ok: true, failures };
    }
    // Collect wall proxies. Cap at 60 so the smoke check stays cheap
    // even on a 500-wall level.
    //
    // Only VISIBLE proxies are eligible — _clearDoorCorridors flips
    // visible=false on the slabs that overlap a doorway so bullets +
    // bodies pass through them. Their raycast() early-outs on the
    // hidden flag, which would (correctly) return 0 hits and read as
    // a bug here. Filter them out at sample time.
    const proxies = [];
    for (const m of this.obstacles) {
      if (m && m.isWallProxy && m.visible) proxies.push(m);
      if (proxies.length >= 60) break;     // sample pool, picked-down below
    }
    if (proxies.length === 0) {
      // No walls is a legitimate state for the synthetic extraction
      // room or a tutorial. Not a failure.
      return { ok: true, failures };
    }
    // Take up to 10, evenly distributed across the pool so we test a
    // mix of inner / outer / corridor walls.
    const sampleCount = Math.min(10, proxies.length);
    const step = proxies.length / sampleCount;
    const RAY_LEN = 4.0;
    const raycaster = new THREE.Raycaster();
    raycaster.near = 0;
    raycaster.far = RAY_LEN;
    const _hits = [];
    let okCount = 0;
    for (let i = 0; i < sampleCount; i++) {
      const proxy = proxies[Math.floor(i * step)];
      if (!proxy || !proxy.position) continue;
      // Pick the wall's dominant axis (the thinner of _w / _d) and fire
      // a ray straight across it. Origin is offset by RAY_LEN/2 on the
      // chosen axis from one side to the other; the wall sits in the
      // middle so the ray cleanly enters at ~RAY_LEN/2 and exits a bit
      // past the wall thickness.
      const px = proxy.position.x, py = proxy.position.y, pz = proxy.position.z;
      const w = proxy._w || 0.1, d = proxy._d || 0.1;
      let originX, originZ, dirX, dirZ;
      if (w >= d) {
        // Wall runs along X — ray crosses on Z.
        originX = px;
        originZ = pz - RAY_LEN / 2;
        dirX = 0; dirZ = 1;
      } else {
        // Wall runs along Z — ray crosses on X.
        originX = px - RAY_LEN / 2;
        originZ = pz;
        dirX = 1; dirZ = 0;
      }
      raycaster.ray.origin.set(originX, py, originZ);
      raycaster.ray.direction.set(dirX, 0, dirZ);
      _hits.length = 0;
      try {
        proxy.raycast(raycaster, _hits);
      } catch (err) {
        failures.push({ kind: 'raycast', reason: 'proxy.raycast threw: ' + (err?.message || err) });
        continue;
      }
      if (_hits.length === 0) {
        failures.push({ kind: 'raycast', reason: 'wall proxy returned 0 hits for through-ray', kind_: 'proxy' });
        continue;
      }
      const h0 = _hits[0];
      if (!h0 || !h0.point) {
        failures.push({ kind: 'raycast', reason: 'hits[0].point missing' });
        continue;
      }
      // The contract: point MUST be a real THREE.Vector3. Anything else
      // crashes downstream callers (see commit a45dbbf).
      if (h0.point.isVector3 !== true) {
        failures.push({ kind: 'raycast', reason: 'hits[0].point.isVector3 !== true' });
        continue;
      }
      if (typeof h0.point.distanceTo !== 'function') {
        failures.push({ kind: 'raycast', reason: 'hits[0].point.distanceTo not a function' });
        continue;
      }
      if (!(h0.distance >= 0)) {
        failures.push({ kind: 'raycast', reason: 'hits[0].distance < 0 or NaN: ' + h0.distance });
        continue;
      }
      if (h0.distance > RAY_LEN + 1e-3) {
        failures.push({ kind: 'raycast', reason: 'hits[0].distance > ray length: ' + h0.distance });
        continue;
      }
      okCount++;
    }
    const result = { ok: failures.length === 0, failures, sampled: sampleCount, passed: okCount };
    if (typeof window !== 'undefined') window.__lastRaycastInvariantCheck = result;
    return result;
  }

  nearElevatorDoor(pos, radius = 2.4) {
    for (const mesh of this.obstacles) {
      if (!mesh.userData.isElevatorDoor || mesh.userData.unlocked) continue;
      const dx = mesh.userData.cx - pos.x;
      const dz = mesh.userData.cz - pos.z;
      if (dx * dx + dz * dz <= radius * radius) return true;
    }
    return false;
  }

  // Build a small interior "elevator" box in the start room. The box sits
  // against the wall opposite the exit door, so when the door opens the
  // player faces the room's real exit.
  _buildElevator(room) {
    const exitN = room.neighbors[0];
    if (!exitN) return;
    const exitDir = exitN.dir;
    const ELEV = 5.2;                    // interior clearance
    const half = ELEV / 2;
    const b = room.bounds;
    let ex, ez, doorSide = exitDir;
    // Place elevator snug against the wall OPPOSITE the exit direction, so
    // its own door faces the same direction as the exit.
    const backMargin = 0.6;
    if (exitDir === 'east') { ex = b.minX + backMargin + half + WALL_THICK; ez = room.cz; }
    else if (exitDir === 'west') { ex = b.maxX - backMargin - half - WALL_THICK; ez = room.cz; }
    else if (exitDir === 'north') { ex = room.cx; ez = b.maxZ - backMargin - half - WALL_THICK; }
    else { ex = room.cx; ez = b.minZ + backMargin + half + WALL_THICK; }
    room.elevatorCenter = { x: ex, z: ez };

    const addInterior = (x, z, sx, sz, isDoor) => {
      const mesh = this._addObstacle(x, WALL_HEIGHT / 2, z, sx, WALL_HEIGHT, sz,
        isDoor ? DOOR_COLOR : FULL_WALL_COLOR);
      // All four panels carry `isElevatorWall` so the door-corridor sweep
      // can't accidentally hide any of them; the openable one is further
      // tagged with `isElevatorDoor` for the interact + open flow.
      mesh.userData.isElevatorWall = true;
      if (isDoor) {
        mesh.userData.isElevatorDoor = true;
        mesh.userData.cx = x;
        mesh.userData.cz = z;
        // Own-material clone (see _buildDoor for the rationale).
        // _openDoor mutates color/opacity here and we don't want
        // those changes leaking into other doors via shared mat.
        if (mesh.material && typeof mesh.material.clone === 'function') {
          mesh.material = mesh.material.clone();
        }
      }
    };
    // Four walls around the elevator. The one matching `doorSide` becomes
    // the openable panel; the other three are solid interior walls.
    addInterior(ex - half, ez, WALL_THICK, ELEV, doorSide === 'west');
    addInterior(ex + half, ez, WALL_THICK, ELEV, doorSide === 'east');
    addInterior(ex, ez - half, ELEV, WALL_THICK, doorSide === 'north');
    addInterior(ex, ez + half, ELEV, WALL_THICK, doorSide === 'south');
  }

  revealExit() {
    // Idempotent — exit was already revealed. Cheap guard for the
    // double-fire case where main.js calls revealExit on boss death
    // AND from the room-clear hook.
    if (this.exitBounds) return;

    // Primary path — the extraction room exists (boss room had a
    // free wall). Reveal its walls + props + unlock the connecting
    // door via the locked-door pattern. Set this.exitBounds to the
    // room's interior so isPlayerInExit() triggers on walk-in.
    if (this.exitRoom && typeof this.exitRoom.reveal === 'function') {
      this.exitRoom.reveal();
      this.exitBounds = this.exitRoom.exitBounds;
      this._dirtySolid();
      return;
    }

    // Fallback path — extraction-room build failed earlier; drop the
    // legacy ring marker in the boss room. Same code as before the
    // overhaul so any save / level the new builder couldn't handle
    // still gets a working exit.
    if (!this._exitPendingBounds) return;
    const { cx, cz, r } = this._exitPendingBounds;
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.7, r, 24),
      sharedMaterial({
        type: 'basic', color: EXIT_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 2.5, 8),
      sharedMaterial({ type: 'basic', color: EXIT_COLOR, transparent: true, opacity: 0.55 }),
    );
    pillar.position.y = 1.25;
    group.add(pillar);
    group.position.set(cx, 0, cz);
    this.scene.add(group);
    this.exitGroup = group;
    this.exitBounds = { cx, cz, r };
    ring.userData.kind = 'exit-ring-legacy';
    pillar.userData.kind = 'exit-pillar-legacy';
    this.decorations.push(ring, pillar);
  }

  isPlayerInExit(playerPos) {
    if (!this.exitBounds) return false;
    const dx = playerPos.x - this.exitBounds.cx;
    const dz = playerPos.z - this.exitBounds.cz;
    return dx * dx + dz * dz < this.exitBounds.r * this.exitBounds.r;
  }

  // Single open arena for the milestone mega-boss floors. Replaces
  // the normal random-walk generator. Called by main.js when
  // `isMegaBossLevel(level.index + 1)` would be true at the next
  // generate(). Bumps level.index like the regular generator and
  // produces a 30×30m square room with a single virtual room entry
  // so roomAt() / vision blockers / lighting still work. No enemy
  // spawns, no doors, no encounters — main.js handles boss spawn
  // separately.
  generateMegaArena() {
    this.clear();
    this.index += 1;
    this.theme = getLevelTheme(this.index);
    if (this.theme) {
      FULL_WALL_COLOR  = this.theme.wall;
      OUTER_WALL_COLOR = _darkenHex(this.theme.wall, 0.55);
      LOW_COVER_COLOR  = _darkenHex(this.theme.wall, 0.30);
      if (this.ground && this.ground.material && this.ground.material.color) {
        this.ground.material.color.setHex(this.theme.floor);
      }
    }
    const HALF = 15;     // arena is 30m × 30m
    const W = HALF * 2 + WALL_THICK * 2;
    // Perimeter walls — four boxes thick enough that bullets stop here.
    this._addObstacle(0, WALL_HEIGHT / 2, -HALF - WALL_THICK / 2, W, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
    this._addObstacle(0, WALL_HEIGHT / 2,  HALF + WALL_THICK / 2, W, WALL_HEIGHT, WALL_THICK, OUTER_WALL_COLOR);
    this._addObstacle(-HALF - WALL_THICK / 2, WALL_HEIGHT / 2, 0, WALL_THICK, WALL_HEIGHT, HALF * 2, OUTER_WALL_COLOR);
    this._addObstacle( HALF + WALL_THICK / 2, WALL_HEIGHT / 2, 0, WALL_THICK, WALL_HEIGHT, HALF * 2, OUTER_WALL_COLOR);
    // Player spawns near the south-west corner; boss center is the
    // arena origin, so the player has a clear line to dash into.
    this.playerSpawn.set(-HALF + 4, 0, -HALF + 4);
    this.megaArenaCenter = new THREE.Vector3(0, 0, 0);
    // Stage the exit zone — main.js calls revealExit() when the boss
    // dies. Place it near the opposite corner so the player has to
    // cross the arena to leave (visible reward beat).
    this._exitPendingBounds = { cx: HALF - 4, cz: HALF - 4, r: 1.6 };
    // Single virtual room covering the whole arena — keeps roomAt()
    // happy for any per-frame system that walks rooms.
    this.rooms = [{
      id: 0,
      type: 'megaArena',
      layout: 'megaArena',
      bounds: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF },
      cx: 0, cz: 0,
      cellX: 0, cellZ: 0,
      neighbors: [],
      cleared: false,
      entered: true,
      hasElevator: false,
    }];
    this._dirtySolid();
  }

  roomAt(x, z) {
    for (const r of this.rooms) {
      const b = r.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return r;
    }
    return null;
  }

  // Toggle per-room SpotLights based on player proximity. Rooms past
  // the cull radius set .visible = false on their lamp + ceiling
  // fixture so the renderer drops them from the active lights[]
  // array. Cull radius 28m keeps the player's room (18×18) plus one
  // ring of cardinal neighbours (centres 18-19m apart) lit. Cheap to
  // call every frame — N rooms × one distance check each.
  updateRoomLightCulling(playerX, playerZ, cullRadius = 28) {
    if (!this._roomLamps || this._roomLamps.length === 0) return;
    const r2 = cullRadius * cullRadius;
    for (let i = 0; i < this._roomLamps.length; i++) {
      const L = this._roomLamps[i];
      const dx = L.cx - playerX, dz = L.cz - playerZ;
      const inRange = (dx * dx + dz * dz) <= r2;
      if (L.light.visible !== inRange) {
        L.light.visible = inRange;
        if (L.fixture) L.fixture.visible = inRange;
      }
    }
  }

  // End-of-generate sweep — push every decoration that isn't already
  // tracked by the cullable set into it. Lights + light targets are
  // skipped (their visibility is owned by `_roomLamps` + the per-frame
  // light-cull sweep, which uses a 28m radius vs the 35m here). Wires
  // ceiling-lamp fixtures, window groups, encounter visuals into the
  // proximity-cull pipeline so the renderer skips far-room decorations
  // entirely instead of paying the per-mesh frustum + matrixWorld
  // walks every frame.
  _registerDecorationsAsCullable() {
    if (!this._cullableProps) this._cullableProps = [];
    // O(N) lookup of already-registered objects — cullable arrays
    // hold the .obj reference, so a Set of those is sufficient. The
    // typical level has 80-150 decorations + 200+ cullable props
    // already, so the constant cost is irrelevant.
    const seen = new Set(this._cullableProps.map(p => p.obj));
    for (const m of this.decorations) {
      if (!m) continue;
      if (m.isLight) continue;          // owned by _roomLamps cull
      // light.target is an Object3D, not a Light. Skip explicitly.
      if (m.userData && m.userData.kind === 'ceiling-lamp-target') continue;
      if (seen.has(m)) continue;
      const wp = m.position
        ? { x: m.position.x, z: m.position.z }
        : { x: 0, z: 0 };
      this._cullableProps.push({ obj: m, x: wp.x, z: wp.z });
    }
  }

  // Toggle prop group visibility based on player proximity. Props
  // past the cull radius go invisible — the renderer skips their
  // per-mesh frustum cull + matrixWorld walks. Bullets still hit them
  // because raycasts iterate level.obstacles, not the scene graph.
  // Use a slightly larger radius than light culling (35m vs 28m) so
  // props on the edge of the visible camera frustum don't pop in/out
  // when the player turns. Cheap — N props × one squared-distance
  // check + one boolean compare per frame.
  updateDecorationCulling(playerX, playerZ, cullRadius = 35) {
    if (!this._cullableProps || this._cullableProps.length === 0) return;
    const r2 = cullRadius * cullRadius;
    for (let i = 0; i < this._cullableProps.length; i++) {
      const p = this._cullableProps[i];
      const dx = p.x - playerX, dz = p.z - playerZ;
      const inRange = (dx * dx + dz * dz) <= r2;
      if (p.obj.visible !== inRange) p.obj.visible = inRange;
    }
  }

  resolveCollision(oldX, oldZ, newX, newZ, radius) {
    let x = newX, z = oldZ;
    if (this._collidesAt(x, z, radius)) x = oldX;
    let nz = newZ;
    if (this._collidesAt(x, nz, radius)) nz = oldZ;
    return { x, z: nz };
  }

  // Detect an entity already inside an obstacle's collision bounds and
  // push it to the nearest free edge. Needed because `resolveCollision`
  // can only bisect motion — once an entity's position is already inside
  // (e.g. spawn edge case, stuck at a door), it has no way to recover.
  // Returns the corrected {x, z}; if no overlap, returns the input.
  unstickFrom(x, z, radius) {
    for (const o of this.obstacles) {
      const b = o.userData.collisionXZ;
      if (!b) continue;
      const insideX = x > b.minX - radius && x < b.maxX + radius;
      const insideZ = z > b.minZ - radius && z < b.maxZ + radius;
      if (!(insideX && insideZ)) continue;

      // Distances to each expanded-bbox face. The smallest is the
      // shortest escape direction.
      const dLeft  = x - (b.minX - radius);
      const dRight = (b.maxX + radius) - x;
      const dBack  = z - (b.minZ - radius);
      const dFront = (b.maxZ + radius) - z;
      const minD = Math.min(dLeft, dRight, dBack, dFront);
      const eps = 0.02;
      if (minD === dLeft)        x = b.minX - radius - eps;
      else if (minD === dRight)  x = b.maxX + radius + eps;
      else if (minD === dBack)   z = b.minZ - radius - eps;
      else                        z = b.maxZ + radius + eps;
      // Intentionally only handle one obstacle per call — after pushing
      // out we may have moved into another, but the next frame's call
      // will catch that. Avoids infinite loops on overlapping geometry.
    }
    return { x, z };
  }

  // Walkability check — steps along a straight line from (ax,az) to
  // (bx,bz) and reports true if every sample point is clear of obstacles.
  // Used at enemy spawn time to veto positions behind interior walls.
  _segmentClear(ax, az, bx, bz, radius = 0.6) {
    const dx = bx - ax, dz = bz - az;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return !this._collidesAt(ax, az, radius);
    const steps = Math.max(2, Math.ceil(dist / 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = ax + dx * t;
      const z = az + dz * t;
      if (this._collidesAt(x, z, radius)) return false;
    }
    return true;
  }

  _collidesAt(x, z, radius) {
    // Spatial-hash fast path. Profiling showed ~200k _collidesAt
    // calls per generate at level 15-20; the linear scan of ~400
    // obstacles ate ~900ms per gen on L20. The grid query reduces
    // this to bucket-size (~5-15 obstacles per cell) per call.
    if (this._collidesDirty || !this._collidesGrid) {
      if (!this._collidesGrid) this._collidesGrid = new StaticObstacleGrid2D(5);
      // Filter to obstacles with non-null collisionXZ ahead of the
      // rebuild — _clearDoorCorridors / _repairDoorOverlaps null
      // collisionXZ on cleared walls and we don't want them in the
      // grid AT ALL (otherwise lookups still scan over them).
      const arr = [];
      for (let i = 0; i < this.obstacles.length; i++) {
        const o = this.obstacles[i];
        if (o.userData.collisionXZ) arr.push(o);
      }
      this._collidesGrid.rebuild(arr, (o) => o.userData.collisionXZ);
      this._collidesDirty = false;
    }
    const out = this._collidesScratch;
    this._collidesGrid.queryAabb(
      x - radius, x + radius, z - radius, z + radius, out,
    );
    for (let i = 0; i < out.length; i++) {
      const b = out[i].userData.collisionXZ;
      // Belt-and-braces — collisionXZ may have been nulled after the
      // grid rebuild but before this query.
      if (!b) continue;
      if (x > b.minX - radius && x < b.maxX + radius
       && z > b.minZ - radius && z < b.maxZ + radius) return true;
    }
    return false;
  }

  // Whisker-based steering. Caller passes their position, the heading
  // they WANT to move along (unit vector), their collision radius, and
  // a look-ahead distance. We probe a fan of candidate directions and
  // return the closest-to-desired one whose look-ahead point is open.
  // If everything is blocked, hand back the original heading and let
  // the caller's stuck-deflection take over.
  //
  // Cheap — each probe is one _collidesAt call (O(walls)). At 30 NPCs
  // calling this every other frame, the cost is sub-ms on a level
  // with ~120 obstacles. Run BEFORE the move, not after, so the AI
  // never tries to walk into a prop in the first place.
  steerAround(x, z, dirX, dirZ, radius, lookAhead) {
    if (!dirX && !dirZ) return { x: dirX, z: dirZ };
    const ax = x + dirX * lookAhead;
    const az = z + dirZ * lookAhead;
    if (!this._collidesAt(ax, az, radius)) return { x: dirX, z: dirZ };
    // Blocked along the desired heading. Try whiskers at ±30°, ±60°,
    // ±75°, ±90°, ±105°, ±120° — denser fan than the original
    // ±30/±60/±90 set so the search has finer-grained options when an
    // enemy is brushing a door corner. Without the in-between angles
    // (75 / 105 / 120), a 0.42m enemy collision circle threading a
    // doorway whose flanking walls extend perpendicular to its
    // approach can have all six original whiskers blocked
    // simultaneously — leading to the axis-clamp deadlock the user
    // reported. (User 2026-05-06: "enemies are getting stuck on the
    // corners of doors trying to get to the player.")
    //
    // Two-pass: try full lookAhead first; if every probe is blocked,
    // retry at half lookAhead. Tight gaps where the full look-ahead
    // overshoots into wall geometry resolve at the shorter probe.
    const angles = [
      Math.PI / 6, -Math.PI / 6,
      Math.PI / 3, -Math.PI / 3,
      Math.PI * (5 / 12), -Math.PI * (5 / 12),     // ±75°
      Math.PI / 2, -Math.PI / 2,
      Math.PI * (7 / 12), -Math.PI * (7 / 12),     // ±105°
      Math.PI * (2 / 3), -Math.PI * (2 / 3),       // ±120°
    ];
    for (const probeLen of [lookAhead, lookAhead * 0.5]) {
      for (const a of angles) {
        const c = Math.cos(a), s = Math.sin(a);
        const nx = dirX * c - dirZ * s;
        const nz = dirX * s + dirZ * c;
        const wx = x + nx * probeLen;
        const wz = z + nz * probeLen;
        if (!this._collidesAt(wx, wz, radius)) return { x: nx, z: nz };
      }
    }
    return { x: dirX, z: dirZ };
  }

  // Find a cover spot near `pos` that hides from `threatPos`. Iterates
  // every obstacle within `maxR` of the seeker; the candidate point is
  // the obstacle's centre projected one obstacle-radius PAST the prop
  // along the line away from the threat. Returns the closest such
  // point with a clear LoS-vs-threat (i.e., the prop blocks). Used by
  // gunmen during reload + suppression.
  //
  // Cost-tight: per-prop work is one walkability check (`_collidesAt`,
  // O(walls), early-outs on first hit) plus a constant-time "does the
  // threat→spot line cross the prop's AABB" test. Earlier version
  // called `_segmentClear` against every obstacle for every prop and
  // burned ~150k AABB tests per call on a late-game level — that
  // showed up as a per-shot hitch when reloading gunmen kept polling
  // for a new spot.
  findCoverNear(pos, threatPos, maxR) {
    let best = null, bestD = Infinity;
    const px = pos.x, pz = pos.z;
    const tx = threatPos.x, tz = threatPos.z;
    const maxR2 = maxR * maxR;
    for (const o of this.obstacles) {
      const b = o.userData.collisionXZ;
      if (!b) continue;
      // Skip doors + walls; we only want low/medium props as cover.
      if (o.userData.isDoor) continue;
      if (!o.userData.isProp) continue;
      const cx = (b.minX + b.maxX) * 0.5;
      const cz = (b.minZ + b.maxZ) * 0.5;
      const halfX = (b.maxX - b.minX) * 0.5;
      const halfZ = (b.maxZ - b.minZ) * 0.5;
      // Reject tiny props (rugs) and giant ones (full-width bookshelves
      // crammed up against a wall) — they're either non-cover or the
      // far-side spot would be inside the wall.
      const propR = Math.max(halfX, halfZ);
      if (propR < 0.4 || propR > 1.4) continue;
      const dxp = cx - px, dzp = cz - pz;
      const d2 = dxp * dxp + dzp * dzp;
      if (d2 > maxR2) continue;
      // Vector from threat to prop = which side is the safe side.
      const fx = cx - tx, fz = cz - tz;
      const fl = Math.hypot(fx, fz);
      if (fl < 0.001) continue;
      const sx = cx + (fx / fl) * (propR + 0.4);
      const sz = cz + (fz / fl) * (propR + 0.4);
      // Spot must be walkable.
      if (this._collidesAt(sx, sz, 0.45)) continue;
      // Cheap LoS check: the threat→spot segment must cross THIS prop's
      // AABB. If it does, the prop is between threat and spot by
      // construction — no need to scan every other obstacle.
      if (!_segmentIntersectsAABB(tx, tz, sx, sz, b)) continue;
      const d = Math.sqrt(d2);
      if (d < bestD) { bestD = d; best = { x: sx, z: sz }; }
    }
    return best;
  }

  // Level-gen invariants probe — exposed as a method so the playwright
  // probe (and any future smoke runner) can call it post-generate to
  // validate the level isn't broken in subtle ways. Returns
  // `{ ok, failures }` where `failures` is an array of human-readable
  // strings; `ok` is true iff every check passed.
  //
  // Manual run (from the dev console while a level is loaded):
  //
  //   const r = window.__level.runInvariants();
  //   console.log(r.ok ? 'PASS' : 'FAIL', r.failures);
  //
  // Smoke harness wiring is deferred to a follow-up — for now the
  // probe runs this in-process via `window.__level.runInvariants()`.
  runInvariants(opts = {}) {
    const failures = [];
    const includeExit = !!opts.afterBossClear;

    // 1. Flood-fill from playerSpawn over a 0.5m grid using the
    //    cached solid-obstacles set.
    const cell = 0.5;
    // Aggregate bounds — every chain room PLUS the extraction room
    // when we're checking after-boss-clear.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of this.rooms) {
      if (!r.bounds) continue;
      if (r.id < 0 && !includeExit) continue;
      if (r.bounds.minX < minX) minX = r.bounds.minX;
      if (r.bounds.maxX > maxX) maxX = r.bounds.maxX;
      if (r.bounds.minZ < minZ) minZ = r.bounds.minZ;
      if (r.bounds.maxZ > maxZ) maxZ = r.bounds.maxZ;
    }
    if (!isFinite(minX)) {
      failures.push('no-room-bounds');
      return { ok: false, failures };
    }
    // Pad the box so doorway corridors at the edges are inside the
    // walkable area.
    minX -= cell; maxX += cell; minZ -= cell; maxZ += cell;
    const w = Math.ceil((maxX - minX) / cell);
    const d = Math.ceil((maxZ - minZ) / cell);
    const idx = (i, j) => i * d + j;
    const visited = new Uint8Array(w * d);

    // Helper — true when the cell at (i, j) is walkable. Treats
    // doors with collisionXZ == null (unlocked) as open. Honors
    // includeExit by virtually unlocking the extraction door.
    const exitDoor = this.exitRoom?.doorMesh;
    const _walkable = (cx, cz) => {
      // Use _collidesAt with a small radius so the flood-fill
      // probes the same body width as a player.
      const rad = 0.30;
      // Special-case the extraction door: when checking after-boss-
      // clear, treat it as open even if collisionXZ is still set.
      if (includeExit && exitDoor) {
        const b = exitDoor.userData.collisionXZ;
        if (b && cx > b.minX - rad && cx < b.maxX + rad
             && cz > b.minZ - rad && cz < b.maxZ + rad) {
          // Same overlap test the door mesh would otherwise reject —
          // we let it through here.
          // Need to verify that NO OTHER obstacle blocks this cell.
          for (const o of this.obstacles) {
            if (o === exitDoor) continue;
            const ob = o.userData.collisionXZ;
            if (!ob) continue;
            if (cx > ob.minX - rad && cx < ob.maxX + rad
             && cz > ob.minZ - rad && cz < ob.maxZ + rad) return false;
          }
          return true;
        }
      }
      return !this._collidesAt(cx, cz, rad);
    };

    // BFS from the player spawn cell.
    const sp = this.playerSpawn;
    const si = Math.max(0, Math.min(w - 1, Math.floor((sp.x - minX) / cell)));
    const sj = Math.max(0, Math.min(d - 1, Math.floor((sp.z - minZ) / cell)));
    const queue = [[si, sj]];
    visited[idx(si, sj)] = 1;
    while (queue.length) {
      const [i, j] = queue.shift();
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [di, dj] of dirs) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || ni >= w || nj < 0 || nj >= d) continue;
        if (visited[idx(ni, nj)]) continue;
        const cx = minX + (ni + 0.5) * cell;
        const cz = minZ + (nj + 0.5) * cell;
        if (!_walkable(cx, cz)) continue;
        visited[idx(ni, nj)] = 1;
        queue.push([ni, nj]);
      }
    }
    const cellReached = (cx, cz) => {
      const ci = Math.floor((cx - minX) / cell);
      const cj = Math.floor((cz - minZ) / cell);
      if (ci < 0 || ci >= w || cj < 0 || cj >= d) return false;
      // Search a 3×3 neighborhood — the floor-fill probe lands on
      // cell centres, but a room centroid can fall on a cell edge so
      // an exact lookup mis-fires by half a cell. Looking 1 cell out
      // gives ~0.7m tolerance, well below room size.
      for (let oi = -1; oi <= 1; oi++) {
        for (let oj = -1; oj <= 1; oj++) {
          const i = ci + oi, j = cj + oj;
          if (i < 0 || i >= w || j < 0 || j >= d) continue;
          if (visited[idx(i, j)]) return true;
        }
      }
      return false;
    };

    // 2. Every room centroid is reachable.
    for (const r of this.rooms) {
      if (r.id < 0 && !includeExit) continue;
      if (!r.bounds) continue;
      if (!cellReached(r.cx, r.cz)) {
        failures.push(`room ${r.id} (${r.type}) centroid unreachable`);
      }
    }

    // 3. Every encounter spawn reachable.
    for (const r of this.rooms) {
      const sp = r._encounterSpawn;
      if (!sp) continue;
      if (!cellReached(sp.x, sp.z)) {
        failures.push(`room ${r.id} encounter spawn unreachable`);
      }
    }

    // 4. Extraction-room interior reachable AFTER boss clear (toggled
    //    via opts.afterBossClear).
    if (includeExit && this.exitRoom) {
      const er = this.exitRoom.room;
      if (er && er.bounds) {
        if (!cellReached(er.cx, er.cz)) {
          failures.push('extraction room unreachable after boss clear');
        }
      }
    }

    // 5. Every obstacle + decoration has userData.kind.
    for (const o of this.obstacles) {
      // Walls placed via _addObstacle don't get a kind by default —
      // they're outer-perimeter / interior-wall meshes. Allow walls
      // through; only require kind on PROPS.
      if (o.userData.isProp && !o.userData.kind) {
        failures.push(`prop obstacle missing userData.kind at (${o.position.x.toFixed(1)},${o.position.z.toFixed(1)})`);
      }
    }
    for (const dec of this.decorations) {
      if (dec && !dec.userData?.kind) {
        // Lights / targets don't always have geometry — still require
        // kind so the harness can categorize them.
        failures.push(`decoration missing userData.kind (type=${dec.type || 'unknown'})`);
      }
    }

    // 6. Combat / subBoss rooms have ≥ 3 substantive props.
    const SUBSTANTIVE = new Set([
      'desk', 'table', 'couch', 'bed', 'bookshelf', 'cabinet',
      'locker', 'crate', 'chair', 'nightstand', 'tv', 'coffeeTable',
    ]);
    const _propsInRoom = (room) => {
      const b = room.bounds;
      if (!b) return [];
      const out = [];
      for (const o of this.obstacles) {
        if (!o.userData?.isProp) continue;
        const k = o.userData.kind;
        if (!k || !SUBSTANTIVE.has(k)) continue;
        const px = o.position.x, pz = o.position.z;
        if (px >= b.minX && px <= b.maxX && pz >= b.minZ && pz <= b.maxZ) {
          out.push(o);
        }
      }
      return out;
    };
    for (const r of this.rooms) {
      if (r.type !== 'combat' && r.type !== 'subBoss') continue;
      const props = _propsInRoom(r);
      if (props.length < 3) {
        failures.push(`room ${r.id} (${r.type}, theme=${r.theme || 'none'}) has ${props.length} substantive props (< 3)`);
      }
    }

    return { ok: failures.length === 0, failures };
  }
}

// 2D segment-vs-AABB clip (Liang-Barsky-lite). Returns true if the
// segment from (ax,az) to (bx,bz) intersects the axis-aligned box `b`
// (minX/maxX/minZ/maxZ). Constant-time, no allocs.
function _segmentIntersectsAABB(ax, az, bx, bz, b) {
  let tMin = 0, tMax = 1;
  const dx = bx - ax, dz = bz - az;
  // X slab.
  if (Math.abs(dx) < 1e-6) {
    if (ax < b.minX || ax > b.maxX) return false;
  } else {
    let t1 = (b.minX - ax) / dx;
    let t2 = (b.maxX - ax) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  // Z slab.
  if (Math.abs(dz) < 1e-6) {
    if (az < b.minZ || az > b.maxZ) return false;
  } else {
    let t1 = (b.minZ - az) / dz;
    let t2 = (b.maxZ - az) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}
