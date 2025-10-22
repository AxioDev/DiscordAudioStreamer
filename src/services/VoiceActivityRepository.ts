import { Pool, PoolConfig } from 'pg';
import { attachPostgresQueryLogger } from './utils/PostgresQueryLogger';

export interface VoiceActivityRepositoryOptions {
  url?: string;
  ssl?: boolean;
  poolConfig?: Omit<PoolConfig, 'connectionString'>;
  debug?: boolean;
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

export interface PersonaInsightItem {
  title: string;
  detail: string;
  confidence: 'low' | 'medium' | 'high';
  evidence?: string[];
}

export interface PersonaProfileData {
  version: string;
  summary: string;
  highlights: PersonaInsightItem[];
  identity: {
    selfDescription: string | null;
    roles: PersonaInsightItem[];
    languages: PersonaInsightItem[];
    locations: PersonaInsightItem[];
  };
  interests: PersonaInsightItem[];
  expertise: PersonaInsightItem[];
  personality: {
    traits: PersonaInsightItem[];
    communication: PersonaInsightItem[];
    values: PersonaInsightItem[];
  };
  preferences: {
    likes: PersonaInsightItem[];
    dislikes: PersonaInsightItem[];
    collaborationTips: PersonaInsightItem[];
    contentFormats: PersonaInsightItem[];
  };
  conversationStarters: PersonaInsightItem[];
  lifestyle: PersonaInsightItem[];
  notableQuotes: Array<{
    quote: string;
    context: string | null;
    sourceType: 'voice' | 'text';
    timestamp: string | null;
  }>;
  disclaimers: PersonaInsightItem[];
}

export interface UserPersonaProfileRecord {
  userId: string;
  guildId: string | null;
  persona: PersonaProfileData;
  summary: string;
  model: string | null;
  version: string | null;
  generatedAt: Date | null;
  updatedAt: Date | null;
  lastActivityAt: Date | null;
  voiceSampleCount: number;
  messageSampleCount: number;
  inputCharacterCount: number;
}

export interface UserPersonaProfileInsertRecord {
  userId: string;
  guildId: string | null;
  persona: PersonaProfileData;
  summary: string;
  model: string | null;
  version: string | null;
  generatedAt: Date;
  lastActivityAt: Date | null;
  voiceSampleCount: number;
  messageSampleCount: number;
  inputCharacterCount: number;
}

export interface UserPersonaCandidateRecord {
  userId: string;
  guildId: string | null;
  lastActivityAt: Date | null;
  personaUpdatedAt: Date | null;
  personaVersion: string | null;
}

export interface KnownUserRecord {
  userId: string;
  guildId: string | null;
  username: string | null;
  nickname: string | null;
  pseudo: string | null;
  displayName: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  metadata: Record<string, unknown> | null;
  departedAt: Date | null;
}

export type MemberEngagementSort = 'voice' | 'messages';

export interface MemberEngagementCursor {
  primaryMetric: number;
  secondaryMetric: number;
  userId: string;
}

export interface MemberEngagementEntry {
  userId: string;
  displayName: string | null;
  username: string | null;
  nickname: string | null;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  lastActivityAt: Date | null;
  avatarUrl: string | null;
  roles: Array<{ id: string; name: string }>;
  isBot: boolean;
  voiceMilliseconds: number;
  voiceMinutes: number;
  messageCount: number;
  primaryMetric: number;
  secondaryMetric: number;
}

export interface MemberEngagementResult {
  members: MemberEngagementEntry[];
  nextCursor: MemberEngagementCursor | null;
}

export type CommunityStatisticsActivityType =
  | 'voice'
  | 'text'
  | 'arrivals'
  | 'departures'
  | 'mentions'
  | 'hype';

export type CommunityStatisticsGranularity = 'day' | 'week' | 'month' | 'year';

export type CommunityPulseTrend = 'up' | 'down' | 'steady';

export interface CommunityPulseMetricSnapshot {
  current: number;
  previous: number;
  change: number;
  trend: CommunityPulseTrend;
}

export interface CommunityPulseSnapshot {
  generatedAt: string;
  windowMinutes: number;
  voiceMinutes: CommunityPulseMetricSnapshot;
  activeMembers: CommunityPulseMetricSnapshot;
  messageCount: CommunityPulseMetricSnapshot;
}

export interface CommunityStatisticsQueryOptions {
  since?: Date | null;
  until?: Date | null;
  granularity?: CommunityStatisticsGranularity | null;
  activityTypes?: CommunityStatisticsActivityType[] | ReadonlyArray<CommunityStatisticsActivityType> | null;
  channelIds?: string[] | ReadonlyArray<string> | null;
  userId?: string | null;
  retentionWindows?: number[] | ReadonlyArray<number> | null;
  limitTopMembers?: number | null;
  limitChannels?: number | null;
  includeHeatmap?: boolean | null;
  includeHypeHistory?: boolean | null;
  timezone?: string | null;
}

export interface CommunityStatisticsTotals {
  totalMembers: number;
  activeMembers: number;
  newMembers: number;
  voiceMinutes: number;
  messageCount: number;
  averageConnectedPerHour: number;
  retentionRate: number | null;
  growthRate: number | null;
}

export interface CommunityStatisticsSeriesPoint {
  bucket: string;
  voiceMinutes: number;
  messageCount: number;
  activeMembers: number;
}

export interface CommunityStatisticsNewMemberPoint {
  bucket: string;
  count: number;
}

export interface CommunityStatisticsTopMemberEntry {
  userId: string;
  displayName: string;
  username: string | null;
  voiceMinutes: number;
  messageCount: number;
  activityScore: number;
}

export interface CommunityStatisticsChannelActivityEntry {
  channelId: string | null;
  channelName: string | null;
  voiceMinutes: number;
  messageCount: number;
}

export interface CommunityStatisticsRetentionBucket {
  windowDays: number;
  returningUsers: number;
  totalUsers: number;
  rate: number | null;
}

export interface CommunityStatisticsHeatmapEntry {
  source: 'voice' | 'text';
  dayOfWeek: number;
  hour: number;
  value: number;
}

export interface CommunityStatisticsHypeHistoryEntry {
  bucketStart: string;
  averageSchScore: number | null;
  leaderCount: number;
}

export interface CommunityStatisticsChannelSuggestion {
  channelId: string;
  channelName: string | null;
  channelType: 'text' | 'voice' | 'unknown';
  activityScore: number;
}

export interface CommunityStatisticsUserSuggestion {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface CommunityStatisticsResult {
  totals: CommunityStatisticsTotals;
  newMembers: CommunityStatisticsNewMemberPoint[];
  activitySeries: CommunityStatisticsSeriesPoint[];
  topMembers: CommunityStatisticsTopMemberEntry[];
  channelActivity: {
    voice: CommunityStatisticsChannelActivityEntry[];
    text: CommunityStatisticsChannelActivityEntry[];
  };
  retention: CommunityStatisticsRetentionBucket[];
  heatmap: CommunityStatisticsHeatmapEntry[];
  hypeHistory: CommunityStatisticsHypeHistoryEntry[];
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
  absoluteRank: number;
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
  absoluteRank?: number | null;
  displayName?: string | null;
  username?: string | null;
  sessions: number;
  arrivalEffect?: number | null;
  departureEffect?: number | null;
  retentionMinutes?: number | null;
  activityScore: number;
  schRaw?: number | null;
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
  departedAt?: Date | null;
}

interface SchemaColumnInfo {
  dataType: string;
  udtName: string;
}

export default class VoiceActivityRepository {
  private readonly connectionString?: string;

  private readonly ssl: boolean;

  private readonly poolConfig?: Omit<PoolConfig, 'connectionString'>;

  private readonly debugQueries: boolean;

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

  private userPersonasColumns: Set<string> | null;

  private readonly missingColumnWarnings: Set<string>;
  private readonly schemaPatchWarnings: Set<string>;

  private schemaPatchesPromise: Promise<void> | null;

  private leaderboardSnapshotsEnsured: boolean;

  private userPersonasEnsured: boolean;

