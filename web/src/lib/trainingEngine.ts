import { startCamera, type CameraHandle } from './camera';
import { loadVideoFile, type VideoFileHandle } from './videoFile';
import { CocoSsdBarDetector, type BarDetector } from './detector';
import { BarTracker } from './barTracker';
import { CalibrationManager } from './calibration';
import { KinematicsEngine } from './kinematics';
import { RepDetector } from './repDetector';
import { MetricsEngine, type MetricsSnapshot } from './metrics';
import type { BarDetection, BarPosition, Rep, SetSummary } from '../types';

export type MediaMode = 'live' | 'file';

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
  mediaMode: MediaMode;
  filename: string | null;
  isPaused: boolean;
  currentTime: number;
  duration: number;
}

const NO_BAR_WARNING_FRAMES = 60;
const SEEK_JUMP_SECONDS = 0.5;

/**
 * Owns the camera/file + detection loop and the per-frame data flow:
 *   frame → detector → tracker → kinematics → rep detector → metrics
 *
 * The same loop drives both live camera streams and uploaded video files —
 * we just swap which `MediaStream`/object-URL is backing the <video> and
 * use `video.currentTime` as the per-frame timestamp so velocities stay
 * correct regardless of playback speed.
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
  private file: VideoFileHandle | null = null;
  private loopId: number | null = null;
  private detecting = false;
  private framesSinceDetection = 0;
  private framesProcessed = 0;
  private fpsWindowStart = 0;
  private lastProcessedTime = -1;

  private listeners: Set<(state: TrainingState) => void> = new Set();
  private repListeners: Set<(rep: Rep) => void> = new Set();
  private summaryListeners: Set<(s: SetSummary) => void> = new Set();

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
    mediaMode: 'live',
    filename: null,
    isPaused: true,
    currentTime: 0,
    duration: 0,
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

  // MARK: - Subscriptions

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

  // MARK: - Source switching

  async start(video: HTMLVideoElement, facingMode: 'user' | 'environment' = 'environment') {
    this.disposeSources();
    this.video = video;
    try {
      this.camera = await startCamera(video, { facingMode });
    } catch (e) {
      this.update({ lastError: `Camera permission denied: ${e}` });
      return;
    }
    this.tracker.frameWidth = this.camera.width;
    this.tracker.frameHeight = this.camera.height;
    this.calibration.load({
      facing: this.camera.facingMode,
      resolution: `${this.camera.width}x${this.camera.height}`,
    });
    this.resetAnalysis();

    this.update({
      isCameraReady: true,
      isRunning: true,
      mediaMode: 'live',
      filename: null,
      facingMode: this.camera.facingMode,
      cameraWidth: this.camera.width,
      cameraHeight: this.camera.height,
      isPaused: false,
      currentTime: 0,
      duration: 0,
      lastError: null,
    });

    this.runLoop();
  }

  async loadFile(video: HTMLVideoElement, file: File) {
    this.disposeSources();
    this.video = video;
    try {
      this.file = await loadVideoFile(video, file);
    } catch (e) {
      this.update({ lastError: String((e as Error).message ?? e) });
      return;
    }

    this.tracker.frameWidth = this.file.width;
    this.tracker.frameHeight = this.file.height;
    this.calibration.load({
      facing: 'environment',
      resolution: `${this.file.width}x${this.file.height}-file`,
    });
    this.resetAnalysis();

    this.update({
      isCameraReady: true,
      isRunning: true,
      mediaMode: 'file',
      filename: this.file.filename,
      facingMode: 'environment',
      cameraWidth: this.file.width,
      cameraHeight: this.file.height,
      isPaused: true,
      currentTime: 0,
      duration: this.file.duration,
      lastError: null,
      cameraNotice: this.calibration.metersPerPixel == null
        ? 'Calibrate (📏) then press play.'
        : null,
    });

    this.runLoop();
  }

  stop() {
    if (this.loopId != null) {
      cancelAnimationFrame(this.loopId);
      this.loopId = null;
    }
    this.disposeSources();
    this.update({
      isRunning: false,
      isCameraReady: false,
      isPaused: true,
      filename: null,
      currentTime: 0,
      duration: 0,
    });
  }

  async toggleCamera() {
    if (!this.video) return;
    const nextFacing = this.state.facingMode === 'environment' ? 'user' : 'environment';
    await this.start(this.video, nextFacing);
  }

  // MARK: - Playback (file mode)

  togglePlay() {
    const v = this.video;
    if (!v || this.state.mediaMode !== 'file') return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      void v.play().catch((e) => this.update({ lastError: `Play failed: ${e}` }));
    } else {
      v.pause();
    }
  }

  seek(time: number) {
    const v = this.video;
    if (!v || this.state.mediaMode !== 'file') return;
    v.currentTime = Math.max(0, Math.min(time, this.state.duration || time));
  }

  restart() {
    const v = this.video;
    if (!v || this.state.mediaMode !== 'file') return;
    v.currentTime = 0;
    this.resetAnalysis();
  }

  // MARK: - Set lifecycle / tuning

  endSet(): SetSummary | null {
    const summary = this.metrics.endSet({
      exerciseName: this.exerciseName,
      loadKg: this.loadKg,
      targetVelocity: this.targetVelocity,
    });
    if (summary) {
      this.resetAnalysis();
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

  private runLoop() {
    this.fpsWindowStart = performance.now();
    this.framesProcessed = 0;
    this.lastProcessedTime = -1;
    if (this.loopId == null) this.loop();
  }

  private loop = () => {
    this.loopId = requestAnimationFrame(this.loop);
    if (!this.video || !this.state.isRunning) return;

    const v = this.video;
    const t = v.currentTime;

    // Reflect playback state so the UI's play/pause/scrub UI tracks the video.
    if (this.state.mediaMode === 'file') {
      if (
        v.paused !== this.state.isPaused ||
        Math.abs(t - this.state.currentTime) > 0.03 ||
        (v.duration && v.duration !== this.state.duration)
      ) {
        this.update({
          isPaused: v.paused,
          currentTime: t,
          duration: Number.isFinite(v.duration) ? v.duration : this.state.duration,
        });
      }

      // Seek detection — large jumps invalidate kinematics state.
      if (
        this.lastProcessedTime >= 0 &&
        (t < this.lastProcessedTime || t - this.lastProcessedTime > SEEK_JUMP_SECONDS)
      ) {
        this.resetKinematicsOnly();
      }
    }

    if (this.detecting) return;
    if (t === this.lastProcessedTime) return; // no new frame to process
    void this.processFrame(t);
  };

  private async processFrame(t: number) {
    if (!this.video) return;
    this.detecting = true;
    this.lastProcessedTime = t;
    try {
      const detection = await this.detector.detect(this.video, t);
      const position = this.tracker.ingest(detection);
      if (position) this.kinematics.ingest(position);

      this.framesProcessed += 1;
      const elapsed = (performance.now() - this.fpsWindowStart) / 1000;
      let fps = this.state.fps;
      if (elapsed >= 1) {
        fps = this.framesProcessed / elapsed;
        this.framesProcessed = 0;
        this.fpsWindowStart = performance.now();
      }

      if (detection) this.framesSinceDetection = 0;
      else this.framesSinceDetection += 1;

      this.update({
        detection,
        position,
        velocity: this.kinematics.currentVelocity,
        isTracking: this.tracker.isTracking,
        phase: this.repDetector.phase,
        repCount: this.repDetector.repCount,
        cameraNotice: this.computeNotice(),
        fps,
      });
    } catch (e) {
      this.update({ lastError: String(e) });
    } finally {
      this.detecting = false;
    }
  }

  // MARK: - Internals

  private resetAnalysis() {
    this.tracker.reset();
    this.kinematics.reset();
    this.repDetector.reset();
    this.framesSinceDetection = 0;
    this.lastProcessedTime = -1;
  }

  private resetKinematicsOnly() {
    this.tracker.reset();
    this.kinematics.reset();
    this.repDetector.reset();
    this.framesSinceDetection = 0;
  }

  private disposeSources() {
    this.camera?.stop();
    this.camera = null;
    this.file?.dispose();
    this.file = null;
  }

  private computeNotice(): string | null {
    if (this.state.mediaMode === 'file' && this.calibration.metersPerPixel == null) {
      return 'Calibrate (📏) then press play.';
    }
    if (this.framesSinceDetection > NO_BAR_WARNING_FRAMES) {
      return this.calibration.metersPerPixel == null
        ? 'Tap 📏 to calibrate before lifting.'
        : 'Bar not visible — re-calibrate if the angle changed.';
    }
    if (this.calibration.metersPerPixel == null) {
      return 'Tap 📏 to calibrate.';
    }
    return null;
  }

  private update(patch: Partial<TrainingState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}
