"use server";

// ============================================================
// Mise — Menu Lab Server Actions (Sprint 5 Part 24 L4, ADR 0025)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error → view. Every refusal
// below was decided in L3a and is only being translated here.
//
// Four things specific to the lab, none of which the recipe actions have:
//
//   * **The what-if is an action that writes NOTHING.** `getLabWhatIfAction`
//     exists because the arithmetic cannot happen in the browser: the cost
//     comes from a FIFO replay in the database, and a ratio recomputed client
//     side from a rounded string is a second answer waiting to disagree with
//     the first. It takes the SAME FormData the save takes, so the number on
//     screen is priced from the very rows Save would write — not from a
//     hand-built copy of them that can drift by one field.
//   * **`submit_key` is read from the form, never minted here** — the rule the
//     recipe, goods-receipt and waste actions already follow. A server-minted
//     key is a fresh key on every retry, which is the double-POST it exists to
//     close; here that would write a second draft of a dish nobody drafted
//     twice.
//   * **Publish refuses once, on purpose.** Taking over a dish that already
//     sells changes what every plate from today consumes while yesterday stays
//     costed against yesterday's recipe — so nothing on screen looks different
//     tomorrow, and that is exactly why the person has to be told WHICH recipe
//     stops applying before it happens. The second POST carries the
//     acknowledgement. Same shape as Q8's branch copy and Part 19's import
//     preview.
//   * **Discard is not delete.** It never was a recipe, and the MISE menu a
//     "new dish" draft created stays behind (ADR 0025 Consequence 3), so this
//     action revalidates `/menus` too.
//
// Per the 7a–8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3a/L3c/L3d) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { requireTenant } from "@/lib/require-tenant";
import { ingredientRowsFromFormData } from "@/lib/validations/recipe";
import {
  discardDraftInputSchema,
  draftRecipeInputSchema,
  labWhatIfQuerySchema,
  publishDraftInputSchema,
} from "@/lib/validations/menu-lab";
import {
  DraftReplacesLiveRecipeError,
  MenuCategoryNotFoundError,
  NotADraftError,
  createDraftLogic,
  discardDraftLogic,
  publishDraftLogic,
  updateDraftLogic,
} from "@/server/menu-lab";
import { NoBranchForCostError, getLabWhatIfLogic } from "@/server/menu-lab-read";
import {
  RecipeAlreadyExistsError,
  RecipeNotFoundError,
  RecipeTargetImmutableError,
  RecipeUnitMismatchError,
} from "@/server/recipe";
import {
  RecipeCycleError,
  RecipeDepthExceededError,
} from "@/server/recipe-guards";
import { RecipeMethodMissingError } from "@/server/recipe-graph";
import { CrossTenantReferenceError } from "@/server/product";
import {
  toDraftView,
  toLabWhatIfView,
  type DraftView,
  type LabWhatIfView,
} from "@/app/menus/_components/menu-lab-view";

// ------------------------------------------------------------
// Thai messages
// ------------------------------------------------------------

const CROSS_TENANT_MESSAGE = "ข้อมูลอ้างอิงไม่อยู่ในระบบของคุณ";
const NOT_FOUND_MESSAGE = "ไม่พบสูตรที่กำลังร่างนี้";
const UNIT_MISMATCH_MESSAGE = "หน่วยที่เลือกต้องเป็นหน่วยของวัตถุดิบตัวนั้น";
const CATEGORY_NOT_FOUND_MESSAGE = "ไม่พบหมวดนี้ — รบกวนรีเฟรชแล้วเลือกใหม่";

/**
 * The row is a real recipe, not a draft. Reached by a stale tab: somebody
 * published in another window and this one still shows the draft's buttons.
 */
const NOT_A_DRAFT_MESSAGE =
  "สูตรนี้ถูกเผยแพร่ไปแล้ว จึงแก้หรือลบจากหน้าทดลองเมนูไม่ได้ — รบกวนรีเฟรชแล้วแก้ที่หน้าสูตรอาหาร";

