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
 * Every branch in the tenant, for the settings screen.
 * Deliberately NOT narrowed by reach: only `settings:write` reaches this list,
 * and that capability belongs to people who run the whole business.
 */
export async function getAllBranchesForAdminLogic(tenantId: string): Promise<Branch[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null },
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
        data: { tenantId, name: input.name, code: input.code, address: input.address, isActive: true },
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
      data: { name: input.name, address: input.address },
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
