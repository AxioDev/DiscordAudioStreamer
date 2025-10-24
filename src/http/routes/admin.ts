import { Router, type Request, type Response } from 'express';
import type BlogRepository from '../../services/BlogRepository';
import type { BlogPostRow } from '../../services/BlogRepository';
import type AdminService from '../../services/AdminService';
import type { HiddenMemberRecord } from '../../services/AdminService';
import type DailyArticleService from '../../services/DailyArticleService';

interface AdminRouterDeps {
  requireAdminAuth: (req: Request, res: Response) => boolean;
  renderAdminAppShell: () => string | null;
  buildAdminOverview: () => Promise<unknown>;
  blogRepository: BlogRepository | null;
  adminService: AdminService;
  dailyArticleService: DailyArticleService | null;
}

interface AdminListRequestParams {
  page: number;
  perPage: number;
  sortField: string | null;
  sortOrder: 'asc' | 'desc';
  filters: Record<string, unknown>;
}

interface ParsedBlogPostInput {
  slug: string;
  title: string;
  excerpt: string | null;
  contentMarkdown: string;
  coverImageUrl: string | null;
  tags: string[];
  seoDescription: string | null;
  publishedAt: Date;
  updatedAt: Date;
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

interface AdminHiddenMemberRecord extends HiddenMemberRecord {
  id: string;
}

function parseAdminListRequest(req: Request): AdminListRequestParams {
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

function extractAdminSearchFilter(filters: Record<string, unknown>): string | null {
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

function extractAdminTagsFilter(filters: Record<string, unknown>): string[] | null {
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

function extractAdminOnlyPublishedFilter(filters: Record<string, unknown>): boolean {
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

function normalizeSlug(value: string | null | undefined): string | null {
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

function normalizeAdminTags(input: unknown): string[] {
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

function parseDateInput(value: unknown): Date | null {
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

function parseAdminBlogPostInput(
  raw: unknown,
  options: { slugFallback?: string | null; allowSlugOverride?: boolean } = {},
):
  | { ok: true; data: ParsedBlogPostInput }
  | { ok: false; status: number; error: string; message: string } {
  const body = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};

  const slugSource =
    options.allowSlugOverride && typeof body.slug === 'string'
      ? body.slug
      : typeof body.slug === 'string' && options.slugFallback == null
      ? body.slug
      : options.slugFallback ?? (typeof body.slug === 'string' ? body.slug : null);

  const slug = normalizeSlug(slugSource);
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
  const tags = normalizeAdminTags(body.tags);
  const publishedAt = parseDateInput(body.publishedAt) ?? new Date();
  const updatedAt = parseDateInput(body.updatedAt) ?? new Date();

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

function mapBlogPostRowToAdmin(row: BlogPostRow): AdminBlogPostRecord {
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

function mapHiddenMemberRecord(record: HiddenMemberRecord): AdminHiddenMemberRecord {
  return {
    ...record,
    id: record.userId,
  };
}

export function createAdminRouter({
  requireAdminAuth,
  renderAdminAppShell,
  buildAdminOverview,
  blogRepository,
  adminService,
  dailyArticleService,
}: AdminRouterDeps): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response, next) => {
    const accept = req.header('accept') ?? req.header('Accept') ?? '';
    if (typeof accept === 'string' && accept.toLowerCase().includes('application/json')) {
      next();
      return;
    }

    if (!requireAdminAuth(req, res)) {
      return;
    }

    const html = renderAdminAppShell();
    if (!html) {
      res.status(503).type('text/plain').send('ADMIN_ASSETS_UNAVAILABLE');
      return;
    }

    res.type('text/html').send(html);
  });

  router.use((req, res, next) => {
    if (!requireAdminAuth(req, res)) {
      return;
    }
    next();
  });

  router.get('/', async (_req, res) => {
    try {
      const overview = await buildAdminOverview();
      res.json(overview);
    } catch (error) {
      console.error('Failed to build admin overview', error);
      res.status(500).json({
        error: 'ADMIN_OVERVIEW_FAILED',
        message: "Impossible de charger les informations d'administration.",
      });
    }
  });

  router.get('/blog/posts', async (req, res) => {
    if (!blogRepository) {
      res.status(503).json({
        error: 'BLOG_REPOSITORY_DISABLED',
        message: "La gestion des articles est indisponible sur ce serveur.",
      });
      return;
    }

    const listRequest = parseAdminListRequest(req);
    const sortFieldMap: Record<string, string> = {
      publishedAt: 'published_at',
      updatedAt: 'updated_at',
      title: 'title',
      slug: 'slug',
    };
    const sortBy = (sortFieldMap[listRequest.sortField ?? ''] ?? 'published_at') as
      | 'published_at'
      | 'updated_at'
      | 'title'
      | 'slug';
    const searchFilter = extractAdminSearchFilter(listRequest.filters);
    const tagsFilter = extractAdminTagsFilter(listRequest.filters);
    const onlyPublished = extractAdminOnlyPublishedFilter(listRequest.filters);
    const limit = listRequest.perPage;
    const offset = (listRequest.page - 1) * listRequest.perPage;

    try {
      const [rows, total] = await Promise.all([
        blogRepository.listPosts({
          search: searchFilter,
          tags: tagsFilter,
          limit,
          offset,
          sortBy,
          sortOrder: listRequest.sortOrder,
          onlyPublished,
        }),
        blogRepository.countPosts({
          search: searchFilter,
          tags: tagsFilter,
          onlyPublished,
        }),
      ]);

      res.json({
        data: rows.map((row) => mapBlogPostRowToAdmin(row)),
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

  router.get('/blog/posts/:slug', async (req, res) => {
    if (!blogRepository) {
      res.status(503).json({
        error: 'BLOG_REPOSITORY_DISABLED',
        message: "La gestion des articles est indisponible sur ce serveur.",
      });
      return;
    }

    const slug = normalizeSlug(typeof req.params.slug === 'string' ? req.params.slug : null);
    if (!slug) {
      res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Le slug de l’article est requis.' });
      return;
    }

    try {
      const row = await blogRepository.getPostBySlug(slug);
      if (!row) {
        res.status(404).json({ error: 'ADMIN_BLOG_POST_NOT_FOUND', message: "Article introuvable." });
        return;
      }
      res.json({ data: mapBlogPostRowToAdmin(row) });
    } catch (error) {
      console.error('Failed to retrieve admin blog post', error);
      res.status(500).json({
        error: 'ADMIN_BLOG_POST_LOAD_FAILED',
        message: "Impossible de charger cet article.",
      });
    }
  });

  router.post('/blog/posts', async (req, res) => {
    if (!blogRepository) {
      res.status(503).json({
        error: 'BLOG_REPOSITORY_DISABLED',
        message: "La gestion des articles est indisponible sur ce serveur.",
      });
      return;
    }

    const parsed = parseAdminBlogPostInput(req.body, { allowSlugOverride: true });
    if (!parsed.ok) {
      res.status(parsed.status).json({ error: parsed.error, message: parsed.message });
      return;
    }

    try {
      const existing = await blogRepository.getPostBySlug(parsed.data.slug);
      if (existing) {
        res.status(409).json({ error: 'ADMIN_BLOG_POST_CONFLICT', message: 'Un article utilise déjà ce slug.' });
        return;
      }

      await blogRepository.upsertPost(parsed.data);
      const saved = await blogRepository.getPostBySlug(parsed.data.slug);
      if (!saved) {
        throw new Error('BLOG_POST_NOT_FOUND_AFTER_CREATE');
      }
      res.status(201).json({ data: mapBlogPostRowToAdmin(saved) });
    } catch (error) {
      console.error('Failed to create admin blog post', error);
      res.status(500).json({
        error: 'ADMIN_BLOG_POST_CREATE_FAILED',
        message: "Impossible de créer l’article.",
      });
    }
  });

  router.put('/blog/posts/:slug', async (req, res) => {
    if (!blogRepository) {
      res.status(503).json({
        error: 'BLOG_REPOSITORY_DISABLED',
        message: "La gestion des articles est indisponible sur ce serveur.",
      });
      return;
    }

    const slugParam = normalizeSlug(typeof req.params.slug === 'string' ? req.params.slug : null);
    if (!slugParam) {
      res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Le slug de l’article est requis.' });
      return;
    }

    const parsed = parseAdminBlogPostInput(req.body, { slugFallback: slugParam });
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
      const existing = await blogRepository.getPostBySlug(slugParam);
      if (!existing) {
        res.status(404).json({ error: 'ADMIN_BLOG_POST_NOT_FOUND', message: "Article introuvable." });
        return;
      }

      await blogRepository.upsertPost(parsed.data);
      const saved = await blogRepository.getPostBySlug(slugParam);
      if (!saved) {
        throw new Error('BLOG_POST_NOT_FOUND_AFTER_UPDATE');
      }
      res.json({ data: mapBlogPostRowToAdmin(saved) });
    } catch (error) {
      console.error('Failed to update admin blog post', error);
      res.status(500).json({
        error: 'ADMIN_BLOG_POST_UPDATE_FAILED',
        message: "Impossible de mettre à jour l’article.",
      });
    }
  });

  router.delete('/blog/posts/:slug', async (req, res) => {
    if (!blogRepository) {
      res.status(503).json({
        error: 'BLOG_REPOSITORY_DISABLED',
        message: "La gestion des articles est indisponible sur ce serveur.",
      });
      return;
    }

    const slug = normalizeSlug(typeof req.params.slug === 'string' ? req.params.slug : null);
    if (!slug) {
      res.status(400).json({ error: 'SLUG_REQUIRED', message: 'Le slug de l’article est requis.' });
      return;
    }

    try {
      const existing = await blogRepository.getPostBySlug(slug);
      if (!existing) {
        res.status(404).json({ error: 'ADMIN_BLOG_POST_NOT_FOUND', message: "Article introuvable." });
        return;
      }

      const deleted = await blogRepository.deletePostBySlug(slug);
      if (!deleted) {
        throw new Error('BLOG_POST_DELETE_FAILED');
      }

      res.status(204).send();
    } catch (error) {
      console.error('Failed to delete admin blog post', error);
      res.status(500).json({
        error: 'ADMIN_BLOG_POST_DELETE_FAILED',
        message: "Impossible de supprimer l’article.",
      });
    }
  });

  router.get('/members/hidden', async (_req, res) => {
    try {
      const members = await adminService.listHiddenMembers();
      const mapped = members.map((record) => mapHiddenMemberRecord(record));
      res.json({ data: mapped, total: mapped.length });
    } catch (error) {
      console.error('Failed to list hidden members', error);
      res.status(500).json({
        error: 'ADMIN_HIDDEN_MEMBERS_LIST_FAILED',
        message: 'Impossible de récupérer les membres masqués.',
      });
    }
  });

  router.get('/members/hidden/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
      return;
    }

    try {
      const members = await adminService.listHiddenMembers();
      const match = members.find((member) => member.userId === userId);
      if (!match) {
        res.status(404).json({ error: 'MEMBER_NOT_HIDDEN', message: 'Ce membre est visible.' });
        return;
      }
      res.json({ data: mapHiddenMemberRecord(match) });
    } catch (error) {
      console.error('Failed to load hidden member', error);
      res.status(500).json({
        error: 'ADMIN_HIDDEN_MEMBER_LOAD_FAILED',
        message: 'Impossible de récupérer ce membre.',
      });
    }
  });

  router.post('/members/:userId/hide', async (req, res) => {
    const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!rawUserId) {
      res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
      return;
    }

    const idea = typeof req.body?.idea === 'string' ? req.body.idea : null;

    try {
      const record = await adminService.hideMember(rawUserId, idea);
      res.status(201).json({ data: mapHiddenMemberRecord(record) });
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

  router.delete('/members/:userId/hide', async (req, res) => {
    const rawUserId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!rawUserId) {
      res.status(400).json({ error: 'USER_ID_REQUIRED', message: "L'identifiant utilisateur est requis." });
      return;
    }

    try {
      const removed = await adminService.unhideMember(rawUserId);
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

  router.post('/articles/daily', async (_req, res) => {
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
      res.status(status).json({ result });
    } catch (error) {
      console.error('Failed to trigger daily article generation', error);
      res.status(500).json({
        error: 'DAILY_ARTICLE_FAILED',
        message: "Impossible de lancer la génération de l'article.",
      });
    }
  });

  return router;
}
