import * as THREE from 'three';
import { createScene } from './scene.js';
import { createPostFx } from './postfx.js';
import { createLosMask } from './los_mask.js';
import { createPlayer } from './player.js';
import { Input } from './input.js';
import { Combat } from './combat.js';
import { DummyManager } from './enemy.js';
import { GunmanManager } from './gunman.js';
import { MeleeEnemyManager } from './melee_enemy.js';
import { separateEnemies } from './ai_separation.js';
import { LootManager } from './loot.js';
import { Level } from './level.js';
import { ProjectileManager } from './projectiles.js';
import { spawnDamageNumber } from './hud.js';
import { initDebugPanel, setDebugPanelVisible } from './debug.js';
import { getDevToolsEnabled, setDevToolsEnabled, getPlayerName, setPlayerName,
         getStartingStoreState, setStartingStoreState,
         getCharacterStyle, setCharacterStyle,
         getPouchSlots, setPouchSlots, pouchNextSlotCost, POUCH_SLOT_MAX } from './prefs.js';
import { tunables } from './tunables.js';
import {
  Inventory, SLOT_IDS,
  ALL_GEAR, ALL_ARMOR, ALL_CONSUMABLES, CONSUMABLE_DEFS, ALL_JUNK, ALL_TOYS, ARMOR_DEFS,
  wrapWeapon, withAffixes, randomArmor, randomGear, randomConsumable, randomJunk, randomToy,
  randomThrowable,
} from './inventory.js';
import { ALL_ATTACHMENTS, ATTACHMENT_DEFS, effectiveWeapon, randomAttachment } from './attachments.js';
import { CustomizeUI } from './ui_customize.js';
import { LootUI } from './ui_loot.js';
import { ShopUI, priceFor } from './ui_shop.js';
import { PerkUI } from './ui_perks.js';
import { InventoryUI } from './ui_inventory.js';
import { SkillLoadout, BASE_STATS } from './skills.js';
import { SkillPickUI } from './ui_skills.js';
import { SpecialPerkLoadout, BuffState, SPECIAL_PERKS, GEAR_PERKS } from './perks.js';
import { ClassMastery, CLASS_DEFS, CLASS_THRESHOLDS } from './classes.js';
import { SkillTreeLoadout, makeMasteryOffers, SKILL_NODES } from './skill_tree.js';
import { ArtifactCollection, ARTIFACT_DEFS, ALL_ARTIFACTS, artifactScrollFor } from './artifacts.js';
import { MasteryPickUI } from './ui_mastery.js';
import { sfx, attachUnlock, getMasterVolume, setMasterVolume } from './audio.js';
import { GameMenuUI } from './ui_menu.js';
import { StartUI } from './ui_start.js';
import { MainMenuUI } from './ui_main_menu.js';
import { StoreUpgradeUI, StoreRollUI, rollRarityForTier } from './ui_starting_store.js';
import { getQualityPref, setQualityPref, applyQuality, qualityFlags } from './quality.js';
import { DetailsUI } from './ui_details.js';
import { STATUS_ICONS } from './inventory.js';
import { thumbnailFor } from './item_thumbnails.js';
import { RunStats, Leaderboard } from './leaderboard.js';

const appEl = document.getElementById('app');
const hudStatsEl = document.getElementById('hud-stats');

// --- keycard HUD + transient toast -----------------------------------
// Created programmatically so we don't need to touch index.html for
// the new UI. Rebuilt each frame to reflect playerKeys.
const keyHudEl = (() => {
  const el = document.createElement('div');
  el.id = 'keycard-hud';
  Object.assign(el.style, {
    position: 'fixed', top: '14px', right: '14px', zIndex: 50,
    display: 'flex', gap: '6px', pointerEvents: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '10px', color: '#fff',
  });
  document.body.appendChild(el);
  return el;
})();
const toastEl = (() => {
  const el = document.createElement('div');
  el.id = 'hud-toast';
  Object.assign(el.style, {
    position: 'fixed', top: '64px', left: '50%', transform: 'translateX(-50%)',
    zIndex: 50, pointerEvents: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '13px', fontWeight: '700',
    color: '#f2e7c9', textShadow: '0 0 8px rgba(0,0,0,0.9)',
    letterSpacing: '1.5px', padding: '6px 16px',
    background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(201,168,122,0.5)',
    borderRadius: '3px', opacity: '0', transition: 'opacity 0.25s',
  });
  document.body.appendChild(el);
  return el;
})();
let toastFadeT = 0;
function transientHudMsg(msg, duration = 1.5) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  toastFadeT = duration;
}

// Red hurt-flash overlay — full-screen tint that pops when the
// player takes a heavy hit (melee, explosion), then fades in ~250ms.
// Kept subtle: peaks at 35% opacity so it colours the scene without
// occluding it.
const hurtFlashEl = (() => {
  const el = document.createElement('div');
  el.id = 'hurt-flash';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: 48, pointerEvents: 'none',
    background: 'radial-gradient(circle at center, rgba(190,30,40,0) 40%, rgba(190,30,40,0.55) 100%)',
    opacity: '0', transition: 'opacity 0.25s ease-out',
  });
  document.body.appendChild(el);
  return el;
})();
function pulseHurtFlash(intensity = 0.35) {
  hurtFlashEl.style.transition = 'opacity 0.03s';
  hurtFlashEl.style.opacity = String(Math.min(0.9, intensity));
  // Schedule fade on next frame so the transition runs.
  requestAnimationFrame(() => {
    hurtFlashEl.style.transition = 'opacity 0.28s ease-out';
    hurtFlashEl.style.opacity = '0';
  });
}

// --- major-boss HP bar ---------------------------------------------
// One bar at the top-center of the screen; populated each frame with
// whichever major boss is currently alive in the player's room.
const bossBarRoot = (() => {
  const root = document.createElement('div');
  root.id = 'boss-bar';
  Object.assign(root.style, {
    position: 'fixed', top: '14px', left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 45, pointerEvents: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    letterSpacing: '2.5px', textAlign: 'center',
    display: 'none',
  });
  const name = document.createElement('div');
  name.id = 'boss-bar-name';
  Object.assign(name.style, {
    color: '#c9a87a', fontSize: '12px', fontWeight: '700',
    textTransform: 'uppercase',
    textShadow: '0 0 6px rgba(0,0,0,0.9)',
    marginBottom: '4px',
  });
  const fill = document.createElement('div');
  fill.id = 'boss-bar-fill';
  Object.assign(fill.style, {
    width: '0%', height: '100%',
    background: 'linear-gradient(90deg, #7a1f1f, #d23030)',
    transition: 'width 0.15s',
  });
  const track = document.createElement('div');
  Object.assign(track.style, {
    width: '520px', height: '20px',
    background: 'rgba(20,10,10,0.88)',
    border: '2px solid rgba(201,168,122,0.65)',
    borderRadius: '3px',
    overflow: 'hidden',
    boxShadow: '0 2px 16px rgba(0,0,0,0.7)',
  });
  track.appendChild(fill);
  root.appendChild(name);
  root.appendChild(track);
  document.body.appendChild(root);
  return { root, name, fill };
})();
const BOSS_NAMES = {
  evasive:   'THE DODGER',
  bulletHell:'THE BARRAGE',
  assassin:  'NIGHT BLADE',
  elite:     'THE SPECIALIST',
};
function renderBossBar() {
  // Find the live major boss nearest the player (there's almost
  // always at most one; the sort handles level 6+ double-boss runs).
  let boss = null;
  for (const g of gunmen.gunmen) {
    if (g.alive && g.majorBoss) { boss = g; break; }
  }
  if (!boss) {
    for (const m of melees.enemies) {
      if (m.alive && m.majorBoss) { boss = m; break; }
    }
  }
  if (!boss) {
    bossBarRoot.root.style.display = 'none';
    return;
  }
  // Only show once the player enters the boss room (same signal the
  // arena-lock uses). Prevents the bar from floating over the hud
  // while the player is still fighting through earlier rooms.
  const here = level.roomAt(player.mesh.position.x, player.mesh.position.z);
  if (!here || here.id !== boss.roomId) {
    bossBarRoot.root.style.display = 'none';
    return;
  }
  bossBarRoot.root.style.display = 'block';
  bossBarRoot.name.textContent = BOSS_NAMES[boss.archetype] || 'BOSS';
  const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  bossBarRoot.fill.style.width = `${pct * 100}%`;
}
const KEY_COLOR_HEX = {
  red: '#d04040', blue: '#4a88e0', green: '#50c060', yellow: '#e0c040',
};
function renderKeycardHud() {
  while (keyHudEl.firstChild) keyHudEl.removeChild(keyHudEl.firstChild);
  for (const color of playerKeys) {
    const card = document.createElement('div');
    Object.assign(card.style, {
      width: '22px', height: '30px',
      background: KEY_COLOR_HEX[color] || '#888',
      border: '2px solid rgba(0,0,0,0.75)', borderRadius: '2px',
      boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
    });
    card.title = `${color} keycard`;
    keyHudEl.appendChild(card);
  }
}
const hpFillEl = document.getElementById('hp-fill');
const hpRegenEl = document.getElementById('hp-regen');
const hpStatusRowEl = document.getElementById('hp-status-row');
const hpTextEl = document.getElementById('hp-text');
const promptEl = document.getElementById('prompt');
const meleeHudEl = document.getElementById('melee-hud');
const staFillEl = document.getElementById('sta-fill');
const staTextEl = document.getElementById('sta-text');
const reloadFillEl = document.getElementById('reload-fill');
const reloadLabelEl = document.getElementById('reload-label');
const reloadTextEl = document.getElementById('reload-text');
const overheadLayerEl = document.getElementById('overhead-layer');
const stealthVignetteEl = document.getElementById('stealth-vignette');
const stealthStatusEl = document.getElementById('stealth-status');
const creditTextEl = document.getElementById('credit-text');
const xpTextEl = document.getElementById('xp-text');
const spTextEl = document.getElementById('sp-text');
const spRowEl = document.getElementById('sp-row');
const deathRootEl = document.getElementById('death-root');
const deathBtnEl = document.getElementById('death-btn');
const deathMenuBtnEl = document.getElementById('death-menu-btn');
if (deathBtnEl) {
  deathBtnEl.addEventListener('click', () => {
    // Restart the level from the entry-snapshot. A restart invalidates
    // the run for the leaderboard and bumps the per-run restart count,
    // which scales down subsequent chip rewards (see awardPersistentChips).
    try {
      console.log('[restart] click received, running restart flow');
      runStats.markTainted();
      runStats.restartCount = (runStats.restartCount || 0) + 1;
      playerDead = false;
      paused = false;
      input.clearMouseState();
      // Close any modal that might still be up after a death during
      // loot/inventory/etc. — otherwise the tick short-circuit keeps
      // firing even with playerDead cleared.
      if (inventoryUI.visible) inventoryUI.hide();
      if (lootUI.isOpen()) lootUI.hide();
      if (shopUI.isOpen()) shopUI.hide();
      if (customizeUI.isOpen()) customizeUI.hide();
      if (perkUI.isOpen()) perkUI.toggle?.();
      if (gameMenuUI.isOpen()) gameMenuUI.hide();
      deathRootEl.style.display = 'none';
      // If we never captured an entry snapshot (fresh-after-boot edge
      // case), fall through to regenerating the current level so the
      // restart still produces a playable state instead of a stuck one.
      if (levelStartSnapshot) {
        restoreFromSnapshot();
      } else {
        console.warn('[restart] no snapshot — regenerating current level');
        player.restoreFullHealth();
        regenerateLevel();
      }
      // Belt-and-suspenders: recomputeStats again so HP bar / derived
      // stats reflect the restored loadout before the next tick runs.
      recomputeStats();
    } catch (e) {
      console.error('[restart] failed', e);
      // Hide the overlay even on error so the user isn't truly stuck.
      deathRootEl.style.display = 'none';
      playerDead = false;
    }
  });
}
if (deathMenuBtnEl) {
  deathMenuBtnEl.addEventListener('click', () => {
    // Bail out to the main menu. Run is already submitted (or dropped
    // if tainted) from the death-detection branch in tick(); all we do
    // here is reset the world and show the menu.
    deathRootEl.style.display = 'none';
    playerDead = false;
    input.clearMouseState();
    // Mirror Quit-to-title's reset so a fresh Play from the main menu
    // starts cleanly rather than inheriting meta progression.
    playerCredits = 0;
    playerSkillPoints = 0;
    playerLevel = 1;
    playerXp = 0;
    skills.levels = Object.create(null);
    classMastery.xp = Object.fromEntries(Object.keys(classMastery.xp).map(k => [k, 0]));
    specialPerks.unlocked = new Set();
    skillTree.levels = Object.create(null);
    artifacts.reset();
    currentWeaponIndex = 0;
    level.index = 0;
    runStats.reset();
    sfx.ambientStop();
    mainMenuUI.show();
  });
}
if (meleeHudEl) meleeHudEl.style.display = 'none';

// Quality preference is read BEFORE renderer construction because
// `antialias` can't be toggled once the renderer exists — a change
// requires reload. Everything else (shadows, pixel ratio, fog, etc.)
// is applied live via applyQuality() below.
const initialQuality = getQualityPref();
const renderer = new THREE.WebGLRenderer({ antialias: initialQuality !== 'low' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
appEl.appendChild(renderer.domElement);
attachUnlock(renderer.domElement);

// WebGL context-loss recovery. Without these handlers, an alt-tab,
// GPU driver hiccup, browser tab-throttling, or another WebGL-heavy
// page can drop the context and the canvas just renders black with
// no recovery. Players opening inventory after a long alt-tab were
// seeing the whole screen turn black even though gameplay continued
// (audio + clock kept ticking) — that matches a lost context that
// the browser never tried to restore.
//
// preventDefault() on the lost event tells the browser we want a
// restore attempt. On restore we reload — re-uploading every
// material/texture/buffer in-place is hairier than just starting
// fresh, and the player's run is already saved per-level.
let _ctxLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  _ctxLost = true;
  console.warn('[gfx] WebGL context lost — waiting for restore.');
}, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  console.warn('[gfx] WebGL context restored — reloading.');
  // Tiny delay so the warn lands in the console before the reload.
  setTimeout(() => location.reload(), 50);
}, false);

const { scene, camera, updateCamera, resize, groundPlane,
  hemiLight, keyLight, fillLight, rimLight, gridHelper } = createScene();
applyQuality(initialQuality, { renderer, scene, keyLight, fillLight, rimLight, gridHelper });

// Post-FX composer — bloom + vignette/grain. Only rendered through
// when qualityFlags.postFx is on; low mode falls back to a direct
// renderer.render call.
const postFx = createPostFx(renderer, scene, camera);

// Player line-of-sight darkening pass. The mask is rendered each
// frame from a top-down visibility fan into a half-res RT, then read
// by the postfx finisher to multiply scene brightness by ~0.30 outside
// the fan. Hooked up below — postFx is told to consume the texture as
// long as quality is high (low mode skips the composer entirely).
const losMask = createLosMask(renderer, camera);
postFx.setLosMask(losMask.texture, true);

// Footstep emitter state — accumulates horizontal distance travelled
// and emits a sample when the step-distance threshold is crossed. Step
// length shortens with sprint so fast movement = fast cadence without
// needing per-frame audio calls.
let _stepAccum = 0;
let _lastStepAt = 0;
const _prevPlayerPos = new THREE.Vector3();
function tickFootsteps(dt, pi) {
  if (!pi) return;
  const p = player.mesh.position;
  const dx = p.x - _prevPlayerPos.x;
  const dz = p.z - _prevPlayerPos.z;
  const d = Math.hypot(dx, dz);
  _prevPlayerPos.set(p.x, p.y, p.z);
  // Airborne / noclip-y moves (restart teleport) can inject huge
  // deltas — clamp so a single frame can't trigger a dozen steps.
  if (d > 2 || pi.airborne) return;
  _stepAccum += d;
  // Walk speed ≈ 6 m/s → step every 1.3 m ≈ 0.22s. Run ≈ 10 → 0.095s
  // at 0.95 m spacing. Feels natural for the isometric scale.
  const running = (dx * dx + dz * dz) / Math.max(0.0001, dt * dt) > 40;
  const stepLen = running ? 0.95 : 1.3;
  if (_stepAccum >= stepLen) {
    _stepAccum = 0;
    const now = performance.now();
    if (now - _lastStepAt > 90) {
      _lastStepAt = now;
      sfx.footstep(running);
    }
  }
}
const player = createPlayer(scene);
const input = new Input(renderer.domElement, camera, groundPlane);
const combat = new Combat(scene);
const dummies = new DummyManager(scene);
const gunmen = new GunmanManager(scene);
const melees = new MeleeEnemyManager(scene);
const loot = new LootManager(scene);
const level = new Level(scene);
const projectiles = new ProjectileManager(scene);

// Live-tune helpers for the currently equipped weapon. `tuneWeapon`
// nudges the clone's position/rotation so you can find grip-alignment
// values interactively; `inspectWeapon` dumps the transform chain so a
// known-good hand can be copied into model_manifest. Both work on the
// handle exposed by player.js when a weapon loads.
function _tuneWeapon(patch = {}) {
  const c = window.__activeWeaponClone;
  if (!c) { console.warn('[tune] no active weapon clone — equip a weapon first'); return null; }
  if (patch.x !== undefined) c.position.x = patch.x;
  if (patch.y !== undefined) c.position.y = patch.y;
  if (patch.z !== undefined) c.position.z = patch.z;
  if (patch.rotX !== undefined) c.rotation.x = patch.rotX;
  if (patch.rotY !== undefined) c.rotation.y = patch.rotY;
  if (patch.rotZ !== undefined) c.rotation.z = patch.rotZ;
  return {
    url: window.__activeWeaponUrl,
    position: c.position.toArray().map(v => +v.toFixed(3)),
    rotation: [c.rotation.x, c.rotation.y, c.rotation.z].map(v => +v.toFixed(3)),
  };
}
function _inspectWeapon() {
  const c = window.__activeWeaponClone;
  if (!c) return null;
  const box = new THREE.Box3().setFromObject(c);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  return {
    url: window.__activeWeaponUrl,
    visible: c.visible,
    position: c.position.toArray().map(v => +v.toFixed(3)),
    rotation: [c.rotation.x, c.rotation.y, c.rotation.z].map(v => +v.toFixed(3)),
    scale: c.scale.toArray().map(v => +v.toFixed(3)),
    bboxSize: size.toArray().map(v => +v.toFixed(3)),
    bboxCenter: center.toArray().map(v => +v.toFixed(3)),
    bboxEmpty: box.isEmpty(),
    meshCount: (() => { let n = 0; c.traverse(o => { if (o.isMesh) n++; }); return n; })(),
  };
}

// Dev-console handle — no runtime cost, just pointers. Lets the browser
// console poke at live state (doors, enemies, obstacles) when chasing
// bugs that aren't worth building a dedicated tool for.
window.__debug = {
  tuneWeapon: _tuneWeapon,
  inspectWeapon: _inspectWeapon,
  level, combat, gunmen, melees, loot, projectiles,
  // Scan every door's approach strip for blocking obstacles. Outer walls
  // flanking the gap and elevator-side walls are expected; anything else
  // getting returned here is a bug candidate. Match the same strip shape
  // as level._clearDoorCorridors (wider and deeper than the door itself).
  findBlockedDoors() {
    const doors = level.obstacles.filter(o => o.userData.isDoor);
    const HALF_GAP = 2.0 + 1.0;   // DOOR_WIDTH/2 + 1m margin
    const DEPTH = 3.5;
    const out = [];
    for (const d of doors) {
      const dx = d.userData.cx, dz = d.userData.cz;
      const geo = d.geometry.parameters;
      const horiz = (geo?.width || 0) > (geo?.depth || 0);
      const stripMinX = horiz ? dx - HALF_GAP : dx - DEPTH;
      const stripMaxX = horiz ? dx + HALF_GAP : dx + DEPTH;
      const stripMinZ = horiz ? dz - DEPTH   : dz - HALF_GAP;
      const stripMaxZ = horiz ? dz + DEPTH   : dz + HALF_GAP;
      const blockers = [];
      for (const o of level.obstacles) {
        if (o === d || o.userData.isDoor) continue;
        if (o.userData.isElevatorWall) continue;
        const b = o.userData.collisionXZ;
        if (!b) continue;   // collision already nulled — not a blocker
        if (b.maxX < stripMinX || b.minX > stripMaxX) continue;
        if (b.maxZ < stripMinZ || b.minZ > stripMaxZ) continue;
        // Outer walls flanking the door are expected — they define the gap.
        const onDoorEdge = horiz
          ? Math.abs(((b.minZ + b.maxZ) / 2) - dz) < 0.8
          : Math.abs(((b.minX + b.maxX) / 2) - dx) < 0.8;
        const isOuterColor = o.material?.color?.getHex?.() === 0x1a1e24;
        if (isOuterColor && onDoorEdge) continue;
        blockers.push({
          pos: [o.position.x.toFixed(2), o.position.y.toFixed(2), o.position.z.toFixed(2)],
          size: o.geometry?.parameters
            ? [o.geometry.parameters.width, o.geometry.parameters.height, o.geometry.parameters.depth]
            : null,
          color: o.material?.color?.getHexString?.(),
          name: o.name,
          mesh: o,
        });
      }
      if (blockers.length) {
        out.push({
          door: { connects: d.userData.connects, pos: [dx, dz], unlocked: d.userData.unlocked },
          blockers,
        });
      }
    }
    return out;
  },
};

const inventory = new Inventory();
// Resize the pouch to whatever slot count the player has bought
// BEFORE restoring contents — otherwise items fall outside the 1×1
// starting grid and get autoPlaced into a later slot instead of
// their saved coord.
inventory.setPouchCapacity(getPouchSlots());
inventory.loadPouch();   // restore persistent pouch contents from localStorage
// No starter weapon yet — the StartUI below asks the player to pick a
// class, then startNewRun() equips the proper starter loadout. If the
// player loads a save instead of starting fresh, the loaded inventory
// takes over before any of this runs.
//
// Helper: copy an ARMOR_DEFS entry so we don't mutate the shared def
// (durability and any rolled fields are per-instance).
function _clone(def) {
  if (!def) return null;
  const out = { ...def };
  if (def.durability) out.durability = { ...def.durability };
  return out;
}
// Pick a common-rarity weapon of the given class from tunables.
function _pickStarterWeapon(weaponClass) {
  // Mythics are boss-only — they must never seed a run as a starter.
  const candidates = tunables.weapons.filter((w) =>
    w.class === weaponClass && !w.mythic && w.rarity !== 'mythic');
  if (!candidates.length) return tunables.weapons[0];  // fallback
  return candidates[Math.floor(Math.random() * candidates.length)];
}
// Wipe and re-equip the starter loadout: pants, top, small pack, and
// a common-rarity weapon of the chosen class. Auto-equips the armor.
function startNewRun(weaponClass) {
  for (const slot in inventory.equipment) inventory.equipment[slot] = null;
  inventory.pocketsGrid.clear();
  inventory._recomputeCapacity();
  if (inventory.rigGrid)      inventory.rigGrid.clear();
  if (inventory.backpackGrid) inventory.backpackGrid.clear();
  // Starter clothing + bag — low rarity, auto-equipped.
  const pants = _clone(ARMOR_DEFS.pants_combat);
  const top   = _clone(ARMOR_DEFS.chest_light);
  const pack  = _clone(ARMOR_DEFS.backpack_small);
  if (pants) { pants.rarity = 'common'; inventory.equipment.pants    = pants; }
  if (top)   { top.rarity   = 'common'; inventory.equipment.chest    = top; }
  if (pack)  { pack.rarity  = 'common'; inventory.equipment.backpack = pack; }
  inventory._recomputeCapacity();
  // Starter weapon — common rarity, chosen class.
  const weaponDef = _pickStarterWeapon(weaponClass);
  inventory.add(wrapWeapon(weaponDef, { rarity: 'common' }));
  inventory._bump();
}

const skills = new SkillLoadout();
const skillPickUI = new SkillPickUI(skills);
// Live per-run stats — reset at every new-run start, submitted to the
// local leaderboard when the player dies. Tainted by any save/load.
const runStats = new RunStats();
window.__leaderboard = Leaderboard;   // exposes top() / all() to the UI
const specialPerks = new SpecialPerkLoadout();  // legacy — kept for save-file compat
const buffs = new BuffState();
const classMastery = new ClassMastery();
const skillTree = new SkillTreeLoadout();
const artifacts = new ArtifactCollection();
const masteryPickUI = new MasteryPickUI(skillTree);

const detailsUI = new DetailsUI({ inventory });
window.__showDetails = (item) => detailsUI.show(item);  // called from UI right-click

const gameMenuUI = new GameMenuUI({
  getVolume: getMasterVolume,
  setVolume: setMasterVolume,
  getQuality: getQualityPref,
  setQuality: (mode) => {
    setQualityPref(mode);
    applyQuality(mode, { renderer, scene, keyLight, fillLight, rimLight, gridHelper });
  },
  onSave: () => {
    // Saving disqualifies this run from the leaderboard — the post-save
    // reload would be a second chance at the same state. Flip once;
    // further saves don't un-flip.
    runStats.markTainted();
    return ({
    levelIndex: level.index,
    credits: playerCredits,
    skillPoints: playerSkillPoints,
    charLevel: playerLevel,
    xp: playerXp,
    skills: { ...skills.levels },
    classXp: { ...classMastery.xp },
    specialPerks: [...specialPerks.unlocked],
    skillTree: { ...skillTree.levels },
    inventory: snapshotInventory(),
    currentWeaponIndex,
    savedAt: Date.now(),
  }); },
  onLoad: (s) => {
    // Loading disqualifies the run from the leaderboard. Mark BEFORE
    // mutating any state so a future reference to runStats can't
    // predate the taint.
    runStats.markTainted();
    playerCredits = s.credits || 0;
    playerSkillPoints = s.skillPoints || 0;
    playerLevel = s.charLevel || 1;
    playerXp = s.xp || 0;
    skills.levels = { ...(s.skills || {}) };
    classMastery.xp = { ...(s.classXp || {}) };
    specialPerks.unlocked = new Set(s.specialPerks || []);
    skillTree.levels = { ...(s.skillTree || {}) };
    // Full inventory restore mirrors the extraction snapshot path.
    if (s.inventory) {
      for (const slot in s.inventory.equipment) {
        inventory.equipment[slot] = s.inventory.equipment[slot] || null;
      }
      inventory._recomputeCapacity();
      const loadInto = (grid, snap) => {
        if (!grid || !snap) return;
        grid.clear();
        if (snap.w && snap.h && (snap.w !== grid.w || snap.h !== grid.h))
          grid.resize(snap.w, snap.h);
        for (const e of snap.entries || []) {
          if (!e || !e.item) continue;
          if (!grid.place(e.item, e.x, e.y, !!e.rotated)) grid.autoPlace(e.item);
        }
      };
      inventory.pocketsGrid.clear();
      if (s.inventory.pockets) {
        loadInto(inventory.pocketsGrid, s.inventory.pockets);
        if (inventory.rigGrid)      loadInto(inventory.rigGrid,      s.inventory.rig);
        if (inventory.backpackGrid) loadInto(inventory.backpackGrid, s.inventory.backpackGrid);
      } else if (Array.isArray(s.inventory.pocketEntries)) {
        if (s.inventory.gridW && s.inventory.gridH) {
          inventory.pocketsGrid.resize(s.inventory.gridW, s.inventory.gridH);
        }
        for (const e of s.inventory.pocketEntries) {
          if (e && e.item && !inventory.pocketsGrid.place(e.item, e.x, e.y, !!e.rotated)) {
            inventory.autoPlaceAnywhere(e.item);
          }
        }
      } else {
        for (const it of (s.inventory.backpack || [])) {
          if (it) inventory.autoPlaceAnywhere(it);
        }
      }
      inventory._bump();
    }
    currentWeaponIndex = s.currentWeaponIndex | 0;
    level.index = (s.levelIndex | 0) - 1;  // generate() bumps to savedIndex
    regenerateLevel();
    recomputeStats();
  },
  getLeaderboard: () => Leaderboard,
  getDevTools: getDevToolsEnabled,
  setDevTools: (v) => {
    setDevToolsEnabled(v);
    setDebugPanelVisible(debugGui, v);
  },
  getPlayerName,
  setPlayerName,
  getCharacterStyle,
  setCharacterStyle: (v) => {
    setCharacterStyle(v);
    player.applyCharacterStyle?.(v);
  },
  onQuit: () => {
    // Soft-reset meta progression, then hand off to the class picker
    // so the player re-chooses their starter weapon for the new run.
    playerCredits = 0;
    playerSkillPoints = 0;
    playerLevel = 1;
    playerXp = 0;
    skills.levels = Object.create(null);
    classMastery.xp = Object.fromEntries(Object.keys(classMastery.xp).map(k => [k, 0]));
    specialPerks.unlocked = new Set();
    skillTree.levels = Object.create(null);
    artifacts.reset();
    currentWeaponIndex = 0;
    level.index = 0;
    // Manually-quit runs aren't submitted to the leaderboard — only
    // natural deaths count. Wipe stats so the next run starts clean.
    runStats.reset();
    sfx.ambientStop();
    gameMenuUI.hide();
    mainMenuUI.show();
  },
});

const startUI = new StartUI({
  onPick: (weaponClass) => {
    startNewRun(weaponClass);
    currentWeaponIndex = 0;
    level.index = 0;
    runStats.reset();
    playerDead = false;
    if (deathRootEl) deathRootEl.style.display = 'none';
    // Full HP reset — otherwise state.health from the previous death
    // (= 0) survives into the new run and the tick's death-detection
    // branch re-fires immediately on frame 1.
    recomputeStats();
    player.restoreFullHealth();
    regenerateLevel();
    sfx.ambientStart();
  },
});

// Start a run with a specific rolled weapon def (from the store picker).
// Clones the base def, stamps the rolled rarity, and wires the same
// loadout the class picker produces.
function startRunWithWeaponDef(def) {
  for (const slot in inventory.equipment) inventory.equipment[slot] = null;
  inventory.pocketsGrid.clear();
  inventory._recomputeCapacity();
  if (inventory.rigGrid)      inventory.rigGrid.clear();
  if (inventory.backpackGrid) inventory.backpackGrid.clear();
  const pants = _clone(ARMOR_DEFS.pants_combat);
  const top   = _clone(ARMOR_DEFS.chest_light);
  const pack  = _clone(ARMOR_DEFS.backpack_small);
  if (pants) { pants.rarity = 'common'; inventory.equipment.pants    = pants; }
  if (top)   { top.rarity   = 'common'; inventory.equipment.chest    = top; }
  if (pack)  { pack.rarity  = 'common'; inventory.equipment.backpack = pack; }
  inventory._recomputeCapacity();
  inventory.add(wrapWeapon({ ...def }, { rarity: def.rarity || 'common' }));
  inventory._bump();
  currentWeaponIndex = 0;
  level.index = 0;
  runStats.reset();
  playerDead = false;
  if (deathRootEl) deathRootEl.style.display = 'none';
  // Recompute derived stats first so state.maxHealth reflects the
  // freshly-equipped loadout, THEN snap health back to max. Order
  // matters: restoreFullHealth reads state.maxHealth.
  recomputeStats();
  player.restoreFullHealth();
  regenerateLevel();
}

// Build `n` weapon offers biased by the current rarity tier. Pools
// from tunables.weapons, excludes mythics entirely (boss-only drop),
// and enforces unique `name` per offer so the player sees variety.
function rollStoreOffers(n, tier) {
  const pool = tunables.weapons.filter(w =>
    !w.artifact && !w.mythic && w.rarity !== 'mythic' && w.type === 'ranged');
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const offers = [];
  const seen = new Set();
  for (const w of shuffled) {
    if (offers.length >= n) break;
    if (seen.has(w.name)) continue;
    seen.add(w.name);
    offers.push({ ...w, rarity: rollRarityForTier(tier) });
  }
  return offers;
}

