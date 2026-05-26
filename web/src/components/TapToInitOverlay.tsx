import { useRef } from 'react';

interface Props {
  visible: boolean;
  hint: string;
  videoWidth: number;
  videoHeight: number;
  onTap: (videoX: number, videoY: number) => void;
}

/**
 * Full-screen tap layer shown when the template tracker needs a seed point.
 * Translates the DOM tap coordinates back into the *video pixel* space the
 * tracker expects, accounting for `object-fit: cover` on the underlying video.
 */
export default function TapToInitOverlay({
  visible,
  hint,
  videoWidth,
  videoHeight,
  onTap,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  if (!visible) return null;

  function handlePointer(event: React.PointerEvent<HTMLDivElement>) {
    if (!ref.current || videoWidth === 0 || videoHeight === 0) return;
    const rect = ref.current.getBoundingClientRect();
    const point = domToVideoCoords(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      videoWidth,
      videoHeight
    );
    onTap(point.x, point.y);
  }

  return (
    <div ref={ref} className="tap-init" onPointerDown={handlePointer}>
      <div className="tap-init__crosshair" aria-hidden>
        <span className="tap-init__h" />
        <span className="tap-init__v" />
        <span className="tap-init__ring" />
      </div>
      <p className="tap-init__hint">{hint}</p>
    </div>
  );
}

/**
 * Inverse of `object-fit: cover`: figure out where in the underlying video a
 * DOM tap landed. The video is scaled by `max(cw/vw, ch/vh)` so the smaller
 * dimension overflows, then centered.
 */
function domToVideoCoords(
  cx: number,
  cy: number,
  cw: number,
  ch: number,
  vw: number,
  vh: number
): { x: number; y: number } {
  const scale = Math.max(cw / vw, ch / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  return {
    x: Math.max(0, Math.min(vw - 1, (cx - ox) / scale)),
    y: Math.max(0, Math.min(vh - 1, (cy - oy) / scale)),
  };
}
