import type { Config } from '../config';
import type VoiceActivityRepository from './VoiceActivityRepository';

export type StatisticsActivityType =
  | 'voice'
  | 'text'
  | 'arrivals'
  | 'departures'
  | 'mentions'
  | 'hype';

export type StatisticsGranularity = 'day' | 'week' | 'month' | 'year';

export interface StatisticsQueryOptions {
  since?: Date | string | number | null;
  until?: Date | string | number | null;
  granularity?: StatisticsGranularity | string | null;
  activityTypes?: StatisticsActivityType[] | ReadonlyArray<StatisticsActivityType | string> | null;
  channelIds?: string[] | ReadonlyArray<string> | null;
  userId?: string | null;
  retentionWindowDays?: number | number[] | ReadonlyArray<number> | null;
  limitTopMembers?: number | null;
  limitChannels?: number | null;
  includeHeatmap?: boolean | null;
  includeHypeHistory?: boolean | null;
  userSearch?: string | null;
}

export interface StatisticsChannelSuggestion {
  channelId: string;
  channelName: string | null;
  channelType: 'text' | 'voice' | 'unknown';
  activityScore: number;
}

export interface StatisticsUserSuggestion {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
}

export interface StatisticsTotals {
  totalMembers: number;
  activeMembers: number;
  newMembers: number;
  voiceMinutes: number;
  messageCount: number;
  averageConnectedPerHour: number;
  retentionRate: number | null;
  growthRate: number | null;
}

export interface StatisticsSeriesPoint {
  bucket: string;
  voiceMinutes: number;
  messageCount: number;
  activeMembers: number;
}

export interface StatisticsNewMemberPoint {
  bucket: string;
  count: number;
}

export interface StatisticsTopMemberEntry {
  userId: string;
  displayName: string;
  username: string | null;
  voiceMinutes: number;
  messageCount: number;
  activityScore: number;
}

export interface StatisticsChannelActivityEntry {
  channelId: string | null;
  channelName: string | null;
  voiceMinutes: number;
  messageCount: number;
}

export interface StatisticsRetentionBucket {
  windowDays: number;
  returningUsers: number;
  totalUsers: number;
  rate: number | null;
}

export interface StatisticsHeatmapEntry {
  source: 'voice' | 'text';
  dayOfWeek: number;
  hour: number;
  value: number;
}

export interface StatisticsHypeHistoryEntry {
  bucketStart: string;
  averageSchScore: number | null;
  leaderCount: number;
}

export interface CommunityStatisticsSnapshot {
  generatedAt: string;
  timezone: string;
  totals: StatisticsTotals;
  newMembers: StatisticsNewMemberPoint[];
  activitySeries: StatisticsSeriesPoint[];
  topMembers: StatisticsTopMemberEntry[];
  channelActivity: {
    voice: StatisticsChannelActivityEntry[];
    text: StatisticsChannelActivityEntry[];
  };
  retention: StatisticsRetentionBucket[];
  heatmap: StatisticsHeatmapEntry[];
  hypeHistory: StatisticsHypeHistoryEntry[];
  availableChannels: StatisticsChannelSuggestion[];
  availableUsers: StatisticsUserSuggestion[];
}

interface NormalizedStatisticsQueryOptions {
  since: Date | null;
  until: Date;
  granularity: StatisticsGranularity;
  activityTypes: Set<StatisticsActivityType>;
  channelIds: string[];
  userId: string | null;
  retentionWindows: number[];
  limitTopMembers: number;
  limitChannels: number;
  includeHeatmap: boolean;
  includeHypeHistory: boolean;
  userSearch: string | null;
}

interface StatisticsServiceOptions {
  repository: VoiceActivityRepository;
  config: Config;
  defaultGranularity?: StatisticsGranularity;
  defaultRangeDays?: number;
  maxRangeDays?: number;
  defaultRetentionWindows?: ReadonlyArray<number>;
  defaultLimitTopMembers?: number;
  defaultLimitChannels?: number;
}

const GRANULARITIES: StatisticsGranularity[] = ['day', 'week', 'month', 'year'];

const MAX_TOP_MEMBERS = 100;
const MAX_CHANNEL_LIMIT = 50;

export default class StatisticsService {
  private readonly repository: VoiceActivityRepository;

  private readonly timezone: string;

  private readonly defaultGranularity: StatisticsGranularity;

