import { promises as fs } from 'fs';
import path from 'path';
import { Command } from 'commander';
import matter from 'gray-matter';
import OpenAI from 'openai';
import { config as loadEnv } from 'dotenv';

loadEnv();

const BLOG_DIRECTORY = path.resolve(process.cwd(), 'content', 'blog');
const OUTPUT_DIRECTORY = path.resolve(process.cwd(), 'public', 'images', 'blog');

interface GenerateOptions {
  dryRun: boolean;
  size: string;
  model: string;
  force: boolean;
}

interface BlogFrontMatter {
  title?: string;
  description?: string;
  cover?: string;
  [key: string]: unknown;
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

program
  .description(
    'Génère des images de couverture pour les articles de blog dépourvus de champ "cover".'
  )
  .option('--dry-run', 'Affiche les actions sans générer d\'image ni modifier les fichiers.', false)
  .option('--force', 'Remplace les couvertures existantes.', false)
  .option('--size <size>', 'Taille à utiliser pour la génération (ex: 1024x576).', '1024x576')
  .option('--model <model>', 'Modèle OpenAI à utiliser pour la génération.', 'gpt-image-1')
  .parse(process.argv);

const options = program.opts<GenerateOptions>();

async function fsStatSafe(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.error(`Impossible de lire ${targetPath} : ${(error as Error).message}`);
    }
    return false;
  }
}

function buildPrompt(frontMatter: BlogFrontMatter, slug: string): string {
  const title = frontMatter.title ?? slug.replace(/-/g, ' ');
  const description = frontMatter.description ?? '';
  return [
    'Illustration éditoriale lumineuse pour un article de blog francophone.',
    `Titre : ${title}.`,
    description ? `Thème : ${description}.` : '',
    'Style : scène réaliste avec touches artistiques, palette chaleureuse, format horizontal 16:9.'
  ]
    .filter(Boolean)
    .join(' ');
}

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

async function updateFrontMatter(filePath: string, data: BlogFrontMatter, content: string): Promise<void> {
  const updated = matter.stringify(content, data);
  await fs.writeFile(filePath, updated, 'utf8');
}

async function processFile(
  filePath: string,
  client: OpenAI,
  generationOptions: GenerateOptions
): Promise<boolean> {
  const rawContent = await fs.readFile(filePath, 'utf8');
  const parsed = matter(rawContent);
  const frontMatter = parsed.data as BlogFrontMatter;
  const slug = path.basename(filePath, path.extname(filePath));

  if (frontMatter.cover && !generationOptions.force) {
    logger.info(`Couverture déjà présente pour « ${slug} », rien à faire.`);
    return false;
  }

  if (frontMatter.cover && generationOptions.force) {
    logger.warn(`Une couverture existante pour « ${slug} » sera remplacée.`);
  }

  if (!frontMatter.title) {
    logger.warn(`Le fichier ${filePath} n'a pas de titre défini, utilisation du slug pour la génération.`);
  }

  const prompt = buildPrompt(frontMatter, slug);
  logger.info(`Génération d'une couverture pour « ${frontMatter.title ?? slug} ». Prompt : ${prompt}`);

  if (generationOptions.dryRun) {
    logger.info('[Mode simulation] Aucune image ne sera générée ni fichier modifié.');
    return false;
  }

  const response = await client.images.generate({
    model: generationOptions.model,
    prompt,
    size: generationOptions.size,
    n: 1,
    response_format: 'b64_json',
  });

  const image = response.data[0]?.b64_json;
  if (!image) {
    logger.error(`Aucune image reçue pour ${filePath}.`);
    return false;
  }

  const { relativePath } = await writeImageFile(slug, image);
  frontMatter.cover = relativePath;
  await updateFrontMatter(filePath, frontMatter, parsed.content);
  logger.success(
    `Couverture enregistrée (${relativePath}) et front matter mis à jour pour ${filePath}.`
  );
  return true;
}

async function gatherMarkdownFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await gatherMarkdownFiles(entryPath)));
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('La variable d\'environnement OPENAI_API_KEY est requise pour générer les images.');
    process.exit(1);
    return;
  }

  if (!(await fsStatSafe(BLOG_DIRECTORY))) {
    process.exit(1);
    return;
  }

  const markdownFiles = await gatherMarkdownFiles(BLOG_DIRECTORY);
  if (markdownFiles.length === 0) {
    logger.warn(`Aucun article Markdown trouvé dans ${BLOG_DIRECTORY}.`);
    return;
  }

  const client = new OpenAI({ apiKey });

  let generatedCount = 0;
  for (const filePath of markdownFiles) {
    try {
      const generated = await processFile(filePath, client, options);
      if (generated) {
        generatedCount += 1;
      }
    } catch (error) {
      logger.error(`Échec lors du traitement de ${filePath} : ${(error as Error).message}`);
    }
  }

  if (!options.dryRun) {
    logger.info(`\n${generatedCount} couverture(s) générée(s) sur ${markdownFiles.length} fichier(s) analysé(s).`);
  } else {
    logger.info(`\nMode simulation terminé : ${markdownFiles.length} fichier(s) analysé(s).`);
  }
}

main().catch((error) => {
  logger.error(`Erreur inattendue : ${(error as Error).message}`);
  process.exit(1);
});
