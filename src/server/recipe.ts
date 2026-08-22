// ============================================================
// Mise — recipe CRUD (Sprint 5 Part 21 L3a, ADR 0021)
// ============================================================
// Four writes, and three of them are unusual enough to state up front.
//
// **AN EDIT APPENDS A VERSION** (Q4). `recipe` is not a row that gets updated in
// place; a line is a stack of versions sharing `lineId`, and the one that
// applies on a given day is resolved at read (`recipe-resolve.ts`). This is not
// tidiness — Part 19 imports periodically, so Part 22 posts consumption for
// thirty past days in one pass, and a table that only knows today's recipe posts
// all thirty against it and overstates pork by 20 g a plate for a fortnight with
// nothing on screen looking wrong.
//
// **A CORRECTION SUPERSEDES; A CHANGE DOES NOT.** Saving with the same effective
// date as the version being edited means "that version was wrong" — it is
// stamped `supersededAt` and vanishes from resolution at every date. Saving with
// a later date means "the kitchen changed on that day" and leaves the old
// version alive and correct for the days it covered. One mechanism, two
// meanings, and the UI picks between them by whether the person opened
// "แก้ย้อนหลัง".
//
// **A VERSION IS WRITTEN ONLY WHEN THE ARITHMETIC CHANGES** (Q4). Editing the
// notes updates the row in place, because a history filled with rows of
// identical cost is a history in which the rows that matter cannot be found.
//
// **COPYING TO A BRANCH CREATES A NEW LINE** (Q8). It is the branch declaring it
// decides for itself, and from that moment nothing central reaches it. Which is
// why the copy is a fresh `lineId` with its own `recipe_branch` rows, and not a
// branch column on a shared row.
//
// Money appears nowhere in this file. What a recipe costs is answered by walking
// it against the FIFO replay at read time (L3b, ADR 0014), and a stored copy
// would be falsified by the next backdated receipt with nothing to detect it.
// ============================================================

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { assertRefBelongsToTenant } from "@/server/product";
import {
  assertMethodExclusivityForRecipe,
  assertRecipeGraphValid,
} from "@/server/recipe-guards";
import type { RecipeTarget } from "@/server/recipe-resolve";
import type {
  CopyRecipeToBranchesInput,
  RecipeInput,
} from "@/lib/validations/recipe";

/**
 * The guard walk makes several round trips per probe context, and a write that
 * happens once an hour can afford them. Prisma's 5 s default cannot — the same
 * call ADR 0013 Consequence 5 made for a twenty-line goods receipt.
 */
const RECIPE_WRITE_TIMEOUT_MS = 20_000;

export type RecipeWithIngredients = Prisma.RecipeGetPayload<{
  include: { ingredients: true };
}>;

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

