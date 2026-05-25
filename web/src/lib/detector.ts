import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import type { BarDetection } from '../types';

/**
 * BarDetector interface — any implementation that can produce a barbell-ish
 * bounding box per frame. Phase 1 web ships a COCO-SSD adapter; a custom
 * YOLOv8 model exported to TF.js can drop in by implementing this interface.
 */
export interface BarDetector {
  ready: Promise<void>;
  detect(video: HTMLVideoElement, timestamp: number): Promise<BarDetection | null>;
  dispose?: () => void;
}

/**
 * COCO-SSD picks up generic objects in the frame; it cannot label a barbell
 * specifically, so we look at a handful of classes that visually overlap
 * (plates ≈ "sports ball", the bar ≈ "baseball bat" from some angles) and
 * prefer the most confident wide-aspect candidate. Train a real barbell
 * detector and ship a TFJSGraphModelDetector for real-world accuracy.
 */
export class CocoSsdBarDetector implements BarDetector {
  ready: Promise<void>;
  private model: cocoSsd.ObjectDetection | null = null;
  private readonly minConfidence: number;
  private readonly preferredClasses: ReadonlySet<string>;

  constructor(opts?: { minConfidence?: number; preferredClasses?: string[] }) {
    this.minConfidence = opts?.minConfidence ?? 0.35;
    this.preferredClasses = new Set(
      opts?.preferredClasses ?? [
        'sports ball',
        'baseball bat',
        'frisbee',
        'tennis racket',
        'skateboard',
        'surfboard',
      ]
    );
    this.ready = this.load();
  }

  private async load() {
    await tf.setBackend('webgl');
    await tf.ready();
    this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  }

  async detect(
    video: HTMLVideoElement,
    timestamp: number
  ): Promise<BarDetection | null> {
    if (!this.model || video.readyState < 2) return null;

    const predictions = await this.model.detect(video, 10, 0.25);
    if (predictions.length === 0) return null;

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) return null;

    // Prefer high-confidence preferred-class detections, then any wide object.
    const scored = predictions
      .map((p) => ({
        prediction: p,
        score: this.scoreCandidate(p, w, h),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.prediction.score < this.minConfidence) return null;

    const [x, y, bw, bh] = best.prediction.bbox;
    return {
      boundingBox: { x: x / w, y: y / h, width: bw / w, height: bh / h },
      timestamp,
      confidence: best.prediction.score,
      source: 'coco-ssd',
      label: best.prediction.class,
    };
  }

  private scoreCandidate(
    prediction: cocoSsd.DetectedObject,
    _w: number,
    _h: number
  ): number {
    const [, , bw, bh] = prediction.bbox;
    if (bw === 0 || bh === 0) return 0;
    const aspect = bw / bh;
    // Bars are wide. Reward aspect > 1, penalise tall objects.
    const aspectScore = aspect >= 1 ? Math.min(aspect / 4, 1) : 0.2;
    const classBonus = this.preferredClasses.has(prediction.class) ? 0.4 : 0;
    return prediction.score * (aspectScore + classBonus);
  }

  dispose() {
    this.model = null;
  }
}
