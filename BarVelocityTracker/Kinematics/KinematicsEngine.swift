import Combine
import Foundation

/// Converts smoothed pixel positions into meters-per-second vertical velocity.
/// Uses a rolling-window slope (least squares over N samples) to suppress
/// frame-to-frame jitter and applies ZUPT (zero-velocity update) to zero out
/// drift when the bar is essentially stationary.
final class KinematicsEngine: ObservableObject, BarMotionSource {
    @Published private(set) var currentVelocity: Double = 0   // m/s, positive = upward
    @Published private(set) var currentPositionMeters: Double = 0

    /// Window length (samples) used for the velocity slope. 5–7 is the spec range.
    var windowLength: Int = 7

    /// Velocity magnitude below which ZUPT considers the bar "stopped".
    var zuptVelocityThreshold: Double = 0.02       // m/s
    /// Time the velocity must remain below the threshold before ZUPT fires.
    var zuptDuration: TimeInterval = 0.150         // seconds

    private let calibration: CalibrationManager
    private var samples: [(t: Double, yMeters: Double)] = []
    private let maxSamples = 240

    private var quietStartedAt: Double?
    private var driftOffset: Double = 0    // meters subtracted to enforce ZUPT clamp

    private let velocitySubject = PassthroughSubject<Double, Never>()
    private let positionSubject = PassthroughSubject<Double, Never>()

    var velocityPublisher: AnyPublisher<Double, Never> { velocitySubject.eraseToAnyPublisher() }
    var positionPublisher: AnyPublisher<Double, Never> { positionSubject.eraseToAnyPublisher() }

    init(calibration: CalibrationManager) {
        self.calibration = calibration
    }

    /// Feed one smoothed position from `BarTracker`.
    func ingest(_ position: BarPosition) {
        // BarTracker yPixel uses origin top-left (y grows downward). Flip the
        // sign so positive meters = upward, matching the rest of the system.
        let yMeters = -calibration.convert(pixels: position.yPixel, axis: .y) - driftOffset
        samples.append((position.timestamp, yMeters))
        if samples.count > maxSamples {
            samples.removeFirst(samples.count - maxSamples)
        }

        let velocity = computeWindowedVelocity()
        let zuptVelocity = applyZUPT(rawVelocity: velocity, latestY: yMeters, t: position.timestamp)

        currentVelocity = zuptVelocity
        currentPositionMeters = yMeters
        velocitySubject.send(zuptVelocity)
        positionSubject.send(yMeters)
    }

    func reset() {
        samples.removeAll()
        quietStartedAt = nil
        driftOffset = 0
        currentVelocity = 0
        currentPositionMeters = 0
    }

    // MARK: - Internals

    /// Least-squares slope of y vs. t over the most recent `windowLength` samples.
    private func computeWindowedVelocity() -> Double {
        let window = Array(samples.suffix(windowLength))
        guard window.count >= 2 else { return 0 }

        let n = Double(window.count)
        var sumT = 0.0, sumY = 0.0, sumTT = 0.0, sumTY = 0.0
        for s in window {
            sumT  += s.t
            sumY  += s.yMeters
            sumTT += s.t * s.t
            sumTY += s.t * s.yMeters
        }
        let denom = n * sumTT - sumT * sumT
        guard denom != 0 else { return 0 }
        return (n * sumTY - sumT * sumY) / denom
    }

    /// Zero-velocity update: when the bar has been close-to-stationary for
    /// longer than `zuptDuration`, treat the current position as the new origin
    /// and clamp velocity to zero. This prevents integrated drift from inflating
    /// reported velocity between sets.
    private func applyZUPT(rawVelocity: Double, latestY: Double, t: Double) -> Double {
        if abs(rawVelocity) < zuptVelocityThreshold {
            if let started = quietStartedAt {
                if t - started >= zuptDuration {
                    driftOffset += latestY  // re-anchor origin to here
                    samples = samples.map { ($0.t, $0.yMeters - latestY) }
                    return 0
                }
            } else {
                quietStartedAt = t
            }
        } else {
            quietStartedAt = nil
        }
        return rawVelocity
    }
}
