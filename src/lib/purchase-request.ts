// ============================================================
// Mise — the purchase request's arithmetic (Part 38, ADR 0036)
// ============================================================
// Pure: no database, so every rule here is pinned by a test instead of by a
// screenshot. The server reads the rows; this decides what they mean.
//
//   suggestedOrderQty — rule PR1: par − on hand − already on order
//   cheaperElsewhere  — rule PR2: another supplier's last price is lower
//   requestLineStatus — rule R1: a line's status is READ from its PO lines,
//                       never stored
//   defaultSupplierId — Q11: preferred → last bought here → nobody
// ============================================================

// ------------------------------------------------------------
// PR1 — what to order
// ------------------------------------------------------------

export type SuggestInput = {
  /** Par in BASE units; null = no par set, so nothing to suggest. */
  par: number | null;
  /** What the system believes is on the shelf, base units. */
  systemOnHand: number;
  /** "ที่เหลืออยู่จริง" typed by the person at the shelf — wins when present. */
  typedOnHand: number | null;
  /** Ordered and not yet received, base units (open PO lines). */
  onOrder: number;
  /** Base units in ONE of the unit being ordered (1 for the base unit itself). */
  unitToBase: number;
};

/**
 * How many of the ordering unit to suggest, or null when there is nothing to
 * suggest (no par, or already covered). Rounded UP to whole units of the unit
 * being ordered — short by 2.3 kg of a 1 kg pack is 3 packs, never 2.
 *
 * A suggestion only; the kitchen may type anything (ADR 0036 Q5).
 */
export function suggestedOrderQty(i: SuggestInput): number | null {
  if (i.par === null || !(i.unitToBase > 0)) return null;
  const onHand = i.typedOnHand ?? i.systemOnHand;
  const shortBase = i.par - onHand - i.onOrder;
  if (!(shortBase > 0)) return null;
  // Guard floating dust: 2.0000000001 packs must not become 3.
  const units = Math.ceil(shortBase / i.unitToBase - 1e-9);
  return units > 0 ? units : null;
}

// ------------------------------------------------------------
// PR2 — is someone else cheaper?
// ------------------------------------------------------------

export type SupplierPrice = {
  supplierId: string;
  supplierName: string;
  /** Price per BASE unit, EXCLUDING VAT. */
  pricePerBase: number;
  /** When this price was true: the receipt date, or the price list's effective date. */
  asOf: string; // YYYY-MM-DD
  source: "paid" | "list";
};

export type CheaperHint = {
  supplierId: string;
  supplierName: string;
  asOf: string;
  source: "paid" | "list";
  /** Money — only ever sent to someone holding cost:view (rule R5). */
  money: { theirs: number; ours: number } | null;
};

/**
 * The cheapest OTHER supplier whose latest known price is below the chosen
 * one's. Null when the chosen supplier has no known price (nothing to compare
 * against — "cheaper than what?"), when nobody is cheaper, or when nothing is
 * known at all.
 *
 * `withMoney` false strips the figures: a cook is told THAT B is cheaper and
 * as of when, never by how much (ADR 0036 Q2) — a percentage would let them
 * work the price back out.
 */
