// Sprint 3 Part 16 L5a — paid / unpaid, at a glance.
//
// Two states and no third: `PARTIAL` describes an amount, and there is no
// payments module to hold one (ADR 0016 Q6).

import { EXPENSE_PAYMENT_STATUS_LABELS_TH } from "@/lib/validations/expense";

const STYLES: Record<"UNPAID" | "PAID", string> = {
  UNPAID: "bg-warn-bg text-warn border-warn-border",
  PAID: "bg-good-bg text-good border-good-border",
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
