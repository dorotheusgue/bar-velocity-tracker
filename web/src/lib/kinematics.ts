import type { BarPosition } from '../types';
import type { CalibrationManager } from './calibration';

export interface KinematicsListener {
  onVelocity(v: number, t: number): void;
  onPosition(p: number, t: number): void;
}

/**
 * Pixel positions → meters → vertical velocity (m/s).
 * Uses a rolling least-squares slope (5–7 samples by default) instead of
 * frame-to-frame differentiation, and applies ZUPT to clamp drift when the
 * bar is essentially stationary.
 *
 * Conforms to the same `BarMotionSource` contract as the iOS version: emits
 * a velocity and position stream that the rep detector subscribes to.
 */
export class KinematicsEngine {
  windowLength = 7;
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
    if (this.samples.length > 240) {
      this.samples.splice(0, this.samples.length - 240);
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

  /** Least-squares slope of y vs t over the most recent `windowLength` samples. */
  private computeWindowedVelocity(): number {
    const start = Math.max(0, this.samples.length - this.windowLength);
    const window = this.samples.slice(start);
    if (window.length < 2) return 0;

    const n = window.length;
    let sumT = 0,
      sumY = 0,
      sumTT = 0,
      sumTY = 0;
    for (const s of window) {
      sumT += s.t;
      sumY += s.yMeters;
      sumTT += s.t * s.t;
      sumTY += s.t * s.yMeters;
    }
    const denom = n * sumTT - sumT * sumT;
    if (denom === 0) return 0;
    return (n * sumTY - sumT * sumY) / denom;
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
