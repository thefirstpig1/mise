// ============================================================
// Mise — whose cost was it (Part 32 L2b, ADR 0032 Q1/Q2)
// ============================================================
// Answers one question for a period: of the stock a branch consumed, how much
// of each product did each department's menus ask for?
//
// It returns DEMAND, never money. `splitValueByDepartment` takes that demand
// and cuts the figure the ledger actually posted — rule F2, and the reason this
// module deliberately has no access to a cost. If it computed value it would be
// a second opinion about COGS, and the day it disagreed with the ledger nothing
// would report which was right.
//
// ── WHY SEGMENTS ───────────────────────────────────────────────────────────
// The obvious implementation asks `computeConsumptionForDayLogic` once per day.
// Measured against a real Neon dev branch (Part 32 L2a): 70 ms a day inside one
// transaction — 2.1 s for a one-branch month, 6.3 s for three branches. Nearly
// all of it is re-resolving and re-loading a recipe graph that had not changed.
//
// So the period is cut into SEGMENTS at every date on which resolution could
// change, and each segment resolves once. This is not an approximation: within
// a segment the recipe a menu resolves to is the same on every day, so exploding
// the segment's summed sales gives the same demand as exploding each day and
// adding. It is in fact slightly MORE accurate, because it rounds once.
//
// Exactly two things move a boundary, and both were checked against the schema
// rather than assumed:
//   * `recipe.effective_from`     — a new version takes over from that date
//   * `menu_merge.effective_from` — the third resolution fallback starts folding
// `recipe_branch` has NO date column, only `created_at`: a branch adopting a
// recipe applies to every day at once. That is a property this module inherits
// rather than introduces, and it is why adoption is not a boundary.
// ============================================================

import { Prisma as PrismaNS } from "@prisma/client";
import type { PrismaClient, Prisma } from "@prisma/client";
import {
  explodeMenuSalesLogic,
  menuSalesForDay,
  type MenuSales,
} from "./consumption";
import {
  splitValueByDepartment,
  type DepartmentDemand,
  type DepartmentId,
} from "./department-split";

/** Product id -> the demand each department's menus generated for it. */
export type PeriodDemand = Map<string, DepartmentDemand[]>;

export type PeriodDemandResult = {
  demand: PeriodDemand;
  /** How many resolution segments the period was cut into — 1 for most shops. */
  segments: number;
  /** Dishes that could not be exploded, so the caller can carry the coverage. */
  skippedMenuIds: string[];
};

const ZERO = new PrismaNS.Decimal(0);
const DAY_MS = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

/**
 * The dates inside the period on which recipe resolution could change.
 *
 * `gt: from` deliberately, not `gte`: something effective ON the first day is
 * already in force for the whole of the first segment and starts nothing.
 */
