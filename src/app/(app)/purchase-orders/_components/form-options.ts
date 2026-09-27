// Sprint 2 Part 11 L5b — reference data for the order form.
//
// Server-only module (it reaches Prisma through the *Logic layer): imported by
// /new and /[id]/edit, which need exactly the same three lists. Everything that
// crosses into the Client Component is already a plain string — Decimal cannot
// make that trip (Pitfall #20), and `toBaseRatio` / `defaultVatRatePercent` are
// both Decimal columns.

import { getProductsLogic } from "@/server/product";
import { getSuppliersLogic } from "@/server/supplier";
import { getBranchesLogic } from "@/server/branch";
import type { BranchReach } from "@/lib/permissions/service";
import type {
  POBranchOption,
  POProductOption,
  POSupplierOption,
} from "./PurchaseOrderForm";

export type PurchaseOrderFormOptions = {
  products: POProductOption[];
  suppliers: POSupplierOption[];
  branches: POBranchOption[];
};

export async function loadPurchaseOrderFormOptions(
  tenantId: string,
  /** Rule A5: the picker only ever offers branches this person may act on. */
  reach: BranchReach
): Promise<PurchaseOrderFormOptions> {
  const [products, suppliers, branches] = await Promise.all([
    getProductsLogic(tenantId),
    getSuppliersLogic(tenantId),
    getBranchesLogic(tenantId, reach),
  ]);

  return {
    // getProductsLogic orders by the category tree (built for the product page);
    // a picker reads better by name.
    products: products
      .map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        baseUnitName: p.productUnits.find((u) => u.isBase)?.unitName ?? null,
        units: p.productUnits
          .map((u) => ({
            id: u.id,
            unitName: u.unitName,
            toBaseRatio: u.toBaseRatio.toString(),
            isBase: u.isBase,
          }))
          // Base unit first, then the bigger buying units.
          .sort((a, b) => Number(b.isBase) - Number(a.isBase)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "th")),

    suppliers: suppliers.map((s) => ({
      id: s.id,
      nameFull: s.nameFull,
      isVatRegistered: s.isVatRegistered,
      defaultVatRatePercent: s.defaultVatRatePercent?.toString() ?? null,
    })),

    branches: branches.map((b) => ({ id: b.id, name: b.name })),
  };
}
