import { useState } from 'react';
import VelocityChart from './VelocityChart';
import type { MetricsSnapshot } from '../lib/metrics';
import type { ChartSeries, RepSpan } from '../lib/trainingEngine';

interface Props {
  metrics: MetricsSnapshot;
  chart: ChartSeries | null;
  repSpans: RepSpan[];
  duration: number;
  currentTime: number;
  targetVelocity: number;
  saved: boolean;
  onSeek: (t: number) => void;
  onSave: () => void;
}

/**
 * Metric-style results panel: appears automatically once analysis completes.
 * Set stats, the velocity–time chart (which doubles as a scrubber), a tappable
 * per-rep list, and Save. Collapsible to a slim handle so the video stays
 * reviewable.
 */
export default function ResultsPanel({
  metrics,
  chart,
  repSpans,
  duration,
  currentTime,
  targetVelocity,
  saved,
  onSeek,
  onSave,
}: Props) {
  const [expanded, setExpanded] = useState(true);
  const reps = metrics.reps;
  if (reps.length === 0) return null;

  return (
    <div className={`results ${expanded ? 'results--open' : ''}`}>
      <button
        type="button"
        className="results__handle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="results__grip" aria-hidden />
        <span className="results__handle-stats">
          <strong>{reps.length}</strong> reps · avg{' '}
          <strong>{metrics.averageMCV.toFixed(2)}</strong> m/s · loss{' '}
          <strong>{metrics.velocityLossPercent.toFixed(0)}%</strong>
        </span>
        <span className="results__chevron" aria-hidden>
          {expanded ? '▾' : '▴'}
        </span>
      </button>

      {expanded && (
        <div className="results__body">
          <div className="summary-stats summary-stats--panel">
            <Stat label="Reps" value={String(reps.length)} />
            <Stat label="Avg MCV" value={metrics.averageMCV.toFixed(2)} unit="m/s" />
            <Stat label="Avg peak" value={metrics.averagePeak.toFixed(2)} unit="m/s" />
            <Stat label="V-Loss" value={`${metrics.velocityLossPercent.toFixed(1)}%`} />
          </div>

          {chart && (
            <VelocityChart
              chart={chart}
              repSpans={repSpans}
              duration={duration}
              currentTime={currentTime}
              targetVelocity={targetVelocity}
              onSeek={onSeek}
            />
          )}

          <ul className="results__reps">
            {reps.map((rep) => {
              const tint =
                rep.meanConcentricVelocity >= targetVelocity
                  ? 'good'
                  : rep.meanConcentricVelocity >= targetVelocity * 0.9
                    ? 'warn'
                    : 'bad';
              return (
                <li key={rep.id}>
                  <button
                    type="button"
                    className={`results__rep ${
                      rep.id === metrics.bestRepId ? 'results__rep--best' : ''
                    }`}
                    onClick={() => rep.videoStart != null && onSeek(rep.videoStart)}
                  >
                    <span className="results__rep-index">#{rep.index}</span>
                    <span className={`results__rep-mcv results__rep-mcv--${tint}`}>
                      {rep.meanConcentricVelocity.toFixed(2)} m/s
                    </span>
                    <span className="results__rep-aux">
                      peak {rep.peakConcentricVelocity.toFixed(2)}
                    </span>
                    <span className="results__rep-aux">{rep.rangeOfMotion.toFixed(2)} m</span>
                    <span className="results__rep-aux">
                      {rep.concentricDuration.toFixed(2)} s
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            className="results__save"
            onClick={onSave}
            disabled={saved}
          >
            {saved ? 'Saved ✓' : 'Save set'}
          </button>
        </div>
      )}
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
