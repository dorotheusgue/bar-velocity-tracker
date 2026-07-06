import { useRef, useSyncExternalStore } from 'react';
import { TrainingEngine, type TrainingState } from '../lib/trainingEngine';

/**
 * Single source of truth for the training screen. Owns a stable
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
