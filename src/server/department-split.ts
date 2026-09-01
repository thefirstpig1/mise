// ============================================================
// Mise — หารต้นทุนที่ใช้ไปเข้าแผนก (Part 32 L1, ADR 0032 Q1/Q2)
// ============================================================
// RULE F2 IS THE WHOLE FILE: the TOTAL comes from the ledger and only the
// SPLIT comes from the menus.
//
// The department of consumed stock is not stored anywhere and is not being
// stored (ADR 0032 Q1). `stock_movement` carries only a branch, and
// `sales_consumption_item` threw the menu away when it exploded a dish into
// products (ADR 0022). What survives is enough: the sales lines still name the
// menu, `menu.primary_department_id` still names its department, and recipes
// resolve by date — so the attribution is DERIVED at read, the way every cost
// figure in this project has been derived since ADR 0014.
//
// ── WHY THE REAL FIGURE IS APPORTIONED RATHER THAN RECOMPUTED ──────────────
// Recomputing each department's consumption from the recipes would produce a
// second number for a thing the ledger has already recorded, and the two would
// drift — a recipe edited since, a rounding difference, a day posted twice.
// Then the department columns would not add up to the COGS printed beside
// them, and nothing in the system would report which of the two was wrong.
//
// So this function never computes a value. It receives the value that was
// actually posted and cuts it up. The parts sum to the whole BY CONSTRUCTION,
// not by luck, which is what makes rule F2 a fact rather than an intention.
//
// ── ROUNDING ───────────────────────────────────────────────────────────────
// Largest remainder in integer satang, tie-broken by the larger demand and then
// by department id — the same convention `prorateAllocations` uses for H.3's
// department split of a received quantity (goods-receipt.ts:293). Two ways of
// dividing a thing among departments in one codebase should not disagree.
//
// ── WHAT LANDS IN "ไม่ระบุแผนก" (departmentId === null) ────────────────────
// Rules F7 and F8, and both are deliberate:
//   * a menu whose `primaryDepartmentId` is null — it is shown, never dropped
//   * anything with no menu behind it at all (waste, manual adjustments)
//   * a figure that cannot be attributed without inventing something (below)
// Money is never allowed to vanish: whatever cannot be attributed is attributed
// to nobody, out loud, rather than being silently discarded or spread around.
// ============================================================

import { Prisma } from "@prisma/client";

const ZERO = new Prisma.Decimal(0);
const SATANG = new Prisma.Decimal(100);

/** `null` is ไม่ระบุแผนก — a real bucket, not a missing value. */
export type DepartmentId = string | null;

export type DepartmentDemand = {
  departmentId: DepartmentId;
  /**
   * Base-unit demand this department's menus generated for the product, from
   * the SAME explosion the posting used. Signed, like `ConsumptionLine.qty`:
   * normally negative (stock leaving), positive on a day whose cancellations
   * outweighed its sales.
   *
   * Only the RATIO between these is read. Their absolute size never reaches
   * the answer, which is why a recipe edited since posting cannot move money.
   */
  qty: Prisma.Decimal;
};

export type DepartmentShare = {
  departmentId: DepartmentId;
  value: Prisma.Decimal;
};

/**
 * Cut one product's actually-posted consumption value across the departments
 * whose menus demanded it.
 *
 * `value` must be the figure the ledger moved — signed, 2 dp. The result always
 * sums to it exactly.
 */
export function splitValueByDepartment(
  value: Prisma.Decimal,
  demand: readonly DepartmentDemand[],
): DepartmentShare[] {
  // Nothing moved: there is nothing to attribute, and emitting a row of zeroes
  // per department would put departments on a report that had no part in it.
  if (value.isZero()) return [];

  const unattributable = (): DepartmentShare[] => [
    { departmentId: null, value: value.toDecimalPlaces(2) },
  ];

  if (demand.length === 0) return unattributable();

  // Weights are signed. Their SUM is what the ratio divides by, so a day where
  // one department's cancellations exactly cancel another's sales has no ratio
  // to speak of — the money is real but nobody's share of it is defined.
  // Inventing one (by using magnitudes, say) would attribute cost to a
  // department on the strength of arithmetic rather than evidence.
  const weightTotal = demand.reduce((t, d) => t.plus(d.qty), ZERO);
  if (weightTotal.isZero()) return unattributable();

  // Integer satang, so "sums exactly" is a fact about integers rather than a
  // hope about decimals. Sign is carried on the side and reapplied at the end:
  // Math.floor on a negative rounds away from zero, which would hand out more
  // than there is.
  const negative = value.isNegative();
  const totalSatang = value.abs().mul(SATANG).round().toNumber();

  const shares = demand.map((d, index) => {
    // Ratio of signed weights, so a department whose net demand ran the other
    // way takes a negative share of the whole — which is the truth about that
    // day, not an error.
    const exact = d.qty.div(weightTotal).mul(totalSatang).toNumber();
    const floor = Math.floor(exact);
    return {
      index,
      departmentId: d.departmentId,
      qty: d.qty,
      floor,
      remainder: exact - floor,
    };
  });

  let leftover = totalSatang - shares.reduce((t, s) => t + s.floor, 0);

  // H.3's rule, borrowed: biggest remainder first, then the biggest demand,
  // then the lowest id. `null` sorts last among ids so that ไม่ระบุแผนก never
  // wins a satang from a named department on a coin toss.
  const order = [...shares].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      b.qty.abs().comparedTo(a.qty.abs()) ||
      compareDepartmentId(a.departmentId, b.departmentId),
  );
  for (const s of order) {
    if (leftover <= 0) break;
    s.floor += 1;
    leftover -= 1;
  }

  return shares
    .filter((s) => s.floor !== 0)
    .map((s) => {
      const magnitude = new Prisma.Decimal(s.floor).div(SATANG);
      return {
        departmentId: s.departmentId,
        value: negative ? magnitude.negated() : magnitude,
      };
    });
}

function compareDepartmentId(a: DepartmentId, b: DepartmentId): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Fold many products' splits into one figure per department.
 *
 * Kept separate from the cutting above because the cutting is where the money
 * is conserved and this is only addition — a test that pins the sum should be
 * able to reach the cutting without a report's worth of scaffolding.
 */
export function sumSharesByDepartment(
  shares: readonly DepartmentShare[],
): Map<DepartmentId, Prisma.Decimal> {
  const out = new Map<DepartmentId, Prisma.Decimal>();
  for (const s of shares) {
    out.set(s.departmentId, (out.get(s.departmentId) ?? ZERO).plus(s.value));
  }
  return out;
}
