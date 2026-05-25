import SwiftUI

struct RepFeedCard: View {
    let rep: Rep
    let targetVelocity: Double

    var body: some View {
        HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Rep \(rep.index)")
                    .font(.caption).foregroundStyle(.secondary)
                Text(String(format: "%.2f m/s", rep.meanConcentricVelocity))
                    .font(.title2).monospacedDigit().fontWeight(.bold)
                    .foregroundStyle(tint)
            }
            Divider().frame(height: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text("Peak").font(.caption).foregroundStyle(.secondary)
                Text(String(format: "%.2f", rep.peakConcentricVelocity)).monospacedDigit()
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("ROM").font(.caption).foregroundStyle(.secondary)
                Text(String(format: "%.2f m", rep.rangeOfMotion)).monospacedDigit()
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Time").font(.caption).foregroundStyle(.secondary)
                Text(String(format: "%.2f s", rep.concentricDuration)).monospacedDigit()
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16).stroke(tint.opacity(0.6), lineWidth: 1.5)
        )
        .foregroundStyle(.white)
    }

    private var tint: Color {
        if rep.meanConcentricVelocity >= targetVelocity { return .green }
        if rep.meanConcentricVelocity >= targetVelocity * 0.9 { return .yellow }
        return .red
    }
}
