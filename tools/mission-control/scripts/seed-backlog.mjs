#!/usr/bin/env node
//
// One-time seed of the task queue with everything we've decided to
// build. After this runs, /status in Discord will show real work.
// Idempotent on slug — if a task with the same slug already exists in
// 'pending' or 'in_progress' state, it's skipped.
//
// Three tiers seeded:
//
//   IMMEDIATE — Cold Exit follow-ups + Phase 1-NEWS / DASH / community.
//               These are the first things you should fire-and-review.
//   AUDITS    — Sage / Wrenchy fodder for ongoing code quality.
//   SOON      — Bigger Mission-Control buildouts (bug intake, smoke
//               test, MCP bridge) — too large for one task each but
//               seeded as roadmap pointers.
//
// Usage:
//   node scripts/seed-backlog.mjs

import 'dotenv/config';
import { db, migrate } from '../src/db.mjs';
import { enqueue } from '../src/queue.mjs';

migrate();

const SEEDS = [
  // ───── Cold Exit code work ─────────────────────────────────────────
  { slug: 'audit-encounter-collider-cleanup',
    owner: 'sage',
    title: 'Verify every encounter collider is cleaned on resolution',
    prompt: 'Walk every spawn() in src/encounters.js. For each addEncounterCollider call, confirm there is matching teardown when the NPC visually disappears (state.complete=true + npc.visible=false OR alive=false). The tickEncounters generic sweep in main.js should cover most; flag any that bypass it. Cite file:line for every finding.',
    files: ['src/encounters.js', 'src/main.js'] },

  { slug: 'audit-shop-npc-colliders',
    owner: 'sage',
    title: 'Verify every shop NPC registers a collider',
    prompt: 'Check that merchant / healer / gunsmith / armorer / tailor / relicSeller / blackMarket / bearMerchant all register colliders via level.addEncounterCollider. The kiosk + bear cases were fixed; verify each shop type by walking _spawnNPC and _spawnBearMerchant in src/level.js. Flag any kind that lacks a collider.',
    files: ['src/level.js'] },

  { slug: 'audit-recompute-stats-fires',
    owner: 'sage',
    title: 'Audit every code path that mutates equipment to confirm recomputeStats fires after',
    prompt: 'Whenever an equipped item is mutated in place (durability tick, shop reroll, encounter mend, mastercraft promotion), recomputeStats() must fire so derivedStats picks up the new affix/perk values. Walk every callsite that mutates inventory state and confirm a recomputeStats call follows. Cite file:line.',
    files: ['src/main.js', 'src/inventory.js'] },

  // ───── Cold Exit ambience polish (encounters audit follow-up) ─────
  { slug: 'refactor-add-ambience-helper',
    owner: 'wrenchy',
    title: 'Verify _placeAmbience helper is documented and reusable',
    prompt: 'Confirm _placeAmbience(scene, ctx, disc, kind, ox, oz, yaw) in src/encounters.js handles every prop kind we currently expose (planter, vase, lamp, crate, barrel, locker, etc.). If any are missing, suggest the patches. Pure read-and-report task — output as patches, not edits.',
    files: ['src/encounters.js', 'src/props.js'] },

  // ───── Mission Control next-up ────────────────────────────────────
  // These don't go through Sage/Wrenchy — Claudie owns them. We seed
  // them as 'claudie' tasks so /status shows them as queued, but the
  // actual work happens in the user's interactive Claude Code session.
  { slug: 'mc-phase1-news',
    owner: 'claudie',
    title: 'Phase 1-NEWS — turn on Newsie / Thinkie / Sortie morning loop',
    prompt: 'Wire src/workers/newsie.mjs (using the existing source scrapers under src/sources/), src/workers/thinkie.mjs, and src/workers/sortie.mjs. Add cron schedule (Newsie 7am, Sortie nightly digest 11pm). Reaction handlers for ✅/❌/📅 on idea posts. See BUILDLOG Phase 1-NEWS section.',
    files: ['tools/mission-control/BUILDLOG.md'] },

  { slug: 'mc-phase1-dash',
    owner: 'claudie',
    title: 'Phase 1-DASH — localhost:3000 mission control dashboard',
    prompt: 'Build the live dashboard at localhost:3000/mission-control. Cards per visible bot (Claudie centerpiece, Newsie/Thinkie/Sortie below). Recent tasks feed. Project switcher. Read from SQLite, no LLM call needed for the basic view.',
    files: ['tools/mission-control/BUILDLOG.md'] },

  { slug: 'mc-bug-intake-channel',
    owner: 'claudie',
    title: 'Community bug-intake channel — schema + flow',
    prompt: 'Design and ship the #bugs channel flow per BUILDLOG north-star vision. New `bugs` table (title / repro / freq / severity / status / reporter_user_ids / linked_task_id / fix_commit). Bot parses templated reports, de-dupes against existing, increments freq counter on dupes. Routes confirmed bugs to Sage→Wrenchy chain.',
    files: ['tools/mission-control/BUILDLOG.md'] },

  { slug: 'mc-smoke-test-bot',
    owner: 'claudie',
    title: 'Smoke-test bot — Playwright runner that catches crashes pre-deploy',
    prompt: 'Build a Playwright headless-Chrome runner that loads cold-exit.pages.dev, executes scripted scenarios (basic loop, encounter-each, molotov-spam, regen-50-levels, perf sample), captures console + perf metrics, then has Sage read the captured logs and post bug reports / "all green" to Discord. See BUILDLOG smoke-test bot section.',
    files: ['tools/mission-control/BUILDLOG.md'] },

  { slug: 'mc-claude-code-bridge',
    owner: 'claudie',
    title: 'Discord ↔ Claude Code live bridge — MCP server',
    prompt: 'Build the MCP server (option D from BUILDLOG) that exposes read_discord_channel + post_discord_message as tools. Register it in Claude Code mcp.json so the interactive CLI session can mirror Discord conversations directly without a separate daemon.',
    files: ['tools/mission-control/BUILDLOG.md'] },
];

let inserted = 0;
let skipped = 0;
for (const seed of SEEDS) {
  const exists = db().prepare(`
    SELECT id FROM tasks WHERE slug = ? AND status IN ('pending','in_progress')
  `).get(seed.slug);
  if (exists) {
    console.log(`[seed] skip ${seed.slug} (already #${exists.id})`);
    skipped++;
    continue;
  }
  const id = enqueue({
    slug: seed.slug,
    title: seed.title,
    prompt: seed.prompt,
    files: seed.files || [],
    owner: seed.owner,
    routeReason: 'initial backlog seed',
  });
  console.log(`[seed] enqueued #${id} ${seed.slug} → ${seed.owner}`);
  inserted++;
}
console.log(`[seed] DONE — ${inserted} new tasks, ${skipped} skipped`);
db().close();
process.exit(0);
