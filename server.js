// server.js
require('dotenv').config();
const { PassThrough } = require('stream');
const express = require('express');
const { spawn } = require('child_process');
const prism = require('prism-media');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus,
  EndBehaviorType,
} = require('@discordjs/voice');

const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.CHANNEL_ID;
const PORT = parseInt(process.env.PORT || '3000', 10);
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const OUT_FORMAT = (process.env.OUT_FORMAT || 'opus').toLowerCase(); // 'opus' or 'mp3'
const OPUS_BITRATE = process.env.OPUS_BITRATE || '64000';
const MP3_BITRATE = process.env.MP3_BITRATE || '96000';
const MIX_FRAME_MS = parseInt(process.env.MIX_FRAME_MS || '20', 10);

if (!BOT_TOKEN) {
  console.error('Erreur: BOT_TOKEN manquant dans .env');
  process.exit(1);
}

// audio constants
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // s16le Int16
const FRAME_SAMPLES = Math.floor(SAMPLE_RATE * (MIX_FRAME_MS / 1000)); // e.g. 960 @20ms
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * BYTES_PER_SAMPLE;

console.log(`Config audio: ${FRAME_SAMPLES} samples/frame (${MIX_FRAME_MS}ms), ${FRAME_BYTES} bytes/frame`);

const encodedBroadcast = new PassThrough(); // flux encodé (ffmpeg stdout -> clients)
let currentFfmpeg = null; // référence ffmpeg
let ffmpegRestarting = false;

// --- Mixer: buffer par source, mix périodique et écriture sur writable (ffmpeg.stdin) ---
class Mixer {
  constructor(frameBytes) {
    this.frameBytes = frameBytes;
    this.sources = new Map(); // userId -> { buffer: Buffer }
    this.timer = null;
    this.output = null; // writable (ffmpeg.stdin)
    this.running = false;
  }

  setOutput(writable) {
    this.output = writable;
  }

  addSource(id) {
    if (!this.sources.has(id)) this.sources.set(id, { buffer: Buffer.alloc(0) });
  }

  removeSource(id) {
    this.sources.delete(id);
  }

  pushToSource(id, chunk) {
    const entry = this.sources.get(id);
    if (!entry) return;
    entry.buffer = Buffer.concat([entry.buffer, chunk]);
    const maxCap = this.frameBytes * 200; // cap to avoid runaway memory (200 frames buffer)
    if (entry.buffer.length > maxCap) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - maxCap);
    }
  }

  readFrameForSource(id) {
    const entry = this.sources.get(id);
    if (!entry) return Buffer.alloc(this.frameBytes);
    if (entry.buffer.length >= this.frameBytes) {
      const f = entry.buffer.slice(0, this.frameBytes);
      entry.buffer = entry.buffer.slice(this.frameBytes);
      return f;
    }
    // not enough data -> return silence
    return Buffer.alloc(this.frameBytes);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      const ids = Array.from(this.sources.keys());
      const n = ids.length;

      // produce silence if no sources
      if (n === 0) {
        const silence = Buffer.alloc(this.frameBytes);
        if (this.output && this.output.writable) this.output.write(silence);
        return;
      }

      const sampleCount = this.frameBytes / BYTES_PER_SAMPLE; // interleaved samples
      const mixedFloat = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) mixedFloat[i] = 0.0;

      // sum samples from each source (convert Int16 -> float)
      for (const id of ids) {
        const frameBuf = this.readFrameForSource(id);
        for (let i = 0; i < sampleCount; i++) {
          const s = frameBuf.readInt16LE(i * 2);
          mixedFloat[i] += s / 32768.0;
        }
      }

      // normalize by number of active sources (simple)
      for (let i = 0; i < sampleCount; i++) mixedFloat[i] = mixedFloat[i] / n;

      // clamp and convert back to Int16LE buffer
      const out = Buffer.alloc(this.frameBytes);
      for (let i = 0; i < sampleCount; i++) {
        let v = Math.max(-1, Math.min(1, mixedFloat[i]));
        const val = Math.round(v * 32767);
        out.writeInt16LE(val, i * 2);
      }

      // write to ffmpeg stdin
      if (this.output && this.output.writable) {
        const ok = this.output.write(out);
        if (!ok) {
          // backpressure: let it be handled naturally
          // optionally we could pause mixing for a tick
        }
      }
    }, MIX_FRAME_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.running = false;
  }
}

const mixer = new Mixer(FRAME_BYTES);
mixer.start();

// --- ffmpeg spawn / restart management ---
function startFfmpeg() {
  if (ffmpegRestarting) return;
  ffmpegRestarting = true;
  console.log('Démarrage ffmpeg, format=', OUT_FORMAT);
  const args = [
    '-f', 's16le',
    '-ar', String(SAMPLE_RATE),
    '-ac', String(CHANNELS),
    '-i', 'pipe:0',
    '-loglevel', 'info'
  ];

  if (OUT_FORMAT === 'opus') {
    args.push('-c:a', 'libopus', '-b:a', String(OPUS_BITRATE), '-f', 'ogg', 'pipe:1');
  } else {
    args.push('-c:a', 'libmp3lame', '-b:a', String(MP3_BITRATE), '-f', 'mp3', 'pipe:1');
  }

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  currentFfmpeg = ff;
  ffmpegRestarting = false;

  // attach mixer output to ffmpeg.stdin
  mixer.setOutput(ff.stdin);

  ff.stdout.on('data', (chunk) => {
    // push encoded bytes to broadcast
    encodedBroadcast.write(chunk);
    // lightweight dot logger to show live activity in console
    process.stdout.write('.');
  });

  ff.stderr.on('data', (chunk) => {
    // useful to debug ffmpeg failures
    process.stderr.write(chunk.toString());
  });

  ff.on('exit', (code, signal) => {
    console.warn(`ffmpeg exited code=${code} signal=${signal} — restart in 800ms`);
    try { mixer.setOutput(null); } catch (e) {}
    setTimeout(() => startFfmpeg(), 800);
  });

  ff.on('error', (err) => {
    console.error('ffmpeg spawn error', err);
    try { mixer.setOutput(null); } catch (e) {}
    setTimeout(() => startFfmpeg(), 2000);
  });

  console.log('ffmpeg lancé, pid=', ff.pid);
}

