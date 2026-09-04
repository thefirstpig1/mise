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
} from "@/app/sales/pulse-actions";
import type { PulseDashboardView } from "@/app/sales/_components/sales-view";


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

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">ยอดขาย</h2>
        <a href="/sales" className="text-xs text-primary hover:underline">
          ดูทั้งเดือน →
        </a>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-2 py-1 text-left">สาขา</th>
              <th className="px-2 py-1 text-right">วันนี้</th>
              <th className="px-2 py-1 text-right">เมื่อวาน</th>
              <th className="px-2 py-1 text-right">7 วันล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {dashboard.branches.map((b) => (
              <tr key={b.branchId} className="border-b border-border/50 align-top">
                <td className="px-2 py-2">
                  <div className="font-medium">{b.branchName}</div>
                  {b.today.sourceLabel && (
                    <div className="text-xs text-muted-foreground">{b.today.sourceLabel}</div>
                  )}
                  {b.today.note && (
                    <div className="text-xs text-muted-foreground">“{b.today.note}”</div>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  {b.today.amount === null ? (
                    openBranchId === b.branchId ? (
                      <form action={action} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="branchId" value={b.branchId} />
                        <input type="hidden" name="businessDate" value={todayIso} />
                        <input
                          name="amount"
                          inputMode="decimal"
                          placeholder="ยอดวันนี้"
                          className={"input px-2 py-1.5 w-28 text-right"}
                        />
                        <input
                          name="note"
                          placeholder="หมายเหตุ"
                          className={"input px-2 py-1.5 w-24"}
                        />
                        <button
                          type="submit"
                          disabled={pending}
                          className="rounded-lg bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
                          {pending ? "…" : "บันทึก"}
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenBranchId(b.branchId)}
                        className="text-xs text-primary hover:underline"
                      >
                        + คีย์ยอดวันนี้
                      </button>
                    )
                  ) : (
                    <span className="font-medium">{baht(b.today.amount)}</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <div>{baht(b.yesterday.amount)}</div>
                  {b.yesterday.sourceLabel && (
                    <div className="text-[10px] text-muted-foreground">
                      {b.yesterday.source === "PULSE" ? "คีย์เอง" : "จากไฟล์"}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <div>{baht(b.last7Total)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {b.last7DaysWithFigure} วัน
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {multi && (
            <tfoot className="border-t-2 border-border">
              <tr>
                <td className="px-2 py-2 text-sm font-medium">รวมทุกสาขา</td>
                <td className="px-2 py-2 text-right font-medium">{baht(dashboard.todayTotal)}</td>
                <td className="px-2 py-2 text-right font-medium">
                  {baht(dashboard.yesterdayTotal)}
                </td>
                <td className="px-2 py-2 text-right font-medium">{baht(dashboard.last7Total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {dashboard.rollUpNote && (
        <p className="mt-2 text-xs text-muted-foreground">{dashboard.rollUpNote}</p>
      )}

      {state?.ok === false && (
        <p className="mt-2 text-xs text-bad">
          {state.formError ?? Object.values(state.fieldErrors ?? {})[0]}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        ยอดที่คีย์เองคือ <strong>ยอดที่ลูกค้าจ่าย</strong> (ตัวเลขในเครื่องเก็บเงิน รวม VAT
        และ Service charge) — ไม่ใช่ตัวเลข “ยอดขาย” ในหน้าต้นทุน ซึ่งไม่รวมสองอย่างนั้น ·
        พอนำเข้าไฟล์ของวันนั้นแล้ว ระบบจะใช้ตัวเลขจากไฟล์ และเก็บยอดที่คีย์ไว้เป็นตัวตรวจสอบ
      </p>
    </section>
  );
}
