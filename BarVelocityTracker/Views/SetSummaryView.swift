import Charts
import SwiftUI

struct SetSummaryView: View {
    let summary: SetSummary
    let onSave: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    headerStats
                    chart
                    repList
                }
                .padding()
            }
            .navigationTitle("Set Summary")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save Set") { onSave(); dismiss() }
                }
            }
        }
    }

    private var headerStats: some View {
        HStack(spacing: 12) {
            statCard(title: "Reps", value: "\(summary.repCount)")
            statCard(title: "Avg MCV", value: String(format: "%.2f", summary.averageMCV), unit: "m/s")
            statCard(title: "Peak", value: String(format: "%.2f", summary.averagePeak), unit: "m/s")
            statCard(title: "V-Loss", value: String(format: "%.1f%%", summary.velocityLossPercent))
        }
    }

    private func statCard(title: String, value: String, unit: String? = nil) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value).font(.title3).monospacedDigit().fontWeight(.semibold)
                if let unit { Text(unit).font(.caption2).foregroundStyle(.secondary) }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private var chart: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Mean Concentric Velocity").font(.headline)
            Chart(summary.reps) { rep in
                BarMark(
                    x: .value("Rep", rep.index),
                    y: .value("m/s", rep.meanConcentricVelocity)
                )
                .foregroundStyle(rep.id == summary.bestRep?.id ? Color.green : Color.accentColor)
                .annotation(position: .top) {
                    Text(String(format: "%.2f", rep.meanConcentricVelocity))
                        .font(.caption2).monospacedDigit()
                }
            }
            .chartYScale(domain: 0...(maxVelocity * 1.2))
            .frame(height: 200)
        }
    }

    private var repList: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Reps").font(.headline)
            ForEach(summary.reps) { rep in
                HStack {
                    Text("#\(rep.index)").frame(width: 32, alignment: .leading)
                    Text(String(format: "%.2f m/s", rep.meanConcentricVelocity))
                        .monospacedDigit()
                    Spacer()
                    Text(String(format: "peak %.2f", rep.peakConcentricVelocity))
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                    Text(String(format: "%.2fm", rep.rangeOfMotion))
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
                .padding(.vertical, 6).padding(.horizontal, 10)
                .background(rep.id == summary.bestRep?.id
                            ? Color.green.opacity(0.15)
                            : Color.clear,
                            in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private var maxVelocity: Double {
        max(0.5, summary.reps.map(\.peakConcentricVelocity).max() ?? 0.5)
    }
}
