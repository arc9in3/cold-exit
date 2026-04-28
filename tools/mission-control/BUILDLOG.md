# Mission Control — Build Log

Persistent record of what's built, what's next, and why decisions were
made the way they were. Future-Claude (and you) reads this at the
start of any new session to pick up without losing context.

## DIRECTORY EXTRACT (mid-session decision)

Mission Control is moving OUT of `cold-exit/tools/mission-control/`
into its own peer repo at `C:\work\mission-control\`. Reason:
mission-control is project-agnostic; it manages projects, it isn't
PART of one. New projects (DesertEdge, NightGarden) should be able
to point mission-control at them via `MC_PROJECT_ROOT` env var
without touching the bot's location.

Code already supports the new layout — `MC_PROJECT_ROOT` env var was
added to `local_runner.mjs` + `dashboard/server.mjs`. Falls back to
the legacy nested path resolution if the env var is unset, so the
same checkout works in both locations during the migration window.

User runs the move per `MIGRATE-OUT.md` in this directory:
1. Stop bot (Ctrl+C)
2. `Move-Item ... C:\work\mission-control`
3. `git init` at new location
4. Confirm `.env` has `MC_PROJECT_ROOT=C:/work/Personal/tacticalrogue`
5. Restart bot from new location
6. `git rm -r tools/mission-control` from cold-exit + commit

## Active state

**Project under development:** Cold Exit (browser isometric extraction shooter)
**Phase:** 1-DEV — focused: development bots first, news layer deferred
**Status:** scaffolding shipped, building dev-bot loop now

## SCOPE PIVOT (mid-session)

User asked to focus on dev bots for Cold Exit FIRST, before the
news/ideas/sortie layer. The full Phase 1 plan still stands; just
re-ordered:

  Phase 1-DEV   (now):  Wrenchy + Sage + Claudie orchestrator + Discord
                        queue commands. Dev workflow loop: user types
                        `/audit ...` in Discord → bot fires task →
                        result posted back, logged to db.
  Phase 1-NEWS  (next): Newsie + Thinkie + Sortie come online once dev
                        loop is solid. Source scrapers + RSS already
                        shipped, just not loaded in bot.mjs yet.
  Phase 1-DASH  (after): localhost:3000 mission control dashboard.

Channel set required for Phase 1-DEV is much smaller — see SETUP.md
"minimal v1" section. User only needs to create 4 channels to start:
  #mission-control, #cold-exit-dev, #cold-exit-design, #claudie

## Cast (locked-in v1)

| Bot | Role | Backed by | Visible? |
|---|---|---|---|
| Claudie 🧠 | Central brain, code, queue, orchestration | Sonnet (interactive via you) + qwen2.5-coder:7b shell for acks | ✅ centerpiece |
| Newsie 📰 | Morning AI/tech scout | Sonnet | ✅ |
| Thinkie 💡 | Idea generator from Newsie's feed | Sonnet (capped) | ✅ |
| Sortie 📚 | Librarian, categorizer, digester | Sonnet | ✅ |
| Wrenchy 🔧 | Local code drafts | qwen2.5-coder:32b | ⬛ background |
| Sage 🔍 | Local audits | deepseek-r1:32b | ⬛ background |

## Decisions made (don't relitigate without cause)

- **Local models for code-grunt work, Sonnet for personas that talk to user.** Cost discipline.
- **Thinkie is capped to top-3 articles per morning** to bound Sonnet spend (~$1/day).
- **Claudie is option B** — daemon shell uses local qwen for routine acks; real reasoning happens in the user's Claude Code session and gets pasted back. Cheap + honest.
- **Single bot process, multiple personas via webhook avatars.** Not 4 separate Discord apps. One `bot.mjs`.
- **All bots run on the user's gaming PC** (same machine as Ollama). No hosting.
- **SQLite for state.** Single file, zero ops. `tools/mission-control/data/mc.db`.
- **Memory consolidation: both daily recap AND long-term fact extraction.**
- **Roster IS mutable.** Add/remove bots via persona configs.

## Channel structure (user creates these in Discord)

```
🛰 MISSION CONTROL
  #mission-control     Claudie posts status, user directs
  #approvals           pending ideas/decisions, react ✅❌📅

🤖 AGENT OFFICES
  #newsie              morning digests, source suggestions
  #thinkie             idea generation, business brainstorms
  #sortie              categorized log
  #claudie             user's direct chat with Claudie

