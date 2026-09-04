"use client";

// Sprint 3 Part 18 L5a — the correction control (ADR 0018 Q6).
//
// An inline <details> with a reason box, not a `confirm()` — Part 17's reasoning
// applies unchanged: a void needs a reason anyway, so a modal asking only "are
// you sure?" is a second interruption for nothing, and a browser modal mid
// Server Action can wedge the page.
//
// What is NEW here, and is the whole reason this component has so much copy:
// **a void and a transfer back are different events, and the ledger cannot tell
// them apart afterwards.** Someone whose crates genuinely came back will reach
// for this button, because it is the one on the screen. So the box says what
// this does, says what the other thing is, and links to it.

import { useActionState } from "react";
import type { TransferActionState } from "@/app/transfers/actions";

export default function VoidTransferButton({
  action,
  transferId,
  tfNumber,
  fromBranchName,
  toBranchName,
  reverseHref,
}: {
  action: (
    prev: TransferActionState,
    fd: FormData
  ) => Promise<TransferActionState>;
  transferId: string;
  tfNumber: string;
  fromBranchName: string;
  toBranchName: string;
  /** A pre-aimed link to the opposite-direction dispatch form. */
  reverseHref: string;
}) {
  const [state, formAction, isPending] = useActionState(action, {
    ok: false,
  } as TransferActionState);

  const formError = state.ok === false ? state.formError : undefined;
  const fieldError = state.ok === false ? state.fieldErrors?.voidReason : undefined;

  return (
    <details className="mt-4 rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
        ยกเลิกใบโอนนี้
      </summary>

      <div className="mt-3 rounded-lg border border-warn-border bg-warn-bg p-3 text-xs text-warn">
        <p className="font-medium">ยกเลิก ≠ โอนกลับ</p>
        <p className="mt-1">
          <strong>ยกเลิก</strong> = ใบนี้ไม่ควรมีอยู่ตั้งแต่แรก (คีย์ผิดสินค้า ผิดสาขา ผิดจำนวน) —
          ของถือว่าไม่เคยเดินทาง กลับไปเป็นของ {fromBranchName}
        </p>
        <p className="mt-1">
          <strong>โอนกลับ</strong> = ของเดินทางกลับจริง —{" "}
          <a href={reverseHref} className="underline">
            ให้สร้างใบโอนใหม่จาก {toBranchName} ไป {fromBranchName}
          </a>{" "}
          แทน ถ้าใช้ปุ่มยกเลิกกับกรณีนี้ ประวัติจะอ่านว่าของไม่เคยออกจากร้านเลย
        </p>
      </div>

      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="id" value={transferId} />
        <p className="text-xs text-muted-foreground">
          ใบ {tfNumber} จะยังอยู่ให้เห็น พร้อมรายการกลับรายการต่อท้ายและเหตุผลที่ยกเลิก
        </p>
        <input
          name="void_reason"
          type="text"
          maxLength={500}
          required
          placeholder="เหตุผล เช่น คีย์ผิดสาขา"
          className="input w-full"
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
