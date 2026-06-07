"use server";

// ============================================================
// Mise — Supplier Server Actions (Sprint 1 Part 5, Step 6)
// ============================================================
// Thin "use server" wrappers around the supplier *Logic layer
// (src/server/supplier.ts). Each action:
//   1. requireTenant() — auth + discover tenantId (independent request),
//   2. build a raw object from FormData (snake_case names, checkbox === "on"
//      per the settings page pattern),
//   3. supplierInputSchema.safeParse (no throw) → Thai field errors on fail,
//   4. call the *Logic fn, mapping SupplierCodeConflictError → Thai formError.
//
// Return shape feeds React 19 useActionState in the Step 7 forms. Redirects
// live in the page/form (Step 7), NOT here — actions only report outcome.
// Error messages are Thai (shown to user); logs/code stay English.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  supplierInputSchema,
  SUPPLIER_FIELD_LABELS_TH,
  type SupplierInput,
} from "@/lib/validations/supplier";
import {
  createSupplierLogic,
  updateSupplierLogic,
  deleteSupplierLogic,
  SupplierCodeConflictError,
} from "@/server/supplier";
// L4 (Q6 cascade): the supplier delete forwards user-selected mapping ids to
// deleteSupplierLogic, which throws this when a selected id isn't a live mapping
// of this supplier (stale dialog selection). One-way import (Part 8 cross-slice).
import {
  MappingNotFoundError,
  getSupplierMappingsLogic,
} from "@/server/supplier-product-mapping";

/**
 * Outcome of a create/update action, designed for React 19 useActionState:
 *   - ok:true  → the form can read supplierId and redirect (Step 7).
 *   - ok:false → fieldErrors (zod, keyed by field name) and/or formError
 *     (form-level, e.g. duplicate code from P2002). Values are Thai.
 */
export type SupplierActionState =
  | { ok: true; supplierId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Generic Thai duplicate-code message (Q5a) — shown at the form level. */
const DUPLICATE_CODE_MESSAGE = "รหัสซัพพลายเออร์นี้มีอยู่แล้ว";

/**
 * L4 (Q6 cascade): a mapping id the user selected in the L5 blast-radius dialog
 * wasn't a live mapping of this supplier (stale dialog / refreshed elsewhere).
 * deleteSupplierLogic throws MappingNotFoundError and rolls the whole delete back.
 */
const CASCADE_MAPPING_INVALID_MESSAGE =
  "เลือกรายการราคาไม่ถูกต้อง — รบกวนรีเฟรชแล้วลองใหม่";

/**
 * Map the form's snake_case FormData onto the schema's camelCase shape.
 * Text fields pass through raw (the schema's preprocess turns blanks → null);
 * checkboxes follow the settings convention (`=== "on"`).
 */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    code: formData.get("code"),
    nameFull: formData.get("name_full"),
    nameShort: formData.get("name_short"),
    contactName: formData.get("contact_name"),
    contactPhone: formData.get("contact_phone"),
    contactEmail: formData.get("contact_email"),
    lineId: formData.get("line_id"),
    address: formData.get("address"),
    taxId: formData.get("tax_id"),
    paymentTerms: formData.get("payment_terms"),
    isActive: formData.get("is_active") === "on",
    isVatRegistered: formData.get("is_vat_registered") === "on",
    defaultVatRatePercent: formData.get("default_vat_rate_percent"),
    defaultSubjectToWht: formData.get("default_subject_to_wht") === "on",
    defaultWhtRatePercent: formData.get("default_wht_rate_percent"),
  };
}

/**
 * Flatten zod issues to `{ fieldName: thaiMessage }`, keeping the first issue
 * per field. The schema's messages are already Thai; the field-label map is a
 * fallback so a field never surfaces a blank/English message to the user.
 */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] =
      issue.message ||
      `${SUPPLIER_FIELD_LABELS_TH[key as keyof SupplierInput] ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Create a supplier under the caller's tenant. */
export async function createSupplier(
  _prevState: SupplierActionState,
  formData: FormData
): Promise<SupplierActionState> {
  const { tenantId } = await requireTenant();

  const parsed = supplierInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const created = await createSupplierLogic(tenantId, parsed.data);
    revalidatePath("/suppliers");
    return { ok: true, supplierId: created.id };
  } catch (e) {
    if (e instanceof SupplierCodeConflictError) {
      return { ok: false, formError: DUPLICATE_CODE_MESSAGE };
    }
    throw e; // unexpected → let the error boundary handle it
  }
}

/**
 * Update an existing supplier. `id` is bound by the form
 * (updateSupplier.bind(null, id)); useActionState supplies prevState + formData.
 */
export async function updateSupplier(
  id: string,
  _prevState: SupplierActionState,
  formData: FormData
): Promise<SupplierActionState> {
  const { tenantId } = await requireTenant();

  const parsed = supplierInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const updated = await updateSupplierLogic(tenantId, id, parsed.data);
    if (!updated) {
      // No row matched: wrong tenant, missing, or already soft-deleted.
      return { ok: false, formError: "ไม่พบซัพพลายเออร์ที่ต้องการแก้ไข" };
    }
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${id}`);
    return { ok: true, supplierId: updated.id };
  } catch (e) {
    if (e instanceof SupplierCodeConflictError) {
      return { ok: false, formError: DUPLICATE_CODE_MESSAGE };
    }
    throw e;
  }
}

/**
 * Soft-delete a supplier (Q6). No field validation — just ok/error so a list
 * row's delete control can react. Cross-tenant/missing id → ok:false.
 */
export async function deleteSupplier(
  id: string,
  // L4 (Q6 cascade): mirror of deleteProduct — mapping ids the user chose to
  // soft-delete alongside the supplier (L5 dialog). Optional + defaulted so the
  // existing DeleteSupplierButton caller keeps working. Forwarded to the logic,
  // which validates each id (live + this supplier + this tenant) in the same tx.
  // Only MappingNotFoundError applies here — the ProductUnit-deletion guard is on
  // the product UPDATE path, not supplier delete.
  mappingIdsToSoftDelete: string[] = []
): Promise<{ ok: boolean; error?: string }> {
  const { tenantId } = await requireTenant();

  // (Part 9 decision ii — aggressive) cross-view revalidation, mirror of
  // deleteProduct: a cascade soft-deletes mappings that ALSO render on their
  // products' detail pages. Read the affected products BEFORE the delete (live
  // rows only), then revalidate those pages once the delete succeeds.
  const cascadeIds = new Set(mappingIdsToSoftDelete);
  const affectedProductIds =
    cascadeIds.size > 0
      ? [
          ...new Set(
            (await getSupplierMappingsLogic(tenantId, id, "all"))
              .filter((m) => cascadeIds.has(m.id))
              .map((m) => m.productId)
          ),
        ]
      : [];

  try {
    const deleted = await deleteSupplierLogic(
      tenantId,
      id,
      mappingIdsToSoftDelete
    );
    if (!deleted) {
      return { ok: false, error: "ไม่พบซัพพลายเออร์ที่ต้องการลบ" };
    }
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${id}`);
    for (const productId of affectedProductIds) {
      revalidatePath(`/products/${productId}`);
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof MappingNotFoundError) {
      return { ok: false, error: CASCADE_MAPPING_INVALID_MESSAGE };
    }
    throw e;
  }
}
