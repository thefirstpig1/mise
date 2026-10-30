"use client";

// ============================================================
// Mise — one dish by month, and "did the promotion work" (Kong, 2026-10-28)
// ============================================================
// Two tabs in the menu popup, beside what was already there (ช่วงนี้):
//  - รายเดือน: the dish's own line over 3 / 6 / 12 months, sales or plates,
//    with months sold under its usual price labelled ราคาลด (rule TR4).
//  - ทำโปรได้ผลไหม: the reader says when the promotion ran (nothing records
//    one yet) and the screen answers three questions per day against the time
//    before it — did this dish sell more, did the gain come from the other
//    dishes of its category, and did the category make more profit after the
//    discount (rule TR5).
// ============================================================

import { useEffect, useState } from "react";
import TrendLine from "@/components/charts/TrendLine";
import { TONES } from "@/components/charts/chart-theme";
import { readApi } from "@/lib/read-api";
import { announceStale } from "@/lib/stale-tab";
import {
  PROMO_MIN_DAYS,
  changePct,
  discountedMonths,
  lastMonths,
  monthLabelTh,
  perDay,
  type PromoVerdict,
  type TrendMetric,
} from "@/lib/sales-trend";
import { periodLabelTh } from "@/lib/sales-insight";
import type { PromoCheckResult } from "../insight-reads";
import { DeltaChip, Seg, bahtFull, metricFmt, useSalesTrend } from "./SalesTrend";

const COLOR = TONES.clay[0];

