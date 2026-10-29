// ============================================================
// คิดครัว — staff advances: สำรองจ่าย / เบิกคืน (ADR 0037 Q5–Q6)
// ============================================================
// Kong 2026-10-27: "ถ้าวิ่งไปซื้อเอง คนที่ซื้ออาจจะต้องบันทึกภาพที่ซื้อ
// สลิปโอน แล้วก็เขียนเป็นสำรองจ่าย เพื่อที่บัญชีจะได้โอนคืนให้พนักงาน"
//
// A self-purchase is three ordinary things, written by one button:
//   1. the stock lines → a standalone goods receipt, confirmed — the SAME path
//      a delivery takes, so FIFO, the ledger and the bill are not re-invented;
//   2. the bill → the receipt's own expense (or a plain one when nothing went
//      on the shelf), with the non-stock lines appended and the place named;
//   3. how it was paid → one `expense_payment`, with the photos attached.
// The receipt is created and confirmed by the existing logic in its own
// transactions; everything after is one more. The form keeps its submitKey
// across retries, and every step is a no-op on replay, so a failure halfway
// is finished by pressing the button again.
//
// A claim's status is computed here and stored nowhere (`claimStatus`).
// ============================================================

import { Prisma, type PaymentMethod, type PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { canAccessBranch, type BranchReach } from "@/lib/permissions/service";
import { goodsReceiptInputSchema } from "@/lib/validations/goods-receipt";
import { METHOD_TH, type SelfPurchaseInput } from "@/lib/validations/staff-advance";
import { confirmGoodsReceiptLogic, createGoodsReceiptLogic } from "@/server/goods-receipt";
import { assertRefBelongsToTenant } from "@/server/product";
import { attachFilesInTx } from "@/server/stored-file";

const ZERO = new Prisma.Decimal(0);
const TX = { maxWait: 10_000, timeout: 20_000 } as const;
/** The same window a delivery has (ADR 0013). */
export const SELF_PURCHASE_BACKDATE_DAYS = 30;

export class SelfPurchaseError extends Error {
  constructor(public readonly reason: "date" | "branch" | "purchase-request" | "replay-mismatch", message: string) {
    super(message);
    this.name = "SelfPurchaseError";
  }
}
export class ClaimActionError extends Error {
  constructor(
    public readonly reason: "not-found" | "own" | "state" | "branch" | "mixed" | "empty",
    message: string
  ) {
    super(message);
    this.name = "ClaimActionError";
  }
}

// ------------------------------------------------------------
// The walk-in supplier
// ------------------------------------------------------------

export const WALK_IN_SUPPLIER_NAME = "ซื้อเอง (ตลาด / ร้านทั่วไป)";

/** The shop's one walk-in supplier, made on first use. Races meet the partial unique. */
export async function ensureWalkInSupplierLogic(tenantId: string): Promise<string> {
  const find = (tx: PrismaClient) =>
    tx.supplier.findFirst({ where: { tenantId, isWalkIn: true, deletedAt: null }, select: { id: true } });
  return withTenantContext(tenantId, async (tx: PrismaClient) => {
    const found = await find(tx);
    if (found) return found.id;
    try {
      const made = await tx.supplier.create({
        data: { tenantId, nameFull: WALK_IN_SUPPLIER_NAME, isWalkIn: true, paymentTerms: "จ่ายเมื่อซื้อ" },
        select: { id: true },
      });
      return made.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const again = await find(tx);
        if (again) return again.id;
      }
      throw e;
    }
  });
}

// ------------------------------------------------------------
// Recording a self-purchase
// ------------------------------------------------------------

/** "2026-10-28" → when it happened: now if today, else noon Bangkok that day. */
function boughtAt(billDate: string): { day: Date; at: Date } {
  const day = new Date(`${billDate}T00:00:00Z`);
  const today = computeBangkokToday();
  if (day.getTime() > today.getTime()) throw new SelfPurchaseError("date", "วันที่ซื้อต้องไม่เป็นอนาคต");
  if (day.getTime() < addDays(today, -SELF_PURCHASE_BACKDATE_DAYS).getTime()) {
    throw new SelfPurchaseError("date", `บันทึกย้อนหลังได้ไม่เกิน ${SELF_PURCHASE_BACKDATE_DAYS} วัน`);
  }
  const at = day.getTime() === today.getTime() ? new Date() : new Date(`${billDate}T05:00:00Z`);
  return { day, at };
}