  private readonly defaultRangeDays: number;

  private readonly maxRangeDays: number;

  private readonly defaultRetentionWindows: number[];

  private readonly defaultLimitTopMembers: number;

  private readonly defaultLimitChannels: number;

  constructor({
    repository,
    config,
    defaultGranularity = 'week',
    defaultRangeDays = 30,
    maxRangeDays = 365,
    defaultRetentionWindows = [7, 30, 90],
    defaultLimitTopMembers = 15,
    defaultLimitChannels = 12,
  }: StatisticsServiceOptions) {
    this.repository = repository;
    this.timezone = config.timezone ?? 'Europe/Paris';
    this.defaultGranularity = GRANULARITIES.includes(defaultGranularity)
      ? defaultGranularity
      : 'week';
    this.defaultRangeDays = Math.max(1, Math.floor(defaultRangeDays));
    this.maxRangeDays = Math.max(this.defaultRangeDays, Math.floor(maxRangeDays));
    this.defaultRetentionWindows = Array.from(new Set(defaultRetentionWindows))
      .map((value) => Math.max(1, Math.floor(value)))
      .sort((a, b) => a - b);
    this.defaultLimitTopMembers = Math.min(Math.max(5, Math.floor(defaultLimitTopMembers)), MAX_TOP_MEMBERS);
    this.defaultLimitChannels = Math.min(Math.max(5, Math.floor(defaultLimitChannels)), MAX_CHANNEL_LIMIT);
  }

  private normalizeDate(value: Date | string | number | null | undefined): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private normalizeGranularity(value: StatisticsGranularity | string | null | undefined): StatisticsGranularity {
    if (typeof value !== 'string') {
      return this.defaultGranularity;
    }
    const normalized = value.trim().toLowerCase();
    if (GRANULARITIES.includes(normalized as StatisticsGranularity)) {
      return normalized as StatisticsGranularity;
    }
    switch (normalized) {
      case 'jour':
      case 'daily':
        return 'day';
      case 'hebdo':
      case 'hebdomadaire':
      case 'weekly':
        return 'week';
      case 'mensuel':
      case 'monthly':
        return 'month';
      case 'annuel':
      case 'yearly':
        return 'year';
      default:
        return this.defaultGranularity;
    }
  }

  private normalizeActivityTypes(
    value: StatisticsQueryOptions['activityTypes'],
  ): Set<StatisticsActivityType> {
    const fallback = new Set<StatisticsActivityType>(['voice', 'text', 'arrivals', 'departures', 'mentions', 'hype']);
    if (!value) {
      return fallback;
    }
    const normalized = new Set<StatisticsActivityType>();
    for (const entry of value) {
      if (typeof entry !== 'string') {
        continue;
      }
      const token = entry.trim().toLowerCase();
      switch (token) {
        case 'voice':
        case 'vocal':
        case 'audio':
          normalized.add('voice');
          break;
        case 'text':
        case 'texte':
        case 'message':
        case 'messages':
          normalized.add('text');
          break;
        case 'arrivals':
        case 'joins':
        case 'arrivees':
        case 'arrivées':
          normalized.add('arrivals');
          break;
        case 'departures':
        case 'leaves':
        case 'depart':
        case 'départ':
        case 'departs':
          normalized.add('departures');
          break;
        case 'mentions':
          normalized.add('mentions');
          break;
        case 'hype':
          normalized.add('hype');
          break;
        default:
          break;
      }
    }
    return normalized.size > 0 ? normalized : fallback;
  }

