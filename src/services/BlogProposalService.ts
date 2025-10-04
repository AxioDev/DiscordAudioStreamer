import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import BlogRepository from './BlogRepository';
import BlogService from './BlogService';

export interface BlogProposalServiceOptions {
  proposalsDirectory?: string | null;
  repository?: BlogRepository | null;
  blogService?: BlogService | null;
}

export interface SubmitBlogProposalInput {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  contentMarkdown: string;
  coverImageUrl?: string | null;
  tags?: string[] | null;
  seoDescription?: string | null;
  authorName?: string | null;
  authorContact?: string | null;
}

export interface BlogProposalRecord {
  title: string;
  slug: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverImageUrl: string | null;
  tags: string[];
  seoDescription: string | null;
  authorName: string | null;
  authorContact: string | null;
  reference: string;
  submittedAt: Date;
}

export interface SubmitBlogProposalResult {
  slug: string;
  reference: string;
  submittedAt: string;
}

export class BlogProposalError extends Error {
  readonly code: 'VALIDATION_ERROR' | 'CONFLICT' | 'UNAVAILABLE' | 'INTERNAL_ERROR';

  readonly details: Record<string, string> | null;

  constructor(
    code: 'VALIDATION_ERROR' | 'CONFLICT' | 'UNAVAILABLE' | 'INTERNAL_ERROR',
    message: string,
    details: Record<string, string> | null = null,
  ) {
    super(message);
    this.name = 'BlogProposalError';
    this.code = code;
    this.details = details;
  }
}

const MAX_TITLE_LENGTH = 160;
const MAX_SLUG_LENGTH = 120;
const MAX_EXCERPT_LENGTH = 320;
const MAX_SEO_DESCRIPTION_LENGTH = 320;
const MAX_AUTHOR_FIELD_LENGTH = 160;
const MAX_TAGS = 10;
const MAX_MARKDOWN_LENGTH = 50_000;

const normalizeLineEndings = (value: string): string => value.replace(/\r\n?/g, '\n');

const slugify = (value: string): string => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
  return normalized || `proposition-${Date.now()}`;
};

const normalizeTags = (tags: string[]): string[] => {
  const unique = new Set<string>();
  for (const rawTag of tags) {
    if (typeof rawTag !== 'string') {
      continue;
    }
    const trimmed = rawTag.trim();
    if (!trimmed) {
      continue;
    }
    unique.add(trimmed);
    if (unique.size >= MAX_TAGS) {
      break;
    }
  }
  return Array.from(unique);
};

const isValidUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export default class BlogProposalService {
  private readonly proposalsDirectory: string | null;

  private readonly repository: BlogRepository | null;

  private readonly blogService: BlogService | null;

  private initialized = false;

  constructor(options: BlogProposalServiceOptions) {
    this.proposalsDirectory = options.proposalsDirectory ?? null;
    this.repository = options.repository ?? null;
    this.blogService = options.blogService ?? null;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.repository) {
      await this.repository.ensureSchema();
    }

    if (this.proposalsDirectory) {
      try {
        await fs.mkdir(this.proposalsDirectory, { recursive: true });
      } catch (error) {
        console.warn('BlogProposalService: unable to create proposals directory', error);
      }
    }

    this.initialized = true;
  }

  async submitProposal(input: SubmitBlogProposalInput): Promise<SubmitBlogProposalResult> {
    await this.initialize();

    const errors: Record<string, string> = {};

    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title) {
      errors.title = 'Le titre est obligatoire.';
    } else if (title.length > MAX_TITLE_LENGTH) {
      errors.title = `Le titre ne peut pas dépasser ${MAX_TITLE_LENGTH} caractères.`;
    }

    const providedSlug = typeof input.slug === 'string' ? input.slug.trim() : '';
    if (providedSlug && !/^[-a-zA-Z0-9_]+$/.test(providedSlug)) {
      errors.slug = 'Le lien ne peut contenir que des lettres, chiffres, tirets ou underscores.';
    } else if (providedSlug.length > MAX_SLUG_LENGTH) {
      errors.slug = `Le lien ne peut pas dépasser ${MAX_SLUG_LENGTH} caractères.`;
    }

    const excerpt = typeof input.excerpt === 'string' ? input.excerpt.trim() : '';
    if (excerpt.length > MAX_EXCERPT_LENGTH) {
      errors.excerpt = `L’accroche ne peut pas dépasser ${MAX_EXCERPT_LENGTH} caractères.`;
    }

    const seoDescription = typeof input.seoDescription === 'string' ? input.seoDescription.trim() : '';
    if (seoDescription.length > MAX_SEO_DESCRIPTION_LENGTH) {
      errors.seoDescription = `La description SEO ne peut pas dépasser ${MAX_SEO_DESCRIPTION_LENGTH} caractères.`;
    }

    const contentMarkdown = normalizeLineEndings(input.contentMarkdown ?? '');
    if (!contentMarkdown.trim()) {
      errors.contentMarkdown = 'Le contenu en Markdown est obligatoire.';
    } else if (contentMarkdown.length > MAX_MARKDOWN_LENGTH) {
      errors.contentMarkdown = `Le contenu est trop long (limite de ${MAX_MARKDOWN_LENGTH} caractères).`;
    }

    const coverImageUrlRaw = typeof input.coverImageUrl === 'string' ? input.coverImageUrl.trim() : '';
    if (coverImageUrlRaw && !isValidUrl(coverImageUrlRaw)) {
      errors.coverImageUrl = 'Le lien de l’illustration doit être une URL valide.';
    }

    const authorNameRaw = typeof input.authorName === 'string' ? input.authorName.trim() : '';
    if (authorNameRaw.length > MAX_AUTHOR_FIELD_LENGTH) {
      errors.authorName = `Le nom ou pseudo ne peut pas dépasser ${MAX_AUTHOR_FIELD_LENGTH} caractères.`;
    }

    const authorContactRaw = typeof input.authorContact === 'string' ? input.authorContact.trim() : '';
    if (authorContactRaw.length > MAX_AUTHOR_FIELD_LENGTH) {
      errors.authorContact = `Le contact ne peut pas dépasser ${MAX_AUTHOR_FIELD_LENGTH} caractères.`;
    }

    let tagsInput: string[] = [];
    if (Array.isArray(input.tags)) {
      tagsInput = input.tags;
    }
    const tags = normalizeTags(tagsInput);

    if (Object.keys(errors).length > 0) {
      throw new BlogProposalError('VALIDATION_ERROR', 'Certaines informations sont manquantes ou invalides.', errors);
    }

    const slugBase = providedSlug ? slugify(providedSlug) : slugify(title);
    const slug = await this.resolveUniqueSlug(slugBase);

    const record: BlogProposalRecord = {
      title,
      slug,
      excerpt: excerpt || null,
      contentMarkdown,
      coverImageUrl: coverImageUrlRaw || null,
      tags,
      seoDescription: seoDescription || null,
      authorName: authorNameRaw || null,
      authorContact: authorContactRaw || null,
      reference: randomUUID(),
      submittedAt: new Date(),
    };

    if (this.repository) {
      try {
        await this.repository.createProposal(record);
      } catch (error) {
        console.error('BlogProposalService: unable to persist proposal in database', error);
        throw new BlogProposalError('INTERNAL_ERROR', "Impossible d’enregistrer la proposition dans la base de données.");
      }
    } else if (this.proposalsDirectory) {
      const fileName = `${record.submittedAt.getTime()}-${record.slug}.json`;
      const safeFileName = fileName.replace(/[^a-zA-Z0-9-_\.]/g, '_');
      const targetPath = path.join(this.proposalsDirectory, safeFileName);
      try {
        await fs.writeFile(targetPath, JSON.stringify({ ...record, submittedAt: record.submittedAt.toISOString() }, null, 2), {
          encoding: 'utf-8',
        });
      } catch (error) {
        console.error('BlogProposalService: unable to persist proposal on filesystem', error);
        throw new BlogProposalError('INTERNAL_ERROR', "Impossible d’enregistrer la proposition sur le serveur.");
      }
    } else {
      throw new BlogProposalError('UNAVAILABLE', 'Aucun espace de stockage n’est configuré pour les propositions.');
    }

    return {
      slug: record.slug,
      reference: record.reference,
      submittedAt: record.submittedAt.toISOString(),
    };
  }

  private async resolveUniqueSlug(baseSlug: string): Promise<string> {
    let candidate = baseSlug;
    let attempt = 0;
    while (await this.slugExists(candidate)) {
      attempt += 1;
      if (attempt > 20) {
        return `${baseSlug}-${Date.now()}`;
      }
      candidate = `${baseSlug}-${attempt}`;
    }
    return candidate;
  }

  private async slugExists(slug: string): Promise<boolean> {
    if (this.repository) {
      try {
        const existingPost = await this.repository.getPostBySlug(slug);
        if (existingPost) {
          return true;
        }
        const existingProposal = await this.repository.getProposalBySlug(slug);
        if (existingProposal) {
          return true;
        }
      } catch (error) {
        console.warn('BlogProposalService: unable to verify slug uniqueness with repository', error);
      }
    } else if (this.blogService) {
      try {
        const post = await this.blogService.getPost(slug);
        if (post) {
          return true;
        }
      } catch (error) {
        console.warn('BlogProposalService: unable to verify slug uniqueness with blog service', error);
      }
    }

    if (this.proposalsDirectory) {
      try {
        const entries = await fs.readdir(this.proposalsDirectory);
        return entries.some((entry) => entry.endsWith(`${slug}.json`));
      } catch (error) {
        console.warn('BlogProposalService: unable to inspect proposals directory for slug uniqueness', error);
      }
    }

    return false;
  }
}
