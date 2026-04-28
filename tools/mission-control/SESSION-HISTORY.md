# Session History — Mission Control conception → Phase 1-DEV ship

A distilled record of the conversation that built Mission Control.
Read this in `#memory` to onboard any new collaborator (human or AI)
on what we decided and why. Companion file: `BUILDLOG.md` for the
authoritative live state.

Session date: 2026-04-28

---

## Where this came from

The user (Captain) had already built up a solid AI-assisted workflow
on Cold Exit (browser isometric extraction shooter, Three.js,
deployed to cold-exit.pages.dev). Existing tooling:

- Multi-AI scaffolding via PROJECT.md / CLAUDE.md / AGENTS.md /
  GEMINI.md — Claude / Codex / Gemini each have lanes, locks,
  branch conventions
- `tools/review-dashboard.mjs` — local Node web tool with branch
  review, AI summaries, tasks queue, deploy-preview, multi-select
  promotion, PowerShell-based CLI launcher
- `tools/local-ai.mjs` — task runner that pipes prompts + file scope
  to local Ollama models (qwen2.5-coder:32b for code, deepseek-r1:32b
  for audits) and writes results to `audits/<slug>.md`
- 5090 RTX desktop with Ollama installed, both 32B models pulled

The shift this session: from one-shot `tools/local-ai.mjs` runs to a
**persistent multi-agent workspace** with named bot personas, Discord
as the chat surface, automatic logging, and a queue.

## Why Discord

User wanted:

- Mission Control view — see what every bot is doing, what just
  finished, what's next
- A team of named "robots" with distinct jobs (PM, code, audit, news,
  ideation, librarian)
- Aggressive logging of EVERYTHING — tasks, thoughts, dreams, ideas,
  progress
- Project switching — same team should be able to pivot between Cold
  Exit and other projects
- Inter-agent communication — bots peer-review each other's work,
  hand off, escalate
- Final approvals stay with the user

Discord was chosen because: persistent, channel-based, mobile, good
bot API, free, avatars per persona via webhooks, slash commands as
control surface.

## Honest scope check we agreed on

User listed: bug fixing, perf, code review, refactors, asset
generation, news scanning, social media, outreach, biz dev, launching
micro-SaaS, daily approvals.

Realistic v1 handles ~30-40%. Honest split:

| Category | v1 ships |
|---|---|
| Code (bug, perf, refactor, audit) | ✅ |
| News + ideas | ✅ |
| Filing / memory | ✅ |
| Asset generation (image gen) | ⚠️ later |
| Social media posting | ❌ Phase 3+ |
| Outreach / biz dev / CRM | ❌ scope limit |
| "Launching SaaS" | ⚠️ I scaffold, you run the business |
| Daily approvals | ✅ |

## Cast — final v1 roster

