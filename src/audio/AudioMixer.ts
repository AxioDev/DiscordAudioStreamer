import type { Writable } from 'stream';

interface SourceEntry {
  buffer: Buffer;
  lastFrame: Buffer | null;
  lastActiveTs: number;
  envelope: number;
  consecutiveFallbacks: number;
}

interface ReadFrameResult {
  frame: Buffer | null;
  isFresh: boolean;
}

export interface AudioMixerStats {
  mixTicks: number;
  useLastFrameCount: number;
  backpressureCount: number;
  avgActiveSources: number;
}

export interface AudioMixerOptions {
  frameBytes: number;
  mixFrameMs: number;
  bytesPerSample: number;
}

export default class AudioMixer {
  private readonly frameBytes: number;

  private readonly mixFrameMs: number;

  private readonly bytesPerSample: number;

  private readonly sampleCount: number;

  private readonly sources: Map<string, SourceEntry>;

  private timer: NodeJS.Timeout | null;

  private output: Writable | null;

  private outputDrainListener: (() => void) | null;

  private running: boolean;

  private pausedForBackpressure: boolean;

  private readonly nullFrame: Buffer;

  private readonly mixedFloat: Float32Array;

  public readonly stats: AudioMixerStats;

  private readonly ACTIVE_RMS_THRESHOLD: number;

  private readonly FADE_FRAMES: number;

  private readonly fadeIncrement: number;

  private readonly MAX_PLC_FRAMES: number;

  constructor({ frameBytes, mixFrameMs, bytesPerSample }: AudioMixerOptions) {
    this.frameBytes = frameBytes;
    this.mixFrameMs = mixFrameMs;
    this.bytesPerSample = bytesPerSample;
    this.sampleCount = this.frameBytes / this.bytesPerSample;

    this.sources = new Map();
    this.timer = null;
    this.output = null;
    this.outputDrainListener = null;
    this.running = false;
    this.pausedForBackpressure = false;

    this.nullFrame = Buffer.alloc(this.frameBytes);
    this.mixedFloat = new Float32Array(this.sampleCount);

    this.stats = {
      mixTicks: 0,
      useLastFrameCount: 0,
      backpressureCount: 0,
      avgActiveSources: 0,
    };

    this.ACTIVE_RMS_THRESHOLD = 0.002;
    this.FADE_FRAMES = 2;
    this.fadeIncrement = this.FADE_FRAMES > 0 ? 1 / this.FADE_FRAMES : 1;
    this.MAX_PLC_FRAMES = 5;
  }

  public setOutput(writable: Writable | null): void {
    if (this.output && this.outputDrainListener) {
      this.output.removeListener('drain', this.outputDrainListener);
    }

    this.output = writable;
    this.pausedForBackpressure = false;

    if (this.output) {
      this.outputDrainListener = () => {
        if (this.pausedForBackpressure) {
          this.pausedForBackpressure = false;
          this.ensureMixLoop();
        }
      };
      this.output.on('drain', this.outputDrainListener);
    } else {
      this.outputDrainListener = null;
    }

    this.ensureMixLoop();
  }

  public addSource(id: string): void {
    if (!this.sources.has(id)) {
      this.sources.set(id, {
        buffer: Buffer.alloc(0),
        lastFrame: null,
        lastActiveTs: 0,
        envelope: 0,
        consecutiveFallbacks: 0,
      });
    }
  }

  public removeSource(id: string): void {
    this.sources.delete(id);
  }