  private normalizeIds(values: StatisticsQueryOptions['channelIds']): string[] {
    if (!values) {
      return [];
    }
    const normalized = new Set<string>();
    for (const entry of values) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        normalized.add(trimmed);
      }
    }
    return Array.from(normalized);
  }

  private normalizeRetentionWindows(
    values: StatisticsQueryOptions['retentionWindowDays'],
  ): number[] {
    if (!values) {
      return [...this.defaultRetentionWindows];
    }
    const result: number[] = [];
    const append = (value: number) => {
      if (!Number.isFinite(value)) {
        return;
      }
      const normalized = Math.max(1, Math.floor(value));
      if (!result.includes(normalized)) {
        result.push(normalized);
      }
    };
    if (Array.isArray(values)) {
      for (const value of values) {
        append(Number(value));
      }
    } else if (typeof values === 'number') {
      append(values);
    }
    if (result.length === 0) {
      return [...this.defaultRetentionWindows];
    }
    result.sort((a, b) => a - b);
    return result.slice(0, 5);
  }

  private clampRange(since: Date | null, until: Date): { since: Date | null; until: Date } {
    const now = new Date();
    const safeUntil = Number.isNaN(until.getTime()) ? now : until;
    let safeSince = since && !Number.isNaN(since.getTime()) ? since : null;
    if (safeSince && safeSince > safeUntil) {
      [safeSince] = [safeUntil];
    }
    if (!safeSince) {
      const fallback = new Date(safeUntil.getTime() - this.defaultRangeDays * 24 * 60 * 60 * 1000);
      safeSince = fallback;
    }
    const maxDeltaMs = this.maxRangeDays * 24 * 60 * 60 * 1000;
    if (safeUntil.getTime() - safeSince.getTime() > maxDeltaMs) {
      safeSince = new Date(safeUntil.getTime() - maxDeltaMs);
    }
    return { since: safeSince, until: safeUntil };
  }

  private normalizeLimit(value: number | null | undefined, fallback: number, max: number): number {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    const normalized = Math.max(1, Math.floor(Number(value)));
    return Math.min(normalized, max);
  }

  private normalizeOptions(options: StatisticsQueryOptions = {}): NormalizedStatisticsQueryOptions {
    const rawSince = this.normalizeDate(options.since ?? null);
    const rawUntil = this.normalizeDate(options.until ?? new Date());
    const { since, until } = this.clampRange(rawSince, rawUntil ?? new Date());
    const activityTypes = this.normalizeActivityTypes(options.activityTypes);
    const channelIds = this.normalizeIds(options.channelIds);
    const userId = typeof options.userId === 'string' ? options.userId.trim() || null : null;
    const retentionWindows = this.normalizeRetentionWindows(options.retentionWindowDays);
    const granularity = this.normalizeGranularity(options.granularity ?? null);
    const limitTopMembers = this.normalizeLimit(options.limitTopMembers ?? null, this.defaultLimitTopMembers, MAX_TOP_MEMBERS);
    const limitChannels = this.normalizeLimit(options.limitChannels ?? null, this.defaultLimitChannels, MAX_CHANNEL_LIMIT);
    const includeHeatmap = options.includeHeatmap !== false;
    const includeHypeHistory = options.includeHypeHistory !== false;
    const userSearch = typeof options.userSearch === 'string' ? options.userSearch.trim() || null : null;

    return {
      since,
      until,
      granularity,
      activityTypes,
      channelIds,
      userId,
      retentionWindows,
      limitTopMembers,
      limitChannels,
      includeHeatmap,
      includeHypeHistory,
      userSearch,
    };
  }

  public async getStatistics(options: StatisticsQueryOptions = {}): Promise<CommunityStatisticsSnapshot> {
    const normalized = this.normalizeOptions(options);
    const nowIso = new Date().toISOString();

    const [snapshot, userSuggestions, channelSuggestions] = await Promise.all([
      this.repository.getCommunityStatistics({
        since: normalized.since,
        until: normalized.until,
        granularity: normalized.granularity,
        activityTypes: Array.from(normalized.activityTypes),
        channelIds: normalized.channelIds,
        userId: normalized.userId,
        retentionWindows: normalized.retentionWindows,
        limitTopMembers: normalized.limitTopMembers,
        limitChannels: normalized.limitChannels,
        includeHeatmap: normalized.includeHeatmap,
        includeHypeHistory: normalized.includeHypeHistory,
        timezone: this.timezone,
      }),
      normalized.userSearch
        ? this.repository.searchUsersByName({ query: normalized.userSearch, limit: 6 })
        : Promise.resolve([]),
      this.repository.listActiveChannels({
        since: normalized.since,
        until: normalized.until,
        limit: normalized.limitChannels,
      }),
    ]);

    return {
      generatedAt: nowIso,
      timezone: this.timezone,
      totals: snapshot.totals,
      newMembers: snapshot.newMembers,
      activitySeries: snapshot.activitySeries,
      topMembers: snapshot.topMembers,
      channelActivity: snapshot.channelActivity,
      retention: snapshot.retention,
      heatmap: snapshot.heatmap,
      hypeHistory: snapshot.hypeHistory,
      availableChannels: channelSuggestions,
      availableUsers: userSuggestions,
    };
  }
}
