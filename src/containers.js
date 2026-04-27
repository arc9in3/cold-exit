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
  withAffixes, wrapWeapon, forceMastercraft,
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

// Size profile — number of *real* items rolled per open. Every
// container also carries a guaranteed piece of junk on top of this
// (added in makeContainer below), so the totals players see are this
// + 1. Counts are intentionally lean — a typical small box hands the
// player one or two things, large boxes lean toward a single nicer
// roll rather than a pile of common filler.
const SIZE_PROFILES = {
  s: { items: () => Math.random() < 0.65 ? 0 : 1,       geo: { w: 0.7, h: 0.55, d: 0.5 } },
  m: { items: () => 1 + (Math.random() < 0.35 ? 1 : 0), geo: { w: 1.0, h: 0.75, d: 0.7 } },
  l: { items: () => Math.random() < 0.55
                       ? 1
                       : 2 + Math.floor(Math.random() * 2),  // 2..3
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
    // Encounter-only consumables (e.g. cheesecake) ARE allowed in
    // medical chests — they're themed-source loot. Just excluded
    // from the generic randomConsumable() pool. Keeps Sleepy Beauty
    // discoverable without diluting backpack drops.
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
    // Use forceMastercraft instead of just flipping the flag — it
    // applies the 1.5× bump to affix values, useEffect numbers, and
    // the visible MASTERCRAFT name tag. Setting wpn.mastercraft=true
    // alone shipped a flag-only "mastercraft" weapon with the same
    // stat numbers as a regular drop.
    forceMastercraft(wpn);
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
// label, type metadata). Every container — except the masterwork
// chest — carries a piece of junk on top of its rolled items so even
// a "low" roll is never completely dry.
export function makeContainer(type, size, levelIdx = 1) {
  const sizeProfile = SIZE_PROFILES[size] || SIZE_PROFILES.m;
  const itemCount = type === 'masterwork' ? 1 : sizeProfile.items();
  const loot = [];
  for (let i = 0; i < itemCount; i++) {
    const it = rollItemForType(type, levelIdx);
    if (it) loot.push(it);
  }
  // Junk floor — every non-masterwork container coughs up at least
  // one piece of junk so opening it always feels worth the prompt.
  // Masterwork chests stay pristine — single mythic item, no filler.
  if (type !== 'masterwork') {
    const j = randomJunk();
    if (j) loot.push(j);
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
// exceptionally rare — combined with the per-room spawn roll in
// level.js, a player should see one every several runs at most.
// General dominates so a typical room reads as "boxes" with the
// occasional themed stash.
export function pickContainerType(rng = Math.random) {
  const r = rng();
  if (r < 0.003) return 'masterwork';   // ~0.3% — exceptional find
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

// Spawn the visual mesh for a container. Each type gets a slightly
// different silhouette + a small icon mesh on top so the player can
// read what kind of container it is from across the room without
// having to walk up and trigger the prompt.
export function buildContainerMesh(container, x, y, z) {
  const { w, h, d } = container.geo;
  const c = container.colors;
  const group = new THREE.Group();
  const type = container.containerType;

  // Per-type silhouette tweaks layered on top of the base SIZE_PROFILES
  // dimensions. Weapon cases are squat + wide; armor lockers are tall
  // and thin; med kits are squarer; chests get a slight bulge to read
  // as ornate; general boxes stay closest to the base shape.
  let bw = w, bh = h, bd = d;
  if (type === 'weapon')          { bw = w * 1.25; bh = h * 0.55; bd = d * 0.95; }
  else if (type === 'armor')      { bw = w * 0.90; bh = h * 1.30; bd = d * 0.85; }
  else if (type === 'medical')    { bw = w * 0.85; bh = h * 0.95; bd = d * 0.85; }
  else if (type === 'masterwork') { bw = w * 1.10; bh = h * 0.90; bd = d * 1.10; }

  // Body — main coloured box.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: c.body, roughness: 0.85, metalness: 0.05,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bodyMat);
  body.position.y = bh / 2;
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
    new THREE.BoxGeometry(bw * 1.02, lidH, bd * 1.02), lidMat);
  lid.position.y = bh + lidH / 2;
  group.add(lid);

  // Per-type icon — small primitive on top of the lid that telegraphs
  // the container's contents. Cheap geometry, no shadow casting.
  const iconY = bh + lidH + 0.04;
  if (type === 'weapon') {
    // Crossed-bars cylinder = barrel-like marker.
    const iconMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a30, roughness: 0.45, metalness: 0.55,
    });
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, bw * 0.55, 8), iconMat);
    barrel.rotation.z = Math.PI / 2;
    barrel.position.y = iconY + 0.04;
    group.add(barrel);
  } else if (type === 'armor') {
    // Plate-like flat slab on the lid.
    const iconMat = new THREE.MeshStandardMaterial({
      color: 0x4a5a6a, roughness: 0.6, metalness: 0.35,
    });
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(bw * 0.5, 0.05, bd * 0.5), iconMat);
    plate.position.y = iconY + 0.025;
    group.add(plate);
  } else if (type === 'medical') {
    // Red-cross emblem out of two crossed boxes.
    const crossMat = new THREE.MeshStandardMaterial({
      color: 0xe04040, roughness: 0.5, metalness: 0.10,
      emissive: 0xe04040, emissiveIntensity: 0.30,
    });
    const horiz = new THREE.Mesh(
      new THREE.BoxGeometry(bw * 0.45, 0.04, bd * 0.12), crossMat);
    horiz.position.y = iconY + 0.02;
    group.add(horiz);
    const vert = new THREE.Mesh(
      new THREE.BoxGeometry(bw * 0.12, 0.04, bd * 0.45), crossMat);
    vert.position.y = iconY + 0.02;
    group.add(vert);
  } else if (type === 'masterwork') {
    // Pyramid emblem — pointier silhouette for "this is special".
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xe6b94a, roughness: 0.35, metalness: 0.85,
      emissive: 0xe6b94a, emissiveIntensity: 0.55,
    });
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.15, 0), goldMat);
    gem.position.y = iconY + 0.18;
    gem.rotation.y = Math.PI / 4;
    group.add(gem);
    // Plus a wider gold trim on the lid for ornate readability.
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xe6b94a, roughness: 0.45, metalness: 0.7,
      emissive: 0xe6b94a, emissiveIntensity: 0.25,
    });
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(bw * 1.05, 0.03, bd * 1.05), trimMat);
    trim.position.y = bh + 0.005;
    group.add(trim);
  } else {
    // General container — a small handle-like loop on top.
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x2a2018, roughness: 0.7, metalness: 0.30,
    });
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.10, 0.025, 6, 12), handleMat);
    handle.rotation.x = Math.PI / 2;
    handle.position.y = iconY + 0.06;
    group.add(handle);
  }

  // Masterwork chest gets a subtle gold rim glow + slight scale-up.
  if (type === 'masterwork') {
    lidMat.emissiveIntensity = 0.45;
    group.scale.setScalar(1.1);
  }
  group.position.set(x, y, z);
  group.rotation.y = Math.random() * Math.PI * 2;
  group.userData.container = container;
  return group;
}
