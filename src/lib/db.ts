// ============================================================
// Mise — Prisma Client + RLS Context (Section H.10)
// ============================================================
// All queries run with tenant context set via SET LOCAL.
// This is defense-in-depth: even if app forgets WHERE tenant_id,
// PostgreSQL RLS denies cross-tenant access.
// ============================================================

import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma =
  global.prismaGlobal ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.prismaGlobal = prisma;
}

/**
 * Timing overrides for the underlying `$transaction`.
 *
 * Added in Part 13 (ADR 0013 Consequence 5). Prisma's defaults are `maxWait`
 * 2s / `timeout` 5s, which is ample for a single-row write but not for
 * confirming a twenty-line goods receipt — twenty ledger inserts, twenty PO-line
 * updates and a status recompute, each a round trip to Neon in Singapore.
 * Optional, so every existing caller is unchanged.
 */
export type TenantContextOptions = {
  /** ms to wait for a connection from the pool (Prisma default 2000). */
  maxWait?: number;
  /** ms the transaction may run before Prisma rolls it back (default 5000). */
  timeout?: number;
};

/**
 * Execute callback with tenant context set.
 * MUST be used for all authenticated requests.
 *
 * Example:
 *   await withTenantContext(tenantId, async (tx) => {
 *     return await tx.purchaseRequest.findMany();
 *     // RLS automatically filters by tenant_id
 *   });
 */
export async function withTenantContext<T>(
  tenantId: string,
  callback: (tx: PrismaClient) => Promise<T>,
  options?: TenantContextOptions
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    // SET LOCAL = only valid within this transaction
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_tenant_id = '${tenantId}'`
    );

    return await callback(tx as unknown as PrismaClient);
  }, options);
}

/**
 * Admin context — BYPASSES RLS.
 * Use ONLY for: migrations, support tools, monitoring.
 * NEVER expose to user-facing API.
 */
export async function withAdminContext<T>(
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  // No SET LOCAL → uses mise_admin role (BYPASSRLS)
  return await callback(prisma);
}
