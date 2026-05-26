import MiniBarChart from './MiniBarChart';
import type { SetSummary } from '../types';

interface Props {
  open: boolean;
  summary: SetSummary | null;
  onClose: () => void;
  onSave: () => void;
}

export default function SetSummarySheet({ open, summary, onClose, onSave }: Props) {
  if (!open || !summary) return null;

  const chartData = summary.reps.map((r) => ({
    id: r.id,
    index: r.index,
    value: r.meanConcentricVelocity,
    highlight: r.id === summary.bestRepId,
  }));

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <header className="sheet__header">
        <h2>Set Summary</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="summary-stats">
        <Stat label="Reps" value={String(summary.reps.length)} />
        <Stat label="Avg MCV" value={summary.averageMCV.toFixed(2)} unit="m/s" />
        <Stat label="Peak" value={summary.averagePeak.toFixed(2)} unit="m/s" />
        <Stat label="V-Loss" value={`${summary.velocityLossPercent.toFixed(1)}%`} />
      </div>

      <h3 className="summary-section-title">Mean Concentric Velocity</h3>
      <div className="summary-chart">
        <MiniBarChart
          data={chartData}
          reference={summary.targetVelocity}
          formatValue={(v) => v.toFixed(2)}
        />
      </div>

      <h3 className="summary-section-title">Reps</h3>
      <ul className="summary-reps">
        {summary.reps.map((rep) => (
          <li
            key={rep.id}
            className={
              rep.id === summary.bestRepId
                ? 'summary-reps__item summary-reps__item--best'
                : 'summary-reps__item'
            }
          >
            <span className="summary-reps__index">#{rep.index}</span>
            <span className="summary-reps__mcv">{rep.meanConcentricVelocity.toFixed(2)} m/s</span>
            <span className="summary-reps__aux">peak {rep.peakConcentricVelocity.toFixed(2)}</span>
            <span className="summary-reps__aux">{rep.rangeOfMotion.toFixed(2)} m</span>
            <span className="summary-reps__aux">{rep.concentricDuration.toFixed(2)} s</span>
          </li>
        ))}
      </ul>

      <footer className="sheet__footer">
        <button type="button" onClick={onClose}>
          Discard
        </button>
        <button type="button" className="primary" onClick={onSave}>
          Save Set
        </button>
      </footer>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">
        {value}
        {unit && <span className="stat__unit"> {unit}</span>}
      </span>
    </div>
  );
}
