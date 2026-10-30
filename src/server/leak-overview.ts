// ของหายไปไหน — question-first (Kong 2026-10-24, mockup
// https://claude.ai/artifact/3Agisejn3ERh1AXMZgkphj; research brief
// https://claude.ai/artifact/QMbfAJtRRM7e9uFoAb1o3a).
//
// The unit is ONE CLOSED COUNT, not a date window: a count is the event that
// found the money, and "did it happen again" is a question across counts.
//
// Each figure, and where it comes from:
//   value        the count's own ADJUST_LOSS outflows, valued by the FIFO replay
//                (the same number /cost calls ไม่ตรงกับระบบ, rule CO-COUNT)
//   expected     stock_count_item.qty_expected, summed per product
//   sinceRevenue sales since the previous closed count of that branch
//   hints        rule LK-HINT — facts around the number, never a verdict:
//                share of expected · counted by the piece and only ever sold
//                as-is · received on the count day · waste ever recorded ·
//                a menu sold without a recipe whose name holds the product's
//   trust        products counted vs in stock before the count day · sales
//                days posted to stock before the count · menus sold with no
//                recipe · lines counted ABOVE the system
//
// Nothing here is stored and nothing writes. Department usage (ADR 0032 Q7:
// named, never blamed) is read only when the shop uses departments.

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, bangkokDayStartUtc, computeBangkokToday } from "@/lib/bangkok-date";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";
import { replayPairsInTx, costKeyOf } from "./stock-cost";
import { departmentDemandForPeriodLogic } from "./department-cost";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dayTh = (d: Date) => `${d.getUTCDate()} ${MONTHS_TH[d.getUTCMonth()]}`;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;
/** A count line that differs by less than this share of what was expected is "ordinary" (rule LK-HINT). */
export const ORDINARY_SHARE = 0.02;

export type LeakItem = {
  productId: string;
  name: string;
  unit: string;
  /** Positive magnitude. */
  qty: number;
  expected: number;
  /** Baht. Short items: the FIFO value of the loss. Over items: qty × unit cost, approximate, null without a cost. */
  value: number | null;
  /** Counted by the piece AND every live recipe using it is that product alone (a bottle of beer). */
  soldAsIs: boolean;
  /** Received on the count day: `"24 kg"`, with the receipt. */
  sameDay: { label: string; grId: string; grNumber: string } | null;
  /** Waste logs for this product at this branch between the previous count and this one. */
  wasteLogs: number;
  recipes: number;
  /** Menus sold since the previous count with no recipe whose name holds this product's name. */
  noRecipeMenus: { name: string; qty: number }[];
  usage: { name: string; percent: number }[];
};

export type LeakCount = {
  id: string;
  scNumber: string;
  branchId: string;
  branchName: string;
  date: string;
  dateLabel: string;
  countedBy: string[];
  value: number;
  sinceRevenue: number | null;
  sinceLabel: string;
  short: LeakItem[];
  over: LeakItem[];
  trust: {
    counted: number;
    stocked: number;
    salesDays: number;
    postedDays: number;
    noRecipe: { count: number; revenue: number; names: string[] };
  };
};

export type LeakOverview = {
  today: string;
  target: number;
  branches: { id: string; name: string }[];
  counts: LeakCount[];
};

/** The core of a product name for matching a menu name: "เบียร์สิงห์ 620 มล." → "เบียร์สิงห์". */
export function nameCore(name: string): string {
  return name.replace(/\s*\d.*$/, "").replace(/\s*\(.*\)$/, "").trim();
}

