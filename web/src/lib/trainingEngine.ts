import { startCamera, type CameraHandle } from './camera';
import { loadVideoFile, type VideoFileHandle } from './videoFile';
import {
  TemplateTrackerPipeline,
  CocoSsdPipeline,
  drawVideoToContext,
  type VisionPipeline,
} from './vision';
import { BarTracker } from './barTracker';
import { CalibrationManager } from './calibration';
import { KinematicsEngine } from './kinematics';
import { RepDetector } from './repDetector';
import { MetricsEngine, type MetricsSnapshot } from './metrics';
import type { BarDetection, BarPosition, Rep, SetSummary } from '../types';

export type MediaMode = 'live' | 'file';
export type VisionMode = 'template' | 'coco-ssd';

export interface TrainingState {
  isCameraReady: boolean;
  isModelReady: boolean;
  isTracking: boolean;
  isRunning: boolean;
  needsTrackingPoint: boolean;
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
  visionMode: VisionMode;
  filename: string | null;
  isPaused: boolean;
  currentTime: number;
  duration: number;
}

const NO_BAR_WARNING_FRAMES = 25;
const SEEK_JUMP_SECONDS = 0.5;

/**
 * Owns the camera/file pipeline and the per-frame loop:
 *   frame → vision pipeline → tracker → kinematics → rep detector → metrics
 *
 * Default vision = tap-to-init template tracker (no model download). Optional
 * COCO-SSD pipeline can be loaded on demand for fully-automatic detection.
 */
export class TrainingEngine {
  readonly calibration = new CalibrationManager();
  readonly tracker = new BarTracker();
  readonly kinematics: KinematicsEngine;
  readonly repDetector: RepDetector;
  readonly metrics = new MetricsEngine();

  /** Offscreen 2D context that the vision pipeline reads pixels from. */
  private readonly ctx: CanvasRenderingContext2D;
  private vision: VisionPipeline;

