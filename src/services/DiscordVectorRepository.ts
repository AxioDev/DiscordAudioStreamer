import { query, withClient } from '../lib/db';

const embeddingDimensions = 1536;

export { embeddingDimensions };

export interface DiscordVectorMetadata {
  sourceId?: string;
  contentHash?: string;
  [key: string]: unknown;
}

interface DiscordVectorExistingRow {
  id: number;
  metadata: DiscordVectorMetadata | null;
}

interface PostgresError extends Error {
  code?: string;
}

let ensureTablePromise: Promise<void> | null = null;

export class PgvectorExtensionRequiredError extends Error {
  public readonly reason = 'PGVECTOR_EXTENSION_REQUIRED';

  public readonly originalError: unknown;

  constructor(options?: { cause?: unknown }) {
    super('The pgvector extension must be installed to store embeddings (missing type "vector").');
    this.name = 'PgvectorExtensionRequiredError';
    this.originalError = options?.cause;
  }
}

async function hasPgvectorExtension(): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists;`,
  );

  return result.rows[0]?.exists === true;
}

export async function ensureDiscordVectorSchema(): Promise<void> {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      let createExtensionError: unknown;
      try {
        await query('CREATE EXTENSION IF NOT EXISTS vector;');
      } catch (error) {
        createExtensionError = error;
        console.warn('Failed to ensure pgvector extension; proceeding to verify availability.', error);
      }

      let extensionAvailable = false;
      let extensionCheckError: unknown;
      try {
        extensionAvailable = await hasPgvectorExtension();
      } catch (error) {
        extensionCheckError = error;
        console.warn('Failed to verify pgvector extension availability.', error);
      }

      if (!extensionAvailable) {
        throw new PgvectorExtensionRequiredError({ cause: extensionCheckError ?? createExtensionError });
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
          throw new PgvectorExtensionRequiredError({ cause: postgresError });
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

export function buildVectorLiteral(values: readonly number[]): string {
  return `[${values.map((value) => Number(value).toString()).join(',')}]`;
}

export async function listDiscordVectorMetadata(): Promise<DiscordVectorExistingRow[]> {
  const result = await query<DiscordVectorExistingRow>(
    `SELECT id, metadata FROM discord_vectors WHERE metadata IS NOT NULL;`,
  );
  return result.rows;
}

export async function getDiscordVectorCount(): Promise<number> {
  try {
    const result = await query<{ count: string | number | bigint }>(
      `SELECT COUNT(*)::bigint AS count FROM discord_vectors;`,
    );
    const rawCount = result.rows[0]?.count ?? 0;
    if (typeof rawCount === 'number' && Number.isFinite(rawCount)) {
      return Math.max(0, Math.floor(rawCount));
    }
    if (typeof rawCount === 'bigint') {
      return Math.max(0, Number(rawCount));
    }
    if (typeof rawCount === 'string') {
      const parsed = Number.parseInt(rawCount, 10);
      if (Number.isFinite(parsed)) {
        return Math.max(0, parsed);
      }
    }
    const fallback = Number(rawCount);
    if (Number.isFinite(fallback)) {
      return Math.max(0, Math.floor(fallback));
    }
    return 0;
  } catch (error) {
    const postgresError = error as PostgresError;
    if (postgresError?.code === '42P01') {
      return 0;
    }
    throw error;
  }
}

export async function deleteDiscordVectorsByIds(ids: readonly number[]): Promise<void> {
  if (!ids.length) {
    return;
  }
  await query('DELETE FROM discord_vectors WHERE id = ANY($1::bigint[])', [ids]);
}

interface InsertDiscordVectorRow {
  content: string;
  metadata: Record<string, unknown> | null;
  vectorLiteral: string;
}

export async function insertDiscordVectors(rows: readonly InsertDiscordVectorRow[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await withClient(async (client) => {
    const text = `INSERT INTO discord_vectors (content, metadata, embedding)
      VALUES ($1, $2::jsonb, $3::vector);`;

    for (const row of rows) {
      await client.query(text, [row.content, row.metadata ? JSON.stringify(row.metadata) : null, row.vectorLiteral]);
    }
  });
}
