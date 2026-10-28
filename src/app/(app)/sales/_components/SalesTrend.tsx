"use client";

// ============================================================
// Mise — แนวโน้มรายหมวด, and the trend every /sales popup shares (Kong, 2026-10-28)
// ============================================================
// Kong: "ไม่รู้ว่าเดือนไหนหมวดไหนหรือเมนูไหนขายดี". The approved design
// (artifact Qjyn322irmDt34oQH42Nbf) puts the answer where people already look,
// not on a page of its own: a card on /sales, the category popup, the menu
// popup, and the menu sheet in จัดการเมนู.
//
// The measure is the PAGE's (ยอดขาย / จำนวนจาน / กำไร at the top of /sales):
// one switch for the whole page, never a second one that disagrees with it.
//
// One provider holds the chosen range and a cache of answers, so
// the card, the category popup and the menu popup show the same months and a
// popup opened after the card has loaded opens at once. Reads go through
// GET /api/sales (mise-ui-review §5c). Profit — the recipe walk — is fetched
// only when someone asks for it.
// ============================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import TrendLine, { Sparkline } from "@/components/charts/TrendLine";
import { TONES, toneOf } from "@/components/charts/chart-theme";
import { readApi } from "@/lib/read-api";
import { announceStale } from "@/lib/stale-tab";
import {
  changePct,
  lastMonths,
  monthLabelTh,
  monthRangeDates,
  perDay,
  type Point,
  type SalesTrend,
  type TrendMetric,
} from "@/lib/sales-trend";
import type { SalesTrendResult } from "../insight-reads";
import type { ToneMap } from "./Breakdown";

export type RangePreset = "3" | "6" | "12" | "custom";
type Loaded = Extract<SalesTrendResult, { ok: true }>;
type Answer = Loaded | { ok: false; formError: string; stale?: boolean };

const shortMonth = (key: string) => {
  const label = monthLabelTh(key);
  return key.endsWith("-01") || key.endsWith("-12") ? label : label.replace(/\s\d{2}$/, "");
};
export const bahtCompact = (v: number) =>
  Math.abs(v) >= 1000 ? `฿${(Math.round(v / 100) / 10).toLocaleString("th-TH")}K` : `฿${Math.round(v).toLocaleString("th-TH")}`;
export const bahtFull = (v: number) => `฿${Math.round(v).toLocaleString("th-TH")}`;
export const METRIC_TH: Record<TrendMetric, string> = { net: "ยอดขาย", qty: "จำนวนจาน", profit: "กำไร" };

export function metricFmt(metric: TrendMetric) {
  return metric === "qty"
    ? { axis: (v: number) => v.toFixed(0), tip: (v: number) => `${v.toFixed(1)} จาน/วัน`, big: (v: number) => v.toFixed(1), unit: "จาน/วัน" }
    : { axis: bahtCompact, tip: (v: number) => `${bahtFull(v)}/วัน`, big: bahtFull, unit: "/วัน" };
}

// ------------------------------------------------------------
// The shared state
// ------------------------------------------------------------
type Ctx = {
  endMonth: string;
  preset: RangePreset;
  custom: { from: string; to: string };
  months: string[];
  metric: TrendMetric;
  canProfit: boolean;
  setPreset: (p: RangePreset) => void;
  setCustom: (c: { from: string; to: string }) => void;
  /** The answer for the current range (and measure, when it is profit). */
  data: Answer | null;
  /** Any range — the menu popup and the sheet choose their own. */
  load: (months: string[], withProfit: boolean) => Promise<Answer>;
  tones: ToneMap;
  /** The page's month choices for the custom range, newest first. */
  monthChoices: string[];
};
const TrendCtx = createContext<Ctx | null>(null);
export const useSalesTrend = () => useContext(TrendCtx);

