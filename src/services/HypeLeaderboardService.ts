import type { DiscordUserIdentity } from '../discord/DiscordAudioBridge';
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
  avatar?: string | null;
  avatarUrl?: string | null;
  profile?: { avatar: string | null } | null;
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

interface CachedIdentity {
  avatarUrl: string | null;
  displayName: string | null;
  username: string | null;
  fetchedAt: number;
}

type IdentityProvider = (
  userId: string,
) => Promise<Pick<DiscordUserIdentity, 'avatarUrl' | 'displayName' | 'username'> | null>;

type EnrichedLeader = HypeLeaderEntry & {
  avatar?: string | null;
  avatarUrl?: string | null;
  profile?: { avatar: string | null } | null;
};

interface BaseLeaderboardCache {
  periodKey: string;
  periodDays: number | null;
  bucketStart: Date;
  computedAt: Date;
  leaders: EnrichedLeader[];
}

interface CachedLeaderboardResult {
  cacheKey: string;
  snapshotOptions: NormalizedHypeLeaderboardQueryOptions;
  bucketStart: Date;
  computedAt: Date;
  result: HypeLeaderboardResult;
}

interface HypeLeaderboardServiceOptions {
  repository: VoiceActivityRepository;
  snapshotIntervalMs?: number;
  precomputePeriods?: ReadonlyArray<number | null>;
  precomputeSorts?: ReadonlyArray<HypeLeaderboardSortBy>;
  identityProvider?: IdentityProvider;
}

const DEFAULT_PRECOMPUTE_PERIODS: readonly (number | null)[] = [null, 7, 30, 90, 365];

const MIN_PRECOMPUTED_RESULT_TTL_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SORT_COLUMNS: readonly HypeLeaderboardSortBy[] = [
  'schScoreNorm',
  'schRaw',
  'arrivalEffect',
  'departureEffect',
  'retentionMinutes',
  'activityScore',
  'sessions',
  'displayName',
];

export default class HypeLeaderboardService {
  private readonly repository: VoiceActivityRepository;

  private readonly snapshotIntervalMs: number;

  private readonly defaultOptions: NormalizedHypeLeaderboardQueryOptions = {
    limit: 100,
    search: null,
    sortBy: 'schScoreNorm',
    sortOrder: 'desc',
    periodDays: 30,
  };

  private readonly precomputePeriods: readonly (number | null)[];

  private readonly sortableColumns: readonly HypeLeaderboardSortBy[];

  private readonly identityProvider?: IdentityProvider;

  private readonly identityCache = new Map<string, CachedIdentity>();

  private readonly identityCacheTtlMs = 6 * 60 * 60 * 1000;

  private readonly baseLeaderboards = new Map<string, BaseLeaderboardCache>();

  private readonly precomputedResults = new Map<string, CachedLeaderboardResult>();

  private readonly precomputedResultTtlMs: number;

  private refreshTimer: NodeJS.Timeout | null = null;

  private refreshPromise: Promise<void> | null = null;

  private readonly maxLeaderboardSize = 200;

  constructor({
    repository,
    snapshotIntervalMs = 60 * 60 * 1000,
    precomputePeriods = DEFAULT_PRECOMPUTE_PERIODS,
    precomputeSorts = DEFAULT_SORT_COLUMNS,
    identityProvider,
  }: HypeLeaderboardServiceOptions) {
    this.repository = repository;
    this.snapshotIntervalMs = Math.max(60_000, snapshotIntervalMs);
    this.precomputePeriods = precomputePeriods.length > 0 ? [...precomputePeriods] : DEFAULT_PRECOMPUTE_PERIODS;
    this.sortableColumns = precomputeSorts.length > 0 ? [...precomputeSorts] : DEFAULT_SORT_COLUMNS;
    this.identityProvider = identityProvider;
    this.precomputedResultTtlMs = Math.max(this.snapshotIntervalMs, MIN_PRECOMPUTED_RESULT_TTL_MS);
  }

  public getDefaultOptions(): NormalizedHypeLeaderboardQueryOptions {
    return { ...this.defaultOptions };
  }

  public async start(now: Date = new Date()): Promise<void> {
    await this.refreshPrecomputedLeaderboards(now);
    this.refreshTimer = setInterval(() => {
      void this.refreshPrecomputedLeaderboards(new Date()).catch((error) => {
        console.error('Scheduled hype leaderboard refresh failed', error);
      });
    }, this.snapshotIntervalMs);
    if (typeof this.refreshTimer.unref === 'function') {
      this.refreshTimer.unref();
    }
  }

