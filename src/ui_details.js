import * as THREE from 'three';
import { inferRarity, SLOT_LABEL, SET_DEFS, countEquippedSetPieces } from './inventory.js';
import { thumbnailFor } from './item_thumbnails.js';
import { modelForItem } from './model_manifest.js';
import { loadModelClone, fitToRadius, applyEmissiveTint, addOutlines } from './gltf_cache.js';
import { BASE_STATS } from './skills.js';

// Verbose item details panel — opens on right-click. Shows lore, full
// stat breakdown, affixes/perks, set bonus progress, and (when the item
// is picked from a loot source or a merchant cell) a live diff against
// whatever the player is currently wearing in the same slot.

// Lore flavor keyed by item name. New items can add an entry here to
// avoid having to edit the core defs.
export const ITEM_LORE = {
  // Pistols
  'Glock': 'A reliable polymer-frame service pistol. Light, fast, and forgiving — the sidearm rookies train on and veterans still trust.',
  'Sig P320': 'Modular service pistol. Tight groups at mid range; the frame swaps out faster than the magazine.',
  'Beretta 92': 'Aluminum-framed 9mm service pistol. Italian pedigree, American issue, fifteen rounds to talk things out.',
  'Revolver': 'Double-action wheelgun, .357 Magnum. Six shots, slow reload, nothing jams.',
  'Snub Revolver': 'Five-shot backup piece. Barely points, but it\'s always there.',
  'Desert Eagle': 'Gas-operated .50 monster. Recoil is its own muzzle discipline.',
  'Flare Gun': 'Single-shot signal pistol. The round sticks and burns — good for everything except aim.',
  'M1911': 'Single-action .45 ACP. Hundred-year-old design, still prints the tightest group on most ranges.',
  'PDW': 'Pistol-caliber carbine. Armor-piercing rounds from a frame your hands already know.',
  'MP7': 'Submachine gun firing rifle-adjacent 4.6×30 rounds. Low recoil, huge mag, disappearing silhouette.',
  'AKS-74U': 'Krinkov-pattern shortened AK-74 carbine. Short barrel, folding stock, 5.45×39 thump in a small package.',
  'Remington 700': 'Bolt-action hunting rifle. Not tactical — just effective at distance.',
  'Mosin': 'Russian bolt-action, century-old design. The rifle grandfathers killed fascists with.',
  'SVD': 'Dragunov DMR. Semi-auto, tight groups at 300m, unmistakable silhouette.',
  'Cheytac Intervention': 'Anti-materiel bolt-action. Turns cover into a suggestion.',
  'M4 Block II': 'M4 with the full block — optic, foregrip, weapon light, drum. Everything on.',
  'AK47 ACOG': 'Classic AK with a Western combat optic taped to the rail. Soviet punch with modern eyes.',
  'Tavor': 'Israeli bullpup. Short package, full-length barrel, left-hand swappable if you know the trick.',
  'M16': 'A-profile, fixed carry handle, 20-inch barrel. Old-school rifle DNA — long reach, single-shot discipline.',
  'M16A4': 'Flat-top M16 with a free-float tube. The rifle the grown-ups still trust.',
  'M240': 'Belt-fed 7.62 GPMG. Heavier than the M249 and angrier about it.',
  'PKM': 'Soviet GPMG chambered in 7.62×54R. The rifle that won\'t stop chewing.',
  'RPK': 'AK-pattern light machine gun. Longer barrel, bigger drum, familiar controls.',
  'AA-12': 'Full-auto combat shotgun. Twelve-round drum, low-recoil system — dumps buckshot faster than anyone expects.',
  'P90': 'Bullpup 5.7×28 — huge magazine, flat trajectory, and the ergonomics of a shampoo bottle.',
  // Rifles
  'M4': 'A workhorse carbine. If it matters, the M4 has probably been there first.',
  'AK47': 'Stamped receiver, sloppy tolerances, eternal reliability. Punches harder than it has any right to.',
  'AS VAL': 'Integrally suppressed 9×39 carbine. Subsonic, quiet, mean at short range.',
  'VSS': 'Integrally suppressed 9×39 marksman rifle. Slower trigger, heavier hit, whispers across rooftops.',
  // Melee
  'Knife': 'Plain utility blade. Won\'t stop a charge, but it rarely jams.',
  'Club': 'Hardwood bludgeon. Simple, heavy, honest.',
  'Baseball Bat': 'Aluminum with a fresh coat of tape. Makes a satisfying ting on helmets.',
  'katana': 'Forged for a duel, stolen for a job. Reach and bleed damage that outclasses anything a grunt can grab.',
  'Brass Knuckles': 'Cast bronze across the knuckles. Fists get heavier; the rest of the hand stays honest.',
  'Crowbar': 'Bent tempered steel. Pries doors open, cracks collarbones, doesn\'t care which.',
  'Kukri': 'Forward-heavy Gurkha blade. Cuts deep with a short swing.',
  'Tomahawk': 'Balanced one-hand axe. Made to throw if you committed, made to chop if you didn\'t.',
  'Fire Axe': 'Red-handled, wedge-headed. Breaks doors. Breaks people.',
  'Sledgehammer': 'Twenty-pound maul. Ignores armor, ignores stance, ignores subtle.',
  'Chainsaw': 'Two-stroke snarl. No finesse. Ends arguments loud.',
  // Artifact
  "Jessica's Rage": 'Four toys, one soul, eternal grievance. The Great Bear only gave her up to a hunter willing to collect.',

  // Armor / gear
  'Kevlar Helmet':       'Layered aramid. Will stop a pistol round — once.',
  'Tactical Helmet':     'Night-vision cut, earpro mount, rail on the bridge. Weight you learn to ignore.',
  'Ballistic Helmet':    'Plate-ready head bucket. Heavy. You can hear your own blood.',
  'Ghillie Hood':        'Shredded burlap and twine. Nobody\'s looking at heads anyway.',
  'Gas Mask':            'CBRN-grade filter. Tastes like rubber forever, but your lungs thank you.',
  'Tactical Goggles':    'Strapped polycarbonate optics. Cuts flash, sharpens contrast, fogs in the rain.',
  'War Paint':           'Black and ochre stripes. Makes your pupils look bigger than they are.',
  'Balaclava':           'Anonymity, warmth, and a slight muffle on your shouting.',
  'Respirator':          'Half-mask filter. Cuts smoke and flame particulates.',
  'Comtacs':             'Active hearing pro. Cuts gunshots, amplifies footsteps.',
  'Silver Earring':      'Small jeweled hoop. Catches the light when you dodge.',
  'Sound Amplifier':     'Directional mic and a tiny DSP. Walls become slightly less opaque.',
  'Surveillance Headset':'Milspec listening kit wired into a wrist display.',
  'Wraith Earpiece':     'Unregistered prototype. Nobody admits to making it.',
  'Combat Earplugs':     'Disposable foam wedges. Dulls the roar, barely touches the hiss.',
  'Shoulder Pads':       'Kevlar cheaters. Shoulders aren\'t vital, but they sure look nice.',
  'Holster Rig':         'Leather pull rig that lets you change mags while running.',
  'Iron Epaulettes':     'Dress uniform brass layered over soft armor.',
  'Light Vest':          'Concealable soft armor. Bulks you out a pocket or two.',
  'Tactical Vest':       'Plate carrier cut for fit. Front, back, and two side pouches.',
  'Plate Armor':         'Ceramic steel-composite plate. Stops rifle. Slows everything.',
  'Ghillie Suit':        'Strips of burlap and fresh foliage. Moves like a tumbleweed; hides like one.',
  'Spetsnaz Plate Carrier': 'Former frontline armor. Someone stripped it off a body and it\'s on its second owner.',
  'Juggernaut Plating':  'Prototype steel suit. Hurts to carry, harder to kill.',
  'Thorned Harness':     'Spiked chest rig. Bad idea to grapple.',
  'Arm Pads':            'Light foam cups — elbows survive a fall.',
  'Assault Sleeves':     'Impact-absorbing tactical sleeves. Helps your hands stop shaking.',
  'Padded Sleeves':      'Quilted cotton and kevlar. Breathes in summer.',
  'Tactical Gloves':     'Knuckle-reinforced shooting gloves. Grip doesn\'t slip.',
  'Gauntlets':           'Plate-back gauntlets. Heavy enough to punch with.',
  'Trigger Gloves':      'Finger-cut gloves with micro-grip beading on the pad.',
  'Climber Gloves':      'Sticky rubber palms. Move like you know where you\'re going.',
  'Stonefist Gauntlets': 'Weighted knuckles, reinforced wrist. Turns hands into hammers.',
  'Combat Belt':         'Wide webbing with MOLLE loops. Carries what the pants can\'t.',
  'Ammo Belt':           'Bandolier loops for spare mags.',
  'Utility Belt':        'Layered webbing, general-purpose. Somehow always has one more pocket.',
  'Combat Pants':        'Ripstop with padded knees. Runs with you, falls with you.',
  'Runner Pants':        'Light, fast, a little too loud.',
  'Quilted Pants':       'Insulated and padded. Takes the edge off a boot.',
  'Knee Pads':           'Strapped foam. The kind that saves a meniscus.',
  'Reinforced Knees':    'Hard-shell knee plates with gel lining.',
  'Light Boots':         'Soft-sole tread. Turns a sprint into a sneak.',
  'Heavy Boots':         'Steel toe, ankle lock. Loud but durable.',
  'Silent Treads':       'Experimental sole compound that absorbs footfalls.',
  'Zephyr Boots':        'Running shoes with a classified compound. Faster than anything should be.',
  'Small Pack':          'Just enough to carry lunch and a spare mag.',
  'Combat Pack':         'MOLLE everything. Keeps the back straight.',
  'Large Rucksack':      'Expedition-grade haul bag. Barely fits through doorways.',
  'Focus Lens':          'Stabilized reticle monocle. Makes far targets feel close.',
  'Vampiric Mask':       'Chipped enamel and old blood. It remembers everything it touches.',

  // Consumables
  'Bandage':   'Clean gauze wrap. Stops a bleed; heals little.',
  'Painkillers':'Over-the-counter. Takes the sting, not the wound.',
  'Splint':    'Aluminum brace with cloth straps. Realigns a cracked bone.',
  'Medkit':    'Field kit — gauze, clotting agent, suture thread. The reliable fix.',
  'Trauma Kit':'Chest-seal, saline, morphine. Field surgery in a bag.',
  'Adrenaline Shot':'Auto-injector. Heart rate doubles; caution evaporates.',
  'Combat Stim':'Military-grade cocktail. Makes every punch land harder.',
  'Energy Drink':'Sugar, caffeine, dubious vitamins. Runs you ragged later.',
};

