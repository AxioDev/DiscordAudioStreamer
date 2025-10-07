import express, { type Request, type Response } from 'express';
import path from 'path';
import type { Server } from 'http';
import type FfmpegTranscoder from '../audio/FfmpegTranscoder';
import type SpeakerTracker from '../services/SpeakerTracker';
import type { Participant } from '../services/SpeakerTracker';
import type SseService from '../services/SseService';
import type AnonymousSpeechManager from '../services/AnonymousSpeechManager';
import type { Config } from '../config';
import { WebSocketServer } from 'ws';
import type DiscordAudioBridge from '../discord/DiscordAudioBridge';
import type { DiscordUserIdentity } from '../discord/DiscordAudioBridge';
import type ShopService from '../services/ShopService';
import { ShopError, type ShopProvider } from '../services/ShopService';
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
import BlogRepository from '../services/BlogRepository';
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
  type HypeLeaderboardResult,
  type NormalizedHypeLeaderboardQueryOptions,
} from '../services/HypeLeaderboardService';
import SeoRenderer, { type SeoPageMetadata } from './SeoRenderer';
import AdminService, { type HiddenMemberRecord } from '../services/AdminService';
import DailyArticleService, { type DailyArticleServiceStatus } from '../services/DailyArticleService';

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

interface AppPreloadState {
  route?: AppRouteDescriptor;
  participants?: Participant[];
  listenerStats?: ListenerStatsBootstrap;
  pages?: {
    home?: HomePageBootstrap;
    blog?: BlogPageBootstrap;
  };
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

