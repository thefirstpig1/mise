// ============================================================
// Mise — the production screens' reads, as GET (mise-ui-review §5c)
// ============================================================
// what=form&q={productId,branchId}   fill a production from its recipe   stock:write
// what=trim&q={parentId,branchId}    a whole thing's trim recipes         any member
// what=info&q={productId,branchId}   the product sheet's production box   any member
// Money only for a reader with cost:view; a branch only within reach (A5).
// ============================================================

import { z } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { computeBangkokToday } from "@/lib/bangkok-date";
import {
  getProductProductionInfoLogic,
  getProductionFormLogic,
  getTrimFormLogic,
} from "@/server/production-read";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const bad = () => json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);

const productAt = z.object({ productId: z.string().uuid(), branchId: z.string().uuid() });
const parentAt = z.object({ parentId: z.string().uuid(), branchId: z.string().uuid().nullable() });

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const what = url.searchParams.get("what");
    const input = readInput(url);

    if (what === "form") {
      const q = productAt.safeParse(input);
      if (!q.success) return bad();
      const { tenantId, costAccess, assertBranch } = await requireTenant("stock:write");
      assertBranch(q.data.branchId);
      const form = await getProductionFormLogic(tenantId, {
        ...q.data,
        today: computeBangkokToday(),
        withCost: costAccess !== null,
      });
      return form ? json({ ok: true, form }) : json({ ok: false, formError: "ไม่พบสินค้านี้" }, 404);
    }

    if (what === "trim") {
      const q = parentAt.safeParse(input);
      if (!q.success) return bad();
      const { tenantId, costAccess, assertBranch } = await requireTenant("any:member");
      if (q.data.branchId) assertBranch(q.data.branchId);
      const form = await getTrimFormLogic(tenantId, { ...q.data, withCost: costAccess !== null });
      return form ? json({ ok: true, form }) : json({ ok: false, formError: "ไม่พบสินค้านี้" }, 404);
    }

    if (what === "info") {
      const q = productAt.safeParse(input);
      if (!q.success) return bad();
      const { tenantId, assertBranch } = await requireTenant("any:member");
      assertBranch(q.data.branchId);
      const info = await getProductProductionInfoLogic(tenantId, { ...q.data, today: computeBangkokToday() });
      return info ? json({ ok: true, info }) : json({ ok: false, formError: "ไม่พบสินค้านี้" }, 404);
    }

    return bad();
  });
}
