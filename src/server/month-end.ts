// ============================================================
// คิดครัว — ปิดเดือน · ส่งให้บัญชี (Kong 2026-10-29)
// ============================================================
// What an accountant needs from a restaurant at the end of a month: what the
// stock was worth at the start and at the end, what was bought, and so what
// the food cost — and, for a shop that runs recipes, how much of that was
// sold, thrown away, eaten by staff or simply not there when counted.
//
// THE RULES (docs/calculation-rules.md ME1–ME6)
// ME1  Opening stock is the ledger replayed to the end of the previous day —
//      under EITHER gross-profit method — so this month's opening is last
//      month's closing to the satang.
// ME2  Purchases are the month's bills on COGS categories (the bills the
//      accountant books), INCLUDING the VAT the shop cannot reclaim: stock
//      carries that VAT (ADR 0016 Q2), so purchases must too or a month with
//      deliveries and no cooking would show a negative cost.
// ME3  Every figure is rounded to the satang FIRST; cost of goods sold and
//      "อื่น ๆ" are then the balancing figures, so what is printed ties.
// ME4  Goods moved between branches are valued at the money frozen on the
//      transfer line, on both legs, so they cancel across the shop exactly.
// ME5  A warning never stops the file — it travels inside it as a note.
// ME6  Branch reach (rule A5): a person sees, and exports, only branches in
//      their reach; the shop total is the sum of those.
// ============================================================

import { Prisma } from "@prisma/client";
import type { GrossProfitMethod, MovementType } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { occurredAtFilter } from "@/server/stock-movement";
import { costSortKey, getMonthEndLedgerLogic } from "@/server/stock-cost";
import { fromSatang, toSatang } from "@/lib/month-end-journal";

const ZERO = new Prisma.Decimal(0);
const baht = (d: Prisma.Decimal | number | null | undefined): number =>
  d === null || d === undefined ? 0 : Number(new Prisma.Decimal(d).toDecimalPlaces(2).toFixed(2));

export type MonthEndBranch = {
  branchId: string;
  branchName: string;
  branchCode: string | null;
  opening: number;
  purchases: number;
  transfersIn: number;
  transfersOut: number;
  closing: number;
  /** opening + purchases + in − out − closing (ME3). */
  cogs: number;
  /** What the posted sales consumed — null when the shop does not run recipes. */
  sold: number | null;
  waste: number;
  staffMeals: number;
  /** Count shortages and other losses with no waste document. */
  shortage: number;
  /** The balancing part: counts that found more, adjustments, reversals. */
  other: number;
  lastCountDate: Date | null;
  unpricedProducts: number;
  negativeStockProducts: number;
  inTransitCount: number;
  inTransitValue: number;
  draftReceipts: number;
};

export type MonthEndStockRow = {
  productName: string;
  unitName: string;
  branchName: string;
  qty: number;
  value: number;
  unpriced: boolean;
};

export type MonthEndBill = {
  billDate: Date;
  billNo: string | null;
  vatInvoiceNo: string | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  branchName: string;
  kind: "วัตถุดิบ" | "ค่าใช้จ่าย" | "วัตถุดิบและค่าใช้จ่าย";
  subtotal: number;
  vat: number;
  wht: number;
  total: number;
  netPayment: number;
  paid: boolean;
};

export type MonthEnd = {
  month: string;
  from: Date;
  to: Date;
  monthEnded: boolean;
  method: GrossProfitMethod;
  vatRegistered: boolean;
  branches: MonthEndBranch[];
  stock: MonthEndStockRow[];
  billCount: number;
  bills: MonthEndBill[];
};

const TRANSFER_TYPES: MovementType[] = ["TRANSFER_OUT", "TRANSFER_IN", "TRANSFER_OUT_REVERSAL", "TRANSFER_IN_REVERSAL"];

/** "2026-09" → the first and last day as DATE values (UTC midnight), the shape every period query here takes. */
export function monthBounds(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 0)) };
}

