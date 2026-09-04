"use client";

// ============================================================
// Mise — when a page throws (Sprint 7 Part 34, ADR 0033 Q12)
// ============================================================
// 🔴 THE TRAP THIS FILE EXISTS TO CLOSE, AND WHY LOCALHOST CANNOT SHOW IT.
// In development Next renders a stack trace overlay, so no amount of local
// testing ever displays what production displays: an English sentence and a
// `digest` hash, on a white page, with no way back. Exactly the shape of trap
// ADR 0031 hit when real sending was switched on — the thing that only exists
// once NODE_ENV says production.
//
// `"use client"` is required: Next's error boundary must run in the browser to
// offer `reset()`. That is also why this file cannot read anything from the
// database — it has no server, and no session.
//
// WHAT IT DELIBERATELY DOES NOT SAY. Not the message, not the stack: an error
// thrown inside a Server Component can carry a table name, an id, or a fragment
// of SQL, and Next strips it in production for that reason. Repeating it here
// would undo that. The `digest` IS shown, because it is the only thing that
// connects what the reader saw to what `fly logs` recorded — a shop that can
// read six characters back to us turns "it broke this morning" into something
// findable. It is the nearest thing to error tracking until milestone B buys
// the real one (Q12).
//
// TWO WAYS OUT, AND THEY ARE NOT THE SAME. `reset()` re-renders the boundary
// without a round trip to the server, which fixes the case this page will most
// often meet: the first query of the session lost the race with a Neon compute
// waking up (ADR 0024, and Q8's accepted cost). The link is for when it does
// not, so nobody is left pressing a button that keeps failing — and it is a
// plain `<a>`, not `<Link>`, deliberately: the client router is part of what
// just failed, so the way out asks the browser for a whole new document.
//
// NO `global-error.tsx`, AND THAT IS A DECISION. It would catch a throw in the
// root layout — which this project's root layout cannot do: it loads fonts and
// renders children, with no data fetch and no session read. A second error
// page that can never be reached is a second page to keep in step with the
// theme, for nothing. Add one the day the root layout starts doing work.
// ============================================================

import { useEffect } from "react";

import Logo from "@/components/layout/Logo";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The browser console is not error tracking and is not pretending to be.
    // It is what lets someone sitting beside the shop see the real message,
    // which the screen above deliberately withholds.
    console.error("[mise] page error", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center gap-6 px-5 py-16 text-center">
      <Logo size={64} />

      <div>
        <h1 className="font-display text-2xl font-semibold">เกิดข้อผิดพลาด</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          หน้านี้โหลดไม่สำเร็จ ลองใหม่อีกครั้ง — ข้อมูลของคุณไม่ได้หายไปไหน
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="btn px-5 py-2.5"
        >
          ลองใหม่
        </button>
        <a
          href="/"
          className="rounded-lg border border-border-strong px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          กลับหน้าแรก
        </a>
      </div>

      {error.digest ? (
        <p className="pt-2 font-mono text-xs text-muted-subtle">
          รหัสอ้างอิง: {error.digest}
        </p>
      ) : null}
    </main>
  );
}
