"use server";

// ============================================================
// Mise — menu lifecycle Server Actions (Sprint 5 Part 27 L4, ADR 0027)
// ============================================================
// Thin glue: requireTenant → zod → *Logic → Thai error. No rule is decided
// here; every refusal below was decided in L3a and is only being translated.
//
// **ITS OWN FILE, not `actions.ts`.** That file is Part 19's, and its header
// says what it deliberately does not offer — a sentence about aliases that has
// nothing to do with retiring a dish. These four actions are also the ones the
// LAB calls (the restore offer), so a shared file would make `/menus/lab` a
// caller of the menu-identification glue.
//
// **EVERY DELETE REFUSAL NAMES SOMETHING, AND FIVE OF THEM POINT AT เลิกขาย.**
// A "cannot delete" with no next step sends somebody hunting; "cannot delete,
// use เลิกขาย instead" is the same sentence with the answer in it, and เลิกขาย
// genuinely IS the answer to all five (Q4).
//
// Per the 7a–8.5 convention this glue layer has NO unit tests: coverage = zod
// (L2) + logic (L3a) + the L6 E2E.
// ============================================================

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/require-tenant";
import {
  DELETE_BLOCKED_USE_RETIRE_TH,
  DELETE_TAKES_RECIPE_TH,
  deleteMenuInputSchema,
  restoreMenuInputSchema,
  setMenuActiveInputSchema,
} from "@/lib/validations/menu-lifecycle";
import { MenuNotFoundError } from "@/server/menu";
import { MenuUsedInRecipeError } from "@/server/recipe-guards";
import {
  MenuHasAliasError,
  MenuHasPosCodeError,
  MenuHasSalesError,
  MenuInLiveMergeError,
  MenuNotDeletedError,
  MenuRecipeWillBeDeletedError,
  deleteMenuLogic,
  findDeletedMenuByNameLogic,
  restoreMenuLogic,
  setMenuActiveLogic,
} from "@/server/menu-lifecycle";

// ------------------------------------------------------------
// Thai
// ------------------------------------------------------------

const MENU_NOT_FOUND_MESSAGE = "ไม่พบเมนูนี้";
const NOT_DELETED_MESSAGE = "เมนูนี้ไม่ได้ถูกลบไว้ จึงไม่มีอะไรให้กู้คืน";

/**
 * The five hard blockers, each saying what is in the way and where to go
 * instead. `DELETE_BLOCKED_USE_RETIRE_TH` is shared with the screens so the
 * button's tooltip and the server's refusal cannot tell different stories.
 */
function blockedMessage(e: unknown): string | null {
  if (e instanceof MenuHasPosCodeError) {
    return `${DELETE_BLOCKED_USE_RETIRE_TH} — เมนูนี้มีรหัสจาก POS (${e.posMenuId}) ซึ่งเรียกคืนไม่ได้ ถ้าลบ ไฟล์รอบหน้าที่มีรหัสนี้จะนำเข้าไม่ได้ทั้งไฟล์`;
  }
  if (e instanceof MenuHasSalesError) {
    return `${DELETE_BLOCKED_USE_RETIRE_TH} — เมนูนี้เคยมียอดขาย ${e.salesLineCount} รายการ ถ้าลบ รายงานย้อนหลังจะหาชื่อเมนูไม่เจอ`;
  }
  if (e instanceof MenuUsedInRecipeError) {
    return `${DELETE_BLOCKED_USE_RETIRE_TH} — เมนูนี้เป็นส่วนประกอบของ ${e.recipeNames.join(", ")}`;
  }
  if (e instanceof MenuInLiveMergeError) {
    const role = e.side === "loser" ? "ถูกรวมเข้ากับ" : "มีเมนูที่ถูกรวมเข้ามาคือ";
    return `${DELETE_BLOCKED_USE_RETIRE_TH} — เมนูนี้${role} “${e.otherMenuName}” อยู่ ถ้าจะลบจริง ต้องยกเลิกการรวมก่อน`;
  }
  if (e instanceof MenuHasAliasError) {
    return `${DELETE_BLOCKED_USE_RETIRE_TH} — มีชื่อจาก POS ${e.spellings.length} แบบที่ยืนยันแล้วว่าหมายถึงเมนูนี้`;
  }
  return null;
}

// ------------------------------------------------------------
// Action state
// ------------------------------------------------------------

