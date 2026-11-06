// ADR 0045 part B — what the control page keeps, and the doors it may not open.
// Pure rules first; then the database: the app role's narrow policies, a
// closed shop letting nobody in, and an erasure that leaves nothing behind.

import { describe, it, expect, afterAll, vi } from "vitest";

// require-tenant loads Auth.js, which vitest cannot; only its membership list is used here.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { prismaBypass } from "@/lib/db-admin";
import { sweepTestTenants, sweepOrphanUsers } from "./support/sweep";
import { createTenant } from "@/server/tenant-init";
import { RETENTION, retentionCutoffs } from "@/lib/retention";
import {
  PROVINCES,
  announceSchema,
  nameConfirmed,
  purgeDate,
  recordRequestSchema,
  requestDue,
  shopAnswersSchema,
} from "@/lib/platform-requests";
import { buildOverview, buildTodos, type OverviewShop } from "@/lib/platform-overview";
import { recordLogin } from "@/server/usage-log";
import { listActiveMembershipsForUser } from "@/lib/require-tenant";
import { closeShopLogic, purgeExpiredRecordsLogic, purgeShopLogic, recordDataRequestLogic, reopenShopLogic } from "@/server/platform";
import type { PlatformActor } from "@/lib/platform-admin";

const actor = { userId: "test-operator", email: "operator@example.com", __platform: true } as PlatformActor;
const createdTenants: string[] = [];
const createdUsers: string[] = [];

afterAll(async () => {
  await sweepTestTenants(prismaBypass, { ids: createdTenants });
  await sweepOrphanUsers(prismaBypass, { ids: createdUsers });
  await prismaBypass.loginEvent.deleteMany({ where: { email: { contains: "partb-test" } } });
  await prismaBypass.dataRequest.deleteMany({ where: { createdBy: actor.email } });
  await prismaBypass.platformAuditLog.deleteMany({ where: { actorEmail: actor.email } });
});

async function shopWithOwner(label: string) {
  const user = await prismaBypass.user.create({ data: { email: `partb-test-${label}-${Date.now()}-${Math.random()}@example.com` } });
  createdUsers.push(user.id);
  const { tenant } = (await createTenant({ ownerUserId: user.id, tenantName: `ร้านทดสอบ ${label}` })) as { tenant: { id: string; name: string } };
  createdTenants.push(tenant.id);
  return { user, tenant };
}

