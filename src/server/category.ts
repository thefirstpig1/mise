// ============================================================
// Mise — Category logic layer (Sprint 1 Part 6; Q3 / ADR 0004)
// ============================================================
// Same pattern as src/server/supplier.ts: each fn takes `tenantId` as its
// FIRST argument, runs inside withTenantContext, and filters/sets `tenantId`
// EXPLICITLY. Explicit filtering is what isolates tenants TODAY (RLS is
// enabled but inert until Sprint 7 — ADR 0004); withTenantContext wires the
// DB layer so Sprint 7 enforcement is flip-a-switch.
//
// Reads are called directly by Server Components; writes go through the
// "use server" wrappers in src/app/categories/actions.ts.
// ============================================================

import { Prisma, type Category } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type { CategoryInput } from "@/lib/validations/category";

/**
 * Thrown when a category's (account, accountingSection, groupName) triple
 * collides with an existing row in the same tenant (Prisma P2002 on the
 * @@unique). The action layer maps this to a Thai message.
 *
 * NOTE: the @@unique is a FULL unique (it does NOT exclude soft-deleted
 * rows), so a triple that was soft-deleted still blocks re-creating the same
 * triple. Acceptable for MVP; if it bites, switch to a partial unique index
 * like the supplier slice did (prisma/manual/).
 */
export class CategoryConflictError extends Error {
  constructor(
    public readonly triple: {
      account: string;
      accountingSection: string;
      groupName: string;
    }
  ) {
    super(
      `Category already exists in this tenant: ${triple.account}/${triple.accountingSection}/${triple.groupName}`
    );
    this.name = "CategoryConflictError";
  }
}

/** Map Prisma P2002 (duplicate triple) → typed CategoryConflictError; pass others through. */
function rethrowConflict(e: unknown, input: CategoryInput): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new CategoryConflictError({
      account: input.account,
      accountingSection: input.accountingSection,
      groupName: input.groupName,
    });
  }
  throw e;
}

/** Create a category under `tenantId`. Input must already be zod-validated. */
export async function createCategoryLogic(
  tenantId: string,
  input: CategoryInput
): Promise<Category> {
  try {
    return await withTenantContext(tenantId, (tx) =>
      tx.category.create({ data: { tenantId, ...input } })
    );
  } catch (e) {
    rethrowConflict(e, input);
  }
}

/**
 * List a tenant's live categories (soft-deleted excluded), sorted to render a
 * stable tree: account → accountingSection → groupName.
 */
export async function getCategoriesLogic(tenantId: string): Promise<Category[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.category.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: [
        { account: "asc" },
        { accountingSection: "asc" },
        { groupName: "asc" },
      ],
    })
  );
}

/** Fetch one live category by id, scoped to `tenantId` (cross-tenant id → null). */
export async function getCategoryByIdLogic(
  tenantId: string,
  id: string
): Promise<Category | null> {
  return withTenantContext(tenantId, (tx) =>
    tx.category.findFirst({ where: { id, tenantId, deletedAt: null } })
  );
}

/**
 * Update a live category, scoped to `tenantId` via `updateMany` (so a
 * cross-tenant id matches 0 rows = no-op → null), same rationale as the
 * supplier slice.
 */
export async function updateCategoryLogic(
  tenantId: string,
  id: string,
  input: CategoryInput
): Promise<Category | null> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const { count } = await tx.category.updateMany({
        where: { id, tenantId, deletedAt: null },
        data: { ...input },
      });
      if (count === 0) return null;
      return tx.category.findFirst({ where: { id, tenantId, deletedAt: null } });
    });
  } catch (e) {
    rethrowConflict(e, input);
  }
}

/**
 * Soft-delete a category: stamp `deletedAt` so it drops out of reads but the
 * row survives. Scoped to `tenantId` via `updateMany`. Returns true if a row
 * was soft-deleted, false if none matched (wrong tenant / missing / deleted).
 */
export async function deleteCategoryLogic(
  tenantId: string,
  id: string
): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => {
    const { count } = await tx.category.updateMany({
      where: { id, tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count > 0;
  });
}
