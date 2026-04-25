import * as THREE from 'three';
import { tunables } from './tunables.js';
import { buildProp } from './props.js';
import { buildRig, initAnim, updateAnim } from './actor_rig.js';
import { makeContainer, pickContainerType, pickContainerSize, buildContainerMesh } from './containers.js';

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

const FULL_WALL_COLOR = 0x2a2e38;
const LOW_COVER_COLOR = 0x3a3a34;
const OUTER_WALL_COLOR = 0x1a1e24;
const DOOR_COLOR = 0x8a3a2a;
const DOOR_OPEN_COLOR = 0x3a5a3a;
const EXIT_COLOR = 0x00ff88;

const ROOM_W = 18;
const ROOM_H = 18;
const WALL_THICK = 1.2;
const WALL_HEIGHT = 3.0;
const DOOR_WIDTH = 4;

export class Level {
  constructor(scene) {
    this.scene = scene;
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
    this.index = 0;
    this.bossRoomId = -1;
    // Registered ambient light sources (ceiling lamps, prop lamps,
    // emergency flares) used by lightLevelAt() to evaluate how lit a
    // point is. Stealth math reads from this each frame.
    this.lights = [];
  }

  clear() {
    for (const m of this.obstacles) {
      this.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    for (const m of this.decorations) {
      this.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) m.material.dispose();
    }
    for (const npc of this.npcs) this.scene.remove(npc.group);
    for (const c of this.containers) this.scene.remove(c.group);
    this.obstacles = [];
    this.decorations = [];
    this.npcs = [];
    this.containers = [];
    if (this.exitGroup) {
      this.scene.remove(this.exitGroup);
      this.exitGroup = null;
    }
    this.rooms = [];
    this.enemySpawns = [];
    this.lights = [];
    this.exitBounds = null;
    this.bossRoomId = -1;
  }

