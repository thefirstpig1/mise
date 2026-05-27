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

/** Product plus its units + category + (PREPPED only) a minimal parent
 *  projection — the shape reads return for the UI. `parent` joins on the FK
 *  WITHOUT filtering deletedAt so a PREPPED whose parent has since been
 *  soft-deleted still carries the parent's label (the form falls back to it
 *  when the picker — which is live-only — has no matching option, 7c). */
export type ProductWithUnits = Prisma.ProductGetPayload<{
  include: {
    productUnits: true;
    category: true;
    parentProduct: { select: { name: true; sku: true } };
  };
}>;

/** Minimal unit option for the form dropdown (NO Decimal → safe across RSC, Pitfall #20). */
export type UnitOption = { unitName: string; unitDimension: string };

/** Lightweight option for the PREPPED parent picker (7c). The form needs id +
 *  display fields (name · sku · [RAW/PREPPED]) only, NOT the heavy units/
 *  category payload — projected with `select` to keep the query small even
 *  when the tenant has many products. */
export type ProductParentOption = {
  id: string;
  name: string;
  sku: string;
  type: string;
};

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
 * Thrown by deleteProductLogic when the target product still has LIVE PREPPED
 * children (`parentProductId=id AND deletedAt:null`). Soft-deleted children
 * don't count (Q5 / ADR 0007). The action layer maps to a Thai message that
 * lists the blocking child names (truncated with "…และอีก N รายการ").
 */
export class ProductHasChildrenError extends Error {
  constructor(public readonly childNames: string[]) {
    super(
      `Cannot delete: product has ${childNames.length} live PREPPED child(ren)`
    );
    this.name = "ProductHasChildrenError";
  }
}

/**
 * Thrown when setting a product's parentProductId would create a self-reference
 * (X.parent = X) or a cycle (the new parent's ancestor chain reaches back to X).
 * Live-only ancestor-walk + visited-set guard (Q4 / ADR 0007).
 */
export class ProductParentCycleError extends Error {
  constructor(public readonly productId: string) {
    super(`Setting this parent would create a cycle through product ${productId}`);
    this.name = "ProductParentCycleError";
  }
}

/**
 * Thrown when the new parent edge would push the longest live chain through
 * the node past depth 5: `ancestorDepth(P)+1+descendantHeight(X) > 5`.
 * Decision #58 / Q4 / ADR 0007. `depth` is the formula's value, for diagnostics.
 */
