// Sprint 2 Part 13 L5a — the status pill, shared by the list and the detail view.
//
// Server-safe (no "use client"): pure presentation with no state, so it renders
// inside a Server Component without shipping any JS.
//
// Grey = still counting, green = in the ledger, red = reversed. Only three,
// because a receipt only ever has three things to say about itself.

import { GOODS_RECEIPT_STATUS_LABELS_TH } from "@/lib/validations/goods-receipt";

const STYLES: Record<string, string> = {
  DRAFT: "border-border bg-muted/60 text-muted-foreground",
  CONFIRMED: "border-green-300 bg-green-50 text-green-800",
  VOIDED: "border-red-300 bg-red-50 text-red-700",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
        STYLES[status] ?? "border-border bg-muted/60 text-muted-foreground"
      }`}
    >
      {/* Fall back to the raw value so a status added later renders readably
          instead of blank (the Part 10 L5c rule). */}
      {GOODS_RECEIPT_STATUS_LABELS_TH[
        status as keyof typeof GOODS_RECEIPT_STATUS_LABELS_TH
      ] ?? status}
    </span>
  );
}
