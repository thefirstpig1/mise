// ============================================================
// Mise — รับสินค้า's read, as GET (mise-ui-review §5c)
// ============================================================
// what=po&q="purchaseOrderId"  the order a receipt is about to be written
// against, for the form's prefill. This was getReceivablePurchaseOrderAction,
// handed to the form as a prop. A DRAFT / CANCELLED order comes back with
// `receivable: false` rather than an error — the form says why. The order's
// branch is now checked against reach too (rule A5).
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { RECEIVABLE_PO_STATUSES } from "@/lib/validations/goods-receipt";
import { getReceivablePurchaseOrderLogic } from "@/server/goods-receipt";
import { toReceivablePurchaseOrderView } from "@/app/(app)/goods-receipts/_components/goods-receipt-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    if (url.searchParams.get("what") !== "po") return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const { tenantId, assertBranch } = await requireTenant("receive:write");
    const id = String(readInput(url) ?? "");
    if (!UUID.test(id)) return json({ ok: false, formError: "ไม่พบใบสั่งซื้อนี้" });
    const po = await getReceivablePurchaseOrderLogic(tenantId, id);
    if (!po) return json({ ok: true, data: null });
    assertBranch(po.branchId);
    return json({ ok: true, data: toReceivablePurchaseOrderView(po, RECEIVABLE_PO_STATUSES.includes(po.status as never)) });
  });
}
