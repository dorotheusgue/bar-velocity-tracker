import { useRef } from 'react';
import { domToVideoCoords } from '../lib/coords';

interface Props {
  visible: boolean;
  hint: string;
  videoWidth: number;
  videoHeight: number;
  onTap: (videoX: number, videoY: number) => void;
}

/**
 * Full-screen tap layer shown when the template tracker needs a seed point.
 * Translates the DOM tap back into the *video pixel* space the tracker
 * expects, accounting for `object-fit: cover` on the underlying video.
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
