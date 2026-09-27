"use server";

// ============================================================
// Mise — menu Server Actions (Sprint 4 Part 19 L4, ADR 0019)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here.
//
// The one thing worth saying about this file is what it does NOT offer: there
// is no "accept all suggestions" action, and no action that takes a similarity
// score. Every alias is created by a person naming one dish (Q7). Thai menu
// names differ by one word for genuinely different dishes, so a bulk-accept
// button would be a bulk-merge button, and the damage would show up as revenue
// on the wrong dish now and the wrong ingredient consumed in Sprint 5.
//
// Per the 7a-8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3b) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  menuCategoryInputSchema,
  resolveMenuAliasInputSchema,
  updateMenuInputSchema,
} from "@/lib/validations/sales-import";
import {
  DepartmentNotFoundError,
  MenuCategoryNotFoundError,
  MenuNotFoundError,
  PosIntegrationNotFoundError,
  confirmMenuAliasLogic,
  createMenuCategoryLogic,
  suggestMenusLogic,
  updateMenuLogic,
} from "@/server/menu";
import {
  toMenuSuggestionRowView,
  type MenuSuggestionRowView,
} from "./_components/menu-view";

// --- Thai messages ---
const MENU_NOT_FOUND_MESSAGE = "ไม่พบเมนูนี้";
const CATEGORY_NOT_FOUND_MESSAGE = "ไม่พบหมวดนี้";
const DEPARTMENT_NOT_FOUND_MESSAGE = "ไม่พบแผนกนี้";
const POS_NOT_FOUND_MESSAGE = "ไม่พบเครื่อง POS นี้";
const DUPLICATE_CATEGORY_MESSAGE = "มีหมวดชื่อนี้อยู่แล้ว";

export type MenuActionState =
  | { ok: true; menuId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type MenuCategoryActionState =
  | { ok: true; menuCategoryId: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type MenuAliasActionState =
  | { ok: true; menuId: string; normalizedName: string }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

export type MenuSuggestionsState =
  | { ok: true; suggestions: MenuSuggestionRowView[] }
  | { ok: false; formError: string };

function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

function toFormError(e: unknown): {
  formError?: string;
  fieldErrors?: Record<string, string>;
} {
  if (e instanceof MenuNotFoundError) return { formError: MENU_NOT_FOUND_MESSAGE };
  if (e instanceof MenuCategoryNotFoundError) {
    return { fieldErrors: { menuCategoryId: CATEGORY_NOT_FOUND_MESSAGE } };
  }
  if (e instanceof DepartmentNotFoundError) {
    return { fieldErrors: { primaryDepartmentId: DEPARTMENT_NOT_FOUND_MESSAGE } };
  }
  if (e instanceof PosIntegrationNotFoundError) {
    return { formError: POS_NOT_FOUND_MESSAGE };
  }
  // The partial unique (tenant_id, name) WHERE deleted_at IS NULL.
  if (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  ) {
    return { fieldErrors: { name: DUPLICATE_CATEGORY_MESSAGE } };
  }
  throw e;
}

/**
 * Every surface a menu edit changes.
 *
 * `/sales` and `/cost` are included because a menu's category and department are
 * how its revenue is grouped: identifying one stub moves money between rows on
 * both pages, without a single sales row being touched.
 */
function revalidateMenuViews(): void {
  revalidatePath("/menus");
  revalidatePath("/sales");
  revalidatePath("/cost");
}

export async function updateMenuAction(
  _prev: MenuActionState | null,
  formData: FormData
): Promise<MenuActionState> {
  const { tenantId } = await requireTenant("master:write");

  const parsed = updateMenuInputSchema.safeParse({
    menuId: formData.get("menuId"),
    name: formData.get("name"),
    menuCategoryId: formData.get("menuCategoryId"),
    primaryDepartmentId: formData.get("primaryDepartmentId"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const menu = await updateMenuLogic(tenantId, parsed.data);
    revalidateMenuViews();
    return { ok: true, menuId: menu.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

export async function createMenuCategoryAction(
  _prev: MenuCategoryActionState | null,
  formData: FormData
): Promise<MenuCategoryActionState> {
  const { tenantId } = await requireTenant("master:write");

  const parsed = menuCategoryInputSchema.safeParse({
    name: formData.get("name"),
    displayOrder: formData.get("displayOrder"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const created = await createMenuCategoryLogic(tenantId, parsed.data);
    revalidateMenuViews();
    return { ok: true, menuCategoryId: created.id };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Point a spelling at a dish, and remember it (Q7).
 *
 * Note what this does NOT do: it does not move the sales already attached to a
 * stub. The alias applies from the next import onwards. Merging two menus that
 * both already hold revenue needs a decision about their histories — and about
 * their recipes — which is Sprint 5's, and until then the honest thing is to say
 * so rather than to half-do it.
 */
export async function confirmMenuAliasAction(
  _prev: MenuAliasActionState | null,
  formData: FormData
): Promise<MenuAliasActionState> {
  const { tenantId, user } = await requireTenant("master:write");

  const parsed = resolveMenuAliasInputSchema.safeParse({
    posIntegrationId: formData.get("posIntegrationId"),
    rawName: formData.get("rawName"),
    menuId: formData.get("menuId"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error) };

  try {
    const result = await confirmMenuAliasLogic(tenantId, user.id, parsed.data);
    revalidateMenuViews();
    return { ok: true, menuId: parsed.data.menuId, normalizedName: result.normalizedName };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Candidates for a spelling. Read-only, and the caller must present them as a
 * choice — there is no code path here that picks one.
 */
export async function getMenuSuggestionsAction(term: string): Promise<MenuSuggestionsState> {
  const { tenantId } = await requireTenant("master:write");
  try {
    const hits = await suggestMenusLogic(tenantId, term);
    return { ok: true, suggestions: hits.map(toMenuSuggestionRowView) };
  } catch {
    return { ok: false, formError: "ค้นหาเมนูใกล้เคียงไม่สำเร็จ" };
  }
}
