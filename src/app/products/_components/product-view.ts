// Sprint 1 Part 7a — RSC-serializable view of a Product (+ its base unit).
//
// Prisma's Decimal is a class instance and CANNOT cross the Server→Client
// boundary (Pitfall #20). Rather than serialize-and-pass the raw Product, the
// page (Server Component) maps each ProductWithUnits through toProductView() and
// hands the resulting PLAIN object to the client components (ProductTree /
// ProductForm). 7a-7b need only identity + category + units; 7c adds PREPPED
// fields (type / parentProductId / parent label / yieldPercent). yieldPercent is
// the only Decimal-typed field here — serialized via `.toString()` per Pitfall #20.

import type { ProductWithUnits } from "@/server/product";

/** One ProductUnit, RSC-safe: Decimal toBaseRatio serialized to string (Pitfall #20). */
export type ProductUnitView = {
  unitName: string;
  toBaseRatio: string;
  isBase: boolean;
  isDefaultBuyUnit: boolean;
  source: string | null;
};

export type ProductView = {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  type: string;
  primaryDimension: string;
  isActive: boolean;
  categoryId: string | null;
  category: {
    account: string;
    accountingSection: string;
    groupName: string;
  } | null;
  /** Name/dimension of the single base unit (ADR 0005); null only if missing. */
  baseUnitName: string | null;
  baseUnitDimension: string | null;
  /** All units (base first by displayOrder), for the multi-unit form + tree (7b). */
  units: ProductUnitView[];
  /** 7c PREPPED parent edge. parentProductId is the FK; `parent` is the
   *  pre-joined label (name+sku) — populated even if the parent is
   *  soft-deleted, so the edit form can show the current value when the live-
   *  only picker has no matching option. Both null for RAW. */
  parentProductId: string | null;
  parent: { name: string; sku: string } | null;
  /** 7c yield percent: Decimal → string per Pitfall #20. Null for RAW. */
  yieldPercent: string | null;
};

export function toProductView(p: ProductWithUnits): ProductView {
  const base = p.productUnits.find((u) => u.isBase) ?? null;
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    nameEn: p.nameEn,
    type: p.type,
    primaryDimension: p.primaryDimension,
    isActive: p.isActive,
    categoryId: p.categoryId,
    category: p.category
      ? {
          account: p.category.account,
          accountingSection: p.category.accountingSection,
          groupName: p.category.groupName,
        }
      : null,
    baseUnitName: base?.unitName ?? null,
    baseUnitDimension: base?.unitDimension ?? null,
    units: [...p.productUnits]
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((u) => ({
        unitName: u.unitName,
        toBaseRatio: u.toBaseRatio.toString(),
        isBase: u.isBase,
        isDefaultBuyUnit: u.isDefaultBuyUnit,
        source: u.source,
      })),
    parentProductId: p.parentProductId,
    parent: p.parentProduct
      ? { name: p.parentProduct.name, sku: p.parentProduct.sku }
      : null,
    yieldPercent: p.yieldPercent === null ? null : p.yieldPercent.toString(),
  };
}
