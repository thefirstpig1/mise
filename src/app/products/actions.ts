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
  ProductHasChildrenError,
  ProductParentCycleError,
  ProductDepthExceededError,
  LiquidDensityTemplateNotFoundError,
  ProductUnitReferencedByMappingError,
} from "@/server/product";
// L4 (Q6 cascade): the product delete forwards user-selected mapping ids to
// deleteProductLogic, which throws this when a selected id isn't a live mapping
// of this product (stale dialog selection). One-way import (Part 8 cross-slice).
import { MappingNotFoundError } from "@/server/supplier-product-mapping";

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
/** A posted parentProductId that isn't a live product of this tenant (7c). */
const INVALID_PARENT_MESSAGE = "สินค้าแม่ที่เลือกไม่ถูกต้อง";
/** A posted liquidDensityTemplateId that isn't an existing density template (7d). */
const INVALID_DENSITY_TEMPLATE_MESSAGE = "ค่าความหนาแน่นมาตรฐานที่เลือกไม่ถูกต้อง";
/** 7c: the new parent edge would create a self-reference or a cycle. */
const PARENT_CYCLE_MESSAGE = "สินค้าแม่ที่เลือกจะทำให้เกิดวงจรอ้างอิง";
/**
 * 7c: the new edge would push the chain past 5 nodes (ADR 0007).
 * Phrased from the user's perspective: they think in "ของแปรรูปซ้อนกี่ชั้น",
 * not "node count including the RAW root". 5-node cap = 1 RAW + 4 PREPPED, so
 * the user-facing limit is "ซ้อนได้ 4 ชั้น".
 */
const PARENT_DEPTH_MESSAGE =
  "ซ้อนสินค้าแปรรูปได้สูงสุด 4 ชั้นจากวัตถุดิบตั้งต้น — เลือกสินค้าแม่ที่ตื้นกว่านี้";

/**
 * Build the Thai delete-blocked message for ProductHasChildrenError. Shows the
 * first 3 child names; any remainder is summarised as "…และอีก N รายการ" so the
 * toast stays readable when many children block the delete.
 */
const HAS_CHILDREN_NAME_CAP = 3;
function buildHasChildrenMessage(childNames: string[]): string {
  const shown = childNames.slice(0, HAS_CHILDREN_NAME_CAP).join(", ");
  const remaining = childNames.length - HAS_CHILDREN_NAME_CAP;
  const overflow = remaining > 0 ? ` …และอีก ${remaining} รายการ` : "";
  return `ลบไม่ได้ — สินค้านี้ยังถูกใช้เป็นสินค้าแม่ของ: ${shown}${overflow}`;
}

/**
 * L4 (Q5ii): a multi-unit edit tried to REMOVE a unit still referenced as the
 * orderUnit of N live supplier mappings — updateProductLogic blocks it. Thrown
 * from the UPDATE path (unit removal), not delete; surfaced as a form error.
 */
function buildUnitReferencedMessage(mappingIds: string[]): string {
  return `ลบหน่วยไม่ได้ — มี ${mappingIds.length} รายการราคาซัพพลายเออร์ใช้หน่วยนี้อยู่`;
}

/**
 * L4 (Q6 cascade): a mapping id the user selected in the L5 blast-radius dialog
 * wasn't a live mapping of this product (stale dialog / refreshed elsewhere).
 * deleteProductLogic throws MappingNotFoundError and rolls the whole delete back.
 */
