// ============================================================
// Mise — the restore dialog's orphan rows (moved out of restore-actions.ts)
// ============================================================
// The dialog reads these over GET /api/products?what=orphans now
// (mise-ui-review §5c — a read is not a Server Action), so the shape and its
// serializer live in a plain module both the route and the dialog can import.
// ============================================================

import type { MappingWithRefs } from "@/server/supplier-product-mapping";

export type OrphanMappingRow = {
  id: string;
  supplierName: string;
  effectiveFrom: string; // ISO date (YYYY-MM-DD), displayed as-is
  currentUnitPrice: string | null;
  minOrderQty: string | null;
  leadTimeDays: number | null;
  isPreferred: boolean;
};

/** Serialize one full orphan mapping → its dialog row (Decimal → string, Pitfall #20). */
export function toOrphanMappingRow(m: MappingWithRefs): OrphanMappingRow {
  return {
    id: m.id,
    supplierName: m.supplier.nameFull,
    effectiveFrom: m.effectiveFrom.toISOString().slice(0, 10),
    currentUnitPrice: m.currentUnitPrice === null ? null : m.currentUnitPrice.toString(),
    minOrderQty: m.minOrderQty === null ? null : m.minOrderQty.toString(),
    leadTimeDays: m.leadTimeDays,
    isPreferred: m.isPreferred,
  };
}