  private video: HTMLVideoElement | null = null;
  private camera: CameraHandle | null = null;
  private file: VideoFileHandle | null = null;
  private loopId: number | null = null;
  private rvfcHandle: number | null = null;
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
    isModelReady: true, // template tracker has no model to load
    isTracking: false,
    isRunning: false,
    needsTrackingPoint: true,
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
    visionMode: 'template',
    filename: null,
    isPaused: true,
    currentTime: 0,
    duration: 0,
  };

  constructor() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;

    this.vision = new TemplateTrackerPipeline();
    this.kinematics = new KinematicsEngine(this.calibration);
    this.repDetector = new RepDetector(this.kinematics);

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

  // MARK: - Vision pipeline switching

  async setVisionMode(mode: VisionMode) {
    if (mode === this.state.visionMode) return;
    this.vision.dispose?.();
    if (mode === 'coco-ssd') {
      this.vision = new CocoSsdPipeline();
      this.update({
        visionMode: 'coco-ssd',
        needsTrackingPoint: false,
        isModelReady: false,
      });
      try {
        await this.vision.ready;
        this.update({ isModelReady: true });
      } catch (e) {
        this.update({ lastError: `Model load failed: ${e}` });
      }
    } else {
      this.vision = new TemplateTrackerPipeline();
      this.update({
        visionMode: 'template',
        needsTrackingPoint: true,
        isModelReady: true,
      });
    }
    this.resetAnalysis();
  }

  /**
   * Seed the template tracker with a tap point. Coordinates are in *video*
   * pixel space (post-resolution, not DOM). Called by the UI after mapping
   * the DOM tap location into the underlying video frame.
   */
  setTrackingPoint(videoX: number, videoY: number): boolean {
    if (!this.video || !this.vision.setTrackingPoint) return false;
    drawVideoToContext(this.video, this.ctx);
    const ok = this.vision.setTrackingPoint({ x: videoX, y: videoY }, this.ctx);
    if (ok) {
      this.update({ needsTrackingPoint: false, cameraNotice: null });
      this.framesSinceDetection = 0;
    }
    return ok;
  }

  /**
   * RepSpeed-style single action: the user marks a plate (centre + edge) and
   * sets its known diameter. That call simultaneously calibrates the m/px
   * scale (from the plate's known diameter) and seeds the tracker template
   * at the plate's centre. One tap-and-drag, no separate calibration step.
   */
  selectPlate(
    centerVideo: { x: number; y: number },
    edgeVideo: { x: number; y: number },
    diameterMeters: number
  ): boolean {
    this.calibration.calibrateFromPlate(centerVideo, edgeVideo, diameterMeters);
    return this.setTrackingPoint(centerVideo.x, centerVideo.y);
  }

  // MARK: - Source switching

  async start(video: HTMLVideoElement, facingMode: 'user' | 'environment' = 'environment') {
    this.cancelRvfc();
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
      needsTrackingPoint: this.state.visionMode === 'template',
      cameraNotice: this.computeNotice(),
    });

    this.runLoop();
  }

  async loadFile(video: HTMLVideoElement, file: File) {
    this.cancelRvfc();
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
      needsTrackingPoint: this.state.visionMode === 'template',
      cameraNotice: this.computeNotice(),
    });

    this.runLoop();
  }

  stop() {
    if (this.loopId != null) {
      cancelAnimationFrame(this.loopId);
      this.loopId = null;
    }
    this.cancelRvfc();
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
      // Pause file playback so the video doesn't keep advancing while the
      // tracker is idle waiting for a fresh tap.
      if (this.state.mediaMode === 'file' && this.video && !this.video.paused) {
        this.video.pause();
      }
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
    trackerMinConfidence?: number;
    trackerColorWeight?: number;
  }) {
    if (opts.processNoise != null) this.tracker.processNoise = opts.processNoise;
    if (opts.measurementNoise != null) this.tracker.measurementNoise = opts.measurementNoise;
    if (opts.zuptVelocityThreshold != null)
      this.kinematics.zuptVelocityThreshold = opts.zuptVelocityThreshold;
    if (opts.zuptDuration != null) this.kinematics.zuptDuration = opts.zuptDuration;
    if (this.vision.kind === 'template') {
      const v = this.vision as TemplateTrackerPipeline;
      if (opts.trackerMinConfidence != null) v.setMinConfidence(opts.trackerMinConfidence);
      if (opts.trackerColorWeight != null) v.setColorWeight(opts.trackerColorWeight);
    }
  }

  /**
   * Drop the current template and ask the UI to prompt for a new tap point.
   * Called from the 🎯 button so users can recover from drift without waiting
   * for the lost-track timeout.
   */
  retapToTrack() {
    if (this.vision.kind !== 'template') return;
    this.vision.reset();
    this.tracker.reset();
    this.kinematics.reset();
    this.repDetector.reset();
    this.framesSinceDetection = 0;
    this.lastProcessedTime = -1;
    this.update({
      needsTrackingPoint: true,
      detection: null,
      position: null,
      velocity: 0,
      cameraNotice: 'Tap a plate or the bar to start tracking.',
    });
  }

  // MARK: - Frame loop

  private runLoop() {
    this.fpsWindowStart = performance.now();
    this.framesProcessed = 0;
    this.lastProcessedTime = -1;

    // For files in browsers that support it, use requestVideoFrameCallback so
    // each real video frame gets exactly one processing pass with its real
    // frame timestamp. This is the difference between "deterministic across
    // runs" and "RAF happened to land at slightly different times this time".
    const supportsRvfc =
      this.state.mediaMode === 'file' &&
      this.video != null &&
      'requestVideoFrameCallback' in this.video;
    if (supportsRvfc) {
      this.scheduleRvfc();
    }
    // RAF still runs for live mode, and as the UI-state poller for files
    // (paused/currentTime/duration updates that rVFC won't fire while paused).
    if (this.loopId == null) this.loop();
  }

  private cancelRvfc() {
    if (this.rvfcHandle != null && this.video != null) {
      const cancel = (this.video as unknown as {
        cancelVideoFrameCallback?: (h: number) => void;
      }).cancelVideoFrameCallback;
      cancel?.call(this.video, this.rvfcHandle);
      this.rvfcHandle = null;
    }
  }

  private scheduleRvfc() {
    const video = this.video as unknown as {
      requestVideoFrameCallback?: (
        cb: (now: number, metadata: { mediaTime?: number }) => void
      ) => number;
    };
    if (!video.requestVideoFrameCallback) return;
    this.rvfcHandle = video.requestVideoFrameCallback((_now, metadata) => {
      this.rvfcHandle = null;
      if (!this.video || !this.state.isRunning || this.state.mediaMode !== 'file') return;
      // Re-arm immediately so frames presented during processing aren't lost.
      this.scheduleRvfc();
      const t = metadata.mediaTime ?? this.video.currentTime;
      void this.onVideoFrame(t);
    });
  }

  private async onVideoFrame(t: number) {
    if (this.detecting) return; // previous frame's processing still in flight
    if (this.state.needsTrackingPoint) return;
    if (t === this.lastProcessedTime) return;
    if (
      this.lastProcessedTime >= 0 &&
      (t < this.lastProcessedTime || t - this.lastProcessedTime > SEEK_JUMP_SECONDS)
    ) {
      this.resetKinematicsOnly();
    }
    await this.processFrame(t);
  }

  private loop = () => {
    this.loopId = requestAnimationFrame(this.loop);
    if (!this.video || !this.state.isRunning) return;

    const v = this.video;
    const t = v.currentTime;
    const fileMode = this.state.mediaMode === 'file';

    if (fileMode) {
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
    }

    // If we're driving file processing via rVFC, the RAF loop is just a UI
    // poller — don't double-process frames.
    if (fileMode && this.rvfcHandle != null) return;

    if (fileMode &&
        this.lastProcessedTime >= 0 &&
        (t < this.lastProcessedTime || t - this.lastProcessedTime > SEEK_JUMP_SECONDS)
    ) {
      this.resetKinematicsOnly();
    }

    if (this.detecting) return;
    if (t === this.lastProcessedTime) return;
    if (this.state.needsTrackingPoint) return; // waiting for user tap
    void this.processFrame(t);
  };

  private async processFrame(t: number) {
    if (!this.video) return;
    this.detecting = true;
    this.lastProcessedTime = t;
    try {
      drawVideoToContext(this.video, this.ctx);
      const detection = await this.vision.detect(this.video, t, this.ctx);
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

      const lostTrack =
        this.framesSinceDetection > NO_BAR_WARNING_FRAMES &&
        this.state.visionMode === 'template' &&
        !this.state.needsTrackingPoint;

      this.update({
        detection,
        position,
        velocity: this.kinematics.currentVelocity,
        isTracking: this.tracker.isTracking,
        phase: this.repDetector.phase,
        repCount: this.repDetector.repCount,
        cameraNotice: this.computeNotice(),
        fps,
        needsTrackingPoint: lostTrack ? true : this.state.needsTrackingPoint,
      });

      if (lostTrack) {
        this.vision.reset();
      }
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
    this.vision.reset();
    this.framesSinceDetection = 0;
    this.lastProcessedTime = -1;
    this.update({ needsTrackingPoint: this.state.visionMode === 'template' });
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
    if (this.state.visionMode === 'template' && this.state.needsTrackingPoint) {
      return 'Tap a plate, drag to its edge — that calibrates and starts tracking.';
    }
    if (this.framesSinceDetection > NO_BAR_WARNING_FRAMES) {
      return 'Lost the plate — tap 📏 to re-pick it.';
    }
    if (this.calibration.metersPerPixel == null) {
      return 'Tap 📏 to select a plate.';
    }
    return null;
  }

  private rafScheduled = false;

  /**
   * Coalesces all state mutations within a single animation frame into one
   * listener notification. Without this, a fast detect→tracker→kinematics→rep
   * cycle could trigger React renders 60+ times per second from several
   * different code paths in the same frame.
   */
  private update(patch: Partial<TrainingState>) {
    this.state = { ...this.state, ...patch };
    if (this.rafScheduled) return;
    this.rafScheduled = true;
    requestAnimationFrame(() => {
      this.rafScheduled = false;
      for (const l of this.listeners) l(this.state);
    });
  }
}
