// ============================================================
// Mise — who is in this shop (Sprint 6 Part 29 L3c, ADR 0029)
// ============================================================
// One read. The people screen has to answer four questions and no more: who is
// here, what may they do, where, and — since somebody other than the account's
// creator can now change all three — who last changed it.
//
// EVERYONE IS LISTED, INCLUDING PEOPLE WHO HAVE LEFT. A membership that was
// deactivated is shown and labelled, never hidden, for the reason ADR 0027 gave
// about retired menus and ADR 0028 gave about staff who have left: dropping a
// row makes a screen that cannot explain itself. "Why can I not invite this
// email?" is answerable only if the row that already holds it is visible.
// ============================================================

import { withTenantContext } from "@/lib/db";
import type { Role } from "@/lib/permissions/service";

export interface MemberRow {
  membershipId: string;
  userId: string;
  email: string;
  /** The name on the account, which the person chose. Null until they set one. */
  name: string | null;
  role: Role | string;
  isActive: boolean;
  /**
   * Never signed in. This is how "invited" is told from "working here" without
   * a status column — Q2's reason for having no invitation table at all.
   */
  neverSignedIn: boolean;
  allBranches: boolean;
  branchNames: string[];
  /** Q14: who last changed this row's role or reach, and when. */
  changedAt: Date | null;
  changedByName: string | null;
}

/**
 * Everyone in the shop, owners first, then by name.
 *
 * NOT narrowed by the reader's branch reach, deliberately. A manager at อโศก
 * seeing that สมชาย works at สีลม is how they understand why they cannot edit
 * him — and rule 2 already stops them acting on it. Hiding the row would turn
 * a clear refusal into a person who appears not to exist.
 */
export async function getMembersLogic(tenantId: string): Promise<MemberRow[]> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.tenantMembership.findMany({
      where: { tenantId },
      select: {
        id: true,
        userId: true,
        role: true,
        isActive: true,
        allBranches: true,
        roleChangedAt: true,
        user: { select: { email: true, name: true, emailVerified: true } },
        roleChangedByUser: { select: { name: true, email: true } },
        branchAccess: {
          select: { branch: { select: { name: true } } },
        },
      },
    });

    return rows
      .map((r) => ({
        membershipId: r.id,
        userId: r.userId,
        email: r.user.email,
        name: r.user.name,
        role: r.role,
        isActive: r.isActive,
        neverSignedIn: r.user.emailVerified === null,
        allBranches: r.allBranches,
        branchNames: r.branchAccess
          .map((b) => b.branch.name)
          .sort((a, b) => a.localeCompare(b, "th")),
        changedAt: r.roleChangedAt,
        changedByName:
          r.roleChangedByUser === null
            ? null
            : (r.roleChangedByUser.name ?? r.roleChangedByUser.email),
      }))
      .sort((a, b) => {
        // Owners first — it is the one role whose position on the page is
        // information, because it is the one rule 1 protects.
        if (a.role === "owner" !== (b.role === "owner")) {
          return a.role === "owner" ? -1 : 1;
        }
        // Then people who are still here, before people who are not.
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return (a.name ?? a.email).localeCompare(b.name ?? b.email, "th");
      });
  });
}
