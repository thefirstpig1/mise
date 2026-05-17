// ============================================================
// Mise — Tenant Initialization Logic (Section H.1)
// ============================================================
// Auto-seed function called when new tenant is created
//   1. Create "Main" department
//   2. Assign owner to Main dept (all flags=true)
//
// NOTE: Default categories will be added in Sprint 1 when
//       Category table exists
// ============================================================

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export interface InitTenantInput {
  tenantId: string;
  ownerMembershipId: string;
}

/**
 * Initialize tenant with seed data (H.1).
 * Idempotent — safe to call multiple times.
 */
export async function initializeTenant(input: InitTenantInput) {
  const { tenantId, ownerMembershipId } = input;

  return await prisma.$transaction(async (tx) => {
    // 1. Create or find "Main" department
    const mainDept = await tx.department.upsert({
      where: {
        tenantId_code: {
          tenantId,
          code: "MAIN",
        },
      },
      create: {
        tenantId,
        code: "MAIN",
        name: "Main",
        description: "Default department (auto-created on tenant init)",
        isActive: true,
        displayOrder: 0,
      },
      update: {}, // No-op if exists
    });

    // 2. Assign owner to Main dept with all flags
    await tx.userDepartmentAssignment.upsert({
      where: {
        tenantMembershipId_departmentId: {
          tenantMembershipId: ownerMembershipId,
          departmentId: mainDept.id,
        },
      },
      create: {
        tenantMembershipId: ownerMembershipId,
        departmentId: mainDept.id,
        isPrimary: true,
        canRequestFor: true,
        canApproveFor: true,
        canReceiveFor: true,
      },
      update: {},
    });

    return { mainDept };
  });
}

/**
 * Seed script — run manually with `npm run db:seed`
 * Creates a demo tenant for development/testing
 */
async function main() {
  console.log("🌱 Seeding development data...");

  // Check if seed already ran
  const existingDemo = await prisma.tenant.findFirst({
    where: { name: "Demo Restaurant" },
  });

  if (existingDemo) {
    console.log("✓ Demo tenant already exists, skipping");
    return;
  }

  // Create demo user
  const demoUser = await prisma.user.upsert({
    where: { email: "kongnithipat5@gmail.com" },
    create: {
      email: "kongnithipat5@gmail.com",
      name: "Kongnithipat",
      emailVerified: new Date(),
    },
    update: {},
  });

  // Create demo tenant
  const demoTenant = await prisma.tenant.create({
    data: {
      name: "Demo Restaurant",
      legalName: "Demo Restaurant Co., Ltd.",
      timezone: "Asia/Bangkok",
      currency: "THB",
      plan: "trial",
      enableDepartments: false, // Single-store default
      isVatRegistered: false,
    },
  });

  // Create owner membership
  const ownerMembership = await prisma.tenantMembership.create({
    data: {
      tenantId: demoTenant.id,
      userId: demoUser.id,
      role: "owner",
      isActive: true,
    },
  });

  // Create first branch
  const mainBranch = await prisma.branch.create({
    data: {
      tenantId: demoTenant.id,
      name: "สาขาหลัก",
      code: "MAIN",
      isActive: true,
    },
  });

  // Grant owner access to all branches
  await prisma.userBranchAccess.create({
    data: {
      tenantMembershipId: ownerMembership.id,
      branchId: mainBranch.id,
    },
  });

  // Run tenant init (creates Main dept, assigns owner)
  await initializeTenant({
    tenantId: demoTenant.id,
    ownerMembershipId: ownerMembership.id,
  });

  console.log("✓ Demo tenant created");
  console.log(`  Tenant ID: ${demoTenant.id}`);
  console.log(`  User: ${demoUser.email}`);
  console.log(`  Branch: ${mainBranch.name}`);
  console.log("");
  console.log("➡️ Run `npm run dev` then login at http://localhost:3000");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
