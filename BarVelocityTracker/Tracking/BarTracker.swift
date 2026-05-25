import Combine
import Foundation

/// Smoothed bar position at a moment in time. `yPixel` is in image-pixel space,
/// origin top-left, growing downwards (we convert from Vision's bottom-left
/// normalised box at the boundary).
struct BarPosition: Equatable {
    let timestamp: Double
    let yPixel: Double
    let xPixel: Double
    let boundingBox: CGRect    // last known box (normalised, Vision origin)
    let confidence: Float
}

/// Maintains a rolling buffer of recent positions and applies a 1D Kalman
/// filter to the vertical channel. Designed to be fed `BarDetection`s from the
/// camera/vision pipeline.
final class BarTracker: ObservableObject {
    @Published private(set) var smoothedPosition: BarPosition?
    @Published private(set) var isTracking: Bool = false

    /// Rolling history — newest at the end. Bounded by `bufferLength`.
    private(set) var history: [BarPosition] = []
    private let bufferLength: Int

    private var kalman: KalmanFilter1D?

    /// Frame height in pixels; used to convert Vision's normalised box to pixels.
    var frameHeight: Double = 1920
    var frameWidth: Double = 1080

    /// Kalman tuning — exposed so the debug panel can drive them.
    var processNoise: Double {
        get { kalman?.q ?? defaultProcessNoise }
        set { defaultProcessNoise = newValue; kalman?.q = newValue }
    }
    var measurementNoise: Double {
        get { kalman?.r ?? defaultMeasurementNoise }
        set { defaultMeasurementNoise = newValue; kalman?.r = newValue }
    }

    private var defaultProcessNoise: Double
    private var defaultMeasurementNoise: Double

    init(bufferLength: Int = 120,
         processNoise: Double = 0.1,
         measurementNoise: Double = 5.0) {
        self.bufferLength = bufferLength
        self.defaultProcessNoise = processNoise
        self.defaultMeasurementNoise = measurementNoise
    }

    /// Fold a new detection into the tracker. Pass `nil` for a frame with no
    /// detection — repeated misses flip `isTracking` to false.
    func ingest(_ detection: BarDetection?) {
        guard let detection else {
            missedDetection()
            return
        }
        missesInARow = 0
        isTracking = true

        // Vision's bounding box origin is bottom-left, normalised 0...1. We
        // convert midY into pixel space with origin top-left (UIKit convention)
        // so positive velocity = upward = decreasing pixel y.
        let yNormFromTop = 1.0 - detection.boundingBox.midY
        let yPixel = Double(yNormFromTop) * frameHeight
        let xPixel = Double(detection.boundingBox.midX) * frameWidth

        if kalman == nil {
            kalman = KalmanFilter1D(initialPosition: yPixel,
                                    processNoise: defaultProcessNoise,
                                    measurementNoise: defaultMeasurementNoise)
        }
        let smoothedY = kalman!.update(measurement: yPixel)

        let position = BarPosition(timestamp: detection.timestamp,
                                   yPixel: smoothedY,
                                   xPixel: xPixel,
                                   boundingBox: detection.boundingBox,
                                   confidence: detection.confidence)
        history.append(position)
        if history.count > bufferLength {
            history.removeFirst(history.count - bufferLength)
        }
        smoothedPosition = position
    }

    func reset() {
        history.removeAll()
        kalman = nil
        smoothedPosition = nil
        isTracking = false
        missesInARow = 0
    }

    private var missesInARow: Int = 0
    private let trackingLossThreshold = 5   // ~80–160 ms at 30–60 fps

    private func missedDetection() {
        missesInARow += 1
        if missesInARow >= trackingLossThreshold {
            isTracking = false
        }
    }
}