  public stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.refreshPromise = null;
  }

  public normalizeOptions(
    options?: HypeLeaderboardQueryOptions | NormalizedHypeLeaderboardQueryOptions | null,
  ): NormalizedHypeLeaderboardQueryOptions {
    const limit = (() => {
      if (!options || !Number.isFinite(options.limit)) {
        return this.defaultOptions.limit;
      }
      const normalized = Math.max(1, Math.floor(Number(options.limit)));
      return Math.min(normalized, this.maxLeaderboardSize);
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
      if (candidate && this.sortableColumns.includes(candidate)) {
        return candidate;
      }
      return this.defaultOptions.sortBy;
    })();

    const sortOrder: HypeLeaderboardSortOrder = options?.sortOrder === 'asc' ? 'asc' : 'desc';

    const periodDays = (() => {
      if (!options) {
        return this.defaultOptions.periodDays;
      }
      if (options.periodDays === null) {
        return null;
      }
      if (!Number.isFinite(options.periodDays)) {
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
    const normalized = this.normalizeOptions(options);
    this.cleanupExpiredPrecomputedResults(now);
    const base = await this.ensureBaseLeaderboard(normalized.periodDays ?? null, now);
    if (!base) {
      const fallback = await this.rehydrateFromSnapshots(normalized);
      if (fallback) {
        return fallback;
      }
      const bucketStart = this.getBucketStart(now);
      return { leaders: [], snapshot: { bucketStart, comparedTo: null } };
    }

    const snapshotOptions: NormalizedHypeLeaderboardQueryOptions = {
      ...normalized,
      limit: normalized.search ? normalized.limit : this.maxLeaderboardSize,
    };

    const cacheKey = this.buildCacheKey(snapshotOptions);
    const cached = this.precomputedResults.get(cacheKey);
    if (cached && cached.bucketStart.getTime() === base.bucketStart.getTime()) {
      return {
        leaders: this.cloneLeaders(cached.result.leaders, normalized.limit),
        snapshot: cached.result.snapshot,
      };
    }

    const { ranked, comparedAt } = await this.buildRankedLeaders(base, snapshotOptions);
    const cachedResult: HypeLeaderboardResult = {
      leaders: ranked,
      snapshot: {
        bucketStart: base.bucketStart,
        comparedTo: comparedAt,
      },
    };

    this.precomputedResults.set(cacheKey, {
      cacheKey,
      snapshotOptions,
      bucketStart: base.bucketStart,
      computedAt: new Date(),
      result: cachedResult,
    });

    return {
      leaders: this.cloneLeaders(ranked, normalized.limit),
      snapshot: cachedResult.snapshot,
    };
  }

  private async refreshPrecomputedLeaderboards(now: Date): Promise<void> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }

    this.cleanupExpiredPrecomputedResults(now);

    const promise = (async () => {
      for (const period of this.precomputePeriods) {
        const base = await this.ensureBaseLeaderboard(period ?? null, now, true);
        if (!base) {
          continue;
        }
        for (const sortBy of this.sortableColumns) {
          for (const sortOrder of ['desc', 'asc'] as const) {
            const options = this.normalizeOptions({
              limit: this.maxLeaderboardSize,
              search: null,
              sortBy,
              sortOrder,
              periodDays: period === null ? null : period,
            });
            options.limit = this.maxLeaderboardSize;
            const cacheKey = this.buildCacheKey(options);
            const { ranked, comparedAt } = await this.buildRankedLeaders(base, options);
            const result: HypeLeaderboardResult = {
              leaders: ranked,
              snapshot: {
                bucketStart: base.bucketStart,
                comparedTo: comparedAt,
              },
            };
            this.precomputedResults.set(cacheKey, {
              cacheKey,
              snapshotOptions: options,
              bucketStart: base.bucketStart,
              computedAt: new Date(),
              result,
            });
          }
        }
      }
    })();

    this.refreshPromise = promise;
    try {
      await promise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async ensureBaseLeaderboard(
    periodDays: number | null,
    now: Date,
    forceRefresh = false,
  ): Promise<BaseLeaderboardCache | null> {
    const periodKey = this.getPeriodKey(periodDays);
    const bucketStart = this.getBucketStart(now);
    const existing = this.baseLeaderboards.get(periodKey);

    if (!forceRefresh && existing && existing.bucketStart.getTime() === bucketStart.getTime()) {
      return existing;
    }

    return this.computeBaseLeaderboard(periodDays, bucketStart);
  }

  private async computeBaseLeaderboard(
    periodDays: number | null,
    bucketStart: Date,
  ): Promise<BaseLeaderboardCache | null> {
    try {
      const leaders = await this.repository.listHypeLeaders({
        limit: null,
        search: null,
        sortBy: 'schScoreNorm',
        sortOrder: 'desc',
        periodDays,
      });

      const enriched = await this.enrichLeaders(leaders);
      const base: BaseLeaderboardCache = {
        periodKey: this.getPeriodKey(periodDays),
        periodDays,
        bucketStart,
        computedAt: new Date(),
        leaders: enriched,
      };
      this.baseLeaderboards.set(base.periodKey, base);
      return base;
    } catch (error) {
      console.error('Failed to compute base hype leaderboard', error);
      return null;
    }
  }

  private async rehydrateFromSnapshots(
    normalized: NormalizedHypeLeaderboardQueryOptions,
  ): Promise<HypeLeaderboardResult | null> {
    try {
      const snapshotOptions: NormalizedHypeLeaderboardQueryOptions = {
        ...normalized,
        limit: normalized.search ? normalized.limit : this.maxLeaderboardSize,
      };
      const optionsHash = this.buildCacheKey(snapshotOptions);
      const latestSnapshot = await this.repository.loadLatestHypeLeaderboardSnapshot({ optionsHash });
      if (!latestSnapshot) {
        return null;
      }

      const toNumber = (value: number | null | undefined): number => {
        if (value === null || value === undefined) {
          return 0;
        }
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const baseLeaders: HypeLeaderEntry[] = [];
      latestSnapshot.leaders.forEach((entry, index) => {
        if (!entry || typeof entry.userId !== 'string') {
          return;
        }

        const parseRank = (value: number | null | undefined): number | null => {
          if (value === null || value === undefined) {
            return null;
          }
          const numeric = Number(value);
          return Number.isFinite(numeric) ? numeric : null;
        };

        const candidateRank = parseRank(entry.absoluteRank) ?? parseRank(entry.rank) ?? index + 1;
        const absoluteRank = Math.max(1, Math.floor(candidateRank));

        const snapshotUsername = this.normalizeString(entry.username);
        const snapshotDisplayName =
          this.normalizeDisplayName(entry.displayName)
          ?? snapshotUsername
          ?? 'Anonyme';

        baseLeaders.push({
          userId: entry.userId,
          displayName: snapshotDisplayName,
          username: snapshotUsername,
          sessions: toNumber(entry.sessions),
          absoluteRank,
          arrivalEffect: toNumber(entry.arrivalEffect),
          departureEffect: toNumber(entry.departureEffect),
          retentionMinutes: toNumber(entry.retentionMinutes),
          activityScore: toNumber(entry.activityScore),
          schRaw: toNumber(entry.schRaw),
          schScoreNorm: toNumber(entry.schScoreNorm),
        });
      });

      const enriched = await this.enrichLeaders(baseLeaders);
      const periodKey = this.getPeriodKey(normalized.periodDays ?? null);
      const baseFromSnapshot: BaseLeaderboardCache = {
        periodKey,
        periodDays: normalized.periodDays ?? null,
        bucketStart: latestSnapshot.bucketStart,
        computedAt: latestSnapshot.updatedAt,
        leaders: enriched,
      };
      this.baseLeaderboards.set(periodKey, baseFromSnapshot);

      const { ranked, comparedAt } = await this.buildRankedLeaders(baseFromSnapshot, snapshotOptions);
      const result: HypeLeaderboardResult = {
        leaders: ranked,
        snapshot: {
          bucketStart: latestSnapshot.bucketStart,
          comparedTo: comparedAt,
        },
      };

      this.precomputedResults.set(optionsHash, {
        cacheKey: optionsHash,
        snapshotOptions,
        bucketStart: latestSnapshot.bucketStart,
        computedAt: latestSnapshot.updatedAt,
        result,
      });

      return {
        leaders: this.cloneLeaders(ranked, normalized.limit),
        snapshot: result.snapshot,
      };
    } catch (error) {
      console.error('Failed to rehydrate hype leaderboard from snapshots', error);
      return null;
    }
  }

  private async enrichLeaders(leaders: HypeLeaderEntry[]): Promise<EnrichedLeader[]> {
    if (leaders.length === 0) {
      return [];
    }

    const identityPromises = leaders.map((leader) => this.fetchIdentity(leader.userId));
    const identities = await Promise.all(identityPromises);

    return leaders.map<EnrichedLeader>((leader, index) => {
      const identity = identities[index];
      const avatarUrl = identity?.avatarUrl ?? null;
      const username = this.normalizeString(leader.username) ?? this.normalizeString(identity?.username);
      const displayName =
        this.normalizeDisplayName(leader.displayName)
        ?? this.normalizeDisplayName(identity?.displayName)
        ?? username
        ?? 'Anonyme';

      return {
        ...leader,
        displayName,
        username,
        avatar: avatarUrl,
        avatarUrl,
        profile: avatarUrl ? { avatar: avatarUrl } : null,
      };
    });
  }

  private async fetchIdentity(userId: string): Promise<CachedIdentity | null> {
    if (!this.identityProvider) {
      return null;
    }

    const cached = this.identityCache.get(userId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < this.identityCacheTtlMs) {
      return cached;
    }

    try {
      const identity = await this.identityProvider(userId);
      const normalized: CachedIdentity = {
        avatarUrl: this.normalizeString(identity?.avatarUrl) ?? null,
        displayName: this.normalizeString(identity?.displayName),
        username: this.normalizeString(identity?.username),
        fetchedAt: now,
      };
      this.identityCache.set(userId, normalized);
      return normalized;
    } catch (error) {
      console.warn('Failed to resolve Discord identity for leaderboard user', userId, error);
      if (cached) {
        cached.fetchedAt = now;
        return cached;
      }
      return null;
    }
  }

  private async buildRankedLeaders(
    base: BaseLeaderboardCache,
    options: NormalizedHypeLeaderboardQueryOptions,
  ): Promise<{ ranked: HypeLeaderWithTrend[]; comparedAt: Date | null }> {
    const sorted = this.sortLeaders(base.leaders, options);
    const totalLeaders = sorted.length;
    const absoluteRankMap = new Map<string, number>();

    for (let index = 0; index < totalLeaders; index += 1) {
      const leader = sorted[index];
      const normalizedRank = index + 1;
      absoluteRankMap.set(leader.userId, normalizedRank);
    }

    const filtered = this.applySearch(sorted, options.search);
    const limit = Math.min(options.limit, filtered.length);
    const limited = filtered.slice(0, limit);

    const ranked = limited.map<HypeLeaderWithTrend>((leader) => {
      const fallbackRank = totalLeaders + 1;
      const candidate = absoluteRankMap.get(leader.userId);
      const rank = Number.isFinite(candidate) && Number(candidate) > 0
        ? Math.floor(Number(candidate))
        : fallbackRank;

      return {
        ...leader,
        absoluteRank: rank,
        rank,
        positionTrend: {
          rank,
          previousRank: null,
          delta: null,
          movement: 'new',
          comparedAt: null,
        },
      };
    });

    const optionsHash = this.buildCacheKey(options);
    const snapshotEntries: HypeLeaderboardSnapshotEntry[] = ranked.map((entry) => ({
      userId: entry.userId,
      rank: entry.rank,
      absoluteRank: entry.absoluteRank,
      displayName: entry.displayName,
      username: entry.username,
      sessions: entry.sessions,
      arrivalEffect: entry.arrivalEffect,
      departureEffect: entry.departureEffect,
      retentionMinutes: entry.retentionMinutes,
      activityScore: entry.activityScore,
      schRaw: entry.schRaw,
      schScoreNorm: entry.schScoreNorm,
    }));

    await this.repository.saveHypeLeaderboardSnapshot({
      bucketStart: base.bucketStart,
      optionsHash,
      options: this.toSnapshotOptions(options),
      leaders: snapshotEntries,
    });

    const previousBucket = new Date(base.bucketStart.getTime() - this.snapshotIntervalMs);
    const comparisonSnapshot =
      (await this.repository.loadHypeLeaderboardSnapshot({
        bucketStart: previousBucket,
        optionsHash,
      })) ||
      (await this.repository.loadLatestHypeLeaderboardSnapshot({
        optionsHash,
        before: base.bucketStart,
      }));

    const previousRankMap = new Map<string, number>();
    const comparedAt = comparisonSnapshot?.bucketStart ?? null;
    for (const leader of comparisonSnapshot?.leaders ?? []) {
      if (leader && typeof leader.userId === 'string') {
        previousRankMap.set(leader.userId, Number(leader.rank));
      }
    }

    for (const entry of ranked) {
      const previousRank = previousRankMap.has(entry.userId) ? Number(previousRankMap.get(entry.userId)) : null;
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

    return { ranked, comparedAt };
  }

  private applySearch(leaders: EnrichedLeader[], search: string | null): EnrichedLeader[] {
    const normalized = this.normalizeString(search);
    if (!normalized) {
      return leaders;
    }

    const normalizedNeedle = this.normalizeSearchValue(normalized);
    if (!normalizedNeedle) {
      return leaders;
    }
    const needle = normalizedNeedle;
    return leaders.filter((leader) => {
      const display = this.normalizeSearchValue(leader.displayName);
      const username = this.normalizeSearchValue(leader.username);
      const displayMatch = typeof display === 'string' && display.includes(needle);
      const usernameMatch = typeof username === 'string' && username.includes(needle);
      return displayMatch || usernameMatch;
    });
  }

  private sortLeaders(
    leaders: EnrichedLeader[],
    options: NormalizedHypeLeaderboardQueryOptions,
  ): EnrichedLeader[] {
    const sorted = [...leaders];
    const direction = options.sortOrder === 'asc' ? 1 : -1;

    sorted.sort((a, b) => {
      const primary = this.compareBySort(a, b, options.sortBy);
      if (primary !== 0) {
        return direction * primary;
      }

      const fallbackScore = this.compareNumbers(b.schScoreNorm, a.schScoreNorm);
      if (fallbackScore !== 0) {
        return fallbackScore;
      }

      return this.compareStrings(a.displayName, b.displayName);
    });

    return sorted;
  }

  private cleanupExpiredPrecomputedResults(now: Date = new Date()): void {
    const referenceTime = now.getTime();
    if (!Number.isFinite(referenceTime)) {
      return;
    }

    const cutoff = referenceTime - this.precomputedResultTtlMs;

    for (const [cacheKey, cached] of this.precomputedResults) {
      const computedTime = cached.computedAt.getTime();
      if (!Number.isFinite(computedTime) || computedTime < cutoff) {
        this.precomputedResults.delete(cacheKey);
      }
    }
  }

  private compareBySort(a: EnrichedLeader, b: EnrichedLeader, sortBy: HypeLeaderboardSortBy): number {
    switch (sortBy) {
      case 'displayName':
        return this.compareStrings(a.displayName, b.displayName);
      case 'sessions':
        return this.compareNumbers(a.sessions, b.sessions);
      case 'arrivalEffect':
        return this.compareNumbers(a.arrivalEffect, b.arrivalEffect);
      case 'departureEffect':
        return this.compareNumbers(a.departureEffect, b.departureEffect);
      case 'retentionMinutes':
        return this.compareNumbers(a.retentionMinutes, b.retentionMinutes);
      case 'activityScore':
        return this.compareNumbers(a.activityScore, b.activityScore);
      case 'schRaw':
        return this.compareNumbers(a.schRaw, b.schRaw);
      case 'schScoreNorm':
      default:
        return this.compareNumbers(a.schScoreNorm, b.schScoreNorm);
    }
  }

  private compareNumbers(a: number | null | undefined, b: number | null | undefined): number {
    const left = Number.isFinite(a) ? Number(a) : 0;
    const right = Number.isFinite(b) ? Number(b) : 0;
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  }

  private compareStrings(a: string | null | undefined, b: string | null | undefined): number {
    const left = this.normalizeString(a) ?? '';
    const right = this.normalizeString(b) ?? '';
    if (left === right) {
      return 0;
    }
    return left.localeCompare(right, 'fr', { sensitivity: 'base' });
  }

  private normalizeSearchValue(value: string | null | undefined): string | null {
    const normalized = this.normalizeString(value);
    if (!normalized) {
      return null;
    }
    return normalized
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private normalizeString(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeDisplayName(value: string | null | undefined): string | null {
    const normalized = this.normalizeString(value);
    if (!normalized) {
      return null;
    }

    const simplified = normalized
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[·\-]/g, '');

    if (simplified === 'anonyme' || simplified === 'inconnu' || simplified === 'inconnue') {
      return null;
    }

    return normalized;
  }

  private cloneLeaders(leaders: HypeLeaderWithTrend[], limit: number): HypeLeaderWithTrend[] {
    return leaders.slice(0, limit).map((leader) => ({
      ...leader,
      positionTrend: { ...leader.positionTrend },
    }));
  }

  private getPeriodKey(periodDays: number | null): string {
    return periodDays === null ? 'all' : String(periodDays);
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