async function resolutionBoundaries(
  tx: PrismaClient,
  tenantId: string,
  from: Date,
  to: Date
): Promise<Date[]> {
  const [recipes, merges] = await Promise.all([
    tx.recipe.findMany({
      where: {
        tenantId,
        isDraft: false,
        effectiveFrom: { gt: from, lte: to },
      },
      select: { effectiveFrom: true },
      distinct: ["effectiveFrom"],
    }),
    tx.menuMerge.findMany({
      where: {
        tenantId,
        revokedAt: null,
        effectiveFrom: { gt: from, lte: to },
      },
      select: { effectiveFrom: true },
      distinct: ["effectiveFrom"],
    }),
  ]);

  const seen = new Set<number>();
  const out: Date[] = [];
  for (const r of [...recipes, ...merges]) {
    const t = r.effectiveFrom.getTime();
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(r.effectiveFrom);
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export async function departmentDemandForPeriodLogic(
  tx: PrismaClient,
  tenantId: string,
  params: {
    branchId: string;
    from: Date;
    to: Date;
    cancelledSalePolicy: "TREAT_AS_COOKED" | "TREAT_AS_NOT_COOKED";
  }
): Promise<PeriodDemandResult> {
  const { branchId, from, to, cancelledSalePolicy } = params;

  const boundaries = await resolutionBoundaries(tx, tenantId, from, to);

  const segments: { start: Date; end: Date }[] = [];
  let cursor = from;
  for (const b of boundaries) {
    if (b.getTime() > cursor.getTime()) {
      segments.push({ start: cursor, end: addDays(b, -1) });
    }
    cursor = b;
  }
  segments.push({ start: cursor, end: to });

  const demand: PeriodDemand = new Map();
  const skippedMenuIds: string[] = [];
  // Menu -> department, fetched once for the whole period. A menu's department
  // is NOT dated (there is one column on `menu`), so unlike its recipe it does
  // not vary by segment — which is also what makes rule F9 true: changing it
  // rewrites the past, because nothing recorded what it used to be.
  const departmentOf = new Map<string, DepartmentId>();

  for (const seg of segments) {
    const sales = await menuSalesForDay(
      tx,
      tenantId,
      branchId,
      { gte: seg.start, lte: seg.end },
      cancelledSalePolicy
    );

    const sold = sales.filter((s) => !s.qty.isZero());
    if (sold.length === 0) continue;

    await loadDepartments(tx, tenantId, sold, departmentOf);

    const names = await menuNamesFor(tx, tenantId, sold);

    // The SAME engine posting runs (rule N2 / ADR 0025 Q4). Resolution date is
    // the segment's first day: every day in it resolves identically, which is
    // the definition the boundaries above were built to guarantee.
    const exploded = await explodeMenuSalesLogic(tx, tenantId, {
      sales: sold,
      branchId,
      resolutionDate: seg.start,
      names,
    });

    for (const s of exploded.skipped) skippedMenuIds.push(s.menuId);

    for (const m of exploded.byMenu) {
      const departmentId = departmentOf.get(m.menuId) ?? null;
      for (const line of m.lines) {
        const list = demand.get(line.productId) ?? [];
        const existing = list.find((d) => d.departmentId === departmentId);
        if (existing === undefined) {
          list.push({ departmentId, qty: line.qty });
        } else {
          existing.qty = existing.qty.plus(line.qty);
        }
        demand.set(line.productId, list);
      }
    }
  }

  return { demand, segments: segments.length, skippedMenuIds };
}

async function loadDepartments(
  tx: PrismaClient,
  tenantId: string,
  sold: MenuSales[],
  into: Map<string, DepartmentId>
): Promise<void> {
  const missing = sold.map((s) => s.menuId).filter((id) => !into.has(id));
  if (missing.length === 0) return;
  const rows = await tx.menu.findMany({
    where: { tenantId, id: { in: missing } },
    select: { id: true, primaryDepartmentId: true },
  });
  for (const r of rows) into.set(r.id, r.primaryDepartmentId);
  // A menu the query did not return still gets an entry, so a later segment
  // does not ask for it again — and it lands in ไม่ระบุแผนก, which is where an
  // unattributable cost belongs (rule F8).
  for (const id of missing) if (!into.has(id)) into.set(id, null);
}

async function menuNamesFor(
  tx: PrismaClient,
  tenantId: string,
  sold: MenuSales[]
): Promise<Map<string, string>> {
  const rows = await tx.menu.findMany({
    where: { tenantId, id: { in: sold.map((s) => s.menuId) } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Sum one product's demand, for the ratio checks a caller may want to assert. */
export function totalDemand(
  demand: readonly DepartmentDemand[]
): Prisma.Decimal | null {
  if (demand.length === 0) return null;
  return demand.reduce(
    (t, d) => t.plus(d.qty),
    demand[0].qty.minus(demand[0].qty)
  );
}

// ============================================================
// L3 — the demand above, cut against the money the ledger actually moved
// ============================================================

/**
 * One department's line on the matrix. MATERIALS and REVENUE only: rent and
 * electricity are operating costs of the whole shop and never enter a food-cost
 * figure (rule F5), so OpEx by department is a separate report and not this one.
 */
export type DepartmentBreakdownRow = {
  departmentId: DepartmentId;
  /** Value of the stock this department's menus consumed, apportioned (F2). */
  materialCost: Prisma.Decimal;
  /** Revenue of the dishes it sold, live rows only, same basis as /cost. */
  revenue: Prisma.Decimal;
};

export type DepartmentBreakdown = {
  rows: DepartmentBreakdownRow[];
  segments: number;
  /** Menus that could not be exploded — the caller carries this as coverage. */
  skippedMenuIds: string[];
};

/**
 * Revenue per department for the period.
 *
 * Independent of recipes entirely: a shop with no recipes still gets this, which
 * is the half of rule F4 that survives when gross profit per department cannot
 * be computed. Read off the live sales rows on the same basis /cost uses, so the
 * two pages cannot disagree about what a period earned.
 */
export async function departmentRevenueForPeriodLogic(
  tx: PrismaClient,
  tenantId: string,
  params: { branchId: string; from: Date; to: Date }
): Promise<Map<DepartmentId, Prisma.Decimal>> {
  const { branchId, from, to } = params;

  const byMenu = await tx.salesLine.groupBy({
    by: ["menuId"],
    where: {
      tenantId,
      branchId,
      businessDate: { gte: from, lte: to },
      supersededAt: null,
    },
    _sum: { netAmount: true },
  });
  if (byMenu.length === 0) return new Map();

  const menus = await tx.menu.findMany({
    where: { tenantId, id: { in: byMenu.map((r) => r.menuId) } },
    select: { id: true, primaryDepartmentId: true },
  });
  const departmentOf = new Map(menus.map((m) => [m.id, m.primaryDepartmentId]));

  const out = new Map<DepartmentId, Prisma.Decimal>();
  for (const r of byMenu) {
    // A menu the lookup did not return still counts, into ไม่ระบุแผนก. Dropping
    // it would shrink the revenue this page reports below what /cost reports
    // for the same period, and nothing would say which was right (rule F8).
    const dept = departmentOf.get(r.menuId) ?? null;
    const amount = r._sum.netAmount;
    if (amount === null) continue;
    out.set(dept, (out.get(dept) ?? amount.minus(amount)).plus(amount));
  }
  return out;
}

/**
 * The whole of Part 32's arithmetic, in the order rule F2 requires.
 *
 * `consumptionValueByProduct` must be the value the LEDGER moved for this
 * branch and period — the caller has it from the FIFO replay, and passing it in
 * is what stops this module ever computing a cost of its own (ADR 0032 Q2).
 */
export async function departmentBreakdownLogic(
  tx: PrismaClient,
  tenantId: string,
  params: {
    branchId: string;
    from: Date;
    to: Date;
    cancelledSalePolicy: "TREAT_AS_COOKED" | "TREAT_AS_NOT_COOKED";
    consumptionValueByProduct: ReadonlyMap<string, Prisma.Decimal>;
  }
): Promise<DepartmentBreakdown> {
  const { consumptionValueByProduct, ...periodParams } = params;

  const [demandResult, revenue] = await Promise.all([
    departmentDemandForPeriodLogic(tx, tenantId, periodParams),
    departmentRevenueForPeriodLogic(tx, tenantId, {
      branchId: params.branchId,
      from: params.from,
      to: params.to,
    }),
  ]);

  const cost = new Map<DepartmentId, Prisma.Decimal>();
  for (const [productId, value] of consumptionValueByProduct) {
    // A product the ledger moved but no menu asked for — waste, a manual
    // adjustment, a staff meal the caller did not filter out. splitValue…
    // sends it to ไม่ระบุแผนก rather than losing it (rule F7).
    const shares = splitValueByDepartment(
      value,
      demandResult.demand.get(productId) ?? []
    );
    for (const s of shares) {
      cost.set(
        s.departmentId,
        (cost.get(s.departmentId) ?? s.value.minus(s.value)).plus(s.value)
      );
    }
  }

  const departments = new Set<DepartmentId>([...cost.keys(), ...revenue.keys()]);
  const rows: DepartmentBreakdownRow[] = [...departments].map((departmentId) => ({
    departmentId,
    materialCost: cost.get(departmentId) ?? ZERO,
    revenue: revenue.get(departmentId) ?? ZERO,
  }));

  // Named departments first and ไม่ระบุ last, so the bucket that means "we do
  // not know" never sits above the ones that do.
  rows.sort((a, b) => {
    if (a.departmentId === b.departmentId) return 0;
    if (a.departmentId === null) return 1;
    if (b.departmentId === null) return -1;
    return a.departmentId < b.departmentId ? -1 : 1;
  });

  return {
    rows,
    segments: demandResult.segments,
    skippedMenuIds: demandResult.skippedMenuIds,
  };
}
