// Sprint 3 Part 16 L5a — paid / unpaid, at a glance.
//
// Two states and no third: `PARTIAL` describes an amount, and there is no
// payments module to hold one (ADR 0016 Q6).

import { EXPENSE_PAYMENT_STATUS_LABELS_TH } from "@/lib/validations/expense";

const STYLES: Record<"UNPAID" | "PAID", string> = {
  UNPAID: "bg-amber-100 text-amber-900 border-amber-300",
  PAID: "bg-emerald-100 text-emerald-900 border-emerald-300",
};

export default function PaymentBadge({
  status,
}: {
  status: "UNPAID" | "PAID";
}) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {EXPENSE_PAYMENT_STATUS_LABELS_TH[status]}
    </span>
  );
}
