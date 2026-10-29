// ============================================================
// คิดครัว — the operator's door (ADR 0043)
// ============================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The session is not what these tests are about; next-auth cannot load under vitest.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { prismaBypass, withRlsBypass } from "@/lib/db-admin";
import { isPlatformAdminEmail, platformAdminEmails, type PlatformActor } from "@/lib/platform-admin";
import { listAuditLogic, listShopsLogic, PlatformInputError, searchUsersLogic, setShopPlanLogic } from "@/server/platform";
import { sweepTestTenants } from "./support/sweep";

describe("who is a platform admin (ADR 0043 Q1) — pure", () => {
  it("is read from the secret, case-insensitive, trimmed; anything else is nobody", () => {
    const raw = " Owner@Example.com , second@example.com,not-an-email ,";
    expect([...platformAdminEmails(raw)]).toEqual(["owner@example.com", "second@example.com"]);
    expect(isPlatformAdminEmail("OWNER@example.com", raw)).toBe(true);
    expect(isPlatformAdminEmail("someone@example.com", raw)).toBe(false);
    expect(isPlatformAdminEmail(null, raw)).toBe(false);
    // Unset = nobody — the safe default on a fresh deploy.
    expect(platformAdminEmails(undefined).size).toBe(0);
    expect(isPlatformAdminEmail("owner@example.com", "")).toBe(false);
  });
});

describe("the platform screens against the database (ADR 0043)", () => {
  const actor = { userId: "platform-test", email: "operator@example.com", __platform: true } as PlatformActor;
  let shopA: string;
  let shopB: string;
  let user: string;
  const tag = randomUUID().slice(0, 6);

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      shopA = (await tx.tenant.create({ data: { name: `Platform A ${tag}` } })).id;
      shopB = (await tx.tenant.create({ data: { name: `Platform B ${tag}` } })).id;
      user = (await tx.user.create({ data: { email: `platform-${tag}@example.com`, name: `ผู้ใช้ ${tag}` } })).id;
      await tx.tenantMembership.create({ data: { tenantId: shopA, userId: user, role: "owner", isActive: true } });
    });
  });

  afterAll(async () => {
    await prismaBypass.platformAuditLog.deleteMany({ where: { targetTenantId: { in: [shopA, shopB] } } });
    await sweepTestTenants(prismaBypass, { ids: [shopA, shopB] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: user } }));
  });

  it("P1: lists every shop, across tenants, with its owner", async () => {
    const shops = await listShopsLogic(actor);
    const a = shops.find((s) => s.id === shopA);
    expect(a?.owners).toEqual([`platform-${tag}@example.com`]);
    expect(shops.some((s) => s.id === shopB)).toBe(true);
  });

  it("P2: a package change is written and logged in the same breath", async () => {
    await setShopPlanLogic(actor, { tenantId: shopA, plan: "standard", freeUntil: "2027-10-30", note: "ร้านแรก ใช้ฟรี 1 ปี" });
    const t = await prismaBypass.tenant.findUniqueOrThrow({ where: { id: shopA } });
    expect([t.plan, t.planFreeUntil?.toISOString().slice(0, 10), t.planNote]).toEqual(["standard", "2027-10-30", "ร้านแรก ใช้ฟรี 1 ปี"]);
    const log = await prismaBypass.platformAuditLog.findMany({ where: { targetTenantId: shopA } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      actorEmail: "operator@example.com",
      action: "set_plan",
      targetName: `Platform A ${tag}`,
      before: { plan: "trial", freeUntil: null, note: null },
      after: { plan: "standard", freeUntil: "2027-10-30", note: "ร้านแรก ใช้ฟรี 1 ปี" },
    });
    expect((await listAuditLogic(actor)).some((r) => r.target === `Platform A ${tag}`)).toBe(true);
  });

  it("P3: a bad date or plan changes nothing and logs nothing", async () => {
    await expect(setShopPlanLogic(actor, { tenantId: shopB, plan: "standard", freeUntil: "2027-13-40", note: null })).rejects.toBeInstanceOf(PlatformInputError);
    await expect(setShopPlanLogic(actor, { tenantId: shopB, plan: "gold" as never, freeUntil: null, note: null })).rejects.toBeInstanceOf(PlatformInputError);
    expect(await prismaBypass.platformAuditLog.count({ where: { targetTenantId: shopB } })).toBe(0);
    expect((await prismaBypass.tenant.findUniqueOrThrow({ where: { id: shopB } })).plan).toBe("trial");
  });

  it("P4: finds a person by part of their e-mail, with their shops", async () => {
    const found = await searchUsersLogic(actor, `platform-${tag}`);
    expect(found.map((u) => [u.email, u.memberships.map((m) => [m.shop, m.role])])).toEqual([
      [`platform-${tag}@example.com`, [[`Platform A ${tag}`, "owner"]]],
    ]);
    expect(await searchUsersLogic(actor, "x")).toEqual([]); // one letter is not a search
  });

  it("P5: the app role cannot see the operator's log at all (RLS on, no policy)", async () => {
    expect(await prismaBypass.platformAuditLog.count({ where: { targetTenantId: shopA } })).toBe(1);
    const asApp = await prisma.$queryRawUnsafe<{ n: number }[]>(`select count(*)::int as n from platform_audit_log`);
    expect(asApp[0].n).toBe(0);
  });
});
