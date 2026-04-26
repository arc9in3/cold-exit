// Customize-modal weapon schematics. Each class supplies:
//   - svg(): string SVG drawing (viewBox 0 0 600 260)
//   - slots: { slotId: { x, y } } in the same viewBox coords where that
//     attachment slot should sit visually on the weapon silhouette.
//
// Diagrams are painted stacked-primitive style to match the game's art.

const COLOR_STEEL = '#3a414c';
const COLOR_GRIP  = '#2a2220';
const COLOR_ACC   = '#7a6a40';

function rect(x, y, w, h, fill, stroke = COLOR_STEEL) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
}
function circle(cx, cy, r, fill, stroke = COLOR_STEEL) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
}

// Common visual grammar: barrel → receiver → stock, left → right, with the
// muzzle at the right tip.
const RIFLE_SVG = `
  ${rect(30, 115, 100, 26, '#2e333c')}          <!-- stock -->
  ${rect(130, 108, 220, 38, '#3c414c')}         <!-- receiver -->
  ${rect(350, 117, 160, 18, '#2e333c')}         <!-- barrel -->
  ${rect(510, 113, 40, 26, '#3c414c')}          <!-- muzzle device -->
  ${rect(210, 146, 40, 52, '#3a2e1a')}          <!-- magazine -->
  ${rect(180, 146, 22, 30, COLOR_GRIP)}         <!-- trigger guard -->
  ${rect(245, 150, 50, 55, COLOR_GRIP)}         <!-- pistol grip -->
  ${rect(150, 86, 140, 16, '#2a2f36')}          <!-- top rail -->
  ${rect(330, 146, 50, 14, '#2a2f36')}          <!-- under rail -->
  ${rect(305, 120, 22, 14, '#2a2f36')}          <!-- side rail -->
`;

const SMG_SVG = `
  ${rect(60, 120, 70, 26, '#2e333c')}           <!-- compact stock -->
  ${rect(130, 112, 170, 36, '#3c414c')}         <!-- receiver -->
  ${rect(300, 118, 100, 20, '#2e333c')}         <!-- short barrel -->
  ${rect(400, 114, 32, 24, '#3c414c')}          <!-- muzzle device -->
  ${rect(200, 146, 34, 50, '#3a2e1a')}          <!-- magazine -->
  ${rect(175, 144, 18, 28, COLOR_GRIP)}         <!-- trigger guard -->
  ${rect(235, 148, 42, 50, COLOR_GRIP)}         <!-- pistol grip -->
  ${rect(150, 90, 100, 16, '#2a2f36')}          <!-- top rail -->
  ${rect(270, 146, 35, 12, '#2a2f36')}          <!-- under rail -->
  ${rect(250, 122, 18, 14, '#2a2f36')}          <!-- side rail -->
`;

const PISTOL_SVG = `
  ${rect(180, 110, 200, 36, '#3c414c')}         <!-- slide / receiver -->
  ${rect(380, 118, 40, 20, '#2e333c')}          <!-- barrel tip -->
  ${rect(420, 116, 22, 24, '#3c414c')}          <!-- muzzle/compensator -->
  ${rect(245, 144, 32, 48, '#3a2e1a')}          <!-- magazine -->
  ${rect(220, 140, 20, 28, COLOR_GRIP)}         <!-- trigger guard -->
  ${rect(275, 146, 44, 60, COLOR_GRIP)}         <!-- grip -->
  ${rect(200, 92, 90, 14, '#2a2f36')}           <!-- top rail -->
  ${rect(320, 148, 30, 10, '#2a2f36')}          <!-- under rail -->
  ${rect(305, 122, 18, 12, '#2a2f36')}          <!-- side rail -->
`;

const SHOTGUN_SVG = `
  ${rect(30, 112, 110, 30, '#2e333c')}          <!-- stock -->
  ${rect(140, 108, 190, 38, '#3c414c')}         <!-- receiver -->
  ${rect(330, 117, 200, 18, '#2e333c')}         <!-- long barrel -->
  ${rect(528, 113, 30, 26, '#3c414c')}          <!-- muzzle choke -->
  ${rect(220, 146, 42, 48, '#3a2e1a')}          <!-- shell tube / mag -->
  ${rect(190, 146, 22, 30, COLOR_GRIP)}         <!-- trigger guard -->
  ${rect(260, 150, 48, 55, COLOR_GRIP)}         <!-- grip -->
  ${rect(160, 88, 120, 16, '#2a2f36')}          <!-- top rail -->
  ${rect(340, 146, 40, 14, '#2a2f36')}          <!-- under rail -->
`;

