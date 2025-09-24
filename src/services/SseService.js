class SseService {
  constructor({ streamInfoProvider, keepAliveInterval }) {
    this.streamInfoProvider = streamInfoProvider;
    this.keepAliveInterval = keepAliveInterval;
    this.clients = new Map();
  }

  handleRequest(req, res, { initialState }) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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

  sendInitialEvents(res, initialState) {
    const infoPayload = this.streamInfoProvider();
    const statePayload = typeof initialState === 'function' ? initialState() : initialState;

    try {
      res.write(`event: info\n`);
      res.write(`data: ${JSON.stringify(infoPayload)}\n\n`);
      if (statePayload) {
        res.write(`event: state\n`);
        res.write(`data: ${JSON.stringify(statePayload)}\n\n`);
      }
    } catch (error) {
      console.warn('Failed to send initial SSE events', error);
    }
  }

  broadcast(eventName, payload) {
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

  createKeepAliveTimer(res) {
    return setInterval(() => {
      try {
        res.write(':keepalive\n\n');
      } catch (error) {
        this.removeClient(res);
      }
    }, this.keepAliveInterval);
  }

  removeClient(res) {
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

  closeAll() {
    const clients = Array.from(this.clients.keys());
    for (const res of clients) {
      this.removeClient(res);
    }
  }
}

module.exports = SseService;
