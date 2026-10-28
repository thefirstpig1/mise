// Sprint 2 Part 11 L5a — the status pill, shared by the list and the detail view.
//
// Server-safe (no "use client"): it is pure presentation with no state, so it
// renders inside a Server Component without shipping any JS.
//
// The colours carry meaning the words already carry, for people who scan a list
// rather than read it: grey = not out yet, blue = out and waiting, amber =
// partly here, green = done, red = called off.

import { PURCHASE_ORDER_STATUS_LABELS_TH } from "@/lib/validations/purchase-order";

// The kit's chips (2026-10-28): waiting on someone = warn, done = good,
// called off = bad, not out yet = plain.
const STYLES: Record<string, string> = {
  DRAFT: "",
  SENT: "chip-warn",
  PARTIALLY_RECEIVED: "chip-warn",
  RECEIVED: "chip-good",
  CANCELLED: "chip-bad",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`chip ${STYLES[status] ?? ""}`}>
      {/* Fall back to the raw value so a status added in Sprint 3+ renders
          readably instead of blank (the Part 10 L5c rule). */}
      {PURCHASE_ORDER_STATUS_LABELS_TH[
        status as keyof typeof PURCHASE_ORDER_STATUS_LABELS_TH
      ] ?? status}
    </span>
  );
}
