// ============================================================
// Mise — below par and NEAR par (Kong 2026-10-21, rules PAR-1 / PAR-2)
// ============================================================
// One rule, read by the sidebar badge, the products list, its sheet and the
// cards, so the red and yellow mean the same thing everywhere.
//
//   LOW   — on hand is below par (ADR 0017 Q6: compared with what is in the
//           building; stock on order does not hide it).
//   NEAR  — still at or above par, but at the rate it is really used it falls
//           below par within the shop's `parWarningDays`. Days, not a
//           percentage, because a product used fast and one used slowly are not
//           equally close at "20% above par". With no usage rate yet (a shop
//           that does not post consumption), within 20% above par instead.
//           `parWarningDays` 0 turns NEAR off entirely.
//
// A plain module — server pages and client components both import it.
// ============================================================

export type ParAlert = { level: "LOW" } | { level: "NEAR"; daysToPar: number | null } | null;

/** Within this share above par counts as near when the usage rate is unknown. */
export const NEAR_PAR_FALLBACK_SHARE = 0.2;

export function parAlertOf(
  f: { onHand: number; par: number | null; usedPerDay: number | null },
  warningDays: number
): ParAlert {
  if (f.par === null) return null;
  if (f.onHand < f.par) return { level: "LOW" };
  if (warningDays <= 0) return null;
  if (f.usedPerDay && f.usedPerDay > 0) {
    const days = (f.onHand - f.par) / f.usedPerDay;
    return days <= warningDays ? { level: "NEAR", daysToPar: Math.max(0, Math.floor(days)) } : null;
  }
  return f.onHand <= f.par * (1 + NEAR_PAR_FALLBACK_SHARE) ? { level: "NEAR", daysToPar: null } : null;
}
