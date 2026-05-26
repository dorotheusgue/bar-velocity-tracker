/**
 * Classical template tracker with a color-aware scoring function. The user
 * taps the bar (or, ideally, a colored plate); we grab a small RGB+grayscale
 * patch around that point and, on each subsequent frame, slide that template
 * through a search window using normalized cross-correlation, then multiply
 * the NCC score by a color-similarity factor.
 *
 * Why both? NCC is great at spatial localisation but only sees luminance, so
 * the bar shaft's strong horizontal edge frequently beats the plate's more
 * isotropic texture on grayscale alone. The mean-RGB factor knocks down any
 * candidate whose colour is far from the original template — exactly what
 * stops the lock from drifting off a red plate onto the silver bar.
 */

export interface TemplatePoint {
  x: number;
  y: number;
}

export interface TemplateTrackerOptions {
  /** Square template side, in pixels (default 48). */
  templateSize?: number;
  /** Horizontal search half-window in pixels (default 24). */
  searchRadiusX?: number;
  /** Vertical search half-window in pixels (default 40 — bars move vertically). */
  searchRadiusY?: number;
  /** Minimum combined score to accept a match (default 0.55). */
  minConfidence?: number;
  /**
   * Online template update rate. 0 = never update (most stable). Small values
   * like 0.05 help with gradual lighting changes but can cause drift.
   */
  templateUpdateRate?: number;
  /**
   * Weight applied to the mean-RGB distance term. Higher = colour matters
   * more relative to spatial NCC. 0 = grayscale only. Default 2.5 strongly
   * favours same-colour matches.
   */
  colorWeight?: number;
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
  private templateMeanR = 0;
  private templateMeanG = 0;
  private templateMeanB = 0;
  private lastPosition: TemplatePoint | null = null;

  private readonly size: number;
  private readonly searchRadiusX: number;
  private readonly searchRadiusY: number;
  /** Mutable so the debug sheet can tune it live. */
  minConfidence: number;
  /** Mutable so the debug sheet can tune it live. */
  colorWeight: number;
  private readonly updateRate: number;

  constructor(options: TemplateTrackerOptions = {}) {
    this.size = options.templateSize ?? 48;
    this.searchRadiusX = options.searchRadiusX ?? 24;
    this.searchRadiusY = options.searchRadiusY ?? 40;
    this.minConfidence = options.minConfidence ?? 0.55;
    this.colorWeight = options.colorWeight ?? 2.5;
    this.updateRate = options.templateUpdateRate ?? 0;
  }

  get isInitialized(): boolean {
    return this.template !== null && this.lastPosition !== null;
  }

  initialize(ctx: CanvasRenderingContext2D, point: TemplatePoint): boolean {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const half = this.size / 2;
    if (
      point.x - half < 0 ||
      point.y - half < 0 ||
      point.x + half > w ||
      point.y + half > h
    ) {
      return false;
    }
    this.lastPosition = { x: point.x, y: point.y };

    const sample = grabPatchData(
      ctx,
      Math.round(point.x - half),
      Math.round(point.y - half),
      this.size,
      this.size
    );
    this.template = sample.gray;
    const stats = patchStats(this.template);
    this.templateMean = stats.mean;
    this.templateStd = stats.std;
    this.templateMeanR = sample.meanR;
    this.templateMeanG = sample.meanG;
    this.templateMeanB = sample.meanB;
    return true;
  }

  reset() {
    this.template = null;
    this.lastPosition = null;
  }

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

    const window = grabPatchData(ctx, winX, winY, winW, winH);
    const W1 = winW + 1;
    const integralR = buildIntegralImage(window.rgba, winW, winH, 0);
    const integralG = buildIntegralImage(window.rgba, winW, winH, 1);
    const integralB = buildIntegralImage(window.rgba, winW, winH, 2);

    // Compose grayscale NCC + colour similarity into a single match score.
    const scoreAt = (ox: number, oy: number): number => {
      const ncc = nccAt(
        this.template!,
        this.templateMean,
        this.templateStd,
        window.gray,
        winW,
        ox,
        oy,
        this.size
      );
      if (ncc <= 0) return 0;
      const meanR = meanFromIntegral(integralR, W1, ox, oy, this.size);
      const meanG = meanFromIntegral(integralG, W1, ox, oy, this.size);
      const meanB = meanFromIntegral(integralB, W1, ox, oy, this.size);
      const dr = Math.abs(meanR - this.templateMeanR) / 255;
      const dg = Math.abs(meanG - this.templateMeanG) / 255;
      const db = Math.abs(meanB - this.templateMeanB) / 255;
      const colorDist = Math.max(dr, dg, db);
      const colorSim = Math.max(0, 1 - colorDist * this.colorWeight);
      return ncc * colorSim;
    };

