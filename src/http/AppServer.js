const express = require('express');
const path = require('path');

class AppServer {
  constructor({ config, transcoder, speakerTracker, sseService }) {
    this.config = config;
    this.transcoder = transcoder;
    this.speakerTracker = speakerTracker;
    this.sseService = sseService;
    this.app = express();
    this.httpServer = null;

    this.configureMiddleware();
    this.registerRoutes();
  }

  configureMiddleware() {
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

  registerRoutes() {
    this.app.get('/events', (req, res) => {
      this.sseService.handleRequest(req, res, {
        initialState: () => this.speakerTracker.getInitialState(),
      });
    });

    this.app.get(this.config.streamEndpoint, (req, res) => this.handleStreamRequest(req, res));

    this.app.get('/status', (req, res) => {
      res.json({
        ffmpeg_pid: this.transcoder.getCurrentProcessPid(),
        headerBufferBytes: this.transcoder.getHeaderBuffer().length,
        activeSpeakers: this.speakerTracker.getSpeakerCount(),
      });
    });

    this.app.get('/', (req, res) => {
      res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
    });
  }

  handleStreamRequest(req, res) {
    const mimeType = this.config.mimeTypes[this.config.outputFormat] || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');

    try {
      req.socket.setNoDelay(true);
    } catch (error) {
      console.warn('Unable to disable Nagle algorithm for stream socket', error);
    }

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const headerBuffer = this.transcoder.getHeaderBuffer();
    if (headerBuffer && headerBuffer.length > 0) {
      try {
        res.write(headerBuffer);
        if (typeof res.flush === 'function') {
          res.flush();
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

  start() {
    if (this.httpServer) {
      return this.httpServer;
    }

    this.httpServer = this.app.listen(this.config.port, () => {
      console.log(`HTTP server listening on http://0.0.0.0:${this.config.port}`);
    });

    return this.httpServer;
  }

  stop() {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }
}

module.exports = AppServer;
