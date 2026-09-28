"use client";

// ============================================================
// Mise — the /sales filters, full at the top and one line once scrolled
// ============================================================
// Kong (2026-09-28): the sticky filter card was ~110px tall and sat over the
// charts and tables the whole way down. At the top of the page the full card is
// what you want; further down, all you need is to know WHAT you are looking at
// and a way to change it. So the card no longer sticks — a one-line bar takes
// its place once it scrolls out of view, and opens the full filters on demand.
//
// The bar lives in a zero-height sticky wrapper, so appearing and disappearing
// never changes the page's height (which would nudge the scroll and could make
// the observer flicker at the boundary).
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from "react";

export default function StickyFilters({ summary, children }: { summary: string; children: ReactNode }) {
  const fullRef = useRef<HTMLElement>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = fullRef.current;
    if (!el) return;
    // A plain scroll listener rather than an IntersectionObserver: it is one
    // rect read per scroll, and it also answers in a background tab.
    const check = () => setScrolledPast(el.getBoundingClientRect().bottom < 0);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  // Back at the top, the full card is on screen — the dropdown is redundant.
  useEffect(() => {
    if (!scrolledPast) setOpen(false);
  }, [scrolledPast]);

  return (
    <>
      <section ref={fullRef} className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        {children}
      </section>

      <div className="sticky top-0 z-20 h-0 lg:top-2">
        {scrolledPast && (
          <div className="rounded-xl border border-border bg-surface/95 shadow-md backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <p className="min-w-0 truncate text-sm">
                <span className="text-muted-foreground">กำลังดู </span>
                <span className="font-medium">{summary}</span>
              </p>
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="shrink-0 whitespace-nowrap rounded-full border border-primary-line px-3 py-1 text-xs font-medium text-primary hover:bg-primary hover:text-primary-foreground"
              >
                {open ? "ปิดตัวกรอง" : "เปลี่ยนตัวกรอง"}
              </button>
            </div>
            {open && <div className="space-y-3 border-t border-border p-4">{children}</div>}
          </div>
        )}
      </div>
    </>
  );
}
