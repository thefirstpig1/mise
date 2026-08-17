"use client";

// Sprint 3 Part 16 L5b — mark a bill paid, or take it back.
//
// A separate one-field action rather than the whole form: "I paid this" is the
// most common thing anyone does to a bill after recording it, and making that
// require re-submitting every line is how stale amounts get saved by accident.
// The date may be left blank — the server stamps `now()`, because the DB rightly
// refuses a PAID bill with no timestamp behind it.

import { useActionState } from "react";
import type { ExpenseActionState } from "../actions";

export default function PaymentToggle({
  action,
  expenseId,
  paymentStatus,
  paymentMethod,
}: {
  action: (
    prev: ExpenseActionState,
    fd: FormData
  ) => Promise<ExpenseActionState>;
  expenseId: string;
  paymentStatus: "UNPAID" | "PAID";
  paymentMethod: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as ExpenseActionState
  );
  const next = paymentStatus === "PAID" ? "UNPAID" : "PAID";
  const formError = state.ok === false ? state.formError : undefined;

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={expenseId} />
      <input type="hidden" name="payment_status" value={next} />
      <input type="hidden" name="payment_method" value={paymentMethod ?? ""} />
      {next === "PAID" && (
        <div>
          <label htmlFor="paid_at" className="block text-xs text-muted-foreground">
            วันที่จ่าย (เว้นว่าง = วันนี้)
          </label>
          <input
            id="paid_at"
            name="paid_at"
            type="date"
            className="mt-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
      )}
      {next === "UNPAID" && <input type="hidden" name="paid_at" value="" />}
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {isPending
          ? "กำลังบันทึก…"
          : next === "PAID"
            ? "ทำเครื่องหมายว่าจ่ายแล้ว"
            : "ยกเลิกสถานะจ่ายแล้ว"}
      </button>
      {formError && <p className="text-xs text-red-600">{formError}</p>}
    </form>
  );
}
