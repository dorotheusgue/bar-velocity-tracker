import { loadVideoFile, type VideoFileHandle } from './videoFile';
import { drawVideoToContext, probeFrameRate } from './frameWalker';
import { KnownRadiusCircleDetector } from './circleDetector';
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
import type { BarPosition, Rep, SetSummary } from '../types';

export type AnalysisStatus = 'idle' | 'detecting' | 'smoothing' | 'done';

export interface DetectorTuning {
  gradThreshold: number;
  minConfidence: number;
  colorTol: number;
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
  position: BarPosition | null; // overlay box at current playback time
  metrics: MetricsSnapshot;
  notice: string | null;
  lastError: string | null;
  videoWidth: number;
  videoHeight: number;
  fps: number;
  filename: string | null;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  detectionRate: number; // 0..1, drives the motion-blur warning
  medianConfidence: number;
  dropAccel: number; // strongest downward accel (g-check)
}

/**
 * Upload-only, offline two-pass velocity analyzer.
 *
 *   Pass 1 (detect): walk every frame deterministically, locate the plate with
 *     a known-radius circle detector, accumulate a raw pixel trajectory.
 *   Pass 2 (analyze): zero-phase Savitzky–Golay smoothing + derivative over the
 *     full trajectory, then replay into the existing rep detector + metrics.
 *
 * No real-time loop, no causal filtering, no dropped frames → no lag, no peak
 * clipping, and the same clip yields the same numbers every run.
 */
export class TrainingEngine {
  readonly calibration = new CalibrationManager();
  readonly kinematics: KinematicsEngine;
  readonly repDetector: RepDetector;
  readonly metrics = new MetricsEngine();

  private readonly ctx: CanvasRenderingContext2D;
  private detector: KnownRadiusCircleDetector | null = null;
  private raw: RawTrajectory | null = null;
  private smoothed: SmoothedTrajectory | null = null;

  private video: HTMLVideoElement | null = null;
  private file: VideoFileHandle | null = null;
  private videoListeners: Array<{ event: string; handler: EventListener }> = [];
  private analyzing = false;
  private abort: AbortController | null = null;

  private seedCenter: { x: number; y: number } | null = null;
  private radiusPx = 0;

  private listeners = new Set<(s: TrainingState) => void>();
  private repListeners = new Set<(r: Rep) => void>();
  private summaryListeners = new Set<(s: SetSummary) => void>();

  exerciseName = 'Back Squat';
  loadKg = 0;
  targetVelocity = 0.6;

  // Tuning (persisted by the UI; applied on (re)analyze).
  detectorTuning: DetectorTuning = { gradThreshold: 40, minConfidence: 0.3, colorTol: 0.25 };
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
    metrics: this.metrics.snapshot(),
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