export async function recordSelfPurchaseLogic(
  tenantId: string,
  actor: { userId: string; reach: BranchReach },
  input: SelfPurchaseInput
): Promise<{ expenseId: string; paymentId: string }> {
  if (!canAccessBranch(actor.reach, input.branchId)) throw new SelfPurchaseError("branch", "บัญชีนี้ไม่ได้ดูแลสาขานี้");
  const { day, at } = boughtAt(input.billDate);

  // ---- 1. the shelf: a standalone receipt, through the delivery path ----
  let grId: string | null = null;
  if (input.stockLines.length > 0) {
    const supplierId = input.supplierId ?? (await ensureWalkInSupplierLogic(tenantId));
    const gr = await createGoodsReceiptLogic(
      tenantId,
      goodsReceiptInputSchema.parse({
        submitKey: input.submitKey,
        branchId: input.branchId,
        supplierId,
        purchaseOrderId: null,
        invoiceNo: input.billNo,
        receivedAt: at,
        vatRatePercent: null,
        pricesIncludeVat: false,
        notes: input.vendorName ? `ซื้อเองที่ ${input.vendorName}` : null,
        lines: input.stockLines.map((l) => ({
          purchaseOrderItemId: null,
          productId: l.productId,
          receivedUnitId: l.unitId,
          qtyReceivedActual: l.qty,
          // The bill says the line's total; the receipt stores a unit price.
          unitPriceActual: Number((l.lineTotal / l.qty).toFixed(4)),
          notes: null,
        })),
      }),
      actor.userId
    );
    if (gr.branchId !== input.branchId) throw new SelfPurchaseError("replay-mismatch", "บันทึกนี้ถูกใช้กับสาขาอื่นแล้ว");
    if (gr.status === "DRAFT") await confirmGoodsReceiptLogic(tenantId, gr.id, actor.userId);
    grId = gr.id;
  }

  // ---- 2 + 3. the bill and how it was paid ----
  return withTenantContext(
    tenantId,
    async (tx: PrismaClient) => {
      for (const l of input.otherLines) await assertRefBelongsToTenant(tx, tenantId, "category", l.categoryId);
      if (input.supplierId) await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);

      let expense = grId
        ? await tx.expense.findFirst({ where: { tenantId, sourceGrId: grId, deletedAt: null }, include: { items: true } })
        : await tx.expense.findFirst({ where: { tenantId, id: input.submitKey }, include: { items: true } });

      const replay = expense ? await tx.expensePayment.findFirst({ where: { tenantId, expenseId: expense.id, voidedAt: null } }) : null;
      if (expense && replay) return { expenseId: expense.id, paymentId: replay.id };

      const others = input.otherLines.map((l) => ({ ...l, total: new Prisma.Decimal(l.lineTotal) }));
      const othersSum = others.reduce((s, l) => s.plus(l.total), ZERO);
      const paidAt = at;
      const billFields = {
        vendorName: input.vendorName,
        billNo: input.billNo,
        paymentStatus: "PAID" as const,
        paidAt,
        paymentMethod: METHOD_TH[input.method],
      };

      if (expense) {
        // The receipt wrote the stock half of the bill; the rest of the bill
        // joins it, so one photo and one payment cover the whole bill.
        const start = expense.items.length;
        if (others.length > 0) {
          await tx.expenseItem.createMany({
            data: others.map((l, i) => ({
              tenantId,
              expenseId: expense!.id,
              lineNo: start + i + 1,
              categoryId: l.categoryId,
              description: l.description,
              totalPrice: l.total,
            })),
          });
        }
        expense = await tx.expense.update({
          where: { id: expense.id },
          data: {
            ...billFields,
            subtotalExclVat: expense.subtotalExclVat.plus(othersSum),
            totalAmount: expense.totalAmount.plus(othersSum),
            netPaymentAmount: expense.netPaymentAmount.plus(othersSum),
          },
          include: { items: true },
        });
      } else {
        // Nothing went on the shelf: a plain bill, named after the form.
        expense = await tx.expense.create({
          data: {
            id: input.submitKey,
            tenantId,
            branchId: input.branchId,
            supplierId: input.supplierId,
            source: "MANUAL",
            billDate: day,
            subtotalExclVat: othersSum,
            vatRatePercent: null,
            vatAmount: ZERO,
            isPriceVatInclusive: false,
            totalAmount: othersSum,
            netPaymentAmount: othersSum,
            createdBy: actor.userId,
            ...billFields,
            items: {
              create: others.map((l, i) => ({
                tenantId,
                lineNo: i + 1,
                categoryId: l.categoryId,
                description: l.description,
                totalPrice: l.total,
              })),
            },
          },
          include: { items: true },
        });
      }

      // The purchase-request lines this bought, so the purchaser does not
      // order them again (ADR 0037 Q6). Only lines of this branch and product.
      if (grId) {
        for (const [i, l] of input.stockLines.entries()) {
          if (!l.purchaseRequestLineId) continue;
          const pr = await tx.purchaseRequestLine.findFirst({
            where: { tenantId, id: l.purchaseRequestLineId, branchId: input.branchId, productId: l.productId, deletedAt: null },
            select: { id: true },
          });
          if (!pr) throw new SelfPurchaseError("purchase-request", "รายการในใบขอซื้อไม่ตรงกับของที่ซื้อ");
          await tx.goodsReceiptItem.updateMany({
            where: { tenantId, goodsReceiptId: grId, lineNo: i + 1, reversalOfItemId: null },
            data: { purchaseRequestLineId: pr.id },
          });
        }
      }

      const payment = await tx.expensePayment.create({
        data: {
          tenantId,
          branchId: input.branchId,
          expenseId: expense.id,
          payer: input.payer,
          paidByUserId: input.payer === "STAFF" ? actor.userId : null,
          method: input.method,
          paidAt,
          amount: expense.netPaymentAmount,
          noSlipReason: input.noSlipReason,
          recordedBy: actor.userId,
        },
      });

      await attachFilesInTx(tx, tenantId, actor.userId, input.billFileIds, { expenseId: expense.id });
      await attachFilesInTx(tx, tenantId, actor.userId, input.slipFileIds, { expensePaymentId: payment.id });
      return { expenseId: expense.id, paymentId: payment.id };
    },
    TX
  );
}

