/**
 * Loads a user-picked video file into a <video> element using an object URL.
 * Mirrors the shape of `camera.ts` so the training engine can swap sources
 * without changing any downstream logic.
 */
export interface VideoFileHandle {
  width: number;
  height: number;
  duration: number;
  filename: string;
  dispose: () => void;
}

export async function loadVideoFile(
  video: HTMLVideoElement,
  file: File
): Promise<VideoFileHandle> {
  const url = URL.createObjectURL(file);

  // Override the JSX `autoPlay` attribute. Autoplaying then immediately
  // pausing produces a play/pause race that leaves Safari with a black canvas.
  video.autoplay = false;
  video.srcObject = null;
  video.src = url;
  video.loop = false;
  video.muted = true;
  video.controls = false;
  video.setAttribute('playsinline', 'true');
  video.load();

  try {
    await waitForVideoReady(video);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }

  // Force the browser to decode and paint the first frame. iOS Safari (and
  // sometimes Chrome on Android) shows a black frame for a paused video at
  // currentTime = 0 until play() is called; a tiny seek + waiting for the
  // `seeked` event makes the frame visible.
  await paintFirstFrame(video);

  return {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    filename: file.name,
    dispose: () => {
      URL.revokeObjectURL(url);
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Could not decode that video. Try an MP4 (H.264) file.'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function paintFirstFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      clearTimeout(timeoutId);
      resolve();
    };
    video.addEventListener('seeked', finish);
    const target =
      Number.isFinite(video.duration) && video.duration > 0.1 ? 0.04 : 0;
    try {
      video.currentTime = target;
    } catch {
      finish();
      return;
    }
    // Some browsers won't fire `seeked` if currentTime didn't actually change;
    // unblock after a short timeout so we never hang the loader.
    const timeoutId = window.setTimeout(finish, 1200);
  });
}