const storeUpgradeUI = new StoreUpgradeUI({
  getChips: () => persistentChips,
  spendChips: (cost) => {
    if (persistentChips < cost) return false;
    persistentChips -= cost;
    savePersistentChips();
    return true;
  },
  getState: getStartingStoreState,
  setState: setStartingStoreState,
  getPouchSlots,
  buyPouchSlot: () => {
    const next = getPouchSlots() + 1;
    setPouchSlots(next);
    inventory.setPouchCapacity(next);
  },
  pouchNextCost: pouchNextSlotCost,
  pouchMax: POUCH_SLOT_MAX,
  onClose: () => { mainMenuUI.show(); },
});

const storeRollUI = new StoreRollUI({
  onPick: (def) => {
    mainMenuUI.hide();
    startRunWithWeaponDef(def);
  },
  onCancel: () => { mainMenuUI.show(); },
});

const mainMenuUI = new MainMenuUI({
  onPlay: () => {
    const { slots, rarityTier } = getStartingStoreState();
    const offers = rollStoreOffers(slots, rarityTier);
    input.clearMouseState();
    storeRollUI.show(offers, { slots, tier: rarityTier });
  },
  onOpenStore: () => { mainMenuUI.hide(); storeUpgradeUI.show(); },
  getLeaderboard: () => Leaderboard,
  getVolume: getMasterVolume,
  setVolume: setMasterVolume,
  getQuality: getQualityPref,
  setQuality: (mode) => {
    setQualityPref(mode);
    applyQuality(mode, { renderer, scene, keyLight, fillLight, rimLight, gridHelper });
  },
  getDevTools: getDevToolsEnabled,
  setDevTools: (v) => { setDevToolsEnabled(v); setDebugPanelVisible(debugGui, v); },
  getPlayerName,
  setPlayerName,
  getCharacterStyle,
  setCharacterStyle: (v) => {
    setCharacterStyle(v);
    player.applyCharacterStyle?.(v);
  },
});
// Mastery offers queued when class XP crosses a threshold. Each entry is
// { classId, options:[nodeRef,...] } and gets resolved by the picker modal.
const pendingMasteryOffers = [];

function awardClassXp(weaponClass, enemyTier) {
  if (!weaponClass) return;
  const xp = enemyTier === 'boss' ? 60 : enemyTier === 'subBoss' ? 30 : 10;
  const leveledUp = classMastery.awardXp(weaponClass, xp);
  if (leveledUp) {
    const options = makeMasteryOffers(weaponClass, skillTree);
    if (options.length) pendingMasteryOffers.push({ classId: weaponClass, options });
  }
}

let currentWeaponIndex = 0;
function getRotation() { return inventory.getWeaponRotation(); }
function currentWeapon() { return getRotation()[currentWeaponIndex] || null; }
function setWeaponIndex(i) {
  const rotation = getRotation();
  if (rotation.length === 0) return;
  currentWeaponIndex = ((i % rotation.length) + rotation.length) % rotation.length;
  const w = currentWeapon();
  if (w) player.setWeapon(w);
  player.cancelCombo();
  playerFireCooldown = 0;
  playerBurstRemaining = 0;
  playerBurstTimer = 0;
  if (typeof renderWeaponBar === 'function') renderWeaponBar();
}
function onInventoryChanged() {
  const rotation = getRotation();
  if (rotation.length === 0) { currentWeaponIndex = 0; return; }
  if (currentWeaponIndex >= rotation.length) currentWeaponIndex = 0;
  const w = currentWeapon();
  if (w) player.setWeapon(w);
}

// Shared drag-state so both InventoryUI and CustomizeUI can see what's being
// dragged across their DOM trees.
let uiDragState = null;
const getDragState = () => uiDragState;
const setDragState = (s) => { uiDragState = s; };

const customizeUI = new CustomizeUI({
  inventory,
  getDragState, setDragState,
  onClose: () => inventoryUI.render(),
  // Backpack-full fallback for detach — drop the attachment on the
  // ground next to the player so the detach action always succeeds.
  onDrop: (item) => loot.spawnItem(player.mesh.position.clone(), item),
});

const lootUI = new LootUI({
  inventory,
  onClose: () => inventoryUI.render(),
  onOpenCustomize: (item) => {
    if (!item) return;
    if (item.type === 'ranged' || item.type === 'melee') customizeUI.open(item);
  },
  onDrop: (item) => loot.spawnItem(player.mesh.position.clone(), item),
});

const perkUI = new PerkUI({
  tree: skillTree,
  getPoints: () => playerSkillPoints,
  spendPoints: (n) => { if (playerSkillPoints < n) return false; playerSkillPoints -= n; return true; },
  classMastery,
  onClose: () => { inventoryUI.render(); recomputeStats(); },
});

const shopUI = new ShopUI({
  inventory,
  getCredits: () => playerCredits,
  spendCredits: (n) => { if (playerCredits < n) return false; playerCredits -= n; return true; },
  earnCredits: (n) => { playerCredits += n; runStats.addCredits(n); },
  onClose: () => inventoryUI.render(),
  getShopMult: () => derivedStats.shopPriceMult || 1,
  onAcquireArtifact: (id) => {
    const ok = artifacts.acquire(id);
    if (ok) {
      recomputeStats();
      sfx.uiAccept();
    }
    return ok;
  },
  onBearTrade: (toyIds) => {
    // Consume one of each toy id from anywhere in the inventory.
    const needed = new Set(toyIds);
    const toConsume = [];
    for (const g of inventory.allGrids()) {
      for (const it of g.items()) {
        if (it && needed.has(it.id)) {
          needed.delete(it.id);
          toConsume.push(it);
          if (needed.size === 0) break;
        }
      }
      if (needed.size === 0) break;
    }
    if (needed.size > 0) return false;
    for (const it of toConsume) {
      const g = inventory.gridOf(it);
      if (g) g.remove(it);
    }
    // Grant Jessica's Rage wrapped in inventory.
    const jr = tunables.weapons.find(w => w.name === "Jessica's Rage");
    if (jr) inventory.add(wrapWeapon(jr));
    inventory._bump();
    return true;
  },
});

// Rolls a per-item price multiplier inside the configured ±range so each
// merchant feels like a fresh market snapshot.
function rollPriceMult() {
  const range = tunables.currency.priceFluxRange ?? 0.2;
  return +(1 + (Math.random() * 2 - 1) * range).toFixed(3);
}
function fluxify(item) { item.priceMult = rollPriceMult(); return item; }

// Shops bias toward higher-rarity items — they're the supply side, and
// rare gear is mostly seen through them rather than enemy drops.
function shopUpgradeRarity(item, { baseChance = 0.35, epicChance = 0.10 } = {}) {
  if (!item) return item;
  if (item.type === 'ranged' || item.type === 'melee') return item; // weapons roll via wrap
  if (Math.random() < baseChance) {
    const r = Math.random();
    if (r < epicChance) item.rarity = 'epic';
    else if (r < epicChance + 0.45) item.rarity = 'rare';
    else item.rarity = 'uncommon';
  }
  return item;
}

function makeMerchantStock() {
  const pool = [
    ...tunables.weapons.filter(w => !w.artifact && !w.mythic && w.rarity !== 'mythic').map(w => wrapWeapon(w)),
    ...ALL_ARMOR.map(a => withAffixes(shopUpgradeRarity({ ...a, durability: { ...a.durability } }))),
    ...ALL_GEAR.map(g => withAffixes(shopUpgradeRarity({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } }))),
    ...ALL_ATTACHMENTS.map(a => ({ ...a, modifier: { ...a.modifier } })),
    { ...CONSUMABLE_DEFS.bandage },
    { ...CONSUMABLE_DEFS.medkit },
  ];
  const stock = [];
  const n = Math.min(tunables.merchant.stockSize, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    stock.push(fluxify(pool.splice(idx, 1)[0]));
  }
  return stock;
}

// Healer NPC carries only health + buff consumables and a touch of armor.
function makeHealerStock() {
  return [
    { ...CONSUMABLE_DEFS.bandage },
    { ...CONSUMABLE_DEFS.bandage },
    { ...CONSUMABLE_DEFS.medkit },
    { ...CONSUMABLE_DEFS.medkit },
    { ...CONSUMABLE_DEFS.adrenaline },
    { ...CONSUMABLE_DEFS.combatStim },
  ].map(fluxify);
}

// Scatter rooms — each sells a focused slice of the merchant's pool, with
// higher prices and a slight rarity bias upward.
function pickN(arr, n) {
  const src = [...arr];
  const out = [];
  for (let i = 0; i < n && src.length; i++) {
    const idx = Math.floor(Math.random() * src.length);
    out.push(src.splice(idx, 1)[0]);
  }
  return out;
}
function makeGunsmithStock() {
  // 4 weapons + 3 attachments, weapons lean rare+.
  const weapons = pickN(
    tunables.weapons.filter(w => !w.artifact && !w.mythic && w.rarity !== 'mythic').map(w => wrapWeapon(w)),
    4,
  );
  const atts = pickN(ALL_ATTACHMENTS.map(a => ({ ...a, modifier: { ...a.modifier } })), 3);
  return [...weapons, ...atts].map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.15;  // premium shop
    return fluxify(it);
  });
}
function makeArmorerStock() {
  const armor = pickN(ALL_ARMOR.map(a => withAffixes(shopUpgradeRarity({ ...a, durability: { ...a.durability } }, { baseChance: 0.55, epicChance: 0.18 }))), 4);
  const gear  = pickN(ALL_GEAR.map(g => withAffixes(shopUpgradeRarity({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } }, { baseChance: 0.50, epicChance: 0.15 }))), 3);
  return [...armor, ...gear].map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.1;
    return fluxify(it);
  });
}
function makeTailorStock() {
  // Tailor peddles cloth/clothing — gear items only (no armor plates).
  const gear = pickN(ALL_GEAR.map(g => withAffixes(shopUpgradeRarity({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } }, { baseChance: 0.55, epicChance: 0.15 }))), 6);
  return gear.map((it) => {
    it.priceMult = (it.priceMult || 1) * 0.9;  // tailor is cheaper
    return fluxify(it);
  });
}
function makeRelicSellerStock() {
  // Relic sellers now deal exclusively in artifact scrolls — permanent
  // run-altering buffs. Each visit offers 2-3 unowned artifacts plus a
  // couple of expensive high-rarity junk pieces as flavour stock.
  const unowned = ALL_ARTIFACTS.filter(a => !artifacts.has(a.id));
  const offerCount = Math.min(3, unowned.length);
  const picks = [];
  const pool = [...unowned];
  for (let i = 0; i < offerCount; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  const scrolls = picks.map(def => {
    const scroll = artifactScrollFor(def.id);
    scroll.priceMult = 1;
    return scroll;
  });
  const junks = pickN(ALL_JUNK.slice().map(j => ({ ...j })), 2);
  return [...scrolls, ...junks.map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.6;
    return fluxify(it);
  })];
}
function makeBlackMarketStock() {
  // Mix of high-tier everything — expensive but consistently good.
  const weapons = pickN(
    tunables.weapons.filter(w => !w.artifact && (w.rarity === 'rare' || w.rarity === 'epic' || !w.rarity))
      .map(w => wrapWeapon(w)),
    3,
  );
  const gear = pickN(ALL_GEAR.map(g => withAffixes({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } })), 2);
  const armor = pickN(ALL_ARMOR.map(a => withAffixes({ ...a, durability: { ...a.durability } })), 2);
  const att = pickN(ALL_ATTACHMENTS.map(a => ({ ...a, modifier: { ...a.modifier } })), 2);
  return [...weapons, ...gear, ...armor, ...att].map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.4;
    return fluxify(it);
  });
}

const inventoryUI = new InventoryUI({
  inventory, skills,
  onDrop: (item) => loot.spawnItem(player.mesh.position.clone(), item),
  getActiveWeapon: () => currentWeapon(),
  onOpenCustomize: (item) => {
    if (!item) return;
    if (item.type === 'ranged' || item.type === 'melee') customizeUI.open(item);
  },
  getDragState, setDragState,
});

const debugGui = initDebugPanel({
  onGiveAll: () => {
    for (const w of tunables.weapons) inventory.add(wrapWeapon(w));
    for (const a of ALL_ARMOR) inventory.add({ ...a, durability: { ...a.durability } });
    for (const g of ALL_GEAR) inventory.add({ ...g, durability: { ...g.durability } });
    for (const att of ALL_ATTACHMENTS) inventory.add({ ...att, modifier: { ...att.modifier } });
    for (let i = 0; i < 3; i++) inventory.add({ ...CONSUMABLE_DEFS.medkit });
    for (const j of ALL_JUNK) inventory.add({ ...j });
    for (const t of ALL_TOYS) inventory.add({ ...t });
    onInventoryChanged();
    inventoryUI.render();
  },
  onRegenerate: () => regenerateLevel(),
});
if (currentWeapon()) player.setWeapon(currentWeapon());

function weaponHasPerk(weapon, id) {
  return !!(weapon && weapon.perks && weapon.perks.some(p => p.id === id));
}
function weaponHasArtifactPerk(weapon, id) {
  return !!(weapon && weapon.artifactPerks && weapon.artifactPerks.includes(id));
}

// Detach a dead enemy's head mesh and launch it in the given direction.
function popHead(enemy, launchDir) {
  const head = enemy.head;
  if (!head || !head.parent) return;
  const worldPos = head.getWorldPosition(new THREE.Vector3());
  head.parent.remove(head);
  head.position.copy(worldPos);
  scene.add(head);
  const dir = (launchDir && launchDir.lengthSq && launchDir.lengthSq() > 0.0001)
    ? launchDir.clone() : new THREE.Vector3(0, 0, 1);
  dir.y = 0;
  if (dir.lengthSq() > 0.0001) dir.normalize();
  const vel = new THREE.Vector3(
    dir.x * (3 + Math.random() * 2),
    5 + Math.random() * 2,
    dir.z * (3 + Math.random() * 2),
  );
  const spin = new THREE.Vector3(
    (Math.random() - 0.5) * 12,
    (Math.random() - 0.5) * 12,
    (Math.random() - 0.5) * 12,
  );
  combat.spawnGore(head, vel, spin);
  combat.spawnBloodBurst(worldPos, dir, 18);
}

let lastPlayerInfo = null;
// Last-sampled weapon tip during a melee swing — used to chain
// per-frame trail segments end-to-end. Reset to null when the combo
// returns to idle / window so the next swing starts a fresh trail.
let _playerMeleeTrailPrev = null;
function berserkMult() {
  const pi = lastPlayerInfo;
  if (!pi || !derivedStats.berserkBonus) return 1;
  return pi.health / pi.maxHealth < 0.5 ? 1 + derivedStats.berserkBonus : 1;
}

function difficultyScale() {
  // Level 1 = 1.0; each subsequent level raises HP/damage/rarity-weight.
  const lv = Math.max(0, level.index - 1);
  return {
    hpMult: 1 + 0.18 * lv,
    damageMult: 1 + 0.12 * lv,
    rarityBias: Math.min(0.6, 0.08 * lv),  // upweight rarer weapons at higher levels
  };
}

function pickWeaponForAI(variant) {
  // LMGs only drop on tank-variant grunts — their slow-moving, beefy
  // silhouette is the visual cue the player uses to commit to LMG
  // countertactics (push cover, close distance). Any other variant
  // gets filtered off the pool.
  const allowLmg = variant === 'tank';
  const ranged = tunables.weapons.filter(w =>
    w.type === 'ranged' && !w.artifact && !w.mythic && w.rarity !== 'mythic'
    && (allowLmg || w.class !== 'lmg'));
  const bias = difficultyScale().rarityBias;
  const weights = ranged.map((w) => {
    const r = w.rarity || 'common';
    let weight = 1.0;
    if (r === 'uncommon') weight = 0.7 + bias;
    else if (r === 'rare') weight = 0.25 + bias * 1.3;
    else if (r === 'epic') weight = 0.05 + bias;
    else weight = 1.0 - bias * 0.5;
    return Math.max(0.02, weight);
  });
  let total = 0; for (const w of weights) total += w;
  let roll = Math.random() * total;
  let pick = ranged[0];
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { pick = ranged[i]; break; }
  }
  // Clone + pre-equip attachments scaled by level index. Level 1 AI
  // carry bare guns so the player sees a clean baseline; by mid-run
  // grunts pack ~2 attachments and rare grunts can roll epic mods.
  const lv = Math.max(1, level.index || 1);
  const attachmentCount =
      lv <= 1 ? 0
    : lv <= 2 ? (Math.random() < 0.35 ? 1 : 0)
    : lv <= 4 ? 1 + (Math.random() < 0.3 ? 1 : 0)
    : 2 + (Math.random() < 0.4 ? 1 : 0);
  const attachments = {};
  for (const s of pick.attachmentSlots || []) attachments[s] = null;
  const openSlots = pick.attachmentSlots ? [...pick.attachmentSlots] : [];
  for (let i = 0; i < attachmentCount && openSlots.length > 0; i++) {
    const candidates = ALL_ATTACHMENTS.filter(a => openSlots.includes(a.slot));
    if (!candidates.length) break;
    const chosenAtt = candidates[Math.floor(Math.random() * candidates.length)];
    attachments[chosenAtt.slot] = {
      ...chosenAtt,
      modifier: { ...(chosenAtt.modifier || {}) },
    };
    const idx = openSlots.indexOf(chosenAtt.slot);
    if (idx >= 0) openSlots.splice(idx, 1);
  }
  return { ...pick, attachments };
}

function regenerateLevel() {
  level.generate();
  // Track furthest level reached this run. Monotonic — doesn't regress
  // if a level is re-entered for any reason.
  runStats.setLevel(level.index | 0);
  gunmen.removeAll();
  melees.removeAll();
  loot.removeAll();
  playerKeys.clear();
  const diff = difficultyScale();
  const gearLevel = level.index || 0;
  // Keycard assignment — hand each level.keycardColors entry to a
  // random sub-boss or major-boss spawn. Level generation caps key
  // count by holder count, so the pool shouldn't exhaust; if it
  // somehow does (edge case), fall through to the first-available
  // elite spawn so no key ever goes unassigned and softlocks a door.
  const holderSpawns = level.enemySpawns.filter(s => s.tier === 'subBoss' || s.majorBoss);
  const keyPool = [...(level.keycardColors || [])];
  const shuffled = holderSpawns.slice().sort(() => Math.random() - 0.5);
  const keyAssignments = new Map();   // spawn entry → colour
  for (const sb of shuffled) {
    if (!keyPool.length) break;
    keyAssignments.set(sb, keyPool.shift());
  }
  // Fallback — any leftover keys get stamped onto non-boss tier-'boss'
  // elites (there's always at least one in a boss room). If even that
  // is empty, spread remaining keys across the toughest available
  // normal spawns.
  if (keyPool.length) {
    const fallback = level.enemySpawns.filter(s =>
      !keyAssignments.has(s) && (s.tier === 'boss' || s.tier === 'elite'));
    for (const sb of fallback) {
      if (!keyPool.length) break;
      keyAssignments.set(sb, keyPool.shift());
    }
  }
  if (keyPool.length) {
    const any = level.enemySpawns.filter(s => !keyAssignments.has(s));
    for (const sb of any) {
      if (!keyPool.length) break;
      keyAssignments.set(sb, keyPool.shift());
    }
  }
  for (const s of level.enemySpawns) {
    const opts = {
      tier: s.tier, roomId: s.roomId,
      hpMult: diff.hpMult, damageMult: diff.damageMult,
      variant: s.variant,
      gearLevel,
      archetype: s.archetype,
      majorBoss: !!s.majorBoss,
    };
    if (s.kind === 'melee') {
      const e = melees.spawn(s.x, s.z, opts);
      const colour = keyAssignments.get(s);
      if (colour && e) e.keyDrop = colour;
    } else {
      const g = gunmen.spawn(s.x, s.z, pickWeaponForAI(s.variant), opts);
      const colour = keyAssignments.get(s);
      if (colour && g) g.keyDrop = colour;
    }
  }

  // Softlock safety net — BFS from the start room through doors that
  // are currently UNLOCKED (non-keycard or already-opened). Every
  // spawn whose room isn't reachable gets its keycard gate unlocked
  // automatically so the key holder can't end up trapped behind a
  // door they themselves are holding the key for. Costs one BFS per
  // level load and guarantees no softlock regardless of what the
  // generator / assignment chose.
  (function ensureHolderReachability() {
    if (!level.rooms || !level.rooms.length) return;
    const holderSpawnsWithKey = level.enemySpawns.filter(s => keyAssignments.has(s));
    if (!holderSpawnsWithKey.length) return;
    const startId = level.rooms.findIndex(r => r.type === 'start');
    if (startId < 0) return;
    const doorsFor = (roomId) => level.obstacles.filter(o =>
      o.userData.isDoor && o.userData.connects?.includes(roomId));
    const reachable = new Set([startId]);
    const q = [startId];
    while (q.length) {
      const id = q.shift();
      for (const d of doorsFor(id)) {
        // Locked keycard door — can't traverse during BFS. Elevator
        // doors are gates by design and handled by the lift logic.
        if (d.userData.keyRequired && !d.userData.unlocked) continue;
        const [aId, bId] = d.userData.connects;
        const other = aId === id ? bId : aId;
        if (reachable.has(other)) continue;
        reachable.add(other);
        q.push(other);
      }
    }
    for (const s of holderSpawnsWithKey) {
      if (reachable.has(s.roomId)) continue;
      // Find the shortest chain of locked doors from a reachable
      // room to this holder's room, and unlock them all. BFS again
      // ignoring the locked gating to reconstruct the path.
      const parent = new Map();
      const q2 = [startId];
      const seen = new Set([startId]);
      let found = false;
      while (q2.length && !found) {
        const id = q2.shift();
        for (const d of doorsFor(id)) {
          const [aId, bId] = d.userData.connects;
          const other = aId === id ? bId : aId;
          if (seen.has(other)) continue;
          seen.add(other);
          parent.set(other, { via: d, from: id });
          if (other === s.roomId) { found = true; break; }
          q2.push(other);
        }
      }
      let cur = s.roomId;
      while (parent.has(cur)) {
        const step = parent.get(cur);
        if (step.via.userData.keyRequired && !step.via.userData.unlocked) {
          level._openDoor(step.via);
          // Remove the token so the player doesn't hunt for a key
          // that's been auto-opened (defensive — this path rarely fires).
          const col = step.via.userData.keyRequired;
          step.via.userData.keyRequired = null;
          delete level.keycardDoors?.[col];
          if (level.keycardColors) {
            const idx = level.keycardColors.indexOf(col);
            if (idx >= 0) level.keycardColors.splice(idx, 1);
          }
        }
        cur = step.from;
      }
    }
  })();
  for (const npc of level.npcs) {
    if (npc.kind === 'merchant') npc.stock = makeMerchantStock();
    else if (npc.kind === 'healer') npc.stock = makeHealerStock();
    else if (npc.kind === 'gunsmith') npc.stock = makeGunsmithStock();
    else if (npc.kind === 'armorer') npc.stock = makeArmorerStock();
    else if (npc.kind === 'tailor') npc.stock = makeTailorStock();
    else if (npc.kind === 'relicSeller') npc.stock = makeRelicSellerStock();
    else if (npc.kind === 'blackMarket') npc.stock = makeBlackMarketStock();
  }
  player.mesh.position.set(level.playerSpawn.x, 0, level.playerSpawn.z);
  saveLevelStart();
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  resize();
  postFx.resize(window.innerWidth, window.innerHeight);
  losMask.resize(window.innerWidth, window.innerHeight);
});

// Safety net for the `ui-grid-dragging` body class — without this,
// an interrupted drag (tab-away, dev tools focus, a thrown error in
// a dragstart handler) can leave the class set, which makes every
// grid tile pointer-transparent and breaks further drags until
// reload. Clears on pointerup and on window blur.
const _clearGridDragClass = () => document.body.classList.remove('ui-grid-dragging');
window.addEventListener('pointerup', _clearGridDragClass);
window.addEventListener('blur', _clearGridDragClass);
document.addEventListener('dragend', _clearGridDragClass, true);

const clock = new THREE.Clock();
const _tmpDir = new THREE.Vector3();
const _rotatedDir = new THREE.Vector3();
const _muzzlePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

let playerDead = false;
let frameCounter = 0;   // used by quality throttles (e.g. enemy LoS every other frame in low mode)

// --- Per-system perf timing ------------------------------------------------
// Lightweight timing — hand-rolled instead of bringing in stats.js, since
// we want per-system breakdown not a single fps number. `_perf.start(key)`
// stamps performance.now(); `_perf.end(key)` accumulates the elapsed ms
// into a 60-frame running average. Toggle the overlay via Backquote (`)
// or by setting window.__perf = true. Overhead per call: ~0.001ms.
const _perf = (() => {
  const totals = {};   // key → array of last 60 frame ms values
  const stamps = {};   // key → start timestamp
  const order = [];    // insertion order for stable display ordering
  const SAMPLES = 60;
  let visible = false;
  let el = null;
  function start(key) {
    if (!visible) return;
    stamps[key] = performance.now();
  }
  function end(key) {
    if (!visible) return;
    const t0 = stamps[key];
    if (t0 === undefined) return;
    const dt = performance.now() - t0;
    let arr = totals[key];
    if (!arr) { arr = totals[key] = []; order.push(key); }
    arr.push(dt);
    if (arr.length > SAMPLES) arr.shift();
  }
  function toggle() {
    visible = !visible;
    if (!el) {
      el = document.createElement('div');
      el.id = 'perf-overlay';
      el.style.cssText = `
        position: fixed; top: 12px; right: 12px; z-index: 9999;
        background: rgba(5,6,7,0.85); color: #00e6ff;
        font: 11px ui-monospace, Menlo, Consolas, monospace;
        padding: 8px 10px; border: 1px solid rgba(0,230,255,0.3);
        border-radius: 4px; pointer-events: none; min-width: 180px;
        white-space: pre; line-height: 1.45;
      `;
      document.body.appendChild(el);
    }
    el.style.display = visible ? 'block' : 'none';
    if (!visible) { for (const k of order) totals[k] = []; }
  }
  function render(fps) {
    if (!visible || !el) return;
    let total = 0;
    let lines = `FPS  ${fps.toFixed(0).padStart(4)}\n`;
    for (const k of order) {
      const arr = totals[k];
      if (!arr || arr.length === 0) continue;
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i];
      const avg = sum / arr.length;
      total += avg;
      lines += `${k.padEnd(10)} ${avg.toFixed(2).padStart(5)} ms\n`;
    }
    lines += `${'TOTAL'.padEnd(10)} ${total.toFixed(2).padStart(5)} ms`;
    el.textContent = lines;
  }
  return { start, end, toggle, render, isVisible: () => visible };
})();
window.__perf = _perf;
let levelStartSnapshot = null;

function snapshotItem(item) {
  if (!item) return null;
  const copy = { ...item };
  if (item.durability) copy.durability = { ...item.durability };
  if (item.attachments) copy.attachments = { ...item.attachments };
  if (item.modifier) copy.modifier = { ...item.modifier };
  if (item.affixes) copy.affixes = item.affixes.map(a => ({ ...a }));
  return copy;
}
function snapshotInventory() {
  const eq = {};
  for (const slot in inventory.equipment) eq[slot] = snapshotItem(inventory.equipment[slot]);
  const gridSnap = (g) => g ? {
    w: g.w, h: g.h,
    entries: g.entries().map((e) => ({
      item: snapshotItem(e.item),
      x: e.x, y: e.y, rotated: !!e.rotated,
    })),
  } : null;
  return {
    equipment: eq,
    // Legacy flat view — still populated for old restore paths.
    backpack: inventory.backpack.map(snapshotItem),
    pockets:  gridSnap(inventory.pocketsGrid),
    rig:      gridSnap(inventory.rigGrid),
    backpackGrid: gridSnap(inventory.backpackGrid),
    // Legacy pocketEntries for pre-Phase-2 saves.
    pocketEntries: inventory.pocketsGrid.entries().map((e) => ({
      item: snapshotItem(e.item), x: e.x, y: e.y, rotated: !!e.rotated,
    })),
    gridW: inventory.pocketsGrid.w,
    gridH: inventory.pocketsGrid.h,
  };
}
function resetRunState() { secondWindUsed = 0; }
function saveLevelStart() {
  levelStartSnapshot = {
    levelIndex: level.index,
    credits: playerCredits,
    skillPoints: playerSkillPoints,
    charLevel: playerLevel,
    xp: playerXp,
    skills: { ...skills.levels },
    classXp: { ...classMastery.xp },
    specialPerks: [...specialPerks.unlocked],
    skillTree: { ...skillTree.levels },
    artifacts: [...artifacts.owned],
    inventory: snapshotInventory(),
    currentWeaponIndex,
  };
}
function restoreFromSnapshot() {
  if (!levelStartSnapshot) return;
  resetRunState();
  const s = levelStartSnapshot;
  playerCredits = s.credits;
  playerSkillPoints = s.skillPoints;
  playerLevel = s.charLevel;
  playerXp = s.xp;
  skills.levels = { ...s.skills };
  classMastery.xp = { ...s.classXp };
  specialPerks.unlocked = new Set(s.specialPerks || []);
  skillTree.levels = { ...(s.skillTree || {}) };
  artifacts.owned = new Set(s.artifacts || []);
  for (const slot in s.inventory.equipment) {
    inventory.equipment[slot] = snapshotItem(s.inventory.equipment[slot]);
  }
  // Rebuild rig/backpack grids from restored equipment before
  // repopulating contents.
  inventory._recomputeCapacity();
  // Restore each grid from its own snapshot block if available.
  const loadInto = (grid, snap) => {
    if (!grid || !snap) return false;
    grid.clear();
    if (snap.w && snap.h && (snap.w !== grid.w || snap.h !== grid.h)) {
      grid.resize(snap.w, snap.h);
    }
    for (const e of snap.entries || []) {
      const it = snapshotItem(e.item);
      if (!it) continue;
      if (!grid.place(it, e.x, e.y, !!e.rotated)) grid.autoPlace(it);
    }
    return true;
  };
  inventory.pocketsGrid.clear();
  let usedNewFormat = false;
  if (s.inventory.pockets) {
    loadInto(inventory.pocketsGrid, s.inventory.pockets);
    if (inventory.rigGrid)      loadInto(inventory.rigGrid,      s.inventory.rig);
    if (inventory.backpackGrid) loadInto(inventory.backpackGrid, s.inventory.backpackGrid);
    usedNewFormat = true;
  } else if (Array.isArray(s.inventory.pocketEntries)) {
    // Legacy Phase-1 single-grid snapshot.
    if (s.inventory.gridW && s.inventory.gridH) {
      inventory.pocketsGrid.resize(s.inventory.gridW, s.inventory.gridH);
    }
    for (const e of s.inventory.pocketEntries) {
      const it = snapshotItem(e.item);
      if (!it) continue;
      if (!inventory.pocketsGrid.place(it, e.x, e.y, !!e.rotated)) {
        // Doesn't fit in the new 4×2 pockets — fan out to other grids.
        inventory.autoPlaceAnywhere(it);
      }
    }
    usedNewFormat = true;
  }
  if (!usedNewFormat && Array.isArray(s.inventory.backpack)) {
    for (const src of s.inventory.backpack) {
      const it = snapshotItem(src);
      if (it) inventory.autoPlaceAnywhere(it);
    }
  }
  inventory._bump();
  currentWeaponIndex = s.currentWeaponIndex || 0;
  level.index = s.levelIndex - 1; // regenerate increments back to target
  player.restoreFullHealth();
  onInventoryChanged();
  recomputeStats();
  regenerateLevel();
}

