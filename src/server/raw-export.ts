// ============================================================
// คิดครัว — raw Excel export: the rows of each file (2026-10-31)
// ============================================================
// Kong 2026-10-31: "ดึงข้อมูลดิบเป็น Excel" — quality of life for the Standard
// package (every shop has it until Standard is sold). RAW means as recorded:
// nothing here is recomputed (no FIFO, no balances), so the shop or its
// accountant can do their own arithmetic and get the same answer we would.
//
// Three rules every dataset keeps:
//   R1 the branch is the reader's reach, narrowed again here — a branch id from
//      the URL that is outside it matches nothing;
//   R2 a page's money stays where the page puts it: purchase prices on a
//      product sheet need the cost ticket, exactly like the screen;
//   R3 a blind count stays blind — its expected quantity reaches only a cost
//      reader, as the leak report already shows it to them.
// Voided documents are left out unless the page's own status filter asks for
// them; the dialog says so before anyone downloads.
// ============================================================

import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { BranchReach } from "@/lib/permissions/service";
import type { RawExportQuery } from "@/lib/validations/raw-export";
import { GOODS_RECEIPT_STATUS_LABELS_TH } from "@/lib/validations/goods-receipt";
import { STOCK_COUNT_STATUS_LABELS_TH } from "@/lib/validations/stock-count";
import { EXPENSE_PAYMENT_STATUS_LABELS_TH, EXPENSE_SOURCE_LABELS_TH } from "@/lib/validations/expense";
import { MOVEMENT_ORIGINS, MOVEMENT_TYPE_LABELS_TH, SOURCE_TYPE_LABELS_TH } from "@/lib/validations/stock-movement";
import { PRODUCT_TYPE_LABELS_TH } from "@/lib/validations/product";
import { SALES_CHANNEL_LABELS_TH } from "@/lib/validations/sales-import";
import { categoryLabelTh } from "@/lib/expense-labels";
import { movementDocumentsInTx } from "@/server/movement-documents";

export type Cell = string | number | Date | null;
export type ExportColumn = { header: string; kind?: "text" | "date" | "money" | "qty"; width?: number };
export type ExportSheet = { name: string; columns: ExportColumn[]; rows: Cell[][] };
export type ExportCount = { docs: number | null; rows: number; voidedLeftOut: boolean };

type Ctx = { tenantId: string; reach: BranchReach; withMoney: boolean; q: RawExportQuery };

const BKK_MS = 7 * 3_600_000;
const num = (d: { toString(): string } | null | undefined): number | null => (d === null || d === undefined ? null : Number(d.toString()));
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** A plain-date column (business_date, bill_date, count_date) — the cell shows that day. */
const dateCell = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** A timestamp shown as the Bangkok day it happened on. */
const bkkDay = (d: Date) => dateCell(new Date(d.getTime() + BKK_MS));
const bkkTime = (d: Date) => new Date(d.getTime() + BKK_MS).toISOString().slice(11, 16);
const yesNo = (b: boolean) => (b ? "ใช่" : "ไม่ใช่");

/** Rule R1 — the branch asked for, inside the reach, or every branch the reader may see. */
function scope(reach: BranchReach, branchId?: string): { branchId?: string | { in: string[] } } {
  if (reach.allBranches) return branchId ? { branchId } : {};
  const allowed = [...reach.allowedBranchIds];
  if (branchId) return { branchId: allowed.includes(branchId) ? branchId : { in: [] } };
  return { branchId: { in: allowed } };
}

/** A period of plain dates, inclusive. */
const dateRange = (q: RawExportQuery) => ({ gte: day(q.from!), lte: day(q.to!) });
/** The same period for a timestamp column: Bangkok midnight to Bangkok midnight. */
const instantRange = (q: RawExportQuery) => ({
  gte: new Date(day(q.from!).getTime() - BKK_MS),
  lt: new Date(day(q.to!).getTime() + 86_400_000 - BKK_MS),
});

