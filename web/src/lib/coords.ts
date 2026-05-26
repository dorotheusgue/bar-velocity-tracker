export interface Point2D {
  x: number;
  y: number;
}

/**
 * Inverse of `object-fit: cover`. A `<video>` covered into a container is
 * scaled by `max(cw/vw, ch/vh)` and centred; this function maps a DOM tap
 * inside the container back into the underlying video's pixel space.
 */
export function domToVideoCoords(
  domX: number,
  domY: number,
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): Point2D {
  if (videoW === 0 || videoH === 0) return { x: 0, y: 0 };
  const scale = Math.max(containerW / videoW, containerH / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = (containerW - dw) / 2;
  const oy = (containerH - dh) / 2;
  return {
    x: Math.max(0, Math.min(videoW - 1, (domX - ox) / scale)),
    y: Math.max(0, Math.min(videoH - 1, (domY - oy) / scale)),
  };
}

/**
 * Forward direction: where in the container does a given video pixel land?
 * Useful for placing DOM markers on top of the live preview at points known
 * in video coordinates.
 */
export function videoToDomCoords(
  videoX: number,
  videoY: number,
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number
): Point2D {
  if (videoW === 0 || videoH === 0) return { x: 0, y: 0 };
  const scale = Math.max(containerW / videoW, containerH / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = (containerW - dw) / 2;
  const oy = (containerH - dh) / 2;
  return {
    x: ox + videoX * scale,
    y: oy + videoY * scale,
  };
}