/** The target cannot move — see `updateDraftLogic`'s own comment. */
const TARGET_IMMUTABLE_MESSAGE =
  "เปลี่ยนไม่ได้ว่าสูตรที่ร่างไว้นี้เป็นของเมนูไหน — ถ้าคิดถึงเมนูอื่น ให้เริ่มร่างใหม่";

const ALREADY_EXISTS_MESSAGE =
  "มีสูตรกลางของรายการนี้อยู่แล้ว — เผยแพร่ร่างนี้เพื่อใช้แทนสูตรเดิม";

const CYCLE_MESSAGE =
  "เผยแพร่ไม่ได้ — สูตรจะวนกลับมาหาตัวเอง (เมนูหนึ่งกลายเป็นส่วนประกอบของตัวเอง)";
const DEPTH_MESSAGE =
  "เผยแพร่ไม่ได้ — สูตรจะซ้อนกันเกิน 5 ชั้น ลองลดชั้นของส่วนประกอบลง";
const METHOD_MISSING_MESSAGE =
  "มีของแปรรูปในสูตรที่ยังไม่ได้ระบุเปอร์เซ็นต์ผลผลิต จึงคำนวณต่อไม่ได้";

/**
 * ADR 0014 Q9: a cost is always a cost AT a branch. A tenant with no branch is
 * not a shape the lab can guess its way out of — every figure it exists to show
 * would be about nowhere.
 */
const NO_BRANCH_MESSAGE =
  "ยังไม่มีสาขาในระบบ จึงคำนวณต้นทุนไม่ได้ — เพิ่มสาขาก่อนแล้วลองใหม่";

// ------------------------------------------------------------
// Action state
// ------------------------------------------------------------

export type DraftActionState =
  | { ok: true; draft: DraftView }
  | {
      ok: false;
      formError?: string;
      fieldErrors?: Record<string, string>;
      /**
       * Publish's second pass. The screen names the recipe that stops applying
       * and re-submits with the acknowledgement — which is what turns "the dish
       * silently changed" into "you were told and said yes".
       */
      needsAcknowledgement?: { liveRecipeId: string };
    };

export type DiscardDraftActionState = { ok: true } | { ok: false; error: string };

export type LabWhatIfState =
  | { ok: true; whatIf: LabWhatIfView }
  | { ok: false; formError?: string; fieldErrors?: Record<string, string> };

/** Flatten zod issues to `{ fieldName: thaiMessage }`, first issue per field. */
function toFieldErrors(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    // Nested paths (`ingredients.3.qty`) are joined, not truncated: a form with
    // twenty rows needs to know WHICH row.
    const key = issue.path.length ? issue.path.join(".") : "form";
    if (key in fieldErrors) continue;
    fieldErrors[key] = issue.message || `${key}ไม่ถูกต้อง`;
  }
  return fieldErrors;
}

/**
 * Map a typed error → Thai field/form error; rethrow the rest.
 *
 * `DraftReplacesLiveRecipeError` is mapped but is NOT a failure — it is the
 * first half of a two-step the person completes. It is carried as an error
 * because it must interrupt: an acknowledgement the screen could skip is not an
 * acknowledgement.
 */