📂 PROJECTS
  #cold-exit-dev       code work, bug fixes, perf, audits
  #cold-exit-design    design discussions, vision
  #cold-exit-assets    asset prompts + reviews

🧠 BRAIN
  #thoughts            user's raw dump (Sortie watches)
  #dreams              visions / aspirational
  #ideas               half-formed concepts (Thinkie reads + builds)

📚 ARCHIVE
  #daily-digest        Sortie's end-of-day summary
  #weekly-digest       Sortie's week wrap-up
  #memory              Claudie's long-term memory dumps
```

## Newsie source list (v1 — user approved)

- HN front page (https://hacker-news.firebaseio.com/v0/topstories.json)
- r/LocalLLaMA, r/MachineLearning, r/singularity, r/programming, r/cursor (via Reddit JSON)
- simonwillison.net (RSS)
- latent.space (RSS)
- GitHub trending (Python + JavaScript)

When Newsie suggests new sources, they post to `#newsie` for user approval before adding.

## Build progress

### ✅ Phase 1A — Foundations (this session)
- [x] Directory `tools/mission-control/` created
- [x] BUILDLOG.md (this file)
- [x] SETUP.md — Discord app + bot creation walkthrough for user
- [x] README.md — quick start + run commands
- [x] package.json — discord.js, better-sqlite3, node-cron
- [x] .env.example
- [x] .gitignore (ignore .env, data/, node_modules/)
- [x] schema.sql — all tables
- [x] src/db.mjs — SQLite open + migrate
- [x] src/util/log.mjs — pretty console
- [x] src/util/ollama.mjs — Ollama client (reuses pattern from tools/local-ai.mjs)
- [x] src/personas.mjs — Claudie/Newsie/Thinkie/Sortie configs (avatars, system prompts, channel mappings)

### ✅ Phase 1B — News scrapers (built but not loaded in bot.mjs yet)
- [x] src/sources/hackernews.mjs — HN top stories scraper
- [x] src/sources/reddit.mjs — subreddit JSON scraper
- [x] src/sources/rss.mjs — generic RSS parser
- [x] src/sources/github.mjs — GitHub trending scraper
- DEFERRED: src/workers/newsie.mjs (Phase 1-NEWS)

### 🟡 Phase 1-DEV — Dev bot loop for Cold Exit (THIS SESSION)
- [ ] src/queue.mjs — DB-backed task queue (uses tasks table)
- [ ] src/workers/wrenchy.mjs — qwen2.5-coder:32b code drafts
- [ ] src/workers/sage.mjs — deepseek-r1:32b audits
- [ ] src/workers/claudie.mjs — orchestrator + Discord ack
- [ ] src/bot.mjs — Discord login, slash commands, webhook posting
  - [ ] `/audit slug:<...> prompt:<...> files:<...>` — fires Sage
  - [ ] `/refactor slug:<...> prompt:<...> files:<...>` — fires Wrenchy
  - [ ] `/draft slug:<...> prompt:<...> files:<...>` — fires Wrenchy
  - [ ] `/status` — Claudie posts current queue + recent activity
  - [ ] `/cancel <slug>` — kill in-flight task

### ⬜ Phase 1-NEWS (later)
- [ ] src/workers/newsie.mjs — morning scan + score + digest
- [ ] src/workers/thinkie.mjs — idea generation from Newsie picks
- [ ] src/workers/sortie.mjs — categorize + daily digest
- [ ] Reaction handlers: ✅ approve, ❌ deny, 📅 later
- [ ] Cron — Newsie at 7am, Sortie nightly digest at 11pm

### ⬜ Phase 1-DASH (later)
- [ ] localhost:3000/mission-control web view
- [ ] Live cards per bot
- [ ] Project switcher

## North-star vision (captured this session, build later)

**Community bug intake → auto-triage → auto-fix loop**

Eventually a `#bugs` channel where invited playtesters drop reports.
The bot:
1. Parses the report (template-prompted: title / repro / freq / version)
2. Inserts into a `bugs` table with status pending
3. De-dupes against existing bugs (fuzzy match on title + repro hash)
4. Increments frequency counter on dupes; pings @user "this is the 5th
   report, prioritized"
5. Routes to Sage to look at relevant code, then Wrenchy to draft a
   fix, then user (or Claudie) to review + ship
6. Posts back to `#bugs` thread when fix lands: "fixed in commit X,
   verify on next deploy"

