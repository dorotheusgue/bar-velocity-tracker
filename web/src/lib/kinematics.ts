import type { BarPosition } from '../types';
import type { CalibrationManager } from './calibration';

export interface KinematicsListener {
  onVelocity(v: number, t: number): void;
  onPosition(p: number, t: number): void;
}

/**
 * Pixel positions → meters → vertical velocity (m/s).
 *
 * Slope is computed via least-squares regression over the samples in the most
 * recent `windowSeconds` of *video time*, not a fixed sample count — that way
 * a 30 fps clip and a 120 fps slow-mo both fit the slope over the same real
 * duration (~200 ms by default) instead of one being four times noisier.
 *
 * Conforms to the same `BarMotionSource` contract as the iOS version: emits
 * a velocity and position stream that the rep detector subscribes to.
 */
export class KinematicsEngine {
  /** Real-time span the least-squares window covers, in seconds. */
  windowSeconds = 0.2;
  /** Lower bound on samples used in the slope, to handle very low frame rates. */
  minWindowSamples = 3;
  /** Upper bound on samples used in the slope, to cap CPU at very high fps. */
  maxWindowSamples = 32;
  zuptVelocityThreshold = 0.02; // m/s
  zuptDuration = 0.15; // seconds

  currentVelocity = 0;
  currentPositionMeters = 0;

  private samples: Array<{ t: number; yMeters: number }> = [];
  private quietStartedAt: number | null = null;
  private driftOffset = 0;
  private listeners: Set<KinematicsListener> = new Set();

  constructor(private calibration: CalibrationManager) {}

  ingest(position: BarPosition) {
    // yPixel uses DOM origin (top-left, y grows down). Flip the sign so
    // positive meters = upward, matching the rest of the system.
    const yMeters = -this.calibration.convertPixelsToMeters(position.yPixel) - this.driftOffset;
    this.samples.push({ t: position.timestamp, yMeters });
    // ~4 seconds of history at 120 fps; cheap to keep, helps long ZUPT windows.
    if (this.samples.length > 480) {
      this.samples.splice(0, this.samples.length - 480);
    }

    const rawVelocity = this.computeWindowedVelocity();
    const velocity = this.applyZUPT(rawVelocity, yMeters, position.timestamp);

    this.currentVelocity = velocity;
    this.currentPositionMeters = yMeters;
    for (const l of this.listeners) {
      l.onVelocity(velocity, position.timestamp);
      l.onPosition(yMeters, position.timestamp);
    }
  }

  reset() {
    this.samples = [];
    this.quietStartedAt = null;
    this.driftOffset = 0;
    this.currentVelocity = 0;
    this.currentPositionMeters = 0;
  }

  subscribe(listener: KinematicsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Directly emit a pre-computed (velocity, position, t) sample to listeners.
   * Used by the offline pipeline to replay a fully-smoothed trajectory through
   * the existing rep detector. Position is delivered before velocity so the
   * rep detector's current position is up to date when velocity is processed.
   */
  emit(velocity: number, positionMeters: number, t: number) {
    this.currentVelocity = velocity;
    this.currentPositionMeters = positionMeters;
    for (const l of this.listeners) {
      l.onPosition(positionMeters, t);
      l.onVelocity(velocity, t);
    }
  }

  /**
   * Least-squares slope of y vs t over the samples within `windowSeconds`
   * of video time, clamped between `minWindowSamples` and `maxWindowSamples`
   * so we behave sanely at the extremes (10 fps webcam through 240 fps phone
   * slow-mo).
   */
  private computeWindowedVelocity(): number {
    const total = this.samples.length;
    if (total < 2) return 0;

    const latestT = this.samples[total - 1].t;
    const cutoff = latestT - this.windowSeconds;
    let startIdx = total - 1;
    while (startIdx > 0 && this.samples[startIdx - 1].t >= cutoff) startIdx--;

    let count = total - startIdx;
    if (count < this.minWindowSamples) {
      startIdx = Math.max(0, total - this.minWindowSamples);
      count = total - startIdx;
    } else if (count > this.maxWindowSamples) {
      startIdx = total - this.maxWindowSamples;
      count = this.maxWindowSamples;
    }
    if (count < 2) return 0;

    let sumT = 0;
    let sumY = 0;
    let sumTT = 0;
    let sumTY = 0;
    for (let i = startIdx; i < total; i++) {
      const s = this.samples[i];
      sumT += s.t;
      sumY += s.yMeters;
      sumTT += s.t * s.t;
      sumTY += s.t * s.yMeters;
    }
    const denom = count * sumTT - sumT * sumT;
    if (denom === 0) return 0;
    return (count * sumTY - sumT * sumY) / denom;
  }

  /**
   * Zero-velocity update: when the bar has been near-stationary for longer
   * than `zuptDuration`, treat the current position as the new origin and
   * clamp velocity to zero.
   */
  private applyZUPT(rawVelocity: number, latestY: number, t: number): number {
    if (Math.abs(rawVelocity) < this.zuptVelocityThreshold) {
      if (this.quietStartedAt != null) {
        if (t - this.quietStartedAt >= this.zuptDuration) {
          this.driftOffset += latestY;
          for (const s of this.samples) s.yMeters -= latestY;
          return 0;
        }
      } else {
        this.quietStartedAt = t;
      }
    } else {
      this.quietStartedAt = null;
    }
    return rawVelocity;
  }
}
