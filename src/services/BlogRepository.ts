import { Pool, PoolConfig } from 'pg';

export interface BlogRepositoryOptions {
  url?: string;
  ssl?: boolean;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
}

export type BlogPostSortBy = 'published_at' | 'title' | 'updated_at' | 'slug';
export type BlogPostSortOrder = 'asc' | 'desc';

export interface BlogPostListOptions {
  search?: string | null;
  tags?: string[] | null;
  limit?: number | null;
  offset?: number | null;
  sortBy?: BlogPostSortBy | null;
  sortOrder?: BlogPostSortOrder | null;
  onlyPublished?: boolean;
}

export interface BlogPostRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_markdown: string;
  cover_image_url: string | null;
  tags: string[] | null;
  seo_description: string | null;
  published_at: Date | null;
  updated_at: Date | null;
}

export interface BlogPostProposalInput {
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

export interface BlogPostProposalRow {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_markdown: string;
  cover_image_url: string | null;
  tags: string[] | null;
  seo_description: string | null;
  author_name: string | null;
  author_contact: string | null;
  reference: string;
  submitted_at: Date;
}

export interface BlogPostProposalListOptions {
  search?: string | null;
  limit?: number | null;
  offset?: number | null;
  sortOrder?: BlogPostSortOrder | null;
}

export interface BlogPostProposalPersistedResult {
  id: number | null;
  slug: string;
  reference: string;
  submittedAt: Date;
}

interface SeedPostInput {
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

export default class BlogRepository {
  private readonly connectionString?: string;

  private readonly ssl: boolean;

  private readonly poolConfig?: Omit<PoolConfig, 'connectionString'>;

  private pool: Pool | null = null;

  private warnedAboutMissingConnection = false;

  constructor(options: BlogRepositoryOptions) {
    this.connectionString = options.url;
    this.ssl = Boolean(options.ssl);
    this.poolConfig = options.poolConfig;
  }

  private async getPool(): Promise<Pool | null> {
    if (!this.connectionString) {
      if (!this.warnedAboutMissingConnection) {
        this.warnedAboutMissingConnection = true;
        console.warn('BlogRepository: aucune base de données configurée (DATABASE_URL manquant).');
      }
      return null;
    }

    if (this.pool) {
      return this.pool;
    }

    this.pool = new Pool({
      connectionString: this.connectionString,
      ssl: this.ssl ? { rejectUnauthorized: false } : undefined,
      ...this.poolConfig,
    });

    this.pool.on('error', (error) => {
      console.error('BlogRepository: erreur de connexion à la base de données', error);
    });

    return this.pool;
  }

  async close(): Promise<void> {
    if (!this.pool) {
      return;
    }
    try {
      await this.pool.end();
    } finally {
      this.pool = null;
    }
  }

