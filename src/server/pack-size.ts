// "+ ขนาดใหม่…" (Kong 2026-10-21): the shop bought the same coffee in a 500 g
// bag instead of 250 g. Before, that took the product sheet, then the
// supplier's price list, then back to the order. Now the size is added where
// the order is being written, and — on the supplier's order page — can become
// that supplier's regular order unit in the same step.
//
// Adding only: a size is a fact about what was bought, so the person buying
// may add one (Kong: purchasers, not only whoever maintains products). Renaming
// or resizing a unit stays on the product sheet, where it warns about every
// recipe and document written in it (Part 21 Q17).

import { withTenantContext } from "@/lib/db";
import { composePackName, packRatio } from "@/lib/pack-unit";
import { CrossTenantReferenceError, ensureProductUnitLogic } from "@/server/product";
import { createSupplierProductMappingLogic } from "@/server/supplier-product-mapping";
import { computeBangkokToday } from "@/lib/bangkok-date";

export type PackSize = { id: string; unitName: string; toBaseRatio: number };

export class PackSizeUnitError extends Error {
  constructor(sizeUnit: string, base: string) {
    super(`A size in ${sizeUnit} cannot be converted to the base unit ${base}`);
  }
}

/** Create "ถุง 500 g" on the product (or return it if it already exists). */
export async function addPackSizeLogic(
  tenantId: string,
  input: { productId: string; box: string; size: number; sizeUnit: string }
): Promise<PackSize> {
  const base = await withTenantContext(tenantId, (tx) =>
    tx.productUnit.findFirst({
      where: { productId: input.productId, isBase: true, product: { tenantId, deletedAt: null } },
      select: { unitName: true },
    })
  );
  if (base === null) throw new CrossTenantReferenceError("product", input.productId);
  // The ratio is computed HERE from the base, never taken from the client.
  const ratio = packRatio(input.size, input.sizeUnit, base.unitName);
  if (ratio === null) throw new PackSizeUnitError(input.sizeUnit, base.unitName);
  const unitName = composePackName(input.box, input.size, input.sizeUnit);
  return ensureProductUnitLogic(tenantId, { productId: input.productId, unitName, toBaseRatio: ratio });
}

export class MappingUnitMismatchError extends Error {
  constructor() {
    super("The unit does not belong to the mapping's product");
  }
}

/**
 * Make `unitId` the order unit of a supplier price-list row, at the price the
 * person just gave for it. The old price was for the old size, so it is never
 * carried over — not even converted per gram: a bigger bag is usually cheaper
 * per gram, and a converted figure would be a price nobody quoted.
 *
 * A price list keeps its history (ADR 0009 Q4: append + supersede), so this
 * opens a NEW row from today and closes the old one, exactly as the price-list
 * form would. Only a row that itself started today is corrected in place.
 */
export async function setMappingOrderUnitLogic(
  tenantId: string,
  input: { mappingId: string; unitId: string; unitPrice: number }
): Promise<void> {
  const mapping = await withTenantContext(tenantId, (tx) =>
    tx.supplierProductMapping.findFirst({ where: { id: input.mappingId, tenantId, deletedAt: null } })
  );
  if (mapping === null) throw new CrossTenantReferenceError("product", input.mappingId);
  const today = computeBangkokToday();
  if (mapping.effectiveFrom.getTime() === today.getTime()) {
    await withTenantContext(tenantId, async (tx) => {
      const unit = await tx.productUnit.findFirst({ where: { id: input.unitId, productId: mapping.productId }, select: { id: true } });
      if (unit === null) throw new MappingUnitMismatchError();
      await tx.supplierProductMapping.update({ where: { id: mapping.id }, data: { orderUnitId: unit.id, currentUnitPrice: input.unitPrice } });
    });
    return;
  }
  // The supersede rule and the order-unit guard live in the price-list logic.
  await createSupplierProductMappingLogic(tenantId, {
    supplierId: mapping.supplierId,
    productId: mapping.productId,
    branchId: mapping.branchId,
    supplierItemCode: mapping.supplierItemCode,
    supplierItemName: mapping.supplierItemName,
    orderUnitId: input.unitId,
    currentUnitPrice: input.unitPrice,
    minOrderQty: null, // the minimum was counted in the old size
    leadTimeDays: mapping.leadTimeDays,
    isPreferred: mapping.isPreferred,
    effectiveFrom: today,
    effectiveTo: mapping.effectiveTo,
  });
}
