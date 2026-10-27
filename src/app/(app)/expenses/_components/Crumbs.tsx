// One line saying where this page sits (expense review 2026-10-27): replaces
// the "← กลับ…" link, which said the same thing a second time.
import Link from "next/link";
import type { Route } from "next";

export default function Crumbs({ trail, here }: { trail: { href: string; label: string }[]; here: string }) {
  return (
    <nav aria-label="ตำแหน่งของหน้านี้" className="text-sm text-muted-foreground">
      {trail.map((t) => (
        <span key={t.href}>
          <Link href={t.href as Route} className="hover:text-foreground">
            {t.label}
          </Link>
          <span aria-hidden className="mx-1.5">›</span>
        </span>
      ))}
      <span className="text-foreground">{here}</span>
    </nav>
  );
}
