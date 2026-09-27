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
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
