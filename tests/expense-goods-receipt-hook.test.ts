// ============================================================
// Mise — GR → expense hook + the VAT uplift (Sprint 3 Part 16 L3b)
// ============================================================
// The join between Part 13's receipt and Part 16's bill, against real Neon.
// What is under test is what the executive view depends on:
//   Q3.1 — confirming a receipt writes its expense in the SAME transaction
//   Q3.2 — one bill per receipt, whatever happens twice
//   Q3.3 — voiding the receipt voids the bill
//   Q3.4 — the fields the receipt owns are not editable on the bill
//   Q2   — a shop that cannot reclaim VAT carries it in the cost of its stock,
//          decided by the RECEIPT's snapshot and not by the setting read today
//   Q4   — /cost reads spend from expenses, split COGS / OpEx
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { EVERY_BRANCH } from "./support/reach";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withRlsBypass } from "@/lib/db-admin";
import { productInputSchema } from "@/lib/validations/product";
import { createProductLogic, type ProductWithUnits } from "@/server/product";
import { supplierInputSchema } from "@/lib/validations/supplier";
import { createSupplierLogic } from "@/server/supplier";
import {
  goodsReceiptInputSchema,
  voidGoodsReceiptInputSchema,
} from "@/lib/validations/goods-receipt";
import {
  confirmGoodsReceiptLogic,
  createGoodsReceiptLogic,
  voidGoodsReceiptLogic,
} from "@/server/goods-receipt";
import {
  ExpenseSourceLockedError,
  UNCATEGORISED_CATEGORY,
  deleteExpenseLogic,
  getExpenseByGoodsReceiptLogic,
  getExpenseByIdLogic,
  updateExpenseLogic,
} from "@/server/expense";
import {
  deleteExpenseInputSchema,
  updateExpenseInputSchema,
} from "@/lib/validations/expense";
import { getProductCostLogic, getBranchCostSummaryLogic } from "@/server/stock-cost";
import {
  getBranchCostSummaryQuerySchema,
  getProductCostQuerySchema,
} from "@/lib/validations/stock-cost";

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

