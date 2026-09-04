// Sprint 3 Part 15 L5a — the three states of a count sheet (ADR 0015 Q6).
//
// DRAFT is amber rather than neutral on purpose: an open sheet is not a resting
// state, it is a job someone has to finish, and it also blocks the branch from
// opening another one (Q8).

import type { StockCountStatus } from "@prisma/client";
import { STOCK_COUNT_STATUS_LABELS_TH } from "@/lib/validations/stock-count";

const CLASS: Record<StockCountStatus, string> = {
  DRAFT: "border-warn-border bg-warn-bg text-warn",
  CLOSED: "border-good-border bg-good-bg text-good",
  VOIDED: "border-border bg-muted text-muted-foreground line-through",
};

export default function StatusBadge({ status }: { status: StockCountStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs ${CLASS[status]}`}
    >
      {STOCK_COUNT_STATUS_LABELS_TH[status]}
    </span>
  );
}
