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

/**
 * Thrown when a ProductUnit name collides within the same product (Prisma P2002
 * on @@unique([productId, unitName])). 7b makes this reachable (multi-unit);
 * 7a could not. Distinguished from a sku conflict via P2002 meta.target.
 */
export class ProductUnitNameConflictError extends Error {
  constructor(public readonly unitName: string | null) {
    super(
      `Product unit name already exists on this product: ${unitName ?? "(unknown)"}`
    );
    this.name = "ProductUnitNameConflictError";
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

/**
 * Thrown when a user-supplied FK (e.g. categoryId) points at a row that is
 * missing, soft-deleted, or owned by another tenant. RLS is inert until
 * Sprint 7 (ADR 0004), so we must verify tenant ownership of referenced rows
 * in the app layer. `kind` identifies WHICH reference failed so the action
 * layer can attach the Thai error to the right field.
 */
export class CrossTenantReferenceError extends Error {
  constructor(
    public readonly kind: TenantScopedRef,
    public readonly id: string
  ) {
    super(`Referenced ${kind} "${id}" does not belong to this tenant`);
    this.name = "CrossTenantReferenceError";
  }
}

/**
 * Map a Prisma P2002 to a typed conflict error, distinguished by which unique
 * index fired (Pitfall #24): ProductUnit's (product_id, unit_name) → unit-name
 * conflict, otherwise the product `sku` index. 7b makes the unit-name case
 * reachable (multi-unit). Non-P2002 errors pass through unchanged.
 */
function rethrowOnUniqueConflict(e: unknown, sku: string | null): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = e.meta?.target;
    const targetStr = Array.isArray(target)
      ? target.join(",")
      : String(target ?? "");
    if (targetStr.includes("unit_name")) {
      throw new ProductUnitNameConflictError(null);
    }
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
 * Tenant-scoped models a user-supplied FK can point at. Every entry must expose
 * `{ id, tenantId, deletedAt }`. Extend as new FKs land — 7b adds nothing new
 * (parentProductId is also `"product"`); Sprint 5 recipe refs reuse this too.
 */
type TenantScopedRef = "category" | "product";

/**
 * Guard: a referenced row (by `id`) must be a LIVE row owned by `tenantId`.
 * `id == null` (FK not set) is a no-op. Throws CrossTenantReferenceError if the
 * row is missing, soft-deleted, or belongs to another tenant — closing the
 * cross-tenant FK hole while RLS is inert (ADR 0004). Generic over any
 * tenant-scoped model with `{ tenantId, deletedAt }`; the single cast bridges
 * Prisma's per-model delegate types (the `where`/`select` shapes stay typed).
 *
 * Reusable: 7b passes kind="product" for parentProductId. When a second module
 * needs this, lift it (+ CrossTenantReferenceError + TenantScopedRef) to src/lib.
 */
async function assertRefBelongsToTenant(
  tx: PrismaClient,
  tenantId: string,
  kind: TenantScopedRef,
  id: string | null | undefined
): Promise<void> {
  if (id == null) return;
  const delegate = tx[kind] as unknown as {
    findFirst(args: {
      where: { id: string; tenantId: string; deletedAt: null };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  const row = await delegate.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!row) throw new CrossTenantReferenceError(kind, id);
}

/**
 * Names of all unit_template entries for a dimension. Used to tag an additional
 * unit's `source`: a name that matches a template of the SAME dimension is
 * "system", otherwise "custom" (a packaging name like กระสอบ). The ratio stays
 * product-specific regardless (ADR 0006). One query per write — small N.
 */
async function templateNamesForDimension(
  tx: PrismaClient,
  dimension: string
): Promise<Set<string>> {
  const rows = await tx.unitTemplate.findMany({
    where: { unitDimension: dimension },
    select: { unitName: true },
  });
  return new Set(rows.map((r) => r.unitName));
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
      await assertRefBelongsToTenant(tx, tenantId, "category", input.categoryId);
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

      // Default buy unit defaults to the base when not specified (ADR 0005).
      const defaultName = input.defaultBuyUnitName ?? input.baseUnitName;
      const templateNames = await templateNamesForDimension(
        tx,
        input.primaryDimension
      );

      // The base unit (ADR 0005): isBase, ratio 1, always a template unit.
      await tx.productUnit.create({
        data: {
          productId: product.id,
          unitName: input.baseUnitName,
          unitDimension: input.primaryDimension,
          toBaseRatio: 1,
          isBase: true,
          isDefaultBuyUnit: defaultName === input.baseUnitName,
          source: "system",
          displayOrder: 0,
        },
      });

      // Additional units (7b): same dimension (ADR 0006), ratio relative to base.
      if (input.additionalUnits.length > 0) {
        await tx.productUnit.createMany({
          data: input.additionalUnits.map((u, i) => ({
            productId: product.id,
            unitName: u.unitName,
            unitDimension: input.primaryDimension,
            toBaseRatio: u.toBaseRatio,
            isBase: false,
            isDefaultBuyUnit: defaultName === u.unitName,
            source: templateNames.has(u.unitName) ? "system" : "custom",
            displayOrder: i + 1,
          })),
        });
      }

      return tx.product.findFirstOrThrow({
        where: { id: product.id },
        include: { productUnits: true, category: true },
      });
    });
  } catch (e) {
    rethrowOnUniqueConflict(e, skuUsed);
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
      await assertRefBelongsToTenant(tx, tenantId, "category", input.categoryId);

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

      // --- units reconcile (7b, Q5-C) ---
      const defaultRequested = input.defaultBuyUnitName ?? input.baseUnitName;
      const finalNames = new Set([
        input.baseUnitName,
        ...input.additionalUnits.map((u) => u.unitName),
      ]);
      // Defensive: if the requested default isn't among the final units (e.g. it
      // was the removed unit and the form didn't reset it), fall back to base.
      const effectiveDefault = finalNames.has(defaultRequested)
        ? defaultRequested
        : input.baseUnitName;
      const templateNames = await templateNamesForDimension(
        tx,
        input.primaryDimension
      );

      // Base unit updated in place — id stays stable (ADR 0005); ratio stays 1.
      await tx.productUnit.updateMany({
        where: { productId: id, isBase: true },
        data: {
          unitName: input.baseUnitName,
          unitDimension: input.primaryDimension,
          isDefaultBuyUnit: effectiveDefault === input.baseUnitName,
        },
      });

      // Additional units diffed by unitName. Delete the removed ones FIRST so a
      // rename (= delete old + create new) can't transiently collide on
      // @@unique([productId, unitName]). Removal is a hard delete (Q5c —
      // ProductUnit has no deletedAt by design, ADR 0005).
      const existing = await tx.productUnit.findMany({
        where: { productId: id, isBase: false },
        select: { id: true, unitName: true },
      });
      const submittedNames = new Set(
        input.additionalUnits.map((u) => u.unitName)
      );
      const toDelete = existing
        .filter((u) => !submittedNames.has(u.unitName))
        .map((u) => u.id);
      if (toDelete.length > 0) {
        await tx.productUnit.deleteMany({ where: { id: { in: toDelete } } });
      }

      // Upsert each submitted additional unit, matched to an existing row by name.
      const existingIdByName = new Map(existing.map((u) => [u.unitName, u.id]));
      for (let i = 0; i < input.additionalUnits.length; i++) {
        const u = input.additionalUnits[i];
        const fields = {
          unitDimension: input.primaryDimension,
          toBaseRatio: u.toBaseRatio,
          isBase: false,
          isDefaultBuyUnit: effectiveDefault === u.unitName,
          source: templateNames.has(u.unitName) ? "system" : "custom",
          displayOrder: i + 1,
        };
        const existingId = existingIdByName.get(u.unitName);
        if (existingId) {
          await tx.productUnit.update({ where: { id: existingId }, data: fields });
        } else {
          await tx.productUnit.create({
            data: { productId: id, unitName: u.unitName, ...fields },
          });
        }
      }

      return tx.product.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: { productUnits: true, category: true },
      });
    });
  } catch (e) {
    rethrowOnUniqueConflict(e, input.sku);
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
