// Hideout — between-runs panel UI.
//
// Five tabs: Stash, Armorer, Contractor, Doctor, Mailbox.
//   Stash:        persistent gear grid (4-8 slots, expandable via chips).
//   Armorer: chip-buyable weapon unlocks gated by contract rank.
//   Contractor:   active contract pickup + status. Daily / weekly rolls.
//   Doctor:       v1 stub. Opens for hardcore wounded-extract heals later.
//   Mailbox:      v1 stub. Unlocks once the player has played a co-op session.
//
// The hideout is shown after a "cash out" extract (or after death from
// inside the run, before the run-reset wipes the screen). The player
// chooses to start a fresh run from here. State persists via prefs.js
// accessors — no in-memory caching.

import {
  getStash, setStash, stashAddItem, stashRemoveAt, STASH_SLOT_MIN, STASH_SLOT_MAX, stashNextSlotCost,
  getHideoutUpgrades, setHideoutUpgrades,
  getActiveContract, setActiveContract,
  getPersistentChips, setPersistentChips,
  getMarks, awardMarks, spendMarks, bumpContractRank, getContractRank, getMegabossKills,
  getSigils, awardSigils, spendSigils,
  getRelicPermits, setRelicPermitOwned, hasRelicPermit,
  getKeystoneQueue, queueKeystone, getOwnedKeystones, setKeystoneOwned,
  getRecruiterUnlocks, setRecruiterUnlocked, hasRecruiterUnlock,
  getPlayerName, setPlayerName, getCharacterStyle, setCharacterStyle,
  getCharacterAppearance, setCharacterAppearance, APPEARANCE_DEFAULTS,
  getUnlockedWeapons, unlockWeapon, isWeaponUnlocked,
  getSelectedStarterWeapon, setSelectedStarterWeapon,
  getStoreState, setStoreState,
  STORE_SLOT_MIN, STORE_SLOT_MAX, STORE_CEILING_MAX,
  storeNextSlotCost, storeNextCeilingCost, storeNextRefreshCost,
  getStarterInventory, addStarterInventoryItem, setStarterInventory,
  getPouchSlots, setPouchSlots, pouchNextSlotCost, POUCH_SLOT_MAX,
  getStartingStoreState, setStartingStoreState,
  getMerchantUpgrades, setMerchantUpgrade, merchantUpgradeNextCost, MERCHANT_KINDS, MERCHANT_UPGRADE_MAX,
  getRerollUnlocked, setRerollUnlocked, REROLL_UNLOCK_COST,
} from './prefs.js';
import { tunables } from './tunables.js';
import { HideoutScene } from './scene_hideout.js';
import {
  CONTRACT_DEFS, defForId, contractExpired,
  pickDailyContract, pickWeeklyContract, utcDayIndex, utcWeekIndex,
  liveProgressFor, tryClaimContract, isContractUnlocked, buildModifiers, difficultyScore,
} from './contracts.js';
import { iconForItem, inferRarity, rarityColor, CONSUMABLE_DEFS } from './inventory.js';

// Baseline starter-weapon roster — five always-free common picks,
// one per major class. Must match BASELINE_STARTER_NAMES in main.js.
const BASELINE_STARTERS = ['Makarov', 'M1911', 'PDW', 'SPCA3', 'Mini-14', 'Mossberg 500', 'Baton'];

// Pre-Run Store stock pool — temporary consumables only. Weapons
// live in the WEAPON UNLOCKS section under the armory; armor is a
// run-persistent slot, not a temporary boost. Everything here is
// "use it up during the run" gear: heals, ammo packs, run buffs.
const STORE_KINDS = [
  { kind: 'consumable', weight: 60 },
  { kind: 'ammo',       weight: 18 },
  { kind: 'buff',       weight: 22 },
];
const STORE_ARMOR_CATALOG = [
  { id: 'chest_med',          name: 'Combat Vest',     kind: 'armor', slot: 'chest',    rarity: 'uncommon', basePrice: 220 },
  { id: 'chest_heavy',        name: 'Heavy Plate',     kind: 'armor', slot: 'chest',    rarity: 'rare',     basePrice: 480 },
  { id: 'helmet_kevlar',      name: 'Kevlar Helmet',   kind: 'armor', slot: 'head',     rarity: 'uncommon', basePrice: 180 },
  { id: 'backpack_medium',    name: 'Medium Pack',     kind: 'armor', slot: 'backpack', rarity: 'uncommon', basePrice: 200 },
  { id: 'backpack_large',     name: 'Large Pack',      kind: 'armor', slot: 'backpack', rarity: 'rare',     basePrice: 420 },
];
const STORE_CONSUMABLE_CATALOG = [
  { id: 'medkit',  name: 'Medkit',  kind: 'consumable', rarity: 'common',   basePrice: 60,  qty: 2 },
  { id: 'bandage', name: 'Bandage', kind: 'consumable', rarity: 'common',   basePrice: 25,  qty: 3 },
  { id: 'stim',    name: 'Stim',    kind: 'consumable', rarity: 'uncommon', basePrice: 90,  qty: 1 },
];
const STORE_AMMO_CATALOG = [
  { id: 'ammo_pistol', name: 'Pistol Ammo Pack', kind: 'ammo', rarity: 'common', basePrice: 35 },
  { id: 'ammo_smg',    name: 'SMG Ammo Pack',    kind: 'ammo', rarity: 'common', basePrice: 35 },
  { id: 'ammo_rifle',  name: 'Rifle Ammo Pack',  kind: 'ammo', rarity: 'common', basePrice: 50 },
  { id: 'ammo_shotgun',name: 'Shotgun Shells',   kind: 'ammo', rarity: 'common', basePrice: 50 },
];
const STORE_BUFF_CATALOG = [
  { id: 'buff_speed', name: 'Energy Drink', kind: 'buff', rarity: 'common',   basePrice: 110, blurb: '+20% move speed, first 3 floors' },
  { id: 'buff_luck',  name: 'Lucky Coin',   kind: 'buff', rarity: 'uncommon', basePrice: 150, blurb: '+1 reroll at first relic merchant' },
  { id: 'buff_reload',name: 'Adrenaline',   kind: 'buff', rarity: 'common',   basePrice: 90,  blurb: '+30% reload, first floor' },
];
const RARITY_INDEX = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

const TAB_DEFS = [
  { id: 'stash',        label: 'STASH'         },
  { id: 'quartermaster',label: 'ARMORER' },
  { id: 'vendors',      label: 'VENDORS'       },
  { id: 'blackmarket',  label: 'BLACK MARKET'  },
  { id: 'contractor',   label: 'CONTRACTOR'    },
  { id: 'recruiter',    label: 'RECRUITER'     },
  { id: 'tailor',       label: 'TAILOR'        },
  { id: 'mailbox',      label: 'MAILBOX'       },
];

// Black Market — sigil-spend vendor. Permits unlock locked relics in
// the relic-merchant rotation; keystones apply run-modifier perks.
// Content can grow without schema changes — main.js reads
// hasRelicPermit / hasKeystone and adjusts run init accordingly.
// Permit ids match `permit_<artifact_id>`. The relic merchant
// filter strips the `permit_` prefix and checks the artifact's
// permitGated flag against the player's owned permit set.
export const RELIC_PERMITS = {
  permit_mourners_bell:  { id: 'permit_mourners_bell',  label: "Mourner's Bell",   blurb: '+30% incoming damage in exchange for higher mythic drop chance. Unlocks in relic merchant rotation.', cost: 8 },
  permit_iron_faith:     { id: 'permit_iron_faith',     label: 'Iron Faith',       blurb: '+15% damage reduction above 80% HP. Unlocks in relic merchant rotation.', cost: 8 },
  permit_vampires_mark:  { id: 'permit_vampires_mark',  label: "Vampire's Mark",   blurb: 'Ranged hits heal 4% of damage dealt. Unlocks in relic merchant rotation.', cost: 10 },
  permit_reapers_scythe: { id: 'permit_reapers_scythe', label: "Reaper's Scythe",  blurb: '+35% melee damage and longer execute range. Unlocks in relic merchant rotation.', cost: 10 },
};
export const KEYSTONES = {
  keystone_pain_drops:    { id: 'keystone_pain_drops',    label: 'Pain Drops',         blurb: 'Pain (mythic mace) can drop in the world this run.', cost: 12, oneShot: true },
  keystone_mythic_start:  { id: 'keystone_mythic_start',  label: 'Mythic Start',       blurb: 'Start your next run with a guaranteed mythic weapon offer.', cost: 18, oneShot: true },
  keystone_deep_run:      { id: 'keystone_deep_run',      label: 'Deep Run',           blurb: 'Start at floor 5 with +500 chips. One-shot.', cost: 15, oneShot: true },
  keystone_legendary_drop:{ id: 'keystone_legendary_drop',label: 'Legendary at Start', blurb: 'Start your next run with a guaranteed legendary weapon offer.', cost: 14, oneShot: true },
};

// Recruiter — marks-spent permanent unlocks. Each row is one-shot.
// Categories: stat tiers (capped per-tier), structural unlocks
// (NPCs, classes), and stash-slot expansions paid in marks instead
// of chips for players who go all-in on the death loop.
export const RECRUITER_UNLOCKS = {
  // Stat tiers — small per-purchase, capped at +30 max HP across the
  // three rows so curve stays bounded.
  vit_1:        { id: 'vit_1',        label: 'Vitality I',         blurb: '+10 max HP, permanent.', cost: 60 },
  vit_2:        { id: 'vit_2',        label: 'Vitality II',        blurb: '+10 max HP, permanent.', cost: 140, requires: ['vit_1'] },
  vit_3:        { id: 'vit_3',        label: 'Vitality III',       blurb: '+10 max HP, permanent.', cost: 280, requires: ['vit_2'] },
  end_1:        { id: 'end_1',        label: 'Endurance I',        blurb: '+10% stamina recovery, permanent.', cost: 80 },
  end_2:        { id: 'end_2',        label: 'Endurance II',       blurb: '+10% stamina recovery, permanent.', cost: 180, requires: ['end_1'] },
  comp_1:       { id: 'comp_1',       label: 'Composure I',        blurb: '−10% stagger duration, permanent.', cost: 90 },
  // Structural unlocks — NPCs and classes the run start UI gates on.
  npc_engineer:  { id: 'npc_engineer',  label: 'Engineer (NPC)',    blurb: 'Unlocks the Engineer in the hideout. Repairs gear between runs.', cost: 200 },
  npc_cartog:    { id: 'npc_cartog',    label: 'Cartographer (NPC)', blurb: 'Unlocks the Cartographer. Reveals layout hints for the next run.', cost: 350 },
  class_demolisher: { id: 'class_demolisher', label: 'Class: Demolisher', blurb: 'Unlocks Demolisher as a starting class.', cost: 260 },
  class_marksman:   { id: 'class_marksman',   label: 'Class: Marksman',   blurb: 'Unlocks Marksman as a starting class.', cost: 260 },
};

export class HideoutUI {
  // ctx fields:
  //   onClose() — invoked when the player clicks "Start New Run".
  //   awardChips(n) — chip-credit hook (mirrors main's awardPersistentChips).
  //   spendChips(n) — returns true on success, false on insufficient chips.
  //   getRunSurvivors() — returns the items the player extracted with
  //     this run (called when the hideout is opened post-extract). Items
  //     are auto-converted to chips here, except the ones the player
  //     drags into the stash.
  //   buildLoadout() — pulls items from stash into the run inventory at
  //     fresh-run start. Returns the items dragged out of stash.
  //   getRunEventsSnapshot() — passed-in helper that builds a snapshot
  //     of contract-relevant flags from the just-finished run.
  constructor(ctx) {
    this.ctx = ctx;
    this.visible = false;
    this.tab = 'stash';
    // Stash sub-tab state. 'take' is the default — picking a starter
    // weapon is the most common reason to visit the stash.
    this.stashSubTab = 'take';
    // Contractor stage flow:
    //   'home'        — host + Start New Run CTA (no cards)
    //   'cards'       — 3 wanted-poster cards visible
    //   'weapon'      — mission prep / stash / weapon loadout
    //   'leaderboard' — full-screen leaderboards list
    this.contractorStep = 'home';
    // Live-feed shuffle interval id — keeps the contract ticker
    // feeling alive. Cleared on hideout close + on tab change.
    this._feedIntervalId = 0;
    // Stable card-slot state — array of def IDs currently shown on
    // the cards step. Refilled on demand; swapped one slot at a
    // time when a contract is accepted.
    this._cardSlots = [];
    // Items that just came back from a run, awaiting bank-or-convert
    // decision. Set by openWithExtract(items).
    this._extractedQueue = [];
    // The most recent run-events snapshot, used for contract claim
    // evaluation when the hideout opens.
    this._lastRunSnapshot = null;

    this.root = document.createElement('div');
    this.root.id = 'hideout-root';
    this.root.style.display = 'none';
    document.body.classList.remove('hideout-active');
    this._stopFeedPulse();
    document.body.appendChild(this.root);
    this.root.addEventListener('mousedown', (e) => {
      // Don't dismiss on backdrop click — hideout is a destination,
      // not a modal popover. Only the explicit Start Run button exits.
      if (e.target === this.root) e.stopPropagation();
    });

    this._injectStyles();

    // Diegetic 3D scene — sits behind the panel UI. Lazy-init on
    // first show() so the GL context isn't created when the player
    // never opens the hideout. DEFAULT OFF — the panel-only flow is
    // the playable path; the diegetic scene is opt-in via a flag
    // until the polish pass lands. Set window.__hideoutDiegetic = true
    // to enable.
    this._scene = null;
    this._sceneRafId = 0;
    this._sceneLastT = 0;
  }

  _ensureScene() {
    // Diegetic 3D scene defaults OFF — design pivoted to 2D +
    // stylized art for the lobby. To re-enable for testing:
    // `window.__hideoutDiegetic = true; location.reload();`
    if (window.__hideoutDiegetic !== true) return null;
    if (!this._scene) {
      const renderer = this.ctx.getRenderer?.();
      if (!renderer) return null;
      try { this._scene = new HideoutScene({ renderer }); }
      catch (e) {
        console.warn('[hideout-scene] init failed, falling back to panel-only:', e);
        this._scene = null;
        window.__hideoutDiegetic = false;
        return null;
      }
    }
    return this._scene;
  }

  // No-op now — main.js's tick drives scene.update() when the
  // hideout is open. Kept as stubs so existing callers don't break.
  _startSceneLoop() {}
  _stopSceneLoop() {}

  // Build the unlock-state snapshot the scene reads to decide which
  // stations are bright vs. dark.
  _sceneUnlockState() {
    return {
      runCount: this.ctx.getRunCount?.() | 0,
      contractRank: getContractRank(),
      megabossKills: getMegabossKills(),
      marks: getMarks(),
      unlocks: getHideoutUpgrades(),
    };
  }

  // Run-end → hideout. Pass the player's extract inventory; those
  // items show up in the "extracted this run" panel where the player
  // can drag valuables into the stash. Anything left after they hit
  // Start Run is auto-converted to chips.
  openWithExtract(items, runSnapshot) {
    // Stop any in-run ambient bed before showing the hideout — the
    // 45 Hz sub drone leaking into the menu was part of why the
    // hideout felt "off."
    this.ctx.stopAmbient?.();
    this._extractedQueue = Array.isArray(items) ? items.slice() : [];
    this._lastRunSnapshot = runSnapshot || null;
    this._evaluateContractClaim();
    this.tab = 'contractor';
    this.contractorStep = 'home';
    this._currentGreeting = null;          // re-roll the host's opening line
    this.visible = true;
    document.body.classList.add('hideout-active');
    this.root.style.display = 'flex';
    const scene = this._ensureScene();
    if (scene) {
      scene.show(this._sceneUnlockState());
      scene.gotoStation('contracts', true);
      this._startSceneLoop();
    }
    this.render();
  }

  open() {
    this.ctx.stopAmbient?.();
    this._extractedQueue = [];
    this._lastRunSnapshot = null;
    this.tab = 'contractor';
    this.contractorStep = 'home';
    this._currentGreeting = null;          // re-roll the host's opening line
    this.visible = true;
    document.body.classList.add('hideout-active');
    this.root.style.display = 'flex';
    const scene = this._ensureScene();
    if (scene) {
      scene.show(this._sceneUnlockState());
      scene.gotoStation('contracts', true);
      this._startSceneLoop();
    }
    this.render();
  }

  close() {
    // Run-start gating — the player must have a weapon selected from
    // the Take-a-Weapon stash section before they can launch a run.
    // If they haven't, kick them to the stash with a transient hint
    // and let them pick one before they hit Start again.
    if (!getSelectedStarterWeapon()) {
      this.tab = 'stash';
      this.stashSubTab = 'take';
      if (this._scene) this._scene.gotoStation('stash');
      this._showHint('Pick a weapon to take into the run.');
      this.render();
      return;
    }
    // Auto-convert anything still in the extracted queue to chips at
    // a flat rate per item rarity.
    if (this._extractedQueue.length) {
      const total = this._extractedQueue.reduce((sum, it) => sum + this._chipValueOf(it), 0);
      this._extractedQueue.length = 0;
      if (total > 0 && this.ctx.awardChips) this.ctx.awardChips(total);
    }
    // Diegetic scene path: camera lerps to the exit door, fades to
    // black, then fires the run-start hook. Falls back to instant
    // run-start if the scene was disabled.
    this.root.style.display = 'none';
    document.body.classList.remove('hideout-active');
    this._stopFeedPulse();
    if (this._scene && window.__hideoutDiegetic === true) {
      this._scene.gotoStation('exitDoor');
      this._fadeOutAndRunStart();
    } else {
      this.visible = false;
      this._stopSceneLoop();
      this._scene?.hide();
      if (this.ctx.onClose) this.ctx.onClose();
    }
  }

  // Sys menu — small floating dropdown anchored to the header's ☰
  // button. Tutorial / Leaderboard / Options live here (used to be
  // the main menu landing page). Click outside dismisses.
  _toggleSysMenu() {
    let panel = document.getElementById('hideout-sysmenu-panel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = 'hideout-sysmenu-panel';
    Object.assign(panel.style, {
      position: 'fixed', top: '60px', left: '24px', zIndex: '210',
      background: '#1a1d24', border: '1px solid #5a8acf', borderRadius: '4px',
      padding: '8px 0', minWidth: '200px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    });
    const items = [
      { label: 'Tutorial', fn: () => this.ctx.onOpenTutorial?.() },
      { label: 'Leaderboard', fn: () => this.ctx.onOpenLeaderboard?.() },
      { label: 'Options', fn: () => this.ctx.onOpenSettings?.() },
    ];
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      Object.assign(b.style, {
        display: 'block', width: '100%', textAlign: 'left',
        padding: '8px 16px', background: 'transparent', border: 0,
        color: '#c9a87a', font: 'inherit', fontSize: '12px',
        letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer',
      });
      b.textContent = it.label;
      b.addEventListener('mouseenter', () => { b.style.background = '#2a2f3a'; b.style.color = '#e8dfc8'; });
      b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.color = '#c9a87a'; });
      b.addEventListener('click', () => {
        panel.remove();
        // Hide the hideout's panel so the sub-menu reads cleanly
        // (the existing MainMenuUI uses the full screen). Pre-stash
        // the open state so we can re-open the hideout when the
        // sub-modal closes.
        this.visible = false;
        this.root.style.display = 'none';
    document.body.classList.remove('hideout-active');
    this._stopFeedPulse();
        this._stopSceneLoop();
        this._scene?.hide();
        it.fn();
      });
      panel.appendChild(b);
    }
    document.body.appendChild(panel);
    // Click-outside dismiss.
    setTimeout(() => {
      const onAway = (ev) => {
        if (!panel.contains(ev.target)) {
          panel.remove();
          document.removeEventListener('mousedown', onAway, true);
        }
      };
      document.addEventListener('mousedown', onAway, true);
    }, 0);
  }

