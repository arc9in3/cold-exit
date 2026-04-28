// Mission Control — Discord bot entry. Single Node process; speaks as
// multiple personas (Claudie / Newsie / Thinkie / Sortie) by routing
// messages to webhooks bound per channel. Wrenchy + Sage are the
// background workers, started here, no Discord persona — they post
// THROUGH Claudie ("✅ Wrenchy finished refactor-X").
//
// Phase 1-DEV scope: only Claudie, Wrenchy, Sage are loaded. Newsie
// + Thinkie + Sortie come online in Phase 1-NEWS.

import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, REST, Routes,
         SlashCommandBuilder, WebhookClient, PermissionsBitField } from 'discord.js';
import { db, migrate } from './db.mjs';
import { enqueue } from './queue.mjs';
import { PERSONAS } from './personas.mjs';
import { startWrenchy, setOnResultPosted as wrenchyOnDone } from './workers/wrenchy.mjs';
import { startSage,    setOnResultPosted as sageOnDone    } from './workers/sage.mjs';
import { ackQueue, pickOwner, statusReport } from './workers/claudie.mjs';
import { log, warn, err } from './util/log.mjs';

// ---------- env --------------------------------------------------------
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
if (!TOKEN || !GUILD_ID) {
  err('mc', 'DISCORD_BOT_TOKEN and DISCORD_GUILD_ID required in .env. See SETUP.md.');
  process.exit(2);
}

// Minimal v1 channels for Phase 1-DEV. Newsie/Thinkie/Sortie/etc. are
// optional — bot starts even if their env vars are missing, just logs
// a warning.
const REQUIRED_CHANS = ['CHAN_MISSION_CONTROL', 'CHAN_CLAUDIE', 'CHAN_COLD_EXIT_DEV'];
const OPTIONAL_CHANS = ['CHAN_APPROVALS', 'CHAN_NEWSIE', 'CHAN_THINKIE', 'CHAN_SORTIE',
                        'CHAN_COLD_EXIT_DESIGN', 'CHAN_COLD_EXIT_ASSETS',
                        'CHAN_THOUGHTS', 'CHAN_DREAMS', 'CHAN_IDEAS',
                        'CHAN_DAILY_DIGEST', 'CHAN_WEEKLY_DIGEST', 'CHAN_MEMORY'];
for (const k of REQUIRED_CHANS) {
  if (!process.env[k]) {
    err('mc', `${k} required in .env. See SETUP.md "Minimal v1" section.`);
    process.exit(2);
  }
}

// ---------- db ---------------------------------------------------------
migrate();
log('db', 'ready');

// ---------- discord client --------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
});

// Per-channel webhooks for persona-tagged messages. Created on demand,
// reused thereafter. Map<channelId, WebhookClient>.
const _webhooks = new Map();

async function _getWebhook(channel) {
  if (_webhooks.has(channel.id)) return _webhooks.get(channel.id);
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find(h => h.name === 'mission-control');
  if (!hook) {
    hook = await channel.createWebhook({ name: 'mission-control' });
  }
  const wh = new WebhookClient({ id: hook.id, token: hook.token });
  _webhooks.set(channel.id, wh);
  return wh;
}

// Speak as a persona in a target channel. Looks up the persona's
// avatar + name and posts via that channel's webhook so the message
// header reads as the bot character, not "mission-control bot".
async function postAs(personaKey, channelId, content, embeds = []) {
  const persona = PERSONAS[personaKey];
  if (!persona) { warn('mc', `unknown persona ${personaKey}`); return; }
  const channel = await client.channels.fetch(channelId);
  if (!channel) { warn('mc', `channel ${channelId} not found`); return; }
  const wh = await _getWebhook(channel);
  // Avatar URL: discord.js can't auto-generate from emoji; you can
  // upload PNGs later and reference them via env vars. For v1 the
  // persona name + emoji prefix is enough for visual distinction.
  await wh.send({
    username: `${persona.emoji} ${persona.name}`,
    content: content || undefined,
    embeds,
  });
}

// ---------- slash command registration --------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('audit')
    .setDescription('Queue an audit task (routes to Sage / deepseek-r1)')
    .addStringOption(o => o.setName('slug').setDescription('Task slug, e.g. audit-shop-collisions').setRequired(true))
    .addStringOption(o => o.setName('prompt').setDescription('What to audit, in plain English').setRequired(true))
    .addStringOption(o => o.setName('files').setDescription('Comma-separated file paths (e.g. src/level.js,src/main.js)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('refactor')
    .setDescription('Queue a refactor / code-edit task (routes to Wrenchy / qwen2.5-coder)')
    .addStringOption(o => o.setName('slug').setDescription('Task slug, e.g. refactor-extract-helper').setRequired(true))
    .addStringOption(o => o.setName('prompt').setDescription('What to refactor, in plain English').setRequired(true))
    .addStringOption(o => o.setName('files').setDescription('Comma-separated file paths').setRequired(false)),
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Claudie reports current queue + recent activity'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID),
                 { body: commands.map(c => c.toJSON()) });
  log('discord', `registered ${commands.length} slash commands`);
}

