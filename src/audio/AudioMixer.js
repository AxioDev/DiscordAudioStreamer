class AudioMixer {
  constructor({ frameBytes, mixFrameMs, bytesPerSample }) {
    this.frameBytes = frameBytes;
    this.mixFrameMs = mixFrameMs;
    this.bytesPerSample = bytesPerSample;
    this.sampleCount = this.frameBytes / this.bytesPerSample;

    this.sources = new Map();
    this.timer = null;
    this.output = null;
    this.outputDrainListener = null;
    this.running = false;
    this.pausedForBackpressure = false;

    this.nullFrame = Buffer.alloc(this.frameBytes);
    this.mixedFloat = new Float32Array(this.sampleCount);

    this.stats = {
      mixTicks: 0,
      useLastFrameCount: 0,
      backpressureCount: 0,
      avgActiveSources: 0,
    };

    this.ACTIVE_RMS_THRESHOLD = 0.002;
    this.FADE_FRAMES = 2;
    this.fadeIncrement = this.FADE_FRAMES > 0 ? 1 / this.FADE_FRAMES : 1;
    this.MAX_PLC_FRAMES = 5;
  }

  setOutput(writable) {
    if (this.output && this.outputDrainListener) {
      this.output.removeListener('drain', this.outputDrainListener);
    }

    this.output = writable;
    this.pausedForBackpressure = false;

    if (this.output) {
      this.outputDrainListener = () => {
        if (this.pausedForBackpressure) {
          this.pausedForBackpressure = false;
          this.ensureMixLoop();
        }
      };
      this.output.on('drain', this.outputDrainListener);
    } else {
      this.outputDrainListener = null;
    }

    this.ensureMixLoop();
  }

  addSource(id) {
    if (!this.sources.has(id)) {
      this.sources.set(id, {
        buffer: Buffer.alloc(0),
        lastFrame: null,
        lastActiveTs: 0,
        envelope: 0,
        consecutiveFallbacks: 0,
      });
    }
  }

  removeSource(id) {
    this.sources.delete(id);
  }

  pushToSource(id, chunk) {
    const entry = this.sources.get(id);
    if (!entry) {
      return;
    }

    entry.buffer = Buffer.concat([entry.buffer, chunk]);
    const maxCapacity = this.frameBytes * 200;
    if (entry.buffer.length > maxCapacity) {
      entry.buffer = entry.buffer.slice(entry.buffer.length - maxCapacity);
    }
  }

  readFrameForSource(id) {
    const entry = this.sources.get(id);
    if (!entry) {
      return { frame: null, isFresh: false };
    }

    if (entry.buffer.length >= this.frameBytes) {
      const frame = entry.buffer.slice(0, this.frameBytes);
      entry.buffer = entry.buffer.slice(this.frameBytes);
      entry.lastFrame = frame;
      entry.lastActiveTs = Date.now();
      entry.consecutiveFallbacks = 0;
      return { frame, isFresh: true };
    }

    if (entry.lastFrame) {
      entry.consecutiveFallbacks += 1;
      return { frame: entry.lastFrame, isFresh: false };
    }

    return { frame: null, isFresh: false };
  }

  computeRMS(frameBuf, envelope = 1) {
    if (!frameBuf) {
      return 0;
    }

    let sumSquares = 0;
    for (let i = 0; i < this.sampleCount; i += 1) {
      const sample = frameBuf.readInt16LE(i * this.bytesPerSample) / 32768.0;
      const scaled = sample * envelope;
      sumSquares += scaled * scaled;
    }

    return Math.sqrt(sumSquares / this.sampleCount);
  }

  mixFrame() {
    if (!this.running || this.pausedForBackpressure) {
      return;
    }

    if (!this.output || !this.output.writable) {
      return;
    }

    this.stats.mixTicks += 1;

    const activeFrames = [];

    for (const [id, entry] of this.sources.entries()) {
      const { frame, isFresh } = this.readFrameForSource(id);
      if (!frame) {
        continue;
      }

      let envelope = entry.envelope;
      if (isFresh) {
        envelope = Math.min(1, envelope + this.fadeIncrement);
        entry.lastActiveTs = Date.now();
      } else {
        this.stats.useLastFrameCount += 1;
        if (entry.consecutiveFallbacks > this.MAX_PLC_FRAMES) {
          envelope = Math.max(0, envelope - this.fadeIncrement);
          if (envelope === 0) {
            entry.envelope = 0;
            continue;
          }
        } else if (envelope === 0) {
          envelope = this.fadeIncrement;
        }
      }

      entry.envelope = envelope;
      const rms = this.computeRMS(frame, envelope);
      activeFrames.push({ id, frame, envelope, rms });
    }

    let activeForStats = 0;

    if (activeFrames.length === 0) {
      const ok = this.writeToOutput(this.nullFrame);
      if (!ok) {
        this.stats.backpressureCount += 1;
        this.pauseMixingForBackpressure();
      }
      this.updateAverageActiveSources(activeForStats);
      return;
    }

    const activeSpeakers = activeFrames.filter((frameInfo) => frameInfo.rms >= this.ACTIVE_RMS_THRESHOLD);
    activeForStats = activeSpeakers.length;
    const normalizationCount = Math.max(1, activeSpeakers.length);

    this.mixedFloat.fill(0);

    for (const frameInfo of activeFrames) {
      const { frame, envelope } = frameInfo;
      for (let i = 0; i < this.sampleCount; i += 1) {
        const sample = frame.readInt16LE(i * this.bytesPerSample);
        this.mixedFloat[i] += sample * envelope;
      }
    }

    const normalization = 1 / (normalizationCount * 32768.0);
    const outputBuffer = Buffer.allocUnsafe(this.frameBytes);

    for (let i = 0; i < this.sampleCount; i += 1) {
      let value = this.mixedFloat[i] * normalization;
      if (value > 1) {
        value = 1;
      } else if (value < -1) {
        value = -1;
      }
      outputBuffer.writeInt16LE(Math.round(value * 32767), i * this.bytesPerSample);
    }

    this.updateAverageActiveSources(activeForStats);

    const ok = this.writeToOutput(outputBuffer);
    if (!ok) {
      this.stats.backpressureCount += 1;
      this.pauseMixingForBackpressure();
    }
  }

  writeToOutput(buffer) {
    if (this.output && this.output.writable) {
      return this.output.write(buffer);
    }
    return true;
  }

  pauseMixingForBackpressure() {
    if (this.pausedForBackpressure) {
      return;
    }

    this.pausedForBackpressure = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  ensureMixLoop() {
    if (!this.running || this.pausedForBackpressure || this.timer) {
      return;
    }

    this.timer = setInterval(() => this.mixFrame(), this.mixFrameMs);
  }

  updateAverageActiveSources(count) {
    const { mixTicks } = this.stats;
    if (mixTicks === 0) {
      this.stats.avgActiveSources = 0;
      return;
    }

    this.stats.avgActiveSources =
      ((this.stats.avgActiveSources * (mixTicks - 1)) + count) / mixTicks;
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.ensureMixLoop();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pausedForBackpressure = false;
  }
}

module.exports = AudioMixer;
