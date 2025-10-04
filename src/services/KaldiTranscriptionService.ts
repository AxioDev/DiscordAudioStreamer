import WebSocket from 'ws';
import type VoiceActivityRepository from './VoiceActivityRepository';

export interface KaldiTranscriptionServiceOptions {
  host: string;
  port: number;
  sampleRate: number;
  enabled?: boolean;
  voiceActivityRepository?: VoiceActivityRepository | null;
  inputSampleRate?: number;
  inputChannels?: number;
}

interface SessionMetadata {
  userId: string;
  guildId: string | null;
  channelId: string | null;
}

interface KaldiSession extends SessionMetadata {
  ws: WebSocket | null;
  queue: Buffer[];
  ready: boolean;
  closed: boolean;
  transcripts: string[];
  startedAt: Date;
  finalizePromise: Promise<void> | null;
  resolveFinalize: (() => void) | null;
  rejectFinalize: ((error: unknown) => void) | null;
}

const KALDI_DEFAULT_PATH = '/client/ws/speech';

export default class KaldiTranscriptionService {
  private readonly endpoint: string;

  private readonly sampleRate: number;

  private readonly inputSampleRate: number;

  private readonly inputChannels: number;

  private readonly isEnabled: boolean;

  private readonly voiceActivityRepository: VoiceActivityRepository | null;

  private readonly sessions = new Map<string, KaldiSession>();

  private removeSession(session: KaldiSession): void {
    const current = this.sessions.get(session.userId);
    if (current === session) {
      this.sessions.delete(session.userId);
    }
  }

  constructor({
    host,
    port,
    sampleRate,
    enabled = true,
    voiceActivityRepository = null,
    inputSampleRate = 48000,
    inputChannels = 2,
  }: KaldiTranscriptionServiceOptions) {
    this.endpoint = `ws://${host}:${port}${KALDI_DEFAULT_PATH}`;
    this.sampleRate = sampleRate;
    this.inputSampleRate = inputSampleRate;
    this.inputChannels = inputChannels;
    this.isEnabled = Boolean(enabled) && Boolean(voiceActivityRepository);
    this.voiceActivityRepository = voiceActivityRepository ?? null;
  }

  public isActive(): boolean {
    return this.isEnabled;
  }

  public startSession(userId: string, metadata: { guildId: string | null; channelId: string | null }): void {
    if (!this.isEnabled) {
      return;
    }

    const existing = this.sessions.get(userId);
    if (existing) {
      this.finalizeSession(userId).catch((error) => {
        console.warn('Failed to finalize existing Kaldi session before starting a new one', error);
      });
    }

    const session: KaldiSession = {
      userId,
      guildId: metadata.guildId,
      channelId: metadata.channelId,
      ws: null,
      queue: [],
      ready: false,
      closed: false,
      transcripts: [],
      startedAt: new Date(),
      finalizePromise: null,
      resolveFinalize: null,
      rejectFinalize: null,
    };

    const ws = new WebSocket(this.endpoint);
    session.ws = ws;

    ws.on('open', () => {
      session.ready = true;
      this.sendConfig(ws);
      this.flushQueue(session);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(session, data);
    });

    ws.on('error', (error) => {
      console.warn('Kaldi transcription session error', error);
      this.terminateSession(session, error);
    });

    ws.on('close', () => {
      this.terminateSession(session, null);
    });

    this.sessions.set(userId, session);
  }

  public pushAudio(userId: string, chunk: Buffer): void {
    if (!this.isEnabled || chunk.length === 0) {
      return;
    }

    const session = this.sessions.get(userId);
    if (!session || session.closed) {
      return;
    }

    const processed = this.downsampleAndConvert(chunk);
    if (processed.length === 0) {
      return;
    }

    if (session.ready && session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(processed, { binary: true }, (error) => {
        if (error) {
          console.warn('Failed to send audio chunk to Kaldi server', error);
          this.terminateSession(session, error);
        }
      });
    } else {
      session.queue.push(processed);
    }
  }

  public async finalizeSession(userId: string): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    const session = this.sessions.get(userId);
    if (!session) {
      return;
    }

    if (session.finalizePromise) {
      return session.finalizePromise;
    }

    session.closed = true;

    session.finalizePromise = new Promise<void>((resolve, reject) => {
      session.resolveFinalize = resolve;
      session.rejectFinalize = reject;
    });

