// ============================================================
// Mise — the reads behind "จัดการเมนู", as GET (Kong 2026-10-04, "โหลดช้า")
// ============================================================
// These were Server Actions. Next.js runs Server Actions ONE AT A TIME through
// the router's queue — they are built for writes — so the price book (2 s), the
// sheet and the adder's list waited on each other, and a URL change while one
// was queued (the sheet writes `?menu=` into the address) dropped the price
// book's answer altogether: the sheet sat on "กำลังคำนวณ…" for ever.
//
// A GET route handler is an ordinary request: the browser runs them side by
// side and nothing in the router can lose one. Writes stay Server Actions.
//
// Same gates as before: membership for every read, the branch asserted against
// the reader's reach (rule A5), money only with the cost ticket (ADR 0029 Q12),
// the adder's list only for someone who can write a recipe.
// ============================================================

import { requireTenant } from "@/lib/require-tenant";
import { guardRead } from "@/lib/read-api";
import { findDeletedMenuByNameLogic } from "@/server/menu-lifecycle";
import {
  getIngredientInsightLogic,
  getIngredientOptionsLogic,
  getLabDraftCostLogic,
  getMenuPriceBookLogic,
  getMenuSheetLogic,
} from "@/server/menu-manager";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function GET(req: Request) {
  return guardRead(() => read(req));
}

async function read(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const what = url.searchParams.get("what");
  const branchId = url.searchParams.get("branch") ?? "";

  if (what === "options") {
    const { tenantId } = await requireTenant("recipe:write");
    return json({ ok: true, ...(await getIngredientOptionsLogic(tenantId)) });
  }

  if (what === "deleted-menu") {
    // ทดลองเมนู: is there a deleted dish by exactly this name to bring back?
    const { tenantId } = await requireTenant("master:write");
    const name = (url.searchParams.get("name") ?? "").trim();
    return json({ ok: true, found: name === "" ? null : await findDeletedMenuByNameLogic(tenantId, name) });
  }

  if (what === "lab") {
    // A saved draft, costed by the engine — the figure the lab trusts.
    const { tenantId, costAccess, reach, assertBranch } = await requireTenant("recipe:write");
    const recipeId = url.searchParams.get("recipe") ?? "";
    if (!UUID.test(branchId) || !UUID.test(recipeId)) return json({ ok: false, error: "คำขอไม่ถูกต้อง" }, 400);
    assertBranch(branchId);
    if (costAccess === null) return json({ ok: true, cost: null });
    const cost = await getLabDraftCostLogic(tenantId, { recipeId, branchId }, reach);
    return cost === null ? json({ ok: false, error: "ไม่พบร่างนี้" }, 404) : json({ ok: true, cost });
  }

  const { tenantId, costAccess, assertBranch } = await requireTenant("any:member");
  if (!UUID.test(branchId)) return json({ ok: false, error: "สาขาไม่ถูกต้อง" }, 400);
  assertBranch(branchId);

  if (what === "book") {
    return json({ ok: true, book: await getMenuPriceBookLogic(tenantId, branchId, costAccess) });
  }
  if (what === "sheet") {
    const menuId = url.searchParams.get("menu") ?? "";
    if (!UUID.test(menuId)) return json({ ok: false, error: "ไม่พบเมนูนี้" }, 400);
    return json({ ok: true, sheet: await getMenuSheetLogic(tenantId, { menuId, branchId }) });
  }
  if (what === "ingredient") {
    const productId = url.searchParams.get("product") ?? "";
    if (!UUID.test(productId)) return json({ ok: false, error: "ไม่พบวัตถุดิบนี้" }, 400);
    const insight = await getIngredientInsightLogic(tenantId, { productId, branchId }, costAccess);
    return insight === null ? json({ ok: false, error: "ไม่พบวัตถุดิบนี้" }, 404) : json({ ok: true, insight });
  }
  return json({ ok: false, error: "unknown read" }, 400);
}
