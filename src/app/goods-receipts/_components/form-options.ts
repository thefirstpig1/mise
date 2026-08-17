// Sprint 2 Part 13 L5b — reference data for the receipt form.
//
// Server-only module (it reaches Prisma through the *Logic layer): imported by
// /new and /[id]/edit. Everything crossing into the Client Component is already
// a plain string — Decimal cannot make that trip (Pitfall #20).

import { getProductsLogic } from "@/server/product";
import { getSuppliersLogic } from "@/server/supplier";
import { getBranchesLogic } from "@/server/branch";
import { getPurchaseOrdersLogic } from "@/server/purchase-order";
import { RECEIVABLE_PO_STATUSES } from "@/lib/validations/goods-receipt";
import { formatBangkokDate } from "./goods-receipt-view";
import type {
  GrBranchOption,
  GrProductOption,
  GrPurchaseOrderOption,
  GrSupplierOption,
} from "./GoodsReceiptForm";

export type GoodsReceiptFormOptions = {
  products: GrProductOption[];
  suppliers: GrSupplierOption[];
  branches: GrBranchOption[];
  purchaseOrders: GrPurchaseOrderOption[];
};

export async function loadGoodsReceiptFormOptions(
  tenantId: string
): Promise<GoodsReceiptFormOptions> {
  const [products, suppliers, branches, orders] = await Promise.all([
    getProductsLogic(tenantId),
    getSuppliersLogic(tenantId),
    getBranchesLogic(tenantId),
    getPurchaseOrdersLogic(tenantId, {}),
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
      defaultVatRatePercent: s.defaultVatRatePercent?.toString() ?? null,
    })),

    branches: branches.map((b) => ({ id: b.id, name: b.name })),

    // Only orders that can actually take a delivery (ADR 0013 Q1/Q3). A DRAFT was
    // never sent and a CANCELLED one is off; RECEIVED stays in the list because
    // Q3 allows one more delivery against it.
    purchaseOrders: orders
      .filter((po) => RECEIVABLE_PO_STATUSES.includes(po.status as never))
      .map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        branchId: po.branchId,
        supplierId: po.supplierId,
        supplierName: po.supplier.nameFull,
        branchName: po.branch.name,
        expectedDeliveryLabel: formatBangkokDate(po.expectedDeliveryDate),
      })),
  };
}
