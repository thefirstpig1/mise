// ============================================================
// Mise — saving trim recipes (ADR 0040 Q7, Consequence 2)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { createRecipeLogic } from "@/server/recipe";
import { RecipeMethodConflictError } from "@/server/recipe-guards";
import { saveTrimRecipeInputSchema } from "@/lib/validations/trim-recipe";
import {
  TrimPartNotPreppedError,
  TrimPartTakenError,
  deleteTrimRecipeLogic,
  saveTrimRecipeLogic,
} from "@/server/trim-recipe";
import { sweepTestTenants } from "./support/sweep";

describe("trim recipes (ADR 0040 Q7)", () => {
  let tenant: string;
  let user: string;

  const product = (tag: string, type: "RAW" | "PREPPED") =>
    createProductLogic(
      tenant,
      productInputSchema.parse({
        name: `TR-${tag}-${randomUUID().slice(0, 6)}`,
        type,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
      })
    );

  const save = (id: string, parent: ProductWithUnits, parts: [ProductWithUnits | null, number, number][]) =>
    saveTrimRecipeLogic(
      tenant,
      saveTrimRecipeInputSchema.parse({
        id,
        parentProductId: parent.id,
        name: "ปลาทั้งตัว",
        parts: parts.map(([p, w, v]) => ({
          productId: p?.id ?? null,
          label: p ? null : "เกล็ด เครื่องใน",
          weightPct: w,
          valuePct: v,
          locked: false,
        })),
      })
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Trim Recipe Tenant" } })).id;
      user = (await tx.user.create({ data: { email: `tr-${randomUUID()}@example.com`, name: "เชฟ" } })).id;
    });
  });

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("TR1: saves, then an edit replaces every part", async () => {
    const fish = await product("fish", "RAW");
    const fillet = await product("fillet", "PREPPED");
    const head = await product("head", "PREPPED");
    const id = randomUUID();
    await save(id, fish, [[fillet, 60, 80], [head, 15, 20], [null, 25, 0]]);
    const edited = await save(id, fish, [[fillet, 70, 100], [null, 30, 0]]);
    expect(edited.parts).toHaveLength(2);
    expect(edited.parts[0].valuePct.toNumber()).toBe(100);
  });

  it("TR2: a part must be prepped, and may belong to only one live trim recipe", async () => {
    const fish = await product("fish2", "RAW");
    const rawPart = await product("raw", "RAW");
    await expect(save(randomUUID(), fish, [[rawPart, 100, 100]])).rejects.toBeInstanceOf(TrimPartNotPreppedError);

    const fillet = await product("fillet2", "PREPPED");
    const first = randomUUID();
    await save(first, fish, [[fillet, 100, 100]]);
    await expect(save(randomUUID(), fish, [[fillet, 100, 100]])).rejects.toBeInstanceOf(TrimPartTakenError);
    // Deleting the first frees the part.
    await deleteTrimRecipeLogic(tenant, first);
    await expect(save(randomUUID(), fish, [[fillet, 100, 100]])).resolves.toBeTruthy();
  });

  it("TR3: one way to make a product — a trim part cannot also get a production recipe, and vice versa", async () => {
    const fish = await product("fish3", "RAW");
    const fillet = await product("fillet3", "PREPPED");
    await save(randomUUID(), fish, [[fillet, 100, 100]]);
    await expect(
      createRecipeLogic(
        tenant,
        recipeInputSchema.parse({
          submitKey: randomUUID(),
          menuId: null,
          outputProductId: fillet.id,
          servings: 1,
          effectiveFrom: addDays(computeBangkokToday(), -1),
          ingredients: [
            { productId: fish.id, componentMenuId: null, qty: 1, productUnitId: fish.productUnits[0].id, sortOrder: 0, notes: null },
          ],
          notes: null,
        }),
        user
      )
    ).rejects.toBeInstanceOf(RecipeMethodConflictError);

    const soup = await product("soup3", "PREPPED");
    await createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId: null,
        outputProductId: soup.id,
        servings: 1,
        effectiveFrom: addDays(computeBangkokToday(), -1),
        ingredients: [
          { productId: fish.id, componentMenuId: null, qty: 1, productUnitId: fish.productUnits[0].id, sortOrder: 0, notes: null },
        ],
        notes: null,
      }),
      user
    );
    await expect(save(randomUUID(), fish, [[soup, 100, 100]])).rejects.toBeInstanceOf(TrimPartTakenError);
  });
});