  async ensureSchema(): Promise<void> {
    const pool = await this.getPool();
    if (!pool) {
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        excerpt TEXT,
        content_markdown TEXT NOT NULL,
        cover_image_url TEXT,
        tags TEXT[] DEFAULT ARRAY[]::TEXT[],
        seo_description TEXT,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(
      'CREATE INDEX IF NOT EXISTS blog_posts_published_at_idx ON blog_posts (published_at DESC)',
    );
    await pool.query(
      'CREATE INDEX IF NOT EXISTS blog_posts_tags_idx ON blog_posts USING GIN (tags)',
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS blog_post_proposals (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT,
        content_markdown TEXT NOT NULL,
        cover_image_url TEXT,
        tags TEXT[] DEFAULT ARRAY[]::TEXT[],
        seo_description TEXT,
        author_name TEXT,
        author_contact TEXT,
        reference TEXT NOT NULL UNIQUE,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS blog_post_proposals_slug_idx ON blog_post_proposals (slug)',
    );

    await pool.query(
      'CREATE INDEX IF NOT EXISTS blog_post_proposals_submitted_at_idx ON blog_post_proposals (submitted_at DESC)',
    );
  }

  async seedDemoContent(): Promise<void> {
    const pool = await this.getPool();
    if (!pool) {
      return;
    }

    const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::text as count FROM blog_posts');
    const count = rows.length > 0 ? Number.parseInt(rows[0].count, 10) : 0;
    if (Number.isFinite(count) && count > 0) {
      return;
    }

    const now = new Date();
    const posts: SeedPostInput[] = [
      {
        slug: 'plongee-dans-la-libre-antenne',
        title: 'Plongée dans la Libre Antenne : comment tout a commencé',
        excerpt:
          "Retour sur la première nuit où nous avons branché le bot, ouvert les micros et découvert la puissance de la communauté.",
        contentMarkdown: `# Plongée dans la Libre Antenne\\n\\nLa Libre Antenne est née d'une envie simple : proposer un espace sans filtre où chacun peut s'exprimer.\\n\\nTout a commencé autour d'un café virtuel tard dans la nuit. Quelques passionnés de radio libre, des anciens de la bande FM et des nouveaux venus habitués des salons Discord, se sont demandé comment réunir cette énergie.\\n\\n## Un test devenu un rendez-vous\\n\\nNous avons branché un bot audio bricolé en quelques heures, écrit des scripts pour éviter que tout explose, et ouvert un canal vocal.\\n\\nLes premiers auditeurs sont arrivés par hasard. Puis ils sont restés. Ils ont raconté leur journée, partagé leurs playlists secrètes, débattu de tout et de rien.\\n\\n## Ce que nous avons appris\\n\\n- Laisser de la place au silence est important.\\n- Un bon mixage change la perception de toute une discussion.\\n- Les outils sont là pour soutenir la parole, pas l'inverse.\\n\\nDepuis, nous avons peaufiné notre setup, automatisé la modération, et surtout renforcé les liens avec celles et ceux qui passent dire bonjour.\\n\\nMerci d'être là, et bienvenue si vous découvrez tout juste la Libre Antenne !`,
        coverImageUrl:
          'https://images.unsplash.com/photo-1516280030429-27679b3dc9cf?auto=format&fit=crop&w=1200&q=80',
        tags: ['communauté', 'histoire'],
        seoDescription:
          "Découvrez les origines de la Libre Antenne et la nuit où l'expérience communautaire a vraiment commencé.",
        publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 21),
        updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 18),
      },
      {
        slug: 'studio-technique-libre-antenne',
        title: 'Dans les coulisses du studio : la technique qui fait tourner la station',
        excerpt:
          "Des micros aux scripts Node.js : tour d'horizon du setup qui permet de diffuser en continu sur Discord et sur le web.",
        contentMarkdown: `# Dans les coulisses du studio\\n\\nLa technique évolue constamment, mais certains piliers restent inchangés :\\n\\n### 1. La capture audio\\nNous utilisons un bot Discord personnalisé capable de gérer plusieurs entrées simultanément. Il détecte les prises de parole et applique une normalisation douce pour garder une écoute confortable.\\n\\n### 2. Le mixage temps réel\\nUn mixeur logiciel agrège chaque flux et applique des effets légers (gate, compression multibande) avant de transmettre le tout vers FFmpeg.\\n\\n### 3. La diffusion multi-formats\\nGrâce à FFmpeg, nous sortons en Ogg Opus et en MP3. Cela nous permet de rester accessibles même sur des connexions instables.\\n\\n### 4. L'observabilité\\nNous surveillons en permanence le niveau des pistes, le taux de drop et la latence. Un dashboard maison nous envoie des alertes si un canal sature ou si un bot décroche.\\n\\nLa tech est là pour servir la spontanéité, jamais l'inverse.`,
        coverImageUrl:
          'https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=1200&q=80',
        tags: ['technique', 'coulisses'],
        seoDescription:
          'Découvrez l’infrastructure audio temps réel qui propulse la Libre Antenne jour et nuit.',
        publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 14),
        updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 10),
      },
      {
        slug: 'meilleures-interventions-communautaires',
        title: 'Les interventions qui ont marqué la communauté ce mois-ci',
        excerpt:
          "Sélection des moments forts partagés en direct : confidences nocturnes, débats endiablés et découvertes musicales.",
        contentMarkdown: `# Les interventions marquantes du mois\\n\\nChaque mois, nous compilons les moments qui ont fait vibrer la communauté :\\n\\n- **Une confession nocturne** qui a rappelé pourquoi cet espace existe.\\n- **Un freestyle improvisé** devenu instantanément culte.\\n- **Un débat sur l'éthique de l'IA** qui a terminé en fous rires.\\n\\nMerci aux auditeurs et auditrices qui rendent ces échanges possibles. Continuez à proposer vos idées et à venir vous exprimer !`,
        coverImageUrl:
          'https://images.unsplash.com/photo-1525182008055-f88b95ff7980?auto=format&fit=crop&w=1200&q=80',
        tags: ['communauté', 'moments forts'],
        seoDescription:
          'Moments forts de la communauté Libre Antenne : retrouvez les interventions qui ont marqué notre dernier mois.',
        publishedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7),
        updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3),
      },
    ];

    for (const post of posts) {
      await pool.query(
        `
          INSERT INTO blog_posts (
            slug,
            title,
            excerpt,
            content_markdown,
            cover_image_url,
            tags,
            seo_description,
            published_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (slug) DO NOTHING
        `,
        [
          post.slug,
          post.title,
          post.excerpt,
          post.contentMarkdown,
          post.coverImageUrl,
          post.tags,
          post.seoDescription,
          post.publishedAt,
          post.updatedAt,
        ],
      );
    }
  }

  async listPosts(options: BlogPostListOptions = {}): Promise<BlogPostRow[]> {
    const pool = await this.getPool();
    if (!pool) {
      return [];
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.onlyPublished !== false) {
      conditions.push('published_at <= NOW()');
    }

    if (options.search) {
      params.push(`%${options.search}%`);
      const index = params.length;
      conditions.push(`(title ILIKE $${index} OR excerpt ILIKE $${index} OR content_markdown ILIKE $${index})`);
    }

    if (options.tags && options.tags.length > 0) {
      params.push(options.tags);
      const index = params.length;
      conditions.push(`tags && $${index}::text[]`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSortColumns: BlogPostSortBy[] = ['published_at', 'title', 'updated_at', 'slug'];
    const sortByCandidate = options.sortBy ?? 'published_at';
    const sortBy = allowedSortColumns.includes(sortByCandidate) ? sortByCandidate : 'published_at';
    const defaultOrder = sortBy === 'title' || sortBy === 'slug' ? 'asc' : 'desc';
    const sortOrderCandidate = options.sortOrder ?? defaultOrder;
    const sortOrder = sortOrderCandidate === 'asc' ? 'ASC' : 'DESC';

    const orderClause = `ORDER BY ${sortBy} ${sortOrder}`;

    let limitClause = '';
    if (options.limit && Number.isFinite(options.limit) && options.limit > 0) {
      params.push(options.limit);
      limitClause = `LIMIT $${params.length}`;
    }

    let offsetClause = '';
    if (options.offset && Number.isFinite(options.offset) && options.offset > 0) {
      params.push(options.offset);
      offsetClause = `OFFSET $${params.length}`;
    }

    const query = `
      SELECT
        id,
        slug,
        title,
        excerpt,
        content_markdown,
        cover_image_url,
        tags,
        seo_description,
        published_at,
        updated_at
      FROM blog_posts
      ${whereClause}
      ${orderClause}
      ${limitClause}
      ${offsetClause}
    `;

    const { rows } = await pool.query<BlogPostRow>(query, params);
    return rows;
  }

  async countPosts(options: {
    search?: string | null;
    tags?: string[] | null;
    onlyPublished?: boolean;
  } = {}): Promise<number> {
    const pool = await this.getPool();
    if (!pool) {
      return 0;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.onlyPublished !== false) {
      conditions.push('published_at <= NOW()');
    }

    if (options.search) {
      params.push(`%${options.search}%`);
      const index = params.length;
      conditions.push(`(title ILIKE $${index} OR excerpt ILIKE $${index} OR content_markdown ILIKE $${index})`);
    }

    if (options.tags && options.tags.length > 0) {
      params.push(options.tags);
      const index = params.length;
      conditions.push(`tags && $${index}::text[]`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM blog_posts ${whereClause}`,
      params,
    );

    const raw = rows.length > 0 ? Number.parseInt(rows[0].count, 10) : 0;
    return Number.isFinite(raw) ? raw : 0;
  }

  async listTags(): Promise<string[]> {
    const pool = await this.getPool();
    if (!pool) {
      return [];
    }

    const { rows } = await pool.query<{ tag: string }>(
      `
        SELECT DISTINCT tag
        FROM (
          SELECT UNNEST(tags) AS tag FROM blog_posts
        ) AS expanded
        WHERE tag IS NOT NULL AND TRIM(tag) <> ''
        ORDER BY tag ASC
      `,
    );

    return rows.map((row) => row.tag).filter((tag) => typeof tag === 'string' && tag.trim().length > 0);
  }

  async getPostBySlug(slug: string): Promise<BlogPostRow | null> {
    const pool = await this.getPool();
    if (!pool) {
      return null;
    }

    const { rows } = await pool.query<BlogPostRow>(
      `
        SELECT
          id,
          slug,
          title,
          excerpt,
          content_markdown,
          cover_image_url,
          tags,
          seo_description,
          published_at,
          updated_at
        FROM blog_posts
        WHERE slug = $1
        LIMIT 1
      `,
      [slug],
    );

    return rows.length > 0 ? rows[0] : null;
  }

  async deletePostBySlug(slug: string): Promise<boolean> {
    const pool = await this.getPool();
    if (!pool) {
      return false;
    }

    const result = await pool.query('DELETE FROM blog_posts WHERE slug = $1', [slug]);
    return (result.rowCount ?? 0) > 0;
  }

  async getProposalBySlug(slug: string): Promise<BlogPostProposalRow | null> {
    const pool = await this.getPool();
    if (!pool) {
      return null;
    }

    const { rows } = await pool.query<BlogPostProposalRow>(
      `
        SELECT
          id,
          slug,
          title,
          excerpt,
          content_markdown,
          cover_image_url,
          tags,
          seo_description,
          author_name,
          author_contact,
          reference,
          submitted_at
        FROM blog_post_proposals
        WHERE slug = $1
        LIMIT 1
      `,
      [slug],
    );

    return rows.length > 0 ? rows[0] : null;
  }

  async listProposals(options: BlogPostProposalListOptions = {}): Promise<BlogPostProposalRow[]> {
    const pool = await this.getPool();
    if (!pool) {
      return [];
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.search) {
      params.push(`%${options.search}%`);
      const index = params.length;
      conditions.push(
        `(title ILIKE $${index} OR excerpt ILIKE $${index} OR content_markdown ILIKE $${index} OR author_name ILIKE $${index})`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortOrder = options.sortOrder === 'asc' ? 'ASC' : 'DESC';

    let limitClause = '';
    if (options.limit && Number.isFinite(options.limit) && options.limit > 0) {
      params.push(options.limit);
      limitClause = `LIMIT $${params.length}`;
    }

    let offsetClause = '';
    if (options.offset && Number.isFinite(options.offset) && options.offset > 0) {
      params.push(options.offset);
      offsetClause = `OFFSET $${params.length}`;
    }

    const query = `
      SELECT
        id,
        slug,
        title,
        excerpt,
        content_markdown,
        cover_image_url,
        tags,
        seo_description,
        author_name,
        author_contact,
        reference,
        submitted_at
      FROM blog_post_proposals
      ${whereClause}
      ORDER BY submitted_at ${sortOrder}
      ${limitClause}
      ${offsetClause}
    `;

    const { rows } = await pool.query<BlogPostProposalRow>(query, params);
    return rows;
  }

  async countProposals(options: { search?: string | null } = {}): Promise<number> {
    const pool = await this.getPool();
    if (!pool) {
      return 0;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.search) {
      params.push(`%${options.search}%`);
      const index = params.length;
      conditions.push(
        `(title ILIKE $${index} OR excerpt ILIKE $${index} OR content_markdown ILIKE $${index} OR author_name ILIKE $${index})`,
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM blog_post_proposals ${whereClause}`,
      params,
    );

    const raw = rows.length > 0 ? Number.parseInt(rows[0].count, 10) : 0;
    return Number.isFinite(raw) ? raw : 0;
  }

  async createProposal(input: BlogPostProposalInput): Promise<void> {
    const pool = await this.getPool();
    if (!pool) {
      throw new Error('Aucune base de données configurée pour enregistrer la proposition.');
    }

    await pool.query(
      `
        INSERT INTO blog_post_proposals (
          slug,
          title,
          excerpt,
          content_markdown,
          cover_image_url,
          tags,
          seo_description,
          author_name,
          author_contact,
          reference,
          submitted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        input.slug,
        input.title,
        input.excerpt,
        input.contentMarkdown,
        input.coverImageUrl,
        input.tags,
        input.seoDescription,
        input.authorName,
        input.authorContact,
        input.reference,
        input.submittedAt,
      ],
    );
  }

  async upsertProposal(input: BlogPostProposalInput): Promise<BlogPostProposalPersistedResult> {
    const pool = await this.getPool();
    if (!pool) {
      return {
        id: null,
        slug: input.slug,
        reference: input.reference,
        submittedAt: input.submittedAt,
      };
    }

    const { rows } = await pool.query<{
      id: number | null;
      slug: string;
      reference: string;
      submitted_at: Date;
    }>(
      `
        INSERT INTO blog_post_proposals (
          slug,
          title,
          excerpt,
          content_markdown,
          cover_image_url,
          tags,
          seo_description,
          author_name,
          author_contact,
          reference,
          submitted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          excerpt = EXCLUDED.excerpt,
          content_markdown = EXCLUDED.content_markdown,
          cover_image_url = EXCLUDED.cover_image_url,
          tags = EXCLUDED.tags,
          seo_description = EXCLUDED.seo_description,
          author_name = EXCLUDED.author_name,
          author_contact = EXCLUDED.author_contact,
          reference = EXCLUDED.reference,
          submitted_at = EXCLUDED.submitted_at
        RETURNING id, slug, reference, submitted_at
      `,
      [
        input.slug,
        input.title,
        input.excerpt,
        input.contentMarkdown,
        input.coverImageUrl,
        input.tags,
        input.seoDescription,
        input.authorName,
        input.authorContact,
        input.reference,
        input.submittedAt,
      ],
    );

    const row = rows[0];
    return {
      id: row?.id ?? null,
      slug: row?.slug ?? input.slug,
      reference: row?.reference ?? input.reference,
      submittedAt: row?.submitted_at ?? input.submittedAt,
    };
  }

  async upsertPost(input: {
    slug: string;
    title: string;
    excerpt: string | null;
    contentMarkdown: string;
    coverImageUrl: string | null;
    tags: string[];
    seoDescription: string | null;
    publishedAt: Date;
    updatedAt: Date;
  }): Promise<void> {
    const pool = await this.getPool();
    if (!pool) {
      return;
    }

    await pool.query(
      `
        INSERT INTO blog_posts (
          slug,
          title,
          excerpt,
          content_markdown,
          cover_image_url,
          tags,
          seo_description,
          published_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          excerpt = EXCLUDED.excerpt,
          content_markdown = EXCLUDED.content_markdown,
          cover_image_url = EXCLUDED.cover_image_url,
          tags = EXCLUDED.tags,
          seo_description = EXCLUDED.seo_description,
          published_at = EXCLUDED.published_at,
          updated_at = EXCLUDED.updated_at
      `,
      [
        input.slug,
        input.title,
        input.excerpt,
        input.contentMarkdown,
        input.coverImageUrl,
        input.tags,
        input.seoDescription,
        input.publishedAt,
        input.updatedAt,
      ],
    );
  }
}