// ------------------------------------------------------------
// What state a claim is in — computed, never stored
// ------------------------------------------------------------

export type ClaimStatus = "NO_BILL" | "NO_SLIP" | "NEEDS_ENDORSE" | "NEEDS_APPROVAL" | "READY" | "REFUNDED";

export const CLAIM_STATUS_TH: Record<ClaimStatus, string> = {
  NO_BILL: "ขาดรูปบิล",
  NO_SLIP: "ขาดสลิป",
  NEEDS_ENDORSE: "รอบัญชีรับรอง",
  NEEDS_APPROVAL: "รออนุมัติ",
  READY: "รอคืนเงิน",
  REFUNDED: "คืนแล้ว",
};

/** A slip is expected for a transfer or a card; cash and "other" are endorsed instead (Q6). */
export const methodHasSlip = (m: PaymentMethod) => m === "TRANSFER" || m === "CARD";

export function claimStatus(
  c: { method: PaymentMethod; amount: number; billPhotos: number; slips: number; endorsed: boolean; approved: boolean; refunded: boolean },
  settings: { approvalAll: boolean; approvalOver: number | null }
): ClaimStatus {
  if (c.refunded) return "REFUNDED";
  // Kong (ADR 0037 Q6): "ต้องมีรูปบิล แล้วก็สลิป ถึงจะเบิกได้".
  if (c.billPhotos === 0) return "NO_BILL";
  if (methodHasSlip(c.method)) {
    if (c.slips === 0) return "NO_SLIP";
  } else if (c.slips === 0 && !c.endorsed) {
    return "NEEDS_ENDORSE";
  }
  const needsApproval = settings.approvalAll || (settings.approvalOver !== null && c.amount > settings.approvalOver);
  if (needsApproval && !c.approved) return "NEEDS_APPROVAL";
  return "READY";
}

