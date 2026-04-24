// Shared item cell renderer. Used by inventory, loot modal, shop, and
// customize UIs so every grid cell looks identical: large 3D thumbnail
// on the left with the item name overlaid, stat column on the right
// with affixes / perks / ammo / durability stacked.
//
// Thumbnails come from item_thumbnails.js — rendered once via an
// offscreen WebGL canvas and cached by a stable item key. This
// replaces the old Military icon-pack PNG stack which was too dense
// and too similar to tell items apart at a glance.
import { inferRarity, TYPE_ICONS, SLOT_LABEL, SLOT_ICONS } from './inventory.js';
import { thumbnailFor } from './item_thumbnails.js';

export function renderItemCell(item, slotId = null, opts = {}) {
  const slotLabel = slotId ? (SLOT_LABEL[slotId] || slotId) : '';
  if (!item) {
    const icon = slotId ? (SLOT_ICONS[slotId] || '·') : '·';
    const lbl = slotLabel ? `<div class="cell-label">${slotLabel}</div>` : '';
    return `${lbl}<div class="cell-empty-ico">${icon}</div>`;
  }
  const tint = item.tint ?? 0x888888;
  const tintStr = `#${tint.toString(16).padStart(6, '0')}`;
  const thumbUrl = thumbnailFor(item);

  // Primary item art — 3D-rendered thumbnail of the item's category
  // silhouette, tinted by the item's color. Falls back to a type
  // glyph if WebGL thumb generation fails (e.g. headless test).
  const artInner = thumbUrl
    ? `<img class="cell-art-img" src="${thumbUrl}" alt="">`
    : `<span class="cell-type-ico">${TYPE_ICONS[item.type] || '◇'}</span>`;

  const slotTag = slotLabel ? `<div class="cell-slot-tag">${slotLabel}</div>` : '';
  const custBtn = opts.owned && (item.type === 'ranged' || item.type === 'melee')
    ? `<button class="cust-btn" type="button" title="Customize">⚙</button>`
    : '';

  // Right-side stat lines.
  const stats = [];
  if (item.type === 'ranged') {
    if (typeof item.damage === 'number') stats.push(`<span class="cell-stat">DMG <b>${item.damage.toFixed(0)}</b></span>`);
    if (typeof item.fireRate === 'number' && item.fireRate > 0) stats.push(`<span class="cell-stat">RPS <b>${item.fireRate.toFixed(1)}</b></span>`);
    if (typeof item.magSize === 'number') stats.push(`<span class="cell-stat">MAG <b>${item.ammo ?? item.magSize}/${item.magSize}</b></span>`);
  } else if (item.type === 'melee') {
    const step = item.combo?.[0]?.close || item.combo?.[0]?.far;
    if (step) stats.push(`<span class="cell-stat">DMG <b>${step.damage}</b></span>`);
  } else if (item.type === 'armor' || item.type === 'gear') {
    if (typeof item.reduction === 'number') stats.push(`<span class="cell-stat">DR <b>${Math.round(item.reduction * 100)}%</b></span>`);
    if (typeof item.pockets === 'number') stats.push(`<span class="cell-stat">+${item.pockets} <b>pocket${item.pockets > 1 ? 's' : ''}</b></span>`);
  } else if (item.type === 'consumable') {
    const e = item.useEffect;
    if (e?.kind === 'heal') stats.push(`<span class="cell-stat">HEAL <b>${e.amount}</b></span>`);
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
  const affixLine = (item.affixes && item.affixes.length)
    ? `<div class="cell-affixes">${item.affixes.slice(0, 2).map(a => `• ${a.label}`).join('<br>')}</div>`
    : '';
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

  return `
    <div class="cell-art" style="background:${tintStr}">
      ${artInner}
      <div class="cell-name-overlay">${item.name}</div>
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
