// ============================================================
// Mise — SupplierProductMapping logic layer (Sprint 1 Part 8 L3a; ADR 0009)
// ============================================================
// Same pattern as src/server/{product,supplier}.ts: each fn takes `tenantId`
// as its FIRST argument, runs inside withTenantContext, and filters/sets
// `tenantId` EXPLICITLY (explicit filtering isolates tenants TODAY; RLS is
// inert until Sprint 7 — ADR 0004). Input must already be zod-validated by
// supplierProductMappingInputSchema (the action layer, L4, does this).
//
// Locked decisions this layer implements (grill Q3b/Q4/Q5i, ADR 0009):
//   - Q4 append + supersede time-series: a new price for an existing
//     (tenant, supplier, product, branch) closes the prior OPEN row
//     (old.effectiveTo = new.effectiveFrom − 1 day) and inserts a new open
//     row (effectiveTo = null), in one tx. Overlap with a row that is NOT a
//     clean open-predecessor supersede = BLOCK (MappingOverlapError).
//     Future-dated (effectiveFrom > today) is allowed.
//   - Q5(i) write-time orderUnit guard: orderUnitId, if set, must be a
//     ProductUnit of THIS product (matching productId) — else OrderUnitMismatchError.
//   - Q3b isPreferred singleton: setting isPreferred=true normalizes every
//     OTHER live mapping for the same (product, branchId) to false in the same
//     tx (mirror 7b isDefaultBuyUnit "move-the-flag").
//
// Cross-slice guards (Q5ii ProductUnit-deletion guard, Q6 parent-delete cascade)
// are L3b — they live in product.ts / supplier.ts and are OUT of this file.
//
// Dates are @db.Date (no time component). Both DB reads and zod's coerced input
// land on UTC-midnight Date objects, so day arithmetic is plain 24h ms math
// (minusOneDay) and day equality is getTime() equality (sameDay).
// ============================================================

import { Prisma, type PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { SupplierProductMappingInput } from "@/lib/validations/supplier-product-mapping";
// CrossTenantReferenceError is reused from the product slice (ADR 0009 note;
// product.ts flags lifting the helper to src/lib once a 2nd module needs it —
// deferred so this slice does not edit product.ts, which is L3b territory).
import { CrossTenantReferenceError } from "@/server/product";

/**
 * A mapping row plus the relations the UI/read paths need: supplier, product,
 * branch (nullable = tenant default), and orderUnit (nullable). Decimal fields
 * (currentUnitPrice, minOrderQty) still need a `*-view.ts` serializer before
 * crossing to a Client Component (Pitfall #20) — that is L5, not here.
 */
export type MappingWithRefs = Prisma.SupplierProductMappingGetPayload<{
  include: { supplier: true; product: true; branch: true; orderUnit: true };
}>;

/** List filter mode (Q6): "active" hides rows whose parent supplier/product is
 *  soft-deleted; "all" includes those orphan rows, sorted to the end. */
export type MappingListMode = "active" | "all";

/** The relation payload returned by every read path (one source of truth). */
const MAPPING_INCLUDE = {
  supplier: true,
  product: true,
  branch: true,
  orderUnit: true,
} as const;

/**
 * Thrown when a new/updated mapping's date range overlaps an existing live row
 * for the same (tenant, supplier, product, branch) composite key and cannot be
 * cleanly superseded (Q4 overlap-block). The app guard is the PRIMARY gate; the
 * partial unique index (Q10) is a defense-in-depth backstop. The action layer
 * (L4) maps this — and any raw P2002 from that index — to a Thai field error.
 */
export class MappingOverlapError extends Error {
  constructor(public readonly conflictingId: string | null = null) {
    super(
      `Mapping date range overlaps an existing live row${conflictingId ? ` (${conflictingId})` : ""}`
    );
    this.name = "MappingOverlapError";
  }
}

/**
 * Thrown when `orderUnitId` is set but does not point at a ProductUnit of THIS
 * mapping's product (Q5i write-time guard). Distinct from a cross-tenant
 * reference: the unit may be perfectly valid, just for the wrong product.
 */
export class OrderUnitMismatchError extends Error {
  constructor(
    public readonly orderUnitId: string,
    public readonly productId: string
  ) {
    super(`orderUnit "${orderUnitId}" is not a unit of product "${productId}"`);
    this.name = "OrderUnitMismatchError";
  }
}

/**
 * Thrown by paths that require an existing live mapping when the id does not
 * resolve to one owned by `tenantId` (missing, soft-deleted, or cross-tenant).
 * Reads (getById) return null instead; this is exported for the action layer.
 */
export class MappingNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`SupplierProductMapping not found: ${id}`);
    this.name = "MappingNotFoundError";
  }
}