function toFormError(e: unknown): {
  formError?: string;
  fieldErrors?: Record<string, string>;
  needsAcknowledgement?: { liveRecipeId: string };
} {
  if (e instanceof CrossTenantReferenceError) {
    const field = e.kind === "menu" ? "menuId" : null;
    return field
      ? { fieldErrors: { [field]: CROSS_TENANT_MESSAGE } }
      : { formError: CROSS_TENANT_MESSAGE };
  }
  if (e instanceof MenuCategoryNotFoundError) {
    return { fieldErrors: { menuCategoryId: CATEGORY_NOT_FOUND_MESSAGE } };
  }
  if (e instanceof RecipeUnitMismatchError) {
    return { formError: UNIT_MISMATCH_MESSAGE };
  }
  if (e instanceof RecipeNotFoundError) return { formError: NOT_FOUND_MESSAGE };
  if (e instanceof NotADraftError) return { formError: NOT_A_DRAFT_MESSAGE };
  if (e instanceof RecipeTargetImmutableError) {
    return { formError: TARGET_IMMUTABLE_MESSAGE };
  }
  if (e instanceof RecipeAlreadyExistsError) {
    return { fieldErrors: { menuId: ALREADY_EXISTS_MESSAGE } };
  }
  if (e instanceof DraftReplacesLiveRecipeError) {
    return {
      formError:
        "เมนูนี้มีสูตรกลางใช้งานอยู่แล้ว — เผยแพร่ร่างนี้จะใช้สูตรใหม่ตั้งแต่วันนี้ ส่วนยอดของวันก่อนหน้ายังคิดด้วยสูตรเดิม",
      needsAcknowledgement: { liveRecipeId: e.liveRecipeId },
    };
  }
  if (e instanceof RecipeCycleError) return { formError: CYCLE_MESSAGE };
  if (e instanceof RecipeDepthExceededError) return { formError: DEPTH_MESSAGE };
  if (e instanceof RecipeMethodMissingError) {
    return { formError: METHOD_MISSING_MESSAGE };
  }
  if (e instanceof NoBranchForCostError) {
    return { formError: NO_BRANCH_MESSAGE };
  }
  throw e; // unexpected → let the error boundary handle it
}

/**
 * Every surface a draft moves.
 *
 * `/menus` is here because a "new dish" draft CREATES a menu (Q3) and it shows
 * up in that list at once. `/recipes` and `/cost` matter only on publish — but
 * listing them per-action would mean deciding, at four call sites, which of
 * them a write can reach, and the cost of a stale ฿ figure is higher than the
 * cost of one extra revalidation.
 */
function revalidateLabViews(recipeId?: string): void {
  revalidatePath("/menus/lab");
  revalidatePath("/menus/coverage");
  revalidatePath("/menus");
  revalidatePath("/recipes");
  revalidatePath("/cost");
  if (recipeId) revalidatePath(`/menus/lab/${recipeId}`);
}

// ------------------------------------------------------------
// Form parsing
// ------------------------------------------------------------

/**
 * The lab posts the recipe rows in the same parallel-array shape the recipe
 * form uses — hence the shared parser — plus the two fields only a draft has.
 *
 * `effective_from` is absent by design: a draft is true on no day (L2), and
 * publishing stamps today. There is no "แก้ย้อนหลัง" path into the lab.
 */
