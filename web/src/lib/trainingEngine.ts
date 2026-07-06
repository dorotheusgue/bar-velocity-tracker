import { loadVideoFile, type VideoFileHandle } from './videoFile';
import { drawVideoToContext, probeFrameRate, seekTo } from './frameWalker';
import { ColorBlobTracker } from './colorTracker';
import { buildTrajectory, type RawTrajectory } from './trajectory';
import {
  smoothTrajectory,
  replayReps,
  maxDownwardAccel,
  type SmoothedTrajectory,
  type SmoothingOptions,
} from './offlineKinematics';
import { CalibrationManager } from './calibration';
import { KinematicsEngine } from './kinematics';
import { RepDetector } from './repDetector';
import { MetricsEngine, type MetricsSnapshot } from './metrics';
import type { BarPosition, SetSummary } from '../types';

export type AnalysisStatus = 'idle' | 'detecting' | 'smoothing' | 'done';

export interface DetectorTuning {
  hueTolerance: number;
  satMin: number;
  minConfidence: number;
}

export interface PathPoint {
  x: number; // video pixels
  y: number;
  t: number; // video time (s)
}

export interface RepSpan {
  index: number;
  start: number; // video time (s)
  end: number;
}

export interface ChartSeries {
  t: number[];
  v: number[]; // m/s, up-positive
}

export interface TrainingState {
  hasVideo: boolean;
  needsPlate: boolean;
  analysisStatus: AnalysisStatus;
  analysisProgress: number; // 0..1
  velocity: number; // at current playback time (review)
  peakVelocity: number; // max over the whole trajectory
  repCount: number;
  phase: string;
  setRepCount: number;
  position: BarPosition | null; // overlay marker at current playback time
  plateRadiusPx: number;
  metrics: MetricsSnapshot;
  pathPoints: PathPoint[] | null; // smoothed bar path, video pixels
  chart: ChartSeries | null; // downsampled velocity series
  repSpans: RepSpan[];
  saved: boolean;
  notice: string | null;
  lastError: string | null;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  filename: string | null;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  detectionRate: number; // 0..1
  medianConfidence: number;
  dropAccel: number; // strongest downward accel (g-check)
}

/**
 * Upload-only, offline two-pass velocity analyzer (Metric-style
 * record-then-analyze):
 *
 *   Pass 1 (detect): walk every frame — fast sequential decode with seek
 *     backfill — locating the plate with the colour-blob tracker.
 *   Pass 2 (analyze): zero-phase Savitzky–Golay smoothing + derivative over
 *     the full trajectory, replayed into the existing rep detector + metrics.
 *
 * After analysis the engine exposes the full bar path, a velocity series with
 * per-rep spans, and per-playhead lookups for the review overlay.
 */
export class TrainingEngine {
  readonly calibration = new CalibrationManager();
  readonly kinematics: KinematicsEngine;
  readonly repDetector: RepDetector;
  readonly metrics = new MetricsEngine();

  private readonly ctx: CanvasRenderingContext2D;
  private detector: ColorBlobTracker | null = null;
  private raw: RawTrajectory | null = null;
  private smoothed: SmoothedTrajectory | null = null;

  private video: HTMLVideoElement | null = null;
  private file: VideoFileHandle | null = null;
  private videoListeners: Array<{ event: string; handler: EventListener }> = [];
  private analyzing = false;
  private abort: AbortController | null = null;

  private seedCenter: { x: number; y: number } | null = null;
  private seedTime = 0; // video time of the frame the plate was marked on
  private radiusPx = 0;
  private probedFps: number | null = null;

  private listeners = new Set<(s: TrainingState) => void>();

  exerciseName = 'Back Squat';
  loadKg = 0;
  targetVelocity = 0.6;

  detectorTuning: DetectorTuning = { hueTolerance: 18, satMin: 0.25, minConfidence: 0.35 };
  smoothing: Required<SmoothingOptions> = {
    polyOrder: 2,
    windowSeconds: 0.18,
    zuptVelocity: 0.02,
    zuptDuration: 0.15,
  };

