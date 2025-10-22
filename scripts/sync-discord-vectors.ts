import path from 'path';

import config from '../src/config';
import BlogRepository from '../src/services/BlogRepository';
import BlogService from '../src/services/BlogService';
import DiscordVectorIngestionService from '../src/services/DiscordVectorIngestionService';
import ShopService from '../src/services/ShopService';
import VoiceActivityRepository from '../src/services/VoiceActivityRepository';

async function main(): Promise<void> {
  if (!config.database?.url) {
    throw new Error('DATABASE_URL must be configured to synchronize discord_vectors.');
  }

  if (!config.openAI?.apiKey) {
    throw new Error('OPENAI_API_KEY must be configured to synchronize discord_vectors.');
  }

  const blogRepository = config.database.url
    ? new BlogRepository({
        url: config.database.url,
        ssl: config.database.ssl,
        debug: config.database.logQueries,
      })
    : null;

  const blogService = new BlogService({
    postsDirectory: path.resolve(__dirname, '..', 'content', 'blog'),
    repository: blogRepository,
  });

  await blogService.initialize();

  const shopService = new ShopService({ config });

  const voiceActivityRepository = new VoiceActivityRepository({
    url: config.database.url,
    ssl: config.database.ssl,
    debug: config.database.logQueries,
  });

  try {
    const ingestionService = new DiscordVectorIngestionService({
      blogService,
      projectRoot: path.resolve(__dirname, '..'),
      shopService,
      voiceActivityRepository,
    });

    await ingestionService.synchronize();
  } finally {
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
