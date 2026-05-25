import type { Rep, SetSummary } from '../types';

export interface MetricsSnapshot {
  reps: Rep[];
  velocityLossPercent: number;
  averageMCV: number;
  averagePeak: number;
  bestRepId: string | null;
}

/**
 * Accumulates reps for the current set and produces both live derived metrics
 * and a final `SetSummary` when the user ends the set.
 */
export class MetricsEngine {
  reps: Rep[] = [];
  private setStartedAt: number = Date.now();
  private listeners: Set<(snap: MetricsSnapshot) => void> = new Set();
  private summaryListeners: Set<(summary: SetSummary) => void> = new Set();

  append(rep: Rep) {
    if (this.reps.length === 0) this.setStartedAt = rep.timestamp;
    this.reps.push(rep);
    this.emitSnapshot();
  }

  /** Finalise the current set, emit a `SetSummary`, then clear live state. */
  endSet(meta: { exerciseName: string; loadKg: number; targetVelocity: number }):
    | SetSummary
    | null {
    if (this.reps.length === 0) return null;
    const snap = this.computeSnapshot();
    const summary: SetSummary = {
      id: crypto.randomUUID(),
      reps: this.reps,
      velocityLossPercent: snap.velocityLossPercent,
      averageMCV: snap.averageMCV,
      averagePeak: snap.averagePeak,
      bestRepId: snap.bestRepId,
      startedAt: this.setStartedAt,
      endedAt: Date.now(),
      exerciseName: meta.exerciseName,
      loadKg: meta.loadKg,
      targetVelocity: meta.targetVelocity,
    };
    for (const l of this.summaryListeners) l(summary);
    this.clear();
    return summary;
  }

  clear() {
    this.reps = [];
    this.emitSnapshot();
  }

  snapshot(): MetricsSnapshot {
    return this.computeSnapshot();
  }

  onSnapshot(listener: (snap: MetricsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onSetSummary(listener: (summary: SetSummary) => void): () => void {
    this.summaryListeners.add(listener);
    return () => {
      this.summaryListeners.delete(listener);
    };
  }

  private emitSnapshot() {
    const snap = this.computeSnapshot();
    for (const l of this.listeners) l(snap);
  }

  private computeSnapshot(): MetricsSnapshot {
    if (this.reps.length === 0) {
      return {
        reps: [],
        velocityLossPercent: 0,
        averageMCV: 0,
        averagePeak: 0,
        bestRepId: null,
      };
    }
    const first = this.reps[0];
    const last = this.reps[this.reps.length - 1];
    const vLoss =
      first.meanConcentricVelocity > 0
        ? ((first.meanConcentricVelocity - last.meanConcentricVelocity) /
            first.meanConcentricVelocity) *
          100
        : 0;
    const avgMCV =
      this.reps.reduce((a, r) => a + r.meanConcentricVelocity, 0) / this.reps.length;
    const avgPeak =
      this.reps.reduce((a, r) => a + r.peakConcentricVelocity, 0) / this.reps.length;
    const best = this.reps.reduce((acc, r) =>
      r.meanConcentricVelocity > acc.meanConcentricVelocity ? r : acc
    );
    return {
      reps: this.reps,
      velocityLossPercent: vLoss,
      averageMCV: avgMCV,
      averagePeak: avgPeak,
      bestRepId: best.id,
    };
  }
}
