"use client";

// ============================================================
// Mise — the dashboard's charts (Part 35 L5, Recharts)
// ============================================================
// Built to the dataviz method: the form is chosen by the data's job, colour
// comes last, and the categorical palette below was RUN through the skill's
// validator (lightness band, chroma floor, CVD and normal-vision separation,
// contrast on white) — all six checks pass. Status colours (good/bad) are
// kept for profit and loss and never reused for a series.
//
// Every figure arrives as a plain number: Prisma.Decimal cannot cross into a
// Client Component. Every chart has a hover tooltip, text wears ink tokens
// rather than series colours, and there is exactly one y-axis per chart.
// ============================================================

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Fixed order, never cycled — a series keeps its colour when others hide. */
// Kong (2026-09-28) rejected the first set as off-brand. This one starts from
// the brand's own olive and stays earthy — and still passes all six checks
// of the dataviz validator (re-run on this exact order; the order matters,
// olive beside clay fails colour-blind separation).
export const SERIES = ["#5E6B14", "#8A4F9E", "#C0692B", "#008F84", "#A8820A"] as const;

const INK = "#262811";
const INK_MUTED = "#5A5C31";
const GRID = "#E9E3C8";
const GOOD = "#5A7333";
const BAD = "#A83A22";
const NEUTRAL = "#8B8D63";
const BRAND = "#41431B";

const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const compact = (n: number) =>
  new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });

const axis = { stroke: GRID, tick: { fill: INK_MUTED, fontSize: 12 }, tickLine: false } as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium text-foreground">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-foreground">
          {r.color ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.color }} /> : null}
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-4 tabular-nums">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// 1. Revenue per day, one line per branch
// ------------------------------------------------------------
export type RevenueSeries = { branchId: string; name: string; color: string };
export type RevenueRow = { day: string } & Record<string, number | string>;

export function RevenueTrendChart({ rows, series }: { rows: RevenueRow[]; series: RevenueSeries[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} minTickGap={24} {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={{ stroke: NEUTRAL, strokeDasharray: "3 3" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipBox
                  title={dayLabel(String(label))}
                  rows={payload.map((p) => ({ label: String(p.name), value: baht(Number(p.value)), color: String(p.color) }))}
                />
              ) : null
            }
          />
          {series.length > 1 ? (
            <Legend
              verticalAlign="top"
              height={32}
              onClick={(e) => toggle(String((e as { dataKey?: unknown }).dataKey))}
              formatter={(value, entry) => (
                <span
                  className="cursor-pointer text-sm"
                  style={{ color: hidden.has(String((entry as { dataKey?: unknown }).dataKey)) ? NEUTRAL : INK }}
                >
                  {value}
                </span>
              )}
            />
          ) : null}
          {series.map((s) => (
            <Line
              key={s.branchId}
              type="monotone"
              dataKey={s.branchId}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: "#FFFFFF", strokeWidth: 2 }}
              hide={hidden.has(s.branchId)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// 3. From sales to profit — a waterfall
// ------------------------------------------------------------
export type WaterfallInput = { revenue: number; cogs: number; opex: number; net: number };

export function PnlWaterfallChart({ data }: { data: WaterfallInput }) {
  const { revenue, cogs, opex, net } = data;
  const gross = revenue - cogs;
  // Each bar is a RANGE [low, high], so a step floats at the level the money
  // reached — and a loss simply reaches below zero. (A transparent stacked
  // base cannot do that: Recharts stacks negatives from zero separately.)
  const span = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)];
  const rows = [
    { name: "ยอดขาย", range: span(0, revenue), color: BRAND, shown: revenue },
    { name: "ต้นทุนขาย", range: span(revenue, gross), color: BAD, shown: -cogs },
    { name: "ค่าใช้จ่าย", range: span(gross, net), color: BAD, shown: -opex },
    { name: "กำไรสุทธิ", range: span(0, net), color: net >= 0 ? GOOD : BAD, shown: net },
  ];

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }} barCategoryGap="28%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={{ fill: "rgb(174 183 132 / 0.14)" }}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as (typeof rows)[number]) : null;
              return r ? <TooltipBox title={r.name} rows={[{ label: "จำนวน", value: baht(r.shown) }]} /> : null;
            }}
          />
          <Bar dataKey="range" radius={4}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// 3b. Month by month — revenue vs expenses, with net profit as a line
// ------------------------------------------------------------
// From Kong's own "Finance Dashboard" (2026-09-28): the chart he already
// reads every month. Kept: bars for money in and out, a line for what is
// left, the picked month bright and the others faded, click a month to open
// it. Changed: ONE y-axis — all three series are baht, and his margin chart's
// second axis is the dataviz #1 anti-pattern — and a month whose cost cannot
// be worked out shows no expense bar and no profit point rather than a fake 0.
export type MonthPoint = {
  key: string;
  label: string;
  revenue: number | null;
  expenses: number | null;
  net: number | null;
  note: string | null;
};