  constructor({ url, ssl, poolConfig, debug }: VoiceActivityRepositoryOptions) {
    this.connectionString = url;
    this.ssl = Boolean(ssl);
    this.poolConfig = poolConfig;
    this.debugQueries = Boolean(debug);
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
    this.userPersonasColumns = null;
    this.missingColumnWarnings = new Set();
    this.schemaPatchWarnings = new Set();
    this.schemaPatchesPromise = null;
    this.leaderboardSnapshotsEnsured = false;
    this.userPersonasEnsured = false;
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

      attachPostgresQueryLogger(this.pool, {
        context: 'VoiceActivityRepository',
        debug: this.debugQueries,
        connectionString: this.connectionString,
        ssl: this.ssl,
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
      this.usersColumnTypes &&
      this.userPersonasColumns
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
        'user_personas',
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
      this.userPersonasColumns = map.get('user_personas') ?? new Set<string>();
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

      if (!this.usersColumns?.has('departed_at')) {
        try {
          await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS departed_at timestamptz');
        } catch (error) {
          if (!this.schemaPatchWarnings.has('users.departed_at')) {
            this.schemaPatchWarnings.add('users.departed_at');
            console.error('Failed to add departed_at column to users table', error);
          }
        }

        this.usersColumns?.add('departed_at');
        this.usersColumnTypes?.set('departed_at', {
          dataType: 'timestamp with time zone',
          udtName: 'timestamptz',
        });
      }

      try {
        await pool.query('CREATE INDEX IF NOT EXISTS users_departed_at_idx ON users (departed_at)');
      } catch (error) {
        if (!this.schemaPatchWarnings.has('users.departed_at_idx')) {
          this.schemaPatchWarnings.add('users.departed_at_idx');
          console.error('Failed to ensure departed_at index on users table', error);
        }
      }
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

  private async ensureUserPersonasTable(pool: Pool): Promise<void> {
    if (this.userPersonasEnsured) {
      return;
    }

    try {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS user_personas (
           user_id bigint PRIMARY KEY,
           guild_id bigint,
           persona jsonb NOT NULL,
           summary text NOT NULL,
           model text,
           version text,
           generated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
           last_activity_at timestamptz,
           voice_sample_count integer NOT NULL DEFAULT 0,
           message_sample_count integer NOT NULL DEFAULT 0,
           input_character_count integer NOT NULL DEFAULT 0
         )`,
      );

      await pool.query(
        `CREATE INDEX IF NOT EXISTS user_personas_updated_idx
           ON user_personas (updated_at DESC)`,
      );

      await pool.query(
        `CREATE INDEX IF NOT EXISTS user_personas_last_activity_idx
           ON user_personas (last_activity_at DESC NULLS LAST)`,
      );

      this.userPersonasColumns = null;
      this.userPersonasEnsured = true;
    } catch (error) {
      console.error('Failed to ensure user personas table', error);
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
      departedAt: Date | null;
      departedAtProvided: boolean;
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

      const hasDepartedAt = Object.prototype.hasOwnProperty.call(record, 'departedAt');
      const departedAt = hasDepartedAt ? normalizeDate(record.departedAt ?? null) : null;

      let metadata = sanitizeMetadata(record.metadata ?? null);
      if (hasDepartedAt) {
        const enriched: Record<string, unknown> = { ...(metadata ?? {}) };
        if (departedAt) {
          enriched.departedAt = departedAt.toISOString();
        } else {
          delete enriched.departedAt;
        }
        metadata = Object.keys(enriched).length > 0 ? enriched : null;
      }

      const normalized: NormalizedUserRecord = {
        guildId,
        userId,
        username: this.normalizeString(record.username ?? null),
        nickname: this.normalizeString(record.nickname ?? null),
        displayName: this.normalizeString(record.displayName ?? null),
        firstSeenAt: normalizeDate(record.firstSeenAt ?? null),
        lastSeenAt: normalizeDate(record.lastSeenAt ?? null),
        metadata,
        departedAt,
        departedAtProvided: hasDepartedAt,
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
        if (normalized.departedAtProvided) {
          existing.departedAt = normalized.departedAt;
          existing.departedAtProvided = true;
        }
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

      const persistRecords = async (
        recordsToPersist: NormalizedUserRecord[],
        includeDepartedAt: boolean,
      ): Promise<void> => {
        if (!recordsToPersist.length) {
          return;
        }

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
        if (includeDepartedAt && includeColumn('departed_at')) {
          columns.push('departed_at');
        }

        const values: unknown[] = [];
        const rowPlaceholders: string[] = [];

        recordsToPersist.forEach((record) => {
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
              case 'departed_at':
                values.push(record.departedAt);
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
        if (includeDepartedAt && includeColumn('departed_at')) {
          updateClauses.push('departed_at = EXCLUDED.departed_at');
        }

        const conflictClause = updateClauses.length > 0
          ? ` ON CONFLICT (guild_id, user_id) DO UPDATE SET ${updateClauses.join(', ')}`
          : ' ON CONFLICT (guild_id, user_id) DO NOTHING';

        await pool.query(
          `INSERT INTO users (${columns.join(', ')}) VALUES ${rowPlaceholders.join(', ')}` + conflictClause,
          values,
        );
      };

      const withoutDepartureInfo = normalizedRecords.filter((record) => !record.departedAtProvided);
      const withDepartureInfo = normalizedRecords.filter((record) => record.departedAtProvided);

      await persistRecords(withoutDepartureInfo, false);
      await persistRecords(withDepartureInfo, true);
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
        `WITH ordered_presence AS (
           SELECT
             vp.id,
             vp.channel_id,
             vp.guild_id,
             vp.joined_at,
             vp.left_at,
             LEAD(vp.joined_at) OVER (
               PARTITION BY vp.user_id
               ORDER BY vp.joined_at ASC, vp.id ASC
             ) AS next_joined_at
           FROM voice_presence vp
          WHERE vp.user_id = $1
        ),
        normalized_presence AS (
          SELECT
            channel_id,
            guild_id,
            joined_at,
            CASE
              WHEN left_at IS NOT NULL THEN left_at
              WHEN next_joined_at IS NOT NULL AND next_joined_at > joined_at THEN next_joined_at
              ELSE CURRENT_TIMESTAMP
            END AS effective_left_at
          FROM ordered_presence
        )
        SELECT
          channel_id,
          guild_id,
          joined_at,
          effective_left_at AS left_at
          FROM normalized_presence
         WHERE ($2::timestamptz IS NULL OR joined_at <= $2::timestamptz)
           AND ($3::timestamptz IS NULL OR effective_left_at >= $3::timestamptz)
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

  public async listMembersByEngagement({
    guildId,
    limit = 25,
    cursor = null,
    sortBy = 'voice',
    search = null,
    hiddenUserIds = [],
  }: {
    guildId?: string | null;
    limit?: number;
    cursor?: MemberEngagementCursor | null;
    sortBy?: MemberEngagementSort;
    search?: string | null;
    hiddenUserIds?: Iterable<string>;
  }): Promise<MemberEngagementResult> {
    const pool = this.ensurePool();
    if (!pool) {
      return { members: [], nextCursor: null };
    }

    const normalizedGuildId = typeof guildId === 'string' ? guildId.trim() : '';
    if (!normalizedGuildId) {
      return { members: [], nextCursor: null };
    }

    await this.ensureSchemaIntrospection(pool);

    if (!this.usersColumns || !this.usersColumns.has('guild_id') || !this.usersColumns.has('user_id')) {
      this.warnAboutMissingColumn('users', 'guild_id');
      this.warnAboutMissingColumn('users', 'user_id');
      return { members: [], nextCursor: null };
    }

    const boundedLimit = (() => {
      const numeric = Number(limit);
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return 25;
      }
      return Math.min(Math.max(Math.floor(numeric), 1), 200);
    })();

    const normalizedSort: MemberEngagementSort = sortBy === 'messages' ? 'messages' : 'voice';

    const hiddenIds = Array.from(hiddenUserIds ?? [])
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id): id is string => id.length > 0);

    const normalizedSearch = typeof search === 'string' ? search.trim() : '';

    const includeNickname = this.usersColumns.has('nickname');
    const includePseudo = this.usersColumns.has('pseudo');
    const includeUsername = this.usersColumns.has('username');
    const includeFirstSeen = this.usersColumns.has('first_seen');
    const includeLastSeen = this.usersColumns.has('last_seen');
    const includeMetadata = this.usersColumns.has('metadata');

    const nicknameExpr = includeNickname ? 'u.nickname' : 'NULL::text';
    const pseudoExpr = includePseudo ? 'u.pseudo' : 'NULL::text';
    const usernameExpr = includeUsername ? 'u.username' : 'NULL::text';
    const firstSeenExpr = includeFirstSeen ? 'u.first_seen' : 'NULL::timestamptz';
    const lastSeenExpr = includeLastSeen ? 'u.last_seen' : 'NULL::timestamptz';
    const metadataExpr = includeMetadata ? 'u.metadata' : 'NULL::jsonb';

    const params: unknown[] = [normalizedGuildId];

    let hiddenClause = '';
    if (hiddenIds.length > 0) {
      params.push(hiddenIds);
      hiddenClause = `AND NOT (u.user_id::text = ANY($${params.length}::text[]))`;
    }

    const searchableExpressions: string[] = [];
    if (includeNickname) {
      searchableExpressions.push("COALESCE(u.nickname, '')");
    }
    if (includePseudo) {
      searchableExpressions.push("COALESCE(u.pseudo, '')");
    }
    if (includeUsername) {
      searchableExpressions.push("COALESCE(u.username, '')");
    }
    if (includeMetadata) {
      searchableExpressions.push("COALESCE(u.metadata->>'displayName', '')");
      searchableExpressions.push("COALESCE(u.metadata->>'display_name', '')");
    }
    searchableExpressions.push("COALESCE(u.user_id::text, '')");

    let searchClause = '';
    if (normalizedSearch && searchableExpressions.length > 0) {
      const pattern = `%${this.escapeLikePattern(normalizedSearch)}%`;
      params.push(pattern);
      const searchIndex = params.length;
      const conditions = searchableExpressions.map(
        (expression) => `${expression} ILIKE $${searchIndex}`,
      );
      searchClause = `AND (${conditions.join(' OR ')})`;
    }

    params.push(normalizedSort);
    const sortIndex = params.length;

    const hasTextMessages = Boolean(this.textMessagesColumns && this.textMessagesColumns.size > 0);

    const voiceCte = `voice AS (
      SELECT user_id::text AS user_id,
             guild_id::text AS guild_id,
             SUM(duration_ms) AS voice_ms,
             MAX(timestamp) AS last_voice_at
        FROM voice_activity
       WHERE guild_id::text = $1
       GROUP BY user_id, guild_id
    )`;

    const messagesCte = hasTextMessages
      ? `messages AS (
      SELECT user_id::text AS user_id,
             guild_id::text AS guild_id,
             COUNT(*) AS message_count,
             MAX(timestamp) AS last_message_at
        FROM text_messages
       WHERE guild_id::text = $1
       GROUP BY user_id, guild_id
    )`
      : `messages AS (
      SELECT NULL::text AS user_id,
             NULL::text AS guild_id,
             0::bigint AS message_count,
             NULL::timestamptz AS last_message_at
      WHERE FALSE
    )`;

    const baseCte = `base AS (
      SELECT
        u.user_id::text AS user_id,
        u.guild_id::text AS guild_id,
        ${nicknameExpr} AS nickname,
        ${pseudoExpr} AS pseudo,
        ${usernameExpr} AS username,
        ${firstSeenExpr} AS first_seen,
        ${lastSeenExpr} AS last_seen,
        ${metadataExpr} AS metadata,
        COALESCE(voice.voice_ms, 0) AS voice_ms,
        COALESCE(messages.message_count, 0) AS message_count,
        COALESCE(voice.last_voice_at, messages.last_message_at, ${lastSeenExpr}) AS last_activity_at
      FROM users u
      LEFT JOIN voice ON voice.user_id = u.user_id::text AND voice.guild_id = u.guild_id::text
      LEFT JOIN messages ON messages.user_id = u.user_id::text AND messages.guild_id = u.guild_id::text
      WHERE u.guild_id::text = $1
        ${hiddenClause}
        ${searchClause}
    )`;

    const ctes = [voiceCte, messagesCte, baseCte].join(',\n');

    const cursorData = cursor ?? null;
    let cursorClause = '';
    if (cursorData) {
      params.push(cursorData.primaryMetric);
      const primaryIndex = params.length;
      params.push(cursorData.secondaryMetric);
      const secondaryIndex = params.length;
      params.push(cursorData.userId);
      const userIndex = params.length;

      if (normalizedSort === 'voice') {
        cursorClause = `AND (
          base.voice_ms < $${primaryIndex}
          OR (base.voice_ms = $${primaryIndex} AND base.message_count < $${secondaryIndex})
          OR (base.voice_ms = $${primaryIndex} AND base.message_count = $${secondaryIndex} AND base.user_id::numeric > $${userIndex}::numeric)
        )`;
      } else {
        cursorClause = `AND (
          base.message_count < $${primaryIndex}
          OR (base.message_count = $${primaryIndex} AND base.voice_ms < $${secondaryIndex})
          OR (base.message_count = $${primaryIndex} AND base.voice_ms = $${secondaryIndex} AND base.user_id::numeric > $${userIndex}::numeric)
        )`;
      }
    }

    const limitValue = boundedLimit + 1;
    params.push(limitValue);
    const limitIndex = params.length;

    const query = `WITH ${ctes}
    SELECT
      base.user_id,
      base.nickname,
      base.pseudo,
      base.username,
      base.first_seen,
      base.last_seen,
      base.last_activity_at,
      base.metadata,
      base.voice_ms,
      base.message_count,
      CASE WHEN $${sortIndex} = 'messages' THEN base.message_count ELSE base.voice_ms END AS primary_metric,
      CASE WHEN $${sortIndex} = 'messages' THEN base.voice_ms ELSE base.message_count END AS secondary_metric
    FROM base
    WHERE 1 = 1
      ${cursorClause}
    ORDER BY
      CASE WHEN $${sortIndex} = 'messages' THEN base.message_count ELSE base.voice_ms END DESC,
      CASE WHEN $${sortIndex} = 'messages' THEN base.voice_ms ELSE base.message_count END DESC,
      base.user_id::numeric ASC
    LIMIT $${limitIndex}`;

    const parseNumber = (value: unknown): number => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const parseDate = (value: unknown): Date | null => {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      return null;
    };

    const parseMetadata = (value: unknown): Record<string, unknown> | null => {
      if (!value) {
        return null;
      }
      if (typeof value === 'object') {
        return value as Record<string, unknown>;
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          return parsed;
        } catch (error) {
          console.warn('Failed to parse user metadata while listing members', error);
          return null;
        }
      }
      return null;
    };

    try {
      const result = await pool.query(query, params);
      const rows = result.rows ?? [];

      const members: MemberEngagementEntry[] = [];
      let nextCursor: MemberEngagementCursor | null = null;

      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const userId = typeof row?.user_id === 'string' ? row.user_id : String(row?.user_id ?? '').trim();
        if (!userId) {
          continue;
        }

        const metadata = parseMetadata(row?.metadata ?? null);
        const nickname = this.normalizeString(row?.nickname ?? null);
        const pseudo = this.normalizeString(row?.pseudo ?? null);
        const username = this.normalizeString(row?.username ?? null);
        const metadataDisplayName = typeof metadata?.displayName === 'string'
          ? this.normalizeString(metadata.displayName)
          : null;
        const displayName = metadataDisplayName ?? nickname ?? pseudo ?? username ?? null;

        const voiceMs = Math.max(0, Math.floor(parseNumber(row?.voice_ms)));
        const messageCount = Math.max(0, Math.floor(parseNumber(row?.message_count)));
        const voiceMinutes = Math.max(0, Math.round(voiceMs / 60000));
        const firstSeen = parseDate(row?.first_seen ?? null);
        const lastSeen = parseDate(row?.last_seen ?? null);
        const lastActivity = parseDate(row?.last_activity_at ?? null);
        const primaryMetric = parseNumber(row?.primary_metric);
        const secondaryMetric = parseNumber(row?.secondary_metric);

        const avatarCandidate = metadata && typeof metadata.avatarUrl === 'string' ? metadata.avatarUrl : null;

        let isBot = false;
        const rawIsBot = metadata?.isBot;
        if (typeof rawIsBot === 'boolean') {
          isBot = rawIsBot;
        } else if (typeof rawIsBot === 'string') {
          const lowered = rawIsBot.toLowerCase();
          isBot = lowered === 'true' || lowered === '1';
        }

        const roles: Array<{ id: string; name: string }> = [];
        if (metadata && Array.isArray((metadata as { roles?: unknown[] }).roles)) {
          for (const role of (metadata as { roles?: unknown[] }).roles ?? []) {
            const id = typeof (role as { id?: unknown })?.id === 'string'
              ? ((role as { id?: unknown }).id as string)
              : '';
            const name = typeof (role as { name?: unknown })?.name === 'string'
              ? ((role as { name?: unknown }).name as string)
              : '';
            const trimmedId = id.trim();
            const trimmedName = name.trim();
            if (trimmedId && trimmedName) {
              roles.push({ id: trimmedId, name: trimmedName });
            }
          }
        }

        const entry: MemberEngagementEntry = {
          userId,
          displayName,
          username,
          nickname,
          firstSeenAt: firstSeen,
          lastSeenAt: lastSeen,
          lastActivityAt: lastActivity,
          avatarUrl: typeof avatarCandidate === 'string' && avatarCandidate ? avatarCandidate : null,
          roles,
          isBot,
          voiceMilliseconds: voiceMs,
          voiceMinutes,
          messageCount,
          primaryMetric,
          secondaryMetric,
        };

        if (index < boundedLimit) {
          members.push(entry);
        } else if (!nextCursor) {
          nextCursor = {
            primaryMetric,
            secondaryMetric,
            userId,
          };
        }
      }

      return { members, nextCursor };
    } catch (error) {
      console.error('Failed to list members by engagement', error);
      return { members: [], nextCursor: null };
    }
  }

