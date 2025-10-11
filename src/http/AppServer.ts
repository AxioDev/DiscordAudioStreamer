import compression from 'compression';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import minifyHTML from 'express-minify-html-terser';
import fs from 'fs';
import path from 'path';
import type { Server } from 'http';
import { icons as lucideIcons, type IconNode } from 'lucide';
import type FfmpegTranscoder from '../audio/FfmpegTranscoder';
import type SpeakerTracker from '../services/SpeakerTracker';
import type { Participant, BridgeStatus } from '../services/SpeakerTracker';
import type SseService from '../services/SseService';
import type AnonymousSpeechManager from '../services/AnonymousSpeechManager';
import type { Config } from '../config';
import { WebSocketServer } from 'ws';
import type DiscordAudioBridge from '../discord/DiscordAudioBridge';
import type { DiscordUserIdentity } from '../discord/DiscordAudioBridge';
import type ShopService from '../services/ShopService';
import { ShopError, type ShopProvider, type PublicProduct } from '../services/ShopService';
import type VoiceActivityRepository from '../services/VoiceActivityRepository';
import ListenerStatsService, {
  type ListenerStatsEntry,
  type ListenerStatsUpdate,
} from '../services/ListenerStatsService';
import BlogService, {
  type BlogListOptions,
  type BlogPostDetail,
  type BlogPostSummary,
} from '../services/BlogService';
import BlogRepository, {
  type BlogPostProposalRow,
  type BlogPostRow,
} from '../services/BlogRepository';
import BlogProposalService, { BlogProposalError } from '../services/BlogProposalService';
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
  type HypeLeaderWithTrend,
  type HypeLeaderboardResult,
  type NormalizedHypeLeaderboardQueryOptions,
} from '../services/HypeLeaderboardService';
import SeoRenderer, {
  type AssetManifest,
  type AssetScriptDescriptor,
  type SeoPageMetadata,
} from './SeoRenderer';
import AdminService, { type HiddenMemberRecord } from '../services/AdminService';
import DailyArticleService, { type DailyArticleServiceStatus } from '../services/DailyArticleService';
import SitemapLastModStore from './SitemapLastModStore';
import StatisticsService, {
  type CommunityStatisticsSnapshot,
  type StatisticsQueryOptions,
} from '../services/StatisticsService';

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
  blogProposalService?: BlogProposalService | null;
  dailyArticleService?: DailyArticleService | null;
  adminService: AdminService;
  statisticsService: StatisticsService;
}

type FlushCapableResponse = Response & {
  flushHeaders?: () => void;
  flush?: () => void;
};

const MANUAL_BLOG_TRIGGER_PASSWORD = '1234';

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

interface SitemapEntry {
  loc: string;
  lastMod?: string | null;
  changeFreq?: string | null;
  priority?: number | null;
}

interface SitemapComputationContext {
  latestBlogPostDate: string | null;
  latestProfileActivityAt: string | null;
  latestClassementsSnapshot: string | null;
  shopCatalogUpdatedAt: string | null;
}

interface AppShellRenderOptions {
  status?: number;
  appHtml?: string | null;
  preloadState?: unknown;
}

interface AppRouteDescriptor {
  name: string;
  params?: Record<string, unknown>;
}

interface ListenerStatsBootstrap {
  count: number;
  history: ListenerStatsEntry[];
}

interface AdminBlogPostRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverImageUrl: string | null;
  tags: string[];
  seoDescription: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

interface AdminBlogProposalRecord {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverImageUrl: string | null;
  tags: string[];
  seoDescription: string | null;
  authorName: string | null;
  authorContact: string | null;
  reference: string;
  submittedAt: string | null;
}

interface AdminListRequestParams {
  page: number;
  perPage: number;
  sortField: string | null;
  sortOrder: 'asc' | 'desc';
  filters: Record<string, unknown>;
}

type AdminHiddenMemberRecord = HiddenMemberRecord & { id: string };

interface HomePageBootstrap {
  listenerCount: number;
  latestPosts: Array<{
    title: string;
    slug: string;
    excerpt: string | null;
    date: string | null;
  }>;
  speakers: Array<{
    id: string;
    displayName: string;
    avatarUrl: string | null;
    isSpeaking: boolean;
    lastSpokeAt: string | null;
  }>;
}

interface BlogPageBootstrap {
  posts?: BlogPostSummary[];
  availableTags?: string[];
  selectedTags?: string[];
  activePost?: BlogPostDetail | null;
}

interface ClassementLeaderBootstrap {
  userId: string;
  displayName: string | null;
  username: string | null;
  rank: number;
  absoluteRank: number | null;
  avatar: string | null;
  avatarUrl: string | null;
  profileAvatar: string | null;
  activityScore: number;
  arrivalEffect: number;
  departureEffect: number;
  schScoreNorm: number;
  retentionMinutes: number;
  sessions: number;
  positionTrend: {
    movement: string;
    delta: number | null;
    comparedAt: string | null;
  } | null;
}

interface ClassementsPageBootstrap {
  query: {
    search: string;
    sortBy: HypeLeaderboardSortBy;
    sortOrder: HypeLeaderboardSortOrder;
    period: string;
  };
  leaders: ClassementLeaderBootstrap[];
  snapshot: { bucketStart: string | null; comparedTo: string | null } | null;
}

interface ShopPageBootstrap {
  products: PublicProduct[];
}

interface StatisticsPageBootstrap {
  snapshot: CommunityStatisticsSnapshot;
}

interface AppPreloadState {
  route?: AppRouteDescriptor;
  participants?: Participant[];
  listenerStats?: ListenerStatsBootstrap;
  pages?: {
    home?: HomePageBootstrap;
    blog?: BlogPageBootstrap;
    classements?: ClassementsPageBootstrap;
    shop?: ShopPageBootstrap;
    statistiques?: StatisticsPageBootstrap;
  };
  bridgeStatus?: BridgeStatus;
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

  private readonly blogProposalService: BlogProposalService;

  private readonly seoRenderer: SeoRenderer;

  private readonly dailyArticleService: DailyArticleService | null;

  private readonly adminService: AdminService;

  private readonly adminCredentials: { username: string; password: string } | null;

  private readonly secretArticleTrigger: { path: string; password: string } | null;

  private readonly serverBootTimestamp: string;

  private readonly sitemapLastModStore: SitemapLastModStore;

