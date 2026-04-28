#!/usr/bin/env node
//
// One-time channel creation. Reads DISCORD_BOT_TOKEN + DISCORD_GUILD_ID
// from .env, creates the Mission Control v1 channel structure if it
// doesn't already exist, then APPENDS the resolved channel IDs to .env
// so bot.mjs can find them.
//
// Idempotent: skips channels that already exist by name. Safe to re-run
// after adding more channels to the spec.
//
// Usage:
//   node scripts/setup-channels.mjs            # creates the minimal v1 set
//   node scripts/setup-channels.mjs --full     # creates the full set incl. news/brain/archive

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
if (!TOKEN || !GUILD_ID) {
  console.error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID required in .env');
  process.exit(2);
}

const FULL = process.argv.includes('--full');

// Channel spec. category = the Discord category (group), name = channel
// name (no '#'), envVar = the .env key bot.mjs reads.
const MINIMAL = [
  { category: 'MISSION CONTROL', name: 'mission-control', envVar: 'CHAN_MISSION_CONTROL' },
  { category: 'AGENT OFFICES',   name: 'claudie',         envVar: 'CHAN_CLAUDIE' },
  { category: 'PROJECTS',        name: 'cold-exit-dev',   envVar: 'CHAN_COLD_EXIT_DEV' },
];

const FULL_EXTRA = [
  { category: 'MISSION CONTROL', name: 'approvals',         envVar: 'CHAN_APPROVALS' },
  { category: 'AGENT OFFICES',   name: 'newsie',            envVar: 'CHAN_NEWSIE' },
  { category: 'AGENT OFFICES',   name: 'thinkie',           envVar: 'CHAN_THINKIE' },
  { category: 'AGENT OFFICES',   name: 'sortie',            envVar: 'CHAN_SORTIE' },
  { category: 'PROJECTS',        name: 'cold-exit-design',  envVar: 'CHAN_COLD_EXIT_DESIGN' },
  { category: 'PROJECTS',        name: 'cold-exit-assets',  envVar: 'CHAN_COLD_EXIT_ASSETS' },
  { category: 'BRAIN',           name: 'thoughts',          envVar: 'CHAN_THOUGHTS' },
  { category: 'BRAIN',           name: 'dreams',            envVar: 'CHAN_DREAMS' },
  { category: 'BRAIN',           name: 'ideas',             envVar: 'CHAN_IDEAS' },
  { category: 'ARCHIVE',         name: 'daily-digest',      envVar: 'CHAN_DAILY_DIGEST' },
  { category: 'ARCHIVE',         name: 'weekly-digest',     envVar: 'CHAN_WEEKLY_DIGEST' },
  { category: 'ARCHIVE',         name: 'memory',            envVar: 'CHAN_MEMORY' },
];

const SPEC = FULL ? [...MINIMAL, ...FULL_EXTRA] : MINIMAL;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`[setup] logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  console.log(`[setup] target guild: ${guild.name}`);

  // Index existing channels by name so re-runs don't dupe.
  await guild.channels.fetch();
  const existingByName = new Map();
  for (const [, ch] of guild.channels.cache) {
    existingByName.set(ch.name.toLowerCase(), ch);
  }

  // Create / find each category, then create / find each channel under it.
  const categoryIds = new Map();   // name → id
  const resolved = {};             // envVar → channelId

  for (const item of SPEC) {
    // 1. Category
    let cat = categoryIds.get(item.category);
    if (!cat) {
      // Look for an existing category with this exact name (case-insensitive).
      const existingCat = [...guild.channels.cache.values()].find(c =>
        c.type === ChannelType.GuildCategory && c.name.toLowerCase() === item.category.toLowerCase());
      if (existingCat) {
        cat = existingCat.id;
        console.log(`[setup] category "${item.category}" exists → ${cat}`);
      } else {
        const created = await guild.channels.create({
          name: item.category, type: ChannelType.GuildCategory,
        });
        cat = created.id;
        console.log(`[setup] created category "${item.category}" → ${cat}`);
      }
      categoryIds.set(item.category, cat);
    }

    // 2. Channel
    const existing = existingByName.get(item.name.toLowerCase());
    if (existing && existing.type === ChannelType.GuildText) {
      resolved[item.envVar] = existing.id;
      console.log(`[setup] channel "#${item.name}" exists → ${existing.id}`);
      continue;
    }
    const created = await guild.channels.create({
      name: item.name,
      type: ChannelType.GuildText,
      parent: cat,
    });
    resolved[item.envVar] = created.id;
    console.log(`[setup] created "#${item.name}" → ${created.id}`);
  }

  // Append/update .env with resolved IDs.
  let envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  for (const [key, id] of Object.entries(resolved)) {
    const re = new RegExp(`^${key}\\s*=.*$`, 'm');
    if (re.test(envText)) {
      envText = envText.replace(re, `${key}=${id}`);
    } else {
      if (!envText.endsWith('\n') && envText.length) envText += '\n';
      envText += `${key}=${id}\n`;
    }
  }
  fs.writeFileSync(ENV_PATH, envText);
  console.log(`[setup] wrote ${Object.keys(resolved).length} channel IDs to .env`);
  console.log(`[setup] DONE — restart bot.mjs to pick up the new channel IDs`);
  client.destroy();
  process.exit(0);
});

client.on('error', e => { console.error('[setup] error', e); process.exit(1); });
client.login(TOKEN).catch(e => { console.error('[setup] login failed', e.message); process.exit(2); });
