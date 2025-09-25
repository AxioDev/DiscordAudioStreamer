const { EventEmitter } = require('events');
const http = require('node:http');
const prism = require('prism-media');

class StreamHealthMonitor extends EventEmitter {
  constructor({
    config,
    checkIntervalMs = 15000,
    connectTimeoutMs = 5000,
    playbackTimeoutMs = 8000,
    minDecodedBytes,
    failureThreshold = 2,
    onUnhealthy,
  }) {
    super();

    if (!config) {
      throw new Error('StreamHealthMonitor requires a config object');
    }

    this.config = config;
    this.checkIntervalMs = checkIntervalMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.playbackTimeoutMs = playbackTimeoutMs;
    this.minDecodedBytes = Math.max(
      config?.audio?.frameBytes || 0,
      typeof minDecodedBytes === 'number' ? minDecodedBytes : (config?.audio?.frameBytes || 0) * 3,
    );
    this.failureThreshold = Math.max(1, failureThreshold);
    this.onUnhealthy = typeof onUnhealthy === 'function' ? onUnhealthy : null;

    this.timer = null;
    this.currentCheck = null;
    this.currentAbort = null;
    this.consecutiveFailures = 0;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.scheduleNextCheck(0);
  }

  async stop() {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.currentAbort) {
      try {
        this.currentAbort();
      } catch (error) {
        // Ignore abort errors
      }
    }

    if (this.currentCheck) {
      try {
        await this.currentCheck;
      } catch (error) {
        // Ignore in-flight check errors when stopping
      }
    }

