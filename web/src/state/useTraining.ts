import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { TrainingEngine, type TrainingState } from '../lib/trainingEngine';
import type { Rep, SetSummary } from '../types';

/**
 * Single source of truth for the live training screen. Owns a stable
 * `TrainingEngine` instance and lets components subscribe to its state.
 */
export function useTrainingEngine() {
  const engineRef = useRef<TrainingEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new TrainingEngine();
  }
  return engineRef.current;
}

export function useTrainingState(engine: TrainingEngine): TrainingState {
  return useSyncExternalStore(
    (callback) => engine.subscribe(callback),
    () => engine.getState(),
    () => engine.getState()
  );
}

export function useLastRep(engine: TrainingEngine) {
  const [rep, setRep] = useState<Rep | null>(null);
  useEffect(() => engine.onRep(setRep), [engine]);
  return rep;
}

export function useLastSummary(engine: TrainingEngine) {
  const [summary, setSummary] = useState<SetSummary | null>(null);
  useEffect(() => engine.onSetSummary(setSummary), [engine]);
  return summary;
}