  private readonly statisticsService: StatisticsService;

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
    blogProposalService = null,
    dailyArticleService = null,
    adminService,
    statisticsService,
  }: AppServerOptions) {
    this.config = config;
    this.transcoder = transcoder;
    this.speakerTracker = speakerTracker;
    this.sseService = sseService;
    this.anonymousSpeechManager = anonymousSpeechManager;
    this.discordBridge = discordBridge;
    this.shopService = shopService;
    this.voiceActivityRepository = voiceActivityRepository;
    this.dailyArticleService = dailyArticleService ?? null;
    this.adminService = adminService;
    this.statisticsService = statisticsService;
    const adminUsername = this.config.admin?.username ?? null;
    const adminPassword = this.config.admin?.password ?? null;
    this.adminCredentials =
      adminUsername && adminPassword
        ? { username: adminUsername, password: adminPassword }
        : null;
    const secretArticlePath = this.config.secretArticleTrigger?.path ?? null;
    const secretArticlePassword = this.config.secretArticleTrigger?.password ?? null;
    this.secretArticleTrigger =
      secretArticlePath && secretArticlePassword
        ? { path: secretArticlePath, password: secretArticlePassword }
        : null;
    this.serverBootTimestamp = new Date().toISOString();
    this.sitemapLastModStore = new SitemapLastModStore(
      path.resolve(__dirname, '..', '..', 'content', 'cache', 'sitemap-lastmod.json'),
    );
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
        ? new BlogRepository({
            url: config.database.url,
            ssl: config.database.ssl,
            debug: config.database.logQueries,
          })
        : null);

    this.blogService =
      blogService ??
      new BlogService({
        postsDirectory: path.resolve(__dirname, '..', '..', 'content', 'blog'),
        repository: this.blogRepository,
      });

    this.blogProposalService =
      blogProposalService ??
      new BlogProposalService({
        proposalsDirectory: path.resolve(__dirname, '..', '..', 'content', 'blog', 'proposals'),
        repository: this.blogRepository,
        blogService: this.blogService,
      });

    void this.blogProposalService.initialize().catch((error) => {
      console.error('Failed to initialize blog proposal service', error);
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

    const assetManifestPath = path.resolve(__dirname, '..', '..', 'public', 'assets', 'manifest.json');
    const assetManifest = this.loadAssetManifest(assetManifestPath);
    if (!assetManifest) {
      console.warn(`Asset manifest not found or invalid at ${assetManifestPath}.`);
    }
    this.seoRenderer.updateAssetManifest(assetManifest);

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

  private parseStatisticsQuery(query: Request['query']): StatisticsQueryOptions {
    const source = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;

    const extractString = (value: unknown): string | null => {
      if (Array.isArray(value)) {
        for (const entry of value) {
          const candidate = extractString(entry);
          if (candidate) {
            return candidate;
          }
        }
        return null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      return null;
    };

    const extractStringArray = (value: unknown): string[] => {
      const result: string[] = [];
      const visit = (input: unknown): void => {
        if (Array.isArray(input)) {
          for (const item of input) {
            visit(item);
          }
          return;
        }
        if (typeof input === 'string') {
          input
            .split(/[;,]/)
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0)
            .forEach((segment) => {
              if (!result.includes(segment)) {
                result.push(segment);
              }
            });
        }
      };
      visit(value);
      return result;
    };

    const parseDate = (value: string | null): Date | null => {
      if (!value) {
        return null;
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const parseNumber = (value: string | null): number | null => {
      if (!value) {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };

    const parseBoolean = (value: string | null): boolean | null => {
      if (!value) {
        return null;
      }
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on', 'vrai'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'off', 'faux'].includes(normalized)) {
        return false;
      }
      return null;
    };

    const sinceRaw = extractString(source.since ?? source.from ?? source.start);
    const untilRaw = extractString(source.until ?? source.to ?? source.end);
    const granularity = extractString(source.granularity ?? source.range ?? source.interval ?? source.bucket);

    const activityTypes = extractStringArray(source.activity ?? source.activities ?? source.type ?? source.types);
    const channelIds = extractStringArray(source.channel ?? source.channelId ?? source.channels);
    const retentionValues = extractStringArray(source.retention ?? source.retentionDays ?? source.retention_window);
    const retentionWindows = retentionValues
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);

    const limitTopMembers = parseNumber(extractString(source.limitTop ?? source.top ?? source.limit));
    const limitChannels = parseNumber(
      extractString(source.limitChannels ?? source.channelsLimit ?? source.limitChannelsTop),
    );

    const includeHeatmap = parseBoolean(extractString(source.heatmap ?? source.includeHeatmap));
    const includeHypeHistory = parseBoolean(
      extractString(source.hype ?? source.includeHype ?? source.hypeHistory),
    );

    const userSearch = extractString(source.userSearch ?? source.searchUser ?? source.search);
    const userId = extractString(source.userId ?? source.member ?? source.user);

    const options: StatisticsQueryOptions = {
      since: parseDate(sinceRaw),
      until: parseDate(untilRaw),
      granularity: granularity ?? undefined,
      activityTypes: activityTypes.length > 0 ? activityTypes : undefined,
      channelIds: channelIds.length > 0 ? channelIds : undefined,
      userId: userId ?? undefined,
      retentionWindowDays: retentionWindows.length > 0 ? retentionWindows : undefined,
      userSearch: userSearch ?? undefined,
    };

    if (Number.isFinite(limitTopMembers)) {
      options.limitTopMembers = limitTopMembers ?? undefined;
    }
    if (Number.isFinite(limitChannels)) {
      options.limitChannels = limitChannels ?? undefined;
    }
    if (includeHeatmap !== null) {
      options.includeHeatmap = includeHeatmap;
    }
    if (includeHypeHistory !== null) {
      options.includeHypeHistory = includeHypeHistory;
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

  private respondWithAppShell(
    res: Response,
    metadata: SeoPageMetadata,
    statusOrOptions: number | AppShellRenderOptions = 200,
  ): void {
    try {
      const options = typeof statusOrOptions === 'number' ? { status: statusOrOptions } : statusOrOptions ?? {};
      const preloadState: AppPreloadState | undefined = {
        ...(options.preloadState ?? {}),
        bridgeStatus: this.speakerTracker.getBridgeStatus(),
      };
      const html = this.seoRenderer.render(metadata, {
        appHtml: options.appHtml ?? null,
        preloadState,
      });
      const status = options.status ?? 200;
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

  private toAbsoluteMediaUrl(rawUrl: string | null | undefined): string | null {
    if (!rawUrl) {
      return null;
    }

    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return null;
    }

    if (/^data:/i.test(trimmed)) {
      return trimmed;
    }

    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    if (trimmed.startsWith('//')) {
      return `https:${trimmed}`;
    }

    if (trimmed.startsWith('/')) {
      return this.toAbsoluteUrl(trimmed);
    }

    return this.toAbsoluteUrl(`/${trimmed.replace(/^\/+/, '')}`);
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

  private getStaticSitemapDescriptors(): Array<{
    path: string;
    changeFreq?: SitemapEntry['changeFreq'];
    priority?: SitemapEntry['priority'];
  }> {
    return [
      { path: '/', changeFreq: 'daily', priority: 1 },
      { path: '/membres', changeFreq: 'daily', priority: 0.8 },
      { path: '/members', changeFreq: 'daily', priority: 0.8 },
      { path: '/boutique', changeFreq: 'weekly', priority: 0.6 },
      { path: '/premium', changeFreq: 'monthly', priority: 0.5 },
      { path: '/statistiques', changeFreq: 'hourly', priority: 0.75 },
      { path: '/classements', changeFreq: 'hourly', priority: 0.7 },
      { path: '/blog', changeFreq: 'daily', priority: 0.7 },
      { path: '/blog/proposer', changeFreq: 'monthly', priority: 0.5 },
      { path: '/about', changeFreq: 'monthly', priority: 0.5 },
      { path: '/cgu', changeFreq: 'yearly', priority: 0.4 },
    ];
  }

  private async buildSitemapEntries(): Promise<SitemapEntry[]> {
    const context = await this.buildSitemapContext();
    const entries: SitemapEntry[] = this.getStaticSitemapDescriptors().map((descriptor) => {
      const lastMod = this.formatSitemapDate(this.getStaticPageLastMod(descriptor.path, context));
      return {
        loc: this.toAbsoluteUrl(descriptor.path),
        changeFreq: descriptor.changeFreq,
        priority: descriptor.priority,
        lastMod,
      } satisfies SitemapEntry;
    });

    const blogEntries = await this.buildBlogSitemapEntries();
    for (const entry of blogEntries) {
      entries.push(entry);
    }

    const profileEntries = await this.buildProfileSitemapEntries();
    for (const entry of profileEntries) {
      entries.push(entry);
    }

    await this.sitemapLastModStore.flush();

    return entries;
  }

  private async buildSitemapContext(): Promise<SitemapComputationContext> {
    const [latestBlogPostDate, latestProfileActivityAt, latestClassementsSnapshot] = await Promise.all([
      this.resolveLatestBlogPostDate(),
      this.resolveLatestProfileActivityAt(),
      this.resolveLatestClassementsSnapshot(),
    ]);

    const shopCatalogUpdatedAt = this.shopService.getCatalogUpdatedAt();

    return {
      latestBlogPostDate: this.formatSitemapDate(latestBlogPostDate),
      latestProfileActivityAt: this.formatSitemapDate(latestProfileActivityAt),
      latestClassementsSnapshot: this.formatSitemapDate(latestClassementsSnapshot),
      shopCatalogUpdatedAt: this.formatSitemapDate(shopCatalogUpdatedAt),
    };
  }

  private async resolveLatestBlogPostDate(): Promise<string | null> {
    try {
      const { posts } = await this.blogService.listPosts({ limit: 1, sortBy: 'date', sortOrder: 'desc' });
      if (!posts || posts.length === 0) {
        return null;
      }
      const [latest] = posts;
      return latest?.updatedAt ?? latest?.date ?? null;
    } catch (error) {
      console.warn('Failed to resolve latest blog post date for sitemap', error);
      return null;
    }
  }

  private async resolveLatestProfileActivityAt(): Promise<string | null> {
    if (!this.voiceActivityRepository) {
      return null;
    }

    try {
      const activeUsers = await this.voiceActivityRepository.listActiveUsers({ limit: 1 });
      const latest = activeUsers?.[0]?.lastActivityAt;
      return latest instanceof Date ? latest.toISOString() : null;
    } catch (error) {
      console.warn('Failed to resolve latest member activity for sitemap', error);
      return null;
    }
  }

  private async resolveLatestClassementsSnapshot(): Promise<string | null> {
    const service = this.hypeLeaderboardService;
    if (!service) {
      return null;
    }

    try {
      const defaultOptions = service.getDefaultOptions();
      const options: NormalizedHypeLeaderboardQueryOptions = {
        ...defaultOptions,
        limit: 1,
      };
      const result = await this.getCachedHypeLeaders(options);
      return result.snapshot?.bucketStart?.toISOString?.() ?? null;
    } catch (error) {
      console.warn('Failed to resolve hype leaderboard snapshot for sitemap', error);
      return null;
    }
  }

  private getStaticPageLastMod(path: string, context: SitemapComputationContext): string | null {
    const candidates: Array<string | null> = (() => {
      switch (path) {
        case '/':
          return [
            context.latestBlogPostDate,
            context.latestClassementsSnapshot,
            context.latestProfileActivityAt,
            context.shopCatalogUpdatedAt,
          ];
        case '/membres':
        case '/members':
          return [context.latestProfileActivityAt];
        case '/boutique':
          return [context.shopCatalogUpdatedAt, context.latestClassementsSnapshot];
        case '/premium':
          return [context.shopCatalogUpdatedAt];
        case '/classements':
          return [context.latestClassementsSnapshot];
        case '/blog':
        case '/blog/proposer':
          return [context.latestBlogPostDate];
        case '/about':
        case '/cgu':
        default:
          return [];
      }
    })();

    const latest = this.pickLatestTimestamp(candidates);
    if (latest) {
      this.sitemapLastModStore.update(path, latest);
      return latest;
    }

    const persisted = this.sitemapLastModStore.get(path);
    if (persisted) {
      return persisted;
    }

    this.sitemapLastModStore.update(path, this.serverBootTimestamp);
    return this.serverBootTimestamp;
  }

  private pickLatestTimestamp(values: Array<string | null | undefined>): string | null {
    let latestMs = Number.NEGATIVE_INFINITY;

    for (const value of values) {
      if (!value) {
        continue;
      }
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        continue;
      }
      const time = parsed.getTime();
      if (time > latestMs) {
        latestMs = time;
      }
    }

    if (!Number.isFinite(latestMs) || latestMs === Number.NEGATIVE_INFINITY) {
      return null;
    }

    return new Date(latestMs).toISOString();
  }

  private async buildBlogSitemapEntries(): Promise<SitemapEntry[]> {
    try {
      const { posts } = await this.blogService.listPosts({
        limit: 500,
        sortBy: 'date',
        sortOrder: 'desc',
      });

      return posts
        .filter((post) => typeof post?.slug === 'string' && post.slug.trim().length > 0)
        .map((post) => {
          const slug = post.slug.trim();
          const lastMod = this.formatSitemapDate(post.updatedAt ?? post.date);
          return {
            loc: this.toAbsoluteUrl(`/blog/${slug}`),
            lastMod,
            changeFreq: 'monthly',
            priority: 0.6,
          } satisfies SitemapEntry;
        });
    } catch (error) {
      console.error('Failed to list blog posts for sitemap', error);
      return [];
    }
  }

  private async buildProfileSitemapEntries(): Promise<SitemapEntry[]> {
    if (!this.voiceActivityRepository) {
      return [];
    }

    try {
      const [activeUsers, hiddenIds] = await Promise.all([
        this.voiceActivityRepository.listActiveUsers({ limit: 200 }),
        this.adminService.getHiddenMemberIds(),
      ]);

      return activeUsers
        .filter((entry) => entry && typeof entry.userId === 'string' && !hiddenIds.has(entry.userId))
        .map((entry) => ({
          loc: this.toAbsoluteUrl(`/profil/${encodeURIComponent(entry.userId)}`),
          lastMod: entry.lastActivityAt ? this.formatSitemapDate(entry.lastActivityAt.toISOString()) : null,
          changeFreq: 'weekly',
          priority: 0.5,
        }));
    } catch (error) {
      console.error('Failed to build profile sitemap entries', error);
      return [];
    }
  }

  private formatSitemapDate(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
  }

  private renderSitemap(entries: SitemapEntry[]): string {
    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for (const entry of entries) {
      if (!entry || typeof entry.loc !== 'string' || entry.loc.length === 0) {
        continue;
      }
      lines.push('  <url>');
      lines.push(`    <loc>${this.escapeXml(entry.loc)}</loc>`);
      if (entry.lastMod) {
        lines.push(`    <lastmod>${this.escapeXml(entry.lastMod)}</lastmod>`);
      }
      if (entry.changeFreq) {
        lines.push(`    <changefreq>${this.escapeXml(entry.changeFreq)}</changefreq>`);
      }
      if (typeof entry.priority === 'number' && Number.isFinite(entry.priority)) {
        const priority = Math.min(Math.max(entry.priority, 0), 1).toFixed(1);
        lines.push(`    <priority>${priority}</priority>`);
      }
      lines.push('  </url>');
    }
    lines.push('</urlset>');
    return lines.join('\n');
  }

  private parseAdminListRequest(req: Request): AdminListRequestParams {
    const extractSingle = (value: unknown): string | null => {
      if (Array.isArray(value)) {
        return value.length > 0 ? extractSingle(value[0]) : null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      return null;
    };

    const rawPage = extractSingle(req.query?.page);
    const parsedPage = rawPage ? Number.parseInt(rawPage, 10) : NaN;
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

    const rawPerPage = extractSingle(req.query?.perPage);
    const parsedPerPage = rawPerPage ? Number.parseInt(rawPerPage, 10) : NaN;
    const perPage = Math.min(Math.max(Number.isFinite(parsedPerPage) && parsedPerPage > 0 ? parsedPerPage : 25, 1), 100);

    const rawSort = extractSingle(req.query?.sort);
    const sortField = rawSort && rawSort.length > 0 ? rawSort : null;

    const rawOrder = extractSingle(req.query?.order);
    const normalizedOrder = rawOrder ? rawOrder.toLowerCase() : null;
    const sortOrder = normalizedOrder === 'asc' ? 'asc' : 'desc';

    const rawFilter = extractSingle(req.query?.filter);
    let filters: Record<string, unknown> = {};
    if (rawFilter) {
      try {
        const parsed = JSON.parse(rawFilter);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          filters = parsed as Record<string, unknown>;
        }
      } catch (error) {
        console.warn('Failed to parse admin filter query', error);
      }
    }

    return { page, perPage, sortField, sortOrder, filters };
  }

  private extractAdminSearchFilter(filters: Record<string, unknown>): string | null {
    const candidates = ['q', 'query', 'search'];
    for (const key of candidates) {
      const value = filters?.[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return null;
  }

  private extractAdminTagsFilter(filters: Record<string, unknown>): string[] | null {
    const raw = filters?.tags;
    if (!raw) {
      return null;
    }

    const normalize = (value: unknown): string | null => {
      if (typeof value !== 'string') {
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    if (Array.isArray(raw)) {
      const tags = raw.map((entry) => normalize(entry)).filter((entry): entry is string => Boolean(entry));
      return tags.length > 0 ? tags : null;
    }

    if (typeof raw === 'string') {
      const tags = raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return tags.length > 0 ? tags : null;
    }

    return null;
  }

  private extractAdminOnlyPublishedFilter(filters: Record<string, unknown>): boolean {
    const raw = filters?.onlyPublished;
    if (typeof raw === 'boolean') {
      return raw;
    }
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase();
      return normalized === 'true' || normalized === '1';
    }
    return false;
  }

  private parseAdminBlogPostInput(
    raw: unknown,
    options: { slugFallback?: string | null; allowSlugOverride?: boolean } = {},
  ): {
    ok: true;
    data: {
      slug: string;
      title: string;
      excerpt: string | null;
      contentMarkdown: string;
      coverImageUrl: string | null;
      tags: string[];
      seoDescription: string | null;
      publishedAt: Date;
      updatedAt: Date;
    };
  } | {
    ok: false;
    status: number;
    error: string;
    message: string;
  } {
    const body = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};

    const slugSource =
      options.allowSlugOverride && typeof body.slug === 'string'
        ? body.slug
        : typeof body.slug === 'string' && options.slugFallback == null
          ? body.slug
          : options.slugFallback ?? (typeof body.slug === 'string' ? body.slug : null);

    const slug = this.normalizeSlug(slugSource);
    if (!slug) {
      return {
        ok: false,
        status: 400,
        error: 'SLUG_REQUIRED',
        message: 'Un slug valide est requis pour cet article.',
      };
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return {
        ok: false,
        status: 400,
        error: 'TITLE_REQUIRED',
        message: "Le titre de l’article est obligatoire.",
      };
    }

    const contentMarkdown = typeof body.contentMarkdown === 'string' ? body.contentMarkdown : '';
    if (!contentMarkdown || contentMarkdown.trim().length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'CONTENT_REQUIRED',
        message: "Le contenu de l’article est obligatoire.",
      };
    }

    const excerpt = typeof body.excerpt === 'string' ? body.excerpt.trim() : null;
    const coverImageUrl = typeof body.coverImageUrl === 'string' ? body.coverImageUrl.trim() || null : null;
    const seoDescription = typeof body.seoDescription === 'string' ? body.seoDescription.trim() || null : null;
    const tags = this.normalizeAdminTags(body.tags);
    const publishedAt = this.parseDateInput(body.publishedAt) ?? new Date();
    const updatedAt = this.parseDateInput(body.updatedAt) ?? new Date();

    return {
      ok: true,
      data: {
        slug,
        title,
        excerpt,
        contentMarkdown,
        coverImageUrl,
        tags,
        seoDescription,
        publishedAt,
        updatedAt,
      },
    };
  }

  private normalizeAdminTags(input: unknown): string[] {
    if (!input) {
      return [];
    }
    if (Array.isArray(input)) {
      return input
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
    }
    if (typeof input === 'string') {
      return input
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return [];
  }

  private parseDateInput(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const fromNumber = new Date(value);
      return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        const fromNumeric = new Date(numeric);
        if (!Number.isNaN(fromNumeric.getTime())) {
          return fromNumeric;
        }
      }
      const fromString = new Date(trimmed);
      return Number.isNaN(fromString.getTime()) ? null : fromString;
    }

    return null;
  }

  private normalizeSlug(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const lowered = trimmed.toLowerCase().replace(/\s+/g, '-');
    const sanitized = lowered.replace(/[^a-z0-9\-_/]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');
    return sanitized.length > 0 ? sanitized : null;
  }

  private mapBlogPostRowToAdmin(row: BlogPostRow): AdminBlogPostRecord {
    const toIso = (value: Date | string | null | undefined): string | null => {
      if (!value) {
        return null;
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    };

    const normalizeArray = (value: string[] | null | undefined): string[] =>
      Array.isArray(value)
        ? value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter((entry) => entry.length > 0)
        : [];

    return {
      id: row.slug,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt ?? null,
      contentMarkdown: row.content_markdown,
      coverImageUrl: row.cover_image_url ?? null,
      tags: normalizeArray(row.tags),
      seoDescription: row.seo_description ?? null,
      publishedAt: toIso(row.published_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  private mapBlogProposalRowToAdmin(row: BlogPostProposalRow): AdminBlogProposalRecord {
    const toIso = (value: Date | string | null | undefined): string | null => {
      if (!value) {
        return null;
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    };

    const tags = Array.isArray(row.tags)
      ? row.tags.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter((entry) => entry.length > 0)
      : [];

    return {
      id: row.slug,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt ?? null,
      contentMarkdown: row.content_markdown,
      coverImageUrl: row.cover_image_url ?? null,
      tags,
      seoDescription: row.seo_description ?? null,
      authorName: row.author_name ?? null,
      authorContact: row.author_contact ?? null,
      reference: row.reference,
      submittedAt: toIso(row.submitted_at),
    };
  }

  private mapHiddenMemberRecord(record: HiddenMemberRecord): AdminHiddenMemberRecord {
    return {
      ...record,
      id: record.userId,
    };
  }

  private renderAdminAppShell(): string | null {
    const metadata: SeoPageMetadata = {
      title: `${this.config.siteName} · Administration`,
      description: 'Interface de gestion des contenus et des membres pour Libre Antenne.',
      path: '/admin',
      canonicalUrl: this.toAbsoluteUrl('/admin'),
      robots: 'noindex,nofollow',
      breadcrumbs: [
        { name: 'Accueil', path: '/' },
        { name: 'Administration', path: '/admin' },
      ],
    };

    const shell = this.seoRenderer.render(metadata, {
      appHtml: '<div id="admin-root" class="min-h-screen bg-slate-950 text-slate-100"></div>',
    });

    const manifest = this.seoRenderer.getAssetManifest();
    const descriptor = manifest?.entries?.admin;
    if (!descriptor) {
      return null;
    }

    const scriptTag = this.serializeScriptDescriptor(descriptor);
    return this.injectHtmlBeforeBodyClose(shell, `    ${scriptTag}\n`);
  }

  private serializeScriptDescriptor(descriptor: AssetScriptDescriptor): string {
    const attrs: string[] = [];
    const type = (descriptor.type ?? 'module').trim() || 'module';
    attrs.push(`type="${this.escapeHtml(type)}"`);
    attrs.push(`src="${this.escapeHtml(descriptor.src)}"`);
    if (descriptor.defer) {
      attrs.push('defer');
    }
    if (descriptor.async) {
      attrs.push('async');
    }
    if (descriptor.crossorigin) {
      attrs.push(`crossorigin="${this.escapeHtml(descriptor.crossorigin)}"`);
    }
    if (descriptor.integrity) {
      attrs.push(`integrity="${this.escapeHtml(descriptor.integrity)}"`);
    }
    return `<script ${attrs.join(' ')}></script>`;
  }

  private injectHtmlBeforeBodyClose(html: string, snippet: string): string {
    const closingTag = '</body>';
    const index = html.lastIndexOf(closingTag);
    if (index === -1) {
      return `${html}${snippet}`;
    }
    return `${html.slice(0, index)}${snippet}${html.slice(index)}`;
  }

  private loadAssetManifest(manifestPath: string): AssetManifest | null {
    try {
      if (!fs.existsSync(manifestPath)) {
        return null;
      }
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const data = JSON.parse(raw) as AssetManifest;
      return data;
    } catch (error) {
      console.warn(`Failed to load asset manifest at ${manifestPath}`, error);
      return null;
    }
  }

  private escapeXml(value: string): string {
    return value.replace(/[&<>"]|'/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&apos;';
        default:
          return char;
      }
    });
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"]|'/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });
  }

  private renderLucideIcon(name: string, className: string, options: { strokeWidth?: number } = {}): string {
    try {
      const iconDefinition = (lucideIcons as Record<string, IconNode | undefined> | undefined)?.[name];
      if (!Array.isArray(iconDefinition)) {
        return `<span class="${this.escapeHtml(className)}" aria-hidden="true"></span>`;
      }

      const strokeWidth = Number.isFinite(options.strokeWidth) ? Number(options.strokeWidth) : 2;
      const svgAttributes: Record<string, string | number | undefined> = {
        xmlns: 'http://www.w3.org/2000/svg',
        width: 24,
        height: 24,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': strokeWidth,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        class: className || undefined,
        'aria-hidden': 'true',
      };

      const attrString = Object.entries(svgAttributes)
        .filter(([, value]) => value !== undefined && value !== null && `${value}`.length > 0)
        .map(([key, value]) => `${key}="${this.escapeHtml(String(value))}"`)
        .join(' ');

      const childContent = (iconDefinition as IconNode)
        .map(([tag, attrs]) => {
          const childAttr = Object.entries(attrs ?? {})
            .filter(([, value]) => value !== undefined && value !== null && `${value}`.length > 0)
            .map(([key, value]) => `${key}="${this.escapeHtml(String(value))}"`)
            .join(' ');
          return `<${tag}${childAttr ? ' ' + childAttr : ''} />`;
        })
        .join('');

      return `<svg ${attrString}>${childContent}</svg>`;
    } catch (error) {
      return `<span class="${this.escapeHtml(className)}" aria-hidden="true"></span>`;
    }
  }

  private renderAvatarOrFallback(options: {
    avatarUrl: string | null | undefined;
    alt: string;
    displayName?: string | null;
    seed?: string | number | null;
    sizeClass?: string;
    className?: string;
    textClass?: string;
    loading?: 'lazy' | 'eager';
    decoding?: 'async' | 'auto' | 'sync';
  }): string {
    const {
      avatarUrl,
      alt,
      displayName,
      seed,
      sizeClass = '',
      className = '',
      textClass,
      loading = 'lazy',
      decoding = 'async',
    } = options;

    const baseClass = [sizeClass, className]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0)
      .join(' ')
      .trim();
    const imageClass = [baseClass, 'object-cover']
      .filter((value) => value.length > 0)
      .join(' ')
      .trim();
    const normalizedAlt = typeof alt === 'string' && alt.length > 0 ? alt : 'Avatar';
    const sanitizedAlt = this.escapeHtml(normalizedAlt);
    const normalizedUrl = typeof avatarUrl === 'string' && avatarUrl.trim().length > 0 ? avatarUrl.trim() : null;

    if (normalizedUrl) {
      const attributes = [
        `alt="${sanitizedAlt}"`,
        `src="${this.escapeHtml(normalizedUrl)}"`,
      ];
      if (imageClass.length > 0) {
        attributes.push(`class="${this.escapeHtml(imageClass)}"`);
      }
      if (loading) {
        attributes.push(`loading="${this.escapeHtml(loading)}"`);
      }
      if (decoding) {
        attributes.push(`decoding="${this.escapeHtml(decoding)}"`);
      }
      return `<img ${attributes.join(' ')} />`;
    }

    const initials = this.escapeHtml(this.computeInitials(displayName ?? normalizedAlt));
    const background = this.selectFallbackAvatarBackground(seed ?? displayName ?? normalizedAlt);
    const fallbackTextClass = typeof textClass === 'string' && textClass.trim().length > 0
      ? textClass.trim()
      : 'text-sm font-semibold text-white/90';
    const fallbackClass = [
      baseClass,
      'flex items-center justify-center bg-gradient-to-br',
      background,
      fallbackTextClass,
    ]
      .filter((value) => value.length > 0)
      .join(' ')
      .trim();

    return `<span role="img" aria-label="${sanitizedAlt}" class="${this.escapeHtml(fallbackClass)}">${initials}</span>`;
  }

  private computeInitials(source: string | null | undefined): string {
    const normalized = typeof source === 'string' ? source.trim() : '';
    if (!normalized) {
      return '∅';
    }
    const segments = normalized.split(/\s+/).filter(Boolean);
    if (segments.length === 1) {
      return segments[0].slice(0, 2).toUpperCase();
    }
    const first = segments[0]?.[0] ?? '';
    const last = segments[segments.length - 1]?.[0] ?? '';
    const initials = `${first}${last}`.trim();
    return initials ? initials.toUpperCase() : normalized.slice(0, 2).toUpperCase();
  }

  private selectFallbackAvatarBackground(seed: string | number | null | undefined): string {
    const palette = Array.from(AppServer.fallbackAvatarBackgrounds);
    if (palette.length === 0) {
      return 'from-slate-700/60 via-slate-900/60 to-slate-700/60';
    }

    const seedString = (() => {
      if (typeof seed === 'number' && Number.isFinite(seed)) {
        return String(seed);
      }
      if (typeof seed === 'string' && seed.trim().length > 0) {
        return seed.trim();
      }
      return 'fallback';
    })();

    const total = Array.from(seedString).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const index = Math.abs(total) % palette.length;
    return palette[index] ?? palette[0];
  }

  private selectClassementsAvatar(leader: ClassementLeaderBootstrap): string | null {
    const candidates = [leader.avatarUrl, leader.avatar, leader.profileAvatar];
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
    return null;
  }

  private computeClassementAvatarSeed(leader: ClassementLeaderBootstrap, rank: number): number {
    if (leader.userId && leader.userId.length > 0) {
      return Array.from(leader.userId).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    }
    return Math.max(1, rank);
  }

  private getClassementLeaderInitials(leader: ClassementLeaderBootstrap): string {
    const displayName = leader.displayName?.trim() ?? '';
    const username = leader.username?.trim().replace(/^@/, '') ?? '';
    const source = displayName || username;
    if (!source) {
      return '∅';
    }
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    const first = parts[0]?.[0] ?? '';
    const last = parts[parts.length - 1]?.[0] ?? '';
    const initials = `${first}${last}`.trim();
    return initials ? initials.toUpperCase() : source.slice(0, 2).toUpperCase();
  }

  private describeClassementTrend(trend: ClassementLeaderBootstrap['positionTrend']): {
    icon: string;
    label: string;
    className: string;
    delta: string;
  } {
    const movement = trend?.movement ?? 'same';
    const deltaValue = Number.isFinite(trend?.delta ?? null) ? Number(trend?.delta ?? 0) : null;
    switch (movement) {
      case 'up':
        return {
          icon: '↑',
          label: 'Monte',
          className: 'text-emerald-300',
          delta: deltaValue !== null && deltaValue !== 0 ? `+${deltaValue}` : '+0',
        };
      case 'down':
        return {
          icon: '↓',
          label: 'Descend',
          className: 'text-rose-300',
          delta: deltaValue !== null && deltaValue !== 0 ? `${deltaValue}` : '0',
        };
      case 'new':
        return {
          icon: '★',
          label: 'Nouveau',
          className: 'text-amber-300',
          delta: '—',
        };
      default:
        return {
          icon: '→',
          label: 'Stable',
          className: 'text-slate-300',
          delta: '0',
        };
    }
  }

  private buildClassementsMetaLabel(
    leaderCount: number,
    snapshot: { bucketStart: string | null; comparedTo: string | null } | null,
  ): string {
    const count = Math.min(Math.max(leaderCount, 0), 100);
    const bucketDate = snapshot?.bucketStart ? new Date(snapshot.bucketStart) : new Date();
    const formatter = new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'long',
    });
    const formattedDate = formatter.format(bucketDate);

    let comparisonSegment = '';
    if (snapshot?.comparedTo) {
      const comparedDate = new Date(snapshot.comparedTo);
      if (!Number.isNaN(comparedDate.getTime())) {
        const diffMs = bucketDate.getTime() - comparedDate.getTime();
        const diffHours = diffMs / 3_600_000;
        if (Number.isFinite(diffHours)) {
          const relativeFormatter = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });
          const rounded = Math.round(diffHours);
          comparisonSegment =
            rounded === 0
              ? ' · Variations sur l’heure en cours'
              : ` · Variations ${relativeFormatter.format(-rounded, 'hour')}`;
        }
      }
    }

    return `${count} profils · Mise à jour ${formattedDate}${comparisonSegment}`;
  }

  private truncateText(value: string, maxLength = 240): string {
    const trimmed = value.trim();
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    return `${trimmed.slice(0, maxLength - 1).trim()}…`;
  }

  private formatDateLabel(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions): string | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    const formatter = new Intl.DateTimeFormat('fr-FR', options ?? { dateStyle: 'long' });
    return formatter.format(date);
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return new Intl.NumberFormat('fr-FR').format(Math.max(0, Math.floor(value)));
  }

  private buildHomePageHtml(data: {
    listenerCount: number;
    speakers: Array<{ id: string; displayName: string; avatarUrl: string | null; isSpeaking: boolean; lastSpokeAt: string | null }>;
    latestPosts: Array<{ title: string; slug: string; excerpt: string | null; date: string | null }>;
  }): string {
    const parts: string[] = [];
    const listenerLabel = data.listenerCount > 0
      ? `${this.formatNumber(data.listenerCount)} auditeur${data.listenerCount > 1 ? 's' : ''} en direct`
      : 'Rejoignez les premiers auditeurs ce soir';

    parts.push('<main class="home-prerender mx-auto max-w-6xl space-y-12 px-4 py-16">');
    parts.push(
      '<section id="home-hero" class="rounded-3xl border border-slate-800/60 bg-slate-950/80 p-8 shadow-xl shadow-slate-900/50">',
    );
    parts.push(
      '<p data-speakable="kicker" class="text-sm uppercase tracking-[0.2em] text-amber-300">Radio libre communautaire</p>',
    );
    parts.push(
      '<h1 class="mt-3 text-3xl font-bold text-white sm:text-4xl">Libre Antenne · Voix nocturnes du Discord</h1>',
    );
    parts.push(
      '<p data-speakable="description" class="mt-4 text-lg text-slate-300">La communauté Libre Antenne diffuse en continu ses débats, confidences et sessions de jeu. Branche-toi pour suivre le direct, proposer un sujet ou prendre le micro.</p>',
    );
    parts.push(
      `<p class="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300"><span class="h-2 w-2 animate-pulse rounded-full bg-emerald-300"></span>${this.escapeHtml(listenerLabel)}</p>`,
    );
    parts.push('</section>');

    parts.push('<section id="home-live-speakers" class="rounded-3xl border border-slate-800/60 bg-slate-950/60 p-8">');
    parts.push('<div class="flex items-center justify-between gap-4">');
    parts.push('<h2 class="text-2xl font-semibold text-white">Au micro en ce moment</h2>');
    parts.push('<a class="text-sm font-medium text-amber-300 hover:text-amber-200" href="/membres">Explorer les profils →</a>');
    parts.push('</div>');

    if (data.speakers.length === 0) {
      parts.push(
        '<p class="mt-6 text-sm text-slate-400">Le plateau est calme pour le moment. Passe plus tard dans la nuit ou rejoins le salon vocal pour lancer la conversation.</p>',
      );
    } else {
      parts.push('<ul class="mt-6 grid gap-6 md:grid-cols-2">');
      for (const speaker of data.speakers) {
        const rawName = typeof speaker.displayName === 'string' && speaker.displayName.trim().length > 0
          ? speaker.displayName.trim()
          : 'Auditeur anonyme';
        const name = this.escapeHtml(rawName);
        const status = speaker.isSpeaking
          ? 'Au micro en ce moment'
          : speaker.lastSpokeAt
            ? `Dernière prise de parole : ${this.escapeHtml(
                this.formatDateLabel(speaker.lastSpokeAt, { dateStyle: 'medium', timeStyle: 'short' }) ?? '',
              )}`
            : 'À l’écoute sur le salon vocal';
        parts.push('<li class="flex items-center gap-4 rounded-2xl bg-slate-900/70 p-4">');
        parts.push(
          this.renderAvatarOrFallback({
            avatarUrl: speaker.avatarUrl,
            alt: `Avatar de ${rawName}`,
            displayName: rawName,
            seed: speaker.id ?? rawName,
            sizeClass: 'h-14 w-14',
            className: 'flex-none rounded-full border border-slate-800',
            textClass: 'text-lg font-semibold text-white/90',
            loading: 'lazy',
            decoding: 'async',
          }),
        );
        parts.push('<div class="min-w-0 flex-1">');
        parts.push(`<p class="truncate text-base font-semibold text-white">${name}</p>`);
        parts.push(`<p class="mt-1 text-sm text-slate-400">${this.escapeHtml(status)}</p>`);
        parts.push('</div>');
        parts.push('<div class="flex h-full items-center">');
        parts.push(
          `<a class="rounded-full border border-amber-400/60 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-400/10" href="/profil/${encodeURIComponent(
            speaker.id,
          )}">Voir le profil</a>`,
        );
        parts.push('</div>');
        parts.push('</li>');
      }
      parts.push('</ul>');
    }
    parts.push('</section>');

    parts.push('<section id="home-latest-posts" class="rounded-3xl border border-slate-800/60 bg-slate-950/60 p-8">');
    parts.push('<div class="flex items-center justify-between gap-4">');
    parts.push('<h2 class="text-2xl font-semibold text-white">Les dernières chroniques</h2>');
    parts.push('<a class="text-sm font-medium text-amber-300 hover:text-amber-200" href="/blog">Lire le blog →</a>');
    parts.push('</div>');

    if (data.latestPosts.length === 0) {
      parts.push('<p class="mt-6 text-sm text-slate-400">Les premières chroniques arrivent bientôt : les membres préparent actuellement leurs histoires de nuit.</p>');
    } else {
      parts.push('<div class="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">');
      for (const post of data.latestPosts) {
        const title = this.escapeHtml(post.title);
        const excerpt = post.excerpt ? this.escapeHtml(this.truncateText(post.excerpt, 180)) : 'Découvre ce qui agite Libre Antenne cette semaine.';
        const dateLabel = this.formatDateLabel(post.date ?? post.slug) ?? null;
        parts.push('<article class="latest-post flex h-full flex-col justify-between rounded-2xl bg-slate-900/70 p-6">');
        parts.push('<div>');
        if (dateLabel) {
          parts.push(`<p class="text-xs uppercase tracking-[0.15em] text-slate-500">${this.escapeHtml(dateLabel)}</p>`);
        }
        parts.push(`<h3 class="mt-3 text-lg font-semibold text-white"><a class="hover:text-amber-200" href="/blog/${encodeURIComponent(post.slug)}">${title}</a></h3>`);
        parts.push(`<p class="mt-3 text-sm text-slate-400">${excerpt}</p>`);
        parts.push('</div>');
        parts.push(`<a class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-amber-300 hover:text-amber-200" href="/blog/${encodeURIComponent(post.slug)}">Lire l’article →</a>`);
        parts.push('</article>');
      }
      parts.push('</div>');
    }
    parts.push('</section>');

    parts.push('</main>');
    return parts.join('');
  }

  private buildMembersPageHtml(data: {
    search: string | null;
    members: Array<{
      id: string;
      displayName: string;
      username: string | null;
      avatarUrl: string | null;
      joinedAt: string | null;
      highlightMessage: { content: string; timestamp: string | null } | null;
    }>;
  }): string {
    const parts: string[] = [];
    const searchTerm = data.search ? data.search.trim() : '';
    parts.push('<main class="members-prerender mx-auto max-w-6xl space-y-12 px-4 py-16">');
    parts.push('<section class="rounded-3xl border border-slate-800/60 bg-slate-950/70 p-8">');
    parts.push('<h1 class="text-3xl font-bold text-white">Membres actifs de Libre Antenne</h1>');
    if (searchTerm) {
      parts.push(
        `<p class="mt-4 text-sm text-slate-300">Résultats filtrés pour « ${this.escapeHtml(searchTerm)} ». Explore les profils les plus actifs de ces 90 derniers jours.</p>`,
      );
    } else {
      parts.push(
        '<p class="mt-4 text-sm text-slate-300">Découvre qui anime la radio libre : temps de présence, prises de parole marquantes et derniers messages publics.</p>',
      );
    }
    parts.push('</section>');

    parts.push('<section class="space-y-6">');
    if (data.members.length === 0) {
      parts.push(
        '<p class="rounded-3xl border border-slate-800/60 bg-slate-950/60 p-6 text-sm text-slate-400">Aucun membre ne correspond à ta recherche pour le moment. Essaye avec un pseudo, un sujet ou reviens après une soirée en direct.</p>',
      );
    } else {
      parts.push('<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">');
      for (const member of data.members) {
        const rawName = typeof member.displayName === 'string' && member.displayName.trim().length > 0
          ? member.displayName.trim()
          : 'Membre Libre Antenne';
        const name = this.escapeHtml(rawName);
        const username = member.username ? `@${this.escapeHtml(member.username)}` : null;
        const joinedLabel = this.formatDateLabel(member.joinedAt) ?? null;
        parts.push('<article class="flex h-full flex-col justify-between rounded-2xl border border-slate-800/40 bg-slate-950/60 p-6">');
        parts.push('<div class="flex items-center gap-4">');
        parts.push(
          this.renderAvatarOrFallback({
            avatarUrl: member.avatarUrl,
            alt: `Avatar de ${rawName}`,
            displayName: rawName,
            seed: member.id ?? rawName,
            sizeClass: 'h-14 w-14',
            className: 'flex-none rounded-full border border-slate-800',
            textClass: 'text-lg font-semibold text-white/90',
            loading: 'lazy',
            decoding: 'async',
          }),
        );
        parts.push('<div class="min-w-0 flex-1">');
        parts.push(`<p class="truncate text-base font-semibold text-white">${name}</p>`);
        if (username) {
          parts.push(`<p class="truncate text-xs uppercase tracking-[0.2em] text-slate-500">${username}</p>`);
        }
        if (joinedLabel) {
          parts.push(`<p class="mt-1 text-xs text-slate-400">Membre depuis ${this.escapeHtml(joinedLabel)}</p>`);
        }
        parts.push('</div>');
        parts.push('</div>');

        if (member.highlightMessage) {
          const message = this.escapeHtml(this.truncateText(member.highlightMessage.content, 180));
          const messageDate = this.formatDateLabel(member.highlightMessage.timestamp, {
            dateStyle: 'medium',
            timeStyle: 'short',
          });
          parts.push('<div class="mt-5 rounded-2xl bg-slate-900/70 p-4">');
          parts.push('<p class="text-xs uppercase tracking-[0.18em] text-amber-300">Vu sur le Discord</p>');
          parts.push(`<p class="mt-2 text-sm text-slate-200">${message}</p>`);
          if (messageDate) {
            parts.push(`<p class="mt-2 text-xs text-slate-500">${this.escapeHtml(messageDate)}</p>`);
          }
          parts.push('</div>');
        }

        parts.push(
          `<a class="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-amber-300 hover:text-amber-200" href="/profil/${encodeURIComponent(
            member.id,
          )}">Consulter le profil →</a>`,
        );
        parts.push('</article>');
      }
      parts.push('</div>');
    }
    parts.push('</section>');

    parts.push('</main>');
    return parts.join('');
  }

  private buildBlogListingHtml(data: {
    tags: string[];
    posts: Array<{ title: string; slug: string; excerpt: string | null; date: string | null; author?: string | null }>;
    availableTags: string[];
  }): string {
    const parts: string[] = [];
    const activeTags = data.tags.filter((tag) => typeof tag === 'string' && tag.trim().length > 0);
    const tagDescription = activeTags.length > 0
      ? `Chroniques consacrées à ${activeTags.map((tag) => `#${tag}`).join(', ')}`
      : 'Histoires de nuit, coulisses et conseils pour rejoindre Libre Antenne.';

    parts.push('<main class="blog-prerender mx-auto max-w-5xl space-y-12 px-4 py-16">');
    parts.push('<section class="rounded-3xl border border-slate-800/60 bg-slate-950/70 p-8">');
    parts.push('<h1 class="text-3xl font-bold text-white">Chroniques Libre Antenne</h1>');
    parts.push(`<p class="mt-4 text-sm text-slate-300">${this.escapeHtml(tagDescription)}</p>`);
    if (activeTags.length > 0) {
      parts.push('<div class="mt-4 flex flex-wrap gap-2">');
      for (const tag of activeTags) {
        parts.push(`<span class="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">#${this.escapeHtml(tag)}</span>`);
      }
      parts.push('</div>');
    }
    parts.push('</section>');

    if (data.posts.length === 0) {
      parts.push(
        '<p class="rounded-3xl border border-slate-800/60 bg-slate-950/60 p-6 text-sm text-slate-400">Aucun article ne correspond à ces filtres pour le moment. N’hésite pas à proposer un sujet ou à explorer d’autres tags.</p>',
      );
    } else {
      parts.push('<section class="space-y-6">');
      for (const post of data.posts) {
        const title = this.escapeHtml(post.title);
        const excerpt = post.excerpt ? this.escapeHtml(this.truncateText(post.excerpt, 240)) : 'Un nouveau récit de la communauté.';
        const dateLabel = this.formatDateLabel(post.date, { dateStyle: 'long' });
        const author = post.author ? this.escapeHtml(post.author) : null;
        parts.push('<article class="rounded-3xl border border-slate-800/40 bg-slate-950/60 p-6">');
        parts.push(`<h2 class="text-2xl font-semibold text-white"><a class="hover:text-amber-200" href="/blog/${encodeURIComponent(post.slug)}">${title}</a></h2>`);
        if (dateLabel || author) {
          parts.push('<p class="mt-2 text-xs uppercase tracking-[0.18em] text-slate-500">');
          if (dateLabel) {
            parts.push(this.escapeHtml(dateLabel));
          }
          if (author) {
            parts.push(dateLabel ? ' · ' : '');
            parts.push(`Par ${author}`);
          }
          parts.push('</p>');
        }
        parts.push(`<p class="mt-4 text-sm text-slate-300">${excerpt}</p>`);
        parts.push(`<a class="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-amber-300 hover:text-amber-200" href="/blog/${encodeURIComponent(post.slug)}">Lire l’article →</a>`);
        parts.push('</article>');
      }
      parts.push('</section>');
    }

    if (data.availableTags.length > 0) {
      parts.push('<section class="rounded-3xl border border-slate-800/40 bg-slate-950/50 p-6">');
      parts.push('<h2 class="text-lg font-semibold text-white">Explorer par thème</h2>');
      parts.push('<div class="mt-4 flex flex-wrap gap-2">');
      for (const tag of data.availableTags) {
        parts.push(
          `<a class="rounded-full border border-amber-400/40 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-400/10" href="/blog?tag=${encodeURIComponent(tag)}">#${this.escapeHtml(tag)}</a>`,
        );
      }
      parts.push('</div>');
      parts.push('</section>');
    }

    parts.push('</main>');
    return parts.join('');
  }

  private buildBlogPostHtml(data: {
    title: string;
    contentHtml: string;
    date: string | null;
    updatedAt: string | null;
    tags: string[];
    coverImageUrl: string | null;
    authorName?: string | null;
  }): string {
    const parts: string[] = [];
    const publishedLabel = this.formatDateLabel(data.date, { dateStyle: 'long' });
    const updatedLabel = this.formatDateLabel(data.updatedAt, { dateStyle: 'long' });
    parts.push('<main class="blog-post-prerender mx-auto max-w-3xl space-y-10 px-4 py-16">');
    parts.push('<header class="space-y-4 text-center">');
    parts.push(`<p class="text-xs uppercase tracking-[0.18em] text-amber-300">Chronique Libre Antenne</p>`);
    parts.push(`<h1 class="text-3xl font-bold text-white">${this.escapeHtml(data.title)}</h1>`);
    if (data.authorName || publishedLabel || updatedLabel) {
      parts.push('<p class="text-xs uppercase tracking-[0.2em] text-slate-500">');
      if (publishedLabel) {
        parts.push(`Publié le ${this.escapeHtml(publishedLabel)}`);
      }
      if (updatedLabel && updatedLabel !== publishedLabel) {
        parts.push(publishedLabel ? ' · ' : '');
        parts.push(`Mise à jour le ${this.escapeHtml(updatedLabel)}`);
      }
      if (data.authorName) {
        parts.push((publishedLabel || updatedLabel) ? ' · ' : '');
        parts.push(`Par ${this.escapeHtml(data.authorName)}`);
      }
      parts.push('</p>');
    }
    if (data.coverImageUrl) {
      parts.push(
        `<img alt="Illustration de l’article" src="${this.escapeHtml(data.coverImageUrl)}" loading="lazy" class="mx-auto mt-6 max-h-80 w-full rounded-3xl object-cover" />`,
      );
    }
    if (data.tags.length > 0) {
      parts.push('<div class="mt-6 flex flex-wrap justify-center gap-2">');
      for (const tag of data.tags) {
        parts.push(`<span class="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">#${this.escapeHtml(tag)}</span>`);
      }
      parts.push('</div>');
    }
    parts.push('</header>');

    parts.push('<article class="prose prose-invert mx-auto max-w-none prose-headings:text-white prose-a:text-amber-300">');
    parts.push(data.contentHtml);
    parts.push('</article>');

    parts.push('<footer class="rounded-3xl border border-slate-800/40 bg-slate-950/60 p-6 text-sm text-slate-300">');
    parts.push('<p>Envie de participer ? Rejoins la communauté sur Discord et propose ta chronique via l’outil dédié.</p>');
    parts.push('<a class="mt-3 inline-flex items-center gap-2 font-semibold text-amber-300 hover:text-amber-200" href="/blog/proposer">Proposer un article →</a>');
    parts.push('</footer>');

    parts.push('</main>');
    return parts.join('');
  }

  private buildProfilePageHtml(data: {
    userId: string;
    profileName: string;
    identity: DiscordUserIdentity | null;
    summary: ProfileSummary;
    recentMessages: Array<{ content: string; timestamp: string | null }>;
  }): string {
    const parts: string[] = [];
    const rawProfileName = typeof data.profileName === 'string' && data.profileName.trim().length > 0
      ? data.profileName.trim()
      : 'Profil Libre Antenne';
    const safeProfileName = this.escapeHtml(rawProfileName);
    const username = data.identity?.username || data.identity?.globalName || null;
    const joinedLabel = this.formatDateLabel(data.identity?.guild?.joinedAt ?? null, { dateStyle: 'long' });
    const lastActivity = this.formatDateLabel(data.summary.lastActivityAt?.iso ?? null, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const metrics: Array<{ label: string; value: string }> = [
      { label: 'Présence vocale (90 j)', value: this.formatDuration(data.summary.totalPresenceMs) },
      { label: 'Temps au micro', value: this.formatDuration(data.summary.totalSpeakingMs) },
      { label: 'Messages publiés', value: this.formatNumber(data.summary.messageCount) },
      { label: 'Jours actifs', value: this.formatNumber(data.summary.activeDayCount) },
    ];

    parts.push('<main class="profile-prerender mx-auto max-w-4xl space-y-12 px-4 py-16">');
    parts.push('<section class="rounded-3xl border border-slate-800/60 bg-slate-950/70 p-8">');
    parts.push('<div class="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">');
    parts.push(
      this.renderAvatarOrFallback({
        avatarUrl: data.identity?.avatarUrl ?? null,
        alt: `Avatar de ${rawProfileName}`,
        displayName: rawProfileName,
        seed: data.userId ?? rawProfileName,
        sizeClass: 'h-24 w-24',
        className: 'flex-none rounded-full border border-slate-800',
        textClass: 'text-2xl font-semibold text-white/90',
        loading: 'lazy',
        decoding: 'async',
      }),
    );
    parts.push('<div class="space-y-2">');
    parts.push(`<h1 class="text-3xl font-bold text-white">${safeProfileName}</h1>`);
    if (username) {
      parts.push(`<p class="text-xs uppercase tracking-[0.2em] text-slate-500">@${this.escapeHtml(username)}</p>`);
    }
    if (joinedLabel) {
      parts.push(`<p class="text-sm text-slate-300">Membre depuis ${this.escapeHtml(joinedLabel)}</p>`);
    }
    if (lastActivity) {
      parts.push(`<p class="text-xs text-slate-500">Dernière activité relevée le ${this.escapeHtml(lastActivity)}</p>`);
    }
    parts.push('</div>');
    parts.push('</div>');
    parts.push('</section>');

    parts.push('<section class="grid gap-4 sm:grid-cols-2">');
    for (const metric of metrics) {
      parts.push('<div class="rounded-2xl border border-slate-800/50 bg-slate-950/60 p-5">');
      parts.push(`<p class="text-xs uppercase tracking-[0.18em] text-slate-500">${this.escapeHtml(metric.label)}</p>`);
      parts.push(`<p class="mt-2 text-xl font-semibold text-white">${this.escapeHtml(metric.value)}</p>`);
      parts.push('</div>');
    }
    parts.push('</section>');

    if (data.recentMessages.length > 0) {
      parts.push('<section class="space-y-4">');
      parts.push('<h2 class="text-lg font-semibold text-white">Derniers messages publics</h2>');
      const messages = [...data.recentMessages].slice(-5).reverse();
      parts.push('<ul class="space-y-3">');
      for (const message of messages) {
        const content = this.escapeHtml(this.truncateText(message.content, 220));
        const timestamp = this.formatDateLabel(message.timestamp, { dateStyle: 'medium', timeStyle: 'short' });
        parts.push('<li class="rounded-2xl border border-slate-800/40 bg-slate-950/60 p-4">');
        parts.push(`<p class="text-sm text-slate-200">${content}</p>`);
        if (timestamp) {
          parts.push(`<p class="mt-2 text-xs text-slate-500">${this.escapeHtml(timestamp)}</p>`);
        }
        parts.push('</li>');
      }
      parts.push('</ul>');
      parts.push('</section>');
    }

    parts.push('<section class="rounded-3xl border border-slate-800/40 bg-slate-950/60 p-6 text-sm text-slate-300">');
    parts.push('<p>Pour entendre ce membre en direct, connecte-toi au flux audio Libre Antenne ou rejoins le salon vocal Discord. Les statistiques affichées couvrent les 90 derniers jours.</p>');
    parts.push('<a class="mt-3 inline-flex items-center gap-2 font-semibold text-amber-300 hover:text-amber-200" href="/">Écouter le direct →</a>');
    parts.push('</section>');

    parts.push('</main>');
    return parts.join('');
  }

  private buildBlogProposalHtml(): string {
    const parts: string[] = [];
    parts.push('<main class="blog-proposal-prerender mx-auto max-w-3xl space-y-10 px-4 py-16">');
    parts.push('<section class="rounded-3xl border border-slate-800/60 bg-slate-950/70 p-8 text-center">');
    parts.push('<p class="text-xs uppercase tracking-[0.2em] text-amber-300">Contribuer</p>');
    parts.push('<h1 class="mt-3 text-3xl font-bold text-white">Proposer un article pour le blog Libre Antenne</h1>');
    parts.push('<p class="mt-4 text-sm text-slate-300">Partage une chronique de nuit, un portrait de membre ou un guide pour rejoindre la radio libre. Notre équipe relit et publie les meilleures contributions.</p>');
    parts.push('</section>');

    parts.push('<section class="space-y-6 rounded-3xl border border-slate-800/40 bg-slate-950/60 p-6 text-sm text-slate-200">');
    parts.push('<h2 class="text-lg font-semibold text-white">Comment ça marche ?</h2>');
    parts.push('<ol class="list-decimal space-y-3 pl-6 text-left text-slate-300">');
    parts.push('<li>Décris ton idée : titre, accroche, tags et visuel éventuel.</li>');
    parts.push('<li>Rédige ton article en Markdown avec un ton authentique et sourcé.</li>');
    parts.push('<li>Indique un moyen de contact pour la relecture (Discord ou e-mail).</li>');
    parts.push('</ol>');
    parts.push('<p class="text-sm text-slate-400">Un membre de la rédaction vérifie chaque proposition avant publication pour garantir la qualité éditoriale et la conformité aux règles communautaires.</p>');
    parts.push('</section>');

    parts.push('<section class="rounded-3xl border border-slate-800/40 bg-slate-950/60 p-6 text-sm text-slate-200">');
    parts.push('<h2 class="text-lg font-semibold text-white">Prépare ton article</h2>');
    parts.push('<ul class="list-disc space-y-2 pl-6 text-left">');
    parts.push('<li>Format recommandé : 800 à 1 200 mots.</li>');
    parts.push('<li>Ajoute des sources ou liens utiles si tu annonces une information.</li>');
    parts.push('<li>Évite les contenus promotionnels ou générés automatiquement sans relecture humaine.</li>');
    parts.push('</ul>');
    parts.push('<a class="mt-4 inline-flex items-center gap-2 font-semibold text-amber-300 hover:text-amber-200" href="/blog">Voir les articles publiés →</a>');
    parts.push('</section>');

    parts.push('</main>');
    return parts.join('');
  }

  private async buildHomePagePrerender(): Promise<{
    html: string;
    listenerCount: number;
    latestPosts: Array<{ title: string; slug: string; excerpt: string | null; date: string | null }>;
    speakers: Array<{ id: string; displayName: string; avatarUrl: string | null; isSpeaking: boolean; lastSpokeAt: string | null }>;
    participants: Participant[];
    listenerHistory: ListenerStatsEntry[];
  }> {
    const listenerCount = this.listenerStatsService.getCurrentCount();
    const rawSpeakers = this.speakerTracker.getSpeakers();
    const speakers = rawSpeakers.slice(0, 6).map((speaker) => {
      const displayName = speaker.displayName || speaker.username || `Membre ${speaker.id}`;
      let lastSpokeAt: string | null = null;
      if (typeof speaker.lastSpokeAt === 'number' && Number.isFinite(speaker.lastSpokeAt)) {
        lastSpokeAt = new Date(speaker.lastSpokeAt).toISOString();
      }
      return {
        id: speaker.id,
        displayName,
        avatarUrl: speaker.avatar ?? null,
        isSpeaking: Boolean(speaker.isSpeaking),
        lastSpokeAt,
      };
    });

    let latestPosts: Array<{ title: string; slug: string; excerpt: string | null; date: string | null }> = [];
    try {
      const { posts } = await this.blogService.listPosts({ limit: 6, sortBy: 'date', sortOrder: 'desc' });
      latestPosts = posts.map((post) => ({
        title: post.title,
        slug: post.slug,
        excerpt: post.seoDescription ?? post.excerpt,
        date: post.date,
      }));
    } catch (error) {
      console.warn('Failed to load blog posts for home prerender', error);
    }

    const participants = this.speakerTracker.getInitialState()?.speakers ?? [];
    const listenerHistory = this.listenerStatsService.getHistory();
    const html = this.buildHomePageHtml({ listenerCount, speakers, latestPosts });
    return { html, listenerCount, latestPosts, speakers, participants, listenerHistory };
  }

  private async buildMembersPagePrerender(search: string | null): Promise<string> {
    try {
      const result = await this.discordBridge.listGuildMembers({
        limit: 30,
        search: search && search.trim().length > 0 ? search.trim() : null,
      });
      const hiddenIds = await this.adminService.getHiddenMemberIds();
      const visibleMembers = result.members.filter((member) => !hiddenIds.has(member.id));

      let recentMessagesByUser: Record<string, UserMessageActivityEntry[]> = {};
      if (this.voiceActivityRepository) {
        const userIds = visibleMembers
          .map((member) => member.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (userIds.length > 0) {
          try {
            recentMessagesByUser = await this.voiceActivityRepository.listRecentUserMessages({
              userIds,
              limitPerUser: 3,
            });
          } catch (error) {
            console.warn('Failed to load recent messages for members prerender', error);
          }
        }
      }

      const members = visibleMembers.slice(0, 18).map((member) => {
        const displayName = member.displayName || member.nickname || member.username || `Membre ${member.id}`;
        const messages = recentMessagesByUser[member.id] ?? [];
        const highlight = messages.length > 0 ? messages[messages.length - 1] : null;
        const highlightTimestamp = highlight?.timestamp instanceof Date
          ? highlight.timestamp.toISOString()
          : null;
        return {
          id: member.id,
          displayName,
          username: member.username ?? null,
          avatarUrl: member.avatarUrl ?? null,
          joinedAt: member.joinedAt ?? null,
          highlightMessage: highlight
            ? { content: highlight.content ?? '', timestamp: highlightTimestamp }
            : null,
        };
      });

      return this.buildMembersPageHtml({ search, members });
    } catch (error) {
      console.error('Failed to build members prerender', error);
      return this.buildMembersPageHtml({ search, members: [] });
    }
  }

  private async buildBlogListingPrerender(tags: string[]): Promise<{
    html: string;
    posts: BlogPostSummary[];
    availableTags: string[];
    selectedTags: string[];
  }> {
    let posts: BlogPostSummary[] = [];
    let availableTags: string[] = [];
    try {
      const result = await this.blogService.listPosts({
        tags: tags.length > 0 ? tags : null,
        sortBy: 'date',
        sortOrder: 'desc',
        limit: 24,
      });
      posts = result.posts;
      availableTags = result.availableTags;
    } catch (error) {
      console.error('Failed to build blog listing prerender', error);
      posts = [];
      availableTags = [];
    }

    const normalizedPosts = posts.map((post) => ({
      title: post.title,
      slug: post.slug,
      excerpt: post.seoDescription ?? post.excerpt,
      date: post.date,
      author: this.config.siteName,
    }));
    const html = this.buildBlogListingHtml({ tags, posts: normalizedPosts, availableTags });
    return { html, posts, availableTags, selectedTags: tags };
  }

  private async buildClassementsPagePrerender(
    options: NormalizedHypeLeaderboardQueryOptions,
  ): Promise<{ html: string; bootstrap: ClassementsPageBootstrap }> {
    const normalizedOptions: NormalizedHypeLeaderboardQueryOptions = {
      ...options,
      limit: Math.min(Math.max(options.limit ?? 100, 1), 100),
    };

    let result: HypeLeaderboardResult | null = null;
    try {
      result = await this.getCachedHypeLeaders(normalizedOptions);
    } catch (error) {
      console.error('Failed to build classements prerender', error);
      result = null;
    }

    const leaders = (result?.leaders ?? []).slice(0, 100).map((leader, index) => this.normalizeClassementLeader(leader, index));
    const snapshot = result
      ? {
          bucketStart: result.snapshot.bucketStart.toISOString(),
          comparedTo: result.snapshot.comparedTo ? result.snapshot.comparedTo.toISOString() : null,
        }
      : { bucketStart: null, comparedTo: null };

    const query = {
      search: options.search ?? '',
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
      period: options.periodDays === null ? 'all' : String(options.periodDays ?? '30'),
    };

    const html = this.buildClassementsPageHtml({ leaders, snapshot, query });
    return { html, bootstrap: { query, leaders, snapshot } };
  }

  private buildClassementsPageHtml(data: {
    leaders: ClassementLeaderBootstrap[];
    snapshot: { bucketStart: string | null; comparedTo: string | null } | null;
    query: { search: string; sortBy: HypeLeaderboardSortBy; sortOrder: HypeLeaderboardSortOrder; period: string };
  }): string {
    const parts: string[] = [];
    const numberFormatter = new Intl.NumberFormat('fr-FR', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });

    const formatScore = (value: unknown): string => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return '0';
      }
      if (Math.abs(numericValue) >= 1000) {
        return numberFormatter.format(Math.round(numericValue));
      }
      return numberFormatter.format(numericValue);
    };

    const formatSigned = (value: unknown): string => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return '0';
      }
      const formatted = formatScore(Math.abs(numericValue));
      if (numericValue > 0) {
        return `+${formatted}`;
      }
      if (numericValue < 0) {
        return `-${formatted}`;
      }
      return formatted;
    };

    const padRank = (value: number): string => String(Math.max(1, value)).padStart(2, '0');

    const searchValue = data.query.search ?? '';
    const sortBy = data.query.sortBy;
    const sortOrder = data.query.sortOrder;
    const allowedPeriods = new Set(['all', '7', '30', '90', '365']);
    const period = allowedPeriods.has(data.query.period) ? data.query.period : '30';
    const metaLabel = this.buildClassementsMetaLabel(data.leaders.length, data.snapshot);

    parts.push('<div class="classements-page flex flex-col gap-10">');
    parts.push('<section class="rounded-3xl bg-white/5 p-[1px]">');
    parts.push('<div class="relative overflow-hidden rounded-[1.45rem] bg-slate-950/80 p-8 shadow-neon">');
    parts.push('<div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/15 via-fuchsia-500/10 to-purple-500/20"></div>');
    parts.push('<div class="relative flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">');
    parts.push('<div class="max-w-2xl space-y-6">');
    parts.push('<p class="text-xs uppercase tracking-[0.35em] text-slate-400">Classement officiel</p>');
    parts.push('<h1 class="text-3xl font-black leading-tight text-white sm:text-4xl">Top 100 des personnes les plus hype & cool</h1>');
    parts.push(
      '<p class="text-base text-slate-300 sm:text-lg">Ce classement mesure l’énergie que chaque voix apporte au serveur : l’impact sur la fréquentation, la durée de parole et la vibe générale.</p>',
    );
    parts.push('</div>');
    parts.push('</div>');
    parts.push('</div>');
    parts.push('</section>');

    parts.push('<section class="space-y-6">');
    parts.push('<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">');
    parts.push('<h2 class="text-2xl font-bold text-white">Classement Hype</h2>');
    parts.push(`<span class="text-sm text-slate-400">${this.escapeHtml(metaLabel)}</span>`);
    parts.push('</div>');

    parts.push('<div class="grid gap-4 rounded-3xl border border-white/10 bg-slate-950/70 p-6 md:grid-cols-4 xl:grid-cols-5">');
    parts.push('<label class="flex flex-col gap-2 md:col-span-2">');
    parts.push('<span class="text-xs uppercase tracking-[0.3em] text-slate-400">Recherche</span>');
    parts.push(
      `<input type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Rechercher un pseudo" class="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder-slate-500 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40" value="${this.escapeHtml(searchValue)}" />`,
    );
    parts.push('</label>');

    const sortOptions: Array<{ value: HypeLeaderboardSortBy; label: string }> = [
      { value: 'schScoreNorm', label: 'Score hype' },
      { value: 'arrivalEffect', label: "Effet d'arrivée" },
      { value: 'departureEffect', label: 'Effet de départ' },
      { value: 'activityScore', label: "Score d'activité" },
      { value: 'displayName', label: 'Pseudo' },
    ];

    parts.push('<label class="flex flex-col gap-2">');
    parts.push('<span class="text-xs uppercase tracking-[0.3em] text-slate-400">Trier par</span>');
    parts.push('<select class="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40">');
    for (const option of sortOptions) {
      const selected = option.value === sortBy ? ' selected' : '';
      parts.push(`<option value="${option.value}"${selected}>${this.escapeHtml(option.label)}</option>`);
    }
    parts.push('</select>');
    parts.push('</label>');

    const sortOrderLabel = sortOrder === 'asc' ? 'Ordre ascendant' : 'Ordre descendant';
    const sortOrderIcon = sortOrder === 'asc' ? '↑' : '↓';
    const sortOrderPressed = sortOrder === 'asc' ? 'true' : 'false';
    parts.push('<div class="flex flex-col gap-2">');
    parts.push('<span class="text-xs uppercase tracking-[0.3em] text-slate-400">Ordre</span>');
    parts.push(
      `<button type="button" class="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-medium text-white transition hover:border-sky-500/60 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40" aria-pressed="${sortOrderPressed}">`,
    );
    parts.push(`<span class="pointer-events-none select-none">${this.escapeHtml(sortOrderLabel)}</span>`);
    parts.push(`<span aria-hidden="true" class="text-base leading-none">${sortOrderIcon}</span>`);
    parts.push('</button>');
    parts.push('</div>');

    const periodOptions = [
      { value: 'all', label: 'Toujours' },
      { value: '7', label: '7 jours' },
      { value: '30', label: '30 jours' },
      { value: '90', label: '90 jours' },
      { value: '365', label: '365 jours' },
    ];
    parts.push('<label class="flex flex-col gap-2">');
    parts.push('<span class="text-xs uppercase tracking-[0.3em] text-slate-400">Période</span>');
    parts.push('<select class="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm text-white transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40">');
    for (const option of periodOptions) {
      const selected = option.value === period ? ' selected' : '';
      parts.push(`<option value="${option.value}"${selected}>${option.label}</option>`);
    }
    parts.push('</select>');
    parts.push('</label>');
    parts.push('</div>');

    if (data.leaders.length === 0) {
      parts.push('<div class="grid gap-6">');
      parts.push(
        '<div class="rounded-3xl border border-dashed border-white/10 bg-slate-950/60 px-10 py-16 text-center">',
      );
      parts.push('<div class="mx-auto h-14 w-14 rounded-full border border-white/10 bg-white/5"></div>');
      parts.push('<p class="mt-6 text-lg font-semibold text-white">Pas encore de hype mesurée</p>');
      parts.push(
        '<p class="mt-2 text-sm text-slate-400">Connecte-toi au salon vocal pour lancer les festivités.</p>',
      );
      parts.push('</div>');
      parts.push('</div>');
      parts.push('</section>');
      parts.push('</div>');
      return parts.join('');
    }

    parts.push('<div class="grid gap-6">');
    for (const [index, leader] of data.leaders.entries()) {
      const rank = leader.rank || index + 1;
      const style = rank <= 3 ? AppServer.classementsTopThreeStyles[rank - 1] : null;
      const highlight = style?.highlight ?? 'border-white/5 bg-slate-900/50';
      const accent = style?.accent ?? 'from-transparent to-transparent';
      const ring = style?.ring ?? 'ring-2 ring-white/10';
      const badgeClass = style?.badge ?? 'bg-slate-900/90 text-white border border-white/20';
      const trend = this.describeClassementTrend(leader.positionTrend);
      const normalizedUsername = leader.username
        ? leader.username.startsWith('@')
          ? leader.username
          : `@${leader.username}`
        : null;
      const activityScore = formatScore(leader.activityScore);
      const avatarUrl = this.selectClassementsAvatar(leader);
      const hasAvatar = typeof avatarUrl === 'string' && avatarUrl.length > 0;
      const seed = this.computeClassementAvatarSeed(leader, rank);
      const fallbackBackground = this.selectFallbackAvatarBackground(seed);
      const altName = (() => {
        const name = leader.displayName?.trim();
        if (name) {
          return name;
        }
        const username = normalizedUsername ? normalizedUsername.replace(/^@/, '') : '';
        return username || `profil ${padRank(rank)}`;
      })();

      const userId = typeof leader.userId === 'string' ? leader.userId : '';
      const profileHref = userId ? `/profil/${encodeURIComponent(userId)}` : null;
      if (profileHref) {
        parts.push(
          `<a class="leader-card-link" href="${this.escapeHtml(profileHref)}" aria-label="Voir le profil de ${this.escapeHtml(altName)}">`,
        );
      }

      parts.push(
        `<article data-rank="${rank}" class="leader-card relative overflow-hidden rounded-3xl border ${highlight}">`,
      );
      parts.push(`<div class="absolute inset-0 bg-gradient-to-r ${accent} opacity-[0.22]"></div>`);
      parts.push('<div class="relative flex flex-col gap-6 p-6">');
      parts.push('<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">');
      parts.push('<div class="flex items-center gap-4">');
      parts.push('<div class="relative">');
      parts.push(
        `<div class="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-slate-950/70 ${ring} ring-offset-2 ring-offset-slate-950">`,
      );
      if (hasAvatar && avatarUrl) {
        parts.push(
          `<img src="${this.escapeHtml(avatarUrl)}" alt="Avatar de ${this.escapeHtml(altName)}" loading="lazy" class="h-full w-full object-cover" />`,
        );
      } else {
        parts.push(
          `<span class="flex h-full w-full items-center justify-center bg-gradient-to-br ${fallbackBackground} text-lg font-semibold text-white/90">${this.escapeHtml(this.getClassementLeaderInitials(leader))}</span>`,
        );
      }
      parts.push('</div>');
      parts.push(
        `<span class="absolute -bottom-1 -right-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-xs font-bold shadow-lg shadow-black/50 ${badgeClass}">#${padRank(rank)}</span>`,
      );
      parts.push('</div>');
      parts.push('<div class="space-y-1.5">');
      parts.push(`<h3 class="text-lg font-semibold text-white">${this.escapeHtml(leader.displayName ?? 'Inconnu·e')}</h3>`);
      if (normalizedUsername) {
        parts.push(`<p class="text-xs font-medium text-slate-400/80">${this.escapeHtml(normalizedUsername)}</p>`);
      }
      parts.push(
        `<p class="text-[0.65rem] uppercase tracking-[0.3em] text-slate-400/70">Activité ${this.escapeHtml(activityScore)}</p>`,
      );
      parts.push('</div>');
      parts.push('</div>');
      parts.push(
        `<div class="flex flex-col items-start gap-1 rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-[0.65rem] font-semibold leading-tight text-white/80 sm:items-end sm:self-start sm:text-right">`,
      );
      parts.push(
        `<span class="flex items-center gap-1 ${trend.className}"><span aria-hidden="true">${trend.icon}</span><span>${this.escapeHtml(trend.delta)}</span></span>`,
      );
      parts.push(
        `<span class="text-[0.55rem] uppercase tracking-[0.25em] text-slate-400/70">${this.escapeHtml(trend.label)}</span>`,
      );
      parts.push('</div>');
      parts.push('</div>');
      parts.push('<dl class="grid grid-cols-2 gap-5 text-sm sm:grid-cols-4">');
      parts.push('<div>');
      parts.push('<dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Score hype</dt>');
      parts.push(`<dd class="mt-1 text-base font-semibold text-sky-300">${this.escapeHtml(formatScore(leader.schScoreNorm))}</dd>`);
      parts.push('</div>');
      parts.push('<div>');
      parts.push('<dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Effet arrivée</dt>');
      parts.push(`<dd class="mt-1 text-base font-semibold text-purple-200">${this.escapeHtml(formatSigned(leader.arrivalEffect))}</dd>`);
      parts.push('</div>');
      parts.push('<div>');
      parts.push('<dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Effet départ</dt>');
      parts.push(`<dd class="mt-1 text-base font-semibold text-emerald-200">${this.escapeHtml(formatSigned(leader.departureEffect))}</dd>`);
      parts.push('</div>');
      parts.push('<div>');
      parts.push('<dt class="text-xs uppercase tracking-[0.3em] text-slate-400">Indice d&#39;activité</dt>');
      parts.push(`<dd class="mt-1 text-base font-semibold text-fuchsia-300">${this.escapeHtml(activityScore)}</dd>`);
      parts.push('</div>');
      parts.push('</dl>');
      parts.push('</div>');
      parts.push('</article>');
      if (profileHref) {
        parts.push('</a>');
      }
    }
    parts.push('</div>');
    parts.push('</section>');
    parts.push('</div>');
    return parts.join('');
  }

  private parseShopCheckoutFeedback(
    status: string | null | undefined,
  ): { type: 'success' | 'info' | 'error'; message: string } | null {
    if (!status) {
      return null;
    }

    const normalized = status.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (normalized === 'success') {
      return {
        type: 'success',
        message: 'Merci pour ton soutien ! La commande est bien prise en compte.',
      };
    }

    if (normalized === 'cancelled') {
      return {
        type: 'info',
        message: 'Paiement annulé. Tu peux réessayer quand tu veux.',
      };
    }

    return {
      type: 'error',
      message: 'Une erreur est survenue lors du paiement. Aucun débit n’a été effectué.',
    };
  }

  private buildShopPagePrerender(options: { checkoutStatus?: string | null; products?: PublicProduct[] } = {}): {
    html: string;
    bootstrap: ShopPageBootstrap;
  } {
    const products = Array.isArray(options.products) ? options.products : this.shopService.getProducts();
    const feedback = this.parseShopCheckoutFeedback(options.checkoutStatus);
    const html = this.buildShopPageHtml({ products, feedback });
    return { html, bootstrap: { products } };
  }

  private buildShopStructuredData(products: PublicProduct[]): unknown[] {
    if (!Array.isArray(products) || products.length === 0) {
      return [];
    }

    const seller = {
      '@type': 'Organization',
      name: this.config.siteName,
      url: this.config.publicBaseUrl,
    };

    const normalizePaymentMethod = (provider: ShopProvider): string | null => {
      switch (provider) {
        case 'paypal':
          return 'https://schema.org/PayPal';
        case 'coingate':
          return 'https://schema.org/Cryptocurrency';
        case 'stripe':
          return 'https://schema.org/CreditCard';
        default:
          return null;
      }
    };

    const itemListElements = products
      .map((product, index) => {
        if (!product || typeof product.id !== 'string') {
          return null;
        }

        const productUrl = this.toAbsoluteUrl(`/boutique#${encodeURIComponent(product.id)}`);
        const imageUrl = this.toAbsoluteMediaUrl(product.image?.url ?? null);
        const includes = Array.isArray(product.includes) ? product.includes.filter(Boolean) : [];
        const badges = Array.isArray(product.badges) ? product.badges.filter(Boolean) : [];
        const paymentMethods = Array.isArray(product.providers)
          ? Array.from(
              new Set(
                product.providers
                  .map((provider) => normalizePaymentMethod(provider))
                  .filter((method): method is string => Boolean(method)),
              ),
            )
          : [];

        const offer: Record<string, unknown> = {
          '@type': 'Offer',
          url: productUrl,
          priceCurrency: product.price?.currency?.toUpperCase?.() ?? 'EUR',
          availability: 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition',
          seller,
        };

        const priceAmount = Number(product.price?.amount);
        if (Number.isFinite(priceAmount)) {
          offer.price = priceAmount.toFixed(2);
        }

        if (paymentMethods.length > 0) {
          offer.acceptedPaymentMethod = paymentMethods;
        }

        const additionalProperties = includes.map((value) => ({
          '@type': 'PropertyValue',
          name: 'Inclus',
          value,
        }));

        const releaseDate = this.formatSitemapDate(product.updatedAt ?? null);

        const productData: Record<string, unknown> = {
          '@type': 'Product',
          name: product.name,
          description: product.description,
          sku: product.id,
          offers: offer,
          brand: {
            '@type': 'Brand',
            name: this.config.siteName,
          },
        };

        if (imageUrl) {
          productData.image = imageUrl;
        }

        if (badges.length > 0) {
          productData.keywords = badges.join(', ');
        }

        if (additionalProperties.length > 0) {
          productData.additionalProperty = additionalProperties;
        }

        if (releaseDate) {
          productData.releaseDate = releaseDate;
          productData.dateModified = releaseDate;
        }

        return {
          '@type': 'ListItem',
          position: index + 1,
          url: productUrl,
          name: product.name,
          item: productData,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (itemListElements.length === 0) {
      return [];
    }

    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${this.config.siteName} – Sélection boutique`,
      description:
        'Catalogue des produits officiels Libre Antenne avec détails des offres, tarifs et moyens de paiement disponibles.',
      url: this.toAbsoluteUrl('/boutique'),
      numberOfItems: itemListElements.length,
      itemListOrder: 'http://schema.org/ItemListOrderAscending',
      itemListElement: itemListElements,
    };

    return [itemList];
  }

  private buildShopPageHtml(data: {
    products: PublicProduct[];
    feedback: { type: 'success' | 'info' | 'error'; message: string } | null;
  }): string {
    const parts: string[] = [];
    const sortedProducts = data.products
      .slice()
      .sort((a, b) => Number(Boolean(b.highlight)) - Number(Boolean(a.highlight)));

    parts.push('<div class="shop-page flex flex-col gap-10">');
    parts.push(
      '<section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">',
    );
    parts.push('<p class="text-xs uppercase tracking-[0.35em] text-slate-300">Boutique officielle</p>');
    parts.push('<div class="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">');
    parts.push('<div class="space-y-4">');
    parts.push('<h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">La Boutique Libre Antenne</h1>');
    parts.push(
      '<p class="text-base leading-relaxed text-slate-200">Soutiens la libre antenne et repars avec des pièces conçues pour les noctambules, les gamers et les voix libres. Paiement sécurisé via Stripe, PayPal ou CoinGate.</p>',
    );
    parts.push('<div class="flex flex-wrap gap-3 text-xs text-slate-200">');
    parts.push(
      `<span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5">${this.renderLucideIcon('ShoppingBag', 'h-4 w-4')}Stripe, PayPal & CoinGate</span>`,
    );
    parts.push(
      `<span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5">${this.renderLucideIcon('Truck', 'h-4 w-4')}Livraison France & Europe</span>`,
    );
    parts.push(
      `<span class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5">${this.renderLucideIcon('Coffee', 'h-4 w-4')}Production à la demande</span>`,
    );
    parts.push('</div>');
    parts.push('</div>');
    parts.push(
      '<div class="rounded-3xl border border-fuchsia-400/40 bg-fuchsia-500/10 px-6 py-6 text-sm text-fuchsia-100 shadow-lg shadow-fuchsia-900/30">',
    );
    parts.push('<p class="text-xs uppercase tracking-[0.35em] text-fuchsia-200/80">Libre antenne</p>');
    parts.push(
      '<p class="mt-3 leading-relaxed">Chaque achat finance l’hébergement du bot, le mixage audio et la préparation de nouvelles émissions en roue libre. Merci de faire tourner la radio indépendante.</p>',
    );
    parts.push('</div>');
    parts.push('</div>');
    parts.push('</section>');

    if (data.feedback) {
      const styles: Record<string, string> = {
        success: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
        info: 'border-sky-400/40 bg-sky-500/10 text-sky-100',
        error: 'border-rose-400/40 bg-rose-500/10 text-rose-100',
      };
      const icon =
        data.feedback.type === 'success'
          ? 'ShieldCheck'
          : data.feedback.type === 'error'
          ? 'AlertCircle'
          : 'RefreshCcw';
      const style = styles[data.feedback.type] ?? styles.info;
      parts.push(
        `<div class="rounded-2xl border px-5 py-4 text-sm shadow-lg shadow-slate-950/40 backdrop-blur ${style}">`,
      );
      parts.push('<div class="flex items-center gap-3">');
      parts.push(this.renderLucideIcon(icon, 'h-4 w-4'));
      parts.push(`<span>${this.escapeHtml(data.feedback.message)}</span>`);
      parts.push('</div>');
      parts.push('</div>');
    }

    parts.push('<section class="space-y-6">');
    if (sortedProducts.length === 0) {
      parts.push(
        '<div class="rounded-3xl border border-white/10 bg-black/30 px-6 py-10 text-center text-sm text-slate-300">Catalogue en cours de réapprovisionnement. Reviens bientôt !</div>',
      );
    } else {
      parts.push('<div class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">');
      for (const product of sortedProducts) {
        parts.push(this.buildShopProductCard(product));
      }
      parts.push('</div>');
    }
    parts.push('</section>');

    parts.push('<section class="grid gap-6 lg:grid-cols-2">');
    parts.push(
      '<div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">',
    );
    parts.push('<h3 class="flex items-center gap-2 text-lg font-semibold text-white">');
    parts.push(`${this.renderLucideIcon('ShieldCheck', 'h-5 w-5 text-emerald-300')}Paiements vérifiés`);
    parts.push('</h3>');
    parts.push(
      '<p class="mt-3 text-sm leading-relaxed text-slate-300">Stripe chiffre chaque transaction et accepte la plupart des cartes, Apple Pay et Google Pay. Aucun numéro sensible n’est stocké sur nos serveurs.</p>',
    );
    parts.push('</div>');
    parts.push(
      '<div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">',
    );
    parts.push('<h3 class="flex items-center gap-2 text-lg font-semibold text-white">');
    parts.push(`${this.renderLucideIcon('Coins', 'h-5 w-5 text-emerald-300')}Crypto friendly`);
    parts.push('</h3>');
    parts.push(
      '<p class="mt-3 text-sm leading-relaxed text-slate-300">CoinGate permet de régler en Bitcoin, Lightning Network et plus de 70 altcoins, avec conversion instantanée en euros ou conservation en crypto.</p>',
    );
    parts.push('</div>');
    parts.push('</section>');
    parts.push('</div>');

    return parts.join('');
  }

  private buildShopProductCard(product: PublicProduct): string {
    const parts: string[] = [];
    const emoji = this.escapeHtml(product.emoji ?? '🛒');
    const highlightBadge = product.highlight
      ? `<span class="inline-flex items-center gap-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-fuchsia-100">${this.renderLucideIcon('Sparkles', 'h-3 w-3 text-fuchsia-200')}<span class="tracking-normal">Coup de cœur</span></span>`
      : '';
    const badges = Array.isArray(product.badges) ? product.badges : [];
    const includes = Array.isArray(product.includes) ? product.includes : [];
    const providers = Array.isArray(product.providers) ? product.providers : [];
    const image = product.image ?? null;

    parts.push(
      '<article class="flex h-full flex-col rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">',
    );
    parts.push('<div class="flex items-center justify-between">');
    parts.push(`<span class="text-4xl" aria-hidden="true">${emoji}</span>`);
    if (highlightBadge) {
      parts.push(highlightBadge);
    }
    parts.push('</div>');

    if (badges.length > 0) {
      parts.push('<div class="mt-4 flex flex-wrap gap-2">');
      badges.forEach((badge) => {
        parts.push(
          `<span class="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-slate-200/90">${this.renderLucideIcon('BadgeCheck', 'h-3 w-3 text-emerald-300')}<span class="tracking-normal">${this.escapeHtml(badge)}</span></span>`,
        );
      });
      parts.push('</div>');
    }

    if (image && image.url) {
      const url = this.escapeHtml(image.url);
      const alt = this.escapeHtml(image.alt ?? product.name ?? 'Visuel du produit');
      const accent = product.accent ? ` ${this.escapeHtml(product.accent)}` : '';
      parts.push(`<figure class="relative mt-6 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br${accent}">`);
      parts.push(
        `<img src="${url}" alt="${alt}" class="h-full w-full object-cover object-center" loading="lazy" decoding="async" />`,
      );
      parts.push('</figure>');
    }

    parts.push(`<h3 class="mt-5 text-xl font-semibold text-white">${this.escapeHtml(product.name)}</h3>`);
    parts.push(`<p class="mt-2 text-sm leading-relaxed text-slate-300">${this.escapeHtml(product.description)}</p>`);

    const accentSoft = product.accentSoft ? this.escapeHtml(product.accentSoft) : 'bg-white/10';
    const price = product.price?.formatted ? this.escapeHtml(product.price.formatted) : '—';
    parts.push(`<div class="mt-4 rounded-3xl border border-white/10 px-5 py-4 ${accentSoft}">`);
    parts.push(`<p class="text-3xl font-bold text-white">${price}</p>`);
    parts.push('<p class="text-xs uppercase tracking-[0.35em] text-slate-300">TTC</p>');
    parts.push('</div>');

    if (includes.length > 0) {
      parts.push('<ul class="mt-5 space-y-2 text-sm text-slate-200">');
      includes.forEach((item) => {
        parts.push('<li class="flex items-start gap-2">');
        parts.push(this.renderLucideIcon('ShieldCheck', 'mt-0.5 h-4 w-4 text-indigo-300'));
        parts.push(`<span>${this.escapeHtml(item)}</span>`);
        parts.push('</li>');
      });
      parts.push('</ul>');
    }

    const shipping = product.shippingEstimate
      ? this.escapeHtml(product.shippingEstimate)
      : 'Livraison estimée communiquée après commande';
    parts.push('<p class="mt-4 flex items-center gap-2 text-xs text-slate-400">');
    parts.push(this.renderLucideIcon('Truck', 'h-4 w-4'));
    parts.push(`<span>${shipping}</span>`);
    parts.push('</p>');

    parts.push('<div class="mt-6 flex flex-col gap-3">');
    if (providers.length > 0) {
      for (const provider of providers) {
        const config = AppServer.shopProviderRenderConfig[provider];
        if (!config) {
          continue;
        }
        const accent = this.escapeHtml(config.accentClass);
        parts.push('<div class="flex flex-col gap-1">');
        parts.push(
          `<button type="button" class="flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold text-white transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-50 ${accent}">Payer avec ${this.escapeHtml(config.label)}${this.renderLucideIcon(config.icon, 'h-4 w-4')}</button>`,
        );
        parts.push(`<span class="text-xs text-slate-400">${this.escapeHtml(config.helper)}</span>`);
        parts.push('</div>');
      }
    } else {
      parts.push(
        '<div class="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-center text-sm text-slate-300">Paiements bientôt disponibles pour ce produit.</div>',
      );
    }
    parts.push('</div>');

    parts.push('</article>');
    return parts.join('');
  }

  private buildPremiumPageHtml(): string {
    const heroParagraphs = [
      "Le programme premium finance l'infrastructure audio, la modération nocturne et les ateliers animés par la communauté.",
      'Les abonnements sont sans engagement : chaque contribution débloque des accès dédiés et renforce la diffusion libre de la radio.',
    ];
    const benefits: Array<{ icon: string; title: string; description: string }> = [
      {
        icon: 'Sparkles',
        title: 'Accès prioritaire',
        description:
          'Rejoins les masterclasses, sessions feedback et tests de nouveautés avant tout le monde avec un canal de coordination dédié.',
      },
      {
        icon: 'ShieldCheck',
        title: 'Coulisses & replays privés',
        description:
          'Retrouve les briefs d’émission, les replays audio en accès limité et les notes de modération pour approfondir chaque thème.',
      },
      {
        icon: 'Users',
        title: 'Soutien transparent',
        description:
          'Chaque contribution finance le serveur audio, la maintenance du bot et les outils de diffusion communautaires.',
      },
    ];
    const inclusions = [
      'Badge premium sur Discord et sur la plateforme web',
      'Accès anticipé aux ateliers thématiques et aux tests techniques',
      'Newsletter backstage avec récap des débats et coulisses du direct',
      'Role spécial pour voter sur la programmation et les invités',
    ];
    const faqItems: Array<{ question: string; answer: string }> = [
      {
        question: 'Comment activer mon accès premium ?',
        answer:
          'Passe par la boutique Libre Antenne pour choisir une formule. Une fois le paiement confirmé, l’équipe ajoute ton rôle premium sur Discord dans les 24 heures.',
      },
      {
        question: 'Puis-je arrêter mon soutien quand je veux ?',
        answer:
          'Oui. Les formules sont sans engagement : tu peux annuler ton abonnement depuis ton fournisseur de paiement et conserveras l’accès jusqu’à la fin de la période en cours.',
      },
      {
        question: 'Que finance concrètement mon abonnement ?',
        answer:
          'Les contributions couvrent l’hébergement du serveur audio, les licences logicielles, la diffusion web en continu et une partie des goodies offerts aux bénévoles actifs.',
      },
    ];

    const parts: string[] = [];
    parts.push('<div class="premium-page flex flex-col gap-10">');
    parts.push(
      '<section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">',
    );
    parts.push('<p class="text-xs uppercase tracking-[0.35em] text-slate-300">Soutenir Libre Antenne</p>');
    parts.push('<h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Accès Premium & soutien communautaire</h1>');
    for (const paragraph of heroParagraphs) {
      parts.push(`<p class="text-base leading-relaxed text-slate-200">${this.escapeHtml(paragraph)}</p>`);
    }
    parts.push('<div class="flex flex-wrap gap-3">');
    parts.push(
      `<a class="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/20 px-4 py-2 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-500/30 hover:text-white" href="/boutique">Choisir une formule${this.renderLucideIcon('ShoppingBag', 'h-4 w-4')}</a>`,
    );
    parts.push(
      `<a class="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/20 hover:text-white" href="https://discord.gg/" target="_blank" rel="noreferrer">Contacter l'équipe${this.renderLucideIcon('MessageSquare', 'h-4 w-4')}</a>`,
    );
    parts.push('</div>');
    parts.push('</section>');

    parts.push('<section class="grid gap-6 md:grid-cols-3">');
    for (const benefit of benefits) {
      parts.push(
        '<article class="space-y-4 rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">',
      );
      parts.push(
        `<span class="inline-flex h-12 w-12 items-center justify-center rounded-full bg-fuchsia-500/15 text-fuchsia-200">${this.renderLucideIcon(benefit.icon, 'h-5 w-5')}</span>`,
      );
      parts.push(`<h2 class="text-xl font-semibold text-white">${this.escapeHtml(benefit.title)}</h2>`);
      parts.push(`<p class="text-sm leading-relaxed text-slate-300">${this.escapeHtml(benefit.description)}</p>`);
      parts.push('</article>');
    }
    parts.push('</section>');

    parts.push('<section class="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">');
    parts.push(
      '<div class="space-y-5 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">',
    );
    parts.push('<h2 class="text-2xl font-semibold text-white">Ce que comprend l\'accès premium</h2>');
    parts.push('<ul class="space-y-3 text-sm text-slate-200">');
    for (const inclusion of inclusions) {
      parts.push('<li class="flex items-start gap-3">');
      parts.push(
        `<span class="mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-fuchsia-500/20 text-fuchsia-200">${this.renderLucideIcon('ShieldCheck', 'h-3.5 w-3.5')}</span>`,
      );
      parts.push(`<span class="leading-relaxed">${this.escapeHtml(inclusion)}</span>`);
      parts.push('</li>');
    }
    parts.push('</ul>');
    parts.push('</div>');

    parts.push(
      '<div class="space-y-4 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-inner shadow-slate-950/50">',
    );
    parts.push('<h2 class="text-2xl font-semibold text-white">Rythme & accompagnement</h2>');
    parts.push(
      '<p class="text-sm leading-relaxed text-slate-300">L\'équipe premium suit personnellement chaque nouveau membre : un brief Discord est organisé pour activer les rôles et présenter les prochains rendez-vous communautaires.</p>',
    );
    parts.push(
      '<div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">',
    );
    parts.push(
      `<span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-500/20 text-fuchsia-200">${this.renderLucideIcon('Clock3', 'h-5 w-5')}</span>`,
    );
    parts.push('<div>');
    parts.push('<p class="font-semibold text-white">Activation sous 24h ouvrées</p>');
    parts.push(
      '<p class="text-xs text-slate-300">Un salon dédié permet de suivre l\'état de ton adhésion et d\'échanger avec l\'équipe support.</p>',
    );
    parts.push('</div>');
    parts.push('</div>');
    parts.push(
      '<p class="text-sm leading-relaxed text-slate-300">Les contributions sont regroupées chaque mois dans un rapport transparent partagé sur le serveur : infrastructure, licences et dotations bénévoles.</p>',
    );
    parts.push('</div>');
    parts.push('</section>');

    parts.push(
      '<section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-6 py-8 shadow-xl shadow-slate-950/40 backdrop-blur">',
    );
    parts.push('<h2 class="text-2xl font-semibold text-white">Questions fréquentes</h2>');
    parts.push('<div class="space-y-5">');
    for (const item of faqItems) {
      parts.push(
        '<details class="group rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-slate-200 shadow-sm shadow-slate-950/30">',
      );
      parts.push(
        `<summary class="cursor-pointer select-none text-base font-semibold text-white">${this.escapeHtml(item.question)}</summary>`,
      );
      parts.push(`<p class="mt-3 text-sm leading-relaxed text-slate-300">${this.escapeHtml(item.answer)}</p>`);
      parts.push('</details>');
    }
    parts.push('</div>');
    parts.push('</section>');
    parts.push('</div>');

    return parts.join('');
  }

  private buildAboutPageHtml(): string {
    const parts: string[] = [];
    parts.push('<div class="about-page flex flex-col gap-10">');
    parts.push(
      '<section class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">',
    );
    parts.push('<p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>');
    parts.push('<h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">À propos de Libre Antenne</h1>');
    parts.push(
      '<p class="text-base leading-relaxed text-slate-200">Libre Antenne est une zone franche où les voix prennent le pouvoir. Le flux est volontairement brut, capté en direct sur notre serveur Discord pour amplifier les histoires, les confidences et les improvisations qui naissent.</p>',
    );
    parts.push(
      '<p class="text-base leading-relaxed text-slate-200">Notre équipe façonne un espace accueillant pour les marginaux créatifs, les gamers insomniaques et toutes les personnes qui ont besoin d’un micro ouvert. Ici, aucune intervention n’est scriptée : la seule règle est de respecter la vibe collective et de laisser la spontanéité guider la conversation.</p>',
    );
    parts.push(
      `<a class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/20 hover:text-white" href="https://discord.gg/" target="_blank" rel="noreferrer">Rejoindre la communauté${this.renderLucideIcon('ArrowRight', 'h-4 w-4')}</a>`,
    );
    parts.push('</section>');

    parts.push('<section class="grid gap-6 md:grid-cols-2">');
    const highlights: Array<{ title: string; body: string }> = [
      {
        title: 'Un laboratoire créatif',
        body:
          'Sessions freestyle, confessions lunaires, débats improvisés : chaque passage est un moment unique façonné par la communauté. Le direct nous permet de capturer cette énergie sans filtre.',
      },
      {
        title: 'Technologie artisanale',
        body:
          'Notre mixeur audio fait circuler chaque voix avec finesse. Les outils open source et les contributions des membres permettent d’améliorer constamment la qualité du flux.',
      },
      {
        title: 'Communauté inclusive',
        body:
          'Peu importe ton accent, ton parcours ou ton rythme de vie : tu es accueilli·e tant que tu joues collectif et que tu respectes celles et ceux qui partagent le micro.',
      },
      {
        title: 'Un projet vivant',
        body:
          'Les bénévoles, auditeurs et créateurs participent à l’évolution de Libre Antenne. Chaque nouvelle voix façonne la suite de l’aventure et inspire les fonctionnalités à venir.',
      },
    ];

    for (const highlight of highlights) {
      parts.push(
        '<div class="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">',
      );
      parts.push(`<h2 class="text-xl font-semibold text-white">${this.escapeHtml(highlight.title)}</h2>`);
      parts.push(`<p class="mt-3 text-sm text-slate-300">${this.escapeHtml(highlight.body)}</p>`);
      parts.push('</div>');
    }
    parts.push('</section>');
    parts.push('</div>');

    return parts.join('');
  }

  private buildCguPageHtml(): string {
    const parts: string[] = [];
    const obligations = [
      'Respecte les règles Discord, la loi française et les sensibilités des autres participants.',
      'Ne partage pas de contenus illicites, discriminatoires ou contraires aux valeurs d’inclusion du projet.',
      'Accepte que les modérateurs puissent couper un micro, exclure un membre ou signaler une situation à Discord.',
      'Préserve la confidentialité des informations personnelles échangées hors antenne.',
    ];
    const dataCategories = [
      {
        title: 'Flux audio en direct',
        description:
          'Les voix captées sur Discord sont transmises en continu pour la diffusion publique du direct Libre Antenne.',
        usage:
          'Diffusion du direct, supervision technique en temps réel et détection d’abus pour protéger les membres.',
        retention:
          'Aucun enregistrement permanent. Tampon de diffusion inférieur à deux minutes et journaux techniques conservés 24 heures maximum.',
      },
      {
        title: 'Métadonnées Discord & activité communautaire',
        description:
          'Identifiants Discord, pseudonymes, états vocaux, temps de présence et statistiques de participation générés pendant les sessions.',
        usage:
          'Affichage des participants, génération des classements, lutte contre le spam et modération communautaire.',
        retention:
          'Historique agrégé conservé douze mois pour les classements ; anonymisation ou suppression des identifiants 30 jours après départ du serveur.',
      },
      {
        title: 'Statistiques d’écoute et journaux techniques',
        description:
          'Adresse IP tronquée, agent utilisateur, date de connexion et compteurs d’audience collectés par nos serveurs.',
        usage:
          'Mesure d’audience, équilibrage de charge, sécurité réseau et détection d’utilisation frauduleuse.',
        retention:
          'Journaux bruts stockés 30 jours maximum ; agrégats statistiques anonymisés conservés jusqu’à 24 mois.',
      },
      {
        title: 'Formulaires, boutique & support',
        description:
          'Nom, alias, coordonnées, commandes et contenus soumis via la boutique, le blog ou les canaux de contact.',
        usage:
          'Traitement des demandes, suivi de commande, assistance et obligations comptables ou légales.',
        retention:
          'Données contractuelles conservées jusqu’à cinq ans ; brouillons rejetés supprimés sous six mois ; suppression accélérée sur demande légitime.',
      },
      {
        title: 'Préférences locales & cookies fonctionnels',
        description:
          'Réglages de volume, choix du thème et état de connexion administrateur stockés sur ton appareil.',
        usage:
          'Assurer le confort d’écoute, maintenir la session sécurisée et mémoriser les préférences de navigation.',
        retention:
          'Stockage local conservé sur ton appareil ; cookies fonctionnels expirent au plus tard après douze mois.',
      },
    ];
    const finalities = [
      'Diffuser un flux audio communautaire conforme aux règles Discord et au droit français.',
      'Fournir des outils de modération, de statistiques et de découverte de talents à la communauté.',
      'Garantir la sécurité des infrastructures et prévenir les abus ou tentatives de fraude.',
      'Respecter les obligations légales en matière de facturation, de conservation comptable et de réponse aux autorités compétentes.',
    ];
    const conservationRules = [
      'Données audio et préférences locales : uniquement le temps nécessaire à la diffusion en direct ou à l’usage de ton navigateur.',
      'Historique de participation et classements : conservation maximale de douze mois, avec anonymisation progressive au-delà.',
      'Logs techniques et métriques d’audience : conservation inférieure ou égale à trente jours, agrégats anonymisés jusqu’à vingt-quatre mois.',
      'Documents contractuels et commandes : conservation légale de cinq ans, puis archivage sécurisé ou suppression.',
    ];
    const rights = [
      'Accès, rectification, effacement : écris-nous pour consulter ou corriger les informations liées à ton compte Discord ou à une commande.',
      'Limitation et opposition : tu peux demander la suspension des statistiques te concernant ou t’opposer au traitement marketing.',
      'Portabilité : sur demande, nous exportons les données structurées liées à tes interactions lorsqu’elles sont techniquement disponibles.',
      'Retrait du consentement : les préférences facultatives (cookies analytiques, newsletter) peuvent être retirées à tout moment.',
      'Réclamation : tu peux contacter l’autorité de contrôle compétente (CNIL) si tu estimes que tes droits ne sont pas respectés.',
    ];
    const contacts = [
      'Salon #support sur Discord pour les demandes rapides liées au direct.',
      'Adresse dédiée : privacy@libre-antenne.xyz pour toute question relative aux données ou à la modération.',
      'Courrier postal sur demande pour les requêtes nécessitant une identification renforcée.',
    ];

    parts.push('<div class="cgu-page flex flex-col gap-10">');
    parts.push(
      '<article class="space-y-6 rounded-3xl border border-white/10 bg-white/5 px-8 py-12 shadow-xl shadow-slate-950/40 backdrop-blur-xl">',
    );
    parts.push('<p class="text-xs uppercase tracking-[0.35em] text-slate-300">Libre Antenne</p>');
    parts.push(
      '<h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">Conditions générales d’utilisation & gestion des données</h1>',
    );
    parts.push(
      '<p class="text-base leading-relaxed text-slate-200">Libre Antenne est un service communautaire de diffusion audio en direct. L’accès au flux, aux salons Discord associés et aux outils proposés implique l’acceptation pleine et entière des présentes conditions générales d’utilisation (CGU).</p>',
    );
    parts.push(
      '<p class="text-base leading-relaxed text-slate-200">En rejoignant la communauté, tu reconnais que chaque intervenant reste responsable de ses propos, que l’équipe de modération peut intervenir pour préserver un espace sûr, et que des traitements techniques sont nécessaires pour assurer la diffusion et la sécurité du service.</p>',
    );
    parts.push('<ul class="list-disc space-y-2 pl-6 text-sm text-slate-200">');
    for (const item of obligations) {
      parts.push(`<li>${this.escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
    parts.push('</article>');

    parts.push('<section class="grid gap-6 md:grid-cols-2">');
    for (const category of dataCategories) {
      parts.push(
        '<article class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/40 backdrop-blur">',
      );
      parts.push(`<h2 class="text-xl font-semibold text-white">${this.escapeHtml(category.title)}</h2>`);
      parts.push(`<p class="mt-3 text-sm leading-relaxed text-slate-300">${this.escapeHtml(category.description)}</p>`);
      parts.push('<dl class="mt-4 space-y-2 text-sm text-slate-300">');
      parts.push('<div>');
      parts.push('<dt class="font-semibold text-slate-200">Finalité principale</dt>');
      parts.push(`<dd>${this.escapeHtml(category.usage)}</dd>`);
      parts.push('</div>');
      parts.push('<div>');
      parts.push('<dt class="font-semibold text-slate-200">Durée de conservation</dt>');
      parts.push(`<dd>${this.escapeHtml(category.retention)}</dd>`);
      parts.push('</div>');
      parts.push('</dl>');
      parts.push('</article>');
    }
    parts.push('</section>');

    parts.push('<section class="grid gap-6 lg:grid-cols-2">');
    parts.push(
      '<div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">',
    );
    parts.push('<h2 class="text-lg font-semibold text-white">Finalités & bases légales</h2>');
    parts.push('<ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">');
    for (const item of finalities) {
      parts.push(`<li>${this.escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
    parts.push('</div>');
    parts.push(
      '<div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">',
    );
    parts.push('<h2 class="text-lg font-semibold text-white">Durées de conservation</h2>');
    parts.push('<ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">');
    for (const item of conservationRules) {
      parts.push(`<li>${this.escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
    parts.push('</div>');
    parts.push('</section>');

    parts.push('<section class="grid gap-6 lg:grid-cols-2">');
    parts.push(
      '<div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">',
    );
    parts.push('<h2 class="text-lg font-semibold text-white">Tes droits</h2>');
    parts.push('<ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">');
    for (const item of rights) {
      parts.push(`<li>${this.escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
    parts.push('</div>');
    parts.push(
      '<div class="rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-lg shadow-slate-950/30 backdrop-blur">',
    );
    parts.push('<h2 class="text-lg font-semibold text-white">Nous contacter</h2>');
    parts.push(
      '<p class="text-sm leading-relaxed text-slate-300">Notre équipe traite chaque requête dans un délai raisonnable (moins de 30 jours pour les demandes liées aux données personnelles). Identifie-toi clairement afin que nous puissions t’accompagner en toute sécurité.</p>',
    );
    parts.push('<ul class="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-300">');
    for (const item of contacts) {
      parts.push(`<li>${this.escapeHtml(item)}</li>`);
    }
    parts.push('</ul>');
    parts.push('</div>');
    parts.push('</section>');

    parts.push('<p class="text-xs uppercase tracking-[0.25em] text-slate-500">Dernière mise à jour : 4 novembre 2024</p>');
    parts.push('</div>');

    return parts.join('');
  }

  private normalizeClassementLeader(leader: HypeLeaderWithTrend, index: number): ClassementLeaderBootstrap {
    const rank = Number.isFinite(leader.rank) ? Math.max(1, Math.floor(Number(leader.rank))) : index + 1;
    const absoluteRank = Number.isFinite(leader.absoluteRank)
      ? Math.max(1, Math.floor(Number(leader.absoluteRank)))
      : null;
    const positionTrend = leader.positionTrend
      ? {
          movement: leader.positionTrend.movement ?? 'same',
          delta: Number.isFinite(leader.positionTrend.delta) ? Number(leader.positionTrend.delta) : null,
          comparedAt: leader.positionTrend.comparedAt
            ? leader.positionTrend.comparedAt.toISOString()
            : null,
        }
      : null;

    return {
      userId: leader.userId,
      displayName: leader.displayName ?? null,
      username: leader.username ?? null,
      rank,
      absoluteRank,
      avatar: leader.avatar ?? null,
      avatarUrl: leader.avatarUrl ?? null,
      profileAvatar: leader.profile?.avatar ?? null,
      activityScore: Number.isFinite(leader.activityScore) ? Number(leader.activityScore) : 0,
      arrivalEffect: Number.isFinite(leader.arrivalEffect) ? Number(leader.arrivalEffect) : 0,
      departureEffect: Number.isFinite(leader.departureEffect) ? Number(leader.departureEffect) : 0,
      schScoreNorm: Number.isFinite(leader.schScoreNorm) ? Number(leader.schScoreNorm) : 0,
      retentionMinutes: Number.isFinite(leader.retentionMinutes) ? Number(leader.retentionMinutes) : 0,
      sessions: Number.isFinite(leader.sessions) ? Number(leader.sessions) : 0,
      positionTrend,
    };
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
    this.app.disable('x-powered-by');

    this.app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        referrerPolicy: { policy: 'no-referrer-when-downgrade' },
      }),
    );

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

    this.app.use(
      compression({
        threshold: 512,
        filter: (req, res) => {
          if (req.path === this.config.streamEndpoint || req.path === '/events') {
            return false;
          }

          const header = req.headers['x-no-compression'];
          if (typeof header === 'string' && header.toLowerCase() === 'true') {
            return false;
          }

          return compression.filter(req, res);
        },
      }),
    );

    this.app.use(
      minifyHTML({
        override: true,
        htmlMinifier: {
          collapseWhitespace: true,
          removeComments: true,
          minifyJS: true,
          minifyCSS: true,
          removeAttributeQuotes: true,
          removeRedundantAttributes: true,
          removeEmptyAttributes: true,
          removeOptionalTags: true,
          collapseBooleanAttributes: true,
          useShortDoctype: true,
          sortAttributes: true,
          sortClassName: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
        },
      }),
    );

    this.app.use(express.json({ limit: '256kb' }));

    const publicDir = path.resolve(__dirname, '..', '..', 'public');
    this.app.use(
      express.static(publicDir, {
        etag: true,
        maxAge: '1y',
        immutable: true,
        setHeaders(res, filePath) {
          const relativePath = path.relative(publicDir, filePath).split(path.sep).join('/');

          if (!relativePath) {
            res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600, must-revalidate');
            return;
          }

          if (relativePath === 'sw.js') {
            res.setHeader('Cache-Control', 'no-store');
            return;
          }

          if (relativePath === 'assets/manifest.json') {
            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600, must-revalidate');
            return;
          }

          if (relativePath.startsWith('assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return;
          }

          if (relativePath.startsWith('styles/') || relativePath.startsWith('scripts/')) {
            res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=600, must-revalidate');
            return;
          }

          if (relativePath === 'site.webmanifest' || relativePath === 'robots.txt') {
            res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=600, must-revalidate');
            return;
          }

          if (relativePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600, must-revalidate');
            return;
          }

          res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=300, must-revalidate');
        },
      }),
    );
  }

  private registerRoutes(): void {
    const adminRouter = express.Router();

    this.app.get('/sitemap.xml', async (_req, res) => {
      try {
        const entries = await this.buildSitemapEntries();
        const xml = this.renderSitemap(entries);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.type('application/xml').send(xml);
      } catch (error) {
        console.error('Failed to render sitemap', error);
        res.status(500).type('text/plain').send('SITEMAP_UNAVAILABLE');
      }
    });

    this.app.get('/admin', (req, res, next) => {
      const accept = req.header('accept') ?? req.header('Accept') ?? '';
      if (typeof accept === 'string' && accept.toLowerCase().includes('application/json')) {
        next();
        return;
      }

      if (!this.requireAdminAuth(req, res)) {
        return;
      }

      const html = this.renderAdminAppShell();
      if (!html) {
        res
          .status(503)
          .type('text/plain')
          .send('ADMIN_ASSETS_UNAVAILABLE');
        return;
      }

      res.type('text/html').send(html);
    });

    adminRouter.use((req, res, next) => {
      if (!this.requireAdminAuth(req, res)) {
        return;
      }
      next();
    });

    adminRouter.get('/', async (_req, res) => {
      try {
        const overview = await this.buildAdminOverview();
        res.json(overview);
      } catch (error) {
        console.error('Failed to build admin overview', error);
        res.status(500).json({
          error: 'ADMIN_OVERVIEW_FAILED',
          message: "Impossible de charger les informations d'administration.",
        });
      }
    });

    adminRouter.get('/blog/posts', async (req, res) => {
      if (!this.blogRepository) {
        res.status(503).json({
          error: 'BLOG_REPOSITORY_DISABLED',
          message: "La gestion des articles est indisponible sur ce serveur.",
        });
        return;
      }

      const listRequest = this.parseAdminListRequest(req);
      const sortFieldMap: Record<string, string> = {
        publishedAt: 'published_at',
        updatedAt: 'updated_at',
        title: 'title',
        slug: 'slug',
      };
      const sortBy = (sortFieldMap[listRequest.sortField ?? ''] ?? 'published_at') as 'published_at' | 'updated_at' | 'title' | 'slug';
      const searchFilter = this.extractAdminSearchFilter(listRequest.filters);
      const tagsFilter = this.extractAdminTagsFilter(listRequest.filters);
      const onlyPublished = this.extractAdminOnlyPublishedFilter(listRequest.filters);
      const limit = listRequest.perPage;
      const offset = (listRequest.page - 1) * listRequest.perPage;

      try {
        const [rows, total] = await Promise.all([
          this.blogRepository.listPosts({
            search: searchFilter,
            tags: tagsFilter,
            limit,
            offset,
            sortBy,
            sortOrder: listRequest.sortOrder,
            onlyPublished,
          }),
          this.blogRepository.countPosts({
            search: searchFilter,
            tags: tagsFilter,
            onlyPublished,
          }),
        ]);

        res.json({
          data: rows.map((row) => this.mapBlogPostRowToAdmin(row)),
          total,
        });
      } catch (error) {
        console.error('Failed to list admin blog posts', error);
        res.status(500).json({
          error: 'ADMIN_BLOG_POSTS_LIST_FAILED',
          message: "Impossible de récupérer les articles du blog.",
        });
      }
    });

    adminRouter.get('/blog/posts/:slug', async (req, res) => {
      if (!this.blogRepository) {
        res.status(503).json({
          error: 'BLOG_REPOSITORY_DISABLED',
          message: "La gestion des articles est indisponible sur ce serveur.",
        });
        return;
      }

      const slug = this.normalizeSlug(typeof req.params.slug === 'string' ? req.params.slug : null);
      if (!slug) {
        res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Le slug de l’article est requis.' });
        return;
      }

      try {
        const row = await this.blogRepository.getPostBySlug(slug);
        if (!row) {
          res.status(404).json({ error: 'ADMIN_BLOG_POST_NOT_FOUND', message: "Article introuvable." });
          return;
        }
        res.json({ data: this.mapBlogPostRowToAdmin(row) });
      } catch (error) {
        console.error('Failed to retrieve admin blog post', error);
        res.status(500).json({
          error: 'ADMIN_BLOG_POST_LOAD_FAILED',
          message: "Impossible de charger cet article.",
        });
      }
    });

    adminRouter.post('/blog/posts', async (req, res) => {
      if (!this.blogRepository) {
        res.status(503).json({
          error: 'BLOG_REPOSITORY_DISABLED',
          message: "La gestion des articles est indisponible sur ce serveur.",
        });
        return;
      }

      const parsed = this.parseAdminBlogPostInput(req.body, { allowSlugOverride: true });
      if (!parsed.ok) {
        res.status(parsed.status).json({ error: parsed.error, message: parsed.message });
        return;
      }

      try {
        const existing = await this.blogRepository.getPostBySlug(parsed.data.slug);
        if (existing) {
          res.status(409).json({ error: 'ADMIN_BLOG_POST_CONFLICT', message: 'Un article utilise déjà ce slug.' });
          return;
        }

        await this.blogRepository.upsertPost(parsed.data);
        const saved = await this.blogRepository.getPostBySlug(parsed.data.slug);
        if (!saved) {
          throw new Error('BLOG_POST_NOT_FOUND_AFTER_CREATE');
        }
        res.status(201).json({ data: this.mapBlogPostRowToAdmin(saved) });
      } catch (error) {
        console.error('Failed to create admin blog post', error);
        res.status(500).json({
          error: 'ADMIN_BLOG_POST_CREATE_FAILED',
          message: "Impossible de créer l’article.",
        });
      }
    });

    adminRouter.put('/blog/posts/:slug', async (req, res) => {
      if (!this.blogRepository) {
        res.status(503).json({
          error: 'BLOG_REPOSITORY_DISABLED',
          message: "La gestion des articles est indisponible sur ce serveur.",
        });
        return;
      }

      const slugParam = this.normalizeSlug(typeof req.params.slug === 'string' ? req.params.slug : null);
      if (!slugParam) {
        res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Le slug de l’article est requis.' });
        return;
      }

      const parsed = this.parseAdminBlogPostInput(req.body, { slugFallback: slugParam });
      if (!parsed.ok) {
        res.status(parsed.status).json({ error: parsed.error, message: parsed.message });
        return;
      }

      if (parsed.data.slug !== slugParam) {
        res.status(400).json({
          error: 'ADMIN_BLOG_POST_SLUG_IMMUTABLE',
          message: 'Le slug ne peut pas être modifié via cette opération.',
        });
        return;
      }

      try {
        const existing = await this.blogRepository.getPostBySlug(slugParam);
        if (!existing) {
          res.status(404).json({ error: 'ADMIN_BLOG_POST_NOT_FOUND', message: "Article introuvable." });
          return;
        }

        await this.blogRepository.upsertPost(parsed.data);
        const saved = await this.blogRepository.getPostBySlug(slugParam);
        if (!saved) {
          throw new Error('BLOG_POST_NOT_FOUND_AFTER_UPDATE');
        }
        res.json({ data: this.mapBlogPostRowToAdmin(saved) });
      } catch (error) {
        console.error('Failed to update admin blog post', error);
        res.status(500).json({
          error: 'ADMIN_BLOG_POST_UPDATE_FAILED',
          message: "Impossible de mettre à jour l’article.",
        });
      }
    });

    adminRouter.delete('/blog/posts/:slug', async (req, res) => {
      if (!this.blogRepository) {
        res.status(503).json({
          error: 'BLOG_REPOSITORY_DISABLED',
          message: "La gestion des articles est indisponible sur ce serveur.",
        });
        return;
      }

      const slug = this.normalizeSlug(typeof req.params.slug === 'string' ? req.params.slug : null);
      if (!slug) {
        res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Le slug de l’article est requis.' });
        return;
      }

      try {
        const deleted = await this.blogRepository.deletePostBySlug(slug);
        if (!deleted) {
          res.status(404).json({ error: 'ADMIN_BLOG_POST_NOT_FOUND', message: "Article introuvable." });
          return;
        }
        res.json({ data: { id: slug } });
      } catch (error) {
        console.error('Failed to delete admin blog post', error);
        res.status(500).json({
          error: 'ADMIN_BLOG_POST_DELETE_FAILED',
          message: "Impossible de supprimer l’article.",
        });
      }
    });

    adminRouter.get('/blog/proposals', async (req, res) => {
      if (!this.blogRepository) {
        res.status(503).json({
          error: 'BLOG_REPOSITORY_DISABLED',
          message: "La gestion des propositions est indisponible sur ce serveur.",
        });
        return;
      }

      const listRequest = this.parseAdminListRequest(req);
      const searchFilter = this.extractAdminSearchFilter(listRequest.filters);
      const limit = listRequest.perPage;
      const offset = (listRequest.page - 1) * listRequest.perPage;

      try {
        const [rows, total] = await Promise.all([
          this.blogRepository.listProposals({
            search: searchFilter,
            limit,
            offset,
            sortOrder: listRequest.sortOrder,
          }),
          this.blogRepository.countProposals({ search: searchFilter }),
        ]);
        res.json({ data: rows.map((row) => this.mapBlogProposalRowToAdmin(row)), total });
      } catch (error) {
        console.error('Failed to list admin blog proposals', error);
        res.status(500).json({
          error: 'ADMIN_BLOG_PROPOSALS_LIST_FAILED',
          message: 'Impossible de récupérer les propositions.',
        });
      }
    });

    adminRouter.get('/blog/proposals/:slug', async (req, res) => {
      if (!this.blogRepository) {
        res.status(503).json({
          error: 'BLOG_REPOSITORY_DISABLED',
          message: "La gestion des propositions est indisponible sur ce serveur.",
        });
        return;
      }

      const slug = this.normalizeSlug(typeof req.params.slug === 'string' ? req.params.slug : null);
      if (!slug) {
        res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Le slug de la proposition est requis.' });
        return;
      }

      try {
        const proposal = await this.blogRepository.getProposalBySlug(slug);
        if (!proposal) {
          res.status(404).json({ error: 'ADMIN_BLOG_PROPOSAL_NOT_FOUND', message: 'Proposition introuvable.' });
          return;
        }
        res.json({ data: this.mapBlogProposalRowToAdmin(proposal) });
      } catch (error) {
        console.error('Failed to load admin blog proposal', error);
        res.status(500).json({
          error: 'ADMIN_BLOG_PROPOSAL_LOAD_FAILED',
          message: 'Impossible de charger cette proposition.',
        });
      }
    });

    adminRouter.get('/members/hidden', async (_req, res) => {
      try {
        const members = await this.adminService.listHiddenMembers();
        const mapped = members.map((record) => this.mapHiddenMemberRecord(record));
        res.json({ data: mapped, total: mapped.length });
      } catch (error) {
        console.error('Failed to list hidden members', error);
        res.status(500).json({
          error: 'ADMIN_HIDDEN_MEMBERS_LIST_FAILED',
          message: 'Impossible de récupérer les membres masqués.',
        });
      }
    });

    adminRouter.get('/members/hidden/:userId', async (req, res) => {
      const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!userId) {
        res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
        return;
      }

      try {
        const members = await this.adminService.listHiddenMembers();
        const match = members.find((member) => member.userId === userId);
        if (!match) {
          res.status(404).json({ error: 'MEMBER_NOT_HIDDEN', message: 'Ce membre est visible.' });
          return;
        }
        res.json({ data: this.mapHiddenMemberRecord(match) });
      } catch (error) {
        console.error('Failed to load hidden member', error);
        res.status(500).json({
          error: 'ADMIN_HIDDEN_MEMBER_LOAD_FAILED',
          message: 'Impossible de récupérer ce membre.',
        });
      }
    });

    adminRouter.post('/members/:userId/hide', async (req, res) => {
      const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!rawUserId) {
        res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
        return;
      }

      const idea = typeof req.body?.idea === 'string' ? req.body.idea : null;

      try {
        const record = await this.adminService.hideMember(rawUserId, idea);
        res.status(201).json({ data: this.mapHiddenMemberRecord(record) });
      } catch (error) {
        if ((error as Error)?.message === 'USER_ID_REQUIRED') {
          res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
          return;
        }
        console.error('Failed to hide member profile', error);
        res.status(500).json({
          error: 'HIDE_MEMBER_FAILED',
          message: 'Impossible de masquer ce membre.',
        });
      }
    });

    adminRouter.delete('/members/:userId/hide', async (req, res) => {
      const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!rawUserId) {
        res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
        return;
      }

      try {
        const removed = await this.adminService.unhideMember(rawUserId);
        if (!removed) {
          res.status(404).json({ error: 'MEMBER_NOT_HIDDEN', message: 'Ce membre est déjà visible.' });
          return;
        }
        res.json({ data: { id: rawUserId } });
      } catch (error) {
        if ((error as Error)?.message === 'USER_ID_REQUIRED') {
          res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
          return;
        }
        console.error('Failed to unhide member profile', error);
        res.status(500).json({
          error: 'UNHIDE_MEMBER_FAILED',
          message: 'Impossible de rendre ce membre visible.',
        });
      }
    });

    adminRouter.post('/articles/daily', async (_req, res) => {
      if (!this.dailyArticleService) {
        res.status(503).json({
          error: 'DAILY_ARTICLE_DISABLED',
          message: "La génération d'articles automatiques est désactivée.",
        });
        return;
      }

      try {
        const result = await this.dailyArticleService.triggerManualGeneration();
        const status = result.status === 'failed' ? 500 : 200;
        res.status(status).json({ result });
      } catch (error) {
        console.error('Failed to trigger daily article generation', error);
        res.status(500).json({
          error: 'DAILY_ARTICLE_FAILED',
          message: "Impossible de lancer la génération de l'article.",
        });
      }
    });

    this.app.use('/admin', adminRouter);

    if (this.secretArticleTrigger) {
      this.app.post(this.secretArticleTrigger.path, async (req, res) => {
        const secretConfig = this.secretArticleTrigger;
        if (!secretConfig) {
          res.status(404).json({
            error: 'SECRET_ARTICLE_DISABLED',
            message: "La génération secrète d'articles est désactivée.",
          });
          return;
        }

        const providedPassword = this.extractSecretArticlePassword(req);
        if (providedPassword !== secretConfig.password) {
          res.status(401).json({
            error: 'SECRET_ARTICLE_UNAUTHORIZED',
            message: 'Mot de passe requis ou invalide.',
          });
          return;
        }

        if (!this.dailyArticleService) {
          res.status(503).json({
            error: 'DAILY_ARTICLE_DISABLED',
            message: "La génération d'articles automatiques est désactivée.",
          });
          return;
        }

        try {
          const result = await this.dailyArticleService.triggerManualGeneration();
          const status = result.status === 'failed' ? 500 : 200;
          res.status(status).json({ result });
        } catch (error) {
          console.error('Failed to trigger secret daily article generation', error);
          res.status(500).json({
            error: 'SECRET_ARTICLE_FAILED',
            message: "Impossible de lancer la génération de l'article.",
          });
        }
      });
    }

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

    this.app.get('/api/statistiques', async (req, res) => {
      try {
        const options = this.parseStatisticsQuery(req.query);
        const snapshot = await this.statisticsService.getStatistics(options);
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=90');
        res.json({ statistics: snapshot });
      } catch (error) {
        console.error('Failed to build statistics snapshot', error);
        res.status(500).json({
          error: 'STATISTICS_FAILED',
          message: 'Impossible de charger les statistiques communautaires.',
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

    this.app.post('/api/blog/proposals', async (req, res) => {
      const payload = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

      const tagsRaw = payload.tags;
      let tags: string[] = [];
      if (Array.isArray(tagsRaw)) {
        tags = tagsRaw.filter((tag): tag is string => typeof tag === 'string');
      } else if (typeof tagsRaw === 'string') {
        tags = tagsRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }

      try {
        const result = await this.blogProposalService.submitProposal({
          title: typeof payload.title === 'string' ? payload.title : '',
          slug: typeof payload.slug === 'string' ? payload.slug : null,
          excerpt: typeof payload.excerpt === 'string' ? payload.excerpt : null,
          contentMarkdown: typeof payload.contentMarkdown === 'string' ? payload.contentMarkdown : '',
          coverImageUrl: typeof payload.coverImageUrl === 'string' ? payload.coverImageUrl : null,
          tags,
          seoDescription: typeof payload.seoDescription === 'string' ? payload.seoDescription : null,
          authorName: typeof payload.authorName === 'string' ? payload.authorName : null,
          authorContact: typeof payload.authorContact === 'string' ? payload.authorContact : null,
        });

        res.status(201).json({
          message: 'Merci ! Ta proposition a bien été envoyée à la rédaction.',
          proposal: result,
        });
      } catch (error) {
        if (error instanceof BlogProposalError) {
          const status =
            error.code === 'VALIDATION_ERROR'
              ? 400
              : error.code === 'CONFLICT'
              ? 409
              : error.code === 'UNAVAILABLE'
              ? 503
              : 500;
          res.status(status).json({
            error: error.code,
            message: error.message,
            details: error.details ?? null,
          });
          return;
        }

        console.error('Failed to submit blog proposal', error);
        res.status(500).json({
          error: 'BLOG_PROPOSAL_FAILED',
          message: 'Impossible de transmettre la proposition pour le moment.',
        });
      }
    });

    this.app.post('/api/blog/manual-generate', async (req, res) => {
      const passwordRaw = (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).password : null) as
        | string
        | null;
      const password = typeof passwordRaw === 'string' ? passwordRaw.trim() : '';

      if (password !== MANUAL_BLOG_TRIGGER_PASSWORD) {
        res.status(401).json({
          error: 'MANUAL_ARTICLE_UNAUTHORIZED',
          message: 'Mot de passe requis ou invalide.',
        });
        return;
      }

      if (!this.dailyArticleService) {
        res.status(503).json({
          error: 'DAILY_ARTICLE_DISABLED',
          message: "La génération d'articles automatiques est désactivée.",
        });
        return;
      }

      try {
        const result = await this.dailyArticleService.triggerManualGeneration();
        const status = result.status === 'failed' ? 500 : 200;

        let message = 'Génération traitée.';
        if (result.status === 'generated') {
          const referenceNote = result.proposalReference ? ` (référence ${result.proposalReference})` : '';
          message = `Un brouillon a été sauvegardé pour relecture${referenceNote}.`;
        } else if (result.status === 'skipped') {
          switch (result.reason) {
            case 'ALREADY_RUNNING':
              message = 'Une génération est déjà en cours. Réessaie dans quelques instants.';
              break;
            case 'MISSING_DEPENDENCIES':
              message = 'La génération est indisponible (dépendances manquantes).';
              break;
            case 'DISABLED':
              message = "La génération automatique est désactivée.";
              break;
            case 'ALREADY_EXISTS':
              message = 'Un article ou une proposition existe déjà pour cette date.';
              break;
            case 'NO_TRANSCRIPTS':
              message = 'Aucune transcription exploitable pour la période demandée.';
              break;
            default:
              message = 'La génération a été ignorée.';
              break;
          }
        } else if (result.status === 'failed') {
          message = "La génération de l'article a échoué. Consulte les logs serveur.";
        }

        res.status(status).json({ result, message });
      } catch (error) {
        console.error('Failed to trigger manual blog generation', error);
        res.status(500).json({
          error: 'MANUAL_ARTICLE_FAILED',
          message: "Impossible de lancer la génération de l'article.",
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

      if (await this.adminService.isMemberHidden(rawUserId)) {
        res
          .status(404)
          .json({ error: 'PROFILE_HIDDEN', message: 'Ce profil est masqué sur demande.' });
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
        const [profile, presenceSegments, speakingSegments, messageEvents, personaRecord] = await Promise.all([
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
          this.voiceActivityRepository
            ? this.voiceActivityRepository.getUserPersonaProfile({ userId: rawUserId })
            : Promise.resolve(null),
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

        const persona = personaRecord
          ? {
              summary: personaRecord.summary,
              data: personaRecord.persona,
              model: personaRecord.model,
              version: personaRecord.version,
              generatedAt: personaRecord.generatedAt ? personaRecord.generatedAt.toISOString() : null,
              updatedAt: personaRecord.updatedAt ? personaRecord.updatedAt.toISOString() : null,
              lastActivityAt: personaRecord.lastActivityAt ? personaRecord.lastActivityAt.toISOString() : null,
              voiceSampleCount: personaRecord.voiceSampleCount,
              messageSampleCount: personaRecord.messageSampleCount,
              inputCharacterCount: personaRecord.inputCharacterCount,
            }
          : null;

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
          persona,
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

      if (await this.adminService.isMemberHidden(rawUserId)) {
        res.status(404).json({
          error: 'PROFILE_HIDDEN',
          message: 'Les transcriptions de ce profil sont masquées.',
        });
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

        const hiddenMemberIds = await this.adminService.getHiddenMemberIds();
        const visibleMembers = result.members.filter((member) => !hiddenMemberIds.has(member.id));

        let recentMessagesByUser: Record<string, UserMessageActivityEntry[]> = {};
        if (this.voiceActivityRepository) {
          const userIds = visibleMembers
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

        const membersWithMessages = visibleMembers.map((member) => ({
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

    this.app.get('/statistiques', async (req, res) => {
      this.setClientNoCache(res);
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Statistiques du serveur Discord`,
        description:
          'Visualise la croissance de Libre Antenne : membres actifs, nouveaux arrivants, temps passé en vocal et messages envoyés.',
        path: '/statistiques',
        canonicalUrl: this.toAbsoluteUrl('/statistiques'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'statistiques Discord',
          'analytics communauté',
          'activité vocale',
          'temps de présence',
          'messages Discord',
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Statistiques', path: '/statistiques' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'Dataset',
            name: `${this.config.siteName} · Tableau de bord communautaire`,
            description:
              'Indicateurs agrégés du serveur Discord Libre Antenne : croissance des membres, activité vocale et échanges textuels.',
            license: 'https://creativecommons.org/licenses/by/4.0/',
            url: this.toAbsoluteUrl('/statistiques'),
            creator: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
          },
        ],
      };

      try {
        const options = this.parseStatisticsQuery(req.query);
        const snapshot = await this.statisticsService.getStatistics(options);
        const preloadState: AppPreloadState = {
          route: { name: 'statistiques', params: {} },
          pages: { statistiques: { snapshot } },
        };
        this.respondWithAppShell(res, metadata, { preloadState });
      } catch (error) {
        console.error('Failed to prerender statistics page', error);
        this.respondWithAppShell(res, metadata);
      }
    });

    this.app.get('/classements', async (req, res) => {
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

      try {
        const options = this.parseLeaderboardRequest(req);
        const prerender = await this.buildClassementsPagePrerender(options);
        const preloadState: AppPreloadState = {
          route: {
            name: 'classements',
            params: {
              search: prerender.bootstrap.query.search ?? '',
              sortBy: prerender.bootstrap.query.sortBy,
              sortOrder: prerender.bootstrap.query.sortOrder,
              period: prerender.bootstrap.query.period,
            },
          },
          pages: { classements: prerender.bootstrap },
        };
        this.respondWithAppShell(res, metadata, {
          appHtml: prerender.html,
          preloadState,
        });
      } catch (error) {
        console.error('Failed to prerender classements page', error);
        this.respondWithAppShell(res, metadata);
      }
    });

    this.app.get(['/membres', '/members'], async (req, res) => {
      const rawSearch = this.extractString(req.query?.search);
      const search = rawSearch ? rawSearch.slice(0, 80) : null;
      const isEnglishRoute = req.path === '/members';
      const pagePath = isEnglishRoute ? '/members' : '/membres';
      const canonicalPath = '/membres';
      const canonicalUrl = this.toAbsoluteUrl(canonicalPath);
      const pageLanguage = isEnglishRoute ? 'en-US' : this.config.siteLanguage;
      const pageLocale = isEnglishRoute ? 'en_US' : this.config.siteLocale;
      const alternateLanguages = [
        { locale: 'fr-FR', url: this.toAbsoluteUrl('/membres') },
        { locale: 'en-US', url: this.toAbsoluteUrl('/members') },
      ];
      const baseDescription = isEnglishRoute
        ? 'Browse the active members of Libre Antenne, their live presence on voice channels and their latest Discord messages.'
        : 'Parcours les membres actifs de Libre Antenne, leurs présences vocales et leurs derniers messages Discord.';
      const description = search
        ? isEnglishRoute
          ? `Results for “${search}” in the Libre Antenne community: profiles, messages and audio activity.`
          : `Résultats pour « ${search} » dans la communauté Libre Antenne : profils, messages et activité audio.`
        : baseDescription;
      const keywords = isEnglishRoute
        ? this.combineKeywords(
            this.config.siteName,
            'Libre Antenne members',
            'Discord community',
            'audio profile',
            search ? `member ${search}` : null,
          )
        : this.combineKeywords(
            this.config.siteName,
            'membres Libre Antenne',
            'communauté Discord',
            'profil audio',
            search ? `membre ${search}` : null,
          );
      const metadata: SeoPageMetadata = {
        title: isEnglishRoute
          ? `${this.config.siteName} · Active members & Discord profiles`
          : `${this.config.siteName} · Membres actifs & profils Discord`,
        description,
        path: pagePath,
        canonicalUrl,
        robots: search ? 'noindex,follow' : undefined,
        keywords,
        openGraphType: 'website',
        locale: pageLocale,
        language: pageLanguage,
        alternateLocales: isEnglishRoute ? [this.config.siteLocale] : ['en_US'],
        alternateLanguages,
        breadcrumbs: isEnglishRoute
          ? [
              { name: 'Home', path: '/' },
              { name: 'Members', path: '/members' },
            ]
          : [
              { name: 'Accueil', path: '/' },
              { name: 'Membres', path: '/membres' },
            ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: isEnglishRoute
              ? `${this.config.siteName} – Members`
              : `${this.config.siteName} – Membres`,
            description: search
              ? isEnglishRoute
                ? `Search results for ${search} across Libre Antenne members.`
                : `Résultats de recherche pour ${search} parmi les membres de Libre Antenne.`
              : isEnglishRoute
                ? 'Directory of active voices in the Libre Antenne audio community.'
                : 'Annuaire des membres actifs de la communauté audio Libre Antenne.',
            url: canonicalUrl,
            about: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            inLanguage: pageLanguage,
          },
        ],
      };

      try {
        const appHtml = await this.buildMembersPagePrerender(search);
        this.respondWithAppShell(res, metadata, { appHtml });
      } catch (error) {
        console.error('Failed to prerender members page', error);
        this.respondWithAppShell(res, metadata);
      }
    });

    this.app.get(['/boutique', '/shop'], (req, res) => {
      const products = this.shopService.getProducts();
      const structuredCatalog = this.buildShopStructuredData(products);
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
          ...structuredCatalog,
        ],
      };

      try {
        const checkoutParam = (req.query as Record<string, unknown> | undefined)?.checkout ?? null;
        const checkoutStatus = this.extractQueryParam(checkoutParam);
        const hasCheckoutFeedback = typeof checkoutStatus === 'string' && checkoutStatus.trim().length > 0;
        if (hasCheckoutFeedback) {
          metadata.robots = 'noindex,follow';
        }
        const prerender = this.buildShopPagePrerender({ checkoutStatus, products });
        const preloadState: AppPreloadState = {
          route: { name: 'shop', params: {} },
          pages: { shop: prerender.bootstrap },
        };
        this.respondWithAppShell(res, metadata, {
          appHtml: prerender.html,
          preloadState,
        });
      } catch (error) {
        console.error('Failed to prerender shop page', error);
        this.respondWithAppShell(res, metadata);
      }
    });

    this.app.get('/premium', (_req, res) => {
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Accès premium & soutien communautaire`,
        description:
          'Soutiens la radio libre avec un abonnement premium : accès backstage, ateliers prioritaires et financements transparents pour la technique.',
        path: '/premium',
        canonicalUrl: this.toAbsoluteUrl('/premium'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'premium Libre Antenne',
          'abonnement radio libre',
          'soutien communautaire',
          'backstage Discord',
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Premium', path: '/premium' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'Service',
            name: `${this.config.siteName} Premium`,
            description:
              'Programme premium Libre Antenne : accès privilégié aux ateliers, coulisses et décisions communautaires.',
            url: this.toAbsoluteUrl('/premium'),
            provider: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            serviceType: 'Community membership',
            areaServed: 'FR',
            offers: {
              '@type': 'Offer',
              url: this.toAbsoluteUrl('/boutique'),
              availability: 'https://schema.org/InStock',
              priceCurrency: this.config.shop.currency.toUpperCase(),
              price: 0,
              priceSpecification: {
                '@type': 'UnitPriceSpecification',
                price: 0,
                priceCurrency: this.config.shop.currency.toUpperCase(),
                description: 'Contribution libre selon la formule choisie sur la boutique Libre Antenne.',
              },
            },
          },
        ],
      };

      const appHtml = this.buildPremiumPageHtml();
      const preloadState: AppPreloadState = {
        route: { name: 'premium', params: {} },
      };
      this.respondWithAppShell(res, metadata, { appHtml, preloadState });
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

      const appHtml = this.buildAboutPageHtml();
      const preloadState: AppPreloadState = {
        route: { name: 'about', params: {} },
      };
      this.respondWithAppShell(res, metadata, { appHtml, preloadState });
    });

    this.app.get('/cgu', (_req, res) => {
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Conditions générales d’utilisation & politique de données`,
        description:
          'Consulte les règles d’utilisation de Libre Antenne, la gestion des données audio Discord, des statistiques et de la boutique.',
        path: '/cgu',
        canonicalUrl: this.toAbsoluteUrl('/cgu'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'conditions générales d’utilisation',
          'politique de confidentialité',
          'données Discord',
          'radio libre',
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Conditions générales', path: '/cgu' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'TermsOfService',
            name: `Conditions générales – ${this.config.siteName}`,
            description:
              'Conditions générales d’utilisation, informations sur la collecte de données et droits des membres de Libre Antenne.',
            url: this.toAbsoluteUrl('/cgu'),
            inLanguage: this.config.siteLanguage,
            provider: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            dateModified: '2024-11-04',
          },
        ],
      };

      const appHtml = this.buildCguPageHtml();
      const preloadState: AppPreloadState = {
        route: { name: 'cgu', params: {} },
      };
      this.respondWithAppShell(res, metadata, { appHtml, preloadState });
    });

    this.app.get('/blog', async (req, res) => {
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

      try {
        const prerender = await this.buildBlogListingPrerender(tags);
        const preloadState: AppPreloadState = {
          route: { name: 'blog', params: { slug: null } },
          pages: {
            blog: {
              posts: prerender.posts,
              availableTags: prerender.availableTags,
              selectedTags: prerender.selectedTags,
            },
          },
        };
        this.respondWithAppShell(res, metadata, { appHtml: prerender.html, preloadState });
      } catch (error) {
        console.error('Failed to prerender blog listing', error);
        this.respondWithAppShell(res, metadata);
      }
    });

    this.app.get(['/blog/proposer', '/blog/proposal', '/blog/soumettre'], (_req, res) => {
      const metadata: SeoPageMetadata = {
        title: `${this.config.siteName} · Proposer un article`,
        description:
          'Soumets une chronique, un portrait ou un guide pour alimenter le blog Libre Antenne. Notre équipe relit chaque proposition avant publication.',
        path: '/blog/proposer',
        canonicalUrl: this.toAbsoluteUrl('/blog/proposer'),
        keywords: this.combineKeywords(
          this.config.siteName,
          'proposer article Libre Antenne',
          'chronique radio libre',
          'participer blog communauté',
        ),
        openGraphType: 'website',
        breadcrumbs: [
          { name: 'Accueil', path: '/' },
          { name: 'Blog', path: '/blog' },
          { name: 'Proposer un article', path: '/blog/proposer' },
        ],
        structuredData: [
          {
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Soumettre un article au blog Libre Antenne',
            description:
              'Étapes à suivre pour proposer une chronique validée par la rédaction de Libre Antenne.',
            step: [
              { '@type': 'HowToStep', name: 'Définir son sujet', text: 'Prépare un titre, une accroche et quelques tags.' },
              { '@type': 'HowToStep', name: 'Rédiger en Markdown', text: 'Écris ton article avec un ton authentique et sourcé.' },
              {
                '@type': 'HowToStep',
                name: 'Envoyer la proposition',
                text: 'Ajoute un moyen de contact pour la relecture éditoriale.',
              },
            ],
          },
        ],
      };

      const appHtml = this.buildBlogProposalHtml();
      this.respondWithAppShell(res, metadata, { appHtml });
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

        const appHtml = this.buildBlogPostHtml({
          title: post.title,
          contentHtml: post.contentHtml,
          date: post.date,
          updatedAt: post.updatedAt,
          tags: post.tags ?? [],
          coverImageUrl: post.coverImageUrl ?? null,
          authorName: this.config.siteName,
        });

        const preloadState: AppPreloadState = {
          route: { name: 'blog', params: { slug: post.slug } },
          pages: {
            blog: {
              activePost: post,
            },
          },
        };

        this.respondWithAppShell(res, metadata, { appHtml, preloadState });
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

      if (await this.adminService.isMemberHidden(rawUserId)) {
        this.respondWithAppShell(
          res,
          {
            title: 'Profil masqué · Libre Antenne',
            description: 'Ce membre préfère garder son profil confidentiel.',
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

        const recentMessages = messageEvents
          .filter((event) => typeof event?.content === 'string' && event.content.trim().length > 0)
          .map((event) => ({
            content: event.content ?? '',
            timestamp: event.timestamp instanceof Date ? event.timestamp.toISOString() : null,
          }));

        const appHtml = this.buildProfilePageHtml({
          userId: rawUserId,
          profileName,
          identity,
          summary,
          recentMessages,
        });

        this.respondWithAppShell(res, metadata, { appHtml });
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

    this.app.get('/', async (_req, res) => {
      const streamContentUrl = this.toAbsoluteUrl(this.config.streamEndpoint);
      const streamEncodingFormat =
        this.config.mimeTypes[this.config.outputFormat] ?? this.config.mimeTypes.opus ?? 'audio/mpeg';
      const bitrateSetting =
        this.config.outputFormat === 'mp3'
          ? this.config.mp3Bitrate
          : this.config.outputFormat === 'opus'
            ? this.config.opusBitrate
            : null;
      const normalizedBitrate = (() => {
        if (!bitrateSetting) {
          return undefined;
        }
        const numeric = Number.parseInt(String(bitrateSetting), 10);
        if (Number.isFinite(numeric) && numeric > 0) {
          const kbps = Math.round(numeric / 1000);
          if (kbps > 0) {
            return `${kbps} kbps`;
          }
        }
        if (typeof bitrateSetting === 'string' && bitrateSetting.trim().length > 0) {
          return bitrateSetting.trim();
        }
        return undefined;
      })();
      const heroSpeakableSelectors = [
        '#home-hero h1',
        '#home-hero [data-speakable="description"]',
        '#home-latest-posts .latest-post h3',
      ];

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
          {
            '@context': 'https://schema.org',
            '@type': 'AudioObject',
            name: `${this.config.siteName} – Flux audio en direct`,
            description:
              'Écoute le direct Libre Antenne : débats communautaires, confidences nocturnes et mixs improvisés en streaming temps réel.',
            url: this.toAbsoluteUrl('/'),
            contentUrl: streamContentUrl,
            encodingFormat: streamEncodingFormat,
            inLanguage: this.config.siteLanguage,
            isLiveBroadcast: true,
            uploadDate: this.serverBootTimestamp,
            thumbnailUrl: this.toAbsoluteUrl('/icons/icon-512.svg'),
            potentialAction: {
              '@type': 'ListenAction',
              target: {
                '@type': 'EntryPoint',
                urlTemplate: streamContentUrl,
                actionPlatform: [
                  'https://schema.org/DesktopWebPlatform',
                  'https://schema.org/MobileWebPlatform',
                ],
                contentType: streamEncodingFormat,
                inLanguage: this.config.siteLanguage,
              },
            },
            publisher: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            author: {
              '@type': 'Organization',
              name: this.config.siteName,
              url: this.config.publicBaseUrl,
            },
            ...(normalizedBitrate ? { bitrate: normalizedBitrate } : {}),
          },
          {
            '@context': 'https://schema.org',
            '@type': 'SpeakableSpecification',
            cssSelector: heroSpeakableSelectors,
          },
        ],
      };

      try {
        const prerender = await this.buildHomePagePrerender();
        const preloadState: AppPreloadState = {
          route: { name: 'home', params: {} },
          participants: prerender.participants,
          listenerStats: {
            count: prerender.listenerCount,
            history: prerender.listenerHistory,
          },
          pages: {
            home: {
              listenerCount: prerender.listenerCount,
              latestPosts: prerender.latestPosts,
              speakers: prerender.speakers,
            },
          },
        };
        this.respondWithAppShell(res, metadata, { appHtml: prerender.html, preloadState });
      } catch (error) {
        console.error('Failed to prerender home page', error);
        this.respondWithAppShell(res, metadata);
      }
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

  private static readonly shopProviderRenderConfig: Record<
    ShopProvider,
    { label: string; helper: string; accentClass: string; icon: string }
  > = {
    stripe: {
      label: 'Stripe',
      helper: 'Cartes bancaires, Apple Pay et Google Pay.',
      accentClass:
        'border-indigo-400/50 bg-indigo-500/20 hover:bg-indigo-500/30 focus:ring-indigo-300',
      icon: 'CreditCard',
    },
    paypal: {
      label: 'PayPal',
      helper: 'Compte PayPal ou carte via PayPal Checkout.',
      accentClass: 'border-sky-400/50 bg-sky-500/20 hover:bg-sky-500/30 focus:ring-sky-300',
      icon: 'Wallet',
    },
    coingate: {
      label: 'CoinGate',
      helper: 'Crypto, Lightning Network et virements SEPA.',
      accentClass:
        'border-emerald-400/50 bg-emerald-500/20 hover:bg-emerald-500/30 focus:ring-emerald-300',
      icon: 'Coins',
    },
  } as const;

  private static readonly classementsTopThreeStyles = [
    {
      highlight: 'border-[#0085C7] bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(0,133,199,0.35)]',
      accent: 'from-[#0085C7]/35 via-[#0085C7]/10 to-transparent',
      ring: 'ring-4 ring-[#0085C7]/50',
      badge: 'bg-gradient-to-br from-sky-400 via-[#0085C7] to-cyan-400 text-slate-950',
    },
    {
      highlight: 'border-[#F4C300] bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(244,195,0,0.35)]',
      accent: 'from-[#F4C300]/35 via-[#F4C300]/10 to-transparent',
      ring: 'ring-4 ring-[#F4C300]/40',
      badge: 'bg-gradient-to-br from-amber-300 via-[#F4C300] to-yellow-200 text-slate-950',
    },
    {
      highlight: 'border-black bg-slate-900/70 shadow-lg shadow-[0_0_45px_rgba(0,0,0,0.45)]',
      accent: 'from-black/40 via-slate-900/60 to-transparent',
      ring: 'ring-4 ring-white/20',
      badge: 'bg-gradient-to-br from-slate-700 via-slate-500 to-slate-300 text-white/90',
    },
  ] as const;

  private static readonly fallbackAvatarBackgrounds = [
    'from-sky-500/60 via-slate-900/60 to-indigo-500/60',
    'from-fuchsia-500/60 via-slate-900/60 to-pink-500/60',
    'from-emerald-400/60 via-slate-900/60 to-cyan-500/60',
    'from-amber-400/60 via-slate-900/60 to-orange-500/60',
    'from-purple-500/60 via-slate-900/60 to-violet-500/60',
  ] as const;

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

  private extractSecretArticlePassword(req: Request): string | null {
    const authorizationHeader = req.header('authorization') ?? req.header('Authorization');
    if (authorizationHeader) {
      const trimmed = authorizationHeader.trim();
      if (trimmed.length > 0) {
        const bearerPrefix = 'bearer ';
        if (trimmed.length > bearerPrefix.length && trimmed.toLowerCase().startsWith(bearerPrefix)) {
          const token = trimmed.slice(bearerPrefix.length).trim();
          if (token.length > 0) {
            return token;
          }
        }
      }
    }

    const headerPassword = req.header('x-secret-password');
    if (typeof headerPassword === 'string') {
      const trimmed = headerPassword.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    const bodyPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (bodyPassword.length > 0) {
      return bodyPassword;
    }

    const queryPassword = (req.query as Record<string, unknown> | undefined)?.password;
    if (typeof queryPassword === 'string') {
      const trimmed = queryPassword.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    if (Array.isArray(queryPassword)) {
      for (const candidate of queryPassword) {
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (trimmed.length > 0) {
            return trimmed;
          }
        }
      }
    }

    return null;
  }

  private requireAdminAuth(req: Request, res: Response): boolean {
    if (!this.adminCredentials) {
      res.status(404).json({
        error: 'ADMIN_DISABLED',
        message: "L'administration n'est pas configurée sur ce serveur.",
      });
      return false;
    }

    const header = req.header('authorization') || req.header('Authorization');
    if (!header || !header.startsWith('Basic ')) {
      this.requestAdminCredentials(res);
      return false;
    }

    const encoded = header.slice(6).trim();
    let decoded: string;
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch (error) {
      console.warn('Failed to decode admin credentials', error);
      this.requestAdminCredentials(res);
      return false;
    }

    const separatorIndex = decoded.indexOf(':');
    const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
    const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : '';

    if (
      username !== this.adminCredentials.username ||
      password !== this.adminCredentials.password
    ) {
      this.requestAdminCredentials(res);
      return false;
    }

    return true;
  }

  private requestAdminCredentials(res: Response): void {
    res.setHeader('WWW-Authenticate', 'Basic realm="Libre Antenne Admin", charset="UTF-8"');
    res.status(401).json({
      error: 'ADMIN_AUTH_REQUIRED',
      message: 'Authentification requise.',
    });
  }

  private async buildAdminOverview(): Promise<{
    timestamp: string;
    listeners: { count: number; history: ListenerStatsEntry[] };
    speakers: { count: number; participants: ReturnType<SpeakerTracker['getSpeakers']> };
    discord: { guildId: string | null; excludedUserIds: string[] };
    hiddenMembers: HiddenMemberRecord[];
    dailyArticle: DailyArticleServiceStatus;
  }> {
    const [hiddenMembers] = await Promise.all([this.adminService.listHiddenMembers()]);

    return {
      timestamp: new Date().toISOString(),
      listeners: {
        count: this.listenerStatsService.getCurrentCount(),
        history: this.listenerStatsService.getHistory(),
      },
      speakers: {
        count: this.speakerTracker.getSpeakerCount(),
        participants: this.speakerTracker.getSpeakers(),
      },
      discord: {
        guildId: this.config.guildId ?? null,
        excludedUserIds: this.config.excludedUserIds,
      },
      hiddenMembers,
      dailyArticle: this.getDailyArticleStatusSnapshot(),
    };
  }

  private getDailyArticleStatusSnapshot(): DailyArticleServiceStatus {
    if (this.dailyArticleService) {
      return this.dailyArticleService.getStatus();
    }

    return {
      enabled: false,
      running: false,
      nextRunAt: null,
      lastResult: null,
      dependencies: {
        openAI: Boolean(this.config.openAI.apiKey),
        blogRepository: Boolean(this.blogRepository),
        voiceActivityRepository: Boolean(this.voiceActivityRepository),
      },
    };
  }
}