  public async listKnownUsers({
    activeSince = null,
    limit = null,
  }: {
    activeSince?: Date | null;
    limit?: number | null;
  } = {}): Promise<KnownUserRecord[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const normalizeString = (value: unknown): string | null => {
      if (typeof value !== 'string') {
        if (value == null) {
          return null;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
          const stringValue = String(value);
          return stringValue.trim().length > 0 ? stringValue.trim() : null;
        }
        return null;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };

    const normalizeDate = (value: unknown): Date | null => {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      if (value == null) {
        return null;
      }
      const parsed = new Date(String(value));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const normalizeMetadata = (value: unknown): Record<string, unknown> | null => {
      if (!value) {
        return null;
      }
      if (typeof value === 'object') {
        return value as Record<string, unknown>;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
          return null;
        }
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
        } catch (error) {
          console.warn('Failed to parse user metadata JSON', error);
          return null;
        }
      }
      return null;
    };

    try {
      await this.ensureSchemaIntrospection(pool);
      if (!this.usersColumns || this.usersColumns.size === 0) {
        return [];
      }

      const includeColumn = (column: string): boolean => Boolean(this.usersColumns?.has(column));

      const selectColumns: string[] = [
        'user_id::text AS user_id',
        includeColumn('guild_id') ? 'guild_id::text AS guild_id' : 'NULL::text AS guild_id',
        includeColumn('username') ? 'username::text AS username' : 'NULL::text AS username',
        includeColumn('nickname') ? 'nickname::text AS nickname' : 'NULL::text AS nickname',
        includeColumn('pseudo') ? 'pseudo::text AS pseudo' : 'NULL::text AS pseudo',
        includeColumn('display_name') ? 'display_name::text AS display_name' : 'NULL::text AS display_name',
        includeColumn('first_seen') ? 'first_seen AS first_seen' : 'NULL::timestamptz AS first_seen',
        includeColumn('last_seen') ? 'last_seen AS last_seen' : 'NULL::timestamptz AS last_seen',
        includeColumn('metadata') ? 'metadata AS metadata' : 'NULL::jsonb AS metadata',
        includeColumn('departed_at') ? 'departed_at AS departed_at' : 'NULL::timestamptz AS departed_at',
      ];

      const conditions: string[] = [];
      const params: unknown[] = [];

      const sinceDate = activeSince instanceof Date && !Number.isNaN(activeSince.getTime()) ? activeSince : null;
      if (sinceDate && (includeColumn('last_seen') || includeColumn('first_seen'))) {
        const lastSeenExpr = includeColumn('last_seen') ? 'last_seen' : 'NULL::timestamptz';
        const firstSeenExpr = includeColumn('first_seen') ? 'first_seen' : 'NULL::timestamptz';
        params.push(sinceDate.toISOString());
        conditions.push(`COALESCE(${lastSeenExpr}, ${firstSeenExpr}) >= $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      let limitClause = '';
      if (limit != null && Number.isFinite(limit)) {
        const numericLimit = Math.max(1, Math.floor(Number(limit)));
        params.push(numericLimit);
        limitClause = `LIMIT $${params.length}`;
      }

      const orderByClause = includeColumn('last_seen')
        ? 'ORDER BY COALESCE(last_seen, first_seen) DESC NULLS LAST'
        : includeColumn('first_seen')
        ? 'ORDER BY first_seen DESC NULLS LAST'
        : 'ORDER BY user_id ASC';

      const query = `
        SELECT ${selectColumns.join(', ')}
          FROM users
          ${whereClause}
          ${orderByClause}
          ${limitClause}
      `;

      const result = await pool.query(query, params);
      const rows = result.rows ?? [];

      return rows
        .map((row) => {
          const userId = normalizeString(row?.user_id);
          if (!userId) {
            return null;
          }

          const guildId = normalizeString(row?.guild_id);
          const username = normalizeString(row?.username);
          const nickname = normalizeString(row?.nickname);
          const pseudo = normalizeString(row?.pseudo);
          const displayNameCandidate =
            normalizeString(row?.display_name) ??
            nickname ??
            pseudo ??
            username ??
            normalizeString((row?.metadata as Record<string, unknown> | undefined)?.displayName) ??
            normalizeString((row?.metadata as Record<string, unknown> | undefined)?.display_name);
          const firstSeenAt = normalizeDate(row?.first_seen);
          const lastSeenAt = normalizeDate(row?.last_seen);
          const metadata = normalizeMetadata(row?.metadata);
          const departedAt = normalizeDate(row?.departed_at);

          return {
            userId,
            guildId,
            username,
            nickname,
            pseudo,
            displayName: displayNameCandidate,
            firstSeenAt,
            lastSeenAt,
            metadata,
            departedAt,
          } satisfies KnownUserRecord;
        })
        .filter((record): record is KnownUserRecord => record !== null);
    } catch (error) {
      if ((error as { code?: string })?.code === '42P01') {
        console.warn('users table not found; skipping user listing');
        return [];
      }
      console.error('Failed to list known users', error);
      return [];
    }
  }

  public async purgeDepartedUsers({
    cutoff,
    limit = 25,
  }: {
    cutoff: Date;
    limit?: number | null;
  }): Promise<number> {
    const pool = this.ensurePool();
    if (!pool) {
      return 0;
    }

    const cutoffDate = cutoff instanceof Date && !Number.isNaN(cutoff.getTime()) ? cutoff : null;
    if (!cutoffDate) {
      return 0;
    }

    const boundedLimit = (() => {
      const numeric = Number(limit);
      if (!Number.isFinite(numeric)) {
        return 25;
      }
      return Math.min(Math.max(Math.floor(numeric), 1), 200);
    })();

    try {
      await this.ensureSchemaIntrospection(pool);
      await this.ensureSchemaPatches(pool);

      if (!this.usersColumns?.has('departed_at')) {
        return 0;
      }

      const selectGuild = this.usersColumns.has('guild_id');
      const query = `
        SELECT user_id::text AS user_id,
               ${selectGuild ? 'guild_id::text AS guild_id,' : 'NULL::text AS guild_id,'}
               departed_at
          FROM users
         WHERE departed_at IS NOT NULL
           AND departed_at <= $1::timestamptz
         ORDER BY departed_at ASC
         LIMIT $2
      `;

      const result = await pool.query(query, [cutoffDate.toISOString(), boundedLimit]);
      const rows = result.rows ?? [];

      let purged = 0;

      for (const row of rows) {
        const userId = this.normalizeString(row?.user_id);
        if (!userId) {
          continue;
        }

        const guildId = selectGuild ? this.normalizeString(row?.guild_id) : null;

        try {
          await this.deleteUserDataForUser(pool, userId, guildId);
          purged += 1;
        } catch (error) {
          console.error('Failed to purge data for departed user', { userId, error });
        }
      }

      return purged;
    } catch (error) {
      console.error('Failed to purge departed users', error);
      return 0;
    }
  }

  private async deleteUserDataForUser(pool: Pool, userId: string, guildId: string | null): Promise<void> {
    const tables = [
      'voice_activity',
      'voice_presence',
      'voice_interrupts',
      'voice_mute_events',
      'voice_cam',
      'voice_transcriptions',
      'text_messages',
      'user_personas',
    ];

    const executeDelete = async (sql: string, params: Array<string | null>): Promise<void> => {
      try {
        await pool.query(sql, params);
      } catch (error) {
        if ((error as { code?: string })?.code === '42P01') {
          return;
        }
        throw error;
      }
    };

    await pool.query('BEGIN');
    try {
      for (const table of tables) {
        await executeDelete(`DELETE FROM ${table} WHERE user_id::text = $1`, [userId]);
      }

      const userParams = typeof guildId === 'string' && guildId.length > 0 ? [userId, guildId] : [userId];
      const userClause = userParams.length === 2 ? ' WHERE user_id::text = $1 AND guild_id::text = $2' : ' WHERE user_id::text = $1';
      await executeDelete(`DELETE FROM users${userClause}`, userParams);

      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  public async listActiveUsers({ limit = 100 }: { limit?: number }): Promise<
    Array<{ userId: string; lastActivityAt: Date | null }>
  > {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const boundedLimit = (() => {
      const numeric = Number(limit);
      if (!Number.isFinite(numeric)) {
        return 100;
      }
      return Math.min(Math.max(Math.floor(numeric), 1), 500);
    })();

    const activityByUser = new Map<string, Date>();

    const updateActivity = (userId: string | null | undefined, rawTimestamp: unknown): void => {
      if (!userId || typeof userId !== 'string') {
        return;
      }

      let timestamp: Date | null = null;
      if (rawTimestamp instanceof Date) {
        timestamp = rawTimestamp;
      } else if (rawTimestamp) {
        const parsed = new Date(String(rawTimestamp));
        if (!Number.isNaN(parsed.getTime())) {
          timestamp = parsed;
        }
      }

      if (!timestamp || Number.isNaN(timestamp.getTime())) {
        return;
      }

      const existing = activityByUser.get(userId);
      if (!existing || timestamp.getTime() > existing.getTime()) {
        activityByUser.set(userId, timestamp);
      }
    };

    const runQuery = async (sql: string, field: string): Promise<void> => {
      const result = await pool.query(sql);
      for (const row of result.rows ?? []) {
        const userId = typeof row?.user_id === 'string' ? row.user_id : String(row?.user_id ?? '').trim();
        updateActivity(userId, row?.[field]);
      }
    };

    try {
      await runQuery(
        `SELECT user_id, MAX(timestamp) AS last_activity
           FROM voice_activity
          GROUP BY user_id`,
        'last_activity',
      );
    } catch (error) {
      console.warn('Failed to fetch voice activity for sitemap', error);
    }

    try {
      await runQuery(
        `SELECT user_id, MAX(COALESCE(left_at, joined_at)) AS last_presence
           FROM voice_presence
          GROUP BY user_id`,
        'last_presence',
      );
    } catch (error) {
      console.warn('Failed to fetch voice presence for sitemap', error);
    }

    try {
      const sql = `SELECT user_id, MAX(timestamp) AS last_message FROM text_messages GROUP BY user_id`;
      await runQuery(sql, 'last_message');
    } catch (error) {
      if ((error as { code?: string })?.code !== '42P01') {
        console.warn('Failed to fetch message activity for sitemap', error);
      }
    }

    const entries = Array.from(activityByUser.entries())
      .map(([userId, date]) => ({ userId, lastActivityAt: date }))
      .filter((entry) => entry.userId.length > 0 && entry.lastActivityAt instanceof Date)
      .sort((a, b) => (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0))
      .slice(0, boundedLimit);

    return entries;
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
    order = 'asc',
  }: {
    since?: Date | null;
    until?: Date | null;
    limit?: number | null;
    order?: 'asc' | 'desc';
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

      const sortDirection = order === 'desc' ? 'DESC' : 'ASC';

      const query = `
        SELECT id, user_id, channel_id, guild_id, content, timestamp
        FROM voice_transcriptions
        ${whereClause}
        ORDER BY timestamp ${sortDirection}
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

  public async getUserPersonaProfile({ userId }: { userId: string }): Promise<UserPersonaProfileRecord | null> {
    const pool = this.ensurePool();
    if (!pool) {
      return null;
    }

    try {
      await this.ensureUserPersonasTable(pool);
      await this.ensureSchemaIntrospection(pool);

      if (!this.userPersonasColumns || this.userPersonasColumns.size === 0) {
        return null;
      }

      const result = await pool.query(
        `SELECT user_id,
                guild_id,
                persona,
                summary,
                model,
                version,
                generated_at,
                updated_at,
                last_activity_at,
                voice_sample_count,
                message_sample_count,
                input_character_count
           FROM user_personas
          WHERE user_id = $1
          LIMIT 1`,
        [userId],
      );

      const row = result.rows?.[0];
      if (!row) {
        return null;
      }

      const parseDate = (value: unknown): Date | null => {
        if (value instanceof Date) {
          return value;
        }
        if (typeof value === 'string') {
          const parsed = new Date(value);
          return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        return null;
      };

      const parseInteger = (value: unknown): number => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
      };

      let persona: PersonaProfileData | null = null;
      try {
        if (row.persona && typeof row.persona === 'string') {
          persona = JSON.parse(row.persona) as PersonaProfileData;
        } else if (row.persona && typeof row.persona === 'object') {
          persona = row.persona as PersonaProfileData;
        }
      } catch (error) {
        console.error('Failed to parse stored persona profile', error);
        persona = null;
      }

      if (!persona) {
        return null;
      }

      const summary = typeof row.summary === 'string' ? row.summary : '';

      return {
        userId: String(row.user_id ?? userId ?? ''),
        guildId:
          typeof row.guild_id === 'string'
            ? row.guild_id
            : row.guild_id == null
            ? null
            : String(row.guild_id),
        persona,
        summary,
        model: typeof row.model === 'string' ? row.model : null,
        version: typeof row.version === 'string' ? row.version : null,
        generatedAt: parseDate(row.generated_at),
        updatedAt: parseDate(row.updated_at),
        lastActivityAt: parseDate(row.last_activity_at),
        voiceSampleCount: parseInteger(row.voice_sample_count),
        messageSampleCount: parseInteger(row.message_sample_count),
        inputCharacterCount: parseInteger(row.input_character_count),
      };
    } catch (error) {
      console.error('Failed to load user persona profile', error);
      return null;
    }
  }

  public async upsertUserPersonaProfile(record: UserPersonaProfileInsertRecord): Promise<void> {
    const pool = this.ensurePool();
    if (!pool) {
      return;
    }

    try {
      await this.ensureUserPersonasTable(pool);
      await this.ensureSchemaIntrospection(pool);

      if (!this.userPersonasColumns || this.userPersonasColumns.size === 0) {
        return;
      }

      const personaJson = JSON.stringify(record.persona ?? {});
      const generatedAtIso = record.generatedAt instanceof Date && !Number.isNaN(record.generatedAt.getTime())
        ? record.generatedAt.toISOString()
        : new Date().toISOString();
      const lastActivityIso = record.lastActivityAt instanceof Date && !Number.isNaN(record.lastActivityAt.getTime())
        ? record.lastActivityAt.toISOString()
        : null;

      const values: Array<string | number | null> = [
        record.userId,
        record.guildId ?? null,
        personaJson,
        record.summary,
        record.model,
        record.version,
        generatedAtIso,
        lastActivityIso,
        Math.max(0, Math.floor(record.voiceSampleCount)),
        Math.max(0, Math.floor(record.messageSampleCount)),
        Math.max(0, Math.floor(record.inputCharacterCount)),
      ];

      await pool.query(
        `INSERT INTO user_personas (
           user_id,
           guild_id,
           persona,
           summary,
           model,
           version,
           generated_at,
           last_activity_at,
           voice_sample_count,
           message_sample_count,
           input_character_count,
           updated_at
         )
         VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9, $10, $11, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id) DO UPDATE SET
           guild_id = EXCLUDED.guild_id,
           persona = EXCLUDED.persona,
           summary = EXCLUDED.summary,
           model = EXCLUDED.model,
           version = EXCLUDED.version,
           generated_at = EXCLUDED.generated_at,
           last_activity_at = EXCLUDED.last_activity_at,
           voice_sample_count = EXCLUDED.voice_sample_count,
           message_sample_count = EXCLUDED.message_sample_count,
           input_character_count = EXCLUDED.input_character_count,
           updated_at = CURRENT_TIMESTAMP`,
        values,
      );
    } catch (error) {
      console.error('Failed to upsert user persona profile', error);
    }
  }

  public async listUserPersonaCandidates({
    limit = 10,
    since = null,
  }: {
    limit?: number | null;
    since?: Date | null;
  } = {}): Promise<UserPersonaCandidateRecord[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const normalizedLimit = Number(limit);
    const boundedLimit = Number.isFinite(normalizedLimit)
      ? Math.min(Math.max(Math.floor(normalizedLimit), 1), 200)
      : 10;

    const sinceIso = since instanceof Date && !Number.isNaN(since.getTime()) ? since.toISOString() : null;

    try {
      await this.ensureUserPersonasTable(pool);
      await this.ensureSchemaIntrospection(pool);

      const activitySources: string[] = [];

      if (this.voiceTranscriptionsColumns && this.voiceTranscriptionsColumns.size > 0) {
        activitySources.push(`
          SELECT user_id::text AS user_id,
                 guild_id::text AS guild_id,
                 timestamp
            FROM voice_transcriptions
           WHERE user_id IS NOT NULL
             AND ($1::timestamptz IS NULL OR timestamp >= $1::timestamptz)
        `);
      }

      if (this.textMessagesColumns && this.textMessagesColumns.size > 0) {
        activitySources.push(`
          SELECT user_id::text AS user_id,
                 guild_id::text AS guild_id,
                 timestamp
            FROM text_messages
           WHERE user_id IS NOT NULL
             AND ($1::timestamptz IS NULL OR timestamp >= $1::timestamptz)
        `);
      }

      if (activitySources.length === 0) {
        return [];
      }

      const query = `
        WITH activity AS (
          ${activitySources.join('\n          UNION ALL\n')}
        ), ranked AS (
          SELECT
            user_id,
            MAX(timestamp) AS last_activity_at,
            MAX(guild_id) FILTER (WHERE guild_id IS NOT NULL) AS guild_id
          FROM activity
          GROUP BY user_id
        )
        SELECT
          ranked.user_id,
          ranked.guild_id,
          ranked.last_activity_at,
          up.updated_at AS persona_updated_at,
          up.version AS persona_version
        FROM ranked
        LEFT JOIN user_personas AS up ON up.user_id::text = ranked.user_id
        ORDER BY ranked.last_activity_at DESC NULLS LAST
        LIMIT $2
      `;

      const result = await pool.query(query, [sinceIso, boundedLimit]);

      return (result.rows ?? []).map((row) => {
        const parseDate = (value: unknown): Date | null => {
          if (value instanceof Date) {
            return value;
          }
          if (typeof value === 'string') {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
          }
          return null;
        };

        return {
          userId: typeof row.user_id === 'string' ? row.user_id : String(row.user_id ?? ''),
          guildId: typeof row.guild_id === 'string' ? row.guild_id : row.guild_id == null ? null : String(row.guild_id),
          lastActivityAt: parseDate(row.last_activity_at),
          personaUpdatedAt: parseDate(row.persona_updated_at),
          personaVersion: typeof row.persona_version === 'string' ? row.persona_version : null,
        };
      });
    } catch (error) {
      console.error('Failed to list persona candidates', error);
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

    const orderByClause = `${sortColumn} ${sortDirection}, sch_score_norm DESC, display_name ASC`;
    const rankedOrderByClause = orderByClause
      .split(',')
      .map((clause) => clause.trim())
      .filter((clause) => clause.length > 0)
      .map((clause) => {
        const [column, ...rest] = clause.split(/\s+/);
        if (!column) {
          return clause;
        }
        return [`ranked.${column}`, ...rest].join(' ');
      })
      .join(', ');

    const params: Array<string | number> = [];
    let parameterIndex = 1;

    let sinceDaysParamIndex: number | null = null;
    if (sanitizedPeriodDays) {
      sinceDaysParamIndex = parameterIndex;
      params.push(sanitizedPeriodDays);
      parameterIndex += 1;
    }

    const sinceExpression = sinceDaysParamIndex
      ? `NOW() - ($${sinceDaysParamIndex}::int * INTERVAL '1 day')`
      : null;

    const presenceWhereClause = (alias: string) => {
      if (!sinceExpression) {
        return '';
      }
      return `WHERE ${alias}.joined_at >= ${sinceExpression}`;
    };

    const activityWhereClause = sinceExpression ? `WHERE va.timestamp >= ${sinceExpression}` : '';

    let searchClause = '';
    if (normalizedSearch) {
      searchClause = `WHERE ranked.display_name ILIKE $${parameterIndex}`;
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
    filtered_voice_presence AS (
        SELECT *
        FROM voice_presence vp
        ${presenceWhereClause('vp')}
    ),

    filtered_voice_activity AS (
        SELECT *
        FROM voice_activity va
        ${activityWhereClause}
    ),

    sessions_count AS (
        SELECT user_id, guild_id, COUNT(*) AS session_count
        FROM filtered_voice_presence
        GROUP BY user_id, guild_id
    ),

    days_present AS (
        SELECT user_id, guild_id, COUNT(DISTINCT DATE(joined_at)) AS days_count
        FROM filtered_voice_presence
        GROUP BY user_id, guild_id
    ),

    arrival AS (
        SELECT
            vp.user_id,
            vp.guild_id,
            AVG(
                (
                    SELECT COUNT(DISTINCT vp3.user_id)
                    FROM filtered_voice_presence vp3
                    WHERE vp3.channel_id = vp.channel_id
                      AND vp3.guild_id = vp.guild_id
                      AND vp3.joined_at <= vp.joined_at + interval '10 minutes'
                      AND (vp3.left_at IS NULL OR vp3.left_at > vp.joined_at + interval '10 minutes')
                ) -
                (
                    SELECT COUNT(DISTINCT vp2.user_id)
                    FROM filtered_voice_presence vp2
                    WHERE vp2.channel_id = vp.channel_id
                      AND vp2.guild_id = vp.guild_id
                      AND vp2.joined_at <= vp.joined_at
                      AND (vp2.left_at IS NULL OR vp2.left_at > vp.joined_at)
                )
            ) AS arrival_effect
        FROM filtered_voice_presence vp
        GROUP BY vp.user_id, vp.guild_id
    ),

    departure AS (
        SELECT
            vp.user_id,
            vp.guild_id,
            AVG(
                (
                    SELECT COUNT(DISTINCT vp3.user_id)
                    FROM filtered_voice_presence vp3
                    WHERE vp3.channel_id = vp.channel_id
                      AND vp3.guild_id = vp.guild_id
                      AND vp3.joined_at <= vp.left_at + interval '10 minutes'
                      AND (vp3.left_at IS NULL OR vp3.left_at > vp.left_at + interval '10 minutes')
                ) -
                (
                    SELECT COUNT(DISTINCT vp2.user_id)
                    FROM filtered_voice_presence vp2
                    WHERE vp2.channel_id = vp.channel_id
                      AND vp2.guild_id = vp.guild_id
                      AND vp2.joined_at <= vp.left_at
                      AND (vp2.left_at IS NULL OR vp2.left_at > vp.left_at)
                )
            ) * -1 AS departure_effect
        FROM filtered_voice_presence vp
        WHERE vp.left_at IS NOT NULL
        GROUP BY vp.user_id, vp.guild_id
    ),

    retention AS (
        SELECT
            i.user_id AS influencer,
            i.guild_id,
            AVG(
                LEAST(EXTRACT(EPOCH FROM COALESCE(o.overlap_time, interval '0')), 1800)
            ) AS retention_seconds
        FROM filtered_voice_presence s
        JOIN filtered_voice_presence i
          ON s.channel_id = i.channel_id
         AND s.guild_id = i.guild_id
         AND s.user_id <> i.user_id
        LEFT JOIN LATERAL (
            SELECT GREATEST(LEAST(s.left_at, i.left_at) - GREATEST(s.joined_at, i.joined_at), interval '0') AS overlap_time
        ) o ON true
        GROUP BY i.user_id, i.guild_id
    ),

    activity AS (
        SELECT
            va.user_id,
            va.guild_id,
            LOG(1 + SUM(duration_ms)/1000.0) AS activity_score
        FROM filtered_voice_activity va
        GROUP BY va.user_id, va.guild_id
    )

SELECT
    ranked.user_id,
    ranked.display_name,
    ranked.username,
    ranked.session_count,
    ranked.days_count,
    ranked.arrival_effect,
    ranked.departure_effect,
    ranked.retention_minutes,
    ranked.activity_score,
    ranked.sch_raw,
    ranked.sch_score_norm,
    ROW_NUMBER() OVER (ORDER BY ${rankedOrderByClause}) AS absolute_rank
FROM (
    SELECT
        u.user_id,
        COALESCE(u.nickname, u.username, u.pseudo, 'Inconnu') AS display_name,
        u.username,
        sc.session_count,
        dp.days_count,
        COALESCE(a.arrival_effect, 0) AS arrival_effect,
        COALESCE(d.departure_effect, 0) AS departure_effect,
        ROUND((COALESCE(r.retention_seconds, 0) / 60.0)::numeric, 2) AS retention_minutes,
        COALESCE(ac.activity_score, 0) AS activity_score,
        (
            0.4 * COALESCE(a.arrival_effect, 0) +
            0.3 * COALESCE(d.departure_effect, 0) +
            0.2 * (COALESCE(r.retention_seconds, 0) / 60.0) +
            0.1 * COALESCE(ac.activity_score, 0)
        ) AS sch_raw,
        ROUND((
            (
                0.4 * COALESCE(a.arrival_effect, 0) +
                0.3 * COALESCE(d.departure_effect, 0) +
                0.2 * (COALESCE(r.retention_seconds, 0) / 60.0) +
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
) ranked
${searchClause}
ORDER BY absolute_rank
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

        const username = this.normalizeString(row.username);
        const displayName = this.normalizeString(row.display_name) ?? username ?? 'Anonyme';

        return {
          userId: String(row.user_id ?? ''),
          displayName,
          username,
          sessions: Number.isFinite(Number(row.session_count)) ? Number(row.session_count) : 0,
          absoluteRank: Math.max(1, Math.floor(parseNumber(row.absolute_rank))),
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

  public async getCommunityStatistics(
    options: CommunityStatisticsQueryOptions = {},
  ): Promise<CommunityStatisticsResult> {
    const pool = this.ensurePool();
    if (!pool) {
      return {
        totals: {
          totalMembers: 0,
          activeMembers: 0,
          newMembers: 0,
          voiceMinutes: 0,
          messageCount: 0,
          averageConnectedPerHour: 0,
          retentionRate: null,
          growthRate: null,
        },
        newMembers: [],
        activitySeries: [],
        topMembers: [],
        channelActivity: { voice: [], text: [] },
        retention: [],
        heatmap: [],
        hypeHistory: [],
      };
    }

    const normalizeDate = (value: Date | null | undefined): Date | null => {
      if (!(value instanceof Date)) {
        return null;
      }
      return Number.isNaN(value.getTime()) ? null : value;
    };

    const parseNumber = (value: unknown): number => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const parseString = (value: unknown): string | null => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      return null;
    };

    const now = new Date();
    const sinceDate = normalizeDate(options.since ?? null);
    const untilDate = normalizeDate(options.until ?? null) ?? now;
    const safeUntil = Number.isNaN(untilDate.getTime()) ? now : untilDate;
    let safeSince = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;
    if (!safeSince) {
      safeSince = new Date(safeUntil.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    if (safeSince.getTime() > safeUntil.getTime()) {
      safeSince = new Date(safeUntil.getTime() - 24 * 60 * 60 * 1000);
    }

    const sinceIso = safeSince.toISOString();
    const untilIso = safeUntil.toISOString();

    const activityTypes = new Set<CommunityStatisticsActivityType>(
      Array.isArray(options.activityTypes) && options.activityTypes.length > 0
        ? (options.activityTypes as CommunityStatisticsActivityType[])
        : ['voice', 'text', 'arrivals', 'departures', 'mentions', 'hype'],
    );

    const channelIds = Array.isArray(options.channelIds)
      ? Array.from(
          new Set(
            (options.channelIds as string[])
              .map((id) => (typeof id === 'string' ? id.trim() : ''))
              .filter((id): id is string => id.length > 0),
          ),
        )
      : [];

    const userId = parseString(options.userId);

    const retentionWindows = (() => {
      const values = Array.isArray(options.retentionWindows)
        ? options.retentionWindows
        : typeof options.retentionWindows === 'number'
          ? [options.retentionWindows]
          : [7, 30, 90];
      const normalized = Array.from(
        new Set(
          values
            .map((value) => Math.max(1, Math.floor(Number(value))))
            .filter((value) => Number.isFinite(value) && value > 0),
        ),
      ).sort((a, b) => a - b);
      return normalized.slice(0, 5);
    })();

    const limitTopMembers = (() => {
      const candidate = Number(options.limitTopMembers);
      if (!Number.isFinite(candidate)) {
        return 15;
      }
      return Math.min(Math.max(Math.floor(candidate), 5), 100);
    })();

    const limitChannels = (() => {
      const candidate = Number(options.limitChannels);
      if (!Number.isFinite(candidate)) {
        return 12;
      }
      return Math.min(Math.max(Math.floor(candidate), 5), 50);
    })();

    const includeHeatmap = options.includeHeatmap !== false;
    const includeHypeHistory = options.includeHypeHistory !== false;

    await this.ensureSchemaIntrospection(pool);

    const hasTextMessages = Boolean(this.textMessagesColumns && this.textMessagesColumns.size > 0);
    const hasUsersTable = Boolean(this.usersColumns && this.usersColumns.size > 0);
    const hasFirstSeenColumn = Boolean(this.usersColumns?.has('first_seen'));
    const hasLastSeenColumn = Boolean(this.usersColumns?.has('last_seen'));

    const buildFilters = (
      alias: string,
      timestampColumn: string,
      { includeChannel = true }: { includeChannel?: boolean } = {},
    ): { clause: string; params: unknown[] } => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let index = 1;
      if (sinceIso) {
        conditions.push(`${timestampColumn} >= $${index}`);
        params.push(sinceIso);
        index += 1;
      }
      if (untilIso) {
        conditions.push(`${timestampColumn} <= $${index}`);
        params.push(untilIso);
        index += 1;
      }
      if (userId) {
        conditions.push(`${alias}.user_id::text = $${index}`);
        params.push(userId);
        index += 1;
      }
      if (includeChannel && channelIds.length > 0) {
        conditions.push(`${alias}.channel_id::text = ANY($${index}::text[])`);
        params.push(channelIds);
        index += 1;
      }
      const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      return { clause, params };
    };

    const buildPresenceFilters = (): {
      clause: string;
      params: unknown[];
      sinceParamIndex: number;
      untilParamIndex: number;
    } => {
      const params: unknown[] = [];
      const untilParamIndex = params.push(untilIso);
      const sinceParamIndex = params.push(sinceIso);

      const conditions: string[] = [
        `vp.joined_at <= $${untilParamIndex}::timestamptz`,
        `($${sinceParamIndex}::timestamptz IS NULL OR vp.left_at IS NULL OR vp.left_at >= $${sinceParamIndex}::timestamptz)`,
      ];

      if (userId) {
        const userIndex = params.push(userId);
        conditions.push(`vp.user_id::text = $${userIndex}`);
      }

      if (channelIds.length > 0) {
        const channelIndex = params.push(channelIds);
        conditions.push(`vp.channel_id::text = ANY($${channelIndex}::text[])`);
      }

      const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      return { clause, params, sinceParamIndex, untilParamIndex };
    };

    const totals: CommunityStatisticsTotals = {
      totalMembers: 0,
      activeMembers: 0,
      newMembers: 0,
      voiceMinutes: 0,
      messageCount: 0,
      averageConnectedPerHour: 0,
      retentionRate: null,
      growthRate: null,
    };

    let voiceDurationMs = 0;
    let messageCount = 0;
    let activeMembers = 0;
    let presenceSeconds = 0;

    // Voice totals
    try {
      const filters = buildFilters('va', 'va.timestamp');
      const query = `SELECT COALESCE(SUM(va.duration_ms), 0) AS voice_ms FROM voice_activity va ${filters.clause}`;
      const result = await pool.query(query, filters.params);
      voiceDurationMs = parseNumber(result.rows?.[0]?.voice_ms);
    } catch (error) {
      console.error('Failed to aggregate voice activity for statistics', error);
    }

    // Message totals
    if (hasTextMessages && activityTypes.has('text')) {
      try {
        const filters = buildFilters('tm', 'tm.timestamp');
        const query = `SELECT COUNT(*) AS message_count FROM text_messages tm ${filters.clause}`;
        const result = await pool.query(query, filters.params);
        messageCount = parseNumber(result.rows?.[0]?.message_count);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code !== '42P01') {
          console.error('Failed to aggregate text messages for statistics', error);
        }
        messageCount = 0;
      }
    }

    // Active members (voice + text)
    try {
      const voiceFilters = buildFilters('va', 'va.timestamp');
      const textFilters = buildFilters('tm', 'tm.timestamp');
      const textClause = hasTextMessages && activityTypes.has('text') ? textFilters.clause : 'WHERE FALSE';
      const textParams = hasTextMessages && activityTypes.has('text') ? textFilters.params : [];

      const queryParams = [...voiceFilters.params, ...textParams];
      const voiceParamCount = voiceFilters.params.length;

      const voiceClause = voiceFilters.clause;
      const adjustedTextClause = hasTextMessages && activityTypes.has('text')
        ? textClause.replace(/\$(\d+)/g, (_match, group) => `$${Number(group) + voiceParamCount}`)
        : textClause;

      const query = `
        WITH voice AS (
          SELECT DISTINCT va.user_id::text AS user_id
            FROM voice_activity va
            ${voiceClause}
        ), messages AS (
          SELECT DISTINCT tm.user_id::text AS user_id
            FROM text_messages tm
            ${adjustedTextClause}
        ), combined AS (
          SELECT user_id FROM voice
          UNION
          SELECT user_id FROM messages
        )
        SELECT COUNT(*) AS active_members FROM combined
      `;

      const result = await pool.query(query, queryParams);
      activeMembers = parseNumber(result.rows?.[0]?.active_members);
    } catch (error) {
      console.error('Failed to compute active member count for statistics', error);
    }

    // Presence duration
    try {
      const {
        clause: presenceClause,
        params: presenceParams,
        sinceParamIndex,
        untilParamIndex,
      } = buildPresenceFilters();

      const query = `
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (
            LEAST(COALESCE(vp.left_at, $${untilParamIndex}::timestamptz), $${untilParamIndex}::timestamptz)
            - GREATEST(vp.joined_at, $${sinceParamIndex}::timestamptz)
        ))), 0) AS seconds
          FROM voice_presence vp
          ${presenceClause}
      `;
      const result = await pool.query(query, presenceParams);
      presenceSeconds = parseNumber(result.rows?.[0]?.seconds);
    } catch (error) {
      console.error('Failed to compute presence duration for statistics', error);
    }

    totals.voiceMinutes = Math.round(voiceDurationMs / 60000);
    totals.messageCount = Math.max(0, Math.floor(messageCount));
    totals.activeMembers = Math.max(0, Math.floor(activeMembers));
    const hoursSpan = Math.max((safeUntil.getTime() - safeSince.getTime()) / (60 * 60 * 1000), 1);
    totals.averageConnectedPerHour = Number((presenceSeconds / 3600 / hoursSpan).toFixed(2));

    const newMembersSeries: CommunityStatisticsNewMemberPoint[] = [];
    const activitySeries: CommunityStatisticsSeriesPoint[] = [];
    const topMembers: CommunityStatisticsTopMemberEntry[] = [];
    const channelVoice: CommunityStatisticsChannelActivityEntry[] = [];
    const channelText: CommunityStatisticsChannelActivityEntry[] = [];
    const retentionBuckets: CommunityStatisticsRetentionBucket[] = [];
    const heatmap: CommunityStatisticsHeatmapEntry[] = [];
    const hypeHistory: CommunityStatisticsHypeHistoryEntry[] = [];

    const granularity = options.granularity ?? 'week';

    if (hasUsersTable) {
      // Members totals and growth
      try {
        const params: unknown[] = [sinceIso, untilIso];
        let index = 3;
        let userClause = '';
        if (userId) {
          params.push(userId);
          userClause = ` AND user_id::text = $${index}`;
          index += 1;
        }
        const result = await pool.query(
          `SELECT
             COUNT(*) FILTER (WHERE first_seen < $1::timestamptz) AS existing_before,
             COUNT(*) FILTER (WHERE first_seen <= $2::timestamptz) AS existing_after,
             COUNT(*) FILTER (WHERE first_seen >= $1::timestamptz AND first_seen <= $2::timestamptz) AS new_members,
             COUNT(*) FILTER (WHERE $2::timestamptz - first_seen >= interval '30 days' AND ($2::timestamptz <= COALESCE(last_seen, $2::timestamptz))) AS retained_members
           FROM users
          WHERE first_seen IS NOT NULL${userClause}`,
          params,
        );

        const row = result.rows?.[0];
        const before = parseNumber(row?.existing_before);
        const after = parseNumber(row?.existing_after);
        const newMembersCount = parseNumber(row?.new_members);
        totals.totalMembers = Math.max(after, 0);
        totals.newMembers = Math.max(newMembersCount, 0);
        const growthBase = Math.max(before, 1);
        totals.growthRate = Number(((after - before) / growthBase).toFixed(3));
        const retainedMembers = parseNumber(row?.retained_members);
        totals.retentionRate = after > 0 ? Number((retainedMembers / after).toFixed(3)) : null;
      } catch (error) {
        console.error('Failed to compute member totals for statistics', error);
      }

      if (hasFirstSeenColumn) {
        try {
          const params: unknown[] = [sinceIso, untilIso];
          let index = 3;
          let userClause = '';
          if (userId) {
            params.push(userId);
            userClause = ` AND user_id::text = $${index}`;
            index += 1;
          }

          const result = await pool.query(
            `SELECT date_trunc('${granularity}', first_seen) AS bucket, COUNT(*) AS count
               FROM users
              WHERE first_seen >= $1::timestamptz AND first_seen <= $2::timestamptz${userClause}
              GROUP BY bucket
              ORDER BY bucket`,
            params,
          );

          for (const row of result.rows ?? []) {
            const bucket = row.bucket instanceof Date ? row.bucket.toISOString() : parseString(row.bucket) ?? sinceIso;
            newMembersSeries.push({ bucket, count: Math.max(0, Math.floor(parseNumber(row.count))) });
          }
        } catch (error) {
          console.error('Failed to build new member series for statistics', error);
        }
      }

      if (hasFirstSeenColumn && hasLastSeenColumn) {
        try {
          const selectFragments: string[] = [];
          retentionWindows.forEach((window, windowIndex) => {
            selectFragments.push(
              `COUNT(*) FILTER (WHERE last_seen IS NOT NULL AND last_seen >= first_seen + interval '${window} days') AS returning_${windowIndex}`,
            );
          });

          const params: unknown[] = [sinceIso, untilIso];
          let index = 3;
          let userClause = '';
          if (userId) {
            params.push(userId);
            userClause = ` AND user_id::text = $${index}`;
            index += 1;
          }

          const query = `
            SELECT
              COUNT(*) AS total,
              ${selectFragments.join(',\n              ')}
              FROM users
             WHERE first_seen IS NOT NULL
               AND first_seen >= $1::timestamptz
               AND first_seen <= $2::timestamptz${userClause}
          `;

          const result = await pool.query(query, params);
          const row = result.rows?.[0];
          const total = Math.max(0, Math.floor(parseNumber(row?.total)));
          retentionWindows.forEach((window, windowIndex) => {
            const returning = Math.max(0, Math.floor(parseNumber(row?.[`returning_${windowIndex}`])));
            const rate = total > 0 ? Number((returning / total).toFixed(3)) : null;
            retentionBuckets.push({ windowDays: window, returningUsers: returning, totalUsers: total, rate });
          });
        } catch (error) {
          console.error('Failed to compute retention metrics for statistics', error);
        }
      }
    }

    // Voice activity series
    try {
      const filters = buildFilters('va', 'va.timestamp');
      const result = await pool.query(
        `SELECT date_trunc('${granularity}', va.timestamp) AS bucket,
                SUM(va.duration_ms) AS voice_ms,
                COUNT(DISTINCT va.user_id) AS active_members
           FROM voice_activity va
          ${filters.clause}
          GROUP BY bucket
          ORDER BY bucket`,
        filters.params,
      );

      for (const row of result.rows ?? []) {
        const bucket = row.bucket instanceof Date ? row.bucket.toISOString() : parseString(row.bucket) ?? sinceIso;
        const voiceMs = parseNumber(row.voice_ms);
        const active = parseNumber(row.active_members);
        activitySeries.push({
          bucket,
          voiceMinutes: Math.round(voiceMs / 60000),
          messageCount: 0,
          activeMembers: Math.max(0, Math.floor(active)),
        });
      }
    } catch (error) {
      console.error('Failed to build voice activity series for statistics', error);
    }

    if (hasTextMessages && activityTypes.has('text')) {
      try {
        const filters = buildFilters('tm', 'tm.timestamp');
        const result = await pool.query(
          `SELECT date_trunc('${granularity}', tm.timestamp) AS bucket,
                  COUNT(*) AS messages
             FROM text_messages tm
            ${filters.clause}
            GROUP BY bucket
            ORDER BY bucket`,
          filters.params,
        );

        const bucketMap = new Map<string, CommunityStatisticsSeriesPoint>();
        for (const entry of activitySeries) {
          bucketMap.set(entry.bucket, entry);
        }

        for (const row of result.rows ?? []) {
          const bucket = row.bucket instanceof Date ? row.bucket.toISOString() : parseString(row.bucket) ?? sinceIso;
          const messages = Math.max(0, Math.floor(parseNumber(row.messages)));
          const point = bucketMap.get(bucket);
          if (point) {
            point.messageCount = messages;
          } else {
            bucketMap.set(bucket, {
              bucket,
              voiceMinutes: 0,
              messageCount: messages,
              activeMembers: 0,
            });
          }
        }

        activitySeries.splice(0, activitySeries.length, ...Array.from(bucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket)));
      } catch (error) {
        console.error('Failed to build text activity series for statistics', error);
      }
    }

    // Top members
    try {
      const voiceFilters = buildFilters('va', 'va.timestamp');
      const textFilters = buildFilters('tm', 'tm.timestamp');

      const voiceClause = activityTypes.has('voice')
        ? voiceFilters.clause
        : 'WHERE FALSE';
      const voiceParams = activityTypes.has('voice') ? voiceFilters.params : [];

      const voiceParamCount = voiceParams.length;
      const adjustedTextClause = hasTextMessages && activityTypes.has('text')
        ? textFilters.clause.replace(/\$(\d+)/g, (_match, group) => `$${Number(group) + voiceParamCount}`)
        : 'WHERE FALSE';
      const textParams = hasTextMessages && activityTypes.has('text') ? textFilters.params : [];

      const params = [...voiceParams, ...textParams, limitTopMembers];
      const limitIndex = params.length;

      const query = `
        WITH voice AS (
          SELECT va.user_id::text AS user_id, SUM(va.duration_ms) AS voice_ms
            FROM voice_activity va
            ${voiceClause}
            GROUP BY va.user_id
        ), messages AS (
          SELECT tm.user_id::text AS user_id, COUNT(*) AS message_count
            FROM text_messages tm
            ${adjustedTextClause}
            GROUP BY tm.user_id
        ), merged AS (
          SELECT
            COALESCE(voice.user_id, messages.user_id) AS user_id,
            COALESCE(voice.voice_ms, 0) AS voice_ms,
            COALESCE(messages.message_count, 0) AS message_count
          FROM voice
          FULL OUTER JOIN messages ON messages.user_id = voice.user_id
        )
        SELECT
          merged.user_id,
          COALESCE(u.nickname, u.username, u.pseudo, 'Anonyme') AS display_name,
          u.username,
          merged.voice_ms,
          merged.message_count,
          (COALESCE(merged.voice_ms, 0) / 60000.0 + COALESCE(merged.message_count, 0)) AS activity_score
        FROM merged
        LEFT JOIN users u ON u.user_id::text = merged.user_id
        ORDER BY activity_score DESC
        LIMIT $${limitIndex}
      `;

      const result = await pool.query(query, params);
      for (const row of result.rows ?? []) {
        const userIdValue = parseString(row.user_id);
        if (!userIdValue) {
          continue;
        }
        topMembers.push({
          userId: userIdValue,
          displayName: parseString(row.display_name) ?? 'Anonyme',
          username: parseString(row.username),
          voiceMinutes: Math.round(parseNumber(row.voice_ms) / 60000),
          messageCount: Math.max(0, Math.floor(parseNumber(row.message_count))),
          activityScore: Number(parseNumber(row.activity_score).toFixed(2)),
        });
      }
    } catch (error) {
      console.error('Failed to compute top member statistics', error);
    }

    // Channel activity
    try {
      const filters = buildFilters('va', 'va.timestamp');
      const result = await pool.query(
        `SELECT va.channel_id::text AS channel_id, SUM(va.duration_ms) AS voice_ms
           FROM voice_activity va
          ${filters.clause}
          GROUP BY va.channel_id
          ORDER BY SUM(va.duration_ms) DESC
          LIMIT $${filters.params.length + 1}`,
        [...filters.params, limitChannels],
      );

      for (const row of result.rows ?? []) {
        const channelId = parseString(row.channel_id);
        const voiceMinutes = Math.round(parseNumber(row.voice_ms) / 60000);
        channelVoice.push({
          channelId,
          channelName: channelId ? `Salon vocal ${channelId}` : 'Salon inconnu',
          voiceMinutes,
          messageCount: 0,
        });
      }
    } catch (error) {
      console.error('Failed to compute voice channel activity for statistics', error);
    }

    if (hasTextMessages && activityTypes.has('text')) {
      try {
        const filters = buildFilters('tm', 'tm.timestamp');
        const result = await pool.query(
          `SELECT tm.channel_id::text AS channel_id, COUNT(*) AS messages
             FROM text_messages tm
            ${filters.clause}
            GROUP BY tm.channel_id
            ORDER BY COUNT(*) DESC
            LIMIT $${filters.params.length + 1}`,
          [...filters.params, limitChannels],
        );

        for (const row of result.rows ?? []) {
          const channelId = parseString(row.channel_id);
          const messages = Math.max(0, Math.floor(parseNumber(row.messages)));
          channelText.push({
            channelId,
            channelName: channelId ? `Salon textuel ${channelId}` : 'Salon textuel',
            voiceMinutes: 0,
            messageCount: messages,
          });
        }
      } catch (error) {
        console.error('Failed to compute text channel activity for statistics', error);
      }
    }

    if (includeHeatmap) {
      try {
        const voiceFilters = buildFilters('va', 'va.timestamp');
        const textFilters = buildFilters('tm', 'tm.timestamp');
        const voiceClause = activityTypes.has('voice') ? voiceFilters.clause : 'WHERE FALSE';
        const textClause = hasTextMessages && activityTypes.has('text') ? textFilters.clause : 'WHERE FALSE';
        const params = [...voiceFilters.params, ...textFilters.params];
        const textOffset = voiceFilters.params.length;
        const adjustedTextClause = textClause.replace(/\$(\d+)/g, (_match, group) => `$${Number(group) + textOffset}`);

        const query = `
          WITH voice AS (
            SELECT date_trunc('hour', va.timestamp) AS bucket, SUM(va.duration_ms) AS voice_ms
              FROM voice_activity va
              ${voiceClause}
              GROUP BY bucket
          ), messages AS (
            SELECT date_trunc('hour', tm.timestamp) AS bucket, COUNT(*) AS message_count
              FROM text_messages tm
              ${adjustedTextClause}
              GROUP BY bucket
          )
          SELECT bucket, voice_ms, NULL::bigint AS message_count, 'voice'::text AS source FROM voice
          UNION ALL
          SELECT bucket, NULL::bigint AS voice_ms, message_count, 'text'::text AS source FROM messages
        `;

        const result = await pool.query(query, params);
        for (const row of result.rows ?? []) {
          const bucketDate = row.bucket instanceof Date ? row.bucket : new Date(row.bucket);
          if (!(bucketDate instanceof Date) || Number.isNaN(bucketDate.getTime())) {
            continue;
          }
          const source = row.source === 'text' ? 'text' : 'voice';
          const day = bucketDate.getUTCDay();
          const hour = bucketDate.getUTCHours();
          const value = source === 'voice'
            ? Number((parseNumber(row.voice_ms) / 60000).toFixed(2))
            : parseNumber(row.message_count);
          heatmap.push({ source, dayOfWeek: day, hour, value });
        }
      } catch (error) {
        console.error('Failed to compute activity heatmap for statistics', error);
      }
    }

    if (includeHypeHistory && activityTypes.has('hype')) {
      try {
        await this.ensureLeaderboardSnapshotTable(pool);
        const result = await pool.query(
          `SELECT bucket_start, leaders
             FROM hype_leaderboard_snapshots
            WHERE bucket_start >= $1::timestamptz AND bucket_start <= $2::timestamptz
            ORDER BY bucket_start ASC`,
          [sinceIso, untilIso],
        );

        for (const row of result.rows ?? []) {
          const bucketStart = row.bucket_start instanceof Date
            ? row.bucket_start.toISOString()
            : parseString(row.bucket_start) ?? sinceIso;
          let averageScore: number | null = null;
          let leaderCount = 0;
          try {
            const leadersRaw = row.leaders;
            const leaders = Array.isArray(leadersRaw)
              ? leadersRaw
              : typeof leadersRaw === 'string'
                ? (JSON.parse(leadersRaw) as Array<Record<string, unknown>>)
                : [];
            if (Array.isArray(leaders)) {
              const scores: number[] = [];
              for (const leader of leaders as Array<Record<string, unknown>>) {
                const score = parseNumber((leader as { sch_score_norm?: unknown })?.sch_score_norm);
                if (Number.isFinite(score)) {
                  scores.push(score);
                }
              }
              if (scores.length > 0) {
                const sum = scores.reduce((acc, value) => acc + value, 0);
                averageScore = Number((sum / scores.length).toFixed(3));
                leaderCount = scores.length;
              }
            }
          } catch (error) {
            console.error('Failed to parse hype leaderboard snapshot for statistics', error);
          }
          hypeHistory.push({ bucketStart, averageSchScore: averageScore, leaderCount });
        }
      } catch (error) {
        console.error('Failed to collect hype history for statistics', error);
      }
    }

    totals.voiceMinutes = Math.max(totals.voiceMinutes, 0);
    totals.messageCount = Math.max(totals.messageCount, 0);
    totals.activeMembers = Math.max(totals.activeMembers, 0);

    return {
      totals,
      newMembers: newMembersSeries,
      activitySeries,
      topMembers,
      channelActivity: { voice: channelVoice, text: channelText },
      retention: retentionBuckets,
      heatmap,
      hypeHistory,
    };
  }

  public async searchUsersByName({
    query,
    limit = 6,
  }: {
    query: string;
    limit?: number;
  }): Promise<CommunityStatisticsUserSuggestion[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed) {
      return [];
    }

    await this.ensureSchemaIntrospection(pool);
    if (!this.usersColumns || !this.usersColumns.has('user_id')) {
      return [];
    }

    const searchableColumns = ['nickname', 'pseudo', 'username'].filter((column) => this.usersColumns?.has(column));
    if (searchableColumns.length === 0) {
      return [];
    }

    const likeValue = `%${trimmed.replace(/[%_]/g, (match) => `\\${match}`)}%`;
    const conditions = searchableColumns.map(
      (column, index) => `${column} ILIKE $${index + 1}`,
    );
    const params: unknown[] = Array.from({ length: conditions.length }, () => likeValue);
    const boundedLimit = (() => {
      const candidate = Number(limit);
      if (!Number.isFinite(candidate)) {
        return 6;
      }
      return Math.min(Math.max(Math.floor(candidate), 1), 25);
    })();

    const orderColumn = this.usersColumns.has('last_seen')
      ? 'last_seen'
      : this.usersColumns.has('first_seen')
        ? 'first_seen'
        : 'user_id';
    const hasMetadata = this.usersColumns.has('metadata');
    const metadataSelect = hasMetadata ? ', metadata' : '';

    const queryText = `
      SELECT user_id::text AS user_id,
             COALESCE(nickname, pseudo, username, 'Anonyme') AS display_name,
             username${metadataSelect}
        FROM users
       WHERE ${conditions.join(' OR ')}
       ORDER BY ${orderColumn} DESC NULLS LAST
       LIMIT $${conditions.length + 1}
    `;

    params.push(boundedLimit);

    const suggestions: CommunityStatisticsUserSuggestion[] = [];
    try {
      const result = await pool.query(queryText, params);
      for (const row of result.rows ?? []) {
        const userId = typeof row.user_id === 'string' ? row.user_id : String(row.user_id ?? '');
        if (!userId) {
          continue;
        }
        const displayName = typeof row.display_name === 'string' && row.display_name.trim().length > 0
          ? row.display_name.trim()
          : 'Anonyme';
        const username = typeof row.username === 'string' ? row.username : null;
        let avatarUrl: string | null = null;
        if (hasMetadata && row.metadata) {
          if (typeof row.metadata === 'object') {
            const candidate = (row.metadata as { avatarUrl?: unknown })?.avatarUrl;
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
              avatarUrl = candidate.trim();
            }
          } else if (typeof row.metadata === 'string') {
            try {
              const parsed = JSON.parse(row.metadata) as { avatarUrl?: unknown };
              const candidate = parsed?.avatarUrl;
              if (typeof candidate === 'string' && candidate.trim().length > 0) {
                avatarUrl = candidate.trim();
              }
            } catch (error) {
              console.error('Failed to parse user metadata while building suggestions', error);
            }
          }
        }

        suggestions.push({
          userId,
          displayName,
          username: username?.trim() || null,
          avatarUrl,
        });
      }
    } catch (error) {
      console.error('Failed to search users for statistics filters', error);
    }

    return suggestions;
  }

  public async listActiveChannels({
    since = null,
    until = null,
    limit = 12,
  }: {
    since?: Date | null;
    until?: Date | null;
    limit?: number;
  }): Promise<CommunityStatisticsChannelSuggestion[]> {
    const pool = this.ensurePool();
    if (!pool) {
      return [];
    }

    await this.ensureSchemaIntrospection(pool);

    const sinceIso = since instanceof Date && !Number.isNaN(since.getTime()) ? since.toISOString() : null;
    const untilIso = until instanceof Date && !Number.isNaN(until.getTime()) ? until.toISOString() : null;
    const boundedLimit = (() => {
      const candidate = Number(limit);
      if (!Number.isFinite(candidate)) {
        return 12;
      }
      return Math.min(Math.max(Math.floor(candidate), 5), 50);
    })();

    const parseNumber = (value: unknown): number => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const filters = (alias: string, column: string): { clause: string; params: unknown[] } => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let index = 1;
      if (sinceIso) {
        conditions.push(`${column} >= $${index}`);
        params.push(sinceIso);
        index += 1;
      }
      if (untilIso) {
        conditions.push(`${column} <= $${index}`);
        params.push(untilIso);
        index += 1;
      }
      const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      return { clause, params };
    };

    const voiceFilters = filters('va', 'va.timestamp');
    const textFilters = filters('tm', 'tm.timestamp');

    const hasTextMessages = Boolean(this.textMessagesColumns && this.textMessagesColumns.size > 0);
    const voiceParams = [...voiceFilters.params, boundedLimit];
    const voiceQuery = `
      SELECT va.channel_id::text AS channel_id,
             'voice'::text AS channel_type,
             SUM(va.duration_ms) / 60000.0 AS voice_minutes,
             0::bigint AS message_count,
             SUM(va.duration_ms) / 60000.0 AS activity_score
        FROM voice_activity va
       ${voiceFilters.clause}
       GROUP BY va.channel_id
       ORDER BY SUM(va.duration_ms) DESC
       LIMIT $${voiceFilters.params.length + 1}
    `;

    const suggestions: CommunityStatisticsChannelSuggestion[] = [];

    try {
      const result = await pool.query(voiceQuery, voiceParams);
      for (const row of result.rows ?? []) {
        const channelId = typeof row.channel_id === 'string' ? row.channel_id : String(row.channel_id ?? '');
        if (!channelId) {
          continue;
        }
        const activityScore = Number(parseNumber(row.activity_score).toFixed(2));
        suggestions.push({
          channelId,
          channelName: `Salon vocal ${channelId}`,
          channelType: 'voice',
          activityScore,
        });
      }
    } catch (error) {
      console.error('Failed to list voice channels for statistics filters', error);
    }

    if (hasTextMessages) {
      const textParams = [...textFilters.params, boundedLimit];
      const textQuery = `
        SELECT tm.channel_id::text AS channel_id,
               'text'::text AS channel_type,
               0::double precision AS voice_minutes,
               COUNT(*) AS message_count,
               COUNT(*)::double precision AS activity_score
          FROM text_messages tm
         ${textFilters.clause}
         GROUP BY tm.channel_id
         ORDER BY COUNT(*) DESC
         LIMIT $${textFilters.params.length + 1}
      `;

      try {
        const result = await pool.query(textQuery, textParams);
        for (const row of result.rows ?? []) {
          const channelId = typeof row.channel_id === 'string' ? row.channel_id : String(row.channel_id ?? '');
          if (!channelId) {
            continue;
          }
          const activityScore = Number(parseNumber(row.activity_score).toFixed(2));
          suggestions.push({
            channelId,
            channelName: `Salon textuel ${channelId}`,
            channelType: 'text',
            activityScore,
          });
        }
      } catch (error) {
        console.error('Failed to list text channels for statistics filters', error);
      }
    }

    suggestions.sort((a, b) => b.activityScore - a.activityScore);
    return suggestions.slice(0, boundedLimit);
  }

  public async getCommunityPulse(
    options: { windowMinutes?: number; now?: Date } = {},
  ): Promise<CommunityPulseSnapshot | null> {
    const pool = this.ensurePool();
    if (!pool) {
      return null;
    }

    await this.ensureSchemaIntrospection(pool);

    const parseNumber = (value: unknown): number => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const normalizeDate = (value: Date | null | undefined): Date => {
      if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
      }
      return new Date();
    };

    const now = normalizeDate(options.now ?? null);
    const rawWindow = Number.isFinite(Number(options.windowMinutes))
      ? Math.max(1, Math.min(240, Math.floor(Number(options.windowMinutes))))
      : 15;
    const windowMinutes = rawWindow;
    const windowMs = windowMinutes * 60_000;

    const until = new Date(now.getTime());
    const currentStart = new Date(until.getTime() - windowMs);
    const previousStart = new Date(currentStart.getTime() - windowMs);

    const untilIso = until.toISOString();
    const currentIso = currentStart.toISOString();
    const previousIso = previousStart.toISOString();

    let currentVoiceMs = 0;
    let previousVoiceMs = 0;
    let currentVoiceUsers = 0;
    let previousVoiceUsers = 0;

    try {
      const result = await pool.query(
        `SELECT
            SUM(CASE WHEN timestamp >= $2 THEN duration_ms ELSE 0 END) AS current_voice_ms,
            SUM(CASE WHEN timestamp >= $3 AND timestamp < $2 THEN duration_ms ELSE 0 END) AS previous_voice_ms,
            COUNT(DISTINCT CASE WHEN timestamp >= $2 THEN user_id::text END) AS current_voice_users,
            COUNT(DISTINCT CASE WHEN timestamp >= $3 AND timestamp < $2 THEN user_id::text END) AS previous_voice_users
          FROM voice_activity
         WHERE timestamp >= $3 AND timestamp < $1`,
        [untilIso, currentIso, previousIso],
      );

      const row = result.rows?.[0] ?? {};
      currentVoiceMs = Math.max(0, parseNumber(row.current_voice_ms));
      previousVoiceMs = Math.max(0, parseNumber(row.previous_voice_ms));
      currentVoiceUsers = Math.max(0, Math.floor(parseNumber(row.current_voice_users)));
      previousVoiceUsers = Math.max(0, Math.floor(parseNumber(row.previous_voice_users)));
    } catch (error) {
      console.error('Failed to compute voice statistics for community pulse', error);
    }

    const hasTextMessages = Boolean(this.textMessagesColumns && this.textMessagesColumns.size > 0);
    const hasTextMessageUserId = Boolean(this.textMessagesColumns?.has('user_id'));

    let currentMessages = 0;
    let previousMessages = 0;

    if (hasTextMessages) {
      try {
        const result = await pool.query(
          `SELECT
              COUNT(*) FILTER (WHERE timestamp >= $2) AS current_messages,
              COUNT(*) FILTER (WHERE timestamp >= $3 AND timestamp < $2) AS previous_messages
             FROM text_messages
            WHERE timestamp >= $3 AND timestamp < $1`,
          [untilIso, currentIso, previousIso],
        );
        const row = result.rows?.[0] ?? {};
        currentMessages = Math.max(0, Math.floor(parseNumber(row.current_messages)));
        previousMessages = Math.max(0, Math.floor(parseNumber(row.previous_messages)));
      } catch (error) {
        console.error('Failed to compute text statistics for community pulse', error);
      }
    }

    let currentMembers = currentVoiceUsers;
    let previousMembers = previousVoiceUsers;

    if (hasTextMessages && hasTextMessageUserId) {
      try {
        const result = await pool.query(
          `WITH combined AS (
              SELECT user_id::text AS user_id, timestamp
                FROM voice_activity
               WHERE timestamp >= $3 AND timestamp < $1
              UNION ALL
              SELECT user_id::text AS user_id, timestamp
                FROM text_messages
               WHERE timestamp >= $3 AND timestamp < $1
            )
            SELECT
              COUNT(DISTINCT CASE WHEN timestamp >= $2 THEN user_id END) AS current_members,
              COUNT(DISTINCT CASE WHEN timestamp >= $3 AND timestamp < $2 THEN user_id END) AS previous_members
              FROM combined`,
          [untilIso, currentIso, previousIso],
        );
        const row = result.rows?.[0] ?? {};
        const combinedCurrent = Math.max(0, Math.floor(parseNumber(row.current_members)));
        const combinedPrevious = Math.max(0, Math.floor(parseNumber(row.previous_members)));
        currentMembers = combinedCurrent;
        previousMembers = combinedPrevious;
      } catch (error) {
        console.warn('Failed to compute combined member statistics for community pulse', error);
      }
    }

    const voiceMinutesCurrent = Math.max(0, currentVoiceMs / 60_000);
    const voiceMinutesPrevious = Math.max(0, previousVoiceMs / 60_000);

    const buildMetric = (
      current: number,
      previous: number,
      decimals: number,
      threshold: number,
    ): CommunityPulseMetricSnapshot => {
      const safeCurrent = Number.isFinite(current) ? current : 0;
      const safePrevious = Number.isFinite(previous) ? previous : 0;
      const rawChange = safeCurrent - safePrevious;
      const roundedCurrent =
        decimals > 0 ? Number(safeCurrent.toFixed(decimals)) : Math.round(safeCurrent);
      const roundedPrevious =
        decimals > 0 ? Number(safePrevious.toFixed(decimals)) : Math.round(safePrevious);
      const roundedChange = decimals > 0 ? Number(rawChange.toFixed(decimals)) : Math.round(rawChange);
      let trend: CommunityPulseTrend = 'steady';
      if (rawChange > threshold) {
        trend = 'up';
      } else if (rawChange < -threshold) {
        trend = 'down';
      }
      return {
        current: roundedCurrent,
        previous: roundedPrevious,
        change: roundedChange,
        trend,
      };
    };

    return {
      generatedAt: untilIso,
      windowMinutes,
      voiceMinutes: buildMetric(voiceMinutesCurrent, voiceMinutesPrevious, 2, 0.05),
      activeMembers: buildMetric(currentMembers, previousMembers, 0, 0.5),
      messageCount: buildMetric(currentMessages, previousMessages, 0, 0.5),
    };
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
