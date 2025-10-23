import { promises as fs } from 'fs';
import path from 'path';
import { Command } from 'commander';
import OpenAI from 'openai';
import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv();

const OUTPUT_DIRECTORY = path.resolve(process.cwd(), 'public', 'images', 'blog');

type ImageGenerationSize =
  | 'auto'
  | '1024x1024'
  | '1536x1024'
  | '1024x1536'
  | '256x256'
  | '512x512'
  | '1792x1024'
  | '1024x1792';

interface GenerateOptions {
  dryRun: boolean;
  size: ImageGenerationSize;
  model: string;
  force: boolean;
}

interface CliOptions {
  dryRun: boolean;
  size: string;
  model: string;
  force: boolean;
}

interface BlogPostRecord {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  content_markdown: string;
  cover_image_url: string | null;
}

const logger = {
  info(message: string): void {
    console.log(`\u001b[36m[INFO]\u001b[0m ${message}`);
  },
  success(message: string): void {
    console.log(`\u001b[32m[SUCCESS]\u001b[0m ${message}`);
  },
  warn(message: string): void {
    console.warn(`\u001b[33m[WARN]\u001b[0m ${message}`);
  },
  error(message: string): void {
    console.error(`\u001b[31m[ERROR]\u001b[0m ${message}`);
  },
};

const program = new Command();

const VALID_IMAGE_SIZES: ReadonlySet<ImageGenerationSize> = new Set([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '256x256',
  '512x512',
  '1792x1024',
  '1024x1792',
]);

const DEFAULT_IMAGE_SIZE: ImageGenerationSize = '1024x1024';

program
  .description(
    'Génère des images de couverture pour les articles de blog dépourvus de champ "cover".'
  )
  .option('--dry-run', 'Affiche les actions sans générer d\'image ni modifier les fichiers.', false)
  .option('--force', 'Remplace les couvertures existantes.', false)
  .option(
    '--size <size>',
    `Taille à utiliser pour la génération (${Array.from(VALID_IMAGE_SIZES).join(', ')}).`,
    DEFAULT_IMAGE_SIZE
  )
  .option('--model <model>', 'Modèle OpenAI à utiliser pour la génération.', 'gpt-image-1')
  .parse(process.argv);

const rawOptions = program.opts<CliOptions>();

function normalizeSize(sizeInput: string | undefined): ImageGenerationSize {
  if (sizeInput && VALID_IMAGE_SIZES.has(sizeInput as ImageGenerationSize)) {
    return sizeInput as ImageGenerationSize;
  }
  logger.warn(
    `Taille "${sizeInput ?? 'non définie'}" invalide. Les valeurs acceptées sont : ${Array.from(
      VALID_IMAGE_SIZES
    ).join(', ')}. Utilisation de ${DEFAULT_IMAGE_SIZE}.`
  );
  return DEFAULT_IMAGE_SIZE;
}

const options: GenerateOptions = {
  dryRun: rawOptions.dryRun,
  force: rawOptions.force,
  model: rawOptions.model,
  size: normalizeSize(rawOptions.size),
};

