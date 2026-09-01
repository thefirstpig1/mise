"use client";

// Sprint 3 Part 15 L5a — opening a count sheet.
//
// The blind-count switch (Q7) is here rather than on the sheet itself because it
// is a decision about how THIS count will be run, made by whoever starts it —
// once someone has seen the expected figure, turning it off changes nothing.
//
// A branch that already has an open sheet is shown as such in the picker, so the
// user meets the constraint before submitting rather than as a rejection.

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StockCountActionState } from "../actions";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
const labelClass = "block text-sm font-medium";

export default function OpenCountForm({
  action,
  branches,
  openByBranch,
  todayBangkok,
  preselectBranchId,
}: {
  action: (
    prev: StockCountActionState,
    fd: FormData
  ) => Promise<StockCountActionState>;
  branches: { id: string; name: string }[];
  /** branchId → the id of the sheet already open there (Q8). */
  openByBranch: Record<string, string>;
  todayBangkok: string;
  /**
   * Part 17 L5b: which branch the caller meant, when arriving from the below-par
   * list. Already validated against `branches` by the page. It wins over the
   * first-free default even if that branch is already counting — the user asked
   * for this branch, and the "already open" notice tells them what happened
   * better than silently landing them somewhere else would.
   */
  preselectBranchId?: string;
}) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    action,
    { ok: false } as StockCountActionState
  );

  const firstFree = branches.find((b) => !openByBranch[b.id]) ?? branches[0];
  const [branchId, setBranchId] = useState(
    preselectBranchId ?? firstFree?.id ?? ""
  );

  useEffect(() => {
    if (state.ok) router.push(`/stock-counts/${state.countId}`);
  }, [state, router]);

  const blockedBy = openByBranch[branchId];
  const formError = state.ok === false ? state.formError : undefined;
  const fieldErrors = state.ok === false ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="max-w-lg space-y-5">
      {formError && (
        <div className="rounded-lg border border-bad-border bg-bad-bg p-3 text-sm text-bad">
          {formError}
        </div>
      )}

      <div>
        <label htmlFor="branch_id" className={labelClass}>
          สาขา <span className="text-bad">*</span>
        </label>
        <select
          id="branch_id"
          name="branch_id"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className={`${inputClass} mt-1`}
          required
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {openByBranch[b.id] ? " — กำลังนับอยู่" : ""}
            </option>
          ))}
        </select>
        {fieldErrors?.branchId && (
          <p className="mt-1 text-xs text-bad">{fieldErrors.branchId}</p>
        )}
        {blockedBy && (
          <p className="mt-1 text-xs text-warn">
            สาขานี้มีใบนับที่ยังไม่ปิด —{" "}
            <a href={`/stock-counts/${blockedBy}`} className="underline">
              เข้าไปนับต่อในใบเดิม
            </a>{" "}
            (หนึ่งสาขานับได้ทีละใบ เพื่อไม่ให้ตัดสต๊อกซ้ำ)
          </p>
        )}
      </div>

      <div>
        <label htmlFor="count_date" className={labelClass}>
          วันที่นับ <span className="text-bad">*</span>
        </label>
        <input
          type="date"
          id="count_date"
          name="count_date"
          defaultValue={todayBangkok}
          className={`${inputClass} mt-1`}
          required
        />
        <p className="mt-1 text-xs text-muted-foreground">
          ใช้เป็นชื่อเรียกใบนับเท่านั้น — ส่วนต่างจะบันทึกตามเวลาที่นับจริงของแต่ละรายการ
        </p>
        {fieldErrors?.countDate && (
          <p className="mt-1 text-xs text-bad">{fieldErrors.countDate}</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="show_expected"
            defaultChecked
            className="mt-0.5"
          />
          <span>
            แสดงยอดที่ระบบคาดไว้ให้คนนับเห็น
            <span className="mt-0.5 block text-xs text-muted-foreground">
              ปิดไว้ถ้าให้พนักงานนับ — จะได้ไม่เผลอเขียนตามเลขที่เห็น
              (ระบบยังเก็บยอดคาดไว้เหมือนเดิมไม่ว่าจะแสดงหรือไม่)
            </span>
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          หมายเหตุ
        </label>
        <textarea id="notes" name="notes" rows={2} className={`${inputClass} mt-1`} />
      </div>

      <button
        type="submit"
        disabled={isPending || Boolean(blockedBy)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? "กำลังเปิด…" : "เปิดใบนับ"}
      </button>
    </form>
  );
}