// ---------- command handlers ------------------------------------------
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'audit' || interaction.commandName === 'refactor') {
    const slug = interaction.options.getString('slug');
    const prompt = interaction.options.getString('prompt');
    const filesRaw = interaction.options.getString('files') || '';
    const files = filesRaw.split(',').map(s => s.trim()).filter(Boolean);
    // Audit always → sage; refactor always → wrenchy. (pickOwner is for
    // future free-form queueing where the slug alone implies routing.)
    const owner = interaction.commandName === 'audit' ? 'sage' : 'wrenchy';
    const taskId = enqueue({
      slug,
      title: slug,
      prompt,
      files,
      owner,
      routeReason: `via /${interaction.commandName}`,
      originUserId: interaction.user.id,
      originChannelId: interaction.channelId,
    });
    await interaction.reply({ ephemeral: false, content: `📋 Queued task #${taskId} **${slug}** → ${owner === 'sage' ? '🔍 Sage' : '🔧 Wrenchy'}` });
    // Async ack via Claudie in #mission-control.
    const ack = await ackQueue(slug, owner, `via /${interaction.commandName}`);
    postAs('claudie', process.env.CHAN_MISSION_CONTROL, ack).catch(e => err('mc', `claudie ack post failed: ${e.message}`));
    return;
  }

  if (interaction.commandName === 'status') {
    await interaction.deferReply();
    const { inProgress, queued, done } = statusReport();
    const fmtTask = (t) => `\`#${t.id}\` ${t.slug} · ${t.owner}`;
    const embed = new EmbedBuilder()
      .setColor(PERSONAS.claudie.color)
      .setTitle('🧠 Claudie — Status Report')
      .addFields(
        { name: `🟡 In progress (${inProgress.length})`, value: inProgress.length ? inProgress.map(fmtTask).join('\n') : '_(idle)_' },
        { name: `📦 Queued (${queued.length})`, value: queued.length ? queued.map(fmtTask).join('\n') : '_(empty)_' },
        { name: `✅ Recently done (${done.length})`, value: done.length ? done.map(t => `\`#${t.id}\` ${t.slug} · ${t.owner} · ${t.duration_ms ? Math.round(t.duration_ms / 1000) + 's' : '?'}`).join('\n') : '_(none yet)_' },
      )
      .setFooter({ text: `project: ${db().prepare("SELECT value FROM meta WHERE key='current_project'").get().value}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
    return;
  }
});

// ---------- worker post-back hook -------------------------------------
// When Wrenchy or Sage finishes a task, this fires — we post Claudie's
// "✅ X finished" message to #mission-control + a longer post in the
// channel where the user originally queued the task.
async function onWorkerDone(task, result) {
  const ownerEmoji = task.owner === 'sage' ? '🔍' : '🔧';
  const headline = result.ok
    ? `✅ ${ownerEmoji} **${task.owner}** finished **${task.slug}** in ${(result.durationMs / 1000).toFixed(1)}s · \`${result.outputPath}\``
    : `❌ ${ownerEmoji} **${task.owner}** failed **${task.slug}**: ${result.error}`;
  // Claudie summary in #mission-control.
  await postAs('claudie', process.env.CHAN_MISSION_CONTROL, headline);
  // Longer post in the originating channel (with the result preview).
  if (task.origin_channel_id && result.ok) {
    const channel = await client.channels.fetch(task.origin_channel_id).catch(() => null);
    if (channel) {
      const wh = await _getWebhook(channel);
      const personaKey = task.owner === 'sage' ? 'claudie' : 'claudie';   // background workers post under Claudie
      await wh.send({
        username: `${PERSONAS[personaKey].emoji} ${PERSONAS[personaKey].name}`,
        content: `${headline}\n\n>>> ${result.summary || '(empty)'}`.slice(0, 1900),
      });
    }
  }
}

wrenchyOnDone(onWorkerDone);
sageOnDone(onWorkerDone);

// ---------- boot -------------------------------------------------------
client.once('ready', async () => {
  log('discord', `login ok as ${client.user.tag}`);
  // Resolve every required channel to fail fast on misconfiguration.
  for (const k of REQUIRED_CHANS) {
    const id = process.env[k];
    const c = await client.channels.fetch(id).catch(() => null);
    if (!c) { err('mc', `${k}=${id} not resolvable. Bot in the right guild? Channel deleted?`); process.exit(3); }
  }
  let optResolved = 0;
  for (const k of OPTIONAL_CHANS) {
    if (!process.env[k]) continue;
    const c = await client.channels.fetch(process.env[k]).catch(() => null);
    if (c) optResolved++;
    else warn('mc', `${k}=${process.env[k]} not resolvable, skipping`);
  }
  log('mc', `resolved ${REQUIRED_CHANS.length}/${REQUIRED_CHANS.length} required + ${optResolved}/${OPTIONAL_CHANS.length} optional channels`);
  await registerCommands();
  startWrenchy();
  startSage();
  // Boot announcement.
  await postAs('claudie', process.env.CHAN_MISSION_CONTROL,
    `🟢 Mission Control online. Type \`/status\` to see the queue, \`/audit\` to fire Sage, \`/refactor\` to fire Wrenchy.`)
    .catch(e => warn('mc', `boot announce failed: ${e.message}`));
});

client.on('error', e => err('discord', e.message));
process.on('SIGINT', () => { log('mc', 'SIGINT — shutting down'); client.destroy(); db().close(); process.exit(0); });

client.login(TOKEN).catch(e => { err('discord', `login failed: ${e.message}`); process.exit(2); });
