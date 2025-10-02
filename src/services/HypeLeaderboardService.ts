import type VoiceActivityRepository from './VoiceActivityRepository';
import type {
  HypeLeaderEntry,
  HypeLeaderboardQueryOptions,
  HypeLeaderboardSnapshotEntry,
  HypeLeaderboardSnapshotOptions,
  HypeLeaderboardSortBy,
  HypeLeaderboardSortOrder,
} from './VoiceActivityRepository';

export type LeaderboardPositionMovement = 'up' | 'down' | 'same' | 'new';

export interface LeaderboardPositionTrend {
  rank: number;
  previousRank: number | null;
  delta: number | null;
  movement: LeaderboardPositionMovement;
  comparedAt: Date | null;
}

export interface HypeLeaderWithTrend extends HypeLeaderEntry {
  rank: number;
  positionTrend: LeaderboardPositionTrend;
}

export interface HypeLeaderboardResult {
  leaders: HypeLeaderWithTrend[];
  snapshot: {
    bucketStart: Date;
    comparedTo: Date | null;
  };
}

export interface NormalizedHypeLeaderboardQueryOptions {
  limit: number;
  search: string | null;
  sortBy: HypeLeaderboardSortBy;
  sortOrder: HypeLeaderboardSortOrder;
  periodDays: number | null;
}

interface HypeLeaderboardServiceOptions {
  repository: VoiceActivityRepository;
  snapshotIntervalMs?: number;
}

export default class HypeLeaderboardService {
  private readonly repository: VoiceActivityRepository;

  private readonly snapshotIntervalMs: number;

  private readonly defaultOptions: NormalizedHypeLeaderboardQueryOptions = {
    limit: 100,
    search: null,
    sortBy: 'schScoreNorm',
    sortOrder: 'desc',
    periodDays: null,
  };

  constructor({ repository, snapshotIntervalMs = 60 * 60 * 1000 }: HypeLeaderboardServiceOptions) {
    this.repository = repository;
    this.snapshotIntervalMs = Math.max(60_000, snapshotIntervalMs);
  }

  public getDefaultOptions(): NormalizedHypeLeaderboardQueryOptions {
    return { ...this.defaultOptions };
  }

  public normalizeOptions(
    options?: HypeLeaderboardQueryOptions | NormalizedHypeLeaderboardQueryOptions | null,
  ): NormalizedHypeLeaderboardQueryOptions {
    const limit = (() => {
      if (!options || !Number.isFinite(options.limit)) {
        return this.defaultOptions.limit;
      }
      const normalized = Math.max(1, Math.floor(Number(options.limit)));
      return Math.min(normalized, 200);
    })();

    const search = (() => {
      const candidate = options?.search;
      if (typeof candidate !== 'string') {
        return this.defaultOptions.search;
      }
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed : this.defaultOptions.search;
    })();

    const sortBy: HypeLeaderboardSortBy = (() => {
      const candidate = options?.sortBy;
      const allowed: HypeLeaderboardQueryOptions['sortBy'][] = [
        'schScoreNorm',
        'schRaw',
        'arrivalEffect',
        'departureEffect',
        'retentionMinutes',
        'activityScore',
        'sessions',
        'displayName',
      ];
      if (candidate && allowed.includes(candidate)) {
        return candidate as HypeLeaderboardSortBy;
      }
      return this.defaultOptions.sortBy;
    })();

    const sortOrder: HypeLeaderboardSortOrder = options?.sortOrder === 'asc' ? 'asc' : 'desc';

    const periodDays = (() => {
      if (!options || !Number.isFinite(options.periodDays)) {
        return this.defaultOptions.periodDays;
      }
      const normalized = Math.max(1, Math.floor(Number(options.periodDays)));
      return Math.min(normalized, 365);
    })();

    return { limit, search, sortBy, sortOrder, periodDays };
  }

  public buildCacheKey(options: NormalizedHypeLeaderboardQueryOptions): string {
    const parts = [
      `limit:${options.limit}`,
      `search:${options.search ?? ''}`,
      `sortBy:${options.sortBy}`,
      `sortOrder:${options.sortOrder}`,
      `period:${options.periodDays ?? 'all'}`,
    ];
    return parts.join('|');
  }

  public async getLeaderboardWithTrends(
    options: NormalizedHypeLeaderboardQueryOptions,
    now: Date = new Date(),
  ): Promise<HypeLeaderboardResult> {
    const leaders = await this.repository.listHypeLeaders(options);
    const ranked = leaders.map<HypeLeaderWithTrend>((leader, index) => ({
      ...leader,
      rank: index + 1,
      positionTrend: {
        rank: index + 1,
        previousRank: null,
        delta: null,
        movement: 'new',
        comparedAt: null,
      },
    }));

    const bucketStart = this.getBucketStart(now);
    const previousBucket = new Date(bucketStart.getTime() - this.snapshotIntervalMs);
    const optionsHash = this.buildCacheKey(options);

    const snapshotEntries: HypeLeaderboardSnapshotEntry[] = ranked.map((entry) => ({
      userId: entry.userId,
      rank: entry.rank,
      sessions: entry.sessions,
      activityScore: entry.activityScore,
      schScoreNorm: entry.schScoreNorm,
    }));

    await this.repository.saveHypeLeaderboardSnapshot({
      bucketStart,
      optionsHash,
      options: this.toSnapshotOptions(options),
      leaders: snapshotEntries,
    });

    const comparisonSnapshot =
      (await this.repository.loadHypeLeaderboardSnapshot({
        bucketStart: previousBucket,
        optionsHash,
      })) ||
      (await this.repository.loadLatestHypeLeaderboardSnapshot({
        optionsHash,
        before: bucketStart,
      }));

    const previousRankMap = new Map<string, number>();
    const comparedAt = comparisonSnapshot?.bucketStart ?? null;
    for (const leader of comparisonSnapshot?.leaders ?? []) {
      if (leader && typeof leader.userId === 'string') {
        previousRankMap.set(leader.userId, Number(leader.rank));
      }
    }

    for (const entry of ranked) {
      const previousRank = previousRankMap.has(entry.userId)
        ? Number(previousRankMap.get(entry.userId))
        : null;
      const delta = previousRank === null ? null : previousRank - entry.rank;
      let movement: LeaderboardPositionMovement = 'new';
      if (previousRank !== null) {
        if (delta === null || delta === 0) {
          movement = 'same';
        } else if (delta > 0) {
          movement = 'up';
        } else {
          movement = 'down';
        }
      }

      entry.positionTrend = {
        rank: entry.rank,
        previousRank,
        delta,
        movement,
        comparedAt,
      };
    }

    return {
      leaders: ranked,
      snapshot: {
        bucketStart,
        comparedTo: comparedAt,
      },
    };
  }

  private getBucketStart(date: Date): Date {
    const ms = date.getTime();
    if (!Number.isFinite(ms)) {
      return this.getBucketStart(new Date());
    }
    const bucket = Math.floor(ms / this.snapshotIntervalMs) * this.snapshotIntervalMs;
    return new Date(bucket);
  }

  private toSnapshotOptions(
    options: NormalizedHypeLeaderboardQueryOptions,
  ): HypeLeaderboardSnapshotOptions {
    return {
      limit: options.limit,
      search: options.search,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
      periodDays: options.periodDays,
    };
  }
}
