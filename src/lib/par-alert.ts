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

// ------------------------------------------------------------
// Rule PAR-3 (Kong 2026-10-21): a badge counts what still needs a hand.
// ------------------------------------------------------------
// Someone acted = a SENT purchase order or an open purchase request covers it.
// The alert comes back red when the order is short (on hand + coming < par)
// or late (past its promised date, or 3 days after sending when none was given).

/** No promised date: an order counts as late this many days after it was sent. */
export const LATE_DAYS_WITHOUT_DATE = 3;

export type ParCover = {
  /** Base units still to come on SENT / part-received orders. */
  ordered: number;
  /** Base units asked for on purchase requests nobody has ordered yet. */
  requested: number;
  /** Days past due of the latest-running order; 0 = none late. */
  lateDays: number;
  /** Days a request has waited past LATE_DAYS_WITHOUT_DATE with nobody ordering it; 0 = fine. */
  requestLateDays: number;
};

export type ParStateKind = "need" | "short" | "overdue" | "stale-request" | "ordered" | "requested" | "near" | "near-covered";

export function parStateOf(
  f: { onHand: number; par: number | null; usedPerDay: number | null },
  warningDays: number,
  cover: ParCover | null
): { kind: ParStateKind; coming: number } | null {
  const alert = parAlertOf(f, warningDays);
  if (alert === null || f.par === null) return null;
  const coming = (cover?.ordered ?? 0) + (cover?.requested ?? 0);
  if (coming <= 0) return { kind: alert.level === "LOW" ? "need" : "near", coming: 0 };
  if ((cover?.lateDays ?? 0) > 0) return { kind: "overdue", coming };
  // Asked for days ago and nobody has ordered it: the action stalled.
  if ((cover?.ordered ?? 0) <= 0 && (cover?.requestLateDays ?? 0) > 0) return { kind: "stale-request", coming };
  if (f.onHand + coming < f.par) return { kind: "short", coming };
  if (alert.level === "NEAR") return { kind: "near-covered", coming };
  return { kind: (cover?.ordered ?? 0) > 0 ? "ordered" : "requested", coming };
}

/** Red on the badge: below par and nobody has done enough about it. */
export const PAR_RED: ReadonlySet<ParStateKind> = new Set(["need", "short", "overdue", "stale-request"]);

// ------------------------------------------------------------
// Rule PAR-4 (Kong 2026-10-21): how much to suggest ordering.
// ------------------------------------------------------------
// Below par: back to par (PR1). Near par: enough to stay at par through the
// shop's warning window — par + usage × warningDays — or, with no usage rate,
// back above the 20% band. Minus what is already on its way; rounded UP to
// whole units of the unit being ordered; nothing when that comes to ≤ 0.

export function suggestOrderQty(
  f: { onHand: number; par: number | null; usedPerDay: number | null },
  warningDays: number,
  onOrderBase: number,
  unitToBase: number
): { level: "LOW" | "NEAR"; qty: number } | null {
  const alert = parAlertOf(f, warningDays);
  if (alert === null || f.par === null || !(unitToBase > 0)) return null;
  const target =
    alert.level === "LOW"
      ? f.par
      : f.usedPerDay && f.usedPerDay > 0
        ? f.par + f.usedPerDay * warningDays
        : f.par * (1 + NEAR_PAR_FALLBACK_SHARE);
  const shortBase = target - f.onHand - onOrderBase;
  if (!(shortBase > 0)) return null;
  // Guard floating dust: 2.0000000001 packs must not become 3.
  const qty = Math.ceil(shortBase / unitToBase - 1e-9);
  return qty > 0 ? { level: alert.level, qty } : null;
}