// Laser beam + flashlight cone driven by the equipped weapon's sideRail
// attachment. Reused across frames; visibility toggled per light tier.
// Custom shader material fades the beam along its length — bright at
// the muzzle, nearly transparent at the tip — so the beam reads as
// dispersing light rather than a painted cylinder. Color + per-tier
// visual tuning come in via uniforms each frame.
const laserMat = new THREE.ShaderMaterial({
  uniforms: {
    uColor:  { value: new THREE.Color(0xff3030) },
    uAlpha0: { value: 0.95 },   // at muzzle
    uAlpha1: { value: 0.05 },   // at tip
  },
  vertexShader: `
    varying float vT;
    void main() {
      // CylinderGeometry local Y is -0.5 (muzzle) → +0.5 (tip) after
      // the height=1 default, so vT is 0 near the gun and 1 at the
      // end of the beam.
      vT = position.y + 0.5;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    uniform float uAlpha0;
    uniform float uAlpha1;
    varying float vT;
    void main() {
      float a = mix(uAlpha0, uAlpha1, vT);
      gl_FragColor = vec4(uColor, a);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
const laserMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.02, 0.02, 1, 6, 1, true),
  laserMat,
);
laserMesh.visible = false;
scene.add(laserMesh);
// Dedicated raycaster for laser wall tests — doesn't share the
// pooled raycaster to avoid cross-frame state bleed.
const _laserRay = new THREE.Raycaster();
// Cone primitive removed — was an additive mesh behind the SpotLight
// meant to sell "dust in the beam", but it read as a flat painted
// cone (especially the strobe variant flickering on/off). All light
// attachments are now pure SpotLight emission: walls actually
// brighten up and shadows extend, no overlaid geometry. Placeholder
// Object3D kept because a few downstream sites still assign .visible
// on it; will be removed in a follow-up cleanup pass.
const flashConeMesh = new THREE.Object3D();
flashConeMesh.visible = false;
flashConeMesh.material = { opacity: 0, color: { setHex: () => {} } }; // shim for legacy setters

// Real SpotLight so the cone actually illuminates surfaces — walls
// and floor inside the cone brighten up, enemies cast longer shadows.
// Distance / decay tuned so the light actually illuminates the room
// at the camera's iso distance; the old values were so faint the
// attachment was basically a cosmetic mesh.
const flashSpot = new THREE.SpotLight(0xffe0a0, 0, 14, Math.PI / 4, 0.45, 1.2);
flashSpot.visible = false;
scene.add(flashSpot);
scene.add(flashSpot.target);

// Player toggle for the gun-mounted light / tactical attachments.
// Starts on; T key flips the flag. The flashlight cone + SpotLight
// in updateBeamAndCone check this before emitting any light so an
// equipped light can be stowed for stealth without removing it.
let lightsEnabled = true;

// Dev key — F2 dumps a full level generation snapshot to the console
// so the user can copy/paste it when reporting a wall bug. Kept
// outside the input.js key table so it still fires inside modals
// (no game-state dependency).
window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'F2') return;
  ev.preventDefault();
  try {
    const dump = {
      timestamp: new Date().toISOString(),
      levelIndex: level.index ?? null,
      seed: level.seed ?? null,
      playerPos: player?.mesh?.position
        ? { x: +player.mesh.position.x.toFixed(2), z: +player.mesh.position.z.toFixed(2) }
        : null,
      bossRoomId: level.bossRoomId ?? -1,
      rooms: (level.rooms || []).map((r, i) => ({
        i,
        id: r.id ?? null,
        type: r.type || null,
        layout: r.layout || null,
        giant: !!r.giant,
        doubled: !!r.doubled,
        cell: (r.cellX != null && r.cellZ != null) ? { x: r.cellX, z: r.cellZ } : null,
        bounds: r.bounds ? {
          minX: +r.bounds.minX.toFixed(2), maxX: +r.bounds.maxX.toFixed(2),
          minZ: +r.bounds.minZ.toFixed(2), maxZ: +r.bounds.maxZ.toFixed(2),
        } : null,
        isBoss: i === level.bossRoomId,
        neighbors: (r.neighbors || []).map(n => n.dir || n),
        doors: (r.doors || []).length,
      })),
      // Overlapping-room check — flags any pair whose AABBs intersect
      // (shouldn't happen for non-giant rooms; giant extensions should
      // never land on a cell another room already occupies). Print up
      // front so the bug jumps out of a long dump.
      roomOverlaps: (() => {
        const rs = level.rooms || [];
        const overlaps = [];
        for (let i = 0; i < rs.length; i++) {
          for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i].bounds, b = rs[j].bounds;
            if (!a || !b) continue;
            if (a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ) {
              overlaps.push({ a: i, b: j });
            }
          }
        }
        return overlaps;
      })(),
      obstacleCount: (level.obstacles || []).length,
      walls: (level.obstacles || [])
        .filter(o => !o.userData?.isProp && !o.userData?.isDoor)
        .map(o => {
          const g = o.geometry?.parameters || {};
          return {
            pos: { x: +o.position.x.toFixed(2), y: +o.position.y.toFixed(2), z: +o.position.z.toFixed(2) },
            size: { w: +(g.width || 0).toFixed(2), h: +(g.height || 0).toFixed(2), d: +(g.depth || 0).toFixed(2) },
          };
        }),
      doors: (level.obstacles || [])
        .filter(o => o.userData?.isDoor)
        .map(o => ({
          pos: { x: +o.position.x.toFixed(2), z: +o.position.z.toFixed(2) },
          locked: !!o.userData?.locked,
        })),
    };
    console.log('=== LEVEL DUMP (F2) ===');
    console.log(JSON.stringify(dump, null, 2));
    console.log('=== END LEVEL DUMP ===');
    transientHudMsg?.('level dump → console', 1.2);
  } catch (e) {
    console.warn('level dump failed:', e);
  }
});

// Controls overlay toggle — `?` or `/` flips the visibility of the
// `#hud` block. The accompanying `#controls-hint` prompt is auto-
// hidden while the overlay is up. Window-level listener so the
// toggle works even with modals open; form-input focus is checked
// so typing a `/` in a text field doesn't pop the overlay.
(function wireControlsOverlay() {
  const hud  = document.getElementById('hud');
  const hint = document.getElementById('controls-hint');
  if (!hud) return;
  const setVisible = (v) => {
    hud.style.display  = v ? 'block' : 'none';
    if (hint) hint.style.display = v ? 'none' : 'block';
  };
  window.addEventListener('keydown', (ev) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    // Slash key fires `Slash` unshifted and also `?` shifted; match
    // on both so either works without the user having to hold Shift.
    if (ev.code !== 'Slash') return;
    ev.preventDefault();
    setVisible(hud.style.display === 'none');
  });
})();

// Dev key — Backquote toggles the per-system perf overlay. Off by
// default; tap once to start sampling, again to hide. Form inputs are
// guarded out by the input module's focus check so typing in a name
// field doesn't accidentally flip it.
window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'Backquote') return;
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  ev.preventDefault();
  _perf.toggle();
});

// Dev key — F3 dumps the current `tunables.lighting` block to the
// console in copy-paste-ready form so you can iterate on values in
// real time (e.g. `tunables.lighting.keyIntensity = 0.8` in the
// console → see effect immediately → hit F3 to snapshot the
// winning values for checking in).
window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'F3') return;
  ev.preventDefault();
  const L = tunables.lighting;
  const hex = (n) => '0x' + n.toString(16).padStart(6, '0');
  const text =
`lighting: {
  hemiSky:             ${hex(L.hemiSky)},
  hemiGround:          ${hex(L.hemiGround)},
  hemiIntensity:       ${L.hemiIntensity.toFixed(3)},
  keyColor:            ${hex(L.keyColor)},
  keyIntensity:        ${L.keyIntensity.toFixed(3)},
  fillColor:           ${hex(L.fillColor)},
  fillIntensity:       ${L.fillIntensity.toFixed(3)},
  rimColor:            ${hex(L.rimColor)},
  rimIntensity:        ${L.rimIntensity.toFixed(3)},
  fogColor:            ${hex(L.fogColor)},
  fogDensity:          ${L.fogDensity.toFixed(4)},
  playerAuraColor:     ${hex(L.playerAuraColor)},
  playerAuraIntensity: ${L.playerAuraIntensity.toFixed(3)},
  playerAuraDistance:  ${L.playerAuraDistance.toFixed(2)},
  playerAuraDecay:     ${L.playerAuraDecay.toFixed(2)},
},`;
  console.log('=== LIGHTING TUNABLES (F3) ===');
  console.log(text);
  console.log('=== END ===');
  transientHudMsg?.('lighting dump → console', 1.2);
});

// Apply `tunables.lighting` to the live light objects every frame so
// console edits take effect immediately. Colors are reassigned via
// `.setHex`; scalars go straight across. Player aura is looked up
// through `player.mesh.userData.auraLight`.
function syncLighting() {
  const L = tunables.lighting;
  if (hemiLight) {
    hemiLight.color.setHex(L.hemiSky);
    hemiLight.groundColor.setHex(L.hemiGround);
    hemiLight.intensity = L.hemiIntensity;
  }
  if (keyLight)  { keyLight.color.setHex(L.keyColor);   keyLight.intensity  = L.keyIntensity; }
  if (fillLight) { fillLight.color.setHex(L.fillColor); fillLight.intensity = L.fillIntensity; }
  if (rimLight)  { rimLight.color.setHex(L.rimColor);   rimLight.intensity  = L.rimIntensity; }
  if (scene.fog) {
    scene.fog.color.setHex(L.fogColor);
    scene.fog.density = L.fogDensity;
  }
  scene.background.setHex(L.fogColor);
  const aura = player?.mesh?.userData?.auraLight;
  if (aura) {
    aura.color.setHex(L.playerAuraColor);
    aura.intensity = L.playerAuraIntensity;
    aura.distance  = L.playerAuraDistance;
    aura.decay     = L.playerAuraDecay;
  }
}
const _yUp = new THREE.Vector3(0, 1, 0);
const _tmpDir2 = new THREE.Vector3();
const _tmpMid = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();

function updateBeamAndCone(playerInfo, aimInfo, inputState) {
  const w = currentWeapon();
  if (!w || w.type !== 'ranged' || !aimInfo.point) {
    laserMesh.visible = false;
    flashConeMesh.visible = false;
    return;
  }
  const eff = effectiveWeapon(w);
  const light = eff.lightAttachment;
  // Laser: any sideRail attachment tagged `kind: 'laser'`. Checks
  // the tag (not a hard-coded id) so the red / green / blue variants
  // all route through the same beam-rendering path; each variant
  // supplies its own `laserColor` + `laserRange`.
  const laserAtt = w.attachments?.sideRail;
  const laser = !!(laserAtt && laserAtt.kind === 'laser');
  const origin = playerInfo.muzzleWorld;
  _tmpDir2.set(aimInfo.point.x - origin.x, 0, aimInfo.point.z - origin.z);
  if (_tmpDir2.lengthSq() < 0.0001) {
    laserMesh.visible = false;
    flashConeMesh.visible = false;
    return;
  }
  const forward = _tmpDir2.clone().normalize();

  if (laser && lightsEnabled) {
    // Start length = variant's max range. Raycast against walls so
    // the beam stops at the first obstacle instead of punching
    // through geometry (sightline, obvious cover tell).
    const maxLen = laserAtt.laserRange || 12;
    const rayOrigin = origin.clone();
    rayOrigin.y = Math.max(rayOrigin.y, 1.05);   // shoulder height so floors don't clip
    _laserRay.set(rayOrigin, forward);
    _laserRay.far = maxLen;
    const hits = _laserRay.intersectObjects(level.solidObstacles?.() || level.obstacles || [], false);
    let len = maxLen;
    for (const h of hits) {
      if (h.object.userData?.isProp) continue;
      if (h.object.userData?.isDoor && h.object.userData?.isOpen) continue;
      if (h.distance > 0.2) { len = h.distance; break; }
    }
    _tmpMid.copy(origin).addScaledVector(forward, len / 2);
    _tmpQuat.setFromUnitVectors(_yUp, forward);
    laserMesh.position.copy(_tmpMid);
    laserMesh.quaternion.copy(_tmpQuat);
    laserMesh.scale.set(1, len, 1);
    // Push color + fade endpoints each frame so swapping variants
    // updates visuals immediately.
    laserMat.uniforms.uColor.value.setHex(laserAtt.laserColor || 0xff3030);
    // Longer beams fade faster (more visible dispersion over
    // distance) so the shorter red stays bright top-to-bottom while
    // the long blue fades more noticeably.
    laserMat.uniforms.uAlpha0.value = 0.95;
    laserMat.uniforms.uAlpha1.value = maxLen >= 20 ? 0.03 : maxLen >= 14 ? 0.06 : 0.12;
    laserMesh.visible = true;
  } else {
    laserMesh.visible = false;
  }

  if (light && light.lightCone && lightsEnabled) {
    const range = (light.lightCone.range || 9);
    const angleRad = ((light.lightCone.angleDeg || 40) * Math.PI) / 180;
    const baseR = Math.tan(angleRad * 0.5) * range;
    // Orient so cone apex (+Y) faces backward → cone base flares forward.
    _tmpQuat.setFromUnitVectors(_yUp, forward.clone().negate());
    _tmpMid.copy(origin).addScaledVector(forward, range / 2);
    flashConeMesh.position.copy(_tmpMid);
    flashConeMesh.quaternion.copy(_tmpQuat);
    flashConeMesh.scale.set(baseR, range, baseR);
    // Per-tier opacity + color. Kept low so the cone reads as soft
    // haze rather than a solid-painted shape — actual illumination
    // comes from the SpotLight below.
    const tier = light.lightTier;
    let opacity = 0.18;
    let color = 0xffe0a0;
    let intensity = 16.0;   // 2× bump across tiers per user request
    // Only basic / tactical draw the cone mesh — it reads as a soft
    // dust haze in the light. Strobe is pure rapid flash: the cone
    // primitive popping in and out at 10-22 Hz reads as a solid
    // flickering shape rather than light, so we drop the mesh and
    // let the SpotLight alone sell the strobe effect.
    let showCone = true;
    if (tier === 'tactical') {
      opacity = 0.22; color = 0xffe060; intensity = 22.0;
    } else if (tier === 'strobe') {
      color = 0xffffff;
      const t = performance.now() * 0.001;
      const freq = inputState.adsHeld ? 22 : 10;
      const pulse = Math.abs(Math.sin(t * freq));
      intensity = 6.0 + pulse * 28.0;
      showCone = false;
    } else if (tier === 'basic') {
      opacity = 0.18; intensity = 15.0;
    }
    flashConeMesh.material.color.setHex(color);
    flashConeMesh.material.opacity = opacity;
    flashConeMesh.visible = showCone;

    // SpotLight — sits at the muzzle, aimed at a point one step past
    // the cone tip so the light intersects the entire cone volume.
    flashSpot.visible = true;
    flashSpot.color.setHex(color);
    flashSpot.intensity = intensity;
    flashSpot.angle = angleRad * 0.55;
    flashSpot.distance = range * 1.15;
    flashSpot.position.copy(origin);
    flashSpot.target.position.copy(origin).addScaledVector(forward, range);
    flashSpot.target.updateMatrixWorld();
  } else {
    flashConeMesh.visible = false;
    flashSpot.visible = false;
    flashSpot.intensity = 0;
  }
}

let playerFireCooldown = 0;
let playerBurstRemaining = 0;
let playerBurstTimer = 0;
let playerMeleeCooldown = 0;
let exitCooldown = 0;  // small grace after regen before re-triggering exit
let lastAim = null;
let paused = false;    // true while a modal (skill pick) is open
let extractPending = false;

let derivedStats = BASE_STATS();
let lastHpRatio = 1;  // updated each tick for perks that need mid-callback HP

// --- Class capstone runtime state ---------------------------------------
// LMG Walking Fire — seconds the trigger has been held in the current
// burst. Spread is multiplied by max(0, 1 - decay * heldT). Reset when
// the player stops firing for `lmgSustainedResetT` seconds.
let _lmgHeldT = 0;
let _lmgIdleT = 0;
// Sniper Marked Target — accumulates while ADS-stationary on the same
// target. Resets on movement, ADS release, or target swap.
let _sniperHoldT = 0;
let _sniperHoldTarget = null;
let _sniperAimX = 0;
let _sniperAimZ = 0;
// Rifle Burst Concentration — consecutive full-auto hits on the same
// target stack crit-damage bonus.
let _rifleChainTarget = null;
let _rifleChainStacks = 0;
let _rifleChainLastT = 0;
// Exotic Cascade — corpse marks. Each entry is { x, z, untilMs }.
const _exoticChainMarks = [];
let gameClockMs = 0;   // active-gameplay clock for wall-clock timers
let playerMaxHealthCached = 100;
let secondWindUsed = 0;
let lastInventoryVersion = -1;
// All capstone effects are wired:
//   penetration → bullet path raycastAll iterates additional enemy hits
//   rifleAutoChain → consecutive-hit accumulator on rifle body crits
//   lmgSustainedSpreadDecay → _lmgHeldT modulates spread each shot
//   sniperAimRamp → _sniperHoldT × per-tick × cap added to sniper damage
//   exoticChainKill → corpse marks + chance roll on subsequent kills
//   shotgunShellsPerPump → divides reload duration in tryReload
//   adsSpeedMult → multiplies adsRate in player.update
function recomputeStats() {
  derivedStats = BASE_STATS();
  skills.applyTo(derivedStats);
  inventory.applyTo(derivedStats);
  specialPerks.applyTo(derivedStats);           // legacy (kept for compat)
  skillTree.applyTo(derivedStats, currentWeapon());
  artifacts.applyTo(derivedStats);
  buffs.applyTo(derivedStats);
  // Soft caps applied AFTER all sources roll up — prevents stack-stack
  // exploits flagged in the rebalance review (movespeed in particular
  // could pile to ~1.7×+ with artifact + Swift + class perks).
  if (derivedStats.moveSpeedMult > 1.7) derivedStats.moveSpeedMult = 1.7;
  // Melee damage multiplier ceiling — Reaper / Berserker / class-tree
  // stacks were producing ~2.8×. Cap at 2.5×.
  if (derivedStats.meleeDmgMult > 2.5) derivedStats.meleeDmgMult = 2.5;
}

// XP / level. Crossing threshold queues a mid-run skill pick.
let playerLevel = 1;
let playerXp = 0;
let pendingLevelUps = 0;
let playerCredits = 0;
let playerSkillPoints = 0;
// Keycard tokens held by the player. Reset per level. Shown as a
// small HUD badge strip; consumed by tryKeycardUnlock on interact.
let playerKeys = new Set();

// Persistent currency — "Contract Chips" are the meta-game reward
// for major-boss kills; saved to localStorage so they survive runs.
// HUD renders them next to credits. Not reset on death.
const PERSISTENT_KEY = 'tacticalrogue:persistentChips';
let persistentChips = (() => {
  try { return parseInt(localStorage.getItem(PERSISTENT_KEY) || '0', 10) || 0; }
  catch (_) { return 0; }
})();
function savePersistentChips() {
  try { localStorage.setItem(PERSISTENT_KEY, String(persistentChips)); }
  catch (_) { /* private mode / quota — fail silently */ }
}
function awardPersistentChips(amount) {
  if (!(amount > 0)) return;
  // Restart penalty — each death-restart shaves chip earnings for the
  // rest of the run. Three-tier schedule: 0 restarts → full, 1 → 75%,
  // 2 → 50%, 3+ → 33% floor. Resets on real run start (runStats.reset).
  const restarts = Math.max(0, runStats.restartCount | 0);
  const mult = Math.max(0.33, 1 - 0.25 * restarts);
  const paid = Math.max(1, Math.round(amount * mult));
  persistentChips += paid;
  savePersistentChips();
  const penaltyTag = restarts > 0 ? ` (−${Math.round((1 - mult) * 100)}% restart)` : '';
  transientHudMsg(`+${paid} CONTRACT CHIPS${penaltyTag}`, 3.0);
}

// Pick a random MYTHIC-tier weapon out of tunables and wrap it as an
// inventory item. Returns null if the pool is empty. Called from the
// major-boss loot roll in onEnemyKilled.
//
// Dragonbreath is deliberately rare — 8% of rolls when it's in the
// pool, so a full-run hunt is needed to get the panicking-flame
// shotgun.
function rollMythicDrop() {
  const pool = tunables.weapons.filter(w => w.rarity === 'mythic' && !w.artifact);
  if (!pool.length) return null;
  const dragon = pool.find(w => w.name === 'Dragonbreath');
  const others = pool.filter(w => w.name !== 'Dragonbreath');
  let pick;
  if (dragon && Math.random() < 0.08) {
    pick = dragon;
  } else if (others.length) {
    pick = others[Math.floor(Math.random() * others.length)];
  } else {
    pick = pool[0];
  }
  const item = wrapWeapon({ ...pick, rarity: 'mythic' });
  item.rarity = 'mythic';    // enforce in case wrapWeapon overrode with a roll
  return item;
}

// --- Game-feel state (hit-stop, camera shake) -----------------------
// Each effect gated by a user-facing tunable toggle (gameSettings
// below) so players on motion-sensitive setups can turn them off.
let hitStopT = 0;
let shakeT = 0;
let shakeMag = 0;
export const gameSettings = {
  hitStopEnabled: true,
  screenShakeEnabled: true,
  muzzleFlashEnabled: true,
};
function triggerHitStop(duration) {
  if (!gameSettings.hitStopEnabled) return;
  hitStopT = Math.max(hitStopT, duration);
}
function triggerShake(mag, duration = 0.22) {
  if (!gameSettings.screenShakeEnabled) return;
  shakeMag = Math.max(shakeMag, mag);
  shakeT = Math.max(shakeT, duration);
}
function xpToNextLevel() {
  return tunables.xp.level1Cost + (playerLevel - 1) * tunables.xp.perLevel;
}
function awardXp(amount) {
  playerXp += amount;
  while (playerXp >= xpToNextLevel()) {
    playerXp -= xpToNextLevel();
    playerLevel += 1;
    pendingLevelUps += 1;
  }
}
function awardKillXp(enemy) {
  const inGunmen = gunmen.gunmen.includes(enemy);
  awardXp(inGunmen ? tunables.xp.killValue.gunman : tunables.xp.killValue.melee);
}
function syncInventoryIfChanged() {
  if (inventory.version !== lastInventoryVersion) {
    lastInventoryVersion = inventory.version;
    onInventoryChanged();
    if (typeof renderActionBar === 'function') renderActionBar();
    if (typeof renderWeaponBar === 'function') renderWeaponBar();
  }
}
recomputeStats();

function jitterDirY(dir, spread) {
  if (spread <= 0) { _rotatedDir.copy(dir); return _rotatedDir; }
  const a = (Math.random() - 0.5) * 2 * spread;
  const c = Math.cos(a), s = Math.sin(a);
  _rotatedDir.set(dir.x * c - dir.z * s, dir.y, dir.x * s + dir.z * c);
  return _rotatedDir;
}

// Per-frame cache. `allHittables()` is called from every shot (often
// 9+ pellets per trigger pull) plus a handful of explosion and melee
// paths. Rebuilding the merged array each call was burning a
// measurable slice on shotgun volleys; caching it for the current
// frameCounter hands every caller the same (immutable) array.
let _hittablesCache = null;
let _hittablesFrame = -1;
function allHittables() {
  if (_hittablesFrame === frameCounter && _hittablesCache) return _hittablesCache;
  _hittablesCache = [...dummies.hittables(), ...gunmen.hittables(), ...melees.hittables()];
  _hittablesFrame = frameCounter;
  return _hittablesCache;
}

function resolveCollision(oldX, oldZ, newX, newZ, radius) {
  return level.resolveCollision(oldX, oldZ, newX, newZ, radius);
}

// Enemy movement resolver: walls first, then push away from the player so
// enemies can't overlap and flip the camera/aim.
function enemyResolveCollision(oldX, oldZ, newX, newZ, radius) {
  const wallRes = level.resolveCollision(oldX, oldZ, newX, newZ, radius);
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  const minDist = radius + (tunables.player.collisionRadius || 0.4);
  const dx = wallRes.x - px;
  const dz = wallRes.z - pz;
  const distSq = dx * dx + dz * dz;
  if (distSq >= minDist * minDist) return wallRes;
  // Overlapping — push outward along the connecting line.
  const dist = Math.sqrt(Math.max(0.0001, distSq));
  const pushX = px + (dx / dist) * minDist;
  const pushZ = pz + (dz / dist) * minDist;
  // Re-check walls so we don't push the enemy through geometry.
  return level.resolveCollision(oldX, oldZ, pushX, pushZ, radius);
}

function resolveAim(muzzleWorld) {
  if (!input.hasAim) return { point: null, zone: null, owner: null };
  input.raycaster.setFromCamera(input.mouseNDC, camera);

  // Aim prefers enemy hits: if the cursor's ray passes through an enemy
  // body part at any depth, resolve to that — even if a wall is in the
  // foreground. Otherwise fall back to whatever's closest (walls, etc.).
  //
  // Wall hit test uses `solidObstacles()` instead of the raw list so
  // unlocked doors (flattened to 0.08 scale, but still has geometry
  // near y=0.04) don't absorb the cursor ray and park the aim point
  // at floor level. Before this filter, aiming NEAR an open doorway
  // would dump every shot into the floor at the threshold.
  const enemyTargets = allHittables();
  const wallTargets = level.solidObstacles();
  const enemyHits = input.raycaster.intersectObjects(enemyTargets, false);
  if (enemyHits.length > 0) {
    const h = enemyHits[0];
    return {
      point: h.point.clone(),
      zone: h.object.userData?.zone || null,
      owner: h.object.userData?.owner || null,
    };
  }
  // Wall hits: keep the XZ direction (the wall the player meant to
  // target) but re-solve Y against the muzzle-height plane. Without
  // this, a cursor near a doorway edge or the bottom of the screen
  // lands on the wall's *floor-level* surface (Y ≈ 0) and the fire
  // path from chest → low-Y-point dumps every bullet into the floor
  // at the threshold. Using the wall's XZ + chest-height Y keeps the
  // shot straight forward at normal aim height.
  _muzzlePlane.constant = -muzzleWorld.y;
  const wallHits = input.raycaster.intersectObjects(wallTargets, false);
  if (wallHits.length > 0) {
    const h = wallHits[0];
    const planarPoint = new THREE.Vector3();
    if (input.raycaster.ray.intersectPlane(_muzzlePlane, planarPoint)) {
      // If the chest-plane intercept is FURTHER than the wall hit,
      // the wall is the real stop — use the wall point but lifted to
      // chest Y so we don't aim into the floor.
      const wallDist = h.point.distanceTo(muzzleWorld);
      const planarDist = planarPoint.distanceTo(muzzleWorld);
      const lifted = new THREE.Vector3(h.point.x, muzzleWorld.y, h.point.z);
      // Prefer the planar point when the wall is far (cursor aimed
      // past open space); prefer the lifted wall point when the wall
      // is close (cursor aimed at a specific wall surface).
      return {
        point: planarDist < wallDist ? planarPoint : lifted,
        zone: h.object.userData?.zone || null,
        owner: h.object.userData?.owner || null,
      };
    }
    return {
      point: new THREE.Vector3(h.point.x, muzzleWorld.y, h.point.z),
      zone: h.object.userData?.zone || null,
      owner: h.object.userData?.owner || null,
    };
  }
  const flat = new THREE.Vector3();
  if (input.raycaster.ray.intersectPlane(_muzzlePlane, flat)) {
    return { point: flat, zone: null, owner: null };
  }
  return { point: null, zone: null, owner: null };
}

// If the equipped weapon has a light/strobe attachment, sweep a cone from the
// player toward the cursor and apply blind / dazzle timers to enemies caught
// in it. Runs regardless of whether the trigger is held.
const _lightDir = new THREE.Vector3();
function tickLight(playerInfo, aimInfo) {
  const w = currentWeapon();
  if (!w || !aimInfo.point) return;
  const eff = effectiveWeapon(w);
  const lightAtt = eff.lightAttachment;
  if (!lightAtt || !lightAtt.lightTier) return;
  if (lightAtt.lightTier === 'basic') return; // no combat effect

  const origin = playerInfo.muzzleWorld;
  _lightDir.set(aimInfo.point.x - origin.x, 0, aimInfo.point.z - origin.z);
  if (_lightDir.lengthSq() < 0.0001) return;
  _lightDir.normalize();

  const range = lightAtt.lightCone?.range ?? 9;
  const angleRad = (lightAtt.lightCone?.angleDeg ?? 40) * Math.PI / 180;
  const halfCos = Math.cos(angleRad * 0.5);

  const apply = (enemy) => {
    const dx = enemy.group.position.x - origin.x;
    const dz = enemy.group.position.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > range) return;
    const nx = dx / Math.max(0.0001, d);
    const nz = dz / Math.max(0.0001, d);
    if (nx * _lightDir.x + nz * _lightDir.z < halfCos) return;
    enemy.blindT = Math.max(enemy.blindT || 0, lightAtt.blindDuration || 1.2);
    if (lightAtt.lightTier === 'strobe') {
      enemy.dazzleT = Math.max(enemy.dazzleT || 0, lightAtt.dazzleDuration || 0.8);
    }
  };
  for (const g of gunmen.gunmen) if (g.alive) apply(g);
  for (const e of melees.enemies) if (e.alive) apply(e);
}

function tickFlame(dt, playerInfo, weapon, inputState, aimInfo) {
  if (weapon.flameTickT === undefined) weapon.flameTickT = 0;
  weapon.flameTickT = Math.max(0, weapon.flameTickT - dt);
  const wantsFire = inputState.attackHeld && aimInfo.point;
  if (!wantsFire) return;
  if (weapon.reloadingT > 0) return;
  if (weapon.ammo <= 0) { tryReload(weapon); return; }
  if (weapon.flameTickT > 0) return;

  const tickInterval = 1 / Math.max(1, weapon.flameTickRate || 12);
  weapon.flameTickT = tickInterval;

  weapon.ammo -= 1;
  if (weapon.durability) {
    weapon.durability.current = Math.max(
      0, weapon.durability.current - tunables.durability.weaponDecayPerShot * 0.4,
    );
  }

  // Cone-direction toward cursor (XZ).
  const origin = playerInfo.muzzleWorld.clone();
  const dir = new THREE.Vector3(
    aimInfo.point.x - origin.x, 0, aimInfo.point.z - origin.z,
  );
  if (dir.lengthSq() < 0.0001) return;
  dir.normalize();

  const range = weapon.range * (derivedStats.rangeMult || 1);
  const angleRad = (weapon.flameAngleDeg ?? 35) * Math.PI / 180;
  const halfCos = Math.cos(angleRad * 0.5);
  const baseDmg = weapon.damage * derivedStats.rangedDmgMult;

  // Hit cone: any alive enemy whose direction lies within angle and within range.
  const candidates = [];
  for (const g of gunmen.gunmen) if (g.alive) candidates.push(g);
  for (const e of melees.enemies) if (e.alive) candidates.push(e);

  for (const c of candidates) {
    const dx = c.group.position.x - origin.x;
    const dz = c.group.position.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    const nx = dx / Math.max(0.0001, d);
    const nz = dz / Math.max(0.0001, d);
    if (nx * dir.x + nz * dir.z < halfCos) continue;
    const wasAlive = c.alive;
    runStats.addDamage(baseDmg);
    c.manager.applyHit(c, baseDmg, 'torso', dir, { weaponClass: 'melee' });
    c.burnT = Math.max(c.burnT || 0, tunables.burn.duration * (derivedStats.burnDurationBonus || 1));
    if (wasAlive && !c.alive) {
      onEnemyKilled(c);
      awardClassXp('melee', c.tier);
      if (skillTree.level('bloodlust') > 0) buffs.grant('bloodlust', { moveSpeedMult: 1.55 }, 4);
    }
  }

  combat.spawnFlameParticles(origin, dir, range, angleRad);
}