const RARITY_COLORS = {
  common:    '#b9b9b9',
  uncommon:  '#6abe5a',
  rare:      '#6aaedc',
  epic:      '#c97a5a',
  legendary: '#e6b94a',
};

// Stat key → render config for the apply()-driven effect surfacer below.
// Each entry says how to label a base-stats key, the math used to
// convert the raw delta into a player-facing number, the suffix unit,
// and which direction reads as a "good" change for the diff colouring
// in the comparison panel ('+' = higher is better, '-' = lower is
// better). When a key isn't listed we skip it rather than printing
// `magicMult: 1.234567` — the goal is readability.
const APPLY_STAT_LABELS = {
  // Movement / survival
  moveSpeedMult:        { label: 'Move Speed',         kind: 'mult', dir: '+' },
  staminaRegenMult:     { label: 'Stamina Regen',      kind: 'mult', dir: '+' },
  maxStaminaBonus:      { label: 'Max Stamina',        kind: 'add',  dir: '+' },
  maxHealthBonus:       { label: 'Max HP',             kind: 'add',  dir: '+' },
  healthRegenMult:      { label: 'Health Regen',       kind: 'mult', dir: '+' },
  healthRegenDelayBonus:{ label: 'Regen Delay',        kind: 'addS', dir: '-' },
  dmgReduction:         { label: 'Damage Reduction',   kind: 'pct',  dir: '+' },
  highHpReduction:      { label: 'Full-HP Reduction',  kind: 'pct',  dir: '+' },
  cornerReduction:      { label: 'Low-HP Reduction',   kind: 'pct',  dir: '+' },
  fireResist:           { label: 'Fire Resist',        kind: 'pct',  dir: '+' },
  ballisticResist:      { label: 'Ballistic Resist',   kind: 'pct',  dir: '+' },
  flashResist:          { label: 'Flash Resist',       kind: 'pct',  dir: '+' },
  // Combat
  rangedDmgMult:        { label: 'Ranged Damage',      kind: 'mult', dir: '+' },
  meleeDmgMult:         { label: 'Melee Damage',       kind: 'mult', dir: '+' },
  knockbackMult:        { label: 'Knockback',          kind: 'mult', dir: '+' },
  critChance:           { label: 'Crit Chance',        kind: 'pct',  dir: '+' },
  fireRateMult:         { label: 'Fire Rate',          kind: 'mult', dir: '+' },
  reloadSpeedMult:      { label: 'Reload Speed',       kind: 'mult', dir: '+' },
  magSizeMult:          { label: 'Magazine',           kind: 'mult', dir: '+' },
  rangeMult:            { label: 'Range',              kind: 'mult', dir: '+' },
  rangedSpreadMult:     { label: 'Spread',             kind: 'mult', dir: '-' },
  hipSpreadOnlyMult:    { label: 'Hip Spread',         kind: 'mult', dir: '-' },
  adsSpreadOnlyMult:    { label: 'ADS Spread',         kind: 'mult', dir: '-' },
  // Stealth / sense
  stealthMult:          { label: 'Detection',          kind: 'mult', dir: '-' },
  hearingRange:         { label: 'Sense Range',        kind: 'addM', dir: '+' },
  hearingAlpha:         { label: 'Ghost Visibility',   kind: 'addF', dir: '+' },
  crouchDmgMult:        { label: 'Crouched Damage',    kind: 'mult', dir: '+' },
  crouchMoveBonus:      { label: 'Crouched Speed',     kind: 'mult', dir: '+' },
  // Throwables
  throwableChargeBonus: { label: 'Throwable Charges',  kind: 'add',  dir: '+' },
  throwableCooldownMult:{ label: 'Throwable Cooldown', kind: 'mult', dir: '-' },
  // Economy
  creditDropMult:       { label: 'Credit Drops',       kind: 'mult', dir: '+' },
  shopPriceMult:        { label: 'Shop Prices',        kind: 'mult', dir: '-' },
  pocketsBonus:         { label: 'Pockets',            kind: 'add',  dir: '+' },
};

