"use server";

// ============================================================
// Mise — Server Actions behind "จัดการเมนู" (Kong, 2026-10-04)
// ============================================================
// WRITES only. The screen's reads moved to GET /api/menus on 2026-10-04:
// Next runs Server Actions one at a time through the router's queue, which
// serialised the reads and could drop an answer when the URL changed (see that
// route's header).
//
// Writes reuse the existing recipe and menu actions; the one thing added here
// is the yield of a parent + yield product, which no other screen edits alone.
// ============================================================

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import { CrossTenantReferenceError, UnitNeedsRatioError, ensureProductUnitLogic, setPreppedYieldLogic } from "@/server/product";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A parent + yield product's yield — shared by every branch, so shared reach. */
export async function setPreppedYieldAction(
  productId: string,
  yieldPercent: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { tenantId, assertShared } = await requireTenant("master:write");
  assertShared();
  if (!UUID.test(productId)) return { ok: false, error: "ไม่พบของแปรรูปนี้" };
  const done = await setPreppedYieldLogic(tenantId, productId, yieldPercent);
  if (!done) return { ok: false, error: "บันทึกไม่ได้ — % ผลผลิตต้องอยู่ระหว่าง 0.01 ถึง 999.99 และใช้ได้เฉพาะของแปรรูปที่ทำจากสินค้าแม่" };
  revalidatePath("/menus");
  revalidatePath("/products");
  revalidatePath("/cost");
  return { ok: true };
}

/**
 * The unit a recipe line chose, made real on the product (Kong 2026-10-04).
 * A standard measure of the product's dimension needs no number and any recipe
 * writer may add it; a unit the shop defines (1 ใบ = 0.3 กรัม) is a conversion
 * every branch will use, so it needs shared reach like the central recipe.
 */
export async function ensureRecipeUnitAction(input: {
  productId: string;
  unitName: string;
  toBaseRatio?: number | null;
}): Promise<{ ok: true; unit: { id: string; unitName: string; toBaseRatio: number } } | { ok: false; error: string }> {
  const { tenantId, assertShared } = await requireTenant("recipe:write");
  const name = typeof input.unitName === "string" ? input.unitName.trim() : "";
  if (!UUID.test(input.productId) || name === "" || name.length > 40) return { ok: false, error: "ชื่อหน่วยไม่ถูกต้อง" };
  if (input.toBaseRatio != null) {
    if (!(Number(input.toBaseRatio) > 0)) return { ok: false, error: "ตัวเลขต้องมากกว่า 0" };
    assertShared();
  }
  try {
    const unit = await ensureProductUnitLogic(tenantId, { productId: input.productId, unitName: name, toBaseRatio: input.toBaseRatio == null ? null : Number(input.toBaseRatio) });
    revalidatePath("/products");
    return { ok: true, unit };
  } catch (e) {
    if (e instanceof UnitNeedsRatioError) return { ok: false, error: `“${name}” ยังไม่รู้ว่าเท่ากับเท่าไร — ใส่ตัวเลขที่ชั่งหรือตวงจริงก่อน` };
    if (e instanceof CrossTenantReferenceError) return { ok: false, error: "ไม่พบวัตถุดิบนี้" };
    throw e;
  }
}