function tryReload(weapon) {
  if (!weapon || weapon.type !== 'ranged') return;
  const eff = effectiveWeapon(weapon);
  if (typeof eff.magSize !== 'number') return;
  if (weapon.ammo >= eff.magSize) return;
  if (weapon.reloadingT > 0) return;
  const mult = derivedStats.reloadSpeedMult || 1;
  // Shotgun Quad Load — reload time scales with shells-per-pump on top
  // of the regular reload-speed mult. shellsPerPump=4 ⇒ extra 4× faster
  // tube loading on top of the +50% mastery bonus, matching the
  // "quad-load" silhouette where every pump shoves four shells in.
  const sppBoost = (weapon.class === 'shotgun' && (derivedStats.shotgunShellsPerPump || 1) > 1)
    ? derivedStats.shotgunShellsPerPump : 1;
  const duration = (eff.reloadTime || 1.5) / (mult * sppBoost);
  weapon.reloadingT = duration;
  // Completion target is on the PAUSE-AWARE game clock so frame-rate
  // dips and the physics dt clamp can't stretch a 1.4s reload into 6s,
  // AND pausing the game (inventory/shop/etc.) pauses the reload too.
  weapon.reloadEndsAt = gameClockMs + duration * 1000;
}
function tickWeaponReload(weapon) {
  if (!weapon || weapon.type !== 'ranged') return;
  if (weapon.reloadingT <= 0) return;
  // If reloadEndsAt wasn't set (legacy state, loaded save, or a bug
  // path that only set reloadingT), reconcile: set it to the tick
  // time plus the remaining reloadingT so the timer makes forward
  // progress from here. Without this a weapon with reloadingT > 0 and
  // reloadEndsAt == 0 would hang forever.
  if (!weapon.reloadEndsAt) {
    weapon.reloadEndsAt = gameClockMs + Math.max(0, weapon.reloadingT) * 1000;
  }
  // Safety clamp: a stale reloadEndsAt from a prior session (page
  // reload starts gameClockMs at 0) can make remainMs absurdly large
  // and feel like a broken reload. If the remaining time exceeds 2x
  // the weapon's declared reloadTime, treat it as a stale handle and
  // re-anchor from NOW.
  const eff = effectiveWeapon(weapon);
  const mult = derivedStats.reloadSpeedMult || 1;
  const sppBoost = (weapon.class === 'shotgun' && (derivedStats.shotgunShellsPerPump || 1) > 1)
    ? derivedStats.shotgunShellsPerPump : 1;
  const saneMs = ((eff.reloadTime || 1.5) / (mult * sppBoost)) * 1000 * 2;
  const remainMsRaw = weapon.reloadEndsAt - gameClockMs;
  if (remainMsRaw > saneMs) {
    weapon.reloadEndsAt = gameClockMs + Math.max(0, weapon.reloadingT) * 1000;
  }
  const remainMs = weapon.reloadEndsAt - gameClockMs;
  if (remainMs <= 0) {
    weapon.reloadingT = 0;
    weapon.reloadEndsAt = 0;
    const magBonus = derivedStats.magSizeMult || 1;
    weapon.ammo = Math.round(eff.magSize * magBonus);
  } else {
    weapon.reloadingT = remainMs / 1000;
  }
}

// Launch a ballistic projectile from the player's muzzle toward the
// aim point. Weapon spec reads:
//   projectile:      'grenade' | 'rocket' | 'throwable'
//   projectileSpeed: muzzle velocity in m/s (default 28)
//   projectileGrav:  gravity (default 9.8; 0 for rockets)
//   projectileFuse:  seconds before auto-detonate (default 2.5)
//   projectileBounce: 0..1 bounciness (grenades only)
//   aoeRadius, aoeDamage, aoeShake
function firePlayerProjectile(playerInfo, weapon, aimPoint) {
  if (typeof weapon.ammo === 'number' && !weapon.infiniteAmmo) weapon.ammo -= 1;
  sfx.fire(weapon.class || 'shotgun');
  alertEnemiesFromShot(playerInfo.muzzleWorld);
  if (player.kickRecoil) player.kickRecoil();
  triggerShake(0.28, 0.22);
  if (weapon.durability) {
    weapon.durability.current = Math.max(
      0, weapon.durability.current - tunables.durability.weaponDecayPerShot,
    );
  }

  const muzzle = playerInfo.muzzleWorld.clone();
  const speed = weapon.projectileSpeed ?? 28;
  const gravity = weapon.projectileGrav ?? 9.8;
  const vel = gravity > 0
    ? ProjectileManager.ballisticVelocity(muzzle, aimPoint, speed, gravity)
    : (() => {
        // Rockets fly straight AND level. We zero the Y component of
        // the aim vector so the rocket travels parallel to the floor
        // regardless of whether the cursor landed on an enemy's head
        // or an aim-point slightly above/below muzzle height. Prior
        // behaviour let a cursor on a distant wall or a raised target
        // arc the rocket up over cover.
        const v = new THREE.Vector3(
          aimPoint.x - muzzle.x, 0, aimPoint.z - muzzle.z,
        );
        if (v.lengthSq() < 0.0001) v.set(0, 0, 1);
        v.normalize().multiplyScalar(speed);
        return v;
      })();

  const effRanged = effectiveWeapon(weapon);
  const aoeDmgMult = derivedStats.rangedDmgMult || 1;
  projectiles.spawn({
    pos: muzzle,
    vel,
    type: weapon.projectile || 'grenade',
    color: effRanged.tracerColor || 0xffa040,
    // Slim projectile body — the old 0.18m sphere read as a beach
    // ball. Weapons can still override via `projectileRadius` in
    // their def if a specific gun needs a chunkier round.
    radius: weapon.projectileRadius ?? 0.09,
    gravity,
    lifetime: weapon.projectileFuse ?? (gravity > 0 ? 2.5 : 4.5),
    bounciness: weapon.projectileBounce ?? (gravity > 0 ? 0.35 : 0),
    owner: 'player',
    explosion: {
      radius: weapon.aoeRadius ?? 5.0,
      damage: (weapon.aoeDamage ?? effRanged.damage) * aoeDmgMult,
      shake: weapon.aoeShake ?? 0.55,
    },
  });
}

function fireOneShot(playerInfo, weapon, aimPoint, isADS) {
  if (typeof weapon.ammo === 'number' && weapon.ammo <= 0 && !weapon.infiniteAmmo) {
    sfx.empty();
    tryReload(weapon);
    return;
  }
  if (weapon.reloadingT > 0) return;

  // Projectile weapons (grenade launcher, rocket launcher, frag
  // thrower) spawn a ballistic round instead of an instant hitscan
  // tracer — routes through the projectile manager.
  if (weapon.fireMode === 'projectile') {
    firePlayerProjectile(playerInfo, weapon, aimPoint);
    return;
  }

  // Attachment-adjusted stats for damage / spread / range; ammo + reload state
  // stay on the live weapon.
  const eff = effectiveWeapon(weapon);

  // The *tracer* draws from the visible muzzle (wherever the hand
  // happens to be), but the *bullet physics* fires from a stable
  // chest-height virtual origin so crouching / low-hand poses don't
  // dunk every shot into the floor. Direction points from that stable
  // origin to the cursor target, letting us keep accurate vertical
  // aim (up at a standing enemy, down at a cursor on the floor).
  const fireFrom = playerInfo.fireOrigin || playerInfo.muzzleWorld;
  const tracerFrom = playerInfo.muzzleWorld;
  _tmpDir.copy(aimPoint).sub(fireFrom);
  if (_tmpDir.lengthSq() < 0.0001) return;
  _tmpDir.normalize();

  const baseSpread = isADS
    ? eff.adsSpread * (derivedStats.adsSpreadOnlyMult || 1)
    : eff.hipSpread * (derivedStats.hipSpreadOnlyMult || 1);
  const crouched = inputStateCrouchHeld();
  const crouchSpreadK = crouched ? (derivedStats.crouchSpreadMult ?? 1) : 1;
  let spread = baseSpread * derivedStats.rangedSpreadMult * crouchSpreadK;
  // LMG Walking Fire — sustained-fire spread bleed. While holding the
  // trigger, multiply spread by max(0, 1 - decay * heldT). Decay tracked
  // per-frame in the tick (see _lmgHeldT update). Capped at zero so the
  // LMG locks onto a single point after enough sustained fire.
  if (weapon.class === 'lmg' && (derivedStats.lmgSustainedSpreadDecay || 0) > 0) {
    const k = Math.max(0, 1 - derivedStats.lmgSustainedSpreadDecay * _lmgHeldT);
    spread *= k;
  }
  const pellets = Math.max(1, (eff.pelletCount | 0) + (derivedStats.pelletCountBonus || 0));
  const effRange = eff.range * (derivedStats.rangeMult || 1);
  // Exclude unlocked doors — their flattened mesh still intersects
  // raycasts otherwise, so bullets would invisibly hit the doorway.
  const hitTargets = [...allHittables(), ...level.solidObstacles()];

  if (typeof weapon.ammo === 'number' && !weapon.infiniteAmmo) weapon.ammo -= 1;
  sfx.fire(weapon.class || 'pistol');
  alertEnemiesFromShot(tracerFrom);
  // Player recoil spring — animation layer reads this via the rig's
  // recoilT and kicks the weapon arm back for ~0.18s.
  if (player.kickRecoil) player.kickRecoil();
  // Screen shake — scales by weapon class so a shotgun bangs harder
  // than a pistol. No hit-stop on vanilla shots (reserved for kills).
  const shakeByClass = weapon.class === 'shotgun' ? 0.22
                     : weapon.class === 'lmg'     ? 0.14
                     : weapon.class === 'rifle'   ? 0.10
                     : weapon.class === 'sniper'  ? 0.28
                     : weapon.class === 'flame'   ? 0.05
                     : 0.08;                  // pistol / smg / default
  triggerShake(shakeByClass, 0.18);
  if (weapon.durability) {
    weapon.durability.current = Math.max(
      0, weapon.durability.current - tunables.durability.weaponDecayPerShot,
    );
  }

  // Aggregate per-target VFX/audio so a shotgun volley across a
  // crowd spawns one blood burst / damage number / hit sfx per
  // *target*, not per pellet. 9 pellets × 5 targets was emitting
  // ~450 particles + 45 DOM nodes + 45 audio nodes in a single
  // frame and stalling the browser (most noticeable on Dragonbreath).
  const hitAgg = new Map();

  // Muzzle flash fires ONCE per volley, not per pellet. Prior version
  // emitted 9 overlapping flash spheres (and, when enabled, 9 point
  // lights at the same position) for a Dragonbreath trigger pull,
  // which dropped frames hard. The tracer per pellet is fine — they
  // diverge, so the visual still reads as multiple shots.
  combat.spawnFlash(tracerFrom, eff.tracerColor, qualityFlags.muzzleLights);

  for (let i = 0; i < pellets; i++) {
    const dir = jitterDirY(_tmpDir, spread).clone();
    const hit = combat.raycast(fireFrom, dir, hitTargets, effRange);
    const endPoint = hit
      ? hit.point
      : fireFrom.clone().addScaledVector(dir, effRange);
    if (window.__debug?.traceShots && hit) {
      const m = hit.mesh || hit.object;
      const ud = m?.userData || {};
      // Pull enough shape to identify wall vs door vs prop vs elevator
      // panel. `connects` / `isDoor` / `unlocked` pinpoint a doorway
      // mesh; `isProp` / `propKind` narrow down a furniture mesh.
      console.log('[shot hit]', {
        pos: [hit.point.x.toFixed(2), hit.point.y.toFixed(2), hit.point.z.toFixed(2)],
        zone: hit.zone,
        isDoor: !!ud.isDoor,
        unlocked: ud.unlocked,
        keyRequired: ud.keyRequired,
        isProp: !!ud.isProp,
        propKind: ud.propKind,
        meshName: m?.name,
        mesh: m,
      });
    }
    // Tracer per pellet (each diverges), flash was already spawned
    // once before the loop so we pass flash:false here.
    combat.spawnShot(tracerFrom, endPoint, eff.tracerColor,
      { light: qualityFlags.muzzleLights, flash: false });

    if (hit && hit.owner && hit.owner.manager) {
      const zoneCfg = tunables.zones[hit.zone];
      let mult = zoneCfg ? zoneCfg.damageMult : 1.0;
      if (hit.zone === 'head') {
        mult += (derivedStats.headMultBonus || 0) + (weapon.headBonus || 0);
      }
      let dmg = eff.damage * mult * derivedStats.rangedDmgMult;
      if (crouched) dmg *= (derivedStats.crouchDmgMult || 1);
      // Point Blank: close-range damage bonus.
      if ((derivedStats.pointBlankBonus || 0) > 0) {
        const ddx = hit.point.x - fireFrom.x;
        const ddz = hit.point.z - fireFrom.z;
        if (Math.hypot(ddx, ddz) <= 6) {
          dmg *= 1 + derivedStats.pointBlankBonus;
        }
      }
      // Sniper Marked Target — every `sniperAimTickT` seconds of
      // stationary aim adds `sniperAimRampPerTick` to the damage
      // multiplier, capped at `sniperAimRampCap`. Tick state is
      // updated each frame in the gameplay tick.
      if (weapon.class === 'sniper' && (derivedStats.sniperAimRampPerTick || 0) > 0) {
        const tickT = Math.max(0.05, derivedStats.sniperAimTickT || 0.25);
        const stacks = Math.floor(_sniperHoldT / tickT);
        if (stacks > 0) {
          const ramp = Math.min(derivedStats.sniperAimRampCap || 0,
                                stacks * derivedStats.sniperAimRampPerTick);
          dmg *= 1 + ramp;
        }
      }
      // Sniper One Shot — extra damage on full-HP targets.
      if (weapon.class === 'sniper' && (derivedStats.fullHpDmgBonus || 0) > 0) {
        const maxHp = hit.owner.maxHp ?? hit.owner.hp ?? 0;
        if (hit.owner.hp >= maxHp - 0.5) {
          dmg *= 1 + derivedStats.fullHpDmgBonus;
        }
      }
      // Crit roll. Rifle body-crit ladder adds chance/damage ONLY on
      // non-headshots, keeping the headshot identity unique to snipers
      // and pistols and giving rifles their own body-crit-chain niche.
      let critChance = derivedStats.critChance || 0;
      if (hit.zone !== 'head') critChance += (derivedStats.bodyCritChanceBonus || 0);
      const crit = Math.random() < critChance;
      if (crit) {
        let critMult = derivedStats.critDamageMult || 2;
        if (hit.zone !== 'head') critMult += (derivedStats.bodyCritDamageBonus || 0);
        // Rifle Burst Concentration — full-auto chain stack accumulates
        // crit damage on the same target. Tracker advances on every
        // hit (crit or not); the stack only multiplies crit damage.
        if (weapon.class === 'rifle' && (derivedStats.rifleAutoChainPerHit || 0) > 0) {
          const nowT = gameClockMs / 1000;
          const resetT = Math.max(0.1, derivedStats.rifleAutoChainResetT || 1.5);
          if (_rifleChainTarget === hit.owner && (nowT - _rifleChainLastT) <= resetT) {
            _rifleChainStacks++;
          } else {
            _rifleChainTarget = hit.owner;
            _rifleChainStacks = 1;
          }
          _rifleChainLastT = nowT;
          const bonus = Math.min(derivedStats.rifleAutoChainCap || 0,
                                 (_rifleChainStacks - 1) * derivedStats.rifleAutoChainPerHit);
          critMult += bonus;
        }
        dmg *= critMult;
      } else if (weapon.class === 'rifle' && (derivedStats.rifleAutoChainPerHit || 0) > 0) {
        // Non-crit hits still advance the rifle chain so a streak of
        // body shots followed by a crit lands the full bonus. Same
        // timer-window rules as above.
        const nowT = gameClockMs / 1000;
        const resetT = Math.max(0.1, derivedStats.rifleAutoChainResetT || 1.5);
        if (_rifleChainTarget === hit.owner && (nowT - _rifleChainLastT) <= resetT) {
          _rifleChainStacks++;
        } else {
          _rifleChainTarget = hit.owner;
          _rifleChainStacks = 1;
        }
        _rifleChainLastT = nowT;
      }
      if (playerInfo && playerInfo.health / playerInfo.maxHealth < 0.5
        && derivedStats.berserkBonus > 0) {
        dmg *= 1 + derivedStats.berserkBonus;
      }
      // Golden Bullet — flat chance to one-shot non-boss targets.
      if ((derivedStats.goldenBulletChance || 0) > 0
          && hit.owner.tier !== 'boss'
          && Math.random() < derivedStats.goldenBulletChance) {
        dmg = Math.max(dmg, (hit.owner.hp || 1) + 1);
      }
      const wasAlive = hit.owner.alive;
      runStats.addDamage(dmg);
      const result = hit.owner.manager.applyHit(hit.owner, dmg, hit.zone, dir, { weaponClass: weapon.class });
      for (const drop of result.drops) loot.spawnItem(drop.position, wrapWeapon(drop.weapon));
      // Dragonbreath / other igniteOnHit weapons — set normal-tier
      // enemies ablaze + panicking. Sub-bosses and bosses only take
      // burn DoT without the panic flag (they keep attacking).
      if (weapon.igniteOnHit && hit.owner.alive) {
        const burnBonus = derivedStats.burnDurationBonus || 1;
        hit.owner.burnT = Math.max(hit.owner.burnT || 0,
          (tunables.burn?.duration || 5) * burnBonus * 1.5);
        if (hit.owner.tier === 'normal' || !hit.owner.tier) {
          hit.owner.panicT = Math.max(hit.owner.panicT || 0, 4.0);
        }
      }
      // Sleep-dart weapon — silent knock-out on normal tier.
      if (weapon.sleepOnHit && hit.owner.alive
          && (hit.owner.tier === 'normal' || !hit.owner.tier)) {
        hit.owner.forceSleep = true;
      }
      // Shock on crit — briefly dazzle the target (blurs their aim via dazzleT).
      if (crit && (derivedStats.shockOnCrit || 0) > 0 && hit.owner.alive) {
        hit.owner.dazzleT = Math.max(hit.owner.dazzleT || 0, derivedStats.shockOnCrit);
      }
      if (wasAlive && !hit.owner.alive) {
        onEnemyKilled(hit.owner);
        awardClassXp(weapon.class, hit.owner.tier);
        if (hit.zone === 'head' && weaponHasArtifactPerk(weapon, 'popperHead')) {
          popHead(hit.owner, dir);
        }
        // Reload-on-kill — partially refill the current mag.
        if ((derivedStats.reloadOnKill || 0) > 0
            && typeof weapon.ammo === 'number'
            && weapon.ammo < eff.magSize) {
          const add = Math.max(1, Math.round(eff.magSize * derivedStats.reloadOnKill));
          weapon.ammo = Math.min(eff.magSize, weapon.ammo + add);
        }
        // Reaper — heal a chunk of missing HP on kill.
        if ((derivedStats.fatalToFullHealMissing || 0) > 0 && playerInfo) {
          const missing = playerInfo.maxHealth - playerInfo.health;
          if (missing > 0) player.heal(missing * derivedStats.fatalToFullHealMissing);
        }
        // Final Blast — kill explosion.
        if ((derivedStats.explodeOnKillChance || 0) > 0
            && Math.random() < derivedStats.explodeOnKillChance) {
          spawnKillBlast(hit.owner.group.position, derivedStats.explodeOnKillRadius, derivedStats.explodeOnKillDmg);
        }
      }
      // Headhunter: refund one round per headshot if the weapon has the perk.
      if (hit.zone === 'head' && weaponHasPerk(weapon, 'headhunter')
        && typeof weapon.ammo === 'number' && weapon.ammo < eff.magSize) {
        weapon.ammo = Math.min(eff.magSize, weapon.ammo + 1);
      }
      // Scavenged Rounds — chance-based ammo refund on any body hit.
      if ((derivedStats.ammoOnHitChance || 0) > 0
          && typeof weapon.ammo === 'number' && weapon.ammo < eff.magSize
          && Math.random() < derivedStats.ammoOnHitChance) {
        weapon.ammo = Math.min(eff.magSize, weapon.ammo + 1);
      }
      // Vampiric Aim — headshot heal.
      if (hit.zone === 'head' && (derivedStats.headshotHeal || 0) > 0) {
        player.heal(derivedStats.headshotHeal);
      }
      let agg = hitAgg.get(hit.owner);
      if (!agg) {
        agg = { totalDmg: 0, hadHead: false, point: hit.point.clone(), dir: dir.clone(), zone: hit.zone || 'torso' };
        hitAgg.set(hit.owner, agg);
      }
      agg.totalDmg += dmg;
      if (hit.zone === 'head') { agg.hadHead = true; agg.zone = 'head'; }
      agg.point.copy(hit.point);
      // Ricochet — roll to bounce a second/third round to another nearby enemy.
      if ((derivedStats.ricochetCount || 0) > 0
          && Math.random() < (derivedStats.ricochetChance || 0)) {
        spawnRicochet(hit.point, hit.owner, dmg * 0.6, derivedStats.ricochetCount, weapon);
      }
      // Sniper Penetrator — bullet pierces N enemies before stopping.
      // Re-resolves the same ray against every hittable, then deals
      // damage to additional enemy intersections in order until either
      // a wall is reached or the penetration budget runs out. Damage
      // falls off per pierce so a 2-pierce shot doesn't 3x damage.
      if (weapon.class === 'sniper' && (derivedStats.penetration || 0) > 0) {
        const allHits = combat.raycastAll(fireFrom, dir, hitTargets, effRange);
        const cap = derivedStats.penetration | 0;
        let pierced = 0;
        const baseDmg = eff.damage * derivedStats.rangedDmgMult;
        for (const ph of allHits) {
          if (pierced >= cap) break;
          if (ph.owner === hit.owner) continue;        // already handled
          if (!ph.owner || !ph.owner.manager) break;   // wall — bullet stops
          const falloff = pierced === 0 ? 0.7 : 0.5;
          const pdmg = baseDmg * falloff;
          const wasAlivePh = ph.owner.alive;
          runStats.addDamage(pdmg);
          ph.owner.manager.applyHit(ph.owner, pdmg, ph.zone, dir, { weaponClass: weapon.class });
          if (wasAlivePh && !ph.owner.alive) {
            onEnemyKilled(ph.owner);
            awardClassXp(weapon.class, ph.owner.tier);
          }
          // Visual feedback at the pierce point.
          let pa = hitAgg.get(ph.owner);
          if (!pa) {
            pa = { totalDmg: 0, hadHead: false, point: ph.point.clone(), dir: dir.clone(), zone: ph.zone || 'torso' };
            hitAgg.set(ph.owner, pa);
          }
          pa.totalDmg += pdmg;
          pierced++;
        }
      }
    } else if (hit) {
      combat.spawnImpact(hit.point);
    }
  }

  // Flush aggregated target effects. One blood burst + one floating
  // damage number + at most one hit sfx per shot, head-priority.
  let anyHead = false;
  for (const agg of hitAgg.values()) {
    const burstAmount = agg.hadHead ? 10 : 5;
    combat.spawnBloodBurst(agg.point, agg.dir, burstAmount);
    spawnDamageNumber(agg.point, camera, agg.totalDmg, agg.zone);
    if (agg.hadHead) anyHead = true;
  }
  if (hitAgg.size > 0) {
    if (anyHead) sfx.headshot(); else sfx.hit();
  }
}

function tickShooting(dt, playerInfo, inputState, aimInfo) {
  // Reload timers tick for EVERY weapon the player has rotated in, not
  // only the active one. Otherwise swapping away from a reloading gun
  // freezes its timer — the reload appears to take much longer than the
  // tooltip claims because it's actually paused while holstered.
  for (const w of inventory.getWeaponRotation()) {
    if (w && w.type === 'ranged') tickWeaponReload(w);
  }

  const weapon = currentWeapon();
  if (!weapon) return;
  if (weapon.type === 'melee') return;
  if (weapon.fireMode === 'flame') { tickFlame(dt, playerInfo, weapon, inputState, aimInfo); return; }
  playerFireCooldown = Math.max(0, playerFireCooldown - dt);
  playerBurstTimer = Math.max(0, playerBurstTimer - dt);
  // Gun-held quick melee locks out firing while the swing is in
  // startup / active / recovery — you shouldn't be able to pistol-
  // whip and pull the trigger on the same frame. Recovery ends into
  // 'window' phase, which allows shooting again (fast follow-up).
  const phase = playerInfo?.attackPhase;
  if (phase === 'startup' || phase === 'active' || phase === 'recovery') return;

  const eff = effectiveWeapon(weapon);

  if (playerBurstRemaining > 0 && playerBurstTimer <= 0 && aimInfo.point) {
    fireOneShot(playerInfo, weapon, aimInfo.point, inputState.adsHeld);
    playerBurstRemaining -= 1;
    playerBurstTimer = eff.burstInterval || 0.07;
    return;
  }
  if (playerBurstRemaining > 0) return;
  if (playerFireCooldown > 0) return;
  if (!aimInfo.point) return;

  const wantsNew = weapon.fireMode === 'auto'
    ? inputState.attackHeld
    : inputState.attackPressed;
  if (!wantsNew) return;

  fireOneShot(playerInfo, weapon, aimInfo.point, inputState.adsHeld);

  if (weapon.fireMode === 'burst' && (eff.burstCount | 0) > 1) {
    playerBurstRemaining = (eff.burstCount | 0) - 1;
    playerBurstTimer = eff.burstInterval || 0.07;
  }
  let rateMult = derivedStats.fireRateMult || 1;
  // Adrenal Rush — fire rate buff when low on health.
  if ((derivedStats.adrenalOnLowHp || 0) > 0 && lastHpRatio < 0.35) {
    rateMult *= 1 + derivedStats.adrenalOnLowHp;
  }
  playerFireCooldown = 1 / Math.max(0.1, eff.fireRate * rateMult);
}

function tryStartCombo(inputState, aimInfo) {
  const weapon = currentWeapon();
  if (!weapon) return;
  if (weapon.type !== 'melee') return;
  if (!inputState.attackPressed) return;

  // LMB while blocking → parry attempt (opens a short redirect window).
  if (player.isBlocking()) {
    player.tryParry();
    return;
  }

  if (!aimInfo.point) return;
  const dx = aimInfo.point.x - player.mesh.position.x;
  const dz = aimInfo.point.z - player.mesh.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.0001) return;
  const facing = new THREE.Vector3(dx / dist, 0, dz / dist);
  player.tryMeleeAttack(weapon, dist, facing);
}

// Pistol-whip / rifle-butt off a gun. Must run BEFORE player.update
// so the attack state is already in 'startup' when this frame's
// `playerInfo` is built — otherwise `tickShooting` sees a stale
// 'idle' phase and fires through the swing, and `swingProgress` is 0
// for the full frame so no arm animation appears.
function tryStartQuickMelee(inputState, aimInfo) {
  if (!inputState.meleePressed) return;
  const weapon = currentWeapon();
  if (!weapon || weapon.type !== 'ranged') return;
  if (!aimInfo.point) return;
  const dx = aimInfo.point.x - player.mesh.position.x;
  const dz = aimInfo.point.z - player.mesh.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.0001) return;
  const facing = new THREE.Vector3(dx / d, 0, dz / d);
  player.tryQuickMelee?.(weapon, facing);
}

// Called when the player's current combo step enters its `active` phase.
function resolveComboHit(attackEvent) {
  const { attack, origin, facing, isCrit } = attackEvent;
  const angleRad = (attack.angleDeg * Math.PI) / 180;
  const halfCos = Math.cos(angleRad * 0.5);

  const candidates = [];
  for (const g of gunmen.gunmen) if (g.alive) candidates.push(g);
  for (const e of melees.enemies) if (e.alive) candidates.push(e);

  candidates.sort((a, b) => {
    const da = Math.hypot(a.group.position.x - origin.x, a.group.position.z - origin.z);
    const db = Math.hypot(b.group.position.x - origin.x, b.group.position.z - origin.z);
    return da - db;
  });

  for (const c of candidates) {
    const dx = c.group.position.x - origin.x;
    const dz = c.group.position.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > attack.range) continue;
    const nx = dx / Math.max(0.0001, d);
    const nz = dz / Math.max(0.0001, d);
    if (nx * facing.x + nz * facing.z < halfCos) continue;

    const strikePoint = new THREE.Vector3(c.group.position.x, 1.2, c.group.position.z);
    let dmg = attack.damage * derivedStats.meleeDmgMult * berserkMult();
    // Crit was rolled at swing-start so the whole animation commits
    // to it. Apply the multiplier now at hit-resolve time.
    if (isCrit) dmg *= (derivedStats.critDamageMult || 2.0);
    const wasAlive = c.alive;
    runStats.addDamage(dmg);
    c.manager.applyHit(c, dmg, 'torso', facing, { weaponClass: 'melee', isCrit });
    c.manager.applyKnockback?.(c, {
      x: facing.x * (attack.knockback || 0) * derivedStats.knockbackMult,
      z: facing.z * (attack.knockback || 0) * derivedStats.knockbackMult,
    });
    combat.spawnImpact(strikePoint);
    spawnDamageNumber(strikePoint, camera, dmg, 'torso');
    if (derivedStats.lifestealMeleePercent > 0) {
      player.heal(dmg * derivedStats.lifestealMeleePercent * 0.01);
    }
    if (wasAlive && !c.alive) {
      onEnemyKilled(c);
      awardClassXp('melee', c.tier);
      if (skillTree.level('bloodlust') > 0) buffs.grant('bloodlust', { moveSpeedMult: 1.55 }, 4);
    }
  }

  // The live weapon-tip trail (sampled per frame in the tick loop)
  // draws the sweeping arc — no static pre-computed fan here.

  // Shockwave AoE on attacks that define one (default: finisher step only).
  if (attack.shockwaveRadius && attack.shockwaveRadius > 0) {
    const rSq = attack.shockwaveRadius * attack.shockwaveRadius;
    for (const c of candidates) {
      if (!c.alive) continue;
      const dx = c.group.position.x - origin.x;
      const dz = c.group.position.z - origin.z;
      if (dx * dx + dz * dz > rSq) continue;
      const pushDir = {
        x: dx / Math.max(0.001, Math.hypot(dx, dz)),
        z: dz / Math.max(0.001, Math.hypot(dx, dz)),
      };
      const swDmg = attack.shockwaveDamage * derivedStats.meleeDmgMult * berserkMult();
      const wasAlive = c.alive;
      runStats.addDamage(swDmg);
      c.manager.applyHit(c, swDmg, 'torso', pushDir, { weaponClass: 'melee' });
      c.manager.applyKnockback?.(c, {
        x: pushDir.x * (attack.shockwaveKnockback || 0) * derivedStats.knockbackMult,
        z: pushDir.z * (attack.shockwaveKnockback || 0) * derivedStats.knockbackMult,
      });
      spawnDamageNumber(
        new THREE.Vector3(c.group.position.x, 1.2, c.group.position.z),
        camera, swDmg, 'torso',
      );
      if (wasAlive && !c.alive) {
      onEnemyKilled(c);
      awardClassXp('melee', c.tier);
      if (skillTree.level('bloodlust') > 0) buffs.grant('bloodlust', { moveSpeedMult: 1.55 }, 4);
    }
    }
    combat.spawnShockwave(
      new THREE.Vector3(origin.x, 0, origin.z),
      attack.shockwaveRadius,
      0xffc24a,
    );
  }
}

