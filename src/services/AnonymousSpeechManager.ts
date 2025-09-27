import { randomUUID } from 'crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';
import type DiscordAudioBridge from '../discord/DiscordAudioBridge';
import type SseService from './SseService';

export interface AnonymousSpeechManagerOptions {
  discordBridge: DiscordAudioBridge;
  sseService: SseService;
  slotDurationMs?: number;
  connectionGraceMs?: number;
  inactivityTimeoutMs?: number;
}

export interface AnonymousSlotState {
  occupied: boolean;
  alias: string | null;
  claimedAt: number | null;
  expiresAt: number | null;
  remainingMs: number | null;
  connectionPending: boolean;
  message?: string | null;
}

interface SlotSession {
  token: string;
  alias: string;
  claimedAt: number;
  expiresAt: number;
  connectionDeadline: number;
  connectionTimer: NodeJS.Timeout | null;
  inactivityTimer: NodeJS.Timeout | null;
  hardLimitTimer: NodeJS.Timeout | null;
  ws: WebSocket | null;
  connected: boolean;
  lastAudioAt: number | null;
  lastReason?: string;
}

export class AnonymousSlotError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = 'AnonymousSlotError';
    this.status = options?.status ?? 400;
    this.code = options?.code ?? 'UNKNOWN';
  }
}

export default class AnonymousSpeechManager {
  private readonly discordBridge: DiscordAudioBridge;

  private readonly sseService: SseService;

  private readonly slotDurationMs: number;

  private readonly connectionGraceMs: number;

  private readonly inactivityTimeoutMs: number;

  private currentSession: SlotSession | null = null;

  private readonly events = new EventEmitter();

  constructor({
    discordBridge,
    sseService,
    slotDurationMs = 3 * 60 * 1000,
    connectionGraceMs = 20 * 1000,
    inactivityTimeoutMs = 15 * 1000,
  }: AnonymousSpeechManagerOptions) {
    this.discordBridge = discordBridge;
    this.sseService = sseService;
    this.slotDurationMs = slotDurationMs;
    this.connectionGraceMs = connectionGraceMs;
    this.inactivityTimeoutMs = inactivityTimeoutMs;

    this.discordBridge.onVoiceConnectionDestroyed(() => {
      this.forceRelease('VOICE_DISCONNECTED', 'Le bot vocal a été déconnecté.');
    });

    this.discordBridge.onVoiceConnectionReady(() => {
      this.broadcastState('ready');
    });
  }

  public getPublicState(): AnonymousSlotState {
    const session = this.currentSession;
    if (!session) {
      return {
        occupied: false,
        alias: null,
        claimedAt: null,
        expiresAt: null,
        remainingMs: null,
        connectionPending: false,
        message: null,
      };
    }

    const remainingMs = Math.max(0, session.expiresAt - Date.now());

    return {
      occupied: true,
      alias: session.alias,
      claimedAt: session.claimedAt,
      expiresAt: session.expiresAt,
      remainingMs,
      connectionPending: !session.connected,
      message: session.lastReason ?? null,
    };
  }

  public claimSlot({ displayName }: { displayName?: string } = {}): {
    token: string;
    alias: string;
    expiresAt: number;
    state: AnonymousSlotState;
  } {
    if (!this.discordBridge.hasActiveVoiceConnection()) {
      throw new AnonymousSlotError('Le bot n\'est pas connecté au salon vocal.', {
        status: 503,
        code: 'VOICE_CONNECTION_UNAVAILABLE',
      });
    }

    if (this.currentSession) {
      throw new AnonymousSlotError('Le micro anonyme est déjà réservé. Patiente un instant.', {
        status: 409,
        code: 'SLOT_OCCUPIED',
      });
    }

    const alias = this.generateAlias(displayName);
    const claimedAt = Date.now();
    const token = randomUUID();
    const expiresAt = claimedAt + this.slotDurationMs;
    const connectionDeadline = claimedAt + this.connectionGraceMs;

    const connectionTimer = setTimeout(() => {
      this.forceRelease('CONNECTION_TIMEOUT', 'Connexion au micro expirée.');
    }, this.connectionGraceMs);

    this.currentSession = {
      token,
      alias,
      claimedAt,
      expiresAt,
      connectionDeadline,
      connectionTimer,
      inactivityTimer: null,
      hardLimitTimer: setTimeout(() => {
        this.forceRelease('SLOT_TIMEOUT', 'Temps de parole écoulé.');
      }, this.slotDurationMs),
      ws: null,
      connected: false,
      lastAudioAt: null,
    };

    this.broadcastState('claimed');

    return {
      token,
      alias,
      expiresAt,
      state: this.getPublicState(),
    };
  }

  public releaseSlot(token: string, reason = 'RELEASED', message = 'Micro libéré.'): AnonymousSlotState {
    const session = this.currentSession;
    if (!session || session.token !== token) {
      throw new AnonymousSlotError('Ton slot de parole a déjà été libéré ou expiré.', {
        status: 410,
        code: 'SLOT_NOT_FOUND',
      });
    }

    this.forceRelease(reason, message, false);
    return this.getPublicState();
  }

