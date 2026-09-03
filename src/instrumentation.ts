// ============================================================
// Mise — what the server says about itself when it starts
// (Sprint 7 Part 34, ADR 0033 Q7 / Consequence 2)
// ============================================================
// Next calls `register()` once per server process, before it handles anything.
// It exists here for one reason and should stay that small.
//
// The per-IP login limit counts IN MEMORY, and that is correct only while there
// is exactly one instance (ADR 0033 Q2 chose one long-running server; Q4
// accepted "almost always up"). The day someone scales to two, the limit
// silently becomes forty an hour instead of twenty — no error, no failed
// request, just twice as much mail as intended.
//
// A wrong number that never announces itself is the failure this project has
// spent whole Parts removing, so the assumption is printed rather than assumed.
// If this line ever appears from two different machine ids, the counter needs
// to be shared and this file is the breadcrumb that says so.
// ============================================================

export async function register() {
  const { singleInstanceWarning } = await import("./lib/email/ip-rate-limit");

  // The two variables are named rather than the whole environment handed over,
  // so what this reads is readable here.
  const notice = singleInstanceWarning({
    FLY_APP_NAME: process.env.FLY_APP_NAME,
    FLY_MACHINE_ID: process.env.FLY_MACHINE_ID,
  });
  if (notice) console.warn(notice);
}
