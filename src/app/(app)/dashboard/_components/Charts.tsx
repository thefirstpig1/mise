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

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MonthlyTrendResult } from "../trend-read";
import { readApi } from "@/lib/read-api";
import { STALE_TAB_MESSAGE, announceStale } from "@/lib/stale-tab";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ANIM,
  BAD,
  ChartGradients,
  ChartTooltip,
  GOOD,
  GRID,
  INK,
  INK_MUTED,
  NEUTRAL,
  axis,
  cursorFill,
  grad,
  solid,
} from "@/components/charts/chart-theme";

/** Fixed order, never cycled — a series keeps its colour when others hide. */
// Kong (2026-09-28) rejected the first set as off-brand. This one starts from
// the brand's own olive and stays earthy — and still passes all six checks
// of the dataviz validator (re-run on this exact order; the order matters,
// olive beside clay fails colour-blind separation).
export { SERIES } from "@/components/charts/chart-theme";

// The look (gradients, motion, tooltip) lives in chart-theme.tsx (Kong, 2026-09-28).

const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const compact = (n: number) =>
  new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });


/**
 * Makes a bar open something when clicked — spread onto a `<Bar>`.
 *
 * The click lives on the BAR, never on the chart. Recharts 3's chart-level
 * onClick reports `activeTooltipIndex` read from the HOVER state, which is
 * updated on the next animation frame: a click that arrives before it (or in
 * a background tab, where frames never run) sees `null`, and in v3 the index
 * is a string besides, so `typeof i === "number"` never matched at all. A
 * Bar's own onClick is handed the index of the element actually clicked.
 * The transparent background makes the whole column height clickable, so a
 * short bar is as easy to hit as a tall one.
 */
export function clickableBar(onIndex: (i: number) => void) {
  return {
    cursor: "pointer",
    background: { fill: "transparent", cursor: "pointer" },
    onClick: (_: unknown, i: number) => onIndex(i),
  };
}

const TooltipBox = ChartTooltip;

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
        <AreaChart key={rows.length} data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.branchId} id={`rev-${s.branchId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
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
            <Area
              key={s.branchId}
              type="monotone"
              dataKey={s.branchId}
              name={s.name}
              stroke={s.color}
              strokeWidth={2.5}
              fill={`url(#rev-${s.branchId})`}
              dot={false}
              activeDot={{ r: 6, stroke: "#FFFFFF", strokeWidth: 2.5 }}
              hide={hidden.has(s.branchId)}
              {...ANIM}
            />
          ))}
        </AreaChart>
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
    { name: "ยอดขาย", range: span(0, revenue), color: grad("olive"), shown: revenue },
    { name: "ต้นทุนขาย", range: span(revenue, gross), color: grad("bad"), shown: -cogs },
    { name: "ค่าใช้จ่าย", range: span(gross, net), color: grad("clay"), shown: -opex },
    { name: "กำไรสุทธิ", range: span(0, net), color: grad(net >= 0 ? "good" : "bad"), shown: net },
  ];

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart key={`${revenue}-${net}`} data={rows} margin={{ top: 24, right: 12, bottom: 0, left: 4 }} barCategoryGap="28%">
          <ChartGradients />
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="name" {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={cursorFill}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as (typeof rows)[number]) : null;
              return r ? <TooltipBox title={r.name} rows={[{ label: "จำนวน", value: baht(r.shown) }]} /> : null;
            }}
          />
          <Bar dataKey="range" radius={6} maxBarSize={88} {...ANIM}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.color} />
            ))}
            <LabelList
              dataKey="shown"
              position="top"
              formatter={(v: unknown) => compact(Number(v))}
              style={{ fill: INK, fontSize: 12, fontWeight: 600 }}
            />
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

