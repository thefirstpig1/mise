// ============================================================
// Mise — Menu Lab writes (Sprint 5 Part 24 L3a, ADR 0025)
// ============================================================
// Four writes, and each one is a deliberate departure from Part 21's recipe
// CRUD. The departures are the design, so they are stated here rather than
// discovered later:
//
// **A DRAFT IS NOT A LINE, so nothing checks it for uniqueness.** Part 21
// refuses a second central recipe for the same dish (`RecipeAlreadyExistsError`)
// because the resolver would then have to pick between two, by a tiebreak nobody
// chose. A draft is invisible to that resolver — `liveLinesFor` filters it, L3b
// pins that — so a draft of a dish that already sells is not a second anything.
// Drafting a change to a live dish is half of what Menu Lab is FOR.
//
// **AN EDIT TO A DRAFT WRITES NO VERSION.** Versions exist so a past day is
// costed against the recipe that was true THEN (ADR 0021 Q4). A draft is true on
// no day, so there is no past to protect and a history of what somebody typed
// while thinking is noise in the one list where the rows that matter must be
// findable.
//
// **THE GRAPH IS CHECKED AT PUBLISH, NOT AT SAVE.** `assertRecipeGraphValid`
// walks the graph THROUGH the resolver, which cannot see a draft — so a check at
// save time would validate the dish's published recipe and report on something
// the person did not write. Publishing is the moment a recipe becomes reachable,
// and that is where it must be sound.
//
// **PUBLISHING ADOPTS THE LIVE LINE.** A draft that replaces a dish's central
// recipe keeps that line's `lineId` and takes today as its effective date, so
// yesterday is still costed against yesterday's recipe. That is also why the
// screen has to say so before it happens: nothing about tomorrow's numbers looks
// different, and the past deliberately does not move.
//
// Money appears nowhere here, as in Part 21 — what a recipe costs is walked
// against the FIFO replay at read time (ADR 0014).
// ============================================================

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { assertRefBelongsToTenant } from "@/server/product";
import { assertRecipeGraphValid } from "@/server/recipe-guards";
import {
  RECIPE_WRITE_TIMEOUT_MS,
  RecipeNotFoundError,
  RecipeTargetImmutableError,
  assertWriteRefsValid,
  ingredientRowsFor,
  liveLinesFor,
  targetOf,
  type RecipeWithIngredients,
} from "@/server/recipe";
import type {
  DiscardDraftInput,
  DraftRecipeInput,
  PublishDraftInput,
} from "@/lib/validations/menu-lab";

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

/**
 * The row exists and is a real recipe — which is precisely why these doors
 * refuse it. Editing a published recipe appends a version and discarding one
 * removes the whole LINE; doing either through the lab's in-place writes would
 * rewrite days that have already been costed, and Part 22 has already posted
 * consumption against some of them.
 */
export class NotADraftError extends Error {
  constructor(public readonly id: string) {
    super(`Recipe "${id}" is not a draft`);
    this.name = "NotADraftError";
  }
}

/**
 * Publishing this draft takes over a dish that already has a live central
 * recipe. Not an error in itself — it is the point of the lab — but it changes
 * what every plate from today consumes while leaving yesterday untouched, so it
 * needs the person to have seen WHICH recipe stops applying (`acknowledgeReplace`).
 */
export class DraftReplacesLiveRecipeError extends Error {
  constructor(
    public readonly draftId: string,
    public readonly liveRecipeId: string
  ) {
    super(
      `Publishing draft "${draftId}" replaces live recipe "${liveRecipeId}"`
    );
    this.name = "DraftReplacesLiveRecipeError";
  }
}

