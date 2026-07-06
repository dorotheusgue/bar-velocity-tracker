/**
 * Deterministic, fast frame-by-frame video walking.
 *
 * Two lessons learned the hard way:
 *  - Driving analysis from rVFC *during normal playback* drops frames under
 *    load, so the same clip produced different numbers each run.
 *  - Seeking to every frame is deterministic but brutally slow: each seek to a
 *    non-keyframe forces the browser to decode forward from the previous
 *    keyframe, making the walk O(frames × GOP length). A 30 s 120 fps clip
 *    took minutes.
 *
 * `walkVideoFast` combines both: Phase A plays the clip at a reduced
 * `playbackRate` (sequential decode — cheap) capturing each presented frame
 * via requestVideoFrameCallback; Phase B then seeks *only* to any frames that
 * were missed and processes them. Every frame index 0..n-1 is processed
 * exactly once either way, so the resulting trajectory is complete and stable
 * run-to-run.
 */

/** Draw the current video frame into ctx, resizing the canvas to match. */
export function drawVideoToContext(video: HTMLVideoElement, ctx: CanvasRenderingContext2D) {
  if (video.videoWidth === 0) return;
  if (ctx.canvas.width !== video.videoWidth || ctx.canvas.height !== video.videoHeight) {
    ctx.canvas.width = video.videoWidth;
    ctx.canvas.height = video.videoHeight;
  }
  ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
}

/** Resolve once the video has finished seeking to (approximately) `time`. */
export function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    // Timeout guards no-op seeks (currentTime already ≈ time never fires seeked).
    const timer = setTimeout(done, timeoutMs);
    video.currentTime = time;
  });
}

interface RvfcVideo {
  requestVideoFrameCallback?: (
    cb: (now: number, md: { mediaTime?: number }) => void
  ) => number;
  cancelVideoFrameCallback?: (h: number) => void;
}

/**
 * Measure the clip's frame rate once via a short requestVideoFrameCallback
 * sample (median inter-frame delta). Falls back to 30 fps where rVFC is
 * unavailable. Measurement only — it tolerates dropped frames.
 */
export async function probeFrameRate(video: HTMLVideoElement): Promise<number> {
  const rv = video as unknown as RvfcVideo;
  if (!rv.requestVideoFrameCallback) return 30;

  const wasPaused = video.paused;
  const times: number[] = [];
  const target = 10;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const onFrame = (_now: number, md: { mediaTime?: number }) => {
      if (md.mediaTime != null) times.push(md.mediaTime);
      if (times.length >= target) {
        finish();
        return;
      }
      rv.requestVideoFrameCallback!(onFrame);
    };
    rv.requestVideoFrameCallback!(onFrame);
    void video.play().catch(() => finish());
    setTimeout(finish, 1500);
  });

  if (wasPaused) video.pause();

  const deltas: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1];
    if (d > 0.0005 && d < 0.2) deltas.push(d);
  }
  if (deltas.length === 0) return 30;
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)];
  const fps = 1 / median;
  const clamped = Math.max(15, Math.min(240, fps));
  const common = [24, 25, 30, 48, 50, 60, 90, 120, 240];
  for (const c of common) {
    if (Math.abs(clamped - c) / c < 0.06) return c;
  }
  return Math.round(clamped);
}

/** Number of frames the walk will visit for a clip of `duration` at `fps`. */
export function frameCount(duration: number, fps: number): number {
  const dt = 1 / fps;
  return Math.max(1, Math.floor((duration - dt * 0.5) / dt) + 1);
}

export interface FastWalkOptions {
  fps: number;
  /** Called exactly once per frame index, in any order, pixels already drawn. */
  onFrame: (index: number, t: number, ctx: CanvasRenderingContext2D) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function walkVideoFast(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  opts: FastWalkOptions
): Promise<void> {
  const { fps, onFrame, onProgress, signal } = opts;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (duration <= 0 || fps <= 0) return;
  const dt = 1 / fps;
  const n = frameCount(duration, fps);
  const processed = new Uint8Array(n);
  let processedCount = 0;

  const process = (index: number) => {
    if (index < 0 || index >= n || processed[index]) return;
    drawVideoToContext(video, ctx);
    processed[index] = 1;
    processedCount++;
    onFrame(index, index * dt, ctx);
    onProgress?.(Math.min(0.98, processedCount / n));
  };

  video.pause();
  await seekTo(video, 0);
  if (signal?.aborted) return;
  process(0);

  // Phase A — sequential decode at a rate slow enough that our per-frame
  // processing (a few ms) plus the 60 Hz rVFC ceiling never skips frames.
  const rv = video as unknown as RvfcVideo;
  if (rv.requestVideoFrameCallback) {
    const prevRate = video.playbackRate;
    video.playbackRate = Math.max(0.0625, Math.min(1, 30 / fps));
    await new Promise<void>((resolve) => {
      let handle = 0;
      let watchdog = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(watchdog);
        video.removeEventListener('ended', finish);
        if (handle && rv.cancelVideoFrameCallback) {
          try {
            rv.cancelVideoFrameCallback(handle);
          } catch {
            /* already fired */
          }
        }
        resolve();
      };
      const rearmWatchdog = () => {
        window.clearTimeout(watchdog);
        // If decode stalls, bail out — Phase B backfills whatever is missing.
        watchdog = window.setTimeout(finish, 2500);
      };
      const onF = (_now: number, md: { mediaTime?: number }) => {
        handle = 0;
        if (done || signal?.aborted) {
          finish();
          return;
        }
        const mt = md.mediaTime ?? video.currentTime;
        process(Math.round(mt * fps));
        if (video.ended || mt >= duration - dt * 0.25) {
          finish();
          return;
        }
        handle = rv.requestVideoFrameCallback!(onF);
        rearmWatchdog();
      };
      video.addEventListener('ended', finish);
      handle = rv.requestVideoFrameCallback!(onF);
      rearmWatchdog();
      void video.play().catch(() => finish());
    });
    video.pause();
    video.playbackRate = prevRate;
  }
  if (signal?.aborted) return;

  // Phase B — backfill any missed frames with deterministic seeks. Usually
  // zero or a handful; this is what guarantees a complete trajectory.
  for (let i = 0; i < n; i++) {
    if (processed[i]) continue;
    if (signal?.aborted) return;
    await seekTo(video, i * dt);
    process(i);
  }
  onProgress?.(1);
}
