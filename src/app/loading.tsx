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

import { SteamingPot } from "@/components/layout/Doodles";

export default function Loading() {
  return (
    <main
      className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-5 py-16"
      // Screen readers get told once, rather than on every frame.
      role="status"
      aria-live="polite"
    >
      {/* A pot with its steam rising — the doodle family's own vocabulary
          (Doodles.tsx), and still no spinner: a spinner is a foreign object
          here. It replaced the breathing mark in the doodle pass.

          The steam stops for a reader who has asked their system for less
          motion (the SVG carries its own `prefers-reduced-motion` rule) — the
          information is in the words, and the movement never carried any. */}
      <SteamingPot className="w-32" />

      <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
    </main>
  );
}