    this.repDetector.onRep((rep) => {
      this.metrics.append(rep);
      for (const l of this.repListeners) l(rep);
    });
    this.metrics.onSetSummary((s) => {
      for (const l of this.summaryListeners) l(s);
    });
  }

  // MARK: - Subscriptions

  subscribe(listener: (s: TrainingState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => void this.listeners.delete(listener);
  }
  onRep(listener: (r: Rep) => void): () => void {
    this.repListeners.add(listener);
    return () => void this.repListeners.delete(listener);
  }
  onSetSummary(listener: (s: SetSummary) => void): () => void {
    this.summaryListeners.add(listener);
    return () => void this.summaryListeners.delete(listener);
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
      notice: 'Mark a plate to start.',
      position: null,
      metrics: this.metrics.snapshot(),
    });
  }

  unloadFile() {
    this.disposeSource();
    this.resetAnalysis();
    this.update({
      hasVideo: false,
      needsPlate: true,
      analysisStatus: 'idle',
      analysisProgress: 0,
      filename: null,
      videoWidth: 0,
      videoHeight: 0,
      isPaused: true,
      currentTime: 0,
      duration: 0,
      position: null,
      velocity: 0,
      notice: null,
    });
  }

  // MARK: - Plate selection (seed + calibrate, then analyze)

  selectPlate(
    centerVideo: { x: number; y: number },
    edgeVideo: { x: number; y: number },
    diameterMeters: number
  ) {
    if (!this.video) return;
    this.calibration.calibrateFromPlate(centerVideo, edgeVideo, diameterMeters);
    const dx = centerVideo.x - edgeVideo.x;
    const dy = centerVideo.y - edgeVideo.y;
    this.radiusPx = Math.sqrt(dx * dx + dy * dy);
    this.seedCenter = { x: centerVideo.x, y: centerVideo.y };

    this.detector = new KnownRadiusCircleDetector({
      radiusPx: this.radiusPx,
      gradThreshold: this.detectorTuning.gradThreshold,
      minConfidence: this.detectorTuning.minConfidence,
      colorTol: this.detectorTuning.colorTol,
    });
    // Seed colour from the frame the user marked.
    drawVideoToContext(this.video, this.ctx);
    this.detector.seed(this.ctx, this.seedCenter);

    this.update({ needsPlate: false });
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
    this.detector.reset();
    drawVideoToContext(this.video, this.ctx);
    this.detector.seed(this.ctx, this.seedCenter);

    this.update({
      analysisStatus: 'detecting',
      analysisProgress: 0,
      notice: 'Analysing… detecting the plate in every frame.',
      metrics: this.metrics.snapshot(),
      setRepCount: 0,
      repCount: 0,
    });

    try {
      const fps = await probeFrameRate(this.video);
      this.update({ fps });

      this.raw = await buildTrajectory(this.video, this.ctx, this.detector, {
        fps,
        radiusPx: this.radiusPx,
        seedCenter: this.seedCenter,
        onProgress: (frac) => this.update({ analysisProgress: frac }),
        signal,
      });
      if (signal.aborted) {
        this.analyzing = false;
        return;
      }

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
    // Reset the downstream chain, then replay the freshly smoothed stream.
    this.kinematics.reset();
    this.repDetector.reset();
    this.metrics.clear();

    this.smoothed = smoothTrajectory(this.raw, this.calibration, this.smoothing);
    replayReps(this.smoothed, this.kinematics);

    const peak = this.smoothed.velocity.reduce((m, v) => Math.max(m, v), 0);
    const detectionRate = this.smoothed.detectionRate;
    const notice = this.qualityNotice(detectionRate, peak);

    this.update({
      analysisStatus: 'done',
      analysisProgress: 1,
      peakVelocity: peak,
      repCount: this.repDetector.repCount,
      setRepCount: this.metrics.reps.length,
      phase: this.repDetector.phase,
      metrics: this.metrics.snapshot(),
      detectionRate,
      medianConfidence: this.smoothed.medianConfidence,
      dropAccel: maxDownwardAccel(this.smoothed),
      notice,
    });
    this.overlayLookup(this.video?.currentTime ?? 0);
  }

  private qualityNotice(detectionRate: number, peak: number): string | null {
    if (detectionRate < 0.7) {
      return 'Tracking was patchy — the plate may be blurred or leaving frame. Record side-on, well-lit, and use a higher shutter speed for fast lifts.';
    }
    if (peak > 2.0 && this.smoothed && this.smoothed.medianConfidence < 0.45) {
      return 'Fast lift with weak tracking — a higher camera shutter speed (less motion blur) will improve accuracy.';
    }
    if (this.repDetector.repCount === 0) {
      return 'No reps detected. Re-pick the plate (📏) or check the clip shows a full rep.';
    }
    return null;
  }

  // MARK: - Tuning

  applyDetectorTuning(t: Partial<DetectorTuning>) {
    this.detectorTuning = { ...this.detectorTuning, ...t };
    if (this.detector) {
      this.detector.setGradThreshold(this.detectorTuning.gradThreshold);
      this.detector.setMinConfidence(this.detectorTuning.minConfidence);
      this.detector.setColorTol(this.detectorTuning.colorTol);
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

  // MARK: - Set lifecycle

  endSet(): SetSummary | null {
    const summary = this.metrics.endSet({
      exerciseName: this.exerciseName,
      loadKg: this.loadKg,
      targetVelocity: this.targetVelocity,
    });
    if (summary) {
      if (this.video && !this.video.paused) this.video.pause();
      this.update({
        setRepCount: 0,
        repCount: this.repDetector.repCount,
        metrics: this.metrics.snapshot(),
      });
    }
    return summary;
  }

  // MARK: - Video listeners (UI sync + review overlay)

  private attachVideoListeners(video: HTMLVideoElement) {
    this.detachVideoListeners();
    const sync = () => {
      if (this.analyzing) return; // analysis drives its own seeks
      this.overlayLookup(video.currentTime);
      this.update({
        isPaused: video.paused,
        currentTime: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : this.state.duration,
      });
    };
    const pairs: Array<[string, EventListener]> = [
      ['play', sync],
      ['pause', sync],
      ['timeupdate', sync],
      ['seeked', sync],
      ['durationchange', sync],
      ['ended', sync],
    ];
    for (const [event, handler] of pairs) {
      video.addEventListener(event, handler);
      this.videoListeners.push({ event, handler });
    }
  }

  private detachVideoListeners() {
    if (!this.video) return;
    for (const { event, handler } of this.videoListeners) {
      this.video.removeEventListener(event, handler);
    }
    this.videoListeners = [];
  }

  /** Look up the nearest trajectory sample to `time` and set the overlay box + velocity. */
  private overlayLookup(time: number) {
    if (!this.smoothed || !this.raw) return;
    const { t, velocity } = this.smoothed;
    if (t.length === 0) return;
    // Nearest sample (uniform spacing → direct index).
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
