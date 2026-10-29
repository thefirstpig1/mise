// ============================================================
// คิดครัว — staff advances: record, prove, endorse, approve, repay
// (ADR 0037 Q5–Q6)
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withRlsBypass, prismaBypass } from "@/lib/db-admin";
import { computeBangkokToday } from "@/lib/bangkok-date";
import { productInputSchema } from "@/lib/validations/product";
import { selfPurchaseInputSchema } from "@/lib/validations/staff-advance";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { getStockBalanceLogic } from "@/server/stock-movement";
import { deleteObject } from "@/lib/storage";
import { recordUploadLogic } from "@/server/stored-file";
import {
  approveClaimLogic,
  ClaimActionError,
  claimStatus,
  endorseClaimLogic,
  getClaimsBoardLogic,
  getMyClaimsLogic,
  recordSelfPurchaseLogic,
  refundClaimsLogic,
  voidRefundLogic,
} from "@/server/staff-advance";
import { createTenant } from "@/server/tenant-init";
import { sweepTestTenants } from "./support/sweep";

const ALL = { allBranches: true, allowedBranchIds: [] as string[] };

describe("claimStatus (ADR 0037 Q6) — pure", () => {
  const base = { method: "TRANSFER" as const, amount: 344, billPhotos: 1, slips: 1, endorsed: false, approved: false, refunded: false };
  const off = { approvalAll: false, approvalOver: null };
  it("a bill photo comes first, then the slip; cash is endorsed instead of slipped", () => {
    expect(claimStatus({ ...base, billPhotos: 0 }, off)).toBe("NO_BILL");
    expect(claimStatus({ ...base, slips: 0 }, off)).toBe("NO_SLIP");
    expect(claimStatus({ ...base, method: "CASH", slips: 0 }, off)).toBe("NEEDS_ENDORSE");
    expect(claimStatus({ ...base, method: "CASH", slips: 0, endorsed: true }, off)).toBe("READY");
    expect(claimStatus(base, off)).toBe("READY");
    expect(claimStatus({ ...base, refunded: true, billPhotos: 0 }, off)).toBe("REFUNDED");
  });
  it("approval only when the shop asks for it — all bills, or bills over an amount", () => {
    expect(claimStatus(base, { approvalAll: true, approvalOver: null })).toBe("NEEDS_APPROVAL");
    expect(claimStatus(base, { approvalAll: false, approvalOver: 300 })).toBe("NEEDS_APPROVAL");
    expect(claimStatus(base, { approvalAll: false, approvalOver: 500 })).toBe("READY");
    expect(claimStatus({ ...base, approved: true }, { approvalAll: true, approvalOver: null })).toBe("READY");
  });
});

