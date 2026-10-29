// /cost — question-first overview (Kong 2026-10-23, mockup v7
// https://claude.ai/artifact/T9zrVfBMAChWBaaZgEaYj5; research brief
// https://claude.ai/artifact/61gpF3mXzc2PnUHVUTD5UN).
//
// What an owner asks of a cost page, in order: is the shop healthy (prime cost,
// food cost against the shop's OWN targets), is it getting better or worse
// (week by week), what do I deal with first (ranked by money), which branch is
// better, how much money sits in stock and for how long, and can I trust these
// numbers.
//
// NO COST ARITHMETIC OF ITS OWN (the Part 35 P&L rule). Every period figure is
// `getBranchCostSummariesLogic`'s, so a week here and the same dates on the
// detailed table can never disagree. What this file adds is only what that
// summary does not hold: labour spread over days (rule CO-LABOR), each closed
// count's own shortfall (CO-COUNT), what price rises cost (CO-PRICE), and the
// age of the oldest lot still on the shelf (CO-AGE).

import { Prisma } from "@prisma/client";
import { grossProfitBlockerShort } from "@/lib/gross-profit-blocker";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";
import { DEFAULT_CATEGORIES } from "@/lib/category-seed";
import { getBranchCostSummariesLogic, replayPairsInTx, costKeyOf } from "./stock-cost";
import { ingredientFactsInTx } from "./menu-manager";
import { getPriceWatchLogic } from "./price-watch";
import { priceMovesFor, type PriceMove } from "@/lib/price-average";

export const WEEKS_SHOWN = 12;
export const MONTHS_SHOWN = 6;

const DAY = 86_400_000;
const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;
const dayTh = (d: Date) => `${d.getUTCDate()} ${MONTHS_TH[d.getUTCMonth()]}`;
const monthTh = (d: Date) => `${MONTHS_TH[d.getUTCMonth()]} ${String((d.getUTCFullYear() + 543) % 100).padStart(2, "0")}`;
const monthKey = (d: Date) => iso(d).slice(0, 7);
const daysInMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

/** The labour sections, in both spellings a shop's categories can carry (Part 35 rename). */
export const LABOR_SECTIONS = [
  ...new Set(DEFAULT_CATEGORIES.filter((c) => c.en.section === "Labor").flatMap((c) => [c.en.section, c.th.section])),
];

export type CostTargets = {
  food: number;
  prime: number;
  variance: number;
  /** Rule CO-COV, as a share 0–1. */
  coverageMin: number;
  slowDays: number;
};

export type CostCell = {
  revenue: number | null;
  /** Cost of goods SOLD, by the shop's gross-profit method. */
  cogs: number | null;
  /**
   * Share of revenue posted to stock (0–1). `null` under นับสต๊อก, where the
   * figure is the accounting identity and coverage does not apply.
   */
  coverage: number | null;
  /** Rule PG1: why `cogs` is null under นับสต๊อก ("ยังไม่ได้นับสต๊อกต้นงวด"). */
  cogsWhy: string | null;
  daysPosted: number;
  salesDays: number;
  /** Rule CO-LABOR. `null` when a month the period touches has no labour recorded. */
  labor: number | null;
  /** Thai, for the empty bar: "ยังไม่มีค่าแรง ก.ย." */
  laborMissing: string | null;
  waste: number;
};

export type CostPeriod = {
  key: string;
  label: string;
  from: string;
  to: string;
  /** The current week/month, not finished yet. */
  partial: boolean;
  cells: Record<string, CostCell>;
  /** Rule CO-PRICE, shop-wide (receipts carry no branch filter here). */
  priceUp: PriceMove[];
  priceDown: PriceMove[];
};

export type { PriceMove } from "@/lib/price-average";

export type CountEvent = {
  countId: string;
  branchId: string;
  scNumber: string;
  date: string;
  dateLabel: string;
  /** Baht the count found short (ledger-valued), the figure /cost calls variance. */
  value: number;
  /** Revenue since the previous count (rule CO-COUNT); null when no sales in it. */
  sinceRevenue: number | null;
  sinceLabel: string;
  first: boolean;
  items: { productId: string; name: string; qty: string; value: number }[];
  /** Lines counted ABOVE the system — not netted off the shortfall. */
  overItems: number;
};

export type StockItem = {
  productId: string;
  name: string;
  value: number;
  /** Rule CO-AGE. Days since the oldest lot still on the shelf was received. */
  ageDays: number | null;
  oldestDate: string | null;
  oldestValue: number;
  daysLeft: number | null;
};

