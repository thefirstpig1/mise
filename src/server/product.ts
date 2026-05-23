// ============================================================
// Mise — Product logic layer (Sprint 1 Part 7a; Q3 / ADR 0004, ADR 0005)
// ============================================================
// Same pattern as src/server/{supplier,category}.ts: each fn takes `tenantId`
// as its FIRST argument, runs inside withTenantContext, and filters/sets
// `tenantId` EXPLICITLY (explicit filtering isolates tenants TODAY; RLS is
// inert until Sprint 7 — ADR 0004).
//
// 7a scope (ADR 0005): a Product is always RAW and always owns exactly ONE
// base unit (a ProductUnit with isBase=true, toBaseRatio=1). create/update
// write Product + that base unit ATOMICALLY (one transaction) so the
// "every Product has ≥1 base unit" invariant always holds.
//
// Reads are called directly by Server Components; writes go through the
// "use server" wrappers in src/app/products/actions.ts.
// ============================================================

import { Prisma, PrismaClient, type Product } from "@prisma/client";
import { prisma, withTenantContext } from "@/lib/db";
import type { ProductInput } from "@/lib/validations/product";

/** Product plus its units + category — the shape reads return for the UI. */
export type ProductWithUnits = Prisma.ProductGetPayload<{
  include: { productUnits: true; category: true };
}>;

/** Minimal unit option for the form dropdown (NO Decimal → safe across RSC, Pitfall #20). */
export type UnitOption = { unitName: string; unitDimension: string };

/**
 * Thrown when a product `sku` collides with an existing one in the same tenant
 * (Prisma P2002 on @@unique([tenantId, sku])). The @@unique is FULL (counts
 * soft-deleted rows — Pitfall #22), so a soft-deleted sku still blocks re-use.
 * The action layer maps this to a Thai message.
 */
export class ProductSkuConflictError extends Error {
  constructor(public readonly sku: string | null) {
    super(`Product sku already exists in this tenant: ${sku ?? "(none)"}`);
    this.name = "ProductSkuConflictError";
  }
}

/** Thrown when baseUnitName is not a unit_template entry for the given dimension. */
export class InvalidBaseUnitError extends Error {
  constructor(
    public readonly unitName: string,
    public readonly dimension: string
  ) {
    super(`Unit "${unitName}" is not a valid ${dimension} unit`);
    this.name = "InvalidBaseUnitError";
  }
}

/** Map Prisma P2002 → typed ProductSkuConflictError; pass others through. */
function rethrowSkuConflict(e: unknown, sku: string | null): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new ProductSkuConflictError(sku);
  }
  throw e;
}

/** Guard: baseUnitName must exist in unit_template AND match the dimension (Q1). */
async function assertValidBaseUnit(
  tx: PrismaClient,
  unitName: string,
  dimension: string
): Promise<void> {
  const unit = await tx.unitTemplate.findFirst({
    where: { unitName, unitDimension: dimension },
  });
  if (!unit) throw new InvalidBaseUnitError(unitName, dimension);
}

/**
 * Auto-generate the next `P-####` sku for a tenant (Q3). Scans existing skus of
 * the P-#### shape — INCLUDING soft-deleted (the @@unique is full, so their
 * numbers must not be reused) — and returns max+1, zero-padded to 4 digits.
 */
