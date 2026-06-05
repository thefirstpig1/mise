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

/** List a tenant's live (non-soft-deleted) branches, ordered by name. */
export async function getBranchesLogic(tenantId: string): Promise<Branch[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.branch.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: "asc" },
    })
  );
}
