interface BarData {
  id: string;
  index: number;
  value: number;
  highlight?: boolean;
}

interface Props {
  data: BarData[];
  height?: number;
  /** Optional horizontal reference line (e.g. target velocity). */
  reference?: number;
  /** Y-axis upper bound; falls back to 1.2 × max value. */
  yMax?: number;
  formatValue?: (v: number) => string;
}

const PAD = { left: 28, right: 8, top: 14, bottom: 22 };

export default function MiniBarChart({
  data,
  height = 200,
  reference,
  yMax,
  formatValue = (v) => v.toFixed(2),
}: Props) {
  if (data.length === 0) return null;
  const maxValue = yMax ?? Math.max(0.1, ...data.map((d) => d.value)) * 1.2;
  return (
    <div className="mini-chart" style={{ height }}>
      <svg
        viewBox={`0 0 ${300} ${height}`}
        preserveAspectRatio="none"
        className="mini-chart__svg"
      >
        <Axis maxValue={maxValue} width={300} height={height} />
        {reference != null && (
          <ReferenceLine
            value={reference}
            maxValue={maxValue}
            width={300}
            height={height}
          />
        )}
        <Bars data={data} maxValue={maxValue} width={300} height={height} formatValue={formatValue} />
      </svg>
    </div>
  );
}

function Bars({
  data,
  maxValue,
  width,
  height,
  formatValue,
}: {
  data: BarData[];
  maxValue: number;
  width: number;
  height: number;
  formatValue: (v: number) => string;
}) {
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / data.length;
  const barWidth = Math.min(slot * 0.7, 40);
  return (
    <g>
      {data.map((d, i) => {
        const barH = (d.value / maxValue) * plotH;
        const x = PAD.left + i * slot + (slot - barWidth) / 2;
        const y = PAD.top + (plotH - barH);
        const fill = d.highlight ? 'var(--good)' : 'var(--accent)';
        return (
          <g key={d.id}>
            <rect x={x} y={y} width={barWidth} height={Math.max(2, barH)} rx={3} ry={3} fill={fill} />
            <text
              x={x + barWidth / 2}
              y={y - 4}
              fill="var(--text-dim)"
              fontSize="10"
              textAnchor="middle"
            >
              {formatValue(d.value)}
            </text>
            <text
              x={x + barWidth / 2}
              y={height - 6}
              fill="var(--text-dim)"
              fontSize="10"
              textAnchor="middle"
            >
              {d.index}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Axis({ maxValue, width, height }: { maxValue: number; width: number; height: number }) {
  const plotH = height - PAD.top - PAD.bottom;
  const ticks = 3;
  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const v = (maxValue / ticks) * i;
        const y = PAD.top + plotH - (v / maxValue) * plotH;
        return (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
            />
            <text x={PAD.left - 4} y={y + 3} fill="var(--text-dim)" fontSize="9" textAnchor="end">
              {v.toFixed(2)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function ReferenceLine({
  value,
  maxValue,
  width,
  height,
}: {
  value: number;
  maxValue: number;
  width: number;
  height: number;
}) {
  const plotH = height - PAD.top - PAD.bottom;
  const y = PAD.top + plotH - (value / maxValue) * plotH;
  return (
    <line
      x1={PAD.left}
      x2={width - PAD.right}
      y1={y}
      y2={y}
      stroke="var(--good)"
      strokeDasharray="4 4"
      strokeWidth={1.5}
    />
  );
}
