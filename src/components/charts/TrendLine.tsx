"use client";

// ============================================================
// Mise — one line over months, and its sparkline (Kong, 2026-10-28)
// ============================================================
// The look Kong approved for แนวโน้มยอดขาย (artifact Qjyn322irmDt34oQH42Nbf),
// drawn in plain SVG at the container's REAL pixel width — a scaled viewBox
// made the axis text grow and shrink with the card:
//  - a monotone curve (it never bulges past a month's real value), 2px, with a
//    soft wash beneath and a dot on every month;
//  - a dashed average line, the best month marked in terracotta;
//  - a crosshair that snaps to the nearest month and ONE tooltip beside the
//    point (never on top of the line), value first;
//  - arrow keys move between months, Enter = click.
// A month with no data is a gap: the line breaks, nothing is drawn at ฿0.
// ============================================================

import { useEffect, useId, useRef, useState } from "react";
import { GRID, INK, INK_MUTED, TONES } from "./chart-theme";

const ACCENT = TONES.clay[0];
const SURFACE = "#FFFFFF";

export type TrendLineProps = {
  labels: string[];
  /** Tooltip title per point (e.g. the full month). */
  titles?: string[];
  values: (number | null)[];
  color: string;
  height?: number;
  axis: (v: number) => string;
  tip: (v: number) => string;
  rows?: (i: number) => { label: string; value: string; tone?: "good" | "bad" }[];
  onPick?: (i: number) => void;
  /** Months to ring and label (TR4 "ราคาลด"). */
  rings?: number[];
  ringLabel?: string;
  avg?: boolean;
  label: string;
};

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** Monotone cubic (Fritsch–Carlson) through the points of one unbroken run. */
export function monotonePath(p: [number, number][]): string {
  const n = p.length;
  if (n === 0) return "";
  if (n < 3) return "M " + p.map((q) => q.join(" ")).join(" L ");
  const dx: number[] = [];
  const m: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1][0] - p[i][0];
    m[i] = (p[i + 1][1] - p[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  let d = `M ${p[0][0]} ${p[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${p[i][0] + h} ${p[i][1] + t[i] * h}, ${p[i + 1][0] - h} ${p[i + 1][1] - t[i + 1] * h}, ${p[i + 1][0]} ${p[i + 1][1]}`;
  }
  return d;
}

