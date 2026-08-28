"use client";

// Sprint 5 Part 26 L5 — the correction control (ADR 0028 Q8).
//
// An inline <details> with a reason box, not a `confirm()`. The same two reasons
// waste settled on: a void REQUIRES a reason so it needs an input either way,
// and a browser modal in the middle of a Server Action can wedge the page.
//
// The wording says what actually happens, because "ยกเลิก" alone reads like
// deletion and this deletes nothing: the meal stays in the list with its reason
// beside it, and compensating rows are appended to the ledger.

import { useActionState } from "react";
import type { VoidStaffMealActionState } from "@/app/staff-meals/actions";

export default function VoidStaffMealButton({
  action,
  staffMealId,
  /** What is being un-recorded, so the open box says which row it belongs to. */
  label,
}: {
  action: (
    prev: VoidStaffMealActionState,
    fd: FormData
  ) => Promise<VoidStaffMealActionState>;
  staffMealId: string;
  label: string;
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as VoidStaffMealActionState);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldError =
    state.ok === false ? state.fieldErrors?.voidReason : undefined;

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        ยกเลิกรายการนี้
      </summary>

      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="id" value={staffMealId} />
        <p className="text-xs text-muted-foreground">
          คืนวัตถุดิบของ {label} เข้าสต๊อก ตามราคาที่มันออกไป —
          รายการเดิมจะยังอยู่ให้เห็น พร้อมเหตุผลที่ยกเลิก
        </p>
        <input
          name="void_reason"
          type="text"
          maxLength={500}
          required
          placeholder="เหตุผล เช่น คีย์ผิดคน"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        {fieldError && <p className="text-xs text-red-600">{fieldError}</p>}
        {formError && <p className="text-xs text-red-600">{formError}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {isPending ? "กำลังยกเลิก…" : "ยืนยันการยกเลิก"}
        </button>
      </form>
    </details>
  );
}
