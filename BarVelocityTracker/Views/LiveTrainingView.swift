import SwiftData
import SwiftUI

struct LiveTrainingView: View {
    @StateObject private var vm = LiveTrainingViewModel()
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if vm.isCameraAuthorized {
                CameraPreviewView(session: vm.camera.captureSession)
                    .ignoresSafeArea()

                BoundingBoxOverlay(box: vm.boundingBox,
                                   confidence: vm.detectionConfidence,
                                   isTracking: vm.isTracking)
                    .ignoresSafeArea()

                hud
            } else {
                permissionPrompt
            }
        }
        .onAppear { vm.onAppear() }
        .onDisappear { vm.onDisappear() }
        .sheet(isPresented: $vm.showCalibration) {
            CalibrationView(calibration: vm.calibration,
                            key: vm.currentCalibrationKey())
        }
        .sheet(isPresented: $vm.showDebug) {
            DebugSettingsView(vm: vm)
        }
        .sheet(isPresented: $vm.showSummary) {
            if let summary = vm.latestSetSummary {
                SetSummaryView(summary: summary) { saveSet(summary) }
            }
        }
        .overlay(alignment: .bottom) {
            if vm.showRepCard, let rep = vm.lastRep {
                RepFeedCard(rep: rep, targetVelocity: vm.targetVelocity)
                    .padding(.horizontal)
                    .padding(.bottom, 120)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
                            withAnimation { vm.showRepCard = false }
                        }
                    }
            }
        }
        .animation(.spring, value: vm.showRepCard)
    }

    // MARK: - HUD

    private var hud: some View {
        VStack {
            topBar
            Spacer()
            velocityReadout
            Spacer()
            bottomBar
        }
        .padding()
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            Button { vm.showCalibration = true } label: {
                Label("Calibrate", systemImage: "ruler")
                    .labelStyle(.iconOnly)
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
            }
            Button { vm.toggleCamera() } label: {
                Label("Flip", systemImage: "arrow.triangle.2.circlepath.camera")
                    .labelStyle(.iconOnly)
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text(vm.exerciseName).font(.headline)
                Text("\(Int(vm.loadKg)) kg · target \(String(format: "%.2f", vm.targetVelocity)) m/s")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())

            Button { vm.showDebug = true } label: {
                Label("Debug", systemImage: "slider.horizontal.3")
                    .labelStyle(.iconOnly)
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
            }
        }
        .foregroundStyle(.white)
    }

    private var velocityReadout: some View {
        VStack(spacing: 4) {
            if let notice = vm.cameraNotice {
                Text(notice)
                    .font(.caption)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.orange.opacity(0.85), in: Capsule())
                    .foregroundStyle(.black)
            }
            Text(String(format: "%.2f", vm.velocity))
                .font(.system(size: 96, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(vm.velocityTint)
                .shadow(radius: 8)
            Text("m/s · concentric")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.8))
            HStack(spacing: 16) {
                Label("\(vm.repCount)", systemImage: "number.circle")
                Label(vm.phase.rawValue, systemImage: "waveform")
            }
            .font(.caption)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(.ultraThinMaterial, in: Capsule())
        }
    }

    private var bottomBar: some View {
        HStack {
            Spacer()
            Button(role: .destructive) {
                vm.endSet()
            } label: {
                Label("End Set", systemImage: "stop.circle.fill")
                    .font(.headline)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(.red.opacity(0.85), in: Capsule())
                    .foregroundStyle(.white)
            }
            .disabled(vm.setRepCount == 0)
            Spacer()
        }
    }

    private var permissionPrompt: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill").font(.largeTitle)
            Text("Camera access is required to track bar velocity.")
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .foregroundStyle(.white)
    }

    private func saveSet(_ summary: SetSummary) {
        let entity = SetEntity.fromSummary(summary,
                                           exerciseName: vm.exerciseName,
                                           loadKg: vm.loadKg,
                                           targetVelocity: vm.targetVelocity)
        // Attach to today's session, creating it if needed.
        let today = Calendar.current.startOfDay(for: Date())
        let descriptor = FetchDescriptor<SessionEntity>(
            predicate: #Predicate { $0.date >= today },
            sortBy: [SortDescriptor(\.date, order: .reverse)]
        )
        let fetched = (try? modelContext.fetch(descriptor)) ?? []
        let session = fetched.first ?? SessionEntity(date: Date())
        if session.modelContext == nil { modelContext.insert(session) }
        entity.session = session
        session.sets.append(entity)
        modelContext.insert(entity)
        try? modelContext.save()
    }
}
