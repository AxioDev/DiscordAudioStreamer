import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { aboutPageContent } from '../../content/about';

test('collectDocuments inclut la page À propos et respecte la longueur maximale', async () => {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test-token';
  const { default: DiscordVectorIngestionService } = await import('../DiscordVectorIngestionService');
  const service = new DiscordVectorIngestionService({
    blogService: null,
    projectRoot: path.resolve(__dirname, '..', '..', '..'),
    shopService: null,
    voiceActivityRepository: null,
  });

  const documents = await (service as unknown as {
    collectDocuments(): Promise<
      Array<{
        metadata: Record<string, unknown>;
        title: string;
        content: string;
      }>
    >;
  }).collectDocuments();
  const aboutDocument = documents.find((document) => {
    const metadata = document.metadata as { source?: unknown };
    return metadata?.source === 'about';
  });

  assert.ok(aboutDocument, 'Le document de la page À propos doit être synchronisé.');
  assert.equal(aboutDocument.title, aboutPageContent.hero.title);

  const metadata = aboutDocument.metadata as { highlights?: unknown; source?: unknown };
  assert.equal(metadata?.source, 'about');

  const highlightTitles = Array.isArray(metadata?.highlights)
    ? (metadata.highlights as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  for (const highlight of aboutPageContent.highlights) {
    assert.ok(
      highlightTitles.includes(highlight.title),
      `Le point saillant « ${highlight.title} » doit être référencé dans les métadonnées.`,
    );
  }

  assert.ok(
    aboutDocument.content.length <= 8000,
    `Le contenu doit être tronqué à 8000 caractères au maximum (reçu: ${aboutDocument.content.length}).`,
  );
});
