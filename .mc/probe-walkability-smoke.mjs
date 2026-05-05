// Phase M smoke harness — paste into the dev console while the game
// is running on the title screen / hideout / first level. Iterates 10
// canonical levels × 2 sub-seeds = 20 generations and asserts
// checkRealWalkability().ok is true for each.
//
// Usage (browser console):
//   import('http://localhost:5173/.mc/probe-walkability-smoke.mjs')
// or copy/paste the IIFE below.
//
// Levels probed: [1, 3, 5, 7, 10, 12, 15, 18, 22, 25].
// Sub-seeds:    [0xC0FFEE, 0xDEC0DE].
//
// Smoke target: 20/20 ok=true. Any unreachable rooms get logged with
// the seed + level + room id so the user can repro under a debugger.

(async () => {
  const LEVELS = [1, 3, 5, 7, 10, 12, 15, 18, 22, 25];
  const SEEDS = [0x00C0FFEE, 0x00DEC0DE];
  const results = [];
  let passes = 0, fails = 0, retried = 0, degraded = 0;

  // We need access to the level + the run-seed setter. The game
  // exposes window.__level and the _setRunSeed helper isn't on
  // window directly — we work around by mutating window.__runSeed
  // (defined as a getter for _runSeed in main.js).
  const lvl = window.__level;
  if (!lvl) { console.error('[smoke] window.__level not available'); return; }

  for (const seed of SEEDS) {
    for (const lv of LEVELS) {
      // Force the level index to lv-1 so the next generate() bumps to lv.
      lvl.index = lv - 1;
      // Re-mix Math.random with this seed so the gen path is deterministic.
      const orig = Math.random;
      let s = seed >>> 0;
      Math.random = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      try {
        lvl.generate();
      } finally {
        Math.random = orig;
      }
      const r = lvl.checkRealWalkability();
      const tag = `seed=0x${seed.toString(16)} lv=${lv}`;
      if (r.ok) {
        passes++;
        console.log(`[smoke] PASS ${tag}  (${r.visitedCells}/${r.totalCells} cells)`);
      } else {
        fails++;
        console.error(`[smoke] FAIL ${tag} unreachable:`, r.unreachable);
      }
      results.push({ seed, lv, ok: r.ok, unreachable: r.unreachable, visitedCells: r.visitedCells });
    }
  }
  console.log(`[smoke] done. PASS=${passes} FAIL=${fails} (of ${results.length})`);
  window.__lastSmokeResults = results;
})();
