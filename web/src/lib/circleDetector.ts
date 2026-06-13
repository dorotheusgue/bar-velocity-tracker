/**
 * Known-radius plate detector via a Fast Radial Symmetry Transform (FRST).
 *
 * Calibration already gives us the plate radius in pixels, so locating the
 * plate collapses from a 3-DOF circle search (cx, cy, r) to a cheap 2-DOF
 * vote (cx, cy at fixed r). For every strong gradient pixel we cast a vote at
 * distance r along the gradient direction; the plate's centre accumulates
 * votes from all around its rim and wins.
 *
 * Why this beats grayscale NCC on fast lifts: motion blur turns a sharp plate
 * edge into a *ramp*, but the gradient across that ramp still points radially
 * at the centre, so a blurred circle still produces a strong, correctly-placed
 * centre peak — it degrades gracefully exactly where template matching falls
 * off a cliff. A straight bar-shaft edge votes along a line, never a point, so
 * it can't win the centre vote — which kills the old "drifts onto the shaft"
 * failure. An optional colour gate further suppresses the silver shaft.
 *
 * `detect()` is pure given (pixels, predicted centre, internal radius/colour) —
 * essential for run-to-run determinism.
 */

export interface CircleDetectorOptions {
  radiusPx: number; // KNOWN from calibration; fixed.
  gradThreshold?: number; // default 40 (0..255 gradient magnitude)
  minConfidence?: number; // default 0.30 (peak-to-mean separation, 0..1)
  colorTol?: number; // default 0.25 normalized max-channel distance; 0 disables gate
  motionMarginX?: number; // default 0.5 (× r), min 16px
  motionMarginY?: number; // default 1.0 (× r), min 28px
  maxRadiusGrowth?: number; // default 2.0
}

export interface CircleHit {
  x: number; // video-pixel centre, top-left origin
  y: number;
  confidence: number;
  radiusPx: number;
}

export class KnownRadiusCircleDetector {
  private r: number;
  private gradThreshold: number;
  private minConfidence: number;
  private colorTol: number;
  private marginXScale: number;
  private marginYScale: number;
  private maxRadiusGrowth: number;

  private plateR = 0;
  private plateG = 0;
  private plateB = 0;
  private hasColor = false;
  private missesInRow = 0;

  constructor(options: CircleDetectorOptions) {
    this.r = Math.max(4, options.radiusPx);
    this.gradThreshold = options.gradThreshold ?? 40;
    this.minConfidence = options.minConfidence ?? 0.3;
    this.colorTol = options.colorTol ?? 0.25;
    this.marginXScale = options.motionMarginX ?? 0.5;
    this.marginYScale = options.motionMarginY ?? 1.0;
    this.maxRadiusGrowth = options.maxRadiusGrowth ?? 2.0;
  }

  setMinConfidence(v: number) {
    this.minConfidence = v;
  }
  setGradThreshold(v: number) {
    this.gradThreshold = v;
  }
  setColorTol(v: number) {
    this.colorTol = v;
  }

