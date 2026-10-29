"use client";

// Sprint 3 Part 16 L5b — mark a bill paid, or take it back.
// Expense review 2026-10-27: one "จ่ายบิลนี้" box with everything paying asks
// for — the date (today unless changed), how, and the 50 ทวิ number when tax
// was withheld, since that is the moment it is issued.
//
// A separate one-field action rather than the whole form: "I paid this" is the
// most common thing anyone does to a bill after recording it, and making that
// require re-submitting every line is how stale amounts get saved by accident.

import { useActionState, useState } from "react";
import { orStale } from "@/lib/stale-tab";
import type { ExpenseActionState } from "../actions";
import { MethodChips } from "./TaxChips";
import { useKeepForm } from "@/lib/keep-form";

export default function PaymentToggle({
  action,
  expenseId,
  paymentStatus,
  paymentMethod,
  paidAtLabel,
  todayBangkok,
  netLabel,
  withheld,
  whtCertificateNo,
}: {
  action: (
    prev: ExpenseActionState,
    fd: FormData
  ) => Promise<ExpenseActionState>;
  expenseId: string;
  paymentStatus: "UNPAID" | "PAID";
  paymentMethod: string | null;
  /** "27 ต.ค. 2569" when paid. */
  paidAtLabel: string | null;
  todayBangkok: string;
  /** What leaves the bank, e.g. "฿3,395.00". */
  netLabel: string;
  withheld: boolean;
  whtCertificateNo: string | null;
}) {
  const [state, formAction, isPending] = useActionState(
    (prev: ExpenseActionState, fd: FormData) => orStale(action(prev, fd)),
    { ok: false } as ExpenseActionState
  );
  const formActionKeep = useKeepForm(formAction, state);
  const [method, setMethod] = useState(paymentMethod ?? "");
  const formError = state.ok === false ? state.formError : undefined;

  if (paymentStatus === "PAID") {
    return (
      <form
        {...formActionKeep}
        className="space-y-2 rounded-xl border border-good-border bg-good-bg p-4"
      >
        <input type="hidden" name="id" value={expenseId} />
        <input type="hidden" name="payment_status" value="UNPAID" />
        <input type="hidden" name="payment_method" value={paymentMethod ?? ""} />
        <input type="hidden" name="paid_at" value="" />
        <h3 className="text-base font-semibold text-good">
          จ่ายแล้ว {paidAtLabel}
          {paymentMethod && ` · ${paymentMethod}`}
        </h3>
        {whtCertificateNo && (
          <p className="text-sm text-muted-foreground">หนังสือรับรอง 50 ทวิ เลขที่ {whtCertificateNo}</p>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="text-sm text-primary underline disabled:opacity-60"
        >
          {isPending ? "กำลังบันทึก…" : "เปลี่ยนกลับเป็นยังไม่จ่าย"}
        </button>
        {formError && <p className="text-xs text-bad">{formError}</p>}
      </form>
    );
  }

  return (
    <form
      {...formActionKeep}
      className="space-y-4 rounded-xl border border-border-strong bg-surface p-4"
    >
      <input type="hidden" name="id" value={expenseId} />
      <input type="hidden" name="payment_status" value="PAID" />
      <h3 className="text-base font-semibold">จ่ายบิลนี้</h3>
      <div>
        <label htmlFor="paid_at" className="label text-xs">
          วันที่จ่าย
        </label>
        <input
          id="paid_at"
          name="paid_at"
          type="date"
          defaultValue={todayBangkok}
          className="input mt-1 w-full"
        />
      </div>
      <div>
        <span className="label text-xs">จ่ายด้วย</span>
        <MethodChips value={method} onChange={setMethod} />
      </div>
      {withheld && (
        <div>
          <label htmlFor="wht_certificate_no" className="label text-xs">
            เลขที่หนังสือรับรอง 50 ทวิ
          </label>
          <input
            id="wht_certificate_no"
            name="wht_certificate_no"
            placeholder="ถ้าออกให้แล้ว"
            defaultValue={whtCertificateNo ?? ""}
            className="input mt-1 w-full"
          />
        </div>
      )}
      <button type="submit" disabled={isPending} className="btn w-full">
        {isPending ? "กำลังบันทึก…" : `บันทึกว่าจ่ายแล้ว ${netLabel}`}
      </button>
      {formError && <p className="text-xs text-bad">{formError}</p>}
    </form>
  );
}
