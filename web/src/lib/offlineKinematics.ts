import { savitzkyGolay } from './savitzkyGolay';
import type { RawTrajectory } from './trajectory';
import type { CalibrationManager } from './calibration';
import type { KinematicsEngine } from './kinematics';

export interface SmoothingOptions {
  polyOrder?: number; // default 2
  windowSeconds?: number; // default 0.18 (→ odd frame count)
  zuptVelocity?: number; // default 0.02 m/s
  zuptDuration?: number; // default 0.15 s
}

export interface SmoothedTrajectory {
  t: number[];
  yMeters: number[]; // up-positive
  xMeters: number[]; // lateral, for bar-path (signed)
  velocity: number[]; // m/s, up-positive (zero-phase SG derivative)
  fps: number;
  /** Fraction of source frames with a real detection (0..1). */
  detectionRate: number;
  /** Median detection confidence over detected frames. */
  medianConfidence: number;
}

/** Linear-interpolate across runs of misses; clamp leading/trailing gaps. */
function gapFill(values: number[], good: boolean[]): number[] {
  const n = values.length;
  const out = values.slice();
  let i = 0;
  // Leading gap → first good value.
  let firstGood = good.indexOf(true);
  if (firstGood === -1) return out.map(() => 0);
  for (i = 0; i < firstGood; i++) out[i] = values[firstGood];
  // Interior + trailing.
  i = firstGood;
  while (i < n) {
    if (good[i]) {
      i++;
      continue;
    }
    const gapStart = i;
    let gapEnd = i;
    while (gapEnd < n && !good[gapEnd]) gapEnd++;
    if (gapEnd >= n) {
      // Trailing gap → clamp to last good.
      for (let k = gapStart; k < n; k++) out[k] = out[gapStart - 1];
    } else {
      const a = out[gapStart - 1];
      const b = values[gapEnd];
      const span = gapEnd - (gapStart - 1);
      for (let k = gapStart; k < gapEnd; k++) {
        out[k] = a + ((b - a) * (k - (gapStart - 1))) / span;
      }
    }
    i = gapEnd;
  }
  return out;
}

/**
 * Pass 2: turn a raw pixel trajectory into a zero-lag metres/velocity stream.
 * Gap-fills misses, Savitzky–Golay smooths position and reads velocity from the
 * same fit (no separate slope window, no causal Kalman → no lag, no peak
 * clipping), then applies a non-causal zero-velocity clamp over the whole
 * signal.
 */
export function smoothTrajectory(
  raw: RawTrajectory,
  calibration: CalibrationManager,
  opts: SmoothingOptions = {}
): SmoothedTrajectory {
  const order = opts.polyOrder ?? 2;
  const windowSeconds = opts.windowSeconds ?? 0.18;
  const zuptVel = opts.zuptVelocity ?? 0.02;
  const zuptDur = opts.zuptDuration ?? 0.15;

  const pts = raw.points;
  const n = pts.length;
  const fps = raw.fps;
  const dt = 1 / fps;

  const t = pts.map((p) => p.t);
  const good = pts.map((p) => p.confidence > 0 && Number.isFinite(p.yPx));
  const confidences = pts.filter((p) => p.confidence > 0).map((p) => p.confidence);
  const detectionRate = n > 0 ? confidences.length / n : 0;
  let medianConfidence = 0;
  if (confidences.length > 0) {
    const sorted = [...confidences].sort((a, b) => a - b);
    medianConfidence = sorted[Math.floor(sorted.length / 2)];
  }

  // px → m. Vertical sign flipped so positive = up (matches the old engine).
  const yMetersRaw = pts.map((p) =>
    Number.isFinite(p.yPx) ? -calibration.convertPixelsToMeters(p.yPx) : NaN
  );
  const xMetersRaw = pts.map((p) =>
    Number.isFinite(p.xPx) ? calibration.convertPixelsToMeters(p.xPx) : NaN
  );

  const yFilled = gapFill(yMetersRaw, good);
  const xFilled = gapFill(xMetersRaw, good);

  const window = Math.max(order + 2, Math.round(windowSeconds * fps));
  const sgY = savitzkyGolay(yFilled, window, order, dt);
  const sgX = savitzkyGolay(xFilled, window, order, dt);

  const yMeters = sgY.value;
  const xMeters = sgX.value;
  const velocity = sgY.deriv.slice();

  // Non-causal ZUPT: zero velocity across quiet spans (|v| < threshold for
  // longer than zuptDuration). Seeing the whole span at once is simpler and
  // more correct than the old causal drift accumulator.
  const minQuietFrames = Math.max(1, Math.round(zuptDur * fps));
  let i = 0;
  while (i < n) {
    if (Math.abs(velocity[i]) < zuptVel) {
      let j = i;
      while (j < n && Math.abs(velocity[j]) < zuptVel) j++;
      if (j - i >= minQuietFrames) {
        for (let k = i; k < j; k++) velocity[k] = 0;
      }
      i = j;
    } else {
      i++;
    }
  }

  return { t, yMeters, xMeters, velocity, fps, detectionRate, medianConfidence };
}

/**
 * Replay a smoothed stream into the existing kinematics → repDetector → metrics
 * chain. Position is emitted before velocity each sample so the rep detector's
 * ROM/position is current when the velocity is processed.
 */
export function replayReps(smoothed: SmoothedTrajectory, kinematics: KinematicsEngine): void {
  const { t, yMeters, velocity } = smoothed;
  for (let i = 0; i < t.length; i++) {
    kinematics.emit(velocity[i], yMeters[i], t[i]);
  }
}

/**
 * Estimate the strongest downward acceleration (m/s²) over the clip — during a
 * near-free drop this approaches g (9.81), which validates the whole
 * pixels→metres→time chain end to end.
 */
export function maxDownwardAccel(smoothed: SmoothedTrajectory): number {
  const { velocity, fps } = smoothed;
  const dt = 1 / fps;
  let worst = 0; // most negative dv/dt
  for (let i = 1; i < velocity.length; i++) {
    const a = (velocity[i] - velocity[i - 1]) / dt;
    if (a < worst) worst = a;
  }
  return Math.abs(worst);
}
