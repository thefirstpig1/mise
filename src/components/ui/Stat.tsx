import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";

// ============================================================
// คิดครัว — a number card (kit, Kong 2026-10-28)
// ============================================================
// A small label, the figure in Prompt, and a line saying where it comes from
// or what it is compared with — never a bare number. No data is "—" with a
// reason in `sub`, never ฿0 (mise-ui-review §3). Give it `href` and the whole
// card opens the detail; `onClick` filters the page in place.
// ============================================================

export default function Stat({
  label,
  value,
  sub,
  tone,
  href,
  onClick,
  pressed,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Colour of the figure — only when the number itself is good or bad for the shop. */
  tone?: "good" | "bad" | "warn";
  href?: string;
  onClick?: () => void;
  /** With `onClick`: the filter this card applies is on. */
  pressed?: boolean;
}) {
  const body = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`font-display text-[22px] font-semibold leading-tight tabular-nums ${
          tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""
        }`}
      >
        {value}
      </span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-0.5 rounded-[18px] border border-border/70 bg-surface shadow-card px-3.5 py-3 text-left";
  if (onClick)
    return (
      <button type="button" onClick={onClick} aria-pressed={pressed} className={`${cls} transition-colors hover:bg-surface-sunk ${pressed ? "border-primary ring-1 ring-primary" : ""}`}>
        {body}
      </button>
    );
  return href ? (
    <Link href={href as Route} scroll={false} className={`${cls} transition-colors hover:bg-surface-sunk`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Two on a phone, four on a desktop. */
export function StatGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-2.5 lg:grid-cols-4 ${className}`}>{children}</div>;
}