// Run the item's apply() on a sentinel BASE_STATS object and surface
// every meaningful diff. Without this, gear that grants its effects
// through apply() (most belts, gloves, boots, and the entire ears
// slot) showed nothing in the structured Stats section — players had
// to read the description to learn what the item did. This bridges
// that gap so the description can stop carrying numbers.
function applyDrivenStats(item) {
  if (!item || typeof item.apply !== 'function') return [];
  const before = BASE_STATS();
  const after = BASE_STATS();
  try { item.apply(after); } catch (_) { return []; }
  const rows = [];
  for (const [key, cfg] of Object.entries(APPLY_STAT_LABELS)) {
    const a = after[key], b = before[key];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (Math.abs(a - b) < 1e-6) continue;
    let val, suffix;
    switch (cfg.kind) {
      case 'mult': val = ((a / b - 1) * 100).toFixed(0); suffix = '%'; break;
      case 'pct':  val = ((a - b) * 100).toFixed(0);     suffix = '%'; break;
      case 'add':  val = (a - b).toFixed(0);             suffix = '';  break;
      case 'addM': val = (a - b).toFixed(0);             suffix = 'm'; break;
      case 'addS': val = (a - b).toFixed(1);             suffix = 's'; break;
      case 'addF': val = (a - b).toFixed(2);             suffix = '';  break;
      default: continue;
    }
    rows.push([cfg.label, +val, cfg.dir, suffix]);
  }
  return rows;
}

