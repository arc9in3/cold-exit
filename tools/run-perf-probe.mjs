#!/usr/bin/env node
// Run the perf-hitch probe via Playwright. Loads the game, pastes the
// probe, waits for the report, dumps it to stdout.
//
// Usage:
//   node tools/run-perf-probe.mjs              # headed (default)
//   PROBE_HEADED=0 node tools/run-perf-probe.mjs   # headless (CI only)
//   PROBE_BASE=https://cold-exit.pages.dev node tools/run-perf-probe.mjs
//
// Env flags:
//   PROBE_HEADED=1 (default) — opens a visible Chromium window using
//     the real GPU. Frame times are representative; the 33ms hitch
//     threshold is meaningful.
//
//   PROBE_HEADED=0 — runs headless. Chromium falls back to SwiftShader
//     (CPU software WebGL). For a Three.js scene with shadows + postfx
//     + instanced meshes that pushes baseline frame time from ~10ms to
//     ~100-300ms — the probe's HITCH_LIGHT=33ms threshold becomes
//     meaningless in this mode (every frame "hitches" for reasons
//     unrelated to the game's JS work) and tag attribution breaks
//     (the 32ms window shorter than a single rendered frame). Only
//     useful for catching pathological regressions (e.g. >2s level-
//     gen spikes) where the noise floor doesn't matter.
//
//   PROBE_BASE=...   — dev server / deploy URL (default
//                       http://localhost:8080).
//
// Requires playwright installed (npm i -D playwright). The script
// will fail-soft with an install hint if it isn't.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASE = process.env.PROBE_BASE || 'http://localhost:8080';
const HEADED = process.env.PROBE_HEADED !== '0';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  console.error(
    '[probe] playwright not installed.\n'
    + '        Try: npm i -D playwright && npx playwright install chromium\n'
    + '        Or use the playwright-mcp browser already wired to your editor.',
  );
  process.exit(2);
}

console.log('[probe] launching chromium (headed=' + HEADED + ')');
const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    '--enable-precise-memory-info',
    '--disable-extensions',
    // Real GPU rasterization + compositing when headed. These flags
    // are no-ops in headless mode (Chromium still uses SwiftShader)
    // but kept so a future PROBE_HEADED=0 + Vulkan path inherits them.
    ...(HEADED ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : []),
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
});
const page = await ctx.newPage();

const consoleLines = [];
page.on('console', (msg) => {
  const t = msg.text();
  consoleLines.push(t);
  if (t.startsWith('[perf]') || t.startsWith('{')) {
    process.stdout.write(t + '\n');
  }
});
page.on('pageerror', (err) => {
  console.error('[probe][pageerror]', err.message);
});

console.log('[probe] loading', BASE);
await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });

// Wait for game to be ready — window.__level + window.__gunmen are
// the late-init handles the probe needs.
await page.waitForFunction(
  () => !!window.__level && !!window.__gunmen,
  { timeout: 60_000 },
);
console.log('[probe] game booted, starting probe');

// Paste the probe script. Reading via fetch from the same origin so
// import paths inside the probe still resolve.
const result = await page.evaluate(async (probeUrl) => {
  try {
    await import(probeUrl);
    // Wait for the probe to finish — it pins window.__perfHitchReport.
    const start = performance.now();
    while (performance.now() - start < 90_000) {
      if (window.__perfHitchReport) return window.__perfHitchReport;
      await new Promise(r => setTimeout(r, 500));
    }
    return { error: 'probe did not finish within 90s' };
  } catch (e) {
    return { error: String(e) };
  }
}, `${BASE}/.mc/probe-perf-hitches.mjs`);

await browser.close();

if (result?.error) {
  console.error('[probe] failed:', result.error);
  process.exit(1);
}

const outPath = resolve(ROOT, '.mc', 'perf-hitch-report.json');
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(result, null, 2));
console.log('[probe] report written to', outPath);

// Also print a compact summary to stdout for the caller.
console.log('\n=== HITCH SUMMARY ===');
console.log(`frames: ${result.frames}  duration: ${result.durationS.toFixed(1)}s`);
console.log(`avg ${result.avgMs.toFixed(1)}ms  p50 ${result.p50Ms.toFixed(1)}ms  p95 ${result.p95Ms.toFixed(1)}ms  p99 ${result.p99Ms.toFixed(1)}ms  max ${result.maxMs.toFixed(1)}ms`);
console.log(`hitches >33ms: ${result.hitchCount}  >100ms: ${result.badHitchCount}  long-tasks: ${result.longTaskCount}`);
console.log('\n--- HITCHES BY TAG ---');
for (const r of result.hitchesByTag) {
  console.log(`  ${r.tag.padEnd(50)} count=${String(r.count).padStart(3)} max=${r.maxMs}ms avg=${r.avgMs}ms`);
}
console.log('\n--- WORST HITCHES ---');
for (const h of result.worstHitches) {
  console.log(`  frame=${String(h.frame).padStart(6)} dt=${h.dtMs.padStart(7)}ms  tag=${h.tag}`);
}
