import type { LucideIcon } from "lucide-react";

// ============================================================
// คิดครัว — a line icon in a small rounded tile (queue item 9, 2026-10-31)
// ============================================================
// The landing page's icon language, for the label of a figure card: the same
// icon its page carries in the sidebar, so "ยอดขาย" looks the same in both
// places. Plain module — server pages render it.
// ============================================================

export default function IconTile({ icon: Icon, className = "" }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-surface-sunk ring-1 ring-border ${className}`}>
      <Icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
    </span>
  );
}
