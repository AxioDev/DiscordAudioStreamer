import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

import config from '../config';
import { SHOP_CONTENT } from '../content/shop';
import { getEmbedding } from '../lib/openai';
import { aboutPageContent } from '../content/about';
import {
  buildVectorLiteral,
  deleteDiscordVectorsByIds,
  ensureDiscordVectorSchema,
  insertDiscordVectors,
  listDiscordVectorMetadata,
  PgvectorExtensionRequiredError,
} from './DiscordVectorRepository';
import type BlogService from './BlogService';
import type ShopService from './ShopService';
import VoiceActivityRepository from './VoiceActivityRepository';

interface DiscordVectorDocument {
  id: string;
  title: string;
  category: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface DiscordVectorChunk {
  sourceId: string;
  content: string;
  metadata: Record<string, unknown>;
}

interface MarkdownSource {
  id: string;
  relativePath: string;
  title: string;
  category: string;
}

interface JsonSource {
  id: string;
  relativePath: string;
  title: string;
  category: string;
}

interface UserSummary {
  userId: string;
  displayName: string | null;
  username: string | null;
  nickname: string | null;
  pseudo: string | null;
  guildIds: string[];
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface DiscordVectorIngestionServiceOptions {
  blogService: BlogService | null;
  projectRoot: string;
  shopService: ShopService | null;
  voiceActivityRepository: VoiceActivityRepository | null;
}

const defaultMarkdownSources: MarkdownSource[] = [
  {
    id: 'doc:seo-report',
    relativePath: path.join('docs', 'rapport-seo.md'),
    title: 'Rapport d\'optimisation SEO',
    category: 'documentation',
  },
  {
    id: 'doc:supabase-troubleshooting',
    relativePath: path.join('docs', 'supabase-auth-troubleshooting.md'),
    title: 'Guide de dépannage Supabase',
    category: 'documentation',
  },
  {
    id: 'doc:lighthouse-summary',
    relativePath: path.join('docs', 'performance', 'lighthouse-summary.md'),
    title: 'Synthèse Lighthouse',
    category: 'documentation',
  },
];

const defaultJsonSources: JsonSource[] = [];

export default class DiscordVectorIngestionService {
  private readonly blogService: BlogService | null;

  private readonly projectRoot: string;

  private readonly shopService: ShopService | null;

  private readonly voiceActivityRepository: VoiceActivityRepository | null;

  private readonly ingestionLookbackMs: number;

  private readonly maxDocumentContentLength = 8000;

  private readonly maxVoiceTranscriptions = 1000;

  private readonly maxMessagesPerUser = 100;

  private readonly maxActiveUsers = 200;

  private readonly defaultIntervalMs = 60 * 60 * 1000;

  private syncPromise: Promise<void> | null = null;

  private syncInterval: NodeJS.Timeout | null = null;

  constructor(options: DiscordVectorIngestionServiceOptions) {
    this.blogService = options.blogService;
    this.projectRoot = options.projectRoot;
    this.shopService = options.shopService ?? null;
    this.voiceActivityRepository = options.voiceActivityRepository ?? null;
    const lookbackWeeks = Math.max(config.vectorIngestion.lookbackWeeks, 1);
    this.ingestionLookbackMs = lookbackWeeks * 7 * 24 * 60 * 60 * 1000;
  }

  startScheduledSynchronization(intervalMs = this.defaultIntervalMs): void {
    if (this.syncInterval) {
      return;
    }

    const runSync = (): void => {
      void this.synchronize().catch((error) => {
        console.error('DiscordVectorIngestionService scheduled synchronization failed', error);
      });
    };

    runSync();
    this.syncInterval = setInterval(runSync, intervalMs);
  }

