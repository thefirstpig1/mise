// Sprint 1 Part 8 L5a — RSC-serializable view of a SupplierProductMapping.
//
// Prisma's Decimal is a class instance and CANNOT cross the Server→Client
// boundary (Pitfall #20); @db.Date columns also arrive as Date objects. Rather
// than pass raw rows, the product detail page (Server Component) maps each
// MappingWithRefs through toMappingView() and hands the PLAIN object to the
// client list/history components. Mirrors product-view.ts.

import type { MappingWithRefs } from "@/server/supplier-product-mapping";

export type MappingView = {
  id: string;
  supplierId: string;
  /** supplier is a required FK so this is always set; null is defensive only.
   *  `name` = Supplier.nameFull (the list/order field). */
  supplier: { id: string; name: string } | null;
  productId: string;
  /** null branchId = tenant default ("ทุกสาขา"); set = a branch override (Q7). */
  branchId: string | null;
  branch: { id: string; name: string } | null;
  supplierItemCode: string | null;
  supplierItemName: string | null;
  orderUnitId: string | null;
  /** `name` = ProductUnit.unitName; null when no order unit was chosen. */
  orderUnit: { id: string; name: string } | null;
  /** Decimal → string (Pitfall #20). null = price/qty not captured. */
  currentUnitPrice: string | null;
  minOrderQty: string | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
  /** @db.Date → ISO yyyy-mm-dd (no time component; values are UTC midnight). */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** effectiveTo === null = the current/open price in its series (Q4). */
  isOpen: boolean;
  /** This mapping row is itself soft-deleted (only reachable via price history,
   *  which includes deleted rows — the live list never carries these). */
  deleted: boolean;
  /** The parent supplier is soft-deleted = orphan row (Q6, "all" list mode). */
  supplierDeleted: boolean;
};

/**
 * One price time-series — a (supplier, branch) tuple — for the history viewer:
 * every row incl. soft-deleted, newest first (effectiveFrom DESC, the order
 * getPriceHistoryLogic returns). `key` is a stable client key for lists/filters.
 */
export type PriceHistorySeries = {
  key: string;
  supplier: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
  rows: MappingView[];
};

/** @db.Date Date (UTC midnight) → "yyyy-mm-dd". */
const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

/** Stable client key for a (supplier, branch) tuple; null branch = "default". */
export const seriesKeyOf = (
  supplierId: string,
  branchId: string | null
): string => `${supplierId}:${branchId ?? "default"}`;

export function toMappingView(m: MappingWithRefs): MappingView {
  return {
    id: m.id,
    supplierId: m.supplierId,
    supplier: m.supplier
      ? { id: m.supplier.id, name: m.supplier.nameFull }
      : null,
    productId: m.productId,
    branchId: m.branchId,
    branch: m.branch ? { id: m.branch.id, name: m.branch.name } : null,
    supplierItemCode: m.supplierItemCode,
    supplierItemName: m.supplierItemName,
    orderUnitId: m.orderUnitId,
    orderUnit: m.orderUnit
      ? { id: m.orderUnit.id, name: m.orderUnit.unitName }
      : null,
    currentUnitPrice:
      m.currentUnitPrice === null ? null : m.currentUnitPrice.toString(),
    minOrderQty: m.minOrderQty === null ? null : m.minOrderQty.toString(),
    leadTimeDays: m.leadTimeDays,
    isPreferred: m.isPreferred,
    effectiveFrom: toDateString(m.effectiveFrom),
    effectiveTo: m.effectiveTo === null ? null : toDateString(m.effectiveTo),
    isOpen: m.effectiveTo === null,
    deleted: m.deletedAt != null,
    supplierDeleted: m.supplier?.deletedAt != null,
  };
}
