// ============================================================
// Mise — the Auth.js Prisma adapter, with one forgiving method
// ============================================================
// A browser can still carry the cookie of a session row that is gone: the
// account was deleted, or the row was cleaned up by hand. Signing that browser
// in again with a magic link makes Auth.js delete the old session first
// (handle-login.js, "signed in as another user"), and the stock adapter's
// `session.delete` throws when the row is missing. The whole sign-in then
// fails as `?error=Configuration`, and the person stays locked out until they
// clear their cookies — found when Kong's own browser hit it (2026-11-01).
//
// A session that is already gone is exactly the outcome a delete wants, so a
// missing row answers `null` (the adapter contract's "nothing was deleted").
// Every other failure still throws.
// ============================================================

import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterSession } from "next-auth/adapters";

// By code, not `instanceof`: the client in db.ts is an extended one, and dev
// can load two copies of Prisma's error classes.
const isRecordNotFound = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025";

export function sessionTolerantAdapter(
  client: Parameters<typeof PrismaAdapter>[0],
): Adapter {
  const base = PrismaAdapter(client);
  return {
    ...base,
    async deleteSession(sessionToken): Promise<AdapterSession | null | undefined> {
      try {
        return (await base.deleteSession!(sessionToken)) as AdapterSession | null | undefined;
      } catch (e) {
        if (isRecordNotFound(e)) return null;
        throw e;
      }
    },
  };
}
