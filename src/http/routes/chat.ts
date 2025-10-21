import type { Application, Request, Response } from 'express';
import config from '../../config';
import { query } from '../../lib/db';
import { generateAnswer, getEmbedding } from '../../lib/openai';

interface DiscordVectorRow {
  content: string;
  metadata: Record<string, unknown> | null;
}

interface PostgresError extends Error {
  code?: string;
}

const embeddingDimensions = 1536;
let ensureTablePromise: Promise<void> | null = null;

async function ensureDiscordVectorsTable(): Promise<void> {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      try {
        await query('CREATE EXTENSION IF NOT EXISTS vector;');
      } catch (error) {
        console.warn('Failed to ensure pgvector extension; proceeding without creating extension.', error);
      }

      try {
        await query(
          `CREATE TABLE IF NOT EXISTS discord_vectors (
            id BIGSERIAL PRIMARY KEY,
            content TEXT NOT NULL,
            metadata JSONB,
            embedding vector(${embeddingDimensions}) NOT NULL
          );`,
        );
      } catch (error) {
        const postgresError = error as PostgresError;
        if (postgresError?.code === '42704') {
          throw new Error(
            'The pgvector extension must be installed to store embeddings (missing type "vector").',
          );
        }
        throw error;
      }

      try {
        await query(
          `CREATE INDEX IF NOT EXISTS discord_vectors_embedding_idx
            ON discord_vectors USING ivfflat (embedding vector_cosine_ops);`,
        );
      } catch (error) {
        console.warn('Failed to ensure discord_vectors ivfflat index; continuing without index.', error);
      }
    })().catch((error) => {
      ensureTablePromise = null;
      throw error;
    });
  }

  await ensureTablePromise;
}

function buildVectorLiteral(values: readonly number[]): string {
  return `[${values.map((value) => Number(value).toString()).join(',')}]`;
}

function buildContextFromRows(rows: readonly DiscordVectorRow[]): string {
  if (rows.length === 0) {
    return '';
  }

  return rows
    .map((row, index) => {
      const metadataLabel = row.metadata ? `\nMETADONNÉES : ${JSON.stringify(row.metadata)}` : '';
      return `Passage ${index + 1} :\n${row.content.trim()}${metadataLabel}`.trim();
    })
    .join('\n\n');
}

export function registerChatRoute(app: Application): void {
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
    if (!messageRaw) {
      res.status(400).json({
        error: 'MESSAGE_REQUIRED',
        message: 'Le message utilisateur est requis.',
      });
      return;
    }

    try {
      await ensureDiscordVectorsTable();
      const embedding = await getEmbedding(messageRaw);
      const vectorLiteral = buildVectorLiteral(embedding);
      const result = await query<DiscordVectorRow>(
        `SELECT content, metadata FROM discord_vectors ORDER BY embedding <-> $1 LIMIT 5;`,
        [vectorLiteral],
      );

      const context = buildContextFromRows(result.rows);
      const answer = await generateAnswer(context, messageRaw);

      res.status(200).json({ answer });
    } catch (error) {
      console.error('Failed to process /api/chat request', error);
      res.status(500).json({
        error: 'CHAT_COMPLETION_FAILED',
        message: "Impossible de générer une réponse pour l'instant.",
      });
    }
  });
}
