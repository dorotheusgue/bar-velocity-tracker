import type { Rep, RepPhase } from '../types';
import type { KinematicsEngine } from './kinematics';

export interface RepDetectorOptions {
  concentricStartThreshold?: number;
  repEndThreshold?: number;
  eccentricStartThreshold?: number;
  /** Debounce window in seconds. */
  minRepGap?: number;
}

/**
 * State machine that segments the velocity stream into reps. Mirrors the
 * iOS detector. Decoupled from the source: takes a kinematics-shaped
 * subscription so a future BLE/IMU source can drive it instead.
 */
export class RepDetector {
  phase: RepPhase = 'idle';
  repCount = 0;

  private concentricStart: number = 0;
  private concentricStartPosition = 0;
  private concentricVelocities: number[] = [];
  private concentricPeak = 0;
  private concentricMaxPosition = -Infinity;
  private currentPosition = 0;
  private lastEndTimestamp = -Infinity;
  private readonly opts: Required<RepDetectorOptions>;
  private listeners: Set<(rep: Rep) => void> = new Set();
  private unsubscribeVel?: () => void;
  private unsubscribePos?: () => void;

  constructor(source: KinematicsEngine, opts: RepDetectorOptions = {}) {
    this.opts = {
      concentricStartThreshold: opts.concentricStartThreshold ?? 0.05,
      repEndThreshold: opts.repEndThreshold ?? 0.02,
      eccentricStartThreshold: opts.eccentricStartThreshold ?? -0.05,
      minRepGap: opts.minRepGap ?? 0.5,
    };
    this.bind(source);
  }

  bind(source: KinematicsEngine) {
    this.unsubscribeVel?.();
    this.unsubscribePos?.();
    const unsubscribe = source.subscribe({
      onVelocity: (v, t) => this.ingestVelocity(v, t),
      onPosition: (p) => (this.currentPosition = p),
    });
    this.unsubscribeVel = unsubscribe;
  }

  reset() {
    this.phase = 'idle';
    this.repCount = 0;
    this.concentricVelocities = [];
    this.concentricPeak = 0;
    this.concentricMaxPosition = -Infinity;
    this.lastEndTimestamp = -Infinity;
  }

  onRep(listener: (rep: Rep) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ingestVelocity(v: number, t: number) {
    switch (this.phase) {
      case 'idle':
      case 'topOfRep':
        if (v <= this.opts.eccentricStartThreshold) {
          this.phase = 'eccentric';
        } else if (v >= this.opts.concentricStartThreshold) {
          this.beginConcentric(t);
        }
        break;

      case 'eccentric':
        if (Math.abs(v) < this.opts.repEndThreshold) {
          this.phase = 'transition';
        } else if (v >= this.opts.concentricStartThreshold) {
          this.beginConcentric(t);
        }
        break;

      case 'transition':
        if (v >= this.opts.concentricStartThreshold) {
          this.beginConcentric(t);
        } else if (v <= this.opts.eccentricStartThreshold) {
          this.phase = 'eccentric';
        }
        break;

      case 'concentric':
        this.concentricVelocities.push(v);
        if (v > this.concentricPeak) this.concentricPeak = v;
        if (this.currentPosition > this.concentricMaxPosition) {
          this.concentricMaxPosition = this.currentPosition;
        }
        if (
          v < this.opts.repEndThreshold &&
          this.concentricPeak > this.opts.concentricStartThreshold
        ) {
          this.completeRep(t);
        }
        break;
    }
  }

  private beginConcentric(t: number) {
    if (t - this.lastEndTimestamp < this.opts.minRepGap) return;
    this.phase = 'concentric';
    this.concentricStart = t;
    this.concentricStartPosition = this.currentPosition;
    this.concentricVelocities = [];
    this.concentricPeak = 0;
    this.concentricMaxPosition = this.currentPosition;
  }

  private completeRep(t: number) {
    const duration = t - this.concentricStart;
    const mean =
      this.concentricVelocities.length === 0
        ? 0
        : this.concentricVelocities.reduce((a, b) => a + b, 0) /
          this.concentricVelocities.length;
    const rom = Math.max(0, this.concentricMaxPosition - this.concentricStartPosition);

    this.repCount += 1;
    const rep: Rep = {
      id: crypto.randomUUID(),
      index: this.repCount,
      meanConcentricVelocity: mean,
      peakConcentricVelocity: this.concentricPeak,
      rangeOfMotion: rom,
      concentricDuration: duration,
      timestamp: Date.now(),
      videoStart: this.concentricStart,
      videoEnd: t,
    };
    for (const l of this.listeners) l(rep);

    this.lastEndTimestamp = t;
    this.phase = 'topOfRep';
  }
}
