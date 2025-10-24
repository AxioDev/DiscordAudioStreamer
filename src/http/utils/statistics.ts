import type { Request } from 'express';
import type { StatisticsQueryOptions } from '../../services/StatisticsService';

export function parseStatisticsQuery(query: Request['query']): StatisticsQueryOptions {
  const source = (query && typeof query === 'object' ? query : {}) as Record<string, unknown>;

  const extractString = (value: unknown): string | null => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const candidate = extractString(entry);
        if (candidate) {
          return candidate;
        }
      }
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  };

  const extractStringArray = (value: unknown): string[] => {
    const result: string[] = [];
    const visit = (input: unknown): void => {
      if (Array.isArray(input)) {
        for (const item of input) {
          visit(item);
        }
        return;
      }
      if (typeof input === 'string') {
        input
          .split(/[;,]/)
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0)
          .forEach((segment) => {
            if (!result.includes(segment)) {
              result.push(segment);
            }
          });
      }
    };
    visit(value);
    return result;
  };

  const parseDate = (value: string | null): Date | null => {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const parseNumber = (value: string | null): number | null => {
    if (!value) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const parseBoolean = (value: string | null): boolean | null => {
    if (!value) {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'vrai'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off', 'faux'].includes(normalized)) {
      return false;
    }
    return null;
  };

  const sinceRaw = extractString(source.since ?? source.from ?? source.start);
  const untilRaw = extractString(source.until ?? source.to ?? source.end);
  const granularity = extractString(source.granularity ?? source.range ?? source.interval ?? source.bucket);

  const activityTypes = extractStringArray(source.activity ?? source.activities ?? source.type ?? source.types);
  const channelIds = extractStringArray(source.channel ?? source.channelId ?? source.channels);
  const retentionValues = extractStringArray(source.retention ?? source.retentionDays ?? source.retention_window);
  const retentionWindows = retentionValues
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  const limitTopMembers = parseNumber(extractString(source.limitTop ?? source.top ?? source.limit));
  const limitChannels = parseNumber(
    extractString(source.limitChannels ?? source.channelsLimit ?? source.limitChannelsTop),
  );

  const includeHeatmap = parseBoolean(extractString(source.heatmap ?? source.includeHeatmap));
  const includeHypeHistory = parseBoolean(
    extractString(source.hype ?? source.includeHype ?? source.hypeHistory),
  );

  const userSearch = extractString(source.userSearch ?? source.searchUser ?? source.search);
  const userId = extractString(source.userId ?? source.member ?? source.user);

  const options: StatisticsQueryOptions = {
    since: parseDate(sinceRaw),
    until: parseDate(untilRaw),
    granularity: granularity ?? undefined,
    activityTypes: activityTypes.length > 0 ? activityTypes : undefined,
    channelIds: channelIds.length > 0 ? channelIds : undefined,
    userId: userId ?? undefined,
    retentionWindowDays: retentionWindows.length > 0 ? retentionWindows : undefined,
    userSearch: userSearch ?? undefined,
  };

  if (Number.isFinite(limitTopMembers)) {
    options.limitTopMembers = limitTopMembers ?? undefined;
  }
  if (Number.isFinite(limitChannels)) {
    options.limitChannels = limitChannels ?? undefined;
  }
  if (includeHeatmap !== null) {
    options.includeHeatmap = includeHeatmap;
  }
  if (includeHypeHistory !== null) {
    options.includeHypeHistory = includeHypeHistory;
  }

  return options;
}