    this.currentCheck = null;
    this.currentAbort = null;
    this.consecutiveFailures = 0;
  }

  scheduleNextCheck(delay) {
    if (this.stopped) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.runCheck();
    }, delay);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  async runCheck() {
    if (this.stopped || this.currentCheck) {
      return;
    }

    this.currentCheck = this.performCheck();

    let result;
    try {
      result = await this.currentCheck;
    } catch (error) {
      result = { ok: false, reason: 'Unexpected error during health check', error };
    } finally {
      this.currentCheck = null;
      this.currentAbort = null;
    }

    if (!this.stopped) {
      this.handleResult(result);
      this.scheduleNextCheck(this.checkIntervalMs);
    }
  }

  handleResult(result) {
    if (result && result.skipped) {
      return;
    }

    if (result && result.ok) {
      if (this.consecutiveFailures > 0) {
        console.log('Stream health recovered after', this.consecutiveFailures, 'failed check(s).');
      }
      this.consecutiveFailures = 0;
      this.emit('healthy');
      return;
    }

    this.consecutiveFailures += 1;

    const reason = result?.reason || 'Unknown failure reason';
    const error = result?.error;
    console.warn(`Stream health check failed (${this.consecutiveFailures}/${this.failureThreshold}): ${reason}`);
    if (error) {
      console.warn('Health check error details:', error);
    }

    const failures = this.consecutiveFailures;
    this.emit('unhealthy', { reason, error, failures });

    if (failures >= this.failureThreshold) {
      this.consecutiveFailures = 0;
      if (this.onUnhealthy) {
        try {
          this.onUnhealthy({ reason, error, failures });
        } catch (callbackError) {
          console.error('Stream health monitor callback threw an error', callbackError);
        }
      }
    }
  }

  performCheck() {
    return new Promise((resolve) => {
      let resolved = false;
      let request = null;
      let response = null;
      let targetStream = null;
      let playbackTimer = null;
      let connectTimer = null;
      let decoderCleanup = null;
      let dataBytes = 0;

      const cleanup = () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        if (playbackTimer) {
          clearTimeout(playbackTimer);
          playbackTimer = null;
        }
        if (targetStream) {
          targetStream.removeListener('data', onData);
          targetStream.removeListener('error', onStreamError);
          targetStream.removeListener('end', onStreamEnd);
        }
        if (response) {
          response.removeListener('error', onStreamError);
          try {
            response.destroy();
          } catch (error) {
            // Ignore destroy errors
          }
        }
        if (decoderCleanup) {
          try {
            decoderCleanup();
          } catch (error) {
            // Ignore cleanup errors
          }
          decoderCleanup = null;
        }
        if (request) {
          request.destroy();
          request = null;
        }
        targetStream = null;
        response = null;
        this.currentAbort = null;
      };

      const finish = (result) => {
        if (resolved) {
          return;
        }
        resolved = true;
        cleanup();
        resolve(result);
      };

      const onStreamError = (error) => finish({ ok: false, reason: 'Stream error', error });
      const onStreamEnd = () => finish({ ok: false, reason: 'Stream ended before enough data was received' });
      const onData = (chunk) => {
        if (!chunk || chunk.length === 0) {
          return;
        }
        dataBytes += chunk.length;
        if (dataBytes >= this.minDecodedBytes) {
          finish({ ok: true });
        }
      };

      const fail = (reason, error) => finish({ ok: false, reason, error });

      const options = {
        hostname: this.config?.healthCheck?.host || '127.0.0.1',
        port: this.config.port,
        path: this.config.streamEndpoint,
        headers: {
          'Cache-Control': 'no-cache',
          'User-Agent': 'StreamHealthMonitor/1.0',
        },
      };

      connectTimer = setTimeout(() => fail('Connection timed out'), this.connectTimeoutMs);
      if (connectTimer && typeof connectTimer.unref === 'function') {
        connectTimer.unref();
      }

      request = http.get(options, (res) => {
        response = res;
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }

        if (res.statusCode !== 200) {
          res.resume();
          fail(`Unexpected status code ${res.statusCode}`);
          return;
        }

        playbackTimer = setTimeout(() => fail('Timed out waiting for stream data'), this.playbackTimeoutMs);

        const pipeline = this.createPlaybackStream(res, fail);
        decoderCleanup = pipeline.cleanup;
        targetStream = pipeline.stream || res;

        if (playbackTimer && typeof playbackTimer.unref === 'function') {
          playbackTimer.unref();
        }

        targetStream.on('data', onData);
        targetStream.on('error', onStreamError);
        targetStream.on('end', onStreamEnd);
        res.on('error', onStreamError);
      });

      request.on('error', (error) => fail('Request error', error));

      this.currentAbort = () => {
        finish({ ok: true, skipped: true });
      };
    });
  }

  createPlaybackStream(response, fail) {
    const cleanupFns = [];

    if (this.config.outputFormat === 'opus') {
      const demuxer = new prism.opus.OggDemuxer();
      const decoder = new prism.opus.Decoder({
        frameSize: this.config.audio.frameSamples,
        channels: this.config.audio.channels,
        rate: this.config.audio.sampleRate,
      });

      const onDemuxerError = (error) => fail('Ogg demuxer error', error);
      const onDecoderError = (error) => fail('Opus decoder error', error);

      demuxer.on('error', onDemuxerError);
      decoder.on('error', onDecoderError);

      cleanupFns.push(() => {
        demuxer.removeListener('error', onDemuxerError);
        decoder.removeListener('error', onDecoderError);
        try {
          response.unpipe(demuxer);
        } catch (error) {
          // Ignore unpipe errors
        }
        try {
          demuxer.unpipe(decoder);
        } catch (error) {
          // Ignore unpipe errors
        }
        demuxer.destroy();
        decoder.destroy();
      });

      response.pipe(demuxer).pipe(decoder);

      return {
        stream: decoder,
        cleanup: () => {
          while (cleanupFns.length) {
            const fn = cleanupFns.pop();
            try {
              fn();
            } catch (error) {
              // Ignore cleanup errors
            }
          }
        },
      };
    }

    if (this.config.outputFormat === 'mp3') {
      const ffmpeg = new prism.FFmpeg({
        args: [
          '-analyzeduration',
          '0',
          '-loglevel',
          '0',
          '-f',
          'mp3',
          '-i',
          'pipe:0',
          '-f',
          's16le',
          '-ar',
          String(this.config.audio.sampleRate),
          '-ac',
          String(this.config.audio.channels),
        ],
      });

      const onFfmpegError = (error) => fail('FFmpeg decode error', error);
      ffmpeg.on('error', onFfmpegError);

      cleanupFns.push(() => {
        ffmpeg.removeListener('error', onFfmpegError);
        try {
          response.unpipe(ffmpeg);
        } catch (error) {
          // Ignore unpipe errors
        }
        ffmpeg.destroy();
      });

      response.pipe(ffmpeg);

      return {
        stream: ffmpeg,
        cleanup: () => {
          while (cleanupFns.length) {
            const fn = cleanupFns.pop();
            try {
              fn();
            } catch (error) {
              // Ignore cleanup errors
            }
          }
        },
      };
    }

    return {
      stream: response,
      cleanup: () => {},
    };
  }
}

module.exports = StreamHealthMonitor;
