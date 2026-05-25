/**
 * Thin wrapper around getUserMedia. Owns the MediaStream and reports the
 * actual negotiated resolution (the browser may downgrade what we ask for).
 */
export interface CameraOptions {
  facingMode: 'user' | 'environment';
  width?: number;
  height?: number;
}

export interface CameraHandle {
  stream: MediaStream;
  width: number;
  height: number;
  facingMode: 'user' | 'environment';
  stop: () => void;
}

export async function startCamera(
  video: HTMLVideoElement,
  options: CameraOptions
): Promise<CameraHandle> {
  const constraints: MediaStreamConstraints = {
    video: {
      facingMode: { ideal: options.facingMode },
      width: { ideal: options.width ?? 1920 },
      height: { ideal: options.height ?? 1080 },
    },
    audio: false,
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();

  // Wait for metadata so videoWidth/videoHeight are set.
  await waitForMetadata(video);

  const settings = stream.getVideoTracks()[0]?.getSettings() ?? {};
  return {
    stream,
    width: video.videoWidth || settings.width || options.width || 0,
    height: video.videoHeight || settings.height || options.height || 0,
    facingMode: (settings.facingMode as 'user' | 'environment') ?? options.facingMode,
    stop: () => stopCamera(stream, video),
  };
}

function stopCamera(stream: MediaStream, video: HTMLVideoElement) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
  video.pause();
  video.srcObject = null;
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const handler = () => {
      video.removeEventListener('loadedmetadata', handler);
      resolve();
    };
    video.addEventListener('loadedmetadata', handler, { once: true });
  });
}
