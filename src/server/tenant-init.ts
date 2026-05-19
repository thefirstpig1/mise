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

    // 7. Auto-seed 16 default categories (H.1.2)
    const DEFAULT_CATEGORIES = [
      // COGS — Food
      { account: "COGS", accountingSection: "Food", groupName: "Meat" },
      { account: "COGS", accountingSection: "Food", groupName: "Seafood" },
      { account: "COGS", accountingSection: "Food", groupName: "Vegetables" },
      { account: "COGS", accountingSection: "Food", groupName: "Dry goods" },
      // COGS — Beverage
      { account: "COGS", accountingSection: "Beverage", groupName: "Coffee" },
      { account: "COGS", accountingSection: "Beverage", groupName: "Alcohol" },
      { account: "COGS", accountingSection: "Beverage", groupName: "Soft drinks" },
      // COGS — Packaging
      { account: "COGS", accountingSection: "Packaging", groupName: "Single-use" },
      // OpEx — Utilities
      { account: "OpEx", accountingSection: "Utilities", groupName: "Electricity" },
      { account: "OpEx", accountingSection: "Utilities", groupName: "Water" },
      { account: "OpEx", accountingSection: "Utilities", groupName: "Internet" },
      // OpEx — Rent
      { account: "OpEx", accountingSection: "Rent", groupName: "Building" },
      // OpEx — Labor
      { account: "OpEx", accountingSection: "Labor", groupName: "Salary" },
      { account: "OpEx", accountingSection: "Labor", groupName: "Service charge" },
      // OpEx — Marketing
      { account: "OpEx", accountingSection: "Marketing", groupName: "Online ads" },
      // OpEx — Professional
      { account: "OpEx", accountingSection: "Professional", groupName: "Accounting" },
    ];

    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((c) => ({
        tenantId: tenant.id,
        account: c.account,
        accountingSection: c.accountingSection,
        groupName: c.groupName,
      })),
    });

    return { tenant, branch, mainDept, membership: ownerMembership };
  });
}
