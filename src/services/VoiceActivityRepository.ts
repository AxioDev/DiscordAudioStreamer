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

export interface MessageActivityRecord {
  messageId: string;
  userId: string;
  guildId: string | null;
  channelId: string | null;
  content: string | null;
  timestamp: Date;
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

export interface UserVoicePresenceSegment {
  channelId: string | null;
  guildId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
}

export interface UserVoiceActivitySegment {
  channelId: string | null;
  guildId: string | null;
  startedAt: Date;
  durationMs: number;
}

export interface UserMessageActivityEntry {
  messageId: string;
  channelId: string | null;
  guildId: string | null;
  content: string | null;
  timestamp: Date;
}

export interface UserVoiceTranscriptionEntry {
  transcriptionId: string;
  channelId: string | null;
  guildId: string | null;
  content: string | null;
  timestamp: Date;
}

export interface VoiceTranscriptionCursor {
  timestamp: Date;
  id: number;
}

export interface VoiceTranscriptionRecord {
  id: string;
  userId: string | null;
  channelId: string | null;
  guildId: string | null;
  content: string | null;
  timestamp: Date;
}

export interface VoiceTranscriptionInsertRecord {
  userId: string;
  channelId: string | null;
  guildId: string | null;
  content: string;
  timestamp: Date;
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

export interface HypeLeaderboardSnapshotOptions {
  limit: number;
  search: string | null;
  sortBy: HypeLeaderboardSortBy;
  sortOrder: HypeLeaderboardSortOrder;
  periodDays: number | null;
}

export interface HypeLeaderboardSnapshotEntry {
  userId: string;
  rank: number;
  sessions: number;
  activityScore: number;
  schScoreNorm: number;
}

export interface HypeLeaderboardSnapshotRecord {
  bucketStart: Date;
  optionsHash: string;
  options: HypeLeaderboardSnapshotOptions;
  leaders: HypeLeaderboardSnapshotEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSyncRecord {
  userId: string;
  guildId: string | null | undefined;
  username?: string | null;
  displayName?: string | null;
  nickname?: string | null;
  firstSeenAt?: Date | null;
  lastSeenAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

interface SchemaColumnInfo {
  dataType: string;
  udtName: string;
}

export default class VoiceActivityRepository {
  private readonly connectionString?: string;

  private readonly ssl: boolean;

  private readonly poolConfig?: Omit<PoolConfig, 'connectionString'>;

  private pool: Pool | null;

  private warnedAboutMissingConnection: boolean;

  private schemaIntrospectionPromise: Promise<void> | null;

  private voiceInterruptsColumns: Set<string> | null;

  private voiceMuteEventsColumns: Set<string> | null;

  private voiceCamColumns: Set<string> | null;

  private textMessagesColumns: Set<string> | null;
  private textMessagesColumnTypes: Map<string, SchemaColumnInfo> | null;

  private voiceTranscriptionsColumns: Set<string> | null;

  private usersColumns: Set<string> | null;
  private usersColumnTypes: Map<string, SchemaColumnInfo> | null;

  private readonly missingColumnWarnings: Set<string>;
  private readonly schemaPatchWarnings: Set<string>;

  private schemaPatchesPromise: Promise<void> | null;

  private leaderboardSnapshotsEnsured: boolean;

  constructor({ url, ssl, poolConfig }: VoiceActivityRepositoryOptions) {
    this.connectionString = url;
    this.ssl = Boolean(ssl);
    this.poolConfig = poolConfig;
    this.pool = null;
    this.warnedAboutMissingConnection = false;
    this.schemaIntrospectionPromise = null;
    this.voiceInterruptsColumns = null;
    this.voiceMuteEventsColumns = null;
    this.voiceCamColumns = null;
    this.textMessagesColumns = null;
    this.textMessagesColumnTypes = null;
    this.voiceTranscriptionsColumns = null;
    this.usersColumns = null;
    this.usersColumnTypes = null;
    this.missingColumnWarnings = new Set();
    this.schemaPatchWarnings = new Set();
    this.schemaPatchesPromise = null;
    this.leaderboardSnapshotsEnsured = false;
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

  private async ensureSchemaIntrospection(pool: Pool): Promise<void> {
    if (
      this.voiceInterruptsColumns &&
      this.voiceMuteEventsColumns &&
      this.voiceCamColumns &&
      this.textMessagesColumns &&
      this.voiceTranscriptionsColumns &&
      this.usersColumns &&
      this.usersColumnTypes
    ) {
      return;
    }

    if (!this.schemaIntrospectionPromise) {
      this.schemaIntrospectionPromise = this.loadSchemaIntrospection(pool).finally(() => {
        this.schemaIntrospectionPromise = null;
      });
    }

    await this.schemaIntrospectionPromise;
  }

  private async loadSchemaIntrospection(pool: Pool): Promise<void> {
    try {
      const tables = [
        'voice_interrupts',
        'voice_mute_events',
        'voice_cam',
        'text_messages',
        'voice_transcriptions',
        'users',
      ];
      const result = await pool.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        udt_name: string;
      }>(
        `SELECT table_name, column_name, data_type, udt_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1::text[])`,
        [tables],
      );

      const map = new Map<string, Set<string>>();
      const typeMap = new Map<string, Map<string, SchemaColumnInfo>>();
      for (const table of tables) {
        map.set(table, new Set<string>());
        typeMap.set(table, new Map<string, SchemaColumnInfo>());
      }

      for (const row of result.rows) {
        map.get(row.table_name)?.add(row.column_name);
        typeMap
          .get(row.table_name)
          ?.set(row.column_name, { dataType: row.data_type, udtName: row.udt_name });
      }

      this.voiceInterruptsColumns = map.get('voice_interrupts') ?? new Set<string>();
      this.voiceMuteEventsColumns = map.get('voice_mute_events') ?? new Set<string>();
      this.voiceCamColumns = map.get('voice_cam') ?? new Set<string>();
      this.textMessagesColumns = map.get('text_messages') ?? new Set<string>();
      this.textMessagesColumnTypes = typeMap.get('text_messages') ?? new Map<string, SchemaColumnInfo>();
      this.voiceTranscriptionsColumns = map.get('voice_transcriptions') ?? new Set<string>();
      this.usersColumns = map.get('users') ?? new Set<string>();
      this.usersColumnTypes = typeMap.get('users') ?? new Map<string, SchemaColumnInfo>();
    } catch (error) {
      console.error('Failed to introspect voice activity database schema', error);

      this.voiceInterruptsColumns ??= new Set<string>();
      this.voiceMuteEventsColumns ??= new Set<string>();
      this.voiceCamColumns ??= new Set<string>();
      this.textMessagesColumns ??= new Set<string>();
      this.textMessagesColumnTypes ??= new Map<string, SchemaColumnInfo>();
      this.voiceTranscriptionsColumns ??= new Set<string>();
      this.usersColumns ??= new Set<string>();
      this.usersColumnTypes ??= new Map<string, SchemaColumnInfo>();
    }
  }

  private async ensureSchemaPatches(pool: Pool): Promise<void> {
    if (this.schemaPatchesPromise) {
      await this.schemaPatchesPromise;
      return;
    }

    this.schemaPatchesPromise = this.applySchemaPatches(pool).finally(() => {
      this.schemaPatchesPromise = null;
    });

    await this.schemaPatchesPromise;
  }

  private isSnowflakeCompatibleType(info: SchemaColumnInfo | undefined): boolean {
    if (!info) {
      return false;
    }

    const normalizedDataType = info.dataType?.toLowerCase() ?? '';
    const normalizedUdtName = info.udtName?.toLowerCase() ?? '';

    return [
      'bigint',
      'numeric',
      'decimal',
      'text',
      'varchar',
      'character varying',
    ].includes(normalizedDataType)
      || ['int8'].includes(normalizedUdtName);
  }

  private async upgradeSnowflakeColumn(
    pool: Pool,
    table: string,
    column: string,
    columnTypes: Map<string, SchemaColumnInfo>,
  ): Promise<void> {
    const info = columnTypes.get(column);
    if (this.isSnowflakeCompatibleType(info)) {
      return;
    }

    try {
      await pool.query(
        `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE bigint USING ${column}::bigint`,
      );
      columnTypes.set(column, { dataType: 'bigint', udtName: 'int8' });
    } catch (error) {
      const key = `${table}.${column}`;
      if (!this.schemaPatchWarnings.has(key)) {
        this.schemaPatchWarnings.add(key);
        console.error(
          `Failed to upgrade column "${column}" on "${table}" to bigint. Discord snowflake identifiers may overflow the current schema until the database is migrated manually.`,
          error,
        );
      }
    }
  }

  private async applySchemaPatches(pool: Pool): Promise<void> {
    const textMessageTypes = this.textMessagesColumnTypes;
    if (textMessageTypes && textMessageTypes.size > 0) {
      await this.upgradeSnowflakeColumn(pool, 'text_messages', 'id', textMessageTypes);
      await this.upgradeSnowflakeColumn(pool, 'text_messages', 'user_id', textMessageTypes);
      await this.upgradeSnowflakeColumn(pool, 'text_messages', 'guild_id', textMessageTypes);
      await this.upgradeSnowflakeColumn(pool, 'text_messages', 'channel_id', textMessageTypes);
    }

    const usersColumnTypes = this.usersColumnTypes;
    if (usersColumnTypes && usersColumnTypes.size > 0) {
      await this.upgradeSnowflakeColumn(pool, 'users', 'user_id', usersColumnTypes);
      await this.upgradeSnowflakeColumn(pool, 'users', 'guild_id', usersColumnTypes);
    }
  }

  private async ensureLeaderboardSnapshotTable(pool: Pool): Promise<void> {
    if (this.leaderboardSnapshotsEnsured) {
      return;
    }

    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS hype_leaderboard_snapshots (
           id bigserial PRIMARY KEY,
           bucket_start timestamptz NOT NULL,
           options_hash text NOT NULL,
           options jsonb NOT NULL,
           leaders jsonb NOT NULL,
           created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
           UNIQUE (bucket_start, options_hash)
         )`,
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS hype_leaderboard_snapshots_lookup_idx
           ON hype_leaderboard_snapshots (options_hash, bucket_start DESC)`,
      );
      this.leaderboardSnapshotsEnsured = true;
    } catch (error) {
      console.error('Failed to ensure hype leaderboard snapshots table', error);
    }
  }

