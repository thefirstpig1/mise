// ============================================================
// คิดครัว — never entered is not "0 kg" (queue item 10)
// ============================================================
// The menu sheet said "คงเหลือ 0 kg" and "พอทำอีก ~0 จาน" for an ingredient
// that had never been received or counted at the branch. The facts now say
// whether anything ever moved there, so the sheet can tell the two apart.
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants } from "./support/sweep";
import { createTenant } from "@/server/tenant-init";
import { getIngredientFactsLogic } from "@/server/menu-manager";

const created: string[] = [];
afterAll(async () => {
  await sweepTestTenants(prismaBypass, { ids: created });
  await prismaBypass.user.deleteMany({ where: { email: { startsWith: "stocked-test-" } } });
});

describe("ingredient facts — stocked", () => {
  it("IF1 — an ingredient used up reads 0 and stocked; one never entered reads unstocked", async () => {
    const user = await prismaBypass.user.create({ data: { email: `stocked-test-${Date.now()}@example.com` } });
    const { tenant, branch } = (await createTenant({ ownerUserId: user.id, tenantName: "Stocked test" })) as { tenant: { id: string }; branch: { id: string } };
    created.push(tenant.id);
    const mk = (sku: string) =>
      prismaBypass.product.create({ data: { tenantId: tenant.id, sku, name: sku, type: "RAW", primaryDimension: "WEIGHT" }, select: { id: true } });
    const [usedUp, never] = await Promise.all([mk("IF-USED"), mk("IF-NEVER")]);
    const move = (qty: number, type: "PO_RECEIVE" | "ADJUST_LOSS") =>
      prismaBypass.stockMovement.create({
        data: { tenantId: tenant.id, branchId: branch.id, productId: usedUp.id, qty, type, sourceType: type === "PO_RECEIVE" ? "GR_LINE" : "ADJUSTMENT", sourceId: crypto.randomUUID(), occurredAt: new Date("2026-10-30"), createdBy: user.id },
      });
    await move(2, "PO_RECEIVE");
    await move(-2, "ADJUST_LOSS");
    const f = await getIngredientFactsLogic(tenant.id, branch.id, [usedUp.id, never.id]);
    expect(f.facts[usedUp.id]).toMatchObject({ onHand: 0, stocked: true });
    expect(f.facts[never.id]).toMatchObject({ onHand: 0, stocked: false });
  });
});
