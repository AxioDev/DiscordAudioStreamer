import path from 'path';
import type { Pool } from 'pg';
import config, { type Config } from './config';
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
import BlogModerationService from './services/BlogModerationService';
import KaldiTranscriptionService from './services/KaldiTranscriptionService';
import UserPersonaService from './services/UserPersonaService';
import AdminService from './services/AdminService';
import StatisticsService from './services/StatisticsService';
import UserAudioRecorder from './services/UserAudioRecorder';
import AudioStreamHealthService from './services/AudioStreamHealthService';
import DiscordVectorIngestionService from './services/DiscordVectorIngestionService';
import UserDataRetentionService from './services/UserDataRetentionService';
import { getDatabasePool } from './lib/db';
import LoggerService from './lib/logger';

interface ServiceContext {
  container: ServiceContainer;
  resolve<T>(key: string): T;
  registerShutdown(handler: ShutdownHandler): void;
}

type ShutdownHandler = () => Promise<void> | void;

type ServiceFactory<T> = (context: ServiceContext) => T;

type ServiceLifecycle<T> = {
  start?: (service: T, context: ServiceContext) => Promise<void> | void;
  stop?: (service: T, context: ServiceContext) => Promise<void> | void;
};

interface ServiceDefinition<T> extends ServiceLifecycle<T> {
  factory: ServiceFactory<T>;
  eager?: boolean;
}

class ServiceContainer {
  private readonly definitions = new Map<string, ServiceDefinition<unknown>>();

  private readonly instances = new Map<string, unknown>();

  private readonly registrationOrder: string[] = [];

  private readonly startPromises = new Map<string, Promise<void>>();

  private readonly shutdownHandlers: ShutdownHandler[] = [];

  private readonly overrides = new Map<string, unknown>();

  private shutdownPromise: Promise<void> | null = null;

  public register<T>(key: string, definition: ServiceDefinition<T>): void {
    if (this.definitions.has(key)) {
      throw new Error(`Service "${key}" is already registered.`);
    }
    this.definitions.set(key, definition as ServiceDefinition<unknown>);
    this.registrationOrder.push(key);
  }

  public setOverride<T>(key: string, instance: T): void {
    this.overrides.set(key, instance);
  }

  public resolve<T>(key: string): T {
    if (this.overrides.has(key)) {
      return this.overrides.get(key) as T;
    }

    const definition = this.definitions.get(key);
    if (!definition) {
      throw new Error(`Service "${key}" is not registered.`);
    }

    if (!this.instances.has(key)) {
      const context = this.createContext();
      const instance = (definition.factory as ServiceFactory<T>)(context);
      this.instances.set(key, instance);

      if (definition.stop) {
        this.registerShutdown(async () => {
          try {
            await definition.stop!(instance, this.createContext());
          } catch (error) {
            console.error(`Error while stopping service "${key}"`, error);
          }
        });
      }
    }

    return this.instances.get(key) as T;
  }

  public async start(): Promise<void> {
    for (const key of this.registrationOrder) {
      const definition = this.definitions.get(key);
      if (definition?.eager) {
        await this.ensureStarted(key, definition);
      }
    }
  }

  public registerShutdown(handler: ShutdownHandler): void {
    this.shutdownHandlers.push(handler);
  }

  public async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = (async () => {
      for (const handler of [...this.shutdownHandlers].reverse()) {
        try {
          await handler();
        } catch (error) {
          console.error('Shutdown handler failed', error);
        }
      }
    })();

    return this.shutdownPromise;
  }

  private async ensureStarted(key: string, definition: ServiceDefinition<unknown>): Promise<void> {
    if (this.startPromises.has(key)) {
      await this.startPromises.get(key);
      return;
    }

    const instance = this.resolve<unknown>(key);
    if (!definition.start) {
      this.startPromises.set(key, Promise.resolve());
      return;
    }

    const startPromise = Promise.resolve(definition.start(instance, this.createContext()));
    this.startPromises.set(key, startPromise);
    await startPromise;
  }

  private createContext(): ServiceContext {
    return {
      container: this,
      resolve: <T>(serviceKey: string) => this.resolve<T>(serviceKey),
      registerShutdown: (handler: ShutdownHandler) => this.registerShutdown(handler),
    };
  }
}

