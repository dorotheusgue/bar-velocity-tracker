import { useEffect, useRef, useState } from 'react';
import { videoToDomCoords } from '../lib/coords';
import type { PathPoint } from '../lib/trainingEngine';
import type { BarPosition } from '../types';

interface Props {
  videoWidth: number;
  videoHeight: number;
  pathPoints: PathPoint[] | null;
  position: BarPosition | null;
  plateRadiusPx: number;
  currentTime: number;
}

/**
 * Bar-path + plate-marker overlay, drawn over the video during review.
 * All coordinates are mapped through the same `object-fit: cover` transform
 * the <video> uses (via videoToDomCoords), so the path and marker sit exactly
 * where the tracker measured them — this replaces the old percentage-based
 * box that drifted whenever the container and video aspect ratios differed.
 */
export default function TrackingOverlay({
  videoWidth,
  videoHeight,
  pathPoints,
  position,
  plateRadiusPx,
  currentTime,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ready = videoWidth > 0 && size.w > 0;

  let pastLine = '';
  let futureLine = '';
  if (ready && pathPoints && pathPoints.length > 1) {
    const past: string[] = [];
    const future: string[] = [];
    for (const p of pathPoints) {
      const d = videoToDomCoords(p.x, p.y, size.w, size.h, videoWidth, videoHeight);
      const s = `${d.x.toFixed(1)},${d.y.toFixed(1)}`;
      if (p.t <= currentTime) past.push(s);
      else future.push(s);
    }
    // Bridge the two halves so the path is continuous at the playhead.
    if (past.length > 0 && future.length > 0) future.unshift(past[past.length - 1]);
    pastLine = past.join(' ');
    futureLine = future.join(' ');
  }

  let marker: { x: number; y: number; r: number } | null = null;
  if (ready && position) {
    const d = videoToDomCoords(
      position.xPixel,
      position.yPixel,
      size.w,
      size.h,
      videoWidth,
      videoHeight
    );
    const scale = Math.max(size.w / videoWidth, size.h / videoHeight);
    marker = { x: d.x, y: d.y, r: Math.max(8, plateRadiusPx * scale) };
  }

  return (
    <div ref={ref} className="tracking-overlay" aria-hidden>
      {ready && (
        <svg width={size.w} height={size.h}>
          {futureLine && (
            <polyline className="tracking-overlay__path-future" points={futureLine} />
          )}
          {pastLine && <polyline className="tracking-overlay__path-past" points={pastLine} />}
          {marker && (
            <>
              <circle
                className="tracking-overlay__plate"
                cx={marker.x}
                cy={marker.y}
                r={marker.r}
              />
              <circle
                className="tracking-overlay__center"
                cx={marker.x}
                cy={marker.y}
                r={3}
              />
            </>
          )}
        </svg>
      )}
    </div>
  );
}