// ------------------------------------------------------------
// Reading claims
// ------------------------------------------------------------

export type ClaimView = {
  paymentId: string;
  expenseId: string;
  branchId: string;
  branchName: string;
  billDate: string;
  place: string;
  /** "ผักบุ้ง 3 kg · มะนาว 2 kg · +1" */
  what: string;
  method: PaymentMethod;
  amount: number;
  noSlipReason: string | null;
  endorseNote: string | null;
  status: ClaimStatus;
  billPhotoIds: string[];
  slipIds: string[];
  payer: { id: string; name: string };
  refund: { id: string; at: string; method: PaymentMethod; slipIds: string[] } | null;
  createdAt: string;
};

const CLAIM_INCLUDE = {
  branch: { select: { name: true } },
  paidByUser: { select: { id: true, name: true, email: true } },
  files: { where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } },
  staffRefund: {
    select: { id: true, refundedAt: true, method: true, voidedAt: true, files: { where: { deletedAt: null }, select: { id: true } } },
  },
  expense: {
    select: {
      id: true,
      billDate: true,
      vendorName: true,
      supplier: { select: { nameFull: true, nameShort: true, isWalkIn: true } },
      items: { select: { description: true }, orderBy: { lineNo: "asc" } },
      files: { where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "asc" } },
    },
  },
} satisfies Prisma.ExpensePaymentInclude;

type ClaimRow = Prisma.ExpensePaymentGetPayload<{ include: typeof CLAIM_INCLUDE }>;

const personName = (u: { name: string | null; email: string } | null) => u?.name?.trim() || u?.email.split("@")[0] || "—";

function toView(p: ClaimRow, settings: { approvalAll: boolean; approvalOver: number | null }): ClaimView {
  const refund = p.staffRefund && !p.staffRefund.voidedAt ? p.staffRefund : null;
  const items = p.expense.items.map((i) => i.description);
  const s = p.expense.supplier;
  return {
    paymentId: p.id,
    expenseId: p.expense.id,
    branchId: p.branchId,
    branchName: p.branch.name,
    billDate: p.expense.billDate.toISOString().slice(0, 10),
    place: p.expense.vendorName ?? (s && !s.isWalkIn ? s.nameShort ?? s.nameFull : "—"),
    what: items.slice(0, 2).join(" · ") + (items.length > 2 ? ` · +${items.length - 2}` : ""),
    method: p.method,
    amount: Number(p.amount),
    noSlipReason: p.noSlipReason,
    endorseNote: p.endorseNote,
    status: claimStatus(
      {
        method: p.method,
        amount: Number(p.amount),
        billPhotos: p.expense.files.length,
        slips: p.files.length,
        endorsed: p.endorsedAt !== null,
        approved: p.approvedAt !== null,
        refunded: refund !== null,
      },
      settings
    ),
    billPhotoIds: p.expense.files.map((f) => f.id),
    slipIds: p.files.map((f) => f.id),
    payer: { id: p.paidByUser?.id ?? "", name: personName(p.paidByUser) },
    refund: refund ? { id: refund.id, at: refund.refundedAt.toISOString(), method: refund.method, slipIds: refund.files.map((f) => f.id) } : null,
    createdAt: p.createdAt.toISOString(),
  };
}

async function settingsInTx(tx: PrismaClient, tenantId: string) {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { refundApprovalAll: true, refundApprovalOver: true } });
  return { approvalAll: t.refundApprovalAll, approvalOver: t.refundApprovalOver === null ? null : Number(t.refundApprovalOver) };
}

