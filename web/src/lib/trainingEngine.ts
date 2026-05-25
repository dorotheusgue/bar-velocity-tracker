import { startCamera, type CameraHandle } from './camera';
import { CocoSsdBarDetector, type BarDetector } from './detector';
import { BarTracker } from './barTracker';
import { CalibrationManager } from './calibration';
import { KinematicsEngine } from './kinematics';
import { RepDetector } from './repDetector';
import { MetricsEngine, type MetricsSnapshot } from './metrics';
import type { BarDetection, BarPosition, Rep, SetSummary } from '../types';

export interface TrainingState {
  isCameraReady: boolean;
  isModelReady: boolean;
  isTracking: boolean;
  isRunning: boolean;
  velocity: number;
  repCount: number;
  phase: string;
  setRepCount: number;
  detection: BarDetection | null;
  position: BarPosition | null;
  metrics: MetricsSnapshot;
  cameraNotice: string | null;
  lastError: string | null;
  facingMode: 'user' | 'environment';
  cameraWidth: number;
  cameraHeight: number;
  fps: number;
}

const NO_BAR_WARNING_FRAMES = 60;

/**
 * Owns the camera + detection loop and the per-frame data flow:
 *   frame → detector → tracker → kinematics → rep detector → metrics
 *
 * Exposes a state snapshot the React layer can re-render off, plus event
 * callbacks for transient things (new rep, set complete). Survives React
 * re-renders by living in a ref.
 */
export class TrainingEngine {
  readonly calibration = new CalibrationManager();
  readonly tracker = new BarTracker();
  readonly kinematics: KinematicsEngine;
  readonly repDetector: RepDetector;
  readonly metrics = new MetricsEngine();
  readonly detector: BarDetector;

  private video: HTMLVideoElement | null = null;
  private camera: CameraHandle | null = null;
  private loopId: number | null = null;
  private detecting = false;
  private framesSinceDetection = 0;
  private framesProcessed = 0;
  private fpsWindowStart = 0;

  private listeners: Set<(state: TrainingState) => void> = new Set();
  private repListeners: Set<(rep: Rep) => void> = new Set();
  private summaryListeners: Set<(s: SetSummary) => void> = new Set();

  // App-level tuning that the UI binds to.
  exerciseName = 'Back Squat';
  loadKg = 0;
  targetVelocity = 0.6;

  private state: TrainingState = {
    isCameraReady: false,
    isModelReady: false,
    isTracking: false,
    isRunning: false,
    velocity: 0,
    repCount: 0,
    phase: 'idle',
    setRepCount: 0,
    detection: null,
    position: null,
    metrics: this.metrics.snapshot(),
    cameraNotice: null,
    lastError: null,
    facingMode: 'environment',
    cameraWidth: 0,
    cameraHeight: 0,
    fps: 0,
  };

  constructor() {
    this.detector = new CocoSsdBarDetector();
    this.kinematics = new KinematicsEngine(this.calibration);
    this.repDetector = new RepDetector(this.kinematics);

    this.detector.ready
      .then(() => this.update({ isModelReady: true }))
      .catch((e) => this.update({ lastError: `Model load failed: ${e}` }));

    this.repDetector.onRep((rep) => {
      this.metrics.append(rep);
      this.update({
        setRepCount: this.metrics.reps.length,
        repCount: this.repDetector.repCount,
        phase: this.repDetector.phase,
        metrics: this.metrics.snapshot(),
      });
      for (const l of this.repListeners) l(rep);
    });

    this.metrics.onSetSummary((s) => {
      for (const l of this.summaryListeners) l(s);
    });
  }

