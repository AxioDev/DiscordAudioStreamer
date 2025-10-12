import path from 'node:path';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';

export interface UserAudioRecorderOptions {
  baseDirectory: string;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
  retentionPeriodMs: number;
  cleanupIntervalMs?: number;
}

export interface UserAudioIdentity {
  id: string;
  username?: string | null;
  displayName?: string | null;
}

export interface UserAudioRecordingSession {
  readonly filePath: string;
  write(chunk: Buffer): void;
  finalize(): Promise<void>;
}

export interface ListUserAudioRecordingsOptions {
  since?: Date | null;
  until?: Date | null;
  limit?: number | null;
}

export interface UserAudioRecordingMetadata {
  readonly id: string;
  readonly fileName: string;
  readonly directoryName: string;
  readonly filePath: string;
  readonly createdAt: Date;
  readonly sizeBytes: number;
  readonly durationMs: number | null;
}

class RecordingSession implements UserAudioRecordingSession {
  private dataLength = 0;

  private ended = false;

  private finalizePromise: Promise<void> | null = null;

  constructor(
    private readonly stream: WriteStream,
    public readonly filePath: string,
    private readonly headerFactory: (size: number) => Buffer,
  ) {}

  public write(chunk: Buffer): void {
    if (this.ended) {
      return;
    }

    if (!chunk || chunk.length === 0) {
      return;
    }

    this.dataLength += chunk.length;
    this.stream.write(chunk);
  }

