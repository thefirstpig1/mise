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
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SERIES, clickableBar } from "@/app/(app)/dashboard/_components/Charts";

const INK_MUTED = "#5A5C31";
const GRID = "#E9E3C8";
const axis = { stroke: GRID, tick: { fill: INK_MUTED, fontSize: 12 }, tickLine: false } as const;
const baht = (n: number) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const compact = (n: number) => new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Box({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map(([k, v]) => (
        <p key={k} className="flex gap-4">
          <span className="text-muted-foreground">{k}</span>
          <span className="ml-auto tabular-nums">{v}</span>
        </p>
      ))}
    </div>
  );
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
    router.push(`/sales?${q.toString()}#day`, { scroll: false });
  };
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart
          data={rows}
          margin={{ top: 8, right: 12, bottom: 0, left: 4 }}
        >
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" minTickGap={16} {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={{ fill: "rgb(174 183 132 / 0.14)" }}
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
          <Bar dataKey="net" radius={[4, 4, 0, 0]} {...clickableBar((i) => rows[i] && open(rows[i].day))}>
            {rows.map((r) => (
              <Cell key={r.day} fill={SERIES[0]} fillOpacity={activeDay === null || activeDay === r.day ? 1 : 0.35} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis tickFormatter={compact} width={48} {...axis} axisLine={false} />
          <Tooltip
            cursor={{ fill: "rgb(174 183 132 / 0.14)" }}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as WeekdayBar) : null;
              return r ? (
                <Box title={`วัน${r.label}`} rows={[["เฉลี่ยต่อวัน", baht(r.average)], ["จำนวนวันในช่วง", `${r.days} วัน`]]} />
              ) : null;
            }}
          />
          <Bar dataKey="average" radius={[4, 4, 0, 0]}>
            {/* The best day is the one fact this chart exists to show. */}
            {rows.map((r) => (
              <Cell key={r.label} fill={SERIES[0]} fillOpacity={r.average === max ? 1 : 0.5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ------------------------------------------------------------
// Menu table — search and sort, the way Kong's sheet did
// ------------------------------------------------------------
export type MenuRow = { id: string; name: string; category: string; qty: number; net: number; stub: boolean };

type SortKey = "name" | "category" | "qty" | "net";

export function MenuTable({ rows, total }: { rows: MenuRow[]; total: number }) {
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
        placeholder="ค้นหาเมนู หรือ หมวด…"
        className="input mb-3 w-full"
        aria-label="ค้นหาเมนู"
      />
      <div className="max-h-[480px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-sunk text-muted-foreground">
            <tr>
              {head("name", "เมนู")}
              {head("category", "หมวด")}
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
                <td className="px-3 py-2 text-muted-foreground">{r.category}</td>
                <td className="px-3 py-2 text-right">{r.qty.toLocaleString("th-TH")}</td>
                <td className="px-3 py-2 text-right font-medium">{baht(r.net)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{total > 0 ? ((r.net / total) * 100).toFixed(1) : "0"}%</td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">ไม่พบเมนูที่ค้นหา</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
