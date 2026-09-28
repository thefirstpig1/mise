"use client";

// The "open this dish's insight" handle, shared by every part of /sales that
// names a dish. Its own file so the popups (Breakdown) and the insight modal
// (MenuInsight) do not import each other.

import { createContext, useContext, type ReactNode } from "react";

export type MenuInsightCtx = { open: (menuId: string) => void };
export const InsightContext = createContext<MenuInsightCtx | null>(null);
export const useMenuInsight = () => useContext(InsightContext);

/** A dish name that opens its insight — use it wherever a dish is named. */
export function MenuLink({ id, children, className = "" }: { id: string; children: ReactNode; className?: string }) {
  const ctx = useMenuInsight();
  if (!ctx) return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={() => ctx.open(id)} className={`text-left hover:text-primary hover:underline ${className}`}>
      {children}
    </button>
  );
}