/** A category that is not this tenant's, or was deleted while the form was open. */
export class MenuCategoryNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Menu category "${id}" does not belong to this tenant`);
    this.name = "MenuCategoryNotFoundError";
  }
}

// ------------------------------------------------------------
// Shared bits
// ------------------------------------------------------------

const DRAFT_INCLUDE = { ingredients: true } as const;

async function loadDraft(
  tx: PrismaClient,
  tenantId: string,
  recipeId: string
): Promise<RecipeWithIngredients> {
  const row = await tx.recipe.findFirst({
    where: { id: recipeId, tenantId, deletedAt: null },
    include: DRAFT_INCLUDE,
  });
  if (row === null) throw new RecipeNotFoundError(recipeId);
  return row;
}

/**
 * `menuCategory` is not one of `assertRefBelongsToTenant`'s kinds — it has no
 * `deletedAt` semantics in that helper's shape — so it is checked here rather
 * than by widening a union used by six other write paths.
 */
async function assertCategoryBelongsToTenant(
  tx: PrismaClient,
  tenantId: string,
  id: string | null
): Promise<void> {
  if (id === null) return;
  const row = await tx.menuCategory.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (row === null) throw new MenuCategoryNotFoundError(id);
}

// ------------------------------------------------------------
// Save a draft
// ------------------------------------------------------------

/**
 * Write a draft, and — for a dish that does not exist yet — the menu it hangs
 * off (Q3).
 *
 * The MISE menu is created inside the same transaction as the recipe, so a
 * draft that fails validation leaves no menu behind. It is created even when the
 * name matches a dish already in the list, and that is deliberate: two menus for
 * the same food is exactly the case Part 25's merging is for, and refusing here
 * would make the lab unusable for the shop whose POS spells things differently.
 * L5 shows the duplicate hint BEFORE Save, which is where a person can act on it.
 *
 * `effectiveFrom` is stamped today and means nothing while `isDraft` stands — a
 * draft resolves on no day. Publishing re-stamps it, and that stamp is the one
 * that counts.
 *
 * IDEMPOTENT by `submitKey`, used as the row's id — Part 13.5's pattern.
 */
export async function createDraftLogic(
  tenantId: string,
  input: DraftRecipeInput,
  createdBy: string
): Promise<RecipeWithIngredients> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const replay = await tx.recipe.findFirst({
        where: { tenantId, id: input.submitKey },
        include: DRAFT_INCLUDE,
      });
      if (replay !== null) return replay;

      let menuId = input.menuId;
      if (input.newMenuName !== null) {
        await assertCategoryBelongsToTenant(tx, tenantId, input.menuCategoryId);
        const menu = await tx.menu.create({
          data: {
            tenantId,
            // A menu Mise owns, not one a POS reported. Both POS columns stay
            // null — `menu_source_check` says the same.
            source: "MISE",
            name: input.newMenuName,
            menuCategoryId: input.menuCategoryId,
          },
          select: { id: true },
        });
        menuId = menu.id;
      }

      await assertWriteRefsValid(tx, tenantId, {
        menuId,
        outputProductId: null,
        ingredients: input.ingredients,
      });

      // No uniqueness check and no graph check — see the file header. A draft is
      // not a line, and it is not reachable until it is published.
      return tx.recipe.create({
        data: {
          id: input.submitKey,
          tenantId,
          lineId: randomUUID(),
          menuId,
          outputProductId: null,
          servings: new Prisma.Decimal(input.servings),
          effectiveFrom: computeBangkokToday(),
          isDraft: true,
          plannedPrice:
            input.plannedPrice === null
              ? null
              : new Prisma.Decimal(input.plannedPrice),
          notes: input.notes,
          createdBy,
          ingredients: { create: ingredientRowsFor(tenantId, input) },
        },
        include: DRAFT_INCLUDE,
      });
    },
    { timeout: RECIPE_WRITE_TIMEOUT_MS }
  );
}

/**
 * Edit a draft IN PLACE — no version, for the reason in the file header.
 *
 * The target cannot move. Nothing in the schema stops a draft being re-pointed,
 * but "this what-if is about a different dish now" is a different what-if, and
 * allowing it would give the MISE menu created by Save nothing left pointing at
 * it while the person believes they renamed something. Start another draft.
 */
export async function updateDraftLogic(
  tenantId: string,
  recipeId: string,
  input: DraftRecipeInput,
  updatedBy: string
): Promise<RecipeWithIngredients> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const draft = await loadDraft(tx, tenantId, recipeId);
      if (!draft.isDraft) throw new NotADraftError(recipeId);

      if (input.newMenuName !== null || input.menuId !== draft.menuId) {
        throw new RecipeTargetImmutableError(recipeId);
      }

      await assertWriteRefsValid(tx, tenantId, {
        menuId: draft.menuId,
        outputProductId: null,
        ingredients: input.ingredients,
      });

      // Replaced wholesale rather than diffed: the lines ARE the recipe, and a
      // diff would have to decide what a moved row means for a document nobody
      // has read yet.
      await tx.recipeIngredient.deleteMany({ where: { recipeId, tenantId } });

      return tx.recipe.update({
        where: { id: recipeId },
        data: {
          servings: new Prisma.Decimal(input.servings),
          plannedPrice:
            input.plannedPrice === null
              ? null
              : new Prisma.Decimal(input.plannedPrice),
          notes: input.notes,
          createdBy: updatedBy,
          ingredients: { create: ingredientRowsFor(tenantId, input) },
        },
        include: DRAFT_INCLUDE,
      });
    },
    { timeout: RECIPE_WRITE_TIMEOUT_MS }
  );
}

// ------------------------------------------------------------
// Publish
// ------------------------------------------------------------

/**
 * The draft stops being a what-if: `isDraft` clears, `effectiveFrom` becomes
 * today, and from this moment the resolver sees it and the ledger consumes
 * against it.
 *
 * Three things happen in order, and the order matters:
 *
 * 1. **The references are re-checked.** They were valid when the draft was
 *    saved, which may have been last month; a product deleted since then would
 *    otherwise go live inside a recipe.
 * 2. **A live central recipe for the same dish is adopted, not fought.** The
 *    draft takes that line's `lineId` and today's date, which is Part 21's "the
 *    kitchen changed on that day" — yesterday keeps yesterday's recipe. If the
 *    live version's own effective date IS today, the two would resolve on the
 *    same day, so the older one is superseded: same mechanism, same meaning as
 *    a correction in `updateRecipeLogic`.
 * 3. **The graph is validated last**, after the row is visible, so the walk
 *    judges the recipe that now exists rather than the one it replaced.
 *
 * Publishing something already published returns it. That is not a guard against
 * a double click so much as a refusal to have a second, quieter meaning for the
 * same button.
 */
export async function publishDraftLogic(
  tenantId: string,
  input: PublishDraftInput
): Promise<RecipeWithIngredients> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const draft = await loadDraft(tx, tenantId, input.recipeId);
      if (!draft.isDraft) return draft;

      const target = targetOf(draft);
      const today = computeBangkokToday();

      await assertWriteRefsValid(tx, tenantId, {
        menuId: draft.menuId,
        outputProductId: draft.outputProductId,
        ingredients: draft.ingredients,
      });

      // Drafts are filtered out of this, so the only thing it can find is a
      // recipe that really is live for this dish today.
      const live = await liveLinesFor(tx, tenantId, target);
      const central = live.find((l) => !l.hasBranches);

      if (central !== undefined && !input.acknowledgeReplace) {
        throw new DraftReplacesLiveRecipeError(draft.id, central.id);
      }

      const existing =
        central === undefined
          ? null
          : await tx.recipe.findFirst({
              where: { id: central.id, tenantId },
              select: { id: true, lineId: true, effectiveFrom: true },
            });

      const published = await tx.recipe.update({
        where: { id: draft.id },
        data: {
          isDraft: false,
          effectiveFrom: today,
          ...(existing === null ? {} : { lineId: existing.lineId }),
        },
        include: DRAFT_INCLUDE,
      });

      if (
        existing !== null &&
        existing.effectiveFrom.getTime() === today.getTime()
      ) {
        await tx.recipe.update({
          where: { id: existing.id },
          data: { supersededAt: new Date(), supersededById: published.id },
        });
      }

      await assertRecipeGraphValid(tx, tenantId, target, today);

      return published;
    },
    { timeout: RECIPE_WRITE_TIMEOUT_MS }
  );
}

// ------------------------------------------------------------
// Discard
// ------------------------------------------------------------

/**
 * It never was a recipe. Soft-deletes the draft row and nothing else.
 *
 * The MISE menu a "new dish" draft created stays: it may carry other drafts, and
 * a menu that once existed is what Part 25 reconciles if the dish later turns up
 * in the POS. It carries no sales, so it cannot move revenue, coverage or
 * consumption (ADR 0025 Consequence 3).
 */
export async function discardDraftLogic(
  tenantId: string,
  input: DiscardDraftInput
): Promise<{ id: string }> {
  return withTenantContext(tenantId, async (tx) => {
    const draft = await loadDraft(tx, tenantId, input.recipeId);
    if (!draft.isDraft) throw new NotADraftError(input.recipeId);

    await tx.recipe.update({
      where: { id: draft.id },
      data: { deletedAt: new Date() },
    });
    return { id: draft.id };
  });
}
