// ============================================================
// Mise — no tenant table is read through bare `prisma` (ADR 0030)
// ============================================================
// Since Part 30 the app connects as a role RLS applies to, and every policy
// reads `app.current_tenant_id`. A query on a tenant-scoped table that is not
// inside withTenantContext() carries no tenant, the policy casts an empty
// setting to uuid, and Postgres raises 22P02.
//
// Two pages shipped that way and were found by a person, not by a test, weeks
// after Part 30 (Kong, 2026-09-28): /staff-meals and /staff-meals/people read
// `prisma.tenant`, and /choose-shop read `prisma.tenantMembership`. Every visit
// crashed. This test reads the source instead of waiting for someone to click.
//
// What is allowed: global tables (units, densities, users) through `prisma`,
// and the cross-tenant membership discovery in src/lib/require-tenant.ts,
// which uses the bypass client on purpose (rls-bypass-guard.test.ts).
// ============================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Prisma } from "@prisma/client";

const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src");

/** Files that ARE the database layer, and so may speak to it directly. */
const EXEMPT = new Set(["src/lib/db.ts", "src/lib/db-admin.ts"]);

/**
 * Every model RLS protects: anything carrying tenantId, the tenant row itself,
 * and the two tables whose policy reaches the tenant through a join.
 */
const RLS_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter(
      (m) =>
        m.fields.some((f) => f.name === "tenantId") ||
        ["Tenant", "UserBranchAccess", "UserDepartmentAssignment"].includes(m.name)
    )
    .map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1))
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** `prisma.<model>.` where the model is RLS-protected — the shape that crashes. */
export function bareTenantReads(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/\bprisma\.(\w+)\s*\./g)) {
    if (RLS_MODELS.has(m[1])) hits.push(m[1]);
  }
  return hits;
}

describe("tenant tables are only read inside a tenant context (ADR 0030)", () => {
  it("B1 — the model list is real, so an empty pass means something", () => {
    for (const model of ["tenant", "tenantMembership", "stockCount", "wasteLog"]) {
      expect(RLS_MODELS.has(model), model).toBe(true);
    }
    expect(RLS_MODELS.has("user")).toBe(false);
    expect(RLS_MODELS.has("unitTemplate")).toBe(false);
  });

  it("B2 — the detector catches the exact shape that shipped", () => {
    expect(bareTenantReads("await prisma.tenant.findUniqueOrThrow({})")).toEqual(["tenant"]);
    expect(bareTenantReads("prisma.tenantMembership.findMany({")).toEqual(["tenantMembership"]);
    expect(bareTenantReads("tx.tenant.findUniqueOrThrow({")).toEqual([]);
    expect(bareTenantReads("prisma.user.upsert({")).toEqual([]);
  });

  it("B3 — no file under src/ reads an RLS table through bare prisma", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file: relative(ROOT, file).replace(/\\/g, "/"), text: readFileSync(file, "utf8") }))
      .filter((f) => !EXEMPT.has(f.file))
      .flatMap((f) => bareTenantReads(f.text).map((model) => `${f.file}: prisma.${model}`));
    expect(offenders, "wrap these in withTenantContext(tenantId, (tx) => …)").toEqual([]);
  });
});