// --- date helpers (day-precision; @db.Date values are UTC midnight) ---
const DAY_MS = 86_400_000;
/** A sentinel "open end" far past any real effectiveTo, for interval math. */
const OPEN_END = new Date(8_640_000_000_000_000);
const minusOneDay = (d: Date): Date => new Date(d.getTime() - DAY_MS);
const sameDay = (a: Date, b: Date): boolean => a.getTime() === b.getTime();
const sameDayNullable = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : sameDay(a, b);

/** Two date ranges overlap iff each starts on/before the other's (open) end. */
const overlaps = (
  aFrom: Date,
  aTo: Date | null,
  bFrom: Date,
  bTo: Date | null
): boolean => aFrom <= (bTo ?? OPEN_END) && bFrom <= (aTo ?? OPEN_END);

/**
 * Tenant-scoped models a mapping FK can point at — each exposes
 * `{ id, tenantId, deletedAt }`. (ProductUnit is NOT here: it has no tenantId
 * and is validated against its product by assertOrderUnitOfProduct instead.)
 */
type MappingRefKind = "supplier" | "product" | "branch";

/**
 * Guard: a referenced row (by `id`) must be a LIVE row owned by `tenantId`.
 * `id == null` (FK not set) is a no-op. Throws CrossTenantReferenceError if the
 * row is missing, soft-deleted, or belongs to another tenant — closing the
 * cross-tenant FK hole while RLS is inert (ADR 0004). Local copy of the
 * product.ts helper (kept here to avoid editing product.ts, an L3b file).
 */
async function assertRefBelongsToTenant(
  tx: PrismaClient,
  tenantId: string,
  kind: MappingRefKind,
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
  // CrossTenantReferenceError.kind is narrowly typed ("category" | "product")
  // in product.ts; the runtime message uses the real `kind` string, the cast
  // only satisfies tsc (the union overlaps "product").
  if (!row) throw new CrossTenantReferenceError(kind as "product", id);
}

/**
 * Q5i guard: `orderUnitId`, if set, must be a ProductUnit of THIS product
 * (matching productId). ProductUnit has no deletedAt (ADR 0005) so existence +
 * productId match is the whole check. `null` (no order unit chosen) is a no-op.
 */
async function assertOrderUnitOfProduct(
  tx: PrismaClient,
  productId: string,
  orderUnitId: string | null
): Promise<void> {
  if (orderUnitId == null) return;
  const unit = await tx.productUnit.findFirst({
    where: { id: orderUnitId, productId },
    select: { id: true },
  });
  if (!unit) throw new OrderUnitMismatchError(orderUnitId, productId);
}

/** A mapping's time-series identity (the composite key minus effectiveFrom). */
type SeriesKey = {
  supplierId: string;
  productId: string;
  branchId: string | null;
};

/**
 * Q3b: enforce ≤1 preferred mapping per (product, branch-scope) among live rows
 * by flipping every OTHER preferred sibling to false (mirror 7b isDefaultBuyUnit
 * "move-the-flag"). `branchId = null` scopes the tenant-default; a set branchId
 * scopes that branch override. Run inside the write tx, BEFORE setting the new
 * row preferred. `exceptId` keeps the row being updated from flipping itself.
 */
