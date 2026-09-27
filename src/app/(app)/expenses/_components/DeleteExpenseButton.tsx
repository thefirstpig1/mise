"use client";

// Sprint 3 Part 16 L5b — hide a bill someone recorded by mistake.
//
// A bill created by a goods receipt is not deletable here and the button says
// why rather than failing on submit: the money exists because stock arrived, so
// the receipt is where both get undone (ADR 0016 Q3.3).

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ExpenseActionState } from "../actions";

export default function DeleteExpenseButton({
  action,
  expenseId,
  fromGoodsReceipt,
  sourceGrId,
}: {
  action: (
    prev: ExpenseActionState,
    fd: FormData
  ) => Promise<ExpenseActionState>;
  expenseId: string;
  fromGoodsReceipt: boolean;
  sourceGrId: string | null;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as ExpenseActionState
  );

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
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm("ลบรายการค่าใช้จ่ายนี้?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={expenseId} />
      <button
        type="submit"
        disabled={isPending}
        className="text-sm text-bad hover:underline disabled:opacity-60"
      >
        {isPending ? "กำลังลบ…" : "ลบรายการนี้"}
      </button>
      {formError && <p className="mt-1 text-xs text-bad">{formError}</p>}
    </form>
  );
}
