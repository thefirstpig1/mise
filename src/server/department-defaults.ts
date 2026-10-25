// ============================================================
// Mise — which department a product most likely belongs to (a SUGGESTION)
// ============================================================
// Forms that ask "which department?" pre-select an answer so nobody has to
// think on an ordinary day (Kong 2026-10-24: "ตั้งแผนกตอนรับของก็ได้"; D2 for
// waste). The person can always change it, and nothing but a form reads it.
//
// The fallback is the department whose live dishes list the product most
// often (menu.primary_department_id). Each form puts its own "what was chosen
// last time" in front of it.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { DEFAULT_DEPARTMENT_CODE } from "@/server/department";

/** Product id → the department whose live dishes use it most. */
export async function recipeDepartmentMajorityInTx(tx: PrismaClient, tenantId: string): Promise<Record<string, string>> {
  const ingredients = await tx.recipeIngredient.findMany({
    where: {
      tenantId,
      productId: { not: null },
      recipe: { isDraft: false, supersededAt: null, deletedAt: null, menu: { deletedAt: null, primaryDepartmentId: { not: null } } },
    },
    select: { productId: true, recipe: { select: { menu: { select: { primaryDepartmentId: true } } } } },
  });
  const tally = new Map<string, Map<string, number>>();
  for (const i of ingredients) {
    const d = i.recipe.menu?.primaryDepartmentId;
    if (!i.productId || !d) continue;
    const m = tally.get(i.productId) ?? new Map<string, number>();
    m.set(d, (m.get(d) ?? 0) + 1);
    tally.set(i.productId, m);
  }
  const out: Record<string, string> = {};
  for (const [p, m] of tally) out[p] = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return out;
}

/**
 * The receipt form's suggestion per product: the department it was last
 * received into — unless that was the MAIN fallback, which says nothing,
 * because every receipt before this form had a picker landed there — else the
 * recipe majority.
 */
export async function receiptDepartmentDefaultsLogic(tenantId: string): Promise<Record<string, string>> {
  return withTenantContext(tenantId, async (tx) => {
    const [majority, last] = await Promise.all([
      recipeDepartmentMajorityInTx(tx as unknown as PrismaClient, tenantId),
      tx.goodsReceiptItemAllocation.findMany({
        where: { tenantId, department: { code: { not: DEFAULT_DEPARTMENT_CODE }, deletedAt: null, isActive: true } },
        orderBy: { createdAt: "desc" },
        take: 1000,
        select: { departmentId: true, goodsReceiptItem: { select: { productId: true } } },
      }),
    ]);
    const out: Record<string, string> = { ...majority };
    const seen = new Set<string>();
    for (const a of last) {
      const p = a.goodsReceiptItem.productId;
      if (seen.has(p)) continue;
      seen.add(p);
      out[p] = a.departmentId;
    }
    return out;
  });
}

/** Active departments for a picker; empty when the shop has fewer than two (no choice to make). */
export async function departmentPickerOptionsLogic(tenantId: string): Promise<{ id: string; name: string; isDefault: boolean }[]> {
  return withTenantContext(tenantId, async (tx) => {
    const [tenant, depts] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { enableDepartments: true } }),
      tx.department.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: [{ displayOrder: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
        select: { id: true, name: true, code: true },
      }),
    ]);
    // The MAIN department is where a line lands when nobody chose — so it is the
    // picker's visible default rather than a separate "ไม่ระบุ" meaning the same.
    return tenant.enableDepartments && depts.length > 1 ? depts.map((d) => ({ id: d.id, name: d.name, isDefault: d.code === DEFAULT_DEPARTMENT_CODE })) : [];
  });
}
