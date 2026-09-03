// ============================================================
// Mise — what the screen says while nothing has arrived yet
// (Sprint 7 Part 34, ADR 0033 Q12)
// ============================================================
// 🔴 THIS IS NOT POLISH. IT IS THE CONDITION THAT MAKES Q8 ACCEPTABLE.
//
// Q8 accepted that Neon's free plan suspends the compute after five minutes
// idle and cannot be told not to, on the grounds that "the screen will say it
// is loading". There was no `loading.tsx` in the project, so that promise had
// nothing behind it: the first page load of every session — every morning, and
// after every lunch break — hangs on a blank white screen for one to three
// seconds while the database wakes up, with nothing to look at and no reason
// given. A shop reads that as a broken app, and they are not wrong to.
//
// Root-level, so it covers every route that has not written its own. Next
// shows it while a Server Component's data is in flight.
//
// It deliberately does NOT explain the database. "กำลังโหลด" is what is true
// and useful; "the compute is resuming from suspend" is our problem, not the
// reader's.
// ============================================================

import Logo from "@/components/layout/Logo";

export default function Loading() {
  return (
    <main
      className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-5 py-16"
      // Screen readers get told once, rather than on every frame.
      role="status"
      aria-live="polite"
    >
      {/* The mark, breathing. No spinner: a spinner is a foreign object on a
          page whose whole identity is one shape, and this shape is already the
          thing the reader is waiting for.

          `motion-safe:` because a reader who has asked their system for less
          motion still gets the mark and the sentence — the information is in
          the words, and the movement was never carrying any of it. */}
      <Logo size={56} className="motion-safe:animate-pulse" />

      <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
    </main>
  );
}
