import { useEffect, useState } from 'react';
import type { Rep } from '../types';

interface Props {
  rep: Rep | null;
  targetVelocity: number;
  /** Auto-dismiss after this many ms; default 2500. */
  dismissAfterMs?: number;
}

export default function RepCard({ rep, targetVelocity, dismissAfterMs = 2500 }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!rep) return;
    setVisible(true);
    const handle = window.setTimeout(() => setVisible(false), dismissAfterMs);
    return () => window.clearTimeout(handle);
  }, [rep, dismissAfterMs]);

  if (!rep || !visible) return null;

  const tint =
    rep.meanConcentricVelocity >= targetVelocity
      ? 'good'
      : rep.meanConcentricVelocity >= targetVelocity * 0.9
        ? 'warn'
        : 'bad';

  return (
    <div className={`rep-card rep-card--${tint}`}>
      <div className="rep-card__cell">
        <span className="rep-card__label">Rep {rep.index}</span>
        <span className="rep-card__value rep-card__value--big">
          {rep.meanConcentricVelocity.toFixed(2)} m/s
        </span>
      </div>
      <div className="rep-card__cell">
        <span className="rep-card__label">Peak</span>
        <span className="rep-card__value">{rep.peakConcentricVelocity.toFixed(2)}</span>
      </div>
      <div className="rep-card__cell">
        <span className="rep-card__label">ROM</span>
        <span className="rep-card__value">{rep.rangeOfMotion.toFixed(2)} m</span>
      </div>
      <div className="rep-card__cell">
        <span className="rep-card__label">Time</span>
        <span className="rep-card__value">{rep.concentricDuration.toFixed(2)} s</span>
      </div>
    </div>
  );
}