describe("rules (pure)", () => {
  it("B1: the keep-dates in code are the privacy draft's §5", () => {
    const privacy = readFileSync(path.join(process.cwd(), "docs", "legal", "privacy-th.md"), "utf8");
    const sec = privacy.slice(privacy.indexOf("## 5."), privacy.indexOf("## 6."));
    const row = (label: string) => sec.split("\n").find((l) => l.startsWith(`| ${label}`)) ?? "";
    expect(row("การเข้าสู่ระบบ")).toContain(`${RETENTION.loginDays} วัน`);
    expect(row("การใช้งานรายวัน")).toContain(`${RETENTION.activityMonths} เดือน`);
    expect(row("คำขอเกี่ยวกับข้อมูล")).toContain(`${RETENTION.requestYears} ปี`);
  });

  it("B2: a request is due 30 days after it was made; a closed shop may be erased 30 days after closing", () => {
    expect(requestDue("2026-11-07")).toBe("2026-12-07");
    expect(requestDue("2027-02-10")).toBe("2027-03-12");
    expect(purgeDate("2026-11-07")).toBe("2026-12-07");
    const cut = retentionCutoffs(new Date("2026-11-07T00:00:00Z"));
    expect(cut.login.toISOString().slice(0, 10)).toBe("2026-08-09");
    expect(cut.activityDay.toISOString().slice(0, 10)).toBe("2025-11-07");
    expect(cut.requestDone.toISOString().slice(0, 10)).toBe("2023-11-07");
  });

  it("B3: the typed name must be the shop's; inputs refuse what makes no sense", () => {
    expect(nameConfirmed("  ครัวป้าศรี ", "ครัวป้าศรี")).toBe(true);
    expect(nameConfirmed("ครัวป้า", "ครัวป้าศรี")).toBe(false);
    expect(recordRequestSchema.safeParse({ kind: "export", shopId: null, requester: "a@b.th", requestedOn: "2026-11-01", note: null }).success).toBe(false);
    expect(recordRequestSchema.safeParse({ kind: "personal", shopId: null, requester: "a@b.th", requestedOn: "2026-11-01", note: null }).success).toBe(true);
    expect(announceSchema.safeParse({ message: "x", tone: "info", startsAt: "2026-11-07T10:00:00Z", endsAt: "2026-11-07T09:00:00Z" }).success).toBe(false);
    expect(shopAnswersSchema.parse({ shopType: "", province: "เชียงใหม่", heardFrom: undefined })).toEqual({ shopType: null, province: "เชียงใหม่", heardFrom: null });
    expect(shopAnswersSchema.safeParse({ shopType: "ร้านในฝัน", province: null, heardFrom: null }).success).toBe(false);
    expect(PROVINCES).toHaveLength(77);
    expect(new Set(PROVINCES).size).toBe(77);
  });

  const base = (over: Partial<OverviewShop> = {}): OverviewShop => ({
    id: "s1",
    name: "ร้าน",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    plan: "trial",
    freeUntil: null,
    method: "PERIODIC_INVENTORY",
    branches: 1,
    members: [
      { userId: "o", email: "o@x.th", role: "owner" },
      { userId: "c", email: "c@x.th", role: "cashier" },
    ],
    facts: { hasSupplier: true, hasProduct: true, hasSalesDay: true, hasLiveRecipe: false, hasClosedCount: true },
    lastByFeature: {},
    lastMovement: null,
    pos: {},
    branchesWithoutPos: 0,
    staffWithoutAccount: 0,
    peopleWithOwnPermissions: 0,
    answers: { shopType: "คาเฟ่ / เครื่องดื่ม", province: null, heardFrom: null },
    activeDays: { o: 20, c: 8 },
    ...over,
  });

  it("B4: days a week per role — over four weeks, or fewer while the record is younger", () => {
    const now = new Date("2026-11-07T03:00:00Z");
    const old = buildOverview([base()], new Set(), now, new Date("2026-09-01T00:00:00Z"));
    expect(old.usage!.roles.find((r) => r.key === "owner")!.perWeek).toBeCloseTo(5);
    expect(old.usage!.roles.find((r) => r.key === "cashier")!.perWeek).toBeCloseTo(2);
    const young = buildOverview([base({ activeDays: { o: 7, c: 0 } })], new Set(), now, new Date("2026-10-31T03:00:00Z"));
    expect(young.usage!.roles.find((r) => r.key === "owner")!.perWeek).toBeCloseTo(7);
    expect(buildOverview([base()], new Set(), now, null).usage).toBeNull();
    expect(old.answers.shopType).toEqual([{ key: "คาเฟ่ / เครื่องดื่ม", label: "คาเฟ่ / เครื่องดื่ม", n: 1, shops: [{ id: "s1", name: "ร้าน" }] }]);
  });

  it("B5: requests sit in ต้องทำ with their due date; a closed shop only once its erase day has come", () => {
    const now = new Date("2026-11-07T03:00:00Z");
    const t = buildTodos({
      shops: [base()],
      admins: new Set(),
      newReports: { count: 0, oldest: null },
      now,
      requests: [
        { id: "r1", kind: "export", shopName: "ครัวป้าศรี", requester: "a@b.th", dueOn: new Date("2026-11-30T00:00:00Z") },
        { id: "r2", kind: "personal", shopName: null, requester: "คุณสมชาย", dueOn: new Date("2026-11-10T00:00:00Z") },
      ],
      closed: [
        { id: "c1", name: "ร้านปิดแล้ว", purgeAfter: new Date("2026-11-05T00:00:00Z") },
        { id: "c2", name: "ร้านยังไม่ถึงวัน", purgeAfter: new Date("2026-11-20T00:00:00Z") },
      ],
    });
    const keys = t.map((x) => x.key);
    expect(keys.slice(0, 3)).toEqual(["purge-c1", "request-r2", "request-r1"]);
    expect(keys).not.toContain("purge-c2");
    expect(t.find((x) => x.key === "request-r2")).toMatchObject({ tone: "bad", chip: "เหลือ 3 วัน", title: "คุณสมชาย · ขอดู แก้ หรือลบข้อมูลของตัวเอง" });
    expect(t.find((x) => x.key === "request-r1")).toMatchObject({ tone: "warn", chip: "เหลือ 23 วัน" });
  });
});