// Readable list of (key,value) stat rows. `item` is any inventory entry.
function collectStats(item) {
  const rows = [];
  if (!item) return rows;
  if (item.type === 'ranged') {
    rows.push(['Damage', item.damage, '+']);
    rows.push(['Fire Rate', item.fireRate, '+', '/s']);
    rows.push(['Range', item.range, '+']);
    rows.push(['Magazine', item.magSize, '+']);
    rows.push(['Reload', item.reloadTime, '-', 's']);
    if (typeof item.pelletCount === 'number') rows.push(['Pellets', item.pelletCount, '+']);
    if (item.hipSpread != null) rows.push(['Hip Spread', item.hipSpread, '-']);
    if (item.adsSpread != null) rows.push(['ADS Spread', item.adsSpread, '-']);
  } else if (item.type === 'melee') {
    // Pull representative combo step for a summary.
    const step = item.combo?.[0]?.close || item.combo?.[0]?.far;
    if (step) {
      rows.push(['Damage', step.damage, '+']);
      rows.push(['Range', step.range, '+']);
      rows.push(['Knockback', step.knockback, '+']);
    }
  } else if (item.type === 'armor' || item.type === 'gear' || item.slot === 'backpack') {
    if (typeof item.reduction === 'number') rows.push(['Damage Reduction', (item.reduction * 100).toFixed(0), '+', '%']);
    if (typeof item.pockets === 'number') rows.push(['Pockets', item.pockets, '+']);
    if (typeof item.speedMult === 'number') rows.push(['Move Speed', ((item.speedMult - 1) * 100).toFixed(0), '+', '%']);
    if (typeof item.stealthMult === 'number') rows.push(['Detection', ((1 - item.stealthMult) * 100).toFixed(0), '-', '%']);
  } else if (item.type === 'consumable') {
    const e = item.useEffect;
    if (e?.kind === 'heal') rows.push(['Heal', e.amount, '+', ' HP']);
    if (e?.cures?.length) rows.push(['Cures', e.cures.join(', '), '']);
  } else if (item.type === 'junk') {
    if (typeof item.sellValue === 'number') rows.push(['Sell Value', item.sellValue, '+', 'c']);
  }
  // Add any stats granted via apply() that weren't already covered by
  // the structured fields above. Dedupe by label so a belt that has
  // both `pockets: 1` and `apply(s) { s.pocketsBonus++ }` doesn't show
  // Pockets twice.
  const seen = new Set(rows.map(r => r[0]));
  for (const row of applyDrivenStats(item)) {
    if (!seen.has(row[0])) { rows.push(row); seen.add(row[0]); }
  }
  return rows;
}

