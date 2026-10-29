// ============================================================
// Mise — trim recipes (ADR 0040 Q7)
// ============================================================
// How one whole thing bought is cut into parts. Set once; used by every TRIM
// production, and by the explosion when nobody records the cutting (Q8).
//
// Refusals, each an inability rather than a policy:
//   * a part must be a PREPPED product — it is made, by the knife;
//   * a part may belong to only ONE live trim recipe, and may not also be made
//     by a production recipe or a parent + yield (ADR 0021 Q1's "one way",
//     extended by ADR 0040 Consequence 2) — the explosion needs one path.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient, TrimRecipe, TrimRecipePart } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";
import type { SaveTrimRecipeInput } from "@/lib/validations/trim-recipe";

export type TrimRecipeWithParts = TrimRecipe & { parts: TrimRecipePart[] };

export class TrimPartNotPreppedError extends Error {
  constructor(readonly productId: string) {
    super(`Trim part ${productId} is not a PREPPED product`);
    this.name = "TrimPartNotPreppedError";
  }
}

/** The part already belongs to another trim recipe, or is made another way. */
export class TrimPartTakenError extends Error {
  constructor(readonly productId: string, readonly productName: string, readonly by: "TRIM" | "RECIPE" | "PARENT") {
    super(`Product ${productName} (${productId}) is already made another way (${by})`);
    this.name = "TrimPartTakenError";
  }
}

export class TrimRecipeNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Trim recipe ${id} not found`);
    this.name = "TrimRecipeNotFoundError";
  }
}

async function assertPartsFree(
  tx: PrismaClient,
  tenantId: string,
  productIds: string[],
  selfId: string
) {
  if (productIds.length === 0) return;
  const products = await tx.product.findMany({
    where: { tenantId, id: { in: productIds }, deletedAt: null },
    select: { id: true, name: true, type: true, parentProductId: true },
  });
  for (const id of productIds) {
    const p = products.find((x) => x.id === id);
    if (!p) await assertRefBelongsToTenant(tx, tenantId, "product", id);
    if (!p || p.type !== "PREPPED") throw new TrimPartNotPreppedError(id);
    if (p.parentProductId !== null) throw new TrimPartTakenError(p.id, p.name, "PARENT");
  }
  const recipes = await tx.recipe.findMany({
    where: { tenantId, outputProductId: { in: productIds }, deletedAt: null, supersededAt: null },
    select: { outputProductId: true },
  });
  if (recipes.length > 0) {
    const p = products.find((x) => x.id === recipes[0].outputProductId)!;
    throw new TrimPartTakenError(p.id, p.name, "RECIPE");
  }
  const taken = await tx.trimRecipePart.findFirst({
    where: {
      tenantId,
      productId: { in: productIds },
      deletedAt: null,
      trimRecipeId: { not: selfId },
      trimRecipe: { deletedAt: null },
    },
    select: { productId: true },
  });
  if (taken) {
    const p = products.find((x) => x.id === taken.productId)!;
    throw new TrimPartTakenError(p.id, p.name, "TRIM");
  }
}

/**
 * Create or replace a trim recipe. An edit soft-deletes every old part and
 * writes the new list in one transaction: a production already recorded froze
 * its own shares (`production_item.value_share_pct`), so nothing that happened
 * is rewritten — only what happens next.
 */
export async function saveTrimRecipeLogic(
  tenantId: string,
  input: SaveTrimRecipeInput
): Promise<TrimRecipeWithParts> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "product", input.parentProductId);
    const kept = input.parts.filter((p) => p.productId !== null).map((p) => p.productId!);
    await assertPartsFree(tx, tenantId, kept, input.id);

    const existing = await tx.trimRecipe.findFirst({
      where: { tenantId, id: input.id },
      select: { id: true, deletedAt: true },
    });
    if (existing?.deletedAt) throw new TrimRecipeNotFoundError(input.id);

    const now = new Date();
    if (existing) {
      await tx.trimRecipe.update({
        where: { id: input.id },
        data: { parentProductId: input.parentProductId, name: input.name, notes: input.notes ?? null },
      });
      await tx.trimRecipePart.updateMany({
        where: { tenantId, trimRecipeId: input.id, deletedAt: null },
        data: { deletedAt: now },
      });
    } else {
      await tx.trimRecipe.create({
        data: {
          id: input.id,
          tenantId,
          parentProductId: input.parentProductId,
          name: input.name,
          notes: input.notes ?? null,
        },
      });
    }

    await tx.trimRecipePart.createMany({
      data: input.parts.map((p, i) => ({
        tenantId,
        trimRecipeId: input.id,
        productId: p.productId,
        label: p.productId === null ? p.label : null,
        weightPct: new Prisma.Decimal(p.weightPct),
        valuePct: new Prisma.Decimal(p.productId === null ? 0 : p.valuePct),
        valueLocked: p.productId === null ? false : p.locked,
        sortOrder: i,
      })),
    });

    return tx.trimRecipe.findUniqueOrThrow({
      where: { id: input.id },
      include: { parts: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
    });
  });
}

/**
 * Delete a trim recipe: the recipe and its parts get ONE deleted_at, so the
 * partial unique that keeps a part in one recipe sees them go together.
 */
export async function deleteTrimRecipeLogic(tenantId: string, id: string): Promise<void> {
  await withTenantContext(tenantId, async (tx) => {
    const found = await tx.trimRecipe.findFirst({ where: { tenantId, id, deletedAt: null }, select: { id: true } });
    if (!found) throw new TrimRecipeNotFoundError(id);
    const now = new Date();
    await tx.trimRecipe.update({ where: { id }, data: { deletedAt: now } });
    await tx.trimRecipePart.updateMany({ where: { tenantId, trimRecipeId: id, deletedAt: null }, data: { deletedAt: now } });
  });
}

/** Every live trim recipe, with its parts in the order they were written. */
export async function getTrimRecipesLogic(tenantId: string): Promise<TrimRecipeWithParts[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.trimRecipe.findMany({
      where: { tenantId, deletedAt: null },
      include: { parts: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    })
  );
}
