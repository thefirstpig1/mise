"use server";

// ============================================================
// Mise — waste Server Actions (Sprint 3 Part 17 L4, ADR 0017)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// Two things specific to this slice:
//
//   * **`submit_key` is READ from the form, never minted here** (the rule
//     goods-receipts/ and stock/ already follow). A server-minted key is a fresh
//     key on every retry, which is exactly the double-POST this closes — and
//     writing off the same tray of prawns twice is a real loss, not a cosmetic
//     duplicate.
//   * **A negative post-balance is reported, never rejected** (ADR 0011 Q9). A
//     shop that never recorded the delivery still threw the food away; refusing
//     the write would only lose the fact. The form owns the warning.
//
// Per the 7a-8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3a) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  createWasteInputSchema,
  voidWasteInputSchema,
} from "@/lib/validations/waste";
import {
  WasteAlreadyVoidedError,
  WasteLogNotFoundError,
  WasteNotVoidableError,
  createWasteLogic,
  voidWasteLogic,
} from "@/server/waste";
import {
  MovementSourceConflictError,
  QtyRoundsToZeroError,
  StockUnitMismatchError,
} from "@/server/stock-movement";
import { CrossTenantReferenceError } from "@/server/product";

// --- Thai messages (the user-facing error paths) ---
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
const CONFLICT_MESSAGE = "ระบบกำลังบันทึกรายการนี้อยู่ กรุณาลองอีกครั้ง";
const NOT_FOUND_MESSAGE = "ไม่พบรายการของเสียนี้";
/** Already corrected. The DB index says the same thing, from further away. */
const ALREADY_VOIDED_MESSAGE = "รายการนี้ถูกยกเลิกไปแล้ว";
/** Voiding a void has no meaning in an append-only ledger (Q2). */
const NOT_VOIDABLE_MESSAGE =
  "รายการนี้เป็นรายการยกเลิกอยู่แล้ว หากต้องการบันทึกของเสียใหม่ ให้สร้างรายการใหม่";

export type WasteActionState =
  | { ok: true; wasteId: string; postBalance: string; negative: boolean }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type VoidWasteActionState =
  | { ok: true; wasteId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Map a user-facing typed error → Thai field/form error; rethrow the rest.
 *
 * Deliberately NOT mapped: `MovementSignMismatchError` and
 * `MovementSourceNotFoundError`. Waste writes its own source and applies its own
 * sign, so either one firing is a bug — and a polite Thai form message would
 * bury it where nobody looks.
 */
function toFormError(e: unknown): { formError?: string; fieldErrors?: Record<string, string> } {
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "product" ? "productId" : e.kind === "branch" ? "branchId" : null;
    return field
      ? { fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof StockUnitMismatchError) {
    return { fieldErrors: { inputUnitId: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof QtyRoundsToZeroError) {
    // Named units make the fix obvious: raise the quantity or pick a bigger unit.
    return {
      fieldErrors: {
        inputQty: `จำนวนน้อยเกินไป — ${e.inputQty.toString()} ${e.inputUnitName} ปัดเป็น 0${e.baseUnitName ? ` ${e.baseUnitName}` : ""}`,
      },
    };
  }
  if (e instanceof MovementSourceConflictError) {
    return { formError: CONFLICT_MESSAGE };
  }
  if (e instanceof WasteLogNotFoundError) {
    return { formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof WasteAlreadyVoidedError) {
    return { formError: ALREADY_VOIDED_MESSAGE };
  }
  if (e instanceof WasteNotVoidableError) {
    return { formError: NOT_VOIDABLE_MESSAGE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Every surface a waste entry changes.
 *
 * `/cost` is included because ADR 0017 Q4 makes ของเสีย mean WASTE_LOG alone —
 * a waste entry now moves a column on the executive view, which was not true of
 * a spoilage adjustment before this Part. `/stock` is included because a waste
 * entry can push a product below par.
 */
function revalidateWasteViews(productId: string): void {
  revalidatePath("/waste");
  revalidatePath("/stock");
  revalidatePath("/cost");
  revalidatePath(`/products/${productId}`);
}

/** Record one thing thrown away. Posts to the ledger in the same transaction. */
export async function createWasteAction(
  _prevState: WasteActionState,
  formData: FormData
): Promise<WasteActionState> {
  const { tenantId, membership, assertBranch} = await requireTenant("stock:write");

  const parsed = createWasteInputSchema.safeParse({
    submitKey: formData.get("submit_key"),
    productId: formData.get("product_id"),
    branchId: formData.get("branch_id"),
    reason: formData.get("reason"),
    inputQty: formData.get("input_qty"),
    inputUnitId: formData.get("input_unit_id"),
    occurredAt: formData.get("occurred_at"),
    wastedByName: formData.get("wasted_by_name"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  assertBranch(parsed.data.branchId);

  try {
    const { waste, postBalance } = await createWasteLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateWasteViews(parsed.data.productId);
    return {
      ok: true,
      wasteId: waste.id,
      postBalance: postBalance.toString(),
      negative: postBalance.lessThan(0),
    };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/** Correct an entry: append a reversal and credit the stock back (Q2). */
export async function voidWasteAction(
  _prevState: VoidWasteActionState,
  formData: FormData
): Promise<VoidWasteActionState> {
  const { tenantId, membership } = await requireTenant("stock:write");

  const parsed = voidWasteInputSchema.safeParse({
    id: formData.get("id"),
    voidReason: formData.get("void_reason"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const voided = await voidWasteLogic(tenantId, parsed.data, membership.userId);
    revalidateWasteViews(voided.productId);
    return { ok: true, wasteId: voided.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}