function registerServices(container: ServiceContainer): void {
  container.register<Config>('config', {
    factory: () => config,
  });

  container.register<LoggerService>('logger', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      return new LoggerService({
        level: cfg.logging.level,
        defaultMeta: { service: 'DiscordAudioStreamer' },
      });
    },
    start: (logger) => {
      logger.bindToConsole();
      const log = logger.forContext('Bootstrap');
      log.info('Logger initialized at level %s', logger.getLevel());
    },
    stop: (logger) => {
      logger.close();
    },
    eager: true,
  });

  container.register<Pool | null>('databasePool', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      if (!cfg.database.url) {
        return null;
      }
      return getDatabasePool();
    },
    stop: async (pool) => {
      if (pool) {
        await pool.end().catch((error: unknown) => {
          console.error('Failed to close database pool', error);
        });
      }
    },
  });

  container.register<AudioMixer>('audioMixer', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      return new AudioMixer({
        frameBytes: cfg.audio.frameBytes,
        mixFrameMs: cfg.mixFrameMs,
        bytesPerSample: cfg.audio.bytesPerSample,
      });
    },
    start: (mixer) => {
      mixer.start();
    },
    stop: (mixer) => {
      mixer.stop();
    },
    eager: true,
  });

  container.register<FfmpegTranscoder>('transcoder', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      return new FfmpegTranscoder({
        ffmpegPath: cfg.ffmpegPath,
        outputFormat: cfg.outputFormat,
        opusBitrate: cfg.opusBitrate,
        mp3Bitrate: cfg.mp3Bitrate,
        sampleRate: cfg.audio.sampleRate,
        channels: cfg.audio.channels,
        headerBufferMaxBytes: cfg.headerBufferMaxBytes,
        mixFrameMs: cfg.mixFrameMs,
      });
    },
    start: (transcoder, ctx) => {
      const mixer = ctx.resolve<AudioMixer>('audioMixer');
      transcoder.start(mixer);
    },
    stop: (transcoder) => {
      transcoder.stop();
    },
    eager: true,
  });

  container.register<SseService>('sseService', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      return new SseService({
        streamInfoProvider: () => ({
          format: cfg.outputFormat,
          path: cfg.streamEndpoint,
          mimeType: cfg.mimeTypes[cfg.outputFormat] || 'application/octet-stream',
        }),
        keepAliveInterval: cfg.keepAliveInterval,
      });
    },
    stop: (sse) => {
      sse.closeAll();
    },
    eager: true,
  });

  container.register<ListenerStatsService>('listenerStatsService', {
    factory: () => new ListenerStatsService(),
    stop: (service) => {
      service.stop();
    },
    eager: true,
  });

  container.register<BlogModerationService>('blogModerationService', {
    factory: () => new BlogModerationService(),
  });

  container.register<BlogRepository | null>('blogRepository', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const pool = ctx.resolve<Pool | null>('databasePool') ?? undefined;
      if (!cfg.database.url) {
        return null;
      }
      return new BlogRepository({
        url: cfg.database.url,
        ssl: cfg.database.ssl,
        debug: cfg.database.logQueries,
        pool,
      });
    },
    stop: async (repository) => {
      if (repository) {
        await repository.close().catch((error: unknown) => {
          console.error('Failed to close blog repository', error);
        });
      }
    },
  });

  container.register<BlogService>('blogService', {
    factory: (ctx) => {
      const repository = ctx.resolve<BlogRepository | null>('blogRepository');
      const moderation = ctx.resolve<BlogModerationService>('blogModerationService');
      return new BlogService({
        repository: repository ?? null,
        moderationService: moderation,
      });
    },
    start: async (service, ctx) => {
      try {
        await service.initialize();
      } catch (error) {
        const logger = ctx.resolve<LoggerService>('logger').forContext('BlogService');
        logger.error('BlogService initialization failed', error);
      }
    },
    eager: true,
  });

  container.register<BlogSubmissionService>('blogSubmissionService', {
    factory: (ctx) => {
      const repository = ctx.resolve<BlogRepository | null>('blogRepository');
      const blogService = ctx.resolve<BlogService>('blogService');
      const moderation = ctx.resolve<BlogModerationService>('blogModerationService');
      return new BlogSubmissionService({
        repository: repository ?? null,
        blogService,
        moderationService: moderation,
      });
    },
    start: async (service, ctx) => {
      try {
        await service.initialize();
      } catch (error) {
        const logger = ctx.resolve<LoggerService>('logger').forContext('BlogSubmissionService');
        logger.error('BlogSubmissionService initialization failed', error);
      }
    },
    eager: true,
  });

  container.register<ShopService>('shopService', {
    factory: (ctx) => new ShopService({ config: ctx.resolve<Config>('config') }),
  });

  container.register<VoiceActivityRepository>('voiceActivityRepository', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const pool = cfg.database.url ? ctx.resolve<Pool | null>('databasePool') ?? undefined : undefined;
      return new VoiceActivityRepository({
        url: cfg.database.url,
        ssl: cfg.database.ssl,
        debug: cfg.database.logQueries,
        pool,
      });
    },
    stop: async (repository) => {
      await repository.close().catch((error: unknown) => {
        console.error('Error while closing voice activity repository', error);
      });
    },
  });

  container.register<StatisticsService>('statisticsService', {
    factory: (ctx) =>
      new StatisticsService({
        repository: ctx.resolve<VoiceActivityRepository>('voiceActivityRepository'),
        config: ctx.resolve<Config>('config'),
      }),
  });

  container.register<UserAudioRecorder | null>('userAudioRecorder', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      if (cfg.recordingsRetentionDays <= 0) {
        return null;
      }

      try {
        return new UserAudioRecorder({
          baseDirectory: cfg.recordingsDirectory,
          sampleRate: cfg.audio.sampleRate,
          channels: cfg.audio.channels,
          bytesPerSample: cfg.audio.bytesPerSample,
          retentionPeriodMs: cfg.recordingsRetentionDays * 24 * 60 * 60 * 1000,
        });
      } catch (error) {
        const logger = ctx.resolve<LoggerService>('logger').forContext('UserAudioRecorder');
        logger.error('Failed to initialize user audio recorder', error);
        return null;
      }
    },
    stop: (recorder) => {
      recorder?.stop();
    },
  });

  container.register<KaldiTranscriptionService | null>('kaldiTranscriptionService', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const repository = ctx.resolve<VoiceActivityRepository>('voiceActivityRepository');
      if (!cfg.kaldi.enabled || !cfg.database.url) {
        if (cfg.kaldi.enabled && !cfg.database.url) {
          console.error(
            'Kaldi transcription service is enabled but no database is configured; disabling transcription.',
          );
        }
        return null;
      }

      return new KaldiTranscriptionService({
        host: cfg.kaldi.host,
        port: cfg.kaldi.port,
        sampleRate: cfg.kaldi.sampleRate,
        voiceActivityRepository: repository,
        inputSampleRate: cfg.audio.sampleRate,
        inputChannels: cfg.audio.channels,
      });
    },
  });

  container.register<SpeakerTracker>('speakerTracker', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const repository = ctx.resolve<VoiceActivityRepository>('voiceActivityRepository');
      return new SpeakerTracker({
        sseService: ctx.resolve<SseService>('sseService'),
        voiceActivityRepository: cfg.database.url ? repository : null,
      });
    },
  });

  container.register<DailyArticleService>('dailyArticleService', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const repository = ctx.resolve<VoiceActivityRepository>('voiceActivityRepository');
      return new DailyArticleService({
        config: cfg,
        blogRepository: ctx.resolve<BlogRepository | null>('blogRepository'),
        blogService: ctx.resolve<BlogService>('blogService'),
        voiceActivityRepository: cfg.database.url ? repository : null,
        moderationService: ctx.resolve<BlogModerationService>('blogModerationService'),
      });
    },
    stop: (service) => {
      service.stop();
    },
  });

  container.register<UserPersonaService>('userPersonaService', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const repository = ctx.resolve<VoiceActivityRepository>('voiceActivityRepository');
      return new UserPersonaService({
        config: cfg,
        voiceActivityRepository: cfg.database.url ? repository : null,
      });
    },
    stop: (service) => {
      service.stop();
    },
  });

  container.register<AdminService>('adminService', {
    factory: () =>
      new AdminService({
        storageDirectory: path.resolve(__dirname, '..', 'content', 'admin'),
      }),
    start: async (service, ctx) => {
      try {
        await service.initialize();
      } catch (error) {
        const logger = ctx.resolve<LoggerService>('logger').forContext('AdminService');
        logger.error('AdminService initialization failed', error);
      }
    },
    eager: true,
  });

  container.register<DiscordAudioBridge>('discordBridge', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const repository = ctx.resolve<VoiceActivityRepository>('voiceActivityRepository');
      return new DiscordAudioBridge({
        config: cfg,
        mixer: ctx.resolve<AudioMixer>('audioMixer'),
        speakerTracker: ctx.resolve<SpeakerTracker>('speakerTracker'),
        voiceActivityRepository: cfg.database.url ? repository : null,
        transcriptionService: ctx.resolve<KaldiTranscriptionService | null>('kaldiTranscriptionService'),
        audioRecorder: ctx.resolve<UserAudioRecorder | null>('userAudioRecorder'),
      });
    },
    start: async (bridge) => {
      await bridge.login();
    },
    stop: async (bridge) => {
      await bridge.destroy();
    },
    eager: true,
  });

  container.register<AnonymousSpeechManager>('anonymousSpeechManager', {
    factory: (ctx) =>
      new AnonymousSpeechManager({
        discordBridge: ctx.resolve<DiscordAudioBridge>('discordBridge'),
        sseService: ctx.resolve<SseService>('sseService'),
      }),
  });

  container.register<DiscordVectorIngestionService>('discordVectorIngestionService', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const repository = ctx.resolve<VoiceActivityRepository>('voiceActivityRepository');
      return new DiscordVectorIngestionService({
        blogService: ctx.resolve<BlogService>('blogService'),
        projectRoot: path.resolve(__dirname, '..'),
        shopService: ctx.resolve<ShopService>('shopService'),
        voiceActivityRepository: cfg.database.url ? repository : null,
      });
    },
    start: (service, ctx) => {
      try {
        service.startScheduledSynchronization();
      } catch (error) {
        const logger = ctx.resolve<LoggerService>('logger').forContext('DiscordVectorIngestionService');
        logger.error('Failed to start Discord vector ingestion schedule', error);
      }
    },
    stop: (service) => {
      service.stopScheduledSynchronization();
    },
    eager: true,
  });

  container.register<UserDataRetentionService>('userDataRetentionService', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      const repository = ctx.resolve<VoiceActivityRepository>('voiceActivityRepository');
      return new UserDataRetentionService({
        voiceActivityRepository: cfg.database.url ? repository : null,
      });
    },
    start: (service) => {
      service.start();
    },
    stop: (service) => {
      service.stop();
    },
    eager: true,
  });

  container.register<AudioStreamHealthService | null>('audioStreamHealthService', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      if (!cfg.streamHealth.enabled) {
        return null;
      }
      return new AudioStreamHealthService({
        transcoder: ctx.resolve<FfmpegTranscoder>('transcoder'),
        discordBridge: ctx.resolve<DiscordAudioBridge>('discordBridge'),
        guildId: cfg.guildId,
        voiceChannelId: cfg.voiceChannelId,
        checkIntervalMs: cfg.streamHealth.checkIntervalMs,
        maxSilenceMs: cfg.streamHealth.maxSilenceMs,
        restartCooldownMs: cfg.streamHealth.restartCooldownMs,
        streamRetryDelayMs: cfg.streamHealth.streamRetryDelayMs,
      });
    },
    start: (service) => {
      service?.start();
    },
    stop: (service) => {
      service?.stop();
    },
    eager: true,
  });

  container.register<AppServer>('appServer', {
    factory: (ctx) => {
      const cfg = ctx.resolve<Config>('config');
      return new AppServer({
        config: cfg,
        transcoder: ctx.resolve<FfmpegTranscoder>('transcoder'),
        listenerStatsService: ctx.resolve<ListenerStatsService>('listenerStatsService'),
      });
    },
    start: (server) => {
      server.start();
    },
    stop: (server) => {
      server.stop();
    },
    eager: true,
  });
}

async function bootstrap(): Promise<void> {
  const container = new ServiceContainer();
  registerServices(container);

  try {
    await container.start();
  } catch (error) {
    console.error('Failed to bootstrap application', error);
    await container.shutdown();
    process.exit(1);
  }

  const loggerService = container.resolve<LoggerService>('logger');
  const logger = loggerService.forContext('Bootstrap');
  logger.info('Application started on port %d', config.port);

  let shutdownInitiated = false;
  const initiateShutdown = (reason: string, exitCode = 0): void => {
    if (shutdownInitiated) {
      return;
    }
    shutdownInitiated = true;

    const shutdownLogger = loggerService.forContext('Shutdown');
    shutdownLogger.info('Shutting down due to %s', reason);

    container
      .shutdown()
      .then(() => {
        shutdownLogger.info('Shutdown complete');
        process.exit(exitCode);
      })
      .catch((shutdownError) => {
        shutdownLogger.error('Shutdown encountered an error', shutdownError);
        process.exit(1);
      });
  };

  process.once('SIGINT', () => initiateShutdown('SIGINT'));
  process.once('SIGTERM', () => initiateShutdown('SIGTERM'));
  process.once('beforeExit', () => initiateShutdown('beforeExit'));
}

void bootstrap();
