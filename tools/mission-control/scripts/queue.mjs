#!/usr/bin/env node
//
// CLI helper to push a task straight into the Mission Control queue
// without going through Discord. Sage / Wrenchy's pollers pick it up
// the same way they pick up slash-command tasks.
//
// Useful when you (the user) and Claude are mid-conversation in the
// CLI and want to "just queue it" — Claude shells out here instead
// of asking the user to switch to Discord and type a slash command.
//
// Usage:
//   node scripts/queue.mjs --slug=audit-foo --owner=sage \
//     --prompt="..." --files=src/level.js,src/main.js
//
//   node scripts/queue.mjs --slug=refactor-x --owner=wrenchy \
//     --prompt-file=path/to/prompt.md --files=src/foo.js
//
// Flags:
//   --slug=<slug>          required — task identifier (audits/<slug>.md)
//   --owner=<owner>        required — sage|wrenchy|claudie (or any persona)
//   --prompt="..."         required if --prompt-file not set — task prompt
//   --prompt-file=<path>   alternative to --prompt
//   --files=a.js,b.js      optional — comma-separated file scope
//   --project=<name>       optional — defaults to current_project from db
//   --reason="..."         optional — route_reason annotation
//   --title="..."          optional — defaults to slug

import 'dotenv/config';
import fs from 'node:fs';
import { migrate } from '../src/db.mjs';
import { enqueue } from '../src/queue.mjs';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

function fail(msg) {
  console.error(`[queue] ${msg}`);
  process.exit(2);
}

const slug = args.slug;
const owner = args.owner;
let prompt = args.prompt;
if (!prompt && args['prompt-file']) {
  if (!fs.existsSync(args['prompt-file'])) {
    fail(`prompt-file not found: ${args['prompt-file']}`);
  }
  prompt = fs.readFileSync(args['prompt-file'], 'utf8');
}

if (!slug)   fail('Missing --slug=<slug>');
if (!owner)  fail('Missing --owner=<sage|wrenchy|claudie>');
if (!prompt) fail('Missing --prompt="..." or --prompt-file=<path>');

const KNOWN_OWNERS = new Set(['sage', 'wrenchy', 'claudie']);
if (!KNOWN_OWNERS.has(owner)) {
  console.warn(`[queue] WARNING: owner=${owner} is not a known worker (sage|wrenchy|claudie). Task will sit in the queue until something polls for it.`);
}

const files = args.files
  ? String(args.files).split(',').map(s => s.trim()).filter(Boolean)
  : [];

migrate();
const id = enqueue({
  slug,
  title: args.title || slug,
  prompt,
  files,
  project: args.project,                    // null → defaults to whatever's in db
  owner,
  routeReason: args.reason || 'queued via scripts/queue.mjs',
});
console.log(`[queue] enqueued #${id} ${slug} → ${owner} (files: ${files.length || 'none'})`);
process.exit(0);