  public handleSocketConnection(socket: WebSocket, request: IncomingMessage): void {
    const url = this.safeParseUrl(request.url ?? '', request.headers.host ?? 'localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(4401, 'Token requis.');
      return;
    }

    const session = this.currentSession;
    if (!session || session.token !== token) {
      socket.close(4403, 'Session introuvable.');
      return;
    }

    if (!this.discordBridge.hasActiveVoiceConnection()) {
      socket.close(4404, 'Connexion vocale indisponible.');
      this.forceRelease('VOICE_CONNECTION_UNAVAILABLE', 'Connexion vocale indisponible.');
      return;
    }

    if (session.ws && session.ws !== socket) {
      try {
        session.ws.close(4001, 'Connexion remplacée.');
      } catch (error) {
        console.warn('Erreur lors de la fermeture de l\'ancienne connexion WS', error);
      }
    }

    session.ws = socket;
    session.connected = true;
    session.lastReason = undefined;
    this.clearTimer(session.connectionTimer);
    session.connectionTimer = null;

    socket.on('message', (data, isBinary) => {
      if (!isBinary && typeof data === 'string') {
        this.handleControlMessage(session, data);
        return;
      }

      const buffer = this.normalizeChunk(data);
      if (!buffer) {
        return;
      }

      session.lastAudioAt = Date.now();
      this.resetInactivityTimer(session);
      this.discordBridge.pushAnonymousAudio(buffer);
    });

    socket.on('close', () => {
      if (this.currentSession && this.currentSession.token === session.token) {
        this.forceRelease('CONNECTION_CLOSED', 'Connexion fermée.');
      }
    });

    socket.on('error', (error) => {
      console.warn('Erreur sur la connexion WebSocket anonyme', error);
    });

    this.broadcastState('connected');
  }

  private handleControlMessage(session: SlotSession, raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
      return;
    }

    try {
      const payload = JSON.parse(trimmed) as { type?: string };
      if (payload?.type === 'heartbeat') {
        this.resetInactivityTimer(session);
      }
    } catch (error) {
      console.warn('Impossible de parser le message de contrôle du micro anonyme', error);
    }
  }

  private resetInactivityTimer(session: SlotSession): void {
    this.clearTimer(session.inactivityTimer);
    session.inactivityTimer = setTimeout(() => {
      this.forceRelease('INACTIVITY', 'Aucune activité détectée.');
    }, this.inactivityTimeoutMs);
  }

  private normalizeChunk(data: Buffer | ArrayBuffer | Buffer[]): Buffer | null {
    if (!data) {
      return null;
    }

    let buffer: Buffer;
    if (Buffer.isBuffer(data)) {
      buffer = data;
    } else if (Array.isArray(data)) {
      buffer = Buffer.concat(data.map((entry) => Buffer.from(entry)));
    } else if (data instanceof ArrayBuffer) {
      buffer = Buffer.from(new Uint8Array(data));
    } else {
      return null;
    }

    if (buffer.length === 0) {
      return null;
    }

    // Ensure stereo data (2 channels) by duplicating mono frames if needed.
    if (buffer.length % 4 === 0) {
      return buffer;
    }

    if (buffer.length % 2 !== 0) {
      return null;
    }

    const sampleCount = buffer.length / 2;
    const stereo = Buffer.alloc(sampleCount * 4);
    for (let i = 0; i < sampleCount; i++) {
      const sample = buffer.readInt16LE(i * 2);
      stereo.writeInt16LE(sample, i * 4);
      stereo.writeInt16LE(sample, i * 4 + 2);
    }
    return stereo;
  }

  private safeParseUrl(raw: string, hostHeader: string): URL {
    try {
      if (raw.startsWith('http://') || raw.startsWith('https://')) {
        return new URL(raw);
      }
      return new URL(raw, `http://${hostHeader || 'localhost'}`);
    } catch (error) {
      console.warn('URL de WebSocket invalide, utilisation de la valeur par défaut', raw, error);
      return new URL('http://localhost');
    }
  }

  private forceRelease(code: string, message: string, notifyClient = true): void {
    const session = this.currentSession;
    if (!session) {
      return;
    }

    this.currentSession = null;

    this.clearTimer(session.connectionTimer);
    this.clearTimer(session.inactivityTimer);
    this.clearTimer(session.hardLimitTimer);

    if (notifyClient && session.ws && session.ws.readyState === session.ws.OPEN) {
      try {
        session.ws.send(JSON.stringify({ type: 'terminated', code, message }));
      } catch (error) {
        console.warn('Impossible d\'envoyer le message de terminaison anonyme', error);
      }
      try {
        session.ws.close(4000, code);
      } catch (error) {
        console.warn('Impossible de fermer la connexion WebSocket anonyme', error);
      }
    }

    if (session.ws) {
      session.ws.removeAllListeners();
    }

    this.broadcastState('released', message);
  }

  private clearTimer(timer: NodeJS.Timeout | null): void {
    if (timer) {
      clearTimeout(timer);
    }
  }

  private generateAlias(displayName?: string): string {
    const pool = [
      'Anonyme',
      'Spectre',
      'Fantôme',
      'Ombre',
      'Nébuleuse',
      'Phoenix',
      'Mirage',
      'Nova',
      'Echo',
      'Astre',
    ];
    const base = displayName && displayName.trim().length > 0 ? displayName.trim() : pool[Math.floor(Math.random() * pool.length)];
    const suffix = Math.floor(Math.random() * 900 + 100);
    return `${base} #${suffix}`;
  }

  private broadcastState(reason?: string, message?: string): void {
    if (this.currentSession) {
      this.currentSession.lastReason = message ?? undefined;
    }

    const state = this.getPublicState();
    this.sseService.broadcast('anonymous-slot', state);
    this.events.emit('state', { reason, state });
  }

  public onStateChange(listener: (payload: { reason?: string; state: AnonymousSlotState }) => void): void {
    this.events.on('state', listener);
  }

  public offStateChange(listener: (payload: { reason?: string; state: AnonymousSlotState }) => void): void {
    this.events.off('state', listener);
  }
}
