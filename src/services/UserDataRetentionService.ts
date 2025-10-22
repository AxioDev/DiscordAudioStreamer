import type VoiceActivityRepository from './VoiceActivityRepository';

export interface UserDataRetentionServiceOptions {
  voiceActivityRepository?: VoiceActivityRepository | null;
  retentionPeriodMs?: number;
  intervalMs?: number;
  batchSize?: number;
}

const DEFAULT_RETENTION_PERIOD_MS = ((28 * 24) + 23) * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 25;

export default class UserDataRetentionService {
  private readonly repository: VoiceActivityRepository | null;

  private readonly retentionPeriodMs: number;

  private readonly intervalMs: number;

  private readonly batchSize: number;

  private timer: NodeJS.Timeout | null = null;

  private cleanupPromise: Promise<void> | null = null;

  constructor({
    voiceActivityRepository = null,
    retentionPeriodMs = DEFAULT_RETENTION_PERIOD_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
  }: UserDataRetentionServiceOptions) {
    this.repository = voiceActivityRepository ?? null;
    this.retentionPeriodMs = Math.max(0, Math.floor(retentionPeriodMs));
    this.intervalMs = Math.max(60 * 1000, Math.floor(intervalMs));
    this.batchSize = Math.max(1, Math.floor(batchSize));
  }

  public start(): void {
    if (!this.repository || this.retentionPeriodMs <= 0 || this.timer) {
      return;
    }

    const runCleanup = () => {
      if (this.cleanupPromise) {
        return;
      }
      this.cleanupPromise = this.runOnce().finally(() => {
        this.cleanupPromise = null;
      });
    };

    runCleanup();
    this.timer = setInterval(runCleanup, this.intervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runOnce(): Promise<void> {
    if (!this.repository || this.retentionPeriodMs <= 0) {
      return;
    }

    const cutoff = new Date(Date.now() - this.retentionPeriodMs);

    try {
      let totalPurged = 0;
      while (true) {
        const purged = await this.repository.purgeDepartedUsers({ cutoff, limit: this.batchSize });
        if (!purged) {
          break;
        }
        totalPurged += purged;
        if (purged < this.batchSize) {
          break;
        }
      }

      if (totalPurged > 0) {
        console.info(
          'UserDataRetentionService: purged %d departed user(s) older than %s',
          totalPurged,
          cutoff.toISOString(),
        );
      }
    } catch (error) {
      console.error('UserDataRetentionService: failed to purge departed users', error);
    }
  }
}
