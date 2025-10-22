import { Pool, type PoolConfig } from 'pg';

export interface SharedPostgresPoolOptions {
  connectionString: string;
  ssl: boolean;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
}

export interface SharedPostgresPoolResult {
  pool: Pool;
  isNew: boolean;
}

const poolCache = new Map<string, Pool>();

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

export function getSharedPostgresPool(options: SharedPostgresPoolOptions): SharedPostgresPoolResult {
  const resolvedConfig = resolvePoolConfig(options);
  const cacheKey = getPoolCacheKey(options, resolvedConfig);

  const existingPool = poolCache.get(cacheKey);
  if (existingPool) {
    return { pool: existingPool, isNew: false };
  }

  const pool = new Pool(resolvedConfig);
  poolCache.set(cacheKey, pool);

  pool.once('end', () => {
    const cached = poolCache.get(cacheKey);
    if (cached === pool) {
      poolCache.delete(cacheKey);
    }
  });

  return { pool, isNew: true };
}
