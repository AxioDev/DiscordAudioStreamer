import { EventEmitter } from 'events';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { PassThrough } from 'stream';
import type AudioMixer from './AudioMixer';

function calculateOpusHeaderLength(buffer: Buffer): number | null {
  let offset = 0;

  while (offset + 27 <= buffer.length) {
    if (
      buffer[offset] !== 0x4f ||
      buffer[offset + 1] !== 0x67 ||
      buffer[offset + 2] !== 0x67 ||
      buffer[offset + 3] !== 0x53
    ) {
      break;
    }

    const segmentCount = buffer.readUInt8(offset + 26);
    const headerSize = 27 + segmentCount;
    if (offset + headerSize > buffer.length) {
      return null;
    }

    let dataLength = 0;
    for (let i = 0; i < segmentCount; i += 1) {
      dataLength += buffer.readUInt8(offset + 27 + i);
    }

    const pageSize = headerSize + dataLength;
    if (offset + pageSize > buffer.length) {
      return null;
    }

    const pageDataStart = offset + headerSize;
    const pageDataEnd = pageDataStart + dataLength;
    const tagIndex = buffer.indexOf('OpusTags', pageDataStart, 'ascii');

    if (tagIndex !== -1 && tagIndex < pageDataEnd) {
      return offset + pageSize;
    }

    offset += pageSize;

    if (offset > buffer.length) {
      break;
    }
  }

  return null;
}

export interface FfmpegTranscoderOptions {
  ffmpegPath: string;
  outputFormat: string;
  opusBitrate: string;
  mp3Bitrate: string;
  sampleRate: number;
  channels: number;
  headerBufferMaxBytes: number;
  mixFrameMs: number;
}

export default class FfmpegTranscoder extends EventEmitter {
  private readonly ffmpegPath: string;

  private readonly outputFormat: string;

  private readonly opusBitrate: string;

  private readonly mp3Bitrate: string;

  private readonly sampleRate: number;

  private readonly channels: number;

  private readonly headerBufferMaxBytes: number;

  private readonly mixFrameMs: number;

  private readonly broadcastStream: PassThrough;

  private headerBuffer: Buffer;

  private mixer: AudioMixer | null;

  private currentProcess: ChildProcessWithoutNullStreams | null;

  private restartTimer: NodeJS.Timeout | null;

  private restarting: boolean;

  private captureHeader: boolean;

  constructor({
    ffmpegPath,
    outputFormat,
    opusBitrate,
    mp3Bitrate,
    sampleRate,
    channels,
    headerBufferMaxBytes,
    mixFrameMs,
  }: FfmpegTranscoderOptions) {
    super();
    this.ffmpegPath = ffmpegPath;
    this.outputFormat = outputFormat;
    this.opusBitrate = opusBitrate;
    this.mp3Bitrate = mp3Bitrate;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.headerBufferMaxBytes = headerBufferMaxBytes;
    this.mixFrameMs = mixFrameMs || 20;

    this.broadcastStream = new PassThrough();
    this.headerBuffer = Buffer.alloc(0);
    this.mixer = null;
    this.currentProcess = null;
    this.restartTimer = null;
    this.restarting = false;
    this.captureHeader = false;
  }

  public start(mixer: AudioMixer): void {
    this.mixer = mixer;
    this.spawnProcess();
  }

  private spawnProcess(): void {
    if (this.restarting) {
      return;
    }

    this.restarting = true;
    this.clearRestartTimer();

    const args = [
      '-f',
      's16le',
      '-ar',
      String(this.sampleRate),
      '-ac',
      String(this.channels),
      '-i',
      'pipe:0',
      '-fflags',
      'nobuffer',
      '-vn',
      '-threads',
      '0',
      '-loglevel',
      'info',
    ];

    if (this.outputFormat === 'opus') {
      args.push(
        '-c:a',
        'libopus',
        '-application',
        'voip',
        '-b:a',
        String(this.opusBitrate),
        '-frame_duration',
        String(this.mixFrameMs),
        '-f',
        'ogg',
        'pipe:1',
      );
    } else {
      args.push(
        '-c:a',
        'libmp3lame',
        '-b:a',
        String(this.mp3Bitrate),
        '-f',
        'mp3',
        'pipe:1',
      );
    }

    console.log('Starting ffmpeg with format', this.outputFormat);
    const ffmpeg = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.currentProcess = ffmpeg;
    this.restarting = false;
    this.headerBuffer = Buffer.alloc(0);
    this.captureHeader = this.outputFormat === 'opus';
    if (this.mixer) {
      this.mixer.setOutput(ffmpeg.stdin);
    }

    ffmpeg.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk));
    ffmpeg.stderr.on('data', (data: Buffer) => process.stderr.write(data.toString()));
    ffmpeg.on('exit', (code, signal) => this.handleExit(code, signal));
    ffmpeg.on('error', (error) => this.handleError(error));

    console.log('ffmpeg pid=', ffmpeg.pid);
  }

  private handleStdout(chunk: Buffer): void {
    if (this.captureHeader) {
      this.captureHeaderChunk(chunk);
    }

    this.broadcastStream.write(chunk);
    this.emit('data', chunk);
  }

  private captureHeaderChunk(chunk: Buffer): void {
    if (!chunk || chunk.length === 0) {
      return;
    }

    const combined = Buffer.concat([this.headerBuffer, chunk]);

    if (this.outputFormat === 'opus') {
      const headerLength = calculateOpusHeaderLength(combined);

      if (headerLength !== null) {
        this.headerBuffer = combined.slice(0, Math.min(headerLength, this.headerBufferMaxBytes));
        this.captureHeader = false;
        return;
      }

      if (combined.length >= this.headerBufferMaxBytes) {
        this.headerBuffer = combined.slice(0, this.headerBufferMaxBytes);
        this.captureHeader = false;
        return;
      }

      this.headerBuffer = combined;
      return;
    }

    this.headerBuffer = Buffer.alloc(0);
    this.captureHeader = false;
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    console.warn(`ffmpeg exited code=${code} signal=${signal}`);
    if (this.mixer) {
      this.mixer.setOutput(null);
    }
    this.currentProcess = null;
    this.scheduleRestart(800);
  }

  private handleError(error: Error): void {
    console.error('ffmpeg error', error);
    if (this.mixer) {
      this.mixer.setOutput(null);
    }
    this.currentProcess = null;
    this.scheduleRestart(2000);
  }

  private scheduleRestart(delay: number): void {
    if (this.restartTimer) {
      return;
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnProcess();
    }, delay);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  public createClientStream(): PassThrough {
    const clientStream = new PassThrough();
    this.broadcastStream.pipe(clientStream);
    return clientStream;
  }

  public releaseClientStream(stream: PassThrough): void {
    try {
      this.broadcastStream.unpipe(stream);
    } catch (error) {
      console.warn('Failed to unpipe client stream', error);
    }
    try {
      stream.end();
    } catch (error) {
      console.warn('Failed to close client stream', error);
    }
  }

  public getHeaderBuffer(): Buffer {
    return this.headerBuffer;
  }

  public getCurrentProcessPid(): number | null {
    return this.currentProcess?.pid ?? null;
  }

  public stop(): void {
    this.clearRestartTimer();
    this.restarting = false;
    if (this.currentProcess && !this.currentProcess.killed) {
      try {
        this.currentProcess.stdin.end();
      } catch (error) {
        console.warn('Error while closing ffmpeg stdin', error);
      }
      this.currentProcess.kill('SIGTERM');
    }
    this.currentProcess = null;
    if (this.mixer) {
      this.mixer.setOutput(null);
    }
    this.broadcastStream.end();
  }
}
