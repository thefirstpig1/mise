"use client";

// Part 35 D — the two charts of ราคาวัตถุดิบขึ้นลง. A rise is BAD for the
// shop and drawn in the status colour for bad; a fall is good. That is the
// one place status colours carry data here, and every bar also prints its
// signed % so colour is never the only cue.

import { useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from "recharts";
import { SERIES } from "@/app/(app)/dashboard/_components/Charts";

const INK = "#262811";
const INK_MUTED = "#5A5C31";
const GRID = "#E9E3C8";
const GOOD = "#5A7333";
const BAD = "#A83A22";
const axis = { stroke: GRID, tick: { fill: INK_MUTED, fontSize: 12 }, tickLine: false } as const;
const baht2 = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type ChangeBar = { productId: string; name: string; changePct: number; first: number; last: number; unit: string; receipts: number };

export function PriceChangeChart({ rows }: { rows: ChangeBar[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = (productId: string) => {
    const q = new URLSearchParams(params.toString());
    q.set("product", productId);
    router.push(`/cost/prices?${q.toString()}#trend`, { scroll: false });
  };
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">ยังไม่มีวัตถุดิบที่ซื้อมากกว่าหนึ่งครั้งในช่วงนี้ จึงยังเทียบราคาไม่ได้</p>;
  }
  return (
    <div className="w-full" style={{ height: Math.max(180, rows.length * 32 + 24) }}>
      <ResponsiveContainer>
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
          barCategoryGap={6}
          onClick={(e) => {
            const i = (e as { activeTooltipIndex?: number } | null)?.activeTooltipIndex;
            if (typeof i === "number" && rows[i]) open(rows[i].productId);
          }}
        >
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tickFormatter={(v) => `${v}%`} {...axis} />
          <YAxis type="category" dataKey="name" width={140} {...axis} axisLine={false} tick={{ fill: INK, fontSize: 12 }} />
          <ReferenceLine x={0} stroke={INK_MUTED} />
          <Tooltip
            cursor={{ fill: "rgb(174 183 132 / 0.14)" }}
            content={({ active, payload }) => {
              const r = active && payload?.length ? (payload[0].payload as ChangeBar) : null;
              return r ? (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md">
                  <p className="mb-1 font-medium">{r.name} · กดเพื่อดูกราฟราคา</p>
                  <p className="text-muted-foreground">
                    {baht2(r.first)} → {baht2(r.last)} ต่อ {r.unit}
                  </p>
                  <p className={r.changePct > 0 ? "text-bad" : "text-good"}>
                    {r.changePct > 0 ? "แพงขึ้น" : r.changePct < 0 ? "ถูกลง" : "เท่าเดิม"} {Math.abs(r.changePct).toFixed(1)}% · {r.receipts} ใบรับของ
                  </p>
                </div>
              ) : null;
            }}
          />
          <Bar dataKey="changePct" radius={4} cursor="pointer">
            {rows.map((r) => (
              <Cell key={r.productId} fill={r.changePct > 0 ? BAD : GOOD} />
            ))}
            <LabelList
              dataKey="changePct"
              position="right"
              formatter={(v: unknown) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(1)}%`}
              style={{ fill: INK, fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export type TrendRow = { day: string } & Record<string, number | string>;

export function PriceTrendChart({ rows, suppliers, unit }: { rows: TrendRow[]; suppliers: { id: string; name: string }[]; unit: string }) {
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} minTickGap={16} {...axis} />
          <YAxis tickFormatter={(v) => `฿${v}`} width={56} {...axis} axisLine={false} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md">
                  <p className="mb-1 font-medium">{dayLabel(String(label))}</p>
                  {payload.map((p) => (
                    <p key={String(p.dataKey)} className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: String(p.color) }} />
                      <span className="text-muted-foreground">{p.name}</span>
                      <span className="ml-auto pl-4 tabular-nums">{baht2(Number(p.value))} / {unit}</span>
                    </p>
                  ))}
                </div>
              ) : null
            }
          />
          {suppliers.length > 1 ? <Legend verticalAlign="top" height={28} /> : null}
          {suppliers.map((s, i) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              name={s.name}
              stroke={SERIES[i % SERIES.length]}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: "#FFFFFF" }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