const MELEE_SVG = `
  ${rect(140, 118, 240, 10, '#cccccc')}         <!-- blade -->
  ${rect(370, 112, 30, 22, '#3c414c')}          <!-- guard / bolster -->
  ${rect(395, 115, 50, 14, '#3a2e1a')}          <!-- handle wrap -->
  ${rect(445, 116, 12, 12, '#d0a060')}          <!-- pommel -->
`;

// Slot cells are ~80px wide when rendered. To prevent overlap we position
// them in two fixed bands — top row ~y=36 (muzzle / rails / stock), bottom
// row ~y=228 (grip / trigger / magazine / under-rail). X coords preserve
// left-to-right ordering so they still visually anchor to the right part
// of the weapon (muzzle cell toward the muzzle end, stock toward the stock).
export const WEAPON_LAYOUTS = {
  pistol: {
    svg: PISTOL_SVG,
    slots: {
      topRail:   { x: 215, y: 36 },
      sideRail:  { x: 305, y: 36 },
      muzzle:    { x: 430, y: 36 },
      trigger:   { x: 170, y: 228 },
      magazine:  { x: 260, y: 228 },
      grip:      { x: 350, y: 228 },
    },
  },
  smg: {
    svg: SMG_SVG,
    slots: {
      stock:     { x:  95, y: 36 },
      topRail:   { x: 195, y: 36 },
      sideRail:  { x: 290, y: 36 },
      muzzle:    { x: 410, y: 36 },
      trigger:   { x: 170, y: 228 },
      magazine:  { x: 252, y: 228 },
      grip:      { x: 332, y: 228 },
      underRail: { x: 412, y: 228 },
    },
  },
  rifle: {
    svg: RIFLE_SVG,
    slots: {
      stock:     { x:  80, y: 36 },
      topRail:   { x: 180, y: 36 },
      sideRail:  { x: 282, y: 36 },
      barrel:    { x: 390, y: 36 },
      muzzle:    { x: 510, y: 36 },
      trigger:   { x: 155, y: 228 },
      magazine:  { x: 248, y: 228 },
      grip:      { x: 338, y: 228 },
      underRail: { x: 430, y: 228 },
    },
  },
  shotgun: {
    svg: SHOTGUN_SVG,
    slots: {
      stock:     { x:  85, y: 36 },
      topRail:   { x: 210, y: 36 },
      muzzle:    { x: 540, y: 36 },
      magazine:  { x: 245, y: 228 },
      underRail: { x: 380, y: 228 },
    },
  },
  lmg: {
    svg: RIFLE_SVG,
    slots: {
      stock:     { x:  80, y: 36 },
      topRail:   { x: 180, y: 36 },
      sideRail:  { x: 282, y: 36 },
      barrel:    { x: 390, y: 36 },
      muzzle:    { x: 510, y: 36 },
      magazine:  { x: 218, y: 228 },
      grip:      { x: 320, y: 228 },
      underRail: { x: 420, y: 228 },
    },
  },
  flame: {
    svg: SHOTGUN_SVG,
    slots: {
      sideRail:  { x: 250, y: 36 },
      muzzle:    { x: 540, y: 36 },
      magazine:  { x: 245, y: 228 },
      underRail: { x: 380, y: 228 },
    },
  },
  melee: {
    svg: MELEE_SVG,
    slots: {},
  },
};

import { renderForWeaponName } from './model_manifest.js';

export function layoutForWeapon(weapon) {
  const baseLayout = (() => {
    if (!weapon) return WEAPON_LAYOUTS.pistol;
    if (weapon.class && WEAPON_LAYOUTS[weapon.class]) return WEAPON_LAYOUTS[weapon.class];
    if (weapon.type === 'melee') return WEAPON_LAYOUTS.melee;
    return WEAPON_LAYOUTS.pistol;
  })();
  // Side-view PNG render registered for this weapon name → swap the
  // procedural class silhouette for the actual rendered model. Same
  // image as the inventory icon = consistent identity for the player.
  const lookupName = weapon?.baseName || weapon?.name;
  if (lookupName) {
    const url = renderForWeaponName(lookupName);
    if (url) {
      return {
        svg: `<image href="${url}" x="0" y="0" width="600" height="260" preserveAspectRatio="xMidYMid meet"/>`,
        slots: baseLayout.slots,
      };
    }
  }
  return baseLayout;
}
