"use server";

// ============================================================
// Mise — recipe Server Actions (Sprint 5 Part 21 L4, ADR 0021)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. No rule is
// decided here — every refusal below was decided in L3 and is only being
// translated.
//
// Three things specific to this slice:
//
//   * **`submit_key` is READ from the form, never minted here** — the rule
//     goods-receipts/, stock/ and waste/ already follow. A server-minted key is
//     a fresh key on every retry, which is exactly the double-POST it exists to
//     close. Here that would write a second version of a recipe nobody changed
//     twice, and the history is meant to be a list of the days a dish changed.
//   * **`effective_from` is optional on the wire.** The form does not ask for
//     it; saving stamps today (Q4). Only the "แก้ย้อนหลัง" path sends one.
//   * **Two actions refuse once and succeed on the second identical POST** —
//     copy-to-branches and substitution both carry an acknowledgement flag. That
//     is not a nuisance: the first refusal is what makes the screen list the
//     branch recipes it is about to overwrite, and Q8 exists to keep that
//     deliberate.
//
// Per the 7a–8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import {
  copyRecipeToBranchesInputSchema,
  deleteRecipeInputSchema,
  ingredientRowsFromFormData,
  recipeInputSchema,
  substituteIngredientInputSchema,
} from "@/lib/validations/recipe";
import { computeBangkokToday } from "@/lib/bangkok-date";
import {
  RecipeAlreadyExistsError,
  RecipeBranchAlreadyDecidedError,
  RecipeNotFoundError,
  RecipeSupersededError,
  RecipeTargetImmutableError,
  RecipeUnitMismatchError,
  SubstitutionDuplicateError,
  SubstitutionTargetStaleError,
  SubstitutionTouchesBranchRecipesError,
  copyRecipeToBranchesLogic,
  createRecipeLogic,
  deleteRecipeLogic,
  substituteIngredientLogic,
  updateRecipeLogic,
} from "@/server/recipe";
import {
  RecipeCycleError,
  RecipeDepthExceededError,
  RecipeMethodConflictError,
  RecipeOutputNotPreppedError,
  MergedMenusDependOnRecipeError,
} from "@/server/recipe-guards";
import { RecipeMethodMissingError } from "@/server/recipe-graph";
import { CrossTenantReferenceError } from "@/server/product";
import { toRecipeView, type RecipeView } from "@/app/recipes/_components/recipe-view";

// ------------------------------------------------------------
// Thai messages
// ------------------------------------------------------------

const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const NOT_FOUND_MESSAGE = "ไม่พบสูตรนี้";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบตัวนั้น";

/** Q4: editing a version that a correction already replaced. */
const SUPERSEDED_MESSAGE =
  "สูตรเวอร์ชันนี้ถูกแก้ไปแล้ว — รบกวนรีเฟรชแล้วแก้จากเวอร์ชันล่าสุด";

/** A recipe makes one thing, for its whole life (see the error's own comment). */
const TARGET_IMMUTABLE_MESSAGE =
  "เปลี่ยนไม่ได้ว่าสูตรนี้ทำอะไร — ถ้าต้องการสูตรของเมนูอื่น ให้สร้างสูตรใหม่";

const ALREADY_EXISTS_MESSAGE =
  "มีสูตรกลางของรายการนี้อยู่แล้ว — แก้สูตรเดิม หรือคัดลอกไปเป็นสูตรของสาขา";

/** Q1, from the recipe side. */
const OUTPUT_NOT_PREPPED_MESSAGE =
  "สูตรผลิตต้องผลิต “ของแปรรูป” เท่านั้น — วัตถุดิบดิบไม่มีสูตรผลิต";
const METHOD_CONFLICT_MESSAGE =
  "ของแปรรูปนี้ระบุสินค้าแม่ + เปอร์เซ็นต์ผลผลิตไว้แล้ว — เลือกได้อย่างเดียว";

const SUBSTITUTION_STALE_MESSAGE =
  "บางสูตรไม่มีวัตถุดิบตัวนี้แล้ว — รบกวนรีเฟรชแล้วเลือกใหม่";

