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
import BlogProposalService from './services/BlogProposalService';
import DailyArticleService from './services/DailyArticleService';
import KaldiTranscriptionService from './services/KaldiTranscriptionService';
import UserPersonaService from './services/UserPersonaService';
import AdminService from './services/AdminService';
import StatisticsService from './services/StatisticsService';

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
});

const statisticsService = new StatisticsService({
  repository: voiceActivityRepository,
  config,
});

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
  ? new BlogRepository({ url: config.database.url, ssl: config.database.ssl })
  : null;

const blogService = new BlogService({
  postsDirectory: path.resolve(__dirname, '..', 'content', 'blog'),
  repository: blogRepository,
});

void blogService.initialize().catch((error) => {
  console.error('BlogService initialization failed', error);
});

const blogProposalService = new BlogProposalService({
  proposalsDirectory: path.resolve(__dirname, '..', 'content', 'blog', 'proposals'),
  repository: blogRepository,
  blogService,
});

void blogProposalService.initialize().catch((error) => {
  console.error('BlogProposalService initialization failed', error);
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
  blogProposalService,
  dailyArticleService,
  adminService,
  statisticsService,
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