  private respondWithAppShell(
    res: Response,
    metadata: SeoPageMetadata,
    statusOrOptions: number | AppShellRenderOptions = 200,
  ): void {
    try {
      const options = typeof statusOrOptions === 'number' ? { status: statusOrOptions } : statusOrOptions ?? {};
      const html = this.seoRenderer.render(metadata, {
        appHtml: options.appHtml ?? null,
        preloadState: options.preloadState,
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
      { path: '/boutique', changeFreq: 'weekly', priority: 0.6 },
      { path: '/classements', changeFreq: 'hourly', priority: 0.7 },
      { path: '/blog', changeFreq: 'daily', priority: 0.7 },
      { path: '/blog/proposer', changeFreq: 'monthly', priority: 0.5 },
      { path: '/about', changeFreq: 'monthly', priority: 0.5 },
    ];
  }

  private async buildSitemapEntries(): Promise<SitemapEntry[]> {
    const entries: SitemapEntry[] = this.getStaticSitemapDescriptors().map((descriptor) => ({
      loc: this.toAbsoluteUrl(descriptor.path),
      changeFreq: descriptor.changeFreq,
      priority: descriptor.priority,
    }));

    const blogEntries = await this.buildBlogSitemapEntries();
    for (const entry of blogEntries) {
      entries.push(entry);
    }

    const profileEntries = await this.buildProfileSitemapEntries();
    for (const entry of profileEntries) {
      entries.push(entry);
    }

    return entries;
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
      '<section class="rounded-3xl border border-slate-800/60 bg-slate-950/80 p-8 shadow-xl shadow-slate-900/50">',
    );
    parts.push('<p class="text-sm uppercase tracking-[0.2em] text-amber-300">Radio libre communautaire</p>');
    parts.push(
      '<h1 class="mt-3 text-3xl font-bold text-white sm:text-4xl">Libre Antenne · Voix nocturnes du Discord</h1>',
    );
    parts.push(
      '<p class="mt-4 text-lg text-slate-300">La communauté Libre Antenne diffuse en continu ses débats, confidences et sessions de jeu. Branche-toi pour suivre le direct, proposer un sujet ou prendre le micro.</p>',
    );
    parts.push(
      `<p class="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300"><span class="h-2 w-2 animate-pulse rounded-full bg-emerald-300"></span>${this.escapeHtml(listenerLabel)}</p>`,
    );
    parts.push('</section>');

    parts.push('<section class="rounded-3xl border border-slate-800/60 bg-slate-950/60 p-8">');
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
        const name = this.escapeHtml(speaker.displayName || 'Auditeur anonyme');
        const avatar = speaker.avatarUrl ? this.escapeHtml(speaker.avatarUrl) : '/icons/icon-192.svg';
        const status = speaker.isSpeaking
          ? 'Au micro en ce moment'
          : speaker.lastSpokeAt
            ? `Dernière prise de parole : ${this.escapeHtml(
                this.formatDateLabel(speaker.lastSpokeAt, { dateStyle: 'medium', timeStyle: 'short' }) ?? '',
              )}`
            : 'À l’écoute sur le salon vocal';
        parts.push('<li class="flex items-center gap-4 rounded-2xl bg-slate-900/70 p-4">');
        parts.push(
          `<img alt="Avatar de ${name}" src="${avatar}" loading="lazy" class="h-14 w-14 flex-none rounded-full border border-slate-800 object-cover" />`,
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

    parts.push('<section class="rounded-3xl border border-slate-800/60 bg-slate-950/60 p-8">');
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
        parts.push('<article class="flex h-full flex-col justify-between rounded-2xl bg-slate-900/70 p-6">');
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
        const name = this.escapeHtml(member.displayName || 'Membre Libre Antenne');
        const username = member.username ? `@${this.escapeHtml(member.username)}` : null;
        const joinedLabel = this.formatDateLabel(member.joinedAt) ?? null;
        const avatar = member.avatarUrl ? this.escapeHtml(member.avatarUrl) : '/icons/icon-192.svg';
        parts.push('<article class="flex h-full flex-col justify-between rounded-2xl border border-slate-800/40 bg-slate-950/60 p-6">');
        parts.push('<div class="flex items-center gap-4">');
        parts.push(
          `<img alt="Avatar de ${name}" src="${avatar}" loading="lazy" class="h-14 w-14 flex-none rounded-full border border-slate-800 object-cover" />`,
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
    const avatar = data.identity?.avatarUrl ? this.escapeHtml(data.identity.avatarUrl) : '/icons/icon-192.svg';
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
      `<img alt="Avatar de ${this.escapeHtml(data.profileName)}" src="${avatar}" loading="lazy" class="h-24 w-24 flex-none rounded-full border border-slate-800 object-cover" />`,
    );
    parts.push('<div class="space-y-2">');
    parts.push(`<h1 class="text-3xl font-bold text-white">${this.escapeHtml(data.profileName)}</h1>`);
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

    adminRouter.post('/members/:userId/hide', async (req, res) => {
      const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
      if (!rawUserId) {
        res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
        return;
      }

      const idea = typeof req.body?.idea === 'string' ? req.body.idea : null;

      try {
        const record = await this.adminService.hideMember(rawUserId, idea);
        res.status(201).json({ member: record });
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
        res.json({ success: true });
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

        let message: string;
        if (result.status === 'generated') {
          message = "La rédaction automatique d'un nouvel article vient de démarrer.";
        } else if (result.status === 'skipped') {
          switch (result.reason) {
            case 'ALREADY_RUNNING':
              message = 'Une génération est déjà en cours, patiente encore un instant.';
              break;
            case 'MISSING_DEPENDENCIES':
              message = 'La génération est momentanément indisponible (dépendances manquantes).';
              break;
            case 'DISABLED':
              message = "La génération automatique est désactivée pour le moment.";
              break;
            case 'ALREADY_EXISTS':
              message = 'Le billet du jour semble déjà publié.';
              break;
            case 'NO_TRANSCRIPTS':
              message = "Aucune retranscription disponible pour rédiger l'article.";
              break;
            default:
              message = "La génération n'a pas pu démarrer.";
              break;
          }
        } else {
          message =
            typeof result.error === 'string' && result.error.trim().length > 0
              ? result.error
              : "La génération de l'article a échoué.";
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

    this.app.get(['/membres', '/members'], async (req, res) => {
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

      try {
        const appHtml = await this.buildMembersPagePrerender(search);
        this.respondWithAppShell(res, metadata, { appHtml });
      } catch (error) {
        console.error('Failed to prerender members page', error);
        this.respondWithAppShell(res, metadata);
      }
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
