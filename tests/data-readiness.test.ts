// ============================================================
// คิดครัว — how far along a shop is, for "นี่คืออะไร" (queue item 10)
// ============================================================
// Each line of the checklist is a count, so each count is pinned where it
// could lie: a day with only a typed pulse is not a POS file, a menu merged
// into another is one dish, a draft is not a recipe, a branch outside the
// reader's reach is not theirs, and stock with no receipt has no price.
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants } from "./support/sweep";
import { EVERY_BRANCH, onlyBranches } from "./support/reach";
import { createTenant } from "@/server/tenant-init";
import { dataReadinessLogic } from "@/server/data-readiness";

const created: string[] = [];
afterAll(async () => {
  await sweepTestTenants(prismaBypass, { ids: created });
  await prismaBypass.user.deleteMany({ where: { email: { startsWith: "readiness-test-" } } });
});

async function newShop() {
  const user = await prismaBypass.user.create({ data: { email: `readiness-test-${Date.now()}-${Math.random()}@example.com` } });
  const { tenant, branch } = (await createTenant({ ownerUserId: user.id, tenantName: "Readiness test" })) as { tenant: { id: string }; branch: { id: string } };
  created.push(tenant.id);
  const other = await prismaBypass.branch.create({ data: { tenantId: tenant.id, name: "สาขาสอง", code: "RD2" } });
  return { tenantId: tenant.id, branchId: branch.id, otherId: other.id, userId: user.id };
}

describe("dataReadinessLogic", () => {
  it("DR1 — a shop that has only signed up has entered nothing", async () => {
    const { tenantId } = await newShop();
    const r = await dataReadinessLogic(tenantId, EVERY_BRANCH);
    expect(r).toMatchObject({ salesDays: 0, menus: 0, menusWithRecipe: 0, pricedProducts: 0, closedCounts: 0, postedDays: 0, receipts: 0, expenses: 0 });
  });

  it("DR2 — a day with only a typed pulse is not a sales file; a guest count is a guest day", async () => {
    const { tenantId, branchId, userId } = await newShop();
    await prismaBypass.salesDay.create({ data: { tenantId, branchId, businessDate: new Date("2026-10-28"), pulseAmount: 5000, pulseSource: "MANUAL", pulseRecordedBy: userId, pulseRecordedAt: new Date("2026-10-28T22:00:00Z"), guestCount: 40 } });
    const r = await dataReadinessLogic(tenantId, EVERY_BRANCH);
    expect(r.salesDays).toBe(0);
    expect(r.guestDays).toBe(1);
  });

  it("DR3 — a merged-away menu is one dish; a draft is not a recipe", async () => {
    const { tenantId, userId } = await newShop();
    const [a, b, c] = await Promise.all(
      ["ผัดกะเพรา", "ผัดกะเพรา (สาขาสอง)", "ต้มยำ"].map((name) => prismaBypass.menu.create({ data: { tenantId, source: "MISE", name } }))
    );
    await prismaBypass.menuMerge.create({ data: { tenantId, losingMenuId: b.id, winningMenuId: a.id, effectiveFrom: new Date("2026-10-01"), mergedBy: userId } });
    await prismaBypass.recipe.create({ data: { tenantId, menuId: a.id, effectiveFrom: new Date("2026-10-01"), createdBy: userId } });
    await prismaBypass.recipe.create({ data: { tenantId, menuId: c.id, effectiveFrom: new Date("2026-10-01"), createdBy: userId, isDraft: true } });
    const r = await dataReadinessLogic(tenantId, EVERY_BRANCH);
    expect(r.menus).toBe(2);
    expect(r.menusWithRecipe).toBe(1);
  });

  it("DR4 — another branch's count is not counted for someone who cannot see it", async () => {
    const { tenantId, branchId, otherId, userId } = await newShop();
    await prismaBypass.stockCount.create({
      data: { tenantId, branchId: otherId, scNumber: "SC-RD-1", countDate: new Date("2026-10-31"), status: "CLOSED", startedBy: userId, closedAt: new Date("2026-10-31"), closedBy: userId },
    });
    expect((await dataReadinessLogic(tenantId, EVERY_BRANCH)).closedCounts).toBe(1);
    expect((await dataReadinessLogic(tenantId, onlyBranches(branchId))).closedCounts).toBe(0);
    expect((await dataReadinessLogic(tenantId, EVERY_BRANCH, branchId)).closedCounts).toBe(0);
  });

  it("DR5 — an ingredient has a price once it is received; stock counted in without one does not", async () => {
    const { tenantId, branchId, userId } = await newShop();
    const mk = (sku: string) =>
      prismaBypass.product.create({ data: { tenantId, sku, name: sku, type: "RAW", primaryDimension: "WEIGHT" }, select: { id: true } });
    const [received, countedOnly] = await Promise.all([mk("RD-RECV"), mk("RD-COUNT")]);
    const move = (productId: string, type: "PO_RECEIVE" | "ADJUST_GAIN") =>
      prismaBypass.stockMovement.create({
        data: { tenantId, branchId, productId, qty: 1, type, sourceType: type === "PO_RECEIVE" ? "GR_LINE" : "STOCK_COUNT", sourceId: crypto.randomUUID(), occurredAt: new Date("2026-10-30"), createdBy: userId },
      });
    await move(received.id, "PO_RECEIVE");
    await move(countedOnly.id, "ADJUST_GAIN");
    const r = await dataReadinessLogic(tenantId, EVERY_BRANCH);
    expect(r.products).toBeGreaterThanOrEqual(2);
    expect(r.pricedProducts).toBe(1);
  });
});
