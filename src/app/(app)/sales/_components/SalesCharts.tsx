"use client";

// ============================================================
// Mise — ยอดขาย charts (Part 35 C, after Kong's "Items & Sales")
// ============================================================
// Three things his sheet did that the old tables could not: a daily bar you
// can CLICK to open that day, a weekday pattern you can see at a glance, and
// a menu table you can search and sort.
//
// Every chart speaks the page's MEASURE — ยอดขาย, จำนวน or กำไร (Kong,
// 2026-09-28: a dish with a small bill can still be what customers eat every
// day, and the biggest seller need not be the one that makes the money). The
// tooltip always shows all three, so switching is for ranking, not hiding.
// ============================================================

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { clickableBar } from "@/app/(app)/dashboard/_components/Charts";
import {
  ANIM,
  ChartGradients,
  ChartTooltip,
  GRID,
  INK_MUTED,
  axis,
  cursorFill,
  grad,
  solid,
} from "@/components/charts/chart-theme";
import { METRIC_LABELS_TH, type Metric } from "@/lib/sales-insight";
import { RECIPE_CONFIDENCE_LABELS_TH } from "@/lib/validations/recipe";
import { fmtMetric } from "./Breakdown";
import { useMenuInsight } from "./insight-context";

/** Saturday and Sunday — the shape a shop plans its staff around. */
const WEEKEND = new Set(["เสาร์", "อาทิตย์"]);
const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const compact = (n: number) => new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 }).format(n);

// ------------------------------------------------------------
// Daily — click a bar to open that day
// ------------------------------------------------------------
export type DayBar = {
  day: string;
  label: string;
  weekday: string;
  value: number | null;
  net: number;
  qty: number;
  profit: number | null;
};

export function SalesDailyChart({ rows, activeDay, by }: { rows: DayBar[]; activeDay: string | null; by: Metric }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = (day: string) => {
    const q = new URLSearchParams(params.toString());
    if (q.get("day") === day) q.delete("day");
    else q.set("day", day);
    router.push(`/sales?${q.toString()}`, { scroll: false });
  };
  const known = rows.filter((r) => r.value !== null);
  const average = known.length ? known.reduce((t, r) => t + (r.value ?? 0), 0) / known.length : 0;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: solid("olive") }} />จันทร์–ศุกร์</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: solid("mustard") }} />เสาร์–อาทิตย์</span>
        <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: solid("clay") }} />เฉลี่ยต่อวัน {fmtMetric(by, average)}</span>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart
            // A new period or measure is a new chart: re-keying replays the grow-in.
            key={`${rows[0]?.day ?? ""}-${rows.length}-${by}`}
            data={rows}
            margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
          >
            <ChartGradients />
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" minTickGap={16} {...axis} />
            <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
            <Tooltip
              cursor={cursorFill}
              content={({ active, payload }) => {
                const r = active && payload?.length ? (payload[0].payload as DayBar) : null;
                return r ? (
                  <ChartTooltip
                    title={`${r.weekday} ${r.label} · กดเพื่อดูวันนี้`}
                    rows={[
                      { label: "ยอดขาย", value: baht(r.net) },
                      { label: "จำนวน", value: `${r.qty.toLocaleString("th-TH")} จาน` },
                      ...(by === "profit" ? [{ label: "กำไรจากสูตร", value: r.profit === null ? "ไม่มีสูตร" : baht(r.profit) }] : []),
                    ]}
                  />
                ) : null;
              }}
            />
            <Bar
              dataKey="value"
              radius={[6, 6, 0, 0]}
              maxBarSize={28}
              activeBar={{ fill: grad("clay") }}
              {...clickableBar((i) => rows[i] && open(rows[i].day))}
              {...ANIM}
            >
              {/* The open day is terracotta; weekends mustard; weekdays olive. */}
              {rows.map((r) => (
                <Cell
                  key={r.day}
                  fill={activeDay === r.day ? grad("clay") : WEEKEND.has(r.weekday) ? grad("mustard") : grad("olive")}
                  fillOpacity={activeDay === null || activeDay === r.day ? 1 : 0.4}
                />
              ))}
            </Bar>
            <ReferenceLine y={average} stroke={solid("clay")} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Weekday pattern — average per day, Monday first
// ------------------------------------------------------------
export type WeekdayBar = { label: string; average: number; days: number };

