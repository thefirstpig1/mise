// ============================================================
// Mise — what is already on its way, per product × branch (rule PAR-3)
// ============================================================
// SENT and part-received purchase orders (what is still owed, in base units)
// and purchase-request lines nobody has put on a sent order yet. A draft
// order is not an order (Kong 2026-10-21), so a request cut into a draft
// still counts as a request. Read inside the caller's transaction.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { LATE_DAYS_WITHOUT_DATE, type ParCover } from "@/lib/par-alert";

const DAY = 86_400_000;
export const coverKey = (productId: string, branchId: string) => `${productId}|${branchId}`;

export type CoverDoc = { kind: "PO" | "PR"; id: string; label: string };

export async function parCoverInTx(
  tx: PrismaClient,
  tenantId: string,
  branchIds: string[],
  productIds?: string[]
): Promise<Map<string, ParCover & { docs: CoverDoc[] }>> {
  const out = new Map<string, ParCover & { docs: CoverDoc[] }>();
  if (branchIds.length === 0) return out;
  const today = computeBangkokToday();
  const product = productIds ? { productId: { in: productIds } } : {};
  const [orderLines, requestLines] = await Promise.all([
    tx.purchaseOrderItem.findMany({
      where: { tenantId, ...product, purchaseOrder: { branchId: { in: branchIds }, status: { in: ["SENT", "PARTIALLY_RECEIVED"] }, deletedAt: null } },
      select: {
        productId: true,
        qtyOrdered: true,
        qtyReceived: true,
        toBaseRatio: true,
        purchaseOrder: { select: { id: true, poNumber: true, branchId: true, expectedDeliveryDate: true, sentAt: true } },
      },
    }),
    tx.purchaseRequestLine.findMany({
      where: {
        tenantId,
        ...product,
        branchId: { in: branchIds },
        deletedAt: null,
        rejectedAt: null,
        // Not yet on an order that went out (draft or cancelled orders do not count).
        orderItems: { none: { purchaseOrder: { status: { in: ["SENT", "PARTIALLY_RECEIVED", "RECEIVED"] } } } },
      },
      select: { id: true, productId: true, branchId: true, qty: true, requestedAt: true, unit: { select: { toBaseRatio: true } } },
    }),
  ]);
  const get = (k: string) => {
    let c = out.get(k);
    if (!c) out.set(k, (c = { ordered: 0, requested: 0, lateDays: 0, requestLateDays: 0, docs: [] }));
    return c;
  };
  for (const l of orderLines) {
    const owed = Number(l.qtyOrdered) - Number(l.qtyReceived);
    if (owed <= 0) continue;
    const c = get(coverKey(l.productId, l.purchaseOrder.branchId));
    c.ordered += owed * Number(l.toBaseRatio);
    const due = l.purchaseOrder.expectedDeliveryDate ?? (l.purchaseOrder.sentAt ? addDays(l.purchaseOrder.sentAt, LATE_DAYS_WITHOUT_DATE) : null);
    if (due) c.lateDays = Math.max(c.lateDays, Math.floor((today.getTime() - due.getTime()) / DAY));
    if (!c.docs.some((d) => d.id === l.purchaseOrder.id)) c.docs.push({ kind: "PO", id: l.purchaseOrder.id, label: l.purchaseOrder.poNumber });
  }
  for (const r of requestLines) {
    const c = get(coverKey(r.productId, r.branchId));
    c.requested += Number(r.qty) * Number(r.unit.toBaseRatio);
    const waited = Math.floor((today.getTime() - addDays(r.requestedAt, LATE_DAYS_WITHOUT_DATE).getTime()) / DAY);
    c.requestLateDays = Math.max(c.requestLateDays, waited);
    if (!c.docs.some((d) => d.kind === "PR")) c.docs.push({ kind: "PR", id: r.branchId, label: "ใบขอซื้อ" });
  }
  for (const c of out.values()) c.lateDays = Math.max(0, c.lateDays);
  return out;
}