// Populate a dead enemy's body-loot so the player can rifle through it via
// the loot modal. Bosses / sub-bosses roll guaranteed rare items.
function buildBodyLoot(enemy) {
  const items = [];
  const tier = enemy.tier || 'normal';
  const levelIdx = (level && level.index) || 0;
  const isMeleeEnemy = melees.enemies.includes(enemy);

  // Weapons: every enemy drops what they were using. Basic grunts carry a
  // knife/club/bat (common melees); sub-bosses occasionally pack a fancier
  // blade; boss tier can roll the full melee pool.
  if (enemy.weapon) items.push(wrapWeapon(enemy.weapon));
  const meleePool = tunables.weapons.filter(w =>
    w.type === 'melee' && !w.mythic && w.rarity !== 'mythic');
  const lowTierMelees = meleePool.filter(w => w.rarity === 'common' || w.rarity === 'uncommon');
  if (isMeleeEnemy) {
    const pool = tier === 'boss'
      ? meleePool
      : tier === 'subBoss'
        ? (Math.random() < 0.2 ? meleePool : lowTierMelees)
        : lowTierMelees;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) items.push(wrapWeapon(pick));
  } else if (tier === 'subBoss' && Math.random() < 0.35) {
    const pick = lowTierMelees[Math.floor(Math.random() * lowTierMelees.length)];
    if (pick) items.push(wrapWeapon(pick));
  } else if (tier === 'boss') {
    const pick = meleePool[Math.floor(Math.random() * meleePool.length)];
    if (pick) items.push(wrapWeapon(pick));
  }

  // Armor scaling: always at least one piece, growing slowly with level.
  // Rare / epic upgrades are intentionally uncommon — most drops stay
  // common/uncommon so rare gear still feels like a find.
  let armorCount = 1 + Math.floor(levelIdx / 3);
  if (tier === 'subBoss') armorCount += 1;
  else if (tier === 'boss') armorCount += 2;
  // Upgrade chance — kept intentionally low so rare+ drops feel earned.
  // Most grunts never roll above uncommon; sub-bosses occasionally rare;
  // only bosses really push epic.
  const upgradeChance = Math.min(
    0.25,
    (levelIdx * 0.025) + (tier === 'boss' ? 0.18 : tier === 'subBoss' ? 0.08 : 0),
  );
  for (let i = 0; i < armorCount; i++) {
    const base = randomArmor();
    const piece = {
      ...base,
      durability: base.durability ? { ...base.durability } : undefined,
    };
    if (Math.random() < upgradeChance) {
      const roll = Math.random();
      if (tier === 'boss') {
        piece.rarity = roll < 0.10 ? 'epic' : roll < 0.40 ? 'rare' : 'uncommon';
      } else if (tier === 'subBoss') {
        piece.rarity = roll < 0.15 ? 'rare' : 'uncommon';
      } else {
        piece.rarity = 'uncommon';
      }
    }
    items.push(piece);
  }

  // Healing — enemies sometimes carry medical supplies. Chance scales by
  // tier; boss rooms reliably offer something to patch up afterwards.
  const healChance = tier === 'boss' ? 0.85 : tier === 'subBoss' ? 0.55 : 0.22;
  if (Math.random() < healChance) {
    const heals = ALL_CONSUMABLES.filter(c => c.useEffect?.kind === 'heal');
    if (heals.length) {
      // Bias toward bandage/painkillers on regular grunts; better packs on bosses.
      const pool = tier === 'boss' ? heals
        : tier === 'subBoss' ? heals.filter(h => h.rarity !== 'rare')
        : heals.filter(h => h.rarity === 'common');
      const src = pool.length ? pool : heals;
      items.push({ ...src[Math.floor(Math.random() * src.length)] });
    }
  }

  // Tier-specific extras — rarity distribution concentrates rare+ on
  // minibosses and bosses. Regular grunts hold common/uncommon so a
  // full run feels weighted toward the big fights for upgrades.
  if (tier === 'boss') {
    const g = randomGear();
    const gearR = Math.random();
    items.push({ ...g, rarity: gearR < 0.25 ? 'legendary' : gearR < 0.60 ? 'epic' : 'rare',
      durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } });
    const extraRoll = Math.random();
    if (extraRoll < 0.55) {
      const g2 = randomGear();
      items.push({ ...g2, rarity: Math.random() < 0.35 ? 'epic' : 'rare',
        durability: { ...(g2.durability || { current: 100, max: 100, repairability: 0.9 }) } });
    }
    if (Math.random() < 0.55) items.push(randomAttachment());
    items.push(randomJunk());
    if (Math.random() < 0.08) items.push(randomToy());
    // Bosses occasionally drop a throwable alongside the main loot.
    if (Math.random() < 0.35) items.push(randomThrowable());
  } else if (tier === 'subBoss') {
    const g = randomGear();
    const r = Math.random();
    items.push({ ...g, rarity: r < 0.15 ? 'epic' : r < 0.55 ? 'rare' : 'uncommon',
      durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } });
    if (Math.random() < 0.40) items.push(randomAttachment());
    if (Math.random() < 0.55) items.push(randomJunk());
    if (Math.random() < 0.25) items.push(randomThrowable());
  } else {
    // Regular grunts — junk + small consumable rolls, never rare+ gear.
    if (Math.random() < 0.10) items.push(randomAttachment());
    if (Math.random() < 0.18) {
      // Clamp stray consumable definitions that are authored as rare/
      // epic down to the common/uncommon band for grunt drops.
      const c = randomConsumable();
      if (c && (c.rarity === 'rare' || c.rarity === 'epic' || c.rarity === 'legendary')) {
        c.rarity = Math.random() < 0.3 ? 'uncommon' : 'common';
      }
      items.push(c);
    }
    if (Math.random() < 0.35) items.push(randomJunk());
    if (Math.random() < 0.18) items.push(randomJunk());
    // Small chance for a throwable from a grunt.
    if (Math.random() < 0.06) items.push(randomThrowable());
  }
  return items;
}

function rollCredits(tier) {
  const cfg = tunables.currency;
  if (Math.random() > cfg.dropChance) return 0;
  const [lo, hi] = cfg.amounts[tier] || cfg.amounts.normal;
  const base = lo + Math.floor(Math.random() * (hi - lo + 1));
  return Math.round(base * (derivedStats.creditDropMult || 1));
}

function onEnemyKilled(enemy, opts = {}) {
  // opts.silent — skip witness alerts and the death sfx. Used by the
  // execute path so a back-stab doesn't give the player's position
  // away to the rest of the room.
  enemy.loot = buildBodyLoot(enemy);
  enemy.looted = false;
  awardKillXp(enemy);
  const gained = rollCredits(enemy.tier || 'normal');
  if (gained > 0) { playerCredits += gained; runStats.addCredits(gained); }
  runStats.addKill();
  if (enemy.tier === 'subBoss') playerSkillPoints += 1;
  combat.spawnBloodPool(enemy.group.position, 0.75 + Math.random() * 0.25);
  if (artifacts.has('red_string')) {
    buffs.grant('red_string', { damageMult: 1.5 }, 4);
  }
  if (!opts.silent) {
    alertWitnesses(enemy);
    sfx.enemyDeath();
  }
  // Boss death — unlock the arena doors that slammed shut on entry.
  if (enemy.tier === 'boss' && typeof enemy.roomId === 'number') {
    level.unlockDoorsForRoom(enemy.roomId);
    transientHudMsg('BOSS DOWN', 2.0);
  }
  // Major-boss bounty — persistent chips always; mythic weapon drops
  // are gated at 10% so they stay an event, not a predictable grind
  // reward.
  if (enemy.majorBoss) {
    awardPersistentChips(3 + Math.floor(Math.random() * 3));
    // Mythics are boss-only AND rare — 3% so a successful run *might*
    // yield one, not a predictable grind reward. Tune down further if
    // even this feels too common across a session.
    if (Math.random() < 0.03) {
      const mythic = rollMythicDrop();
      if (mythic) enemy.loot.unshift(mythic);
    }
  }
  // Feel-juice — brief world-freeze on kills + a larger shake for
  // bigger enemies so tiers read by impact, not just hp bars.
  const killShake = enemy.tier === 'boss' ? 0.55
                  : enemy.tier === 'subBoss' ? 0.32 : 0.16;
  const killFreeze = enemy.tier === 'boss' ? 0.10
                   : enemy.tier === 'subBoss' ? 0.06 : 0.035;
  triggerShake(killShake, 0.30);
  triggerHitStop(killFreeze);
  // Keycard drop — sub-bosses tagged with a key colour in regenLevel
  // hand the token straight to the HUD (no item pickup required).
  if (enemy.keyDrop) {
    playerKeys.add(enemy.keyDrop);
    transientHudMsg(`+${enemy.keyDrop.toUpperCase()} KEYCARD`, 2.4);
    sfx.pickup();
  }
  // Exotic Cascade — capstone for the Demolitions class. Two paths:
  //  1. Kill came from an exotic weapon → drop a chain mark on the
  //     corpse for `exoticChainKillWindow` seconds.
  //  2. Any kill while chain marks exist nearby → roll the chance to
  //     trigger a small AoE at the corpse, chaining the explosion to
  //     adjacent dead bodies and any nearby alive enemies.
  if ((derivedStats.exoticChainKillChance || 0) > 0) {
    const w = currentWeapon();
    const fromExotic = opts.byThrowable || w?.class === 'exotic';
    const px = enemy.group.position.x;
    const pz = enemy.group.position.z;
    const radius = derivedStats.exoticChainKillRadius || 4;
    const rSq = radius * radius;
    let chained = false;
    for (let i = _exoticChainMarks.length - 1; i >= 0; i--) {
      const m = _exoticChainMarks[i];
      const dx = m.x - px, dz = m.z - pz;
      if (dx * dx + dz * dz <= rSq && Math.random() < derivedStats.exoticChainKillChance) {
        chained = true;
        _exoticChainMarks.splice(i, 1);
        break;
      }
    }
    if (chained) {
      // Spawn the chain explosion at this corpse — re-uses the kill
      // blast helper (Final Blast). Visuals + small AoE damage to any
      // nearby live enemy.
      spawnKillBlast(enemy.group.position,
                     radius,
                     derivedStats.exoticChainKillDmg || 24);
    }
    if (fromExotic) {
      _exoticChainMarks.push({
        x: px, z: pz,
        untilMs: gameClockMs + (derivedStats.exoticChainKillWindow || 3.0) * 1000,
      });
    }
  }
  // Demolitions Master — tier 1 refunds a charge per kill, tier 2 fully
  // resets cooldowns so a chain of throwable-kills snowballs. Caller
  // tags `opts.byThrowable` for explosion / molotov / flash kills.
  if (opts.byThrowable) {
    if (derivedStats.throwableResetOnKill > 0) {
      for (const it of inventory.allThrowables()) {
        const max = throwableMaxCharges(it);
        it.charges = max;
        it.cooldownT = 0;
      }
      renderActionBar();
    } else if ((derivedStats.throwableRefundOnKill | 0) > 0) {
      const refund = derivedStats.throwableRefundOnKill | 0;
      for (const it of inventory.allThrowables()) {
        const max = throwableMaxCharges(it);
        it.charges = Math.min(max, (it.charges | 0) + refund);
        if (it.charges >= max) it.cooldownT = 0;
      }
      renderActionBar();
    }
  }
  // Melee Battle Trance — refund stamina on melee kills. Inferred from
  // the wielded weapon at kill time so all melee call sites benefit
  // without threading explicit opts.byMelee through every path.
  if (derivedStats.meleeStaminaRefundOnKill > 0) {
    const w = currentWeapon();
    if (w?.type === 'melee') {
      player.refundStamina?.(derivedStats.meleeStaminaRefundOnKill);
    }
  }
}

// Any live enemy with line-of-sight to a newly-dead ally gets pulled out
// of idle and starts investigating toward the player's last-known
// position. Gunmen transition idle → alerted (short reaction), melees
// → chase. Enemies already engaged are left as-is.
const _witnessFrom = new THREE.Vector3();
const _witnessTo = new THREE.Vector3();
function alertWitnesses(victim) {
  const vPos = victim.group.position;
  _witnessTo.set(vPos.x, 1.2, vPos.z);
  const player2d = { x: player.mesh.position.x, z: player.mesh.position.z };
  const sightRadius = 30;
  const sightSq = sightRadius * sightRadius;
  const notice = (e) => {
    if (!e.alive || e === victim || e.state !== 'idle') return;
    const dx = e.group.position.x - vPos.x;
    const dz = e.group.position.z - vPos.z;
    if (dx * dx + dz * dz > sightSq) return;
    _witnessFrom.set(e.group.position.x, 1.2, e.group.position.z);
    if (!combat.hasLineOfSight(_witnessFrom, _witnessTo, level.obstacles)) return;
    // Transition to alerted/chase and seed lastKnown at the player's
    // position so they patrol toward the kill site.
    if (melees.enemies.includes(e)) e.state = 'chase';
    else { e.state = 'alerted'; e.reactionT = tunables.ai.reactionTime; }
    e.lastKnownX = player2d.x;
    e.lastKnownZ = player2d.z;
    e.noLosT = 0;
    propagateAggro(e);
  };
  for (const g of gunmen.gunmen) notice(g);
  for (const m of melees.enemies) notice(m);
}
function maybeDropExtras(enemy) { onEnemyKilled(enemy); }

// Decay all currently-equipped armor pieces on incoming damage, then apply
// the damage with the live reduction (which accounts for broken armor).
// `damageType` may be 'ballistic' | 'fire' | 'melee' — used for resistance.
function damagePlayer(amount, damageType = 'generic') {
  if (amount <= 0) return;
  // Apply damage-type resistance from skills.
  if (damageType === 'ballistic' && derivedStats.ballisticResist > 0) {
    amount *= (1 - Math.min(0.7, derivedStats.ballisticResist));
  } else if (damageType === 'fire' && derivedStats.fireResist > 0) {
    amount *= (1 - Math.min(0.8, derivedStats.fireResist));
  }
  // Cornered: extra reduction while below 30% HP (reads the last tick's
  // cached HP ratio since this runs from hit callbacks mid-frame).
  if ((derivedStats.cornerReduction || 0) > 0 && lastHpRatio < 0.3) {
    amount *= (1 - Math.min(0.85, derivedStats.cornerReduction));
  }
  // Iron Faith artifact — extra reduction while above 80% HP.
  if ((derivedStats.highHpReduction || 0) > 0 && lastHpRatio > 0.8) {
    amount *= (1 - Math.min(0.85, derivedStats.highHpReduction));
  }
  const ratio = tunables.durability.armorDamageRatio;
  for (const slot of SLOT_IDS) {
    const item = inventory.equipment[slot];
    if (!item || !item.reduction || !item.durability) continue;
    if (item.durability.current <= 0) continue;
    item.durability.current = Math.max(0, item.durability.current - amount * ratio);
  }
  // Second Wind — intercept damage that would kill and spend a charge to
  // revive at 40% of max HP instead.
  const healthBefore = lastHpRatio * (playerMaxHealthCached || 100);
  if ((derivedStats.secondWindCharges || 0) > secondWindUsed
      && amount >= healthBefore && healthBefore > 0) {
    secondWindUsed += 1;
    player.heal((playerMaxHealthCached || 100) * 0.4, { cures: ['bleed', 'broken'] });
    sfx.uiAccept();
    return;
  }
  player.takeDamage(amount);

  // Status effects based on the damage source. Ballistic hits occasionally
  // cause a bleed; melee hits are more likely and can also crack bones.
  const st = tunables.status || {};
  if (damageType === 'ballistic' && player.applyStatus && Math.random() < (st.bulletBleedChance || 0)) {
    player.applyStatus('bleed', st.bleedDuration || 12);
  } else if (damageType === 'melee' && player.applyStatus) {
    if (Math.random() < (st.meleeBleedChance || 0)) player.applyStatus('bleed', st.bleedDuration || 12);
    if (Math.random() < (st.meleeBrokenChance || 0)) player.applyStatus('broken', st.brokenDuration || 20);
  }
}

// Melee combo — repeated melee presses within the combo window cycle
// through weapon-swing → punch → kick. Each stage has its own reach,
// damage, knockback, and hit zone so players can chain them tactically
// (a fast knockdown with the kick after softening with a punch). The
// swing uses the equipped melee weapon's base damage; punch/kick are
// fist/leg-based and don't depend on weapon stats.
const MELEE_COMBO_WINDOW = 0.55;  // seconds to press again to continue
let meleeComboStep = 0;           // 0=swing, 1=punch, 2=kick
let meleeComboTimer = 0;          // counts down; expires → reset to 0

function meleeStepFor(step) {
  const base = tunables.melee;
  if (step === 0) {
    return {
      kind: 'swing',
      damage: base.swipeDamage,
      range: base.swipeRange,
      knockback: base.swipeKnockback,
      angleDeg: base.swipeAngleDeg,
      cooldown: base.swipeCooldown,
      zone: 'torso',
    };
  }
  if (step === 1) {
    return {
      kind: 'punch',
      damage: base.swipeDamage * 0.55,
      range: base.swipeRange * 0.70,
      knockback: base.swipeKnockback * 0.80,
      angleDeg: 55,
      cooldown: base.swipeCooldown * 0.60,
      zone: 'head',
    };
  }
  return {
    kind: 'kick',
    damage: base.swipeDamage * 0.85,
    range: base.swipeRange * 0.90,
    knockback: base.swipeKnockback * 1.80,
    angleDeg: 40,
    cooldown: base.swipeCooldown * 1.20,
    zone: 'torso',
  };
}

// Mouse-directed swipe. Cone hit test against all alive enemies; applies
// damage + knockback. Penetration caps how many targets one swing can hit.
const _swipeDir = new THREE.Vector3();
function tickMeleeSwipe(dt, inputState, aimInfo, playerInfo) {
  playerMeleeCooldown = Math.max(0, playerMeleeCooldown - dt);
  meleeComboTimer = Math.max(0, meleeComboTimer - dt);
  // Combo window expired → reset to step 0 for the next press.
  if (meleeComboTimer <= 0 && meleeComboStep !== 0) meleeComboStep = 0;

  if (!inputState.meleePressed) return;
  // Execute takes priority over a normal swipe.
  const target = findExecuteTarget();
  if (target) {
    executeTarget(target);
    playerMeleeCooldown = tunables.melee.swipeCooldown;
    meleeComboStep = 0;
    meleeComboTimer = 0;
    return;
  }
  // Gun-held quick melee is started in `tryStartQuickMelee` BEFORE
  // player.update so the attack state is already in 'startup' when
  // this frame's `playerInfo` is built — otherwise the shoot gate +
  // arm-swing animation both see stale state. Nothing to do here for
  // gun-held melee.
  if (currentWeapon() && currentWeapon().type === 'ranged') return;
  if (playerMeleeCooldown > 0) return;
  if (playerInfo && playerInfo.attackPhase !== 'idle'
    && playerInfo.attackPhase !== 'window') return;

  const origin = player.mesh.position;
  const aimSrc = aimInfo.point || player.mesh.getWorldDirection(new THREE.Vector3()).add(origin);
  _swipeDir.set(aimSrc.x - origin.x, 0, aimSrc.z - origin.z);
  if (_swipeDir.lengthSq() < 0.0001) return;
  _swipeDir.normalize();

  const comboStep = meleeStepFor(meleeComboStep);
  const angle = comboStep.angleDeg * Math.PI / 180;
  const halfCos = Math.cos(angle * 0.5);
  const range = comboStep.range;
  const penetration = Math.max(1, tunables.melee.swipePenetration | 0);

  const candidates = [];
  const collect = (list, forEach) => {
    for (const x of list) forEach(x);
  };
  collect(gunmen.gunmen, (g) => { if (g.alive) candidates.push(g); });
  collect(melees.enemies, (e) => { if (e.alive) candidates.push(e); });

  // Rank by distance; apply to nearest first.
  candidates.sort((a, b) => {
    const da = Math.hypot(a.group.position.x - origin.x, a.group.position.z - origin.z);
    const db = Math.hypot(b.group.position.x - origin.x, b.group.position.z - origin.z);
    return da - db;
  });

  // Walls block the swipe — without this, the cone test alone lets a
  // swing land on enemies standing on the other side of a closed door or
  // wall slab. LoS origin is raised to torso height so we don't false-
  // positive against floor tiles.
  const losFrom = new THREE.Vector3(origin.x, 1.0, origin.z);
  const losBlockers = level.solidObstacles();

  let hits = 0;
  for (const c of candidates) {
    if (hits >= penetration) break;
    const dx = c.group.position.x - origin.x;
    const dz = c.group.position.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    const nx = dx / Math.max(0.0001, d);
    const nz = dz / Math.max(0.0001, d);
    const dot = nx * _swipeDir.x + nz * _swipeDir.z;
    if (dot < halfCos) continue;

    const strikePoint = new THREE.Vector3(c.group.position.x, 1.2, c.group.position.z);
    if (!combat.hasLineOfSight(losFrom, strikePoint, losBlockers)) continue;
    const dmg = comboStep.damage * derivedStats.meleeDmgMult * berserkMult();
    const wasAlive = c.alive;
    runStats.addDamage(dmg);
    c.manager.applyHit(c, dmg, comboStep.zone, _swipeDir, { weaponClass: 'melee' });
    if (c.manager.applyKnockback) {
      c.manager.applyKnockback(c, {
        x: _swipeDir.x * comboStep.knockback * derivedStats.knockbackMult,
        z: _swipeDir.z * comboStep.knockback * derivedStats.knockbackMult,
      });
    }
    // Beefier feedback on melee landing: impact flash + a blood
    // burst (lighter than a bullet headshot but larger than a
    // chip hit) + brief camera shake + micro hit-stop. Sells the
    // "this landed cleanly" feel vs a background raycast.
    combat.spawnImpact(strikePoint);
    combat.spawnBloodBurst(strikePoint, _swipeDir, 8);
    spawnDamageNumber(strikePoint, camera, dmg, comboStep.zone);
    triggerShake(0.18, 0.14);
    triggerHitStop?.(0.04);
    sfx.meleeImpact?.();
    if (derivedStats.lifestealMeleePercent > 0) {
      player.heal(dmg * derivedStats.lifestealMeleePercent * 0.01);
    }
    if (wasAlive && !c.alive) {
      onEnemyKilled(c);
      awardClassXp('melee', c.tier);
      if (skillTree.level('bloodlust') > 0) buffs.grant('bloodlust', { moveSpeedMult: 1.55 }, 4);
    }
    hits += 1;
  }

  // Sweeping arc visual — fading ribbon through the swing arc.
  // Live weapon-tip trail (sampled per frame) handles the sweep for
  // combo-based melee; this fallback keeps the ground arc for the
  // cone-swipe path so old swipe FX don't vanish.
  combat.spawnSwipeArc(origin, _swipeDir, range, angle, tunables.melee.swipeArcLife);
  // Whoosh on every swing; solid thud if at least one target was hit.
  sfx.meleeSwing();
  if (hits > 0) sfx.meleeImpact();
  playerMeleeCooldown = comboStep.cooldown;
  // Advance the combo; wrap at step 2 (kick) back to 0 (swing). The
  // window is refreshed so the next quick press chains the next move.
  meleeComboStep = (meleeComboStep + 1) % 3;
  meleeComboTimer = MELEE_COMBO_WINDOW;
}

// AI firing against the player body (proper 3D cover respect) + walls.
// Ricochet — pick the nearest other enemy, raycast a bolt there, apply
// reduced damage. Recurses up to `remaining` additional bounces.
function spawnRicochet(originPt, fromEnemy, dmg, remaining, weapon) {
  if (remaining <= 0 || dmg <= 0.5) return;
  let best = null, bestD = 18;
  const all = [...gunmen.gunmen, ...melees.enemies];
  for (const c of all) {
    if (!c.alive || c === fromEnemy) continue;
    const dx = c.group.position.x - originPt.x;
    const dz = c.group.position.z - originPt.z;
    const d = Math.hypot(dx, dz);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (!best) return;
  const from = new THREE.Vector3(originPt.x, 1.0, originPt.z);
  const to = new THREE.Vector3(best.group.position.x, 1.0, best.group.position.z);
  const toDir = new THREE.Vector3().subVectors(to, from);
  if (toDir.lengthSq() < 0.0001) return;
  toDir.normalize();
  const targets = [...allHittables(), ...level.solidObstacles()];
  const hit = combat.raycast(from, toDir, targets, 18);
  const endPt = hit ? hit.point : to;
  combat.spawnShot(from, endPt, weapon?.tracerColor ?? 0xffa040);
  if (hit && hit.owner?.manager) {
    const wasAlive = hit.owner.alive;
    runStats.addDamage(dmg);
    hit.owner.manager.applyHit(hit.owner, dmg, hit.zone, toDir, { weaponClass: weapon?.class });
    combat.spawnBloodBurst(hit.point, toDir, 5);
    if (wasAlive && !hit.owner.alive) onEnemyKilled(hit.owner);
    // Chain further if budget remains.
    spawnRicochet(hit.point, hit.owner, dmg * 0.6, remaining - 1, weapon);
  }
}

// Called by the ProjectileManager when a grenade / rocket detonates.
// Applies falloff AoE damage, spawns a fireball burst + scorch ring,
// and shakes the screen. Kept out of the class so it can reach the
// main-module helpers (onEnemyKilled, triggerShake, sfx, etc.).
const _explodeDir = new THREE.Vector3();
function spawnExplosionFx(pos, radius) {
  if (combat.spawnExplosion) combat.spawnExplosion(pos, radius);
  else combat.spawnBloodBurst(pos, new THREE.Vector3(0, 1, 0), 20);
}

// White translucent expanding dome — used for flashbang / stun
// detonations so they read as a concussive pulse, not a fireball.
// Grows from a tight core to `radius` over ~0.4s while the opacity
// fades; disposes on completion.
const _flashDomes = [];
function spawnFlashDome(pos, radius, tint = 0xffffff) {
  const geom = new THREE.SphereGeometry(1, 20, 14);
  const mat = new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(pos);
  mesh.scale.setScalar(0.2);
  scene.add(mesh);
  _flashDomes.push({ mesh, t: 0, life: 0.4, radius });
}
function _tickFlashDomes(dt) {
  for (let i = _flashDomes.length - 1; i >= 0; i--) {
    const d = _flashDomes[i];
    d.t += dt;
    const k = d.t / d.life;
    // Scale 0.2 → radius, opacity 0.85 → 0.
    d.mesh.scale.setScalar(0.2 + (d.radius - 0.2) * Math.min(1, k * 1.1));
    d.mesh.material.opacity = Math.max(0, 0.85 * (1 - k));
    if (d.t >= d.life) {
      scene.remove(d.mesh);
      d.mesh.geometry.dispose();
      d.mesh.material.dispose();
      _flashDomes.splice(i, 1);
    }
  }
}

// Burst of small fiery orbs rising upward from a molotov impact.
// Each orb has a short random lifetime, floats up, fades, and self-
// disposes. Used on the initial shatter AND topped up periodically
// from `_tickFireZones` while the burn patch is active.
const _fireOrbs = [];
function spawnFireOrbBurst(pos, radius, count = 18) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius * 0.9;
    const x = pos.x + Math.cos(a) * r;
    const z = pos.z + Math.sin(a) * r;
    const sz = 0.06 + Math.random() * 0.07;
    const color = Math.random() < 0.5 ? 0xff8030 : 0xffc060;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(sz, 5, 4),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.set(x, 0.10 + Math.random() * 0.25, z);
    scene.add(mesh);
    _fireOrbs.push({
      mesh,
      vy: 0.8 + Math.random() * 1.2,
      drift: {
        x: (Math.random() - 0.5) * 0.25,
        z: (Math.random() - 0.5) * 0.25,
      },
      life: 0.8 + Math.random() * 0.7,
      t: 0,
    });
  }
}
function _tickFireOrbs(dt) {
  for (let i = _fireOrbs.length - 1; i >= 0; i--) {
    const o = _fireOrbs[i];
    o.t += dt;
    o.mesh.position.x += o.drift.x * dt;
    o.mesh.position.z += o.drift.z * dt;
    o.mesh.position.y += o.vy * dt;
    o.vy *= 1 - dt * 0.8;   // decelerate slightly — wisp effect
    const k = o.t / o.life;
    o.mesh.material.opacity = 0.9 * Math.max(0, 1 - k);
    o.mesh.scale.setScalar(1 + k * 0.5);   // grow as they fade
    if (o.t >= o.life) {
      scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      o.mesh.material.dispose();
      _fireOrbs.splice(i, 1);
    }
  }
}
// Throwable detonations alert enemies in the blast radius even if the
// blast itself didn't hurt them (flash / stun / molotov don't do
// direct damage). Unalerted enemies get a brief `surpriseT` before
// they fully aggro so the moment reads as "they heard it / saw it,
// now they know you're here" instead of an instant awareness flip.
function _alertThrowableBlast(pos, radius, owner) {
  if (owner !== 'player') return;
  const r2 = radius * radius;
  const sweep = (list) => {
    for (const c of list) {
      if (!c.alive) continue;
      const dx = c.group.position.x - pos.x;
      const dz = c.group.position.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      const wasIdle = c.state === 'idle' || c.state === 'sleep';
      if (wasIdle) {
        // Short surprise pause before aggro kicks in — reads as the
        // enemy freezing for a moment after the bang. The AI state
        // machines check `surpriseT` before acting.
        c.surpriseT = Math.max(c.surpriseT || 0, 0.7);
        c.suspicion = Math.max(c.suspicion || 0, 0.95);
      } else {
        c.suspicion = Math.max(c.suspicion || 0, 1.0);
      }
      // Force alert state so the AI wakes regardless of suspicion gating.
      if (c.state === 'idle') c.state = 'alerted';
      else if (c.state === 'sleep') c.state = 'alerted';
      else if (c.state === 'chase' || c.state === 'windup') { /* keep */ }
    }
  };
  sweep(gunmen.gunmen);
  sweep(melees.enemies);
}

