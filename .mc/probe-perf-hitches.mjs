// Perf-hitch probe — hooks the rAF loop, captures every frame's
// duration, tags hitches with the most recent "what was the engine
// doing" event, and cycles through multiple levels so we get a real
// playthrough-shaped data set instead of a single-room snapshot.
//
// Usage (console paste while the game is running on the title /
// hideout / first level):
//
//   await import('http://localhost:8080/.mc/probe-perf-hitches.mjs')
//
// The probe registers wrappers around suspect engine entry points
// (level.generate, enemy spawn, encounter setup, asset prewarm,
// room-transition handlers) so each frame's hitch can be attributed
// to the most recent operation that fired within ~16ms of the spike.
//
// Output: a single console.log with a hitch table + a JSON object
// pinned to window.__perfHitchReport for export.

(async () => {
  const lvl = window.__level;
  if (!lvl) { console.error('[perf] window.__level not available'); return; }

  // ---------- recorder ---------------------------------------------------
  const FRAMES_CAP = 60_000;        // ~16 minutes @ 60fps
  const frames = new Float32Array(FRAMES_CAP);
  const frameTags = new Array(FRAMES_CAP);
  let frameIdx = 0;
  let lastT = performance.now();
  let lastTag = 'idle';
  let lastTagAt = lastT;
  // Tag context: append a label that decays after 1 frame so a hitch
  // gets blamed on the most recent operation that fired during it.
  function tag(label) {
    lastTag = label;
    lastTagAt = performance.now();
  }
  // Call counters per tag so we can report frequency, not just "X
  // happened during a hitch".
  const tagCounts = Object.create(null);

  // ---------- wrap suspect entry points ----------------------------------
  // Each wrap creates a labelled tag so we can correlate hitches to
  // the operation that just fired.
  function wrap(target, key, label) {
    if (!target || typeof target[key] !== 'function') return false;
    const orig = target[key].bind(target);
    target[key] = function (...args) {
      tag(label);
      tagCounts[label] = (tagCounts[label] || 0) + 1;
      const t0 = performance.now();
      const r = orig(...args);
      const dt = performance.now() - t0;
      // Stamp blame even if call returned synchronously fast — the
      // first frame after a slow call still inherits the blame.
      if (dt > 4) tag(`${label} (${dt.toFixed(1)}ms self)`);
      return r;
    };
    return true;
  }

  // Level operations
  wrap(lvl, 'generate', 'level.generate');
  wrap(lvl, '_buildOuterPerimeter', 'level._buildOuterPerimeter');
  wrap(lvl, '_clearDoorCorridors', 'level._clearDoorCorridors');
  wrap(lvl, '_sealRoomPerimeters', 'level._sealRoomPerimeters');
  wrap(lvl, '_repairDoorOverlaps', 'level._repairDoorOverlaps');
  wrap(lvl, 'clear', 'level.clear');
  wrap(lvl, 'revealExit', 'level.revealExit');
  wrap(lvl, 'checkRealWalkability', 'level.checkRealWalkability');

  // Enemy spawning / asset paths
  if (window.__gunmen) {
    wrap(window.__gunmen, '_respawn', 'gunmen._respawn');
    wrap(window.__gunmen, 'spawn', 'gunmen.spawn');
    wrap(window.__gunmen, 'add', 'gunmen.add');
  }
  if (window.__melees) {
    wrap(window.__melees, 'spawn', 'melees.spawn');
    wrap(window.__melees, 'add', 'melees.add');
  }

  // ---------- long-task observer (browser-reported >50ms tasks) ----------
  let longTaskCount = 0;
  const longTasks = [];
  if (typeof PerformanceObserver === 'function') {
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTaskCount += 1;
          longTasks.push({ t: e.startTime, dur: e.duration, name: e.name });
        }
      });
      obs.observe({ type: 'longtask', buffered: true });
    } catch (_) { /* longtask not supported in this browser */ }
  }

  // ---------- frame-time loop --------------------------------------------
  let rafToken = null;
  function step(t) {
    const dt = t - lastT;
    lastT = t;
    if (frameIdx < FRAMES_CAP) {
      frames[frameIdx] = dt;
      // Inherit tag for THIS frame: whatever label fired in the last
      // ~32ms (so a slow generate() that ran inside the prior frame
      // still gets blamed for the spike).
      const since = performance.now() - lastTagAt;
      frameTags[frameIdx] = since < 32 ? lastTag : 'render';
      frameIdx += 1;
    }
    rafToken = requestAnimationFrame(step);
  }
  rafToken = requestAnimationFrame(step);

  // ---------- driver — cycle multiple levels -----------------------------
  // Generate 8 levels, dwelling 4s on each so the steady-state frame
  // cost can be sampled between gen events. After the cycle, dwell
  // an additional 6s so the post-gen GC + steady state are captured.
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const targetLevels = [1, 3, 5, 7, 10, 12, 15, 20];
  console.log('[perf] starting hitch probe — will cycle through',
    targetLevels.length, 'levels (~40s)');

  // Ensure we start from a clean state — force generate() so the
  // hitch from the first transition is captured.
  for (const lv of targetLevels) {
    lvl.index = lv - 1;
    tag(`pre-gen lv=${lv}`);
    try { lvl.generate(); }
    catch (e) { console.warn('[perf] gen failed lv=' + lv, e); continue; }
    await wait(4000);
  }
  await wait(6000);

  // ---------- analysis ---------------------------------------------------
  cancelAnimationFrame(rafToken);
  const N = frameIdx;
  if (N < 60) {
    console.warn('[perf] not enough frames captured:', N);
    return;
  }
  let sum = 0, max = 0, p99i = 0, p95i = 0;
  const HITCH_LIGHT = 33.3;     // missed 30fps frame
  const HITCH_BAD = 100;        // visible stutter
  let lightCount = 0, badCount = 0;
  const hitches = [];           // [{idx, dt, tag}]
  for (let i = 0; i < N; i++) {
    const dt = frames[i];
    sum += dt;
    if (dt > max) max = dt;
    if (dt > HITCH_LIGHT) {
      lightCount += 1;
      if (dt > HITCH_BAD) badCount += 1;
      hitches.push({ idx: i, dt, tag: frameTags[i] || 'render' });
    }
  }
  // Distribution percentiles via simple sort of a copy.
  const sorted = Float32Array.from(frames.slice(0, N));
  sorted.sort();
  const p = (q) => sorted[Math.floor((N - 1) * q)];
  const avg = sum / N;
  const p50 = p(0.50), p95 = p(0.95), p99 = p(0.99);

  // Group hitches by tag.
  const byTag = Object.create(null);
  for (const h of hitches) {
    const k = h.tag;
    if (!byTag[k]) byTag[k] = { count: 0, totalDt: 0, max: 0 };
    byTag[k].count += 1;
    byTag[k].totalDt += h.dt;
    if (h.dt > byTag[k].max) byTag[k].max = h.dt;
  }
  const tagRows = Object.entries(byTag)
    .sort((a, b) => b[1].max - a[1].max);

  // ---------- report -----------------------------------------------------
  const report = {
    frames: N,
    durationS: sum / 1000,
    avgMs: avg,
    p50Ms: p50, p95Ms: p95, p99Ms: p99, maxMs: max,
    hitchCount: lightCount,
    badHitchCount: badCount,
    hitchPercent: ((lightCount / N) * 100),
    longTaskCount,
    longTasksTopN: longTasks
      .slice()
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 10)
      .map(t => ({ dur: t.dur.toFixed(1), name: t.name })),
    hitchesByTag: tagRows.map(([k, v]) => ({
      tag: k, count: v.count,
      avgMs: (v.totalDt / v.count).toFixed(1),
      maxMs: v.max.toFixed(1),
    })),
    worstHitches: hitches
      .sort((a, b) => b.dt - a.dt)
      .slice(0, 12)
      .map(h => ({ frame: h.idx, dtMs: h.dt.toFixed(1), tag: h.tag })),
    tagCallCounts: tagCounts,
  };

  window.__perfHitchReport = report;
  console.log('[perf] DONE — report on window.__perfHitchReport');
  console.log(JSON.stringify(report, null, 2));
})();
