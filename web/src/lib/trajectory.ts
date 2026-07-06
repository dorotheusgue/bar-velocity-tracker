import { walkVideoFast, frameCount } from './frameWalker';
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
 * Pass 1: visit every frame (fast sequential walk + seek backfill) and detect
 * the plate, producing a dense raw trajectory.
 *
 * The search window for each frame is centred on a prediction derived from the
 * *nearest already-detected frames on either side* — interpolation when both
 * neighbours exist (backfilled frames), capped linear extrapolation when only
 * earlier frames exist (normal sequential order), the seed point otherwise.
 * This makes prediction valid regardless of the order frames arrive in.
 */
export async function buildTrajectory(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  detector: ColorBlobTracker,
  opts: BuildOptions
): Promise<RawTrajectory> {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const dt = 1 / opts.fps;
  const n = frameCount(duration, opts.fps);
  const xs = new Float64Array(n).fill(NaN);
  const ys = new Float64Array(n).fill(NaN);
  const cf = new Float64Array(n);

  const SCAN_LIMIT = 300; // frames to look for a neighbour before giving up
  const r = opts.radiusPx;

  const predictFor = (index: number): { x: number; y: number } => {
    let below = -1;
    let below2 = -1;
    let above = -1;
    for (let i = index - 1, lim = Math.max(0, index - SCAN_LIMIT); i >= lim; i--) {
      if (cf[i] > 0) {
        if (below < 0) below = i;
        else {
          below2 = i;
          break;
        }
      }
    }
    for (let i = index + 1, lim = Math.min(n - 1, index + SCAN_LIMIT); i <= lim; i++) {
      if (cf[i] > 0) {
        above = i;
        break;
      }
    }

    if (below >= 0 && above >= 0) {
      const f = (index - below) / (above - below);
      return {
        x: xs[below] + (xs[above] - xs[below]) * f,
        y: ys[below] + (ys[above] - ys[below]) * f,
      };
    }
    if (below >= 0 && below2 >= 0) {
      // Constant-velocity lead-ahead, capped so a noisy pair can't fling the
      // window far from the last known position.
      const steps = index - below;
      let dx = ((xs[below] - xs[below2]) / (below - below2)) * steps;
      let dy = ((ys[below] - ys[below2]) / (below - below2)) * steps;
      const lead = Math.hypot(dx, dy);
      const cap = 2 * r;
      if (lead > cap) {
        dx *= cap / lead;
        dy *= cap / lead;
      }
      return { x: xs[below] + dx, y: ys[below] + dy };
    }
    if (below >= 0) return { x: xs[below], y: ys[below] };
    if (above >= 0) return { x: xs[above], y: ys[above] };
    return opts.seedCenter;
  };

  await walkVideoFast(video, ctx, {
    fps: opts.fps,
    signal: opts.signal,
    onProgress: opts.onProgress,
    onFrame: (index, _t, c) => {
      const hit = detector.detect(c, predictFor(index));
      if (hit) {
        xs[index] = hit.x;
        ys[index] = hit.y;
        cf[index] = hit.confidence;
      }
    },
  });

  const points: TrajectoryPoint[] = [];
  for (let i = 0; i < n; i++) {
    points.push({ t: i * dt, xPx: xs[i], yPx: ys[i], confidence: cf[i] });
  }
  return {
    fps: opts.fps,
    videoWidth: ctx.canvas.width,
    videoHeight: ctx.canvas.height,
    radiusPx: opts.radiusPx,
    points,
  };
}
