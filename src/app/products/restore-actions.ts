"use server";

// ============================================================
// Mise — Product Restore Server Actions (Sprint 1 Part 8.5 L4; ADR 0010)
// ============================================================
// Thin "use server" glue over the restore *Logic layer
// (src/server/product-restore.ts). Two actions, two SHAPES:
//
//   1. searchSoftDeletedProductsAction — the debounced typeahead on the
//      product-NEW form. An imperative read/query, NOT a form submit, so it
//      returns the data DIRECTLY (FuzzyMatchCandidate[]), not the Sprint 1
//      { ok, ... } useActionState shape (finding D). FuzzyMatchCandidate is
//      already RSC-safe — Decimal serialized at L3a (Pitfall #20).
//   2. restoreProductAction — the restore-dialog submit. Keeps the Sprint 1
//      useActionState shape ({ ok, productId } | { ok:false, formError?,
//      fieldErrors? }) so the form reads productId and redirects.
//
// Lives in its OWN file under products/ (finding A): restore is product-centric
// (typeahead fires on the product-NEW form) — unlike the neutral top-level
// supplier-product-mappings/actions.ts — and the Part 8.5 isolation pattern
// (L3a precedent) keeps it OFF the 7a products/actions.ts to protect that
// slice's 108-test coverage. Error mapping is INLINE per-file (finding C): no
// shared mapLogicError exists in Sprint 1 (both action files near-dup their own).
//
// Per the 7a/8/8.5 convention this glue has NO unit tests — coverage = zod (L2)
// + logic (L3a/L3b) + E2E (L6). Error messages are Thai (shown to user); logs
// and code stay English.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  fuzzySearchSoftDeletedProductsLogic,
  restoreProductLogic,
  ProductNotFoundError,
  type FuzzyMatchCandidate,
} from "@/server/product-restore";
import { ProductSkuConflictError } from "@/server/product";
import { MappingNotFoundError } from "@/server/supplier-product-mapping";
import {
  fuzzySearchInputSchema,
  restoreProductInputSchema,
} from "@/lib/validations/product-restore";

/**
 * Outcome of the restore submit, for React 19 useActionState:
 *   - ok:true  → the dialog reads productId and redirects to the product.
 *   - ok:false → fieldErrors (zod, keyed by the dotted zod path so the dialog
 *     can target newSku or a specific mapping row) and/or formError (form-level,
 *     e.g. the product is gone). Values are Thai.
 */