| Bot | Role | Backed by | Visibility |
|---|---|---|---|
| 🧠 Claudie | Central brain — code, queue, orchestration | Sonnet (interactive via user's Claude Code session) + qwen2.5-coder:7b shell for routine acks | dashboard centerpiece |
| 📰 Newsie | Morning AI/tech scout | Sonnet (with local fallback) | card |
| 💡 Thinkie | Idea generator from Newsie's feed | Sonnet, capped to top-3 articles per morning | card |
| 📚 Sortie | Librarian, categorizer, daily/weekly digester | Sonnet (with local fallback) | card |
| 🔧 Wrenchy | Local code drafts | qwen2.5-coder:32b on Ollama | background, no card |
| 🔍 Sage | Local code audits | deepseek-r1:32b on Ollama | background, no card |
| ⚓ Captain (you) | Vision, final decisions | — | viewer |

Roster IS mutable. Add/remove via persona configs in
`src/personas.mjs` + matching channel in Discord + env var.

## Big design decisions

- **One bot process, multiple personas** via channel-bound webhooks.
  Not 4 separate Discord apps. Single `node src/bot.mjs`.
- **Local models for code-grunt work, Sonnet for personas that talk
  to the user.** Cost discipline. Newsie/Thinkie/Sortie can fall back
  to local qwen if `ANTHROPIC_API_KEY` isn't set.
- **Claudie option B** — daemon shell uses tiny local model for
  routine acks; real reasoning happens in user's Claude Code session
  and gets posted back. Cheap + honest. Avoids splitting context.
- **State in SQLite** at `tools/mission-control/data/mc.db`. Single
  file, no external DB.
- **Runs on user's gaming PC alongside Ollama.** No hosting. Bot is
  ~50MB RAM next to the GPU.
- **Bots never auto-spend, auto-commit, auto-post to social.** Always
  user ✅ first.
- **Memory is both** — daily recap AND long-term fact extraction.

## Phase plan + scope pivot

Original Phase 1 was big (foundations + Newsie + Thinkie + Sortie +
Claudie + Discord + dashboard). Mid-session the user asked to
**focus on dev bots for Cold Exit FIRST**. New order:

| Phase | What | Status |
|---|---|---|
| **1-DEV** | Wrenchy + Sage + Claudie + Discord queue | ✅ shipped this session |
| **1-NEWS** | Newsie + Thinkie + Sortie morning loop | ⬜ scaffolding ready, workers TBD |
| **1-DASH** | localhost:3000 Mission Control dashboard | ⬜ |
| **2-COMMUNITY** | #bugs intake → triage → auto-fix loop | ⬜ |
| **2-SMOKE** | Playwright smoke-test bot + Sage-as-bug-reporter | ⬜ |
| **2-BRIDGE** | MCP server: Discord ↔ Claude Code live | ⬜ |
| **3-ASSETS** | Image-gen pipeline (DALL-E / SDXL) | ⬜ |
| **4-ANIMATED** | Cartoon robot UI in dashboard | ⬜ |

## Phase 1-DEV — what shipped

A complete dev-bot loop. Loop:

```
You in Discord:  /audit slug:foo prompt:"..." files:src/x.js
       ↓
bot.mjs enqueues task in SQLite
       ↓
sage.mjs polls, runs deepseek-r1:32b via Ollama
       ↓
output → audits/foo.md
       ↓
Claudie posts back to #mission-control + originating channel
```

Files at `tools/mission-control/`:

- `BUILDLOG.md` — authoritative live state, read first when picking up
- `SETUP.md` — Discord app + bot creation walkthrough
- `README.md` — quick start
- `package.json` — discord.js, better-sqlite3, node-cron, rss-parser
- `.env.example` — env template
- `schema.sql` — full schema (tasks / articles / ideas / sources /
  watchlist / thoughts / memory / events)
- `src/db.mjs` — SQLite open + idempotent migrate
- `src/queue.mjs` — task DAO (enqueue / claimNext / markDone)
- `src/personas.mjs` — bot configs
- `src/util/ollama.mjs` — Ollama client with the explicit num_ctx
  lesson (silent truncation if you forget)
- `src/util/log.mjs` — pretty console
- `src/sources/{hackernews,reddit,rss,github}.mjs` — news scrapers
  (built but NOT loaded in 1-DEV; Phase 1-NEWS turns them on)
- `src/workers/local_runner.mjs` — shared file-pack + Ollama call +
  audits/<slug>.md write
- `src/workers/wrenchy.mjs` — qwen 32b coder loop
- `src/workers/sage.mjs` — deepseek-r1 32b audit loop
- `src/workers/claudie.mjs` — orchestrator + statusReport()
- `src/bot.mjs` — Discord login, slash commands, webhook personas

Slash commands live now:

- `/audit slug:... prompt:... files:...` → Sage
- `/refactor slug:... prompt:... files:...` → Wrenchy
- `/status` → Claudie posts queue + recent activity embed

## Setup wins this session

- Resolved confusion about Discord's "Add Bot" button being removed
  from the developer portal (everything's on the Bot tab now,
  auto-provisioned). Updated SETUP.md.
- Wrote `scripts/setup-channels.mjs` — bot creates the channel
  structure programmatically + appends IDs to .env. No manual
  channel-ID copy-pasting.
- Wrote `scripts/import-history.mjs` — markdown chunker that posts
  large docs into a Discord channel without splitting code fences
  mid-message.
- Wrote `scripts/seed-backlog.mjs` — populates the task queue with
  real follow-ups so `/status` shows live work from minute one.

## Captured for the future (don't lose)

**North-star vision: Community bug intake → auto-triage → auto-fix.**
A `#bugs` channel where playtesters drop reports. Bot parses, dedupes
on fuzzy title+repro, increments frequency on dupes, routes Sage→
Wrenchy→user. Schema additions: `bugs` table. 2-3 weekends after
1-DEV is solid.

**Smoke-test bot.** Playwright + headless Chrome runs scripted
scenarios (basic loop / encounter-each / molotov-spam-which-would-
have-caught-the-drift-bug / regen-50-levels / perf sample). Sage
reads the captured logs and writes a bug report. NOT an LLM playing
the game (that's research-grade and unreliable).

**Discord ↔ Claude Code live bridge.** Four implementation paths
weighed in BUILDLOG. Recommendation: **MCP server** (option D) —
expose `read_discord_channel` + `post_discord_message` as tools
this CLI session can call. Same context, no separate Claude.

## Working agreements

- User does vision + final approvals; reviews work; chats with Claudie
- Claudie at center; writes code in interactive Claude Code session
- Other bots are tools / specialists Claudie routes work to
- Everything logged to Discord channels, then consolidated into
  `#memory` nightly
- BUILDLOG is the single source of truth for state across sessions

---

If you're reading this in `#memory` after a fresh session: open
`tools/mission-control/BUILDLOG.md` next, then `SETUP.md` if you're
just joining. The phase plan above tells you what's done and what's
next.
