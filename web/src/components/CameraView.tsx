import { forwardRef } from 'react';

interface Props {
  className?: string;
}

const CameraView = forwardRef<HTMLVideoElement, Props>(function CameraView(props, ref) {
  return (
    <video
      ref={ref}
      className={`camera-view ${props.className ?? ''}`}
      autoPlay
      muted
      playsInline
    />
  );
});

export default CameraView;
