// ============================================================
// Mise — Bangkok date helpers (shared: zod layer + server logic)
// ============================================================
// `computeBangkokToday` was defined inside src/server/product-restore.ts
// (Part 8.5 / ADR 0010). Part 10 L2 needs the SAME "today" for the stock
// backdate guard, but a zod schema is imported by Client Components and
// src/server/* pulls in Prisma via @/lib/db — importing it there would drag
// the Prisma client into the browser bundle.
//
// So it moves here (no dependencies at all) and product-restore.ts re-exports
// it: every existing import path keeps working unchanged.
//
// Decision #60 note: per-tenant timezone is Sprint 3+. Until then Bangkok
// (UTC+7, no DST) is hardcoded, matching ADR 0010 / ADR 0011 Q5.
// ============================================================

/** Bangkok is UTC+7 year-round — no DST to account for. */
const BANGKOK_UTC_OFFSET_MS = 7 * 3600 * 1000;

const DAY_MS = 86_400_000;

/**
 * "Today" in Bangkok as a UTC-midnight Date, so it compares/writes identically
 * to a `@db.Date` value. Computed in JS (not SQL) so the SAME instant backs
 * every comparison and write within one operation — no drift mid-transaction.
 */
export function computeBangkokToday(): Date {
  const bkk = new Date(Date.now() + BANGKOK_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate())
  );
}

/** Shift a UTC-midnight day value by whole days (negative = into the past). */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}
