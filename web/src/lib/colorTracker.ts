/**
 * Colour-blob plate tracker.
 *
 * This is how practical VBT trackers actually follow the bar: segment the
 * tracked colour each frame and take the blob centroid, rather than re-deriving
 * a fragile geometric feature (circle / template peak) independently per frame.
 * A developer who built a barbell tracker found colour+shape segmentation
 * "orders of magnitude more reliable than any tracking algorithm" incl. CNNs
 * (github.com/kostecky/VBT-Barbell-Tracker).
 *
 * Why it doesn't jump: a motion-blurred coloured plate is still a coloured
 * region — blur softens its edges but the mask's centroid holds — and we only
 * search a local window around the predicted position and prefer the component
 * nearest the prediction, so it can't teleport to a same-colour distractor.
 *
 * `detect()` is pure given (pixels, predicted, seeded colour, miss count) — so
 * the offline walk yields identical results every run.
 */

export interface ColorTrackerOptions {
  radiusPx: number; // from calibration → expected blob size + ROI scale
  hueTolerance?: number; // default 18° (circular)
  satMin?: number; // default 0.25 (0..1)
  valMin?: number; // default 0.15
  valMax?: number; // default 0.98
  minConfidence?: number; // default 0.35 (real, area×compactness)
  motionMarginX?: number; // default 0.6 (× r), min 16px
  motionMarginY?: number; // default 1.2 (× r), min 28px
  maxRadiusGrowth?: number; // default 2.5
}

export interface TrackHit {
  x: number; // video-pixel centre, top-left origin
  y: number;
  confidence: number;
  radiusPx: number;
}

interface HSV {
  h: number;
  s: number;
  v: number;
}

export class ColorBlobTracker {
  private r: number;
  private hueTol: number;
  private satMin: number;
  private valMin: number;
  private valMax: number;
  private minConfidence: number;
  private marginXScale: number;
  private marginYScale: number;
  private maxRadiusGrowth: number;

  // Seeded colour.
  private h0 = 0;
  private s0 = 0;
  private v0 = 0;
  private achromatic = false;
  private hasColor = false;

  private missesInRow = 0;

  constructor(o: ColorTrackerOptions) {
    this.r = Math.max(4, o.radiusPx);
    this.hueTol = o.hueTolerance ?? 18;
    this.satMin = o.satMin ?? 0.25;
    this.valMin = o.valMin ?? 0.15;
    this.valMax = o.valMax ?? 0.98;
    this.minConfidence = o.minConfidence ?? 0.35;
    this.marginXScale = o.motionMarginX ?? 0.6;
    this.marginYScale = o.motionMarginY ?? 1.2;
    this.maxRadiusGrowth = o.maxRadiusGrowth ?? 2.5;
  }

  setMinConfidence(v: number) {
    this.minConfidence = v;
  }
  setHueTolerance(v: number) {
    this.hueTol = v;
  }
  setSatMin(v: number) {
    this.satMin = v;
  }

