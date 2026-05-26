/**
 * Classical template tracker. The user taps the bar once; we grab a small
 * grayscale patch around that point and, on each subsequent frame, slide that
 * template through a search window around the last known position using
 * normalized cross-correlation (NCC). No neural net, no model download — runs
 * in a few hundred KB of JS at frame-perfect accuracy because the ROI is
 * exactly what the user pointed at.
 *
 * This is the same approach RepSpeed-style apps use, and it works because the
 * bar's appearance is locally stable between adjacent frames.
 */

export interface TemplatePoint {
  x: number;
  y: number;
}

export interface TemplateTrackerOptions {
  /** Square template side, in pixels (default 32). */
  templateSize?: number;
  /** Horizontal search half-window in pixels (default 16). */
  searchRadiusX?: number;
  /** Vertical search half-window in pixels (default 28 — bars move vertically). */
  searchRadiusY?: number;
  /** Minimum NCC score to accept a match (default 0.35). */
  minConfidence?: number;
  /**
   * Online template update rate. 0 = never update (most stable). Small values
   * like 0.05 help with gradual lighting changes but can cause drift.
   */
  templateUpdateRate?: number;
}

export interface TemplateTrackResult {
  position: TemplatePoint;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export class TemplateTracker {
  private template: Float32Array | null = null;
  private templateMean = 0;
  private templateStd = 0;
  private lastPosition: TemplatePoint | null = null;

  private readonly size: number;
  private readonly searchRadiusX: number;
  private readonly searchRadiusY: number;
  private readonly minConfidence: number;
  private readonly updateRate: number;

  constructor(options: TemplateTrackerOptions = {}) {
    this.size = options.templateSize ?? 32;
    this.searchRadiusX = options.searchRadiusX ?? 16;
    this.searchRadiusY = options.searchRadiusY ?? 28;
    this.minConfidence = options.minConfidence ?? 0.35;
    this.updateRate = options.templateUpdateRate ?? 0;
  }

  get isInitialized(): boolean {
    return this.template !== null && this.lastPosition !== null;
  }

  /**
   * Seed the tracker with a point in canvas coordinates. The pixel data at
   * the time of this call becomes the template the tracker will look for in
   * subsequent frames.
   */
  initialize(ctx: CanvasRenderingContext2D, point: TemplatePoint): boolean {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const half = this.size / 2;
    if (point.x - half < 0 || point.y - half < 0 || point.x + half > w || point.y + half > h) {
      return false;
    }
    this.lastPosition = { x: point.x, y: point.y };
    this.template = grabGrayPatch(ctx, point, this.size);
    const stats = patchStats(this.template);
    this.templateMean = stats.mean;
    this.templateStd = stats.std;
    return true;
  }

  reset() {
    this.template = null;
    this.lastPosition = null;
  }

  /**
   * Track the template in the current frame. Reads one rectangular search
   * window via `getImageData` and slides the template across it in memory.
   */
  track(ctx: CanvasRenderingContext2D): TemplateTrackResult | null {
    if (!this.template || !this.lastPosition) return null;

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const half = this.size / 2;
    const rX = this.searchRadiusX;
    const rY = this.searchRadiusY;

    const winX = Math.max(0, Math.round(this.lastPosition.x - half - rX));
    const winY = Math.max(0, Math.round(this.lastPosition.y - half - rY));
    const winRight = Math.min(w, Math.round(this.lastPosition.x + half + rX));
    const winBottom = Math.min(h, Math.round(this.lastPosition.y + half + rY));
    const winW = winRight - winX;
    const winH = winBottom - winY;
    if (winW < this.size || winH < this.size) return null;

    const window = grabGrayWindow(ctx, winX, winY, winW, winH);

    let bestScore = -Infinity;
    let bestOX = 0;
    let bestOY = 0;
    const maxOX = winW - this.size;
    const maxOY = winH - this.size;
    for (let oy = 0; oy <= maxOY; oy++) {
      for (let ox = 0; ox <= maxOX; ox++) {
        const score = nccAt(
          this.template,
          this.templateMean,
          this.templateStd,
          window,
          winW,
          ox,
          oy,
          this.size
        );
        if (score > bestScore) {
          bestScore = score;
          bestOX = ox;
          bestOY = oy;
        }
      }
    }

    if (bestScore < this.minConfidence) return null;

    // Subpixel peak refinement: parabolic fit through the best score and its
    // 4 neighbours. Without this, the reported centre snaps to integer pixels
    // and the bbox shimmers frame-to-frame.
    let refinedOX = bestOX;
    let refinedOY = bestOY;
    if (bestOX > 0 && bestOX < maxOX && bestOY > 0 && bestOY < maxOY) {
      const sL = nccAt(this.template, this.templateMean, this.templateStd, window, winW, bestOX - 1, bestOY, this.size);
      const sR = nccAt(this.template, this.templateMean, this.templateStd, window, winW, bestOX + 1, bestOY, this.size);
      const sT = nccAt(this.template, this.templateMean, this.templateStd, window, winW, bestOX, bestOY - 1, this.size);
      const sB = nccAt(this.template, this.templateMean, this.templateStd, window, winW, bestOX, bestOY + 1, this.size);
      const denomX = sL + sR - 2 * bestScore;
      const denomY = sT + sB - 2 * bestScore;
      if (denomX !== 0) refinedOX = bestOX + clamp(0.5 * (sL - sR) / denomX, -0.5, 0.5);
      if (denomY !== 0) refinedOY = bestOY + clamp(0.5 * (sT - sB) / denomY, -0.5, 0.5);
    }

    const cx = winX + refinedOX + half;
    const cy = winY + refinedOY + half;
    this.lastPosition = { x: cx, y: cy };

    if (this.updateRate > 0 && bestScore > 0.6) {
      const fresh = grabGrayPatch(ctx, this.lastPosition, this.size);
      for (let i = 0; i < this.template.length; i++) {
        this.template[i] = this.template[i] * (1 - this.updateRate) + fresh[i] * this.updateRate;
      }
      const s = patchStats(this.template);
      this.templateMean = s.mean;
      this.templateStd = s.std;
    }

    return {
      position: { x: cx, y: cy },
      confidence: bestScore,
      boundingBox: { x: cx - half, y: cy - half, width: this.size, height: this.size },
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ----- pixel helpers -----------------------------------------------------

function grabGrayPatch(
  ctx: CanvasRenderingContext2D,
  point: TemplatePoint,
  size: number
): Float32Array {
  const half = size / 2;
  const img = ctx.getImageData(Math.round(point.x - half), Math.round(point.y - half), size, size);
  return rgbaToGray(img.data, size * size);
}

function grabGrayWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): Float32Array {
  const img = ctx.getImageData(x, y, w, h);
  return rgbaToGray(img.data, w * h);
}

function rgbaToGray(data: Uint8ClampedArray, length: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0, j = 0; j < length; i += 4, j++) {
    // BT.601 luma — perceptual grayscale.
    out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

function patchStats(patch: Float32Array): { mean: number; std: number } {
  let sum = 0;
  for (let i = 0; i < patch.length; i++) sum += patch[i];
  const mean = sum / patch.length;
  let variance = 0;
  for (let i = 0; i < patch.length; i++) {
    const d = patch[i] - mean;
    variance += d * d;
  }
  return { mean, std: Math.sqrt(variance / patch.length) || 1 };
}

/**
 * Normalized cross-correlation between `template` (already mean/std normalized
 * via the stored templateMean/templateStd) and the sub-window of `window` at
 * offset (ox, oy). Because the template's mean is pre-subtracted via
 * templateMean, summing template * (patch - patchMean) collapses to
 * sum(template * patch) - templateMean * sum(patch), and we precompute
 * sum(template) = templateMean * n so it cancels cleanly.
 */
function nccAt(
  template: Float32Array,
  templateMean: number,
  templateStd: number,
  window: Float32Array,
  windowWidth: number,
  ox: number,
  oy: number,
  size: number
): number {
  let sumP = 0;
  let sumPP = 0;
  let sumTP = 0;
  const n = size * size;
  for (let y = 0; y < size; y++) {
    const rowT = y * size;
    const rowW = (oy + y) * windowWidth + ox;
    for (let x = 0; x < size; x++) {
      const t = template[rowT + x];
      const p = window[rowW + x];
      sumP += p;
      sumPP += p * p;
      sumTP += t * p;
    }
  }
  const patchMean = sumP / n;
  const patchVar = sumPP / n - patchMean * patchMean;
  const patchStd = patchVar > 0 ? Math.sqrt(patchVar) : 1;
  // sum((t - tMean) * (p - pMean)) = sumTP - n * tMean * pMean
  const num = sumTP - n * templateMean * patchMean;
  return num / (n * templateStd * patchStd);
}
