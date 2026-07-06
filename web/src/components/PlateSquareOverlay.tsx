import { useEffect, useRef, useState } from 'react';
import { domToVideoCoords, type Point2D } from '../lib/coords';

const STORAGE_DIAMETER = 'bvt.plateDiameterMm';
const DEFAULT_DIAMETER_MM = 450; // Olympic bumper, all weights.
const MIN_SIDE = 40;

interface Props {
  visible: boolean;
  videoWidth: number;
  videoHeight: number;
  /** Scrubbing inside the picker so the user can find a clear frame first. */
  currentTime: number;
  duration: number;
  onScrub: (t: number) => void;
  /** centre + half-side (= plate radius) in VIDEO pixels, plus diameter (m). */
  onSave: (centerVideo: Point2D, radiusPx: number, diameterMeters: number) => void;
  onCancel: () => void;
}

interface Square {
  cx: number;
  cy: number;
  side: number;
} // DOM px, relative to container

/**
 * Moveable, resizable square the user drops over the plate. Far easier than
 * dragging centre→edge to fit a circle: drag the body to move, drag the corner
 * handle or pinch (two fingers) to resize. The square's side = plate diameter
 * (scale) and its interior is the colour sample for the tracker.
 */
export default function PlateSquareOverlay({
  visible,
  videoWidth,
  videoHeight,
  currentTime,
  duration,
  onScrub,
  onSave,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [sq, setSq] = useState<Square | null>(null);
  const [diameterMm, setDiameterMm] = useState<number>(() => {
    const raw = localStorage.getItem(STORAGE_DIAMETER);
    const n = raw ? Number(raw) : DEFAULT_DIAMETER_MM;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DIAMETER_MM;
  });

  // Gesture state held in refs (no re-render thrash).
  const pointers = useRef<Map<number, Point2D>>(new Map());
  const mode = useRef<'idle' | 'move' | 'resize' | 'pinch'>('idle');
  const startSquare = useRef<Square | null>(null);
  const startPointer = useRef<Point2D | null>(null);
  const startDist = useRef(0);

  // Initialise the square centred at ~30% of the smaller side when shown.
  useEffect(() => {
    if (!visible) return;
    const el = ref.current;
    const rect = el?.getBoundingClientRect();
    const w = rect?.width ?? 320;
    const h = rect?.height ?? 480;
    const side = Math.min(w, h) * 0.3;
    setSq({ cx: w / 2, cy: h / 2, side });
  }, [visible]);

  if (!visible) return null;

  const hasVideoSource = videoWidth > 0 && videoHeight > 0;

  function localPoint(e: React.PointerEvent): Point2D {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function clampSquare(s: Square): Square {
    const rect = ref.current?.getBoundingClientRect();
    const w = rect?.width ?? 0;
    const h = rect?.height ?? 0;
    const side = Math.max(MIN_SIDE, Math.min(s.side, Math.min(w, h)));
    const half = side / 2;
    const cx = Math.max(half, Math.min(s.cx, w - half));
    const cy = Math.max(half, Math.min(s.cy, h - half));
    return { cx, cy, side };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>, fromHandle: boolean) {
    if (!sq) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, localPoint(e));
    startSquare.current = sq;

    if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      startDist.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      mode.current = 'pinch';
    } else {
      startPointer.current = localPoint(e);
      mode.current = fromHandle ? 'resize' : 'move';
    }
    e.stopPropagation();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (mode.current === 'idle' || !startSquare.current) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, localPoint(e));

    if (mode.current === 'pinch' && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = startDist.current > 0 ? dist / startDist.current : 1;
      setSq(clampSquare({ ...startSquare.current, side: startSquare.current.side * ratio }));
      return;
    }
    const p = localPoint(e);
    const sp = startPointer.current!;
    if (mode.current === 'move') {
      setSq(
        clampSquare({
          ...startSquare.current,
          cx: startSquare.current.cx + (p.x - sp.x),
          cy: startSquare.current.cy + (p.y - sp.y),
        })
      );
    } else if (mode.current === 'resize') {
      // Diagonal drag from the corner changes the side, centre fixed.
      const half0 = startSquare.current.side / 2;
      const corner0 = { x: startSquare.current.cx + half0, y: startSquare.current.cy + half0 };
      const newHalf = Math.max(
        MIN_SIDE / 2,
        Math.max(
          corner0.x + (p.x - sp.x) - startSquare.current.cx,
          corner0.y + (p.y - sp.y) - startSquare.current.cy
        )
      );
      setSq(clampSquare({ ...startSquare.current, side: newHalf * 2 }));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      mode.current = 'idle';
      startSquare.current = null;
      startPointer.current = null;
    } else if (pointers.current.size === 1) {
      // Dropped from pinch to single → resume move from the remaining pointer.
      mode.current = 'move';
      startSquare.current = sq;
      startPointer.current = [...pointers.current.values()][0];
    }
  }

  function save() {
    if (!sq || !hasVideoSource) return;
    const rect = ref.current!.getBoundingClientRect();
    const center = domToVideoCoords(sq.cx, sq.cy, rect.width, rect.height, videoWidth, videoHeight);
    const right = domToVideoCoords(
      sq.cx + sq.side / 2,
      sq.cy,
      rect.width,
      rect.height,
      videoWidth,
      videoHeight
    );
    const radiusPx = Math.abs(right.x - center.x);
    if (radiusPx < 2) return;
    localStorage.setItem(STORAGE_DIAMETER, String(diameterMm));
    onSave(center, radiusPx, diameterMm / 1000);
  }

  const rect = sq
    ? { left: sq.cx - sq.side / 2, top: sq.cy - sq.side / 2, size: sq.side }
    : null;

  return (
    <div
      ref={ref}
      className="cal-overlay"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <header className="cal-overlay__top" data-chrome>
        <button type="button" onClick={onCancel} className="cal-overlay__cancel">
          Cancel
        </button>
        <p className="cal-overlay__hint">
          {hasVideoSource
            ? 'Drag to move · pinch or corner to resize · cover the plate'
            : 'Load a video first'}
        </p>
      </header>

      {rect && (
        <div
          className="plate-square"
          style={{ left: rect.left, top: rect.top, width: rect.size, height: rect.size }}
          onPointerDown={(e) => onPointerDown(e, false)}
        >
          <div
            className="plate-square__handle"
            onPointerDown={(e) => onPointerDown(e, true)}
          />
        </div>
      )}

      <footer className="cal-overlay__bottom" data-chrome>
        <div className="cal-overlay__scrub">
          <span className="cal-overlay__scrub-label">Frame</span>
          <input
            type="range"
            min={0}
            max={duration || 0.001}
            step={0.01}
            value={Math.min(currentTime, duration || currentTime)}
            onChange={(e) => onScrub(parseFloat(e.target.value))}
            aria-label="Scrub to a clear frame"
          />
        </div>
        <label className="cal-overlay__field">
          <span>Plate diameter</span>
          <input
            type="number"
            min={50}
            max={800}
            step={5}
            value={diameterMm}
            onChange={(e) => setDiameterMm(parseFloat(e.target.value) || 0)}
          />
          <span className="cal-overlay__unit">mm</span>
        </label>
        <div className="cal-overlay__actions">
          <button type="button" className="primary" onClick={save} disabled={!hasVideoSource}>
            Save
          </button>
        </div>
      </footer>
    </div>
  );
}
