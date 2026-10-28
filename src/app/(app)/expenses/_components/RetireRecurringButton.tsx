"use client";

// Sprint 3 Part 16 L5c — retiring a template.
// Expense review 2026-10-27: the app's own dialog instead of confirm().
//
// Soft delete, and the copy says what survives: the bills it already produced
// keep pointing at it, so a confirmed month can still say where it came from.

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/(app)/menus/_components/sheet-parts";
import { orStale } from "@/lib/stale-tab";
import type { RecurringExpenseActionState } from "../actions";

export default function RetireRecurringButton({
  action,
  recurringId,
  description,
}: {
  action: (
    prev: RecurringExpenseActionState,
    fd: FormData
  ) => Promise<RecurringExpenseActionState>;
  recurringId: string;
  description: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    (prev: RecurringExpenseActionState, fd: FormData) => orStale(action(prev, fd)),
    { ok: false } as RecurringExpenseActionState
  );
  const [asking, setAsking] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) router.push("/expenses/recurring");
  }, [state, router]);

  const formError = state.ok === false ? state.formError : undefined;

  return (
    <form ref={form} action={formAction}>
      <input type="hidden" name="id" value={recurringId} />
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={isPending}
        className="btn-danger"
      >
        {isPending ? "กำลังเลิกใช้…" : "เลิกใช้รายการประจำนี้"}
      </button>
      {formError && <p className="mt-1 text-xs text-bad">{formError}</p>}
      {asking && (
        <ConfirmDialog
          spec={{
            title: `เลิกใช้${description}?`,
            lines: [
              "บิลที่บันทึกไปแล้วยังอยู่ครบ และยังบอกได้ว่ามาจากรายการนี้",
              "ระบบจะไม่เตือนงวดที่ยังไม่ได้บันทึกของรายการนี้อีก",
              "ถ้าแค่พักไว้ชั่วคราว ให้เอาเครื่องหมาย “เปิดใช้งาน” ออกในฟอร์มแทน",
            ],
            money: null,
            who: "",
            go: "เลิกใช้",
            back: "ไม่เลิกใช้",
            onGo: () => form.current?.requestSubmit(),
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </form>
  );
}
