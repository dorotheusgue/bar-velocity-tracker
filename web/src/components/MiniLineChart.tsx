interface Props {
  values: number[];
  height?: number;
  stroke?: string;
}

/**
 * Tiny inline sparkline. Used in the history list to show per-session trend.
 */
export default function MiniLineChart({
  values,
  height = 48,
  stroke = 'var(--good)',
}: Props) {
  if (values.length < 2) return null;
  const width = 300;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const padY = 4;
  const plotH = height - padY * 2;

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = padY + plotH - ((v - min) / range) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height }}
    >
      <polyline fill="none" stroke={stroke} strokeWidth={2} points={points} />
      {values.map((v, i) => {
        const x = i * stepX;
        const y = padY + plotH - ((v - min) / range) * plotH;
        return <circle key={i} cx={x} cy={y} r={2.5} fill={stroke} />;
      })}
    </svg>
  );
}
