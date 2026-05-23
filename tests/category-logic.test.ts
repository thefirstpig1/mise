// ============================================================
// Mise — category *Logic integration tests (Sprint 1 Part 6)
// ============================================================
// Exercises src/server/category.ts against the real Neon DB through
// withTenantContext, keyed by tenantId (no auth mock). Tenant isolation is
// verified at the APP LAYER (explicit tenantId filtering) — RLS is inert
// until Sprint 7 (ADR 0004). Mirrors tests/supplier-logic.test.ts.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withAdminContext, prisma } from "@/lib/db";
import { categoryInputSchema } from "@/lib/validations/category";
import {
  createCategoryLogic,
  getCategoriesLogic,
  getCategoryByIdLogic,
  updateCategoryLogic,
  deleteCategoryLogic,
  CategoryConflictError,
} from "@/server/category";

/** Build a validated CategoryInput from minimal overrides. */
const input = (over: Record<string, unknown> = {}) =>
  categoryInputSchema.parse({
    account: "COGS",
    accountingSection: "Food",
    groupName: "Meat",
    ...over,
  });

describe("category *Logic (tenant-scoped, app-layer isolation)", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Category Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "Category Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;
    });
  });

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.category.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    });
    await prisma.$disconnect();
  });

  // Slice 1 — create
  it("createCategoryLogic creates a category under the given tenant", async () => {
    const c = await createCategoryLogic(tenantA, input());
    expect(c.id).toBeDefined();
    expect(c.tenantId).toBe(tenantA);
    expect(c.account).toBe("COGS");
    expect(c.accountingSection).toBe("Food");
    expect(c.groupName).toBe("Meat");
    expect(c.deletedAt).toBeNull();
  });

  // Slice 2 — isolation (Tenant A vs Tenant B)
  it("getCategoriesLogic returns only the calling tenant's categories", async () => {
    await createCategoryLogic(tenantB, input({ accountingSection: "Food", groupName: "Seafood" }));

    const aGroups = (await getCategoriesLogic(tenantA)).map((c) => c.groupName);
    expect(aGroups).toContain("Meat");
    expect(aGroups).not.toContain("Seafood"); // B's row never leaks to A

    const bList = await getCategoriesLogic(tenantB);
    expect(bList.every((c) => c.tenantId === tenantB)).toBe(true);
    expect(bList.map((c) => c.groupName)).toContain("Seafood");
    expect(bList.map((c) => c.groupName)).not.toContain("Meat");
  });

  // Slice 3 — single-row read is tenant-scoped
  it("getCategoryByIdLogic finds own-tenant rows and returns null cross-tenant", async () => {
    const created = await createCategoryLogic(
      tenantA,
      input({ accountingSection: "Food", groupName: "FindMe" })
    );

    const own = await getCategoryByIdLogic(tenantA, created.id);
    expect(own?.id).toBe(created.id);

    const cross = await getCategoryByIdLogic(tenantB, created.id);
    expect(cross).toBeNull();
  });

  // Slice 4 — update is tenant-scoped: own succeeds, cross-tenant is a no-op
  it("updateCategoryLogic updates own-tenant rows and refuses cross-tenant", async () => {
    const created = await createCategoryLogic(
      tenantA,
      input({ account: "OpEx", accountingSection: "Utilities", groupName: "Electricity" })
    );

    const updated = await updateCategoryLogic(
      tenantA,
      created.id,
      input({ account: "OpEx", accountingSection: "Utilities", groupName: "Power" })
    );
    expect(updated?.id).toBe(created.id);
    expect(updated?.groupName).toBe("Power");

    const hijack = await updateCategoryLogic(
      tenantB,
      created.id,
      input({ account: "OpEx", accountingSection: "Utilities", groupName: "Hijacked" })
    );
    expect(hijack).toBeNull();

    const stillA = await getCategoryByIdLogic(tenantA, created.id);
    expect(stillA?.groupName).toBe("Power"); // unchanged by B's attempt
  });

  // Slice 5 — soft-delete, tenant-scoped
  it("deleteCategoryLogic soft-deletes own-tenant rows and refuses cross-tenant", async () => {
    const created = await createCategoryLogic(
      tenantA,
      input({ account: "OpEx", accountingSection: "Rent", groupName: "Building" })
    );

    const hijack = await deleteCategoryLogic(tenantB, created.id);
    expect(hijack).toBe(false);
    expect(await getCategoryByIdLogic(tenantA, created.id)).not.toBeNull();

    const ok = await deleteCategoryLogic(tenantA, created.id);
    expect(ok).toBe(true);

    expect(await getCategoryByIdLogic(tenantA, created.id)).toBeNull();
    const aGroups = (await getCategoriesLogic(tenantA)).map((c) => c.groupName);
    expect(aGroups).not.toContain("Building");

    // row still physically exists (soft-delete, not hard delete)
    const row = await withAdminContext((tx) =>
      tx.category.findUnique({ where: { id: created.id } })
    );
    expect(row?.deletedAt).not.toBeNull();
  });

  // Slice 6 — duplicate triple within a tenant is rejected; same triple across tenants is fine
  it("createCategoryLogic rejects a duplicate triple within a tenant, but allows it across tenants", async () => {
    await createCategoryLogic(tenantA, input({ accountingSection: "Beverage", groupName: "Coffee" }));

    await expect(
      createCategoryLogic(tenantA, input({ accountingSection: "Beverage", groupName: "Coffee" }))
    ).rejects.toBeInstanceOf(CategoryConflictError);

    const b = await createCategoryLogic(tenantB, input({ accountingSection: "Beverage", groupName: "Coffee" }));
    expect(b.groupName).toBe("Coffee");
    expect(b.tenantId).toBe(tenantB);
  });

  // Slice 7 — editing a category to a triple already used in the tenant raises the same typed error
  it("updateCategoryLogic rejects changing to a triple already used in the tenant", async () => {
    await createCategoryLogic(tenantA, input({ accountingSection: "Packaging", groupName: "Keep" }));
    const victim = await createCategoryLogic(
      tenantA,
      input({ accountingSection: "Packaging", groupName: "Move" })
    );

    await expect(
      updateCategoryLogic(
        tenantA,
        victim.id,
        input({ accountingSection: "Packaging", groupName: "Keep" })
      )
    ).rejects.toBeInstanceOf(CategoryConflictError);
  });
});
