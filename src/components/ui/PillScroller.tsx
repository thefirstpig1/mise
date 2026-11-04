"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// ============================================================
// คิดครัว — one line of pills that scrolls sideways on a phone (queue item 9)
// ============================================================
// Six months as pills broke into two rows at 400px. One scrolling line is
// shorter, but it hides things in two ways this fixes: the chosen pill can
// sit past the right edge (the newest month is the default and the LAST
// pill), so the line opens scrolled to it; and nothing says there is more,
// so the edge that has more fades out. From `sm` up the pills wrap as before.
// `follow` (queue item 9, /settings): when the chosen pill changes without a
// page load — a section scrolled into view — the line slides to keep it shown.
// ============================================================

/** Scroll `el` so its aria-current child is inside the visible part. */
function reveal(el: HTMLDivElement, smooth: boolean) {
  const on = el.querySelector<HTMLElement>('[aria-current="true"]');
  if (!on) return;
  const left = on.offsetLeft < el.scrollLeft ? on.offsetLeft - 24 : on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth ? on.offsetLeft + on.offsetWidth - el.clientWidth + 24 : null;
  if (left !== null) el.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
}

export default function PillScroller({ children, className = "", follow }: { children: ReactNode; className?: string; follow?: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    reveal(el, false);
    const measure = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (follow !== undefined && ref.current) reveal(ref.current, true);
  }, [follow]);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent, #000 28px" : "#000"}, ${edges.right ? "#000 calc(100% - 28px), transparent" : "#000"})`
      : undefined;
  return (
    <div
      ref={ref}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      className={`relative flex gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden ${className}`}
    >
      {children}
    </div>
  );
}
