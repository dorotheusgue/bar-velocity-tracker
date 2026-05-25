/**
 * Scalar 1D Kalman filter for the noisy `yPixel` stream coming out of the
 * detector. The state is a single position; the process model assumes
 * constant position with added process noise.
 */
export class KalmanFilter1D {
  private x: number;
  private p: number;
  /** Process noise covariance — controls responsiveness. */
  q: number;
  /** Measurement noise covariance — controls smoothing. */
  r: number;

  constructor(initialPosition: number, processNoise = 0.1, measurementNoise = 5.0) {
    this.x = initialPosition;
    this.p = 1.0;
    this.q = processNoise;
    this.r = measurementNoise;
  }

  reset(position: number) {
    this.x = position;
    this.p = 1.0;
  }

  update(measurement: number): number {
    const pPrior = this.p + this.q;
    const k = pPrior / (pPrior + this.r);
    this.x = this.x + k * (measurement - this.x);
    this.p = (1 - k) * pPrior;
    return this.x;
  }

  get value() {
    return this.x;
  }
}