export function WeekdayChart({ rows, by }: { rows: WeekdayBar[]; by: Metric }) {
  const max = Math.max(...rows.map((r) => r.average));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart key={`${rows.map((r) => r.average).join()}-${by}`} data={rows} margin={{ top: 24, right: 12, bottom: 0, left: 4 }}>
          <ChartGradients />
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={cursorFill}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as WeekdayBar) : null;
              return r ? (
                <ChartTooltip
                  title={`วัน${r.label}`}
                  rows={[
                    { label: `${METRIC_LABELS_TH[by]}เฉลี่ยต่อวัน`, value: fmtMetric(by, r.average) },
                    { label: "จำนวนวันในช่วง", value: `${r.days} วัน` },
                  ]}
                />
              ) : null;
            }}
          />
          <Bar dataKey="average" radius={[6, 6, 0, 0]} maxBarSize={52} {...ANIM}>
            {/* The best day is the one fact this chart exists to show. */}
            {rows.map((r) => (
              <Cell key={r.label} fill={r.average === max ? grad("clay") : grad("olive")} fillOpacity={r.average === max ? 1 : 0.8} />
            ))}
            <LabelList
              dataKey="average"
              position="top"
              formatter={(v: unknown) => compact(Number(v))}
              style={{ fill: INK_MUTED, fontSize: 11, fontWeight: 500 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// Menu table — search and sort, the way Kong's sheet did
// ------------------------------------------------------------
export type MenuRow = {
  id: string;
  name: string;
  category: string;
  color?: string | null;
  qty: number;
  net: number;
  /** In the page's measure; null = profit with no recipe. */
  value: number | null;
  costPerDish: number | null;
  profitPerDish: number | null;
  confidence: string | null;
  /** Profit view only — lets the menu popup reuse this cost instead of re-walking recipes. */
  recipeId?: string | null;
  stub: boolean;
};

type SortKey = "name" | "category" | "qty" | "net" | "value" | "costPerDish" | "profitPerDish";

export function MenuTable({ rows, total, by }: { rows: MenuRow[]; total: number; by: Metric }) {
  // A column of dashes says nothing; the page says why instead (Kong, 2026-09-28).
  const showCategory = rows.some((r) => r.category !== "—");
  const profit = by === "profit";
  const insight = useMenuInsight();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "value", dir: "desc" });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.category.toLowerCase().includes(needle))
      : rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb), "th") * dir;
      // Nothing to compare sorts last in either direction — a dish with no
      // recipe is not the least profitable one.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [rows, q, sort]);

  const head = (key: SortKey, label: string, right = false) => (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        <span aria-hidden className="text-[10px]">{sort.key === key ? (sort.dir === "desc" ? "▼" : "▲") : "↕"}</span>
      </button>
    </th>
  );
  const cols = 4 + (showCategory ? 1 : 0) + (profit ? 3 : 0);

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={showCategory ? "ค้นหาเมนู หรือ หมวด…" : "ค้นหาเมนู…"}
        className="input mb-3 w-full"
        aria-label="ค้นหาเมนู"
      />
      <div className="max-h-[480px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface-sunk text-muted-foreground">
            <tr>
              {head("name", "เมนู")}
              {showCategory && head("category", "หมวด")}
              {head("qty", "จำนวน", true)}
              {head("net", "ยอดขาย", true)}
              {profit && head("costPerDish", "ต้นทุน/จาน", true)}
              {profit && head("profitPerDish", "กำไร/จาน", true)}
              {profit && head("value", "กำไรรวม", true)}
              <th className="px-3 py-2 text-right font-medium">% ของ{METRIC_LABELS_TH[by]}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {shown.map((r) => (
              // The whole row opens the dish (Kong, 2026-09-28) — not just its name.
              <tr
                key={r.id}
                onClick={() => insight?.open(r.id)}
                title="ดู insight ของเมนูนี้"
                className="group cursor-pointer transition-colors hover:bg-muted"
              >
                <td className="px-3 py-2">
                  <span className="font-medium group-hover:text-primary">{r.name}</span>
                  {r.stub ? <span className="ml-1 rounded bg-warn-bg px-1 text-xs text-warn">รอตรวจ</span> : null}
                </td>
                {showCategory && (
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.color ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: r.color }} /> : null}
                    {r.category}
                  </td>
                )}
                <td className="px-3 py-2 text-right">{r.qty.toLocaleString("th-TH")}</td>
                <td className="px-3 py-2 text-right font-medium">{baht(r.net)}</td>
                {profit && (
                  <td className="px-3 py-2 text-right text-muted-foreground">
                    {r.costPerDish === null ? (
                      <a
                        href={`/recipes/new?menu=${r.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-primary underline"
                      >
                        ยังไม่มีสูตร
                      </a>
                    ) : (
                      <span title={r.confidence ? `ความมั่นใจ: ${RECIPE_CONFIDENCE_LABELS_TH[r.confidence as keyof typeof RECIPE_CONFIDENCE_LABELS_TH] ?? r.confidence}` : undefined}>
                        {baht(r.costPerDish)}
                        {r.confidence && r.confidence !== "HIGH" ? <span className="ml-0.5 text-warn">*</span> : null}
                      </span>
                    )}
                  </td>
                )}
                {profit && (
                  <td className={`px-3 py-2 text-right ${r.profitPerDish !== null && r.profitPerDish < 0 ? "text-bad" : ""}`}>
                    {r.profitPerDish === null ? "—" : baht(r.profitPerDish)}
                  </td>
                )}
                {profit && (
                  <td className="px-3 py-2 text-right font-medium">{r.value === null ? "—" : baht(r.value)}</td>
                )}
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {total > 0 && r.value !== null ? `${((r.value / total) * 100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={cols} className="px-3 py-8 text-center text-muted-foreground">ไม่พบเมนูที่ค้นหา</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {profit && rows.some((r) => r.confidence && r.confidence !== "HIGH") && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="text-warn">*</span> ต้นทุนยังไม่ครบหรือใช้ราคาที่ระบุเอง — กดชื่อเมนูเพื่อดูรายละเอียด
        </p>
      )}
    </div>
  );
}