async function normalizePreferred(
  tx: PrismaClient,
  tenantId: string,
  productId: string,
  branchId: string | null,
  exceptId: string | null
): Promise<void> {
  await tx.supplierProductMapping.updateMany({
    where: {
      tenantId,
      productId,
      branchId,
      deletedAt: null,
      isPreferred: true,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    data: { isPreferred: false },
  });
}

/**
 * Q4 append+supersede + overlap-block for a new/updated row [from, to] under
 * `key`. For each LIVE sibling (same composite key, excluding `selfId`) whose
 * range overlaps [from, to]:
 *   - if the sibling is OPEN (effectiveTo null) and starts strictly before the
 *     new row, supersede it: close it at `from − 1 day`;
 *   - otherwise the overlap is not a clean supersede → MappingOverlapError.
 * Same-day starts (sibling.from === from) are NOT supersedable → block, which
 * also makes a duplicate composite key reject (M15) before the partial unique
 * index would fire.
 */
async function applySupersede(
  tx: PrismaClient,
  tenantId: string,
  key: SeriesKey,
  from: Date,
  to: Date | null,
  selfId: string | null
): Promise<void> {
  const siblings = await tx.supplierProductMapping.findMany({
    where: {
      tenantId,
      supplierId: key.supplierId,
      productId: key.productId,
      branchId: key.branchId,
      deletedAt: null,
      ...(selfId ? { id: { not: selfId } } : {}),
    },
  });
  for (const sib of siblings) {
    if (!overlaps(from, to, sib.effectiveFrom, sib.effectiveTo)) continue;
    const isOpenPredecessor =
      sib.effectiveTo === null && sib.effectiveFrom < from;
    if (!isOpenPredecessor) throw new MappingOverlapError(sib.id);
    await tx.supplierProductMapping.update({
      where: { id: sib.id },
      data: { effectiveTo: minusOneDay(from) },
    });
  }
}

/**
 * Create a mapping under `tenantId`, applying the tenant-ref guards, the Q5i
 * orderUnit guard, the Q4 append+supersede rule, and the Q3b isPreferred
 * singleton — all in one tx. Input must already be zod-validated.
 */
export async function createSupplierProductMappingLogic(
  tenantId: string,
  input: SupplierProductMappingInput
): Promise<MappingWithRefs> {
  return withTenantContext(tenantId, async (tx) => {
    await assertRefBelongsToTenant(tx, tenantId, "supplier", input.supplierId);
    await assertRefBelongsToTenant(tx, tenantId, "product", input.productId);
    await assertRefBelongsToTenant(tx, tenantId, "branch", input.branchId);
    await assertOrderUnitOfProduct(tx, input.productId, input.orderUnitId);

    const key: SeriesKey = {
      supplierId: input.supplierId,
      productId: input.productId,
      branchId: input.branchId,
    };
    await applySupersede(tx, tenantId, key, input.effectiveFrom, input.effectiveTo, null);

    if (input.isPreferred) {
      await normalizePreferred(tx, tenantId, input.productId, input.branchId, null);
    }

    const created = await tx.supplierProductMapping.create({
      data: { tenantId, ...input },
    });
    return tx.supplierProductMapping.findFirstOrThrow({
      where: { id: created.id },
      include: MAPPING_INCLUDE,
    });
  });
}

/**
 * Update a live mapping by id, scoped to `tenantId`. Identity fields
 * (supplier/product/branch) define the time-series and are NOT changed here —
 * the existing row's identity is kept and the input's identity fields ignored.
 * Mutable fields (code/name/orderUnit/price/min/lead/preferred/effectiveTo, and
 * effectiveFrom) are written. When effectiveFrom moves, the predecessor that
 * was auto-closed to abut the OLD start is re-stretched to the new start − 1
 * day (Q4 supersede recompute), then the new position is re-checked for overlap.
 * Returns null if no live row matched (wrong tenant, missing, or soft-deleted).
 */
export async function updateSupplierProductMappingLogic(
  tenantId: string,
  id: string,
  input: SupplierProductMappingInput
): Promise<MappingWithRefs | null> {
  return withTenantContext(tenantId, async (tx) => {
    const existing = await tx.supplierProductMapping.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!existing) return null;

    // orderUnit is validated against the EXISTING product (identity is immutable).
    await assertOrderUnitOfProduct(tx, existing.productId, input.orderUnitId);

    const key: SeriesKey = {
      supplierId: existing.supplierId,
      productId: existing.productId,
      branchId: existing.branchId,
    };
    const newFrom = input.effectiveFrom;
    const newTo = input.effectiveTo;
    const fromChanged = !sameDay(existing.effectiveFrom, newFrom);

    if (fromChanged || !sameDayNullable(existing.effectiveTo, newTo)) {
      if (fromChanged) {
        // The predecessor whose effectiveTo was auto-closed to abut the OLD
        // start (effectiveTo === oldFrom − 1) tracks this row: re-stretch (or
        // shrink) it to abut the NEW start.
        const prevAbut = minusOneDay(existing.effectiveFrom);
        const siblings = await tx.supplierProductMapping.findMany({
          where: { tenantId, ...key, deletedAt: null, id: { not: id } },
        });
        const pred = siblings.find(
          (s) =>
            s.effectiveTo !== null &&
            sameDay(s.effectiveTo, prevAbut) &&
            s.effectiveFrom < newFrom
        );
        if (pred) {
          await tx.supplierProductMapping.update({
            where: { id: pred.id },
            data: { effectiveTo: minusOneDay(newFrom) },
          });
        }
      }
      await applySupersede(tx, tenantId, key, newFrom, newTo, id);
    }

    if (input.isPreferred) {
      await normalizePreferred(tx, tenantId, existing.productId, existing.branchId, id);
    }

    await tx.supplierProductMapping.update({
      where: { id },
      data: {
        supplierItemCode: input.supplierItemCode,
        supplierItemName: input.supplierItemName,
        orderUnitId: input.orderUnitId,
        currentUnitPrice: input.currentUnitPrice,
        minOrderQty: input.minOrderQty,
        leadTimeDays: input.leadTimeDays,
        isPreferred: input.isPreferred,
        effectiveFrom: newFrom,
        effectiveTo: newTo,
      },
    });
    return tx.supplierProductMapping.findFirst({
      where: { id, tenantId },
      include: MAPPING_INCLUDE,
    });
  });
}