// ------------------------------------------------------------
// ยอดขาย
// ------------------------------------------------------------
function salesWhere({ tenantId, reach, q }: Ctx): Prisma.SalesLineWhereInput {
  return {
    tenantId,
    supersededAt: null,
    ...scope(reach, q.branch),
    businessDate: dateRange(q),
    ...(q.category ? { menu: { menuCategoryId: q.category } } : {}),
  };
}

async function salesSheets(tx: PrismaClient, ctx: Ctx): Promise<ExportSheet[]> {
  const lines = await tx.salesLine.findMany({
    where: salesWhere(ctx),
    orderBy: [{ businessDate: "asc" }, { branchId: "asc" }, { soldAt: "asc" }, { id: "asc" }],
    select: {
      businessDate: true,
      branch: { select: { name: true } },
      posMenuCode: true,
      posMenuName: true,
      menu: { select: { name: true, menuCategory: { select: { name: true } } } },
      qty: true,
      grossAmount: true,
      discountAmount: true,
      netAmount: true,
      serviceChargeAmount: true,
      vatAmount: true,
      posBillId: true,
      soldAt: true,
      channel: true,
      discountReason: true,
    },
  });
  return [
    {
      name: "ยอดขาย",
      columns: [
        { header: "วันที่ขาย", kind: "date" },
        { header: "สาขา" },
        { header: "รหัสเมนู POS" },
        { header: "เมนู", width: 26 },
        { header: "ชื่อในไฟล์ POS", width: 26 },
        { header: "หมวดเมนู" },
        { header: "จำนวน", kind: "qty" },
        { header: "ยอดก่อนส่วนลด", kind: "money" },
        { header: "ส่วนลด", kind: "money" },
        { header: "ยอดขาย (หลังส่วนลด ไม่รวม VAT และค่าบริการ)", kind: "money", width: 22 },
        { header: "ค่าบริการ", kind: "money" },
        { header: "VAT", kind: "money" },
        { header: "เลขบิล" },
        { header: "เวลาขาย" },
        { header: "ช่องทาง" },
        { header: "เหตุผลส่วนลด" },
      ],
      rows: lines.map((l) => [
        dateCell(l.businessDate),
        l.branch.name,
        l.posMenuCode,
        l.menu.name,
        l.posMenuName,
        l.menu.menuCategory?.name ?? null,
        num(l.qty),
        num(l.grossAmount),
        num(l.discountAmount),
        num(l.netAmount),
        num(l.serviceChargeAmount),
        num(l.vatAmount),
        l.posBillId,
        l.soldAt ? bkkTime(l.soldAt) : null,
        l.channel ? (SALES_CHANNEL_LABELS_TH[l.channel] ?? l.channel) : null,
        l.discountReason,
      ]),
    },
  ];
}

// ------------------------------------------------------------
// รับสินค้า
// ------------------------------------------------------------
function receiptsWhere({ tenantId, reach, q }: Ctx): Prisma.GoodsReceiptWhereInput {
  return {
    tenantId,
    deletedAt: null,
    ...scope(reach, q.branch),
    receivedAt: instantRange(q),
    status: q.status && q.status in GOODS_RECEIPT_STATUS_LABELS_TH ? (q.status as "DRAFT" | "CONFIRMED" | "VOIDED") : { not: "VOIDED" },
    ...(q.flagged ? { hasDiscrepancy: true } : {}),
  };
}

