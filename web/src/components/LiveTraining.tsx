import { useEffect, useRef, useState } from 'react';
import CameraView from './CameraView';
import BoundingBoxOverlay from './BoundingBoxOverlay';
import RepCard from './RepCard';
import CalibrationSheet from './CalibrationSheet';
import DebugSheet from './DebugSheet';
import SetSummarySheet from './SetSummarySheet';
import {
  useTrainingEngine,
  useTrainingState,
  useLastRep,
  useLastSummary,
} from '../state/useTraining';
import { appendSet } from '../lib/storage';
import type { SetSummary } from '../types';

const STORAGE_EXERCISE = 'bvt.exerciseName';
const STORAGE_LOAD = 'bvt.loadKg';
const STORAGE_TARGET = 'bvt.targetVelocity';

export default function LiveTraining() {
  const engine = useTrainingEngine();
  const state = useTrainingState(engine);
  const lastRep = useLastRep(engine);
  const lastSummary = useLastSummary(engine);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [showCalibration, setShowCalibration] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [pendingSave, setPendingSave] = useState<SetSummary | null>(null);

  const [exerciseName, setExerciseName] = useState(
    () => localStorage.getItem(STORAGE_EXERCISE) ?? 'Back Squat'
  );
  const [loadKg, setLoadKg] = useState(
    () => parseFloat(localStorage.getItem(STORAGE_LOAD) ?? '0') || 0
  );
  const [targetVelocity, setTargetVelocity] = useState(
    () => parseFloat(localStorage.getItem(STORAGE_TARGET) ?? '0.6') || 0.6
  );

  useEffect(() => {
    engine.exerciseName = exerciseName;
    engine.loadKg = loadKg;
    engine.targetVelocity = targetVelocity;
    localStorage.setItem(STORAGE_EXERCISE, exerciseName);
    localStorage.setItem(STORAGE_LOAD, String(loadKg));
    localStorage.setItem(STORAGE_TARGET, String(targetVelocity));
  }, [engine, exerciseName, loadKg, targetVelocity]);

  // Start the camera once the <video> element is mounted and the model is ready.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !state.isModelReady || state.isRunning) return;
    void engine.start(video, 'environment');
    return () => engine.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, state.isModelReady]);

  useEffect(() => {
    if (lastSummary) {
      setPendingSave(lastSummary);
      setShowSummary(true);
    }
  }, [lastSummary]);

  function handleEndSet() {
    engine.endSet();
  }

  function handleSave() {
    if (pendingSave) {
      appendSet(pendingSave);
    }
    setShowSummary(false);
    setPendingSave(null);
  }

  function handleDiscard() {
    setShowSummary(false);
    setPendingSave(null);
  }

  const velocityClass =
    state.velocity >= targetVelocity
      ? 'velocity--good'
      : state.velocity >= targetVelocity * 0.9
        ? 'velocity--warn'
        : 'velocity--bad';

  return (
    <div className="live">
      <CameraView ref={videoRef} />
      <BoundingBoxOverlay detection={state.detection} isTracking={state.isTracking} />

      <div className="live__hud">
        <header className="live__top">
          <div className="live__top-left">
            <IconButton aria-label="Calibrate" onClick={() => setShowCalibration(true)}>📏</IconButton>
            <IconButton aria-label="Flip camera" onClick={() => void engine.toggleCamera()}>🔄</IconButton>
          </div>
          <div className="live__meta">
            <strong>{exerciseName}</strong>
            <span>
              {loadKg} kg · target {targetVelocity.toFixed(2)} m/s
            </span>
          </div>
          <div className="live__top-right">
            <IconButton aria-label="Debug" onClick={() => setShowDebug(true)}>⚙️</IconButton>
          </div>
        </header>

        <div className="live__center">
          {state.cameraNotice && <p className="live__notice">{state.cameraNotice}</p>}
          {!state.isModelReady && <p className="live__notice">Loading detection model…</p>}
          {state.lastError && <p className="live__notice live__notice--error">{state.lastError}</p>}
          <div className={`velocity ${velocityClass}`}>{state.velocity.toFixed(2)}</div>
          <div className="velocity__label">m/s · concentric</div>
          <div className="live__chips">
            <span className="chip">#{state.repCount}</span>
            <span className="chip">{state.phase}</span>
            <span className="chip">{state.fps.toFixed(0)} fps</span>
          </div>
        </div>

        <footer className="live__bottom">
          <button
            type="button"
            className="end-set"
            onClick={handleEndSet}
            disabled={state.setRepCount === 0}
          >
            ⏹ End Set
          </button>
        </footer>
      </div>

      <RepCard rep={lastRep} targetVelocity={targetVelocity} />

      <CalibrationSheet
        open={showCalibration}
        onClose={() => setShowCalibration(false)}
        calibration={engine.calibration}
      />
      <DebugSheet
        open={showDebug}
        onClose={() => setShowDebug(false)}
        engine={engine}
        state={state}
        exerciseName={exerciseName}
        loadKg={loadKg}
        targetVelocity={targetVelocity}
        onExerciseChange={setExerciseName}
        onLoadChange={setLoadKg}
        onTargetVelocityChange={setTargetVelocity}
      />
      <SetSummarySheet
        open={showSummary}
        summary={pendingSave}
        onSave={handleSave}
        onClose={handleDiscard}
      />
    </div>
  );
}

function IconButton({
  children,
  onClick,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="icon-button" onClick={onClick} {...rest}>
      {children}
    </button>
  );
}
