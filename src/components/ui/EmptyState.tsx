// ============================================================
// คิดครัว — the empty state (doodle wave 2, 2026-09-27)
// ============================================================
// One box for every "there is nothing here" in the product, so 24 places
// that each wrote their own (dashed, or grey, or bare text) now say it the
// same way.
//
// The art is chosen by what the emptiness MEANS, which is the only thing a
// reader needs from it:
//
//   start  nothing has ever been made — the next move is to make the first
//   none   things exist, but not in this period or under this filter
//   setup  this page cannot work until something is set up somewhere else
//
// The words are the caller's, passed as children and never rewritten here —
// every sentence was already chosen for its screen. This component only
// decides the frame and the drawing.
// ============================================================

import type { ReactNode } from "react";

import { BlankNotebook, EmptyBasket, Signpost } from "@/components/layout/Doodles";

const ART = {
  start: BlankNotebook,
  none: EmptyBasket,
  setup: Signpost,
} as const;

export default function EmptyState({
  art,
  children,
  className,
}: {
  art: keyof typeof ART;
  children: ReactNode;
  className?: string;
}) {
  const Art = ART[art];
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-sunk/40 px-6 py-8 text-center text-sm text-muted-foreground ${className ?? ""}`}
    >
      <Art className="w-24" />
      <div className="max-w-md">{children}</div>
    </div>
  );
}