  generate() {
    this.clear();
    this.index += 1;
    // Tutorial mode override — build the practice room layout
    // instead of random-walking a normal chain.
    if (typeof window !== 'undefined' && window.__tutorialMode && window.__tutorialMode()) {
      return this.generateTutorial();
    }

    // --- Layout: random-walk chain so each level bends differently --------
    // Combat-room count grows with level — L1 picks 2-4, L5 picks 4-6,
    // L10+ picks 6-8 (capped). Each combat room is ~30 walls + props
    // post-build, so even L10 layouts come in under ~250 walls + ~80
    // doors. Comfortable on integrated GPUs.
    const lvIdx = Math.max(1, this.index || 1);
    const minCombat = 2 + Math.min(4, Math.floor((lvIdx - 1) / 2));
    const maxCombat = 4 + Math.min(4, Math.floor((lvIdx - 1) / 2));
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
        // Combat layout pool. Each landing probability targets ~5-12%
        // so the rotation past ~40 rooms still feels varied. The new
        // entries (alcove / center-pit / zigzag) all use _blocksDoor
        // checks during _buildInterior so they never sever a room
        // from its neighbours.
        const r = Math.random();
        if      (r < 0.08) layout = 'columns-4';
        else if (r < 0.13) layout = 'columns-6';
        else if (r < 0.18) layout = 'columns-cross';
        else if (r < 0.27) layout = 'split';
        else if (r < 0.40) layout = 'hallway';
        else if (r < 0.51) layout = 'lshape';
        else if (r < 0.60) layout = 'partition';
        else if (r < 0.68) layout = 'closet';
        else if (r < 0.75) layout = 'bunker';
        else if (r < 0.82) layout = 'pillars-grid';
        else if (r < 0.88) layout = 'alcove';
        else if (r < 0.94) layout = 'center-pit';
        else if (r < 0.98) layout = 'zigzag';
        // else remains 'open'
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
      // as long halls instead of giant squares.
      if (Math.random() < 0.5) room.layout = 'corridor';
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
    if (Math.random() < 0.70) addBranch('merchant');
    if (Math.random() < 0.50) addBranch('healer');
    // Specialty scatter rooms — each independently rolled so players see
    // different shop lineups between runs.
    if (Math.random() < 0.35) addBranch('gunsmith');
    if (Math.random() < 0.30) addBranch('armorer');
    if (Math.random() < 0.25) addBranch('tailor');
    if (Math.random() < 0.18) addBranch('relicSeller');
    if (Math.random() < 0.12) addBranch('blackMarket');
    // Rare bear merchant branch — 25% per level.
    if (Math.random() < 0.25) addBranch('bearMerchant');

    this.rooms = rooms;
    this.bossRoomId = rooms.find(r => r.type === 'boss').id;

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

    // Interior variants (split walls, narrowing hallways) go up before the
    // cover scatter so that cover can avoid placing inside interior walls.
    for (const room of rooms) {
      if (room.layout === 'split' || room.layout === 'hallway' || room.layout === 'lshape'
          || room.layout === 'corridor' || room.layout === 'partition'
          || room.layout === 'closet'  || room.layout === 'bunker'
          || room.layout === 'pillars-grid'
          || room.layout === 'alcove'   || room.layout === 'center-pit'
          || room.layout === 'zigzag'   || room.layout === 'boss-arena'
          || room.layout === 'boss-pillars' || room.layout === 'boss-perch') {
        this._buildInterior(room);
      }
      if (room.layout === 'columns-4') this._decorateColumns(room, '4-corner');
      else if (room.layout === 'columns-6') this._decorateColumns(room, '6-line');
      else if (room.layout === 'columns-cross') this._decorateColumns(room, 'cross');
      if (room.hasElevator) this._buildElevator(room);
    }

    // Scatter some cover inside non-start rooms for tactical play.
    for (const room of rooms) {
      if (room.type === 'start') continue;
      this._scatterCover(room);
    }

    // Lootable containers — boxes / chests scattered through combat
    // and boss rooms. Density scales with room area; types and sizes
    // are rolled per spawn slot. Body drops were trimmed in this same
    // pass, so containers carry the bulk of the loot now.
    for (const room of rooms) {
      if (room.type === 'start') continue;
      this._scatterContainers(room);
    }

    // Themed props — pick a theme per combat-tier room (library, lobby,
    // bedroom, living room, warehouse) and drop matching furniture on
    // top of the cover pass. Added BEFORE clear-door-corridors so any
    // prop that lands in a doorway strip gets its collision nulled.
    for (const room of rooms) {
      if (room.type === 'combat' || room.type === 'subBoss' || room.type === 'boss') {
        this._themeRoom(room);
      }
    }

    // Ambient lighting pass — every themed / combat room gets a
    // ceiling lamp roughly at its centre. Adds both a visible mesh
    // (small recessed spot) and a registered entry in this.lights
    // that the stealth math reads from.
    for (const room of rooms) {
      if (room.type === 'start') continue;
      this._addCeilingLamp(room);
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
    const rs = this.rooms;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
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
    const conn = this.validateConnectivity();
    if (!conn.ok && conn.unreachable.length) {
      console.warn('[level] unreachable rooms:', conn.unreachable.map(r => r.id),
        '— this is a generator bug, not bad luck');
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
    const boss = rooms[this.bossRoomId];
    this._exitPendingBounds = { cx: boss.cx, cz: boss.cz, r: 2.2 };

    // Default unlock policy — every regular door is open from the
    // start of the level; player freedom of movement trumps the old
    // "clear to unlock" gating. A small set of doors (1-2 usually,
    // rarely 3-4 on high-difficulty levels) get key-gated instead —
    // see _assignKeycards below. The assigned doors stay locked with
    // a coloured tint until the player interacts with them holding
    // a matching key token.
    for (const mesh of this.obstacles) {
      if (mesh.userData.isDoor) this._openDoor(mesh);
    }
    this._assignKeycards();
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

    // Candidate doors — ONLY shop / service rooms so the critical
    // path can never be gated behind a key. Sub-boss doors are
    // explicitly excluded because key holders are sub-bosses
    // themselves; gating a sub-boss behind a key risks a softlock
    // if that sub-boss is the one holding the key you'd need.
    const shopTypes = new Set(['merchant', 'healer', 'gunsmith', 'armorer',
      'tailor', 'relicSeller', 'blackMarket', 'bearMerchant']);
    const keyable = this.obstacles.filter((o) => {
      if (!o.userData.isDoor) return false;
      const [aId, bId] = o.userData.connects;
      const a = rooms[aId], b = rooms[bId];
      return (shopTypes.has(a.type) || shopTypes.has(b.type))
          && a.type !== 'boss' && b.type !== 'boss'
          && a.type !== 'subBoss' && b.type !== 'subBoss';
    });
    if (keyable.length === 0) return;

    // Sub-boss list — these mobs drop the key tokens when they die.
    // Key holders are assigned in main.js buildBodyLoot; we just
    // stamp the colour(s) onto level.keycardHolders here so the
    // spawn + loot code can read it.
    const poolColors = COLORS.slice().sort(() => Math.random() - 0.5);
    this.keycardDoors = {};            // color → door mesh
    this.keycardColors = [];           // ordered list for this level
    const picked = new Set();
    for (let i = 0; i < nKeys && keyable.length; i++) {
      const idx = Math.floor(Math.random() * keyable.length);
      const door = keyable.splice(idx, 1)[0];
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
      door.scale.y = 1.0;
      door.position.y = WALL_HEIGHT / 2;
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
    mesh.scale.y = 0.08;
    mesh.position.y = 0.04;
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
  _buildRoomPerimeter(room) {
    const b = room.bounds;
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
      const cx2 = cx - 6, cz2 = cz + 4;
      const group = buildContainerMesh(container, cx2, 0, cz2);
      this.scene.add(group);
      const { w, h, d } = container.geo;
      const proxy = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
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
    // Single dummy enemy spawn so the fire / melee / reload steps
    // have a target. Marked low-aggression via opts the spawner
    // honours; passive AI tuning happens in main.js when these
    // spawn slots are consumed.
    this.enemySpawns = [{
      x: cx + 4, z: cz + 5, roomId: 0, tier: 'normal',
      tutorialDummy: true,
    }];
    // Drop a ceiling lamp so the room is visibly lit — without this
    // the tutorial reads as a dark void since the procedural lamp
    // pass only runs for room.type !== 'start'.
    this._addCeilingLamp(room);
    return;
  }

  _scatterCover(room) {
    const b = room.bounds;
    // Reduced spawn count (was 2-4). Themed props already provide
    // most of the cover a room needs; piling low-cover blocks on top
    // made rooms feel cluttered and overlapped with furniture.
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = b.minX + 3 + Math.random() * (b.maxX - b.minX - 6);
        const z = b.minZ + 3 + Math.random() * (b.maxZ - b.minZ - 6);
        const w = 1 + Math.random() * 1.5;
        const d = 0.8 + Math.random() * 1.2;
        // Larger collision radius during placement rejects overlap
        // with any nearby prop/cover by ~2m margin, not 1.2.
        if (this._collidesAt(x, z, 2.0)) continue;
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
    // Per-room roll: most rooms get nothing.
    const spawnChance = room.type === 'boss' ? 0.55
      : room.type === 'subBoss' ? 0.45
      : 0.30;
    if (Math.random() > spawnChance) return;
    // When a box does spawn, almost always exactly one. Big rooms +
    // boss/sub-boss tier occasionally roll a second.
    let count = 1;
    if (area > 60 && Math.random() < 0.20) count += 1;
    if ((room.type === 'boss' || room.type === 'subBoss') && Math.random() < 0.20) count += 1;
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = b.minX + 3 + Math.random() * (b.maxX - b.minX - 6);
        const z = b.minZ + 3 + Math.random() * (b.maxZ - b.minZ - 6);
        // Use the same proxy-radius logic as low cover so containers
        // don't pile onto each other or onto a piece of themed
        // furniture. Slightly tighter radius than cover since a box
        // is smaller than a couch.
        if (this._collidesAt(x, z, 1.6)) continue;
        const type = pickContainerType();
        const size = pickContainerSize(type);
        const container = makeContainer(type, size, this.index);
        const group = buildContainerMesh(container, x, 0, z);
        this.scene.add(group);
        // Collision proxy — invisible AABB matching the lid footprint
        // so player + enemies path around the container.
        const { w, d } = container.geo;
        const proxy = new THREE.Mesh(
          new THREE.BoxGeometry(w, container.geo.h, d),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
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
      if (c.container.looted) continue;
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

    // Theme pool selection — small rooms get cozier themes, big rooms
    // get warehouse/library. `boss` rooms favour warehouse or lobby for
    // a dramatic silhouette.
    let themes;
    if (room.type === 'boss') themes = ['warehouse', 'lobby', 'office'];
    else if (area < 30) themes = ['bedroom', 'lobby', 'kitchen'];
    else if (area < 60) themes = ['bedroom', 'livingRoom', 'lobby', 'library', 'office', 'kitchen'];
    else themes = ['warehouse', 'library', 'lobby', 'office'];
    const theme = themes[Math.floor(Math.random() * themes.length)];
    room.theme = theme;

    // Helpers — `placeAlongWall` hugs an outer wall; `placeInterior`
    // picks a random interior point that doesn't already collide.
    const EDGE_CLEAR = 1.4;
    const INTERIOR_CLEAR = 2.2;
    const elev = room.elevatorCenter;

    const tooCloseToElev = (x, z) => {
      if (!elev) return false;
      const dx = x - elev.x, dz = z - elev.z;
      return dx * dx + dz * dz < 4 * 4;  // 4m exclusion around elevator
    };

    // True when a prop's full footprint fits inside the room's bbox
    // — accounts for axis-aligned vs rotated yaw via the same
    // square-bound rule _registerProp uses for collision proxies.
    // Without this guard, low-EDGE_CLEAR placements with wide props
    // (bookshelves, couches) could push their visible mesh past
    // a room's outer wall and read as floating in the void.
    const _propFitsInBounds = (prop, x, z, yaw) => {
      const col = prop.collision;
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
      const PAD = 0.05;        // tight margin so the proxy never kisses the wall
      return (x - w / 2) >= b.minX + PAD && (x + w / 2) <= b.maxX - PAD
          && (z - d / 2) >= b.minZ + PAD && (z + d / 2) <= b.maxZ - PAD;
    };

    const placeAlongWall = (prop, opts = {}) => {
      const yaw = opts.yaw;       // if provided, override rotation
      const col = prop.collision;
      const radius = col ? Math.max(col.w, col.d) * 0.7 + 0.6 : 1.2;
      for (let tries = 0; tries < 25; tries++) {
        const side = Math.floor(Math.random() * 4);
        const t = 0.15 + Math.random() * 0.7;
        let x, z, facing;
        if (side === 0)      { x = b.minX + t * roomW; z = b.minZ + EDGE_CLEAR; facing = 0; }
        else if (side === 1) { x = b.maxX - EDGE_CLEAR; z = b.minZ + t * roomD; facing = -Math.PI / 2; }
        else if (side === 2) { x = b.minX + t * roomW; z = b.maxZ - EDGE_CLEAR; facing = Math.PI; }
        else                 { x = b.minX + EDGE_CLEAR; z = b.minZ + t * roomD; facing = Math.PI / 2; }
        if (tooCloseToElev(x, z)) continue;
        if (this._collidesAt(x, z, radius)) continue;
        const finalYaw = yaw ?? facing;
        if (!_propFitsInBounds(prop, x, z, finalYaw)) continue;
        prop.group.position.set(x, 0, z);
        prop.group.rotation.y = finalYaw;
        return this._registerProp(prop);
      }
      return false;
    };

    const placeInterior = (prop) => {
      const col = prop.collision;
      const radius = col ? Math.max(col.w, col.d) * 0.7 + 0.6 : 1.2;
      for (let tries = 0; tries < 25; tries++) {
        const x = b.minX + INTERIOR_CLEAR + Math.random() * (roomW - INTERIOR_CLEAR * 2);
        const z = b.minZ + INTERIOR_CLEAR + Math.random() * (roomD - INTERIOR_CLEAR * 2);
        if (tooCloseToElev(x, z)) continue;
        if (this._collidesAt(x, z, radius)) continue;
        const yaw = (Math.floor(Math.random() * 4)) * Math.PI / 2;
        if (!_propFitsInBounds(prop, x, z, yaw)) continue;
        prop.group.position.set(x, 0, z);
        prop.group.rotation.y = yaw;
        return this._registerProp(prop);
      }
      return false;
    };

    // Per-theme placement scripts. Prop counts intentionally lean low
    // so rooms read as "a space with character" rather than a
    // furniture showroom that chokes every sight-line.
    // Prop counts intentionally low — the rooms were reading as
    // "furniture showroom" with 6-8 pieces overlapping each other.
    // A handful of signature pieces per theme is enough to sell the
    // space; the AI, combat, and scatter cover fill the rest.
    if (theme === 'library') {
      const shelves = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < shelves; i++) placeAlongWall(buildProp('bookshelf'));
      if (Math.random() < 0.7) placeInterior(buildProp('desk'));
      if (Math.random() < 0.5) placeInterior(buildProp('chair'));
    } else if (theme === 'lobby') {
      placeAlongWall(buildProp('couch'));
      if (Math.random() < 0.6) placeInterior(buildProp('coffeeTable'));
      if (Math.random() < 0.4) placeAlongWall(buildProp('desk'));
    } else if (theme === 'bedroom') {
      placeAlongWall(buildProp('bed'));
      if (Math.random() < 0.6) placeAlongWall(buildProp('nightstand'));
    } else if (theme === 'livingRoom') {
      placeAlongWall(buildProp('couch'));
      if (Math.random() < 0.7) placeInterior(buildProp('coffeeTable'));
      if (Math.random() < 0.7) placeAlongWall(buildProp('tv'));
    } else if (theme === 'warehouse') {
      const crates = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < crates; i++) placeInterior(buildProp('crate'));
      if (Math.random() < 0.6) placeInterior(buildProp('barrel'));
      if (Math.random() < 0.5) placeInterior(buildProp('pallet'));
    } else if (theme === 'office') {
      // Cubicle / admin floor — desks against the walls, a chair or
      // two, a filing cabinet for vertical clutter. Keeps the space
      // walkable but gives the eye structured furniture rather than
      // bare floor.
      placeAlongWall(buildProp('desk'));
      if (Math.random() < 0.6) placeAlongWall(buildProp('desk'));
      if (Math.random() < 0.7) placeInterior(buildProp('chair'));
      if (Math.random() < 0.5) placeAlongWall(buildProp('cabinet'));
      if (Math.random() < 0.4) placeInterior(buildProp('lamp'));
    } else if (theme === 'kitchen') {
      // Break room / mess — a central table with chairs, a cabinet
      // along the wall. Reads as "people eat here" without needing a
      // dedicated kitchen prop set.
      placeInterior(buildProp('table'));
      if (Math.random() < 0.7) placeInterior(buildProp('chair'));
      if (Math.random() < 0.5) placeInterior(buildProp('chair'));
      if (Math.random() < 0.6) placeAlongWall(buildProp('cabinet'));
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
  // Drop a simple ceiling lamp in the room — a thin disc for the
  // fixture plus a warm PointLight and a registered light source for
  // the stealth system. Placed near room centre and offset a bit
  // away from the elevator so the first lamp never overlaps the
  // spawn capsule.
  _addCeilingLamp(room) {
    const b = room.bounds;
    let cx = (b.minX + b.maxX) * 0.5;
    let cz = (b.minZ + b.maxZ) * 0.5;
    if (room.elevatorCenter) {
      // Nudge lamp to a quadrant away from the elevator.
      cx += (cx - room.elevatorCenter.x) * 0.2;
      cz += (cz - room.elevatorCenter.z) * 0.2;
    }
    // Spotlight pointing straight down gives a much stronger "pool
    // of light under the lamp / dark corners" read than a point light.
    // Point lights decay spherically so the entire room gets a fairly
    // uniform wash; a downward cone leaves the corners in proper
    // shadow and lets the player see where it's safe to hide.
    const light = new THREE.SpotLight(0xffcf80, 6.0, 14.0, Math.PI * 0.33, 0.6, 1.2);
    light.position.set(cx, WALL_HEIGHT - 0.2, cz);
    light.target.position.set(cx, 0, cz);
    light.castShadow = false;
    this.scene.add(light);
    this.scene.add(light.target);
    this.decorations.push(light);
    this.decorations.push(light.target);
    // Stealth sampling keeps the old radial model — good enough for
    // gameplay detection math even though the visual is a cone.
    this.lights.push({ x: cx, z: cz, radius: 8.0, intensity: 1.8 });
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
    if (!prop.collision) return true;

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
    const proxyMat = new THREE.MeshBasicMaterial({
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
    this.scene.add(proxy);
    this.obstacles.push(proxy);
    return true;
  }

  // Tall column — full-height cylinder treated as obstacle for collision and
  // LoS. Used by the symmetric "columns" decorator.
  _addColumn(x, z, radius) {
    const geom = new THREE.CylinderGeometry(radius, radius, WALL_HEIGHT, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e3240, roughness: 0.7, metalness: 0.1 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(x, WALL_HEIGHT / 2, z);
    mesh.castShadow = false;     // see _addObstacle — walls don't cast
    mesh.receiveShadow = true;
    // Approximate the round column with a square AABB (0.9× radius) so the
    // existing collision system (axis-aligned boxes) still treats it as
    // solid without feeling square when the player hugs it.
    const s = radius * 0.9;
    mesh.userData.collisionXZ = { minX: x - s, maxX: x + s, minZ: z - s, maxZ: z + s };
    this.obstacles.push(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  // Symmetric column decorations. `style` picks the pattern. Columns never
  // block the doorway corridors because they sit ≥2m from the walls.
  _decorateColumns(room, style) {
    const b = room.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const place = (x, z, r) => {
      if (this._blocksDoor(room, x, z)) return;
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
      // Horizontal wall from center→edge on the corner's X side.
      const hx = (centerX + (pick.xSign > 0 ? b.maxX : b.minX)) / 2;
      this._addObstacle(hx, WALL_HEIGHT / 2, centerZ, halfW, WALL_HEIGHT, WALL_THICK, FULL_WALL_COLOR);
      // Vertical wall from center→edge on the corner's Z side.
      const vz = (centerZ + (pick.zSign > 0 ? b.maxZ : b.minZ)) / 2;
      this._addObstacle(centerX, WALL_HEIGHT / 2, vz, WALL_THICK, WALL_HEIGHT, halfD, FULL_WALL_COLOR);
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
      // through. Centres skipped if too close to a doorway approach.
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
          this._addObstacle(x, WALL_HEIGHT / 2, z, 0.6, WALL_HEIGHT, 0.6, FULL_WALL_COLOR);
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
      // ring around the room centre, with corner gaps so players /
      // AI can flow through. Reads as a "courtyard" cover formation.
      const halfW = (b.maxX - b.minX) * 0.18;
      const halfD = (b.maxZ - b.minZ) * 0.18;
      const segLen = halfW * 1.4;
      const segDepth = halfD * 1.4;
      const placeWall = (x, z, w, d) => {
        if (this._blocksDoor(room, x, z, 1.4)) return;
        this._addObstacle(x, WALL_HEIGHT / 2, z, w, WALL_HEIGHT, d, FULL_WALL_COLOR);
      };
      placeWall(cx, cz - halfD, segLen, WALL_THICK);
      placeWall(cx, cz + halfD, segLen, WALL_THICK);
      placeWall(cx - halfW, cz, WALL_THICK, segDepth);
      placeWall(cx + halfW, cz, WALL_THICK, segDepth);
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
        const mat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.7, metalness: 0.1 });
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
        const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a34, roughness: 0.85 });
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
    if (['merchant', 'healer', 'gunsmith', 'armorer', 'tailor',
         'relicSeller', 'blackMarket'].includes(room.type)) {
      this._spawnNPC(room);
      return;
    }
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
    // Exclusion radius around the elevator — otherwise every elevator
    // room tends to spawn mobs crowding the entrance. Only applies inside
    // the actual elevator room (start or boss, whichever the level uses).
    const EXCLUSION_R = 5.5;
    const elevC = room.elevatorCenter;
    const pickOpen = (margin = 2) => {
      for (let attempt = 0; attempt < 120; attempt++) {
        const x = b.minX + margin + Math.random() * (b.maxX - b.minX - 2 * margin);
        const z = b.minZ + margin + Math.random() * (b.maxZ - b.minZ - 2 * margin);
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
      return Math.random() < shieldChance ? 'shieldBearer' : 'standard';
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
      const meleesN = meleeBase + meleeBonus + meleeLevelExtra;
      const gunmanChance = lv <= 1 ? 0.35 : lv <= 3 ? 0.65 : 0.85;
      const baseGunmen = Math.random() < gunmanChance
        ? (lv >= 4 && Math.random() < 0.25 ? 2 : 1)
        : 0;
      const gunmenLevelExtra = Math.min(2, Math.floor(Math.max(0, lv - 5) / 4));
      const gunmenN = baseGunmen + gunmenLevelExtra;
      for (let i = 0; i < meleesN; i++) {
        const p = pickOpen();
        this.enemySpawns.push({
          x: p.x, z: p.z, kind: 'melee', tier: 'normal', roomId: room.id,
          variant: pickMeleeVariant(),
        });
      }
      for (let i = 0; i < gunmenN; i++) {
        const p = pickOpen();
        this.enemySpawns.push({
          x: p.x, z: p.z, kind: 'gunman', tier: 'normal', roomId: room.id,
          variant: pickGunmanVariant(),
        });
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
      // Nine archetypes now — the original six plus three new
      // pressure-bosses: droneSummoner (suicide-drone wave control),
      // spawner (teleport + add-spawn), berserker (HP-driven phase
      // tank). Roughly equal-ish distribution.
      const bossArchetype = archRoll < 0.12 ? 'evasive'
                          : archRoll < 0.24 ? 'bulletHell'
                          : archRoll < 0.36 ? 'elite'
                          : archRoll < 0.48 ? 'assassin'
                          : archRoll < 0.60 ? 'flamer'
                          : archRoll < 0.72 ? 'grenadier'
                          : archRoll < 0.82 ? 'droneSummoner'
                          : archRoll < 0.91 ? 'spawner'
                          :                   'berserker';
      const archVariant =
        bossArchetype === 'bulletHell'    ? 'tank'
      : bossArchetype === 'assassin'      ? 'standard'    // melee variant slot
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
      const bossKind = (bossArchetype === 'assassin' || bossArchetype === 'berserker') ? 'melee' : 'gunman';
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
    const counterMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, roughness: 0.85 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 1.0), counterMat);
    counter.position.set(0, 0.4, 0.7);
    counter.castShadow = true;
    counter.receiveShadow = true;
    group.add(counter);

    const panelMat = new THREE.MeshStandardMaterial({ color: 0x24221a, roughness: 0.9 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.1), panelMat);
    panel.position.set(0, 1.5, -0.6);
    panel.castShadow = true;
    group.add(panel);

    // Sign on the back panel (a glowing colored rectangle).
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.45, 0.04),
      new THREE.MeshBasicMaterial({ color: accent }),
    );
    sign.position.set(0, 1.8, -0.54);
    group.add(sign);

    // Display items on the counter — three floating tiny cubes tinted per
    // merchant type.
    style.displays.forEach((c, i) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.24, 0.24),
        new THREE.MeshBasicMaterial({ color: c }),
      );
      m.position.set(-0.7 + i * 0.7, 0.96, 0.7);
      group.add(m);
    });

    // Ambient glow from the sign.
    const light = new THREE.PointLight(accent, 0.7, 6);
    light.position.set(0, 1.8, -0.3);
    group.add(light);

    // Pick a placement slot: pressed against a random wall so shops don't
    // always sit in the exact centre of the room. The kiosk's +Z is its
    // back, so we rotate the group so the back faces the chosen wall.
    const b = room.bounds;
    const spots = [
      { x: b.minX + 2.2, z: (b.minZ + b.maxZ) / 2, rot: Math.PI / 2 },  // west wall, face east
      { x: b.maxX - 2.2, z: (b.minZ + b.maxZ) / 2, rot: -Math.PI / 2 }, // east wall, face west
      { x: (b.minX + b.maxX) / 2, z: b.minZ + 2.2, rot: 0 },            // north wall, face south
      { x: (b.minX + b.maxX) / 2, z: b.maxZ - 2.2, rot: Math.PI },      // south wall, face north
      { x: room.cx, z: room.cz, rot: Math.random() * Math.PI * 2 },     // classic center
    ];
    const spot = spots[Math.floor(Math.random() * spots.length)];
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = spot.rot;
    this.scene.add(group);
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
      const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
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
    const mat = new THREE.MeshBasicMaterial({ color: 0xb8b4a8 });
    const accent = new THREE.MeshBasicMaterial({ color: 0xa89878 });
    const dark = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });

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
    const catchMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const catchGeom = new THREE.SphereGeometry(0.06, 8, 6);
    const catchL = new THREE.Mesh(catchGeom, catchMat);
    catchL.position.set(-0.50, 3.93, 1.72);
    group.add(catchL);
    const catchR = new THREE.Mesh(catchGeom, catchMat);
    catchR.position.set(0.60, 3.93, 1.72);
    group.add(catchR);
    // Cheek blush — small warm-tan circles for the mascot warmth.
    const blushMat = new THREE.MeshBasicMaterial({ color: 0xd09080, transparent: true, opacity: 0.55 });
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
      new THREE.MeshBasicMaterial({ color: 0xa89878, transparent: true, opacity: 0.06 }),
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
      new THREE.MeshBasicMaterial({ color: 0xd0b07a }),
    );
    halo.position.y = 5.4;
    halo.rotation.x = Math.PI / 2;
    group.add(halo);

    group.position.set(room.cx, 0, room.cz);
    this.scene.add(group);
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
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
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
    return out;
  }
  // Mark the solid-obstacles cache stale. Cheap; no work until the
  // next solidObstacles() call.
  _dirtySolid() { this._solidDirty = true; this._visionDirty = true; }

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
      if (!mesh.userData.connects.includes(roomId)) continue;
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
        for (let s = side.from + HALF_STEP; s < side.to; s += STEP) {
          const x = side.fixed === 'x' ? side.fxv : s;
          const z = side.fixed === 'z' ? side.fxv : s;
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

  _clearDoorCorridors() {
    const doors = this.obstacles.filter(o => o.userData.isDoor);
    // Even-wider corridor than before — 1m extra on each side of the door
    // mouth, 3.5m into both rooms. Kills any interior wall / column / cover
    // that could pin a player at the threshold.
    const halfGap = DOOR_WIDTH / 2 + 1.0;
    const depth = 3.5;
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
      for (const o of this.obstacles) {
        if (o === d || o.userData.isDoor) continue;
        // Skip every elevator panel — doors AND the three solid walls —
        // so bullets can't shoot through a hidden side wall when the
        // elevator sits inside a door's corridor strip.
        if (o.userData.isElevatorWall) continue;
        const b = o.userData.collisionXZ;
        if (!b) continue;
        if (b.maxX < stripMinX || b.minX > stripMaxX) continue;
        if (b.maxZ < stripMinZ || b.minZ > stripMaxZ) continue;
        // Only outer walls that sit directly ON the door axis (the walls
        // that produced the gap) are preserved; outer walls further into
        // the room that happen to share the color still get cleared.
        const isOuterColor = o.material?.color?.getHex?.() === OUTER_WALL_COLOR;
        const onDoorEdge = horizDoor
          ? Math.abs(((b.minZ + b.maxZ) / 2) - dz) < 0.8
          : Math.abs(((b.minX + b.maxX) / 2) - dx) < 0.8;
        if (isOuterColor && onDoorEdge) continue;
        o.userData.collisionXZ = null;
        o.visible = false;
        // Props register an invisible proxy mesh + a linked visible
        // group. When the proxy is cleared, hide the whole group too
        // so a bookshelf / couch doesn't straddle an open doorway.
        if (o.userData.propGroup) o.userData.propGroup.visible = false;
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
    if (this.exitGroup || !this._exitPendingBounds) return;
    const { cx, cz, r } = this._exitPendingBounds;
    const group = new THREE.Group();
    // Exit visual is emissive-only — no PointLight. Adding a live
    // point light here triggered a per-material shader recompile
    // (lighting uniform changed) for every nearby surface, which
    // showed up as a noticeable hitch the moment the boss died.
    // Bloom on the bright unlit material in postfx gives us the
    // glow effect without the lighting-pipeline cost. Ring segment
    // count dropped 40 → 24, still reads round at iso distance.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.7, r, 24),
      new THREE.MeshBasicMaterial({
        color: EXIT_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 2.5, 8),
      new THREE.MeshBasicMaterial({ color: EXIT_COLOR, transparent: true, opacity: 0.55 }),
    );
    pillar.position.y = 1.25;
    group.add(pillar);
    group.position.set(cx, 0, cz);
    this.scene.add(group);
    this.exitGroup = group;
    this.exitBounds = { cx, cz, r };
    this.decorations.push(ring, pillar);
  }

  isPlayerInExit(playerPos) {
    if (!this.exitBounds) return false;
    const dx = playerPos.x - this.exitBounds.cx;
    const dz = playerPos.z - this.exitBounds.cz;
    return dx * dx + dz * dz < this.exitBounds.r * this.exitBounds.r;
  }

  roomAt(x, z) {
    for (const r of this.rooms) {
      const b = r.bounds;
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return r;
    }
    return null;
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
    for (const o of this.obstacles) {
      const b = o.userData.collisionXZ;
      if (!b) continue;
      if (x > b.minX - radius && x < b.maxX + radius
       && z > b.minZ - radius && z < b.maxZ + radius) return true;
    }
    return false;
  }
}
