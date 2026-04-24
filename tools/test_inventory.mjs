// Integration tests for the grid-backed Inventory class.
// Run with:  node tools/test_inventory.mjs
//
// Covers the three-grid architecture introduced in Phase 2:
//   - pocketsGrid (always-on, 4×2)
//   - rigGrid (from belt, optional)
//   - backpackGrid (from backpack slot, optional)
import { Inventory } from '../src/inventory.js';

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed += 1; console.log(`  PASS  ${msg}`); }
  else      { failed += 1; console.error(`  FAIL  ${msg}`); }
}

function item(partial = {}) {
  // Minimal item. Inventory.add() stamps dims from class/slot/type
  // so we can leave w/h out.
  return { ...partial };
}

console.log('\n[inv] base capacity + single add');
{
  const inv = new Inventory();
  ok(inv.pocketsGrid.w === 4 && inv.pocketsGrid.h === 2, 'default pockets grid 4x2');
  ok(inv.rigGrid === null, 'no rig grid without belt');
  ok(inv.backpackGrid === null, 'no backpack grid without pack');
  const i = item({ type: 'consumable', id: 'bandage' });
  const res = inv.add(i);
  ok(res.placed, 'consumable adds');
  ok(inv.pocketsGrid.contains(i), 'pockets grid has the item');
  ok(inv.backpack.length === 1, 'legacy flat view sees 1 item');
}

console.log('\n[inv] weapon auto-equips first, then goes to a grid');
{
  const inv = new Inventory();
  const w1 = item({ type: 'ranged', class: 'pistol', name: 'Glock' });
  const w2 = item({ type: 'ranged', class: 'rifle',  name: 'AK-74' });
  const w3 = item({ type: 'ranged', class: 'smg',    name: 'MP5'   });
  ok(inv.add(w1).slot === 'weapon1', 'first weapon → weapon1');
  ok(inv.add(w2).slot === 'weapon2', 'second weapon → weapon2');
  const r3 = inv.add(w3);
  // SMG is 3×1, pockets is 4×2 — should fit in pockets.
  ok(r3.placed && !r3.slot && r3.pocketEntry, 'third weapon → a grid');
  ok(inv.pocketsGrid.contains(w3), 'w3 is in pockets');
}

console.log('\n[inv] rig grid spawns on belt equip');
{
  const inv = new Inventory();
  ok(inv.rigGrid === null, 'no rig before belt');
  const rig = item({ slot: 'belt', type: 'gear', name: 'Combat Belt',
    gridLayout: { w: 3, h: 2 } });
  inv.add(rig);
  ok(inv.equipment.belt === rig, 'belt equipped');
  ok(inv.rigGrid && inv.rigGrid.w === 3 && inv.rigGrid.h === 2, 'rig grid 3x2');
  // Items can go in the rig now.
  const c = item({ type: 'consumable', id: 'medkit' });
  inv.add(c);
  // add() prefers pockets first, so c goes in pockets — but we can
  // force it to the rig with autoPlaceAnywhere ordering: fill pockets
  // first, then the next item goes to rig.
  for (let k = 0; k < 10; k++) inv.add(item({ type: 'consumable', id: 'b'+k }));
  // Some items must now live in the rig grid.
  ok(inv.rigGrid.entries().length > 0, 'rig grid holds overflow items');
}

console.log('\n[inv] backpack grid spawns on backpack equip');
{
  const inv = new Inventory();
  const pack = item({ type: 'backpack', slot: 'backpack', name: 'Small Pack',
    gridLayout: { w: 4, h: 3 } });
  inv.add(pack);
  ok(inv.equipment.backpack === pack, 'backpack equipped');
  ok(inv.backpackGrid && inv.backpackGrid.w === 4 && inv.backpackGrid.h === 3,
     'backpack grid 4x3');
  ok(inv.pocketsGrid.w === 4 && inv.pocketsGrid.h === 2, 'pockets stayed 4x2');
}

