// ============================================================
// Mise — the head of every document page (Kong 2026-10-27, mockup 58mU74dLaAMwH6nF3AC6zw)
// ============================================================
// Purchase order, goods receipt and transfer each drew their own top: a
// "← กลับ" link, a row of buttons with ยกเลิก beside พิมพ์, and the number and
// status buried in the printable paper. One shape now: where it sits, the
// number, its status, one line of who/when — and the ONE next step on the
// right. Cancelling lives at the bottom of each page, away from it.
//
// Plain module (no "use client"): pages render it on the server; `actions`
// may hold client buttons. Hidden when printing — the paper has its own title.
// ============================================================

import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

export function DocHeader({
  trail,
  number,
  badges,
  meta,
  actions,
}: {
  trail: { href: string; label: string };
  number: string;
  badges?: ReactNode;
  meta: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
      <div className="min-w-0 space-y-1">
        <nav aria-label="ตำแหน่งของหน้านี้" className="text-sm text-muted-foreground">
          <Link href={trail.href as Route} className="hover:text-foreground">
            {trail.label}
          </Link>
          <span aria-hidden className="mx-1.5">›</span>
          <span className="text-foreground">{number}</span>
        </nav>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-2xl font-bold tabular-nums">{number}</h2>
          {badges}
        </div>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A document this one came from or made, as a chip; no `href` = it does not exist (yet). */
export type RelatedDoc = { label: string; href?: string; note?: string };

export function RelatedDocs({ items }: { items: RelatedDoc[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="เอกสารที่เกี่ยวข้อง" className="flex flex-wrap items-center gap-2 text-sm print:hidden">
      <span className="font-semibold text-muted-foreground">เอกสารที่เกี่ยวข้อง</span>
      {items.map((d, i) =>
        d.href ? (
          <Link
            key={i}
            href={d.href as Route}
            className="rounded-full border border-primary-line bg-surface px-3 py-1 text-primary hover:bg-primary-soft"
          >
            {d.label}
            {d.note && <span className="text-muted-foreground"> · {d.note}</span>}
          </Link>
        ) : (
          <span key={i} className="rounded-full border border-dashed border-border-strong px-3 py-1 text-muted-foreground">
            {d.label}
            {d.note && <> · {d.note}</>}
          </span>
        )
      )}
    </section>
  );
}

/** A status-like chip for the header (overdue, needs checking …). */
export function HeaderChip({ tone, children }: { tone: "warn" | "good" | "muted"; children: ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warn-border bg-warn-bg text-warn"
      : tone === "good"
        ? "border-good-border bg-good-bg text-good"
        : "border-border-strong bg-muted text-muted-foreground";
  return <span className={`whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}
