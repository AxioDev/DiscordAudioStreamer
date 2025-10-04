import { promises as fs } from 'fs';
import path from 'path';
import { marked } from 'marked';

interface BlogServiceOptions {
  postsDirectory: string;
}

export interface BlogPostSummary {
  slug: string;
  title: string;
  date: string | null;
  updatedAt: string | null;
  excerpt: string | null;
}

export interface BlogPostDetail extends BlogPostSummary {
  contentHtml: string;
  contentMarkdown: string;
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

export default class BlogService {
  private readonly postsDirectory: string;

  constructor(options: BlogServiceOptions) {
    this.postsDirectory = options.postsDirectory;
  }

  async listPosts(): Promise<BlogPostSummary[]> {
    try {
      const directoryEntries = await fs.readdir(this.postsDirectory, { withFileTypes: true });
      const summaries: BlogPostSummary[] = [];

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
        summaries.push(summary);
      }

      summaries.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        if (dateA === dateB) {
          return a.slug.localeCompare(b.slug);
        }
        return dateB - dateA;
      });

      return summaries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async getPost(slug: string): Promise<BlogPostDetail | null> {
    if (!slug) {
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
      const contentHtml = marked.parse(parsed.body);
      return {
        slug: safeSlug,
        title,
        date,
        updatedAt: stats.mtime.toISOString(),
        excerpt,
        contentMarkdown: parsed.body,
        contentHtml: typeof contentHtml === 'string' ? contentHtml : String(contentHtml),
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
    return {
      slug,
      title,
      date,
      updatedAt: stats.mtime.toISOString(),
      excerpt,
    };
  }
}
