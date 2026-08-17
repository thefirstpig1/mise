// ============================================================
// Mise — expense view serializers (Sprint 3 Part 16 L4)
// ============================================================
// Server types → plain JSON for Client Components. Every `Prisma.Decimal`
// becomes a STRING here and nowhere else (Pitfall #20): a Decimal cannot cross
// the RSC boundary, and turning one into a `number` on the way would quietly
// give up satang on a figure someone reconciles against a bank statement.
//
// Nothing is computed here that the server does not already know, with one
// exception: `categoryLabel`, which is the 3-tier tree flattened for display.
// The tree's three columns are the fact; one readable line is presentation.
// ============================================================

import type {
  DueRecurringRow,
  ExpenseDetail,
  ExpenseListRow,
  RecurringExpenseRow,
} from "@/server/expense";

/** How a supplier is named on screen — the short name if there is one. */
const supplierLabel = (s: { nameFull: string; nameShort: string | null } | null) =>
  s === null ? null : (s.nameShort ?? s.nameFull);

/** `COGS · Food · Meat`. Flattened for a table cell, never for a decision. */
const categoryLabel = (c: {
  account: string;
  accountingSection: string;
  groupName: string;
}) => `${c.account} · ${c.accountingSection} · ${c.groupName}`;

export type ExpenseListRowView = {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string | null;
  supplierName: string | null;
  source: "MANUAL" | "FROM_GOODS_RECEIPT";
  /** ISO date (YYYY-MM-DD) — a `@db.Date` column, never an instant. */
  billDate: string;
  billNo: string | null;
  vatInvoiceNo: string | null;
  totalAmount: string;
  netPaymentAmount: string;
  paymentStatus: "UNPAID" | "PAID";
  paidAt: string | null;
  itemCount: number;
  period: string | null;
};

const dayString = (d: Date) => d.toISOString().slice(0, 10);

export function toExpenseListRowView(row: ExpenseListRow): ExpenseListRowView {
  return {
    id: row.id,
    branchId: row.branchId,
    branchName: row.branch.name,
    branchCode: row.branch.code,
    supplierName: supplierLabel(row.supplier),
    source: row.source,
    billDate: dayString(row.billDate),
    billNo: row.billNo,
    vatInvoiceNo: row.vatInvoiceNo,
    totalAmount: row.totalAmount.toString(),
    netPaymentAmount: row.netPaymentAmount.toString(),
    paymentStatus: row.paymentStatus,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    itemCount: row._count.items,
    period: row.period,
  };
}

export type ExpenseItemView = {
  id: string;
  lineNo: number;
  categoryId: string;
  categoryLabel: string;
  /** COGS or OpEx — which side of `/cost` this line lands on (ADR 0016 Q4). */
  categoryAccount: string;
  departmentId: string | null;
  departmentName: string | null;
  productId: string | null;
  productName: string | null;
  productDeleted: boolean;
  productUnitId: string | null;
  unitName: string | null;
  description: string;
  qty: string | null;
  unitPrice: string | null;
  /** EXCLUDING VAT — the header carries the tax (Decision #35). */
  totalPrice: string;
};

export type ExpenseDetailView = {
  id: string;
  branchId: string;
  branchName: string;
  supplierId: string | null;
  supplierName: string | null;
  supplierDeleted: boolean;
  source: "MANUAL" | "FROM_GOODS_RECEIPT";
  /**
   * The receipt this bill came from, when one did. Without this link a
   * system-created document cannot be found from the document that created it
   * (ADR 0016 Q7), which is the fastest way to make people distrust automation.
   */
  sourceGrId: string | null;
  sourceGrNumber: string | null;
  recurringExpenseId: string | null;
  recurringDescription: string | null;
  period: string | null;
  billDate: string;
  billNo: string | null;
  vatInvoiceNo: string | null;
  subtotalExclVat: string;
  vatRatePercent: string | null;
  vatAmount: string;
  /** Which direction the maths ran (Decision #36) — not recoverable from the results. */
  isPriceVatInclusive: boolean;
  totalAmount: string;
  subjectToWht: boolean;
  whtRatePercent: string | null;
  whtAmount: string | null;
  whtCertificateNo: string | null;
  netPaymentAmount: string;
  paymentMethod: string | null;
  paymentStatus: "UNPAID" | "PAID";
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  createdByName: string | null;
  items: ExpenseItemView[];
};