  subscribe(listener: (state: TrainingState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onRep(listener: (rep: Rep) => void): () => void {
    this.repListeners.add(listener);
    return () => {
      this.repListeners.delete(listener);
    };
  }

  onSetSummary(listener: (s: SetSummary) => void): () => void {
    this.summaryListeners.add(listener);
    return () => {
      this.summaryListeners.delete(listener);
    };
  }

  getState(): TrainingState {
    return this.state;
  }

  async start(video: HTMLVideoElement, facingMode: 'user' | 'environment' = 'environment') {
    if (this.state.isRunning) return;
    this.video = video;
    try {
      this.camera = await startCamera(video, { facingMode });
    } catch (e) {
      this.update({ lastError: `Camera permission denied: ${e}` });
      return;
    }
    this.tracker.frameWidth = this.camera.width;
    this.tracker.frameHeight = this.camera.height;
    const resolution = `${this.camera.width}x${this.camera.height}`;
    this.calibration.load({ facing: this.camera.facingMode, resolution });

    this.update({
      isCameraReady: true,
      isRunning: true,
      facingMode: this.camera.facingMode,
      cameraWidth: this.camera.width,
      cameraHeight: this.camera.height,
    });

    this.fpsWindowStart = performance.now();
    this.framesProcessed = 0;
    this.loop();
  }

  stop() {
    if (this.loopId != null) {
      cancelAnimationFrame(this.loopId);
      this.loopId = null;
    }
    this.camera?.stop();
    this.camera = null;
    this.update({ isRunning: false, isCameraReady: false });
  }

  async toggleCamera() {
    if (!this.video) return;
    const nextFacing = this.state.facingMode === 'environment' ? 'user' : 'environment';
    this.stop();
    await this.start(this.video, nextFacing);
  }

  endSet(): SetSummary | null {
    const summary = this.metrics.endSet({
      exerciseName: this.exerciseName,
      loadKg: this.loadKg,
      targetVelocity: this.targetVelocity,
    });
    if (summary) {
      this.repDetector.reset();
      this.kinematics.reset();
      this.tracker.reset();
      this.update({
        setRepCount: 0,
        repCount: this.repDetector.repCount,
        phase: this.repDetector.phase,
        velocity: 0,
        metrics: this.metrics.snapshot(),
      });
    }
    return summary;
  }

  applyTuning(opts: {
    processNoise?: number;
    measurementNoise?: number;
    zuptVelocityThreshold?: number;
    zuptDuration?: number;
  }) {
    if (opts.processNoise != null) this.tracker.processNoise = opts.processNoise;
    if (opts.measurementNoise != null) this.tracker.measurementNoise = opts.measurementNoise;
    if (opts.zuptVelocityThreshold != null)
      this.kinematics.zuptVelocityThreshold = opts.zuptVelocityThreshold;
    if (opts.zuptDuration != null) this.kinematics.zuptDuration = opts.zuptDuration;
  }

  // MARK: - Frame loop

  private loop = () => {
    this.loopId = requestAnimationFrame(this.loop);
    if (!this.video || !this.state.isRunning) return;
    if (this.detecting) return; // single-flight per frame

    void this.processFrame();
  };

  private async processFrame() {
    if (!this.video) return;
    this.detecting = true;
    const t = performance.now() / 1000;
    try {
      const detection = await this.detector.detect(this.video, t);
      const position = this.tracker.ingest(detection);
      if (position) this.kinematics.ingest(position);

      // Trigger React updates with the latest state.
      this.framesProcessed += 1;
      const elapsed = (performance.now() - this.fpsWindowStart) / 1000;
      let fps = this.state.fps;
      if (elapsed >= 1) {
        fps = this.framesProcessed / elapsed;
        this.framesProcessed = 0;
        this.fpsWindowStart = performance.now();
      }

      if (detection) {
        this.framesSinceDetection = 0;
      } else {
        this.framesSinceDetection += 1;
      }

      const notice = this.computeCameraNotice();
      this.update({
        detection,
        position,
        velocity: this.kinematics.currentVelocity,
        isTracking: this.tracker.isTracking,
        phase: this.repDetector.phase,
        repCount: this.repDetector.repCount,
        cameraNotice: notice,
        fps,
      });
    } catch (e) {
      this.update({ lastError: String(e) });
    } finally {
      this.detecting = false;
    }
  }

  private computeCameraNotice(): string | null {
    if (this.framesSinceDetection > NO_BAR_WARNING_FRAMES) {
      return this.calibration.metersPerPixel == null
        ? 'Tap the ruler to calibrate before lifting.'
        : 'Bar not visible — re-calibrate if the angle changed.';
    }
    if (this.calibration.metersPerPixel == null) {
      return 'Tap the ruler to calibrate.';
    }
    return null;
  }

  private update(patch: Partial<TrainingState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}
