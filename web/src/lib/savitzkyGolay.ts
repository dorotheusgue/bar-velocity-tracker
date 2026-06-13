/**
 * Savitzky–Golay smoothing + analytic first derivative.
 *
 * Fits a low-order polynomial to a sliding window by least squares and reads
 * the fitted value (smoothing) and its slope (derivative) at the centre. Run
 * over a complete, already-recorded signal it is **non-causal / zero phase** —
 * no lag, no peak clipping — which is exactly what we want offline.
 *
 * Boundaries are handled without shrinking the window: near an edge we keep a
 * full window but evaluate the fitted polynomial at the (off-centre) offset of
 * the target sample, which is the standard SG boundary treatment.
 *
 * Pure and deterministic: same input → same output, no globals, no time source.
 */

/** Solve A·x = b for a small dense system via Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Augment.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    // Pivot.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const diag = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / diag;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  // After full elimination each row is diagonal: x[i] = aug / diagonal.
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * Build the SG coefficient matrix `Minv` of shape (order+1) × windowSize, where
 * column i holds the contribution of window sample i to each fitted polynomial
 * coefficient c_0..c_order. Centre offsets run from -m..+m.
 */
function sgCoeffMatrix(windowSize: number, order: number): number[][] {
  const m = (windowSize - 1) / 2;
  // Vandermonde A[i][j] = (i - m)^j
  const A: number[][] = [];
  for (let i = 0; i < windowSize; i++) {
    const x = i - m;
    const row: number[] = [];
    let xp = 1;
    for (let j = 0; j <= order; j++) {
      row.push(xp);
      xp *= x;
    }
    A.push(row);
  }
  // Normal matrix ATA ((order+1)×(order+1)) and we want (ATA)^-1 AT.
  const dim = order + 1;
  const ATA: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let k = 0; k < dim; k++) {
      let s = 0;
      for (let i = 0; i < windowSize; i++) s += A[i][j] * A[i][k];
      ATA[j][k] = s;
    }
  }
  // Minv[j][i] = sum_k (ATA^-1)[j][k] * A[i][k]  — solve column by column.
  // Compute ATA inverse columns by solving ATA·col = e_k.
  const inv: number[][] = Array.from({ length: dim }, () => new Array(dim).fill(0));
  for (let k = 0; k < dim; k++) {
    const e = new Array(dim).fill(0);
    e[k] = 1;
    const col = solve(ATA.map((r) => [...r]), e);
    for (let j = 0; j < dim; j++) inv[j][k] = col[j];
  }
  const Minv: number[][] = Array.from({ length: dim }, () => new Array(windowSize).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let i = 0; i < windowSize; i++) {
      let s = 0;
      for (let k = 0; k < dim; k++) s += inv[j][k] * A[i][k];
      Minv[j][i] = s;
    }
  }
  return Minv; // (order+1) × windowSize
}

export interface SGResult {
  value: number[]; // zero-phase smoothed signal
  deriv: number[]; // first derivative per unit of x (divide handled via `h`)
}

/**
 * Smooth `y` and compute its first derivative.
 * @param y      samples (uniformly spaced)
 * @param windowSize odd window length (auto-clamped to [order+2 .. y.length], forced odd)
 * @param order  polynomial order (>=2 recommended)
 * @param h      sample spacing in the derivative's denominator (e.g. dt seconds)
 */
export function savitzkyGolay(
  y: number[],
  windowSize: number,
  order: number,
  h: number
): SGResult {
  const n = y.length;
  const value = new Array(n).fill(0);
  const deriv = new Array(n).fill(0);
  if (n === 0) return { value, deriv };
  if (n === 1) {
    value[0] = y[0];
    return { value, deriv };
  }

  // Clamp window: odd, >= order+2, <= n (also odd).
  let w = Math.min(windowSize, n);
  if (w % 2 === 0) w -= 1;
  const minW = order + 2 + ((order + 2) % 2 === 0 ? 1 : 0);
  if (w < minW) w = Math.min(minW, n % 2 === 0 ? n - 1 : n);
  if (w < 3) {
    // Degenerate: fall back to forward/centred finite differences.
    for (let i = 0; i < n; i++) value[i] = y[i];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      deriv[i] = (y[b] - y[a]) / ((b - a) * h || h);
    }
    return { value, deriv };
  }

  const m = (w - 1) / 2;
  const Minv = sgCoeffMatrix(w, order);

  for (let i = 0; i < n; i++) {
    // Window start clamped so the window stays full size.
    let start = i - m;
    if (start < 0) start = 0;
    if (start + w > n) start = n - w;
    const center = start + m;
    const d = i - center; // offset of target sample from window centre

    // Coefficients for value (sum_j d^j * Minv[j][i']) and
    // derivative (sum_{j>=1} j*d^{j-1} * Minv[j][i']).
    let v = 0;
    let dv = 0;
    for (let ip = 0; ip < w; ip++) {
      let valC = 0;
      let derC = 0;
      let dPow = 1; // d^0
      for (let j = 0; j < Minv.length; j++) {
        valC += dPow * Minv[j][ip];
        if (j >= 1) derC += j * (d === 0 ? (j === 1 ? 1 : 0) : Math.pow(d, j - 1)) * Minv[j][ip];
        dPow *= d;
      }
      v += valC * y[start + ip];
      dv += derC * y[start + ip];
    }
    value[i] = v;
    deriv[i] = dv / h;
  }

  return { value, deriv };
}
