import Foundation

/// One completed concentric rep.
struct Rep: Identifiable, Equatable {
    let id: UUID
    let index: Int
    let meanConcentricVelocity: Double   // m/s
    let peakConcentricVelocity: Double   // m/s
    let rangeOfMotion: Double            // meters
    let concentricDuration: TimeInterval
    let timestamp: Date

    init(id: UUID = UUID(),
         index: Int,
         meanConcentricVelocity: Double,
         peakConcentricVelocity: Double,
         rangeOfMotion: Double,
         concentricDuration: TimeInterval,
         timestamp: Date = Date()) {
        self.id = id
        self.index = index
        self.meanConcentricVelocity = meanConcentricVelocity
        self.peakConcentricVelocity = peakConcentricVelocity
        self.rangeOfMotion = rangeOfMotion
        self.concentricDuration = concentricDuration
        self.timestamp = timestamp
    }
}