describe("goods receipt → expense (ADR 0016 Q2/Q3)", () => {
  /** Not VAT-registered — the common Thai SME, and the case that was mis-valued. */
  let tenantUnreg: string;
  /** VAT-registered — input VAT is a receivable, so stock stays net. */
  let tenantReg: string;
  let branchUnreg: string;
  let branchReg: string;
  let userA: string;
  let supUnreg: string;
  let supReg: string;
  let meatCategory: string;

  const freshProduct = (
    tenantId: string,
    tag: string,
    categoryId: string | null = null
  ): Promise<ProductWithUnits> =>
    createProductLogic(
      tenantId,
      productInputSchema.parse({
        name: `HK-${tag}-${randomUUID().slice(0, 6)}`,
        primaryDimension: "WEIGHT",
        baseUnitName: "kg",
        categoryId: categoryId ?? "",
      })
    );

  const receiveAndConfirm = async (
    tenantId: string,
    branchId: string,
    supplierId: string,
    product: ProductWithUnits,
    opts: { qty?: number; price?: number; vatRatePercent?: number | "" } = {}
  ) => {
    const gr = await createGoodsReceiptLogic(
      tenantId,
      goodsReceiptInputSchema.parse({
        submitKey: randomUUID(),
        branchId,
        supplierId,
        purchaseOrderId: null,
        invoiceNo: `INV-${randomUUID().slice(0, 6)}`,
        vatRatePercent: opts.vatRatePercent ?? 7,
        receivedAt: new Date(),
        notes: null,
        lines: [
          {
            purchaseOrderItemId: null,
            productId: product.id,
            receivedUnitId: product.productUnits[0].id,
            qtyReceivedActual: opts.qty ?? 10,
            unitPriceActual: opts.price ?? 100,
            notes: null,
          },
        ],
      }),
      userA
    );
    const { receipt } = await confirmGoodsReceiptLogic(tenantId, gr.id, userA);
    return receipt;
  };

  beforeAll(async () => {
    await withRlsBypass(async (tx) => {
      const [a, b] = await Promise.all([
        tx.tenant.create({ data: { name: "Hook Unregistered" } }),
        tx.tenant.create({
          data: { name: "Hook Registered", isVatRegistered: true },
        }),
      ]);
      tenantUnreg = a.id;
      tenantReg = b.id;

      const [b1, b2] = await Promise.all([
        tx.branch.create({ data: { tenantId: a.id, name: "ร้านเล็ก", code: "HKA" } }),
        tx.branch.create({ data: { tenantId: b.id, name: "ร้านใหญ่", code: "HKB" } }),
      ]);
      branchUnreg = b1.id;
      branchReg = b2.id;

      await Promise.all([
        tx.department.create({ data: { tenantId: a.id, name: "Main", code: "MAIN" } }),
        tx.department.create({ data: { tenantId: b.id, name: "Main", code: "MAIN" } }),
      ]);

      const u = await tx.user.create({
        data: { email: `hook-${randomUUID()}@example.com`, name: "คนรับของ" },
      });
      userA = u.id;

      const cat = await tx.category.create({
        data: {
          tenantId: a.id,
          account: "COGS",
          accountingSection: "Food",
          groupName: `Meat-${randomUUID().slice(0, 6)}`,
        },
      });
      meatCategory = cat.id;
    });

    supUnreg = (
      await createSupplierLogic(
        tenantUnreg,
        supplierInputSchema.parse({ nameFull: "เจ้าประจำ" })
      )
    ).id;
    supReg = (
      await createSupplierLogic(
        tenantReg,
        supplierInputSchema.parse({ nameFull: "เจ้าประจำ" })
      )
    ).id;
  });

  afterAll(async () => {
    const ids = [tenantUnreg, tenantReg];
    await withRlsBypass(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.goodsReceiptItemAllocation.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.expenseItem.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.expense.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.productUnit.deleteMany({ where: { product: { tenantId: { in: ids } } } });
      await tx.product.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.category.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.supplier.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.department.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.branch.deleteMany({ where: { tenantId: { in: ids } } });
      await tx.tenant.deleteMany({ where: { id: { in: ids } } });
      await tx.user.deleteMany({ where: { id: userA } });
    });
    await prisma.$disconnect();
  });

  // ----------------------------------------------------------
  // H1–H4 — the hook
  // ----------------------------------------------------------

  it("H1: confirming a receipt writes its bill, with the product's own category", async () => {
    const p = await freshProduct(tenantUnreg, "H1", meatCategory);
    const receipt = await receiveAndConfirm(
      tenantUnreg,
      branchUnreg,
      supUnreg,
      p,
      { qty: 10, price: 100, vatRatePercent: 7 }
    );

    const expense = await getExpenseByGoodsReceiptLogic(tenantUnreg, receipt.id);
    expect(expense).not.toBeNull();
    expect(expense!.source).toBe("FROM_GOODS_RECEIPT");
    expect(expense!.branchId).toBe(branchUnreg);
    expect(expense!.supplierId).toBe(supUnreg);
    expect(expense!.billNo).toBe(receipt.invoiceNo);

    // The receipt's prices are NET, so the bill is built in the exclusive
    // direction: 1,000 + 7% = 1,070.
    expect(num(expense!.subtotalExclVat)).toBe(1_000);
    expect(num(expense!.vatAmount)).toBe(70);
    expect(num(expense!.totalAmount)).toBe(1_070);
    expect(expense!.isPriceVatInclusive).toBe(false);
    // Withholding is a decision made at payment, not at delivery.
    expect(expense!.subjectToWht).toBe(false);
    expect(expense!.paymentStatus).toBe("UNPAID");

    const detail = await getExpenseByIdLogic(tenantUnreg, expense!.id);
    expect(detail!.items).toHaveLength(1);
    expect(detail!.items[0].categoryId).toBe(meatCategory);
    expect(detail!.items[0].productId).toBe(p.id);
    expect(num(detail!.items[0].totalPrice)).toBe(1_000);

    // The receipt itself carries the VAT it was confirmed with (Q2).
    expect(num(receipt.vatAmount)).toBe(70);
    expect(receipt.vatReclaimable).toBe(false);
  });

  it("H2: a product nobody categorised lands in COGS / ไม่ระบุหมวด, not in a guess", async () => {
    const p = await freshProduct(tenantUnreg, "H2");
    expect(p.categoryId).toBeNull();

    const receipt = await receiveAndConfirm(tenantUnreg, branchUnreg, supUnreg, p);
    const expense = await getExpenseByGoodsReceiptLogic(tenantUnreg, receipt.id);
    const detail = await getExpenseByIdLogic(tenantUnreg, expense!.id);

    expect(detail!.items[0].category.account).toBe(UNCATEGORISED_CATEGORY.account);
    expect(detail!.items[0].category.groupName).toBe(UNCATEGORISED_CATEGORY.groupName);

    // Created once per tenant, not once per receipt.
    const second = await freshProduct(tenantUnreg, "H2b");
    const receipt2 = await receiveAndConfirm(tenantUnreg, branchUnreg, supUnreg, second);
    const expense2 = await getExpenseByGoodsReceiptLogic(tenantUnreg, receipt2.id);
    const detail2 = await getExpenseByIdLogic(tenantUnreg, expense2!.id);
    expect(detail2!.items[0].categoryId).toBe(detail!.items[0].categoryId);

    const fallbacks = await prisma.category.count({
      where: {
        tenantId: tenantUnreg,
        groupName: UNCATEGORISED_CATEGORY.groupName,
      },
    });
    expect(fallbacks).toBe(1);
  });

  it("H3: voiding the receipt takes the bill with it, in the same transaction", async () => {
    const p = await freshProduct(tenantUnreg, "H3", meatCategory);
    const receipt = await receiveAndConfirm(tenantUnreg, branchUnreg, supUnreg, p);
    const expense = await getExpenseByGoodsReceiptLogic(tenantUnreg, receipt.id);
    expect(expense).not.toBeNull();

    await voidGoodsReceiptLogic(
      tenantUnreg,
      voidGoodsReceiptInputSchema.parse({ id: receipt.id, voidReason: "รับผิดใบ" }),
      userA
    );

    expect(await getExpenseByGoodsReceiptLogic(tenantUnreg, receipt.id)).toBeNull();
    const row = await prisma.expense.findUnique({ where: { id: expense!.id } });
    // Soft-deleted, not reversed: the receipt already records who voided it and
    // why, and duplicating that would let the two disagree.
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it("H4: the receipt owns the amounts — the bill's own fields stay editable", async () => {
    const p = await freshProduct(tenantUnreg, "H4", meatCategory);
    const receipt = await receiveAndConfirm(tenantUnreg, branchUnreg, supUnreg, p);
    const expense = (await getExpenseByGoodsReceiptLogic(tenantUnreg, receipt.id))!;

    const asInput = {
      id: expense.id,
      branchId: expense.branchId,
      supplierId: expense.supplierId ?? "",
      billDate: expense.billDate.toISOString().slice(0, 10),
      billNo: expense.billNo ?? "",
      vatRatePercent: expense.vatRatePercent?.toString() ?? "",
      isPriceVatInclusive: false,
      vatInvoiceNo: "",
      subjectToWht: false,
      whtRatePercent: "",
      whtCertificateNo: "",
      paymentMethod: "",
      paymentStatus: "UNPAID",
      paidAt: "",
      recurringExpenseId: "",
      period: "",
      notes: "",
      items: [
        {
          categoryId: meatCategory,
          description: "ไม่ควรถูกเขียน",
          lineTotal: 999_999,
        },
      ],
    };

    // Editable: the tax-invoice number, withholding, payment — everything the
    // receipt never knew.
    const updated = await updateExpenseLogic(
      tenantUnreg,
      updateExpenseInputSchema.parse({
        ...asInput,
        vatInvoiceNo: "TAX-0001",
        subjectToWht: true,
        whtRatePercent: 3,
        paymentStatus: "PAID",
      })
    );
    expect(updated.vatInvoiceNo).toBe("TAX-0001");
    expect(num(updated.whtAmount)).toBe(30); // 3% of the receipt's 1,000, pre-VAT
    expect(num(updated.netPaymentAmount)).toBe(1_040); // 1,070 − 30
    expect(updated.paidAt).toBeInstanceOf(Date);
    // The line the form tried to rewrite was never written.
    expect(updated.items).toHaveLength(1);
    expect(num(updated.items[0].totalPrice)).toBe(1_000);

    // Refused: a field the receipt owns.
    await expect(
      updateExpenseLogic(
        tenantUnreg,
        updateExpenseInputSchema.parse({ ...asInput, billNo: "เปลี่ยนเลขบิล" })
      )
    ).rejects.toBeInstanceOf(ExpenseSourceLockedError);

    // And it cannot be deleted on its own: the stock is still on the shelf.
    await expect(
      deleteExpenseLogic(tenantUnreg, deleteExpenseInputSchema.parse({ id: expense.id }))
    ).rejects.toBeInstanceOf(ExpenseSourceLockedError);
  });

  // ----------------------------------------------------------
  // H5–H7 — what the stock is worth, and what /cost reports
  // ----------------------------------------------------------

  it("H5: a shop that cannot reclaim VAT carries it in the cost of its stock", async () => {
    const p = await freshProduct(tenantUnreg, "H5", meatCategory);
    await receiveAndConfirm(tenantUnreg, branchUnreg, supUnreg, p, {
      qty: 10,
      price: 100,
      vatRatePercent: 7,
    });

    const cost = await getProductCostLogic(
      tenantUnreg,
      getProductCostQuerySchema.parse({ productId: p.id, branchId: branchUnreg })
    );
    // 1,000 net + 70 VAT the shop will never get back = 1,070 for 10 kg.
    expect(num(cost.inventoryValue)).toBe(1_070);
    expect(num(cost.costPerBaseUnit)).toBe(107);
  });

  it("H6: a VAT-registered shop's stock stays NET — the VAT is a receivable", async () => {
    const p = await freshProduct(tenantReg, "H6");
    await receiveAndConfirm(tenantReg, branchReg, supReg, p, {
      qty: 10,
      price: 100,
      vatRatePercent: 7,
    });

    const cost = await getProductCostLogic(
      tenantReg,
      getProductCostQuerySchema.parse({ productId: p.id, branchId: branchReg })
    );
    expect(num(cost.inventoryValue)).toBe(1_000);
    expect(num(cost.costPerBaseUnit)).toBe(100);
  });

  it("H7: a receipt with no VAT at all values exactly as it always did — no backfill", async () => {
    const p = await freshProduct(tenantUnreg, "H7", meatCategory);
    await receiveAndConfirm(tenantUnreg, branchUnreg, supUnreg, p, {
      qty: 10,
      price: 100,
      vatRatePercent: "",
    });

    const cost = await getProductCostLogic(
      tenantUnreg,
      getProductCostQuerySchema.parse({ productId: p.id, branchId: branchUnreg })
    );
    // Receipts written before Part 16 carry no rate and land here — which is why
    // the change needs no migration of history.
    expect(num(cost.inventoryValue)).toBe(1_000);
  });

  it("H8: /cost reads spend from the expense the receipt wrote, under COGS", async () => {
    const p = await freshProduct(tenantUnreg, "H8", meatCategory);

    const before = await getBranchCostSummaryLogic(
      tenantUnreg,
      getBranchCostSummaryQuerySchema.parse({
        from: "2026-01-01",
        to: "2027-12-31",
      })
    , EVERY_BRANCH);
    const priorCogs = Number(
      before.find((r) => r.branchId === branchUnreg)?.cogsSpend ?? 0
    );

    await receiveAndConfirm(tenantUnreg, branchUnreg, supUnreg, p, {
      qty: 5,
      price: 200,
      vatRatePercent: 7,
    });

    const after = await getBranchCostSummaryLogic(
      tenantUnreg,
      getBranchCostSummaryQuerySchema.parse({
        from: "2026-01-01",
        to: "2027-12-31",
      })
    , EVERY_BRANCH);
    const row = after.find((r) => r.branchId === branchUnreg)!;

    // Net of VAT, and on the COGS side because that is where a stocked product's
    // category sits. Counted ONCE — the receipt is not read separately.
    expect(Number(row.cogsSpend) - priorCogs).toBe(1_000);
    expect(Number(row.opexSpend)).toBe(0);
  });
});