async function receiptSheets(tx: PrismaClient, ctx: Ctx): Promise<ExportSheet[]> {
  const receipts = await tx.goodsReceipt.findMany({
    where: receiptsWhere(ctx),
    orderBy: [{ receivedAt: "asc" }, { grNumber: "asc" }],
    select: {
      grNumber: true,
      receivedAt: true,
      status: true,
      invoiceNo: true,
      pricesIncludeVat: true,
      vatRatePercent: true,
      vatReclaimable: true,
      vatAmount: true,
      hasDiscrepancy: true,
      notes: true,
      branch: { select: { name: true } },
      supplier: { select: { nameFull: true } },
      purchaseOrder: { select: { poNumber: true } },
      items: {
        where: { reversalOfItemId: null },
        orderBy: { lineNo: "asc" },
        select: {
          lineNo: true,
          qtyReceivedActual: true,
          receivedUnitName: true,
          unitPriceActual: true,
          lineTotalActual: true,
          unitPriceQuoted: true,
          notes: true,
          product: { select: { sku: true, name: true } },
        },
      },
    },
  });
  const head = (r: (typeof receipts)[number]): Cell[] => [r.grNumber, bkkDay(r.receivedAt), r.branch.name, r.supplier.nameFull];
  return [
    {
      name: "ใบรับสินค้า",
      columns: [
        { header: "เลขที่" },
        { header: "วันที่รับ", kind: "date" },
        { header: "สาขา" },
        { header: "ผู้ขาย", width: 24 },
        { header: "เลขใบกำกับ/ใบส่งของ" },
        { header: "ใบสั่งซื้อ" },
        { header: "สถานะ" },
        { header: "ราคารวม VAT แล้ว" },
        { header: "อัตรา VAT %", kind: "qty" },
        { header: "ขอคืน VAT ได้" },
        { header: "VAT", kind: "money" },
        { header: "ยอดรวมรายการ", kind: "money" },
        { header: "มีของไม่ตรง" },
        { header: "หมายเหตุ", width: 24 },
      ],
      rows: receipts.map((r) => [
        ...head(r),
        r.invoiceNo,
        r.purchaseOrder?.poNumber ?? null,
        GOODS_RECEIPT_STATUS_LABELS_TH[r.status],
        yesNo(r.pricesIncludeVat),
        num(r.vatRatePercent),
        yesNo(r.vatReclaimable),
        num(r.vatAmount),
        Math.round(r.items.reduce((s, i) => s + (num(i.lineTotalActual) ?? 0), 0) * 100) / 100,
        yesNo(r.hasDiscrepancy),
        r.notes,
      ]),
    },
    {
      name: "รายการ",
      columns: [
        { header: "เลขที่" },
        { header: "วันที่รับ", kind: "date" },
        { header: "สาขา" },
        { header: "ผู้ขาย", width: 24 },
        { header: "ลำดับ" },
        { header: "รหัสสินค้า" },
        { header: "สินค้า", width: 26 },
        { header: "จำนวน", kind: "qty" },
        { header: "หน่วย" },
        { header: "ราคาต่อหน่วย", kind: "money" },
        { header: "รวม", kind: "money" },
        { header: "ราคาตามใบสั่งซื้อ", kind: "money" },
        { header: "หมายเหตุ", width: 24 },
      ],
      rows: receipts.flatMap((r) =>
        r.items.map((i) => [
          ...head(r),
          i.lineNo,
          i.product.sku,
          i.product.name,
          num(i.qtyReceivedActual),
          i.receivedUnitName,
          num(i.unitPriceActual),
          num(i.lineTotalActual),
          num(i.unitPriceQuoted),
          i.notes,
        ])
      ),
    },
  ];
}

// ------------------------------------------------------------
// ค่าใช้จ่าย
// ------------------------------------------------------------
function expensesWhere({ tenantId, reach, q }: Ctx): Prisma.ExpenseWhereInput {
  return {
    tenantId,
    deletedAt: null,
    ...scope(reach, q.branch),
    billDate: dateRange(q),
    ...(q.supplier ? { supplierId: q.supplier } : {}),
    ...(q.source ? { source: q.source } : {}),
    ...(q.status && q.status in EXPENSE_PAYMENT_STATUS_LABELS_TH ? { paymentStatus: q.status as "UNPAID" | "PAID" } : {}),
  };
}

