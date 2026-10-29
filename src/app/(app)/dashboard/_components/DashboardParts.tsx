"use client";

// ============================================================
// คิดครัว — the dashboard's two interactive pieces (Kong 2026-10-29,
// mockup https://claude.ai/artifact/R9edWU3oJsjMSj2SqR3Fyn)
// ============================================================
// 1. Daily sales: one bar per day, the branches stacked, the period's and
//    the previous period's per-day average as dashed lines, weekends shaded.
//    A day with no POS file has no bar — and is NAMED under the chart, never
//    drawn as ฿0. Clicking a day opens that day on /sales.
// 2. Top menus with ยอดขาย / จาน / กำไร. Profit needs a recipe walk, so it
//    is fetched only when asked for, through the same GET read /sales uses.
// ============================================================

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Bar, BarChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ANIM, ChartTooltip, GRID, INK_MUTED, NEUTRAL, axis, cursorFill } from "@/components/charts/chart-theme";
import { readApi } from "@/lib/read-api";
import { announceStale } from "@/lib/stale-tab";
import { clickableBar, type MenuBar, type RevenueRow, type RevenueSeries } from "./Charts";

const baht = (n: number) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(n);
const compact = (n: number) => new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });
const weekday = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const WEEKDAY_TH = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];

export function DailySalesBars({
  days,
  rows,
  series,
  avgCur,
  avgPrev,
  prevLabel,
  branchParam,
}: {
  /** Every day of the period, in order — a day with no file is still a slot. */
  days: string[];
  rows: RevenueRow[];
  series: RevenueSeries[];
  avgCur: number | null;
  avgPrev: number | null;
  prevLabel: string;
  /** The one branch switched on, for the click-through; null = all. */
  branchParam: string | null;
}) {
  const router = useRouter();
  const byDay = useMemo(() => new Map(rows.map((r) => [String(r.day), r])), [rows]);
  const data = useMemo(() => days.map((d) => byDay.get(d) ?? ({ day: d } as RevenueRow)), [days, byDay]);
  const missing = days.filter((d) => !byDay.has(d));
  const weekends = days.filter((d) => weekday(d) === 0 || weekday(d) === 6);
  const open = (iso: string) => {
    const qs = new URLSearchParams({ from: iso, to: iso, day: iso });
    if (branchParam) qs.set("branch", branchParam);
    router.push(`/sales?${qs}` as Route);
  };
  const ticks = days.filter((d, i) => i === 0 || dayNum(d) % 5 === 0 || i === days.length - 1);
  const last = series.length - 1;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.branchId} className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.name.replace(/^สาขา/, "")}
          </span>
        ))}
        {avgCur !== null && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-4 border-t-2 border-dashed border-muted-foreground" />
            เฉลี่ย {baht(avgCur)}/วัน
          </span>
        )}
        {avgPrev !== null && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-4 border-t-2 border-dashed border-muted-subtle" />
            {prevLabel} {baht(avgPrev)}/วัน
          </span>
        )}
        {weekends.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-[3px] border border-border bg-highlight-soft" />
            เสาร์–อาทิตย์
          </span>
        )}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart key={days.length} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
            <CartesianGrid stroke={GRID} vertical={false} />
            {weekends.map((d) => (
              <ReferenceArea key={d} x1={d} x2={d} fill="rgb(174 183 132 / 0.16)" strokeOpacity={0} ifOverflow="extendDomain" />
            ))}
            <XAxis dataKey="day" ticks={ticks} tickFormatter={(d: string) => (d === days[0] ? dayLabel(d) : String(dayNum(d)))} interval={0} {...axis} />
            <YAxis tickFormatter={compact} width={44} domain={[0, (max: number) => Math.ceil((max * 1.08) / 5000) * 5000]} {...axis} axisLine={false} />
            <Tooltip
              cursor={cursorFill}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const iso = String(label);
                const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
                return (
                  <ChartTooltip
                    title={`${dayLabel(iso)} · ${WEEKDAY_TH[weekday(iso)]}`}
                    rows={[
                      ...(payload.length > 1 ? [{ label: "รวม", value: baht(total) }] : []),
                      ...payload.map((p) => ({ label: String(p.name).replace(/^สาขา/, ""), value: baht(Number(p.value)), color: String(p.color) })),
                    ]}
                  />
                );
              }}
            />
            {series.map((s, i) => (
              <Bar
                key={s.branchId}
                dataKey={s.branchId}
                name={s.name}
                stackId="day"
                fill={s.color}
                stroke="#FFFFFF"
                strokeWidth={1}
                radius={i === last ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                {...ANIM}
                {...clickableBar((idx) => data[idx] && byDay.has(String(data[idx].day)) && open(String(data[idx].day)))}
              />
            ))}
            {avgCur !== null && <ReferenceLine y={avgCur} stroke={INK_MUTED} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />}
            {avgPrev !== null && <ReferenceLine y={avgPrev} stroke={NEUTRAL} strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-subtle">
        กดแท่งเพื่อดูวันนั้นในหน้ายอดขาย
        {missing.length > 0 && ` · ${rangesTh(missing)} ยังไม่มีไฟล์ยอดขาย`}
      </p>
    </div>
  );
}

