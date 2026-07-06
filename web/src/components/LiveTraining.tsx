import { useEffect, useRef, useState } from 'react';
import CameraView from './CameraView';
import TrackingOverlay from './TrackingOverlay';
import PlateSquareOverlay from './PlateSquareOverlay';
import DebugSheet from './DebugSheet';
import PlaybackControls from './PlaybackControls';
import ResultsPanel from './ResultsPanel';
import { useTrainingEngine, useTrainingState } from '../state/useTraining';
import { appendSet } from '../lib/storage';
import type { Point2D } from '../lib/coords';

const STORAGE_EXERCISE = 'bvt.exerciseName';
const STORAGE_LOAD = 'bvt.loadKg';
const STORAGE_TARGET = 'bvt.targetVelocity';

export default function LiveTraining() {
  const engine = useTrainingEngine();
  const state = useTrainingState(engine);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [showDebug, setShowDebug] = useState(false);
  const [showPlatePicker, setShowPlatePicker] = useState(false);

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

  // Open the plate picker once a video is loaded and a plate is needed.
  useEffect(() => {
    if (state.hasVideo && state.needsPlate) setShowPlatePicker(true);
  }, [state.hasVideo, state.needsPlate]);

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !videoRef.current) return;
    void engine.loadFile(videoRef.current, file);
  }

  function handleOpenPlatePicker() {
    if (!state.isPaused) engine.togglePlay();
    setShowPlatePicker(true);
  }

  function handlePlateSave(center: Point2D, radiusPx: number, diameterMeters: number) {
    engine.selectPlate(center, radiusPx, diameterMeters);
    setShowPlatePicker(false);
  }

  function handleSaveSet() {
    const summary = engine.saveSet();
    if (summary) appendSet(summary);
  }

  const velocityClass =
    state.velocity >= targetVelocity
      ? 'velocity--good'
      : state.velocity >= targetVelocity * 0.9
        ? 'velocity--warn'
        : 'velocity--bad';

  const analysing =
    state.analysisStatus === 'detecting' || state.analysisStatus === 'smoothing';
  const done = state.analysisStatus === 'done';

  // Empty state: no video loaded yet.
  if (!state.hasVideo) {
    return (
      <div className="live">
        <CameraView ref={videoRef} />
        <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={handleFilePick} />
        <div className="upload-cta">
          <div className="upload-cta__inner">
            <div className="upload-cta__icon" aria-hidden>🏋️</div>
            <h1>Upload a lift video</h1>
            <p>Pick an MP4 / MOV clip. Fit a square on a plate — the analysis does the rest.</p>
            <button
              type="button"
              className="upload-cta__button"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose video
            </button>
            <ul className="tips">
              <li>📐 Film <strong>side-on</strong> to the bar (within ~25°).</li>
              <li>📏 Phone at <strong>waist height</strong> (chest for overhead).</li>
              <li>🖼️ Keep the <strong>whole bar + plates</strong> in frame the entire set.</li>
              <li>💡 <strong>Well-lit</strong>, no glare into the lens.</li>
              <li>🟥 Tracking locks onto <strong>colour</strong> — a <strong>coloured bumper plate</strong> works best. For iron/silver plates, stick <strong>bright tape</strong> on the bar end and mark that.</li>
              <li>⚡ Fast lifts (cleans/snatches): use a <strong>high shutter speed</strong> (120–240 fps) to avoid motion blur.</li>
            </ul>
            {state.lastError && <p className="upload-cta__error">{state.lastError}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="live">
      <CameraView ref={videoRef} />
      <TrackingOverlay
        videoWidth={state.videoWidth}
        videoHeight={state.videoHeight}
        pathPoints={state.pathPoints}
        position={state.position}
        plateRadiusPx={state.plateRadiusPx}
        currentTime={state.currentTime}
      />

      <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={handleFilePick} />

      {analysing && (
        <div className="analyze-overlay">
          <div className="analyze-overlay__box">
            <div className="analyze-overlay__label">
              {state.analysisStatus === 'detecting' ? 'Tracking plate…' : 'Smoothing…'}
            </div>
            <div className="analyze-overlay__bar">
              <div
                className="analyze-overlay__fill"
                style={{ width: `${Math.round(state.analysisProgress * 100)}%` }}
              />
            </div>
            <div className="analyze-overlay__pct">
              {Math.round(state.analysisProgress * 100)}%
            </div>
          </div>
        </div>
      )}

      <div className="live__hud">
        <header className="live__top">
          <div className="live__top-left">
            <IconButton
              aria-label="Upload another video"
              onClick={() => fileInputRef.current?.click()}
            >
              📁
            </IconButton>
            <IconButton aria-label="Re-fit plate square" onClick={handleOpenPlatePicker}>
              📏
            </IconButton>
          </div>
          <div className="live__meta">
            <strong>{exerciseName}</strong>
            <span>
              {loadKg} kg · target {targetVelocity.toFixed(2)} m/s
            </span>
          </div>
          <div className="live__top-right">
            <IconButton aria-label="Debug" onClick={() => setShowDebug(true)}>
              ⚙️
            </IconButton>
          </div>
        </header>

        <div className="live__center">
          {state.notice && <p className="live__notice">{state.notice}</p>}
          {state.lastError && (
            <p className="live__notice live__notice--error">{state.lastError}</p>
          )}
          {done && (
            <>
              <div className={`velocity velocity--compact ${velocityClass}`}>
                {state.velocity.toFixed(2)}
              </div>
              <div className="velocity__label">m/s · at playhead</div>
              {state.detectionRate > 0 && (
                <div className="live__chips">
                  <span
                    className={`chip ${
                      state.detectionRate < 0.7
                        ? 'chip--bad'
                        : state.detectionRate < 0.9
                          ? 'chip--warn'
                          : 'chip--good'
                    }`}
                  >
                    track {Math.round(state.detectionRate * 100)}%
                  </span>
                  <span className="chip">peak {state.peakVelocity.toFixed(2)}</span>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="live__bottom">
          <PlaybackControls
            filename={state.filename}
            isPaused={state.isPaused}
            currentTime={state.currentTime}
            duration={state.duration}
            onTogglePlay={() => engine.togglePlay()}
            onRestart={() => engine.restart()}
            onSeek={(t) => engine.seek(t)}
          />
          {done && (
            <ResultsPanel
              metrics={state.metrics}
              chart={state.chart}
              repSpans={state.repSpans}
              duration={state.duration}
              currentTime={state.currentTime}
              targetVelocity={targetVelocity}
              saved={state.saved}
              onSeek={(t) => engine.seek(t)}
              onSave={handleSaveSet}
            />
          )}
        </footer>
      </div>

      <PlateSquareOverlay
        visible={showPlatePicker}
        videoWidth={state.videoWidth}
        videoHeight={state.videoHeight}
        currentTime={state.currentTime}
        duration={state.duration}
        onScrub={(t) => engine.seek(t)}
        onSave={handlePlateSave}
        onCancel={() => setShowPlatePicker(false)}
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
