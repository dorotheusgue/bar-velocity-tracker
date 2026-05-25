import { KalmanFilter1D } from './kalman';
import type { BarDetection, BarPosition } from '../types';

export interface BarTrackerOptions {
  bufferLength?: number;
  processNoise?: number;
  measurementNoise?: number;
  trackingLossThreshold?: number;
}

/**
 * Maintains a rolling history of bar positions and applies a 1D Kalman filter
 * to the vertical channel. Mirrors the iOS `BarTracker`.
 */
export class BarTracker {
  private kalman: KalmanFilter1D | null = null;
  private historyArr: BarPosition[] = [];
  private misses = 0;

  private readonly bufferLength: number;
  private readonly trackingLossThreshold: number;
  private defaultProcessNoise: number;
  private defaultMeasurementNoise: number;

  /** Frame size, set by the orchestrator when the camera starts. */
  frameWidth = 1920;
  frameHeight = 1080;

  isTracking = false;

  constructor(options: BarTrackerOptions = {}) {
    this.bufferLength = options.bufferLength ?? 120;
    this.trackingLossThreshold = options.trackingLossThreshold ?? 5;
    this.defaultProcessNoise = options.processNoise ?? 0.1;
    this.defaultMeasurementNoise = options.measurementNoise ?? 5.0;
  }

  get processNoise() {
    return this.kalman?.q ?? this.defaultProcessNoise;
  }
  set processNoise(value: number) {
    this.defaultProcessNoise = value;
    if (this.kalman) this.kalman.q = value;
  }

  get measurementNoise() {
    return this.kalman?.r ?? this.defaultMeasurementNoise;
  }
  set measurementNoise(value: number) {
    this.defaultMeasurementNoise = value;
    if (this.kalman) this.kalman.r = value;
  }

  get history(): readonly BarPosition[] {
    return this.historyArr;
  }

  reset() {
    this.kalman = null;
    this.historyArr = [];
    this.misses = 0;
    this.isTracking = false;
  }

  /**
   * Fold a new detection into the tracker. Pass `null` for a frame with no
   * detection — repeated misses flip `isTracking` to false.
   */
  ingest(detection: BarDetection | null): BarPosition | null {
    if (!detection) {
      this.misses += 1;
      if (this.misses >= this.trackingLossThreshold) {
        this.isTracking = false;
      }
      return null;
    }

    this.misses = 0;
    this.isTracking = true;

    // detection.boundingBox uses DOM origin (top-left, y grows down).
    const yPixel = (detection.boundingBox.y + detection.boundingBox.height / 2) * this.frameHeight;
    const xPixel = (detection.boundingBox.x + detection.boundingBox.width / 2) * this.frameWidth;

    if (!this.kalman) {
      this.kalman = new KalmanFilter1D(
        yPixel,
        this.defaultProcessNoise,
        this.defaultMeasurementNoise
      );
    }
    const smoothedY = this.kalman.update(yPixel);

    const position: BarPosition = {
      timestamp: detection.timestamp,
      yPixel: smoothedY,
      xPixel,
      boundingBox: detection.boundingBox,
      confidence: detection.confidence,
    };
    this.historyArr.push(position);
    if (this.historyArr.length > this.bufferLength) {
      this.historyArr.splice(0, this.historyArr.length - this.bufferLength);
    }
    return position;
  }
}
