"use client";

// ============================================================
// Mise — ยอดขาย / จำนวนจาน / กำไร, without reloading the page
// ============================================================
// Kong (2026-09-28): switching the measure should not feel like opening a new
// page. The measure still lives in the URL (?by=) so a view is linkable, but
// the switch navigates inside a transition: the current screen stays up and
// the scroll stays where it is while the server works out the new figures,
// and the pill shows it is working. No full reload, no loading skeleton.
//
// The same switch sits in every popup's header (PopupMetricSwitch) — Kong: in
// a popup it is easy to forget which measure you are reading, and ยอดขาย read
// as กำไร is the worst confusion on the page. A popup stays open across the
// switch because its state lives in a client component the navigation keeps.
// ============================================================

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Metric } from "@/lib/sales-insight";
import { useMenuInsight, type MetricOption } from "./insight-context";

export default function MetricSwitch({
  current,
  options,
  size = "md",
}: {
  current: Metric;
  options: MetricOption[];
  size?: "md" | "sm";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const sm = size === "sm";
  return (
    <div className="flex items-center gap-2">
      <div
        role="radiogroup"
        aria-label="ดูจาก"
        className={`inline-flex rounded-full border border-border-strong bg-surface shadow-sm transition-opacity ${sm ? "p-0.5" : "p-1"} ${pending ? "opacity-70" : ""}`}
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
            className={`rounded-full font-medium transition-colors ${sm ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm"} ${
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
          {sm ? "" : "กำลังคำนวณ…"}
        </span>
      )}
    </div>
  );
}

/** The page's switch, small, for a popup header. Renders nothing outside /sales. */
export function PopupMetricSwitch() {
  const ctx = useMenuInsight();
  if (!ctx || ctx.metric.options.length < 2) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      ดูจาก
      <MetricSwitch current={ctx.metric.current} options={ctx.metric.options} size="sm" />
    </div>
  );
}