/** The latest month that has ENDED in Bangkok — what the page opens on. */
export function lastClosedMonth(today: Date = computeBangkokToday()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function getMonthEndLogic(
  tenantId: string,
  month: string,
  reach: BranchReach,
  opts: { withBills?: boolean } = {}
): Promise<MonthEnd | null> {
  const { from, to } = monthBounds(month);
  const bounds = occurredAtFilter(from, to) as { gte: Date; lt: Date };
  const lower = bounds.gte.getTime();
  const upper = bounds.lt.getTime();
  // The ledger's costing instant can sit up to a day either side of the stored
  // one (costSortKey), so movements are fetched wide and cut in memory, exactly
  // as the cost summary cuts its waste and variance.
  const wide = { gte: new Date(lower - 86_400_000), lt: new Date(upper + 86_400_000) };

  const [ledger, facts] = await Promise.all([
    getMonthEndLedgerLogic(tenantId, { from, to }, reach),
    withTenantContext(tenantId, async (tx) => {
      const branches = await tx.branch.findMany({
        where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
        select: { id: true, name: true },
      });
      const branchIds = branches.map((b) => b.id);
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { isVatRegistered: true, grossProfitMethod: true },
      });

      // ME2 — the bills the accountant books, with the VAT the shop cannot reclaim.
      const purchaseLines = await tx.expenseItem.findMany({
        where: {
          tenantId,
          category: { account: "COGS" },
          expense: { tenantId, deletedAt: null, branchId: { in: branchIds }, billDate: { gte: from, lte: to } },
        },
        select: {
          totalPrice: true,
          expense: {
            select: {
              branchId: true,
              subtotalExclVat: true,
              vatAmount: true,
              sourceGr: { select: { vatReclaimable: true } },
            },
          },
        },
      });

      // ME4 — transfer legs, valued at the line's frozen money.
      const transferMoves = await tx.stockMovement.findMany({
        where: { tenantId, branchId: { in: branchIds }, type: { in: TRANSFER_TYPES }, occurredAt: wide },
        select: { branchId: true, type: true, sourceId: true, occurredAt: true },
      });
      const transferItems = transferMoves.length
        ? await tx.stockTransferItem.findMany({
            where: { tenantId, id: { in: [...new Set(transferMoves.map((m) => m.sourceId))] } },
            select: { id: true, costTotal: true },
          })
        : [];

      // Goods on the road when the month closed: counted at the receiver already (ADR 0018 Q1).
      const endBound = bounds.lt;
      const inTransit = await tx.stockTransfer.findMany({
        where: {
          tenantId,
          OR: [{ fromBranchId: { in: branchIds } }, { toBranchId: { in: branchIds } }],
          dispatchedAt: { lt: endBound },
          AND: [
            { OR: [{ receivedAt: null }, { receivedAt: { gte: endBound } }] },
            { OR: [{ voidedAt: null }, { voidedAt: { gte: endBound } }] },
          ],
        },
        select: { toBranchId: true, items: { select: { costTotal: true } } },
      });

      const drafts = await tx.goodsReceipt.groupBy({
        by: ["branchId"],
        where: { tenantId, deletedAt: null, status: "DRAFT", branchId: { in: branchIds }, receivedAt: { lt: endBound } },
        _count: { _all: true },
      });

      const counts = await tx.stockCount.groupBy({
        by: ["branchId"],
        where: { tenantId, status: "CLOSED", branchId: { in: branchIds }, countDate: { lte: to } },
        _max: { countDate: true },
      });

      const products = await tx.product.findMany({
        where: { tenantId },
        select: { id: true, name: true, productUnits: { where: { isBase: true }, select: { unitName: true } } },
      });

      const billWhere = { tenantId, deletedAt: null, branchId: { in: branchIds }, billDate: { gte: from, lte: to } };
      const billCount = await tx.expense.count({ where: billWhere });
      const bills = opts.withBills
        ? await tx.expense.findMany({
            where: billWhere,
            orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
            select: {
              billDate: true,
              billNo: true,
              vatInvoiceNo: true,
              branchId: true,
              subtotalExclVat: true,
              vatAmount: true,
              whtAmount: true,
              totalAmount: true,
              netPaymentAmount: true,
              paymentStatus: true,
              supplier: { select: { nameFull: true, taxId: true } },
              items: { select: { category: { select: { account: true } } } },
            },
          })
        : [];

      return { branches, tenant, purchaseLines, transferMoves, transferItems, inTransit, drafts, counts, products, billCount, bills };
    }),
  ]);
  if (ledger === null) return null;

  const { tenant } = facts;
  const nameOfBranch = new Map(facts.branches.map((b) => [b.id, b.name]));

  // ME2
  const purchases = new Map<string, Prisma.Decimal>();
  for (const line of facts.purchaseLines) {
    const e = line.expense;
    const reclaimable = e.sourceGr ? e.sourceGr.vatReclaimable : tenant.isVatRegistered;
    let value = line.totalPrice;
    if (!reclaimable && e.subtotalExclVat.greaterThan(0) && e.vatAmount.greaterThan(0)) {
      value = value.plus(e.vatAmount.mul(line.totalPrice).div(e.subtotalExclVat));
    }
    purchases.set(e.branchId, (purchases.get(e.branchId) ?? ZERO).plus(value));
  }

  // ME4
  const costOfItem = new Map(facts.transferItems.map((i) => [i.id, i.costTotal]));
  const tIn = new Map<string, Prisma.Decimal>();
  const tOut = new Map<string, Prisma.Decimal>();
  for (const m of facts.transferMoves) {
    const t = costSortKey(m.occurredAt);
    if (t < lower || t >= upper) continue;
    const v = costOfItem.get(m.sourceId) ?? ZERO;
    const add = (map: Map<string, Prisma.Decimal>, amount: Prisma.Decimal) =>
      map.set(m.branchId, (map.get(m.branchId) ?? ZERO).plus(amount));
    if (m.type === "TRANSFER_IN") add(tIn, v);
    else if (m.type === "TRANSFER_IN_REVERSAL") add(tIn, v.negated());
    else if (m.type === "TRANSFER_OUT") add(tOut, v);
    else add(tOut, v.negated());
  }

  // Staff meals, at cost, from the same closing walk the summary used.
  const staffMeals = new Map<string, Prisma.Decimal>();
  for (const [key, state] of ledger.closing) {
    const branchId = key.split("|")[1];
    for (const out of state.outflows) {
      if (out.sourceType !== "STAFF_MEAL") continue;
      const t = costSortKey(out.occurredAt);
      if (t < lower || t >= upper) continue;
      staffMeals.set(branchId, (staffMeals.get(branchId) ?? ZERO).plus(out.value));
    }
  }

  const transit = new Map<string, { count: number; value: Prisma.Decimal }>();
  for (const tr of facts.inTransit) {
    const cur = transit.get(tr.toBranchId) ?? { count: 0, value: ZERO };
    transit.set(tr.toBranchId, {
      count: cur.count + 1,
      value: tr.items.reduce((s, i) => s.plus(i.costTotal), cur.value),
    });
  }
  const draftsBy = new Map(facts.drafts.map((d) => [d.branchId, d._count._all]));
  const countBy = new Map(facts.counts.map((c) => [c.branchId, c._max.countDate]));

  const branches: MonthEndBranch[] = ledger.summaries.map((s) => {
    const opening = baht(s.openingInventoryValue);
    const p = baht(purchases.get(s.branchId));
    const ti = baht(tIn.get(s.branchId));
    const to_ = baht(tOut.get(s.branchId));
    const closing = baht(s.inventoryValue);
    // ME3: integer satang from here on.
    const cogsS = toSatang(opening) + toSatang(p) + toSatang(ti) - toSatang(to_) - toSatang(closing);
    const sold = s.grossProfitMethod === "RECIPE_CONSUMPTION" && s.cogsSold !== null ? baht(s.cogsSold) : null;
    const waste = baht(s.wasteValue);
    const meals = baht(staffMeals.get(s.branchId));
    const shortage = baht(s.varianceValue);
    const otherS = cogsS - toSatang(sold ?? 0) - toSatang(waste) - toSatang(meals) - toSatang(shortage);
    const tr = transit.get(s.branchId);
    return {
      branchId: s.branchId,
      branchName: s.branchName,
      branchCode: s.branchCode,
      opening,
      purchases: p,
      transfersIn: ti,
      transfersOut: to_,
      closing,
      cogs: fromSatang(cogsS),
      sold,
      waste,
      staffMeals: meals,
      shortage,
      other: fromSatang(otherS),
      lastCountDate: countBy.get(s.branchId) ?? null,
      unpricedProducts: s.unpricedProducts,
      negativeStockProducts: s.negativeStockProducts,
      inTransitCount: tr?.count ?? 0,
      inTransitValue: baht(tr?.value),
      draftReceipts: draftsBy.get(s.branchId) ?? 0,
    };
  });

  const productById = new Map(facts.products.map((p) => [p.id, p]));
  const stock: MonthEndStockRow[] = [];
  for (const [key, state] of ledger.closing) {
    const [productId, branchId] = key.split("|");
    const product = productById.get(productId);
    if (!product || !nameOfBranch.has(branchId)) continue;
    if (state.qtyOnHand.isZero() && state.inventoryValue.isZero()) continue;
    stock.push({
      productName: product.name,
      unitName: product.productUnits[0]?.unitName ?? "",
      branchName: nameOfBranch.get(branchId)!,
      qty: Number(state.qtyOnHand.toDecimalPlaces(3).toFixed(3)),
      value: baht(state.inventoryValue),
      unpriced: state.hasUnpricedLayers,
    });
  }
  stock.sort((a, b) => b.value - a.value || a.productName.localeCompare(b.productName, "th"));

  const bills: MonthEndBill[] = facts.bills.map((b) => {
    const accounts = new Set(b.items.map((i) => i.category.account));
    return {
      billDate: b.billDate,
      billNo: b.billNo,
      vatInvoiceNo: b.vatInvoiceNo,
      supplierName: b.supplier?.nameFull ?? null,
      supplierTaxId: b.supplier?.taxId ?? null,
      branchName: nameOfBranch.get(b.branchId) ?? "",
      kind: accounts.size > 1 ? "วัตถุดิบและค่าใช้จ่าย" : accounts.has("COGS") ? "วัตถุดิบ" : "ค่าใช้จ่าย",
      subtotal: baht(b.subtotalExclVat),
      vat: baht(b.vatAmount),
      wht: baht(b.whtAmount),
      total: baht(b.totalAmount),
      netPayment: baht(b.netPaymentAmount),
      paid: b.paymentStatus === "PAID",
    };
  });

  return {
    month,
    from,
    to,
    monthEnded: to.getTime() < computeBangkokToday().getTime(),
    method: tenant.grossProfitMethod,
    vatRegistered: tenant.isVatRegistered,
    branches,
    stock,
    billCount: facts.billCount,
    bills,
  };
}
