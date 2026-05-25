import Foundation

/// Snapshot of a completed set.
struct SetSummary: Identifiable, Equatable {
    let id: UUID
    let reps: [Rep]
    let velocityLossPercent: Double      // (first.mean - last.mean) / first.mean * 100
    let averageMCV: Double               // mean concentric velocity across reps
    let averagePeak: Double
    let bestRep: Rep?
    let startedAt: Date
    let endedAt: Date

    var repCount: Int { reps.count }

    init(id: UUID = UUID(),
         reps: [Rep],
         velocityLossPercent: Double,
         averageMCV: Double,
         averagePeak: Double,
         bestRep: Rep?,
         startedAt: Date,
         endedAt: Date = Date()) {
        self.id = id
        self.reps = reps
        self.velocityLossPercent = velocityLossPercent
        self.averageMCV = averageMCV
        self.averagePeak = averagePeak
        self.bestRep = bestRep
        self.startedAt = startedAt
        self.endedAt = endedAt
    }
}
