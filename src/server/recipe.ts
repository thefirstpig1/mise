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

import { createHash, randomUUID } from "node:crypto";
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
  SubstituteIngredientInput,
} from "@/lib/validations/recipe";

/**
 * The guard walk makes several round trips per probe context, and a write that
 * happens once an hour can afford them. Prisma's 5 s default cannot — the same
 * call ADR 0013 Consequence 5 made for a twenty-line goods receipt.
 */
export const RECIPE_WRITE_TIMEOUT_MS = 20_000;

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

export const targetOf = (r: {
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
export type RecipeRefsToCheck = {
  menuId: string | null;
  outputProductId: string | null;
  ingredients: {
    productId: string | null;
    componentMenuId: string | null;
    productUnitId: string | null;
  }[];
};

export async function assertWriteRefsValid(
  tx: PrismaClient,
  tenantId: string,
  input: RecipeRefsToCheck
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
export const ingredientRowsFor = (
  tenantId: string,
  input: { ingredients: RecipeInput["ingredients"] }
) =>
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
export async function liveLinesFor(
  tx: PrismaClient,
  tenantId: string,
  target: RecipeTarget
): Promise<{ id: string; lineId: string; hasBranches: boolean }[]> {
  const rows = await tx.recipe.findMany({
    where: {
      tenantId,
      deletedAt: null,
      supersededAt: null,
      // Drafts are not lines (ADR 0025 Q4). Without this, drafting a change to a
      // dish that already sells — half of what Menu Lab is for — would collide
      // with that dish's own published recipe under RecipeAlreadyExistsError,
      // and publishing the draft would then be refused by the thing it replaces.
      isDraft: false,
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

type IngredientRowData = {
  tenantId: string;
  productId: string | null;
  componentMenuId: string | null;
  qty: Prisma.Decimal;
  productUnitId: string | null;
  sortOrder: number;
  notes: string | null;
};

/**
 * Write the next version of a line, and decide whether the one it follows was
 * WRONG or merely EARLIER (Q4).
 *
 * Shared by the edit form and the bulk substitution, which is the point: both
 * are "this recipe changed", and having two places decide when to supersede
 * would eventually give the two screens different histories for the same act.
 *
 * `lineId` is carried over, and `recipe_branch` hangs off the LINE — so every
 * branch that copied this recipe follows the new version without a single link
 * being rewritten. Attaching branches to the version instead would mean copying
 * N links each time, and one missed copy sends that branch silently back to the
 * central recipe.
 */
async function appendVersion(
  tx: PrismaClient,
  tenantId: string,
  args: {
    id: string;
    existing: { id: string; lineId: string; menuId: string | null; outputProductId: string | null; effectiveFrom: Date };
    servings: Prisma.Decimal;
    effectiveFrom: Date;
    notes: string | null;
    ingredients: IngredientRowData[];
    createdBy: string;
  }
): Promise<RecipeWithIngredients> {
  const { existing } = args;

  const version = await tx.recipe.create({
    data: {
      id: args.id,
      tenantId,
      lineId: existing.lineId,
      menuId: existing.menuId,
      outputProductId: existing.outputProductId,
      servings: args.servings,
      effectiveFrom: args.effectiveFrom,
      notes: args.notes,
      createdBy: args.createdBy,
      ingredients: { create: args.ingredients },
    },
    include: { ingredients: true },
  });

  // Same effective date = a correction, so the old version was WRONG and is
  // taken out of resolution entirely. A later date = the kitchen changed that
  // day, and the old version stays correct for the days it covered.
  if (args.effectiveFrom.getTime() === existing.effectiveFrom.getTime()) {
    await tx.recipe.update({
      where: { id: existing.id },
      data: { supersededAt: new Date(), supersededById: version.id },
    });
  }

  return version;
}

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

      const version = await appendVersion(tx, tenantId, {
        id: input.submitKey,
        existing,
        servings: new Prisma.Decimal(input.servings),
        effectiveFrom: input.effectiveFrom,
        notes: input.notes,
        ingredients: ingredientRowsFor(tenantId, input),
        createdBy: updatedBy,
      });

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

// ------------------------------------------------------------
// Substituting an ingredient across recipes (Q14)
// ------------------------------------------------------------

/**
 * A target recipe no longer contains the ingredient being replaced — the screen
 * was built against rows that have since moved on.
 *
 * Refused rather than skipped. Skipping would report "4 recipes changed" while
 * changing three, and the one that did not change is exactly the one somebody
 * else was editing.
 */
export class SubstitutionTargetStaleError extends Error {
  constructor(
    public readonly recipeId: string,
    public readonly fromProductId: string
  ) {
    super(`Recipe "${recipeId}" no longer contains product "${fromProductId}"`);
    this.name = "SubstitutionTargetStaleError";
  }
}

/**
 * The replacement is ALREADY in the recipe, so the swap would put it in twice.
 *
 * Not merged silently: summing the two would make the cost right while the
 * recipe on screen reads wrong, and nobody asked for a merge. The screen has to
 * say which recipes need a human.
 */
export class SubstitutionDuplicateError extends Error {
  constructor(
    public readonly recipeId: string,
    public readonly label: string
  ) {
    super(`Recipe "${recipeId}" already contains ${label}`);
    this.name = "SubstitutionDuplicateError";
  }
}

/**
 * Some of the chosen recipes belong to branches that decided for themselves, and
 * the caller has not said it saw them.
 *
 * Q8's autonomy and Q14's bulk edit genuinely pull against each other: a shop
 * that has stopped buying an ingredient DOES need every branch to change,
 * because a kitchen cannot cook with what nobody buys. The system presents that
 * and does not decide it.
 */
export class SubstitutionTouchesBranchRecipesError extends Error {
  constructor(public readonly branchNames: string[]) {
    super(
      `${branchNames.length} branch recipe(s) are included: ${branchNames.join(", ")}`
    );
    this.name = "SubstitutionTouchesBranchRecipesError";
  }
}

/**
 * Replace one ingredient with another across several recipes at once (Q14).
 *
 * A shop stops buying พริกกะเหรี่ยง and moves to พริกชี้ฟ้า. Sometimes every
 * recipe follows; sometimes the signature dish keeps the old one. These are not
 * two features — they are the same call with a different list.
 *
 * **Every target gets a real new VERSION**, through the same `appendVersion` the
 * edit form uses, so a bulk swap and a hand edit leave the same kind of history
 * and Part 22 can still post each past day against the recipe true then.
 *
 * **`qty` is never carried over by this function.** The caller supplies one per
 * target, and `getSubstitutionPlanLogic` decides where a carry-over is safe
 * (Q15). Defaulting here would produce a wrong number that somebody clicks past
 * — 20 g of พริกผัดน้ำมัน holds nowhere near 20 g of chilli — and every plate
 * would be wrong from that day with nothing on screen looking wrong.
 *
 * IDEMPOTENT by `submitKey`. Each new version's id is DERIVED from the submit
 * key and the recipe it follows, so a retry recomputes exactly the same ids and
 * finds exactly the same rows. Using the key as one row's id — the Part 13.5
 * pattern — does not stretch to a write that produces N rows: it would leave the
 * other N−1 unreachable and make "did this already happen" depend on which
 * target happened to be first.
 */
export async function substituteIngredientLogic(
  tenantId: string,
  input: SubstituteIngredientInput,
  updatedBy: string
): Promise<RecipeWithIngredients[]> {
  const targets = [...input.targets].sort((a, b) =>
    a.recipeId < b.recipeId ? -1 : 1
  );

  return withTenantContext(
    tenantId,
    async (tx) => {
      const versionIds = targets.map((t) =>
        versionIdFor(input.submitKey, t.recipeId)
      );
      const replay = await tx.recipe.findMany({
        where: { tenantId, id: { in: versionIds } },
        include: { ingredients: true },
      });
      if (replay.length === versionIds.length) return replay;

      // --- the replacement itself, once, not once per target ---
      await assertRefBelongsToTenant(tx, tenantId, "product", input.fromProductId);
      await assertRefBelongsToTenant(tx, tenantId, "product", input.toProductId);
      await assertRefBelongsToTenant(tx, tenantId, "menu", input.toComponentMenuId);

      const replacementLabel = await labelOf(tx, tenantId, input);

      const existing = await tx.recipe.findMany({
        where: {
          id: { in: targets.map((t) => t.recipeId) },
          tenantId,
          deletedAt: null,
        },
        include: { ingredients: true },
      });
      const byId = new Map(existing.map((r) => [r.id, r]));
      for (const t of targets) {
        const row = byId.get(t.recipeId);
        if (row === undefined) throw new RecipeNotFoundError(t.recipeId);
        if (row.supersededAt !== null) throw new RecipeSupersededError(t.recipeId);
      }

      // --- Q8: which of these belong to a branch that decided for itself? ---
      const links = await tx.recipeBranch.findMany({
        where: { tenantId, lineId: { in: existing.map((r) => r.lineId) } },
        select: { branch: { select: { name: true } } },
      });
      if (links.length > 0 && !input.acknowledgeBranchRecipes) {
        throw new SubstitutionTouchesBranchRecipesError([
          ...new Set(links.map((l) => l.branch.name)),
        ]);
      }

      const written: RecipeWithIngredients[] = [];
      for (const [index, t] of targets.entries()) {
        const row = byId.get(t.recipeId) as (typeof existing)[number];

        const doomed = row.ingredients.find(
          (i) => i.productId === input.fromProductId
        );
        if (doomed === undefined) {
          throw new SubstitutionTargetStaleError(t.recipeId, input.fromProductId);
        }

        const clash = row.ingredients.some(
          (i) =>
            i.id !== doomed.id &&
            ((input.toProductId !== null && i.productId === input.toProductId) ||
              (input.toComponentMenuId !== null &&
                i.componentMenuId === input.toComponentMenuId))
        );
        if (clash) {
          throw new SubstitutionDuplicateError(t.recipeId, replacementLabel);
        }

        if (input.toProductId !== null) {
          const unit = await tx.productUnit.findFirst({
            where: { id: t.productUnitId as string, productId: input.toProductId },
            select: { id: true },
          });
          if (unit === null) {
            throw new RecipeUnitMismatchError(
              t.productUnitId as string,
              input.toProductId
            );
          }
        }

        const ingredients: IngredientRowData[] = row.ingredients.map((line) =>
          line.id === doomed.id
            ? {
                tenantId,
                productId: input.toProductId,
                componentMenuId: input.toComponentMenuId,
                qty: new Prisma.Decimal(t.qty),
                productUnitId: t.productUnitId,
                sortOrder: line.sortOrder,
                // The old line's note described the OLD ingredient. Carrying it
                // over would leave "ซอยละเอียด" beside a product that arrives
                // already minced — it reads as an instruction and is not one.
                notes: null,
              }
            : {
                tenantId,
                productId: line.productId,
                componentMenuId: line.componentMenuId,
                qty: line.qty,
                productUnitId: line.productUnitId,
                sortOrder: line.sortOrder,
                notes: line.notes,
              }
        );

        written.push(
          await appendVersion(tx, tenantId, {
            id: versionIds[index],
            existing: row,
            servings: row.servings,
            effectiveFrom: input.effectiveFrom,
            notes: row.notes,
            ingredients,
            createdBy: updatedBy,
          })
        );
      }

      // Swapping a product for a MENU can close a loop that did not exist
      // before, so every touched recipe is re-walked — after the writes and in
      // the same transaction, so a refusal takes the whole batch with it.
      const seen = new Set<string>();
      for (const v of written) {
        const target = targetOf(v);
        const key = `${target.kind}:${target.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await assertRecipeGraphValid(tx, tenantId, target, input.effectiveFrom);
      }

      return written;
    },
    { timeout: RECIPE_WRITE_TIMEOUT_MS }
  );
}

/**
 * A stable id for the version that will follow `recipeId` in this submission.
 *
 * A name-based UUID (RFC 4122 v5 in shape: sha1 of the pair, with the version
 * and variant bits set), so a replayed POST computes the same ids rather than
 * generating fresh ones and writing the whole batch twice. The hash input is
 * scoped to one submission, so two different substitutions of the same recipe
 * never collide.
 */
function versionIdFor(submitKey: string, recipeId: string): string {
  const digest = createHash("sha1").update(`${submitKey}:${recipeId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

/** The replacement's name, for a refusal that has to say what clashed. */
async function labelOf(
  tx: PrismaClient,
  tenantId: string,
  input: SubstituteIngredientInput
): Promise<string> {
  if (input.toProductId !== null) {
    const p = await tx.product.findFirst({
      where: { id: input.toProductId, tenantId },
      select: { name: true },
    });
    return p?.name ?? input.toProductId;
  }
  const m = await tx.menu.findFirst({
    where: { id: input.toComponentMenuId as string, tenantId },
    select: { name: true },
  });
  return m?.name ?? (input.toComponentMenuId as string);
}
