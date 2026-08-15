// ============================================================
// Mise — Purchase Order view serializers (Sprint 2 Part 11 L4)
// ============================================================
// The boundary where order rows become plain JSON for Client Components.
// Same job as stock/_components/stock-view.ts:
//
//   - Prisma.Decimal CANNOT cross to a Client Component (Pitfall #20). Every
//     money and quantity value leaves here as a STRING, never a number: prices
//     are Decimal(15,4) and totals Decimal(15,2), and a round-trip through JS
//     float is exactly how a 1070.00 becomes a 1069.9999999999999.
//   - Dates leave as ISO strings, plus a pre-rendered Bangkok label where the
//     UI shows one: the order list is a Server Component but the form and the
//     line editor are client-side, and formatting on both sides of hydration
//     with different locale defaults is a mismatch waiting to happen.
// ============================================================

import type { Prisma } from "@prisma/client";
import type {
  PurchaseOrderDetail,
  PurchaseOrderListRow,
  ResolvedSupplierPrice,
} from "@/server/purchase-order";

const str = (d: Prisma.Decimal): string => d.toString();
const strOrNull = (d: Prisma.Decimal | null): string | null =>
  d === null ? null : d.toString();
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

const BANGKOK_DATE = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** Format for display: Bangkok date, or an em dash when there is no date. */
export const formatBangkokDate = (d: Date | null): string =>
  d ? BANGKOK_DATE.format(d) : "—";

export type PurchaseOrderListView = {
  id: string;
  poNumber: string;
  status: string;
  branchName: string;
  supplierName: string;
  supplierDeleted: boolean;
  lineCount: number;
  totalAmount: string;
  expectedDeliveryLabel: string;
  createdAtLabel: string;
};

export type PurchaseOrderLineView = {
  id: string;
  lineNo: number;
  productId: string;
  productName: string;
  productSku: string;
  productDeleted: boolean;
  qtyOrdered: string;
  qtyReceived: string;
  orderUnitId: string;
  /** The FROZEN unit name (ADR 0012 Q3) — not the ProductUnit's current name. */
  orderUnitName: string;
  toBaseRatio: string;
  unitPrice: string;
  lineTotal: string;
  /** null = the price was typed by hand, not taken from the price list (Q5). */
  supplierProductMappingId: string | null;
  notes: string | null;
  allocations: {
    departmentId: string;
    departmentName: string;
    qtyAllocated: string;
  }[];
};

export type PurchaseOrderDetailView = {
  id: string;
  poNumber: string;
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
  expectedDeliveryDate: string | null;
  expectedDeliveryLabel: string;
  subtotalExclVat: string;
  vatRatePercent: string | null;
  vatAmount: string;
  totalAmount: string;
  notes: string | null;
  createdByName: string;
  createdAtLabel: string;
  sentAtLabel: string | null;
  cancelledAtLabel: string | null;
  cancelReason: string | null;
  lines: PurchaseOrderLineView[];
};

/** What the order form needs to fill a line in (L3a's resolver, stringified). */
export type ResolvedPriceView = {
  mappingId: string;
  unitPrice: string;
  orderUnitId: string | null;
  orderUnitName: string | null;
  toBaseRatio: string | null;
  minOrderQty: string | null;
  leadTimeDays: number | null;
  supplierItemCode: string | null;
  scope: "branch" | "tenant";
};

const userLabel = (u: { name: string | null; email: string } | null): string =>
  u ? (u.name ?? u.email) : "—";

export function toPurchaseOrderListView(
  po: PurchaseOrderListRow
): PurchaseOrderListView {
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    branchName: po.branch.name,
    supplierName: po.supplier.nameFull,
    supplierDeleted: po.supplier.deletedAt !== null,
    lineCount: po._count.items,
    totalAmount: str(po.totalAmount),
    expectedDeliveryLabel: formatBangkokDate(po.expectedDeliveryDate),
    createdAtLabel: formatBangkokDate(po.createdAt),
  };
}

export function toPurchaseOrderDetailView(
  po: PurchaseOrderDetail
): PurchaseOrderDetailView {
  return {
    id: po.id,
    poNumber: po.poNumber,
    status: po.status,
    branch: { id: po.branch.id, name: po.branch.name, code: po.branch.code },
    supplier: {
      id: po.supplier.id,
      nameFull: po.supplier.nameFull,
      code: po.supplier.code,
      contactPhone: po.supplier.contactPhone,
      contactEmail: po.supplier.contactEmail,
      address: po.supplier.address,
      deleted: po.supplier.deletedAt !== null,
    },
    expectedDeliveryDate: iso(po.expectedDeliveryDate),
    expectedDeliveryLabel: formatBangkokDate(po.expectedDeliveryDate),
    subtotalExclVat: str(po.subtotalExclVat),
    vatRatePercent: strOrNull(po.vatRatePercent),
    vatAmount: str(po.vatAmount),
    totalAmount: str(po.totalAmount),
    notes: po.notes,
    createdByName: userLabel(po.createdByUser),
    createdAtLabel: formatBangkokDate(po.createdAt),
    sentAtLabel: po.sentAt ? formatBangkokDate(po.sentAt) : null,
    cancelledAtLabel: po.cancelledAt ? formatBangkokDate(po.cancelledAt) : null,
    cancelReason: po.cancelReason,
    lines: po.items.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      productId: l.productId,
      productName: l.product.name,
      productSku: l.product.sku,
      productDeleted: l.product.deletedAt !== null,
      qtyOrdered: str(l.qtyOrdered),
      qtyReceived: str(l.qtyReceived),
      orderUnitId: l.orderUnitId,
      orderUnitName: l.orderUnitName,
      toBaseRatio: str(l.toBaseRatio),
      unitPrice: str(l.unitPrice),
      lineTotal: str(l.lineTotal),
      supplierProductMappingId: l.supplierProductMappingId,
      notes: l.notes,
      allocations: l.allocations.map((a) => ({
        departmentId: a.departmentId,
        departmentName: a.department.name,
        qtyAllocated: str(a.qtyAllocated),
      })),
    })),
  };
}

export function toResolvedPriceView(p: ResolvedSupplierPrice): ResolvedPriceView {
  return {
    mappingId: p.mappingId,
    unitPrice: str(p.unitPrice),
    orderUnitId: p.orderUnitId,
    orderUnitName: p.orderUnitName,
    toBaseRatio: strOrNull(p.toBaseRatio),
    minOrderQty: strOrNull(p.minOrderQty),
    leadTimeDays: p.leadTimeDays,
    supplierItemCode: p.supplierItemCode,
    scope: p.scope,
  };
}
