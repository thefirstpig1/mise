"use client";

// ============================================================
// คิดครัว — the gold label above every page's heading (queue item 9)
// ============================================================
// Kong 2026-10-31 approved the landing page's eyebrow for the app: the label
// names the SIDEBAR GROUP the page sits in, read from the same list the
// sidebar draws, so the two can never disagree and a page never names itself
// twice (the frame's old titles were sometimes the group, sometimes the page —
// "สินค้า/วัตถุดิบ" above "สินค้า/วัตถุดิบ"). A one-item group names its item
// ("แดชบอร์ด"), since its group label is the page's own heading. A page the
// sidebar does not list keeps the label its frame passes.
// ============================================================

import { usePathname } from "next/navigation";
import { NAV_GROUPS, currentNavHref } from "@/components/layout/nav";

export function sectionLabelFor(pathname: string): string | null {
  const href = currentNavHref(pathname);
  if (!href) return null;
  const group = NAV_GROUPS.find((g) => g.items.some((i) => i.href === href));
  if (!group) return null;
  return group.items.length === 1 ? group.items[0].label : group.label;
}

export default function SectionEyebrow({ fallback, className = "" }: { fallback?: string; className?: string }) {
  const label = sectionLabelFor(usePathname()) ?? fallback;
  return label ? <p className={`eyebrow ${className}`}>{label}</p> : null;
}
