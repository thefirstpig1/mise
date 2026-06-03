// ============================================================
// Mise — Supplier logic layer (Sprint 1 Part 5, Step 5; Q3 / ADR 0004)
// ============================================================
// Pure, testable business logic for suppliers. Each fn:
//   - takes `tenantId` as its FIRST argument (Q3),
//   - runs its reads/writes inside withTenantContext (ADR 0004), and
//   - filters/sets `tenantId` EXPLICITLY for isolation.
//
// Why explicit tenantId AND withTenantContext: per ADR 0004, RLS is
// enabled but not yet enforced against the app role (FORCE RLS is a
// Sprint 7 task), so withTenantContext's SET LOCAL is currently inert.
// Explicit filtering is what isolates tenants TODAY; withTenantContext
// wires the DB layer so Sprint 7 enforcement becomes a flip-the-switch.
//
// These *Logic fns are called directly by Server Components (reads) and
// by the "use server" wrappers in src/app/suppliers/actions.ts (writes,
// Step 6), which own auth (requireTenant) + zod parsing + Thai errors.
// ============================================================

import { Prisma, type Supplier } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { SupplierInput } from "@/lib/validations/supplier";
// MappingNotFoundError reused for the Q6 cascade (L3b). One-way import: the
// mapping module does NOT import supplier.ts, so this is acyclic.
import { MappingNotFoundError } from "@/server/supplier-product-mapping";

/**
 * Thrown when a supplier `code` collides with an existing one in the same
 * tenant (Prisma P2002 on the partial unique index from Step 3). The action
 * layer (Step 6) catches this and shows the Thai "รหัสซ้ำ" message (Q5a);
 * keeping it typed means we don't leak raw Prisma errors past this layer.
 */
export class SupplierCodeConflictError extends Error {
  constructor(public readonly code: string | null) {
    super(`Supplier code already exists in this tenant: ${code ?? "(none)"}`);
    this.name = "SupplierCodeConflictError";
  }
}

/**
 * Map a Prisma duplicate-code error (P2002 on the partial unique index) to the
 * typed SupplierCodeConflictError; pass any other error through unchanged.
 * BOTH create and update can hit that index whenever `code` is set, so they
 * share this so the action layer only ever sees the typed error (never raw P2002).
 */
function rethrowCodeConflict(e: unknown, code: string | null): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new SupplierCodeConflictError(code);
  }
  throw e;
}

/**
 * Create a supplier under `tenantId`. Input must already be validated by
 * supplierInputSchema (the action layer does this). `tenantId` is set
 * server-side here — never trusted from the input.
 */
export async function createSupplierLogic(
  tenantId: string,
  input: SupplierInput
): Promise<Supplier> {
  try {
    return await withTenantContext(tenantId, (tx) =>
      tx.supplier.create({ data: { tenantId, ...input } })
    );
  } catch (e) {
    rethrowCodeConflict(e, input.code);
  }
}

/**
 * List a tenant's suppliers, excluding soft-deleted rows (Q6), sorted by
 * nameFull (Q7 default). The explicit `tenantId` filter is what isolates
 * tenants while RLS is inert (ADR 0004). Returns active + inactive; the
 * active-only list default + toggle (Q7) is applied by the page layer.
 */
export async function getSuppliersLogic(tenantId: string): Promise<Supplier[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.supplier.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { nameFull: "asc" },
    })
  );
}

/**
 * Fetch one non-deleted supplier by id, scoped to `tenantId`. The tenantId
 * in the WHERE means a cross-tenant id simply returns null (findFirst) — no
 * separate ownership check needed. Used by the edit page (Step 7).
 */
export async function getSupplierByIdLogic(
  tenantId: string,
  id: string
): Promise<Supplier | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.supplier.findFirst({ where: { id, tenantId, deletedAt: null } })
  );
}

/**
 * Update a non-deleted supplier, scoped to `tenantId`. Returns the updated
 * row, or `null` if no row matched (wrong tenant, missing, or soft-deleted).
 *
 * We use `updateMany` (not `update`) on purpose: Prisma's `update` only
 * accepts a UNIQUE where (`id` alone), which would let one tenant overwrite
 * another's row while RLS is inert (ADR 0004). `updateMany` lets us put
 * `tenantId` in the WHERE, so a cross-tenant id matches 0 rows = no-op.
 */
export async function updateSupplierLogic(
  tenantId: string,
  id: string,
  input: SupplierInput
): Promise<Supplier | null> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const { count } = await tx.supplier.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { ...input },
      });
      if (count === 0) return null;
      return tx.supplier.findFirst({ where: { id, tenantId, deletedAt: null } });
    });
  } catch (e) {
    rethrowCodeConflict(e, input.code);
  }
}

/**
 * Soft-delete a supplier (Q6): stamp `deletedAt` so it drops out of every
 * read but the row (and its history) survives. Scoped to `tenantId` via
 * `updateMany` for the same reason as updateSupplierLogic. No restore in MVP.
 *
 * Returns `true` if a row was soft-deleted, `false` if none matched (wrong
 * tenant, missing, or already deleted) — lets the action layer 404 cleanly.
 */
export async function deleteSupplierLogic(
  tenantId: string,
  id: string,
  // L3b (Q6) cascade: ids of THIS supplier's live mappings the user chose to
  // soft-delete alongside the parent (empty = keep them as live orphans).
  mappingIdsToSoftDelete: string[] = []
): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    // Q6 cascade: mirror of deleteProductLogic, scoped by supplierId. Validate
    // THEN soft-delete the selected mappings in the SAME tx; any miss (foreign
    // tenant, wrong supplier, already-deleted) → MappingNotFoundError (rollback).
    // Empty list skips to the parent soft-delete (the orphan-keeping path).
    if (mappingIdsToSoftDelete.length > 0) {
      const cascadeWhere = {
        id: { in: mappingIdsToSoftDelete },
        tenantId,
        supplierId: id,
        deletedAt: null,
      };
      const live = await tx.supplierProductMapping.findMany({
        where: cascadeWhere,
        select: { id: true },
      });
      const found = new Set(live.map((m) => m.id));
      for (const mid of mappingIdsToSoftDelete) {
        if (!found.has(mid)) throw new MappingNotFoundError(mid);
      }
      await tx.supplierProductMapping.updateMany({
        where: cascadeWhere,
        data: { deletedAt: new Date() },
      });
    }

    const { count } = await tx.supplier.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  });
}