/**
 * A refusal has to say WHICH — "ลึกเกินไป" or "วนกลับมาหาตัวเอง" with no path is
 * a dead end for whoever has to fix it (Q3). The walker carries the chain in
 * NodeKey form (`m:<uuid>`), which is useless on screen; naming the dishes needs
 * a lookup L5's screen already has, so what the action gives is the shape of the
 * problem and the count.
 */
const CYCLE_MESSAGE =
  "บันทึกไม่ได้ — สูตรจะวนกลับมาหาตัวเอง (เมนูหนึ่งกลายเป็นส่วนประกอบของตัวเอง)";
const DEPTH_MESSAGE =
  "บันทึกไม่ได้ — สูตรจะซ้อนกันเกิน 5 ชั้น ลองลดชั้นของส่วนประกอบลง";

/** A PREPPED product whose yield is missing or zero — the walk cannot divide. */
const METHOD_MISSING_MESSAGE =
  "มีของแปรรูปในสูตรที่ยังไม่ได้ระบุเปอร์เซ็นต์ผลผลิต จึงคำนวณต่อไม่ได้";

/**
 * ADR 0026 Consequence 3, and the whole reason this Part exists: the names go IN
 * the sentence. "ลบไม่ได้เพราะมีเมนูอื่นใช้อยู่" would leave the person hunting
 * for menus that are, by construction, filed under a different spelling.
 *
 * It says ตัดสต๊อก rather than ต้นทุน on purpose — losing the cost figure is
 * visible on the next report, losing the DEDUCTION is not visible anywhere until
 * a stock count comes up short.
 */
function mergedMenusMessage(menuNames: string[]): string {
  return `เมนูที่ถูกรวมเข้ากับจานนี้ยังใช้สูตรนี้ตัดสต๊อกอยู่ — ${menuNames.join(", ")}

ถ้าลบ เมนูเหล่านี้จะขายต่อไปโดยไม่ตัดสต๊อกเลย กดลบอีกครั้งเพื่อยืนยัน`;
}

// ------------------------------------------------------------
// Action state
// ------------------------------------------------------------

export type RecipeActionState =
  | { ok: true; recipe: RecipeView }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Record<string, string>;
      /**
       * Q8's second pass: the branches that already keep their own recipe. The
       * screen lists them and re-submits with the acknowledgement, which is what
       * turns "we overwrote it" into "you were told and said yes".
       */
      needsAcknowledgement?: { branchNames: string[] };
    };

export type DeleteRecipeActionState =
  | { ok: true }
  | {
      ok: false;
      error: string;
      /**
       * ADR 0026 Consequence 3 — the menus that borrow this recipe. Present
       * ONLY on the first refusal; the screen shows the names and re-submits
       * with the acknowledgement, which is what turns "we deleted it" into
       * "you were told whose stock deduction stops".
       */
       needsAcknowledgement?: { mergedMenuNames: string[] };
    };

export type SubstitutionActionState =
  | { ok: true; changedCount: number }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Record<string, string>;
      needsAcknowledgement?: { branchNames: string[] };
    };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    // Nested paths (`ingredients.3.qty`) are joined, not truncated to the array
    // name: a form with a hundred ingredient rows needs to know WHICH row, and
    // collapsing them all to "ingredients" makes the error unactionable.
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Map a user-facing typed error → Thai field/form error; rethrow the rest.
 *
 * Deliberately NOT mapped: `GraphNodeMissingError`. That one means the loader
 * failed to fetch a node the walk reached, which is a bug in this codebase, not
 * something a user did — and a polite Thai form message would bury it where
 * nobody looks.
 */
