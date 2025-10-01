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

export interface VoicePresenceStartRecord {
  userId: string;
  guildId: string;
  channelId: string;
  joinedAt: Date;
}

export interface VoicePresenceEndRecord {
  userId: string;
  guildId: string;
  channelId: string;
  leftAt: Date;
}

export interface VoiceInterruptRecord {
  userId: string;
  interruptedUserId: string;
  guildId: string;
  channelId: string;
  timestamp: Date;
}

export interface VoiceMuteEventRecord {
  userId: string;
  guildId: string;
  channelId: string;
  timestamp: Date;
}

export interface VoiceCamEventRecord {
  userId: string;
  guildId: string;
  channelId: string;
  timestamp: Date;
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
  | 'arrivalEffect'
  | 'departureEffect'
  | 'retentionMinutes'
  | 'activityScore'
  | 'schRaw'
  | 'schScoreNorm';

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
  username: string | null;
  sessions: number;
  arrivalEffect: number;
  departureEffect: number;
  retentionMinutes: number;
  activityScore: number;
  schRaw: number;
  schScoreNorm: number;
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

  public async recordVoicePresenceStart(record: VoicePresenceStartRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    try {
      await pool.query(
        `INSERT INTO voice_presence (user_id, guild_id, channel_id, joined_at)
         VALUES ($1, $2, $3, $4)`,
        [record.userId, record.guildId, record.channelId, record.joinedAt],
      );
    } catch (error) {
      console.error('Failed to persist voice presence start', error);
    }
  }

  public async recordVoicePresenceEnd(record: VoicePresenceEndRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    try {
      await pool.query(
        `UPDATE voice_presence
            SET left_at = $4
          WHERE id = (
            SELECT id
              FROM voice_presence
             WHERE user_id = $1
               AND guild_id = $2
               AND channel_id = $3
               AND left_at IS NULL
             ORDER BY joined_at DESC
             LIMIT 1
          )`,
        [record.userId, record.guildId, record.channelId, record.leftAt],
      );
    } catch (error) {
      console.error('Failed to persist voice presence end', error);
    }
  }

