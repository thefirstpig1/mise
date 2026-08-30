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

import type { Branch } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import {
  branchScopeWhere,
  type BranchReach,
} from "@/lib/permissions/service";

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
