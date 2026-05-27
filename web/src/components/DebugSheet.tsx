import { useEffect, useState } from 'react';
import type { TrainingEngine } from '../lib/trainingEngine';
import type { TrainingState } from '../lib/trainingEngine';

interface Props {
  open: boolean;
  onClose: () => void;
  engine: TrainingEngine;
  state: TrainingState;
  exerciseName: string;
  loadKg: number;
  targetVelocity: number;
  onExerciseChange: (name: string) => void;
  onLoadChange: (kg: number) => void;
  onTargetVelocityChange: (v: number) => void;
}

interface Tuning {
  processNoise: number;
  measurementNoise: number;
  zuptVelocityThreshold: number;
  zuptDuration: number;
  trackerMinConfidence: number;
  trackerColorWeight: number;
}

const TUNING_KEY = 'bvt.tuning.v3';

function loadTuning(): Tuning {
  const raw = localStorage.getItem(TUNING_KEY);
  if (raw) {
    try {
      return { ...defaultTuning(), ...(JSON.parse(raw) as Partial<Tuning>) };
    } catch {
      /* ignore */
    }
  }
  return defaultTuning();
}

function defaultTuning(): Tuning {
  return {
    processNoise: 0.1,
    measurementNoise: 5.0,
    zuptVelocityThreshold: 0.02,
    zuptDuration: 0.15,
    trackerMinConfidence: 0.55,
    trackerColorWeight: 2.5,
  };
}

export default function DebugSheet(props: Props) {
  const { open, onClose, engine, state } = props;
  const [tuning, setTuning] = useState<Tuning>(() => loadTuning());

  useEffect(() => {
    engine.applyTuning(tuning);
    localStorage.setItem(TUNING_KEY, JSON.stringify(tuning));
  }, [engine, tuning]);

  if (!open) return null;

  return (
    <div className="sheet" role="dialog" aria-modal="true">
      <header className="sheet__header">
        <h2>Debug</h2>
        <button type="button" onClick={onClose}>
          Done
        </button>
      </header>

      <section>
        <h3>Set</h3>
        <div className="sheet__row">
          <label htmlFor="exercise">Exercise</label>
          <input
            id="exercise"
            type="text"
            value={props.exerciseName}
            onChange={(e) => props.onExerciseChange(e.target.value)}
          />
        </div>
        <div className="sheet__row">
          <label htmlFor="load">Load</label>
          <input
            id="load"
            type="number"
            min={0}
            step={2.5}
            value={props.loadKg}
            onChange={(e) => props.onLoadChange(parseFloat(e.target.value) || 0)}
          />
          <span className="sheet__unit">kg</span>
        </div>
        <Slider
          label="Target velocity"
          value={props.targetVelocity}
          min={0.1}
          max={1.5}
          step={0.05}
          format={(v) => `${v.toFixed(2)} m/s`}
          onChange={props.onTargetVelocityChange}
        />
      </section>

      <section>
        <h3>Kalman filter</h3>
        <Slider
          label="Process noise (q)"
          value={tuning.processNoise}
          min={0.01}
          max={1}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={(v) => setTuning({ ...tuning, processNoise: v })}
        />
        <Slider
          label="Measurement noise (r)"
          value={tuning.measurementNoise}
          min={0.5}
          max={20}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => setTuning({ ...tuning, measurementNoise: v })}
        />
        <div className="presets">
          <button
            type="button"
            onClick={() => setTuning({ ...tuning, processNoise: 0.05, measurementNoise: 8 })}
          >
            Powerlifting
          </button>
          <button
            type="button"
            onClick={() => setTuning({ ...tuning, processNoise: 0.5, measurementNoise: 3 })}
          >
            Olympic
          </button>
          <button
            type="button"
            onClick={() => setTuning({ ...tuning, processNoise: 0.1, measurementNoise: 5 })}
          >
            Default
          </button>
        </div>
      </section>

      <section>
        <h3>ZUPT</h3>
        <Slider
          label="Velocity threshold"
          value={tuning.zuptVelocityThreshold}
          min={0.005}
          max={0.1}
          step={0.005}
          format={(v) => `${v.toFixed(3)} m/s`}
          onChange={(v) => setTuning({ ...tuning, zuptVelocityThreshold: v })}
        />
        <Slider
          label="Quiet duration"
          value={tuning.zuptDuration}
          min={0.05}
          max={0.5}
          step={0.025}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(v) => setTuning({ ...tuning, zuptDuration: v })}
        />
      </section>

      <section>
        <h3>Detection</h3>
        <div className="row">
          <span>Mode</span>
          <span className="row__value">{state.visionMode}</span>
        </div>
        <div className="presets">
          <button
            type="button"
            onClick={() => void engine.setVisionMode('template')}
            disabled={state.visionMode === 'template'}
          >
            Tap to track
          </button>
          <button
            type="button"
            onClick={() => void engine.setVisionMode('coco-ssd')}
            disabled={state.visionMode === 'coco-ssd'}
          >
            Auto (downloads ~6 MB)
          </button>
        </div>
        {state.visionMode === 'coco-ssd' && !state.isModelReady && (
          <p className="row" style={{ color: 'var(--text-dim)' }}>
            Loading TensorFlow.js…
          </p>
        )}
        {state.visionMode === 'template' && (
          <>
            <Slider
              label="Min confidence"
              value={tuning.trackerMinConfidence}
              min={0.3}
              max={0.9}
              step={0.05}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => setTuning({ ...tuning, trackerMinConfidence: v })}
            />
            <Slider
              label="Colour weight"
              value={tuning.trackerColorWeight}
              min={0}
              max={5}
              step={0.25}
              format={(v) => (v === 0 ? 'off (grayscale only)' : `${v.toFixed(2)}×`)}
              onChange={(v) => setTuning({ ...tuning, trackerColorWeight: v })}
            />
          </>
        )}
      </section>

      <section>
        <h3>Live</h3>
        <Row label="Velocity" value={`${state.velocity.toFixed(3)} m/s`} />
        <Row label="Phase" value={state.phase} />
        <Row label="Tracking" value={state.isTracking ? 'yes' : 'no'} />
        <Row label="Detection" value={state.detection?.label ?? '—'} />
        <Row
          label="Confidence"
          value={state.detection ? `${(state.detection.confidence * 100).toFixed(0)}%` : '—'}
        />
        <Row label="FPS" value={state.fps.toFixed(1)} />
        <Row label="Video" value={`${state.videoWidth}×${state.videoHeight}`} />
      </section>
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="slider">
      <div className="slider__row">
        <span>{props.label}</span>
        <span className="slider__value">{props.format(props.value)}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span className="row__value">{value}</span>
    </div>
  );
}