  private state: TrainingState = {
    hasVideo: false,
    needsPlate: true,
    analysisStatus: 'idle',
    analysisProgress: 0,
    velocity: 0,
    peakVelocity: 0,
    repCount: 0,
    phase: 'idle',
    setRepCount: 0,
    position: null,
    plateRadiusPx: 0,
    metrics: this.metrics.snapshot(),
    pathPoints: null,
    chart: null,
    repSpans: [],
    saved: false,
    notice: null,
    lastError: null,
    videoWidth: 0,
    videoHeight: 0,
    fps: 30,
    filename: null,
    isPaused: true,
    currentTime: 0,
    duration: 0,
    detectionRate: 0,
    medianConfidence: 0,
    dropAccel: 0,
  };

  constructor() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;

    this.kinematics = new KinematicsEngine(this.calibration);
    this.repDetector = new RepDetector(this.kinematics);
    this.repDetector.onRep((rep) => this.metrics.append(rep));
  }

  // MARK: - Subscriptions

  subscribe(listener: (s: TrainingState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => void this.listeners.delete(listener);
  }

  getState(): TrainingState {
    return this.state;
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

    this.calibration.load({
      facing: 'environment',
      resolution: `${this.file.width}x${this.file.height}-file`,
    });
    this.probedFps = null;
    this.resetAnalysis();
    this.attachVideoListeners(video);

    this.update({
      hasVideo: true,
      needsPlate: true,
      analysisStatus: 'idle',
      analysisProgress: 0,
      filename: this.file.filename,
      videoWidth: this.file.width,
      videoHeight: this.file.height,
      isPaused: true,
      currentTime: 0,
      duration: this.file.duration,
      lastError: null,
      notice: 'Scrub to a clear frame, then fit the square on a plate.',
      position: null,
      pathPoints: null,
      chart: null,
      repSpans: [],
      saved: false,
      metrics: this.metrics.snapshot(),
    });
  }

  // MARK: - Plate selection (seed + calibrate, then analyze)

  /**
   * The user fits a square over the plate. `centerVideo` is its centre and
   * `radiusPx` half its side (= plate radius), in video pixels. The square
   * side maps to the plate diameter for scale; its interior is the colour
   * sample. The frame it was marked on is remembered so re-analyses re-seed
   * the colour from the *same* frame, not wherever the playhead happens to be.
   */
  selectPlate(centerVideo: { x: number; y: number }, radiusPx: number, diameterMeters: number) {
    if (!this.video) return;
    const edge = { x: centerVideo.x + radiusPx, y: centerVideo.y };
    this.calibration.calibrateFromPlate(centerVideo, edge, diameterMeters);
    this.radiusPx = Math.max(4, radiusPx);
    this.seedCenter = { x: centerVideo.x, y: centerVideo.y };
    this.seedTime = this.video.currentTime;

    this.detector = new ColorBlobTracker({
      radiusPx: this.radiusPx,
      hueTolerance: this.detectorTuning.hueTolerance,
      satMin: this.detectorTuning.satMin,
      minConfidence: this.detectorTuning.minConfidence,
    });
    drawVideoToContext(this.video, this.ctx);
    this.detector.seed(this.ctx, this.seedCenter);

    this.update({ needsPlate: false, plateRadiusPx: this.radiusPx });
    void this.analyze();
  }

  // MARK: - Analysis

  async analyze() {
    if (!this.video || !this.detector || !this.seedCenter || this.analyzing) return;
    this.analyzing = true;
    this.abort?.abort();
    this.abort = new AbortController();
    const signal = this.abort.signal;

    this.resetAnalysis();
    this.update({
      analysisStatus: 'detecting',
      analysisProgress: 0,
      notice: 'Analysing… tracking the plate through every frame.',
      metrics: this.metrics.snapshot(),
      setRepCount: 0,
      repCount: 0,
      saved: false,
    });

    try {
      const fps = this.probedFps ?? (await probeFrameRate(this.video));
      this.probedFps = fps;
      this.update({ fps });
      if (signal.aborted) return;

      // Re-seed the colour from the exact frame the user marked — the probe
      // and any prior analysis have moved the playhead since then.
      await seekTo(this.video, this.seedTime);
      drawVideoToContext(this.video, this.ctx);
      this.detector.reset();
      this.detector.seed(this.ctx, this.seedCenter);

      this.raw = await buildTrajectory(this.video, this.ctx, this.detector, {
        fps,
        radiusPx: this.radiusPx,
        seedCenter: this.seedCenter,
        onProgress: (frac) => this.update({ analysisProgress: frac }),
        signal,
      });
      if (signal.aborted) return;

      this.update({ analysisStatus: 'smoothing', notice: 'Analysing… smoothing trajectory.' });
      this.runPass2();

      // Return to the start for review with the overlay.
      this.video.currentTime = 0;
    } catch (e) {
      this.update({ lastError: String(e), analysisStatus: 'idle' });
    } finally {
      this.analyzing = false;
    }
  }

  /** Re-run only Pass 2 (smoothing) from the cached raw trajectory. */
  reanalyze() {
    if (!this.raw) return;
    this.runPass2();
  }

  private runPass2() {
    if (!this.raw) return;
    this.kinematics.reset();
    this.repDetector.reset();
    this.metrics.clear();

    this.smoothed = smoothTrajectory(this.raw, this.calibration, this.smoothing);
    replayReps(this.smoothed, this.kinematics);

    const peak = this.smoothed.velocity.reduce((m, v) => Math.max(m, v), 0);
    const detectionRate = this.smoothed.detectionRate;

    // Bar path in video pixels from the smoothed (zero-phase) trajectory,
    // downsampled for rendering. Invert the px→m mapping used in Pass 2.
    const mpp = this.calibration.metersPerPixel ?? 0;
    const total = this.smoothed.t.length;
    const step = Math.max(1, Math.ceil(total / 600));
    const pathPoints: PathPoint[] = [];
    const chartT: number[] = [];
    const chartV: number[] = [];
    for (let i = 0; i < total; i += step) {
      if (mpp > 0) {
        pathPoints.push({
          x: this.smoothed.xMeters[i] / mpp,
          y: -this.smoothed.yMeters[i] / mpp,
          t: this.smoothed.t[i],
        });
      }
      chartT.push(this.smoothed.t[i]);
      chartV.push(this.smoothed.velocity[i]);
    }

    const repSpans: RepSpan[] = this.metrics.reps
      .filter((r) => r.videoStart != null && r.videoEnd != null)
      .map((r) => ({ index: r.index, start: r.videoStart!, end: r.videoEnd! }));

    this.update({
      analysisStatus: 'done',
      analysisProgress: 1,
      peakVelocity: peak,
      repCount: this.repDetector.repCount,
      setRepCount: this.metrics.reps.length,
      phase: this.repDetector.phase,
      metrics: this.metrics.snapshot(),
      pathPoints: pathPoints.length > 1 ? pathPoints : null,
      chart: chartT.length > 1 ? { t: chartT, v: chartV } : null,
      repSpans,
      saved: false,
      detectionRate,
      medianConfidence: this.smoothed.medianConfidence,
      dropAccel: maxDownwardAccel(this.smoothed),
      notice: this.qualityNotice(detectionRate, peak),
    });
    this.overlayLookup(this.video?.currentTime ?? 0);
  }

  private qualityNotice(detectionRate: number, peak: number): string | null {
    const achromaticHint =
      this.detector?.isAchromatic && detectionRate < 0.9
        ? ' This plate has no distinct colour — bright tape on the bar end tracks far better.'
        : '';
    if (detectionRate < 0.7) {
      return (
        'Tracking was patchy — the plate may be blurred or leaving frame.' +
        achromaticHint +
        ' Record side-on, well-lit, high shutter speed for fast lifts.'
      );
    }
    if (this.repDetector.repCount === 0) {
      return 'No reps detected. Re-fit the square (📏) or check the clip shows a full rep.';
    }
    if (peak > 2.0 && this.smoothed && this.smoothed.medianConfidence < 0.45) {
      return 'Fast lift with weak tracking — a higher camera shutter speed (less motion blur) will improve accuracy.';
    }
    if (achromaticHint) return achromaticHint.trim();
    return null;
  }

  // MARK: - Tuning

  applyDetectorTuning(t: Partial<DetectorTuning>) {
    this.detectorTuning = { ...this.detectorTuning, ...t };
    if (this.detector) {
      this.detector.setHueTolerance(this.detectorTuning.hueTolerance);
      this.detector.setSatMin(this.detectorTuning.satMin);
      this.detector.setMinConfidence(this.detectorTuning.minConfidence);
    }
  }

  applySmoothing(s: Partial<SmoothingOptions>) {
    this.smoothing = { ...this.smoothing, ...s };
    // Smoothing is Pass 2 only — re-run instantly from the cached trajectory.
    if (this.raw && this.state.analysisStatus === 'done') this.reanalyze();
  }

  // MARK: - Playback (review only — no detection here)

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
  }

  // MARK: - Saving

  /**
   * Build a SetSummary from the current metrics without clearing them, so the
   * results stay on screen after saving. Returns null when there is nothing
   * to save.
   */
  saveSet(): SetSummary | null {
    const snap = this.metrics.snapshot();
    if (snap.reps.length === 0) return null;
    const summary: SetSummary = {
      id: crypto.randomUUID(),
      reps: snap.reps,
      velocityLossPercent: snap.velocityLossPercent,
      averageMCV: snap.averageMCV,
      averagePeak: snap.averagePeak,
      bestRepId: snap.bestRepId,
      startedAt: snap.reps[0].timestamp,
      endedAt: Date.now(),
      exerciseName: this.exerciseName,
      loadKg: this.loadKg,
      targetVelocity: this.targetVelocity,
    };
    this.update({ saved: true });
    return summary;
  }

  // MARK: - Video listeners (UI sync + review overlay)

  private attachVideoListeners(video: HTMLVideoElement) {
    this.detachVideoListeners();
    const sync = () => {
      if (this.analyzing) return; // analysis drives its own seeks/playback
      this.overlayLookup(video.currentTime);
      this.update({
        isPaused: video.paused,
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : this.state.duration,
      });
    };
    const events = ['play', 'pause', 'timeupdate', 'seeked', 'durationchange', 'ended'];
    for (const event of events) {
      video.addEventListener(event, sync);
      this.videoListeners.push({ event, handler: sync });
    }
  }

  private detachVideoListeners() {
    if (!this.video) return;
    for (const { event, handler } of this.videoListeners) {
      this.video.removeEventListener(event, handler);
    }
    this.videoListeners = [];
  }

  /** Look up the nearest trajectory sample to `time` for the overlay + readout. */
  private overlayLookup(time: number) {
    if (!this.smoothed || !this.raw) return;
    const { t, velocity } = this.smoothed;
    if (t.length === 0) return;
    let i = Math.round(time * this.smoothed.fps);
    if (i < 0) i = 0;
    if (i >= t.length) i = t.length - 1;

    const pt = this.raw.points[i];
    const W = this.raw.videoWidth || 1;
    const H = this.raw.videoHeight || 1;
    const r = this.raw.radiusPx;
    let position: BarPosition | null = null;
    if (pt && Number.isFinite(pt.xPx)) {
      position = {
        timestamp: t[i],
        xPixel: pt.xPx,
        yPixel: pt.yPx,
        confidence: pt.confidence,
        boundingBox: {
          x: (pt.xPx - r) / W,
          y: (pt.yPx - r) / H,
          width: (2 * r) / W,
          height: (2 * r) / H,
        },
      };
    }
    this.update({ position, velocity: velocity[i] });
  }

  // MARK: - Internals

  private resetAnalysis() {
    this.kinematics.reset();
    this.repDetector.reset();
    this.metrics.clear();
    this.smoothed = null;
    this.raw = null;
  }

  private disposeSource() {
    this.abort?.abort();
    this.analyzing = false;
    this.detachVideoListeners();
    this.file?.dispose();
    this.file = null;
    this.detector = null;
    this.seedCenter = null;
  }

  private rafScheduled = false;
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