export type RestoreActionState =
  | { ok: true; productId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

// --- Thai error messages (the 4 restore error paths; inline per finding C) ---
/** The target id is no longer a soft-deleted product (gone / already restored). */
const ERR_PRODUCT_NOT_FOUND =
  "ไม่พบสินค้าที่ต้องการกู้คืน (อาจถูกกู้คืนไปแล้ว) — รบกวนรีเฟรช";
/** A user-typed newSku collides with a different LIVE product (Q5 field error). */
const ERR_NEWSKU_TAKEN = "รหัสนี้มีสินค้าอื่นใช้อยู่แล้ว — กรุณาใช้รหัสอื่น";
/** No newSku given but the candidate's ORIGINAL sku is now live-owned (#5 backstop). */
const ERR_ORIGINAL_SKU_TAKEN =
  "รหัสเดิมของสินค้านี้ถูกใช้แล้ว — กรุณาระบุรหัสใหม่";
/** A selected mapping row isn't an open live orphan (stale dialog / closed-row #4). */
const ERR_MAPPING_STALE = "เลือกรายการราคาไม่ถูกต้อง — รบกวนรีเฟรชแล้วลองใหม่";

/**
 * Flatten zod issues to `{ dottedPath: thaiMessage }`, first issue per path. The
 * dotted path (e.g. `newSku`, `mappingUpdates.0.updates.currentUnitPrice`) lets
 * the restore dialog attach the message to the right field/row — the schema's
 * messages are already Thai, so the fallback is only a last resort.
 */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Map a known typed logic error → Thai field/form error; rethrow the rest.
 * ProductSkuConflictError forks on `hasNewSku`: with a user-typed newSku it is a
 * field error on that input (Q5); without one it is the original-sku #5 backstop,
 * surfaced form-level since the user never entered a sku to correct.
 */
function toRestoreFormError(
  e: unknown,
  hasNewSku: boolean
): RestoreActionState {
  if (e instanceof ProductNotFoundError) {
    return { ok: false, formError: ERR_PRODUCT_NOT_FOUND };
  }
  if (e instanceof ProductSkuConflictError) {
    return hasNewSku
      ? { ok: false, fieldErrors: { newSku: ERR_NEWSKU_TAKEN } }
      : { ok: false, formError: ERR_ORIGINAL_SKU_TAKEN };
  }
  if (e instanceof MappingNotFoundError) {
    return { ok: false, formError: ERR_MAPPING_STALE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Build the `mappingUpdates` array from the dialog's FANOUT FormData (finding B):
 * five parallel, ordered arrays — one entry per orphan-mapping row — zipped by
 * index (the additionalUnits precedent at products/actions.ts:118-122; NO
 * JSON.stringify). The price/qty/lead fields are forwarded ONLY when the row's
 * action is "update" (a "keep" row carries no payload); z.coerce + the L2
 * superRefine in restoreProductInputSchema validate the zipped shape.
 */
function mappingUpdatesFromFormData(
  formData: FormData
): Array<Record<string, unknown>> {
  const ids = formData.getAll("mapping_id");
  const actions = formData.getAll("mapping_action");
  const prices = formData.getAll("mapping_price");
  const minQtys = formData.getAll("mapping_min_qty");
  const leadTimes = formData.getAll("mapping_lead_time");

  return ids.map((mappingId, i) => {
    const action = actions[i];
    return {
      mappingId,
      action,
      updates:
        action === "update"
          ? {
              currentUnitPrice: prices[i],
              minOrderQty: minQtys[i],
              leadTimeDays: leadTimes[i],
            }
          : undefined,
    };
  });
}

/**
 * Debounced typeahead endpoint (finding D): fuzzy-search the tenant's soft-deleted
 * products by name/sku similarity (3+ chars). Returns the candidate array DIRECTLY
 * — sub-3-char / invalid terms return [] (the logic layer is defensive too; the
 * client enforces min-3 anyway).
 */
export async function searchSoftDeletedProductsAction(
  searchTerm: string
): Promise<FuzzyMatchCandidate[]> {
  const { tenantId } = await requireTenant();

  const parsed = fuzzySearchInputSchema.safeParse({ searchTerm });
  if (!parsed.success) return [];

  return fuzzySearchSoftDeletedProductsLogic(tenantId, parsed.data.searchTerm);
}

/**
 * Restore a soft-deleted product (ADR 0010), optionally re-skuing it and applying
 * the per-orphan price review, then revalidate every view the restore touches.
 * Cross-view revalidation is aggressive (Part 9 decision ii — closes e4b4306): the
 * restored product re-surfaces its orphan mappings on each supplier's detail page,
 * so we revalidate the product list, the product detail, and every affected
 * supplier (Option B — restoreProductLogic returns the ids).
 */
export async function restoreProductAction(
  _prevState: RestoreActionState | undefined,
  formData: FormData
): Promise<RestoreActionState> {
  const { tenantId } = await requireTenant();

  // Raw extract (snake_case FormData → camelCase). productId falls back to "" so a
  // missing field fails the zod uuid check with the Thai message (not a type error);
  // newSku/the fanout payload pass through raw — the L2 schema's preprocess + coerce
  // own the blank→undefined and string→number conversions (single source of truth).
  const raw = {
    productId: String(formData.get("product_id") ?? ""),
    newSku: formData.get("new_sku"),
    mappingUpdates: mappingUpdatesFromFormData(formData),
  };

  const parsed = restoreProductInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  const hasNewSku = parsed.data.newSku !== undefined;

  try {
    const { product, affectedSupplierIds } = await restoreProductLogic(
      tenantId,
      parsed.data.productId,
      { newSku: parsed.data.newSku, mappingUpdates: parsed.data.mappingUpdates }
    );
    revalidatePath("/products");
    revalidatePath(`/products/${product.id}`);
    for (const supplierId of affectedSupplierIds) {
      revalidatePath(`/suppliers/${supplierId}`);
    }
    return { ok: true, productId: product.id };
  } catch (e) {
    return toRestoreFormError(e, hasNewSku);
  }
}
