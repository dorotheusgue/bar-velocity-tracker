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

export type VisionMode = 'template' | 'coco-ssd';

export interface TrainingState {
  hasVideo: boolean;
  isModelReady: boolean;
  isTracking: boolean;
  needsTrackingPoint: boolean;
  velocity: number;
  repCount: number;
  phase: string;
  setRepCount: number;
  detection: BarDetection | null;
  position: BarPosition | null;
  metrics: MetricsSnapshot;
  notice: string | null;
  lastError: string | null;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  visionMode: VisionMode;
  filename: string | null;
  isPaused: boolean;
  currentTime: number;
  duration: number;
}

const NO_BAR_WARNING_FRAMES = 25;
const SEEK_JUMP_SECONDS = 0.5;

/**
 * Upload-only velocity tracking engine. The user loads a video, marks a plate
 * (calibrate + seed tracker in one), and presses play. Per-frame processing
 * is driven by `requestVideoFrameCallback` so it only runs while the video
 * advances — paused = zero CPU. UI sync happens via `play`/`pause`/`timeupdate`
 * /`seeked` listeners on the video, not an always-on RAF loop.
 */
export class TrainingEngine {
  readonly calibration = new CalibrationManager();
  readonly tracker = new BarTracker();
  readonly kinematics: KinematicsEngine;
  readonly repDetector: RepDetector;
  readonly metrics = new MetricsEngine();

  private readonly ctx: CanvasRenderingContext2D;
  private vision: VisionPipeline;

  private video: HTMLVideoElement | null = null;
  private file: VideoFileHandle | null = null;
  private rvfcHandle: number | null = null;
  private videoListeners: Array<{ event: string; handler: EventListener }> = [];
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
    hasVideo: false,
    isModelReady: true,
    isTracking: false,
    needsTrackingPoint: true,
    velocity: 0,
    repCount: 0,
    phase: 'idle',
    setRepCount: 0,
    detection: null,
    position: null,
    metrics: this.metrics.snapshot(),
    notice: null,
    lastError: null,
    videoWidth: 0,
    videoHeight: 0,
    fps: 0,
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
      this.update({ visionMode: 'coco-ssd', needsTrackingPoint: false, isModelReady: false });
      try {
        await this.vision.ready;
        this.update({ isModelReady: true });
      } catch (e) {
        this.update({ lastError: `Model load failed: ${e}` });
      }
    } else {
      this.vision = new TemplateTrackerPipeline();
      this.update({ visionMode: 'template', needsTrackingPoint: true, isModelReady: true });
    }
    this.resetAnalysis();
  }

  setTrackingPoint(videoX: number, videoY: number): boolean {
    if (!this.video || !this.vision.setTrackingPoint) return false;
    drawVideoToContext(this.video, this.ctx);
    const ok = this.vision.setTrackingPoint({ x: videoX, y: videoY }, this.ctx);
    if (ok) {
      this.update({ needsTrackingPoint: false, notice: null });
      this.framesSinceDetection = 0;
    }
    return ok;
  }

  selectPlate(
    centerVideo: { x: number; y: number },
    edgeVideo: { x: number; y: number },
    diameterMeters: number
  ): boolean {
    this.calibration.calibrateFromPlate(centerVideo, edgeVideo, diameterMeters);
    return this.setTrackingPoint(centerVideo.x, centerVideo.y);
  }

  // MARK: - File loading

  async loadFile(video: HTMLVideoElement, file: File) {
    this.disposeSource();
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
    this.attachVideoListeners(video);

    this.update({
      hasVideo: true,
      filename: this.file.filename,
      videoWidth: this.file.width,
      videoHeight: this.file.height,
      isPaused: true,
      currentTime: 0,
      duration: this.file.duration,
      lastError: null,
      needsTrackingPoint: this.state.visionMode === 'template',
      notice: this.computeNotice(),
    });

    this.fpsWindowStart = performance.now();
    this.framesProcessed = 0;
    this.lastProcessedTime = -1;
    this.scheduleRvfc();
  }

  unloadFile() {
    this.disposeSource();
    this.resetAnalysis();
    this.update({
      hasVideo: false,
      filename: null,
      videoWidth: 0,
      videoHeight: 0,
      isPaused: true,
      currentTime: 0,
      duration: 0,
      detection: null,
      position: null,
      velocity: 0,
      notice: null,
    });
  }

  // MARK: - Playback

  togglePlay() {
    const v = this.video;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      void v.play().catch((e) => this.update({ lastError: `Play failed: ${e}` }));
    } else {
      v.pause();
    }
  }

  seek(time: number) {
    const v = this.video;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(time, this.state.duration || time));
  }

  restart() {
    const v = this.video;
    if (!v) return;
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
      if (this.video && !this.video.paused) this.video.pause();
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
      notice: 'Tap a plate to start tracking.',
    });
  }

  // MARK: - Video event listeners (replaces RAF UI poller)

  private attachVideoListeners(video: HTMLVideoElement) {
    this.detachVideoListeners();
    const syncPlayback = () => {
      this.update({
        isPaused: video.paused,
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : this.state.duration,
      });
    };
    const onPlay = () => syncPlayback();
    const onPause = () => syncPlayback();
    const onTimeUpdate = () => syncPlayback();
    const onSeeked = () => {
      this.resetKinematicsOnly();
      syncPlayback();
    };
    const onDurationChange = () => syncPlayback();
    const onEnded = () => syncPlayback();

    const pairs: Array<[string, EventListener]> = [
      ['play', onPlay],
      ['pause', onPause],
      ['timeupdate', onTimeUpdate],
      ['seeked', onSeeked],
      ['durationchange', onDurationChange],
      ['ended', onEnded],
    ];
    for (const [event, handler] of pairs) {
      video.addEventListener(event, handler);
      this.videoListeners.push({ event, handler });
    }
  }

  private detachVideoListeners() {
    if (!this.video || this.videoListeners.length === 0) return;
    for (const { event, handler } of this.videoListeners) {
      this.video.removeEventListener(event, handler);
    }
    this.videoListeners = [];
  }

  // MARK: - rVFC frame processing

  private scheduleRvfc() {
    const video = this.video as unknown as {
      requestVideoFrameCallback?: (
        cb: (now: number, metadata: { mediaTime?: number }) => void
      ) => number;
    } | null;
    if (!video?.requestVideoFrameCallback) return;
    this.rvfcHandle = video.requestVideoFrameCallback((_now, metadata) => {
      this.rvfcHandle = null;
      if (!this.video) return;
      // Re-arm immediately so frames presented during processing aren't lost.
      this.scheduleRvfc();
      const t = metadata.mediaTime ?? this.video.currentTime;
      void this.onVideoFrame(t);
    });
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

  private async onVideoFrame(t: number) {
    if (this.detecting) return;
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
        notice: this.computeNotice(),
        fps,
        needsTrackingPoint: lostTrack ? true : this.state.needsTrackingPoint,
      });

      if (lostTrack) this.vision.reset();
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

  private disposeSource() {
    this.cancelRvfc();
    this.detachVideoListeners();
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
