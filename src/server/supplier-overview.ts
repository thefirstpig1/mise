// ============================================================
// Mise — what a supplier page answers (review 2026-10-27, mockup 5sMMvLFbYSjsXDVpZirBXM)
// ============================================================
// The page used to open on an edit form and say "ยังไม่มีประวัติราคา" for a
// supplier with fifteen receipts, because price history read only the price
// list. What an owner asks of a supplier is answered from the documents:
//   * how much do we owe them        — unpaid bills (expense)
//   * what is still on its way       — sent orders not fully received
//   * how much do we buy             — receipts per month
//   * do they deliver on time        — receipt date vs the promised date
//   * what do we buy, at what price  — the latest two prices actually PAID
// Every figure is narrowed to the reader's branch reach (rule A5). The page
// decides which of them a reader may SEE (cost:view / expense:view).
// ============================================================

import { withTenantContext } from "@/lib/db";
import type { BranchReach } from "@/lib/permissions/service";

const inReach = (reach: BranchReach) =>
  reach.allBranches ? {} : { branchId: { in: [...reach.allowedBranchIds] } };

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type SupplierOverview = {
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  receiptCount: number;
  unpaid: { total: number; count: number; oldestBillDate: string | null };
  openOrders: { id: string; poNumber: string; branchName: string; total: number; expectedDate: string | null }[];
  draftCount: number;
  /** Receipts by month (YYYY-MM), newest first — at most the last two months that had any. */
  spendByMonth: { period: string; total: number }[];
  /** On-time share of receipts that came from an order with a promised date; null = none to judge. */
  onTime: { onTime: number; judged: number } | null;
  /** What is bought here, one row per product × the unit it arrives in. */
  items: {
    productId: string;
    productName: string;
    imageUrl: string | null;
    unitName: string;
    lastPrice: number;
    lastAt: string;
    prevPrice: number | null;
    prevAt: string | null;
    times: number;
  }[];
  recent: { kind: "PO" | "GR"; id: string; number: string; at: string; branchName: string; status: string; viaOrder: boolean }[];
};

export async function getSupplierOverviewLogic(
  tenantId: string,
  supplierId: string,
  reach: BranchReach
): Promise<SupplierOverview> {
  return withTenantContext(tenantId, async (tx) => {
    const [receipts, lines, bills, orders] = await Promise.all([
      tx.goodsReceipt.findMany({
        where: { tenantId, supplierId, status: { not: "DRAFT" }, deletedAt: null, ...inReach(reach) },
        select: {
          id: true,
          grNumber: true,
          status: true,
          receivedAt: true,
          branch: { select: { name: true } },
          purchaseOrder: { select: { expectedDeliveryDate: true } },
        },
        orderBy: { receivedAt: "desc" },
      }),
      tx.goodsReceiptItem.findMany({
        where: {
          tenantId,
          reversalOfItemId: null,
          qtyReceivedActual: { gt: 0 },
          goodsReceipt: { supplierId, status: "CONFIRMED", deletedAt: null, ...inReach(reach) },
        },
        select: {
          productId: true,
          receivedUnitName: true,
          unitPriceActual: true,
          lineTotalActual: true,
          product: { select: { name: true, imageUrl: true } },
          goodsReceipt: { select: { receivedAt: true } },
        },
        orderBy: { goodsReceipt: { receivedAt: "desc" } },
      }),
      tx.expense.findMany({
        where: { tenantId, supplierId, deletedAt: null, paymentStatus: "UNPAID", ...inReach(reach) },
        select: { netPaymentAmount: true, billDate: true },
        orderBy: { billDate: "asc" },
      }),
      tx.purchaseOrder.findMany({
        where: { tenantId, supplierId, ...inReach(reach), status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } },
        select: {
          id: true,
          poNumber: true,
          status: true,
          totalAmount: true,
          expectedDeliveryDate: true,
          createdAt: true,
          branch: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // --- what is bought, at what price (the latest two PAID) ---
    const byItem = new Map<string, SupplierOverview["items"][number]>();
    for (const l of lines) {
      const key = `${l.productId}|${l.receivedUnitName}`;
      const at = iso(l.goodsReceipt.receivedAt);
      const price = Number(l.unitPriceActual);
      const row = byItem.get(key);
      if (!row) {
        byItem.set(key, {
          productId: l.productId,
          productName: l.product.name,
          imageUrl: l.product.imageUrl,
          unitName: l.receivedUnitName,
          lastPrice: price,
          lastAt: at,
          prevPrice: null,
          prevAt: null,
          times: 1,
        });
      } else {
        row.times += 1;
        // The previous PURCHASE, not another line of the same receipt.
        if (row.prevPrice === null && at < row.lastAt) {
          row.prevPrice = price;
          row.prevAt = at;
        }
      }
    }

    // --- spend by month ---
    const months = new Map<string, number>();
    for (const l of lines) {
      const k = iso(l.goodsReceipt.receivedAt).slice(0, 7);
      months.set(k, (months.get(k) ?? 0) + Number(l.lineTotalActual));
    }

    // --- on time: only receipts that answer to a promised date ---
    let judged = 0;
    let onTime = 0;
    for (const r of receipts) {
      const due = r.purchaseOrder?.expectedDeliveryDate;
      if (!due || r.status !== "CONFIRMED") continue;
      judged += 1;
      if (iso(r.receivedAt) <= iso(due)) onTime += 1;
    }

    const confirmed = receipts.filter((r) => r.status === "CONFIRMED");
    const open = orders.filter((o) => o.status !== "DRAFT");
    const recent: SupplierOverview["recent"] = [
      ...orders.map((o) => ({
        kind: "PO" as const,
        id: o.id,
        number: o.poNumber,
        at: o.createdAt.toISOString(),
        branchName: o.branch.name,
        status: o.status,
        viaOrder: true,
      })),
      ...receipts.slice(0, 5).map((r) => ({
        kind: "GR" as const,
        id: r.id,
        number: r.grNumber,
        at: r.receivedAt.toISOString(),
        branchName: r.branch.name,
        status: r.status,
        viaOrder: r.purchaseOrder !== null,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 5);

    return {
      firstReceivedAt: confirmed.length ? iso(confirmed[confirmed.length - 1].receivedAt) : null,
      lastReceivedAt: confirmed.length ? iso(confirmed[0].receivedAt) : null,
      receiptCount: confirmed.length,
      unpaid: {
        total: bills.reduce((n, b) => n + Number(b.netPaymentAmount), 0),
        count: bills.length,
        oldestBillDate: bills.length ? iso(bills[0].billDate) : null,
      },
      openOrders: open.map((o) => ({
        id: o.id,
        poNumber: o.poNumber,
        branchName: o.branch.name,
        total: Number(o.totalAmount),
        expectedDate: o.expectedDeliveryDate ? iso(o.expectedDeliveryDate) : null,
      })),
      draftCount: orders.length - open.length,
      spendByMonth: [...months.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .slice(0, 2)
        .map(([period, total]) => ({ period, total })),
      onTime: judged ? { onTime, judged } : null,
      items: [...byItem.values()].sort((a, b) => a.productName.localeCompare(b.productName, "th")),
      recent,
    };
  });
}
