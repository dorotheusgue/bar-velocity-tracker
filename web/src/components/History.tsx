import { useEffect, useMemo, useState } from 'react';
import MiniBarChart from './MiniBarChart';
import MiniLineChart from './MiniLineChart';
import { loadSessions } from '../lib/storage';
import type { SetSummary, StoredSession } from '../types';

export default function History() {
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [openSet, setOpenSet] = useState<SetSummary | null>(null);

  useEffect(() => {
    setSessions(loadSessions());
    const handler = () => setSessions(loadSessions());
    window.addEventListener('storage', handler);
    window.addEventListener('focus', handler);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('focus', handler);
    };
  }, []);

  if (sessions.length === 0) {
    return (
      <div className="empty">
        <h2>No sessions yet</h2>
        <p>Finish a set in the Train tab to start a session.</p>
      </div>
    );
  }

  return (
    <div className="history">
      <h1>History</h1>
      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} onOpenSet={setOpenSet} />
      ))}

      {openSet && (
        <div className="sheet" role="dialog" aria-modal="true">
          <header className="sheet__header">
            <h2>{openSet.exerciseName || 'Set'}</h2>
            <button type="button" onClick={() => setOpenSet(null)}>
              Close
            </button>
          </header>
          <div className="summary-stats">
            <Stat label="Load" value={`${openSet.loadKg}`} unit="kg" />
            <Stat label="Avg MCV" value={openSet.averageMCV.toFixed(2)} unit="m/s" />
            <Stat label="Peak" value={openSet.averagePeak.toFixed(2)} unit="m/s" />
            <Stat label="V-Loss" value={`${openSet.velocityLossPercent.toFixed(1)}%`} />
          </div>
          <div className="summary-chart">
            <MiniBarChart
              data={openSet.reps.map((r) => ({
                id: r.id,
                index: r.index,
                value: r.meanConcentricVelocity,
                highlight: r.id === openSet.bestRepId,
              }))}
              reference={openSet.targetVelocity}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session,
  onOpenSet,
}: {
  session: StoredSession;
  onOpenSet: (s: SetSummary) => void;
}) {
  const dateStr = useMemo(
    () =>
      new Date(session.date).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
    [session.date]
  );

  const sortedSets = useMemo(
    () => [...session.sets].sort((a, b) => a.startedAt - b.startedAt),
    [session.sets]
  );

  const trend = sortedSets.map((s) => s.averageMCV);

  return (
    <section className="session-card">
      <header className="session-card__header">
        <h2>{dateStr}</h2>
        <span className="session-card__count">{session.sets.length} sets</span>
      </header>
      {trend.length > 1 && (
        <div className="session-card__trend">
          <MiniLineChart values={trend} />
        </div>
      )}
      <ul className="session-card__sets">
        {sortedSets.map((set) => (
          <li key={set.id}>
            <button type="button" onClick={() => onOpenSet(set)} className="session-card__set">
              <span>{set.exerciseName || 'Set'}</span>
              <span>{set.loadKg} kg</span>
              <span>{set.reps.length} reps</span>
              <span>{set.averageMCV.toFixed(2)} m/s</span>
              <span>{set.velocityLossPercent.toFixed(1)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
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
