// Sprint 1 Part 7a — RSC-serializable view of a Product (+ its base unit).
//
// Prisma's Decimal is a class instance and CANNOT cross the Server→Client
// boundary (Pitfall #20). Rather than serialize-and-pass the raw Product, the
// page (Server Component) maps each ProductWithUnits through toProductView() and
// hands the resulting PLAIN object to the client components (ProductTree /
// ProductForm). 7a needs only identity + category + the base unit's name, so
// NO Decimal field is included → the pitfall is avoided by construction.
//
// 7b note: when yieldPercent / density / targetMarketPrice surface in the UI,
// add them HERE as `.toString()`-ed strings (cf. supplier-view.ts) — never pass
// the raw Decimal across the boundary.

import type { ProductWithUnits } from "@/server/product";

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
  };
}