describe("the app role's narrow doors (ADR 0045 Q9)", () => {
  it("B6: the app records a sign-in and cannot read one back — not even its own", async () => {
    const email = `partb-test-login-${Date.now()}@example.com`;
    await recordLogin({ userId: "u-login", email, ip: "203.0.113.9", userAgent: "Mozilla/5.0 (iPhone) Safari/604.1" });
    const asApp = await prisma.loginEvent.findMany({ where: { email } });
    expect(asApp).toHaveLength(0);
    const real = await prismaBypass.loginEvent.findMany({ where: { email } });
    expect(real).toHaveLength(1);
    expect(real[0]).toMatchObject({ ip: "203.0.113.9", userAgent: "iPhone · Safari" });
  });

  it("B7: the app reads announcements and cannot write one", async () => {
    const row = await prismaBypass.platformAnnouncement.create({
      data: { message: "partb-test ประกาศ", tone: "info", startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000), createdBy: actor.email },
    });
    try {
      const seen = await prisma.platformAnnouncement.findMany({ where: { id: row.id } });
      expect(seen).toHaveLength(1);
      await expect(
        prisma.platformAnnouncement.createMany({ data: [{ message: "x", tone: "info", startsAt: new Date(), endsAt: new Date(Date.now() + 1000), createdBy: "x" }] })
      ).rejects.toThrow();
    } finally {
      await prismaBypass.platformAnnouncement.delete({ where: { id: row.id } });
    }
  });

  it("B8: data requests are invisible to the app role", async () => {
    await recordDataRequestLogic(actor, { kind: "personal", shopId: null, requester: "partb-test person", requestedOn: "2026-11-01", note: null });
    expect(await prisma.dataRequest.count({ where: { createdBy: actor.email } })).toBe(0);
    expect(await prismaBypass.dataRequest.count({ where: { createdBy: actor.email } })).toBe(1);
  });
});

describe("closing and erasing a shop (ADR 0045 Q10)", () => {
  it("B9: closed = nobody gets in; reopened = back as it was", async () => {
    const { user, tenant } = await shopWithOwner("close");
    expect((await listActiveMembershipsForUser(user.id)).map((m) => m.tenantId)).toContain(tenant.id);
    await expect(closeShopLogic(actor, { tenantId: tenant.id, confirmName: "ชื่ออื่น" })).rejects.toThrow("ชื่อร้านที่พิมพ์ไม่ตรง");
    await closeShopLogic(actor, { tenantId: tenant.id, confirmName: tenant.name });
    expect((await listActiveMembershipsForUser(user.id)).map((m) => m.tenantId)).not.toContain(tenant.id);
    await reopenShopLogic(actor, tenant.id);
    expect((await listActiveMembershipsForUser(user.id)).map((m) => m.tenantId)).toContain(tenant.id);
  });

  it("B10: erasing waits for its day, then leaves no row of the shop, takes the owner's now-empty account, and closes the delete request", async () => {
    const { user, tenant } = await shopWithOwner("purge");
    await recordDataRequestLogic(actor, { kind: "delete", shopId: tenant.id, requester: user.email, requestedOn: "2026-11-01", note: null });
    await closeShopLogic(actor, { tenantId: tenant.id, confirmName: tenant.name });
    await expect(purgeShopLogic(actor, { tenantId: tenant.id, confirmName: tenant.name })).rejects.toThrow("ยังลบไม่ได้");

    await prismaBypass.tenant.update({ where: { id: tenant.id }, data: { purgeAfter: new Date("2026-01-01T00:00:00Z") } });
    const done = await purgeShopLogic(actor, { tenantId: tenant.id, confirmName: tenant.name });
    expect(done).toMatchObject({ name: tenant.name, usersRemoved: 1, requestsClosed: 1 });

    expect(await prismaBypass.tenant.count({ where: { id: tenant.id } })).toBe(0);
    expect(await prismaBypass.branch.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prismaBypass.tenantMembership.count({ where: { tenantId: tenant.id } })).toBe(0);
    expect(await prismaBypass.user.count({ where: { id: user.id } })).toBe(0);
    const req = await prismaBypass.dataRequest.findFirst({ where: { shopId: tenant.id } });
    expect(req?.doneAt).not.toBeNull();
    const log = await prismaBypass.platformAuditLog.findFirst({ where: { targetTenantId: tenant.id, action: "purge_shop" } });
    expect(log?.targetName).toBe(tenant.name);
  });
});

describe("keep-dates (ADR 0045 Q11)", () => {
  it("B11: past their keep date, sign-ins and done requests go; younger ones stay", async () => {
    const email = `partb-test-retention-${Date.now()}@example.com`;
    const now = new Date();
    await prismaBypass.loginEvent.createMany({
      data: [
        { userId: "u-ret", email, createdAt: new Date(now.getTime() - 91 * 86_400_000) },
        { userId: "u-ret", email, createdAt: new Date(now.getTime() - 89 * 86_400_000) },
      ],
    });
    await prismaBypass.dataRequest.create({
      data: {
        kind: "personal",
        requester: "partb-test old",
        requestedOn: new Date("2022-01-01T00:00:00Z"),
        dueOn: new Date("2022-01-31T00:00:00Z"),
        doneAt: new Date(now.getTime() - (3 * 366 + 1) * 86_400_000),
        doneBy: actor.email,
        createdBy: actor.email,
      },
    });
    const r = await purgeExpiredRecordsLogic(actor, now, true);
    expect(r).not.toBeNull();
    expect(await prismaBypass.loginEvent.count({ where: { email } })).toBe(1);
    expect(await prismaBypass.dataRequest.count({ where: { requester: "partb-test old" } })).toBe(0);
  });
});