function onProjectileExplode(pos, explosion, owner, p) {
  const radius = explosion.radius;
  const rSq = radius * radius;
  // Alert radius is wider than the blast so nearby enemies still hear
  // the bang and react, even if the blast itself missed them. Flash /
  // stun / molotov do no direct damage so the alert pass is what makes
  // them tactically useful beyond pure CC.
  if (p?.throwKind) {
    _alertThrowableBlast(pos, radius * 1.6, owner);
  }
  // Throwable special-cases — dispatch by throwKind. Frag falls
  // through to the normal explosion path; molotov / flash / stun
  // return early after spawning their own landing effect.
  const kind = p?.throwKind;
  if (kind === 'molotov') {
    // Shatter — a burst of rising fiery orbs plus the persistent
    // fire zone. No firey explosion sphere (reads as "pool of fire
    // starting", not "boom"). Orbs floating upward sell the initial
    // splash; the zone below handles the ongoing DoT.
    spawnFireOrbBurst(pos, radius, 22);
    spawnFireZone(pos, radius, p.fireDuration || 6.0, p.fireTickDps || 14);
    if (sfx.explode) sfx.explode();
    triggerShake(0.18, 0.15);
    return;
  }
  if (kind === 'flash') {
    // Radial blind pulse — affects every alive enemy with LoS to the
    // detonation point (walls block the flash). No damage.
    const flashDur = p.blindDuration || 4.0;
    const blinders = [...gunmen.gunmen, ...melees.enemies];
    const blockers = level.solidObstacles ? level.solidObstacles() : [];
    for (const c of blinders) {
      if (!c.alive) continue;
      const dx = c.group.position.x - pos.x;
      const dz = c.group.position.z - pos.z;
      if (dx * dx + dz * dz > rSq) continue;
      const eye = new THREE.Vector3(c.group.position.x, 1.2, c.group.position.z);
      if (!combat.hasLineOfSight(pos, eye, blockers)) continue;
      c.blindT = Math.max(c.blindT || 0, flashDur);
    }
    // White expanding dome instead of a fireball — reads as a
    // concussive light pulse. Tint slightly warm so it doesn't look
    // identical to the stun grenade.
    spawnFlashDome(pos, radius, 0xffffff);
    if (sfx.explode) sfx.explode();
    triggerShake(0.3, 0.25);
    return;
  }
  if (kind === 'stun') {
    // Dazzle pulse — shorter than flash but hits through walls (it's
    // a concussive stun, not a light-blind). Uses dazzleT which
    // enemies already honour in their aim/AI code.
    const stunDur = p.stunDuration || 2.5;
    const victims = [...gunmen.gunmen, ...melees.enemies];
    for (const c of victims) {
      if (!c.alive) continue;
      const dx = c.group.position.x - pos.x;
      const dz = c.group.position.z - pos.z;
      if (dx * dx + dz * dz > rSq) continue;
      c.dazzleT = Math.max(c.dazzleT || 0, stunDur);
    }
    // Pale-blue tint on the white dome so the stun reads distinctly
    // from the flashbang at a glance.
    spawnFlashDome(pos, radius, 0xc0d8ff);
    if (sfx.explode) sfx.explode();
    triggerShake(0.25, 0.22);
    return;
  }

  // --- default (frag / rocket / grenade-launcher) path ---
  // Visual pop — expanding fireball + scorched-ring shock wave
  // so the detonation reads even at low camera angles. Auto-animates
  // via combat's particle tick (scales up then fades).
  spawnExplosionFx(pos, radius);
  if (sfx.explode) sfx.explode(); else sfx.hit();
  triggerShake(explosion.shake || 0.4, 0.35);
  triggerHitStop?.(0.05);

  const applyTo = (list, friendlyFilter) => {
    for (const c of list) {
      if (!c.alive) continue;
      if (friendlyFilter && !friendlyFilter(c)) continue;
      const dx = c.group.position.x - pos.x;
      const dz = c.group.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > rSq) continue;
      const d = Math.sqrt(d2);
      // Falloff: full damage at ground zero, ~25% at the edge.
      const falloff = 1 - 0.75 * (d / radius);
      const dmg = explosion.damage * Math.max(0.25, falloff);
      const pd = d || 1;
      const wasAlive = c.alive;
      _explodeDir.set(dx / pd, 0, dz / pd);
      if (owner === 'player') runStats.addDamage(dmg);
      c.manager.applyHit(c, dmg, 'torso', _explodeDir, { weaponClass: 'explosive' });
      if (wasAlive && !c.alive && owner === 'player') {
        // Tag throwable kills so Demolitions Master can refund / reset
        // cooldowns. Bullet-projectile explosions (e.g. grenade
        // launcher) come through this same path too — every kill on
        // the explosion path counts as a throwable for that capstone,
        // which matches the player's expectation of "explosions =
        // demolitions".
        onEnemyKilled(c, { byThrowable: true });
      }
    }
  };
  // Player-owned explosions hit every enemy; enemy-owned explosions
  // skip the thrower via the friendly filter (not wired yet, but the
  // hook is here for future AI grenades).
  applyTo(gunmen.gunmen);
  applyTo(melees.enemies);

  // Radial damage to the player from enemy-owned explosions + self-
  // damage bleed on player rockets (only at very close range — 40% of
  // blast radius — so point-blank shots actually hurt).
  if (owner === 'enemy') {
    const dx = player.body.position.x - pos.x;
    const dz = player.body.position.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < rSq) {
      const d = Math.sqrt(d2);
      const falloff = 1 - 0.75 * (d / radius);
      player.takeDamage(explosion.damage * Math.max(0.25, falloff));
    }
  } else if (owner === 'player') {
    // Player's own grenades / rockets / frag rounds now hurt them when
    // caught in the blast. Full radius (not 0.4×) with the same falloff
    // as enemies, but scaled to 60% damage so a sensible mid-range
    // detonation chips hp instead of instant-kill.
    const dx = player.body.position.x - pos.x;
    const dz = player.body.position.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < rSq) {
      const d = Math.sqrt(d2);
      const falloff = 1 - 0.75 * (d / radius);
      player.takeDamage(explosion.damage * 0.6 * Math.max(0.25, falloff));
    }
  }
  void p;
}

// AoE helper for the Final Blast perk — radial damage with a visible burst.
function spawnKillBlast(pos, radius, dmg) {
  combat.spawnBloodBurst(pos, new THREE.Vector3(0, 1, 0), 14);
  const rSq = radius * radius;
  const pushAll = (list) => {
    for (const c of list) {
      if (!c.alive) continue;
      const dx = c.group.position.x - pos.x;
      const dz = c.group.position.z - pos.z;
      if (dx * dx + dz * dz > rSq) continue;
      const pd = Math.hypot(dx, dz) || 1;
      runStats.addDamage(dmg);
      c.manager.applyHit(c, dmg, 'torso', { x: dx / pd, z: dz / pd }, { weaponClass: 'melee' });
    }
  };
  pushAll(gunmen.gunmen);
  pushAll(melees.enemies);
}

function aiFire(origin, dir, weapon, damageMult = 1) {
  if (!weapon) return; // defensive: parry redirect can disarm mid-burst
  if (weapon.fireMode === 'flame' || weapon.class === 'flame') {
    aiFireFlame(origin, dir, weapon, damageMult);
    return;
  }
  sfx.enemyFire(weapon.class || 'pistol');
  const targets = [...level.obstacles, player.body];
  const hit = combat.raycast(origin, dir, targets, weapon.range);
  let endPoint;
  let hitPlayer = false;
  if (hit) {
    endPoint = hit.point;
    if (hit.mesh.userData?.isPlayer) hitPlayer = true;
  } else {
    endPoint = origin.clone().addScaledVector(dir, weapon.range);
  }
  // AI fires intentionally skip the muzzle-flash PointLight — with
  // 14-shot bullet-hell volleys, stacking live point lights per frame
  // crushes fragment shading on low-spec GPUs. The additive flash
  // mesh + tracer still read clearly.
  combat.spawnShot(origin, endPoint, weapon.tracerColor, { light: false });

  if (!hitPlayer) return;

  if (player.isBlocking()) {
    if (player.isParryActive()) {
      redirectShotAtCursor(weapon, endPoint);
      combat.spawnDeflectFlash(endPoint, 0xffe28a);
    } else {
      player.consumeStamina(tunables.stamina.deflectCost);
      combat.spawnDeflectFlash(endPoint, 0xffffff);
    }
    return;
  }

  combat.spawnImpact(endPoint);
  damagePlayer(weapon.damage * damageMult, 'ballistic');
}

// AI flame tick — mirror of the player's tickFlame but directed at the
// player only. Called once per flameTickRate tick by the gunman fire loop.
function aiFireFlame(origin, dir, weapon, damageMult = 1) {
  const range = weapon.range || 6.5;
  const angleRad = (weapon.flameAngleDeg ?? 35) * Math.PI / 180;
  const halfCos = Math.cos(angleRad * 0.5);

  const ppos = player.mesh.position;
  const dx = ppos.x - origin.x;
  const dz = ppos.z - origin.z;
  const d = Math.hypot(dx, dz);
  let hitsPlayer = false;
  if (d <= range && d > 0.0001) {
    const nx = dx / d, nz = dz / d;
    if (nx * dir.x + nz * dir.z >= halfCos) hitsPlayer = true;
  }

  combat.spawnFlameParticles(origin, dir, range, angleRad);

  if (!hitsPlayer) return;
  if (player.isBlocking()) {
    combat.spawnDeflectFlash(new THREE.Vector3(ppos.x, 1.0, ppos.z), 0xffd07a);
    player.consumeStamina(tunables.stamina.deflectCost * 0.5);
    return;
  }
  damagePlayer((weapon.damage || 5) * damageMult, 'fire');
}

// Parry redirect: fire a new tracer from the player toward the current aim
// cursor; if it lands on an enemy, deal bonus damage.
function redirectShotAtCursor(weapon, impactPoint) {
  if (!input.hasAim) return;
  const playerPos = player.mesh.position;
  const aimPt = lastAim || impactPoint;
  const from = new THREE.Vector3(playerPos.x, 1.0, playerPos.z);
  const toDir = new THREE.Vector3(aimPt.x - from.x, 0, aimPt.z - from.z);
  if (toDir.lengthSq() < 0.0001) return;
  toDir.normalize();

  const targets = [...allHittables(), ...level.solidObstacles()];
  const hit = combat.raycast(from, toDir, targets, weapon.range);
  const endPt = hit ? hit.point : from.clone().addScaledVector(toDir, weapon.range);
  combat.spawnShot(from, endPt, 0xfff3a0);

  if (hit && hit.owner && hit.owner.manager) {
    const zoneCfg = tunables.zones[hit.zone];
    const mult = zoneCfg ? zoneCfg.damageMult : 1.0;
    const dmg = weapon.damage * mult * tunables.block.redirectDamageMult;
    runStats.addDamage(dmg);
    const result = hit.owner.manager.applyHit(hit.owner, dmg, hit.zone, toDir);
    for (const drop of result.drops) loot.spawnWeapon(drop.position, drop.weapon);
    combat.spawnImpact(hit.point);
    spawnDamageNumber(hit.point, camera, dmg, hit.zone || 'torso');
  } else if (hit) {
    combat.spawnImpact(hit.point);
  }
}

function updateHealthHud(playerInfo) {
  if (hpFillEl) {
    const pct = Math.max(0, Math.min(1, playerInfo.health / playerInfo.maxHealth));
    hpFillEl.style.width = `${pct * 100}%`;
    if (pct > 0.6) hpFillEl.style.background = '#6abe5a';
    else if (pct > 0.3) hpFillEl.style.background = '#d0a030';
    else hpFillEl.style.background = '#c94a3a';
    if (hpRegenEl) {
      const capPct = Math.max(0, Math.min(1, (playerInfo.regenCap ?? playerInfo.maxHealth) / playerInfo.maxHealth));
      hpRegenEl.style.width = `${capPct * 100}%`;
    }
    if (hpTextEl) hpTextEl.textContent = `${Math.round(playerInfo.health)} / ${Math.round(playerInfo.maxHealth)}`;
  }
  if (hpStatusRowEl) {
    // Reuse two cached badge DOM nodes instead of rebuilding every frame.
    if (!hpStatusRowEl._bleed) {
      const b = document.createElement('div');
      b.className = 'hp-status-badge bleed';
      b.innerHTML = `<img src="${STATUS_ICONS.bleed}" alt=""><span></span>`;
      b._text = b.querySelector('span');
      b.style.display = 'none';
      hpStatusRowEl.appendChild(b);
      hpStatusRowEl._bleed = b;
      const br = document.createElement('div');
      br.className = 'hp-status-badge broken';
      br.innerHTML = `<img src="${STATUS_ICONS.broken}" alt=""><span></span>`;
      br._text = br.querySelector('span');
      br.style.display = 'none';
      hpStatusRowEl.appendChild(br);
      hpStatusRowEl._broken = br;
    }
    const bleed = playerInfo.bleedT || 0;
    const broken = playerInfo.brokenT || 0;
    const bEl = hpStatusRowEl._bleed, brEl = hpStatusRowEl._broken;
    if (bleed > 0) { bEl.style.display = ''; bEl._text.textContent = `${bleed.toFixed(0)}s`; }
    else bEl.style.display = 'none';
    if (broken > 0) { brEl.style.display = ''; brEl._text.textContent = `${broken.toFixed(0)}s`; }
    else brEl.style.display = 'none';
  }
  if (staFillEl) {
    const pct = Math.max(0, Math.min(1, playerInfo.stamina / playerInfo.maxStamina));
    staFillEl.style.width = `${pct * 100}%`;
    if (playerInfo.blocking) staFillEl.style.background = '#d07acc';
    else if (pct > 0.3) staFillEl.style.background = '#6aaedc';
    else staFillEl.style.background = '#c97a5a';
    if (staTextEl) {
      const parry = playerInfo.parryActive ? ' · parry!' : '';
      staTextEl.textContent =
        `${Math.round(playerInfo.stamina)} / ${Math.round(playerInfo.maxStamina)}${parry}`;
    }
  }
}

// Nearest dead body within reach — used for the loot prompt.
function nearestBody(playerPos, radius = 2.2) {
  let best = null, bestDist = radius;
  const check = (e) => {
    if (e.alive) return;
    const dx = e.group.position.x - playerPos.x;
    const dz = e.group.position.z - playerPos.z;
    const d = Math.hypot(dx, dz);
    if (d < bestDist) { bestDist = d; best = e; }
  };
  for (const g of gunmen.gunmen) check(g);
  for (const m of melees.enemies) check(m);
  return best;
}

// Overhead layer — per-frame 2D overlay projected from world-space positions.
// Used for the reload ring, AI burst-settle ring, and blinded/dazzled status
// badges. Cheap reusable-div pool.
const overheadPool = [];
let overheadCount = 0;
function acquireOverhead(cls) {
  let el;
  if (overheadCount < overheadPool.length) {
    el = overheadPool[overheadCount];
  } else {
    el = document.createElement('div');
    overheadLayerEl.appendChild(el);
    overheadPool.push(el);
  }
  overheadCount++;
  el.className = cls;
  el.style.display = 'block';
  return el;
}
function endOverheadFrame() {
  for (let i = overheadCount; i < overheadPool.length; i++) {
    overheadPool[i].style.display = 'none';
  }
  overheadCount = 0;
}
const _proj = new THREE.Vector3();
function projectToScreen(pos, yOffset = 2.4) {
  _proj.set(pos.x, (pos.y || 0) + yOffset, pos.z);
  _proj.project(camera);
  return {
    x: (_proj.x * 0.5 + 0.5) * window.innerWidth,
    y: (-_proj.y * 0.5 + 0.5) * window.innerHeight,
    behind: _proj.z > 1,
  };
}
function spawnRing(pos, pct, isEnemy = false) {
  const p = projectToScreen(pos, 2.3);
  if (p.behind) return;
  const el = acquireOverhead(`overhead-ring${isEnemy ? ' enemy' : ''}`);
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.style.setProperty('--fill', `${Math.max(0, Math.min(1, pct)) * 360}deg`);
}
function spawnMarker(pos, glyph, cls, yOffset = 2.6) {
  const p = projectToScreen(pos, yOffset);
  if (p.behind) return;
  const el = acquireOverhead(`overhead-marker ${cls}`);
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.textContent = glyph;
}

function updateOverhead(weapon, effWeapon, playerInfo, stealthMult) {
  if (!overheadLayerEl) return;

  // Stealth visuals — vignette + eye over player whose alpha scales with
  // how visible the player is (higher alpha = more detectable).
  const stealthy = stealthMult < 0.9;
  if (stealthVignetteEl) {
    stealthVignetteEl.classList.toggle('active', stealthy);
    // Darken more as the player gets stealthier.
    stealthVignetteEl.style.opacity = stealthy
      ? String(0.6 + (1 - Math.max(0.05, stealthMult)) * 0.4)
      : '0';
  }
  if (stealthy) {
    const p = projectToScreen(player.mesh.position, 2.8);
    if (!p.behind) {
      const el = acquireOverhead('overhead-eye');
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.opacity = String(Math.max(0.1, Math.min(1, stealthMult)));
      el.textContent = stealthMult < 0.3 ? '◠' : '◉';
    }
  }

  // Player reload.
  if (weapon && weapon.type === 'ranged' && weapon.reloadingT > 0) {
    const total = (effWeapon?.reloadTime || weapon.reloadTime || 1.5);
    const pct = 1 - weapon.reloadingT / total;
    spawnRing(player.mesh.position, pct, false);
  }
  // Enemy burst settle + status badges.
  for (const g of gunmen.gunmen) {
    if (!g.alive) continue;
    if ((g.aiSettleT || 0) > 0 && (g.aiSettleDur || 0) > 0) {
      const pct = 1 - (g.aiSettleT / g.aiSettleDur);
      spawnRing(g.group.position, pct, true);
    }
    if ((g.dazzleT || 0) > 0) spawnMarker(g.group.position, '✦', 'overhead-star', 2.6);
    else if ((g.blindT || 0) > 0) spawnMarker(g.group.position, '✺', 'overhead-flash', 2.6);
    if (g._occluded && _isEnemyActive(g)) {
      spawnMarker(g.group.position, '◉', 'overhead-threat', 2.6);
    }
  }
  for (const m of melees.enemies) {
    if (!m.alive) continue;
    if ((m.dazzleT || 0) > 0) spawnMarker(m.group.position, '✦', 'overhead-star', 2.4);
    else if ((m.blindT || 0) > 0) spawnMarker(m.group.position, '✺', 'overhead-flash', 2.4);
    if (m._occluded && _isEnemyActive(m)) {
      spawnMarker(m.group.position, '◉', 'overhead-threat', 2.4);
    }
  }
  endOverheadFrame();
}

// Stealth status indicator — pulls from live enemy states each tick.
// HIDDEN     = crouched/stealthy, no enemy aware
// UNDETECTED = standing, no enemy aware (default combat walk)
// SPOTTED    = at least one enemy has us spotted but nobody's firing yet
// DETECTED   = at least one enemy is firing/swinging (fully engaging)
function updateStealthStatus(playerInfo) {
  if (!stealthStatusEl) return;
  let seen = false;
  let detected = false;
  for (const g of gunmen.gunmen) {
    if (!g.alive) continue;
    if (g.state === 'firing') { detected = true; break; }
    if (g.state === 'alerted') seen = true;
  }
  if (!detected) {
    for (const e of melees.enemies) {
      if (!e.alive) continue;
      if (e.state === 'swing' || e.state === 'windup') { detected = true; break; }
      if (e.state === 'chase' || e.state === 'recovery') seen = true;
    }
  }
  const crouching = !!(playerInfo?.crouched || playerInfo?.crouchSprinting);
  let cls, txt;
  if (detected)        { cls = 'detected'; txt = 'DETECTED'; }
  else if (seen)       { cls = 'seen';     txt = 'SPOTTED'; }
  else if (crouching)  { cls = 'hidden';   txt = 'HIDDEN'; }
  else                 { cls = 'undetected'; txt = 'UNDETECTED'; }
  stealthStatusEl.className = cls;
  stealthStatusEl.textContent = txt;
}

// Fog-of-war render. Three modes per enemy:
//   • LoS              → full brightness, original materials.
//   • out of LoS, sensed → fresnel-shader "ghost" — fuzzy grey outline
//                          with a transparent body, alpha edge-driven so
//                          the silhouette reads against a dark room.
//   • out of LoS, beyond sense → hidden.
// The fresnel material is cloned per enemy so per-frame opacity can be
// driven from distance + active-state without cloning materials in hot
// loops. Originals are cached the first time we swap a mesh into ghost
// mode and restored on the swap back.
const GHOST_NEAR_ALPHA = 0.55;     // close, just behind a wall
const GHOST_FAR_ALPHA  = 0.12;     // at the edge of hearing range
const GHOST_ACTIVE_BOOST = 0.18;   // extra visibility when actively firing
const GHOST_BASE_RANGE = 7;

function _makeGhostMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor:   { value: new THREE.Color(0xb3b8c0) },
      uEdge:    { value: new THREE.Color(0xe2e6ee) },
      uPower:   { value: 2.6 },
      uOpacity: { value: 0.5 },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW  = normalize(mat3(modelMatrix) * normal);
        vViewDirW = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3  uColor;
      uniform vec3  uEdge;
      uniform float uPower;
      uniform float uOpacity;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        vec3 N = normalize(vNormalW);
        vec3 V = normalize(vViewDirW);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        // Fresnel rim — strong at glancing angles, near zero face-on.
        float fres = pow(1.0 - ndv, uPower);
        // Body fill is faint so the rim does the silhouette work; edges
        // brighten toward a paler grey for the fuzzy-outline read.
        vec3 col   = mix(uColor, uEdge, fres);
        float a    = uOpacity * (0.08 + 1.05 * fres);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.FrontSide,
  });
}

// Swap an enemy's renderable meshes between original materials and the
// fresnel ghost. Caches the originals on the mesh's userData the first
// time we visit it, so re-swaps are a flat reference assignment.
function _setEnemyGhost(e, ghosted) {
  if (!e.group) return;
  const wantGhost = !!ghosted;
  if (e.__ghosted === wantGhost) return;
  if (wantGhost && !e.__ghostMat) e.__ghostMat = _makeGhostMaterial();
  e.group.traverse((obj) => {
    if (!obj.isMesh) return;
    if (wantGhost) {
      if (obj.userData.__origMat === undefined) obj.userData.__origMat = obj.material;
      obj.material = e.__ghostMat;
      obj.castShadow = false;
      obj.userData.__origRenderOrder = obj.renderOrder;
      obj.renderOrder = 5;   // draw on top of darker scene fill
    } else if (obj.userData.__origMat) {
      obj.material = obj.userData.__origMat;
      obj.castShadow = obj.userData.__origCast !== false;
      if (obj.userData.__origRenderOrder !== undefined) obj.renderOrder = obj.userData.__origRenderOrder;
    }
  });
  e.__ghosted = wantGhost;
}

// Returns true for enemies currently in an aggressive state that the
// player should see through walls (so they can react to incoming threats).
function _isEnemyActive(e) {
  const s = e.state;
  return s === 'firing' || s === 'alerted' || s === 'chase'
    || s === 'windup' || s === 'swing' || s === 'recovery';
}
// Persistent scratch values for updateEnemyVisibility — recreating
// these every frame ran roughly 60 × 2 Vector3 allocs/sec at 60fps,
// plus the spread allocation for `everyone`.
const _visFrom = new THREE.Vector3();
const _visTarget = new THREE.Vector3();
function updateEnemyVisibility() {
  const range = GHOST_BASE_RANGE + (derivedStats.hearingRange || 0);
  const nearAlpha = Math.min(0.85, GHOST_NEAR_ALPHA + (derivedStats.hearingAlpha || 0));
  const px = player.mesh.position.x, pz = player.mesh.position.z;
  _visFrom.set(px, 1.2, pz);
  // Walk both enemy lists by index to avoid the spread-allocation that
  // [...gunmen.gunmen, ...melees.enemies] used to do per frame.
  const gunmenList = gunmen.gunmen;
  const meleesList = melees.enemies;
  const visionBlockers = level.visionBlockers();
  for (let i = 0, total = gunmenList.length + meleesList.length; i < total; i++) {
    const e = i < gunmenList.length ? gunmenList[i] : meleesList[i - gunmenList.length];
    if (!e.alive) {
      // Corpses always render fully — fresnel ghost is for live enemies.
      _setEnemyGhost(e, false);
      e.group.visible = true;
      continue;
    }
    _visTarget.set(e.group.position.x, 1.2, e.group.position.z);
    const los = combat.hasLineOfSight(_visFrom, _visTarget, visionBlockers);
    e._occluded = !los;
    if (los) {
      _setEnemyGhost(e, false);
      e.group.visible = true;
      continue;
    }
    const d = Math.hypot(e.group.position.x - px, e.group.position.z - pz);
    if (d >= range) {
      // Beyond hearing range — hide entirely.
      _setEnemyGhost(e, false);
      e.group.visible = false;
      continue;
    }
    // Within hearing range, out of LoS — render as a fresnel ghost.
    // Per-enemy opacity drives the silhouette strength: closer + active
    // = stronger rim, farther = whisper.
    const t = Math.max(0, Math.min(1, d / range));
    const eased = 1 - (1 - t) * (1 - t);
    let opacity = nearAlpha + (GHOST_FAR_ALPHA - nearAlpha) * eased;
    if (_isEnemyActive(e)) opacity = Math.min(0.95, opacity + GHOST_ACTIVE_BOOST);
    _setEnemyGhost(e, true);
    e.group.visible = true;
    if (e.__ghostMat) {
      // Smoothly approach the target so flicker between LoS edges
      // doesn't strobe the ghost. ~5-frame ease-in.
      const cur = e.__ghostMat.uniforms.uOpacity.value;
      e.__ghostMat.uniforms.uOpacity.value = cur + (opacity - cur) * 0.25;
    }
  }
}

// Wall occlusion fade: any wall between the camera and the player goes
// translucent so the player is always visible. Restores cleanly once the
// wall no longer occludes.
const _occlFaded = new Set();
const _occlRaycaster = new THREE.Raycaster();
const _occlTargetPt = new THREE.Vector3();
const _occlDir = new THREE.Vector3();
function _fadeWall(m) {
  // Invisible collision proxies (props, elevator internals) live in
  // `obstacles` at opacity 0 on purpose. Bumping them to 0.5 would
  // reveal the default-white MeshBasicMaterial as a ghost box. Short-
  // circuit here so any caller that ends up handing us a proxy is
  // a no-op.
  if (m.userData?.isProp) return;
  if (m.material && m.material.opacity === 0 && m.userData?._origOpacity === undefined) return;
  const ud = m.userData;
  // First fade for this wall — stash original state AND flip
  // `transparent` to true ONCE. We leave `transparent` true forever
  // after; subsequent fade/restore cycles only change opacity, which
  // doesn't trigger a Three.js shader recompile. Prior version
  // toggled `transparent` on/off every cycle and called
  // `needsUpdate`, which caused intermittent frames where the wall
  // rendered with the cached opaque shader despite being marked
  // transparent — the symptom was "walls don't fade even though
  // raycaster is hitting them".
  if (ud._origOpacity === undefined) {
    ud._origOpacity = m.material.opacity;
    ud._origDepthWrite = m.material.depthWrite !== false;
    ud._origCastShadow = !!m.castShadow;
    if (!m.material.transparent) {
      m.material.transparent = true;
      m.material.needsUpdate = true;   // one-time program rebuild
    }
  }
  m.material.opacity = 0.3;
  m.material.depthWrite = false;
  m.castShadow = false;
}
function _restoreWall(m) {
  if (m.userData?.isProp) return;
  if (m.userData?._origOpacity === undefined) return;
  const ud = m.userData;
  // Leave `material.transparent` true permanently — flipping it back
  // pairs with _fadeWall flipping it forward and forces a Three.js
  // shader recompile each cycle, which was leaving frames where the
  // wall rendered with the cached opaque program. Opacity 1.0 + the
  // transparent flag is visually identical to a fully opaque mesh.
  m.material.opacity = ud._origOpacity ?? 1;
  m.material.depthWrite = ud._origDepthWrite !== false;
  m.castShadow = ud._origCastShadow !== false;
}
// Distance within which nearby enemies also trigger wall fades — so
// walls between the camera and an enemy you could conceivably engage
// go transparent automatically, not just walls between camera and
// player. Without this, small characters frequently got lost behind
// room edges and the player had to reposition to see them.
const OCCL_ENEMY_RANGE = 24;   // extended from 16 — covers typical rifle engagement arcs

function _addOcclusionHits(from, target, blockers, outSet) {
  _occlDir.copy(target).sub(from);
  const dist = _occlDir.length();
  if (dist < 0.001) return;
  _occlDir.normalize();
  _occlRaycaster.set(from, _occlDir);
  _occlRaycaster.far = dist;
  const hits = _occlRaycaster.intersectObjects(blockers, false);
  for (const h of hits) {
    if (h.object.userData?.isDoor) continue;
    // Invisible prop-collision proxies aren't walls — they live in
    // the obstacle list only for bullet / player collision. Fading
    // them is a no-op (skipped in _fadeWall) but adding them to the
    // tracking set makes the prior-frame restore path trigger and
    // reveal the default-white proxy material.
    if (h.object.userData?.isProp) continue;
    // Meshes at opacity 0 are invisible by design (hidden fills,
    // collision placeholders). Same risk of accidental reveal.
    if (h.object.material && h.object.material.opacity === 0
        && h.object.userData?._origOpacity === undefined) continue;
    outSet.add(h.object);
  }
}

// Reused per frame in updateWallOcclusion. The fan offset arrays are
// constants; constructing them in the function body allocated 11
// objects per frame (4 enemy fan + 7 cam offsets). _nextFaded is
// cleared at the start of each call so we can reuse the same Set.
const _ENEMY_FAN_OFFSETS = [
  { dx:  0.00, y: 1.75, dz:  0.00 },   // head
  { dx:  0.00, y: 1.10, dz:  0.00 },   // chest
  { dx:  0.40, y: 1.20, dz:  0.00 },   // right shoulder
  { dx: -0.40, y: 1.20, dz:  0.00 },   // left shoulder
];
const _CAM_CAST_OFFSETS = [
  { x:  0.00, y: 1.80, z:  0.00 },   // head centerline
  { x:  0.00, y: 2.20, z:  0.00 },   // tall-wall case
  { x:  0.45, y: 1.20, z:  0.00 },   // right shoulder
  { x: -0.45, y: 1.20, z:  0.00 },   // left shoulder
  { x:  0.00, y: 1.20, z:  0.45 },   // front of chest
  { x:  0.00, y: 1.20, z: -0.45 },   // back of chest
  { x:  0.00, y: 0.30, z:  0.00 },   // shins
];
const _nextFaded = new Set();
function updateWallOcclusion() {
  _nextFaded.clear();
  const nextFaded = _nextFaded;
  if (level.obstacles && level.obstacles.length && !playerDead) {
    const px = player.mesh.position.x;
    const pz = player.mesh.position.z;
    // 1. Walls between camera and PLAYER (keeps player always visible).
    _occlTargetPt.set(px, 1.0, pz);
    _addOcclusionHits(camera.position, _occlTargetPt, level.obstacles, nextFaded);

    // 2. Walls between camera and each relevant LIVING enemy. Every
    //    enemy casts a 4-ray silhouette fan (head, chest, both
    //    shoulders) so walls that clip part of their body still
    //    fade. The range rule is split by threat state:
    //      * ACTIVE enemies (alerted / chasing / firing / winding
    //        up / recovering — anything that isn't idle or asleep)
    //        get NO RANGE CAP. If they're a threat, the player
    //        needs to see them regardless of distance.
    //      * IDLE / SLEEPING enemies keep the `OCCL_ENEMY_RANGE`
    //        cap (24m) so the system doesn't burn budget revealing
    //        patrol-state gunmen across the whole map.
    //    All of this is still gated behind the quality flag.
    if (qualityFlags.wallOcclusionForEnemies) {
      const idleRangeSq = OCCL_ENEMY_RANGE * OCCL_ENEMY_RANGE;
      // Walk both lists by index — avoids the [...gunmen.gunmen, ...melees.enemies]
      // spread allocation that ran every frame.
      const gunmenList = gunmen.gunmen;
      const meleesList = melees.enemies;
      for (let i = 0, total = gunmenList.length + meleesList.length; i < total; i++) {
        const e = i < gunmenList.length ? gunmenList[i] : meleesList[i - gunmenList.length];
        if (!e.alive) continue;
        const ex = e.group.position.x, ez = e.group.position.z;
        // Active-state detection. Gunman state machine uses strings
        // (see gunman.js STATE table); melee rushers use the same
        // pattern. Any state other than "idle" / "sleep" / "dead"
        // counts as a threat worth revealing.
        const s = e.state;
        const active = !!s && s !== 'idle' && s !== 'sleep' && s !== 'dead';
        if (!active) {
          const d2 = (ex - px) * (ex - px) + (ez - pz) * (ez - pz);
          if (d2 > idleRangeSq) continue;
        }
        for (let k = 0; k < _ENEMY_FAN_OFFSETS.length; k++) {
          const off = _ENEMY_FAN_OFFSETS[k];
          _occlTargetPt.set(ex + off.dx, off.y, ez + off.dz);
          _addOcclusionHits(camera.position, _occlTargetPt, level.obstacles, nextFaded);
        }
      }
    }

    // 2b. Walls between camera and the CURRENT AIM POINT — if the
    //     player is pointing their cursor at a spot across a wall,
    //     reveal the obstruction so they understand why the shot
    //     won't land. Independent of enemy visibility, so it also
    //     works for pre-engagement "peek the corner" intent.
    if (qualityFlags.wallOcclusionForEnemies && lastAim) {
      _occlTargetPt.set(lastAim.x, 1.0, lastAim.z);
      _addOcclusionHits(camera.position, _occlTargetPt, level.obstacles, nextFaded);
    }

    // 3. Cast a fan of rays spanning the player's silhouette — chest
    //    and head height, plus lateral offsets so walls that clip the
    //    side of the character (shoulders mid-melee-swing, legs while
    //    moving) also register as occluders. Without the X/Z offsets
    //    a single centerline ray misses walls that occlude the arms
    //    or the outer edge of the body while moving / attacking,
    //    which is exactly the "wall transparency stopped working
    //    during melee / locomotion" symptom.
    for (let i = 0; i < _CAM_CAST_OFFSETS.length; i++) {
      const off = _CAM_CAST_OFFSETS[i];
      _occlTargetPt.set(px + off.x, off.y, pz + off.z);
      _addOcclusionHits(camera.position, _occlTargetPt, level.obstacles, nextFaded);
    }
  }
  for (const m of _occlFaded) {
    if (!nextFaded.has(m)) _restoreWall(m);
  }
  for (const m of nextFaded) {
    if (!_occlFaded.has(m)) _fadeWall(m);
  }
  _occlFaded.clear();
  for (const m of nextFaded) _occlFaded.add(m);
}

