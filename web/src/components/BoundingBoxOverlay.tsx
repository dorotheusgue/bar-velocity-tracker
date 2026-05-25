import type { BarDetection } from '../types';

interface Props {
  detection: BarDetection | null;
  isTracking: boolean;
}

/**
 * Draws the latest detection's bounding box. Coordinates are normalised 0..1
 * with the DOM convention (origin top-left), so they render correctly when the
 * underlying <video> is `object-fit: cover` (which only crops, never warps).
 */
export default function BoundingBoxOverlay({ detection, isTracking }: Props) {
  if (!detection) return null;

  const { x, y, width, height } = detection.boundingBox;
  const color = isTracking ? '#32c759' : '#ff9f0a';

  return (
    <div className="bbox-overlay" aria-hidden>
      <div
        className="bbox"
        style={{
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          width: `${width * 100}%`,
          height: `${height * 100}%`,
          borderColor: color,
        }}
      >
        <span className="bbox-label" style={{ background: color }}>
          {detection.label?.toUpperCase() ?? 'BAR'} {(detection.confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
