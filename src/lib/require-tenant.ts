// ============================================================
// Mise — requireTenant() auth + tenant-discovery helper (ADR 0004)
// ============================================================
// Layer 1 of the two-layer data-access pattern: authenticate the
// request and DISCOVER which tenant the user belongs to.
//
// This membership lookup is cross-tenant BY NATURE — it filters by
// userId, not tenantId — so it MUST run as bare `prisma`. It is the
// query that discovers the tenant; only AFTER tenantId is known do
// callers run their scoped reads/writes inside withTenantContext()
// (layer 2, see src/lib/db.ts).
//
// Does NOT check permissions (Single Responsibility) — callers
// compose that separately. PermissionService matrix lands in Sprint 2.
// Active tenant = first active membership (no switcher in Sprint 1).
// ============================================================

import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "./db";

/**
 * Require an authenticated user with an active tenant membership.
 *
 * Redirects to /login if unauthenticated, or /signup if the user has
 * no active membership. On success returns the session, the session
 * user, the active membership (with its tenant), and the tenantId to
 * pass into withTenantContext() for scoped queries.
 */
export async function requireTenant() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Layer 1: membership discovery — cross-tenant (by userId) → bare prisma.
  const membership = await prisma.tenantMembership.findFirst({
    where: { userId: session.user.id, isActive: true },
    include: { tenant: true },
    orderBy: { createdAt: "asc" }, // "first active membership" = oldest joined
  });

  if (!membership) redirect("/signup");

  return {
    session,
    user: session.user,
    membership,
    tenantId: membership.tenantId,
  };
}
