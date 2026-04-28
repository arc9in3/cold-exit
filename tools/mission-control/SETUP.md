# Mission Control — Setup Guide

One-time setup. Walk through this once; everything after is just
`node src/bot.mjs` from this directory.

## 1. Create a Discord application + bot user (5 minutes)

1. Go to https://discord.com/developers/applications
2. Click **"New Application"** in the top right.
3. Name it whatever you want (e.g. `mission-control`). Accept the ToS, click Create.
4. Left sidebar → **"Bot"** → click **"Add Bot"** → confirm.
5. Under "Token" click **"Reset Token"** then **"Copy"**. **THIS IS A SECRET.** Treat it like a password. We'll paste it into a local `.env` file in step 4 — never share it in chat or commit it to git.
6. Scroll down to **"Privileged Gateway Intents"** and enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
7. Scroll down to **"Bot Permissions"** and tick:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Manage Webhooks
   - ✅ Read Message History
   - ✅ Add Reactions
   - ✅ Use Slash Commands
8. Save changes.

## 2. Invite the bot to your server (1 minute)

1. Left sidebar → **"OAuth2"** → **"URL Generator"**.
2. Scopes — tick `bot` AND `applications.commands`.
3. Bot Permissions — same checks as step 1.7.
4. Copy the generated URL at the bottom, paste into your browser.
5. Pick your server from the dropdown, click Authorize.
6. The bot now appears in your server's member list (offline until we start it).

## 3. Create the channel structure in Discord (10 minutes)

### Minimal v1 — Phase 1-DEV (only 3 channels needed)

To get the dev-bot loop alive in Discord, you only need three:

```
🛰 MISSION CONTROL
  #mission-control   ← Claudie posts status, boot announcements

📂 PROJECTS
  #cold-exit-dev     ← /audit and /refactor results post here

🤖 AGENT OFFICES
  #claudie           ← (reserved for direct Claudie chat later)
```

Set `CHAN_MISSION_CONTROL`, `CHAN_COLD_EXIT_DEV`, `CHAN_CLAUDIE` in
`.env`. The bot starts with these three. Skip the rest for now —
they're only needed when Phase 1-NEWS comes online.

### Full v1 — Phase 1 complete

Create these categories and channels in your server. Order matters
visually but not functionally; group as you like:

```
🛰 MISSION CONTROL
  #mission-control
  #approvals

🤖 AGENT OFFICES
  #newsie
  #thinkie
  #sortie
  #claudie

📂 PROJECTS
  #cold-exit-dev
  #cold-exit-design
  #cold-exit-assets

🧠 BRAIN
  #thoughts
  #dreams
  #ideas

📚 ARCHIVE
  #daily-digest
  #weekly-digest
  #memory
```

After creating each channel, **right-click the channel → Copy Channel ID**.
You'll need 14 channel IDs in step 4. (Enable Developer Mode under
User Settings → Advanced if "Copy Channel ID" doesn't appear.)

## 4. Configure environment

In this directory:

```
copy .env.example .env
```

Open `.env` in any editor and fill in:

```
DISCORD_BOT_TOKEN=<the secret from step 1.5>
DISCORD_GUILD_ID=<right-click your server name → Copy Server ID>

CHAN_MISSION_CONTROL=<channel ID from step 3>
CHAN_APPROVALS=<channel ID>
CHAN_NEWSIE=<channel ID>
CHAN_THINKIE=<channel ID>
CHAN_SORTIE=<channel ID>
CHAN_CLAUDIE=<channel ID>
CHAN_COLD_EXIT_DEV=<channel ID>
CHAN_COLD_EXIT_DESIGN=<channel ID>
CHAN_COLD_EXIT_ASSETS=<channel ID>
CHAN_THOUGHTS=<channel ID>
CHAN_DREAMS=<channel ID>
CHAN_IDEAS=<channel ID>
CHAN_DAILY_DIGEST=<channel ID>
CHAN_WEEKLY_DIGEST=<channel ID>
CHAN_MEMORY=<channel ID>
```

`.env` is gitignored — it never leaves your machine.

## 5. Install dependencies

```
cd tools/mission-control
npm install
```

This pulls `discord.js`, `better-sqlite3`, `node-cron`, and a couple
small RSS parsers. ~80MB of node_modules.

## 6. Initialize the database

```
node src/db.mjs --init
```

Creates `data/mc.db` and runs the schema. Idempotent — safe to re-run.

## 7. Start the bot

```
node src/bot.mjs
```

If everything's wired you'll see:

```
[mc] db ready
[mc] discord login ok as mission-control#1234
[mc] resolved 14/14 channels
[mc] cron: newsie scheduled for 07:00 daily
[mc] ready — type /status in #mission-control
```

The bot's name in Discord goes from offline → online. Type `/status` in
`#mission-control` and Claudie should respond with a placeholder embed.

## 8. (Optional) Start on PC boot

In Windows:

```
schtasks /create /tn "MissionControl" /tr "node C:\work\personal\tacticalrogue\tools\mission-control\src\bot.mjs" /sc onstart /ru SYSTEM
```

Or open Task Scheduler GUI → create a basic task that runs the same
command on logon.

## What to do if something breaks

- **Bot says "Bot is offline" in Discord** — `node src/bot.mjs` isn't running, or the token is wrong, or you didn't enable the Privileged Intents in step 1.6.
- **Slash command `/status` doesn't appear** — slash commands sometimes take ~1hr to propagate the first time. Restart Discord client. If still missing, the bot didn't have `applications.commands` scope when you invited it (re-do step 2).
- **Newsie doesn't post in the morning** — check the bot's console for `[cron]` errors. The cron uses your local TZ; verify by setting `TZ=America/Los_Angeles` (or your zone) in `.env`.
- **`Cannot find module 'better-sqlite3'`** — `npm install` failed; on Windows you may need `npm install --build-from-source` if the prebuilt binary isn't available for your Node version.
