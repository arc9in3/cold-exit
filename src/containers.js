// Lootable containers scattered through level rooms. Reuses the body-loot
// flow on the player side — a container `target` has the same {loot,
// looted} shape lootUI expects, plus name/title metadata for the loot
// modal header. Container types bias their internal roll table toward a
// theme (weapons, armor, medical, etc.) so the player can spot which
// crate is worth opening at a glance.
//
// Spawn density and roll counts are conservative — body drops were
// trimmed in the same pass that introduced this system, so containers
// carry the bulk of the run's loot without flooding rooms.
import * as THREE from 'three';
import {
  ALL_GEAR, ALL_ARMOR, ALL_CONSUMABLES, CONSUMABLE_DEFS,
  randomArmor, randomGear, randomConsumable, randomJunk, randomThrowable,
  withAffixes, wrapWeapon,
} from './inventory.js';
import { ALL_ATTACHMENTS, randomAttachment } from './attachments.js';
import { tunables } from './tunables.js';

// Visual tint per container type — top of the box reads as a colored
// strip so the player can identify the type at a glance even before
// reading the prompt label.
const TYPE_COLORS = {
  general:    { body: 0x6a4a2a, lid: 0x9b8b6a },
  weapon:     { body: 0x3a3a48, lid: 0x6a7080 },
  armor:      { body: 0x3a4040, lid: 0x6aaedc },
  medical:    { body: 0x6a3030, lid: 0xd24040 },
  masterwork: { body: 0x4a3018, lid: 0xe6b94a },
};

// Pool of names per type so two boxes in a row don't read identically.
const TYPE_NAMES = {
  general:    ['Cardboard Box', 'Storage Bin', 'Wooden Crate', 'Footlocker', 'Duffel Bag', 'Salvage Pile'],
  weapon:     ['Weapon Locker', 'Gun Case', 'Ammo Crate', 'Tactical Bag', 'Armory Chest'],
  armor:      ['Armor Rack', 'Wardrobe', 'Equipment Locker', 'Tactical Vest Bag'],
  medical:    ['First Aid Kit', 'Medical Cabinet', 'Field Med Bag', 'Pharmacy Box'],
  masterwork: ['Masterwork Chest'],
};

// Size profile — number of items rolled per open. Large skews toward
// fewer high-quality items (a single masterpiece in a footlocker reads
// better than 6 commons), so it's bimodal rather than always 6.
const SIZE_PROFILES = {
  s: { items: () => 1 + Math.floor(Math.random() * 2),   geo: { w: 0.7, h: 0.55, d: 0.5 } },
  m: { items: () => 2 + Math.floor(Math.random() * 3),   geo: { w: 1.0, h: 0.75, d: 0.7 } },
  l: { items: () => Math.random() < 0.30
                       ? 1
                       : 2 + Math.floor(Math.random() * 5),  // 2..6
        geo: { w: 1.4, h: 1.0, d: 0.95 } },
};

