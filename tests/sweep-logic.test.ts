// ============================================================
// Mise — the sweep actually deletes (Sprint 5 Part 23, ADR 0023 Q4)
// ============================================================
// The delete ORDER is the fragile half of the sweep, and an untested sweep is
// one that fails exactly when it is needed — after a worker has already died.
// So this builds the three shapes that are hardest to delete and sweeps them:
//
//   • a PREPPED chain three deep      → Product points at Product
//   • a menu owned by a POS integration → Menu must go BEFORE PosIntegration
//   • a waste entry and its reversal   → a self-pointer that is half of a
//                                        partial unique, so it CANNOT be nulled
//
// The last two are not hypothetical: Part 22 hit both during teardown.
// ============================================================

import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { sweepTestTenants, sweepOrphanUsers } from "./support/sweep";

const db = new PrismaClient();

// `User` carries no tenantId, so the sweep does not (and must not) touch it —
// it is Auth.js's table, shared across tenants. This spec cleans up its own.
const createdUserIds: string[] = [];

/** Build a tenant carrying every shape the sweep has to unpick. */
async function buildTenant(name: string): Promise<string> {
  const tenant = await db.tenant.create({ data: { name } });
  const t = tenant.id;

  const user = await db.user.create({
    data: { email: `sweep-${randomUUID()}@example.com`, name: "เจ้าของร้าน" },
  });
  createdUserIds.push(user.id);

  const branch = await db.branch.create({
    data: { tenantId: t, name: "สาขาทดสอบ", code: "SWEEP" },
  });

  // A POS integration owns a menu — the ordering Part 22 learned the hard way.
  const pos = await db.posIntegration.create({
    data: {
      tenantId: t,
      branchId: branch.id,
      posType: "CUSTOM",
      name: "POS ทดสอบ",
    },
  });
  await db.menu.create({
    data: {
      tenantId: t,
      name: "ข้าวผัด",
      // A POS menu, so menu_source_check requires the integration to be set —
      // which is precisely the dependency the delete order has to respect.
      source: "POS",
      posIntegrationId: pos.id,
      posMenuId: "SWEEP-01",
    },
  });

  // A PREPPED chain three deep: each product points at its parent.
  let parentId: string | null = null;
  let rawUnitId = "";
  for (let i = 0; i < 3; i++) {
    const p: { id: string } = await db.product.create({
      data: {
        tenantId: t,
        sku: `SW-${i}`,
        name: `ชิ้นที่ ${i}`,
        type: i === 0 ? "RAW" : "PREPPED",
        primaryDimension: "WEIGHT",
        parentProductId: parentId,
      },
    });
    const unit = await db.productUnit.create({
      data: {
        productId: p.id,
        unitName: "kg",
        unitDimension: "WEIGHT",
        toBaseRatio: 1,
        isBase: true,
      },
    });
    if (i === 0) rawUnitId = unit.id;
    parentId = p.id;
  }

  // A waste entry and the reversal that voids it. `reversalOfId` is half of a
  // partial unique, so nulling it to break the cycle would make the reversal
  // collide with the row it reverses — the sweep must delete, not null.
  const rawProduct = await db.product.findFirstOrThrow({
    where: { tenantId: t, sku: "SW-0" },
  });
  const waste = await db.wasteLog.create({
    data: {
      tenantId: t,
      productId: rawProduct.id,
      branchId: branch.id,
      inputQty: 5,
      inputUnitId: rawUnitId,
      occurredAt: new Date(),
      reason: "SPOILED",
      wastedBy: user.id,
    },
  });
  await db.wasteLog.create({
    data: {
      tenantId: t,
      productId: rawProduct.id,
      branchId: branch.id,
      inputQty: 5,
      inputUnitId: rawUnitId,
      occurredAt: new Date(),
      reason: "SPOILED",
      wastedBy: user.id,
      reversalOfId: waste.id,
    },
  });

  return t;
}

describe("test tenant sweep (ADR 0023 Q4)", () => {
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await db.$disconnect();
  });

  it("S3: deletes a tenant carrying a PREPPED chain, a POS menu and a reversal", async () => {
    const t = await buildTenant("Sweep Test Tenant");

    // Scoped to this tenant: other spec files are running right now, and an
    // unscoped sweep would delete their fixtures mid-test.
    const swept = await sweepTestTenants(db, { ids: [t] });

    expect(swept.map((s) => s.id)).toEqual([t]);
    expect(await db.tenant.count({ where: { id: t } })).toBe(0);
    // Nothing beneath it survived either — a surviving child is what keeps a
    // tenant alive in the first place.
    expect(await db.product.count({ where: { tenantId: t } })).toBe(0);
    expect(await db.wasteLog.count({ where: { tenantId: t } })).toBe(0);
    expect(await db.menu.count({ where: { tenantId: t } })).toBe(0);
    expect(await db.posIntegration.count({ where: { tenantId: t } })).toBe(0);
    expect(await db.branch.count({ where: { tenantId: t } })).toBe(0);
  });

  it("S4: the window protects anything that existed before it opened", async () => {
    const older = await buildTenant("Sweep Older Tenant");

    // A window that opens AFTER the tenant was created must not see it.
    const windowOpensNow = new Date(Date.now() + 1_000);
    const swept = await sweepTestTenants(db, {
      createdAfter: windowOpensNow,
      ids: [older],
    });

    expect(swept).toEqual([]);
    expect(await db.tenant.count({ where: { id: older } })).toBe(1);

    // And without the window it goes, so this spec leaves nothing behind.
    await sweepTestTenants(db, { ids: [older] });
    expect(await db.tenant.count({ where: { id: older } })).toBe(0);
  });

  it("S5: a user nobody claims is residue; one with a session is not", async () => {
    const orphan = await db.user.create({
      data: { email: `sweep-orphan-${randomUUID()}@example.com` },
    });
    const signedIn = await db.user.create({
      data: { email: `sweep-signedin-${randomUUID()}@example.com` },
    });
    createdUserIds.push(orphan.id, signedIn.id);

    // A session is what tells a real login apart from a test's leftover.
    await db.session.create({
      data: {
        sessionToken: `sweep-${randomUUID()}`,
        userId: signedIn.id,
        expires: new Date(Date.now() + 86_400_000),
      },
    });

    // Scoped: other specs are running, and most of their user fixtures have
    // no membership either — an unscoped sweep would take theirs too.
    const swept = await sweepOrphanUsers(db, {
      ids: [orphan.id, signedIn.id],
    });

    expect(swept.map((u) => u.id)).toContain(orphan.id);
    expect(swept.map((u) => u.id)).not.toContain(signedIn.id);
    expect(await db.user.count({ where: { id: orphan.id } })).toBe(0);
    expect(await db.user.count({ where: { id: signedIn.id } })).toBe(1);

    await db.session.deleteMany({ where: { userId: signedIn.id } });
  });
});
