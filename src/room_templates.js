// Room templates — composable recipes for furnishing a themed combat
// room. Each template names a small "scene" you'd recognise from the
// real world (a library reading nook, a warehouse pallet bay, a bedroom
// master suite, etc.) plus the prop list that builds it.
//
// Why this exists
//   The previous flow had a giant `if (theme === 'library') { ... }
//   else if (theme === 'lobby') { ... }` ladder hard-coded inside
//   level.js#_themeRoom. That made it expensive to add variants and
//   the result was thin: each theme had one scene, props were sparse
//   (1-3 items per room), and there was no "the same library on level
//   2 looks different than level 6" variety.
//
// How it's wired
//   level.js#_themeRoom calls `pickTemplateForRoom(room, theme)` which
//   filters this catalog by theme + minSize, then weighted-picks one.
//   `applyTemplate(level, room, template, helpers)` walks the template's
//   prop list and runs each step against the helpers passed in. The
//   helpers are the same closure functions level.js builds for the
//   inline pass — `placeAlongWall`, `placeBackToWall`, `placeInterior`,
//   `_placeAdjacent`, `_placeAcross`, `_placeAndLoot`. We accept them
//   as args rather than re-implementing because they own all the
//   bounds / corner / keep-out logic that the wall-gen pass relies on.
//
// Each template is a plain object — no class. Easier to read, easier
// to skim a screenful of templates and spot the differences.

// ---------------------------------------------------------------------
// Step kinds (the verbs available inside a template's `props` list)
// ---------------------------------------------------------------------
//
//   { kind, placer: 'wall',         count?, chance?, lootable? }
//      Place 1+ copies via placeAlongWall (or placeBackToWall when
//      `back: true`). count can be { min, max } or a number. chance
//      gates the whole step.
//
//   { kind, placer: 'interior',     count?, chance?, lootable? }
//      Place via placeInterior — random spot facing the centre.
//
//   { kind, placer: 'adjacent',     anchor, side?, facing?, gap?,
//                                   chance?, lootable?, name? }
//      Place adjacent to a previously-placed prop (looked up via the
//      step's `name` field). `name` lets later steps in the same
//      template reference the prop placed by an earlier step.
//
//   { kind, placer: 'across',       anchor, minDist?, maxDist?, chance? }
//      Place across the room from a previously-placed prop (uses
//      _placeAcross — projects along the anchor's local +Z).
//
// Anchor lookup: each step that places successfully stashes the
// returned prop ref under `state[step.name || step.kind]`. Subsequent
// steps reference by string. If the anchor lookup fails (the named
// step never placed because the room was too cramped), the dependent
// step is silently skipped.

// ---------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------

