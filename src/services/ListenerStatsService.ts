export type ListenerStatsReason = 'connect' | 'disconnect' | 'snapshot';

export interface ListenerStatsEntry {
  timestamp: number;
  count: number;
}

export interface ListenerStatsUpdate {
  entry: ListenerStatsEntry;
  inserted: boolean;
  count: number;
  reason: ListenerStatsReason;
  delta: number;
}

export interface ListenerStatsServiceOptions {
  historyTtlMs?: number;
  snapshotIntervalMs?: number;
}

const DEFAULT_HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SNAPSHOT_INTERVAL_MS = 60_000;

export default class ListenerStatsService {
  private readonly historyTtlMs: number;

  private readonly snapshotIntervalMs: number;

  private readonly updateListeners: Set<(update: ListenerStatsUpdate) => void>;

  private currentCount = 0;

  private history: ListenerStatsEntry[] = [];

  private snapshotTimer: NodeJS.Timeout | null = null;

  constructor({ historyTtlMs, snapshotIntervalMs }: ListenerStatsServiceOptions = {}) {
    this.historyTtlMs = Math.max(60_000, historyTtlMs ?? DEFAULT_HISTORY_TTL_MS);
    this.snapshotIntervalMs = Math.max(1_000, snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS);
    this.updateListeners = new Set();

    const now = Date.now();
    this.history.push({ timestamp: now, count: this.currentCount });

    this.startSnapshotTimer();
  }

  private startSnapshotTimer(): void {
    if (!Number.isFinite(this.snapshotIntervalMs) || this.snapshotIntervalMs <= 0) {
      return;
    }

    this.snapshotTimer = setInterval(() => {
      this.recordSnapshot();
    }, this.snapshotIntervalMs);

    if (typeof this.snapshotTimer.unref === 'function') {
      this.snapshotTimer.unref();
    }
  }

  private notify(update: ListenerStatsUpdate): void {
    for (const listener of this.updateListeners) {
      try {
        listener(update);
      } catch (error) {
        console.warn('Listener stats update listener failed', error);
      }
    }
  }

  private addEntry(entry: ListenerStatsEntry, forceInsert: boolean): { entry: ListenerStatsEntry; inserted: boolean } {
    const timestamp = Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now();
    const count = Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : this.currentCount;

    const lastIndex = this.history.length - 1;
    const lastEntry = lastIndex >= 0 ? this.history[lastIndex] : null;

    if (!forceInsert && lastEntry && lastEntry.count === count) {
      const updated: ListenerStatsEntry = { timestamp, count };
      this.history[lastIndex] = updated;
      this.trimHistory(timestamp);
      return { entry: updated, inserted: false };
    }

    const nextEntry: ListenerStatsEntry = { timestamp, count };
    this.history.push(nextEntry);
    this.trimHistory(timestamp);
    return { entry: nextEntry, inserted: true };
  }

  private trimHistory(referenceTimestamp: number): void {
    const cutoff = referenceTimestamp - this.historyTtlMs;
    if (!Number.isFinite(cutoff)) {
      return;
    }

    while (this.history.length > 1 && this.history[0]?.timestamp < cutoff) {
      this.history.shift();
    }
  }

  private recordSnapshot(): void {
    const { entry, inserted } = this.addEntry({ timestamp: Date.now(), count: this.currentCount }, false);
    const update: ListenerStatsUpdate = {
      entry,
      inserted,
      count: this.currentCount,
      reason: 'snapshot',
      delta: 0,
    };
    this.notify(update);
  }

  public increment(): ListenerStatsUpdate {
    const previous = this.currentCount;
    this.currentCount += 1;
    const { entry, inserted } = this.addEntry({ timestamp: Date.now(), count: this.currentCount }, true);
    const update: ListenerStatsUpdate = {
      entry,
      inserted,
      count: this.currentCount,
      reason: 'connect',
      delta: this.currentCount - previous,
    };
    this.notify(update);
    return update;
  }

  public decrement(): ListenerStatsUpdate | null {
    if (this.currentCount <= 0) {
      return null;
    }

    const previous = this.currentCount;
    this.currentCount = Math.max(0, this.currentCount - 1);
    const { entry, inserted } = this.addEntry({ timestamp: Date.now(), count: this.currentCount }, true);
    const update: ListenerStatsUpdate = {
      entry,
      inserted,
      count: this.currentCount,
      reason: 'disconnect',
      delta: this.currentCount - previous,
    };
    this.notify(update);
    return update;
  }

  public getCurrentCount(): number {
    return this.currentCount;
  }

  public getHistory(): ListenerStatsEntry[] {
    return this.history.map((entry) => ({ ...entry }));
  }

  public onUpdate(listener: (update: ListenerStatsUpdate) => void): () => void {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  public stop(): void {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.updateListeners.clear();
  }
}