/** The staff member's own screen: every claim they paid, newest first. */
export async function getMyClaimsLogic(tenantId: string, userId: string): Promise<ClaimView[]> {
  return withTenantContext(tenantId, async (tx: PrismaClient) => {
    const settings = await settingsInTx(tx, tenantId);
    const rows = await tx.expensePayment.findMany({
      where: { tenantId, paidByUserId: userId, payer: "STAFF", voidedAt: null, expense: { deletedAt: null } },
      include: CLAIM_INCLUDE,
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: 300,
    });
    return rows.map((r) => toView(r, settings));
  });
}

/** The accountant's board: staff claims within reach — open ones, or refunded within `refundedSince`. */
export async function getClaimsBoardLogic(
  tenantId: string,
  reach: BranchReach,
  opts: { refundedSince: Date }
): Promise<ClaimView[]> {
  return withTenantContext(tenantId, async (tx: PrismaClient) => {
    const settings = await settingsInTx(tx, tenantId);
    const rows = await tx.expensePayment.findMany({
      where: {
        tenantId,
        payer: "STAFF",
        voidedAt: null,
        expense: { deletedAt: null },
        ...(reach.allBranches ? {} : { branchId: { in: [...reach.allowedBranchIds] } }),
        OR: [
          { staffRefundId: null },
          { staffRefund: { voidedAt: { not: null } } },
          { staffRefund: { refundedAt: { gte: opts.refundedSince } } },
        ],
      },
      include: CLAIM_INCLUDE,
      orderBy: [{ paidAt: "asc" }],
      take: 2000,
    });
    return rows.map((r) => toView(r, settings));
  });
}

// ------------------------------------------------------------
// Acting on claims — never on your own
// ------------------------------------------------------------

type Actor = { userId: string; reach: BranchReach };

async function claimForActionInTx(tx: PrismaClient, tenantId: string, actor: Actor, paymentId: string) {
  const p = await tx.expensePayment.findFirst({
    where: { tenantId, id: paymentId, voidedAt: null, payer: "STAFF", expense: { deletedAt: null } },
    include: CLAIM_INCLUDE,
  });
  if (!p) throw new ClaimActionError("not-found", "ไม่พบรายการนี้");
  if (!canAccessBranch(actor.reach, p.branchId)) throw new ClaimActionError("branch", "บัญชีนี้ไม่ได้ดูแลสาขานี้");
  if (p.paidByUserId === actor.userId) throw new ClaimActionError("own", "รายการของตัวเอง ต้องให้คนอื่นตรวจ");
  return p;
}

/** The accountant accepts a cash bill with no slip, with a reason on record (Q6). */
export async function endorseClaimLogic(tenantId: string, actor: Actor, paymentId: string, note: string): Promise<void> {
  await withTenantContext(tenantId, async (tx: PrismaClient) => {
    const p = await claimForActionInTx(tx, tenantId, actor, paymentId);
    if (methodHasSlip(p.method) || p.files.length > 0) throw new ClaimActionError("state", "รายการนี้มีสลิป ไม่ต้องรับรอง");
    if (p.endorsedAt) return;
    if (p.staffRefundId && !p.staffRefund?.voidedAt) throw new ClaimActionError("state", "รายการนี้คืนเงินแล้ว");
    await tx.expensePayment.update({ where: { id: p.id }, data: { endorsedAt: new Date(), endorsedBy: actor.userId, endorseNote: note.trim() || null } });
  });
}

/** Approval, for a shop that asks for it (tenant.refund_approval_*). */
export async function approveClaimLogic(tenantId: string, actor: Actor, paymentId: string): Promise<void> {
  await withTenantContext(tenantId, async (tx: PrismaClient) => {
    const p = await claimForActionInTx(tx, tenantId, actor, paymentId);
    if (p.approvedAt) return;
    await tx.expensePayment.update({ where: { id: p.id }, data: { approvedAt: new Date(), approvedBy: actor.userId } });
  });
}