async function expenseSheets(tx: PrismaClient, ctx: Ctx): Promise<ExportSheet[]> {
  const bills = await tx.expense.findMany({
    where: expensesWhere(ctx),
    orderBy: [{ billDate: "asc" }, { createdAt: "asc" }],
    select: {
      billNo: true,
      billDate: true,
      vatInvoiceNo: true,
      source: true,
      recurringExpenseId: true,
      period: true,
      subtotalExclVat: true,
      vatRatePercent: true,
      vatAmount: true,
      isPriceVatInclusive: true,
      totalAmount: true,
      whtRatePercent: true,
      whtAmount: true,
      whtCertificateNo: true,
      netPaymentAmount: true,
      paymentStatus: true,
      paymentMethod: true,
      paidAt: true,
      vendorName: true,
      notes: true,
      branch: { select: { name: true } },
      supplier: { select: { nameFull: true } },
      sourceGr: { select: { grNumber: true } },
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          lineNo: true,
          description: true,
          qty: true,
          unitPrice: true,
          totalPrice: true,
          category: { select: { account: true, accountingSection: true, groupName: true } },
          department: { select: { name: true } },
          product: { select: { name: true } },
          productUnit: { select: { unitName: true } },
        },
      },
    },
  });
  const payee = (b: (typeof bills)[number]) => b.supplier?.nameFull ?? b.vendorName ?? null;
  const sourceTh = (b: (typeof bills)[number]) => (b.recurringExpenseId ? "ค่าใช้จ่ายประจำ" : (EXPENSE_SOURCE_LABELS_TH[b.source] ?? b.source));
  return [
    {
      name: "บิล",
      columns: [
        { header: "เลขที่บิล" },
        { header: "ใบรับสินค้า" },
        { header: "วันที่บิล", kind: "date" },
        { header: "สาขา" },
        { header: "ผู้ขาย/ผู้รับเงิน", width: 24 },
        { header: "ที่มา" },
        { header: "งวด" },
        { header: "ยอดก่อน VAT", kind: "money" },
        { header: "อัตรา VAT %", kind: "qty" },
        { header: "VAT", kind: "money" },
        { header: "ราคารวม VAT แล้ว" },
        { header: "ยอดรวม", kind: "money" },
        { header: "หัก ณ ที่จ่าย %", kind: "qty" },
        { header: "ภาษีหัก ณ ที่จ่าย", kind: "money" },
        { header: "เลขหนังสือรับรองการหักภาษี" },
        { header: "ยอดจ่ายสุทธิ", kind: "money" },
        { header: "สถานะ" },
        { header: "วิธีจ่าย" },
        { header: "วันที่จ่าย", kind: "date" },
        { header: "เลขใบกำกับภาษี" },
        { header: "หมายเหตุ", width: 24 },
      ],
      rows: bills.map((b) => [
        b.billNo,
        b.sourceGr?.grNumber ?? null,
        dateCell(b.billDate),
        b.branch.name,
        payee(b),
        sourceTh(b),
        b.period,
        num(b.subtotalExclVat),
        num(b.vatRatePercent),
        num(b.vatAmount),
        yesNo(b.isPriceVatInclusive),
        num(b.totalAmount),
        num(b.whtRatePercent),
        num(b.whtAmount),
        b.whtCertificateNo,
        num(b.netPaymentAmount),
        EXPENSE_PAYMENT_STATUS_LABELS_TH[b.paymentStatus],
        b.paymentMethod,
        b.paidAt ? bkkDay(b.paidAt) : null,
        b.vatInvoiceNo,
        b.notes,
      ]),
    },
    {
      name: "รายการ",
      columns: [
        { header: "เลขที่บิล" },
        { header: "ใบรับสินค้า" },
        { header: "วันที่บิล", kind: "date" },
        { header: "สาขา" },
        { header: "ผู้ขาย/ผู้รับเงิน", width: 24 },
        { header: "ลำดับ" },
        { header: "หมวดบัญชี", width: 30 },
        { header: "แผนก" },
        { header: "รายการ", width: 26 },
        { header: "สินค้า" },
        { header: "จำนวน", kind: "qty" },
        { header: "หน่วย" },
        { header: "ราคาต่อหน่วย", kind: "money" },
        { header: "ยอดรายการ", kind: "money" },
      ],
      rows: bills.flatMap((b) =>
        b.items.map((i) => [
          b.billNo,
          b.sourceGr?.grNumber ?? null,
          dateCell(b.billDate),
          b.branch.name,
          payee(b),
          i.lineNo,
          categoryLabelTh(i.category),
          i.department?.name ?? null,
          i.description,
          i.product?.name ?? null,
          num(i.qty),
          i.productUnit?.unitName ?? null,
          num(i.unitPrice),
          num(i.totalPrice),
        ])
      ),
    },
  ];
}

