import Foundation
import SwiftData

@Model
final class AthleteEntity {
    @Attribute(.unique) var id: UUID
    var name: String
    var createdAt: Date
    @Relationship(deleteRule: .cascade, inverse: \SessionEntity.athlete)
    var sessions: [SessionEntity] = []

    init(id: UUID = UUID(), name: String, createdAt: Date = Date()) {
        self.id = id
        self.name = name
        self.createdAt = createdAt
    }
}

@Model
final class SessionEntity {
    @Attribute(.unique) var id: UUID
    var date: Date
    var notes: String?
    var athlete: AthleteEntity?
    @Relationship(deleteRule: .cascade, inverse: \SetEntity.session)
    var sets: [SetEntity] = []

    init(id: UUID = UUID(), date: Date = Date(), notes: String? = nil) {
        self.id = id
        self.date = date
        self.notes = notes
    }
}

@Model
final class SetEntity {
    @Attribute(.unique) var id: UUID
    var exerciseName: String
    var loadKg: Double
    var targetVelocity: Double
    var velocityLossPercent: Double
    var averageMCV: Double
    var averagePeak: Double
    var startedAt: Date
    var endedAt: Date
    var session: SessionEntity?
    @Relationship(deleteRule: .cascade, inverse: \RepEntity.set)
    var reps: [RepEntity] = []

    init(id: UUID = UUID(),
         exerciseName: String = "",
         loadKg: Double = 0,
         targetVelocity: Double = 0.6,
         velocityLossPercent: Double = 0,
         averageMCV: Double = 0,
         averagePeak: Double = 0,
         startedAt: Date = Date(),
         endedAt: Date = Date()) {
        self.id = id
        self.exerciseName = exerciseName
        self.loadKg = loadKg
        self.targetVelocity = targetVelocity
        self.velocityLossPercent = velocityLossPercent
        self.averageMCV = averageMCV
        self.averagePeak = averagePeak
        self.startedAt = startedAt
        self.endedAt = endedAt
    }
}

@Model
final class RepEntity {
    @Attribute(.unique) var id: UUID
    var index: Int
    var meanConcentricVelocity: Double
    var peakConcentricVelocity: Double
    var rangeOfMotion: Double
    var concentricDuration: TimeInterval
    var timestamp: Date
    var set: SetEntity?

    init(id: UUID = UUID(),
         index: Int,
         meanConcentricVelocity: Double,
         peakConcentricVelocity: Double,
         rangeOfMotion: Double,
         concentricDuration: TimeInterval,
         timestamp: Date) {
        self.id = id
        self.index = index
        self.meanConcentricVelocity = meanConcentricVelocity
        self.peakConcentricVelocity = peakConcentricVelocity
        self.rangeOfMotion = rangeOfMotion
        self.concentricDuration = concentricDuration
        self.timestamp = timestamp
    }
}

extension RepEntity {
    convenience init(rep: Rep) {
        self.init(id: rep.id,
                  index: rep.index,
                  meanConcentricVelocity: rep.meanConcentricVelocity,
                  peakConcentricVelocity: rep.peakConcentricVelocity,
                  rangeOfMotion: rep.rangeOfMotion,
                  concentricDuration: rep.concentricDuration,
                  timestamp: rep.timestamp)
    }
}

extension SetEntity {
    static func fromSummary(_ summary: SetSummary,
                            exerciseName: String,
                            loadKg: Double,
                            targetVelocity: Double) -> SetEntity {
        let set = SetEntity(exerciseName: exerciseName,
                            loadKg: loadKg,
                            targetVelocity: targetVelocity,
                            velocityLossPercent: summary.velocityLossPercent,
                            averageMCV: summary.averageMCV,
                            averagePeak: summary.averagePeak,
                            startedAt: summary.startedAt,
                            endedAt: summary.endedAt)
        set.reps = summary.reps.map(RepEntity.init(rep:))
        return set
    }
}
