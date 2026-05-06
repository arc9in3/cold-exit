#!/usr/bin/env node
// tools/deploy.mjs — wrapper around `wrangler pages deploy` that honors
// `.assetsignore`.
//
// Why this exists: wrangler 4.x's `pages deploy` does NOT read the
// `.assetsignore` file (that's a Workers Static Assets feature). So a
// raw `wrangler pages deploy .` from the repo root scans the local
// `profiling/` traces (4+ GiB of Chrome DevTools traces, individual
// files >25 MiB) and fails with the Pages 25 MiB-per-file cap.
//
// Strategy: read `.assetsignore`, MOVE each top-level entry it lists
// out of the repo into an OS-temp holding directory so wrangler can't
// see them at all (wrangler walks the repo tree top-down regardless
// of names — renaming in place doesn't help, the files still get
// scanned). Move them back in a `finally` so even a Ctrl-C can't
// leave the tree fragmented. Pure rename across the same volume is
// O(1) per item; no GiB-of-files copy.
//
// Patterns with glob wildcards (`*.fbx`, `**/*.zip`) are NOT handled
// here — they're already covered by the explicit dir/file entries
// above them (`Assets/models/animations`, etc.). If a future file
// matches only a wildcard and exceeds 25 MiB, add an explicit entry
// to `.assetsignore` for it.
//
// Run with: node tools/deploy.mjs [--branch <name>] [extra wrangler args...]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(REPO);
// Holding area on the SAME volume as the repo if possible (so renames
// stay O(1)). Use a sibling dir alongside REPO. If that fails (e.g.
// permission), fall back to OS temp; cross-volume renames will copy.
const sibling = resolve(REPO, '..', `.cold-exit-deploy-hold-${process.pid}`);
let HOLD;
try { mkdirSync(sibling, { recursive: true }); HOLD = sibling; }
catch (_) { HOLD = mkdirSync(join(tmpdir(), `cold-exit-deploy-${process.pid}`), { recursive: true }) || join(tmpdir(), `cold-exit-deploy-${process.pid}`); }

const ignoreFile = resolve(REPO, '.assetsignore');
if (!existsSync(ignoreFile)) {
  console.error('[deploy] .assetsignore missing — bail.');
  process.exit(1);
}

const lines = readFileSync(ignoreFile, 'utf8').split(/\r?\n/);
const candidates = [];
for (const raw of lines) {
  const s = raw.trim();
  if (!s || s.startsWith('#')) continue;
  // Skip glob patterns — they're not single-file/dir entries we can rename.
  if (s.includes('*') || s.includes('?')) continue;
  // Strip leading `./` if present.
  const path = s.replace(/^\.\//, '');
  if (existsSync(resolve(REPO, path))) candidates.push(path);
}

const renamed = [];
const restore = () => {
  // Reverse so nested renames unwind cleanly.
  for (let i = renamed.length - 1; i >= 0; i--) {
    const { orig, hidden } = renamed[i];
    if (existsSync(hidden) && !existsSync(orig)) {
      try { renameSync(hidden, orig); }
      catch (e) { console.error(`[deploy] WARN failed to restore ${orig}:`, e.message); }
    }
  }
};

// Restore on every exit signal so an OS-level interrupt can't strand
// the tree. The signal handlers don't call process.exit themselves —
// Node's default behaviour after SIGINT does — they just run restore
// first.
const onSignal = () => { restore(); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
process.on('SIGHUP', onSignal);
process.on('uncaughtException', (err) => {
  console.error('[deploy] uncaught:', err);
  restore();
  process.exit(1);
});

try {
  for (const path of candidates) {
    const orig = resolve(REPO, path);
    const hidden = resolve(HOLD, basename(path) + '__' + Buffer.from(path).toString('hex').slice(0, 8));
    if (existsSync(hidden)) {
      console.warn(`[deploy] stale ${hidden} found; restoring before continuing`);
      try { renameSync(hidden, orig); } catch (_) {}
    }
    renameSync(orig, hidden);
    renamed.push({ orig, hidden });
  }
  console.log(`[deploy] moved ${renamed.length} entries to ${HOLD}`);

  const wranglerArgs = [
    'wrangler', 'pages', 'deploy', '.',
    '--project-name=cold-exit',
    '--commit-dirty=true',
    ...process.argv.slice(2),
  ];
  const result = spawnSync('npx', wranglerArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`[deploy] wrangler exited ${result.status}`);
    process.exitCode = result.status || 1;
  }
} finally {
  restore();
  console.log(`[deploy] restored ${renamed.length} entries`);
  // Clean up holding dir.
  try { rmSync(HOLD, { recursive: true, force: true }); } catch (_) {}
}