export type CostOverview = {
  today: string;
  method: "PERIODIC_INVENTORY" | "RECIPE_CONSUMPTION";
  targets: CostTargets;
  branches: { id: string; name: string; code: string | null }[];
  week: CostPeriod[];
  month: CostPeriod[];
  counts: CountEvent[];
  stock: Record<string, { value: number; items: StockItem[] }>;
};

type Range = { from: Date; to: Date; key: string; label: string; partial: boolean };

/** Monday-start weeks, the last one being this (unfinished) week. */
export function weekRanges(today: Date, n = WEEKS_SHOWN): Range[] {
  const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
  const thisMonday = addDays(today, -dow);
  return Array.from({ length: n }, (_, i) => {
    const from = addDays(thisMonday, -7 * (n - 1 - i));
    const end = addDays(from, 6);
    const partial = end.getTime() > today.getTime();
    const to = partial ? today : end;
    const sameMonth = from.getUTCMonth() === end.getUTCMonth();
    const label = sameMonth
      ? `${from.getUTCDate()}–${end.getUTCDate()} ${MONTHS_TH[end.getUTCMonth()]}`
      : `${dayTh(from)}–${dayTh(end)}`;
    return { from, to, key: `w${iso(from)}`, label, partial };
  });
}

export function monthRanges(today: Date, n = MONTHS_SHOWN): Range[] {
  return Array.from({ length: n }, (_, i) => {
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (n - 1 - i), 1));
    const end = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
    const partial = end.getTime() > today.getTime();
    return { from, to: partial ? today : end, key: `m${monthKey(from)}`, label: monthTh(from), partial };
  });
}

/**
 * Rule CO-LABOR. A month's labour spread evenly over its calendar days; a
 * period's labour is the sum over its days. Any month the period touches with
 * no labour recorded makes the whole period unknown — half a week's wages
 * would read as a cheap week.
 */
export function laborFor(
  range: { from: Date; to: Date },
  byMonth: Map<string, number>
): { labor: number | null; missing: string | null } {
  let total = 0;
  for (let t = range.from.getTime(); t <= range.to.getTime(); t += DAY) {
    const d = new Date(t);
    const m = byMonth.get(monthKey(d));
    if (m === undefined) return { labor: null, missing: `ยังไม่มีค่าแรง ${MONTHS_TH[d.getUTCMonth()]}` };
    total += m / daysInMonth(d);
  }
  return { labor: round2(total), missing: null };
}

export { priceMovesFor } from "@/lib/price-average";

export async function getCostOverviewLogic(tenantId: string, reach: BranchReach): Promise<CostOverview> {
  const today = computeBangkokToday();
  const weeks = weekRanges(today);
  const months = monthRanges(today);
  const all = [...weeks, ...months];
  const earliest = new Date(Math.min(...all.map((r) => r.from.getTime())));

  const [summaries, facts, prices] = await Promise.all([
    getBranchCostSummariesLogic(tenantId, all.map((r) => ({ from: r.from, to: r.to })), reach),
    withTenantContext(tenantId, (tx) => loadFacts(tx as unknown as PrismaClient, tenantId, reach, today, earliest), {
      timeout: 30_000,
    }),
    getPriceWatchLogic(tenantId, { from: addDays(earliest, -180), to: today }, reach).then((w) => w.points),
  ]);

  const coveredMethod = facts.method === "RECIPE_CONSUMPTION";
  const toPeriod = (r: Range, i: number): CostPeriod => {
    const rows = summaries[i] ?? [];
    const cells: Record<string, CostCell> = {};
    for (const row of rows) {
      const revenue = row.revenue === null ? null : num(row.revenue);
      const lab = laborFor(r, facts.laborByBranch.get(row.branchId) ?? new Map());
      cells[row.branchId] = {
        revenue,
        cogs: row.cogsSold === null ? null : round2(num(row.cogsSold)),
        coverage: coveredMethod && revenue ? Math.min(1, num(row.consumptionCoveredNetAmount) / revenue) : null,
        cogsWhy: row.grossProfitBlocker ? grossProfitBlockerShort(row.grossProfitBlocker) : null,
        daysPosted: row.consumptionDaysPosted,
        salesDays: row.salesDaysInPeriod,
        labor: lab.labor,
        laborMissing: lab.missing,
        waste: round2(num(row.wasteValue)),
      };
    }
    // CO-PRICE v2: against the period before, of the same length (the previous
    // week / month), by average — never the single receipt before it.
    const prev = all[i - 1] && all[i - 1].key[0] === r.key[0]
      ? all[i - 1]
      : r.key[0] === "w"
        ? { from: addDays(r.from, -7), to: addDays(r.from, -1) }
        : { from: new Date(Date.UTC(r.from.getUTCFullYear(), r.from.getUTCMonth() - 1, 1)), to: addDays(r.from, -1) };
    const moves = priceMovesFor(r, prev, prices);
    return {
      key: r.key,
      label: r.label,
      from: iso(r.from),
      to: iso(r.to),
      partial: r.partial,
      cells,
      priceUp: moves.up,
      priceDown: moves.down,
    };
  };

  return {
    today: iso(today),
    method: facts.method,
    targets: facts.targets,
    branches: facts.branches,
    week: weeks.map((r, i) => toPeriod(r, i)),
    month: months.map((r, i) => toPeriod(r, weeks.length + i)),
    counts: facts.counts,
    stock: facts.stock,
  };
}

