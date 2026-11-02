"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/platform", label: "ร้านทั้งหมด" },
  { href: "/platform/users", label: "ค้นหาผู้ใช้" },
  { href: "/platform/reports", label: "เรื่องที่แจ้งเข้ามา" },
  { href: "/platform/audit", label: "บันทึกการแก้ไข" },
] as const;

/** `newReports` — reports nobody has opened yet (ADR 0044), counted by the layout. */
export default function PlatformTabs({ newReports = 0 }: { newReports?: number }) {
  const path = usePathname();
  return (
    <nav className="seg" aria-label="เมนูหน้าควบคุมระบบ">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href as Route} className={`seg-item ${path === t.href ? "is-on" : ""}`}>
          {t.label}
          {t.href === "/platform/reports" && newReports > 0 ? (
            <span className="ml-1.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#C9734F] px-1.5 text-[11px] font-bold leading-none text-white tabular-nums">
              {newReports > 99 ? "99+" : newReports}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
