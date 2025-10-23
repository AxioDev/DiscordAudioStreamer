import BlogRepository from './BlogRepository';
import BlogService from './BlogService';
import BlogModerationService from './BlogModerationService';

export interface BlogSubmissionServiceOptions {
  repository?: BlogRepository | null;
  blogService?: BlogService | null;
  moderationService?: BlogModerationService | null;
}

export interface SubmitBlogArticleInput {
  title: string;
  slug?: string | null;
  excerpt?: string | null;
  contentMarkdown: string;
  coverImageUrl?: string | null;
  tags?: string[] | null;
  seoDescription?: string | null;
}

export interface SubmitBlogArticleResult {
  slug: string;
  publishedAt: string;
}

export class BlogSubmissionError extends Error {
  readonly code: 'VALIDATION_ERROR' | 'CONFLICT' | 'UNAVAILABLE' | 'INTERNAL_ERROR';

  readonly details: Record<string, string> | null;

  constructor(
    code: 'VALIDATION_ERROR' | 'CONFLICT' | 'UNAVAILABLE' | 'INTERNAL_ERROR',
    message: string,
    details: Record<string, string> | null = null,
  ) {
    super(message);
    this.name = 'BlogSubmissionError';
    this.code = code;
    this.details = details;
  }
}

const MAX_TITLE_LENGTH = 160;
const MAX_SLUG_LENGTH = 120;
const MAX_EXCERPT_LENGTH = 320;
const MAX_SEO_DESCRIPTION_LENGTH = 320;
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
  return normalized || `article-${Date.now()}`;
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

export default class BlogSubmissionService {
  private readonly repository: BlogRepository | null;

  private readonly blogService: BlogService | null;

  private readonly moderationService: BlogModerationService;

  private initialized = false;

  constructor(options: BlogSubmissionServiceOptions) {
    this.repository = options.repository ?? null;
    this.blogService = options.blogService ?? null;
    this.moderationService = options.moderationService ?? new BlogModerationService();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.repository) {
      await this.repository.ensureSchema();
    }

    this.initialized = true;
  }

  async publish(input: SubmitBlogArticleInput): Promise<SubmitBlogArticleResult> {
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

    const contentMarkdownRaw = normalizeLineEndings(input.contentMarkdown ?? '');
    if (!contentMarkdownRaw.trim()) {
      errors.contentMarkdown = 'Le contenu en Markdown est obligatoire.';
    } else if (contentMarkdownRaw.length > MAX_MARKDOWN_LENGTH) {
      errors.contentMarkdown = `Le contenu est trop long (limite de ${MAX_MARKDOWN_LENGTH} caractères).`;
    }

    const coverImageUrlRaw = typeof input.coverImageUrl === 'string' ? input.coverImageUrl.trim() : '';
    if (coverImageUrlRaw && !isValidUrl(coverImageUrlRaw)) {
      errors.coverImageUrl = 'Le lien de l’illustration doit être une URL valide.';
    }

    let tagsInput: string[] = [];
    if (Array.isArray(input.tags)) {
      tagsInput = input.tags;
    }
    const tags = normalizeTags(tagsInput);

    if (Object.keys(errors).length > 0) {
      throw new BlogSubmissionError('VALIDATION_ERROR', 'Certaines informations sont manquantes ou invalides.', errors);
    }

    const moderationVerdict = this.moderationService.evaluate({
      title,
      excerpt: excerpt || null,
      contentMarkdown: contentMarkdownRaw,
    });

    if (!moderationVerdict.approved) {
      const reason =
        moderationVerdict.reasons.join(' ') || 'Le contenu soumis ne répond pas aux critères éditoriaux.';
      throw new BlogSubmissionError(
        'VALIDATION_ERROR',
        'Le contenu soumis ne respecte pas les critères éditoriaux du blog.',
        { contentMarkdown: reason },
      );
    }

    const slugBase = providedSlug ? slugify(providedSlug) : slugify(title);
    const slug = await this.resolveUniqueSlug(slugBase);
    const publishedAt = new Date();

    if (!this.repository) {
      throw new BlogSubmissionError(
        'UNAVAILABLE',
        'Aucune base de données n’est configurée pour publier un article.',
      );
    }

    try {
      await this.repository.createPost({
        slug,
        title,
        excerpt: excerpt || null,
        contentMarkdown: contentMarkdownRaw,
        coverImageUrl: coverImageUrlRaw || null,
        tags,
        seoDescription: seoDescription || null,
        publishedAt,
        updatedAt: publishedAt,
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') {
        throw new BlogSubmissionError('CONFLICT', 'Un article existe déjà avec ce lien.');
      }
      console.error('BlogSubmissionService: unable to persist article', error);
      throw new BlogSubmissionError(
        'INTERNAL_ERROR',
        "Impossible d’enregistrer l’article dans la base de données.",
      );
    }

    if (this.blogService) {
      try {
        await this.blogService.initialize();
      } catch (error) {
        console.warn('BlogSubmissionService: unable to refresh blog service cache', error);
      }
    }

    return {
      slug,
      publishedAt: publishedAt.toISOString(),
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
      } catch (error) {
        console.warn('BlogSubmissionService: unable to verify slug uniqueness with repository', error);
      }
    } else if (this.blogService) {
      try {
        const post = await this.blogService.getPost(slug);
        if (post) {
          return true;
        }
      } catch (error) {
        console.warn('BlogSubmissionService: unable to verify slug uniqueness with blog service', error);
      }
    }

    return false;
  }
}