// ------------------------------------------------------------
// นับสต๊อก
// ------------------------------------------------------------
function countsWhere({ tenantId, reach, q }: Ctx): Prisma.StockCountWhereInput {
  return {
    tenantId,
    deletedAt: null,
    ...scope(reach, q.branch),
    countDate: dateRange(q),
    status: q.status && q.status in STOCK_COUNT_STATUS_LABELS_TH ? (q.status as "DRAFT" | "CLOSED" | "VOIDED") : { not: "VOIDED" },
  };
}

async function countSheets(tx: PrismaClient, ctx: Ctx): Promise<ExportSheet[]> {
  const counts = await tx.stockCount.findMany({
    where: countsWhere(ctx),
    orderBy: [{ countDate: "asc" }, { scNumber: "asc" }],
    select: {
      scNumber: true,
      countDate: true,
      status: true,
      showExpected: true,
      closedAt: true,
      notes: true,
      branch: { select: { name: true } },
      items: {
        where: { reversalOfItemId: null },
        orderBy: { lineNo: "asc" },
        select: {
          qtyCounted: true,
          qtyExpected: true,
          countedAt: true,
          countedByName: true,
          notes: true,
          countedByUser: { select: { name: true, email: true } },
          product: { select: { sku: true, name: true, productUnits: { where: { isBase: true }, select: { unitName: true }, take: 1 } } },
        },
      },
    },
  });
  // Rule R3: a blind count's expected quantity reaches a cost reader only.
  const sees = (c: (typeof counts)[number]) => c.showExpected || ctx.withMoney;
  return [
    {
      name: "ใบนับ",
      columns: [
        { header: "เลขที่" },
        { header: "วันที่นับ", kind: "date" },
        { header: "สาขา" },
        { header: "สถานะ" },
        { header: "นับแบบไม่เห็นจำนวนในระบบ" },
        { header: "ปิดเมื่อ", kind: "date" },
        { header: "จำนวนรายการ" },
        { header: "หมายเหตุ", width: 24 },
      ],
      rows: counts.map((c) => [
        c.scNumber,
        dateCell(c.countDate),
        c.branch.name,
        STOCK_COUNT_STATUS_LABELS_TH[c.status],
        yesNo(!c.showExpected),
        c.closedAt ? bkkDay(c.closedAt) : null,
        c.items.length,
        c.notes,
      ]),
    },
    {
      name: "รายการ",
      columns: [
        { header: "เลขที่" },
        { header: "วันที่นับ", kind: "date" },
        { header: "สาขา" },
        { header: "รหัสสินค้า" },
        { header: "สินค้า", width: 26 },
        { header: "หน่วย" },
        { header: "จำนวนในระบบ", kind: "qty" },
        { header: "นับได้", kind: "qty" },
        { header: "ส่วนต่าง (นับได้ − ในระบบ)", kind: "qty" },
        { header: "ผู้นับ" },
        { header: "เวลานับ" },
        { header: "หมายเหตุ", width: 24 },
      ],
      rows: counts.flatMap((c) =>
        c.items.map((i) => {
          const counted = num(i.qtyCounted);
          const expected = sees(c) ? num(i.qtyExpected) : null;
          return [
            c.scNumber,
            dateCell(c.countDate),
            c.branch.name,
            i.product.sku,
            i.product.name,
            i.product.productUnits[0]?.unitName ?? null,
            expected,
            counted,
            expected === null || counted === null ? null : Math.round((counted - expected) * 1000) / 1000,
            i.countedByName ?? i.countedByUser.name ?? i.countedByUser.email.split("@")[0],
            bkkTime(i.countedAt),
            i.notes,
          ];
        })
      ),
    },
  ];
}