describe("staff advances against the database (ADR 0037 Q5–Q6)", () => {
  let tenant: string;
  let branch: string;
  let cook: string;
  let cook2: string;
  let accountant: string;
  let opexCategory: string;
  let pork: ProductWithUnits;
  const keys: string[] = [];
  const today = computeBangkokToday().toISOString().slice(0, 10);

  const unit = (p: ProductWithUnits) => p.productUnits.find((u) => u.isBase)!.id;
  const actor = (userId: string) => ({ userId, reach: ALL });
  const photo = async (userId: string, kind: "BILL" | "PAYMENT_SLIP" | "REFUND_SLIP") => {
    const r = await recordUploadLogic(tenant, userId, {
      kind,
      contentType: "image/jpeg",
      bytes: new TextEncoder().encode(`${kind}-${randomUUID()}`),
      thumb: null,
      originalName: null,
    });
    const row = await withRlsBypass((tx) => tx.storedFile.findUniqueOrThrow({ where: { id: r.file.id } }));
    keys.push(row.storageKey);
    return r.file.id;
  };
  const buy = async (userId: string, over: Partial<Parameters<typeof selfPurchaseInputSchema.parse>[0]> = {}) =>
    recordSelfPurchaseLogic(
      tenant,
      actor(userId),
      selfPurchaseInputSchema.parse({
        submitKey: randomUUID(),
        branchId: branch,
        billDate: today,
        vendorName: "ตลาด อ.ต.ก.",
        stockLines: [],
        otherLines: [{ categoryId: opexCategory, description: "ถุงพลาสติก", lineTotal: 80 }],
        payer: "STAFF",
        method: "TRANSFER",
        billFileIds: [await photo(userId, "BILL")],
        slipFileIds: [await photo(userId, "PAYMENT_SLIP")],
        ...over,
      })
    );
  const statusOf = async (userId: string, paymentId: string) =>
    (await getMyClaimsLogic(tenant, userId)).find((c) => c.paymentId === paymentId)!.status;

  beforeAll(async () => {
    const mk = async (n: string) =>
      (await prismaBypass.user.create({ data: { email: `adv-${n}-${randomUUID()}@example.com`, name: n } })).id;
    cook = await mk("สมใจ");
    cook2 = await mk("วิชัย");
    accountant = await mk("บัญชี");
    const made = (await createTenant({ ownerUserId: accountant, tenantName: "Advance Tenant" })) as { tenant: { id: string }; branch: { id: string } };
    tenant = made.tenant.id;
    branch = made.branch.id;
    opexCategory = (
      await withRlsBypass((tx) =>
        tx.category.findFirstOrThrow({ where: { tenantId: tenant, account: "OpEx" }, select: { id: true } })
      )
    ).id;
    pork = await createProductLogic(
      tenant,
      productInputSchema.parse({ name: `หมูสับ-${randomUUID().slice(0, 4)}`, type: "RAW", primaryDimension: "WEIGHT", baseUnitName: "kg" })
    );
  });

  afterAll(async () => {
    for (const k of keys) await deleteObject(k);
    await sweepTestTenants(prismaBypass, { ids: [tenant] });
    await withRlsBypass((tx) => tx.user.deleteMany({ where: { id: { in: [cook, cook2, accountant] } } }));
  });

  it("A1: a market bill with pork and bags is one bill, one payment — the pork on the shelf", async () => {
    const submitKey = randomUUID();
    const { expenseId, paymentId } = await buy(cook, {
      submitKey,
      stockLines: [{ productId: pork.id, unitId: unit(pork), qty: 4, lineTotal: 520 }],
      otherLines: [{ categoryId: opexCategory, description: "ถุงพลาสติก", lineTotal: 80 }],
    });
    const e = await withRlsBypass((tx) => tx.expense.findUniqueOrThrow({ where: { id: expenseId }, include: { items: true, payments: true, files: true } }));
    expect(e.sourceGrId).toBe(submitKey);
    expect(Number(e.netPaymentAmount)).toBe(600);
    expect(e.items.map((i) => [i.description.startsWith("หมูสับ"), Number(i.totalPrice)])).toEqual([
      [true, 520],
      [false, 80],
    ]);
    expect(e.vendorName).toBe("ตลาด อ.ต.ก.");
    expect(e.paymentStatus).toBe("PAID");
    expect(e.payments.map((p) => [p.id, p.payer, p.paidByUserId, Number(p.amount)])).toEqual([[paymentId, "STAFF", cook, 600]]);
    expect(e.files).toHaveLength(1);
    expect((await getStockBalanceLogic(tenant, { productId: pork.id, branchId: branch })).balance.toNumber()).toBe(4);
    // The receipt is on the shop's walk-in supplier, since staff cannot add one.
    const gr = await withRlsBypass((tx) => tx.goodsReceipt.findUniqueOrThrow({ where: { id: submitKey }, include: { supplier: true } }));
    expect([gr.status, gr.supplier.isWalkIn]).toEqual(["CONFIRMED", true]);
    expect(await statusOf(cook, paymentId)).toBe("READY");
  });

  it("A2: pressing the button again writes nothing new", async () => {
    const submitKey = randomUUID();
    const input = {
      submitKey,
      stockLines: [{ productId: pork.id, unitId: unit(pork), qty: 1, lineTotal: 130 }],
    };
    const first = await buy(cook, input);
    const again = await recordSelfPurchaseLogic(
      tenant,
      actor(cook),
      selfPurchaseInputSchema.parse({
        submitKey,
        branchId: branch,
        billDate: today,
        vendorName: "ตลาด อ.ต.ก.",
        stockLines: input.stockLines,
        otherLines: [{ categoryId: opexCategory, description: "ถุงพลาสติก", lineTotal: 80 }],
        payer: "STAFF",
        method: "TRANSFER",
      })
    );
    expect(again).toEqual(first);
    const payments = await withRlsBypass((tx) => tx.expensePayment.count({ where: { expenseId: first.expenseId } }));
    expect(payments).toBe(1);
  });

  it("A3: cash with no slip waits for the accountant — never the payer — to endorse it", async () => {
    const { paymentId } = await buy(cook, { method: "CASH", slipFileIds: [], noSlipReason: "แม่ค้ารับเงินสดอย่างเดียว" });
    expect(await statusOf(cook, paymentId)).toBe("NEEDS_ENDORSE");
    await expect(endorseClaimLogic(tenant, actor(cook), paymentId, "ของฉันเอง")).rejects.toMatchObject({ reason: "own" });
    await endorseClaimLogic(tenant, actor(accountant), paymentId, "ตลาดสดไม่มีสลิป รับได้");
    expect(await statusOf(cook, paymentId)).toBe("READY");
  });

  it("A4: a missing photo is said first; the shop's approval rule applies after the proof", async () => {
    const noBill = await buy(cook, { billFileIds: [] });
    expect(await statusOf(cook, noBill.paymentId)).toBe("NO_BILL");
    const noSlip = await buy(cook, { slipFileIds: [] });
    expect(await statusOf(cook, noSlip.paymentId)).toBe("NO_SLIP");

    await withRlsBypass((tx) => tx.tenant.update({ where: { id: tenant }, data: { refundApprovalOver: 50 } }));
    const big = await buy(cook);
    expect(await statusOf(cook, big.paymentId)).toBe("NEEDS_APPROVAL");
    await approveClaimLogic(tenant, actor(accountant), big.paymentId);
    expect(await statusOf(cook, big.paymentId)).toBe("READY");
    await withRlsBypass((tx) => tx.tenant.update({ where: { id: tenant }, data: { refundApprovalOver: null } }));
  });

  it("A5: one repayment covers several READY bills of ONE person; a void puts them back", async () => {
    const a = await buy(cook2);
    const b = await buy(cook2, { otherLines: [{ categoryId: opexCategory, description: "น้ำแข็ง", lineTotal: 40 }] });
    const notReady = await buy(cook2, { billFileIds: [] });
    const other = await buy(cook);

    const refund = (ids: string[], who = accountant) =>
      refundClaimsLogic(tenant, actor(who), { paymentIds: ids, method: "TRANSFER", refundedAt: new Date(), note: null, slipFileIds: [] });

    await expect(refund([a.paymentId, other.paymentId])).rejects.toMatchObject({ reason: "mixed" });
    await expect(refund([a.paymentId, notReady.paymentId])).rejects.toMatchObject({ reason: "state" });
    await expect(refund([a.paymentId], cook2)).rejects.toMatchObject({ reason: "own" });

    const done = await refund([a.paymentId, b.paymentId]);
    expect(done.amount).toBe(120);
    expect(await statusOf(cook2, a.paymentId)).toBe("REFUNDED");
    await expect(refund([a.paymentId])).rejects.toBeInstanceOf(ClaimActionError);

    await voidRefundLogic(tenant, actor(accountant), done.refundId, "โอนผิดคน");
    expect(await statusOf(cook2, a.paymentId)).toBe("READY");
  });

  it("A6: a bill with nothing for the shelf is a plain bill — no receipt", async () => {
    const submitKey = randomUUID();
    const { expenseId } = await buy(cook, { submitKey });
    expect(expenseId).toBe(submitKey);
    const gr = await withRlsBypass((tx) => tx.goodsReceipt.findFirst({ where: { id: submitKey } }));
    expect(gr).toBeNull();
  });

  it("A7: the shop's own money is not a claim on anybody", async () => {
    const { paymentId } = await buy(cook, { payer: "SHOP" });
    expect((await getMyClaimsLogic(tenant, cook)).some((c) => c.paymentId === paymentId)).toBe(false);
    const board = await getClaimsBoardLogic(tenant, ALL, { refundedSince: new Date(0) });
    expect(board.some((c) => c.paymentId === paymentId)).toBe(false);
  });
});
