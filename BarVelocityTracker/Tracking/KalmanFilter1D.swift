import Foundation

/// Scalar 1D Kalman filter used to smooth the noisy `yPixel` stream coming out
/// of `BarDetector`. The state is a single position; the process model assumes
/// constant position with added process noise.
final class KalmanFilter1D {
    /// Estimated position (pixels).
    private(set) var x: Double
    /// Estimation error covariance.
    private(set) var p: Double
    /// Process noise covariance — controls responsiveness.
    var q: Double
    /// Measurement noise covariance — controls smoothing.
    var r: Double

    init(initialPosition: Double,
         processNoise: Double = 0.1,
         measurementNoise: Double = 5.0) {
        self.x = initialPosition
        self.p = 1.0
        self.q = processNoise
        self.r = measurementNoise
    }

    /// Reset the filter (call when a new lift starts so prior state does not bias the estimate).
    func reset(to position: Double) {
        x = position
        p = 1.0
    }

    /// Fold a new measurement into the estimate and return the smoothed value.
    @discardableResult
    func update(measurement z: Double) -> Double {
        let pPrior = p + q
        let k = pPrior / (pPrior + r)
        x = x + k * (z - x)
        p = (1 - k) * pPrior
        return x
    }
}