// ------------------------------------------------------------
// ความเคลื่อนไหวสต๊อก (บัตรสต๊อกทุกสินค้า)
// ------------------------------------------------------------
function movesWhere({ tenantId, reach, q }: Ctx): Prisma.StockMovementWhereInput {
  return {
    tenantId,
    ...scope(reach, q.branch),
    occurredAt: instantRange(q),
    ...(q.product ? { productId: q.product } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(q.origin ? { sourceType: { in: [...MOVEMENT_ORIGINS[q.origin].sources] } } : q.stype ? { sourceType: q.stype } : {}),
  };
}

async function movementSheets(tx: PrismaClient, ctx: Ctx): Promise<ExportSheet[]> {
  const moves = await tx.stockMovement.findMany({
    where: movesWhere(ctx),
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      occurredAt: true,
      type: true,
      sourceType: true,
      sourceId: true,
      branchId: true,
      productId: true,
      qty: true,
      notes: true,
      branch: { select: { name: true } },
      product: { select: { sku: true, name: true, productUnits: { where: { isBase: true }, select: { unitName: true }, take: 1 } } },
      createdByUser: { select: { name: true, email: true } },
    },
  });
  const docs = await movementDocumentsInTx(tx, moves);
  return [
    {
      name: "ความเคลื่อนไหวสต๊อก",
      columns: [
        { header: "วันที่", kind: "date" },
        { header: "เวลา" },
        { header: "สาขา" },
        { header: "รหัสสินค้า" },
        { header: "สินค้า", width: 26 },
        { header: "ประเภท", width: 20 },
        { header: "ที่มา" },
        { header: "เอกสาร" },
        { header: "จำนวน (+ เข้า / − ออก)", kind: "qty" },
        { header: "หน่วย" },
        { header: "ผู้บันทึก" },
        { header: "หมายเหตุ", width: 24 },
      ],
      rows: moves.map((m) => [
        bkkDay(m.occurredAt),
        bkkTime(m.occurredAt),
        m.branch.name,
        m.product.sku,
        m.product.name,
        MOVEMENT_TYPE_LABELS_TH[m.type] ?? m.type,
        SOURCE_TYPE_LABELS_TH[m.sourceType] ?? m.sourceType,
        docs.get(m.id)?.label ?? null,
        num(m.qty),
        m.product.productUnits[0]?.unitName ?? null,
        m.createdByUser?.name ?? m.createdByUser?.email?.split("@")[0] ?? null,
        m.notes,
      ]),
    },
  ];
}

