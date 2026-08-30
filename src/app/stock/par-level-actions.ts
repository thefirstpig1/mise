"use server";

// ============================================================
// Mise — par level Server Actions (Sprint 3 Part 17 L4, ADR 0017)
// ============================================================
// Colocated with /stock, where the below-par list lives, but kept in its own
// file so Part 10's ledger actions stay untouched. The product page imports the
// same two actions — a par is set from wherever the user already is (Consequence
// 4: a feature nobody can reach from where they work goes unused).
//
// Thin glue: requireTenant → zod → *Logic → Thai error. Two shapes only, because
// a par has only two things you can do to it: say what it is, and stop having
// one. There is no "order it" action, and that absence is the design (Q5).
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  deleteParLevelInputSchema,
  setParLevelInputSchema,
} from "@/lib/validations/par-level";
import {
  ParLevelNotFoundError,
  ParQtyRoundsToZeroError,
  deleteParLevelLogic,
  setParLevelLogic,
} from "@/server/par-level";
import { StockUnitMismatchError } from "@/server/stock-movement";
import { CrossTenantReferenceError } from "@/server/product";

// --- Thai messages (the user-facing error paths) ---
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
const NOT_FOUND_MESSAGE = "ไม่พบการตั้งค่าขั้นต่ำนี้";

export type ParLevelActionState =
  | { ok: true; parLevelId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

function toFormError(e: unknown): ParLevelActionState {
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "product" ? "productId" : e.kind === "branch" ? "branchId" : null;
    return field
      ? { ok: false, fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { ok: false, formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof StockUnitMismatchError) {
    return { ok: false, fieldErrors: { inputUnitId: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof ParQtyRoundsToZeroError) {
    return {
      ok: false,
      fieldErrors: {
        inputQty: `จำนวนน้อยเกินไป — ${e.inputQty.toString()} ปัดเป็น 0 ในหน่วยหลัก`,
      },
    };
  }
  if (e instanceof ParLevelNotFoundError) {
    return { ok: false, formError: NOT_FOUND_MESSAGE };
  }
  throw e;
}

/** `/stock` shows the below-par list; the product page shows the par itself. */
function revalidateParViews(productId: string): void {
  revalidatePath("/stock");
  revalidatePath(`/products/${productId}`);
}

/**
 * Set (or change) the par for one product at one branch.
 *
 * An upsert, not an insert — a par is a current setting, not a document with a
 * history — so the form does not carry an id and the same action serves both
 * "set for the first time" and "change it".
 */
export async function setParLevelAction(
  _prevState: ParLevelActionState,
  formData: FormData
): Promise<ParLevelActionState> {
  const { tenantId } = await requireTenant("stock:write");

  const parsed = setParLevelInputSchema.safeParse({
    productId: formData.get("product_id"),
    branchId: formData.get("branch_id"),
    inputQty: formData.get("input_qty"),
    inputUnitId: formData.get("input_unit_id"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const par = await setParLevelLogic(tenantId, parsed.data);
    revalidateParViews(parsed.data.productId);
    return { ok: true, parLevelId: par.id };
  } catch (e) {
    return toFormError(e);
  }
}

/** Stop having a par. The product drops off the list entirely (Q5). */
export async function deleteParLevelAction(
  _prevState: ParLevelActionState,
  formData: FormData
): Promise<ParLevelActionState> {
  const { tenantId } = await requireTenant("stock:write");

  const parsed = deleteParLevelInputSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const removed = await deleteParLevelLogic(tenantId, parsed.data);
    revalidateParViews(removed.productId);
    return { ok: true, parLevelId: removed.id };
  } catch (e) {
    return toFormError(e);
  }
}