export type MenuLifecycleActionState =
  | { ok: true; menuId: string }
  | {
      ok: false;
      error: string;
      /**
       * Present ONLY on the first delete refusal, and only the soft one. The
       * screen shows the count and re-submits with `acknowledgeRecipe` — which
       * is what turns "we deleted it" into "you were told what went with it".
       */
      needsAcknowledgement?: { recipeCount: number };
    };

export type DeletedMenuLookupState =
  | { ok: true; found: { id: string; name: string; recipeCount: number } | null }
  | { ok: false; error: string };

/**
 * Every surface a lifecycle change moves.
 *
 * `/menus/coverage` is here because retiring a dish relabels its coverage row
 * (Q5) without changing a figure, and `/recipes` because the recipe pickers
 * stop offering it (Q2). `/sales` and `/cost` are NOT here, deliberately: this
 * flag never moves a number on either, which is the whole of Q2.
 */
function revalidateLifecycleViews(): void {
  revalidatePath("/menus");
  revalidatePath("/menus/merges");
  revalidatePath("/menus/coverage");
  revalidatePath("/menus/lab");
  revalidatePath("/recipes");
}

// ------------------------------------------------------------
// Actions
// ------------------------------------------------------------

/** เลิกขาย / กลับมาขาย — available for every menu, which is the point (Q1). */
export async function setMenuActiveAction(
  menuId: string,
  isActive: boolean
): Promise<MenuLifecycleActionState> {
  const { tenantId } = await requireTenant("master:write");

  const parsed = setMenuActiveInputSchema.safeParse({ menuId, isActive });
  if (!parsed.success) return { ok: false, error: "เมนูไม่ถูกต้อง" };

  try {
    const menu = await setMenuActiveLogic(tenantId, parsed.data);
    revalidateLifecycleViews();
    return { ok: true, menuId: menu.id };
  } catch (e) {
    if (e instanceof MenuNotFoundError) {
      return { ok: false, error: MENU_NOT_FOUND_MESSAGE };
    }
    throw e;
  }
}

/**
 * Delete — refused by five blockers that name themselves, and interrupted once
 * by the sixth when the menu carries its own recipe.
 *
 * `acknowledgeRecipe` is a parameter rather than something this action decides,
 * for the reason every acknowledgement in this codebase is: one the screen
 * could skip is not an acknowledgement.
 */
export async function deleteMenuAction(
  menuId: string,
  acknowledgeRecipe = false
): Promise<MenuLifecycleActionState> {
  const { tenantId } = await requireTenant("recipe:write");

  const parsed = deleteMenuInputSchema.safeParse({ menuId, acknowledgeRecipe });
  if (!parsed.success) return { ok: false, error: "เมนูไม่ถูกต้อง" };

  try {
    const res = await deleteMenuLogic(tenantId, parsed.data);
    revalidateLifecycleViews();
    return { ok: true, menuId: res.id };
  } catch (e) {
    if (e instanceof MenuNotFoundError) {
      return { ok: false, error: MENU_NOT_FOUND_MESSAGE };
    }
    if (e instanceof MenuRecipeWillBeDeletedError) {
      return {
        ok: false,
        error: DELETE_TAKES_RECIPE_TH,
        needsAcknowledgement: { recipeCount: e.recipeIds.length },
      };
    }
    const blocked = blockedMessage(e);
    if (blocked !== null) return { ok: false, error: blocked };
    throw e;
  }
}

/** Restore, from the Lab door and nowhere else (Q7). */
export async function restoreMenuAction(
  menuId: string
): Promise<MenuLifecycleActionState> {
  const { tenantId } = await requireTenant("recipe:write");

  const parsed = restoreMenuInputSchema.safeParse({ menuId });
  if (!parsed.success) return { ok: false, error: "เมนูไม่ถูกต้อง" };

  try {
    const res = await restoreMenuLogic(tenantId, parsed.data);
    revalidateLifecycleViews();
    return { ok: true, menuId: res.id };
  } catch (e) {
    if (e instanceof MenuNotDeletedError) {
      return { ok: false, error: NOT_DELETED_MESSAGE };
    }
    throw e;
  }
}

/**
 * The Lab's offer: is there a deleted menu by exactly this name?
 *
 * Called as the person types the name of a dish they are about to create. It
 * returns `null` far more often than not, and a `null` is not an error — there
 * is simply nothing to offer.
 */
export async function findDeletedMenuByNameAction(
  name: string
): Promise<DeletedMenuLookupState> {
  const { tenantId } = await requireTenant("master:write");

  if (typeof name !== "string") return { ok: true, found: null };

  const found = await findDeletedMenuByNameLogic(tenantId, name);
  return { ok: true, found };
}
