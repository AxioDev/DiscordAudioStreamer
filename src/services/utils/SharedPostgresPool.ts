import { Pool, type PoolConfig } from 'pg';

export interface SharedPostgresPoolOptions {
  connectionString: string;
  ssl: boolean;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
}

export interface SharedPostgresPoolResult {
  pool: Pool;
  isNew: boolean;
  release: () => Promise<void>;
}

interface CachedPoolEntry {
  pool: Pool;
  refCount: number;
}

const poolCache = new Map<string, CachedPoolEntry>();

function resolvePoolConfig(options: SharedPostgresPoolOptions): PoolConfig {
  const { connectionString, ssl, poolConfig } = options;
  const resolved: PoolConfig = {
    connectionString,
    ...poolConfig,
  };

  if (typeof resolved.ssl === 'undefined') {
    resolved.ssl = ssl ? { rejectUnauthorized: false } : undefined;
  }

  return resolved;
}

function serializePoolConfig(config: PoolConfig): string {
  const entries = Object.entries(config).filter(([key]) => key !== 'connectionString');
  const sanitized = entries.map(([key, value]) => {
    if (typeof value === 'function') {
      return [key, `__function:${value.name || 'anonymous'}`];
    }
    return [key, value];
  });
  sanitized.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sanitized);
}

function getPoolCacheKey(options: SharedPostgresPoolOptions, config: PoolConfig): string {
  return `${options.connectionString}|${serializePoolConfig(config)}`;
}

function createRelease(cacheKey: string, entry: CachedPoolEntry): () => Promise<void> {
  let released = false;

  return async () => {
    if (released) {
      return;
    }

    released = true;
    entry.refCount -= 1;

    if (entry.refCount <= 0) {
      poolCache.delete(cacheKey);
      try {
        await entry.pool.end();
      } catch (error) {
        console.error('Failed to close shared PostgreSQL connection pool', error);
      }
    }
  };
}

export function getSharedPostgresPool(options: SharedPostgresPoolOptions): SharedPostgresPoolResult {
  const resolvedConfig = resolvePoolConfig(options);
  const cacheKey = getPoolCacheKey(options, resolvedConfig);

  const existingEntry = poolCache.get(cacheKey);
  if (existingEntry) {
    existingEntry.refCount += 1;
    return {
      pool: existingEntry.pool,
      isNew: false,
      release: createRelease(cacheKey, existingEntry),
    };
  }

  const pool = new Pool(resolvedConfig);
  const entry: CachedPoolEntry = { pool, refCount: 1 };
  poolCache.set(cacheKey, entry);

  pool.once('end', () => {
    const cached = poolCache.get(cacheKey);
    if (cached && cached.pool === pool) {
      poolCache.delete(cacheKey);
    }
  });

  return { pool, isNew: true, release: createRelease(cacheKey, entry) };
}