export function MonthlyPnlChart({ points, active }: { points: MonthPoint[]; active: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = (key: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("p", key);
    router.push(`/dashboard?${q.toString()}`, { scroll: false });
  };
  const fade = (key: string) => (active === null || active === key ? 1 : 0.35);
  const prevOf = (i: number) => (i > 0 ? points[i - 1] : null);
  const growth = (cur: number | null, prev: number | null | undefined) =>
    cur === null || prev === null || prev === undefined || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: BRAND }} />รายรับ</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERIES[2] }} />รายจ่าย (ต้นทุนขาย + ค่าใช้จ่าย)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5" style={{ backgroundColor: GOOD }} />กำไรสุทธิ</span>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart
            data={points}
            margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
            barCategoryGap="24%"
            onClick={(e) => {
              const key = (e as { activeLabel?: string } | null)?.activeLabel;
              const pt = points.find((p) => p.label === key);
              if (pt) open(pt.key);
            }}
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
            <Tooltip
              cursor={{ fill: "rgb(174 183 132 / 0.14)" }}
              content={({ active: a, payload }) => {
                const pt = a && payload?.length ? (payload[0].payload as MonthPoint) : null;
                if (!pt) return null;
                const i = points.indexOf(pt);
                const g = growth(pt.revenue, prevOf(i)?.revenue);
                const margin = pt.net !== null && pt.revenue ? `${((pt.net / pt.revenue) * 100).toFixed(1)}%` : "—";
                return (
                  <TooltipBox
                    title={`${pt.label} · กดเพื่อดูเดือนนี้`}
                    rows={[
                      { label: "รายรับ", value: pt.revenue === null ? "ยังไม่มียอดขาย" : `${baht(pt.revenue)}${g === null ? "" : `  (${g >= 0 ? "+" : ""}${g.toFixed(1)}%)`}` },
                      { label: "รายจ่าย", value: pt.expenses === null ? "คำนวณไม่ได้" : baht(pt.expenses) },
                      { label: "กำไรสุทธิ", value: pt.net === null ? "—" : baht(pt.net) },
                      { label: "อัตรากำไร", value: margin },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]} cursor="pointer">
              {points.map((p) => (
                <Cell key={p.key} fill={BRAND} fillOpacity={fade(p.key)} />
              ))}
            </Bar>
            <Bar dataKey="expenses" radius={[4, 4, 0, 0]} cursor="pointer">
              {points.map((p) => (
                <Cell key={p.key} fill={SERIES[2]} fillOpacity={fade(p.key)} />
              ))}
            </Bar>
            <Line
              dataKey="net"
              stroke={GOOD}
              strokeWidth={2.5}
              connectNulls={false}
              dot={(props: { cx?: number; cy?: number; payload?: MonthPoint; index?: number }) => {
                const { cx, cy, payload, index } = props;
                if (cx === undefined || cy === undefined || !payload || payload.net === null) {
                  return <g key={`d${index}`} />;
                }
                const on = active === null || active === payload.key;
                return (
                  <circle
                    key={`d${index}`}
                    cx={cx}
                    cy={cy}
                    r={on ? 5 : 3}
                    fill={payload.net >= 0 ? GOOD : BAD}
                    stroke="#FFFFFF"
                    strokeWidth={2}
                    opacity={on ? 1 : 0.5}
                  />
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {points.some((p) => p.note) ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {points
            .filter((p) => p.note)
            .map((p) => `${p.label}: ${p.note}`)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// 4. Best sellers
// ------------------------------------------------------------
export type MenuBar = { name: string; net: number; qty: number };

export function TopMenusChart({ rows }: { rows: MenuBar[] }) {
  if (rows.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>;
  }
  return (
    <div className="w-full" style={{ height: Math.max(160, rows.length * 34 + 16) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tickFormatter={compact} {...axis} />
          <YAxis type="category" dataKey="name" width={150} {...axis} axisLine={false} tick={{ fill: INK, fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: "rgb(174 183 132 / 0.14)" }}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as MenuBar) : null;
              return r ? (
                <TooltipBox
                  title={r.name}
                  rows={[
                    { label: "ยอดขาย", value: baht(r.net) },
                    { label: "จำนวนที่ขาย", value: r.qty.toLocaleString("th-TH") },
                  ]}
                />
              ) : null;
            }}
          />
          <Bar dataKey="net" fill={SERIES[0]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