console.log('\n[inv] unequipping a backpack tears down its grid and spills items');
{
  const inv = new Inventory();
  const pack = item({ type: 'backpack', slot: 'backpack', name: 'Med Pack',
    gridLayout: { w: 5, h: 4 } });
  inv.add(pack);
  // Fill some backpack slots with consumables.
  const a = item({ type: 'consumable', id: 'c_a' });
  const b = item({ type: 'consumable', id: 'c_b' });
  // Fill pockets first so these overflow into the backpack.
  for (let k = 0; k < 8; k++) inv.add(item({ type: 'consumable', id: 'p'+k }));
  inv.add(a);
  inv.add(b);
  ok(inv.backpackGrid.contains(a) || inv.backpackGrid.contains(b),
     'overflow items ended up in backpack grid');
  // Unequip: backpack itself has no room to land (pockets+rig+pack full),
  // but autoPlaceAnywhere considers ALL grids. If none have room, unequip
  // rolls back cleanly and returns false.
  const beforeBackpackItems = inv.backpackGrid.items().slice();
  const unequipped = inv.unequip('backpack');
  // If unequip succeeded, the backpack landed somewhere; if it failed,
  // it must still be equipped (rollback).
  if (unequipped) {
    ok(inv.equipment.backpack === null, 'slot cleared on success');
    ok(inv.backpackGrid === null, 'grid torn down on success');
  } else {
    ok(inv.equipment.backpack === pack, 'unequip failed → pack still equipped (no room)');
    // Grid instance may have been rebuilt during rollback — verify by
    // content: every item that was in the backpack is still somewhere.
    const survivors = beforeBackpackItems.filter(i => inv.gridOf(i) !== null).length;
    ok(survivors === beforeBackpackItems.length, 'rollback preserved all backpack items');
  }
}

console.log('\n[inv] takeFromBackpack by item reference + index (works across grids)');
{
  const inv = new Inventory();
  const c = item({ type: 'consumable', id: 'medkit' });
  inv.add(c);
  const byRef = inv.takeFromBackpack(c);
  ok(byRef === c, 'takeFromBackpack(item) returns the item');
  ok(!inv.pocketsGrid.contains(c), 'pockets no longer contain it');
  // Re-add and try by index (flat-array view semantics).
  inv.add(c);
  const byIdx = inv.takeFromBackpack(0);
  ok(byIdx === c, 'takeFromBackpack(0) returns the item');
}

console.log('\n[inv] equipBackpack swaps properly');
{
  const inv = new Inventory();
  const a = item({ type: 'ranged', class: 'pistol', name: 'A' });
  const b = item({ type: 'ranged', class: 'pistol', name: 'B' });
  inv.add(a);   // → weapon1
  inv.add(b);   // → weapon2 (both free so far)
  // Force b to a grid so we have something to promote.
  if (inv.equipment.weapon2 === b) {
    inv.unequip('weapon2');   // drops b into any grid
  }
  const okSwap = inv.equipBackpack(b);
  ok(okSwap, 'equipBackpack(b) swaps');
  ok(inv.equipment.weapon1 === b || inv.equipment.weapon2 === b,
     'b is now equipped');
}

console.log('\n[inv] consumable flow preserves item between action bar + grid');
{
  const inv = new Inventory();
  const c = item({ type: 'consumable', id: 'bandage', useEffect: {} });
  inv.add(c);
  inv.assignActionSlot(0, c);
  ok(inv.actionSlotItem(0) === c, 'action slot resolves while in a grid');
  const consumed = inv.consumeActionSlot(0);
  ok(consumed === c, 'consume returns the item');
  ok(!inv.pocketsGrid.contains(c), 'item removed from its grid on consume');
  ok(inv.actionSlotItem(0) === null, 'action slot empty after consume');
}

console.log('\n[inv] large items fit in any available grid');
{
  const inv = new Inventory();
  const r = item({ type: 'ranged', class: 'rifle', name: 'AK' });
  inv.add(r); // → weapon1
  ok(inv.equipment.weapon1 === r, 'rifle → weapon1');
  const r2 = item({ type: 'ranged', class: 'rifle', name: 'AK2' });
  const res = inv.add(r2);
  ok(res.placed && res.slot === 'weapon2', 'second rifle → weapon2');
  // A 3rd rifle (4×1) won't fit in 4×2 pockets only if pockets are busy.
  // We have nothing in pockets so it should fit.
  const r3 = item({ type: 'ranged', class: 'rifle', name: 'AK3' });
  const res3 = inv.add(r3);
  ok(res3.placed, 'third rifle placed somewhere');
}

