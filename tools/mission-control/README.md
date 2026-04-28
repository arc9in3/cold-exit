# Mission Control

A small persistent multi-agent workspace running on your machine.
Ollama hosts local models, a Discord bot orchestrates 4 personas
(Claudie, Newsie, Thinkie, Sortie), SQLite tracks everything.

**Read SETUP.md once.** After that, everything is `npm start`.

## What's here

| File | What it is |
|---|---|
| `SETUP.md` | One-time install walkthrough |
| `BUILDLOG.md` | What's built, what's next, decisions made — read first when picking up |
| `package.json` | Dependencies (discord.js, better-sqlite3, node-cron, rss-parser) |
| `schema.sql` | SQLite schema |
| `.env.example` | Env var template — copy to `.env` and fill in |
| `src/bot.mjs` | Main entry — Discord login + slash commands |
| `src/db.mjs` | SQLite open + migrate (`node src/db.mjs --init` to create) |
| `src/personas.mjs` | Bot persona configs (avatars, system prompts, channel mappings) |
| `src/util/log.mjs` | Pretty console logging |
| `src/util/ollama.mjs` | Local Ollama client |
| `src/sources/*.mjs` | News scrapers (HN, Reddit, RSS, GitHub) |
| `src/workers/newsie.mjs` | Morning scan + score + digest |

## Run

```
cd tools/mission-control
npm install                                 # one time
copy .env.example .env                      # then fill in DISCORD_BOT_TOKEN + DISCORD_GUILD_ID
node src/db.mjs --init                      # one time
node scripts/setup-channels.mjs             # creates channels + writes their IDs to .env
node scripts/seed-backlog.mjs               # seeds initial tasks so /status has work to show
node scripts/import-history.mjs --file=SESSION-HISTORY.md --channel=mission-control
node src/bot.mjs                            # always
```

After the bot is running, type `/status` in `#mission-control` to see
the seeded backlog. Use `/audit` and `/refactor` to queue new work.

## Design rules (don't break)

- **One bot process.** All four personas run from `src/bot.mjs` — separated by webhook avatars + channel routing, not separate Discord apps.
- **Bots never auto-spend.** No auto-commits, no auto-posts to social media, no API calls without an explicit ✅ from you.
- **Local models for code-grunt work, Sonnet for personas that talk to you.** Cost discipline.
- **State lives in SQLite.** Single file at `data/mc.db`. No external DB.
- **Runs on your gaming PC alongside Ollama.** Don't deploy this to a hosting provider — the GPU is local, the bot is local.

## Bot directory

| Bot | Channel | Backed by |
|---|---|---|
| 🧠 Claudie | `#claudie`, `#mission-control` | Sonnet (interactive) + qwen2.5-coder:7b for routine acks |
| 📰 Newsie | `#newsie` | Sonnet (morning batch) |
| 💡 Thinkie | `#thinkie` | Sonnet (top-3 articles only) |
| 📚 Sortie | `#sortie`, `#daily-digest` | Sonnet (categorize + digest) |
| 🔧 Wrenchy | (background, no channel) | qwen2.5-coder:32b |
| 🔍 Sage | (background, no channel) | deepseek-r1:32b |