export class ProductDepthExceededError extends Error {
  constructor(public readonly depth: number) {
    super(`PREPPED chain depth ${depth} exceeds the limit of 5`);
    this.name = "ProductDepthExceededError";
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
 * Walk DOWN from `rootId` and return the longest live descendant chain length
 * in EDGES (Decision #58 / ADR 0007). `where: { parentProductId, deletedAt: null }`
 * keeps the DFS to LIVE branches only. The visited-set guards against an
 * already-cyclic DB so the walk terminates even if Pitfall #28 has landed.
 * For a leaf (no live children) returns 0.
 */
async function descendantHeightLive(
  tx: PrismaClient,
  rootId: string
): Promise<number> {
  const visited = new Set<string>();
  async function dfs(nodeId: string): Promise<number> {
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);
    const children = await tx.product.findMany({
      where: { parentProductId: nodeId, deletedAt: null },
      select: { id: true },
    });
    let max = 0;
    for (const c of children) {
      const h = 1 + (await dfs(c.id));
      if (h > max) max = h;
    }
    return max;
  }
  return dfs(rootId);
}

/**
 * Guard the new edge `X.parent = P` for a PREPPED write (ADR 0007). Rejects:
 *   - self-reference (P === X)
 *   - cycle (X reachable from P via the live-or-soft ancestor chain), with a
 *     visited-set guard so an already-cyclic DB still terminates
 *   - depth: requires `ancestorDepth(P→root) + 1 + descendantHeight(X) ≤ 4`,
 *     equivalent to a chain of at most 5 NODES (the cap from Decision #58).
 *     Both walks are LIVE-only (`deletedAt:null`): the upward walker FOLLOWS
 *     through soft-deleted ancestors so the chain doesn't break, but only
 *     INCREMENTS the count for live ones. The descendant DFS short-circuits at
 *     soft-deleted branches via the where clause.
 *
 * On CREATE pass `selfId = null` → no self-ref check, descendantHeight=0
 * (X has no children yet), the descendant DFS is skipped entirely.
 *
 * Caller MUST run `assertRefBelongsToTenant(tx, tenantId, "product", parentId)`
 * BEFORE this — that closes the missing/soft-deleted/cross-tenant cases first.
 */
async function assertParentValid(
  tx: PrismaClient,
  parentId: string,
  selfId: string | null
): Promise<void> {
  if (selfId !== null && parentId === selfId) {
    throw new ProductParentCycleError(selfId);
  }

  // Ancestor walk: count P's LIVE ancestors only — NOT P itself. The "+1" in
  // the formula stands for X (the node being parented), not P. P is in the
  // visited-set so the cycle guard catches P.parent → … → P, but it doesn't
  // increment ancestorDepth.
  const pNode: { deletedAt: Date | null; parentProductId: string | null } | null =
    await tx.product.findUnique({
      where: { id: parentId },
      select: { deletedAt: true, parentProductId: true },
    });
  let ancestorDepth = 0;
  const visited = new Set<string>([parentId]);
  let current: string | null = pNode?.parentProductId ?? null;
  while (current !== null) {
    if (selfId !== null && current === selfId) {
      throw new ProductParentCycleError(selfId);
    }
    if (visited.has(current)) {
      throw new ProductParentCycleError(current);
    }
    visited.add(current);
    const node: { deletedAt: Date | null; parentProductId: string | null } | null =
      await tx.product.findUnique({
        where: { id: current },
        select: { deletedAt: true, parentProductId: true },
      });
    if (node === null) break;
    if (node.deletedAt === null) ancestorDepth += 1;
    current = node.parentProductId;
  }

  const descendantHeight =
    selfId === null ? 0 : await descendantHeightLive(tx, selfId);

  const formula = ancestorDepth + 1 + descendantHeight;
  if (formula > 4) {
    // formula > 4 ↔ chain > 5 nodes (ADR 0007).
    throw new ProductDepthExceededError(formula);
  }
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
 * Create a product (RAW or PREPPED, per `input.type`) + its single base unit
 * under `tenantId`, atomically. Input must already be zod-validated.
 * `tenantId` is set server-side — never trusted from input. For RAW the server
 * also forces `parentProductId` and `yieldPercent` to null (defense in depth
 * on top of zod). For PREPPED the parent ref is validated for tenant ownership
 * and the resulting chain is checked for cycle + 5-node depth cap (ADR 0007).
 * Blank sku → auto-generated (Q3).
 */
export async function createProductLogic(
  tenantId: string,
  input: ProductInput
): Promise<ProductWithUnits> {
  let skuUsed: string | null = input.sku;
  const isPrepped = input.type === "PREPPED";
  const parentId = isPrepped ? input.parentProductId : null;
  const yieldPct = isPrepped ? input.yieldPercent : null;
  try {
    return await withTenantContext(tenantId, async (tx) => {
      await assertValidBaseUnit(tx, input.baseUnitName, input.primaryDimension);
      await assertRefBelongsToTenant(tx, tenantId, "category", input.categoryId);
      if (isPrepped) {
        await assertRefBelongsToTenant(tx, tenantId, "product", parentId);
        // parentId is non-null on PREPPED (zod superRefine); assertRefBelongs
        // would have thrown above if it were null/missing/cross-tenant.
        await assertParentValid(tx, parentId as string, null);
      }
      skuUsed = input.sku ?? (await generateSku(tx, tenantId));

      const product = await tx.product.create({
        data: {
          tenantId,
          sku: skuUsed,
          name: input.name,
          nameEn: input.nameEn,
          type: input.type,
          primaryDimension: input.primaryDimension,
          categoryId: input.categoryId,
          parentProductId: parentId,
          yieldPercent: yieldPct,
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
        include: {
          productUnits: true,
          category: true,
          parentProduct: { select: { name: true, sku: true } },
        },
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
      include: {
        productUnits: true,
        category: true,
        parentProduct: { select: { name: true, sku: true } },
      },
      orderBy: [
        { category: { account: "asc" } },
        { category: { accountingSection: "asc" } },
        { category: { groupName: "asc" } },
        { name: "asc" },
      ],
    })
  );
}

/** Fetch one live product (with units + category + parent label) by id, scoped to `tenantId`. */
export async function getProductByIdLogic(
  tenantId: string,
  id: string
): Promise<ProductWithUnits | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.product.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: {
        productUnits: true,
        category: true,
        parentProduct: { select: { name: true, sku: true } },
      },
    })
  );
}

/**
 * 7c parent picker: every LIVE product of the tenant projected down to id +
 * name + sku + type. The caller (edit page) is responsible for filtering self
 * out — keeping that filter at the page layer avoids passing `selfId` through
 * the logic boundary just for one UI concern. Soft-deleted products are
 * excluded (live-only), so a stale parent on a PREPPED product won't appear
 * here — the form's <select> will show no selected option in that case and
 * the user must re-pick (acceptable for MVP; cycle/depth guard runs server-side).
 */
export async function getProductParentOptionsLogic(
  tenantId: string
): Promise<ProductParentOption[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, sku: true, type: true },
      orderBy: { name: "asc" },
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
  const isPrepped = input.type === "PREPPED";
  const parentId = isPrepped ? input.parentProductId : null;
  const yieldPct = isPrepped ? input.yieldPercent : null;
  try {
    return await withTenantContext(tenantId, async (tx) => {
      await assertValidBaseUnit(tx, input.baseUnitName, input.primaryDimension);
      await assertRefBelongsToTenant(tx, tenantId, "category", input.categoryId);
      if (isPrepped) {
        await assertRefBelongsToTenant(tx, tenantId, "product", parentId);
        // selfId = id → catches self-ref + cycle + depth incl. descendantHeight.
        await assertParentValid(tx, parentId as string, id);
      }

      // Unchecked variant: includes the scalar FK `categoryId` (the checked
      // ProductUpdateManyMutationInput omits relation FKs). updateMany accepts both.
      // type / parentProductId / yieldPercent are always written so a
      // PREPPED→RAW flip clears the stale parent + yield (Q6 server-force).
      const data: Prisma.ProductUncheckedUpdateManyInput = {
        name: input.name,
        nameEn: input.nameEn,
        type: input.type,
        primaryDimension: input.primaryDimension,
        categoryId: input.categoryId,
        parentProductId: parentId,
        yieldPercent: yieldPct,
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
        include: {
          productUnits: true,
          category: true,
          parentProduct: { select: { name: true, sku: true } },
        },
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
 *
 * Blocks the delete (ProductHasChildrenError) when the product still has
 * LIVE PREPPED children — soft-deleted children don't count (Q5 / ADR 0007).
 * The pre-check is in the same `withTenantContext` so it's tenant-scoped via
 * the explicit `tenantId` filter; cross-tenant delete attempts see no children
 * AND no matching row to update → returns false (unchanged behavior).
 */
export async function deleteProductLogic(
  tenantId: string,
  id: string
): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    const liveChildren = await tx.product.findMany({
      where: { parentProductId: id, tenantId, deletedAt: null },
      select: { name: true },
    });
    if (liveChildren.length > 0) {
      throw new ProductHasChildrenError(liveChildren.map((c) => c.name));
    }
    const { count } = await tx.product.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  });
}

// Re-export for callers that want the bare row type without relations.
export type { Product };