    const ws = session.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ eof: 1 }));
      } catch (error) {
        console.warn('Failed to signal Kaldi session EOF', error);
      }
      try {
        ws.close();
      } catch (error) {
        console.warn('Failed to close Kaldi session', error);
      }
    } else if (ws && ws.readyState === WebSocket.CONNECTING) {
      try {
        ws.terminate();
      } catch (error) {
        console.warn('Failed to terminate Kaldi session during finalize', error);
      }
    } else {
      this.removeSession(session);
      this.persistTranscript(session);
      if (session.resolveFinalize) {
        session.resolveFinalize();
      }
      session.resolveFinalize = null;
      session.rejectFinalize = null;
    }

    return session.finalizePromise;
  }

  private terminateSession(session: KaldiSession, error: unknown): void {
    if (!this.sessions.has(session.userId)) {
      return;
    }

    this.removeSession(session);

    if (!session.closed) {
      session.closed = true;
    }

    if (!error) {
      this.persistTranscript(session);
    }

    if (session.resolveFinalize) {
      session.resolveFinalize();
      session.resolveFinalize = null;
      session.rejectFinalize = null;
    } else if (session.rejectFinalize) {
      session.rejectFinalize(error);
      session.resolveFinalize = null;
      session.rejectFinalize = null;
    }
  }

  private persistTranscript(session: KaldiSession): void {
    const transcript = session.transcripts
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .join(' ')
      .trim();

    if (!transcript || !this.voiceActivityRepository) {
      return;
    }

    this.voiceActivityRepository
      .recordVoiceTranscription({
        userId: session.userId,
        guildId: session.guildId,
        channelId: session.channelId,
        content: transcript,
        timestamp: new Date(),
      })
      .catch((error) => {
        console.error('Failed to persist voice transcription', error);
      });
  }

  private flushQueue(session: KaldiSession): void {
    if (!session.ready || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    while (session.queue.length > 0) {
      const chunk = session.queue.shift();
      if (!chunk) {
        continue;
      }
      session.ws.send(chunk, { binary: true }, (error) => {
        if (error) {
          console.warn('Failed to flush queued audio chunk to Kaldi server', error);
          this.terminateSession(session, error);
        }
      });
    }
  }

  private handleMessage(session: KaldiSession, data: WebSocket.RawData): void {
    let payload: string;
    if (typeof data === 'string') {
      payload = data;
    } else if (Buffer.isBuffer(data)) {
      payload = data.toString('utf8');
    } else if (Array.isArray(data)) {
      payload = Buffer.concat(data).toString('utf8');
    } else if (data instanceof ArrayBuffer) {
      payload = Buffer.from(data).toString('utf8');
    } else {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      console.warn('Failed to parse Kaldi transcription payload', error);
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    const status = (parsed as { status?: number }).status;
    if (typeof status === 'number' && status !== 0) {
      const message = (parsed as { message?: string }).message;
      console.warn('Kaldi transcription server returned error status', status, message);
      return;
    }

    const result = (parsed as { result?: { hypotheses?: Array<{ transcript?: string }>; final?: boolean } }).result;
    if (!result) {
      return;
    }

    const hypotheses = Array.isArray(result.hypotheses) ? result.hypotheses : [];
    const transcriptCandidate = hypotheses.length > 0 ? hypotheses[0]?.transcript : null;

    if (typeof transcriptCandidate === 'string' && result.final) {
      const normalized = transcriptCandidate.trim();
      if (normalized.length > 0) {
        session.transcripts.push(normalized);
      }
    }
  }

  private sendConfig(ws: WebSocket): void {
    try {
      ws.send(
        JSON.stringify({
          config: {
            'sample-rate': this.sampleRate,
            sample_rate: this.sampleRate,
          },
        }),
      );
    } catch (error) {
      console.warn('Failed to send Kaldi configuration payload', error);
    }
  }

  private downsampleAndConvert(chunk: Buffer): Buffer {
    if (chunk.length === 0) {
      return chunk;
    }

    const bytesPerSample = 2;
    const inputChannels = Math.max(1, this.inputChannels);
    const inputFrameSize = bytesPerSample * inputChannels;

    let workingChunk = chunk;

    if (workingChunk.length % inputFrameSize !== 0) {
      const trimmedLength = workingChunk.length - (workingChunk.length % inputFrameSize);
      workingChunk = workingChunk.subarray(0, trimmedLength);
    }

    const frameCount = workingChunk.length / inputFrameSize;
    if (frameCount === 0) {
      return Buffer.alloc(0);
    }

    const downsampleRatio = Math.max(1, Math.round(this.inputSampleRate / Math.max(1, this.sampleRate)));

    if (downsampleRatio <= 1) {
      const output = Buffer.allocUnsafe(frameCount * bytesPerSample);
      let offset = 0;
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const baseIndex = frameIndex * inputFrameSize;
        let sum = 0;
        for (let channel = 0; channel < inputChannels; channel += 1) {
          sum += workingChunk.readInt16LE(baseIndex + channel * bytesPerSample);
        }
        const averaged = sum / inputChannels;
        const clamped = Math.max(-32768, Math.min(32767, Math.round(averaged)));
        output.writeInt16LE(clamped, offset);
        offset += bytesPerSample;
      }
      return offset === output.length ? output : output.subarray(0, offset);
    }

    const outputFrameCount = Math.floor(frameCount / downsampleRatio);
    if (outputFrameCount <= 0) {
      return Buffer.alloc(0);
    }

    const output = Buffer.allocUnsafe(outputFrameCount * bytesPerSample);
    let outputOffset = 0;

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += downsampleRatio) {
      let accumulated = 0;
      let samplesInGroup = 0;

      for (let offset = 0; offset < downsampleRatio && frameIndex + offset < frameCount; offset += 1) {
        const baseIndex = (frameIndex + offset) * inputFrameSize;
        let sum = 0;
        for (let channel = 0; channel < inputChannels; channel += 1) {
          sum += workingChunk.readInt16LE(baseIndex + channel * bytesPerSample);
        }
        accumulated += sum / inputChannels;
        samplesInGroup += 1;
      }

      const averaged = samplesInGroup > 0 ? accumulated / samplesInGroup : 0;
      const clamped = Math.max(-32768, Math.min(32767, Math.round(averaged)));
      output.writeInt16LE(clamped, outputOffset);
      outputOffset += bytesPerSample;
    }

    return outputOffset === output.length ? output : output.subarray(0, outputOffset);
  }
}
