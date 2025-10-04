import express, { type Request, type Response } from 'express';
import path from 'path';
import type { Server } from 'http';
import type FfmpegTranscoder from '../audio/FfmpegTranscoder';
import type SpeakerTracker from '../services/SpeakerTracker';
import type SseService from '../services/SseService';
import type AnonymousSpeechManager from '../services/AnonymousSpeechManager';
import type { Config } from '../config';
import { WebSocketServer } from 'ws';
import type DiscordAudioBridge from '../discord/DiscordAudioBridge';
import type ShopService from '../services/ShopService';
import { ShopError, type ShopProvider } from '../services/ShopService';
import type VoiceActivityRepository from '../services/VoiceActivityRepository';
import ListenerStatsService, { type ListenerStatsUpdate } from '../services/ListenerStatsService';
import BlogService, { type BlogListOptions } from '../services/BlogService';
import BlogRepository from '../services/BlogRepository';
import type {
  HypeLeaderboardQueryOptions,
  HypeLeaderboardSortBy,
  HypeLeaderboardSortOrder,
  UserMessageActivityEntry,
  UserVoiceActivitySegment,
  UserVoicePresenceSegment,
  VoiceTranscriptionCursor,
} from '../services/VoiceActivityRepository';
import HypeLeaderboardService, {
  type HypeLeaderboardResult,
  type NormalizedHypeLeaderboardQueryOptions,
} from '../services/HypeLeaderboardService';
import SeoRenderer, { type SeoPageMetadata } from './SeoRenderer';

export interface AppServerOptions {
  config: Config;
  transcoder: FfmpegTranscoder;
  speakerTracker: SpeakerTracker;
  sseService: SseService;
  anonymousSpeechManager: AnonymousSpeechManager;
  discordBridge: DiscordAudioBridge;
  shopService: ShopService;
  voiceActivityRepository?: VoiceActivityRepository | null;
  listenerStatsService: ListenerStatsService;
  blogRepository?: BlogRepository | null;
  blogService?: BlogService | null;
}

type FlushCapableResponse = Response & {
  flushHeaders?: () => void;
  flush?: () => void;
};

interface ProfileSummary {
  rangeDurationMs: number;
  totalPresenceMs: number;
  totalSpeakingMs: number;
  messageCount: number;
  presenceSessions: number;
  speakingSessions: number;
  uniqueActiveDays: string[];
  activeDayCount: number;
  firstPresenceAt: { ms: number; iso: string } | null;
  lastPresenceAt: { ms: number; iso: string } | null;
  firstSpeakingAt: { ms: number; iso: string } | null;
  lastSpeakingAt: { ms: number; iso: string } | null;
  firstMessageAt: { ms: number; iso: string } | null;
  lastMessageAt: { ms: number; iso: string } | null;
  firstActivityAt: { ms: number; iso: string } | null;
  lastActivityAt: { ms: number; iso: string } | null;
}

export default class AppServer {
  private readonly config: Config;

  private readonly transcoder: FfmpegTranscoder;

  private readonly speakerTracker: SpeakerTracker;

  private readonly sseService: SseService;

  private readonly anonymousSpeechManager: AnonymousSpeechManager;

  private readonly discordBridge: DiscordAudioBridge;

  private readonly app = express();

  private httpServer: Server | null = null;

  private wsServer: WebSocketServer | null = null;

  private readonly shopService: ShopService;

  private readonly voiceActivityRepository: VoiceActivityRepository | null;

  private readonly hypeLeaderboardTtlMs = 60_000;

  private readonly hypeLeaderboardCache = new Map<string, { result: HypeLeaderboardResult; expiresAt: number }>();

  private readonly hypeLeaderboardPromise = new Map<string, Promise<HypeLeaderboardResult>>();

  private readonly hypeLeaderboardService: HypeLeaderboardService | null;

  private readonly listenerStatsService: ListenerStatsService;

  private readonly streamListenersByIp = new Map<string, number>();

  private readonly unsubscribeListenerStats: (() => void) | null;

  private readonly blogService: BlogService;

  private readonly blogRepository: BlogRepository | null;

  private readonly seoRenderer: SeoRenderer;