/** ["2026-09-27","2026-09-28","2026-09-30"] → "27–28, 30 ก.ย." */
function rangesTh(isos: string[]): string {
  const month = new Date(`${isos[0]}T00:00:00Z`).toLocaleDateString("th-TH", { month: "short", timeZone: "UTC" });
  const nums = isos.map(dayNum);
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (const n of [...nums.slice(1), Infinity]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = prev = n;
  }
  return `วันที่ ${parts.join(", ")} ${month}`;
}

type ProfitMenu = { id: string; name: string; value: number | null; qty: number };
type ProfitResult = { ok: true; view: { menus: ProfitMenu[] } } | { ok: false; formError: string; stale?: boolean };
type Measure = "net" | "qty" | "profit";

export function TopMenusCard({
  menus,
  profitInput,
  salesHref,
}: {
  menus: MenuBar[];
  /** null when the reader may not see cost, or the branch choice is not one the read can answer. */
  profitInput: { from: string; to: string; branchId?: string } | null;
  salesHref: string;
}) {
  const [measure, setMeasure] = useState<Measure>("net");
  const [profit, setProfit] = useState<ProfitMenu[] | "loading" | { error: string } | null>(null);

  const choose = (m: Measure) => {
    setMeasure(m);
    if (m === "profit" && profit === null && profitInput) {
      setProfit("loading");
      void readApi<ProfitResult>("/api/sales", "profit", profitInput).then((r) => {
        if (r.ok) setProfit([...r.view.menus].sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity)));
        else {
          if (r.stale) announceStale();
          setProfit({ error: r.formError });
        }
      });
    }
  };

  const rows: { id: string; name: string; value: number | null; suffix?: string }[] =
    measure === "profit"
      ? Array.isArray(profit)
        ? profit.slice(0, 6).map((m) => ({ id: m.id, name: m.name, value: m.value }))
        : []
      : [...menus]
          .sort((a, b) => (measure === "qty" ? b.qty - a.qty : b.net - a.net))
          .slice(0, 6)
          .map((m) => ({ id: m.id, name: m.name, value: measure === "qty" ? m.qty : m.net }));
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  const fmt = (v: number | null) => (v === null ? "—" : measure === "qty" ? `${v.toLocaleString("th-TH")} จาน` : baht(v));

  return (
    <div className="space-y-3">
      <div className="seg" role="group" aria-label="เรียงตาม">
        {([["net", "ยอดขาย"], ["qty", "จาน"], ...(profitInput ? [["profit", "กำไร"]] : [])] as [Measure, string][]).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={measure === k} onClick={() => choose(k)} className={`seg-item ${measure === k ? "is-on" : ""}`}>
            {l}
          </button>
        ))}
      </div>
      {measure === "profit" && profit === "loading" ? (
        <p className="py-6 text-center text-sm text-muted-foreground">กำลังคำนวณกำไรต่อเมนู…</p>
      ) : measure === "profit" && profit && !Array.isArray(profit) && profit !== "loading" ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{profit.error}</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วงนี้</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r, i) => {
            const [name, branch] = r.name.split(" · ");
            return (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                <span className="truncate">
                  {name}
                  {branch && <span className="text-xs text-muted-subtle"> · {branch}</span>}
                </span>
                <span className="font-display font-medium tabular-nums">{fmt(r.value)}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-sunk">
                  <i
                    className="block h-full origin-left animate-grow-x rounded-full"
                    style={{
                      width: `${(Math.max(0, r.value ?? 0) / max) * 100}%`,
                      background: i === 0 ? "linear-gradient(90deg,#E8A76F,#C0692B)" : "linear-gradient(90deg,#9DAA55,#5E6B14)",
                      animationDelay: `${i * 50}ms`,
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {measure === "profit" && Array.isArray(profit) && (
        <p className="text-[11px] text-muted-subtle">กำไรต่อเมนู = ยอดขายหลังส่วนลด − ต้นทุนตามสูตร · "—" = ยังไม่มีสูตร</p>
      )}
      <a href={salesHref} className="text-xs text-primary hover:underline">
        ดูทั้งหมดในหน้ายอดขาย ›
      </a>
    </div>
  );
}
