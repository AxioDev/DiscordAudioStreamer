class AudioMixer {
  constructor({ frameBytes, mixFrameMs, bytesPerSample }) {
    this.frameBytes = frameBytes;
    this.mixFrameMs = mixFrameMs;
    this.bytesPerSample = bytesPerSample;
    this.sources = new Map();
    this.timer = null;
    this.output = null;
    this.running = false;
    this.nullFrame = Buffer.alloc(this.frameBytes);
    this.sampleCount = this.frameBytes / this.bytesPerSample;
    this.mixedFloat = new Float32Array(this.sampleCount);
  }

  setOutput(writable) {
    this.output = writable;
  }

  addSource(id) {
    if (!this.sources.has(id)) {
      this.sources.set(id, { buffer: Buffer.alloc(0) });
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
      return null;
    }

    if (entry.buffer.length >= this.frameBytes) {
      const frame = entry.buffer.subarray(0, this.frameBytes);
      entry.buffer = entry.buffer.subarray(this.frameBytes);
      return frame;
    }

    return null;
  }

  mixFrame() {
    const activeFrames = [];
    for (const id of this.sources.keys()) {
      const frameBuffer = this.readFrameForSource(id);
      if (frameBuffer) {
        activeFrames.push(new Int16Array(frameBuffer.buffer, frameBuffer.byteOffset, this.sampleCount));
      }
    }

    if (activeFrames.length === 0) {
      this.writeToOutput(this.nullFrame);
      return;
    }

    this.mixedFloat.fill(0);

    for (const frame of activeFrames) {
      for (let i = 0; i < this.sampleCount; i += 1) {
        this.mixedFloat[i] += frame[i];
      }
    }

    const normalization = 1 / (activeFrames.length * 32768.0);
    const outputBuffer = Buffer.allocUnsafe(this.frameBytes);
    for (let i = 0; i < this.sampleCount; i += 1) {
      const value = Math.max(-1, Math.min(1, this.mixedFloat[i] * normalization));
      outputBuffer.writeInt16LE(Math.round(value * 32767), i * this.bytesPerSample);
    }

    this.writeToOutput(outputBuffer);
  }

  writeToOutput(buffer) {
    if (this.output && this.output.writable) {
      this.output.write(buffer);
    }
  }

  start() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => this.mixFrame(), this.mixFrameMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }
}

module.exports = AudioMixer;
