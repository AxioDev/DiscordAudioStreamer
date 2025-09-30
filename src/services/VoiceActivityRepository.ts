import { Pool, PoolConfig } from 'pg';

export interface VoiceActivityRepositoryOptions {
  url?: string;
  ssl?: boolean;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
}

export interface VoiceActivityRecord {
  userId: string;
  channelId: string | null;
  guildId: string | null;
  durationMs: number;
  startedAt: Date;
  endedAt: Date;
}

export interface VoiceActivityQueryOptions {
  since?: Date | null;
  until?: Date | null;
  limit?: number | null;
}

export interface VoiceActivityHistoryEntry {
  userId: string;
  channelId: string | null;
  guildId: string | null;
  durationMs: number;
  startedAt: Date;
  endedAt: Date;
}

export default class VoiceActivityRepository {
  private readonly connectionString?: string;

  private readonly ssl: boolean;

  private readonly poolConfig?: Omit<PoolConfig, 'connectionString'>;

  private pool: Pool | null;

  private warnedAboutMissingConnection: boolean;

  constructor({ url, ssl, poolConfig }: VoiceActivityRepositoryOptions) {
    this.connectionString = url;
    this.ssl = Boolean(ssl);
    this.poolConfig = poolConfig;
    this.pool = null;
    this.warnedAboutMissingConnection = false;
  }

  private ensurePool(): Pool | null {
    if (!this.connectionString) {
      if (!this.warnedAboutMissingConnection) {
        console.warn('DATABASE_URL is not configured. Voice activity persistence is disabled.');
        this.warnedAboutMissingConnection = true;
      }
      return null;
    }

    if (!this.pool) {
      const sslConfig = this.ssl ? { rejectUnauthorized: false } : undefined;
      this.pool = new Pool({
        connectionString: this.connectionString,
        ssl: sslConfig,
        ...this.poolConfig,
      });

      this.pool.on('error', (error: unknown) => {
        console.error('Unexpected error from PostgreSQL connection pool', error);
      });
    }

    return this.pool;
  }

  public async recordVoiceActivity(record: VoiceActivityRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    const durationMs = Math.max(Math.floor(record.durationMs), 0);

    try {
      await pool.query(
        `INSERT INTO voice_activity (user_id, channel_id, guild_id, duration_ms, timestamp)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          record.userId,
          record.channelId,
          record.guildId,
          durationMs,
          record.startedAt,
        ],
      );
    } catch (error) {
      console.error('Failed to persist voice activity', error);
    }
  }

  public async listVoiceActivityHistory({
    since = null,
    until = null,
    limit = null,
  }: VoiceActivityQueryOptions = {}): Promise<VoiceActivityHistoryEntry[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const sinceIso = since instanceof Date && !Number.isNaN(since.getTime()) ? since.toISOString() : null;
    const untilIso = until instanceof Date && !Number.isNaN(until.getTime()) ? until.toISOString() : null;
    const boundedLimit = (() => {
      if (!Number.isFinite(limit)) {
        return 500;
      }
      const normalized = Math.max(1, Math.floor(Number(limit)));
      return Math.min(normalized, 2000);
    })();

    try {
      const result = await pool.query(
        `SELECT user_id, channel_id, guild_id, duration_ms, timestamp
           FROM voice_activity
           WHERE ($1::timestamptz IS NULL OR timestamp >= $1::timestamptz)
             AND ($2::timestamptz IS NULL OR timestamp <= $2::timestamptz)
           ORDER BY timestamp DESC
           LIMIT ${boundedLimit}`,
        [sinceIso, untilIso],
      );

      return (result.rows || []).map((row) => {
        const startedAt = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
        const durationMsValue = Number(row.duration_ms);
        const durationMs = Number.isFinite(durationMsValue) ? Math.max(Math.floor(durationMsValue), 0) : 0;
        const safeStart = Number.isFinite(startedAt?.getTime()) ? startedAt : new Date();
        const endedAt = new Date(safeStart.getTime() + durationMs);

        return {
          userId: String(row.user_id ?? ''),
          channelId: row.channel_id ?? null,
          guildId: row.guild_id ?? null,
          durationMs,
          startedAt: safeStart,
          endedAt,
        };
      });
    } catch (error) {
      console.error('Failed to load voice activity history', error);
      throw error;
    }
  }

  public async close(): Promise<void> {
    if (!this.pool) {
      return;
    }

    const pool = this.pool;
    this.pool = null;

    try {
      await pool.end();
    } catch (error) {
      console.error('Failed to close PostgreSQL connection pool', error);
    }
  }
}