    let bestScore = -Infinity;
    let bestOX = 0;
    let bestOY = 0;
    const maxOX = winW - this.size;
    const maxOY = winH - this.size;
    for (let oy = 0; oy <= maxOY; oy++) {
      for (let ox = 0; ox <= maxOX; ox++) {
        const score = scoreAt(ox, oy);
        if (score > bestScore) {
          bestScore = score;
          bestOX = ox;
          bestOY = oy;
        }
      }
    }

    if (bestScore < this.minConfidence) return null;

    // Subpixel refinement using the same composed score.
    let refinedOX = bestOX;
    let refinedOY = bestOY;
    if (bestOX > 0 && bestOX < maxOX && bestOY > 0 && bestOY < maxOY) {
      const sL = scoreAt(bestOX - 1, bestOY);
      const sR = scoreAt(bestOX + 1, bestOY);
      const sT = scoreAt(bestOX, bestOY - 1);
      const sB = scoreAt(bestOX, bestOY + 1);
      const denomX = sL + sR - 2 * bestScore;
      const denomY = sT + sB - 2 * bestScore;
      if (denomX !== 0) refinedOX = bestOX + clamp(0.5 * (sL - sR) / denomX, -0.5, 0.5);
      if (denomY !== 0) refinedOY = bestOY + clamp(0.5 * (sT - sB) / denomY, -0.5, 0.5);
    }

    const cx = winX + refinedOX + half;
    const cy = winY + refinedOY + half;
    this.lastPosition = { x: cx, y: cy };

    if (this.updateRate > 0 && bestScore > 0.7) {
      const fresh = grabPatchData(
        ctx,
        Math.round(cx - half),
        Math.round(cy - half),
        this.size,
        this.size
      );
      for (let i = 0; i < this.template.length; i++) {
        this.template[i] =
          this.template[i] * (1 - this.updateRate) + fresh.gray[i] * this.updateRate;
      }
      const s = patchStats(this.template);
      this.templateMean = s.mean;
      this.templateStd = s.std;
      this.templateMeanR =
        this.templateMeanR * (1 - this.updateRate) + fresh.meanR * this.updateRate;
      this.templateMeanG =
        this.templateMeanG * (1 - this.updateRate) + fresh.meanG * this.updateRate;
      this.templateMeanB =
        this.templateMeanB * (1 - this.updateRate) + fresh.meanB * this.updateRate;
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

interface PatchData {
  gray: Float32Array;
  rgba: Uint8ClampedArray;
  meanR: number;
  meanG: number;
  meanB: number;
}

function grabPatchData(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): PatchData {
  const img = ctx.getImageData(x, y, w, h);
  const length = w * h;
  const gray = new Float32Array(length);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0, j = 0; j < length; i += 4, j++) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    gray[j] = 0.299 * r + 0.587 * g + 0.114 * b;
    sumR += r;
    sumG += g;
    sumB += b;
  }
  return {
    gray,
    rgba: img.data,
    meanR: sumR / length,
    meanG: sumG / length,
    meanB: sumB / length,
  };
}

/**
 * Builds a (w+1) × (h+1) integral image (summed-area table) for one channel.
 * Mean over any rectangle is then four lookups + one division.
 */
function buildIntegralImage(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  channel: number
): Float32Array {
  const W = w + 1;
  const integral = new Float32Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    const aboveRow = y * W;
    const thisRow = (y + 1) * W;
    for (let x = 0; x < w; x++) {
      rowSum += rgba[(y * w + x) * 4 + channel];
      integral[thisRow + (x + 1)] = integral[aboveRow + (x + 1)] + rowSum;
    }
  }
  return integral;
}

function meanFromIntegral(
  integral: Float32Array,
  W: number,
  x: number,
  y: number,
  size: number
): number {
  const a = integral[y * W + x];
  const b = integral[y * W + (x + size)];
  const c = integral[(y + size) * W + x];
  const d = integral[(y + size) * W + (x + size)];
  return (d - b - c + a) / (size * size);
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
  const num = sumTP - n * templateMean * patchMean;
  return num / (n * templateStd * patchStd);
}
