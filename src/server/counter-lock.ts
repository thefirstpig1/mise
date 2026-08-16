// ============================================================
// Mise — counter serialisation (Sprint 2 Part 13.5, Pitfall #25)
// ============================================================
// Every human-readable number in the system is generated the same way: scan the
// existing numbers of a shape, take max + 1, insert. `generateSku` (P-####),
// `generatePoNumber` ({CODE}-PO-####) and `generateGrNumber` ({CODE}-GR-####)
// all do it, and none of them held a lock — two concurrent writers read the same
// max, both built the same number, and the loser hit the partial unique index
// and was told in Thai to press save again.
//
// This module is the fix Pitfall #25 always named: one advisory lock, taken by
// the generator, keyed on the counter it is about to read.
// ============================================================

import type { PrismaClient } from "@prisma/client";

/**
 * Serialise everyone about to compute "max + 1" for the same counter.
 *
 * **Transaction-scoped on purpose.** `pg_advisory_xact_lock` is released by the
 * COMMIT and by the ROLLBACK, so there is no unlock path to forget and a failed
 * write cannot strand the counter. The plain `pg_advisory_lock` would outlive the
 * transaction and ride a pooled connection into whatever query came next.
 *
 * This is only valid because `withTenantContext` IS a `$transaction`
 * (`src/lib/db.ts`) — every caller of this helper runs inside one. Outside a
 * transaction Postgres takes and immediately releases the lock, which would look
 * like it worked and serialise nothing.
 *
 * `hashtextextended` maps the key onto the bigint the advisory-lock API takes.
 * Collisions between unrelated keys are possible in principle and harmless in
 * practice: the only cost is two unrelated counters briefly waiting on each
 * other, and the unique indexes still stand behind the whole thing.
 *
 * `$executeRaw`, not `$queryRaw`: the function returns `void`, and Prisma cannot
 * deserialize a void column ("Failed to deserialize column of type 'void'"). We
 * want the side effect, not the row.
 *
 * @param tx  the transaction client — NOT the bare `prisma` singleton
 * @param key counter identity, e.g. `product_sku:{tenantId}`. Include every
 *            dimension the counter is scoped by, or two scopes serialise as one.
 */
export async function acquireCounterLock(
  tx: PrismaClient,
  key: string
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
}
