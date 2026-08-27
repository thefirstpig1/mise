// ============================================================
// Mise — a menu's lifecycle (Sprint 5 Part 27 L3a, ADR 0027)
// ============================================================
// The writers for two columns that have sat in the schema since Part 19 with
// nobody touching them: `menu.is_active` had no reader, `menu.deleted_at` had
// no writer.
//
// **THEY ARE NOT TWO GRADES OF THE SAME ACT** (Q1). เลิกขาย is available for
// every menu and is the answer for almost every real case. Deleting is
// available only for a menu whose deletion breaks nothing, which in practice
// means a row created in the Lab and abandoned.
//
// **WHY ITS OWN FILE.** `menu.ts` is 687 lines and holds the import's matching
// path — the most load-bearing read in the product. Lifecycle writes need
// `assertMenuNotUsedInRecipes` from `recipe-guards.ts`, which `menu.ts` has no
// business importing; keeping them apart means the matching path cannot acquire
// a dependency on the recipe graph by accident.
//
// **THE DELETE ORDER IS DELIBERATE.** Five hard blockers first, the one soft
// interruption LAST — so nobody can acknowledge their way forward only to hit a
// refusal they were never going to get past. The same ordering Part 25's
// `mergeMenusLogic` uses, for the same reason.
//
// **ONE TIMESTAMP, TWO TABLES.** The delete writes a single `Date` value into
// `menu.deleted_at` AND the recipe's, so the restore can tell what died in this
// act from what somebody deleted deliberately last week — by equality, not by a
// window. That is why Q3/Q8 could refuse two columns and still answer the
// questions they were asked for.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { MenuNotFoundError } from "@/server/menu";
import { assertMenuNotUsedInRecipes } from "@/server/recipe-guards";
import type {
  DeleteMenuInput,
  RestoreMenuInput,
  SetMenuActiveInput,
} from "@/lib/validations/menu-lifecycle";

type Tx = PrismaClient;

// ------------------------------------------------------------
// Typed errors — one per blocker, and every one of them NAMES something
// ------------------------------------------------------------
//
// A refusal that does not say what is in the way is a dead end for whoever has
// to act on it — the rule `ProductUsedInRecipeError` set in Part 21 and the
// recipe-delete guard repeated hours before this file was written.

/**
 * Blocker 1, and the one that is not really about this menu at all: the POS
 * code is held for ever by the row that owns it (`menu_pos_identity_unique` has
 * no `deleted_at` predicate, deliberately — ADR 0026). Delete the row and the
 * next file carrying that code misses byCode, falls into
 * `createStubMenusLogic`'s bare `create`, and takes the whole commit down.
 */
export class MenuHasPosCodeError extends Error {
  constructor(
    public readonly menuId: string,
    public readonly posMenuId: string
  ) {
    super(`Menu ${menuId} holds POS code "${posMenuId}" and cannot be deleted`);
    this.name = "MenuHasPosCodeError";
  }
}

/**
 * Blocker 2. Superseded rows count: they are kept as evidence of a replaced
 * import (ADR 0019 Q5), and evidence pointing at a menu no screen will show is
 * not evidence.
 *
 * This reaches MISE menus too — `planMenuResolutionLogic` matches by NAME over
 * `source: "MISE"` as well, so a dish created in the Lab can and does collect
 * money (ADR 0027 Context 5).
 */
export class MenuHasSalesError extends Error {
  constructor(
    public readonly menuId: string,
    public readonly salesLineCount: number
  ) {
    super(`Menu ${menuId} has ${salesLineCount} sales line(s) and cannot be deleted`);
    this.name = "MenuHasSalesError";
  }
}

/** Blocker 4 — a live merge on either side. Revoking is the way past it. */
export class MenuInLiveMergeError extends Error {
  constructor(
    public readonly menuId: string,
    /** Which side this menu is on, so the message can say what to do. */
    public readonly side: "loser" | "winner",
    public readonly otherMenuName: string
  ) {
    super(`Menu ${menuId} is the ${side} of a live merge with "${otherMenuName}"`);
    this.name = "MenuInLiveMergeError";
  }
}

/**
 * Blocker 5. `menu_alias` has no `deleted_at` and its query does not check that
 * its menu is alive, and ALIAS outranks NAME — so a dangling alias would send
 * real money to a deleted row, beating a live menu of the same name (Q8).
 */
export class MenuHasAliasError extends Error {
  constructor(
    public readonly menuId: string,
    public readonly spellings: string[]
  ) {
    super(
      `Menu ${menuId} is the target of ${spellings.length} confirmed POS spelling(s): ${spellings.join(", ")}`
    );
    this.name = "MenuHasAliasError";
  }
}

