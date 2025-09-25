import type { Request, Response } from 'express';

export interface StreamInfoProvider {
  (): Record<string, unknown>;
}

export interface SseServiceOptions {
  streamInfoProvider: StreamInfoProvider;
  keepAliveInterval: number;
}

interface ClientInfo {
  keepAliveTimer: NodeJS.Timeout;
}

interface HandleRequestOptions {
  initialState?: (() => unknown) | unknown;
}

export default class SseService {
  private readonly streamInfoProvider: StreamInfoProvider;

  private readonly keepAliveInterval: number;

  private readonly clients: Map<Response, ClientInfo>;

  constructor({ streamInfoProvider, keepAliveInterval }: SseServiceOptions) {
    this.streamInfoProvider = streamInfoProvider;
    this.keepAliveInterval = keepAliveInterval;
    this.clients = new Map();
  }

  public handleRequest(req: Request, res: Response, { initialState }: HandleRequestOptions): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      req.socket.setKeepAlive(true);
    } catch (error) {
      console.warn('Unable to enable keep-alive on SSE socket', error);
    }

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    this.clients.set(res, {
      keepAliveTimer: this.createKeepAliveTimer(res),
    });

    this.sendInitialEvents(res, initialState);

    req.on('close', () => this.removeClient(res));
  }

  private sendInitialEvents(res: Response, initialState?: (() => unknown) | unknown): void {
    const infoPayload = this.streamInfoProvider();
    const statePayload = typeof initialState === 'function' ? initialState() : initialState;

    try {
      res.write('event: info\n');
      res.write(`data: ${JSON.stringify(infoPayload)}\n\n`);
      if (statePayload) {
        res.write('event: state\n');
        res.write(`data: ${JSON.stringify(statePayload)}\n\n`);
      }
    } catch (error) {
      console.warn('Failed to send initial SSE events', error);
    }
  }

  public broadcast(eventName: string, payload: unknown): void {
    const data = `event: ${eventName}\n` + `data: ${JSON.stringify(payload)}\n\n`;

    for (const [res] of this.clients) {
      try {
        res.write(data);
      } catch (error) {
        console.warn('Failed to broadcast SSE event, removing client', error);
        this.removeClient(res);
      }
    }
  }

  private createKeepAliveTimer(res: Response): NodeJS.Timeout {
    return setInterval(() => {
      try {
        res.write(':keepalive\n\n');
      } catch (error) {
        this.removeClient(res);
      }
    }, this.keepAliveInterval);
  }

  private removeClient(res: Response): void {
    const client = this.clients.get(res);
    if (!client) {
      return;
    }

    if (client.keepAliveTimer) {
      clearInterval(client.keepAliveTimer);
    }

    this.clients.delete(res);

    try {
      res.end();
    } catch (error) {
      console.warn('Failed to close SSE response', error);
    }
  }

  public closeAll(): void {
    const clients = Array.from(this.clients.keys());
    for (const res of clients) {
      this.removeClient(res);
    }
  }
}
