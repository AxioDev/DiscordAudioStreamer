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
  profile: VoiceActivityHistoryProfile | null;
}

export interface VoiceActivityHistoryProfile {
  displayName: string | null;
  username: string | null;
  avatar: string | null;
}

export type HypeLeaderboardSortBy =
  | 'displayName'
  | 'sessions'
  | 'averageIncrementalUsers'
  | 'medianIncrement'
  | 'totalPositiveInfluence'
  | 'totalTalkSeconds'
  | 'weightedHypeScore';

export type HypeLeaderboardSortOrder = 'asc' | 'desc';

export interface HypeLeaderboardQueryOptions {
  limit?: number | null;
  search?: string | null;
  sortBy?: HypeLeaderboardSortBy | null;
  sortOrder?: HypeLeaderboardSortOrder | null;
  periodDays?: number | null;
}

export interface HypeLeaderEntry {
  userId: string;
  displayName: string;
  sessions: number;
  averageIncrementalUsers: number;
  medianIncrement: number;
  totalPositiveInfluence: number;
  totalTalkSeconds: number;
  weightedHypeScore: number;
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

  private normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }

  private buildProfile({
    nickname,
    pseudo,
    username,
  }: {
    nickname?: unknown;
    pseudo?: unknown;
    username?: unknown;
  }): VoiceActivityHistoryProfile | null {
    const normalizedNickname = this.normalizeString(nickname);
    const normalizedPseudo = this.normalizeString(pseudo);
    const normalizedUsername = this.normalizeString(username);

    const displayName = normalizedNickname ?? normalizedPseudo ?? normalizedUsername ?? null;

    if (!displayName && !normalizedUsername) {
      return null;
    }

    return {
      displayName,
      username: normalizedUsername,
      avatar: null,
    };
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
    const hasRangeConstraint = sinceIso != null || untilIso != null;
    const boundedLimit = (() => {
      if (Number.isFinite(limit)) {
        const normalized = Math.max(1, Math.floor(Number(limit)));
        return Math.min(normalized, 2000);
      }
      return hasRangeConstraint ? null : 500;
    })();
    const limitClause = boundedLimit ? `LIMIT ${boundedLimit}` : '';

    try {
      const result = await pool.query(
        `SELECT va.user_id,
                va.channel_id,
                va.guild_id,
                va.duration_ms,
                va.timestamp,
                u.nickname,
                u.pseudo,
                u.username
           FROM voice_activity AS va
           LEFT JOIN users AS u
             ON u.guild_id = va.guild_id AND u.user_id = va.user_id
          WHERE ($1::timestamptz IS NULL OR va.timestamp >= $1::timestamptz)
           AND ($2::timestamptz IS NULL OR va.timestamp <= $2::timestamptz)
          ORDER BY va.timestamp DESC
          ${limitClause}`,
        [sinceIso, untilIso],
      );

      return (result.rows || []).map((row) => {
        const startedAt = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
        const durationMsValue = Number(row.duration_ms);
        const durationMs = Number.isFinite(durationMsValue) ? Math.max(Math.floor(durationMsValue), 0) : 0;
        const safeStart = Number.isFinite(startedAt?.getTime()) ? startedAt : new Date();
        const endedAt = new Date(safeStart.getTime() + durationMs);

        const profile = this.buildProfile({
          nickname: row.nickname,
          pseudo: row.pseudo,
          username: row.username,
        });

        return {
          userId: String(row.user_id ?? ''),
          channelId: row.channel_id ?? null,
          guildId: row.guild_id ?? null,
          durationMs,
          startedAt: safeStart,
          endedAt,
          profile,
        };
      });
    } catch (error) {
      console.error('Failed to load voice activity history', error);
      throw error;
    }
  }

  public async listHypeLeaders({
    limit = 100,
    search = null,
    sortBy = 'weightedHypeScore',
    sortOrder = 'desc',
    periodDays = null,
  }: HypeLeaderboardQueryOptions = {}): Promise<HypeLeaderEntry[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const boundedLimit = (() => {
      if (!Number.isFinite(limit)) {
        return 100;
      }
      const normalized = Math.max(1, Math.floor(Number(limit)));
      return Math.min(normalized, 200);
    })();

    const normalizedSearch = this.normalizeString(search);
    const sanitizedPeriodDays = (() => {
      if (!Number.isFinite(periodDays)) {
        return null;
      }
      const normalized = Math.max(1, Math.floor(Number(periodDays)));
      return Math.min(normalized, 365);
    })();

    const sortColumn = (() => {
      const mapping: Record<HypeLeaderboardSortBy, string> = {
        displayName: 'display_name',
        sessions: 'sessions',
        averageIncrementalUsers: 'avg_incremental_users',
        medianIncrement: 'median_increment',
        totalPositiveInfluence: 'total_positive_influence',
        totalTalkSeconds: 'total_talk_seconds',
        weightedHypeScore: 'weighted_hype_score',
      };
      const candidate = sortBy && mapping[sortBy as HypeLeaderboardSortBy] ? (sortBy as HypeLeaderboardSortBy) : 'weightedHypeScore';
      return mapping[candidate];
    })();

    const sortDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const sinceIso = (() => {
      if (!sanitizedPeriodDays) {
        return null;
      }
      const now = Date.now();
      const milliseconds = sanitizedPeriodDays * 24 * 60 * 60 * 1000;
      const since = new Date(now - milliseconds);
      return Number.isNaN(since.getTime()) ? null : since.toISOString();
    })();

    const params: Array<string | number> = [];
    let parameterIndex = 1;

    const presenceWhereClause = sinceIso ? `WHERE vp.joined_at >= $${parameterIndex++}::timestamptz` : '';
    if (sinceIso) {
      params.push(sinceIso);
    }

    const activityWhereClause = sinceIso ? `WHERE va.timestamp >= $${parameterIndex++}::timestamptz` : '';
    if (sinceIso) {
      params.push(sinceIso);
    }

    let searchCondition = '';
    if (normalizedSearch) {
      searchCondition = ` AND COALESCE(u.nickname, u.username, u.pseudo) ILIKE $${parameterIndex} ESCAPE '\\'`;
      params.push(`%${this.escapeLikePattern(normalizedSearch)}%`);
      parameterIndex += 1;
    }

    const limitParameter = `$${parameterIndex}`;
    params.push(boundedLimit);

    const query = `WITH presence_windows AS (
        SELECT
            vp.guild_id,
            vp.channel_id,
            vp.user_id,
            vp.joined_at,
            vp.left_at,
            (
                SELECT COUNT(DISTINCT vp2.user_id)
                FROM voice_presence vp2
                WHERE vp2.channel_id = vp.channel_id
                  AND vp2.joined_at <= vp.joined_at
                  AND (vp2.left_at IS NULL OR vp2.left_at > vp.joined_at)
            ) AS users_before,
            (
                SELECT COUNT(DISTINCT vp3.user_id)
                FROM voice_presence vp3
                WHERE vp3.channel_id = vp.channel_id
                  AND vp3.joined_at <= vp.joined_at + interval '3 minutes'
                  AND (vp3.left_at IS NULL OR vp3.left_at > vp.joined_at + interval '3 minutes')
            ) AS users_after
        FROM voice_presence vp
        ${presenceWhereClause}
    ),
    activity AS (
        SELECT
            va.user_id,
            va.guild_id,
            SUM(duration_ms)/1000.0 AS total_talk_seconds
        FROM voice_activity va
        ${activityWhereClause}
        GROUP BY va.user_id, va.guild_id
    )
    SELECT
        u.user_id,
        COALESCE(u.nickname, u.username, u.pseudo) AS display_name,
        COUNT(*) AS sessions,
        ROUND(AVG(users_after - users_before)::numeric, 2) AS avg_incremental_users,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY users_after - users_before)::numeric, 2) AS median_increment,
        SUM(GREATEST(users_after - users_before, 0)) AS total_positive_influence,
        COALESCE(a.total_talk_seconds,0) AS total_talk_seconds,
        ROUND(AVG(users_after - users_before)::numeric * LOG(1 + COALESCE(a.total_talk_seconds,0)), 2) AS weighted_hype_score
    FROM presence_windows pw
    INNER JOIN users u ON u.user_id = pw.user_id AND u.guild_id = pw.guild_id
    LEFT JOIN activity a ON a.user_id = pw.user_id AND a.guild_id = pw.guild_id
    WHERE COALESCE(u.nickname, u.username, u.pseudo) IS NOT NULL
    ${searchCondition}

    GROUP BY u.user_id, display_name, a.total_talk_seconds
    ORDER BY ${sortColumn} ${sortDirection}, weighted_hype_score DESC, display_name ASC
    LIMIT ${limitParameter}`;

    try {
      const result = await pool.query(query, params);
      return (result.rows ?? []).map((row) => {
        const parseNumber = (value: unknown): number => {
          const numeric = Number(value);
          if (!Number.isFinite(numeric)) {
            return 0;
          }
          return numeric;
        };

        const displayName = this.normalizeString(row.display_name) ?? 'Anonyme';

        return {
          userId: String(row.user_id ?? ''),
          displayName,
          sessions: Number.isFinite(Number(row.sessions)) ? Number(row.sessions) : 0,
          averageIncrementalUsers: parseNumber(row.avg_incremental_users),
          medianIncrement: parseNumber(row.median_increment),
          totalPositiveInfluence: parseNumber(row.total_positive_influence),
          totalTalkSeconds: parseNumber(row.total_talk_seconds),
          weightedHypeScore: parseNumber(row.weighted_hype_score),
        };
      });
    } catch (error) {
      console.error('Failed to compute hype leaderboard', error);
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
