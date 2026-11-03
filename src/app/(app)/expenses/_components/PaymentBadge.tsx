// Sprint 3 Part 16 L5a — paid / unpaid, at a glance.
//
// Two states and no third: `PARTIAL` describes an amount, and there is no
// payments module to hold one (ADR 0016 Q6).

import { EXPENSE_PAYMENT_STATUS_LABELS_TH } from "@/lib/validations/expense";

// Queue item 9: the kit's status pill (a filled chip with a dot), not a drawn edge.
const STYLES: Record<"UNPAID" | "PAID", string> = {
  UNPAID: "chip-warn",
  PAID: "chip-good",
};

export default function PaymentBadge({
  status,
}: {
  status: "UNPAID" | "PAID";
}) {
  return (
    <span className={`chip ${STYLES[status]}`}>
      {EXPENSE_PAYMENT_STATUS_LABELS_TH[status]}
    </span>
  );
}
