import Combine
import Foundation

/// State machine that segments the velocity stream into reps.
///
///   idle → eccentric → transition → concentric → topOfRep → eccentric → ...
///
/// A rep is emitted on the `topOfRep` transition. The detector is fed by any
/// `BarMotionSource`, so the same logic works for video-based motion (Phase 1)
/// and BLE/IMU motion (Phase 2).
final class RepDetector: ObservableObject {
    enum Phase: String { case idle, eccentric, transition, concentric, topOfRep }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var repCount: Int = 0

    /// Emits a `Rep` each time a concentric phase completes.
    let reps = PassthroughSubject<Rep, Never>()

    // Tunable thresholds (see spec)
    var concentricStartThreshold: Double = 0.05    // m/s, upward
    var repEndThreshold: Double = 0.02             // m/s
    var eccentricStartThreshold: Double = -0.05    // m/s, downward
    var minRepGap: TimeInterval = 0.5              // debounce window

    private weak var source: BarMotionSource?
    private var velocityCancellable: AnyCancellable?
    private var positionCancellable: AnyCancellable?

    private var currentPosition: Double = 0
    private var lastVelocity: Double = 0
    private var lastVelocityTime: Date = Date()
    private var lastTimestamp: Date = .distantPast

    // Accumulators for the active concentric phase
    private var concentricStartTime: Date?
    private var concentricStartPosition: Double = 0
    private var concentricVelocities: [Double] = []
    private var concentricPeak: Double = 0
    private var concentricMaxPosition: Double = -.infinity

    init(source: BarMotionSource) {
        self.source = source
        positionCancellable = source.positionPublisher
            .sink { [weak self] in self?.currentPosition = $0 }
        velocityCancellable = source.velocityPublisher
            .sink { [weak self] in self?.ingest(velocity: $0) }
    }

    func reset() {
        phase = .idle
        repCount = 0
        concentricStartTime = nil
        concentricVelocities.removeAll()
        concentricPeak = 0
        concentricMaxPosition = -.infinity
        lastTimestamp = .distantPast
    }

    /// Allow callers to swap detection source after construction (e.g. video → BLE).
    func bind(to source: BarMotionSource) {
        velocityCancellable?.cancel()
        positionCancellable?.cancel()
        self.source = source
        positionCancellable = source.positionPublisher
            .sink { [weak self] in self?.currentPosition = $0 }
        velocityCancellable = source.velocityPublisher
            .sink { [weak self] in self?.ingest(velocity: $0) }
    }

    // MARK: - State machine

    private func ingest(velocity v: Double) {
        let now = Date()
        defer { lastVelocity = v; lastVelocityTime = now }

        switch phase {
        case .idle, .topOfRep:
            if v <= eccentricStartThreshold {
                phase = .eccentric
            } else if v >= concentricStartThreshold {
                // Lifter started concentric from a dead stop (e.g. deadlift).
                beginConcentric(at: now)
            }

        case .eccentric:
            if abs(v) < repEndThreshold {
                phase = .transition
            } else if v >= concentricStartThreshold {
                // Recovery from eccentric straight into concentric (no pause).
                beginConcentric(at: now)
            }

        case .transition:
            if v >= concentricStartThreshold {
                beginConcentric(at: now)
            } else if v <= eccentricStartThreshold {
                phase = .eccentric
            }

        case .concentric:
            concentricVelocities.append(v)
            concentricPeak = max(concentricPeak, v)
            concentricMaxPosition = max(concentricMaxPosition, currentPosition)
            if v < repEndThreshold && concentricPeak > concentricStartThreshold {
                completeRep(at: now)
            }
        }
    }

    private func beginConcentric(at now: Date) {
        // Debounce: ignore if the previous rep finished too recently.
        if now.timeIntervalSince(lastTimestamp) < minRepGap { return }
        phase = .concentric
        concentricStartTime = now
        concentricStartPosition = currentPosition
        concentricVelocities = []
        concentricPeak = 0
        concentricMaxPosition = currentPosition
    }

    private func completeRep(at now: Date) {
        guard let start = concentricStartTime else {
            phase = .topOfRep
            return
        }
        let duration = now.timeIntervalSince(start)
        let mean = concentricVelocities.isEmpty
            ? 0
            : concentricVelocities.reduce(0, +) / Double(concentricVelocities.count)
        let rom = max(0, concentricMaxPosition - concentricStartPosition)

        repCount += 1
        let rep = Rep(index: repCount,
                      meanConcentricVelocity: mean,
                      peakConcentricVelocity: concentricPeak,
                      rangeOfMotion: rom,
                      concentricDuration: duration,
                      timestamp: now)
        reps.send(rep)

        lastTimestamp = now
        concentricStartTime = nil
        phase = .topOfRep
    }
}
