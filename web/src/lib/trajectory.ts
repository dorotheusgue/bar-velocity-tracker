import { walkVideo, type FrameSample } from './frameWalker';
import { ColorBlobTracker } from './colorTracker';

/** One detected sample. `confidence` 0 means no detection that frame. */
export interface TrajectoryPoint {
  t: number; // uniform video time (s)
  xPx: number; // top-left origin; NaN on a miss
  yPx: number;
  confidence: number;
}

export interface RawTrajectory {
  fps: number;
  videoWidth: number;
  videoHeight: number;
  radiusPx: number;
  points: TrajectoryPoint[]; // dense, one per stepped frame, in order
}

export interface BuildOptions {
  fps: number;
  radiusPx: number;
  seedCenter: { x: number; y: number };
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Pass 1: walk every frame and detect the plate, producing a dense raw
 * trajectory. The search window each frame is centred on a constant-velocity
 * prediction from the last two accepted detections (dense frames ⇒ a linear
 * guess is plenty; the smoothing in Pass 2 does the real work).
 */
export async function buildTrajectory(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  detector: ColorBlobTracker,
  opts: BuildOptions
): Promise<RawTrajectory> {
  const points: TrajectoryPoint[] = [];

  let prev: { x: number; y: number } | null = null;
  let prev2: { x: number; y: number } | null = null;

  const onFrame = (s: FrameSample, c: CanvasRenderingContext2D) => {
    // Predict: linear extrapolation from the last two accepted centres.
    let predicted: { x: number; y: number };
    if (prev && prev2) {
      predicted = { x: 2 * prev.x - prev2.x, y: 2 * prev.y - prev2.y };
    } else if (prev) {
      predicted = prev;
    } else {
      predicted = opts.seedCenter;
    }

    const hit = detector.detect(c, predicted);
    if (hit) {
      points.push({ t: s.t, xPx: hit.x, yPx: hit.y, confidence: hit.confidence });
      prev2 = prev;
      prev = { x: hit.x, y: hit.y };
    } else {
      points.push({ t: s.t, xPx: NaN, yPx: NaN, confidence: 0 });
      // Keep prediction anchored at the last good point (don't extrapolate
      // blindly through a gap).
      prev2 = prev;
    }
  };

  await walkVideo(video, ctx, {
    fps: opts.fps,
    onFrame,
    onProgress: opts.onProgress,
    signal: opts.signal,
  });

  return {
    fps: opts.fps,
    videoWidth: ctx.canvas.width,
    videoHeight: ctx.canvas.height,
    radiusPx: opts.radiusPx,
    points,
  };
}
