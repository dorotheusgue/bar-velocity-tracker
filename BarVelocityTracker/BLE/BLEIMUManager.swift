import Combine
import Foundation

/// Phase 2 placeholder. Conforms to `BarMotionSource` so `RepDetector` and
/// `MetricsEngine` can be wired against it without any downstream changes when
/// the BLE/IMU work lands.
///
/// TODO (Phase 2):
///   * Scan for an IMU peripheral advertising a custom GATT service.
///   * Subscribe to the IMU notification characteristic.
///   * Pass the raw 9-DOF samples through a Madgwick orientation filter.
///   * Rotate the linear-acceleration vector into the world frame.
///   * Integrate vertical acceleration with ZUPT to recover position/velocity.
final class BLEIMUManager: BarMotionSource {
    private let velocitySubject = CurrentValueSubject<Double, Never>(0)
    private let positionSubject = CurrentValueSubject<Double, Never>(0)

    var velocityPublisher: AnyPublisher<Double, Never> { velocitySubject.eraseToAnyPublisher() }
    var positionPublisher: AnyPublisher<Double, Never> { positionSubject.eraseToAnyPublisher() }

    func startScanning() { /* TODO Phase 2 */ }
    func stop() { /* TODO Phase 2 */ }
}
