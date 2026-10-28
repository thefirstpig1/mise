"use client";

// ============================================================
// Mise — a filter that does not throw the page back to the top (Kong 2026-10-28)
// ============================================================
// "ตอนเปลี่ยนตัวกรองทำไมมันต้องรีเฟรชหน้าแล้วเด้งกลับขึ้นไปด้านบนด้วย
// หงุดหงิดแทน user". Filters were plain <a href> (a full page load, which
// lands at the top) or <form method="get"> (the same). These two keep the
// reader where they are: the URL changes through the router with
// { scroll: false }, inside a transition so the old screen stays up, and the
// pressed control dims at once (mise-ui-review §5b: every press answers
// immediately, even when the figures cannot).
//
// FilterLink is still a real <a href>, so a middle-click or "open in new tab"
// behaves exactly as before; only a plain left click is taken over.
// ============================================================

import { useTransition, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";

export default function FilterLink({
  href,
  className = "",
  children,
  ...rest
}: {
  href: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    start(() => router.push(href as Route, { scroll: false }));
  };
  return (
    <a href={href} onClick={onClick} aria-busy={pending || undefined} className={`${className} ${pending ? "opacity-60" : ""}`} {...rest}>
      {children}
    </a>
  );
}

/**
 * A <form method="get"> that navigates in place. Empty fields are left out of
 * the URL, as the browser's own GET submit would send them blank.
 */
export function FilterForm({ className = "", children }: { className?: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget).entries()) {
      if (typeof v === "string" && v !== "") q.append(k, v);
    }
    const qs = q.toString();
    start(() => router.push(`${pathname}${qs ? `?${qs}` : ""}` as Route, { scroll: false }));
  };
  return (
    <form method="get" onSubmit={onSubmit} aria-busy={pending || undefined} className={`${className} ${pending ? "opacity-70" : ""}`}>
      {children}
    </form>
  );
}
