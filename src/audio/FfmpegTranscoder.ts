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
  stallTimeoutMs?: number;
  watchdogIntervalMs?: number;
  exitRestartDelayMs?: number;
  errorRestartDelayMs?: number;
  stallRestartDelayMs?: number;
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

  private readonly stallTimeoutMs: number;

  private readonly watchdogIntervalMs: number;

  private readonly exitRestartDelayMs: number;

  private readonly errorRestartDelayMs: number;

  private readonly stallRestartDelayMs: number;

  private headerBuffer: Buffer;

  private mixer: AudioMixer | null;

  private currentProcess: ChildProcessWithoutNullStreams | null;

  private restartTimer: NodeJS.Timeout | null;

  private watchdogTimer: NodeJS.Timeout | null;

  private lastOutputTimestamp: number;

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
    stallTimeoutMs,
    watchdogIntervalMs,
    exitRestartDelayMs,
    errorRestartDelayMs,
    stallRestartDelayMs,
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
    this.stallTimeoutMs = Math.max(1000, stallTimeoutMs ?? 7000);
    this.watchdogIntervalMs = Math.max(250, watchdogIntervalMs ?? Math.min(2000, this.stallTimeoutMs / 2));
    this.exitRestartDelayMs = Math.max(0, exitRestartDelayMs ?? 800);
    this.errorRestartDelayMs = Math.max(0, errorRestartDelayMs ?? 2000);
    this.stallRestartDelayMs = Math.max(0, stallRestartDelayMs ?? 1000);

    this.headerBuffer = Buffer.alloc(0);
    this.mixer = null;
    this.currentProcess = null;
    this.restartTimer = null;
    this.watchdogTimer = null;
    this.lastOutputTimestamp = 0;
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

    this.startWatchdog();

    ffmpeg.stdout.on('data', (chunk: Buffer) => this.handleStdout(ffmpeg, chunk));
    ffmpeg.stdout.on('error', (error: Error) => this.handleStreamError(ffmpeg, 'stdout', error));
    ffmpeg.stderr.on('data', (data: Buffer) => process.stderr.write(data.toString()));
    ffmpeg.stderr.on('error', (error: Error) => this.handleStreamError(ffmpeg, 'stderr', error));
    ffmpeg.stdin.on('error', (error: Error) => this.handleStreamError(ffmpeg, 'stdin', error));
    ffmpeg.on('exit', (code, signal) => this.handleExit(ffmpeg, code, signal));
    ffmpeg.on('error', (error) => this.handleError(ffmpeg, error));

    console.log('ffmpeg pid=', ffmpeg.pid);
  }

  private handleStdout(processRef: ChildProcessWithoutNullStreams, chunk: Buffer): void {
    if (this.currentProcess !== processRef) {
      return;
    }

    this.lastOutputTimestamp = Date.now();

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

  private handleExit(
    processRef: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.currentProcess !== processRef) {
      return;
    }

    console.warn(`ffmpeg exited code=${code} signal=${signal}`);
    this.cleanupAfterProcess();
    this.scheduleRestart(this.exitRestartDelayMs, 'process exit');
  }

  private handleError(processRef: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.currentProcess !== processRef) {
      return;
    }

    console.error('ffmpeg error', error);
    this.cleanupAfterProcess();
    this.scheduleRestart(this.errorRestartDelayMs, 'process error');
  }

  private handleStreamError(
    processRef: ChildProcessWithoutNullStreams,
    streamName: 'stdin' | 'stdout' | 'stderr',
    error: Error,
  ): void {
    if (this.currentProcess !== processRef) {
      return;
    }

    console.error(`ffmpeg ${streamName} error`, error);
    this.forceRestart(processRef, `stream ${streamName} error`, this.errorRestartDelayMs);
  }

  private scheduleRestart(delay: number, reason: string): void {
    if (this.restartTimer) {
      return;
    }

    console.warn(`Scheduling ffmpeg restart in ${delay}ms due to ${reason}`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnProcess();
    }, delay);
    if (typeof this.restartTimer.unref === 'function') {
      this.restartTimer.unref();
    }
  }

  private forceRestart(
    processRef: ChildProcessWithoutNullStreams,
    reason: string,
    delay: number,
  ): void {
    if (this.currentProcess !== processRef) {
      return;
    }

    console.warn(`Force restarting ffmpeg due to ${reason}`);
    this.cleanupAfterProcess();

    try {
      if (!processRef.killed) {
        processRef.kill('SIGKILL');
      }
    } catch (killError) {
      console.warn('Failed to kill ffmpeg during forced restart', killError);
    }

    this.scheduleRestart(delay, reason);
  }

  private cleanupAfterProcess(): void {
    this.clearWatchdogTimer();
    const processRef = this.currentProcess;
    this.currentProcess = null;

    if (this.mixer) {
      this.mixer.setOutput(null);
    }

    if (processRef && !processRef.killed) {
      try {
        processRef.stdin.end();
      } catch (error) {
        console.warn('Failed to close ffmpeg stdin during cleanup', error);
      }
    }
  }

  private startWatchdog(): void {
    this.clearWatchdogTimer();
    this.lastOutputTimestamp = Date.now();
    this.watchdogTimer = setInterval(() => this.checkForStall(), this.watchdogIntervalMs);
    if (typeof this.watchdogTimer.unref === 'function') {
      this.watchdogTimer.unref();
    }
  }

  private checkForStall(): void {
    const currentProcess = this.currentProcess;
    if (!currentProcess) {
      return;
    }

    const idleDuration = Date.now() - this.lastOutputTimestamp;
    if (idleDuration < this.stallTimeoutMs) {
      return;
    }

    console.warn(`ffmpeg produced no output for ${idleDuration}ms, restarting`);
    this.forceRestart(currentProcess, 'output stall', this.stallRestartDelayMs);
  }

  private clearWatchdogTimer(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
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
    this.clearWatchdogTimer();
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
