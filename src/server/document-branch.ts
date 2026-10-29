// ============================================================
// Mise — which branch a document belongs to (rule A5, 2026-10-29)
// ============================================================
// A by-id write (send an order, confirm a receipt, void a bill…) used to check
// the CAPABILITY and never the BRANCH: a person with reach to one branch could
// act on another branch's documents by id. Every create/update already asserted
// the branch it was GIVEN; nothing asserted the branch the document already
// had. The action now reads that here and asserts it before the write.
//
// One small read, only on the rare by-id actions. The per-row hot path — the
// count sheet's ยืนยัน — checks reach inside its own query instead
// (stock-count.ts `inReach`), so it pays nothing.
//
// `null` means "no such document here": the write's own logic then answers
// with its usual not-found, in its usual words.
// ============================================================

import { withTenantContext } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BranchedDocument = "purchaseOrder" | "goodsReceipt" | "expense" | "recurringExpense" | "wasteLog" | "production";

export async function getDocumentBranchLogic(
  tenantId: string,
  kind: BranchedDocument,
  id: string
): Promise<string | null> {
  if (!UUID.test(id)) return null;
  return withTenantContext(tenantId, async (tx) => {
    const args = { where: { id, tenantId }, select: { branchId: true } } as const;
    const row =
      kind === "purchaseOrder"
        ? await tx.purchaseOrder.findFirst(args)
        : kind === "goodsReceipt"
          ? await tx.goodsReceipt.findFirst(args)
          : kind === "expense"
            ? await tx.expense.findFirst(args)
            : kind === "recurringExpense"
              ? await tx.recurringExpense.findFirst(args)
              : kind === "production"
                ? await tx.production.findFirst(args)
                : await tx.wasteLog.findFirst(args);
    return row?.branchId ?? null;
  });
}

/** A transfer has two branches; who may act depends on which side they are on. */
export async function getTransferBranchesLogic(
  tenantId: string,
  id: string
): Promise<{ fromBranchId: string; toBranchId: string } | null> {
  if (!UUID.test(id)) return null;
  return withTenantContext(tenantId, (tx) =>
    tx.stockTransfer.findFirst({
      where: { id, tenantId },
      select: { fromBranchId: true, toBranchId: true },
    })
  );
}
