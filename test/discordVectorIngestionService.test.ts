import assert from 'node:assert/strict';
import path from 'path';

import type ShopService from '../src/services/ShopService';
import type { PublicProduct } from '../src/services/ShopService';
import { SHOP_CONTENT } from '../src/content/shop';

async function main(): Promise<void> {
  process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test-token';

  const { default: DiscordVectorIngestionService } = await import('../src/services/DiscordVectorIngestionService');

  const mockProducts: PublicProduct[] = [
    {
      id: 'test-product',
      name: 'Pack Nuit Libre',
      description: 'Pack complet microphone et accessoires pour des libres antennes de nuit.',
      price: { amount: 49.9, currency: 'EUR', formatted: '49,90 €' },
      includes: [
        'Microphone cardioïde avec filtre anti-pop',
        'Bras articulé silencieux',
        'Kit de câblage prêt à brancher',
      ],
      shippingEstimate: 'Expédition sous 3 à 5 jours ouvrés',
      badges: ['Edition limitée', 'Testé par la régie'],
      accent: '',
      accentSoft: '',
      emoji: '🌙',
      highlight: true,
      providers: ['stripe', 'paypal'],
      image: null,
      updatedAt: '2024-11-01T12:00:00.000Z',
    },
  ];

  const mockShopService = {
    getProducts: () => mockProducts,
  } as unknown as ShopService;

  const ingestionService = new DiscordVectorIngestionService({
    blogService: null,
    projectRoot: path.resolve(__dirname, '..'),
    shopService: mockShopService,
    voiceActivityRepository: null,
  });

  const stubbedService = ingestionService as unknown as {
    collectDocuments: () => Promise<any[]>;
    collectBlogDocuments: () => Promise<any[]>;
    collectMarkdownDocuments: () => Promise<any[]>;
    collectJsonDocuments: () => Promise<any[]>;
    loadKnownUsers: () => Promise<any[]>;
    collectVoiceTranscriptionDocuments: () => Promise<any[]>;
    collectMessageDocuments: () => Promise<any[]>;
    collectVoiceActivityDocuments: () => Promise<any[]>;
    collectPersonaDocuments: () => Promise<any[]>;
  };

  stubbedService.collectBlogDocuments = async () => [];
  stubbedService.collectMarkdownDocuments = async () => [];
  stubbedService.collectJsonDocuments = async () => [];
  stubbedService.loadKnownUsers = async () => [];
  (stubbedService as any).collectUserDocuments = () => [];
  stubbedService.collectVoiceTranscriptionDocuments = async () => [];
  stubbedService.collectMessageDocuments = async () => [];
  stubbedService.collectVoiceActivityDocuments = async () => [];
  stubbedService.collectPersonaDocuments = async () => [];

  const documents = await stubbedService.collectDocuments();
  const shopDocuments = documents.filter((doc) => doc.metadata?.source === 'shop');

  assert.ok(shopDocuments.length >= 4, 'Les documents de la boutique devraient être présents.');

  const heroDocument = shopDocuments.find((doc) => doc.id === 'shop:hero');
  assert.ok(heroDocument, 'Le document héros de la boutique est manquant.');
  assert.ok(
    heroDocument.content.includes(SHOP_CONTENT.hero.description),
    'Le contenu du héros doit reprendre la description centralisée.',
  );

  const verifiedPaymentsDocument = shopDocuments.find((doc) => doc.id === 'shop:section:verified-payments');
  const cryptoFriendlyDocument = shopDocuments.find((doc) => doc.id === 'shop:section:crypto-friendly');
  assert.ok(verifiedPaymentsDocument, 'Le document Paiements vérifiés est manquant.');
  assert.ok(cryptoFriendlyDocument, 'Le document Crypto friendly est manquant.');

  const productDocument = shopDocuments.find((doc) => doc.id === 'shop:product:test-product');
  assert.ok(productDocument, 'Le document produit est manquant.');
  assert.equal(productDocument.metadata.productId, 'test-product');
  assert.ok(
    productDocument.content.includes('Pack complet microphone et accessoires'),
    'Le document produit devrait inclure la description marketing.',
  );
  assert.ok(
    productDocument.content.includes('Dernière mise à jour : 2024-11-01T12:00:00.000Z'),
    'Le document produit devrait inclure la date de mise à jour.',
  );

  console.log('DiscordVectorIngestionService shop ingestion test passed.');
}

void main().catch((error) => {
  console.error('DiscordVectorIngestionService shop ingestion test failed.', error);
  process.exitCode = 1;
});
