interface VoiceAnonymizerOptions {
  sampleRate: number;
  bytesPerSample: number;
  modulationFrequency?: number;
  noiseAmplitude?: number;
}

export default class VoiceAnonymizer {
  private readonly bytesPerSample: number;

  private readonly modulationFrequency: number;

  private readonly noiseAmplitude: number;

  private readonly phaseIncrement: number;

  private phase: number;

  private noiseSeed: number;

  constructor({
    sampleRate,
    bytesPerSample,
    modulationFrequency = 120,
    noiseAmplitude = 0.015,
  }: VoiceAnonymizerOptions) {
    this.bytesPerSample = bytesPerSample;
    this.modulationFrequency = modulationFrequency;
    this.noiseAmplitude = noiseAmplitude;
    this.phaseIncrement = (2 * Math.PI * this.modulationFrequency) / sampleRate;
    this.phase = 0;
    this.noiseSeed = 1;
  }

  public reset(): void {
    this.phase = 0;
    this.noiseSeed = 1;
  }

  private nextNoise(): number {
    // Xorshift32 pseudo-random generator to keep the modulation deterministic per run.
    this.noiseSeed ^= this.noiseSeed << 13;
    this.noiseSeed ^= this.noiseSeed >> 17;
    this.noiseSeed ^= this.noiseSeed << 5;
    // Scale to [-0.5, 0.5]
    return ((this.noiseSeed >>> 0) / 0xffffffff) - 0.5;
  }

  public process(frame: Buffer): Buffer {
    if (frame.length === 0) {
      return frame;
    }

    const output = Buffer.allocUnsafe(frame.length);
    const sampleCount = frame.length / this.bytesPerSample;

    for (let i = 0; i < sampleCount; i += 1) {
      const offset = i * this.bytesPerSample;
      const sample = frame.readInt16LE(offset) / 32768;

      const modulator = Math.sin(this.phase) * 0.7 + Math.sin(this.phase * 0.5) * 0.3;
      let value = sample * modulator;

      // Soft saturation to further mask voice characteristics.
      value = Math.tanh(value * 2.5);

      value += this.nextNoise() * this.noiseAmplitude;

      if (value > 1) {
        value = 1;
      } else if (value < -1) {
        value = -1;
      }

      output.writeInt16LE(Math.round(value * 32767), offset);

      this.phase += this.phaseIncrement;
      if (this.phase > Math.PI * 2) {
        this.phase -= Math.PI * 2;
      }
    }

    return output;
  }
}