const parseBoolean = (value: string | undefined | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

async function ensureOutputDirectory(): Promise<void> {
  await fs.mkdir(OUTPUT_DIRECTORY, { recursive: true });
}

async function writeImageFile(slug: string, imageBase64: string): Promise<{ absolutePath: string; relativePath: string }> {
  await ensureOutputDirectory();
  const fileName = `${slug}-cover.png`;
  const absolutePath = path.join(OUTPUT_DIRECTORY, fileName);
  const relativePath = path.posix.join('/images/blog', fileName);
  const buffer = Buffer.from(imageBase64, 'base64');
  await fs.writeFile(absolutePath, buffer);
  return { absolutePath, relativePath };
}

function sanitizeDescription(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const trimmed = input.length > 1000 ? input.slice(0, 1000) : input;
  const withoutMarkdown = trimmed
    .replace(/`{1,3}[^`]*`/g, '')
    .replace(/[*_~>#\[\](!)]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutMarkdown) {
    return null;
  }
  return withoutMarkdown.length > 280 ? `${withoutMarkdown.slice(0, 277).trim()}…` : withoutMarkdown;
}

function buildPrompt(post: BlogPostRecord): string {
  const normalizedTitle = typeof post.title === 'string' ? post.title.trim() : '';
  const title = normalizedTitle.length > 0 ? normalizedTitle : post.slug.replace(/-/g, ' ');
  const description = sanitizeDescription(post.excerpt) ?? sanitizeDescription(post.content_markdown) ?? '';
  return [
    'Illustration éditoriale lumineuse pour un article de blog francophone.',
    `Titre : ${title}.`,
    description ? `Thème : ${description}.` : '',
    'Style : scène réaliste avec touches artistiques, palette chaleureuse, format horizontal 16:9.'
  ]
    .filter(Boolean)
    .join(' ');
}

async function updateCoverInDatabase(pool: Pool, postId: number, coverUrl: string): Promise<void> {
  await pool.query('UPDATE blog_posts SET cover_image_url = $1, updated_at = NOW() WHERE id = $2', [coverUrl, postId]);
}

async function fetchPosts(pool: Pool, force: boolean): Promise<BlogPostRecord[]> {
  const conditions = force
    ? ''
    : "WHERE cover_image_url IS NULL OR TRIM(cover_image_url) = ''";

  const baseQuery = `
    SELECT
      id,
      slug,
      title,
      excerpt,
      content_markdown,
      cover_image_url
    FROM blog_posts
    ${conditions}
    ORDER BY published_at ASC, id ASC
  `;

  const { rows } = await pool.query<BlogPostRecord>(baseQuery);
  return rows;
}

async function processPost(
  post: BlogPostRecord,
  client: OpenAI,
  pool: Pool,
  generationOptions: GenerateOptions
): Promise<boolean> {
  if (post.cover_image_url && !generationOptions.force) {
    logger.info(`Couverture déjà présente pour « ${post.slug} », rien à faire.`);
    return false;
  }

  if (post.cover_image_url && generationOptions.force) {
    logger.warn(`Une couverture existante pour « ${post.slug} » sera remplacée.`);
  }

  const prompt = buildPrompt(post);
  const displayTitle = typeof post.title === 'string' && post.title.trim().length > 0 ? post.title.trim() : post.slug;
  logger.info(`Génération d'une couverture pour « ${displayTitle} ». Prompt : ${prompt}`);

  if (generationOptions.dryRun) {
    logger.info('[Mode simulation] Aucune image ne sera générée ni base de données modifiée.');
    return false;
  }

  const requestOptions: Parameters<typeof client.images.generate>[0] = {
    model: generationOptions.model,
    prompt,
    size: generationOptions.size,
    n: 1,
  };

  if (/^dall-e-/i.test(generationOptions.model)) {
    requestOptions.response_format = 'b64_json';
  }

  const response = await client.images.generate(requestOptions);

  const imageData = response.data;
  if (!imageData?.length) {
    logger.error(`Aucune image reçue pour ${post.slug}.`);
    return false;
  }

  const image = imageData[0]?.b64_json;
  if (!image) {
    logger.error(`Aucune image reçue pour ${post.slug}.`);
    return false;
  }

  const { relativePath } = await writeImageFile(post.slug, image);
  await updateCoverInDatabase(pool, post.id, relativePath);
  logger.success(`Couverture enregistrée (${relativePath}) pour l'article « ${post.slug} ».`);
  return true;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('La variable d\'environnement OPENAI_API_KEY est requise pour générer les images.');
    process.exit(1);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('DATABASE_URL doit être défini pour générer des couvertures depuis la base de données.');
    process.exit(1);
    return;
  }

  const useSsl = parseBoolean(process.env.DATABASE_SSL);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  const client = new OpenAI({ apiKey });

  try {
    const posts = await fetchPosts(pool, options.force);
    if (posts.length === 0) {
      if (options.force) {
        logger.info('Aucun article trouvé dans la base de données.');
      } else {
        logger.info('Aucun article sans couverture trouvé dans la base de données.');
      }
      return;
    }

    let generatedCount = 0;
    for (const post of posts) {
      try {
        const generated = await processPost(post, client, pool, options);
        if (generated) {
          generatedCount += 1;
        }
      } catch (error) {
        logger.error(`Échec lors du traitement de ${post.slug} : ${(error as Error).message}`);
      }
    }

    if (!options.dryRun) {
      logger.info(`\n${generatedCount} couverture(s) générée(s) sur ${posts.length} article(s) analysé(s).`);
    } else {
      logger.info(`\nMode simulation terminé : ${posts.length} article(s) analysé(s).`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  logger.error(`Erreur inattendue : ${(error as Error).message}`);
  process.exit(1);
});
