"use server";

// ============================================================
// Mise — cost Server Actions (Sprint 2 Part 14 L4, ADR 0014)
// ============================================================
// Thin glue, per the repo convention: requireTenant → zod → *Logic → Thai error
// → view. The FIFO arithmetic is in fifo-replay.ts, the queries in stock-cost.ts,
// the declaration rules in cost-declaration.ts; nothing decides anything here.
//
// Only the errors this action can actually PRODUCE are mapped to Thai. Anything
// else rethrows to the error boundary rather than being buried in a form message
// the user cannot act on (the Part 10 L4 rule).
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  declareStockCostInputSchema,
  getProductCostQuerySchema,
  getBranchCostSummaryQuerySchema,
  STOCK_COST_FIELD_LABELS_TH,
} from "@/lib/validations/stock-cost";
import {
  CostDeclarationTargetError,
  CostUnitMismatchError,
  declareStockCostLogic,
  getCostDeclarationsLogic,
} from "@/server/cost-declaration";
import {
  getBranchCostSummaryLogic,
  getProductCostLogic,
} from "@/server/stock-cost";
import {
  toBranchCostSummaryView,
  toCostDeclarationView,
  toProductCostView,
  type BranchCostSummaryView,
  type CostDeclarationView,
  type ProductCostView,
} from "./_components/cost-view";

/** The movement being priced is gone, foreign, or is not a stock GAIN. */
const NOT_A_GAIN_MESSAGE =
  "ระบุต้นทุนได้เฉพาะของที่นับเจอเพิ่มเท่านั้น — ต้นทุนของใบรับของแก้ที่เอกสารนั้น";
const TARGET_NOT_FOUND_MESSAGE = "ไม่พบรายการเคลื่อนไหวที่ต้องการระบุต้นทุน";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบนี้";
const BAD_QUERY_MESSAGE = "เงื่อนไขการค้นหาไม่ถูกต้อง";

export type CostActionState =
  | { ok: true; declarationId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    const label =
      STOCK_COST_FIELD_LABELS_TH[key as keyof typeof STOCK_COST_FIELD_LABELS_TH];
    fieldErrors[key] = issue.message || `${label ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Map the form's snake_case names onto the schema's camelCase shape. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    movementId: formData.get("movement_id"),
    unitCost: formData.get("unit_cost"),
    unitId: formData.get("unit_id"),
    note: formData.get("note"),
  };
}

/**
 * Declare — or correct — the cost of stock that arrived without a document.
 *
 * Entry point two of two (entry point one is the optional field on the adjust
 * form, which writes inside the adjustment's own transaction). A correction
 * never overwrites: the previous statement is closed and both stay visible.
 */
export async function declareCostAction(
  _prevState: CostActionState,
  formData: FormData
): Promise<CostActionState> {
  const { tenantId, membership } = await requireTenant("cost:view");

  const parsed = declareStockCostInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const declaration = await declareStockCostLogic(
      tenantId,
      parsed.data,
      membership.userId
    );

    // Cost is derived from the ledger on every read, so a declaration changes
    // every surface that shows a cost — not just the page it was typed on.
    revalidatePath("/cost");
    revalidatePath("/stock");

    return { ok: true, declarationId: declaration.id };
  } catch (e) {
    if (e instanceof CostDeclarationTargetError) {
      return {
        ok: false,
        formError:
          e.reason === "NOT_A_GAIN" ? NOT_A_GAIN_MESSAGE : TARGET_NOT_FOUND_MESSAGE,
      };
    }
    if (e instanceof CostUnitMismatchError) {
      return { ok: false, fieldErrors: { unitId: UNIT_MISMATCH_MESSAGE } };
    }
    throw e;
  }
}

/** Read result shared by the read actions — a failure is a caller bug. */
export type CostReadState<T> =
  | { ok: true; data: T }
  | { ok: false; formError: string };

/**
 * Cost for one (product, branch).
 *
 * Called from the adjust form to show the default the server would apply, so the
 * user can judge it without opening the cost field at all. Takes a plain object
 * rather than FormData — there is no `<form>` behind it — and is still
 * schema-parsed, because it arrives from the client and reaches the database.
 */
export async function getProductCostAction(
  query: unknown
): Promise<CostReadState<ProductCostView>> {
  const { tenantId, assertBranch} = await requireTenant("cost:view");

  const parsed = getProductCostQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, formError: BAD_QUERY_MESSAGE };

  assertBranch(parsed.data.branchId);

  const cost = await getProductCostLogic(tenantId, parsed.data);
  return { ok: true, data: toProductCostView(cost) };
}

/** The declaration history behind one movement, newest first. */
export async function getCostDeclarationsAction(
  movementId: string
): Promise<CostReadState<CostDeclarationView[]>> {
  const { tenantId } = await requireTenant("cost:view");
  const rows = await getCostDeclarationsLogic(tenantId, movementId);
  return { ok: true, data: rows.map(toCostDeclarationView) };
}

/** Every branch side by side for a period — the business-wide view (Q9b). */
export async function getBranchCostSummaryAction(
  query: unknown
): Promise<CostReadState<BranchCostSummaryView[]>> {
  const { tenantId, reach } = await requireTenant("cost:view");

  const parsed = getBranchCostSummaryQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, formError: BAD_QUERY_MESSAGE };

  const rows = await getBranchCostSummaryLogic(tenantId, parsed.data, reach);
  return { ok: true, data: rows.map(toBranchCostSummaryView) };
}
