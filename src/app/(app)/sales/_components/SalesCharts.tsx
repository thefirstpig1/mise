"use client";

// ============================================================
// Mise — ยอดขาย charts (Part 35 C, after Kong's "Items & Sales")
// ============================================================
// Three things his sheet did that the old tables could not: a daily bar you
// can CLICK to open that day, a weekday pattern you can see at a glance, and
// a menu table you can search and sort. Colours and axes follow the same
// validated set as the dashboard (dashboard/_components/Charts.tsx).
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

/** Saturday and Sunday — the shape a shop plans its staff around. */
const WEEKEND = new Set(["เสาร์", "อาทิตย์"]);
const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const compact = (n: number) => new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Box({ title, rows }: { title: string; rows: [string, string][] }) {
  return <ChartTooltip title={title} rows={rows.map(([label, value]) => ({ label, value }))} />;
}

// ------------------------------------------------------------
// Daily — click a bar to open that day below
// ------------------------------------------------------------
export type DayBar = { day: string; label: string; weekday: string; net: number; qty: number };

export function SalesDailyChart({ rows, activeDay }: { rows: DayBar[]; activeDay: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = (day: string) => {
    const q = new URLSearchParams(params.toString());
    if (q.get("day") === day) q.delete("day");
    else q.set("day", day);
    router.push(`/sales?${q.toString()}`, { scroll: false });
  };
  const average = rows.length ? rows.reduce((t, r) => t + r.net, 0) / rows.length : 0;
  return (
    <div>
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: solid("olive") }} />จันทร์–ศุกร์</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: solid("mustard") }} />เสาร์–อาทิตย์</span>
      <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: solid("clay") }} />เฉลี่ยต่อวัน {baht(average)}</span>
    </div>
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart
          // A new period is a new chart: re-keying replays the grow-in.
          key={`${rows[0]?.day ?? ""}-${rows.length}`}
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
                <Box
                  title={`${r.weekday} ${r.label} · กดเพื่อดูวันนี้`}
                  rows={[
                    ["ยอดขาย", baht(r.net)],
                    ["จำนวนที่ขาย", r.qty.toLocaleString("th-TH")],
                  ]}
                />
              ) : null;
            }}
          />
          <Bar
            dataKey="net"
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

export function WeekdayChart({ rows }: { rows: WeekdayBar[] }) {
  const max = Math.max(...rows.map((r) => r.average));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <BarChart key={rows.map((r) => r.average).join()} data={rows} margin={{ top: 24, right: 12, bottom: 0, left: 4 }}>
          <ChartGradients />
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={cursorFill}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as WeekdayBar) : null;
              return r ? (
                <Box title={`วัน${r.label}`} rows={[["เฉลี่ยต่อวัน", baht(r.average)], ["จำนวนวันในช่วง", `${r.days} วัน`]]} />
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
export type MenuRow = { id: string; name: string; category: string; color?: string | null; qty: number; net: number; stub: boolean };

type SortKey = "name" | "category" | "qty" | "net";

export function MenuTable({ rows, total }: { rows: MenuRow[]; total: number }) {
  // A column of dashes says nothing; the page says why instead (Kong, 2026-09-28).
  const showCategory = rows.some((r) => r.category !== "—");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "net", dir: "desc" });
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.category.toLowerCase().includes(needle))
      : rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      return typeof va === "string" ? va.localeCompare(vb as string, "th") * dir : ((va as number) - (vb as number)) * dir;
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
          <thead className="sticky top-0 bg-surface-sunk text-muted-foreground">
            <tr>
              {head("name", "เมนู")}
              {showCategory && head("category", "หมวด")}
              {head("qty", "จำนวน", true)}
              {head("net", "ยอดขาย", true)}
              <th className="px-3 py-2 text-right font-medium">% ของยอด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {shown.map((r) => (
              <tr key={r.id} className="hover:bg-muted">
                <td className="px-3 py-2">
                  {r.name}
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
                <td className="px-3 py-2 text-right text-muted-foreground">{total > 0 ? ((r.net / total) * 100).toFixed(1) : "0"}%</td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={showCategory ? 5 : 4} className="px-3 py-8 text-center text-muted-foreground">ไม่พบเมนูที่ค้นหา</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
