"use server";

// ============================================================
// Mise — stock count Server Actions (Sprint 3 Part 15 L4, ADR 0015)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// The one thing worth stating twice: **`qty_expected` is never read from the
// form.** It is the ledger's answer, snapshotted server-side when the line is
// saved (Q3). A form field for it would let a stale browser tab tell the server
// what the stock was an hour ago, and the variance would be wrong in a way
// nothing downstream could detect.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  closeStockCountInputSchema,
  openStockCountInputSchema,
  saveStockCountLineInputSchema,
  voidStockCountInputSchema,
  STOCK_COUNT_FIELD_LABELS_TH,
} from "@/lib/validations/stock-count";
import {
  closeStockCountLogic,
  CountUnitMismatchError,
  deleteStockCountDraftLogic,
  deleteStockCountLineLogic,
  openStockCountLogic,
  saveStockCountLineLogic,
  StockCountAlreadyOpenError,
  StockCountNotEditableError,
  StockCountNotFoundError,
  StockCountTransitionError,
  voidStockCountLogic,
} from "@/server/stock-count";
import { CrossTenantReferenceError } from "@/server/product";
import {
  toStockCountDetailView,
  type StockCountDetailView,
} from "./_components/stock-count-view";

// --- Thai messages (the user-facing error paths) ---
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const NOT_FOUND_MESSAGE = "ไม่พบใบนับสต๊อกนี้";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
const NOT_EDITABLE_MESSAGE = "ใบนับนี้ปิดไปแล้ว แก้ไขไม่ได้";
const CLOSE_AGAIN_MESSAGE = "ใบนับนี้ปิดไปแล้ว";
const VOID_NOT_CLOSED_MESSAGE = "ยกเลิกได้เฉพาะใบที่ปิดแล้วเท่านั้น";

export type StockCountActionState =
  | { ok: true; countId: string; detail?: StockCountDetailView }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] =
      issue.message || `${STOCK_COUNT_FIELD_LABELS_TH[key] ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Map a typed error → Thai; rethrow the rest.
 *
 * `StockCountAlreadyOpenError` deliberately carries the existing sheet's id into
 * the message path: "someone is already counting this branch" is only actionable
 * with a way to reach that sheet, and the UI links to it.
 */
function toFormError(e: unknown): StockCountActionState {
  if (e instanceof StockCountAlreadyOpenError) {
    return {
      ok: false,
      formError: `สาขานี้มีใบนับที่ยังเปิดอยู่ — เข้าไปนับต่อในใบเดิมได้เลย (${e.existingId})`,
    };
  }
  if (e instanceof StockCountNotFoundError) {
    return { ok: false, formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof StockCountNotEditableError) {
    return { ok: false, formError: NOT_EDITABLE_MESSAGE };
  }
  if (e instanceof StockCountTransitionError) {
    return {
      ok: false,
      formError: e.to === "VOIDED" ? VOID_NOT_CLOSED_MESSAGE : CLOSE_AGAIN_MESSAGE,
    };
  }
  if (e instanceof CountUnitMismatchError) {
    return { ok: false, fieldErrors: { entries: UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof CrossTenantReferenceError) {
    const field = e.kind === "branch" ? "branchId" : e.kind === "product" ? "productId" : null;
    return field
      ? { ok: false, fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { ok: false, formError: CROSS_TENANT_MESSAGE };
  }
  throw e; // unexpected → the error boundary
}

/**
 * Every surface a count touches. Closing changes stock, which changes balances,
 * values and the branch summary — so the revalidation is wider than the page the
 * button was on, exactly as the cost declaration's is.
 */
function revalidateCountViews(countId: string): void {
  revalidatePath("/stock-counts");
  revalidatePath(`/stock-counts/${countId}`);
  revalidatePath("/stock");
  revalidatePath("/cost");
}

export async function openStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = openStockCountInputSchema.safeParse({
    branchId: formData.get("branch_id"),
    countDate: formData.get("count_date"),
    // An unchecked checkbox posts nothing at all, so absence means "blind".
    showExpected: formData.get("show_expected") === "on",
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await openStockCountLogic(tenantId, parsed.data, membership.userId);
    revalidateCountViews(count.id);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * Save one counted line. Entries cross the form as parallel arrays zipped by
 * index — the Part 8.5 fanout pattern, used by every multi-row form since.
 */
export async function saveStockCountLineAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, membership } = await requireTenant();

  const unitIds = formData.getAll("entry_unit_id");
  const qtys = formData.getAll("entry_qty");
  const entries = unitIds
    .map((productUnitId, i) => ({ productUnitId, qtyInUnit: qtys[i] ?? "" }))
    // A row the user added and left blank is not a count of zero — it is a row
    // they changed their mind about, and dropping it is what they meant.
    .filter((e) => typeof e.qtyInUnit === "string" && e.qtyInUnit.trim() !== "");

  const parsed = saveStockCountLineInputSchema.safeParse({
    stockCountId: formData.get("stock_count_id"),
    productId: formData.get("product_id"),
    entries,
    countedByName: formData.get("counted_by_name"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await saveStockCountLineLogic(tenantId, parsed.data, membership.userId);
    revalidateCountViews(count.id);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

/** Remove a line from the sheet — "I put this here by mistake", not "zero". */
export async function removeStockCountLineAction(
  stockCountId: string,
  itemId: string
): Promise<StockCountActionState> {
  const { tenantId } = await requireTenant();
  try {
    const count = await deleteStockCountLineLogic(tenantId, stockCountId, itemId);
    revalidateCountViews(count.id);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

export async function closeStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = closeStockCountInputSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await closeStockCountLogic(tenantId, parsed.data, membership.userId);
    revalidateCountViews(count.id);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

export async function voidStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId, membership } = await requireTenant();

  const parsed = voidStockCountInputSchema.safeParse({
    id: formData.get("id"),
    voidReason: formData.get("void_reason"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const count = await voidStockCountLogic(tenantId, parsed.data, membership.userId);
    revalidateCountViews(count.id);
    return { ok: true, countId: count.id, detail: toStockCountDetailView(count) };
  } catch (e) {
    return toFormError(e);
  }
}

/** Discard a sheet nobody finished. A CLOSED count is voided, never hidden. */
export async function discardStockCountAction(
  _prevState: StockCountActionState,
  formData: FormData
): Promise<StockCountActionState> {
  const { tenantId } = await requireTenant();
  const id = String(formData.get("id") ?? "");

  try {
    const count = await deleteStockCountDraftLogic(tenantId, id);
    revalidateCountViews(count.id);
    return { ok: true, countId: count.id };
  } catch (e) {
    return toFormError(e);
  }
}
