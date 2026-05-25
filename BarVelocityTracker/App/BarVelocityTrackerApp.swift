import SwiftUI
import SwiftData

@main
struct BarVelocityTrackerApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(.dark)
        }
        .modelContainer(for: [
            AthleteEntity.self,
            SessionEntity.self,
            SetEntity.self,
            RepEntity.self
        ])
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            LiveTrainingView()
                .tabItem { Label("Train", systemImage: "figure.strengthtraining.traditional") }

            HistoryView()
                .tabItem { Label("History", systemImage: "chart.line.uptrend.xyaxis") }
        }
    }
}
