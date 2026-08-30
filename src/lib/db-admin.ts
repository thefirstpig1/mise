// ============================================================
// Mise — the connection that ignores tenant isolation (Part 30, ADR 0030 Q2)
// ============================================================
// 🔴 READ THIS BEFORE IMPORTING ANYTHING FROM THIS FILE.
//
// Everything here connects as the table OWNER, which carries `BYPASSRLS`. Row
// security is not applied to it at all — not filtered, not checked on insert.
// A query run through this module can read and write every shop's data at once.
//
// It exists for exactly two kinds of caller:
//
//   1. Queries that are CROSS-TENANT BY NATURE. There is one: discovering which
//      shops a person belongs to, which is keyed on `userId` because it is the
//      query that finds the tenant in the first place (`require-tenant.ts`).
//   2. Test fixtures and maintenance scripts, which have to build and destroy
//      whole tenants and therefore cannot live inside one.
//
// It is a MODULE OF ITS OWN, rather than a function in `db.ts`, for a reason
// that is about people and not about code: `db.ts` is imported by every page
// and every server action in the project, and a door that ignores tenant
// isolation should not be one autocomplete away from all of them.
//
// `tests/rls-bypass-guard.test.ts` refuses any import of this file from
// `src/app/**` or `src/server/**` outside a named allowlist, and that allowlist
// has one entry. If you are here to add a second, the question to answer first
// is why the query cannot name its tenant — because almost always, it can.
// ============================================================

import { PrismaClient } from "@prisma/client";
import { withConnectTimeout, withConnectionRetry } from "./db";

declare global {
  // eslint-disable-next-line no-var
  var prismaBypassGlobal: PrismaClient | undefined;
}

/**
 * Falls back to `DATABASE_URL` when `ADMIN_DATABASE_URL` is absent.
 *
 * That fallback is correct rather than lazy: before the Part 30 switch both
 * URLs name the owner, so the behaviour is identical, and a developer who has
 * pulled the branch without updating `.env` gets a working checkout instead of
 * a crash on import. After the switch the fallback would connect as the
 * RLS-subject role, and every fixture in the suite would fail loudly at once —
 * which is the right way round for a misconfiguration.
 */
const bypassUrl = withConnectTimeout(
  process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL
);

export const prismaBypass =
  global.prismaBypassGlobal ??
  withConnectionRetry(
    new PrismaClient({
      log: ["error"],
      ...(bypassUrl ? { datasources: { db: { url: bypassUrl } } } : {}),
    })
  );

if (process.env.NODE_ENV !== "production") {
  global.prismaBypassGlobal = prismaBypass;
}

/**
 * Run a callback against the connection that row security does not apply to.
 *
 * The old name for this was `withAdminContext`, and it was false twice over:
 * its comment claimed a `mise_admin` role that has never existed in this
 * database, and it bypassed nothing because nothing was being enforced. The
 * new name is deliberately uncomfortable — somebody typing it into a page
 * should be able to tell from the word alone what they are doing.
 */
export async function withRlsBypass<T>(
  callback: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return await callback(prismaBypass);
}
