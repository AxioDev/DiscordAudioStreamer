import express, { type Request, type Response } from 'express';
import path from 'path';
import type { Server } from 'http';
import type FfmpegTranscoder from '../audio/FfmpegTranscoder';
import type SpeakerTracker from '../services/SpeakerTracker';
import type SseService from '../services/SseService';
import type { Config } from '../config';

export interface AppServerOptions {
  config: Config;
  transcoder: FfmpegTranscoder;
  speakerTracker: SpeakerTracker;
  sseService: SseService;
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

  private readonly app = express();

  private httpServer: Server | null = null;

  constructor({ config, transcoder, speakerTracker, sseService }: AppServerOptions) {
    this.config = config;
    this.transcoder = transcoder;
    this.speakerTracker = speakerTracker;
    this.sseService = sseService;

    this.configureMiddleware();
    this.registerRoutes();
  }

  private configureMiddleware(): void {
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }

      next();
    });

    const publicDir = path.resolve(__dirname, '..', '..', 'public');
    this.app.use(express.static(publicDir));
  }

  private registerRoutes(): void {
    this.app.get('/events', (req, res) => {
      this.sseService.handleRequest(req, res, {
        initialState: () => this.speakerTracker.getInitialState(),
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

    return this.httpServer;
  }

  public stop(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}