  public async recordVoiceInterrupt(record: VoiceInterruptRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    try {
      await pool.query(
        `INSERT INTO voice_interrupts (user_id, interrupted_user_id, guild_id, channel_id, timestamp)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          record.userId,
          record.interruptedUserId,
          record.guildId,
          record.channelId,
          record.timestamp,
        ],
      );
    } catch (error) {
      console.error('Failed to persist voice interrupt', error);
    }
  }

  public async recordVoiceMuteEvent(record: VoiceMuteEventRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    try {
      await pool.query(
        `INSERT INTO voice_mute_events (user_id, guild_id, channel_id, timestamp)
         VALUES ($1, $2, $3, $4)`,
        [record.userId, record.guildId, record.channelId, record.timestamp],
      );
    } catch (error) {
      console.error('Failed to persist voice mute event', error);
    }
  }

  public async recordVoiceCamEvent(record: VoiceCamEventRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    try {
      await pool.query(
        `INSERT INTO voice_cam (user_id, guild_id, channel_id, timestamp)
         VALUES ($1, $2, $3, $4)`,
        [record.userId, record.guildId, record.channelId, record.timestamp],
      );
    } catch (error) {
      console.error('Failed to persist voice camera event', error);
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
    sortBy = 'schScoreNorm',
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
        sessions: 'session_count',
        arrivalEffect: 'arrival_effect',
        departureEffect: 'departure_effect',
        retentionMinutes: 'retention_minutes',
        activityScore: 'activity_score',
        schRaw: 'sch_raw',
        schScoreNorm: 'sch_score_norm',
      };
      const candidate =
        sortBy && mapping[sortBy as HypeLeaderboardSortBy] ? (sortBy as HypeLeaderboardSortBy) : 'schScoreNorm';
      return mapping[candidate];
    })();

    const sortDirection = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const params: Array<string | number> = [];
    let parameterIndex = 1;

    let sinceDaysParamIndex: number | null = null;
    if (sanitizedPeriodDays) {
      sinceDaysParamIndex = parameterIndex;
      params.push(sanitizedPeriodDays);
      parameterIndex += 1;
    }

    const sinceExpression = sinceDaysParamIndex
      ? `CURRENT_TIMESTAMP - $${sinceDaysParamIndex} * INTERVAL '1 day'`
      : null;

    const presenceWhereClause = (alias: string) => {
      if (!sinceExpression) {
        return '';
      }
      return `WHERE ${alias}.joined_at >= ${sinceExpression}`;
    };

    const presenceAndClause = (alias: string) => {
      if (!sinceExpression) {
        return '';
      }
      return ` AND ${alias}.joined_at >= ${sinceExpression}`;
    };

    const activityWhereClause = sinceExpression ? `WHERE va.timestamp >= ${sinceExpression}` : '';

    let searchClause = '';
    if (normalizedSearch) {
      searchClause = `  AND COALESCE(u.nickname, u.username, u.pseudo, 'Inconnu') ILIKE $${parameterIndex} ESCAPE '\\'`;
      params.push(`%${this.escapeLikePattern(normalizedSearch)}%`);
      parameterIndex += 1;
    }

    const limitParameter = `$${parameterIndex}`;
    params.push(boundedLimit);

    const query = `WITH
    sessions_count AS (
        SELECT user_id, guild_id, COUNT(*) AS session_count
        FROM voice_presence vp
        ${presenceWhereClause('vp')}
        GROUP BY user_id, guild_id
    ),

    days_present AS (
        SELECT user_id, guild_id, COUNT(DISTINCT DATE(joined_at)) AS days_count
        FROM voice_presence vp
        ${presenceWhereClause('vp')}
        GROUP BY user_id, guild_id
    ),

    arrival AS (
        SELECT
            vp.user_id,
            vp.guild_id,
            AVG(
                (
                    SELECT COUNT(DISTINCT vp3.user_id)
                    FROM voice_presence vp3
                    WHERE vp3.channel_id = vp.channel_id
                      AND vp3.joined_at <= vp.joined_at + interval '3 minutes'
                      AND (vp3.left_at IS NULL OR vp3.left_at > vp.joined_at + interval '3 minutes')
                      ${presenceAndClause('vp3')}
                ) -
                (
                    SELECT COUNT(DISTINCT vp2.user_id)
                    FROM voice_presence vp2
                    WHERE vp2.channel_id = vp.channel_id
                      AND vp2.joined_at <= vp.joined_at
                      AND (vp2.left_at IS NULL OR vp2.left_at > vp.joined_at)
                      ${presenceAndClause('vp2')}
                )
            ) AS arrival_effect
        FROM voice_presence vp
        ${presenceWhereClause('vp')}
        GROUP BY vp.user_id, vp.guild_id
    ),

    departure AS (
        SELECT
            vp.user_id,
            vp.guild_id,
            AVG(
                (
                    SELECT COUNT(DISTINCT vp3.user_id)
                    FROM voice_presence vp3
                    WHERE vp3.channel_id = vp.channel_id
                      AND vp3.joined_at <= vp.left_at + interval '3 minutes'
                      AND (vp3.left_at IS NULL OR vp3.left_at > vp.left_at + interval '3 minutes')
                      ${presenceAndClause('vp3')}
                ) -
                (
                    SELECT COUNT(DISTINCT vp2.user_id)
                    FROM voice_presence vp2
                    WHERE vp2.channel_id = vp.channel_id
                      AND vp2.joined_at <= vp.left_at
                      AND (vp2.left_at IS NULL OR vp2.left_at > vp.left_at)
                      ${presenceAndClause('vp2')}
                )
            ) * -1 AS departure_effect
        FROM voice_presence vp
        WHERE vp.left_at IS NOT NULL${presenceAndClause('vp')}
        GROUP BY vp.user_id, vp.guild_id
    ),

    retention AS (
        SELECT
            i.user_id AS influencer,
            i.guild_id,
            AVG(EXTRACT(EPOCH FROM (s.left_at - s.joined_at))) FILTER (WHERE o.overlap_time > interval '0') -
            AVG(EXTRACT(EPOCH FROM (s.left_at - s.joined_at))) FILTER (WHERE o.overlap_time IS NULL) AS retention_uplift
        FROM voice_presence s
        ${presenceWhereClause('s')}
        JOIN voice_presence i
          ON s.channel_id = i.channel_id
         AND s.guild_id = i.guild_id
         AND s.user_id <> i.user_id
         AND s.joined_at < i.left_at
         AND i.joined_at < s.left_at
         ${presenceAndClause('i')}
        LEFT JOIN LATERAL (
            SELECT LEAST(s.left_at, i.left_at) - GREATEST(s.joined_at, i.joined_at) AS overlap_time
        ) o ON true
        GROUP BY i.user_id, i.guild_id
    ),

    activity AS (
        SELECT
            va.user_id,
            va.guild_id,
            LOG(1 + SUM(duration_ms)/1000.0) AS activity_score
        FROM voice_activity va
        ${activityWhereClause}
        GROUP BY va.user_id, va.guild_id
    )

SELECT
    u.user_id,
    COALESCE(u.nickname, u.username, u.pseudo, 'Inconnu') AS display_name,
    u.username,
    sc.session_count,
    dp.days_count,
    COALESCE(a.arrival_effect, 0) AS arrival_effect,
    COALESCE(d.departure_effect, 0) AS departure_effect,
    ROUND((COALESCE(r.retention_uplift, 0) / 60.0)::numeric, 2) AS retention_minutes,
    COALESCE(ac.activity_score, 0) AS activity_score,
    (
        0.4 * COALESCE(a.arrival_effect, 0) +
        0.3 * COALESCE(d.departure_effect, 0) +
        0.2 * (COALESCE(r.retention_uplift, 0) / 60.0) +
        0.1 * COALESCE(ac.activity_score, 0)
    ) AS sch_raw,
    ROUND((
        (
            0.4 * COALESCE(a.arrival_effect, 0) +
            0.3 * COALESCE(d.departure_effect, 0) +
            0.2 * (COALESCE(r.retention_uplift, 0) / 60.0) +
            0.1 * COALESCE(ac.activity_score, 0)
        ) / LOG(1 + sc.session_count)
    )::numeric, 2) AS sch_score_norm
FROM users u
JOIN sessions_count sc ON u.user_id = sc.user_id AND u.guild_id = sc.guild_id
JOIN days_present dp   ON u.user_id = dp.user_id AND u.guild_id = dp.guild_id
LEFT JOIN arrival a   ON u.user_id = a.user_id AND u.guild_id = a.guild_id
LEFT JOIN departure d ON u.user_id = d.user_id AND u.guild_id = d.guild_id
LEFT JOIN retention r ON u.user_id = r.influencer AND u.guild_id = r.guild_id
LEFT JOIN activity ac ON u.user_id = ac.user_id AND u.guild_id = ac.guild_id
WHERE sc.session_count >= 5
  AND dp.days_count >= 3
  AND u.user_id NOT IN ('1419381362116268112')
${searchClause}
ORDER BY ${sortColumn} ${sortDirection}, sch_score_norm DESC, display_name ASC
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

        const username = this.normalizeString(row.username);

        return {
          userId: String(row.user_id ?? ''),
          displayName,
          username,
          sessions: Number.isFinite(Number(row.session_count)) ? Number(row.session_count) : 0,
          arrivalEffect: parseNumber(row.arrival_effect),
          departureEffect: parseNumber(row.departure_effect),
          retentionMinutes: parseNumber(row.retention_minutes),
          activityScore: parseNumber(row.activity_score),
          schRaw: parseNumber(row.sch_raw),
          schScoreNorm: parseNumber(row.sch_score_norm),
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
