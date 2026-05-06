#!/usr/bin/env node
// Run the perf-hitch probe headlessly via Playwright. Spawns a hidden
// Chromium, loads the game, pastes the probe, waits for the report,
// dumps it to stdout. Intended for the "find me real hitches" workflow
// without making the user open another visible browser window.
//
// Usage:
//   node tools/run-perf-probe.mjs
//
// Requires the dev server running on http://localhost:8080.
// Requires playwright installed (npm i -D playwright). The script
// will fail-soft with an install hint if it isn't.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASE = process.env.PROBE_BASE || 'http://localhost:8080';

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

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-precise-memory-info', '--disable-extensions'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  // Headless Chromium uses SwiftShader (CPU-rendered WebGL) by default.
  // That's slower than real GPU, but the script-side hitches we're
  // hunting (level gen, allocations, GC pauses) still surface clearly.
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
