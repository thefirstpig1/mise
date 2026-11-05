"use client";

// ============================================================
// คิดครัว — tabs across pages that are one page to the reader
// ============================================================
// Kong 2026-11-05: "หลายๆอย่างมันดูมีความหมายกำกวมในเมนูที่ต่างกัน
// พิจารณารวมไว้หน้าเดียวกันเพื่อป้องกันการสับสน" — ค่าใช้จ่าย / วิเคราะห์รายจ่าย,
// the four cost pages, the two sides of สำรองจ่าย and ทดลองเมนู became one menu
// item each with tabs. The pages keep their own addresses, so every old link
// and bookmark still opens the same screen; only the way IN changed.
//
// Shown only on the tabbed pages themselves (a section's other pages — a bill,
// a new expense, the menu importer — have their own way back), and only when
// the reader can open at least two of them.
// ============================================================

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

export interface SectionTab {
  href: string;
  label: string;
}

export default function SectionTabs({ tabs, label }: { tabs: readonly SectionTab[]; label: string }) {
  const pathname = usePathname();
  if (tabs.length < 2 || !tabs.some((t) => t.href === pathname)) return null;
  return (
    <nav aria-label={label} className="tabs mb-5">
      {tabs.map((t) => {
        const on = t.href === pathname;
        return (
          <Link key={t.href} href={t.href as Route} aria-current={on ? "page" : undefined} className={`tab ${on ? "is-on" : ""}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