/** Soft-delete a mapping (stamp deletedAt), scoped to `tenantId` via updateMany
 *  (a cross-tenant id matches 0 rows → false). No cascade (parent-delete cascade
 *  onto mappings is L3b). Returns true if a row was soft-deleted. */
export async function deleteSupplierProductMappingLogic(
  tenantId: string,
  id: string
): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    const { count } = await tx.supplierProductMapping.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  });
}

/** Fetch one live mapping (with relations) by id, scoped to `tenantId`.
 *  Returns null if missing, soft-deleted, or cross-tenant. */
export async function getSupplierProductMappingByIdLogic(
  tenantId: string,
  id: string
): Promise<MappingWithRefs | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.supplierProductMapping.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: MAPPING_INCLUDE,
    })
  );
}

/**
 * Partition orphan rows (whose parent relation is soft-deleted) to the END,
 * preserving the DB order within each group. Used by the "all" list mode (Q6).
 */
function orphansLast(
  rows: MappingWithRefs[],
  isOrphan: (r: MappingWithRefs) => boolean
): MappingWithRefs[] {
  return [...rows.filter((r) => !isOrphan(r)), ...rows.filter(isOrphan)];
}

/**
 * List a product's mappings (one product → its price list). Live mappings only
 * (soft-deleted rows live in history, Q6). "active" hides rows whose supplier is
 * soft-deleted (orphans); "all" includes them, sorted to the end. Ordered by
 * supplier name, then effectiveFrom DESC (newest price first).
 */
export async function getProductMappingsLogic(
  tenantId: string,
  productId: string,
  mode: MappingListMode = "active"
): Promise<MappingWithRefs[]> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.supplierProductMapping.findMany({
      where: {
        tenantId,
        productId,
        deletedAt: null,
        ...(mode === "active" ? { supplier: { deletedAt: null } } : {}),
      },
      include: MAPPING_INCLUDE,
      orderBy: [{ supplier: { nameFull: "asc" } }, { effectiveFrom: "desc" }],
    });
    return mode === "active"
      ? rows
      : orphansLast(rows, (r) => r.supplier.deletedAt !== null);
  });
}

/**
 * List a supplier's mappings (supplier-centric mirror of getProductMappingsLogic).
 * "active" hides rows whose product is soft-deleted; "all" sorts them to the end.
 * Ordered by product name, then effectiveFrom DESC.
 */
export async function getSupplierMappingsLogic(
  tenantId: string,
  supplierId: string,
  mode: MappingListMode = "active"
): Promise<MappingWithRefs[]> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.supplierProductMapping.findMany({
      where: {
        tenantId,
        supplierId,
        deletedAt: null,
        ...(mode === "active" ? { product: { deletedAt: null } } : {}),
      },
      include: MAPPING_INCLUDE,
      orderBy: [{ product: { name: "asc" } }, { effectiveFrom: "desc" }],
    });
    return mode === "active"
      ? rows
      : orphansLast(rows, (r) => r.product.deletedAt !== null);
  });
}

/**
 * Chronological price history for one (product, supplier, branch) tuple,
 * ordered effectiveFrom DESC — INCLUDES soft-deleted rows (financial audit
 * trail, Q6/Q9). `branchId = null` = the tenant-default series.
 */
export async function getPriceHistoryLogic(
  tenantId: string,
  productId: string,
  supplierId: string,
  branchId: string | null
): Promise<MappingWithRefs[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.supplierProductMapping.findMany({
      where: { tenantId, productId, supplierId, branchId },
      include: MAPPING_INCLUDE,
      orderBy: { effectiveFrom: "desc" },
    })
  );
}
