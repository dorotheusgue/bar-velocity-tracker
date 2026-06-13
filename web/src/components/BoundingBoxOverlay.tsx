import type { BoundingBox } from '../types';

interface Props {
  box: BoundingBox | null;
  confidence: number;
  label?: string;
  isTracking: boolean;
}

/**
 * Renders the detected plate position as a box over the video during review.
 * Fed from the smoothed offline trajectory (looked up at the playhead), so the
 * box reflects exactly what was tracked — a visual sanity check before trusting
 * the numbers.
 */
export default function BoundingBoxOverlay({ box, confidence, label, isTracking }: Props) {
  if (!box) return null;

  const color = isTracking ? '#32c759' : '#ff9f0a';

  return (
    <div className="bbox-overlay" aria-hidden>
      <div
        className="bbox"
        style={{
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.width * 100}%`,
          height: `${box.height * 100}%`,
          borderColor: color,
        }}
      >
        <span className="bbox-label" style={{ background: color }}>
          {(label ?? 'BAR').toUpperCase()} {(confidence * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