export function toExpenseDetailView(row: ExpenseDetail): ExpenseDetailView {
  return {
    id: row.id,
    branchId: row.branchId,
    branchName: row.branch.name,
    supplierId: row.supplierId,
    supplierName: supplierLabel(row.supplier),
    supplierDeleted: row.supplier?.deletedAt != null,
    source: row.source,
    sourceGrId: row.sourceGrId,
    sourceGrNumber: row.sourceGr?.grNumber ?? null,
    recurringExpenseId: row.recurringExpenseId,
    recurringDescription: row.recurring?.description ?? null,
    period: row.period,
    billDate: dayString(row.billDate),
    billNo: row.billNo,
    vatInvoiceNo: row.vatInvoiceNo,
    subtotalExclVat: row.subtotalExclVat.toString(),
    vatRatePercent: row.vatRatePercent?.toString() ?? null,
    vatAmount: row.vatAmount.toString(),
    isPriceVatInclusive: row.isPriceVatInclusive,
    totalAmount: row.totalAmount.toString(),
    subjectToWht: row.subjectToWht,
    whtRatePercent: row.whtRatePercent?.toString() ?? null,
    whtAmount: row.whtAmount?.toString() ?? null,
    whtCertificateNo: row.whtCertificateNo,
    netPaymentAmount: row.netPaymentAmount.toString(),
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByUser?.name ?? row.createdByUser?.email ?? null,
    items: row.items.map((item) => ({
      id: item.id,
      lineNo: item.lineNo,
      categoryId: item.categoryId,
      categoryLabel: categoryLabel(item.category),
      categoryAccount: item.category.account,
      departmentId: item.departmentId,
      departmentName: item.department?.name ?? null,
      productId: item.productId,
      productName: item.product?.name ?? null,
      productDeleted: item.product?.deletedAt != null,
      productUnitId: item.productUnitId,
      unitName: item.productUnit?.unitName ?? null,
      description: item.description,
      qty: item.qty?.toString() ?? null,
      unitPrice: item.unitPrice?.toString() ?? null,
      totalPrice: item.totalPrice.toString(),
    })),
  };
}

export type RecurringExpenseView = {
  id: string;
  branchId: string;
  branchName: string;
  supplierId: string | null;
  supplierName: string | null;
  categoryId: string;
  categoryLabel: string;
  description: string;
  defaultAmount: string;
  isPriceVatInclusive: boolean;
  vatRatePercent: string | null;
  subjectToWht: boolean;
  whtRatePercent: string | null;
  dayOfMonth: number;
  startPeriod: string;
  endPeriod: string | null;
  isActive: boolean;
};

export function toRecurringExpenseView(
  row: RecurringExpenseRow
): RecurringExpenseView {
  return {
    id: row.id,
    branchId: row.branchId,
    branchName: row.branch.name,
    supplierId: row.supplierId,
    supplierName: supplierLabel(row.supplier),
    categoryId: row.categoryId,
    categoryLabel: categoryLabel(row.category),
    description: row.description,
    defaultAmount: row.defaultAmount.toString(),
    isPriceVatInclusive: row.isPriceVatInclusive,
    vatRatePercent: row.vatRatePercent?.toString() ?? null,
    subjectToWht: row.subjectToWht,
    whtRatePercent: row.whtRatePercent?.toString() ?? null,
    dayOfMonth: row.dayOfMonth,
    startPeriod: row.startPeriod,
    endPeriod: row.endPeriod,
    isActive: row.isActive,
  };
}

/** One template and the months still waiting for someone to confirm them. */
export type DueRecurringView = {
  template: RecurringExpenseView;
  duePeriods: string[];
};

export const toDueRecurringView = (row: DueRecurringRow): DueRecurringView => ({
  template: toRecurringExpenseView(row.template),
  duePeriods: row.duePeriods,
});
