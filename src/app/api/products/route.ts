// ============================================================
// Mise — the products screen's reads, as GET (mise-ui-review §5c)
// ============================================================
// what=list&branch=  the per-branch figures beside every product
// what=sheet&id=     the editable part of one product's sheet
// Same gates as the pages: membership to read, the branch asserted against
// reach (rule A5), receipts' money only with the cost ticket.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { getProductListFactsLogic, getProductSheetFormLogic } from "@/server/product-list";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const what = url.searchParams.get("what");
    const { tenantId, costAccess, assertBranch } = await requireTenant("any:member");
    if (what === "list") {
      const branchId = url.searchParams.get("branch") ?? "";
      if (!UUID.test(branchId)) return json({ ok: false, error: "สาขาไม่ถูกต้อง" }, 400);
      assertBranch(branchId);
      return json({ ok: true, list: await getProductListFactsLogic(tenantId, branchId, costAccess) });
    }
    if (what === "sheet") {
      const id = url.searchParams.get("id") ?? "";
      if (!UUID.test(id)) return json({ ok: false, error: "ไม่พบสินค้านี้" }, 400);
      const form = await getProductSheetFormLogic(tenantId, id);
      return form === null ? json({ ok: false, error: "ไม่พบสินค้านี้" }, 404) : json({ ok: true, form });
    }
    return json({ ok: false, error: "unknown read" }, 400);
  });
}
