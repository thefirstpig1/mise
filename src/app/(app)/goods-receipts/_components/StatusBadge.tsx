// Sprint 2 Part 13 L5a — the status pill, shared by the list and the detail view.
//
// Server-safe (no "use client"): pure presentation with no state, so it renders
// inside a Server Component without shipping any JS.
//
// Grey = still counting, green = in the ledger, red = reversed. Only three,
// because a receipt only ever has three things to say about itself.

import { GOODS_RECEIPT_STATUS_LABELS_TH } from "@/lib/validations/goods-receipt";

// The kit's chips (queue item 9, 2026-10-31) — the same pill and dot as every
// other status in the app, as purchase orders already did.
const STYLES: Record<string, string> = {
  DRAFT: "",
  CONFIRMED: "chip-good",
  VOIDED: "chip-bad",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`chip ${STYLES[status] ?? ""}`}>
      {/* Fall back to the raw value so a status added later renders readably
          instead of blank (the Part 10 L5c rule). */}
      {GOODS_RECEIPT_STATUS_LABELS_TH[
        status as keyof typeof GOODS_RECEIPT_STATUS_LABELS_TH
      ] ?? status}
    </span>
  );
}