  stopScheduledSynchronization(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  synchronize(): Promise<void> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = this.synchronizeInternal().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  private async synchronizeInternal(): Promise<void> {
    if (!config.database?.url) {
      console.error(
        'DiscordVectorIngestionService: DATABASE_URL is not configured; skipping vector synchronization.',
      );
      return;
    }

    if (!config.openAI?.apiKey) {
      console.error(
        'DiscordVectorIngestionService: OPENAI_API_KEY is not configured; skipping vector synchronization.',
      );
      return;
    }

    try {
      await ensureDiscordVectorSchema();
    } catch (error) {
      if (error instanceof PgvectorExtensionRequiredError) {
        console.error(
          'DiscordVectorIngestionService: pgvector extension unavailable; unable to synchronize vectors.',
          error.originalError ?? error,
        );
        return;
      }
      console.error('DiscordVectorIngestionService: failed to ensure discord_vectors schema.', error);
      return;
    }

    const documents = await this.collectDocuments();
    if (documents.length === 0) {
      return;
    }

    const chunks = this.chunkDocuments(documents);
    await this.persistChunks(chunks);
  }

  private async collectDocuments(): Promise<DiscordVectorDocument[]> {
    const documents: DiscordVectorDocument[] = [];

    const range = this.getIngestionRange();

    const aboutDocument = this.collectAboutPageDocument();
    if (aboutDocument) {
      documents.push(aboutDocument);
    }

    const blogDocuments = await this.collectBlogDocuments();
    documents.push(...blogDocuments);

    const markdownDocuments = await this.collectMarkdownDocuments();
    documents.push(...markdownDocuments);

    const jsonDocuments = await this.collectJsonDocuments();
    documents.push(...jsonDocuments);

    const shopDocuments = this.collectShopDocuments();
    documents.push(...shopDocuments);

    const userSummaries = await this.loadKnownUsers(range);
    const userMap = new Map<string, UserSummary>();
    for (const user of userSummaries) {
      userMap.set(user.userId, user);
    }

    const userDocuments = this.collectUserDocuments(userSummaries);
    documents.push(...userDocuments);

    const voiceTranscriptionDocuments = await this.collectVoiceTranscriptionDocuments(range, userMap);
    documents.push(...voiceTranscriptionDocuments);

    const messageDocuments = await this.collectMessageDocuments(userSummaries, range);
    documents.push(...messageDocuments);

    const voiceActivityDocuments = await this.collectVoiceActivityDocuments(userSummaries, range);
    documents.push(...voiceActivityDocuments);

    const personaDocuments = await this.collectPersonaDocuments(userSummaries);
    documents.push(...personaDocuments);

    return documents
      .map((document) => {
        const preparedContent = this.prepareDocumentContent(document.content);
        if (!preparedContent) {
          return null;
        }
        return { ...document, content: preparedContent };
      })
      .filter((document): document is DiscordVectorDocument => document !== null);
  }

  private collectAboutPageDocument(): DiscordVectorDocument | null {
    const hero = aboutPageContent.hero;
    const highlights = aboutPageContent.highlights;

    const lines: string[] = [
      hero.eyebrow,
      hero.title,
      '',
      ...hero.paragraphs,
    ];

    if (hero.cta?.label && hero.cta?.href) {
      lines.push('', `Appel à l'action : ${hero.cta.label}`, `Lien : ${hero.cta.href}`);
    }

    if (highlights.length > 0) {
      lines.push('', 'Points saillants :');
      for (const highlight of highlights) {
        lines.push(`- ${highlight.title}`, highlight.body, '');
      }
    }

    const content = lines.join('\n').trim();
    if (!content) {
      return null;
    }

    return {
      id: 'page:about',
      title: hero.title,
      category: 'about',
      content,
      metadata: {
        source: 'about',
        eyebrow: hero.eyebrow,
        cta: hero.cta,
        highlights: highlights.map((highlight) => highlight.title),
      },
    };
  }

  private getIngestionRange(): { since: Date; until: Date } {
    const until = new Date();
    const since = new Date(until.getTime() - this.ingestionLookbackMs);
    return { since, until };
  }

  private async collectBlogDocuments(): Promise<DiscordVectorDocument[]> {
    if (!this.blogService) {
      return [];
    }

    try {
      const listResult = await this.blogService.listPosts({ limit: null, sortOrder: 'asc' });
      const documents: DiscordVectorDocument[] = [];
      for (const summary of listResult.posts) {
        const detail = await this.blogService.getPost(summary.slug);
        if (!detail) {
          continue;
        }

        documents.push({
          id: `blog:${detail.slug}`,
          title: detail.title,
          category: 'blog',
          content: detail.contentMarkdown,
          metadata: {
            source: 'blog',
            slug: detail.slug,
            tags: detail.tags,
            date: detail.date,
            updatedAt: detail.updatedAt,
            seoDescription: detail.seoDescription,
          },
        });
      }
      return documents;
    } catch (error) {
      console.error('DiscordVectorIngestionService: failed to collect blog documents.', error);
      return [];
    }
  }

  private async collectMarkdownDocuments(): Promise<DiscordVectorDocument[]> {
    const documents: DiscordVectorDocument[] = [];

    for (const source of defaultMarkdownSources) {
      const absolutePath = path.join(this.projectRoot, source.relativePath);
      try {
        const [rawContent, stats] = await Promise.all([
          fs.readFile(absolutePath, 'utf8'),
          fs.stat(absolutePath),
        ]);
        const content = this.normalizeMarkdown(rawContent);
        documents.push({
          id: source.id,
          title: source.title,
          category: source.category,
          content,
          metadata: {
            source: source.category,
            path: source.relativePath,
            type: 'markdown',
            lastModified: stats.mtime.toISOString(),
          },
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }

    return documents;
  }

  private async collectJsonDocuments(): Promise<DiscordVectorDocument[]> {
    const documents: DiscordVectorDocument[] = [];

    for (const source of defaultJsonSources) {
      const absolutePath = path.join(this.projectRoot, source.relativePath);
      try {
        const [rawContent, stats] = await Promise.all([
          fs.readFile(absolutePath, 'utf8'),
          fs.stat(absolutePath),
        ]);
        const parsed = JSON.parse(rawContent) as Record<string, unknown>;
        const summaryLines: string[] = [];
        if (typeof parsed.status === 'string') {
          summaryLines.push(`Statut: ${parsed.status}`);
        }
        if (typeof parsed.reason === 'string') {
          summaryLines.push(`Raison: ${parsed.reason}`);
        }
        if (typeof parsed.generatedAt === 'string') {
          summaryLines.push(`Généré le: ${parsed.generatedAt}`);
        }
        const summary = summaryLines.length > 0 ? `${summaryLines.join('\n')}\n\n` : '';
        const content = `${summary}Données brutes:\n${JSON.stringify(parsed, null, 2)}`;

        documents.push({
          id: source.id,
          title: source.title,
          category: source.category,
          content,
          metadata: {
            source: source.category,
            path: source.relativePath,
            type: 'json',
            lastModified: stats.mtime.toISOString(),
          },
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }

    return documents;
  }

  private collectShopDocuments(): DiscordVectorDocument[] {
    const documents: DiscordVectorDocument[] = [];

    const heroLines = [
      SHOP_CONTENT.hero.eyebrow,
      SHOP_CONTENT.hero.title,
      '',
      SHOP_CONTENT.hero.description,
      '',
      'Avantages mis en avant :',
      ...SHOP_CONTENT.hero.highlights.map((entry) => `- ${entry.label}`),
      '',
      `${SHOP_CONTENT.hero.support.eyebrow} :`,
      SHOP_CONTENT.hero.support.body,
    ];

    documents.push({
      id: 'shop:hero',
      title: SHOP_CONTENT.hero.title,
      category: 'shop',
      content: heroLines.join('\n'),
      metadata: {
        source: 'shop',
        type: 'content',
        section: 'hero',
      },
    });

    const sectionEntries = [
      { key: 'verified-payments', section: SHOP_CONTENT.sections.verifiedPayments },
      { key: 'crypto-friendly', section: SHOP_CONTENT.sections.cryptoFriendly },
    ] as const;

    for (const entry of sectionEntries) {
      documents.push({
        id: `shop:section:${entry.key}`,
        title: entry.section.title,
        category: 'shop',
        content: `${entry.section.title}\n\n${entry.section.description}`,
        metadata: {
          source: 'shop',
          type: 'content',
          section: entry.key,
        },
      });
    }

    if (this.shopService) {
      const products = this.shopService.getProducts();
      for (const product of products) {
        const providerLabels = product.providers.map((provider) => {
          switch (provider) {
            case 'stripe':
              return 'Stripe';
            case 'paypal':
              return 'PayPal';
            case 'coingate':
              return 'CoinGate';
            default:
              return provider;
          }
        });

        const lines = [
          product.name,
          '',
          product.description,
          '',
          `Prix public : ${product.price.formatted}`,
          `Devise : ${product.price.currency}`,
          `Moyens de paiement : ${providerLabels.length > 0 ? providerLabels.join(', ') : 'Non précisés'}`,
          `Livraison : ${product.shippingEstimate || 'Non communiquée'}`,
        ];

        if (product.includes.length > 0) {
          lines.push('', 'Contenu du pack :', ...product.includes.map((item) => `- ${item}`));
        }

        if (product.badges.length > 0) {
          lines.push('', 'Badges :', ...product.badges.map((badge) => `- ${badge}`));
        }

        if (product.highlight) {
          lines.push('', 'Produit mis en avant pour la boutique.');
        }

        if (product.updatedAt) {
          lines.push('', `Dernière mise à jour : ${product.updatedAt}`);
        }

        documents.push({
          id: `shop:product:${product.id}`,
          title: product.name,
          category: 'shop',
          content: lines.join('\n'),
          metadata: {
            source: 'shop',
            type: 'product',
            productId: product.id,
            highlight: Boolean(product.highlight),
            price: product.price,
            providers: [...product.providers],
            updatedAt: product.updatedAt ?? null,
          },
        });
      }
    }

    return documents;
  }

  private normalizeMarkdown(raw: string): string {
    const withoutFrontMatter = raw.replace(/^---\s*\n[\s\S]*?\n---\s*/u, '');
    return withoutFrontMatter.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private chunkDocuments(documents: readonly DiscordVectorDocument[]): DiscordVectorChunk[] {
    const chunks: DiscordVectorChunk[] = [];
    const seenContentHashes = new Set<string>();

    for (const document of documents) {
      const normalizedContent = this.normalizeWhitespace(document.content);
      if (!normalizedContent) {
        continue;
      }

      const parts = this.chunkText(normalizedContent);
      if (parts.length === 0) {
        continue;
      }

      const chunkCount = parts.length;
      parts.forEach((part, index) => {
        const chunkSourceId = chunkCount > 1 ? `${document.id}#${index + 1}` : document.id;
        const contentHash = this.hashContent(part);
        if (seenContentHashes.has(contentHash)) {
          return;
        }
        seenContentHashes.add(contentHash);
        const metadata = {
          ...document.metadata,
          title: document.title,
          category: document.category,
          baseSourceId: document.id,
          chunkIndex: index + 1,
          chunkCount,
          sourceId: chunkSourceId,
          contentHash,
          contentLength: part.length,
          lastSyncedAt: new Date().toISOString(),
        };

        chunks.push({
          sourceId: chunkSourceId,
          content: part,
          metadata,
        });
      });
    }

    return chunks;
  }

  private normalizeWhitespace(value: string): string {
    return value.replace(/[\t\r]/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  private chunkText(value: string, maxLength = 1500, overlap = 200): string[] {
    const sanitized = value.trim();
    if (!sanitized) {
      return [];
    }

    if (sanitized.length <= maxLength) {
      return [sanitized];
    }

    const chunks: string[] = [];
    let start = 0;
    while (start < sanitized.length) {
      let end = Math.min(start + maxLength, sanitized.length);
      if (end < sanitized.length) {
        const breakCandidates = [
          sanitized.lastIndexOf('\n\n', end),
          sanitized.lastIndexOf('\n', end),
          sanitized.lastIndexOf('. ', end),
          sanitized.lastIndexOf(' ', end),
        ].filter((candidate) => candidate > start + 200);

        if (breakCandidates.length > 0) {
          end = Math.max(...breakCandidates) + 1;
        }
      }

      const chunk = sanitized.slice(start, end).trim();
      if (chunk) {
        chunks.push(chunk);
      }

      if (end >= sanitized.length) {
        break;
      }

      const nextStart = end - overlap;
      start = nextStart > start ? nextStart : end;
    }

    return chunks;
  }

  private prepareDocumentContent(content: string): string {
    if (typeof content !== 'string') {
      return '';
    }
    const normalized = content.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!normalized) {
      return '';
    }

    if (normalized.length <= this.maxDocumentContentLength) {
      return normalized;
    }

    const truncated = normalized.slice(0, this.maxDocumentContentLength).trimEnd();
    return `${truncated}…`;
  }

  private toIsoString(value: Date | null | undefined): string | null {
    if (!(value instanceof Date)) {
      return null;
    }
    const time = value.getTime();
    if (Number.isNaN(time)) {
      return null;
    }
    return value.toISOString();
  }

  private formatMultiline(value: string | null | undefined, fallback = '(aucun contenu)'): string {
    if (typeof value !== 'string') {
      return fallback;
    }
    const normalized = value.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return normalized.length > 0 ? normalized : fallback;
  }

  private normalizeUserString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      const stringValue = String(value).trim();
      return stringValue.length > 0 ? stringValue : null;
    }
    return null;
  }

  private mergeEarliestDate(current: Date | null, incoming: Date | null): Date | null {
    if (current && incoming) {
      return current.getTime() <= incoming.getTime() ? current : incoming;
    }
    return current ?? incoming ?? null;
  }

  private mergeLatestDate(current: Date | null, incoming: Date | null): Date | null {
    if (current && incoming) {
      return current.getTime() >= incoming.getTime() ? current : incoming;
    }
    return current ?? incoming ?? null;
  }

  private mergeUserMetadata(
    current: Record<string, unknown> | null,
    incoming: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!current && !incoming) {
      return null;
    }
    if (!current) {
      return incoming ? { ...incoming } : null;
    }
    if (!incoming) {
      return { ...current };
    }
    return { ...current, ...incoming };
  }

  private formatUserLabel(userId: string | null, user?: UserSummary | null): string {
    const normalizedId = this.normalizeUserString(userId) ?? 'inconnu';
    if (!user) {
      return normalizedId;
    }
    const displayName =
      this.normalizeUserString(user.displayName) ??
      this.normalizeUserString(user.nickname) ??
      this.normalizeUserString(user.pseudo) ??
      this.normalizeUserString(user.username);

    if (!displayName) {
      return normalizedId;
    }

    return normalizedId === 'inconnu' ? displayName : `${displayName} (${normalizedId})`;
  }

  private formatGuildList(user: UserSummary | null, primaryGuildId: string | null | undefined): string {
    const ids = new Set<string>();

    if (user) {
      for (const guildId of user.guildIds) {
        const normalized = this.normalizeUserString(guildId);
        if (normalized) {
          ids.add(normalized);
        }
      }
    }

    const fallback = this.normalizeUserString(primaryGuildId ?? null);
    if (fallback) {
      ids.add(fallback);
    }

    if (ids.size === 0) {
      return 'inconnues';
    }

    return Array.from(ids).join(', ');
  }

  private collectUserDocuments(users: readonly UserSummary[]): DiscordVectorDocument[] {
    const documents: DiscordVectorDocument[] = [];

    for (const user of users) {
      const userId = this.normalizeUserString(user.userId) ?? user.userId;
      if (!userId) {
        continue;
      }

      const displayName = this.normalizeUserString(user.displayName);
      const username = this.normalizeUserString(user.username);
      const nickname = this.normalizeUserString(user.nickname);
      const pseudo = this.normalizeUserString(user.pseudo);
      const firstSeenIso = this.toIsoString(user.firstSeenAt);
      const lastSeenIso = this.toIsoString(user.lastSeenAt);
      const guildList = this.formatGuildList(user, null);

      const lines = [
        'Profil utilisateur Discord',
        `Nom affiché : ${displayName ?? 'inconnu'}`,
        `Identifiant utilisateur : ${userId}`,
        `Nom d'utilisateur : ${username ?? 'non renseigné'}`,
        `Surnom : ${nickname ?? 'non renseigné'}`,
        `Pseudonyme : ${pseudo ?? 'non renseigné'}`,
        `Guildes associées : ${guildList}`,
        `Première apparition observée : ${firstSeenIso ?? 'inconnue'}`,
        `Dernière activité observée : ${lastSeenIso ?? 'inconnue'}`,
      ];

      const metadata: Record<string, unknown> = {
        source: 'user',
        userId,
        userDisplayName: displayName ?? null,
        username: username ?? null,
        nickname: nickname ?? null,
        pseudo: pseudo ?? null,
        guildIds: [...user.guildIds],
        firstSeenAt: firstSeenIso,
        lastSeenAt: lastSeenIso,
      };

      if (user.metadata && Object.keys(user.metadata).length > 0) {
        lines.push('', 'Métadonnées utilisateur :', JSON.stringify(user.metadata, null, 2));
        metadata.userMetadata = { ...user.metadata };
      }

      documents.push({
        id: `user:${userId}`,
        title: 'Profil utilisateur Discord',
        category: 'discord',
        content: lines.join('\n'),
        metadata,
      });
    }

    return documents;
  }

  private async loadKnownUsers(range: { since: Date; until: Date }): Promise<UserSummary[]> {
    if (!this.voiceActivityRepository) {
      return [];
    }

    try {
      const rawUsers = await this.voiceActivityRepository.listKnownUsers({ activeSince: range.since });
      if (!rawUsers || rawUsers.length === 0) {
        const fallbackIds = await this.listActiveUserIds(range);
        const uniqueFallback = Array.from(new Set(fallbackIds));
        return uniqueFallback.map((userId) => ({
          userId,
          displayName: null,
          username: null,
          nickname: null,
          pseudo: null,
          guildIds: [],
          firstSeenAt: null,
          lastSeenAt: null,
          metadata: null,
        }));
      }

      const summaries = new Map<
        string,
        {
          userId: string;
          displayName: string | null;
          username: string | null;
          nickname: string | null;
          pseudo: string | null;
          firstSeenAt: Date | null;
          lastSeenAt: Date | null;
          metadata: Record<string, unknown> | null;
          guildIds: Set<string>;
        }
      >();

      for (const record of rawUsers) {
        const userId = this.normalizeUserString(record.userId) ?? record.userId;
        if (!userId) {
          continue;
        }

        const displayName =
          this.normalizeUserString(record.displayName) ??
          this.normalizeUserString(record.nickname) ??
          this.normalizeUserString(record.pseudo) ??
          this.normalizeUserString(record.username);
        const username = this.normalizeUserString(record.username);
        const nickname = this.normalizeUserString(record.nickname);
        const pseudo = this.normalizeUserString(record.pseudo);
        const firstSeenAt = record.firstSeenAt instanceof Date && !Number.isNaN(record.firstSeenAt.getTime())
          ? record.firstSeenAt
          : null;
        const lastSeenAt = record.lastSeenAt instanceof Date && !Number.isNaN(record.lastSeenAt.getTime())
          ? record.lastSeenAt
          : null;
        const metadata = record.metadata ? { ...record.metadata } : null;
        const guildId = this.normalizeUserString(record.guildId);

        const existing = summaries.get(userId);
        if (existing) {
          if (displayName) {
            existing.displayName ??= displayName;
          }
          if (username) {
            existing.username ??= username;
          }
          if (nickname) {
            existing.nickname ??= nickname;
          }
          if (pseudo) {
            existing.pseudo ??= pseudo;
          }
          existing.firstSeenAt = this.mergeEarliestDate(existing.firstSeenAt, firstSeenAt);
          existing.lastSeenAt = this.mergeLatestDate(existing.lastSeenAt, lastSeenAt);
          existing.metadata = this.mergeUserMetadata(existing.metadata, metadata);
          if (guildId) {
            existing.guildIds.add(guildId);
          }
        } else {
          const guildIds = new Set<string>();
          if (guildId) {
            guildIds.add(guildId);
          }
          summaries.set(userId, {
            userId,
            displayName: displayName ?? null,
            username: username ?? null,
            nickname: nickname ?? null,
            pseudo: pseudo ?? null,
            firstSeenAt,
            lastSeenAt,
            metadata,
            guildIds,
          });
        }
      }

      const normalizedUsers = Array.from(summaries.values()).map<UserSummary>((entry) => ({
        userId: entry.userId,
        displayName: entry.displayName,
        username: entry.username,
        nickname: entry.nickname,
        pseudo: entry.pseudo,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        metadata: entry.metadata,
        guildIds: Array.from(entry.guildIds),
      }));

      if (normalizedUsers.length === 0) {
        const fallbackIds = await this.listActiveUserIds(range);
        const uniqueFallback = Array.from(new Set(fallbackIds));
        return uniqueFallback.map((userId) => ({
          userId,
          displayName: null,
          username: null,
          nickname: null,
          pseudo: null,
          guildIds: [],
          firstSeenAt: null,
          lastSeenAt: null,
          metadata: null,
        }));
      }

      return normalizedUsers;
    } catch (error) {
      console.error('DiscordVectorIngestionService: failed to collect known users.', error);
      const fallbackIds = await this.listActiveUserIds(range);
      const uniqueFallback = Array.from(new Set(fallbackIds));
      return uniqueFallback.map((userId) => ({
        userId,
        displayName: null,
        username: null,
        nickname: null,
        pseudo: null,
        guildIds: [],
        firstSeenAt: null,
        lastSeenAt: null,
        metadata: null,
      }));
    }
  }

  private async listActiveUserIds(range: { since: Date; until: Date }): Promise<string[]> {
    if (!this.voiceActivityRepository) {
      return [];
    }

    try {
      const entries = await this.voiceActivityRepository.listActiveUsers({ limit: this.maxActiveUsers });
      const sinceTime = range.since.getTime();
      return entries
        .filter((entry) => {
          const lastActivityAt = entry.lastActivityAt;
          if (!(lastActivityAt instanceof Date)) {
            return false;
          }
          const time = lastActivityAt.getTime();
          return !Number.isNaN(time) && time >= sinceTime;
        })
        .map((entry) => entry.userId)
        .filter((userId) => typeof userId === 'string' && userId.length > 0);
    } catch (error) {
      console.error('DiscordVectorIngestionService: failed to list active users.', error);
      return [];
    }
  }

  private async collectVoiceTranscriptionDocuments(
    range: { since: Date; until: Date },
    userMap: ReadonlyMap<string, UserSummary>,
  ): Promise<DiscordVectorDocument[]> {
    if (!this.voiceActivityRepository) {
      return [];
    }

    try {
      const records = await this.voiceActivityRepository.listVoiceTranscriptionsForRange({
        since: range.since,
        until: range.until,
        limit: this.maxVoiceTranscriptions,
      });

      return records.map((record) => {
        const user = record.userId ? userMap.get(record.userId) ?? null : null;
        const userLabel = this.formatUserLabel(record.userId ?? null, user ?? null);
        const guildList = this.formatGuildList(user ?? null, record.guildId ?? null);
        const userDisplayName = user
          ? this.normalizeUserString(user.displayName) ??
            this.normalizeUserString(user.nickname) ??
            this.normalizeUserString(user.pseudo) ??
            this.normalizeUserString(user.username)
          : null;
        const username = user ? this.normalizeUserString(user.username) : null;
        const knownGuildIds = user
          ? [...user.guildIds]
          : record.guildId
          ? [record.guildId]
          : [];
        const timestampIso = this.toIsoString(record.timestamp);
        const contentBody = this.formatMultiline(record.content, '(aucune transcription disponible)');
        const header = [
          'Transcription vocale Discord',
          `Utilisateur : ${userLabel}`,
          `Salon : ${record.channelId ?? 'inconnu'}`,
          `Serveur : ${record.guildId ?? 'inconnu'}`,
          `Guildes associées à l’utilisateur : ${guildList}`,
          `Horodatage : ${timestampIso ?? 'inconnu'}`,
        ].join('\n');
        const content = `${header}\n\n${contentBody}`;

        return {
          id: `voice-transcription:${record.id}`,
          title: 'Transcription vocale',
          category: 'discord',
          content,
          metadata: {
            source: 'voice-transcription',
            transcriptionId: record.id,
            userId: record.userId ?? null,
            userDisplayName: userDisplayName ?? null,
            username: username ?? null,
            channelId: record.channelId ?? null,
            guildId: record.guildId ?? null,
            knownGuildIds,
            timestamp: timestampIso,
          },
        };
      });
    } catch (error) {
      console.error('DiscordVectorIngestionService: failed to collect voice transcriptions.', error);
      return [];
    }
  }

  private async collectMessageDocuments(
    users: readonly UserSummary[],
    range: { since: Date; until: Date },
  ): Promise<DiscordVectorDocument[]> {
    if (!this.voiceActivityRepository || users.length === 0) {
      return [];
    }

    const documents: DiscordVectorDocument[] = [];

    for (const user of users) {
      const userId = user.userId;
      if (!userId) {
        continue;
      }

      try {
        const entries = await this.voiceActivityRepository.listUserMessageActivity({
          userId,
          since: range.since,
          until: range.until,
        });
        const limitedEntries = entries.length > this.maxMessagesPerUser
          ? entries.slice(entries.length - this.maxMessagesPerUser)
          : entries;

        for (const entry of limitedEntries) {
          const timestampIso = this.toIsoString(entry.timestamp);
          const messageContent = this.formatMultiline(entry.content, '(contenu vide)');
          const userLabel = this.formatUserLabel(userId, user);
          const guildList = this.formatGuildList(user, entry.guildId ?? null);
          const displayName =
            this.normalizeUserString(user.displayName) ??
            this.normalizeUserString(user.nickname) ??
            this.normalizeUserString(user.pseudo) ??
            this.normalizeUserString(user.username);
          const username = this.normalizeUserString(user.username);
          const knownGuildIds = Array.from(
            new Set(
              user.guildIds
                .map((guildId) => this.normalizeUserString(guildId) ?? guildId)
                .filter((guildId): guildId is string => typeof guildId === 'string' && guildId.length > 0),
            ),
          );
          const content = [
            'Message texte Discord',
            `Utilisateur : ${userLabel}`,
            `Salon : ${entry.channelId ?? 'inconnu'}`,
            `Serveur du message : ${entry.guildId ?? 'inconnu'}`,
            `Guildes associées à l’utilisateur : ${guildList}`,
            `Horodatage : ${timestampIso ?? 'inconnu'}`,
            '',
            messageContent,
          ].join('\n');

          documents.push({
            id: entry.messageId ? `message:${entry.messageId}` : `message:${userId}:${timestampIso ?? 'unknown'}`,
            title: 'Message Discord',
            category: 'discord',
            content,
            metadata: {
              source: 'message',
              messageId: entry.messageId,
              userId,
              userDisplayName: displayName ?? null,
              username: username ?? null,
              channelId: entry.channelId ?? null,
              guildId: entry.guildId ?? null,
              knownGuildIds,
              timestamp: timestampIso,
              contentLength: messageContent.length,
            },
          });
        }
      } catch (error) {
        console.error(
          `DiscordVectorIngestionService: failed to collect message activity for user ${userId}.`,
          error,
        );
      }
    }

    return documents;
  }

  private async collectVoiceActivityDocuments(
    users: readonly UserSummary[],
    range: { since: Date; until: Date },
  ): Promise<DiscordVectorDocument[]> {
    if (!this.voiceActivityRepository || users.length === 0) {
      return [];
    }

    const documents: DiscordVectorDocument[] = [];

    for (const user of users) {
      const userId = user.userId;
      if (!userId) {
        continue;
      }

      try {
        const [activitySegments, presenceSegments] = await Promise.all([
          this.voiceActivityRepository.listUserVoiceActivity({
            userId,
            since: range.since,
            until: range.until,
          }),
          this.voiceActivityRepository.listUserVoicePresence({
            userId,
            since: range.since,
            until: range.until,
          }),
        ]);

        const userLabel = this.formatUserLabel(userId, user);
        const displayName =
          this.normalizeUserString(user.displayName) ??
          this.normalizeUserString(user.nickname) ??
          this.normalizeUserString(user.pseudo) ??
          this.normalizeUserString(user.username);
        const username = this.normalizeUserString(user.username);
        const knownGuildIds = Array.from(
          new Set(
            user.guildIds
              .map((guildId) => this.normalizeUserString(guildId) ?? guildId)
              .filter((guildId): guildId is string => typeof guildId === 'string' && guildId.length > 0),
          ),
        );

        for (const segment of activitySegments) {
          const startedAtIso = this.toIsoString(segment.startedAt);
          const durationMs = segment.durationMs;
          const durationMinutes = Number.isFinite(durationMs)
            ? (durationMs / 60000).toFixed(2)
            : '0';
          const estimatedEnd =
            typeof durationMs === 'number' && Number.isFinite(durationMs)
              ? this.toIsoString(new Date(segment.startedAt.getTime() + durationMs))
              : null;
          const guildList = this.formatGuildList(user, segment.guildId ?? null);

          const content = [
            'Activité vocale Discord',
            `Utilisateur : ${userLabel}`,
            `Salon : ${segment.channelId ?? 'inconnu'}`,
            `Serveur : ${segment.guildId ?? 'inconnu'}`,
            `Guildes associées à l’utilisateur : ${guildList}`,
            `Début : ${startedAtIso ?? 'inconnu'}`,
            `Durée (minutes) : ${durationMinutes}`,
            `Fin estimée : ${estimatedEnd ?? 'inconnue'}`,
          ].join('\n');

          const activityKey = `${userId}:${segment.channelId ?? 'unknown'}:${segment.guildId ?? 'unknown'}:${startedAtIso ?? ''}:${durationMs ?? ''}`;
          const activityId = startedAtIso
            ? `voice-activity:${userId}:${startedAtIso}`
            : `voice-activity:${this.hashContent(activityKey)}`;

          documents.push({
            id: activityId,
            title: 'Activité vocale',
            category: 'discord',
            content,
            metadata: {
              source: 'voice-activity',
              userId,
              userDisplayName: displayName ?? null,
              username: username ?? null,
              channelId: segment.channelId ?? null,
              guildId: segment.guildId ?? null,
              knownGuildIds,
              startedAt: startedAtIso,
              durationMs,
              estimatedEndedAt: estimatedEnd,
            },
          });
        }

        for (const presence of presenceSegments) {
          const joinedAtIso = this.toIsoString(presence.joinedAt);
          const leftAtIso = this.toIsoString(presence.leftAt ?? null);
          const guildList = this.formatGuildList(user, presence.guildId ?? null);
          const content = [
            'Présence vocale Discord',
            `Utilisateur : ${userLabel}`,
            `Salon : ${presence.channelId ?? 'inconnu'}`,
            `Serveur : ${presence.guildId ?? 'inconnu'}`,
            `Guildes associées à l’utilisateur : ${guildList}`,
            `Arrivée : ${joinedAtIso ?? 'inconnue'}`,
            `Départ : ${leftAtIso ?? 'en cours'}`,
          ].join('\n');

          const presenceKey = `${userId}:${presence.channelId ?? 'unknown'}:${presence.guildId ?? 'unknown'}:${joinedAtIso ?? ''}:${leftAtIso ?? ''}`;
          const presenceId = joinedAtIso
            ? `voice-presence:${userId}:${joinedAtIso}`
            : `voice-presence:${this.hashContent(presenceKey)}`;

          documents.push({
            id: presenceId,
            title: 'Présence vocale',
            category: 'discord',
            content,
            metadata: {
              source: 'voice-presence',
              userId,
              userDisplayName: displayName ?? null,
              username: username ?? null,
              channelId: presence.channelId ?? null,
              guildId: presence.guildId ?? null,
              joinedAt: joinedAtIso,
              leftAt: leftAtIso,
              knownGuildIds,
            },
          });
        }
      } catch (error) {
        console.error(
          `DiscordVectorIngestionService: failed to collect voice activity for user ${userId}.`,
          error,
        );
      }
    }

    return documents;
  }

  private async collectPersonaDocuments(users: readonly UserSummary[]): Promise<DiscordVectorDocument[]> {
    if (!this.voiceActivityRepository || users.length === 0) {
      return [];
    }

    const documents: DiscordVectorDocument[] = [];

    for (const user of users) {
      const userId = user.userId;
      if (!userId) {
        continue;
      }

      try {
        const profile = await this.voiceActivityRepository.getUserPersonaProfile({ userId });
        if (!profile) {
          continue;
        }

        const persona = profile.persona;
        if (!persona) {
          continue;
        }
        const sections: string[] = [];

        const userLabel = this.formatUserLabel(userId, user);
        const displayName =
          this.normalizeUserString(user.displayName) ??
          this.normalizeUserString(user.nickname) ??
          this.normalizeUserString(user.pseudo) ??
          this.normalizeUserString(user.username);
        const username = this.normalizeUserString(user.username);
        const knownGuildIds = Array.from(
          new Set(
            user.guildIds
              .map((guildId) => this.normalizeUserString(guildId) ?? guildId)
              .filter((guildId): guildId is string => typeof guildId === 'string' && guildId.length > 0),
          ),
        );
        const guildList = this.formatGuildList(user, profile.guildId ?? null);

        if (profile.summary) {
          sections.push(profile.summary);
        }

        const appendInsights = (
          title: string,
          items: Array<{ title: string; detail: string; confidence: string }> | undefined,
        ): void => {
          if (!items || items.length === 0) {
            return;
          }
          sections.push('', title);
          for (const item of items) {
            const detail = this.formatMultiline(item.detail, '(détail indisponible)');
            sections.push(`- ${item.title} — ${detail} (confiance : ${item.confidence})`);
          }
        };

        appendInsights('Points forts', persona.highlights);
        appendInsights('Identité — Rôles', persona.identity?.roles);
        appendInsights('Identité — Langues', persona.identity?.languages);
        appendInsights('Identité — Lieux', persona.identity?.locations);
        appendInsights('Centres d’intérêt', persona.interests);
        appendInsights('Expertise', persona.expertise);
        appendInsights('Personnalité — Traits', persona.personality?.traits);
        appendInsights('Personnalité — Communication', persona.personality?.communication);
        appendInsights('Personnalité — Valeurs', persona.personality?.values);
        appendInsights('Préférences — Aime', persona.preferences?.likes);
        appendInsights('Préférences — N’aime pas', persona.preferences?.dislikes);
        appendInsights('Préférences — Conseils de collaboration', persona.preferences?.collaborationTips);
        appendInsights('Préférences — Formats de contenu', persona.preferences?.contentFormats);
        appendInsights('Initiateurs de conversation', persona.conversationStarters);
        appendInsights('Style de vie', persona.lifestyle);
        appendInsights(
          'Citations notables',
          persona.notableQuotes?.map((quote) => ({
            title: quote.context ? `Citation (${quote.context})` : 'Citation',
            detail: quote.quote,
            confidence: 'medium',
          })),
        );
        appendInsights('Avertissements', persona.disclaimers);

        const generatedAtIso = this.toIsoString(profile.generatedAt ?? null);
        const updatedAtIso = this.toIsoString(profile.updatedAt ?? null);
        const lastActivityIso = this.toIsoString(profile.lastActivityAt ?? null);

        const content = [
          `Profil de persona Discord pour ${userLabel}`,
          `Identifiant utilisateur : ${userId}`,
          `Serveur : ${profile.guildId ?? 'inconnu'}`,
          `Guildes associées à l’utilisateur : ${guildList}`,
          `Nom affiché connu : ${displayName ?? 'inconnu'}`,
          `Nom d’utilisateur : ${username ?? 'non renseigné'}`,
          `Modèle : ${profile.model ?? 'inconnu'}`,
          `Version : ${profile.version ?? 'inconnue'}`,
          `Généré le : ${generatedAtIso ?? 'inconnu'}`,
          `Mis à jour le : ${updatedAtIso ?? 'inconnu'}`,
          `Dernière activité : ${lastActivityIso ?? 'inconnue'}`,
          `Échantillons vocaux : ${profile.voiceSampleCount}`,
          `Échantillons de messages : ${profile.messageSampleCount}`,
          `Caractères analysés : ${profile.inputCharacterCount}`,
          '',
          ...sections,
        ].join('\n');

        documents.push({
          id: `user-persona:${userId}`,
          title: 'Profil persona Discord',
          category: 'discord',
          content,
          metadata: {
            source: 'user-persona',
            userId,
            userDisplayName: displayName ?? null,
            username: username ?? null,
            guildId: profile.guildId ?? null,
            knownGuildIds,
            model: profile.model ?? null,
            version: profile.version ?? null,
            generatedAt: generatedAtIso,
            updatedAt: updatedAtIso,
            lastActivityAt: lastActivityIso,
            voiceSampleCount: profile.voiceSampleCount,
            messageSampleCount: profile.messageSampleCount,
            inputCharacterCount: profile.inputCharacterCount,
          },
        });
      } catch (error) {
        console.error(
          `DiscordVectorIngestionService: failed to collect persona profile for user ${userId}.`,
          error,
        );
      }
    }

    return documents;
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private async persistChunks(chunks: readonly DiscordVectorChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const existingRows = await listDiscordVectorMetadata();
    const existingMap = new Map<string, { id: number; hash: string | null }>();
    const idsToDelete = new Set<number>();
    for (const row of existingRows) {
      const sourceId = typeof row.metadata?.sourceId === 'string' ? row.metadata.sourceId : null;
      if (!sourceId) {
        continue;
      }
      const contentHash = typeof row.metadata?.contentHash === 'string' ? row.metadata.contentHash : null;
      const duplicate = existingMap.get(sourceId);
      if (duplicate) {
        idsToDelete.add(duplicate.id);
      }
      existingMap.set(sourceId, { id: row.id, hash: contentHash });
    }

    const desiredChunks = new Map<string, DiscordVectorChunk>();
    for (const chunk of chunks) {
      desiredChunks.set(chunk.sourceId, chunk);
    }

    const chunksToInsert: DiscordVectorChunk[] = [];

    for (const [sourceId, chunk] of desiredChunks.entries()) {
      const existing = existingMap.get(sourceId);
      if (!existing) {
        chunksToInsert.push(chunk);
        continue;
      }

      if (existing.hash !== chunk.metadata.contentHash) {
        idsToDelete.add(existing.id);
        chunksToInsert.push(chunk);
      }

      existingMap.delete(sourceId);
    }

    for (const entry of existingMap.values()) {
      idsToDelete.add(entry.id);
    }

    if (idsToDelete.size > 0) {
      await deleteDiscordVectorsByIds([...idsToDelete]);
    }

    if (chunksToInsert.length === 0) {
      return;
    }

    const rows = [];
    for (const chunk of chunksToInsert) {
      const embedding = await getEmbedding(chunk.content);
      const vectorLiteral = buildVectorLiteral(embedding);
      rows.push({ content: chunk.content, metadata: chunk.metadata, vectorLiteral });
    }

    await insertDiscordVectors(rows);
  }
}
