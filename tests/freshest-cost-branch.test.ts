// ============================================================
// คิดครัว — the branch a menu's cost is priced at (freshestCostBranch)
// ============================================================
// Kong 2026-11-06: the freshest receipt was looked for shop-wide, so when it
// sat at a branch outside the reader's reach the answer quietly fell back to
// the first branch by name — not the freshest one the reader may see.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { freshestCostBranch } from "@/server/menu-lab-read";
import { sweepOrphanUsers, sweepTestTenants } from "./support/sweep";
import { onlyBranches } from "./support/reach";

describe("freshestCostBranch", () => {
  let tenant: string;
  let user: string;
  const b: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const t = await tx.tenant.create({ data: { name: "Freshest Test" } });
      tenant = t.id;
      user = (await tx.user.create({ data: { email: `freshest-${randomUUID()}@example.com`, name: "ผู้ทดสอบ" } })).id;
      // Names sort ก < ข < ค, so "the first branch by name" is ก.
      b.a = (await tx.branch.create({ data: { tenantId: t.id, name: "ก สาขาแรก", code: "FA" } })).id;
      b.b = (await tx.branch.create({ data: { tenantId: t.id, name: "ข สาขานอกสิทธิ์", code: "FB" } })).id;
      b.c = (await tx.branch.create({ data: { tenantId: t.id, name: "ค สาขาที่รับของ", code: "FC" } })).id;
      const product = await tx.product.create({ data: { tenantId: t.id, name: `ข้าว-${randomUUID().slice(0, 6)}`, type: "RAW", primaryDimension: "WEIGHT", sku: `FR-${randomUUID().slice(0, 8)}` } });
      const receive = (branchId: string, daysAgo: number) =>
        tx.stockMovement.create({
          data: {
            tenantId: t.id,
            productId: product.id,
            branchId,
            qty: 1,
            type: "PO_RECEIVE",
            sourceType: "GR_LINE",
            sourceId: randomUUID(),
            occurredAt: new Date(Date.now() - daysAgo * 86_400_000),
            createdBy: user,
          },
        });
      await receive(b.c, 5); // the freshest the reader may see
      await receive(b.b, 1); // fresher, but out of reach
    });
  }, 120_000);

  afterAll(async () => {
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => sweepOrphanUsers(tx as never, { ids: [user] }));
  }, 120_000);

  it("is the freshest receipt among the branches the reader may see", async () => {
    expect((await freshestCostBranch(tenant, onlyBranches(b.a, b.c))).id).toBe(b.c);
  });
});
