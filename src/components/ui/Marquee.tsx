"use client";

// Text that does not fit is cut with "…", and on hover it slides to show the
// rest (Kong 2026-10-22: "ไม่ต้องทำช่องเผื่อยาว เราใช้วิธี hover แล้วตัวหนังสือ
// ค่อยๆเลื่อน"). Text that fits never moves. The full text is also the
// title, for touch screens and for anyone who has reduced motion switched on
// (the slide is skipped there — see globals.css).

import { useRef, useState, type ReactNode } from "react";

export function useMarquee() {
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  const start = () => {
    const el = ref.current;
    if (!el) return;
    const over = el.scrollWidth - el.clientWidth;
    if (over <= 1) return;
    el.style.setProperty("--mq-x", `-${over + 4}px`);
    // About 40 px a second, never faster than one second.
    el.style.setProperty("--mq-t", `${Math.max(1, (over + 4) / 40) + 1.6}s`);
    setOn(true);
  };
  const stop = () => setOn(false);
  return { ref, on, start, stop };
}

export default function Marquee({
  children,
  title,
  className = "",
  /** Controlled by a parent's hover (e.g. a whole chip), instead of this span's own. */
  active,
  marquee,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
  active?: boolean;
  marquee?: ReturnType<typeof useMarquee>;
}) {
  const own = useMarquee();
  const m = marquee ?? own;
  const running = active ?? m.on;
  return (
    <span
      ref={m.ref}
      title={title ?? (typeof children === "string" ? children : undefined)}
      onMouseEnter={marquee ? undefined : m.start}
      onMouseLeave={marquee ? undefined : m.stop}
      className={`marquee ${running ? "is-running" : ""} ${className}`}
    >
      <span>{children}</span>
    </span>
  );
}
