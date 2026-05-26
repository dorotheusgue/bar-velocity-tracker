import type { BarDetection } from '../types';
import { TemplateTracker, type TemplatePoint } from './templateTracker';

/**
 * Unified vision interface. Two implementations:
 *
 *   - TemplateTrackerPipeline (default): user taps the bar, classical NCC
 *     tracks it. No model, no network, runs in plain JS.
 *
 *   - CocoSsdPipeline (optional, lazy-loaded): generic 80-class object
 *     detector via TF.js. ~6 MB of weights, but no tap-to-init required.
 */
export interface VisionPipeline {
  readonly kind: 'template' | 'coco-ssd';
  ready: Promise<void>;
  isInitialized: boolean;
  /** Required for tap-to-init trackers. No-op on stateless detectors. */
  setTrackingPoint?(point: TemplatePoint, ctx: CanvasRenderingContext2D): boolean;
  /** Per-frame inference. Returns null if nothing was found. */
  detect(
    video: HTMLVideoElement,
    timestamp: number,
    ctx: CanvasRenderingContext2D
  ): Promise<BarDetection | null>;
  reset(): void;
  dispose?(): void;
}

// -------- Template tracker pipeline (default) ---------------------------

export class TemplateTrackerPipeline implements VisionPipeline {
  readonly kind = 'template';
  ready: Promise<void> = Promise.resolve();
  private tracker = new TemplateTracker();

  get isInitialized(): boolean {
    return this.tracker.isInitialized;
  }

  /** Forwarded to the underlying tracker so the debug sheet can tune it. */
  setMinConfidence(value: number) {
    this.tracker.minConfidence = value;
  }

  get minConfidence(): number {
    return this.tracker.minConfidence;
  }

  setTrackingPoint(point: TemplatePoint, ctx: CanvasRenderingContext2D): boolean {
    return this.tracker.initialize(ctx, point);
  }

  async detect(
    video: HTMLVideoElement,
    timestamp: number,
    ctx: CanvasRenderingContext2D
  ): Promise<BarDetection | null> {
    if (video.readyState < 2) return null;
    if (!this.tracker.isInitialized) return null;

    drawVideoToContext(video, ctx);
    const result = this.tracker.track(ctx);
    if (!result) return null;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    return {
      boundingBox: {
        x: result.boundingBox.x / w,
        y: result.boundingBox.y / h,
        width: result.boundingBox.width / w,
        height: result.boundingBox.height / h,
      },
      timestamp,
      confidence: result.confidence,
      source: 'rectangles',
      label: 'bar',
    };
  }

  reset() {
    this.tracker.reset();
  }
}

// -------- COCO-SSD pipeline (optional, lazy-loaded) ---------------------

/**
 * Loaded on demand. The import() calls are intentionally lazy so the main
 * bundle doesn't pull in TF.js.
 */
export class CocoSsdPipeline implements VisionPipeline {
  readonly kind = 'coco-ssd';
  ready: Promise<void>;
  isInitialized = false;

  // Use `unknown` to avoid pulling type dependencies into the main bundle.
  private model: unknown = null;
  private minConfidence = 0.35;
  private preferredClasses = new Set([
    'sports ball',
    'baseball bat',
    'frisbee',
    'tennis racket',
    'skateboard',
    'surfboard',
  ]);

  constructor() {
    this.ready = this.load();
  }

  private async load() {
    const tf = await import('@tensorflow/tfjs');
    await import('@tensorflow/tfjs-backend-webgl');
    const cocoSsd = await import('@tensorflow-models/coco-ssd');
    await tf.setBackend('webgl');
    await tf.ready();
    this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    this.isInitialized = true;
  }

  async detect(
    video: HTMLVideoElement,
    timestamp: number,
    _ctx: CanvasRenderingContext2D
  ): Promise<BarDetection | null> {
    if (!this.model || video.readyState < 2) return null;
    const model = this.model as {
      detect: (
        v: HTMLVideoElement,
        max?: number,
        thresh?: number
      ) => Promise<Array<{ bbox: [number, number, number, number]; class: string; score: number }>>;
    };

    const predictions = await model.detect(video, 10, 0.25);
    if (predictions.length === 0) return null;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return null;

    let best: { p: (typeof predictions)[number]; score: number } | null = null;
    for (const p of predictions) {
      const [, , bw, bh] = p.bbox;
      if (bw === 0 || bh === 0) continue;
      const aspect = bw / bh;
      const aspectScore = aspect >= 1 ? Math.min(aspect / 4, 1) : 0.2;
      const classBonus = this.preferredClasses.has(p.class) ? 0.4 : 0;
      const score = p.score * (aspectScore + classBonus);
      if (!best || score > best.score) best = { p, score };
    }

    if (!best || best.p.score < this.minConfidence) return null;
    const [x, y, bw, bh] = best.p.bbox;
    return {
      boundingBox: { x: x / w, y: y / h, width: bw / w, height: bh / h },
      timestamp,
      confidence: best.p.score,
      source: 'coco-ssd',
      label: best.p.class,
    };
  }

  reset() {}

  dispose() {
    this.model = null;
  }
}

// -------- shared drawing helper -----------------------------------------

export function drawVideoToContext(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D
) {
  if (video.videoWidth === 0) return;
  // Resize the canvas if the video dimensions have changed.
  if (ctx.canvas.width !== video.videoWidth || ctx.canvas.height !== video.videoHeight) {
    ctx.canvas.width = video.videoWidth;
    ctx.canvas.height = video.videoHeight;
  }
  ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
}
