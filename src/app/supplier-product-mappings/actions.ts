"use server";

// ============================================================
// Mise — SupplierProductMapping Server Actions (Sprint 1 Part 8 L4)
// ============================================================
// Thin "use server" wrappers around the mapping *Logic layer
// (src/server/supplier-product-mapping.ts). Mirrors src/app/{products,
// suppliers}/actions.ts:
//   1. requireTenant() — auth + discover tenantId (independent request),
//   2. build a raw object from FormData (snake_case names),
//   3. supplierProductMappingInputSchema.safeParse (no throw) → Thai field
//      errors on fail,
//   4. call the *Logic fn, mapping the 5 typed/raw error paths → Thai.
//
// Location (L4 STEP 1, Option A): top-level, neutral. The mapping is a
// first-class entity (own zod schema, own *Logic, ADR 0009) reachable from
// BOTH product-centric and supplier-centric navigation (Q9), so its actions
// live here rather than nested under products/ or suppliers/.
//
// Return shape feeds React 19 useActionState in the L5 form. Redirects live in
// the form, NOT here. Error messages are Thai (shown to user); logs/code stay
// English. Per the 7a/7b/7c/7d convention this glue layer has NO unit tests —
// coverage = zod (L2) + logic (L3a/L3b) + E2E (L6).
// ============================================================

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { supplierProductMappingInputSchema } from "@/lib/validations/supplier-product-mapping";
import {
  createSupplierProductMappingLogic,
  updateSupplierProductMappingLogic,
  deleteSupplierProductMappingLogic,
  getSupplierProductMappingByIdLogic,
  MappingOverlapError,
  OrderUnitMismatchError,
  MappingNotFoundError,
} from "@/server/supplier-product-mapping";
// CrossTenantReferenceError + its widened `kind` ("supplier"|"product"|"branch"
// reach this slice) live in product.ts — the single owner since L3b. Reused here
// rather than redeclared.
import { CrossTenantReferenceError } from "@/server/product";

/**
 * Outcome of a mapping action, for React 19 useActionState. There is no
 * standalone mapping page to redirect to (Q9 keeps the price list embedded in
 * the product/supplier view), so success carries no id — the form just closes
 * and the revalidated list re-renders.
 *   - ok:true  → success; the form clears/closes.
 *   - ok:false → fieldErrors (zod or a typed-error field hit) and/or formError
 *     (form-level, e.g. overlap). Values are Thai.
 */
export type MappingActionState =
  | { ok: true }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

// --- Thai messages (the 5 mapping error paths; Drive L4 doc §4) ---
/** A supplier/product/branch FK that isn't a live row of this tenant. */
const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
/** orderUnitId points at a unit that isn't of this mapping's product (Q5i). */
const ORDER_UNIT_MISMATCH_MESSAGE = "หน่วยสั่งซื้อต้องเป็นหน่วยของวัตถุดิบนี้";
/** New/updated date range collides with a live row that can't be superseded (Q4). */
const OVERLAP_MESSAGE = "ราคานี้ทับช่วงเวลากับรายการอื่น";
/** The mapping id (from URL) doesn't resolve to a live row of this tenant. */
const NOT_FOUND_MESSAGE = "ไม่พบรายการราคา";
/** Defense-in-depth backstop: the partial unique index (Q10) fired a raw P2002. */
const DUPLICATE_MESSAGE = "รายการราคาซ้ำในวันที่นี้";

/**
 * Map the form's snake_case FormData onto the schema's camelCase shape. Values
 * pass through raw — the schema's preprocess does the work: blankToNull turns
 * empty optionals to null, isPreferredPreprocess turns the checkbox ("on") /
 * "true" into a boolean, and z.coerce handles the numeric/date strings. (Unlike
 * suppliers/actions.ts we do NOT pre-convert the checkbox here — the mapping
 * schema owns that, so passing the raw value keeps a single source of truth.)
 */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    supplierId: formData.get("supplier_id"),
    productId: formData.get("product_id"),
    branchId: formData.get("branch_id"),
    supplierItemCode: formData.get("supplier_item_code"),
    supplierItemName: formData.get("supplier_item_name"),
    orderUnitId: formData.get("order_unit_id"),
    currentUnitPrice: formData.get("current_unit_price"),
    minOrderQty: formData.get("min_order_qty"),
    leadTimeDays: formData.get("lead_time_days"),
    isPreferred: formData.get("is_preferred"),
    effectiveFrom: formData.get("effective_from"),
    effectiveTo: formData.get("effective_to"),
  };
}

