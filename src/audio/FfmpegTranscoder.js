const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { PassThrough } = require('stream');

class FfmpegTranscoder extends EventEmitter {
  constructor({
    ffmpegPath,
    outputFormat,
    opusBitrate,
    mp3Bitrate,
    sampleRate,
    channels,
    headerBufferMaxBytes,
  }) {
    super();
    this.ffmpegPath = ffmpegPath;
    this.outputFormat = outputFormat;
    this.opusBitrate = opusBitrate;
    this.mp3Bitrate = mp3Bitrate;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.headerBufferMaxBytes = headerBufferMaxBytes;

    this.broadcastStream = new PassThrough();
    this.headerBuffer = Buffer.alloc(0);
    this.mixer = null;
    this.currentProcess = null;
    this.restartTimer = null;
    this.restarting = false;
  }

  start(mixer) {
    this.mixer = mixer;
    this.spawnProcess();
  }

  spawnProcess() {
    if (this.restarting) {
      return;
    }

    this.restarting = true;
    this.clearRestartTimer();

    const args = [
      '-f',
      's16le',
      '-ar',
      String(this.sampleRate),
      '-ac',
      String(this.channels),
      '-i',
      'pipe:0',
      '-loglevel',
      'info',
    ];

    if (this.outputFormat === 'opus') {
      args.push(
        '-c:a',
        'libopus',
        '-b:a',
        String(this.opusBitrate),
        '-f',
        'ogg',
        'pipe:1',
      );
    } else {
      args.push(
        '-c:a',
        'libmp3lame',
        '-b:a',
        String(this.mp3Bitrate),
        '-f',
        'mp3',
        'pipe:1',
      );
    }

    console.log('Starting ffmpeg with format', this.outputFormat);
    const ffmpeg = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    this.currentProcess = ffmpeg;
    this.restarting = false;
    this.headerBuffer = Buffer.alloc(0);
    if (this.mixer) {
      this.mixer.setOutput(ffmpeg.stdin);
    }

    ffmpeg.stdout.on('data', (chunk) => this.handleStdout(chunk));
    ffmpeg.stderr.on('data', (data) => process.stderr.write(data.toString()));
    ffmpeg.on('exit', (code, signal) => this.handleExit(code, signal));
    ffmpeg.on('error', (error) => this.handleError(error));

    console.log('ffmpeg pid=', ffmpeg.pid);
  }

  handleStdout(chunk) {
    if (this.headerBuffer.length < this.headerBufferMaxBytes) {
      const remaining = this.headerBufferMaxBytes - this.headerBuffer.length;
      const slice = chunk.slice(0, remaining);
      this.headerBuffer = Buffer.concat([this.headerBuffer, slice]);
    }

    this.broadcastStream.write(chunk);
    this.emit('data', chunk);
  }

  handleExit(code, signal) {
    console.warn(`ffmpeg exited code=${code} signal=${signal}`);
    if (this.mixer) {
      this.mixer.setOutput(null);
    }
    this.currentProcess = null;
    this.scheduleRestart(800);
  }

  handleError(error) {
    console.error('ffmpeg error', error);
    if (this.mixer) {
      this.mixer.setOutput(null);
    }
    this.currentProcess = null;
    this.scheduleRestart(2000);
  }

  scheduleRestart(delay) {
    if (this.restartTimer) {
      return;
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnProcess();
    }, delay);
  }

  clearRestartTimer() {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  createClientStream() {
    const clientStream = new PassThrough();
    this.broadcastStream.pipe(clientStream);
    return clientStream;
  }

  releaseClientStream(stream) {
    try {
      this.broadcastStream.unpipe(stream);
    } catch (error) {
      console.warn('Failed to unpipe client stream', error);
    }
    try {
      stream.end();
    } catch (error) {
      console.warn('Failed to close client stream', error);
    }
  }

  getHeaderBuffer() {
    return this.headerBuffer;
  }

  getCurrentProcessPid() {
    return this.currentProcess ? this.currentProcess.pid : null;
  }

  stop() {
    this.clearRestartTimer();
    this.restarting = false;
    if (this.currentProcess && !this.currentProcess.killed) {
      try {
        this.currentProcess.stdin.end();
      } catch (error) {
        console.warn('Error while closing ffmpeg stdin', error);
      }
      this.currentProcess.kill('SIGTERM');
    }
    this.currentProcess = null;
    if (this.mixer) {
      this.mixer.setOutput(null);
    }
    this.broadcastStream.end();
  }
}

module.exports = FfmpegTranscoder;
