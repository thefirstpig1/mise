// ============================================================
// Mise — Tenant Isolation Test (H.10 RLS validation)
// ============================================================
// Tests that RLS prevents cross-tenant data access.
// Sprint 0: verify policies work as designed.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, withTenantContext, withAdminContext } from "@/lib/db";

// SKIPPED until Sprint 7 — these are PURE-RLS tests (they call findMany()
// with no WHERE and expect the DB to filter by app.current_tenant_id).
// Per ADR 0004, RLS is enabled but NOT enforced against the app role: the
// app connects as `neondb_owner` (rolbypassrls = true, table owner) and
// enable_rls.sql does not FORCE ROW LEVEL SECURITY, so withTenantContext's
// SET LOCAL is currently inert. Real DB-level enforcement (FORCE RLS +
// a non-owner app role) is deferred to Sprint 7; re-enable this suite then.
// Until then, tenant isolation is verified at the app layer via explicit
// tenantId filtering in *Logic functions (see tests/supplier-*.test.ts).
describe.skip("Tenant Isolation (RLS — H.10) — re-enable at Sprint 7 FORCE RLS", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    // Create 2 tenants via admin context (bypasses RLS)
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Tenant A (test)" } });
      const b = await tx.tenant.create({ data: { name: "Tenant B (test)" } });
      tenantA = a.id;
      tenantB = b.id;

      // Create one branch each
      await tx.branch.create({ data: { tenantId: a.id, name: "Branch A1" } });
      await tx.branch.create({ data: { tenantId: b.id, name: "Branch B1" } });
    });
  });

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.branch.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    });
    await prisma.$disconnect();
  });

  it("Tenant A context only sees Tenant A branches", async () => {
    const branches = await withTenantContext(tenantA, async (tx) => {
      return await tx.branch.findMany();
    });

    expect(branches.length).toBe(1);
    expect(branches[0].name).toBe("Branch A1");
    expect(branches[0].tenantId).toBe(tenantA);
  });

  it("Tenant B context only sees Tenant B branches", async () => {
    const branches = await withTenantContext(tenantB, async (tx) => {
      return await tx.branch.findMany();
    });

    expect(branches.length).toBe(1);
    expect(branches[0].name).toBe("Branch B1");
    expect(branches[0].tenantId).toBe(tenantB);
  });

  it("Admin context sees all branches (BYPASSRLS)", async () => {
    const branches = await withAdminContext(async (tx) => {
      return await tx.branch.findMany({
        where: { tenantId: { in: [tenantA, tenantB] } },
      });
    });

    expect(branches.length).toBe(2);
  });

  it("Tenant A cannot read Tenant B by id", async () => {
    // Try to read Tenant B's branch from Tenant A context
    const tenantBBranch = await withAdminContext(async (tx) => {
      return await tx.branch.findFirst({ where: { tenantId: tenantB } });
    });

    expect(tenantBBranch).not.toBeNull();
    const branchId = tenantBBranch!.id;

    // Now from Tenant A context — should return null
    const result = await withTenantContext(tenantA, async (tx) => {
      return await tx.branch.findUnique({ where: { id: branchId } });
    });

    expect(result).toBeNull();
  });
});