  private warnAboutMissingColumn(table: string, column: string): void {
    const key = `${table}.${column}`;
    if (this.missingColumnWarnings.has(key)) {
      return;
    }

    this.missingColumnWarnings.add(key);
    console.warn(
      `Column "${column}" is not present on "${table}". Some analytics may be limited until the database is migrated.`,
    );
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
      await this.ensureSchemaIntrospection(pool);

      const columns = ['user_id', 'guild_id', 'timestamp'];
      const values: Array<string | Date | number | null> = [
        record.userId,
        record.guildId,
        record.timestamp,
      ];

      const voiceInterruptsColumns = this.voiceInterruptsColumns ?? new Set<string>();

      if (voiceInterruptsColumns.has('interrupted_user_id')) {
        columns.push('interrupted_user_id');
        values.push(record.interruptedUserId ?? null);
      } else {
        this.warnAboutMissingColumn('voice_interrupts', 'interrupted_user_id');
      }

      if (voiceInterruptsColumns.has('channel_id')) {
        columns.push('channel_id');
        values.push(record.channelId ?? null);
      } else {
        this.warnAboutMissingColumn('voice_interrupts', 'channel_id');
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`);

      await pool.query(
        `INSERT INTO voice_interrupts (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
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
      await this.ensureSchemaIntrospection(pool);

      const columns = ['user_id', 'guild_id', 'timestamp'];
      const values: Array<string | Date | number | null> = [
        record.userId,
        record.guildId,
        record.timestamp,
      ];

      const voiceMuteEventsColumns = this.voiceMuteEventsColumns ?? new Set<string>();

      if (voiceMuteEventsColumns.has('channel_id')) {
        columns.push('channel_id');
        values.push(record.channelId ?? null);
      } else {
        this.warnAboutMissingColumn('voice_mute_events', 'channel_id');
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`);

      await pool.query(
        `INSERT INTO voice_mute_events (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
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
      await this.ensureSchemaIntrospection(pool);

      const columns = ['user_id', 'guild_id', 'timestamp'];
      const values: Array<string | Date | number | null> = [
        record.userId,
        record.guildId,
        record.timestamp,
      ];

      const voiceCamColumns = this.voiceCamColumns ?? new Set<string>();

      if (voiceCamColumns.has('channel_id')) {
        columns.push('channel_id');
        values.push(record.channelId ?? null);
      } else {
        this.warnAboutMissingColumn('voice_cam', 'channel_id');
      }

      if (voiceCamColumns.has('duration_ms')) {
        columns.push('duration_ms');
        values.push(0);
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`);

      await pool.query(
        `INSERT INTO voice_cam (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
      );
    } catch (error) {
      console.error('Failed to persist voice camera event', error);
    }
  }

  public async recordVoiceTranscription(record: VoiceTranscriptionInsertRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    const normalizedContent = record.content?.trim();
    if (!normalizedContent) {
      return;
    }

    try {
      await this.ensureSchemaIntrospection(pool);

      const voiceTranscriptionsColumns = this.voiceTranscriptionsColumns ?? new Set<string>();
      if (voiceTranscriptionsColumns.size === 0) {
        this.warnAboutMissingColumn('voice_transcriptions', 'user_id');
        return;
      }

      const columns = ['user_id', 'timestamp'];
      const values: Array<string | Date | null> = [record.userId, record.timestamp];

      if (voiceTranscriptionsColumns.has('guild_id')) {
        columns.push('guild_id');
        values.push(record.guildId ?? null);
      } else {
        this.warnAboutMissingColumn('voice_transcriptions', 'guild_id');
      }

      if (voiceTranscriptionsColumns.has('channel_id')) {
        columns.push('channel_id');
        values.push(record.channelId ?? null);
      } else {
        this.warnAboutMissingColumn('voice_transcriptions', 'channel_id');
      }

      if (voiceTranscriptionsColumns.has('content')) {
        columns.push('content');
        values.push(normalizedContent);
      } else {
        this.warnAboutMissingColumn('voice_transcriptions', 'content');
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`);

      await pool.query(
        `INSERT INTO voice_transcriptions (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
      );
    } catch (error) {
      console.error('Failed to persist voice transcription', error);
    }
  }

  public async recordMessageActivity(record: MessageActivityRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    try {
      await this.ensureSchemaIntrospection(pool);
      await this.ensureSchemaPatches(pool);

      if (!this.textMessagesColumns || this.textMessagesColumns.size === 0) {
        this.warnAboutMissingColumn('text_messages', 'timestamp');
        return;
      }

      const columns = ['id', 'user_id', 'timestamp'];
      const values: Array<string | Date | null> = [
        record.messageId,
        record.userId,
        record.timestamp,
      ];

      if (this.textMessagesColumns.has('guild_id')) {
        columns.push('guild_id');
        values.push(record.guildId ?? null);
      } else {
        this.warnAboutMissingColumn('text_messages', 'guild_id');
      }

      if (this.textMessagesColumns.has('channel_id')) {
        columns.push('channel_id');
        values.push(record.channelId ?? null);
      } else {
        this.warnAboutMissingColumn('text_messages', 'channel_id');
      }

      if (this.textMessagesColumns.has('content')) {
        columns.push('content');
        values.push(record.content ?? null);
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`);

      await pool.query(
        `INSERT INTO text_messages (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`
          + ' ON CONFLICT (id) DO UPDATE SET'
          + ' user_id = EXCLUDED.user_id,'
          + ' timestamp = EXCLUDED.timestamp'
          + (this.textMessagesColumns.has('guild_id') ? ', guild_id = EXCLUDED.guild_id' : '')
          + (this.textMessagesColumns.has('channel_id') ? ', channel_id = EXCLUDED.channel_id' : '')
          + (this.textMessagesColumns.has('content') ? ', content = EXCLUDED.content' : ''),
        values,
      );
    } catch (error) {
      console.error('Failed to persist message activity', error);
    }
  }

  public async syncUsers(records: UserSyncRecord[]): Promise<void> {
    const pool = this.ensurePool();
    if (!pool || !Array.isArray(records) || records.length === 0) {
      return;
    }

    const normalizeDate = (value: Date | null | undefined): Date | null => {
      if (!(value instanceof Date)) {
        return null;
      }
      const time = value.getTime();
      return Number.isNaN(time) ? null : value;
    };

    const sanitizeMetadata = (value: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
      if (!value || typeof value !== 'object') {
        return null;
      }

      try {
        const serialized = JSON.stringify(value);
        if (!serialized || serialized === 'null') {
          return null;
        }
        return JSON.parse(serialized) as Record<string, unknown>;
      } catch (error) {
        console.warn('Failed to serialize user metadata for persistence', error);
        return null;
      }
    };

    type NormalizedUserRecord = {
      guildId: string;
      userId: string;
      username: string | null;
      nickname: string | null;
      displayName: string | null;
      firstSeenAt: Date | null;
      lastSeenAt: Date | null;
      metadata: Record<string, unknown> | null;
    };

    const deduped = new Map<string, NormalizedUserRecord>();

    const mergeEarliest = (current: Date | null, incoming: Date | null): Date | null => {
      if (current && incoming) {
        return current.getTime() <= incoming.getTime() ? current : incoming;
      }
      return current ?? incoming ?? null;
    };

    const mergeLatest = (current: Date | null, incoming: Date | null): Date | null => {
      if (current && incoming) {
        return current.getTime() >= incoming.getTime() ? current : incoming;
      }
      return current ?? incoming ?? null;
    };

    const mergeMetadata = (
      current: Record<string, unknown> | null,
      incoming: Record<string, unknown> | null,
    ): Record<string, unknown> | null => {
      if (!current) {
        return incoming ? { ...incoming } : null;
      }
      if (!incoming) {
        return { ...current };
      }
      return { ...current, ...incoming };
    };

    for (const record of records) {
      const userId = typeof record?.userId === 'string' ? record.userId.trim() : '';
      const guildId = typeof record?.guildId === 'string' ? record.guildId.trim() : '';

      if (!userId || !guildId) {
        continue;
      }

      const normalized: NormalizedUserRecord = {
        guildId,
        userId,
        username: this.normalizeString(record.username ?? null),
        nickname: this.normalizeString(record.nickname ?? null),
        displayName: this.normalizeString(record.displayName ?? null),
        firstSeenAt: normalizeDate(record.firstSeenAt ?? null),
        lastSeenAt: normalizeDate(record.lastSeenAt ?? null),
        metadata: sanitizeMetadata(record.metadata ?? null),
      };

      const key = `${guildId}:${userId}`;
      const existing = deduped.get(key);

      if (existing) {
        if (normalized.username !== null) {
          existing.username = normalized.username;
        }
        if (normalized.nickname !== null) {
          existing.nickname = normalized.nickname;
        }
        if (normalized.displayName !== null) {
          existing.displayName = normalized.displayName;
        }
        existing.firstSeenAt = mergeEarliest(existing.firstSeenAt, normalized.firstSeenAt);
        existing.lastSeenAt = mergeLatest(existing.lastSeenAt, normalized.lastSeenAt);
        existing.metadata = mergeMetadata(existing.metadata, normalized.metadata);
      } else {
        deduped.set(key, normalized);
      }
    }

    const normalizedRecords = Array.from(deduped.values());
    if (normalizedRecords.length === 0) {
      return;
    }

    try {
      await this.ensureSchemaIntrospection(pool);
      await this.ensureSchemaPatches(pool);

      const usersColumns = this.usersColumns;
      if (!usersColumns || !usersColumns.has('guild_id') || !usersColumns.has('user_id')) {
        this.warnAboutMissingColumn('users', 'guild_id');
        this.warnAboutMissingColumn('users', 'user_id');
        return;
      }

      const includeColumn = (column: string): boolean => usersColumns.has(column);

      const columns = ['guild_id', 'user_id'];
      if (includeColumn('username')) {
        columns.push('username');
      }
      if (includeColumn('nickname')) {
        columns.push('nickname');
      }
      if (includeColumn('pseudo')) {
        columns.push('pseudo');
      }
      if (includeColumn('first_seen')) {
        columns.push('first_seen');
      }
      if (includeColumn('last_seen')) {
        columns.push('last_seen');
      }
      if (includeColumn('metadata')) {
        columns.push('metadata');
      }

      const values: unknown[] = [];
      const rowPlaceholders: string[] = [];

      normalizedRecords.forEach((record) => {
        const placeholders: string[] = [];

        for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
          placeholders.push(`$${values.length + columnIndex + 1}`);
        }

        rowPlaceholders.push(`(${placeholders.join(', ')})`);

        for (const column of columns) {
          switch (column) {
            case 'guild_id':
              values.push(record.guildId);
              break;
            case 'user_id':
              values.push(record.userId);
              break;
            case 'username':
              values.push(record.username);
              break;
            case 'nickname':
              values.push(record.nickname);
              break;
            case 'pseudo':
              values.push(record.displayName);
              break;
            case 'first_seen':
              values.push(record.firstSeenAt);
              break;
            case 'last_seen':
              values.push(record.lastSeenAt);
              break;
            case 'metadata':
              values.push(record.metadata);
              break;
            default:
              values.push(null);
              break;
          }
        }
      });

      if (rowPlaceholders.length === 0) {
        return;
      }

      const updateClauses: string[] = [];

      if (includeColumn('username')) {
        updateClauses.push('username = COALESCE(EXCLUDED.username, users.username)');
      }
      if (includeColumn('nickname')) {
        updateClauses.push('nickname = COALESCE(EXCLUDED.nickname, users.nickname)');
      }
      if (includeColumn('pseudo')) {
        updateClauses.push('pseudo = COALESCE(EXCLUDED.pseudo, users.pseudo)');
      }
      if (includeColumn('first_seen')) {
        updateClauses.push('first_seen = COALESCE(users.first_seen, EXCLUDED.first_seen)');
      }
      if (includeColumn('last_seen')) {
        updateClauses.push(
          'last_seen = CASE'
            + ' WHEN EXCLUDED.last_seen IS NULL THEN users.last_seen'
            + ' WHEN users.last_seen IS NULL THEN EXCLUDED.last_seen'
            + ' ELSE GREATEST(users.last_seen, EXCLUDED.last_seen)'
            + ' END',
        );
      }
      if (includeColumn('metadata')) {
        updateClauses.push(
          'metadata = CASE'
            + ' WHEN EXCLUDED.metadata IS NULL THEN users.metadata'
            + ' WHEN users.metadata IS NULL THEN EXCLUDED.metadata'
            + ' ELSE users.metadata || EXCLUDED.metadata'
            + ' END',
        );
      }

      const conflictClause = updateClauses.length > 0
        ? ` ON CONFLICT (guild_id, user_id) DO UPDATE SET ${updateClauses.join(', ')}`
        : ' ON CONFLICT (guild_id, user_id) DO NOTHING';

      await pool.query(
        `INSERT INTO users (${columns.join(', ')}) VALUES ${rowPlaceholders.join(', ')}` + conflictClause,
        values,
      );
    } catch (error) {
      console.error('Failed to synchronize users table', error);
    }
  }

  private normalizeRangeDate(value: Date | null | undefined): Date | null {
    if (!(value instanceof Date)) {
      return null;
    }
    const time = value.getTime();
    if (Number.isNaN(time)) {
      return null;
    }
    return value;
  }

  public async listUserVoicePresence({
    userId,
    since = null,
    until = null,
  }: { userId: string; since?: Date | null; until?: Date | null }): Promise<UserVoicePresenceSegment[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const sinceDate = this.normalizeRangeDate(since);
    const untilDate = this.normalizeRangeDate(until);
    const sinceIso = sinceDate ? sinceDate.toISOString() : null;
    const untilIso = untilDate ? untilDate.toISOString() : null;

    try {
      const result = await pool.query(
        `SELECT channel_id, guild_id, joined_at, left_at
           FROM voice_presence
          WHERE user_id = $1
            AND ($2::timestamptz IS NULL OR joined_at <= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR COALESCE(left_at, CURRENT_TIMESTAMP) >= $3::timestamptz)
          ORDER BY joined_at ASC`,
        [userId, untilIso, sinceIso],
      );

      return (result.rows ?? []).map((row) => {
        const rawJoined = row.joined_at instanceof Date ? row.joined_at : new Date(row.joined_at);
        const joinedAt = Number.isFinite(rawJoined?.getTime()) ? rawJoined : new Date();

        const rawLeft = row.left_at;
        let leftAt: Date | null = null;
        if (rawLeft instanceof Date) {
          leftAt = rawLeft;
        } else if (rawLeft) {
          const parsed = new Date(rawLeft);
          leftAt = Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        return {
          channelId: row.channel_id ?? null,
          guildId: row.guild_id ?? null,
          joinedAt,
          leftAt,
        };
      });
    } catch (error) {
      console.error('Failed to load voice presence history', error);
      return [];
    }
  }

  public async listUserVoiceActivity({
    userId,
    since = null,
    until = null,
  }: { userId: string; since?: Date | null; until?: Date | null }): Promise<UserVoiceActivitySegment[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const sinceDate = this.normalizeRangeDate(since);
    const untilDate = this.normalizeRangeDate(until);
    const sinceIso = sinceDate ? sinceDate.toISOString() : null;
    const untilIso = untilDate ? untilDate.toISOString() : null;

    try {
      const result = await pool.query(
        `SELECT channel_id, guild_id, duration_ms, timestamp
           FROM voice_activity
          WHERE user_id = $1
            AND ($2::timestamptz IS NULL OR timestamp >= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR timestamp <= $3::timestamptz)
          ORDER BY timestamp ASC`,
        [userId, sinceIso, untilIso],
      );

      return (result.rows ?? []).map((row) => {
        const start = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
        const durationMsValue = Number(row.duration_ms);
        const durationMs = Number.isFinite(durationMsValue) ? Math.max(Math.floor(durationMsValue), 0) : 0;
        return {
          channelId: row.channel_id ?? null,
          guildId: row.guild_id ?? null,
          startedAt: Number.isFinite(start?.getTime()) ? start : new Date(),
          durationMs,
        };
      });
    } catch (error) {
      console.error('Failed to load voice activity segments', error);
      return [];
    }
  }

  public async listUserMessageActivity({
    userId,
    since = null,
    until = null,
  }: { userId: string; since?: Date | null; until?: Date | null }): Promise<UserMessageActivityEntry[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const sinceDate = this.normalizeRangeDate(since);
    const untilDate = this.normalizeRangeDate(until);
    const sinceIso = sinceDate ? sinceDate.toISOString() : null;
    const untilIso = untilDate ? untilDate.toISOString() : null;

    try {
      await this.ensureSchemaIntrospection(pool);
      if (!this.textMessagesColumns || this.textMessagesColumns.size === 0) {
        return [];
      }

      const result = await pool.query(
        `SELECT id, channel_id, guild_id, content, timestamp
           FROM text_messages
          WHERE user_id = $1
            AND ($2::timestamptz IS NULL OR timestamp >= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR timestamp <= $3::timestamptz)
          ORDER BY timestamp ASC`,
        [userId, sinceIso, untilIso],
      );

      return (result.rows ?? []).map((row) => ({
        messageId: row.id ?? '',
        channelId: row.channel_id ?? null,
        guildId: row.guild_id ?? null,
        content: typeof row.content === 'string' ? row.content : row.content == null ? null : String(row.content),
        timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
      }));
    } catch (error) {
      if ((error as { code?: string })?.code === '42P01') {
        console.warn('text_messages table not found; skipping text analytics');
        return [];
      }
      console.error('Failed to load message activity', error);
      return [];
    }
  }

  public async listRecentUserMessages({
    userIds,
    limitPerUser = 3,
  }: {
    userIds: string[];
    limitPerUser?: number;
  }): Promise<Record<string, UserMessageActivityEntry[]>> {
    const pool = this.ensurePool();
    if (!pool) {
      return {};
    }

    const normalizedIds = Array.isArray(userIds)
      ? Array.from(
          new Set(
            userIds
              .map((id) => (typeof id === 'string' ? id.trim() : ''))
              .filter((id): id is string => id.length > 0),
          ),
        )
      : [];

    if (normalizedIds.length === 0) {
      return {};
    }

    const numericLimit = Number(limitPerUser);
    const boundedLimit = Number.isFinite(numericLimit)
      ? Math.min(Math.max(Math.floor(numericLimit), 1), 20)
      : 3;

    try {
      await this.ensureSchemaIntrospection(pool);
      if (!this.textMessagesColumns || this.textMessagesColumns.size === 0) {
        return {};
      }

      const result = await pool.query(
        `SELECT id, user_id, guild_id, channel_id, content, timestamp
           FROM (
                 SELECT id,
                        user_id,
                        guild_id,
                        channel_id,
                        content,
                        timestamp,
                        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp DESC) AS rn
                   FROM text_messages
                  WHERE user_id::text = ANY($1::text[])
                ) ranked
          WHERE rn <= $2
          ORDER BY user_id, timestamp DESC`,
        [normalizedIds, boundedLimit],
      );

      const grouped = new Map<string, UserMessageActivityEntry[]>();

      for (const row of result.rows ?? []) {
        const userId = typeof row.user_id === 'string' ? row.user_id : String(row.user_id ?? '');
        if (!userId) {
          continue;
        }

        const entry: UserMessageActivityEntry = {
          messageId: row.id ?? '',
          channelId: row.channel_id ?? null,
          guildId: row.guild_id ?? null,
          content: typeof row.content === 'string' ? row.content : row.content == null ? null : String(row.content),
          timestamp: row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp),
        };

        const bucket = grouped.get(userId);
        if (bucket) {
          bucket.push(entry);
        } else {
          grouped.set(userId, [entry]);
        }
      }

      const resultMap: Record<string, UserMessageActivityEntry[]> = {};
      for (const id of normalizedIds) {
        resultMap[id] = grouped.get(id)?.slice(0, boundedLimit) ?? [];
      }

      return resultMap;
    } catch (error) {
      if ((error as { code?: string })?.code === '42P01') {
        console.warn('text_messages table not found; skipping recent message lookup');
        return {};
      }
      console.error('Failed to load recent text messages', error);
      return {};
    }
  }

  public async listUserVoiceTranscriptions({
    userId,
    limit = null,
    before = null,
  }: {
    userId: string;
    limit?: number | null;
    before?: VoiceTranscriptionCursor | null;
  }): Promise<{
    entries: UserVoiceTranscriptionEntry[];
    hasMore: boolean;
    nextCursor: VoiceTranscriptionCursor | null;
  }> {
    const pool = this.ensurePool();
    if (!pool) {
      return { entries: [], hasMore: false, nextCursor: null };
    }

    const numericLimit = Number(limit);
    const boundedLimit = Number.isFinite(numericLimit)
      ? Math.min(Math.max(Math.floor(numericLimit), 1), 50)
      : 10;

    const cursorTimestamp = before?.timestamp instanceof Date && !Number.isNaN(before.timestamp.getTime())
      ? before.timestamp
      : null;
    const cursorIdValue = Number(before?.id);
    const cursorId = Number.isFinite(cursorIdValue) ? Math.floor(cursorIdValue) : null;

    try {
      await this.ensureSchemaIntrospection(pool);
      if (!this.voiceTranscriptionsColumns || this.voiceTranscriptionsColumns.size === 0) {
        return { entries: [], hasMore: false, nextCursor: null };
      }

      const params: Array<string | number> = [userId];
      let cursorClause = '';

      if (cursorTimestamp) {
        const timestampParamIndex = params.length + 1;
        params.push(cursorTimestamp.toISOString());
        if (cursorId != null) {
          const idParamIndex = params.length + 1;
          params.push(cursorId);
          cursorClause = ` AND (timestamp < $${timestampParamIndex}::timestamptz OR (timestamp = $${timestampParamIndex}::timestamptz AND id < $${idParamIndex}))`;
        } else {
          cursorClause = ` AND timestamp < $${timestampParamIndex}::timestamptz`;
        }
      }

      const limitParamIndex = params.length + 1;
      params.push(boundedLimit + 1);

      const query = `SELECT id, channel_id, guild_id, content, timestamp
           FROM voice_transcriptions
          WHERE user_id = $1${cursorClause}
          ORDER BY timestamp DESC, id DESC
          LIMIT $${limitParamIndex}`;

      const result = await pool.query(query, params);

      const normalizedRows = (result.rows ?? []).map((row) => {
        const timestampValue = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
        const timestamp = Number.isNaN(timestampValue?.getTime()) ? new Date(0) : timestampValue;
        const rawId = row.id;
        const numericIdCandidate = typeof rawId === 'number' ? rawId : Number(rawId);
        const numericId = Number.isFinite(numericIdCandidate) ? Math.floor(numericIdCandidate) : null;

        const entry: UserVoiceTranscriptionEntry = {
          transcriptionId: rawId != null ? String(rawId) : '',
          channelId:
            typeof row.channel_id === 'string'
              ? row.channel_id
              : row.channel_id == null
              ? null
              : String(row.channel_id),
          guildId:
            typeof row.guild_id === 'string'
              ? row.guild_id
              : row.guild_id == null
              ? null
              : String(row.guild_id),
          content:
            typeof row.content === 'string'
              ? row.content
              : row.content == null
              ? null
              : String(row.content),
          timestamp,
        };

        return { entry, timestamp, numericId };
      });

      const limitedRows = normalizedRows.slice(0, boundedLimit);
      const lastRow = limitedRows.length > 0 ? limitedRows[limitedRows.length - 1] : null;
      const rawHasMore = normalizedRows.length > boundedLimit;
      let nextCursor: VoiceTranscriptionCursor | null = null;

      if (rawHasMore && lastRow?.numericId != null) {
        nextCursor = { timestamp: lastRow.timestamp, id: lastRow.numericId };
      } else if (rawHasMore) {
        console.warn('Unable to build pagination cursor for voice transcriptions; falling back to single page result.');
      }

      const hasMore = rawHasMore && nextCursor != null;

      return {
        entries: limitedRows.map((row) => row.entry),
        hasMore,
        nextCursor,
      };
    } catch (error) {
      if ((error as { code?: string })?.code === '42P01') {
        console.warn('voice_transcriptions table not found; skipping transcription lookup');
        return { entries: [], hasMore: false, nextCursor: null };
      }
      console.error('Failed to load voice transcriptions', error);
      return { entries: [], hasMore: false, nextCursor: null };
    }
  }

  public async listVoiceTranscriptionsForRange({
    since = null,
    until = null,
    limit = null,
  }: {
    since?: Date | null;
    until?: Date | null;
    limit?: number | null;
  }): Promise<VoiceTranscriptionRecord[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    try {
      await this.ensureSchemaIntrospection(pool);
      if (!this.voiceTranscriptionsColumns || this.voiceTranscriptionsColumns.size === 0) {
        return [];
      }

      const conditions: string[] = [];
      const params: Array<string | number> = [];

      if (since instanceof Date && !Number.isNaN(since.getTime())) {
        params.push(since.toISOString());
        conditions.push(`timestamp >= $${params.length}::timestamptz`);
      }

      if (until instanceof Date && !Number.isNaN(until.getTime())) {
        params.push(until.toISOString());
        conditions.push(`timestamp < $${params.length}::timestamptz`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      let limitClause = '';
      if (limit != null && Number.isFinite(limit)) {
        const numericLimit = Math.max(1, Math.floor(Number(limit)));
        params.push(numericLimit);
        limitClause = `LIMIT $${params.length}`;
      }

      const query = `
        SELECT id, user_id, channel_id, guild_id, content, timestamp
        FROM voice_transcriptions
        ${whereClause}
        ORDER BY timestamp ASC
        ${limitClause}
      `;

      const result = await pool.query(query, params);
      const rows = result.rows ?? [];

      return rows.map((row) => {
        const timestampValue = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
        const timestamp = Number.isNaN(timestampValue?.getTime()) ? new Date(0) : timestampValue;
        const rawId = row.id;
        const id = rawId != null ? String(rawId) : '';
        return {
          id,
          userId:
            typeof row.user_id === 'string'
              ? row.user_id
              : row.user_id == null
              ? null
              : String(row.user_id),
          channelId:
            typeof row.channel_id === 'string'
              ? row.channel_id
              : row.channel_id == null
              ? null
              : String(row.channel_id),
          guildId:
            typeof row.guild_id === 'string'
              ? row.guild_id
              : row.guild_id == null
              ? null
              : String(row.guild_id),
          content:
            typeof row.content === 'string'
              ? row.content
              : row.content == null
              ? null
              : String(row.content),
          timestamp,
        };
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '42P01') {
        console.warn('voice_transcriptions table not found; skipping transcription lookup');
        return [];
      }
      console.error('Failed to list voice transcriptions', error);
      return [];
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
      if (limit === null || limit === undefined) {
        return null;
      }
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
      ? `CURRENT_TIMESTAMP - make_interval(days => $${sinceDaysParamIndex}::int)`
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

    let limitClause = '';
    if (boundedLimit !== null) {
      const limitParameter = `$${parameterIndex}`;
      params.push(boundedLimit);
      parameterIndex += 1;
      limitClause = `LIMIT ${limitParameter}`;
    }

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
        ${presenceWhereClause('s')}
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
${limitClause}`;

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

  private parseSnapshotRow(row: Record<string, unknown>): HypeLeaderboardSnapshotRecord | null {
    if (!row) {
      return null;
    }

    const bucketStart = row.bucket_start instanceof Date ? row.bucket_start : new Date(String(row.bucket_start ?? ''));
    if (Number.isNaN(bucketStart.getTime())) {
      return null;
    }

    const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at ?? ''));
    const updatedAt = row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at ?? ''));

    const options = (() => {
      try {
        const raw = row.options as string | Record<string, unknown> | null | undefined;
        if (!raw) {
          return null;
        }
        if (typeof raw === 'string') {
          return JSON.parse(raw) as HypeLeaderboardSnapshotOptions;
        }
        return raw as unknown as HypeLeaderboardSnapshotOptions;
      } catch (error) {
        console.error('Failed to parse hype leaderboard snapshot options', error);
        return null;
      }
    })();

    if (!options) {
      return null;
    }

    const leaders = (() => {
      try {
        const raw = row.leaders as string | Array<Record<string, unknown>> | null | undefined;
        if (!raw) {
          return [];
        }
        if (typeof raw === 'string') {
          const parsed = JSON.parse(raw) as HypeLeaderboardSnapshotEntry[];
          return Array.isArray(parsed) ? parsed : [];
        }
        return Array.isArray(raw) ? (raw as unknown as HypeLeaderboardSnapshotEntry[]) : [];
      } catch (error) {
        console.error('Failed to parse hype leaderboard snapshot leaders', error);
        return [];
      }
    })();

    return {
      bucketStart,
      optionsHash: String(row.options_hash ?? ''),
      options,
      leaders,
      createdAt: Number.isNaN(createdAt.getTime()) ? bucketStart : createdAt,
      updatedAt: Number.isNaN(updatedAt.getTime()) ? bucketStart : updatedAt,
    };
  }

  public async saveHypeLeaderboardSnapshot({
    bucketStart,
    optionsHash,
    options,
    leaders,
  }: {
    bucketStart: Date;
    optionsHash: string;
    options: HypeLeaderboardSnapshotOptions;
    leaders: HypeLeaderboardSnapshotEntry[];
  }): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    await this.ensureLeaderboardSnapshotTable(pool);

    try {
      await pool.query(
        `INSERT INTO hype_leaderboard_snapshots (bucket_start, options_hash, options, leaders)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)
         ON CONFLICT (bucket_start, options_hash)
         DO UPDATE SET options = EXCLUDED.options, leaders = EXCLUDED.leaders, updated_at = CURRENT_TIMESTAMP`,
        [bucketStart, optionsHash, JSON.stringify(options), JSON.stringify(leaders)],
      );
    } catch (error) {
      console.error('Failed to persist hype leaderboard snapshot', error);
    }
  }

  public async loadHypeLeaderboardSnapshot({
    bucketStart,
    optionsHash,
  }: {
    bucketStart: Date;
    optionsHash: string;
  }): Promise<HypeLeaderboardSnapshotRecord | null> {
    const pool = this.ensurePool();
    if (!pool) {
      return null;
    }

    await this.ensureLeaderboardSnapshotTable(pool);

    try {
      const result = await pool.query(
        `SELECT bucket_start, options_hash, options, leaders, created_at, updated_at
           FROM hype_leaderboard_snapshots
          WHERE options_hash = $1 AND bucket_start = $2
          LIMIT 1`,
        [optionsHash, bucketStart],
      );

      const row = result.rows?.[0];
      return row ? this.parseSnapshotRow(row) : null;
    } catch (error) {
      console.error('Failed to load hype leaderboard snapshot', error);
      return null;
    }
  }

  public async loadLatestHypeLeaderboardSnapshot({
    optionsHash,
    before = null,
  }: {
    optionsHash: string;
    before?: Date | null;
  }): Promise<HypeLeaderboardSnapshotRecord | null> {
    const pool = this.ensurePool();
    if (!pool) {
      return null;
    }

    await this.ensureLeaderboardSnapshotTable(pool);

    const params: Array<string | Date> = [optionsHash];
    let whereClause = 'options_hash = $1';

    if (before instanceof Date && !Number.isNaN(before.getTime())) {
      params.push(before);
      whereClause += ' AND bucket_start < $2';
    }

    try {
      const result = await pool.query(
        `SELECT bucket_start, options_hash, options, leaders, created_at, updated_at
           FROM hype_leaderboard_snapshots
          WHERE ${whereClause}
          ORDER BY bucket_start DESC
          LIMIT 1`,
        params,
      );

      const row = result.rows?.[0];
      return row ? this.parseSnapshotRow(row) : null;
    } catch (error) {
      console.error('Failed to load latest hype leaderboard snapshot', error);
      return null;
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
