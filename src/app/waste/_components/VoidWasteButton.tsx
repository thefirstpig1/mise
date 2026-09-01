"use client";

// Sprint 3 Part 17 L5a — the correction control (ADR 0017 Q2).
//
// An inline <details> that opens a reason box, NOT a `confirm()` dialog. Two
// reasons, and the second is the real one:
//
//  1. A void REQUIRES a reason, so it needs an input either way — a modal that
//     only asks "are you sure?" would then be a second interruption for nothing.
//  2. A browser modal blocks the page. This form posts a Server Action; a
//     `confirm()` in the middle of that is a UI that can wedge.
//
// The wording says what actually happens, because "ยกเลิก" alone reads like
// deletion and this deletes nothing: the original entry stays visible and a
// compensating row is appended beside it.

import { useActionState } from "react";
import type { VoidWasteActionState } from "@/app/waste/actions";

export default function VoidWasteButton({
  action,
  wasteId,
  label,
}: {
  action: (
    prev: VoidWasteActionState,
    fd: FormData
  ) => Promise<VoidWasteActionState>;
  wasteId: string;
  /** What is being un-recorded, so the open box says which row it belongs to. */
  label: string;
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as VoidWasteActionState);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldError =
    state.ok === false ? state.fieldErrors?.voidReason : undefined;

  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
        ยกเลิกรายการนี้
      </summary>

      <form action={formAction} className="mt-2 space-y-2">
        <input type="hidden" name="id" value={wasteId} />
        <p className="text-xs text-muted-foreground">
          คืน {label} เข้าสต๊อก — รายการเดิมจะยังอยู่ให้เห็น พร้อมเหตุผลที่ยกเลิก
        </p>
        <input
          name="void_reason"
          type="text"
          maxLength={500}
          required
          placeholder="เหตุผล เช่น คีย์ผิดหน่วย"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        {fieldError && <p className="text-xs text-bad">{fieldError}</p>}
        {formError && <p className="text-xs text-bad">{formError}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg border border-bad-border px-3 py-1.5 text-xs font-medium text-bad hover:bg-bad-bg disabled:opacity-50"
        >
          {isPending ? "กำลังยกเลิก…" : "ยืนยันการยกเลิก"}
        </button>
      </form>
    </details>
  );
}
