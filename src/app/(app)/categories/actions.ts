"use server";

// ============================================================
// Mise — Category Server Actions (Sprint 1 Part 6, Step 6.3)
// ============================================================
// Thin "use server" wrappers around the category *Logic layer
// (src/server/category.ts). Mirrors src/app/suppliers/actions.ts:
//   1. requireTenant() — auth + discover tenantId (independent request),
//   2. build a raw object from FormData (snake_case names),
//   3. categoryInputSchema.safeParse (no throw) → Thai field errors on fail,
//   4. call the *Logic fn, mapping CategoryConflictError → Thai formError.
//
// Return shape feeds React 19 useActionState in the Step 6.4 forms. Redirects
// live in the form (Step 6.4), NOT here. Error messages are Thai; logs English.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  categoryInputSchema,
  CATEGORY_FIELD_LABELS_TH,
  type CategoryInput,
} from "@/lib/validations/category";
import {
  createCategoryLogic,
  updateCategoryLogic,
  deleteCategoryLogic,
  CategoryConflictError,
} from "@/server/category";

/**
 * Outcome of a create/update action, designed for React 19 useActionState:
 *   - ok:true  → the form can read categoryId and redirect (Step 6.4).
 *   - ok:false → fieldErrors (zod, keyed by camelCase field) and/or formError
 *     (form-level, e.g. duplicate triple from P2002). Values are Thai.
 */
export type CategoryActionState =
  | { ok: true; categoryId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/**
 * Thai duplicate-triple message (Pitfall #22). Because the @@unique is full
 * (counts soft-deleted rows), a deleted triple still blocks re-creation — the
 * parenthetical hints at that without claiming the user can fix it.
 */
const DUPLICATE_MESSAGE =
  "หมวดบัญชีนี้มีอยู่แล้ว (หากเคยลบไปแล้ว จะยังสร้างซ้ำไม่ได้)";

/** Map the form's snake_case FormData onto the schema's camelCase shape. */
function rawFromFormData(formData: FormData): Record<string, unknown> {
  return {
    account: formData.get("account"),
    accountingSection: formData.get("accounting_section"),
    groupName: formData.get("group_name"),
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
      `${CATEGORY_FIELD_LABELS_TH[key as keyof CategoryInput] ?? key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/** Create a category under the caller's tenant. */
export async function createCategory(
  _prevState: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const { tenantId } = await requireTenant("master:write");

  const parsed = categoryInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const created = await createCategoryLogic(tenantId, parsed.data);
    revalidatePath("/categories");
    return { ok: true, categoryId: created.id };
  } catch (e) {
    if (e instanceof CategoryConflictError) {
      return { ok: false, formError: DUPLICATE_MESSAGE };
    }
    throw e; // unexpected → let the error boundary handle it
  }
}

/**
 * Update an existing category. `id` is bound by the form
 * (updateCategory.bind(null, id)); useActionState supplies prevState + formData.
 */
export async function updateCategory(
  id: string,
  _prevState: CategoryActionState,
  formData: FormData
): Promise<CategoryActionState> {
  const { tenantId } = await requireTenant("master:write");

  const parsed = categoryInputSchema.safeParse(rawFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const updated = await updateCategoryLogic(tenantId, id, parsed.data);
    if (!updated) {
      return { ok: false, formError: "ไม่พบหมวดบัญชีที่ต้องการแก้ไข" };
    }
    revalidatePath("/categories");
    revalidatePath(`/categories/${id}`);
    return { ok: true, categoryId: updated.id };
  } catch (e) {
    if (e instanceof CategoryConflictError) {
      return { ok: false, formError: DUPLICATE_MESSAGE };
    }
    throw e;
  }
}

/**
 * Soft-delete a category. No field validation — just ok/error so a tree row's
 * delete control can react. Cross-tenant/missing id → ok:false.
 */
export async function deleteCategory(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  const { tenantId } = await requireTenant("master:write");

  const deleted = await deleteCategoryLogic(tenantId, id);
  if (!deleted) {
    return { ok: false, error: "ไม่พบหมวดบัญชีที่ต้องการลบ" };
  }

  revalidatePath("/categories");
  return { ok: true };
}
