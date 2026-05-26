interface Props {
  filename: string | null;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSeek: (time: number) => void;
}

export default function PlaybackControls(props: Props) {
  const { isPaused, currentTime, duration, filename } = props;
  const max = duration > 0 ? duration : 0;

  return (
    <div className="playback">
      <div className="playback__row">
        <button
          type="button"
          className="playback__btn"
          aria-label={isPaused ? 'Play' : 'Pause'}
          onClick={props.onTogglePlay}
        >
          {isPaused ? '▶' : '⏸'}
        </button>
        <button
          type="button"
          className="playback__btn"
          aria-label="Restart"
          onClick={props.onRestart}
        >
          ⤺
        </button>
        <input
          type="range"
          className="playback__scrub"
          min={0}
          max={max || 0.0001}
          step={0.01}
          value={Math.min(currentTime, max || currentTime)}
          onChange={(e) => props.onSeek(parseFloat(e.target.value))}
          aria-label="Seek"
        />
        <span className="playback__time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      {filename && <div className="playback__filename" title={filename}>{filename}</div>}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
