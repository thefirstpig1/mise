// ============================================================
// Mise — supplier *Logic integration tests (Sprint 1 Part 5, Step 5)
// ============================================================
// Exercises the pure logic layer (src/server/supplier.ts) against the
// real Neon DB through withTenantContext, keyed by tenantId (no auth mock).
//
// Tenant isolation here is verified at the APP LAYER (explicit tenantId
// filtering in each *Logic fn), NOT at the DB layer: per ADR 0004 RLS is
// enabled but inert until Sprint 7 (FORCE RLS). These tests therefore stay
// green today and remain valid once RLS becomes a second, redundant layer.
//
// TDD vertical slices: one behavior at a time (see .claude/skills/tdd).
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withAdminContext, prisma } from "@/lib/db";
import { supplierInputSchema } from "@/lib/validations/supplier";
import {
  createSupplierLogic,
  getSuppliersLogic,
  getSupplierByIdLogic,
  updateSupplierLogic,
  deleteSupplierLogic,
  SupplierCodeConflictError,
} from "@/server/supplier";

/** Build a validated SupplierInput from minimal overrides. */
const input = (over: Record<string, unknown> = {}) =>
  supplierInputSchema.parse({ nameFull: "ผู้ขายทดสอบ", ...over });

describe("supplier *Logic (tenant-scoped, app-layer isolation)", () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    await withAdminContext(async (tx) => {
      const a = await tx.tenant.create({ data: { name: "Supplier Test Tenant A" } });
      const b = await tx.tenant.create({ data: { name: "Supplier Test Tenant B" } });
      tenantA = a.id;
      tenantB = b.id;
    });
  });

  afterAll(async () => {
    await withAdminContext(async (tx) => {
      await tx.supplier.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
      await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    });
    await prisma.$disconnect();
  });

  // Slice 1
  it("createSupplierLogic creates a supplier under the given tenant", async () => {
    const s = await createSupplierLogic(
      tenantA,
      input({ nameFull: "บริษัท เอ จำกัด", code: "A-001" })
    );
    expect(s.id).toBeDefined();
    expect(s.tenantId).toBe(tenantA);
    expect(s.nameFull).toBe("บริษัท เอ จำกัด");
    expect(s.code).toBe("A-001");
    expect(s.isActive).toBe(true);
    expect(s.deletedAt).toBeNull();
  });

  // Slice 2 — the high-value isolation check (Tenant A vs Tenant B)
  it("getSuppliersLogic returns only the calling tenant's suppliers", async () => {
    // tenantA already has "บริษัท เอ จำกัด" from Slice 1; give tenantB its own.
    await createSupplierLogic(tenantB, input({ nameFull: "บริษัท บี จำกัด", code: "B-001" }));

    const aNames = (await getSuppliersLogic(tenantA)).map((s) => s.nameFull);
    expect(aNames).toContain("บริษัท เอ จำกัด");
    expect(aNames).not.toContain("บริษัท บี จำกัด"); // B's row never leaks to A

    const bList = await getSuppliersLogic(tenantB);
    expect(bList.every((s) => s.tenantId === tenantB)).toBe(true);
    expect(bList.map((s) => s.nameFull)).toContain("บริษัท บี จำกัด");
    expect(bList.map((s) => s.nameFull)).not.toContain("บริษัท เอ จำกัด");
  });

  // Slice 3 — single-row read is also tenant-scoped (no cross-tenant peek by id)
  it("getSupplierByIdLogic finds own-tenant rows and returns null cross-tenant", async () => {
    const created = await createSupplierLogic(
      tenantA,
      input({ nameFull: "บริษัท หาไอดี จำกัด", code: "A-ID" })
    );

    const own = await getSupplierByIdLogic(tenantA, created.id);
    expect(own?.id).toBe(created.id);

    // tenant B asks for tenant A's id → must not be readable
    const cross = await getSupplierByIdLogic(tenantB, created.id);
    expect(cross).toBeNull();
  });

  // Slice 4 — update is tenant-scoped: own-tenant succeeds, cross-tenant is a no-op
  it("updateSupplierLogic updates own-tenant rows and refuses cross-tenant", async () => {
    const created = await createSupplierLogic(
      tenantA,
      input({ nameFull: "ก่อนแก้ไข", code: "A-UPD" })
    );

    // own tenant can update
    const updated = await updateSupplierLogic(
      tenantA,
      created.id,
      input({ nameFull: "หลังแก้ไข", code: "A-UPD" })
    );
    expect(updated?.id).toBe(created.id);
    expect(updated?.nameFull).toBe("หลังแก้ไข");

    // tenant B tries to update tenant A's row → no row matches → null, and A's row is untouched
    const hijack = await updateSupplierLogic(
      tenantB,
      created.id,
      input({ nameFull: "โดนแฮก", code: "A-UPD" })
    );
    expect(hijack).toBeNull();

    const stillA = await getSupplierByIdLogic(tenantA, created.id);
    expect(stillA?.nameFull).toBe("หลังแก้ไข"); // unchanged by B's attempt
  });

  // Slice 5 — delete is a tenant-scoped soft-delete (Q6): row vanishes from
  // reads but stays in the table; cross-tenant delete is a no-op.
  it("deleteSupplierLogic soft-deletes own-tenant rows and refuses cross-tenant", async () => {
    const created = await createSupplierLogic(
      tenantA,
      input({ nameFull: "บริษัท ลบทิ้ง จำกัด", code: "A-DEL" })
    );

    // tenant B cannot delete tenant A's row → no row matches → false, A still sees it
    const hijack = await deleteSupplierLogic(tenantB, created.id);
    expect(hijack).toBe(false);
    expect(await getSupplierByIdLogic(tenantA, created.id)).not.toBeNull();

    // own tenant soft-deletes it
    const ok = await deleteSupplierLogic(tenantA, created.id);
    expect(ok).toBe(true);

    // gone from both the list and the by-id read (deletedAt filter)
    expect(await getSupplierByIdLogic(tenantA, created.id)).toBeNull();
    const aNames = (await getSuppliersLogic(tenantA)).map((s) => s.nameFull);
    expect(aNames).not.toContain("บริษัท ลบทิ้ง จำกัด");

    // but the row still physically exists (soft-delete, not hard delete)
    const row = await withAdminContext((tx) =>
      tx.supplier.findUnique({ where: { id: created.id } })
    );
    expect(row?.deletedAt).not.toBeNull();
  });

  // Slice 6 — duplicate `code` within a tenant is rejected with a typed error
  // (the action layer maps it to Thai, Q5a). The partial unique index is
  // per-tenant, so the SAME code under a different tenant is fine.
  it("createSupplierLogic rejects a duplicate code within a tenant, but allows it across tenants", async () => {
    await createSupplierLogic(tenantA, input({ nameFull: "ตัวแรก", code: "DUP" }));

    // same code, same tenant → P2002 → typed domain error carrying the code
    await expect(
      createSupplierLogic(tenantA, input({ nameFull: "ตัวซ้ำ", code: "DUP" }))
    ).rejects.toBeInstanceOf(SupplierCodeConflictError);

    // same code, different tenant → allowed (per-tenant uniqueness)
    const b = await createSupplierLogic(tenantB, input({ nameFull: "คนละร้าน", code: "DUP" }));
    expect(b.code).toBe("DUP");
    expect(b.tenantId).toBe(tenantB);
  });
});
