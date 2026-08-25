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

/**
 * Opening a connection to Neon occasionally just hangs (Part 23.5, ADR 0024).
 *
 * Measured, not guessed: 2,352 cold connections gave 7 failures — **0.30 %** —
 * and every one of them died at 5.1 s, the exact width of Prisma's
 * `connect_timeout`. Raising that ceiling to 20 s changed nothing except which
 * ceiling reported it (the failures moved to 10.1 s, `pool_timeout`) and left
 * the rate at 0.28 %. The attempt that hangs never completes, however long you
 * wait for it.
 *
 * What does work is starting over: **7 failures, 7 recovered on one immediate
 * retry, each in 266–315 ms** — ordinary latency, in the same second the first
 * attempt had been hanging. So this is not a bad period on the link; it is a
 * per-attempt hazard, and the cure is a new attempt.
 *
 * Retrying is safe here for one specific reason: **a failure to ESTABLISH a
 * connection means the query never reached the server.** Nothing ran, so nothing
 * can run twice. Never widen this to errors the database actually answered.
 */
const CONNECTION_RETRIES = 2;

/**
 * Is this an error the query never survived long enough to cause?
 *
 * **Matched on the CLASS, not on `P1001`** — and that distinction cost a whole
 * verification round. `PrismaClientInitializationError` carries **no error code
 * at all**: `code` is undefined, `errorCode` is undefined, and the string
 * "P1001" appears nowhere on the object or in its message. A first attempt at
 * this predicate tested `e.code === "P1001"`, matched nothing, and shipped a
 * retry that never once fired — 15 verification runs later it looked exactly
 * like a fix that had not worked.
 *
 * `PrismaClientInitializationError` means the client could not establish a
 * connection, so no statement reached the server. `P2024` is the pool timeout,
 * which likewise means the query was never sent. Both are safe to repeat
 * BECAUSE nothing ran — which is the property that must hold for anything added
 * here, and does not hold for ordinary query errors.
 */
export function isRetryableConnectionError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: unknown; code?: unknown };
  if (err.name === "PrismaClientInitializationError") return true;
  return err.code === "P2024";
}

/**
 * Run `fn`, and if it failed before reaching the database, run it again.
 *
 * No backoff: the hazard is a single attempt being dead on arrival, not
 * congestion that needs time to clear — the replacement attempt succeeds
 * immediately (measured at 266–315 ms, ADR 0024).
 *
 * Exported so a test can prove it actually retries. A retry that silently never
 * fires is indistinguishable from one that works, right up until it matters.
 */
export async function retryOnConnectionFailure<T>(
  fn: () => Promise<T>,
  retries: number = CONNECTION_RETRIES
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetryableConnectionError(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * Give up on a hung connection quickly, because the retry is what rescues it.
 *
 * Counter-intuitive but measured: with a retry in place a SHORTER
 * `connect_timeout` is better, since waiting out a hang buys nothing (it never
 * succeeds) and every second spent waiting is a second before the attempt that
 * would have worked. Prisma's default is 5 s; 3 s is comfortably above the
 * ~300 ms a healthy connection takes.
 *
 * Applied to the URL in code, deliberately: `.env` holds the credentials and is
 * not this module's to edit.
 */
function withConnectTimeout(url: string | undefined): string | undefined {
  if (!url || url.includes("connect_timeout=")) return url;
  return url + (url.includes("?") ? "&" : "?") + "connect_timeout=3";
}

const datasourceUrl = withConnectTimeout(process.env.DATABASE_URL);

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
});

/**
 * Retry any operation that failed before it reached the database.
 *
 * An extension rather than a wrapper in `withTenantContext`, because six of the
 * eight failures Part 23.5 captured were in a spec's `beforeAll` going through
 * `withAdminContext` — which opens no transaction and would never have passed a
 * wrapper. This covers every call in the project, including bare `prisma` reads
 * like `getUnitTemplates`.
 *
 * The cast back to `PrismaClient` keeps all 133 call sites' types unchanged; the
 * extension is invisible to them, which is the point.
 */
export const prisma =
  global.prismaGlobal ??
  (basePrisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        return await retryOnConnectionFailure(() => query(args));
      },
    },
  }) as unknown as PrismaClient);

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
  // The query extension cannot see this failure: a transaction that dies on
  // BEGIN never runs an operation for it to wrap. So the retry is repeated at
  // the transaction layer — but ONLY while the callback has not started.
  //
  // That guard is the whole safety argument. Once the callback has run, a
  // connection error could have arrived after a COMMIT was sent and before its
  // acknowledgement came back, and re-running the callback would then apply the
  // same writes twice. Before the callback starts, nothing has been sent, so
  // starting over is exactly equivalent to never having tried.
  let callbackStarted = false;

  return await retryOnConnectionFailure(async () => {
    callbackStarted = false;
    try {
      return await runTenantTransaction(tenantId, callback, options, () => {
        callbackStarted = true;
      });
    } catch (e) {
      // Rethrow as something the retry will refuse, so a connection error that
      // arrived AFTER the callback ran is never repeated.
      if (callbackStarted) throw new NonRetryable(e);
      throw e;
    }
  }).catch((e: unknown) => {
    throw e instanceof NonRetryable ? e.cause : e;
  });
}

/** Wrapper that hides a retryable-looking error from the retry loop. */
class NonRetryable extends Error {
  constructor(readonly cause: unknown) {
    super("non-retryable");
  }
}

async function runTenantTransaction<T>(
  tenantId: string,
  callback: (tx: PrismaClient) => Promise<T>,
  options: TenantContextOptions | undefined,
  onCallbackStart: () => void
): Promise<T> {
  const startedAt = TX_TRACE ? Date.now() : 0;

  return await prisma.$transaction(
    async (tx) => {
      onCallbackStart();
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
