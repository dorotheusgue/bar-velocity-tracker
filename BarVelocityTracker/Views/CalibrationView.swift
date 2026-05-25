import SwiftUI

/// Two-tap calibration sheet. The user taps the two collar edges of a bar of
/// known length; we compute meters-per-pixel from the on-screen distance.
struct CalibrationView: View {
    @ObservedObject var calibration: CalibrationManager
    let key: CalibrationManager.Key
    @Environment(\.dismiss) private var dismiss

    @State private var firstPoint: CGPoint?
    @State private var secondPoint: CGPoint?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Tap the two collars of your bar. Default reference length is 2.2 m (men's Olympic bar).")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                HStack {
                    Text("Known distance")
                    Spacer()
                    TextField("meters",
                              value: $calibration.knownDistanceMeters,
                              format: .number)
                        .keyboardType(.decimalPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80)
                    Text("m").foregroundStyle(.secondary)
                }
                .padding()
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal)

                GeometryReader { geo in
                    ZStack {
                        Color.black.opacity(0.85)

                        if let mpp = calibration.metersPerPixel {
                            Text(String(format: "Current scale: %.4f m/px", mpp))
                                .font(.caption).foregroundStyle(.white.opacity(0.8))
                                .position(x: geo.size.width / 2, y: 24)
                        }

                        if let p = firstPoint { marker(at: p, label: "A") }
                        if let p = secondPoint { marker(at: p, label: "B") }
                        if let a = firstPoint, let b = secondPoint {
                            Path { path in path.move(to: a); path.addLine(to: b) }
                                .stroke(Color.green, style: StrokeStyle(lineWidth: 2, dash: [4]))
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { point in
                        registerTap(at: point)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal)

                HStack {
                    Button("Reset") {
                        firstPoint = nil; secondPoint = nil
                    }
                    Spacer()
                    Button("Save") {
                        if let a = firstPoint, let b = secondPoint {
                            calibration.calibrate(from: a, to: b, for: key)
                            dismiss()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(firstPoint == nil || secondPoint == nil)
                }
                .padding()
            }
            .navigationTitle("Calibrate")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private func registerTap(at point: CGPoint) {
        if firstPoint == nil {
            firstPoint = point
        } else if secondPoint == nil {
            secondPoint = point
        } else {
            firstPoint = point
            secondPoint = nil
        }
    }

    private func marker(at point: CGPoint, label: String) -> some View {
        ZStack {
            Circle().fill(Color.green).frame(width: 14, height: 14)
            Text(label).font(.caption2.bold()).foregroundStyle(.black)
        }
        .position(point)
    }
}
