"use client";

// ============================================================
// Mise — a dish's sales by month, in its sheet (Kong, 2026-10-28)
// ============================================================
// "เอากราฟ trend ไปไว้ในการจัดการเมนูด้วย (จริงๆ ต้องเอาข้อมูลการขายของแต่ละ
// เมนูใส่ในหน้าจัดการเมนูแต่ละตัวด้วยหรือเปล่า เป็นคร่าวๆ)". Rough on purpose:
// the line, the latest month against the one before, and where the dish
// stands in its category. The detail lives on /sales, one link away.
//
// The same read as /sales (GET /api/sales?what=trend) for the sheet's branch,
// twelve months once per branch; the 3 / 6 months are slices of it.
// ============================================================

import { useEffect, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import TrendLine from "@/components/charts/TrendLine";
import { TONES } from "@/components/charts/chart-theme";
import { readApi } from "@/lib/read-api";
import { changePct, lastMonths, monthLabelTh, monthRangeDates, perDay } from "@/lib/sales-trend";
import type { SalesTrendResult } from "@/app/(app)/sales/insight-reads";
import { DeltaChip, Seg, bahtCompact, bahtFull } from "@/app/(app)/sales/_components/SalesTrend";

type Answer = SalesTrendResult | { ok: false; formError: string; stale?: boolean };
const cache = new Map<string, Promise<Answer>>();

function load(branchId: string, endMonth: string): Promise<Answer> {
  const key = `${branchId}|${endMonth}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const ms = lastMonths(endMonth, 12);
  const p = readApi<SalesTrendResult>("/api/sales", "trend", { fromMonth: ms[0], toMonth: endMonth, branchId, withProfit: false }).then((r) => {
    if (!r.ok) cache.delete(key);
    return r as Answer;
  });
  cache.set(key, p);
  return p;
}

export default function MenuSalesTrend({ menuId, branchId, branchName, today }: { menuId: string; branchId: string; branchName: string; today: string }) {
  const endMonth = today.slice(0, 7);
  const [n, setN] = useState<"3" | "6" | "12">("6");
  const [res, setRes] = useState<Answer | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    void load(branchId, endMonth).then((r) => live && setRes(r));
    return () => {
      live = false;
    };
  }, [branchId, endMonth]);

  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">ยอดขาย</h4>
      <Seg label="ช่วงเวลา" value={n} onChange={setN} items={[["3", "3 เดือน"], ["6", "6 เดือน"], ["12", "12 เดือน"]]} />
    </div>
  );
  const frame = (body: React.ReactNode) => <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">{head}{body}</section>;

  if (res === null) return frame(<div aria-busy className="h-[150px] animate-pulse rounded-lg bg-muted" />);
  if (!res.ok) return frame(<p className="py-4 text-sm text-muted-foreground">เปิดยอดขายไม่ได้ในตอนนี้ — {res.formError}</p>);

  const trend = res.trend;
  const from = trend.months.length - Number(n);
  const months = trend.months.slice(from);
  const menu = trend.menus.find((m) => m.key === menuId);
  const pts = menu?.points.slice(from) ?? [];
  const vals = pts.map((p) => perDay(p, "net"));
  if (!menu || vals.every((v) => v === null)) {
    return frame(<p className="py-4 text-sm text-muted-foreground">ยังไม่มียอดขายของเมนูนี้ที่{branchName}ใน {n} เดือนที่ผ่านมา</p>);
  }

  const titles = months.map((m) => monthLabelTh(m.key));
  const labels = titles.map((l) => l.replace(/\s\d{2}$/, ""));
  const idx = pts.map((p, i) => (p.days ? i : -1)).filter((i) => i >= 0);
  const last = idx[idx.length - 1];
  const prev = idx[idx.length - 2];
  // Rank in its category in the latest month with data.
  const absLast = from + last;
  const peers = trend.menus.filter((m) => m.categoryKey === menu.categoryKey).map((m) => ({ id: m.key, v: m.points[absLast].net }));
  peers.sort((a, b) => b.v - a.v);
  const rank = peers.findIndex((p) => p.id === menuId) + 1;
  const catName = trend.categories.find((c) => c.key === menu.categoryKey)?.label;
  const r = monthRangeDates(months[last].key, months[last].key);
  const href = `/sales?branch=${branchId}&from=${r.from}&to=${r.to}` as Route;

  return frame(
    <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-muted-foreground">{titles[last]}</span>
        <span className="font-display text-lg font-semibold tabular-nums">{bahtFull(vals[last]!)}</span>
        <span className="text-muted-foreground">ต่อวัน</span>
        {prev !== undefined && <DeltaChip pct={changePct(vals[last], vals[prev])} vs={labels[prev]} />}
      </p>
      <TrendLine
        key={`${menuId}-${n}`}
        label={menu.label}
        labels={labels}
        titles={titles.map((t, i) => (months[i].days ? t : `${t} · ไม่มีข้อมูล`))}
        values={vals}
        color={TONES.clay[0]}
        height={150}
        axis={bahtCompact}
        tip={(v) => `${bahtFull(v)}/วัน`}
        rows={(i) => (pts[i].days ? [{ label: "จาน/วัน", value: (pts[i].qty / pts[i].days).toFixed(1) }] : [])}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
        <span>
          {rank > 0 && catName ? `อันดับ ${rank} จาก ${peers.length} ในหมวด${catName} · ` : ""}
          {titles[last]} · {branchName} · เฉลี่ยต่อวันที่มีข้อมูล
        </span>
        <Link href={href} className="text-sm font-semibold text-primary hover:underline">
          ดูละเอียดในหน้ายอดขาย ›
        </Link>
      </div>
    </>
  );
}
