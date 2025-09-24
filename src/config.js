require('dotenv').config();

function parseInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const outputFormat = (process.env.OUT_FORMAT || 'opus').toLowerCase();

const config = {
  botToken: process.env.BOT_TOKEN,
  guildId: process.env.GUILD_ID,
  voiceChannelId: process.env.VOICE_CHANNEL_ID,
  port: parseInteger(process.env.PORT, 3000),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  outputFormat,
  opusBitrate: process.env.OPUS_BITRATE || '64000',
  mp3Bitrate: process.env.MP3_BITRATE || '96000',
  mixFrameMs: parseInteger(process.env.MIX_FRAME_MS, 20),
  streamEndpoint: '/stream',
  headerBufferMaxBytes: parseInteger(process.env.HEADER_BUFFER_MAX_BYTES, 64 * 1024),
  keepAliveInterval: 20000,
  audio: {
    sampleRate: 48000,
    channels: 2,
    bytesPerSample: 2,
  },
  mimeTypes: {
    opus: 'audio/ogg',
    mp3: 'audio/mpeg',
  },
};

config.audio.frameSamples = Math.floor(
  config.audio.sampleRate * (config.mixFrameMs / 1000)
);
config.audio.frameBytes =
  config.audio.frameSamples * config.audio.channels * config.audio.bytesPerSample;

if (!config.botToken) {
  console.error('BOT_TOKEN is required in the environment');
  process.exit(1);
}

module.exports = config;
