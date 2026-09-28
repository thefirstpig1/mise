"use client";

// ============================================================
// Mise — ยอดขาย / จำนวนจาน / กำไร, without reloading the page
// ============================================================
// Kong (2026-09-28): switching the measure should not feel like opening a new
// page. The measure still lives in the URL (?by=) so a view is linkable, but
// the switch navigates inside a transition: the current screen stays up and
// the scroll stays where it is while the server works out the new figures,
// and the pill shows it is working. No full reload, no loading skeleton.
// ============================================================

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Metric } from "@/lib/sales-insight";

export default function MetricSwitch({
  current,
  options,
}: {
  current: Metric;
  options: { key: Metric; label: string; href: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="ดูจาก"
        className={`inline-flex rounded-full border border-border-strong bg-surface p-1 shadow-sm transition-opacity ${pending ? "opacity-70" : ""}`}
      >
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={current === o.key}
            onClick={() => {
              if (o.key === current) return;
              start(() => router.push(o.href as Route, { scroll: false }));
            }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              current === o.key ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {pending && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          กำลังคำนวณ…
        </span>
      )}
    </div>
  );
}
