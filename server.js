// server.js
require('dotenv').config();

const fs = require('fs');
const { PassThrough } = require('stream');
const express = require('express');
const { spawn } = require('child_process');
const prism = require('prism-media');

const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const PORT = parseInt(process.env.PORT || '3000', 10);
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const MP3_BITRATE = process.env.MP3_BITRATE || '96k';

if (!BOT_TOKEN) {
  console.error('Erreur: précise BOT_TOKEN dans le .env');
  process.exit(1);
}

// broadcast -> flux MP3 auquel on pipe la sortie de ffmpeg
const mp3Broadcast = new PassThrough();

// start (and auto-restart) ffmpeg that reads PCM s16le 48k stereo from stdin and outputs MP3 to stdout
let ffmpeg = null;
function startFfmpeg() {
  console.log('Démarrage de ffmpeg...');
  // args: read s16le 48k stereo from stdin and output mp3 to stdout
  const args = [
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    '-i', 'pipe:0',
    '-f', 'mp3',
    '-b:a', MP3_BITRATE,
    'pipe:1'
  ];

  ffmpeg = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'inherit'] });

  ffmpeg.stdout.on('data', (chunk) => {
    // push to broadcast - backpressure handled by node streams
    mp3Broadcast.write(chunk);
  });

  ffmpeg.on('exit', (code, signal) => {
    console.warn(`ffmpeg exited code=${code} signal=${signal}. Restart dans 1s`);
    // small delay then restart to avoid crash loops
    setTimeout(startFfmpeg, 1000);
  });

  ffmpeg.on('error', (err) => {
    console.error('Erreur ffmpeg', err);
  });

  return ffmpeg;
}

// Start ffmpeg immediately
startFfmpeg();

// Express minimal server
const app = express();
app.use(express.static('public'));

// endpoint stream
app.get('/stream.mp3', (req, res) => {
  res.set({
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // crée un flux client individuel
  const clientStream = new PassThrough();
  mp3Broadcast.pipe(clientStream);
  clientStream.pipe(res);

  req.on('close', () => {
    try {
      mp3Broadcast.unpipe(clientStream);
      clientStream.end();
    } catch (e) {}
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
  console.log(`HTTP server running: http://localhost:${PORT}`);
});

// --- Discord bot ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

let voiceConnection = null;

async function joinVoice(guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('Guild not found in cache');
  const channel = guild.channels.cache.get(channelId);
  if (!channel) throw new Error('Voice channel not found or not cached');

  // create voice connection
  const connection = joinVoiceChannel({
    channelId: channelId,
    guildId: guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false // important: must not be deaf to receive audio
  });

  // wait until ready or throw
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    console.log('Voice connection ready');
  } catch (err) {
    console.error('Impossible d\'établir la connexion voice', err);
    connection.destroy();
    throw err;
  }

  voiceConnection = connection;
  setupReceiver(connection);
  connection.on('stateChange', (oldState, newState) => {
    console.log('Voice connection state:', oldState.status, '->', newState.status);
    if (newState.status === VoiceConnectionStatus.Destroyed) {
      voiceConnection = null;
    }
  });

  return connection;
}

function setupReceiver(connection) {
  if (!connection) return;
  const receiver = connection.receiver;

  // écoute les évènements "start speaking" (détecte quand un user parle)
  receiver.speaking.on('start', (userId) => {
    try {
      console.log(`User ${userId} started speaking — creating subscription.`);
      // subscribe renvoie un flux Opus pour l'utilisateur
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 800 }
      });

      // décoce Opus -> PCM s16le 48k stereo
      const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });

      // protection if ffmpeg.stdin not ready
      if (!ffmpeg || !ffmpeg.stdin || ffmpeg.killed) {
        console.warn('ffmpeg non prêt — on tente de redémarrer');
        try { startFfmpeg(); } catch (e) { console.error('Impossible de démarrer ffmpeg', e); }
      }

      // pipe decoded pcm into ffmpeg.stdin
      opusStream.pipe(decoder).on('data', (chunk) => {
        // write into ffmpeg stdin (note: we don't close stdin on stream end)
        if (ffmpeg && ffmpeg.stdin.writable) {
          const ok = ffmpeg.stdin.write(chunk);
          if (!ok) {
            // backpressure — pause decoder briefly
            decoder.pause();
            ffmpeg.stdin.once('drain', () => decoder.resume());
          }
        }
      });

      opusStream.on('end', () => {
        console.log(`Opus stream ended for ${userId}`);
        try { decoder.destroy(); } catch (_) {}
      });

      opusStream.on('error', (err) => {
        console.error('opusStream error', err);
      });

    } catch (err) {
      console.error('Erreur lors de la subscription audio', err);
    }
  });

  receiver.speaking.on('end', (userId) => {
    // parfois on recevra end events — log pour débug
    console.log(`speaking end detected for ${userId}`);
  });
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Auto-join if env variables provided
  if (GUILD_ID && VOICE_CHANNEL_ID) {
    try {
      await joinVoice(GUILD_ID, VOICE_CHANNEL_ID);
      console.log('Bot a rejoint le salon vocal défini dans .env');
    } catch (err) {
      console.error('Erreur auto-join:', err);
    }
  } else {
    console.log('Aucun VOICE_CHANNEL_ID/GUILD_ID fourni: utilise une commande / HTTP pour joindre le canal.');
  }
});

// Simple text command to join a channel: send "!joinVoice <guildId> <channelId>" in any channel the bot can read
client.on('messageCreate', async (message) => {
  if (message.author?.bot) return;
  const content = message.content?.trim();
  if (!content) return;

  if (content.startsWith('!joinVoice')) {
    const parts = content.split(/\s+/);
    const guildId = parts[1] || message.guildId;
    const channelId = parts[2];
    if (!guildId || !channelId) {
      message.reply('Usage: `!joinVoice <guildId> <voiceChannelId>` (ou mets VOICE_CHANNEL_ID dans .env).');
      return;
    }
    try {
      await joinVoice(guildId, channelId);
      message.reply('Rejoint le salon vocal ✅');
    } catch (err) {
      console.error(err);
      message.reply('Erreur en rejoignant le salon vocal — check logs.');
    }
  }

  if (content === '!leaveVoice') {
    if (voiceConnection) {
      voiceConnection.destroy();
      voiceConnection = null;
      message.reply('Déconnecté du salon vocal ✅');
    } else {
      message.reply('Je ne suis pas connecté.');
    }
  }
});

client.login(BOT_TOKEN).catch(err => {
  console.error('Impossible de se connecter au bot Discord', err);
});

// cleanup on exit
function shutdown() {
  console.log('Fermeture...');

  try {
    if (voiceConnection) voiceConnection.destroy();
  } catch (e) {}

  try {
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.stdin.end();
      ffmpeg.kill('SIGTERM');
    }
  } catch (e) {}

  try {
    mp3Broadcast.end();
  } catch (e) {}

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