function updateReloadHud(weapon, effWeapon) {
  if (!reloadFillEl) return;
  if (!weapon || weapon.type !== 'ranged' || typeof weapon.ammo !== 'number') {
    reloadFillEl.style.width = '100%';
    reloadFillEl.classList.remove('active');
    reloadLabelEl.classList.remove('active');
    reloadLabelEl.textContent = 'READY';
    reloadTextEl.textContent = '';
    return;
  }
  const total = (effWeapon && effWeapon.reloadTime) || weapon.reloadTime || 1.5;
  if (weapon.reloadingT > 0) {
    const pct = 1 - weapon.reloadingT / total;
    reloadFillEl.style.width = `${Math.max(0, pct * 100)}%`;
    reloadFillEl.classList.add('active');
    reloadLabelEl.classList.add('active');
    reloadLabelEl.textContent = 'RELOADING';
    reloadTextEl.textContent = `${weapon.reloadingT.toFixed(1)}s`;
  } else {
    const magSize = (effWeapon && effWeapon.magSize) || weapon.magSize;
    reloadFillEl.style.width = '100%';
    reloadFillEl.classList.remove('active');
    reloadLabelEl.classList.remove('active');
    if (weapon.infiniteAmmo) {
      reloadLabelEl.textContent = 'READY';
      reloadLabelEl.style.color = '';
      reloadTextEl.textContent = '∞';
    } else if (weapon.ammo === 0) {
      reloadLabelEl.textContent = 'EMPTY';
      reloadLabelEl.style.color = '#c94a3a';
      reloadTextEl.textContent = `${weapon.ammo}/${magSize}`;
    } else {
      reloadLabelEl.textContent = 'READY';
      reloadLabelEl.style.color = '';
      reloadTextEl.textContent = `${weapon.ammo}/${magSize}`;
    }
  }
}

function updateLootPrompt() {
  const near = loot.nearest(player.mesh.position, tunables.loot.pickupRadius);
  const body = !near ? nearestBody(player.mesh.position, 2.2) : null;
  const npc = (!near && !body) ? level.nearestNPC(player.mesh.position, 2.5) : null;
  if (promptEl) {
    if (near) {
      const pile = loot.allWithin(player.mesh.position, tunables.loot.pickupRadius);
      promptEl.style.display = 'block';
      promptEl.textContent = pile.length >= 2
        ? `[E] examine ${pile.length} items on the ground`
        : `[E] pick up ${near.item.name}`;
    } else if (body && !body.looted && body.loot && body.loot.length) {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] search body`;
    } else if (body && body.looted) {
      promptEl.style.display = 'block';
      promptEl.textContent = `(body looted)`;
    } else if (npc && npc.kind === 'merchant') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] trade with merchant`;
    } else if (npc && npc.kind === 'bearMerchant') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] speak with the Great Bear`;
    } else if (npc && npc.kind === 'healer') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] speak with the healer`;
    } else if (npc && npc.kind === 'gunsmith') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] visit the gunsmith`;
    } else if (npc && npc.kind === 'armorer') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] visit the armorer`;
    } else if (npc && npc.kind === 'tailor') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] visit the tailor`;
    } else if (npc && npc.kind === 'relicSeller') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] browse relics`;
    } else if (npc && npc.kind === 'blackMarket') {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] enter the black market`;
    } else if (level.nearElevatorDoor(player.mesh.position)) {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] open elevator door`;
    } else if (findExecuteTarget()) {
      promptEl.style.display = 'block';
      promptEl.textContent = `[F] execute`;
    } else if (level.isPlayerInExit(player.mesh.position) && exitCooldown <= 0) {
      promptEl.style.display = 'block';
      promptEl.textContent = `[E] extract (level ${level.index + 1})`;
    } else {
      promptEl.style.display = 'none';
    }
  }
  return { nearItem: near, body, npc };
}

function tryInteract({ nearItem, body, npc }) {
  if (nearItem) {
    // Two or more items in the pickup radius — open the ground-loot modal
    // instead of auto-picking one. Otherwise fast single-item pickup.
    const nearby = loot.allWithin(player.mesh.position, tunables.loot.pickupRadius);
    if (nearby.length >= 2) {
      const target = {
        loot: nearby.map(n => n.item),
        _groundRefs: nearby.slice(),
        _removeGround: (ref) => { loot.remove(ref); sfx.pickup(); },
        looted: false,
      };
      lootUI.open(target);
      return;
    }
    const result = inventory.add(nearItem.item);
    if (!result.placed) return;
    loot.remove(nearItem);
    sfx.pickup();
    if (result.slot === 'primary' || result.slot === 'melee') onInventoryChanged();
    recomputeStats();
    inventoryUI.render();
    return;
  }
  if (body && !body.looted && body.loot && body.loot.length > 0) {
    lootUI.open(body);
    return;
  }
  if (npc && ['merchant', 'bearMerchant', 'healer', 'gunsmith',
              'armorer', 'tailor', 'relicSeller', 'blackMarket'].includes(npc.kind)) {
    if (npc.kind === 'bearMerchant' && !npc.stock) npc.stock = makeMerchantStock();
    shopUI.open(npc);
    return;
  }
  if (level.nearElevatorDoor(player.mesh.position)) {
    if (level.openElevatorDoor()) sfx.uiAccept();
    return;
  }
  // Keycard-gated door — consumes a held token matching the colour.
  // Shows a "need X key" prompt via transientHudMsg if the player
  // steps up without one in their pocket.
  const keyResult = level.tryKeycardUnlock(player.mesh.position, 2.6, playerKeys);
  if (keyResult) {
    if (keyResult.consumed) {
      playerKeys.delete(keyResult.consumed);
      sfx.doorUnlock();
      transientHudMsg(`${keyResult.consumed.toUpperCase()} KEY USED`, 1.4);
    } else if (keyResult.needsKey) {
      transientHudMsg(`Need ${keyResult.needsKey.toUpperCase()} keycard`, 1.4);
      sfx.empty();
    }
    return;
  }
  if (level.isPlayerInExit(player.mesh.position) && exitCooldown <= 0) {
    extractPending = true;
  }
}

// Effective max charges / cooldown for a throwable, after Grenadier
// skill modifiers. Item fields are the base values (set by the def);
// these helpers fold in derivedStats each call so skill changes are
// reflected immediately without mutating the item.
function throwableMaxCharges(item) {
  const base = (item?.maxCharges | 0) || 1;
  return base + (derivedStats.throwableChargeBonus | 0);
}
function throwableCooldownSec(item) {
  const base = item?.cooldownSec ?? 120;
  return Math.max(1, base * (derivedStats.throwableCooldownMult || 1));
}
function applyConsumable(item) {
  if (!item) return false;
  // Throwables don't consume — they spend a charge and start a
  // cooldown. If no charges remain, refuse the use (the action-bar
  // cooldown UI already signals this to the player).
  if (item.type === 'throwable') {
    if ((item.charges | 0) <= 0) { sfx.empty?.(); return false; }
    const ok = throwItem(item);
    if (!ok) return false;
    item.charges = Math.max(0, (item.charges | 0) - 1);
    // Start the per-charge cooldown if this throw took us below max.
    if (item.charges < throwableMaxCharges(item) && item.cooldownT <= 0) {
      item.cooldownT = throwableCooldownSec(item);
    }
    return true;
  }
  if (!item.useEffect) return false;
  const e = item.useEffect;
  if (e.kind === 'heal') {
    // Pass through `cures` so healing items can clear bleed / broken bones.
    player.heal(e.amount, { cures: e.cures || [] });
    sfx.uiAccept();
    return true;
  }
  if (e.kind === 'buff') {
    buffs.grant(e.id || 'buff', e.mods || {}, e.life || 15);
    sfx.uiAccept();
    return true;
  }
  return false;
}

// --- Throwables -----------------------------------------------------
// Shared arc throw for all throwable items — spec specifies the
// on-landing behaviour via `throwKind` ('frag' | 'molotov' | 'flash'
// | 'stun'). Handled in `onProjectileExplode` below.
function throwItem(item) {
  if (!lastPlayerInfo || !lastAim) return false;
  const muzzle = lastPlayerInfo.muzzleWorld ? lastPlayerInfo.muzzleWorld.clone()
    : player.mesh.position.clone().setY(1.2);
  // Target the GROUND at the cursor — clamp aim.y to 0 regardless of
  // what the cursor picked (enemy torso, mid-air, wall). Throwables
  // should land where the player can see the cursor disc, not arc up
  // to an enemy's head and airburst.
  const aim = new THREE.Vector3(lastAim.x, 0, lastAim.z);
  const gravity = 9.8;
  // Arc peak scales with horizontal throw distance — a short toss
  // barely arcs (apex ~0.35m above muzzle), a max-range throw peaks
  // at ~1.5 × player height (~2.7m). Lerp between them so mid-range
  // throws feel natural. Cap the apex so the grenade can never loft
  // absurdly high regardless of distance.
  const dx = aim.x - muzzle.x, dz = aim.z - muzzle.z;
  const throwDist = Math.hypot(dx, dz);
  const MIN_APEX = 0.35;
  const MAX_APEX = 2.7;
  const apex = MIN_APEX + (MAX_APEX - MIN_APEX) * Math.min(1, throwDist / 14);
  const vel = ProjectileManager.ballisticVelocityApex(muzzle, aim, apex, gravity);
  projectiles.spawn({
    pos: muzzle,
    vel,
    type: 'grenade',
    lifetime: item.fuse ?? 2.0,
    // Smaller body + smaller default trail make the projectile read
    // as a hand-held grenade instead of a beach ball mid-flight.
    radius: 0.07,
    color: item.throwKind === 'molotov' ? 0xff8030
         : item.throwKind === 'flash'   ? 0xfff0a0
         : item.throwKind === 'stun'    ? 0x80a0ff
         : 0x60a040,
    explosion: {
      radius: item.aoeRadius ?? 3.5,
      damage: item.aoeDamage ?? 0,
      shake: item.aoeShake ?? 0.35,
    },
    owner: 'player',
    gravity,
    // Grenades bounce just a touch — enough that they land short and
    // settle, instead of rolling across a room. Molotov still
    // shatters on impact.
    bounciness: item.throwKind === 'molotov' ? 0.0 : 0.15,
    throwKind: item.throwKind || 'frag',
    fireDuration: item.fireDuration,
    fireTickDps: item.fireTickDps,
    blindDuration: item.blindDuration,
    stunDuration: item.stunDuration,
  });
  sfx.uiAccept();
  return true;
}

// --- Fire zones -----------------------------------------------------
// Persistent DoT patches left by molotovs. Each tick we iterate the
// list, burn alive enemies within `radius`, and decay `t` toward
// `life`. Visual: a flat orange disc on the ground plus a few small
// flickering flame spheres.
// Burn-damage readout — fire / molotov DoT applies in tiny per-frame
// increments (e.g. 14 dps * 1/60s = 0.23 dmg/frame) which would spam
// unreadable damage numbers. Instead we accumulate per enemy and
// spawn one combined number every `BURN_READOUT_INTERVAL` seconds.
// WeakMaps so the bookkeeping auto-GCs when an enemy gets removed.
const _burnAccum = new WeakMap();
const _burnAccumT = new WeakMap();
const BURN_READOUT_INTERVAL = 0.5;
function trackBurnDamage(c, dmg) {
  if (!c || !dmg || !isFinite(dmg)) return;
  _burnAccum.set(c, (_burnAccum.get(c) || 0) + dmg);
}

// Player buff aura — a flat ring under the character plus a couple of
// small vertical "emanation" sprites above it, color-tinted per buff
// so the player can see at a glance what's active. Pulses while the
// buff is live and fades out in the last second. Buffs with no
// entry in BUFF_AURA_COLORS still show the default cream ring.
const BUFF_AURA_COLORS = {
  combatStim: 0xff5050,   // bright red — "amped up"
  adrenaline: 0xff8040,   // warm orange
  energy:     0xffe040,   // yellow
  morphine:   0x6ad0ff,   // cool blue
  regen:      0x70ff80,   // green
  bloodlust:  0xff2030,   // deep red
  red_string: 0xb040ff,   // purple (artifact buff)
};
const _buffAuras = new Map();  // buffId → { ring, particles:[] }
function _ensureBuffAura(id) {
  if (_buffAuras.has(id)) return _buffAuras.get(id);
  const color = BUFF_AURA_COLORS[id] ?? 0xf2e7c9;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.85, 24, 1),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);
  // Three small upward-drifting motes, recycled each tick — sit on
  // the ring's radius and slow-pulse their Y so they read as
  // emanation from the character.
  const particles = [];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 6, 5),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.7,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    p.userData.phase = (i / 3) * Math.PI * 2;
    scene.add(p);
    particles.push(p);
  }
  const aura = { ring, particles, color };
  _buffAuras.set(id, aura);
  return aura;
}
function _disposeBuffAura(id) {
  const a = _buffAuras.get(id);
  if (!a) return;
  scene.remove(a.ring);
  a.ring.geometry.dispose();
  a.ring.material.dispose();
  for (const p of a.particles) {
    scene.remove(p);
    p.geometry.dispose();
    p.material.dispose();
  }
  _buffAuras.delete(id);
}
function _tickBuffAuras(dt) {
  const active = new Set();
  const px = player.mesh.position.x, pz = player.mesh.position.z;
  const now = performance.now() * 0.001;
  for (const b of buffs.buffs) {
    active.add(b.id);
    const aura = _ensureBuffAura(b.id);
    // Pulse + fade in last second of life.
    const lifeLeft = Math.max(0, b.life - b.t);
    const fade = lifeLeft < 1 ? lifeLeft : 1;
    const pulse = 0.7 + 0.3 * Math.sin(now * 6);
    aura.ring.position.set(px, 0.06, pz);
    aura.ring.material.opacity = 0.55 * pulse * fade;
    // Slight radius breathing so the ring doesn't read as a static decal.
    aura.ring.scale.setScalar(0.95 + 0.15 * Math.sin(now * 4));
    for (let i = 0; i < aura.particles.length; i++) {
      const p = aura.particles[i];
      const phase = now * 1.4 + p.userData.phase;
      const r = 0.7;
      p.position.x = px + Math.cos(phase) * r;
      p.position.z = pz + Math.sin(phase) * r;
      p.position.y = 0.3 + ((now * 0.8 + i * 0.4) % 1) * 1.6;
      p.material.opacity = 0.55 * fade * (1 - (p.position.y - 0.3) / 1.6);
    }
  }
  // Dispose auras for buffs that expired this frame.
  for (const id of _buffAuras.keys()) {
    if (!active.has(id)) _disposeBuffAura(id);
  }
}
function _tickBurnReadouts(dt) {
  const sweep = (list) => {
    for (const c of list) {
      const accum = _burnAccum.get(c);
      if (!accum) continue;
      let t = (_burnAccumT.get(c) || 0) + dt;
      const interval = BURN_READOUT_INTERVAL;
      if (t >= interval || !c.alive) {
        const rounded = Math.round(accum);
        if (rounded > 0) {
          const pt = new THREE.Vector3(c.group.position.x, 1.2, c.group.position.z);
          // Reuse the 'burn' zone tag so styling stays consistent with
          // other damage types — spawnDamageNumber picks a color per
          // zone / tag.
          spawnDamageNumber(pt, camera, rounded, 'burn');
        }
        _burnAccum.set(c, 0);
        _burnAccumT.set(c, 0);
      } else {
        _burnAccumT.set(c, t);
      }
    }
  };
  sweep(gunmen.gunmen);
  sweep(melees.enemies);
}

const _fireZones = [];
function spawnFireZone(pos, radius, duration, dps) {
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff6020, transparent: true, opacity: 0.35,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.05, pos.z);
  scene.add(ring);
  // Fire zones are now visualised by continuous upward-rising orbs
  // spawned from `_tickFireZones`, not a fixed ring of bobbing
  // flames. The ground ring stays for the DoT footprint read.
  _fireZones.push({
    x: pos.x, z: pos.z, radius, life: duration, t: 0,
    dps, ring,
    emitT: 0,            // cooldown between orb bursts
  });
}
function _tickFireZones(dt) {
  for (let i = _fireZones.length - 1; i >= 0; i--) {
    const z = _fireZones[i];
    z.t += dt;
    // Periodic orb bursts while the zone is alive — a handful every
    // ~0.25s, scaled down near the end of life so the emission fades
    // with the DoT footprint. Feeds `_fireOrbs` which each rise and
    // disappear independently.
    z.emitT -= dt;
    if (z.emitT <= 0) {
      const lifeLeft = Math.max(0, 1 - z.t / z.life);
      const emitCount = Math.max(0, Math.round(3 * lifeLeft));
      if (emitCount > 0) {
        spawnFireOrbBurst({ x: z.x, z: z.z }, z.radius, emitCount);
      }
      z.emitT = 0.22 + Math.random() * 0.1;
    }
    // Fade the ground ring out over the last 25% of life.
    const fadeT = Math.max(0, (z.t - z.life * 0.75) / (z.life * 0.25));
    z.ring.material.opacity = 0.35 * (1 - fadeT);
    // DoT — burn every alive enemy within the disc.
    const rSq = z.radius * z.radius;
    const apply = (list) => {
      for (const c of list) {
        if (!c.alive) continue;
        const dx = c.group.position.x - z.x;
        const dz = c.group.position.z - z.z;
        if (dx * dx + dz * dz > rSq) continue;
        c.burnT = Math.max(c.burnT || 0, 1.0);   // keep topped up while in zone
        const prevHp = c.hp;
        const tickDmg = z.dps * dt;
        c.hp -= tickDmg;
        trackBurnDamage(c, tickDmg);
        if (c.hp <= 0 && prevHp > 0) {
          c.alive = false;
          onEnemyKilled(c);
        }
      }
    };
    apply(gunmen.gunmen);
    apply(melees.enemies);
    if (z.t >= z.life) {
      scene.remove(z.ring);
      z.ring.geometry.dispose();
      z.ring.material.dispose();
      _fireZones.splice(i, 1);
    }
  }
}

function tryUseMedkit() {
  const found = inventory.findFirstConsumable(it => it.useEffect?.kind === 'heal');
  if (!found) return;
  const it = inventory.takeFromBackpack(found.idx);
  if (it) applyConsumable(it);
  inventoryUI.render();
}

function useActionSlot(idx) {
  const item = inventory.actionSlotItem(idx);
  if (!item) return;
  if (item.type === 'throwable') {
    // Throwables stay bound — applyConsumable spends a charge + starts
    // cooldown, but never removes the item from the inventory.
    applyConsumable(item);
    inventoryUI.render();
    renderActionBar();
    return;
  }
  // Everything else (heal / buff consumables) is single-use: pull
  // it out and apply.
  const taken = inventory.consumeActionSlot(idx);
  if (taken) { applyConsumable(taken); inventoryUI.render(); renderActionBar(); }
}

// Tick every throwable in the player's inventory. When cooldownT
// drains, refill one charge and — if we're still under the effective
// max — restart the timer so the next charge refills in turn.
// Refreshes the action bar on every tick while any throwable has an
// active cooldown so the "Ns" countdown updates smoothly instead of
// freezing on the initial value.
function tickThrowableCooldowns(dt) {
  const items = inventory.allThrowables();
  if (items.length === 0) return;
  let anyActive = false;
  for (const it of items) {
    if (it.charges == null) it.charges = throwableMaxCharges(it);
    const max = throwableMaxCharges(it);
    if (it.charges >= max) { it.cooldownT = 0; continue; }
    it.cooldownT = Math.max(0, (it.cooldownT || 0) - dt);
    if (it.cooldownT <= 0) {
      it.charges = Math.min(max, (it.charges | 0) + 1);
      if (it.charges < max) it.cooldownT = throwableCooldownSec(it);
    }
    anyActive = true;
  }
  if (anyActive) renderActionBar();
}

// Action-bar DOM rendering + drag-drop + click handlers.
// Weapon-bar HUD (keys 1-4). Mirrors the rotation order: weapon1, weapon2,
// melee, and an empty 4th slot reserved for future loadout expansion.
function renderWeaponBar() {
  const bar = document.getElementById('weapon-bar');
  if (!bar) return;
  const rotation = inventory.getWeaponRotation();
  const slots = bar.querySelectorAll('.weapon-slot');
  slots.forEach((el, i) => {
    const w = rotation[i] || null;
    const keyLabel = `<span class="action-key">${i + 1}</span>`;
    const active = w && i === currentWeaponIndex;
    el.classList.toggle('active', !!active);
    el.classList.toggle('empty', !w);
    if (!w) {
      el.innerHTML = `${keyLabel}<span class="weapon-label">—</span>`;
      return;
    }
    const icon = thumbnailFor(w);
    const label = w.class || w.type || '';
    el.innerHTML = `${keyLabel}${icon ? `<img src="${icon}" alt="">` : ''}<span class="weapon-label">${label}</span>`;
    // One-time hookup — click to swap, right-click for details.
    if (!el._wired) {
      el._wired = true;
      el.addEventListener('click', () => {
        const rot = inventory.getWeaponRotation();
        if (rot[i]) setWeaponIndex(i);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const rot = inventory.getWeaponRotation();
        const it = rot[i];
        if (it && window.__showDetails) window.__showDetails(it);
      });
    }
  });
}

function renderActionBar() {
  const slots = document.querySelectorAll('.action-slot');
  const maxSlots = inventory.maxActionSlots();
  slots.forEach((el, i) => {
    // Hide slots beyond the current gear-granted maximum (e.g. the bonus
    // 4th slot appears only when a belt/plate-carrier unlocks it).
    if (i >= maxSlots) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const item = inventory.actionSlotItem(i);
    const keyLabel = `<span class="action-key">${i + 5}</span>`;
    if (!item) {
      el.innerHTML = keyLabel;
      el.classList.remove('filled');
      return;
    }
    const icon = thumbnailFor(item);
    const tint = item.tint ?? 0xaaaaaa;
    const tintStr = `#${tint.toString(16).padStart(6, '0')}`;
    // Throwables show charges + cooldown progress; heal / buff
    // consumables fall back to the plain name label.
    let extra = `<span class="action-count" style="color:${tintStr}">${item.name}</span>`;
    let cooldownOverlay = '';
    if (item.type === 'throwable') {
      const max = throwableMaxCharges(item);
      const charges = item.charges | 0;
      extra = `<span class="action-count" style="color:${tintStr}">${item.name} · ${charges}/${max}</span>`;
      if (charges < max && (item.cooldownT || 0) > 0) {
        const total = throwableCooldownSec(item);
        const pct = Math.max(0, Math.min(1, 1 - (item.cooldownT / total)));
        const secs = Math.ceil(item.cooldownT);
        cooldownOverlay = `<div class="action-cd"><div class="action-cd-fill" style="height:${((1 - pct) * 100).toFixed(0)}%"></div><div class="action-cd-text">${secs}s</div></div>`;
      }
    }
    el.innerHTML = `${keyLabel}${icon ? `<img src="${icon}" alt="">` : ''}${extra}${cooldownOverlay}`;
    el.classList.add('filled');
    el.classList.toggle('empty-charges',
      item.type === 'throwable' && (item.charges | 0) <= 0);
  });
}

function wireActionBar() {
  const slots = document.querySelectorAll('.action-slot');
  slots.forEach((el, i) => {
    el.addEventListener('click', () => useActionSlot(i));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const item = inventory.actionSlotItem(i);
      if (item && window.__showDetails) window.__showDetails(item);
    });
    // Start a drag for swap — the slot remembers its own index.
    el.addEventListener('dragstart', (e) => {
      const item = inventory.actionSlotItem(i);
      if (!item) { e.preventDefault(); return; }
      setDragState({ from: 'actionBar', slot: i, item });
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      const d = getDragState();
      if (d && d.from === 'actionBar') setDragState(null);
    });
    el.addEventListener('dragover', (e) => {
      const d = getDragState();
      if (!d) return;
      if (d.from === 'actionBar') { e.preventDefault(); el.classList.add('drop-ok'); return; }
      if (d.item && (d.item.type === 'consumable' || d.item.type === 'throwable')) {
        e.preventDefault(); el.classList.add('drop-ok');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-ok'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-ok');
      const d = getDragState();
      if (!d) return;
      if (d.from === 'actionBar') {
        inventory.swapActionSlots(d.slot, i);
      } else if (d.item && (d.item.type === 'consumable' || d.item.type === 'throwable')) {
        inventory.assignActionSlot(i, d.item);
      } else {
        return;
      }
      setDragState(null);
      renderActionBar();
    });
  });
  // Slots need to be draggable for HTML5 drag to even fire dragstart.
  slots.forEach((el) => el.setAttribute('draggable', 'true'));
}
wireActionBar();
renderActionBar();
renderWeaponBar();
// Exposed so the inventory UI's custom pointer-drag can refresh the
// HUD after dropping an item into an action slot.
window.__renderActionBar = renderActionBar;

async function runExtract() {
  paused = true;
  input.clearMouseState();
  inventoryUI.hide();
  exitCooldown = 1.0;
  await skillPickUI.show();
  input.clearMouseState();
  paused = false;
  recomputeStats();
  regenerateLevel();
}

// Firing a gun is noisy: any alive enemy within noiseRange of the muzzle
// AND in an audible room (same room, or adjacent through an open door)
// transitions from idle → alerted (or → chase for melee). Suppressors
// from attachments shorten the radius.
function alertEnemiesFromShot(origin) {
  const weapon = currentWeapon();
  const eff = weapon ? effectiveWeapon(weapon) : null;
  const suppressed = eff?.lightAttachment === undefined && weapon?.attachments?.muzzle?.modifier?.suppressed;
  const noiseRange = suppressed ? 10 : 22;
  const rSq = noiseRange * noiseRange;
  const px = origin.x, pz = origin.z;
  const blockers = level.solidObstacles();
  const _fromV = new THREE.Vector3(px, 1.2, pz);
  const _toV = new THREE.Vector3();
  // Build the set of rooms the shot can be heard in: the shot's own
  // room plus any directly-connected rooms whose shared door isn't
  // a locked keycard gate. Two rooms away and they don't hear it,
  // even if doors line up — that was the "whole map wakes up" bug.
  const shotRoom = level.roomAt(px, pz);
  const audibleRooms = new Set();
  if (shotRoom) {
    audibleRooms.add(shotRoom.id);
    for (const n of shotRoom.neighbors || []) {
      const door = level._doorBetween(shotRoom.id, n.otherId);
      // No door at all = open doorway; locked-and-not-unlocked blocks
      // the sound; everything else (open, default-unlocked) passes.
      if (door && door.userData.keyRequired && !door.userData.unlocked) continue;
      audibleRooms.add(n.otherId);
    }
  }
  const alert = (e) => {
    if (!e.alive) return;
    // Room gate — skip any enemy whose room isn't in the audible set.
    // Enemies with roomId -1 (unassigned) fall back to radius-only so
    // we don't regress to silence for anything the level didn't tag.
    if (shotRoom && e.roomId !== undefined && e.roomId !== -1
        && !audibleRooms.has(e.roomId)) return;
    const dx = e.group.position.x - px;
    const dz = e.group.position.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > rSq) return;
    // LoS always required beyond point-blank so sound doesn't pass
    // through walls. The tiny 3 m bypass handles a same-room scuffle
    // where a prop (couch, crate) blocks the raycast between shooter
    // and listener — still inside the room, so still audible.
    if (d2 > 9) {
      _toV.set(e.group.position.x, 1.2, e.group.position.z);
      if (!combat.hasLineOfSight(_fromV, _toV, blockers)) return;
    }
    e.lastKnownX = px;
    e.lastKnownZ = pz;
    if (e.state === 'idle') {
      if (melees.enemies.includes(e)) e.state = 'chase';
      else { e.state = 'alerted'; e.reactionT = tunables.ai.reactionTime * 0.6; }
      propagateAggro(e);
    }
  };
  for (const g of gunmen.gunmen) alert(g);
  for (const m of melees.enemies) alert(m);
}

function propagateAggro(alerted) {
  const rid = alerted.roomId;
  if (rid === -1 || rid === undefined) return;
  for (const g of gunmen.gunmen) {
    if (!g.alive || g === alerted || g.roomId !== rid) continue;
    if (g.state === 'idle') {
      g.state = 'alerted';
      g.reactionT = tunables.ai.reactionTime;
    }
  }
  for (const m of melees.enemies) {
    if (!m.alive || m === alerted || m.roomId !== rid) continue;
    if (m.state === 'idle') m.state = 'chase';
  }
}

function onRoomFirstEntered(room) {
  // Boss-arena lock-in: walking into a live boss room slams every
  // connected door shut and tints them red. Unlock chain runs from
  // onEnemyKilled when the boss dies. Only fires if the boss is
  // still alive on entry (so a post-kill revisit isn't punished).
  // Note: the actual seal now runs from tryBossSeal each tick so we
  // don't trap the player inside with the boss stranded outside.
  if (room.type === 'boss') {
    tryBossSeal(room);
  }
  if (room.type !== 'combat' && room.type !== 'subBoss' && room.type !== 'boss') return;
  // Crouched / crouch-sprint entries are stealth attempts — no surprise
  // rush. Only standing entries risk tripping an enemy's "heard that".
  if (inputStateCrouchHeld()) return;
  const roll = Math.random();
  // Standing entry = 20% chance a single enemy with line of sight notices.
  if (roll > 0.20) return;
  const playerPt = new THREE.Vector3(player.mesh.position.x, 1.0, player.mesh.position.z);
  const candidates = [
    ...gunmen.gunmen.filter(g => g.alive && g.roomId === room.id),
    ...melees.enemies.filter(e => e.alive && e.roomId === room.id),
  ].filter(c => {
    // Only enemies with actual LoS can surprise-rush on entry.
    const eye = new THREE.Vector3(c.group.position.x, 1.2, c.group.position.z);
    return combat.hasLineOfSight(eye, playerPt, level.obstacles);
  });
  if (candidates.length === 0) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  if (pick.state === 'idle') {
    if (melees.enemies.includes(pick)) pick.state = 'chase';
    else { pick.state = 'alerted'; pick.reactionT = tunables.ai.reactionTime * 0.6; }
  }
}

