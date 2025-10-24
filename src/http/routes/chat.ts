import type { Application, Request, Response } from 'express';
import config from '../../config';
import { query } from '../../lib/db';
import { generateAnswer, getEmbedding, type ConversationMessage } from '../../lib/openai';
import {
  buildVectorLiteral,
  ensureDiscordVectorSchema,
  getDiscordVectorCount,
  PgvectorExtensionRequiredError,
} from '../../services/DiscordVectorRepository';

interface DiscordVectorRow {
  content: string;
  metadata: Record<string, unknown> | null;
}

const VECTOR_RESULT_LIMIT = 8;

function sanitizeMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) {
    return '';
  }

  const lines: string[] = [];
  const stringFields: Array<[keyof Record<string, unknown>, string]> = [
    ['source', 'Source'],
    ['title', 'Titre'],
    ['channel', 'Salon'],
    ['channelName', 'Salon'],
    ['author', 'Auteur'],
    ['username', 'Auteur'],
    ['messageUrl', 'Lien'],
    ['url', 'Lien'],
  ];

  const normalizedMetadata: Record<string, unknown> = { ...metadata };
  for (const [key, label] of stringFields) {
    const value = normalizedMetadata[key];
    if (typeof value === 'string' && value.trim()) {
      lines.push(`${label} : ${value}`);
      delete normalizedMetadata[key];
    }
  }

  const arrayFields: Array<[keyof Record<string, unknown>, string]> = [
    ['tags', 'Mots-clés'],
    ['roles', 'Rôles'],
  ];

  for (const [key, label] of arrayFields) {
    const value = normalizedMetadata[key];
    if (Array.isArray(value) && value.length > 0) {
      const formatted = value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean)
        .join(', ');
      if (formatted) {
        lines.push(`${label} : ${formatted}`);
      }
      delete normalizedMetadata[key];
    }
  }

  if (typeof normalizedMetadata.createdAt === 'string') {
    lines.push(`Créé le : ${normalizedMetadata.createdAt}`);
    delete normalizedMetadata.createdAt;
  }

  if (typeof normalizedMetadata.updatedAt === 'string') {
    lines.push(`Mis à jour le : ${normalizedMetadata.updatedAt}`);
    delete normalizedMetadata.updatedAt;
  }

  const remainingKeys = Object.keys(normalizedMetadata).filter((key) => normalizedMetadata[key] != null);
  if (remainingKeys.length > 0) {
    lines.push(`Autres métadonnées : ${JSON.stringify(normalizedMetadata)}`);
  }

  return lines.join('\n');
}

function buildContextFromRows(rows: readonly DiscordVectorRow[]): string {
  if (rows.length === 0) {
    return '';
  }

  const seenContents = new Set<string>();

  return rows
    .map((row) => ({
      content: row.content.trim(),
      metadata: sanitizeMetadata(row.metadata),
    }))
    .filter(({ content }) => {
      const normalized = content.toLowerCase();
      if (seenContents.has(normalized)) {
        return false;
      }
      seenContents.add(normalized);
      return Boolean(content);
    })
    .map(({ content, metadata }, index) => {
      const metadataBlock = metadata ? `\n${metadata}` : '';
      return `Passage ${index + 1} :\n${content}${metadataBlock}`.trim();
    })
    .join('\n\n');
}

function normalizeConversation(rawConversation: unknown): ConversationMessage[] {
  if (!Array.isArray(rawConversation)) {
    return [];
  }

  const normalized: ConversationMessage[] = [];
  for (const entry of rawConversation) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const { role } = entry as Partial<ConversationMessage>;
    const rawContent = (entry as Partial<ConversationMessage>).content;
    const content = typeof rawContent === 'string' ? rawContent.trim() : '';

    if ((role === 'user' || role === 'assistant') && content) {
      normalized.push({ role, content });
    }
  }

  return normalized.slice(-10);
}

function buildEmbeddingInput(message: string, conversation: ConversationMessage[]): string {
  if (conversation.length === 0) {
    return message;
  }

  const historySnippet = conversation
    .slice(-6)
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'Utilisateur'} : ${entry.content}`)
    .join('\n');

  return `${historySnippet}\nQuestion actuelle : ${message}`.trim();
}

export function registerChatRoute(app: Application): void {
  app.get('/api/chat/status', async (_req: Request, res: Response) => {
    if (!config.database?.url) {
      res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: "La base de données n'est pas configurée.",
      });
      return;
    }

    try {
      await ensureDiscordVectorSchema();
      const vectorCount = await getDiscordVectorCount();
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
      res.status(200).json({ vectorCount });
    } catch (error) {
      if (error instanceof PgvectorExtensionRequiredError) {
        console.error(
          'Pgvector extension is required for /api/chat/status request',
          error.originalError ?? error,
        );
        res.status(503).json({
          error: error.reason,
          message:
            "L'extension PostgreSQL pgvector doit être installée et accessible pour activer la fonctionnalité de chat.",
        });
        return;
      }

      console.error('Failed to compute /api/chat/status response', error);
      res.status(500).json({
        error: 'CHAT_STATUS_UNAVAILABLE',
        message: 'Impossible de vérifier la base documentaire pour le moment.',
      });
    }
  });

  app.post('/api/chat', async (req: Request, res: Response) => {
    if (!config.database?.url) {
      res.status(503).json({
        error: 'DATABASE_UNAVAILABLE',
        message: "La base de données n'est pas configurée.",
      });
      return;
    }

    if (!config.openAI?.apiKey) {
      res.status(503).json({
        error: 'OPENAI_UNAVAILABLE',
        message: "La clé d'API OpenAI n'est pas configurée.",
      });
      return;
    }

    const messageRaw = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const conversation = normalizeConversation(req.body?.conversation);
    if (!messageRaw) {
      res.status(400).json({
        error: 'MESSAGE_REQUIRED',
        message: 'Le message utilisateur est requis.',
      });
      return;
    }

    try {
      await ensureDiscordVectorSchema();
      const embeddingInput = buildEmbeddingInput(messageRaw, conversation);
      const embedding = await getEmbedding(embeddingInput);
      const vectorLiteral = buildVectorLiteral(embedding);
      const result = await query<DiscordVectorRow>(
        `SELECT content, metadata FROM discord_vectors ORDER BY embedding <-> $1 LIMIT ${VECTOR_RESULT_LIMIT};`,
        [vectorLiteral],
      );

      const context = buildContextFromRows(result.rows);
      const answer = await generateAnswer(context, messageRaw, conversation);

      res.status(200).json({ answer });
    } catch (error) {
      if (error instanceof PgvectorExtensionRequiredError) {
        console.error('Pgvector extension is required for /api/chat request', error.originalError ?? error);
        res.status(503).json({
          error: error.reason,
          message:
            "L'extension PostgreSQL pgvector doit être installée et accessible pour activer la fonctionnalité de chat.",
        });
        return;
      }

      console.error('Failed to process /api/chat request', error);
      res.status(500).json({
        error: 'CHAT_COMPLETION_FAILED',
        message: "Impossible de générer une réponse pour l'instant.",
      });
    }
  });
}
