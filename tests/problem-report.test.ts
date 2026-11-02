// ============================================================
// คิดครัว — problem reports (ADR 0044)
// ============================================================
// Pinned where it could go wrong for a real person: two staff in one shop
// sending at the same moment get two numbers; the owner does NOT read a
// cook's report (Kong 2026-11-03 "ตามนั้น"); a report cannot carry somebody
// else's photo; the badge counts only answers not yet seen; the letter to
// the reporter goes once, the first time the fix is live; and the
// operator's screenshot door opens on report screenshots and nothing else.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prismaBypass } from "@/lib/db-admin";
import { withTenantContext } from "@/lib/db";
import type { PlatformActor } from "@/lib/platform-admin";
import { createReportSchema, deviceOf, reportNo } from "@/lib/problem-report";
import { createTenant } from "@/server/tenant-init";
import {
  createProblemReportLogic,
  listMyReportsLogic,
  markMyReportsSeenLogic,
  unseenReplyCountLogic,
} from "@/server/problem-report";
import { getReportScreenshotLogic, listPlatformReportsLogic, newReportCountLogic, updatePlatformReportLogic } from "@/server/platform";
import { FileNotAttachableError } from "@/server/stored-file";
import { sweepTestTenants } from "./support/sweep";

const tag = randomUUID().slice(0, 6);
const actor = { userId: "report-test", email: "operator@example.com", __platform: true } as PlatformActor;
const created: string[] = [];
const users: string[] = [];

let shopA: string;
let branchA: string;
let shopB: string;
let branchB: string;
let owner: string; // shop A's owner
let cook: string; // shop A's kitchen staff
let other: string; // shop B's owner

const send = (tenantId: string, reporterId: string, over: Partial<Parameters<typeof createProblemReportLogic>[2]> = {}) =>
  createProblemReportLogic(tenantId, reporterId, { kind: "PROBLEM", message: "หน้าค้าง", pagePath: "/goods-receipts/new", fileIds: [], ...over });

async function upload(tenantId: string, uploadedBy: string, kind: "REPORT_SCREENSHOT" | "BILL" = "REPORT_SCREENSHOT") {
  const id = randomUUID();
  await prismaBypass.storedFile.create({
    data: { id, tenantId, kind, storageKey: `${tenantId}/test/${id}.png`, contentType: "image/png", byteSize: 10, sha256: id.replace(/-/g, ""), uploadedBy },
  });
  return id;
}

beforeAll(async () => {
  const mkUser = async (who: string) => {
    const u = await prismaBypass.user.create({ data: { email: `report-test-${who}-${tag}@example.com`, name: `${who} ${tag}` } });
    users.push(u.id);
    return u.id;
  };
  [owner, cook, other] = await Promise.all([mkUser("owner"), mkUser("cook"), mkUser("other")]);
  const a = (await createTenant({ ownerUserId: owner, tenantName: `Report A ${tag}` })) as { tenant: { id: string }; branch: { id: string } };
  const b = (await createTenant({ ownerUserId: other, tenantName: `Report B ${tag}` })) as { tenant: { id: string }; branch: { id: string } };
  shopA = a.tenant.id;
  branchA = a.branch.id;
  shopB = b.tenant.id;
  branchB = b.branch.id;
  created.push(shopA, shopB);
  await prismaBypass.tenantMembership.create({ data: { tenantId: shopA, userId: cook, role: "kitchen_staff", isActive: true } });
});

afterAll(async () => {
  await prismaBypass.platformAuditLog.deleteMany({ where: { targetTenantId: { in: created } } });
  await sweepTestTenants(prismaBypass, { ids: created });
  await prismaBypass.user.deleteMany({ where: { id: { in: users } } });
});

describe("problem reports — the shop's side (ADR 0044)", () => {
  it("PR1 — numbers run per shop, and three sent at once get three numbers", async () => {
    const [x, y, z] = await Promise.all([send(shopA, cook), send(shopA, cook), send(shopA, owner)]);
    expect(new Set([x.number, y.number, z.number]).size).toBe(3);
    expect([x.number, y.number, z.number].sort()).toEqual([1, 2, 3]);
    const first = await send(shopB, other);
    expect(first.number).toBe(1);
    expect(reportNo(first.number)).toBe("R-0001");
    expect(x.shopName).toBe(`Report A ${tag}`);
  });

  it("PR2 — each person reads their own reports only; the owner does not read the cook's", async () => {
    const mine = await listMyReportsLogic(shopA, cook);
    const theirs = await listMyReportsLogic(shopA, owner);
    expect(mine.length).toBe(2);
    expect(theirs.length).toBe(1);
    expect(mine.every((r) => !theirs.some((t) => t.id === r.id))).toBe(true);
    // Another shop's reporter, asked inside shop A, has nothing here.
    expect(await listMyReportsLogic(shopA, other)).toEqual([]);
  });

  it("PR3 — RLS: shop B's context cannot see shop A's reports at all", async () => {
    const seen = await withTenantContext(shopB, (tx) => tx.problemReport.count({ where: { tenantId: shopA } }));
    expect(seen).toBe(0);
  });

  it("PR4 — a report carries the reporter's own screenshots, and nobody else's", async () => {
    const own = await upload(shopA, cook);
    const r = await send(shopA, cook, { fileIds: [own] });
    expect((await listMyReportsLogic(shopA, cook)).find((x) => x.id === r.id)?.fileIds).toEqual([own]);

    const before = await prismaBypass.problemReport.count({ where: { tenantId: shopA } });
    const ownersPhoto = await upload(shopA, owner);
    await expect(send(shopA, cook, { fileIds: [ownersPhoto] })).rejects.toBeInstanceOf(FileNotAttachableError);
    // Already attached once — cannot be carried by a second report either.
    await expect(send(shopA, cook, { fileIds: [own] })).rejects.toBeInstanceOf(FileNotAttachableError);
    // The refused report was not half-written.
    expect(await prismaBypass.problemReport.count({ where: { tenantId: shopA } })).toBe(before);
  });

  it("PR5 — a branch the shop does not have is dropped, not stored", async () => {
    const r = await send(shopA, owner, { branchId: branchB });
    const row = await prismaBypass.problemReport.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.branchId).toBeNull();
    const ok = await send(shopA, owner, { branchId: branchA });
    expect((await prismaBypass.problemReport.findUniqueOrThrow({ where: { id: ok.id } })).branchId).toBe(branchA);
  });

  it("PR6 — the form: a message is required, at most three pictures; the device reads plainly", () => {
    const base = { kind: "IDEA", pagePath: "/dashboard" };
    expect(createReportSchema.safeParse({ ...base, message: "   " }).success).toBe(false);
    expect(createReportSchema.safeParse({ ...base, message: "x", fileIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()] }).success).toBe(false);
    expect(createReportSchema.safeParse({ ...base, message: " อยากได้ " }).data?.message).toBe("อยากได้");
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("iPhone · Safari");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 Line/14.0")).toBe("Android · Chrome");
  });
});