export function rangeMonths(endMonth: string, preset: RangePreset, custom: { from: string; to: string }): string[] {
  if (preset !== "custom") return lastMonths(endMonth, Number(preset));
  const [a, b] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
  const out = lastMonths(b, 24).filter((m) => m >= a);
  return out.length ? out : [b];
}

export function SalesTrendProvider({
  endMonth,
  branchId,
  categoryId,
  canProfit,
  metric,
  tones,
  children,
}: {
  /** The month of the page's `to` — the card ends where the page looks. */
  endMonth: string;
  branchId?: string;
  categoryId?: string;
  canProfit: boolean;
  /** The page's measure. */
  metric: TrendMetric;
  tones: ToneMap;
  children: ReactNode;
}) {
  const [preset, setPreset] = useState<RangePreset>("6");
  const [custom, setCustom] = useState(() => ({ from: lastMonths(endMonth, 6)[0], to: endMonth }));
  const cache = useRef(new Map<string, Promise<Answer>>());
  const months = useMemo(() => rangeMonths(endMonth, preset, custom), [endMonth, preset, custom]);

  const load = useCallback(
    (ms: string[], withProfit: boolean) => {
      const key = `${ms[0]}|${ms[ms.length - 1]}|${branchId ?? ""}|${categoryId ?? ""}|${withProfit ? 1 : 0}`;
      const hit = cache.current.get(key);
      if (hit) return hit;
      const p = readApi<Loaded>("/api/sales", "trend", {
        fromMonth: ms[0],
        toMonth: ms[ms.length - 1],
        branchId,
        categoryId,
        withProfit,
      }).then((r): Answer => {
        if (!r.ok) {
          cache.current.delete(key);
          if (r.stale) announceStale();
        }
        return r;
      });
      cache.current.set(key, p);
      return p;
    },
    [branchId, categoryId]
  );

  const withProfit = metric === "profit" && canProfit;
  const [data, setData] = useState<{ key: string; answer: Answer } | null>(null);
  const want = `${months[0]}|${months[months.length - 1]}|${withProfit ? 1 : 0}`;
  useEffect(() => {
    let live = true;
    void load(months, withProfit).then((answer) => live && setData({ key: want, answer }));
    return () => {
      live = false;
    };
  }, [load, months, withProfit, want]);

  const monthChoices = useMemo(() => lastMonths(endMonth, 24).reverse(), [endMonth]);
  const value: Ctx = {
    endMonth,
    preset,
    custom,
    months,
    metric: withProfit ? "profit" : metric === "profit" ? "net" : metric,
    canProfit,
    setPreset,
    setCustom,
    // The previous answer stays up while the next one comes (§5b).
    data: data?.key === want ? data.answer : data?.answer ?? null,
    load,
    tones,
    monthChoices,
  };
  return <TrendCtx.Provider value={value}>{children}</TrendCtx.Provider>;
}

/** True while the shown answer is not yet the one asked for. */
function useIsStale(ctx: Ctx) {
  const d = ctx.data;
  if (!d || !d.ok) return d === null;
  const ms = d.trend.months;
  return ms[0]?.key !== ctx.months[0] || ms[ms.length - 1]?.key !== ctx.months[ctx.months.length - 1] || (ctx.metric === "profit" && !d.withProfit);
}

// ------------------------------------------------------------
// Small pieces
// ------------------------------------------------------------
// The segmented choice is the kit's one (src/components/ui/Seg.tsx).
import Seg from "@/components/ui/Seg";
export { Seg };

export function DeltaChip({ pct, vs }: { pct: number | null; vs?: string }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">{vs ? `ไม่มียอดของ ${vs} ให้เทียบ` : "—"}</span>;
  const flat = Math.abs(pct) < 2;
  const cls = flat ? "bg-muted text-muted-foreground" : pct > 0 ? "bg-good-bg text-good" : "bg-bad-bg text-bad";
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
        {flat ? "≈" : pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
      </span>
      {vs && <span className="whitespace-nowrap text-xs text-muted-foreground">เทียบ {vs}</span>}
    </span>
  );
}