  /** Sample the tracked colour from a disc at `center`. */
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
    // Circular mean of hue (weighted by saturation so grey pixels don't bias it),
    // plus mean S and V.
    let sinSum = 0;
    let cosSum = 0;
    let sSum = 0;
    let vSum = 0;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > rr * rr) continue;
        const i = (y * w + x) * 4;
        const hsv = rgbToHsv(img[i], img[i + 1], img[i + 2]);
        const rad = (hsv.h * Math.PI) / 180;
        sinSum += Math.sin(rad) * hsv.s;
        cosSum += Math.cos(rad) * hsv.s;
        sSum += hsv.s;
        vSum += hsv.v;
        count++;
      }
    }
    if (count === 0) {
      this.hasColor = false;
      return;
    }
    this.s0 = sSum / count;
    this.v0 = vSum / count;
    this.h0 = (Math.atan2(sinSum, cosSum) * 180) / Math.PI;
    if (this.h0 < 0) this.h0 += 360;
    // Grey/black/white plates have unstable hue → match on value band instead.
    this.achromatic = this.s0 < 0.2;
    this.hasColor = true;
  }

  reset() {
    this.hasColor = false;
    this.missesInRow = 0;
  }

  detect(ctx: CanvasRenderingContext2D, predicted: { x: number; y: number }): TrackHit | null {
    if (!this.hasColor) return null;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const r = this.r;
    const growth = Math.min(1 + this.missesInRow * 0.25, this.maxRadiusGrowth);
    const marginX = Math.max(16, this.marginXScale * r) * growth;
    const marginY = Math.max(28, this.marginYScale * r) * growth;

    const x0 = Math.max(0, Math.floor(predicted.x - r - marginX));
    const y0 = Math.max(0, Math.floor(predicted.y - r - marginY));
    const x1 = Math.min(W, Math.ceil(predicted.x + r + marginX));
    const y1 = Math.min(H, Math.ceil(predicted.y + r + marginY));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 4 || h < 4) {
      this.missesInRow++;
      return null;
    }

    const data = ctx.getImageData(x0, y0, w, h).data;

    // Build the colour mask.
    const mask = new Uint8Array(w * h);
    for (let j = 0, i = 0; j < mask.length; j++, i += 4) {
      const hsv = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      let match: boolean;
      if (this.achromatic) {
        match = hsv.s <= 0.28 && Math.abs(hsv.v - this.v0) <= 0.22;
      } else {
        const dh = hueDistance(hsv.h, this.h0);
        match = dh <= this.hueTol && hsv.s >= this.satMin && hsv.v >= this.valMin && hsv.v <= this.valMax;
      }
      mask[j] = match ? 1 : 0;
    }

    // Connected components (8-conn). Pick the one maximising area×proximity.
    const expectedArea = Math.PI * r * r;
    const predLocalX = predicted.x - x0;
    const predLocalY = predicted.y - y0;

    const labels = new Int32Array(w * h).fill(-1);
    const stack: number[] = [];
    let best: {
      sumX: number;
      sumY: number;
      count: number;
      minX: number;
      maxX: number;
      minY: number;
      maxY: number;
      score: number;
    } | null = null;

    for (let sy = 0; sy < h; sy++) {
      for (let sx = 0; sx < w; sx++) {
        const start = sy * w + sx;
        if (mask[start] !== 1 || labels[start] !== -1) continue;
        // Flood this component.
        stack.length = 0;
        stack.push(start);
        labels[start] = 1;
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        let minX = sx;
        let maxX = sx;
        let minY = sy;
        let maxY = sy;
        while (stack.length) {
          const idx = stack.pop()!;
          const px = idx % w;
          const py = (idx - px) / w;
          sumX += px;
          sumY += py;
          count++;
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = py + dy;
            if (ny < 0 || ny >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = px + dx;
              if (nx < 0 || nx >= w) continue;
              const nidx = ny * w + nx;
              if (mask[nidx] === 1 && labels[nidx] === -1) {
                labels[nidx] = 1;
                stack.push(nidx);
              }
            }
          }
        }
        if (count < 8) continue; // ignore speckle
        const cxp = sumX / count;
        const cyp = sumY / count;
        const ratio = count / expectedArea;
        const areaScore = ratio <= 1 ? ratio : Math.max(0, 2 - ratio);
        const dist = Math.hypot(cxp - predLocalX, cyp - predLocalY);
        const proximity = 1 / (1 + dist / r);
        const score = areaScore * proximity;
        if (!best || score > best.score) {
          best = { sumX, sumY, count, minX, maxX, minY, maxY, score };
        }
      }
    }

    if (!best) {
      this.missesInRow++;
      return null;
    }

    const cx = best.sumX / best.count;
    const cy = best.sumY / best.count;
    const ratio = best.count / expectedArea;
    const areaScore = ratio <= 1 ? ratio : Math.max(0, 2 - ratio);
    const bboxArea = (best.maxX - best.minX + 1) * (best.maxY - best.minY + 1);
    const compactness = bboxArea > 0 ? best.count / bboxArea : 0;
    const compactnessNorm = Math.min(1, compactness / (Math.PI / 4)); // disc → ~1
    const confidence = Math.max(0, Math.min(1, areaScore * compactnessNorm));

    if (confidence < this.minConfidence) {
      this.missesInRow++;
      return null;
    }
    this.missesInRow = 0;
    return { x: x0 + cx, y: y0 + cy, confidence, radiusPx: r };
  }
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}
