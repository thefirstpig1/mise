// ============================================================
// Mise — the page that is not there (Sprint 7 Part 34, ADR 0033 Q12)
// ============================================================
// Without this file the reader gets Next's built-in 404: the words
// "This page could not be found" in English, on a bare white page, with no way
// back. Every other screen in Mise is in Thai (CLAUDE.md), so the one screen a
// mistyped URL reaches would have been the only English one.
//
// It is also reached deliberately: `notFound()` is what a route calls when an
// id in the URL belongs to another tenant or no longer exists — which, since
// Part 30, is a thing row-level security makes routine rather than exotic.
// So this page must not imply the reader did something wrong. It says the page
// was not found and offers the way back; it does not guess why.
// ============================================================

import Link from "next/link";

import Logo from "@/components/layout/Logo";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-5 py-16 text-center">
      <Logo size={64} />

      <div>
        <h1 className="font-display text-2xl font-semibold">ไม่พบหน้านี้</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          ลิงก์อาจพิมพ์ผิด หรือรายการนี้ถูกลบไปแล้ว
        </p>
      </div>

      <Link
        href="/"
        className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-deep"
      >
        กลับหน้าแรก
      </Link>
    </main>
  );
}