/**
 * The sixth, and the only soft one: this menu carries its own recipe, which the
 * delete takes with it. Refused once naming it; a second call carrying
 * `acknowledgeRecipe` goes through.
 *
 * Safe to allow at all only because blockers 1–5 have already passed, which
 * means this menu has never posted a movement — so there is no ledger day the
 * lost recipe could falsify.
 */
export class MenuRecipeWillBeDeletedError extends Error {
  constructor(
    public readonly menuId: string,
    public readonly recipeIds: string[]
  ) {
    super(
      `Deleting menu ${menuId} also deletes ${recipeIds.length} recipe line(s) it owns`
    );
    this.name = "MenuRecipeWillBeDeletedError";
  }
}

/** Restore asked for a menu that is not deleted — nothing to bring back. */
export class MenuNotDeletedError extends Error {
  constructor(public readonly menuId: string) {
    super(`Menu ${menuId} is not deleted`);
    this.name = "MenuNotDeletedError";
  }
}

// ------------------------------------------------------------
// เลิกขาย / กลับมาขาย
// ------------------------------------------------------------

/**
 * Stop or resume selling a dish (Q1/Q2).
 *
 * Available for EVERY live menu. There is no guard here and that is the
 * decision, not an omission: retiring must stay available for exactly the menus
 * that cannot be deleted, which is most of them.
 *
 * **It clears `is_pos_stub`.** `updateMenuLogic` clears it on save for the
 * reason that flag exists — somebody has now looked at this dish — and pressing
 * either lifecycle button is looking at it. Without this a retired stub sits in
 * the "รอตรวจ" queue for ever, which is a queue that has stopped being a queue.
 */
