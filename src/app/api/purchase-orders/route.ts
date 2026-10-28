// ============================================================
// Mise — ใบสั่งซื้อ's reads, as GET (mise-ui-review §5c)
// ============================================================
// what=price&q={productId,supplierId,branchId}  today's price, the form's
//   autofill — `data: null` is not an error. When the supplier has no price
//   list, `last` carries what we last paid them (Kong 2026-10-29); with
//   neither, it is the hand-typed path (Q5)
// what=carries&q={supplierId,branchId}  which products this supplier carries
//   at this branch (Kong 2026-09-29: "ไม่อยากให้เกิดเหตุการณ์กดซัพมั่วแล้วสั่งของที่ซัพไม่มี")
// These were resolveSupplierPriceAction / getSupplierCarriesAction, handed to
// the form as props. Gate: purchase:write, the branch within reach (rule A5 —
// the price read had not checked it).
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead, readInput } from "@/lib/read-api";
import { getLastPaidPriceLogic, getSupplierCatalogLogic, resolveSupplierPriceLogic } from "@/server/purchase-order";
import { toLastPaidView, toResolvedPriceView } from "@/app/(app)/purchase-orders/_components/purchase-order-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const uuidOf = (q: unknown, key: string): string | null => {
  const v = q && typeof q === "object" ? (q as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && UUID.test(v) ? v : null;
};

export function GET(req: Request) {
  return guardRead(async () => {
    const url = new URL(req.url);
    const what = url.searchParams.get("what");
    if (what !== "price" && what !== "carries") return json({ ok: false, formError: "คำขอไม่ถูกต้อง" }, 400);
    const { tenantId, assertBranch } = await requireTenant("purchase:write");
    const q = readInput(url);
    const supplierId = uuidOf(q, "supplierId");
    const branchId = uuidOf(q, "branchId");
    if (!supplierId || !branchId) return json({ ok: false, formError: "ข้อมูลไม่ครบ" });
    assertBranch(branchId);

    if (what === "carries") {
      const items = await getSupplierCatalogLogic(tenantId, supplierId, branchId);
      return json({ ok: true, productIds: items.map((i) => i.productId) });
    }
    const productId = uuidOf(q, "productId");
    if (!productId) return json({ ok: false, formError: "ข้อมูลไม่ครบสำหรับค้นหาราคา" });
    const resolved = await resolveSupplierPriceLogic(tenantId, productId, supplierId, branchId);
    if (resolved) return json({ ok: true, data: toResolvedPriceView(resolved), last: null });
    const last = await getLastPaidPriceLogic(tenantId, productId, supplierId, branchId);
    return json({ ok: true, data: null, last: last ? toLastPaidView(last, branchId) : null });
  });
}
