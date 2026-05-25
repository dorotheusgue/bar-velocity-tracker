import AVFoundation
import Combine
import CoreMedia
import UIKit

/// Wraps an `AVCaptureSession` and publishes raw `CMSampleBuffer`s for the
/// vision pipeline to consume. Lives on a private serial queue so the SwiftUI
/// thread is never blocked by hardware setup.
final class CameraManager: NSObject {
    enum CameraPosition { case front, rear }

    /// Stream of frames produced by the active capture session.
    let frames = PassthroughSubject<CMSampleBuffer, Never>()

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "camera.session.queue")
    private let videoQueue = DispatchQueue(label: "camera.video.queue")
    private var videoOutput: AVCaptureVideoDataOutput?
    private(set) var currentPosition: CameraPosition = .rear

    var captureSession: AVCaptureSession { session }

    override init() {
        super.init()
        sessionQueue.async { [weak self] in
            self?.configureSession(position: .rear)
        }
    }

    func start() {
        sessionQueue.async { [weak self] in
            guard let self, !self.session.isRunning else { return }
            self.session.startRunning()
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }

    func toggleCamera() {
        sessionQueue.async { [weak self] in
            guard let self else { return }
            let next: CameraPosition = self.currentPosition == .rear ? .front : .rear
            self.configureSession(position: next)
        }
    }

    func requestAuthorization() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    // MARK: - Setup

    private func configureSession(position: CameraPosition) {
        session.beginConfiguration()
        defer { session.commitConfiguration() }

        if session.canSetSessionPreset(.hd1920x1080) {
            session.sessionPreset = .hd1920x1080
        }

        for input in session.inputs { session.removeInput(input) }
        for output in session.outputs { session.removeOutput(output) }

        let avPosition: AVCaptureDevice.Position = position == .rear ? .back : .front
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: avPosition),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            return
        }
        session.addInput(input)

        try? device.lockForConfiguration()
        configureFrameRate(device: device, target: 60)
        device.unlockForConfiguration()

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: videoQueue)
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        videoOutput = output

        if let connection = output.connection(with: .video) {
            if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
            if position == .front, connection.isVideoMirroringSupported {
                connection.isVideoMirrored = true
            }
        }

        currentPosition = position
    }

    private func configureFrameRate(device: AVCaptureDevice, target: Double) {
        let supported = device.activeFormat.videoSupportedFrameRateRanges
        guard let range = supported.first else { return }
        let fps = min(max(target, range.minFrameRate), range.maxFrameRate)
        let duration = CMTime(value: 1, timescale: CMTimeScale(fps))
        device.activeVideoMinFrameDuration = duration
        device.activeVideoMaxFrameDuration = duration
    }
}

extension CameraManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        frames.send(sampleBuffer)
    }
}

/// Helper extension to extract a Double timestamp (seconds) from a sample buffer.
extension CMSampleBuffer {
    var presentationSeconds: Double {
        CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(self))
    }
}