describe("problem reports — the operator's side (ADR 0044)", () => {
  it("PR7 — the inbox crosses shops, names the reporter's role, and counts what is new", async () => {
    const all = await listPlatformReportsLogic(actor);
    const ours = all.filter((r) => r.shopName.endsWith(tag));
    expect(ours.some((r) => r.shopName === `Report B ${tag}`)).toBe(true);
    expect(ours.find((r) => r.reporter === `cook ${tag}`)?.reporterRole).toBe("kitchen_staff");
    expect(await newReportCountLogic(actor)).toBeGreaterThanOrEqual(ours.length);
  });

  it("PR8 — an answer lights the reporter's badge until they open their list, and again for a new answer", async () => {
    const r = await send(shopA, cook, { message: "ถามวิธีนับ", kind: "QUESTION" });
    expect(await unseenReplyCountLogic(shopA, cook)).toBe(0);

    await updatePlatformReportLogic(actor, { id: r.id, status: "LOOKING", reply: "นับเฉพาะของสดครับ" });
    expect(await unseenReplyCountLogic(shopA, cook)).toBe(1);
    expect(await unseenReplyCountLogic(shopA, owner)).toBe(0); // the owner's badge is the owner's
    expect((await listMyReportsLogic(shopA, cook)).find((x) => x.id === r.id)?.unseen).toBe(true);

    await markMyReportsSeenLogic(shopA, cook);
    expect(await unseenReplyCountLogic(shopA, cook)).toBe(0);

    // A status change with the same answer is not a new answer…
    await updatePlatformReportLogic(actor, { id: r.id, status: "CLOSED", reply: "นับเฉพาะของสดครับ" });
    expect(await unseenReplyCountLogic(shopA, cook)).toBe(0);
    // …a changed answer is.
    await new Promise((res) => setTimeout(res, 5));
    await updatePlatformReportLogic(actor, { id: r.id, status: "CLOSED", reply: "นับของสดและของแปรรูปที่ทำเก็บไว้ครับ" });
    expect(await unseenReplyCountLogic(shopA, cook)).toBe(1);
  });

  it("PR9 — the reporter is written to once: the first time the fix is live", async () => {
    const r = await send(shopA, cook, { message: "ช่องตัวเลขเด้งกลับเป็น 0" });
    expect((await updatePlatformReportLogic(actor, { id: r.id, status: "FIXED_PENDING", internalNote: "แก้แล้ว รอ deploy" }))?.tellReporter).toBeNull();
    const live = await updatePlatformReportLogic(actor, { id: r.id, status: "FIXED_LIVE", reply: "แก้ไขเรียบร้อยแล้วครับ" });
    expect(live?.tellReporter).toEqual({ to: `report-test-cook-${tag}@example.com`, number: r.number, message: "ช่องตัวเลขเด้งกลับเป็น 0", reply: "แก้ไขเรียบร้อยแล้วครับ" });
    expect((await updatePlatformReportLogic(actor, { id: r.id, status: "FIXED_LIVE", reply: "แก้ไขเรียบร้อยแล้วครับ ขอบคุณครับ" }))?.tellReporter).toBeNull();

    // Every status/answer change is in the operator's log; the internal note is never shown to the shop.
    const log = await prismaBypass.platformAuditLog.findMany({ where: { targetTenantId: shopA, action: "problem_report.update", targetName: { endsWith: reportNo(r.number) } } });
    expect(log.length).toBe(3);
    const shopView = (await listMyReportsLogic(shopA, cook)).find((x) => x.id === r.id)!;
    expect(JSON.stringify(shopView)).not.toContain("รอ deploy");
    expect(shopView.status).toBe("FIXED_LIVE");
  });

  it("PR10 — the operator's picture door opens on a report's screenshot only — never a bill, never a loose upload", async () => {
    const shot = await upload(shopB, other);
    await send(shopB, other, { fileIds: [shot] });
    const loose = await upload(shopB, other);
    const bill = await upload(shopB, other, "BILL");
    expect(await getReportScreenshotLogic(actor, shot)).not.toBeNull();
    expect(await getReportScreenshotLogic(actor, loose)).toBeNull();
    expect(await getReportScreenshotLogic(actor, bill)).toBeNull();
    expect(await updatePlatformReportLogic(actor, { id: randomUUID(), status: "CLOSED" })).toBeNull();
  });
});
