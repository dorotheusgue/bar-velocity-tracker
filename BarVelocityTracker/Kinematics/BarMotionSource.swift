import Combine

/// Abstract source of bar motion. Phase 1 implements this with the camera
/// pipeline (`KinematicsEngine`). Phase 2 will provide a `BLEIMUManager`
/// conformer so the rep-detection stack is hardware-agnostic.
protocol BarMotionSource: AnyObject {
    /// Vertical velocity in m/s. Positive = upward.
    var velocityPublisher: AnyPublisher<Double, Never> { get }
    /// Vertical position in meters relative to an arbitrary origin.
    var positionPublisher: AnyPublisher<Double, Never> { get }
}
