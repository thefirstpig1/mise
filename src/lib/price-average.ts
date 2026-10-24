// Price comparisons by AVERAGE, never receipt-to-receipt (Kong 2026-10-24,
// rule CO-PRICE v2). Fresh produce prices swing on every delivery — beer
// ranged ฿61.98–69.47 in six weeks at the demo shop — so "first receipt vs last
// receipt" reported +11.6% for a month-average move of +1.8%, and priced
// shrimp as a fall when it had risen. Every comparison here is the
// quantity-weighted average price of one window against another.
//
// A plain module (no Prisma, no React) so the server and the page share it.

export type PriceSample = {
  date: Date;
  productId: string;
  productName: string;
  baseUnit: string;
  pricePerBase: number;
  qtyBase: number;
};

export type WindowAverage = { productId: string; name: string; unit: string; avg: number; qty: number; paid: number; receipts: number };

const DAY = 86_400_000;

/** Quantity-weighted average price per product of the receipts in [from, to] (whole days, inclusive). */
export function averagesIn(points: readonly PriceSample[], from: Date, to: Date): Map<string, WindowAverage> {
  const start = from.getTime();
  const end = to.getTime() + DAY;
  const out = new Map<string, WindowAverage>();
  for (const p of points) {
    const t = p.date.getTime();
    if (t < start || t >= end || p.qtyBase <= 0) continue;
    const cur = out.get(p.productId) ?? { productId: p.productId, name: p.productName, unit: p.baseUnit, avg: 0, qty: 0, paid: 0, receipts: 0 };
    cur.qty += p.qtyBase;
    cur.paid += p.pricePerBase * p.qtyBase;
    cur.receipts += 1;
    cur.avg = cur.paid / cur.qty;
    out.set(p.productId, cur);
  }
  return out;
}

export type PriceMove = { productId: string; name: string; changePct: number; extra: number; detail: string };

/**
 * Rule CO-PRICE v2. What price movements cost in a period: the average paid
 * in it against the average paid in the period before (same length), times
 * the quantity bought in it. A product not bought in BOTH windows has no
 * comparison and is left out rather than guessed.
 */
export function priceMovesFor(
  range: { from: Date; to: Date },
  previous: { from: Date; to: Date },
  points: readonly PriceSample[]
): { up: PriceMove[]; down: PriceMove[] } {
  const now = averagesIn(points, range.from, range.to);
  const before = averagesIn(points, previous.from, previous.to);
  const moves: PriceMove[] = [];
  for (const [id, a] of now) {
    const b = before.get(id);
    if (!b || b.avg <= 0) continue;
    const extra = Math.round((a.avg - b.avg) * a.qty * 100) / 100;
    const changePct = Math.round(((a.avg - b.avg) / b.avg) * 1000) / 10;
    if (Math.abs(extra) < 1 || changePct === 0) continue;
    const unit = a.unit ? ` ต่อ ${a.unit}` : "";
    moves.push({ productId: id, name: a.name, changePct, extra, detail: `เฉลี่ย ฿${b.avg.toFixed(2)} → ฿${a.avg.toFixed(2)}${unit}` });
  }
  return {
    up: moves.filter((m) => m.extra > 0).sort((x, y) => y.extra - x.extra).slice(0, 5),
    down: moves.filter((m) => m.extra < 0).sort((x, y) => x.extra - y.extra).slice(0, 3),
  };
}