async function generateSku(tx: PrismaClient, tenantId: string): Promise<string> {
  const rows = await tx.product.findMany({
    where: { tenantId, sku: { startsWith: "P-" } },
    select: { sku: true },
  });
  let max = 0;
  for (const { sku } of rows) {
    const m = /^P-(\d+)$/.exec(sku);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `P-${String(max + 1).padStart(4, "0")}`;
}

/**
 * System-wide unit templates for the form's base-unit dropdown. unit_template
 * is global (no tenantId) → plain prisma, NOT withTenantContext. Returns only
 * name + dimension (no Decimal toSiRatio) so it can cross to a Client Component.
 */
export async function getUnitTemplates(): Promise<UnitOption[]> {
  const rows = await prisma.unitTemplate.findMany({
    select: { unitName: true, unitDimension: true },
    orderBy: [
      { unitDimension: "asc" },
      { displayOrderTh: "asc" },
      { unitName: "asc" },
    ],
  });
  return rows;
}

/**
 * Create a RAW product + its single base unit under `tenantId`, atomically.
 * Input must already be zod-validated. `tenantId` and `type` are set
 * server-side — never trusted from input. Blank sku → auto-generated (Q3).
 */
export async function createProductLogic(
  tenantId: string,
  input: ProductInput
): Promise<ProductWithUnits> {
  let skuUsed: string | null = input.sku;
  try {
    return await withTenantContext(tenantId, async (tx) => {
      await assertValidBaseUnit(tx, input.baseUnitName, input.primaryDimension);
      skuUsed = input.sku ?? (await generateSku(tx, tenantId));

      const product = await tx.product.create({
        data: {
          tenantId,
          sku: skuUsed,
          name: input.name,
          nameEn: input.nameEn,
          type: "RAW",
          primaryDimension: input.primaryDimension,
          categoryId: input.categoryId,
          isActive: input.isActive,
        },
      });

      // The single base unit (ADR 0005): isBase + isDefaultBuyUnit, ratio 1.
      await tx.productUnit.create({
        data: {
          productId: product.id,
          unitName: input.baseUnitName,
          unitDimension: input.primaryDimension,
          toBaseRatio: 1,
          isBase: true,
          isDefaultBuyUnit: true,
          source: "system",
          displayOrder: 0,
        },
      });

      return tx.product.findFirstOrThrow({
        where: { id: product.id },
        include: { productUnits: true, category: true },
      });
    });
  } catch (e) {
    rethrowSkuConflict(e, skuUsed);
  }
}

/**
 * List a tenant's live products (soft-deleted excluded) with their units +
 * category, ordered to render the category tree (account → section → group →
 * name). Products with no category sort last (Postgres ASC NULLS LAST) → the
 * "ไม่มีหมวด" group.
 */
export async function getProductsLogic(
  tenantId: string
): Promise<ProductWithUnits[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.product.findMany({
      where: { tenantId, deletedAt: null },
      include: { productUnits: true, category: true },
      orderBy: [
        { category: { account: "asc" } },
        { category: { accountingSection: "asc" } },
        { category: { groupName: "asc" } },
        { name: "asc" },
      ],
    })
  );
}

/** Fetch one live product (with units + category) by id, scoped to `tenantId`. */
export async function getProductByIdLogic(
  tenantId: string,
  id: string
): Promise<ProductWithUnits | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { productUnits: true, category: true },
    })
  );
}

/**
 * Update a live product + its base unit, scoped to `tenantId` via `updateMany`
 * (cross-tenant id matches 0 rows → null, same rationale as the supplier
 * slice). The product row is matched FIRST; only if it matched do we touch the
 * base unit. Blank sku on update KEEPS the existing sku (never nulls it).
 */
export async function updateProductLogic(
  tenantId: string,
  id: string,
  input: ProductInput
): Promise<ProductWithUnits | null> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      await assertValidBaseUnit(tx, input.baseUnitName, input.primaryDimension);

      // Unchecked variant: includes the scalar FK `categoryId` (the checked
      // ProductUpdateManyMutationInput omits relation FKs). updateMany accepts both.
      const data: Prisma.ProductUncheckedUpdateManyInput = {
        name: input.name,
        nameEn: input.nameEn,
        primaryDimension: input.primaryDimension,
        categoryId: input.categoryId,
        isActive: input.isActive,
      };
      if (input.sku != null) data.sku = input.sku;

      const { count } = await tx.product.updateMany({
        where: { id, tenantId, deletedAt: null },
        data,
      });
      if (count === 0) return null;

      // Single base unit may have changed name/dimension (Q5); ratio stays 1.
      await tx.productUnit.updateMany({
        where: { productId: id, isBase: true },
        data: {
          unitName: input.baseUnitName,
          unitDimension: input.primaryDimension,
        },
      });

      return tx.product.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { productUnits: true, category: true },
      });
    });
  } catch (e) {
    rethrowSkuConflict(e, input.sku);
  }
}

/**
 * Soft-delete a product: stamp `Product.deletedAt` so it drops out of reads
 * but the row survives. Scoped to `tenantId` via `updateMany`. The base
 * ProductUnit rides along untouched (it has no deletedAt; invisible because
 * lists filter on the Product). Returns true if a row was soft-deleted.
 */
export async function deleteProductLogic(
  tenantId: string,
  id: string
): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    const { count } = await tx.product.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  });
}

// Re-export for callers that want the bare row type without relations.
export type { Product };
