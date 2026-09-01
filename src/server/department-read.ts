// ============================================================
// Mise — the department page's one query path (Part 32 L4, ADR 0032)
// ============================================================
// Turns a branch and a period into the rows the screen prints. Everything it
// decides has already been decided elsewhere: L1 cuts the money, L2 works out
// the demand, L3 puts the two together. This only fetches.
//
// 🔴 TWO RULES ARE RESTATED HERE BECAUSE THEY ARE FETCHED HERE, and a reader
// who changes this query has to meet them again:
//
//   N10 — ask the DOCUMENTS, not the movements by date. A period can hold a
//         consumption whose run was voided by a re-import, whose reversal is
//         dated NOW rather than on the sales day. Summing movements inside the
//         period would count a day that no longer stands and never see the row
//         that took it back. `voidedAt: null` on the run is what makes a
//         re-imported day drop out whole.
//
//   S5  — a staff meal posts the SAME movement type from a different table
//         (ADR 0028). It must not be in cost of goods SOLD, because nobody
//         sold it. Before Part 26 it was excluded by accident — the id was not
//         found in `sales_consumption_item` and the row was skipped — and the
//         day somebody widened that query it would have walked into COGS with
//         nothing reporting it. So `sourceType` is checked explicitly, twice,
//         exactly as stock-cost.ts checks it.
//
// These have to agree with `getBranchCostSummaryLogic` or the department
// columns will not add up to the COGS on /cost. The tests assert the sum
// rather than trusting the comment.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { replayPairsInTx, costKeyOf } from "./stock-cost";
import {
  departmentBreakdownLogic,
  type DepartmentBreakdown,
} from "./department-cost";

const ZERO = new Prisma.Decimal(0);

export type DepartmentReport = DepartmentBreakdown & {
  /** Total material cost across the rows, so the screen can print a check. */
  materialCostTotal: Prisma.Decimal;
  revenueTotal: Prisma.Decimal;
  /** True when the shop's method cannot produce gross profit per department. */
  grossProfitUnavailable: boolean;
};

export async function getDepartmentReportLogic(
  tenantId: string,
  params: { branchId: string; from: Date; to: Date }
): Promise<DepartmentReport> {
  return withTenantContext(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { grossProfitMethod: true, cancelledSalePolicy: true },
    });

    const consumptionValueByProduct = await consumptionValuesFor(
      tx as unknown as PrismaClient,
      tenantId,
      params
    );

    const breakdown = await departmentBreakdownLogic(
      tx as unknown as PrismaClient,
      tenantId,
      {
        ...params,
        cancelledSalePolicy: tenant.cancelledSalePolicy,
        consumptionValueByProduct,
      }
    );

    return {
      ...breakdown,
      materialCostTotal: breakdown.rows.reduce(
        (t, r) => t.plus(r.materialCost),
        ZERO
      ),
      revenueTotal: breakdown.rows.reduce((t, r) => t.plus(r.revenue), ZERO),
      // Rule F4. Said on the screen rather than hidden: with the periodic method
      // the closing stock sits in a branch store room with no department, so
      // there is no honest way to split it.
      grossProfitUnavailable: tenant.grossProfitMethod !== "RECIPE_CONSUMPTION",
    };
  });
}

/**
 * What the ledger actually moved for this branch and period, per product.
 *
 * The value never comes from a recipe — that is rule F2, and the reason this
 * walks the FIFO replay rather than multiplying quantities by anything.
 */
async function consumptionValuesFor(
  tx: PrismaClient,
  tenantId: string,
  params: { branchId: string; from: Date; to: Date }
): Promise<Map<string, Prisma.Decimal>> {
  const { branchId, from, to } = params;

  // Rule N10: the documents that still stand, not movements by date.
  const items = await tx.salesConsumptionItem.findMany({
    where: {
      tenantId,
      reversalOfItemId: null,
      run: {
        branchId,
        voidedAt: null,
        businessDate: { gte: from, lte: to },
      },
    },
    select: { id: true, productId: true },
  });
  if (items.length === 0) return new Map();

  const standing = new Set(items.map((i) => i.id));
  const productIds = [...new Set(items.map((i) => i.productId))];

  const replayed = await replayPairsInTx(tx, tenantId, productIds, [branchId], to);

  const out = new Map<string, Prisma.Decimal>();
  for (const productId of productIds) {
    const state = replayed.get(costKeyOf(productId, branchId));
    if (state === undefined) continue;
    let value = ZERO;
    for (const move of state.consumptionMoves) {
      // Rule S5, said at the point of use as well as at the gather: a staff
      // meal is not a sale, and the two must not be able to disagree.
      if (move.sourceType !== "SALES_CONSUMPTION") continue;
      if (!standing.has(move.sourceId)) continue;
      value = value.plus(move.value);
    }
    if (!value.isZero()) out.set(productId, value);
  }
  return out;
}
