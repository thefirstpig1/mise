"use client";

// ============================================================
// Mise — the posting queue and its coverage (Part 22 L5, ADR 0022)
// ============================================================
// One table, because the queue and the report are one row seen from two sides:
// a day with sales, and what a posting has or has not done to it.
//
// The whole screen is organised around one refusal being useful. Pressing on a
// day already posted takes a real result back, so the first press is REFUSED and
// this component renders what it would discard (Q2b) — the confirmation is the
// feature, not the friction.
// ============================================================

import { useActionState, useMemo, useState } from "react";
import {
  postConsumptionAction,
  POST_CONSUMPTION_INIT,
} from "@/app/consumption/actions";
import {
  CONSUMPTION_DAY_STATE_HINTS_TH,
  CONSUMPTION_DAY_STATE_LABELS_TH,
  type ConsumptionDayView,
} from "@/app/consumption/_components/consumption-view";
import {
  CONSUMPTION_SKIP_REASON_HINTS_TH,
  CONSUMPTION_SKIP_REASON_LABELS_TH,
} from "@/lib/validations/consumption";

/** Same local helper the recipe forms use — no lib for one line. */
function newSubmitKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const money = (v: string) =>
  Number(v).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const STATE_TONE: Record<ConsumptionDayView["state"], string> = {
  NOT_POSTED: "bg-warn-bg text-warn border-warn-border",
  OUT_OF_WINDOW: "bg-muted text-muted-foreground border-border",
  POSTED: "bg-emerald-50 text-emerald-900 border-emerald-300",
  POSTED_PARTIAL: "bg-warn-bg text-warn border-warn-border",
  POSTED_STALE: "bg-orange-50 text-orange-900 border-orange-300",
};

export function ConsumptionDayTable({
  days,
  branchId,
}: {
  days: ConsumptionDayView[];
  branchId: string;
}) {
  const [state, formAction, pending] = useActionState(
    postConsumptionAction,
    POST_CONSUMPTION_INIT
  );
  const [open, setOpen] = useState<string | null>(null);

  // A day past the backdate window can never post, so it is never offered — a
  // button that cannot work is worse than the sentence saying why (rule N9).
  const postable = useMemo(
    () => days.filter((d) => d.withinWindow).map((d) => d.businessDate),
    [days]
  );

  // Minted per render of the form, not per press: a retry of the SAME press must
  // carry the same key, which is what stops a double-submit consuming twice.
  const submitKey = useMemo(() => newSubmitKey(), [days]);

  const needsAck = !state.ok ? state.needsAcknowledgement : undefined;

  return (
    <div className="space-y-4">
      {state.ok && state.days.length > 0 && (
        <div className="rounded-lg border border-primary bg-primary/5 p-4 text-sm">
          <p className="font-medium">ตัดสต๊อกเรียบร้อย {state.days.length} วัน</p>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {state.days.map((d) => (
              <li key={d.businessDate}>
                {d.businessDateLabel} — ตัดได้ {d.menusPosted} เมนู
                {d.menusSkipped > 0 && ` · ตัดไม่ได้ ${d.menusSkipped} เมนู`}
                {d.coveragePercent !== null &&
                  ` · ครอบคลุม ${d.coveragePercent}% ของยอดขาย`}
                {d.replaced && " · แทนที่ของเดิม"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!state.ok && state.formError && (
        <p className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {state.formError}
        </p>
      )}

      {needsAck && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="font-medium">
            {needsAck.days.length} วันนี้ตัดสต๊อกไปแล้ว — กดต่อจะ<strong>ยกเลิกของเดิมทั้งวัน แล้วตัดใหม่</strong>
          </p>
          <ul className="mt-2 space-y-1">
            {needsAck.days.map((d) => (
              <li key={d.businessDate}>
                {d.businessDateLabel} — ตัดเมื่อ {d.postedAtLabel} · ครอบคลุม{" "}
                {money(d.coveredNetAmount)} จาก {money(d.totalNetAmount)} บาท
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            ของเดิมไม่ได้ถูกลบ — ระบบออกรายการกลับให้ครบทุกแถว แล้วบันทึกชุดใหม่ทับ
          </p>
        </div>
      )}

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="submit_key" value={submitKey} />
        <input type="hidden" name="branch_id" value={branchId} />
        {postable.map((d) => (
          <input key={d} type="hidden" name="business_date" value={d} />
        ))}
        {/* Never defaulted on: it takes real ledger rows back (Q2b). */}
        {needsAck && (
          <input type="hidden" name="acknowledge_repost" value="on" />
        )}

        <button
          type="submit"
          disabled={pending || postable.length === 0}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending
            ? "กำลังตัดสต๊อก…"
            : needsAck
              ? `ยืนยัน — ตัดใหม่ ${postable.length} วัน`
              : `ตัดสต๊อกตามสูตร ${postable.length} วัน`}
        </button>
        {postable.length === 0 && (
          <p className="text-xs text-muted-foreground">
            ไม่มีวันที่ตัดสต๊อกได้ในช่วงนี้
          </p>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">วันขาย</th>
              <th className="px-3 py-2 text-right">ยอดขาย</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2 text-right">ครอบคลุม</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <DayRow
                key={`${d.branchId}-${d.businessDate}`}
                day={d}
                open={open === d.businessDate}
                onToggle={() =>
                  setOpen(open === d.businessDate ? null : d.businessDate)
                }
              />
            ))}
            {days.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  ยังไม่มียอดขายนำเข้าในช่วงนี้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DayRow({
  day,
  open,
  onToggle,
}: {
  day: ConsumptionDayView;
  open: boolean;
  onToggle: () => void;
}) {
  const hasDetail = day.skipped.length > 0;
  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-3 py-2">
          {day.businessDateLabel}
          {day.postedAtLabel && (
            <span className="block text-xs text-muted-foreground">
              ตัดเมื่อ {day.postedAtLabel}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{money(day.netAmount)}</td>
        <td className="px-3 py-2">
          <span
            className={`inline-block rounded border px-1.5 py-0.5 text-xs ${STATE_TONE[day.state]}`}
          >
            {CONSUMPTION_DAY_STATE_LABELS_TH[day.state]}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {CONSUMPTION_DAY_STATE_HINTS_TH[day.state]}
          </span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {day.coveragePercent === null ? "—" : `${day.coveragePercent}%`}
        </td>
        <td className="px-3 py-2 text-right">
          {hasDetail && (
            <button
              type="button"
              onClick={onToggle}
              className="text-xs text-primary underline"
            >
              {open ? "ซ่อน" : `ดู ${day.skipped.length} เมนูที่ตัดไม่ได้`}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={5} className="px-3 py-3">
            <ul className="space-y-2">
              {day.skipped.map((s) => (
                <li key={s.menuId} className="text-xs">
                  <span className="font-medium">{s.menuName}</span>{" "}
                  <span className="text-muted-foreground">
                    ({Number(s.qty).toLocaleString("th-TH")} ที่ ·{" "}
                    {money(s.netAmount)} บาท)
                  </span>
                  <br />
                  <span className="text-muted-foreground">
                    {CONSUMPTION_SKIP_REASON_LABELS_TH[s.reason]}
                    {s.detail && `: ${s.detail}`} —{" "}
                    {CONSUMPTION_SKIP_REASON_HINTS_TH[s.reason]}
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
