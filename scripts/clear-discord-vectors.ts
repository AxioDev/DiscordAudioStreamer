import type { Pool } from 'pg';

import config from '../src/config';
import { getDatabasePool, query } from '../src/lib/db';
import { ensureDiscordVectorSchema } from '../src/services/DiscordVectorRepository';

let pool: Pool | null = null;

async function main(): Promise<void> {
  if (!config.database?.url) {
    throw new Error('DATABASE_URL must be configured to clear discord_vectors.');
  }

  pool = getDatabasePool();

  await ensureDiscordVectorSchema();

  console.log('Clearing discord_vectors table...');
  const result = await query('DELETE FROM discord_vectors;');
  const deletedCount = result.rowCount ?? 0;

  console.log(`Removed ${deletedCount} vector entr${deletedCount === 1 ? 'y' : 'ies'}.`);
}

async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}

void main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error('Failed to clear discord_vectors table.', error);
    try {
      await closePool();
    } catch (poolError) {
      console.error('Failed to close PostgreSQL connection pool after error.', poolError);
    }
    process.exit(1);
  });
