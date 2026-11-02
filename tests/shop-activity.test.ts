// ============================================================
// Mise — the dashboard's "is this shop brand new" question (Kong 2026-11-02)
// ============================================================
// A shop with no sales, purchases, expenses or counts skips every P&L on the
// dashboard. Each of the four must flip the answer on its own, or a shop with
// only that one kind of record would see "ยังไม่มีตัวเลข" over real figures.
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants } from "./support/sweep";
import { createTenant } from "@/server/tenant-init";
import { hasShopActivityLogic } from "@/server/shop-activity";

const created: string[] = [];
afterAll(async () => {
  await sweepTestTenants(prismaBypass, { ids: created });
  await prismaBypass.user.deleteMany({ where: { email: { startsWith: "activity-test-" } } });
});

async function newShop() {
  const user = await prismaBypass.user.create({ data: { email: `activity-test-${Date.now()}-${Math.random()}@example.com` } });
  const { tenant, branch } = (await createTenant({ ownerUserId: user.id, tenantName: "Activity test" })) as { tenant: { id: string }; branch: { id: string } };
  created.push(tenant.id);
  return { tenantId: tenant.id, branchId: branch.id, userId: user.id };
}

describe("hasShopActivityLogic", () => {
  it("SA1 — a shop that has only signed up has nothing to sum", async () => {
    const { tenantId } = await newShop();
    expect(await hasShopActivityLogic(tenantId)).toBe(false);
  });

  it("SA2 — one sales day is enough", async () => {
    const { tenantId, branchId } = await newShop();
    await prismaBypass.salesDay.create({ data: { tenantId, branchId, businessDate: new Date("2026-10-28") } });
    expect(await hasShopActivityLogic(tenantId)).toBe(true);
  });

  it("SA3 — one expense is enough, and a deleted one is not", async () => {
    const { tenantId, branchId, userId } = await newShop();
    const e = await prismaBypass.expense.create({
      data: { tenantId, branchId, billDate: new Date("2026-10-28"), subtotalExclVat: 100, totalAmount: 100, netPaymentAmount: 100, createdBy: userId },
    });
    expect(await hasShopActivityLogic(tenantId)).toBe(true);
    await prismaBypass.expense.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
    expect(await hasShopActivityLogic(tenantId)).toBe(false);
  });

  it("SA4 — another shop's records never count", async () => {
    const a = await newShop();
    const b = await newShop();
    await prismaBypass.salesDay.create({ data: { tenantId: b.tenantId, branchId: b.branchId, businessDate: new Date("2026-10-28") } });
    expect(await hasShopActivityLogic(a.tenantId)).toBe(false);
  });
});