export class RecipeNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Recipe "${id}" does not exist for this tenant`);
    this.name = "RecipeNotFoundError";
  }
}

/**
 * The version being edited has already been marked wrong. Editing it would
 * produce a successor to something excluded from every resolution — a row
 * nothing can ever read.
 */
export class RecipeSupersededError extends Error {
  constructor(public readonly id: string) {
    super(`Recipe "${id}" has been superseded and cannot be edited`);
    this.name = "RecipeSupersededError";
  }
}

/**
 * Changing what a recipe MAKES is not an edit, it is a different recipe. Letting
 * it through would silently re-point every past version of the line — including
 * the days Part 22 has already posted consumption against.
 */
export class RecipeTargetImmutableError extends Error {
  constructor(public readonly id: string) {
    super(`Recipe "${id}" cannot be re-pointed at a different menu or product`);
    this.name = "RecipeTargetImmutableError";
  }
}

/**
 * A second CENTRAL line for the same thing. Nothing in the schema stops it (the
 * condition spans `recipe` and `recipe_branch`), and the resolver would have to
 * pick between them by a tiebreak nobody chose — so the answer would be stable
 * and still arbitrary. A shop that wants a different recipe wants an EDIT, or a
 * branch copy.
 */
export class RecipeAlreadyExistsError extends Error {
  constructor(
    public readonly target: RecipeTarget,
    public readonly existingRecipeId: string
  ) {
    super(
      `A central recipe already exists for ${target.kind} ${target.id} (${existingRecipeId})`
    );
    this.name = "RecipeAlreadyExistsError";
  }
}

/**
 * The unit on an ingredient line must belong to the product that line names.
 * Matching on `productId` is also what makes a cross-tenant unit unreachable —
 * the product itself is asserted first.
 */
export class RecipeUnitMismatchError extends Error {
  constructor(
    public readonly productUnitId: string,
    public readonly productId: string
  ) {
    super(`Unit "${productUnitId}" does not belong to product "${productId}"`);
    this.name = "RecipeUnitMismatchError";
  }
}

/**
 * Q8's whole point, arriving through the door Q8 opened: copying onto a branch
 * that already keeps its own recipe would discard a decision that branch made.
 * The screen lists the branches and the second pass carries proof the person saw
 * them — the same shape as Part 19's import preview.
 */
export class RecipeBranchAlreadyDecidedError extends Error {
  constructor(public readonly branchNames: string[]) {
    super(
      `${branchNames.length} branch(es) already keep their own recipe: ${branchNames.join(", ")}`
    );
    this.name = "RecipeBranchAlreadyDecidedError";
  }
}

// ------------------------------------------------------------
// Shared guards
// ------------------------------------------------------------

const targetOf = (r: {
  menuId: string | null;
  outputProductId: string | null;
}): RecipeTarget =>
  r.menuId !== null
    ? { kind: "menu", id: r.menuId }
    : { kind: "product", id: r.outputProductId as string };

/**
 * Every id the person could have typed, checked against this tenant, plus Q1's
 * cross-table method exclusivity for a production recipe.
 *
 * The unit check is per line and deliberately not batched: a recipe holds at
 * most a hundred lines (L2's cap) and the failure has to name WHICH line, which
 * a set-difference over one batched query would lose.
 */
async function assertWriteRefsValid(
  tx: PrismaClient,
  tenantId: string,
  input: Pick<RecipeInput, "menuId" | "outputProductId" | "ingredients">
): Promise<void> {
  await assertRefBelongsToTenant(tx, tenantId, "menu", input.menuId);
  await assertRefBelongsToTenant(tx, tenantId, "product", input.outputProductId);

  if (input.outputProductId !== null) {
    await assertMethodExclusivityForRecipe(tx, tenantId, input.outputProductId);
  }

  for (const line of input.ingredients) {
    if (line.productId !== null) {
      await assertRefBelongsToTenant(tx, tenantId, "product", line.productId);
      const unit = await tx.productUnit.findFirst({
        where: { id: line.productUnitId as string, productId: line.productId },
        select: { id: true },
      });
      if (unit === null) {
        throw new RecipeUnitMismatchError(
          line.productUnitId as string,
          line.productId
        );
      }
    } else {
      await assertRefBelongsToTenant(tx, tenantId, "menu", line.componentMenuId);
    }
  }
}

/** The ingredient rows for one version, ready for a nested create. */
const ingredientRowsFor = (tenantId: string, input: RecipeInput) =>
  input.ingredients.map((line) => ({
    tenantId,
    productId: line.productId,
    componentMenuId: line.componentMenuId,
    qty: new Prisma.Decimal(line.qty),
    productUnitId: line.productUnitId,
    sortOrder: line.sortOrder,
    notes: line.notes,
  }));

/**
 * Which lines exist for this thing today, and whether any of them is central.
 * "Central" is the line with NO `recipe_branch` rows at all — a line attached to
 * other branches is not a fallback, it belongs to them (Q8).
 */
async function liveLinesFor(
  tx: PrismaClient,
  tenantId: string,
  target: RecipeTarget
): Promise<{ id: string; lineId: string; hasBranches: boolean }[]> {
  const rows = await tx.recipe.findMany({
    where: {
      tenantId,
      deletedAt: null,
      supersededAt: null,
      ...(target.kind === "menu"
        ? { menuId: target.id }
        : { outputProductId: target.id }),
    },
    select: { id: true, lineId: true },
  });
  if (rows.length === 0) return [];

  const links = await tx.recipeBranch.findMany({
    where: { tenantId, lineId: { in: [...new Set(rows.map((r) => r.lineId))] } },
    select: { lineId: true },
  });
  const linked = new Set(links.map((l) => l.lineId));

  return rows.map((r) => ({ ...r, hasBranches: linked.has(r.lineId) }));
}

// ------------------------------------------------------------
// Create
// ------------------------------------------------------------

/**
 * Write the first version of a new CENTRAL recipe line.
 *
 * There is no "create a branch recipe" path, and that is Q8 rather than an
 * omission: a branch recipe comes into being by pressing copy, which is the act
 * of that branch declaring independence. Offering a second door would let a
 * branch line appear without anyone having made that declaration.
 *
 * IDEMPOTENT by `submitKey`, used as the row's id — the pattern Part 13.5
 * established. A double POST, a back-then-resubmit or a network retry resolves
 * to the same row instead of writing a second version of a recipe nobody changed
 * twice.
 */
export async function createRecipeLogic(
  tenantId: string,
  input: RecipeInput,
  createdBy: string
): Promise<RecipeWithIngredients> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const replay = await tx.recipe.findFirst({
        where: { tenantId, id: input.submitKey },
        include: { ingredients: true },
      });
      if (replay !== null) return replay;

      await assertWriteRefsValid(tx, tenantId, input);

      const target = targetOf(input);
      const existing = await liveLinesFor(tx, tenantId, target);
      const central = existing.find((r) => !r.hasBranches);
      if (central !== undefined) {
        throw new RecipeAlreadyExistsError(target, central.id);
      }

      const recipe = await tx.recipe.create({
        data: {
          id: input.submitKey,
          tenantId,
          lineId: randomUUID(),
          menuId: input.menuId,
          outputProductId: input.outputProductId,
          servings: new Prisma.Decimal(input.servings),
          effectiveFrom: input.effectiveFrom,
          notes: input.notes,
          createdBy,
          ingredients: { create: ingredientRowsFor(tenantId, input) },
        },
        include: { ingredients: true },
      });

      // AFTER the write, so the walk sees the recipe it is judging. A throw here
      // rolls the whole thing back — `withTenantContext` is a real transaction.
      await assertRecipeGraphValid(tx, tenantId, target, input.effectiveFrom);

      return recipe;
    },
    { timeout: RECIPE_WRITE_TIMEOUT_MS }
  );
}

// ------------------------------------------------------------
// Update
// ------------------------------------------------------------

/** What the resolver reads, and therefore what counts as a change (Q4). */
function arithmeticSignature(
  servings: Prisma.Decimal,
  lines: {
    productId: string | null;
    componentMenuId: string | null;
    qty: Prisma.Decimal;
    productUnitId: string | null;
  }[]
): string {
  const parts = lines
    .map(
      (l) =>
        `${l.productId ?? l.componentMenuId}|${l.qty.toFixed(3)}|${l.productUnitId ?? ""}`
    )
    .sort();
  // Reordering ingredients on screen is not a change to what the dish consumes,
  // so `sortOrder` is deliberately absent and the parts are sorted.
  return `${servings.toFixed(3)}::${parts.join("::")}`;
}

/**
 * Edit a recipe. Appends a version, corrects one, or touches neither — see the
 * file header for which is which.
 *
 * The version being edited is identified by `recipeId`; the ROW written carries
 * `input.submitKey` as its id, which is what makes a retry idempotent.
 */
export async function updateRecipeLogic(
  tenantId: string,
  recipeId: string,
  input: RecipeInput,
  updatedBy: string
): Promise<RecipeWithIngredients> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const replay = await tx.recipe.findFirst({
        where: { tenantId, id: input.submitKey },
        include: { ingredients: true },
      });
      if (replay !== null && replay.id !== recipeId) return replay;

      const existing = await tx.recipe.findFirst({
        where: { id: recipeId, tenantId, deletedAt: null },
        include: { ingredients: true },
      });
      if (existing === null) throw new RecipeNotFoundError(recipeId);
      if (existing.supersededAt !== null) {
        throw new RecipeSupersededError(recipeId);
      }

      const target = targetOf(existing);
      if (
        input.menuId !== existing.menuId ||
        input.outputProductId !== existing.outputProductId
      ) {
        throw new RecipeTargetImmutableError(recipeId);
      }

      await assertWriteRefsValid(tx, tenantId, input);

      const before = arithmeticSignature(existing.servings, existing.ingredients);
      const after = arithmeticSignature(
        new Prisma.Decimal(input.servings),
        input.ingredients.map((l) => ({
          productId: l.productId,
          componentMenuId: l.componentMenuId,
          qty: new Prisma.Decimal(l.qty),
          productUnitId: l.productUnitId,
        }))
      );

      // Q4: notes and ordering do not make a version. The row is edited in
      // place, and the history stays a list of the days the dish changed.
      if (before === after) {
        await tx.recipe.update({
          where: { id: recipeId },
          data: { notes: input.notes },
        });
        await tx.recipeIngredient.deleteMany({ where: { recipeId } });
        await tx.recipeIngredient.createMany({
          data: ingredientRowsFor(tenantId, input).map((row) => ({
            ...row,
            recipeId,
          })),
        });
        return (await tx.recipe.findUniqueOrThrow({
          where: { id: recipeId },
          include: { ingredients: true },
        })) as RecipeWithIngredients;
      }

      const version = await tx.recipe.create({
        data: {
          id: input.submitKey,
          tenantId,
          // The line survives the version, and `recipe_branch` hangs off the
          // line — so a branch that copied this recipe follows the new version
          // without a single link being rewritten.
          lineId: existing.lineId,
          menuId: existing.menuId,
          outputProductId: existing.outputProductId,
          servings: new Prisma.Decimal(input.servings),
          effectiveFrom: input.effectiveFrom,
          notes: input.notes,
          createdBy: updatedBy,
          ingredients: { create: ingredientRowsFor(tenantId, input) },
        },
        include: { ingredients: true },
      });

      // Same effective date = a correction, so the old version was WRONG and is
      // taken out of resolution entirely. A later date = the kitchen changed
      // that day, and the old version stays correct for the days it covered.
      if (input.effectiveFrom.getTime() === existing.effectiveFrom.getTime()) {
        await tx.recipe.update({
          where: { id: existing.id },
          data: { supersededAt: new Date(), supersededById: version.id },
        });
      }

      await assertRecipeGraphValid(tx, tenantId, target, input.effectiveFrom);

      return version;
    },
    { timeout: RECIPE_WRITE_TIMEOUT_MS }
  );
}

// ------------------------------------------------------------
// Delete
// ------------------------------------------------------------

/**
 * Soft-delete the whole LINE, every version of it.
 *
 * Deleting one version would leave the days it covered pointing at nothing, and
 * "this dish has no recipe any more" is a different statement from "this version
 * was wrong" — which is a supersede.
 *
 * The `recipe_branch` rows are LEFT STANDING. They are inert the moment the line
 * they name is deleted (resolution filters `deletedAt`), and they record which
 * branches had decided for themselves, which is the one thing a later "why does
 * this branch follow central again" question needs.
 */
export async function deleteRecipeLogic(
  tenantId: string,
  recipeId: string
): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    const recipe = await tx.recipe.findFirst({
      where: { id: recipeId, tenantId, deletedAt: null },
      select: { lineId: true },
    });
    if (recipe === null) throw new RecipeNotFoundError(recipeId);

    const { count } = await tx.recipe.updateMany({
      where: { tenantId, lineId: recipe.lineId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  });
}

// ------------------------------------------------------------
// Copy to branches (Q8)
// ------------------------------------------------------------

/**
 * Give the named branches their own copy of this recipe — one new line serving
 * all of them.
 *
 * ONE LINE, NOT ONE PER BRANCH. Five mall branches cooking alike would otherwise
 * be five identical rows kept in step by hand, and the day someone edits four of
 * them nothing says so. That failure appears at five branches, well inside the
 * range this product sells into.
 *
 * A branch that already keeps its own recipe is refused unless the caller
 * carries `acknowledgeOverwrite`. With it, that branch's link is moved to the
 * new line — and if the old line is left serving NOBODY it is soft-deleted,
 * because a line with no branch links is by definition the CENTRAL recipe (Q8),
 * and a discarded branch variant quietly becoming everyone's recipe is the worst
 * outcome this whole Part is arranged against.
 */
export async function copyRecipeToBranchesLogic(
  tenantId: string,
  input: CopyRecipeToBranchesInput,
  copiedBy: string
): Promise<RecipeWithIngredients> {
  return withTenantContext(
    tenantId,
    async (tx) => {
      const replay = await tx.recipe.findFirst({
        where: { tenantId, id: input.submitKey },
        include: { ingredients: true },
      });
      if (replay !== null) return replay;

      const source = await tx.recipe.findFirst({
        where: { id: input.sourceRecipeId, tenantId, deletedAt: null },
        include: { ingredients: true },
      });
      if (source === null) throw new RecipeNotFoundError(input.sourceRecipeId);
      if (source.supersededAt !== null) {
        throw new RecipeSupersededError(input.sourceRecipeId);
      }

      for (const branchId of input.branchIds) {
        await assertRefBelongsToTenant(tx, tenantId, "branch", branchId);
      }

      const target = targetOf(source);
      const lines = await liveLinesFor(tx, tenantId, target);
      const lineIds = [...new Set(lines.map((l) => l.lineId))];

      const alreadyDecided = await tx.recipeBranch.findMany({
        where: {
          tenantId,
          lineId: { in: lineIds },
          branchId: { in: input.branchIds },
        },
        select: { id: true, lineId: true, branch: { select: { name: true } } },
      });

      if (alreadyDecided.length > 0 && !input.acknowledgeOverwrite) {
        throw new RecipeBranchAlreadyDecidedError([
          ...new Set(alreadyDecided.map((l) => l.branch.name)),
        ]);
      }

      if (alreadyDecided.length > 0) {
        await tx.recipeBranch.deleteMany({
          where: { id: { in: alreadyDecided.map((l) => l.id) } },
        });

        // Any old line now serving nobody would read as CENTRAL. Retire it.
        for (const lineId of [...new Set(alreadyDecided.map((l) => l.lineId))]) {
          const remaining = await tx.recipeBranch.count({
            where: { tenantId, lineId },
          });
          if (remaining === 0) {
            await tx.recipe.updateMany({
              where: { tenantId, lineId, deletedAt: null },
              data: { deletedAt: new Date() },
            });
          }
        }
      }

      const lineId = randomUUID();
      const copy = await tx.recipe.create({
        data: {
          id: input.submitKey,
          tenantId,
          lineId,
          menuId: source.menuId,
          outputProductId: source.outputProductId,
          servings: source.servings,
          // The copy takes effect today. Backdating it would rewrite what those
          // branches were cooking on days they were in fact following central.
          effectiveFrom: computeBangkokToday(),
          notes: source.notes,
          createdBy: copiedBy,
          ingredients: {
            create: source.ingredients.map((line) => ({
              tenantId,
              productId: line.productId,
              componentMenuId: line.componentMenuId,
              qty: line.qty,
              productUnitId: line.productUnitId,
              sortOrder: line.sortOrder,
              notes: line.notes,
            })),
          },
        },
        include: { ingredients: true },
      });

      await tx.recipeBranch.createMany({
        data: input.branchIds.map((branchId) => ({
          tenantId,
          lineId,
          branchId,
          recipeId: copy.id,
          createdBy: copiedBy,
        })),
      });

      // The content did not change, but the RESOLUTION did: these branches now
      // see a different graph, and a cycle can exist there and nowhere else.
      await assertRecipeGraphValid(tx, tenantId, target, copy.effectiveFrom);

      return copy;
    },
    { timeout: RECIPE_WRITE_TIMEOUT_MS }
  );
}
