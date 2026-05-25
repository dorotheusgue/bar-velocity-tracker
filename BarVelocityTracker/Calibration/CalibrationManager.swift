import Combine
import CoreGraphics
import Foundation

enum CalibrationAxis { case x, y, isotropic }

/// Persists the pixels-per-meter scale derived by tapping two points of known
/// real-world distance (e.g. the collar edges of a 2.2 m Olympic bar). The
/// scale is keyed by `(camera position × capture resolution)` so swapping
/// cameras or presets does not silently apply the wrong scale.
final class CalibrationManager: ObservableObject {
    struct Key: Hashable {
        let camera: String     // "front" | "rear"
        let resolution: String // "1920x1080"
    }

    @Published private(set) var metersPerPixel: Double?
    @Published var knownDistanceMeters: Double = 2.2  // standard men's Olympic bar collar-to-collar

    private let storage: UserDefaults
    private let storageKey = "calibration.metersPerPixel.v1"

    init(storage: UserDefaults = .standard) {
        self.storage = storage
    }

    func load(for key: Key) {
        let dict = storage.dictionary(forKey: storageKey) as? [String: Double] ?? [:]
        metersPerPixel = dict[key.identifier]
    }

    func calibrate(pixelDistance: Double, for key: Key) {
        guard pixelDistance > 0 else { return }
        let mpp = knownDistanceMeters / pixelDistance
        metersPerPixel = mpp
        var dict = storage.dictionary(forKey: storageKey) as? [String: Double] ?? [:]
        dict[key.identifier] = mpp
        storage.set(dict, forKey: storageKey)
    }

    func clear(for key: Key) {
        var dict = storage.dictionary(forKey: storageKey) as? [String: Double] ?? [:]
        dict.removeValue(forKey: key.identifier)
        storage.set(dict, forKey: storageKey)
        metersPerPixel = nil
    }

    func convert(pixels: Double, axis: CalibrationAxis = .y) -> Double {
        // Phase 1: same scale on both axes (uniform camera, no lens distortion model).
        guard let mpp = metersPerPixel else { return 0 }
        _ = axis
        return pixels * mpp
    }

    /// Convenience for the two-point UI flow.
    func calibrate(from a: CGPoint, to b: CGPoint, for key: Key) {
        let dx = Double(a.x - b.x)
        let dy = Double(a.y - b.y)
        let distance = (dx * dx + dy * dy).squareRoot()
        calibrate(pixelDistance: distance, for: key)
    }
}

extension CalibrationManager.Key {
    var identifier: String { "\(camera)|\(resolution)" }
}
