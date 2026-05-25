import SwiftUI

/// Draws the detected bar's bounding box on top of the camera preview.
/// `box` is in Vision's normalised image coordinates (origin bottom-left).
struct BoundingBoxOverlay: View {
    let box: CGRect?
    let confidence: Float
    let isTracking: Bool

    var body: some View {
        GeometryReader { geo in
            if let box {
                let rect = convert(box, in: geo.size)
                ZStack(alignment: .topLeading) {
                    Path { path in path.addRect(rect) }
                        .stroke(strokeColor, lineWidth: 3)
                        .animation(.easeOut(duration: 0.08), value: rect)

                    Text(String(format: "BAR %.0f%%", confidence * 100))
                        .font(.caption2.monospaced())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(strokeColor.opacity(0.85))
                        .foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .position(x: rect.minX + 40, y: max(8, rect.minY - 10))
                }
            }
        }
        .allowsHitTesting(false)
    }

    private var strokeColor: Color {
        isTracking ? .green : .orange
    }

    /// Vision's box has origin bottom-left; SwiftUI's origin is top-left.
    private func convert(_ box: CGRect, in size: CGSize) -> CGRect {
        let x = box.minX * size.width
        let w = box.width * size.width
        let h = box.height * size.height
        let y = (1 - box.minY - box.height) * size.height
        return CGRect(x: x, y: y, width: w, height: h)
    }
}
