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
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return await prisma.$transaction(async (tx) => {
    // SET LOCAL = only valid within this transaction
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_tenant_id = '${tenantId}'`
    );

    return await callback(tx as unknown as PrismaClient);
  });
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
