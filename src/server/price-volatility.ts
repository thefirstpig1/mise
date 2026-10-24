// การผันผวนราคาวัตถุดิบ — the read (Kong 2026-10-24, mockup round 3
// https://claude.ai/artifact/GdWVDbQEZerSWLgWSd3Ago).
//
// Two halves, fetched side by side:
//   prices — every confirmed receipt of the last 26 weeks, averaged per product
//            per week and per calendar month by QUANTITY (rule CO-PRICE v2:
//            average against average, never one receipt against another).
//   menus  — each menu's cost per serving and its raw-product leaves at the
//            branch with the freshest prices (cost needs a branch, ADR 0014
//            Q9; the page names it), with the plates and average price it sold
//            in the latest sales month there, and its food-cost target.
// Everything else (index lines, allowed prices, menu impact) is arithmetic the
// page does from these in src/lib/price-volatility.ts, so a switch never goes
// back to the server.

import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { computeBangkokToday } from "@/lib/bangkok-date";
import type { BranchReach } from "@/lib/permissions/service";
import { averagesIn } from "@/lib/price-average";
import type { MenuCostRow } from "@/lib/price-volatility";
import { getPriceWatchLogic } from "./price-watch";
import { weekRanges, monthRanges } from "./cost-overview";
import { freshestCostBranch } from "./menu-lab-read";
import { resolveRecipeIds } from "./recipe-resolve";
import { recipeCostsInTx } from "./recipe-cost";
import { replayPairsInTx } from "./stock-cost";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const PV_WEEKS = 12;
export const PV_MONTHS = 6;

export type PvBucket = { key: string; label: string; from: string; to: string; partial: boolean };
export type PvProduct = {
  id: string;
  name: string;
  unit: string;
  group: string;
  suppliers: string[];
  /** [average price, quantity] per bucket; null = not bought then. */
  week: ([number, number] | null)[];
  month: ([number, number] | null)[];
  /** Every receipt of the window: [YYYY-MM-DD, price per base unit]. */
  receipts: [string, number][];
};
export type PriceVolatility = {
  today: string;
  lastReceipt: string | null;
  costBranch: { id: string; name: string } | null;
  shopTarget: number;
  salesLabel: string | null;
  weeks: PvBucket[];
  months: PvBucket[];
  products: PvProduct[];
  menus: MenuCostRow[];
};