  public pushToSource(id: string, chunk: Buffer): void {
    const entry = this.sources.get(id);
    if (!entry) {
      return;
    }

    entry.buffer = Buffer.concat([entry.buffer, chunk]);
    const maxCapacity = this.frameBytes * 200;
    if (entry.buffer.length > maxCapacity) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - maxCapacity);
    }
  }

  private readFrameForSource(id: string): ReadFrameResult {
    const entry = this.sources.get(id);
    if (!entry) {
      return { frame: null, isFresh: false };
    }

    if (entry.buffer.length >= this.frameBytes) {
      const frame = entry.buffer.slice(0, this.frameBytes);
      entry.buffer = entry.buffer.slice(this.frameBytes);
      entry.lastFrame = frame;
      entry.lastActiveTs = Date.now();
      entry.consecutiveFallbacks = 0;
      return { frame, isFresh: true };
    }

    if (entry.lastFrame) {
      entry.consecutiveFallbacks += 1;
      return { frame: entry.lastFrame, isFresh: false };
    }

    return { frame: null, isFresh: false };
  }

  private computeRMS(frameBuf: Buffer | null, envelope = 1): number {
    if (!frameBuf) {
      return 0;
    }

    let sumSquares = 0;
    for (let i = 0; i < this.sampleCount; i += 1) {
      const sample = frameBuf.readInt16LE(i * this.bytesPerSample) / 32768.0;
      const scaled = sample * envelope;
      sumSquares += scaled * scaled;
    }

    return Math.sqrt(sumSquares / this.sampleCount);
  }

  private mixFrame(): void {
    if (!this.running || this.pausedForBackpressure) {
      return;
    }

    if (!this.output || !this.output.writable) {
      return;
    }

    this.stats.mixTicks += 1;

    const activeFrames: Array<{ id: string; frame: Buffer; envelope: number; rms: number }> = [];

    for (const [id] of this.sources.entries()) {
      const { frame, isFresh } = this.readFrameForSource(id);
      if (!frame) {
        continue;
      }

      const entry = this.sources.get(id);
      if (!entry) {
        continue;
      }

      let { envelope } = entry;
      if (isFresh) {
        envelope = Math.min(1, envelope + this.fadeIncrement);
        entry.lastActiveTs = Date.now();
      } else {
        this.stats.useLastFrameCount += 1;
        if (entry.consecutiveFallbacks > this.MAX_PLC_FRAMES) {
          envelope = Math.max(0, envelope - this.fadeIncrement);
          if (envelope === 0) {
            entry.envelope = 0;
            continue;
          }
        } else if (envelope === 0) {
          envelope = this.fadeIncrement;
        }
      }

      entry.envelope = envelope;
      const rms = this.computeRMS(frame, envelope);
      activeFrames.push({ id, frame, envelope, rms });
    }

    let activeForStats = 0;

    if (activeFrames.length === 0) {
      const ok = this.writeToOutput(this.nullFrame);
      if (!ok) {
        this.stats.backpressureCount += 1;
        this.pauseMixingForBackpressure();
      }
      this.updateAverageActiveSources(activeForStats);
      return;
    }

    const activeSpeakers = activeFrames.filter((frameInfo) => frameInfo.rms >= this.ACTIVE_RMS_THRESHOLD);
    activeForStats = activeSpeakers.length;
    const normalizationCount = Math.max(1, activeSpeakers.length);

    this.mixedFloat.fill(0);

    for (const frameInfo of activeFrames) {
      const { frame, envelope } = frameInfo;
      for (let i = 0; i < this.sampleCount; i += 1) {
        const sample = frame.readInt16LE(i * this.bytesPerSample);
        this.mixedFloat[i] += sample * envelope;
      }
    }

    const normalization = 1 / (normalizationCount * 32768.0);
    const outputBuffer = Buffer.allocUnsafe(this.frameBytes);

    for (let i = 0; i < this.sampleCount; i += 1) {
      let value = this.mixedFloat[i] * normalization;
      if (value > 1) {
        value = 1;
      } else if (value < -1) {
        value = -1;
      }
      outputBuffer.writeInt16LE(Math.round(value * 32767), i * this.bytesPerSample);
    }

    this.updateAverageActiveSources(activeForStats);

    const ok = this.writeToOutput(outputBuffer);
    if (!ok) {
      this.stats.backpressureCount += 1;
      this.pauseMixingForBackpressure();
    }
  }

  private writeToOutput(buffer: Buffer): boolean {
    if (this.output && this.output.writable) {
      return this.output.write(buffer);
    }
    return true;
  }

  private pauseMixingForBackpressure(): void {
    if (this.pausedForBackpressure) {
      return;
    }

    this.pausedForBackpressure = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private ensureMixLoop(): void {
    if (!this.running || this.pausedForBackpressure || this.timer) {
      return;
    }

    this.timer = setInterval(() => this.mixFrame(), this.mixFrameMs);
  }

  private updateAverageActiveSources(count: number): void {
    const { mixTicks } = this.stats;
    if (mixTicks === 0) {
      this.stats.avgActiveSources = 0;
      return;
    }

    this.stats.avgActiveSources = ((this.stats.avgActiveSources * (mixTicks - 1)) + count) / mixTicks;
  }

  public getStats(): AudioMixerStats {
    return { ...this.stats };
  }

  public getSourceCount(): number {
    return this.sources.size;
  }

  public start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.ensureMixLoop();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pausedForBackpressure = false;
  }
}
