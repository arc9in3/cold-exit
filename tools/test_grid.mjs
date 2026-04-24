// Standalone test for GridContainer — no browser needed.
// Run with:  node tools/test_grid.mjs
import { GridContainer, itemFootprint, stampItemDims } from '../src/grid_container.js';

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed += 1; console.log(`  PASS  ${msg}`); }
  else      { failed += 1; console.error(`  FAIL  ${msg}`); }
}
function eq(a, b, msg) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, `${msg}${same ? '' : `\n        got ${JSON.stringify(a)}\n        want ${JSON.stringify(b)}`}`);
}

console.log('\n[grid] basic placement');
{
  const g = new GridContainer(4, 4);
  const pistol = { id: 'p', w: 2, h: 1 };
  const e = g.place(pistol, 0, 0);
  ok(!!e, 'place 2x1 at (0,0) succeeds');
  ok(g.cellOccupied(0, 0), 'cell (0,0) occupied');
  ok(g.cellOccupied(1, 0), 'cell (1,0) occupied');
  ok(!g.cellOccupied(2, 0), 'cell (2,0) free');
  ok(!g.cellOccupied(0, 1), 'cell (0,1) free');
  eq(g.freeCells(), 14, 'freeCells after 2x1 = 14');
}

console.log('\n[grid] collision detection');
{
  const g = new GridContainer(4, 4);
  g.place({ w: 2, h: 1 }, 0, 0);
  ok(!g.canPlace({ w: 2, h: 1 }, 1, 0), 'overlap at (1,0) rejected');
  ok( g.canPlace({ w: 2, h: 1 }, 2, 0), '(2,0) still free');
  ok(!g.canPlace({ w: 3, h: 3 }, 2, 2), 'out of bounds rejected');
  ok(!g.canPlace({ w: 1, h: 1 }, -1, 0), 'negative coord rejected');
}

console.log('\n[grid] rotation');
{
  const g = new GridContainer(4, 4);
  const tall = { w: 1, h: 3 };
  ok( g.canPlace(tall, 0, 0, false), '1x3 upright fits');
  ok( g.canPlace(tall, 0, 0, true),  '3x1 rotated also fits');
  const e = g.place(tall, 0, 0, true);
  ok(e && e.w === 3 && e.h === 1, 'rotated entry has swapped dims');
  ok(g.cellOccupied(2, 0), 'rotated 3x1 occupies (2,0)');
  ok(!g.cellOccupied(0, 1), 'rotated 3x1 does NOT occupy (0,1)');
}

console.log('\n[grid] autoPlace');
{
  const g = new GridContainer(4, 4);
  g.place({ w: 2, h: 1 }, 0, 0);      // top-left 2 cells
  g.place({ w: 2, h: 1 }, 2, 0);      // right half
  const e = g.autoPlace({ w: 2, h: 1 });  // should land at (0,1)
  eq({ x: e.x, y: e.y }, { x: 0, y: 1 }, 'autoPlace finds (0,1) after row 0 is full');
}

console.log('\n[grid] remove + free cells');
{
  const g = new GridContainer(4, 4);
  const item = { w: 2, h: 2 };
  const entry = g.place(item, 1, 1);
  eq(g.freeCells(), 12, 'freeCells with 2x2 placed = 12');
  const removed = g.remove(entry);
  ok(removed === item, 'remove returns the original item');
  eq(g.freeCells(), 16, 'freeCells after remove = 16 (all free)');
  // remove() accepts item reference too
  g.place(item, 0, 0);
  const removedByItem = g.remove(item);
  ok(removedByItem === item, 'remove(item) works');
  ok(g.isEmpty(), 'grid empty after all removals');
}

console.log('\n[grid] move');
{
  const g = new GridContainer(6, 4);
  const a = g.place({ id: 'a', w: 2, h: 1 }, 0, 0);
  const b = g.place({ id: 'b', w: 3, h: 1 }, 0, 1);
  ok(g.move(a, 3, 0),    'move a to (3,0) succeeds');
  ok(!g.move(b, 4, 1),   'move b onto edge fails (out of bounds)');
  ok( g.move(b, 3, 1),   'move b to (3,1) succeeds');
  ok(!g.move(b, 3, 0),   'move b onto a fails (collision)');
}

console.log('\n[grid] rotate in-place');
{
  const g = new GridContainer(4, 4);
  const e = g.place({ w: 1, h: 3 }, 0, 0);
  const rotatedOk = g.rotate(e);
  ok(rotatedOk, 'rotate succeeds when rotated dims still fit');
  eq([e.w, e.h], [3, 1], 'entry dims swapped after rotate');
  // Now try rotating when blocked.
  const other = g.place({ w: 1, h: 1 }, 0, 1);
  const rotBack = g.rotate(e);   // would need (0,0)–(0,2), other at (0,1)
  ok(!rotBack, 'rotate blocked by neighbour fails');
}

console.log('\n[grid] resize expand + shrink');
{
  const g = new GridContainer(3, 3);
  g.place({ id: 'x', w: 2, h: 2 }, 0, 0);
  const lost1 = g.resize(4, 4);
  eq(lost1, [], 'expand to 4x4 loses nothing');
  ok(g.w === 4 && g.h === 4, 'dimensions updated');
  // Shrink so the 2x2 no longer fits.
  const lost2 = g.resize(1, 1);
  ok(lost2.length === 1 && lost2[0].id === 'x', 'shrink evicts the item');
  ok(g.isEmpty(), 'grid is empty after eviction');
}

console.log('\n[grid] itemFootprint defaults');
{
  eq(itemFootprint({ type: 'consumable' }),              [1, 1], 'consumable → 1x1');
  eq(itemFootprint({ type: 'ranged', class: 'pistol' }), [2, 1], 'pistol → 2x1');
  eq(itemFootprint({ type: 'ranged', class: 'rifle' }),  [4, 1], 'rifle → 4x1');
  eq(itemFootprint({ type: 'armor', slot: 'chest' }),    [2, 3], 'chest armor → 2x3');
  eq(itemFootprint({ type: 'armor', slot: 'head' }),     [2, 2], 'head armor → 2x2');
  eq(itemFootprint({ type: 'armor', slot: 'face' }),     [1, 1], 'face → 1x1');
  eq(itemFootprint({ type: 'junk', w: 1, h: 1 }),        [1, 1], 'junk → 1x1');
  eq(itemFootprint({ type: 'gear', slot: 'belt', w: 3, h: 2 }), [3, 2], 'explicit w/h wins over slot default');
}

console.log('\n[grid] stampItemDims');
{
  const it = { type: 'ranged', class: 'shotgun' };
  stampItemDims(it);
  eq([it.w, it.h], [4, 1], 'shotgun stamped 4x1');
  // Does not overwrite existing dims.
  const it2 = { type: 'ranged', class: 'shotgun', w: 5, h: 2 };
  stampItemDims(it2);
  eq([it2.w, it2.h], [5, 2], 'explicit dims preserved');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