export function RangeControls() {
  const t = useSalesTrend()!;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Seg
        label="ช่วงเวลา"
        value={t.preset}
        onChange={t.setPreset}
        items={[
          ["3", "3 เดือน"],
          ["6", "6 เดือน"],
          ["12", "12 เดือน"],
          ["custom", "เลือกเอง"],
        ]}
      />
      {t.preset === "custom" && (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <MonthSelect label="ตั้งแต่เดือน" value={t.custom.from} choices={t.monthChoices} onChange={(from) => t.setCustom({ ...t.custom, from })} />
          ถึง
          <MonthSelect label="ถึงเดือน" value={t.custom.to} choices={t.monthChoices} onChange={(to) => t.setCustom({ ...t.custom, to })} />
        </span>
      )}
    </div>
  );
}

function MonthSelect({ label, value, choices, onChange }: { label: string; value: string; choices: string[]; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-lg border border-border-strong bg-surface px-2 text-[13px] text-foreground">
      {choices.map((m) => (
        <option key={m} value={m}>
          {monthLabelTh(m)}
        </option>
      ))}
    </select>
  );
}

export const toneColor = (tones: ToneMap, key: string, i: number) => TONES[tones[key] ?? toneOf(i)][0];

/** The rows every month tooltip carries. */
function monthRows(points: Point[], i: number, metric: TrendMetric, labels: string[], total?: Point[]) {
  const p = points[i];
  const rows: { label: string; value: string; tone?: "good" | "bad" }[] = [];
  if (metric !== "qty" && p.days) rows.push({ label: "จาน/วัน", value: (p.qty / p.days).toFixed(1) });
  if (total && total[i].net > 0) rows.push({ label: "ส่วนแบ่งยอดขาย", value: `${((p.net / total[i].net) * 100).toFixed(1)}%` });
  const prevI = (() => {
    for (let k = i - 1; k >= 0; k--) if (points[k].days) return k;
    return -1;
  })();
  if (prevI >= 0) {
    const c = changePct(perDay(p, metric), perDay(points[prevI], metric));
    if (c !== null) rows.push({ label: `เทียบ ${labels[prevI]}`, value: `${c >= 0 ? "+" : ""}${c.toFixed(1)}%`, tone: c >= 0 ? "good" : "bad" });
  }
  rows.push({ label: "วันที่มีข้อมูล", value: `${p.days} วัน` });
  return rows;
}

/** Latest month with data and the one with data before it. */
function lastTwo(points: Point[]): [number, number] {
  let a = -1;
  let b = -1;
  for (let i = points.length - 1; i >= 0; i--) {
    if (!points[i].days) continue;
    if (a < 0) a = i;
    else {
      b = i;
      break;
    }
  }
  return [a, b];
}

