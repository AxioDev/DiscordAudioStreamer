// server.js (VERSION AVEC HEADER BUFFER POUR NOUVELLES CONNEXIONS)
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
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
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

// Broadcast encodé
const encodedBroadcast = new PassThrough(); // ffmpeg.stdout -> encodedBroadcast -> clients

// Header buffer : on conserve les premiers octets émis par ffmpeg (utile pour nouvelles connexions)
let headerBuffer = Buffer.alloc(0);
const HEADER_BUFFER_MAX = 256 * 1024; // conserve jusqu'à 256 KB d'init (ajuste si besoin)

// mixer et ffmpeg management (identique logique que précédemment)
class Mixer {
  constructor(frameBytes) {
    this.frameBytes = frameBytes;
    this.sources = new Map();
    this.timer = null;
    this.output = null;
    this.running = false;
  }
  setOutput(writable) { this.output = writable; }
  addSource(id) { if (!this.sources.has(id)) this.sources.set(id, { buffer: Buffer.alloc(0) }); }
  removeSource(id) { this.sources.delete(id); }
  pushToSource(id, chunk) {
    const entry = this.sources.get(id); if (!entry) return;
    entry.buffer = Buffer.concat([entry.buffer, chunk]);
    const maxCap = this.frameBytes * 200;
    if (entry.buffer.length > maxCap) entry.buffer = entry.buffer.slice(entry.buffer.length - maxCap);
  }
  readFrameForSource(id) {
    const entry = this.sources.get(id);
    if (!entry) return Buffer.alloc(this.frameBytes);
    if (entry.buffer.length >= this.frameBytes) {
      const f = entry.buffer.slice(0, this.frameBytes);
      entry.buffer = entry.buffer.slice(this.frameBytes);
      return f;
    }
    return Buffer.alloc(this.frameBytes);
  }
  start() {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      const ids = Array.from(this.sources.keys()), n = ids.length;
      if (n === 0) {
        const silence = Buffer.alloc(this.frameBytes);
        if (this.output && this.output.writable) this.output.write(silence);
        return;
      }
      const sampleCount = this.frameBytes / BYTES_PER_SAMPLE;
      const mixedFloat = new Float32Array(sampleCount);
      for (let i=0;i<sampleCount;i++) mixedFloat[i]=0.0;
      for (const id of ids) {
        const frameBuf = this.readFrameForSource(id);
        for (let i=0;i<sampleCount;i++) {
          const s = frameBuf.readInt16LE(i*2);
          mixedFloat[i] += s/32768.0;
        }
      }
      for (let i=0;i<sampleCount;i++) mixedFloat[i] = mixedFloat[i] / n;
      const out = Buffer.alloc(this.frameBytes);
      for (let i=0;i<sampleCount;i++) {
        let v = Math.max(-1, Math.min(1, mixedFloat[i]));
        out.writeInt16LE(Math.round(v*32767), i*2);
      }
      if (this.output && this.output.writable) this.output.write(out);
    }, MIX_FRAME_MS);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.running=false; }
}

const mixer = new Mixer(FRAME_BYTES);
mixer.start();

let currentFfmpeg = null;
let ffmpegRestarting = false;

function startFfmpeg() {
  if (ffmpegRestarting) return;
  ffmpegRestarting = true;
  console.log('Démarrage ffmpeg format=', OUT_FORMAT);
  const args = ['-f','s16le','-ar',String(SAMPLE_RATE),'-ac',String(CHANNELS),'-i','pipe:0','-loglevel','info'];
  if (OUT_FORMAT === 'opus') args.push('-c:a','libopus','-b:a',String(OPUS_BITRATE),'-f','ogg','pipe:1');
  else args.push('-c:a','libmp3lame','-b:a',String(MP3_BITRATE),'-f','mp3','pipe:1');

  const ff = spawn(FFMPEG_PATH, args, { stdio: ['pipe','pipe','pipe'] });
  currentFfmpeg = ff;
  ffmpegRestarting = false;
  mixer.setOutput(ff.stdin);

  ff.stdout.on('data', (chunk) => {
    // accumulate header buffer until limit
    if (headerBuffer.length < HEADER_BUFFER_MAX) {
      const remain = HEADER_BUFFER_MAX - headerBuffer.length;
      const slice = chunk.slice(0, remain);
      headerBuffer = Buffer.concat([headerBuffer, slice]);
    }
    // push encoded chunk to broadcast
    encodedBroadcast.write(chunk);
    process.stdout.write('.'); // visual activity
  });

  ff.stderr.on('data', (d) => process.stderr.write(d.toString())); // ffmpeg log

  ff.on('exit', (code, sig) => {
    console.warn(`ffmpeg exited code=${code} sig=${sig} -> restart 800ms`);
    try { mixer.setOutput(null); } catch(e) {}
    setTimeout(startFfmpeg, 800);
  });

  ff.on('error', (err) => {
    console.error('ffmpeg error', err);
    try { mixer.setOutput(null); } catch(e) {}
    setTimeout(startFfmpeg, 2000);
  });

  console.log('ffmpeg pid=', ff.pid);
}
startFfmpeg();