  public finalize(): Promise<void> {
    if (this.finalizePromise) {
      return this.finalizePromise;
    }

    this.finalizePromise = new Promise<void>((resolve, reject) => {
      if (this.ended) {
        resolve();
        return;
      }

      this.ended = true;
      this.stream.end((error: NodeJS.ErrnoException | null | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    })
      .then(async () => {
        const header = this.headerFactory(this.dataLength);
        const handle = await fs.open(this.filePath, 'r+');
        try {
          await handle.write(header, 0, header.length, 0);
        } finally {
          await handle.close();
        }
      })
      .catch(async (error: unknown) => {
        try {
          const handle = await fs.open(this.filePath, 'r');
          await handle.close();
        } catch (closeError) {
          console.warn('Failed to close recording file after finalize error', closeError);
        }
        throw error;
      });

    return this.finalizePromise;
  }
}

export default class UserAudioRecorder {
  private readonly baseDirectory: string;

  private readonly sampleRate: number;

  private readonly channels: number;

  private readonly bytesPerSample: number;

  private readonly retentionPeriodMs: number;

  private readonly cleanupIntervalMs: number;

  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor({
    baseDirectory,
    sampleRate,
    channels,
    bytesPerSample,
    retentionPeriodMs,
    cleanupIntervalMs,
  }: UserAudioRecorderOptions) {
    this.baseDirectory = path.resolve(baseDirectory);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bytesPerSample = bytesPerSample;
    this.retentionPeriodMs = Math.max(retentionPeriodMs, 0);
    this.cleanupIntervalMs = Math.max(cleanupIntervalMs ?? 12 * 60 * 60 * 1000, 60 * 60 * 1000);

    mkdirSync(this.baseDirectory, { recursive: true });

    if (this.retentionPeriodMs > 0) {
      void this.cleanupExpiredRecordings().catch((error) => {
        console.warn('Initial recording cleanup failed', { error });
      });

      this.startCleanupTask();
    }
  }

  public openSession(identity: UserAudioIdentity): UserAudioRecordingSession | null {
    try {
      const directory = this.resolveUserDirectory(identity);
      mkdirSync(directory, { recursive: true });

      const timestamp = this.formatTimestamp(new Date());
      const filePath = path.join(directory, `${timestamp}.wav`);
      const stream = createWriteStream(filePath);
      stream.write(this.createWavHeader(0));

      stream.on('error', (error: Error) => {
        console.error('Recording stream error', { filePath, error });
      });

      return new RecordingSession(stream, filePath, (size) => this.createWavHeader(size));
    } catch (error) {
      console.error('Failed to open user audio recording session', {
        userId: identity.id,
        error,
      });
      return null;
    }
  }

  public stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  public async listRecordings(
    userId: string,
    { since = null, until = null, limit = null }: ListUserAudioRecordingsOptions = {},
  ): Promise<UserAudioRecordingMetadata[]> {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      return [];
    }

    const nowMs = Date.now();
    const untilMs = this.normalizeTimestamp(until) ?? nowMs;
    const defaultSince = untilMs - 7 * 24 * 60 * 60 * 1000;
    const sinceMs = this.normalizeTimestamp(since) ?? defaultSince;

    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
      return [];
    }

    const maxEntries = Math.min(Math.max(Math.floor(limit ?? 25), 1), 100);

    const directories = await this.listUserDirectories(normalizedUserId);
    if (directories.length === 0) {
      return [];
    }

    const results: UserAudioRecordingMetadata[] = [];

    for (const directoryName of directories) {
      const directoryPath = path.join(this.baseDirectory, directoryName);
      let entries: Array<{ name: string; isFile(): boolean }> = [];
      try {
        const dirEntries = await fs.readdir(directoryPath, { withFileTypes: true });
        entries = dirEntries.filter((entry) => entry.isFile());
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('Failed to read recordings directory', { directory: directoryPath, error });
        }
        continue;
      }

      for (const entry of entries) {
        const fileName = entry.name;
        if (!this.isAudioFile(fileName)) {
          continue;
        }

        const filePath = path.join(directoryPath, fileName);
        let stats;
        try {
          stats = await fs.stat(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('Failed to read audio recording stats', { filePath, error });
          }
          continue;
        }

        const createdAtMs = this.resolveTimestamp(stats);
        if (createdAtMs == null || Number.isNaN(createdAtMs) || createdAtMs < sinceMs || createdAtMs > untilMs) {
          continue;
        }

        const id = this.encodeRecordingId(directoryName, fileName);
        const durationMs = this.estimateDuration(stats.size);
        results.push({
          id,
          fileName,
          directoryName,
          filePath,
          createdAt: new Date(createdAtMs),
          sizeBytes: stats.size,
          durationMs,
        });
      }
    }

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results.slice(0, maxEntries);
  }

  public async resolveRecording(userId: string, recordingId: string): Promise<UserAudioRecordingMetadata | null> {
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!normalizedUserId) {
      return null;
    }

    const decoded = this.decodeRecordingId(recordingId);
    if (!decoded) {
      return null;
    }

    const { directoryName, fileName } = decoded;
    if (!directoryName.startsWith(`${normalizedUserId}-`)) {
      return null;
    }

    if (!this.isSafeSegment(directoryName) || !this.isSafeSegment(fileName)) {
      return null;
    }

    const filePath = path.join(this.baseDirectory, directoryName, fileName);

    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to read audio recording for download', { filePath, error });
      }
      return null;
    }

    const createdAtMs = this.resolveTimestamp(stats);
    if (createdAtMs == null || Number.isNaN(createdAtMs)) {
      return null;
    }

    return {
      id: recordingId,
      fileName,
      directoryName,
      filePath,
      createdAt: new Date(createdAtMs),
      sizeBytes: stats.size,
      durationMs: this.estimateDuration(stats.size),
    };
  }

  private startCleanupTask(): void {
    if (this.cleanupIntervalMs <= 0 || this.retentionPeriodMs <= 0) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredRecordings().catch((error) => {
        console.warn('Scheduled recording cleanup failed', { error });
      });
    }, this.cleanupIntervalMs);

    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  private async cleanupExpiredRecordings(): Promise<void> {
    if (this.retentionPeriodMs <= 0) {
      return;
    }

    try {
      const entries = await fs.readdir(this.baseDirectory, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        const fullPath = path.join(this.baseDirectory, entry.name);
        if (entry.isDirectory()) {
          await this.cleanupDirectory(fullPath, now);
        } else if (entry.isFile()) {
          await this.deleteFileIfExpired(fullPath, now);
        }
      }
    } catch (error) {
      console.warn('Failed to scan recordings directory for cleanup', { error });
    }
  }

  private async cleanupDirectory(directory: string, now: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      console.warn('Failed to read recording directory during cleanup', { directory, error });
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.cleanupDirectory(fullPath, now);
      } else if (entry.isFile()) {
        await this.deleteFileIfExpired(fullPath, now);
      }
    }

    try {
      const remaining = await fs.readdir(directory);
      if (remaining.length === 0) {
        await fs.rm(directory, { recursive: false, force: false });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to remove empty recording directory', { directory, error });
      }
    }
  }

  private async deleteFileIfExpired(filePath: string, now: number): Promise<void> {
    if (this.retentionPeriodMs <= 0) {
      return;
    }

    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to read recording file stats during cleanup', { filePath, error });
      }
      return;
    }

    const modifiedTime = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : stats.birthtimeMs;
    const ageMs = now - modifiedTime;

    if (ageMs <= this.retentionPeriodMs) {
      return;
    }

    try {
      await fs.unlink(filePath);
      console.info('Deleted expired audio recording', { filePath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to delete expired recording file', { filePath, error });
      }
    }
  }

  private async listUserDirectories(userId: string): Promise<string[]> {
    let entries: Array<{ name: string; isDirectory(): boolean }> = [];
    try {
      const dirEntries = await fs.readdir(this.baseDirectory, { withFileTypes: true });
      entries = dirEntries.filter((entry) => entry.isDirectory());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('Failed to list user recording directories', { userId, error });
      }
      return [];
    }

    const prefix = `${userId}-`;
    return entries
      .map((entry) => entry.name)
      .filter((name) => typeof name === 'string' && name.startsWith(prefix));
  }

  private normalizeTimestamp(value: Date | null | undefined): number | null {
    if (!value || !(value instanceof Date)) {
      return null;
    }
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }

  private resolveTimestamp(stats: import('node:fs').Stats): number | null {
    const modified = Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null;
    const created = Number.isFinite(stats.birthtimeMs) ? stats.birthtimeMs : null;
    return modified ?? created;
  }

  private isAudioFile(fileName: string): boolean {
    if (typeof fileName !== 'string') {
      return false;
    }
    const lower = fileName.toLowerCase();
    return lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.endsWith('.ogg');
  }

  private estimateDuration(sizeBytes: number): number | null {
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return null;
    }

    const payloadBytes = Math.max(0, sizeBytes - 44);
    const bytesPerSecond = this.sampleRate * this.channels * this.bytesPerSample;
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
      return null;
    }

    const seconds = payloadBytes / bytesPerSecond;
    return Math.max(0, Math.round(seconds * 1000));
  }

  private encodeRecordingId(directoryName: string, fileName: string): string {
    const value = `${directoryName}/${fileName}`;
    const base64 = Buffer.from(value, 'utf8').toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private decodeRecordingId(recordingId: string): { directoryName: string; fileName: string } | null {
    if (typeof recordingId !== 'string' || recordingId.trim().length === 0) {
      return null;
    }

    const normalized = recordingId.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));

    let decoded: string;
    try {
      decoded = Buffer.from(normalized + padding, 'base64').toString('utf8');
    } catch (error) {
      console.warn('Failed to decode audio recording identifier', { recordingId, error });
      return null;
    }

    const normalizedPath = decoded.replace(/\\/g, '/');
    const segments = normalizedPath.split('/').filter((segment) => segment.length > 0);
    if (segments.length !== 2) {
      return null;
    }

    const [directoryName, fileName] = segments;
    if (!this.isSafeSegment(directoryName) || !this.isSafeSegment(fileName)) {
      return null;
    }

    return { directoryName, fileName };
  }

  private isSafeSegment(segment: string): boolean {
    if (typeof segment !== 'string' || segment.length === 0) {
      return false;
    }
    if (segment === '.' || segment === '..') {
      return false;
    }
    return !segment.includes('/') && !segment.includes('\\');
  }

  private resolveUserDirectory(identity: UserAudioIdentity): string {
    const baseName = this.toSafeSegment(identity.displayName || identity.username || 'unknown');
    const directoryName = `${identity.id}-${baseName}`;
    return path.join(this.baseDirectory, directoryName);
  }

  private toSafeSegment(value: string): string {
    const normalized = value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-');

    const trimmed = normalized.replace(/^-+/, '').replace(/-+$/, '');
    return trimmed.length > 0 ? trimmed : 'unknown';
  }

  private formatTimestamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
  }

  private createWavHeader(dataLength: number): Buffer {
    const header = Buffer.alloc(44);
    const bitsPerSample = this.bytesPerSample * 8;
    const byteRate = this.sampleRate * this.channels * this.bytesPerSample;
    const blockAlign = this.channels * this.bytesPerSample;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(this.channels, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
  }
}
