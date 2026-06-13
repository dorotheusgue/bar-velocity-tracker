import { useEffect, useState } from 'react';
import type { TrainingEngine, TrainingState } from '../lib/trainingEngine';

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
  hueTolerance: number;
  satMin: number;
  minConfidence: number;
  windowSeconds: number;
  polyOrder: number;
  zuptVelocity: number;
  zuptDuration: number;
}

const TUNING_KEY = 'bvt.tuning.v5';

function defaultTuning(): Tuning {
  return {
    hueTolerance: 18,
    satMin: 0.25,
    minConfidence: 0.35,
    windowSeconds: 0.18,
    polyOrder: 2,
    zuptVelocity: 0.02,
    zuptDuration: 0.15,
  };
}

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

export default function DebugSheet(props: Props) {
  const { open, onClose, engine, state } = props;
  const [tuning, setTuning] = useState<Tuning>(() => loadTuning());

  // Detector knobs apply to the next analyze; smoothing knobs re-run Pass 2 instantly.
  useEffect(() => {
    engine.applyDetectorTuning({
      hueTolerance: tuning.hueTolerance,
      satMin: tuning.satMin,
      minConfidence: tuning.minConfidence,
    });
    engine.applySmoothing({
      windowSeconds: tuning.windowSeconds,
      polyOrder: tuning.polyOrder,
      zuptVelocity: tuning.zuptVelocity,
      zuptDuration: tuning.zuptDuration,
    });
    localStorage.setItem(TUNING_KEY, JSON.stringify(tuning));
  }, [engine, tuning]);

  if (!open) return null;

  const gOk = state.dropAccel > 7 && state.dropAccel < 13;

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
        <h3>Colour tracker (applies on re-analyse)</h3>
        <Slider
          label="Hue tolerance"
          value={tuning.hueTolerance}
          min={5}
          max={60}
          step={1}
          format={(v) => `${v.toFixed(0)}°`}
          onChange={(v) => setTuning({ ...tuning, hueTolerance: v })}
        />
        <Slider
          label="Saturation min"
          value={tuning.satMin}
          min={0.05}
          max={0.7}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => setTuning({ ...tuning, satMin: v })}
        />
        <Slider
          label="Min confidence"
          value={tuning.minConfidence}
          min={0.1}
          max={0.8}
          step={0.05}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => setTuning({ ...tuning, minConfidence: v })}
        />
        <button
          type="button"
          className="reanalyze"
          onClick={() => void engine.analyze()}
          disabled={!state.hasVideo || state.needsPlate}
        >
          Re-analyse video
        </button>
      </section>

      <section>
        <h3>Smoothing (instant)</h3>
        <Slider
          label="Window"
          value={tuning.windowSeconds}
          min={0.06}
          max={0.4}
          step={0.02}
          format={(v) => `${(v * 1000).toFixed(0)} ms`}
          onChange={(v) => setTuning({ ...tuning, windowSeconds: v })}
        />
        <Slider
          label="Polynomial order"
          value={tuning.polyOrder}
          min={2}
          max={4}
          step={1}
          format={(v) => v.toFixed(0)}
          onChange={(v) => setTuning({ ...tuning, polyOrder: v })}
        />
        <Slider
          label="ZUPT velocity"
          value={tuning.zuptVelocity}
          min={0.005}
          max={0.1}
          step={0.005}
          format={(v) => `${v.toFixed(3)} m/s`}
          onChange={(v) => setTuning({ ...tuning, zuptVelocity: v })}
        />
        <Slider
          label="ZUPT quiet time"
          value={tuning.zuptDuration}
          min={0.05}
          max={0.5}
          step={0.025}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(v) => setTuning({ ...tuning, zuptDuration: v })}
        />
      </section>

      <section>
        <h3>Analysis</h3>
        <Row label="Status" value={state.analysisStatus} />
        <Row label="Velocity @ playhead" value={`${state.velocity.toFixed(3)} m/s`} />
        <Row label="Peak velocity" value={`${state.peakVelocity.toFixed(3)} m/s`} />
        <Row label="Reps" value={String(state.setRepCount)} />
        <Row label="Track rate" value={`${Math.round(state.detectionRate * 100)}%`} />
        <Row label="Median conf." value={`${Math.round(state.medianConfidence * 100)}%`} />
        <Row
          label="Max drop accel"
          value={`${state.dropAccel.toFixed(1)} m/s²${gOk ? ' ✓≈g' : ''}`}
        />
        <Row label="FPS" value={state.fps.toFixed(0)} />
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
