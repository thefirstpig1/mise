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
 * How long a transaction may wait to BEGIN before Prisma gives up (ADR 0023 Q2).
 *
 * Prisma's own default is 2,000 ms, chosen for a Postgres on the same machine
 * as the app. Mise talks to Neon in Singapore through pgbouncer, and Part 23
 * measured what that link actually does: 1,771 transaction starts in a healthy
 * run averaged 32 ms and never once passed 279 ms — but a rare, isolated stall
 * takes a single *uncontended* start past two seconds, and Prisma then throws
 * "Unable to start a transaction in the given time" at whichever test, or
 * whichever user, happened to be holding it.
 *
 * 10 s is not a new number. It is what every caller in this codebase that ever
 * thought about `maxWait` already wrote — six times, in five files. It simply
 * never became the default, so the 126 call sites with no reason to think about
 * it kept Prisma's.
 *
 * This is a CEILING, not a delay: a start that takes 30 ms still takes 30 ms.
 *
 * `timeout` deliberately does NOT get the same treatment. A transaction waiting
 * to begin holds nothing; a transaction that is running pins a pgbouncer server
 * connection for its whole life, and killing a runaway at 5 s is worth keeping.
 * The twelve sites that need longer say so out loud, which also documents which
 * operations are heavy.
 */
const DEFAULT_MAX_WAIT_MS = 10_000;

/**
 * Report how long each transaction took to START, when `MISE_TX_TRACE=1`.
 *
 * Kept deliberately (ADR 0023 Q6). This instrumentation is what identified the
 * Part 23 failure — the distinction between "could not begin" and "ran too
 * long" is invisible in the error message alone, and re-deriving it cost most
 * of a session. Inert unless the flag is set.
 *
 * `MISE_TX_TRACE_MS` raises the reporting floor: unset logs every start (the
 * full distribution), `MISE_TX_TRACE_MS=400` logs only the spikes.
 */
const TX_TRACE = process.env.MISE_TX_TRACE === "1";
const TX_TRACE_FLOOR_MS = Number(process.env.MISE_TX_TRACE_MS ?? 0);

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
  const startedAt = TX_TRACE ? Date.now() : 0;

  return await prisma.$transaction(
    async (tx) => {
      if (TX_TRACE) {
        const waited = Date.now() - startedAt;
        if (waited >= TX_TRACE_FLOOR_MS) {
          console.log(`[mise-tx] start ${waited}ms`);
        }
      }
      // SET LOCAL = only valid within this transaction
      await tx.$executeRawUnsafe(
        `SET LOCAL app.current_tenant_id = '${tenantId}'`
      );

      return await callback(tx as unknown as PrismaClient);
    },
    { maxWait: DEFAULT_MAX_WAIT_MS, ...options }
  );
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
