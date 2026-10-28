// ============================================================
// Mise — the products screen's reads, as GET (mise-ui-review §5c)
// ============================================================
// what=list&branch=  the per-branch figures beside every product
// what=sheet&id=     the editable part of one product's sheet
// what=moves&id=&branch=  one product's last ledger rows at a branch (B6)
// what=newform       the "+ เพิ่มสินค้า" sheet's choices (master:write)
// what=restorable&q="term"  deleted products like this name (master:write, ADR 0010)
// what=orphans&q="id"  a deleted product's open price rows, for the restore dialog
// Same gates as the pages: membership to read, the branch asserted against
// reach (rule A5), receipts' money only with the cost ticket.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { fuzzySearchInputSchema } from "@/lib/validations/product-restore";
import { fuzzySearchSoftDeletedProductsLogic, getOrphanMappingsForProductLogic } from "@/server/product-restore";
import { toOrphanMappingRow } from "@/app/(app)/products/_components/restore-view";
import { getNewProductFormLogic, getParDocsLogic, getProductListFactsLogic, getProductSheetFormLogic, getRecentMovementsLogic } from "@/server/product-list";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const what = url.searchParams.get("what");
    if (what === "restorable" || what === "orphans") {
      // The restore flow (ADR 0010) — these two were Server Actions (§5c).
      const { tenantId } = await requireTenant("master:write");
      if (what === "restorable") {
        const parsed = fuzzySearchInputSchema.safeParse({ searchTerm: readInput(url) });
        return json({ ok: true, candidates: parsed.success ? await fuzzySearchSoftDeletedProductsLogic(tenantId, parsed.data.searchTerm) : [] });
      }
      const id = String(readInput(url) ?? "");
      if (!UUID.test(id)) return json({ ok: false, formError: "ไม่พบสินค้านี้" }, 400);
      return json({ ok: true, rows: (await getOrphanMappingsForProductLogic(tenantId, id)).map(toOrphanMappingRow) });
    }
    if (what === "newform") {
      const { tenantId } = await requireTenant("master:write");
      return json({ ok: true, form: await getNewProductFormLogic(tenantId) });
    }
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
    if (what === "docs") {
      // The orders and requests behind one product's par state (rule PAR-3).
      const branchId = url.searchParams.get("branch") ?? "";
      const productId = url.searchParams.get("product") ?? "";
      if (!UUID.test(branchId) || !UUID.test(productId)) return json({ ok: false, error: "คำขอไม่ถูกต้อง" }, 400);
      assertBranch(branchId);
      return json({ ok: true, docs: await getParDocsLogic(tenantId, { productId, branchId }) });
    }
    if (what === "moves") {
      const branchId = url.searchParams.get("branch") ?? "";
      const productId = url.searchParams.get("id") ?? "";
      if (!UUID.test(branchId) || !UUID.test(productId)) return json({ ok: false, error: "คำขอไม่ถูกต้อง" }, 400);
      assertBranch(branchId);
      return json({ ok: true, moves: await getRecentMovementsLogic(tenantId, productId, branchId) });
    }
    return json({ ok: false, error: "คำขอไม่ถูกต้อง" }, 400);
  });
}
