import express, { type Request, type Response } from 'express';
import path from 'path';
import type { Server } from 'http';
import type FfmpegTranscoder from '../audio/FfmpegTranscoder';
import type SpeakerTracker from '../services/SpeakerTracker';
import type SseService from '../services/SseService';
import type AnonymousSpeechManager from '../services/AnonymousSpeechManager';
import type { Config } from '../config';
import { WebSocketServer } from 'ws';

export interface AppServerOptions {
  config: Config;
  transcoder: FfmpegTranscoder;
  speakerTracker: SpeakerTracker;
  sseService: SseService;
  anonymousSpeechManager: AnonymousSpeechManager;
}

type FlushCapableResponse = Response & {
  flushHeaders?: () => void;
  flush?: () => void;
};

export default class AppServer {
  private readonly config: Config;

  private readonly transcoder: FfmpegTranscoder;

  private readonly speakerTracker: SpeakerTracker;

  private readonly sseService: SseService;

  private readonly anonymousSpeechManager: AnonymousSpeechManager;

  private readonly app = express();

  private httpServer: Server | null = null;

  private wsServer: WebSocketServer | null = null;

  constructor({ config, transcoder, speakerTracker, sseService, anonymousSpeechManager }: AppServerOptions) {
    this.config = config;
    this.transcoder = transcoder;
    this.speakerTracker = speakerTracker;
    this.sseService = sseService;
    this.anonymousSpeechManager = anonymousSpeechManager;

    this.configureMiddleware();
    this.registerRoutes();
  }

  private configureMiddleware(): void {
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }

      next();
    });

    this.app.use(express.json({ limit: '256kb' }));

    const publicDir = path.resolve(__dirname, '..', '..', 'public');
    this.app.use(express.static(publicDir));
  }

  private registerRoutes(): void {
    this.app.get('/events', (req, res) => {
      this.sseService.handleRequest(req, res, {
        initialState: () => ({
          ...this.speakerTracker.getInitialState(),
          anonymousSlot: this.anonymousSpeechManager.getPublicState(),
        }),
      });
    });

    this.app.get(this.config.streamEndpoint, (req, res) => this.handleStreamRequest(req, res));

    this.app.get('/status', (_req, res) => {
      res.json({
        ffmpeg_pid: this.transcoder.getCurrentProcessPid(),
        headerBufferBytes: this.transcoder.getHeaderBuffer().length,
        activeSpeakers: this.speakerTracker.getSpeakerCount(),
      });
    });

    this.app.get('/anonymous-slot', (_req, res) => {
      res.json(this.anonymousSpeechManager.getPublicState());
    });

    this.app.post('/anonymous-slot', (req, res) => {
      try {
        const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;
        const result = this.anonymousSpeechManager.claimSlot({ displayName });
        res.status(201).json(result);
      } catch (error) {
        this.handleAnonymousSlotError(res, error);
      }
    });

    this.app.delete('/anonymous-slot', (req, res) => {
      const token = this.extractAnonymousToken(req);
      if (!token) {
        res.status(400).json({ error: 'TOKEN_REQUIRED', message: 'Le jeton de session est requis.' });
        return;
      }

      try {
        const state = this.anonymousSpeechManager.releaseSlot(token);
        res.json({ state });
      } catch (error) {
        this.handleAnonymousSlotError(res, error);
      }
    });

    this.app.get('/', (_req, res) => {
      res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
    });
  }

  private handleStreamRequest(req: Request, res: Response): void {
    const mimeType = this.config.mimeTypes[this.config.outputFormat] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Accept-Ranges', 'none');

    try {
      req.socket.setNoDelay(true);
    } catch (error) {
      console.warn('Unable to disable Nagle algorithm for stream socket', error);
    }

    const flushableRes = res as FlushCapableResponse;
    if (typeof flushableRes.flushHeaders === 'function') {
      flushableRes.flushHeaders();
    }

    const headerBuffer = this.transcoder.getHeaderBuffer();
    if (headerBuffer && headerBuffer.length > 0) {
      try {
        res.write(headerBuffer);
        if (typeof flushableRes.flush === 'function') {
          flushableRes.flush();
        }
      } catch (error) {
        console.warn('Failed to send initial stream header buffer', error);
      }
    }

    console.log(
      `New client for ${this.config.streamEndpoint}`,
      req.ip,
      'headerBuffer:',
      headerBuffer.length,
    );

    const clientStream = this.transcoder.createClientStream();
    clientStream.pipe(res);

    req.on('close', () => {
      this.transcoder.releaseClientStream(clientStream);
      console.log('Client disconnected', req.ip);
    });
  }

  public start(): Server {
    if (this.httpServer) {
      return this.httpServer;
    }

    this.httpServer = this.app.listen(this.config.port, () => {
      console.log(`HTTP server listening on http://0.0.0.0:${this.config.port}`);
    });

    this.initializeWebSocketServer();

    return this.httpServer;
  }

  public stop(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    if (this.wsServer) {
      try {
        for (const client of this.wsServer.clients) {
          client.terminate();
        }
        this.wsServer.close();
      } catch (error) {
        console.warn('Failed to close WebSocket server', error);
      }
      this.wsServer = null;
    }
  }

  private initializeWebSocketServer(): void {
    if (!this.httpServer) {
      return;
    }
    this.wsServer = new WebSocketServer({ server: this.httpServer, path: '/anonymous-stream' });
    this.wsServer.on('connection', (socket, request) => {
      this.anonymousSpeechManager.handleSocketConnection(socket, request);
    });
    this.wsServer.on('error', (error) => {
      console.warn('WebSocket server error', error);
    });
  }

  private extractAnonymousToken(req: Request): string | null {
    const header = req.header('authorization') || req.header('Authorization');
    if (header && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim() || null;
    }

    if (req.body && typeof req.body.token === 'string') {
      return req.body.token.trim() || null;
    }

    if (typeof req.query?.token === 'string') {
      return String(req.query.token).trim() || null;
    }

    return null;
  }

  private handleAnonymousSlotError(res: Response, error: unknown): void {
    if (error && typeof error === 'object' && 'status' in error && 'code' in error) {
      const slotError = error as { status?: number; code?: string; message?: string };
      const status = Number(slotError.status) || 500;
      res.status(status).json({ error: slotError.code ?? 'UNKNOWN', message: slotError.message ?? 'Erreur inconnue.' });
      return;
    }

    console.error('Unhandled anonymous slot error', error);
    res.status(500).json({ error: 'UNKNOWN', message: 'Une erreur inattendue est survenue.' });
  }
}
