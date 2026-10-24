"use client";

// B1 (Kong 2026-10-24): the period's P&L as five cards OR as the waterfall
// chart — one switch, not both on the page (they showed the same four numbers
// twice). The choice is remembered per browser; storage may be unavailable, so
// every read and write is guarded and the cards are the default.

import { useEffect, useState, type ReactNode } from "react";

const KEY = "kitkrua:dashboard-kpi-view";

export default function KpiViewToggle({ cards, chart }: { cards: ReactNode; chart: ReactNode | null }) {
  const [view, setView] = useState<"cards" | "chart">("cards");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "chart" && chart) setView("chart");
    } catch {
      /* no storage: stay on cards */
    }
  }, [chart]);
  const pick = (v: "cards" | "chart") => {
    setView(v);
    try {
      window.localStorage.setItem(KEY, v);
    } catch {
      /* a lost preference only */
    }
  };
  return (
    <div className="space-y-2">
      {chart && (
        <div className="flex justify-end">
          <span role="group" aria-label="มุมมองกำไร" className="inline-flex rounded-full border border-border bg-muted p-0.5">
            {(
              [
                ["cards", "การ์ด"],
                ["chart", "กราฟ"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => pick(v)}
                className={`rounded-full px-3 py-0.5 text-xs transition-colors ${view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {l}
              </button>
            ))}
          </span>
        </div>
      )}
      <div className={view === "cards" || !chart ? "" : "hidden"}>{cards}</div>
      {chart && <div className={view === "chart" ? "animate-fade-in" : "hidden"}>{chart}</div>}
    </div>
  );
}
