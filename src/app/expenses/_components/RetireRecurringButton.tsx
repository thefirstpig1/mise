"use client";

// Sprint 3 Part 16 L5c — retiring a template.
//
// Soft delete, and the copy says what survives: the bills it already produced
// keep pointing at it, so a confirmed month can still say where it came from.

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { RecurringExpenseActionState } from "../actions";

export default function RetireRecurringButton({
  action,
  recurringId,
}: {
  action: (
    prev: RecurringExpenseActionState,
    fd: FormData
  ) => Promise<RecurringExpenseActionState>;
  recurringId: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as RecurringExpenseActionState
  );

  useEffect(() => {
    if (state.ok) router.push("/expenses/recurring");
  }, [state, router]);

  const formError = state.ok === false ? state.formError : undefined;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("เลิกใช้รายการประจำนี้? บิลที่บันทึกไปแล้วจะยังอยู่")) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={recurringId} />
      <button
        type="submit"
        disabled={isPending}
        className="text-sm text-red-600 hover:underline disabled:opacity-60"
      >
        {isPending ? "กำลังเลิกใช้…" : "เลิกใช้รายการประจำนี้"}
      </button>
      {formError && <p className="mt-1 text-xs text-red-600">{formError}</p>}
    </form>
  );
}
