// ============================================================
// Mise — Branch read logic (Sprint 1 Part 8 L5a-2)
// ============================================================
// A single read helper added for the mapping write UI's branch selector
// (Q7 branch override). Branches are otherwise created at tenant init
// (src/server/tenant-init.ts); this is the first place that needs to LIST a
// tenant's branches, so the read fn lands here rather than inline in the page
// (both the new + edit mapping pages share it). Mirrors getSuppliersLogic:
// withTenantContext + explicit tenantId filter (RLS inert, ADR 0004) + exclude
// soft-deleted, ordered by name.
// ============================================================

import { Prisma, type Branch } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import {
  branchScopeWhere,
  type BranchReach,
} from "@/lib/permissions/service";
import type { BranchInput, UpdateBranchInput } from "@/lib/validations/branch";

// ------------------------------------------------------------
// Part 35 L1 — creating and maintaining branches
// ------------------------------------------------------------

export class BranchCodeTakenError extends Error {
  constructor(public readonly code: string) {
    super(`Branch code already in use in this tenant: ${code}`);
    this.name = "BranchCodeTakenError";
  }
}

export class BranchNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Branch not found: ${id}`);
    this.name = "BranchNotFoundError";
  }
}

/**
 * The branches the settings screen lists. Narrowed to reach like every other
 * branch listing (rule A5, pinned by tests/permissions-branch-scope.test.ts B5):
 * `settings:write` belongs to owner and admin, and an admin can be given named
 * branches rather than all of them.
 */
export async function getAllBranchesForAdminLogic(
  tenantId: string,
  reach: BranchReach
): Promise<Branch[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
      orderBy: { createdAt: "asc" },
    })
  );
}

/**
 * Create a branch.
 *
 * The duplicate check runs INSIDE the transaction before the insert, rather
 * than relying on P2002 alone: on an RLS-protected table Postgres withholds
 * the constraint's identity (ADR 0030), so a bare P2002 cannot say which rule
 * it broke. `branch` has only the one unique, so the P2002 fallback — for two
 * requests racing past the check — is still certain it was the code.
 *
 * Owners and admins hold `allBranches`, so the new branch is in their reach
 * the moment it exists. A manager limited to named branches is given this one
 * explicitly on the people screen, never implicitly here.
 */
export async function createBranchLogic(tenantId: string, input: BranchInput): Promise<Branch> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const taken = await tx.branch.findFirst({
        where: { tenantId, code: input.code, deletedAt: null },
        select: { id: true },
      });
      if (taken) throw new BranchCodeTakenError(input.code);
      return tx.branch.create({
        data: {
          tenantId,
          name: input.name,
          code: input.code,
          address: input.address,
          isActive: true,
          ...(input.salesDayCutoffMinutes === undefined ? {} : { salesDayCutoffMinutes: input.salesDayCutoffMinutes }),
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new BranchCodeTakenError(input.code);
    }
    throw e;
  }
}

/** Rename a branch or change its address. The code is fixed — see the schema. */
export async function updateBranchLogic(tenantId: string, input: UpdateBranchInput): Promise<Branch> {
  return withTenantContext(tenantId, async (tx) => {
    const { count } = await tx.branch.updateMany({
      where: { id: input.id, tenantId, deletedAt: null },
      data: {
        name: input.name,
        address: input.address,
        // Applies from the NEXT import only: business_date is stored, so days
        // already imported keep the day they were given (rule P24).
        ...(input.salesDayCutoffMinutes === undefined ? {} : { salesDayCutoffMinutes: input.salesDayCutoffMinutes }),
      },
    });
    if (count === 0) throw new BranchNotFoundError(input.id);
    return tx.branch.findFirstOrThrow({ where: { id: input.id, tenantId } });
  });
}

/**
 * List the live branches a person may act on, ordered by name.
 *
 * `reach` is REQUIRED (Part 28, ADR 0029 Q5). This function is the door 26
 * screens use to fill a branch picker or loop over "every branch", so narrowing
 * here narrows all of them at once — and an optional parameter would be one
 * somebody forgets, failing open.
 *
 * A caller that genuinely serves no user — a background job, a fixture — says
 * so out loud with `{ allBranches: true, allowedBranchIds: [] }` rather than
 * being allowed to say nothing.
 */
export async function getBranchesLogic(
  tenantId: string,
  reach: BranchReach
): Promise<Branch[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
      orderBy: { name: "asc" },
    })
  );
}

/**
 * Which branch a page should open on when the URL names none (Kong 2026-10-24,
 * duplication review D1): the one with the most recent SALES day, then the
 * most recent stock movement. Alphabetical order opened ตัดสต๊อก and สต๊อก on a
 * branch that had never sold anything, so the page said "nothing here" while
 * the shop's real branch sat one click away. Only ever chooses among the ids
 * the caller already holds (reach-filtered).
 */
export async function liveliestBranchId(tenantId: string, branchIds: readonly string[]): Promise<string | undefined> {
  if (branchIds.length <= 1) return branchIds[0];
  return withTenantContext(tenantId, async (tx) => {
    const sales = await tx.salesDay.groupBy({
      by: ["branchId"],
      where: { tenantId, branchId: { in: [...branchIds] } },
      _max: { businessDate: true },
    });
    const bySales = sales.filter((s) => s._max.businessDate).sort((a, b) => b._max.businessDate!.getTime() - a._max.businessDate!.getTime())[0];
    if (bySales) return bySales.branchId;
    const moves = await tx.stockMovement.groupBy({
      by: ["branchId"],
      where: { tenantId, branchId: { in: [...branchIds] } },
      _max: { occurredAt: true },
    });
    const byMove = moves.filter((m) => m._max.occurredAt).sort((a, b) => b._max.occurredAt!.getTime() - a._max.occurredAt!.getTime())[0];
    return byMove?.branchId ?? branchIds[0];
  });
}
