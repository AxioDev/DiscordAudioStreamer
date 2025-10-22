import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import DiscordVectorIngestionService from '../services/DiscordVectorIngestionService';

type DiscordVectorDocument = {
  id: string;
  title: string;
  category: string;
  content: string;
  metadata: Record<string, unknown>;
};

type TestableDiscordVectorIngestionService = {
  collectDocuments(): Promise<DiscordVectorDocument[]>;
  collectHomePageDocuments(): Promise<DiscordVectorDocument[]>;
  prepareDocumentContent(content: string): string;
};

const projectRoot = path.resolve(__dirname, '..', '..');

test('collectDocuments includes sanitized homepage content document', async () => {
  const service = new DiscordVectorIngestionService({
    blogService: null,
    projectRoot,
    voiceActivityRepository: null,
  });
  const testableService = service as unknown as TestableDiscordVectorIngestionService;

  const rawHomeDocuments = await testableService.collectHomePageDocuments();
  assert.ok(rawHomeDocuments.length > 0, 'Homepage collector should yield at least one document');
  const [rawHomeDocument] = rawHomeDocuments;

  const documents: DiscordVectorDocument[] = await testableService.collectDocuments();
  const homepageDocument = documents.find((document) => document.metadata?.source === 'homepage');

  assert.ok(homepageDocument, 'Homepage document should be present in collected documents');
  assert.equal(homepageDocument.category, 'app');
  assert.equal(homepageDocument.metadata?.source, 'homepage');
  assert.equal(homepageDocument.metadata?.path, 'public/scripts/pages/home.js');

  const preparedContent = testableService.prepareDocumentContent(rawHomeDocument.content);
  assert.equal(homepageDocument.content, preparedContent, 'Homepage content should be sanitized via prepareDocumentContent');
});