export async function getLeakOverviewLogic(tenantId: string, reach: BranchReach): Promise<LeakOverview> {
  return withTenantContext(
    tenantId,
    async (raw) => {
      const tx = raw as unknown as PrismaClient;
      const today = computeBangkokToday();
      const [tenant, branches] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { countVarianceTargetPct: true, enableDepartments: true, cancelledSalePolicy: true },
        }),
        tx.branch.findMany({
          where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ]);
      const branchIds = branches.map((b) => b.id);
      const base = { today: iso(today), target: num(tenant.countVarianceTargetPct), branches };
      if (branchIds.length === 0) return { ...base, counts: [] };

      const counts = await tx.stockCount.findMany({
        where: { tenantId, branchId: { in: branchIds }, status: "CLOSED", deletedAt: null },
        select: {
          id: true,
          scNumber: true,
          branchId: true,
          countDate: true,
          closedAt: true,
          items: {
            where: { reversalOfItemId: null },
            select: { productId: true, qtyExpected: true, countedByName: true, countedByUser: { select: { name: true, email: true } } },
          },
        },
        orderBy: { countDate: "asc" },
      });
      if (counts.length === 0) return { ...base, counts: [] };

      const itemIds = await tx.stockCountItem.findMany({
        where: { tenantId, stockCountId: { in: counts.map((c) => c.id) } },
        select: { id: true, stockCountId: true },
      });
      const countOfItem = new Map(itemIds.map((i) => [i.id, i.stockCountId]));

      const [moves, products, revenueDays, runs, recipes, receipts, wastes, priorBalances] = await Promise.all([
        tx.stockMovement.findMany({
          where: { tenantId, branchId: { in: branchIds }, sourceType: "STOCK_COUNT", sourceId: { in: itemIds.map((i) => i.id) }, type: { in: ["ADJUST_LOSS", "ADJUST_GAIN"] } },
          select: { id: true, productId: true, sourceId: true, type: true, qty: true },
        }),
        tx.product.findMany({
          where: { tenantId },
          select: { id: true, name: true, primaryDimension: true, productUnits: { where: { isBase: true }, select: { unitName: true } } },
        }),
        tx.salesLine.groupBy({
          by: ["branchId", "businessDate", "menuId"],
          where: { tenantId, supersededAt: null, branchId: { in: branchIds } },
          _sum: { netAmount: true, qty: true },
        }),
        // Every run, voided ones included (2026-10-31): the chip asks whether a
        // day had been deducted WHEN THE COUNT CLOSED, and a day posted before
        // the count and re-posted after it was.
        tx.salesConsumptionRun.findMany({
          where: { tenantId, branchId: { in: branchIds } },
          select: { branchId: true, businessDate: true, postedAt: true },
        }),
        tx.recipe.findMany({
          where: { tenantId, deletedAt: null, isDraft: false, supersededAt: null },
          select: { menuId: true, ingredients: { select: { productId: true } } },
        }),
        tx.goodsReceiptItem.findMany({
          where: {
            tenantId,
            reversalOfItemId: null,
            goodsReceipt: { tenantId, status: "CONFIRMED", deletedAt: null, branchId: { in: branchIds }, receivedAt: { gte: bangkokDayStartUtc(counts[0].countDate) } },
          },
          select: {
            productId: true,
            qtyReceivedActual: true,
            toBaseRatio: true,
            goodsReceipt: { select: { id: true, grNumber: true, branchId: true, receivedAt: true } },
          },
        }),
        tx.wasteLog.findMany({
          where: { tenantId, branchId: { in: branchIds }, voidedAt: null, reversalOfId: null },
          select: { productId: true, branchId: true, occurredAt: true },
        }),
        Promise.all(
          counts.map((c) =>
            tx.stockMovement.groupBy({
              by: ["productId"],
              where: { tenantId, branchId: c.branchId, occurredAt: { lt: bangkokDayStartUtc(c.countDate) } },
              _sum: { qty: true },
            })
          )
        ),
      ]);

      const nameOf = new Map(products.map((p) => [p.id, p.name]));
      const unitOf = new Map(products.map((p) => [p.id, p.productUnits[0]?.unitName ?? ""]));
      const byPiece = new Map(products.map((p) => [p.id, p.primaryDimension === "COUNT"]));

      // Recipes per product; "sold as-is" when every live recipe using it holds it alone.
      const recipesOf = new Map<string, number>();
      const aloneOf = new Map<string, boolean>();
      const menusWithRecipe = new Set<string>();
      for (const r of recipes) {
        if (r.menuId) menusWithRecipe.add(r.menuId);
        const ids = [...new Set(r.ingredients.map((i) => i.productId).filter((x): x is string => !!x))];
        for (const id of ids) {
          recipesOf.set(id, (recipesOf.get(id) ?? 0) + 1);
          aloneOf.set(id, (aloneOf.get(id) ?? true) && r.ingredients.length === 1);
        }
      }
      const menuIds = [...new Set(revenueDays.map((r) => r.menuId).filter((x): x is string => !!x))];
      const menus = menuIds.length
        ? await tx.menu.findMany({ where: { tenantId, id: { in: menuIds } }, select: { id: true, name: true } })
        : [];
      const menuName = new Map(menus.map((m) => [m.id, m.name]));

      // One replay serves the loss values and the unit costs of over-counts.
      const productIds = [...new Set(moves.map((m) => m.productId))];
      const replayed = productIds.length ? await replayPairsInTx(tx, tenantId, productIds, branchIds, today) : new Map();
      const lossValue = new Map<string, number>();
      for (const state of replayed.values()) {
        for (const out of state.outflows) {
          if (out.sourceType === "STOCK_COUNT" && out.type === "ADJUST_LOSS") lossValue.set(out.movementId, (lossValue.get(out.movementId) ?? 0) + num(out.value));
        }
      }

      const out: LeakCount[] = [];
      for (let ci = 0; ci < counts.length; ci++) {
        const c = counts[ci];
        const prev = counts.slice(0, ci).filter((p) => p.branchId === c.branchId).at(-1);
        const lo = prev ? prev.countDate.getTime() : -Infinity;
        const hi = c.countDate.getTime();
        const inWindow = (d: Date) => d.getTime() > lo && d.getTime() <= hi;

        // money and quantity per product, from the ledger
        const per = new Map<string, { qty: number; value: number }>();
        for (const m of moves) {
          if (countOfItem.get(m.sourceId) !== c.id) continue;
          const cur = per.get(m.productId) ?? { qty: 0, value: 0 };
          cur.qty += num(m.qty);
          if (m.type === "ADJUST_LOSS") cur.value += lossValue.get(m.id) ?? 0;
          per.set(m.productId, cur);
        }
        const expected = new Map<string, number>();
        for (const it of c.items) expected.set(it.productId, (expected.get(it.productId) ?? 0) + num(it.qtyExpected));

        // sales in the window: revenue, days, menus without a recipe
        const sales = revenueDays.filter((r) => r.branchId === c.branchId && inWindow(r.businessDate));
        const sinceRevenue = sales.reduce((s, r) => s + num(r._sum.netAmount), 0);
        // "ตัดสต๊อกก่อนนับ" — the days BEFORE the count date, deducted by the
        // time the count closed. Not the count day: whether its sales came
        // before or after the counting depends on when the shop counts.
        // Counting runs that exist today said "posted" for a day imported a
        // week after the count, which is exactly the case this chip is for.
        const closedAt = (c.closedAt ?? new Date()).getTime();
        const salesDays = new Set(sales.filter((r) => r.businessDate.getTime() < hi).map((r) => iso(r.businessDate)));
        const postedDays = new Set(
          runs.filter((r) => r.branchId === c.branchId && inWindow(r.businessDate) && r.postedAt.getTime() <= closedAt).map((r) => iso(r.businessDate))
        );
        const noRecipe = new Map<string, { qty: number; revenue: number }>();
        for (const r of sales) {
          if (!r.menuId || menusWithRecipe.has(r.menuId)) continue;
          const cur = noRecipe.get(r.menuId) ?? { qty: 0, revenue: 0 };
          cur.qty += num(r._sum.qty);
          cur.revenue += num(r._sum.netAmount);
          noRecipe.set(r.menuId, cur);
        }

        const usageOf = new Map<string, { name: string; percent: number }[]>();
        if (tenant.enableDepartments) {
          const demand = await departmentDemandForPeriodLogic(tx, tenantId, {
            branchId: c.branchId,
            from: prev ? addDays(prev.countDate, 1) : addDays(c.countDate, -30),
            to: c.countDate,
            cancelledSalePolicy: tenant.cancelledSalePolicy,
          });
          const deptIds = [...new Set([...demand.demand.values()].flat().map((d) => d.departmentId).filter((d): d is string => d !== null))];
          const depts = deptIds.length ? await tx.department.findMany({ where: { tenantId, id: { in: deptIds } }, select: { id: true, name: true } }) : [];
          const dn = new Map(depts.map((d) => [d.id, d.name]));
          for (const [pid, rows] of demand.demand) {
            const total = rows.reduce((s, r) => s + Math.abs(num(r.qty)), 0);
            if (total <= 0) continue;
            usageOf.set(
              pid,
              rows
                .map((r) => ({ name: r.departmentId === null ? "ไม่ระบุแผนก" : dn.get(r.departmentId) ?? "แผนก", percent: Math.round((Math.abs(num(r.qty)) / total) * 100) }))
                .sort((a, b) => b.percent - a.percent)
            );
          }
        }

        const item = (productId: string, v: { qty: number; value: number }, over: boolean): LeakItem => {
          const core = nameCore(nameOf.get(productId) ?? "");
          const sameDay = receipts.filter(
            (g) => g.productId === productId && g.goodsReceipt.branchId === c.branchId && sameBangkokDay(g.goodsReceipt.receivedAt, c.countDate)
          );
          const sameQty = sameDay.reduce((s, g) => s + num(g.qtyReceivedActual) * num(g.toBaseRatio), 0);
          const state = replayed.get(costKeyOf(productId, c.branchId));
          const unitCost = state ? num(state.lastKnownUnitCost ?? state.costPerBaseUnit) : 0;
          return {
            productId,
            name: nameOf.get(productId) ?? productId,
            unit: unitOf.get(productId) ?? "",
            qty: Math.abs(v.qty),
            expected: expected.get(productId) ?? 0,
            value: over ? (unitCost > 0 ? round2(Math.abs(v.qty) * unitCost) : null) : round2(v.value),
            soldAsIs: (byPiece.get(productId) ?? false) && (aloneOf.get(productId) ?? false),
            sameDay: sameDay.length
              ? { label: `${sameQty.toLocaleString("th-TH", { maximumFractionDigits: 3 })} ${unitOf.get(productId) ?? ""}`.trim(), grId: sameDay[0].goodsReceipt.id, grNumber: sameDay[0].goodsReceipt.grNumber }
              : null,
            wasteLogs: wastes.filter((w) => w.productId === productId && w.branchId === c.branchId && inWindow(bangkokDayOf(w.occurredAt))).length,
            recipes: recipesOf.get(productId) ?? 0,
            noRecipeMenus:
              core.length >= 2
                ? [...noRecipe.entries()].filter(([mid]) => (menuName.get(mid) ?? "").includes(core)).map(([mid, s]) => ({ name: menuName.get(mid) ?? "", qty: s.qty }))
                : [],
            usage: usageOf.get(productId) ?? [],
          };
        };
        const short = [...per.entries()].filter(([, v]) => v.qty < 0).map(([id, v]) => item(id, v, false)).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
        const over = [...per.entries()].filter(([, v]) => v.qty > 0).map(([id, v]) => item(id, v, true)).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

        const counters = [...new Set(c.items.map((i) => i.countedByName || i.countedByUser.name || i.countedByUser.email || "").filter(Boolean))];
        out.push({
          id: c.id,
          scNumber: c.scNumber,
          branchId: c.branchId,
          branchName: branches.find((b) => b.id === c.branchId)?.name ?? "",
          date: iso(c.countDate),
          dateLabel: dayTh(c.countDate),
          countedBy: counters,
          value: round2(short.reduce((s, i) => s + (i.value ?? 0), 0)),
          sinceRevenue: sinceRevenue > 0 ? round2(sinceRevenue) : null,
          sinceLabel: prev ? `ตั้งแต่นับครั้งก่อน (${dayTh(prev.countDate)})` : "ตั้งแต่เริ่มมีข้อมูล (นับครั้งแรก)",
          short,
          over,
          trust: {
            counted: new Set(c.items.map((i) => i.productId)).size,
            stocked: priorBalances[ci].filter((b) => num(b._sum.qty) > 0).length,
            salesDays: salesDays.size,
            postedDays: [...salesDays].filter((d) => postedDays.has(d)).length,
            noRecipe: {
              count: noRecipe.size,
              revenue: round2([...noRecipe.values()].reduce((s, x) => s + x.revenue, 0)),
              names: [...noRecipe.entries()].sort((a, b) => b[1].revenue - a[1].revenue).map(([mid]) => menuName.get(mid) ?? ""),
            },
          },
        });
      }
      return { ...base, counts: out };
    },
    { timeout: 30_000 }
  );
}

/** The Bangkok business day (as a UTC-midnight value) an instant falls on. */
function bangkokDayOf(instant: Date): Date {
  const b = new Date(instant.getTime() + 7 * 3600 * 1000);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
}

/** A receipt's instant falls on the count's Bangkok business day. */
function sameBangkokDay(instant: Date, day: Date): boolean {
  const start = bangkokDayStartUtc(day).getTime();
  return instant.getTime() >= start && instant.getTime() < start + 86_400_000;
}
