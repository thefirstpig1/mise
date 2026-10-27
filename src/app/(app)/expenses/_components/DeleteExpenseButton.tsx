"use client";

// Sprint 3 Part 16 L5b — hide a bill someone recorded by mistake.
// Expense review 2026-10-27: the browser's confirm() box became the app's own
// dialog, which says what deleting DOES (the month's spend drops, a recurring
// month goes back on the due list) instead of "ลบรายการค่าใช้จ่ายนี้?".
//
// A bill created by a goods receipt is not deletable here and the button says
// why rather than failing on submit: the money exists because stock arrived, so
// the receipt is where both get undone (ADR 0016 Q3.3).

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/app/(app)/menus/_components/sheet-parts";
import { orStale } from "@/lib/stale-tab";
import type { ExpenseActionState } from "../actions";

export default function DeleteExpenseButton({
  action,
  expenseId,
  fromGoodsReceipt,
  sourceGrId,
  title,
  consequences,
}: {
  action: (
    prev: ExpenseActionState,
    fd: FormData
  ) => Promise<ExpenseActionState>;
  expenseId: string;
  fromGoodsReceipt: boolean;
  sourceGrId: string | null;
  /** "ลบบิลค่าทำบัญชีรายเดือน งวด ก.ย. 69?" */
  title: string;
  /** What changes once it is gone, one line each. */
  consequences: string[];
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    (prev: ExpenseActionState, fd: FormData) => orStale(action(prev, fd)),
    { ok: false } as ExpenseActionState
  );
  const [asking, setAsking] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) router.push("/expenses");
  }, [state, router]);

  if (fromGoodsReceipt) {
    return (
      <p className="text-xs text-muted-foreground">
        บิลนี้มาจากใบรับของ — ถ้าต้องการยกเลิก ให้{" "}
        <a href={`/goods-receipts/${sourceGrId}`} className="underline">
          ยกเลิกใบรับของ
        </a>{" "}
        แล้วบิลจะถูกยกเลิกไปพร้อมกัน
      </p>
    );
  }

  const formError = state.ok === false ? state.formError : undefined;

  return (
    <form ref={form} action={formAction}>
      <input type="hidden" name="id" value={expenseId} />
      <button
        type="button"
        onClick={() => setAsking(true)}
        disabled={isPending}
        className="rounded-lg border border-bad-border bg-surface px-4 py-2 text-sm font-medium text-bad hover:bg-bad-bg disabled:opacity-60"
      >
        {isPending ? "กำลังลบ…" : "ลบบิลนี้"}
      </button>
      {formError && <p className="mt-1 text-xs text-bad">{formError}</p>}
      {asking && (
        <ConfirmDialog
          spec={{
            title,
            lines: consequences,
            money: null,
            who: "",
            go: "ลบบิล",
            back: "ไม่ลบ",
            onGo: () => form.current?.requestSubmit(),
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </form>
  );
}
