const config = require('./config');
const AudioMixer = require('./audio/AudioMixer');
const FfmpegTranscoder = require('./audio/FfmpegTranscoder');
const AppServer = require('./http/AppServer');
const SseService = require('./services/SseService');
const SpeakerTracker = require('./services/SpeakerTracker');
const DiscordAudioBridge = require('./discord/DiscordAudioBridge');
const StreamHealthMonitor = require('./services/StreamHealthMonitor');

let runtimeContext = null;
let healthMonitor = null;
let shuttingDown = false;
let restarting = false;

async function startRuntime() {
  const mixer = new AudioMixer({
    frameBytes: config.audio.frameBytes,
    mixFrameMs: config.mixFrameMs,
    bytesPerSample: config.audio.bytesPerSample,
  });
  mixer.start();

  const transcoder = new FfmpegTranscoder({
    ffmpegPath: config.ffmpegPath,
    outputFormat: config.outputFormat,
    opusBitrate: config.opusBitrate,
    mp3Bitrate: config.mp3Bitrate,
    sampleRate: config.audio.sampleRate,
    channels: config.audio.channels,
    headerBufferMaxBytes: config.headerBufferMaxBytes,
    mixFrameMs: config.mixFrameMs,
  });
  transcoder.start(mixer);

  const statsLogInterval = setInterval(() => {
    const statsSnapshot = {
      ...mixer.stats,
      sources: mixer.sources.size,
      ffmpegPid: transcoder.getCurrentProcessPid(),
    };

    console.log('MIX STATS:', statsSnapshot);
  }, 5000);

  if (typeof statsLogInterval.unref === 'function') {
    statsLogInterval.unref();
  }

  const sseService = new SseService({
    streamInfoProvider: () => ({
      format: config.outputFormat,
      path: config.streamEndpoint,
      mimeType: config.mimeTypes[config.outputFormat] || 'application/octet-stream',
    }),
    keepAliveInterval: config.keepAliveInterval,
  });

  const speakerTracker = new SpeakerTracker({ sseService });

  const discordBridge = new DiscordAudioBridge({
    config,
    mixer,
    speakerTracker,
  });

  try {
    await discordBridge.login();
  } catch (error) {
    console.error('Discord login failed', error);
    await stopRuntime({
      mixer,
      transcoder,
      statsLogInterval,
      sseService,
      speakerTracker,
      discordBridge,
      appServer: null,
    });
    throw error;
  }

  const appServer = new AppServer({
    config,
    transcoder,
    speakerTracker,
    sseService,
  });
  appServer.start();

  return {
    mixer,
    transcoder,
    statsLogInterval,
    sseService,
    speakerTracker,
    discordBridge,
    appServer,
  };
}

async function stopRuntime(context) {
  if (!context) {
    return;
  }

  const {
    statsLogInterval,
    mixer,
    transcoder,
    sseService,
    speakerTracker,
    appServer,
    discordBridge,
  } = context;

  try {
    if (statsLogInterval) {
      clearInterval(statsLogInterval);
    }
  } catch (error) {
    console.warn('Error while clearing stats interval', error);
  }

  try {
    mixer?.stop();
  } catch (error) {
    console.warn('Error while stopping mixer', error);
  }

  try {
    transcoder?.stop();
  } catch (error) {
    console.warn('Error while stopping transcoder', error);
  }

  try {
    sseService?.closeAll();
  } catch (error) {
    console.warn('Error while closing SSE connections', error);
  }

  try {
    speakerTracker?.clear();
  } catch (error) {
    console.warn('Error while clearing speaker tracker', error);
  }

  try {
    appServer?.stop();
  } catch (error) {
    console.warn('Error while stopping HTTP server', error);
  }

  if (discordBridge) {
    try {
      await discordBridge.destroy();
    } catch (error) {
      console.warn('Error while destroying Discord bridge', error);
    }
  }
}

async function restartRuntime(info = {}) {
  if (restarting || shuttingDown) {
    return;
  }

  restarting = true;
  const reason = info.reason || 'unknown reason';
  console.warn(`Stream health issue detected (${reason}). Restarting streaming pipeline...`);
  if (info.error) {
    console.warn('Underlying health check error:', info.error);
  }

  try {
    if (healthMonitor) {
      await healthMonitor.stop();
    }

    await stopRuntime(runtimeContext);
    runtimeContext = null;
    runtimeContext = await startRuntime();

    if (healthMonitor && !shuttingDown) {
      healthMonitor.start();
    }

    console.log('Streaming pipeline restarted successfully.');
  } catch (error) {
    console.error('Failed to restart streaming pipeline', error);
    process.exit(1);
  } finally {
    restarting = false;
  }
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log('Shutting down...');

  try {
    if (healthMonitor) {
      await healthMonitor.stop();
    }
  } catch (error) {
    console.warn('Error while stopping health monitor', error);
  }

  try {
    await stopRuntime(runtimeContext);
    runtimeContext = null;
  } catch (error) {
    console.warn('Error while stopping runtime', error);
  }

  process.exit(exitCode);
}

(async () => {
  try {
    runtimeContext = await startRuntime();
  } catch (error) {
    console.error('Application failed to start', error);
    process.exit(1);
  }

  healthMonitor = new StreamHealthMonitor({
    config,
    checkIntervalMs: config.healthCheck.intervalMs,
    connectTimeoutMs: config.healthCheck.connectTimeoutMs,
    playbackTimeoutMs: config.healthCheck.playbackTimeoutMs,
    minDecodedBytes: config.healthCheck.minDecodedBytes,
    failureThreshold: config.healthCheck.failureThreshold,
    onUnhealthy: (info) => {
      restartRuntime(info).catch((error) => {
        console.error('Unhandled error while restarting runtime', error);
        process.exit(1);
      });
    },
  });

  healthMonitor.on('healthy', () => {
    // Optional hook for future metrics/logging.
  });

  healthMonitor.on('unhealthy', (details) => {
    if (details?.failures === 1) {
      console.warn('Stream health degraded:', details);
    }
  });

  healthMonitor.start();
})();

process.on('SIGINT', () => {
  shutdown(0).catch((error) => {
    console.error('Shutdown failed', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown(0).catch((error) => {
    console.error('Shutdown failed', error);
    process.exit(1);
  });
});