  constructor({
    config,
    transcoder,
    speakerTracker,
    sseService,
    anonymousSpeechManager,
    discordBridge,
    shopService,
    voiceActivityRepository = null,
    listenerStatsService,
    blogRepository = null,
    blogService = null,
  }: AppServerOptions) {
    this.config = config;
    this.transcoder = transcoder;
    this.speakerTracker = speakerTracker;
    this.sseService = sseService;
    this.anonymousSpeechManager = anonymousSpeechManager;
    this.discordBridge = discordBridge;
    this.shopService = shopService;
    this.voiceActivityRepository = voiceActivityRepository;
    this.hypeLeaderboardService = voiceActivityRepository
      ? new HypeLeaderboardService({
          repository: voiceActivityRepository,
          identityProvider: (userId) => this.discordBridge.fetchUserIdentity(userId),
        })
      : null;
    this.listenerStatsService = listenerStatsService;
    this.unsubscribeListenerStats = this.listenerStatsService.onUpdate((update) =>
      this.handleListenerStatsUpdate(update),
    );

    this.blogRepository =
      blogRepository ??
      (config.database?.url
        ? new BlogRepository({ url: config.database.url, ssl: config.database.ssl })
        : null);

    this.blogService =
      blogService ??
      new BlogService({
        postsDirectory: path.resolve(__dirname, '..', '..', 'content', 'blog'),
        repository: this.blogRepository,
      });

    if (this.hypeLeaderboardService) {
      void this.hypeLeaderboardService.start().catch((error) => {
        console.error('Failed to initialize hype leaderboard precomputation', error);
      });
    }

    const defaultSocialImageUrl = new URL('/icons/icon-512.png', this.config.publicBaseUrl).toString();
    this.seoRenderer = new SeoRenderer({
      templatePath: path.resolve(__dirname, '..', '..', 'public', 'index.html'),
      baseUrl: this.config.publicBaseUrl,
      siteName: this.config.siteName,
      defaultLocale: this.config.siteLocale,
      defaultLanguage: this.config.siteLanguage,
      defaultRobots: 'index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1',
      defaultTwitterSite: this.config.twitterSite ?? null,
      defaultTwitterCreator: this.config.twitterCreator ?? null,
      defaultImages: [
        {
          url: defaultSocialImageUrl,
          alt: 'Illustration du direct communautaire Libre Antenne',
          type: 'image/png',
          width: 512,
          height: 512,
        },
      ],
      defaultStructuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'BroadcastService',
          name: this.config.siteName,
          description:
            "Flux audio communautaire en direct diffusé depuis Discord, libre d'accès et sans filtre.",
          url: this.config.publicBaseUrl,
          areaServed: 'FR',
          inLanguage: this.config.siteLanguage,
          provider: {
            '@type': 'Organization',
            name: this.config.siteName,
            url: this.config.publicBaseUrl,
          },
          broadcastDisplayName: 'Libre Antenne – Direct Discord',
          broadcastFrequency: 'Streaming en ligne',
          sameAs: ['https://discord.com/', 'https://twitter.com/libreantenne'],
        },
      ],
    });

    void this.blogService.initialize().catch((error) => {
      console.error('Failed to initialize blog service', error);
    });

    this.configureMiddleware();
    this.registerRoutes();
  }

  private handleListenerStatsUpdate(update: ListenerStatsUpdate | null): void {
    if (!update) {
      return;
    }

    this.sseService.broadcast('listeners', {
      count: update.count,
      timestamp: update.entry.timestamp,
      reason: update.reason,
      delta: update.delta,
      entry: update.entry,
      inserted: update.inserted,
    });
  }

  private parseTimestamp(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const candidate = new Date(value);
      return Number.isNaN(candidate.getTime()) ? null : candidate;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const fromNumber = new Date(numeric);
        if (!Number.isNaN(fromNumber.getTime())) {
          return fromNumber;
        }
      }

      const fromString = new Date(trimmed);
      if (!Number.isNaN(fromString.getTime())) {
        return fromString;
      }
    }

    return null;
  }

  private parseVoiceTranscriptionCursor(value: unknown): VoiceTranscriptionCursor | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parts = trimmed.split(':');
    if (parts.length !== 2) {
      return null;
    }

    const [timestampPart, idPart] = parts;
    const timestampMs = Number(timestampPart);
    const idValue = Number(idPart);

    if (!Number.isFinite(timestampMs) || !Number.isFinite(idValue)) {
      return null;
    }

    const timestamp = new Date(Math.floor(timestampMs));
    if (Number.isNaN(timestamp.getTime())) {
      return null;
    }

    return { timestamp, id: Math.floor(idValue) };
  }

  private serializeVoiceTranscriptionCursor(cursor: VoiceTranscriptionCursor | null): string | null {
    if (!cursor) {
      return null;
    }

    const timestamp = cursor.timestamp instanceof Date ? cursor.timestamp : new Date(cursor.timestamp);
    const timestampMs = timestamp.getTime();
    const idValue = Number(cursor.id);

    if (!Number.isFinite(timestampMs) || Number.isNaN(timestampMs) || !Number.isFinite(idValue)) {
      return null;
    }

    return `${Math.floor(timestampMs)}:${Math.floor(idValue)}`;
  }

  private parseBlogListOptions(query: Request['query']): BlogListOptions {
    const options: BlogListOptions = {};

    const rawSearch = this.extractString(query?.search);
    if (rawSearch) {
      options.search = rawSearch;
    }

    const tags = this.extractStringArray(query?.tag ?? query?.tags);
    if (tags.length > 0) {
      options.tags = tags;
    }

    const rawSort = this.extractString(query?.sort ?? query?.sortBy);
    if (rawSort) {
      if (rawSort === 'title') {
        options.sortBy = 'title';
      } else if (rawSort === 'date' || rawSort === 'recent' || rawSort === 'published_at') {
        options.sortBy = 'date';
      }
    }

    const rawOrder = this.extractString(query?.order ?? query?.sortOrder);
    if (rawOrder === 'asc' || rawOrder === 'desc') {
      options.sortOrder = rawOrder;
    }

    const rawLimit = this.extractString(query?.limit ?? query?.pageSize ?? query?.perPage);
    if (rawLimit) {
      const numericLimit = Number(rawLimit);
      if (Number.isFinite(numericLimit) && numericLimit > 0) {
        options.limit = Math.floor(numericLimit);
      }
    }

    return options;
  }

  private extractString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private extractStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }
      if (trimmed.includes(',')) {
        return trimmed
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }
      return [trimmed];
    }

    return [];
  }

  private setClientNoCache(res: Response): void {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  private respondWithAppShell(res: Response, metadata: SeoPageMetadata, status = 200): void {
    try {
      const html = this.seoRenderer.render(metadata);
      res.status(status);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      console.error('Failed to render SEO page', error);
      res.status(500).sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
    }
  }

  private toAbsoluteUrl(pathname: string): string {
    try {
      return new URL(pathname, this.config.publicBaseUrl).toString();
    } catch (error) {
      return this.config.publicBaseUrl;
    }
  }

  private formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) {
      return '0 min';
    }
    const totalMinutes = Math.floor(ms / 60000);
    const parts: string[] = [];
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      parts.push(`${hours} h`);
      const minutes = totalMinutes % 60;
      if (minutes > 0) {
        parts.push(`${minutes} min`);
      }
    } else if (totalMinutes > 0) {
      parts.push(`${totalMinutes} min`);
    }
    if (parts.length === 0) {
      const seconds = Math.max(1, Math.floor(ms / 1000));
      parts.push(`${seconds} s`);
    }
    return parts.join(' ');
  }

  private combineKeywords(...sources: Array<string | string[] | null | undefined>): string[] {
    const set = new Set<string>();
    for (const source of sources) {
      if (!source) {
        continue;
      }
      if (Array.isArray(source)) {
        for (const entry of source) {
          if (typeof entry === 'string') {
            const trimmed = entry.trim();
            if (trimmed) {
              set.add(trimmed);
            }
          }
        }
        continue;
      }
      if (typeof source === 'string') {
        const trimmed = source.trim();
        if (!trimmed) {
          continue;
        }
        if (trimmed.includes(',')) {
          trimmed
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
            .forEach((entry) => set.add(entry));
        } else {
          set.add(trimmed);
        }
      }
    }
    return Array.from(set.values());
  }

  private buildProfileSummary(
    range: { since: Date; until: Date },
    presenceSegments: UserVoicePresenceSegment[],
    speakingSegments: UserVoiceActivitySegment[],
    messageEvents: UserMessageActivityEntry[],
  ): ProfileSummary {
    const rangeStart = Number(range.since?.getTime()) || 0;
    const rangeEnd = Number(range.until?.getTime()) || rangeStart;
    const safeRangeEnd = Math.max(rangeEnd, rangeStart);

    const clamp = (start: number, end: number): [number, number] | null => {
      const safeStart = Math.max(rangeStart, start);
      const safeEnd = Math.min(safeRangeEnd, end);
      if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart) {
        return null;
      }
      return [safeStart, safeEnd];
    };

    const activeDays = new Set<string>();
    const formatDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    let totalPresenceMs = 0;
    let totalSpeakingMs = 0;
    let firstPresence: number | null = null;
    let lastPresence: number | null = null;
    let firstSpeaking: number | null = null;
    let lastSpeaking: number | null = null;
    let firstMessage: number | null = null;
    let lastMessage: number | null = null;
    let messageCount = 0;

    for (const segment of presenceSegments) {
      if (!segment) {
        continue;
      }
      const joinedMs = segment.joinedAt instanceof Date ? segment.joinedAt.getTime() : NaN;
      const leftMs = segment.leftAt instanceof Date ? segment.leftAt.getTime() : safeRangeEnd;
      if (!Number.isFinite(joinedMs)) {
        continue;
      }
      const effectiveLeft = Number.isFinite(leftMs) ? leftMs : safeRangeEnd;
      const window = clamp(joinedMs, effectiveLeft);
      if (!window) {
        continue;
      }
      const [start, end] = window;
      totalPresenceMs += end - start;
      firstPresence = firstPresence === null ? start : Math.min(firstPresence, start);
      lastPresence = lastPresence === null ? end : Math.max(lastPresence, end);
      activeDays.add(formatDay(start));
      activeDays.add(formatDay(end - 1));
    }

    for (const segment of speakingSegments) {
      if (!segment) {
        continue;
      }
      const startMs = segment.startedAt instanceof Date ? segment.startedAt.getTime() : NaN;
      if (!Number.isFinite(startMs)) {
        continue;
      }
      const endMs = startMs + (Number.isFinite(segment.durationMs) ? Math.max(segment.durationMs, 0) : 0);
      const window = clamp(startMs, endMs);
      if (!window) {
        continue;
      }
      const [start, end] = window;
      totalSpeakingMs += end - start;
      firstSpeaking = firstSpeaking === null ? start : Math.min(firstSpeaking, start);
      lastSpeaking = lastSpeaking === null ? end : Math.max(lastSpeaking, end);
      activeDays.add(formatDay(start));
      activeDays.add(formatDay(end - 1));
    }

    for (const entry of messageEvents) {
      if (!entry) {
        continue;
      }
      const timestamp = entry.timestamp instanceof Date ? entry.timestamp.getTime() : NaN;
      if (!Number.isFinite(timestamp)) {
        continue;
      }
      if (timestamp < rangeStart || timestamp > safeRangeEnd) {
        continue;
      }
      messageCount += 1;
      firstMessage = firstMessage === null ? timestamp : Math.min(firstMessage, timestamp);
      lastMessage = lastMessage === null ? timestamp : Math.max(lastMessage, timestamp);
      activeDays.add(formatDay(timestamp));
    }

    const firstActivityCandidates = [firstPresence, firstSpeaking, firstMessage].filter(
      (value): value is number => value !== null,
    );
    const lastActivityCandidates = [lastPresence, lastSpeaking, lastMessage].filter(
      (value): value is number => value !== null,
    );

    const firstActivity = firstActivityCandidates.length
      ? Math.min(...firstActivityCandidates)
      : null;
    const lastActivity = lastActivityCandidates.length
      ? Math.max(...lastActivityCandidates)
      : null;

    const toTimestamp = (ms: number | null) =>
      ms === null
        ? null
        : {
            ms,
            iso: new Date(ms).toISOString(),
          };

    return {
      rangeDurationMs: Math.max(0, safeRangeEnd - rangeStart),
      totalPresenceMs,
      totalSpeakingMs,
      messageCount,
      presenceSessions: presenceSegments.length,
      speakingSessions: speakingSegments.length,
      uniqueActiveDays: Array.from(activeDays.values()),
      activeDayCount: activeDays.size,
      firstPresenceAt: toTimestamp(firstPresence),
      lastPresenceAt: toTimestamp(lastPresence),
      firstSpeakingAt: toTimestamp(firstSpeaking),
      lastSpeakingAt: toTimestamp(lastSpeaking),
      firstMessageAt: toTimestamp(firstMessage),
      lastMessageAt: toTimestamp(lastMessage),
      firstActivityAt: toTimestamp(firstActivity),
      lastActivityAt: toTimestamp(lastActivity),
    };
  }

  private configureMiddleware(): void {
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }

      next();
    });

    this.app.use(express.json({ limit: '256kb' }));

    const publicDir = path.resolve(__dirname, '..', '..', 'public');
    this.app.use(express.static(publicDir));
  }

  private registerRoutes(): void {
    this.app.get('/events', (req, res) => {
      this.sseService.handleRequest(req, res, {
        initialState: () => ({
          ...this.speakerTracker.getInitialState(),
          anonymousSlot: this.anonymousSpeechManager.getPublicState(),
          listeners: {
            count: this.listenerStatsService.getCurrentCount(),
            history: this.listenerStatsService.getHistory(),
          },
        }),
      });
    });

    this.app.get(this.config.streamEndpoint, (req, res) => this.handleStreamRequest(req, res));

    this.app.get('/status', (_req, res) => {
      res.json({
        ffmpeg_pid: this.transcoder.getCurrentProcessPid(),
        headerBufferBytes: this.transcoder.getHeaderBuffer().length,
        activeSpeakers: this.speakerTracker.getSpeakerCount(),
      });
    });

    this.app.get('/api/shop/products', (_req, res) => {
      res.json({
        currency: this.shopService.getCurrency(),
        products: this.shopService.getProducts(),
      });
    });

    this.app.post('/api/shop/checkout', async (req, res) => {
      const { productId, provider, successUrl, cancelUrl, customerEmail } = req.body ?? {};

      if (typeof productId !== 'string' || productId.trim().length === 0) {
        res.status(400).json({ error: 'PRODUCT_REQUIRED', message: 'Le produit est obligatoire.' });
        return;
      }

      const normalizedProvider = this.normalizeShopProvider(provider);
      if (!normalizedProvider) {
        res.status(400).json({ error: 'PROVIDER_REQUIRED', message: 'Le fournisseur de paiement est obligatoire.' });
        return;
      }

      try {
        const session = await this.shopService.createCheckoutSession({
          productId: productId.trim(),
          provider: normalizedProvider,
          successUrl: typeof successUrl === 'string' ? successUrl : undefined,
          cancelUrl: typeof cancelUrl === 'string' ? cancelUrl : undefined,
          customerEmail: typeof customerEmail === 'string' ? customerEmail : undefined,
        });
        res.status(201).json(session);
      } catch (error) {
        this.handleShopError(res, error);
      }
    });

    this.app.get('/anonymous-slot', (_req, res) => {
      res.json(this.anonymousSpeechManager.getPublicState());
    });

    this.app.post('/anonymous-slot', (req, res) => {
      try {
        const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;
        const result = this.anonymousSpeechManager.claimSlot({ displayName });
        res.status(201).json(result);
      } catch (error) {
        this.handleAnonymousSlotError(res, error);
      }
    });

    this.app.delete('/anonymous-slot', (req, res) => {
      const token = this.extractAnonymousToken(req);
      if (!token) {
        res.status(400).json({ error: 'TOKEN_REQUIRED', message: 'Le jeton de session est requis.' });
        return;
      }

      try {
        const state = this.anonymousSpeechManager.releaseSlot(token);
        res.json({ state });
      } catch (error) {
        this.handleAnonymousSlotError(res, error);
      }
    });

    this.app.post('/test-beep', (req, res) => {
      this.handleTestBeep(req, res);
    });

    this.app.get('/api/stream/listeners', (_req, res) => {
      res.json({
        count: this.listenerStatsService.getCurrentCount(),
        history: this.listenerStatsService.getHistory(),
      });
    });

    this.app.get('/api/guild/summary', async (_req, res) => {
      try {
        const summary = await this.discordBridge.getGuildSummary();
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
        res.json({ guild: summary });
      } catch (error) {
        const name = (error as Error)?.name;
        if (name === 'GUILD_NOT_CONFIGURED') {
          res.status(503).json({
            error: 'GUILD_NOT_CONFIGURED',
            message: 'La configuration du serveur Discord est incomplète.',
          });
          return;
        }
        if (name === 'GUILD_UNAVAILABLE') {
          res.status(503).json({
            error: 'GUILD_UNAVAILABLE',
            message: 'Le serveur Discord est momentanément indisponible.',
          });
          return;
        }
        console.error('Failed to load guild summary', error);
        res.status(500).json({
          error: 'GUILD_SUMMARY_FAILED',
          message: 'Impossible de récupérer les informations du serveur Discord.',
        });
      }
    });

    this.app.get('/api/blog/posts', async (req, res) => {
      try {
        const options = this.parseBlogListOptions(req.query);
        const { posts, availableTags } = await this.blogService.listPosts(options);
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
        res.json({ posts, tags: availableTags });
      } catch (error) {
        console.error('Failed to list blog posts', error);
        res.status(500).json({
          error: 'BLOG_LIST_FAILED',
          message: 'Impossible de récupérer les articles du blog.',
        });
      }
    });

    this.app.get('/api/blog/posts/:slug', async (req, res) => {
      const rawSlug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
      if (!rawSlug) {
        res.status(400).json({
          error: 'SLUG_REQUIRED',
          message: "Le lien de l'article est requis.",
        });
        return;
      }

      try {
        const post = await this.blogService.getPost(rawSlug);
        if (!post) {
          res.status(404).json({
            error: 'POST_NOT_FOUND',
            message: "Impossible de trouver l'article demandé.",
          });
          return;
        }
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
        res.json({ post });
      } catch (error) {
        console.error('Failed to load blog post', error);
        res.status(500).json({
          error: 'BLOG_POST_FAILED',
          message: "Impossible de récupérer cet article.",
        });
      }
    });

    this.app.get('/api/voice-activity/history', async (req, res) => {
      if (!this.voiceActivityRepository) {
        res.json({ segments: [] });
        return;
      }

      const parseTimestamp = (value: unknown): Date | null => {
        if (typeof value !== 'string') {
          return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        const numeric = Number(trimmed);
        if (!Number.isNaN(numeric)) {
          const fromNumber = new Date(numeric);
          if (!Number.isNaN(fromNumber.getTime())) {
            return fromNumber;
          }
        }
        const fromString = new Date(trimmed);
        if (!Number.isNaN(fromString.getTime())) {
          return fromString;
        }
        return null;
      };

      const since = parseTimestamp(Array.isArray(req.query.since) ? req.query.since[0] : req.query.since);
      const until = parseTimestamp(Array.isArray(req.query.until) ? req.query.until[0] : req.query.until);
      const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
      const limit = typeof limitRaw === 'string' && limitRaw.trim().length > 0 ? Number(limitRaw) : null;

      try {
        const history = await this.voiceActivityRepository.listVoiceActivityHistory({ since, until, limit });
        res.json({
          segments: history.map((entry) => ({
            id: entry.userId,
            userId: entry.userId,
            channelId: entry.channelId,
            guildId: entry.guildId,
            durationMs: entry.durationMs,
            startedAt: entry.startedAt.toISOString(),
            endedAt: entry.endedAt.toISOString(),
            startedAtMs: entry.startedAt.getTime(),
            endedAtMs: entry.endedAt.getTime(),
            profile: entry.profile
              ? {
                  displayName: entry.profile.displayName,
                  username: entry.profile.username,
                  avatar: entry.profile.avatar,
                }
              : null,
          })),
        });
      } catch (error) {
        console.error('Failed to retrieve voice activity history', error);
        res
          .status(500)
          .json({
            error: 'VOICE_ACTIVITY_FETCH_FAILED',
            message: "Impossible de récupérer l'historique vocal.",
          });
      }
    });

    this.app.get('/api/users/:userId/profile', async (req, res) => {
      const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!rawUserId) {
        res
          .status(400)
          .json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
        return;
      }

      const sinceParam = Array.isArray(req.query.since) ? req.query.since[0] : req.query.since;
      const untilParam = Array.isArray(req.query.until) ? req.query.until[0] : req.query.until;

      const now = new Date();
      const untilCandidate = this.parseTimestamp(untilParam) ?? now;
      const sinceCandidate = this.parseTimestamp(sinceParam)
        ?? new Date(untilCandidate.getTime() - 30 * 24 * 60 * 60 * 1000);

      if (Number.isNaN(sinceCandidate.getTime()) || Number.isNaN(untilCandidate.getTime())) {
        res
          .status(400)
          .json({ error: 'INVALID_RANGE', message: 'La période demandée est invalide.' });
        return;
      }

      if (sinceCandidate.getTime() >= untilCandidate.getTime()) {
        res
          .status(400)
          .json({ error: 'EMPTY_RANGE', message: 'La date de début doit précéder la date de fin.' });
        return;
      }

      try {
        const [profile, presenceSegments, speakingSegments, messageEvents] = await Promise.all([
          this.discordBridge.fetchUserIdentity(rawUserId),
          this.voiceActivityRepository
            ? this.voiceActivityRepository.listUserVoicePresence({
                userId: rawUserId,
                since: sinceCandidate,
                until: untilCandidate,
              })
            : Promise.resolve([] as UserVoicePresenceSegment[]),
          this.voiceActivityRepository
            ? this.voiceActivityRepository.listUserVoiceActivity({
                userId: rawUserId,
                since: sinceCandidate,
                until: untilCandidate,
              })
            : Promise.resolve([] as UserVoiceActivitySegment[]),
          this.voiceActivityRepository
            ? this.voiceActivityRepository.listUserMessageActivity({
                userId: rawUserId,
                since: sinceCandidate,
                until: untilCandidate,
              })
            : Promise.resolve([] as UserMessageActivityEntry[]),
        ]);

        const normalizeString = (value: string | null | undefined): string | null => {
          if (typeof value !== 'string') {
            return null;
          }
          const trimmed = value.trim();
          return trimmed.length > 0 ? trimmed : null;
        };

        const normalizedProfile = profile
          ? {
              id: profile.id,
              displayName:
                normalizeString(profile.displayName)
                ?? normalizeString(profile.globalName)
                ?? normalizeString(profile.username),
              username: normalizeString(profile.username),
              avatar: normalizeString(profile.avatarUrl),
              discriminator: normalizeString(profile.discriminator),
              globalName: normalizeString(profile.globalName),
              bannerUrl: normalizeString(profile.bannerUrl),
              accentColor: normalizeString(profile.accentColor),
              createdAt: normalizeString(profile.createdAt),
              guild: profile.guild ?? null,
            }
          : null;

        if (!profile && presenceSegments.length === 0 && speakingSegments.length === 0 && messageEvents.length === 0) {
          res
            .status(404)
            .json({ error: 'PROFILE_NOT_FOUND', message: "Impossible de trouver le profil demandé." });
          return;
        }

        const summary = this.buildProfileSummary(
          { since: sinceCandidate, until: untilCandidate },
          presenceSegments,
          speakingSegments,
          messageEvents,
        );

        const toMillis = (date: Date | null) => (date instanceof Date ? date.getTime() : null);

        res.json({
          profile: normalizedProfile,
          range: {
            since: sinceCandidate.toISOString(),
            until: untilCandidate.toISOString(),
            sinceMs: sinceCandidate.getTime(),
            untilMs: untilCandidate.getTime(),
          },
          stats: summary,
          presenceSegments: presenceSegments.map((segment) => ({
            channelId: segment.channelId,
            guildId: segment.guildId,
            joinedAt: segment.joinedAt.toISOString(),
            joinedAtMs: segment.joinedAt.getTime(),
            leftAt: segment.leftAt ? segment.leftAt.toISOString() : null,
            leftAtMs: toMillis(segment.leftAt),
          })),
          speakingSegments: speakingSegments.map((segment) => {
            const startedAt = segment.startedAt;
            const startMs = startedAt.getTime();
            const durationMs = Number.isFinite(segment.durationMs) ? Math.max(segment.durationMs, 0) : 0;
            const endedAt = new Date(startMs + durationMs);
            return {
              channelId: segment.channelId,
              guildId: segment.guildId,
              startedAt: startedAt.toISOString(),
              startedAtMs: startMs,
              durationMs,
              endedAt: endedAt.toISOString(),
              endedAtMs: endedAt.getTime(),
            };
          }),
          messageEvents: messageEvents.map((entry) => ({
            messageId: entry.messageId,
            channelId: entry.channelId,
            guildId: entry.guildId,
            content: entry.content,
            timestamp: entry.timestamp.toISOString(),
            timestampMs: entry.timestamp.getTime(),
          })),
        });
      } catch (error) {
        console.error('Failed to build user profile analytics', error);
        res.status(500).json({
          error: 'PROFILE_ANALYTICS_FAILED',
          message: "Impossible de récupérer le profil demandé.",
        });
      }
    });

    this.app.get('/api/users/:userId/voice-transcriptions', async (req, res) => {
      const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!rawUserId) {
        res
          .status(400)
          .json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
        return;
      }

      if (!this.voiceActivityRepository) {
        res.status(503).json({
          error: 'VOICE_TRANSCRIPTIONS_UNAVAILABLE',
          message: 'Les retranscriptions vocales ne sont pas disponibles pour le moment.',
        });
        return;
      }

      const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
      const cursorParam = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;

      const parsedLimit = typeof limitParam === 'string' ? Number.parseInt(limitParam, 10) : NaN;
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 50) : 10;

      let cursor: VoiceTranscriptionCursor | null = null;
      if (typeof cursorParam === 'string' && cursorParam.trim().length > 0) {
        cursor = this.parseVoiceTranscriptionCursor(cursorParam);
        if (!cursor) {
          res
            .status(400)
            .json({ error: 'INVALID_CURSOR', message: 'Le curseur de pagination est invalide.' });
          return;
        }
      }

      try {
        const result = await this.voiceActivityRepository.listUserVoiceTranscriptions({
          userId: rawUserId,
          limit,
          before: cursor,
        });

        const serializedCursor = this.serializeVoiceTranscriptionCursor(result.nextCursor);

        res.json({
          entries: result.entries.map((entry) => ({
            transcriptionId: entry.transcriptionId,
            channelId: entry.channelId,
            guildId: entry.guildId,
            content: entry.content,
            timestamp: entry.timestamp.toISOString(),
            timestampMs: entry.timestamp.getTime(),
          })),
          hasMore: Boolean(result.hasMore && serializedCursor),
          nextCursor: serializedCursor,
        });
      } catch (error) {
        console.error('Failed to load voice transcriptions', error);
        res.status(500).json({
          error: 'VOICE_TRANSCRIPTIONS_FAILED',
          message: 'Impossible de récupérer les retranscriptions vocales.',
        });
      }
    });

    this.app.get('/api/members', async (req, res) => {
      const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
      const afterParam = Array.isArray(req.query.after) ? req.query.after[0] : req.query.after;
      const searchParam = Array.isArray(req.query.search) ? req.query.search[0] : req.query.search;

      const parsedLimit = typeof limitParam === 'string' ? Number.parseInt(limitParam, 10) : NaN;
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 24;

      const after = typeof afterParam === 'string' ? afterParam.trim() : '';
      const search = typeof searchParam === 'string' ? searchParam.trim() : '';

      try {
        const result = await this.discordBridge.listGuildMembers({
          limit,
          after: after.length > 0 ? after : null,
          search: search.length > 0 ? search : null,
        });

        let recentMessagesByUser: Record<string, UserMessageActivityEntry[]> = {};
        if (this.voiceActivityRepository) {
          const userIds = result.members
            .map((member) => (typeof member?.id === 'string' ? member.id : ''))
            .filter((id): id is string => id.length > 0);

          if (userIds.length > 0) {
            try {
              recentMessagesByUser = await this.voiceActivityRepository.listRecentUserMessages({
                userIds,
                limitPerUser: 3,
              });
            } catch (recentMessageError) {
              console.warn('Failed to load recent member messages', recentMessageError);
            }
          }
        }

        const membersWithMessages = result.members.map((member) => ({
          ...member,
          recentMessages: (recentMessagesByUser[member.id] ?? []).map((entry) => ({
            messageId: entry.messageId,
            channelId: entry.channelId,
            guildId: entry.guildId,
            content: entry.content,
            timestamp: entry.timestamp.toISOString(),
            timestampMs: entry.timestamp.getTime(),
          })),
        }));

        res.json({
          members: membersWithMessages,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        });
      } catch (error) {
        if ((error as Error)?.name === 'GUILD_UNAVAILABLE' || (error as Error)?.message === 'GUILD_UNAVAILABLE') {
          res.status(503).json({
            error: 'GUILD_UNAVAILABLE',
            message: 'Le serveur Discord est momentanément indisponible.',
          });
          return;
        }

        console.error('Failed to retrieve guild members', error);
        res.status(500).json({
          error: 'MEMBER_LIST_FAILED',
          message: 'Impossible de récupérer la liste des membres.',
        });
      }
    });

    this.app.get('/api/voice-activity/hype-leaders', async (req, res) => {
      this.setClientNoCache(res);
      if (!this.voiceActivityRepository || !this.hypeLeaderboardService) {
        res.json({
          leaders: [],
          snapshot: {
            bucketStart: new Date().toISOString(),
            comparedTo: null,
          },
        });
        return;
      }

      try {
        const options = this.parseLeaderboardRequest(req);
        const result = await this.getCachedHypeLeaders(options);
        res.json({ leaders: result.leaders, snapshot: result.snapshot });
      } catch (error) {
        console.error('Failed to retrieve hype leaderboard', error);
        res.status(500).json({
          error: 'HYPE_LEADERBOARD_FETCH_FAILED',
          message: "Impossible de récupérer le classement hype.",
          debug: {
            error: this.describeError(error),
            request: {
              query: this.captureQueryParams(req.query),
            },
          },
        });
      }
    });

    this.app.get('/classements', (req, res) => {
      this.setClientNoCache(res);
      const search = this.extractString(req.query?.search);
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Classements hype & statistiques en direct`,
        description:
          "Explore les classements hype de Libre Antenne : rétention, présence et interventions marquantes de la communauté.",
        path: '/classements',
        canonicalUrl: this.toAbsoluteUrl('/classements'),
        robots: search ? 'noindex,follow' : undefined,
        keywords: this.combineKeywords(
          'classement Libre Antenne',
          'statistiques Discord',
          'hype score',
          'radio libre',
          this.config.siteName,
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Classements', path: '/classements' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'Dataset',
            name: `${this.config.siteName} – Classements hype`,
            description:
              'Classements temps réel des participations vocales et textuelles sur Libre Antenne.',
            license: 'https://creativecommons.org/licenses/by/4.0/',
            url: this.toAbsoluteUrl('/classements'),
            creator: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            distribution: [
              {
                '@type': 'DataDownload',
                encodingFormat: 'application/json',
                contentUrl: this.toAbsoluteUrl('/api/voice-activity/hype-leaders'),
              },
            ],
          },
        ],
      };

      this.respondWithAppShell(res, metadata);
    });

    this.app.get(['/membres', '/members'], (req, res) => {
      const rawSearch = this.extractString(req.query?.search);
      const search = rawSearch ? rawSearch.slice(0, 80) : null;
      const baseDescription =
        'Parcours les membres actifs de Libre Antenne, leurs présences vocales et leurs derniers messages Discord.';
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Membres actifs & profils Discord`,
        description: search
          ? `Résultats pour « ${search} » dans la communauté Libre Antenne : profils, messages et activité audio.`
          : baseDescription,
        path: '/membres',
        canonicalUrl: this.toAbsoluteUrl('/membres'),
        robots: search ? 'noindex,follow' : undefined,
        keywords: this.combineKeywords(
          this.config.siteName,
          'membres Libre Antenne',
          'communauté Discord',
          'profil audio',
          search ? `membre ${search}` : null,
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Membres', path: '/membres' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: `${this.config.siteName} – Membres`,
            description: search
              ? `Résultats de recherche pour ${search} parmi les membres de Libre Antenne.`
              : 'Annuaire des membres actifs de la communauté audio Libre Antenne.',
            url: this.toAbsoluteUrl('/membres'),
            about: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            inLanguage: this.config.siteLanguage,
          },
        ],
      };

      this.respondWithAppShell(res, metadata);
    });

    this.app.get(['/boutique', '/shop'], (_req, res) => {
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Boutique officielle & soutien`,
        description:
          'Retrouve les produits officiels Libre Antenne pour soutenir la radio libre : mugs, t-shirts et accès premium.',
        path: '/boutique',
        canonicalUrl: this.toAbsoluteUrl('/boutique'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'boutique Libre Antenne',
          'goodies radio libre',
          'merch Discord',
          'soutien communautaire',
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Boutique', path: '/boutique' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'OfferCatalog',
            name: `${this.config.siteName} – Boutique officielle`,
            description:
              'Catalogue des produits physiques et numériques pour soutenir le projet Libre Antenne.',
            url: this.toAbsoluteUrl('/boutique'),
            provider: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
          },
        ],
      };

      this.respondWithAppShell(res, metadata);
    });

    this.app.get(['/bannir', '/ban'], (_req, res) => {
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Outil de modération & bannissement`,
        description:
          'Accède à l’outil de modération Libre Antenne pour signaler ou bannir un membre perturbateur.',
        path: '/bannir',
        canonicalUrl: this.toAbsoluteUrl('/bannir'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'modération Libre Antenne',
          'ban Discord',
          'radio libre',
        ),
        openGraphType: 'website',
        robots: 'noindex,follow',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Modération', path: '/bannir' },
        ],
      };

      this.respondWithAppShell(res, metadata);
    });

    this.app.get('/about', (_req, res) => {
      const metadata: SeoPageMetadata = {
        title: `À propos de ${this.config.siteName} · Manifesto & histoire`,
        description:
          `${this.config.siteName} est une radio libre née sur Discord : découvre notre manifeste, notre histoire et comment participer au direct.`,
        path: '/about',
        canonicalUrl: this.toAbsoluteUrl('/about'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'radio libre',
          'communauté Discord',
          'manifeste Libre Antenne',
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'À propos', path: '/about' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'AboutPage',
            name: `À propos – ${this.config.siteName}`,
            description:
              'Historique, valeurs et fonctionnement de la radio libre communautaire Libre Antenne.',
            url: this.toAbsoluteUrl('/about'),
            inLanguage: this.config.siteLanguage,
            primaryImageOfPage: this.toAbsoluteUrl('/icons/icon-512.png'),
            isPartOf: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
          },
        ],
      };

      this.respondWithAppShell(res, metadata);
    });

    this.app.get('/blog', (req, res) => {
      const tags = this.extractStringArray(req.query?.tag ?? req.query?.tags ?? null);
      const tagSnippet = tags.length > 0 ? `Focus sur ${tags.join(', ')}.` : '';
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Blog & chroniques de la radio libre`,
        description:
          (tags.length > 0
            ? `Articles Libre Antenne consacrés à ${tags.join(', ')} : coulisses du direct, récits de nuit et interviews.`
            : 'Retrouve les coulisses, récits et actualités de la radio libre Libre Antenne.'),
        path: '/blog',
        canonicalUrl: this.toAbsoluteUrl('/blog'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'blog Libre Antenne',
          'radio libre',
          'histoires de nuit',
          ...tags,
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Blog', path: '/blog' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'Blog',
            name: `${this.config.siteName} – Blog`,
            description:
              tags.length > 0
                ? `Articles thématiques (${tags.join(', ')}) publiés par la communauté Libre Antenne.`
                : 'Blog communautaire de Libre Antenne : actualités, stories et guides du direct.',
            url: this.toAbsoluteUrl('/blog'),
            inLanguage: this.config.siteLanguage,
            about: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            keywords: tags.length > 0 ? tags : undefined,
          },
        ],
        additionalMeta: tagSnippet
          ? [
              {
                name: 'news_keywords',
                content: tags.join(', '),
              },
            ]
          : undefined,
      };

      this.respondWithAppShell(res, metadata);
    });

    this.app.get('/blog/:slug', async (req, res) => {
      const rawSlug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
      if (!rawSlug) {
        this.respondWithAppShell(
          res,
          {
            title: 'Article introuvable · Libre Antenne',
            description: "Impossible de trouver cet article du blog Libre Antenne.",
            path: req.path,
            canonicalUrl: this.toAbsoluteUrl('/blog'),
            robots: 'noindex,follow',
            breadcrumbs: [
              { name: 'Accueil', path: '/' },
              { name: 'Blog', path: '/blog' },
            ],
          },
          404,
        );
        return;
      }

      try {
        const post = await this.blogService.getPost(rawSlug);
        if (!post) {
          this.respondWithAppShell(
            res,
            {
              title: 'Article introuvable · Libre Antenne',
              description: "L'article demandé n'existe plus ou a été déplacé.",
              path: req.path,
              canonicalUrl: this.toAbsoluteUrl('/blog'),
              robots: 'noindex,follow',
              breadcrumbs: [
                { name: 'Accueil', path: '/' },
                { name: 'Blog', path: '/blog' },
                { name: rawSlug, path: req.path },
              ],
            },
            404,
          );
          return;
        }

        const canonicalPath = `/blog/${post.slug}`;
        const description = post.seoDescription
          ?? post.excerpt
          ?? `Chronique Libre Antenne : ${post.title}.`;
        const articleImage = post.coverImageUrl
          ? [
              {
                url: post.coverImageUrl,
                alt: `Illustration de l'article ${post.title}`,
              },
            ]
          : undefined;
        const metadata: SeoPageMetadata = {
          title: `${post.title} · Blog Libre Antenne`,
          description,
          path: canonicalPath,
          canonicalUrl: this.toAbsoluteUrl(canonicalPath),
          keywords: this.combineKeywords(
            post.title,
            this.config.siteName,
            'blog Libre Antenne',
            ...(post.tags ?? []),
          ),
          openGraphType: 'article',
          images: articleImage,
          breadcrumbs: [
            { name: 'Accueil', path: '/' },
            { name: 'Blog', path: '/blog' },
            { name: post.title, path: canonicalPath },
          ],
          article: {
            publishedTime: post.date ?? undefined,
            modifiedTime: post.updatedAt ?? post.date ?? undefined,
            section: 'Blog',
            tags: post.tags,
          },
          authorName: this.config.siteName,
          publisherName: this.config.siteName,
          structuredData: [
            {
              '@context': 'https://schema.org',
              '@type': 'Article',
              headline: post.title,
              description,
              datePublished: post.date ?? undefined,
              dateModified: post.updatedAt ?? post.date ?? undefined,
              url: this.toAbsoluteUrl(canonicalPath),
              inLanguage: this.config.siteLanguage,
              author: {
                '@type': 'Organization',
                name: this.config.siteName,
                url: this.config.publicBaseUrl,
              },
              publisher: {
                '@type': 'Organization',
                name: this.config.siteName,
                url: this.config.publicBaseUrl,
                logo: {
                  '@type': 'ImageObject',
                  url: this.toAbsoluteUrl('/icons/icon-512.png'),
                },
              },
              image: articleImage?.map((image) => this.toAbsoluteUrl(image.url)),
              keywords: post.tags,
              mainEntityOfPage: this.toAbsoluteUrl(canonicalPath),
              articleSection: 'Blog',
            },
          ],
        };

        this.respondWithAppShell(res, metadata);
      } catch (error) {
        console.error('Failed to render blog post page', error);
        this.respondWithAppShell(
          res,
          {
            title: `${this.config.siteName} · Blog`,
            description: 'Une erreur est survenue lors du chargement de cet article.',
            path: '/blog',
            canonicalUrl: this.toAbsoluteUrl('/blog'),
            robots: 'noindex,follow',
            breadcrumbs: [
              { name: 'Accueil', path: '/' },
              { name: 'Blog', path: '/blog' },
            ],
          },
          500,
        );
      }
    });

    this.app.get(['/profil/:userId', '/profile/:userId'], async (req, res) => {
      const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!rawUserId) {
        this.respondWithAppShell(
          res,
          {
            title: 'Profil introuvable · Libre Antenne',
            description: "Impossible de charger ce profil Libre Antenne.",
            path: req.path,
            canonicalUrl: this.toAbsoluteUrl('/membres'),
            robots: 'noindex,follow',
            breadcrumbs: [
              { name: 'Accueil', path: '/' },
              { name: 'Membres', path: '/membres' },
            ],
          },
          404,
        );
        return;
      }

      try {
        const identity = await this.discordBridge.fetchUserIdentity(rawUserId);
        let presenceSegments: UserVoicePresenceSegment[] = [];
        let speakingSegments: UserVoiceActivitySegment[] = [];
        let messageEvents: UserMessageActivityEntry[] = [];

        const rangeEnd = new Date();
        const rangeStart = new Date(rangeEnd.getTime() - 90 * 24 * 60 * 60 * 1000);

        if (this.voiceActivityRepository) {
          try {
            [presenceSegments, speakingSegments, messageEvents] = await Promise.all([
              this.voiceActivityRepository.listUserVoicePresence({ userId: rawUserId, since: rangeStart, until: rangeEnd }),
              this.voiceActivityRepository.listUserVoiceActivity({ userId: rawUserId, since: rangeStart, until: rangeEnd }),
              this.voiceActivityRepository.listUserMessageActivity({ userId: rawUserId, since: rangeStart, until: rangeEnd }),
            ]);
          } catch (activityError) {
            console.warn('Failed to load profile activity for SEO', rawUserId, activityError);
          }
        }

        const hasActivity =
          presenceSegments.length > 0 || speakingSegments.length > 0 || messageEvents.length > 0;

        if (!identity && !hasActivity) {
          this.respondWithAppShell(
            res,
            {
              title: 'Profil introuvable · Libre Antenne',
              description: "Impossible de trouver ce membre dans la communauté Libre Antenne.",
              path: req.path,
              canonicalUrl: this.toAbsoluteUrl('/membres'),
              robots: 'noindex,follow',
              breadcrumbs: [
                { name: 'Accueil', path: '/' },
                { name: 'Membres', path: '/membres' },
              ],
            },
            404,
          );
          return;
        }

        const profileName = (() => {
          const candidates = [
            identity?.guild?.displayName,
            identity?.globalName,
            identity?.username,
          ];
          for (const candidate of candidates) {
            if (typeof candidate === 'string') {
              const trimmed = candidate.trim();
              if (trimmed.length > 0) {
                return trimmed;
              }
            }
          }
          return `Membre ${rawUserId}`;
        })();

        const summary = this.buildProfileSummary(
          { since: rangeStart, until: rangeEnd },
          presenceSegments,
          speakingSegments,
          messageEvents,
        );

        const highlightParts: string[] = [];
        if (summary.totalPresenceMs > 0) {
          highlightParts.push(`${this.formatDuration(summary.totalPresenceMs)} de présence vocale`);
        }
        if (summary.totalSpeakingMs > 0) {
          highlightParts.push(`${this.formatDuration(summary.totalSpeakingMs)} au micro`);
        }
        if (summary.messageCount > 0) {
          highlightParts.push(`${summary.messageCount} messages`);
        }
        if (summary.activeDayCount > 0) {
          highlightParts.push(`${summary.activeDayCount} jours actifs`);
        }
        const highlights = highlightParts.length > 0
          ? ` Activité des 90 derniers jours : ${highlightParts.join(' · ')}.`
          : '';

        const canonicalPath = `/profil/${encodeURIComponent(rawUserId)}`;
        const metadata: SeoPageMetadata = {
          title: `${profileName} · Profil Libre Antenne`,
          description: `${profileName} participe à la radio libre Libre Antenne.${highlights}`.trim(),
          path: canonicalPath,
          canonicalUrl: this.toAbsoluteUrl(canonicalPath),
          keywords: this.combineKeywords(
            profileName,
            identity?.username ?? null,
            identity?.globalName ?? null,
            'profil Libre Antenne',
            'radio libre',
            'Discord audio',
          ),
          openGraphType: 'profile',
          images: identity?.avatarUrl
            ? [
                {
                  url: identity.avatarUrl,
                  alt: `Avatar de ${profileName}`,
                  width: 256,
                  height: 256,
                },
              ]
            : undefined,
          breadcrumbs: [
            { name: 'Accueil', path: '/' },
            { name: 'Membres', path: '/membres' },
            { name: profileName, path: canonicalPath },
          ],
          profile: {
            username: identity?.username ?? identity?.globalName ?? null,
          },
          structuredData: [
            {
              '@context': 'https://schema.org',
              '@type': 'ProfilePage',
              name: `${profileName} – Profil Libre Antenne`,
              description: `${profileName} sur Libre Antenne.${highlights}`.trim(),
              url: this.toAbsoluteUrl(canonicalPath),
              inLanguage: this.config.siteLanguage,
              about: {
                '@type': 'Person',
                name: profileName,
                identifier: rawUserId,
                alternateName: identity?.username ?? identity?.globalName ?? undefined,
                image: identity?.avatarUrl ?? undefined,
                memberOf: {
                  '@type': 'Organization',
                  name: this.config.siteName,
                  url: this.config.publicBaseUrl,
                },
                startDate: identity?.guild?.joinedAt ?? undefined,
                interactionStatistic: [
                  summary.totalPresenceMs > 0
                    ? {
                        '@type': 'InteractionCounter',
                        interactionType: { '@type': 'CommunicateAction', name: 'Présence vocale' },
                        userInteractionCount: Math.round(summary.totalPresenceMs / 60000),
                      }
                    : undefined,
                  summary.totalSpeakingMs > 0
                    ? {
                        '@type': 'InteractionCounter',
                        interactionType: { '@type': 'SpeakAction', name: 'Temps au micro' },
                        userInteractionCount: Math.round(summary.totalSpeakingMs / 60000),
                      }
                    : undefined,
                  summary.messageCount > 0
                    ? {
                        '@type': 'InteractionCounter',
                        interactionType: { '@type': 'CommunicateAction', name: 'Messages Discord' },
                        userInteractionCount: summary.messageCount,
                      }
                    : undefined,
                ].filter(Boolean),
              },
            },
          ],
        };

        this.respondWithAppShell(res, metadata);
      } catch (error) {
        console.error('Failed to build profile page SEO', error);
        this.respondWithAppShell(
          res,
          {
            title: `${this.config.siteName} · Membres`,
            description: 'Impossible de charger ce profil pour le moment.',
            path: '/membres',
            canonicalUrl: this.toAbsoluteUrl('/membres'),
            robots: 'noindex,follow',
            breadcrumbs: [
              { name: 'Accueil', path: '/' },
              { name: 'Membres', path: '/membres' },
            ],
          },
          500,
        );
      }
    });

    this.app.get('/', (_req, res) => {
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Radio libre et streaming communautaire`,
        description:
          'Libre Antenne diffuse en continu les voix du salon Discord : un espace sans filtre pour les esprits libres, les joueurs et les noctambules.',
        path: '/',
        canonicalUrl: this.toAbsoluteUrl('/'),
        keywords: this.combineKeywords(
          'radio libre',
          'libre antenne',
          'talk show en direct',
          'discord audio',
          'streaming communautaire',
          'communauté nocturne',
        ),
        openGraphType: 'website',
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'RadioChannel',
            name: this.config.siteName,
            url: this.config.publicBaseUrl,
            inLanguage: this.config.siteLanguage,
            broadcastServiceTier: 'Libre Antenne – Direct Discord',
          },
        ],
      };

      this.respondWithAppShell(res, metadata);
    });

    this.app.get('/*path', (req, res) => {
      this.respondWithAppShell(
        res,
        {
          title: `Page introuvable · ${this.config.siteName}`,
          description: `La page ${req.path} n'existe pas ou n'est plus disponible sur ${this.config.siteName}.`,
          path: req.path,
          canonicalUrl: this.toAbsoluteUrl(req.path),
          robots: 'noindex,follow',
          breadcrumbs: [
            { name: 'Accueil', path: '/' },
          ],
        },
        404,
      );
    });
  }

  private static readonly hypeLeaderboardSortableColumns: readonly HypeLeaderboardSortBy[] = [
    'schScoreNorm',
    'schRaw',
    'arrivalEffect',
    'departureEffect',
    'retentionMinutes',
    'activityScore',
    'sessions',
    'displayName',
  ];

  private async getCachedHypeLeaders(options: NormalizedHypeLeaderboardQueryOptions): Promise<HypeLeaderboardResult> {
    const service = this.hypeLeaderboardService;
    if (!service) {
      return {
        leaders: [],
        snapshot: {
          bucketStart: new Date(),
          comparedTo: null,
        },
      };
    }

    const normalized = service.normalizeOptions(options);
    const cacheKey = service.buildCacheKey(normalized);
    const now = Date.now();
    const cached = this.hypeLeaderboardCache.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > now) {
        return cached.result;
      }
      this.hypeLeaderboardCache.delete(cacheKey);
    }

    const inflight = this.hypeLeaderboardPromise.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const promise = service
      .getLeaderboardWithTrends(normalized)
      .then((result) => {
        this.hypeLeaderboardCache.set(cacheKey, {
          result,
          expiresAt: Date.now() + this.hypeLeaderboardTtlMs,
        });
        return result;
      })
      .finally(() => {
        this.hypeLeaderboardPromise.delete(cacheKey);
      });

    this.hypeLeaderboardPromise.set(cacheKey, promise);
    return promise;
  }

  private extractQueryParam(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
      return value[0];
    }

    return null;
  }

  private parseIntegerParam(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return parsed;
  }

  private parsePeriodParam(value: string | null): number | null | undefined {
    if (value === null) {
      return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
      return undefined;
    }

    if (normalized === 'all' || normalized === 'tout') {
      return null;
    }

    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return undefined;
    }

    return parsed;
  }

  private parseLeaderboardRequest(req: Request): NormalizedHypeLeaderboardQueryOptions {
    const limit = this.parseIntegerParam(this.extractQueryParam(req.query.limit));
    const search = this.extractQueryParam(req.query.search);
    const sortByParam = this.extractQueryParam(req.query.sortBy);
    const sortOrderParam = (() => {
      const raw = this.extractQueryParam(req.query.sortOrder);
      if (!raw) {
        return null;
      }
      const normalized = raw.trim().toLowerCase();
      return normalized === 'asc' || normalized === 'desc'
        ? (normalized as HypeLeaderboardSortOrder)
        : null;
    })();
    const rawPeriodParam = this.extractQueryParam(req.query.period);
    const periodParam = this.parsePeriodParam(rawPeriodParam);

    const options: HypeLeaderboardQueryOptions = {
      limit,
      search,
      sortBy: (sortByParam as HypeLeaderboardSortBy | null) ?? null,
      sortOrder: sortOrderParam,
      periodDays: periodParam,
    };

    const service = this.hypeLeaderboardService;
    if (service) {
      return service.normalizeOptions(options);
    }

    const fallbackLimit = (() => {
      if (!Number.isFinite(options.limit)) {
        return 100;
      }
      const normalized = Math.max(1, Math.floor(Number(options.limit)));
      return Math.min(normalized, 200);
    })();

    const fallbackSearch = typeof options.search === 'string' && options.search.trim().length > 0
      ? options.search.trim()
      : null;

    const fallbackSortBy: HypeLeaderboardSortBy = (() => {
      const candidate = options.sortBy;
      if (candidate && AppServer.hypeLeaderboardSortableColumns.includes(candidate)) {
        return candidate;
      }
      return 'schScoreNorm';
    })();

    const fallbackSortOrder: HypeLeaderboardSortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';

    const fallbackPeriodDays = (() => {
      if (options.periodDays === null) {
        return null;
      }
      if (!Number.isFinite(options.periodDays)) {
        return 30;
      }
      const normalized = Math.max(1, Math.floor(Number(options.periodDays)));
      return Math.min(normalized, 365);
    })();

    return {
      limit: fallbackLimit,
      search: fallbackSearch,
      sortBy: fallbackSortBy,
      sortOrder: fallbackSortOrder,
      periodDays: fallbackPeriodDays,
    };
  }

  private captureQueryParams(query: Request['query']): Record<string, unknown> {
    if (!query) {
      return {};
    }

    try {
      return JSON.parse(JSON.stringify(query));
    } catch (error) {
      console.warn('Failed to serialize query parameters for debug payload', error);
      return {};
    }
  }

  private describeError(error: unknown, seen = new Set<unknown>()): Record<string, unknown> {
    if (error === null) {
      return { type: 'NullError' };
    }

    if (error === undefined) {
      return { type: 'UndefinedError' };
    }

    if (typeof error === 'string') {
      return { type: 'StringError', message: error };
    }

    if (typeof error === 'number') {
      return { type: 'NumberError', value: error };
    }

    if (typeof error === 'boolean') {
      return { type: 'BooleanError', value: error };
    }

    if (error instanceof ShopError) {
      return {
        type: 'ShopError',
        code: error.code,
        status: error.status,
        message: error.message,
      };
    }

    if (error instanceof Error) {
      if (seen.has(error)) {
        return {
          type: error.name || 'Error',
          message: error.message,
          note: 'circular error reference detected',
        };
      }

      seen.add(error);

      const payload: Record<string, unknown> = {
        type: error.name || 'Error',
        message: error.message,
      };

      const withCode = error as NodeJS.ErrnoException;
      if (typeof withCode.code === 'string') {
        payload.code = withCode.code;
      }

      const withStatus = error as { status?: number };
      if (typeof withStatus.status === 'number') {
        payload.status = withStatus.status;
      }

      if (error.stack) {
        payload.stack = error.stack;
      }

      const withCause = error as { cause?: unknown };
      if (withCause.cause !== undefined) {
        payload.cause = this.describeError(withCause.cause, seen);
      }

      return payload;
    }

    if (typeof error === 'object') {
      if (seen.has(error)) {
        return { type: 'CircularReference' };
      }

      seen.add(error);

      const prototype = Object.getPrototypeOf(error);
      const typeName = prototype && prototype.constructor ? prototype.constructor.name : 'Object';
      const payload: Record<string, unknown> = { type: typeName };

      for (const [key, value] of Object.entries(error as Record<string, unknown>)) {
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          payload[key] = value;
        }
      }

      return payload;
    }

    return { type: typeof error };
  }

  private handleTestBeep(_req: Request, res: Response): void {
    if (!this.discordBridge.hasActiveVoiceConnection()) {
      res
        .status(503)
        .json({ error: 'VOICE_CONNECTION_UNAVAILABLE', message: 'Le bot est déconnecté du salon vocal.' });
      return;
    }

    try {
      const buffer = this.createTestBeepBuffer();
      const written = this.discordBridge.pushAnonymousAudio(buffer);
      res.status(202).json({ ok: true, written });
    } catch (error) {
      console.error('Impossible de générer le bip de test', error);
      res.status(500).json({ error: 'BEEP_FAILED', message: "Le bip de test n'a pas pu être envoyé." });
    }
  }

  private createTestBeepBuffer(): Buffer {
    const sampleRate = this.config.audio.sampleRate > 0 ? this.config.audio.sampleRate : 48000;
    const channels = this.config.audio.channels > 0 ? this.config.audio.channels : 2;
    const bytesPerSample = this.config.audio.bytesPerSample > 0 ? this.config.audio.bytesPerSample : 2;
    const durationMs = 120;
    const frequency = 880;
    const totalSamples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
    const fadeSamples = Math.min(Math.floor(sampleRate * 0.005), Math.floor(totalSamples / 4));
    const amplitude = 0.28 * 0x7fff;

    if (bytesPerSample !== 2) {
      throw new Error(`Unsupported audio format: expected 16-bit PCM, got ${bytesPerSample * 8}-bit`);
    }

    const buffer = Buffer.alloc(totalSamples * channels * bytesPerSample);

    for (let i = 0; i < totalSamples; i++) {
      const time = i / sampleRate;
      const envelope = this.computeEnvelope(i, totalSamples, fadeSamples);
      const value = Math.round(Math.sin(2 * Math.PI * frequency * time) * amplitude * envelope);

      for (let channel = 0; channel < channels; channel++) {
        const offset = (i * channels + channel) * bytesPerSample;
        buffer.writeInt16LE(value, offset);
      }
    }

    return buffer;
  }

  private computeEnvelope(index: number, totalSamples: number, fadeSamples: number): number {
    if (fadeSamples <= 0) {
      return 1;
    }

    if (index < fadeSamples) {
      return index / fadeSamples;
    }

    if (index >= totalSamples - fadeSamples) {
      return Math.max(0, totalSamples - index - 1) / fadeSamples;
    }

    return 1;
  }

  private normalizeIp(ip: string | null | undefined): string {
    if (!ip) {
      return 'unknown';
    }

    const trimmed = ip.trim();
    if (trimmed.startsWith('::ffff:')) {
      return trimmed.slice(7);
    }

    return trimmed;
  }

  private getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const [first] = forwarded.split(',');
      if (first) {
        return this.normalizeIp(first);
      }
    } else if (Array.isArray(forwarded)) {
      for (const value of forwarded) {
        if (typeof value === 'string' && value.length > 0) {
          const [first] = value.split(',');
          if (first) {
            return this.normalizeIp(first);
          }
        }
      }
    }

    return this.normalizeIp(req.ip ?? req.socket.remoteAddress ?? null);
  }

  private handleStreamRequest(req: Request, res: Response): void {
    const mimeType = this.config.mimeTypes[this.config.outputFormat] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Accept-Ranges', 'none');

    const clientIp = this.getClientIp(req);

    try {
      req.socket.setNoDelay(true);
    } catch (error) {
      console.warn('Unable to disable Nagle algorithm for stream socket', error);
    }

    const flushableRes = res as FlushCapableResponse;
    if (typeof flushableRes.flushHeaders === 'function') {
      flushableRes.flushHeaders();
    }

    const headerBuffer = this.transcoder.getHeaderBuffer();
    if (headerBuffer && headerBuffer.length > 0) {
      try {
        res.write(headerBuffer);
        if (typeof flushableRes.flush === 'function') {
          flushableRes.flush();
        }
      } catch (error) {
        console.warn('Failed to send initial stream header buffer', error);
      }
    }

    console.log(
      `New client for ${this.config.streamEndpoint}`,
      clientIp,
      'headerBuffer:',
      headerBuffer.length,
    );

    const clientStream = this.transcoder.createClientStream();
    clientStream.pipe(res);

    let closed = false;

    const previousConnectionCount = this.streamListenersByIp.get(clientIp) ?? 0;
    const nextConnectionCount = previousConnectionCount + 1;
    this.streamListenersByIp.set(clientIp, nextConnectionCount);

    if (previousConnectionCount === 0) {
      const incrementResult = this.listenerStatsService.increment();
      if (incrementResult) {
        console.log('Stream listener connected', {
          ip: clientIp,
          listeners: incrementResult.count,
        });
      }
    } else {
      console.log('Stream listener connected', {
        ip: clientIp,
        connectionsForIp: nextConnectionCount,
        listeners: this.listenerStatsService.getCurrentCount(),
      });
    }

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      this.transcoder.releaseClientStream(clientStream);

      const currentConnections = this.streamListenersByIp.get(clientIp) ?? 0;
      const remainingConnections = Math.max(0, currentConnections - 1);

      if (remainingConnections <= 0) {
        this.streamListenersByIp.delete(clientIp);
        const update = this.listenerStatsService.decrement();
        console.log('Stream listener disconnected', {
          ip: clientIp,
          listeners: update?.count ?? this.listenerStatsService.getCurrentCount(),
        });
      } else {
        this.streamListenersByIp.set(clientIp, remainingConnections);
        console.log('Stream listener disconnected', {
          ip: clientIp,
          remainingConnectionsForIp: remainingConnections,
          listeners: this.listenerStatsService.getCurrentCount(),
        });
      }
    };

    const handleClose = (): void => {
      cleanup();
    };

    req.on('close', handleClose);
    req.on('error', handleClose);
    res.on('close', handleClose);
    res.on('finish', handleClose);
    res.on('error', handleClose);
    clientStream.on('error', handleClose);
  }

  public start(): Server {
    if (this.httpServer) {
      return this.httpServer;
    }

    this.httpServer = this.app.listen(this.config.port, () => {
      console.log(`HTTP server listening on http://0.0.0.0:${this.config.port}`);
    });

    this.initializeWebSocketServer();

    return this.httpServer;
  }

  public stop(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    if (this.hypeLeaderboardService) {
      try {
        this.hypeLeaderboardService.stop();
      } catch (error) {
        console.warn('Failed to stop hype leaderboard service', error);
      }
    }
    if (this.wsServer) {
      try {
        for (const client of this.wsServer.clients) {
          client.terminate();
        }
        this.wsServer.close();
      } catch (error) {
        console.warn('Failed to close WebSocket server', error);
      }
      this.wsServer = null;
    }
    if (this.unsubscribeListenerStats) {
      try {
        this.unsubscribeListenerStats();
      } catch (error) {
        console.warn('Failed to unsubscribe listener stats updates', error);
      }
    }
    if (this.blogRepository) {
      this.blogRepository
        .close()
        .catch((error) => console.warn('Failed to close blog repository', error));
    }
  }

  private initializeWebSocketServer(): void {
    if (!this.httpServer) {
      return;
    }
    this.wsServer = new WebSocketServer({ server: this.httpServer, path: '/anonymous-stream' });
    this.wsServer.on('connection', (socket, request) => {
      this.anonymousSpeechManager.handleSocketConnection(socket, request);
    });
    this.wsServer.on('error', (error) => {
      console.warn('WebSocket server error', error);
    });
  }

  private extractAnonymousToken(req: Request): string | null {
    const header = req.header('authorization') || req.header('Authorization');
    if (header && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim() || null;
    }

    if (req.body && typeof req.body.token === 'string') {
      return req.body.token.trim() || null;
    }

    if (typeof req.query?.token === 'string') {
      return String(req.query.token).trim() || null;
    }

    return null;
  }

  private handleAnonymousSlotError(res: Response, error: unknown): void {
    if (error && typeof error === 'object' && 'status' in error && 'code' in error) {
      const slotError = error as { status?: number; code?: string; message?: string };
      const status = Number(slotError.status) || 500;
      res.status(status).json({ error: slotError.code ?? 'UNKNOWN', message: slotError.message ?? 'Erreur inconnue.' });
      return;
    }

    console.error('Unhandled anonymous slot error', error);
    res.status(500).json({ error: 'UNKNOWN', message: 'Une erreur inattendue est survenue.' });
  }

  private handleShopError(res: Response, error: unknown): void {
    if (error instanceof ShopError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }

    console.error('Unhandled shop error', error);
    res.status(500).json({ error: 'SHOP_UNKNOWN', message: 'Impossible de finaliser la commande.' });
  }

  private normalizeShopProvider(raw: unknown): ShopProvider | null {
    if (typeof raw !== 'string') {
      return null;
    }

    const normalized = raw.trim().toLowerCase();
    if (normalized === 'stripe' || normalized === 'coingate' || normalized === 'paypal') {
      return normalized;
    }

    return null;
  }
}
