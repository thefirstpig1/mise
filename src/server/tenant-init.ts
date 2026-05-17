// ============================================================
// Mise — Tenant Service
// ============================================================
// Handles tenant creation with auto-seed (H.1)
// Called from /api/tenant/create or signup flow
// ============================================================

import { prisma } from "../lib/db";
import { initializeTenant } from "../../prisma/seed";

export interface CreateTenantInput {
  ownerUserId: string;
  tenantName: string;
  legalName?: string;
  taxId?: string;
  isVatRegistered?: boolean;
  vatRegistrationNo?: string;
  firstBranchName?: string;
  firstBranchCode?: string;
}

/**
 * Create new tenant with full initialization:
 * 1. Create tenant row
 * 2. Create owner membership
 * 3. Create first branch
 * 4. Grant owner branch access
 * 5. Auto-seed Main dept + assign owner (H.1)
 */
export async function createTenant(input: CreateTenantInput) {
  return await prisma.$transaction(async (tx) => {
    // 1. Create tenant
    const tenant = await tx.tenant.create({
      data: {
        name: input.tenantName,
        legalName: input.legalName,
        taxId: input.taxId,
        isVatRegistered: input.isVatRegistered ?? false,
        vatRegistrationNo: input.vatRegistrationNo,
        plan: "trial",
        enableDepartments: false, // opt-in (Decision #41)
      },
    });

    // 2. Create owner membership
    const ownerMembership = await tx.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: input.ownerUserId,
        role: "owner",
        isActive: true,
      },
    });

    // 3. Create first branch
    const branch = await tx.branch.create({
      data: {
        tenantId: tenant.id,
        name: input.firstBranchName ?? "สาขาหลัก",
        code: input.firstBranchCode ?? "MAIN",
        isActive: true,
      },
    });

    // 4. Grant owner access to first branch
    await tx.userBranchAccess.create({
      data: {
        tenantMembershipId: ownerMembership.id,
        branchId: branch.id,
      },
    });

    // 5. Auto-seed Main dept (raw SQL because we're inside transaction)
    const mainDept = await tx.department.create({
      data: {
        tenantId: tenant.id,
        code: "MAIN",
        name: "Main",
        description: "Default department (auto-created on tenant init)",
        isActive: true,
        displayOrder: 0,
      },
    });

    // 6. Assign owner to Main dept
    await tx.userDepartmentAssignment.create({
      data: {
        tenantMembershipId: ownerMembership.id,
        departmentId: mainDept.id,
        isPrimary: true,
        canRequestFor: true,
        canApproveFor: true,
        canReceiveFor: true,
      },
    });

    return { tenant, branch, mainDept, membership: ownerMembership };
  });
}
