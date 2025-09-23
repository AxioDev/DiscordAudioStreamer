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

// Validate
if (!BOT_TOKEN) {
  console.error('BOT_TOKEN manquant dans .env');
  process.exit(1);
}

// PCM params
const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // s16le
const FRAME_SAMPLES = Math.floor(SAMPLE_RATE * (MIX_FRAME_MS / 1000)); // ex: 960 for 20ms
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * BYTES_PER_SAMPLE; // bytes per mix frame

console.log(`Config: ${FRAME_SAMPLES} samples/frame (${MIX_FRAME_MS}ms), ${FRAME_BYTES} bytes/frame`);

// Broadcast stream (flux encodé sortie ffmpeg)
const encodedBroadcast = new PassThrough();

// start ffmpeg (Opus in Ogg or MP3)
let ffmpeg = null;
function startFfmpeg() {
  console.log('Lancement ffmpeg, format:', OUT_FORMAT);
  const args = [];

  // input: raw PCM s16le 48k stereo from stdin
  args.push('-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0');

  if (OUT_FORMAT === 'opus') {
    // output Ogg (Opus)
    args.push('-c:a', 'libopus', '-b:a', String(OPUS_BITRATE), '-f', 'ogg', 'pipe:1');
  } else {
    // mp3 fallback
    args.push('-c:a', 'libmp3lame', '-b:a', String(MP3_BITRATE), '-f', 'mp3', 'pipe:1');
  }

  ffmpeg = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'inherit'] });

  ffmpeg.stdout.on('data', (chunk) => encodedBroadcast.write(chunk));
  ffmpeg.on('exit', (code, sig) => {
    console.warn('ffmpeg exited', code, sig, ' -> restart in 1s');
    setTimeout(startFfmpeg, 1000);
  });
  ffmpeg.on('error', (err) => console.error('ffmpeg error', err));
}
startFfmpeg();

// Express server
const app = express();
app.use(express.static('public'));

