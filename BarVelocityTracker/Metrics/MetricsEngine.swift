import Combine
import Foundation

/// Accumulates reps for the current set and produces both live derived metrics
/// and a final `SetSummary` when the user ends the set.
final class MetricsEngine: ObservableObject {
    @Published private(set) var reps: [Rep] = []
    @Published private(set) var velocityLossPercent: Double = 0
    @Published private(set) var averageMCV: Double = 0
    @Published private(set) var averagePeak: Double = 0
    @Published private(set) var bestRep: Rep?

    /// Set summaries emitted when `endSet()` is called.
    let setSummaries = PassthroughSubject<SetSummary, Never>()

    private var setStartedAt: Date = Date()

    func append(_ rep: Rep) {
        if reps.isEmpty { setStartedAt = rep.timestamp }
        reps.append(rep)
        recompute()
    }

    /// Finalises the current set, emits a `SetSummary`, and clears live state.
    @discardableResult
    func endSet() -> SetSummary? {
        guard !reps.isEmpty else { return nil }
        let summary = SetSummary(reps: reps,
                                 velocityLossPercent: velocityLossPercent,
                                 averageMCV: averageMCV,
                                 averagePeak: averagePeak,
                                 bestRep: bestRep,
                                 startedAt: setStartedAt)
        setSummaries.send(summary)
        clear()
        return summary
    }

    func clear() {
        reps.removeAll()
        velocityLossPercent = 0
        averageMCV = 0
        averagePeak = 0
        bestRep = nil
    }

    private func recompute() {
        guard let first = reps.first, let last = reps.last else { return }
        if first.meanConcentricVelocity > 0 {
            velocityLossPercent =
                (first.meanConcentricVelocity - last.meanConcentricVelocity)
                / first.meanConcentricVelocity * 100
        } else {
            velocityLossPercent = 0
        }
        averageMCV = reps.map(\.meanConcentricVelocity).reduce(0, +) / Double(reps.count)
        averagePeak = reps.map(\.peakConcentricVelocity).reduce(0, +) / Double(reps.count)
        bestRep = reps.max(by: { $0.meanConcentricVelocity < $1.meanConcentricVelocity })
    }
}
