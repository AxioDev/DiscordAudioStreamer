import path from 'path';
import config from './config';
import AudioMixer from './audio/AudioMixer';
import FfmpegTranscoder from './audio/FfmpegTranscoder';
import AppServer from './http/AppServer';
import SseService from './services/SseService';
import SpeakerTracker from './services/SpeakerTracker';
import DiscordAudioBridge from './discord/DiscordAudioBridge';
import AnonymousSpeechManager from './services/AnonymousSpeechManager';
import ShopService from './services/ShopService';
import VoiceActivityRepository from './services/VoiceActivityRepository';
import ListenerStatsService from './services/ListenerStatsService';
import BlogRepository from './services/BlogRepository';
import BlogService from './services/BlogService';
import BlogSubmissionService from './services/BlogSubmissionService';
import DailyArticleService from './services/DailyArticleService';
import KaldiTranscriptionService from './services/KaldiTranscriptionService';
import UserPersonaService from './services/UserPersonaService';
import AdminService from './services/AdminService';
import StatisticsService from './services/StatisticsService';
import UserAudioRecorder from './services/UserAudioRecorder';
import AudioStreamHealthService from './services/AudioStreamHealthService';

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

const listenerStatsService = new ListenerStatsService();

const voiceActivityRepository = new VoiceActivityRepository({
  url: config.database.url,
  ssl: config.database.ssl,
  debug: config.database.logQueries,
});

const statisticsService = new StatisticsService({
  repository: voiceActivityRepository,
  config,
});

let userAudioRecorder: UserAudioRecorder | null = null;

let audioStreamHealthService: AudioStreamHealthService | null = null;

try {
  userAudioRecorder = new UserAudioRecorder({
    baseDirectory: config.recordingsDirectory,
    sampleRate: config.audio.sampleRate,
    channels: config.audio.channels,
    bytesPerSample: config.audio.bytesPerSample,
    retentionPeriodMs: config.recordingsRetentionDays * 24 * 60 * 60 * 1000,
  });
} catch (error) {
  console.error('Failed to initialize user audio recorder', error);
}

const kaldiTranscriptionService =
  config.kaldi.enabled && Boolean(config.database.url)
    ? new KaldiTranscriptionService({
        host: config.kaldi.host,
        port: config.kaldi.port,
        sampleRate: config.kaldi.sampleRate,
        voiceActivityRepository,
        inputSampleRate: config.audio.sampleRate,
        inputChannels: config.audio.channels,
      })
    : null;

if (config.kaldi.enabled && !kaldiTranscriptionService) {
  console.warn('Kaldi transcription service is enabled but no database is configured; disabling transcription.');
}

const speakerTracker = new SpeakerTracker({
  sseService,
  voiceActivityRepository,
});

const blogRepository = config.database.url
  ? new BlogRepository({
      url: config.database.url,
      ssl: config.database.ssl,
      debug: config.database.logQueries,
    })
  : null;

const blogService = new BlogService({
  postsDirectory: path.resolve(__dirname, '..', 'content', 'blog'),
  repository: blogRepository,
});

void blogService.initialize().catch((error) => {
  console.error('BlogService initialization failed', error);
});

const blogSubmissionService = new BlogSubmissionService({
  repository: blogRepository,
  blogService,
});

void blogSubmissionService.initialize().catch((error) => {
  console.error('BlogSubmissionService initialization failed', error);
});

const dailyArticleService = new DailyArticleService({
  config,
  blogRepository,
  blogService,
  voiceActivityRepository,
});

const userPersonaService = new UserPersonaService({
  config,
  voiceActivityRepository,
});

const adminService = new AdminService({
  storageDirectory: path.resolve(__dirname, '..', 'content', 'admin'),
});

void adminService.initialize().catch((error) => {
  console.error('AdminService initialization failed', error);
});

const discordBridge = new DiscordAudioBridge({
  config,
  mixer,
  speakerTracker,
  voiceActivityRepository,
  transcriptionService: kaldiTranscriptionService,
  audioRecorder: userAudioRecorder,
});

discordBridge.login().catch((error) => {
  console.error('Discord login failed', error);
  process.exit(1);
});

const anonymousSpeechManager = new AnonymousSpeechManager({
  discordBridge,
  sseService,
});

const shopService = new ShopService({ config });

const appServer = new AppServer({
  config,
  transcoder,
  speakerTracker,
  sseService,
  anonymousSpeechManager,
  discordBridge,
  shopService,
  voiceActivityRepository,
  listenerStatsService,
  blogRepository,
  blogService,
  blogSubmissionService,
  dailyArticleService,
  adminService,
  statisticsService,
  userAudioRecorder,
});
appServer.start();

if (config.streamHealth.enabled) {
  audioStreamHealthService = new AudioStreamHealthService({
    transcoder,
    discordBridge,
    guildId: config.guildId,
    voiceChannelId: config.voiceChannelId,
    checkIntervalMs: config.streamHealth.checkIntervalMs,
    maxSilenceMs: config.streamHealth.maxSilenceMs,
    restartCooldownMs: config.streamHealth.restartCooldownMs,
    streamRetryDelayMs: config.streamHealth.streamRetryDelayMs,
  });
  audioStreamHealthService.start();
} else {
  console.log('Audio stream health monitoring disabled.');
}

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
    userAudioRecorder?.stop();
  } catch (error) {
    console.warn('Error while stopping user audio recorder', error);
  }

  try {
    audioStreamHealthService?.stop();
  } catch (error) {
    console.warn('Error while stopping audio stream health service', error);
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
    listenerStatsService.stop();
  } catch (error) {
    console.warn('Error while stopping listener stats service', error);
  }

  try {
    userPersonaService.stop();
  } catch (error) {
    console.warn('Error while stopping user persona service', error);
  }

  try {
    speakerTracker.clear();
  } catch (error) {
    console.warn('Error while clearing speaker tracker', error);
  }

  voiceActivityRepository
    .close()
    .catch((error) => console.warn('Error while closing voice activity repository', error));

  try {
    appServer.stop();
  } catch (error) {
    console.warn('Error while stopping HTTP server', error);
  }

  try {
    dailyArticleService.stop();
  } catch (error) {
    console.warn('Error while stopping daily article service', error);
  }

  discordBridge
    .destroy()
    .catch((error) => console.warn('Error while destroying Discord bridge', error))
    .finally(() => process.exit(0));
}

process.on('beforeExit', () => {
  if (typeof dailyArticleService?.stop === 'function') {
    dailyArticleService.stop();
  }
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