// Per-type roll function. Keeps the loot tables aligned with their
// label — a weapon crate that drops armor would be a bug.
function rollItemForType(type, levelIdx) {
  // Helper to forge a fresh durability bundle since defs share the same
  // object reference across spawns.
  const _withDur = (item) => ({
    ...item,
    durability: item.durability ? { ...item.durability } : undefined,
  });

  if (type === 'weapon') {
    const r = Math.random();
    if (r < 0.55) {
      const pool = tunables.weapons.filter(w =>
        !w.artifact && !w.mythic && w.rarity !== 'mythic');
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return wrapWeapon(pick);
    }
    if (r < 0.80) return randomThrowable();
    return randomAttachment();
  }
  if (type === 'armor') {
    return Math.random() < 0.55
      ? withAffixes(_withDur(randomArmor()))
      : withAffixes(_withDur(randomGear()));
  }
  if (type === 'medical') {
    const heals = ALL_CONSUMABLES.filter(c =>
      c.useEffect?.kind === 'heal' || c.useEffect?.kind === 'buff');
    const pool = heals.length ? heals : ALL_CONSUMABLES;
    return { ...pool[Math.floor(Math.random() * pool.length)] };
  }
  if (type === 'masterwork') {
    // Single item, always high-rarity — caller already gates this to
    // a single-item chest.
    const pool = tunables.weapons.filter(w =>
      !w.artifact && !w.mythic && w.rarity !== 'mythic');
    const wpn = wrapWeapon(pool[Math.floor(Math.random() * pool.length)]);
    wpn.rarity = Math.random() < 0.55 ? 'epic' : 'legendary';
    wpn.mastercraft = true;
    return wpn;
  }
  // General — roll across categories with a believable mix.
  const r = Math.random();
  if (r < 0.18) return randomConsumable();
  if (r < 0.35) return withAffixes(_withDur(randomGear()));
  if (r < 0.52) return withAffixes(_withDur(randomArmor()));
  if (r < 0.65) return randomAttachment();
  if (r < 0.78) return randomThrowable();
  if (r < 0.92) return randomJunk();
  // Small chance of a weapon in a general crate — rare enough that
  // weapon crates still feel like the right place to look.
  const pool = tunables.weapons.filter(w =>
    !w.artifact && !w.mythic && w.rarity !== 'mythic');
  return wrapWeapon(pool[Math.floor(Math.random() * pool.length)]);
}

// Build a complete container descriptor. Caller spawns the mesh and
// places it in world; this function builds the data side (loot list,
// label, type metadata).
export function makeContainer(type, size, levelIdx = 1) {
  const sizeProfile = SIZE_PROFILES[size] || SIZE_PROFILES.m;
  const itemCount = type === 'masterwork' ? 1 : sizeProfile.items();
  const loot = [];
  for (let i = 0; i < itemCount; i++) {
    const it = rollItemForType(type, levelIdx);
    if (it) loot.push(it);
  }
  const names = TYPE_NAMES[type] || TYPE_NAMES.general;
  const name = names[Math.floor(Math.random() * names.length)];
  return {
    kind: 'container',
    containerType: type,
    size,
    name,
    loot,
    looted: false,
    geo: sizeProfile.geo,
    colors: TYPE_COLORS[type] || TYPE_COLORS.general,
  };
}

// Pick a container type for a generic spawn slot. Masterwork is
// intentionally rare. General dominates so a typical room reads as
// "boxes" with the occasional themed stash.
export function pickContainerType(rng = Math.random) {
  const r = rng();
  if (r < 0.012) return 'masterwork';   // ~1% — feels mythic
  if (r < 0.25)  return 'medical';
  if (r < 0.45)  return 'armor';
  if (r < 0.65)  return 'weapon';
  return 'general';
}

// Pick a size — small biased, large rare.
export function pickContainerSize(type, rng = Math.random) {
  if (type === 'masterwork') return 'l';
  const r = rng();
  if (r < 0.55) return 's';
  if (r < 0.88) return 'm';
  return 'l';
}

// Spawn the visual mesh for a container. Returns an Object3D with the
// container metadata stamped onto userData so interact-prompt code can
// pull it back out via the proxy on the obstacles list.
export function buildContainerMesh(container, x, y, z) {
  const { w, h, d } = container.geo;
  const c = container.colors;
  const group = new THREE.Group();
  // Body — main coloured box.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: c.body, roughness: 0.85, metalness: 0.05,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bodyMat);
  body.position.y = h / 2;
  body.castShadow = false;
  body.receiveShadow = false;
  group.add(body);
  // Lid — thin coloured strip on top so the type reads at a glance.
  const lidH = 0.07;
  const lidMat = new THREE.MeshStandardMaterial({
    color: c.lid, roughness: 0.55, metalness: 0.10,
    emissive: c.lid, emissiveIntensity: 0.10,
  });
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(w * 1.02, lidH, d * 1.02), lidMat);
  lid.position.y = h + lidH / 2;
  group.add(lid);
  // Masterwork chest gets a subtle gold rim glow + slight scale-up.
  if (container.containerType === 'masterwork') {
    lidMat.emissiveIntensity = 0.45;
    group.scale.setScalar(1.1);
  }
  group.position.set(x, y, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  group.userData.container = container;
  return group;
}
