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
 * to both vertical and horizontal channels. The horizontal smoothing is
 * mostly cosmetic — kinematics use Y — but it stops the bounding box from
 * shimmering sideways frame-to-frame.
 */
export class BarTracker {
  private kalmanY: KalmanFilter1D | null = null;
  private kalmanX: KalmanFilter1D | null = null;
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
    return this.kalmanY?.q ?? this.defaultProcessNoise;
  }
  set processNoise(value: number) {
    this.defaultProcessNoise = value;
    if (this.kalmanY) this.kalmanY.q = value;
    if (this.kalmanX) this.kalmanX.q = value;
  }

  get measurementNoise() {
    return this.kalmanY?.r ?? this.defaultMeasurementNoise;
  }
  set measurementNoise(value: number) {
    this.defaultMeasurementNoise = value;
    if (this.kalmanY) this.kalmanY.r = value;
    if (this.kalmanX) this.kalmanX.r = value;
  }

  get history(): readonly BarPosition[] {
    return this.historyArr;
  }

  reset() {
    this.kalmanY = null;
    this.kalmanX = null;
    this.historyArr = [];
    this.misses = 0;
    this.isTracking = false;
  }

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
    const rawY = (detection.boundingBox.y + detection.boundingBox.height / 2) * this.frameHeight;
    const rawX = (detection.boundingBox.x + detection.boundingBox.width / 2) * this.frameWidth;

    if (!this.kalmanY) {
      this.kalmanY = new KalmanFilter1D(
        rawY,
        this.defaultProcessNoise,
        this.defaultMeasurementNoise
      );
      // X gets a heavier measurement noise — bars don't translate horizontally
      // in normal lifts, so we want hard smoothing on the lateral channel.
      this.kalmanX = new KalmanFilter1D(
        rawX,
        this.defaultProcessNoise * 0.5,
        this.defaultMeasurementNoise * 2
      );
    }
    const smoothedY = this.kalmanY.update(rawY);
    const smoothedX = this.kalmanX!.update(rawX);

    // Reconstruct a smoothed bounding box centred on the smoothed point.
    // We keep the detection's reported width/height (constant for the template
    // tracker; variable for COCO-SSD).
    const bw = detection.boundingBox.width;
    const bh = detection.boundingBox.height;
    const smoothedBox = {
      x: smoothedX / this.frameWidth - bw / 2,
      y: smoothedY / this.frameHeight - bh / 2,
      width: bw,
      height: bh,
    };

    const position: BarPosition = {
      timestamp: detection.timestamp,
      yPixel: smoothedY,
      xPixel: smoothedX,
      boundingBox: smoothedBox,
      confidence: detection.confidence,
    };
    this.historyArr.push(position);
    if (this.historyArr.length > this.bufferLength) {
      this.historyArr.splice(0, this.historyArr.length - this.bufferLength);
    }
    return position;
  }
}
