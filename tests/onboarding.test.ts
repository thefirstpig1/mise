// ============================================================
// Mise — เริ่มต้นใช้งาน: steps tick from what the shop DID (Kong 2026-10-28)
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants } from "./support/sweep";
import { createTenant } from "@/server/tenant-init";
import { getOnboardingLogic, setOnboardingDismissedLogic, settingsSavedAt, shopSettingsReviewed } from "@/server/onboarding";

const created: string[] = [];
afterAll(async () => {
  await sweepTestTenants(prismaBypass, { ids: created });
  await prismaBypass.user.deleteMany({ where: { email: { startsWith: "onb-test-" } } });
});

async function newShop() {
  const user = await prismaBypass.user.create({ data: { email: `onb-test-${Date.now()}-${Math.random()}@example.com` } });
  const { tenant } = (await createTenant({ ownerUserId: user.id, tenantName: "Onboarding test" })) as { tenant: { id: string } };
  created.push(tenant.id);
  const m = await prismaBypass.tenantMembership.findFirstOrThrow({ where: { tenantId: tenant.id }, select: { id: true } });
  return { tenantId: tenant.id, membershipId: m.id };
}

describe("onboarding checklist", () => {
  it("O1 — a brand-new shop has done nothing, even though signup wrote the tenant", async () => {
    const { tenantId, membershipId } = await newShop();
    const o = await getOnboardingLogic(tenantId, membershipId);
    expect(o.done).toEqual({ shop: false, team: false, supplier: false, product: false, sales: false, recipe: false, count: false });
    expect(o.doneCount).toBe(0);
    // In the order the setup runs, the count last; no recipe step under นับสต๊อก (the default).
    // `team` is not a step (2026-10-31) — it can happen any time — but is still reported.
    expect(o.steps).toEqual(["shop", "sales", "product", "supplier", "count"]);
    expect(o.dismissed).toBe(false);
  });

  it("O2 — a step ticks only when the thing exists: a supplier, and settings saved after signup", async () => {
    const { tenantId, membershipId } = await newShop();
    await prismaBypass.supplier.create({ data: { tenantId, code: "S1", nameFull: "ผู้ขายทดสอบ" } });
    // A settings save after signup moves updated_at past created_at.
    await prismaBypass.tenant.update({ where: { id: tenantId }, data: { updatedAt: new Date(Date.now() + 120_000) } });
    const o = await getOnboardingLogic(tenantId, membershipId);
    expect(o.done.supplier).toBe(true);
    expect(o.done.shop).toBe(true);
    expect(o.done.product).toBe(false);
    expect(o.doneCount).toBe(2);
  });

  it("O4 — a shop that costs by recipe has a recipe step before the count", async () => {
    const { tenantId, membershipId } = await newShop();
    await prismaBypass.tenant.update({ where: { id: tenantId }, data: { grossProfitMethod: "RECIPE_CONSUMPTION" } });
    const o = await getOnboardingLogic(tenantId, membershipId);
    expect(o.steps).toEqual(["shop", "sales", "product", "supplier", "recipe", "count"]);
    expect(o.done.recipe).toBe(false);
  });

  it("O5 — a settings save seconds after signup still ticks ตั้งค่าร้าน", () => {
    const createdAt = new Date("2026-10-31T10:00:00Z");
    const eightSecondsLater = new Date(createdAt.getTime() + 8_000);
    // What a bare `new Date()` wrote before 2026-10-31: inside the window, unticked.
    expect(shopSettingsReviewed({ createdAt, updatedAt: eightSecondsLater })).toBe(false);
    expect(shopSettingsReviewed({ createdAt, updatedAt: settingsSavedAt(createdAt, eightSecondsLater) })).toBe(true);
    // A save long after signup writes the time it happened.
    const later = new Date(createdAt.getTime() + 3_600_000);
    expect(settingsSavedAt(createdAt, later)).toEqual(later);
  });

  it("O3 — hiding is per membership and can be undone", async () => {
    const { tenantId, membershipId } = await newShop();
    await setOnboardingDismissedLogic(tenantId, membershipId, true);
    expect((await getOnboardingLogic(tenantId, membershipId)).dismissed).toBe(true);
    await setOnboardingDismissedLogic(tenantId, membershipId, false);
    expect((await getOnboardingLogic(tenantId, membershipId)).dismissed).toBe(false);
  });
});