const CASCADE_MAPPING_INVALID_MESSAGE =
  "เลือกรายการราคาไม่ถูกต้อง — รบกวนรีเฟรชแล้วลองใหม่";

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

  // 7c: cleanse stale parent/yield when the user toggles PREPPED→RAW. Without
  // this the FormData still carries the old PREPPED values and zod's
  // superRefine would fire "วัตถุดิบต้องไม่มีสินค้าแม่/เปอร์เซ็นต์ผลผลิต" even though
  // the user's *intent* is RAW. The form is required to always submit `type`
  // (no zod default reliance — see comment on the `type` field in
  // src/lib/validations/product.ts): if it's missing/invalid, zod fails with
  // a Thai field error and the user retries.
  const rawType = formData.get("type");
  const isRaw = rawType === "RAW";

  // 7d (grill Q3): cleanse density to null when COUNT — same shape as the isRaw
  // parent/yield cleanse above. FIRST of three defense-in-depth layers (also: zod
  // COUNT gate, *Logic write), each catching a different bypass. Runs BEFORE zod
  // so a COUNT toggle never trips the COUNT gate even if the UI didn't cleanse.
  const primaryDimension = formData.get("primary_dimension");
  const isCount = primaryDimension === "COUNT";

  return {
    sku: formData.get("sku"),
    name: formData.get("name"),
    nameEn: formData.get("name_en"),
    primaryDimension,
    baseUnitName: formData.get("base_unit_name"),
    categoryId: formData.get("category_id"),
    isActive: formData.get("is_active") === "on",
    additionalUnits,
    defaultBuyUnitName: formData.get("default_buy_unit_name"),
    type: rawType,
    parentProductId: isRaw ? null : formData.get("parent_product_id"),
    yieldPercent: isRaw ? null : formData.get("yield_percent"),
    // 7d: COUNT → null (cleanse, above); otherwise forward as-is (snake_case →
    // camelCase). zod's blankToNull maps empty to null; the XOR (template vs
    // override) is enforced by zod superRefine (L2) and the DB CHECK (ADR 0008).
    liquidDensityTemplateId: isCount
      ? null
      : formData.get("liquid_density_template_id"),
    densityGPerMlOverride: isCount
      ? null
      : formData.get("density_g_per_ml_override"),
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
  if (e instanceof ProductParentCycleError) {
    return { ok: false, fieldErrors: { parentProductId: PARENT_CYCLE_MESSAGE } };
  }
  if (e instanceof ProductDepthExceededError) {
    return { ok: false, fieldErrors: { parentProductId: PARENT_DEPTH_MESSAGE } };
  }
  if (e instanceof CrossTenantReferenceError) {
    // TenantScopedRef = "category" | "product"; both surface as field errors.
    if (e.kind === "category") {
      return { ok: false, fieldErrors: { categoryId: INVALID_CATEGORY_MESSAGE } };
    }
    return { ok: false, fieldErrors: { parentProductId: INVALID_PARENT_MESSAGE } };
  }
  if (e instanceof LiquidDensityTemplateNotFoundError) {
    // 7d: the chosen standard-density template id doesn't exist (global ref data).
    return {
      ok: false,
      fieldErrors: { liquidDensityTemplateId: INVALID_DENSITY_TEMPLATE_MESSAGE },
    };
  }
  if (e instanceof ProductUnitReferencedByMappingError) {
    // L4 (Q5ii): removing a unit still used as a live mapping's orderUnit — form-level.
    return { ok: false, formError: buildUnitReferencedMessage(e.mappingIds) };
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
 * delete control can react. Cross-tenant/missing id → ok:false. 7c: if the
 * target still has LIVE PREPPED children, the logic layer throws
 * ProductHasChildrenError; we render the first N names in Thai.
 */
export async function deleteProduct(
  id: string,
  // L4 (Q6 cascade): mapping ids the user chose in the L5 blast-radius dialog to
  // soft-delete alongside the product. Optional + defaulted so the existing
  // direct-invoke caller (DeleteProductButton, 7c) keeps working unchanged; the
  // L5 cascade dialog passes the selected ids. Forwarded to deleteProductLogic,
  // which validates each id (live + this product + this tenant) in the same tx.
  mappingIdsToSoftDelete: string[] = []
): Promise<{ ok: boolean; error?: string }> {
  const { tenantId } = await requireTenant();

  try {
    const deleted = await deleteProductLogic(
      tenantId,
      id,
      mappingIdsToSoftDelete
    );
    if (!deleted) {
      return { ok: false, error: "ไม่พบสินค้าที่ต้องการลบ" };
    }
    revalidatePath("/products");
    return { ok: true };
  } catch (e) {
    if (e instanceof ProductHasChildrenError) {
      return { ok: false, error: buildHasChildrenMessage(e.childNames) };
    }
    if (e instanceof MappingNotFoundError) {
      return { ok: false, error: CASCADE_MAPPING_INVALID_MESSAGE };
    }
    throw e;
  }
}
