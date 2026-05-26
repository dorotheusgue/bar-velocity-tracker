import { useEffect, useRef, useState } from 'react';
import { domToVideoCoords, type Point2D } from '../lib/coords';

interface Props {
  visible: boolean;
  videoWidth: number;
  videoHeight: number;
  initialDistance: number;
  currentScale: number | null;
  onSave: (videoA: Point2D, videoB: Point2D, knownMeters: number) => void;
  onCancel: () => void;
}

/**
 * Inline calibration. Sits on top of the live <video> preview so the user
 * can see the actual bar while tapping its two collars. Coordinates are
 * captured in DOM space and converted to video-pixel space before being
 * handed to the calibration manager — otherwise the meters-per-pixel scale
 * would be off by the object-fit: cover ratio.
 */
export default function CalibrationOverlay({
  visible,
  videoWidth,
  videoHeight,
  initialDistance,
  currentScale,
  onSave,
  onCancel,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [a, setA] = useState<Point2D | null>(null);
  const [b, setB] = useState<Point2D | null>(null);
  const [aVideo, setAVideo] = useState<Point2D | null>(null);
  const [bVideo, setBVideo] = useState<Point2D | null>(null);
  const [known, setKnown] = useState(initialDistance);

  useEffect(() => {
    if (!visible) return;
    setA(null);
    setB(null);
    setAVideo(null);
    setBVideo(null);
    setKnown(initialDistance);
  }, [visible, initialDistance]);

  if (!visible) return null;

  const hasVideoSource = videoWidth > 0 && videoHeight > 0;

  function handlePointer(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    // Ignore taps that landed on the chrome (header buttons, footer inputs).
    if (target.closest('[data-cal-chrome]')) return;
    if (!containerRef.current || videoWidth === 0 || videoHeight === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dom: Point2D = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const video = domToVideoCoords(
      dom.x,
      dom.y,
      rect.width,
      rect.height,
      videoWidth,
      videoHeight
    );
    if (!a) {
      setA(dom);
      setAVideo(video);
    } else if (!b) {
      setB(dom);
      setBVideo(video);
    } else {
      setA(dom);
      setAVideo(video);
      setB(null);
      setBVideo(null);
    }
  }

  function save() {
    if (!aVideo || !bVideo || known <= 0) return;
    onSave(aVideo, bVideo, known);
  }

  function reset() {
    setA(null);
    setB(null);
    setAVideo(null);
    setBVideo(null);
  }

  const hint = !hasVideoSource
    ? 'Start the camera or upload a video first'
    : !a
      ? 'Tap one collar of the bar'
      : !b
        ? 'Tap the other collar'
        : 'Set the bar length below, then Save';

  return (
    <div ref={containerRef} className="cal-overlay" onPointerDown={handlePointer}>
      <header className="cal-overlay__top" data-cal-chrome>
        <button type="button" onClick={onCancel} className="cal-overlay__cancel">
          Cancel
        </button>
        <p className="cal-overlay__hint">{hint}</p>
        <span className="cal-overlay__scale">
          {currentScale != null ? `${currentScale.toFixed(5)} m/px` : 'not set'}
        </span>
      </header>

      {a && <Marker point={a} label="A" />}
      {b && <Marker point={b} label="B" />}
      {a && b && (
        <svg className="cal-overlay__line" aria-hidden>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        </svg>
      )}

      <footer className="cal-overlay__bottom" data-cal-chrome>
        <label className="cal-overlay__field">
          <span>Bar length</span>
          <input
            type="number"
            min={0.1}
            step={0.05}
            value={known}
            onChange={(e) => setKnown(parseFloat(e.target.value) || 0)}
          />
          <span className="cal-overlay__unit">m</span>
        </label>
        <div className="cal-overlay__actions">
          <button type="button" onClick={reset} disabled={!a && !b}>
            Reset
          </button>
          <button
            type="button"
            className="primary"
            onClick={save}
            disabled={!a || !b || known <= 0}
          >
            Save
          </button>
        </div>
      </footer>
    </div>
  );
}

function Marker({ point, label }: { point: Point2D; label: string }) {
  return (
    <span
      className="cal-overlay__marker"
      style={{ left: point.x, top: point.y }}
      aria-hidden
    >
      {label}
    </span>
  );
}
