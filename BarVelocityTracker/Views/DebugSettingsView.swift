import SwiftUI

struct DebugSettingsView: View {
    @ObservedObject var vm: LiveTrainingViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Target") {
                    TextField("Exercise", text: $vm.exerciseName)
                    HStack {
                        Text("Load")
                        Spacer()
                        TextField("kg", value: $vm.loadKg, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                        Text("kg").foregroundStyle(.secondary)
                    }
                    slider(title: "Target velocity",
                           value: $vm.targetVelocity,
                           range: 0.1...1.5, step: 0.05,
                           format: "%.2f m/s")
                }

                Section("Kalman filter") {
                    slider(title: "Process noise (q)",
                           value: $vm.processNoise,
                           range: 0.01...1.0, step: 0.01,
                           format: "%.2f")
                    slider(title: "Measurement noise (r)",
                           value: $vm.measurementNoise,
                           range: 0.5...20.0, step: 0.5,
                           format: "%.1f")
                    presetRow
                }

                Section("ZUPT") {
                    slider(title: "Velocity threshold",
                           value: $vm.zuptVelocityThreshold,
                           range: 0.005...0.10, step: 0.005,
                           format: "%.3f m/s")
                    slider(title: "Quiet duration",
                           value: $vm.zuptDuration,
                           range: 0.05...0.5, step: 0.025,
                           format: "%.2f s")
                }

                Section("Live") {
                    LabeledContent("Velocity", value: String(format: "%.3f m/s", vm.velocity))
                    LabeledContent("Detection conf.", value: String(format: "%.0f%%", vm.detectionConfidence * 100))
                    LabeledContent("Tracking", value: vm.isTracking ? "yes" : "no")
                    LabeledContent("Phase", value: vm.phase.rawValue)
                }
            }
            .navigationTitle("Debug")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { vm.applyTuning(); dismiss() }
                }
            }
            .onChange(of: vm.processNoise) { _, _ in vm.applyTuning() }
            .onChange(of: vm.measurementNoise) { _, _ in vm.applyTuning() }
            .onChange(of: vm.zuptVelocityThreshold) { _, _ in vm.applyTuning() }
            .onChange(of: vm.zuptDuration) { _, _ in vm.applyTuning() }
        }
    }

    private var presetRow: some View {
        HStack {
            Button("Powerlifting") {
                vm.processNoise = 0.05; vm.measurementNoise = 8.0; vm.applyTuning()
            }
            .buttonStyle(.bordered)
            Spacer()
            Button("Olympic") {
                vm.processNoise = 0.5; vm.measurementNoise = 3.0; vm.applyTuning()
            }
            .buttonStyle(.bordered)
            Spacer()
            Button("Default") {
                vm.processNoise = 0.1; vm.measurementNoise = 5.0; vm.applyTuning()
            }
            .buttonStyle(.bordered)
        }
    }

    private func slider(title: String,
                        value: Binding<Double>,
                        range: ClosedRange<Double>,
                        step: Double,
                        format: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer()
                Text(String(format: format, value.wrappedValue))
                    .foregroundStyle(.secondary).monospacedDigit()
            }
            Slider(value: value, in: range, step: step)
        }
    }
}
