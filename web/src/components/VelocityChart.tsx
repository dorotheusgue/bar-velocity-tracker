import { useRef } from 'react';
import type { ChartSeries, RepSpan } from '../lib/trainingEngine';

interface Props {
  chart: ChartSeries;
  repSpans: RepSpan[];
  duration: number;
  currentTime: number;
  targetVelocity: number;
  onSeek: (t: number) => void;
}

const W = 600;
const H = 150;
const PAD = { left: 34, right: 8, top: 14, bottom: 16 };

/**
 * Velocity–time chart for the analysed set. Single series (bar velocity),
 * concentric rep spans shaded and numbered, dashed target-velocity reference,
 * and a playhead that scrubs the video on drag — the chart *is* the timeline.
 */
export default function VelocityChart({
  chart,
  repSpans,
  duration,
  currentTime,
  targetVelocity,
  onSeek,
}: Props) {
  const ref = useRef<SVGSVGElement | null>(null);

  const tMax = duration || chart.t[chart.t.length - 1] || 1;
  let vMin = 0;
  let vMax = 0.5;
  for (const v of chart.v) {
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  vMax = Math.max(vMax, targetVelocity) * 1.1;
  vMin = vMin * 1.1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const xOf = (t: number) => PAD.left + (t / tMax) * plotW;
  const yOf = (v: number) => PAD.top + (1 - (v - vMin) / (vMax - vMin)) * plotH;

  const line = chart.t
    .map((t, i) => `${xOf(t).toFixed(1)},${yOf(chart.v[i]).toFixed(1)}`)
    .join(' ');

  function seekFromEvent(e: React.PointerEvent<SVGSVGElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width; // 0..1 across rendered width
    const t = ((fx * W - PAD.left) / plotW) * tMax;
    onSeek(Math.max(0, Math.min(tMax, t)));
  }

  return (
    <svg
      ref={ref}
      className="vchart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        seekFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0) seekFromEvent(e);
      }}
    >
      {/* Concentric rep spans */}
      {repSpans.map((s) => (
        <g key={s.index}>
          <rect
            className="vchart__span"
            x={xOf(s.start)}
            y={PAD.top}
            width={Math.max(1, xOf(s.end) - xOf(s.start))}
            height={plotH}
          />
          <text
            className="vchart__span-label"
            x={(xOf(s.start) + xOf(s.end)) / 2}
            y={PAD.top + 10}
            textAnchor="middle"
          >
            {s.index}
          </text>
        </g>
      ))}

      {/* Zero baseline + target reference */}
      <line className="vchart__zero" x1={PAD.left} x2={W - PAD.right} y1={yOf(0)} y2={yOf(0)} />
      <line
        className="vchart__target"
        x1={PAD.left}
        x2={W - PAD.right}
        y1={yOf(targetVelocity)}
        y2={yOf(targetVelocity)}
      />
      <text className="vchart__axis-label" x={PAD.left - 4} y={yOf(targetVelocity) + 3} textAnchor="end">
        {targetVelocity.toFixed(1)}
      </text>
      <text className="vchart__axis-label" x={PAD.left - 4} y={yOf(0) + 3} textAnchor="end">
        0
      </text>

      {/* Velocity line */}
      <polyline className="vchart__line" points={line} />

      {/* Playhead */}
      <line
        className="vchart__playhead"
        x1={xOf(currentTime)}
        x2={xOf(currentTime)}
        y1={PAD.top}
        y2={PAD.top + plotH}
      />
    </svg>
  );
}
