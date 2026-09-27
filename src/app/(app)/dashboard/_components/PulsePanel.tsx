"use client";

// Sprint 4 Part 20a L5 — the daily pulse on the dashboard (ADR 0020 Q4).
//
// This panel is the answer to the objection that started the whole Sprint 4
// grill: importing files periodically leaves an owner staring at figures twelve
// days stale, and an owner who sees that stops opening the app.
//
// Three rules it follows and one thing it refuses to do:
//
//  1. **Every figure says where it came from.** A number that hides its
//     provenance gets trusted past the point it has earned (rules C10, W4). A
//     day backed by an imported file and a day backed by a typed number are both
//     legitimate and are not the same thing.
//  2. **A day with neither shows a dash and an entry box**, never a zero. Zero
//     means "sold nothing", which is a different and much worse claim.
//  3. **The roll-up says it is a roll-up, and says what it is missing** — a
//     business-wide figure is never a silent total (CONTEXT.md, Tenant).
//
// And it does NOT draw a chart. The dashboard answers "how is today"; /sales
// answers "how is this month" and already does it well. Two pages answering the
// same question leaves neither answering it best.

import { useActionState, useState } from "react";
import {
  recordSalesPulseAction,
  type RecordPulseActionState,
} from "@/app/(app)/sales/pulse-actions";
import type { PulseDashboardView } from "@/app/(app)/sales/_components/sales-view";


const baht = (v: string | null) =>
  v === null
    ? "—"
    : `฿${Number(v).toLocaleString("th-TH", { maximumFractionDigits: 0 })}`;

export default function PulsePanel({
  dashboard,
  todayIso,
}: {
  dashboard: PulseDashboardView;
  /** Bangkok's today, computed on the SERVER — a device in another timezone
   *  would otherwise offer a date the schema rejects (Decision #60). */
  todayIso: string;
}) {
  const [openBranchId, setOpenBranchId] = useState<string | null>(null);
  const [state, action, pending] = useActionState<RecordPulseActionState | null, FormData>(
    recordSalesPulseAction,
    null
  );

  if (dashboard.branches.length === 0) return null;

  const multi = dashboard.branches.length > 1;

  // Kong (2026-09-28): the table was "ง่อยเกิ้น" — four cramped columns, a
  // tiny "+ คีย์ยอดวันนี้" link, and a paragraph of footnote. Rebuilt as one card
  // per branch: today is the headline (or a real button when nobody has keyed
  // it), yesterday and the week sit underneath, and the long explanation folds
  // away behind "ตัวเลขนี้คืออะไร?". The three rules in the header still hold.
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">ยอดที่ลูกค้าจ่ายรายวัน</h2>
          <p className="text-xs text-muted-foreground">ตัวเลขจากเครื่องเก็บเงิน รวม VAT และ service charge</p>
        </div>
        <a href="/sales" className="text-xs font-medium text-primary hover:underline">
          ดูยอดขายทั้งเดือน →
        </a>
      </div>

      <div className={`mt-4 grid gap-3 ${multi ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:max-w-md"}`}>
        {dashboard.branches.map((b) => {
          const keying = openBranchId === b.branchId;
          return (
            <div key={b.branchId} className="rounded-lg border border-border bg-background p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium">{b.branchName}</p>
                {b.today.sourceLabel ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{b.today.sourceLabel}</span>
                ) : null}
              </div>

              <p className="mt-3 text-xs text-muted-foreground">วันนี้</p>
              {b.today.amount !== null ? (
                <p className="tabular-nums text-2xl font-semibold">{baht(b.today.amount)}</p>
              ) : keying ? (
                <form action={action} className="mt-1 space-y-2">
                  <input type="hidden" name="branchId" value={b.branchId} />
                  <input type="hidden" name="businessDate" value={todayIso} />
                  <input name="amount" inputMode="decimal" placeholder="ยอดที่ลูกค้าจ่ายวันนี้ (บาท)" className="input w-full" autoFocus />
                  <input name="note" placeholder="หมายเหตุ (ไม่บังคับ)" className="input w-full" />
                  <div className="flex items-center gap-2">
                    <button type="submit" disabled={pending} className="btn">
                      {pending ? "กำลังบันทึก…" : "บันทึก"}
                    </button>
                    <button type="button" onClick={() => setOpenBranchId(null)} className="text-sm text-muted-foreground hover:text-foreground">
                      ยกเลิก
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpenBranchId(b.branchId)}
                  className="mt-1 w-full rounded-lg border border-dashed border-border-strong px-3 py-2.5 text-sm font-medium text-primary hover:bg-muted"
                >
                  + คีย์ยอดวันนี้
                </button>
              )}
              {b.today.note ? <p className="mt-1 text-xs text-muted-foreground">“{b.today.note}”</p> : null}

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
                <div>
                  <p className="text-xs text-muted-foreground">เมื่อวาน</p>
                  <p className="tabular-nums text-sm font-medium">{baht(b.yesterday.amount)}</p>
                  {b.yesterday.source ? (
                    <p className="text-[11px] text-muted-subtle">{b.yesterday.source === "PULSE" ? "คีย์เอง" : "จากไฟล์"}</p>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">7 วันล่าสุด</p>
                  <p className="tabular-nums text-sm font-medium">{baht(b.last7Total)}</p>
                  <p className="text-[11px] text-muted-subtle">
                    {b.last7DaysWithFigure === 0 ? "ยังไม่มีข้อมูล" : `มีข้อมูล ${b.last7DaysWithFigure} จาก 7 วัน`}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {multi ? (
          <div className="rounded-lg border border-border bg-surface-sunk p-4">
            <p className="font-medium">รวมทุกสาขา</p>
            <p className="mt-3 text-xs text-muted-foreground">วันนี้</p>
            <p className="tabular-nums text-2xl font-semibold">{baht(dashboard.todayTotal)}</p>
            {dashboard.branchesMissingToday > 0 ? (
              <p className="mt-1 text-xs text-warn">ยังไม่ครบ — อีก {dashboard.branchesMissingToday} สาขายังไม่มีตัวเลขวันนี้</p>
            ) : null}
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
              <div>
                <p className="text-xs text-muted-foreground">เมื่อวาน</p>
                <p className="tabular-nums text-sm font-medium">{baht(dashboard.yesterdayTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">7 วันล่าสุด</p>
                <p className="tabular-nums text-sm font-medium">{baht(dashboard.last7Total)}</p>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {state?.ok === false && (
        <p className="mt-3 text-sm text-bad">{state.formError ?? Object.values(state.fieldErrors ?? {})[0]}</p>
      )}

      <details className="mt-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-primary">ตัวเลขนี้คืออะไร?</summary>
        <p className="mt-2 leading-relaxed">
          ยอดที่คีย์เองคือ <strong>ยอดที่ลูกค้าจ่าย</strong> ตามเครื่องเก็บเงิน (รวม VAT และ service charge)
          จึงไม่เท่ากับ “ยอดขาย” ในการ์ดด้านบนและหน้าต้นทุน ซึ่งไม่รวมสองอย่างนั้น ·
          เมื่อนำเข้าไฟล์ยอดขายของวันนั้นแล้ว ระบบจะใช้ตัวเลขจากไฟล์ และเก็บยอดที่คีย์ไว้เป็นตัวตรวจสอบ
        </p>
      </details>
    </section>
  );
}
