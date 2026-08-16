// ============================================================
// Mise — Goods Receipt view serializers (Sprint 2 Part 13 L4)
// ============================================================
// The boundary where receipt rows become plain JSON for Client Components.
// Same job as purchase-orders/_components/purchase-order-view.ts:
//
//   - Prisma.Decimal CANNOT cross to a Client Component (Pitfall #20). Every
//     money and quantity value leaves here as a STRING, never a number.
//   - Dates leave as ISO strings plus a pre-rendered Bangkok label. A receipt
//     carries a real TIME (ADR 0013 Q4), so its label includes the clock — the
//     difference between two deliveries on the same day is the only thing that
//     tells them apart on screen.
//
// Variance is COMPUTED HERE rather than stored (Q7): it is a pure function of
// values already on the row, and a stored copy is one more thing that can
// disagree with itself.
// ============================================================

import { Prisma } from "@prisma/client";
import type {
  GoodsReceiptDetail,
  GoodsReceiptListRow,
  ReceivablePurchaseOrder,
} from "@/server/goods-receipt";

const str = (d: Prisma.Decimal): string => d.toString();
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const BANGKOK_DATETIME = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Bangkok date + clock — a receipt is an instant, not a day. */
export const formatBangkokDateTime = (d: Date | null): string =>
  d ? BANGKOK_DATETIME.format(d) : "—";

export const formatBangkokDate = (d: Date | null): string =>
  d ? BANGKOK_DATE.format(d) : "—";

/**
 * `<input type="datetime-local">` wants local wall-clock with no zone. The form
 * is always Bangkok (Decision #60), so shift the instant by +7h and slice the
 * ISO string — using the browser's own timezone here would offer the user a time
 * the server then rejects.
 */
export function toBangkokDateTimeLocal(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16);
}

const THB = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a Decimal STRING for display without ever making it a JS number.
 *
 * The integer part is grouped through Intl (safe — it is the part a float can
 * still represent), and the fraction is sliced off the string untouched. The
 * same helper exists inline in the purchase-order list page; it lives in the
 * serializer here because the receipt list, the detail page and the print view
 * all need it.
 */
