// A report's status as a pill (ADR 0044, mockup 2wtVT94pZjv1EX9xy8YVCp).
// A plain module — no "use client" — so the reporter's page (a Server
// Component) and the platform inbox (a Client Component) draw the same pill.
// The shop and the operator read different words for one status; the colour
// is the same for both.

import { STATUS_FOR_OPERATOR, STATUS_FOR_SHOP, type ReportStatus } from "@/lib/problem-report";

const TONE: Record<ReportStatus, string> = {
  NEW: "border-warn-border bg-warn-bg text-gold-ink",
  LOOKING: "border-primary-line bg-[#EEF0DC] text-[#5F6638]",
  FIXED_PENDING: "border-primary-line bg-primary-soft text-primary",
  FIXED_LIVE: "border-good-border bg-good-bg text-good",
  CONSIDERING: "border-border-strong bg-surface-sunk text-muted-foreground",
  CLOSED: "border-border-strong bg-surface-sunk text-muted-foreground",
};

export default function ReportStatusChip({ status, words = "shop" }: { status: ReportStatus; words?: "shop" | "operator" }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px text-xs font-medium ${TONE[status]}`}>
      {(words === "shop" ? STATUS_FOR_SHOP : STATUS_FOR_OPERATOR)[status]}
    </span>
  );
}