export async function setMenuActiveLogic(
  tenantId: string,
  input: SetMenuActiveInput
): Promise<{ id: string; isActive: boolean }> {
  return withTenantContext(tenantId, async (tx) => {
    const menu = await tx.menu.findFirst({
      where: { id: input.menuId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (menu === null) throw new MenuNotFoundError(input.menuId);

    return tx.menu.update({
      where: { id: input.menuId },
      data: { isActive: input.isActive, isPosStub: false },
      select: { id: true, isActive: true },
    });
  });
}

// ------------------------------------------------------------
// ลบ
// ------------------------------------------------------------

/** Live merges naming this menu on either side, with the other dish's name. */
async function liveMergesTouching(
  tx: Tx,
  tenantId: string,
  menuId: string
): Promise<{ side: "loser" | "winner"; otherMenuName: string } | null> {
  const row = await tx.menuMerge.findFirst({
    where: {
      tenantId,
      revokedAt: null,
      OR: [{ losingMenuId: menuId }, { winningMenuId: menuId }],
    },
    select: {
      losingMenuId: true,
      losingMenu: { select: { name: true } },
      winningMenu: { select: { name: true } },
    },
  });
  if (row === null) return null;

  return row.losingMenuId === menuId
    ? { side: "loser", otherMenuName: row.winningMenu.name }
    : { side: "winner", otherMenuName: row.losingMenu.name };
}

/**
 * Delete a menu — only ever one whose deletion breaks nothing (Q4/Q8).
 *
 * The five hard blockers run FIRST and in this order, so that a person who is
 * going to be refused is refused before being offered anything to acknowledge.
 * Reordering this so the recipe interruption comes first would let somebody
 * confirm the loss of a recipe and then be told the menu was never deletable.
 *
 * `recipe_ingredient` rows are LEFT STANDING on the deleted recipe, exactly as
 * `deleteRecipeLogic` leaves `recipe_branch` standing: they are inert the
 * moment their recipe is deleted, and they are what a restore needs.
 */
export async function deleteMenuLogic(
  tenantId: string,
  input: DeleteMenuInput
): Promise<{ id: string; deletedRecipeIds: string[] }> {
  return withTenantContext(tenantId, async (tx) => {
    const menu = await tx.menu.findFirst({
      where: { id: input.menuId, tenantId, deletedAt: null },
      select: { id: true, posMenuId: true },
    });
    if (menu === null) throw new MenuNotFoundError(input.menuId);

    // 1 — the POS code. Held for ever by the row that owns it.
    if (menu.posMenuId !== null) {
      throw new MenuHasPosCodeError(menu.id, menu.posMenuId);
    }

    // 2 — any sale ever, superseded ones included.
    const salesLineCount = await tx.salesLine.count({
      where: { tenantId, menuId: menu.id },
    });
    if (salesLineCount > 0) {
      throw new MenuHasSalesError(menu.id, salesLineCount);
    }

    // 3 — an ingredient of somebody else's recipe. Part 21 wrote this guard and
    // left a comment saying no delete path existed to call it; this is it.
    await assertMenuNotUsedInRecipes(tx, tenantId, menu.id);

    // 4 — a live merge, either side.
    const merge = await liveMergesTouching(tx, tenantId, menu.id);
    if (merge !== null) {
      throw new MenuInLiveMergeError(menu.id, merge.side, merge.otherMenuName);
    }

    // 5 — a confirmed POS spelling pointing here.
    const aliases = await tx.menuAlias.findMany({
      where: { tenantId, menuId: menu.id },
      select: { normalizedName: true },
    });
    if (aliases.length > 0) {
      throw new MenuHasAliasError(
        menu.id,
        aliases.map((a) => a.normalizedName)
      );
    }

    // 6 — the soft one. Drafts are excluded: the Lab discards those, and a
    // draft is true on no day (ADR 0025 Q4).
    const ownRecipes = await tx.recipe.findMany({
      where: { tenantId, menuId: menu.id, deletedAt: null, isDraft: false },
      select: { id: true },
    });
    if (ownRecipes.length > 0 && !input.acknowledgeRecipe) {
      throw new MenuRecipeWillBeDeletedError(
        menu.id,
        ownRecipes.map((r) => r.id)
      );
    }

    // ONE value, both tables. Equality is what tells the restore which recipes
    // died in THIS act — no column, no time window, no guessing.
    const deletedAt = new Date();

    // Drafts go too. A draft on a menu nothing will show is a draft nobody can
    // finish, and the Lab lists drafts by menu name.
    const recipeIds = await tx.recipe
      .findMany({
        where: { tenantId, menuId: menu.id, deletedAt: null },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id));

    if (recipeIds.length > 0) {
      await tx.recipe.updateMany({
        where: { id: { in: recipeIds } },
        data: { deletedAt },
      });
    }

    await tx.menu.update({
      where: { id: menu.id },
      data: { deletedAt },
    });

    return { id: menu.id, deletedRecipeIds: recipeIds };
  });
}

// ------------------------------------------------------------
// กู้คืน
// ------------------------------------------------------------

/**
 * Bring a deleted menu back, with whatever died alongside it (Q6/Q7).
 *
 * **Only the recipes whose `deletedAt` matches the menu's exactly.** A recipe
 * the person deleted deliberately last week carries a different timestamp and
 * stays deleted — restoring it would be resurrecting something nobody asked
 * for, which is the failure mode a "restore everything under this menu" would
 * have shipped with.
 *
 * No uniqueness check on the way back in. `menu` has no unique on name
 * (Context 4), and no recipe can have been written for this menu while it was
 * deleted, because every recipe write goes through `assertRefBelongsToTenant`,
 * which filters `deletedAt`.
 */
export async function restoreMenuLogic(
  tenantId: string,
  input: RestoreMenuInput
): Promise<{ id: string; restoredRecipeIds: string[] }> {
  return withTenantContext(tenantId, async (tx) => {
    const menu = await tx.menu.findFirst({
      where: { id: input.menuId, tenantId, deletedAt: { not: null } },
      select: { id: true, deletedAt: true },
    });
    if (menu === null) throw new MenuNotDeletedError(input.menuId);

    const recipeIds = await tx.recipe
      .findMany({
        where: { tenantId, menuId: menu.id, deletedAt: menu.deletedAt },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id));

    if (recipeIds.length > 0) {
      await tx.recipe.updateMany({
        where: { id: { in: recipeIds } },
        data: { deletedAt: null },
      });
    }

    await tx.menu.update({
      where: { id: menu.id },
      // A restored menu comes back SELLING. It was deleted, not retired, and
      // the two states are not grades of one act (Q1) — a menu that came back
      // silently retired would be a restore that half worked.
      data: { deletedAt: null, isActive: true },
    });

    return { id: menu.id, restoredRecipeIds: recipeIds };
  });
}

/**
 * The offer at the Lab door: is there a deleted menu by this name?
 *
 * Exact match on the trimmed name, not a fuzzy one. ADR 0019 Q7's rule holds
 * here as everywhere — a similarity score may SUGGEST and never decide — and
 * this result arms a button that brings back a recipe, so it has to be the
 * dish, not something that scored well.
 */
export async function findDeletedMenuByNameLogic(
  tenantId: string,
  name: string
): Promise<{ id: string; name: string; recipeCount: number } | null> {
  const trimmed = name.trim();
  if (trimmed === "") return null;

  return withTenantContext(tenantId, async (tx) => {
    const menu = await tx.menu.findFirst({
      where: {
        tenantId,
        deletedAt: { not: null },
        name: { equals: trimmed, mode: "insensitive" },
      },
      select: { id: true, name: true, deletedAt: true },
      // The most recently deleted one, if a shop somehow has two.
      orderBy: { deletedAt: "desc" },
    });
    if (menu === null) return null;

    const recipeCount = await tx.recipe.count({
      where: { tenantId, menuId: menu.id, deletedAt: menu.deletedAt },
    });

    return { id: menu.id, name: menu.name, recipeCount };
  });
}
