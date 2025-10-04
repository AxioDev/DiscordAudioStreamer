import { promises as fs } from 'fs';
import path from 'path';
import { marked } from 'marked';
import BlogRepository, {
  type BlogPostListOptions as RepositoryListOptions,
  type BlogPostRow,
} from './BlogRepository';

export interface BlogServiceOptions {
  postsDirectory?: string | null;
  repository?: BlogRepository | null;
}

export interface BlogPostSummary {
  slug: string;
  title: string;
  date: string | null;
  updatedAt: string | null;
  excerpt: string | null;
  coverImageUrl: string | null;
  tags: string[];
  seoDescription: string | null;
}

export interface BlogPostDetail extends BlogPostSummary {
  contentHtml: string;
  contentMarkdown: string;
}

export interface BlogListOptions {
  search?: string | null;
  tags?: string[] | null;
  limit?: number | null;
  sortBy?: 'date' | 'title' | null;
  sortOrder?: 'asc' | 'desc' | null;
}

export interface BlogListResult {
  posts: BlogPostSummary[];
  availableTags: string[];
}

interface ParsedMarkdown {
  metadata: Record<string, string>;
  body: string;
}

const sanitizeExcerpt = (input: string | null): string | null => {
  if (!input) {
    return null;
  }
  const withoutMarkdown = input
    .replace(/[`*_~>#\[\](!)]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutMarkdown) {
    return null;
  }
  return withoutMarkdown.length > 280 ? `${withoutMarkdown.slice(0, 277).trim()}…` : withoutMarkdown;
};

const normalizeDate = (value: string | undefined | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const parseFrontMatter = (raw: string): ParsedMarkdown => {
  const frontMatterPattern = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = raw.match(frontMatterPattern);
  if (!match) {
    return { metadata: {}, body: raw.trimStart() };
  }

  const metadata: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    if (!key) {
      continue;
    }
    const normalizedKey = key.trim();
    const value = rest.join(':').trim();
    if (!normalizedKey || !value) {
      continue;
    }
    metadata[normalizedKey.toLowerCase()] = value;
  }

  const body = raw.slice(match[0].length).trimStart();
  return { metadata, body };
};

const deriveTitle = (metadata: Record<string, string>, body: string, fallback: string): string => {
  if (metadata.title) {
    return metadata.title;
  }
  const headingMatch = body.match(/^\s*#\s+(.+)$/m);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim();
  }
  return fallback;
};

const deriveExcerpt = (metadata: Record<string, string>, body: string): string | null => {
  if (metadata.description) {
    return sanitizeExcerpt(metadata.description);
  }
  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (paragraphs.length === 0) {
    return null;
  }
  return sanitizeExcerpt(paragraphs[0]);
};

const normalizeMarkdownContent = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }
  const withUnixLineEndings = value.replace(/\r\n?/g, '\n');
  if (withUnixLineEndings.includes('\\n') && !withUnixLineEndings.includes('\n')) {
    return withUnixLineEndings.replace(/\\n/g, '\n');
  }
  return withUnixLineEndings;
};

const normalizeCoverImage = (value: string | undefined | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseTags = (value: string | undefined | null): string[] => {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
};

export default class BlogService {
  private readonly postsDirectory: string | null;

  private readonly repository: BlogRepository | null;

  private repositoryAvailable: boolean;

  private initializationPromise: Promise<void> | null = null;

  constructor(options: BlogServiceOptions) {
    this.postsDirectory = options.postsDirectory ?? null;
    this.repository = options.repository ?? null;
    this.repositoryAvailable = Boolean(this.repository);
  }

  initialize(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeInternal();
    }
    return this.initializationPromise;
  }

  async listPosts(options: BlogListOptions = {}): Promise<BlogListResult> {
    await this.initialize();

    if (this.repository && this.repositoryAvailable) {
      const listOptions: RepositoryListOptions = {
        search: options.search ?? null,
        tags: options.tags ?? null,
        limit: options.limit ?? null,
        sortBy: options.sortBy === 'title' ? 'title' : 'published_at',
        sortOrder: options.sortOrder ?? null,
      };
      try {
        const rows = await this.repository.listPosts(listOptions);
        const tags = await this.repository.listTags();
        return {
          posts: rows.map((row) => this.convertRowToSummary(row)),
          availableTags: tags,
        };
      } catch (error) {
        this.repositoryAvailable = false;
        console.error('BlogService: failed to list posts from repository, falling back to filesystem.', error);
      }
    }

    const fallback = await this.listPostsFromFilesystem(options);
    return fallback;
  }

  async getPost(slug: string): Promise<BlogPostDetail | null> {
    if (!slug) {
      return null;
    }

    await this.initialize();

    if (this.repository && this.repositoryAvailable) {
      try {
        const row = await this.repository.getPostBySlug(slug);
        if (!row) {
          return null;
        }
        const summary = this.convertRowToSummary(row);
        const markdown = normalizeMarkdownContent(row.content_markdown);
        const contentHtml = marked.parse(markdown);
        return {
          ...summary,
          contentMarkdown: markdown,
          contentHtml: typeof contentHtml === 'string' ? contentHtml : String(contentHtml),
        };
      } catch (error) {
        this.repositoryAvailable = false;
        console.error('BlogService: failed to load post from repository, falling back to filesystem.', error);
      }
    }

    return this.getPostFromFilesystem(slug);
  }

  private async initializeInternal(): Promise<void> {
    if (!this.repository || !this.repositoryAvailable) {
      return;
    }

    try {
      await this.repository.ensureSchema();
      await this.repository.seedDemoContent();
    } catch (error) {
      this.repositoryAvailable = false;
      console.error('BlogService: repository initialization failed, falling back to filesystem.', error);
    }
  }

  private convertRowToSummary(row: BlogPostRow): BlogPostSummary {
    const toIsoString = (value: Date | string | null | undefined): string | null => {
      if (!value) {
        return null;
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
      }
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    };

    const date = toIsoString(row.published_at);
    const updatedAt = toIsoString(row.updated_at);
    const normalizedMarkdown = normalizeMarkdownContent(row.content_markdown);
    const excerpt = row.excerpt ?? sanitizeExcerpt(normalizedMarkdown) ?? null;
    const coverImageUrl = normalizeCoverImage(row.cover_image_url);
    const tags = Array.isArray(row.tags)
      ? row.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter((tag) => tag.length > 0)
      : [];
    return {
      slug: row.slug,
      title: row.title,
      date,
      updatedAt,
      excerpt,
      coverImageUrl,
      tags,
      seoDescription: row.seo_description ?? null,
    };
  }

  private async listPostsFromFilesystem(options: BlogListOptions): Promise<BlogListResult> {
    if (!this.postsDirectory) {
      return { posts: [], availableTags: [] };
    }

    try {
      const directoryEntries = await fs.readdir(this.postsDirectory, { withFileTypes: true });
      const allSummaries: BlogPostSummary[] = [];
      const allTags = new Set<string>();

      for (const entry of directoryEntries) {
        if (!entry.isFile()) {
          continue;
        }
        if (!entry.name.toLowerCase().endsWith('.md')) {
          continue;
        }

        const slug = entry.name.replace(/\.md$/i, '');
        const filePath = path.join(this.postsDirectory, entry.name);
        const summary = await this.readPostSummary(filePath, slug);
        summary.tags.forEach((tag) => allTags.add(tag));
        allSummaries.push(summary);
      }

      const normalizedSearch = options.search ? options.search.toLowerCase() : null;
      const normalizedTags = options.tags && options.tags.length > 0 ? new Set(options.tags) : null;

      const summaries = allSummaries.filter((summary) => {
        if (normalizedSearch) {
          const haystack = `${summary.title} ${summary.excerpt ?? ''}`.toLowerCase();
          if (!haystack.includes(normalizedSearch)) {
            return false;
          }
        }
        if (normalizedTags && normalizedTags.size > 0) {
          const matchesTag = summary.tags.some((tag) => normalizedTags.has(tag));
          if (!matchesTag) {
            return false;
          }
        }
        return true;
      });

      const sortBy = options.sortBy === 'title' ? 'title' : 'date';
      const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';

      summaries.sort((a, b) => {
        if (sortBy === 'title') {
          const compare = a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' });
          return sortOrder === 'asc' ? compare : -compare;
        }

        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        if (dateA === dateB) {
          const fallback = a.slug.localeCompare(b.slug);
          return sortOrder === 'asc' ? fallback : -fallback;
        }
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      });

      const limitedSummaries =
        typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
          ? summaries.slice(0, Math.floor(options.limit))
          : summaries;

      return {
        posts: limitedSummaries,
        availableTags: Array.from(allTags).sort((a, b) => a.localeCompare(b)),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return { posts: [], availableTags: [] };
      }
      throw error;
    }
  }

  private async getPostFromFilesystem(slug: string): Promise<BlogPostDetail | null> {
    if (!this.postsDirectory) {
      return null;
    }
    const safeSlug = slug.replace(/[^a-zA-Z0-9-_]/g, '-');
    const filePath = path.join(this.postsDirectory, `${safeSlug}.md`);
    try {
      const [rawContent, stats] = await Promise.all([
        fs.readFile(filePath, 'utf8'),
        fs.stat(filePath),
      ]);
      const parsed = parseFrontMatter(rawContent);
      const title = deriveTitle(parsed.metadata, parsed.body, safeSlug);
      const date = normalizeDate(parsed.metadata.date);
      const excerpt = deriveExcerpt(parsed.metadata, parsed.body);
      const coverImageUrl = normalizeCoverImage(parsed.metadata.cover ?? parsed.metadata.image);
      const tags = parseTags(parsed.metadata.tags);
      const seoDescription = parsed.metadata['seo-description'] ?? parsed.metadata.seo_description ?? excerpt;
      const contentHtml = marked.parse(parsed.body);
      return {
        slug: safeSlug,
        title,
        date,
        updatedAt: stats.mtime.toISOString(),
        excerpt,
        contentMarkdown: parsed.body,
        contentHtml: typeof contentHtml === 'string' ? contentHtml : String(contentHtml),
        coverImageUrl,
        tags,
        seoDescription: seoDescription ? sanitizeExcerpt(seoDescription) : excerpt,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async readPostSummary(filePath: string, slug: string): Promise<BlogPostSummary> {
    const [rawContent, stats] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath),
    ]);
    const parsed = parseFrontMatter(rawContent);
    const title = deriveTitle(parsed.metadata, parsed.body, slug);
    const date = normalizeDate(parsed.metadata.date) ?? stats.mtime.toISOString();
    const excerpt = deriveExcerpt(parsed.metadata, parsed.body);
    const coverImageUrl = normalizeCoverImage(parsed.metadata.cover ?? parsed.metadata.image);
    const tags = parseTags(parsed.metadata.tags);
    const seoDescription = parsed.metadata['seo-description'] ?? parsed.metadata.seo_description ?? excerpt;
    return {
      slug,
      title,
      date,
      updatedAt: stats.mtime.toISOString(),
      excerpt,
      coverImageUrl,
      tags,
      seoDescription: seoDescription ? sanitizeExcerpt(seoDescription) : excerpt,
    };
  }
}