// two endpoints: one for opus (ogg) and one for mp3 fallback
app.get('/stream', (req, res) => {
  if (OUT_FORMAT === 'opus') {
    res.set({
      'Content-Type': 'audio/ogg',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
  } else {
    res.set({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
  }

  const clientStream = new PassThrough();
  encodedBroadcast.pipe(clientStream);
  clientStream.pipe(res);

  req.on('close', () => {
    try {
      encodedBroadcast.unpipe(clientStream);
      clientStream.end();
    } catch (e) {}
  });
});

app.get('/', (req, res) => res.sendFile(__dirname + '/public/index.html'));

app.listen(PORT, () => console.log(`HTTP server: http://localhost:${PORT}`));

// --- Mixer implementation ---
class Mixer {
  constructor(frameBytes) {
    this.frameBytes = frameBytes;
    this.sources = new Map(); // userId => { buffer: Buffer }
    this.timer = null;
    this.running = false;
  }

  addSource(id) {
    if (!this.sources.has(id)) {
      this.sources.set(id, { buffer: Buffer.alloc(0) });
    }
  }

  removeSource(id) {
    this.sources.delete(id);
  }

  pushToSource(id, chunk) {
    const entry = this.sources.get(id);
    if (!entry) return;
    // append chunk
    entry.buffer = Buffer.concat([entry.buffer, chunk]);
    // keep buffer size reasonable (avoid memory leak) - cap at e.g. 5 frames
    const maxCap = this.frameBytes * 50;
    if (entry.buffer.length > maxCap) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - maxCap);
    }
  }

  readFrameForSource(id) {
    const entry = this.sources.get(id);
    if (!entry) return null;
    if (entry.buffer.length >= this.frameBytes) {
      const frame = entry.buffer.slice(0, this.frameBytes);
      entry.buffer = entry.buffer.slice(this.frameBytes);
      return frame;
    }
    // not enough data -> return silence of frameBytes
    return Buffer.alloc(this.frameBytes);
  }

  start(outputWritable) {
    if (this.running) return;
    this.running = true;
    // mix every frame interval
    this.timer = setInterval(() => {
      const activeIds = Array.from(this.sources.keys());
      const n = activeIds.length;

      // if no sources, write silence
      if (n === 0) {
        const silence = Buffer.alloc(this.frameBytes);
        if (outputWritable && outputWritable.writable) outputWritable.write(silence);
        return;
      }

      // accumulate as floats
      // We'll convert each source frame to float [-1,1], sum, then divide by n (simple normalize)
      const sampleCount = this.frameBytes / BYTES_PER_SAMPLE; // interleaved samples (L,R,L,R,...)
      const mixedFloat = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) mixedFloat[i] = 0.0;

      for (const id of activeIds) {
        const frameBuf = this.readFrameForSource(id);
        // interpret as Int16LE samples
        for (let i = 0; i < sampleCount; i++) {
          const s = frameBuf.readInt16LE(i * 2);
          mixedFloat[i] += s / 32768.0; // to [-1,1]
        }
      }

      // average (simple normalization)
      for (let i = 0; i < sampleCount; i++) mixedFloat[i] = mixedFloat[i] / n;

      // convert back to Int16LE buffer
      const outBuf = Buffer.alloc(this.frameBytes);
      for (let i = 0; i < sampleCount; i++) {
        // clamp
        let v = Math.max(-1, Math.min(1, mixedFloat[i]));
        // scale
        const int = Math.round(v * 32767);
        outBuf.writeInt16LE(int, i * 2);
      }

      // write to ffmpeg stdin (PCM)
      if (outputWritable && outputWritable.writable) {
        const ok = outputWritable.write(outBuf);
        if (!ok) {
          // if backpressure, could log or handle. We'll rely on Node stream backpressure.
        }
      }
    }, MIX_FRAME_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }
}

// initialize mixer
const mixer = new Mixer(FRAME_BYTES);
mixer.start(ffmpeg.stdin);

// --- Discord bot receive & wiring to mixer ---
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
    selfDeaf: false,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  voiceConnection = connection;

  const receiver = connection.receiver;
  // when user starts speaking
  receiver.speaking.on('start', (userId) => {
    try {
      console.log('start speaking', userId);
      mixer.addSource(userId);

      // subscribe to opus stream for user
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
      });

      // decode opus -> PCM s16le 48k stereo
      const decoder = new prism.opus.Decoder({ frameSize: 960, channels: CHANNELS, rate: SAMPLE_RATE });

      opusStream.pipe(decoder);

      decoder.on('data', (chunk) => {
        // chunk are PCM s16le. push into mixer source buffer
        mixer.pushToSource(userId, chunk);
      });

      const cleanup = () => {
        try {
          opusStream.destroy();
        } catch (e) {}
        try {
          decoder.destroy();
        } catch (e) {}
        mixer.removeSource(userId);
        console.log('cleaned up', userId);
      };

      opusStream.on('end', cleanup);
      opusStream.on('error', (e) => {
        console.warn('opusStream error', e);
        cleanup();
      });
      decoder.on('error', (e) => {
        console.warn('decoder error', e);
        cleanup();
      });

    } catch (err) {
      console.error('subscribe error', err);
    }
  });

  receiver.speaking.on('end', (userId) => {
    // speaking end may fire; we still rely on opusStream end events and silence end behavior
    console.log('speaking end', userId);
  });

  connection.on('stateChange', (oldS, newS) => {
    console.log('voice state:', oldS.status, '->', newS.status);
    if (newS.status === VoiceConnectionStatus.Destroyed) {
      mixer.stop();
    }
  });

  console.log('joined voice');
  return connection;
}

client.once(Events.ClientReady, async () => {
  console.log('Connecté en tant que', client.user.tag);
  if (GUILD_ID && VOICE_CHANNEL_ID) {
    try {
      await joinVoice(GUILD_ID, VOICE_CHANNEL_ID);
    } catch (e) { console.error('auto join error', e); }
  } else {
    console.log('Aucun GUILD_ID/VOICE_CHANNEL_ID fourni (oups). Utilise !joinVoice en chat.');
  }
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  const content = msg.content.trim();
  if (content.startsWith('!joinVoice')) {
    const parts = content.split(/\s+/);
    const guildId = parts[1] || msg.guildId;
    const channelId = parts[2];
    if (!guildId || !channelId) {
      msg.reply('Usage: !joinVoice <guildId> <voiceChannelId>');
      return;
    }
    try {
      await joinVoice(guildId, channelId);
      msg.reply('Rejoint le salon vocal ✅');
    } catch (e) {
      console.error(e);
      msg.reply('Erreur join: check logs.');
    }
  }
  if (content === '!leaveVoice') {
    if (voiceConnection) {
      voiceConnection.destroy();
      voiceConnection = null;
      msg.reply('Déconnecté.');
    } else {
      msg.reply('Je suis pas connecté.');
    }
  }
});

client.login(BOT_TOKEN).catch(err => console.error('login error', err));

// clean
function shutdown() {
  console.log('shutdown');
  try { if (voiceConnection) voiceConnection.destroy(); } catch(e){}
  try { if (ffmpeg && !ffmpeg.killed) { ffmpeg.stdin.end(); ffmpeg.kill('SIGTERM'); } } catch(e){}
  try { encodedBroadcast.end(); } catch(e){}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
