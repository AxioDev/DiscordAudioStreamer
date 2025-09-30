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

    const durationSeconds = Math.max(record.durationMs / 1000, 0);

    try {
      await pool.query(
        `INSERT INTO voice_activity (user_id, channel_id, guild_id, duration, timestamp)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          record.userId,
          record.channelId,
          record.guildId,
          durationSeconds,
          record.startedAt,
        ],
      );
    } catch (error) {
      console.error('Failed to persist voice activity', error);
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
