// Hideout — between-runs panel UI.
//
// Five tabs: Stash, Quartermaster, Contractor, Doctor, Mailbox.
//   Stash:        persistent gear grid (4-8 slots, expandable via chips).
//   Quartermaster: chip-bought guaranteed gear; tier raises rarity floor.
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
  getHideoutUpgrades, setHideoutUpgrades, quartermasterNextTierCost, QUARTERMASTER_TIER_MAX,
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
import { iconForItem, inferRarity, rarityColor } from './inventory.js';

// Baseline starter-weapon roster — five always-free common picks,
// one per major class. Must match BASELINE_STARTER_NAMES in main.js.
const BASELINE_STARTERS = ['Makarov', 'PDW', 'Mini-14', 'Mossberg 500', 'Baton'];

// Pre-Run Store stock pool — items the rotating store can roll. Each
// entry has a `kind` and an `id` resolver. Weapons are sampled at
// roll time so the rarity ceiling can bias which weapons show up;
// armor / consumables / buffs come from a small static catalog.
const STORE_KINDS = [
  { kind: 'weapon',     weight: 35 },
  { kind: 'armor',      weight: 20 },
  { kind: 'consumable', weight: 25 },
  { kind: 'ammo',       weight: 10 },
  { kind: 'buff',       weight: 10 },
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
  { id: 'quartermaster',label: 'QUARTERMASTER' },
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
export const RELIC_PERMITS = {
  permit_mourners_bell: { id: 'permit_mourners_bell', label: "Mourner's Bell", blurb: 'Permit unlocks Mourner\'s Bell in the relic merchant rotation.', cost: 8 },
  permit_iron_faith:    { id: 'permit_iron_faith',    label: 'Iron Faith',     blurb: 'Permit unlocks Iron Faith in the relic merchant rotation.', cost: 8 },
  permit_magnum_opus:   { id: 'permit_magnum_opus',   label: 'Magnum Opus',    blurb: 'Permit unlocks Magnum Opus in the relic merchant rotation.', cost: 10 },
  permit_golden_bullet: { id: 'permit_golden_bullet', label: 'Golden Bullet',  blurb: 'Permit unlocks Golden Bullet in the relic merchant rotation.', cost: 10 },
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
    // Diegetic 3D scene defaults ON. Reuses the host renderer
    // passed via ctx.getRenderer(). No new GL context, no second
    // canvas. Falls back silently if no renderer is available.
    if (window.__hideoutDiegetic === false) return null;
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
    if (this._scene && window.__hideoutDiegetic !== false) {
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
    const actions = document.createElement('div');
    actions.id = 'hideout-actions';
    actions.innerHTML = `
      <button id="hideout-quickstart" type="button" title="Last-class quick run">Quick Start</button>
      <button id="hideout-startrun" type="button">Start New Run ▶</button>
    `;
    actions.querySelector('#hideout-startrun').addEventListener('click', () => this.close());
    actions.querySelector('#hideout-quickstart').addEventListener('click', () => this._quickStart());
    this.root.appendChild(actions);

    // ── Bottom-left vertical tab strip. Each tab lerps the diegetic
    //    camera to the matching station as it activates.
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
        this.tab = t.id;
        const stationId = tabToStation[t.id];
        if (stationId && this._scene) this._scene.gotoStation(stationId);
        this.render();
      });
      tabs.appendChild(btn);
    }
    this.root.appendChild(tabs);

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

    const SUB_TABS = [
      { id: 'take',   label: 'TAKE A WEAPON' },
      { id: 'armory', label: 'ARMORY' },
      { id: 'store',  label: 'PRE-RUN STORE' },
      { id: 'bank',   label: 'BANK' },
    ];
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
    else if (this.stashSubTab === 'armory') leftCol.appendChild(this._renderArmorySection());
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

  // ----- ARMORY section --------------------------------------------
  _renderArmorySection() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-stash-section';
    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">ARMORY</div>
      <div class="hideout-section-sub">Spend chips to permanently unlock weapons. They join your stash and start dropping in the world.</div>
    `;
    wrap.appendChild(head);

    const unlocked = getUnlockedWeapons();
    const locked = tunables.weapons.filter(w =>
      w.worldDrop === false && !w.artifact && !unlocked.has(w.name));
    if (!locked.length) {
      const p = document.createElement('div');
      p.className = 'hideout-placeholder';
      p.textContent = 'Every weapon unlocked. Nothing left to spend chips on here.';
      wrap.appendChild(p);
      return wrap;
    }

    const RARITY_COSTS = { common: 150, uncommon: 350, rare: 800, epic: 2000, legendary: 5000, mythic: 12000 };
    const byClass = {};
    for (const w of locked) {
      (byClass[w.class || 'other'] = byClass[w.class || 'other'] || []).push(w);
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
        const cost = RARITY_COSTS[w.rarity || 'common'] || 150;
        row.appendChild(this._buildArmoryTile(w, cost));
      }
      sec.appendChild(row);
      wrap.appendChild(sec);
    }
    return wrap;
  }

  _buildArmoryTile(weapon, cost) {
    const tile = document.createElement('div');
    tile.className = 'hideout-take-tile locked';
    tile.style.borderColor = rarityColor({ rarity: weapon.rarity });
    const icon = iconForItem({ name: weapon.name, type: weapon.type });
    tile.innerHTML = `
      ${icon ? `<img class="hideout-take-icon" src="${icon}" alt="">` : '<div class="hideout-take-icon-fallback"></div>'}
      <div class="hideout-take-name">${(weapon.name || '').replace(/<[^>]+>/g, '')}</div>
      <div class="hideout-take-meta">${weapon.rarity || 'common'}</div>
      <div class="hideout-take-actions">
        <button type="button" class="hideout-buy">Unlock — ${cost}c</button>
      </div>
    `;
    const btn = tile.querySelector('.hideout-buy');
    btn.disabled = getPersistentChips() < cost;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
      unlockWeapon(weapon.name);
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

  // ----- Quartermaster ----------------------------------------------
  _renderQuartermasterTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body';
    const upg = getHideoutUpgrades();
    const tier = upg.quartermasterTier;
    const tierLabels = ['Common floor', 'Uncommon floor', 'Rare floor', 'Epic floor', 'Legendary floor'];
    const tierName = tierLabels[tier] || 'Common floor';

    const head = document.createElement('div');
    head.className = 'hideout-section-head';
    head.innerHTML = `
      <div class="hideout-section-title">QUARTERMASTER</div>
      <div class="hideout-section-sub">Tier ${tier} / ${QUARTERMASTER_TIER_MAX} — ${tierName}</div>
    `;
    wrap.appendChild(head);

    const blurb = document.createElement('div');
    blurb.className = 'hideout-blurb';
    blurb.textContent =
      'Spend chips on a guaranteed weapon at the current rarity floor. Higher tiers raise the floor. Items go straight to the stash.';
    wrap.appendChild(blurb);

    // Buy buttons row — generates a single guaranteed item per click.
    const buyRow = document.createElement('div');
    buyRow.className = 'hideout-quart-buy-row';
    const cost = 80 + tier * 60;
    buyRow.innerHTML = `
      <span>Buy a guaranteed weapon roll: <b>${cost}</b> chips</span>
      <button type="button" class="hideout-buy">Buy</button>
    `;
    const buyBtn = buyRow.querySelector('.hideout-buy');
    buyBtn.disabled = getPersistentChips() < cost;
    buyBtn.title = (this.ctx.rollQuartermasterItem ? '' : 'Quartermaster roll not wired yet — placeholder.');
    buyBtn.addEventListener('click', () => {
      if (!this.ctx.spendChips || !this.ctx.spendChips(cost)) return;
      // Roll an item via the host hook; if missing, just refund.
      const item = this.ctx.rollQuartermasterItem ? this.ctx.rollQuartermasterItem(tier) : null;
      if (!item) {
        // Refund silently — host hasn't wired the roller yet.
        if (this.ctx.awardChips) this.ctx.awardChips(cost);
        return;
      }
      const slot = stashAddItem(item, upg.stashSlots);
      if (slot < 0) {
        // No room — auto-convert + refund the difference.
        if (this.ctx.awardChips) this.ctx.awardChips(this._chipValueOf(item));
      }
      this.render();
    });
    wrap.appendChild(buyRow);

    // Tier upgrade button.
    const upgRow = document.createElement('div');
    upgRow.className = 'hideout-upgrade-row';
    const nextCost = quartermasterNextTierCost(tier);
    if (nextCost == null) {
      upgRow.innerHTML = `<span class="muted">Quartermaster at max tier.</span>`;
    } else {
      upgRow.innerHTML = `
        <span>Upgrade to Tier ${tier + 1} (${tierLabels[tier + 1] || 'higher floor'}): <b>${nextCost}</b> chips</span>
        <button type="button" class="hideout-buy">Buy</button>
      `;
      const btn = upgRow.querySelector('.hideout-buy');
      btn.disabled = getPersistentChips() < nextCost;
      btn.addEventListener('click', () => {
        if (!this.ctx.spendChips || !this.ctx.spendChips(nextCost)) return;
        const u = getHideoutUpgrades();
        setHideoutUpgrades({ ...u, quartermasterTier: Math.min(QUARTERMASTER_TIER_MAX, u.quartermasterTier + 1) });
        this.render();
      });
    }
    wrap.appendChild(upgRow);

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
  // Stage-style contractor view per mockup — host portrait + speech
  // bubble + a daily set of 3 featured wanted-poster cards. Side rails
  // show a live contract-feed ticker and the global contract board.
  // The full rarity browser is reachable via a "Browse all" link.
  _renderContractorTab() {
    const wrap = document.createElement('div');
    wrap.className = 'hideout-tab-body contractor-stage';

    const active = getActiveContract();
    const activeId = active?.activeContractId || null;
    const claimed = !!active && (active.claimedAt | 0) > 0;
    const unlockState = {
      contractsCompleted: getContractRank(),
      megabossKills: getMegabossKills(),
      marks: getMarks(),
    };

    // Featured 3 — pick the highest-rarity unlocked contracts (so as
    // the player ranks up the daily set ramps with them). Falls back
    // to common+uncommon for a fresh player.
    const allDefs = Object.values(CONTRACT_DEFS).filter(d => isContractUnlocked(d, unlockState));
    const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    allDefs.sort((a, b) => (RARITY_ORDER[b.rarity || 'common'] - RARITY_ORDER[a.rarity || 'common']));
    const featured = this._featuredDailySlice(allDefs, 3);

    // Host greeting — rotates each render so the host has presence.
    const greeting = this._pickHostGreeting();

    wrap.innerHTML = `
      <div class="contractor-feed">
        <div class="feed-head">LIVE CONTRACT FEED</div>
        ${this._renderLiveFeedHTML()}
      </div>

      <div class="contractor-board">
        <div class="board-head">CONTRACT BOARD</div>
        ${this._renderBoardListHTML(allDefs)}
      </div>

      <div class="contractor-host">
        <div class="host-portrait" aria-hidden="true">
          <div class="host-glyph">◆</div>
        </div>
        <div class="host-bubble">
          <div class="host-quote">"${greeting}"</div>
        </div>
      </div>

      <button id="contractor-cta" type="button">START NEW RUN</button>
      <div class="contractor-cta-sub">HERE'S WHAT'S AVAILABLE TO YOU TODAY.</div>

      <div class="contractor-cards"></div>

      <div class="contractor-corner">
        <div class="corner-line">RANK <b>${unlockState.contractsCompleted}</b></div>
        <div class="corner-line">MEGABOSSES <b>${unlockState.megabossKills}</b></div>
        <div class="corner-refresh">CONTRACT REFRESH<br><span class="refresh-time">${this._refreshCountdownStr()}</span></div>
      </div>
    `;

    // Wire CTA — same as the floating Start New Run button. The mockup
    // shows a big golden CTA right inside the stage; clicking it does
    // the same close()/scene-fade flow.
    wrap.querySelector('#contractor-cta').addEventListener('click', () => this.close());

    // Contract cards.
    const cards = wrap.querySelector('.contractor-cards');
    for (const def of featured) {
      cards.appendChild(this._renderContractWantedCard(def, active, activeId, claimed));
    }
    if (!featured.length) {
      const empty = document.createElement('div');
      empty.className = 'contractor-empty';
      empty.textContent = 'No contracts available — try again after a refresh.';
      cards.appendChild(empty);
    }

    return wrap;
  }

  // Wanted-poster style card — target portrait at top, name, conditions,
  // reward strip at bottom. Replaces the older grid row card for the
  // featured-3 set inside the stage view.
  _renderContractWantedCard(def, active, activeId, claimed) {
    const card = document.createElement('div');
    const isActive = (def.id === activeId);
    const isClaimed = isActive && claimed;
    card.className = 'wanted-card'
      + ` rarity-${def.rarity || 'common'}`
      + (isActive ? ' active' : '')
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
      <div class="wanted-actions"></div>
    `;
    const actions = card.querySelector('.wanted-actions');
    if (isClaimed) {
      const tag = document.createElement('span');
      tag.className = 'hideout-tag claimed'; tag.textContent = 'DONE';
      actions.appendChild(tag);
    } else if (isActive) {
      const tag = document.createElement('span');
      tag.className = 'hideout-tag active'; tag.textContent = 'ACTIVE';
      actions.appendChild(tag);
      const drop = document.createElement('button');
      drop.type = 'button'; drop.className = 'hideout-btn';
      drop.textContent = 'Drop';
      drop.addEventListener('click', () => { setActiveContract(null); this.render(); });
      actions.appendChild(drop);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hideout-btn primary';
      btn.textContent = 'Accept';
      btn.addEventListener('click', () => {
        const period = (def.period === 'weekly') ? 7 * 24 * 3600000 : 24 * 3600000;
        setActiveContract({
          activeContractId: def.id,
          expiresAt: Date.now() + period,
          progress: {},
          claimedAt: 0,
        });
        this.render();
      });
      actions.appendChild(btn);
    }
    return card;
  }

  // Stable daily slice — picks N defs deterministically from the
  // unlocked pool seeded by the UTC day so the featured set is the
  // same all day for one player.
  _featuredDailySlice(defs, n) {
    if (!defs.length) return [];
    const day = Math.floor(Date.now() / (24 * 3600000));
    const pool = defs.slice();
    const out = [];
    let seed = (day * 9301 + 49297) % 233280;
    for (let i = 0; i < n && pool.length; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const idx = seed % pool.length;
      out.push(pool.splice(idx, 1)[0]);
    }
    return out;
  }

  _pickHostGreeting() {
    if (!this._greetings) {
      this._greetings = [
        'Hi, pretty boy. Looking for work in our line of work? Or just admiring the view?',
        'Back already? The board never sleeps. Pick a name.',
        "Don't waste my time. I've got a queue.",
        'You smell like trouble. Good. Trouble pays.',
        "Cute. Now sign here, here, and here.",
        "I had your seat warmed. Don't ask how.",
        "Names on the board, money in the slot. Same as always, sweetheart.",
        "Try not to die before the bonus round.",
      ];
    }
    const day = Math.floor(Date.now() / (60 * 60 * 1000));
    return this._greetings[day % this._greetings.length];
  }

  _renderLiveFeedHTML() {
    // Decorative ticker — fake names + values flicker as if other
    // hitmen are clearing bounties. Keeps the world feeling alive.
    const items = [
      ['THE BUTCHER', 'CLOSED', 4200],
      ['CAPTAIN AGENA', 'CLAIMED', 6800],
      ['THE SMUGGLER', 'OPEN', 1250],
      ['DR. SILAS', 'CLOSED', 5500],
      ['THE FOX', 'OPEN', 980],
      ['JAGUAR', 'CLAIMED', 12300],
      ['NIGHTSHADE', 'CLOSED', 3300],
      ['HEX WIDOW', 'OPEN', 2200],
    ];
    return items.map(([name, status, val]) => `
      <div class="feed-row ${status.toLowerCase()}">
        <span class="feed-name">${name}</span>
        <span class="feed-val">${val}c</span>
        <span class="feed-status">${status}</span>
      </div>
    `).join('');
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

  _renderContractCard(def, active, activeId, claimed) {
    const card = document.createElement('div');
    const isActive = (def.id === activeId);
    const isClaimed = isActive && claimed;
    card.className = 'hideout-contract-card'
      + ` rarity-${def.rarity || 'common'}`
      + (isActive ? ' active' : '')
      + (isClaimed ? ' claimed' : '');

    // Plain-language mission line — read directly off targetType +
    // targetCount. "Eliminate 3 dasher bosses" / "Eliminate 30 enemies".
    const targetLabel = this._targetLabel(def.targetType, def.targetCount);
    const mission = `Eliminate ${def.targetCount} ${targetLabel}.`;
    const perKillLine = (def.perKillReward | 0) > 0
      ? `<span class="perkill">+${def.perKillReward} chips per kill</span>`
      : '';
    const bonusLine = (def.reward | 0) > 0
      ? `<span class="bonus">+${def.reward} chips on completion</span>`
      : '';
    const marksLine = (def.marksReward | 0) > 0
      ? `<span class="marks">+${def.marksReward} marks on completion</span>`
      : '';
    const totalCap = (def.perKillReward | 0) * (def.targetCount | 0) + (def.reward | 0);

    card.innerHTML = `
      <div class="hideout-contract-portrait" data-portrait="${def.portrait || 'any'}">${this._portraitGlyph(def.portrait)}</div>
      <div class="hideout-contract-body">
        <div class="hideout-contract-title">${def.label}</div>
        <div class="hideout-contract-mission">${mission}</div>
        <div class="hideout-contract-rewards">
          ${perKillLine}
          ${bonusLine}
          ${marksLine}
          ${totalCap ? `<span class="totalcap">up to ${totalCap}c total</span>` : ''}
        </div>
        ${this._renderModifierList(def)}
      </div>
      <div class="hideout-contract-actions"></div>
    `;
    const actions = card.querySelector('.hideout-contract-actions');
    if (isClaimed) {
      const tag = document.createElement('span');
      tag.className = 'hideout-tag claimed';
      tag.textContent = 'DONE';
      actions.appendChild(tag);
    } else if (isActive) {
      const tag = document.createElement('span');
      tag.className = 'hideout-tag active';
      tag.textContent = 'ACTIVE';
      actions.appendChild(tag);
      const drop = document.createElement('button');
      drop.type = 'button'; drop.className = 'hideout-btn';
      drop.textContent = 'Drop';
      drop.addEventListener('click', () => {
        setActiveContract(null);
        this.render();
      });
      actions.appendChild(drop);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hideout-btn primary';
      btn.textContent = 'Accept';
      btn.addEventListener('click', () => {
        const period = (def.period === 'weekly') ? 7 * 24 * 3600000 : 24 * 3600000;
        setActiveContract({
          activeContractId: def.id,
          expiresAt: Date.now() + period,
          progress: {},
          claimedAt: 0,
        });
        this.render();
      });
      actions.appendChild(btn);
    }
    return card;
  }

  // Plain-English label for a target archetype + count. Pluralizes
  // sensibly so "1 megaboss" and "5 dasher bosses" both read.
  _targetLabel(type, count) {
    const n = count | 0;
    const plural = n === 1 ? '' : 's';
    switch (type) {
      case 'dasher':   return `dasher${plural}`;
      case 'tank':     return `tank${plural}`;
      case 'gunman':   return `gunman${n === 1 ? '' : ' gunmen'.slice(1)}`;
      case 'melee':    return `melee enemy${n === 1 ? '' : ' melee enemies'.slice(11)}`;
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
      /* When the contractor tab is active, the panel becomes the
         full-screen stage. Override the right-anchored layout. */
      body.contractor-stage-on #hideout-panel {
        top: 84px; right: 16px; bottom: 80px; left: 220px;
        width: auto; max-width: none;
        padding: 0; overflow: hidden;
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

      #contractor-cta {
        position: absolute; left: 50%; top: 50%;
        transform: translate(-50%, -50%);
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
        transform: translate(-50%, -50%) scale(1.04);
        box-shadow: 0 0 60px rgba(242,192,96,0.7), 0 12px 28px rgba(0,0,0,0.7);
      }
      .contractor-cta-sub {
        position: absolute; left: 50%; top: calc(50% + 44px);
        transform: translateX(-50%);
        font-size: 11px; color: #c9a87a; letter-spacing: 2px;
        text-transform: uppercase;
      }

      .contractor-cards {
        position: absolute; bottom: 16px; left: 240px; right: 240px;
        display: flex; gap: 16px; justify-content: center;
        flex-wrap: nowrap;
      }
      .contractor-empty {
        color: #6f6754; font-style: italic; padding: 16px;
      }

      /* Wanted-poster card */
      .wanted-card {
        flex: 1; max-width: 200px;
        background: linear-gradient(180deg, #1a1d24 0%, #0c0e14 100%);
        border: 2px solid #2a2f3a; border-radius: 6px;
        padding: 10px; display: flex; flex-direction: column; gap: 6px;
        text-align: center;
        box-shadow: 0 4px 16px rgba(0,0,0,0.6);
      }
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

      .hideout-contract-card {
        padding: 14px 18px;
        background: linear-gradient(180deg, #1a1d24, #131720);
        border-left: 3px solid #5a8acf;
        border-radius: 4px;
      }
      .hideout-contract-label {
        font-size: 14px; font-weight: 700; color: #e8dfc8;
        letter-spacing: 1px;
      }
      .hideout-contract-blurb {
        font-size: 12px; color: #c9a87a; margin: 4px 0 8px;
      }
      .hideout-contract-meta {
        font-size: 10px; color: #6f6754; letter-spacing: 0.5px;
      }
      .hideout-contract-meta b { color: #f2c060; }
      .hideout-contract-meta .claimed {
        color: #6abf78; font-weight: 700; letter-spacing: 1px;
      }

      /* Tiered contract list — Standard / Risky / Lethal */
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
      .hideout-tier-standard .hideout-tier-head .t { color: #c9a87a; }
      .hideout-tier-risky .hideout-tier-head .t { color: #e8a040; }
      .hideout-tier-lethal .hideout-tier-head .t { color: #d24868; }

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
      .hideout-tier-risky  .hideout-contract-row { border-left-color: #b86a2a; }
      .hideout-tier-lethal .hideout-contract-row { border-left-color: #8a2a3a; }
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

      .hideout-contract-card {
        display: grid; grid-template-columns: 64px 1fr auto; gap: 14px;
        padding: 10px 14px; margin-bottom: 6px;
        background: linear-gradient(180deg, #1a1d24, #131720);
        border: 1px solid #2a2f3a; border-left: 4px solid #5a8acf;
        border-radius: 4px; align-items: center;
      }
      .hideout-contract-card.rarity-common    { border-left-color: #c9a87a; }
      .hideout-contract-card.rarity-uncommon  { border-left-color: #6abf78; }
      .hideout-contract-card.rarity-rare      { border-left-color: #5a8acf; }
      .hideout-contract-card.rarity-epic      { border-left-color: #b870e0; }
      .hideout-contract-card.rarity-legendary { border-left-color: #f2a040; }
      .hideout-contract-card.active   { background: linear-gradient(180deg, #221f12, #16140a); }
      .hideout-contract-card.claimed  { opacity: 0.65; }
      .hideout-contract-card.locked   { opacity: 0.55; }

      .hideout-contract-portrait {
        width: 56px; height: 56px;
        display: flex; align-items: center; justify-content: center;
        background: #14171e; border: 1px solid #2a2f3a; border-radius: 4px;
        font-size: 30px; color: #c9a87a; font-weight: 700;
      }
      .hideout-contract-portrait[data-portrait="dasher"]   { color: #6abf78; }
      .hideout-contract-portrait[data-portrait="tank"]     { color: #c98a3a; }
      .hideout-contract-portrait[data-portrait="gunman"]   { color: #5a8acf; }
      .hideout-contract-portrait[data-portrait="melee"]    { color: #d24868; }
      .hideout-contract-portrait[data-portrait="boss"]     { color: #f2c060; }
      .hideout-contract-portrait[data-portrait="megaboss"] { color: #f2a040; }
      .hideout-contract-portrait[data-portrait="locked"]   { color: #4a505a; }

      .hideout-contract-body { min-width: 0; }
      .hideout-contract-title {
        font-size: 14px; font-weight: 700; color: #e8dfc8; letter-spacing: 0.6px;
        margin-bottom: 2px;
      }
      .hideout-contract-mission {
        font-size: 12px; color: #c9a87a; margin-bottom: 6px;
      }
      .hideout-contract-rewards {
        display: flex; flex-wrap: wrap; gap: 12px;
        font-size: 11px; color: #9b8b6a; letter-spacing: 0.4px;
      }
      .hideout-contract-rewards .perkill { color: #f2c060; font-weight: 700; }
      .hideout-contract-rewards .bonus   { color: #c9a87a; }
      .hideout-contract-rewards .marks   { color: #6abf78; }
      .hideout-contract-rewards .totalcap { color: #6f6754; font-style: italic; }
      .hideout-contract-actions {
        display: flex; flex-direction: column; gap: 6px; align-items: flex-end;
      }
      .hideout-contract-card .row-mods {
        margin: 6px 0 0; padding: 0 0 0 16px;
        font-size: 10px; color: #d4a060; letter-spacing: 0.4px;
      }
    `;
    document.head.appendChild(style);
  }
}

// Bridge: make sure setStash/stashRemoveAt round-trip cleanly. The
// stash UI mutates via the prefs.js helpers — this re-export gives
// any consumer a single import to bind to.
export { getStash, setStash, stashAddItem, stashRemoveAt };