function rawDraftFromFormData(formData: FormData): Record<string, unknown> {
  return {
    submitKey: formData.get("submit_key"),
    menuId: formData.get("menu_id"),
    newMenuName: formData.get("new_menu_name"),
    menuCategoryId: formData.get("menu_category_id"),
    servings: formData.get("servings") ?? 1,
    plannedPrice: formData.get("planned_price"),
    ingredients: ingredientRowsFromFormData(formData),
    notes: formData.get("notes"),
  };
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

/**
 * Save a draft — and, for a dish that does not exist yet, the menu it hangs off
 * (Q3).
 *
 * No uniqueness check and no graph check: a draft is not a line and is not
 * reachable by the resolver, so the checks that guard live recipes are made at
 * publish, against the recipe that will actually apply.
 */
export async function createDraftAction(
  _prevState: DraftActionState,
  formData: FormData
): Promise<DraftActionState> {
  const { tenantId, membership } = await requireTenant("recipe:write");

  const parsed = draftRecipeInputSchema.safeParse(rawDraftFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const draft = await createDraftLogic(tenantId, parsed.data, membership.userId);
    revalidateLabViews(draft.id);
    return { ok: true, draft: toDraftView(draft) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * Edit a draft IN PLACE. No version is appended — versions exist so a past day
 * is costed against the recipe true then (ADR 0021 Q4), and a draft is true on
 * no day, so there is no past to protect.
 */
export async function updateDraftAction(
  recipeId: string,
  _prevState: DraftActionState,
  formData: FormData
): Promise<DraftActionState> {
  const { tenantId, membership } = await requireTenant("recipe:write");

  const parsed = draftRecipeInputSchema.safeParse(rawDraftFromFormData(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const draft = await updateDraftLogic(
      tenantId,
      recipeId,
      parsed.data,
      membership.userId
    );
    revalidateLabViews(draft.id);
    return { ok: true, draft: toDraftView(draft) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * The draft stops being a what-if: from this moment the resolver can see it and
 * the ledger consumes against it.
 *
 * Refuses once when the dish already has a live central recipe, so the screen
 * can say which one stops applying (`acknowledge_replace`).
 */
export async function publishDraftAction(
  _prevState: DraftActionState,
  formData: FormData
): Promise<DraftActionState> {
  const { tenantId } = await requireTenant("recipe:write");

  const parsed = publishDraftInputSchema.safeParse({
    recipeId: formData.get("recipe_id"),
    acknowledgeReplace: formData.get("acknowledge_replace"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  try {
    const published = await publishDraftLogic(tenantId, parsed.data);
    revalidateLabViews(published.id);
    revalidatePath(`/recipes/${published.id}`);
    return { ok: true, draft: toDraftView(published) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}

/**
 * It never was a recipe. Soft-deletes the draft row and nothing else — the MISE
 * menu a "new dish" draft created stays, because it may carry other drafts and
 * is what Part 25 reconciles if the dish later turns up in the POS.
 */
export async function discardDraftAction(
  recipeId: string
): Promise<DiscardDraftActionState> {
  const { tenantId } = await requireTenant("recipe:write");

  const parsed = discardDraftInputSchema.safeParse({ recipeId });
  if (!parsed.success) {
    return { ok: false, error: "รหัสสูตรไม่ถูกต้อง" };
  }

  try {
    await discardDraftLogic(tenantId, parsed.data);
    revalidateLabViews();
    return { ok: true };
  } catch (e) {
    if (e instanceof RecipeNotFoundError) {
      return { ok: false, error: NOT_FOUND_MESSAGE };
    }
    if (e instanceof NotADraftError) {
      return { ok: false, error: NOT_A_DRAFT_MESSAGE };
    }
    throw e;
  }
}

/**
 * "฿89 or ฿99?" — the whole point of the lab, and it writes nothing.
 *
 * It takes the same FormData as Save so that the figure on screen is priced
 * from the rows Save would write. `ingredients` may be empty here and only
 * here: an empty calculator is a screen somebody just opened, and it answers
 * ฿0 at LOW confidence rather than a confident zero.
 *
 * No `revalidatePath` — nothing changed. A read that invalidates caches is a
 * read that will one day be blamed for a write.
 */
export async function getLabWhatIfAction(
  formData: FormData
): Promise<LabWhatIfState> {
  const { tenantId, reach, assertBranch} = await requireTenant("recipe:write");

  const parsed = labWhatIfQuerySchema.safeParse({
    branchId: formData.get("branch_id"),
    servings: formData.get("servings") ?? 1,
    plannedPrice: formData.get("planned_price"),
    ingredients: ingredientRowsFromFormData(formData),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: toFieldErrors(parsed.error) };
  }

  if (parsed.data.branchId) assertBranch(parsed.data.branchId);

  try {
    const whatIf = await getLabWhatIfLogic(tenantId, parsed.data, reach);
    return { ok: true, whatIf: toLabWhatIfView(whatIf) };
  } catch (e) {
    return { ok: false, ...toFormError(e) };
  }
}
