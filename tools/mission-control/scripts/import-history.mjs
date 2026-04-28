#!/usr/bin/env node
//
// Post a markdown file into a Discord channel as a series of messages,
// chunked at Discord's 2000-char hard limit. Used to seed channels
// with project history, conversation summaries, design docs, etc.
//
// Each chunk preserves markdown formatting (won't split mid-codeblock,
// won't break headers across messages) — the splitter looks for
// natural boundaries before the limit.
//
// Usage:
//   node scripts/import-history.mjs --file=SESSION-HISTORY.md --channel=memory
//   node scripts/import-history.mjs --file=docs/foo.md --channel-id=123456789

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, GatewayIntentBits, ChannelType } from 'discord.js';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

const filePath = args.file;
if (!filePath) {
  console.error('Missing --file=<path>');
  process.exit(2);
}
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(2);
}
const text = fs.readFileSync(filePath, 'utf8');

// Channel can be specified by env-var name (--channel=memory →
// CHAN_MEMORY) or by raw ID (--channel-id=123).
let channelId = args['channel-id'];
if (!channelId && args.channel) {
  const envKey = `CHAN_${String(args.channel).toUpperCase().replace(/-/g, '_')}`;
  channelId = process.env[envKey];
  if (!channelId) {
    console.error(`No channel ID found for ${envKey}. Either set it in .env or pass --channel-id=<id>.`);
    process.exit(2);
  }
}
if (!channelId) {
  console.error('Missing --channel=<name> or --channel-id=<id>');
  process.exit(2);
}

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) {
  console.error('DISCORD_BOT_TOKEN missing in .env');
  process.exit(2);
}

// ---------- chunker ---------------------------------------------------
// Discord max per message: 2000 chars. We aim for ~1900 to leave room.
// Strategy: walk the text, find the latest "good" split point before
// the limit. Good splits, in priority order:
//   1. End of a code block (closing ``` line)
//   2. Blank line (paragraph break)
//   3. End of a line
//   4. Hard cut at the limit (fallback)
//
// Track whether we're currently inside a code fence so we don't split
// inside one — if a chunk would end mid-fence, push the fence close
// onto this chunk and reopen it on the next.

const HARD_LIMIT = 1900;

function chunkMarkdown(src) {
  const chunks = [];
  let i = 0;
  let inFence = false;
  let fenceLang = '';
  while (i < src.length) {
    let end = Math.min(i + HARD_LIMIT, src.length);
    let split = -1;

    // Walk backward from `end` looking for a good break.
    if (end < src.length) {
      // Prefer: blank-line boundary
      const blankAt = src.lastIndexOf('\n\n', end);
      if (blankAt > i + HARD_LIMIT * 0.4) split = blankAt + 2;
      // Else: any newline
      if (split < 0) {
        const nlAt = src.lastIndexOf('\n', end);
        if (nlAt > i + HARD_LIMIT * 0.4) split = nlAt + 1;
      }
    }
    if (split < 0) split = end;

    let chunk = src.slice(i, split);

    // Check fence balance — count ``` toggles in this chunk.
    const fenceMatches = chunk.match(/^```/gm) || [];
    let chunkFenceParity = inFence ? 1 : 0;
    let lastFenceLang = fenceLang;
    for (const f of fenceMatches) {
      if (chunkFenceParity === 0) {
        // Opening — capture language hint from the line.
        const idx = chunk.indexOf(f);
        const eol = chunk.indexOf('\n', idx);
        lastFenceLang = chunk.slice(idx + 3, eol).trim();
        chunkFenceParity = 1;
      } else {
        chunkFenceParity = 0;
        lastFenceLang = '';
      }
    }

    // If this chunk ends inside a fence, append a closing fence.
    // The next chunk will reopen with the same language hint.
    if (chunkFenceParity === 1) {
      chunk += '\n```';
      inFence = true;
      fenceLang = lastFenceLang;
    } else if (inFence) {
      // We started this chunk inside a fence; if it didn't close,
      // we already added the close above. Reset.
      inFence = false;
      fenceLang = '';
    } else {
      // Normal — track whatever the last open fence was for next round.
      inFence = chunkFenceParity === 1;
      fenceLang = lastFenceLang;
    }

    chunks.push(chunk.trimEnd());

    // If the next chunk needs to reopen a fence, prepend it.
    if (inFence && i + chunk.length < src.length) {
      const reopenLine = `\`\`\`${fenceLang}\n`;
      // Splice the reopen into the SOURCE so the next iteration's
      // chunk includes it. (Cheaper than tracking it as a separate
      // pending-prefix.)
      // We don't want to mutate `src` permanently — just splice for
      // the next iteration.
      // Easier: prepend to next iteration via a sentinel.
      // Implementation: we just write `reopenLine + src.slice(split)` once.
      // To keep the loop clean, do it now:
      // (Note: split is already past the end of chunk text.)
      const before = src.slice(0, split);
      const after = src.slice(split);
      // Reassign src + i so loop continues cleanly.
      // eslint-disable-next-line no-param-reassign
      src = before + reopenLine + after;
      split += reopenLine.length;
    }

    i = split;
  }
  return chunks;
}

// ---------- post ------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`[import] logged in as ${client.user.tag}`);
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error(`Channel ${channelId} not found or not a text channel`);
    process.exit(3);
  }
  console.log(`[import] target #${channel.name} in ${channel.guild.name}`);

  const chunks = chunkMarkdown(text);
  console.log(`[import] ${text.length} chars → ${chunks.length} messages`);

  // Lead-in marker so future scrolls can find the import boundary.
  await channel.send(`📥 **Importing ${path.basename(filePath)}** · ${chunks.length} parts · ${new Date().toISOString()}`);

  for (let n = 0; n < chunks.length; n++) {
    const body = chunks[n];
    if (!body.trim()) continue;
    const prefix = chunks.length > 1 ? `*part ${n + 1}/${chunks.length}*\n` : '';
    await channel.send({ content: (prefix + body).slice(0, 2000) });
    // Light rate-limit cushion. Discord allows 5 msg/5s in a channel
    // for bots; 250ms between sends keeps us safely under.
    if (n < chunks.length - 1) await new Promise(r => setTimeout(r, 280));
  }

  await channel.send(`✅ **Import complete** · ${chunks.length} parts posted.`);
  console.log(`[import] DONE`);
  client.destroy();
  process.exit(0);
});

client.on('error', e => { console.error('[import] error', e); process.exit(1); });
client.login(TOKEN).catch(e => { console.error('[import] login failed', e.message); process.exit(2); });
