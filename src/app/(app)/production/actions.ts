"use server";

// ADR 0040 step 7 — the production screens' writes.
// Thin glue: requireTenant → zod → *Logic → Thai error. No rule lives here.

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import { getDocumentBranchLogic } from "@/server/document-branch";
import { createProductionInputSchema, voidProductionInputSchema } from "@/lib/validations/production";
import { saveTrimRecipeInputSchema } from "@/lib/validations/trim-recipe";
import {
  ProductionAlreadyVoidedError,
  ProductionLoopError,
  ProductionNotFoundError,
  ProductionOutputNotPreppedError,
  ProductionRecipeMismatchError,
  TrimRecipeMismatchError,
  recordProductionLogic,
  voidProductionAndRepostLogic,
  type RepostedDay,
} from "@/server/production";
import {
  TrimPartNotPreppedError,
  TrimPartTakenError,
  TrimRecipeNotFoundError,
  deleteTrimRecipeLogic,
  saveTrimRecipeLogic,
} from "@/server/trim-recipe";
import { QtyRoundsToZeroError, StockUnitMismatchError } from "@/server/stock-movement";
import { CrossTenantReferenceError } from "@/server/product";

export type ProductionActionResult =
  | { ok: true; pdNumber: string; reposted: { date: string; outcome: RepostedDay["outcome"] }[] }
  | { ok: false; formError: string };

export type SimpleResult = { ok: true } | { ok: false; formError: string };

const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";

function productionError(e: unknown): string | null {
  if (e instanceof ProductionOutputNotPreppedError) return "ของที่ได้ต้องเป็นของแปรรูป — วัตถุดิบดิบซื้อมา ไม่ได้ผลิต";
  if (e instanceof ProductionLoopError) return "บันทึกไม่ได้ — ของที่ได้เคยถูกใช้ทำวัตถุดิบตัวนี้มาก่อน จะกลายเป็นวงวน";
  if (e instanceof ProductionRecipeMismatchError) return "สูตรที่เลือกไม่ได้ทำของนี้";
  if (e instanceof TrimRecipeMismatchError) return "ของที่เลือกไม่ตรงกับสูตรตัดแต่ง";
  if (e instanceof StockUnitMismatchError) return "หน่วยที่เลือกไม่ใช่หน่วยของสินค้านี้";
  if (e instanceof QtyRoundsToZeroError) return "จำนวนน้อยเกินไปจนปัดเป็น 0";
  if (e instanceof CrossTenantReferenceError) return "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
  return null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Record a production or a trim, then re-post the sales days it changes (Q5). */
export async function recordProductionAction(input: unknown): Promise<ProductionActionResult> {
  const { tenantId, membership, assertBranch } = await requireTenant("stock:write");
  const parsed = createProductionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: firstIssue(parsed.error) };
  assertBranch(parsed.data.branchId);
  try {
    const { production, reposted } = await recordProductionLogic(tenantId, parsed.data, membership.userId);
    revalidatePath("/production");
    return {
      ok: true,
      pdNumber: production.pdNumber,
      reposted: reposted.map((r) => ({ date: day(r.businessDate), outcome: r.outcome })),
    };
  } catch (e) {
    const msg = productionError(e);
    if (msg) return { ok: false, formError: msg };
    console.error("[production] record failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ — กรุณาลองอีกครั้ง" };
  }
}

/** Void a production (never delete), then re-post the days that used it (Q5). */
export async function voidProductionAction(input: unknown): Promise<ProductionActionResult> {
  const { tenantId, membership, assertBranch } = await requireTenant("stock:write");
  const parsed = voidProductionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: firstIssue(parsed.error) };
  const branchId = await getDocumentBranchLogic(tenantId, "production", parsed.data.id);
  if (!branchId) return { ok: false, formError: "ไม่พบใบผลิตนี้" };
  assertBranch(branchId);
  try {
    const { production, reposted } = await voidProductionAndRepostLogic(tenantId, parsed.data, membership.userId);
    revalidatePath("/production");
    return {
      ok: true,
      pdNumber: production.pdNumber,
      reposted: reposted.map((r) => ({ date: day(r.businessDate), outcome: r.outcome })),
    };
  } catch (e) {
    if (e instanceof ProductionAlreadyVoidedError) return { ok: false, formError: "ใบผลิตนี้ถูกยกเลิกไปแล้ว" };
    if (e instanceof ProductionNotFoundError) return { ok: false, formError: "ไม่พบใบผลิตนี้" };
    console.error("[production] void failed", e);
    return { ok: false, formError: "ยกเลิกไม่สำเร็จ — กรุณาลองอีกครั้ง" };
  }
}

/**
 * Save a trim recipe. It is used by every branch, so it needs what a central
 * recipe needs: `recipe:write` and reach over every branch (Kong 2026-10-04).
 */
export async function saveTrimRecipeAction(input: unknown): Promise<SimpleResult> {
  const { tenantId, canEditShared } = await requireTenant("recipe:write");
  if (!canEditShared) return { ok: false, formError: "สูตรตัดแต่งใช้ทุกสาขา — แก้ได้เฉพาะคนที่ดูแลทุกสาขา" };
  const parsed = saveTrimRecipeInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, formError: firstIssue(parsed.error) };
  try {
    await saveTrimRecipeLogic(tenantId, parsed.data);
    revalidatePath("/products");
    revalidatePath("/production");
    return { ok: true };
  } catch (e) {
    if (e instanceof TrimPartNotPreppedError) return { ok: false, formError: "ส่วนที่ได้ต้องเป็นของแปรรูป — เพิ่มเป็นของแปรรูปก่อน" };
    if (e instanceof TrimPartTakenError) {
      return {
        ok: false,
        formError:
          e.by === "TRIM"
            ? `${e.productName} อยู่ในสูตรตัดแต่งอื่นแล้ว — ของหนึ่งอย่างได้มาทางเดียว`
            : `${e.productName} มีวิธีทำอยู่แล้ว (${e.by === "RECIPE" ? "สูตรผลิต" : "ทำจากของตัวเดียว"}) — ของหนึ่งอย่างได้มาทางเดียว`,
      };
    }
    if (e instanceof TrimRecipeNotFoundError) return { ok: false, formError: "สูตรตัดแต่งนี้ถูกลบไปแล้ว" };
    if (e instanceof CrossTenantReferenceError) return { ok: false, formError: "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ" };
    console.error("[production] save trim recipe failed", e);
    return { ok: false, formError: "บันทึกไม่สำเร็จ — กรุณาลองอีกครั้ง" };
  }
}

export async function deleteTrimRecipeAction(id: string): Promise<SimpleResult> {
  const { tenantId, canEditShared } = await requireTenant("recipe:write");
  if (!canEditShared) return { ok: false, formError: "สูตรตัดแต่งใช้ทุกสาขา — ลบได้เฉพาะคนที่ดูแลทุกสาขา" };
  try {
    await deleteTrimRecipeLogic(tenantId, String(id));
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    if (e instanceof TrimRecipeNotFoundError) return { ok: false, formError: "สูตรตัดแต่งนี้ถูกลบไปแล้ว" };
    console.error("[production] delete trim recipe failed", e);
    return { ok: false, formError: "ลบไม่สำเร็จ — กรุณาลองอีกครั้ง" };
  }
}