/** Unbroken runs of known values, as [index, value] pairs. */
function runs(values: (number | null)[]): [number, number][][] {
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push([i, v]);
  });
  if (cur.length) out.push(cur);
  return out;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export default function TrendLine(props: TrendLineProps) {
  const { labels, values, color, height = 240, axis, tip, rows, onPick, rings = [], ringLabel, avg = false } = props;
  const [ref, measured] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipBox, setTipBox] = useState({ w: 180, h: 80 });
  const gid = useId().replace(/:/g, "");

  const W = Math.max(280, measured || 600);
  const H = height;
  const L = 52;
  const R = 16;
  const T = 22;
  const B = 30;
  const n = values.length;
  const known = values.filter((v): v is number => v !== null);

  useEffect(() => {
    if (hover === null || !tipRef.current) return;
    const r = tipRef.current.getBoundingClientRect();
    if (Math.abs(r.width - tipBox.w) > 1 || Math.abs(r.height - tipBox.h) > 1) setTipBox({ w: r.width, h: r.height });
  }, [hover, tipBox.w, tipBox.h]);

  if (known.length === 0) {
    return (
      <div ref={ref} className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        ยังไม่มียอดขายในช่วงนี้
      </div>
    );
  }

  let lo = Math.min(...known);
  let hi = Math.max(...known);
  const pad = (hi - lo) * 0.25 || Math.abs(hi) * 0.1 || 1;
  lo = Math.max(0, lo - pad);
  hi = hi + pad;
  const step = niceStep((hi - lo) / 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 1000; t += step) ticks.push(t);

  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const every = Math.max(1, Math.ceil((n * 56) / (W - L - R)));
  const best = values.indexOf(Math.max(...known));
  const last = values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  const segs = runs(values);

  const nearest = (clientX: number, rect: DOMRect) => {
    const fx = clientX - rect.left;
    let b = 0;
    let dist = Infinity;
    for (let i = 0; i < n; i++) {
      if (values[i] === null) continue;
      const dd = Math.abs(x(i) - fx);
      if (dd < dist) {
        dist = dd;
        b = i;
      }
    }
    return b;
  };
  const step1 = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < n; i += dir) if (values[i] !== null) return i;
    return from;
  };

  const hv = hover === null ? null : values[hover];
  const right = hover !== null && x(hover) + 16 + tipBox.w <= W;
  const tipLeft = hover === null ? 0 : right ? x(hover) + 16 : x(hover) - 16 - tipBox.w;
  const tipTop = hv === null || hv === undefined ? 0 : Math.min(Math.max(0, y(hv) - tipBox.h / 2), Math.max(0, H - B - tipBox.h));

  return (
    <div ref={ref} className="relative" style={{ height: H }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${props.label} ${labels[0] ?? ""} ถึง ${labels[n - 1] ?? ""}`}
        className="block max-w-full overflow-visible"
      >
        <defs>
          <linearGradient id={`tl-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.16} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
              {axis(t)}
            </text>
          </g>
        ))}
        {labels.map((lab, i) =>
          (n - 1 - i) % every === 0 ? (
            <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
              {lab}
            </text>
          ) : null
        )}
        {avg && known.length > 1 && (
          <g>
            <line x1={L} x2={W - R} y1={y(mean)} y2={y(mean)} stroke={INK_MUTED} strokeDasharray="4 4" opacity={0.55} />
            <text x={W - R} y={y(mean) - 6} textAnchor="end" fontSize={11} fill={INK_MUTED}>
              เฉลี่ย {axis(mean)}
            </text>
          </g>
        )}
        {segs.map((s, k) => {
          const pts = s.map(([i, v]) => [x(i), y(v)] as [number, number]);
          const d = monotonePath(pts);
          return (
            <g key={k}>
              {pts.length > 1 && <path d={`${d} L ${pts[pts.length - 1][0]} ${H - B} L ${pts[0][0]} ${H - B} Z`} fill={`url(#tl-${gid})`} />}
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="animate-draw-line"
              />
            </g>
          );
        })}
        {values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={SURFACE} stroke={color} strokeWidth={1.5} />))}
        {rings.map((i) =>
          values[i] === null || values[i] === undefined ? null : (
            <g key={`r${i}`}>
              <circle cx={x(i)} cy={y(values[i]!)} r={7} fill="none" stroke={INK} strokeWidth={1.5} />
              {ringLabel && (
                <text x={x(i)} y={y(values[i]!) + 24} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
                  {ringLabel}
                </text>
              )}
            </g>
          )
        )}
        {known.length > 1 && (
          <g>
            <circle cx={x(best)} cy={y(values[best]!)} r={5} fill={ACCENT} stroke={SURFACE} strokeWidth={2} />
            <text
              x={x(best)}
              y={y(values[best]!) - 12}
              textAnchor={best === 0 ? "start" : best === n - 1 ? "end" : "middle"}
              fontSize={11}
              fontWeight={600}
              fill={INK_MUTED}
            >
              สูงสุด
            </text>
          </g>
        )}
        {last >= 0 && last !== best && <circle cx={x(last)} cy={y(values[last]!)} r={4.5} fill={color} stroke={SURFACE} strokeWidth={2} />}
        {hover !== null && hv !== null && hv !== undefined && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={INK} opacity={0.3} />
            <circle cx={x(hover)} cy={y(hv)} r={5} fill={color} stroke={SURFACE} strokeWidth={2} />
          </g>
        )}
        <rect
          x={L - 10}
          y={0}
          width={W - L - R + 20}
          height={H}
          fill="transparent"
          tabIndex={0}
          className={`outline-none focus-visible:outline-none ${onPick ? "cursor-pointer" : ""}`}
          onPointerMove={(e) => setHover(nearest(e.clientX, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const i = nearest(e.clientX, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect());
            setHover(i);
            onPick?.(i);
          }}
          onFocus={() => setHover(last)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              setHover((h) => step1(h ?? last, -1));
              e.preventDefault();
            } else if (e.key === "ArrowRight") {
              setHover((h) => step1(h ?? last, 1));
              e.preventDefault();
            } else if (e.key === "Enter" && hover !== null) onPick?.(hover);
          }}
        />
      </svg>
      {hover !== null && hv !== null && hv !== undefined && (
        <div
          ref={tipRef}
          className="pointer-events-none absolute min-w-[11rem] rounded-xl border border-border bg-surface/95 px-3.5 py-2.5 text-sm shadow-lg backdrop-blur transition-[left,top] duration-75"
          style={{ left: tipLeft, top: tipTop }}
        >
          <p className="text-xs text-muted-foreground">{props.titles?.[hover] ?? labels[hover]}</p>
          <p className="font-display text-lg font-semibold tabular-nums">{tip(hv)}</p>
          {rows?.(hover).map((r) => (
            <p key={r.label} className="flex justify-between gap-4 text-xs text-muted-foreground">
              <span>{r.label}</span>
              <span className={`font-medium tabular-nums ${r.tone === "good" ? "text-good" : r.tone === "bad" ? "text-bad" : "text-foreground"}`}>{r.value}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** A tiny trend: grey line, the latest month a dot in the series colour. */
export function Sparkline({ values, color, width = 120, height = 32 }: { values: (number | null)[]; color: string; width?: number; height?: number }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className="block text-xs text-muted-foreground" style={{ height, lineHeight: `${height}px` }}>—</span>;
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const n = values.length;
  const x = (i: number) => 2 + (i * (width - 6)) / (n - 1 || 1);
  const y = (v: number) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (height - 8);
  const segs = runs(values);
  const lastI = values.reduce<number>((acc, v, i) => (v === null ? acc : i), -1);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="block max-w-full">
      {segs.map((s, k) => (
        <path key={k} d={monotonePath(s.map(([i, v]) => [x(i), y(v)]))} fill="none" stroke={INK_MUTED} strokeWidth={1.5} strokeLinecap="round" opacity={0.55} />
      ))}
      <circle cx={x(lastI)} cy={y(values[lastI]!)} r={3.5} fill={color} stroke={SURFACE} strokeWidth={1.5} />
    </svg>
  );
}