export function MonthlyPnlChart({ points, active: shown }: { points: MonthPoint[]; active: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  // The clicked month lights up at once; the figures above follow when the
  // server has them (Kong, 2026-09-29: a click that shows nothing feels broken).
  const [picked, setPicked] = useState<string | null>(null);
  const active = pending && picked ? picked : shown;
  const open = (key: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("p", key);
    setPicked(key);
    start(() => router.push(`/dashboard?${q.toString()}`, { scroll: false }));
  };
  const onBar = (i: number) => {
    if (points[i]) open(points[i].key);
  };
  const fade = (key: string) => (active === null || active === key ? 1 : 0.35);
  const prevOf = (i: number) => (i > 0 ? points[i - 1] : null);
  const growth = (cur: number | null, prev: number | null | undefined) =>
    cur === null || prev === null || prev === undefined || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100;

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: solid("olive") }} />รายรับ</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: solid("clay") }} />รายจ่าย (ต้นทุนขาย + ค่าใช้จ่าย)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5" style={{ backgroundColor: GOOD }} />กำไรสุทธิ</span>
      </div>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ComposedChart
            key={points.length}
            data={points}
            margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
            barCategoryGap="24%"
          >
            <ChartGradients />
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
            <Tooltip
              cursor={cursorFill}
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
            <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={44} {...clickableBar(onBar)} {...ANIM}>
              {points.map((p) => (
                <Cell key={p.key} fill={grad("olive")} fillOpacity={fade(p.key)} />
              ))}
            </Bar>
            <Bar dataKey="expenses" radius={[6, 6, 0, 0]} maxBarSize={44} {...clickableBar(onBar)} {...ANIM}>
              {points.map((p) => (
                <Cell key={p.key} fill={grad("clay")} fillOpacity={fade(p.key)} />
              ))}
            </Bar>
            <Line
              dataKey="net"
              type="monotone"
              stroke={GOOD}
              strokeWidth={3}
              {...ANIM}
              animationBegin={400}
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

/**
 * The six-month chart, fetched in the browser once per BRANCH choice and kept
 * across every other click (see dashboard/trend-read.ts for why). Changing the
 * period only moves the highlight, so it never waits for six P&Ls again.
 */
export function MonthlyTrend({ branchIds, active }: { branchIds: string[]; active: string | null }) {
  const key = branchIds.join(",");
  const [got, setGot] = useState<{ key: string; points: MonthPoint[] } | { key: string; error: string; stale: boolean } | null>(
    null
  );
  useEffect(() => {
    if (got?.key === key) return;
    let live = true;
    readApi<MonthlyTrendResult>("/api/dashboard", "trend", { branchIds })
      // `undefined` = a tab older than the server (mise-ui-review §7).
      .then((r) => {
        if (!live) return;
        if (r?.ok) setGot({ key, points: r.points });
        else {
          if (!r) announceStale();
          setGot({ key, error: r?.formError ?? STALE_TAB_MESSAGE, stale: !r });
        }
      })
      .catch(() => {
        announceStale();
        if (live) setGot({ key, error: STALE_TAB_MESSAGE, stale: true });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (got && "error" in got) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {got.error}{" "}
        {got.stale ? (
          <button type="button" onClick={() => window.location.reload()} className="font-medium text-primary underline">
            รีเฟรชหน้า
          </button>
        ) : null}
      </p>
    );
  }
  // Another branch choice keeps the old chart up, faded, until the new one lands.
  if (!got) return <div className="h-72 animate-pulse rounded-lg bg-surface-sunk" aria-busy="true" />;
  return (
    <div className={got.key === key ? "" : "opacity-50 transition-opacity"} aria-busy={got.key !== key}>
      <MonthlyPnlChart points={got.points} active={active} />
    </div>
  );
}

// ------------------------------------------------------------
// 3c. Money per day — one series of bars (used by วิเคราะห์รายจ่าย)
// ------------------------------------------------------------
export function DailyBarsChart({ rows, label }: { rows: { day: string; amount: number }[]; label: string }) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลในช่วงนี้</p>;
  }
  return (
    <div className="h-60 w-full">
      <ResponsiveContainer>
        <BarChart key={rows.length} data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <ChartGradients />
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} minTickGap={16} {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={cursorFill}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as { day: string; amount: number }) : null;
              return r ? <TooltipBox title={dayLabel(r.day)} rows={[{ label, value: baht(r.amount) }]} /> : null;
            }}
          />
          <Bar dataKey="amount" fill={grad("clay")} radius={[5, 5, 0, 0]} maxBarSize={36} activeBar={{ fill: solid("clay") }} {...ANIM} />
        </BarChart>
      </ResponsiveContainer>
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
        <BarChart key={rows.length} data={rows} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }} barCategoryGap={6}>
          <ChartGradients />
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tickFormatter={compact} {...axis} />
          <YAxis type="category" dataKey="name" width={150} {...axis} axisLine={false} tick={{ fill: INK, fontSize: 12 }} />
          <Tooltip
            cursor={cursorFill}
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
          <Bar dataKey="net" radius={[0, 6, 6, 0]} {...ANIM}>
            {/* The best seller is what this chart exists to point at. */}
            {rows.map((r, i) => (
              <Cell key={r.name} fill={grad(i === 0 ? "clay" : "olive", "h")} />
            ))}
            <LabelList
              dataKey="net"
              position="right"
              formatter={(v: unknown) => compact(Number(v))}
              style={{ fill: INK_MUTED, fontSize: 12, fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
