import path from 'node:path';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';

export interface UserAudioRecorderOptions {
  baseDirectory: string;
  sampleRate: number;
  channels: number;
  bytesPerSample: number;
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

  constructor({ baseDirectory, sampleRate, channels, bytesPerSample }: UserAudioRecorderOptions) {
    this.baseDirectory = path.resolve(baseDirectory);
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.bytesPerSample = bytesPerSample;

    mkdirSync(this.baseDirectory, { recursive: true });
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