// ------------------------------------------------------------
// สินค้าและวัตถุดิบ
// ------------------------------------------------------------
async function productSheets(tx: PrismaClient, ctx: Ctx): Promise<ExportSheet[]> {
  const products = await tx.product.findMany({
    where: { tenantId: ctx.tenantId, deletedAt: null },
    orderBy: [{ name: "asc" }],
    select: {
      sku: true,
      name: true,
      nameEn: true,
      type: true,
      isActive: true,
      category: { select: { account: true, accountingSection: true, groupName: true } },
      productUnits: { orderBy: [{ isBase: "desc" }, { toBaseRatio: "asc" }], select: { unitName: true, toBaseRatio: true, isBase: true } },
    },
  });
  const sheets: ExportSheet[] = [
    {
      name: "สินค้า",
      columns: [
        { header: "รหัส" },
        { header: "ชื่อ", width: 28 },
        { header: "ชื่อภาษาอังกฤษ", width: 22 },
        { header: "ประเภท" },
        { header: "หมวดบัญชี", width: 30 },
        { header: "หน่วยนับ" },
        { header: "หน่วยอื่น", width: 30 },
        { header: "ใช้งานอยู่" },
      ],
      rows: products.map((p) => {
        const base = p.productUnits.find((u) => u.isBase)?.unitName ?? "";
        const others = p.productUnits
          .filter((u) => !u.isBase)
          .map((u) => `${u.unitName} = ${Number(u.toBaseRatio.toString()).toLocaleString("en-US", { maximumFractionDigits: 3 })} ${base}`)
          .join(" · ");
        return [
          p.sku,
          p.name,
          p.nameEn,
          PRODUCT_TYPE_LABELS_TH[p.type as keyof typeof PRODUCT_TYPE_LABELS_TH] ?? p.type,
          p.category ? categoryLabelTh(p.category) : null,
          base || null,
          others || null,
          yesNo(p.isActive),
        ];
      }),
    },
  ];
  // Rule R2: purchase prices need the cost ticket, as on the products screen.
  if (ctx.withMoney) {
    // Most shops never type a price list — what they paid is on their receipts.
    // One row per product × supplier: the latest confirmed receipt line.
    const paid = await tx.goodsReceiptItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        reversalOfItemId: null,
        product: { deletedAt: null },
        goodsReceipt: { status: "CONFIRMED", deletedAt: null, ...scope(ctx.reach) },
      },
      orderBy: [{ goodsReceipt: { receivedAt: "desc" } }, { lineNo: "asc" }],
      select: {
        productId: true,
        qtyReceivedActual: true,
        receivedUnitName: true,
        unitPriceActual: true,
        product: { select: { sku: true, name: true } },
        goodsReceipt: { select: { grNumber: true, receivedAt: true, pricesIncludeVat: true, supplierId: true, supplier: { select: { nameFull: true } }, branch: { select: { name: true } } } },
      },
    });
    const latest = new Map<string, (typeof paid)[number]>();
    for (const l of paid) {
      const key = `${l.productId}|${l.goodsReceipt.supplierId}`;
      if (!latest.has(key)) latest.set(key, l);
    }
    sheets.push({
      name: "ราคาที่จ่ายล่าสุด",
      columns: [
        { header: "รหัสสินค้า" },
        { header: "สินค้า", width: 26 },
        { header: "ผู้ขาย", width: 24 },
        { header: "ราคาต่อหน่วย", kind: "money" },
        { header: "หน่วย" },
        { header: "ราคารวม VAT แล้ว" },
        { header: "วันที่รับ", kind: "date" },
        { header: "ใบรับสินค้า" },
        { header: "สาขา" },
      ],
      rows: [...latest.values()]
        .sort((a, b) => a.product.name.localeCompare(b.product.name, "th") || a.goodsReceipt.supplier.nameFull.localeCompare(b.goodsReceipt.supplier.nameFull, "th"))
        .map((l) => [
          l.product.sku,
          l.product.name,
          l.goodsReceipt.supplier.nameFull,
          num(l.unitPriceActual),
          l.receivedUnitName,
          yesNo(l.goodsReceipt.pricesIncludeVat),
          bkkDay(l.goodsReceipt.receivedAt),
          l.goodsReceipt.grNumber,
          l.goodsReceipt.branch.name,
        ]),
    });
    const prices = await tx.supplierProductMapping.findMany({
      where: { tenantId: ctx.tenantId, deletedAt: null, effectiveTo: null, product: { deletedAt: null }, ...(ctx.reach.allBranches ? {} : { OR: [{ branchId: null }, { branchId: { in: [...ctx.reach.allowedBranchIds] } }] }) },
      orderBy: [{ product: { name: "asc" } }, { supplier: { nameFull: "asc" } }],
      select: {
        supplierItemName: true,
        supplierItemCode: true,
        currentUnitPrice: true,
        minOrderQty: true,
        isPreferred: true,
        effectiveFrom: true,
        product: { select: { sku: true, name: true } },
        supplier: { select: { nameFull: true } },
        branch: { select: { name: true } },
        orderUnit: { select: { unitName: true } },
      },
    });
    // A price list only some shops keep — no empty sheet for the ones that do not.
    if (prices.length > 0) sheets.push({
      name: "ราคาตามผู้ขาย",
      columns: [
        { header: "รหัสสินค้า" },
        { header: "สินค้า", width: 26 },
        { header: "ผู้ขาย", width: 24 },
        { header: "สาขา" },
        { header: "ชื่อที่ผู้ขายเรียก", width: 24 },
        { header: "รหัสของผู้ขาย" },
        { header: "หน่วยสั่ง" },
        { header: "ราคาปัจจุบัน", kind: "money" },
        { header: "สั่งขั้นต่ำ", kind: "qty" },
        { header: "ผู้ขายหลัก" },
        { header: "มีผลตั้งแต่", kind: "date" },
      ],
      rows: prices.map((m) => [
        m.product.sku,
        m.product.name,
        m.supplier.nameFull,
        m.branch?.name ?? "ทุกสาขา",
        m.supplierItemName,
        m.supplierItemCode,
        m.orderUnit?.unitName ?? null,
        num(m.currentUnitPrice),
        num(m.minOrderQty),
        yesNo(m.isPreferred),
        dateCell(m.effectiveFrom),
      ]),
    });
  }
  return sheets;
}

