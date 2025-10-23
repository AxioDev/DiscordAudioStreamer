import type { Pool } from 'pg';
import { getDatabasePool } from '../lib/db';

interface QueryRow<T> {
  value: T;
  expires_at: Date | null;
}

export default class DatabaseCache {
  private static tableEnsured = false;

  private static ensuringTable: Promise<void> | null = null;

  private readonly namespace: string;

  private disabled = false;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  public isEnabled(): boolean {
    return !this.disabled;
  }

  public async get<T>(key: string): Promise<T | null> {
    const pool = await this.ensureTable();
    if (!pool) {
      return null;
    }

    try {
      const result = await pool.query<QueryRow<T>>({
        text: `SELECT value, expires_at
                 FROM app_cache_entries
                WHERE namespace = $1 AND cache_key = $2
                LIMIT 1`,
        values: [this.namespace, key],
      });

      const row = result.rows?.[0];
      if (!row) {
        return null;
      }

      const expiresAt = row.expires_at instanceof Date ? row.expires_at : row.expires_at ? new Date(row.expires_at) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        await this.delete(key);
        return null;
      }

      return row.value ?? null;
    } catch (error) {
      console.error('DatabaseCache: failed to read cache entry', { namespace: this.namespace, key }, error);
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlMs?: number | null): Promise<void> {
    const pool = await this.ensureTable();
    if (!pool) {
      return;
    }

    const expiresAt = (() => {
      if (!ttlMs || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        return null;
      }
      const expiration = Date.now() + Number(ttlMs);
      return new Date(expiration);
    })();

    try {
      await pool.query({
        text: `INSERT INTO app_cache_entries (namespace, cache_key, value, expires_at)
               VALUES ($1, $2, $3::jsonb, $4)
               ON CONFLICT (namespace, cache_key)
               DO UPDATE SET value = EXCLUDED.value,
                             expires_at = EXCLUDED.expires_at,
                             updated_at = CURRENT_TIMESTAMP`,
        values: [this.namespace, key, JSON.stringify(value), expiresAt],
      });
    } catch (error) {
      console.error('DatabaseCache: failed to write cache entry', { namespace: this.namespace, key }, error);
    }
  }

  public async delete(key: string): Promise<void> {
    const pool = await this.ensureTable();
    if (!pool) {
      return;
    }

    try {
      await pool.query({
        text: 'DELETE FROM app_cache_entries WHERE namespace = $1 AND cache_key = $2',
        values: [this.namespace, key],
      });
    } catch (error) {
      console.error('DatabaseCache: failed to delete cache entry', { namespace: this.namespace, key }, error);
    }
  }

  public async purgeExpired(): Promise<void> {
    const pool = await this.ensureTable();
    if (!pool) {
      return;
    }

    try {
      await pool.query({
        text: `DELETE FROM app_cache_entries
                WHERE namespace = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()`,
        values: [this.namespace],
      });
    } catch (error) {
      console.error('DatabaseCache: failed to purge expired entries', { namespace: this.namespace }, error);
    }
  }

  private async ensureTable(): Promise<Pool | null> {
    if (this.disabled) {
      return null;
    }

    let pool: Pool;
    try {
      pool = getDatabasePool();
    } catch (error) {
      if (!this.disabled) {
        console.warn('DatabaseCache: database pool unavailable, caching disabled', error);
        this.disabled = true;
      }
      return null;
    }

    if (DatabaseCache.tableEnsured) {
      return pool;
    }

    if (!DatabaseCache.ensuringTable) {
      DatabaseCache.ensuringTable = (async () => {
        try {
          await pool.query(`CREATE TABLE IF NOT EXISTS app_cache_entries (
            namespace TEXT NOT NULL,
            cache_key TEXT NOT NULL,
            value JSONB NOT NULL,
            expires_at TIMESTAMPTZ NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (namespace, cache_key)
          )`);
          await pool.query(`CREATE INDEX IF NOT EXISTS app_cache_entries_expires_at_idx
            ON app_cache_entries (namespace, expires_at)`);
          DatabaseCache.tableEnsured = true;
        } catch (error) {
          console.error('DatabaseCache: failed to ensure cache table', error);
          throw error;
        } finally {
          DatabaseCache.ensuringTable = null;
        }
      })();
    }

    try {
      await DatabaseCache.ensuringTable;
      return pool;
    } catch (error) {
      this.disabled = true;
      return null;
    }
  }
}
