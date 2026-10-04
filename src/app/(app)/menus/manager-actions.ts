"use server";

// ============================================================
// Mise — Server Actions behind "จัดการเมนู" (Kong, 2026-10-04)
// ============================================================
// Reads that run when the person opens something, never with the page: a sheet
// costs one recipe walk and one ledger read, the adder's price list one FIFO
// replay over every product — work nobody should pay for by merely landing on
// the list (mise-ui-review §5b).
//
// Every read takes the branch from the CLIENT and asserts it — a branch id from
// a request is never trusted (rule A5). Every money field arrives null without
// the reader's ticket (ADR 0029 Q12).
//
// Writes reuse the existing recipe and menu actions; the one thing added here
// is the yield of a parent + yield product, which no other screen edits alone.
// ============================================================

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import {
  getIngredientInsightLogic,
  getIngredientOptionsLogic,
  getMenuSheetLogic,
  type IngredientInsight,
  type IngredientOption,
  type MenuSheet,
} from "@/server/menu-manager";
import { setPreppedYieldLogic } from "@/server/product";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getMenuSheetAction(
  menuId: string,
  branchId: string
): Promise<{ ok: true; sheet: MenuSheet } | { ok: false; error: string }> {
  const { tenantId, costAccess, assertBranch } = await requireTenant("any:member");
  if (!UUID.test(menuId) || !UUID.test(branchId)) return { ok: false, error: "ไม่พบเมนูนี้" };
  assertBranch(branchId);
  return { ok: true, sheet: await getMenuSheetLogic(tenantId, { menuId, branchId }, costAccess) };
}

export async function getIngredientOptionsAction(
  branchId: string
): Promise<{ ok: true; options: IngredientOption[] } | { ok: false; error: string }> {
  const { tenantId, costAccess, assertBranch } = await requireTenant("recipe:write");
  if (!UUID.test(branchId)) return { ok: false, error: "สาขาไม่ถูกต้อง" };
  assertBranch(branchId);
  return { ok: true, options: await getIngredientOptionsLogic(tenantId, branchId, costAccess) };
}

export async function getIngredientInsightAction(
  productId: string,
  branchId: string
): Promise<{ ok: true; insight: IngredientInsight } | { ok: false; error: string }> {
  const { tenantId, costAccess, assertBranch } = await requireTenant("any:member");
  if (!UUID.test(productId) || !UUID.test(branchId)) return { ok: false, error: "ไม่พบวัตถุดิบนี้" };
  assertBranch(branchId);
  const insight = await getIngredientInsightLogic(tenantId, { productId, branchId }, costAccess);
  return insight === null ? { ok: false, error: "ไม่พบวัตถุดิบนี้" } : { ok: true, insight };
}

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
