// Sprint 2 Part 11 L5a — the status pill, shared by the list and the detail view.
//
// Server-safe (no "use client"): it is pure presentation with no state, so it
// renders inside a Server Component without shipping any JS.
//
// The colours carry meaning the words already carry, for people who scan a list
// rather than read it: grey = not out yet, blue = out and waiting, amber =
// partly here, green = done, red = called off.

import { PURCHASE_ORDER_STATUS_LABELS_TH } from "@/lib/validations/purchase-order";

const STYLES: Record<string, string> = {
  DRAFT: "border-border bg-muted/60 text-muted-foreground",
  SENT: "border-blue-300 bg-blue-50 text-blue-700",
  PARTIALLY_RECEIVED: "border-amber-300 bg-amber-50 text-amber-800",
  RECEIVED: "border-green-300 bg-green-50 text-green-800",
  CANCELLED: "border-red-300 bg-red-50 text-red-700",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
        STYLES[status] ?? "border-border bg-muted/60 text-muted-foreground"
      }`}
    >
      {/* Fall back to the raw value so a status added in Sprint 3+ renders
          readably instead of blank (the Part 10 L5c rule). */}
      {PURCHASE_ORDER_STATUS_LABELS_TH[
        status as keyof typeof PURCHASE_ORDER_STATUS_LABELS_TH
      ] ?? status}
    </span>
  );
}
