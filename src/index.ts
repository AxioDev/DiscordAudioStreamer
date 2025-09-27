import config from './config';
import AudioMixer from './audio/AudioMixer';
import FfmpegTranscoder from './audio/FfmpegTranscoder';
import AppServer from './http/AppServer';
import SseService from './services/SseService';
import SpeakerTracker from './services/SpeakerTracker';
import DiscordAudioBridge from './discord/DiscordAudioBridge';
import AnonymousSpeechManager from './services/AnonymousSpeechManager';

const mixer = new AudioMixer({
  frameBytes: config.audio.frameBytes,
  mixFrameMs: config.mixFrameMs,
  bytesPerSample: config.audio.bytesPerSample,
});
mixer.start();

const transcoder = new FfmpegTranscoder({
  ffmpegPath: config.ffmpegPath,
  outputFormat: config.outputFormat,
  opusBitrate: config.opusBitrate,
  mp3Bitrate: config.mp3Bitrate,
  sampleRate: config.audio.sampleRate,
  channels: config.audio.channels,
  headerBufferMaxBytes: config.headerBufferMaxBytes,
  mixFrameMs: config.mixFrameMs,
});
transcoder.start(mixer);

const statsLogInterval: NodeJS.Timeout = setInterval(() => {
  const statsSnapshot = {
    ...mixer.getStats(),
    sources: mixer.getSourceCount(),
    ffmpegPid: transcoder.getCurrentProcessPid(),
  };

  console.log('MIX STATS:', statsSnapshot);
}, 5000);

if (typeof statsLogInterval.unref === 'function') {
  statsLogInterval.unref();
}

const sseService = new SseService({
  streamInfoProvider: () => ({
    format: config.outputFormat,
    path: config.streamEndpoint,
    mimeType: config.mimeTypes[config.outputFormat] || 'application/octet-stream',
  }),
  keepAliveInterval: config.keepAliveInterval,
});

const speakerTracker = new SpeakerTracker({ sseService });

const discordBridge = new DiscordAudioBridge({
  config,
  mixer,
  speakerTracker,
});

discordBridge.login().catch((error) => {
  console.error('Discord login failed', error);
  process.exit(1);
});

const anonymousSpeechManager = new AnonymousSpeechManager({
  discordBridge,
  sseService,
});

const appServer = new AppServer({
  config,
  transcoder,
  speakerTracker,
  sseService,
  anonymousSpeechManager,
});
appServer.start();

function shutdown(): void {
  console.log('Shutting down...');
  try {
    clearInterval(statsLogInterval);
  } catch (error) {
    console.warn('Error while clearing stats interval', error);
  }
  try {
    mixer.stop();
  } catch (error) {
    console.warn('Error while stopping mixer', error);
  }

  try {
    transcoder.stop();
  } catch (error) {
    console.warn('Error while stopping transcoder', error);
  }

  try {
    sseService.closeAll();
  } catch (error) {
    console.warn('Error while closing SSE connections', error);
  }

  try {
    speakerTracker.clear();
  } catch (error) {
    console.warn('Error while clearing speaker tracker', error);
  }

  try {
    appServer.stop();
  } catch (error) {
    console.warn('Error while stopping HTTP server', error);
  }

  discordBridge
    .destroy()
    .catch((error) => console.warn('Error while destroying Discord bridge', error))
    .finally(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
