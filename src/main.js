import * as THREE from 'three';
import { createScene } from './scene.js';
import { initBloomReticle, setBloomLevel, setBloomVisible } from './bloom_reticle.js';
import { createPostFx } from './postfx.js';
import { createLosMask } from './los_mask.js';
// BVH must be imported before any geometry / mesh creation so the
// global Mesh.raycast patch is in place. The patched raycast defers
// to vanilla behavior when a mesh has no bounds tree, so meshes
// constructed before `accelerateAll` runs (props, decorations, etc.)
// keep working — they just don't get the speedup.
import { accelerateAll, disposeMesh } from './bvh.js';
import { createPlayer } from './player.js';
import { Input } from './input.js';
import { ACTIONS, getKeyboardBinding, displayKeyboard } from './keybinds.js';
import { Combat } from './combat.js';
import { DummyManager } from './enemy.js';
import { GunmanManager } from './gunman.js';
import { MeleeEnemyManager } from './melee_enemy.js';
import { initRigInstancer, rigInstancer } from './rig_instancer.js';
import { separateEnemies } from './ai_separation.js';
import { LootManager } from './loot.js';
import { ENCOUNTER_DEFS, pickEncounterForLevel } from './encounters.js';
import { spawnSpeechBubble } from './hud.js';
import { makeContainer, buildContainerMesh, pickContainerType, pickContainerSize } from './containers.js';
import { Level } from './level.js';
import {
  MegaBoss, isMegaBossLevel, buildMegaBossLoot,
  getEncounterCount as getMegaBossEncounterCount,
  bumpEncounterCount as bumpMegaBossEncounterCount,
} from './megaboss.js';
import { MegaBossEcho, buildEchoLoot } from './megaboss_echo.js';
import { MegaBossGeneral, buildGeneralLoot } from './megaboss_general.js';
import { ProjectileManager } from './projectiles.js';
import { spawnDamageNumber } from './hud.js';
import { initDebugPanel, setDebugPanelVisible } from './debug.js';
import { getDevToolsEnabled, setDevToolsEnabled, getPlayerName, setPlayerName,
         getStartingStoreState, setStartingStoreState,
         getCharacterStyle, setCharacterStyle,
         getPouchSlots, setPouchSlots, pouchNextSlotCost, POUCH_SLOT_MAX,
         getMerchantUpgrades, setMerchantUpgrade, merchantUpgradeNextCost,
         getMerchantStockBonus,
         getRerollUnlocked, setRerollUnlocked,
         MERCHANT_KINDS, MERCHANT_UPGRADE_MAX, REROLL_UNLOCK_COST,
         getCompletedEncounters, markEncounterDone,
         getShrineTiers, setShrineTierPurchased, resetShrineTiersForRun,
         getMythicRunUnlocked, setMythicRunUnlocked } from './prefs.js';
import { tunables } from './tunables.js';
import { BALANCE } from './balance.js';
import {
  Inventory, SLOT_IDS,
  ALL_GEAR, ALL_ARMOR, ALL_CONSUMABLES, CONSUMABLE_DEFS, ALL_JUNK, ALL_TOYS, ARMOR_DEFS,
  GEAR_DEFS, JUNK_DEFS, TOY_DEFS,
  wrapWeapon, withAffixes, randomArmor, randomGear, randomConsumable, randomJunk, randomToy, setLootLevel,
  randomThrowable, THROWABLE_DEFS, makeThrowable, forceMastercraft,
  randomEitherRepairKit, randomRepairKit,
} from './inventory.js';
import { ALL_ATTACHMENTS, ATTACHMENT_DEFS, effectiveWeapon, randomAttachment, rollAttachmentRarity } from './attachments.js';
import { CustomizeUI } from './ui_customize.js';
import { LootUI } from './ui_loot.js';
import { ShopUI, priceFor, sellPriceFor } from './ui_shop.js';
import { PerkUI } from './ui_perks.js';
import { InventoryUI } from './ui_inventory.js';
import { DurabilityHud } from './ui_durability_hud.js';
import { SkillLoadout, BASE_STATS } from './skills.js';
import { SkillPickUI } from './ui_skills.js';
import { SpecialPerkLoadout, BuffState, SPECIAL_PERKS, GEAR_PERKS } from './perks.js';
import { ClassMastery, CLASS_DEFS, CLASS_THRESHOLDS } from './classes.js';
import { SkillTreeLoadout, makeMasteryOffers, SKILL_NODES } from './skill_tree.js';
import { ArtifactCollection, ARTIFACT_DEFS, ALL_ARTIFACTS, relicFor } from './artifacts.js';
import { MasteryPickUI } from './ui_mastery.js';
import { RelicsUI } from './ui_relics.js';
import { sfx, attachUnlock, getMasterVolume, setMasterVolume,
         setAudioMusicEnabled } from './audio.js';
import { GameMenuUI } from './ui_menu.js';
import { StartUI } from './ui_start.js';
import { MainMenuUI } from './ui_main_menu.js';
import { HideoutUI } from './ui_hideout.js';
import { tryClaimContract, defForId, buildModifiers, evaluateContract,
         rankRewardFor, rankPerKillFor, CONTRACT_DEFS } from './contracts.js';
import {
  getActiveContract, setActiveContract, awardMarks, bumpContractRank, bumpMegabossKills,
  bumpRunCount, queueEncounterFollowup,
  getUnlockedWeapons, isWeaponUnlocked, unlockWeapon,
  consumeStarterInventory,
  getSelectedStarterWeapon,
  getSigils, awardSigils, setSigils,
  consumeKeystoneQueue,
  getRelicPermits,
  getContractRank, setContractRank,
  getRecruiterUnlocks,
  getRankPoints, awardRankPoints, rankPointsForNext,
  getDemonBearGranted,
  getMarks, setMarks,
  getPersistentChips, setPersistentChips,
  getMusicEnabled, setMusicEnabled,
} from './prefs.js';
import { StoreUpgradeUI, StoreRollUI, rollRarityForTier } from './ui_starting_store.js';
import { getQualityPref, setQualityPref, applyQuality, qualityFlags } from './quality.js';
import { DetailsUI } from './ui_details.js';
import { STATUS_ICONS } from './inventory.js';
import { thumbnailFor } from './item_thumbnails.js';
import { RunStats, Leaderboard } from './leaderboard.js';
import { fireHint, tickHints, resetHints } from './ui_hints.js';
import { TutorialUI } from './ui_tutorial.js';
import { setCursorForWeapon } from './cursor.js';
import { DroneManager } from './drones.js';
import { CoopLobbyUI, isCoopEnabled } from './coop/lobby.js';
import { getCoopTransport } from './coop/transport.js';
import { buildRig as _buildAllyRig, initAnim as _initAllyAnim, updateAnim as _updateAllyAnim } from './actor_rig.js';
import {
  encodeEnemySnapshot, encodeSnapshotsPerPeer,
  applyEnemySnapshot, applyLootSnapshot, applyDroneSnapshot,
  applyMegaBossSnapshot,
  pushSnapshotForInterp, pickInterpSnapshots, applyInterpolated,
  clearSnapshotBuffer,
} from './coop/snapshot.js';
import { resetNetIds } from './gunman.js';
window.__resetHints = resetHints;

// Build identifier — bumped at deploy time so playtesters can report
// "I'm on build XYZ" without inspecting the bundle. Date stamps the
// version so a quick glance tells you how stale the build is. Both
// values render into the bottom-right #build-version label.
const BUILD_VERSION = '0cabc75+megaboss-tick-visuals';
// Build date intentionally bumped each deploy so the corner label
// reflects the current snapshot.
const BUILD_DATE    = '2026-05-01';
window.__BUILD_VERSION = BUILD_VERSION;
window.__BUILD_DATE    = BUILD_DATE;
try {
  const _bvEl = document.getElementById('build-version');
  if (_bvEl) _bvEl.textContent = `build ${BUILD_VERSION} · ${BUILD_DATE}`;
} catch (_) { /* DOM not ready or label removed */ }

// Tutorial mode flag — when true, the level generator builds a tiny
// fixed practice room with no aggressive enemies and the
// TutorialUI overlay tracks player-action checkboxes. The flag is
// flipped on by the main-menu Tutorial button and cleared when the
// player extracts or quits to title.
let tutorialMode = false;
const tutorialUI = new TutorialUI();
window.__tutorialMode = () => tutorialMode;
// Stealth-step accumulator — counts seconds the player has been
// crouched within 6m of the stealth dummy while it's still idle.
// Reset on tutorial start (mainMenu.onTutorial).
let _tutorialStealthT = 0;

const appEl = document.getElementById('app');
const hudStatsEl = document.getElementById('hud-stats');

// --- keycard HUD + transient toast -----------------------------------
// The keycard row lives inside #hud-bl on the bottom-left stack so it
// reads as part of the same status cluster as HP and currency. The
// wrapper panel hides when no cards are held; renderKeycardHud below
// toggles its display whenever the held set changes.
const keyHudEl = document.getElementById('keycard-hud');
const keyPanelEl = document.getElementById('keycard-panel');
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

// Skill-point reminder pip — small fixed badge in the HUD that
// glows whenever the player has unspent skill points. Updated by
// _refreshSkillPointPip every time playerSkillPoints changes (kill,
// reward, spend). The toast fires from a separate path on each
// fresh point earned so the player sees both the moment-of and the
// persistent reminder.
const skillPointPipEl = (() => {
  const el = document.createElement('div');
  el.id = 'hud-skill-pip';
  Object.assign(el.style, {
    position: 'fixed',
    top: '70px',
    right: '24px',
    padding: '6px 12px',
    background: 'rgba(40, 20, 70, 0.85)',
    border: '1px solid #b894ff',
    borderRadius: '4px',
    color: '#e0c8ff',
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fontSize: '12px',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    zIndex: 18,
    pointerEvents: 'none',
    boxShadow: '0 0 12px rgba(184, 148, 255, 0.4)',
    display: 'none',
  });
  document.body.appendChild(el);
  return el;
})();
function _refreshSkillPointPip() {
  const n = (typeof playerSkillPoints === 'number') ? playerSkillPoints : 0;
  if (n > 0) {
    skillPointPipEl.textContent = `★ ${n} skill point${n === 1 ? '' : 's'} unspent`;
    skillPointPipEl.style.display = 'block';
  } else {
    skillPointPipEl.style.display = 'none';
  }
}
function _showSkillPointToast(amount = 1) {
  transientHudMsg(`+${amount} skill point${amount === 1 ? '' : 's'} — press K to spend`, 2.5);
  _refreshSkillPointPip();
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
  evasive:       'THE DODGER',
  bulletHell:    'THE BARRAGE',
  assassin:      'NIGHT BLADE',
  elite:         'THE SPECIALIST',
  flamer:        'THE BURN',
  grenadier:     'THE LOBBER',
  droneSummoner: 'THE HIVEMASTER',
  spawner:       'THE NECROMANT',
  berserker:     'THE FROTH',
  shinigami:     'SHINIGAMI',
};
function renderBossBar() {
  // Find the live major boss nearest the player (there's almost
  // always at most one; the sort handles level 6+ double-boss runs).
  let boss = null;
  for (const g of gunmen.gunmen) {
    if (g.alive && g.majorBoss && !g.hidden) { boss = g; break; }
  }
  if (!boss) {
    for (const m of melees.enemies) {
      if (m.alive && m.majorBoss && !m.hidden) { boss = m; break; }
    }
  }
  // Cached display state — only touch DOM on transitions / value
  // changes. Identical string assignments still force style recompute.
  if (!boss) {
    if (bossBarRoot._lastDisplay !== 'none') {
      bossBarRoot.root.style.display = 'none';
      bossBarRoot._lastDisplay = 'none';
    }
    return;
  }
  // Show whenever the player has entered the boss room OR the boss is
  // currently aggroed (alerted / firing / chasing). The aggro trigger
  // matters because bosses can leave their rooms now — a chasing boss
  // out in the corridor still deserves a healthbar.
  const here = level.roomAt(player.mesh.position.x, player.mesh.position.z);
  const inBossRoom = here && here.id === boss.roomId;
  const aggroState = boss.state && boss.state !== 'idle'
    && boss.state !== 'sleep' && boss.state !== 'dead';
  if (!inBossRoom && !aggroState) {
    if (bossBarRoot._lastDisplay !== 'none') {
      bossBarRoot.root.style.display = 'none';
      bossBarRoot._lastDisplay = 'none';
    }
    return;
  }
  if (bossBarRoot._lastDisplay !== 'block') {
    bossBarRoot.root.style.display = 'block';
    bossBarRoot._lastDisplay = 'block';
  }
  const nm = BOSS_NAMES[boss.archetype] || 'BOSS';
  if (bossBarRoot._lastName !== nm) {
    bossBarRoot.name.textContent = nm;
    bossBarRoot._lastName = nm;
  }
  // HP fill width — quantize to 0.1% so frame-by-frame trickle damage
  // doesn't paint every frame.
  const pct = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const w = Math.round(pct * 1000);
  if (bossBarRoot._lastW !== w) {
    bossBarRoot.fill.style.width = `${pct * 100}%`;
    bossBarRoot._lastW = w;
  }
}
const KEY_COLOR_HEX = {
  red: '#d04040', blue: '#4a88e0', green: '#50c060', yellow: '#e0c040',
};
// Cached signature of the last-rendered key set — keys change rarely
// (pickup / use), so we should only rebuild the panel on a real
// change. Was clearing + re-creating divs every frame.
let _keyHudSig = '';
function renderKeycardHud() {
  if (!keyHudEl || !keyPanelEl) return;
  // Build a stable signature of the current key set. Keys are colour
  // strings; sort + join so the order is canonical.
  const sig = playerKeys && playerKeys.size > 0
    ? Array.from(playerKeys).sort().join(',')
    : '';
  if (sig === _keyHudSig) return;     // no change since last frame
  _keyHudSig = sig;
  while (keyHudEl.firstChild) keyHudEl.removeChild(keyHudEl.firstChild);
  if (!sig) {
    keyPanelEl.style.display = 'none';
    return;
  }
  keyPanelEl.style.display = '';
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
const levelTextEl = document.getElementById('level-text');
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
      document.getElementById('death-unlock-prompt')?.remove();
      // If we never captured an entry snapshot (fresh-after-boot edge
      // case), fall through to regenerating the current level so the
      // restart still produces a playable state instead of a stuck one.
      const slot = _activeRestartSlot | 0;
      if (_levelStartSnapshots[slot] || levelStartSnapshot) {
        restoreFromSnapshot(slot);
      } else {
        console.warn('[restart] no snapshot — regenerating current level');
        recomputeStats();
        player.applyDerivedStats(derivedStats);
        player.restoreFullHealth();
        regenerateLevel();
      }
      _activeRestartSlot = 0;
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
    // Death-exit flow: the run is sealed (leaderboard already submitted
    // or dropped). Capture a snapshot of the dying run BEFORE we reset
    // — contract evaluation reads pistolOnly / noConsumables / kills /
    // peakLevel / etc. from the snapshot.
    deathRootEl.style.display = 'none';
    // Clean up the locked-trial unlock prompt if the player closes
    // the death screen without acting on it (or after acting).
    document.getElementById('death-unlock-prompt')?.remove();
    playerDead = false;
    _coopSelfDeathBroadcast = false;
    input.clearMouseState();
    const runSnapshot = runStats.snapshot();
    // Mirror Quit-to-title's reset so a fresh Play from the main menu
    // starts cleanly rather than inheriting meta progression.
    playerCredits = 0;
    playerSkillPoints = 0;
    playerLevel = 1;
    playerXp = 0;
    _refreshSkillPointPip();
    skills.levels = Object.create(null);
    classMastery.xp = Object.fromEntries(Object.keys(classMastery.xp).map(k => [k, 0]));
    specialPerks.unlocked = new Set();
    skillTree.levels = Object.create(null);
    artifacts.reset();
    currentWeaponIndex = 0;
    level.index = 0;
    runStats.reset();
    shrineHpBonus = 0;
    pendingShopRerolls = 0;
    giftSacrificeHp = 0;
    sfx.ambientStop();
    // Open the hideout instead of going straight to the main menu.
    // Death = no extract queue (the run was lost); the hideout still
    // pays out any winning contract and lets the player spend chips
    // before they start a fresh run. The hideout's onClose hook
    // (defined at construction) takes them to the main menu next.
    hideoutUI.openWithExtract([], runSnapshot);
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
// Skip Three.js's per-shader-compile getProgramInfoLog read after the
// warmup pass. Profile (Trace-20260426) showed getProgramInfoLog at
// 1.69s self-time during a single play session — Three calls it after
// every shader compile to surface error strings, and on Chromium that
// readback is a synchronous GPU stall. We set it false AFTER the
// boot-time warmup pre-compile so the warmup still surfaces real
// errors; runtime compiles silently succeed (cached shaders never
// error in practice).
renderer.debug.checkShaderErrors = true;
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
let _ctxLostOverlayEl = null;
function _showCtxLostOverlay() {
  if (_ctxLostOverlayEl) return;
  const el = document.createElement('div');
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    background: rgba(5,6,7,0.92);
    color: #00e6ff;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font: 14px ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0.6px; text-align: center; gap: 14px;
    pointer-events: auto;
  `;
  el.innerHTML = `
    <div style="font-size:18px; color:#ff3a3a; letter-spacing:2px;">GRAPHICS CONTEXT LOST</div>
    <div style="color:#8a97a8;">Reloading in <b style="color:#00e6ff;" id="ctx-lost-secs">3</b>…</div>
    <div style="color:#6f6754; font-size:11px; max-width:380px; line-height:1.5;">
      Your browser ran out of WebGL contexts after a long session.
      Reloading recovers the renderer; your run state is saved at the
      last level start.
    </div>
  `;
  document.body.appendChild(el);
  _ctxLostOverlayEl = el;
  let secs = 3;
  const t = setInterval(() => {
    secs -= 1;
    const span = el.querySelector('#ctx-lost-secs');
    if (span) span.textContent = String(Math.max(0, secs));
    if (secs <= 0) { clearInterval(t); location.reload(); }
  }, 1000);
}
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  _ctxLost = true;
  console.warn('[gfx] WebGL context lost — attempting recovery.');
  // Best-effort manual restore — works on Chromium when the loss was
  // triggered by the WEBGL_lose_context extension itself, but won't
  // help if the browser killed the context to free its global cap.
  try {
    const ext = renderer.getContext()?.getExtension?.('WEBGL_lose_context');
    if (ext && typeof ext.restoreContext === 'function') {
      ext.restoreContext();
    }
  } catch (_) {}
  // If the restore handler doesn't fire within ~3s, the loss is
  // permanent — show the overlay and hard-reload.
  _showCtxLostOverlay();
}, false);
renderer.domElement.addEventListener('webglcontextrestored', () => {
  console.warn('[gfx] WebGL context restored — reloading.');
  // Tiny delay so the warn lands in the console before the reload.
  setTimeout(() => location.reload(), 50);
}, false);

const { scene, camera, updateCamera, resize, groundPlane,
  hemiLight, keyLight, fillLight, rimLight, gridHelper, ground } = createScene();
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
// Rig instancer — collapses ~36 source meshes per gunman into shared
// InstancedMesh pools keyed by (geometry, role). Per-actor tint and
// hit-flash drive instanceColor instead of per-rig material lerps.
// Initialized BEFORE GunmanManager so spawn() can call register().
initRigInstancer(scene);
const gunmen = new GunmanManager(scene);
const melees = new MeleeEnemyManager(scene);
const drones = new DroneManager(scene);
const loot = new LootManager(scene);
const level = new Level(scene, { ground });
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

  // --- Currency / rank debug helpers ---------------------------------
  // Pass a number to set the currency to that exact value, or call
  // with no argument to read the current value. All four mutate the
  // localStorage-backed prefs directly + log the result. Refresh any
  // open UI (hideout / contract panels) to see the change land.

  chips(n) {
    if (typeof n === 'number') {
      setPersistentChips(n);
      // Mirror to the in-memory live var so the HUD pip updates next frame.
      try { persistentChips = getPersistentChips(); } catch (_) {}
    }
    const cur = getPersistentChips();
    console.log('[debug] persistent chips =', cur);
    return cur;
  },

  marks(n) {
    if (typeof n === 'number') setMarks(n);
    const cur = getMarks();
    console.log('[debug] marks =', cur);
    return cur;
  },

  sigils(n) {
    if (typeof n === 'number') setSigils(n);
    const cur = getSigils();
    console.log('[debug] sigils =', cur);
    return cur;
  },

  rank(n) {
    if (typeof n === 'number') setContractRank(n);
    const cur = getContractRank();
    console.log('[debug] contract rank =', cur);
    return cur;
  },

  // Force a specific encounter id to spawn on the next floor. Pass no
  // arg to print the available encounter ids so you know what to type.
  // Example: __debug.forceEncounter('priest_disciple')
  forceEncounter(id) {
    const allIds = Object.keys(ENCOUNTER_DEFS).sort();
    if (!id) {
      console.log('[debug] available encounter ids:', allIds);
      return allIds;
    }
    if (!ENCOUNTER_DEFS[id]) {
      console.warn('[debug] unknown encounter id:', id, '— available:', allIds);
      return null;
    }
    queueEncounterFollowup(id, 1);
    console.log('[debug] queued encounter for next floor:', id);
    return id;
  },
};

const inventory = new Inventory();
// Flush any deferred pouch-save on tab close so the last item
// move/drop persists. _bump now schedules saves on idle to avoid
// per-mutation hitches; this is the last-chance commit point.
window.addEventListener('beforeunload', () => {
  try { inventory.flushPouchSave(); } catch (_) {}
});
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
// The five always-free baseline starter weapons, one per major class.
// These are common-rarity, low-power picks that anyone can take into
// any run without spending chips. Permanent unlocks at the Stash
// Armory expand this pool over time.
const BASELINE_STARTER_NAMES = ['Makarov', 'M1911', 'PDW', 'SPCA3', 'Mini-14', 'Mossberg 500', 'Baton'];

function _pickStarterWeapon(weaponClass) {
  // Stash-selected weapon takes precedence over the class roll. The
  // hideout's Stash tab "Take a Weapon" picker writes to this pref;
  // _pickStarterWeapon honors it if the chosen weapon is in the
  // player's available pool (baseline-5 ∪ unlocked). Falls back to
  // class-pick if the selection is invalid or not set.
  const unlockedAll = getUnlockedWeapons();
  const baselineSet = new Set(BASELINE_STARTER_NAMES);
  const selected = getSelectedStarterWeapon();
  if (selected) {
    const def = tunables.weapons.find(w => w.name === selected);
    if (def && !def.mythic && def.rarity !== 'mythic'
        && (baselineSet.has(def.name) || unlockedAll.has(def.name))) {
      return def;
    }
  }
  // Pull the weapon from { baseline-5 ∪ chip-unlocked } filtered by
  // requested class. Mythics still excluded entirely. Falls back to
  // any same-class def if the class isn't represented in the player's
  // unlocked-or-baseline pool.
  const unlocked = unlockedAll;
  const fromStash = tunables.weapons.filter((w) =>
    w.class === weaponClass
    && !w.mythic && w.rarity !== 'mythic'
    && (baselineSet.has(w.name) || unlocked.has(w.name)));
  if (fromStash.length) {
    return fromStash[Math.floor(Math.random() * fromStash.length)];
  }
  // Fallback — same-class non-mythic. Reproduces the prior behaviour
  // for any class the player hasn't unlocked / doesn't have a
  // baseline pick for (e.g. unusual classes added later).
  const candidates = tunables.weapons.filter((w) =>
    w.class === weaponClass && !w.mythic && w.rarity !== 'mythic');
  if (!candidates.length) return tunables.weapons[0];
  return candidates[Math.floor(Math.random() * candidates.length)];
}
// Adds the standard starter consumable kit — 3 bandages + 1 random
// throwable — so a fresh run isn't completely defenseless against bleeds
// or grouped enemies. Called from both startNewRun and the store-rolled
// startRunWithWeaponDef paths.
function _seedStarterKit() {
  for (let i = 0; i < 3; i++) {
    inventory.add({ ...CONSUMABLE_DEFS.bandage });
  }
  const t = randomThrowable();
  if (t) inventory.add(t);
}

// Wipe and re-equip the starter loadout: pants, top, small pack, and
// a common-rarity weapon of the chosen class. Auto-equips the armor.
// Per-run encounter completion set. Replaces the localStorage-backed
// getCompletedEncounters() for spawn-pool filtering — that one
// persisted forever and drained the encounter pool to nothing after
// a few runs. Now we start each run with a fresh empty set so every
// `oncePerSave` encounter is once-per-RUN rather than once-per-save.
const _runCompletedEncounters = new Set();
let _trialPromptedThisRun = new Set();
function _resetEncounterCompletionForRun() {
  _runCompletedEncounters.clear();
  _trialPromptedThisRun = new Set();
  // Per-encounter "appears N times per run" counters live on the
  // ENCOUNTER_DEFS singletons so they persist across multiple
  // spawns within a run. Wipe them here so each new run starts
  // with a fresh budget.
  for (const def of Object.values(ENCOUNTER_DEFS || {})) {
    if (typeof def._completionsThisRun === 'number') def._completionsThisRun = 0;
  }
  // Shrine tier purchases are scoped to the current run too — wipe
  // them here so each fresh run gets all three tiers back.
  resetShrineTiersForRun();
}

// Active contract modifiers for the current run. Populated by
// _refreshActiveModifiers() at run start (and again on contract pick
// in the hideout). Always non-null — `buildModifiers(null)` collapses
// to a clean no-op default with all multipliers at 1.
let _activeModifiers = buildModifiers(null);
function _refreshActiveModifiers() {
  const ac = getActiveContract();
  const def = ac ? defForId(ac.activeContractId) : null;
  _activeModifiers = buildModifiers(def);
}
function getActiveModifiers() { return _activeModifiers; }
window.__activeModifiers = () => _activeModifiers;

// Pay per-kill chip reward for the active contract if the kill
// matches the contract's targetType. Capped at the contract's
// targetCount so overkill doesn't keep paying. When the killing
// blow takes the counter to targetCount, also fire the contract
// claim (bonus chips + marks + sigils + rank bump) right then —
// completion shouldn't wait for a floor transition.
function _applyContractPerKillReward(arch) {
  const ac = getActiveContract();
  if (!ac || (ac.claimedAt | 0) > 0) return;
  const def = defForId(ac.activeContractId);
  if (!def) return;
  const target = def.targetType || 'any';
  if (target !== 'any' && target !== arch) return;
  const counted = (target === 'any')
    ? (runStats.kills | 0)
    : (runStats.archetypeKills?.[target] | 0);
  // Pay the per-kill reward up to targetCount.
  if ((def.perKillReward | 0) > 0 && counted <= (def.targetCount | 0)) {
    awardPersistentChips(def.perKillReward | 0);
  }
  // Per-kill rank-point bonus (rare contracts and up). Capped at
  // targetCount so overkill doesn't farm rank.
  const perKillRank = rankPerKillFor(def);
  if (perKillRank > 0 && counted <= (def.targetCount | 0)) {
    awardRankPoints(perKillRank);
  }
  // Progress toast — fire on every kill that advances the counter
  // (skip the completing kill; that's covered by the longer-lived
  // "Contract complete: …" toast below). Short 1.2s duration so a
  // sweep through a room doesn't stack up tons of overlapping
  // bubbles.
  const targetCount = def.targetCount | 0;
  if (counted > 0 && counted < targetCount) {
    const labelStr = def.label || 'Contract';
    transientHudMsg(`${labelStr}: ${counted}/${targetCount}`, 1.2);
  }
  // Fire the completion claim the moment the counter reaches the
  // target. Mid-run, no floor-transition wait.
  if (counted === (def.targetCount | 0)) {
    try {
      const snapshot = runStats.snapshot();
      const rankBefore = getContractRank();
      const result = tryClaimContract(
        ac, snapshot,
        setActiveContract,
        (n) => awardPersistentChips(n),
        (n) => awardMarks(n),
        () => awardRankPoints(rankRewardFor(def)),
        (n) => awardSigils(n),
      );
      const parts = [];
      if (result.chips > 0)  parts.push(`+${result.chips} chips`);
      if (result.marks > 0)  parts.push(`+${result.marks} marks`);
      if (result.sigils > 0) parts.push(`+${result.sigils} sigils`);
      const completionRank = rankRewardFor(def);
      if (completionRank > 0) parts.push(`+${completionRank} rank pts`);
      if (parts.length) {
        transientHudMsg(`Contract complete: ${parts.join(' · ')}`, 3.0);
      }
      // Mark this run as eligible for a "pick a new contract" choice
      // at the next floor extract. Counter accumulates across multi-
      // contract runs so the player gets repeated offers.
      _runStartContractCompletions = (_runStartContractCompletions | 0) + 1;
      _pendingContractOfferOnExtract = true;
      // Rank-up beat — fires after the contract toast so the
      // player sees the progression land. Each rank-up may also
      // open new weapons for purchase at the Stash Armory.
      const rankAfter = getContractRank();
      if (rankAfter > rankBefore) {
        const named = _newlyBuyableNames(rankBefore, rankAfter);
        const tiers = _newlyBuyableTiers(rankBefore, rankAfter);
        const parts = [];
        if (named.length) parts.push(named.join(' + '));
        if (tiers.length) parts.push(`${tiers.join(' + ')} tier`);
        const tail = parts.length ? ` · ${parts.join(' · ')} now buyable` : '';
        setTimeout(() => transientHudMsg(`RANK UP — Rank ${rankAfter}${tail}`, 3.5), 350);
      }
    } catch (e) { console.warn('[contract-mid-run-claim]', e); }
  }
}

// Returns the weapon-rarity tiers that crossed their BUYABLE_RANK
// threshold between the two rank values. Used by the rank-up toast
// to tell the player "Rare weapons now buyable" etc. Mirrors the
// BUYABLE_RANK ladder in ui_hideout's mission-prep section.
const _BUYABLE_RANK_TIERS = [
  { rarity: 'uncommon',  rank: 2 },
  { rarity: 'rare',      rank: 5 },
  { rarity: 'epic',      rank: 10 },
  { rarity: 'legendary', rank: 18 },
];
function _newlyBuyableTiers(prev, next) {
  const out = [];
  for (const t of _BUYABLE_RANK_TIERS) {
    if (prev < t.rank && next >= t.rank) out.push(t.rarity);
  }
  return out;
}

// Per-weapon `unlockRank` overrides — names the specific iconic gun
// the player just unlocked access to (e.g. "Glock 17 now buyable").
function _newlyBuyableNames(prev, next) {
  const out = [];
  for (const w of (tunables.weapons || [])) {
    const r = w.unlockRank | 0;
    if (r > 0 && prev < r && next >= r) out.push(w.name);
  }
  return out;
}

// Throttled HUD warning when an active contract blocks fire. Avoids
// spamming the message on every trigger pull; cooldown ~1.5s.
let _contractWarnT = 0;
function _maybeWarnContractBlock(msg) {
  const now = performance.now();
  if (now - _contractWarnT < 1500) return;
  _contractWarnT = now;
  transientHudMsg(msg, 1.6);
}

// Dev escape hatch — clears any stale active contract from
// localStorage. Useful when an old run left a melee-only contract
// active and ranged fire is silently blocked. Run from the console:
// `window.__clearActiveContract()`.
window.__clearActiveContract = () => {
  setActiveContract(null);
  _refreshActiveModifiers();
  console.log('[contract] cleared. fire restrictions removed.');
};

// Aim diag — exhaustive readout. Run `window.__diagAim()` with the
// cursor over an enemy. Tells us:
//  - active contract restrictions
//  - fireOrigin / muzzle / aimInfo.point
//  - how many hittables are in the cache + how many are "visible"
//    (have matrixWorld + are in scene)
//  - whether a fresh cursor ray actually intersects any hittable
window.__diagAim = () => {
  const m = _activeModifiers || {};
  console.group('[aim diag]');
  console.log('contract weaponClass:', m.weaponClass || '(none)');
  console.log('contract noConsumables:', !!m.noConsumables);
  console.log('player position:', player?.mesh?.position?.toArray?.());
  if (lastPlayerInfo) {
    console.log('fireOrigin (chest world):', lastPlayerInfo.fireOrigin?.toArray?.());
    console.log('muzzleWorld:', lastPlayerInfo.muzzleWorld?.toArray?.());
    console.log('crouched:', !!lastPlayerInfo.crouched);
  }
  console.log('aimInfo.point:', aimInfo?.point?.toArray?.());
  console.log('aimInfo.zone:', aimInfo?.zone);
  console.log('aimInfo.owner alive?:', !!aimInfo?.owner?.alive);

  // ----- Hittables sanity check -----
  const hits = allHittables();
  console.log('hittables count:', hits.length);
  let inScene = 0, sample = null;
  for (const h of hits) {
    if (h && h.parent) inScene++;
    if (!sample && h && h.userData?.owner) sample = h;
  }
  console.log('hittables with parent (in scene):', inScene);
  if (sample) {
    sample.updateMatrixWorld?.(true);
    const wp = new THREE.Vector3();
    sample.getWorldPosition?.(wp);
    console.log('sample hittable world pos:', wp.toArray?.(), 'zone:', sample.userData?.zone);
  }

  // ----- Live cursor ray test -----
  if (input?.raycaster && input?.mouseNDC && camera) {
    input.raycaster.setFromCamera(input.mouseNDC, camera);
    const enemyHits = input.raycaster.intersectObjects(hits, false);
    console.log('LIVE ray cursor → enemy hits:', enemyHits.length);
    if (enemyHits[0]) {
      const h = enemyHits[0];
      console.log('  first hit object:', h.object?.userData?.zone || '(no zone)',
        'distance:', h.distance.toFixed(2),
        'point:', h.point?.toArray?.());
    }
    const wallHits = input.raycaster.intersectObjects(level.solidObstacles(), false);
    console.log('LIVE ray cursor → wall hits:', wallHits.length);
  } else {
    console.log('input.raycaster not ready');
  }

  if (lastPlayerInfo?.fireOrigin && aimInfo?.point) {
    const dx = aimInfo.point.x - lastPlayerInfo.fireOrigin.x;
    const dy = aimInfo.point.y - lastPlayerInfo.fireOrigin.y;
    const dz = aimInfo.point.z - lastPlayerInfo.fireOrigin.z;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    console.log('fire-dir:', { dx: dx/len, dy: dy/len, dz: dz/len, distance: len.toFixed(2) });
  }
  console.groupEnd();
};

// Run-start baselines for the death-screen rewards readout. Captured
// at startNewRun so we can show "+N" deltas at run end rather than
// the absolute totals.
let _runStartChips = 0;
let _runStartSigils = 0;
let _runStartRank = 0;
let _runStartRankPoints = 0;
let _runStartContractCompletions = 0;
// Last track requested via sfx.musicPlay — used to resume the right
// track when the music toggle is flipped back on.
let _currentMusicTrack = 'menu';
// Sync the audio module's music-enabled flag from the persisted pref
// at boot. Settings → Music toggle calls setAudioMusicEnabled too.
try { setAudioMusicEnabled(getMusicEnabled()); } catch (_) {}
// Set to true when a contract is claimed mid-run; consumed by
// advanceFloor to show a "pick another contract" 3-choice modal
// before the level regenerates.
let _pendingContractOfferOnExtract = false;
function startNewRun(weaponClass) {
  try {
    _runStartChips = getPersistentChips();
    _runStartSigils = getSigils();
    _runStartRank = getContractRank();
    _runStartRankPoints = getRankPoints();
    _runStartContractCompletions = 0;
  } catch (_) {}
  _resetEncounterCompletionForRun();
  // Clear restart-snapshot stack — last run's checkpoints don't apply
  // to this run. The first floor's saveLevelStart will repopulate.
  _levelStartSnapshots.length = 0;
  levelStartSnapshot = null;
  _activeRestartSlot = 0;
  _refreshRestartSlotsUI();
  // Reset any pending starter-buff floor counters from a prior run
  // so a buff bought for the previous (now-ended) run doesn't bleed
  // into this one. _applyStarterBuffs below repopulates from the
  // queue if there's a fresh buff purchase.
  _starterBuffSpeedFloors = 0;
  _starterBuffReloadFloors = 0;
  // Clear keystone window flags from a prior run — they're one-shots
  // consumed at run start. _applyOneShotKeystone below re-sets them
  // if a fresh keystone is in the queue.
  window.__keystoneMythicStart = false;
  window.__keystoneLegendaryStart = false;
  window.__keystonePainDrops = false;
  // Snapshot the active contract's modifiers for the run. Read by
  // the gunmen / loot / damage paths via getActiveModifiers().
  // Resolved lazily from getActiveContract() so the player can switch
  // contracts in the hideout right up until they hit Start Run.
  _refreshActiveModifiers();
  // First-run welcome hint — only fires on the very first ever run
  // because fireHint persists per-player. Subsequent fresh runs see
  // nothing here.
  fireHint('move');
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
  _seedStarterKit();
  // Pre-Run Store starter inventory — items the player bought from
  // the rotating stock get added directly to the run inventory now,
  // then the queue is cleared. Each entry is a marker shape from the
  // store (__storeWeapon / __storeArmor / __storeConsumable / etc.)
  // that we materialize into real inventory items here so the rest
  // of the run code paths see normal item shapes.
  try {
    const queued = consumeStarterInventory();
    for (const raw of queued) {
      if (!raw) continue;
      const real = _materializeStarterItem(raw);
      if (!real) continue;
      // Auto-equip armor — the player paid chips for this piece, so
      // it goes onto the paperdoll for the next run regardless of
      // what's already in the slot. Any displaced piece falls back
      // to loose inventory (or auto-converts later if pockets are
      // full). Non-armor purchases drop into inventory as before.
      const armorSlot = real.__armorSlot;
      if (armorSlot) {
        delete real.__armorSlot;
        const prev = inventory.equipment[armorSlot];
        if (prev) inventory.add(prev);
        inventory.equipment[armorSlot] = real;
      } else {
        inventory.add(real);
      }
    }
    inventory._recomputeCapacity();
  } catch (e) { console.warn('[starter-inventory] consume failed', e); }
  // Apply queued starter buffs (energy drink / adrenaline / lucky
  // coin). Speed + reload buffs decay floor-by-floor; lucky coin
  // adds a pending reroll consumed by the shop UI.
  _applyStarterBuffs();
  // Apply queued one-shot keystones from the Black Market — Deep Run
  // jumps to floor 5 + grants 500 chips; Mythic Start / Legendary
  // Start tag the next class-pick offer pool.
  try {
    const ks = consumeKeystoneQueue();
    for (const id of ks) _applyOneShotKeystone(id);
  } catch (e) { console.warn('[keystone-queue] consume failed', e); }
  inventory._bump();
}

// Apply a one-shot keystone purchased from the Black Market. Each
// id has a different effect, all gated to "fires once at run start
// after the keystone is consumed from the queue."
function _applyOneShotKeystone(id) {
  if (id === 'keystone_deep_run') {
    // Jump to floor 5 + +500 chips at start.
    level.index = 5;
    awardPersistentChips(500);
  } else if (id === 'keystone_mythic_start') {
    // Tag for the class-pick UI to inject a mythic offer. The
    // existing mythic-run unlock plumbing handles offer injection;
    // we set a transient flag the picker reads.
    window.__keystoneMythicStart = true;
  } else if (id === 'keystone_legendary_drop') {
    window.__keystoneLegendaryStart = true;
  } else if (id === 'keystone_pain_drops') {
    // One-shot: Pain (mythic mace) becomes drop-eligible for this
    // run. The loot path reads window.__keystonePainDrops at roll
    // time; cleared at next advanceFloor / death.
    window.__keystonePainDrops = true;
  }
}

// Materialize a Pre-Run Store stock entry into a real inventory item.
// Mirrors the store's `_materializeStoreItem` markers; consumed at
// startNewRun time after the player chooses their loadout.
function _materializeStarterItem(raw) {
  if (raw.__storeWeapon) {
    const def = tunables.weapons.find(w => w.name === raw.defName);
    if (!def) return null;
    return wrapWeapon({ ...def }, { rarity: raw.rarity || def.rarity || 'common' });
  }
  if (raw.__storeArmor) {
    const armorDef = ARMOR_DEFS[raw.defId];
    if (!armorDef) return null;
    const item = _clone(armorDef);
    if (raw.rarity) item.rarity = raw.rarity;
    if (raw.slot) item.__armorSlot = raw.slot;
    return item;
  }
  if (raw.__storeConsumable) {
    const c = CONSUMABLE_DEFS[raw.defId];
    if (!c) return null;
    return { ...c };
  }
  if (raw.__storeAmmo) {
    // Ammo pack — TODO: thread through as a per-class spare-mag
    // bonus once that pipeline supports it. For now return a real
    // bandage so the queue doesn't leak invalid items into the
    // inventory grid.
    return CONSUMABLE_DEFS.bandage ? { ...CONSUMABLE_DEFS.bandage } : null;
  }
  if (raw.__storeBuff) {
    // Buff — schedules a startup effect (move speed / reload speed /
    // free reroll). We push the id into a global pending-buffs queue
    // here; main.js's run-start path applies them.
    _pendingStarterBuffs.push(raw.defId);
    // Return null so nothing concrete enters the inventory; the
    // buff is effect-only.
    return null;
  }
  return null;
}

// Pending buff queue — populated by _materializeStarterItem at run
// start, drained by _applyStarterBuffs below right before the run
// loop begins. Each id maps to a small effect that mutates
// derivedStats / persistentChips / etc. on a one-shot basis.
let _pendingStarterBuffs = [];
function _applyStarterBuffs() {
  if (!_pendingStarterBuffs.length) return;
  for (const id of _pendingStarterBuffs) {
    if (id === 'buff_speed') {
      // +20% move speed for the first 3 floors. Tracked via a
      // floor-counter that decays at every floor transition.
      _starterBuffSpeedFloors = 3;
    } else if (id === 'buff_reload') {
      // +30% reload speed for the first floor only.
      _starterBuffReloadFloors = 1;
    } else if (id === 'buff_luck') {
      // +1 reroll at the first relic merchant. pendingShopRerolls is
      // already a counter that the shop UI consumes.
      pendingShopRerolls = (pendingShopRerolls | 0) + 1;
    }
  }
  _pendingStarterBuffs = [];
}
let _starterBuffSpeedFloors = 0;
let _starterBuffReloadFloors = 0;
window.__starterBuffSpeedActive = () => _starterBuffSpeedFloors > 0;
window.__starterBuffReloadActive = () => _starterBuffReloadFloors > 0;
// Tick the buff floor-counters down on every level transition.
function _tickStarterBuffsOnLevelChange() {
  if (_starterBuffSpeedFloors > 0) _starterBuffSpeedFloors--;
  if (_starterBuffReloadFloors > 0) _starterBuffReloadFloors--;
}
window.__tickStarterBuffsOnLevelChange = _tickStarterBuffsOnLevelChange;

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
const relicsUI = new RelicsUI({ getRelics: () => artifacts.list() });
window.__toggleRelics = () => relicsUI.toggle();
// V hotkey — open / close the standalone Relics panel. Capture-phase
// + bypasses the input.js layer so it works even while inventory or
// other modals are open. Skips while focus is in a text input so
// player-name typing keeps working.
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code !== 'KeyV') return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  e.preventDefault();
  relicsUI.toggle();
}, { capture: true });
window.__showDetails = (item) => detailsUI.show(item);  // called from UI right-click
// Exposed so shop / inventory paths can re-derive stats after side
// effects like repair without an explicit import dance.
window.__recomputeStats = () => { try { recomputeStats(); } catch (_) {} };
window.__hudMsg = (msg, duration) => transientHudMsg(msg, duration);
// Re-render the open inventory + any shop panel after a tag toggle in
// the details modal — keeps the in-grid JUNK / KEEP badges in sync.
window.__rerenderInventory = () => {
  try { inventoryUI.render(); } catch (_) {}
  try { if (shopUI?.isOpen?.()) shopUI.render?.(); } catch (_) {}
};

// Console spawn helper — `__give('m4')`, `__give('medkit', 3)`,
// `__give('Fancy Alcohol')`. Case-insensitive match against every
// item pool: weapons (wrapped with rarity roll), armor, gear,
// attachments, throwables, consumables, junk, toys, relics, encounter
// keys. Logs what it placed (or "no match") so the dev console
// reads the result without opening the inventory. Returns the item.
window.__give = (query, count = 1) => {
  if (!query) { console.warn('[give] usage: __give("m4") or __give("medkit", 3)'); return null; }
  const q = String(query).toLowerCase();
  const matches = (def) => {
    if (!def) return false;
    const id = (def.id || '').toLowerCase();
    const name = (def.name || '').toLowerCase().replace(/<[^>]+>/g, '').trim();
    return id === q || name === q || id.includes(q) || name.includes(q);
  };
  const lookups = [
    { kind: 'weapon', list: tunables.weapons,
      build: (d) => wrapWeapon(d) },
    // Use raw *_DEFS values (not the filtered ALL_*) so encounter-only
    // items like the Small Magical Pack are still reachable via the
    // dev cheat. Players can't get them via natural drops either way.
    { kind: 'armor', list: Object.values(ARMOR_DEFS),
      build: (d) => withAffixes({ ...d, durability: { ...(d.durability || {}) } }) },
    { kind: 'gear', list: Object.values(GEAR_DEFS),
      build: (d) => withAffixes({ ...d, durability: { ...(d.durability || {}) } }) },
    { kind: 'attachment', list: ALL_ATTACHMENTS,
      build: (d) => ({ ...d, modifier: { ...(d.modifier || {}) } }) },
    { kind: 'consumable', list: Object.values(CONSUMABLE_DEFS || {}),
      build: (d) => ({ ...d }) },
    { kind: 'throwable', list: Object.values(THROWABLE_DEFS || {}),    // already raw — includes mythic + encounter-only
      build: (d) => makeThrowable(d) },
    { kind: 'junk', list: Object.values(JUNK_DEFS || {}),
      build: (d) => ({ ...d }) },
    { kind: 'toy', list: Object.values(TOY_DEFS || {}),
      build: (d) => ({ ...d }) },
    { kind: 'relic', list: ALL_ARTIFACTS,
      build: (d) => relicFor(d.id) },
  ];
  for (const { kind, list, build } of lookups) {
    const def = (list || []).find(matches);
    if (!def) continue;
    let last = null;
    for (let i = 0; i < Math.max(1, count | 0); i++) {
      const item = build(def);
      if (!item) continue;
      inventory.add(item);
      last = item;
    }
    onInventoryChanged?.();
    inventoryUI.render();
    console.log(`[give] +${count} ${kind}: ${def.name || def.id}`);
    return last;
  }
  console.warn(`[give] no match for "${query}"`);
  return null;
};
// Convenience: list every spawnable id grouped by kind. `__list()`
// or `__list('belt')` to filter.
window.__list = (filter) => {
  const f = filter ? String(filter).toLowerCase() : null;
  const groups = {
    weapons: tunables.weapons.map(d => d.name),
    armor: Object.values(ARMOR_DEFS).map(d => d.name),
    gear: Object.values(GEAR_DEFS).map(d => d.name),
    attachments: ALL_ATTACHMENTS.map(d => d.name),
    consumables: Object.values(CONSUMABLE_DEFS || {}).map(d => d.name),
    throwables: Object.values(THROWABLE_DEFS || {}).map(d => d.name),
    junk: Object.values(JUNK_DEFS || {}).map(d => d.name),
    toys: Object.values(TOY_DEFS || {}).map(d => d.name),
    relics: ALL_ARTIFACTS.map(d => d.name),
  };
  if (!f) return groups;
  const out = {};
  for (const [k, list] of Object.entries(groups)) {
    const hits = list.filter(n => (n || '').toLowerCase().includes(f));
    if (hits.length) out[k] = hits;
  }
  return out;
};

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
    // Owned artifacts/relics — was previously omitted, so a save/load
    // wiped every relic the player had collected. Persist as a flat
    // id list to mirror the resetSnapshot / runStats pattern.
    artifacts: [...artifacts.owned],
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
    classMastery.fillMissing();
    specialPerks.unlocked = new Set(s.specialPerks || []);
    skillTree.levels = { ...(s.skillTree || {}) };
    // Restore owned artifacts. Older saves predate this field — fall
    // back to whatever's in artifacts.owned so we don't wipe relics
    // a long-running save user may have on a now-loaded older save.
    if (Array.isArray(s.artifacts)) {
      artifacts.owned = new Set(s.artifacts);
    }
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
    _refreshSkillPointPip();
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
    shrineHpBonus = 0;
    pendingShopRerolls = 0;
    giftSacrificeHp = 0;
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
    shrineHpBonus = 0;
    pendingShopRerolls = 0;
    giftSacrificeHp = 0;
    playerDead = false;
    if (deathRootEl) deathRootEl.style.display = 'none';
    // Full HP reset — otherwise state.health from the previous death
    // (= 0) survives into the new run and the tick's death-detection
    // branch re-fires immediately on frame 1.
    // applyDerivedStats fires BEFORE restoreFullHealth so state.maxHealth
    // reflects Trainer HP upgrades / equipment bonuses BEFORE the snap.
    // Otherwise the snap pins health to a stale max and the player
    // spawns missing the difference.
    recomputeStats();
    player.applyDerivedStats(derivedStats);
    player.restoreFullHealth();
    regenerateLevel();
    sfx.ambientStart();
    _currentMusicTrack = 'run'; sfx.musicPlay?.('run');
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
  _seedStarterKit();
  inventory._bump();
  currentWeaponIndex = 0;
  level.index = 0;
  runStats.reset();
  shrineHpBonus = 0;
  pendingShopRerolls = 0;
  giftSacrificeHp = 0;
  // Mythic-run starter pick — flag the run + bump the difficulty
  // index so the first generated floor reads at level 20 in the
  // diff curve (regenerateLevel below will increment it to 20 from
  // the 19 we set here).
  if (def && def._mythicRunOffer) {
    runStats.mythicRun = true;
    level.index = 19;
    transientHudMsg('MYTHIC RUN', 4.0);
  }
  playerDead = false;
  if (deathRootEl) deathRootEl.style.display = 'none';
  // Recompute derived stats first so state.maxHealth reflects the
  // freshly-equipped loadout + Trainer HP upgrades, THEN snap health
  // back to max. Order matters: applyDerivedStats writes state.maxHealth
  // from derivedStats; restoreFullHealth reads state.maxHealth.
  recomputeStats();
  player.applyDerivedStats(derivedStats);
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
  // Mythic-run unlock — append one always-mythic offer (excluding
  // Jessica's Rage). Tag it so startRunWithWeaponDef can flip the
  // run into mythic mode + lvl-20 difficulty.
  if (getMythicRunUnlocked()) {
    const mythicPool = tunables.weapons.filter(w =>
      w.mythic && !w.pactReward && !w.encounterOnly && w.name !== "Jessica's Rage");
    if (mythicPool.length) {
      const mw = mythicPool[Math.floor(Math.random() * mythicPool.length)];
      offers.push({ ...mw, rarity: 'mythic', _mythicRunOffer: true });
    }
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
  // Per-merchant stock-size upgrades + global reroll unlock.
  getMerchantUpgrades,
  setMerchantUpgrade,
  merchantUpgradeNextCost,
  merchantKinds: MERCHANT_KINDS,
  merchantUpgradeMax: MERCHANT_UPGRADE_MAX,
  getRerollUnlocked,
  setRerollUnlocked,
  rerollUnlockCost: REROLL_UNLOCK_COST,
  onClose: () => { mainMenuUI.show(); },
});

const storeRollUI = new StoreRollUI({
  onPick: (def) => {
    mainMenuUI.hide();
    startRunWithWeaponDef(def);
  },
  onCancel: () => { mainMenuUI.show(); },
});

// Co-op lobby — created lazily, only if the feature flag is on. The
// rest of the game runs unchanged when coop is off. Shift+C toggles
// the overlay so the lobby is reachable from gameplay; players don't
// need to drop back to the main menu to invite a friend.
let coopLobby = null;
let coopGhostRoot = null;
const _coopGhostMeshes = new Map();   // peerId → { group, label }
let _coopBroadcastT = 0;
// Snapshot pacing — host publishes every 1/20s; joiner latches the
// most recent snapshot it's seen and applies on the next tick. Older
// snapshots are dropped (seq < latestSeq) so out-of-order packets
// don't briefly rewind enemy state.
let _coopSnapshotT = 0;
let _coopSnapshotSeq = 0;
let _coopPendingSnapshot = null;
let _coopLatestSeq = -1;
// Joiner deferred-regen flag — set when a non-host calls regenerateLevel
// before receiving the host's seed. The level-seed listener clears it
// and runs a real regen so the layout matches the host.
let _coopRegenPending = false;
// Per-frame budget for fx-tracer broadcasts. Bullet-hell archetypes
// can fire 14 shots in a single frame; sending all of those over the
// wire would saturate. Cap at 8 tracers/frame; the rest skip.
// Recharged at the top of every host tick.
let _coopAiTracerBudget = 8;

// ─── Downed / revive state ────────────────────────────────────────
// Phase 1 of the coop downed system. When a coop player would die,
// they instead enter the downed state — locked in place, can't move
// or fire, bleedout timer ticking. A teammate can hold interact on
// the body to revive them (progress bar fills over reviveHoldSec;
// decays when interact is released). Run only ends when ALL peers
// are downed simultaneously and all bleedouts expire.
//
// Phase 2 (next session): hold-interact also surfaces a non-blocking
// popup with reviver + downed inventories (health items only); using
// items chunks time off the revive or pauses decay (tourniquet),
// with defib granting an instant full-HP revive.
//
// Local-player downed state.
let _localDowned = false;
let _localBleedoutT = 0;
let _localReviveT = 0;            // 0 .. tunables.coop.reviveHoldSec
let _localReviveActive = false;   // true while a teammate is holding interact on us
// Per-peer downed state (host AND joiner both track this — host is
// authoritative, joiners receive via rpc-downed broadcast).
const _coopPeerDowned = new Map();   // peerId → { bleedoutT, reviveT, reviverPeerId|null }
// Reviver-side state.
let _reviveTargetPeerId = null;   // who we're reviving (null = no-one)
let _reviveHoldT = 0;             // local hold timer; mirrored to host via rpc-revive-hold
let _reviveLastSendT = 0;

function _coopHasLivingTeammate() {
  const t = getCoopTransport();
  if (!t.isOpen || !coopLobby) return false;
  // For each peer in the room, count those NOT currently downed.
  for (const peerId of t.peers.keys()) {
    if (peerId === t.peerId) continue;     // skip self
    if (!_coopPeerDowned.has(peerId)) return true;   // a peer is alive
  }
  return false;
}
function _enterDownedState() {
  if (_localDowned) return;
  _localDowned = true;
  _localBleedoutT = tunables.coop?.reviveBleedoutSec ?? 60;
  _localReviveT = 0;
  _localReviveActive = false;
  // Lock player input — set health to 1 (above zero) so the death
  // detection elsewhere doesn't re-fire, but flag downed so movement
  // / fire / interact code can early-out. The player's mesh stays
  // at the ragdolled position locally; visuals via _renderDownedHud.
  if (player && player.applyDownedState) player.applyDownedState(true);
  // Broadcast to peers so they can render the downed state.
  const t = getCoopTransport();
  if (t.isOpen) {
    if (t.isHost) {
      // Host's own entry into _coopPeerDowned so the rpc-revive-hold
      // handler can find it when joiners try to revive us. Without
      // this, the host is downed in _localDowned but invisible to
      // the revive lookup. Reviver-tick on host already skips
      // _localDowned so we won't try to revive ourselves.
      _coopPeerDowned.set(t.peerId, {
        bleedoutT: _localBleedoutT,
        reviveT: 0,
        reviverPeerId: null,
        isHostSelf: true,
      });
      t.send('rpc-downed', { p: t.peerId, b: _localBleedoutT, meds: _coopMyMedicalIds() });
    } else {
      // Joiner went down — tell host via the joiner-allowed kind.
      // Host re-broadcasts as rpc-downed (host-only kind on the wire).
      t.send('rpc-self-down', { b: _localBleedoutT, meds: _coopMyMedicalIds() });
    }
  }
  // Surface a HUD message so the player understands.
  try { transientHudMsg('DOWN — bleedout 60s — teammate must revive', 6.0); } catch (_) {}
}
// Coop throwable sync. Two routes:
//  - Host throws  → fx-throwable broadcast to joiners (visual mirror,
//    damage zeroed on receive — host's local projectile already
//    applied auth damage to enemies).
//  - Joiner throws → rpc-throwable to host. Host spawns the
//    authoritative projectile + broadcasts fx-throwable to OTHER
//    joiners (server excludes the sender so the original joiner
//    doesn't see a duplicate). Joiner's local spawn is neutered to
//    visual-only via _coopNeuterThrowOpts so it doesn't fight host's
//    snapshot for enemy damage.
function _coopSerializeThrowOpts(opts) {
  return {
    px: +opts.pos.x.toFixed(2),
    py: +opts.pos.y.toFixed(2),
    pz: +opts.pos.z.toFixed(2),
    vx: +opts.vel.x.toFixed(2),
    vy: +opts.vel.y.toFixed(2),
    vz: +opts.vel.z.toFixed(2),
    lt: +(opts.lifetime ?? 2.0).toFixed(2),
    r:  +(opts.radius ?? 0.07).toFixed(3),
    c:  (opts.color | 0) || 0xb04030,
    er: +((opts.explosion?.radius) ?? 3.5).toFixed(2),
    ed: +((opts.explosion?.damage) ?? 0).toFixed(0),
    es: +((opts.explosion?.shake)  ?? 0.35).toFixed(2),
    g:  +(opts.gravity ?? 9.8).toFixed(2),
    b:  +(opts.bounciness ?? 0).toFixed(2),
    tk: opts.throwKind || 'frag',
    fl: opts.fuseAfterLand ? 1 : 0,
    // Effect-bearing flags so host's auth spawn matches the original
    // throw type (DoT durations, blind/stun timers, claymore radius).
    fd: +(opts.fireDuration    || 0).toFixed(2),
    ft: +(opts.fireTickDps     || 0).toFixed(0),
    gd: +(opts.gasDuration     || 0).toFixed(2),
    smd: +(opts.smokeDuration  || 0).toFixed(2),
    bd: +(opts.blindDuration   || 0).toFixed(2),
    sd: +(opts.stunDuration    || 0).toFixed(2),
    tr: +(opts.triggerRadius   || 0).toFixed(2),
    tc: +(opts.triggerConeDeg  || 0).toFixed(0),
    dx: +(opts.throwDirX       || 0).toFixed(2),
    dz: +(opts.throwDirZ       || 0).toFixed(2),
  };
}
function _coopBroadcastThrowable(opts) {
  const t = getCoopTransport();
  if (!t.isOpen) return;
  if (!t.peers || t.peers.size === 0) return;
  try {
    const payload = _coopSerializeThrowOpts(opts);
    if (t.isHost) {
      t.send('fx-throwable', payload);
    } else {
      // Joiner — host applies auth, then re-broadcasts fx-throwable
      // to other peers. Server excludes us from that fanout.
      t.send('rpc-throwable', payload);
    }
  } catch (_) {}
}
// Strip damage + effect timers from a throwable opts object so a
// joiner's local mirror doesn't double-damage snapshot enemies. Host
// holds the auth copy via rpc-throwable. Visual zone durations
// (fire/gas/smoke) are preserved so the joiner sees their own
// landing effects; the zone tick gates damage on owner !== 'remote'.
function _coopNeuterThrowOpts(opts) {
  const t = getCoopTransport();
  if (!t.isOpen || t.isHost) return opts;
  return {
    ...opts,
    owner: 'remote',                        // gates DoT in zone ticks
    explosion: { ...(opts.explosion || {}), damage: 0 },
    fireTickDps: 0,
    blindDuration: 0,
    stunDuration: 0,
    // Keep gasDuration / fireDuration / smokeDuration intact so the
    // local mirror still spawns the visual zone. Owner='remote' on
    // those zones blocks the damage tick.
  };
}

// Coop encounter sync. Both peers see the SAME encounter in the
// same spot — host's pick is canonical, joiner pops it from a queue
// keyed by room order. Spawn is wrapped in a stable per-encounter
// seed so NPC pose / dialogue picks / chest loot rolls land
// identically on both peers. Interaction-time state (priest refusal
// counter, shrine activation, dialogue branch) stays local on each
// peer's enc.state — they can talk to their own copy independently.
let _coopHostEncounterIds = [];
let _coopForcedEncounterQueue = [];
function _coopPickEncounter(levelIndex) {
  const t = getCoopTransport();
  if (t.isOpen && !t.isHost && _coopForcedEncounterQueue.length > 0) {
    const id = _coopForcedEncounterQueue.shift();
    if (id && ENCOUNTER_DEFS[id]) return ENCOUNTER_DEFS[id];
  }
  // Isolate the pick from the outer seeded RNG. Without this, host's
  // pickEncounterForLevel consumes Math.random calls that the joiner
  // skips (joiner pops from the forced queue), shifting host's
  // seeded state vs joiner's for everything that runs AFTER the
  // encounter conversion loop — e.g. encounter SPAWN POSITIONS were
  // landing in different spots per peer because subsequent room
  // prop / container scatter rolls diverged.
  const def = _withOriginalRandom(() => pickEncounterForLevel(
    levelIndex, _runCompletedEncounters, runStats, artifacts, inventory,
  ));
  if (t.isOpen && t.isHost && def) _coopHostEncounterIds.push(def.id);
  return def;
}

// Joiner-side stash persistence. Cold Exit's transport can drop on a
// network blip / browser-tab swap; without persistence the joiner
// re-joins with a fresh starter loadout. Snapshots equipment + grids
// + class progression keyed by roomId so a re-join inside the TTL
// restores everything. Host's state persists naturally in their own
// browser session and skips this flow.
const _COOP_STASH_KEY = 'tacticalrogue:coop-joiner-stash:v1';
const _COOP_STASH_TTL_MS = 30 * 60 * 1000;     // 30min — disconnect window
let _coopStashSaveT = 0;                       // periodic-save throttle

function _coopSaveJoinerState() {
  if (!coopLobby) return;
  const t = getCoopTransport();
  if (!t.isOpen || t.isHost) return;
  if (!t.roomId) return;
  try {
    const payload = {
      ts: Date.now(),
      roomId: t.roomId,
      levelIndex: level?.index | 0,
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
      pendingLevelUpPicks: _pendingLevelUpPicks | 0,
    };
    localStorage.setItem(_COOP_STASH_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('[coop] save joiner state failed', e);
  }
}

function _coopRestoreJoinerState() {
  const t = getCoopTransport();
  if (!t.isOpen || t.isHost || !t.roomId) return false;
  let payload;
  try {
    const raw = localStorage.getItem(_COOP_STASH_KEY);
    if (!raw) return false;
    payload = JSON.parse(raw);
  } catch (_) { return false; }
  if (!payload || payload.roomId !== t.roomId) return false;
  if (Date.now() - payload.ts > _COOP_STASH_TTL_MS) {
    localStorage.removeItem(_COOP_STASH_KEY);
    return false;
  }
  try {
    playerCredits = payload.credits || 0;
    playerSkillPoints = payload.skillPoints || 0;
    playerLevel = payload.charLevel || 1;
    playerXp = payload.xp || 0;
    skills.levels = { ...payload.skills };
    classMastery.xp = { ...payload.classXp };
    classMastery.fillMissing();
    specialPerks.unlocked = new Set(payload.specialPerks || []);
    skillTree.levels = { ...(payload.skillTree || {}) };
    artifacts.owned = new Set(payload.artifacts || []);
    // Inventory restore — same shape as restoreFromSnapshot but
    // inlined so we don't pollute the restart-slot stack.
    for (const slot in payload.inventory.equipment) {
      inventory.equipment[slot] = snapshotItem(payload.inventory.equipment[slot]);
    }
    inventory._recomputeCapacity();
    const loadInto = (grid, snap) => {
      if (!grid || !snap) return;
      grid.clear();
      if (snap.w && snap.h && (snap.w !== grid.w || snap.h !== grid.h)) {
        grid.resize(snap.w, snap.h);
      }
      for (const e of snap.entries || []) {
        const it = snapshotItem(e.item);
        if (!it) continue;
        if (!grid.place(it, e.x, e.y, !!e.rotated)) grid.autoPlace(it);
      }
    };
    inventory.pocketsGrid.clear();
    if (payload.inventory.pockets) {
      loadInto(inventory.pocketsGrid, payload.inventory.pockets);
      if (inventory.rigGrid)      loadInto(inventory.rigGrid,      payload.inventory.rig);
      if (inventory.backpackGrid) loadInto(inventory.backpackGrid, payload.inventory.backpackGrid);
    }
    if (typeof currentWeaponIndex !== 'undefined' && typeof payload.currentWeaponIndex === 'number') {
      currentWeaponIndex = payload.currentWeaponIndex;
    }
    _pendingLevelUpPicks = payload.pendingLevelUpPicks || 0;
    inventory._bump?.();
    try { recomputeStats(); } catch (_) {}
    try { inventoryUI.render(); } catch (_) {}
    try { _refreshPickQueueHud(); } catch (_) {}
    transientHudMsg('STASH RESTORED', 3.0);
    localStorage.removeItem(_COOP_STASH_KEY);
    return true;
  } catch (e) {
    console.warn('[coop] restore joiner state failed', e);
    return false;
  }
}

// Broadcast that the local player has truly died (post-bleedout, or
// solo death with no living teammate). Receivers strip the downed
// overlay, hide the dead peer's rig, and surface a toast. Idempotent
// via _coopSelfDeathBroadcast — only fires once per run.
let _coopSelfDeathBroadcast = false;
function _coopBroadcastSelfDied() {
  if (_coopSelfDeathBroadcast) return;
  const t = getCoopTransport();
  if (!t.isOpen) return;
  _coopSelfDeathBroadcast = true;
  try { t.send('rpc-peer-died', { p: t.peerId }); } catch (_) {}
}

function _leaveDownedState(restoreHpPct = 0.30) {
  if (!_localDowned) return;
  _localDowned = false;
  _localBleedoutT = 0;
  _localReviveT = 0;
  _localReviveActive = false;
  if (player && player.applyDownedState) player.applyDownedState(false);
  if (player && player.restoreHealthPct) {
    player.restoreHealthPct(Math.max(0.05, Math.min(1, restoreHpPct)));
  }
  try { transientHudMsg('REVIVED', 3.0); } catch (_) {}
  // Screen flash — bright cyan ramp-out so the player knows they're
  // back up. Builds the overlay on first revive and reuses it.
  try { _flashRevive(); } catch (_) {}
  try { sfx.uiAccept?.(); } catch (_) {}
}

let _reviveFlashEl = null;
function _flashRevive() {
  if (!_reviveFlashEl) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', inset: '0', zIndex: '6',
      background: 'radial-gradient(ellipse at center, rgba(120,220,255,0.55), rgba(60,120,200,0.25) 50%, rgba(0,0,0,0) 80%)',
      pointerEvents: 'none', opacity: '0',
      transition: 'opacity 1200ms ease-out',
    });
    document.body.appendChild(el);
    _reviveFlashEl = el;
  }
  const el = _reviveFlashEl;
  el.style.transition = 'none';
  el.style.opacity = '1';
  // Force reflow so the next opacity change actually animates.
  void el.offsetWidth;
  el.style.transition = 'opacity 1200ms ease-out';
  el.style.opacity = '0';
}
// Megaboss hazard sync (DoT half) — host-side scanner. Runs after
// megaBoss.update each frame; iterates the long-lived DoT hazard
// arrays (fire pools + gas clouds) and broadcasts rpc-player-damage
// to any joiner ghost inside the danger zone, throttled per-(hazard,
// peer). Burst hazards (bullets / shells / grenades / slam / charge)
// are handled inside megaboss.js via the damageRemotePlayersInRadius
// ctx callback so the joiner damage lands on the same frame the host
// damage does — by the time this scanner runs, those entries have
// already been spliced from their arrays.
function _coopTickMegabossHazards() {
  if (!megaBoss || !coopLobby) return;
  const t = getCoopTransport();
  if (!t.isOpen || !t.isHost) return;
  if (coopLobby.ghosts.size === 0) return;
  for (const f of megaBoss.firePools || []) {
    if (!f._coopLastTick) f._coopLastTick = Object.create(null);
    const r2 = (f.radius || 1) * (f.radius || 1);
    for (const [peerId, ghost] of coopLobby.ghosts) {
      const dx = ghost.x - f.x, dz = ghost.z - f.z;
      if (dx * dx + dz * dz >= r2) continue;
      const lastTick = f._coopLastTick[peerId] || 0;
      if ((f.t - lastTick) > 0.33) {
        f._coopLastTick[peerId] = f.t;
        _coopSendPlayerDamage(peerId, f.dmg, 'fire', { zone: 'torso' });
      }
    }
  }
  for (const c of megaBoss.gasClouds || []) {
    if (!c._coopLastTick) c._coopLastTick = Object.create(null);
    const sc = 1 + (c.t / Math.max(0.001, c.life)) * 0.25;
    const r = (c.radius || 1) * sc;
    const r2 = r * r;
    for (const [peerId, ghost] of coopLobby.ghosts) {
      const dx = ghost.x - c.x, dz = ghost.z - c.z;
      if (dx * dx + dz * dz >= r2) continue;
      const lastTick = c._coopLastTick[peerId] || 0;
      if ((c.t - lastTick) > 0.4) {
        c._coopLastTick[peerId] = c.t;
        _coopSendPlayerDamage(peerId, c.dmg, 'gas', { zone: 'torso' });
      }
    }
  }
}

// Burst-hazard helper called from megaboss.js right after each host
// damagePlayer site. Independent of the host hit (a joiner can be
// inside the radius even when the host isn't), so the joiner check
// runs unconditionally. Type maps to rpc-player-damage's `t` field —
// `megaboss`, `fire`, `gas`, `melee`, `ballistic`. Pass an optional
// `oncePerPeerSet` to gate repeat hits within a single attack (e.g.
// charge attacks hit each peer at most once).
// Telegraph ring broadcast. Joiner spawns a transient ring at the
// given world XZ that fades over `life` seconds — same visual the
// host renders for artillery shells / aoe warnings. Without this,
// the joiner only sees the boss's body move and has no warning of
// where the strike will land.
function _coopBroadcastTelegraphRing(x, z, radius, life, color) {
  const t = getCoopTransport();
  if (!t.isOpen || !t.isHost) return;
  if (!t.peers || t.peers.size === 0) return;
  t.send('fx-ring', {
    x: +x.toFixed(2), z: +z.toFixed(2),
    r: +radius.toFixed(2),
    l: +Math.max(0.1, life).toFixed(2),
    c: (color | 0) || 0xff4040,
  });
}

// Megaboss bullet tracer broadcast. Routes through the existing
// fx-tracer kind so the joiner's combat.spawnShot renders the line
// + flash. Cheap (one packet per bullet); host-only and only when
// peers are connected.
function _coopBroadcastMegabossTracer(x1, y1, z1, x2, z2, color) {
  const t = getCoopTransport();
  if (!t.isOpen || !t.isHost) return;
  if (!t.peers || t.peers.size === 0) return;
  t.send('fx-tracer', {
    x1: +x1.toFixed(2), y1: +y1.toFixed(2), z1: +z1.toFixed(2),
    x2: +x2.toFixed(2), y2: 1.0, z2: +z2.toFixed(2),
    c: (color | 0) || 0xffa040,
  });
}

function _coopDamageRemotePlayersInCone(cx, cz, dirAng, halfConeRad, range, dmg, type) {
  if (!coopLobby) return false;
  const t = getCoopTransport();
  if (!t.isOpen || !t.isHost) return false;
  if (coopLobby.ghosts.size === 0) return false;
  const r2 = range * range;
  let anyHit = false;
  for (const [peerId, ghost] of coopLobby.ghosts) {
    const dx = ghost.x - cx, dz = ghost.z - cz;
    if (dx * dx + dz * dz > r2) continue;
    const angToPeer = Math.atan2(dx, dz);
    let delta = angToPeer - dirAng;
    while (delta >  Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= halfConeRad) {
      _coopSendPlayerDamage(peerId, dmg, type || 'megaboss', { zone: 'torso' });
      anyHit = true;
    }
  }
  return anyHit;
}

function _coopDamageRemotePlayersInRadius(x, z, radius, dmg, type, oncePerPeerSet = null) {
  if (!coopLobby) return false;
  const t = getCoopTransport();
  if (!t.isOpen || !t.isHost) return false;
  if (coopLobby.ghosts.size === 0) return false;
  const r2 = radius * radius;
  let anyHit = false;
  for (const [peerId, ghost] of coopLobby.ghosts) {
    if (oncePerPeerSet && oncePerPeerSet.has(peerId)) continue;
    const dx = ghost.x - x, dz = ghost.z - z;
    if (dx * dx + dz * dz < r2) {
      if (oncePerPeerSet) oncePerPeerSet.add(peerId);
      _coopSendPlayerDamage(peerId, dmg, type || 'megaboss', { zone: 'torso' });
      anyHit = true;
    }
  }
  return anyHit;
}

// Reviver-side: detect downed teammate within range, accumulate
// hold-progress while interact is held, send hold state to host (or
// run auth locally if we are host). Phase 2 will surface a popup
// with health-item grids the reviver can click to chunk time off.
function _tickReviveInteract(dt) {
  const t = getCoopTransport();
  if (!t.isOpen) return;
  if (_localDowned) return;
  const px = player?.mesh?.position?.x ?? 0;
  const pz = player?.mesh?.position?.z ?? 0;
  const range = tunables.coop?.reviveRange ?? 1.6;
  const r2 = range * range;
  let target = null, bestD = r2;
  for (const [peerId, st] of _coopPeerDowned) {
    if (!st || st.bleedoutT <= 0) continue;
    const ghost = coopLobby?.ghosts?.get(peerId);
    if (!ghost) continue;
    const dx = ghost.x - px, dz = ghost.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; target = peerId; }
  }
  const totalHold = tunables.coop?.reviveHoldSec ?? 20;
  const decaySec  = tunables.coop?.reviveDecaySec ?? 12;
  // E-press while in range opens the medical menu (overlay) listing
  // both peers' revive items. Selecting one consumes from that pack
  // and applies the effect. The menu pauses the input swap (closing
  // returns input control). Closed via Escape or click-outside.
  if (target && lastSampledInput && lastSampledInput.interactPressed && !_medicalMenuOpen) {
    lastSampledInput.interactPressed = false;     // consume so tryInteract skips
    _openMedicalMenu(target);
    return;
  }
  // Auto-revive — proximity alone fills the bar. No hold required.
  // Closing the medical menu doesn't reset the bar; the player can
  // walk up, get partial fill, peek the menu, walk back to keep
  // filling. Bleedout pauses while reviveT > 0 (already host-side).
  if (target) {
    if (_reviveTargetPeerId !== target) {
      _reviveTargetPeerId = target;
      _reviveHoldT = 0;
    }
    _reviveHoldT = Math.min(totalHold, _reviveHoldT + dt);
    _reviveLastSendT -= dt;
    if (_reviveLastSendT <= 0) {
      _reviveLastSendT = 0.2;
      if (t.isHost) {
        if (_reviveHoldT >= totalHold) {
          const hpPct = tunables.coop?.reviveHpPct ?? 0.30;
          t.send('rpc-revived', { p: target, hp: hpPct });
          _coopPeerDowned.delete(target);
          _reviveTargetPeerId = null;
          _reviveHoldT = 0;
        } else {
          t.send('rpc-revive-progress', { p: target, t: _reviveHoldT, a: true });
        }
      } else {
        t.send('rpc-revive-hold', { t: target, h: true });
      }
    }
  } else {
    if (_reviveTargetPeerId) {
      if (!t.isHost) t.send('rpc-revive-hold', { t: _reviveTargetPeerId, h: false });
      else {
        t.send('rpc-revive-progress', { p: _reviveTargetPeerId, t: _reviveHoldT, a: false });
      }
    }
    _reviveHoldT = Math.max(0, _reviveHoldT - dt * (totalHold / Math.max(0.1, decaySec)));
    if (_reviveHoldT <= 0) _reviveTargetPeerId = null;
  }
}

// Medical menu — modal that lists revive items in BOTH the local
// reviver's pack and the downed peer's pack (sent in rpc-downed.meds).
// Selecting an item sends rpc-revive-item with srcPack indicating
// which side gives up the consumable. Auto-closes on revive complete.
let _medicalMenuOpen = false;
let _medicalMenuRoot = null;
let _medicalMenuTarget = null;
function _openMedicalMenu(targetPeer) {
  if (_medicalMenuOpen) return;
  const downed = _coopPeerDowned.get(targetPeer);
  if (!downed) return;
  _medicalMenuOpen = true;
  _medicalMenuTarget = targetPeer;
  if (!_medicalMenuRoot) {
    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '110',
      background: 'rgba(8,12,16,0.78)',
      display: 'none', alignItems: 'center', justifyContent: 'center',
      font: '13px ui-monospace, Menlo, Consolas, monospace',
    });
    root.id = 'medical-menu';
    root.addEventListener('click', (e) => { if (e.target === root) _closeMedicalMenu(); });
    document.body.appendChild(root);
    _medicalMenuRoot = root;
  }
  const root = _medicalMenuRoot;
  root.innerHTML = '';
  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'linear-gradient(180deg, #1a2228, #0c1014)',
    border: '1px solid #c0e0ff', borderRadius: '6px',
    padding: '20px 24px', maxWidth: '520px', width: '90%',
    boxShadow: '0 0 36px rgba(120,200,255,0.35)',
    color: '#f2e7c9',
  });
  const title = document.createElement('div');
  Object.assign(title.style, {
    color: '#a0d8ff', fontWeight: '700', fontSize: '14px',
    letterSpacing: '3px', textTransform: 'uppercase',
    textAlign: 'center', marginBottom: '4px',
  });
  title.textContent = 'MEDICAL';
  card.appendChild(title);
  const sub = document.createElement('div');
  Object.assign(sub.style, {
    color: '#a89070', fontSize: '11px', textAlign: 'center',
    marginBottom: '14px', letterSpacing: '1.5px',
  });
  sub.textContent = 'Pick a revive item — auto-revive continues meanwhile';
  card.appendChild(sub);
  const myMeds = _coopMyMedicalIds();
  const theirMeds = Array.isArray(downed.meds) ? downed.meds.slice() : [];
  const sectionTitle = (label, count) => {
    const el = document.createElement('div');
    Object.assign(el.style, {
      color: '#80c0e0', fontSize: '11px', letterSpacing: '2px',
      textTransform: 'uppercase', margin: '10px 0 6px',
      borderBottom: '1px solid rgba(120,200,255,0.25)', paddingBottom: '3px',
    });
    el.textContent = `${label} — ${count} item${count === 1 ? '' : 's'}`;
    return el;
  };
  const groupCounts = (ids) => {
    const m = new Map();
    for (const id of ids) m.set(id, (m.get(id) || 0) + 1);
    return m;
  };
  const buildRow = (id, count, srcPack) => {
    const meta = _MEDICAL_LABELS[id];
    if (!meta) return null;
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      width: '100%', textAlign: 'left',
      padding: '10px 14px', marginBottom: '6px',
      background: 'rgba(20,36,52,0.55)',
      border: '1px solid #4a6a82', borderRadius: '4px',
      color: '#f2e7c9', font: 'inherit', cursor: 'pointer',
    });
    btn.onmouseenter = () => { btn.style.background = 'rgba(40,72,104,0.75)'; btn.style.borderColor = '#a0d8ff'; };
    btn.onmouseleave = () => { btn.style.background = 'rgba(20,36,52,0.55)'; btn.style.borderColor = '#4a6a82'; };
    const left = document.createElement('span');
    Object.assign(left.style, { fontWeight: '700', color: '#ffd070' });
    left.textContent = `${meta.label}${count > 1 ? ` × ${count}` : ''}`;
    const right = document.createElement('span');
    Object.assign(right.style, { fontSize: '11px', color: '#b8a890' });
    right.textContent = meta.kind === 'tourniquet'
      ? 'Reset bleedout'
      : `Revive ${Math.round(meta.hpPct * 100)}%`;
    btn.appendChild(left);
    btn.appendChild(right);
    btn.addEventListener('click', () => _useMedicalItem(targetPeer, id, srcPack));
    return btn;
  };
  // Reviver's pack
  if (myMeds.length) card.appendChild(sectionTitle('Your pack', myMeds.length));
  else {
    const empty = document.createElement('div');
    Object.assign(empty.style, { color: '#7a6650', fontSize: '11px', fontStyle: 'italic', marginBottom: '6px' });
    empty.textContent = 'Your pack — empty';
    card.appendChild(empty);
  }
  for (const [id, count] of groupCounts(myMeds)) {
    const row = buildRow(id, count, 'self');
    if (row) card.appendChild(row);
  }
  // Downed peer's pack
  if (theirMeds.length) card.appendChild(sectionTitle('Their pack', theirMeds.length));
  else {
    const empty = document.createElement('div');
    Object.assign(empty.style, { color: '#7a6650', fontSize: '11px', fontStyle: 'italic', margin: '6px 0' });
    empty.textContent = 'Their pack — empty';
    card.appendChild(empty);
  }
  for (const [id, count] of groupCounts(theirMeds)) {
    const row = buildRow(id, count, 'down');
    if (row) card.appendChild(row);
  }
  const closeBtn = document.createElement('button');
  Object.assign(closeBtn.style, {
    display: 'block', width: '100%', marginTop: '8px', padding: '8px',
    background: 'transparent', border: '1px solid #4a3a2a',
    borderRadius: '3px', color: '#a89070', font: 'inherit',
    cursor: 'pointer', letterSpacing: '1.5px', textTransform: 'uppercase',
    fontSize: '11px',
  });
  closeBtn.textContent = 'Close (Esc)';
  closeBtn.addEventListener('click', _closeMedicalMenu);
  card.appendChild(closeBtn);
  root.appendChild(card);
  root.style.display = 'flex';
}
function _closeMedicalMenu() {
  if (!_medicalMenuOpen) return;
  _medicalMenuOpen = false;
  _medicalMenuTarget = null;
  if (_medicalMenuRoot) _medicalMenuRoot.style.display = 'none';
}
window.addEventListener('keydown', (e) => {
  if (_medicalMenuOpen && (e.key === 'Escape' || e.code === 'Escape')) {
    _closeMedicalMenu();
    e.preventDefault();
  }
});
function _useMedicalItem(targetPeer, itemId, srcPack) {
  const meta = _MEDICAL_LABELS[itemId];
  if (!meta) { _closeMedicalMenu(); return; }
  const t = getCoopTransport();
  if (srcPack === 'self') {
    // Reviver's pack — consume locally first.
    const found = inventory.findFirstConsumable?.(it => it.id === itemId);
    if (!found) { _closeMedicalMenu(); return; }
    const stack = (found.item.count | 0) || 1;
    if (stack > 1) { found.item.count = stack - 1; inventory._bump?.(); }
    else inventory.takeFromBackpack(found.idx);
    inventoryUI.render();
  }
  try { sfx.uiAccept?.(); } catch (_) {}
  // Apply the effect. Tourniquet is a bleedout extender; everything
  // else is an instant revive at the item's hpPct.
  if (meta.kind === 'tourniquet') {
    const fullBleedout = tunables.coop?.reviveBleedoutSec ?? 300;
    transientHudMsg('TOURNIQUET — bleedout reset', 2.5);
    if (t.isHost) {
      const st = _coopPeerDowned.get(targetPeer);
      if (st) st.bleedoutT = fullBleedout;
      t.send('rpc-downed', { p: targetPeer, b: fullBleedout, meds: st?.meds || [] });
      if (t.peerId === targetPeer) _localBleedoutT = fullBleedout;
    } else {
      t.send('rpc-revive-item', { t: targetPeer, k: 'tourniquet', src: srcPack });
    }
  } else {
    transientHudMsg(`${meta.label} — revive`, 2.5);
    if (t.isHost) {
      // Host self-pack consumption already applied above. For 'down'
      // pack, host strips the item from the downed peer's snapshot
      // meds list (the actual local inventory is on the downed peer's
      // client; they'll consume on their side via the revived flow).
      if (srcPack === 'down') {
        const st = _coopPeerDowned.get(targetPeer);
        if (st && Array.isArray(st.meds)) {
          const i = st.meds.indexOf(itemId);
          if (i >= 0) st.meds.splice(i, 1);
        }
        // Tell the downed peer to consume the item from their own
        // inventory (they'll reach this branch via rpc-consume-med).
        t.send('rpc-consume-med', { id: itemId }, targetPeer);
      }
      t.send('rpc-revived', { p: targetPeer, hp: meta.hpPct });
      _coopPeerDowned.delete(targetPeer);
      _reviveTargetPeerId = null;
      _reviveHoldT = 0;
    } else {
      t.send('rpc-revive-item', { t: targetPeer, k: meta.kind, src: srcPack, id: itemId });
    }
  }
  _closeMedicalMenu();
}

function _tickDowned(dt) {
  // Local bleedout — applies whether host or joiner. While the
  // reviveT > 0 (teammate is making progress), bleedout pauses; this
  // matches the user's intent that holding interact stops the death
  // clock.
  if (_localDowned) {
    if (!_localReviveActive) {
      _localBleedoutT = Math.max(0, _localBleedoutT - dt);
      if (_localBleedoutT <= 0) {
        // Bleedout expired — true death now. Clear downed flag and
        // pin health to 0 so the death-detection block fires on the
        // next frame. _coopHasLivingTeammate() decides whether the
        // run continues (other peers fight on) or ends (everyone
        // down → playerDead = true via existing path).
        _localDowned = false;
        if (player && player.applyDownedState) player.applyDownedState(false);
        if (player) {
          // Force health to 0; the death-detection block will fire
          // next tick. If a teammate is still up the gate routes
          // back to _enterDownedState (but bleedoutT will be 0 so
          // we'd loop) — clear that gate by using a hard hp=0 +
          // playerDead flag set directly.
          // Simpler: just set playerDead=true here for clean exit.
          // The death overlay will surface via the standard flow.
          playerDead = true;
          try { sfx.death(); } catch (_) {}
          _coopBroadcastSelfDied();
        }
      }
    }
  }
  // Tick remote downed peers. Host is authoritative; joiners just
  // mirror what host broadcasts. We tick locally for visual countdown
  // smoothness — host snapshots correct any drift.
  const t = getCoopTransport();
  const totalHold = tunables.coop?.reviveHoldSec ?? 20;
  const decaySec  = tunables.coop?.reviveDecaySec ?? 12;
  const hpPct     = tunables.coop?.reviveHpPct ?? 0.30;
  for (const [peerId, st] of _coopPeerDowned) {
    if (!st.reviverPeerId) {
      st.bleedoutT = Math.max(0, (st.bleedoutT || 0) - dt);
    }
    // Host: drive the auth revive timer for joiner-initiated revives.
    if (t.isHost && st.reviverPeerId) {
      st.reviveT = Math.min(totalHold, (st.reviveT || 0) + dt);
      // If the entity being revived IS the host (joiner reviving us),
      // mirror the auth state into the local HUD vars so OUR
      // revive bar fills + bleedout pauses (the rpc-revive-progress
      // handler we'd normally use early-returns on host).
      if (t.peerId === peerId) {
        _localReviveT = st.reviveT;
        _localReviveActive = true;
      }
      // Throttle progress broadcast to 5Hz.
      st._sendT = (st._sendT || 0) - dt;
      if (st._sendT <= 0) {
        st._sendT = 0.2;
        t.send('rpc-revive-progress', { p: peerId, t: st.reviveT, a: true });
      }
      if (st.reviveT >= totalHold) {
        t.send('rpc-revived', { p: peerId, hp: hpPct });
        _coopPeerDowned.delete(peerId);
        // Server excludes sender from broadcasts, so the host
        // doesn't receive its own rpc-revived. If the revive target
        // IS the host (joiner just revived us), apply the revive
        // locally here.
        if (t.peerId === peerId && _localDowned) {
          _leaveDownedState(hpPct);
        }
      }
    } else if (t.isHost && (st.reviveT || 0) > 0) {
      // No active reviver — decay the bar.
      st.reviveT = Math.max(0, st.reviveT - dt * (totalHold / Math.max(0.1, decaySec)));
    }
  }
}
// Coop-intent signal — `transport.roomCode` is set the MOMENT the
// user clicks Host or Join in the lobby (inside transport.host() /
// transport.join() before the WebSocket even opens). It's cleared
// only when the user explicitly hits Disconnect. So we use it as a
// "user wants coop right now" flag that defers regenerateLevel
// until the connection is up AND a seed is set. Page-load regen
// + any pre-click Play falls through to the normal single-player
// path (no roomCode → not in coop mode).
// Joiner hit interceptor — gunman.js / melee_enemy.js applyHit calls
// this hook BEFORE running their local damage logic. Returning true
// means "I sent an RPC to the host; don't apply locally". Returning
// false means "host or single-player; apply normally". Lives on window
// so the entity managers can hit it without importing main.js.
if (typeof window !== 'undefined') {
  // Coop body-loot take — fires once per item taken from a synced
  // corpse via lootUI. Sends rpc-body-take to host so the canonical
  // enemy.loot stays in sync; next snapshot reflects to both peers.
  // No-op when not in coop, or when called by the host (host's
  // local splice already moved the canonical state).
  window.__coopOnBodyTake = (netId, idx, item) => {
    const t = getCoopTransport();
    if (!t.isOpen || t.isHost) return;
    t.send('rpc-body-take', { n: netId | 0, i: idx | 0 });
    // Anti-flicker cooldown — defer corpse-loot snapshot apply on
    // this entity for ~200ms so a stale snapshot can't briefly
    // un-take the item before host's RPC reflection arrives.
    let target = null;
    if (gunmen?.gunmen) for (const g of gunmen.gunmen) if (g.netId === netId) { target = g; break; }
    if (!target && melees?.enemies) for (const m of melees.enemies) if (m.netId === netId) { target = m; break; }
    if (target) {
      const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      target._coopBodyLootCooldown = now + 220;
    }
  };

  window.__coopOnEnemyHit = (owner, dmg, zone, hitDir, opts) => {
    const t = getCoopTransport();
    if (!t.isOpen || t.isHost) return false;
    if (!owner || !owner.netId) return false;
    // Visual-only applyHit (driven by snapshot.js for synced enemy
    // deaths) bypasses the RPC forwarding — we WANT the local rig
    // pose / deathT side effects to run on the joiner side.
    if (opts && opts.coopVisualOnly) return false;
    // Send RPC. dir omitted from the wire payload — host doesn't need
    // it for damage calc; knockback would matter but the host is
    // running its own AI anyway and a tiny knockback delta from a
    // distant joiner shot isn't worth a 24-byte packet bump.
    t.send('rpc-shoot', {
      n: owner.netId | 0,
      d: Math.round(dmg) | 0,
      z: zone || 'torso',
      w: opts?.weaponClass,
      sb: !!opts?.shieldBreaker,
    });
    return true;
  };
}

function _ensureCoopLobby() {
  if (coopLobby || !isCoopEnabled()) return null;
  coopLobby = new CoopLobbyUI({ getPlayerName });
  // Ghost mesh root — parented to the scene so peer markers render
  // alongside other world objects. One root, child groups per peer
  // so we can tear them all down at run end without scanning the
  // scene graph.
  coopGhostRoot = new THREE.Group();
  coopGhostRoot.name = 'coop-ghosts';
  scene.add(coopGhostRoot);
  const transport = getCoopTransport();
  // Publish coop-host flag to window so non-imported modules
  // (loot.js, etc.) can branch on it without forming a circular
  // import. Updated on every state change below.
  const _publishHostFlag = () => {
    if (typeof window !== 'undefined') {
      window.__coopIsHost = transport.isOpen && transport.isHost;
    }
  };
  transport.addEventListener('open', _publishHostFlag);
  transport.addEventListener('close', _publishHostFlag);
  transport.addEventListener('host', _publishHostFlag);   // host migration
  // Joiner stash persistence — write our state when the transport
  // drops so a re-join inside the TTL restores it. Also write on
  // pagehide (browser tab close / refresh).
  transport.addEventListener('close', () => { try { _coopSaveJoinerState(); } catch (_) {} });
  transport.addEventListener('host-lost', () => { try { _coopSaveJoinerState(); } catch (_) {} });
  // Clear interp buffer on disconnect so a stale snapshot can't
  // briefly drive the apply path when the next session opens.
  transport.addEventListener('close', () => clearSnapshotBuffer());
  // Peer-out cleanup — strip the disconnected peer's downed entry +
  // overlay so the reviver-detection loop doesn't keep finding a
  // ghost teammate after they've disconnected. Ghost mesh is pruned
  // via the per-frame sweep that compares against coopLobby.ghosts.
  transport.addEventListener('peer-out', (e) => {
    const pid = e?.detail?.peer?.id;
    if (!pid) return;
    if (_coopPeerDowned.has(pid)) {
      _coopPeerDowned.delete(pid);
      try { _coopApplyDownedOverlay(pid, false); } catch (_) {}
    }
    if (_reviveTargetPeerId === pid) {
      _reviveTargetPeerId = null;
      _reviveHoldT = 0;
    }
    if (_medicalMenuOpen && _medicalMenuTarget === pid) {
      try { _closeMedicalMenu(); } catch (_) {}
    }
  });
  transport.addEventListener('host-lost', () => clearSnapshotBuffer());
  // Host re-broadcasts the current seed whenever a peer joins. Without
  // this the joiner has to wait for the host's NEXT regenerateLevel
  // call (next floor extract) before they can sync. Since regen is
  // synchronous and the seed is module-state, this is essentially
  // free.
  transport.addEventListener('peer-in', () => {
    if (!transport.isHost || !_runSeed) return;
    const lv = (level?.index | 0);
    transport.send('level-seed', {
      seed: _runSeed, levelIndex: lv,
      enc: _coopHostEncounterIds.slice(),
    });
    console.log('[coop] re-broadcasting level-seed on peer-in',
      { seed: _runSeed, levelIndex: lv, encounters: _coopHostEncounterIds });
  });
  // Once the WS handshake completes, regenerate the level on the
  // host side if we don't yet have a run seed. This covers the very
  // common UX flow where the player already clicked Play (level
  // built un-seeded) BEFORE opening the lobby and clicking Host;
  // without this, the host's level stays solo-random and the seed
  // never gets generated/broadcast. Also catches the legacy
  // _coopRegenPending case (user clicked Play during the WS
  // handshake race).
  transport.addEventListener('open', () => {
    if (!transport.isHost) return;
    if (_runSeed && !_coopRegenPending) return;   // already seeded, nothing to do
    console.log('[coop] host connected — regenerating to mint + broadcast seed',
      { runSeed: _runSeed, pending: _coopRegenPending });
    try { regenerateLevel(); }
    catch (err) { console.warn('[coop] host-connect regen failed', err); }
  });
  // Joiner-side message handler — apply incoming level-seed messages
  // by setting _runSeed and calling regenerateLevel so the joiner's
  // layout matches the host's. Idempotent: bails when we're the host
  // (we generated the seed) or when the seed is already current.
  transport.addEventListener('msg', (e) => {
    const { kind, body, from } = e.detail;
    if (kind === 'snapshot') {
      // Joiner-only — host's snapshot of authoritative enemy state.
      // Drop older / equal sequence numbers; the network can reorder
      // and we don't want to briefly rewind a dead enemy. The
      // interp buffer renders at T-100ms, blending between two
      // frames straddling that time — smoother than chasing a
      // single moving target at 20Hz.
      if (transport.isHost) return;
      if (!body || (body.seq | 0) <= _coopLatestSeq) return;
      _coopLatestSeq = body.seq | 0;
      _coopPendingSnapshot = body;
      pushSnapshotForInterp(body);
      return;
    }
    if (kind === 'rpc-player-damage') {
      // Joiner-only — host says one of its enemies hit our player.
      // Just apply the damage locally; the host has already done the
      // hit detection (LoS, range, cone) so we trust the call.
      if (transport.isHost || !body) return;
      const dmg = Math.max(0, body.d | 0);
      const type = body.type || 'generic';
      try {
        damagePlayer(dmg, type, { source: 'remote', zone: body.z || 'torso' });
      } catch (err) {
        console.warn('[coop] rpc-player-damage apply failed', err);
      }
      return;
    }
    if (kind === 'rpc-self-down') {
      // Host-only — joiner reports they went down. Server already
      // stamped `from` so we know which peer. Record state + re-
      // broadcast as the host-only kind so every other peer sees it.
      if (!transport.isHost || !body) return;
      const bleedout = +body.b || (tunables.coop?.reviveBleedoutSec ?? 60);
      const meds = Array.isArray(body.meds) ? body.meds.slice() : [];
      _coopPeerDowned.set(from, {
        bleedoutT: bleedout,
        reviveT: 0,
        reviverPeerId: null,
        meds,
      });
      transport.send('rpc-downed', { p: from, b: bleedout, meds });
      return;
    }
    if (kind === 'rpc-downed') {
      // Either side — host or joiner — receives this when a peer
      // goes down. Track the peer's downed state locally so the
      // reviver-detection + HUD render can use it.
      if (!body || !body.p) return;
      _coopPeerDowned.set(body.p, {
        bleedoutT: body.b || 60,
        reviveT: 0,
        reviverPeerId: null,
        meds: Array.isArray(body.meds) ? body.meds.slice() : [],
      });
      // Visual: add a translucent red overlay child to the ghost
      // group so the downed state reads urgent without mutating
      // the shared rig materials (mutating shared mats poisoned
      // every other ally's tint).
      _coopApplyDownedOverlay(body.p, true);
      return;
    }
    if (kind === 'rpc-revive-item') {
      // Host-only: a joiner used a health item on a downed peer.
      // Kind maps to a revive HP fraction via _REVIVE_KIND_TO_HP,
      // OR is the special 'tourniquet' kind which extends bleedout
      // without reviving. body.src is 'self' (reviver's pack —
      // already consumed on their side) or 'down' (downed peer's
      // pack — host tells the downed client to consume via
      // rpc-consume-med).
      if (!transport.isHost || !body || !body.t) return;
      const targetPeer = body.t;
      const itemKind = body.k || 'defib';
      const srcPack = body.src || 'self';
      const itemId = body.id || null;
      const st = _coopPeerDowned.get(targetPeer);
      if (!st || st.bleedoutT <= 0) return;     // not downed / already gone
      if (srcPack === 'down' && itemId && Array.isArray(st.meds)) {
        const i = st.meds.indexOf(itemId);
        if (i >= 0) st.meds.splice(i, 1);
        if (transport.peerId === targetPeer) {
          // Host is the revivee — consume from our own pack locally;
          // can't WS-send to self.
          try {
            const found = inventory.findFirstConsumable?.(it => it.id === itemId);
            if (found) {
              const stack = (found.item.count | 0) || 1;
              if (stack > 1) { found.item.count = stack - 1; inventory._bump?.(); }
              else inventory.takeFromBackpack(found.idx);
              inventoryUI.render();
            }
          } catch (_) {}
        } else {
          transport.send('rpc-consume-med', { id: itemId }, targetPeer);
        }
      }
      if (itemKind === 'tourniquet') {
        const fullBleedout = tunables.coop?.reviveBleedoutSec ?? 300;
        st.bleedoutT = fullBleedout;
        transport.send('rpc-downed', { p: targetPeer, b: fullBleedout, meds: st.meds || [] });
        if (transport.peerId === targetPeer) _localBleedoutT = fullBleedout;
        return;
      }
      const hpPct = _REVIVE_KIND_TO_HP[itemKind] || (tunables.coop?.reviveHpPct ?? 0.30);
      transport.send('rpc-revived', { p: targetPeer, hp: hpPct });
      _coopPeerDowned.delete(targetPeer);
      // If WE are the host AND we are the revivee (joiner used an
      // item on us), trigger our own _leaveDownedState since the
      // server excludes the sender from the broadcast we just sent.
      if (transport.peerId === targetPeer) {
        try { _leaveDownedState(hpPct); } catch (_) {}
      }
      return;
    }
    if (kind === 'rpc-consume-med') {
      // Receiver-only — host tells us to consume a medical item from
      // our own pack (because the reviver picked it from our pack).
      // No-op if we don't have it; the host has already booked the
      // effect on their side.
      if (!body || !body.id) return;
      try {
        const found = inventory.findFirstConsumable?.(it => it.id === body.id);
        if (found) {
          const stack = (found.item.count | 0) || 1;
          if (stack > 1) { found.item.count = stack - 1; inventory._bump?.(); }
          else inventory.takeFromBackpack(found.idx);
          inventoryUI.render();
        }
      } catch (e) { console.warn('[coop] rpc-consume-med apply failed', e); }
      return;
    }
    if (kind === 'rpc-revive-hold') {
      // Host-only — joiner is holding interact on a downed peer.
      // Body: { t: targetPeerId, h: bool }. Track per-target state.
      if (!transport.isHost || !body) return;
      const targetPid = body.t;
      const st = _coopPeerDowned.get(targetPid);
      if (!st) return;
      if (body.h) {
        st.reviverPeerId = from;
      } else if (st.reviverPeerId === from) {
        st.reviverPeerId = null;
      }
      return;
    }
    if (kind === 'rpc-peer-died') {
      // A peer's player truly died (post-bleedout or solo). Leave a
      // static rig at their position as a corpse marker — frozen in
      // the last pose, gun + reload dot hidden, slumped slightly.
      // The per-frame ghost sync respects ghost.dead and skips anim
      // ticks + position lerps so the corpse stays put.
      if (!body || !body.p) return;
      _coopPeerDowned.delete(body.p);
      _coopApplyDownedOverlay(body.p, false);
      const ghost = coopLobby?.ghosts?.get(body.p);
      if (ghost) ghost.dead = true;
      const m = _coopGhostMeshes.get(body.p);
      if (m) {
        if (m.gunMesh) m.gunMesh.visible = false;
        if (m.reloadDot) m.reloadDot.visible = false;
        // Slump the body slightly so it reads as a corpse vs a
        // standing teammate. Tilt forward + drop hips a touch.
        if (m.group) {
          m.group.rotation.x = -0.45;
          m.group.position.y = -0.25;
        }
      }
      const name = ghost?.name || 'Player';
      try { transientHudMsg(`${name} has died`, 4.0); } catch (_) {}
      return;
    }
    if (kind === 'rpc-revived') {
      // Either side — peer was revived. Update local state.
      if (!body || !body.p) return;
      _coopPeerDowned.delete(body.p);
      // If WE are the revived peer, clear local downed state.
      if (transport.peerId === body.p) {
        _leaveDownedState(body.hp || 0.30);
      }
      // Strip the downed overlay child; rig materials stay untouched.
      _coopApplyDownedOverlay(body.p, false);
      return;
    }
    if (kind === 'rpc-revive-progress') {
      // Joiner — host is broadcasting revive progress for a peer
      // (5Hz). If we're the revivee, our HUD bar should reflect it.
      if (transport.isHost || !body || !body.p) return;
      if (transport.peerId === body.p) {
        _localReviveT = +body.t || 0;
        _localReviveActive = !!body.a;
      } else {
        const st = _coopPeerDowned.get(body.p);
        if (st) st.reviveT = +body.t || 0;
      }
      return;
    }
    if (kind === 'fx-tracer') {
      // Joiner-only — host's enemy fired and broadcast a tracer.
      // Reuse combat.spawnShot so visuals match the local muzzle
      // flash + tracer pipeline. No-op on host (host already
      // rendered the tracer via aiFire's local call).
      if (transport.isHost || !body) return;
      try {
        const fp = new THREE.Vector3(body.x1 || 0, body.y1 || 1, body.z1 || 0);
        const tp = new THREE.Vector3(body.x2 || 0, body.y2 || 1, body.z2 || 0);
        combat.spawnShot(fp, tp, body.c | 0, { light: false });
      } catch (_) { /* defensive: never break a frame on a tracer */ }
      return;
    }
    if (kind === 'fx-ring') {
      // Joiner-only — host's hazard telegraph (artillery shell, aoe
      // warning). Spawn a transient ring at ground level that fades
      // over `l` seconds. Cheap one-shot; cleaned up via setTimeout.
      if (transport.isHost || !body) return;
      try {
        const r = +body.r || 1.0;
        const life = +body.l || 1.2;
        const color = (body.c | 0) || 0xff4040;
        const ringGeom = new THREE.RingGeometry(Math.max(0.05, r - 0.15), r, 28);
        const ringMat = new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.7,
          depthWrite: false, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(+body.x || 0, 0.05, +body.z || 0);
        scene.add(ring);
        const startT = performance.now();
        const tick = () => {
          const t = (performance.now() - startT) / 1000;
          if (t >= life) {
            scene.remove(ring);
            ringGeom.dispose();
            ringMat.dispose();
            return;
          }
          // Pulse + ramp opacity to peak near explosion frame.
          const k = t / life;
          const pulse = 0.4 + 0.5 * Math.abs(Math.sin(t * (8 + 4 * k)));
          ringMat.opacity = (0.5 + 0.5 * k) * pulse;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch (_) {}
      return;
    }
    if (kind === 'rpc-throwable') {
      // Host-only: a joiner threw a grenade. Spawn the authoritative
      // projectile so the explosion damage actually lands on host's
      // enemies, then broadcast fx-throwable to other joiners (server
      // excludes the original sender so they don't see a duplicate).
      if (!transport.isHost || !body) return;
      try {
        const opts = {
          pos: new THREE.Vector3(+body.px || 0, +body.py || 1, +body.pz || 0),
          vel: new THREE.Vector3(+body.vx || 0, +body.vy || 0, +body.vz || 0),
          type: 'grenade',
          lifetime: +body.lt || 2.0,
          radius: +body.r || 0.07,
          color: (body.c | 0) || 0xb04030,
          explosion: {
            radius: +body.er || 3.5,
            damage: +body.ed || 0,
            shake: +body.es || 0.35,
          },
          owner: 'player',                  // joiner-as-player damage rules
          gravity: +body.g || 9.8,
          bounciness: +body.b || 0,
          fuseAfterLand: !!body.fl,
          throwKind: body.tk || 'frag',
          fireDuration:   +body.fd || undefined,
          fireTickDps:    +body.ft || undefined,
          gasDuration:    +body.gd || undefined,
          blindDuration:  +body.bd || undefined,
          stunDuration:   +body.sd || undefined,
          triggerRadius:  +body.tr || undefined,
          triggerConeDeg: +body.tc || undefined,
          throwDirX: +body.dx || 0,
          throwDirZ: +body.dz || 0,
          // Stamp the claimer onto the projectile so the explosion
          // path can attribute credit / xp / skill points back to
          // the joiner who threw it.
          _coopClaimer: from,
        };
        projectiles.spawn(opts);
        // Mirror to other joiners (server excludes the sender from
        // the broadcast fanout, so the original thrower doesn't see
        // a duplicate visual).
        transport.send('fx-throwable', body);
      } catch (e) { console.warn('[coop] rpc-throwable apply failed', e); }
      return;
    }
    if (kind === 'fx-throwable') {
      // A peer threw a grenade / molotov / etc. Spawn a visual-only
      // projectile so we see the arc + explosion + lingering zone
      // (gas / smoke / fire pool). Damage zeroed — owner='remote'
      // gates spawnGasZone / spawnMolotovShatter to skip the DoT tick
      // on local snapshot enemies. Host's auth handles real damage.
      if (!body || from === transport.peerId) return;
      try {
        projectiles.spawn({
          pos: new THREE.Vector3(+body.px || 0, +body.py || 1, +body.pz || 0),
          vel: new THREE.Vector3(+body.vx || 0, +body.vy || 0, +body.vz || 0),
          type: 'grenade',
          lifetime: +body.lt || 2.0,
          radius: +body.r || 0.07,
          color: (body.c | 0) || 0xb04030,
          explosion: {
            radius: +body.er || 3.5,
            damage: 0,                      // visual mirror — no damage
            shake: +body.es || 0.35,
          },
          owner: 'remote',
          gravity: +body.g || 9.8,
          bounciness: +body.b || 0,
          fuseAfterLand: !!body.fl,
          throwKind: body.tk || 'frag',
          // Lingering visual zones so molotov fire pools, gas clouds,
          // and smoke disks show up for non-thrower peers. Damage is
          // gated on owner === 'remote' inside the zone spawners.
          fireDuration:  +body.fd  || undefined,
          fireTickDps:   0,
          gasDuration:   +body.gd  || undefined,
          smokeDuration: +body.smd || undefined,
        });
      } catch (e) { console.warn('[coop] fx-throwable apply failed', e); }
      return;
    }
    if (kind === 'fx-tracer-self') {
      // Anyone (host or joiner) — a teammate fired their own gun.
      // Spawn the same tracer + muzzle flash locally so we see them
      // shooting. Skip if the sender is US (server already excludes
      // sender from broadcasts but defense in depth never hurts).
      if (!body || from === transport.peerId) return;
      try {
        const fp = new THREE.Vector3(body.x1 || 0, body.y1 || 1, body.z1 || 0);
        const tp = new THREE.Vector3(body.x2 || 0, body.y2 || 1, body.z2 || 0);
        combat.spawnShot(fp, tp, body.c | 0xffd040, { light: false, flash: true });
      } catch (_) {}
      return;
    }
    if (kind === 'rpc-grant-rewards') {
      // Joiner-only — host attributed a kill we caused and is sending
      // the bundled rewards. Apply credits + skill points + kill +
      // contract archetype locally so OUR run stats / wallet / skill
      // ladder advance, not the host's.
      if (transport.isHost || !body) return;
      try {
        const c = body.c | 0;
        const sp = body.sp | 0;
        const arch = body.a || null;
        if (c > 0) { playerCredits += c; runStats.addCredits(c); }
        if (sp > 0) {
          playerSkillPoints += sp;
          _showSkillPointToast(sp);
        }
        if (body.k) runStats.addKill();
        if (arch) {
          runStats.noteArchetypeKill(arch);
          _applyContractPerKillReward(arch);
        }
        _refreshSkillPointPip();
        // Coin burst at the kill position (host included it in the
        // payload). Falls back to the local player if the host's
        // client didn't include coords — better than no VFX.
        if (c > 0) {
          const cx = (typeof body.x === 'number') ? body.x : (player?.mesh?.position?.x ?? 0);
          const cz = (typeof body.z === 'number') ? body.z : (player?.mesh?.position?.z ?? 0);
          try { spawnKillCoins({ x: cx, y: 1.0, z: cz }, c); } catch (_) {}
        }
      } catch (e) { console.warn('[coop] rpc-grant-rewards apply failed', e); }
      return;
    }
    if (kind === 'rpc-grant-xp') {
      // Joiner-only — host attributed a kill to us and is sending
      // the XP value. Run awardXp locally so OUR playerXp /
      // playerLevel ladder advances. Triggers the level-up banner
      // if the threshold crosses.
      if (transport.isHost || !body) return;
      const amount = body.amount | 0;
      if (amount <= 0) return;
      try { awardXp(amount); }
      catch (err) { console.warn('[coop] rpc-grant-xp apply failed', err); }
      return;
    }
    if (kind === 'rpc-body-take') {
      // Host-only — joiner took an item from a synced corpse.
      // Splice it from the authoritative enemy.loot and mark looted
      // when empty. Validate distance to prevent stale/spoofed
      // takes after a body has migrated.
      if (!transport.isHost || !body) return;
      const netId = body.n | 0;
      const idx = body.i | 0;
      let target = null;
      for (const g of (gunmen?.gunmen || [])) {
        if (g.netId === netId && !g.alive) { target = g; break; }
      }
      if (!target) {
        for (const m of (melees?.enemies || [])) {
          if (m.netId === netId && !m.alive) { target = m; break; }
        }
      }
      if (!target || !Array.isArray(target.loot)) return;
      if (idx < 0 || idx >= target.loot.length) return;
      target.loot.splice(idx, 1);
      if (target.loot.length === 0) target.looted = true;
      return;
    }
    if (kind === 'rpc-drop') {
      // Host-only — joiner is dropping an item from their inventory.
      // Spawn into host's authoritative loot list as SHARED loot
      // (claimedBy = null) so both players can see it on the ground
      // and either can pick it back up. Matches host's own drop
      // behavior — drops are intentionally shared as a "pass to
      // teammate" channel; instanced is reserved for kill drops.
      if (!transport.isHost || !body || !body.item) return;
      try {
        loot.spawnItem(
          { x: +body.x || 0, y: 0.4, z: +body.z || 0 },
          body.item,
          { claimedBy: null },
        );
      } catch (err) {
        console.warn('[coop] rpc-drop spawn failed', err);
      }
      return;
    }
    if (kind === 'rpc-pickup') {
      // Host-only — joiner walked over a synced loot item and is
      // asking to claim it. Validate distance, remove from host's
      // loot list, and send rpc-grant-item with the full item data
      // so the joiner can add it to their inventory. The next
      // snapshot tick mirrors the missing entry to the joiner so
      // their local visual cube despawns.
      if (!transport.isHost || !body) return;
      const netId = body.n | 0;
      let entry = null;
      if (loot?.items) {
        for (const e of loot.items) { if (e.netId === netId) { entry = e; break; } }
      }
      if (!entry) return;
      // Ownership check — instanced loot. claimedBy=null means shared
      // (anyone can take). claimedBy=peerId means only that peer
      // can claim. Anything else is rejected.
      if (entry.claimedBy != null && entry.claimedBy !== from) {
        console.log('[coop] rpc-pickup rejected — wrong owner', { netId, claimedBy: entry.claimedBy, from });
        return;
      }
      // Distance check — the joiner's last broadcast pos lives in
      // coopLobby.ghosts. Reject pickups farther than the radius
      // a fairly lenient slop (network jitter + client-side lerp).
      const ghost = coopLobby?.ghosts?.get(from);
      if (ghost) {
        const dx = ghost.x - entry.group.position.x;
        const dz = ghost.z - entry.group.position.z;
        const r = (tunables.loot?.pickupRadius || 2.0) + 1.0;
        if (dx * dx + dz * dz > r * r) {
          console.log('[coop] rpc-pickup rejected — joiner too far', { netId, dist: Math.hypot(dx, dz) });
          return;
        }
      }
      // Grant the item BEFORE removing locally so a transport-send
      // failure doesn't lose the item permanently for both sides.
      transport.send('rpc-grant-item', {
        n: netId,
        item: entry.item,
      }, from);
      try { loot.remove(entry); } catch (_) {}
      return;
    }
    if (kind === 'rpc-grant-item') {
      // Joiner-only — host approved a pickup we asked for. Apply the
      // item to local inventory. Visual cleanup happens via the
      // snapshot mirror once the host removes the entry from its loot
      // list.
      if (transport.isHost || !body || !body.item) return;
      const incomingItem = body.item;
      try {
        if (_tryAcquireRelic && _tryAcquireRelic(incomingItem)) {
          sfx?.pickup?.();
          inventoryUI?.render?.();
          return;
        }
        const result = inventory.add(incomingItem);
        if (result?.placed) {
          sfx?.pickup?.();
          if (result.slot === 'primary' || result.slot === 'melee') onInventoryChanged();
          recomputeStats();
          inventoryUI?.render?.();
        }
      } catch (err) {
        console.warn('[coop] rpc-grant-item apply failed', err);
      }
      return;
    }
    if (kind === 'rpc-shoot') {
      // Host-only — joiner shot a synced enemy and is asking us to
      // apply damage authoritatively. Find the entity by netId and
      // route through the standard applyHit pipeline. The next 20Hz
      // snapshot will mirror the new HP / alive flag back to the
      // joiner. Skip silently if we're not host or the entity is gone
      // (already dead, or netId doesn't resolve).
      if (!transport.isHost || !body) return;
      // Megaboss hit — joiner sets `mb:1` because megabosses aren't
      // tracked by netId. Apply directly to host's megaBoss instance
      // so HP comes down on the auth side; snapshot reflects.
      if (body.mb) {
        if (megaBoss && megaBoss.alive && typeof megaBoss.applyHit === 'function') {
          const dmg = Math.max(0, body.d | 0);
          const wasAlive = megaBoss.alive;
          try { megaBoss.applyHit(dmg); } catch (e) { console.warn('[coop] megaboss applyHit failed', e); }
          if (wasAlive && !megaBoss.alive) {
            // Megaboss death triggers via its own _die path on host;
            // joiner sees it via subsequent snapshot returning null.
          }
        }
        return;
      }
      const netId = body.n | 0;
      let target = null;
      if (gunmen?.gunmen) {
        for (const g of gunmen.gunmen) { if (g.netId === netId) { target = g; break; } }
      }
      if (!target && melees?.enemies) {
        for (const m of melees.enemies) { if (m.netId === netId) { target = m; break; } }
      }
      if (target && target.alive && target.manager) {
        const dmg = Math.max(0, body.d | 0);
        const zone = body.z || 'torso';
        // Force-aggro the target so joiner shots actually wake the
        // AI. The local bullet path on host triggers this naturally
        // via canSee + alertEnemiesFromShot; the RPC path doesn't
        // see the joiner's position as a "player to spot," so
        // suspicion never crests on its own.
        try {
          target.suspicion = 1.2;
          if (target.state === 'idle' || target.state === 'IDLE'
              || target.state === 'sleep' || target.state === 'SLEEP') {
            // gunman.js / melee_enemy.js use string state values via
            // the STATE constant; setting a sensible alerted name is
            // safe — the per-enemy AI tick will read it next frame.
            target.state = (target.kind === 'melee') ? 'chase' : 'alerted';
            target.reactionT = 0.18;
          }
          if (target.huntsPlayer && !target.huntActive) target.huntActive = true;
          // Propagate to nearby allies so a single joiner sniper
          // shot doesn't have to one-tap each grunt independently.
          try { propagateAggro(target); } catch (_) {}
        } catch (_) { /* defensive: never crash on aggro flagging */ }
        // Set the implicit claimedBy thread-local so any loot spawned
        // during the death chain (disarm drops, body loot, mirror
        // clone reward) inherits this joiner as the owner —
        // instanced loot. Always restore in finally so a thrown
        // applyHit can't leak ownership into subsequent host-local
        // spawns.
        const _prevClaimer = (typeof window !== 'undefined') ? window.__coopCurrentClaimer : null;
        const wasAlive = target.alive;
        let result = null;
        try {
          if (typeof window !== 'undefined') window.__coopCurrentClaimer = from;
          result = target.manager.applyHit(target, dmg, zone, null,
            { weaponClass: body.w || 'rpc', shieldBreaker: !!body.sb });
          // Fire the local kill pipeline if this hit dropped the
          // enemy. Without this, joiner kills never generated body
          // loot or attribution side effects (XP / credits go to
          // host, but loot would be missing entirely on host's end
          // and the joiner would never see the drop snapshot).
          if (wasAlive && !target.alive) {
            try { onEnemyKilled(target); }
            catch (e) { console.warn('[coop] rpc-shoot onEnemyKilled failed', e); }
          }
          // Ground-drop disarm path mirrors the host's bullet-hit
          // logic at line ~6920 — drops on the death frame become
          // ground items. Same claimedBy thread-local applies.
          if (result?.drops) {
            for (const drop of result.drops) {
              try {
                if (drop.weapon) loot.spawnItem(drop.position, wrapWeapon(drop.weapon));
                else if (drop.item) loot.spawnItem(drop.position, drop.item);
              } catch (_) {}
            }
          }
        } catch (err) {
          console.warn('[coop] rpc-shoot apply failed', err);
        } finally {
          if (typeof window !== 'undefined') window.__coopCurrentClaimer = _prevClaimer;
        }
      }
      return;
    }
    if (kind !== 'level-seed' || !body) return;
    if (transport.isHost) {
      console.log('[coop] ignoring level-seed (we are host)', body);
      return;
    }
    const incomingSeed = body.seed >>> 0;
    const incomingLv = body.levelIndex | 0;
    if (!incomingSeed) return;
    const needsRegen = _coopRegenPending
      || (_runSeed !== incomingSeed)
      || ((level?.index | 0) !== incomingLv);
    console.log('[coop] level-seed received', {
      from, seed: incomingSeed, levelIndex: incomingLv,
      needsRegen, pending: _coopRegenPending,
      currentSeed: _runSeed, currentLv: level?.index | 0,
    });
    _runSeed = incomingSeed;
    // Stash the host's chosen encounter ids so _coopPickEncounter
    // pops them in order during the joiner's regen. Resetting the
    // queue here (vs preserving across messages) means a duplicate
    // level-seed broadcast doesn't double-stack the queue.
    _coopForcedEncounterQueue = Array.isArray(body.enc) ? body.enc.slice() : [];
    if (needsRegen && level) {
      // Drop-in mid-run — joiner connected from the menu without
      // having clicked Play first. Auto-start a default run so they
      // have a starter loadout (pistol class) and dismiss the menu.
      // Without this, the level regenerates behind the menu and the
      // player has no equipment, no spawn, and the menu is still up.
      const dropInMidRun = mainMenuUI?.visible;
      if (dropInMidRun) {
        try {
          startNewRun('pistol');
          mainMenuUI.hide();
          // Try restoring a stashed joiner state (re-join inside TTL)
          // before falling back to the JOINED MID-RUN toast. The
          // restore overrides the starter loadout we just minted.
          if (!_coopRestoreJoinerState()) {
            transientHudMsg('JOINED MID-RUN', 3.0);
          }
        } catch (e) {
          console.warn('[coop] drop-in startNewRun failed', e);
        }
      }
      // Force the next regenerate to land on incomingLv. level.generate()
      // bumps index by 1 internally, so we set to one below.
      const wasMidRun = (level.index | 0) > 0;
      const isFloorAdvance = wasMidRun && incomingLv > (level.index | 0);
      level.index = incomingLv - 1;
      try {
        regenerateLevel();
        console.log('[coop] regenerated to seed=', incomingSeed, 'lv=', level.index | 0);
      } catch (err) {
        console.warn('[coop] regen on level-seed failed', err);
      }
      // Coop: joiner gets a per-floor skill pick on every floor
      // advance, matching the host's advanceFloor flow. Routed
      // through the deferred-pick queue so the world keeps ticking
      // (coop never pauses for picks) — the gold HUD pill surfaces
      // and the joiner spends when they're ready. Drop-in counts:
      // the host is on floor N, the joiner just landed on floor N
      // and gets the same N picks the host has accumulated (capped
      // at 5 to avoid an absurd queue on a deep mid-run join).
      if (isFloorAdvance) {
        _pendingLevelUpPicks += 1;
        try { _refreshPickQueueHud(); } catch (_) {}
      } else if (dropInMidRun && incomingLv > 0) {
        _pendingLevelUpPicks += Math.min(5, incomingLv);
        try { _refreshPickQueueHud(); } catch (_) {}
      }
    }
  });
  return coopLobby;
}
// Browser tab close / refresh — flush any pending joiner stash to
// localStorage. pagehide fires reliably on tab close (more so than
// beforeunload). Idempotent + no-op on host.
window.addEventListener('pagehide', () => {
  try { _coopSaveJoinerState(); } catch (_) {}
});
// F4 — toggle the lil-gui dev/multiplier panel without flipping the
// persisted setting. Quick hide for screenshots / playtest cleanliness.
window.addEventListener('keydown', (e) => {
  if (e.key === 'F4' || e.code === 'F4') {
    if (debugGui?.domElement) {
      const cur = debugGui.domElement.style.display;
      const next = cur === 'none' ? '' : 'none';
      setDebugPanelVisible(debugGui, next !== 'none');
    }
    e.preventDefault();
  }
});
window.addEventListener('keydown', (e) => {
  // Shift+C — toggle coop lobby. Cheap to gate on isCoopEnabled
  // because most players don't have the flag on; the listener stays
  // attached but never builds the DOM.
  if (e.shiftKey && (e.key === 'C' || e.key === 'c')) {
    if (!isCoopEnabled()) return;
    const lobby = _ensureCoopLobby();
    if (!lobby) return;
    if (lobby.isOpen()) lobby.hide();
    else lobby.show();
  }
  // K — spend the next queued level-up / mastery pick. Surfaces the
  // banner-deferred picker on demand; player chooses a safe moment.
  if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'K' || e.key === 'k')) {
    // Skip if a text input is focused (don't steal typing keys).
    const focused = document.activeElement;
    if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) return;
    if (_pendingLevelUpPicks > 0 || _pendingMasteryPicks.length > 0) {
      _openNextDeferredPick();
    }
  }
});
// Auto-open on first load if URL carries ?coop=1 — players following
// a shared invite URL land in the lobby instead of the main menu.
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get('coop') === '1') {
    setTimeout(() => {
      const lobby = _ensureCoopLobby();
      if (lobby) lobby.show();
    }, 200);
  }
} catch (_) {}

const mainMenuUI = new MainMenuUI({
  onPlay: () => {
    const { slots, rarityTier } = getStartingStoreState();
    const offers = rollStoreOffers(slots, rarityTier);
    input.clearMouseState();
    storeRollUI.show(offers, { slots, tier: rarityTier });
  },
  onQuickStart: () => {
    // Opens the classic class picker — bypasses the rolled-store
    // flow. Player picks a class; startUI.onPick handler boots a run
    // with that class's basic loadout.
    input.clearMouseState();
    startUI.show();
  },
  onOpenStore: () => { mainMenuUI.hide(); storeUpgradeUI.show(); },
  onTutorial: () => {
    // Tutorial mode — pistol-class run on a single fixed practice
    // room. Defensive shutdown of every other modal first because
    // the menu button-click can leave a stale focused element or
    // an open inventory/shop UI that would gate the gameplay tick
    // (see the `paused || inventoryUI.visible || ...` early-return
    // in tick()).
    input.clearMouseState();
    if (inventoryUI.visible) inventoryUI.hide();
    if (lootUI.isOpen()) lootUI.hide();
    if (shopUI.isOpen()) shopUI.hide();
    if (customizeUI.isOpen()) customizeUI.hide();
    if (perkUI.isOpen()) perkUI.toggle?.();
    if (gameMenuUI.isOpen()) gameMenuUI.hide();
    if (storeRollUI.isOpen?.()) storeRollUI.hide();
    if (storeUpgradeUI.isOpen?.()) storeUpgradeUI.hide();
    // Drop input focus from the codename text field so the
    // typing-suppression branch in input.js _onKeyDown stops eating
    // WASD presses.
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    tutorialMode = true;
    _tutorialStealthT = 0;
    tutorialUI.reset();
    tutorialUI.show();
    resetHints();
    startNewRun('pistol');
    currentWeaponIndex = 0;
    level.index = 0;
    runStats.reset();
    shrineHpBonus = 0;
    pendingShopRerolls = 0;
    giftSacrificeHp = 0;
    playerDead = false;
    if (deathRootEl) deathRootEl.style.display = 'none';
    recomputeStats();
    player.applyDerivedStats(derivedStats);
    player.restoreFullHealth();
    regenerateLevel();
    sfx.ambientStart();
    _currentMusicTrack = 'run'; sfx.musicPlay?.('run');
  },
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
  getMusicEnabled,
  setMusicEnabled: (on) => {
    setMusicEnabled(on);
    setAudioMusicEnabled(on);
    if (on) {
      // Resume the ambient track for the current context.
      try { sfx.musicPlay(_currentMusicTrack || 'menu'); } catch (_) {}
    } else {
      try { sfx.musicStop(); } catch (_) {}
    }
  },
  getPlayerName,
  setPlayerName,
  getCharacterStyle,
  setCharacterStyle: (v) => {
    setCharacterStyle(v);
    player.applyCharacterStyle?.(v);
  },
  onOpenHideout: () => {
    mainMenuUI.hide();
    hideoutUI.open();
  },
});

// Hideout — between-runs panel. Opens from the main menu's Hideout
// button, on death (replaces the default "back to main menu" screen),
// and from the cash-out path. ctx hooks bridge chip read/write to
// the existing persistent-chip plumbing and a quartermaster-roller
// to the existing weapon-rarity pipeline.
const hideoutUI = new HideoutUI({
  awardChips: (n) => awardPersistentChips(n),
  spendChips: (n) => {
    if (persistentChips < n) return false;
    persistentChips -= n;
    savePersistentChips();
    return true;
  },
  // Hideout audio bridge — lets the panel stop the in-run bed when
  // the player opens the menu, so the 45Hz drone doesn't leak.
  // Also swaps to menu music while in the hideout.
  stopAmbient: () => {
    sfx.ambientStop?.();
    _currentMusicTrack = 'menu'; sfx.musicPlay?.('menu');
  },
  // Renderer share — diegetic hideout scene reuses the game's
  // WebGLRenderer so we don't spin up a second GL context. main.js
  // tick swaps which scene is being rendered based on hideoutUI.visible.
  getRenderer: () => renderer,
  // Toast bridge — armory tile + mission-prep tile call this when the
  // player chip-buys a weapon unlock. Surfaces the unlock through the
  // existing in-game HUD pipeline so the menu and run share one feel.
  notifyUnlock: (weaponName) => {
    if (!weaponName) return;
    transientHudMsg(`UNLOCKED: ${String(weaponName).toUpperCase()}`, 2.5);
    sfx.uiAccept?.();
  },
  // Leaderboard accessor — hideout's contractor leaderboard block
  // + full-screen leaderboards step read top entries via this.
  getLeaderboard: () => Leaderboard,
  applyCharacterStyle: (v) => {
    // Pushes the silhouette change to the live rig so the change is
    // visible the moment the player closes the hideout, not just on
    // the next fresh run.
    player.applyCharacterStyle?.(v);
  },
  // Color + accessory applier — pushes appearance changes to the rig
  // if it supports them. Falls back silently if the rig method isn't
  // present (color hookup is a follow-up rig change). Prefs are still
  // saved either way so the next run start can read them.
  applyCharacterAppearance: (appearance) => {
    if (player?.applyCharacterAppearance) {
      player.applyCharacterAppearance(appearance);
    }
  },
  rollQuartermasterItem: (tier) => {
    // Tier 0 → common; 4 → legendary floor. Mirrors the rolled-store
    // pipeline. Pull a non-mythic weapon at the requested rarity.
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
    const rarity = rarities[Math.max(0, Math.min(rarities.length - 1, tier | 0))];
    // Exclude artifact weapons (Jessica's Rage) so the Quartermaster
    // never offers the apex pistol — its only acquisition path is the
    // bear's 4-toy trade. `worldDrop !== false` covers any future
    // weapons explicitly tagged as non-droppable.
    const pool = tunables.weapons.filter(w =>
      w.rarity !== 'mythic' && !w.artifact && w.worldDrop !== false);
    const candidates = pool.filter(w => (w.rarity || 'common') === rarity);
    const pick = (candidates.length ? candidates : pool)[Math.floor(Math.random() * (candidates.length ? candidates.length : pool.length))];
    if (!pick) return null;
    return wrapWeapon({ ...pick, rarity });
  },
  onClose: () => {
    // Hideout's "Start Run" / "Confirm Loadout" — the player has
    // already chosen a contract + weapon in the mission-prep screen,
    // so launch directly into gameplay with that loadout. Skip the
    // legacy rolled-store + class-picker flow entirely.
    mainMenuUI.hide();
    const selectedName = getSelectedStarterWeapon();
    const def = selectedName
      ? tunables.weapons.find(w => w.name === selectedName)
      : null;
    if (def) {
      input.clearMouseState();
      startRunWithWeaponDef({ ...def, rarity: 'common' });
    } else if (mainMenuUI.onPlay) {
      // Fallback — no weapon selected somehow; route through the
      // legacy picker so the player isn't stranded.
      mainMenuUI.onPlay();
    }
  },
  onExitToTitle: () => {
    // Back button — return to the main menu without starting a run.
    mainMenuUI.show();
  },
  onQuickStart: () => {
    // Quick Start — skips the class picker, re-uses last-played
    // class. Falls back to onPlay (class picker) if no quickstart
    // hook exists.
    mainMenuUI.hide();
    if (mainMenuUI.onQuickStart) mainMenuUI.onQuickStart();
    else if (mainMenuUI.onPlay) mainMenuUI.onPlay();
  },
  // Title-modal hooks — Tutorial / Leaderboard / Options live behind
  // the legacy MainMenuUI which we now surface as a side-modal from
  // the hideout header. The hideout stays visible in the background.
  onOpenSettings: () => {
    if (mainMenuUI?.show) {
      mainMenuUI.show();
      mainMenuUI.view = 'settings';
      mainMenuUI.render?.();
    }
  },
  onOpenLeaderboard: () => {
    if (mainMenuUI?.show) {
      mainMenuUI.show();
      mainMenuUI.view = 'leaderboard';
      mainMenuUI.render?.();
    }
  },
  onOpenTutorial: () => {
    mainMenuUI.hide();
    if (mainMenuUI.onTutorial) mainMenuUI.onTutorial();
  },
});

// Mastery offers queued when class XP crosses a threshold. Each entry is
// { classId, options:[nodeRef,...] } and gets resolved by the picker modal.
const pendingMasteryOffers = [];

function awardClassXp(weaponClass, enemyTier, enemy) {
  if (!weaponClass) return;
  if (enemy && enemy.noXp) return;
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
  if (w) { player.setWeapon(w); setCursorForWeapon(w); }
  player.cancelCombo();
  playerFireCooldown = 0;
  playerBurstRemaining = 0;
  playerBurstTimer = 0;
  // Equip-time stat re-roll — needed for weapons that ship with
  // `equipMods` (e.g. Pain mace's 66% lifesteal + 0.5× max HP).
  // Cheap; recomputeStats already runs on inventory close + many
  // other paths. Without this, swapping to/from Pain wouldn't
  // update max HP until the next inventory close.
  recomputeStats();
  if (typeof renderWeaponBar === 'function') renderWeaponBar();
}
function onInventoryChanged() {
  const rotation = getRotation();
  if (rotation.length === 0) { currentWeaponIndex = 0; recomputeStats(); return; }
  if (currentWeaponIndex >= rotation.length) currentWeaponIndex = 0;
  const w = currentWeapon();
  if (w) { player.setWeapon(w); setCursorForWeapon(w); }
  // Inventory mutations can drop the equipped weapon out of the
  // rotation entirely (e.g. dropping Pain). Without a recompute the
  // last weapon's `equipMods` (Pain's −50% max HP) would persist.
  recomputeStats();
  // Akimbo eligibility may have just changed (player picked up /
  // dropped / swapped a slot weapon). Re-sync the off-hand visual.
  _syncAkimboVisuals();
}

// Shared drag-state so both InventoryUI and CustomizeUI can see what's being
// dragged across their DOM trees.
let uiDragState = null;
const getDragState = () => uiDragState;
const setDragState = (s) => { uiDragState = s; };

const customizeUI = new CustomizeUI({
  inventory,
  getDragState, setDragState,
  onClose: () => {
    inventoryUI.render();
    // Sight may have changed via the customize panel — refresh the
    // body cursor so the player sees the new reticle immediately.
    if (currentWeapon()) setCursorForWeapon(currentWeapon());
  },
  // Backpack-full fallback for detach — drop the attachment on the
  // ground next to the player so the detach action always succeeds.
  onDrop: (item) => {
    const p = player.mesh.position;
    if (tryEncounterItemDrop(item, p.x, p.z)) return;
    _coopDropOrLocal(p.clone(), item);
  },
});

// Coop-aware inventory drop. Joiner sends rpc-drop to the host;
// host spawns the item in its authoritative loot list as SHARED
// (claimedBy=null) so both peers see it on the ground and either
// can pick it back up. Host / single-player just spawn locally.
function _coopDropOrLocal(p, item) {
  // Downed players can't drop items — stops them from dumping
  // tagged loot pre-revive, and matches the "incapacitated"
  // fiction. The drop just no-ops; the item stays in inventory.
  if (_localDowned) return;
  const t = getCoopTransport();
  if (t.isOpen && !t.isHost) {
    t.send('rpc-drop', { x: p.x, z: p.z, item });
    return;
  }
  loot.spawnItem(p, item);
}

// Auto-grant relic pickups. Encounter rewards (and any
// relic the player walks over) are consumed on contact: the artifact
// joins their owned set and never enters the bag. This avoids the
// "what is this rock in my inventory" UX and gives encounter relics
// the immediate, permanent run-modifier reading the design calls for.
function _tryAcquireRelic(item) {
  if (!item || item.type !== 'relic' || !item.artifactId) return false;
  const ok = artifacts.acquire(item.artifactId);
  if (!ok) return false;
  recomputeStats();
  sfx.uiAccept?.();
  const def = ARTIFACT_DEFS[item.artifactId];
  const tag = def?.short ? ` — ${def.short}` : '';
  // Floor-pickup relics carry item.name; auto-grant paths (cursed
  // chest, encounter rewards) only ship { type, artifactId }, so
  // fall back to the def's name to avoid 'RELIC ACQUIRED: undefined'.
  const name = item.name || def?.name || item.artifactId;
  transientHudMsg(`RELIC ACQUIRED: ${name}${tag}`, 5.0);
  return true;
}

const lootUI = new LootUI({
  inventory,
  onClose: () => inventoryUI.render(),
  onOpenCustomize: (item) => {
    if (!item) return;
    if (item.type === 'ranged' || item.type === 'melee') customizeUI.open(item);
  },
  onDrop: (item) => {
    const p = player.mesh.position;
    if (tryEncounterItemDrop(item, p.x, p.z)) return;
    _coopDropOrLocal(p.clone(), item);
  },
  onAcquireArtifact: _tryAcquireRelic,
});

const perkUI = new PerkUI({
  tree: skillTree,
  getPoints: () => playerSkillPoints,
  spendPoints: (n) => {
    if (playerSkillPoints < n) return false;
    playerSkillPoints -= n;
    _refreshSkillPointPip();
    return true;
  },
  classMastery,
  onClose: () => { inventoryUI.render(); recomputeStats(); },
});

const shopUI = new ShopUI({
  inventory,
  getCredits: () => playerCredits,
  spendCredits: (n) => { if (playerCredits < n) return false; playerCredits -= n; return true; },
  earnCredits: (n) => { playerCredits += n; runStats.addCredits(n); },
  onClose: () => inventoryUI.render(),
  // Shop multiplier folds three things: the player's intrinsic
  // shopPriceMult (perks / set bonuses), the per-level price ramp
  // (later floors charge more), and a fixed scalar for "rare items
  // really cost". Computed live so changing levels updates prices.
  getShopMult: () => {
    const ramp = tunables.currency.levelPriceRamp || 0;
    const lv = Math.max(1, level?.index || 1);
    const levelFactor = 1 + ramp * (lv - 1);
    return (derivedStats.shopPriceMult || 1) * levelFactor;
  },
  onAcquireArtifact: (id) => {
    const ok = artifacts.acquire(id);
    if (ok) {
      recomputeStats();
      sfx.uiAccept();
    }
    return ok;
  },
  // Reroll: regenerate the open NPC's stock once per visit. Two paths:
  //   * Persistent Upgrades unlock — once per shop per visit, free.
  //   * Pending free reroll (Fortune Teller boon) — bypasses both
  //     the unlock and the per-visit gate; consumes one credit
  //     from pendingShopRerolls.
  getRerollUnlocked: () => getRerollUnlocked() || pendingShopRerolls > 0,
  onReroll: (npc) => {
    if (!npc) return false;
    const hasPending = pendingShopRerolls > 0;
    if (!hasPending) {
      if (!getRerollUnlocked()) return false;
      if (npc._rerollUsed) return false;
    }
    if      (npc.kind === 'merchant')     npc.stock = makeMerchantStock();
    else if (npc.kind === 'healer')       npc.stock = makeHealerStock();
    else if (npc.kind === 'gunsmith')     npc.stock = makeGunsmithStock();
    else if (npc.kind === 'armorer')      npc.stock = makeArmorerStock();
    else if (npc.kind === 'tailor')       npc.stock = makeTailorStock();
    else if (npc.kind === 'relicSeller')  npc.stock = makeRelicSellerStock();
    else if (npc.kind === 'blackMarket')  npc.stock = makeBlackMarketStock();
    else if (npc.kind === 'bearMerchant') npc.stock = makeMerchantStock('bearMerchant');
    if (pendingShopRerolls > 0) {
      pendingShopRerolls--;
    } else {
      npc._rerollUsed = true;
    }
    sfx.uiAccept();
    return true;
  },
  // Special bear-merchant trades. Each special-cased item id grants
  // a unique reward instead of the normal sell flow:
  //   thr_the_gift          → flips the mythic-run unlock flag
  //   junk_rocket_ticket    → grants the Rocket Shoes relic
  onSpecialBearTrade: (item) => {
    if (item.id === 'thr_the_gift') {
      setMythicRunUnlocked(true);
      transientHudMsg('THE PACT IS MADE', 4.0);
      return true;
    }
    if (item.id === 'junk_rocket_ticket') {
      const ok = artifacts.acquire('rocket_shoes');
      if (!ok) {
        // Already owned — refuse the trade so the player keeps the
        // ticket (which still has a normal sell value elsewhere).
        transientHudMsg('You already wear them.', 3.0);
        return false;
      }
      // Bear's flavour line, then the standard relic-acquired toast.
      // Speech bubble spawns above whichever bear NPC is in the level
      // (looked up live so the encounter chain doesn't need a ref).
      const bear = level?.npcs?.find?.(n => n.kind === 'bearMerchant');
      if (bear?.group) {
        const pos = bear.group.position.clone().setY(2.2);
        spawnSpeechBubble(pos, camera,
          'A heavily armed duck left these here, I guess you can have them.', 7.0);
      }
      recomputeStats();
      sfx.uiAccept?.();
      transientHudMsg('RELIC ACQUIRED: Rocket Shoes — Double dash distance', 5.0);
      return true;
    }
    if (item.id === 'toy_demon_bear') {
      // Demon Bear → Pain (mythic mace). The bear sells the toy for
      // a pact weapon, not credits. Wrap the tunable as an inventory
      // item so the equip + recomputeStats path picks up its
      // equipMods (66% melee lifesteal + 0.5× max HP).
      const painDef = tunables.weapons.find(w => w.name === 'Pain');
      if (!painDef) return false;
      // Force mythic — wrapWeapon would otherwise call rollWeaponRarity
      // and might roll Pain down to common/uncommon, losing the mythic
      // visual tier. equipMods are spread from the def either way.
      const pain = wrapWeapon(painDef, { rarity: 'mythic' });
      pain.rarity = 'mythic';
      pain.mythic = true;
      if (!inventory.add(pain)) {
        // Backpack full — refuse so the toy stays in inventory and
        // the player can clear space.
        transientHudMsg('Backpack full — make space first.', 3.0);
        return false;
      }
      const bear2 = level?.npcs?.find?.(n => n.kind === 'bearMerchant');
      if (bear2?.group) {
        const pos = bear2.group.position.clone().setY(2.2);
        spawnSpeechBubble(pos, camera,
          'Oh… him? Take this. Don\'t come back.', 7.0);
      }
      recomputeStats();
      sfx.uiAccept?.();
      transientHudMsg('MYTHIC ACQUIRED: Pain — 666 dmg · 66% lifesteal · −50% max HP', 6.0);
      return true;
    }
    return false;
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
// rare gear is mostly seen through them rather than enemy drops. The
// `levelOffset` shifts the rarity floor up by ~0..3 tiers (rolled per
// item) so a level-5 shop reliably stocks rare/epic gear that a
// level-1 shop wouldn't.
const RARITY_LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
function shopUpgradeRarity(item, { baseChance = 0.55, epicChance = 0.18 } = {}) {
  if (!item) return item;
  if (item.type === 'ranged' || item.type === 'melee') return item; // weapons roll via wrap
  // Roll a 0..3 tier bump biased by the current floor level so later
  // shops legitimately offer items "0-3 levels ahead". Sub-1 floors
  // act as level 1 — the floor is at least 1 once a run begins.
  const lv = Math.max(1, level?.index || 1);
  const offsetCap = Math.min(3, Math.floor(lv / 2));   // 0..3 max
  const offset = offsetCap > 0 ? Math.floor(Math.random() * (offsetCap + 1)) : 0;
  if (Math.random() < baseChance) {
    const r = Math.random();
    let tier;
    if (r < epicChance) tier = 'epic';
    else if (r < epicChance + 0.45) tier = 'rare';
    else tier = 'uncommon';
    // Apply level offset by walking the ladder up `offset` slots.
    let idx = RARITY_LADDER.indexOf(tier);
    if (idx >= 0) idx = Math.min(RARITY_LADDER.length - 1, idx + offset);
    item.rarity = RARITY_LADDER[idx] || tier;
  } else if (offset > 0) {
    // Non-upgrade roll still gets a small offset — at level 6+ a
    // "common" item may quietly become uncommon/rare.
    let idx = RARITY_LADDER.indexOf(item.rarity || 'common');
    if (idx >= 0) idx = Math.min(RARITY_LADDER.length - 1, idx + offset);
    item.rarity = RARITY_LADDER[idx] || item.rarity;
  }
  return item;
}

function makeMerchantStock(kindOverride) {
  const pool = [
    ...tunables.weapons.filter(w => !w.artifact && !w.mythic && w.rarity !== 'mythic').map(w => wrapWeapon(w)),
    ...ALL_ARMOR.map(a => withAffixes(shopUpgradeRarity({ ...a, durability: { ...a.durability } }))),
    ...ALL_GEAR.map(g => withAffixes(shopUpgradeRarity({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } }))),
    ...ALL_ATTACHMENTS.map(a => rollAttachmentRarity({ ...a, modifier: { ...a.modifier } })),
    { ...CONSUMABLE_DEFS.bandage },
    { ...CONSUMABLE_DEFS.medkit },
    // Encounter-trigger junk in the general pool so players can
    // reliably acquire what the Duck and They Do Exist encounters
    // need — random container drops are stochastic; merchant rolls
    // are predictable buy paths.
    { ...JUNK_DEFS.bagOfPeas },
    { ...JUNK_DEFS.fancyAlcohol },
    { ...JUNK_DEFS.yummyBiscuits },
  ];
  const stock = [];
  const bonus = getMerchantStockBonus(kindOverride || 'merchant');
  const n = Math.min(tunables.merchant.stockSize + bonus, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    stock.push(fluxify(pool.splice(idx, 1)[0]));
  }
  return stock;
}

// Healer NPC carries only health + buff consumables and a touch of armor.
function makeHealerStock() {
  const base = [
    { ...CONSUMABLE_DEFS.bandage },
    { ...CONSUMABLE_DEFS.bandage },
    { ...CONSUMABLE_DEFS.medkit },
    { ...CONSUMABLE_DEFS.medkit },
    { ...CONSUMABLE_DEFS.adrenaline },
    { ...CONSUMABLE_DEFS.combatStim },
  ];
  const bonus = getMerchantStockBonus('healer');
  // Each upgrade level adds one extra rolled consumable from the same pool.
  const heals = ALL_CONSUMABLES.filter(c =>
    c.useEffect?.kind === 'heal' || c.useEffect?.kind === 'buff');
  for (let i = 0; i < bonus && heals.length; i++) {
    base.push({ ...heals[Math.floor(Math.random() * heals.length)] });
  }
  return base.map(fluxify);
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
  // 4 weapons + 3 attachments + 2 weapon repair kits base, weapons
  // lean rare+. Upgrade level splits its bonus between weapons
  // (rounded up) and attachments. Repair-kit count is fixed; players
  // already get bonus drops from body loot and megabosses.
  const bonus = getMerchantStockBonus('gunsmith');
  const wBonus = Math.ceil(bonus / 2);
  const aBonus = bonus - wBonus;
  const weapons = pickN(
    tunables.weapons.filter(w => !w.artifact && !w.mythic && w.rarity !== 'mythic').map(w => wrapWeapon(w)),
    4 + wBonus,
  );
  const atts = pickN(ALL_ATTACHMENTS.map(a => rollAttachmentRarity({ ...a, modifier: { ...a.modifier } })), 3 + aBonus);
  const kits = [];
  for (let i = 0; i < 2; i++) kits.push(randomRepairKit('weapon'));
  return [...weapons, ...atts, ...kits].map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.15;  // premium shop
    return fluxify(it);
  });
}
function makeArmorerStock() {
  // 4 armor + 3 gear + 2 armor repair kits. Same bonus / kit-count
  // pattern as the gunsmith.
  const bonus = getMerchantStockBonus('armorer');
  const aBonus = Math.ceil(bonus / 2);
  const gBonus = bonus - aBonus;
  const armor = pickN(ALL_ARMOR.map(a => withAffixes(shopUpgradeRarity({ ...a, durability: { ...a.durability } }, { baseChance: 0.55, epicChance: 0.18 }))), 4 + aBonus);
  const gear  = pickN(ALL_GEAR.map(g => withAffixes(shopUpgradeRarity({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } }, { baseChance: 0.50, epicChance: 0.15 }))), 3 + gBonus);
  const kits = [];
  for (let i = 0; i < 2; i++) kits.push(randomRepairKit('armor'));
  return [...armor, ...gear, ...kits].map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.1;
    return fluxify(it);
  });
}
function makeTailorStock() {
  // Tailor peddles cloth/clothing — gear items only (no armor plates).
  const bonus = getMerchantStockBonus('tailor');
  const gear = pickN(ALL_GEAR.map(g => withAffixes(shopUpgradeRarity({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } }, { baseChance: 0.55, epicChance: 0.15 }))), 6 + bonus);
  return gear.map((it) => {
    it.priceMult = (it.priceMult || 1) * 0.9;  // tailor is cheaper
    return fluxify(it);
  });
}
function makeRelicSellerStock() {
  // Relic sellers deal exclusively in relics — permanent
  // run-altering buffs. Each visit offers 2-3 unowned artifacts plus a
  // couple of expensive high-rarity junk pieces as flavour stock.
  // Upgrade level adds extra unowned-artifact slots.
  // Encounter-only artifacts are filtered out — they're earned via
  // their dedicated encounter, not bought from the shop.
  // Permit-gated artifacts (a.permitGated) require the player to
  // have purchased the matching Black Market permit before they
  // appear in the rotation. Lazy-import to avoid a top-level cycle.
  const ownedPermits = (typeof getRelicPermits === 'function')
    ? getRelicPermits()
    : new Set();
  const unowned = ALL_ARTIFACTS.filter(a =>
    !artifacts.has(a.id) && !a.encounterOnly && !a.synthetic
    && (!a.permitGated || ownedPermits.has(`permit_${a.id}`)));
  const bonus = getMerchantStockBonus('relicSeller');
  const offerCount = Math.min(3 + bonus, unowned.length);
  const picks = [];
  const pool = [...unowned];
  for (let i = 0; i < offerCount; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  const relics = picks.map(def => {
    const relic = relicFor(def.id);
    relic.priceMult = 1;
    return relic;
  });
  const junks = pickN(ALL_JUNK.slice().map(j => ({ ...j })), 2);
  return [...relics, ...junks.map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.6;
    return fluxify(it);
  })];
}
function makeBlackMarketStock() {
  // Mix of high-tier everything — expensive but consistently good.
  // Upgrade level adds one extra weapon + one extra gear/armor slot
  // per two levels.
  const bonus = getMerchantStockBonus('blackMarket');
  const wBonus = Math.ceil(bonus / 2);
  const eBonus = bonus - wBonus;
  const weapons = pickN(
    tunables.weapons.filter(w => !w.artifact && (w.rarity === 'rare' || w.rarity === 'epic' || !w.rarity))
      .map(w => wrapWeapon(w)),
    3 + wBonus,
  );
  const gear = pickN(ALL_GEAR.map(g => withAffixes({ ...g, durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } })), 2 + eBonus);
  const armor = pickN(ALL_ARMOR.map(a => withAffixes({ ...a, durability: { ...a.durability } })), 2);
  const att = pickN(ALL_ATTACHMENTS.map(a => rollAttachmentRarity({ ...a, modifier: { ...a.modifier } })), 2);
  return [...weapons, ...gear, ...armor, ...att].map((it) => {
    it.priceMult = (it.priceMult || 1) * 1.4;
    return fluxify(it);
  });
}

// Left-edge durability column — shows orange / red glyphs for any
// equipped armor / gear / weapon whose durability is below 20% (or
// broken). Throttled internally; main loop just calls tick() each
// frame so a repaired item flips its glyph state immediately.
const durabilityHud = new DurabilityHud(inventory);

const inventoryUI = new InventoryUI({
  inventory, skills,
  // Live progression sources for the paperdoll overlay — pulled fresh
  // each render so unlocking a perk mid-run is reflected without
  // having to rebuild the inventory UI. Returned as plain id arrays /
  // {id: level} maps to keep the UI module decoupled from the
  // perk/skill-tree class internals.
  getSpecialPerks: () => Array.from(specialPerks.unlocked || []),
  getSkillTreeLevels: () => ({ ...skillTree.levels }),
  getArtifacts: () => artifacts.list(),
  onDrop: (item) => {
    const p = player.mesh.position;
    if (tryEncounterItemDrop(item, p.x, p.z)) return;
    _coopDropOrLocal(p.clone(), item);
  },
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
if (currentWeapon()) { player.setWeapon(currentWeapon()); setCursorForWeapon(currentWeapon()); }

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
  // Reaction tightening + aim sharpening ramp with level so high-tier
  // levels feel SHARPER, not just beefier. Caps prevent late-game
  // robotic perfection.
  //
  // Curve halved (2026-04-25) so what used to be stage-4 difficulty
  // now lands at stage 7 — most playtesters were dying around stage 4
  // and the early ramp felt too steep. Per-level coefficients are
  // each ~0.5× the previous values; caps unchanged so late-game
  // still tops out at the same ceiling, just reached later.
  const lv = Math.max(0, level.index - 1);
  // Early-game damage cushion — floors 1-3 (lv 0-2) get a softer
  // damage curve so a fresh-run player isn't immediately one-shot
  // by elite enemies / sub-bosses on the opening floors. Ramps from
  // 0.65× at floor 1 up to 1.0× at floor 4 where the standard
  // +0.06/lv ramp takes over. Affects every enemy that reads
  // diff.damageMult on spawn — gunmen, melees, sub-bosses, bosses.
  // Megabosses (per-encounter scale) are unaffected; they're
  // gated to floor 5+ anyway. (2026-05-01: playtest feedback —
  // first 1-3 floors hit too hard across the board.)
  const earlyMult = lv === 0 ? 0.65
                  : lv === 1 ? 0.80
                  : lv === 2 ? 0.92
                  :            1.00;
  return {
    hpMult: 1 + 0.09 * lv,
    damageMult: (1 + 0.06 * lv) * earlyMult,
    rarityBias: Math.min(0.6, 0.04 * lv),
    // <1 means faster reaction. Cap at 0.45× so it never goes below
    // a reasonable "trained operator" floor.
    reactionMult: Math.max(0.45, 1 - 0.025 * lv),
    // <1 means tighter spread (better aim). Cap at 0.55× so it doesn't
    // go full aimbot in the late game.
    aimSpreadMult: Math.max(0.55, 1 - 0.025 * lv),
    // Aggression scalar — boss frequency/attack-rate multiplier.
    // Cap stays at 2.0; reached around level 21 in the new curve.
    aggression: Math.min(2.0, 1 + 0.05 * lv),
  };
}
window.__difficultyScale = difficultyScale;

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
    attachments[chosenAtt.slot] = rollAttachmentRarity({
      ...chosenAtt,
      modifier: { ...(chosenAtt.modifier || {}) },
    });
    const idx = openSlots.indexOf(chosenAtt.slot);
    if (idx >= 0) openSlots.splice(idx, 1);
  }
  return { ...pick, attachments };
}

// Per-run seed used to make level generation deterministic across
// peers. Set on host run-start, broadcast via the 'level-seed' coop
// message, applied by joiners in their next regenerateLevel(). When
// no run seed is set (single-player) the wrapper falls back to
// real Math.random so behavior is unchanged.
let _runSeed = 0;
function _setRunSeed(seed) {
  _runSeed = (seed >>> 0) || 0;
}
function _getEffectiveSeed() {
  if (!_runSeed) return 0;
  // Mix in the floor index so each level differs but stays
  // deterministic per-floor across peers.
  const lv = (level?.index | 0);
  return ((_runSeed ^ Math.imul(lv + 1, 0x9E3779B1)) >>> 0) || 1;
}
// Run `fn` with Math.random temporarily replaced by a seeded mulberry32
// generator. Cheaper than migrating 100+ Math.random() sites in the
// generation pipeline. Async work that resolves AFTER fn returns is
// not seeded — generation is synchronous so this is a non-issue.
// Original (unseeded) Math.random captured at module load. Used by
// _withOriginalRandom to run a closure WITHOUT consuming the outer
// seeded RNG state — necessary for paths that the host runs but the
// joiner skips (host's pickEncounterForLevel during regen) so both
// peers' seeded state stays in lockstep through the rest of regen.
const _origMathRandom = Math.random;
function _withOriginalRandom(fn) {
  const saved = Math.random;
  Math.random = _origMathRandom;
  try { return fn(); }
  finally { Math.random = saved; }
}

function _withRunSeed(seed, fn) {
  if (!seed) return fn();
  const orig = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return fn(); }
  finally { Math.random = orig; }
}

function regenerateLevel() {
  // Coop seed sync — host generates a seed lazily on first level
  // generation if one isn't set yet, so the broadcast below carries
  // a valid value joiners can mirror. Single-player runs leave
  // _runSeed = 0 and the seeded-RNG wrapper short-circuits to the
  // real Math.random.
  const transport = getCoopTransport();
  console.log('[coop] regenerateLevel called',
    { isOpen: transport.isOpen, isHost: transport.isHost,
      peerId: transport.peerId, hostId: transport.hostId,
      runSeed: _runSeed });
  // COOP GATE — the user has picked coop (roomCode set, either via
  // Host or Join button) but we're not yet ready to generate a level
  // matching the host's layout. "Ready" means:
  //   - transport.isOpen, AND
  //   - we're host (we'll mint a seed below), OR _runSeed is set
  //     (the joiner already received the host's seed).
  // Anything else, defer. The level-seed listener / first host-side
  // regen will retry once we're ready. This catches the page-load
  // regen + any Play click that races ahead of the WS handshake.
  const inCoop = !!transport.roomCode;
  const ready = transport.isOpen && (transport.isHost || _runSeed > 0);
  if (inCoop && !ready) {
    console.log('[coop] regenerateLevel deferred',
      { reason: !transport.isOpen ? 'transport not yet open'
                                  : 'joiner waiting for level-seed',
        isOpen: transport.isOpen, isHost: transport.isHost, runSeed: _runSeed });
    _coopRegenPending = true;
    return;
  }
  _coopRegenPending = false;
  if (transport.isOpen && transport.isHost && !_runSeed) {
    _runSeed = (Math.random() * 0xFFFFFFFF) >>> 0 || 1;
    console.log('[coop] generated run seed', _runSeed);
  }
  // Coop encounter sync — reset the host's per-floor pick log before
  // regen runs so it accumulates only this floor's choices.
  if (transport.isOpen && transport.isHost) _coopHostEncounterIds = [];
  const result = _withRunSeed(_getEffectiveSeed(), () => _regenerateLevelImpl());
  // Broadcast AFTER generation so joiners apply the seed for their
  // own regen call. Encounter ids attached so both peers see the
  // SAME encounter (interaction state stays per-peer locally).
  if (transport.isOpen && transport.isHost && _runSeed) {
    const lv = (level?.index | 0);
    transport.send('level-seed', {
      seed: _runSeed, levelIndex: lv,
      enc: _coopHostEncounterIds.slice(),
    });
    console.log('[coop] broadcasting level-seed',
      { seed: _runSeed, levelIndex: lv, encounters: _coopHostEncounterIds });
  } else if (transport.isOpen) {
    console.log('[coop] skipped broadcast (not host or no seed)',
      { isHost: transport.isHost, runSeed: _runSeed });
  }
  return result;
}
function _regenerateLevelImpl() {
  // Coop net-ID counter reset — must run BEFORE the spawn loop in
  // this function so each enemy gets the same netId on host and
  // joiner (spawn order is deterministic via the seeded RNG, so
  // a counter that resets here lines up on both ends).
  resetNetIds();
  // Tear down old BVHs so the GC can reclaim them alongside the
  // dropped geometries. Called BEFORE level.generate which replaces
  // the obstacle list.
  if (level.obstacles) for (let i = 0; i < level.obstacles.length; i++) disposeMesh(level.obstacles[i]);
  // Flush every transient combat effect from the previous level —
  // blood pools, gore, impacts, explosions, etc. These persisted
  // across level transitions and accumulated across a long run.
  if (combat.clearAll) combat.clearAll();
  // Pre-warm combat pools — on first level the lazy _ensurePools()
  // ran on the first shot, allocating ~270 meshes mid-frame and
  // producing the visible 'first shot hitch.' Forcing pool creation
  // here moves it into the level-transition window where the
  // player's already paying for regen + asset loads.
  if (combat._ensurePools) combat._ensurePools();
  // Encounter chance pinned to 100% — every floor rolls one. The pool
  // is large enough that variety holds up at full saturation.
  level._encounterChance = 1.0;
  // Mega-boss milestone floors get a custom generator: a single open
  // arena, no random walk, no encounter rolls, no AI spawns. The boss
  // itself is allocated below after BVHs build. Detect by the index
  // that WILL result from generate() — generate() bumps level.index by
  // 1, so we test (current + 1).
  const isMegaFloor = isMegaBossLevel((level.index | 0) + 1);
  // Tear down any prior boss instance — previous-floor leftovers
  // would dangle their HUD bar + scene meshes otherwise.
  if (megaBoss) { megaBoss.destroy(); megaBoss = null; }
  if (isMegaFloor) {
    level.generateMegaArena();
  } else {
    level.generate();
  }
  // Loot scaling context — every random armor/gear/weapon roll reads
  // this to gate slot drops, scale affix ranges, and weight rarity
  // probabilities. Set BEFORE buildBodyLoot etc. fire below.
  setLootLevel(level.index);
  // Build BVHs over the new wall + obstacle set. Each tree is a
  // one-time cost (~0.1ms per BoxGeometry); subsequent raycasts pay
  // O(log N) instead of O(N).
  accelerateAll(level.obstacles);
  // Track furthest level reached this run. Monotonic — doesn't regress
  // if a level is re-entered for any reason.
  runStats.setLevel(level.index | 0);
  gunmen.removeAll();
  melees.removeAll();
  drones.removeAll();
  // Dummies (CnC pair, tutorial range targets) used to persist
  // across floors — the encounter spawns them via dummies.spawn
  // but the regen sweep didn't dispose them. Resulted in the CnC
  // gunman + kneeler standing on every subsequent floor's centre.
  if (dummies.removeAll) dummies.removeAll();
  loot.removeAll();
  // In-flight + settled projectiles (claymores especially) used to
  // persist into the next floor — they were spawned via
  // projectiles.spawn but level.clear didn't know about them.
  if (projectiles.removeAll) projectiles.removeAll();
  // Placed claymores live in their own _claymores list (not in the
  // projectile manager), so they need a separate sweep on regen.
  _removeAllClaymores();
  playerKeys.clear();
  // Pre-warm the FBX clone for every weapon currently in the player's
  // rotation. The clone+fit+rotate pass takes a few frames per
  // weapon; doing it during regen (when the screen's already in
  // transition) means the first in-game swap to each weapon is a
  // free visibility toggle.
  if (player && player.prewarmWeapon) {
    for (const w of inventory.getWeaponRotation()) player.prewarmWeapon(w);
  }
  const diff = difficultyScale();
  const gearLevel = level.index || 0;
  // Mega-boss spawn — at arena center. Boss handles its own visuals,
  // attack FSM, hazards, and HUD bar. The dormant intro ritual runs
  // first, leaving the player free to position before combat starts.
  if (isMegaFloor) {
    // Pick which mega-boss runs this floor. Three-way rotation
    // across mega-floors (10/15/20/25/...) cycling Arboter → Echo →
    // General. `idx` indexes successive mega-floors so the cycle
    // works regardless of whether the player skipped any.
    //   floor 10 = idx 0 = ARBOTER
    //   floor 15 = idx 1 = ECHO
    //   floor 20 = idx 2 = GENERAL
    //   floor 25 = idx 3 = ARBOTER (cycle)
    //   ...
    const _megaIdx = Math.max(0, Math.floor(((level.index | 0) - 10) / 5));
    const _megaPick = _megaIdx % 3;
    const useEcho    = _megaPick === 1;
    const useGeneral = _megaPick === 2;
    const MegaCtor = useGeneral ? MegaBossGeneral
                  : useEcho     ? MegaBossEcho
                  :               MegaBoss;
    const lootFn   = useGeneral ? buildGeneralLoot
                  : useEcho     ? buildEchoLoot
                  :               buildMegaBossLoot;
    megaBoss = new MegaCtor({
      scene, camera,
      combat, loot, sfx, projectiles,
      damagePlayer,
      // Coop: route burst-hazard hits to joiner ghosts caught in the
      // same blast / corridor / bullet path. No-op outside coop. See
      // _coopDamageRemotePlayersInRadius for the broadcast logic.
      damageRemotePlayersInRadius: _coopDamageRemotePlayersInRadius,
      damageRemotePlayersInCone:   _coopDamageRemotePlayersInCone,
      coopBroadcastTracer:         _coopBroadcastMegabossTracer,
      coopBroadcastRing:           _coopBroadcastTelegraphRing,
      getPlayerPos: () => player.mesh.position,
      playerHasIFrames: () => (lastPlayerInfo?.iFrames | 0) > 0,
      // Smoke-zone queries — let the boss respect smoke grenades the
      // way regular gunmen / melees do. Without these the megaboss
      // tracks the player's exact position through any smoke wall.
      smokeContaining,
      smokeOnSegment,
      // Wall LoS query — used by attack-spawn paths to refuse firing
      // when the boss has no line of sight to the player. Prevents
      // flame-cone / projectile attacks from clipping through walls.
      hasLineOfSight: (ax, az, bx, bz) => {
        if (!level || !level._segmentClear) return true;
        // Use a thin radius so corner geometry / pillars don't false-
        // negative the boss's sight line at long range, but still
        // catches honest wall obstructions.
        return level._segmentClear(ax, az, bx, bz, 0.25);
      },
      // Boss-driven minion spawn (Arboter "summon melee" attack).
      // Returns the spawned minion (or null) so callers can tag it.
      // Skips if the spawn point is collision-blocked.
      spawnMelee: (x, z, opts = {}) => {
        if (level._collidesAt && level._collidesAt(x, z, 0.5)) return null;
        const m = melees.spawn(x, z, {
          tier: 'normal',
          roomId: level.megaArenaCenter ? 0 : -1,
          hpMult:   opts.hpMult   ?? 0.6,
          damageMult: opts.damageMult ?? 0.8,
          aggression: 1.2,
          gearLevel:  level.index | 0,
        });
        if (m) {
          m.summoned = true;
          m.noDrops  = true;
          m.noXp     = true;
        }
        return m;
      },
      // The General — phalanx + wave hooks. Phalanx members are
      // shield-bearers with controlledByBoss=true so the AI tick
      // skips their motion (the General class drives position).
      spawnPhalanxBearer: (x, z, hpMult) => {
        if (level._collidesAt && level._collidesAt(x, z, 0.5)) return null;
        const m = melees.spawn(x, z, {
          tier: 'normal',
          variant: 'shieldBearer',
          roomId: 0,
          hpMult: hpMult || 3.0,
          damageMult: 1.0,
          gearLevel: level.index | 0,
        });
        if (m) {
          m.summoned        = true;
          m.noDrops         = true;
          m.noXp            = true;
          m.controlledByBoss = true;
        }
        return m;
      },
      // General's wave troops — regular grunts with optional
      // swordsman promotion (double HP + cosmetic scale bump).
      spawnGeneralTroop: (x, z, isSwordsman, troopHpMult) => {
        if (level._collidesAt && level._collidesAt(x, z, 0.5)) return null;
        const T = (typeof BALANCE !== 'undefined') ? BALANCE.megaboss.general : null;
        const baseHp  = troopHpMult || 0.6;
        const hpMult  = isSwordsman && T
          ? baseHp * T.swordsmanHpFactor
          : baseHp;
        const m = melees.spawn(x, z, {
          tier: 'normal',
          variant: 'standard',
          roomId: 0,
          hpMult,
          damageMult: 0.8,
          aggression: 1.4,
          gearLevel:  level.index | 0,
        });
        if (m) {
          m.summoned = true;
          m.noDrops  = true;
          m.noXp     = true;
          if (isSwordsman && m.group && T) {
            m.group.scale.set(T.swordsmanScale, T.swordsmanScale, T.swordsmanScale);
          }
        }
        return m;
      },
      // Lifetime mega-boss-encounter index. Each megaboss class reads
      // this on construct to scale HP / wave caps over repeat fights.
      encounterIndex: getMegaBossEncounterCount(),
      // Echo + General call this from their _die path so the
      // counter ticks regardless of which boss the player kills.
      // Arboter's MegaBoss._die calls the function directly (it's
      // the original site) so we don't double-bump there.
      bumpEncounterCount: () => bumpMegaBossEncounterCount(),
      knockbackPlayer: (dx, dz) => {
        // Best-effort displacement — bypass collision. Player physics
        // smooths the next tick.
        if (player?.mesh) {
          player.mesh.position.x += dx * 0.5;
          player.mesh.position.z += dz * 0.5;
        }
      },
      shake: (m, d) => triggerShake(m, d),
      onMegaBossDead: (boss) => {
        // Reveal the exit zone — already staged by generateMegaArena.
        if (level.revealExit) level.revealExit();
        if (sfx?.roomClear) sfx.roomClear();
        // Persistent megaboss-kill counter feeds harder contract
        // unlocks (lethal-tier `unlockedAt.megabossKills`). Per-run
        // counter mirrors it for contract evaluation.
        runStats.megabossKillsThisRun = (runStats.megabossKillsThisRun | 0) + 1;
        bumpMegabossKills();
        runStats.noteArchetypeKill('megaboss');
        _applyContractPerKillReward('megaboss');
        // Sigil bounty — if the active contract names megaboss, pay
        // its sigilsReward immediately. Sigils survive subsequent
        // death (they're banked at kill-time, not run-end).
        const ac = getActiveContract();
        if (ac && (ac.claimedAt | 0) === 0) {
          const def = defForId(ac.activeContractId);
          if (def && def.targetType === 'megaboss' && (def.sigilsReward | 0) > 0) {
            awardSigils(def.sigilsReward | 0);
            transientHudMsg(`+${def.sigilsReward} sigils — bounty.`);
          }
        }
      },
      lootRolls: (encIdx) => {
        const drops = lootFn({
        randomWeapon: (rarity) => {
          // Pull from the existing weapon roll pipeline. randomWeapon
          // doesn't exist here; we synthesize via wrapWeapon over the
          // tunables pool, biased to the requested rarity. Excludes
          // artifact weapons (Jessica's Rage) — apex pistol is bear-
          // trade-only — and any weapon flagged worldDrop:false.
          const pool = tunables.weapons.filter(w =>
            w.rarity !== 'mythic' && !w.artifact && w.worldDrop !== false);
          const candidates = pool.filter(w => w.rarity === rarity);
          const pick = (candidates.length ? candidates : pool)[Math.floor(Math.random() * (candidates.length ? candidates.length : pool.length))];
          if (!pick) return null;
          // Force the requested rarity on the wrapped clone so a
          // common-rarity base in `tunables.weapons` lands as e.g. epic.
          const w = wrapWeapon({ ...pick, rarity });
          return w;
        },
        randomArmor: (rarity) => {
          const a = randomArmor();
          if (a && rarity) a.rarity = rarity;
          return a;
        },
        pickHealConsumable: () => {
          const heals = ALL_CONSUMABLES.filter(c => c.useEffect?.kind === 'heal');
          if (!heals.length) return null;
          const item = heals[Math.floor(Math.random() * heals.length)];
          return JSON.parse(JSON.stringify(item));
        },
        pickJunk: () => {
          // Use the project's existing junk roller — same pool the
          // body-loot pipeline uses for grunt drops.
          if (typeof randomJunk === 'function') return randomJunk();
          return null;
        },
        }, encIdx);
        // Universal megaboss drop: 1-3 repair kits (mix of armor + weapon).
        // Megabosses are long fights that chew durability, so the player
        // is in a different repair-budget bracket than after a regular
        // floor. Stack appears alongside the standard rolls.
        const kitCount = 1 + Math.floor(Math.random() * 3);   // 1..3
        for (let i = 0; i < kitCount; i++) drops.push(randomEitherRepairKit());
        return drops;
      },
    });
    megaBoss.spawn(level.megaArenaCenter || new THREE.Vector3(0, 0, 0));
    _currentMusicTrack = 'boss'; sfx.musicPlay?.('boss');
  }

  // Keycard assignment — hand each level.keycardColors entry to a
  // random sub-boss or major-boss spawn. Level generation caps key
  // count by holder count, so the pool shouldn't exhaust; if it
  // somehow does (edge case), fall through to the first-available
  // elite spawn so no key ever goes unassigned and softlocks a door.
  const holderSpawns = level.enemySpawns.filter(s => s.tier === 'subBoss' || s.majorBoss);
  const keyPool = [...(level.keycardColors || [])];
  // Major bosses go FIRST in the assignment order so the floor's boss
  // always gets a key when one is available — players expect "kill
  // the boss → get the key on this floor's locked door." Sub-bosses
  // get the remaining keys after. Within each band the order is
  // shuffled so multi-key levels don't always assign the same colour
  // to the same archetype.
  const majors = holderSpawns.filter(s => s.majorBoss).sort(() => Math.random() - 0.5);
  const subs   = holderSpawns.filter(s => !s.majorBoss).sort(() => Math.random() - 0.5);
  const ordered = [...majors, ...subs];
  const keyAssignments = new Map();   // spawn entry → colour
  for (const sb of ordered) {
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
    // Early-floor sub-boss damage softener — at low levels sub-bosses
    // were oppressive: same weapon pool as grunts, but with 20% faster
    // fire / 15% faster move / 25% sharper reaction. Scale damageMult
    // down on floors 1-5 so early sub-bosses pressure-test rather than
    // delete the player. Full damage from floor 6 onward.
    let perSpawnDmg = diff.damageMult;
    if (s.tier === 'subBoss' && !s.majorBoss) {
      const lv = Math.max(1, level.index | 0);
      const subDmgMult = lv <= 2 ? 0.65
                       : lv <= 4 ? 0.78
                       : lv <= 5 ? 0.90
                       : 1.0;
      perSpawnDmg *= subDmgMult;
    }
    const opts = {
      tier: s.tier, roomId: s.roomId,
      hpMult: diff.hpMult, damageMult: perSpawnDmg,
      reactionMult: diff.reactionMult,
      aimSpreadMult: diff.aimSpreadMult,
      aggression: diff.aggression,
      variant: s.variant,
      gearLevel,
      archetype: s.archetype,
      majorBoss: !!s.majorBoss,
    };
    // Tutorial dummies — passive, never alert, but VERY tanky so the
    // player can land headshot + leg + disarm + melee lessons without
    // killing the dummy mid-curriculum. Original hpMult=0.4 made
    // pistol-headshot one-shot the dummy, blocking every later combat
    // step. 12.0 ≈ 1200-1800 HP — well clear of typical pistol burst.
    if (s.tutorialDummy) {
      opts.hpMult = 12.0;
      opts.aggression = 0;
      opts.aimSpreadMult = 99;       // can't aim well even if it tries
    }
    if (s.kind === 'melee') {
      const e = melees.spawn(s.x, s.z, opts);
      const colour = keyAssignments.get(s);
      if (colour && e) e.keyDrop = colour;
    } else {
      // Archetype-specific weapon override for the major-boss roster:
      // a flamer must spawn with the flamethrower; a grenadier carries
      // a tagged AI-only projectile launcher derived from the frag
      // throwable. Other archetypes fall through to the random weapon.
      let bossWeapon = pickWeaponForAI(s.variant);
      if (s.archetype === 'flamer') {
        const flame = tunables.weapons.find(w => w.fireMode === 'flame');
        if (flame) bossWeapon = JSON.parse(JSON.stringify(flame));
      } else if (s.archetype === 'grenadier') {
        // Stamp a `bossGrenadier` flag the AI tick reads to layer
        // periodic projectile throws onto a normal weapon. Cheap +
        // doesn't require a new weapon entry in tunables.
        bossWeapon = { ...bossWeapon, bossGrenadier: true };
      }
      const g = gunmen.spawn(s.x, s.z, bossWeapon, opts);
      const colour = keyAssignments.get(s);
      if (colour && g) g.keyDrop = colour;
      // Tutorial flags — flow back onto the spawned actor so the
      // tutorial-step ticking can address them by name.
      if (g && s.tutorialDummy) g.tutorialDummy = true;
      if (g && s.stealthTarget) {
        g.stealthTarget = true;
        // Face the dummy AWAY from the player spawn so "approach from
        // behind while crouched" reads as the lesson. Player spawns
        // around (0, -10); stealth dummy at (~+12, -9). Yaw +π/2 puts
        // its forward toward +X — facing east, away from the player.
        if (g.group) g.group.rotation.y = Math.PI / 2;
      }
    }
  }
  // Tutorial-only setup: pre-spawn a pickup target near the player so
  // the 'pickup' step has something to walk over before any kills
  // happen. Prevents the chicken-and-egg of "pick up loot before
  // anything has dropped."
  if (tutorialMode) {
    loot.spawnItem(
      { x: level.playerSpawn.x + 2.5, y: 0.4, z: level.playerSpawn.z + 1.5 },
      {
        id: 'cons_bandage', name: 'Bandage', type: 'consumable', rarity: 'common',
        useEffect: { kind: 'heal', amount: 30 },
      },
    );
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
          // Strip the matching keyDrop from any spawned enemy so the
          // player doesn't pick up an orphan keycard for a door that
          // no longer exists. Was the cause of "got a blue keycard
          // but no blue door" on auto-unlocked layouts.
          for (const g of gunmen.gunmen) {
            if (g.keyDrop === col) g.keyDrop = null;
          }
          for (const e of melees.enemies) {
            if (e.keyDrop === col) e.keyDrop = null;
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
  // Hidden-boss ambush — ~35% of boss rooms hide every occupant
  // (boss + minions) until the player crosses the threshold. Reads as
  // an empty room from the doorway, then bursts to life on entry.
  // Two gates so ambush can never strand a boss in a tiny / wall-
  // heavy enclosure (the bunker layout has a 4-wall middle quad
  // that the boss could drop into and become unreachable):
  //   * room area must be at least 80 m²
  //   * room layout must NOT be in the wall-heavy small-cells set.
  const AMBUSH_BANNED_LAYOUTS = new Set([
    'bunker', 'pillars-grid', 'closet', 'corridor', 'partition',
    'columns-cross', 'center-pit',
  ]);
  for (const r of level.rooms) {
    if (r.type !== 'boss' || r.entered) continue;
    const b = r.bounds;
    const area = (b.maxX - b.minX) * (b.maxZ - b.minZ);
    if (area < 80) continue;
    if (AMBUSH_BANNED_LAYOUTS.has(r.layout)) continue;
    if (Math.random() > 0.35) continue;
    const hideOne = (c) => {
      if (!c || !c.group) return;
      c.group.visible = false;
      c.hidden = true;
      // CRITICAL: rig instancer renders via InstancedMesh slots
      // independent of c.group.visible. Without this, hidden ambush
      // actors still draw via the instance pool and the player sees
      // them standing in place before the trigger. Park the slots
      // at zero-scale until the reveal flips the flag back.
      _setEnemyInstHidden(c, true);
      // Kill alertness while hidden so they don't shoot through walls.
      if (c.state && c.state !== 'dead') c.state = 'idle';
    };
    let any = false;
    for (const g of gunmen.gunmen) if (g.alive && g.roomId === r.id) { hideOne(g); any = true; }
    for (const m of melees.enemies) if (m.alive && m.roomId === r.id) { hideOne(m); any = true; }
    if (any) r._ambushHidden = true;
  }
  // Random encounter — if level-gen flagged a room as type 'encounter',
  // pick one from ENCOUNTER_DEFS that hasn't been completed yet, build
  // its visuals, and stash the per-encounter runtime state on the room.
  // Skip if the player has cleared every available encounter — the room
  // just stays empty.
  // Pity-timer accounting — capture whether the level GEN rolled an
  // encounter room, regardless of whether a def was assignable. This
  // resets the bonus to 0 (next floor base 30%) even on demote-to-combat
  // outcomes, so once-per-save drain doesn't pin the timer at 95%.
  const _rolledEncounterThisLevel = level.rooms.some(r => r.type === 'encounter');
  for (const r of level.rooms) {
    if (r.type !== 'encounter' || !r._encounterPlaceholder) continue;
    r._encounterPlaceholder = false;
    // Encounter completion is tracked PER RUN only. Persisting via
    // localStorage drained the pool after a few runs and produced
    // empty rooms (encounter conversion happened, but
    // pickEncounterForLevel returned null because everything was
    // already completed). _runCompletedEncounters resets in
    // _resetEncounterCompletionForRun on every new run.
    const def = _coopPickEncounter(level.index | 0);
    if (!def) {
      r.type = 'combat';   // demote — main UI stays consistent
      continue;
    }
    // Single ctx factory shared between the initial def.spawn() call
    // and every later interact / tick / drop dispatch. Previously the
    // initial spawn ctx only carried spawnSpeech + spawnLoot +
    // spawnMasterworkChest, so encounters that needed
    // spawnEncounterChest / spawnCnCPair / spawnRandomContainerAt /
    // rollSubBossLootPile AT spawn time silently no-op'd. Sleeping
    // Boss is the canonical victim — its corner chest never spawned.
    const _ctxFactory = () => ({
      playerPos: player.mesh.position,
      // Live player horizontal speed — Sleeping Boss reads this so
      // running near him wakes the encounter while sneak-walking
      // keeps the peaceful path open.
      playerSpeed: lastPlayerInfo ? (lastPlayerInfo.speed || 0) : 0,
      scene, level, room: r,
      // Modal prompt helpers exposed on every ctx — were previously
      // monkey-patched onto ctx inside tryInteract before each
      // interact() call, which meant calling them from tick() or
      // onItemDropped() would crash. Expose them here so any encounter
      // hook can drive the prompt UI. Caught by gemini audit
      // (audits/encounter-ctx.md).
      showPrompt: showEncounterPrompt,
      closePrompt: closeEncounterPrompt,
      // 7s minimum on every encounter speech so the player has time
      // to read the line, even if the encounter passed a shorter
      // explicit life value.
      spawnSpeech: (worldPos, text, life) => spawnSpeechBubble(worldPos, camera, text, Math.max(life || 0, 7.0)),
      // Same bubble system but no minimum-life floor — used by Hoop
      // Dreams' MVP! celebration where ~250 short-lived bubbles
      // need to fade fast. Lifetime defaults to 1.5s if omitted.
      spawnSpeechRaw: (worldPos, text, life) => spawnSpeechBubble(worldPos, camera, text, life || 1.5),
      spawnMasterworkChest: (x, z) => _spawnMasterworkChestAt(x, z),
      spawnLoot: (x, z, item) => loot.spawnItem({ x, y: 0.4, z }, item),
        // Reward-roll helpers — encounters call these to keep the
        // module decoupled from inventory.js / attachments.js.
        rollRandomToy: () => randomToy(),
        rollRareGear: () => {
          const g = randomGear();
          const rolled = withAffixes({
            ...g,
            durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) },
          });
          // Force at least rare so the reward feels worth the trade.
          const ladder = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
          const idx = ladder.indexOf(rolled.rarity || 'common');
          if (idx < 2) rolled.rarity = 'rare';
          return rolled;
        },
        rollLowTierWeapon: () => {
          const pool = tunables.weapons.filter(w =>
            !w.artifact && !w.mythic
            && (w.rarity === 'common' || w.rarity === 'uncommon' || !w.rarity));
          const pick = pool[Math.floor(Math.random() * pool.length)];
          return wrapWeapon(pick);
        },
        rollEpicWeapon: () => {
          const pool = tunables.weapons.filter(w =>
            !w.artifact && !w.mythic && w.rarity === 'epic');
          const fallback = tunables.weapons.filter(w =>
            !w.artifact && !w.mythic && w.rarity === 'rare');
          const src = pool.length ? pool : fallback;
          if (!src.length) return null;
          return wrapWeapon(src[Math.floor(Math.random() * src.length)]);
        },
        rollLegendaryWeapon: () => {
          const pool = tunables.weapons.filter(w =>
            !w.artifact && !w.mythic && w.rarity === 'legendary');
          const fallback = tunables.weapons.filter(w =>
            !w.artifact && !w.mythic && w.rarity === 'epic');
          const src = pool.length ? pool : fallback;
          if (!src.length) return null;
          return wrapWeapon(src[Math.floor(Math.random() * src.length)]);
        },
        rollUnownedRelic: () => {
          // Skip encounter-only artifacts; they have their own
          // dedicated encounter as the acquisition path.
          const unowned = ALL_ARTIFACTS.filter(a => !artifacts.has(a.id) && !a.encounterOnly && !a.synthetic);
          if (!unowned.length) return null;
          const def = unowned[Math.floor(Math.random() * unowned.length)];
          return relicFor(def.id);
        },
        // Encounter-side artifact helpers — encounters can build a
        // scroll from a specific id (e.g. Duck → innocent_heart) or
        // filter their candidate pool to drop ones the player
        // already owns.
        relicFor: (id) => relicFor(id),
        filterUnownedArtifactIds: (ids) => ids.filter(id => !artifacts.has(id)),
        // Currency + buff hooks for shrine / fortune teller.
        getPlayerCredits: () => playerCredits,
        spendPlayerCredits: (n) => {
          if (playerCredits < n) return false;
          playerCredits -= n;
          return true;
        },
        grantBuff: (id, mods, life) => buffs.grant(id, mods, life || 60),
        rollMythicWeapon: () => rollMythicDrop(),
        // Shrine tier persistence — encounters call these to gate
        // already-purchased options.
        getShrineTiers: () => getShrineTiers(),
        setShrineTier: (tier) => setShrineTierPurchased(tier),
        // Permanent run bonus (cleared on death) — applied to
        // derivedStats.maxHealthBonus via a session-scoped pool. The
        // shrine bonus is the only writer today.
        addShrineMaxHpBonus: (amount) => {
          shrineHpBonus += (amount | 0);
          recomputeStats();
        },
        // Fortune Teller "free reroll" reward — increments the
        // counter the ShopUI checks. Stacks if granted multiple
        // times (theoretically; today it's one-shot per save).
        grantPendingShopReroll: () => { pendingShopRerolls++; },
        // Whispering Door — bump level.index by N and re-extract.
        // The +N actually applies during regenerateLevel since it
        // increments index by 1; we pre-add N-1 here so the result
        // lands at current+N. Then trigger the standard extract
        // pipeline.
        advanceLevels: (n) => {
          const skip = Math.max(1, n | 0);
          // regenerateLevel increments level.index by 1, so we want
          // to add (skip - 1) here for the net to be `skip`.
          if (level && skip > 1) level.index += (skip - 1);
          extractPending = true;
        },
        // Fountain — spawn a single-item chest containing a King's
        // Signet at the given world XZ. Reuses the masterwork-chest
        // visual (the chest itself looks ornate) but stocks just
        // the signet. Skips the standard makeContainer roll.
        spawnSignetChest: (x, z) => _spawnEncounterChestAt(x, z,
          [{ ...JUNK_DEFS.kingsRing, durability: undefined }]),
        // Generic chest with caller-supplied items. Used by Sleeping
        // Boss for the sub-boss-tier corner pile.
        spawnEncounterChest: (x, z, items) => _spawnEncounterChestAt(x, z, items),
        // Mirror — spawn a clone enemy with the player's currently
        // equipped weapon, same max HP, marked so the kill drop is a
        // mastercraft of the same weapon. Returns the gunman/melee
        // record so the encounter tick can poll alive state.
        spawnMirrorClone: (x, z, room) => _spawnMirrorClone(x, z, room),
        // Choices and Consequences — spawn the gunman + kneeling-man
        // pair as non-AI hittable props (or attackable targets) and
        // return references for the encounter tick.
        spawnCnCPair: (cx, cz, room) => _spawnCnCPair(cx, cz, room),
        // Roll a body's worth of sub-boss-tier loot for chest seeding.
        rollSubBossLootPile: () => _rollSubBossLootPile(),
        // Spawn The Gift item on the floor at world XZ. Returns false
        // if the item def is missing (defensive — should never happen
        // since theGift is in THROWABLE_DEFS).
        spawnTheGift: (x, z) => {
          const def = THROWABLE_DEFS && THROWABLE_DEFS.theGift;
          if (!def) return false;
          const item = makeThrowable(def);
          loot.spawnItem({ x, y: 0.4, z }, item);
          return true;
        },
        // "They Do Exist" reward — spawn an Elven Knife throwable on
        // the floor at world XZ.
        spawnElvenKnife: (x, z) => {
          const def = THROWABLE_DEFS && THROWABLE_DEFS.elvenKnife;
          if (!def) return false;
          const item = makeThrowable(def);
          loot.spawnItem({ x, y: 0.4, z }, item);
          return true;
        },
        // Active projectile list — Wishing Well + Path of Fire scan
        // this each tick to detect throwables landing in their volume.
        getProjectiles: () => projectiles.projectiles,
        // Tome encounter — hand the player a skill point.
        grantSkillPoint: (n = 1) => {
          const add = Math.max(1, n | 0);
          playerSkillPoints += add;
          _showSkillPointToast(add);
        },
        // Random non-mythic, non-artifact weapon for Target Practice.
        rollRandomWeapon: () => {
          const pool = tunables.weapons.filter(w =>
            !w.artifact && !w.mythic && w.rarity !== 'mythic');
          if (!pool.length) return null;
          return wrapWeapon(pool[Math.floor(Math.random() * pool.length)]);
        },
        // Awarded to the player wallet directly (Choices and
        // Consequences "kneeling man hands you 5000 gold" reward).
        awardPlayerCredits: (n) => {
          const amount = Math.max(0, n | 0);
          if (amount <= 0) return;
          playerCredits += amount;
          runStats.addCredits(amount);
          transientHudMsg(`+${amount}c`, 2.4);
        },
        // Persistent meta currency. Brethren encounter calls this to
        // pay out chips proportional to the gold value of a weapon
        // dropped at his feet. Restart penalty already applied inside.
        awardChips: (n) => awardPersistentChips(n),
        // Item gold-value lookup — Brethren encounter uses this to
        // convert a dropped weapon's sale price into chip payout.
        sellPriceFor: (item) => sellPriceFor(item),
        // Direct player heal — Priest encounter calls this on "yes".
        // No bleed/broken cures, since the priest's prayer is just HP.
        playerHeal: (amount) => { try { player.heal(Math.max(1, amount | 0)); } catch (_) {} },
        // Run-state read/write for cross-encounter counters. The
        // Priest encounter increments priestRefusals on each "no",
        // and flips hasDemonBear after the third refusal so the
        // priest stops respawning + the bear merchant can take the
        // toy. Survives across rooms; reset on run reset.
        runStats,
        // Live artifact collection — Curse Breaker reads this to gate
        // its dialog ("you wear no curse today") + decide whether the
        // 8000c spend actually does anything.
        artifacts,
        // Spawn a fresh Demon Bear toy at world XZ. Wraps the toy
        // def with stampItemDims so it lays out correctly in the
        // inventory grid like any other loot pickup.
        spawnDemonBear: (x, z) => {
          const def = TOY_DEFS && TOY_DEFS.demonBear;
          if (!def) return false;
          loot.spawnItem({ x, y: 0.4, z }, { ...def });
          return true;
        },
        // Travel Buddy reward — fresh Small Magical Pack instance with
        // its own durability object so two pickups don't share state.
        makeMagicalPack: () => {
          const def = ARMOR_DEFS && ARMOR_DEFS.backpack_magical;
          if (!def) return null;
          const item = { ...def };
          if (def.durability) item.durability = { ...def.durability };
          return item;
        },
        // The Crow — pick a random backpack with strictly more pockets
        // than the offered one, excluding encounter-only packs (e.g.
        // the Small Magical Pack from Travel Buddy).
        pickBiggerBackpack: (currentPockets) => {
          const cur = currentPockets | 0;
          const candidates = Object.values(ARMOR_DEFS).filter(d =>
            d && d.type === 'backpack' && !d._encounter && (d.pockets | 0) > cur);
          if (!candidates.length) return null;
          const pick = candidates[(Math.random() * candidates.length) | 0];
          const item = { ...pick };
          if (pick.durability) item.durability = { ...pick.durability };
          return item;
        },
        // Live in-flight projectile list. Hoop Dreams reads this each
        // tick to detect grenades passing through the basketball ring.
        activeProjectiles: () => projectiles.projectiles,
        // Stadium airhorn — three harsh blasts, ~1.5s total.
        airhorn: () => sfx.airhorn?.(),
        // Raw camera handle for spawning a flood of speech bubbles
        // (Hoop Dreams MVP celebration). Most encounters should use
        // ctx.spawnSpeech instead, which auto-applies the camera.
        camera,
        getKillCount: () => runStats.kills | 0,
        markEncounterComplete: (id) => {
          if (!id) return;
          _runCompletedEncounters.add(id);
          // Lifetime "ever finished" set — feeds the unseen-bias in
          // pickEncounterForLevel so brand-new encounters keep their
          // 5× selection weight until the player has actually done
          // them once across any run. Per-run set still gates repeats
          // within a single run.
          try { markEncounterDone(id); } catch (_) { /* prefs unavailable */ }
        },
        // Smoke puff at world XZ — used by Glass Case telegraph.
        // Cheap: a few additive grey spheres rising and fading.
        spawnPuffAt: (x, z) => _spawnSmokePuff(x, z),
        // Elite gunman spawn at world XZ tagged to the encounter
        // room. Uses the standard gunman manager.
        spawnEliteAt: (x, z, room) => _spawnEliteAtPos(x, z, room),
        // Spicy Arena boss — chunky obese melee with flee AI. Real
        // melee enemy so existing damage / hit / death paths apply;
        // the encounter polls .alive to spawn the relic on death.
        spawnSpicyBossAt: (x, z, room) => _spawnSpicyBossAt(x, z, room),
        // The Button — spawn a real random-rolled container at XZ.
        spawnRandomContainerAt: (x, z) => _spawnRandomContainerAt(x, z),
        // Sus — chest dressed up as a premium drop that's actually
        // junk-stuffed (with a small toy chance). See _spawnSusChestAt.
        spawnSusChest: (x, z) => _spawnSusChestAt(x, z),
        // The Lamp — cursed chest containing a single relic. The
        // player opens it like any other chest; auto-acquire on
        // pickup grants the relic + flags the curse.
        spawnCursedChest: (x, z, relicId) => _spawnCursedChestAt(x, z, relicId),
        // The Tailor — deterministic mastercraft promotion + full
        // durability heal. Returns the same item ref, mutated.
        mendToMastercraft: (item) => forceMastercraft(item),
        // Curse Breaker — strip a relic from the player's owned set
        // (e.g. brass_prisoner). Returns true if it was present and
        // removed; false otherwise.
        removeRelic: (id) => {
          const ok = artifacts.remove?.(id);
          if (ok) recomputeStats();
          return !!ok;
        },
        // Direct relic grant — used by the Curse Breaker to award
        // Djinn's Blessing on success. Bypasses the floor-pickup path
        // so there's nothing to walk over; the relic is added straight
        // to the owned set + a HUD toast fires.
        grantRelic: (id) => {
          const ok = artifacts.acquire?.(id);
          if (ok) {
            recomputeStats();
            const def = ARTIFACT_DEFS[id];
            const tag = def?.short ? ` — ${def.short}` : '';
            transientHudMsg(`RELIC ACQUIRED: ${def?.name || id}${tag}`, 5.0);
            sfx.uiAccept?.();
          }
          return !!ok;
        },
        // The Button alarm — spawn one summoned minion at XZ.
        spawnSummonedMinion: (x, z, room2) => _spawnSummonedMinionAt(x, z, room2),
        // Duck — drops the Unused Rocket Ticket as a junk pickup
        // (player trades it to the Bear Merchant for Rocket Shoes).
        spawnRocketTicketJunk: (x, z) => {
          const def = JUNK_DEFS && JUNK_DEFS.unusedRocketTicket;
          if (!def) return false;
          loot.spawnItem({ x, y: 0.4, z }, { ...def });
          return true;
        },
    });
    // Build the ctx once at spawn and cache it on the encounter
    // entry. tickEncounters / tryEncounterItemDrop then reuse the
    // same object — refreshing only the handful of fields that
    // actually change per-frame (playerSpeed, state, dropPos).
    // Was rebuilding the ctx (290-line literal + ~80 closures) for
    // every active encounter every frame; that was the single
    // largest GC contributor on later floors.
    const _spawnCtx = _ctxFactory();
    // Coop: per-encounter seed so def.spawn rolls (NPC pose offsets,
    // initial dialogue picks, encounter-chest loot rolls) land
    // identically on host + joiner. Without this, host's earlier
    // pickEncounterForLevel call consumed Math.random while joiner
    // popped from the forced queue and skipped that consumption,
    // shifting RNG state. Interaction-time state mutates separately
    // per peer (priest counter, shrine activation) — that's by
    // design: each player interacts with their own copy of enc.state.
    const _encSeed = ((_runSeed >>> 0)
      ^ Math.imul((level.index | 0) + 1, 0x9E3779B1)
      ^ Math.imul((r.id | 0) + 1, 0x85EBCA77)) >>> 0;
    const _state = _withRunSeed(_encSeed, () => def.spawn(scene, r, _spawnCtx)) || {};
    if (_state.npc && _state.npc.position && !_state._noCollider) {
      const np = _state.npc.position;
      _state._collider = level.addEncounterCollider(np.x, np.z, 0.65, 0.65, 1.6);
    }
    r._encounter = {
      def,
      state: _state,
      ctx: _spawnCtx,
      ctxFactory: _ctxFactory,    // kept for any path that needs a fresh build (rare)
    };
    // Per-run lock — once an encounter has been ASSIGNED to a room
    // this run, take it out of the candidate pool for subsequent
    // rooms / floors. Previously the lock fired only on completion,
    // so an unfinished spicy_challenge could re-spawn floor after
    // floor. The eligibility filter (encounter_tier.js) reads this
    // set for every encounter id regardless of oncePerSave.
    _runCompletedEncounters.add(def.id);
  }
  // Pity-timer roll — reset the bonus the moment an encounter ROOM
  // was rolled this level (even if no def was assignable and it got
  // demoted to combat). Player perceives "got an encounter chance" so
  // the next floor restarts at the 30% base.
  if (_rolledEncounterThisLevel) {
    runStats.encounterChanceBonus = 0;
  } else {
    // +20% per encounter-less floor, capped so total chance stays
    // under 95%. Floor 1 = 30%, 2 = 50%, 3 = 70%, 4 = 90%, then
    // pinned at the 95% ceiling until an encounter rolls.
    runStats.encounterChanceBonus = Math.min(0.65, (runStats.encounterChanceBonus || 0) + 0.20);
  }
  // After encounter visuals (which add fresh material variants —
  // braziers, fountains, dummies, tomes, etc.) land in scene, run
  // a renderer.compile pass so the first frame the player sees the
  // encounter room doesn't pay the shader-compile hitch on entry.
  // Called only if at least one encounter spawned this regen.
  try {
    if (level.rooms?.some?.(r => r._encounter)) {
      renderer.compile(scene, camera);
    }
  } catch (_) {}
  saveLevelStart();
}

// Drop a single masterwork-chest at the world position. Same machinery
// the level uses for its container scatter, but a guaranteed
// masterwork roll. Used by encounter rewards (Royal Emissary, etc.).
// Generic single-item encounter chest at world XZ. Mesh is built via
// the standard general-container pipeline so it visually reads as a
// chest, but the loot list is overridden with the caller's items
// (encounter rewards skip the random roll).
function _spawnEncounterChestAt(x, z, items) {
  const container = makeContainer('general', 's', level?.index | 0);
  container.loot = items.map(it => ({ ...it }));
  container.looted = false;
  const group = buildContainerMesh(container, x, 0, z);
  scene.add(group);
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
  scene.add(proxy);
  level.obstacles.push(proxy);
  level.containers.push({ container, group, x, z, r: 1.8 });
}

// Random-rolled container at the world XZ — same machinery the level
// scatter uses, but spawnable from encounters. Type and size both roll
// per the standard pickContainerType/pickContainerSize tables.
function _spawnRandomContainerAt(x, z) {
  const type = pickContainerType();
  const size = pickContainerSize(type);
  const container = makeContainer(type, size, level?.index | 0);
  const group = buildContainerMesh(container, x, 0, z);
  scene.add(group);
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
  scene.add(proxy);
  level.obstacles.push(proxy);
  level.containers.push({ container, group, x, z, r: 1.8 });
}

// The Button alarm — spawn one summoned melee minion at the world XZ
// tagged so it pays no XP/loot/credits, mirroring the necromant adds.
// Returns the minion record so the encounter tick can poll alive state.
function _spawnSummonedMinionAt(x, z, room) {
  const minion = melees.spawn(x, z, {
    tier: 'normal',
    roomId: room?.id,
    hpMult: 0.5, damageMult: 0.7,
    reactionMult: 1.0, aimSpreadMult: 1.0,
    aggression: 1.2, gearLevel: 0,
  });
  if (minion) {
    minion.summoned = true;
    minion.noDrops = true;
    minion.noXp = true;
  }
  return minion;
}

// Sus encounter — spawns a "premium" container that's actually full
// of junk, with a small chance of a single toy mixed in. Visually a
// general 'm' chest so the silhouette looks legit; loot list is
// overwritten so the player gets the rugpull experience the encounter
// is built around.
function _spawnSusChestAt(x, z) {
  const container = makeContainer('general', 'm', level?.index | 0);
  // Wipe the rolled loot and replace with a junk pile. 4-6 junk items
  // so the chest still looks fat when you open it. ~25% chance to
  // sneak a single random toy in among the junk (the only "real"
  // payout from the trade).
  container.loot.length = 0;
  const junkCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < junkCount; i++) {
    const j = randomJunk();
    if (j) container.loot.push(j);
  }
  if (Math.random() < 0.25) {
    const toy = randomToy();
    if (toy) container.loot.push(toy);
  }
  const group = buildContainerMesh(container, x, 0, z);
  scene.add(group);
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
  scene.add(proxy);
  level.obstacles.push(proxy);
  level.containers.push({ container, group, x, z, r: 1.8 });
}

// The Lamp encounter — chest that delivers the Brass Prisoner curse.
// Visually IDENTICAL to the masterwork chests it sits beside (same
// kind, size, colors) so the player can't tell which is the trap.
// `autoCurseRelic` flag triggers an immediate auto-grant on open —
// the curse is applied without a pickup item or loot-UI step, so the
// player's choice is "did I open the wrong one?" not "did I touch the
// wrong item in the loot panel?"
function _spawnCursedChestAt(x, z, relicId) {
  const container = makeContainer('masterwork', 's', level?.index | 0);
  container.loot.length = 0;
  container.autoCurseRelic = relicId;
  const group = buildContainerMesh(container, x, 0, z);
  scene.add(group);
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
  scene.add(proxy);
  level.obstacles.push(proxy);
  level.containers.push({ container, group, x, z, r: 1.8 });
}

function _spawnMasterworkChestAt(x, z) {
  const container = makeContainer('masterwork', 's', level?.index | 0);
  const group = buildContainerMesh(container, x, 0, z);
  scene.add(group);
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
  scene.add(proxy);
  level.obstacles.push(proxy);
  level.containers.push({ container, group, x, z, r: 1.8 });
}

// --- Encounter prompt panel ---------------------------------------
// Generic centered modal that any encounter can show via ctx.showPrompt.
// One panel reused for every prompt; closing it reactivates input.
const _encounterPromptEl = (() => {
  const el = document.createElement('div');
  el.id = 'encounter-prompt';
  Object.assign(el.style, {
    position: 'fixed', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    // Wider band + a max-height window so verbose pitches (Sus,
    // Curse Breaker, etc.) and long button labels don't clip. The
    // panel scrolls if a future encounter exceeds the cap.
    minWidth: '380px', maxWidth: 'min(640px, 92vw)',
    maxHeight: '82vh', overflowY: 'auto', boxSizing: 'border-box',
    background: 'linear-gradient(180deg, #181b21 0%, #0e1018 100%)',
    border: '1px solid #c9a87a', borderRadius: '4px',
    padding: '22px 26px', zIndex: '60',
    color: '#e8dfc8', display: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    boxShadow: '0 14px 50px rgba(0,0,0,0.85)',
  });
  // overflow-wrap on title/body keeps prose flowing inside the box;
  // letter-spacing + uppercase on the title made long names overhang
  // the right edge before this rule.
  el.innerHTML = `
    <div id="enc-prompt-title" style="font-size:18px;font-weight:700;letter-spacing:4px;color:#c9a87a;text-transform:uppercase;margin-bottom:10px;text-align:center;overflow-wrap:break-word;word-break:break-word;"></div>
    <div id="enc-prompt-body" style="font-size:13px;color:#bcb8a8;line-height:1.5;margin-bottom:18px;text-align:center;overflow-wrap:break-word;word-break:break-word;white-space:pre-wrap;"></div>
    <div id="enc-prompt-options" style="display:flex;flex-direction:column;gap:6px;"></div>
  `;
  document.body.appendChild(el);
  return el;
})();
let _activePrompt = null;     // { onClose }
function showEncounterPrompt({ title, body, options }) {
  _encounterPromptEl.querySelector('#enc-prompt-title').textContent = title || '';
  _encounterPromptEl.querySelector('#enc-prompt-body').textContent = body || '';
  const optsEl = _encounterPromptEl.querySelector('#enc-prompt-options');
  optsEl.innerHTML = '';
  for (const o of options || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = o.text;
    btn.disabled = o.enabled === false;
    Object.assign(btn.style, {
      padding: '10px 16px', fontSize: '12px',
      letterSpacing: '2px', textTransform: 'uppercase',
      background: btn.disabled ? 'rgba(80,80,80,0.18)' : 'rgba(125,167,200,0.15)',
      color: btn.disabled ? '#6a7280' : '#cbd6e2',
      border: '1px solid ' + (btn.disabled ? 'rgba(80,80,80,0.3)' : 'rgba(125,167,200,0.55)'),
      borderRadius: '3px',
      cursor: btn.disabled ? 'default' : 'pointer',
      fontFamily: 'inherit', fontWeight: '700',
      // Long button labels (e.g. "Buy chest (10,000c) — not enough")
      // need to wrap inside the panel rather than push the panel wider.
      whiteSpace: 'normal', overflowWrap: 'break-word', wordBreak: 'break-word',
      lineHeight: '1.35', textAlign: 'center',
    });
    if (!btn.disabled) {
      btn.addEventListener('click', () => {
        closeEncounterPrompt();
        if (o.onPick) o.onPick();
      });
    }
    optsEl.appendChild(btn);
  }
  _encounterPromptEl.style.display = 'block';
  _activePrompt = { };
  if (input?.clearMouseState) input.clearMouseState();
}
function closeEncounterPrompt() {
  _encounterPromptEl.style.display = 'none';
  _activePrompt = null;
  if (input?.clearMouseState) input.clearMouseState();
}
function isEncounterPromptOpen() { return !!_activePrompt; }

// Find the nearest encounter with an `interact()` method whose room
// the player is standing in. Returns the encounter or null.
function nearestInteractableEncounter() {
  if (!level || !level.rooms || !player) return null;
  const room = level.roomAt(player.mesh.position.x, player.mesh.position.z);
  if (!room || !room._encounter) return null;
  const ent = room._encounter;
  if (!ent.def.interact) return null;
  // Distance gate — the player must be standing near the encounter
  // anchor (disc / altar / NPC), not just anywhere in the room.
  // Without this gate, walking up to a keycard door at the far end
  // of an encounter room (Shrine, Fountain, etc.) re-opened the
  // encounter prompt instead of unlocking the door. The disc center
  // is stamped on every encounter spawn via _spawnFloorDisc.
  const s = ent.state;
  const anchor = s?.disc;
  if (anchor && typeof anchor.cx === 'number') {
    const dx = anchor.cx - player.mesh.position.x;
    const dz = anchor.cz - player.mesh.position.z;
    const INTERACT_R = 4.0;
    if (dx * dx + dz * dz > INTERACT_R * INTERACT_R) return null;
  }
  return ent;
}

// Indecision relic — every 10 seconds while the artifact is owned,
// grant one of the standard short-buff defs for 8 seconds. Slight
// gap between buffs is intentional — the artifact reads as "you
// rarely catch a quiet moment". Skips when the player is in a
// modal / dead.
const _INDECISION_BUFFS = [
  { id: 'combatStim', mods: { damageMult: 1.25 } },
  { id: 'adrenaline', mods: { moveSpeedMult: 1.45, staminaRegenMult: 1.4 } },
  { id: 'energy',     mods: { staminaRegenMult: 1.5 } },
  { id: 'morphine',   mods: { dmgReduction: 0.25 } },
  { id: 'regen',      mods: { healthRegenMult: 2.5 } },
];
let _indecisionT = 0;
function _tickIndecisionRelic(dt) {
  if (!artifacts.has('indecision')) return;
  if (paused || playerDead) return;
  _indecisionT += dt;
  if (_indecisionT >= 10) {
    _indecisionT = 0;
    const pick = _INDECISION_BUFFS[Math.floor(Math.random() * _INDECISION_BUFFS.length)];
    buffs.grant(pick.id, pick.mods, 8);
  }
}

// Choices and Consequences — leave-and-return state machine driven by
// per-room flags. We track which encounter rooms have ever been
// entered so the encounter's tick() can detect "first time leaving"
// vs "returning". Stored on room directly via room._encounter.state.
// No global runtime state needed; the encounter handles its own.

// Per-frame encounter tick — drives any animations / barks. Runs after
// the player + AI ticks so encounter state reads the current frame's
// player position.
function tickEncounters(dt) {
  if (!level || !level.rooms) return;
  for (const r of level.rooms) {
    if (!r._encounter) continue;
    const ent = r._encounter;
    // Encounter NPC death cleanup. The auto-collider hook in the
    // spawn pipeline registers state._collider; if the encounter
    // resolves (state.complete = true) AND the NPC has been hidden
    // / killed (visible === false OR alive === false), tear down the
    // collider so the player + AI aren't bumping into an invisible
    // box where the NPC used to stand. Idempotent — runs every frame
    // until the proxy is gone, then nulls the ref. Each encounter
    // can also stash extra colliders under sibling keys (matches
    // _perchCollider, _benchCollider, _wellCollider, etc.); sweep
    // those too whenever the encounter is complete.
    if (ent.state && ent.state.complete === true && !ent.state._collidersCleared) {
      const npcGone = !ent.state.npc
        || ent.state.npc.visible === false
        || ent.state.npc.alive === false;
      if (npcGone || ent.state._cleanupColliders) {
        const _drop = (key) => {
          const c = ent.state[key];
          if (c && level.removeEncounterCollider) {
            level.removeEncounterCollider(c);
            ent.state[key] = null;
          }
        };
        for (const k of Object.keys(ent.state)) {
          if (typeof k === 'string' && k.endsWith('Collider')) _drop(k);
        }
        if (ent.state._collider) _drop('_collider');
        // One-shot guard so the Object.keys sweep doesn't run every
        // frame for already-cleared encounters.
        ent.state._collidersCleared = true;
      }
    }
    // Perf early-out: once an encounter has fully resolved, skip
    // tick entirely. Saves ~60 calls/sec/encounter for completed
    // ones and lets us scale the encounter roster without paying
    // a tax for every prior visit.
    if (ent.state && (ent.state.complete === true || ent.state._frozen === true)) {
      // Some encounters animate after completion (e.g. Skull Pile
      // collapseT > 0). Honour an explicit needsTick flag.
      if (!ent.state.needsTick) continue;
    }
    if (ent.def.tick) {
      const ctx = ent.ctx;
      // Per-frame refresh: playerSpeed + state are the only fields
      // the tick path mutates; playerPos is a Vector3 reference that
      // auto-tracks player.mesh.position. Everything else (helpers,
      // roll functions, scene/level refs) is stable for the spawn's
      // lifetime.
      ctx.playerSpeed = lastPlayerInfo ? (lastPlayerInfo.speed || 0) : 0;
      ctx.state = ent.state;
      ent.def.tick(dt, ctx);
    }
  }
}

// Item-drop hook — called by the loot/inventory drop pipeline. If the
// drop position lies inside an encounter room and the encounter wants
// the item, it's consumed (not actually spawned) and the encounter's
// state advances. Returns true if consumed.
function tryEncounterItemDrop(item, x, z) {
  if (!level || !level.rooms || !item) return false;
  const room = level.roomAt(x, z);
  if (!room || !room._encounter) return false;
  const ent = room._encounter;
  if (!ent.def.onItemDropped) return false;
  const ctx = ent.ctx;
  ctx.playerSpeed = lastPlayerInfo ? (lastPlayerInfo.speed || 0) : 0;
  ctx.state = ent.state;
  // Drop position — encounters that gate on a sub-region (wishing
  // well disc, etc.) read this. World XZ at the drop point.
  ctx.dropPos = { x, z };
  const result = ent.def.onItemDropped(item, ctx);
  if (!result) return false;
  if (result.complete) {
    if (ent.def.oncePerSave) {
      _runCompletedEncounters.add(ent.def.id);
      try { markEncounterDone(ent.def.id); } catch (_) { /* prefs unavailable */ }
    }
    // Forced-followup queue — encounter requested a continuation in
    // the next 1-2 floors. Fires once per completion. The queue is
    // persistent (prefs) so a save/load mid-thread doesn't drop it.
    if (ent.def.forceFollowup && ent.def.forceFollowup.id) {
      const floors = Math.max(1, ent.def.forceFollowup.floors | 0 || 1);
      try { queueEncounterFollowup(ent.def.forceFollowup.id, floors); }
      catch (_) { /* prefs may be unavailable in private mode */ }
    }
  }
  return !!result.consume;
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
const _tmpEndPt = new THREE.Vector3();
const _tmpAimCenter = new THREE.Vector3();
const _rotatedDir = new THREE.Vector3();
const _muzzleWorldTmp = new THREE.Vector3();
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
// Restart-snapshot stack — most recent first. Capped at MAX_RESTART_SLOTS;
// older entries fall off the end. Restart Level defaults to slot 0 (newest);
// the death-screen slot picker exposes [0..n-1] so you can rewind further
// when iterating as a dev tool. `levelStartSnapshot` is kept as a thin
// alias for the most-recent slot so legacy reads keep working.
const MAX_RESTART_SLOTS = 8;
const _levelStartSnapshots = [];
let levelStartSnapshot = null;
let _activeRestartSlot = 0;

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
  const snap = {
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
  // Push to head, trim tail. Most-recent is always slot 0.
  _levelStartSnapshots.unshift(snap);
  if (_levelStartSnapshots.length > MAX_RESTART_SLOTS) {
    _levelStartSnapshots.length = MAX_RESTART_SLOTS;
  }
  levelStartSnapshot = snap;
  _refreshRestartSlotsUI();
}

// Death-screen restart-slot picker — one button per stacked snapshot,
// labeled with that snapshot's floor number. Clicking selects the slot
// (highlighted) so the next "Restart Level" press rewinds to that
// floor. Defaults to slot 0 (newest) on each death.
function _refreshRestartSlotsUI() {
  const root = document.getElementById('death-slots');
  if (!root) return;
  root.innerHTML = '';
  if (_levelStartSnapshots.length <= 1) return;   // no picker needed for a single slot
  const label = document.createElement('div');
  label.textContent = 'RESTART FROM:';
  Object.assign(label.style, {
    fontSize: '10px', letterSpacing: '1.2px', color: '#9b8b6a',
    width: '100%', textAlign: 'center', marginBottom: '2px',
  });
  root.appendChild(label);
  _levelStartSnapshots.forEach((snap, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `F${(snap.levelIndex | 0) + 1}`;
    const isActive = idx === _activeRestartSlot;
    Object.assign(btn.style, {
      background: isActive ? '#3a1520' : '#1a1d24',
      border: `1px solid ${isActive ? '#cf5a5a' : '#4a505a'}`,
      color: isActive ? '#f2c060' : '#c9a87a',
      padding: '4px 10px', borderRadius: '3px',
      font: 'inherit', fontSize: '11px', letterSpacing: '1px',
      cursor: 'pointer', textTransform: 'uppercase',
    });
    btn.addEventListener('click', () => {
      _activeRestartSlot = idx;
      _refreshRestartSlotsUI();
    });
    root.appendChild(btn);
  });
}
function restoreFromSnapshot(slotIdx = 0) {
  const s = _levelStartSnapshots[Math.max(0, slotIdx | 0)] || levelStartSnapshot;
  if (!s) return;
  resetRunState();
  // Drop snapshots ahead of the chosen slot — restoring back to floor
  // N invalidates the floor-N+1 / N+2 entries since you're rewinding
  // past them. Keep the chosen slot at index 0.
  if (slotIdx > 0) {
    _levelStartSnapshots.splice(0, slotIdx);
    levelStartSnapshot = _levelStartSnapshots[0] || null;
  }
  playerCredits = s.credits;
  playerSkillPoints = s.skillPoints;
  playerLevel = s.charLevel;
  playerXp = s.xp;
  skills.levels = { ...s.skills };
  classMastery.xp = { ...s.classXp };
  classMastery.fillMissing();
  specialPerks.unlocked = new Set(s.specialPerks || []);
  _refreshSkillPointPip();
  skillTree.levels = { ...(s.skillTree || {}) };
  // Relics are sticky across restart — the player's current owned set
  // is unioned with the snapshot's, so any relic picked up since the
  // checkpoint survives the rewind. Restart is a dev tool right now;
  // losing relics on rewind makes it useless for testing them.
  const restoredRelics = new Set(s.artifacts || []);
  for (const id of artifacts.owned) restoredRelics.add(id);
  artifacts.owned = restoredRelics;
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
  // recompute + apply BEFORE restoring full health so the snap reads
  // the correct maxHealth (Trainer upgrades, Pain mace 0.5× max, etc.)
  recomputeStats();
  player.applyDerivedStats(derivedStats);
  player.restoreFullHealth();
  onInventoryChanged();
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

// Dev key — F4 dumps render-pipeline state to the console. Targets
// the "world goes black but gameplay continues" class of bug: prints
// WebGL context status, renderer state, camera position, scene
// summary, lighting intensities, postFx + LoS pipeline flags, and
// the tunable values that drive lighting. Copy/paste the output when
// reporting; "what's set to zero" is usually the smoking gun.
window.addEventListener('keydown', (ev) => {
  if (ev.code !== 'F4') return;
  ev.preventDefault();
  try {
    const ctxLost = !!_ctxLost;
    const rt = renderer.getRenderTarget();
    const sceneChildren = scene.children.length;
    const lightCount = scene.children.filter(o => o.isLight).length;
    const auraLight = player?.mesh?.userData?.auraLight;
    const dump = {
      timestamp: new Date().toISOString(),
      ctxLost,
      renderer: {
        currentRenderTarget: rt ? `RenderTarget(${rt.width}x${rt.height})` : 'canvas',
        autoClear: renderer.autoClear,
        info: {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          frame: renderer.info.render.frame,
        },
      },
      camera: {
        pos: {
          x: +camera.position.x.toFixed(2),
          y: +camera.position.y.toFixed(2),
          z: +camera.position.z.toFixed(2),
        },
        type: camera.isOrthographicCamera ? 'ortho' : 'persp',
        bounds: camera.isOrthographicCamera
          ? { l: +camera.left.toFixed(1), r: +camera.right.toFixed(1),
              t: +camera.top.toFixed(1),  b: +camera.bottom.toFixed(1) }
          : null,
      },
      player: player?.mesh ? {
        pos: {
          x: +player.mesh.position.x.toFixed(2),
          y: +player.mesh.position.y.toFixed(2),
          z: +player.mesh.position.z.toFixed(2),
        },
        visible: player.mesh.visible,
        dead: !!playerDead,
      } : null,
      scene: {
        children: sceneChildren,
        lights: lightCount,
        background: scene.background?.getHexString
          ? `#${scene.background.getHexString()}` : null,
        fog: scene.fog
          ? { type: scene.fog.isFogExp2 ? 'exp2' : 'linear',
              color: `#${scene.fog.color.getHexString()}`,
              density: +(scene.fog.density ?? 0).toFixed(4) }
          : null,
      },
      lighting: {
        // Current live values driving the scene. Compare against
        // tunables.lighting if anything looks off.
        keyIntensity:   keyLight?.intensity ?? null,
        fillIntensity:  fillLight?.intensity ?? null,
        rimIntensity:   rimLight?.intensity ?? null,
        hemiIntensity:  hemiLight?.intensity ?? null,
        playerAuraInt:  auraLight?.intensity ?? null,
        playerAuraDist: auraLight?.distance ?? null,
      },
      tunablesLighting: { ...(tunables.lighting || {}) },
      postFx: {
        active: !!qualityFlags.postFx,
        uLosOn:    postFx?.finisher?.uniforms?.uLosOn?.value ?? null,
        uLosDark:  postFx?.finisher?.uniforms?.uLosDark?.value ?? null,
        uLosSoft:  postFx?.finisher?.uniforms?.uLosSoft?.value ?? null,
        vignette:  postFx?.finisher?.uniforms?.uStrength?.value ?? null,
        chroma:    postFx?.finisher?.uniforms?.uChroma?.value ?? null,
        grain:     postFx?.finisher?.uniforms?.uGrain?.value ?? null,
      },
      losMask: losMask ? {
        textureUuid: losMask.texture?.uuid?.slice(0, 8) ?? null,
      } : null,
      modal: {
        inventory:  inventoryUI?.visible ?? false,
        gameMenu:   !!gameMenuUI?.isOpen?.(),
        shop:       !!shopUI?.isOpen?.(),
        loot:       !!lootUI?.isOpen?.(),
        customize:  !!customizeUI?.isOpen?.(),
        perk:       !!perkUI?.isOpen?.(),
        mainMenu:   !!mainMenuUI?.isOpen?.(),
        paused:     !!paused,
      },
      qualityFlags: { ...qualityFlags },
      localStorageKeys: Object.keys(localStorage).filter(k =>
        k.startsWith('tacticalrogue') || k.startsWith('tunables')),
    };
    console.log('=== RENDER DIAG (F4) ===');
    console.log(JSON.stringify(dump, null, 2));
    console.log('=== END RENDER DIAG ===');
    transientHudMsg?.('render diag → console', 1.2);
  } catch (e) {
    console.warn('render diag failed:', e);
  }
});

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
let lastAimZone = null;       // 'head' / 'torso' / 'leg' / 'arm' / null
let paused = false;    // true while a modal (skill pick) is open
let extractPending = false;
// Coop dual-opt-in extract — true while local player is standing in
// the exit zone. Broadcast every pos tick (xt bit). Host only fires
// advanceFloor when this AND every joiner ghost's inExit bit are
// true. Joiner only sets the bit + waits for the host's level-seed.
let _localInExit = false;

// Mega-boss handle — non-null only on milestone floors (10, 15, 20, …).
// Allocated in regenerateLevel after `level.generateMegaArena()` runs.
let megaBoss = null;

let derivedStats = BASE_STATS();
let lastHpRatio = 1;  // updated each tick for perks that need mid-callback HP
// Per-run shrine HP bonus (cleared on death). The first shrine tier
// adds +5 max HP for the rest of the run; this folds into the
// derivedStats.maxHealthBonus during recomputeStats.
let shrineHpBonus = 0;
// Per-run Gift sacrifice (cleared on death). Each Gift use deducts 10
// from the player's max HP via this counter; folded as a NEGATIVE
// maxHealthBonus in recomputeStats. Floored so max HP can never drop
// below 1 — the throw-block check fires before the count would be
// large enough to wrap.
let giftSacrificeHp = 0;
// Stockpiled "next shop reroll" tokens — Fortune Teller can grant
// these. ShopUI consumes one when the player hits Reroll, bypassing
// the once-per-visit gate (and the unlock requirement).
let pendingShopRerolls = 0;

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
// --- Per-shot bloom (recoil-spread accumulator) -------------------------
// 0..1 inflation factor pumped on every fire, decayed every tick. Spread
// = baseSpread * (1 + _shotBloom * BLOOM_MAX_MULT). At full bloom the
// shot is 3.5× the weapon's base spread — sustained mag-dump becomes
// genuinely inaccurate. Recovery is fast enough that a disciplined 2-3
// shot burst followed by a beat barely pays any tax.
//
// Djinn's Blessing — spectral orb that orbits the player and fires
// a parallel shot every time the player fires. Lazy-init on first
// frame after the relic is owned; despawns + disposes if the relic
// is ever removed. Position is updated each tick in _tickDjinnOrb.
let _djinnOrb = null;
let _djinnOrbAngle = 0;

// First-shot tighten: when bloom is below FIRST_SHOT_THRESHOLD, the
// shot is multiplied by FIRST_SHOT_TIGHTEN — the very first round from
// a cold trigger lands tighter than the per-weapon baseline.
let _shotBloom = 0;
const BLOOM_MAX_MULT = 2.5;            // bloom of 1.0 → spread × 3.5
const BLOOM_DECAY_PER_SEC = 1.2;       // full recovery in ~0.83s of pause
const FIRST_SHOT_THRESHOLD = 0.05;
const FIRST_SHOT_TIGHTEN = 0.75;       // 25% tighter on a cold trigger
// Per-class accumulator. Tuned so a 3-round pistol burst lands at ~0.48
// bloom (clears in <0.5s pause); SMG 5-round burst lands at ~0.50;
// shotgun double-tap lands at ~0.6; sniper single shot at ~0.45 (and
// the slow RoF means full recovery before the next round). LMGs add
// little here because the existing _lmgHeldT system already governs
// their sustained-fire spread.
const BLOOM_PER_SHOT_BY_CLASS = {
  pistol:  0.16,
  smg:     0.10,
  rifle:   0.13,
  shotgun: 0.30,
  sniper:  0.45,
  lmg:     0.07,
  exotic:  0.10,
  flame:   0.04,
};
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
// Flawless boundary tracker — when the player crosses the full-HP
// threshold (either heal-to-full or first damage tick after full),
// the Flawless perk's conditional bundle has to flip on or off, which
// means re-running recomputeStats. Tracked at module scope so the
// player tick can detect transitions cheaply.
let _flawlessAtFull = false;
// Trainer (Recruiter) unlocks — marks-spent permanent buffs the
// player owns. The UI side has labels + costs; this side has the
// actual stat effects. Storage key + def list are kept stable so
// any saved unlocks survive future Trainer-tab edits.
function _applyTrainerUnlocks(s) {
  const owned = getRecruiterUnlocks();
  if (!owned || !owned.size) return;
  const T = BALANCE.trainer;
  // Helper closures — read each tier's tuning from BALANCE.trainer
  // and apply the matching stat field. Adding a new tier is one
  // entry in balance.js + one line here.
  const flatHp     = (id, key) => { if (owned.has(id)) s.maxHealthBonus    = (s.maxHealthBonus    || 0) + (T[id]?.[key] || 0); };
  const flatStam   = (id, key) => { if (owned.has(id)) s.maxStaminaBonus   = (s.maxStaminaBonus   || 0) + (T[id]?.[key] || 0); };
  const flatCrit   = (id, key) => { if (owned.has(id)) s.critChance        = (s.critChance        || 0) + (T[id]?.[key] || 0); };
  const flatDelay  = (id, key) => { if (owned.has(id)) s.healthRegenDelayBonus = (s.healthRegenDelayBonus || 0) + (T[id]?.[key] || 0); };
  const multAdd    = (id, key, field) => { if (owned.has(id)) s[field] = (s[field] || 1) * (1 + (T[id]?.[key] || 0)); };
  const multScale  = (id, key, field) => { if (owned.has(id)) s[field] = (s[field] || 1) * (T[id]?.[key] ?? 1); };

  // Vitality — flat HP.
  flatHp('vit_1', 'maxHpBonus'); flatHp('vit_2', 'maxHpBonus'); flatHp('vit_3', 'maxHpBonus');
  flatHp('vit_4', 'maxHpBonus'); flatHp('vit_5', 'maxHpBonus');

  // Endurance — multiplicative stamina-regen add.
  multAdd('end_1', 'staminaRegenAdd', 'staminaRegenMult');
  multAdd('end_2', 'staminaRegenAdd', 'staminaRegenMult');
  multAdd('end_3', 'staminaRegenAdd', 'staminaRegenMult');
  multAdd('end_4', 'staminaRegenAdd', 'staminaRegenMult');

  // Conditioning — flat max stamina.
  flatStam('stam_1', 'maxStaminaBonus'); flatStam('stam_2', 'maxStaminaBonus'); flatStam('stam_3', 'maxStaminaBonus');

  // Composure — stagger duration multiplier (each tier multiplies in).
  multScale('comp_1', 'staggerDurationMult', 'staggerDurationMult');
  multScale('comp_2', 'staggerDurationMult', 'staggerDurationMult');
  multScale('comp_3', 'staggerDurationMult', 'staggerDurationMult');

  // Quick Hands — reload speed mult.
  multAdd('reload_1', 'reloadSpeedAdd', 'reloadSpeedMult');
  multAdd('reload_2', 'reloadSpeedAdd', 'reloadSpeedMult');
  multAdd('reload_3', 'reloadSpeedAdd', 'reloadSpeedMult');

  // Marksmanship — spread mult (compounds; <1 tightens).
  multScale('aim_1', 'spreadMult', 'rangedSpreadMult');
  multScale('aim_2', 'spreadMult', 'rangedSpreadMult');
  multScale('aim_3', 'spreadMult', 'rangedSpreadMult');

  // Eye for Detail — flat crit chance.
  flatCrit('crit_1', 'critChanceBonus'); flatCrit('crit_2', 'critChanceBonus');

  // Footwork — move speed mult.
  multAdd('move_1', 'moveSpeedAdd', 'moveSpeedMult');
  multAdd('move_2', 'moveSpeedAdd', 'moveSpeedMult');

  // Scavenger — credit-drop mult.
  multAdd('carry_1', 'creditDropAdd', 'creditDropMult');
  multAdd('carry_2', 'creditDropAdd', 'creditDropMult');

  // Field Recovery — health regen rate + delay shave.
  multAdd('regen_1', 'healthRegenAdd', 'healthRegenMult');
  multAdd('regen_2', 'healthRegenAdd', 'healthRegenMult');
  multAdd('regen_3', 'healthRegenAdd', 'healthRegenMult');
  multAdd('regen_4', 'healthRegenAdd', 'healthRegenMult');
  // Delay bonus is subtractive — store as positive, the regen tick
  // reads `delay -= s.healthRegenDelayBonus`. flatDelay adds the
  // BALANCE value (positive seconds) into the bonus accumulator.
  // Legacy `regen_delay` id maps onto the first tier of the new
  // `regen_delay_1/2` track to preserve save-compat.
  flatDelay('regen_delay',   'healthRegenDelayBonus');
  flatDelay('regen_delay_1', 'healthRegenDelayBonus');
  flatDelay('regen_delay_2', 'healthRegenDelayBonus');

  // Plate Carrier — flat ballistic resist add (clamped at 0.7 in damagePlayer).
  const flatBallistic = (id) => { if (owned.has(id)) s.ballisticResist = (s.ballisticResist || 0) + (T[id]?.ballisticResist || 0); };
  flatBallistic('ballistic_1'); flatBallistic('ballistic_2'); flatBallistic('ballistic_3');

  // Asbestos Lung — flat fire resist add (clamped at 0.95 in damagePlayer).
  const flatFire = (id) => { if (owned.has(id)) s.fireResist = (s.fireResist || 0) + (T[id]?.fireResist || 0); };
  flatFire('fire_1'); flatFire('fire_2'); flatFire('fire_3');

  // Iron Will — flat dmg-reduction add (clamped at 0.7 in damagePlayer).
  const flatDmgRed = (id) => { if (owned.has(id)) s.dmgReduction = (s.dmgReduction || 0) + (T[id]?.dmgReductionAdd || 0); };
  flatDmgRed('will_1'); flatDmgRed('will_2'); flatDmgRed('will_3');

  // Cleaver — multiplicative melee damage.
  multAdd('melee_1', 'meleeDmgAdd', 'meleeDmgMult');
  multAdd('melee_2', 'meleeDmgAdd', 'meleeDmgMult');
  multAdd('melee_3', 'meleeDmgAdd', 'meleeDmgMult');

  // Heavy Hitter — multiplicative knockback.
  multAdd('knock_1', 'knockbackAdd', 'knockbackMult');
  multAdd('knock_2', 'knockbackAdd', 'knockbackMult');

  // Killshot — flat headshot multiplier add.
  const flatHead = (id) => { if (owned.has(id)) s.headMultBonus = (s.headMultBonus || 0) + (T[id]?.headMultAdd || 0); };
  flatHead('head_1'); flatHead('head_2'); flatHead('head_3');

  // Sight Discipline — multiplicative ADS speed.
  multAdd('ads_1', 'adsSpeedAdd', 'adsSpeedMult');
  multAdd('ads_2', 'adsSpeedAdd', 'adsSpeedMult');

  // Quartermaster — flat pocket-slot count add.
  const flatPockets = (id) => { if (owned.has(id)) s.pocketsBonus = (s.pocketsBonus || 0) + (T[id]?.pocketsAdd || 0); };
  flatPockets('pockets_1'); flatPockets('pockets_2'); flatPockets('pockets_3');

  // Bandolier — flat throwable charge bonus.
  const flatThrow = (id) => { if (owned.has(id)) s.throwableChargeBonus = (s.throwableChargeBonus || 0) + (T[id]?.throwableChargeAdd || 0); };
  flatThrow('throw_1'); flatThrow('throw_2');

  // Ghost Step — multiplicative stealth detection mult (compounds).
  multScale('stealth_1', 'stealthMult', 'stealthMult');
  multScale('stealth_2', 'stealthMult', 'stealthMult');
  multScale('stealth_3', 'stealthMult', 'stealthMult');

  // Backpedal Drill — additive backpedal relief (clamped at 1 in player.js).
  const flatBackpedal = (id) => { if (owned.has(id)) s.backpedalRelief = (s.backpedalRelief || 0) + (T[id]?.backpedalReliefAdd || 0); };
  flatBackpedal('backpedal_1'); flatBackpedal('backpedal_2');

  // Steady Aim — multiplicative sway dampener (compounds; <1 tightens).
  multScale('sway_1', 'swayMult', 'swayMult');
  multScale('sway_2', 'swayMult', 'swayMult');
}

function recomputeStats() {
  derivedStats = BASE_STATS();
  // Expose level depth so ui_shop's relic price ramp can read it
  // without threading level through every priceFor call site.
  if (typeof window !== 'undefined') window.__levelIndex = (level && level.index) | 0;
  skills.applyTo(derivedStats);
  inventory.applyTo(derivedStats);
  specialPerks.applyTo(derivedStats);           // legacy (kept for compat)
  skillTree.applyTo(derivedStats, currentWeapon());
  artifacts.applyTo(derivedStats);
  buffs.applyTo(derivedStats);
  _applyTrainerUnlocks(derivedStats);
  // Flawless perk — conditional 10% bundle while at full HP. Reads
  // the live player info if available (so equipping the perk while
  // at full HP applies the bundle on the next recompute), otherwise
  // falls back to the boundary tracker that the player tick maintains.
  let _atFull = _flawlessAtFull;
  if (derivedStats.flawlessActive && lastPlayerInfo && lastPlayerInfo.maxHealth > 0) {
    _atFull = lastPlayerInfo.health >= lastPlayerInfo.maxHealth - 0.001;
    _flawlessAtFull = _atFull;
  }
  if (derivedStats.flawlessActive && _atFull) {
    derivedStats.moveSpeedMult    *= 1.10;
    derivedStats.rangedDmgMult    *= 1.10;
    derivedStats.meleeDmgMult     *= 1.10;
    derivedStats.reloadSpeedMult  *= 1.10;
    derivedStats.fireRateMult     *= 1.10;
    // Hip-fire accuracy — lower spread = more accurate, hence the
    // ~0.91 multiplier (1/1.10) rather than +1.10.
    derivedStats.hipSpreadOnlyMult *= (1 / 1.10);
    derivedStats.staminaRegenMult *= 1.10;
  }
  // Shrine bonus folds in at the end so it survives later sources
  // overwriting maxHealthBonus. Gift sacrifice is subtractive but
  // also clamped — floor the resulting maxHealthBonus so the player's
  // computed max HP never drops below 1.
  derivedStats.maxHealthBonus = (derivedStats.maxHealthBonus || 0) + shrineHpBonus - giftSacrificeHp;
  // tunables.player.maxHealth is the base (>= 10). The applyDerivedStats
  // call already takes Math.max(10, base + bonus) — that lower clamp
  // would silently cap the gift sacrifice at -90. We want the player
  // to actually feel max-HP loss past that point, so override with a
  // hard floor of 1 by under-clamping bonus to (1 - base) at minimum.
  const baseMax = tunables.player.maxHealth;
  if (baseMax + derivedStats.maxHealthBonus < 1) {
    derivedStats.maxHealthBonus = 1 - baseMax;
  }
  // Starter buff — Energy Drink. +20% move speed for the first 3
  // floors of the run. Decays via _tickStarterBuffsOnLevelChange.
  if (_starterBuffSpeedFloors > 0) {
    derivedStats.moveSpeedMult *= 1.20;
  }
  // Starter buff — Adrenaline. +30% reload speed for the first floor.
  if (_starterBuffReloadFloors > 0) {
    derivedStats.reloadSpeedMult = (derivedStats.reloadSpeedMult || 1) * 1.30;
  }
  // Active contract `playerDamageDealtMult` — Glass Cannon and
  // similar contracts crank player outgoing damage up alongside
  // damage taken. Folded into the universal ranged + melee mults so
  // every damage path inherits it without touching individual sites.
  // Default 1 = neutral when no contract / standard tier active.
  const _contractDealt = window.__activeModifiers?.()?.playerDamageDealtMult || 1;
  if (_contractDealt !== 1) {
    derivedStats.rangedDmgMult *= _contractDealt;
    derivedStats.meleeDmgMult  *= _contractDealt;
  }
  // Soft caps applied AFTER all sources roll up — prevents stack-stack
  // exploits flagged in the rebalance review (movespeed in particular
  // could pile to ~1.7×+ with artifact + Swift + class perks).
  if (derivedStats.moveSpeedMult > 1.7) derivedStats.moveSpeedMult = 1.7;
  // Melee damage multiplier ceiling — Reaper / Berserker / class-tree
  // stacks were producing ~2.8×. Cap at 2.5×.
  if (derivedStats.meleeDmgMult > 2.5) derivedStats.meleeDmgMult = 2.5;
  // Equipped-weapon `equipMods` — mythic-tier "Pain" mace uses this
  // to grant 66% melee lifesteal + 0.5× max HP. lifestealMeleePercent
  // adds to whatever skills/perks already contribute. maxHealthMult
  // applies as a final-pass scalar AFTER all maxHealthBonus sources
  // have rolled up, so a 0.5× equip-mod halves the player's actual
  // working max HP instead of just the base.
  const _eqW = currentWeapon();
  const _em = _eqW && _eqW.equipMods;
  if (_em) {
    if (typeof _em.lifestealMeleePercent === 'number') {
      derivedStats.lifestealMeleePercent =
        (derivedStats.lifestealMeleePercent || 0) + _em.lifestealMeleePercent;
    }
    if (typeof _em.maxHealthMult === 'number' && _em.maxHealthMult !== 1) {
      const baseMax2 = tunables.player.maxHealth;
      const finalMax = baseMax2 + (derivedStats.maxHealthBonus || 0);
      const target = Math.max(1, Math.round(finalMax * _em.maxHealthMult));
      derivedStats.maxHealthBonus = target - baseMax2;
    }
  }
  // Expose to window AFTER all modifiers have applied (skills, perks,
  // artifacts, equipment, buffs, trainer unlocks, contract mults,
  // equip-mods). Reading window.__derivedStats during recompute used
  // to return the bag mid-fill; publishing at the end means external
  // readers (Inventory.applyRepairKit, durability HUD) always see the
  // final values for the frame.
  if (typeof window !== 'undefined') window.__derivedStats = derivedStats;
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
  // Exclude pactReward weapons (Pain) and encounterOnly weapons
  // (Zipline Gun) — those are quest/encounter-locked and shouldn't
  // drop from boss-kill mythic rolls.
  const pool = tunables.weapons.filter(w => w.rarity === 'mythic'
    && !w.artifact && !w.pactReward && !w.encounterOnly);
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
  const value = inGunmen ? tunables.xp.killValue.gunman : tunables.xp.killValue.melee;
  // Coop attribution: rpc-shoot wraps applyHit in a thread-local that
  // names the killing joiner. When set, route the XP via RPC instead
  // of awarding host-locally — same instancing model as loot drops.
  // The joiner's rpc-grant-xp handler runs awardXp on their side.
  const claimer = (typeof window !== 'undefined') ? window.__coopCurrentClaimer : null;
  if (claimer) {
    try {
      const t = getCoopTransport();
      if (t.isOpen && t.isHost) {
        t.send('rpc-grant-xp', { amount: value }, claimer);
        return;
      }
    } catch (_) { /* fall through to local */ }
  }
  awardXp(value);
}
function syncInventoryIfChanged() {
  if (inventory.version !== lastInventoryVersion) {
    lastInventoryVersion = inventory.version;
    onInventoryChanged();
    if (typeof renderActionBar === 'function') renderActionBar();
    if (typeof renderWeaponBar === 'function') renderWeaponBar();
    _statsDirty = true;
  }
}

// Apply (or refresh + stack) a burn DoT on an enemy. Each call adds
// one stack and refreshes the timer; per-tick damage in the enemy's
// own update loop multiplies by stack count, so longer fire exposure
// = bigger total DoT. Stacks reset when burnT drains to 0.
function applyBurnStack(target, duration) {
  if (!target || !target.alive) return;
  target.burnStacks = (target.burnStacks | 0) + 1;
  target.burnT = Math.max(target.burnT || 0, duration);
}
window.__applyBurnStack = applyBurnStack;

// Lazy stat-recompute. Was running every gameplay frame and walking
// every equipped item / perk / skill / artifact / buff in the apply
// chain — measurable GC + CPU contributor at 60Hz on top of all the
// gameplay work. Now gated behind `_statsDirty`: callers that mutate
// state mark dirty (equip change, buff grant/expire, level up, HP
// boundary cross, etc.) and the gameplay tick only recomputes when
// the flag is set. Existing direct `recomputeStats()` callers stay
// unchanged — they just clear the flag implicitly.
let _statsDirty = false;
function markStatsDirty() { _statsDirty = true; }
function recomputeStatsIfDirty() {
  if (_statsDirty) {
    recomputeStats();
    _statsDirty = false;
  }
}
// Wrap buffs.grant so every call site (there are many — bloodlust,
// indecision, red string, mastery procs, consumables…) marks the
// stats dirty without each call having to. Same for the explicit
// recomputeStats wrapper that runs the actual rebuild.
const _origBuffsGrant = buffs.grant.bind(buffs);
buffs.grant = function (id, mods, life) {
  _origBuffsGrant(id, mods, life);
  _statsDirty = true;
};
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
  _hittablesCache = [...dummies.hittables(), ...gunmen.hittables(), ...melees.hittables(), ...drones.hittables(), ..._allAssassinKnifeMeshes()];
  // Mega boss meshes — only present on mega-boss floors. The boss tags
  // every hit mesh with userData.owner = the boss instance + a
  // megaBoss flag so the player fire path can branch on it.
  if (megaBoss && megaBoss.alive) {
    _hittablesCache.push(...megaBoss.hittables());
  }
  // Fold in encounter hittables (e.g. glass-case panels). Each one
  // already carries userData.owner pointing to the encounter target,
  // and target.manager.applyHit dispatches the encounter trigger.
  if (level && level.rooms) {
    for (const r of level.rooms) {
      const enc = r._encounter;
      if (!enc || !enc.def.hittables) continue;
      const list = enc.def.hittables(enc.state);
      if (list && list.length) _hittablesCache.push(...list);
    }
  }
  _hittablesFrame = frameCounter;
  return _hittablesCache;
}

// Light grey smoke-puff at XZ — 6 additive spheres rising and fading
// over ~0.7s. Used by the Glass Case telegraph; cheap enough that
// firing 4 in one frame is fine.
function _spawnSmokePuff(x, z) {
  const count = 6;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = 0.10 + Math.random() * 0.20;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18 + Math.random() * 0.10, 6, 5),
      new THREE.MeshBasicMaterial({
        color: 0xa8a8b0, transparent: true, opacity: 0.55,
        depthWrite: false,
      }),
    );
    mesh.position.set(x + Math.cos(a) * r, 0.20, z + Math.sin(a) * r);
    scene.add(mesh);
    const drift = {
      vy: 0.8 + Math.random() * 0.5,
      dx: (Math.random() - 0.5) * 0.4,
      dz: (Math.random() - 0.5) * 0.4,
      life: 0.6 + Math.random() * 0.3, t: 0,
    };
    _smokePuffs.push({ mesh, drift });
  }
}
const _smokePuffs = [];
function _tickSmokePuffs(dt) {
  for (let i = _smokePuffs.length - 1; i >= 0; i--) {
    const p = _smokePuffs[i];
    p.drift.t += dt;
    p.mesh.position.x += p.drift.dx * dt;
    p.mesh.position.z += p.drift.dz * dt;
    p.mesh.position.y += p.drift.vy * dt;
    const k = Math.max(0, 1 - p.drift.t / p.drift.life);
    p.mesh.material.opacity = 0.55 * k;
    p.mesh.scale.setScalar(1 + (1 - k) * 1.3);
    if (p.drift.t >= p.drift.life) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      _smokePuffs.splice(i, 1);
    }
  }
}

// Build the in-flight visual for The Gift — a tiny crimson bear
// with two slate-grey devil horns. Replaces the default tinted
// sphere when projectiles.spawn receives a customBody. Cheap: 5
// meshes total, no shadow casting, geometry created per throw
// (rare event so allocation cost is irrelevant).
function _buildGiftBear() {
  const group = new THREE.Group();
  const furMat = new THREE.MeshBasicMaterial({ color: 0xb02828 });
  const hornMat = new THREE.MeshBasicMaterial({ color: 0x6a6a72 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101010 });
  // Body — squat oblong.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), furMat);
  body.scale.set(1, 0.85, 1);
  group.add(body);
  // Head — slightly forward + up.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), furMat);
  head.position.set(0, 0.18, -0.05);
  group.add(head);
  // Two ears (small cones) on top of the head.
  const ear = (sx) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), furMat);
    m.position.set(sx, 0.27, -0.05);
    return m;
  };
  group.add(ear(-0.07), ear(0.07));
  // Two grey devil horns — small cones angled outward + back.
  const horn = (sx) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.10, 6), hornMat);
    m.position.set(sx, 0.30, -0.06);
    m.rotation.z = sx > 0 ? -0.4 : 0.4;
    m.rotation.x = -0.2;
    return m;
  };
  group.add(horn(-0.06), horn(0.06));
  // Two black bead eyes.
  const eye = (sx) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), eyeMat);
    m.position.set(sx, 0.20, -0.13);
    return m;
  };
  group.add(eye(-0.04), eye(0.04));
  return group;
}

// Mirror clone — spawn a gunman or melee carrying the player's
// currently equipped weapon. Uses player.maxHealth as the clone's
// HP so it reads as fighting yourself. On death the clone drops a
// MASTERCRAFT version of one of the player's equipped weapons.
function _spawnMirrorClone(x, z, room) {
  const weapon = currentWeapon();
  if (!weapon) return null;
  // Mirror loadout: clone the equipped weapon exactly (preserve
  // attachments + rarity). The AI doesn't honour every player perk
  // but it'll still fire the same gun with the same dmg/spread.
  const cloneWeapon = JSON.parse(JSON.stringify(weapon));
  const opts = {
    tier: 'subBoss', roomId: room.id,
    hpMult: 1.0, damageMult: 1.0,
    reactionMult: 0.85, aimSpreadMult: 0.85,
    aggression: 1.0,
    variant: 'standard',
    gearLevel: (level?.index || 0),
  };
  let actor = null;
  if (weapon.type === 'melee') {
    actor = melees.spawn(x, z, opts);
  } else {
    actor = gunmen.spawn(x, z, cloneWeapon, opts);
  }
  if (actor) {
    // Pin the clone HP to the player's current max so this is a
    // mirror match in stamina too.
    const playerMax = playerMaxHealthCached || 100;
    actor.hp = playerMax;
    actor.maxHp = playerMax;
    // Aggressive on spawn — same drop-in feel as the ambush bosses.
    if (actor.state) {
      actor.state = (weapon.type === 'melee') ? 'chase' : 'alerted';
      actor.reactionT = 0.20;
    }
    // Stamp a callback hook for the encounter tick — when the
    // clone dies, the encounter spawns a mastercraft drop.
    actor.mirrorClone = true;
  }
  return actor;
}

// Build a sub-boss-tier loot pile. Used by Sleeping Boss's corner
// chest. Same shape as a sub-boss body's roll without the weapon
// (the boss in the room is the implied source of the weapon).
function _rollSubBossLootPile() {
  const items = [];
  // Always: one rare/epic weapon (sub-boss carry).
  const wpnPool = tunables.weapons.filter(w =>
    !w.artifact && !w.mythic && (w.rarity === 'rare' || w.rarity === 'epic'));
  if (wpnPool.length) {
    items.push(wrapWeapon(wpnPool[Math.floor(Math.random() * wpnPool.length)]));
  }
  // Gear: 1 rolled gear piece.
  const g = randomGear();
  items.push(withAffixes({
    ...g, rarity: 'rare',
    durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) },
  }));
  // Junk: 1 high-value rare junk.
  const rareJunk = ALL_JUNK.filter(j => j.rarity === 'rare' || j.rarity === 'epic');
  if (rareJunk.length) {
    items.push({ ...rareJunk[Math.floor(Math.random() * rareJunk.length)] });
  }
  // Maybe attachment.
  if (Math.random() < 0.18) items.push(rollAttachmentRarity({ ...ALL_ATTACHMENTS[Math.floor(Math.random() * ALL_ATTACHMENTS.length)] }));
  return items;
}

// Choices and Consequences — spawn the standoff pair. Both are
// hittable but completely passive (no AI tick, no firing). The
// encounter watches their HP each frame; whoever takes damage first
// dies and the other becomes invulnerable.
function _spawnCnCPair(cx, cz, room) {
  // Use the existing dummies system for hittable passive targets.
  // Both spawn with HP 1 so a single bullet from any weapon drops
  // either; encounter tick reads .alive each frame to detect the
  // first kill.
  const gunman = dummies.spawn(cx - 0.6, cz);
  gunman.hp = 1;
  gunman.cncRole = 'gunman';
  // Kneeler — visually compress the dummy by scaling its group down
  // to ~60% height so it reads as kneeling.
  const kneeler = dummies.spawn(cx + 0.6, cz);
  kneeler.hp = 1;
  kneeler.cncRole = 'kneeler';
  if (kneeler.group) kneeler.group.scale.set(1, 0.6, 1);
  return { gunman, kneeler };
}

// Spawn one elite gunman at world XZ for a given encounter room.
// Standard gunman manager + opts; the encounter handler treats the
// resulting kills as normal kills (XP, drops, room clearance).
// Spicy Arena boss — spawned by the spicy_arena encounter when the
// player exits a level wearing Shini's Burden. Uses the standard
// melee manager so damage / hit / death routing all just work; the
// archetype flag drives the flee AI override in melee_enemy.js.
function _spawnSpicyBossAt(x, z, room) {
  const opts = {
    tier: 'boss', roomId: room ? room.id : -1,
    hpMult: 1.0, damageMult: 1.0,
    reactionMult: 1.0, aimSpreadMult: 1.0,
    aggression: 1.0,
    variant: 'standard',
    archetype: 'spicy_boss',
    gearLevel: (level?.index || 0),
  };
  const e = melees.spawn(x, z, opts);
  if (e) {
    // Drop straight into CHASE so flee AI engages without an idle
    // bark or detection ramp — he's already running.
    e.state = 'chase';
    e.reactionT = 0;
  }
  return e;
}

function _spawnEliteAtPos(x, z, room) {
  const diff = difficultyScale();
  const opts = {
    tier: 'elite', roomId: room.id,
    hpMult: diff.hpMult, damageMult: diff.damageMult,
    reactionMult: diff.reactionMult,
    aimSpreadMult: diff.aimSpreadMult,
    aggression: diff.aggression,
    variant: 'standard',
    gearLevel: (level?.index || 0),
  };
  const weapon = pickWeaponForAI('standard');
  const g = gunmen.spawn(x, z, weapon, opts);
  if (g) {
    // Drop them into ALERTED so they engage the player without idle bark.
    g.state = 'alerted';
    g.reactionT = 0.20;
  }
  return g;
}

function resolveCollision(oldX, oldZ, newX, newZ, radius) {
  return level.resolveCollision(oldX, oldZ, newX, newZ, radius);
}

// Enemy movement resolver: walls first, then push away from the player so
// enemies can't overlap and flip the camera/aim.
//
// Doorway-stuck recovery: resolveCollision is a strict bisector — if the
// CURRENT position already overlaps an obstacle (knockback nudge into a
// wall, two enemies crowding a doorway, door collision changing state
// mid-frame), every axis test reverts to oldX/oldZ and the enemy can
// never move. Unstick the start position via level.unstickFrom first
// so the AI has somewhere clear to step from. Cheap O(walls) check
// per call, no-op when the enemy isn't stuck.
function enemyResolveCollision(oldX, oldZ, newX, newZ, radius) {
  let sx = oldX, sz = oldZ;
  if (level._collidesAt && level._collidesAt(sx, sz, radius)) {
    const fixed = level.unstickFrom(sx, sz, radius);
    sx = fixed.x; sz = fixed.z;
  }
  const wallRes = level.resolveCollision(sx, sz, newX, newZ, radius);
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
  return level.resolveCollision(sx, sz, pushX, pushZ, radius);
}

// Legacy aim resolution preserved verbatim. Toggled out of the live
// fire path by `tunables.aim.pixelMode`. Kept here so the change can
// be reverted without git archaeology — point resolveAim at this
// function (or flip the tunable) to roll back. The behavioural
// difference is downstream in fireOneShot: this function returns the
// same shape; the new mode only changes how spread is applied.
function resolveAim_legacy(muzzleWorld, crouching) {
  return _resolveAimRaycast(muzzleWorld, crouching);
}

function resolveAim(muzzleWorld, crouching) {
  return _resolveAimRaycast(muzzleWorld, crouching);
}

// Reusable scratch — head aim assist projects each enemy head into NDC
// every aim resolution call (60Hz at most), allocating these once.
const _headWorldScratch = new THREE.Vector3();
const _headNdcScratch = new THREE.Vector3();

// Find the enemy head closest to the cursor in screen space, within an
// asymmetric pixel radius. Bias is more generous ABOVE the head than
// to the sides — the silhouette boundary at the top of the cranium is
// the easiest pixel to brush past while trying to land a headshot.
// Returns { enemy, headWorld, distPx } or null.
function _findHeadAimAssist() {
  if (!input.hasAim) return null;
  const cfg = tunables.aim || {};
  if (cfg.headAssistEnabled === false) return null;
  const baseRadiusPx = cfg.headAssistRadiusPx ?? 28;
  const topBias = cfg.headAssistTopBias ?? 1.6;
  const cursor = input.mouseNDC;
  const halfW = window.innerWidth / 2;
  const halfH = window.innerHeight / 2;
  let best = null;
  let bestPxDist = Infinity;
  const candidates = [];
  for (const g of gunmen.gunmen) if (g.alive && g.rig?.head) candidates.push(g);
  for (const e of melees.enemies) if (e.alive && e.rig?.head) candidates.push(e);
  for (const c of candidates) {
    c.rig.head.getWorldPosition(_headWorldScratch);
    _headNdcScratch.copy(_headWorldScratch).project(camera);
    if (_headNdcScratch.z < -1 || _headNdcScratch.z > 1) continue;
    // Cursor → head delta in NDC, then converted to viewport pixels.
    // dyNdc > 0 = head is BELOW cursor (cursor sits above the head),
    // since NDC y points up.
    const dxNdc = _headNdcScratch.x - cursor.x;
    const dyNdc = _headNdcScratch.y - cursor.y;
    const dxPx = dxNdc * halfW;
    const dyPx = dyNdc * halfH;
    // Asymmetric ellipse: when cursor is above the head (dyNdc > 0),
    // shrink the effective dy so that side of the radius is bigger.
    const dyAdjusted = dyPx > 0 ? dyPx / topBias : dyPx;
    const distPx = Math.sqrt(dxPx * dxPx + dyAdjusted * dyAdjusted);
    if (distPx <= baseRadiusPx && distPx < bestPxDist) {
      bestPxDist = distPx;
      best = { enemy: c, headWorld: _headWorldScratch.clone(), distPx };
    }
  }
  return best;
}

// Rather than snapping to the dead-center of the enemy head, intersect the
// cursor ray with the horizontal plane at head height. This preserves the
// zone/owner benefit of head-assist while letting lateral cursor position
// still influence where the shot goes — feels like tracking, not lock-on.
// Falls back to head center only if the ray is nearly horizontal (t ≤ 0).
function _headAssistAimPoint(headAssist) {
  const ray = input.raycaster.ray;
  const headY = headAssist.headWorld.y;
  if (Math.abs(ray.direction.y) > 0.001) {
    const t = (headY - ray.origin.y) / ray.direction.y;
    if (t > 0) {
      return new THREE.Vector3(
        ray.origin.x + t * ray.direction.x,
        headY,
        ray.origin.z + t * ray.direction.z,
      );
    }
  }
  return headAssist.headWorld.clone();
}

function _resolveAimRaycast(muzzleWorld, crouching) {
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
  //
  // When crouching, skip low-cover obstacles entirely. The player can
  // shoot over them, so the cursor ray should resolve to whatever is
  // beyond the cover (enemy or floor plane), not the cover face.
  const enemyTargets = allHittables();
  const allWallTargets = level.solidObstacles();
  const wallTargets = crouching
    ? allWallTargets.filter(m => !m.userData.isLowCover)
    : allWallTargets;
  const enemyHits = input.raycaster.intersectObjects(enemyTargets, false);
  // Body-hit path — when the cursor's ray landed on an enemy body
  // part, return that hit DIRECTLY. The previous "upgrade to head if
  // within assist radius" branch hijacked too many body shots: the
  // head sits right above the body in screen space, the assist's
  // 30px radius almost always matched, and re-projecting the aim
  // onto the head-Y plane shifted the bullet's XZ enough to whiff
  // past the enemy entirely. Body hits stay body hits now; the
  // head-assist only recovers MISSED primary hits below.
  if (enemyHits.length > 0) {
    const h = enemyHits[0];
    return {
      point: h.point.clone(),
      zone: h.object.userData?.zone || null,
      owner: h.object.userData?.owner || null,
    };
  }
  // Primary raycast missed every body part. If the cursor is right
  // next to a head silhouette (within the assist radius), treat it as
  // an intended head shot and snap the aim point onto the head — keeps
  // pixel-aim spread tightening + zone bonus alive when the cursor is
  // clipping the very edge of the cranium.
  const headAssist = _findHeadAimAssist();
  if (headAssist) {
    return {
      point: _headAssistAimPoint(headAssist),
      zone: 'head',
      owner: headAssist.enemy,
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
    const dot = nx * _lightDir.x + nz * _lightDir.z;
    if (dot < halfCos) return;
    // Centerness — 0 at the cone edge, 1 at the exact center. Drives
    // the blind-spread scaling so flashlight aim degrades harder when
    // the player keeps the beam dead-on.
    const centerness = (dot - halfCos) / Math.max(0.0001, 1 - halfCos);
    enemy.blindT = Math.max(enemy.blindT || 0, lightAtt.blindDuration || 1.2);
    // Spread multiplier scales with centerness — base value at edge,
    // up to 2× base at the cone center. A legendary tac light's 2.4×
    // base hits 4.8× spread when the player keeps the beam locked
    // on the enemy's body, dropping back as they sweep off-axis.
    const baseBlindMul = lightAtt.blindSpreadMul || 2.0;
    const centerScaledBlind = baseBlindMul * (1 + centerness * 1.0);
    enemy.blindSpreadMul = Math.max(enemy.blindSpreadMul || 1.0, centerScaledBlind);
    if (lightAtt.lightTier === 'strobe') {
      // Strobe dazzle is TRANSIENT — only active while the cone is on
      // the enemy. Refresh to a tiny window each frame; the moment
      // the cone sweeps off, it decays out within a couple frames and
      // the enemy can fire again. Player report: 'as soon as they
      // leave the cone enemies can attack again.'
      enemy.dazzleT = Math.max(enemy.dazzleT || 0, 0.10);
      enemy.dazzleSpreadMul = Math.max(enemy.dazzleSpreadMul || 1.0,
        (lightAtt.dazzleSpreadMul || 3.0) * (1 + centerness * 0.5));
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

  // First tick this trigger pull counts as a non-pistol fire for
  // contract evaluation. Flame is its own class so this is sufficient.
  runStats.noteFireWeaponClass('flame');

  const tickInterval = 1 / Math.max(1, weapon.flameTickRate || 12);
  weapon.flameTickT = tickInterval;

  weapon.ammo -= 1;
  // Brass Prisoner curse — flame ticks also pay the toll. Floored at 0.
  if (artifacts && artifacts.has('brass_prisoner')) {
    // Brass Prisoner curse — every shot pays an extra round on top
    // of the normal ammo cost (2 bullets per pull total).
    weapon.ammo = Math.max(0, weapon.ammo - 1);
  }
  if (weapon.durability && !derivedStats.indestructibleWeapons) {
    const _wMult = derivedStats.weaponDurabilityMult || 1;
    weapon.durability.current = Math.max(
      0, weapon.durability.current - tunables.durability.weaponDecayPerShot * 0.4 * _wMult,
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
    runStats.noteMeleeLanded();
    applyBurnStack(c, tunables.burn.duration * (derivedStats.burnDurationBonus || 1));
    if (wasAlive && !c.alive) {
      onEnemyKilled(c);
      awardClassXp('exotic', c.tier, c);
      if (skillTree.level('bloodlust') > 0) buffs.grant('bloodlust', { moveSpeedMult: 1.55 }, 4);
    }
  }

  // Flame jet is LOUD — alerts every enemy within ~36m. Done once per
  // tick (not per hit) so the noise pulse doesn't drown the bus when a
  // wide cone catches a crowd. alertEnemiesFromShot reads
  // `weapon.noiseRange` to widen the radius beyond the default 22m.
  alertEnemiesFromShot(origin);

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
// AI grenadier-boss throw — lobs a frag from the boss's chest toward
// the player. Uses the same ballistic-apex curve as the player's
// throwables so the visual reads identically. Damage scales off the
// boss's damageMult so a level-10 grenadier hits proportionally hard.
function spawnAiGrenade(g) {
  if (!g || !g.alive || !player?.mesh) return;
  const muzzle = new THREE.Vector3(
    g.group.position.x,
    1.2,
    g.group.position.z,
  );
  const aim = new THREE.Vector3(
    player.mesh.position.x,
    0.1,
    player.mesh.position.z,
  );
  const dx = aim.x - muzzle.x, dz = aim.z - muzzle.z;
  const throwDist = Math.hypot(dx, dz);
  const MIN_APEX = 0.4;
  const MAX_APEX = 3.0;
  const apex = MIN_APEX + (MAX_APEX - MIN_APEX) * Math.min(1, throwDist / 16);
  const gravity = 18;
  const vel = ProjectileManager.ballisticVelocityApex(muzzle, aim, apex, gravity);
  const aiOpts = {
    pos: muzzle,
    vel,
    type: 'grenade',
    lifetime: 1.8,
    radius: 0.09,
    color: 0xb04030,
    explosion: {
      radius: 3.6,
      damage: Math.round(28 * (g.damageMult || 1)),
      shake: 0.45,
    },
    owner: 'enemy',
    gravity,
    bounciness: 0.18,
    throwKind: 'frag',
  };
  projectiles.spawn(aiOpts);
  // Coop: broadcast the visual so joiners see the AI grenade flying.
  // Damage on the receiver-side mirror is zeroed; host's local
  // explosion + the onProjectileExplode joiner-ghost scan handle
  // auth damage to all peers.
  _coopBroadcastThrowable(aiOpts);
  if (sfx?.aiFire) sfx.aiFire('lmg');
}

// Sniper enemy shot — non-hitscan, slow projectile so the player can
// see it coming and dodge after the laser-paint window. Fires from
// the sniper's gun toward the player's CURRENT position at fire time
// (so dodging RIGHT as the paint timer runs out is what beats it).
// Big damage on hit but defeatable with one well-timed roll.
function spawnSniperShot(g) {
  if (!g || !g.alive || !player?.mesh) return;
  const muzzle = new THREE.Vector3();
  g.muzzle.getWorldPosition(muzzle);
  const target = new THREE.Vector3(
    player.mesh.position.x, 1.0, player.mesh.position.z,
  );
  const dir = target.clone().sub(muzzle);
  if (dir.lengthSq() < 0.0001) return;
  dir.normalize();
  const SPEED = 28;     // dodgeable but threatening — ~1m frame at 60fps
  const vel = dir.clone().multiplyScalar(SPEED);
  // Sniper bullet — direct-impact, NOT a full grenade explosion.
  // The grenade detonation path allocates a fireball mesh + ring
  // mesh + 14 spark spheres + a PointLight per hit, which produced
  // a noticeable hitch at impact. Tagging `_sniperShot: true` lets
  // onProjectileExplode short-circuit to a cheap path: one impact
  // sphere + a player-distance damage check.
  const sniperDamage = Math.round(55 * (g.damageMult || 1));
  projectiles.spawn({
    pos: muzzle,
    vel,
    type: 'grenade',
    lifetime: 3.0,
    radius: 0.10,
    color: 0xff3a3a,
    explosion: { radius: 0.6, damage: sniperDamage, shake: 0.10 },
    owner: 'enemy',
    gravity: 0,
    bounciness: 0,
    _sniperShot: true,
  });
  if (sfx?.aiFire) sfx.aiFire('sniper');
  triggerShake(0.18, 0.12);
}

function firePlayerProjectile(playerInfo, weapon, aimPoint) {
  if (typeof weapon.ammo === 'number' && !weapon.infiniteAmmo) weapon.ammo -= 1;
  // Brass Prisoner curse — projectile launchers pay the same toll
  // (one extra round on top of the normal cost = 2 per shot).
  if (typeof weapon.ammo === 'number' && !weapon.infiniteAmmo
      && artifacts && artifacts.has('brass_prisoner')) {
    weapon.ammo = Math.max(0, weapon.ammo - 1);
  }
  sfx.fire(weapon.class || 'shotgun');
  runStats.noteFireWeaponClass(weapon.class || 'shotgun');
  alertEnemiesFromShot(playerInfo.muzzleWorld);
  if (player.kickRecoil) player.kickRecoil();
  triggerShake(0.28, 0.22);
  if (weapon.durability && !derivedStats.indestructibleWeapons) {
    const _wMult = derivedStats.weaponDurabilityMult || 1;
    weapon.durability.current = Math.max(
      0, weapon.durability.current - tunables.durability.weaponDecayPerShot * _wMult,
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

// --- Grapple state -------------------------------------------------
// Zipline Gun fires a hitscan ray. Two outcomes:
//   * enemy hit → reel the enemy to the player over ~0.45s
//   * terrain hit → reel the player to the impact point over ~0.45s
// During the reel, the player or enemy is in 'grappleT > 0' state and
// has movement gated; a thin gold cable mesh visualizes the line
// between the muzzle and target. Cleared when t hits 0.
let _activeGrapples = [];        // {target, towardEnemy, srcPos, dstPos, t, life, cable, cableMat}
const _grappleCableMat = new THREE.LineBasicMaterial({
  color: 0xffd040, transparent: true, opacity: 0.95, depthWrite: false,
});

function firePlayerGrapple(playerInfo, weapon, aimPoint) {
  const range = weapon.grappleRange || weapon.range || 14;
  const origin = playerInfo.muzzleWorld.clone();
  const dir = new THREE.Vector3(
    aimPoint.x - origin.x, 0, aimPoint.z - origin.z,
  );
  if (dir.lengthSq() < 0.0001) return;
  dir.normalize();
  weapon.ammo = Math.max(0, (weapon.ammo | 0) - 1);
  if (weapon.ammo <= 0) tryReload(weapon);
  // Combined hit list — enemies + walls/props. First-hit wins.
  const hitTargets = [...allHittables(), ...level.solidObstacles()];
  const hit = combat.raycast(origin, dir, hitTargets, range);
  // Tracer beam to wherever we landed (or max range if nothing).
  const endPoint = hit
    ? hit.point
    : origin.clone().addScaledVector(dir, range);
  combat.spawnShot(origin, endPoint, weapon.tracerColor || 0xffd040,
    { light: false, flash: true });
  if (sfx.fire) sfx.fire('exotic');
  runStats.noteFireWeaponClass('exotic');
  alertEnemiesFromShot(origin);
  if (!hit) return;
  // Did we hit an enemy? Owner.manager + alive flag distinguishes
  // an actor hit from a wall hit.
  const isEnemy = !!(hit.owner && hit.owner.manager && hit.owner.alive);
  const cable = _spawnGrappleCable();
  const life = 0.45;
  if (isEnemy) {
    // Pull the enemy toward the player. Damage applies once on
    // start so the gun feels like a hit. Stagger so the enemy can't
    // immediately chase out of the pull.
    const enemy = hit.owner;
    const dmg = (weapon.grappleEnemyDamage || 35) * (derivedStats.rangedDmgMult || 1);
    runStats.addDamage(dmg);
    enemy.manager.applyHit(enemy, dmg, hit.zone || 'torso', dir, { weaponClass: 'exotic' });
    if (enemy.alive) {
      enemy.staggerT = Math.max(enemy.staggerT || 0, life + 0.2);
      _activeGrapples.push({
        target: enemy, towardEnemy: false,
        srcPos: enemy.group.position,
        dstPos: player.mesh.position,
        cable, t: 0, life,
      });
    }
  } else {
    // Pull the PLAYER to the hit point. The raycast hit is BY
    // DEFINITION on the wall surface, so dragging directly to it
    // would clip the player into geometry. Back the target off
    // along the ray by (player collision radius + small buffer)
    // so we aim at a safe stop-point in front of the wall.
    const playerR = (tunables.player?.collisionRadius ?? 0.4);
    const stopOff = playerR + 0.25;
    const safeDst = new THREE.Vector3(
      hit.point.x - dir.x * stopOff,
      hit.point.y,
      hit.point.z - dir.z * stopOff,
    );
    _activeGrapples.push({
      target: player, towardEnemy: true,
      srcPos: player.mesh.position,
      dstPos: safeDst,
      cable, t: 0, life,
    });
    _playerGrappleT = life;
  }
}

function _spawnGrappleCable() {
  const geom = new THREE.BufferGeometry();
  const pts = new Float32Array(6);
  geom.setAttribute('position', new THREE.BufferAttribute(pts, 3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.Line(geom, _grappleCableMat);
  line.frustumCulled = false;
  scene.add(line);
  return { line, pts };
}

function _tickGrapples(dt) {
  for (let i = _activeGrapples.length - 1; i >= 0; i--) {
    const g = _activeGrapples[i];
    g.t += dt;
    const k = Math.min(1, g.t / g.life);
    // Ease-out — fast start, settle at the end.
    const ease = 1 - (1 - k) * (1 - k);
    if (g.towardEnemy) {
      // Pulling player toward dstPos. Route through level.resolveCollision
      // so the player stops AT the wall instead of clipping into it.
      // Without this, fast pulls into a corner planted the player inside
      // the collision volume and the next physics step couldn't recover.
      const sx = player.mesh.position.x;
      const sz = player.mesh.position.z;
      const targetX = sx + (g.dstPos.x - sx) * (ease * 0.55);
      const targetZ = sz + (g.dstPos.z - sz) * (ease * 0.55);
      const playerR = (tunables.player?.collisionRadius ?? 0.4);
      if (level && level.resolveCollision) {
        const res = level.resolveCollision(sx, sz, targetX, targetZ, playerR);
        player.mesh.position.x = res.x;
        player.mesh.position.z = res.z;
        // If we got clamped (wall in the way), end the pull early —
        // continuing to push against the wall just looks like a
        // stuck animation.
        const movedSq = (res.x - sx) * (res.x - sx) + (res.z - sz) * (res.z - sz);
        const wantedSq = (targetX - sx) * (targetX - sx) + (targetZ - sz) * (targetZ - sz);
        if (wantedSq > 0.0004 && movedSq < wantedSq * 0.10) {
          // Less than 10% of intended motion landed — wall blocking;
          // terminate the grapple this frame.
          g.t = g.life;
        }
      } else {
        player.mesh.position.x = targetX;
        player.mesh.position.z = targetZ;
      }
    } else {
      // Pulling enemy toward player.
      const e = g.target;
      if (!e || !e.alive || !e.group) { g.t = g.life; continue; }
      const sx = e.group.position.x;
      const sz = e.group.position.z;
      const px = player.mesh.position.x;
      const pz = player.mesh.position.z;
      e.group.position.x = sx + (px - sx) * (ease * 0.55);
      e.group.position.z = sz + (pz - sz) * (ease * 0.55);
    }
    // Update cable endpoints (muzzle → target).
    const muzzle = lastPlayerInfo?.muzzleWorld || player.mesh.position;
    const tgt = g.towardEnemy ? g.dstPos : g.target.group.position;
    g.cable.pts[0] = muzzle.x;
    g.cable.pts[1] = (muzzle.y || 1.2);
    g.cable.pts[2] = muzzle.z;
    g.cable.pts[3] = tgt.x;
    g.cable.pts[4] = (tgt.y || 1.0) + (g.towardEnemy ? 0 : 1.2);
    g.cable.pts[5] = tgt.z;
    g.cable.line.geometry.attributes.position.needsUpdate = true;
    g.cable.line.material.opacity = 0.95 * (1 - k * 0.5);
    if (g.t >= g.life) {
      scene.remove(g.cable.line);
      g.cable.line.geometry.dispose();
      _activeGrapples.splice(i, 1);
    }
  }
  if (_playerGrappleT > 0) _playerGrappleT = Math.max(0, _playerGrappleT - dt);
}
let _playerGrappleT = 0;

// Build the Djinn orb mesh on demand. Cheap geometry — small
// emissive sphere with additive blending so it reads as spectral
// rather than a physical marble. Added directly to the scene so the
// player rig doesn't have to know about it.
function _ensureDjinnOrb() {
  if (_djinnOrb) return;
  if (!artifacts || !artifacts.has('djinns_blessing')) return;
  const geom = new THREE.SphereGeometry(0.10, 14, 10);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x80c0ff, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  _djinnOrb = new THREE.Mesh(geom, mat);
  scene.add(_djinnOrb);
}

// Per-frame orbit. Floats around the player's shoulder height; the
// vertical wobble (sin × 2) keeps it from looking pinned to a track.
function _tickDjinnOrb(dt) {
  const owned = !!(artifacts && artifacts.has('djinns_blessing'));
  if (!owned) {
    if (_djinnOrb) {
      scene.remove(_djinnOrb);
      _djinnOrb.geometry.dispose();
      _djinnOrb.material.dispose();
      _djinnOrb = null;
    }
    return;
  }
  _ensureDjinnOrb();
  if (!_djinnOrb || !player) return;
  _djinnOrbAngle = (_djinnOrbAngle + dt * 1.4) % (Math.PI * 2);
  const r = 0.95;
  _djinnOrb.position.set(
    player.mesh.position.x + Math.cos(_djinnOrbAngle) * r,
    1.55 + Math.sin(_djinnOrbAngle * 2.0) * 0.08,
    player.mesh.position.z + Math.sin(_djinnOrbAngle) * r,
  );
}

// Parallel shot from the orb when the player fires. 25% of the
// player's effective weapon damage with a normal crit roll, so the
// crit pop animation triggers and runs through the same hit pipeline
// as a regular bullet. Tracer is the orb's signature blue.
function _fireDjinnShot(weapon, eff, aimTarget, hitTargets) {
  if (!artifacts || !artifacts.has('djinns_blessing')) return;
  if (!_djinnOrb || !aimTarget) return;
  const fireFrom = _djinnOrb.position.clone();
  const dir = new THREE.Vector3(
    aimTarget.x - fireFrom.x,
    aimTarget.y - fireFrom.y,
    aimTarget.z - fireFrom.z,
  );
  if (dir.lengthSq() < 0.0001) return;
  dir.normalize();
  const range = eff.range || 60;
  const hit = combat.raycast(fireFrom, dir, hitTargets, range);
  // Snap impact + tracer endpoint to the visual mesh center for the
  // same magnetism the main bullet path uses.
  const endPoint = (hit && hit.mesh)
    ? hit.mesh.getWorldPosition(new THREE.Vector3())
    : (hit ? hit.point : fireFrom.clone().addScaledVector(dir, range));
  combat.spawnShot(fireFrom, endPoint, 0x80c0ff, { light: false, flash: false });
  if (hit && hit.owner && hit.owner.manager) {
    const zoneCfg = tunables.zones[hit.zone];
    const zoneMult = zoneCfg ? zoneCfg.damageMult : 1.0;
    let dmg = eff.damage * 0.25 * zoneMult * (derivedStats.rangedDmgMult || 1);
    const critChance = derivedStats.critChance || 0;
    const isCrit = Math.random() < critChance;
    if (isCrit) dmg *= (derivedStats.critDamageMult || 2);
    // Djinn shots are non-breaker bullets — pass shieldBreaker:false
    // explicitly + honor the shield result so a blocked orb shot
    // shows a 0 / shield-chip number, never a fake body number.
    const result = hit.owner.manager.applyHit(hit.owner, dmg, hit.zone, dir,
      { weaponClass: weapon.class, shieldBreaker: false });
    if (result && result.shieldHit) {
      const shieldDmg = result.shieldDamage | 0;
      spawnDamageNumber(endPoint, camera, shieldDmg, null);
      combat.spawnImpact(endPoint);
      if (shieldDmg > 0) runStats.addDamage(shieldDmg);
      return;
    }
    runStats.addDamage(dmg);
    runStats.noteShotHit();
    spawnDamageNumber(endPoint, camera, dmg, hit.zone, isCrit || hit.zone === 'head');
    combat.spawnImpact(endPoint);
    // Headshot polish — bigger shake, brief hit-stop, gold burst at
    // the cranium, plus the metallic-ping SFX layered over the thud.
    if (hit.zone === 'head') {
      try { triggerShake(0.50, 0.10); } catch (_) {}
      try { hitStopT = Math.max(hitStopT, 0.05); } catch (_) {}
      try { spawnHeadshotBurst(endPoint); } catch (_) {}
      try { sfx.headshot?.(); } catch (_) {}
    }
  } else if (hit) {
    combat.spawnImpact(hit.point);
  }
}

function fireOneShot(playerInfo, weapon, aimPoint, isADS, aimOwner, aimZone) {
  // Active contract modifier — weapon-class restriction. Surfaces a
  // throttled HUD message when fire is blocked so the player
  // understands the trigger isn't broken — it's the contract.
  const restrict = _activeModifiers.weaponClass;
  if (restrict === 'melee') {
    _maybeWarnContractBlock('Contract: melee only.');
    return;
  }
  if (restrict === 'pistol' && weapon.class !== 'pistol') {
    _maybeWarnContractBlock('Contract: pistols only.');
    return;
  }
  // Magnum Opus override — full-auto weapons may fire past empty if
  // the relic is owned. Cost is paid in tickShooting (3 HP/s drain).
  const _magnumBypass = (derivedStats.magnumOpusActive
    && weapon.fireMode === 'auto');
  if (typeof weapon.ammo === 'number' && weapon.ammo <= 0
      && !weapon.infiniteAmmo && !_magnumBypass) {
    // Defensive backstop — tickShooting handles the empty-click
    // throttle for the trigger-press path. This branch is reached
    // when a burst sequence runs out mid-volley; throttle here too
    // so consecutive dry rounds don't stack a second click.
    const nowMs = performance.now();
    if (nowMs - (_emptyClickT || 0) >= 200) {
      sfx.empty();
      _emptyClickT = nowMs;
    }
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
  // Grapple — Zipline Gun. Hitscan ray; on enemy hit, reel them to
  // the player; on terrain hit, reel the player to the impact point.
  if (weapon.fireMode === 'grapple') {
    firePlayerGrapple(playerInfo, weapon, aimPoint);
    return;
  }

  // Attachment-adjusted stats for damage / spread / range; ammo + reload state
  // stay on the live weapon.
  const eff = effectiveWeapon(weapon);

  // The *tracer* draws from the visible muzzle (wherever the hand
  // happens to be), but the *bullet physics* fires from a stable
  // chest-height virtual origin so crouching / low-hand poses don't
  // dunk every shot into the floor. Direction points from that stable
  // origin to the cursor target.
  //
  // Bullet trajectory points at the cursor's actual surface point —
  // body-location-based aim. The previous 'snap to zone CENTER' for
  // locked enemies made every shot feel auto-aimed (bullet always
  // landed dead-center regardless of where on the body the cursor
  // hovered) AND let bullets skip shielded enemies — when the cursor
  // landed on a head poking over the shield top, the bullet fired at
  // the head's world-center and sailed past the shield mesh entirely.
  // Reliability is now handled by:
  //   1) bullet magnetism — registered impact snaps to mesh center
  //      so blood/numbers land cleanly even on edge grazes
  //   2) head-hover spread bonus — gated on stable bloom for headshots
  //   3) pixelMode enemy-tighten — spread cone shrinks on enemy hover
  //   4) bloom system — first-shot tighten + spread bloom on spam
  const fireFrom = playerInfo.fireOrigin || playerInfo.muzzleWorld;
  const tracerFrom = playerInfo.muzzleWorld;
  const aimTarget = aimPoint;
  _tmpDir.copy(aimTarget).sub(fireFrom);
  if (_tmpDir.lengthSq() < 0.0001) return;
  _tmpDir.normalize();

  const baseSpread = isADS
    ? eff.adsSpread * (derivedStats.adsSpreadOnlyMult || 1)
    : eff.hipSpread * (derivedStats.hipSpreadOnlyMult || 1);
  const crouched = inputStateCrouchHeld();
  const crouchSpreadK = crouched ? (derivedStats.crouchSpreadMult ?? 1) : 1;
  let spread = baseSpread * derivedStats.rangedSpreadMult * crouchSpreadK;
  // Per-shot bloom — sustained fire inflates spread; disciplined
  // bursts let it decay. First shot from a cold trigger gets a small
  // tighten. Shotguns / sniper are heavy-cost-per-shot; SMG / LMG
  // accumulate little per-round because their RoF would punish twice
  // otherwise.
  if (_shotBloom < FIRST_SHOT_THRESHOLD) {
    spread *= FIRST_SHOT_TIGHTEN;
  } else {
    spread *= (1 + _shotBloom * BLOOM_MAX_MULT);
  }
  // Pixel-aim mode — when the cursor is over an enemy mesh, the gun's
  // hand-wobble cone collapses dramatically so the shot lands on the
  // pixel under the cursor (the user's intent), not somewhere in a
  // body-wide quadrant the gun rolled. Replaces the "locked" feel of
  // the spread randomly picking which body part eats the round.
  // Shotguns keep more of their pellet pattern (multi-pellet IS the
  // weapon) — they get a softer tighten that just clusters the
  // pattern around the cursor instead of fanning across the whole
  // silhouette. Toggle via `tunables.aim.pixelMode`; legacy behaviour
  // (no enemy-aware tighten) is preserved by setting it to false.
  const _aimCfg = tunables.aim || {};
  if (_aimCfg.pixelMode !== false && aimOwner) {
    const isMultiPellet = (eff.pelletCount | 0) > 1;
    const tighten = isMultiPellet
      ? (_aimCfg.enemyTightenPellet ?? 0.50)   // shotgun / dragonbreath
      : (_aimCfg.enemyTightenSingle ?? 0.20);  // pistol / smg / rifle / sniper / lmg
    spread *= tighten;
  }
  // Head-hover bonus — when the cursor is over an enemy head AND the
  // recoil indicator is stable (bloom below the first-shot threshold),
  // an additional spread tightening kicks in on top of the pixel-mode
  // enemy tighten. This makes:
  //   - Tap-fired first shots → very accurate headshot landings
  //   - Held / spammed shots  → bloom inflates above the threshold,
  //                              bonus drops off, headshots stay hard
  // The cap matches FIRST_SHOT_THRESHOLD so the bonus and the
  // existing first-shot tighten share one coherent stable-aim window.
  if (aimZone === 'head' && aimOwner && _shotBloom < FIRST_SHOT_THRESHOLD) {
    spread *= (_aimCfg.headHoverSpreadMult ?? 0.55);
  }
  // LMG Walking Fire — sustained-fire spread bleed. While holding the
  // trigger, multiply spread by max(0, 1 - decay * heldT). Decay tracked
  // per-frame in the tick (see _lmgHeldT update). Capped at zero so the
  // LMG locks onto a single point after enough sustained fire.
  if (weapon.class === 'lmg' && (derivedStats.lmgSustainedSpreadDecay || 0) > 0) {
    const k = Math.max(0, 1 - derivedStats.lmgSustainedSpreadDecay * _lmgHeldT);
    spread *= k;
  }
  // Broken weapon — wildly inflated spread instead of a hard fire-
  // lock. Lets the player limp through to a repair at the shop, but
  // the gun is barely useful until then.
  if (weapon.durability && weapon.durability.current <= 0) {
    spread *= (tunables.durability?.brokenSpreadMult ?? 5.0);
  }
  // Twin Fangs — each stack rolls a fresh 15% chance to add one
  // extra pellet to THIS shot. Independent rolls per stack so two
  // copies of the perk can both fire on the same trigger pull.
  let extraPellets = 0;
  const epc = derivedStats.extraPelletChance || 0;
  if (epc > 0) {
    // Stack count = round(epc / 0.15); each rolls independently at 15%.
    // One Twin Fangs → 1 roll @ 15%; two → 2 rolls @ 15%; etc.
    const stacks = Math.max(1, Math.round(epc / 0.15));
    const perStack = epc / stacks;
    for (let i = 0; i < stacks; i++) {
      if (Math.random() < perStack) extraPellets++;
    }
  }
  const pellets = Math.max(1, (eff.pelletCount | 0) + (derivedStats.pelletCountBonus || 0) + extraPellets);
  // --- Class-based effective range + damage-falloff -----------------
  // Baseline "room" is ~14m (typical room dimension). Each class gets
  // a base range expressed in rooms; the per-pellet computed range is
  // jittered ±25% so bullets don't all die at the exact same spot.
  // Damage falloff applies per hit: edge-of-range damage = 65% of base
  // (35% loss). Curves: 'none' (sniper) / 'steady' (linear, pistol +
  // smg + rifle + lmg) / 'steep' (quadratic, shotgun).
  const ROOM_M = 14;
  const _wclass = weapon.class || 'pistol';
  let _baseRange;
  let _falloffShape;
  if (_wclass === 'shotgun')      { _baseRange = ROOM_M * 0.5;  _falloffShape = 'steep';  }
  else if (_wclass === 'smg')     { _baseRange = ROOM_M * 0.85; _falloffShape = 'steady'; }
  else if (_wclass === 'rifle')   { _baseRange = ROOM_M * 1.5;  _falloffShape = 'steady'; }
  else if (_wclass === 'lmg')     { _baseRange = ROOM_M * 1.2;  _falloffShape = 'steady'; }
  else if (_wclass === 'sniper')  { _baseRange = 100;           _falloffShape = 'none';   }
  else                            { _baseRange = 100;           _falloffShape = 'steady'; }   // pistol default
  // Universal +30% range bump on top of the per-class base. Stacks
  // multiplicatively with rangeMult perks (long barrel, etc.).
  const _classMaxRange = _baseRange * 1.30 * (derivedStats.rangeMult || 1);
  // Per-shot jitter — applied at the loop body so each pellet gets its
  // own random end-of-range. Helper to compute the falloff multiplier
  // given a hit distance.
  const _falloffMult = (dist, maxR) => {
    if (_falloffShape === 'none' || maxR <= 0) return 1.0;
    const t = Math.max(0, Math.min(1, dist / maxR));
    const k = _falloffShape === 'steep' ? t * t : t;
    // Lerp 1.0 → 0.50 (50% reduction at the edge — was 35%, +15%).
    return 1.0 - 0.50 * k;
  };
  // Backwards-compat with later code paths that still read `effRange`
  // (penetration, ricochet target search). Use the un-jittered class
  // range as the ceiling; per-pellet jitter happens inside the loop.
  const effRange = _classMaxRange;
  // Exclude unlocked doors — their flattened mesh still intersects
  // raycasts otherwise, so bullets would invisibly hit the doorway.
  // When crouching, also exclude low-cover obstacles: the player's
  // fireOrigin (chest) can be as low as ~0.55 m when kneeling, well
  // below the 0.80 m cover top, so the bullet trajectory can never
  // clear the cover even when aimed past it. Low cover is a "shoot-over"
  // obstacle by design — the crouching player shoots through it.
  const _solidForShot = inputStateCrouchHeld()
    ? level.solidObstacles().filter(m => !m.userData.isLowCover)
    : level.solidObstacles();
  const hitTargets = [...allHittables(), ..._solidForShot];

  // Scavenger's Eye / freeShotChance — chance the round isn't consumed.
  // Battle Trance / instantReloadChance — chance to instantly fully reload
  // after firing. Both perks proc independently per shot. Free-shot is
  // checked BEFORE decrement; instant-reload AFTER (it's a refill, not
  // a refund — works even on the last round in the mag).
  const freeShot = (derivedStats.freeShotChance || 0) > 0
    && Math.random() < derivedStats.freeShotChance;
  // Capture pre-decrement ammo so the Opening / Closing Act +100%
  // bonuses can identify the first / last bullet of the mag. ammo
  // === eff.magSize before decrement = first round; ammo === 1 = last.
  const _ammoBefore = (typeof weapon.ammo === 'number') ? weapon.ammo : -1;
  if (typeof weapon.ammo === 'number' && !weapon.infiniteAmmo && !freeShot) weapon.ammo -= 1;
  // Brass Prisoner curse — every shot eats 1 EXTRA bullet from the
  // magazine on top of the round we just fired (2 total per pull).
  // Floored at 0 so the last bullet still fires; the next trigger
  // pull clicks empty. Skipped on freeShot so Scavenger's Eye still
  // feels like a perk even under the curse.
  if (typeof weapon.ammo === 'number' && !weapon.infiniteAmmo && !freeShot
      && artifacts && artifacts.has('brass_prisoner')) {
    weapon.ammo = Math.max(0, weapon.ammo - 1);
  }
  if ((derivedStats.instantReloadChance || 0) > 0
      && typeof weapon.ammo === 'number' && !weapon.infiniteAmmo
      && weapon.ammo < eff.magSize
      && Math.random() < derivedStats.instantReloadChance) {
    weapon.ammo = eff.magSize;
  }
  // Auto-reload on emptying the magazine. Without this the player has
  // to release the trigger and re-press to start a reload — held-trigger
  // auto-fire (the most common play pattern) gets stuck on dry-clicks
  // until they let go. tryReload is a no-op if a reload is already in
  // flight or the mag is already full, so calling it unconditionally
  // when ammo hits 0 is safe.
  if (typeof weapon.ammo === 'number' && weapon.ammo <= 0
      && !weapon.infiniteAmmo) {
    tryReload(weapon);
  }
  sfx.fire(weapon.class || 'pistol');
  runStats.noteFireWeaponClass(weapon.class || 'pistol');
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
  if (weapon.durability && !derivedStats.indestructibleWeapons) {
    const _wMult = derivedStats.weaponDurabilityMult || 1;
    weapon.durability.current = Math.max(
      0, weapon.durability.current - tunables.durability.weaponDecayPerShot * _wMult,
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
  // Combat juice — eject brass + puff muzzle smoke. Both pooled. Skip
  // for melee weapons. _tmpDir is the normalized fire direction, set
  // up above for the spread / raycast loop.
  if (eff?.class && eff.class !== 'melee') {
    combat.spawnBrass(tracerFrom, _tmpDir);
    combat.spawnMuzzleSmoke(tracerFrom, _tmpDir);
  }

  // Bump per-shot bloom — once per trigger pull, not per pellet.
  // Class-rooted: shotgun / sniper add a lot per shot (heavy round,
  // low RoF), SMG / LMG add little (high RoF would otherwise compound).
  const _bloomAdd = BLOOM_PER_SHOT_BY_CLASS[weapon.class] ?? 0.15;
  _shotBloom = Math.min(1, _shotBloom + _bloomAdd);

  for (let i = 0; i < pellets; i++) {
    // Re-jitter the SAME _tmpDir each iteration; raycast + spawnShot
    // consume the direction synchronously so we can skip the per-pellet
    // .clone() that was here. Saves 9-pellet shotgun volleys ~9 Vector3
    // allocations per fire. _tmpEndPt scratch covers the no-hit case.
    const dir = jitterDirY(_tmpDir, spread);
    // Per-pellet effective range — jitter ±25% so bullets die at
    // varied points around the class's base max range. Sniper / pistol
    // are effectively unlimited so the jitter is unnoticeable on their
    // 100m baseline; on shotgun / smg / rifle / lmg it gives a clear
    // "some shots reached, some didn't" feel near the edge.
    const _pelletRange = _classMaxRange * (0.75 + Math.random() * 0.50);
    const hit = combat.raycast(fireFrom, dir, hitTargets, _pelletRange);
    // Bullet magnetism — when the cursor's ray clips ANY edge of an
    // enemy body part, the impact / tracer endpoint / damage number /
    // blood splatter all snap to the visual center of the hit mesh.
    // The muzzle direction is unchanged (still driven by the cursor's
    // aim point) so the gun doesn't visually pull toward the body
    // center — only the registered hit moves. Zone is already taken
    // from userData so damage routing is unaffected.
    if (hit && hit.owner && hit.mesh) {
      hit.point = hit.mesh.getWorldPosition(new THREE.Vector3());
    }
    // Tracer endpoint uses the per-pellet jittered range, not
    // effRange. Without this every miss draws to the same wall-of-
    // tracers terminator at exactly classMaxRange — looks identical
    // shot-to-shot. With _pelletRange (±25% per shot) tracers fade
    // out at the actual reach of that bullet, which reads as real
    // ballistic spread.
    const endPoint = hit
      ? hit.point
      : _tmpEndPt.copy(fireFrom).addScaledVector(dir, _pelletRange);
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
    // Coop: broadcast the tracer so remote allies see our gunfire.
    // Reuse the same fx-tracer kind the AI already uses; receivers
    // spawn a local tracer + flash via combat.spawnShot. Per-pellet
    // is fine — the joiner's per-frame fx-tracer budget caps total
    // packets rendered. The cap is on the SENDER side; for player
    // fire we send each pellet so shotguns read correctly.
    {
      const _coopT = getCoopTransport();
      if (_coopT.isOpen && _coopT.peers && _coopT.peers.size > 0) {
        _coopT.send('fx-tracer-self', {
          x1: +tracerFrom.x.toFixed(2),
          y1: +tracerFrom.y.toFixed(2),
          z1: +tracerFrom.z.toFixed(2),
          x2: +endPoint.x.toFixed(2),
          y2: +endPoint.y.toFixed(2),
          z2: +endPoint.z.toFixed(2),
          c: eff.tracerColor | 0,
        });
      }
    }

    // Knife intercept — assassin knives are hittable; a player shot
    // landing on a knife mesh destroys the knife in flight. No damage
    // routing, no number popup; just a tiny impact spark + sfx so the
    // player knows the parry-shot landed.
    if (hit && hit.mesh?.userData?.knife && hit.owner) {
      destroyAssassinKnife(hit.owner);
      combat.spawnImpact(hit.point);
      if (sfx?.hit) sfx.hit();
      continue;
    }
    // Mega-boss hits go through a parallel path — boss owns its own
    // HP + applyHit + visual flash. Damage computation reuses the
    // same zone + crit + falloff pipeline as normal enemies.
    if (hit && hit.mesh?.userData?.megaBoss && hit.owner) {
      const zoneCfg = tunables.zones[hit.zone];
      let mult = zoneCfg ? zoneCfg.damageMult : 1.0;
      if (hit.zone === 'head') {
        mult += (derivedStats.headMultBonus || 0) + (weapon.headBonus || 0);
      }
      let dmg = eff.damage * mult * derivedStats.rangedDmgMult;
      if (derivedStats.openingActActive && _ammoBefore === eff.magSize) dmg *= 2;
      if (derivedStats.closingActActive && _ammoBefore === 1) dmg *= 2;
      // Falloff applies even at boss range — sniper beats shotgun.
      if (_falloffShape !== 'none') {
        const _fdx = hit.point.x - fireFrom.x;
        const _fdy = hit.point.y - fireFrom.y;
        const _fdz = hit.point.z - fireFrom.z;
        const _fd = Math.sqrt(_fdx * _fdx + _fdy * _fdy + _fdz * _fdz);
        const _ratio = Math.min(1, _fd / Math.max(0.001, _classMaxRange));
        const _falloff = _falloffShape === 'quad'
          ? (1 - 0.35 * _ratio * _ratio)
          : (1 - 0.35 * _ratio);
        dmg *= _falloff;
      }
      // Coop: joiner's hit needs to reach the host's authoritative
      // megaboss instance — joiner's local applyHit only mutates
      // the snapshot mirror and gets overwritten next tick. Send
      // rpc-shoot with mb:1 so host applies on their side; local
      // applyHit still runs for snappy visual feedback.
      const _coopT_mb = getCoopTransport();
      if (_coopT_mb.isOpen && !_coopT_mb.isHost) {
        _coopT_mb.send('rpc-shoot', { mb: 1, d: Math.round(dmg), z: hit.zone || 'torso' });
      }
      hit.owner.applyHit(dmg);
      runStats.addDamage(dmg);
      runStats.noteShotHit();
      spawnDamageNumber(hit.point, camera, dmg, hit.zone);
      // Visual hit feedback piggybacks the existing impact pool.
      combat.spawnImpact(hit.point);
      if (sfx?.hit) sfx.hit();
      continue;     // skip normal-enemy applyHit branch
    }

    if (hit && hit.owner && hit.owner.manager) {
      const zoneCfg = tunables.zones[hit.zone];
      let mult = zoneCfg ? zoneCfg.damageMult : 1.0;
      if (hit.zone === 'head') {
        mult += (derivedStats.headMultBonus || 0) + (weapon.headBonus || 0);
      }
      let dmg = eff.damage * mult * derivedStats.rangedDmgMult;
      // Opening Act / Closing Act — first and last bullet in the mag
      // each deal +100% damage. Both stack (a 1-mag pistol's only
      // shot is both first AND last → +300% total).
      if (derivedStats.openingActActive && _ammoBefore === eff.magSize) dmg *= 2;
      if (derivedStats.closingActActive && _ammoBefore === 1)            dmg *= 2;
      // Class-based damage falloff. Distance from the bullet's origin
      // to the hit; multiplier 1.0 → 0.65 lerped over the class's
      // base max range. Sniper has 'none' shape so this is a no-op.
      if (_falloffShape !== 'none') {
        const _fdx = hit.point.x - fireFrom.x;
        const _fdy = hit.point.y - fireFrom.y;
        const _fdz = hit.point.z - fireFrom.z;
        const _fdist = Math.sqrt(_fdx * _fdx + _fdy * _fdy + _fdz * _fdz);
        dmg *= _falloffMult(_fdist, _classMaxRange);
      }
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
      if (crit && hit.zone === 'head') runStats.noteCritHeadshot();
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
      const result = hit.owner.manager.applyHit(hit.owner, dmg, hit.zone, dir, { weaponClass: weapon.class, shieldBreaker: !!weapon.shieldBreaker });
      // Shield interactions short-circuit the body-damage path. The
      // shield itself shows its own damage number (0 for a fully
      // blocked shot, the chip amount for a shield-breaker hit) and
      // skips the body aggregator + bloodburst + runStats credit.
      if (result.shieldHit) {
        const shieldDmg = result.shieldDamage | 0;
        spawnDamageNumber(hit.point, camera, shieldDmg, null);
        combat.spawnImpact(hit.point);
        if (shieldDmg > 0) runStats.addDamage(shieldDmg);
        continue;
      }
      runStats.addDamage(dmg);
      for (const drop of result.drops) loot.spawnItem(drop.position, wrapWeapon(drop.weapon));
      // Tutorial step ticks on hit-zone — landing the right zone on a
      // tutorial dummy proves the lesson. The arm zone has a random
      // disarm roll; if the dummy isn't disarmed yet, count arm hits
      // and force-disarm on the 2nd to guarantee the lesson completes.
      if (tutorialMode && hit.owner.tutorialDummy) {
        if (hit.zone === 'head') tutorialUI.markStep('shoot_head');
        if (hit.zone === 'leg' || hit.zone === 'legs') tutorialUI.markStep('shoot_leg');
        if (hit.zone === 'arm') {
          if (hit.owner.disarmed) {
            tutorialUI.markStep('disarm');
          } else {
            hit.owner._tutorialArmHits = (hit.owner._tutorialArmHits || 0) + 1;
            if (hit.owner._tutorialArmHits >= 2 && hit.owner.weapon
                && typeof hit.owner.manager.forceDisarm === 'function') {
              hit.owner.manager.forceDisarm(hit.owner);
              tutorialUI.markStep('disarm');
            }
          }
        }
      }
      // Dragonbreath / other igniteOnHit weapons — set normal-tier
      // enemies ablaze + panicking. Sub-bosses and bosses only take
      // burn DoT without the panic flag (they keep attacking).
      // Undying Embers relic — every hit (any weapon) applies a burn
      // stack. Damage scales naturally with hit frequency.
      if (derivedStats.appliesBurnOnHit && hit.owner.alive) {
        const burnBonus = derivedStats.burnDurationBonus || 1;
        applyBurnStack(hit.owner, (tunables.burn?.duration || 5) * burnBonus);
      }
      if (weapon.igniteOnHit && hit.owner.alive) {
        const burnBonus = derivedStats.burnDurationBonus || 1;
        applyBurnStack(hit.owner,
          (tunables.burn?.duration || 5) * burnBonus * 1.5);
        if (hit.owner.tier === 'normal' || !hit.owner.tier) {
          hit.owner.panicT = Math.max(hit.owner.panicT || 0, 4.0);
        }
      }
      // Sleep-dart weapon — silent knock-out + de-aggro. Wipes
      // suspicion + lastKnown breadcrumb, locks the target out of
      // alert / propagation paths for the full timer (10s..5min).
      // Tier gating:
      //   normal       — always procs
      //   sub-boss     — 12% chance per hit
      //   major boss   —  4% chance per hit
      // Bosses still get a real chance to be put down by a sustained
      // dart user, but it's a lucky-break tactic, not a free win.
      if (weapon.sleepOnHit && hit.owner.alive) {
        const t = hit.owner.tier;
        let chance = 0;
        if (!t || t === 'normal') chance = 1;
        else if (t === 'subBoss') chance = 0.12;
        else if (t === 'boss')    chance = 0.04;
        if (chance > 0 && Math.random() < chance) {
          hit.owner.forceSleep = true;
          hit.owner.deepSleepT = 10 + Math.random() * 290;
          hit.owner.suspicion = 0;
          hit.owner.reactionT = 0;
          hit.owner.lastKnownX = undefined;
          hit.owner.lastKnownZ = undefined;
        }
      }
      // Shock on crit — briefly dazzle the target (blurs their aim via dazzleT).
      if (crit && (derivedStats.shockOnCrit || 0) > 0 && hit.owner.alive) {
        hit.owner.dazzleT = Math.max(hit.owner.dazzleT || 0, derivedStats.shockOnCrit);
      }
      if (wasAlive && !hit.owner.alive) {
        onEnemyKilled(hit.owner);
        awardClassXp(weapon.class, hit.owner.tier, hit.owner);
        if (hit.zone === 'head' && weaponHasArtifactPerk(weapon, 'popperHead')) {
          popHead(hit.owner, dir);
        }
        // Reload-on-kill is now handled centrally inside onEnemyKilled
        // so every kind of kill (bullet, projectile, melee, burn DoT,
        // AoE) refunds ammo, not just hitscan bullet hits.
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
      // Headhunter: refund one round per headshot if the weapon has
      // the perk. If this shot emptied the mag (ammo was 0 going
      // into the refund), the auto-reload-on-empty branch above
      // already kicked off a reload — cancel it the moment the
      // refund puts a round back, or the gun visibly reloads anyway
      // and the perk reads as broken. Applies whether magSize is 1
      // (sniper) or 5+ (the player just had 1 bullet left in a
      // bigger mag).
      if (hit.zone === 'head' && weaponHasPerk(weapon, 'headhunter')
        && typeof weapon.ammo === 'number' && weapon.ammo < eff.magSize) {
        const wasEmpty = weapon.ammo <= 0;
        weapon.ammo = Math.min(eff.magSize, weapon.ammo + 1);
        if (wasEmpty && weapon.reloadingT > 0) {
          weapon.reloadingT = 0;
          weapon.reloadEndsAt = 0;
        }
      }
      // Scavenged Rounds — chance-based ammo refund on any body hit.
      // Cancel the auto-reload-on-empty if this refund puts a round
      // back into a mag we just emptied this shot.
      if ((derivedStats.ammoOnHitChance || 0) > 0
          && typeof weapon.ammo === 'number' && weapon.ammo < eff.magSize
          && Math.random() < derivedStats.ammoOnHitChance) {
        const wasEmpty = weapon.ammo <= 0;
        weapon.ammo = Math.min(eff.magSize, weapon.ammo + 1);
        if (wasEmpty && weapon.reloadingT > 0) {
          weapon.reloadingT = 0;
          weapon.reloadEndsAt = 0;
        }
      }
      // Vampiric Aim — headshot heal.
      if (hit.zone === 'head' && (derivedStats.headshotHeal || 0) > 0) {
        player.heal(derivedStats.headshotHeal);
      }
      // Vampire's Mark relic — flat % of damage dealt heals on any
      // ranged hit. Mirrors the existing melee lifesteal pipeline.
      if ((derivedStats.lifestealRangedPercent || 0) > 0) {
        player.heal(dmg * derivedStats.lifestealRangedPercent * 0.01);
      }
      let agg = hitAgg.get(hit.owner);
      if (!agg) {
        agg = { totalDmg: 0, hadHead: false, hadCrit: false, point: hit.point.clone(), dir: dir.clone(), zone: hit.zone || 'torso' };
        hitAgg.set(hit.owner, agg);
      }
      agg.totalDmg += dmg;
      if (hit.zone === 'head') { agg.hadHead = true; agg.zone = 'head'; }
      if (crit) agg.hadCrit = true;
      agg.point.copy(hit.point);
      // Ricochet — roll to bounce a second/third round to another nearby enemy.
      // Bounced damage = source dmg × ricochetDmgMult (default 0.6 from
      // skill-tree path; the Ricochet perk explicitly sets 0.5).
      if ((derivedStats.ricochetCount || 0) > 0
          && Math.random() < (derivedStats.ricochetChance || 0)) {
        const bounceMult = derivedStats.ricochetDmgMult ?? 0.6;
        spawnRicochet(hit.point, hit.owner, dmg * bounceMult, derivedStats.ricochetCount, weapon);
      }
      // Sniper Penetrator — bullet pierces N enemies before stopping.
      // Re-resolves the same ray against every hittable, then deals
      // damage to additional enemy intersections in order until either
      // a wall is reached or the penetration budget runs out. Damage
      // falls off per pierce so a 2-pierce shot doesn't 3x damage.
      // Apr-26: snipers now pierce 1 enemy by DEFAULT (innate caliber
      // behaviour) instead of requiring a skill-tree investment to
      // pierce at all. Skill-tree / class / perk grants stack on top.
      if (weapon.class === 'sniper') {
        const cap = Math.max(1, derivedStats.penetration | 0);
        const allHits = combat.raycastAll(fireFrom, dir, hitTargets, effRange);
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
          ph.owner.manager.applyHit(ph.owner, pdmg, ph.zone, dir, { weaponClass: weapon.class, shieldBreaker: !!weapon.shieldBreaker });
          if (wasAlivePh && !ph.owner.alive) {
            onEnemyKilled(ph.owner);
            awardClassXp(weapon.class, ph.owner.tier, ph.owner);
          }
          // Visual feedback at the pierce point — same magnetism as the
          // primary hit: snap to the visual center of the hit mesh so
          // the blood/impact/damage number lands on the body part.
          const _ppt = (ph.mesh && ph.owner)
            ? ph.mesh.getWorldPosition(new THREE.Vector3())
            : ph.point.clone();
          let pa = hitAgg.get(ph.owner);
          if (!pa) {
            pa = { totalDmg: 0, hadHead: false, point: _ppt, dir: dir.clone(), zone: ph.zone || 'torso' };
            hitAgg.set(ph.owner, pa);
          } else {
            pa.point = _ppt;
          }
          pa.totalDmg += pdmg;
          pierced++;
        }
      }
    } else if (hit) {
      combat.spawnImpact(hit.point);
    }
  }

  // Dervish Prayer relic — any successful player attack briefly slows
  // gunmen within radius. Stamps slowT (existing leg-shot slow system)
  // so the gunman's slowFactor multiplier kicks in for the duration.
  // Sweep runs once per fire event, not per pellet.
  if ((derivedStats.dervishSlowRadius || 0) > 0 && hitAgg.size > 0) {
    const r2 = derivedStats.dervishSlowRadius * derivedStats.dervishSlowRadius;
    const px = player.mesh.position.x, pz = player.mesh.position.z;
    const dur = derivedStats.dervishSlowDuration || 1.0;
    for (const g of gunmen.gunmen) {
      if (!g.alive) continue;
      const dx = g.group.position.x - px, dz = g.group.position.z - pz;
      if (dx * dx + dz * dz <= r2) g.slowT = Math.max(g.slowT || 0, dur);
    }
  }
  // Flush aggregated target effects. One floating damage number + at
  // most one hit sfx per shot, head-priority. Blood burst is HEAD-
  // ONLY now — body / limb hits stay clean (the impact pool's
  // muzzle / spark FX still fire per pellet via the inner shot
  // loop). Blood reads as the headshot signal at a glance.
  let anyHead = false;
  for (const agg of hitAgg.values()) {
    if (agg.hadHead) {
      combat.spawnBloodBurst(agg.point, agg.dir, 10);
    }
    spawnDamageNumber(agg.point, camera, agg.totalDmg, agg.zone, agg.hadCrit || agg.hadHead);
    if (agg.hadHead) anyHead = true;
  }
  if (hitAgg.size > 0) {
    if (anyHead) sfx.headshot(); else sfx.hit();
  }
  // Djinn's Blessing — orb fires a parallel shot once per trigger
  // pull (NOT per pellet). Aimed at the same target the main bullet
  // path resolved against, 25% damage with a normal crit roll.
  _fireDjinnShot(weapon, eff, aimTarget, hitTargets);
}

// Throttle for the "Weapon broken" toast in tickShooting — held
// triggers would otherwise spam the message at frame rate.
let _brokenToastT = 0;
// Last empty-magazine dry-fire click timestamp (ms). Held-trigger
// clicks throttle off this; tap-trigger clicks reset it.
let _emptyClickT = 0;
// ============================================================
// Akimbo dual-wield — when the player has the same lightweight
// class (pistol or SMG) in BOTH weapon slots, LMB fires the
// weapon1 hand and RMB fires the weapon2 hand. ADS is suppressed
// (no aim-down-sights animation, no ADS-spread reduction); shots
// are pure hipfire. Per-hand fire cooldowns let the player
// double-tap both triggers in alternation.
// ============================================================
function _isAkimbo() {
  const w1 = inventory?.equipment?.weapon1;
  const w2 = inventory?.equipment?.weapon2;
  if (!w1 || !w2) return false;
  if (w1.type !== 'ranged' || w2.type !== 'ranged') return false;
  const c1 = w1.class || '';
  const c2 = w2.class || '';
  if (c1 !== c2) return false;
  return c1 === 'pistol' || c1 === 'smg';
}
let _akimboLeftCdT  = 0;
let _akimboRightCdT = 0;
let _akimboRmbWasHeld = false;
// Tracks whether the off-hand weapon mesh is currently shown so we
// only call setOffhandWeapon on transitions (cheap, but the geom
// dispose inside that path isn't free either).
let _akimboVisualState = null;
function _syncAkimboVisuals() {
  if (!player || !player.setOffhandWeapon) return;
  const active = _isAkimbo();
  // Track the offhand's identity so a slot swap (e.g. player picks
  // up a different pistol into weapon2) re-attaches the visual.
  const w2 = active ? inventory.equipment.weapon2 : null;
  const key = active ? (w2.id || w2.name || 'akimbo') : 'off';
  if (key === _akimboVisualState) return;
  _akimboVisualState = key;
  if (active) {
    // Force the dominant-hand weapon to weapon1 so the LMB / RMB
    // mapping reads cleanly (left → weapon1, right → weapon2).
    if (currentWeaponIndex !== 0) setWeaponIndex(0);
    player.setOffhandWeapon(w2);
    // Defensive — make sure both weapons have ammo initialized (a
    // freshly-equipped weapon picked up off the floor would have
    // `ammo` undefined until first reload, which broke akimbo's
    // "fire on RMB" path because fireOneShot's reload-trigger
    // branch saw `weapon.ammo === undefined` and skipped fire).
    const eff1 = effectiveWeapon(inventory.equipment.weapon1);
    const eff2 = effectiveWeapon(inventory.equipment.weapon2);
    if (typeof inventory.equipment.weapon1.ammo !== 'number') {
      inventory.equipment.weapon1.ammo = eff1.magSize | 0;
    }
    if (typeof inventory.equipment.weapon2.ammo !== 'number') {
      inventory.equipment.weapon2.ammo = eff2.magSize | 0;
    }
    // Reset per-hand cooldowns + RMB rising-edge tracker so akimbo
    // engages cleanly on the very next tick, regardless of stale
    // state from a prior session.
    _akimboLeftCdT  = 0;
    _akimboRightCdT = 0;
    _akimboRmbWasHeld = false;
  } else {
    player.setOffhandWeapon(null);
  }
  // Re-render the HUD weapon bar so the L/R labels + dual-active
  // highlight track the akimbo transition.
  if (typeof renderWeaponBar === 'function') renderWeaponBar();
}
function _tickAkimbo(dt, playerInfo, inputState, aimInfo) {
  // Sync the off-hand visual every tick (cheap — early-returns if
  // nothing changed, only re-runs the mesh attach on transitions).
  _syncAkimboVisuals();
  if (!_isAkimbo()) {
    _akimboLeftCdT  = 0;
    _akimboRightCdT = 0;
    _akimboRmbWasHeld = false;
    return false;
  }
  // Reload timers tick HERE because the early-return below skips the
  // tickShooting reload loop. Without this both weapons would freeze
  // their reload mid-cycle the moment akimbo engages.
  const _w1 = inventory.equipment.weapon1;
  const _w2 = inventory.equipment.weapon2;
  if (_w1 && _w1.type === 'ranged') tickWeaponReload(_w1);
  if (_w2 && _w2.type === 'ranged') tickWeaponReload(_w2);
  // Reload key — pressing R reloads BOTH guns (whichever needs it).
  // Single press handles the common case where the player has been
  // alternating fire and both mags want a top-up. Skips guns that are
  // already reloading or already full.
  if (inputState.reloadPressed) {
    let triggered = false;
    if (_w1 && _w1.type === 'ranged') {
      const eff1 = effectiveWeapon(_w1);
      if ((_w1.ammo | 0) < (eff1.magSize | 0) && !(_w1.reloadingT > 0)) {
        tryReload(_w1); triggered = true;
      }
    }
    if (_w2 && _w2.type === 'ranged') {
      const eff2 = effectiveWeapon(_w2);
      if ((_w2.ammo | 0) < (eff2.magSize | 0) && !(_w2.reloadingT > 0)) {
        tryReload(_w2); triggered = true;
      }
    }
    if (triggered && sfx.reload) sfx.reload();
  }
  // Mirror the same combo-attack lockout the regular tickShooting
  // applies so a melee swing doesn't blast both pistols at once.
  const phase = playerInfo?.attackPhase;
  if (phase === 'startup' || phase === 'active' || phase === 'recovery') {
    return true;       // consumed input — block the regular tickShooting too
  }
  const w1 = _w1;
  const w2 = _w2;
  _akimboLeftCdT  = Math.max(0, _akimboLeftCdT  - dt);
  _akimboRightCdT = Math.max(0, _akimboRightCdT - dt);
  // RMB rising-edge — needed for semi-auto pistols. SMG fires on
  // held trigger, pistol on tap.
  const rmbHeld = !!inputState.adsHeld;
  const rmbPressed = rmbHeld && !_akimboRmbWasHeld;
  _akimboRmbWasHeld = rmbHeld;
  // Left hand (weapon1) — LMB.
  if (aimInfo.point) {
    const lWants = w1.fireMode === 'auto' ? inputState.attackHeld : inputState.attackPressed;
    if (lWants && _akimboLeftCdT <= 0) {
      const eff1 = effectiveWeapon(w1);
      // Hipfire only — pass adsHeld=false regardless of input.
      fireOneShot(playerInfo, w1, aimInfo.point, false, aimInfo.owner, aimInfo.zone);
      _akimboLeftCdT = 1 / Math.max(0.001, eff1.fireRate || w1.fireRate || 5);
    }
    // Right hand (weapon2) — RMB. Tracer + visual fire origin is
    // swapped to the off-hand muzzle for this single fireOneShot
    // call so the bullet line spawns from weapon2's barrel instead
    // of weapon1's. fireOneShot reads `playerInfo.muzzleWorld` for
    // the tracer start; we restore the dominant-hand muzzle right
    // after.
    const rWants = w2.fireMode === 'auto' ? rmbHeld : rmbPressed;
    if (rWants && _akimboRightCdT <= 0) {
      const eff2 = effectiveWeapon(w2);
      const _origMuzzle = playerInfo.muzzleWorld;
      const _origFireOrigin = playerInfo.fireOrigin;
      if (playerInfo.offhandMuzzleWorld) {
        playerInfo.muzzleWorld = playerInfo.offhandMuzzleWorld;
        // fireOrigin defaults to muzzleWorld via the `||` chain in
        // fireOneShot, so swapping muzzleWorld is enough. Leave the
        // explicit fireOrigin path alone (it's a higher-priority
        // override that some weapons set elsewhere).
      }
      fireOneShot(playerInfo, w2, aimInfo.point, false, aimInfo.owner, aimInfo.zone);
      playerInfo.muzzleWorld = _origMuzzle;
      playerInfo.fireOrigin = _origFireOrigin;
      _akimboRightCdT = 1 / Math.max(0.001, eff2.fireRate || w2.fireRate || 5);
    }
  }
  return true;
}

function tickShooting(dt, playerInfo, inputState, aimInfo) {
  // Coop downed-state lock — a downed player can't fire, swap, or
  // reload until revived. Player.update returns a stub (speed=0,
  // adsAmount=0) but the fire path runs from main.js's input
  // sample, so it needs its own gate. Without this the joiner
  // could keep shooting while ragdolled.
  if (_localDowned) return;
  // Akimbo branch fully replaces the normal fire loop when both
  // slots hold a pistol or both an SMG. Returns true when it's
  // active so the standard loop bails.
  if (_tickAkimbo(dt, playerInfo, inputState, aimInfo)) return;
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
  // Broken weapons no longer hard-stop the trigger. Per the
  // durability overhaul, a broken ranged weapon still fires but
  // with massively inflated spread (5× via tunables.durability.
  // brokenSpreadMult, applied in fireOneShot). Surface a one-shot
  // toast on the first broken-trigger pull so the player knows
  // why their grouping just exploded.
  if (weapon.durability && weapon.durability.current <= 0) {
    const wasFiring = inputState.attackHeld || inputState.attackPressed;
    if (wasFiring) {
      const now = performance.now();
      if (!_brokenToastT || now - _brokenToastT > 4000) {
        transientHudMsg('Weapon broken — spread × 5 until repaired', 1.6);
        _brokenToastT = now;
      }
    }
  }
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
    fireOneShot(playerInfo, weapon, aimInfo.point, inputState.adsHeld, aimInfo.owner, aimInfo.zone);
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

  // Empty-magazine handling — intercept BEFORE fireOneShot so the
  // dry-fire click doesn't spam at the weapon's full fire-rate.
  // Tap (rising edge) plays a click + tries reload immediately. A
  // held trigger plays a slower, louder click roughly every
  // EMPTY_CLICK_HOLD_INTERVAL seconds — the "I'm out, you can hear
  // it" cue. fireOneShot still owns the actual reload trigger so
  // the press timing for that stays unchanged.
  // Magnum Opus relic — sustained-fire past empty on full-auto
  // weapons, drain 3 HP/s. Bypasses the empty-click handler entirely
  // when conditions match. Weapon's ammo stays at 0; fireOneShot also
  // honours the override.
  const _magnumOpusFiring = (derivedStats.magnumOpusActive
    && weapon.fireMode === 'auto'
    && inputState.attackHeld
    && typeof weapon.ammo === 'number' && weapon.ammo <= 0
    && !weapon.infiniteAmmo);
  if (_magnumOpusFiring) {
    // 3 HP/s drain — applied per frame regardless of fire-rate so
    // the cost reads as a constant time-tax, not a per-shot one.
    if (player?.takeDamage) player.takeDamage(3 * dt);
  }
  if (typeof weapon.ammo === 'number' && weapon.ammo <= 0
      && !weapon.infiniteAmmo && !_magnumOpusFiring) {
    const nowMs = performance.now();
    const EMPTY_CLICK_HOLD_INTERVAL = 600;  // ms between held clicks
    if (inputState.attackPressed) {
      sfx.empty();
      _emptyClickT = nowMs;
      tryReload(weapon);
    } else if (inputState.attackHeld) {
      if (nowMs - (_emptyClickT || 0) >= EMPTY_CLICK_HOLD_INTERVAL) {
        sfx.empty({ loud: true });
        _emptyClickT = nowMs;
      }
    }
    // Don't re-arm the fire cooldown — empty pulls aren't shots.
    return;
  }

  fireOneShot(playerInfo, weapon, aimInfo.point, inputState.adsHeld, aimInfo.owner, aimInfo.zone);

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
  const ok = player.tryQuickMelee?.(weapon, facing);
  // One in the Chamber relic — every successful quick-melee swing
  // refunds a single round to the equipped gun's mag, capped at
  // effective mag size. No kill or hit requirement; the swing IS
  // the trigger ("always save one bullet").
  if (ok && derivedStats.oneInChamberActive
      && typeof weapon.ammo === 'number' && !weapon.infiniteAmmo) {
    const cap = (effectiveWeapon(weapon).magSize | 0) || weapon.magSize | 0;
    if (cap > 0 && weapon.ammo < cap) weapon.ammo = Math.min(cap, weapon.ammo + 1);
  }
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

  let _meleeHitLanded = false;
  for (const c of candidates) {
    const dx = c.group.position.x - origin.x;
    const dz = c.group.position.z - origin.z;
    const d = Math.hypot(dx, dz);
    if (d > attack.range) continue;
    const nx = dx / Math.max(0.0001, d);
    const nz = dz / Math.max(0.0001, d);
    if (nx * facing.x + nz * facing.z < halfCos) continue;
    _meleeHitLanded = true;

    const strikePoint = new THREE.Vector3(c.group.position.x, 1.2, c.group.position.z);
    let dmg = attack.damage * derivedStats.meleeDmgMult * berserkMult();
    // Crit was rolled at swing-start so the whole animation commits
    // to it. Apply the multiplier now at hit-resolve time.
    if (isCrit) dmg *= (derivedStats.critDamageMult || 2.0);
    // Broken-melee softening — held weapon at 0 durability still
    // swings but only delivers a fraction of damage. Bare-fist
    // quick-melee (no melee weapon equipped) is untouched since the
    // 'weapon' is the player's hand, not breakable.
    const _meleeWeapon = currentWeapon();
    if (_meleeWeapon && _meleeWeapon.type === 'melee'
        && _meleeWeapon.durability && _meleeWeapon.durability.current <= 0) {
      dmg *= (tunables.durability?.brokenMeleeDmgMult ?? 0.30);
    }
    const wasAlive = c.alive;
    runStats.addDamage(dmg);
    c.manager.applyHit(c, dmg, 'torso', facing, { weaponClass: 'melee', isCrit });
    runStats.noteMeleeLanded();
    c.manager.applyKnockback?.(c, {
      x: facing.x * (attack.knockback || 0) * derivedStats.knockbackMult,
      z: facing.z * (attack.knockback || 0) * derivedStats.knockbackMult,
    });
    combat.spawnImpact(strikePoint);
    spawnDamageNumber(strikePoint, camera, dmg, 'torso');
    if (derivedStats.lifestealMeleePercent > 0) {
      player.heal(dmg * derivedStats.lifestealMeleePercent * 0.01);
    }
    // Per-weapon "feel" hooks — read from the equipped weapon def.
    // Each adds a small mechanical wrinkle so blades / hammers /
    // knuckles play distinctly.
    const _wDef = currentWeapon();
    if (_wDef) {
      // Bleed-on-hit (knives, scimitars). Stamps a bleed timer on
      // the target via the existing burn/bleed enemy fields. Re-
      // applied per swing — ticks via the manager's burn handler
      // (we co-opt burnT since both are simple DoT timers).
      if (_wDef.bleedOnHit && c.alive) {
        const dur = _wDef.bleedOnHit.durationSec || 2;
        c.burnT = Math.max(c.burnT || 0, dur);
        c.burnDps = Math.max(c.burnDps || 0, _wDef.bleedOnHit.dps || 4);
      }
      // Crit-on-head bonus (brass knuckles). Already routed through
      // resolveComboHit's isCrit; the weapon flag adds a flat bump
      // to the player's crit chance for THIS swing-resolution pass.
      // Skip per-target — crit decision was made at swing-start.
    }
    if (wasAlive && !c.alive) {
      onEnemyKilled(c);
      awardClassXp('melee', c.tier, c);
      if (skillTree.level('bloodlust') > 0) buffs.grant('bloodlust', { moveSpeedMult: 1.55 }, 4);
    }
  }
  // Per-weapon finisher AoE — heavy weapons (hammers, sledgehammers)
  // shock-stagger every enemy in a small radius on the FINAL combo
  // step. Different shape from `attack.shockwaveRadius` (which is
  // already per-step on Pain): this one is opt-in via a weapon flag
  // and only fires on the last step of the combo. Knockback only,
  // no extra damage — the heavy step's own damage is the kill blow.
  const _wFinisher = currentWeapon();
  const _isFinalStep = attackEvent.isFinalStep;
  if (_isFinalStep && _wFinisher && _wFinisher.staggerOnFinisher && _meleeHitLanded) {
    const radius = _wFinisher.staggerOnFinisher.radius || 3.0;
    const r2 = radius * radius;
    const kb = (_wFinisher.staggerOnFinisher.knockback || 4.5)
      * derivedStats.knockbackMult;
    for (const c of candidates) {
      if (!c.alive) continue;
      const dx = c.group.position.x - origin.x;
      const dz = c.group.position.z - origin.z;
      if (dx * dx + dz * dz > r2) continue;
      const d = Math.hypot(dx, dz);
      if (d < 0.001) continue;
      c.manager.applyKnockback?.(c, {
        x: (dx / d) * kb,
        z: (dz / d) * kb,
      });
    }
    combat.spawnShockwave?.(
      new THREE.Vector3(origin.x, 0, origin.z),
      radius,
      0xc8c0a0,
    );
  }
  // Dervish Prayer relic — melee swing (incl. quick melee with a
  // ranged weapon equipped) slows nearby gunmen on hit. Same sweep
  // pattern as the ranged-hit branch above.
  if ((derivedStats.dervishSlowRadius || 0) > 0 && _meleeHitLanded) {
    const r2d = derivedStats.dervishSlowRadius * derivedStats.dervishSlowRadius;
    const dpx = player.mesh.position.x, dpz = player.mesh.position.z;
    const dur = derivedStats.dervishSlowDuration || 1.0;
    for (const g of gunmen.gunmen) {
      if (!g.alive) continue;
      const dx = g.group.position.x - dpx, dz = g.group.position.z - dpz;
      if (dx * dx + dz * dz <= r2d) g.slowT = Math.max(g.slowT || 0, dur);
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
      runStats.noteMeleeLanded();
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
      awardClassXp('melee', c.tier, c);
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

  // SHINIGAMI guaranteed drop — Spicy Noodles. Pushed first so it
  // always lands in the body's loot pile regardless of the rest of
  // the roll. Looked up by id from JUNK_DEFS directly since the
  // public ALL_JUNK list filters _encounter items.
  if (enemy.archetype === 'shinigami' && JUNK_DEFS && JUNK_DEFS.spicyNoodles) {
    items.push({ ...JUNK_DEFS.spicyNoodles });
  }

  // Drop economy is intentionally lean — containers + lootable props
  // carry the bulk of the items, so bodies are mostly weapon + maybe
  // a single extra. Most grunts come up entirely empty: late-game
  // rooms used to leave a graveyard of corpses each carrying a single
  // common melee, which made looting a tedious slog. 70% empty means
  // the 30% that DO drop feel meaningful again, and those are the
  // bodies that get auto-rolled into the "Loot Area" pile prompt.
  const isEmptyBody = tier === 'normal' && Math.random() < 0.70;

  if (!isEmptyBody) {
    // Weapons: most enemies drop what they were using. Some grunts
    // come up gun-only (no melee fallback).
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
    } else if (tier === 'boss') {
      const pick = meleePool[Math.floor(Math.random() * meleePool.length)];
      if (pick) items.push(wrapWeapon(pick));
    }
    // Sub-bosses no longer auto-roll an extra melee weapon — keep the
    // drop count tight.
  }

  // Armor — bosses drop two pieces, sub-bosses one, grunts almost
  // never. Containers handle most armor distribution now. Upgrade
  // odds scale with floor index (BALANCE.loot.armorUpgrade).
  let armorCount = 0;
  if (tier === 'boss')         armorCount = 2;
  else if (tier === 'subBoss') armorCount = 1;
  else if (!isEmptyBody && Math.random() < 0.10) armorCount = 1;
  const _LU = BALANCE.loot.armorUpgrade;
  const tierBonus = tier === 'boss' ? _LU.bossBonus : tier === 'subBoss' ? _LU.subBossBonus : 0;
  const upgradeChance = Math.min(_LU.cap, (levelIdx * _LU.perFloorSlope) + tierBonus);
  for (let i = 0; i < armorCount; i++) {
    const base = randomArmor();
    const piece = {
      ...base,
      durability: base.durability ? { ...base.durability } : undefined,
    };
    if (Math.random() < upgradeChance) {
      const roll = Math.random();
      if (tier === 'boss') {
        const tbl = _LU.bossRoll;
        piece.rarity = roll < tbl.epic ? 'epic' : roll < tbl.rare ? 'rare' : 'uncommon';
      } else if (tier === 'subBoss') {
        piece.rarity = roll < _LU.subBossRoll.rare ? 'rare' : 'uncommon';
      } else {
        piece.rarity = 'uncommon';
      }
    }
    items.push(piece);
  }

  // Healing — bosses guarantee, sub-bosses sometimes, grunts rarely.
  const healChance = tier === 'boss' ? 0.75 : tier === 'subBoss' ? 0.30 : (isEmptyBody ? 0 : 0.08);
  if (Math.random() < healChance) {
    const heals = ALL_CONSUMABLES.filter(c => c.useEffect?.kind === 'heal');
    if (heals.length) {
      const pool = tier === 'boss' ? heals
        : tier === 'subBoss' ? heals.filter(h => h.rarity !== 'rare')
        : heals.filter(h => h.rarity === 'common');
      const src = pool.length ? pool : heals;
      items.push({ ...src[Math.floor(Math.random() * src.length)] });
    }
  }

  // Tier-specific extras. Grunts now skip these almost entirely (the
  // 70% empty roll above already strips most of them), so to keep
  // total run loot roughly flat we push more onto the bosses + sub-
  // bosses. Each elite kill should feel like opening a small chest.
  //
  // Floor-gated rarity rolls — see BALANCE.loot. Floor-1 sub-bosses
  // were dropping forced epics; this scales the rates up gradually
  // and caps them late-game.
  const _gateBoss     = BALANCE.loot.bossGear;
  const _gateBoss2    = BALANCE.loot.bossSecondGear;
  const _gateSubBoss  = BALANCE.loot.subBossGear;
  const _floorEpic    = (g) => Math.min(g.epicCap, (g.epicBase || 0) + g.epicSlope * levelIdx);
  const _floorRare    = (g) => Math.min(g.rareCap, (g.rareBase || 0) + g.rareSlope * levelIdx);
  const _floorLegend  = (g) => Math.min(g.legendaryCap, g.legendarySlope * levelIdx);
  if (tier === 'boss') {
    const g = randomGear();
    const gearR = Math.random();
    let bossRarity;
    if (gearR < _floorLegend(_gateBoss))                           bossRarity = 'legendary';
    else if (gearR < _floorLegend(_gateBoss) + _floorEpic(_gateBoss)) bossRarity = 'epic';
    else                                                           bossRarity = 'rare';   // boss primary always at least rare
    items.push({ ...g, rarity: bossRarity,
      durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } });
    // Extra gear roll on bosses — second piece is rarely legendary
    // but reads as "boss room actually pays out."
    if (Math.random() < 0.55) {
      const g2 = randomGear();
      const r2 = Math.random();
      let g2Rarity;
      if (r2 < _floorEpic(_gateBoss2))                          g2Rarity = 'epic';
      else if (r2 < _floorEpic(_gateBoss2) + _floorRare(_gateBoss2)) g2Rarity = 'rare';
      else                                                      g2Rarity = 'uncommon';
      items.push({ ...g2, rarity: g2Rarity,
        durability: { ...(g2.durability || { current: 100, max: 100, repairability: 0.9 }) } });
    }
    if (Math.random() < 0.18) items.push(randomAttachment());
    if (Math.random() < 0.60) items.push(randomJunk());
    if (Math.random() < 0.30) items.push(randomThrowable());
  } else if (tier === 'subBoss') {
    // Sub-boss gear roll bumped 0.55 → 0.80 with a higher rarity floor.
    if (Math.random() < 0.80) {
      const g = randomGear();
      const r = Math.random();
      let sbRarity;
      if (r < _floorEpic(_gateSubBoss))                          sbRarity = 'epic';
      else if (r < _floorEpic(_gateSubBoss) + _floorRare(_gateSubBoss)) sbRarity = 'rare';
      else                                                       sbRarity = 'uncommon';
      items.push({ ...g, rarity: sbRarity,
        durability: { ...(g.durability || { current: 100, max: 100, repairability: 0.9 }) } });
    }
    if (Math.random() < 0.14) items.push(randomAttachment());
    if (Math.random() < 0.45) items.push(randomJunk());
    if (Math.random() < 0.20) items.push(randomThrowable());
    // Second consumable on sub-bosses so a clean kill rewards more
    // than just the gear piece.
    if (Math.random() < 0.30) {
      const heals = ALL_CONSUMABLES.filter(c =>
        c.useEffect?.kind === 'heal' || c.useEffect?.kind === 'buff');
      if (heals.length) items.push({ ...heals[Math.floor(Math.random() * heals.length)] });
    }
  } else if (!isEmptyBody) {
    // Grunt drop only fires on the 30% non-empty roll. Bumped slightly
    // since the surviving 30% needs to feel like the right corpse to
    // walk over to.
    if (Math.random() < 0.04) items.push(randomAttachment());
    if (Math.random() < 0.18) items.push(randomJunk());
    if (Math.random() < 0.05) items.push(randomThrowable());
  }
  // Repair-kit drop — independent of the empty-body roll so a clean
  // grunt corpse can still surface a kit. Chance scales with tier:
  //   boss     45% (almost always)
  //   subBoss  18%
  //   normal    7% (skipped on empty bodies)
  const repairKitChance = tier === 'boss' ? 0.45
    : tier === 'subBoss' ? 0.18
    : (isEmptyBody ? 0 : 0.07);
  if (Math.random() < repairKitChance) items.push(randomEitherRepairKit());
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
  // Mirror Encounter — clone drops a guaranteed mastercraft version
  // of the player's currently equipped weapon. We snapshot the
  // weapon NOW (not at clone-spawn time) since the player may have
  // swapped between rounds.
  if (enemy && enemy.mirrorClone) {
    const w = currentWeapon();
    if (w) {
      const drop = JSON.parse(JSON.stringify(w));
      // Bump rarity ladder one tier first so forceMastercraft sees
      // the upgraded rarity when it stamps the name + bumps stats.
      const ladder = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      const idx = ladder.indexOf(drop.rarity || 'common');
      if (idx < ladder.length - 1) drop.rarity = ladder[idx + 1];
      // Use forceMastercraft instead of just flipping the flag — bumps
      // affix values, useEffect numbers, and stamps the visible
      // MASTERCRAFT tag. Flag-only assignment shipped "mastercraft"
      // weapons with the same stat numbers as a regular drop.
      forceMastercraft(drop);
      // Spawn next to the corpse via loot system.
      loot.spawnItem({ x: enemy.group.position.x + 0.6, y: 0.4, z: enemy.group.position.z }, drop);
    }
  }
  // opts.silent — skip witness alerts and the death sfx. Used by the
  // execute path so a back-stab doesn't give the player's position
  // away to the rest of the room.
  // Summoned minions (necromant adds, etc.) bypass loot + xp + credits
  // entirely — they're combat pressure, not a farming target.
  if (!enemy.noDrops) {
    enemy.loot = buildBodyLoot(enemy);
    enemy.looted = false;
  } else {
    enemy.loot = [];
    enemy.looted = true;
  }
  if (!enemy.noXp) awardKillXp(enemy);
  // Coop attribution: when a joiner caused this kill (rpc-shoot wraps
  // applyHit in a thread-local that names the killing peer), route
  // credits + skill points + contract archetype to them instead of
  // to the host. Host self-kills run the local path as before.
  const _coopT_kill = (typeof getCoopTransport === 'function') ? getCoopTransport() : null;
  const _coopClaimer = (typeof window !== 'undefined') ? window.__coopCurrentClaimer : null;
  // Resolve the kill's archetype once — contract evaluators read it.
  let arch = null;
  if (enemy.tier === 'boss' || enemy.tier === 'subBoss') arch = 'boss';
  else if (enemy.kind === 'melee') arch = 'melee';
  else if (enemy.variant === 'dasher') arch = 'dasher';
  else if (enemy.variant === 'tank') arch = 'tank';
  else if (enemy.kind === 'gunman') arch = 'gunman';
  if (_coopClaimer && _coopT_kill?.isOpen && _coopT_kill.isHost) {
    // Joiner kill — bundle every reward (credits + skill points +
    // kill count + archetype for contract progress) into one rpc.
    // Skip the host's local apply entirely so we don't double-credit.
    // Skip coin VFX too — the joiner's own client spawns it via the
    // rpc-grant-rewards handler.
    const credits = (!enemy.noXp ? rollCredits(enemy.tier || 'normal') : 0)
      + (!enemy.noXp && artifacts?.has('lucky_dice')
          ? ((1 + Math.floor(Math.random() * 6)) + (1 + Math.floor(Math.random() * 6)))
          : 0);
    const skillPts = enemy.tier === 'subBoss' ? 1 : 0;
    try {
      _coopT_kill.send('rpc-grant-rewards', {
        c: credits | 0,
        sp: skillPts | 0,
        a: arch || '',
        k: 1,
        // Pass the kill position so the joiner's client can spawn the
        // coin burst at the corpse, not at their own player.
        x: +(enemy.group?.position?.x?.toFixed(2) ?? 0),
        z: +(enemy.group?.position?.z?.toFixed(2) ?? 0),
      }, _coopClaimer);
    } catch (_) {}
  } else {
    // Host (or single-player) self-kill — run the local reward path.
    let totalCredits = 0;
    if (!enemy.noXp) {
      const gained = rollCredits(enemy.tier || 'normal');
      if (gained > 0) { playerCredits += gained; runStats.addCredits(gained); totalCredits += gained; }
      if (artifacts && artifacts.has('lucky_dice')) {
        const dice = (1 + Math.floor(Math.random() * 6)) + (1 + Math.floor(Math.random() * 6));
        playerCredits += dice;
        runStats.addCredits(dice);
        totalCredits += dice;
      }
    }
    if (totalCredits > 0 && enemy.group?.position) {
      try { spawnKillCoins(enemy.group.position, totalCredits); } catch (_) {}
    }
    if (enemy.tier === 'subBoss') {
      playerSkillPoints += 1;
      _showSkillPointToast(1);
    }
    runStats.addKill();
    try {
      runStats.noteArchetypeKill(arch);
      _applyContractPerKillReward(arch);
    } catch (e) { /* defensive — contract path must never break a kill */ }
  }
  // Corpse position fix-up — if the body's last position landed inside
  // a wall / pillar / prop AABB, push it out so the loot prompt can
  // actually see it. Bosses ragdolling at the moment of death sometimes
  // settled with their centroid clipped into a column; level.unstickFrom
  // shoves the position out of the nearest collider face.
  if (enemy.group && level && typeof level.unstickFrom === 'function') {
    const ep = enemy.group.position;
    const fixed = level.unstickFrom(ep.x, ep.z, 0.45);
    // Run a second pass — overlapping obstacles can mean the first
    // pop-out lands in a neighbour. Two iterations cover the corner
    // case without risking infinite loops.
    const fixed2 = level.unstickFrom(fixed.x, fixed.z, 0.45);
    if (fixed2.x !== ep.x || fixed2.z !== ep.z) {
      ep.x = fixed2.x; ep.z = fixed2.z;
    }
  }
  combat.spawnBloodPool(enemy.group.position, 0.75 + Math.random() * 0.25);
  if (artifacts.has('red_string')) {
    buffs.grant('red_string', { damageMult: 1.5 }, 4);
  }
  // Fast Magazine — refill a fraction of the active weapon's mag on
  // ANY kill (bullet, projectile, melee, burn DoT, AoE). Previously
  // only fired from the bullet-hit callsite which left burn /
  // explosion / melee kills unrewarded; the player observed the skill
  // as "not working" because most build-killing hits skipped it.
  if ((derivedStats.reloadOnKill || 0) > 0) {
    const w = currentWeapon();
    if (w && typeof w.ammo === 'number' && !w.infiniteAmmo) {
      const eff = effectiveWeapon(w);
      const cap = eff.magSize || w.magSize || 0;
      if (cap > 0 && w.ammo < cap) {
        const add = Math.max(1, Math.round(cap * derivedStats.reloadOnKill));
        w.ammo = Math.min(cap, w.ammo + add);
      }
    }
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
    // Mythics are boss-only AND rare — 3% baseline so a successful
    // run *might* yield one. Mourner's Bell relic raises the floor
    // to 6% as a counterweight to its incoming-damage curse.
    const _mythicChance = Math.max(0.03, derivedStats.mythicDropChanceFloor || 0);
    if (Math.random() < _mythicChance) {
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
      renderWeaponBar();
    } else if ((derivedStats.throwableRefundOnKill | 0) > 0) {
      const refund = derivedStats.throwableRefundOnKill | 0;
      for (const it of inventory.allThrowables()) {
        const max = throwableMaxCharges(it);
        it.charges = Math.min(max, (it.charges | 0) + refund);
        if (it.charges >= max) it.cooldownT = 0;
      }
      renderActionBar();
      renderWeaponBar();
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
// Death-recap accumulator. Tracks per-source cumulative damage to
// the player + the most recent hit's zone / distance, so the death
// screen can show "Killed by THE BURN — 47 dmg, hit chest at 4.2m".
// Reset on new run via runStats.reset hook below.
const _attackerStats = new Map();   // source ref → { name, dmg, zone, distance, type, hits }
let _lastFatalHit = null;           // { source, name, zone, distance, type, amount }
function _enemyDisplayName(src) {
  if (!src) return 'unknown';
  if (src.majorBoss && src.archetype) return BOSS_NAMES?.[src.archetype] || 'BOSS';
  if (src.tier === 'subBoss') return 'Sub-Boss';
  if (src.tier === 'boss')   return 'Elite';
  if (src.archetype)         return String(src.archetype).toUpperCase();
  if (src.kind === 'melee')  return 'Melee Enemy';
  return 'Gunman';
}
function _resetDeathRecap() { _attackerStats.clear(); _lastFatalHit = null; }
const _origRunStatsReset = runStats.reset.bind(runStats);
runStats.reset = function () {
  _origRunStatsReset();
  _resetDeathRecap();
  // Cross-run flags — runStats.reset clears per-run defaults, but
  // these mirror persistent prefs so the in-run code paths read the
  // saved state immediately (Great Bear merchant unlock, priest
  // condition gate). Refusals are NOT mirrored — the priest reads
  // from getPriestRefusals() directly.
  if (typeof getDemonBearGranted === 'function' && getDemonBearGranted()) {
    runStats.hasDemonBear = true;
  }
};

// Fire-stack escalator — every consecutive second the player spends
// taking 'fire' damage adds a flat +1× to the next fire tick, with
// NO cap. Stops the "stand in the fire pool because it's only 4 dps"
// play pattern: the longer you linger, the worse it gets, runaway.
// Decays fast (0.6s half-life) when no fire damage lands so a brief
// crossover doesn't carry stacks forever.
let _playerFireStandT = 0;
let _playerFireLastTickT = 0;
const _PLAYER_FIRE_STACK_PER_SEC = 1.0;   // additive per second of exposure
// Coop tick — broadcast local player XZ at 5Hz under kind='pos',
// and lerp ghost meshes toward each peer's latest reported position.
// THIS IS SCAFFOLDING — replaced by snapshot-driven rendering when
// the authoritative simulation lands. Cheap no-op when coop is off
// or the transport isn't connected.
function _tickCoop(dt) {
  if (!coopLobby || !coopGhostRoot) return;
  const transport = getCoopTransport();
  if (!transport.isOpen) {
    // Tear down ghosts on disconnect so a stale peer marker doesn't
    // sit in the scene forever.
    if (_coopGhostMeshes.size) {
      for (const [, m] of _coopGhostMeshes) {
        if (m.group?.parent) m.group.parent.remove(m.group);
      }
      _coopGhostMeshes.clear();
    }
    return;
  }
  // Broadcast our position at 5Hz — cheap, fits in a packet, gives
  // each remote client enough samples to lerp smoothly between.
  // Now also carries pose bits (crouched / aiming) so the remote
  // ally rig can read them, plus a firing-event flag that fires a
  // muzzle flash + tracer on the receiver. _coopFiredThisTick is
  // set by the local fire path and consumed (cleared) here.
  _coopBroadcastT -= dt;
  if (_coopBroadcastT <= 0) {
    _coopBroadcastT = 0.2;
    if (player?.mesh?.position) {
      const pi = lastPlayerInfo;
      const wpn = currentWeapon?.();
      transport.send('pos', {
        x: player.mesh.position.x,
        z: player.mesh.position.z,
        f: player.mesh.rotation.y || 0,
        // Pose bits — crouched (0/1), aim blend (0..1, eased), and
        // weapon class so the remote rig adopts the right hold
        // pose (rifle vs pistol vs sniper). Dashing is a momentary
        // burst flag; rig anim treats it as a speed multiplier.
        c: pi?.crouched ? 1 : 0,
        a: +(pi?.adsAmount ?? 0).toFixed(2),
        d: (pi?.mode === 'dash' || pi?.mode === 'slide') ? 1 : 0,
        wc: wpn?.class || 'pistol',
        // Dual-opt-in extract — peer is standing in the exit zone
        // and ready to advance. Host gates advanceFloor on this
        // being true for every joiner ghost. Cheap (single bit on
        // the existing 5Hz pos packet, no new kind).
        xt: _localInExit ? 1 : 0,
        // Reload bit — drives the small "reloading" sphere above
        // the ally's head. Source of truth is weapon.reloadingT.
        // Weapon-swap is detected on the receiver as a change in
        // `wc`; no extra field needed.
        r: (wpn && wpn.reloadingT > 0) ? 1 : 0,
        // Active-buff bit — drives a soft cyan ground ring under
        // the ally rig. 1 = any buff in BuffState.buffs is live.
        // Used for adrenaline / combat stim / energy drink / red
        // string / bloodlust visibility at iso distance.
        bf: (buffs && buffs.buffs.length > 0) ? 1 : 0,
      });
    }
  }
  // Snapshot publish — host only. Authoritative enemy state goes out
  // at 20Hz so joiners can lerp through the gap between packets. v1
  // is full-state JSON; delta-encoding lands when bandwidth becomes
  // a real constraint, which won't happen until we sync more entity
  // types (projectiles, loot, doors).
  if (transport.isHost && level && gunmen && melees) {
    _coopSnapshotT -= dt;
    if (_coopSnapshotT <= 0) {
      _coopSnapshotT = 1 / 20;
      _coopSnapshotSeq = (_coopSnapshotSeq + 1) | 0;
      // Per-peer snapshots so each joiner only receives their
      // instanced loot (claimedBy === self) plus shared loot
      // (claimedBy === null). Enemy section is identical across
      // recipients; the encoder builds it once and clones the
      // outer object per peer.
      const peerIds = [];
      for (const pid of transport.peers.keys()) {
        if (pid !== transport.peerId) peerIds.push(pid);
      }
      if (peerIds.length === 0) {
        // No joiners yet — skip the broadcast entirely. Saves a
        // packet per snapshot tick on a host-alone room.
      } else {
        const perPeer = encodeSnapshotsPerPeer(
          gunmen, melees, _coopSnapshotSeq, performance.now() | 0,
          loot, peerIds, drones, megaBoss,
        );
        for (const [peerId, snap] of perPeer) {
          transport.send('snapshot', snap, peerId);
        }
      }
    }
  } else if (!transport.isHost) {
    // Joiner — render at T-100ms by interpolating between two
    // adjacent received snapshots. Smoother than chasing a single
    // moving target with a per-frame lerp at 20Hz packets.
    applyInterpolated(gunmen, melees, loot, (pos, stubItem) => {
      try { return loot.spawnItem(pos, stubItem); }
      catch (_) { return null; }
    });
    // Drones — same interp pair, separate apply since the manager
    // isn't part of the gunmen/melees aggregate.
    const dpair = pickInterpSnapshots();
    if (dpair && drones) {
      applyDroneSnapshot(dpair.a, dpair.b, drones, (x, y, z) => {
        try { return drones.spawn(x, y, z); }
        catch (_) { return null; }
      }, dpair.alpha);
    }
  }
  // Sync ghost meshes — create/update per-peer, prune disconnected.
  const seen = new Set();
  for (const [peerId, ghost] of coopLobby.ghosts) {
    seen.add(peerId);
    // Dead peers get frozen in place — skip the create + sync entirely
    // so the corpse marker stays exactly where rpc-peer-died left it.
    // Pruning still runs at the end (corpse persists until peer leaves
    // the room).
    if (ghost.dead) continue;
    let m = _coopGhostMeshes.get(peerId);
    if (!m) {
      // Real ally rig — same skeleton + animation as the gunmen so
      // walk / idle pose is identical to the player's silhouette.
      // Per-peer tint: hash peerId to one of a friendly palette so
      // teammates are visually distinct at iso distance.
      const palette = [
        { body: 0x3a6ab0, head: 0xd0a070 },   // blue
        { body: 0x6a9b4a, head: 0xc8a880 },   // green
        { body: 0xa05030, head: 0xc89070 },   // copper
        { body: 0x7a4ab0, head: 0xb09070 },   // violet
      ];
      let h = 0;
      for (let i = 0; i < (peerId?.length || 0); i++) {
        h = ((h << 5) - h + peerId.charCodeAt(i)) | 0;
      }
      const tone = palette[((h % palette.length) + palette.length) % palette.length];
      const rig = _buildAllyRig({
        scale: 0.77,
        bodyColor: tone.body,
        headColor: tone.head,
        legColor:  0x1a1f28,
        armColor:  tone.body,
        handColor: 0x2a1612,
        gearColor: 0x1a1f28,
        bootColor: 0x0a0a0a,
      });
      _initAllyAnim(rig);
      const group = rig.group;
      // Gun box on the wrist — same mount + orientation as the local
      // player's box gunMesh. Without this remote allies look like
      // they're miming with empty hands. Class-driven sizing comes
      // from the broadcast 'wc' field; we resize on each pos packet.
      const gunMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, roughness: 0.55, metalness: 0.4,
      });
      const gunMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), gunMat);
      gunMesh.scale.setScalar(rig.scale || 0.77);
      gunMesh.castShadow = true;
      gunMesh.rotation.x = Math.PI / 2;
      gunMesh.position.set(0, -(0.1 + 0.25) * (rig.scale || 0.77), 0);
      if (rig.rightArm?.wrist) rig.rightArm.wrist.add(gunMesh);
      coopGhostRoot.add(group);
      // Reload indicator — small emissive sphere parked above the
      // ally's head. Hidden by default; flipped visible when their
      // weapon.reloadingT > 0 (broadcast as the `r` pos bit).
      const reloadMat = new THREE.MeshBasicMaterial({
        color: 0xffd070, transparent: true, opacity: 0.85,
        depthWrite: false,
      });
      const reloadDot = new THREE.Mesh(
        new THREE.SphereGeometry(0.10, 10, 8), reloadMat,
      );
      reloadDot.position.y = (rig.scale || 0.77) * 2.5;
      reloadDot.visible = false;
      group.add(reloadDot);
      // Buff-active ring — soft cyan disc on the ground under the
      // ally rig. Visible while any buff is live on the peer (the
      // `bf` pos bit). Mirror of the local-player aura tells you
      // your teammate just popped a stim / adrenaline / etc.
      const buffMat = new THREE.MeshBasicMaterial({
        color: 0x60d0ff, transparent: true, opacity: 0.35,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const buffRing = new THREE.Mesh(
        new THREE.RingGeometry(0.45 * (rig.scale || 0.77), 0.55 * (rig.scale || 0.77), 24),
        buffMat,
      );
      buffRing.rotation.x = -Math.PI / 2;
      buffRing.position.y = 0.04;
      buffRing.visible = false;
      group.add(buffRing);
      m = {
        group, rig, gunMesh, reloadDot, reloadMat, buffRing, buffMat,
        lastX: ghost.x, lastZ: ghost.z,
        lastAnimT: (typeof performance !== 'undefined') ? performance.now() / 1000 : 0,
        // Last-seen weapon class — used to detect swaps on the
        // receiver. When this changes, kick a brief swap-pop
        // animation on the gun mesh (lower + raise).
        lastWc: ghost.weaponClass || 'pistol',
        swapPopT: 0,
      };
      _coopGhostMeshes.set(peerId, m);
    }
    // Per-class scale of the gun box — pistol is ~0.5×, rifle/shotgun
    // ~0.9×. Matches the local-player CLASS_SCALE in player.js.
    if (m.gunMesh) {
      const cls = ghost.weaponClass || 'pistol';
      // Detect swap by comparing against last-seen class. Triggers
      // a 0.35s pop where the gun mesh dips and rises — a quick
      // visual cue the teammate just changed weapons.
      if (cls !== m.lastWc) {
        m.lastWc = cls;
        m.swapPopT = 0.35;
      }
      const cs = (cls === 'pistol') ? 0.5
              : (cls === 'smg') ? 0.75
              : 0.9;
      const target = cs * (m.rig?.scale || 0.77);
      const cur = m.gunMesh.scale.x;
      // Cheap lerp so weapon-swap doesn't pop.
      const k = Math.min(1, dt / 0.18);
      m.gunMesh.scale.setScalar(cur + (target - cur) * k);
      // Swap-pop offset on the wrist-relative position. Linear up-
      // and-down sine over the popT window. Reload also drops the
      // gun mesh slightly so a teammate with weapon down reads as
      // "not ready" — pairs with the floating reload dot indicator.
      const baseY = -(0.1 + 0.25) * (m.rig?.scale || 0.77);
      const reloadDrop = ghost.reloading ? 0.06 : 0;
      if (m.swapPopT > 0) {
        m.swapPopT = Math.max(0, m.swapPopT - dt);
        const phase = 1 - (m.swapPopT / 0.35);  // 0..1
        const dip = Math.sin(phase * Math.PI) * 0.08;
        m.gunMesh.position.y = baseY - dip - reloadDrop;
      } else {
        m.gunMesh.position.y = baseY - reloadDrop;
      }
    }
    // Reload indicator — visible while ghost.reloading; pulses via
    // emissive opacity for legibility at iso distance. Skip the
    // opacity write when invisible to avoid Three.js material
    // dirty-flag work each frame.
    if (m.reloadDot) {
      const isReloading = !!ghost.reloading && !ghost.dead;
      if (m.reloadDot.visible !== isReloading) m.reloadDot.visible = isReloading;
      if (isReloading && m.reloadMat) {
        const tnow = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
        m.reloadMat.opacity = 0.55 + 0.35 * Math.abs(Math.sin(tnow * 6));
      }
    }
    // Buff ring — visible while ghost.buffActive; subtle pulse so
    // it reads as "ally just popped a stim" without being loud.
    if (m.buffRing) {
      const isBuffed = !!ghost.buffActive && !ghost.dead;
      if (m.buffRing.visible !== isBuffed) m.buffRing.visible = isBuffed;
      if (isBuffed && m.buffMat) {
        const tnow = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
        m.buffMat.opacity = 0.25 + 0.18 * Math.abs(Math.sin(tnow * 3));
      }
    }
    // Lerp 1/0.2s toward the most-recent reported position. Catches
    // up smoothly without feeling rubber-bandy at typical packet
    // jitter.
    const k = Math.min(1, dt / 0.18);
    const prevX = m.lastX, prevZ = m.lastZ;
    m.lastX += (ghost.x - m.lastX) * k;
    m.lastZ += (ghost.z - m.lastZ) * k;
    m.group.position.set(m.lastX, 0, m.lastZ);
    // Rig animation — derive speed from position delta, face the
    // movement heading. updateAnim drives the walk / idle blend
    // identically to gunmen, so the ally reads as a real player
    // rather than a placeholder. Idle pose when standing still.
    if (m.rig) {
      const mvx = m.lastX - prevX;
      const mvz = m.lastZ - prevZ;
      const moveLen = Math.hypot(mvx, mvz);
      const speed = moveLen / Math.max(0.001, dt);
      // Face the direction of motion when moving; hold last yaw
      // when still so we don't whip back to facing 0.
      if (moveLen > 0.005) {
        const targetYaw = Math.atan2(mvx, mvz);
        // Shortest-arc lerp to the target yaw.
        let dyaw = targetYaw - m.group.rotation.y;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        m.group.rotation.y += dyaw * Math.min(1, dt / 0.12);
      }
      try {
        // Match the local player's updateAnim contract exactly.
        // Field names matter: rig consumes `crouched` (not
        // crouching), `aiming` as a 0..1 blend (not bool),
        // `dashing` boolean, `rifleHold` boolean, `weaponClass`
        // string, `aimYaw` radians.
        const aiming = (typeof ghost.aiming === 'number')
          ? ghost.aiming
          : (ghost.aiming ? 1 : 0);
        const cls = ghost.weaponClass || 'pistol';
        const rifleHold = aiming > 0.05 || cls === 'rifle' || cls === 'sniper'
          || cls === 'shotgun' || cls === 'lmg' || cls === 'smg';
        _updateAllyAnim(m.rig, {
          speed,
          aiming,
          crouched: !!ghost.crouched,
          dashing:  !!ghost.dashing,
          rifleHold,
          weaponClass: cls,
          aimYaw: typeof ghost.yaw === 'number' ? ghost.yaw : 0,
          aimPitch: 0,
          handedness: 1,
        }, dt);
      } catch (_) { /* defensive — animation should never crash a frame */ }
    }
  }
  for (const peerId of [..._coopGhostMeshes.keys()]) {
    if (seen.has(peerId)) continue;
    const m = _coopGhostMeshes.get(peerId);
    if (m?.group?.parent) m.group.parent.remove(m.group);
    _coopGhostMeshes.delete(peerId);
  }
  // HUD compass — always-visible chip listing peers + their offset
  // from the local player. Useful when the seed-sync hasn't landed
  // yet and ghosts are off-camera in mismatched geometry, since
  // the chip still updates per-frame and confirms the wire is alive.
  _renderCoopHud();
}

let _coopHudEl = null;
let _coopArrowsRoot = null;
const _coopPeerArrows = new Map();   // peerId → div element
function _renderCoopHud() {
  if (!coopLobby) return;
  if (!_coopHudEl) {
    const el = document.createElement('div');
    el.id = 'coop-hud';
    Object.assign(el.style, {
      position: 'fixed', right: '10px', top: '60px', zIndex: '6',
      background: 'rgba(12,14,20,0.85)', border: '1px solid #4a8acf',
      borderRadius: '4px', padding: '8px 12px',
      color: '#a0c0ff', font: '12px ui-monospace, Menlo, Consolas, monospace',
      letterSpacing: '0.6px', lineHeight: '1.5', pointerEvents: 'none',
      minWidth: '200px', maxWidth: '260px', display: 'none',
      boxShadow: '0 2px 12px rgba(0,0,0,0.6), 0 0 8px rgba(80,140,255,0.3)',
    });
    document.body.appendChild(el);
    _coopHudEl = el;
  }
  // Screen-edge peer arrows — independent overlay that points toward
  // each peer regardless of camera frustum or wall occlusion. One arrow
  // div per peer, repositioned every frame.
  if (!_coopArrowsRoot) {
    const root = document.createElement('div');
    root.id = 'coop-arrows-root';
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '5',
      pointerEvents: 'none',
    });
    document.body.appendChild(root);
    _coopArrowsRoot = root;
  }
  const transport = getCoopTransport();
  if (!transport.isOpen) {
    _coopHudEl.style.display = 'none';
    for (const a of _coopPeerArrows.values()) a.style.display = 'none';
    return;
  }
  const px = player?.mesh?.position?.x ?? 0;
  const pz = player?.mesh?.position?.z ?? 0;
  const seedHex = _runSeed ? `0x${(_runSeed >>> 0).toString(16).padStart(8, '0')}` : 'NOT SET';
  const lvIdx = (level?.index | 0);
  const room = transport.roomCode || '—';
  const role = transport.isHost ? 'HOST' : (transport.peerId ? 'JOIN' : '?');
  const lines = [
    `<div style="color:#f2c060;font-weight:700;letter-spacing:1.4px">CO-OP · ${role} · room ${room}</div>`,
    `<div style="color:#9b8b6a;font-size:10px">peers: ${transport.peers.size}, you=${transport.peerId || '?'}, host=${transport.hostId || '?'}</div>`,
    `<div style="color:#6f7990;font-size:10px">you @ ${px.toFixed(1)}, ${pz.toFixed(1)} · F${lvIdx}</div>`,
    `<div style="color:${_runSeed ? '#a0c0a0' : '#f08080'};font-size:10px">seed: ${seedHex}</div>`,
  ];
  const seen = new Set();
  for (const [peerId, ghost] of coopLobby.ghosts) {
    seen.add(peerId);
    const dx = ghost.x - px;
    const dz = ghost.z - pz;
    const dist = Math.hypot(dx, dz);
    // Screen-space heading: in iso top-down, +Z is "down" on screen,
    // -Z is "up". So a peer with positive dx is east on screen, etc.
    const angWorld = Math.atan2(dx, -dz);   // 0 = north
    const arrow = _arrowForAngle(angWorld);
    const name = transport.peers.get(peerId)?.name || 'peer';
    lines.push(
      `<div><span style="color:#6abfff;font-size:14px">${arrow}</span> `
      + `${_escHtml(name)} <span style="color:#6f7990">${dist.toFixed(1)}m</span> `
      + `<span style="color:#3a4458;font-size:10px">@ ${ghost.x.toFixed(1)}, ${ghost.z.toFixed(1)}</span></div>`,
    );
    _updatePeerEdgeArrow(peerId, name, dx, dz, dist);
  }
  if (transport.rtt != null) {
    lines.push(`<div style="color:#6f7990;margin-top:2px;font-size:10px">rtt ${transport.rtt}ms</div>`);
  }
  // Prune stale edge arrows for peers that left.
  for (const peerId of [..._coopPeerArrows.keys()]) {
    if (!seen.has(peerId)) {
      const a = _coopPeerArrows.get(peerId);
      if (a?.parentNode) a.parentNode.removeChild(a);
      _coopPeerArrows.delete(peerId);
    }
  }
  _coopHudEl.innerHTML = lines.join('');
  _coopHudEl.style.display = 'block';
}
function _updatePeerEdgeArrow(peerId, name, dx, dz, dist) {
  // Screen-edge arrow — projects the peer's world-space offset onto
  // the screen via the active camera. If the peer is on-screen, the
  // arrow hides (the cyan ghost mesh + beacon are visible). Off-screen,
  // the arrow clamps to the screen edge with the peer name + distance.
  let el = _coopPeerArrows.get(peerId);
  if (!el) {
    el = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', transform: 'translate(-50%, -50%)',
      padding: '4px 8px',
      background: 'rgba(12,14,20,0.85)',
      border: '1px solid #6abfff', borderRadius: '14px',
      color: '#a0d0ff', font: '11px ui-monospace, Menlo, Consolas, monospace',
      letterSpacing: '0.6px', whiteSpace: 'nowrap',
      boxShadow: '0 0 10px rgba(80,180,255,0.5)',
      pointerEvents: 'none', display: 'none',
    });
    _coopArrowsRoot.appendChild(el);
    _coopPeerArrows.set(peerId, el);
  }
  // Project peer world position to screen via camera. Reuse existing
  // camera + renderer canvas. THREE projections require a Vector3.
  if (!camera || !renderer || !player?.mesh?.position) {
    el.style.display = 'none';
    return;
  }
  const cnv = renderer.domElement;
  const w = cnv.clientWidth || window.innerWidth;
  const h = cnv.clientHeight || window.innerHeight;
  const peerWorld = (_updatePeerEdgeArrow._v
    || (_updatePeerEdgeArrow._v = new THREE.Vector3()));
  peerWorld.set(player.mesh.position.x + dx, 0.5, player.mesh.position.z + dz);
  peerWorld.project(camera);   // mutates to NDC (-1..+1)
  // Convert NDC to screen pixels.
  const sx = (peerWorld.x * 0.5 + 0.5) * w;
  const sy = (-peerWorld.y * 0.5 + 0.5) * h;
  const onScreen = peerWorld.x > -0.95 && peerWorld.x < 0.95
                && peerWorld.y > -0.95 && peerWorld.y < 0.95
                && peerWorld.z < 1;
  if (onScreen) {
    // Hide the edge arrow when peer is in the camera frustum — the
    // 3D ghost + beacon takes over as the indicator.
    el.style.display = 'none';
    return;
  }
  // Clamp to screen edge. Direction from screen center to peer-NDC.
  const cx = w * 0.5, cy = h * 0.5;
  let vx = sx - cx, vy = sy - cy;
  // If z>1 the peer is BEHIND the camera; flip the projection so the
  // arrow points along the inverse direction (otherwise we'd send
  // the player chasing the wrong way).
  if (peerWorld.z > 1) { vx = -vx; vy = -vy; }
  const len = Math.hypot(vx, vy) || 1;
  const margin = 36;
  const halfW = w * 0.5 - margin;
  const halfH = h * 0.5 - margin;
  // Clamp the line from center along (vx,vy) to the rectangular
  // screen-margin box.
  const tx = halfW / Math.abs(vx);
  const ty = halfH / Math.abs(vy);
  const t = Math.min(tx, ty);
  const px = cx + vx * t;
  const py = cy + vy * t;
  const ang = Math.atan2(vy, vx);
  const arrow = _arrowForAngle(Math.atan2(vx, -vy));   // world-aligned 8-way glyph
  el.innerHTML = `${arrow} <strong>${_escHtml(name)}</strong> <span style="color:#6f7990">${dist.toFixed(1)}m</span>`;
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  el.style.display = 'block';
  void ang;
}
// Apply / strip a translucent red sphere as the downed marker on a
// remote ally rig. We DON'T mutate the rig's shared materials —
// buildRig caches MeshStandardMaterial instances across actors via
// makeMat(), so writing to a single ally's body color poisons every
// other ally + every gunman that shares the cached mat. Adding a
// child overlay is per-rig and stripped cleanly on revive.
function _coopApplyDownedOverlay(peerId, on) {
  const m = _coopGhostMeshes?.get(peerId);
  if (!m || !m.group) return;
  if (on) {
    if (m._downedOverlay) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd24868, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const overlay = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), mat);
    overlay.position.y = 0.6;
    overlay.renderOrder = 6;
    overlay.userData._coopDownedOverlay = true;
    m.group.add(overlay);
    m._downedOverlay = overlay;
  } else {
    if (m._downedOverlay) {
      m.group.remove(m._downedOverlay);
      try { m._downedOverlay.geometry.dispose(); } catch (_) {}
      try { m._downedOverlay.material.dispose(); } catch (_) {}
      m._downedOverlay = null;
    }
  }
}

// Downed/revive HUD — non-blocking overlay. Shows the local
// bleedout bar when WE'RE down, and a directional + bar prompt
// when a teammate is down nearby (so the reviver can find them).
let _coopDownedHudEl = null;
function _renderDownedHud() {
  if (!_coopDownedHudEl) {
    const el = document.createElement('div');
    el.id = 'coop-downed-hud';
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '90px',
      transform: 'translateX(-50%)', zIndex: '8',
      pointerEvents: 'none', display: 'none',
      font: '12px ui-monospace, Menlo, Consolas, monospace',
      color: '#f0a0a0', textAlign: 'center',
      letterSpacing: '1px', minWidth: '320px',
      padding: '10px 16px',
      background: 'rgba(20,8,10,0.85)',
      border: '1px solid #a03038', borderRadius: '4px',
      boxShadow: '0 0 28px rgba(208,72,104,0.45)',
    });
    document.body.appendChild(el);
    _coopDownedHudEl = el;
  }
  const total = tunables.coop?.reviveBleedoutSec ?? 60;
  const holdTotal = tunables.coop?.reviveHoldSec ?? 20;
  if (_localDowned) {
    const blPct = Math.max(0, Math.min(1, _localBleedoutT / total));
    const rvPct = Math.max(0, Math.min(1, _localReviveT / holdTotal));
    const rvActive = _localReviveActive ? 'TEAMMATE REVIVING' : 'TEAMMATE NEEDED';
    _coopDownedHudEl.innerHTML = `
      <div style="font-size:18px;color:#e04848;letter-spacing:4px;margin-bottom:4px">DOWN</div>
      <div style="font-size:10px;color:#9b6a6a">${rvActive}</div>
      <div style="margin-top:6px;background:#2a0e10;height:6px;border-radius:3px;overflow:hidden">
        <div style="width:${(blPct * 100).toFixed(1)}%;height:100%;background:linear-gradient(90deg,#a03038,#e04848);transition:width 200ms linear"></div>
      </div>
      <div style="font-size:9px;color:#6a4040;margin-top:2px">bleedout ${_localBleedoutT.toFixed(1)}s</div>
      ${rvPct > 0 ? `
      <div style="margin-top:8px;background:#0e2a18;height:6px;border-radius:3px;overflow:hidden">
        <div style="width:${(rvPct * 100).toFixed(1)}%;height:100%;background:linear-gradient(90deg,#3a7a48,#6abf78);transition:width 200ms linear"></div>
      </div>
      <div style="font-size:9px;color:#406040;margin-top:2px">revive ${(_reviveHoldT).toFixed(1)}s / ${holdTotal}s</div>
      ` : ''}
    `;
    _coopDownedHudEl.style.display = 'block';
    return;
  }
  // Reviver — actively progressing on a teammate.
  if (_reviveTargetPeerId && _reviveHoldT > 0) {
    const rvPct = Math.max(0, Math.min(1, _reviveHoldT / holdTotal));
    const peerName = getCoopTransport().peers?.get(_reviveTargetPeerId)?.name || 'teammate';
    // Pull the target's bleedout from _coopPeerDowned so the reviver
    // knows how urgent the situation is — without this they'd hold
    // interact blind, not knowing if the teammate is about to true-die.
    const targetSt = _coopPeerDowned.get(_reviveTargetPeerId);
    const blPct = targetSt
      ? Math.max(0, Math.min(1, (targetSt.bleedoutT || 0) / total))
      : 0;
    _coopDownedHudEl.innerHTML = `
      <div style="font-size:14px;color:#6abf78;letter-spacing:3px;margin-bottom:4px">REVIVING ${_escHtml(peerName)}</div>
      <div style="font-size:9px;color:#406040">hold INTERACT — release to pause</div>
      <div style="margin-top:6px;background:#0e2a18;height:8px;border-radius:3px;overflow:hidden">
        <div style="width:${(rvPct * 100).toFixed(1)}%;height:100%;background:linear-gradient(90deg,#3a7a48,#6abf78);transition:width 100ms linear"></div>
      </div>
      <div style="font-size:9px;color:#406040;margin-top:2px">revive ${_reviveHoldT.toFixed(1)}s / ${holdTotal}s</div>
      ${targetSt ? `
      <div style="margin-top:6px;background:#2a0e10;height:5px;border-radius:3px;overflow:hidden">
        <div style="width:${(blPct * 100).toFixed(1)}%;height:100%;background:linear-gradient(90deg,#a03038,#e04848);transition:width 200ms linear"></div>
      </div>
      <div style="font-size:9px;color:#9b6a6a;margin-top:2px">bleedout ${(targetSt.bleedoutT || 0).toFixed(1)}s</div>
      ` : ''}
    `;
    _coopDownedHudEl.style.display = 'block';
    return;
  }
  // Down teammate prompt — when there's a downed peer in range.
  let nearPeer = null;
  let nearDist = Infinity;
  if (_coopPeerDowned.size > 0 && player?.mesh?.position) {
    const px = player.mesh.position.x, pz = player.mesh.position.z;
    for (const [peerId, st] of _coopPeerDowned) {
      const ghost = coopLobby?.ghosts?.get(peerId);
      if (!ghost) continue;
      const dx = ghost.x - px, dz = ghost.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < nearDist) { nearDist = d; nearPeer = { peerId, ghost, st }; }
    }
  }
  if (nearPeer) {
    const peerName = getCoopTransport().peers?.get(nearPeer.peerId)?.name || 'teammate';
    const range = tunables.coop?.reviveRange ?? 1.6;
    const inRange = nearDist <= range;
    _coopDownedHudEl.innerHTML = `
      <div style="font-size:13px;color:${inRange ? '#f2c060' : '#9b8b6a'};letter-spacing:3px;margin-bottom:2px">
        ${inRange ? 'HOLD E TO REVIVE' : `${_escHtml(peerName)} DOWN — ${nearDist.toFixed(1)}m`}
      </div>
      <div style="font-size:9px;color:#6a5a3a">bleedout ${nearPeer.st.bleedoutT.toFixed(1)}s</div>
    `;
    _coopDownedHudEl.style.display = 'block';
    return;
  }
  _coopDownedHudEl.style.display = 'none';
}
function _arrowForAngle(rad) {
  // 8-way arrow glyph based on world-space heading from local player.
  const TAU = Math.PI * 2;
  const norm = ((rad % TAU) + TAU) % TAU;
  const idx = Math.round(norm / (TAU / 8)) & 7;
  return ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'][idx];
}
function _escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _decayFireStandStack(dt) {
  // Called every frame from the main tick loop. If the player hasn't
  // taken fire damage in the last 0.4s (slightly longer than a single
  // megaboss fire-pool tick interval of 0.33s), bleed off the stack
  // exponentially so it doesn't carry into the next fire encounter.
  const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
  if (now - _playerFireLastTickT > 0.4 && _playerFireStandT > 0) {
    _playerFireStandT = Math.max(0, _playerFireStandT - dt / 0.6);
  }
}
function damagePlayer(amount, damageType = 'generic', srcCtx = null) {
  if (amount <= 0) return;
  // Way of the Worrier relic — N% chance the whole damage event is
  // dodged outright. Player flinches and the bullet "misses".
  // Applies BEFORE any damage-mods so the dodge replaces the entire
  // event (no partial damage, no durability tick, no recap entry).
  if ((derivedStats.flinchDodgeChance || 0) > 0
      && Math.random() < derivedStats.flinchDodgeChance) {
    return;
  }
  // Active contract modifier: playerDamageTakenMult (Glass Cannon
  // and similar). 1.0 = neutral. Applied first so subsequent
  // resistances scale over the modified base.
  if (_activeModifiers.playerDamageTakenMult !== 1) {
    amount *= _activeModifiers.playerDamageTakenMult;
  }
  // Mourner's Bell relic — incoming damage scales by the bell's hidden
  // multiplier (default no-op when the relic isn't owned).
  if ((derivedStats.incomingDmgMult || 1) !== 1) {
    amount *= derivedStats.incomingDmgMult;
  }
  // Apply damage-type resistance from skills.
  if (damageType === 'ballistic' && derivedStats.ballisticResist > 0) {
    amount *= (1 - Math.min(0.7, derivedStats.ballisticResist));
  } else if (damageType === 'fire' && derivedStats.fireResist > 0) {
    // Cap raised to 0.95 so Brian's Hat (+0.9) actually delivers
    // its advertised 90% fire protection.
    amount *= (1 - Math.min(0.95, derivedStats.fireResist));
  }
  // Cumulative fire stacking — each tick of fire damage drives the
  // stack up. Multiplier is `1 + secondsOfExposure × stackPerSec`,
  // uncapped: linger 5s and you eat 6× damage per tick, 10s = 11×.
  // Approximate seconds of exposure by adding a fixed dt-equivalent
  // on each tick (zone @ every frame, megaboss pool @ 0.33s, flame
  // cone @ 12Hz). A flat 0.05s/tick increment lands at roughly
  // "the longer you stand in fire, the more it hurts" without
  // requiring tick-rate plumbing.
  if (damageType === 'fire') {
    const stackMult = 1 + _playerFireStandT * _PLAYER_FIRE_STACK_PER_SEC;
    amount *= stackMult;
    _playerFireStandT += 0.05;
    _playerFireLastTickT = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
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
  // Covetous relic short-circuits the entire gear-drain branch; the
  // multiplier (Patcher = 0.5) scales remaining drain otherwise.
  // Damage routes to ONE random equipped piece per damage event so
  // wear spreads across the loadout — previously the loop touched
  // every slot with `reduction`, which meant the chest plate
  // shouldered 100% of the wear (helmet / hands / pants drain ranged
  // alongside it but the chest's higher reduction made it the
  // visible-failure piece). Now any equipped item with durability
  // (armor OR gear — straps and packs wear too) is eligible.
  const ratio = tunables.durability.armorDamageRatio;
  const _aMult = derivedStats.armorDurabilityMult || 1;
  if (!derivedStats.indestructibleGear) {
    const _drainable = [];
    for (const slot of SLOT_IDS) {
      const item = inventory.equipment[slot];
      if (!item || !item.durability) continue;
      if (item.durability.current <= 0) continue;
      _drainable.push(item);
    }
    if (_drainable.length) {
      const pick = _drainable[Math.floor(Math.random() * _drainable.length)];
      pick.durability.current = Math.max(0, pick.durability.current - amount * ratio * _aMult);
      // First time a piece of armour breaks, surface the repair
      // mechanic — players might not realise broken gear gives no
      // bonuses + needs a shop visit.
      if (pick.durability.current <= 0) fireHint('brokenItem');
    }
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

  // Death-recap accounting — credit the source enemy with `amount`
  // (post-reduction). srcCtx is { source, zone, distance } from the
  // call site; gas / unknown sources pass null and we still record
  // a generic entry so the recap can show "Killed by GAS".
  const _src = srcCtx?.source || null;
  const _zone = srcCtx?.zone || null;
  let _dist = srcCtx?.distance;
  if (_dist == null && _src?.group?.position && player?.mesh?.position) {
    const sx = _src.group.position.x - player.mesh.position.x;
    const sz = _src.group.position.z - player.mesh.position.z;
    _dist = Math.hypot(sx, sz);
  }
  const _attackerKey = _src || damageType;
  const _name = _src ? _enemyDisplayName(_src) : damageType.toUpperCase();
  const tally = _attackerStats.get(_attackerKey) || { name: _name, dmg: 0, zone: _zone, distance: _dist, type: damageType, hits: 0 };
  tally.dmg += amount;
  tally.hits += 1;
  // Most-recent hit overwrites zone/distance so the recap shows the
  // killing blow's zone, not the first hit's.
  if (_zone) tally.zone = _zone;
  if (_dist != null) tally.distance = _dist;
  tally.type = damageType;
  _attackerStats.set(_attackerKey, tally);
  // If this hit dropped the player, snapshot it as the fatal one.
  // lastHpRatio is updated post-damage in the player tick, but
  // playerInfo.health is read on the same frame; checking here means
  // the kill credit lands on the actual finishing source.
  if (lastPlayerInfo && lastPlayerInfo.health - amount <= 0) {
    _lastFatalHit = { source: _src, name: _name, zone: _zone, distance: _dist, type: damageType, amount };
  }

  // Status effects based on the damage source. Ballistic hits occasionally
  // cause a bleed; melee hits are more likely and can also crack bones.
  // Bloody Jigsaw relic — full bleed immunity (skips ballistic + melee
  // bleed application). Broken bones are unaffected.
  const st = tunables.status || {};
  const bleedImmune = !!derivedStats.bleedImmune;
  if (damageType === 'ballistic' && player.applyStatus && !bleedImmune
      && Math.random() < (st.bulletBleedChance || 0)) {
    player.applyStatus('bleed', st.bleedDuration || 12);
  } else if (damageType === 'melee' && player.applyStatus) {
    if (!bleedImmune && Math.random() < (st.meleeBleedChance || 0)) player.applyStatus('bleed', st.bleedDuration || 12);
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
    let dmg = comboStep.damage * derivedStats.meleeDmgMult * berserkMult();
    // Broken melee weapon — fractional damage instead of fire-lock.
    // Bare-fist quick-melee skipped (handled by the early-return at
    // line 7136 when current weapon is ranged).
    const _swipeWeapon = currentWeapon();
    if (_swipeWeapon && _swipeWeapon.type === 'melee'
        && _swipeWeapon.durability && _swipeWeapon.durability.current <= 0) {
      dmg *= (tunables.durability?.brokenMeleeDmgMult ?? 0.30);
    }
    const wasAlive = c.alive;
    runStats.addDamage(dmg);
    c.manager.applyHit(c, dmg, comboStep.zone, _swipeDir, { weaponClass: 'melee' });
    runStats.noteMeleeLanded();
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
      awardClassXp('melee', c.tier, c);
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
// fades.
//
// Pool of 8 dome meshes sharing one SphereGeometry. Was creating a
// fresh Sphere + Material per detonation. The dome material has a
// per-call tint, so the pool slot's material color is reset each
// spawn (cheap — Color.setHex is one number write).
const _flashDomes = [];
const _flashDomePool = [];
const _FLASH_DOME_POOL = 8;
let _flashDomeGeom = null;
function _ensureFlashDomePool() {
  if (_flashDomePool.length === _FLASH_DOME_POOL) return;
  if (!_flashDomeGeom) _flashDomeGeom = new THREE.SphereGeometry(1, 20, 14);
  for (let i = _flashDomePool.length; i < _FLASH_DOME_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(_flashDomeGeom, mat);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    _flashDomePool.push({ mesh, inUse: false });
  }
}
function spawnFlashDome(pos, radius, tint = 0xffffff) {
  _ensureFlashDomePool();
  let entry = _flashDomePool.find(e => !e.inUse);
  if (!entry) entry = _flashDomePool[0];
  entry.inUse = true;
  entry.mesh.position.copy(pos);
  entry.mesh.scale.setScalar(0.2);
  entry.mesh.material.color.setHex(tint);
  entry.mesh.material.opacity = 0.85;
  entry.mesh.visible = true;
  _flashDomes.push({ entry, t: 0, life: 0.4, radius });
}
function _tickFlashDomes(dt) {
  for (let i = _flashDomes.length - 1; i >= 0; i--) {
    const d = _flashDomes[i];
    d.t += dt;
    const k = d.t / d.life;
    const mesh = d.entry.mesh;
    // Scale 0.2 → radius, opacity 0.85 → 0.
    mesh.scale.setScalar(0.2 + (d.radius - 0.2) * Math.min(1, k * 1.1));
    mesh.material.opacity = Math.max(0, 0.85 * (1 - k));
    if (d.t >= d.life) {
      mesh.visible = false;
      d.entry.inUse = false;
      _flashDomes.splice(i, 1);
    }
  }
}

// Fire VFX — three layered particle types make a molotov burn read as
// real fire instead of a cluster of orange dots:
//   tongue : vertically stretched flame, hot white-yellow at the base
//            shifting to orange→red→deep red as it rises and ages.
//            Most of the visible "flame".
//   ember  : small bright dots that hover near the ground and flicker
//            briefly. Sells the hot, churning base of the fire.
//   smoke  : gray translucent puffs that drift up slowly above the
//            flames and grow as they fade. Only spawned in the second
//            half of a tongue's life so it reads as smoke trailing
//            the flame, not stacked underneath.
// Headshot burst — small gold sparks erupting from the cranium on a
// successful headshot. Reuses the kill-coin pool since the visual
// (small emissive gold spheres flying outward) is essentially the
// same. Caps at 5 sparks so the screen doesn't get cluttered on
// rapid-fire headshot strings.
const _headshotSparkGeom = (() => {
  // Single shared sphere, small enough to read as a spark, big
  // enough to register at iso distance. Cached.
  return new THREE.SphereGeometry(0.05, 6, 5);
})();
function spawnHeadshotBurst(pos) {
  if (!pos) return;
  const count = 5;
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const speed = 3.6 + Math.random() * 1.4;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff0a0,
      transparent: true, opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(_headshotSparkGeom, mat);
    const yJitter = (Math.random() - 0.5) * 0.15;
    mesh.position.set(pos.x, (pos.y || 1.5) + yJitter, pos.z);
    mesh.frustumCulled = false;
    scene.add(mesh);
    _coinFx.push({
      mesh, mat,
      vx: Math.sin(ang) * speed,
      vy: 1.4 + Math.random() * 1.4,
      vz: Math.cos(ang) * speed,
      spinY: 0,
      phase: 'burst',
      t: 0,
      // Short-lived spark — never enters fly-to-player phase.
      // Despawn at burstUntil; coin tick will handle it because
      // phase != 'fly' falls into burst arc + the safety
      // 'else if (phase === fly)' returns; we add a sentinel by
      // setting burstUntil very long but adding _isHeadshotSpark
      // for the tick to despawn early.
      burstUntil: 10,
      _isHeadshotSpark: true,
      _despawnAt: 0.45 + Math.random() * 0.15,
    });
  }
}

// Kill-coin VFX. On enemy death, spawn 4-8 small emissive gold coins
// that burst outward (radial + slight upward arc) and then home in
// on the player. The "+N" floater spawns at the kill point so the
// payout reads instantly; the coins themselves are pure flair on the
// way to the wallet. Single shared geometry + material clones per
// instance (rotation needs unique mat for emissive flicker).
const _coinFx = [];
let _coinGeom = null;
function _getCoinGeom() {
  if (!_coinGeom) {
    // Squashed cylinder reads as a coin disc viewed at iso angle.
    _coinGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.025, 14);
  }
  return _coinGeom;
}
function spawnKillCoins(pos, amount) {
  if (!amount || amount <= 0) return;
  // Floater shows the count immediately so the player gets the
  // payout signal even if the coin VFX is offscreen / occluded.
  try { spawnDamageNumber(pos.clone ? pos.clone().setY(1.4) : new THREE.Vector3(pos.x, 1.4, pos.z), camera, amount, 'coin'); }
  catch (_) {}
  // Number of physical coins to spawn — caps so a 99-credit boss
  // kill doesn't dump 99 coins on the screen. 4-8 reads as "money."
  const count = Math.min(8, Math.max(4, Math.round(amount / 4)));
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd750,
      roughness: 0.30, metalness: 0.85,
      emissive: 0xffb830,
      emissiveIntensity: 0.55,
    });
    const mesh = new THREE.Mesh(_getCoinGeom(), mat);
    // Tiny pose jitter at the kill spot so the cluster doesn't read
    // as one stacked coin; no outward velocity — coins fly straight
    // to the player from the start.
    const jitter = 0.18;
    mesh.position.set(
      pos.x + (Math.random() - 0.5) * jitter,
      1.0 + (Math.random() - 0.5) * 0.25,
      pos.z + (Math.random() - 0.5) * jitter,
    );
    mesh.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.4;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    _coinFx.push({
      mesh, mat,
      // Start with zero velocity — fly-tick accelerates toward player
      // immediately. No ballistic arc, no floor bounce, no scatter.
      vx: 0, vy: 0, vz: 0,
      spinY: (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * 6),
      phase: 'fly',
      t: 0,
      // Staggered launch so the cluster reads as a stream rather than
      // a single packet. Each coin starts homing after a small delay.
      flyDelay: i * 0.04,
      burstUntil: 0,
    });
  }
}
function _tickCoinFx(dt) {
  if (_coinFx.length === 0) return;
  const target = player?.mesh?.position;
  for (let i = _coinFx.length - 1; i >= 0; i--) {
    const c = _coinFx[i];
    c.t += dt;
    c.mesh.rotation.y += c.spinY * dt;
    if (c.phase === 'burst') {
      // Ballistic arc outward.
      c.vy -= 9.8 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      // Don't punch through the floor.
      if (c.mesh.position.y < 0.25) {
        c.mesh.position.y = 0.25;
        c.vy = Math.abs(c.vy) * 0.35;
        c.vx *= 0.6; c.vz *= 0.6;
      }
      // Headshot sparks fade + despawn instead of homing.
      if (c._isHeadshotSpark) {
        if (c.mat) c.mat.opacity = Math.max(0, 0.95 * (1 - c.t / c._despawnAt));
        if (c.t >= c._despawnAt) {
          scene.remove(c.mesh); c.mat?.dispose(); _coinFx.splice(i, 1);
          continue;
        }
      } else if (c.t >= c.burstUntil) {
        c.phase = 'fly';
      }
    } else if (c.phase === 'fly') {
      if (!target) {
        // No player to home to (death / extract) — just despawn.
        scene.remove(c.mesh); c.mat.dispose(); _coinFx.splice(i, 1);
        continue;
      }
      // Stagger the launch so a cluster reads as a stream — each
      // coin waits its tiny flyDelay before starting to home.
      if (c.flyDelay && c.t < c.flyDelay) continue;
      // Steer toward player chest height. Acceleration grows with
      // age so the path reads as "magnetized in" rather than a lazy
      // drift. Cap top speed so a far-away coin doesn't streak.
      const tx = target.x;
      const ty = 1.1;
      const tz = target.z;
      const dx = tx - c.mesh.position.x;
      const dy = ty - c.mesh.position.y;
      const dz = tz - c.mesh.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.55) {
        scene.remove(c.mesh); c.mat.dispose(); _coinFx.splice(i, 1);
        continue;
      }
      const flyT = Math.max(0, c.t - (c.flyDelay || 0));
      const accel = 32 + flyT * 28;
      const inv = 1 / Math.max(0.001, dist);
      c.vx += dx * inv * accel * dt;
      c.vy += dy * inv * accel * dt;
      c.vz += dz * inv * accel * dt;
      // Speed cap.
      const speedSq = c.vx * c.vx + c.vy * c.vy + c.vz * c.vz;
      const cap = 22;
      if (speedSq > cap * cap) {
        const scale = cap / Math.sqrt(speedSq);
        c.vx *= scale; c.vy *= scale; c.vz *= scale;
      }
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      // Safety: if a coin's been in flight for >2.5s, despawn.
      if (c.t > 3.0) {
        scene.remove(c.mesh); c.mat.dispose(); _coinFx.splice(i, 1);
      }
    }
  }
}
// All three share the `_fireOrbs` pool / tick loop so cleanup paths
// don't multiply.
const _fireOrbs = [];
const _FIRE_HOT      = new THREE.Color(0xfff0c0);   // base — almost white
const _FIRE_MID      = new THREE.Color(0xff9030);   // mid — orange
const _FIRE_TIP      = new THREE.Color(0xc02810);   // tip — deep red
const _FIRE_TMP_COL  = new THREE.Color();
function _flameTongueGeom() {
  // Stretched 4-sided cone reads as a flame tip. Cached.
  if (!_flameTongueGeom._g) {
    _flameTongueGeom._g = new THREE.ConeGeometry(0.08, 0.55, 5, 1, true);
  }
  return _flameTongueGeom._g;
}
function _spawnFlameTongue(x, y, z) {
  const mesh = new THREE.Mesh(
    _flameTongueGeom(),
    new THREE.MeshBasicMaterial({
      color: _FIRE_HOT.getHex(),
      transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  mesh.position.set(x, y, z);
  // Random initial yaw + slight tilt so a cluster doesn't read as
  // identical copies of one cone.
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.rotation.z = (Math.random() - 0.5) * 0.18;
  scene.add(mesh);
  _fireOrbs.push({
    kind: 'tongue',
    mesh,
    vy: 1.6 + Math.random() * 1.4,
    drift: {
      x: (Math.random() - 0.5) * 0.20,
      z: (Math.random() - 0.5) * 0.20,
    },
    life: 0.55 + Math.random() * 0.35,
    t: 0,
    flicker: Math.random() * Math.PI * 2,
    smokeSpawned: false,
  });
}
function _spawnEmber(x, z) {
  const sz = 0.04 + Math.random() * 0.04;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(sz, 4, 3),
    new THREE.MeshBasicMaterial({
      color: 0xffe89a, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  mesh.position.set(x, 0.04 + Math.random() * 0.10, z);
  scene.add(mesh);
  _fireOrbs.push({
    kind: 'ember',
    mesh,
    vy: 0.05 + Math.random() * 0.15,
    drift: { x: (Math.random() - 0.5) * 0.12, z: (Math.random() - 0.5) * 0.12 },
    life: 0.30 + Math.random() * 0.25,
    t: 0,
    flicker: Math.random() * Math.PI * 2,
  });
}
function _spawnSmoke(x, y, z) {
  const sz = 0.18 + Math.random() * 0.18;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(sz, 5, 4),
    new THREE.MeshBasicMaterial({
      color: 0x202020, transparent: true, opacity: 0.35,
      depthWrite: false,   // standard blending — smoke darkens, not adds
    }),
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  _fireOrbs.push({
    kind: 'smoke',
    mesh,
    vy: 0.55 + Math.random() * 0.4,
    drift: {
      x: (Math.random() - 0.5) * 0.35,
      z: (Math.random() - 0.5) * 0.35,
    },
    life: 1.4 + Math.random() * 0.9,
    t: 0,
  });
}
// Initial molotov shatter — denser tongue cluster + ember bed.
function spawnFireOrbBurst(pos, radius, count = 18) {
  const tongues = Math.max(4, Math.floor(count * 0.45));
  const embers  = Math.max(4, Math.floor(count * 0.55));
  for (let i = 0; i < tongues; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius * 0.85;
    _spawnFlameTongue(
      pos.x + Math.cos(a) * r,
      0.10 + Math.random() * 0.30,
      pos.z + Math.sin(a) * r,
    );
  }
  for (let i = 0; i < embers; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius * 0.95;
    _spawnEmber(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r);
  }
}
// Single ballistic fire glob — used by the molotov shatter to fling a
// red/orange orb outward in a short ballistic arc. When it lands it
// seeds a small persistent burn zone at the touchdown point so the
// splash leaves a real fire pattern instead of a single circle.
function _spawnFlungFireOrb(pos, dirX, dirZ, speed, fireDuration, fireDps) {
  const sz = 0.13 + Math.random() * 0.06;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(sz, 6, 5),
    new THREE.MeshBasicMaterial({
      color: 0xff8030,
      transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  mesh.position.set(pos.x, 0.30 + Math.random() * 0.15, pos.z);
  scene.add(mesh);
  _fireOrbs.push({
    kind: 'flung',
    mesh,
    vx: dirX * speed,
    vy: 2.4 + Math.random() * 1.1,
    vz: dirZ * speed,
    // The shared tick at the top reads `o.drift.x/z` for every kind
    // before branching by kind. Flung orbs do their own ballistic
    // motion below using vx/vz, so drift stays {0,0} — but it MUST
    // be present, not undefined, or the unconditional read at the
    // top crashes the whole frame loop and freezes the game on a
    // black screen (reported when a molotov was thrown at the
    // wishing well).
    drift: { x: 0, z: 0 },
    life: 1.10 + Math.random() * 0.30,    // longer than air time so post-land fade reads
    t: 0,
    landed: false,
    fireDuration: Math.max(0.5, fireDuration || 3.0),
    fireDps: Math.max(1, fireDps || 8),
  });
}
// Molotov shatter — replaces the old single-radius circle with a
// ballistic spray. Center pool forms immediately; 6 fiery orbs fling
// outward and seed small individual burn pools where they land. The
// total set of overlapping pools approximates the original radius
// while looking like an actual splash pattern.
function spawnMolotovShatter(pos, radius, fireDuration, fireDps) {
  // Immediate central pool — smaller than the legacy single zone.
  spawnFireZone(pos, radius * 0.55, fireDuration * 0.85, fireDps * 0.85);
  // Splash flame cluster at the impact point.
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius * 0.32;
    _spawnFlameTongue(
      pos.x + Math.cos(a) * r,
      0.12 + Math.random() * 0.22,
      pos.z + Math.sin(a) * r,
    );
  }
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius * 0.45;
    _spawnEmber(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r);
  }
  // 6 ballistic fire orbs flung outward at evenly-spaced angles with
  // jitter, each carrying enough horizontal velocity to land within
  // ~0.7..1.1 × radius. A short fuseDuration on each landing pool so
  // the satellite zones decay before the central one to keep the
  // overall area trending inward over time.
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const dx = Math.cos(a), dz = Math.sin(a);
    const speed = radius * (1.35 + Math.random() * 0.55);
    _spawnFlungFireOrb(
      pos, dx, dz, speed,
      fireDuration * (0.55 + Math.random() * 0.20),
      fireDps * (0.45 + Math.random() * 0.15),
    );
  }
}
function _tickFireOrbs(dt) {
  for (let i = _fireOrbs.length - 1; i >= 0; i--) {
    const o = _fireOrbs[i];
    o.t += dt;
    const k = o.t / o.life;     // 0 → 1
    o.mesh.position.x += o.drift.x * dt;
    o.mesh.position.z += o.drift.z * dt;
    o.mesh.position.y += o.vy * dt;
    if (o.kind === 'tongue') {
      // Color shift over life: hot → mid → tip.
      const t = k;
      if (t < 0.5) {
        _FIRE_TMP_COL.copy(_FIRE_HOT).lerp(_FIRE_MID, t * 2);
      } else {
        _FIRE_TMP_COL.copy(_FIRE_MID).lerp(_FIRE_TIP, (t - 0.5) * 2);
      }
      o.mesh.material.color.copy(_FIRE_TMP_COL);
      // Slight flicker on Y-scale + opacity for life reads.
      const flick = 0.85 + 0.15 * Math.sin(o.flicker + o.t * 22);
      // Tongue stretches as it rises (taller, thinner) then shrinks
      // toward the top of its life. Width pinches in toward the tip.
      const stretch = 1 + k * 1.4;
      const widthSquish = 1 - k * 0.5;
      o.mesh.scale.set(widthSquish * flick, stretch, widthSquish * flick);
      o.mesh.material.opacity = 0.95 * Math.max(0, 1 - k * k);
      // Decelerate slightly so tongues don't all shoot off into the
      // ceiling — natural "flame settling" feel.
      o.vy *= 1 - dt * 0.8;
      // Halfway through life, drop a smoke puff just above the tongue.
      if (!o.smokeSpawned && k > 0.55 && _fireOrbs.length < 260) {
        o.smokeSpawned = true;
        _spawnSmoke(
          o.mesh.position.x + (Math.random() - 0.5) * 0.15,
          o.mesh.position.y + 0.55,
          o.mesh.position.z + (Math.random() - 0.5) * 0.15,
        );
      }
    } else if (o.kind === 'ember') {
      const flick = 0.7 + 0.3 * Math.sin(o.flicker + o.t * 35);
      o.mesh.material.opacity = flick * Math.max(0, 1 - k);
      o.mesh.scale.setScalar(1 - k * 0.4);
      o.vy *= 1 - dt * 1.2;
    } else if (o.kind === 'smoke') {
      o.mesh.material.opacity = 0.35 * Math.max(0, 1 - k);
      o.mesh.scale.setScalar(1 + k * 1.6);
      o.vy *= 1 - dt * 0.4;
    } else if (o.kind === 'flung') {
      // Ballistic flame — gravity pulls down, drag slows horizontal.
      // On floor contact, seed a small burn zone and shorten life so
      // the orb visually fades as the persistent pool takes over.
      if (!o.landed) {
        o.mesh.position.x += o.vx * dt;
        o.mesh.position.z += o.vz * dt;
        o.vy -= 9.8 * dt;
        o.mesh.position.y += o.vy * dt;
        o.vx *= 1 - dt * 0.6;
        o.vz *= 1 - dt * 0.6;
        if (o.mesh.position.y <= 0.06) {
          o.landed = true;
          o.mesh.position.y = 0.06;
          // Seed a small persistent burn zone at touchdown.
          spawnFireZone(
            o.mesh.position.clone(),
            0.55 + Math.random() * 0.25,
            o.fireDuration,
            o.fireDps,
          );
          // Cut life so the orb fades within ~0.20s after landing.
          o.life = Math.min(o.life, o.t + 0.22);
        }
      }
      // Color shift orange → red over life (matches the falling
      // flame tip cooling as it loses energy).
      const t = Math.min(1, k);
      if (t < 0.6) {
        _FIRE_TMP_COL.copy(_FIRE_HOT).lerp(_FIRE_MID, t / 0.6);
      } else {
        _FIRE_TMP_COL.copy(_FIRE_MID).lerp(_FIRE_TIP, (t - 0.6) / 0.4);
      }
      o.mesh.material.color.copy(_FIRE_TMP_COL);
      o.mesh.material.opacity = Math.max(0, 0.95 * (1 - k * k));
      o.mesh.scale.setScalar(1 - k * 0.35);
    }
    if (o.t >= o.life) {
      scene.remove(o.mesh);
      // Tongue geometry is shared/cached — don't dispose it.
      if (o.kind !== 'tongue') o.mesh.geometry.dispose();
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
  // Coop: enemy-owned explosions (AI grenades, sniper shots, etc.)
  // need to damage joiner ghosts in radius. Reuses the megaboss
  // hazard helper which handles host-only gating + the
  // rpc-player-damage send. Player-owned explosions are skipped —
  // joiners' own throws are handled via rpc-throwable's auth path
  // and host's throws don't damage the host's own teammates.
  if (owner === 'enemy' && explosion && (explosion.damage | 0) > 0
      && typeof _coopDamageRemotePlayersInRadius === 'function') {
    _coopDamageRemotePlayersInRadius(pos.x, pos.z, radius, explosion.damage, 'megaboss');
  }
  // Coop kill attribution: when this is a joiner-thrown projectile
  // (host applied via rpc-throwable, stamped p._coopClaimer), set
  // the thread-local so any onEnemyKilled fired during damage
  // application routes rewards via rpc-grant-rewards instead of to
  // the host. Cleared in a finally below.
  const _coopPrevClaimer = (typeof window !== 'undefined') ? window.__coopCurrentClaimer : null;
  const _coopThrowClaimer = p?._coopClaimer || null;
  if (_coopThrowClaimer && typeof window !== 'undefined') {
    window.__coopCurrentClaimer = _coopThrowClaimer;
  }
  try {
    return _onProjectileExplodeBody(pos, explosion, owner, p, radius, rSq);
  } finally {
    if (_coopThrowClaimer && typeof window !== 'undefined') {
      window.__coopCurrentClaimer = _coopPrevClaimer;
    }
  }
}
function _onProjectileExplodeBody(pos, explosion, owner, p, radius, rSq) {
  // Sniper bullet — direct hit, no AoE, no fireball. Cheap path:
  // single impact spark + one distance check on the player. Skips
  // spawnExplosionFx (which allocates 16+ meshes + a PointLight per
  // call and causes the hitch).
  if (p?._sniperShot) {
    // player.body is a child mesh of the rig group; its `.position`
    // is in local space and reads near-origin no matter where the
    // player actually stands. Use the rig group's world position
    // (player.mesh.position) for distance checks against blasts.
    const dx = player.mesh.position.x - pos.x;
    const dz = player.mesh.position.z - pos.z;
    if (dx * dx + dz * dz < rSq) {
      player.takeDamage(explosion.damage || 0);
    }
    if (combat.spawnImpact) combat.spawnImpact(pos);
    if (sfx?.hit) sfx.hit();
    triggerShake(explosion.shake || 0.1, 0.10);
    return;
  }
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
    // Shatter pattern — central pool + 6 ballistic orbs flung outward
    // that each seed their own smaller burn zone where they land.
    // Reads as a real Molotov splash (multiple overlapping fire pools
    // along the trajectory) rather than a single perfect circle.
    // Coop: owner==='remote' is a fx-throwable visual mirror — render
    // the visual zones but zero the burn DoT so we don't double-damage
    // local snapshot enemies.
    const dps = (owner === 'remote') ? 0 : (p.fireTickDps || 14);
    spawnMolotovShatter(pos, radius, p.fireDuration || 6.0, dps);
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
    // Player-side flash blind — when an enemy throws this and the
    // player has LoS to the detonation, paint a fading white overlay
    // for flashDur seconds. Mitigated by distance from the blast and
    // by whether the player is facing toward or away from the
    // detonation: a player squinted away from a flashbang only
    // catches a fraction of the blind.
    if (owner === 'enemy') {
      const dx = player.mesh.position.x - pos.x;
      const dz = player.mesh.position.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < rSq) {
        const eye = new THREE.Vector3(player.mesh.position.x, 1.2, player.mesh.position.z);
        if (combat.hasLineOfSight(pos, eye, blockers)) {
          const dur = _scalePlayerThrowableEffect(flashDur, pos, radius, /* facingMatters */ true);
          if (dur > 0.05) playerFlashT = Math.max(playerFlashT, dur);
        }
      }
    }
    if (sfx.explode) sfx.explode();
    triggerShake(0.3, 0.25);
    return;
  }
  if (kind === 'stun') {
    // Stun lockdown — random 1-5s per victim, separate from dazzle.
    // Sets stunT (gunman + melee tick check this) which fully
    // freezes movement + fire while active. Spawns a star ring
    // above the victim's head; the stars rotate while stunT > 0.
    const stunDur = p.stunDuration || 3.0;
    const victims = [...gunmen.gunmen, ...melees.enemies];
    for (const c of victims) {
      if (!c.alive) continue;
      const dx = c.group.position.x - pos.x;
      const dz = c.group.position.z - pos.z;
      if (dx * dx + dz * dz > rSq) continue;
      const dur = 1 + Math.random() * 4;
      c.stunT = Math.max(c.stunT || 0, dur);
      _attachStunStars(c);
    }
    // Pale-blue tint on the white dome so the stun reads distinctly
    // from the flashbang at a glance.
    spawnFlashDome(pos, radius, 0xc0d8ff);
    // Player-side stun — camera waver. Only when an enemy threw it
    // and the blast caught the player; same radius check. Stun is
    // concussive so it falls off with distance (further = less
    // shockwave) but doesn't care which way the player is facing.
    if (owner === 'enemy') {
      const dx = player.mesh.position.x - pos.x;
      const dz = player.mesh.position.z - pos.z;
      if (dx * dx + dz * dz < rSq) {
        const dur = _scalePlayerThrowableEffect(stunDur, pos, radius, /* facingMatters */ false);
        if (dur > 0.05) playerStunT = Math.max(playerStunT, dur);
      }
    }
    if (sfx.explode) sfx.explode();
    triggerShake(0.25, 0.22);
    return;
  }
  if (kind === 'smoke') {
    spawnSmokeZone(pos, radius, p.smokeDuration || 9.0);
    if (sfx.explode) sfx.explode();
    return;
  }
  if (kind === 'gas') {
    // Poison cloud — drains HP over time. Damage ticking handled in
    // _tickThrowableZones below. Owner is forwarded so the tick can
    // gate friendly fire: enemy-thrown gas only drains the player,
    // never other enemies (was a self-kill / chain-kill bug).
    spawnGasZone(pos, radius, p.gasDuration || 6.0, owner);
    if (sfx.explode) sfx.explode();
    return;
  }
  if (kind === 'decoy') {
    spawnDecoyBeacon(pos, p.decoyDuration || 7.0);
    if (sfx.explode) sfx.explode();
    return;
  }
  if (kind === 'claymore') {
    // Place the mine — no explosion here. The claymore is a persistent
    // prop that sits at `pos` and detonates on enemy proximity, see
    // _claymores + _tickClaymores below.
    placeClaymore(pos, p.throwDirX, p.throwDirZ, {
      radius, damage: explosion.damage,
      triggerRadius: p.triggerRadius || 2.6,
      triggerConeDeg: p.triggerConeDeg || 90,
      shake: explosion.shake || 0.55,
    });
    if (sfx.uiAccept) sfx.uiAccept();
    return;
  }
  if (kind === 'theGift') {
    // The Gift — through-walls red shockwave that erases everything
    // in `radius`. Bypasses LoS checks entirely. Pays the sacrifice
    // cost on detonation (NOT on throw, so a wall-blocked throw still
    // costs HP, which is intentional — the gift was given).
    spawnExplosionFx(pos, radius);
    if (sfx.explode) sfx.explode();
    triggerShake(0.85, 0.50);
    triggerHitStop?.(0.10);
    const r2 = radius * radius;
    const _dir = new THREE.Vector3();
    const apply = (list) => {
      for (const c of list) {
        if (!c.alive) continue;
        const dx = c.group.position.x - pos.x;
        const dz = c.group.position.z - pos.z;
        if (dx * dx + dz * dz > r2) continue;
        // Massive damage — boss-killing on purpose.
        const wasAlive = c.alive;
        const d = Math.hypot(dx, dz) || 1;
        _dir.set(dx / d, 0, dz / d);
        runStats.addDamage(99999);
        c.manager.applyHit(c, 99999, 'torso', _dir, { weaponClass: 'explosive' });
        if (wasAlive && !c.alive) onEnemyKilled(c, { byThrowable: true });
      }
    };
    apply(gunmen.gunmen);
    apply(melees.enemies);
    // Pay the sacrifice cost — accumulate into the giftSacrificeHp
    // counter; recomputeStats subtracts it from derivedStats.
    // maxHealthBonus and clamps the resulting max to >= 1.
    const sacrifice = p.sacrificeMaxHp || 10;
    giftSacrificeHp += sacrifice;
    recomputeStats();
    transientHudMsg(`-${sacrifice} max HP`, 2.4);
    return;
  }

  // Impact-kill projectiles (Elven Knife) — single-target damage with
  // NO fireball, NO shake, NO hitstop. Just an impact spark on the
  // contacted enemy. Damage is still resolved through the same
  // applyTo loop below (radius is small, ~0.6m, so it lands on the
  // single enemy the projectile touched), but we skip the heavy VFX
  // so the throw reads as "blade impacts and disappears."
  if (p?.impactKill) {
    if (combat.spawnImpact) combat.spawnImpact(pos);
    if (sfx.hit) sfx.hit();
  } else {
    // --- default (frag / rocket / grenade-launcher) path ---
    // Visual pop — expanding fireball + scorched-ring shock wave
    // so the detonation reads even at low camera angles. Auto-animates
    // via combat's particle tick (scales up then fades).
    spawnExplosionFx(pos, radius);
    if (sfx.explode) sfx.explode(); else sfx.hit();
    triggerShake(explosion.shake || 0.4, 0.35);
    triggerHitStop?.(0.05);
  }

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
        runStats.noteThrowableKill();
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
  //
  // LoS GATE: previously a grenade detonating around a corner would
  // damage the player anyway because the explosion sweep didn't check
  // for walls. Now we shoot a single LoS ray from the detonation
  // point to the player's chest; if a wall blocks it, no damage. The
  // throughWalls flag (The Gift sacrifice) bypasses this check so its
  // gameplay still works.
  const _explosionEye = new THREE.Vector3(player.mesh.position.x, 1.0, player.mesh.position.z);
  const _explosionFrom = new THREE.Vector3(pos.x, 1.0, pos.z);
  const losToPlayer = !!p?.throughWalls
    || (combat.hasLineOfSight
      ? combat.hasLineOfSight(_explosionFrom, _explosionEye, level.obstacles)
      : true);
  if (owner === 'enemy') {
    const dx = player.mesh.position.x - pos.x;
    const dz = player.mesh.position.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < rSq && losToPlayer) {
      const d = Math.sqrt(d2);
      const falloff = 1 - 0.75 * (d / radius);
      player.takeDamage(explosion.damage * Math.max(0.25, falloff));
    }
  } else if (owner === 'player') {
    // Player's own grenades / rockets / frag rounds hurt them when
    // caught in the blast. Same LoS gate — a wall between the player
    // and their own explosion blocks the self-damage.
    const dx = player.mesh.position.x - pos.x;
    const dz = player.mesh.position.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < rSq && losToPlayer) {
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
      runStats.noteMeleeLanded();
    }
  };
  pushAll(gunmen.gunmen);
  pushAll(melees.enemies);
}

// Coop joiner hit-test for an AI bullet ray. Host-only. Projects each
// connected joiner ghost onto the ray; if the perpendicular distance
// is under the player hit radius AND the projection is within range
// AND closer than any wall-hit, treats it as a joiner hit and sends
// `rpc-player-damage` to that peer instead of damaging the host's
// local player. Returns the peerId hit (or null).
function _coopJoinerBulletHitCheck(origin, dir, range, wallHitDist) {
  if (!coopLobby) return null;
  const transport = getCoopTransport();
  if (!transport.isOpen || !transport.isHost) return null;
  const cap = wallHitDist != null ? Math.min(range, wallHitDist) : range;
  let bestPeer = null;
  let bestDist = Infinity;
  for (const [peerId, ghost] of coopLobby.ghosts) {
    const dx = ghost.x - origin.x;
    const dz = ghost.z - origin.z;
    const proj = dx * dir.x + dz * dir.z;   // along-ray distance
    if (proj <= 0 || proj > cap) continue;
    const perpX = dx - dir.x * proj;
    const perpZ = dz - dir.z * proj;
    const perp = Math.hypot(perpX, perpZ);
    if (perp < 0.55 && proj < bestDist) {
      bestDist = proj;
      bestPeer = peerId;
    }
  }
  return bestPeer;
}
// Send a targeted player-damage RPC to a specific joiner. Wraps the
// send call so call-sites stay tiny.
function _coopSendPlayerDamage(peerId, amount, type, srcInfo = null) {
  const transport = getCoopTransport();
  if (!transport.isOpen || !transport.isHost || !peerId) return;
  transport.send('rpc-player-damage', {
    d: Math.round(amount),
    type,
    z: srcInfo?.zone || 'torso',
  }, peerId);
}

function aiFire(origin, dir, weapon, damageMult = 1, source = null) {
  if (!weapon) return; // defensive: parry redirect can disarm mid-burst
  if (weapon.fireMode === 'flame' || weapon.class === 'flame') {
    aiFireFlame(origin, dir, weapon, damageMult, source);
    return;
  }
  // Distance-cull AI fire SFX — off-screen volleys skip the audio
  // pipeline entirely. Saves the WebAudio node alloc + connect work
  // that piles up under heavy combat (the GC churn from short-lived
  // BufferSource/Filter/Gain nodes was correlating with frame hitches).
  const _afdx = origin.x - player.mesh.position.x;
  const _afdz = origin.z - player.mesh.position.z;
  const _afDist = Math.sqrt(_afdx * _afdx + _afdz * _afdz);
  sfx.enemyFire(weapon.class || 'pistol', _afDist);
  // Brass + smoke for AI fire — same distance gate as the SFX so
  // off-screen volleys don't pay the particle cost.
  if (_afDist < 30 && weapon.class && weapon.class !== 'melee') {
    combat.spawnBrass(origin, dir);
    combat.spawnMuzzleSmoke(origin, dir);
  }
  const targets = [...level.obstacles, player.body];
  const hit = combat.raycast(origin, dir, targets, weapon.range);
  let endPoint;
  let hitPlayer = false;
  let wallHitDist = null;
  if (hit) {
    endPoint = hit.point;
    if (hit.mesh.userData?.isPlayer) hitPlayer = true;
    else {
      // Wall / prop hit. Cap joiner-hit-test by this distance so a
      // bullet doesn't damage a joiner standing behind a wall.
      const dx = hit.point.x - origin.x;
      const dy = hit.point.y - origin.y;
      const dz = hit.point.z - origin.z;
      wallHitDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  } else {
    endPoint = origin.clone().addScaledVector(dir, weapon.range);
  }
  // AI fires intentionally skip the muzzle-flash PointLight — with
  // 14-shot bullet-hell volleys, stacking live point lights per frame
  // crushes fragment shading on low-spec GPUs. The additive flash
  // mesh + tracer still read clearly.
  combat.spawnShot(origin, endPoint, weapon.tracerColor, { light: false });
  // Coop: broadcast the tracer to every joiner so they see host's
  // enemy bullets in flight. Tiny payload (~24 bytes), fire-and-
  // forget — tracers are 80ms visual events; mild jitter is fine.
  // Skip during a single-frame burst to keep packets sane in a
  // bullet-hell volley (host caps via _coopAiTracerBudget).
  {
    const _t = getCoopTransport();
    if (_t.isOpen && _t.isHost && _t.peers && _t.peers.size > 0) {
      _coopAiTracerBudget--;
      if (_coopAiTracerBudget > 0) {
        _t.send('fx-tracer', {
          x1: +origin.x.toFixed(2),
          y1: +origin.y.toFixed(2),
          z1: +origin.z.toFixed(2),
          x2: +endPoint.x.toFixed(2),
          y2: +endPoint.y.toFixed(2),
          z2: +endPoint.z.toFixed(2),
          c: weapon.tracerColor | 0,
        });
      }
    }
  }

  if (!hitPlayer) {
    // Coop — host's enemies can also clip a joiner whose ghost is
    // along the ray. The joiner takes damage via RPC; the host
    // doesn't apply anything locally.
    const joinerHit = _coopJoinerBulletHitCheck(origin, dir, weapon.range, wallHitDist);
    if (joinerHit) {
      _coopSendPlayerDamage(joinerHit, weapon.damage * damageMult, 'ballistic',
        { zone: 'torso' });
    }
    return;
  }

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
  // Hit zone from the raycast (head/torso/limb) feeds the death recap.
  const _zone = hit?.mesh?.userData?.zone || null;
  const _dist = source?.group?.position
    ? Math.hypot(player.mesh.position.x - source.group.position.x,
                 player.mesh.position.z - source.group.position.z)
    : null;
  damagePlayer(weapon.damage * damageMult, 'ballistic', { source, zone: _zone, distance: _dist });
}

// AI flame tick — mirror of the player's tickFlame but directed at the
// player only. Called once per flameTickRate tick by the gunman fire loop.
function aiFireFlame(origin, dir, weapon, damageMult = 1, source = null) {
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
  // Line-of-sight gate — was missing, which let "The Burn" boss
  // torch the player from offscreen / through walls the moment they
  // came within range + cone. Now goes through level._segmentClear
  // (same AABB system as movement collision) so partial-height meshes
  // can't false-pass a y=1.1 raycast. Also clamps the visual cone to
  // the wall so the player doesn't see flame leaking past it.
  let drawRange = range;
  const _segClear = level && level._segmentClear
    ? (ax, az, bx, bz) => level._segmentClear(ax, az, bx, bz, 0.25)
    : () => true;
  if (hitsPlayer) {
    if (!_segClear(origin.x, origin.z, ppos.x, ppos.z)) {
      hitsPlayer = false;
    }
  }
  if (!hitsPlayer) {
    const endX = origin.x + dir.x * range;
    const endZ = origin.z + dir.z * range;
    if (!_segClear(origin.x, origin.z, endX, endZ)) {
      // Bisect outward to find wall distance — quick 4-sample probe so
      // the visual flame stops at the obstruction.
      for (const t of [0.2, 0.4, 0.6, 0.8]) {
        const px = origin.x + dir.x * range * t;
        const pz = origin.z + dir.z * range * t;
        if (!_segClear(origin.x, origin.z, px, pz)) {
          drawRange = range * t;
          break;
        }
      }
    }
  }
  combat.spawnFlameParticles(origin, dir, drawRange, angleRad);
  // Coop — joiners caught in the cone (with LoS) also take a flame
  // tick. Same cap formula as the host below; per-tick send so the
  // joiner's `damagePlayer` accumulates the fire stack the same way
  // standing in a fire pool would.
  if (coopLobby && getCoopTransport().isHost) {
    const ENEMY_FLAME_DAMAGE_MULT = 0.17;
    const flameAmount = (weapon.damage || 5) * damageMult * ENEMY_FLAME_DAMAGE_MULT;
    for (const [peerId, ghost] of coopLobby.ghosts) {
      const jdx = ghost.x - origin.x;
      const jdz = ghost.z - origin.z;
      const jd = Math.hypot(jdx, jdz);
      if (jd > range || jd < 0.0001) continue;
      const jnx = jdx / jd, jnz = jdz / jd;
      if (jnx * dir.x + jnz * dir.z < halfCos) continue;
      if (!_segClear(origin.x, origin.z, ghost.x, ghost.z)) continue;
      _coopSendPlayerDamage(peerId, flameAmount, 'fire', { zone: 'torso' });
    }
  }
  if (!hitsPlayer) return;
  if (player.isBlocking()) {
    combat.spawnDeflectFlash(new THREE.Vector3(ppos.x, 1.0, ppos.z), 0xffd07a);
    player.consumeStamina(tunables.stamina.deflectCost * 0.5);
    return;
  }
  const _flameDist = source?.group?.position
    ? Math.hypot(player.mesh.position.x - source.group.position.x,
                 player.mesh.position.z - source.group.position.z)
    : d;
  // Enemy flame DPS target: ~10-20 DPS (was 24-40 at 0.4 mult, still
  // too high — flame cone could shred a player in 2s). 5/tick ×
  // 12 ticks/sec × 0.17 ≈ 10 base DPS, scaling to ~17 with
  // difficulty. Cone reads as a 'get out' threat, never a one-shot.
  const ENEMY_FLAME_DAMAGE_MULT = 0.17;
  damagePlayer((weapon.damage || 5) * damageMult * ENEMY_FLAME_DAMAGE_MULT, 'fire',
    { source, zone: 'torso', distance: _flameDist });
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

// Early-out cache — full HP read of the playerInfo. If neither the
// HP, the max, nor the regenCap moved since the last call, every
// downstream computation is wasted work (and the profile showed
// updateHealthHud at 0.28s self-time even after the in-DOM-write
// throttling, because the function still runs the math + walks the
// status row every frame).
let _hpCache_h = -1, _hpCache_m = -1, _hpCache_r = -1;
let _hpCache_bleed = -1, _hpCache_broken = -1;
let _hpCache_sta = -1, _hpCache_staMax = -1, _hpCache_blocking = -1, _hpCache_parry = -1;
function updateHealthHud(playerInfo) {
  // The status-row branch reads bleedT/brokenT and DOM-mutates only
  // when those values change; bail when nothing the panel depends on
  // has changed so we don't keep rebuilding the same width strings.
  // STAMINA is checked too — earlier the cache only watched HP fields
  // and the function would early-return while stamina was draining,
  // freezing the bar visually during sprint / block / dodge.
  const bleed = playerInfo.bleedT || 0;
  const broken = playerInfo.brokenT || 0;
  const stamina = playerInfo.stamina || 0;
  const staMax = playerInfo.maxStamina || 0;
  const blocking = playerInfo.blocking ? 1 : 0;
  const parry = playerInfo.parryActive ? 1 : 0;
  if (playerInfo.health === _hpCache_h
      && playerInfo.maxHealth === _hpCache_m
      && (playerInfo.regenCap ?? playerInfo.maxHealth) === _hpCache_r
      && bleed === _hpCache_bleed
      && broken === _hpCache_broken
      && stamina === _hpCache_sta
      && staMax === _hpCache_staMax
      && blocking === _hpCache_blocking
      && parry === _hpCache_parry) {
    return;
  }
  _hpCache_h = playerInfo.health;
  _hpCache_m = playerInfo.maxHealth;
  _hpCache_r = playerInfo.regenCap ?? playerInfo.maxHealth;
  _hpCache_bleed = bleed;
  _hpCache_broken = broken;
  _hpCache_sta = stamina;
  _hpCache_staMax = staMax;
  _hpCache_blocking = blocking;
  _hpCache_parry = parry;
  if (hpFillEl) {
    const pct = Math.max(0, Math.min(1, playerInfo.health / playerInfo.maxHealth));
    // Only touch DOM when the displayed value actually changes — was
    // writing style.width + textContent every frame even when the
    // player was at full health and not regenerating, costing a paint
    // dirty mark per frame for nothing. Cache last-rendered ints +
    // colour bucket on the element itself.
    const w = Math.round(pct * 1000);   // 0.1% resolution
    if (hpFillEl._lastW !== w) {
      hpFillEl.style.width = `${pct * 100}%`;
      hpFillEl._lastW = w;
    }
    const bucket = pct > 0.6 ? 'g' : pct > 0.3 ? 'y' : 'r';
    if (hpFillEl._lastBucket !== bucket) {
      hpFillEl.style.background = bucket === 'g' ? '#6abe5a' : bucket === 'y' ? '#d0a030' : '#c94a3a';
      hpFillEl._lastBucket = bucket;
    }
    if (hpRegenEl) {
      const capPct = Math.max(0, Math.min(1, (playerInfo.regenCap ?? playerInfo.maxHealth) / playerInfo.maxHealth));
      const cw = Math.round(capPct * 1000);
      if (hpRegenEl._lastW !== cw) {
        hpRegenEl.style.width = `${capPct * 100}%`;
        hpRegenEl._lastW = cw;
      }
    }
    if (hpTextEl) {
      const hpInt = Math.round(playerInfo.health);
      const maxInt = Math.round(playerInfo.maxHealth);
      const sig = hpInt * 10000 + maxInt;
      if (hpTextEl._lastSig !== sig) {
        hpTextEl.textContent = `${hpInt} / ${maxInt}`;
        hpTextEl._lastSig = sig;
      }
    }
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
  // Squared-distance compare — Math.hypot is ~5-8× slower because of
  // overflow-safe scaling, and we never use the actual distance value
  // here, just the ordering. Called every frame from updateLootPrompt.
  let best = null;
  let bestDist2 = radius * radius;
  const check = (e) => {
    if (e.alive) return;
    const dx = e.group.position.x - playerPos.x;
    const dz = e.group.position.z - playerPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestDist2) { bestDist2 = d2; best = e; }
  };
  for (const g of gunmen.gunmen) check(g);
  for (const m of melees.enemies) check(m);
  return best;
}

// All dead, unlooted bodies within reach. When 2+ corpses are stacked
// on top of each other (the late-game pile-up complaint), the prompt
// flips to "loot area" and tryInteract opens a merged modal showing
// every body's loot at once. Skips empty / already-looted bodies so
// the count reflects what the player will actually see.
function nearbyBodies(playerPos, radius = 2.2) {
  const out = [];
  const r2 = radius * radius;
  const check = (e) => {
    if (e.alive) return;
    if (e.looted) return;
    if (!e.loot || !e.loot.length) return;
    const dx = e.group.position.x - playerPos.x;
    const dz = e.group.position.z - playerPos.z;
    if (dx * dx + dz * dz > r2) return;
    out.push(e);
  };
  for (const g of gunmen.gunmen) check(g);
  for (const m of melees.enemies) check(m);
  return out;
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
function spawnRing(pos, pct, isEnemy = false, yOffset = 2.3) {
  const p = projectToScreen(pos, yOffset);
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

  // Player reload — ring above player. Akimbo shows TWO rings
  // (one per weapon) stacked vertically so each hand's reload
  // progress is visible. Bottom ring = weapon1 (LMB / left), top
  // ring = weapon2 (RMB / right) — matches the L/R label
  // convention in the bottom HUD.
  if (_isAkimbo()) {
    const w1ak = inventory.equipment.weapon1;
    const w2ak = inventory.equipment.weapon2;
    if (w1ak && w1ak.reloadingT > 0) {
      const eff1 = effectiveWeapon(w1ak);
      const total1 = (eff1?.reloadTime || w1ak.reloadTime || 1.5);
      spawnRing(player.mesh.position, 1 - w1ak.reloadingT / total1, false, 2.3);
    }
    if (w2ak && w2ak.reloadingT > 0) {
      const eff2 = effectiveWeapon(w2ak);
      const total2 = (eff2?.reloadTime || w2ak.reloadTime || 1.5);
      spawnRing(player.mesh.position, 1 - w2ak.reloadingT / total2, false, 2.9);
    }
  } else if (weapon && weapon.type === 'ranged' && weapon.reloadingT > 0) {
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
  // Stealth state stays the same most frames; only touch DOM on
  // transitions. textContent + className assignment forces style
  // recompute on the element if we set the same value, even though
  // the DOM string didn't change.
  if (stealthStatusEl._lastCls !== cls) {
    stealthStatusEl.className = cls;
    stealthStatusEl._lastCls = cls;
  }
  if (stealthStatusEl._lastTxt !== txt) {
    stealthStatusEl.textContent = txt;
    stealthStatusEl._lastTxt = txt;
  }
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
// Baseline sense range — without perks / artifacts, the player's
// fresnel-ghost vision only reaches roughly halfway into an adjacent
// room. Perks (hearingRange affixes), the Ghost Key artifact, and
// the Oracle set push past this; the floor is intentionally tight
// so the player has to invest in stealth gear to read past their
// own room.
const GHOST_BASE_RANGE = 10;

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
//
// Coordinates with the rig instancer: when ghosted, we need the
// SOURCE meshes to draw (they carry the ghost material) instead of
// the InstancedMesh — so we flip them visible AND tag the rig's
// instance slots as hidden so the InstancedMesh writes zero-scale
// matrices. On exit, the reverse: restore original materials, hide
// source meshes again, un-flag the instance slots.
function _setEnemyGhost(e, ghosted) {
  if (!e.group) return;
  const wantGhost = !!ghosted;
  if (e.__ghosted === wantGhost) return;
  if (wantGhost && !e.__ghostMat) e.__ghostMat = _makeGhostMaterial();
  const _ri = rigInstancer && rigInstancer();
  e.group.traverse((obj) => {
    if (!obj.isMesh) return;
    if (wantGhost) {
      if (obj.userData.__origMat === undefined) obj.userData.__origMat = obj.material;
      obj.material = e.__ghostMat;
      obj.castShadow = false;
      obj.userData.__origRenderOrder = obj.renderOrder;
      obj.renderOrder = 5;   // draw on top of darker scene fill
      // If this mesh was a registered instancer source, restore its
      // visibility so the ghost material actually paints, and mark
      // the instance slot hidden so the InstancedMesh stops drawing
      // it from the instance buffer.
      if (obj.userData._instSlot !== undefined) {
        obj.userData.__origVisible = obj.visible;
        obj.visible = true;
        obj.userData._instHide = true;
      }
    } else if (obj.userData.__origMat) {
      obj.material = obj.userData.__origMat;
      obj.castShadow = obj.userData.__origCast !== false;
      if (obj.userData.__origRenderOrder !== undefined) obj.renderOrder = obj.userData.__origRenderOrder;
      // Re-park instancer source meshes — InstancedMesh takes back over.
      if (obj.userData._instSlot !== undefined) {
        obj.visible = obj.userData.__origVisible !== undefined
          ? obj.userData.__origVisible : false;
        obj.userData._instHide = false;
      }
    }
  });
  e.__ghosted = wantGhost;
  void _ri;     // referenced for clarity in the comment above
}

// Returns true for enemies currently in an aggressive state that the
// player should see through walls (so they can react to incoming threats).
function _isEnemyActive(e) {
  const s = e.state;
  return s === 'firing' || s === 'alerted' || s === 'chase'
    || s === 'windup' || s === 'swing' || s === 'recovery';
}

// --- Stun grenade visual: rotating star ring above the victim's head.
// Built on demand when stunT goes positive; ticked + cleaned up by
// _tickStunStars below. Pooled isn't worth it — stun is a rare event
// and 4 small primitive meshes per victim is cheap.
const _stunStarMat = new THREE.MeshBasicMaterial({
  color: 0xffe060, transparent: true, opacity: 0.95,
  depthWrite: false, blending: THREE.AdditiveBlending,
});
function _attachStunStars(enemy) {
  if (!enemy || !enemy.group || enemy._stunStars) return;
  const group = new THREE.Group();
  group.position.y = 2.05;       // above head
  // 4 small "stars" — quad-sphere primitives at 90° offsets.
  for (let i = 0; i < 4; i++) {
    const star = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), _stunStarMat);
    const ang = (i / 4) * Math.PI * 2;
    star.position.set(Math.cos(ang) * 0.32, 0, Math.sin(ang) * 0.32);
    group.add(star);
  }
  enemy.group.add(group);
  enemy._stunStars = group;
}
function _detachStunStars(enemy) {
  if (!enemy || !enemy._stunStars) return;
  if (enemy._stunStars.parent) enemy._stunStars.parent.remove(enemy._stunStars);
  enemy._stunStars.traverse((o) => {
    if (o.geometry?.dispose) o.geometry.dispose();
  });
  enemy._stunStars = null;
}
const _stunStarsList = [];     // scratch
function _tickStunStars(dt) {
  _stunStarsList.length = 0;
  for (const g of gunmen.gunmen) if (g._stunStars) _stunStarsList.push(g);
  for (const m of melees.enemies) if (m._stunStars) _stunStarsList.push(m);
  for (const c of _stunStarsList) {
    if (!c.alive || (c.stunT || 0) <= 0) {
      _detachStunStars(c);
      continue;
    }
    c._stunStars.rotation.y += dt * 4.0;     // ~0.6Hz spin
    // Subtle bob.
    const bob = Math.sin(performance.now() * 0.005) * 0.04;
    c._stunStars.position.y = 2.05 + bob;
  }
}

// --- Smoke-confused "?" sprite over the head. Mirrors the stun-stars
// pattern but renders a billboarded ? glyph via CanvasTexture so the
// status reads from any camera angle. Built once, shared.
let _questionTex = null;
function _buildQuestionTex() {
  if (_questionTex) return _questionTex;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.font = 'bold 56px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Stroke first for legibility against light / smoke backdrops, then fill.
  ctx.strokeStyle = '#1a0a14';
  ctx.lineWidth = 6;
  ctx.strokeText('?', 32, 36);
  ctx.fillStyle = '#ffe060';
  ctx.fillText('?', 32, 36);
  _questionTex = new THREE.CanvasTexture(c);
  return _questionTex;
}
function _attachQuestionMark(enemy) {
  if (!enemy || !enemy.group || enemy._questionMark) return;
  const tex = _buildQuestionTex();
  const mat = new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(0.55, 0.55, 1);
  spr.position.y = 2.20;
  spr.renderOrder = 999;
  enemy.group.add(spr);
  enemy._questionMark = spr;
}
function _detachQuestionMark(enemy) {
  if (!enemy || !enemy._questionMark) return;
  if (enemy._questionMark.parent) enemy._questionMark.parent.remove(enemy._questionMark);
  enemy._questionMark.material?.dispose?.();
  enemy._questionMark = null;
}
const _questionMarkList = [];
function _tickQuestionMarks(dt) {
  void dt;
  // Attach / refresh on enemies that became confused this frame, detach
  // on those whose timer ran out. Run on both gunmen and melee mobs.
  const sweep = (arr) => {
    for (const e of arr) {
      const confused = e.alive && (e.smokeConfusedT || 0) > 0;
      if (confused && !e._questionMark) _attachQuestionMark(e);
      else if (!confused && e._questionMark) _detachQuestionMark(e);
    }
  };
  sweep(gunmen.gunmen);
  sweep(melees.enemies);
  // Tiny float bob so the icon feels alive.
  _questionMarkList.length = 0;
  for (const g of gunmen.gunmen) if (g._questionMark) _questionMarkList.push(g);
  for (const m of melees.enemies) if (m._questionMark) _questionMarkList.push(m);
  const bob = Math.sin(performance.now() * 0.004) * 0.05;
  for (const c of _questionMarkList) c._questionMark.position.y = 2.20 + bob;
}

// Tag every rig source mesh's _instHide flag — drives whether the
// rig instancer parks that mesh's instance slot at zero-scale or
// reads matrixWorld each frame. Used when an actor needs to be
// FULLY hidden (beyond hearing range, cloaked, dead-and-baked,
// past-fog culling). Ghost mode handles its own _instHide toggle
// inside _setEnemyGhost; this helper is for the all-hidden case.
function _setEnemyInstHidden(e, hide) {
  const rig = e && e.rig;
  if (!rig || !rig.meshes) return;
  for (const m of rig.meshes) {
    if (!m) continue;
    // Don't override the disarm flag — disarm is a separate concern
    // tracked elsewhere on the actor's right-arm subset. Setting
    // _instHide=false here would re-show a disarmed arm.
    if (!hide && m.userData._instHideByDisarm) continue;
    m.userData._instHide = !!hide;
  }
}
// Persistent scratch values for updateEnemyVisibility — recreating
// these every frame ran roughly 60 × 2 Vector3 allocs/sec at 60fps,
// plus the spread allocation for `everyone`.
const _visFrom = new THREE.Vector3();
const _visTarget = new THREE.Vector3();
function updateEnemyVisibility() {
  let range = GHOST_BASE_RANGE + (derivedStats.hearingRange || 0);
  // ADS scope vision bonus — peering through a magnified optic lets
  // the player spot enemies farther out than their ambient hearing
  // range. Iron sights / red dots (sightZoom ≤ 1.10) grant nothing;
  // mid/long/sniper scopes scale linearly. Capped at full ADS so a
  // brief tap doesn't reveal half the level.
  const _w = currentWeapon();
  const _eff = _w ? effectiveWeapon(_w) : null;
  const _ads = lastPlayerInfo?.adsAmount || 0;
  if (_eff && _ads > 0.05 && _eff.sightZoom > 1.10) {
    // sightZoom 1.20 (mid scope) → +10.4m, 1.30 (long scope) → +20.8m.
    // Multiplier bumped 80 → 104 for an additional +30% scope vision.
    range += (_eff.sightZoom - 1.10) * 104 * _ads;
  }
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
      _setEnemyInstHidden(e, false);
      e.group.visible = true;
      continue;
    }
    // Cloaked assassin — invisible until materialized. The melee
    // tick flips e.cloaked to false on first detection / room entry,
    // at which point this branch stops short-circuiting and the
    // normal LoS pipeline takes over (with a brief reveal flash via
    // ghost mode for one frame so the appearance reads).
    if (e.cloaked) {
      _setEnemyGhost(e, false);
      _setEnemyInstHidden(e, true);
      e.group.visible = false;
      continue;
    }
    // Hidden ambush — the per-frame visibility pass would otherwise
    // un-hide them via the LoS branch. Keep them parked at zero-
    // scale until revealHiddenAmbush flips e.hidden back to false.
    if (e.hidden) {
      _setEnemyGhost(e, false);
      _setEnemyInstHidden(e, true);
      e.group.visible = false;
      continue;
    }
    // Cheap distance pre-filter — enemies further than (range + 4m)
    // can't possibly become visible this frame. Skips the LoS
    // raycast entirely for far-room enemies, which is the dominant
    // cost scaling with enemy count in big late-game levels.
    {
      const dxe = e.group.position.x - px;
      const dze = e.group.position.z - pz;
      const farSq = (range + 4) * (range + 4);
      if (dxe * dxe + dze * dze > farSq) {
        _setEnemyGhost(e, false);
        _setEnemyInstHidden(e, true);
        e.group.visible = false;
        continue;
      }
    }
    _visTarget.set(e.group.position.x, 1.2, e.group.position.z);
    const los = combat.hasLineOfSight(_visFrom, _visTarget, visionBlockers);
    e._occluded = !los;
    if (los) {
      _setEnemyGhost(e, false);
      _setEnemyInstHidden(e, false);
      e.group.visible = true;
      continue;
    }
    const d = Math.hypot(e.group.position.x - px, e.group.position.z - pz);
    if (d >= range) {
      // Beyond hearing range — hide entirely. The InstancedMesh
      // doesn't honour e.group.visible (it's not a child of the
      // group); explicitly park instance slots at zero-scale.
      _setEnemyGhost(e, false);
      _setEnemyInstHidden(e, true);
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
    // Use the vision-blocker subset — walls + closed doors + elevator
    // panels, excluding props. _addOcclusionHits filters props out
    // anyway; passing the smaller pre-filtered list makes BVH
    // intersect cheaper. Cached + invalidation-tracked by level.js
    // (visionDirty flag) so this is a stable reference frame-to-frame.
    const blockers = level.visionBlockers ? level.visionBlockers() : level.obstacles;

    // 1. Walls between camera and PLAYER (keeps player always visible).
    _occlTargetPt.set(px, 1.0, pz);
    _addOcclusionHits(camera.position, _occlTargetPt, blockers, nextFaded);

    // 2. Walls between camera and each relevant LIVING enemy. Per-enemy
    //    fan size scales with distance:
    //      * ≤ 12m: full 4-ray fan (head, chest, both shoulders)
    //      * > 12m: 2 rays (head + chest only) — the body-edge rays
    //        rarely catch a wall the chest ray misses at range, and
    //        the cost adds up across late-game rooms with many enemies.
    //    Threat state still gates whether DISTANT idle enemies cast
    //    at all (they don't past OCCL_ENEMY_RANGE).
    if (qualityFlags.wallOcclusionForEnemies) {
      const idleRangeSq = OCCL_ENEMY_RANGE * OCCL_ENEMY_RANGE;
      const farFanRangeSq = 12 * 12;
      const gunmenList = gunmen.gunmen;
      const meleesList = melees.enemies;
      for (let i = 0, total = gunmenList.length + meleesList.length; i < total; i++) {
        const e = i < gunmenList.length ? gunmenList[i] : meleesList[i - gunmenList.length];
        if (!e.alive) continue;
        // Hidden ambush bosses + minions skip occlusion fans —
        // they're invisible by design until reveal.
        if (e.hidden) continue;
        const ex = e.group.position.x, ez = e.group.position.z;
        const dxe = ex - px, dze = ez - pz;
        const d2 = dxe * dxe + dze * dze;
        const s = e.state;
        const active = !!s && s !== 'idle' && s !== 'sleep' && s !== 'dead';
        if (!active && d2 > idleRangeSq) continue;
        // Distance-tiered fan count: 4 close, 2 far.
        const fanCount = d2 <= farFanRangeSq ? 4 : 2;
        for (let k = 0; k < fanCount; k++) {
          const off = _ENEMY_FAN_OFFSETS[k];
          _occlTargetPt.set(ex + off.dx, off.y, ez + off.dz);
          _addOcclusionHits(camera.position, _occlTargetPt, blockers, nextFaded);
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
      _addOcclusionHits(camera.position, _occlTargetPt, blockers, nextFaded);
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
      _addOcclusionHits(camera.position, _occlTargetPt, blockers, nextFaded);
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

// Bottom-right weapon panel — current weapon name, class label, and a
// big ammo readout. Reload bar lives in the same panel and is driven by
// updateReloadHud below.
const weaponInfoNameEl = document.getElementById('weapon-info-name');
const weaponInfoClassEl = document.getElementById('weapon-info-class');
const weaponInfoAmmoEl = document.getElementById('weapon-info-ammo');
function updateWeaponInfoHud(weapon, effWeapon) {
  if (!weaponInfoNameEl) return;
  // Cache last-written values per element. Weapon name + class change
  // only on weapon swap; ammo only changes per shot / reload tick.
  // Most frames everything is identical — touch DOM only on change.
  let nm, cls, ammo;
  // Akimbo override — show BOTH weapons' ammo simultaneously so the
  // player tracks both mags. Format: "L 12/15  R 8/15" with reload
  // markers when the corresponding weapon is reloading.
  if (_isAkimbo()) {
    const w1 = inventory.equipment.weapon1;
    const w2 = inventory.equipment.weapon2;
    nm = `${w1.name || w1.class} + ${w2.name || w2.class}`;
    cls = `AKIMBO ${(w1.class || '').toUpperCase()}`;
    const eff1 = effectiveWeapon(w1);
    const eff2 = effectiveWeapon(w2);
    const fmt = (w, e) => {
      if (w.infiniteAmmo) return '∞';
      if (w.reloadingT > 0) return '↺';
      const mag = (e && e.magSize) || w.magSize || '—';
      return `${w.ammo}/${mag}`;
    };
    ammo = `L ${fmt(w1, eff1)}   R ${fmt(w2, eff2)}`;
  } else if (!weapon) {
    nm = '—'; cls = 'no weapon'; ammo = '—';
  } else {
    nm = weapon.name || weapon.class || weapon.type || '—';
    cls = (weapon.class || weapon.type || '').toUpperCase();
    if (weapon.type === 'ranged' && typeof weapon.ammo === 'number') {
      const magSize = (effWeapon && effWeapon.magSize) || weapon.magSize || '—';
      ammo = weapon.infiniteAmmo ? '∞' : `${weapon.ammo} / ${magSize}`;
    } else if (weapon.type === 'melee') {
      ammo = 'MELEE';
    } else {
      ammo = '—';
    }
  }
  if (weaponInfoNameEl._lastTxt !== nm) {
    if (typeof nm === 'string' && nm.indexOf('<span') !== -1) {
      weaponInfoNameEl.innerHTML = nm;
    } else {
      weaponInfoNameEl.textContent = nm;
    }
    weaponInfoNameEl._lastTxt = nm;
  }
  if (weaponInfoClassEl._lastTxt !== cls) {
    weaponInfoClassEl.textContent = cls;
    weaponInfoClassEl._lastTxt = cls;
  }
  if (weaponInfoAmmoEl._lastTxt !== ammo) {
    weaponInfoAmmoEl.textContent = ammo;
    weaponInfoAmmoEl._lastTxt = ammo;
  }
}

function updateReloadHud(weapon, effWeapon) {
  if (!reloadFillEl) return;
  // Compute every value first, then conditionally write — so the only
  // DOM thrash is during an actual reload tick (where reloadingT
  // changes per-frame). Otherwise the panel's static state holds.
  let widthPct, fillActive, labelActive, label, text, labelColor;
  if (!weapon || weapon.type !== 'ranged' || typeof weapon.ammo !== 'number') {
    widthPct = 100; fillActive = false; labelActive = false;
    label = 'READY'; text = ''; labelColor = '';
  } else {
    const total = (effWeapon && effWeapon.reloadTime) || weapon.reloadTime || 1.5;
    if (weapon.reloadingT > 0) {
      const pct = 1 - weapon.reloadingT / total;
      widthPct = Math.max(0, pct * 100);
      fillActive = true; labelActive = true;
      label = 'RELOADING';
      text = `${weapon.reloadingT.toFixed(1)}s`;
      labelColor = '';
    } else {
      const magSize = (effWeapon && effWeapon.magSize) || weapon.magSize;
      widthPct = 100; fillActive = false; labelActive = false;
      if (weapon.infiniteAmmo) {
        label = 'READY'; text = '∞'; labelColor = '';
      } else if (weapon.ammo === 0) {
        label = 'EMPTY'; text = `${weapon.ammo}/${magSize}`; labelColor = '#c94a3a';
      } else {
        label = 'READY'; text = `${weapon.ammo}/${magSize}`; labelColor = '';
      }
    }
  }
  // Width — quantize to 0.1% so trickle reload doesn't re-paint every frame.
  const wq = Math.round(widthPct * 10);
  if (reloadFillEl._lastW !== wq) {
    reloadFillEl.style.width = `${widthPct}%`;
    reloadFillEl._lastW = wq;
  }
  if (reloadFillEl._lastActive !== fillActive) {
    reloadFillEl.classList.toggle('active', fillActive);
    reloadFillEl._lastActive = fillActive;
  }
  if (reloadLabelEl._lastActive !== labelActive) {
    reloadLabelEl.classList.toggle('active', labelActive);
    reloadLabelEl._lastActive = labelActive;
  }
  if (reloadLabelEl._lastTxt !== label) {
    reloadLabelEl.textContent = label;
    reloadLabelEl._lastTxt = label;
  }
  if (reloadLabelEl._lastColor !== labelColor) {
    reloadLabelEl.style.color = labelColor;
    reloadLabelEl._lastColor = labelColor;
  }
  if (reloadTextEl._lastTxt !== text) {
    reloadTextEl.textContent = text;
    reloadTextEl._lastTxt = text;
  }
}

function updateLootPrompt() {
  const near = loot.nearest(player.mesh.position, tunables.loot.pickupRadius);
  // Pull every unlooted body within reach. When 2+ are present (the
  // pile-up case), `tryInteract` opens a merged "Loot Area" modal so
  // the player doesn't have to nudge through the stack one corpse at
  // a time. Single-body and empty-corpse cases keep the existing
  // prompts.
  const bodies = !near ? nearbyBodies(player.mesh.position, 2.2) : [];
  const body = !near ? nearestBody(player.mesh.position, 2.2) : null;
  const containerHit = (!near && !body) ? level.nearestContainer(player.mesh.position, 1.8) : null;
  const npc = (!near && !body && !containerHit) ? level.nearestNPC(player.mesh.position, 2.5) : null;
  if (promptEl) {
    // Resolve to a single (display, text, hint) tuple, then write once
    // through the cache check at the bottom. Was thrashing
    // promptEl.style.display + textContent every frame even when the
    // player stood still in front of the same prompt.
    // Resolve the player's current INTERACT keybind once per call so
    // every prompt below can label with the rebound key. Falls back
    // to 'E' if the binding is empty or unrecognized.
    const _eKey = displayKeyboard(getKeyboardBinding(ACTIONS.INTERACT)) || 'E';
    let txt = '';
    let hint = null;
    if (near) {
      const pile = loot.allWithin(player.mesh.position, tunables.loot.pickupRadius);
      txt = pile.length >= 2
        ? `[${_eKey}] examine ${pile.length} items on the ground`
        : `[${_eKey}] pick up ${near.item.name}`;
      hint = 'pickup';
    } else if (bodies.length >= 2) {
      const totalItems = bodies.reduce((n, b) => n + (b.loot?.length || 0), 0);
      txt = `[${_eKey}] loot area (${bodies.length} bodies · ${totalItems} items)`;
      hint = 'searchBody';
    } else if (body && !body.looted && body.loot && body.loot.length) {
      txt = `[${_eKey}] search body`;
      hint = 'searchBody';
    } else if (body && body.looted) {
      txt = `(body looted)`;
    } else if (containerHit) {
      txt = `[${_eKey}] open ${containerHit.container.name}`;
      hint = 'openContainer';
    } else if (npc && npc.kind === 'merchant') {
      txt = `[${_eKey}] trade with merchant`;
      hint = 'shop';
    } else if (npc && npc.kind === 'bearMerchant') {
      txt = `[${_eKey}] speak with the Great Bear`;
    } else if (npc && npc.kind === 'healer') {
      txt = `[${_eKey}] speak with the healer`;
    } else if (npc && npc.kind === 'gunsmith') {
      txt = `[${_eKey}] visit the gunsmith`;
    } else if (npc && npc.kind === 'armorer') {
      txt = `[${_eKey}] visit the armorer`;
    } else if (npc && npc.kind === 'tailor') {
      txt = `[${_eKey}] visit the tailor`;
    } else if (npc && npc.kind === 'relicSeller') {
      txt = `[${_eKey}] browse relics`;
    } else if (npc && npc.kind === 'blackMarket') {
      txt = `[${_eKey}] enter the black market`;
    } else if (level.nearElevatorDoor(player.mesh.position)) {
      txt = `[${_eKey}] open elevator door`;
    } else if (findExecuteTarget()) {
      const _fKey = displayKeyboard(getKeyboardBinding(ACTIONS.MELEE)) || 'F';
      txt = `[${_fKey}] execute`;
    } else if (level.isPlayerInExit(player.mesh.position) && exitCooldown <= 0) {
      txt = `[${_eKey}] extract (level ${level.index + 1})`;
    } else {
      // No nearby pickup / body / container / NPC / elevator / extract.
      // Surface the encounter interaction prompt if the player is
      // standing within an interactable encounter's anchor radius.
      // Uses the same `nearestInteractableEncounter()` helper that
      // tryInteract dispatches against, so prompt + action stay in
      // lockstep.
      const enc = nearestInteractableEncounter();
      if (enc && enc.def) {
        const name = enc.def.name || enc.def.id || 'this';
        txt = `[${_eKey}] interact with ${name}`;
      }
    }
    const wantDisplay = txt ? 'block' : 'none';
    if (promptEl._lastDisplay !== wantDisplay) {
      promptEl.style.display = wantDisplay;
      promptEl._lastDisplay = wantDisplay;
    }
    if (txt && promptEl._lastTxt !== txt) {
      promptEl.textContent = txt;
      promptEl._lastTxt = txt;
    }
    if (hint) fireHint(hint);
  }
  return { nearItem: near, body, bodies, npc, container: containerHit };
}

function tryInteract({ nearItem, body, bodies, npc, container }) {
  // Coop downed lock — a downed player can't search bodies, open
  // containers, talk to NPCs, etc. Their input dispatch is gated in
  // player.update; this catches the tryInteract path which routes
  // through the input flag separately.
  if (_localDowned) return;
  // Coop revive priority — if a downed teammate is in revive range,
  // skip every other interact (body search, container open, etc).
  // The hold-to-revive system in _tickReviveInteract takes over.
  if (_coopPeerDowned && _coopPeerDowned.size > 0 && player?.mesh?.position) {
    const px = player.mesh.position.x, pz = player.mesh.position.z;
    const range = tunables.coop?.reviveRange ?? 1.6;
    const r2 = range * range;
    for (const [peerId, st] of _coopPeerDowned) {
      if (!st || st.bleedoutT <= 0) continue;
      const ghost = coopLobby?.ghosts?.get(peerId);
      if (!ghost) continue;
      const dx = ghost.x - px, dz = ghost.z - pz;
      if (dx * dx + dz * dz < r2) {
        // Standing on a downed teammate — defer to the hold-revive
        // path. Don't interact with anything else.
        return;
      }
    }
  }
  // Loot pickup / body loot / encounter-spawned containers all beat
  // the encounter interact when the player is standing on / next to
  // them — encounter rewards (Shrine relic, Fountain signet chest,
  // Sleeping Boss chest, Royal Emissary masterwork, The Button
  // container scatter) were unreachable because pressing E re-opened
  // the encounter prompt instead. The encounter prompt is still
  // reachable when there's no nearby pickup; the player just has to
  // step off the ground item / move away from the chest.
  const hasPickup = !!(nearItem || body || (container && !container.container?.looted));
  if (!hasPickup) {
    const enc = nearestInteractableEncounter();
    if (enc) {
      // Coop: encounters are per-peer — each player rolls + runs
      // their own. Interaction state stays local to whichever peer
      // is talking to their own NPC. Rewards spawn into local loot
      // (joiner's loot.spawnItem creates non-_coopRemote entries
      // they can pick up directly). Encounters that summon enemies
      // via the gunmen/melees managers stay host-authoritative
      // because those flow through snapshot.
      const ctx = enc.ctx;
      ctx.playerSpeed = lastPlayerInfo ? (lastPlayerInfo.speed || 0) : 0;
      ctx.state = enc.state;
      // showPrompt / closePrompt are exposed by the ctx factory
      // itself — the local re-assign here used to be the only path,
      // which meant tick() and onItemDropped() couldn't call them.
      enc.def.interact(ctx);
      return;
    }
  }
  if (nearItem) {
    // Coop ownership gate.
    {
      const _coopT = getCoopTransport();
      // Host: refuse to pick up loot claimed by a specific joiner.
      // Their visual cube is still rendered locally because host
      // owns the canonical loot.items list, but the in-world
      // pickup is gated.
      if (_coopT.isOpen && _coopT.isHost
          && nearItem.claimedBy != null) {
        return;
      }
      // Joiner: items mirrored from host's snapshot are flagged
      // _coopRemote and are non-authoritative here. Forward the
      // pickup intent as an RPC; host validates + sends
      // rpc-grant-item which adds the full item data to our
      // inventory. The local visual disappears on the next
      // snapshot apply when host's loot list drops the entry.
      if (nearItem._coopRemote && _coopT.isOpen && !_coopT.isHost) {
        _coopT.send('rpc-pickup', { n: nearItem.netId | 0 });
        sfx.pickup?.();
        return;
      }
    }
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
    // Relics auto-consume on pickup — the artifact joins the
    // run's owned set and never takes a bag slot. recomputeStats fires
    // inside _tryAcquireRelic so the modifier is live before
    // the next frame.
    if (_tryAcquireRelic(nearItem.item)) {
      loot.remove(nearItem);
      sfx.pickup();
      inventoryUI.render();
      if (tutorialMode) tutorialUI.markStep('pickup');
      return;
    }
    const result = inventory.add(nearItem.item);
    if (!result.placed) return;
    loot.remove(nearItem);
    sfx.pickup();
    if (result.slot === 'primary' || result.slot === 'melee') onInventoryChanged();
    recomputeStats();
    inventoryUI.render();
    if (tutorialMode) tutorialUI.markStep('pickup');
    return;
  }
  // Multi-body pile — when 2+ unlooted corpses overlap, build a
  // merged target so all their loot shows in one modal. Each item
  // remembers which body it came from; taking it splices the item
  // out of that body's loot list (by reference, not by index — items
  // get rearranged as the player drags things, so the index would
  // go stale).
  if (bodies && bodies.length >= 2) {
    const merged = [];
    const refs = [];
    for (const b of bodies) {
      if (!b.loot) continue;
      for (const it of b.loot) {
        merged.push(it);
        refs.push({ body: b, item: it });
      }
    }
    if (merged.length) {
      const target = {
        loot: merged,
        _bodyPile: true,
        _bodyCount: bodies.length,
        _groundRefs: refs,
        _removeGround: ({ body: srcBody, item }) => {
          if (!srcBody || !srcBody.loot) return;
          const i = srcBody.loot.indexOf(item);
          if (i >= 0) srcBody.loot.splice(i, 1);
          if (srcBody.loot.length === 0) srcBody.looted = true;
        },
        looted: false,
      };
      lootUI.open(target);
      return;
    }
  }
  if (body && !body.looted && body.loot && body.loot.length > 0) {
    lootUI.open(body);
    return;
  }
  if (container && !container.container.looted) {
    // Cursed chest from The Lamp encounter — auto-applies the relic
    // the moment the chest is "opened" so the player can't peek + bail.
    // The chest is then marked looted (no loot UI, no pickup).
    if (container.container.autoCurseRelic) {
      const relic = { type: 'relic', artifactId: container.container.autoCurseRelic };
      _tryAcquireRelic(relic);
      container.container.looted = true;
      container.container.autoCurseRelic = null;
      sfx.uiAccept?.();
      return;
    }
    // Containers reuse the body-loot UI flow — same {loot, looted}
    // shape — and stay visually present after looting (just no
    // longer interactable). Items inside auto-load the same way
    // body items do via lootUI.open.
    lootUI.open(container.container);
    sfx.uiAccept?.();
    if (tutorialMode) tutorialUI.markStep('container');
    return;
  }
  if (npc && ['merchant', 'bearMerchant', 'healer', 'gunsmith',
              'armorer', 'tailor', 'relicSeller', 'blackMarket'].includes(npc.kind)) {
    if (npc.kind === 'bearMerchant' && !npc.stock) npc.stock = makeMerchantStock('bearMerchant');
    npc._rerollUsed = false;     // per-visit flag, cleared on each open
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
      fireHint('keycard');
      sfx.empty();
    }
    return;
  }
  const localInExit = level.isPlayerInExit(player.mesh.position) && exitCooldown <= 0;
  // Track the bit even when not extracting — peers read it to gate
  // their own advanceFloor + render the "waiting for teammate" HUD.
  _localInExit = localInExit;
  if (localInExit) {
    // Tutorial extract — bypass the normal advanceFloor flow and
    // bounce back to the main menu so the player doesn't roll into
    // a real run by accident.
    if (tutorialMode) {
      tutorialUI.markStep('extract');
      tutorialMode = false;
      tutorialUI.hide();
      sfx.ambientStop();
      mainMenuUI.show();
      return;
    }
    // Coop: dual-opt-in. Host only triggers advanceFloor when every
    // living joiner ghost is also flagged in-exit. Joiners just sit
    // in the zone with the bit set and wait for the host's level-
    // seed broadcast — see the level-seed handler for the joiner-
    // side regen + skill-pick beat.
    const t = getCoopTransport();
    const coopActive = t.isOpen && coopLobby && coopLobby.ghosts.size > 0;
    if (coopActive) {
      if (t.isHost) {
        if (_coopAllPeersReadyToExtract()) extractPending = true;
        // Else: wait. HUD pill is rendered separately each frame.
      }
      // Joiners do nothing — broadcasting xt:1 is enough; the host
      // will advance the floor and broadcast level-seed.
    } else {
      extractPending = true;
    }
  }
}

// True when every living joiner ghost is standing in the exit zone.
// Dead peers don't gate the extract — they're out of the run.
function _coopAllPeersReadyToExtract() {
  if (!coopLobby) return true;
  for (const [, g] of coopLobby.ghosts) {
    if (g.dead) continue;
    if (!g.inExit) return false;
  }
  return true;
}

// Revive-item priority table. Higher hpPct = stronger revive. The
// first carried item by this order wins when F is pressed while
// reviving. Bandage is the floor — explicitly carried bandages give
// 40% revive vs the 30% hold-only default; the only reason for the
// gap is opportunity cost (you spent the bandage instead of saving
// it for self-heal). Tourniquet is NOT in this table — it's a
// bleedout extender, not a revive (handled separately below).
const _REVIVE_ITEMS = [
  { id: 'cons_defib',       kind: 'defib',       hpPct: 1.00, label: 'DEFIB' },
  { id: 'cons_trauma',      kind: 'trauma',      hpPct: 0.90, label: 'TRAUMA' },
  { id: 'cons_afak',        kind: 'ifak',        hpPct: 0.70, label: 'IFAK' },
  { id: 'cons_medkit',      kind: 'medkit',      hpPct: 0.60, label: 'MEDKIT' },
  { id: 'cons_bandage',     kind: 'bandage',     hpPct: 0.40, label: 'BANDAGE' },
];
const _REVIVE_KIND_TO_HP = Object.fromEntries(
  _REVIVE_ITEMS.map(r => [r.kind, r.hpPct]));
function _findBestReviveItem() {
  if (!inventory.findFirstConsumable) return null;
  for (const r of _REVIVE_ITEMS) {
    const found = inventory.findFirstConsumable(it => it.id === r.id);
    if (found) return { entry: found, ...r };
  }
  return null;
}
// Tourniquet — bleedout extender. Resets the downed peer's bleedout
// timer to the full duration without bringing them up. Used as the
// fallback when no instant-revive item is carried; lets the reviver
// "buy time" if they need to clear a room before doing the full
// hold-revive.
function _findTourniquet() {
  if (!inventory.findFirstConsumable) return null;
  const found = inventory.findFirstConsumable(it => it.id === 'cons_tourniquet');
  return found ? { entry: found, kind: 'tourniquet', label: 'TOURNIQUET' } : null;
}

// All revive-relevant item ids (instant revives + tourniquet). Used
// by the medical menu to enumerate what each peer is carrying.
const _ALL_REVIVE_ITEM_IDS = [
  ..._REVIVE_ITEMS.map(r => r.id),
  'cons_tourniquet',
];
const _MEDICAL_LABELS = {
  cons_defib:      { kind: 'defib',      label: 'DEFIB',      hpPct: 1.00 },
  cons_trauma:     { kind: 'trauma',     label: 'TRAUMA',     hpPct: 0.90 },
  cons_afak:       { kind: 'ifak',       label: 'IFAK',       hpPct: 0.70 },
  cons_medkit:     { kind: 'medkit',     label: 'MEDKIT',     hpPct: 0.60 },
  cons_bandage:    { kind: 'bandage',    label: 'BANDAGE',    hpPct: 0.40 },
  cons_tourniquet: { kind: 'tourniquet', label: 'TOURNIQUET', hpPct: null },
};
// List the medical-relevant item ids in the local player's inventory.
// Multi-stack stays as repeated ids so the menu shows count.
function _coopMyMedicalIds() {
  if (!inventory || !inventory.backpack) return [];
  const ids = [];
  for (const it of inventory.backpack) {
    if (!it || it.type !== 'consumable') continue;
    if (!_MEDICAL_LABELS[it.id]) continue;
    const stack = (it.count | 0) || 1;
    for (let i = 0; i < stack; i++) ids.push(it.id);
  }
  return ids;
}

// Sticky hint that surfaces while the local player is in revive range
// of a downed peer AND carries any instant-revive item. Reads
// "[F] <ITEM> — REVIVE" so the player knows the bypass exists.
let _defibHintEl = null;
function _refreshDefibHint(targetPeerId) {
  if (!targetPeerId) {
    if (_defibHintEl && _defibHintEl._lastDisp !== 'none') {
      _defibHintEl.style.display = 'none';
      _defibHintEl._lastDisp = 'none';
    }
    return;
  }
  const revive = _findBestReviveItem();
  const tourni = revive ? null : _findTourniquet();
  const found = revive || tourni;
  if (!found) {
    if (_defibHintEl && _defibHintEl._lastDisp !== 'none') {
      _defibHintEl.style.display = 'none';
      _defibHintEl._lastDisp = 'none';
    }
    return;
  }
  if (!_defibHintEl) {
    const el = document.createElement('div');
    el.id = 'defib-hint';
    Object.assign(el.style, {
      position: 'fixed', bottom: '110px', left: '50%',
      transform: 'translateX(-50%)', zIndex: '7',
      pointerEvents: 'none', display: 'none',
      font: '12px ui-monospace, Menlo, Consolas, monospace',
      letterSpacing: '2px', textTransform: 'uppercase',
      padding: '7px 14px',
      background: 'linear-gradient(180deg, #2a1c08, #100a02)',
      border: '1px solid #ffd060', borderRadius: '4px',
      color: '#ffe080',
      boxShadow: '0 0 18px rgba(255,200,80,0.45)',
    });
    document.body.appendChild(el);
    _defibHintEl = el;
  }
  // Auto-revive runs in the background; E opens the medical menu so
  // the player can pick a specific item to skip the hold.
  const nextText = `[E] MEDICAL — open pack`;
  if (_defibHintEl._lastTxt !== nextText) {
    _defibHintEl.textContent = nextText;
    _defibHintEl._lastTxt = nextText;
  }
  if (_defibHintEl._lastDisp !== 'block') {
    _defibHintEl.style.display = 'block';
    _defibHintEl._lastDisp = 'block';
  }
}

// Refresh the dual-opt-in extract HUD pill. Called every frame from
// tick(). Builds the DOM lazily on first show.
let _exitWaitHudEl = null;
function _refreshExitWaitHud() {
  if (!coopLobby) {
    if (_exitWaitHudEl) _exitWaitHudEl.style.display = 'none';
    return;
  }
  const t = getCoopTransport();
  const coopActive = t.isOpen && coopLobby.ghosts.size > 0;
  if (!coopActive || !_localInExit) {
    if (_exitWaitHudEl && _exitWaitHudEl._lastDisp !== 'none') {
      _exitWaitHudEl.style.display = 'none';
      _exitWaitHudEl._lastDisp = 'none';
    }
    return;
  }
  // Count living peers + how many of them are also in exit (host
  // doesn't appear in coopLobby.ghosts; we count ourselves separately).
  let total = 1, ready = 1;     // local is in exit by definition here
  for (const [, g] of coopLobby.ghosts) {
    if (g.dead) continue;
    total += 1;
    if (g.inExit) ready += 1;
  }
  if (!_exitWaitHudEl) {
    const el = document.createElement('div');
    el.id = 'exit-wait-hud';
    Object.assign(el.style, {
      position: 'fixed', top: '54px', left: '50%',
      transform: 'translateX(-50%)', zIndex: '7',
      pointerEvents: 'none', display: 'none',
      font: '12px ui-monospace, Menlo, Consolas, monospace',
      letterSpacing: '2px', textTransform: 'uppercase',
      padding: '8px 16px',
      background: 'linear-gradient(180deg, #1a2228, #0c1014)',
      border: '1px solid #60c0f2', borderRadius: '4px',
      color: '#a0d8ff',
      boxShadow: '0 0 24px rgba(80,200,255,0.4)',
      animation: 'exit-wait-pulse 1.6s ease-in-out infinite',
    });
    if (!document.getElementById('exit-wait-hud-style')) {
      const s = document.createElement('style');
      s.id = 'exit-wait-hud-style';
      s.textContent = `
        @keyframes exit-wait-pulse {
          0%, 100% { box-shadow: 0 0 24px rgba(80,200,255,0.4); }
          50%      { box-shadow: 0 0 38px rgba(80,200,255,0.7); }
        }
      `;
      document.head.appendChild(s);
    }
    document.body.appendChild(el);
    _exitWaitHudEl = el;
  }
  let nextText, nextDisplay;
  if (ready >= total) {
    if (t.isHost) {
      nextText = '';
      nextDisplay = 'none';
    } else {
      nextText = 'EXTRACTING…';
      nextDisplay = 'block';
    }
  } else {
    nextText = `WAITING FOR TEAMMATE — ${ready}/${total}`;
    nextDisplay = 'block';
  }
  // Dedupe DOM writes — these helpers run every frame.
  if (_exitWaitHudEl._lastTxt !== nextText) {
    _exitWaitHudEl.textContent = nextText;
    _exitWaitHudEl._lastTxt = nextText;
  }
  if (_exitWaitHudEl._lastDisp !== nextDisplay) {
    _exitWaitHudEl.style.display = nextDisplay;
    _exitWaitHudEl._lastDisp = nextDisplay;
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
  // Active contract modifier — `noConsumables: true` hard-blocks
  // consumable use (Iron Will). Throwables are returned earlier so
  // the rule cleanly only governs heals / buffs / boosts.
  if (_activeModifiers.noConsumables) {
    transientHudMsg('Contract bars consumables.');
    sfx.empty?.();
    return false;
  }
  // From here on we're using a real consumable (heal / buff / boost).
  // Throwables are returned earlier so they don't trip the contract.
  runStats.noteConsumableUsed();
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
  // The Gift — refuses to fire when the player's max HP is below the
  // sacrifice threshold (10). Not blocked at full health regardless
  // of current; the cost is to MAX, not current.
  let giftBodyMesh = null;
  if (item && item.throwKind === 'theGift') {
    const sacrifice = item.sacrificeMaxHp || 10;
    const playerMax = playerMaxHealthCached || 100;
    if (playerMax < sacrifice) {
      transientHudMsg('Too weak to give', 2.0);
      return false;
    }
    giftBodyMesh = _buildGiftBear();
  }
  const muzzle = lastPlayerInfo.muzzleWorld ? lastPlayerInfo.muzzleWorld.clone()
    : player.mesh.position.clone().setY(1.2);
  // Flat-throw items (Elven Knife) take a special straight-line path
  // at chest height with zero gravity. Spawn a horizontal velocity
  // toward the cursor and skip the ballistic arc math entirely.
  if (item && item.flatThrow) {
    const aimY = 1.0;
    muzzle.y = aimY;
    const fdx = lastAim.x - muzzle.x;
    const fdz = lastAim.z - muzzle.z;
    const flen = Math.hypot(fdx, fdz) || 1;
    const SPEED = 28;
    const fvel = new THREE.Vector3((fdx / flen) * SPEED, 0, (fdz / flen) * SPEED);
    const flatOpts = {
      pos: muzzle, vel: fvel,
      type: 'grenade',
      lifetime: item.fuse ?? 1.5,
      radius: 0.06,
      color: item.tint || 0xe0f0d0,
      explosion: {
        radius: item.aoeRadius ?? 0.7,
        damage: item.aoeDamage ?? 99999,
        shake: item.aoeShake ?? 0.2,
      },
      owner: 'player',
      gravity: 0,
      bounciness: 0,
      fuseAfterLand: false,
      throwKind: item.throwKind || 'elvenKnife',
      throwDirX: fdx, throwDirZ: fdz,
    };
    projectiles.spawn(_coopNeuterThrowOpts(flatOpts));
    _coopBroadcastThrowable(flatOpts);
    sfx.uiAccept();
    return true;
  }
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
  //
  // Molotovs (incl. Maotai variant) get a flatter ceiling — bottle
  // arcs were clipping low ceilings on long throws and detonating
  // mid-air against an invisible obstacle. 1.2m apex keeps the
  // bottle well below the ~3m ceiling skip line.
  const dx = aim.x - muzzle.x, dz = aim.z - muzzle.z;
  const throwDist = Math.hypot(dx, dz);
  const MIN_APEX = 0.35;
  const MAX_APEX = item.throwKind === 'molotov' ? 1.2 : 2.7;
  const apex = MIN_APEX + (MAX_APEX - MIN_APEX) * Math.min(1, throwDist / 14);
  const vel = ProjectileManager.ballisticVelocityApex(muzzle, aim, apex, gravity);
  const arcOpts = {
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
         : item.throwKind === 'claymore'? 0x4a8030
         : item.throwKind === 'theGift' ? 0xb04030
         : 0x60a040,
    explosion: {
      radius: item.aoeRadius ?? 3.5,
      damage: item.aoeDamage ?? 0,
      shake: item.aoeShake ?? 0.35,
    },
    owner: 'player',
    gravity,
    // Grenades visibly bounce now — bumped from 0.15 → 0.40 so the
    // throw reads as a hand-held device skipping off the floor before
    // settling. Molotov + claymore stick on first contact (bounciness 0).
    bounciness: (item.throwKind === 'molotov' || item.throwKind === 'claymore') ? 0.0 : 0.40,
    // Fuse-after-landing — frag/flash/stun all want to bounce and
    // settle before going off. Molotov + claymore "detonate" on
    // impact (the claymore's "detonate" means it places the mine,
    // not blows up).
    fuseAfterLand: item.throwKind !== 'molotov' && item.throwKind !== 'claymore',
    throwKind: item.throwKind || 'frag',
    fireDuration: item.fireDuration,
    fireTickDps: item.fireTickDps,
    gasDuration: item.gasDuration,
    blindDuration: item.blindDuration,
    stunDuration: item.stunDuration,
    triggerRadius: item.triggerRadius,
    triggerConeDeg: item.triggerConeDeg,
    // The Gift propagates these so the explosion handler can pay the
    // sacrifice cost and bypass LoS checks.
    throughWalls: !!item.throughWalls,
    sacrificeMaxHp: item.sacrificeMaxHp,
    customBody: giftBodyMesh,
    // Throw heading — claymore aims its detonation cone in the throw
    // direction, so a player flicking left places a mine that fires left.
    throwDirX: dx,
    throwDirZ: dz,
  };
  projectiles.spawn(_coopNeuterThrowOpts(arcOpts));
  _coopBroadcastThrowable(arcOpts);
  sfx.uiAccept();
  return true;
}

// --- Throw arc preview ---------------------------------------------
// While the player holds a quickslot bound to a throwable, render the
// predicted arc + landing ring. Path turns red when an obstacle blocks
// the throw before it reaches the cursor.
const _THROW_PREVIEW_SEGMENTS = 32;
const _THROW_OK_COLOR = 0x6abe5a;       // green when the path lands clean
const _THROW_BAD_COLOR = 0xc94a3a;      // red when an obstacle interrupts it
let _throwPreview = null;
function _buildThrowPreview() {
  if (_throwPreview) return _throwPreview;
  // Line: pre-allocated vertex buffer reused every frame. We rewrite
  // the buffer in-place + adjust setDrawRange to truncate when the
  // arc terminates early on an obstacle.
  const positions = new Float32Array((_THROW_PREVIEW_SEGMENTS + 1) * 3);
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: _THROW_OK_COLOR, transparent: true, opacity: 0.85, depthTest: false,
  });
  const line = new THREE.Line(lineGeom, lineMat);
  line.renderOrder = 9;
  line.visible = false;
  scene.add(line);
  // Landing ring — flat disc at the impact point. Two rings stacked
  // for readability: filled centre + thicker outer outline.
  const ringGeom = new THREE.RingGeometry(0.55, 0.70, 28);
  const ringMat = new THREE.MeshBasicMaterial({
    color: _THROW_OK_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    depthTest: false,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 9;
  ring.visible = false;
  scene.add(ring);
  _throwPreview = { line, lineGeom, lineMat, positions, ring, ringMat };
  return _throwPreview;
}
const _throwSamplePt = new THREE.Vector3();
function _hitsThrowObstacle(x, y, z) {
  // Mirrors ProjectileManager._hitsObstacle so the preview matches the
  // projectile's actual collision rules. Skips the y>3 ceiling so the
  // arc isn't clipped by tall walls' invisible upper bound.
  if (y > 3.0) return false;
  const obstacles = level.solidObstacles ? level.solidObstacles() : [];
  const r = 0.1;
  for (const o of obstacles) {
    const b = o.userData.collisionXZ;
    if (!b) continue;
    if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
      return true;
    }
  }
  return false;
}
function tickThrowAimPreview(item) {
  if (!lastPlayerInfo || !lastAim) { hideThrowPreview(); return; }
  const pv = _buildThrowPreview();
  // Match throwItem's launch math exactly so the preview is truthful.
  const muzzle = lastPlayerInfo.muzzleWorld || player.mesh.position;
  const aimX = lastAim.x, aimZ = lastAim.z;
  const dx = aimX - muzzle.x;
  const dz = aimZ - muzzle.z;
  const throwDist = Math.hypot(dx, dz);
  if (throwDist < 0.05) { hideThrowPreview(); return; }

  // Flat-throw items (Elven Knife) — chest-height straight line, no
  // arc. Stop the line at the first wall hit; otherwise extend to
  // the cursor.
  if (item && item.flatThrow) {
    const FLAT_Y = 1.0;
    const segs = _THROW_PREVIEW_SEGMENTS;
    const positions = pv.positions;
    let usedVerts = segs + 1;
    let blocked = false;
    let endX = aimX, endZ = aimZ;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const px = muzzle.x + dx * t;
      const pz = muzzle.z + dz * t;
      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = FLAT_Y;
      positions[i * 3 + 2] = pz;
      if (i > 0 && _hitsThrowObstacle(px, FLAT_Y, pz)) {
        endX = px; endZ = pz;
        usedVerts = i + 1;
        blocked = true;
        break;
      }
      endX = px; endZ = pz;
    }
    pv.lineGeom.attributes.position.needsUpdate = true;
    pv.lineGeom.setDrawRange(0, usedVerts);
    pv.lineMat.color.setHex(blocked ? _THROW_BAD_COLOR : _THROW_OK_COLOR);
    pv.line.visible = true;
    pv.ring.position.set(endX, 0.05, endZ);
    pv.ringMat.color.setHex(blocked ? _THROW_BAD_COLOR : _THROW_OK_COLOR);
    pv.ring.visible = true;
    return;
  }

  const MIN_APEX = 0.35;
  const MAX_APEX = 2.7;
  const apex = MIN_APEX + (MAX_APEX - MIN_APEX) * Math.min(1, throwDist / 14);
  const gravity = 9.8;
  _throwSamplePt.set(aimX, 0, aimZ);
  const vel = ProjectileManager.ballisticVelocityApex(muzzle, _throwSamplePt, apex, gravity);
  // Step the arc in fixed time slices. tFlight = (vel.y + sqrt(vel.y² +
  // 2g*muzzle.y)) / g — solves y(t) = muzzle.y + vel.y*t - 0.5*g*t² = 0.
  // We over-sample slightly + clamp.
  const tFlight = (vel.y + Math.sqrt(vel.y * vel.y + 2 * gravity * Math.max(0, muzzle.y))) / gravity;
  const segs = _THROW_PREVIEW_SEGMENTS;
  let blocked = false;
  let endX = aimX, endY = 0.05, endZ = aimZ;
  let usedVerts = segs + 1;
  const positions = pv.positions;
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * tFlight;
    const px = muzzle.x + vel.x * t;
    const py = Math.max(0.04, muzzle.y + vel.y * t - 0.5 * gravity * t * t);
    const pz = muzzle.z + vel.z * t;
    positions[i * 3 + 0] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    if (i > 0 && _hitsThrowObstacle(px, py, pz)) {
      blocked = true;
      endX = px; endY = Math.max(0.05, py); endZ = pz;
      usedVerts = i + 1;
      break;
    }
  }
  pv.lineGeom.attributes.position.needsUpdate = true;
  pv.lineGeom.setDrawRange(0, usedVerts);
  const color = blocked ? _THROW_BAD_COLOR : _THROW_OK_COLOR;
  pv.lineMat.color.setHex(color);
  pv.ringMat.color.setHex(color);
  // Landing ring sits on the ground at the impact point (or aim point
  // if the throw lands clean). Lifted slightly so it doesn't z-fight.
  pv.ring.position.set(endX, 0.03, endZ);
  pv.line.visible = true;
  pv.ring.visible = true;
}
function hideThrowPreview() {
  if (!_throwPreview) return;
  _throwPreview.line.visible = false;
  _throwPreview.ring.visible = false;
}

// Quickslot index (0..3) currently being held to aim a throwable, or
// -1 if none. Captured on press; on release the throw fires.
let _throwAimSlot = -1;
// True when the held slot lives in the weapon cluster (keys 1-4),
// false when it's in the upper hotbar (keys 5-8). Determines which
// held-tracker (weaponSlotHeld vs actionSlotHeld) the release loop
// reads from, and which hotbar offset useActionSlot needs.
let _throwAimFromWeaponBar = false;

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
// Scratch reused for burn-tick world-space damage-number anchors —
// spawnDamageNumber projects the vector synchronously then drops it.
const _burnReadoutPt = new THREE.Vector3();
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
          _burnReadoutPt.set(c.group.position.x, 1.2, c.group.position.z);
          // Reuse the 'burn' zone tag so styling stays consistent with
          // other damage types — spawnDamageNumber picks a color per
          // zone / tag.
          spawnDamageNumber(_burnReadoutPt, camera, rounded, 'burn');
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
// --- Smoke + decoy throwables --------------------------------------
// Smoke zones block enemy line-of-sight while alive. Visualised as a
// slowly-expanding low-opacity dome that fades over the zone's life.
// Decoy beacons attract enemy navigation toward the beacon position
// (consumed by gunman / melee detection — they treat the decoy as
// `playerPos` while it's alive). Both register on a module-level
// list so the per-frame tick can update visuals + expire them.
const _smokeZones = [];
const _decoys = [];
const _gasZones = [];

// Gas grenade — green poison cloud lingering for `duration`s.
// Anything inside (player + enemies) takes per-second drains: 5%
// max HP / 10% stamina for the player, 5% HP for enemies. Visual
// is a translucent green dome + ground ring matching smoke zones.
function spawnGasZone(pos, radius, duration, owner = 'player') {
  const baseMat = new THREE.MeshBasicMaterial({
    color: 0x60d040, transparent: true, opacity: 0.40,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), baseMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.05, pos.z);
  scene.add(ring);
  const domeMat = new THREE.MeshBasicMaterial({
    color: 0x80e060, transparent: true, opacity: 0.32,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.set(pos.x, 0, pos.z);
  scene.add(dome);
  _gasZones.push({ x: pos.x, z: pos.z, radius, life: duration, t: 0, ring, dome, owner });
}

function spawnSmokeZone(pos, radius, duration) {
  // Cheap visual: one disc + one dome, both transparent. No particle
  // system — keeps the per-frame cost flat regardless of zone count.
  const baseMat = new THREE.MeshBasicMaterial({
    color: 0x9aa4ad, transparent: true, opacity: 0.35,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), baseMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.05, pos.z);
  scene.add(ring);
  const domeMat = new THREE.MeshBasicMaterial({
    color: 0xb8c0c8, transparent: true, opacity: 0.30,
    depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.position.set(pos.x, 0, pos.z);
  scene.add(dome);
  _smokeZones.push({ x: pos.x, z: pos.z, radius, life: duration, t: 0, ring, dome });
}

function spawnDecoyBeacon(pos, duration) {
  // Spinning yellow rod + ground ring so the beacon reads as "active".
  const rodMat = new THREE.MeshBasicMaterial({ color: 0xe0c040, transparent: true, opacity: 0.85 });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.55, 8), rodMat);
  rod.position.set(pos.x, 0.30, pos.z);
  scene.add(rod);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xe0c040, transparent: true, opacity: 0.45,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 18), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.05, pos.z);
  scene.add(ring);
  _decoys.push({ x: pos.x, z: pos.z, life: duration, t: 0, rod, ring });
}

// Tick + cleanup for smoke + decoys. Visuals fade over the last 30%
// of life; mesh + material disposed on expiry.
function _tickThrowableZones(dt) {
  for (let i = _smokeZones.length - 1; i >= 0; i--) {
    const z = _smokeZones[i];
    z.t += dt;
    const fade = z.t > z.life * 0.7
      ? Math.max(0, (z.life - z.t) / (z.life * 0.3))
      : 1;
    z.ring.material.opacity = 0.35 * fade;
    z.dome.material.opacity = 0.30 * fade;
    if (z.t >= z.life) {
      scene.remove(z.ring); z.ring.geometry.dispose(); z.ring.material.dispose();
      scene.remove(z.dome); z.dome.geometry.dispose(); z.dome.material.dispose();
      _smokeZones.splice(i, 1);
    }
  }
  for (let i = _decoys.length - 1; i >= 0; i--) {
    const d = _decoys[i];
    d.t += dt;
    d.rod.rotation.y += dt * 4;
    const fade = d.t > d.life * 0.7
      ? Math.max(0, (d.life - d.t) / (d.life * 0.3))
      : 1;
    d.rod.material.opacity = 0.85 * fade;
    d.ring.material.opacity = 0.45 * fade;
    if (d.t >= d.life) {
      scene.remove(d.rod); d.rod.geometry.dispose(); d.rod.material.dispose();
      scene.remove(d.ring); d.ring.geometry.dispose(); d.ring.material.dispose();
      _decoys.splice(i, 1);
    }
  }
  // Gas zones — visual fade + per-second drain on player + enemies
  // inside the radius. Drains: player 5%/s max HP + 10%/s max stamina;
  // enemies 5%/s of their max HP.
  for (let i = _gasZones.length - 1; i >= 0; i--) {
    const z = _gasZones[i];
    z.t += dt;
    const fade = z.t > z.life * 0.7
      ? Math.max(0, (z.life - z.t) / (z.life * 0.3))
      : 1;
    z.ring.material.opacity = 0.40 * fade;
    z.dome.material.opacity = 0.32 * fade;
    const r2 = z.radius * z.radius;
    // Player drain — gated on owner !== 'remote' so a coop visual
    // mirror of someone else's gas (or the local thrower's own
    // damage-zeroed mirror) doesn't drain our own HP. Auth host
    // damage to remote players flows via the ghost scan below.
    if (player && lastPlayerInfo && z.owner !== 'remote') {
      const dx = player.mesh.position.x - z.x;
      const dz = player.mesh.position.z - z.z;
      if (dx * dx + dz * dz <= r2) {
        const hpDrain = (lastPlayerInfo.maxHealth || 100) * 0.05 * dt;
        const stamDrain = (lastPlayerInfo.maxStamina || 100) * 0.10 * dt;
        damagePlayer(hpDrain, 'gas');
        if (player.consumeStamina) player.consumeStamina('gas', stamDrain);
      }
    }
    // Coop: host-side ghost scan — joiners standing in this auth gas
    // zone take damage via rpc-player-damage. Throttled per-(zone,
    // peer) so the 0.4s tick rate matches the local player's
    // perceived drain rate. owner==='player' gate skips remote
    // mirrors automatically.
    if (z.owner === 'player' && coopLobby) {
      const tHost = getCoopTransport();
      if (tHost.isOpen && tHost.isHost && coopLobby.ghosts.size > 0) {
        if (!z._coopLastTick) z._coopLastTick = Object.create(null);
        for (const [peerId, ghost] of coopLobby.ghosts) {
          if (ghost.dead) continue;
          const dx = ghost.x - z.x;
          const dz = ghost.z - z.z;
          if (dx * dx + dz * dz > r2) continue;
          const ll = z._coopLastTick[peerId] || 0;
          if ((z.t - ll) > 0.4) {
            z._coopLastTick[peerId] = z.t;
            // ~5% max-HP drain per 0.4s tick (matches host's local rate).
            const dmg = ((lastPlayerInfo?.maxHealth || 100) * 0.05 * 0.4);
            _coopSendPlayerDamage(peerId, dmg, 'gas', { zone: 'torso' });
          }
        }
      }
    }
    // Enemy drain — only from PLAYER-owned gas. Enemy-thrown gas
    // never damages other enemies (was a chain self-kill bug where
    // an enemy chucked a gas grenade at the player and wiped its
    // own squad standing behind it).
    if (z.owner === 'player') {
      const sweep = (list) => {
        for (const c of list) {
          if (!c.alive) continue;
          const dx = c.group.position.x - z.x;
          const dz = c.group.position.z - z.z;
          if (dx * dx + dz * dz > r2) continue;
          const maxHp = c.maxHp || c.hp || 30;
          const tickDmg = maxHp * 0.05 * dt;
          const wasAlive = c.alive;
          c.hp -= tickDmg;
          if (c.hp <= 0) {
            c.alive = false; c.state = 'dead'; c.deathT = 0;
            if (wasAlive) onEnemyKilled(c);
          }
        }
      };
      sweep(gunmen.gunmen);
      sweep(melees.enemies);
    }
    if (z.t >= z.life) {
      scene.remove(z.ring); z.ring.geometry.dispose(); z.ring.material.dispose();
      scene.remove(z.dome); z.dome.geometry.dispose(); z.dome.material.dispose();
      _gasZones.splice(i, 1);
    }
  }
}

// --- Claymores ------------------------------------------------------
// Placed mines: small green plate + two diagonal red lasers showing
// the trigger cone. When an alive enemy enters the proximity sphere
// AND lies within the front cone, the claymore detonates with a
// directional cone explosion (damage falls off both with distance
// and with how far off-axis the enemy is).
//
// Perf:
//  * Geometries (plate, leg, laser segment) are CACHED once. Each
//    placement allocates 5 small Mesh objects + their materials —
//    not pooled (placements are rare relative to fire orbs) but
//    cheap enough that placing both charges back-to-back is one
//    frame of work.
//  * Proximity check runs once per claymore per frame against alive
//    enemies only (early-outs on tier === 'dead'). Squared-distance
//    test, no allocations.
//  * Detonation tears down BOTH lasers + plate + legs and dispatches
//    the standard explosion path so the cleanup is the same handful
//    of dispose() calls every other throwable already pays.
const _claymores = [];
const _claymoreCache = {};
function _claymoreGeoms() {
  if (_claymoreCache.plate) return _claymoreCache;
  _claymoreCache.plate = new THREE.BoxGeometry(0.34, 0.18, 0.07);
  _claymoreCache.leg   = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 5);
  _claymoreCache.laser = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
  return _claymoreCache;
}
function placeClaymore(pos, dirX, dirZ, opts) {
  const geo = _claymoreGeoms();
  const dl = Math.hypot(dirX || 0, dirZ || 0) || 1;
  const fx = (dirX || 0) / dl;
  const fz = (dirZ || 0) / dl;
  const yaw = Math.atan2(fx, fz);

  const group = new THREE.Group();
  group.position.set(pos.x, 0, pos.z);
  group.rotation.y = yaw;

  const plate = new THREE.Mesh(geo.plate, new THREE.MeshStandardMaterial({
    color: 0x4a8030, roughness: 0.6, metalness: 0.2,
    emissive: 0x183008, emissiveIntensity: 0.4,
  }));
  plate.position.y = 0.20;
  group.add(plate);
  const legL = new THREE.Mesh(geo.leg, new THREE.MeshStandardMaterial({ color: 0x222222 }));
  const legR = legL.clone();
  legL.position.set(-0.12, 0.09, -0.05);
  legR.position.set( 0.12, 0.09, -0.05);
  legL.rotation.x =  0.35; legR.rotation.x = 0.35;
  group.add(legL); group.add(legR);

  // Two diagonal red laser tripwires fanning forward from the plate.
  // Each laser is a 1m cylinder oriented along its diagonal direction,
  // so the trigger zone reads as a clear "X" in front of the mine.
  const triggerR = opts.triggerRadius;
  const halfCone = (opts.triggerConeDeg * Math.PI / 180) / 2;
  const laserMat = new THREE.MeshBasicMaterial({
    color: 0xff2030, transparent: true, opacity: 0.85,
    depthWrite: false,
  });
  const mkLaser = (sign) => {
    const len = triggerR;
    const m = new THREE.Mesh(geo.laser, laserMat);
    m.scale.y = len;                          // stretch unit cyl to len
    // Orient: forward (local +Z) + rotated by ±halfCone around Y.
    // Cylinder is along Y, so we tilt 90° around X first, then yaw.
    m.rotation.order = 'YXZ';
    m.rotation.x = Math.PI / 2;               // align cylinder with +Z
    m.rotation.y = halfCone * sign;
    // Position the segment so its near end is at the plate front,
    // pointing outward.
    const midOffset = len / 2;
    m.position.set(
      Math.sin(halfCone * sign) * midOffset,
      0.18,
      Math.cos(halfCone * sign) * midOffset + 0.05,
    );
    return m;
  };
  const laserA = mkLaser(+1);
  const laserB = mkLaser(-1);
  group.add(laserA); group.add(laserB);

  scene.add(group);
  _claymores.push({
    x: pos.x, z: pos.z, fx, fz,
    triggerR, triggerR2: triggerR * triggerR,
    coneCos: Math.cos(halfCone),
    radius: opts.radius,
    damage: opts.damage,
    shake: opts.shake,
    armT: 1.2,                          // arming delay — laser starts yellow then turns red when live
    group, plate, legL, legR, laserA, laserB, laserMat,
    blink: Math.random() * Math.PI * 2,
    alive: true,
  });
}
// Tear down every placed claymore — meshes + materials disposed,
// list cleared. Called from regenerateLevel so mines from the
// previous floor don't persist (they were spawned through
// placeClaymore which sits outside the projectile manager, so
// projectiles.removeAll didn't reach them).
function _removeAllClaymores() {
  for (const c of _claymores) {
    if (c.group) {
      if (c.group.parent) c.group.parent.remove(c.group);
      c.group.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose?.();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m?.dispose?.());
          else o.material.dispose?.();
        }
      });
    }
  }
  _claymores.length = 0;
}
function _tickClaymores(dt) {
  for (let i = _claymores.length - 1; i >= 0; i--) {
    const c = _claymores[i];
    if (!c.alive) { _claymores.splice(i, 1); continue; }
    if (c.armT > 0) {
      c.armT = Math.max(0, c.armT - dt);
      // Arming: lasers pulse yellow + faster blink to telegraph the
      // mine isn't live yet.
      c.blink += dt * 12;
      c.laserMat.color.setHex(0xffd040);
      c.laserMat.opacity = 0.55 + 0.35 * Math.sin(c.blink);
      if (c.armT === 0) c.laserMat.color.setHex(0xff2030);
      continue;
    }
    // Live state: red lasers, slower steady blink.
    c.blink += dt * 6;
    c.laserMat.opacity = 0.65 + 0.25 * Math.sin(c.blink);
    // Proximity test against alive enemies only.
    let trip = null;
    const check = (list) => {
      if (trip) return;
      for (const e of list) {
        if (!e.alive) continue;
        const dx = e.group.position.x - c.x;
        const dz = e.group.position.z - c.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > c.triggerR2) continue;
        const d = Math.sqrt(d2) || 1;
        const dot = (dx / d) * c.fx + (dz / d) * c.fz;
        if (dot < c.coneCos) continue;     // outside the front cone
        trip = e;
        return;
      }
    };
    check(gunmen.gunmen);
    check(melees.enemies);
    if (trip) _detonateClaymore(c);
  }
}
function _detonateClaymore(c) {
  if (!c.alive) return;
  c.alive = false;
  const pos = new THREE.Vector3(c.x, 0.4, c.z);
  // Tear down the prop + lasers BEFORE dispatching the explosion so
  // there's no chance the visual lingers across the explosion frame.
  if (c.group.parent) c.group.parent.remove(c.group);
  // Plate uses MeshStandardMaterial which we built bespoke; legs use
  // their own material instances; lasers share laserMat. Dispose all.
  c.plate.material.dispose();
  c.legL.material.dispose();
  c.legR.material.dispose();
  c.laserMat.dispose();
  // Cone-shaped damage along the mine's facing. Re-uses the standard
  // explosion VFX (fireball + shockwave) so the visual matches every
  // other throwable. Damage falls off off-axis: enemies straight in
  // front take full hit, edge of cone takes ~30%.
  spawnExplosionFx(pos, c.radius);
  if (sfx.explode) sfx.explode();
  triggerShake(c.shake || 0.55, 0.35);
  triggerHitStop?.(0.05);
  const r2 = c.radius * c.radius;
  const apply = (list) => {
    for (const e of list) {
      if (!e.alive) continue;
      const dx = e.group.position.x - c.x;
      const dz = e.group.position.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      const dot = (dx / d) * c.fx + (dz / d) * c.fz;
      if (dot < c.coneCos) continue;       // shielded by being behind
      // Distance falloff (1.0 → 0.25) × cone falloff (1.0 → 0.4).
      const distMul = Math.max(0.25, 1 - 0.75 * (d / c.radius));
      const coneT = (dot - c.coneCos) / (1 - c.coneCos);
      const coneMul = 0.4 + 0.6 * coneT;
      const dmg = c.damage * distMul * coneMul;
      const wasAlive = e.alive;
      _explodeDir.set(dx / d, 0, dz / d);
      runStats.addDamage(dmg);
      e.manager.applyHit(e, dmg, 'torso', _explodeDir, { weaponClass: 'explosive' });
      if (wasAlive && !e.alive) onEnemyKilled(e, { byThrowable: true });
    }
  };
  apply(gunmen.gunmen);
  apply(melees.enemies);
}

// Public predicates the AI tick uses to alter detection / target.
function isInsideSmoke(x, z) {
  for (const zone of _smokeZones) {
    const dx = x - zone.x, dz = z - zone.z;
    if (dx * dx + dz * dz < zone.radius * zone.radius) return true;
  }
  return false;
}

// Smoke-confusion helpers ------------------------------------------------
// "Freshest" = last-pushed = the smoke the player most recently entered.
// Returns the matching zone object (with {x, z, radius}) or null.
function smokeContaining(x, z) {
  for (let i = _smokeZones.length - 1; i >= 0; i--) {
    const zone = _smokeZones[i];
    const dx = x - zone.x, dz = z - zone.z;
    if (dx * dx + dz * dz < zone.radius * zone.radius) return zone;
  }
  return null;
}

// Does the segment from (eyeX, eyeZ) to (px, pz) pass through any smoke
// dome's XZ footprint? Returns the freshest-matching zone or null.
// Standard segment-circle intersection: project the centre onto the
// segment, compare perpendicular distance to the radius. The result is
// used as the "shoot at the smoke" target when the player is on the
// far side of a smoke from the enemy.
function smokeOnSegment(eyeX, eyeZ, px, pz) {
  const dx = px - eyeX, dz = pz - eyeZ;
  const segLenSq = dx * dx + dz * dz;
  if (segLenSq < 0.0001) return null;
  for (let i = _smokeZones.length - 1; i >= 0; i--) {
    const zone = _smokeZones[i];
    const cx = zone.x - eyeX, cz = zone.z - eyeZ;
    let t = (cx * dx + cz * dz) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = t * dx, closestZ = t * dz;
    const distX = cx - closestX, distZ = cz - closestZ;
    const r = zone.radius;
    if (distX * distX + distZ * distZ < r * r) return zone;
  }
  return null;
}

// Random aim point inside a smoke zone — used by confused enemies to
// spray bullets into the cloud rather than locking on the entry edge.
// Returns { x, z } at a uniformly-distributed point in the disc.
function randomSmokeAim(zone) {
  const r = zone.radius * Math.sqrt(Math.random()) * 0.85;
  const a = Math.random() * Math.PI * 2;
  return { x: zone.x + Math.cos(a) * r, z: zone.z + Math.sin(a) * r };
}
function activeDecoy() {
  // Return the freshest active decoy (last spawned), or null.
  if (_decoys.length === 0) return null;
  return _decoys[_decoys.length - 1];
}

// --- Camping detection -----------------------------------------------
// Track how long the player has held roughly-the-same position. Boss
// AI uses this to decide whether to throw a grenade and force the
// player out of cover. Reset whenever the player moves more than ~2m
// from the last sampled spot.
let playerCampingT = 0;
const playerCampingThreshold = 3.5;   // seconds of stillness before "camping"
const _campingAnchor = new THREE.Vector3();
function _tickCamping(dt) {
  if (!player) return;
  const p = player.mesh.position;
  if (_campingAnchor.lengthSq() === 0) _campingAnchor.copy(p);
  const dx = p.x - _campingAnchor.x;
  const dz = p.z - _campingAnchor.z;
  if (dx * dx + dz * dz > 2.0 * 2.0) {
    _campingAnchor.copy(p);
    playerCampingT = 0;
  } else {
    playerCampingT += dt;
  }
}

// Spawner boss — teleport the boss to a random open point in its
// room, then spawn 3-4 weak melee adds at the new position. Forces
// the player to manage adds vs. punish the boss during the brief
// recharge window. Picks open spots via simple random sampling
// inside the room bounds; walks away if no open spot is found
// within a few attempts.
// Generic boss teleport — pick a random open spot inside the boss's
// room, no closer than 4m to the player. Used by the melee boss to
// reposition periodically (counter to kiting). Returns true on
// success so callers can reset their teleport timer.
function bossTeleport(boss) {
  if (!boss || !boss.alive) return false;
  const room = level.rooms?.find(r => r.id === boss.roomId);
  if (!room) return false;
  const b = room.bounds;
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = b.minX + 2 + Math.random() * (b.maxX - b.minX - 4);
    const z = b.minZ + 2 + Math.random() * (b.maxZ - b.minZ - 4);
    if (level._collidesAt && level._collidesAt(x, z, 0.6)) continue;
    const dx = x - player.mesh.position.x, dz = z - player.mesh.position.z;
    if (dx * dx + dz * dz < 16) continue;
    // Telegraph the teleport with smoke puffs at both endpoints so the
    // player can read the move. Capture the old position first.
    const oldX = boss.group.position.x;
    const oldZ = boss.group.position.z;
    boss.group.position.x = x;
    boss.group.position.z = z;
    _spawnSmokePuff(oldX, oldZ);
    _spawnSmokePuff(x, z);
    return true;
  }
  return false;
}

// Cloaked-assassin variant — teleport BEHIND the player so the
// thrower has a clean line of sight to the player's back AND the
// player has a reaction window to spin. Picks a point opposite the
// player's aim direction at ~7-9m, with collision + open-ground
// validation. Fires smoke puffs at both endpoints.
function teleportBehindPlayer(enemy) {
  if (!enemy || !enemy.alive || !player) return false;
  const room = level.rooms?.find(r => r.id === enemy.roomId);
  if (!room) return false;
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  // "Behind" = opposite the player's aim. Falls back to opposite
  // facing if aim isn't defined.
  let bx, bz;
  if (lastAim && (lastAim.x !== px || lastAim.z !== pz)) {
    bx = px - lastAim.x;
    bz = pz - lastAim.z;
  } else {
    bx = -Math.sin(player.mesh.rotation.y);
    bz = -Math.cos(player.mesh.rotation.y);
  }
  const bd = Math.hypot(bx, bz) || 1;
  bx /= bd; bz /= bd;
  const b = room.bounds;
  for (let attempt = 0; attempt < 20; attempt++) {
    const dist = 7 + Math.random() * 2.5;       // 7-9.5m behind player
    const jitter = (Math.random() - 0.5) * 1.6;
    const tx = px + bx * dist + bz * jitter;
    const tz = pz + bz * dist - bx * jitter;
    if (tx < b.minX + 1 || tx > b.maxX - 1) continue;
    if (tz < b.minZ + 1 || tz > b.maxZ - 1) continue;
    if (level._collidesAt && level._collidesAt(tx, tz, 0.6)) continue;
    const oldX = enemy.group.position.x;
    const oldZ = enemy.group.position.z;
    enemy.group.position.x = tx;
    enemy.group.position.z = tz;
    _spawnSmokePuff(oldX, oldZ);
    _spawnSmokePuff(tx, tz);
    return true;
  }
  return false;
}

// Knife-thrower projectile system. Each fan spawn lays a 5-7 knife
// arc aimed at the player's last known position. Each knife is a
// small red emissive elongated box that flies in a straight line at
// constant speed, damages on player contact, expires on wall hit or
// after 1.6s, and is HITTABLE — included in allHittables() with
// userData.zone = 'knife' so the player can shoot them out of the
// air. Shared geometry + per-instance material (each knife mutates
// emissive on hit).
const _ASSASSIN_KNIVES = [];
const _KNIFE_GEOM = new THREE.BoxGeometry(0.06, 0.04, 0.42);
const _KNIFE_TRAIL_GEOM = new THREE.CylinderGeometry(0.025, 0.005, 1.0, 6, 1, true);
const _KNIFE_HIT_RADIUS = 0.45;     // player contact radius
const _KNIFE_SPEED      = 11;       // m/s
const _KNIFE_DAMAGE     = 14;
const _KNIFE_LIFE       = 1.6;
function spawnAssassinKnives(originX, originY, originZ, dirX, dirZ, count, owner) {
  // Fan-out angles: ±15° per side from the central aim, spaced evenly.
  const fanArc = (count - 1) * 0.13;     // ~7.5° per knife step
  const baseAng = Math.atan2(dirX, dirZ);
  for (let i = 0; i < count; i++) {
    const t = (count > 1) ? (i / (count - 1) - 0.5) : 0;
    const a = baseAng + t * fanArc;
    const vx = Math.sin(a) * _KNIFE_SPEED;
    const vz = Math.cos(a) * _KNIFE_SPEED;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2030,
    });
    const mesh = new THREE.Mesh(_KNIFE_GEOM, mat);
    mesh.position.set(originX, originY, originZ);
    mesh.rotation.y = a;
    mesh.userData.zone   = 'knife';
    mesh.userData.knife  = true;
    scene.add(mesh);
    // Per-knife trail — narrow stretched cylinder behind the body,
    // additive red so bloom carries the streak. scale.y maps to
    // travel-distance so the streak is short on first frame and
    // grows.
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xff2030, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const trail = new THREE.Mesh(_KNIFE_TRAIL_GEOM, trailMat);
    trail.rotation.z = Math.PI / 2;       // lay it horizontal
    trail.rotation.y = a + Math.PI / 2;
    trail.scale.set(1, 0.01, 1);          // start collapsed; grows in tick
    scene.add(trail);
    const knife = {
      mesh, trail, trailMat, mat,
      x: originX, y: originY, z: originZ,
      startX: originX, startZ: originZ,
      vx, vz, t: 0, dead: false, owner,
    };
    mesh.userData.owner = knife;
    _ASSASSIN_KNIVES.push(knife);
  }
}
function _tickAssassinKnives(dt) {
  for (let i = _ASSASSIN_KNIVES.length - 1; i >= 0; i--) {
    const k = _ASSASSIN_KNIVES[i];
    if (k.dead) {
      _disposeAssassinKnife(k);
      _ASSASSIN_KNIVES.splice(i, 1);
      continue;
    }
    k.t += dt;
    if (k.t >= _KNIFE_LIFE) { k.dead = true; continue; }
    k.x += k.vx * dt;
    k.z += k.vz * dt;
    k.mesh.position.x = k.x;
    k.mesh.position.z = k.z;
    // Trail follows the knife's tail. Scaled to travel distance,
    // capped at 1.4m so it doesn't smear across the map.
    const tdx = k.x - k.startX, tdz = k.z - k.startZ;
    const tlen = Math.min(1.4, Math.hypot(tdx, tdz));
    if (k.trail) {
      const a = Math.atan2(k.vx, k.vz);
      k.trail.position.set(
        k.x - Math.sin(a) * tlen * 0.5,
        k.y,
        k.z - Math.cos(a) * tlen * 0.5,
      );
      k.trail.rotation.y = a + Math.PI / 2;
      k.trail.scale.y = tlen;
    }
    // Wall collision — same drone-style filter (only walls, not props).
    if (level._collidesAt && level._collidesAt(k.x, k.z, 0.1)) {
      k.dead = true; continue;
    }
    // Player hit.
    if (player && player.mesh) {
      const dx = player.mesh.position.x - k.x;
      const dz = player.mesh.position.z - k.z;
      if (dx * dx + dz * dz < _KNIFE_HIT_RADIUS * _KNIFE_HIT_RADIUS) {
        damagePlayer(_KNIFE_DAMAGE, 'knife', { source: k.owner });
        k.dead = true; continue;
      }
    }
  }
}
function _disposeAssassinKnife(k) {
  if (k.mesh && k.mesh.parent) k.mesh.parent.remove(k.mesh);
  if (k.mat && k.mat.dispose) k.mat.dispose();
  if (k.trail && k.trail.parent) k.trail.parent.remove(k.trail);
  if (k.trailMat && k.trailMat.dispose) k.trailMat.dispose();
}
// Player-shot a knife mid-flight — handled in fireOneShot's
// hittables branch via knife.userData.knife flag.
function destroyAssassinKnife(knife) {
  if (!knife) return;
  knife.dead = true;
}
function _allAssassinKnifeMeshes() {
  const out = [];
  for (const k of _ASSASSIN_KNIVES) if (!k.dead) out.push(k.mesh);
  return out;
}

function spawnerTeleportAndSummon(boss) {
  if (!boss || !boss.alive) return;
  const room = level.rooms?.find(r => r.id === boss.roomId);
  if (!room) return;
  // Necromancer no longer teleports — it summons in place. Teleport
  // moved to the melee boss instead (see meleeBossTeleport).
  const tx = boss.group.position.x;
  const tz = boss.group.position.z;
  // Spawn count ramps with run depth. The necromancer is gated to
  // appear only after level 5 (see level.js), so this formula starts
  // at 2 on its first appearance and tops out at 6 around level 13.
  const lvIdx = (level && level.index) || 1;
  const baseCount = Math.max(2, Math.min(6, 2 + Math.floor((lvIdx - 6) / 2)));
  // Random jitter ±0/+1 so cadence varies but never drops below the
  // floor or above the cap.
  const addCount = Math.min(6, baseCount + (Math.random() < 0.4 ? 1 : 0));
  for (let i = 0; i < addCount; i++) {
    // Pick an open spot near the boss that ALSO has a clear walkable
    // segment to the player. Without this last check minions
    // sometimes spawn behind a couch / column and just stand there.
    let spawnX = null, spawnZ = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = (i / addCount) * Math.PI * 2 + Math.random() * 0.9;
      const r = 1.2 + Math.random() * 0.6;
      const ax = tx + Math.cos(a) * r;
      const az = tz + Math.sin(a) * r;
      if (level._collidesAt && level._collidesAt(ax, az, 0.5)) continue;
      if (level._segmentClear && !level._segmentClear(ax, az,
            player.mesh.position.x, player.mesh.position.z, 0.5)) continue;
      spawnX = ax; spawnZ = az; break;
    }
    if (spawnX === null) continue;   // skip this minion rather than spawn it stuck
    const minion = melees.spawn(spawnX, spawnZ, {
      tier: 'normal',
      roomId: boss.roomId,
      hpMult: 0.5, damageMult: 0.7,
      reactionMult: 1.0, aimSpreadMult: 1.0,
      aggression: 1.2, gearLevel: 0,
    });
    if (minion) {
      // Necromant adds: zero loot, zero XP, zero credits, and they
      // despawn shortly after dying so the floor doesn't pile up.
      minion.summoned = true;
      minion.noDrops = true;
      minion.noXp = true;
    }
  }
  if (sfx.uiAccept) sfx.uiAccept();
  triggerShake(0.18, 0.18);
}

// Drone summoner — the boss's archetype tick calls this to spawn
// 2-3 suicide drones at its position. Drones float at chest height
// and track the player at medium speed; player can shoot them
// down for 24 HP each, or take a 22-damage AoE blast on contact.
// See src/drones.js for the per-drone simulation.
function spawnDronesAt(x, z) {
  const count = 2 + Math.floor(Math.random() * 2);   // 2-3 per summon
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const r = 0.8;
    drones.spawn(x + Math.cos(a) * r, 1.4, z + Math.sin(a) * r);
  }
  if (sfx.uiAccept) sfx.uiAccept();
}

// AI throwable spawn — boss / sub-boss tier only, kicked off from
// gunman.update when isPlayerCamping returns true and the per-enemy
// throwable cooldown has elapsed. Picks a random throwable kind from
// the boss pool, ballistically arcs it onto the player's last known
// position. Uses the same projectile system the player throws into.
const AI_THROWABLE_POOL = [
  { kind: 'frag',  fuse: 1.6, aoeRadius: 5.0, aoeDamage: 60, color: 0x60a040 },
  // Flash + stun bumped 25% on both range and effect duration. Frag
  // stays the same — that one's already painful at the current
  // damage. Gas added as a new option.
  { kind: 'flash', fuse: 1.0, aoeRadius: 5.6, blindDuration: 3.75, color: 0xfff0a0 },
  { kind: 'stun',  fuse: 1.2, aoeRadius: 4.75, stunDuration: 2.75, color: 0x80a0ff },
  // Gas grenade — impact-detonate (fuse 0.4 just covers the toss
  // arc), seeds a green poison cloud that lingers ~6s and ticks
  // both player and enemies inside it.
  { kind: 'gas',   fuse: 0.4, aoeRadius: 4.0, color: 0x60d040,
    gasDuration: 6.0, fuseAfterLand: false, bounciness: 0.05 },
];
function spawnAiThrowable(g, kindOverride) {
  if (!g || !g.alive || !player) return;
  const muzzleFrom = (g.rig && g.rig.head)
    ? g.rig.head.getWorldPosition(new THREE.Vector3())
    : new THREE.Vector3(g.group.position.x, 1.6, g.group.position.z);
  const aim = new THREE.Vector3(player.mesh.position.x, 0, player.mesh.position.z);
  const gravity = 9.8;
  const dx = aim.x - muzzleFrom.x, dz = aim.z - muzzleFrom.z;
  const throwDist = Math.hypot(dx, dz);
  const apex = 0.8 + Math.min(2.4, throwDist / 8);
  const vel = ProjectileManager.ballisticVelocityApex(muzzleFrom, aim, apex, gravity);
  const def = kindOverride
    ? AI_THROWABLE_POOL.find(d => d.kind === kindOverride) || AI_THROWABLE_POOL[0]
    : AI_THROWABLE_POOL[Math.floor(Math.random() * AI_THROWABLE_POOL.length)];
  projectiles.spawn({
    pos: muzzleFrom,
    vel,
    type: 'grenade',
    lifetime: def.fuse,
    radius: 0.07,
    color: def.color,
    explosion: {
      radius: def.aoeRadius,
      damage: def.aoeDamage || 0,
      shake: 0.35,
    },
    owner: 'enemy',
    gravity,
    // Enemy grenades were inheriting the player-throw bounciness
    // (0.40), which let them skip past the player on a bad bounce
    // and detonate well past the target. Tightened to 0.15 so they
    // still bounce + roll a little but don't ricochet across the
    // room. Gas keeps its lower per-def 0.05 (impact-detonate).
    bounciness: def.bounciness ?? 0.15,
    fuseAfterLand: def.fuseAfterLand ?? true,
    throwKind: def.kind,
    blindDuration: def.blindDuration,
    stunDuration: def.stunDuration,
    gasDuration: def.gasDuration,
  });
}

// --- Player-side flash + stun state --------------------------------
// Set when an enemy throws a flashbang / stun grenade and the blast
// catches the player. Tick consumed in renderHud / camera path.
let playerFlashT = 0;
let playerStunT = 0;
// Mitigate an enemy throwable's effect on the player based on distance
// to the blast (further = less effect) and, optionally, where the
// player is looking (squinted away from a flash takes far less than
// staring straight at it). Returns the scaled duration in seconds.
//   distMul  — 1.0 at ground zero, 0.25 at the blast edge.
//   faceMul  — 1.0 facing the blast, 0.4 looking away (only applied
//              when facingMatters === true; stun ignores facing
//              because it's concussive, not a light pulse).
function _scalePlayerThrowableEffect(baseDur, blastPos, radius, facingMatters) {
  const px = player.mesh.position.x;
  const pz = player.mesh.position.z;
  const dx = px - blastPos.x;
  const dz = pz - blastPos.z;
  const dist = Math.hypot(dx, dz);
  const distNorm = radius > 0 ? Math.min(1, dist / radius) : 1;
  const distMul = 1 - 0.75 * distNorm;
  let faceMul = 1;
  if (facingMatters && lastAim) {
    const fx = lastAim.x - px;
    const fz = lastAim.z - pz;
    const fl = Math.hypot(fx, fz);
    if (fl > 0.001 && dist > 0.001) {
      // Direction from player toward the blast.
      const tx = -dx / dist;
      const tz = -dz / dist;
      const dot = (fx / fl) * tx + (fz / fl) * tz;   // -1 facing away, +1 facing toward
      faceMul = 0.4 + 0.6 * Math.max(0, dot);        // 0.4 .. 1.0
    }
  }
  return baseDur * distMul * faceMul;
}
// ADS camera-peek snapshot — captured at the rising edge of ADS so
// ADS press-snapshot scaffolding removed — scene.js's updateCamera
// now handles press detection itself (rising edge of adsEased) and
// the cursor-NDC delta drives the offset accumulation. main.js just
// passes through `aim` (cursor world) and `cursorNDC`.
const _flashOverlayEl = (() => {
  const el = document.createElement('div');
  el.id = 'flash-overlay';
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: 49,
    background: '#ffffff', opacity: '0', pointerEvents: 'none',
    transition: 'opacity 0.05s linear',
  });
  document.body.appendChild(el);
  return el;
})();

function spawnFireZone(pos, radius, duration, dps) {
  // No ground decal — the zone is visualised purely by continuous
  // upward-rising flame orbs spawned from `_tickFireZones`. Reads as
  // a flamethrower-style emission from the floor instead of an
  // orange disc telegraph. DoT footprint is the orb cluster itself.
  _fireZones.push({
    x: pos.x, z: pos.z, radius, life: duration, t: 0,
    dps,
    emitT: 0,            // cooldown between orb bursts
  });
}
function _tickFireZones(dt) {
  for (let i = _fireZones.length - 1; i >= 0; i--) {
    const z = _fireZones[i];
    z.t += dt;
    // Continuous flame emission across the disc — denser bursts than
    // before so the zone reads as a sustained flamethrower-style
    // sheet of flame from the ground rather than scattered embers.
    // Cap total active orbs to keep the late-game / multi-zone case
    // from runaway-spawning into a frame stall.
    z.emitT -= dt;
    if (z.emitT <= 0 && _fireOrbs.length < 260) {
      // Sustain emits keep the flame alive while the zone burns. Tongue
      // count tapers near the end of the zone life so the patch dies
      // out instead of disappearing in one frame. spawnFireOrbBurst
      // produces ~45% tongues / 55% embers; keep this dense enough to
      // feel like a wall of flame.
      const lifeLeft = Math.max(0, 1 - z.t / z.life);
      const emitCount = Math.max(0, Math.round(10 * lifeLeft));
      if (emitCount > 0) {
        spawnFireOrbBurst({ x: z.x, z: z.z }, z.radius, emitCount);
      }
      z.emitT = 0.06 + Math.random() * 0.05;
    }
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
    // Player burn — same disc test, routed through damagePlayer so
    // fire-resist + cumulative fire stacking + recap entry all apply.
    // Coop: dps=0 mirrors (fx-throwable visual or joiner's local
    // neutered mirror) skip damage; host's auth zone routes joiner
    // damage via the ghost scan below.
    if (player && z.dps > 0) {
      const pdx = player.mesh.position.x - z.x;
      const pdz = player.mesh.position.z - z.z;
      if (pdx * pdx + pdz * pdz < rSq) {
        const tickDmg = z.dps * dt;
        damagePlayer(tickDmg, 'fire', { source: 'fireZone' });
        window.__playerBurnT = Math.max(window.__playerBurnT || 0, 1.0);
      }
    }
    // Coop: host-side ghost scan for fire-zone DoT. Same throttle as
    // the megaboss fire pool helper. Skipped when dps=0 (visual mirror).
    if (z.dps > 0 && coopLobby) {
      const tHost = getCoopTransport();
      if (tHost.isOpen && tHost.isHost && coopLobby.ghosts.size > 0) {
        if (!z._coopLastTick) z._coopLastTick = Object.create(null);
        for (const [peerId, ghost] of coopLobby.ghosts) {
          if (ghost.dead) continue;
          const dx = ghost.x - z.x;
          const dz = ghost.z - z.z;
          if (dx * dx + dz * dz > rSq) continue;
          const ll = z._coopLastTick[peerId] || 0;
          if ((z.t - ll) > 0.33) {
            z._coopLastTick[peerId] = z.t;
            _coopSendPlayerDamage(peerId, z.dps * 0.33, 'fire', { zone: 'torso' });
          }
        }
      }
    }
    if (z.t >= z.life) _fireZones.splice(i, 1);
  }
}

// Per-actor burn flames — small flame particles spawn around any
// burning actor (enemy or player) so the burn DoT has a visible
// signal beyond just the damage numbers. Reuses the _fireOrbs pool
// so one tick + one cleanup path covers all flame VFX.
//
// Each emit appends 1-2 small flame orbs at random offsets around
// the actor's torso, which then rise + fade like normal fire orbs.
// Spawn rate is throttled per actor via `_burnEmitT` and globally
// gated by the same _fireOrbs cap as the fire-zone path.
function _spawnActorBurnFlames(actor) {
  if (_fireOrbs.length >= 240) return;
  const pos = actor.group ? actor.group.position : actor.mesh?.position;
  if (!pos) return;
  // Two small puffs offset around the torso. Cheap geometry +
  // additive blending — same look as flamethrower orbs but smaller
  // and shorter-lived so they read as "the actor is on fire".
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.28 + Math.random() * 0.18;
    const x = pos.x + Math.cos(a) * r;
    const z = pos.z + Math.sin(a) * r;
    const sz = 0.05 + Math.random() * 0.05;
    const color = Math.random() < 0.5 ? 0xff8030 : 0xffc060;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(sz, 4, 3),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.set(x, 0.5 + Math.random() * 0.6, z);
    scene.add(mesh);
    _fireOrbs.push({
      mesh,
      vy: 0.6 + Math.random() * 0.6,
      drift: { x: (Math.random() - 0.5) * 0.15, z: (Math.random() - 0.5) * 0.15 },
      life: 0.45 + Math.random() * 0.25,
      t: 0,
    });
  }
}

// Sweep all burning enemies + the player each tick, emit flame
// puffs while burnT > 0. Throttled per-actor so even a fully-on-
// fire room stays under the orb cap.
function _tickBurnFlames(dt) {
  const emit = (c, slot) => {
    if (!c || (c.burnT || 0) <= 0) return;
    if (c.alive === false) return;
    c[slot] = (c[slot] || 0) - dt;
    if (c[slot] <= 0) {
      _spawnActorBurnFlames(c);
      c[slot] = 0.10 + Math.random() * 0.05;
    }
  };
  for (const g of gunmen.gunmen) emit(g, '_burnEmitT');
  for (const e of melees.enemies) emit(e, '_burnEmitT');
  // Player-side burn flames — exposed via window.__playerBurnT
  // (set in damagePlayer when burn applies). Mirrors the actor
  // path so the same particles show.
  if ((window.__playerBurnT || 0) > 0 && player) {
    window.__playerBurnEmitT = (window.__playerBurnEmitT || 0) - dt;
    if (window.__playerBurnEmitT <= 0) {
      _spawnActorBurnFlames(player);
      window.__playerBurnEmitT = 0.10 + Math.random() * 0.05;
    }
    window.__playerBurnT = Math.max(0, window.__playerBurnT - dt);
  }
}

// Use a specific consumable / throwable from anywhere in the player's
// inventory (E hotkey while hovering an item in the inventory grid).
// Mirrors tryUseMedkit's stack-aware decrement: if the item is a
// stack of N > 1, peel one off and apply; otherwise remove the item
// from its backpack slot. Throwables stay (applyConsumable spends a
// charge + starts cooldown). Returns true if the item was usable.
function useInventoryItem(item) {
  if (!item) return false;
  if (item.type === 'throwable') {
    applyConsumable(item);
    inventoryUI.render();
    renderActionBar();
    return true;
  }
  if (item.type !== 'consumable') return false;
  const stackCount = (item.count | 0) || 1;
  if (stackCount > 1) {
    item.count = stackCount - 1;
    inventory._bump?.();
    applyConsumable({ ...item, count: 1 });
  } else {
    // Walk the inventory grids and remove the matching item. The
    // flat `backpack` view covers pockets / rig / backpack so a
    // single indexOf finds it regardless of which container holds it.
    const idx = inventory.backpack.indexOf(item);
    if (idx < 0) return false;
    const taken = inventory.takeFromBackpack(idx);
    if (taken) applyConsumable(taken);
  }
  inventoryUI.render();
  renderActionBar();
  return true;
}
// Exposed for ui_inventory.js E-key hotkey — bound there so the
// keydown listener can stay scoped to "inventory open" without main
// having to know about the hover state.
window.__useInventoryItem = useInventoryItem;

function tryUseMedkit() {
  const found = inventory.findFirstConsumable(it => it.useEffect?.kind === 'heal');
  if (!found) return;
  // Stack-aware consume — decrement count if there's more than one
  // in the stack, otherwise pull the item out entirely. Without
  // this, pressing H on a 5-bandage stack would consume the whole
  // stack at once.
  const stack = found.item;
  const stackCount = (stack.count | 0) || 1;
  if (stackCount > 1) {
    stack.count = stackCount - 1;
    inventory._bump?.();
    applyConsumable({ ...stack, count: 1 });
  } else {
    const it = inventory.takeFromBackpack(found.idx);
    if (it) applyConsumable(it);
  }
  inventoryUI.render();
}

function useActionSlot(idx) {
  const item = inventory.actionSlotItem(idx);
  if (!item) return;
  if (item.type === 'ranged' || item.type === 'melee') {
    // Weapons in a quickslot act as a swap-to shortcut. If the bound
    // weapon is currently in the active rotation (weapon1/2/melee),
    // jump straight to it; otherwise nothing to swap to.
    const rot = inventory.getWeaponRotation();
    const rotIdx = rot.indexOf(item);
    if (rotIdx >= 0) {
      setWeaponIndex(rotIdx);
      renderActionBar();
      renderWeaponBar();
    }
    return;
  }
  if (item.type === 'throwable') {
    // Throwables stay bound — applyConsumable spends a charge + starts
    // cooldown, but never removes the item from the inventory.
    applyConsumable(item);
    inventoryUI.render();
    renderActionBar();
    renderWeaponBar();
    if (tutorialMode) tutorialUI.markStep('throwable');
    return;
  }
  // Everything else (heal / buff consumables) is single-use: pull
  // it out and apply.
  const taken = inventory.consumeActionSlot(idx);
  if (taken) {
    applyConsumable(taken);
    inventoryUI.render();
    renderActionBar();
    renderWeaponBar();
  }
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
  if (anyActive) {
    renderActionBar();
    renderWeaponBar();
  }
}

// Items that can live in a quickslot — consumables / throwables for
// single-press use, weapons for press-to-swap. Pure gear stays out so
// the hotbar isn't a second equipment menu.
function isQuickslotEligible(item) {
  if (!item) return false;
  const t = item.type;
  return t === 'consumable' || t === 'throwable' || t === 'ranged' || t === 'melee';
}
window.__isQuickslotEligible = isQuickslotEligible;

// Action-bar DOM rendering + drag-drop + click handlers.
// Weapon-bar HUD (keys 1-4). Mirrors the rotation order: weapon1, weapon2,
// melee, and an empty 4th slot reserved for future loadout expansion.
function renderWeaponBar() {
  const bar = document.getElementById('weapon-bar');
  if (!bar) return;
  const rotation = inventory.getWeaponRotation();
  const slots = bar.querySelectorAll('.weapon-slot');
  // Akimbo mode highlights BOTH weapon1 (slot 0, LMB) and weapon2
  // (slot 1, RMB) as active so the player can see at a glance which
  // weapon answers each click. The active class drives the existing
  // CSS glow + border treatment; both glow simultaneously.
  const akimbo = _isAkimbo();
  slots.forEach((el, i) => {
    // Weapon-bar is now the lower 4 slots (0-3) of the unified hotbar.
    // If the player has bound an item to this slot via drag-to-bind,
    // render it through the shared hotbar-slot helper. Otherwise fall
    // back to the auto-display of whatever weapon sits at rotation[i]
    // so equipped weapons still appear in slots 1-3 by default.
    el.classList.remove('drop-ok');
    const bound = inventory.actionSlotItem(i);
    if (bound) {
      el.classList.remove('empty');
      // Active highlight only meaningful when the bound item IS the
      // currently-active weapon in the rotation. Akimbo also lights
      // up slot 0 + slot 1 if the bound item matches one of those.
      const rotIdx = rotation.indexOf(bound);
      const isCurrent = rotIdx >= 0 && rotIdx === currentWeaponIndex;
      const isAkimboHand = akimbo && (rotIdx === 0 || rotIdx === 1);
      el.classList.toggle('active', isCurrent || isAkimboHand);
      _renderHotbarSlot(el, i, String(i + 1));
      return;
    }
    const w = rotation[i] || null;
    const akimboHandLabel = akimbo && i === 0 ? ' L'
                          : akimbo && i === 1 ? ' R'
                          : '';
    const keyLabel = `<span class="action-key">${i + 1}${akimboHandLabel}</span>`;
    const isCurrent = w && i === currentWeaponIndex;
    const isAkimboHand = akimbo && w && (i === 0 || i === 1);
    el.classList.toggle('active', !!(isCurrent || isAkimboHand));
    el.classList.toggle('empty', !w);
    el.classList.remove('filled');
    if (!w) {
      el.innerHTML = `${keyLabel}<span class="weapon-label">—</span>`;
      return;
    }
    const icon = thumbnailFor(w);
    const label = w.class || w.type || '';
    el.innerHTML = `${keyLabel}${icon ? `<img src="${icon}" alt="">` : ''}<span class="weapon-label">${label}</span>`;
  });
}

// Render an actionBar slot into a HUD slot element. `barIdx` is the
// 0..7 index into `inventory.actionBar`; `keyLabelText` is what the
// player sees in the corner ("1".."8"). Shared by both renderWeaponBar
// (slots 0-3, keys 1-4) and renderActionBar (slots 4-7, keys 5-8) so
// the two clusters render identically when an item is bound.
function _renderHotbarSlot(el, barIdx, keyLabelText) {
  const item = inventory.actionSlotItem(barIdx);
  const keyLabel = `<span class="action-key">${keyLabelText}</span>`;
  if (!item) {
    el.innerHTML = keyLabel;
    el.classList.remove('filled');
    el.classList.remove('empty-charges');
    return false;
  }
  const icon = thumbnailFor(item);
  const tint = item.tint ?? 0xaaaaaa;
  const tintStr = `#${tint.toString(16).padStart(6, '0')}`;
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
  // Stack count badge — top-right corner when a consumable stacks
  // multiple in one inventory cell. Players need to see at a glance
  // how many bandages they have left in the bound stack.
  let stackBadge = '';
  if (item.type === 'consumable' && ((item.count | 0) || 1) > 1) {
    stackBadge = `<span class="action-stack">×${item.count | 0}</span>`;
  }
  el.innerHTML = `${keyLabel}${icon ? `<img src="${icon}" alt="">` : ''}${extra}${cooldownOverlay}${stackBadge}`;
  el.classList.add('filled');
  el.classList.toggle('empty-charges',
    item.type === 'throwable' && (item.charges | 0) <= 0);
  return true;
}

function renderActionBar() {
  const slots = document.querySelectorAll('.action-slot');
  // All 4 slots are always usable now — display them unconditionally.
  slots.forEach((el, i) => {
    el.style.display = '';
    _renderHotbarSlot(el, i + 4, String(i + 5));
  });
}

// Wire identical drag-drop / click handlers to every hotbar slot
// element. `selector` picks the cluster (.weapon-slot or .action-slot);
// `slotOffset` is the actionBar index of the cluster's first slot
// (0 for weapon-bar, 4 for action-bar). The tail callback re-renders
// the appropriate cluster after a state change.
function _wireHotbarCluster(selector, slotOffset, rerender) {
  const slots = document.querySelectorAll(selector);
  slots.forEach((el, i) => {
    const barIdx = slotOffset + i;
    el.addEventListener('click', () => {
      // Empty weapon-bar slots (0-3) fall back to "switch to the
      // weapon at rotation[i]" so a freshly-equipped weapon still
      // works on click without the player needing to manually bind.
      if (slotOffset === 0 && !inventory.actionSlotItem(barIdx)) {
        const rot = inventory.getWeaponRotation();
        if (rot[barIdx]) setWeaponIndex(barIdx);
        return;
      }
      useActionSlot(barIdx);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      let item = inventory.actionSlotItem(barIdx);
      if (!item && slotOffset === 0) {
        const rot = inventory.getWeaponRotation();
        item = rot[barIdx] || null;
      }
      if (item && window.__showDetails) window.__showDetails(item);
    });
    el.addEventListener('dragstart', (e) => {
      const item = inventory.actionSlotItem(barIdx);
      if (!item) { e.preventDefault(); return; }
      setDragState({ from: 'actionBar', slot: barIdx, item });
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
      if (d.item && isQuickslotEligible(d.item)) {
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
        inventory.swapActionSlots(d.slot, barIdx);
      } else if (d.item && isQuickslotEligible(d.item)) {
        inventory.assignActionSlot(barIdx, d.item);
      } else {
        return;
      }
      setDragState(null);
      renderWeaponBar();
      renderActionBar();
    });
    el.setAttribute('draggable', 'true');
  });
  rerender?.();
}

_wireHotbarCluster('.weapon-slot', 0, renderWeaponBar);
_wireHotbarCluster('.action-slot', 4, renderActionBar);
// Exposed so the inventory UI's custom pointer-drag can refresh the
// HUD after dropping an item into an action slot.
window.__renderActionBar = renderActionBar;
window.__renderWeaponBar = renderWeaponBar;

// Mid-run "pick another contract" chooser. Surfaces 3 random
// contract picks (filtered to ones the player isn't currently
// running) when _pendingContractOfferOnExtract is set. Player picks
// one → it becomes the active contract for the rest of the run.
// Skipping is allowed via the close button. Resolves when the user
// makes a choice or skips.
function _showMidRunContractOffer() {
  return new Promise((resolve) => {
    try {
      const allContracts = Object.values(CONTRACT_DEFS).filter(c => c && c.id);
      // Filter out current contract + already-completed/claimed ones.
      const cur = getActiveContract();
      const curId = cur?.activeContractId || null;
      const pool = allContracts.filter(c => c.id !== curId && c.kind !== 'weekly');
      if (pool.length === 0) { resolve(null); return; }
      // 3 unique picks (or fewer if the pool is small).
      const picks = [];
      const used = new Set();
      while (picks.length < 3 && picks.length < pool.length) {
        const idx = Math.floor(Math.random() * pool.length);
        const def = pool[idx];
        if (used.has(def.id)) continue;
        used.add(def.id);
        picks.push(def);
      }
      const root = document.createElement('div');
      Object.assign(root.style, {
        position: 'fixed', inset: '0', zIndex: '120',
        background: 'rgba(8,12,16,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        font: '13px ui-monospace, Menlo, Consolas, monospace',
      });
      const card = document.createElement('div');
      Object.assign(card.style, {
        background: 'linear-gradient(180deg, #1a2228, #0c1014)',
        border: '1px solid #f2c060', borderRadius: '6px',
        padding: '24px 28px', maxWidth: '560px', width: '90%',
        boxShadow: '0 0 48px rgba(255,200,80,0.35)',
        color: '#f2e7c9',
      });
      const title = document.createElement('div');
      Object.assign(title.style, {
        color: '#f2c060', fontWeight: '700', fontSize: '14px',
        letterSpacing: '3px', textTransform: 'uppercase',
        textAlign: 'center', marginBottom: '6px',
      });
      title.textContent = 'CONTRACT COMPLETE';
      card.appendChild(title);
      const sub = document.createElement('div');
      Object.assign(sub.style, {
        color: '#a89070', fontSize: '11px', textAlign: 'center',
        marginBottom: '18px', letterSpacing: '1.5px',
      });
      sub.textContent = 'Pick another to take on for the rest of the run';
      card.appendChild(sub);
      const close = (chosen) => {
        try { document.body.removeChild(root); } catch (_) {}
        resolve(chosen || null);
      };
      for (const def of picks) {
        const btn = document.createElement('button');
        Object.assign(btn.style, {
          display: 'block', width: '100%', textAlign: 'left',
          padding: '12px 14px', marginBottom: '8px',
          background: 'rgba(40,30,16,0.55)',
          border: '1px solid #6a4a2a', borderRadius: '4px',
          color: '#f2e7c9', font: 'inherit', cursor: 'pointer',
        });
        btn.onmouseenter = () => { btn.style.background = 'rgba(80,60,30,0.75)'; btn.style.borderColor = '#f2c060'; };
        btn.onmouseleave = () => { btn.style.background = 'rgba(40,30,16,0.55)'; btn.style.borderColor = '#6a4a2a'; };
        const name = document.createElement('div');
        Object.assign(name.style, { fontWeight: '700', fontSize: '13px', color: '#ffd070' });
        name.textContent = def.title || def.id;
        const desc = document.createElement('div');
        Object.assign(desc.style, { fontSize: '11px', color: '#b8a890', marginTop: '4px', lineHeight: '1.4' });
        desc.textContent = def.description || '—';
        const reward = document.createElement('div');
        Object.assign(reward.style, { fontSize: '10px', color: '#80c0e0', marginTop: '4px', letterSpacing: '1px', textTransform: 'uppercase' });
        const r = [];
        if (def.chipReward)  r.push(`${def.chipReward} chips`);
        if (def.markReward)  r.push(`${def.markReward} marks`);
        if (def.sigilReward) r.push(`${def.sigilReward} sigils`);
        reward.textContent = r.length ? r.join(' · ') : '';
        btn.appendChild(name);
        btn.appendChild(desc);
        if (r.length) btn.appendChild(reward);
        btn.addEventListener('click', () => {
          setActiveContract({
            activeContractId: def.id,
            expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
            progress: {},
            claimedAt: 0,
          });
          _refreshActiveModifiers();
          close(def);
        });
        card.appendChild(btn);
      }
      const skipBtn = document.createElement('button');
      Object.assign(skipBtn.style, {
        display: 'block', width: '100%', marginTop: '6px', padding: '8px',
        background: 'transparent', border: '1px solid #4a3a2a',
        borderRadius: '3px', color: '#a89070', font: 'inherit',
        cursor: 'pointer', letterSpacing: '1.5px', textTransform: 'uppercase',
        fontSize: '11px',
      });
      skipBtn.textContent = 'Skip';
      skipBtn.addEventListener('click', () => close(null));
      card.appendChild(skipBtn);
      root.appendChild(card);
      document.body.appendChild(root);
    } catch (e) {
      console.warn('[contract-offer] failed', e);
      resolve(null);
    }
  });
}

async function advanceFloor() {
  paused = true;
  input.clearMouseState();
  inventoryUI.hide();
  exitCooldown = 1.0;
  // Stamp the run as having seen at least one extract — contract
  // evaluation reads this on death too (a player can die later in the
  // run and still satisfy "extract from floor X" if they extracted
  // earlier). peakLevel is monotonic via runStats.setLevel.
  runStats.noteExtracted();
  // Note: contract claim used to live here. Moved to
  // _applyContractPerKillReward — contracts now complete the
  // moment the kill counter hits targetCount, not on floor
  // transition. Run thesis stays "go as far as you can or die
  // trying"; the floor-transition function is just per-floor
  // bookkeeping (skill pick + level regen).
  // Starter buff decay — speed / reload buffs tick down per floor.
  _tickStarterBuffsOnLevelChange();
  // Locked-trial unlock prompt — fire on extract too, not just death.
  // The prompt is non-blocking (overlays the skill picker) so the
  // existing extract flow continues uninterrupted.
  _maybeShowLockedTrialPrompt();
  // Spicy Arena trigger — wearing Shini's Burden through the level
  // exit queues the boss arena as next floor's encounter. The
  // encounter is oncePerSave so the lifetime-completed set blocks
  // re-rolls automatically; queueEncounterFollowup is idempotent
  // for the per-floor slot, so re-extracting with the headband on
  // is harmless.
  try {
    const head = inventory.equipment.head;
    if (head && head.id === 'gear_shinis_burden') {
      queueEncounterFollowup('spicy_arena', 1);
    }
  } catch (_) { /* prefs / inventory unavailable */ }
  await skillPickUI.show();
  input.clearMouseState();
  // Mid-run contract chain — if a contract was claimed since the last
  // extract, offer 3 fresh picks before regen. Resolves with the
  // chosen def (or null on skip); _refreshActiveModifiers fires
  // inside the modal so the new contract's modifiers apply on the
  // next floor.
  if (_pendingContractOfferOnExtract) {
    _pendingContractOfferOnExtract = false;
    try { await _showMidRunContractOffer(); } catch (_) {}
    input.clearMouseState();
  }
  paused = false;
  recomputeStats();
  regenerateLevel();
}

// Locked-trial unlock prompt — shared between death + extract. Walks
// the player's full inventory for any `lockedTrial: true` weapon
// they picked up during the run; if found, surfaces a one-shot
// "Unlock for chips?" prompt. Discovery → desire → purchase loop —
// the player gets to feel the locked weapon, then chooses whether
// to spend chips to keep it forever.
function _maybeShowLockedTrialPrompt() {
  try {
    if (document.getElementById('death-unlock-prompt')) return;
    const surfaces = [
      inventory.equipment.weapon1, inventory.equipment.weapon2, inventory.equipment.melee,
      ...((inventory.pocketsGrid?.items?.()) || []),
      ...((inventory.rigGrid?.items?.()) || []),
      ...((inventory.backpackGrid?.items?.()) || []),
    ];
    // Per-run dedupe — once the player has been prompted for a given
    // locked weapon and chose Skip (or bought it), don't surface the
    // same item again on every subsequent floor extract. Keyed by
    // weapon name; cleared in _resetEncounterCompletionForRun.
    if (!_trialPromptedThisRun) _trialPromptedThisRun = new Set();
    const trial = surfaces.find(it =>
      it && it.lockedTrial
        && !isWeaponUnlocked(it.name)
        && !_trialPromptedThisRun.has(it.name));
    if (!trial) return;
    _trialPromptedThisRun.add(trial.name);
    const cost = ({ common: 150, uncommon: 350, rare: 800, epic: 2000, legendary: 5000, mythic: 12000 })[trial.rarity || 'common'] || 150;
    const prompt = document.createElement('div');
    prompt.id = 'death-unlock-prompt';
    Object.assign(prompt.style, {
      position: 'fixed', top: '50%', left: '50%',
      transform: 'translate(-50%, calc(-50% + 180px))', zIndex: '100',
      background: 'linear-gradient(180deg, #1a1d24, #0c0e14)',
      border: '1px solid #5a8acf', borderRadius: '4px',
      padding: '16px 22px', minWidth: '320px', textAlign: 'center',
      color: '#e8dfc8', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    });
    prompt.innerHTML = `
      <div style="font-size:11px; letter-spacing:1.4px; color:#9b8b6a; margin-bottom:6px;">FIELD TRIAL</div>
      <div style="font-size:14px; color:#f2c060; margin-bottom:4px;">${trial.name}</div>
      <div style="font-size:11px; color:#c9a87a; margin-bottom:12px;">Unlock permanently? Adds it to your stash and the world drop pool.</div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button id="dup-buy" type="button" style="background:linear-gradient(180deg,#2a4a6e,#1e3450);border:1px solid #5a8acf;color:#e8dfc8;padding:6px 14px;border-radius:3px;font:inherit;font-size:11px;letter-spacing:1px;cursor:pointer;text-transform:uppercase;">Unlock — ${cost}c</button>
        <button id="dup-skip" type="button" style="background:#1a1d24;border:1px solid #4a505a;color:#9b8b6a;padding:6px 14px;border-radius:3px;font:inherit;font-size:11px;letter-spacing:1px;cursor:pointer;text-transform:uppercase;">Skip</button>
      </div>
    `;
    document.body.appendChild(prompt);
    prompt.querySelector('#dup-buy').addEventListener('click', () => {
      if (persistentChips < cost) {
        transientHudMsg(`Need ${cost}c — you have ${persistentChips}c`);
        return;
      }
      persistentChips -= cost;
      savePersistentChips();
      unlockWeapon(trial.name);
      transientHudMsg(`UNLOCKED: ${String(trial.name).toUpperCase()}`, 2.5);
      sfx.uiAccept?.();
      prompt.remove();
    });
    prompt.querySelector('#dup-skip').addEventListener('click', () => prompt.remove());
  } catch (e) { console.warn('[locked-trial-prompt]', e); }
}

// Firing a gun is noisy: any alive enemy within noiseRange of the muzzle
// AND in an audible room (same room, or adjacent through an open door)
// transitions from idle → alerted (or → chase for melee). Suppressors
// from attachments shorten the radius.
function alertEnemiesFromShot(origin) {
  const weapon = currentWeapon();
  const eff = weapon ? effectiveWeapon(weapon) : null;
  // noiseRangeMult is multiplied across all equipped attachments;
  // suppressors can stack with anything that adds it (none today,
  // but the path is open). Flamethrower-style overrides still win:
  // weapon.noiseRange forces a flat radius before the multiplier.
  const baseNoise = weapon?.noiseRange ?? 22;
  const mult = eff?.noiseRangeMult ?? 1.0;
  const noiseRange = baseNoise * mult;
  const suppressed = !!eff?.suppressed;
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
    // Hidden ambush bosses + minions stay completely deaf until the
    // player crosses the threshold and revealHiddenAmbush flips them.
    if (e.hidden) return;
    // Deep-sleep (whisper dart) — neither sound nor witness wakes
    // them. Dart wears off via the per-tick timer in gunman/melee.
    if (e.deepSleepT && e.deepSleepT > 0) return;
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
    if (!g.alive || g === alerted || g.roomId !== rid || g.hidden) continue;
    if (g.deepSleepT && g.deepSleepT > 0) continue;
    if (g.state === 'idle') {
      g.state = 'alerted';
      g.reactionT = tunables.ai.reactionTime;
    }
  }
  for (const m of melees.enemies) {
    if (!m.alive || m === alerted || m.roomId !== rid || m.hidden) continue;
    if (m.deepSleepT && m.deepSleepT > 0) continue;
    if (m.state === 'idle') m.state = 'chase';
  }
}

function onRoomFirstEntered(room) {
  // Boss-arena lock-in: walking into a live boss room slams every
  // connected door shut — BUT only if the boss is actually inside the
  // room. If the boss has already wandered out chasing the player,
  // the seal is skipped (otherwise we lock the player in with a boss
  // stranded in the corridor). The seal also auto-releases the moment
  // the boss leaves the room — see `updateBossSealRelease`.
  if (room.type === 'boss') {
    tryBossEntrySeal(room);
    if (room._ambushHidden) revealHiddenAmbush(room);
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

// True if every boss tagged to `room` is physically inside its bounds.
function _bossInsideBossRoom(room) {
  if (!room || room.type !== 'boss') return false;
  const b = room.bounds;
  let bossExists = false;
  let allInside = true;
  const insideRoom = (c) => {
    const p = c.group.position;
    return p.x >= b.minX && p.x <= b.maxX && p.z >= b.minZ && p.z <= b.maxZ;
  };
  for (const g of gunmen.gunmen) {
    if (!g.alive || g.tier !== 'boss' || g.roomId !== room.id) continue;
    bossExists = true;
    if (!insideRoom(g)) allInside = false;
  }
  for (const m of melees.enemies) {
    if (!m.alive || m.tier !== 'boss' || m.roomId !== room.id) continue;
    bossExists = true;
    if (!insideRoom(m)) allInside = false;
  }
  return bossExists && allInside;
}

// Re-lock doors for the boss room on player first entry — but only if
// the boss hasn't already broken out into the hall.
function tryBossEntrySeal(room) {
  if (!room || room.type !== 'boss' || room._sealed || room._sealReleased) return;
  if (!_bossInsideBossRoom(room)) return;
  level.lockDoorsForRoom(room.id);
  room._sealed = true;
  _ejectPlayerFromSealedDoors(room);
  transientHudMsg('DOORS SEALED — BOSS FIGHT', 2.2);
}

// Watch sealed boss rooms each frame: if the boss leaves its bounds
// (chase, dash through a door, etc.) drop the seal so the player isn't
// trapped inside while the boss is loose. Also drops if the boss dies.
function updateBossSealRelease() {
  for (const r of level.rooms) {
    if (r.type !== 'boss' || !r._sealed || r._sealReleased) continue;
    if (_bossInsideBossRoom(r)) continue;
    level.unlockDoorsForRoom(r.id);
    r._sealReleased = true;
  }
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
    if (px < b.minX - pr || px > b.maxX + pr) continue;
    if (pz < b.minZ - pr || pz > b.maxZ + pr) continue;
    let toRoomX = room.cx - mesh.userData.cx;
    let toRoomZ = room.cz - mesh.userData.cz;
    const l = Math.hypot(toRoomX, toRoomZ) || 1;
    toRoomX /= l; toRoomZ /= l;
    const geo = mesh.geometry?.parameters;
    const halfW = (geo?.width || 1.2) / 2;
    const halfD = (geo?.depth || 1.2) / 2;
    const halfExtent = halfW * Math.abs(toRoomX) + halfD * Math.abs(toRoomZ);
    const push = halfExtent + pr + 0.2;
    player.mesh.position.x = mesh.userData.cx + toRoomX * push;
    player.mesh.position.z = mesh.userData.cz + toRoomZ * push;
    return;
  }
}

// Hidden-boss ambush: at level-gen we may flag a boss room as
// `_ambushHidden`, which makes its bosses + minions invisible /
// undetectable until the player crosses the threshold. On first entry
// we restore visibility, drop them in from above as a "burst entry"
// pose, then aggro the room. Looks like the boss broke through the
// ceiling / wall.
function revealHiddenAmbush(room) {
  room._ambushHidden = false;
  const occupants = [];
  for (const g of gunmen.gunmen) if (g.alive && g.roomId === room.id) occupants.push(g);
  for (const m of melees.enemies) if (m.alive && m.roomId === room.id) occupants.push(m);
  if (occupants.length === 0) return;

  // If an occupant's hidden XZ overlaps a wall (or sits inside an
  // unreachable mini-cell that the layout interior built), nudge them
  // to a safe spot before the drop. We try a ring of probes around
  // the original position; if every probe fails we fall back to the
  // room centre.
  const playerPos = player.mesh.position;
  const findSafeXZ = (origX, origZ, radius = 0.5) => {
    const tryAt = (x, z) => {
      if (level._collidesAt && level._collidesAt(x, z, radius)) return false;
      if (level._segmentClear && !level._segmentClear(x, z, playerPos.x, playerPos.z, 0.5)) return false;
      return true;
    };
    if (tryAt(origX, origZ)) return { x: origX, z: origZ };
    // Spiral-out probes — 16 angles × 5 radii = 80 candidate spots.
    for (let r = 1.2; r <= 6.0; r += 1.2) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const x = origX + Math.cos(ang) * r;
        const z = origZ + Math.sin(ang) * r;
        if (tryAt(x, z)) return { x, z };
      }
    }
    // Last resort — room centre. Caller can confirm walkability.
    const b = room.bounds;
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  };

  for (const c of occupants) {
    if (!c.group) continue;
    const safe = findSafeXZ(c.group.position.x, c.group.position.z);
    c.group.position.x = safe.x;
    c.group.position.z = safe.z;
    c.group.visible = true;
    // Longer drop so the player visibly sees them coming + has a
    // reaction window. Was 0.55s — bumped to 1.4s.
    c.group.position.y = 6.5;
    c._ambushDropT = 1.4;
    c.hidden = false;
    // Re-show instance slots — they were parked at zero-scale by
    // hideOne(). Without this, the actor's group goes visible but
    // the InstancedMesh stays hidden so nothing drops in.
    _setEnemyInstHidden(c, false);
    // Boss + minions can't shoot or swing during the drop OR for a
    // brief recovery window after landing. Gunmen honour `surpriseT`
    // (clamps fire / movement); melees honour `staggerT` (skips
    // windup and AI tick advances). Stamp ~2.2s on bosses (drop +
    // ~0.8s recovery), ~1.6s on minions.
    const isBoss = c.tier === 'boss' || c.majorBoss;
    const dur = isBoss ? 2.2 : 1.6;
    if (gunmen.gunmen.includes(c)) {
      c.surpriseT = Math.max(c.surpriseT || 0, dur);
      c.fireT = Math.max(c.fireT || 0, dur);
      // Hold them in ALERTED until the drop + recovery completes.
      c.state = 'alerted';
      c.reactionT = dur;
    } else {
      c.staggerT = Math.max(c.staggerT || 0, dur);
      c.cooldownT = Math.max(c.cooldownT || 0, dur);
      // Leave them in chase but staggered — staggerT skips the AI
      // tick on the melee side so they can't queue a swing.
      c.state = 'chase';
    }
  }
  triggerShake(0.45, 0.30);
  transientHudMsg('AMBUSH', 1.6);
}

// Per-frame sweep that despawns corpses we don't want to keep around.
// Two cases qualify:
//   1. Summoned minions (necromant adds) — they're combat clutter, no
//      loot, no XP, so leaving the bodies around is pure perf cost.
//   2. Player-looted bodies — once the loot panel emptied them, the
//      player isn't going back. Fade and recycle the geometry.
// Bosses + sub-bosses are exempt — those bodies are trophies. Drones
// already auto-remove on death (see drones.js).
const CORPSE_FADE_DELAY = 4.0;
const CORPSE_FADE_DUR = 1.5;
function tickCorpseDespawn(dt) {
  const sweep = (manager, list) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (c.alive) continue;
      if (c.tier === 'boss' || c.tier === 'subBoss' || c.majorBoss) continue;
      const isEmpty = c.loot && c.loot.length === 0;
      const eligible = c.summoned || c.looted || isEmpty;
      if (!eligible) continue;
      if (c._despawnT === undefined) {
        c._despawnT = CORPSE_FADE_DELAY + CORPSE_FADE_DUR;
        c._despawnTotal = c._despawnT;
      }
      c._despawnT -= dt;
      const fadeStart = CORPSE_FADE_DUR;
      if (c._despawnT < fadeStart && c.group) {
        const k = Math.max(0, c._despawnT / fadeStart);
        c.group.traverse((obj) => {
          if (obj.material) {
            const apply = (m) => {
              if (m._origOpacity === undefined) m._origOpacity = m.opacity ?? 1;
              m.transparent = true;
              m.opacity = m._origOpacity * k;
            };
            if (Array.isArray(obj.material)) obj.material.forEach(apply);
            else apply(obj.material);
          }
        });
      }
      if (c._despawnT <= 0) {
        c.group.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
            else obj.material.dispose();
          }
        });
        if (c.group.parent) c.group.parent.remove(c.group);
        list.splice(i, 1);
      }
    }
  };
  if (gunmen?.gunmen) sweep(gunmen, gunmen.gunmen);
  if (melees?.enemies) sweep(melees, melees.enemies);
}

// Tick the per-actor ambush-drop animation set up by revealHiddenAmbush.
// Each entry has `_ambushDropT` ticking down; we ease its Y back to 0
// over the timer so it lands with a thud rather than snapping in.
function tickAmbushDrops(dt) {
  const fall = (c) => {
    if (!c._ambushDropT) return;
    c._ambushDropT = Math.max(0, c._ambushDropT - dt);
    // Drop runs for 1.4s now; ease the Y back to 0 so the boss
    // visibly falls instead of teleporting to the floor.
    const k = c._ambushDropT / 1.4;
    c.group.position.y = 6.5 * k * k;
    if (c._ambushDropT <= 0) c.group.position.y = 0;
  };
  for (const g of gunmen.gunmen) fall(g);
  for (const m of melees.enemies) fall(m);
}

function updateRoomClearance(playerPos) {
  const here = level.roomAt(playerPos.x, playerPos.z);
  if (here && !here.entered) {
    here.entered = true;
    onRoomFirstEntered(here);
  }
  updateBossSealRelease();
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
      if (r.id === level.bossRoomId) {
        level.revealExit();
        fireHint('exit');
      }
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

// Deferred-pick queue. Both single-player and coop now surface the
// banner + a "ready" HUD pill instead of force-popping the picker
// mid-fight. Player chooses when to spend by clicking the pill (or
// pressing K). Stops the muscle-memory mis-click of locking in a
// skill while LMB-spamming through a wave.
let _pendingLevelUpPicks = 0;
let _pendingMasteryPicks = [];   // queue of mastery offers, FIFO
let _pickQueueHudEl = null;
let _pickPickerOpen = false;

// Shared "banner currently animating" gate. Without this, a
// runLevelUp + runMasteryOffer firing on adjacent frames produced
// overlapping LEVEL UP + CLASS LEVEL UP banners. Tick reads this
// flag to defer the second branch until the first banner finishes.
let _pickBannerShowing = false;
async function runLevelUp() {
  // Banner still pops — the player wants the dopamine hit + a
  // visual cue that the threshold crossed. The PICKER is deferred
  // to a clickable HUD pill so an in-fight level-up doesn't
  // interrupt or steal a panicked click.
  input.clearMouseState();
  _pickBannerShowing = true;
  try { await _showLevelUpBanner(1800); }
  finally { _pickBannerShowing = false; }
  _pendingLevelUpPicks += 1;
  _refreshPickQueueHud();
}

async function runMasteryOffer() {
  const offer = pendingMasteryOffers.shift();
  if (!offer) return;
  input.clearMouseState();
  _pickBannerShowing = true;
  try { await _showClassLevelUpBanner(1800); }
  finally { _pickBannerShowing = false; }
  _pendingMasteryPicks.push(offer);
  _refreshPickQueueHud();
}

// Open the next deferred pick from the queue. Skill-pick takes
// priority since it's most often what the player wants to spend on
// first. Only one picker at a time; we serialize so the player
// closes one before the next surfaces.
async function _openNextDeferredPick() {
  if (_pickPickerOpen) return;
  if (_pendingLevelUpPicks <= 0 && _pendingMasteryPicks.length === 0) return;
  _pickPickerOpen = true;
  // Coop / single-player: in coop the world keeps running (no
  // paused=true); single-player still pauses for back-compat.
  const _coopOnly = (() => {
    const t = getCoopTransport();
    return t && t.isOpen && t.peers && t.peers.size > 0;
  })();
  if (!_coopOnly) paused = true;
  inventoryUI.hide();
  input.clearMouseState();
  try {
    if (_pendingLevelUpPicks > 0) {
      _pendingLevelUpPicks -= 1;
      _refreshPickQueueHud();
      await skillPickUI.show();
    } else if (_pendingMasteryPicks.length > 0) {
      const offer = _pendingMasteryPicks.shift();
      _refreshPickQueueHud();
      await masteryPickUI.show(offer);
    }
  } finally {
    input.clearMouseState();
    if (!_coopOnly) paused = false;
    recomputeStats();
    _pickPickerOpen = false;
    // If there's still queue, keep the HUD pill visible. We don't
    // chain-open automatically — the player picks when ready.
    _refreshPickQueueHud();
  }
}

function _refreshPickQueueHud() {
  if (!_pickQueueHudEl) {
    const el = document.createElement('div');
    el.id = 'pick-queue-hud';
    Object.assign(el.style, {
      position: 'fixed', top: '14px', left: '50%',
      transform: 'translateX(-50%)', zIndex: '7',
      cursor: 'pointer', display: 'none',
      font: '12px ui-monospace, Menlo, Consolas, monospace',
      letterSpacing: '2px', textTransform: 'uppercase',
      padding: '8px 16px',
      background: 'linear-gradient(180deg, #1a2228, #0c1014)',
      border: '1px solid #f2c060', borderRadius: '4px',
      color: '#f2c060',
      boxShadow: '0 0 24px rgba(255,200,80,0.4)',
      animation: 'pick-queue-pulse 2.4s ease-in-out infinite',
    });
    el.addEventListener('click', () => {
      try { _openNextDeferredPick(); } catch (e) { console.warn('[picker]', e); }
    });
    if (!document.getElementById('pick-queue-hud-style')) {
      const s = document.createElement('style');
      s.id = 'pick-queue-hud-style';
      s.textContent = `
        @keyframes pick-queue-pulse {
          0%, 100% { box-shadow: 0 0 24px rgba(255,200,80,0.4); transform: translateX(-50%) scale(1); }
          50%      { box-shadow: 0 0 38px rgba(255,200,80,0.7); transform: translateX(-50%) scale(1.04); }
        }
      `;
      document.head.appendChild(s);
    }
    document.body.appendChild(el);
    _pickQueueHudEl = el;
  }
  const total = _pendingLevelUpPicks + _pendingMasteryPicks.length;
  if (total <= 0) {
    _pickQueueHudEl.style.display = 'none';
    return;
  }
  const parts = [];
  if (_pendingLevelUpPicks > 0) {
    parts.push(`<span style="color:#ffe070">${_pendingLevelUpPicks}× SKILL</span>`);
  }
  if (_pendingMasteryPicks.length > 0) {
    parts.push(`<span style="color:#d090ff">${_pendingMasteryPicks.length}× MASTERY</span>`);
  }
  _pickQueueHudEl.innerHTML = `${parts.join(' · ')} <span style="opacity:0.7;font-size:10px">— click or [K]</span>`;
  _pickQueueHudEl.style.display = 'block';
}

// Lazy-built level-up banner — glow-animated full-screen text
// overlay. Pure DOM, no external resources. Returns a promise that
// resolves after `durationMs` so the caller can await it.
let _levelUpBannerEl = null;
function _ensureLevelUpBanner() {
  if (_levelUpBannerEl) return _levelUpBannerEl;
  // Inject keyframes + base style once. Scoped via the element id
  // so they can't leak into other UI.
  if (!document.getElementById('level-up-banner-style')) {
    const style = document.createElement('style');
    style.id = 'level-up-banner-style';
    style.textContent = `
      @keyframes lvlup-glow {
        0%   { text-shadow: 0 0 12px #ffe070, 0 0 28px #ffd040, 0 0 60px #ff9020; transform: translate(-50%, -50%) scale(0.85); opacity: 0; }
        12%  { transform: translate(-50%, -50%) scale(1.06); opacity: 1; }
        20%  { transform: translate(-50%, -50%) scale(1.0); }
        80%  { text-shadow: 0 0 14px #ffe070, 0 0 32px #ffd040, 0 0 70px #ff9020; opacity: 1; }
        100% { text-shadow: 0 0 12px #ffe070, 0 0 28px #ffd040, 0 0 60px #ff9020; transform: translate(-50%, -50%) scale(1.04); opacity: 0; }
      }
      #level-up-banner {
        position: fixed; top: 38%; left: 50%;
        transform: translate(-50%, -50%);
        z-index: 60; pointer-events: none;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-weight: 700; font-size: 96px; letter-spacing: 14px;
        color: #fff5b8;
        opacity: 0; display: none; user-select: none;
        text-shadow: 0 0 12px #ffe070, 0 0 28px #ffd040, 0 0 60px #ff9020;
      }
      #level-up-banner.show { display: block; }
      #level-up-banner .sub {
        display: block; margin-top: 6px;
        font-size: 18px; letter-spacing: 6px;
        color: #ffd070; text-shadow: 0 0 8px #ffb030;
      }
    `;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.id = 'level-up-banner';
  el.innerHTML = 'LEVEL UP<span class="sub">choose an upgrade</span>';
  document.body.appendChild(el);
  _levelUpBannerEl = el;
  return el;
}
function _showLevelUpBanner(durationMs = 1800) {
  return new Promise((resolve) => {
    const el = _ensureLevelUpBanner();
    el.classList.add('show');
    // Restart the animation cleanly each call.
    el.style.animation = 'none';
    // Force reflow so the browser registers the animation reset
    // before re-applying — without this, a back-to-back level up
    // wouldn't re-run the keyframes.
    void el.offsetWidth;
    el.style.animation = `lvlup-glow ${durationMs}ms ease-out forwards`;
    if (sfx?.uiAccept) sfx.uiAccept();
    setTimeout(() => {
      el.classList.remove('show');
      el.style.animation = 'none';
      resolve();
    }, durationMs);
  });
}

// Class level-up banner — same shape as the gold level-up banner but
// purple-tinted so the player reads it as a different progression
// channel. Surfaced before the mastery picker for the same anti-
// misclick reason.
let _classLevelUpBannerEl = null;
function _ensureClassLevelUpBanner() {
  if (_classLevelUpBannerEl) return _classLevelUpBannerEl;
  if (!document.getElementById('class-level-up-banner-style')) {
    const style = document.createElement('style');
    style.id = 'class-level-up-banner-style';
    style.textContent = `
      @keyframes classlvlup-glow {
        0%   { text-shadow: 0 0 12px #d090ff, 0 0 28px #a040e0, 0 0 60px #6020a0; transform: translate(-50%, -50%) scale(0.85); opacity: 0; }
        12%  { transform: translate(-50%, -50%) scale(1.06); opacity: 1; }
        20%  { transform: translate(-50%, -50%) scale(1.0); }
        80%  { text-shadow: 0 0 14px #e0a0ff, 0 0 32px #a040e0, 0 0 70px #6020a0; opacity: 1; }
        100% { text-shadow: 0 0 12px #d090ff, 0 0 28px #a040e0, 0 0 60px #6020a0; transform: translate(-50%, -50%) scale(1.04); opacity: 0; }
      }
      #class-level-up-banner {
        position: fixed; top: 38%; left: 50%;
        transform: translate(-50%, -50%);
        z-index: 60; pointer-events: none;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        font-weight: 700; font-size: 76px; letter-spacing: 12px;
        color: #f0d8ff;
        opacity: 0; display: none; user-select: none;
        text-shadow: 0 0 12px #d090ff, 0 0 28px #a040e0, 0 0 60px #6020a0;
      }
      #class-level-up-banner.show { display: block; }
      #class-level-up-banner .sub {
        display: block; margin-top: 6px;
        font-size: 16px; letter-spacing: 5px;
        color: #d8a8ff; text-shadow: 0 0 8px #8030c0;
      }
    `;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.id = 'class-level-up-banner';
  el.innerHTML = 'CLASS LEVEL UP<span class="sub">choose a mastery</span>';
  document.body.appendChild(el);
  _classLevelUpBannerEl = el;
  return el;
}
function _showClassLevelUpBanner(durationMs = 1800) {
  return new Promise((resolve) => {
    const el = _ensureClassLevelUpBanner();
    el.classList.add('show');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = `classlvlup-glow ${durationMs}ms ease-out forwards`;
    if (sfx?.uiAccept) sfx.uiAccept();
    setTimeout(() => {
      el.classList.remove('show');
      el.style.animation = 'none';
      resolve();
    }, durationMs);
  });
}

function tick() {
  frameCounter = (frameCounter + 1) | 0;
  const rawDt = clock.getDelta();           // real elapsed since last frame
  let dt = Math.min(rawDt, 1 / 30);         // clamped for physics stability
  _perf.start('frame');
  // Tutorial hint queue ticks on rawDt so its fade timing is stable
  // even during hit-stop / pause windows. Internal queue is empty
  // for veterans; cost is one read + branch.
  tickHints(rawDt);
  // Time-gated tutorial hints — surface "secondary" controls a few
  // seconds after the run starts so the player has a moment to read
  // the move hint first. Each gate is internally idempotent (fireHint
  // no-ops once an id has fired), so spamming is safe.
  if (runStats && runStats.startedAt) {
    const runSec = (Date.now() - runStats.startedAt) / 1000;
    if (runSec > 8)  fireHint('inventory');
    if (runSec > 18) fireHint('crouch');
    if (runSec > 30) fireHint('dash');
    if (runSec > 50) fireHint('hotbar');
  }
  // Tutorial step ticking — runs every frame in tutorial mode and
  // advances the checklist as the player performs each action.
  // No-op for normal runs (cheap branch).
  if (tutorialMode) {
    const move = inputState.move;
    if (move && (move.x !== 0 || move.y !== 0)) tutorialUI.markStep('move');
    // ADS step — just holding RMB qualifies. Cursor doesn't need to
    // be on the dummy here; the shoot_head / shoot_leg / disarm
    // steps prove the player can aim at zones independently.
    if (inputState.adsHeld) tutorialUI.markStep('ads');
    if (inputState.reloadPressed) tutorialUI.markStep('reload');
    if (inputState.meleePressed) tutorialUI.markStep('melee');
    if (inputState.crouchPressed) tutorialUI.markStep('crouch');
    if (inputState.spacePressed || inputState.spaceDoublePressed) tutorialUI.markStep('dash');
    if (inputState.inventoryToggled) tutorialUI.markStep('inventory');
    if (inputState.healPressed) tutorialUI.markStep('heal');
    // Stealth step — find the stealth-flagged dummy and accumulate
    // proximity time while the player is crouched within 6m. Marks
    // complete after 1.5s of qualifying time, so a quick dash-by
    // doesn't count. Dummy must still be alive + idle (won't tick if
    // the player went and shot it).
    let stealthDummy = null;
    for (const g of gunmen.gunmen) {
      if (g.alive && g.stealthTarget) { stealthDummy = g; break; }
    }
    if (stealthDummy && lastPlayerInfo) {
      const sdx = stealthDummy.group.position.x - lastPlayerInfo.position.x;
      const sdz = stealthDummy.group.position.z - lastPlayerInfo.position.z;
      const sd = Math.hypot(sdx, sdz);
      const crouched = !!(lastPlayerInfo.crouched || lastPlayerInfo.crouchSprinting);
      if (sd < 6 && crouched) {
        _tutorialStealthT = (_tutorialStealthT || 0) + dt;
        if (_tutorialStealthT >= 1.5) tutorialUI.markStep('stealth');
      } else {
        _tutorialStealthT = Math.max(0, (_tutorialStealthT || 0) - dt * 0.5);
      }
    }
    // Extract step is marked when the player walks into the exit
    // zone — handled in the extract handler below.
  }
  // HP-driven heal hint — fires the first time the player drops below
  // 50% HP, surfacing the H quick-heal binding.
  if (lastPlayerInfo && lastPlayerInfo.maxHealth > 0
      && lastPlayerInfo.health < lastPlayerInfo.maxHealth * 0.5) {
    fireHint('heal');
  }
  // First skill point earned → perk-tree hint.
  if (playerSkillPoints > 0) fireHint('perks');
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
    // Coop downed lock — can't open inventory while bleeding out.
    // Letting the player rearrange items / drop loot from the
    // downed state breaks the "you're incapacitated" fiction and
    // lets them dump tagged items pre-revive. Always allow
    // dismissing an OPEN modal so they don't get stuck.
    if (!dismissTopModal()) {
      if (_localDowned) {
        try { transientHudMsg('Cannot open inventory while down.', 1.5); } catch (_) {}
      } else {
        inventoryUI.toggle();
      }
    }
  }
  if (inputState.perksToggled) {
    if (!_localDowned) perkUI.toggle();
  }
  if (inputState.menuToggled) {
    if (!dismissTopModal()) gameMenuUI.toggle();
  }
  // Loot All hotkey — only fires while the loot panel is open.
  // Default Y; user-rebindable in Settings → Keybinds.
  if (inputState.lootAllPressed && lootUI.isOpen() && lootUI._takeAll) {
    lootUI._takeAll();
  }

  // Throwable cooldowns tick on real elapsed time (rawDt) regardless
  // of modal / pause state — so three minutes of browsing the shop
  // still count toward a frag refill. Uses rawDt so we don't inherit
  // the 1/30 gameplay clamp, which would slow recharges during frame
  // hiccups. Runs BEFORE the modal gate so it continues inside
  // inventory / shop / loot.
  tickThrowableCooldowns(rawDt);

  // Co-op broadcast + ghost render also runs before the modal gate.
  // Without this, opening the lobby (or any pause UI) on either side
  // freezes position broadcasts and remote ghosts disappear, which
  // looks like "we connected but I can't see them" — the actual
  // failure mode reported in playtest.
  _tickCoop(rawDt);
  // Recharge AI-tracer broadcast budget once per host frame.
  _coopAiTracerBudget = 8;
  // Tick downed/revive state every frame regardless of pause UI.
  // Bleedout MUST count down even if the player has the inventory
  // open — otherwise downed players could just open inventory and
  // wait out their teammate's revive cooldown.
  _tickDowned(rawDt);
  _tickReviveInteract(rawDt);
  _renderDownedHud();

  // Coop disables single-player time-freeze. Stopping the world while
  // one player browses inventory / picks a skill / opens the shop
  // would freeze the other player's enemies, projectiles, AI, and
  // their own input — completely unplayable for the teammate. In
  // coop the gameplay tick keeps running through every modal except
  // the actual menu (which is always blocking) and player-dead
  // (which is the run-end state).
  const _coopActiveNow = (() => {
    const t = getCoopTransport();
    return t && t.isOpen && t.peers && t.peers.size > 0;
  })();
  const _modalPauseSP = paused || inventoryUI.visible
    || customizeUI.isOpen() || lootUI.isOpen() || shopUI.isOpen()
    || perkUI.isOpen() || gameMenuUI.isOpen() || playerDead;
  // Coop-only pause shortlist: gameMenu always pauses (the player is
  // explicitly choosing to step away). Everything else keeps ticking.
  const _modalPauseCoop = gameMenuUI.isOpen() || playerDead;
  if (_coopActiveNow ? _modalPauseCoop : _modalPauseSP) {
    // Modal pause — scene is frozen, so all the per-frame
    // recomputation (LoS mask raycasts, bloom mip chain, finisher
    // chroma/grain) is wasted work. Cut to a direct render and
    // suppress the LoS update for the rest of the pause.
    // Durability HUD still ticks so a repaired item flips state
    // while inventory is open.
    try { durabilityHud.tick(rawDt); } catch (_) {}
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

  if (inputState.weaponSwitch !== null) {
    // Keys 1-4 are now full hotbar slots (actionBar 0-3) — try the
    // bound item first; fall back to weapon-rotation swap if the slot
    // is empty so equipping a new weapon still gives a sane default
    // hotkey for it.
    const idx = inputState.weaponSwitch;
    const _slotItem14 = inventory.actionSlotItem(idx);
    if (_slotItem14 && _slotItem14.type === 'throwable' && (_slotItem14.charges | 0) > 0) {
      // Throwables in the weapon cluster (1-4) get the same hold-to-aim
      // behaviour as the upper hotbar (5-8). Without this, pressing 1-4
      // on a throwable fires it instantly with no trajectory preview.
      // Reuse _throwAimSlot but mark with a +10 sentinel so the release
      // loop knows to read from actionSlotHeld14 instead of actionSlotHeld.
      _throwAimSlot = idx;
      _throwAimFromWeaponBar = true;
    } else if (_slotItem14) {
      useActionSlot(idx);
    } else {
      setWeaponIndex(idx);
    }
  }
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
  // Track buff list length so an expiry inside tick can mark dirty
  // without us having to instrument BuffState itself.
  const _buffCountBefore = buffs.buffs.length;
  buffs.tick(dt);
  if (buffs.buffs.length !== _buffCountBefore) _statsDirty = true;
  recomputeStatsIfDirty();
  player.applyDerivedStats(derivedStats);
  // Backpack silhouette — reflects whatever's in the backpack slot.
  // Cheap (just a visibility toggle + scale set on a pre-built mesh)
  // so we can hit it every frame; no need for a dirty flag.
  if (player.setBackpackVisual) {
    player.setBackpackVisual(inventory.equipment.backpack);
  }
  // Body part tints follow equipped armor — chest tints torso/arms,
  // pants tints legs, boots tints feet, gloves tints hands, helmet
  // tints head. Cached on each rig material so we only touch GPU
  // when an item.tint actually differs from last frame.
  if (player.applyArmorTint) {
    player.applyArmorTint(inventory.equipment);
  }
  lastPlayerInfo = null; // will be set just after player.update

  // Muzzle scratch — reused every frame instead of clone()-ing
  // player.mesh.position. resolveAim consumes the vector synchronously
  // so it's safe to keep at module scope.
  _muzzleWorldTmp.copy(player.mesh.position);
  _muzzleWorldTmp.y = inputState.crouchHeld
    ? tunables.move.crouchMuzzleY
    : tunables.move.standMuzzleY;
  const aimInfo = resolveAim(_muzzleWorldTmp, inputState.crouchHeld);
  lastAim = aimInfo.point;
  lastAimZone = aimInfo.zone || null;

  // Kick off combo BEFORE update so the first step's `active` hit can fire
  // inside this same frame's player.update().
  tryStartCombo(inputState, aimInfo);
  tryStartQuickMelee(inputState, aimInfo);

  // Akimbo override — RMB is repurposed as the off-hand fire input
  // when both weapon slots hold a pistol (or both an SMG), so the
  // ADS animation + spread reduction must NOT engage. Suppress
  // adsHeld for the player.update pass (akimbo's own _tickAkimbo
  // reads the original inputState above).
  const _akimboActive = _isAkimbo();
  const _origAdsHeld = inputState.adsHeld;
  if (_akimboActive) inputState.adsHeld = false;
  const playerInfo = player.update(dt, inputState, aimInfo.point, resolveCollision);
  // Restore so anything after player.update that reads adsHeld
  // sees the player's actual mouse state. _tickAkimbo will be
  // called later in this tick and needs the real RMB value.
  if (_akimboActive) inputState.adsHeld = _origAdsHeld;
  _tickDjinnOrb(dt);
  if (playerInfo && playerInfo.maxHealth > 0) {
    lastHpRatio = Math.max(0, Math.min(1, playerInfo.health / playerInfo.maxHealth));
    playerMaxHealthCached = playerInfo.maxHealth;
    // Flawless transition — recompute derived stats only when the
    // full-HP boundary changes. Avoids the per-frame recompute cost
    // and keeps every consumer (HUD, fire path, movement) in sync.
    if (derivedStats.flawlessActive) {
      const atFull = playerInfo.health >= playerInfo.maxHealth - 0.001;
      if (atFull !== _flawlessAtFull) {
        _flawlessAtFull = atFull;
        _statsDirty = true;
      }
    }
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
    // Bloom decay — runs every frame regardless of weapon class. The
    // per-shot bump in fireOneShot adds; this drains. Linear decay
    // (constant per-second rate) so the math is predictable.
    if (_shotBloom > 0) {
      _shotBloom = Math.max(0, _shotBloom - BLOOM_DECAY_PER_SEC * dt);
    }
    // Push the bloom value to the cursor reticle. Hide entirely when
    // the player has no ranged weapon equipped, is dead, or the game
    // is paused — the ring is meaningless without an active gun.
    const _haveRanged = w?.type === 'ranged';
    setBloomVisible(_haveRanged && !playerDead && !paused);
    if (_haveRanged) setBloomLevel(_shotBloom);
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
  // Keys 5-8 fire the upper four hotbar slots. actionSlotPressed
  // arrives as 0..3 from the input layer (legacy naming) so we offset
  // by 4 to land in the right unified-actionBar slot.
  // Throwables defer to release: on press we just capture the slot so
  // the player can hold and aim, and the gameplay-tick block below
  // fires the throw on release. Other consumables fire immediately.
  if (inputState.actionSlotPressed >= 0) {
    const _qIdx = inputState.actionSlotPressed;
    const _slotItem = inventory.actionSlotItem(_qIdx + 4);
    if (_slotItem && _slotItem.type === 'throwable' && (_slotItem.charges | 0) > 0) {
      _throwAimSlot = _qIdx;
      _throwAimFromWeaponBar = false;
    } else {
      useActionSlot(_qIdx + 4);
    }
  }
  // Throw aim/release loop. While the same quickslot is still held,
  // refresh the trajectory preview each frame; once the player lets go
  // (or swaps the bound item / runs out of charges), fire the throw
  // and tear the preview down. Works for both the weapon cluster
  // (keys 1-4 → actionBar 0-3) and the upper hotbar (keys 5-8 →
  // actionBar 4-7).
  if (_throwAimSlot >= 0) {
    const slotOffset = _throwAimFromWeaponBar ? 0 : 4;
    const heldIdx = _throwAimFromWeaponBar
      ? inputState.weaponSlotHeld
      : inputState.actionSlotHeld;
    const aimItem = inventory.actionSlotItem(_throwAimSlot + slotOffset);
    const stillBoundThrowable = aimItem && aimItem.type === 'throwable' && (aimItem.charges | 0) > 0;
    if (heldIdx === _throwAimSlot && stillBoundThrowable) {
      tickThrowAimPreview(aimItem);
    } else {
      hideThrowPreview();
      if (stillBoundThrowable) useActionSlot(_throwAimSlot + slotOffset);
      _throwAimSlot = -1;
      _throwAimFromWeaponBar = false;
    }
  }

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
  _decayFireStandStack(dt);
  // _tickCoop now runs above the modal-pause gate (line ~12862) so
  // it stays active during lobby / inventory / shop screens and
  // ghosts don't freeze when either peer opens a UI.
  _tickFireZones(dt);
  _tickFlashDomes(dt);
  _tickFireOrbs(dt);
  _tickCoinFx(dt);
  _tickAssassinKnives(dt);
  _tickBurnReadouts(dt);
  _tickBuffAuras(dt);
  _tickThrowableZones(dt);
  _tickClaymores(dt);
  _tickCamping(dt);
  _tickBurnFlames(dt);
  tickAmbushDrops(dt);
  _tickStunStars(dt);
  _tickQuestionMarks(dt);
  _tickGrapples(dt);
  tickCorpseDespawn(dt);
  tickEncounters(dt);
  _tickSmokePuffs(dt);
  _tickIndecisionRelic(dt);
  // Player flash + stun decay. Flash drives a fullscreen white
  // overlay that fades from 1.0 → 0 over the duration; stun decays
  // separately, the camera waver reads it below.
  if (playerFlashT > 0) {
    playerFlashT = Math.max(0, playerFlashT - dt);
    const k = Math.min(1, playerFlashT / 1.2);  // hold full white the first 1.2s, then fade
    _flashOverlayEl.style.opacity = String((k > 0.6 ? 1 : k / 0.6).toFixed(3));
  } else if (_flashOverlayEl.style.opacity !== '0') {
    _flashOverlayEl.style.opacity = '0';
  }
  if (playerStunT > 0) playerStunT = Math.max(0, playerStunT - dt);
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
  // Joiner-side AI gate — when we're a connected coop joiner (not
  // host), enemy AI runs ONLY on the host. Skipping the local update
  // calls prevents double-simulation (host's snapshot positions would
  // fight the joiner's local pathing). The joiner still renders the
  // rig animations driven by snapshot 'state' tags + position lerp.
  // Inlined to avoid the per-frame closure alloc the IIFE produced.
  const _coopT = getCoopTransport();
  const _coopJoiner = _coopT.isOpen && !_coopT.isHost;
  // Multi-target player list (host only — joiners pass empty so the
  // manager's swap is a no-op). The managers also receive a
  // coopJoiner flag that gates the AI decision call (_updateRanged /
  // _updateAI) while letting rig animation + death physics + corpse
  // settling continue. Without that, joiner corpses stayed upright
  // and walk cycles froze.
  const _coopPlayers = [];
  if (!_coopJoiner) {
    // Skip the host's own entry when downed — AI shouldn't keep
    // shooting the corpse. Downed players have _localDowned true.
    if (!_localDowned) {
      _coopPlayers.push({
        x: player.mesh.position.x,
        z: player.mesh.position.z,
        peerId: null,
      });
    }
    if (coopLobby && getCoopTransport().isHost) {
      for (const [pid, ghost] of coopLobby.ghosts) {
        // Skip downed + dead ghosts so AI retargets to a living
        // teammate instead of attacking the corpse.
        if (ghost.dead) continue;
        if (_coopPeerDowned.has(pid)) continue;
        _coopPlayers.push({ x: ghost.x, z: ghost.z, peerId: pid });
      }
    }
  }
  {
  gunmen.update({
    coopJoiner: _coopJoiner,
    players: _coopPlayers,
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
    onBurnKill: (e) => { onEnemyKilled(e); awardClassXp('exotic', e.tier, e); },
    onBurnDamage: (e, dmg) => trackBurnDamage(e, dmg),
    onAlert: (e) => propagateAggro(e),
    playerStealthMult: stealthMult,
    resolveCollision: enemyResolveCollision,
    shieldBearers,
    findDoorToward: (roomId, enemyPos) =>
      level.findDoorToward(roomId, playerInfo.position, enemyPos),
    isRoomActive,
    spawnAiGrenade: (g) => spawnAiGrenade(g),
    spawnSniperShot: (g) => spawnSniperShot(g),
    isInsideSmoke,                  // smoke-grenade LoS override
    smokeContaining,                // returns the freshest zone the player is inside
    smokeOnSegment,                 // returns the freshest zone blocking enemy LoS to player
    randomSmokeAim,                 // random aim point inside a zone (for confused fire)
    activeDecoy,                    // decoy beacon target hijack
    spawnAiThrowable: (g, kind) => spawnAiThrowable(g, kind),
    isPlayerCamping: () => playerCampingT > playerCampingThreshold,
    droneSummonAt: (gx, gz) => spawnDronesAt(gx, gz),
    spawnerTeleportAndSummon: (g) => spawnerTeleportAndSummon(g),
  });
  melees.update({
    dt,
    coopJoiner: _coopJoiner,
    players: _coopPlayers,           // multi-target AI; see gunman.js
    playerPos: playerInfo.position,
    playerRoomId,                   // assassin uncloak trigger
    combat,
    camera,                         // for chatter bubble projection
    level,                          // for room-graph pathing
    levelIndex: level?.index | 0,   // SHINIGAMI scaling reads this
    obstacles: losObstacles,
    playerStealthMult: stealthMult,
    onAlert: (e) => propagateAggro(e),
    isRoomActive,
    isInsideSmoke,
    smokeContaining,
    smokeOnSegment,
    randomSmokeAim,
    activeDecoy,
    droneSummonAt: (gx, gz) => spawnDronesAt(gx, gz),
    bossTeleport: (e) => bossTeleport(e),
    // SHINIGAMI — drop a ring of small molotov pools around the boss
    // after a melee swing attempt. Each pool seeds a short fire zone
    // (DPS scaled by run depth) so the player has to clear out of the
    // strike radius after eating the slash.
    spawnShinigamiMolotovRing: (cx, cz, lvIdx) => {
      const RING_R = 2.4;
      const COUNT  = 6;
      const lv = Math.max(1, lvIdx | 0);
      // Per-pool DPS + duration scales modestly with floor depth.
      const dps = 10 + Math.min(10, lv * 0.8);
      const dur = 4.0 + Math.min(2.0, lv * 0.1);
      for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.3;
        const r = RING_R + (Math.random() - 0.5) * 0.4;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        spawnFireZone({ x, z }, 1.1 + Math.random() * 0.3, dur, dps);
        // Visual splash so the ring reads on impact instead of just
        // appearing — reuse the existing fire-orb burst at each pool.
        spawnFireOrbBurst({ x, z }, 1.0, 6);
      }
      if (sfx?.uiAccept) sfx.uiAccept();
    },
    // Cloaked assassins use this — places the enemy behind the
    // player's aim line. Falls back to bossTeleport (random in-room
    // open spot) if no behind-player spot validates after 20
    // attempts so an assassin in a corner-cornered player never gets
    // stuck without a teleport option.
    teleportBehindPlayer: (e) => teleportBehindPlayer(e) || bossTeleport(e),
    spawnAssassinKnives: (x, y, z, dx, dz, n, owner) =>
      spawnAssassinKnives(x, y, z, dx, dz, n, owner),
    onPlayerHit: (d, enemy) => {
      // Multi-target route: if the AI was swinging at a joiner (their
      // peerId stamped via the per-enemy target swap in melees.update),
      // forward the primary swing damage as RPC instead of hitting
      // the host. The joiner's rpc-player-damage handler runs
      // damagePlayer locally with the same amount.
      const targetPeer = enemy?._coopTargetPeerId || null;
      const isHostCoop = !!coopLobby && getCoopTransport().isHost;
      if (targetPeer && isHostCoop) {
        _coopSendPlayerDamage(targetPeer, d, 'melee', { zone: 'torso' });
        // Other joiners caught in the swing radius (not the targeted
        // peer) also eat the swing. Host is skipped — the AI wasn't
        // aiming at the host this swing.
        if (enemy?.group) {
          const ex = enemy.group.position.x;
          const ez = enemy.group.position.z;
          const swingR = (tunables.meleeEnemy?.swingRange || 1.5) * 1.15;
          for (const [peerId, ghost] of coopLobby.ghosts) {
            if (peerId === targetPeer) continue;
            const jdx = ghost.x - ex;
            const jdz = ghost.z - ez;
            if (jdx * jdx + jdz * jdz <= swingR * swingR) {
              _coopSendPlayerDamage(peerId, d, 'melee', { zone: 'torso' });
            }
          }
        }
        return;
      }
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
      // Distance for death-recap and the hit-react reuse the same dx/dz.
      let _meleeDist = null;
      if (enemy && enemy.group) {
        const dx = player.mesh.position.x - enemy.group.position.x;
        const dz = player.mesh.position.z - enemy.group.position.z;
        _meleeDist = Math.hypot(dx, dz);
      }
      damagePlayer(d, 'melee', { source: enemy, zone: 'torso', distance: _meleeDist });
      // Coop — any joiner ghost within swing radius of the enemy
      // also eats the swing. The AI targets the host's player, so
      // this is a "stand close to a swinging enemy and get caught"
      // effect rather than the AI deliberately targeting joiners
      // (multi-target AI is later work).
      if (coopLobby && getCoopTransport().isHost && enemy?.group) {
        const ex = enemy.group.position.x;
        const ez = enemy.group.position.z;
        const swingR = (tunables.meleeEnemy?.swingRange || 1.5) * 1.15;
        for (const [peerId, ghost] of coopLobby.ghosts) {
          const jdx = ghost.x - ex;
          const jdz = ghost.z - ez;
          if (jdx * jdx + jdz * jdz <= swingR * swingR) {
            _coopSendPlayerDamage(peerId, d, 'melee', { zone: 'torso' });
          }
        }
      }
      // Thread Cuts Both Ways relic — reflect 25% of incoming melee
      // damage back on the attacker. Modeled as instant counter-damage
      // (no enemy bleed-DoT system exists, so this is the closest
      // mechanical analogue; reads as "they bleed for it").
      if (enemy && enemy.alive && enemy.manager
          && (derivedStats.meleeReflectBleedPercent || 0) > 0) {
        const reflect = d * derivedStats.meleeReflectBleedPercent * 0.01;
        enemy.manager.applyHit(enemy, reflect, 'torso', { x: 0, z: 0 });
        if (!enemy.alive) onEnemyKilled(enemy);
      }
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
    onBurnKill: (e) => { onEnemyKilled(e); awardClassXp('exotic', e.tier, e); },
    onBurnDamage: (e, dmg) => trackBurnDamage(e, dmg),
    playerIFrames: playerInfo.iFrames,
    playerBlocking: playerInfo.blocking,
    resolveCollision: enemyResolveCollision,
  });
  }   // end of gunmen/melees update block — coopJoiner flag inside the
      // managers gates the AI, not this outer wrapper, so death physics
      // + rig anim still run on joiner.
  // Drone tick — the suicide drones float toward the player at
  // a fixed speed and detonate on contact. Player-aim raycasts
  // already see them via allHittables (the manager plugged its
  // hittables() in alongside gunmen + melees), so bullets damage
  // them through the standard hit pipeline.
  drones.update(dt, {
    coopJoiner: _coopJoiner,
    playerPos: playerInfo.position,
    level,
    onDroneExplode: (pos, explosion) => {
      // Same payload shape as projectile detonations — route through
      // the existing onProjectileExplode handler so the AoE damage
      // + spawn FX match grenades visually + audibly.
      onProjectileExplode(pos, explosion, 'enemy', { throwKind: null });
    },
  });

  // Mega-boss tick — runs only on milestone floors. Self-contained
  // FSM, hazard tick, and HUD bar render. Player position is needed
  // for facing + body-collision damage; we pass the live position
  // (not snapshot) so charge attack tracking is correct.
  //
  // Coop joiner: skip the FSM (host runs it) and pull position +
  // HP from the latest snapshot. Host runs the authoritative tick
  // and then scans the megaboss's hazard arrays for any joiner
  // ghosts caught in fires / gas / bullets / shells / grenades —
  // see _coopTickMegabossHazards.
  if (megaBoss) {
    if (_coopJoiner) {
      const pair = pickInterpSnapshots();
      if (pair) applyMegaBossSnapshot(pair.b, megaBoss);
      // Visual-only tick — animates the boss mesh (eye spin, fire
      // patches, gesturing arm) without running the AI / attack /
      // hazard FSM. Each megaboss class exposes its own tickVisuals.
      try { megaBoss.tickVisuals?.(dt); } catch (_) {}
    } else {
      megaBoss.update(dt, player.mesh.position);
      _coopTickMegabossHazards();
    }
  }

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
    advanceFloor();
  } else if (pendingLevelUps > 0 && !paused && !_pickBannerShowing) {
    pendingLevelUps -= 1;
    runLevelUp();
  } else if (pendingMasteryOffers.length > 0 && !paused && !_pickBannerShowing) {
    runMasteryOffer();
  }
  _refreshExitWaitHud();
  // Joiner stash autosave — every 30s while in coop. Cheap (one
  // JSON.stringify of inventory + pure-data fields). Host skips.
  _coopStashSaveT -= rawDt;
  if (_coopStashSaveT <= 0) {
    _coopStashSaveT = 30;
    _coopSaveJoinerState();
  }

  const weapon = currentWeapon();
  const effWeapon = weapon ? effectiveWeapon(weapon) : null;
  // Class-derived ADS peek distance — drag budget the camera can
  // reach away from the player while ADS is held. The new ADS model
  // in scene.js locks onto the cursor's world position on press and
  // accumulates cursor screen motion onto the offset, hard-clamped
  // at this radius.
  const _wcls = effWeapon?.class;
  const _adsPeekByClass = _wcls === 'sniper'  ? 35.0
                        : _wcls === 'rifle'   ? 21.0
                        : _wcls === 'lmg'     ? 17.0
                        : _wcls === 'smg'     ? 10.0
                        : _wcls === 'shotgun' ?  6.0
                        : _wcls === 'pistol'  ?  6.0
                        : _wcls === 'flame'   ?  3.0
                        : effWeapon?.adsPeekDistance ?? 5.0;
  updateCamera(dt, {
    target: playerInfo.position,
    aim: aimInfo.point,
    adsAmount: playerInfo.adsAmount,
    adsZoom: effWeapon?.adsZoom,
    adsPeekDistance: _adsPeekByClass,
    cursorNDC: input.hasAim ? input.mouseNDC : null,
    // Per-sight ADS frustum push-in: iron 1.05, red dot/reflex 1.10,
    // holo 1.15, mid scope 1.20, long scope 1.30. Falls back to 1.05
    // when no weapon is equipped.
    sightZoom: effWeapon?.sightZoom ?? 1.05,
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
  // Stun-grenade camera waver — slower than shake, smooth sinusoidal
  // sway driven by playerStunT. Makes precise aim painful while the
  // stun is active; full waver at peak fade-out toward 0 over the last
  // 30% of life. Independent of shakeT so an explosion+stun stack.
  if (playerStunT > 0) {
    const stunMax = 2.5;
    const k = Math.min(1, playerStunT / stunMax);
    const fadeK = k > 0.7 ? 1 : (k / 0.7);
    const t = performance.now() / 1000;
    const amp = 0.35 * fadeK;
    camera.position.x += Math.sin(t * 6.4) * amp;
    camera.position.y += Math.sin(t * 4.2 + 1.3) * amp * 0.5;
    camera.position.z += Math.cos(t * 5.7 + 0.6) * amp;
  }

  updateHealthHud(playerInfo);
  // Akimbo override — point the reload bar at whichever off-hand
  // weapon is mid-reload. When neither / both are, fall back to the
  // dominant (weapon1). Prefers the weapon with MORE time remaining
  // so the bar shows the one about to finish LAST (the player sees
  // when they'll have both back).
  if (_isAkimbo()) {
    const w1ak = inventory.equipment.weapon1;
    const w2ak = inventory.equipment.weapon2;
    const r1 = w1ak?.reloadingT > 0;
    const r2 = w2ak?.reloadingT > 0;
    if (r1 && !r2) {
      updateReloadHud(w1ak, effectiveWeapon(w1ak));
    } else if (r2 && !r1) {
      updateReloadHud(w2ak, effectiveWeapon(w2ak));
    } else if (r1 && r2) {
      const slower = (w1ak.reloadingT >= w2ak.reloadingT) ? w1ak : w2ak;
      updateReloadHud(slower, effectiveWeapon(slower));
    } else {
      updateReloadHud(weapon, effWeapon);
    }
  } else {
    updateReloadHud(weapon, effWeapon);
  }
  updateWeaponInfoHud(weapon, effWeapon);
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
  // Cull far-room SpotLights — every lit fragment shader iterates the
  // scene's lights[] array regardless of intensity, so killing visibility
  // on lamps in unreachable rooms drops fragment cost noticeably.
  if (level.updateRoomLightCulling && player?.mesh) {
    level.updateRoomLightCulling(player.mesh.position.x, player.mesh.position.z);
  }
  // Prop / decoration culling — far-room props go invisible. Same
  // pattern as light culling but on a slightly wider radius so props
  // at the edge of the camera frustum don't pop in/out on rotation.
  if (level.updateDecorationCulling && player?.mesh) {
    level.updateDecorationCulling(player.mesh.position.x, player.mesh.position.z);
  }
  // Per-frame HUD text writes — cached on the element so we only
  // touch the DOM when the displayed value actually changes. textContent
  // assignment is cheap individually but adds up to ~6 dirty marks per
  // frame across these elements when the values stay identical (which
  // they do most frames). _lastTxt / _lastDisplay scratch on the elem
  // itself avoids module-level state.
  if (creditTextEl) {
    const t = persistentChips > 0
      ? `${playerCredits}c · ${persistentChips}◆`
      : String(playerCredits);
    if (creditTextEl._lastTxt !== t) {
      creditTextEl.textContent = t;
      creditTextEl._lastTxt = t;
    }
  }
  if (levelTextEl) {
    const t = String((level?.index | 0) || 1);
    if (levelTextEl._lastTxt !== t) {
      levelTextEl.textContent = t;
      levelTextEl._lastTxt = t;
    }
  }
  if (xpTextEl) {
    const t = `${playerXp}/${xpToNextLevel()}`;
    if (xpTextEl._lastTxt !== t) {
      xpTextEl.textContent = t;
      xpTextEl._lastTxt = t;
    }
  }
  if (spRowEl) {
    const d = playerSkillPoints > 0 ? 'flex' : 'none';
    if (spRowEl._lastDisplay !== d) {
      spRowEl.style.display = d;
      spRowEl._lastDisplay = d;
    }
  }
  if (spTextEl) {
    const t = String(playerSkillPoints);
    if (spTextEl._lastTxt !== t) {
      spTextEl.textContent = t;
      spTextEl._lastTxt = t;
    }
  }

  // Coop downed-state — entered when health <= 0 and a teammate
  // is still alive. Holds the death overlay off until the local
  // bleedout expires (or a teammate revives). The else branch
  // below is the normal solo death path.
  const _shouldGoDown = !playerDead && !_localDowned
    && playerInfo.health <= 0 && _coopHasLivingTeammate();
  if (_shouldGoDown) _enterDownedState();
  if (!playerDead && !_localDowned && playerInfo.health <= 0) {
    playerDead = true;
    sfx.death();
    _coopBroadcastSelfDied();
    // Seal the run's stats and submit to the local leaderboard. Tainted
    // runs (save/load used) are silently dropped inside submitRun so
    // save-scummers can't climb the boards.
    runStats.deathLevel = level.index | 0;
    runStats.deathAt = Date.now();
    runStats.playerName = getPlayerName() || 'anon';
    try { Leaderboard.submitRun(runStats); } catch (e) { console.warn(e); }
    // Marks — death currency. Earned for trying. Scales with how
    // far the run went (peak floor + 1) plus fractional credit for
    // damage and kills. Floor: 5 marks for a fresh-start death; a
    // mid-run death at floor 8 with decent kills lands ~30 marks.
    const peak = (runStats.levels | 0) + 1;
    const damageBonus = Math.floor((runStats.damage | 0) / 800);
    const killBonus = Math.floor((runStats.kills | 0) / 8);
    const marksEarned = Math.max(5, peak * 3 + damageBonus + killBonus);
    runStats.marksEarned = marksEarned;
    try { awardMarks(marksEarned); } catch (e) { console.warn(e); }
    // Lifetime run counter — feeds the hidden encounter-tier formula
    // and the cooldownRuns timer. Bumped here on death; extract path
    // bumps separately at advanceFloor().
    try { bumpRunCount(); } catch (_) {}
    // Populate the death-screen run-summary panel with the freshly-
    // sealed stats. Mirrors the leaderboard fields so the player gets
    // immediate feedback about how the run went without having to
    // open the leaderboard tab.
    const setDS = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    const runSec = Math.max(0, Math.round((Date.now() - (runStats.startedAt || Date.now())) / 1000));
    const mins = Math.floor(runSec / 60);
    const secs = runSec % 60;
    setDS('death-stat-level', `${(runStats.deathLevel | 0) + 1}`);
    setDS('death-stat-kills', `${runStats.kills | 0}`);
    setDS('death-stat-damage', `${Math.round(runStats.damage || 0)}`);
    setDS('death-stat-credits', `${Math.round(runStats.credits || 0)}c`);
    setDS('death-stat-time', `${mins}m ${secs}s`);

    // Death recap — list the top attackers by cumulative damage with
    // hit count + total damage each. Killing-blow zone shown above
    // the list. Buckets attackers by name so 3 melees show as
    // "Melee × 3" rather than three separate rows.
    const recapEl = document.getElementById('death-recap');
    const fatal = _lastFatalHit;
    const showRecap = (_attackerStats.size > 0) || fatal;
    if (recapEl) recapEl.style.display = showRecap ? 'grid' : 'none';
    if (showRecap) {
      const zone = (fatal && fatal.zone) || '—';
      setDS('death-recap-zone', zone === '—' ? '—' : `${zone}`);
      // Bucket per-attacker entries by display name. Each tally has
      // {name, dmg, hits, distance, type}. Group hits + dmg for
      // multiple instances of the same enemy archetype.
      const byName = new Map();
      for (const [, st] of _attackerStats) {
        const key = st.name || 'Unknown';
        const grouped = byName.get(key) || { name: key, dmg: 0, hits: 0, count: 0 };
        grouped.dmg += st.dmg || 0;
        grouped.hits += st.hits || 0;
        grouped.count += 1;
        byName.set(key, grouped);
      }
      const sorted = [...byName.values()].sort((a, b) => b.dmg - a.dmg).slice(0, 5);
      const listEl = document.getElementById('death-recap-list');
      if (listEl) {
        listEl.innerHTML = '';
        for (const e of sorted) {
          const row = document.createElement('div');
          row.className = 'death-stat-row';
          const label = document.createElement('span');
          label.className = 'death-stat-label';
          label.textContent = e.count > 1 ? `${e.name} × ${e.count}` : e.name;
          const val = document.createElement('span');
          val.className = 'death-stat-val';
          val.textContent = `${Math.round(e.dmg)} dmg · ${e.hits} hit${e.hits === 1 ? '' : 's'}`;
          row.appendChild(label);
          row.appendChild(val);
          listEl.appendChild(row);
        }
        if (sorted.length === 0 && fatal) {
          const row = document.createElement('div');
          row.className = 'death-stat-row';
          row.innerHTML = `<span class="death-stat-label">${fatal.name || 'Unknown'}</span><span class="death-stat-val">${Math.round(fatal.amount || 0)} dmg</span>`;
          listEl.appendChild(row);
        }
      }
    }
    // Rewards block — marks earned this run (already set above),
    // sigils / chips / rank deltas vs run-start baselines, plus an
    // accuracy approximation. Rank-up callout shown if the player
    // crossed at least one contract-rank threshold during this run.
    try {
      const rewardsEl = document.getElementById('death-rewards');
      if (rewardsEl) rewardsEl.style.display = 'block';
      const sigilsDelta = Math.max(0, getSigils() - _runStartSigils);
      const chipsDelta = Math.max(0, getPersistentChips() - _runStartChips);
      const rankAfter = getContractRank();
      const rankDelta = Math.max(0, rankAfter - _runStartRank);
      const fired = runStats.firedShots | 0;
      const landed = runStats.landedShots | 0;
      const acc = fired > 0 ? Math.round((landed / fired) * 100) : null;
      setDS('death-stat-marks', `${runStats.marksEarned | 0}`);
      setDS('death-stat-sigils', sigilsDelta > 0 ? `+${sigilsDelta}` : '0');
      setDS('death-stat-chips', chipsDelta > 0 ? `+${chipsDelta}` : '0');
      setDS('death-stat-accuracy', acc != null ? `${acc}% (${landed}/${fired})` : '—');
      const rankupEl = document.getElementById('death-rankup');
      const rankupTxt = document.getElementById('death-rankup-text');
      if (rankupEl) {
        if (rankDelta > 0 && rankupTxt) {
          rankupTxt.textContent = `Contract rank ${_runStartRank} → ${rankAfter}`;
          rankupEl.style.display = 'block';
        } else {
          rankupEl.style.display = 'none';
        }
      }
    } catch (e) { console.warn('[death] rewards panel failed', e); }
    // Mortician flavor line — picks contextual copy based on what
    // killed the player. Reads top-attacker name + zone + tier from
    // the recap data assembled above.
    try {
      const lineEl = document.getElementById('mortician-line');
      if (lineEl) {
        const fatalForFlavor = _lastFatalHit;
        let topAttackerName = null;
        let topAttackerCount = 0;
        const byNameForFlavor = new Map();
        for (const [, st] of _attackerStats) {
          const key = st.name || 'Unknown';
          const grouped = byNameForFlavor.get(key) || { dmg: 0, count: 0 };
          grouped.dmg += st.dmg || 0;
          grouped.count += 1;
          byNameForFlavor.set(key, grouped);
        }
        let topDmg = -1;
        for (const [name, g] of byNameForFlavor) {
          if (g.dmg > topDmg) { topDmg = g.dmg; topAttackerName = name; topAttackerCount = g.count; }
        }
        const zone = fatalForFlavor?.zone || null;
        const dist = (typeof fatalForFlavor?.distance === 'number') ? fatalForFlavor.distance : null;
        const lines = [];
        if (topAttackerName) {
          if (topAttackerCount >= 3) {
            lines.push(`A pack of ${topAttackerName.toLowerCase()}s overwhelmed you. They always come in numbers.`);
            lines.push(`${topAttackerCount} sets of teeth. They left little for me to bury.`);
          } else if (zone === 'head') {
            lines.push(`A clean shot through the head. ${topAttackerName} won't remember your face.`);
            lines.push(`The skull is intact, mostly. I've seen worse come back.`);
          } else if (zone === 'legs') {
            lines.push(`Bled out from the legs. You forgot to keep them moving.`);
          } else if (dist != null && dist > 18) {
            lines.push(`Hit from ${dist.toFixed(0)} meters. You never saw the muzzle flash.`);
          } else {
            lines.push(`${topAttackerName} got close enough to do real work.`);
            lines.push(`The wound was personal. ${topAttackerName} took their time.`);
          }
        } else {
          lines.push(`Hard to say what finished you. The wound is shy.`);
          lines.push(`I'll leave the cause of death blank. They always come back anyway.`);
        }
        // Add a mid-late floor or zero-credit jab.
        const peak = (runStats.deathLevel | 0) + 1;
        if (peak >= 8) lines.push(`Floor ${peak}. Further than most. Not far enough.`);
        else if (peak <= 2) lines.push(`Floor ${peak}. Don't worry — the dirt is fresh.`);
        if ((runStats.kills | 0) === 0) lines.push(`Zero kills. The hardest currency to earn here is blood that isn't yours.`);
        lineEl.textContent = lines[Math.floor(Math.random() * lines.length)];
      }
    } catch (e) { console.warn('[mortician] flavor pick failed', e); }
    if (deathRootEl) deathRootEl.style.display = 'flex';
    _activeRestartSlot = 0;
    _refreshRestartSlotsUI();
    _maybeShowLockedTrialPrompt();
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
    const t = `level ${level.index}  char ${playerLevel}  `
      + `[${currentWeaponIndex + 1}/${rotation.length}] ${weaponLabel}${ammoLabel}${classLabel}  `
      + `aim ${zoneLabel}  ${playerInfo.iFrames ? 'i-frames' : ''}`;
    if (hudStatsEl._lastTxt !== t) {
      hudStatsEl.textContent = t;
      hudStatsEl._lastTxt = t;
    }
  }

  // Keycard HUD + transient toast fade + major-boss bar.
  renderKeycardHud();
  renderBossBar();
  if (toastFadeT > 0) {
    toastFadeT -= dt;
    if (toastFadeT <= 0) toastEl.style.opacity = '0';
  }

  // Durability HUD — internal 5Hz throttle, so the per-frame call is
  // cheap and the column re-layouts only when state actually changes.
  try { durabilityHud.tick(rawDt); } catch (_) {}

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
    // Rig instancer per-frame sync — refreshes registered actors'
    // matrixWorld and writes each source mesh's world transform into
    // its InstancedMesh slot. Runs BEFORE render so the instance
    // matrices are current when the renderer walks the scene.
    const _ri = rigInstancer && rigInstancer();
    if (_ri) _ri.syncFrame();
    _perf.start('render');
    // Hideout-active swap — when the diegetic hideout scene is
    // visible, render IT to the shared canvas instead of the game
    // scene. Keeps a single renderer / canvas / GL context.
    const hsActive = hideoutUI?.isOpen?.() && hideoutUI._scene && hideoutUI._scene.visible;
    if (hsActive) {
      try {
        hideoutUI._scene.update(rawDt);
      } catch (e) {
        console.warn('[hideout-scene]', e);
      }
    } else if (modalPaused) {
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

// Shader pre-warm — first-time hitches when the player saw their
// first enemy and dropped their first item were Three.js compiling
// the lit MeshStandardMaterial shader variants for those entities on
// the gameplay frame they entered the camera frustum (~100-300ms each
// on cold GPU caches). Spin up one of each enemy archetype + a sample
// loot drop in scene at far-off coords, then renderer.compile(scene,
// camera) walks the scene and compiles every material's shader so the
// gameplay frame doesn't pay that cost. Warmup entities tear down
// immediately after — combat / loot pool materials are already in
// scene at construction time and get covered by the same compile.
function _warmShaders() {
  if (!renderer || !scene || !camera) return;
  // Spawn one of each archetype whose first appearance historically
  // caused visible hitches: a regular gunman + sniper-armed gunman,
  // a regular melee + a shield-bearer melee (so the shield mesh's
  // material variant compiles before the player ever sees one), and
  // a couple of loot drops at varying rarities so the beacon/light
  // variants compile too. y/x/z are irrelevant — compile doesn't
  // check visibility, just that the materials exist in scene.
  const FAR = -9999;
  // Pick a benign weapon for the warmup gunmen (any non-mythic ranged
  // entry — the weapon mesh just needs to be in scene to compile).
  const warmWeapon = (tunables.weapons || []).find(w =>
    !w.artifact && w.rarity !== 'mythic' && w.type !== 'melee') || tunables.weapons?.[0];
  try { gunmen.spawn(FAR, FAR, warmWeapon, { tier: 'normal', roomId: -1 }); } catch (_) {}
  try { gunmen.spawn(FAR, FAR, warmWeapon, { tier: 'subBoss', roomId: -1, variant: 'shieldBearer' }); } catch (_) {}
  try { melees.spawn(FAR, FAR, { tier: 'normal', roomId: -1 }); } catch (_) {}
  try { melees.spawn(FAR, FAR, { tier: 'normal', roomId: -1, variant: 'shieldBearer' }); } catch (_) {}
  // Loot pool — warm beacon variants for legendary + epic so the
  // first rare-tier drop in gameplay (disarm push, kill loot, etc.)
  // doesn't compile its beacon shader mid-frame.
  const warmLootEntries = [];
  try {
    warmLootEntries.push(loot.spawnItem({ x: FAR, y: FAR, z: FAR },
      { name: 'WARM_LEG', type: 'junk', tint: 0xffd040, rarity: 'legendary' }));
  } catch (_) {}
  try {
    warmLootEntries.push(loot.spawnItem({ x: FAR, y: FAR, z: FAR },
      { name: 'WARM_EPIC', type: 'junk', tint: 0xb060ff, rarity: 'epic' }));
  } catch (_) {}
  try {
    warmLootEntries.push(loot.spawnItem({ x: FAR, y: FAR, z: FAR },
      { name: 'WARM_COMMON', type: 'junk', tint: 0x808080, rarity: 'common' }));
  } catch (_) {}
  // FX warmup — first throw of grenade / flashbang / molotov / smoke /
  // decoy / gas, and first drone sighting, were each compiling their
  // MeshBasicMaterial variants on the gameplay frame they fired
  // (visible as a 30-80ms stutter the first time the player used the
  // ability). Seed one of each at FAR so the compile pass below picks
  // up their materials. Teardown is grouped with the rest below.
  const _farPos = new THREE.Vector3(FAR, 0, FAR);
  try { combat.spawnExplosion?.(_farPos, 1.0); } catch (_) {}
  try { spawnFlashDome(_farPos, 1.0); } catch (_) {}
  try { _spawnFlameTongue(FAR, 0, FAR); } catch (_) {}
  try { _spawnEmber(FAR, FAR); } catch (_) {}
  try { _spawnSmoke(FAR, 0, FAR); } catch (_) {}
  try { _spawnFlungFireOrb({ x: FAR, z: FAR }, 1, 0, 1, 1, 1); } catch (_) {}
  try { spawnSmokeZone({ x: FAR, z: FAR }, 1.0, 1.0); } catch (_) {}
  try { spawnDecoyBeacon({ x: FAR, z: FAR }, 1.0); } catch (_) {}
  try { spawnGasZone({ x: FAR, z: FAR }, 1.0, 1.0, 'player'); } catch (_) {}
  try { drones.spawn(FAR, 1.4, FAR); } catch (_) {}
  // Compile every material currently in the scene. Costs the same
  // ~100-300ms hitch we wanted to avoid in gameplay, but here it
  // happens at boot before the player can interact, so it reads as
  // part of the load rather than a stutter mid-fight.
  try { renderer.compile(scene, camera); } catch (_) {}
  // Force a real render so the GPU pipeline commits the compiled
  // shaders + uploads textures instead of waiting for the first
  // visible frame. Even at -9999 the warmup entities walk through
  // the full draw path. Single throw-away frame.
  try { renderer.render(scene, camera); } catch (_) {}
  // Tear down the warmups. removeAll() disposes the rig geometry +
  // materials per entity; loot.remove() returns the pool slot to
  // the idle queue without disposing (geometry is shared, material
  // stays compiled).
  try { gunmen.removeAll(); } catch (_) {}
  try { melees.removeAll(); } catch (_) {}
  for (const e of warmLootEntries) {
    if (e) { try { loot.remove(e); } catch (_) {} }
  }
  // FX teardown — pool-backed entries (flash dome, explosion fireball+
  // ring, sparks) get hidden + released; direct-allocated entries
  // (fire orbs, smoke / decoy / gas zone meshes) get fully disposed.
  try {
    for (const o of _fireOrbs) {
      scene.remove(o.mesh);
      if (o.kind !== 'tongue') o.mesh.geometry.dispose();
      o.mesh.material.dispose();
    }
    _fireOrbs.length = 0;
    _fireZones.length = 0;
    const disposeZone = (z) => {
      if (z.ring) { scene.remove(z.ring); z.ring.geometry.dispose(); z.ring.material.dispose(); }
      if (z.dome) { scene.remove(z.dome); z.dome.geometry.dispose(); z.dome.material.dispose(); }
      if (z.rod)  { scene.remove(z.rod);  z.rod.geometry.dispose();  z.rod.material.dispose(); }
    };
    for (const z of _smokeZones) disposeZone(z);
    _smokeZones.length = 0;
    for (const z of _decoys) disposeZone(z);
    _decoys.length = 0;
    for (const z of _gasZones) disposeZone(z);
    _gasZones.length = 0;
    for (const d of _flashDomes) {
      d.entry.mesh.visible = false;
      d.entry.inUse = false;
    }
    _flashDomes.length = 0;
    combat.clearAll?.();
  } catch (_) {}
  try { drones.removeAll(); } catch (_) {}
}
_warmShaders();
// Warmup is over — every shader the game routinely needs has been
// compiled + checked once. Disable getProgramInfoLog readback for
// any subsequent compiles so the synchronous GPU stall doesn't
// land mid-gameplay.
try { renderer.debug.checkShaderErrors = false; } catch (_) {}

// Background-preload every weapon's FBX model. First-time spawns of a
// new weapon class were paying the FBX parse + GPU upload cost on the
// gameplay frame the gunman was added — visible as a hitch the moment
// you walked into a sniper room. loadModel() caches by URL, so kicking
// the loads off here means subsequent `loadModelClone` calls hit the
// cache instantly. Uses dynamic import so the warmup doesn't add to
// the synchronous bundle's hot path.
(async () => {
  try {
    const mm = await import('./model_manifest.js');
    const gltf = await import('./gltf_cache.js');
    const seen = new Set();
    const enqueue = (url) => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      // Fire-and-forget; loadModel caches the parsed template under
      // the URL key so any later loadModelClone(url) is a synchronous
      // template.clone(true) instead of a fresh parse.
      gltf.loadModelClone(url).catch(() => {});
    };
    for (const w of (tunables.weapons || [])) enqueue(mm.modelForItem(w));
    // Small idle pause before priming the heavier non-weapon URLs so
    // the first frame the player sees can render before this finishes.
    await new Promise((r) => setTimeout(r, 250));
    for (const idTbl of [mm.MODEL_BY_ITEM_ID]) {
      if (!idTbl) continue;
      for (const id in idTbl) enqueue('Assets/models/' + idTbl[id]);
    }
  } catch (_) { /* preload best-effort */ }
})();

// Initial screen: the Hideout IS the main menu. Boot routes the
// player straight into the lobby — Tutorial / Leaderboard / Options
// are reachable via the ≡ button in the hideout header. The legacy
// MainMenuUI still exists for the Quit-to-title flow, but the
// landing page is no longer the splash card.
//
// Music kicks in on the first user interaction (browsers block
// AudioContext until then). Both listeners fire once and detach.
window.addEventListener('pointerdown', () => sfx.musicPlay?.('menu'), { once: true });
window.addEventListener('keydown',     () => sfx.musicPlay?.('menu'), { once: true });
if (inventory.pocketsGrid.isEmpty() && !inventory.equipment.backpack) {
  hideoutUI.open();
}
// Cursor-tracking bloom reticle. Hidden until a ranged weapon is
// equipped (toggled per-frame in tick).
initBloomReticle();
setBloomVisible(false);
requestAnimationFrame(tick);
