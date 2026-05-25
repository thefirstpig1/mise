"use server";

// ============================================================
// Mise — Product Server Actions (Sprint 1 Part 7a)
// ============================================================
// Thin "use server" wrappers around the product *Logic layer
// (src/server/product.ts). Mirrors src/app/{suppliers,categories}/actions.ts:
//   1. requireTenant() — auth + discover tenantId (independent request),
//   2. build a raw object from FormData (snake_case names),
//   3. productInputSchema.safeParse (no throw) → Thai field errors on fail,
//   4. call the *Logic fn, mapping ProductSkuConflictError / InvalidBaseUnitError
//      → Thai formError.
//
// Return shape feeds React 19 useActionState in the form. Redirects live in the
// form, NOT here. Error messages are Thai; logs English.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  productInputSchema,
  PRODUCT_FIELD_LABELS_TH,
  type ProductInput,
} from "@/lib/validations/product";
import {
  createProductLogic,
  updateProductLogic,
  deleteProductLogic,
  ProductSkuConflictError,
  ProductUnitNameConflictError,
  InvalidBaseUnitError,
  CrossTenantReferenceError,
} from "@/server/product";

/**
 * Outcome of a create/update action, for React 19 useActionState:
 *   - ok:true  → the form reads productId and redirects.
 *   - ok:false → fieldErrors (zod, keyed by camelCase field) and/or formError
 *     (form-level, e.g. duplicate sku). Values are Thai.
 */
export type ProductActionState =
  | { ok: true; productId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Thai duplicate-sku message (Pitfall #22 — full unique counts soft-deleted). */
const DUPLICATE_SKU_MESSAGE =
  "รหัสสินค้านี้มีอยู่แล้ว (หากเคยลบไปแล้ว จะยังใช้รหัสซ้ำไม่ได้)";
/** Thai duplicate unit-name message (multi-unit, Pitfall #24). */
const DUPLICATE_UNIT_MESSAGE = "มีชื่อหน่วยซ้ำกันในสินค้านี้";
/** Defensive: only reachable if the form posts a unit not in the dimension. */
const INVALID_UNIT_MESSAGE = "หน่วยพื้นฐานไม่ตรงกับหน่วยวัดที่เลือก";
/** A posted categoryId that isn't a live category of this tenant (cross-tenant FK guard). */
const INVALID_CATEGORY_MESSAGE = "หมวดบัญชีที่เลือกไม่ถูกต้อง";

/** Map the form's snake_case FormData onto the schema's camelCase shape. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  // Additional units (7b) arrive as two parallel, ordered arrays — one entry per
  // dynamic row in ProductForm. Zip them by index. Rows the user added but left
  // nameless (an "+ เพิ่มหน่วย" they changed their mind on) are dropped; a blank
  // RATIO is kept so zod surfaces "อัตราส่วนต้องมากกว่า 0" instead of a silent drop.
  const names = formData.getAll("additional_unit_name");
  const ratios = formData.getAll("additional_unit_ratio");
  const additionalUnits = names
    .map((unitName, i) => ({ unitName, toBaseRatio: ratios[i] ?? "" }))
    .filter((u) => typeof u.unitName === "string" && u.unitName.trim() !== "");

  return {
    sku: formData.get("sku"),
    name: formData.get("name"),
    nameEn: formData.get("name_en"),
    primaryDimension: formData.get("primary_dimension"),
    baseUnitName: formData.get("base_unit_name"),
    categoryId: formData.get("category_id"),
    isActive: formData.get("is_active") === "on",
    additionalUnits,
    defaultBuyUnitName: formData.get("default_buy_unit_name"),
  };
}

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] =
      issue.message ||
      `${PRODUCT_FIELD_LABELS_TH[key as keyof ProductInput] ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Map known typed logic errors → Thai field/form errors; rethrow the rest. */
function toFormError(e: unknown): ProductActionState {
  if (e instanceof ProductSkuConflictError) {
    return { ok: false, formError: DUPLICATE_SKU_MESSAGE };
  }
  if (e instanceof ProductUnitNameConflictError) {
    return { ok: false, formError: DUPLICATE_UNIT_MESSAGE };
  }
  if (e instanceof InvalidBaseUnitError) {
    return { ok: false, formError: INVALID_UNIT_MESSAGE };
  }
  if (e instanceof CrossTenantReferenceError) {
    // 7a only references category; 7b's parentProductId reuses this branch.
    if (e.kind === "category") {
      return { ok: false, fieldErrors: { categoryId: INVALID_CATEGORY_MESSAGE } };
    }
    return { ok: false, formError: INVALID_CATEGORY_MESSAGE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/** Create a RAW product (+ its base unit) under the caller's tenant. */
export async function createProduct(
  _prevState: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const { tenantId } = await requireTenant();

  const parsed = productInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const created = await createProductLogic(tenantId, parsed.data);
    revalidatePath("/products");
    return { ok: true, productId: created.id };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * Update an existing product. `id` is bound by the form
 * (updateProduct.bind(null, id)); useActionState supplies prevState + formData.
 */
export async function updateProduct(
  id: string,
  _prevState: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  const { tenantId } = await requireTenant();

  const parsed = productInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const updated = await updateProductLogic(tenantId, id, parsed.data);
    if (!updated) {
      return { ok: false, formError: "ไม่พบสินค้าที่ต้องการแก้ไข" };
    }
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    return { ok: true, productId: updated.id };
  } catch (e) {
    return toFormError(e);
  }
}

/**
 * Soft-delete a product. No field validation — just ok/error so a tree row's
 * delete control can react. Cross-tenant/missing id → ok:false.
 */
export async function deleteProduct(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { tenantId } = await requireTenant();

  const deleted = await deleteProductLogic(tenantId, id);
  if (!deleted) {
    return { ok: false, error: "ไม่พบสินค้าที่ต้องการลบ" };
  }

  revalidatePath("/products");
  return { ok: true };
}