/**
 * Pay one person back for several of their claims, with one slip. Every claim
 * must be theirs and READY — a claim missing its proof cannot be paid, which
 * is the whole of Kong's rule.
 */
export async function refundClaimsLogic(
  tenantId: string,
  actor: Actor,
  input: { paymentIds: string[]; method: PaymentMethod; refundedAt: Date; note: string | null; slipFileIds: string[] }
): Promise<{ refundId: string; amount: number }> {
  if (input.paymentIds.length === 0) throw new ClaimActionError("empty", "เลือกอย่างน้อย 1 บิล");
  return withTenantContext(
    tenantId,
    async (tx: PrismaClient) => {
      const settings = await settingsInTx(tx, tenantId);
      const claims = [];
      for (const id of [...new Set(input.paymentIds)]) claims.push(await claimForActionInTx(tx, tenantId, actor, id));
      const to = claims[0].paidByUserId!;
      if (claims.some((c) => c.paidByUserId !== to)) throw new ClaimActionError("mixed", "คืนเงินได้ทีละคน");
      for (const c of claims) {
        if (toView(c, settings).status !== "READY") throw new ClaimActionError("state", "มีบิลที่ยังไม่พร้อมคืนเงิน");
      }
      const amount = claims.reduce((s, c) => s.plus(c.amount), ZERO);
      const refund = await tx.staffRefund.create({
        data: { tenantId, toUserId: to, amount, method: input.method, refundedAt: input.refundedAt, refundedBy: actor.userId, note: input.note },
      });
      await tx.expensePayment.updateMany({ where: { tenantId, id: { in: claims.map((c) => c.id) } }, data: { staffRefundId: refund.id } });
      await attachFilesInTx(tx, tenantId, actor.userId, input.slipFileIds, { staffRefundId: refund.id });
      return { refundId: refund.id, amount: Number(amount) };
    },
    TX
  );
}

/** A refund recorded by mistake: kept, voided, and its claims go back to รอคืนเงิน. */
export async function voidRefundLogic(tenantId: string, actor: Actor, refundId: string, reason: string): Promise<void> {
  await withTenantContext(tenantId, async (tx: PrismaClient) => {
    const r = await tx.staffRefund.findFirst({
      where: { tenantId, id: refundId },
      include: { payments: { select: { id: true, branchId: true } } },
    });
    if (!r) throw new ClaimActionError("not-found", "ไม่พบการคืนเงินนี้");
    if (r.voidedAt) return;
    if (!r.payments.every((p) => canAccessBranch(actor.reach, p.branchId))) throw new ClaimActionError("branch", "บัญชีนี้ไม่ได้ดูแลสาขานี้");
    await tx.staffRefund.update({ where: { id: r.id }, data: { voidedAt: new Date(), voidedBy: actor.userId, voidReason: reason.trim() || null } });
    await tx.expensePayment.updateMany({ where: { tenantId, staffRefundId: r.id }, data: { staffRefundId: null } });
  });
}

/** The payer adds a missing bill photo or slip to their own claim, any time before it is refunded. */
export async function addClaimPhotosLogic(
  tenantId: string,
  userId: string,
  input: { paymentId: string; kind: "BILL" | "PAYMENT_SLIP"; fileIds: string[] }
): Promise<void> {
  await withTenantContext(tenantId, async (tx: PrismaClient) => {
    const p = await tx.expensePayment.findFirst({
      where: { tenantId, id: input.paymentId, voidedAt: null, paidByUserId: userId },
      select: { id: true, expenseId: true, staffRefundId: true, staffRefund: { select: { voidedAt: true } } },
    });
    if (!p) throw new ClaimActionError("not-found", "ไม่พบรายการนี้");
    if (p.staffRefundId && !p.staffRefund?.voidedAt) throw new ClaimActionError("state", "รายการนี้คืนเงินแล้ว");
    await attachFilesInTx(tx, tenantId, userId, input.fileIds, input.kind === "BILL" ? { expenseId: p.expenseId } : { expensePaymentId: p.id });
  });
}
