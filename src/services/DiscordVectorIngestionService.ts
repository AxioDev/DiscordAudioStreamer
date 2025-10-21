import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

import config from '../config';
import { getEmbedding } from '../lib/openai';
import {
  buildVectorLiteral,
  deleteDiscordVectorsByIds,
  ensureDiscordVectorSchema,
  insertDiscordVectors,
  listDiscordVectorMetadata,
  PgvectorExtensionRequiredError,
} from './DiscordVectorRepository';
import type BlogService from './BlogService';

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

export interface DiscordVectorIngestionServiceOptions {
  blogService: BlogService | null;
  projectRoot: string;
}

const defaultMarkdownSources: MarkdownSource[] = [
  { id: 'doc:readme', relativePath: 'README.md', title: 'Guide principal du projet', category: 'documentation' },
  {
    id: 'doc:statistics-dashboard',
    relativePath: path.join('src', 'README_STATISTIQUES.md'),
    title: 'Tableau de bord des statistiques communautaires',
    category: 'documentation',
  },
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

const defaultJsonSources: JsonSource[] = [
  {
    id: 'doc:lighthouse-report',
    relativePath: path.join('docs', 'performance', 'lighthouse-report.json'),
    title: 'Rapport Lighthouse (JSON)',
    category: 'documentation',
  },
];

export default class DiscordVectorIngestionService {
  private readonly blogService: BlogService | null;

  private readonly projectRoot: string;

  private readonly defaultIntervalMs = 60 * 60 * 1000;

  private syncPromise: Promise<void> | null = null;

  private syncInterval: NodeJS.Timeout | null = null;

  constructor(options: DiscordVectorIngestionServiceOptions) {
    this.blogService = options.blogService;
    this.projectRoot = options.projectRoot;
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

    const blogDocuments = await this.collectBlogDocuments();
    documents.push(...blogDocuments);

    const markdownDocuments = await this.collectMarkdownDocuments();
    documents.push(...markdownDocuments);

    const jsonDocuments = await this.collectJsonDocuments();
    documents.push(...jsonDocuments);

    return documents;
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

  private normalizeMarkdown(raw: string): string {
    const withoutFrontMatter = raw.replace(/^---\s*\n[\s\S]*?\n---\s*/u, '');
    return withoutFrontMatter.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private chunkDocuments(documents: readonly DiscordVectorDocument[]): DiscordVectorChunk[] {
    const chunks: DiscordVectorChunk[] = [];

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
