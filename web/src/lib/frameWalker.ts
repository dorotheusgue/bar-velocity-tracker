/**
 * Deterministic frame-by-frame video walking.
 *
 * The previous engine drove processing from requestVideoFrameCallback *while
 * playing*, which drops frames under load — so the same clip produced different
 * numbers each run. The deterministic primitive is instead: set
 * `video.currentTime`, await the `seeked` event, read the now-decoded frame.
 * Each step blocks on its own seek, so nothing is ever dropped. It is slower
 * than real-time, which is fine offline (we show a progress bar).
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
function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 3000): Promise<void> {
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
    const timer = setTimeout(done, timeoutMs);
    // If currentTime is already essentially `time`, the seek may not fire;
    // nudge by setting anyway — the timeout guards against a no-op.
    video.currentTime = time;
  });
}

/**
 * Measure the clip's frame rate once via a short requestVideoFrameCallback
 * sample (median inter-frame delta). Falls back to 30 fps where rVFC is
 * unavailable. Used only for measurement — it tolerates dropped frames.
 */
export async function probeFrameRate(video: HTMLVideoElement): Promise<number> {
  const anyVideo = video as unknown as {
    requestVideoFrameCallback?: (
      cb: (now: number, md: { mediaTime?: number }) => void
    ) => number;
  };
  if (!anyVideo.requestVideoFrameCallback) return 30;

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
      anyVideo.requestVideoFrameCallback!(onFrame);
    };
    anyVideo.requestVideoFrameCallback!(onFrame);
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
  // Clamp to a sane range and snap to common rates to fight jitter.
  const clamped = Math.max(15, Math.min(240, fps));
  const common = [24, 25, 30, 48, 50, 60, 90, 120, 240];
  for (const c of common) {
    if (Math.abs(clamped - c) / c < 0.06) return c;
  }
  return Math.round(clamped);
}

export interface FrameSample {
  index: number;
  t: number; // uniform video time = index / fps
  actualT: number; // video.currentTime after the seek (diagnostics)
}

export interface WalkOptions {
  fps: number;
  onFrame: (sample: FrameSample, ctx: CanvasRenderingContext2D) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Step through every frame of the clip in order. `onFrame` is called once per
 * frame with the decoded pixels already drawn into `ctx`. Never drops frames.
 */
export async function walkVideo(
  video: HTMLVideoElement,
  ctx: CanvasRenderingContext2D,
  opts: WalkOptions
): Promise<void> {
  const { fps, onFrame, onProgress, signal } = opts;
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (duration <= 0 || fps <= 0) return;
  video.pause();
  const dt = 1 / fps;
  // Stop a hair short of duration so the final seek always lands on a frame.
  const end = duration - dt * 0.5;

  let index = 0;
  for (let t = 0; t <= end; t += dt, index++) {
    if (signal?.aborted) return;
    await seekTo(video, t);
    if (signal?.aborted) return;
    drawVideoToContext(video, ctx);
    onFrame({ index, t, actualT: video.currentTime }, ctx);
    onProgress?.(Math.min(1, t / duration));
  }
  onProgress?.(1);
}
