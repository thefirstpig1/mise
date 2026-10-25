// ============================================================
// Mise — each sold menu's cost per serving, plates, price and raw leaves
// ============================================================
// One function behind two screens: การผันผวนราคาวัตถุดิบ (which menus a price
// move hurts, rule PV-MENU) and ต้นทุนตามแผนก (which menus and ingredients push
// a department's cost, Kong 2026-10-25). Cost is today's recipe walk at the
// branch's FIFO prices — the price book's figure — never a second engine.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import type { MenuCostRow } from "@/lib/price-volatility";
import type { ProductCost } from "./stock-cost";
import { resolveRecipeIds } from "./recipe-resolve";
import { recipeCostsInTx } from "./recipe-cost";

const r2 = (n: number) => Math.round(n * 100) / 100;

export type MenuCostRowWithDept = MenuCostRow & { departmentId: string | null };

export async function menuCostRowsInTx(
  tx: PrismaClient,
  tenantId: string,
  p: { branchId: string; from: Date; to: Date; asOf: Date; shopTarget: number; replayed: Promise<Map<string, ProductCost>> }
): Promise<MenuCostRowWithDept[]> {
  const [menuRows, sales] = await Promise.all([
    tx.menu.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, foodCostTargetPct: true, primaryDepartmentId: true, primaryDepartment: { select: { name: true } } },
    }),
    tx.salesLine.groupBy({
      by: ["menuId"],
      where: { tenantId, branchId: p.branchId, supersededAt: null, businessDate: { gte: p.from, lte: p.to } },
      _sum: { qty: true, netAmount: true },
    }),
  ]);
  const sold = new Map(sales.filter((s) => s.menuId).map((s) => [s.menuId as string, { qty: Number(s._sum.qty ?? 0), net: Number(s._sum.netAmount ?? 0) }]));
  const targets = menuRows.filter((m) => (sold.get(m.id)?.qty ?? 0) > 0).map((m) => ({ kind: "menu" as const, id: m.id }));
  const resolved = await resolveRecipeIds(tx, tenantId, targets, p.branchId, p.asOf);
  const recipeIds = [...new Set([...resolved.values()].map((r) => r.id))];
  const costs = recipeIds.length ? await recipeCostsInTx(tx, tenantId, { recipeIds, branchId: p.branchId, asOf: p.asOf }, { replayed: p.replayed }) : new Map();
  const rows: MenuCostRowWithDept[] = [];
  for (const m of menuRows) {
    const r = resolved.get(`menu:${m.id}`);
    const s = sold.get(m.id);
    if (!r || !s || s.qty <= 0) continue;
    const c = costs.get(r.id);
    if (!c) continue;
    const servings = Number(c.servings) || 1;
    rows.push({
      menuId: m.id,
      name: m.name,
      department: m.primaryDepartment?.name ?? null,
      departmentId: m.primaryDepartmentId,
      price: r2(s.net / s.qty),
      plates: s.qty,
      cost: r2(Number(c.costPerServing)),
      target: m.foodCostTargetPct === null ? p.shopTarget : Number(m.foodCostTargetPct),
      ownTarget: m.foodCostTargetPct !== null,
      leaves: c.leaves.map((l: { productId: string; cost: unknown }) => [l.productId, r2(Number(l.cost) / servings)] as [string, number]),
    });
  }
  return rows;
}
