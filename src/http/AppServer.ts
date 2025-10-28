import compression from 'compression';
import express, { type Request, type Response } from 'express';
import helmet from 'helmet';
import type { Server } from 'http';
import type FfmpegTranscoder from '../audio/FfmpegTranscoder';
import type { Config } from '../config';
import type ListenerStatsService from '../services/ListenerStatsService';

type FlushCapableResponse = Response & { flushHeaders?: () => void; flush?: () => void };

interface AppServerOptions {
  config: Config;
  transcoder: FfmpegTranscoder;
  listenerStatsService: ListenerStatsService;
}

export default class AppServer {
  private readonly config: Config;

  private readonly transcoder: FfmpegTranscoder;

  private readonly listenerStatsService: ListenerStatsService;

  private readonly app = express();

  private httpServer: Server | null = null;

  private readonly streamListenersByIp = new Map<string, number>();

  constructor({ config, transcoder, listenerStatsService }: AppServerOptions) {
    this.config = config;
    this.transcoder = transcoder;
    this.listenerStatsService = listenerStatsService;

    this.configureMiddleware();
    this.registerRoutes();
  }

  private configureMiddleware(): void {
    this.app.disable('x-powered-by');

    this.app.use(
      helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        referrerPolicy: { policy: 'no-referrer-when-downgrade' },
      }),
    );

    this.app.use(
      compression({
        threshold: 512,
        filter: (req, res) => {
          if (req.path === this.getStreamPath()) {
            return false;
          }

          const header = req.headers['x-no-compression'];
          if (typeof header === 'string' && header.toLowerCase() === 'true') {
            return false;
          }

          return compression.filter(req, res);
        },
      }),
    );
  }

  private registerRoutes(): void {
    const streamPath = this.getStreamPath();
    this.app.get('/', this.handleHomeRequest);
    this.app.get(streamPath, (req, res) => this.handleStreamRequest(req, res));

    this.app.use((_req, res) => {
      res.status(404).type('text/plain; charset=utf-8').send('Not found');
    });
  }

  public start(): Server {
    if (this.httpServer) {
      return this.httpServer;
    }

    this.httpServer = this.app.listen(this.config.port);
    return this.httpServer;
  }

  public stop(): void {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  private readonly handleHomeRequest = (_req: Request, res: Response): void => {
    const streamPath = this.getStreamPath();
    const audioType = this.getStreamMimeType();
    const siteName = this.escapeHtml(this.config.siteName || 'Flux audio');
    const description =
      'Écoute le flux audio en direct diffusé depuis Discord. Aucun front-end complexe, juste la radio.';
    const listenerCount = this.listenerStatsService.getCurrentCount();
    const absoluteStreamUrl = this.escapeHtml(this.toAbsoluteUrl(streamPath));
    const displayStreamPath = this.escapeHtml(streamPath);

    const html = `<!doctype html>
<html lang="${this.escapeHtml(this.config.siteLanguage || 'fr')}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${siteName}</title>
    <meta name="description" content="${this.escapeHtml(description)}" />
    <link rel="canonical" href="${absoluteStreamUrl}" />
    <style>
      :root {
        color-scheme: dark light;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #1f2937, #0f172a);
        color: #f8fafc;
      }
      main {
        width: min(92vw, 32rem);
        padding: 2.5rem 2rem;
        border-radius: 1.5rem;
        background: rgba(15, 23, 42, 0.85);
        backdrop-filter: blur(12px);
        box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.65);
        text-align: center;
      }
      h1 {
        font-size: clamp(1.75rem, 5vw, 2.75rem);
        margin-bottom: 1rem;
      }
      p {
        margin: 0.5rem 0 1.5rem;
        line-height: 1.6;
        color: rgba(226, 232, 240, 0.85);
      }
      .listeners {
        font-size: 0.95rem;
        color: rgba(148, 163, 184, 0.9);
      }
      audio {
        width: 100%;
        margin-top: 1.5rem;
        border-radius: 0.75rem;
        box-shadow: 0 10px 25px -12px rgba(15, 23, 42, 0.8);
      }
      footer {
        margin-top: 1.5rem;
        font-size: 0.85rem;
        color: rgba(148, 163, 184, 0.8);
      }
      a {
        color: inherit;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${siteName}</h1>
      <p>${this.escapeHtml(description)}</p>
      <p class="listeners">${listenerCount === 0 ? 'Aucun auditeur connecté pour le moment.' : `${listenerCount} auditeur${listenerCount > 1 ? 's' : ''} connecté${listenerCount > 1 ? 's' : ''}.`}</p>
      <audio controls preload="none" autoplay src="${displayStreamPath}" type="${this.escapeHtml(audioType)}">
        Votre navigateur ne supporte pas la lecture audio HTML5.
      </audio>
      <footer>
        Flux direct&nbsp;: <a href="${displayStreamPath}">${displayStreamPath}</a>
      </footer>
    </main>
  </body>
</html>`;

    res
      .status(200)
      .setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .type('text/html; charset=utf-8')
      .send(html);
  };

  private readonly normalizeIp = (ip: string | null | undefined): string => {
    if (!ip) {
      return 'unknown';
    }

    const trimmed = ip.trim();
    if (trimmed.startsWith('::ffff:')) {
      return trimmed.slice(7);
    }

    return trimmed;
  };

  private readonly getClientIp = (req: Request): string => {
    const forwarded = req.headers['x-forwarded-for'];

    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const [first] = forwarded.split(',');
      if (first) {
        return this.normalizeIp(first);
      }
    } else if (Array.isArray(forwarded)) {
      for (const value of forwarded) {
        if (typeof value === 'string' && value.length > 0) {
          const [first] = value.split(',');
          if (first) {
            return this.normalizeIp(first);
          }
        }
      }
    }

    return this.normalizeIp(req.ip ?? req.socket.remoteAddress ?? null);
  };

  private readonly handleStreamRequest = (req: Request, res: Response): void => {
    const mimeType = this.getStreamMimeType();
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Accept-Ranges', 'none');

    const clientIp = this.getClientIp(req);

    try {
      req.socket.setNoDelay(true);
    } catch (error) {
      console.error('Unable to disable Nagle algorithm for stream socket', error);
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
        console.error('Failed to send initial stream header buffer', error);
      }
    }

    const clientStream = this.transcoder.createClientStream();
    clientStream.pipe(res);

    let closed = false;

    const previousConnectionCount = this.streamListenersByIp.get(clientIp) ?? 0;
    const nextConnectionCount = previousConnectionCount + 1;
    this.streamListenersByIp.set(clientIp, nextConnectionCount);

    if (previousConnectionCount === 0) {
      this.listenerStatsService.increment();
    }

    const cleanup = (): void => {
      if (closed) {
        return;
      }
      closed = true;
      this.transcoder.releaseClientStream(clientStream);

      const currentConnections = this.streamListenersByIp.get(clientIp) ?? 0;
      const remainingConnections = Math.max(0, currentConnections - 1);

      if (remainingConnections <= 0) {
        this.streamListenersByIp.delete(clientIp);
        this.listenerStatsService.decrement();
      } else {
        this.streamListenersByIp.set(clientIp, remainingConnections);
      }
    };

    const handleClose = (): void => {
      cleanup();
    };

    req.on('close', handleClose);
    req.on('error', handleClose);
    res.on('close', handleClose);
    res.on('finish', handleClose);
    res.on('error', handleClose);
    clientStream.on('error', handleClose);
  };

  private getStreamMimeType(): string {
    return this.config.mimeTypes[this.config.outputFormat] || 'application/octet-stream';
  }

  private getStreamPath(): string {
    const endpoint = this.config.streamEndpoint || '/stream';
    return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  }

  private toAbsoluteUrl(pathname: string): string {
    try {
      return new URL(pathname, this.config.publicBaseUrl || 'http://localhost').toString();
    } catch (error) {
      console.error('Failed to compute absolute URL', { pathname, error });
      return pathname;
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
