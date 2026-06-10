// Shared item cell renderer. Used by inventory, loot modal, shop, and
// customize UIs so every grid cell looks identical: large 3D thumbnail
// on the left with the item name overlaid, stat column on the right
// with affixes / perks / ammo / durability stacked.
//
// Thumbnails come from item_thumbnails.js — rendered once via an
// offscreen WebGL canvas and cached by a stable item key. This
// replaces the old Military icon-pack PNG stack which was too dense
// and too similar to tell items apart at a glance.
import { inferRarity, rarityColor, weaponImageMirrorStyle, TYPE_ICONS, SLOT_LABEL, SLOT_ICONS, slotIconHTML } from './inventory.js';
import { thumbnailFor } from './item_thumbnails.js';

export function renderItemCell(item, slotId = null, opts = {}) {
  const slotLabel = slotId ? (SLOT_LABEL[slotId] || slotId) : '';
  if (!item) {
    // slotIconHTML renders a PNG silhouette if one exists for this
    // slot (Military pack), else falls back to the unicode glyph.
    // The `cell-empty-icon-img` class sizes the PNG to match the
    // cell — 48px square, centered, no tint (default white silhouette
    // on the slate background).
    const iconHTML = slotId
      ? slotIconHTML(slotId, { cls: 'cell-empty-ico-img', fallback: '·' })
      : '·';
    const lbl = slotLabel ? `<div class="cell-label">${slotLabel}</div>` : '';
    return `${lbl}<div class="cell-empty-ico">${iconHTML}</div>`;
  }
  // Cell tile background — was the rarity color directly, which
  // washed out item silhouettes (especially gen-2d images that have
  // their own warm/cool palettes — the colored backdrop competed
  // with the image content). Now use a neutral dark slot color and
  // surface rarity via a glow / inset border instead. The rarity
  // hex is still stamped on `data-rarity-color` so future styling
  // hooks (border tint, glow, name color) can read it.
  const rarityHex = rarityColor(item);
  const tintStr = '#1a1e26';
  const thumbUrl = thumbnailFor(item);

  // Primary item art — 3D-rendered thumbnail of the item's category
  // silhouette, tinted by the item's color. Falls back to a type
  // glyph if WebGL thumb generation fails (e.g. headless test).
  const mirrorStyle = weaponImageMirrorStyle(item);
  const artInner = thumbUrl
    ? `<img class="cell-art-img" src="${thumbUrl}" alt="" style="${mirrorStyle}">`
    : `<span class="cell-type-ico">${TYPE_ICONS[item.type] || '◇'}</span>`;

  const slotTag = slotLabel ? `<div class="cell-slot-tag">${slotLabel}</div>` : '';
  const custBtn = opts.owned && (item.type === 'ranged' || item.type === 'melee')
    ? `<button class="cust-btn" type="button" title="Customize">⚙</button>`
    : '';

  // Right-side stat lines. Every equippable / usable item type should
  // surface at least one numeric stat chip so the cell isn't carried
  // entirely by the description text. Type coverage was previously
  // gappy — throwables, attachments, repairkits, backpacks rendered
  // with no chips at all and just leaned on the description.
  const stats = [];
  if (item.type === 'ranged') {
    if (typeof item.damage === 'number') stats.push(`<span class="cell-stat">DMG <b>${Math.round(item.damage)}</b></span>`);
    if (typeof item.fireRate === 'number' && item.fireRate > 0) stats.push(`<span class="cell-stat">RPS <b>${Math.round(item.fireRate)}</b></span>`);
    if (typeof item.magSize === 'number') stats.push(`<span class="cell-stat">MAG <b>${item.ammo ?? item.magSize}/${item.magSize}</b></span>`);
  } else if (item.type === 'melee') {
    // Show the basic-strike damage (combo[0].close = primary swing).
    // Heavy / charged steps live deeper in the combo array and are
    // surfaced on the details panel — the cell stays uncluttered.
    const step = item.combo?.[0]?.close || item.combo?.[0]?.far;
    if (step?.damage != null) stats.push(`<span class="cell-stat">DMG <b>${step.damage}</b></span>`);
    if (typeof item.staminaCost === 'number') stats.push(`<span class="cell-stat">STA <b>${item.staminaCost}</b></span>`);
  } else if (item.type === 'armor' || item.type === 'gear') {
    if (typeof item.reduction === 'number') stats.push(`<span class="cell-stat">DR <b>${Math.round(item.reduction * 100)}%</b></span>`);
    if (typeof item.pockets === 'number') stats.push(`<span class="cell-stat">+${item.pockets} <b>pocket${item.pockets > 1 ? 's' : ''}</b></span>`);
  } else if (item.type === 'backpack') {
    if (typeof item.pockets === 'number') stats.push(`<span class="cell-stat">+${item.pockets} <b>slots</b></span>`);
    if (typeof item.speedMult === 'number' && Math.abs(item.speedMult - 1) > 0.001) {
      const pct = Math.round((item.speedMult - 1) * 100);
      stats.push(`<span class="cell-stat">MOVE <b>${pct >= 0 ? '+' : ''}${pct}%</b></span>`);
    }
  } else if (item.type === 'consumable') {
    const e = item.useEffect;
    if (e?.kind === 'heal' && typeof e.amount === 'number') stats.push(`<span class="cell-stat">HEAL <b>${e.amount}</b></span>`);
    if (e?.kind === 'buff') stats.push(`<span class="cell-stat">BUFF <b>${(e.life | 0) || '∞'}s</b></span>`);
    if (Array.isArray(e?.cures) && e.cures.length) stats.push(`<span class="cell-stat">CURE <b>${e.cures.join(', ')}</b></span>`);
  } else if (item.type === 'throwable') {
    if (typeof item.aoeDamage === 'number') stats.push(`<span class="cell-stat">DMG <b>${item.aoeDamage}</b></span>`);
    if (typeof item.aoeRadius === 'number') stats.push(`<span class="cell-stat">RAD <b>${item.aoeRadius}m</b></span>`);
    if (typeof item.maxCharges === 'number') stats.push(`<span class="cell-stat">USES <b>${item.charges ?? item.maxCharges}/${item.maxCharges}</b></span>`);
  } else if (item.type === 'attachment') {
    // Attachments don't carry numeric headline stats — their modifier
    // object is read at attach time. Surface the slot + a compact
    // hint that this is a wpn-mod so the player isn't expected to
    // read the full description in the grid view.
    if (item.slot) stats.push(`<span class="cell-stat">MOD <b>${item.slot}</b></span>`);
  } else if (item.type === 'repairkit') {
    // Repair kits expose `repairAmount` (HP restored) and may be
    // gated by item type (weapon-only vs armor-only). Chip out both
    // so the player can tell at a glance.
    if (typeof item.repairAmount === 'number') stats.push(`<span class="cell-stat">REPAIR <b>+${item.repairAmount}</b></span>`);
    if (item.repairsType) stats.push(`<span class="cell-stat">FOR <b>${item.repairsType}</b></span>`);
  } else if (item.type === 'junk') {
    if (typeof item.sellValue === 'number') stats.push(`<span class="cell-stat">SELL <b>${item.sellValue}c</b></span>`);
  }

  // Intrinsic bonuses live in item.description (e.g. "+10% move speed",
  // "−18% damage taken"). The hardcoded stats chips above only cover DR
  // and pockets, so without this line armor/gear whose buff comes via
  // apply() looks empty in the inventory grid.
  const descLine = item.description
    ? `<div class="cell-desc">${item.description}</div>`
    : '';
  // Affix display — 2 visible, the rest collapsed into a "+N more"
  // count so the player isn't surprised by hidden rolls (a 3-affix
  // legendary used to silently drop its third). Tooltip on the
  // overflow chip lists every rolled affix so hover gives the full
  // picture without leaving the grid.
  let affixLine = '';
  if (item.affixes && item.affixes.length) {
    const visible = item.affixes.slice(0, 2).map(a => `• ${a.label}`).join('<br>');
    const hidden = item.affixes.length - 2;
    const overflow = hidden > 0
      ? `<div class="cell-affix-overflow" title="${item.affixes.map(a => a.label).join(' · ')}">+${hidden} more</div>`
      : '';
    affixLine = `<div class="cell-affixes">${visible}${overflow}</div>`;
  }
  const perkLine = (item.perks && item.perks.length)
    ? `<div class="cell-perks">${item.perks.map(p =>
        `<span class="perk"><span class="perk-name">◆ ${p.name}</span></span>`
      ).join('')}</div>`
    : '';

  const dur = item.durability;
  let durBar = '';
  if (dur) {
    const pct = Math.max(0, Math.min(100, (dur.current / dur.max) * 100));
    // Color threshold — green > 60%, yellow 30-60%, red < 30%. Gives
    // an at-a-glance cue for when armor needs swapping without
    // having to open the details panel.
    const color = pct > 60 ? '#6abe8a' : pct > 30 ? '#e0c040' : '#d24040';
    const label = `${Math.round(pct)}%`;
    durBar = `<div class="cell-dur" title="Condition ${label}">
        <div class="cell-dur-fill" style="width:${pct.toFixed(0)}%;background:${color}"></div>
        <span class="cell-dur-label">${label}</span>
      </div>`;
  }

  // Broken overlay — when durability drops to 0, all stat bonuses
  // are nullified (see Inventory.applyTo) and weapons can't fire.
  // Visually call this out with a red BROKEN tag stamped over the
  // middle of the cell art so the player can spot broken gear in
  // the inventory grid without opening the details panel.
  const isBroken = !!(dur && dur.current <= 0);
  const brokenTag = isBroken ? `<div class="cell-broken-tag">BROKEN</div>` : '';
  // Player-applied tags. Mark-as-Junk includes the item in Sell All
  // Junk regardless of type. Mark-to-Keep refuses sells + drops in
  // every UI so a high-value item can't slip through a sell-all click
  // or a stray shift-click.
  const markTag = item.markedJunk
    ? `<div class="cell-mark-tag mark-junk" title="Marked as Junk — included in Sell All Junk">JUNK</div>`
    : item.markedKeep
      ? `<div class="cell-mark-tag mark-keep" title="Marked to Keep — locked from sell + drop">KEEP</div>`
      : '';

  return `
    <div class="cell-art ${isBroken ? 'cell-art-broken' : ''}" style="background:${tintStr};box-shadow:inset 0 0 0 2px ${rarityHex},inset 0 0 0 3px rgba(0,0,0,0.5),0 0 8px ${rarityHex}66">
      ${artInner}
      ${brokenTag}
      ${markTag}
      <div class="cell-name-overlay" title="${(item.name || '').replace(/<[^>]*>/g, '').replace(/"/g, '&quot;')}">${item.name}</div>
    </div>
    <div class="cell-stats">
      ${stats.join('')}
      ${descLine}
      ${perkLine}
      ${affixLine}
      ${durBar}
    </div>
    ${slotTag}
    ${custBtn}
  `;
}
