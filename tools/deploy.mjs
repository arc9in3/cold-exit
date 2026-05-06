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
// Two pattern shapes are honored:
//   * explicit paths (`Assets/models/animations/gaspfix.zip`) — moved
//     directly via renameSync.
//   * simple-extension globs (`*.fbx`, `**/*.zip`) — expanded by
//     walking the repo tree and listing every matching file.
// Anything more exotic (character ranges, brace expansion) is NOT
// supported — kept simple to stay zero-dep. If a future ignore rule
// needs richer glob, switch to micromatch.
//
// Run with: node tools/deploy.mjs [--branch <name>] [extra wrangler args...]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, join, relative, sep } from 'node:path';
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

// Extension-glob expander. Handles `*.ext` (top-level only) and
// `**/*.ext` (recursive). Returns POSIX-style relative paths from
// REPO. Skips dirs that are already covered by an explicit entry
// (so we don't walk Assets/models/animations/FBX_Pistol_Starter_27A
// just to glob FBX files inside it — that whole tree is moved as
// one entry above).
const SKIP_WALK_DIRS = new Set(['.git', 'node_modules']);
function expandGlob(pat, alreadyMovedSet) {
  const out = [];
  // Rewrite both `*.ext` and `**/*.ext` to a single trailing-extension test.
  const m = pat.match(/^(?:\*\*\/)?\*\.([A-Za-z0-9]+)$/);
  if (!m) return out;     // not a shape we support
  const ext = '.' + m[1].toLowerCase();
  const recursive = pat.startsWith('**/');
  const walk = (dirAbs, dirRel) => {
    let entries;
    try { entries = readdirSync(dirAbs, { withFileTypes: true }); }
    catch (_) { return; }
    for (const ent of entries) {
      if (SKIP_WALK_DIRS.has(ent.name)) continue;
      const childAbs = join(dirAbs, ent.name);
      const childRel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
      // Skip anything already covered by an explicit/expanded
      // candidate — its parent will move it.
      if (alreadyMovedSet.has(childRel)) continue;
      let prefixCovered = false;
      for (const moved of alreadyMovedSet) {
        if (childRel.startsWith(moved + '/')) { prefixCovered = true; break; }
      }
      if (prefixCovered) continue;
      if (ent.isDirectory()) {
        if (recursive) walk(childAbs, childRel);
      } else if (ent.isFile()) {
        if (childRel.toLowerCase().endsWith(ext)) {
          // Top-level rule (`*.ext`, no `**/`) only matches at depth 0.
          if (!recursive && dirRel !== '') continue;
          out.push(childRel);
        }
      }
    }
  };
  walk(REPO, '');
  return out;
}

const lines = readFileSync(ignoreFile, 'utf8').split(/\r?\n/);
const candidates = [];
const candidateSet = new Set();      // prevent dupes between explicit + glob
const globPatterns = [];
for (const raw of lines) {
  const s = raw.trim();
  if (!s || s.startsWith('#')) continue;
  if (s.includes('*') || s.includes('?')) {
    globPatterns.push(s);
    continue;
  }
  const path = s.replace(/^\.\//, '');
  if (!existsSync(resolve(REPO, path))) continue;
  if (candidateSet.has(path)) continue;
  candidates.push(path);
  candidateSet.add(path);
}
// Expand globs AFTER explicit entries so the cover-by-parent skip in
// expandGlob can elide files inside an already-moved tree.
for (const pat of globPatterns) {
  for (const p of expandGlob(pat, candidateSet)) {
    if (candidateSet.has(p)) continue;
    candidates.push(p);
    candidateSet.add(p);
  }
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
