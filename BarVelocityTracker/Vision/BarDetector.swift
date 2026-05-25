import CoreMedia
import CoreML
import Foundation
import Vision

/// Result of a detection pass against a single frame.
struct BarDetection: Equatable {
    /// Bounding box in Vision's normalised image coordinates (origin = bottom-left, 0...1).
    let boundingBox: CGRect
    /// Frame presentation timestamp in seconds.
    let timestamp: Double
    /// Detector confidence (0...1).
    let confidence: Float
    /// Source detector used to produce this result.
    let source: Source

    enum Source { case coreML, rectangles }

    /// Vertical centre of the bounding box (the tracked point).
    var midY: CGFloat { boundingBox.midY }
}

/// Detects a barbell in a `CMSampleBuffer`. Tries a CoreML object detector first
/// (when present in the bundle) and falls back to `VNDetectRectanglesRequest`.
final class BarDetector {
    private let coreMLModel: VNCoreMLModel?
    private let minimumConfidence: Float = 0.6
    private let minimumAspectRatio: Float = 8.0

    init() {
        self.coreMLModel = Self.loadCoreMLModel()
    }

    func detect(in sampleBuffer: CMSampleBuffer,
                completion: @escaping (BarDetection?) -> Void) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            completion(nil); return
        }
        let timestamp = sampleBuffer.presentationSeconds

        if let model = coreMLModel {
            detectWithCoreML(pixelBuffer: pixelBuffer,
                             timestamp: timestamp,
                             model: model) { [weak self] detection in
                if let detection {
                    completion(detection)
                } else {
                    // Silently fall back to the geometric detector.
                    self?.detectWithRectangles(pixelBuffer: pixelBuffer,
                                               timestamp: timestamp,
                                               completion: completion)
                }
            }
        } else {
            detectWithRectangles(pixelBuffer: pixelBuffer,
                                 timestamp: timestamp,
                                 completion: completion)
        }
    }

    // MARK: - CoreML path

    private func detectWithCoreML(pixelBuffer: CVPixelBuffer,
                                  timestamp: Double,
                                  model: VNCoreMLModel,
                                  completion: @escaping (BarDetection?) -> Void) {
        let request = VNCoreMLRequest(model: model) { [minimumConfidence] request, _ in
            let results = request.results as? [VNRecognizedObjectObservation]
            let best = results?
                .filter { ($0.labels.first?.identifier.lowercased() == "barbell") &&
                          $0.confidence >= minimumConfidence }
                .max(by: { $0.confidence < $1.confidence })
            if let best {
                completion(BarDetection(boundingBox: best.boundingBox,
                                        timestamp: timestamp,
                                        confidence: best.confidence,
                                        source: .coreML))
            } else {
                completion(nil)
            }
        }
        request.imageCropAndScaleOption = .scaleFill

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([request])
        } catch {
            completion(nil)
        }
    }

    // MARK: - Rectangle path

    private func detectWithRectangles(pixelBuffer: CVPixelBuffer,
                                      timestamp: Double,
                                      completion: @escaping (BarDetection?) -> Void) {
        let request = VNDetectRectanglesRequest { [minimumConfidence, minimumAspectRatio] request, _ in
            let results = request.results as? [VNRectangleObservation] ?? []
            let candidates = results.filter { obs in
                let w = obs.boundingBox.width
                let h = obs.boundingBox.height
                guard h > 0 else { return false }
                let aspect = Float(w / h)
                return aspect >= minimumAspectRatio && obs.confidence >= minimumConfidence
            }
            guard let best = candidates.max(by: { $0.confidence < $1.confidence }) else {
                completion(nil); return
            }
            completion(BarDetection(boundingBox: best.boundingBox,
                                    timestamp: timestamp,
                                    confidence: best.confidence,
                                    source: .rectangles))
        }
        request.minimumAspectRatio = VNAspectRatio(minimumAspectRatio)
        request.maximumAspectRatio = 1.0
        request.minimumConfidence = minimumConfidence
        request.minimumSize = 0.1
        request.maximumObservations = 5

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([request])
        } catch {
            completion(nil)
        }
    }

    // MARK: - Model loading

    /// Attempts to load `barbell_detector.mlpackage` from the main bundle. When
    /// the model is absent (Phase 1 default) we return `nil` and the detector
    /// silently relies on the rectangle fallback. To swap in a trained model,
    /// drag the `.mlpackage` into Xcode and the auto-generated class will pick
    /// it up here.
    private static func loadCoreMLModel() -> VNCoreMLModel? {
        guard let url = Bundle.main.url(forResource: "barbell_detector", withExtension: "mlmodelc") else {
            return nil
        }
        guard let model = try? MLModel(contentsOf: url, configuration: MLModelConfiguration()) else {
            return nil
        }
        return try? VNCoreMLModel(for: model)
    }
}
