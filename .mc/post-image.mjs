import dotenvPkg from 'file:///C:/work/mission-control/node_modules/dotenv/lib/main.js';
dotenvPkg.config({ path: 'C:/work/mission-control/.env' });
import fs from 'node:fs';
import discordPkg from 'file:///C:/work/mission-control/node_modules/discord.js/src/index.js';
const { Client, GatewayIntentBits, AttachmentBuilder } = discordPkg;

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

function fail(msg) { console.error(`[post-image] ${msg}`); process.exit(2); }

const channelSlug = args.channel;
const file = args.file;
const text = args.text || '';
if (!channelSlug) fail('Missing --channel=<slug>');
if (!file)        fail('Missing --file=<path>');
if (!fs.existsSync(file)) fail(`File not found: ${file}`);

const envKey = 'CHAN_' + String(channelSlug).toUpperCase().replace(/-/g, '_');
const channelId = process.env[envKey];
if (!channelId) fail(`No channel ID for "${channelSlug}" (env var ${envKey})`);

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) fail('DISCORD_BOT_TOKEN missing from env');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) fail(`Channel ${channelId} is not a text channel`);
    const attach = new AttachmentBuilder(file);
    const sent = await channel.send({ content: text, files: [attach] });
    console.log(`[post-image] posted to #${channel.name} (${sent.id})`);
  } catch (e) {
    console.error('[post-image] failed:', e.message);
    process.exit(1);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

client.on('error', e => { console.error('[post-image] client error', e); process.exit(1); });
client.login(TOKEN).catch(e => { console.error('[post-image] login failed', e.message); process.exit(2); });
