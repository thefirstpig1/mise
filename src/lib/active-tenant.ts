// ============================================================
// Mise — which shop am I in (Sprint 6 Part 29 L3c, ADR 0029 Q3)
// ============================================================
// Before Part 29 nobody could belong to two tenants, so `requireTenant` took
// the OLDEST membership and never had to say so. The moment invitations exist
// that becomes a guess made in silence: an outside bookkeeper who does the
// books for three shops, or somebody who signed Mise up for their own place and
// was later invited to a friend's, would see one shop for ever with nothing on
// screen suggesting the other exists.
//
// 🔴 THE COOKIE IS NOT TRUSTED, EVER (rule A9). It carries a tenant id, and a
// tenant id from a browser is an invitation to read somebody else's shop. It is
// used for exactly one thing: PICKING FROM a list of memberships that was
// already fetched by userId. If it names something that is not in that list it
// is ignored, and nothing derived from it ever reaches a query. Treat any code
// that passes this value onward as a tenant-isolation bug, not a style problem.
// ============================================================

import { cookies } from "next/headers";

/**
 * Deliberately not `__Host-`-prefixed and not signed: it holds no authority.
 * Tampering with it can only ever select a different row from a list the
 * server built, or select nothing.
 */
export const ACTIVE_TENANT_COOKIE = "mise_active_tenant";

/** A year. Losing it is harmless — the chooser simply appears again. */
export const ACTIVE_TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The tenant id the browser last chose, or null.
 *
 * Read lazily and ONLY when a person actually has more than one membership,
 * so the single-shop path — which is every shop today — never touches
 * `cookies()` at all.
 */
export async function readActiveTenantCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACTIVE_TENANT_COOKIE)?.value ?? null;
}

/**
 * Choose from what the server already knows this person belongs to.
 *
 * The signature is the safety property: the only way to get an id out is to
 * hand in the list it must come from.
 */
export function pickActiveTenant<T extends { tenantId: string }>(
  memberships: readonly T[],
  cookieValue: string | null
): T | null {
  if (memberships.length === 0) return null;
  if (memberships.length === 1) return memberships[0];
  if (cookieValue === null) return null;
  return memberships.find((m) => m.tenantId === cookieValue) ?? null;
}
