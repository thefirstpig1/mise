// ============================================================
// Mise — a person's home department (Part 38, ADR 0036 Q3)
// ============================================================
// Where a purchase-request line goes when its author does not choose: the
// person's PRIMARY department. `user_department_assignment.is_primary` has
// existed since Sprint 0 and nothing ever wrote it; this is its first writer.
//
// It grants nothing. Which department a line is filed under is a label, not a
// capability — so this is not subject to the four escalation rules of ADR 0029
// Q10, only to the page gate (member:manage) and the tenant.
// ============================================================

import { withTenantContext } from "@/lib/db";
import { assertRefBelongsToTenant } from "@/server/product";

export class MembershipNotInTenantError extends Error {
  constructor(public readonly membershipId: string) {
    super(`Membership "${membershipId}" is not in this tenant`);
    this.name = "MembershipNotInTenantError";
  }
}

/** Every active member's home department (null = none set → Main). */
export async function getHomeDepartmentsLogic(tenantId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const members = await tx.tenantMembership.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        user: { select: { name: true, email: true } },
        deptAssignments: { where: { isPrimary: true, department: { deletedAt: null } }, select: { departmentId: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return members.map((m) => ({
      membershipId: m.id,
      name: m.user.name ?? m.user.email ?? "",
      departmentId: m.deptAssignments[0]?.departmentId ?? null,
    }));
  });
}

/** Set (or clear, with null) a member's home department. One primary per person. */
export async function setHomeDepartmentLogic(tenantId: string, membershipId: string, departmentId: string | null) {
  return withTenantContext(tenantId, async (tx) => {
    const m = await tx.tenantMembership.findFirst({ where: { id: membershipId, tenantId }, select: { id: true } });
    if (!m) throw new MembershipNotInTenantError(membershipId);
    if (departmentId) await assertRefBelongsToTenant(tx, tenantId, "department", departmentId);

    await tx.userDepartmentAssignment.updateMany({ where: { tenantMembershipId: membershipId, isPrimary: true }, data: { isPrimary: false } });
    if (!departmentId) return;
    await tx.userDepartmentAssignment.upsert({
      where: { tenantMembershipId_departmentId: { tenantMembershipId: membershipId, departmentId } },
      create: { tenantMembershipId: membershipId, departmentId, isPrimary: true },
      update: { isPrimary: true },
    });
  });
}