function toFormError(e: unknown): {
  formError?: string;
  fieldErrors?: Record<string, string>;
  needsAcknowledgement?: { branchNames: string[] };
} {
  if (e instanceof CrossTenantReferenceError) {
    const field =
      e.kind === "menu"
        ? "menuId"
        : e.kind === "product"
          ? "outputProductId"
          : null;
    return field
      ? { fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof RecipeUnitMismatchError) {
    return { formError: UNIT_MISMATCH_MESSAGE };
  }
  if (e instanceof RecipeNotFoundError) return { formError: NOT_FOUND_MESSAGE };
  if (e instanceof RecipeSupersededError) {
    return { formError: SUPERSEDED_MESSAGE };
  }
  if (e instanceof RecipeTargetImmutableError) {
    return { formError: TARGET_IMMUTABLE_MESSAGE };
  }
  if (e instanceof RecipeAlreadyExistsError) {
    return { fieldErrors: { menuId: ALREADY_EXISTS_MESSAGE } };
  }
  if (e instanceof RecipeOutputNotPreppedError) {
    return { fieldErrors: { outputProductId: OUTPUT_NOT_PREPPED_MESSAGE } };
  }
  if (e instanceof RecipeMethodConflictError) {
    return { fieldErrors: { outputProductId: METHOD_CONFLICT_MESSAGE } };
  }
  if (e instanceof RecipeCycleError) return { formError: CYCLE_MESSAGE };
  if (e instanceof RecipeDepthExceededError) return { formError: DEPTH_MESSAGE };
  if (e instanceof RecipeMethodMissingError) {
    return { formError: METHOD_MISSING_MESSAGE };
  }
  if (e instanceof RecipeBranchAlreadyDecidedError) {
    return {
      formError: `${e.branchNames.length} สาขามีสูตรของตัวเองอยู่แล้ว: ${e.branchNames.join(", ")}`,
      needsAcknowledgement: { branchNames: e.branchNames },
    };
  }
  if (e instanceof SubstitutionTouchesBranchRecipesError) {
    return {
      formError: `มีสูตรของสาขารวมอยู่ด้วย: ${e.branchNames.join(", ")}`,
      needsAcknowledgement: { branchNames: e.branchNames },
    };
  }
  if (e instanceof SubstitutionTargetStaleError) {
    return { formError: SUBSTITUTION_STALE_MESSAGE };
  }
  if (e instanceof SubstitutionDuplicateError) {
    return {
      formError: `บางสูตรมี ${e.label} อยู่แล้ว — ระบบไม่รวมสองบรรทัดให้เอง รบกวนแก้สูตรนั้นเอง`,
    };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Every surface a recipe change moves.
 *
 * `/cost` is included because Sprint 4 put gross profit by สูตรอาหาร on it, and
 * `/menus` because a menu's food cost is read from its recipe. Neither is
 * obvious from this file, which is exactly why they are listed here rather than
 * left to whoever notices a stale figure.
 */
function revalidateRecipeViews(recipeId?: string): void {
  revalidatePath("/recipes");
  revalidatePath("/menus");
  revalidatePath("/cost");
  if (recipeId) revalidatePath(`/recipes/${recipeId}`);
}

// ------------------------------------------------------------
// Form parsing
// ------------------------------------------------------------

/**
 * `effective_from` is absent on a normal save and present only on "แก้ย้อนหลัง"
 * (Q4). Today is filled in HERE rather than defaulted in zod, because the schema
 * is shared with the substitution shape and a silent default there would let a
 * caller that genuinely forgot the field write a version dated today without
 * anyone choosing that.
 */
function effectiveFromFormData(formData: FormData): Date | string {
  const raw = formData.get("effective_from");
  return typeof raw === "string" && raw.trim() !== ""
    ? raw
    : computeBangkokToday();
}

function rawRecipeFromFormData(formData: FormData): Record<string, unknown> {
  return {
    submitKey: formData.get("submit_key"),
    menuId: formData.get("menu_id"),
    outputProductId: formData.get("output_product_id"),
    servings: formData.get("servings") ?? 1,
    effectiveFrom: effectiveFromFormData(formData),
    ingredients: ingredientRowsFromFormData(formData),
    notes: formData.get("notes"),
  };
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

/** Write the first version of a new central recipe (Q8: never a branch one). */
export async function createRecipeAction(
  _prevState: RecipeActionState,
  formData: FormData
): Promise<RecipeActionState> {
  const { tenantId, membership } = await requireTenant("recipe:write");

  const parsed = recipeInputSchema.safeParse(rawRecipeFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const recipe = await createRecipeLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateRecipeViews(recipe.id);
    return { ok: true, recipe: toRecipeView(recipe) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Edit a recipe. Whether this appends a version, corrects one, or touches
 * neither is decided in L3 by the effective date and by whether the arithmetic
 * moved — not here, and not by the form.
 */
export async function updateRecipeAction(
  recipeId: string,
  _prevState: RecipeActionState,
  formData: FormData
): Promise<RecipeActionState> {
  const { tenantId, membership } = await requireTenant("recipe:write");

  const parsed = recipeInputSchema.safeParse(rawRecipeFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const recipe = await updateRecipeLogic(
      tenantId,
      recipeId,
      parsed.data,
      membership.userId
    );
    revalidateRecipeViews(recipe.id);
    return { ok: true, recipe: toRecipeView(recipe) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Soft-delete the whole LINE — every version of it (see deleteRecipeLogic).
 *
 * Refuses ONCE where menus merged into this one borrow the recipe, naming them
 * (ADR 0026 Consequence 3); `acknowledgeMergedMenus` on the second call goes
 * through. The acknowledgement is a parameter rather than something this action
 * decides for itself, for the reason every other one in the codebase is: an
 * acknowledgement the screen could skip is not an acknowledgement.
 */
export async function deleteRecipeAction(
  recipeId: string,
  acknowledgeMergedMenus = false
): Promise<DeleteRecipeActionState> {
  const { tenantId } = await requireTenant("recipe:write");

  const parsed = deleteRecipeInputSchema.safeParse({ recipeId });
  if (!parsed.success) {
    return { ok: false, error: "รหัสสูตรไม่ถูกต้อง" };
  }

  try {
    const deleted = await deleteRecipeLogic(tenantId, parsed.data.recipeId, {
      acknowledgeMergedMenus,
    });
    if (!deleted) return { ok: false, error: NOT_FOUND_MESSAGE };
    revalidateRecipeViews();
    return { ok: true };
  } catch (e) {
    if (e instanceof RecipeNotFoundError) {
      return { ok: false, error: NOT_FOUND_MESSAGE };
    }
    if (e instanceof MergedMenusDependOnRecipeError) {
      return {
        ok: false,
        error: mergedMenusMessage(e.menuNames),
        needsAcknowledgement: { mergedMenuNames: e.menuNames },
      };
    }
    throw e;
  }
}

/**
 * Give the named branches their own copy (Q8) — the moment those branches stop
 * following central, and the reason the second pass has to carry proof the
 * person saw whose recipe is being displaced.
 */
export async function copyRecipeToBranchesAction(
  _prevState: RecipeActionState,
  formData: FormData
): Promise<RecipeActionState> {
  const { tenantId, membership } = await requireTenant("recipe:write");

  const parsed = copyRecipeToBranchesInputSchema.safeParse({
    submitKey: formData.get("submit_key"),
    sourceRecipeId: formData.get("source_recipe_id"),
    branchIds: formData.getAll("branch_id"),
    acknowledgeOverwrite: formData.get("acknowledge_overwrite") === "on",
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const copy = await copyRecipeToBranchesLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateRecipeViews(copy.id);
    return { ok: true, recipe: toRecipeView(copy) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Replace one ingredient across the ticked recipes (Q14).
 *
 * The quantities come from the form ROW BY ROW and are never defaulted here.
 * Where the swap crosses product type or unit, `getSubstitutionPlanLogic` sent
 * the screen an empty box on purpose (Q15) — filling it in on the way back would
 * reintroduce exactly the wrong default that rule exists to prevent.
 */
export async function substituteIngredientAction(
  _prevState: SubstitutionActionState,
  formData: FormData
): Promise<SubstitutionActionState> {
  const { tenantId, membership } = await requireTenant("recipe:write");

  const recipeIds = formData.getAll("target_recipe_id");
  const quantities = formData.getAll("target_qty");
  const unitIds = formData.getAll("target_product_unit_id");
  const targets = recipeIds.map((recipeId, i) => ({
    recipeId,
    qty: quantities[i] ?? "",
    productUnitId: unitIds[i] ?? null,
  }));

  const parsed = substituteIngredientInputSchema.safeParse({
    submitKey: formData.get("submit_key"),
    fromProductId: formData.get("from_product_id"),
    toProductId: formData.get("to_product_id"),
    toComponentMenuId: formData.get("to_component_menu_id"),
    targets,
    effectiveFrom: effectiveFromFormData(formData),
    acknowledgeBranchRecipes: formData.get("acknowledge_branch_recipes") === "on",
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const written = await substituteIngredientLogic(
      tenantId,
      parsed.data,
      membership.userId
    );
    revalidateRecipeViews();
    for (const v of written) revalidatePath(`/recipes/${v.id}`);
    return { ok: true, changedCount: written.length };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}
