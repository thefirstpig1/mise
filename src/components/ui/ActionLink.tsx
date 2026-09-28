import type { ReactNode } from "react";

// ============================================================
// Mise — a link that LOOKS like it can be pressed (Kong, 2026-09-28)
// ============================================================
// "ดูยอดขายทั้งเดือน →" as small coloured text only revealed itself on hover —
// and a phone has no hover, and many people never move the mouse over text
// to find out. So a door is drawn as a door: a bordered pill with an arrow,
// visible at rest, filled on hover and focus.
//
// Two shapes:
//   pill  — a stand-alone "go there" (ดูทั้งหมด, นำเข้าไฟล์)
//   row   — the trailing chevron on a whole row that is itself the link
// ============================================================

function Arrow({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ActionLink({
  href,
  children,
  tone = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  tone?: "primary" | "warn";
  className?: string;
}) {
  const colours =
    tone === "warn"
      ? "border-warn-border bg-surface text-warn hover:bg-warn hover:text-warn-foreground focus-visible:bg-warn focus-visible:text-warn-foreground"
      : "border-primary-line bg-surface text-primary hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground";
  return (
    <a
      href={href}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors focus:outline-none ${colours} ${className}`}
    >
      {children}
      <Arrow />
    </a>
  );
}

/** The chevron at the end of a row that is itself a link — always visible. */
export function RowChevron({ label }: { label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-primary-line bg-surface px-2.5 py-1 text-xs font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
      {label}
      <Arrow />
    </span>
  );
}