/**
 * Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field.
 * The schema's messages are already Thai and complete (no separate field-label
 * map needed, unlike products), so the fallback is only a last resort.
 */
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
 * Map a known typed/raw logic error → Thai field/form error; rethrow the rest.
 * CrossTenantReferenceError is attached to the OFFENDING FK field (so the user
 * sees which reference is wrong) — orderUnitId is NOT covered here, its mismatch
 * surfaces as the distinct OrderUnitMismatchError. The raw P2002 branch is the
 * partial-unique backstop (Q10): the app-level overlap guard is the primary gate,
 * this catches a race that slips past it.
 */
function toFormError(e: unknown): MappingActionState {
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "supplier"
        ? "supplierId"
        : e.kind === "product"
          ? "productId"
          : e.kind === "branch"
            ? "branchId"
            : null;
    return field
      ? { ok: false, fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { ok: false, formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof OrderUnitMismatchError) {
    return { ok: false, fieldErrors: { orderUnitId: ORDER_UNIT_MISMATCH_MESSAGE } };
  }
  if (e instanceof MappingOverlapError) {
    return { ok: false, formError: OVERLAP_MESSAGE };
  }
  if (e instanceof MappingNotFoundError) {
    return { ok: false, formError: NOT_FOUND_MESSAGE };
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return { ok: false, formError: DUPLICATE_MESSAGE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Revalidate the two places a mapping renders (Q9 dual navigation): the product
 * detail page and the supplier detail page. Both routes exist today
 * (/products/[id], /suppliers/[id]); the L5 price list will live on them.
 */
function revalidateMappingViews(productId: string, supplierId: string): void {
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/suppliers/${supplierId}`);
}

/** Create a supplier-product price mapping under the caller's tenant. */
export async function createMappingAction(
  _prevState: MappingActionState,
  formData: FormData
): Promise<MappingActionState> {
  const { tenantId, assertBranch} = await requireTenant("master:write");

  const parsed = supplierProductMappingInputSchema.safeParse(
    rawFromFormData(formData)
  );
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  if (parsed.data.branchId) assertBranch(parsed.data.branchId);

  try {
    await createSupplierProductMappingLogic(tenantId, parsed.data);
    revalidateMappingViews(parsed.data.productId, parsed.data.supplierId);
    return { ok: true };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * Update a live mapping. `id` is bound by the form
 * (updateMappingAction.bind(null, id)); useActionState supplies prevState +
 * formData. Identity fields (supplier/product/branch) are immutable in the logic
 * layer — the input's identity fields are ignored there, the existing row's kept.
 */
export async function updateMappingAction(
  id: string,
  _prevState: MappingActionState,
  formData: FormData
): Promise<MappingActionState> {
  const { tenantId, assertBranch} = await requireTenant("master:write");

  const parsed = supplierProductMappingInputSchema.safeParse(
    rawFromFormData(formData)
  );
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  if (parsed.data.branchId) assertBranch(parsed.data.branchId);

  try {
    const updated = await updateSupplierProductMappingLogic(
      tenantId,
      id,
      parsed.data
    );
    if (!updated) {
      // No live row matched: wrong tenant, missing, or soft-deleted.
      return { ok: false, formError: NOT_FOUND_MESSAGE };
    }
    // Revalidate from the persisted row's identity (immutable), not the input.
    revalidateMappingViews(updated.productId, updated.supplierId);
    return { ok: true };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * Soft-delete a mapping. `id` is bound by the form; prevState + formData come
 * from useActionState (formData unused — no fields to parse). We read the row's
 * product/supplier ids BEFORE deleting (the soft-delete keeps the row, but the
 * read is the clean way to learn what to revalidate without depending on hidden
 * form fields the L5 list doesn't yet define). A missing/cross-tenant id →
 * deleteLogic returns false → Thai "ไม่พบรายการราคา".
 */
export async function deleteMappingAction(
  id: string,
  _prevState: MappingActionState,
  _formData: FormData
): Promise<MappingActionState> {
  const { tenantId } = await requireTenant("master:write");

  const existing = await getSupplierProductMappingByIdLogic(tenantId, id);
  const deleted = await deleteSupplierProductMappingLogic(tenantId, id);
  if (!deleted) {
    return { ok: false, formError: NOT_FOUND_MESSAGE };
  }

  if (existing) {
    revalidateMappingViews(existing.productId, existing.supplierId);
  }
  return { ok: true };
}
