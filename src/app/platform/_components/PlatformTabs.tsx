"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/platform", label: "ร้านทั้งหมด" },
  { href: "/platform/users", label: "ค้นหาผู้ใช้" },
  { href: "/platform/audit", label: "บันทึกการแก้ไข" },
] as const;

export default function PlatformTabs() {
  const path = usePathname();
  return (
    <nav className="seg" aria-label="เมนูผู้ดูแลระบบ">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href as Route} className={`seg-item ${path === t.href ? "is-on" : ""}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