  // Global back-button — pinned to the SAME location on every
  // screen (hard rule). Use this everywhere instead of inline back
  // buttons so the player's eye never has to hunt for the exit.
  _renderBackButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'global-back-btn';
    btn.textContent = `◀ ${label}`;
    btn.addEventListener('click', onClick);
    return btn;
  }

  _showHint(msg) {
    let hint = document.getElementById('hideout-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'hideout-hint';
      Object.assign(hint.style, {
        position: 'fixed', top: '24px', left: '50%',
        transform: 'translateX(-50%)', zIndex: '200',
        background: '#1a1d24', border: '1px solid #f2c060',
        color: '#f2c060', padding: '8px 16px', borderRadius: '4px',
        fontSize: '12px', letterSpacing: '1px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      });
      document.body.appendChild(hint);
    }
    hint.textContent = msg;
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => hint.remove(), 2200);
  }

  _fadeOutAndRunStart() {
    let fade = document.getElementById('hideout-fade');
    if (!fade) {
      fade = document.createElement('div');
      fade.id = 'hideout-fade';
      Object.assign(fade.style, {
        position: 'fixed', inset: '0', background: '#000', opacity: '0',
        transition: 'opacity 0.4s ease-in', zIndex: '60', pointerEvents: 'none',
      });
      document.body.appendChild(fade);
    }
    // Wait for the camera to most-of-the-way arrive at the door
    // (lerp is 0.6s) before starting the fade. Then 0.4s fade.
    setTimeout(() => { fade.style.opacity = '1'; }, 500);
    setTimeout(() => {
      this.visible = false;
      this._stopSceneLoop();
      this._scene?.hide();
      if (this.ctx.onClose) this.ctx.onClose();
      // Hold the black for a moment, then fade in over the run.
      setTimeout(() => {
        fade.style.transition = 'opacity 0.6s ease-out';
        fade.style.opacity = '0';
        setTimeout(() => fade.remove(), 700);
      }, 200);
    }, 950);
  }

  isOpen() { return this.visible; }

  // Back-to-title — closes the hideout WITHOUT firing the
  // start-run path. Auto-converts queued extracted items to chips
  // (same as close()) so the player doesn't lose their loot, but
  // skips ctx.onClose entirely and routes through ctx.onExitToTitle.
  _exitToTitle() {
    if (this._extractedQueue.length) {
      const total = this._extractedQueue.reduce((sum, it) => sum + this._chipValueOf(it), 0);
      this._extractedQueue.length = 0;
      if (total > 0 && this.ctx.awardChips) this.ctx.awardChips(total);
    }
    this.visible = false;
    this.root.style.display = 'none';
    document.body.classList.remove('hideout-active');
    this._stopFeedPulse();
    this._stopSceneLoop();
    this._scene?.hide();
    if (this.ctx.onExitToTitle) this.ctx.onExitToTitle();
    else if (this.ctx.onClose) this.ctx.onClose();
  }

  // Quick-start — close the hideout and route through ctx.onQuickStart
  // which uses last-played class instead of the class picker.
  _quickStart() {
    if (this._extractedQueue.length) {
      const total = this._extractedQueue.reduce((sum, it) => sum + this._chipValueOf(it), 0);
      this._extractedQueue.length = 0;
      if (total > 0 && this.ctx.awardChips) this.ctx.awardChips(total);
    }
    this.visible = false;
    this.root.style.display = 'none';
    document.body.classList.remove('hideout-active');
    this._stopFeedPulse();
    this._stopSceneLoop();
    this._scene?.hide();
    if (this.ctx.onQuickStart) this.ctx.onQuickStart();
    else if (this.ctx.onClose) this.ctx.onClose();
  }

  _chipValueOf(item) {
    // Conversion rate: rarity-keyed chip payout. Mirrors the spirit of
    // tunables.currency.basePrice but at chip scale (much smaller).
    const r = inferRarity(item) || item.rarity || 'common';
    return ({
      common: 4, uncommon: 12, rare: 35, epic: 90, legendary: 220, mythic: 600,
    })[r] || 4;
  }

  _evaluateContractClaim() {
    const ac = getActiveContract();
    if (!ac || (ac.claimedAt | 0) > 0) return;
    if (!this._lastRunSnapshot) return;
    const result = tryClaimContract(
      ac,
      this._lastRunSnapshot,
      setActiveContract,
      (n) => { if (this.ctx.awardChips) this.ctx.awardChips(n); },
      (n) => awardMarks(n),
      () => bumpContractRank(),
      (n) => awardSigils(n),
    );
    this._lastClaim = result;
  }

  // ----- Render ------------------------------------------------------
  render() {
    try {
      this._renderInner();
    } catch (e) {
      // Defensive — if anything in the render tree throws, surface a
      // visible error card instead of a blank panel so the player
      // can see something failed and the game isn't silently frozen.
      console.error('[hideout-render] failed:', e);
      this.root.innerHTML = '';
      const err = document.createElement('div');
      Object.assign(err.style, {
        margin: 'auto', padding: '24px',
        background: '#1a1d24', border: '1px solid #d24868',
        borderRadius: '6px', color: '#e8dfc8', maxWidth: '600px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '12px', lineHeight: '1.6',
      });
      err.innerHTML = `
        <div style="color:#d24868; font-weight:700; margin-bottom:8px;">HIDEOUT RENDER FAILED</div>
        <div style="margin-bottom:12px; color:#c9a87a;">${(e?.message || String(e)).replace(/</g, '&lt;')}</div>
        <button id="hideout-err-back" type="button" style="background:#2a2f3a;border:1px solid #4a505a;color:#e8dfc8;padding:6px 14px;cursor:pointer;border-radius:3px;">Back to Title</button>
      `;
      this.root.appendChild(err);
      err.querySelector('#hideout-err-back').addEventListener('click', () => this._exitToTitle());
    }
  }
  _renderInner() {
    if (!this.visible) return;
    this.root.innerHTML = '';

    const chips = getPersistentChips();
    const marks = getMarks();
    const sigils = getSigils();

    // ── Top bar — floats over the top edge with ☰, title, wallets.
    const topbar = document.createElement('div');
    topbar.id = 'hideout-topbar';
    topbar.innerHTML = `
      <button id="hideout-sysmenu" type="button" title="Tutorial / Leaderboard / Options">☰</button>
      <div id="hideout-title">COLD EXIT</div>
      <div id="hideout-wallets">
        <span class="wallet"><span class="lbl">CHIPS</span> <b>${chips}</b></span>
        <span class="wallet"><span class="lbl">MARKS</span> <b>${marks}</b></span>
        ${sigils > 0 ? `<span class="wallet sigils"><span class="lbl">SIGILS</span> <b>${sigils}</b></span>` : ''}
      </div>
    `;
    topbar.querySelector('#hideout-sysmenu').addEventListener('click', () => this._toggleSysMenu());
    this.root.appendChild(topbar);

    // ── Bottom-right action cluster — Quick Start + Start New Run.
    // Hidden on the contractor tab because the stage owns its own
    // run-start CTA (the big golden button).
    if (this.tab !== 'contractor') {
      const actions = document.createElement('div');
      actions.id = 'hideout-actions';
      actions.innerHTML = `
        <button id="hideout-quickstart" type="button" title="Last-class quick run">Quick Start</button>
        <button id="hideout-startrun" type="button">Start New Run ▶</button>
      `;
      actions.querySelector('#hideout-startrun').addEventListener('click', () => this.close());
      actions.querySelector('#hideout-quickstart').addEventListener('click', () => this._quickStart());
      this.root.appendChild(actions);
    }

    // ── Bottom-left vertical tab strip. Always visible — the player
    // needs to be able to navigate to the Armorer / Vendors / etc. from
    // any stage, including mid-mission-prep.
    {
    const tabs = document.createElement('div');
    tabs.id = 'hideout-tabs';
    const tabToStation = {
      stash: 'stash',
      quartermaster: 'quartermaster',
      vendors: 'vendors',
      contractor: 'contracts',
      recruiter: 'recruiter',
      tailor: 'tailor',
      mailbox: 'mailbox',
    };
    for (const t of TAB_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `hideout-tab${this.tab === t.id ? ' active' : ''}`;
      btn.textContent = t.label;
      btn.addEventListener('click', () => {
        const fromTab = this.tab;
        this.tab = t.id;
        if (t.id === 'contractor') {
          this.contractorStep = 'home';
          // Re-roll the opening line whenever the player walks back
          // into the contracts office from another station.
          if (fromTab !== 'contractor') this._currentGreeting = null;
        }
        const stationId = tabToStation[t.id];
        if (stationId && this._scene) this._scene.gotoStation(stationId);
        this.render();
      });
      tabs.appendChild(btn);
    }
    this.root.appendChild(tabs);
    }

    // ── Floating content panel anchored to the right side. Takes
    //    ~half the viewport so the diegetic scene stays visible on
    //    the left. Hosts whatever tab is active.
    const panel = document.createElement('div');
    panel.id = 'hideout-panel';
    if (this.tab === 'stash')              panel.appendChild(this._renderStashTab());
    else if (this.tab === 'quartermaster') panel.appendChild(this._renderQuartermasterTab());
    else if (this.tab === 'vendors')       panel.appendChild(this._renderVendorsTab());
    else if (this.tab === 'blackmarket')   panel.appendChild(this._renderBlackMarketTab());
    else if (this.tab === 'contractor')    panel.appendChild(this._renderContractorTab());
    else if (this.tab === 'recruiter')     panel.appendChild(this._renderRecruiterTab());
    else if (this.tab === 'tailor')        panel.appendChild(this._renderTailorTab());
    else if (this.tab === 'mailbox')       panel.appendChild(this._renderMailboxTab());
    this.root.appendChild(panel);
  }

  // ----- Stash -------------------------------------------------------
  // Three sub-sections + paperdoll preview:
  //   TAKE     — pick which weapon you take into the next run (baseline 5
  //              + chip-unlocked). Primary UI element of the stash.
  //   ARMORY   — chip purchase to permanently unlock locked weapons.
  //              Each unlock adds the weapon to your stash AND flips its
  //              `worldDrop` flag so it starts dropping in chests.
  //   STORE    — rotating Pre-Run Store (4h refresh, price jitter).
  //              Buy → goes into next-run starter inventory → consumed.
  //   BANK     — extracted items + persistent stash grid (the original).
  // Right column: paperdoll showing the next-run loadout (selected
  // weapon + queued starter inventory + auto-equip preview).
  _renderStashTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body hideout-stash-root';

    // 'armory' sub-tab moved to its own top-level ARMORER tab so the
    // player has a single place to spend chips on weapon unlocks.
    const SUB_TABS = [
      { id: 'take',   label: 'TAKE A WEAPON' },
      { id: 'store',  label: 'PRE-RUN STORE' },
      { id: 'bank',   label: 'BANK' },
    ];
    if (this.stashSubTab === 'armory') this.stashSubTab = 'take';
    const subBar = document.createElement('div');
    subBar.className = 'hideout-substabs';
    for (const t of SUB_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `hideout-subtab${this.stashSubTab === t.id ? ' active' : ''}`;
      b.textContent = t.label;
      b.addEventListener('click', () => { this.stashSubTab = t.id; this.render(); });
      subBar.appendChild(b);
    }
    wrap.appendChild(subBar);

    const cols = document.createElement('div');
    cols.className = 'hideout-stash-twocol';
    // Left column — sub-section content.
    const leftCol = document.createElement('div');
    leftCol.className = 'hideout-stash-leftcol';
    if (this.stashSubTab === 'take')        leftCol.appendChild(this._renderTakeSection());
    else if (this.stashSubTab === 'store')  leftCol.appendChild(this._renderStoreSection());
    else if (this.stashSubTab === 'bank')   leftCol.appendChild(this._renderBankSection());
    cols.appendChild(leftCol);
    // Right column — paperdoll preview of next-run loadout.
    const rightCol = document.createElement('div');
    rightCol.className = 'hideout-paperdoll-col';
    rightCol.appendChild(this._renderPaperdoll());
    cols.appendChild(rightCol);
    wrap.appendChild(cols);
    return wrap;
  }

  // ----- TAKE A WEAPON section --------------------------------------
  _renderTakeSection() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-stash-section';
    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">TAKE A WEAPON</div>
      <div class="hideout-section-sub">Click a weapon to take it on your next run. Always free, always infinite.</div>
    `;
    wrap.appendChild(head);

    const unlocked = getUnlockedWeapons();
    const baselineSet = new Set(BASELINE_STARTERS);
    const available = tunables.weapons.filter(w =>
      !w.mythic && w.rarity !== 'mythic'
      && (baselineSet.has(w.name) || unlocked.has(w.name)));
    const selected = getSelectedStarterWeapon();

    // Group by class for readability.
    const byClass = {};
    for (const w of available) {
      const c = w.class || 'other';
      (byClass[c] = byClass[c] || []).push(w);
    }
    const order = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'lmg', 'melee', 'exotic', 'other'];
    for (const cls of order) {
      const list = byClass[cls];
      if (!list?.length) continue;
      const sec = document.createElement('div');
      sec.className = 'hideout-take-classgroup';
      sec.innerHTML = `<div class="hideout-take-classlabel">${cls.toUpperCase()}</div>`;
      const row = document.createElement('div');
      row.className = 'hideout-take-row';
      for (const w of list) {
        row.appendChild(this._buildTakeTile(w, selected === w.name, baselineSet.has(w.name)));
      }
      sec.appendChild(row);
      wrap.appendChild(sec);
    }
    if (!available.length) {
      const p = document.createElement('div');
      p.className = 'hideout-placeholder';
      p.textContent = 'No weapons available. Visit the Armory to unlock more.';
      wrap.appendChild(p);
    }
    return wrap;
  }

  _buildTakeTile(weapon, isSelected, isBaseline) {
    const tile = document.createElement('div');
    tile.className = `hideout-take-tile${isSelected ? ' selected' : ''}`;
    tile.style.borderColor = rarityColor({ rarity: weapon.rarity });
    const icon = iconForItem({ name: weapon.name, type: weapon.type });
    const tag = isBaseline ? 'BASELINE' : 'UNLOCKED';
    tile.innerHTML = `
      ${icon ? `<img class="hideout-take-icon" src="${icon}" alt="">` : '<div class="hideout-take-icon-fallback"></div>'}
      <div class="hideout-take-name">${(weapon.name || '').replace(/<[^>]+>/g, '')}</div>
      <div class="hideout-take-meta">${weapon.fireMode || weapon.type || ''} · ${weapon.rarity || 'common'}</div>
      <div class="hideout-take-tag">${tag}</div>
    `;
    tile.addEventListener('click', () => {
      setSelectedStarterWeapon(isSelected ? null : weapon.name);
      this.render();
    });
    return tile;
  }

  // ----- PRE-RUN STORE section -------------------------------------
  _renderStoreSection() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-stash-section';
    const state = this._getOrRefreshStore();

    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    const elapsed = Math.max(0, Date.now() - state.lastRefreshAt);
    const remaining = Math.max(0, state.refreshMs - elapsed);
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    head.innerHTML = `
      <div class="hideout-section-title">PRE-RUN STORE</div>
      <div class="hideout-section-sub">Rotating stock. Refreshes in <b>${hours}h ${minutes}m</b>. Items consumed on next run start.</div>
    `;
    wrap.appendChild(head);

    // Stock grid.
    const grid = document.createElement('div');
    grid.className = 'hideout-store-grid';
    for (let i = 0; i < state.stock.length; i++) {
      grid.appendChild(this._buildStoreSlotTile(state.stock[i], i));
    }
    wrap.appendChild(grid);

    // Upgrade rows.
    const upgWrap = document.createElement('div');
    upgWrap.style.marginTop = '14px';
    upgWrap.innerHTML = `<div class="hideout-tier-head"><span class="t" style="color:#c9a87a">UPGRADES</span></div>`;
    upgWrap.appendChild(this._buildStoreUpgradeRow(
      `Stock size — currently ${state.slots} / ${STORE_SLOT_MAX}`,
      storeNextSlotCost(state.slots),
      () => {
        const cost = storeNextSlotCost(state.slots);
        if (cost == null || !this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
        const s = getStoreState();
        setStoreState({ ...s, slots: Math.min(STORE_SLOT_MAX, s.slots + 1) });
        this._refreshStore(true);
        this.render();
      }));
    upgWrap.appendChild(this._buildStoreUpgradeRow(
      `Rarity ceiling — ${['common only', 'common+uncommon', 'up to rare', 'up to epic', 'up to legendary'][state.ceiling]}`,
      storeNextCeilingCost(state.ceiling),
      () => {
        const cost = storeNextCeilingCost(state.ceiling);
        if (cost == null || !this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
        const s = getStoreState();
        setStoreState({ ...s, ceiling: Math.min(STORE_CEILING_MAX, s.ceiling + 1) });
        this.render();
      }));
    upgWrap.appendChild(this._buildStoreUpgradeRow(
      `Refresh cadence — currently every ${(state.refreshMs / 3600000).toFixed(0)}h`,
      storeNextRefreshCost(state.refreshMs),
      () => {
        const cost = storeNextRefreshCost(state.refreshMs);
        if (cost == null || !this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
        const s = getStoreState();
        const tiers = [4 * 3600000, 3 * 3600000, 2 * 3600000, 1 * 3600000];
        const idx = tiers.findIndex(t => t < s.refreshMs);
        const next = idx >= 0 ? tiers[idx] : s.refreshMs;
        setStoreState({ ...s, refreshMs: next });
        this.render();
      }));
    wrap.appendChild(upgWrap);
    return wrap;
  }

  _buildStoreUpgradeRow(label, cost, onBuy) {
    const row = document.createElement('div');
    row.className = 'hideout-upgrade-row';
    if (cost == null) {
      row.innerHTML = `<span>${label}</span><span class="muted">MAX</span>`;
      return row;
    }
    row.innerHTML = `
      <span>${label}</span>
      <button type="button" class="hideout-buy">${cost}c</button>
    `;
    const btn = row.querySelector('.hideout-buy');
    btn.disabled = getPersistentChips() < cost;
    btn.addEventListener('click', onBuy);
    return row;
  }

  _buildStoreSlotTile(slot, idx) {
    const tile = document.createElement('div');
    tile.className = 'hideout-store-slot';
    if (!slot) {
      tile.classList.add('empty');
      tile.textContent = '—';
      return tile;
    }
    if (slot.sold) {
      tile.classList.add('sold');
      tile.innerHTML = `
        <div class="hideout-store-name">${slot.label}</div>
        <div class="hideout-store-status">SOLD</div>
      `;
      return tile;
    }
    tile.style.borderColor = rarityColor({ rarity: slot.rarity });
    tile.innerHTML = `
      <div class="hideout-store-kind">${(slot.kind || '').toUpperCase()}</div>
      <div class="hideout-store-name">${slot.label}</div>
      <div class="hideout-store-meta">${slot.rarity || 'common'}${slot.qty > 1 ? ` ·×${slot.qty}` : ''}</div>
      <div class="hideout-store-actions">
        <button type="button" class="hideout-buy">${slot.price}c</button>
      </div>
    `;
    const btn = tile.querySelector('.hideout-buy');
    btn.disabled = getPersistentChips() < slot.price;
    btn.addEventListener('click', () => this._buyStoreSlot(idx));
    return tile;
  }

  _buyStoreSlot(idx) {
    const state = getStoreState();
    const slot = state.stock[idx];
    if (!slot || slot.sold) return;
    if (!this.ctx.spendChips || !this.ctx.spendChips(slot.price)) return;
    // Build the actual run-inventory item from the slot blueprint.
    const item = this._materializeStoreItem(slot);
    if (item) {
      // qty > 1 → stamp qty out as multiple inventory items.
      const n = Math.max(1, slot.qty | 0 || 1);
      for (let i = 0; i < n; i++) addStarterInventoryItem({ ...item });
    }
    slot.sold = true;
    setStoreState(state);
    this.render();
  }

  // Translate a store stock entry (which carries kind/id/rarity) into
  // the actual inventory item that startNewRun will consume. Weapons
  // become wrapped weapon defs; armor pulls from ARMOR_DEFS via the
  // inventory module; consumables/buffs are kept as light shape items.
  _materializeStoreItem(slot) {
    if (slot.kind === 'weapon') {
      const def = tunables.weapons.find(w => w.name === slot.id);
      if (!def) return null;
      // Wrap to inventory shape with the slot's selected rarity.
      // Mirrors wrapWeapon() loosely — full wrapping happens on the
      // run side; here we ship the def + rarity + flag fields so the
      // consumer side can `wrapWeapon(def, { rarity: ... })`.
      return { __storeWeapon: true, defName: def.name, rarity: slot.rarity || 'common' };
    }
    if (slot.kind === 'armor') {
      // Marker — main.js will resolve via ARMOR_DEFS at consume time.
      return { __storeArmor: true, defId: slot.id, rarity: slot.rarity || 'common', slot: slot.armorSlot || null };
    }
    if (slot.kind === 'consumable') {
      return { __storeConsumable: true, defId: slot.id, rarity: slot.rarity || 'common' };
    }
    if (slot.kind === 'ammo') {
      return { __storeAmmo: true, defId: slot.id, rarity: slot.rarity || 'common' };
    }
    if (slot.kind === 'buff') {
      return { __storeBuff: true, defId: slot.id, rarity: slot.rarity || 'common', blurb: slot.blurb || '' };
    }
    return null;
  }

  // Returns the current store state, refreshing stock if the timer
  // elapsed since the last refresh.
  _getOrRefreshStore() {
    const state = getStoreState();
    if (Date.now() - state.lastRefreshAt >= state.refreshMs || !state.stock.length) {
      this._refreshStore();
      return getStoreState();
    }
    return state;
  }

  _refreshStore(force = false) {
    const state = getStoreState();
    if (!force && Date.now() - state.lastRefreshAt < state.refreshMs) return;
    const stock = [];
    for (let i = 0; i < state.slots; i++) {
      stock.push(this._rollStoreSlot(state.ceiling));
    }
    setStoreState({
      ...state,
      stock,
      lastRefreshAt: Date.now(),
    });
  }

  _rollStoreSlot(ceiling) {
    // Pick a kind by weight.
    const totalWeight = STORE_KINDS.reduce((s, k) => s + k.weight, 0);
    let r = Math.random() * totalWeight;
    let kind = 'consumable';
    for (const k of STORE_KINDS) { if ((r -= k.weight) <= 0) { kind = k.kind; break; } }
    // Sample inside that kind, biased by ceiling.
    const ceilingMax = Math.min(ceiling, RARITY_INDEX.legendary);
    const _withinCeiling = (rarity) => (RARITY_INDEX[rarity] ?? 0) <= ceilingMax;

    const jitterPrice = (base) => {
      const j = 0.8 + Math.random() * 0.5;       // 0.8..1.3
      return Math.max(1, Math.round(base * j));
    };

    if (kind === 'weapon') {
      const all = tunables.weapons.filter(w =>
        !w.artifact && !w.mythic && w.rarity !== 'mythic'
        && _withinCeiling(w.rarity || 'common'));
      if (!all.length) return null;
      const def = all[Math.floor(Math.random() * all.length)];
      const basePrice = ({ common: 80, uncommon: 180, rare: 420, epic: 1000, legendary: 2400 })[def.rarity || 'common'] || 80;
      return {
        kind: 'weapon',
        id: def.name,
        label: def.name,
        rarity: def.rarity || 'common',
        price: jitterPrice(basePrice),
        qty: 1,
        sold: false,
      };
    }
    if (kind === 'armor') {
      const pool = STORE_ARMOR_CATALOG.filter(e => _withinCeiling(e.rarity));
      const e = pool[Math.floor(Math.random() * pool.length)] || STORE_ARMOR_CATALOG[0];
      return {
        kind: 'armor', id: e.id, label: e.name, rarity: e.rarity,
        armorSlot: e.slot,
        price: jitterPrice(e.basePrice), qty: 1, sold: false,
      };
    }
    if (kind === 'consumable') {
      const pool = STORE_CONSUMABLE_CATALOG.filter(e => _withinCeiling(e.rarity));
      const e = pool[Math.floor(Math.random() * pool.length)] || STORE_CONSUMABLE_CATALOG[0];
      return {
        kind: 'consumable', id: e.id, label: e.name, rarity: e.rarity,
        price: jitterPrice(e.basePrice), qty: e.qty || 1, sold: false,
      };
    }
    if (kind === 'ammo') {
      const e = STORE_AMMO_CATALOG[Math.floor(Math.random() * STORE_AMMO_CATALOG.length)];
      return {
        kind: 'ammo', id: e.id, label: e.name, rarity: e.rarity,
        price: jitterPrice(e.basePrice), qty: 1, sold: false,
      };
    }
    if (kind === 'buff') {
      const pool = STORE_BUFF_CATALOG.filter(e => _withinCeiling(e.rarity));
      const e = pool[Math.floor(Math.random() * pool.length)] || STORE_BUFF_CATALOG[0];
      return {
        kind: 'buff', id: e.id, label: e.name, rarity: e.rarity,
        blurb: e.blurb,
        price: jitterPrice(e.basePrice), qty: 1, sold: false,
      };
    }
    return null;
  }

  // ----- BANK section (legacy stash grid + extracted items) --------
  _renderBankSection() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-stash-section';
    const upg = getHideoutUpgrades();
    const stash = getStash();
    const used = new Set(stash.map(e => e.slot | 0));

    const cols = document.createElement('div');
    cols.className = 'hideout-stash-cols';

    const leftCol = document.createElement('div');
    leftCol.className = 'hideout-stash-col';
    const leftTitle = document.createElement('div');
    leftTitle.className = 'hideout-col-title';
    leftTitle.textContent = this._extractedQueue.length
      ? `EXTRACTED — ${this._extractedQueue.length} items (auto-convert to chips on exit)`
      : 'EXTRACTED — (no run finished)';
    leftCol.appendChild(leftTitle);
    const leftList = document.createElement('div');
    leftList.className = 'hideout-extract-list';
    if (!this._extractedQueue.length) {
      const p = document.createElement('div');
      p.className = 'hideout-placeholder';
      p.textContent = 'Items you extract from a run will appear here.';
      leftList.appendChild(p);
    }
    for (let i = 0; i < this._extractedQueue.length; i++) {
      leftList.appendChild(this._buildExtractedTile(this._extractedQueue[i], i, upg.stashSlots, used));
    }
    leftCol.appendChild(leftList);
    cols.appendChild(leftCol);

    const rightCol = document.createElement('div');
    rightCol.className = 'hideout-stash-col';
    const rightTitle = document.createElement('div');
    rightTitle.className = 'hideout-col-title';
    rightTitle.textContent = `STASH — ${stash.length} / ${upg.stashSlots} slots`;
    rightCol.appendChild(rightTitle);
    const grid = document.createElement('div');
    grid.className = 'hideout-stash-grid';
    for (let s = 0; s < upg.stashSlots; s++) {
      const slot = document.createElement('div');
      slot.className = 'hideout-stash-slot';
      const entry = stash.find(e => (e.slot | 0) === s);
      if (entry) {
        slot.appendChild(this._buildStashTile(entry.item, entry.slot));
      } else {
        slot.classList.add('empty');
        slot.textContent = '—';
      }
      grid.appendChild(slot);
    }
    rightCol.appendChild(grid);

    const upgRow = document.createElement('div');
    upgRow.className = 'hideout-upgrade-row';
    const nextCost = stashNextSlotCost(upg.stashSlots);
    if (nextCost == null) {
      upgRow.innerHTML = `<span class="muted">Stash at maximum (${STASH_SLOT_MAX} slots).</span>`;
    } else {
      upgRow.innerHTML = `
        <span>Buy slot #${upg.stashSlots + 1}: <b>${nextCost}</b> chips</span>
        <button type="button" class="hideout-buy">Buy</button>
      `;
      const btn = upgRow.querySelector('.hideout-buy');
      btn.disabled = getPersistentChips() < nextCost;
      btn.addEventListener('click', () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(nextCost)) return;
        const u = getHideoutUpgrades();
        setHideoutUpgrades({ ...u, stashSlots: Math.min(STASH_SLOT_MAX, u.stashSlots + 1) });
        this.render();
      });
    }
    rightCol.appendChild(upgRow);
    cols.appendChild(rightCol);
    wrap.appendChild(cols);
    return wrap;
  }

  // ----- Paperdoll preview ------------------------------------------
  // Right-column summary of what the player will start the next run
  // with: selected primary weapon, queued starter inventory, baseline
  // armor (placeholder until a future "default loadout" feature). The
  // queued starter inventory list also exposes a 'remove' button per
  // entry so over-buys can be undone before the run starts.
  _renderPaperdoll() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-paperdoll';
    wrap.innerHTML = `<div class="hideout-paperdoll-title">NEXT RUN LOADOUT</div>`;

    // Primary weapon row.
    const selected = getSelectedStarterWeapon();
    const wpnRow = document.createElement('div');
    wpnRow.className = 'hideout-paperdoll-row';
    if (selected) {
      const def = tunables.weapons.find(w => w.name === selected);
      wpnRow.innerHTML = `
        <span class="lbl">PRIMARY</span>
        <span class="val" style="color:${rarityColor({ rarity: def?.rarity })}">${selected}</span>
      `;
    } else {
      wpnRow.innerHTML = `<span class="lbl">PRIMARY</span><span class="val muted">— class default —</span>`;
    }
    wrap.appendChild(wpnRow);

    // Queued starter inventory.
    const queue = getStarterInventory();
    const qHead = document.createElement('div');
    qHead.className = 'hideout-paperdoll-row';
    qHead.innerHTML = `<span class="lbl">STARTER PACK</span><span class="val">${queue.length} items</span>`;
    wrap.appendChild(qHead);
    if (!queue.length) {
      const p = document.createElement('div');
      p.className = 'hideout-paperdoll-empty';
      p.textContent = 'Buy from the Pre-Run Store to add items here.';
      wrap.appendChild(p);
    } else {
      for (let i = 0; i < queue.length; i++) {
        wrap.appendChild(this._buildPaperdollEntry(queue[i], i));
      }
    }
    return wrap;
  }

  _buildPaperdollEntry(item, idx) {
    const row = document.createElement('div');
    row.className = 'hideout-paperdoll-entry';
    let label = 'item';
    let kind = 'item';
    if (item.__storeWeapon) { label = item.defName; kind = 'WPN'; }
    else if (item.__storeArmor) { label = item.defId; kind = 'ARM'; }
    else if (item.__storeConsumable) { label = item.defId; kind = 'CON'; }
    else if (item.__storeAmmo) { label = item.defId; kind = 'AMM'; }
    else if (item.__storeBuff) { label = item.defId; kind = 'BUF'; }
    row.innerHTML = `
      <span class="kind">${kind}</span>
      <span class="name">${label}</span>
      <button type="button" class="rem" title="Remove">×</button>
    `;
    row.querySelector('.rem').addEventListener('click', () => {
      const cur = getStarterInventory();
      cur.splice(idx, 1);
      setStarterInventory(cur);
      this.render();
    });
    return row;
  }

  _buildExtractedTile(item, idx, slotCap, usedSlots) {
    const tile = document.createElement('div');
    tile.className = 'hideout-extract-tile';
    const r = inferRarity(item) || item.rarity || 'common';
    tile.style.borderColor = rarityColor(item);
    const value = this._chipValueOf(item);
    tile.innerHTML = `
      <div class="hideout-extract-name">${(item.name || 'item').replace(/<[^>]+>/g, '')}</div>
      <div class="hideout-extract-meta">${r.toUpperCase()} · ${value}c on convert</div>
      <div class="hideout-extract-actions">
        <button type="button" class="bank">Bank to Stash</button>
      </div>
    `;
    const btn = tile.querySelector('.bank');
    // Bank disabled if stash is full.
    const stashFull = usedSlots.size >= slotCap;
    btn.disabled = stashFull;
    if (stashFull) btn.title = 'Stash is full. Sell an item or buy more slots.';
    btn.addEventListener('click', () => {
      const slot = stashAddItem(item, slotCap);
      if (slot < 0) return;
      this._extractedQueue.splice(idx, 1);
      this.render();
    });
    return tile;
  }

  _buildStashTile(item, slot) {
    const tile = document.createElement('div');
    tile.className = 'hideout-stash-tile';
    tile.style.borderColor = rarityColor(item);
    const icon = iconForItem(item);
    tile.innerHTML = `
      ${icon ? `<img class="hideout-stash-icon" src="${icon}" alt="">` : ''}
      <div class="hideout-stash-name">${(item.name || 'item').replace(/<[^>]+>/g, '')}</div>
      <div class="hideout-stash-actions">
        <button type="button" class="sell">Sell (${this._chipValueOf(item)}c)</button>
      </div>
    `;
    const sellBtn = tile.querySelector('.sell');
    sellBtn.addEventListener('click', () => {
      const removed = stashRemoveAt(slot);
      if (!removed) return;
      if (this.ctx.awardChips) this.ctx.awardChips(this._chipValueOf(removed));
      this.render();
    });
    return tile;
  }

  // ----- Armorer ----------------------------------------------------
  // Single home for chip-buy weapon unlocks. Was previously split
  // across Mission Prep's LOCKED column and Stash > Armory; both have
  // been removed in favor of this tab. The legacy random-roll feature
  // (buy a guaranteed weapon at a rarity floor) is deferred for now —
  // the storage key is still 'quartermaster' so saved tier upgrades
  // don't get clobbered when the roll comes back.
  _renderQuartermasterTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';

    const unlocked = getUnlockedWeapons();
    const lockedAll = tunables.weapons.filter(w =>
      !w.mythic && w.rarity !== 'mythic'
      && !w.artifact && !w.encounterOnly && !w.pactReward
      && (w.worldDrop === false || (w.unlockRank | 0) > 0)
      && !unlocked.has(w.name));

    const RARITY_COSTS = { common: 150, uncommon: 350, rare: 800, epic: 2000, legendary: 5000 };
    const BUYABLE_RANK = { common: 0, uncommon: 2, rare: 5, epic: 10, legendary: 18 };
    const RARITY_RANK = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };
    const reqRankFor = (w) => (w.unlockRank | 0) > 0
      ? (w.unlockRank | 0)
      : (BUYABLE_RANK[w.rarity || 'common'] ?? 0);
    const costFor = (w) => (w.unlockCost | 0) > 0
      ? (w.unlockCost | 0)
      : (RARITY_COSTS[w.rarity || 'common'] || 150);
    const rank = getContractRank();
    const isBuyable = (w) => rank >= reqRankFor(w);
    const reqRankSort = (a, b) => {
      const ar = reqRankFor(a);
      const br = reqRankFor(b);
      if (ar !== br) return ar - br;
      const arr = RARITY_RANK[a.rarity || 'common'] ?? 5;
      const brr = RARITY_RANK[b.rarity || 'common'] ?? 5;
      if (arr !== brr) return arr - brr;
      const ac = (a.class || '').localeCompare(b.class || '');
      if (ac !== 0) return ac;
      return (a.name || '').localeCompare(b.name || '');
    };

    const buyable = [];
    const stillLocked = [];
    for (const w of lockedAll) (isBuyable(w) ? buyable : stillLocked).push(w);
    buyable.sort(reqRankSort);
    stillLocked.sort(reqRankSort);

    const totalUnlockable = unlocked.size + lockedAll.length;
    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">ARMORER</div>
      <div class="hideout-section-sub">Rank <b>${rank}</b> · <b>${unlocked.size}</b> / ${totalUnlockable} weapons unlocked. Spend chips to permanently add a weapon to your stash.</div>
    `;
    wrap.appendChild(head);

    // ---- BUYABLE NOW ----
    const buyHead = document.createElement('div');
    buyHead.className = 'armory-half-head';
    buyHead.style.cssText = 'margin-top:14px;';
    buyHead.textContent = 'BUYABLE NOW';
    wrap.appendChild(buyHead);
    const buyGrid = document.createElement('div');
    buyGrid.className = 'armory-tile-grid';
    if (!buyable.length) {
      const e = document.createElement('div');
      e.className = 'armory-half-empty';
      e.textContent = lockedAll.length === 0
        ? 'Every weapon unlocked.'
        : 'Nothing buyable yet — complete contracts to raise your rank.';
      buyGrid.appendChild(e);
    } else {
      for (const w of buyable) {
        const cost = costFor(w);
        buyGrid.appendChild(this._buildArmoryMiniTile(w, 'buyable', cost, () => {
          if (!this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
          unlockWeapon(w.name);
          this.ctx.notifyUnlock?.(w.name);
          this.render();
        }));
      }
    }
    wrap.appendChild(buyGrid);

    // ---- WORKING TOWARD ----
    if (stillLocked.length) {
      const lockHead = document.createElement('div');
      lockHead.className = 'armory-half-head';
      lockHead.style.cssText = 'margin-top:18px;';
      lockHead.textContent = 'WORKING TOWARD';
      wrap.appendChild(lockHead);
      const lockGrid = document.createElement('div');
      lockGrid.className = 'armory-tile-grid';
      for (const w of stillLocked) {
        lockGrid.appendChild(this._buildArmoryMiniTile(w, 'locked', null, null, reqRankFor(w)));
      }
      wrap.appendChild(lockGrid);
    }

    // ---- Pouch slot upgrades (absorbed from old Upgrades panel) ----
    const pouchHead = document.createElement('div');
    pouchHead.className = 'hideout-tier-head';
    pouchHead.style.marginTop = '14px';
    pouchHead.innerHTML = `<span class="t" style="color:#c9a87a">POUCH SLOTS</span><span class="s">Permanent ammo / consumable hotbar slots, persists across runs.</span>`;
    wrap.appendChild(pouchHead);
    const pouch = getPouchSlots();
    const pouchRow = document.createElement('div');
    pouchRow.className = 'hideout-upgrade-row';
    const pouchCost = pouchNextSlotCost(pouch);
    if (pouchCost == null) {
      pouchRow.innerHTML = `<span>Pouch at maximum (${POUCH_SLOT_MAX} slots).</span>`;
    } else {
      pouchRow.innerHTML = `
        <span>Buy slot #${pouch + 1}: <b>${pouchCost}</b> chips</span>
        <button type="button" class="hideout-buy">Buy</button>
      `;
      const btn = pouchRow.querySelector('.hideout-buy');
      btn.disabled = getPersistentChips() < pouchCost;
      btn.addEventListener('click', () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(pouchCost)) return;
        setPouchSlots(pouch + 1);
        this.render();
      });
    }
    wrap.appendChild(pouchRow);

    // ---- Starting-store config (absorbed from old Upgrades panel) --
    const ssHead = document.createElement('div');
    ssHead.className = 'hideout-tier-head';
    ssHead.style.marginTop = '14px';
    ssHead.innerHTML = `<span class="t" style="color:#c9a87a">STARTING STORE</span><span class="s">Per-run store offered when you pick a class. More slots / higher rarity ramp.</span>`;
    wrap.appendChild(ssHead);
    const ss = getStartingStoreState();
    const ssRow = document.createElement('div');
    ssRow.className = 'hideout-upgrade-row';
    ssRow.innerHTML = `
      <span>Slots: <b>${ss.slots}</b> · Rarity Tier: <b>${ss.rarityTier}</b></span>
    `;
    const ssCtrls = document.createElement('div');
    ssCtrls.style.cssText = 'display:flex; gap:6px;';
    const slotInc = document.createElement('button');
    slotInc.type = 'button'; slotInc.className = 'hideout-buy';
    slotInc.textContent = `+1 slot (${ss.slots * 60}c)`;
    slotInc.disabled = ss.slots >= 9 || getPersistentChips() < ss.slots * 60;
    slotInc.addEventListener('click', () => {
      const cost = ss.slots * 60;
      if (!this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
      setStartingStoreState({ ...ss, slots: Math.min(9, ss.slots + 1) });
      this.render();
    });
    const tierInc = document.createElement('button');
    tierInc.type = 'button'; tierInc.className = 'hideout-buy';
    tierInc.textContent = `+1 rarity (${(ss.rarityTier + 1) * 200}c)`;
    tierInc.disabled = ss.rarityTier >= 4 || getPersistentChips() < (ss.rarityTier + 1) * 200;
    tierInc.addEventListener('click', () => {
      const cost = (ss.rarityTier + 1) * 200;
      if (!this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
      setStartingStoreState({ ...ss, rarityTier: Math.min(4, ss.rarityTier + 1) });
      this.render();
    });
    ssCtrls.appendChild(slotInc);
    ssCtrls.appendChild(tierInc);
    ssRow.appendChild(ssCtrls);
    wrap.appendChild(ssRow);

    return wrap;
  }

  // ----- Vendors — merchant stock + reroll unlock ------------------
  // Absorbed from the old Upgrades panel. Each in-run merchant kind
  // can be paid up via chip purchases for +N items in their stock.
  // The reroll-any-shop unlock is a one-time chip purchase.
  _renderVendorsTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">VENDORS</div>
      <div class="hideout-section-sub">Pay merchants to carry more stock in-run. Mystery vendors included.</div>
    `;
    wrap.appendChild(head);

    // Reroll unlock — one-time chip purchase, lets the player pay
    // chips to reroll any in-run shop's stock once per visit.
    const rerollOwned = getRerollUnlocked();
    const rrRow = document.createElement('div');
    rrRow.className = 'hideout-upgrade-row';
    if (rerollOwned) {
      rrRow.innerHTML = `<span>Reroll-any-shop: <b style="color:#6abf78">UNLOCKED</b></span>`;
    } else {
      rrRow.innerHTML = `
        <span>Reroll-any-shop unlock — costs in-run chips to use: <b>${REROLL_UNLOCK_COST}</b> chips</span>
        <button type="button" class="hideout-buy">Buy</button>
      `;
      const btn = rrRow.querySelector('.hideout-buy');
      btn.disabled = getPersistentChips() < REROLL_UNLOCK_COST;
      btn.addEventListener('click', () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(REROLL_UNLOCK_COST)) return;
        setRerollUnlocked(true);
        this.render();
      });
    }
    wrap.appendChild(rrRow);

    // Merchant stock-size tiers — one row per kind. The bear merchant
    // is intentionally surfaced under a mysterious label.
    const upgrades = getMerchantUpgrades();
    const labels = {
      merchant: 'General Merchant',
      healer: 'Healer',
      gunsmith: 'Gunsmith',
      armorer: 'Armorer',
      tailor: 'Tailor',
      relicSeller: 'Relic Seller',
      blackMarket: 'Black Market',
      bearMerchant: 'A Mysterious Stranger',
    };
    const grpHead = document.createElement('div');
    grpHead.className = 'hideout-tier-head';
    grpHead.style.marginTop = '8px';
    grpHead.innerHTML = `<span class="t" style="color:#c9a87a">MERCHANT STOCK SIZES</span>`;
    wrap.appendChild(grpHead);
    for (const kind of MERCHANT_KINDS) {
      const lvl = upgrades[kind] | 0;
      const cost = merchantUpgradeNextCost(lvl);
      const row = document.createElement('div');
      row.className = 'hideout-upgrade-row';
      if (cost == null) {
        row.innerHTML = `<span>${labels[kind] || kind} — Tier ${lvl}/${MERCHANT_UPGRADE_MAX} <span class="muted">MAX</span></span>`;
      } else {
        row.innerHTML = `
          <span>${labels[kind] || kind} — Tier ${lvl}/${MERCHANT_UPGRADE_MAX} (next: <b>${cost}</b> chips)</span>
          <button type="button" class="hideout-buy">Upgrade</button>
        `;
        const btn = row.querySelector('.hideout-buy');
        btn.disabled = getPersistentChips() < cost;
        btn.addEventListener('click', () => {
          if (!this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
          setMerchantUpgrade(kind, lvl + 1);
          this.render();
        });
      }
      wrap.appendChild(row);
    }
    return wrap;
  }

  // ----- Black Market — sigil-spend vendor ---------------------------
  // Two sections: PERMITS (permanently unlock locked relics into the
  // relic-merchant rotation) and KEYSTONES (one-shot run-modifier
  // perks consumed at next run start). Both spend sigils; sigils are
  // earned from named-bounty contracts (megaboss kills under matching
  // contract targets).
  _renderBlackMarketTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const sigils = getSigils();

    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">BLACK MARKET</div>
      <div class="hideout-section-sub">Sigils on file: <b>${sigils}</b>. Earn more from megaboss-bounty contracts.</div>
    `;
    wrap.appendChild(head);

    // PERMITS section.
    const permits = getRelicPermits();
    const permitGroup = document.createElement('div');
    permitGroup.style.marginTop = '8px';
    permitGroup.innerHTML = `<div class="hideout-tier-head"><span class="t" style="color:#b870e0">PERMITS</span><span class="s">Permanent — adds the relic to the in-run merchant rotation.</span></div>`;
    for (const def of Object.values(RELIC_PERMITS)) {
      permitGroup.appendChild(this._buildSigilRow(def, permits.has(def.id), sigils, () => {
        if (!spendSigils(def.cost)) return;
        setRelicPermitOwned(def.id);
        this.render();
      }));
    }
    wrap.appendChild(permitGroup);

    // KEYSTONES section.
    const owned = getOwnedKeystones();
    const queue = getKeystoneQueue();
    const queueSet = new Set(queue);
    const ksGroup = document.createElement('div');
    ksGroup.style.marginTop = '14px';
    ksGroup.innerHTML = `<div class="hideout-tier-head"><span class="t" style="color:#b870e0">KEYSTONES</span><span class="s">One-shot run modifiers — consumed at next run start. ${queue.length} queued.</span></div>`;
    for (const def of Object.values(KEYSTONES)) {
      const isOwned = owned.has(def.id);
      const isQueued = queueSet.has(def.id);
      ksGroup.appendChild(this._buildSigilRow(def, isOwned, sigils, () => {
        if (!spendSigils(def.cost)) return;
        if (def.oneShot) queueKeystone(def.id);
        else setKeystoneOwned(def.id);
        this.render();
      }, isQueued));
    }
    wrap.appendChild(ksGroup);
    return wrap;
  }

  _buildSigilRow(def, owned, sigilsAvail, onBuy, isQueued = false) {
    const row = document.createElement('div');
    row.className = 'hideout-contract-row';
    const tag = owned ? 'OWNED' : (isQueued ? 'QUEUED' : '');
    row.innerHTML = `
      <div class="row-head">
        <span class="label">${def.label}</span>
        <span class="reward" style="color:#b870e0">${def.cost} sigils</span>
      </div>
      <div class="row-blurb">${def.blurb}</div>
      <div class="row-actions"></div>
    `;
    const actions = row.querySelector('.row-actions');
    if (owned) {
      const t = document.createElement('span');
      t.className = 'hideout-tag claimed'; t.textContent = 'OWNED';
      actions.appendChild(t);
    } else if (isQueued) {
      const t = document.createElement('span');
      t.className = 'hideout-tag active'; t.textContent = 'QUEUED';
      actions.appendChild(t);
      // Allow buying again — keystones can stack in queue.
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'hideout-btn primary';
      btn.textContent = 'Buy again';
      btn.disabled = sigilsAvail < def.cost;
      btn.addEventListener('click', onBuy);
      actions.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'hideout-btn primary';
      btn.textContent = 'Buy';
      btn.disabled = sigilsAvail < def.cost;
      btn.addEventListener('click', onBuy);
      actions.appendChild(btn);
    }
    return row;
  }

  // ----- Contractor --------------------------------------------------
  // Stage-style contractor — three-step flow:
  //   home    : host + speech + Start New Run CTA centered low
  //   cards   : 3 wanted-poster cards bottom-center; pick one
  //   weapon  : paperdoll + weapon list + Confirm Loadout
  // Side rails (live feed + contract board) show on home + cards;
  // they hide on the weapon screen so the loadout view gets full
  // breathing room.
  _renderContractorTab() {
    const wrap = document.createElement('div');
    wrap.className = `hideout-tab-body contractor-stage step-${this.contractorStep}`;

    const active = getActiveContract();
    const activeId = active?.activeContractId || null;
    const claimed = !!active && (active.claimedAt | 0) > 0;
    const unlockState = {
      contractsCompleted: getContractRank(),
      megabossKills: getMegabossKills(),
      marks: getMarks(),
    };
    const allDefs = Object.values(CONTRACT_DEFS).filter(d => isContractUnlocked(d, unlockState));

    // Side rails — visible on home + cards. Hidden on weapon and
    // leaderboard steps where they'd compete with the focal content.
    if (this.contractorStep === 'home' || this.contractorStep === 'cards') {
      const feed = document.createElement('div');
      feed.className = 'contractor-feed';
      feed.innerHTML = `<div class="feed-head">LIVE CONTRACT FEED</div>${this._renderLiveFeedHTML()}`;
      // Compact leaderboards block below the feed — top 3 in Levels
      // (the most relatable category for a contracts screen). Click
      // on the block opens the full leaderboards step.
      const lb = document.createElement('div');
      lb.className = 'contractor-leaderboard-block';
      lb.innerHTML = `
        <div class="lb-block-head">LEADERBOARDS</div>
        ${this._renderLeaderboardMiniHTML('levels', 3)}
        <button type="button" class="lb-view-all">View all categories ▶</button>
      `;
      lb.querySelector('.lb-view-all').addEventListener('click', () => {
        this.contractorStep = 'leaderboard';
        this.render();
      });
      feed.appendChild(lb);
      wrap.appendChild(feed);

      const board = document.createElement('div');
      board.className = 'contractor-board';
      board.innerHTML = `<div class="board-head">CONTRACT BOARD</div>${this._renderBoardListHTML(allDefs)}`;
      wrap.appendChild(board);

      // Kick the live-feed shuffle interval. _stopFeedPulse handles
      // cleanup on close.
      this._startFeedPulse();
    } else {
      this._stopFeedPulse();
    }

    // Host portrait + speech (home + cards only — hidden on weapon).
    if (this.contractorStep !== 'weapon') {
      const greeting = this.contractorStep === 'cards'
        ? "Here's what's available to you today. Pick one."
        : this._pickHostGreeting();
      const host = document.createElement('div');
      host.className = 'contractor-host';
      host.innerHTML = `
        <div class="host-portrait" aria-hidden="true"><div class="host-glyph">◆</div></div>
        <div class="host-bubble"><div class="host-quote">"${greeting}"</div></div>
      `;
      wrap.appendChild(host);
    }

    // Step-specific content.
    if (this.contractorStep === 'home') {
      const cta = document.createElement('button');
      cta.id = 'contractor-cta';
      cta.type = 'button';
      cta.textContent = 'START NEW RUN';
      cta.addEventListener('click', () => {
        this.contractorStep = 'cards';
        this.render();
      });
      wrap.appendChild(cta);
    } else if (this.contractorStep === 'cards') {
      this._refreshCardSlots(allDefs, activeId);
      const cards = document.createElement('div');
      cards.className = 'contractor-cards';
      for (let i = 0; i < this._cardSlots.length; i++) {
        const def = CONTRACT_DEFS[this._cardSlots[i]];
        if (!def) continue;
        cards.appendChild(this._renderContractWantedCard(def, active, activeId, claimed, i));
      }
      if (!this._cardSlots.length) {
        const empty = document.createElement('div');
        empty.className = 'contractor-empty';
        empty.textContent = 'No contracts available — try again after a refresh.';
        cards.appendChild(empty);
      }
      wrap.appendChild(cards);

      wrap.appendChild(this._renderBackButton('Back', () => {
        this.contractorStep = 'home';
        this.render();
      }));
    } else if (this.contractorStep === 'weapon') {
      wrap.appendChild(this._renderMissionPrepSection());
    } else if (this.contractorStep === 'leaderboard') {
      wrap.appendChild(this._renderLeaderboardSection());
    }

    // Corner stats — visible on all steps.
    const corner = document.createElement('div');
    corner.className = 'contractor-corner';
    corner.innerHTML = `
      <div class="corner-line">RANK <b>${unlockState.contractsCompleted}</b></div>
      <div class="corner-line">MEGABOSSES <b>${unlockState.megabossKills}</b></div>
      <div class="corner-refresh">CONTRACT REFRESH<br><span class="refresh-time">${this._refreshCountdownStr()}</span></div>
    `;
    wrap.appendChild(corner);

    return wrap;
  }

  // Mission-prep / stash screen — character placeholder middle-left
  // with paperdoll equipment slots arranged around them, weapon list
  // on the right, Confirm Loadout button centered. Click a weapon to
  // select it as the run's primary; click Confirm to fire close().
  _renderMissionPrepSection() {
    const wrap = document.createElement('div');
    wrap.className = 'contractor-loadout';

    const ac = getActiveContract();
    const def = ac ? defForId(ac.activeContractId) : null;
    const banner = document.createElement('div');
    banner.className = 'prep-banner';
    banner.innerHTML = `
      <div class="prep-eyebrow">MISSION PREP</div>
      <div class="prep-title">${def ? def.label.toUpperCase() : 'NO CONTRACT ACTIVE'}</div>
      ${def ? `<div class="prep-sub">${def.targetCount} × ${this._targetLabel(def.targetType, def.targetCount)}</div>` : ''}
    `;
    wrap.appendChild(banner);

    const selected = getSelectedStarterWeapon();
    const unlocked = getUnlockedWeapons();
    const baselineSet = new Set(BASELINE_STARTERS);
    const available = tunables.weapons.filter(w =>
      !w.mythic && w.rarity !== 'mythic'
      && (baselineSet.has(w.name) || unlocked.has(w.name)));

    // ----- Left: PAPERDOLL — focus on equipped items. Mirrors the
    // in-game inventory's slot vocabulary. Pockets + backpack are
    // intentionally de-emphasized (one-line summary instead of
    // grids) since the player only needs to know they start with
    // bandages.
    const charCol = document.createElement('div');
    charCol.className = 'loadout-charcol';
    // Paperdoll laid out per the in-game equipment screen: three
    // columns (left slots, center figure + callout panels, right
    // slots). Each slot tile is a label-top + icon-centered card
    // matching the in-game look. Center column has the character
    // silhouette plus three info panels: GEAR BONUSES (top), RELICS
    // (mid), SKILLS (bottom). Pre-run defaults pre-fill chest /
    // pants / backpack / primary weapon when set.
    const bandageIcon = iconForItem(CONSUMABLE_DEFS?.bandage) || '';
    const selectedDef = selected
      ? tunables.weapons.find(w => w.name === selected)
      : null;
    const selectedIcon = selectedDef ? iconForItem({
      name: selectedDef.name, baseName: selectedDef.name,
      type: selectedDef.type, class: selectedDef.class,
    }) : '';
    const slotTile = (key, label, item, iconUrl, glyph) => {
      const filled = !!item;
      const art = filled && iconUrl
        ? `<img class="pd-tile-art" src="${iconUrl}" alt="">`
        : (filled
          ? `<div class="pd-tile-name">${item}</div>`
          : `<div class="pd-tile-glyph">${glyph || ''}</div>`);
      return `
        <div class="pd-tile pd-${key}${filled ? ' filled' : ''}">
          <div class="pd-tile-label">${label}</div>
          <div class="pd-tile-icon">${art}</div>
        </div>
      `;
    };
    charCol.innerHTML = `
      <div class="prep-section-head">EQUIPMENT</div>
      <div class="paperdoll-grid3">
        <div class="pd-col pd-col-left">
          ${slotTile('head',  'HEAD',  null, null, '◐')}
          ${slotTile('face',  'FACE',  null, null, '◉')}
          ${slotTile('ears',  'EARS',  null, null, '◜◝')}
          ${slotTile('chest', 'CHEST', 'Shirt', null, '◧')}
          ${slotTile('hands', 'HANDS', null, null, '✋')}
        </div>
        <div class="pd-col pd-col-center">
          <div class="pd-callout pd-callout-bonus">
            <div class="pd-callout-label">GEAR BONUSES</div>
            <div class="pd-callout-body">No set bonuses, perks, or affixes yet — equip gear to grow your power.</div>
          </div>
          <div class="pd-figure-frame"><div class="pd-figure-glyph">◇</div></div>
          <div class="pd-callout pd-callout-relics">
            <div class="pd-callout-label">RELICS</div>
            <div class="pd-callout-body">No relics yet — finish encounters or buy from the relic-seller.</div>
          </div>
          <div class="pd-callout pd-callout-skills">
            <div class="pd-callout-label">SKILLS</div>
            <div class="pd-callout-body">No skills yet — kill enemies to level up.</div>
          </div>
        </div>
        <div class="pd-col pd-col-right">
          ${slotTile('backpack', 'BACKPACK', 'Small', null, '⊞')}
          ${slotTile('weapon1',  'WEAPON 1', selected || null, selectedIcon, '▶')}
          ${slotTile('weapon2',  'WEAPON 2', null, null, '▶')}
          ${slotTile('melee',    'MELEE',    null, null, '✕')}
          ${slotTile('belt',     'BELT',     null, null, '━')}
          ${slotTile('pants',    'PANTS',    'Combat', null, '⊓')}
          ${slotTile('boots',    'BOOTS',    null, null, '◣')}
        </div>
      </div>

      <div class="pd-starter-strip" title="Run starts with these items in your pockets.">
        <div class="pd-starter-label">STARTING POCKETS</div>
        <div class="pd-starter-icons">
          ${bandageIcon ? `<div class="pd-starter-ico"><img src="${bandageIcon}" alt="Bandage"></div>`.repeat(3) : '<div class="pd-starter-ico empty">×3</div>'}
          <div class="pd-starter-ico throwable">⊕</div>
        </div>
      </div>
    `;
    wrap.appendChild(charCol);

    // ----- Middle: ARMORY — the player's owned weapons, click to
    // pick a starter. The chip-buy unlock list lives on its own
    // ARMORER tab now, so this column is purely "what I own".
    const armoryCol = document.createElement('div');
    armoryCol.className = 'loadout-armorycol loadout-panel';
    const rank = getContractRank();
    armoryCol.innerHTML = `
      <div class="armory-head">
        <div class="armory-eyebrow">YOUR ARMORY</div>
        <div class="armory-title">UNLOCKED COLLECTION</div>
        <div class="armory-count"><b>${available.length}</b> weapons · Rank <b>${rank}</b></div>
      </div>
    `;

    const RARITY_RANK = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };

    // Single grid — class first, then rarity, then name. Selecting
    // does NOT promote to the front; highlight is CSS state only so
    // tiles don't reshuffle on click.
    const availGrid = document.createElement('div');
    availGrid.className = 'armory-tile-grid loadout-armory-grid';
    const availSorted = available.slice().sort((a, b) => {
      if (a.class !== b.class) return (a.class || '').localeCompare(b.class || '');
      const ar = RARITY_RANK[a.rarity || 'common'] ?? 5;
      const br = RARITY_RANK[b.rarity || 'common'] ?? 5;
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
    for (const w of availSorted) {
      availGrid.appendChild(this._buildArmoryMiniTile(w,
        w.name === selected ? 'taking' : 'owned',
        null,
        () => {
          setSelectedStarterWeapon(w.name === selected ? null : w.name);
          this.render();
        }));
    }
    if (!availSorted.length) {
      const e = document.createElement('div');
      e.className = 'armory-half-empty';
      e.textContent = 'No weapons available.';
      availGrid.appendChild(e);
    }
    armoryCol.appendChild(availGrid);
    wrap.appendChild(armoryCol);

    // ----- Right: Pre-Run Store (upgrades top · stock middle ·
    //        refresh button bottom · timer below) per the wireframe.
    const storeCol = document.createElement('div');
    storeCol.className = 'loadout-storecol loadout-panel';
    const storeState = this._getOrRefreshStore();
    const elapsed = Math.max(0, Date.now() - storeState.lastRefreshAt);
    const remaining = Math.max(0, storeState.refreshMs - elapsed);
    const hh = Math.floor(remaining / 3600000);
    const mm = Math.floor((remaining % 3600000) / 60000);
    storeCol.innerHTML = `
      <div class="loadout-collabel">
        PRE-MISSION BOOST
        <span class="store-refresh-meta">limited stock</span>
      </div>
      <div class="store-blurb">Spend chips to boost this run. Stock won't replenish until refresh — upgrading any tier triggers a free reroll.</div>
    `;

    // ----- Top: two prominent upgrade tiles. Per the wireframe the
    //        store has two big "upgrade" boxes at the top. We map the
    //        most-used two: stock size + rarity ceiling. The faster-
    //        refresh cadence sits as a small inline option next to
    //        the manual-refresh CTA at the bottom.
    const upgrades = document.createElement('div');
    upgrades.className = 'store-upgrades';
    const slotCost = storeNextSlotCost(storeState.slots);
    upgrades.appendChild(this._buildStoreUpgradeTile({
      title: `STOCK SIZE · ${storeState.slots}/${STORE_SLOT_MAX}`,
      sub: slotCost == null ? 'MAX' : `+1 slot · ${slotCost}c · free refresh`,
      cost: slotCost,
      onClick: () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(slotCost)) return;
        const s = getStoreState();
        setStoreState({ ...s, slots: Math.min(STORE_SLOT_MAX, s.slots + 1) });
        this._refreshStore(true);
        this.render();
      },
    }));
    const ceilCost = storeNextCeilingCost(storeState.ceiling);
    const ceilLabels = ['common', 'common+uncommon', 'rare-floor', 'epic-floor', 'legendary-floor'];
    upgrades.appendChild(this._buildStoreUpgradeTile({
      title: `RARITY CEILING · ${ceilLabels[storeState.ceiling] || 'common'}`,
      sub: ceilCost == null ? 'MAX' : `+1 tier · ${ceilCost}c · free refresh`,
      cost: ceilCost,
      onClick: () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(ceilCost)) return;
        const s = getStoreState();
        setStoreState({ ...s, ceiling: Math.min(STORE_CEILING_MAX, s.ceiling + 1) });
        // Free reroll on any store upgrade per design brief.
        this._refreshStore(true);
        this.render();
      },
    }));
    storeCol.appendChild(upgrades);

    // ----- Middle: items for sale -----
    const stockBlock = document.createElement('div');
    stockBlock.className = 'store-stock';
    stockBlock.innerHTML = `<div class="store-stock-label">ITEMS FOR SALE</div>`;
    const sgrid = document.createElement('div');
    sgrid.className = 'store-stock-list';
    for (let i = 0; i < storeState.stock.length; i++) {
      sgrid.appendChild(this._buildStoreTile(storeState.stock[i], i));
    }
    stockBlock.appendChild(sgrid);
    storeCol.appendChild(stockBlock);

    // ----- Bottom: refresh button + timer + faster-refresh option
    const footer = document.createElement('div');
    footer.className = 'store-footer';
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'store-refresh-btn';
    refreshBtn.textContent = `Refresh now · 200c`;
    refreshBtn.disabled = getPersistentChips() < 200;
    refreshBtn.addEventListener('click', () => {
      if (!this.ctx.spendChips || !this.ctx.spendChips(200)) return;
      this._refreshStore(true);
      this.render();
    });
    footer.appendChild(refreshBtn);

    const refCost = storeNextRefreshCost(storeState.refreshMs);
    if (refCost != null) {
      const fasterBtn = document.createElement('button');
      fasterBtn.type = 'button';
      fasterBtn.className = 'store-faster-btn';
      fasterBtn.textContent = `Faster cadence · ${refCost}c · free refresh`;
      fasterBtn.disabled = getPersistentChips() < refCost;
      fasterBtn.addEventListener('click', () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(refCost)) return;
        const s = getStoreState();
        const tiers = [4 * 3600000, 3 * 3600000, 2 * 3600000, 1 * 3600000];
        const idx = tiers.findIndex(t => t < s.refreshMs);
        const next = idx >= 0 ? tiers[idx] : s.refreshMs;
        setStoreState({ ...s, refreshMs: next });
        // Free reroll on any store upgrade per design brief.
        this._refreshStore(true);
        this.render();
      });
      footer.appendChild(fasterBtn);
    }

    const timer = document.createElement('div');
    timer.className = 'store-timer';
    timer.textContent = `auto-refresh in ${hh}h ${mm}m`;
    footer.appendChild(timer);

    storeCol.appendChild(footer);
    wrap.appendChild(storeCol);

    // ----- Confirm CTA + back -----
    const confirm = document.createElement('button');
    confirm.className = 'loadout-confirm';
    confirm.type = 'button';
    confirm.textContent = 'CONFIRM LOADOUT';
    confirm.disabled = !selected;
    confirm.addEventListener('click', () => {
      if (!getSelectedStarterWeapon()) return;
      this.close();
    });
    wrap.appendChild(confirm);

    wrap.appendChild(this._renderBackButton('Back to contracts', () => {
      this.contractorStep = 'cards';
      this.render();
    }));

    return wrap;
  }

  // Wanted-poster style card — target portrait at top, name, conditions,
  // reward strip at bottom. Replaces the older grid row card for the
  // featured-3 set inside the stage view.
  // Card-slot maintenance — fills `_cardSlots` up to MAX_CARDS with
  // fresh def IDs from the unlocked pool, excluding the currently-
  // active contract. Existing slots are kept stable (so the player
  // sees the same cards across renders) until they accept one.
  _refreshCardSlots(allDefs, activeId) {
    const MAX_CARDS = 6;
    const cap = Math.min(MAX_CARDS, allDefs.length);
    // Drop slots that point to the active contract or to a missing
    // def, so cycling kicks in at the right moments.
    this._cardSlots = this._cardSlots.filter(id =>
      id && id !== activeId && CONTRACT_DEFS[id]);
    const seen = new Set(this._cardSlots);
    if (activeId) seen.add(activeId);
    while (this._cardSlots.length < cap) {
      const candidates = allDefs.filter(d => !seen.has(d.id));
      if (!candidates.length) break;
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      this._cardSlots.push(pick.id);
      seen.add(pick.id);
    }
  }

  // Wanted-poster card — the entire card is the affordance. Click
  // sets the active contract AND advances the contractor stage to
  // mission-prep (stash + weapon loadout). On accept, the slot the
  // card occupied is replaced with a fresh draw so the cards row
  // always feels alive.
  _renderContractWantedCard(def, active, activeId, claimed, slotIdx = -1) {
    const card = document.createElement('button');
    card.type = 'button';
    const isClaimed = (def.id === activeId) && claimed;
    card.className = 'wanted-card'
      + ` rarity-${def.rarity || 'common'}`
      + (isClaimed ? ' claimed' : '');
    const targetLabel = this._targetLabel(def.targetType, def.targetCount);
    const totalCap = (def.perKillReward | 0) * (def.targetCount | 0) + (def.reward | 0);

    card.innerHTML = `
      <div class="wanted-portrait" data-portrait="${def.portrait || 'any'}">${this._portraitGlyph(def.portrait)}</div>
      <div class="wanted-name">${def.label.toUpperCase()}</div>
      <div class="wanted-mission">ELIMINATE TARGET</div>
      <div class="wanted-conds">${def.targetCount} × ${targetLabel}</div>
      ${this._renderModifierList(def)}
      <div class="wanted-rewards">
        <span class="wanted-reward chips" title="Total chips on completion">◇ ${totalCap}c</span>
        ${(def.marksReward | 0) > 0 ? `<span class="wanted-reward marks" title="Marks on completion">◈ ${def.marksReward}</span>` : ''}
        ${(def.sigilsReward | 0) > 0 ? `<span class="wanted-reward sigils" title="Sigils on completion">✪ ${def.sigilsReward}</span>` : ''}
      </div>
    `;
    if (isClaimed) {
      card.disabled = true;
    } else {
      card.addEventListener('click', () => {
        const period = (def.period === 'weekly') ? 7 * 24 * 3600000 : 24 * 3600000;
        setActiveContract({
          activeContractId: def.id,
          expiresAt: Date.now() + period,
          progress: {},
          claimedAt: 0,
        });
        // Cycle this card's slot — drop the accepted def from the
        // visible set so when the player navigates back later they
        // get a fresh card in its place.
        if (slotIdx >= 0 && slotIdx < this._cardSlots.length) {
          this._cardSlots.splice(slotIdx, 1);
        }
        if (this.tab === 'contractor') this.contractorStep = 'weapon';
        this.render();
      });
    }
    return card;
  }

  // Compact leaderboard block — top N entries in a single category.
  // Mostly decorative on the contractor home/cards step; click "View
  // all categories" to expand into the full screen.
  _renderLeaderboardMiniHTML(category, n) {
    let entries = [];
    try {
      const lb = this.ctx.getLeaderboard?.();
      if (lb?.top) entries = lb.top(category, n) || [];
    } catch (_) { /* no leaderboard available */ }
    if (!entries.length) {
      return `<div class="lb-block-empty">No runs banked yet.</div>`;
    }
    return entries.map((e, i) => {
      const who = e.playerName || e.name || 'anon';
      const val = e[category] ?? e.score ?? 0;
      return `<div class="lb-block-row">
        <span class="lb-rank">${i + 1}.</span>
        <span class="lb-name">${who}</span>
        <span class="lb-val">${val}</span>
      </div>`;
    }).join('');
  }

  // Full-screen leaderboards inside the contractor stage. Four
  // category columns (credits / levels / damage / kills), each
  // showing top 10. Back button uses the global helper.
  _renderLeaderboardSection() {
    const wrap = document.createElement('div');
    wrap.className = 'contractor-leaderboard-full';
    const lb = this.ctx.getLeaderboard?.();
    const cats = [
      { key: 'credits', label: 'MOST VALUE',  fmt: (e) => `${e.credits ?? e.score ?? 0}c` },
      { key: 'levels',  label: 'FURTHEST',    fmt: (e) => `Lv ${e.levels ?? e.score ?? 0}` },
      { key: 'damage',  label: 'MOST DAMAGE', fmt: (e) => `${e.damage ?? e.score ?? 0}` },
      { key: 'kills',   label: 'MOST KILLS',  fmt: (e) => `${e.kills ?? e.score ?? 0}` },
    ];

    const head = document.createElement('div');
    head.className = 'lb-full-head';
    head.innerHTML = `
      <div class="lb-eyebrow">LEADERBOARDS</div>
      <div class="lb-title">TOP OF THE BOARD</div>
      <div class="lb-sub">Other contractors. Their best work. Your benchmark.</div>
    `;
    wrap.appendChild(head);

    const cols = document.createElement('div');
    cols.className = 'lb-full-cols';
    for (const c of cats) {
      const col = document.createElement('div');
      col.className = 'lb-full-col';
      const entries = lb?.top ? (lb.top(c.key, 10) || []) : [];
      const rowsHTML = [];
      for (let i = 0; i < 10; i++) {
        const e = entries[i];
        if (e) {
          const who = e.playerName || e.name || 'anon';
          rowsHTML.push(`<div class="lb-full-row"><span class="lb-rank">${i + 1}.</span><span class="lb-name">${who}</span><span class="lb-val">${c.fmt(e)}</span></div>`);
        } else {
          rowsHTML.push(`<div class="lb-full-row empty"><span class="lb-rank">${i + 1}.</span><span class="lb-name">—</span><span class="lb-val"></span></div>`);
        }
      }
      col.innerHTML = `
        <div class="lb-col-head">${c.label}</div>
        ${rowsHTML.join('')}
      `;
      cols.appendChild(col);
    }
    wrap.appendChild(cols);

    wrap.appendChild(this._renderBackButton('Back', () => {
      this.contractorStep = 'home';
      this.render();
    }));
    return wrap;
  }

  // Store tile — same shape as weapon tile, with a chip-cost CTA.
  _buildStoreTile(slot, idx) {
    const tile = document.createElement('div');
    tile.className = 'loadout-tile store-tile';
    if (!slot) { tile.classList.add('empty'); tile.textContent = '—'; return tile; }
    if (slot.sold) {
      tile.classList.add('sold');
      tile.innerHTML = `<div class="lt-name">${slot.label}</div><div class="lt-sold">SOLD</div>`;
      return tile;
    }
    tile.style.borderColor = rarityColor({ rarity: slot.rarity });
    const itemHint = slot.kind === 'weapon'
      ? { name: slot.id, baseName: slot.id, type: 'ranged' }
      : { name: slot.label, type: slot.kind };
    const icon = iconForItem(itemHint);
    tile.innerHTML = `
      <div class="lt-icon">${icon ? `<img src="${icon}" alt="">` : '<div class="lt-icon-fallback"></div>'}</div>
      <div class="lt-name">${slot.label}</div>
      <div class="lt-meta">${(slot.kind || '').toUpperCase()} · ${slot.rarity || 'common'}${slot.qty > 1 ? ` ·×${slot.qty}` : ''}</div>
      <div class="lt-stats"><span class="lt-stat lt-cost">${slot.price}c</span></div>
      <button type="button" class="lt-buy">Buy</button>
    `;
    const btn = tile.querySelector('.lt-buy');
    btn.disabled = getPersistentChips() < slot.price;
    btn.addEventListener('click', () => this._buyStoreSlot(idx));
    return tile;
  }

  // Armory mini-tile — same shape + size as the pre-mission store
  // tiles. Icon on top, name, class·rarity meta, stat snippet, then
  // an optional state badge or unlock button at the bottom. Four
  // states: 'owned' (click to select), 'taking' (currently selected,
  // gold border), 'buyable' (Unlock button with chip cost), 'locked'
  // (silhouette + "Rank N to unlock"). Stats are always shown so
  // the player can compare weapons at a glance.
  _buildArmoryMiniTile(weapon, state, cost, onClick, reqRank) {
    const tile = document.createElement('div');
    tile.className = `armory-mini rarity-${weapon.rarity || 'common'} state-${state}`;
    tile.style.borderColor = rarityColor({ rarity: weapon.rarity });
    // Show the real icon + name + stats in every state, including
    // 'locked' — players want to see the weapon they're working
    // toward, not a `???` placeholder.
    const icon = iconForItem({
      name: weapon.name, baseName: weapon.name, type: weapon.type, class: weapon.class,
    });
    const dmg = weapon.damage != null ? `<span class="amini-stat">DMG ${weapon.damage}</span>` : '';
    const rps = weapon.fireRate != null ? `<span class="amini-stat">RPS ${weapon.fireRate}</span>` : '';
    const range = weapon.range != null ? `<span class="amini-stat">RNG ${weapon.range}</span>` : '';

    let action = '';
    if (state === 'taking')       action = `<div class="amini-cta taking">TAKING</div>`;
    else if (state === 'owned')   action = `<button type="button" class="amini-cta select">Take</button>`;
    else if (state === 'buyable') action = `<button type="button" class="amini-cta buy">Unlock · ${cost}c</button>`;
    else if (state === 'locked')  action = `<div class="amini-cta locked">Rank ${reqRank} to unlock</div>`;

    tile.innerHTML = `
      <div class="amini-icon">
        ${icon
          ? `<img src="${icon}" alt="">`
          : `<div class="amini-icon-fallback">?</div>`}
      </div>
      <div class="amini-name">${weapon.name}</div>
      <div class="amini-meta">${weapon.class || ''}${weapon.rarity ? ` · ${weapon.rarity}` : ''}</div>
      <div class="amini-stats">${dmg + rps + range}</div>
      ${action}
    `;
    tile.title = state === 'locked'
      ? `${weapon.name} · Locked — reach Rank ${reqRank} to unlock for purchase.`
      : state === 'buyable'
        ? `Unlock ${weapon.name} for ${cost}c (${weapon.rarity || 'common'} ${weapon.class || ''})`
        : `${weapon.name} · ${weapon.rarity || 'common'} ${weapon.class || ''}`;
    const cta = tile.querySelector('button.amini-cta');
    if (cta && onClick && state !== 'locked') {
      if (state === 'buyable') cta.disabled = getPersistentChips() < cost;
      cta.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    }
    return tile;
  }


  // Big upgrade tile shown at the top of the store column. Two of
  // these stack as the prominent "upgrade your store" boxes per the
  // wireframe.
  _buildStoreUpgradeTile({ title, sub, cost, onClick }) {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'store-upgrade-tile';
    t.innerHTML = `
      <div class="sut-title">${title}</div>
      <div class="sut-sub">${sub}</div>
    `;
    if (cost == null) t.disabled = true;
    else {
      t.disabled = getPersistentChips() < cost;
      t.addEventListener('click', onClick);
    }
    return t;
  }

  _pickHostGreeting() {
    if (!this._greetings) {
      this._greetings = [
        // ── Locked-in keepers (do not delete) ──
        'You look like trouble. Good. Trouble pays.',

        // ── Rotation pool — playful, haughty, sleek-and-sexy-dark ──
        "Hi, pretty boy. Looking for work in our line of work? Or just admiring the view?",
        "Back already? The board never sleeps. Pick a name.",
        "Don't waste my time. I've got a queue.",
        "Cute. Now sign here, here, and here.",
        "I had your seat warmed. Don't ask how.",
        "Names on the board, money in the slot. Same as always, sweetheart.",
        "Try not to die before the bonus round.",
        "You're back. Either you're getting good or getting lucky. Place your bet.",
        "Eyes up here, pretty boy. The contracts are on the screen.",
        "Smile. It might be the last good thing on your face.",
        "Walk in like you own the place. Cute. You don't.",
        "Pull up a stool. Don't get blood on it this time.",
        "Welcome back to the only place that takes your calls.",
        "I'd offer you coffee. I won't.",
        "Don't thank me. Pay me.",
        "Ten came in today. Eight'll be back. Two won't. Pick a card.",
        "Late again. The targets aren't getting any quieter.",
        "You keep showing up. I keep printing checks. Match made.",
        "The good ones are gone. Try the bad ones. They die slower.",
        "Take your pick. I won't tell you which one ends well.",
        "Light's bad in here on purpose. So's the work.",
        "Half my clients are corpses. The other half are you.",
        "Welcome to the part of the building that doesn't exist.",
        "If you're here for closure, wrong office. We deal in openings.",
        "You've got the look. The one I bill extra for.",
        "Quiet day. Make some noise.",
        "I saw your name on the wire this morning. Twice. Show me what's left.",
        "Sit. Pretend the chair likes you.",
        "Whoever's in your file, they're not buying drinks for free.",

        // ── Noir / world-weary atmospheric extension ──
        "The walls listen. Speak slower.",
        "Three doors out of this room. Two of them lock from outside.",
        "I keep a list. You're middle of the page. Don't get promoted.",
        "Tonight's special is regret. We're out of regret. Try the contract.",
        "You came in damp. The rain stopped two blocks ago. Talk to me.",
        "Your previous job left a tip. It was a finger. Pick a card.",
        "The board updates every hour. Your luck doesn't.",
        "I take cash, favors, and silence. Mostly silence.",
        "Take the chair facing the door. You'll need the warning.",
        "Half this room's on fire. You'd never know. That's the magic.",
        "Don't read the names too long. Some of them read back.",
        "We don't do refunds. We do funerals. Different department.",
        "Came in alone? Smart. Fewer witnesses to negotiate.",
        "I can hear your pulse from here. Steady it. Targets notice.",
        "There's a man in your jacket pocket. Hope he's friendly.",
        "Nice gun. The last guy who carried it left it on the counter.",
        "You smile like someone who hasn't met their bill yet.",
        "The contracts are sealed. So are most of the people who took them.",
        "Read the fine print. There isn't any. That's the fine print.",
        "Last week a man asked me my name. He's the contract now.",
        "I bill in installments. The first one's right now. Shut the door.",

        // ── Optimistic cynicism — wit + ledger + never impressed ──
        "Statistically, you're either bored, broke, or both. The board sorts itself.",
        "It's not a slow week. The targets are just better at hiding. Briefly.",
        "Nobody comes here twice for the conversation.",
        "The job pays. That's all the optimism this room can afford.",
        "I've buried better. I've billed worse. Today's somewhere in between.",
        "If it helps: the targets are also having a bad week.",
        "Your last contract closed under budget. Don't let it go to your head.",
        "I track three things: pulse, paperwork, and who lied. You're one for three.",
        "The people who don't come back are usually quieter about it.",
        "You're punctual. Concerning. Is something wrong?",
        "Two new names on the board this morning. One owes me twenty.",
        "I'd ask how you've been. The answer is on your jacket.",
        "Slow night. Someone's late. Probably late forever.",
        "We've all got a number. Yours just hasn't been called yet.",
        "Do me a favor. Don't ask me to do me a favor.",
        "I run a clean shop. The mess is what we sell.",
        "Some people walk in with a question. You walk in with a bill.",
        "I'd warn you about the hard ones. You'd take them anyway.",
        "Show me your hands. Not for trust. For the calluses.",
        "Coffee's old. Targets are older. The math evens out.",
        "Bad week. The board's full. Good for you. Bad for the board.",
        "I had high hopes for you once. Then I remembered who I was.",
        "If the door was harder to open, half this town would still be alive.",
        "I'm not impressed. I haven't been since 2014. Don't take it personally.",
        "You're early. The bodies aren't. Wait a minute.",
        "Most of my customers don't ask questions. The dead ones, anyway.",
        "Read the room. Don't bother reading the contract.",
        "You came in like someone who's been thinking about it. I charge for thinking.",

        // ── Short-form deadpan compliments ──
        "You didn't bleed on my counter this time. Growth.",
        "Two limbs. Two hands. Acceptable.",
        "Cleaner than last time. The bar was low.",
        "Still alive. Your mother must be relieved.",
        "You walk quieter now. Marginally.",
        "You're improving. I didn't expect you would.",
        "Still upright. Always nice.",
        "I almost recognized you. Don't take that as praise.",
        "No new scars. Lazy week?",
        "Less limp this time. I noticed.",

        // ── Callbacks to recent work ──
        "Floor 8. I read the report. Cute.",
        "You owe a man on level four an apology.",
        "I heard about the hallway. Subtle.",
        "The smuggler's friends called. They're upset.",
        "Last time you came in louder. Improvement.",
        "I noticed the kill count. The board did too.",
        "Three runs this week. Pace yourself.",
        "The thing on floor six. We don't talk about that here.",
        "You didn't reload. The body counted.",
        "I logged your last contract under 'optimistic.'",

        // ── The board is alive ──
        "The board's awake. It noticed you.",
        "Names rearrange themselves in here. Don't stare.",
        "The board listens. Pretend it doesn't.",
        "Two names blinked when you walked in. Coincidence, probably.",
        "The board's hungry. Feed it.",
        "I keep meaning to clean the board. It keeps meaning to clean us.",
        "Your name's not up there. Yet.",
        "The board flickers when it likes you. It's flickering.",
        "The board deletes the closed ones slowly. Like memory.",
        "It's been writing on its own again. Pick a name before it picks you.",
      ];
    }
    // Pick fresh on every render. Cached on `_currentGreeting` until
    // the player leaves the hideout — so flipping between contractor
    // sub-steps doesn't reroll the line mid-flow. Cleared in close()
    // / _exitToTitle so the NEXT visit gets a new opening line.
    if (!this._currentGreeting) {
      const idx = Math.floor(Math.random() * this._greetings.length);
      this._currentGreeting = this._greetings[idx];
    }
    return this._currentGreeting;
  }

  _renderLiveFeedHTML() {
    // Decorative ticker — initial 8 rows. The shuffle interval (see
    // _startFeedPulse) replaces a random row every ~3.2s with a fresh
    // entry from the larger pool, with a brief flash animation, so
    // the world reads as live + ongoing.
    const items = this._initialFeedRows();
    return items.map((row, i) => this._feedRowHTML(row, i)).join('');
  }
  _feedRowHTML([name, status, val], idx) {
    return `<div class="feed-row ${status.toLowerCase()}" data-feed-idx="${idx}">
      <span class="feed-name">${name}</span>
      <span class="feed-val">${val}c</span>
      <span class="feed-status">${status}</span>
    </div>`;
  }
  _initialFeedRows() {
    if (!this._feedPool) {
      // Fake-name pool — the more colorful, the better. Each pulse
      // pulls a random one, randomizes status + value.
      this._feedPool = [
        'THE BUTCHER', 'CAPTAIN AGENA', 'THE SMUGGLER', 'DR. SILAS',
        'THE FOX', 'JAGUAR', 'NIGHTSHADE', 'HEX WIDOW',
        'BARON CASE', 'MS. NUMBERS', 'THE PARSON', 'CIPHER',
        'GRAY DRESS', 'THE CHAPLAIN', 'OLD MR. BLAKE', 'WIDOW STARK',
        'THE COURIER', 'LEFT-HAND LARK', 'COUNT VEY', 'THE GLASSMAN',
        'INDEX', 'THE FIDDLER', 'SEVEN', 'KESTREL',
        'BLACKHALL', 'THE COMPTROLLER', 'PINHEAD GLORY', 'TWICE-DEAD JANE',
        'MR. EVENING', 'THE SPONSOR', 'CONVALESCE', 'OUR LADY OF KNIVES',
      ];
    }
    const out = [];
    const used = new Set();
    while (out.length < 8) {
      const name = this._feedPool[Math.floor(Math.random() * this._feedPool.length)];
      if (used.has(name)) continue;
      used.add(name);
      out.push([name, this._randomFeedStatus(), this._randomFeedValue()]);
    }
    return out;
  }
  _randomFeedStatus() {
    const r = Math.random();
    if (r < 0.45) return 'CLOSED';
    if (r < 0.75) return 'CLAIMED';
    return 'OPEN';
  }
  _randomFeedValue() {
    const tier = Math.random();
    const base = tier < 0.55 ? 800 + Math.floor(Math.random() * 2400)
              : tier < 0.85 ? 3200 + Math.floor(Math.random() * 5500)
              :               9000 + Math.floor(Math.random() * 18000);
    // Round to a believable hundreds value.
    return Math.round(base / 50) * 50;
  }
  _startFeedPulse() {
    if (this._feedIntervalId) return;
    this._feedIntervalId = setInterval(() => {
      // Bail if we left the contractor stage's home/cards step —
      // those are the only places the feed is visible.
      if (!this.visible || this.tab !== 'contractor'
          || (this.contractorStep !== 'home' && this.contractorStep !== 'cards')) {
        return;
      }
      const feedEl = this.root.querySelector('.contractor-feed');
      if (!feedEl) return;
      const rows = feedEl.querySelectorAll('.feed-row');
      if (!rows.length) return;
      // Pick a random row, flash it, swap content with a fresh entry.
      const row = rows[Math.floor(Math.random() * rows.length)];
      const [newName, newStatus, newVal] = [
        this._feedPool[Math.floor(Math.random() * this._feedPool.length)],
        this._randomFeedStatus(),
        this._randomFeedValue(),
      ];
      row.classList.add('pulse');
      setTimeout(() => {
        row.className = `feed-row ${newStatus.toLowerCase()} pulse`;
        row.querySelector('.feed-name').textContent = newName;
        row.querySelector('.feed-val').textContent = `${newVal}c`;
        row.querySelector('.feed-status').textContent = newStatus;
      }, 180);
      setTimeout(() => row.classList.remove('pulse'), 800);
    }, 3200);
  }
  _stopFeedPulse() {
    if (this._feedIntervalId) clearInterval(this._feedIntervalId);
    this._feedIntervalId = 0;
  }

  _renderBoardListHTML(defs) {
    // Right-side board listing — top 6 visible defs by reward.
    const ranked = defs.slice().sort((a, b) => {
      const aT = (a.perKillReward | 0) * (a.targetCount | 0) + (a.reward | 0);
      const bT = (b.perKillReward | 0) * (b.targetCount | 0) + (b.reward | 0);
      return bT - aT;
    }).slice(0, 6);
    return ranked.map(def => {
      const total = (def.perKillReward | 0) * (def.targetCount | 0) + (def.reward | 0);
      return `
        <div class="board-row">
          <span class="board-name">${def.label.toUpperCase()}</span>
          <span class="board-val">${total}c</span>
        </div>
      `;
    }).join('');
  }

  _refreshCountdownStr() {
    const dayMs = 24 * 3600000;
    const remaining = dayMs - (Date.now() % dayMs);
    const h = Math.floor(remaining / 3600000);
    const m = Math.floor((remaining % 3600000) / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  // Plain-English label for a target archetype + count. Pluralizes
  // sensibly so "1 megaboss" and "5 dasher bosses" both read.
  _targetLabel(type, count) {
    const n = count | 0;
    const plural = n === 1 ? '' : 's';
    switch (type) {
      case 'dasher':   return `dasher${plural}`;
      case 'tank':     return `tank${plural}`;
      case 'gunman':   return n === 1 ? 'gunman' : 'gunmen';
      case 'melee':    return n === 1 ? 'melee enemy' : 'melee enemies';
      case 'sniper':   return `sniper${plural}`;
      case 'boss':     return `boss${n === 1 ? '' : 'es'}`;
      case 'megaboss': return `megaboss${n === 1 ? '' : 'es'}`;
      default:         return `enem${n === 1 ? 'y' : 'ies'}`;
    }
  }

  // Lightweight glyph for the portrait box — emoji-free, single
  // letter / symbol that maps to the archetype. Replace with real
  // boss portraits once art lands.
  _portraitGlyph(portrait) {
    switch (portrait) {
      case 'dasher':   return '»';
      case 'tank':     return '■';
      case 'gunman':   return '⨯';
      case 'melee':    return '✕';
      case 'sniper':   return '◎';
      case 'boss':     return '★';
      case 'megaboss': return '✪';
      case 'any':
      default:         return '◇';
    }
  }

  _renderModifierList(def) {
    const m = def.modifiers || {};
    const lines = [];
    if (m.weaponClass === 'pistol') lines.push('Pistols only');
    if (m.weaponClass === 'melee')  lines.push('Melee only');
    if (m.noConsumables)            lines.push('No consumables');
    if ((m.enemyHpMult || 1) > 1)   lines.push(`Enemy HP +${Math.round((m.enemyHpMult - 1) * 100)}%`);
    if ((m.enemyDamageMult || 1) > 1) lines.push(`Enemy damage +${Math.round((m.enemyDamageMult - 1) * 100)}%`);
    if ((m.spawnDensityMult || 1) > 1) lines.push(`Spawn density +${Math.round((m.spawnDensityMult - 1) * 100)}%`);
    if ((m.eliteChanceMult || 1) > 1) lines.push(`Elites x${(m.eliteChanceMult).toFixed(1)}`);
    if ((m.playerDamageTakenMult || 1) > 1) lines.push(`You take +${Math.round((m.playerDamageTakenMult - 1) * 100)}% damage`);
    if ((m.playerDamageDealtMult || 1) !== 1) {
      const pct = Math.round((m.playerDamageDealtMult - 1) * 100);
      lines.push(`You deal ${pct >= 0 ? '+' : ''}${pct}% damage`);
    }
    if (!lines.length) return '';
    return `<ul class="row-mods">${lines.map(l => `<li>${l}</li>`).join('')}</ul>`;
  }

  _unlockText(def, state) {
    const u = def.unlockedAt || {};
    const parts = [];
    if (u.contractsCompleted) parts.push(`Rank ${state.contractsCompleted}/${u.contractsCompleted}`);
    if (u.megabossKills) parts.push(`Megabosses ${state.megabossKills}/${u.megabossKills}`);
    if (u.marks) parts.push(`Marks ${state.marks}/${u.marks}`);
    return parts.length ? `Unlocks at ${parts.join(', ')}` : 'Locked';
  }

  // ----- Recruiter — marks-spent permanent unlocks ------------------
  _renderRecruiterTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const marks = getMarks();
    const owned = getRecruiterUnlocks();

    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">RECRUITER</div>
      <div class="hideout-section-sub">Spend marks earned by dying. Permanent unlocks. <b>${marks}</b> marks on file.</div>
    `;
    wrap.appendChild(head);

    const groups = [
      { title: 'STAT TIERS',          ids: ['vit_1','vit_2','vit_3','end_1','end_2','comp_1'] },
      { title: 'STRUCTURAL UNLOCKS',  ids: ['npc_engineer','npc_cartog','class_demolisher','class_marksman'] },
    ];
    for (const grp of groups) {
      const sec = document.createElement('div');
      sec.style.marginTop = '8px';
      const t = document.createElement('div');
      t.className = 'hideout-tier-head';
      t.innerHTML = `<span class="t" style="color:#c9a87a">${grp.title}</span>`;
      sec.appendChild(t);
      for (const id of grp.ids) {
        const def = RECRUITER_UNLOCKS[id];
        if (!def) continue;
        sec.appendChild(this._renderRecruiterRow(def, owned, marks));
      }
      wrap.appendChild(sec);
    }
    return wrap;
  }

  _renderRecruiterRow(def, owned, marks) {
    const row = document.createElement('div');
    row.className = 'hideout-contract-row';
    const isOwned = owned.has(def.id);
    const reqsMet = !def.requires || def.requires.every(r => owned.has(r));
    const affordable = marks >= def.cost;
    const reqText = (!reqsMet && def.requires) ? `Requires ${def.requires.join(', ')}` : '';
    row.innerHTML = `
      <div class="row-head">
        <span class="label">${def.label}</span>
        <span class="reward">${def.cost} marks</span>
      </div>
      <div class="row-blurb">${def.blurb}</div>
      ${reqText ? `<div class="row-lock">🔒 ${reqText}</div>` : ''}
      <div class="row-actions"></div>
    `;
    const actions = row.querySelector('.row-actions');
    if (isOwned) {
      const tag = document.createElement('span');
      tag.className = 'hideout-tag claimed';
      tag.textContent = 'OWNED';
      actions.appendChild(tag);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hideout-btn primary';
      btn.textContent = 'Buy';
      btn.disabled = !reqsMet || !affordable;
      btn.addEventListener('click', () => {
        if (!reqsMet) return;
        if (!spendMarks(def.cost)) return;
        setRecruiterUnlocked(def.id);
        this.render();
      });
      actions.appendChild(btn);
    }
    return row;
  }

  // ----- Tailor — character customization (name + silhouette) ------
  // Mirrors the start-screen character-style toggle but lives in the
  // hideout for between-runs editing. ctx.applyCharacterStyle is used
  // to push the change to the live player rig if open mid-session.
  _renderTailorTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';

    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">TAILOR</div>
      <div class="hideout-section-sub">Character customization. Name + silhouette persist across runs.</div>
    `;
    wrap.appendChild(head);

    // Player name row.
    const nameSec = document.createElement('div');
    nameSec.className = 'hideout-tier-group';
    nameSec.innerHTML = `<div class="hideout-tier-head"><span class="t" style="color:#c9a87a">CALLSIGN</span></div>`;
    const nameRow = document.createElement('div');
    nameRow.className = 'hideout-contract-row';
    nameRow.innerHTML = `
      <div class="row-head"><span class="label">Name on the leaderboard</span></div>
      <div class="row-blurb">16 characters max. Used on submitted runs.</div>
      <div class="row-actions"></div>
    `;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.value = getPlayerName();
    input.placeholder = 'anon';
    Object.assign(input.style, {
      background: '#0c0e14', border: '1px solid #2a2f3a',
      color: '#e8dfc8', padding: '6px 10px', fontSize: '12px',
      letterSpacing: '0.6px', borderRadius: '3px', minWidth: '160px',
    });
    input.addEventListener('change', () => setPlayerName(input.value));
    input.addEventListener('blur',   () => setPlayerName(input.value));
    nameRow.querySelector('.row-actions').appendChild(input);
    nameSec.appendChild(nameRow);
    wrap.appendChild(nameSec);

    // Silhouette style row.
    const styleSec = document.createElement('div');
    styleSec.className = 'hideout-tier-group';
    styleSec.innerHTML = `<div class="hideout-tier-head"><span class="t" style="color:#c9a87a">SILHOUETTE</span></div>`;
    const styles = [
      { id: 'operator', label: 'Operator', blurb: 'Stripped tactical silhouette. The default.' },
      { id: 'marine',   label: 'Marine',   blurb: 'Heavy pauldrons and pack. Reads bigger from across a room.' },
    ];
    const current = getCharacterStyle();
    for (const s of styles) {
      const row = document.createElement('div');
      row.className = 'hideout-contract-row' + (current === s.id ? ' active' : '');
      row.innerHTML = `
        <div class="row-head"><span class="label">${s.label}</span></div>
        <div class="row-blurb">${s.blurb}</div>
        <div class="row-actions"></div>
      `;
      const actions = row.querySelector('.row-actions');
      if (current === s.id) {
        const tag = document.createElement('span');
        tag.className = 'hideout-tag active';
        tag.textContent = 'EQUIPPED';
        actions.appendChild(tag);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hideout-btn primary';
        btn.textContent = 'Wear';
        btn.addEventListener('click', () => {
          setCharacterStyle(s.id);
          if (this.ctx.applyCharacterStyle) this.ctx.applyCharacterStyle(s.id);
          this.render();
        });
        actions.appendChild(btn);
      }
      styleSec.appendChild(row);
    }
    wrap.appendChild(styleSec);

    // Color palette section — primary, accent, skin, hair pickers.
    // Persisted via prefs and pushed live to the player rig via
    // ctx.applyCharacterAppearance hook.
    const appearance = getCharacterAppearance();
    const colorSec = document.createElement('div');
    colorSec.className = 'hideout-tier-group';
    colorSec.innerHTML = `<div class="hideout-tier-head"><span class="t" style="color:#c9a87a">COLORS</span></div>`;
    const colorFields = [
      { key: 'primary', label: 'Primary',  blurb: 'Jacket / armor body color.' },
      { key: 'accent',  label: 'Accent',   blurb: 'Straps, trim, accent stitching.' },
      { key: 'skin',    label: 'Skin',     blurb: 'Skin tone for exposed areas.' },
      { key: 'hair',    label: 'Hair',     blurb: 'Hair / beard color.' },
    ];
    for (const f of colorFields) {
      const row = document.createElement('div');
      row.className = 'hideout-contract-row';
      row.innerHTML = `
        <div class="row-head"><span class="label">${f.label}</span></div>
        <div class="row-blurb">${f.blurb}</div>
        <div class="row-actions"></div>
      `;
      const actions = row.querySelector('.row-actions');
      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.value = appearance[f.key] || APPEARANCE_DEFAULTS[f.key];
      Object.assign(swatch.style, {
        width: '52px', height: '32px', border: '1px solid #2a2f3a',
        background: '#0c0e14', cursor: 'pointer', padding: '0', borderRadius: '3px',
      });
      swatch.addEventListener('input', () => {
        setCharacterAppearance({ [f.key]: swatch.value });
        if (this.ctx.applyCharacterAppearance) this.ctx.applyCharacterAppearance(getCharacterAppearance());
      });
      actions.appendChild(swatch);
      colorSec.appendChild(row);
    }
    wrap.appendChild(colorSec);

    // Accessory toggles — helmet on/off, vest overlay on/off.
    const toggleSec = document.createElement('div');
    toggleSec.className = 'hideout-tier-group';
    toggleSec.innerHTML = `<div class="hideout-tier-head"><span class="t" style="color:#c9a87a">ACCESSORIES</span></div>`;
    const toggles = [
      { key: 'helmet',   label: 'Helmet',        blurb: 'Wear a helmet by default. Run pickups can override.' },
      { key: 'vestOver', label: 'Tactical Vest', blurb: 'Visible plate carrier overlay on the rig.' },
    ];
    for (const t of toggles) {
      const row = document.createElement('div');
      row.className = 'hideout-contract-row' + (appearance[t.key] ? ' active' : '');
      row.innerHTML = `
        <div class="row-head"><span class="label">${t.label}</span></div>
        <div class="row-blurb">${t.blurb}</div>
        <div class="row-actions"></div>
      `;
      const actions = row.querySelector('.row-actions');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hideout-btn primary';
      btn.textContent = appearance[t.key] ? 'On' : 'Off';
      btn.addEventListener('click', () => {
        setCharacterAppearance({ [t.key]: !appearance[t.key] });
        if (this.ctx.applyCharacterAppearance) this.ctx.applyCharacterAppearance(getCharacterAppearance());
        this.render();
      });
      actions.appendChild(btn);
      toggleSec.appendChild(row);
    }
    wrap.appendChild(toggleSec);

    // Reset row.
    const resetRow = document.createElement('div');
    resetRow.className = 'hideout-upgrade-row';
    resetRow.style.marginTop = '14px';
    resetRow.innerHTML = `
      <span>Restore default appearance.</span>
      <button type="button" class="hideout-buy">Reset</button>
    `;
    resetRow.querySelector('.hideout-buy').addEventListener('click', () => {
      setCharacterAppearance({ ...APPEARANCE_DEFAULTS });
      if (this.ctx.applyCharacterAppearance) this.ctx.applyCharacterAppearance(getCharacterAppearance());
      this.render();
    });
    wrap.appendChild(resetRow);

    return wrap;
  }

  // ----- Mailbox (v1 stub, locked until co-op) ----------------------
  _renderMailboxTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `<div class="hideout-section-title">MAILBOX</div>`;
    wrap.appendChild(head);
    const upg = getHideoutUpgrades();
    const p = document.createElement('div');
    p.className = 'hideout-placeholder';
    p.innerHTML = upg.mailboxUnlocked
      ? `Mailbox UI is incoming with co-op v2.`
      : `<span class="muted">Mailbox unlocks once you've played a co-op session.</span>`;
    wrap.appendChild(p);
    return wrap;
  }

  // ----- Styles ------------------------------------------------------
  _injectStyles() {
    if (document.getElementById('hideout-styles')) return;
    const style = document.createElement('style');
    style.id = 'hideout-styles';
    style.textContent = `
      #hideout-root {
        position: fixed; inset: 0;
        /* Transparent — diegetic scene shows fully. Floating
           components are positioned absolutely on the edges. */
        background: transparent;
        z-index: 110;
        pointer-events: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      #hideout-root > * { pointer-events: auto; }

      /* Hide the in-game HUD while the hideout is the active surface.
         The player isn't in a run — HP / weapon / keycards / minimap
         shouldn't draw underneath. Hideout's own components have
         their own ids and aren't matched by these selectors. */
      body.hideout-active #hud,
      body.hideout-active #hud-bl,
      body.hideout-active #weapon-info,
      body.hideout-active #boss-bar,
      body.hideout-active #hud-toast,
      body.hideout-active #hurt-flash,
      body.hideout-active #controls-hint,
      body.hideout-active #minimap,
      body.hideout-active #hud-overhead,
      body.hideout-active #hud-stealth,
      body.hideout-active #reticle,
      body.hideout-active #cursor-bloom,
      body.hideout-active #hud-stats,
      body.hideout-active #keycard-panel,
      body.hideout-active #keycard-hud,
      body.hideout-active #hp {
        display: none !important;
      }

      /* TOP BAR — floats over the top edge with sysmenu + title + wallets */
      #hideout-topbar {
        position: absolute; top: 16px; left: 16px; right: 16px;
        display: flex; align-items: center; gap: 16px;
        padding: 10px 18px;
        background: linear-gradient(180deg, rgba(14,16,24,0.85) 0%, rgba(14,16,24,0.65) 100%);
        border: 1px solid rgba(90,138,207,0.4); border-radius: 6px;
        backdrop-filter: blur(4px);
        box-shadow: 0 4px 18px rgba(0,0,0,0.6);
        color: #e8dfc8;
      }

      /* BOTTOM-RIGHT ACTION CLUSTER — Quick Start + Start Run */
      #hideout-actions {
        position: absolute; bottom: 20px; right: 20px;
        display: flex; gap: 8px;
      }

      /* BOTTOM-LEFT TAB STRIP — vertical column tucked into corner */
      #hideout-tabs {
        position: absolute; bottom: 20px; left: 20px;
        display: flex; flex-direction: column; gap: 4px;
        background: linear-gradient(180deg, rgba(14,16,24,0.85) 0%, rgba(14,16,24,0.65) 100%);
        border: 1px solid rgba(90,138,207,0.4); border-radius: 6px;
        padding: 8px;
        backdrop-filter: blur(4px);
        box-shadow: 0 4px 18px rgba(0,0,0,0.6);
        max-height: calc(100vh - 180px); overflow-y: auto;
      }
      #hideout-tabs .hideout-tab { text-align: left; min-width: 160px; }

      /* FLOATING CONTENT PANEL — right side, scrollable */
      #hideout-panel {
        position: absolute; top: 84px; right: 16px; bottom: 80px;
        width: 580px; max-width: 50vw;
        background: linear-gradient(180deg, rgba(14,16,24,0.92) 0%, rgba(14,16,24,0.95) 100%);
        border: 1px solid rgba(90,138,207,0.4); border-radius: 6px;
        padding: 14px 18px;
        overflow-y: auto;
        color: #e8dfc8;
        box-shadow: 0 8px 28px rgba(0,0,0,0.75);
        backdrop-filter: blur(3px);
      }
      #hideout-panel::-webkit-scrollbar { width: 8px; }
      #hideout-panel::-webkit-scrollbar-track { background: transparent; }
      #hideout-panel::-webkit-scrollbar-thumb { background: #2a2f3a; border-radius: 4px; }
      #hideout-panel::-webkit-scrollbar-thumb:hover { background: #3a3f4a; }

      /* Stash twocol — compress to single column inside the narrower
         panel (paperdoll moves below or hides). */
      #hideout-panel .hideout-stash-twocol { grid-template-columns: 1fr; }
      #hideout-panel .hideout-paperdoll-col { display: none; }

      /* === CONTRACTOR STAGE === */
      /* When the contractor tab is active, the panel takes the full
         window — no tab strip. Edge-to-edge stage. */
      #hideout-panel:has(.contractor-stage) {
        top: 84px; right: 16px; bottom: 16px; left: 16px;
        width: auto; max-width: none;
        padding: 0; overflow: hidden;
        background: linear-gradient(180deg, rgba(12,14,22,0.95) 0%, rgba(20,16,28,0.96) 100%);
      }
      .contractor-stage {
        position: relative;
        width: 100%; height: 100%;
        background: linear-gradient(180deg, #0c0e16 0%, #14101c 100%);
        overflow: hidden;
      }

      .contractor-feed {
        position: absolute; top: 14px; left: 14px; bottom: 14px;
        width: 200px;
        background: rgba(10,12,18,0.6);
        border: 1px solid rgba(90,138,207,0.25); border-radius: 4px;
        padding: 10px 12px; overflow-y: auto;
      }
      .contractor-feed .feed-head {
        font-size: 10px; letter-spacing: 1.6px; color: #5a8acf;
        margin-bottom: 8px; padding-bottom: 6px;
        border-bottom: 1px solid rgba(90,138,207,0.2);
      }
      .feed-row {
        display: grid; grid-template-columns: 1fr auto;
        gap: 4px; padding: 4px 0;
        font-size: 10px; line-height: 1.3;
      }
      .feed-row .feed-name { color: #c9a87a; letter-spacing: 0.6px; }
      .feed-row .feed-val { color: #9b8b6a; }
      .feed-row .feed-status {
        grid-column: 1/-1; font-size: 8px; letter-spacing: 1.2px; color: #6f6754;
      }
      .feed-row.closed .feed-status { color: #d24868; }
      .feed-row.claimed .feed-status { color: #6abf78; }
      .feed-row.open .feed-status { color: #f2c060; }

      .contractor-board {
        position: absolute; top: 14px; right: 14px;
        width: 220px;
        background: rgba(10,12,18,0.6);
        border: 1px solid rgba(90,138,207,0.25); border-radius: 4px;
        padding: 10px 12px;
      }
      .contractor-board .board-head {
        font-size: 10px; letter-spacing: 1.6px; color: #5a8acf;
        margin-bottom: 8px; padding-bottom: 6px;
        border-bottom: 1px solid rgba(90,138,207,0.2);
      }
      .board-row {
        display: flex; justify-content: space-between;
        padding: 4px 0; font-size: 11px;
      }
      .board-row .board-name { color: #c9a87a; letter-spacing: 0.4px; }
      .board-row .board-val { color: #f2c060; font-weight: 700; }

      .contractor-host {
        position: absolute; top: 30px; left: 50%;
        transform: translateX(-50%);
        display: flex; flex-direction: column; align-items: center;
        gap: 14px; max-width: 540px;
      }
      .host-portrait {
        width: 240px; height: 240px;
        background: radial-gradient(circle at 50% 35%, #2a1a2a 0%, #0a0a14 90%);
        border: 2px solid rgba(178,112,224,0.4); border-radius: 8px;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 8px 32px rgba(0,0,0,0.7), inset 0 0 30px rgba(178,112,224,0.15);
      }
      .host-glyph {
        font-size: 90px; color: #b870e0; opacity: 0.6;
        text-shadow: 0 0 24px rgba(178,112,224,0.6);
      }
      .host-bubble {
        background: rgba(20,16,28,0.92);
        border: 1px solid rgba(178,112,224,0.4);
        border-radius: 6px; padding: 10px 16px;
        max-width: 460px;
      }
      .host-quote {
        font-size: 12px; color: #c9a87a; font-style: italic;
        line-height: 1.5; letter-spacing: 0.4px;
      }

      /* Big golden CTA — bottom-center per spec */
      #contractor-cta {
        position: absolute; left: 50%; bottom: 60px;
        transform: translateX(-50%);
        background: linear-gradient(180deg, #f2c060 0%, #c98a3a 100%);
        border: 2px solid #f2c060;
        color: #1a1408; font-weight: 900;
        font-size: 22px; letter-spacing: 4px;
        padding: 16px 64px; border-radius: 4px;
        cursor: pointer;
        box-shadow: 0 0 40px rgba(242,192,96,0.5), 0 8px 24px rgba(0,0,0,0.6);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        text-transform: uppercase;
        transition: transform 0.18s, box-shadow 0.18s;
      }
      #contractor-cta:hover {
        transform: translateX(-50%) scale(1.04);
        box-shadow: 0 0 60px rgba(242,192,96,0.7), 0 12px 28px rgba(0,0,0,0.7);
      }
      .contractor-cta-sub {
        position: absolute; left: 50%; bottom: 30px;
        transform: translateX(-50%);
        font-size: 11px; color: #c9a87a; letter-spacing: 2px;
        text-transform: uppercase;
      }
      /* Cards step — host shifts up so cards have room at the bottom. */
      .contractor-stage.step-cards .contractor-host { top: 16px; }
      .contractor-stage.step-cards .host-portrait { width: 160px; height: 160px; }
      .contractor-stage.step-cards .host-glyph { font-size: 64px; }
      /* GLOBAL BACK BUTTON — pinned to the same place on every screen.
         Hard rule: never move this. Sits clear of the tab strip. */
      .global-back-btn {
        position: absolute; bottom: 18px; left: 24px;
        background: rgba(20,24,32,0.85);
        border: 1px solid rgba(155,139,106,0.4);
        color: #c9a87a; font: inherit; font-size: 11px;
        letter-spacing: 1.4px; padding: 8px 16px;
        border-radius: 4px; cursor: pointer;
        transition: background 0.15s, color 0.15s;
        z-index: 5;
      }
      .global-back-btn:hover {
        background: rgba(40,46,58,0.9);
        color: #e8dfc8; border-color: rgba(201,168,122,0.6);
      }

      /* Live-feed pulse animation when a row is updated */
      .feed-row { transition: background 0.18s; }
      .feed-row.pulse {
        background: rgba(242,192,96,0.18);
        animation: feed-pulse 0.6s ease-out;
      }
      @keyframes feed-pulse {
        0% { background: rgba(242,192,96,0.45); }
        100% { background: transparent; }
      }

      /* Compact leaderboard block under the live feed */
      .contractor-leaderboard-block {
        margin-top: 14px; padding-top: 10px;
        border-top: 1px dashed rgba(90,138,207,0.3);
      }
      .lb-block-head {
        font-size: 10px; letter-spacing: 1.6px; color: #5a8acf;
        margin-bottom: 8px;
      }
      .lb-block-row {
        display: grid; grid-template-columns: 18px 1fr auto;
        gap: 4px; padding: 3px 0;
        font-size: 10px; line-height: 1.3;
      }
      .lb-block-row .lb-rank { color: #6f6754; }
      .lb-block-row .lb-name { color: #c9a87a; }
      .lb-block-row .lb-val  { color: #f2c060; font-weight: 700; }
      .lb-block-empty {
        font-size: 10px; color: #6f6754; font-style: italic;
        padding: 4px 0;
      }
      .lb-view-all {
        margin-top: 8px; width: 100%;
        background: transparent; border: 1px solid rgba(90,138,207,0.4);
        color: #5a8acf; font: inherit; font-size: 10px;
        letter-spacing: 1.4px; padding: 6px;
        border-radius: 3px; cursor: pointer;
      }
      .lb-view-all:hover { background: rgba(90,138,207,0.1); color: #e8dfc8; }

      /* FULL-SCREEN LEADERBOARDS */
      .contractor-leaderboard-full {
        position: absolute; inset: 0;
        padding: 28px 28px 80px;
        display: flex; flex-direction: column;
        background: linear-gradient(180deg, rgba(12,14,22,0.97) 0%, rgba(20,16,28,0.98) 100%);
      }
      .lb-full-head { text-align: center; margin-bottom: 18px; }
      .lb-eyebrow {
        font-size: 10px; letter-spacing: 2.4px; color: #5a8acf;
        margin-bottom: 4px;
      }
      .lb-title {
        font-size: 22px; font-weight: 900; letter-spacing: 2.4px;
        color: #f2c060;
      }
      .lb-sub {
        font-size: 11px; color: #c9a87a; margin-top: 4px; letter-spacing: 1px;
      }
      .lb-full-cols {
        display: grid; grid-template-columns: repeat(4, 1fr);
        gap: 14px; flex: 1; min-height: 0; overflow: hidden;
      }
      .lb-full-col {
        background: rgba(10,12,18,0.6);
        border: 1px solid rgba(90,138,207,0.25);
        border-radius: 4px; padding: 10px;
        display: flex; flex-direction: column; gap: 4px;
        overflow-y: auto;
      }
      .lb-col-head {
        font-size: 10px; letter-spacing: 1.6px; color: #5a8acf;
        text-align: center; padding-bottom: 6px;
        border-bottom: 1px solid rgba(90,138,207,0.2);
        margin-bottom: 4px;
      }
      .lb-full-row {
        display: grid; grid-template-columns: 24px 1fr auto;
        gap: 6px; padding: 4px 6px;
        font-size: 11px; border-radius: 2px;
      }
      .lb-full-row:nth-child(even) { background: rgba(255,255,255,0.02); }
      .lb-full-row.empty { color: #4a505a; opacity: 0.6; }
      .lb-full-row .lb-rank { color: #6f6754; font-weight: 700; }
      .lb-full-row .lb-name { color: #c9a87a; }
      .lb-full-row .lb-val  { color: #f2c060; font-weight: 700; }

      /* === MISSION PREP / STASH === */
      .prep-banner {
        position: absolute; top: 28px; left: 50%;
        transform: translateX(-50%);
        text-align: center; pointer-events: none;
      }
      .prep-eyebrow {
        font-size: 10px; letter-spacing: 2.4px; color: #5a8acf;
        margin-bottom: 4px;
      }
      .prep-title {
        font-size: 22px; font-weight: 900; letter-spacing: 2.4px;
        color: #f2c060;
      }
      .prep-sub {
        font-size: 11px; color: #c9a87a; margin-top: 4px; letter-spacing: 1px;
      }
      /* Mission-prep three-column grid. Per the design brief, the
         armory is the most prestigious surface — equal width with
         the paperdoll, store column narrower since it's the lowest
         priority of the three (boost shop, not mandatory). */
      .contractor-loadout {
        position: absolute; inset: 0;
        display: grid;
        grid-template-columns: 300px minmax(0, 1.5fr) 280px;
        gap: 16px; padding: 92px 24px 96px;
      }
      .loadout-storecol { overflow-y: auto; }
      .loadout-armorycol { overflow-y: auto; }
      .prep-section-head {
        font-size: 10px; letter-spacing: 1.6px; color: #5a8acf;
        margin-bottom: 8px; padding-bottom: 6px;
        border-bottom: 1px solid rgba(90,138,207,0.2);
      }
      .loadout-panel {
        background: rgba(10,12,18,0.55);
        border: 1px solid rgba(90,138,207,0.25);
        border-radius: 4px; padding: 12px;
        display: flex; flex-direction: column;
        overflow: hidden; min-height: 0;
      }
      /* === ARMORY — prestigious unlock collection === */
      .armory-head {
        text-align: center; margin-bottom: 14px;
      }
      .armory-eyebrow {
        font-size: 10px; letter-spacing: 2.4px; color: #5a8acf;
      }
      .armory-title {
        font-size: 16px; font-weight: 900; letter-spacing: 2px;
        color: #f2c060; margin-top: 2px;
      }
      .armory-count {
        font-size: 11px; color: #c9a87a; margin-top: 4px; letter-spacing: 0.8px;
      }
      .armory-count b { color: #f2c060; font-weight: 700; }
      /* Armory two-column split — AVAILABLE | LOCKED. Both halves
         use the same compact tile size for visual consistency with
         the pre-mission store. */
      .armory-split {
        flex: 1; min-height: 0; overflow: hidden;
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 14px;
      }
      .armory-half {
        display: flex; flex-direction: column;
        min-height: 0; overflow: hidden;
      }
      .armory-half-head {
        font-size: 10px; letter-spacing: 1.6px; color: #5a8acf;
        margin-bottom: 8px; padding-bottom: 6px;
        border-bottom: 1px solid rgba(90,138,207,0.2);
      }
      .armory-half-empty {
        font-size: 10px; color: #6f6754; font-style: italic;
        padding: 16px 8px; text-align: center;
        grid-column: 1 / -1;
      }
      /* Tile grid — cells stay top-aligned, never stretch to fill
         empty vertical space. */
      .armory-tile-grid {
        flex: 1; min-height: 0; overflow-y: auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px; padding-right: 2px;
        align-content: start;
      }

      /* Mini tile — same shape + scale as the pre-mission store
         tiles. Icon on top, name, meta, stat snippet, action CTA. */
      .armory-mini {
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid #2a2f3a; border-radius: 4px;
        padding: 8px;
        font: inherit; color: #e8dfc8;
        display: flex; flex-direction: column; gap: 4px;
      }
      .armory-mini.state-taking {
        background: linear-gradient(180deg, rgba(40,32,12,0.98), rgba(24,18,6,0.98));
        box-shadow: 0 0 12px rgba(242,192,96,0.35);
      }
      .armory-mini.state-locked {
        opacity: 0.55; filter: grayscale(0.5);
      }
      .armory-mini.rarity-uncommon  { background: linear-gradient(180deg, rgba(18,28,20,0.92), rgba(10,16,12,0.92)); }
      .armory-mini.rarity-rare      { background: linear-gradient(180deg, rgba(18,26,38,0.92), rgba(10,14,24,0.92)); }
      .armory-mini.rarity-epic      { background: linear-gradient(180deg, rgba(26,16,38,0.92), rgba(14,8,24,0.92)); }
      .armory-mini.rarity-legendary { background: linear-gradient(180deg, rgba(38,26,10,0.95), rgba(22,16,6,0.95)); }

      .amini-icon {
        height: 56px;
        background: rgba(0,0,0,0.3); border-radius: 3px;
        display: flex; align-items: center; justify-content: center;
      }
      .amini-icon img {
        max-width: 100%; max-height: 100%;
        image-rendering: pixelated; object-fit: contain;
      }
      .amini-icon-fallback { font-size: 28px; color: rgba(155,139,106,0.45); font-weight: 700; }
      .amini-name {
        font-size: 12px; font-weight: 700; letter-spacing: 0.4px;
        line-height: 1.2;
        max-width: 100%; overflow: hidden;
        white-space: nowrap; text-overflow: ellipsis;
      }
      .armory-mini.rarity-uncommon  .amini-name { color: #6abf78; }
      .armory-mini.rarity-rare      .amini-name { color: #5a8acf; }
      .armory-mini.rarity-epic      .amini-name { color: #b870e0; }
      .armory-mini.rarity-legendary .amini-name { color: #f2a040; }
      .amini-meta {
        font-size: 9px; color: #9b8b6a; letter-spacing: 0.4px;
        text-transform: uppercase;
      }
      .amini-stats {
        display: flex; gap: 6px; flex-wrap: wrap;
        font-size: 10px; min-height: 13px;
      }
      .amini-stat { color: #c9a87a; }
      .amini-cta {
        margin-top: 2px; padding: 5px;
        font: inherit; font-size: 10px; font-weight: 700;
        letter-spacing: 1px; text-transform: uppercase;
        border: 1px solid #4a505a; border-radius: 3px;
        text-align: center; cursor: pointer;
        background: linear-gradient(180deg, #2a2f3a, #1a1d24);
        color: #c9a87a;
      }
      button.amini-cta:hover:not(:disabled) {
        background: linear-gradient(180deg, #3a3f4a, #2a2d34);
        color: #e8dfc8;
      }
      button.amini-cta:disabled { opacity: 0.45; cursor: not-allowed; }
      .amini-cta.taking {
        background: linear-gradient(180deg, #f2c060, #c98a3a);
        color: #1a1408; border-color: #f2c060;
      }
      .amini-cta.buy {
        background: linear-gradient(180deg, #2a4a6e, #1e3450);
        color: #e8dfc8; border-color: #5a8acf;
      }
      button.amini-cta.buy:hover:not(:disabled) {
        background: linear-gradient(180deg, #3a5a7e, #2e4460);
      }
      .amini-cta.locked {
        background: rgba(20,24,32,0.5); color: #6f6754;
        border-style: dashed;
      }

      /* Store sub-blurb */
      .store-blurb {
        font-size: 10px; color: #9b8b6a; line-height: 1.4;
        margin-bottom: 10px;
      }
      .loadout-storecol {
        display: flex; flex-direction: column;
      }
      .store-upgrades {
        display: grid; grid-template-columns: 1fr; gap: 6px;
        margin-bottom: 10px;
      }
      .store-upgrade-tile {
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid rgba(90,138,207,0.4);
        border-radius: 4px; padding: 8px 12px;
        text-align: left; font: inherit; color: #e8dfc8;
        cursor: pointer;
        transition: background 0.12s;
      }
      .store-upgrade-tile:hover:not(:disabled) {
        background: linear-gradient(180deg, #232730, #181c25);
      }
      .store-upgrade-tile:disabled { opacity: 0.45; cursor: not-allowed; }
      .sut-title {
        font-size: 11px; font-weight: 700; letter-spacing: 1.2px;
        color: #c9a87a;
      }
      .sut-sub {
        font-size: 10px; color: #f2c060; margin-top: 2px; letter-spacing: 0.4px;
      }
      .store-stock {
        flex: 1; min-height: 0;
        display: flex; flex-direction: column;
        margin-bottom: 10px;
      }
      .store-stock-label {
        font-size: 10px; letter-spacing: 1.4px; color: #5a8acf;
        margin-bottom: 6px;
      }
      .store-stock-list {
        display: grid; grid-template-columns: repeat(2, 1fr);
        gap: 8px; overflow-y: auto;
      }
      .store-footer {
        display: flex; flex-direction: column; gap: 6px;
        padding-top: 10px;
        border-top: 1px dashed rgba(90,138,207,0.3);
      }
      .store-refresh-btn {
        background: linear-gradient(180deg, #f2c060 0%, #c98a3a 100%);
        border: 1px solid #f2c060; color: #1a1408;
        font: inherit; font-size: 12px; font-weight: 700;
        letter-spacing: 1.4px; padding: 10px;
        border-radius: 3px; cursor: pointer; text-transform: uppercase;
      }
      .store-refresh-btn:hover:not(:disabled) {
        background: linear-gradient(180deg, #ffd070 0%, #d99a4a 100%);
      }
      .store-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .store-faster-btn {
        background: rgba(20,24,32,0.85);
        border: 1px solid rgba(155,139,106,0.4); color: #c9a87a;
        font: inherit; font-size: 10px; letter-spacing: 1px;
        padding: 6px; border-radius: 3px; cursor: pointer;
      }
      .store-faster-btn:hover:not(:disabled) {
        background: rgba(40,46,58,0.85); color: #e8dfc8;
      }
      .store-faster-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .store-timer {
        text-align: center; font-size: 9px; letter-spacing: 1.4px;
        color: #6f6754;
      }

      /* Inventory-style tile for weapons + store items */
      .loadout-collabel {
        display: flex; justify-content: space-between; align-items: baseline;
        font-size: 11px; letter-spacing: 1.6px; color: #5a8acf;
        margin-bottom: 8px; padding-bottom: 6px;
        border-bottom: 1px solid rgba(90,138,207,0.2);
      }
      .store-refresh-meta {
        font-size: 9px; color: #6f6754; letter-spacing: 1px;
      }
      .loadout-tile-grid {
        display: grid; grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .loadout-tile {
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid #2a2f3a; border-radius: 4px;
        padding: 8px; cursor: pointer;
        text-align: left; font: inherit; color: #e8dfc8;
        display: flex; flex-direction: column; gap: 4px;
        transition: transform 0.12s, box-shadow 0.12s;
      }
      .loadout-tile:hover:not(:disabled):not(.empty):not(.sold) {
        transform: translateY(-2px);
        box-shadow: 0 6px 14px rgba(0,0,0,0.5);
      }
      .loadout-tile.selected {
        background: linear-gradient(180deg, #221f12, #16140a);
        border-color: #f2c060;
      }
      .loadout-tile.empty {
        text-align: center; color: #4a505a;
        align-items: center; justify-content: center; min-height: 80px;
      }
      .loadout-tile.sold { opacity: 0.55; }
      .lt-icon {
        height: 56px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.3); border-radius: 3px;
        margin-bottom: 2px;
      }
      .lt-icon img {
        max-width: 100%; max-height: 100%;
        image-rendering: pixelated;
        object-fit: contain;
      }
      .lt-icon-fallback {
        width: 36px; height: 36px;
        background: #2a2f3a; border-radius: 3px;
      }
      .lt-name {
        font-size: 12px; font-weight: 700; letter-spacing: 0.4px;
        line-height: 1.2;
      }
      .lt-meta { font-size: 9px; color: #9b8b6a; letter-spacing: 0.4px; }
      .lt-stats {
        display: flex; gap: 8px; flex-wrap: wrap;
        font-size: 10px;
      }
      .lt-stat { color: #c9a87a; }
      .lt-stat.lt-cost { color: #f2c060; font-weight: 700; }
      .lt-sold {
        text-align: center; font-weight: 700; letter-spacing: 1.2px;
        color: #6abf78; font-size: 11px; padding: 8px 0;
      }
      .lt-buy {
        margin-top: 4px;
        background: linear-gradient(180deg, #2a4a6e, #1e3450);
        border: 1px solid #5a8acf; color: #e8dfc8;
        font: inherit; font-size: 10px; letter-spacing: 1px;
        padding: 5px; border-radius: 3px; cursor: pointer;
        text-transform: uppercase; font-weight: 700;
      }
      .lt-buy:hover:not(:disabled) { background: linear-gradient(180deg, #3a5a7e, #2e4460); }
      .lt-buy:disabled { opacity: 0.45; cursor: not-allowed; }

      .loadout-charcol {
        display: flex; flex-direction: column; gap: 14px;
        overflow-y: auto;
      }
      /* Paperdoll — 3-column layout matching the in-game equipment
         screen. Left + right columns hold slot tiles; center holds
         the character figure plus three callout panels. */
      .paperdoll-grid3 {
        display: grid;
        grid-template-columns: 1fr 1.4fr 1fr;
        gap: 6px;
      }
      .pd-col { display: flex; flex-direction: column; gap: 4px; }

      .pd-tile {
        position: relative;
        background: linear-gradient(180deg, rgba(27,30,36,0.82), rgba(20,23,29,0.82));
        border: 1px solid #2c323c; border-radius: 5px;
        padding: 6px 4px;
        display: flex; flex-direction: column; align-items: center;
        gap: 4px;
        min-height: 56px;
      }
      .pd-tile.filled {
        background: linear-gradient(180deg, rgba(38,43,52,0.95), rgba(28,32,40,0.95));
        border-color: #4a5968;
      }
      .pd-tile.pd-weapon1.filled { border-color: #f2c060; }
      .pd-tile-label {
        font-size: 9px; letter-spacing: 1.4px; color: #7a6f54;
      }
      .pd-tile.filled .pd-tile-label { color: #c9a87a; }
      .pd-tile-icon {
        flex: 1;
        display: flex; align-items: center; justify-content: center;
        min-height: 26px; max-height: 36px;
      }
      .pd-tile-glyph {
        font-size: 16px; color: #4a505a; opacity: 0.7;
      }
      .pd-tile-art {
        max-width: 100%; max-height: 100%;
        object-fit: contain; image-rendering: pixelated;
      }
      .pd-tile-name {
        font-size: 10px; color: #e8dfc8; font-weight: 700;
        letter-spacing: 0.4px; text-align: center;
        overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
        max-width: 100%;
      }

      /* Center column callouts + figure */
      .pd-col-center { gap: 6px; }
      .pd-figure-frame {
        flex: 1; min-height: 140px;
        background: radial-gradient(ellipse at 50% 35%, #20232c 0%, #0c0f15 80%);
        border: 1px solid #2c323c; border-radius: 5px;
        display: flex; align-items: center; justify-content: center;
      }
      .pd-figure-glyph {
        font-size: 56px; color: rgba(155,139,106,0.45);
      }
      .pd-callout {
        background: rgba(20,23,29,0.85);
        border: 1px solid #2c323c; border-radius: 5px;
        padding: 6px 8px; text-align: center;
      }
      .pd-callout-label {
        font-size: 10px; letter-spacing: 1.6px; font-weight: 700;
        color: #c9a87a; margin-bottom: 2px;
      }
      .pd-callout-relics .pd-callout-label { color: #b870e0; }
      .pd-callout-skills .pd-callout-label { color: #6abf78; }
      .pd-callout-body {
        font-size: 9px; color: #6f6754; line-height: 1.35;
        font-style: italic;
      }

      /* Starter pocket icon strip — replaces the bigger pockets/
         backpack grids. Just shows the starter consumables visually. */
      .pd-starter-strip {
        margin-top: 10px; padding-top: 10px;
        border-top: 1px dashed rgba(90,138,207,0.25);
      }
      .pd-starter-label {
        font-size: 9px; letter-spacing: 1.6px; color: #5a8acf;
        margin-bottom: 6px;
      }
      .pd-starter-icons { display: flex; gap: 6px; }
      .pd-starter-ico {
        width: 36px; height: 36px;
        background: rgba(20,30,46,0.85); border: 1px solid #2a2f3a;
        border-radius: 3px;
        display: flex; align-items: center; justify-content: center;
      }
      .pd-starter-ico img { max-width: 80%; max-height: 80%; image-rendering: pixelated; }
      .pd-starter-ico.empty { color: #6f6754; font-size: 10px; }
      .pd-starter-ico.throwable {
        color: #c98a3a; font-size: 18px; font-weight: 700;
        background: rgba(40,28,16,0.85); border-color: rgba(201,138,58,0.4);
      }
      .loadout-confirm {
        position: absolute; left: 50%; bottom: 44px;
        transform: translateX(-50%);
        background: linear-gradient(180deg, #4a8acf 0%, #2a6aaf 100%);
        border: 2px solid #5a8acf; color: #fff;
        font-weight: 900; font-size: 18px; letter-spacing: 3px;
        padding: 14px 48px; border-radius: 4px; cursor: pointer;
        box-shadow: 0 0 40px rgba(90,138,207,0.45), 0 8px 24px rgba(0,0,0,0.6);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        text-transform: uppercase;
      }
      .loadout-confirm:hover:not(:disabled) {
        transform: translateX(-50%) scale(1.04);
        box-shadow: 0 0 60px rgba(90,138,207,0.6), 0 12px 28px rgba(0,0,0,0.7);
      }
      .loadout-confirm:disabled { opacity: 0.45; cursor: not-allowed; }

      /* Cards positioned just below center — bigger, more present.
         Wrap when there are too many to fit in a single row. */
      .contractor-cards {
        position: absolute; top: 56%; left: 240px; right: 240px;
        transform: translateY(-50%);
        display: flex; gap: 18px; justify-content: center;
        flex-wrap: wrap; max-height: 40%;
        overflow-y: auto;
      }
      .contractor-empty {
        color: #6f6754; font-style: italic; padding: 16px;
      }

      /* Wanted-poster card — bigger now */
      .wanted-card {
        flex: 0 0 240px;
        background: linear-gradient(180deg, #1a1d24 0%, #0c0e14 100%);
        border: 2px solid #2a2f3a; border-radius: 6px;
        padding: 10px; display: flex; flex-direction: column; gap: 6px;
        text-align: center;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
      }
      .wanted-card { cursor: pointer; transition: transform 0.15s, box-shadow 0.15s, background 0.15s; font: inherit; }
      .wanted-card:hover:not(:disabled) {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 10px 26px rgba(0,0,0,0.7), 0 0 28px rgba(242,192,96,0.18);
      }
      .wanted-card:active:not(:disabled) { transform: translateY(-1px) scale(1.0); }
      .wanted-card:disabled { cursor: not-allowed; }
      .wanted-card.rarity-common    { border-color: #c9a87a; }
      .wanted-card.rarity-uncommon  { border-color: #6abf78; }
      .wanted-card.rarity-rare      { border-color: #5a8acf; }
      .wanted-card.rarity-epic      { border-color: #b870e0; }
      .wanted-card.rarity-legendary { border-color: #f2a040; box-shadow: 0 4px 16px rgba(0,0,0,0.6), 0 0 20px rgba(242,160,64,0.3); }
      .wanted-card.active   { background: linear-gradient(180deg, #2a2418 0%, #1a1408 100%); }
      .wanted-card.claimed  { opacity: 0.55; }

      .wanted-portrait {
        width: 100%; aspect-ratio: 1;
        background: radial-gradient(circle at 50% 40%, #1a1d24 0%, #0a0a10 100%);
        border-bottom: 1px solid #2a2f3a;
        display: flex; align-items: center; justify-content: center;
        font-size: 64px; color: #c9a87a;
        margin: -10px -10px 0; border-radius: 4px 4px 0 0;
      }
      .wanted-portrait[data-portrait="dasher"]   { color: #6abf78; }
      .wanted-portrait[data-portrait="tank"]     { color: #c98a3a; }
      .wanted-portrait[data-portrait="gunman"]   { color: #5a8acf; }
      .wanted-portrait[data-portrait="melee"]    { color: #d24868; }
      .wanted-portrait[data-portrait="boss"]     { color: #f2c060; }
      .wanted-portrait[data-portrait="megaboss"] { color: #f2a040; }
      .wanted-name {
        font-size: 13px; font-weight: 700; color: #e8dfc8;
        letter-spacing: 1.2px; margin-top: 4px;
      }
      .wanted-mission {
        font-size: 9px; letter-spacing: 1.4px; color: #9b8b6a;
      }
      .wanted-conds {
        font-size: 11px; color: #c9a87a;
      }
      .wanted-card .row-mods {
        margin: 2px 0 0; padding: 0; list-style: none;
        font-size: 9px; color: #d4a060;
      }
      .wanted-card .row-mods li { line-height: 1.4; }
      .wanted-rewards {
        display: flex; justify-content: center; gap: 8px;
        font-size: 10px; padding-top: 4px;
        border-top: 1px solid #2a2f3a;
      }
      .wanted-reward.chips  { color: #f2c060; font-weight: 700; }
      .wanted-reward.marks  { color: #6abf78; }
      .wanted-reward.sigils { color: #b870e0; }
      .wanted-actions { display: flex; justify-content: center; gap: 6px; }
      .wanted-actions .hideout-btn { width: 100%; }

      .contractor-corner {
        position: absolute; bottom: 14px; right: 14px;
        background: rgba(10,12,18,0.7);
        border: 1px solid rgba(90,138,207,0.25); border-radius: 4px;
        padding: 8px 12px; min-width: 180px;
        font-size: 10px; letter-spacing: 0.8px; color: #9b8b6a;
      }
      .contractor-corner b { color: #f2c060; }
      .corner-line { padding: 2px 0; }
      .corner-refresh {
        margin-top: 6px; padding-top: 6px;
        border-top: 1px solid rgba(90,138,207,0.2);
        color: #6f6754; font-size: 9px; letter-spacing: 1.4px;
      }
      .refresh-time { color: #5a8acf; font-size: 13px; font-weight: 700; }

      #hideout-header {
        display: flex; align-items: center; gap: 16px;
        padding: 14px 22px; border-bottom: 1px solid #1f2530;
      }
      #hideout-title {
        font-size: 16px; font-weight: 700; color: #5a8acf;
        letter-spacing: 3px; text-transform: uppercase;
      }
      #hideout-wallets {
        flex: 1; text-align: right; color: #c9a87a; font-size: 13px;
        display: flex; gap: 18px; justify-content: flex-end; align-items: baseline;
      }
      #hideout-wallets .wallet { white-space: nowrap; }
      #hideout-wallets .lbl { color: #9b8b6a; font-size: 10px; letter-spacing: 1.5px; margin-right: 6px; }
      #hideout-wallets b { font-size: 17px; color: #f2c060; }
      #hideout-wallets .wallet.sigils b { color: #b870e0; }
      #hideout-sysmenu {
        background: #2a2f3a; border: 1px solid #4a505a;
        color: #c9a87a; padding: 6px 12px; border-radius: 4px;
        font: inherit; font-size: 16px; cursor: pointer;
        line-height: 1;
      }
      #hideout-sysmenu:hover { background: #3a3f4a; color: #e8dfc8; }
      #hideout-back, #hideout-startrun, #hideout-quickstart {
        background: linear-gradient(180deg, #2a2f3a, #1a1d24);
        border: 1px solid #4a505a; color: #c9a87a;
        padding: 8px 14px; border-radius: 4px;
        font: inherit; font-size: 11px; letter-spacing: 1.4px;
        text-transform: uppercase; cursor: pointer;
      }
      #hideout-back:hover, #hideout-quickstart:hover { background: linear-gradient(180deg, #3a3f4a, #2a2d34); }
      #hideout-startrun {
        background: linear-gradient(180deg, #2a4a6e, #1e3450);
        border: 1px solid #5a8acf; color: #e8dfc8;
        font-size: 12px; letter-spacing: 1.5px;
      }
      #hideout-startrun:hover { background: linear-gradient(180deg, #3a5a7e, #2e4460); }

      #hideout-tabs {
        display: flex; gap: 2px; padding: 8px 18px 0;
        border-bottom: 1px solid #1f2530;
      }
      .hideout-tab {
        background: transparent; border: 1px solid transparent; border-bottom: none;
        border-radius: 4px 4px 0 0; color: #6f6754;
        font: inherit; font-size: 11px; letter-spacing: 1.5px;
        text-transform: uppercase; padding: 7px 16px; cursor: pointer;
      }
      .hideout-tab:hover { color: #c9a87a; border-color: #2a3040; }
      .hideout-tab.active {
        color: #e8dfc8; border-color: #5a8acf;
        background: linear-gradient(180deg, #1a2230, #131820);
      }

      #hideout-body { flex: 1; overflow-y: auto; padding: 22px; }
      .hideout-tab-body { max-width: 100%; }
      .hideout-section-head { margin-bottom: 12px; }
      .hideout-section-title {
        font-size: 13px; color: #5a8acf; letter-spacing: 2px;
        text-transform: uppercase; font-weight: 700;
      }
      .hideout-section-sub { font-size: 10px; color: #6f6754; letter-spacing: 1px; }
      .hideout-blurb {
        color: #9b8b6a; font-size: 12px; line-height: 1.45;
        margin-bottom: 14px; max-width: 540px;
      }
      .hideout-placeholder {
        padding: 20px 24px;
        background: rgba(20, 24, 32, 0.4);
        border: 1px dashed #2a3040; border-radius: 4px;
        color: #9b8b6a; font-size: 12px; line-height: 1.55; max-width: 540px;
      }
      .hideout-placeholder em { color: #c9a87a; font-style: italic; }
      .muted { color: #5a5448; }

      .hideout-stash-cols {
        display: grid; grid-template-columns: 1fr 1fr; gap: 18px;
      }
      .hideout-stash-col { display: flex; flex-direction: column; gap: 8px; }
      .hideout-col-title {
        font-size: 11px; color: #c9a87a;
        letter-spacing: 1.5px; text-transform: uppercase;
        margin-bottom: 4px;
      }
      .hideout-extract-list {
        display: flex; flex-direction: column; gap: 6px;
        max-height: 460px; overflow-y: auto;
      }
      .hideout-extract-tile {
        padding: 8px 10px; background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid #2a3040; border-left-width: 3px; border-radius: 4px;
      }
      .hideout-extract-name { font-weight: 700; color: #e8dfc8; font-size: 12px; }
      .hideout-extract-meta { font-size: 10px; color: #9b8b6a; margin: 2px 0 6px; }
      .hideout-extract-actions { display: flex; gap: 6px; }
      .hideout-extract-actions button {
        flex: 1; background: linear-gradient(180deg, #1f3a5c, #16283f);
        border: 1px solid #2a4a70; color: #cbd2dc;
        padding: 4px 8px; font: inherit; font-size: 10px; letter-spacing: 1px;
        text-transform: uppercase; cursor: pointer; border-radius: 3px;
      }
      .hideout-extract-actions button:hover:not(:disabled) {
        background: linear-gradient(180deg, #2f4a6c, #26384f);
      }
      .hideout-extract-actions button:disabled {
        opacity: 0.4; cursor: not-allowed;
      }

      .hideout-stash-grid {
        display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
      }
      .hideout-stash-slot {
        aspect-ratio: 1 / 1; border: 1px dashed #2a3040; border-radius: 4px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(20, 24, 32, 0.3);
        color: #5a5448; font-size: 14px;
      }
      .hideout-stash-slot.empty { border-style: dashed; }
      .hideout-stash-tile {
        width: 100%; height: 100%;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        padding: 4px; box-sizing: border-box;
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 2px solid; border-radius: 4px;
      }
      .hideout-stash-icon { width: 60%; height: auto; image-rendering: pixelated; }
      .hideout-stash-name {
        font-size: 9px; color: #e8dfc8; text-align: center;
        max-height: 24px; overflow: hidden; line-height: 1.2;
      }
      .hideout-stash-actions { width: 100%; }
      .hideout-stash-actions button {
        width: 100%; background: rgba(40, 30, 50, 0.6);
        border: 1px solid #4a3060; color: #c9a87a;
        padding: 2px 4px; font: inherit; font-size: 9px;
        cursor: pointer; border-radius: 2px;
      }

      .hideout-upgrade-row, .hideout-quart-buy-row {
        display: flex; align-items: center; justify-content: space-between;
        margin-top: 12px; padding: 10px 14px;
        background: rgba(40, 32, 20, 0.3);
        border: 1px solid #3a3020; border-radius: 4px;
        color: #c9a87a; font-size: 12px;
      }
      .hideout-upgrade-row b, .hideout-quart-buy-row b { color: #f2c060; }
      .hideout-upgrade-row .muted { font-size: 11px; }
      .hideout-buy {
        background: linear-gradient(180deg, #4a6a3a, #2e4626);
        border: 1px solid #6a8a4a; color: #e8efd8;
        padding: 5px 14px; font: inherit; font-size: 11px;
        letter-spacing: 1px; text-transform: uppercase;
        cursor: pointer; border-radius: 3px;
      }
      .hideout-buy:hover:not(:disabled) {
        background: linear-gradient(180deg, #5a7a4a, #3e5636);
      }
      .hideout-buy:disabled { opacity: 0.4; cursor: not-allowed; }

      /* Tier-grouped section header (used by Recruiter / Black Market /
         Vendors panels). Standard / Risky / Lethal tier classes are
         optional decoration on top. */
      .hideout-tier-group { margin-top: 8px; }
      .hideout-tier-group:first-of-type { margin-top: 0; }
      .hideout-tier-head {
        display: flex; align-items: baseline; gap: 10px;
        margin: 14px 0 6px; padding: 4px 0;
        border-bottom: 1px solid #2a2f3a;
      }
      .hideout-tier-head .t {
        font-size: 12px; font-weight: 700; letter-spacing: 1.4px;
      }
      .hideout-tier-head .s {
        font-size: 10px; color: #6f6754; letter-spacing: 0.5px;
      }

      .hideout-contract-row {
        padding: 10px 14px; margin-bottom: 6px;
        background: linear-gradient(180deg, #1a1d24, #131720);
        border-left: 3px solid #5a8acf;
        border-radius: 3px;
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-areas:
          'head    actions'
          'blurb   actions'
          'mods    actions'
          'offset  actions'
          'lock    actions';
        column-gap: 12px;
      }
      .hideout-contract-row.locked { opacity: 0.55; }
      .hideout-contract-row.active { border-left-color: #f2c060; background: linear-gradient(180deg, #221f12, #16140a); }
      .hideout-contract-row.claimed { border-left-color: #6abf78; }
      .hideout-contract-row .row-head {
        grid-area: head;
        display: flex; align-items: baseline; gap: 8px;
      }
      .hideout-contract-row .label {
        font-size: 13px; font-weight: 700; color: #e8dfc8; letter-spacing: 0.6px;
      }
      .hideout-contract-row .reward {
        margin-left: auto; font-size: 11px; color: #f2c060; font-weight: 700; letter-spacing: 0.6px;
      }
      .hideout-contract-row .row-blurb {
        grid-area: blurb;
        font-size: 11px; color: #c9a87a; margin: 3px 0 0;
      }
      .hideout-contract-row .row-mods {
        grid-area: mods;
        margin: 6px 0 0; padding: 0 0 0 16px;
        font-size: 10px; color: #d4a060; letter-spacing: 0.4px;
      }
      .hideout-contract-row .row-mods li { line-height: 1.5; }
      .hideout-contract-row .row-offset {
        grid-area: offset; margin-top: 4px;
        font-size: 10px; color: #6abf78; letter-spacing: 0.4px;
      }
      .hideout-contract-row .row-lock {
        grid-area: lock; margin-top: 4px;
        font-size: 10px; color: #888; letter-spacing: 0.4px;
      }
      .hideout-contract-row .row-actions {
        grid-area: actions;
        display: flex; align-items: center; gap: 8px;
      }
      .tier-badge {
        font-size: 9px; font-weight: 700; letter-spacing: 1px;
        padding: 2px 6px; border-radius: 2px;
        background: #2a2f3a; color: #c9a87a;
      }
      .tier-badge.risky { background: #4a2a16; color: #ffb060; }
      .tier-badge.lethal { background: #4a1622; color: #ff7080; }
      .hideout-tag {
        font-size: 10px; font-weight: 700; letter-spacing: 1px;
        padding: 4px 10px; border-radius: 2px;
      }
      .hideout-tag.active { background: #2a2418; color: #f2c060; }
      .hideout-tag.claimed { background: #1a2a1c; color: #6abf78; }
      .hideout-btn.primary {
        background: linear-gradient(180deg, #4a6a3a, #2e4626);
        border: 1px solid #6a8a4a; color: #e8efd8;
        padding: 5px 14px; font: inherit; font-size: 11px;
        letter-spacing: 1px; text-transform: uppercase;
        cursor: pointer; border-radius: 3px;
      }
      .hideout-btn.primary:hover { background: linear-gradient(180deg, #5a7a4a, #3e5636); }

      /* Stash sub-tabs + two-column layout */
      .hideout-stash-root { display: flex; flex-direction: column; gap: 12px; }
      .hideout-substabs {
        display: flex; gap: 2px; border-bottom: 1px solid #1f2530;
        padding-bottom: 2px;
      }
      .hideout-subtab {
        background: transparent; border: 0; color: #9b8b6a;
        padding: 6px 14px; font: inherit; font-size: 11px;
        letter-spacing: 1.2px; text-transform: uppercase; cursor: pointer;
        border-bottom: 2px solid transparent;
      }
      .hideout-subtab:hover { color: #c9a87a; }
      .hideout-subtab.active { color: #f2c060; border-bottom-color: #f2c060; }
      .hideout-stash-twocol {
        display: grid; grid-template-columns: 1fr 280px; gap: 18px;
        align-items: start;
      }
      .hideout-stash-leftcol { min-width: 0; }
      .hideout-stash-section { display: flex; flex-direction: column; gap: 12px; }

      /* TAKE / ARMORY tiles */
      .hideout-take-classgroup { margin-top: 8px; }
      .hideout-take-classlabel {
        font-size: 10px; color: #6f6754; letter-spacing: 1.4px;
        margin-bottom: 4px;
      }
      .hideout-take-row {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
      }
      .hideout-take-tile {
        position: relative;
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid #2a2f3a; border-left: 3px solid #5a8acf;
        border-radius: 3px; padding: 8px 10px;
        cursor: pointer; user-select: none;
        display: flex; flex-direction: column; gap: 2px;
      }
      .hideout-take-tile:hover { background: linear-gradient(180deg, #232730, #181c25); }
      .hideout-take-tile.selected {
        background: linear-gradient(180deg, #2a2418, #16140a);
        border-color: #f2c060;
      }
      .hideout-take-tile.locked { cursor: default; }
      .hideout-take-icon {
        width: 36px; height: 36px; image-rendering: pixelated;
        align-self: center; margin: 2px 0 4px;
      }
      .hideout-take-icon-fallback {
        width: 36px; height: 36px; align-self: center;
        background: #2a2f3a; border-radius: 3px; margin: 2px 0 4px;
      }
      .hideout-take-name {
        font-size: 12px; color: #e8dfc8; font-weight: 700; letter-spacing: 0.4px;
      }
      .hideout-take-meta { font-size: 10px; color: #9b8b6a; letter-spacing: 0.4px; }
      .hideout-take-tag {
        position: absolute; top: 6px; right: 6px;
        font-size: 8px; font-weight: 700; letter-spacing: 1px;
        padding: 2px 5px; border-radius: 2px;
        background: #2a2f3a; color: #c9a87a;
      }
      .hideout-take-actions { margin-top: 6px; }
      .hideout-take-actions .hideout-buy { width: 100%; }

      /* STORE */
      .hideout-store-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px; margin-top: 6px;
      }
      .hideout-store-slot {
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid #2a2f3a; border-left: 3px solid #5a8acf;
        border-radius: 3px; padding: 8px 10px; min-height: 92px;
        display: flex; flex-direction: column; gap: 2px;
      }
      .hideout-store-slot.empty { color: #4a505a; text-align: center;
        line-height: 92px; padding: 0; }
      .hideout-store-slot.sold { opacity: 0.5; }
      .hideout-store-slot.sold .hideout-store-status {
        margin-top: auto; text-align: center; font-size: 11px;
        font-weight: 700; letter-spacing: 1.2px; color: #6abf78;
      }
      .hideout-store-kind {
        font-size: 9px; color: #6f6754; letter-spacing: 1.4px;
      }
      .hideout-store-name {
        font-size: 12px; color: #e8dfc8; font-weight: 700;
      }
      .hideout-store-meta { font-size: 10px; color: #9b8b6a; }
      .hideout-store-actions { margin-top: auto; padding-top: 4px; }
      .hideout-store-actions .hideout-buy { width: 100%; }

      /* PAPERDOLL */
      .hideout-paperdoll {
        background: linear-gradient(180deg, #14171e, #0c0e14);
        border: 1px solid #2a2f3a; border-radius: 4px;
        padding: 14px; display: flex; flex-direction: column; gap: 8px;
        position: sticky; top: 8px;
      }
      .hideout-paperdoll-title {
        font-size: 11px; font-weight: 700; color: #5a8acf;
        letter-spacing: 1.6px; padding-bottom: 6px;
        border-bottom: 1px solid #1f2530; margin-bottom: 4px;
      }
      .hideout-paperdoll-row {
        display: flex; justify-content: space-between; align-items: baseline;
        font-size: 11px; gap: 8px;
      }
      .hideout-paperdoll-row .lbl {
        color: #9b8b6a; letter-spacing: 1px; font-size: 10px;
      }
      .hideout-paperdoll-row .val { color: #e8dfc8; font-weight: 700; }
      .hideout-paperdoll-row .val.muted { color: #6f6754; font-weight: 400; }
      .hideout-paperdoll-empty {
        font-size: 10px; color: #6f6754; font-style: italic;
        text-align: center; padding: 8px 0;
      }
      .hideout-paperdoll-entry {
        display: grid; grid-template-columns: 32px 1fr 22px;
        gap: 6px; align-items: center;
        padding: 4px 6px; background: #1a1d24; border-radius: 3px;
        font-size: 11px;
      }
      .hideout-paperdoll-entry .kind {
        font-size: 9px; color: #5a8acf; font-weight: 700; letter-spacing: 0.8px;
      }
      .hideout-paperdoll-entry .name { color: #c9a87a; }
      .hideout-paperdoll-entry .rem {
        background: transparent; border: 0; color: #6f6754;
        font-size: 16px; cursor: pointer; padding: 0;
      }
      .hideout-paperdoll-entry .rem:hover { color: #d24868; }

      /* New rarity-grouped contract cards */
      .hideout-rarity-group { margin-top: 14px; }
      .hideout-rarity-group:first-of-type { margin-top: 0; }
      .hideout-rarity-head {
        margin: 0 0 6px; padding: 4px 0;
        border-bottom: 1px solid #2a2f3a;
        font-size: 11px; font-weight: 700; letter-spacing: 1.6px;
      }
      .hideout-rarity-head.common    { color: #c9a87a; }
      .hideout-rarity-head.uncommon  { color: #6abf78; }
      .hideout-rarity-head.rare      { color: #5a8acf; }
      .hideout-rarity-head.epic      { color: #b870e0; }
      .hideout-rarity-head.legendary { color: #f2a040; }

    `;
    document.head.appendChild(style);
  }
}

// Bridge: make sure setStash/stashRemoveAt round-trip cleanly. The
// stash UI mutates via the prefs.js helpers — this re-export gives
// any consumer a single import to bind to.
export { getStash, setStash, stashAddItem, stashRemoveAt };