export const ROOM_TEMPLATES = [
  // ============= LIBRARY =============================================
  {
    id: 'library-reading-nook',
    themes: ['library'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      // Bookshelves line a wall — at least 2, sometimes a row of 4.
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 2, max: 4 }, lootable: true },
      // Reading desk in the centre.
      { kind: 'desk', placer: 'interior', name: 'desk', lootable: true },
      // Chair tucked against the back side of the desk (where someone sits).
      { kind: 'chair', placer: 'adjacent', anchor: 'desk',
        side: 'back', facing: 'inward' },
      // Optional small cabinet off another wall.
      { kind: 'cabinet', placer: 'wall', chance: 0.55, lootable: true },
    ],
  },
  {
    id: 'library-stacks',
    themes: ['library'],
    weight: 0.8,
    minSize: { w: 14, d: 12 },
    props: [
      // Rows of bookshelves — high count for the "stacks" feel.
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 3, max: 5 }, lootable: true },
      // A study chair — solo reader.
      { kind: 'chair', placer: 'interior', chance: 0.7 },
      // Rolling cart, represented by a crate so it reads as supply.
      { kind: 'crate', placer: 'interior', chance: 0.4, lootable: true },
    ],
  },
  {
    id: 'library-study',
    themes: ['library'],
    weight: 0.7,
    minSize: { w: 12, d: 12 },
    props: [
      // Two desks side by side for a study hall vibe.
      { kind: 'desk', placer: 'wall', name: 'deskA', lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'deskA',
        side: 'front', facing: 'inward' },
      { kind: 'desk', placer: 'wall', name: 'deskB',
        chance: 0.7, lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'deskB',
        side: 'front', facing: 'inward' },
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 1, max: 2 }, lootable: true },
    ],
  },

  // ============= LOBBY ===============================================
  {
    id: 'lobby-reception',
    themes: ['lobby'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      // Couch on a wall.
      { kind: 'couch', placer: 'wall', name: 'couch' },
      // Coffee table in front of the couch.
      { kind: 'coffeeTable', placer: 'adjacent', anchor: 'couch',
        side: 'front', facing: 'match', gap: 0.30, name: 'ct' },
      // Side chair across from the coffee table — completes the
      // conversation triangle.
      { kind: 'chair', placer: 'adjacent', anchor: 'ct',
        side: 'front', facing: 'inward', chance: 0.65 },
      // Reception desk on a different wall.
      { kind: 'desk', placer: 'wall', chance: 0.5, lootable: true },
      // Planters by the front door — visual handled by the door-flank
      // pass downstream; here we add a corner planter as backup.
      { kind: 'planter', placer: 'wall', chance: 0.45 },
    ],
  },
  {
    id: 'lobby-waiting-area',
    themes: ['lobby'],
    weight: 0.85,
    minSize: { w: 14, d: 12 },
    props: [
      // Two couches lining adjacent walls.
      { kind: 'couch', placer: 'wall', name: 'couchA' },
      { kind: 'couch', placer: 'wall', name: 'couchB', chance: 0.85 },
      // Coffee table in front of couchA.
      { kind: 'coffeeTable', placer: 'adjacent', anchor: 'couchA',
        side: 'front', facing: 'match', gap: 0.30 },
      // A desk/kiosk somewhere on the perimeter.
      { kind: 'desk', placer: 'wall', chance: 0.4, lootable: true },
      // Vending machine for ambience — reads as a corporate/transit
      // waiting area.
      { kind: 'vendingMachine', placer: 'wall', back: true, chance: 0.55 },
    ],
  },
  {
    id: 'lobby-vending',
    themes: ['lobby'],
    weight: 0.55,
    minSize: { w: 12, d: 12 },
    props: [
      // Two-three vending machines side by side reads as a transit /
      // hospital / office break-area lobby.
      { kind: 'vendingMachine', placer: 'wall', back: true,
        count: { min: 2, max: 3 } },
      { kind: 'bench', placer: 'wall', chance: 0.85 },
      { kind: 'planter', placer: 'wall', chance: 0.5 },
    ],
  },

  // ============= BEDROOM =============================================
  {
    id: 'bedroom-master',
    themes: ['bedroom'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      // Bed against a wall.
      { kind: 'bed', placer: 'wall', name: 'bed' },
      // Nightstand on the right (head end).
      { kind: 'nightstand', placer: 'adjacent', anchor: 'bed',
        side: 'right', facing: 'match', gap: 0.05, lootable: true },
      // Second nightstand on the left, sometimes.
      { kind: 'nightstand', placer: 'adjacent', anchor: 'bed',
        side: 'left', facing: 'match', gap: 0.05,
        chance: 0.55, lootable: true },
      // Dresser/cabinet across the room.
      { kind: 'cabinet', placer: 'wall', chance: 0.65, lootable: true },
      // A chair in the corner of the bedroom — reading nook.
      { kind: 'chair', placer: 'wall', chance: 0.45 },
    ],
  },
  {
    id: 'bedroom-bunk',
    themes: ['bedroom'],
    weight: 0.7,
    minSize: { w: 12, d: 12 },
    props: [
      // Two beds on opposite walls.
      { kind: 'bed', placer: 'wall', name: 'bedA' },
      { kind: 'bed', placer: 'wall', name: 'bedB' },
      // A locker per bunk — barracks vibe. Lootable.
      { kind: 'locker', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      // Nightstand between/beside bedA.
      { kind: 'nightstand', placer: 'adjacent', anchor: 'bedA',
        side: 'right', facing: 'match', gap: 0.05,
        chance: 0.7, lootable: true },
    ],
  },
  {
    id: 'bedroom-guest',
    themes: ['bedroom'],
    weight: 0.6,
    minSize: { w: 11, d: 11 },
    props: [
      { kind: 'bed', placer: 'wall', name: 'bed' },
      { kind: 'nightstand', placer: 'adjacent', anchor: 'bed',
        side: 'right', facing: 'match', gap: 0.05,
        chance: 0.85, lootable: true },
      { kind: 'desk', placer: 'wall', name: 'desk',
        chance: 0.7, lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'desk',
        side: 'front', facing: 'inward' },
    ],
  },

  // ============= LIVING ROOM =========================================
  {
    id: 'livingRoom-tv-lounge',
    themes: ['livingRoom'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      // Couch against a wall.
      { kind: 'couch', placer: 'wall', name: 'couch' },
      // Coffee table directly in front of couch.
      { kind: 'coffeeTable', placer: 'adjacent', anchor: 'couch',
        side: 'front', facing: 'match', gap: 0.40, name: 'ct' },
      // TV across from couch — anchored projection so it lands in
      // the cushions' sightline, not on a random wall.
      { kind: 'tv', placer: 'across', anchor: 'couch',
        minDist: 3.0, maxDist: 5.5 },
      // Side chair near the couch.
      { kind: 'chair', placer: 'wall', chance: 0.55 },
    ],
  },
  {
    id: 'livingRoom-parlor',
    themes: ['livingRoom'],
    weight: 0.7,
    minSize: { w: 11, d: 11 },
    props: [
      // Two chairs facing each other — old-school parlor.
      { kind: 'chair', placer: 'wall', name: 'chairA' },
      { kind: 'coffeeTable', placer: 'adjacent', anchor: 'chairA',
        side: 'front', facing: 'match', gap: 0.30, name: 'ct' },
      { kind: 'chair', placer: 'adjacent', anchor: 'ct',
        side: 'front', facing: 'inward' },
      // Bookshelf to the side.
      { kind: 'bookshelf', placer: 'wall', back: true,
        chance: 0.5, lootable: true },
    ],
  },
  {
    id: 'livingRoom-dining-living',
    themes: ['livingRoom'],
    weight: 0.7,
    minSize: { w: 14, d: 12 },
    props: [
      // Table + chairs.
      { kind: 'table', placer: 'interior', name: 'table' },
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'front', facing: 'inward' },
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'back', facing: 'inward' },
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'left', facing: 'inward', chance: 0.7 },
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'right', facing: 'inward', chance: 0.7 },
      // Couch on a wall as the "living" half.
      { kind: 'couch', placer: 'wall', chance: 0.8 },
    ],
  },

  // ============= WAREHOUSE ===========================================
  {
    id: 'warehouse-crate-stack',
    themes: ['warehouse'],
    weight: 1.0,
    minSize: { w: 11, d: 11 },
    props: [
      // First crate against a wall — anchor for the stack.
      { kind: 'crate', placer: 'wall', name: 'c1', lootable: true },
      // Two more crates beside it. Hugging gap=0.05 reads as "stacked"
      // even though they're side-by-side.
      { kind: 'crate', placer: 'adjacent', anchor: 'c1',
        side: 'left', facing: 'match', gap: 0.05, lootable: true },
      { kind: 'crate', placer: 'adjacent', anchor: 'c1',
        side: 'right', facing: 'match', gap: 0.05,
        chance: 0.85, lootable: true },
      // A barrel beside the stack.
      { kind: 'barrel', placer: 'adjacent', anchor: 'c1',
        side: 'front', facing: 'match', gap: 0.10,
        chance: 0.65, lootable: true },
      // A pallet on the floor somewhere.
      { kind: 'pallet', placer: 'interior', chance: 0.5, lootable: true },
    ],
  },
  {
    id: 'warehouse-pallet-staging',
    themes: ['warehouse'],
    weight: 0.85,
    minSize: { w: 12, d: 12 },
    props: [
      // Three pallets in a row.
      { kind: 'pallet', placer: 'interior', name: 'palA', lootable: true },
      { kind: 'pallet', placer: 'adjacent', anchor: 'palA',
        side: 'right', facing: 'match', gap: 0.05, lootable: true },
      { kind: 'pallet', placer: 'adjacent', anchor: 'palA',
        side: 'left', facing: 'match', gap: 0.05,
        chance: 0.85, lootable: true },
      // A "forklift-shaped" crate beside them.
      { kind: 'crate', placer: 'wall', chance: 0.75, lootable: true },
      // A barrel.
      { kind: 'barrel', placer: 'wall', chance: 0.6, lootable: true },
    ],
  },
  {
    id: 'warehouse-shelving-rows',
    themes: ['warehouse'],
    weight: 0.7,
    minSize: { w: 13, d: 12 },
    props: [
      // Two cabinet rows like an aisle of shelving.
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      // Crates between them.
      { kind: 'crate', placer: 'interior', count: { min: 1, max: 2 },
        lootable: true },
      // Locker for spares.
      { kind: 'locker', placer: 'wall', chance: 0.7, lootable: true },
    ],
  },

  // ============= OFFICE ==============================================
  {
    id: 'office-workstation',
    themes: ['office'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      // Two workstations baseline (was: 1 + 55% chance for a 2nd).
      { kind: 'desk', placer: 'wall', name: 'deskA', lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'deskA',
        side: 'front', facing: 'inward' },
      { kind: 'desk', placer: 'wall', name: 'deskB', lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'deskB',
        side: 'front', facing: 'inward' },
      // Filing cabinet.
      { kind: 'cabinet', placer: 'wall', chance: 0.7, lootable: true },
      // Bookshelf for the binders.
      { kind: 'bookshelf', placer: 'wall', back: true,
        chance: 0.55, lootable: true },
    ],
  },
  {
    id: 'office-open-plan',
    themes: ['office'],
    weight: 0.85,
    minSize: { w: 14, d: 12 },
    props: [
      // 2-3 desks side by side, "bullpen" feel.
      { kind: 'desk', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      // One chair per desk — best-effort; chairs scatter against any
      // open wall slot if the adjacent placement fails.
      { kind: 'chair', placer: 'wall', count: { min: 2, max: 3 } },
      { kind: 'cabinet', placer: 'wall', chance: 0.6, lootable: true },
    ],
  },
  {
    id: 'office-executive',
    themes: ['office'],
    weight: 0.7,
    minSize: { w: 12, d: 12 },
    props: [
      // Big desk facing the door (interior placement, faces centre).
      { kind: 'desk', placer: 'interior', name: 'desk', lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'desk',
        side: 'back', facing: 'inward' },
      // Bookshelves behind the desk's wall.
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 2, max: 3 }, lootable: true },
      { kind: 'cabinet', placer: 'wall', chance: 0.5, lootable: true },
    ],
  },

  // ============= KITCHEN =============================================
  {
    id: 'kitchen-dining',
    themes: ['kitchen'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      // Central table.
      { kind: 'table', placer: 'interior', name: 'table' },
      // Up to 4 chairs around it (guaranteed when space allows).
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'front', facing: 'inward' },
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'back', facing: 'inward' },
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'left', facing: 'inward' },
      { kind: 'chair', placer: 'adjacent', anchor: 'table',
        side: 'right', facing: 'inward' },
      // Sideboard / cabinet against a wall.
      { kind: 'cabinet', placer: 'wall', chance: 0.8, lootable: true },
    ],
  },
  {
    id: 'kitchen-galley',
    themes: ['kitchen'],
    weight: 0.85,
    minSize: { w: 12, d: 11 },
    props: [
      // Two cabinet rows along walls.
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      // Central island (a low table).
      { kind: 'table', placer: 'interior', chance: 0.85 },
    ],
  },
  {
    id: 'kitchen-pantry',
    themes: ['kitchen'],
    weight: 0.6,
    minSize: { w: 11, d: 11 },
    props: [
      // Cabinets lining 3 walls.
      { kind: 'cabinet', placer: 'wall', count: { min: 3, max: 4 },
        lootable: true },
      // Crates on the floor — overflow stock.
      { kind: 'crate', placer: 'interior', count: { min: 1, max: 2 },
        chance: 0.85, lootable: true },
    ],
  },

  // ============= GARAGE / WORKSHOP ===================================
  // Bench = workbench, locker = toolbox cabinet, crate/barrel/pallet =
  // industrial supply. Reads as "a place that fixes things."
  {
    id: 'garage-workbench-row',
    themes: ['garage'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'bench', placer: 'wall', count: { min: 2, max: 3 } },
      { kind: 'locker', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'pallet', placer: 'interior', count: { min: 1, max: 2 },
        chance: 0.7 },
      { kind: 'barrel', placer: 'wall', chance: 0.6 },
    ],
  },
  {
    id: 'garage-repair-pit',
    themes: ['garage'],
    weight: 0.85,
    minSize: { w: 13, d: 12 },
    props: [
      // Central workbench, tools laid out, crates flanking.
      { kind: 'bench', placer: 'interior', name: 'pit' },
      { kind: 'crate', placer: 'adjacent', anchor: 'pit', side: 'left',
        lootable: true },
      { kind: 'crate', placer: 'adjacent', anchor: 'pit', side: 'right',
        lootable: true },
      { kind: 'locker', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      { kind: 'cabinet', placer: 'wall', chance: 0.6, lootable: true },
    ],
  },
  {
    id: 'garage-conveyor',
    themes: ['garage'],
    weight: 0.7,
    minSize: { w: 14, d: 12 },
    props: [
      // Long conveyor belt across the room — factory-line silhouette
      // pinned to a wall side. Lockers + a cabinet round out the
      // workstation.
      { kind: 'conveyorBelt', placer: 'interior', name: 'line',
        chance: 0.9 },
      { kind: 'pallet', placer: 'wall', count: { min: 1, max: 2 },
        chance: 0.85 },
      { kind: 'locker', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'crate', placer: 'wall', chance: 0.7, lootable: true },
    ],
  },

  // ============= GYM =================================================
  // Bench reads as weight bench; lockers = changing-room lockers.
  // Heavy on benches + lockers, light on everything else.
  {
    id: 'gym-locker-row',
    themes: ['gym'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'locker', placer: 'wall', count: { min: 3, max: 5 },
        lootable: true },
      { kind: 'bench', placer: 'interior', count: { min: 1, max: 2 } },
    ],
  },
  {
    id: 'gym-weight-floor',
    themes: ['gym'],
    weight: 0.85,
    minSize: { w: 13, d: 12 },
    props: [
      { kind: 'bench', placer: 'wall', count: { min: 2, max: 3 } },
      { kind: 'locker', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'rug', placer: 'interior', chance: 0.5 },
    ],
  },

  // ============= LAB / CLINIC ========================================
  // Desk = exam table, cabinet = supply cabinet, locker = med cabinet.
  // The neonStick is the cleanroom strip-light cue; cap one per template
  // so it doesn't read as a bar / nightclub.
  {
    id: 'lab-exam',
    themes: ['lab'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'desk', placer: 'interior', name: 'exam', lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'exam',
        side: 'right', facing: 'inward' },
      // Med cart sits by the exam table — hospital silhouette cue.
      { kind: 'medCart', placer: 'adjacent', anchor: 'exam',
        side: 'left', facing: 'inward', chance: 0.85 },
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      { kind: 'locker', placer: 'wall', chance: 0.7, lootable: true },
      { kind: 'neonStick', placer: 'wall', chance: 0.8 },
    ],
  },
  {
    id: 'lab-counter',
    themes: ['lab'],
    weight: 0.85,
    minSize: { w: 13, d: 11 },
    props: [
      // Long counter against a wall: table + chair pairs read as bench
      // stations. A server rack tucked against another wall reads as
      // the lab's data station.
      { kind: 'table', placer: 'wall', name: 'counter' },
      { kind: 'chair', placer: 'adjacent', anchor: 'counter',
        side: 'front', facing: 'inward' },
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      { kind: 'serverRack', placer: 'wall', back: true, chance: 0.7 },
      { kind: 'medCart', placer: 'wall', chance: 0.6 },
      { kind: 'neonStick', placer: 'wall', chance: 0.8 },
    ],
  },

  // ============= SERVER ROOM / IT CLOSET =============================
  // serverRack is the signature prop — black panels with LED rows
  // that read as IT gear at iso distance. Mix with cabinet
  // (networking shelf) + crateRow (cable trays) + neonStick
  // (overhead strip).
  {
    id: 'server-rack-rows',
    themes: ['server'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'serverRack', placer: 'wall', back: true,
        count: { min: 3, max: 5 } },
      { kind: 'cabinet', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'crateRow', placer: 'interior', chance: 0.6 },
      { kind: 'neonStick', placer: 'wall', chance: 0.85 },
    ],
  },
  {
    id: 'server-noc',
    themes: ['server'],
    weight: 0.85,
    minSize: { w: 13, d: 12 },
    props: [
      // Operator desk + monitor wall, racks lining one wall.
      { kind: 'desk', placer: 'wall', name: 'opsDesk', lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'opsDesk',
        side: 'front', facing: 'inward' },
      { kind: 'tv', placer: 'wall', count: { min: 1, max: 2 } },
      { kind: 'serverRack', placer: 'wall', back: true,
        count: { min: 2, max: 3 } },
      { kind: 'neonStick', placer: 'wall', chance: 0.8 },
    ],
  },

  // ============= ARCHIVE / RECORDS ===================================
  // Bookshelf = filing shelf; cabinet = filing cabinet; crate = box of
  // overflow records on the floor.
  {
    id: 'archive-rows',
    themes: ['archive'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 3, max: 5 }, lootable: true },
      { kind: 'cabinet', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'crate', placer: 'interior', count: { min: 1, max: 2 },
        chance: 0.7, lootable: true },
    ],
  },
  {
    id: 'archive-clerk',
    themes: ['archive'],
    weight: 0.85,
    minSize: { w: 12, d: 12 },
    props: [
      // Clerk station with a desk + chair, surrounded by filing.
      { kind: 'desk', placer: 'interior', name: 'clerkDesk',
        lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'clerkDesk',
        side: 'back', facing: 'inward' },
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 4 },
        lootable: true },
      { kind: 'bookshelf', placer: 'wall', back: true,
        chance: 0.7, lootable: true },
    ],
  },

  // ============= INFIRMARY / SICK BAY ================================
  // Bed = patient cot; medCart = wheeled hospital cart (signature
  // prop, the red-cross silhouette tells the player this is a
  // medical room at first glance); cabinet = med supply cabinet.
  {
    id: 'infirmary-bay',
    themes: ['infirmary'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'bed', placer: 'wall', count: { min: 2, max: 3 },
        name: 'cot' },
      { kind: 'medCart', placer: 'adjacent', anchor: 'cot',
        side: 'right', facing: 'match', chance: 0.9 },
      { kind: 'cabinet', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'locker', placer: 'wall', chance: 0.7, lootable: true },
    ],
  },
  {
    id: 'infirmary-exam',
    themes: ['infirmary'],
    weight: 0.85,
    minSize: { w: 12, d: 11 },
    props: [
      // One cot, doctor's desk, supply cabinets, a med cart parked
      // bedside.
      { kind: 'bed', placer: 'wall', name: 'cot' },
      { kind: 'medCart', placer: 'adjacent', anchor: 'cot',
        side: 'right', facing: 'match', chance: 0.85 },
      { kind: 'desk', placer: 'wall', name: 'docDesk', lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'docDesk',
        side: 'front', facing: 'inward' },
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
    ],
  },

  // ============= SECURITY / GUARD POST ===============================
  // Desk = guard desk, tv = CCTV monitor, locker = gun rack.
  {
    id: 'security-post',
    themes: ['security'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'desk', placer: 'wall', name: 'guardDesk',
        lootable: true },
      { kind: 'chair', placer: 'adjacent', anchor: 'guardDesk',
        side: 'front', facing: 'inward' },
      { kind: 'tv', placer: 'wall', count: { min: 2, max: 3 } },
      { kind: 'locker', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
    ],
  },
  {
    id: 'security-checkpoint',
    themes: ['security'],
    weight: 0.85,
    minSize: { w: 12, d: 11 },
    props: [
      // Counter + railing reads as a checkpoint stop.
      { kind: 'table', placer: 'wall', name: 'counter' },
      { kind: 'chair', placer: 'adjacent', anchor: 'counter',
        side: 'back', facing: 'inward' },
      { kind: 'tv', placer: 'wall', chance: 0.85 },
      { kind: 'locker', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'cabinet', placer: 'wall', chance: 0.6, lootable: true },
    ],
  },

  // ============= MAILROOM / SORTING ==================================
  // Locker = PO box wall, table = sorting bench, crate = mail bin.
  {
    id: 'mailroom-sort',
    themes: ['mailroom'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'table', placer: 'interior', name: 'sortTable' },
      { kind: 'locker', placer: 'wall', count: { min: 3, max: 5 },
        lootable: true },
      { kind: 'crate', placer: 'interior', count: { min: 1, max: 2 },
        chance: 0.85, lootable: true },
    ],
  },
  {
    id: 'mailroom-boxes',
    themes: ['mailroom'],
    weight: 0.8,
    minSize: { w: 12, d: 11 },
    props: [
      // Two locker rows + bench + cart (crate).
      { kind: 'locker', placer: 'wall', count: { min: 4, max: 6 },
        lootable: true },
      { kind: 'bench', placer: 'wall', chance: 0.85 },
      { kind: 'crate', placer: 'interior', chance: 0.7, lootable: true },
    ],
  },

  // ============= SHOP (vendor rooms) =================================
  // Shop rooms always have a vendor kiosk on a perimeter wall (added
  // by _spawnNPC AFTER theming). Templates here fill the rest of the
  // floor with stock displays + a browsing setup so the room reads as
  // a real storefront, not an empty box with a counter.
  //
  // Wall placements skip the kiosk's wall slot at runtime via the
  // existing placeAlongWall collision check (the kiosk's collider is
  // already in obstacles by the time these props place, so they
  // naturally avoid it).
  {
    id: 'shop-display-cases',
    themes: ['shop'],
    weight: 1.0,
    minSize: { w: 12, d: 12 },
    props: [
      // Glass display cases — the signature shop silhouette. Mix in
      // a few filing cabinets for variety + stock shelves behind.
      { kind: 'displayCase', placer: 'wall', back: true,
        count: { min: 2, max: 3 } },
      { kind: 'cabinet', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 1, max: 2 }, lootable: true },
      { kind: 'rug', placer: 'interior', chance: 0.5 },
      { kind: 'planter', placer: 'wall', chance: 0.6 },
    ],
  },
  {
    id: 'shop-stockroom',
    themes: ['shop'],
    weight: 0.85,
    minSize: { w: 12, d: 12 },
    props: [
      // Heavier on stock — pallets + crates + shelves. Reads as a
      // back-room style shop where you ask for what you want.
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 2, max: 3 }, lootable: true },
      { kind: 'crate', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'pallet', placer: 'interior', chance: 0.6 },
      { kind: 'cabinet', placer: 'wall', chance: 0.7, lootable: true },
    ],
  },
  {
    id: 'shop-haggle-lounge',
    themes: ['shop'],
    weight: 0.7,
    minSize: { w: 13, d: 12 },
    props: [
      // Customer seating + side table — feels like a haggling shop
      // (gunsmith / armorer back room).
      { kind: 'couch', placer: 'wall', name: 'haggleCouch',
        chance: 0.85 },
      { kind: 'coffeeTable', placer: 'adjacent', anchor: 'haggleCouch',
        side: 'front', facing: 'match', gap: 0.4 },
      { kind: 'cabinet', placer: 'wall', count: { min: 1, max: 2 },
        lootable: true },
      { kind: 'rug', placer: 'interior', chance: 0.6 },
    ],
  },

  // ============= VENDOR-SPECIFIC SHOP TEMPLATES =====================
  // The generic shop templates above run for every vendor room. The
  // templates below filter on `vendorTypes` so each vendor type
  // (gunsmith, healer, etc.) has at least one signature look that
  // tells the player at a glance what kind of shop it is.
  // pickTemplateForRoom honors `vendorTypes` when room.type matches
  // one of the listed vendor types.

  // -- Gunsmith --------------------------------------------------------
  // Vertical lockers reading as gun cabinets, a workbench front and
  // center, ammo crates flanking. Orange-iron palette via NPC_STYLE.
  {
    id: 'gunsmith-armory',
    themes: ['shop'],
    vendorTypes: ['gunsmith'],
    weight: 1.4,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'locker', placer: 'wall', back: true,
        count: { min: 3, max: 5 }, lootable: true },
      { kind: 'bench', placer: 'wall', name: 'workbench' },
      { kind: 'crate', placer: 'adjacent', anchor: 'workbench',
        side: 'left', lootable: true },
      { kind: 'crate', placer: 'adjacent', anchor: 'workbench',
        side: 'right', lootable: true, chance: 0.7 },
      { kind: 'cabinet', placer: 'wall', chance: 0.5, lootable: true },
    ],
  },

  // -- Healer / clinic --------------------------------------------------
  // Cots + medCart silhouette, supply cabinets. Reads as a triage room
  // even before you spot the green NPC.
  {
    id: 'healer-clinic',
    themes: ['shop'],
    vendorTypes: ['healer'],
    weight: 1.4,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'bed', placer: 'wall', count: { min: 1, max: 2 },
        name: 'cot' },
      { kind: 'medCart', placer: 'adjacent', anchor: 'cot',
        side: 'right', facing: 'match', chance: 0.95 },
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      { kind: 'locker', placer: 'wall', chance: 0.65, lootable: true },
      { kind: 'neonStick', placer: 'wall', chance: 0.85 },
    ],
  },

  // -- Armorer ---------------------------------------------------------
  // Armor "displays" rendered as tables with chairs (pose stands)
  // around them, plus display cabinets along the perimeter. Blue/grey
  // palette via NPC_STYLE.
  {
    id: 'armorer-fitting',
    themes: ['shop'],
    vendorTypes: ['armorer'],
    weight: 1.4,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'table', placer: 'interior', name: 'standA' },
      { kind: 'table', placer: 'interior', name: 'standB', chance: 0.85 },
      { kind: 'displayCase', placer: 'wall', back: true,
        count: { min: 1, max: 2 } },
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      { kind: 'locker', placer: 'wall', chance: 0.65, lootable: true },
    ],
  },

  // -- Tailor ---------------------------------------------------------
  // Bookshelves stand in for fabric-roll racks; central cutting table
  // surrounded by chairs. Pink palette via NPC_STYLE.
  {
    id: 'tailor-atelier',
    themes: ['shop'],
    vendorTypes: ['tailor'],
    weight: 1.4,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 2, max: 3 }, lootable: true },
      { kind: 'table', placer: 'interior', name: 'cutTable' },
      { kind: 'chair', placer: 'adjacent', anchor: 'cutTable',
        side: 'front', facing: 'inward' },
      { kind: 'chair', placer: 'adjacent', anchor: 'cutTable',
        side: 'back', facing: 'inward', chance: 0.7 },
      { kind: 'cabinet', placer: 'wall', chance: 0.55, lootable: true },
      { kind: 'rug', placer: 'interior', chance: 0.7 },
    ],
  },

  // -- Relic Seller ----------------------------------------------------
  // Museum-vibe — heavy on glass cases, planters, decorative stand-
  // alone vases. Gold accent via NPC_STYLE.
  {
    id: 'relic-gallery',
    themes: ['shop'],
    vendorTypes: ['relicSeller'],
    weight: 1.4,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'displayCase', placer: 'wall', back: true,
        count: { min: 3, max: 4 } },
      { kind: 'planter', placer: 'wall', count: { min: 1, max: 2 } },
      { kind: 'vase', placer: 'interior', chance: 0.85 },
      { kind: 'bookshelf', placer: 'wall', back: true,
        chance: 0.6, lootable: true },
      { kind: 'rug', placer: 'interior', chance: 0.65 },
    ],
  },

  // -- Black Market ----------------------------------------------------
  // Dark warehouse vibe — lockers, crates, pallets, neonStick UV
  // accents. Purple palette via NPC_STYLE.
  {
    id: 'blackmarket-stash',
    themes: ['shop'],
    vendorTypes: ['blackMarket'],
    weight: 1.4,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'locker', placer: 'wall', back: true,
        count: { min: 2, max: 4 }, lootable: true },
      { kind: 'crate', placer: 'wall', count: { min: 1, max: 3 },
        lootable: true },
      { kind: 'pallet', placer: 'interior', chance: 0.8 },
      { kind: 'barrel', placer: 'wall', chance: 0.55 },
      { kind: 'neonStick', placer: 'wall', count: { min: 1, max: 2 } },
    ],
  },

  // -- Merchant (general store) ----------------------------------------
  // Variety pack — display cases, stock shelves, a vending machine.
  // Reads as a corner-store / general-goods vendor.
  {
    id: 'merchant-general',
    themes: ['shop'],
    vendorTypes: ['merchant'],
    weight: 1.4,
    minSize: { w: 12, d: 12 },
    props: [
      { kind: 'displayCase', placer: 'wall', back: true, chance: 0.85 },
      { kind: 'cabinet', placer: 'wall', count: { min: 2, max: 3 },
        lootable: true },
      { kind: 'bookshelf', placer: 'wall', back: true,
        count: { min: 1, max: 2 }, lootable: true },
      { kind: 'vendingMachine', placer: 'wall', back: true,
        chance: 0.55 },
      { kind: 'crate', placer: 'wall', chance: 0.5, lootable: true },
    ],
  },
];