  /** Sample the plate's mean colour from a disc at `center` and reset misses. */
  seed(ctx: CanvasRenderingContext2D, center: { x: number; y: number }) {
    const rr = Math.round(this.r * 0.6);
    const x0 = Math.max(0, Math.round(center.x - rr));
    const y0 = Math.max(0, Math.round(center.y - rr));
    const x1 = Math.min(ctx.canvas.width, Math.round(center.x + rr));
    const y1 = Math.min(ctx.canvas.height, Math.round(center.y + rr));
    const w = x1 - x0;
    const h = y1 - y0;
    this.missesInRow = 0;
    if (w <= 0 || h <= 0) {
      this.hasColor = false;
      return;
    }
    const img = ctx.getImageData(x0, y0, w, h).data;
    const cx = center.x - x0;
    const cy = center.y - y0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > rr * rr) continue;
        const i = (y * w + x) * 4;
        sr += img[i];
        sg += img[i + 1];
        sb += img[i + 2];
        count++;
      }
    }
    if (count > 0) {
      this.plateR = sr / count;
      this.plateG = sg / count;
      this.plateB = sb / count;
      this.hasColor = true;
    }
  }

  reset() {
    this.hasColor = false;
    this.missesInRow = 0;
  }

  detect(ctx: CanvasRenderingContext2D, predicted: { x: number; y: number }): CircleHit | null {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const r = this.r;
    const growth = Math.min(1 + this.missesInRow * 0.25, this.maxRadiusGrowth);
    const marginX = Math.max(16, this.marginXScale * r) * growth;
    const marginY = Math.max(28, this.marginYScale * r) * growth;

    // ROI extends r beyond the predicted centre so the whole rim is captured.
    const x0 = Math.max(0, Math.floor(predicted.x - r - marginX));
    const y0 = Math.max(0, Math.floor(predicted.y - r - marginY));
    const x1 = Math.min(W, Math.ceil(predicted.x + r + marginX));
    const y1 = Math.min(H, Math.ceil(predicted.y + r + marginY));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 2 * r || h < 2 * r) {
      this.missesInRow++;
      return null;
    }

    const data = ctx.getImageData(x0, y0, w, h).data;

    // Grayscale buffer.
    const gray = new Float32Array(w * h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    const O = new Float32Array(w * h); // vote accumulator (ROI coords)
    const gt = this.gradThreshold;
    const colorGate = this.colorTol > 0 && this.hasColor;
    const tol = this.colorTol * 255;

    // Sobel + radial voting (skip 1px border for the 3x3 kernel).
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const tl = gray[idx - w - 1];
        const tc = gray[idx - w];
        const tr = gray[idx - w + 1];
        const ml = gray[idx - 1];
        const mr = gray[idx + 1];
        const bl = gray[idx + w - 1];
        const bc = gray[idx + w];
        const br = gray[idx + w + 1];
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
        const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
        const mag = Math.sqrt(gx * gx + gy * gy);
        if (mag < gt) continue;
        const ux = gx / mag;
        const uy = gy / mag;

        // Vote toward both candidate centres (sign of the edge is ambiguous).
        // +direction: centre at (x+r·u); the inward pixel is along +u.
        voteDir(O, w, h, data, x, y, ux, uy, r, mag, colorGate, tol,
          this.plateR, this.plateG, this.plateB, 1);
        voteDir(O, w, h, data, x, y, ux, uy, r, mag, colorGate, tol,
          this.plateR, this.plateG, this.plateB, -1);
      }
    }

    // 3x3 box blur to merge dual-sign votes + blur spread into one peak.
    const Ob = boxBlur3(O, w, h);

    // Peak + mean.
    let peak = -Infinity;
    let px = 0;
    let py = 0;
    let sum = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = Ob[y * w + x];
        sum += v;
        if (v > peak) {
          peak = v;
          px = x;
          py = y;
        }
      }
    }
    const mean = sum / (w * h);
    const confidence = peak > 0 ? Math.max(0, Math.min(1, (peak - mean) / peak)) : 0;

    if (peak <= 0 || confidence < this.minConfidence) {
      this.missesInRow++;
      return null;
    }
    this.missesInRow = 0;

    // Parabolic subpixel refinement on the blurred accumulator.
    let sx = px;
    let sy = py;
    if (px > 0 && px < w - 1) {
      const l = Ob[py * w + px - 1];
      const c = Ob[py * w + px];
      const rr = Ob[py * w + px + 1];
      const denom = l + rr - 2 * c;
      if (denom !== 0) sx = px + clamp((0.5 * (l - rr)) / denom, -0.5, 0.5);
    }
    if (py > 0 && py < h - 1) {
      const t = Ob[(py - 1) * w + px];
      const c = Ob[py * w + px];
      const b = Ob[(py + 1) * w + px];
      const denom = t + b - 2 * c;
      if (denom !== 0) sy = py + clamp((0.5 * (t - b)) / denom, -0.5, 0.5);
    }

    return { x: x0 + sx, y: y0 + sy, confidence, radiusPx: r };
  }
}

function voteDir(
  O: Float32Array,
  w: number,
  h: number,
  data: Uint8ClampedArray,
  x: number,
  y: number,
  ux: number,
  uy: number,
  r: number,
  mag: number,
  colorGate: boolean,
  tol: number,
  pr: number,
  pg: number,
  pb: number,
  sign: number
) {
  const cx = x + sign * r * ux;
  const cy = y + sign * r * uy;
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  if (ix < 0 || iy < 0 || ix >= w || iy >= h) return;

  if (colorGate) {
    // Sample a pixel a few px inward (toward the candidate centre) and require
    // it to match the stored plate colour — this is what rejects shaft edges.
    const step = Math.min(6, r * 0.3);
    const sxp = Math.round(x + sign * step * ux);
    const syp = Math.round(y + sign * step * uy);
    if (sxp >= 0 && syp >= 0 && sxp < w && syp < h) {
      const i = (syp * w + sxp) * 4;
      const dr = Math.abs(data[i] - pr);
      const dg = Math.abs(data[i + 1] - pg);
      const db = Math.abs(data[i + 2] - pb);
      if (Math.max(dr, dg, db) > tol) return;
    }
  }
  O[iy * w + ix] += mag;
}

function boxBlur3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += src[yy * w + xx];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