// Express
const app = express();
app.use(express.static('public'));

app.get('/stream', (req, res) => {
  const contentType = (OUT_FORMAT === 'opus') ? 'audio/ogg' : 'audio/mpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // socket tweaks
  try { req.socket.setNoDelay(true); } catch(e){}
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  console.log('New client for /stream', req.ip, 'headerBuffer:', headerBuffer.length);

  // if we have a headerBuffer (init segment) send it first (important for clients)
  if (headerBuffer && headerBuffer.length > 0) {
    try {
      res.write(headerBuffer);
      // flush after writing the init header
      if (typeof res.flush === 'function') res.flush();
    } catch (e) {
      console.warn('Erreur écriture headerBuffer ->', e);
    }
  }

  const clientStream = new PassThrough();
  encodedBroadcast.pipe(clientStream);
  clientStream.pipe(res);

  req.on('close', () => {
    try { encodedBroadcast.unpipe(clientStream); clientStream.end(); } catch(e){}
    console.log('Client disconnected', req.ip);
  });
});

app.get('/status', (req, res) => {
  res.json({
    ffmpeg_pid: currentFfmpeg ? currentFfmpeg.pid : null,
    headerBufferBytes: headerBuffer.length,
    activeSources: Array.from(mixer.sources.keys()).length
  });
});

app.get('/', (req,res) => res.sendFile(__dirname + '/public/index.html'));
app.listen(PORT, () => console.log(`HTTP http://0.0.0.0:${PORT}`));

// Discord side (comme précédemment) : receive per-user opus and feed mixer
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let voiceConnection = null;

async function joinVoice(guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) throw new Error('guild not cached');
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) throw new Error('voice channel not found');

  const connection = joinVoiceChannel({
    channelId, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 15000);
  voiceConnection = connection;
  console.log('Voice ready');

  const receiver = connection.receiver;
  receiver.speaking.on('start', (userId) => {
    try {
      console.log('start speaking', userId);
      mixer.addSource(userId);
      const opusStream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 } });
      const decoder = new prism.opus.Decoder({ frameSize: 960, channels: CHANNELS, rate: SAMPLE_RATE });
      opusStream.pipe(decoder);
      decoder.on('data', (chunk) => mixer.pushToSource(userId, chunk));
      const cleanup = () => { try{ opusStream.destroy(); }catch{} try{ decoder.destroy(); }catch{} mixer.removeSource(userId); console.log('clean', userId); };
      opusStream.on('end', cleanup);
      opusStream.on('error', (e)=>{ console.warn('opusstream err', e); cleanup(); });
      decoder.on('error', (e)=>{ console.warn('decoder err', e); cleanup(); });
    } catch (err) { console.error('subscribe err', err); }
  });

  receiver.speaking.on('end', (userId) => console.log('speaking end', userId));
  connection.on('stateChange', (o,n) => { console.log('voice state', o.status,'->', n.status); });
  return connection;
}

client.once(Events.ClientReady, async () => {
  console.log('Discord bot logged as', client.user.tag);
  if (GUILD_ID && VOICE_CHANNEL_ID) {
    try { await joinVoice(GUILD_ID, VOICE_CHANNEL_ID); console.log('Auto-join ok'); }
    catch(e){ console.error('auto join err', e); }
  } else console.log('No GUILD_ID/VOICE_CHANNEL_ID set, use !joinVoice');
});

client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  const content = (msg.content || '').trim();
  if (content.startsWith('!joinVoice')) {
    const parts = content.split(/\s+/);
    const guildId = parts[1] || msg.guildId; const channelId = parts[2];
    if (!guildId || !channelId) { msg.reply('Usage: !joinVoice <guildId> <voiceChannelId>'); return; }
    try { await joinVoice(guildId, channelId); msg.reply('Joined ✅'); } catch(e){ msg.reply('Erreur join'); console.error(e); }
  }
  if (content === '!leaveVoice') {
    if (voiceConnection) { voiceConnection.destroy(); voiceConnection = null; msg.reply('Left ✅'); }
    else msg.reply("Je suis pas connecté");
  }
});

client.login(BOT_TOKEN).catch(err => console.error('login err', err));

function shutdown(){ try{ if (voiceConnection) voiceConnection.destroy(); }catch{} try{ if (currentFfmpeg && !currentFfmpeg.killed){ currentFfmpeg.stdin.end(); currentFfmpeg.kill('SIGTERM'); } }catch{} try{ encodedBroadcast.end(); }catch{} process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
