// ============================================================
// Mise — test tenant sweep (Sprint 5 Part 23, ADR 0023 Q4/Q5)
// ============================================================
// Deletes a test tenant and everything hanging off it.
//
// Two ways in, one body of code:
//   • `globalTeardown` calls it with the window this run opened, so a worker
//     that died before its `afterAll` leaves nothing behind.
//   • `pnpm test:sweep` calls it with no window, to clean up by hand.
//
// It is NOT the normal cleanup path. Every spec still tears down its own
// fixtures in `afterAll`, and residue found after a GREEN run means one of
// those teardowns is incomplete — which is why the sweep names what it deleted
// instead of tidying up in silence (ADR 0023 Q5).
// ============================================================

import { PrismaClient, Prisma } from "@prisma/client";
import { TENANT_SCOPED_DELETE_ORDER, eraseTenantRows } from "@/lib/tenant-erase";

// The order and the erasing live in src/lib/tenant-erase.ts since ADR 0045:
// the operator's "ลบถาวร" uses the same code. Re-exported for the coverage test.
export { TENANT_SCOPED_DELETE_ORDER };

export type SweptTenant = { id: string; name: string; createdAt: Date };

/**
 * What a sweep is allowed to touch. With NEITHER field it takes every tenant in
 * the database, which is what `pnpm test:sweep` wants and what nothing running
 * beside other specs ever does.
 */
export type SweepScope = {
  /** Only tenants created at or after this instant — `globalTeardown`'s window,
   *  so a sweep can never touch anything that existed before the run began. */
  createdAfter?: Date;
  /** Only these tenants. Anything sweeping while other specs are still running
   *  MUST pass this, or it deletes their fixtures out from under them. */
  ids?: string[];
};

/** Delete the tenants in scope and everything beneath them. */
export async function sweepTestTenants(
  db: PrismaClient,
  scope: SweepScope = {}
): Promise<SweptTenant[]> {
  const victims = await db.tenant.findMany({
    where: {
      ...(scope.createdAfter ? { createdAt: { gte: scope.createdAfter } } : {}),
      ...(scope.ids ? { id: { in: scope.ids } } : {}),
    },
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (victims.length === 0) return [];

  await eraseTenantRows(db, victims.map((t) => t.id));
  return victims;
}

/**
 * Delete users that belong to nobody.
 *
 * `User` is Auth.js's table and carries no `tenantId`, which is why it escaped
 * every cleanup this project has run: "Neon swept to 0" has always counted
 * tenants, and 16 test users had been accumulating across sprints underneath a
 * count that read zero.
 *
 * A user is residue only when NOTHING claims it — no tenant membership, no
 * OAuth account, no session. A real person who has signed in has at least one
 * of the three, so the same window that protects a pre-existing tenant protects
 * a pre-existing login as well.
 */
export async function sweepOrphanUsers(
  db: PrismaClient,
  scope: SweepScope = {}
): Promise<{ id: string; email: string | null }[]> {
  const orphans = await db.user.findMany({
    where: {
      memberships: { none: {} },
      accounts: { none: {} },
      sessions: { none: {} },
      ...(scope.createdAfter ? { createdAt: { gte: scope.createdAfter } } : {}),
      // Same rule as tenants, and for the same reason: a spec sweeping while
      // its neighbours are still running MUST name its own rows. Most fixtures
      // create a user with no membership, so an unscoped sweep would delete
      // another spec's user out from under it mid-test.
      ...(scope.ids ? { id: { in: scope.ids } } : {}),
    },
    select: { id: true, email: true },
  });
  if (orphans.length === 0) return [];

  await db.user.deleteMany({ where: { id: { in: orphans.map((u) => u.id) } } });
  return orphans;
}

/**
 * Every model in the schema that carries a `tenantId`, read from the generated
 * client rather than from a list somebody has to remember to update.
 */
export function tenantScopedModels(): string[] {
  return Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "tenantId"))
    .map((m) => m.name)
    .sort();
}
