import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import config from '../config';

let pool: Pool | null = null;

function createPool(): Pool {
  const databaseUrl = config.database?.url;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }

  const poolConfig: PoolConfig = {
    connectionString: databaseUrl,
    ssl: config.database?.ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  };

  const createdPool = new Pool(poolConfig);
  createdPool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error', error);
  });
  return createdPool;
}

function getPool(): Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>,
): Promise<QueryResult<T>> {
  const activePool = getPool();
  if (params) {
    return activePool.query<T>(text, [...params]);
  }
  return activePool.query<T>(text);
}

export async function withClient<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const activePool = getPool();
  const client = await activePool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export function getDatabasePool(): Pool {
  return getPool();
}