async function loadFacts(tx: PrismaClient, tenantId: string, reach: BranchReach, today: Date, earliest: Date) {
  const [tenant, branches] = await Promise.all([
    tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        grossProfitMethod: true,
        foodCostTargetPct: true,
        primeCostTargetPct: true,
        countVarianceTargetPct: true,
        costCoverageMinPct: true,
        slowStockDays: true,
      },
    }),
    tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach) },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const branchIds = branches.map((b) => b.id);
  const laborStart = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));

  const [laborLines, revenueDays, countMoves, products] = await Promise.all([
    tx.expenseItem.findMany({
      where: {
        tenantId,
        category: { account: "OpEx", accountingSection: { in: LABOR_SECTIONS } },
        expense: { tenantId, deletedAt: null, branchId: { in: branchIds }, billDate: { gte: laborStart } },
      },
      select: { totalPrice: true, expense: { select: { branchId: true, billDate: true } } },
    }),
    tx.salesLine.groupBy({
      by: ["branchId", "businessDate"],
      where: { tenantId, supersededAt: null, branchId: { in: branchIds } },
      _sum: { netAmount: true },
    }),
    tx.stockMovement.findMany({
      where: {
        tenantId,
        branchId: { in: branchIds },
        sourceType: "STOCK_COUNT",
        type: { in: ["ADJUST_LOSS", "ADJUST_GAIN"] },
      },
      select: { id: true, productId: true, branchId: true, sourceId: true, type: true, qty: true },
    }),
    tx.product.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, productUnits: { where: { isBase: true }, select: { unitName: true } } },
    }),
  ]);

  // ── labour by branch × month ───────────────────────────────────────────────
  const laborByBranch = new Map<string, Map<string, number>>();
  for (const l of laborLines) {
    const m = laborByBranch.get(l.expense.branchId) ?? new Map<string, number>();
    const k = monthKey(l.expense.billDate);
    m.set(k, (m.get(k) ?? 0) + num(l.totalPrice));
    laborByBranch.set(l.expense.branchId, m);
  }

  // ── one replay serves the counts' money AND the stock ages ─────────────────
  const productIds = products.map((p) => p.id);
  const replayed = productIds.length && branchIds.length ? await replayPairsInTx(tx, tenantId, productIds, branchIds, today) : new Map();
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  const unitOf = new Map(products.map((p) => [p.id, p.productUnits[0]?.unitName ?? ""]));

  // ── counts (rule CO-COUNT) ─────────────────────────────────────────────────
  const lossValue = new Map<string, number>();
  for (const state of replayed.values()) {
    for (const out of state.outflows) {
      if (out.sourceType === "STOCK_COUNT" && out.type === "ADJUST_LOSS") {
        lossValue.set(out.movementId, (lossValue.get(out.movementId) ?? 0) + num(out.value));
      }
    }
  }
  const itemIds = [...new Set(countMoves.map((m) => m.sourceId))];
  const countItems = itemIds.length
    ? await tx.stockCountItem.findMany({
        where: { tenantId, id: { in: itemIds } },
        select: { id: true, stockCount: { select: { id: true, scNumber: true, branchId: true, countDate: true, status: true } } },
      })
    : [];
  const countOfItem = new Map(countItems.map((i) => [i.id, i.stockCount]));
  type Acc = { sc: (typeof countItems)[number]["stockCount"]; perProduct: Map<string, { qty: number; value: number }> };
  const byCount = new Map<string, Acc>();
  for (const m of countMoves) {
    const sc = countOfItem.get(m.sourceId);
    if (!sc || sc.status !== "CLOSED") continue;
    const acc = byCount.get(sc.id) ?? { sc, perProduct: new Map() };
    const cur = acc.perProduct.get(m.productId) ?? { qty: 0, value: 0 };
    cur.qty += num(m.qty); // signed: a loss is negative
    if (m.type === "ADJUST_LOSS") cur.value += lossValue.get(m.id) ?? 0;
    acc.perProduct.set(m.productId, cur);
    byCount.set(sc.id, acc);
  }

  const revByBranchDay = new Map<string, { day: number; rev: number }[]>();
  for (const r of revenueDays) {
    const arr = revByBranchDay.get(r.branchId) ?? [];
    arr.push({ day: r.businessDate.getTime(), rev: num(r._sum.netAmount) });
    revByBranchDay.set(r.branchId, arr);
  }

  const counts: CountEvent[] = [];
  const sorted = [...byCount.values()].sort((a, b) => a.sc.countDate.getTime() - b.sc.countDate.getTime());
  for (const acc of sorted) {
    const { sc } = acc;
    const prev = sorted.filter((x) => x.sc.branchId === sc.branchId && x.sc.countDate.getTime() < sc.countDate.getTime()).at(-1);
    const lo = prev ? prev.sc.countDate.getTime() : -Infinity;
    const hi = sc.countDate.getTime();
    const since = (revByBranchDay.get(sc.branchId) ?? []).filter((d) => d.day > lo && d.day <= hi).reduce((s, d) => s + d.rev, 0);
    const short = [...acc.perProduct.entries()].filter(([, v]) => v.qty < 0);
    const items = short
      .map(([productId, v]) => ({
        productId,
        name: nameOf.get(productId) ?? productId,
        qty: `−${Math.abs(v.qty).toLocaleString("th-TH", { maximumFractionDigits: 3 })} ${unitOf.get(productId) ?? ""}`.trim(),
        value: round2(v.value),
      }))
      .sort((a, b) => b.value - a.value);
    counts.push({
      countId: sc.id,
      branchId: sc.branchId,
      scNumber: sc.scNumber,
      date: iso(sc.countDate),
      dateLabel: dayTh(sc.countDate),
      value: round2(items.reduce((s, i) => s + i.value, 0)),
      sinceRevenue: since > 0 ? round2(since) : null,
      sinceLabel: prev ? `ตั้งแต่นับครั้งก่อน (${dayTh(prev.sc.countDate)})` : "ตั้งแต่เริ่มมีข้อมูล (การนับครั้งแรก)",
      first: !prev,
      items,
      overItems: [...acc.perProduct.values()].filter((v) => v.qty > 0).length,
    });
  }

  // ── stock: value, oldest lot, days to use up (rule CO-AGE) ─────────────────
  const stock: CostOverview["stock"] = {};
  for (const b of branches) {
    const ids = productIds.filter((id) => {
      const s = replayed.get(costKeyOf(id, b.id));
      return s !== undefined && num(s.inventoryValue) > 0;
    });
    const rate = ids.length ? (await ingredientFactsInTx(tx, tenantId, b.id, ids)).facts : {};
    const items: StockItem[] = ids.map((id) => {
      const s = replayed.get(costKeyOf(id, b.id))!;
      const live = s.layers.filter((l: { qty: Prisma.Decimal }) => num(l.qty) > 0);
      const oldest = live.reduce(
        (a: (typeof live)[number] | null, l: (typeof live)[number]) => (a === null || l.occurredAt < a.occurredAt ? l : a),
        null
      );
      return {
        productId: id,
        name: nameOf.get(id) ?? id,
        value: round2(num(s.inventoryValue)),
        ageDays: oldest ? Math.max(0, Math.floor((today.getTime() - oldest.occurredAt.getTime()) / DAY)) : null,
        oldestDate: oldest ? dayTh(oldest.occurredAt) : null,
        oldestValue: oldest ? round2(num(oldest.value)) : 0,
        daysLeft: rate[id]?.daysLeft ?? null,
      };
    });
    stock[b.id] = { value: round2(items.reduce((s, i) => s + i.value, 0)), items };
  }

  return {
    method: tenant.grossProfitMethod,
    targets: {
      food: num(tenant.foodCostTargetPct),
      prime: num(tenant.primeCostTargetPct),
      variance: num(tenant.countVarianceTargetPct),
      coverageMin: tenant.costCoverageMinPct / 100,
      slowDays: tenant.slowStockDays,
    },
    branches,
    laborByBranch,
    counts,
    stock,
  };
}
