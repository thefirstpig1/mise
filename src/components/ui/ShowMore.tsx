"use client";

import { useState, type ReactNode } from "react";

// ============================================================
// คิดครัว — the first few, then "ดูอีก N" (queue item 9, finance group)
// ============================================================
// A long list that sits UNDER the thing a page is about (46 bills under a
// chart, 13 due months above the bills) shows its head and folds the rest
// behind one press, so nobody scrolls past rows to reach the next section.
// The server renders both parts; this only decides whether the tail shows.
// `head` and `tail` are rendered as siblings inside one box, so a
// `divide-y` frame draws the same line between row 10 and row 11.
// ============================================================

export default function ShowMore({
  head,
  tail,
  more,
  less = "ย่อกลับ",
  className = "",
}: {
  head: ReactNode;
  tail: ReactNode;
  /** What the closed button says, e.g. "ดูอีก 36 บิล". Empty = no tail, no button. */
  more: string;
  less?: string;
  /** The frame around head + tail. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={className}>
        {head}
        {open && tail}
      </div>
      {more && (
        <div className="mt-2 text-center">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="rounded-full px-3 py-1 font-display text-[13px] font-semibold text-primary underline decoration-dotted underline-offset-4 transition-colors hover:bg-muted hover:decoration-solid"
          >
            {open ? less : more}
          </button>
        </div>
      )}
    </>
  );
}
