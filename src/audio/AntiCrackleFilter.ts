export interface AntiCrackleFilterOptions {
  bytesPerSample: number;
  sampleCount: number;
  smoothingSamples?: number;
  activationThreshold?: number;
}

/**
 * A very small time-domain smoother that attenuates sharp transitions between
 * successive frames. Discord's decoder occasionally introduces discontinuities
 * (typically when streams resume after momentary drops), which translates into
 * audible crackles. We keep track of the previous sample that was sent to the
 * output and, when the next frame starts too far from that sample, we fade the
 * beginning of the frame so that the transition happens over a couple of
 * milliseconds instead of instantaneously. This lightweight processor removes
 * the perceivable "pop" without affecting the overall frequency content.
 */
export default class AntiCrackleFilter {
  private readonly bytesPerSample: number;

  private readonly smoothingSamples: number;

  private readonly activationThreshold: number;

  private previousSample: number;

  constructor({
    bytesPerSample,
    sampleCount,
    smoothingSamples = 48,
    activationThreshold = 0.35,
  }: AntiCrackleFilterOptions) {
    this.bytesPerSample = bytesPerSample;
    this.smoothingSamples = Math.max(0, Math.min(sampleCount, smoothingSamples));
    this.activationThreshold = Math.max(0, Math.min(1, activationThreshold));
    this.previousSample = 0;
  }

  public reset(): void {
    this.previousSample = 0;
  }

  public process(frame: Buffer): Buffer {
    const sampleCount = frame.length / this.bytesPerSample;
    if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
      return frame;
    }

    const processed = Buffer.allocUnsafe(frame.length);

    let last = this.previousSample;
    const firstSample = frame.readInt16LE(0) / 32768.0;
    const shouldSmooth =
      this.smoothingSamples > 0 && Math.abs(firstSample - last) >= this.activationThreshold;

    for (let i = 0; i < sampleCount; i += 1) {
      const sample = frame.readInt16LE(i * this.bytesPerSample) / 32768.0;
      let value = sample;

      if (shouldSmooth && i < this.smoothingSamples) {
        const ramp = (i + 1) / this.smoothingSamples;
        value = last + (sample - last) * Math.min(ramp, 1);
      }

      if (value > 1) {
        value = 1;
      } else if (value < -1) {
        value = -1;
      }

      processed.writeInt16LE(Math.round(value * 32767), i * this.bytesPerSample);
      last = value;
    }

    this.previousSample = last;
    return processed;
  }
}