export function MenuMonthlyTab({ menuId, endMonth }: { menuId: string; endMonth: string }) {
  const t = useSalesTrend();
  const [n, setN] = useState<"3" | "6" | "12">("6");
  const [metric, setMetric] = useState<TrendMetric>("net");
  const months = lastMonths(endMonth, Number(n));
  const [res, setRes] = useState<{ key: string; r: Awaited<ReturnType<NonNullable<typeof t>["load"]>> } | null>(null);
  const key = `${months[0]}|${n}`;
  useEffect(() => {
    if (!t) return;
    let live = true;
    void t.load(months, false).then((r) => live && setRes({ key, r }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, t?.load]);

  if (!t) return null;
  const r = res?.r;
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Seg label="ช่วงเวลา" value={n} onChange={setN} items={[["3", "3 เดือน"], ["6", "6 เดือน"], ["12", "12 เดือน"]]} />
      <Seg label="วัดจาก" value={metric} onChange={setMetric} items={[["net", "ยอดขาย"], ["qty", "จำนวนจาน"]]} />
    </div>
  );
  if (!r) {
    return (
      <div className="space-y-3">
        {controls}
        <div aria-busy className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (!r.ok) return <p className="py-8 text-center text-sm text-bad">{r.formError}</p>;

  const trend = r.trend;
  const menu = trend.menus.find((m) => m.key === menuId);
  const titles = trend.months.map((m) => monthLabelTh(m.key));
  const labels = titles.map((l) => l.replace(/\s\d{2}$/, ""));
  if (!menu) return <div className="space-y-3">{controls}<p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มียอดขายของเมนูนี้ในช่วงนี้</p></div>;

  const pts = menu.points;
  const vals = pts.map((p) => perDay(p, metric));
  const f = metricFmt(metric);
  const idx = pts.map((p, i) => (p.days ? i : -1)).filter((i) => i >= 0);
  const last = idx[idx.length - 1] ?? -1;
  const prev = idx[idx.length - 2] ?? -1;
  const price = (i: number) => (pts[i].qty > 0 ? pts[i].net / pts[i].qty : null);
  const known = vals.filter((v): v is number => v !== null);
  const best = known.length ? vals.indexOf(Math.max(...known)) : -1;
  const disc = discountedMonths(pts);

  return (
    <div className="space-y-4">
      {controls}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        <Fact label={`ยอดขายต่อวัน ${last >= 0 ? labels[last] : ""}`} value={last >= 0 ? bahtFull(perDay(pts[last], "net") ?? 0) : "—"}>
          {prev >= 0 && <DeltaChip pct={changePct(perDay(pts[last], "net"), perDay(pts[prev], "net"))} vs={labels[prev]} />}
        </Fact>
        <Fact label="จานต่อวัน" value={last >= 0 ? (perDay(pts[last], "qty") ?? 0).toFixed(1) : "—"}>
          {prev >= 0 && <DeltaChip pct={changePct(perDay(pts[last], "qty"), perDay(pts[prev], "qty"))} vs={labels[prev]} />}
        </Fact>
        <Fact label="ราคาเฉลี่ยต่อจาน" value={last >= 0 && price(last) !== null ? bahtFull(price(last)!) : "—"}>
          <span className="text-xs text-muted-foreground">หลังส่วนลด ไม่รวม VAT</span>
        </Fact>
        <Fact label="เดือนที่ดีที่สุดในช่วงนี้" value={best >= 0 ? titles[best] : "—"}>
          <span className="text-xs text-muted-foreground">ตาม{metric === "qty" ? "จำนวนจาน" : "ยอดขาย"}ต่อวัน</span>
        </Fact>
      </div>
      <TrendLine
        key={`${menuId}-${n}-${metric}`}
        label={menu.label}
        labels={labels}
        titles={titles.map((m, i) => (trend.months[i].days ? m : `${m} · ไม่มีข้อมูล`))}
        values={vals}
        color={COLOR}
        height={230}
        axis={f.axis}
        tip={f.tip}
        rings={disc}
        ringLabel="ราคาลด"
        rows={(i) => {
          const rows: { label: string; value: string; tone?: "good" | "bad" }[] = [];
          if (metric !== "qty" && pts[i].days) rows.push({ label: "จาน/วัน", value: (pts[i].qty / pts[i].days).toFixed(1) });
          const p = price(i);
          if (p !== null) rows.push({ label: "ราคาเฉลี่ย", value: `${bahtFull(p)}${disc.includes(i) ? " (ลด)" : ""}` });
          const before = idx.filter((k) => k < i).pop();
          if (before !== undefined) {
            const c = changePct(vals[i], vals[before]);
            if (c !== null) rows.push({ label: `เทียบ ${titles[before]}`, value: `${c >= 0 ? "+" : ""}${c.toFixed(1)}%`, tone: c >= 0 ? "good" : "bad" });
          }
          return rows;
        }}
      />
      <p className="text-xs text-muted-foreground">
        เฉลี่ยต่อวันที่มีข้อมูล · “ราคาลด” = เดือนที่ราคาเฉลี่ยต่อจานต่ำกว่าปกติของเมนูนี้เกิน 5% (มีส่วนลดหรือโปร)
      </p>
    </div>
  );
}

function Fact({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-3.5 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-display text-lg font-semibold tabular-nums">{value}</span>
      {children}
    </div>
  );
}

// ------------------------------------------------------------
// ทำโปรได้ผลไหม
// ------------------------------------------------------------
const VERDICT: Record<PromoVerdict, { cls: string; icon: string; title: string; body: string }> = {
  worked: {
    cls: "border-good-border bg-good-bg text-good",
    icon: "✓",
    title: "ได้ผล: ขายเพิ่ม และส่วนใหญ่เป็นยอดใหม่",
    body: "เมนูนี้ขายเพิ่ม เมนูอื่นในหมวดลดลงน้อยกว่าที่เมนูนี้เพิ่ม",
  },
  moved: {
    cls: "border-warn-border bg-warn-bg text-warn",
    icon: "!",
    title: "ขายเพิ่ม แต่ส่วนใหญ่ย้ายมาจากเมนูอื่น",
    body: "เมนูอื่นในหมวดลดลงเกือบเท่าที่เมนูนี้เพิ่ม ลูกค้าเปลี่ยนจานมากกว่าสั่งเพิ่ม",
  },
  profit_down: {
    cls: "border-bad-border bg-bad-bg text-bad",
    icon: "×",
    title: "ขายเพิ่ม แต่กำไรของหมวดลดลง",
    body: "กำไรที่หายไปจากส่วนลดมากกว่ากำไรจากจานที่ขายเพิ่ม",
  },
  no_lift: {
    cls: "border-border bg-muted/50 text-foreground",
    icon: "–",
    title: "ยังไม่เห็นว่าขายเพิ่ม",
    body: "เมนูนี้ขายต่อวันในช่วงโปรไม่ได้มากกว่าก่อนโปรอย่างชัดเจน (เพิ่มไม่ถึง 5%)",
  },
  not_enough: {
    cls: "border-border bg-muted/50 text-foreground",
    icon: "?",
    title: "ข้อมูลยังไม่พอจะสรุป",
    body: `ต้องมียอดขายก่อนโปรอย่างน้อย ${PROMO_MIN_DAYS.before} วัน และในช่วงโปรอย่างน้อย ${PROMO_MIN_DAYS.during} วัน`,
  },
};

export function PromoCheckTab({ menuId, from, to, branchId }: { menuId: string; from: string; to: string; branchId?: string }) {
  const [pf, setPf] = useState(from);
  const [pt, setPt] = useState(to);
  const [base, setBase] = useState<"3m" | "1m">("3m");
  const [res, setRes] = useState<PromoCheckResult | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(pf) && /^\d{4}-\d{2}-\d{2}$/.test(pt) && pf <= pt;
  useEffect(() => {
    if (!valid) return;
    let live = true;
    setRes(null);
    void readApi<PromoCheckResult>("/api/sales", "promo", { menuId, from: pf, to: pt, base, branchId }).then((r) => {
      if (!r.ok && r.stale) announceStale();
      if (live) setRes(r);
    });
    return () => {
      live = false;
    };
  }, [menuId, pf, pt, base, branchId, valid]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="promo-from" className="text-muted-foreground">
          ช่วงโปร
        </label>
        <input id="promo-from" type="date" value={pf} onChange={(e) => setPf(e.target.value)} className="h-9 rounded-lg border border-border-strong bg-surface px-2" />
        <span>–</span>
        <input aria-label="ถึงวันที่" type="date" value={pt} onChange={(e) => setPt(e.target.value)} className="h-9 rounded-lg border border-border-strong bg-surface px-2" />
        <span className="text-muted-foreground">เทียบกับ</span>
        <Seg label="เทียบกับ" value={base} onChange={setBase} items={[["3m", "3 เดือนก่อนโปร"], ["1m", "เดือนก่อนโปร"]]} />
      </div>
      {!valid ? (
        <p className="text-sm text-bad">กรุณาเลือกวันเริ่มให้ไม่หลังวันสิ้นสุด</p>
      ) : res === null ? (
        <div aria-busy className="space-y-3">
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
          <div className="grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      ) : !res.ok ? (
        <p className="py-6 text-center text-sm text-bad">{res.formError}</p>
      ) : (
        <PromoResult r={res} />
      )}
    </div>
  );
}

function PromoResult({ r }: { r: Extract<PromoCheckResult, { ok: true }> }) {
  const { before, during, after } = r.check;
  const v = VERDICT[r.check.verdict];
  const plates = (x: number) => x.toFixed(1);
  const cards: { h: string; unit: string; b: number; d: number; a: number | null; fmt: (x: number) => string }[] = [
    { h: "เมนูนี้ขายเพิ่มไหม", unit: "จาน/วัน", b: before.menuQty, d: during.menuQty, a: after?.menuQty ?? null, fmt: plates },
    {
      h: "ดึงมาจากเมนูอื่นในหมวดไหม",
      unit: `จาน/วัน · เมนูอื่นใน${r.categoryName}รวมกัน`,
      b: before.otherQty,
      d: during.otherQty,
      a: after?.otherQty ?? null,
      fmt: plates,
    },
  ];
  if (r.canSeeCost && before.categoryProfit !== null && during.categoryProfit !== null) {
    cards.push({
      h: "กำไรเพิ่มจริงไหม",
      unit: `กำไรต่อวันของทั้งหมวด หลังหักส่วนลด`,
      b: before.categoryProfit,
      d: during.categoryProfit,
      a: after?.categoryProfit ?? null,
      fmt: bahtFull,
    });
  }

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 ${v.cls}`}>
        <span aria-hidden className="font-display text-2xl font-semibold leading-none">
          {v.icon}
        </span>
        <div>
          <p className="font-display text-lg font-semibold">{v.title}</p>
          <p className="mt-0.5 text-sm text-foreground">{v.body}</p>
        </div>
      </div>
      <div className={`grid gap-3 ${cards.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {cards.map((c) => (
          <div key={c.h} className="flex flex-col gap-1.5 rounded-xl border border-border p-3.5">
            <p className="text-sm font-semibold">{c.h}</p>
            <p className="text-xs text-muted-foreground">{c.unit}</p>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-xl font-semibold tabular-nums">
                <span className="text-muted-foreground">{c.fmt(c.b)}</span> → {c.fmt(c.d)}
              </span>
              <DeltaChip pct={changePct(c.d, c.b)} />
            </div>
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">
              {c.a === null ? "หลังโปรจบ: ยังไม่มีข้อมูล" : `หลังโปรจบ ${c.fmt(c.a)}`}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        ก่อนโปร {periodLabelTh(before.from, before.to)} ({before.days} วันที่มีข้อมูล) · ช่วงโปร {periodLabelTh(during.from, during.to)} ({during.days} วัน)
        {after && <> · หลังโปร {periodLabelTh(after.from, after.to)} ({after.days} วัน)</>} · เทียบเป็นต่อวันที่มีข้อมูล · ช่วงวันหยุดยาวอาจทำให้ตัวเลขแกว่ง
        {r.canSeeCost && <> · ต้นทุนจากสูตร ณ {r.costAsOf}</>}
      </p>
    </div>
  );
}