export async function getPriceVolatilityLogic(tenantId: string, reach: BranchReach): Promise<PriceVolatility> {
  const today = computeBangkokToday();
  const weeks = weekRanges(today, PV_WEEKS);
  const months = monthRanges(today, PV_MONTHS);
  const from = months[0].from < weeks[0].from ? months[0].from : weeks[0].from;

  const [watch, branch, shop] = await Promise.all([
    getPriceWatchLogic(tenantId, { from, to: today }, reach),
    freshestCostBranch(tenantId, reach).catch(() => null),
    withTenantContext(tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { foodCostTargetPct: true } })),
  ]);
  const shopTarget = Number(shop.foodCostTargetPct);
  const points = watch.points;

  // ── prices ────────────────────────────────────────────────────────────────
  const series = (ranges: { from: Date; to: Date }[]) => ranges.map((r) => averagesIn(points, r.from, r.to));
  const W = series(weeks);
  const M = series(months);
  const byProduct = new Map<string, typeof points>();
  for (const p of points) byProduct.set(p.productId, [...(byProduct.get(p.productId) ?? []), p]);
  const products: PvProduct[] = [...byProduct.entries()]
    .map(([id, pts]) => {
      const cell = (m: Map<string, { avg: number; qty: number }>) => {
        const a = m.get(id);
        return a ? ([r2(a.avg), r2(a.qty)] as [number, number]) : null;
      };
      return {
        id,
        name: pts[0].productName,
        unit: pts[0].baseUnit,
        group: pts[0].group,
        suppliers: [...new Set(pts.map((p) => p.supplierName))],
        week: W.map(cell),
        month: M.map(cell),
        receipts: [...pts].sort((a, b) => a.date.getTime() - b.date.getTime()).map((p) => [iso(p.date), r2(p.pricePerBase)] as [string, number]),
      };
    })
    .sort((a, b) => spend(b) - spend(a));
  const lastReceipt = points.length ? iso(new Date(Math.max(...points.map((p) => p.date.getTime())))) : null;

  // ── menus at the freshest branch ─────────────────────────────────────────
  let menus: MenuCostRow[] = [];
  let salesLabel: string | null = null;
  if (branch) {
    const fifo = withTenantContext(
      tenantId,
      async (tx) => {
        const ps = await tx.product.findMany({ where: { tenantId, deletedAt: null }, select: { id: true } });
        return replayPairsInTx(tx as unknown as PrismaClient, tenantId, ps.map((p) => p.id), [branch.id], today);
      },
      { timeout: 20_000 }
    );
    void fifo.catch(() => undefined);
    const out = await withTenantContext(
      tenantId,
      async (raw) => {
        const tx = raw as unknown as PrismaClient;
        const latest = await tx.salesLine.findFirst({
          where: { tenantId, branchId: branch.id, supersededAt: null },
          orderBy: { businessDate: "desc" },
          select: { businessDate: true },
        });
        if (!latest) return { rows: [] as MenuCostRow[], label: null };
        const d = latest.businessDate;
        const mFrom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
        const mTo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
        const [menuRows, sales] = await Promise.all([
          tx.menu.findMany({
            where: { tenantId, deletedAt: null },
            select: { id: true, name: true, foodCostTargetPct: true, primaryDepartment: { select: { name: true } } },
          }),
          tx.salesLine.groupBy({
            by: ["menuId"],
            where: { tenantId, branchId: branch.id, supersededAt: null, businessDate: { gte: mFrom, lte: mTo } },
            _sum: { qty: true, netAmount: true },
          }),
        ]);
        const sold = new Map(sales.filter((s) => s.menuId).map((s) => [s.menuId as string, { qty: Number(s._sum.qty ?? 0), net: Number(s._sum.netAmount ?? 0) }]));
        const targets = menuRows.filter((m) => (sold.get(m.id)?.qty ?? 0) > 0).map((m) => ({ kind: "menu" as const, id: m.id }));
        const resolved = await resolveRecipeIds(tx, tenantId, targets, branch.id, today);
        const recipeIds = [...new Set([...resolved.values()].map((r) => r.id))];
        const costs = recipeIds.length ? await recipeCostsInTx(tx, tenantId, { recipeIds, branchId: branch.id, asOf: today }, { replayed: fifo }) : new Map();
        const rows: MenuCostRow[] = [];
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
            price: r2(s.net / s.qty),
            plates: s.qty,
            cost: r2(Number(c.costPerServing)),
            target: m.foodCostTargetPct === null ? shopTarget : Number(m.foodCostTargetPct),
            ownTarget: m.foodCostTargetPct !== null,
            leaves: c.leaves.map((l: { productId: string; cost: unknown }) => [l.productId, r2(Number(l.cost) / servings)] as [string, number]),
          });
        }
        return { rows, label: `${MONTHS_TH[d.getUTCMonth()]} ${String((d.getUTCFullYear() + 543) % 100).padStart(2, "0")}` };
      },
      { timeout: 30_000 }
    );
    menus = out.rows;
    salesLabel = out.label;
  }

  const bucket = (r: { key: string; label: string; from: Date; to: Date; partial: boolean }): PvBucket => ({ key: r.key, label: r.label, from: iso(r.from), to: iso(r.to), partial: r.partial });
  return {
    today: iso(today),
    lastReceipt,
    costBranch: branch,
    shopTarget,
    salesLabel,
    weeks: weeks.map(bucket),
    months: months.map(bucket),
    products,
    menus,
  };
}

function spend(p: PvProduct) {
  return p.week.reduce((s, c) => s + (c ? c[0] * c[1] : 0), 0) + p.month.reduce((s, c) => s + (c ? c[0] * c[1] : 0), 0);
}

