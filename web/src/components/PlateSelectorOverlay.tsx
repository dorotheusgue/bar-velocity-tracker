import { useEffect, useRef, useState } from 'react';
import { domToVideoCoords, type Point2D } from '../lib/coords';

const STORAGE_DIAMETER = 'bvt.plateDiameterMm';
const DEFAULT_DIAMETER_MM = 450; // Olympic bumper plate, all weights.

interface Props {
  visible: boolean;
  videoWidth: number;
  videoHeight: number;
  onSave: (centerVideo: Point2D, edgeVideo: Point2D, diameterMeters: number) => void;
  onCancel: () => void;
}

interface MarkPair {
  center: Point2D;
  edge: Point2D;
  centerVideo: Point2D;
  edgeVideo: Point2D;
}

/**
 * RepSpeed-style plate picker. The user presses on the plate's centre and
 * drags out to its edge; the resulting circle defines both the tracking
 * target and the m/px scale (Olympic plate diameter is a constant). One
 * gesture replaces the old "calibrate, then tap to track" two-step flow.
 *
 * Falls back to tap-tap if the pointer never moves (single tap acts as
 * centre, second tap as edge).
 */
export default function PlateSelectorOverlay({
  visible,
  videoWidth,
  videoHeight,
  onSave,
  onCancel,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pair, setPair] = useState<MarkPair | null>(null);
  const [tapCenter, setTapCenter] = useState<{ dom: Point2D; video: Point2D } | null>(null);
  const dragging = useRef(false);
  const [diameterMm, setDiameterMm] = useState<number>(() => {
    const raw = localStorage.getItem(STORAGE_DIAMETER);
    const n = raw ? Number(raw) : DEFAULT_DIAMETER_MM;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DIAMETER_MM;
  });

  useEffect(() => {
    if (!visible) {
      setPair(null);
      setTapCenter(null);
      dragging.current = false;
    }
  }, [visible]);

  if (!visible) return null;

  const hasVideoSource = videoWidth > 0 && videoHeight > 0;

  function toPoints(event: React.PointerEvent<HTMLDivElement>) {
    const rect = containerRef.current!.getBoundingClientRect();
    const dom: Point2D = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const video = domToVideoCoords(
      dom.x,
      dom.y,
      rect.width,
      rect.height,
      videoWidth,
      videoHeight
    );
    return { dom, video };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-chrome]')) return;
    if (!containerRef.current || !hasVideoSource) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    const { dom, video } = toPoints(event);
    setTapCenter({ dom, video });
    setPair(null);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current || !tapCenter) return;
    const { dom, video } = toPoints(event);
    setPair({
      center: tapCenter.dom,
      edge: dom,
      centerVideo: tapCenter.video,
      edgeVideo: video,
    });
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragging.current = false;
    if (!tapCenter) return;
    const { dom, video } = toPoints(event);
    const dx = dom.x - tapCenter.dom.x;
    const dy = dom.y - tapCenter.dom.y;
    const moved = Math.hypot(dx, dy);
    if (moved < 6) {
      // Treat as a "tap centre"; user will tap again for the edge.
      return;
    }
    setPair({
      center: tapCenter.dom,
      edge: dom,
      centerVideo: tapCenter.video,
      edgeVideo: video,
    });
    setTapCenter(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onClickFallback(event: React.PointerEvent<HTMLDivElement>) {
    // Already handled by pointer events for drag. The "tap-tap" fallback is
    // covered by holding the previous tap centre in `tapCenter` until the
    // next pointerup releases at a different spot — see onPointerUp.
    event.preventDefault();
  }

  function save() {
    if (!pair) return;
    const meters = diameterMm / 1000;
    localStorage.setItem(STORAGE_DIAMETER, String(diameterMm));
    onSave(pair.centerVideo, pair.edgeVideo, meters);
  }

  function reset() {
    setPair(null);
    setTapCenter(null);
  }

  const radiusPx = pair ? Math.hypot(pair.center.x - pair.edge.x, pair.center.y - pair.edge.y) : 0;

  const hint = !hasVideoSource
    ? 'Start the camera or upload a video first'
    : pair
      ? `Plate radius ${radiusPx.toFixed(0)} px. Adjust diameter and Save.`
      : tapCenter
        ? 'Now tap the edge of the same plate'
        : 'Press the centre of a plate and drag to its edge';

  const liveCenter = tapCenter?.dom ?? pair?.center ?? null;
  const liveEdge = pair?.edge ?? null;

  return (
    <div
      ref={containerRef}
      className="cal-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClickFallback}
    >
      <header className="cal-overlay__top" data-chrome>
        <button type="button" onClick={onCancel} className="cal-overlay__cancel">
          Cancel
        </button>
        <p className="cal-overlay__hint">{hint}</p>
      </header>

      {liveCenter && (
        <span
          className="cal-overlay__marker"
          style={{ left: liveCenter.x, top: liveCenter.y }}
          aria-hidden
        >
          ·
        </span>
      )}
      {liveCenter && liveEdge && (
        <svg className="cal-overlay__line" aria-hidden>
          <circle
            cx={liveCenter.x}
            cy={liveCenter.y}
            r={Math.hypot(liveCenter.x - liveEdge.x, liveCenter.y - liveEdge.y)}
            fill="none"
            stroke="var(--good)"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
          <line x1={liveCenter.x} y1={liveCenter.y} x2={liveEdge.x} y2={liveEdge.y} />
        </svg>
      )}
      {liveEdge && (
        <span
          className="cal-overlay__marker"
          style={{ left: liveEdge.x, top: liveEdge.y }}
          aria-hidden
        >
          ·
        </span>
      )}

      <footer className="cal-overlay__bottom" data-chrome>
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
          <button type="button" onClick={reset} disabled={!pair && !tapCenter}>
            Reset
          </button>
          <button
            type="button"
            className="primary"
            onClick={save}
            disabled={!pair || diameterMm <= 0}
          >
            Save
          </button>
        </div>
      </footer>
    </div>
  );
}
