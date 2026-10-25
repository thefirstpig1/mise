// ============================================================
// Mise — ต้นทุนตามแผนก, the question-first page (Kong 2026-10-25, mockup
// X2ShNU69NhR3VdeTBm1Fnf, brief UquT29bbnRBaE6bkTuRsoP)
// ============================================================
// Eight questions, every figure from an engine that already exists:
//   1–2  revenue, material cost, cost % and gross profit per department —
//        getDepartmentReportLogic (ADR 0032: the TOTAL from the ledger, only
//        the SPLIT from the menus), this period and the one before; the
//        department's target = its menus' own targets weighted by revenue
//   3    the trend — the same report per bucket (getDepartmentTrendLogic,
//        loaded after paint)
//   4–5  which menus overspend and which ingredients eat the money —
//        menuCostRowsInTx, today's recipe walk at FIFO prices (the price book)
//   6    ordered vs used — receipt lines allocated to the department vs the
//        material cost it consumed: two numbers that must never be added (F3)
//   7    labor by department — expense lines filed under a department
//   8    trust — consumption coverage, menus with no recipe
// Waste and count variance are NOT split by department (F7): nobody recorded
// whose hands the missing stock left.
// ============================================================

import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { getDepartmentReportLogic } from "./department-read";
import { menuCostRowsInTx } from "./menu-cost-rows";
import { replayPairsInTx } from "./stock-cost";
import { LABOR_SECTIONS } from "./cost-overview";

const BKK_MS = 7 * 3_600_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (d: { toString(): string } | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));
const key = (d: string | null) => d ?? "none";

export type DeptPeriod = { from: Date; to: Date };

export type DeptFigures = { revenue: number; cost: number };

export type DepartmentOverview = {
  departments: { id: string; name: string }[];
  /** Keyed by department id, "none" = ไม่ระบุแผนก. */
  current: Record<string, DeptFigures>;
  previous: Record<string, DeptFigures>;
  /** Revenue-weighted menu targets (%), per department. */
  targets: Record<string, number>;
  shopTarget: number;
  grossProfitUnavailable: boolean;
  /** Share of the period's revenue whose consumption posted (rule F10). */
  coverage: number | null;
  previousCoverage: number | null;
  postedDays: number;
  skippedMenus: number;
  menus: {
    menuId: string;
    name: string;
    dept: string;
    plates: number;
    revenue: number;
    cost: number;
    costPct: number | null;
    target: number;
    /** Baht over the menu's own target in the period; negative = under. */
    over: number;
  }[];
  /** Per department: the raw products its sold menus consumed, by baht. */
  ingredients: Record<string, { productId: string; name: string; baht: number }[]>;
  ordered: Record<string, number>;
  /** Receipt lines in the period at all — false means question 6 cannot be answered. */
  anyOrderedByDept: boolean;
  labor: Record<string, number>;
  laborUnassigned: number;
  menusPeriodLabel: string;
};

const figures = (rows: { departmentId: string | null; revenue: { toString(): string }; materialCost: { toString(): string } }[]) =>
  Object.fromEntries(rows.map((r) => [key(r.departmentId), { revenue: r2(num(r.revenue)), cost: r2(num(r.materialCost)) }]));

