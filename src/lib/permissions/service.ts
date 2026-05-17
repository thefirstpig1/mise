// ============================================================
// Mise — PermissionService (Section H.4)
// ============================================================
// Centralized authorization for triple-filter:
//   role × user_branch_access × user_department_assignment
//
// Sprint 0: Skeleton + tenant isolation tests
// Sprint 2+: Full action+resource matrix
// ============================================================

import { prisma } from "../db";

export type Role = "owner" | "manager" | "purchaser" | "kitchen_staff" | "accountant" | "viewer";
export type ResourceType =
  | "tenant" | "branch" | "department"
  | "supplier" | "product" | "category"
  | "menu" | "recipe"
  | "purchase_request" | "purchase_order" | "goods_receipt"
  | "expense" | "stock_count" | "stock_movement"
  | "sales_transaction";

export type Action = "view" | "create" | "update" | "delete" | "approve" | "receive";

export interface UserContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: Role;
  allowedBranchIds: string[];
  allowedDeptIds: string[];
  deptAssignments: {
    departmentId: string;
    isPrimary: boolean;
    canRequestFor: boolean;
    canApproveFor: boolean;
    canReceiveFor: boolean;
  }[];
  enableDepartments: boolean;
}

/**
 * Load user context for current request.
 * Returns null if user has no active membership.
 */
export async function getUserContext(
  userId: string,
  tenantId: string
): Promise<UserContext | null> {
  const membership = await prisma.tenantMembership.findFirst({
    where: {
      userId,
      tenantId,
      isActive: true,
    },
    include: {
      tenant: { select: { enableDepartments: true } },
      branchAccess: { select: { branchId: true } },
      deptAssignments: true,
    },
  });

  if (!membership) return null;

  return {
    userId,
    tenantId,
    membershipId: membership.id,
    role: membership.role as Role,
    allowedBranchIds: membership.branchAccess.map((b) => b.branchId),
    allowedDeptIds: membership.deptAssignments.map((d) => d.departmentId),
    deptAssignments: membership.deptAssignments.map((d) => ({
      departmentId: d.departmentId,
      isPrimary: d.isPrimary,
      canRequestFor: d.canRequestFor,
      canApproveFor: d.canApproveFor,
      canReceiveFor: d.canReceiveFor,
    })),
    enableDepartments: membership.tenant.enableDepartments,
  };
}

/**
 * Role-based action matrix.
 * Sprint 0: simplified. Sprint 2+: full data-driven from role_permission table.
 */
const ROLE_PERMISSIONS: Record<Role, ResourceType[]> = {
  owner: [
    "tenant", "branch", "department", "supplier", "product", "category",
    "menu", "recipe", "purchase_request", "purchase_order", "goods_receipt",
    "expense", "stock_count", "stock_movement", "sales_transaction",
  ],
  manager: [
    "branch", "department", "supplier", "product", "category",
    "menu", "recipe", "purchase_request", "purchase_order", "goods_receipt",
    "expense", "stock_count", "stock_movement", "sales_transaction",
  ],
  purchaser: ["purchase_request", "purchase_order", "goods_receipt", "supplier"],
  kitchen_staff: ["purchase_request", "stock_count", "goods_receipt"],
  accountant: ["expense", "sales_transaction", "stock_count"],
  viewer: [],
};

/**
 * Check if user can perform action on resource type.
 * Sprint 0: role-based only. Sprint 2+: + branch + dept scoping.
 */
export function canPerform(
  user: UserContext,
  resourceType: ResourceType,
  action: Action
): boolean {
  // Owner can do everything
  if (user.role === "owner") return true;

  // Viewer can only view
  if (user.role === "viewer") return action === "view";

  // Check role-resource matrix
  const allowedResources = ROLE_PERMISSIONS[user.role] ?? [];
  if (!allowedResources.includes(resourceType)) return false;

  // Sprint 0: allow all actions if resource is in allowed list
  // Sprint 2+: granular action check
  return true;
}

/**
 * Check if user has access to specific branch.
 */
export function canAccessBranch(user: UserContext, branchId: string): boolean {
  if (user.role === "owner") return true;
  return user.allowedBranchIds.includes(branchId);
}

/**
 * Check if user has access to specific department.
 * If tenant.enable_departments=false, all checks pass (single "Main" dept).
 */
export function canAccessDepartment(user: UserContext, departmentId: string): boolean {
  if (!user.enableDepartments) return true;
  if (user.role === "owner") return true;
  return user.allowedDeptIds.includes(departmentId);
}