startFfmpeg(); // start immediately

// --- Express HTTP server ---
const app = express();
app.use(express.static('public'));

app.get('/stream', (req, res) => {
  const contentType = (OUT_FORMAT === 'opus') ? 'audio/ogg' : 'audio/mpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // make sure headers are flushed immediately
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // small kick: write a tiny chunk to prompt some clients/proxies to start
  try {
    const kick = Buffer.alloc(32, 0);
    res.write(kick);
  } catch (e) {}

  console.log('Client connecté au stream:', req.ip);

  const clientStream = new PassThrough();
  encodedBroadcast.pipe(clientStream);
  clientStream.pipe(res);

  req.on('close', () => {
    try {
      encodedBroadcast.unpipe(clientStream);
      clientStream.end();
    } catch (e) {}
    console.log('Client déconnecté du stream:', req.ip);
  });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

app.listen(PORT, () => console.log(`HTTP running on http://localhost:${PORT}`));

// --- Discord bot: receive Opus per user and feed mixer --- 
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let voiceConnection = null;

async function joinVoice(guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('guild not cached');
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) throw new Error('voice channel not found');

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  voiceConnection = connection;
  console.log('Voice connection ready');

  const receiver = connection.receiver;

  receiver.speaking.on('start', (userId) => {
    try {
      console.log('start speaking', userId);
      mixer.addSource(userId);

      // subscribe returns Opus stream
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 }
      });

      // decode Opus -> PCM s16le 48k stereo
      const decoder = new prism.opus.Decoder({ frameSize: 960, channels: CHANNELS, rate: SAMPLE_RATE });

      opusStream.pipe(decoder);

      decoder.on('data', (chunk) => {
        // chunk = PCM s16le -> feed the mixer
        mixer.pushToSource(userId, chunk);
      });

      const cleanup = () => {
        try { opusStream.destroy(); } catch (e) {}
        try { decoder.destroy(); } catch (e) {}
        mixer.removeSource(userId);
        console.log('cleanup done for', userId);
      };

      opusStream.on('end', cleanup);
      opusStream.on('error', (e) => { console.warn('opusStream err', e); cleanup(); });
      decoder.on('error', (e) => { console.warn('decoder err', e); cleanup(); });

    } catch (err) {
      console.error('subscribe error', err);
    }
  });

  receiver.speaking.on('end', (userId) => {
    console.log('speaking end', userId);
  });

  connection.on('stateChange', (oldS, newS) => {
    console.log('voice state:', oldS.status, '->', newS.status);
    if (newS.status === VoiceConnectionStatus.Destroyed) {
      mixer.stop();
    }
  });

  return connection;
}

client.once(Events.ClientReady, async () => {
  console.log('Discord bot connecté en tant que', client.user.tag);
  if (GUILD_ID && VOICE_CHANNEL_ID) {
    try {
      await joinVoice(GUILD_ID, VOICE_CHANNEL_ID);
      console.log('Auto-join effectué.');
    } catch (e) {
      console.error('Auto-join error', e);
    }
  } else {
    console.log('GUILD_ID / VOICE_CHANNEL_ID non fournis; utilise !joinVoice <guildId> <channelId>.');
  }
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  const content = (msg.content || '').trim();
  if (content.startsWith('!joinVoice')) {
    const parts = content.split(/\s+/);
    const guildId = parts[1] || msg.guildId;
    const channelId = parts[2];
    if (!guildId || !channelId) { msg.reply('Usage: !joinVoice <guildId> <voiceChannelId>'); return; }
    try {
      await joinVoice(guildId, channelId);
      msg.reply('Rejoint le salon vocal ✅');
    } catch (e) {
      console.error(e);
      msg.reply('Erreur en rejoignant le salon — check logs.');
    }
  }
  if (content === '!leaveVoice') {
    if (voiceConnection) {
      voiceConnection.destroy();
      voiceConnection = null;
      msg.reply('Déconnecté du salon vocal ✅');
    } else {
      msg.reply('Je ne suis pas connecté.');
    }
  }
});

client.login(BOT_TOKEN).catch(err => console.error('login error', err));

// graceful shutdown
function shutdown() {
  console.log('shutdown');
  try { if (voiceConnection) voiceConnection.destroy(); } catch(e){}
  try { if (currentFfmpeg && !currentFfmpeg.killed) { currentFfmpeg.stdin.end(); currentFfmpeg.kill('SIGTERM'); } } catch(e){}
  try { encodedBroadcast.end(); } catch(e){}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
