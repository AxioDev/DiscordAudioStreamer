import path from 'path';

import type { Config } from '../src/config';

type BlogRepositoryConstructor = typeof import('../src/services/BlogRepository').default;
type BlogServiceConstructor = typeof import('../src/services/BlogService').default;
type DiscordVectorIngestionServiceConstructor = typeof import('../src/services/DiscordVectorIngestionService').default;
type ShopServiceConstructor = typeof import('../src/services/ShopService').default;
type VoiceActivityRepositoryConstructor = typeof import('../src/services/VoiceActivityRepository').default;
type BlogModerationServiceConstructor = typeof import('../src/services/BlogModerationService').default;

const TOTAL_STEPS = 7;

function logStep(step: number, message: string): void {
  console.log(`[sync:vectors] [${step}/${TOTAL_STEPS}] ${message}`);
}

function logInfo(message: string): void {
  console.log(`[sync:vectors] ${message}`);
}

async function main(): Promise<void> {
  process.env.ALLOW_MISSING_BOT_TOKEN = process.env.ALLOW_MISSING_BOT_TOKEN ?? '1';

  const [
    configModule,
    blogRepositoryModule,
    blogServiceModule,
    ingestionServiceModule,
    shopServiceModule,
    voiceActivityRepositoryModule,
    blogModerationServiceModule,
  ] = await Promise.all([
    import('../src/config'),
    import('../src/services/BlogRepository'),
    import('../src/services/BlogService'),
    import('../src/services/DiscordVectorIngestionService'),
    import('../src/services/ShopService'),
    import('../src/services/VoiceActivityRepository'),
    import('../src/services/BlogModerationService'),
  ]);

  const config = configModule.default as Config;
  const BlogRepository = blogRepositoryModule.default as BlogRepositoryConstructor;
  const BlogService = blogServiceModule.default as BlogServiceConstructor;
  const DiscordVectorIngestionService =
    ingestionServiceModule.default as DiscordVectorIngestionServiceConstructor;
  const ShopService = shopServiceModule.default as ShopServiceConstructor;
  const VoiceActivityRepository = voiceActivityRepositoryModule.default as VoiceActivityRepositoryConstructor;
  const BlogModerationService = blogModerationServiceModule.default as BlogModerationServiceConstructor;

  logInfo('Initialisation de la synchronisation des vecteurs Discord.');

  logStep(1, 'Vérification de la configuration de la base de données…');
  if (!config.database?.url) {
    throw new Error('DATABASE_URL must be configured to synchronize discord_vectors.');
  }

  logStep(2, 'Vérification de la configuration OpenAI…');
  if (!config.openAI?.apiKey) {
    throw new Error('OPENAI_API_KEY must be configured to synchronize discord_vectors.');
  }

  logStep(3, 'Préparation des services de blog…');
  const blogRepository = config.database.url
    ? new BlogRepository({
        url: config.database.url,
        ssl: config.database.ssl,
        debug: config.database.logQueries,
      })
    : null;

  const blogModerationService = new BlogModerationService();

  const blogService = new BlogService({
    postsDirectory: path.resolve(__dirname, '..', 'content', 'blog'),
    repository: blogRepository,
    moderationService: blogModerationService,
  });

  logInfo('Initialisation du service de blog…');
  await blogService.initialize();
  logInfo('Service de blog initialisé.');

  logStep(4, 'Préparation du service boutique…');
  const shopService = new ShopService({ config });

  logStep(5, 'Connexion au dépôt d’activité vocale…');
  const voiceActivityRepository = new VoiceActivityRepository({
    url: config.database.url,
    ssl: config.database.ssl,
    debug: config.database.logQueries,
  });

  try {
    logStep(6, 'Création du service d’ingestion des vecteurs…');
    const ingestionService = new DiscordVectorIngestionService({
      blogService,
      projectRoot: path.resolve(__dirname, '..'),
      shopService,
      voiceActivityRepository,
    });

    logStep(7, 'Synchronisation des vecteurs en base…');
    await ingestionService.synchronize();
  } finally {
    logInfo('Fermeture du dépôt d’activité vocale.');
    await voiceActivityRepository.close();
  }
}

void main()
  .then(() => {
    console.log('discord_vectors table synchronized successfully.');
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('Failed to synchronize discord_vectors table.', error);
    process.exit(1);
  });