console.log('\n[inv] cross-grid moves via moveInGrid');
{
  const inv = new Inventory();
  const pack = item({ type: 'backpack', slot: 'backpack', name: 'Pack',
    gridLayout: { w: 4, h: 3 } });
  inv.add(pack);  // spawns backpackGrid
  const c = item({ type: 'consumable', id: 'medkit' });
  inv.add(c);     // lands in pockets first
  ok(inv.pocketsGrid.contains(c), 'item starts in pockets');
  const moved = inv.moveInGrid(c, inv.backpackGrid, 0, 0);
  ok(moved, 'moveInGrid succeeded');
  ok(!inv.pocketsGrid.contains(c), 'pockets no longer contain it');
  ok(inv.backpackGrid.contains(c), 'backpack now contains it');
  // Move back.
  const movedBack = inv.moveInGrid(c, inv.pocketsGrid, 0, 0);
  ok(movedBack, 'moveInGrid back to pockets succeeded');
  ok(inv.pocketsGrid.contains(c), 'back in pockets');
}

console.log('\n[inv] allGrids() and gridOf() resolve correctly');
{
  const inv = new Inventory();
  const belt = item({ slot: 'belt', type: 'gear', gridLayout: { w: 3, h: 2 } });
  const pack = item({ type: 'backpack', slot: 'backpack',
    gridLayout: { w: 4, h: 3 } });
  inv.add(belt);
  inv.add(pack);
  const grids = inv.allGrids();
  ok(grids.length === 3, 'three grids when both rig + backpack equipped');
  ok(grids[0] === inv.pocketsGrid, 'pockets first');
  ok(grids[1] === inv.rigGrid,     'rig second');
  ok(grids[2] === inv.backpackGrid,'backpack third');
  const c = item({ type: 'consumable', id: 'medkit' });
  inv.add(c);
  ok(inv.gridOf(c) === inv.pocketsGrid, 'gridOf finds pockets');
  inv.moveInGrid(c, inv.backpackGrid, 0, 0);
  ok(inv.gridOf(c) === inv.backpackGrid, 'gridOf reflects move');
}

console.log('\n[inv] canAcceptInPockets scans all grids');
{
  const inv = new Inventory();
  // Fill pockets (4×2 = 8 cells) with 8 1×1 consumables.
  for (let k = 0; k < 8; k++) inv.add(item({ type: 'consumable', id: 'p'+k }));
  const extra = item({ type: 'consumable', id: 'extra' });
  ok(!inv.canAcceptInPockets(extra), 'no room anywhere');
  const pack = item({ type: 'backpack', slot: 'backpack',
    gridLayout: { w: 4, h: 3 } });
  inv.add(pack);
  ok(inv.canAcceptInPockets(extra), 'backpack grid added → room available');
}

console.log('\n[inv] swapping backpacks migrates fitting items, spills rest');
{
  const inv = new Inventory();
  const smallPack = item({ type: 'backpack', slot: 'backpack', name: 'Small',
    gridLayout: { w: 4, h: 3 } });
  inv.add(smallPack);
  // Add 10 consumables; pockets 8 + backpack 12 = 20 capacity.
  const items = [];
  for (let k = 0; k < 10; k++) {
    const c = item({ type: 'consumable', id: 'c'+k });
    items.push(c);
    inv.add(c);
  }
  const inBackpack = items.filter(i => inv.backpackGrid.contains(i)).length;
  ok(inBackpack > 0, 'at least one item migrated into backpack grid');
  // Now hot-swap to a bigger pack.
  const bigPack = item({ type: 'backpack', slot: 'backpack', name: 'Big',
    gridLayout: { w: 6, h: 5 } });
  inv.equipBackpack(bigPack);
  ok(inv.equipment.backpack === bigPack, 'big pack equipped');
  ok(inv.backpackGrid.w === 6 && inv.backpackGrid.h === 5, 'grid resized');
  const stillThere = items.filter(i => inv.gridOf(i) !== null).length;
  ok(stillThere === 10, 'all 10 items still in some grid');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
