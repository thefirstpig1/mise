"use client";

// The "open this dish's insight" handle, shared by every part of /sales that
// names a dish. Its own file so the popups (Breakdown) and the insight modal
// (MenuInsight) do not import each other.

import { createContext, useContext, type ReactNode } from "react";
import type { Metric } from "@/lib/sales-insight";

export type MetricOption = { key: Metric; label: string };
export type MenuInsightCtx = {
  open: (menuId: string) => void;
  /** The page's measure and how to change it — so every popup can switch too. */
  metric: { current: Metric; options: MetricOption[]; select: (m: Metric) => void; pending: Metric | null };
};
export const InsightContext = createContext<MenuInsightCtx | null>(null);
export const useMenuInsight = () => useContext(InsightContext);

/** A dish name that opens its insight — use it wherever a dish is named. */
export function MenuLink({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const ctx = useMenuInsight();
  if (!ctx) return <span className={className}>{children}</span>;
  return (
    // Looks pressable at rest, not only on hover (Kong, 2026-09-28): a dotted
    // underline, which turns solid and brand-coloured under the pointer.
    <button
      type="button"
      onClick={() => ctx.open(id)}
      title="ดู insight ของเมนูนี้"
      className={`text-left underline decoration-border-strong decoration-dotted decoration-1 underline-offset-4 transition-colors hover:text-primary hover:decoration-primary hover:decoration-solid ${className}`}
    >
      {children}
    </button>
  );
}
