"use client";

// ============================================================
// คิดครัว — the "?" beside a page's title
// ============================================================
// Kong 2026-11-05 (review item 5, plan 62uD4Btj1rRXV8nAHDWymV): every data
// page says, in one window, what question it answers, what it looks like with
// data, which data it uses — with THIS shop's status for each — what comes
// out, and why it matters. Opened only when pressed; the first visit to a page
// shows a small "ใหม่" tag under the button so people know it is there.
//
// The words live in src/lib/page-help.ts. The pictures are the same made-up
// shop examples the "นี่คืออะไร" window draws, labelled so — the one place
// made-up figures may appear (Kong 2026-11-05, empty pages).
// ============================================================

import { Suspense, lazy, useEffect, useState } from "react";
import type { PageHelpKey } from "@/lib/page-help";

// The window and the words load on the first press (round 2.1 made them long);
// resting the pointer on "?" or tabbing to it starts the load a moment early.
const PageHelpWindow = lazy(() => import("@/components/ui/PageHelpWindow"));
const warm = () => void import("@/components/ui/PageHelpWindow");

const SEEN = (key: PageHelpKey) => `kitkrua-help-seen:${key}`;

export default function PageHelp({ page, branchId }: { page: PageHelpKey; branchId?: string }) {
  const [open, setOpen] = useState(false);
  // Read after mount: the server cannot know what this browser has seen. The
  // tag shows on the FIRST visit only (plan: "ครั้งแรกที่เปิดหน้า"), so it is
  // marked seen as soon as it is shown, pressed or not.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN(page)) === null) {
        setFresh(true);
        window.localStorage.setItem(SEEN(page), "1");
      }
    } catch {
      // Private window or blocked storage: no tag, the button is still there.
    }
  }, [page]);

  const show = () => {
    setOpen(true);
    setFresh(false);
  };

  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={show}
        onPointerEnter={warm}
        onFocus={warm}
        aria-label="หน้านี้คืออะไร"
        title="หน้านี้คืออะไร"
        className="help-btn"
      >
        ?
      </button>
      {fresh ? (
        <span className="pointer-events-none absolute left-0 top-[calc(100%+6px)] max-sm:left-auto max-sm:right-0 z-20 animate-fade-in whitespace-nowrap rounded-lg bg-primary px-2.5 py-1 font-sans text-xs font-normal tracking-normal text-primary-foreground shadow-md before:absolute before:-top-1 before:left-2.5 max-sm:before:left-auto max-sm:before:right-2.5 before:h-2 before:w-2 before:rotate-45 before:bg-primary before:content-['']">
          ใหม่ · กดดูว่าหน้านี้บอกอะไร
        </span>
      ) : null}
      {open ? (
        // Every press answers at once: while the window loads, a note where the "ใหม่" tag sits.
        <Suspense
          fallback={
            <span className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-20 animate-fade-in whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1 font-sans text-xs font-normal tracking-normal text-muted-foreground shadow-md max-sm:left-auto max-sm:right-0">
              กำลังเปิด…
            </span>
          }
        >
          <PageHelpWindow page={page} branchId={branchId} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </span>
  );
}
