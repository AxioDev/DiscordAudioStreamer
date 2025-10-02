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
import type {
  HypeLeaderboardQueryOptions,
  HypeLeaderboardSortBy,
  HypeLeaderboardSortOrder,
  UserMessageActivityEntry,
  UserVoiceActivitySegment,
  UserVoicePresenceSegment,
} from '../services/VoiceActivityRepository';
import HypeLeaderboardService, {
  type HypeLeaderboardResult,
  type NormalizedHypeLeaderboardQueryOptions,
} from '../services/HypeLeaderboardService';

export interface AppServerOptions {
  config: Config;
  transcoder: FfmpegTranscoder;
  speakerTracker: SpeakerTracker;
  sseService: SseService;
  anonymousSpeechManager: AnonymousSpeechManager;
  discordBridge: DiscordAudioBridge;
  shopService: ShopService;
  voiceActivityRepository?: VoiceActivityRepository | null;
}

type FlushCapableResponse = Response & {
  flushHeaders?: () => void;
  flush?: () => void;
};

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

  constructor({
    config,
    transcoder,
    speakerTracker,
    sseService,
    anonymousSpeechManager,
    discordBridge,
    shopService,
    voiceActivityRepository = null,
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
      ? new HypeLeaderboardService({ repository: voiceActivityRepository })
      : null;

    this.configureMiddleware();
    this.registerRoutes();
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

  private buildProfileSummary(
    range: { since: Date; until: Date },
    presenceSegments: UserVoicePresenceSegment[],
    speakingSegments: UserVoiceActivitySegment[],
    messageEvents: UserMessageActivityEntry[],
  ): Record<string, unknown> {
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
          profile,
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
      if (!this.voiceActivityRepository || !this.hypeLeaderboardService) {
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
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
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
        res.json({ leaders: result.leaders, snapshot: result.snapshot });
      } catch (error) {
        console.error('Failed to retrieve hype leaderboard', error);
        res.status(500).json({
          error: 'HYPE_LEADERBOARD_FETCH_FAILED',
          message: "Impossible de récupérer le classement hype.",
        });
      }
    });

    this.app.get('/classements', (_req, res) => {
      res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'classements.html'));
    });

    this.app.get('/membres', (_req, res) => {
      res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
    });

    this.app.get('/', (_req, res) => {
      res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
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
      req.ip,
      'headerBuffer:',
      headerBuffer.length,
    );

    const clientStream = this.transcoder.createClientStream();
    clientStream.pipe(res);

    req.on('close', () => {
      this.transcoder.releaseClientStream(clientStream);
      console.log('Client disconnected', req.ip);
    });
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
