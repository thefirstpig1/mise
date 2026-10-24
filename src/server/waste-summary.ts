// ============================================================
// Mise — waste in baht and quantity, by month / department / type (D2)
// ============================================================
// Kong 2026-10-24 (duplication review D2): "ให้ดูได้ทั้งเป็นบาทและจำนวน แล้วก็
// แยกรายเดือน แล้วก็แยกแผนก และประเภทวัตถุดิบ". /waste showed rows in each
// product's own unit and sent the reader to /cost for money.
//
// One row per waste entry that still stands (not voided, not a reversal), each
// with its BAHT read from the FIFO walk — the same `replayPairsInTx` that gives
// /cost its ของเสีย column, so the two can never be two implementations of one
// rule (rule WS-VALUE). Grouping is the client's job: every view is a fold of
// the same rows.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { replayPairsInTx } from "@/server/stock-cost";

export const WASTE_SUMMARY_MONTHS = 6;
const BKK_MS = 7 * 3_600_000;

export type WasteSummaryRow = {
  id: string;
  /** Bangkok calendar month, `yyyy-mm`. */
  month: string;
  departmentId: string | null;
  productId: string;
  productName: string;
  /** Category group (ประเภทวัตถุดิบ); null = uncategorised. */
  group: string | null;
  /** Base-unit magnitude. */
  qty: number;
  unit: string;
  /** FIFO value; null when the walk could not price it (no cost known). */
  value: number | null;
};

export type WasteSummary = {
  months: string[];
  departments: { id: string; name: string }[];
  rows: WasteSummaryRow[];
};

export function summaryMonths(today: Date, n = WASTE_SUMMARY_MONTHS): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export async function getWasteSummaryLogic(tenantId: string, branchIds: string[]): Promise<WasteSummary> {
  const months = summaryMonths(computeBangkokToday());
  if (branchIds.length === 0) return { months, departments: [], rows: [] };
  const from = new Date(new Date(`${months[0]}-01T00:00:00Z`).getTime() - BKK_MS);

  return withTenantContext(tenantId, async (tx) => {
    const [logs, departments] = await Promise.all([
      tx.wasteLog.findMany({
        where: { tenantId, branchId: { in: branchIds }, reversalOfId: null, voidedAt: null, occurredAt: { gte: from } },
        select: {
          id: true,
          branchId: true,
          productId: true,
          occurredAt: true,
          departmentId: true,
          product: {
            select: {
              name: true,
              category: { select: { groupName: true } },
              productUnits: { where: { isBase: true }, select: { unitName: true }, take: 1 },
            },
          },
        },
      }),
      tx.department.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ displayOrder: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
        select: { id: true, name: true },
      }),
    ]);
    if (logs.length === 0) return { months, departments, rows: [] };

    const movements = await tx.stockMovement.findMany({
      where: { tenantId, sourceType: "WASTE_LOG", sourceId: { in: logs.map((l) => l.id) } },
      select: { id: true, sourceId: true, qty: true },
    });
    const movementOf = new Map(movements.map((m) => [m.sourceId, m]));

    const productIds = [...new Set(logs.map((l) => l.productId))];
    const branches = [...new Set(logs.map((l) => l.branchId))];
    const replayed = await replayPairsInTx(tx, tenantId, productIds, branches);
    const valueOfMovement = new Map<string, Prisma.Decimal>();
    for (const cost of replayed.values()) {
      for (const out of cost.outflows) if (out.sourceType === "WASTE_LOG") valueOfMovement.set(out.movementId, out.value);
    }

    const rows: WasteSummaryRow[] = logs.map((l) => {
      const m = movementOf.get(l.id);
      const v = m ? valueOfMovement.get(m.id) : undefined;
      return {
        id: l.id,
        month: new Date(l.occurredAt.getTime() + BKK_MS).toISOString().slice(0, 7),
        departmentId: l.departmentId,
        productId: l.productId,
        productName: l.product.name,
        group: l.product.category?.groupName ?? null,
        qty: m ? Math.abs(Number(m.qty.toString())) : 0,
        unit: l.product.productUnits[0]?.unitName ?? "",
        value: v === undefined ? null : Number(v.toString()),
      };
    });
    return { months, departments, rows };
  });
}
