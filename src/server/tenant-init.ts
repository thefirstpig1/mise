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
    //
    // `allBranches` is written here rather than left to the column default,
    // because the owner is created BEFORE the first branch exists (step 3) and
    // therefore cannot be granted reach by enumeration. It is also the reason
    // `canAccessBranch` needs no owner special-case any more (ADR 0029 Q5b).
    const ownerMembership = await tx.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: input.ownerUserId,
        role: "owner",
        isActive: true,
        allBranches: true,
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

    // 7. Auto-seed 17 default categories (H.1.2)
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
      // OpEx — Commission (Part 19, ADR 0019 Q12). A delivery platform keeps
      // 25-32% of an order; the Thai trade calls that "GP", which is NOT this
      // project's gross profit. It is seeded rather than left to each shop to
      // name, because it is one of the largest costs a restaurant carries and
      // letting every tenant invent a label makes it impossible to compare.
      // Revenue stays the price on the bill — the commission is an expense,
      // never a deduction from revenue (rule P16).
      { account: "OpEx", accountingSection: "Commission", groupName: "Delivery apps" },
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