Roll into broader community workspace:
- `#feedback` — feature requests, idea voting
- `#sentiment` — sentiment analysis of channel activity, weekly digest
- `#changelog` — auto-posted from git on deploy
- `#playtest` — coordinated test runs, bug bounties

Schema additions needed when we build it: `bugs` table (id, title,
repro_steps, frequency, severity, status, reporter_user_ids JSON,
linked_task_id, fix_commit), `feedback` table (sentiment, topic,
upvotes), `releases` table (version, deployed_at, changelog_url).

This is genuinely ambitious — probably 2-3 weekends of work after
Phase 1-DEV is solid. Captured here so it survives session boundaries.

**Discord ↔ Claude Code live bridge**

User asked for a Discord channel that mirrors live conversation with
the interactive Claude Code session. Realistic implementation paths:

- **A. PTY/wrapper hijack** — wrap claude-code in a pty proxy that
  pipes stdin/stdout to/from a Discord channel. Real bidi chat.
  Fragile: terminal redraws, ANSI escapes, prompt injection issues.
- **B. Mirror-and-paste log** (cheapest) — bot watches #claude-relay,
  logs everything to a markdown file. Slash command `/log <text>`
  posts pasted Claude replies back. User keeps the file open;
  conversation is captured but not real-time-typed.
- **C. Separate Claude API daemon** — Discord bot calls Anthropic
  API directly. Real live chat but a SEPARATE Claude with no shared
  context with the CLI session. Two Claudes, one user.
- **D. MCP server bridge** (cleanest if Claude Code keeps MCP support
  stable) — write an MCP server that exposes `read_discord_channel`
  and `post_discord_message` as tools. The CLI Claude (me) can pull
  Discord messages and post replies through tool calls. Same context
  as the user's session, no separate daemon.

Recommendation: **D** if MCP support is solid; **B** if not. Avoid C
(splits the conversation context). A is technically interesting but
brittle and the failure modes are bad (e.g. Discord posts triggering
the wrong terminal session).

Build deferred to Phase 1-NEWS or after; not blocking dev-bot loop.

**Smoke test bot ("Tester" / TBD name)**

Automated playtest agent. Realistic implementation is Puppeteer/
Playwright-driven, NOT an LLM playing the game (LLM-vision-as-player
is research-grade for action games and unreliable). Loop:

1. Cron-fired (e.g. on every push to main, or hourly)
2. Spin up headless Chrome, load cold-exit.pages.dev (or local file://)
3. Run a script library:
     - basic loop: spawn → walk to elevator → open door → fight room → exit
     - encounter-each: trigger every encounter we know about
     - molotov spam: throw 20 molotovs at random props (would have
       caught the drift-undefined crash from today)
     - regen 50 levels: detect memory leaks
     - perf sample: capture FPS + frame time at 5 checkpoints
4. Capture console logs, exceptions, perf metrics
5. LLM (Sage or claude) reads the captured logs + writes a bug report
   into the bugs table, OR posts "all green" to #qa

Tooling: Playwright > Puppeteer (better Three.js compat, supports
WebGL traces). Headless mode with --enable-webgl for real rendering.

Schema additions: `qa_runs` table (id, started_at, finished_at,
status, scenarios_passed, scenarios_failed, log_path, fps_p50, fps_p95).

Captured for Phase 2/3. Don't build until Phase 1-DEV is solid AND
the bugs table from the community-intake vision exists — they share
infrastructure.

## Things deferred (don't lose track)

- Animated cartoon robots — Phase 4
- Asset generation pipeline (DALL-E / SDXL) — Phase 3
- Social media posting — Phase 3+
- Outreach / business dev / CRM — out of scope for v1
- Multi-project switching beyond Cold Exit — wire when user adds 2nd project

## Things to remember when picking this up

1. **The bot does NOT live on a hosted server.** It runs on the user's gaming PC alongside Ollama at `http://localhost:11434`. If you find yourself thinking "deploy to Railway / Fly.io" — stop, read this line again.
2. **The user runs `node src/bot.mjs` themselves to start it.** Optionally Task Scheduler entry on boot. No PM2, no systemd.
3. **Claudie shell uses `qwen2.5-coder:7b`** (small, fast) for routine acks — not 32b. The 32b is Wrenchy/Sage's tool, not Claudie's voice.
4. **Sortie's tag taxonomy is open** — let it grow organically from what the user reacts to. Don't over-design upfront.
5. **The user is doing all final approvals.** Bots never auto-commit code, never auto-post to social media, never spend money without an explicit ✅ reaction.
