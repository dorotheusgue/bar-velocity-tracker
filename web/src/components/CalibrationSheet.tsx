import { useEffect, useState } from 'react';
import type { CalibrationManager } from '../lib/calibration';

interface Point {
  x: number;
  y: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  calibration: CalibrationManager;
}

export default function CalibrationSheet({ open, onClose, calibration }: Props) {
  const [a, setA] = useState<Point | null>(null);
  const [b, setB] = useState<Point | null>(null);
  const [known, setKnown] = useState(calibration.knownDistanceMeters);
  const [mpp, setMpp] = useState<number | null>(calibration.metersPerPixel);

  useEffect(() => {
    if (open) {
      setA(null);
      setB(null);
      setKnown(calibration.knownDistanceMeters);
      setMpp(calibration.metersPerPixel);
    }
  }, [open, calibration]);

  useEffect(
    () => calibration.onChange(() => setMpp(calibration.metersPerPixel)),
    [calibration]
  );

  if (!open) return null;

  function registerTap(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point: Point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!a) setA(point);
    else if (!b) setB(point);
    else {
      setA(point);
      setB(null);
    }
  }

  function save() {
    if (!a || !b) return;
    calibration.setKnownDistance(known);
    calibration.calibrateFromPoints(a, b);
    onClose();
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <header className="sheet__header">
        <h2>Calibrate</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="sheet__copy">
        Tap the two collars of your bar in the camera view. Default reference length is 2.2 m
        (men's Olympic bar).
      </p>
      <div className="sheet__row">
        <label htmlFor="known">Known distance</label>
        <input
          id="known"
          type="number"
          min={0.1}
          step={0.05}
          value={known}
          onChange={(e) => setKnown(parseFloat(e.target.value) || 0)}
        />
        <span className="sheet__unit">m</span>
      </div>

      <div className="calibration-canvas" onPointerDown={registerTap}>
        {mpp != null && (
          <span className="calibration-canvas__scale">scale: {mpp.toFixed(5)} m/px</span>
        )}
        {a && <Marker point={a} label="A" />}
        {b && <Marker point={b} label="B" />}
        {a && b && (
          <svg className="calibration-canvas__line">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          </svg>
        )}
        <p className="calibration-canvas__hint">
          {!a ? 'Tap the left collar' : !b ? 'Tap the right collar' : 'Tap to reset both points'}
        </p>
      </div>

      <footer className="sheet__footer">
        <button
          type="button"
          onClick={() => {
            setA(null);
            setB(null);
          }}
        >
          Reset points
        </button>
        <button
          type="button"
          className="primary"
          onClick={save}
          disabled={!a || !b || known <= 0}
        >
          Save
        </button>
      </footer>
    </div>
  );
}

function Marker({ point, label }: { point: Point; label: string }) {
  return (
    <span className="calibration-marker" style={{ left: point.x, top: point.y }}>
      {label}
    </span>
  );
}
