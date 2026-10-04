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
import { setPreppedYieldLogic } from "@/server/product";

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