// Grab the latest inputState's crouchHeld — the tick captures it as part of
// its own locals, so we peek at the latest sampled snapshot.
let lastSampledInput = null;
function inputStateCrouchHeld() {
  return !!(lastSampledInput && lastSampledInput.crouchHeld);
}

// Seal boss doors only when the boss is actually inside the boss-room
// bounds. Earlier version fired on player's first entry regardless of
// the boss's position — if the boss had pathed out into the corridor
// chasing the player, the seal locked the player in with the boss
// stranded outside and unreachable. This gets called every frame the
// player is in the boss room until the seal fires exactly once.
function tryBossSeal(room) {
  if (!room || room.type !== 'boss' || room._sealed) return;
  const b = room.bounds;
  const insideRoom = (c) => {
    const p = c.group.position;
    return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  };
  let bossInside = false;
  let bossExists = false;
  for (const g of gunmen.gunmen) {
    if (!g.alive || g.tier !== 'boss' || g.roomId !== room.id) continue;
    bossExists = true;
    if (insideRoom(g)) bossInside = true;
  }
  for (const m of melees.enemies) {
    if (!m.alive || m.tier !== 'boss' || m.roomId !== room.id) continue;
    bossExists = true;
    if (insideRoom(m)) bossInside = true;
  }
  if (!bossExists) {
    // Boss was killed before the seal fired — mark sealed so we don't
    // keep checking. Doors stay open so the player can leave.
    room._sealed = true;
    return;
  }
  if (!bossInside) return;   // wait for the boss to come back inside
  level.lockDoorsForRoom(room.id);
  room._sealed = true;
  // Nudge the player out of any door they're currently standing inside.
  // Without this, a door that seals while the player is mid-threshold
  // re-materialises around them as a solid collision wall and traps
  // them against their own hitbox. Push them a meter into the boss
  // room along the door-to-room-centre axis.
  _ejectPlayerFromSealedDoors(room);
  transientHudMsg('DOORS SEALED — BOSS FIGHT', 2.2);
}

function _ejectPlayerFromSealedDoors(room) {
  const pr = tunables.player.collisionRadius;
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  for (const mesh of level.obstacles) {
    if (!mesh.userData.isDoor) continue;
    if (!mesh.userData.connects?.includes(room.id)) continue;
    const b = mesh.userData.collisionXZ;
    if (!b) continue;
    // Player AABB overlap test (circle-vs-AABB approximation — circle
    // centre inside the door box expanded by pr).
    if (px < b.minX - pr || px > b.maxX + pr) continue;
    if (pz < b.minZ - pr || pz > b.maxZ + pr) continue;
    // Push toward the boss room's centre so the player ends up on the
    // arena side of the sealed threshold. Add a 0.2 m safety margin on
    // top of the radius so the collision resolver doesn't immediately
    // clamp them back into the door.
    let toRoomX = room.cx - mesh.userData.cx;
    let toRoomZ = room.cz - mesh.userData.cz;
    const l = Math.hypot(toRoomX, toRoomZ) || 1;
    toRoomX /= l; toRoomZ /= l;
    // Distance along the toRoom vector needed to exit the door's AABB
    // on the room-side, plus the player's radius and a 0.2 m margin
    // so the collision resolver doesn't clamp them straight back in.
    const geo = mesh.geometry?.parameters;
    const halfW = (geo?.width || 1.2) / 2;
    const halfD = (geo?.depth || 1.2) / 2;
    const halfExtent = halfW * Math.abs(toRoomX) + halfD * Math.abs(toRoomZ);
    const push = halfExtent + pr + 0.2;
    player.mesh.position.x = mesh.userData.cx + toRoomX * push;
    player.mesh.position.z = mesh.userData.cz + toRoomZ * push;
    // One overlap is enough — bail after the first eject so two doors
    // don't fight over the player's new position.
    return;
  }
}

function updateRoomClearance(playerPos) {
  const here = level.roomAt(playerPos.x, playerPos.z);
  if (here && !here.entered) {
    here.entered = true;
    onRoomFirstEntered(here);
  }
  // Keep retrying the boss seal every frame the player is standing in
  // the boss room. Catches the case where the boss is outside on first
  // entry but wanders back in later.
  if (here && here.type === 'boss' && !here._sealed) {
    tryBossSeal(here);
  }
  for (const r of level.rooms) {
    if (r.cleared || !r.entered) continue;
    let alive = 0;
    for (const g of gunmen.gunmen) if (g.alive && g.roomId === r.id) alive++;
    for (const m of melees.enemies) if (m.alive && m.roomId === r.id) alive++;
    if (alive === 0) {
      r.cleared = true;
      level.unlockDoorsForRoom(r.id);
      sfx.roomClear();
      sfx.doorUnlock();
      if (r.id === level.bossRoomId) level.revealExit();
      // Bloodied Rosary artifact — heal a chunk of max HP on clear.
      const heal = (derivedStats.roomClearHealFrac || 0);
      if (heal > 0) {
        const maxHp = (tunables.player.maxHealth + (derivedStats.maxHealthBonus || 0));
        player.heal(Math.round(maxHp * heal));
      }
    }
  }
}

// Execute: F key on an idle enemy whose back is to you.
function findExecuteTarget() {
  const pos = player.mesh.position;
  const maxR = tunables.stealth.executeRange + (derivedStats.executeRangeBonus || 0);
  const maxRSq = maxR * maxR;
  const check = (e) => {
    if (!e.alive || e.state !== 'idle') return false;
    const dx = pos.x - e.group.position.x;
    const dz = pos.z - e.group.position.z;
    const dSq = dx * dx + dz * dz;
    if (dSq > maxRSq || dSq < 0.01) return false;
    const d = Math.sqrt(dSq);
    const fx = Math.sin(e.group.rotation.y);
    const fz = Math.cos(e.group.rotation.y);
    const dot = (fx * dx + fz * dz) / d;
    return dot < tunables.stealth.executeBackDot;
  };
  for (const g of gunmen.gunmen) if (check(g)) return g;
  for (const m of melees.enemies) if (check(m)) return m;
  return null;
}

function executeTarget(target) {
  if (!target || !target.alive) return false;
  target.hp = 0;
  target.alive = false;
  target.deathT = 0;
  target.state = 'dead';
  // Silent kill — the back-stab doesn't broadcast a death scream or
  // alert roommates. Keeps stealth-chains viable when there are
  // multiple patrollers in the same room.
  onEnemyKilled(target, { silent: true });
  if (skillTree.level('executionerPerk') > 0) {
    buffs.grant('executionerMastery', { damageMult: 1.3 }, 6);
  }

  // Pop the head off in the direction the player faces.
  const dir = new THREE.Vector3(
    target.group.position.x - player.mesh.position.x,
    0,
    target.group.position.z - player.mesh.position.z,
  );
  if (dir.lengthSq() > 0.0001) dir.normalize();
  popHead(target, dir);
  return true;
}

async function runLevelUp() {
  paused = true;
  input.clearMouseState();
  inventoryUI.hide();
  await skillPickUI.show();
  input.clearMouseState();
  paused = false;
  recomputeStats();
}

async function runMasteryOffer() {
  const offer = pendingMasteryOffers.shift();
  if (!offer) return;
  paused = true;
  input.clearMouseState();
  inventoryUI.hide();
  await masteryPickUI.show(offer);
  input.clearMouseState();
  paused = false;
  recomputeStats();
}

function tick() {
  frameCounter = (frameCounter + 1) | 0;
  const rawDt = clock.getDelta();           // real elapsed since last frame
  let dt = Math.min(rawDt, 1 / 30);         // clamped for physics stability
  _perf.start('frame');
  // Hit-stop — brief world-freeze on strong hits / kills. Timer runs
  // on rawDt so it counts down even while gameplay dt is zeroed out.
  if (hitStopT > 0) {
    hitStopT = Math.max(0, hitStopT - rawDt);
    dt = 0;
  }
  const inputState = input.sample();
  lastSampledInput = inputState;

  // Toggle panels (safe any time). Tab and Escape both dismiss any
  // open modal first (store / shop / customize / perks / roll / loot
  // / inventory); only when nothing is up do they fall through to
  // their primary role — Tab opens inventory, Escape opens the game
  // menu.
  const dismissTopModal = () => {
    // Every branch calls the method that actually exists on the UI.
    // Earlier revision used `close?.()` optimistically, which silently
    // no-opped for shopUI / customizeUI (they only expose `hide()`) —
    // so Escape did nothing in the armorer / tailor / gunsmith etc.
    if (customizeUI.isOpen()) { customizeUI.hide(); return true; }
    if (storeRollUI.isOpen && storeRollUI.isOpen()) { storeRollUI.hide(); storeRollUI.onCancel?.(); return true; }
    if (storeUpgradeUI.isOpen && storeUpgradeUI.isOpen()) { storeUpgradeUI.hide(); storeUpgradeUI.onClose?.(); return true; }
    if (shopUI.isOpen()) { shopUI.hide(); return true; }
    if (perkUI.isOpen()) { perkUI.toggle(); return true; }
    if (lootUI.isOpen()) { lootUI.hide(); return true; }
    if (inventoryUI.visible) { inventoryUI.hide(); return true; }
    return false;
  };
  if (inputState.inventoryToggled) {
    if (!dismissTopModal()) inventoryUI.toggle();
  }
  if (inputState.perksToggled) perkUI.toggle();
  if (inputState.menuToggled) {
    if (!dismissTopModal()) gameMenuUI.toggle();
  }

  // Throwable cooldowns tick on real elapsed time (rawDt) regardless
  // of modal / pause state — so three minutes of browsing the shop
  // still count toward a frag refill. Uses rawDt so we don't inherit
  // the 1/30 gameplay clamp, which would slow recharges during frame
  // hiccups. Runs BEFORE the modal gate so it continues inside
  // inventory / shop / loot.
  tickThrowableCooldowns(rawDt);

  if (paused || inventoryUI.visible || customizeUI.isOpen() || lootUI.isOpen() || shopUI.isOpen() || perkUI.isOpen() || gameMenuUI.isOpen() || playerDead) {
    // Modal pause — scene is frozen, so all the per-frame
    // recomputation (LoS mask raycasts, bloom mip chain, finisher
    // chroma/grain) is wasted work. Cut to a direct render and
    // suppress the LoS update for the rest of the pause.
    _safeRender(rawDt, /* paused */ true);
    _perf.end('frame');
    if (_perf.isVisible()) _perf.render(rawDt > 0 ? 1 / rawDt : 0);
    requestAnimationFrame(tick);
    return;
  }
  // Game clock — advances only during active gameplay. Wall-clock-based
  // timers (e.g. weapon reload) compare against this so they match the
  // tooltip duration regardless of frame-rate dips or modal pauses.
  gameClockMs += rawDt * 1000;

  exitCooldown = Math.max(0, exitCooldown - dt);

  if (inputState.weaponSwitch !== null) setWeaponIndex(inputState.weaponSwitch);
  else if (inputState.weaponCycle) {
    const rotation = getRotation();
    if (rotation.length > 0) {
      setWeaponIndex((currentWeaponIndex + 1) % rotation.length);
    }
  }
  // Q — swap firing shoulder (right-handed ↔ left-handed hold).
  if (inputState.handednessToggle && player.swapHandedness) {
    player.swapHandedness();
  }

  syncInventoryIfChanged();
  buffs.tick(dt);
  recomputeStats();
  player.applyDerivedStats(derivedStats);
  lastPlayerInfo = null; // will be set just after player.update

  const muzzleWorldTmp = player.mesh.position.clone();
  muzzleWorldTmp.y = inputState.crouchHeld
    ? tunables.move.crouchMuzzleY
    : tunables.move.standMuzzleY;
  const aimInfo = resolveAim(muzzleWorldTmp);
  lastAim = aimInfo.point;

  // Kick off combo BEFORE update so the first step's `active` hit can fire
  // inside this same frame's player.update().
  tryStartCombo(inputState, aimInfo);
  tryStartQuickMelee(inputState, aimInfo);

  const playerInfo = player.update(dt, inputState, aimInfo.point, resolveCollision);
  if (playerInfo && playerInfo.maxHealth > 0) {
    lastHpRatio = Math.max(0, Math.min(1, playerInfo.health / playerInfo.maxHealth));
    playerMaxHealthCached = playerInfo.maxHealth;
  }
  lastPlayerInfo = playerInfo;
  // Footsteps — distance-based, so cadence tracks actual horizontal
  // speed regardless of frame rate. 1.3 m between steps for a walk,
  // 0.95 m at a run (blendRun is carried inside the rig, so we read
  // it back via speed thresholds here).
  tickFootsteps(dt, playerInfo);

  // Feel FX for movement actions — each is a one-shot flag that
  // player.update clears next frame. Shake magnitudes are tuned
  // low enough that they don't disorient during quick double-taps
  // but still deliver a perceptible "whump" on action start.
  if (playerInfo.dashStarted)  triggerShake(0.18, 0.12);
  if (playerInfo.rollStarted)  triggerShake(0.10, 0.10);
  if (playerInfo.slideStarted) triggerShake(0.24, 0.20);

  if (playerInfo.attackEvent) resolveComboHit(playerInfo.attackEvent);

  // Per-frame weapon-tip trail — samples `muzzleWorld` each tick
  // while the combo is in startup / active / recovery and spawns a
  // thin ribbon segment from the previous sample to the current.
  // Accumulated segments trace the actual swing path (because they
  // sample the animated weapon pose), so the trail follows whatever
  // curve the rig is currently producing instead of a pre-baked fan.
  const swingPhase = playerInfo.attackPhase;
  const isSwinging = swingPhase === 'startup' || swingPhase === 'active' || swingPhase === 'recovery';
  if (isSwinging && playerInfo.muzzleWorld) {
    const tip = playerInfo.muzzleWorld;
    if (_playerMeleeTrailPrev) {
      const isCritSwing = !!playerInfo.attackIsCrit;
      combat.spawnMeleeSegment(_playerMeleeTrailPrev, tip, 0.22, {
        color: isCritSwing ? 0xfff4a8 : 0xf2e7c9,
        width: isCritSwing ? 0.22 : 0.14,
        opacity: isCritSwing ? 0.95 : 0.8,
      });
    }
    if (!_playerMeleeTrailPrev) _playerMeleeTrailPrev = new THREE.Vector3();
    _playerMeleeTrailPrev.copy(tip);
  } else {
    _playerMeleeTrailPrev = null;
  }

  // --- Class capstone runtime updates --------------------------------
  // LMG Walking Fire — accumulate held-trigger time while the player
  // is firing an LMG, reset after `lmgSustainedResetT` seconds idle.
  {
    const w = currentWeapon();
    const isLmgFiring = w?.class === 'lmg' && inputState.attackHeld
                       && (derivedStats.lmgSustainedSpreadDecay || 0) > 0;
    if (isLmgFiring) {
      _lmgHeldT += dt;
      _lmgIdleT = 0;
    } else {
      _lmgIdleT += dt;
      if (_lmgIdleT >= (derivedStats.lmgSustainedResetT || 1.0)) _lmgHeldT = 0;
    }
    // Sniper Marked Target — accumulate while ADS, stationary,
    // and pointing at the same hittable. Reset on motion or ADS
    // release.
    const isSniperADS = w?.class === 'sniper' && inputState.adsHeld
                       && (derivedStats.sniperAimRampPerTick || 0) > 0;
    if (isSniperADS && playerInfo && aimInfo?.point) {
      const px = playerInfo.position?.x ?? 0;
      const pz = playerInfo.position?.z ?? 0;
      const moved = Math.hypot(px - _sniperAimX, pz - _sniperAimZ);
      _sniperAimX = px;
      _sniperAimZ = pz;
      // Resolve who the cursor is pointing at — used to detect target
      // swaps (which reset the stack). Reuse the existing aim point.
      const origin = playerInfo.fireOrigin || playerInfo.muzzleWorld;
      const dirA = _tmpDir.copy(aimInfo.point).sub(origin);
      let aimedAt = null;
      if (dirA.lengthSq() > 0.0001) {
        dirA.normalize();
        const h = combat.raycast(origin, dirA, allHittables(), 80);
        aimedAt = h?.owner || null;
      }
      if (moved > 0.05 || (_sniperHoldTarget && aimedAt && aimedAt !== _sniperHoldTarget)) {
        _sniperHoldT = 0;
      } else {
        _sniperHoldT += dt;
      }
      if (aimedAt) _sniperHoldTarget = aimedAt;
    } else {
      _sniperHoldT = 0;
      _sniperHoldTarget = null;
    }
    // Rifle chain timeout — clear stacks if no trigger pulls in window.
    if (_rifleChainTarget && (gameClockMs / 1000 - _rifleChainLastT) > (derivedStats.rifleAutoChainResetT || 1.5)) {
      _rifleChainTarget = null;
      _rifleChainStacks = 0;
    }
    // Exotic chain — prune expired marks.
    const nowMs = gameClockMs;
    for (let i = _exoticChainMarks.length - 1; i >= 0; i--) {
      if (_exoticChainMarks[i].untilMs < nowMs) _exoticChainMarks.splice(i, 1);
    }
  }

  if (inputState.reloadPressed) { tryReload(currentWeapon()); sfx.reload(); }
  if (inputState.lightToggled) {
    lightsEnabled = !lightsEnabled;
    transientHudMsg?.(lightsEnabled ? 'LIGHT ON' : 'LIGHT OFF', 0.9);
    sfx.uiAccept?.();
  }
  if (inputState.healPressed) tryUseMedkit();
  if (inputState.actionSlotPressed >= 0) useActionSlot(inputState.actionSlotPressed);

  tickLight(playerInfo, aimInfo);
  updateBeamAndCone(playerInfo, aimInfo, inputState);
  tickShooting(dt, playerInfo, inputState, aimInfo);
  tickMeleeSwipe(dt, inputState, aimInfo, playerInfo);

  // Flame particles collide with the same blockers bullets use. List
  // is re-shared (not copied) so updates here reflect live doors,
  // props, etc. No dispose — combat only reads the AABBs.
  combat.setFlameBlockers(level.solidObstacles());
  combat.update(dt);
  // Projectiles need live enemy lists so rocket-type rounds can
  // trigger on proximity — reassigned each frame so dead enemies
  // get filtered out via the per-entry `alive` check.
  projectiles.enemyLists = [gunmen.gunmen, melees.enemies];
  projectiles.update(dt, level, onProjectileExplode);
  _tickFireZones(dt);
  _tickFlashDomes(dt);
  _tickFireOrbs(dt);
  _tickBurnReadouts(dt);
  _tickBuffAuras(dt);
  syncLighting();
  dummies.update(dt);
  level.animateNPCs(dt);
  const extraCrouch = derivedStats.stealthExtraCrouchMult || 1;
  // Crouch-sprint: faster move but noisier, so the stealth benefit shrinks.
  let crouchMult = 1;
  if (playerInfo.crouchSprinting) {
    crouchMult = tunables.stealth.crouchSprintDetectionMult * extraCrouch;
  } else if (inputState.crouchHeld) {
    crouchMult = tunables.stealth.crouchDetectionMult * extraCrouch;
  }
  // Phantom Crouch artifact perk — crouched + wielding = effectively invisible.
  if (inputState.crouchHeld && weaponHasArtifactPerk(currentWeapon(), 'phantomCrouch')) {
    crouchMult = 0.03;
  }
  // Ambient light fold-in — standing directly under a lamp makes the
  // player easier to spot; deep shadow increases the stealth bonus.
  // 0 (dark) → lightMult 0.7; 1 (lit) → lightMult 1.4. Curve leans
  // toward shadowed-by-default so lighting gives a clear *advantage*
  // to avoiding lit spots rather than a modest buff.
  const lightLevel = level.lightLevelAt
    ? level.lightLevelAt(playerInfo.position.x, playerInfo.position.z) : 0.5;
  const lightMult = 0.7 + lightLevel * 0.7;
  const stealthMult = (derivedStats.stealthMult || 1) * crouchMult * lightMult;

  // Gather alive shield bearers so ranged/cover-seeker gunmen can use them
  // as moving cover (escort formation).
  const shieldBearers = melees.enemies.filter(e => e.alive && e.variant === 'shieldBearer' && e.shield);
  const playerRoomNow = level.roomAt(playerInfo.position.x, playerInfo.position.z);
  const playerRoomId = playerRoomNow ? playerRoomNow.id : -1;
  // Filter unlocked doors once per frame — used for both LoS raycasts and
  // (below) as the per-enemy gate so bullets / sight lines go through
  // doorways instead of hitting their flattened mesh.
  const losObstacles = level.solidObstacles();
  const isRoomActive = (roomId) => level.isRoomActive(roomId);
  gunmen.update({
    dt,
    playerPos: playerInfo.position,
    playerFacing: playerInfo.facing,   // used by Evasive Gunner archetype
    playerCrouched: !!playerInfo.crouched,
    playerRoomId,
    combat,
    camera,                         // needed for chatter bubble projection
    level,                          // exposed for between-room patrol lookups
    loot,                           // disarmed bosses scan for nearby weapons
    onMeleePlayer: (dmg) => damagePlayer(dmg, 'melee'),
    obstacles: losObstacles,
    onFireAt: aiFire,
    onBurnKill: (e) => { onEnemyKilled(e); awardClassXp('exotic', e.tier); },
    onBurnDamage: (e, dmg) => trackBurnDamage(e, dmg),
    onAlert: (e) => propagateAggro(e),
    playerStealthMult: stealthMult,
    resolveCollision: enemyResolveCollision,
    shieldBearers,
    findDoorToward: (roomId, enemyPos) =>
      level.findDoorToward(roomId, playerInfo.position, enemyPos),
    isRoomActive,
  });
  melees.update({
    dt,
    playerPos: playerInfo.position,
    combat,
    camera,                         // for chatter bubble projection
    level,                          // for room-graph pathing
    obstacles: losObstacles,
    playerStealthMult: stealthMult,
    onAlert: (e) => propagateAggro(e),
    isRoomActive,
    onPlayerHit: (d, enemy) => {
      if (playerInfo.blocking) {
        const hitPt = new THREE.Vector3(
          player.mesh.position.x, 1.0, player.mesh.position.z,
        );
        combat.spawnDeflectFlash(hitPt, 0xffffff);
        player.consumeStamina(tunables.stamina.deflectCost);
        if (playerInfo.parryActive && enemy) {
          runStats.addDamage(tunables.melee.swipeDamage);
          enemy.manager.applyHit(enemy, tunables.melee.swipeDamage, 'torso', {
            x: 0, z: 0,
          });
          spawnDamageNumber(
            new THREE.Vector3(enemy.group.position.x, 1.2, enemy.group.position.z),
            camera, tunables.melee.swipeDamage, 'torso',
          );
        }
        return;
      }
      damagePlayer(d, 'melee');
      // Melee-hit feedback — louder than bullet hits so the player
      // feels the impact: rig flinch in the hit direction, heavy
      // camera shake, brief hit-stop, red vignette pulse, audio.
      if (enemy && enemy.group) {
        const dx = player.mesh.position.x - enemy.group.position.x;
        const dz = player.mesh.position.z - enemy.group.position.z;
        const dist = Math.hypot(dx, dz) || 1;
        const hitDirX = dx / dist, hitDirZ = dz / dist;
        player.reactToHit?.(hitDirX, hitDirZ, 1.8);
      }
      triggerShake(0.35, 0.28);
      triggerHitStop?.(0.06);
      pulseHurtFlash(0.4);
      sfx.meleeImpact?.();
    },
    onBurnKill: (e) => { onEnemyKilled(e); awardClassXp('exotic', e.tier); },
    onBurnDamage: (e, dmg) => trackBurnDamage(e, dmg),
    playerIFrames: playerInfo.iFrames,
    playerBlocking: playerInfo.blocking,
    resolveCollision: enemyResolveCollision,
  });

  // Keep enemies from stacking so crowd counts read at a glance.
  // Walls-only resolver (separate push + player-repel compounds badly at
  // choke points). The unstick pass catches enemies that wound up inside
  // door/wall collision — otherwise they fire from inside the door until
  // it unlocks.
  separateEnemies(
    [
      { list: gunmen.gunmen, radius: tunables.ai.collisionRadius },
      { list: melees.enemies, radius: tunables.meleeEnemy.collisionRadius },
    ],
    resolveCollision,
    (x, z, r) => level.unstickFrom(x, z, r),
  );

  loot.update(dt, player.mesh.position);

  const prompt = updateLootPrompt();
  if (inputState.interactPressed) tryInteract(prompt);
  updateRoomClearance(playerInfo.position);
  if (extractPending) {
    extractPending = false;
    runExtract();
  } else if (pendingLevelUps > 0 && !paused) {
    pendingLevelUps -= 1;
    runLevelUp();
  } else if (pendingMasteryOffers.length > 0 && !paused) {
    runMasteryOffer();
  }

  const weapon = currentWeapon();
  const effWeapon = weapon ? effectiveWeapon(weapon) : null;
  updateCamera(dt, {
    target: playerInfo.position,
    aim: aimInfo.point,
    adsAmount: playerInfo.adsAmount,
    adsZoom: effWeapon?.adsZoom,
    adsPeekDistance: effWeapon?.adsPeekDistance,
  });
  // Camera shake overlay — applied AFTER the follow solve so the
  // base transform isn't permanently nudged. Decays over shakeT.
  if (shakeT > 0) {
    shakeT = Math.max(0, shakeT - rawDt);
    const k = shakeT / 0.22;                // 1 at peak, 0 at end
    const amp = shakeMag * k * k;           // ease-out
    camera.position.x += (Math.random() - 0.5) * amp;
    camera.position.y += (Math.random() - 0.5) * amp * 0.6;
    camera.position.z += (Math.random() - 0.5) * amp;
    if (shakeT <= 0) shakeMag = 0;
  }

  updateHealthHud(playerInfo);
  updateReloadHud(weapon, effWeapon);
  updateOverhead(weapon, effWeapon, playerInfo, stealthMult);
  updateStealthStatus(playerInfo);
  // Run enemy visibility every frame by default; in low-quality mode
  // halve the cadence since the LoS raycasts are expensive.
  if (qualityFlags.enemyVisibilityEveryFrame || (frameCounter & 1) === 0) {
    _perf.start('vis');
    updateEnemyVisibility();
    _perf.end('vis');
  }
  _perf.start('wallOccl');
  updateWallOcclusion();
  _perf.end('wallOccl');
  if (creditTextEl) {
    // Include persistent chips alongside run credits so the meta
    // currency is always visible. Format: "credits • chips⚫"
    creditTextEl.textContent = persistentChips > 0
      ? `${playerCredits}c · ${persistentChips}◆`
      : String(playerCredits);
  }
  if (xpTextEl) xpTextEl.textContent = `${playerXp}/${xpToNextLevel()}`;
  if (spRowEl) spRowEl.style.display = playerSkillPoints > 0 ? 'flex' : 'none';
  if (spTextEl) spTextEl.textContent = String(playerSkillPoints);

  if (!playerDead && playerInfo.health <= 0) {
    playerDead = true;
    sfx.death();
    // Seal the run's stats and submit to the local leaderboard. Tainted
    // runs (save/load used) are silently dropped inside submitRun so
    // save-scummers can't climb the boards.
    runStats.deathLevel = level.index | 0;
    runStats.deathAt = Date.now();
    runStats.playerName = getPlayerName() || 'anon';
    try { Leaderboard.submitRun(runStats); } catch (e) { console.warn(e); }
    if (deathRootEl) deathRootEl.style.display = 'flex';
  }
  if (hudStatsEl) {
    const zoneLabel = aimInfo.zone ? `[${aimInfo.zone}]` : '';
    const rotation = getRotation();
    let weaponLabel = 'unarmed';
    let ammoLabel = '';
    if (weapon) {
      weaponLabel = weapon.type === 'melee'
        ? `${weapon.name} (melee ${playerInfo.attackPhase !== 'idle'
            ? `step ${playerInfo.attackStep + 1}/${weapon.combo.length} ${playerInfo.attackPhase}`
            : 'ready'})`
        : `${weapon.name} (${weapon.fireMode})`;
      if (typeof weapon.ammo === 'number') {
        ammoLabel = ` ${weapon.ammo}/${weapon.magSize}` +
          (weapon.reloadingT > 0 ? ` reload ${weapon.reloadingT.toFixed(1)}s` : '');
      }
    }
    let classLabel = '';
    if (weapon && weapon.class) {
      const cls = weapon.class;
      const lv = classMastery.level(cls);
      const next = classMastery.nextThreshold(cls);
      const xp = classMastery.xpFor(cls);
      classLabel = `  ${cls} L${lv}` + (next !== null ? ` (${xp}/${next})` : ' max');
    }
    hudStatsEl.textContent =
      `level ${level.index}  char ${playerLevel}  ` +
      `[${currentWeaponIndex + 1}/${rotation.length}] ${weaponLabel}${ammoLabel}${classLabel}  ` +
      `aim ${zoneLabel}  ${playerInfo.iFrames ? 'i-frames' : ''}`;
  }

  // Keycard HUD + transient toast fade + major-boss bar.
  renderKeycardHud();
  renderBossBar();
  if (toastFadeT > 0) {
    toastFadeT -= dt;
    if (toastFadeT <= 0) toastEl.style.opacity = '0';
  }

  _safeRender(rawDt);
  _perf.end('frame');
  // FPS uses raw dt (real wall-clock between frames), not the clamped
  // gameplay dt. clamp at 1 to avoid divide-by-tiny on first frame.
  if (_perf.isVisible()) _perf.render(rawDt > 0 ? 1 / rawDt : 0);
  requestAnimationFrame(tick);
}

// Single render entry point — skips entirely while the WebGL context
// is lost (the restore handler reloads), and falls back to a direct
// renderer.render() if the postFx composer throws. Without the
// fallback, a single bad composer frame would leave the canvas black
// until the next reload.
function _safeRender(rawDt, modalPaused = false) {
  if (_ctxLost) return;
  try {
    // Refresh the LoS mask before the composer reads it. Skip in low
    // quality mode (direct render bypasses the composer + mask), while
    // the player is dead, or before a level exists (title screen):
    // either way we toggle the post-fx pass off so a stale mask
    // texture doesn't leave the menu darkened. Modal pauses also skip
    // since the scene is frozen — no recomputation needed.
    const losActive = qualityFlags.postFx && !playerDead
                   && !modalPaused
                   && level && level.visionBlockers
                   && player && player.mesh
                   && !mainMenuUI?.isOpen?.();
    if (losActive) {
      _perf.start('losMask');
      losMask.update(player.mesh.position, level.visionBlockers());
      postFx.setLosMask(losMask.texture, true);
      _perf.end('losMask');
    } else if (!modalPaused) {
      postFx.setLosMask(losMask.texture, false);
    }
    // During modal pauses use a direct render path — bypasses the
    // bloom mip chain + finisher chroma/grain, which is the single
    // biggest GPU cost per frame. The pause UI typically covers most
    // of the screen so the visual delta is minimal.
    _perf.start('render');
    if (modalPaused) {
      renderer.render(scene, camera);
    } else if (qualityFlags.postFx) {
      postFx.render(rawDt);
    } else {
      renderer.render(scene, camera);
    }
    _perf.end('render');
  } catch (err) {
    console.warn('[gfx] postFx render threw — falling back to direct render', err);
    qualityFlags.postFx = false;
    try { renderer.render(scene, camera); } catch (_) {}
  }
}

regenerateLevel();
// Initial screen: the main menu. Play routes through the starting
// store picker; classic class-picker is still accessible as a
// fallback if someone hits startUI.show() from a callback (e.g. the
// Quit-to-title flow, which needs a new-run entry point).
if (inventory.pocketsGrid.isEmpty() && !inventory.equipment.backpack) {
  mainMenuUI.show();
}
requestAnimationFrame(tick);
