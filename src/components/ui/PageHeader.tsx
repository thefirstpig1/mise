import type { ReactNode } from "react";

// ============================================================
// คิดครัว — the head of every page (kit, Kong 2026-10-28)
// ============================================================
// One shape: the page's name, one line of what it is for, and the ONE main
// action on the right. The section name above it comes from PageFrame, so a
// page never says its section twice. Plain module — pages render it on the
// server; `actions` may hold client buttons.
// ============================================================

export default function PageHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-[66ch] text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
