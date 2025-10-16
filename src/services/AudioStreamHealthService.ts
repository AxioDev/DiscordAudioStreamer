import type { PassThrough } from 'stream';
import type FfmpegTranscoder from '../audio/FfmpegTranscoder';
import type DiscordAudioBridge from '../discord/DiscordAudioBridge';

export interface AudioStreamHealthServiceOptions {
  transcoder: FfmpegTranscoder;
  discordBridge: DiscordAudioBridge;
  guildId?: string;
  voiceChannelId?: string;
  checkIntervalMs: number;
  maxSilenceMs: number;
  restartCooldownMs: number;
  streamRetryDelayMs: number;
}

export default class AudioStreamHealthService {
  private readonly transcoder: FfmpegTranscoder;

  private readonly discordBridge: DiscordAudioBridge;

  private readonly guildId?: string;

  private readonly voiceChannelId?: string;

  private readonly checkIntervalMs: number;

  private readonly maxSilenceMs: number;

  private readonly restartCooldownMs: number;

  private readonly streamRetryDelayMs: number;

  private monitorTimer: NodeJS.Timeout | null = null;

  private streamRetryTimer: NodeJS.Timeout | null = null;

  private clientStream: PassThrough | null = null;

  private lastPacketTimestamp = Date.now();

  private lastRestartTimestamp = 0;

  private started = false;

  private restarting = false;

  constructor({
    transcoder,
    discordBridge,
    guildId,
    voiceChannelId,
    checkIntervalMs,
    maxSilenceMs,
    restartCooldownMs,
    streamRetryDelayMs,
  }: AudioStreamHealthServiceOptions) {
    this.transcoder = transcoder;
    this.discordBridge = discordBridge;
    this.guildId = guildId;
    this.voiceChannelId = voiceChannelId;
    this.checkIntervalMs = checkIntervalMs;
    this.maxSilenceMs = maxSilenceMs;
    this.restartCooldownMs = restartCooldownMs;
    this.streamRetryDelayMs = streamRetryDelayMs;
  }

  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.lastPacketTimestamp = Date.now();
    this.attachStream();
    this.monitorTimer = setInterval(() => this.checkHealth(), this.checkIntervalMs);
    if (typeof this.monitorTimer.unref === 'function') {
      this.monitorTimer.unref();
    }
  }

  public stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.clearMonitorTimer();
    this.clearStreamRetryTimer();
    this.detachStream();
  }

  private readonly onStreamData = (chunk: Buffer): void => {
    if (chunk && chunk.length > 0) {
      this.lastPacketTimestamp = Date.now();
    }
  };

  private readonly onStreamError = (error: Error): void => {
    console.warn('[AudioStreamHealth] Monitoring stream error', error);
    this.handleStreamInterruption();
  };

  private readonly onStreamEnd = (): void => {
    console.warn('[AudioStreamHealth] Monitoring stream ended');
    this.handleStreamInterruption();
  };

  private readonly onStreamClose = (): void => {
    console.warn('[AudioStreamHealth] Monitoring stream closed');
    this.handleStreamInterruption();
  };

  private attachStream(): void {
    if (!this.started || this.restarting || this.clientStream) {
      return;
    }

    try {
      const stream = this.transcoder.createClientStream();
      stream.on('data', this.onStreamData);
      stream.on('error', this.onStreamError);
      stream.on('end', this.onStreamEnd);
      stream.on('close', this.onStreamClose);
      // Ensure the stream flows immediately.
      stream.resume();
      this.clientStream = stream;
      this.lastPacketTimestamp = Date.now();
      console.log('[AudioStreamHealth] Attached monitoring stream');
    } catch (error) {
      console.error('[AudioStreamHealth] Failed to attach monitoring stream', error);
      this.scheduleStreamReattach();
    }
  }

  private detachStream(): void {
    const stream = this.clientStream;
    if (!stream) {
      return;
    }

    stream.removeListener('data', this.onStreamData);
    stream.removeListener('error', this.onStreamError);
    stream.removeListener('end', this.onStreamEnd);
    stream.removeListener('close', this.onStreamClose);
    this.clientStream = null;
    try {
      this.transcoder.releaseClientStream(stream);
    } catch (error) {
      console.warn('[AudioStreamHealth] Failed to release monitoring stream', error);
    }
    this.lastPacketTimestamp = Date.now();
  }

  private handleStreamInterruption(): void {
    if (!this.started) {
      return;
    }
    this.detachStream();
    this.scheduleStreamReattach();
  }

  private scheduleStreamReattach(): void {
    if (!this.started) {
      return;
    }
    if (this.streamRetryTimer) {
      return;
    }

    this.streamRetryTimer = setTimeout(() => {
      this.streamRetryTimer = null;
      if (!this.started) {
        return;
      }
      if (this.restarting) {
        this.scheduleStreamReattach();
        return;
      }
      this.attachStream();
    }, this.streamRetryDelayMs);

    if (typeof this.streamRetryTimer.unref === 'function') {
      this.streamRetryTimer.unref();
    }
  }

  private clearStreamRetryTimer(): void {
    if (this.streamRetryTimer) {
      clearTimeout(this.streamRetryTimer);
      this.streamRetryTimer = null;
    }
  }

  private clearMonitorTimer(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  private checkHealth(): void {
    if (!this.started || this.restarting) {
      return;
    }
    if (!this.clientStream) {
      return;
    }

    const now = Date.now();
    const silenceDuration = now - this.lastPacketTimestamp;

    if (silenceDuration < this.maxSilenceMs) {
      return;
    }

    if (now - this.lastRestartTimestamp < this.restartCooldownMs) {
      return;
    }

    void this.triggerRestart(silenceDuration);
  }

  private async triggerRestart(silenceDuration: number): Promise<void> {
    if (this.restarting) {
      return;
    }

    this.restarting = true;
    this.lastRestartTimestamp = Date.now();
    console.warn(
      `[AudioStreamHealth] No audio packets for ${silenceDuration}ms. Restarting audio pipeline.`,
    );

    this.detachStream();

    try {
      this.transcoder.requestRestart('audio stream health check');
    } catch (error) {
      console.error('[AudioStreamHealth] Failed to request transcoder restart', error);
    }

    await this.restartVoiceConnection();

    this.lastPacketTimestamp = Date.now();
    this.restarting = false;
    this.scheduleStreamReattach();
  }

  private async restartVoiceConnection(): Promise<void> {
    if (!this.guildId || !this.voiceChannelId) {
      return;
    }

    try {
      this.discordBridge.leaveVoice();
    } catch (error) {
      console.warn('[AudioStreamHealth] Failed to leave voice channel cleanly', error);
    }

    try {
      await this.discordBridge.joinVoice(this.guildId, this.voiceChannelId);
    } catch (error) {
      console.error('[AudioStreamHealth] Failed to rejoin voice channel', error);
    }
  }
}
