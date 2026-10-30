// ============================================================
// Publishing drafts on a chosen day, several at once (Kong 2026-10-30)
// ============================================================
// A shop that imported a month of sales and then its recipes wants those
// recipes true from the month's first day. A draft still resolves on no day;
// the date belongs to PUBLISHING — today unless a past day is chosen, never
// before the version standing today.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { recipeInputSchema } from "@/lib/validations/recipe";
import { publishDraftInputSchema, publishDraftsInputSchema } from "@/lib/validations/menu-lab";
import { createRecipeLogic } from "@/server/recipe";
import { DraftBeforeLiveRecipeError, publishDraftLogic, publishDraftsLogic } from "@/server/menu-lab";
import { importRecipesLogic } from "@/server/recipe-import";
import { sweepTestTenants } from "./support/sweep";

describe("publishing drafts on a chosen day", () => {
  let tenant: string;
  let user: string;
  let pork: string;
  let kg: string;
  const today = computeBangkokToday();
  const day = (n: number) => addDays(today, n);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const menu = (name: string) => withRlsBypass((tx) => tx.menu.create({ data: { tenantId: tenant, source: "MISE", name: `${name}-${randomUUID().slice(0, 4)}` }, select: { id: true } }));
  const draftFor = async (menuId: string) => {
    await importRecipesLogic(tenant, { newMenus: [], newProducts: [], recipes: [{ menu: { id: menuId }, servings: 1, lines: [{ product: { id: pork }, unitName: "kg", ratio: null, qty: 0.2, note: null }] }] }, user);
    return (await prismaBypass.recipe.findFirstOrThrow({ where: { tenantId: tenant, menuId, isDraft: true }, select: { id: true } })).id;
  };
  const liveFrom = (menuId: string, from: Date) =>
    createRecipeLogic(
      tenant,
      recipeInputSchema.parse({
        submitKey: randomUUID(),
        menuId,
        outputProductId: null,
        servings: 1,
        effectiveFrom: from,
        ingredients: [{ productId: pork, componentMenuId: null, qty: 0.1, productUnitId: kg, sortOrder: 0, notes: null }],
        notes: null,
      }),
      user
    );

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Publish Drafts Test" } })).id;
      user = (await tx.user.create({ data: { email: `publish-${randomUUID()}@example.com`, name: "เจ้าของ" } })).id;
      pork = (await tx.product.create({ data: { tenantId: tenant, sku: "P-0001", name: "หมูสับ", type: "RAW", primaryDimension: "WEIGHT" } })).id;
      kg = (await tx.productUnit.create({ data: { productId: pork, unitName: "kg", unitDimension: "WEIGHT", toBaseRatio: 1, isBase: true } })).id;
    });
  });
  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await prismaBypass.user.deleteMany({ where: { id: user } });
  }, 180_000);

  it("D-1 a draft published with a past day starts on that day; without one, today", async () => {
    const a = await draftFor((await menu("ข้าวผัด")).id);
    const b = await draftFor((await menu("ผัดซีอิ๊ว")).id);
    await publishDraftLogic(tenant, { recipeId: a, acknowledgeReplace: false, effectiveFrom: day(-20) });
    await publishDraftLogic(tenant, { recipeId: b, acknowledgeReplace: false });
    const rows = await prismaBypass.recipe.findMany({ where: { id: { in: [a, b] } }, select: { id: true, isDraft: true, effectiveFrom: true } });
    expect(rows.find((r) => r.id === a)).toMatchObject({ isDraft: false });
    expect(iso(rows.find((r) => r.id === a)!.effectiveFrom)).toBe(iso(day(-20)));
    expect(iso(rows.find((r) => r.id === b)!.effectiveFrom)).toBe(iso(today));
  });

  it("D-2 a day before the recipe standing today is refused — the days between would read a version nobody wrote", async () => {
    const m = (await menu("กะเพรา")).id;
    await liveFrom(m, day(-5));
    const d = await draftFor(m);
    await expect(publishDraftLogic(tenant, { recipeId: d, acknowledgeReplace: true, effectiveFrom: day(-10) })).rejects.toBeInstanceOf(DraftBeforeLiveRecipeError);
    // From the standing version's own day, it replaces that version; the line carries on.
    const published = await publishDraftLogic(tenant, { recipeId: d, acknowledgeReplace: true, effectiveFrom: day(-5) });
    const old = await prismaBypass.recipe.findFirstOrThrow({ where: { tenantId: tenant, menuId: m, isDraft: false, id: { not: published.id } } });
    expect(old.supersededById).toBe(published.id);
    expect(published.lineId).toBe(old.lineId);
  });

  it("D-3 several at once: each is reported, a replacement waits for its confirmation, the rest go through", async () => {
    const withLive = (await menu("ต้มยำ")).id;
    await liveFrom(withLive, day(-30));
    const plain = (await menu("ไข่เจียว")).id;
    const d1 = await draftFor(withLive);
    const d2 = await draftFor(plain);
    const input = publishDraftsInputSchema.parse({ recipeIds: [d1, d2], effectiveFrom: iso(day(-15)), acknowledgeReplace: false });
    const first = await publishDraftsLogic(tenant, input);
    expect(first.map((r) => r.outcome)).toEqual(["NEEDS_ACK", "PUBLISHED"]);

    const second = await publishDraftsLogic(tenant, { ...input, recipeIds: [d1], acknowledgeReplace: true });
    expect(second.map((r) => r.outcome)).toEqual(["PUBLISHED"]);
    // The old version still answers for the days before the chosen one.
    const versions = await prismaBypass.recipe.findMany({ where: { tenantId: tenant, menuId: withLive, isDraft: false }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true, supersededAt: true, lineId: true } });
    expect(versions.map((v) => [iso(v.effectiveFrom), v.supersededAt === null])).toEqual([
      [iso(day(-30)), true],
      [iso(day(-15)), true],
    ]);
    expect(new Set(versions.map((v) => v.lineId)).size).toBe(1);
  });

  it("D-4 the day is checked: not the future, not past the ledger's 90 days", () => {
    expect(publishDraftInputSchema.safeParse({ recipeId: randomUUID(), effectiveFrom: iso(day(1)) }).success).toBe(false);
    expect(publishDraftsInputSchema.safeParse({ recipeIds: [randomUUID()], effectiveFrom: iso(day(-91)) }).success).toBe(false);
    expect(publishDraftsInputSchema.safeParse({ recipeIds: [randomUUID()], effectiveFrom: iso(day(-90)) }).success).toBe(true);
  });
});