// ------------------------------------------------------------
// The card on /sales
// ------------------------------------------------------------
export function CategoryTrendCard({ onOpenCategory }: { onOpenCategory: (key: string) => void }) {
  const t = useSalesTrend()!;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [navigating, startNav] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);
  const stale = useIsStale(t);
  const d = t.data;
  const f = metricFmt(t.metric);

  if (d && !d.ok) {
    return <p className="py-10 text-center text-sm text-bad">{d.formError}</p>;
  }
  if (!d) {
    return (
      <div aria-busy className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[136px] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const trend = d.trend;
  const labels = trend.months.map((m) => shortMonth(m.key));
  const titles = trend.months.map((m) => monthLabelTh(m.key));
  const cats = trend.categories;
  const selected = cats.find((c) => c.key === picked) ?? cats[0];
  const selIndex = selected ? cats.indexOf(selected) : 0;
  const [last, prev] = lastTwo(trend.total);

  if (!selected || last < 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">ยังไม่มียอดขายในช่วง {titles[0]} – {titles[titles.length - 1]}</p>;
  }

  const goMonth = (i: number) => {
    const r = monthRangeDates(trend.months[i].key, trend.months[i].key);
    const q = new URLSearchParams(params.toString());
    q.set("from", r.from);
    q.set("to", r.to);
    startNav(() => router.push(`${pathname}?${q}` as Route, { scroll: false }));
  };

  const unknownProfit = t.metric === "profit" && selected.points.some((p) => p.unknownNet > 0);

  return (
    <div className={`space-y-4 transition-opacity ${stale || navigating ? "opacity-60" : ""}`} aria-busy={stale || navigating || undefined}>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        {cats.map((c, i) => {
          const color = toneColor(t.tones, c.key, i);
          const v = perDay(c.points[last], t.metric);
          const pv = prev >= 0 ? perDay(c.points[prev], t.metric) : null;
          const active = c.key === selected.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => setPicked(c.key)}
              className={`flex min-w-0 flex-col gap-1.5 rounded-2xl border p-3.5 pb-2.5 text-left transition-colors ${
                active ? "border-border-strong bg-surface-sunk ring-1 ring-inset ring-border-strong" : "border-border bg-surface hover:bg-surface-sunk"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                <span className="h-[3px] w-2.5 shrink-0 rounded" style={{ background: color }} />
                <span className="truncate">{c.label}</span>
              </span>
              <span className="font-display text-xl font-semibold tabular-nums">
                {v === null ? "—" : f.big(v)}
                <small className="ml-1 font-sans text-xs font-normal text-muted-foreground">{v === null ? "" : f.unit}</small>
              </span>
              <DeltaChip pct={changePct(v, pv)} vs={prev >= 0 ? labels[prev] : undefined} />
              <Sparkline values={c.points.map((p) => perDay(p, t.metric))} color={color} />
            </button>
          );
        })}
      </div>

      <div className="border-t border-border pt-4">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-base font-semibold">
            {selected.label} · {METRIC_TH[t.metric]}ต่อวัน
          </h4>
          <p className="text-xs text-muted-foreground">
            ชี้ที่เส้นเพื่อดูตัวเลข · กดจุดเพื่อเปิดยอดขายเดือนนั้น ·{" "}
            <button type="button" onClick={() => onOpenCategory(selected.key)} className="font-semibold text-primary hover:underline">
              เปิดเมนูในหมวดนี้ ›
            </button>
          </p>
        </div>
        <TrendLine
          key={`${selected.key}-${t.metric}-${labels[0]}-${labels.length}`}
          label={selected.label}
          labels={labels}
          titles={titles.map((m, i) => (trend.months[i].days ? m : `${m} · ไม่มีข้อมูล`))}
          values={selected.points.map((p) => perDay(p, t.metric))}
          color={toneColor(t.tones, selected.key, selIndex)}
          height={260}
          axis={f.axis}
          tip={f.tip}
          avg
          rows={(i) => monthRows(selected.points, i, t.metric, titles, trend.total)}
          onPick={goMonth}
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          เฉลี่ยต่อวันที่มีข้อมูลของแต่ละเดือน (เดือนที่มีข้อมูลไม่ครบก็เทียบกันได้) · เดือนที่ไม่มีข้อมูลเส้นจะขาด
          {t.metric === "profit" && <> · ต้นทุนจากสูตร ณ {d.costAsOf}</>}
          {unknownProfit && <> · บางเมนูในหมวดนี้ยังไม่มีสูตร จึงไม่นับในกำไร</>}
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Inside the category popup: the category's line, searchable menus
// ------------------------------------------------------------
export function CategoryTrendPane({ categoryKey, tone, onMenu }: { categoryKey: string; tone: string; onMenu?: (menuId: string) => void }) {
  const t = useSalesTrend()!;
  const [q, setQ] = useState("");
  useEffect(() => setQ(""), [categoryKey]);
  const d = t.data;
  if (!d) return <div aria-busy className="h-[260px] animate-pulse rounded-xl bg-muted" />;
  if (!d.ok) return <p className="py-6 text-center text-sm text-bad">{d.formError}</p>;
  const trend = d.trend;
  const cat = trend.categories.find((c) => c.key === categoryKey);
  if (!cat) return <p className="py-6 text-center text-sm text-muted-foreground">ยังไม่มียอดขายของหมวดนี้ในช่วงที่เลือก</p>;
  const f = metricFmt(t.metric);
  const labels = trend.months.map((m) => shortMonth(m.key));
  const titles = trend.months.map((m) => monthLabelTh(m.key));
  const [last, prev] = lastTwo(trend.total);
  const v = last >= 0 ? perDay(cat.points[last], t.metric) : null;
  const menus = trend.menus.filter((m) => m.categoryKey === categoryKey);
  const shown = q.trim() ? menus.filter((m) => m.label.toLowerCase().includes(q.trim().toLowerCase())) : menus;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">
          {cat.label} · {METRIC_TH[t.metric]}ต่อวัน {last >= 0 ? titles[last] : ""}
        </p>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-2xl font-semibold tabular-nums">{v === null ? "—" : f.tip(v).replace("/วัน", "")}</span>
          <DeltaChip pct={prev >= 0 ? changePct(v, perDay(cat.points[prev], t.metric)) : null} vs={prev >= 0 ? titles[prev] : undefined} />
        </div>
      </div>
      <TrendLine
        key={`${categoryKey}-${t.metric}-${labels[0]}-${labels.length}`}
        label={cat.label}
        labels={labels}
        titles={titles}
        values={cat.points.map((p) => perDay(p, t.metric))}
        color={tone}
        height={190}
        axis={f.axis}
        tip={f.tip}
        rows={(i) => monthRows(cat.points, i, t.metric, titles)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-sm font-semibold">
          เมนูใน {cat.label} · {q.trim() ? `${shown.length} จาก ` : ""}
          {menus.length} เมนู
        </p>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นเมนูในหมวดนี้"
          aria-label="ค้นเมนูในหมวดนี้"
          className="h-9 w-56 max-w-full rounded-lg border border-border-strong bg-surface px-3 text-sm"
        />
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">เมนู</th>
              <th className="px-2 py-1.5 font-medium">แนวโน้ม</th>
              <th className="px-2 py-1.5 text-right font-medium">{last >= 0 ? labels[last] : ""} ต่อวัน</th>
              <th className="px-2 py-1.5 text-right font-medium">{prev >= 0 ? `เทียบ ${labels[prev]}` : ""}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => {
              const mv = last >= 0 ? perDay(m.points[last], t.metric) : null;
              const pv = prev >= 0 ? perDay(m.points[prev], t.metric) : null;
              return (
                <tr
                  key={m.key}
                  onClick={onMenu ? () => onMenu(m.key) : undefined}
                  className={`border-b border-border/60 ${onMenu ? "cursor-pointer hover:bg-muted/50" : ""}`}
                >
                  <td className="px-2 py-2 font-medium">{m.label}</td>
                  <td className="px-2 py-1">
                    <Sparkline values={m.points.map((p) => perDay(p, t.metric))} color={tone} width={110} height={28} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{mv === null ? "—" : f.tip(mv).replace("/วัน", "")}</td>
                  <td className="px-2 py-2 text-right">{prev >= 0 ? <DeltaChip pct={changePct(mv, pv)} /> : null}</td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-muted-foreground">
                  {q.trim() ? `ไม่พบเมนูที่ชื่อมี “${q.trim()}” ในหมวดนี้` : "ไม่มีเมนูในหมวดนี้"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {onMenu && <p className="text-xs text-muted-foreground">กดเมนูเพื่อดูรายละเอียด · ช่วงเดือนตามที่เลือกในการ์ดแนวโน้มรายหมวด</p>}
    </div>
  );
}

export type { SalesTrend };
