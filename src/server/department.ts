// ============================================================
// Mise — creating and maintaining departments (Part 35 L1)
// ============================================================
// Deactivate, never delete. A department is referenced from menus
// (`primary_department_id`), expense lines, and PO/receipt allocations, and
// Part 32's per-department report reads all of them back — deleting one would
// turn last month's ครัว column into "ไม่ระบุแผนก" after the fact.
//
// What deactivating does, concretely: the menu screen's department picker
// already filters `isActive: true` (menus/page.tsx), so a closed department
// stops being offered for new assignments while everything already assigned
// keeps its label.
// ============================================================

import { Prisma, type Department } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type {
  DepartmentInput,
  SetDepartmentActiveInput,
  UpdateDepartmentInput,
} from "@/lib/validations/department";

/** The code receipts and orders fall back to (resolveDefaultDepartmentId). */
export const DEFAULT_DEPARTMENT_CODE = "MAIN";

export class DepartmentCodeTakenError extends Error {
  constructor(public readonly code: string) {
    super(`Department code already in use in this tenant: ${code}`);
    this.name = "DepartmentCodeTakenError";
  }
}

export class DepartmentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Department not found: ${id}`);
    this.name = "DepartmentNotFoundError";
  }
}

/**
 * The MAIN department is where a receipt line lands when nobody allocated it.
 * Closing it would leave that fallback pointing at a department the pickers
 * no longer offer — so it can be renamed (to ครัว, say) but not closed.
 */
export class DefaultDepartmentLockedError extends Error {
  constructor() {
    super("The default (MAIN) department cannot be deactivated");
    this.name = "DefaultDepartmentLockedError";
  }
}

export async function getDepartmentsForAdminLogic(tenantId: string): Promise<Department[]> {
  return withTenantContext(tenantId, (tx) =>
    tx.department.findMany({
      where: { tenantId, deletedAt: null },
      // Main is created with no display_order (tenant-init.ts), and Postgres sorts
      // NULL LAST by default — which put the shop's first department at the bottom.
      orderBy: [{ isActive: "desc" }, { displayOrder: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    })
  );
}

/**
 * Same shape as createBranchLogic: the check runs inside the transaction
 * because an RLS-protected table withholds the constraint's name from P2002
 * (ADR 0030). `department` has no database unique on its code at all, so the
 * check here is the ONLY guard — which is why it is in the same transaction as
 * the insert rather than a separate read before it.
 */
export async function createDepartmentLogic(
  tenantId: string,
  input: DepartmentInput
): Promise<Department> {
  try {
    return await withTenantContext(tenantId, async (tx) => {
      const taken = await tx.department.findFirst({
        where: { tenantId, code: input.code, deletedAt: null },
        select: { id: true },
      });
      if (taken) throw new DepartmentCodeTakenError(input.code);
      const last = await tx.department.aggregate({
        where: { tenantId, deletedAt: null },
        _max: { displayOrder: true },
      });
      return tx.department.create({
        data: {
          tenantId,
          name: input.name,
          code: input.code,
          description: input.description,
          isActive: true,
          displayOrder: (last._max.displayOrder ?? 0) + 1,
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DepartmentCodeTakenError(input.code);
    }
    throw e;
  }
}

export async function updateDepartmentLogic(
  tenantId: string,
  input: UpdateDepartmentInput
): Promise<Department> {
  return withTenantContext(tenantId, async (tx) => {
    const { count } = await tx.department.updateMany({
      where: { id: input.id, tenantId, deletedAt: null },
      data: { name: input.name, description: input.description },
    });
    if (count === 0) throw new DepartmentNotFoundError(input.id);
    return tx.department.findFirstOrThrow({ where: { id: input.id, tenantId } });
  });
}

export async function setDepartmentActiveLogic(
  tenantId: string,
  input: SetDepartmentActiveInput
): Promise<Department> {
  return withTenantContext(tenantId, async (tx) => {
    const dept = await tx.department.findFirst({
      where: { id: input.id, tenantId, deletedAt: null },
    });
    if (!dept) throw new DepartmentNotFoundError(input.id);
    if (!input.isActive && dept.code === DEFAULT_DEPARTMENT_CODE) {
      throw new DefaultDepartmentLockedError();
    }
    if (dept.isActive === input.isActive) return dept;
    return tx.department.update({ where: { id: dept.id }, data: { isActive: input.isActive } });
  });
}