function diffStats(item, equipped) {
  if (!equipped) return new Map();
  const diffs = new Map();
  const a = collectStats(item);
  const b = collectStats(equipped);
  const bMap = Object.fromEntries(b.map(r => [r[0], r[1]]));
  for (const [key, val] of a) {
    if (typeof val !== 'number' || typeof bMap[key] !== 'number') continue;
    diffs.set(key, +(val - bMap[key]).toFixed(2));
  }
  return diffs;
}

function compareEquipped(item, inventory) {
  if (!inventory || !item) return null;
  // Weapon: compare against the current weapon of the same class if any.
  if (item.type === 'ranged' || item.type === 'melee') {
    const slot = item.type === 'melee' ? 'melee' : (inventory.equipment.weapon1 ? 'weapon1' : 'weapon2');
    return inventory.equipment[slot] || null;
  }
  if (item.slot) return inventory.equipment[item.slot] || null;
  return null;
}

export class DetailsUI {
  constructor({ inventory }) {
    this.inventory = inventory;
    this.root = document.createElement('div');
    this.root.id = 'details-root';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="details-card"></div>
    `;
    document.body.appendChild(this.root);
    this.cardEl = this.root.querySelector('#details-card');
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.hide();
    });
    this.root.addEventListener('contextmenu', (e) => {
      // Right-click anywhere in the overlay dismisses, so players can
      // close the panel with the same button they used to open it.
      e.preventDefault();
      this.hide();
    });
  }

  hide() {
    this.root.style.display = 'none';
    this._item = null;
    this._teardownPreview();
  }

  show(item) {
    if (!item) return;
    this._teardownPreview();
    this._item = item;
    const equipped = compareEquipped(item, this.inventory);
    this.cardEl.innerHTML = this._render(item, equipped);
    this.root.style.display = 'flex';
    const previewHost = this.cardEl.querySelector('.details-preview');
    if (previewHost) this._setupPreview(previewHost, item);
  }

  // Rotating 3D preview of the item's model, if one is registered. Creates
  // a dedicated mini renderer per panel open; teardown on hide/replace.
  _setupPreview(host, item) {
    const url = modelForItem(item);
    if (!url) { host.remove(); return; }

    const width  = host.clientWidth  || 380;
    const height = host.clientHeight || 160;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 5, 2); scene.add(key);
    const fill = new THREE.DirectionalLight(0x8fbaff, 0.35); fill.position.set(-3, 2, -1); scene.add(fill);

    const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
    camera.position.set(2.4, 1.6, 2.4);
    camera.lookAt(0, 0, 0);

    const state = { renderer, scene, camera, rafId: 0, disposed: false, obj: null };
    this._preview = state;

    loadModelClone(url).then(obj => {
      if (state.disposed || !obj) return;
      fitToRadius(obj, 1.0);
      addOutlines(obj);
      applyEmissiveTint(obj, item.tint ?? 0xaaaaaa, 0.18);
      scene.add(obj);
      state.obj = obj;
    });

    let last = performance.now();
    const tick = (now) => {
      if (state.disposed) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (state.obj) state.obj.rotation.y += dt * 0.7;
      renderer.render(scene, camera);
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  _teardownPreview() {
    const s = this._preview; if (!s) return;
    s.disposed = true;
    cancelAnimationFrame(s.rafId);
    // Active context release. dispose() alone leaves the GL context
    // alive in the browser's context cap until GC; forceContextLoss
    // tells the GL layer to drop the slot immediately, so rapid
    // open-close-open-close inspect loops over a long session don't
    // pile dead contexts up to the cap.
    try { s.renderer.forceContextLoss(); } catch (_) {}
    s.renderer.dispose();
    s.renderer.domElement.remove();
    this._preview = null;
  }

  _render(item, equipped) {
    // When the inspected item has a currently-equipped counterpart in
    // the same slot/role, render two panes side-by-side: the left
    // shows what's already worn (with a CURRENTLY EQUIPPED badge so
    // the player understands which is which); the right is the new
    // item with stat diffs in green/red and an explicit "Stats you'll
    // lose" callout for any stat the equipped item carries that this
    // one doesn't.
    const showCompare = !!equipped && equipped !== item;
    if (!showCompare) {
      return `
        <div class="details-pane details-pane-solo">
          ${this._renderPane(item, { compareTo: null, isEquipped: false })}
        </div>
        <div class="details-footer">Right-click or click outside to close</div>
      `;
    }
    return `
      <div class="details-compare">
        <div class="details-pane details-pane-equipped">
          <div class="details-equipped-badge">CURRENTLY EQUIPPED</div>
          ${this._renderPane(equipped, { compareTo: null, isEquipped: true })}
        </div>
        <div class="details-pane details-pane-new">
          <div class="details-new-badge">REPLACING WITH</div>
          ${this._renderPane(item, { compareTo: equipped, isEquipped: false })}
        </div>
      </div>
      <div class="details-footer">Right-click or click outside to close</div>
    `;
  }

  // Render a single item pane. `compareTo` enables stat diffs against
  // the comparison item plus a "Stats you'll lose" section for any
  // stat the comparison has that this item doesn't.
  _renderPane(item, { compareTo, isEquipped }) {
    const rarity = inferRarity(item);
    const rColor = RARITY_COLORS[rarity] || '#b9b9b9';
    const icon = thumbnailFor(item);
    // Lore is purely flavor — only ever the curated ITEM_LORE entry.
    // The raw item.description field on most gear is a stat summary
    // (e.g. "−18% dmg, +5% stam regen") and now renders structurally
    // through collectStats, so showing it here too would duplicate
    // the same numbers the player already sees in the Stats section.
    const lore = ITEM_LORE[item.name] || '';
    // Description is suppressed when it looks stat-like (any %, ×, or
    // signed-number token). Non-stat descriptions still render below
    // the stats section as plain notes — useful for items like backpacks
    // where the description is "5 pack slots" and that's already
    // covered, vs. consumables with prose-only flavour.
    const descRaw = (item.description || '').trim();
    const hasNumeric = /[+\-−]?\d/.test(descRaw) || /%/.test(descRaw);
    const noteText = (descRaw && !hasNumeric && descRaw !== lore) ? descRaw : '';
    const rows = collectStats(item);
    const diffs = diffStats(item, compareTo);
    const tint = item.tint ?? 0x888888;
    const tintStr = `#${tint.toString(16).padStart(6, '0')}`;
    const slotLabel = item.slot ? (SLOT_LABEL[item.slot] || item.slot) : (item.type || '');

    const statRows = rows.map(([key, val, dir, suffix]) => {
      const unit = suffix || '';
      const d = diffs.get(key);
      let diffStr = '';
      if (typeof d === 'number' && Math.abs(d) > 0.005) {
        const good = (dir === '+' ? d > 0 : d < 0);
        const sign = d > 0 ? '+' : '';
        diffStr = `<span class="details-diff ${good ? 'good' : 'bad'}">(${sign}${d}${unit})</span>`;
      }
      return `<div class="details-stat-row"><span class="k">${key}</span><span class="v">${val}${unit}</span>${diffStr}</div>`;
    }).join('');

    // Stats only the equipped item carries — these would be lost on
    // the swap and need to be surfaced explicitly. Without this, a
    // helmet with +5 Move Speed silently downgrades to a plain helmet
    // and the player only finds out by feel.
    let lossRows = '';
    if (compareTo) {
      const myKeys = new Set(rows.map(r => r[0]));
      const otherRows = collectStats(compareTo);
      const losses = otherRows.filter(([key]) => !myKeys.has(key));
      if (losses.length) {
        lossRows = `
          <div class="details-section details-loss-section">
            <div class="details-section-title">Stats you'll lose</div>
            ${losses.map(([key, val, , suffix]) => {
              const unit = suffix || '';
              return `<div class="details-stat-row details-loss-row">
                <span class="k">${key}</span>
                <span class="v">−${val}${unit}</span>
              </div>`;
            }).join('')}
          </div>
        `;
      }
    }

    const affixes = (item.affixes || []).filter(a => a.kind !== 'setMark');
    const setAffix = (item.affixes || []).find(a => a.kind === 'setMark');
    const perks = item.perks || [];

    const affixBlock = affixes.length ? `
      <div class="details-section">
        <div class="details-section-title">Affixes</div>
        ${affixes.map(a => `<div class="details-affix">• ${a.label}</div>`).join('')}
      </div>
    ` : '';

    const perkBlock = perks.length ? `
      <div class="details-section">
        <div class="details-section-title">Perks</div>
        ${perks.map(p => `
          <div class="details-perk">
            <span class="details-perk-name">◆ ${p.name}</span>
            ${p.description ? `<span class="details-perk-desc"> — ${p.description}</span>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    let setBlock = '';
    if (setAffix && SET_DEFS[setAffix.setId]) {
      const def = SET_DEFS[setAffix.setId];
      const counts = countEquippedSetPieces(this.inventory.equipment);
      const have = counts[setAffix.setId] || 0;
      const tierRows = def.tiers.map(t => {
        const met = have >= t.pieces;
        return `<div class="details-set-tier ${met ? 'met' : 'missing'}">
          <span class="details-set-mark">${met ? '✓' : '✗'}</span>
          <span class="details-set-count">${t.pieces}pc</span>
          <span class="details-set-desc">${t.desc.replace(/^\d+pc:\s*/, '')}</span>
        </div>`;
      }).join('');
      setBlock = `
        <div class="details-section">
          <div class="details-section-title">${def.name} Set <span class="details-set-progress">${have} / ${def.tiers[def.tiers.length - 1].pieces} equipped</span></div>
          ${tierRows}
        </div>
      `;
    }

    const dur = item.durability;
    const durBlock = dur ? `
      <div class="details-durability">
        Durability <b>${Math.round(dur.current)}</b> / ${dur.max}
        <div class="details-dur-bar"><div style="width:${Math.max(0, (dur.current / dur.max) * 100).toFixed(0)}%"></div></div>
      </div>
    ` : '';

    // Only the new (non-equipped) pane shows the live 3D preview —
    // doubling it on the equipped pane wastes a GL context and
    // visually duplicates what the player already knows.
    const hasModel = !isEquipped && !!modelForItem(item);
    return `
      <div class="details-header" style="border-left: 4px solid ${rColor}">
        <div class="details-swatch" style="background:${tintStr}">
          ${icon ? `<img src="${icon}" alt="">` : ''}
        </div>
        <div class="details-title-col">
          <div class="details-name" style="color:${rColor}">${item.name}</div>
          <div class="details-subtitle">
            <span class="details-rarity">${rarity}</span>
            <span class="details-slot">${slotLabel}</span>
            ${item.class ? `<span class="details-class">${item.class}</span>` : ''}
          </div>
        </div>
      </div>
      ${hasModel ? `<div class="details-preview"></div>` : ''}
      ${lore ? `<div class="details-lore">"${lore}"</div>` : ''}
      ${rows.length ? `<div class="details-section">
        <div class="details-section-title">Stats</div>
        ${statRows}
      </div>` : ''}
      ${noteText ? `<div class="details-notes">${noteText}</div>` : ''}
      ${lossRows}
      ${affixBlock}
      ${perkBlock}
      ${setBlock}
      ${durBlock}
    `;
  }
}
