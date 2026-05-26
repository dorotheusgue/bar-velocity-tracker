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

  video.srcObject = null;
  video.src = url;
  video.loop = false;
  video.muted = true;
  video.controls = false;
  video.setAttribute('playsinline', 'true');

  try {
    await waitForVideoReady(video);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }

  video.pause();
  try {
    video.currentTime = 0;
  } catch {
    // Some browsers throw if metadata isn't fully loaded; ignore.
  }

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
