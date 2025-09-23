// server.js
const fs = require('fs');
const { PassThrough } = require('stream');
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js-selfbot-v13');
const {
  joinVoiceChannel,
  EndBehaviorType,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { spawn } = require('child_process');

const BOT_TOKEN = process.env.BOT_TOKEN || 'TON_TOKEN_ICI'; // mieux via env
const GUILD_ID = process.env.GUILD_ID || 'ID_GUILD';
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID || 'ID_VOICE_CHANNEL';

const app = express();
const PORT = 3000;

// Broadcast stream that servira les clients HTTP
const mp3Broadcast = new PassThrough();

// Lance ffmpeg : lit du PCM (s16le 48k stereo) sur stdin, sort du MP3 sur stdout
function startFfmpeg() {
  const ff = spawn('ffmpeg', [
    '-f', 's16le',       // format d'entrée: PCM signed 16-bit little endian
    '-ar', '48000',      // sample rate
    '-ac', '2',          // channels
    '-i', 'pipe:0',      // lire depuis stdin
    '-f', 'mp3',         // encoder en mp3 (navigateur)
    '-b:a', '96k',       // bitrate audio
    'pipe:1',            // écrire sur stdout
  ], { stdio: ['pipe', 'pipe', 'inherit'] });

  ff.stdout.pipe(mp3Broadcast, { end: false });

  ff.on('exit', (code, sig) => {
    console.log('ffmpeg exited', code, sig);
  });

  return ff;
}

const ffmpeg = startFfmpeg();

// Endpoint audio (clients HTML)
app.get('/stream.mp3', (req, res) => {
  res.set({
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  // Créer un PassThrough de sortie pour chaque client pour pouvoir unpipe proprement
  const clientStream = new PassThrough();
  mp3Broadcast.pipe(clientStream);
  clientStream.pipe(res);

  req.on('close', () => {
    mp3Broadcast.unpipe(clientStream);
    clientStream.end();
  });
});

app.get('/', (req, res) => {
  res.send(`<html><body>
    <h3>Live Discord → HTML5 audio</h3>
    <audio controls autoplay src="/stream.mp3"></audio>
    <p>Si rien ne passe : vérifie que le bot est dans le voice channel et que quelqu'un parle.</p>
  </body></html>`);
});

app.listen(PORT, () => console.log(`HTTP server sur http://localhost:${PORT}`));

// --- Discord bot ---
const client = new Client({ });

client.once('ready', () => {
  console.log('Bot connecté:', client.user.tag);

  // Joins le salon
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return console.error('Guild non trouvée');
  const channel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!channel || !channel.isVoiceBased()) return console.error('Voice channel non trouvé');

  const connection = joinVoiceChannel({
    channelId: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false, // important : pas de self-deaf sinon on ne reçoit rien
  });

  connection.on(VoiceConnectionStatus.Ready, () => {
    console.log('Connexion voice prête. On peut écouter le channel.');
  });

  // Quand un user commence à parler, on s'abonne et on pipe sa voix vers ffmpeg
  const receiver = connection.receiver;
  // event 'start' pour détecter prise de parole
  receiver.speaking.on('start', (userId) => {
    try {
      console.log('Start speaking:', userId);
      // subscription: flux Opus
      const opusStream = receiver.subscribe(userId, {
        end: { behavior: EndBehaviorType.AfterSilence, duration: 800 }
      });

      // decode Opus -> PCM s16le 48k stereo
      const decoder = new prism.opus.Decoder({ channels: 2, rate: 48000, frameSize: 960 });

      // pipe décodé vers ffmpeg stdin
      opusStream.pipe(decoder).pipe(ffmpeg.stdin, { end: false });

      opusStream.on('end', () => {
        console.log('Flux opus ended for', userId);
      });
    } catch (err) {
      console.error('Erreur subscription', err);
    }
  });

});

client.login(BOT_TOKEN);