// ------------------------------------------------------------
// The two entry points the route uses
// ------------------------------------------------------------

/** How much a download would hold — the dialog's "392 แถว จาก 100 ใบ". */
export async function countRawExportLogic(ctx: Ctx): Promise<ExportCount> {
  return withTenantContext(ctx.tenantId, async (raw) => {
    const tx = raw as unknown as PrismaClient;
    switch (ctx.q.dataset) {
      case "sales":
        return { docs: null, rows: await tx.salesLine.count({ where: salesWhere(ctx) }), voidedLeftOut: false };
      case "goods-receipts": {
        const where = receiptsWhere(ctx);
        const [docs, rows] = await Promise.all([
          tx.goodsReceipt.count({ where }),
          tx.goodsReceiptItem.count({ where: { tenantId: ctx.tenantId, reversalOfItemId: null, goodsReceipt: where } }),
        ]);
        return { docs, rows, voidedLeftOut: !ctx.q.status };
      }
      case "expenses": {
        const where = expensesWhere(ctx);
        const [docs, rows] = await Promise.all([tx.expense.count({ where }), tx.expenseItem.count({ where: { tenantId: ctx.tenantId, expense: where } })]);
        return { docs, rows, voidedLeftOut: false };
      }
      case "stock-counts": {
        const where = countsWhere(ctx);
        const [docs, rows] = await Promise.all([
          tx.stockCount.count({ where }),
          tx.stockCountItem.count({ where: { tenantId: ctx.tenantId, reversalOfItemId: null, stockCount: where } }),
        ]);
        return { docs, rows, voidedLeftOut: !ctx.q.status };
      }
      case "stock-movements":
        return { docs: null, rows: await tx.stockMovement.count({ where: movesWhere(ctx) }), voidedLeftOut: false };
      case "products":
        return { docs: null, rows: await tx.product.count({ where: { tenantId: ctx.tenantId, deletedAt: null } }), voidedLeftOut: false };
    }
  });
}

/** Every sheet of the file, rows as recorded. */
export async function buildRawExportLogic(ctx: Ctx): Promise<ExportSheet[]> {
  return withTenantContext(
    ctx.tenantId,
    async (raw) => {
      const tx = raw as unknown as PrismaClient;
      switch (ctx.q.dataset) {
        case "sales":
          return salesSheets(tx, ctx);
        case "goods-receipts":
          return receiptSheets(tx, ctx);
        case "expenses":
          return expenseSheets(tx, ctx);
        case "stock-counts":
          return countSheets(tx, ctx);
        case "stock-movements":
          return movementSheets(tx, ctx);
        case "products":
          return productSheets(tx, ctx);
      }
    },
    { timeout: 60_000 }
  );
}

/**
 * The .xlsx, written through ExcelJS's streaming writer: a year of per-bill
 * sales is hundreds of thousands of rows on a 1 GB machine. Header row bold and
 * frozen; money, quantity and date columns carry their number formats.
 */
export function writeRawExportWorkbook(sheets: ExportSheet[]): ReadableStream {
  const pass = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: true });
  wb.creator = "คิดครัว";
  (async () => {
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: 1 }] });
      ws.columns = s.columns.map((c) => ({
        header: c.header,
        width: c.width ?? (c.kind === "date" ? 12 : 14),
        style:
          c.kind === "money"
            ? { numFmt: "#,##0.00" }
            : c.kind === "qty"
              ? { numFmt: "#,##0.###" }
              : c.kind === "date"
                ? { numFmt: "yyyy-mm-dd" }
                : {},
      }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).commit();
      for (const row of s.rows) ws.addRow(row).commit();
      ws.commit();
    }
    await wb.commit();
  })().catch((e) => {
    console.error("[export] workbook failed", e);
    pass.destroy(e as Error);
  });
  return Readable.toWeb(pass) as unknown as ReadableStream;
}