// ---------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------

// Pick a template that matches the room theme + size. Returns a chosen
// template or null if nothing fits. Weighted random over the eligible
// pool.
//
// NB: callers should fall back to the legacy inline arrangement if this
// returns null — happens only when the room is smaller than every
// template's minSize, which is rare for normal 18×18 rooms.
export function pickTemplateForRoom(room, theme) {
  if (!room || !theme) return null;
  const b = room.bounds;
  if (!b) return null;
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const eligible = ROOM_TEMPLATES.filter(t => {
    if (!t.themes.includes(theme)) return false;
    if (t.minSize) {
      if (w < t.minSize.w) return false;
      if (d < t.minSize.d) return false;
    }
    // vendorTypes filter — when present, the template only applies
    // to specific vendor room types (gunsmith, healer, etc.). When
    // absent, the template is generic and runs for any room of the
    // matching theme. Generic shop templates fall back here when
    // a vendor-specific template happens not to roll, so a 'tailor'
    // room can still pick 'shop-stockroom' instead of always rolling
    // 'tailor-atelier'.
    if (t.vendorTypes && !t.vendorTypes.includes(room.type)) return false;
    return true;
  });
  if (!eligible.length) return null;
  let total = 0;
  for (const t of eligible) total += (t.weight ?? 1.0);
  let r = Math.random() * total;
  for (const t of eligible) {
    r -= (t.weight ?? 1.0);
    if (r <= 0) return t;
  }
  return eligible[eligible.length - 1];
}