export function formatMoney(value: string): string {
  const negative = value.startsWith("-");
  const [whole, frac = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped = THB.format(Number(whole || "0")).split(".")[0];
  return `${negative ? "-" : ""}${grouped}.${(frac + "00").slice(0, 2)}`;
}

/** Trim a Decimal string's trailing zeros so "4.000" reads as "4". */
export function formatQty(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

export type GoodsReceiptListView = {
  id: string;
  grNumber: string;
  status: string;
  branchName: string;
  supplierName: string;
  supplierDeleted: boolean;
  poNumber: string | null;
  purchaseOrderId: string | null;
  invoiceNo: string | null;
  lineCount: number;
  hasDiscrepancy: boolean;
  receivedAtLabel: string;
  receivedByName: string;
};

export type GoodsReceiptLineView = {
  id: string;
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string;
  productDeleted: boolean;
  qtyReceivedActual: string;
  receivedUnitId: string;
  /** The FROZEN unit name (ADR 0012 Q3 / ADR 0013 Q1). */
  receivedUnitName: string;
  toBaseRatio: string;
  /** `qty × ratio` — what actually entered the ledger, in the base unit. */
  qtyBase: string;
  unitPriceActual: string;
  lineTotalActual: string;
  notes: string | null;
  purchaseOrderItemId: string | null;
  /** The ordered side, present only on a PO-based line. */
  ordered: {
    lineNo: number;
    qtyOrdered: string;
    orderUnitName: string;
    unitPrice: string;
    /** received − ordered: positive = over-delivery (Q3). Computed, never stored. */
    varianceQty: string;
    variancePrice: string;
  } | null;
  /** Set on a reversal line — the id of the line it undoes (Q6). */
  reversalOfItemId: string | null;
  isReversal: boolean;
  allocations: {
    departmentId: string;
    departmentName: string;
    qtyAllocatedActual: string;
  }[];
};

export type GoodsReceiptDetailView = {
  id: string;
  grNumber: string;
  status: string;
  branch: { id: string; name: string; code: string };
  supplier: {
    id: string;
    nameFull: string;
    code: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    address: string | null;
    deleted: boolean;
  };
  purchaseOrder: { id: string; poNumber: string; status: string } | null;
  invoiceNo: string | null;
  receivedAt: string;
  receivedAtLabel: string;
  receivedAtLocal: string;
  receivedByName: string;
  notes: string | null;
  hasDiscrepancy: boolean;
  confirmedAtLabel: string | null;
  confirmedByName: string | null;
  voidedAtLabel: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  /** Sum of every line total, reversals included — so a void nets to zero. */
  totalAmount: string;
  lines: GoodsReceiptLineView[];
};

/** One PO line as the receive form prefills it. */
export type ReceivableLineView = {
  purchaseOrderItemId: string;
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string | null;
  orderUnitId: string;
  orderUnitName: string;
  toBaseRatio: string;
  unitPrice: string;
  qtyOrdered: string;
  qtyReceived: string;
  qtyOutstanding: string;
};

export type ReceivablePurchaseOrderView = {
  id: string;
  poNumber: string;
  status: string;
  branchId: string;
  branchName: string;
  supplierId: string;
  supplierName: string;
  expectedDeliveryLabel: string;
  /** False for DRAFT / CANCELLED — the page explains rather than 404s. */
  receivable: boolean;
  lines: ReceivableLineView[];
};

const userLabel = (u: { name: string | null; email: string } | null): string =>
  u ? (u.name ?? u.email) : "—";

export function toGoodsReceiptListView(
  gr: GoodsReceiptListRow
): GoodsReceiptListView {
  return {
    id: gr.id,
    grNumber: gr.grNumber,
    status: gr.status,
    branchName: gr.branch.name,
    supplierName: gr.supplier.nameFull,
    supplierDeleted: gr.supplier.deletedAt !== null,
    poNumber: gr.purchaseOrder?.poNumber ?? null,
    purchaseOrderId: gr.purchaseOrder?.id ?? null,
    invoiceNo: gr.invoiceNo,
    lineCount: gr._count.items,
    hasDiscrepancy: gr.hasDiscrepancy,
    receivedAtLabel: formatBangkokDateTime(gr.receivedAt),
    receivedByName: userLabel(gr.receivedByUser),
  };
}

export function toGoodsReceiptDetailView(
  gr: GoodsReceiptDetail
): GoodsReceiptDetailView {
  const total = gr.items.reduce(
    (sum, l) => sum.plus(l.lineTotalActual),
    new Prisma.Decimal(0)
  );

  return {
    id: gr.id,
    grNumber: gr.grNumber,
    status: gr.status,
    branch: { id: gr.branch.id, name: gr.branch.name, code: gr.branch.code },
    supplier: {
      id: gr.supplier.id,
      nameFull: gr.supplier.nameFull,
      code: gr.supplier.code,
      contactPhone: gr.supplier.contactPhone,
      contactEmail: gr.supplier.contactEmail,
      address: gr.supplier.address,
      deleted: gr.supplier.deletedAt !== null,
    },
    purchaseOrder: gr.purchaseOrder
      ? {
          id: gr.purchaseOrder.id,
          poNumber: gr.purchaseOrder.poNumber,
          status: gr.purchaseOrder.status,
        }
      : null,
    invoiceNo: gr.invoiceNo,
    receivedAt: iso(gr.receivedAt)!,
    receivedAtLabel: formatBangkokDateTime(gr.receivedAt),
    receivedAtLocal: toBangkokDateTimeLocal(gr.receivedAt),
    receivedByName: userLabel(gr.receivedByUser),
    notes: gr.notes,
    hasDiscrepancy: gr.hasDiscrepancy,
    confirmedAtLabel: gr.confirmedAt ? formatBangkokDateTime(gr.confirmedAt) : null,
    confirmedByName: gr.confirmedByUser ? userLabel(gr.confirmedByUser) : null,
    voidedAtLabel: gr.voidedAt ? formatBangkokDateTime(gr.voidedAt) : null,
    voidedByName: gr.voidedByUser ? userLabel(gr.voidedByUser) : null,
    voidReason: gr.voidReason,
    totalAmount: str(total),
    lines: gr.items.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      productId: l.productId,
      productName: l.product.name,
      productSku: l.product.sku,
      productDeleted: l.product.deletedAt !== null,
      qtyReceivedActual: str(l.qtyReceivedActual),
      receivedUnitId: l.receivedUnitId,
      receivedUnitName: l.receivedUnitName,
      toBaseRatio: str(l.toBaseRatio),
      qtyBase: str(l.qtyReceivedActual.mul(l.toBaseRatio)),
      unitPriceActual: str(l.unitPriceActual),
      lineTotalActual: str(l.lineTotalActual),
      notes: l.notes,
      purchaseOrderItemId: l.purchaseOrderItemId,
      ordered: l.purchaseOrderItem
        ? {
            lineNo: l.purchaseOrderItem.lineNo,
            qtyOrdered: str(l.purchaseOrderItem.qtyOrdered),
            orderUnitName: l.purchaseOrderItem.orderUnitName,
            unitPrice: str(l.purchaseOrderItem.unitPrice),
            // Received minus ordered: positive = over-delivery (Q3). Computed
            // against the ORDER's total, which is the number the person holding
            // the delivery note is comparing against.
            varianceQty: str(
              l.qtyReceivedActual.minus(l.purchaseOrderItem.qtyOrdered)
            ),
            variancePrice: str(
              l.unitPriceActual.minus(l.purchaseOrderItem.unitPrice)
            ),
          }
        : null,
      reversalOfItemId: l.reversalOfItemId,
      isReversal: l.reversalOfItemId !== null,
      allocations: l.allocations.map((a) => ({
        departmentId: a.departmentId,
        departmentName: a.department.name,
        qtyAllocatedActual: str(a.qtyAllocatedActual),
      })),
    })),
  };
}

export function toReceivablePurchaseOrderView(
  po: ReceivablePurchaseOrder,
  receivable: boolean
): ReceivablePurchaseOrderView {
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    branchId: po.branchId,
    branchName: po.branchName,
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    expectedDeliveryLabel: formatBangkokDate(po.expectedDeliveryDate),
    receivable,
    lines: po.lines.map((l) => ({
      purchaseOrderItemId: l.purchaseOrderItemId,
      lineNo: l.lineNo,
      productId: l.productId,
      productName: l.productName,
      productSku: l.productSku,
      orderUnitId: l.orderUnitId,
      orderUnitName: l.orderUnitName,
      toBaseRatio: str(l.toBaseRatio),
      unitPrice: str(l.unitPrice),
      qtyOrdered: str(l.qtyOrdered),
      qtyReceived: str(l.qtyReceived),
      qtyOutstanding: str(l.qtyOutstanding),
    })),
  };
}