export function cheaperElsewhere(
  chosenSupplierId: string | null,
  prices: readonly SupplierPrice[],
  withMoney: boolean
): CheaperHint | null {
  if (!chosenSupplierId) return null;
  const ours = prices.find((p) => p.supplierId === chosenSupplierId);
  if (!ours) return null;
  let best: SupplierPrice | null = null;
  for (const p of prices) {
    if (p.supplierId === chosenSupplierId) continue;
    // A satang per kg is not "cheaper" — compare at the precision money has.
    if (round4(p.pricePerBase) >= round4(ours.pricePerBase)) continue;
    if (best === null || p.pricePerBase < best.pricePerBase) best = p;
  }
  if (!best) return null;
  return {
    supplierId: best.supplierId,
    supplierName: best.supplierName,
    asOf: best.asOf,
    source: best.source,
    money: withMoney ? { theirs: best.pricePerBase, ours: ours.pricePerBase } : null,
  };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * One supplier's latest known price for a product (rule PR2): the last price
 * actually PAID at a receipt wins; the price list is the fallback. Both come in
 * per base unit, excl VAT.
 */
export function latestKnownPrice(
  paid: { pricePerBase: number; asOf: string } | null,
  list: { pricePerBase: number; asOf: string } | null
): { pricePerBase: number; asOf: string; source: "paid" | "list" } | null {
  if (paid) return { ...paid, source: "paid" };
  if (list) return { ...list, source: "list" };
  return null;
}

// ------------------------------------------------------------
// Q11 — who to order from, before anyone chooses
// ------------------------------------------------------------

export function defaultSupplierId(preferredId: string | null, lastBoughtId: string | null): string | null {
  return preferredId ?? lastBoughtId ?? null;
}

// ------------------------------------------------------------
// R1 — the line's status, read from its PO lines
// ------------------------------------------------------------

export type OrderLink = {
  poId: string;
  poNumber: string;
  poStatus: "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  poDeleted: boolean;
  poClosedShort: boolean;
  qtyOrdered: number;
  qtyReceived: number;
  unitName: string;
  supplierName: string;
  /** The supplier's latest promise (YYYY-MM-DD), or null — never guessed. */
  promisedDate: string | null;
  /** When the PO line was created — orders the links over time. */
  createdAt: string;
};

export type RequestLineStatus =
  | { kind: "waiting" }
  | { kind: "rejected"; reason: string }
  | { kind: "preparing"; link: OrderLink }
  | { kind: "ordered"; link: OrderLink }
  | { kind: "promised"; link: OrderLink; date: string; overdueDays: number }
  | { kind: "partial"; link: OrderLink }
  | { kind: "closed_short"; link: OrderLink }
  | { kind: "received"; link: OrderLink };

/**
 * ADR 0036 R1 / Q10. The live link is the NEWEST PO line whose order was
 * neither cancelled nor deleted as a draft — a cancelled order puts the line
 * back to "waiting" by itself, with nothing to remember or undo.
 */
export function requestLineStatus(
  line: { rejectReason: string | null; rejectedAt: string | null },
  links: readonly OrderLink[],
  today: string // YYYY-MM-DD, Bangkok business day
): RequestLineStatus {
  const live = [...links]
    .filter((l) => !l.poDeleted && l.poStatus !== "CANCELLED")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];

  if (!live) {
    return line.rejectedAt ? { kind: "rejected", reason: line.rejectReason ?? "" } : { kind: "waiting" };
  }
  if (live.poStatus === "DRAFT") return { kind: "preparing", link: live };
  if (live.poStatus === "RECEIVED") {
    return live.qtyReceived + 1e-9 < live.qtyOrdered ? { kind: "closed_short", link: live } : { kind: "received", link: live };
  }
  if (live.poStatus === "PARTIALLY_RECEIVED" && live.qtyReceived > 0) {
    return live.qtyReceived + 1e-9 < live.qtyOrdered ? { kind: "partial", link: live } : { kind: "received", link: live };
  }
  // SENT (or partially received on OTHER lines of the same order).
  if (live.promisedDate) {
    return { kind: "promised", link: live, date: live.promisedDate, overdueDays: Math.max(0, daysBetween(live.promisedDate, today)) };
  }
  return { kind: "ordered", link: live };
}

/** Is the line still the kitchen's to change? (R4: not once a round took it.) */
export const kitchenCanEdit = (s: RequestLineStatus) => s.kind === "waiting";

/** Does the line count as "already asked for" when someone adds the same product? (Q3) */
export const isOutstanding = (s: RequestLineStatus) =>
  s.kind === "waiting" || s.kind === "preparing" || s.kind === "ordered" || s.kind === "promised" || s.kind === "partial";

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

// ------------------------------------------------------------
// Q3 — which departments are ready
// ------------------------------------------------------------

export type Readiness = {
  departments: { id: string; name: string; ready: { by: string; at: string } | null; waitingLines: number }[];
  /** EVERY department has said ready and something is waiting — the purchaser's cue. */
  allReady: boolean;
};

/**
 * EVERY department is asked, including one with nothing waiting — a bar that
 * has not STARTED adding yet looks exactly like a bar that needs nothing, and
 * treating it as ready is Kong's own failure case (the hot kitchen finishes,
 * the round goes, the bar's three lines miss it). A department with nothing
 * to order says so by pressing ready on an empty list ("รอบนี้ไม่มีของ").
 */
export function readiness(
  departments: readonly { id: string; name: string }[],
  waitingByDept: ReadonlyMap<string, number>,
  ready: ReadonlyMap<string, { by: string; at: string }>
): Readiness {
  const rows = departments.map((d) => ({
    id: d.id,
    name: d.name,
    ready: ready.get(d.id) ?? null,
    waitingLines: waitingByDept.get(d.id) ?? 0,
  }));
  const anyWaiting = rows.some((d) => d.waitingLines > 0);
  return { departments: rows, allReady: anyWaiting && rows.every((d) => d.ready !== null) };
}