// ---------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------

// Resolve a count spec — number, { min, max }, or undefined → 1.
function _resolveCount(spec) {
  if (spec == null) return 1;
  if (typeof spec === 'number') return Math.max(0, spec | 0);
  const lo = spec.min ?? 1;
  const hi = spec.max ?? lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// Walk a template's prop list and run each step against the helpers.
// `helpers` must contain:
//   placeAlongWall(prop, opts?)
//   placeBackToWall(prop, opts?)
//   placeInterior(prop)
//   _placeAdjacent(anchor, kind, opts?) → prop or null
//   _placeAcross(anchor, kind, opts?)   → prop or null
//   _placeAndLoot(kind, placer)         → prop or null
//   buildProp(kind, opts?)              → { group, collision, kind } | null
//   _maybeLoot(prop)                    → marks the prop lootable per LOOT_PROP_CONFIG
//
// Returns a small report `{ placed }` with the count of props that
// landed — useful for the smoke harness density check.
export function applyTemplate(level, room, template, helpers) {
  if (!template || !room) return { placed: 0 };
  const {
    placeAlongWall, placeBackToWall, placeInterior,
    _placeAdjacent, _placeAcross, _placeAndLoot,
    buildProp, _maybeLoot,
  } = helpers;
  // Keyed by step.name (or step.kind for unnamed steps) — later
  // adjacent/across steps can reference an earlier prop by name.
  const state = {};
  let placed = 0;

  for (const step of template.props) {
    if (step.chance != null && Math.random() >= step.chance) continue;
    const count = _resolveCount(step.count);
    if (count <= 0) continue;

    for (let i = 0; i < count; i++) {
      let prop = null;

      if (step.placer === 'wall') {
        // Wall-hugging placement. `back: true` uses placeBackToWall so
        // a thin shelf's back is flush with the wall (no floating-mid-
        // room read).
        const placerFn = step.back ? placeBackToWall : placeAlongWall;
        if (step.lootable) {
          prop = _placeAndLoot(step.kind, placerFn);
        } else {
          const built = buildProp(step.kind);
          if (built && placerFn(built)) prop = built;
        }
      } else if (step.placer === 'interior') {
        if (step.lootable) {
          prop = _placeAndLoot(step.kind, placeInterior);
        } else {
          const built = buildProp(step.kind);
          if (built && placeInterior(built)) prop = built;
        }
      } else if (step.placer === 'adjacent') {
        const anchor = state[step.anchor];
        if (!anchor) continue;
        prop = _placeAdjacent(anchor, step.kind, {
          facing: step.facing,
          gap: step.gap,
          preferSide: step.side,
        });
        if (prop && step.lootable) _maybeLoot(prop);
      } else if (step.placer === 'across') {
        const anchor = state[step.anchor];
        if (!anchor) continue;
        prop = _placeAcross(anchor, step.kind, {
          minDist: step.minDist,
          maxDist: step.maxDist,
        });
        if (prop && step.lootable) _maybeLoot(prop);
      }

      if (prop) {
        placed++;
        // First successful copy of a step claims the step's name. Later
        // copies (count>1) don't override — they're meant to be siblings,
        // not replacements.
        const key = step.name || step.kind;
        if (!state[key]) state[key] = prop;
      }
    }
  }

  return { placed };
}
