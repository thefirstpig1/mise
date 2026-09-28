"use client";

// ============================================================
// Mise — ยอดขาย / จำนวนจาน / กำไร, switched in the browser
// ============================================================
// Kong (2026-09-28): "ขนาดแค่สับสวิตช์มุมมองยังช้า". The page now arrives with
// the views already built (sales-views.ts), so switching is a state change —
// no server, no reload, no wait. Profit is fetched in the background once;
// only if someone presses กำไร before it lands does the pill show a spinner.
//
// The same switch sits in every popup's header (PopupMetricSwitch) — Kong: in
// a popup it is easy to forget which measure you are reading, and ยอดขาย read
// as กำไร is the worst confusion on the page.
// ============================================================

import type { Metric } from "@/lib/sales-insight";
import { useMenuInsight, type MetricOption } from "./insight-context";

export default function MetricSwitch({
  current,
  options,
  onSelect,
  pending = null,
  size = "md",
}: {
  current: Metric;
  options: MetricOption[];
  onSelect: (m: Metric) => void;
  /** The measure being fetched, if any — shows a spinner on that pill. */
  pending?: Metric | null;
  size?: "md" | "sm";
}) {
  const sm = size === "sm";
  return (
    <div
      role="radiogroup"
      aria-label="ดูจาก"
      className={`inline-flex rounded-full border border-border-strong bg-surface shadow-sm ${sm ? "p-0.5" : "p-1"}`}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={current === o.key}
          onClick={() => o.key !== current && onSelect(o.key)}
          className={`inline-flex items-center gap-1.5 rounded-full font-medium transition-colors ${sm ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm"} ${
            current === o.key ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {pending === o.key && (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-label="กำลังคำนวณ" />
          )}
          {o.label}
        </button>
      ))}
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
      <MetricSwitch
        current={ctx.metric.current}
        options={ctx.metric.options}
        onSelect={ctx.metric.select}
        pending={ctx.metric.pending}
        size="sm"
      />
    </div>
  );
}
