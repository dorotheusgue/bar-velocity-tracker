import Charts
import SwiftData
import SwiftUI

struct HistoryView: View {
    @Query(sort: \SessionEntity.date, order: .reverse) private var sessions: [SessionEntity]

    var body: some View {
        NavigationStack {
            if sessions.isEmpty {
                ContentUnavailableView("No sessions yet",
                                       systemImage: "chart.line.uptrend.xyaxis",
                                       description: Text("Finish a set to start a session."))
                    .navigationTitle("History")
            } else {
                List {
                    ForEach(sessions) { session in
                        NavigationLink {
                            SessionDetailView(session: session)
                        } label: {
                            sessionRow(session)
                        }
                    }
                }
                .navigationTitle("History")
            }
        }
    }

    private func sessionRow(_ session: SessionEntity) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(session.date, format: .dateTime.month().day().year())
                    .font(.headline)
                Spacer()
                Text("\(session.sets.count) sets")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let trend = trendValues(for: session), trend.count > 1 {
                Chart(Array(trend.enumerated()), id: \.offset) { idx, value in
                    LineMark(x: .value("Set", idx + 1), y: .value("MCV", value))
                    PointMark(x: .value("Set", idx + 1), y: .value("MCV", value))
                }
                .chartYAxis(.hidden)
                .chartXAxis(.hidden)
                .frame(height: 40)
            }
        }
        .padding(.vertical, 4)
    }

    private func trendValues(for session: SessionEntity) -> [Double]? {
        let values = session.sets
            .sorted(by: { $0.startedAt < $1.startedAt })
            .map(\.averageMCV)
        return values.isEmpty ? nil : values
    }
}

struct SessionDetailView: View {
    let session: SessionEntity

    var body: some View {
        List {
            ForEach(session.sets.sorted(by: { $0.startedAt < $1.startedAt })) { set in
                Section(set.exerciseName.isEmpty ? "Set" : set.exerciseName) {
                    HStack {
                        Text("Load")
                        Spacer()
                        Text("\(Int(set.loadKg)) kg")
                    }
                    HStack {
                        Text("Avg MCV")
                        Spacer()
                        Text(String(format: "%.2f m/s", set.averageMCV)).monospacedDigit()
                    }
                    HStack {
                        Text("V-Loss")
                        Spacer()
                        Text(String(format: "%.1f%%", set.velocityLossPercent)).monospacedDigit()
                    }
                    Chart(set.reps.sorted(by: { $0.index < $1.index })) { rep in
                        BarMark(
                            x: .value("Rep", rep.index),
                            y: .value("m/s", rep.meanConcentricVelocity)
                        )
                    }
                    .frame(height: 120)
                }
            }
        }
        .navigationTitle(session.date.formatted(date: .abbreviated, time: .shortened))
    }
}
