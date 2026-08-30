// ============================================================
// Mise — requireTenant() auth + tenant discovery + the permission gate
// (ADR 0004, and ADR 0029 Q6 for the capability argument)
// ============================================================
// Layer 1 of the two-layer data-access pattern: authenticate the request,
// DISCOVER which tenant the user belongs to, and — since Part 28 — refuse the
// request if the role that membership carries does not hold what the surface
// asked for.
//
// This membership lookup is cross-tenant BY NATURE — it filters by userId, not
// tenantId — so it MUST run as bare `prisma`. It is the query that discovers
// the tenant; only AFTER tenantId is known do callers run their scoped
// reads/writes inside withTenantContext() (layer 2, see src/lib/db.ts).
//
// WHY THE CAPABILITY ARGUMENT IS REQUIRED AND HAS NO DEFAULT (ADR 0029 Q6).
// The failure mode of a permission system is not a wrong rule, it is a NEW
// surface that nobody remembered to guard — and nothing goes red. Because every
// page and every action in this project already passes through this one
// function, making the argument mandatory turns that omission into a COMPILE
// ERROR: a new page that will not say what it needs does not build. Surfaces
// where being a member is genuinely the whole requirement pass `"any:member"`,
// out loud, so a reader can tell "considered and open" from "forgotten".
//
// WHY REFUSAL IS A REDIRECT AND NOT A THROWN ERROR. This function is called
// from both pages and server actions, and one behaviour for both is worth more
// than a tidy taxonomy. `redirect()` already leaves this function twice
// (/login, /signup), so a third exit is the same shape rather than a new one,
// and it needs no per-segment error.tsx — of which this project has none.
//
// ⚠️ The corollary: `redirect()` works by throwing a Next-internal error. Call
// requireTenant OUTSIDE any try/catch that converts errors into form state, or
// a refusal will be swallowed and rendered as a confusing Thai error message
// instead of moving the user. Every call site in this project follows the
// convention of calling it before the try block; keep it that way.
// ============================================================

import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "./db";
import { canAccessBranch, hasCapability, type Requirement } from "./permissions/service";
import { costAccessFor, type CostAccess } from "./permissions/cost-access";
import { pickActiveTenant, readActiveTenantCookie } from "./active-tenant";

/** Where a person may act. `role` answers what; this answers where. */
export interface Reach {
  allBranches: boolean;
  allowedBranchIds: string[];
}

function deny(need: string): never {
  redirect(`/denied?need=${encodeURIComponent(need)}`);
}

/**
 * Require an authenticated user, an active tenant membership, and a role that
 * holds `need`.
 *
 * Redirects to /login if unauthenticated, /signup if there is no active
 * membership, and /denied if the membership's role does not carry the
 * capability the caller named.
 *
 * @param need     what this page or action requires. `"any:member"` means the
 *                 membership itself was the whole requirement — say it rather
 *                 than leaving it out.
 * @param opts.branch  when the surface acts on one branch and already knows
 *                 which, pass it here and reach is checked before anything
 *                 else runs. Otherwise use the returned `assertBranch` once the
 *                 input has been parsed.
 */
export async function requireTenant(
  need: Requirement,
  opts?: { branch?: string | null }
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  // Layer 1: membership discovery — cross-tenant (by userId) → bare prisma.
  //
  // findMANY since Part 29. Until invitations existed nobody could belong to
  // two shops, and taking the oldest was a guess that could never be wrong. It
  // can be wrong now — an outside bookkeeper does the books for three shops —
  // so the guess is gone (ADR 0029 Q3).
  const memberships = await prisma.tenantMembership.findMany({
    where: { userId: session.user.id, isActive: true },
    include: {
      tenant: true,
      branchAccess: { select: { branchId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) redirect("/signup");

  // The cookie is read ONLY here, only when there is a real choice to make, and
  // only to select from the list above — never as an input to a query (rule
  // A9). One-shop tenants, which is every shop today, never touch `cookies()`.
  const membership = pickActiveTenant(
    memberships,
    memberships.length === 1 ? null : await readActiveTenantCookie()
  );

  if (!membership) redirect("/choose-shop");

  const role = membership.role;
  if (!hasCapability(role, need)) deny(need);

  const reach: Reach = {
    allBranches: membership.allBranches,
    allowedBranchIds: membership.branchAccess.map((b) => b.branchId),
  };

  if (opts?.branch && !canAccessBranch(reach, opts.branch)) deny("branch");

  return {
    session,
    user: session.user,
    membership,
    tenantId: membership.tenantId,
    role,
    reach,

    /**
     * How many shops this person belongs to. Only ever compared against 1: the
     * dashboard offers "สลับร้าน" when there is somewhere to switch TO, and
     * says nothing when there is not (ADR 0029 Q3). Free — the memberships were
     * all fetched above to avoid guessing.
     */
    membershipCount: memberships.length,

    /**
     * The ticket a cost-bearing read needs, or `null`. Minted here and nowhere
     * else in a request's life (ADR 0029 Q12). A read that receives `null` must
     * render "ไม่มีสิทธิ์ดู" — never ฿0, never a dash: both are read as claims
     * about the money rather than about the permission (rule A8).
     */
    costAccess: costAccessFor(role) as CostAccess | null,

    /**
     * A second capability, for a SECTION of a page rather than the page.
     * `/staff-meals` is the shape this exists for: recording a meal is
     * `staffmeal:write`, but reading back who ate how much is `staff:view`,
     * and they live on one screen. The page gate answers the first; this
     * answers the second, next to the markup it hides.
     *
     * Hiding is tidiness, not security (rule A7) — anything this guards that
     * also WRITES must still be refused by its own action's gate.
     */
    can(need: Requirement): boolean {
      return hasCapability(role, need);
    },

    /**
     * Refuse unless this branch is within reach. Call it after parsing input,
     * before touching the ledger — hiding a branch from a dropdown is tidiness,
     * not security (rule A7).
     */
    assertBranch(branchId: string): void {
      if (!canAccessBranch(reach, branchId)) deny("branch");
    },
  };
}
