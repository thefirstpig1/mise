// ============================================================
// คิดครัว — bill photos and slips: who may see one, and the same bill twice
// (ADR 0037 Q5–Q6)
// ============================================================
// Runs against the dev storage backend (.storage/ in the repo) — the same
// code path production takes, minus the bucket. Every object written here is
// deleted again in afterAll.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { withTenantContext } from "@/lib/db";
import { deleteObject, getObject, thumbKeyOf } from "@/lib/storage";
import { attachFilesInTx, FileNotAttachableError, getReadableFileLogic, recordUploadLogic } from "@/server/stored-file";
import { sweepTestTenants } from "./support/sweep";

describe("stored files (ADR 0037 Q5–Q6)", () => {
  let tenant: string;
  let branchA: string;
  let branchB: string;
  let staff: string;
  let accountant: string;
  let stranger: string;
  const keys: string[] = [];

  const photo = (seed: string) => new TextEncoder().encode(`fake-jpeg-${seed}-${randomUUID()}`);
  const upload = async (userId: string, bytes: Uint8Array, thumb: Uint8Array | null = null) => {
    const r = await recordUploadLogic(tenant, userId, { kind: "BILL", contentType: "image/jpeg", bytes, thumb, originalName: "bill.jpg" });
    const row = await withRlsBypass((tx) => tx.storedFile.findUniqueOrThrow({ where: { id: r.file.id } }));
    keys.push(row.storageKey, thumbKeyOf(row.storageKey));
    return { ...r, key: row.storageKey };
  };
  const bill = (branchId: string, payer: string | null) =>
    withRlsBypass(async (tx) => {
      const e = await tx.expense.create({
        data: { tenantId: tenant, branchId, billDate: new Date("2026-10-28"), subtotalExclVat: 344, totalAmount: 344, netPaymentAmount: 344, createdBy: payer ?? accountant },
      });
      if (payer) {
        await tx.expensePayment.create({
          data: { tenantId: tenant, branchId, expenseId: e.id, payer: "STAFF", paidByUserId: payer, method: "CASH", paidAt: new Date(), amount: 344, recordedBy: payer },
        });
      }
      return e.id;
    });
  const attach = (userId: string, fileId: string, expenseId: string) =>
    withTenantContext(tenant, (tx) => attachFilesInTx(tx, tenant, userId, [fileId], { expenseId }));
  const reach = (ids: string[]) => ({ allBranches: false, allowedBranchIds: ids });

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      tenant = (await tx.tenant.create({ data: { name: "Stored File Tenant" } })).id;
      branchA = (await tx.branch.create({ data: { tenantId: tenant, name: "อารีย์", code: `A${randomUUID().slice(0, 4)}` } })).id;
      branchB = (await tx.branch.create({ data: { tenantId: tenant, name: "ลาดพร้าว", code: `B${randomUUID().slice(0, 4)}` } })).id;
      const mk = async (n: string) => (await tx.user.create({ data: { email: `sf-${n}-${randomUUID()}@example.com`, name: n } })).id;
      staff = await mk("สมใจ");
      accountant = await mk("บัญชี");
      stranger = await mk("คนอื่น");
    });
  });

  afterAll(async () => {
    for (const k of keys) await deleteObject(k);
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: { in: [staff, accountant, stranger] } } }));
  });

  it("F1: the bytes and the small copy are stored; the row starts with no owner", async () => {
    const bytes = photo("f1");
    const thumb = new TextEncoder().encode("thumb");
    const { file, key } = await upload(staff, bytes, thumb);
    expect(file.byteSize).toBe(bytes.byteLength);
    expect(Buffer.from((await getObject(key))!).equals(Buffer.from(bytes))).toBe(true);
    expect(Buffer.from((await getObject(thumbKeyOf(key)))!).toString()).toBe("thumb");
    const row = await withRlsBypass((tx) => tx.storedFile.findUniqueOrThrow({ where: { id: file.id } }));
    expect([row.expenseId, row.expensePaymentId, row.staffRefundId]).toEqual([null, null, null]);
  });

  it("F2: the same bill photographed again is found by its bytes", async () => {
    const bytes = photo("f2");
    const first = await upload(staff, bytes);
    expect(first.duplicates).toEqual([]);
    const expenseId = await bill(branchA, staff);
    await attach(staff, first.file.id, expenseId);

    const again = await upload(staff, bytes);
    expect(again.duplicates).toEqual([{ expenseId, billDate: "2026-10-28", total: 344, who: "สมใจ" }]);
  });

  it("F3: only the uploader's own ownerless files can be attached", async () => {
    const mine = await upload(staff, photo("f3"));
    const expenseId = await bill(branchA, staff);
    await expect(attach(stranger, mine.file.id, expenseId)).rejects.toBeInstanceOf(FileNotAttachableError);
    await attach(staff, mine.file.id, expenseId);
    // already attached: a second attach (to anything) is refused
    await expect(attach(staff, mine.file.id, await bill(branchA, staff))).rejects.toBeInstanceOf(FileNotAttachableError);
  });

  it("F4: who may see a bill photo — uploader, the payer, and spending readers within reach", async () => {
    const { file } = await upload(accountant, photo("f4"));
    const expenseId = await bill(branchB, staff);
    await attach(accountant, file.id, expenseId);

    const sees = (userId: string, seesSpending: boolean, branches: string[]) =>
      getReadableFileLogic(tenant, file.id, { userId, reach: reach(branches), seesSpending }).then((f) => f !== null);

    expect(await sees(accountant, false, [])).toBe(true); // uploaded it
    expect(await sees(staff, false, [])).toBe(true); // paid this bill
    expect(await sees(stranger, false, [branchB])).toBe(false); // no spending view
    expect(await sees(stranger, true, [branchA])).toBe(false); // spending view, wrong branch
    expect(await sees(stranger, true, [branchB])).toBe(true); // spending view, in reach
  });

  it("F5: an ownerless file is the uploader's alone", async () => {
    const { file } = await upload(staff, photo("f5"));
    const all = { allBranches: true, allowedBranchIds: [] };
    expect(await getReadableFileLogic(tenant, file.id, { userId: stranger, reach: all, seesSpending: true })).toBeNull();
    expect(await getReadableFileLogic(tenant, file.id, { userId: staff, reach: reach([]), seesSpending: false })).not.toBeNull();
  });
});
