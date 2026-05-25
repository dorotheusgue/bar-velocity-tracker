import AVFoundation
import Combine
import Foundation
import SwiftUI

@MainActor
final class LiveTrainingViewModel: ObservableObject {
    // Published state for the SwiftUI live view.
    @Published var velocity: Double = 0
    @Published var lastRep: Rep?
    @Published var latestSetSummary: SetSummary?
    @Published var isCameraAuthorized: Bool = false
    @Published var isTracking: Bool = false
    @Published var boundingBox: CGRect?         // normalised, Vision origin
    @Published var detectionConfidence: Float = 0
    @Published var showCalibration: Bool = false
    @Published var showDebug: Bool = false
    @Published var showRepCard: Bool = false
    @Published var showSummary: Bool = false
    @Published var cameraNotice: String?
    @Published var repCount: Int = 0
    @Published var phase: RepDetector.Phase = .idle
    @Published var setRepCount: Int = 0

    // Tunables exposed to the UI.
    @AppStorage("ui.targetVelocity") var targetVelocity: Double = 0.60
    @AppStorage("ui.exerciseName") var exerciseName: String = "Back Squat"
    @AppStorage("ui.loadKg") var loadKg: Double = 0
    @AppStorage("kalman.processNoise") var processNoise: Double = 0.1
    @AppStorage("kalman.measurementNoise") var measurementNoise: Double = 5.0
    @AppStorage("zupt.velocityThreshold") var zuptVelocityThreshold: Double = 0.02
    @AppStorage("zupt.duration") var zuptDuration: Double = 0.150

    // Dependencies.
    let camera = CameraManager()
    let detector = BarDetector()
    let tracker = BarTracker()
    let calibration = CalibrationManager()
    let kinematics: KinematicsEngine
    let repDetector: RepDetector
    let metrics = MetricsEngine()

    private var cancellables = Set<AnyCancellable>()
    private var noVisibleFrames: Int = 0
    private let noBarFramesForWarning = 90    // ~3s at 30fps

    init() {
        self.kinematics = KinematicsEngine(calibration: calibration)
        self.repDetector = RepDetector(source: kinematics)
        wireUp()
    }

    func onAppear() {
        Task { @MainActor in
            isCameraAuthorized = await camera.requestAuthorization()
            if isCameraAuthorized {
                applyTuning()
                let key = currentCalibrationKey()
                calibration.load(for: key)
                camera.start()
            }
        }
    }

    func onDisappear() {
        camera.stop()
    }

    // MARK: - User actions

    func toggleCamera() {
        camera.toggleCamera()
    }

    func endSet() {
        if let summary = metrics.endSet() {
            latestSetSummary = summary
            showSummary = true
            repDetector.reset()
            kinematics.reset()
            tracker.reset()
            setRepCount = 0
        }
    }

    func applyTuning() {
        tracker.processNoise = processNoise
        tracker.measurementNoise = measurementNoise
        kinematics.zuptVelocityThreshold = zuptVelocityThreshold
        kinematics.zuptDuration = zuptDuration
    }

    func currentCalibrationKey() -> CalibrationManager.Key {
        let cam = camera.currentPosition == .rear ? "rear" : "front"
        return CalibrationManager.Key(camera: cam, resolution: "1920x1080")
    }

    // MARK: - Wiring

    private func wireUp() {
        camera.frames
            .receive(on: DispatchQueue.global(qos: .userInitiated))
            .sink { [weak self] sample in
                self?.detector.detect(in: sample) { detection in
                    DispatchQueue.main.async {
                        self?.handle(detection)
                    }
                }
            }
            .store(in: &cancellables)

        tracker.$smoothedPosition
            .compactMap { $0 }
            .sink { [weak self] position in
                self?.kinematics.ingest(position)
            }
            .store(in: &cancellables)

        tracker.$isTracking
            .receive(on: DispatchQueue.main)
            .assign(to: &$isTracking)

        kinematics.$currentVelocity
            .receive(on: DispatchQueue.main)
            .assign(to: &$velocity)

        repDetector.reps
            .receive(on: DispatchQueue.main)
            .sink { [weak self] rep in
                guard let self else { return }
                self.metrics.append(rep)
                self.lastRep = rep
                self.showRepCard = true
                self.setRepCount = self.metrics.reps.count
            }
            .store(in: &cancellables)

        repDetector.$repCount
            .receive(on: DispatchQueue.main)
            .assign(to: &$repCount)
        repDetector.$phase
            .receive(on: DispatchQueue.main)
            .assign(to: &$phase)

        metrics.setSummaries
            .receive(on: DispatchQueue.main)
            .sink { [weak self] summary in self?.latestSetSummary = summary }
            .store(in: &cancellables)
    }

    private func handle(_ detection: BarDetection?) {
        tracker.frameWidth = 1080
        tracker.frameHeight = 1920
        tracker.ingest(detection)
        if let detection {
            boundingBox = detection.boundingBox
            detectionConfidence = detection.confidence
            noVisibleFrames = 0
            cameraNotice = nil
        } else {
            noVisibleFrames += 1
            boundingBox = nil
            if noVisibleFrames == noBarFramesForWarning {
                cameraNotice = calibration.metersPerPixel == nil
                    ? "Tap to calibrate before lifting."
                    : "Bar not visible. Re-calibrate if the angle changed."
            }
        }
    }

    // Color used for the big velocity number.
    var velocityTint: Color {
        let target = targetVelocity
        if velocity >= target { return .green }
        if velocity >= target * 0.9 { return .yellow }
        return .red
    }
}