export async function getDepartmentOverviewLogic(
  tenantId: string,
  branchId: string,
  period: DeptPeriod,
  previous: DeptPeriod,
  label: string
): Promise<DepartmentOverview> {
  const today = computeBangkokToday();
  const start = new Date(period.from.getTime() - BKK_MS);
  const end = new Date(addDays(period.to, 1).getTime() - BKK_MS);

  const fifo = withTenantContext(
    tenantId,
    async (tx) => {
      const ps = await tx.product.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } });
      return replayPairsInTx(tx as unknown as PrismaClient, tenantId, ps.map((p) => p.id), [branchId], today);
    },
    { timeout: 20_000 }
  );
  void fifo.catch(() => undefined);

  const [cur, prev, side, menuRows] = await Promise.all([
    getDepartmentReportLogic(tenantId, { branchId, ...period }),
    getDepartmentReportLogic(tenantId, { branchId, ...previous }),
    withTenantContext(tenantId, async (tx) => {
      const [tenant, depts, alloc, labor, products] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { foodCostTargetPct: true } }),
        tx.department.findMany({
          where: { tenantId, deletedAt: null },
          orderBy: [{ displayOrder: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
          select: { id: true, name: true, code: true },
        }),
        tx.goodsReceiptItemAllocation.findMany({
          where: { tenantId, goodsReceiptItem: { goodsReceipt: { branchId, status: { not: "DRAFT" }, receivedAt: { gte: start, lt: end } } } },
          select: { departmentId: true, qtyAllocatedActual: true, goodsReceiptItem: { select: { qtyReceivedActual: true, lineTotalActual: true } } },
        }),
        tx.expenseItem.findMany({
          where: {
            tenantId,
            expense: { branchId, deletedAt: null, billDate: { gte: period.from, lte: period.to } },
            category: { account: "OpEx", accountingSection: { in: LABOR_SECTIONS } },
          },
          select: { departmentId: true, totalPrice: true },
        }),
        tx.product.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      ]);
      return { tenant, depts, alloc, labor, products };
    }),
    withTenantContext(
      tenantId,
      (tx) => menuCostRowsInTx(tx as unknown as PrismaClient, tenantId, { branchId, from: period.from, to: period.to, asOf: today, shopTarget: 35, replayed: fifo }),
      { timeout: 30_000 }
    ),
  ]);

  const shopTarget = num(side.tenant.foodCostTargetPct);
  const menusTargeted = menuRows.map((m) => (m.ownTarget ? m : { ...m, target: shopTarget }));

  // Department target = its menus' targets weighted by revenue (Q2).
  const tw = new Map<string, { w: number; t: number }>();
  for (const m of menusTargeted) {
    const k = key(m.departmentId);
    const rev = m.price * m.plates;
    const cur = tw.get(k) ?? { w: 0, t: 0 };
    cur.w += rev;
    cur.t += rev * m.target;
    tw.set(k, cur);
  }
  const targets = Object.fromEntries([...tw].map(([k, v]) => [k, v.w > 0 ? r2(v.t / v.w) : shopTarget]));

  // Q5: Σ leaf × plates per department.
  const nameOf = new Map(side.products.map((p) => [p.id, p.name]));
  const ing = new Map<string, Map<string, number>>();
  for (const m of menusTargeted) {
    const k = key(m.departmentId);
    const bag = ing.get(k) ?? new Map<string, number>();
    for (const [pid, baht] of m.leaves) bag.set(pid, (bag.get(pid) ?? 0) + baht * m.plates);
    ing.set(k, bag);
  }
  const ingredients = Object.fromEntries(
    [...ing].map(([k, bag]) => [
      k,
      [...bag]
        .map(([productId, baht]) => ({ productId, name: nameOf.get(productId) ?? "", baht: r2(baht) }))
        .sort((a, b) => b.baht - a.baht)
        .slice(0, 8),
    ])
  );

  // Q6: what each department was allocated on receipts (pre-VAT line value).
  const ordered: Record<string, number> = {};
  for (const a of side.alloc) {
    const q = num(a.goodsReceiptItem.qtyReceivedActual);
    const share = q === 0 ? 0 : num(a.qtyAllocatedActual) / q;
    ordered[a.departmentId] = r2((ordered[a.departmentId] ?? 0) + num(a.goodsReceiptItem.lineTotalActual) * share);
  }
  const mainId = side.depts.find((d) => d.code === "MAIN")?.id;
  const anyOrderedByDept = Object.keys(ordered).some((d) => d !== mainId);

  const labor: Record<string, number> = {};
  let laborUnassigned = 0;
  for (const l of side.labor) {
    if (l.departmentId) labor[l.departmentId] = r2((labor[l.departmentId] ?? 0) + num(l.totalPrice));
    else laborUnassigned = r2(laborUnassigned + num(l.totalPrice));
  }

  const coverageOf = (r: typeof cur) => (num(r.revenueTotal) > 0 ? Math.min(1, num(r.coveredNetAmount) / num(r.revenueTotal)) : null);

  return {
    departments: side.depts.map((d) => ({ id: d.id, name: d.name })),
    current: figures(cur.rows),
    previous: figures(prev.rows),
    targets,
    shopTarget,
    grossProfitUnavailable: cur.grossProfitUnavailable,
    coverage: coverageOf(cur),
    previousCoverage: coverageOf(prev),
    postedDays: cur.postedDays,
    skippedMenus: cur.skippedMenuIds.length,
    menus: menusTargeted
      .map((m) => {
        const revenue = r2(m.price * m.plates);
        const cost = r2(m.cost * m.plates);
        return {
          menuId: m.menuId,
          name: m.name,
          dept: key(m.departmentId),
          plates: m.plates,
          revenue,
          cost,
          costPct: revenue > 0 ? r2((cost / revenue) * 100) : null,
          target: m.target,
          over: r2(cost - (m.target / 100) * revenue),
        };
      })
      .sort((a, b) => b.over - a.over),
    ingredients,
    ordered,
    anyOrderedByDept,
    labor,
    laborUnassigned,
    menusPeriodLabel: label,
  };
}

/** Q3: the same report per bucket, in parallel — loaded after paint. */
export async function getDepartmentTrendLogic(tenantId: string, branchId: string, buckets: (DeptPeriod & { key: string; label: string })[]) {
  // Three at a time: each report replays FIFO and explodes recipes (~2 s), and
  // twelve weeks at once would hold twelve connections for the length of it.
  const reports: Awaited<ReturnType<typeof getDepartmentReportLogic>>[] = new Array(buckets.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, buckets.length) }, async () => {
      for (let i = next++; i < buckets.length; i = next++) {
        reports[i] = await getDepartmentReportLogic(tenantId, { branchId, from: buckets[i].from, to: buckets[i].to });
      }
    })
  );
  return buckets.map((b, i) => {
    const r = reports[i];
    const total = num(r.revenueTotal);
    return {
      key: b.key,
      label: b.label,
      coverage: total > 0 ? Math.min(1, num(r.coveredNetAmount) / total) : null,
      byDept: figures(r.rows),
    };
  });
}
