import { Router, type Request, type Response } from 'express';
import type BlogService from '../../services/BlogService';
import type { BlogListOptions } from '../../services/BlogService';
import BlogSubmissionService, { BlogSubmissionError } from '../../services/BlogSubmissionService';
import type DailyArticleService from '../../services/DailyArticleService';

interface BlogRouterDeps {
  blogService: BlogService;
  blogSubmissionService: BlogSubmissionService;
  dailyArticleService: DailyArticleService | null;
}

function extractString(value: unknown): string | null {
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
}

function extractStringArray(value: unknown): string[] {
  const result: string[] = [];

  const visit = (input: unknown): void => {
    if (Array.isArray(input)) {
      for (const entry of input) {
        visit(entry);
      }
      return;
    }

    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed.length > 0) {
        result.push(trimmed);
      }
    }
  };

  visit(value);
  return result;
}

function parseBlogListOptions(query: Request['query']): BlogListOptions {
  const options: BlogListOptions = {};

  const rawSearch = extractString(query?.search);
  if (rawSearch) {
    options.search = rawSearch;
  }

  const tags = extractStringArray(query?.tag ?? query?.tags);
  if (tags.length > 0) {
    options.tags = tags;
  }

  const rawSort = extractString(query?.sort ?? query?.sortBy);
  if (rawSort) {
    if (rawSort === 'title') {
      options.sortBy = 'title';
    } else if (rawSort === 'date' || rawSort === 'recent' || rawSort === 'published_at') {
      options.sortBy = 'date';
    }
  }

  const rawOrder = extractString(query?.order ?? query?.sortOrder);
  if (rawOrder === 'asc' || rawOrder === 'desc') {
    options.sortOrder = rawOrder;
  }

  const rawLimit = extractString(query?.limit ?? query?.pageSize ?? query?.perPage);
  if (rawLimit) {
    const numericLimit = Number(rawLimit);
    if (Number.isFinite(numericLimit) && numericLimit > 0) {
      options.limit = Math.floor(numericLimit);
    }
  }

  return options;
}

function extractSubmissionTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function handleSubmissionError(res: Response, error: unknown): void {
  if (error instanceof BlogSubmissionError) {
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

  console.error('Failed to publish community article', error);
  res.status(500).json({
    error: 'BLOG_SUBMISSION_FAILED',
    message: "Impossible de publier l’article pour le moment.",
  });
}

export function createBlogRouter({ blogService, blogSubmissionService, dailyArticleService }: BlogRouterDeps): Router {
  const router = Router();

  router.get('/posts', async (req: Request, res: Response) => {
    try {
      const options = parseBlogListOptions(req.query);
      const { posts, availableTags } = await blogService.listPosts(options);
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

  router.get('/posts/:slug', async (req: Request, res: Response) => {
    const rawSlug = typeof req.params.slug === 'string' ? req.params.slug.trim() : '';
    if (!rawSlug) {
      res.status(400).json({
        error: 'SLUG_REQUIRED',
        message: "Le lien de l'article est requis.",
      });
      return;
    }

    try {
      const post = await blogService.getPost(rawSlug);
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

  router.post('/submissions', async (req: Request, res: Response) => {
    const payload = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const tags = extractSubmissionTags(payload.tags);

    try {
      const result = await blogSubmissionService.publish({
        title: typeof payload.title === 'string' ? payload.title : '',
        slug: typeof payload.slug === 'string' ? payload.slug : null,
        excerpt: typeof payload.excerpt === 'string' ? payload.excerpt : null,
        contentMarkdown: typeof payload.contentMarkdown === 'string' ? payload.contentMarkdown : '',
        coverImageUrl: typeof payload.coverImageUrl === 'string' ? payload.coverImageUrl : null,
        tags,
        seoDescription: typeof payload.seoDescription === 'string' ? payload.seoDescription : null,
      });

      res.status(201).json({
        message: 'Merci ! Ton article est désormais publié sur le blog.',
        article: result,
      });
    } catch (error) {
      handleSubmissionError(res, error);
    }
  });

  router.post('/manual-generate', async (_req: Request, res: Response) => {
    if (!dailyArticleService) {
      res.status(503).json({
        error: 'DAILY_ARTICLE_DISABLED',
        message: "La génération d'articles automatiques est désactivée.",
      });
      return;
    }

    try {
      const result = await dailyArticleService.triggerManualGeneration();
      const status = result.status === 'failed' ? 500 : 200;

      let message = 'Génération traitée.';
      if (result.status === 'generated') {
        const publicationNote = result.publishedAt
          ? ` (publié le ${new Date(result.publishedAt).toLocaleString('fr-FR')})`
          : '';
        message = `Un article a été généré et publié${publicationNote}.`;
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
            message = 'Un article existe déjà pour cette date.';
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

  return router;
}
