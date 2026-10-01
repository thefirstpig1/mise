// ============================================================
// Mise — กำไรสุทธิ: the profit-and-loss statement (Part 35 L3)
// ============================================================
// Until Part 35 no screen in Mise printed กำไรสุทธิ, although every input to
// it existed: revenue (Part 19), cost of goods sold by either method (Part 14 /
// Part 22) and operating expenses (Part 16). `/cost` stopped at gross profit
// and `/expenses` was a separate list (pending-features-ai.md, Feature A1).
//
// 🔴 THIS FILE OWNS NO ARITHMETIC ABOUT COST. Revenue, gross profit and
// operating spend come from `getBranchCostSummaryLogic` — the function behind
// `/cost` — so the P&L and `/cost` cannot disagree by a satang: the day they
// did, nothing would report it, which is the second engine ADR 0025 Q4
// refused. The only things computed here are sums across branches, the
// operating-expense breakdown by section, and one subtraction.
//
// THE RULES (docs/calculation-rules.md, rows added with this Part)
//   PL1  Revenue is `sales_line.net_amount`: after discount, excl. VAT and
//       service charge (ADR 0019 Q10) — the same figure as /cost and /sales.
//   PL2  Cost of goods sold = revenue − gross profit, per branch, whichever
//       method the shop chose. Never purchases (ADR 0019 Q17).
//   PL3  Operating expenses = every expense line NOT under account COGS, by
//       bill date, net of VAT (ADR 0016). Rent and electricity live HERE and
//       only here — never in a food-cost figure (Part 32, Kong's correction).
//   PL4  Net profit = gross profit − operating expenses.
//   PL5  A figure that cannot be worked out is NULL with a reason, never 0.
//       A branch that SOLD but whose gross profit is unknown makes the
//       consolidated gross and net profit unknown too — leaving it out would
//       print a profit that silently omits a whole branch's cost.
//   PL6  A branch with no sales imported contributes its expenses and nothing
//       else: it has no revenue, so it has no gross profit to add.
//   PL7  The consolidated figure covers exactly the branches that are both
//       selected and in the reader's reach (rule A5), and says which.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { branchScopeWhere, type BranchReach } from "@/lib/permissions/service";
import {
  getBranchCostSummariesLogic,
  getBranchCostSummaryLogic,
  type BranchCostSummary,
} from "@/server/stock-cost";
import type { GrossProfitMethod } from "@prisma/client";

const ZERO = () => new Prisma.Decimal(0);

export interface PnlQuery {
  from: Date;
  to: Date;
  /** Branches the reader switched ON. Empty or undefined = every branch in reach. */
  branchIds?: readonly string[];
}

export type PnlUnknownReason =
  /** No POS file imported for any selected branch in the period. */
  | "NO_SALES"
  /** A branch sold, but its gross profit cannot be worked out (see /cost). */
  | "GROSS_PROFIT_UNKNOWN";

export interface PnlBranchRow {
  branchId: string;
  branchName: string;
  revenue: Prisma.Decimal | null;
  cogs: Prisma.Decimal | null;
  grossProfit: Prisma.Decimal | null;
  opex: Prisma.Decimal;
  netProfit: Prisma.Decimal | null;
}

export interface PnlSection {
  section: string;
  amount: Prisma.Decimal;
  /** The groups inside the section, largest first — "ค่าไฟฟ้า ฿x · ค่าน้ำ ฿y". */
  groups: { group: string; amount: Prisma.Decimal }[];
}

export interface Pnl {
  from: Date;
  to: Date;
  method: GrossProfitMethod | null;
  branches: PnlBranchRow[];
  revenue: Prisma.Decimal | null;
  cogs: Prisma.Decimal | null;
  grossProfit: Prisma.Decimal | null;
  opex: Prisma.Decimal;
  opexBySection: PnlSection[];
  netProfit: Prisma.Decimal | null;
  /** Why grossProfit / netProfit are null, when they are. */
  unknownReason: PnlUnknownReason | null;
  /** Branches that sold but whose gross profit is unknown (reason GROSS_PROFIT_UNKNOWN). */
  branchesMissingGrossProfit: string[];
  /**
   * Under the recipe method, the share of revenue whose consumption is
   * posted (rule N3/N10). A recipe-method profit is printed WITH this, never
   * bare. Null under the periodic method or with no revenue.
   */
  recipeCoverage: number | null;
}

/** The reach a query actually runs under: selected ∩ allowed (rule A5). */
export function narrowReach(reach: BranchReach, selected?: readonly string[]): BranchReach {
  if (!selected || selected.length === 0) return reach;
  const allowed = reach.allBranches
    ? selected
    : selected.filter((id) => reach.allowedBranchIds.includes(id));
  return { allBranches: false, allowedBranchIds: [...allowed] };
}

function rowFrom(b: BranchCostSummary): PnlBranchRow {
  const cogs = b.revenue !== null && b.grossProfit !== null ? b.revenue.minus(b.grossProfit) : null;
  return {
    branchId: b.branchId,
    branchName: b.branchName,
    revenue: b.revenue,
    cogs,
    grossProfit: b.grossProfit,
    opex: b.opexSpend,
    netProfit: b.grossProfit !== null ? b.grossProfit.minus(b.opexSpend) : null,
  };
}

/** Sum the branch rows into one statement (rules PL5–PL7). Pure, so it is tested alone. */
export function consolidate(
  rows: readonly BranchCostSummary[],
  opexBySection: PnlSection[],
  from: Date,
  to: Date
): Pnl {
  const branches = rows.map(rowFrom);
  const sold = rows.filter((r) => r.revenue !== null);
  const missing = sold.filter((r) => r.grossProfit === null).map((r) => r.branchName);

  const revenue = sold.length ? sold.reduce((s, r) => s.plus(r.revenue!), ZERO()) : null;
  const opex = rows.reduce((s, r) => s.plus(r.opexSpend), ZERO());

  let grossProfit: Prisma.Decimal | null = null;
  let unknownReason: PnlUnknownReason | null = null;
  if (sold.length === 0) unknownReason = "NO_SALES";
  else if (missing.length > 0) unknownReason = "GROSS_PROFIT_UNKNOWN";
  else grossProfit = sold.reduce((s, r) => s.plus(r.grossProfit!), ZERO());

  const method = rows[0]?.grossProfitMethod ?? null;
  const covered = sold.reduce((s, r) => s.plus(r.consumptionCoveredNetAmount), ZERO());
  const recipeCoverage =
    method === "RECIPE_CONSUMPTION" && revenue !== null && revenue.gt(0)
      ? Number(covered.div(revenue).toFixed(4))
      : null;

  return {
    from,
    to,
    method,
    branches,
    revenue,
    cogs: revenue !== null && grossProfit !== null ? revenue.minus(grossProfit) : null,
    grossProfit,
    opex,
    opexBySection,
    netProfit: grossProfit !== null ? grossProfit.minus(opex) : null,
    unknownReason,
    branchesMissingGrossProfit: missing,
    recipeCoverage,
  };
}

/**
 * Operating expenses by accounting section — the same lines `/cost` sums into
 * `opexSpend` (stock-cost.ts: every line not under COGS, by bill date, net of
 * VAT), only grouped. A test holds the two totals equal.
 */
async function opexBySectionFor(
  tenantId: string,
  from: Date,
  to: Date,
  reach: BranchReach
): Promise<PnlSection[]> {
  // The branch filter is the SAME one getBranchCostSummaryLogic applies (live
  // branches inside the reach), written as a relation filter so this read need
  // not wait for that one's branch list (2026-10-01: the two now run together).
  const lines = await withTenantContext(tenantId, (tx) =>
    tx.expenseItem.findMany({
      where: {
        tenantId,
        category: { account: { not: "COGS" } },
        expense: {
          tenantId,
          deletedAt: null,
          branch: { deletedAt: null, ...branchScopeWhere(reach) },
          billDate: { gte: from, lte: to },
        },
      },
      select: { totalPrice: true, category: { select: { accountingSection: true, groupName: true } } },
    })
  );
  return groupLines(lines.map((l) => ({ section: l.category.accountingSection, group: l.category.groupName, amount: l.totalPrice })));
}

/** Section → group totals, both levels largest first. Pure. */
export function groupLines(lines: { section: string; group: string; amount: Prisma.Decimal }[]): PnlSection[] {
  const by = new Map<string, Map<string, Prisma.Decimal>>();
  for (const l of lines) {
    const g = by.get(l.section) ?? new Map<string, Prisma.Decimal>();
    g.set(l.group, (g.get(l.group) ?? ZERO()).plus(l.amount));
    by.set(l.section, g);
  }
  return [...by.entries()]
    .map(([section, groups]) => {
      const list = [...groups.entries()]
        .map(([group, amount]) => ({ group, amount }))
        .sort((a, b) => b.amount.comparedTo(a.amount));
      return { section, amount: list.reduce((s, x) => s.plus(x.amount), ZERO()), groups: list };
    })
    .sort((a, b) => b.amount.comparedTo(a.amount));
}

// ------------------------------------------------------------
// What the bills say — the /expenses breakdown (Kong, 2026-09-28)
// ------------------------------------------------------------

export interface SpendBreakdown {
  /** Account COGS: what was BOUGHT for the kitchen, by bill — not what was sold. */
  cogs: PnlSection[];
  opex: PnlSection[];
  total: Prisma.Decimal;
}

/**
 * Every expense line in the period, by account → section → group. This is
 * SPEND, which is why it lives beside the bill list and not in the P&L: the
 * ingredients bought this month are not the ingredients sold this month (the
 * difference is stock carried forward — ADR 0019 Q17, rule F3).
 */
export async function getSpendBreakdownLogic(
  tenantId: string,
  query: { from: Date; to: Date; branchId?: string },
  reach: BranchReach
): Promise<SpendBreakdown> {
  const lines = await withTenantContext(tenantId, async (tx) => {
    const branches = await tx.branch.findMany({
      where: { tenantId, deletedAt: null, ...branchScopeWhere(reach), ...(query.branchId ? { id: query.branchId } : {}) },
      select: { id: true },
    });
    return tx.expenseItem.findMany({
      where: {
        tenantId,
        expense: {
          tenantId,
          deletedAt: null,
          branchId: { in: branches.map((b) => b.id) },
          billDate: { gte: query.from, lte: query.to },
        },
      },
      select: { totalPrice: true, category: { select: { account: true, accountingSection: true, groupName: true } } },
    });
  });
  const cogs = groupLines(
    lines.filter((l) => l.category.account === "COGS").map((l) => ({ section: l.category.accountingSection, group: l.category.groupName, amount: l.totalPrice }))
  );
  const opex = groupLines(
    lines.filter((l) => l.category.account !== "COGS").map((l) => ({ section: l.category.accountingSection, group: l.category.groupName, amount: l.totalPrice }))
  );
  const total = [...cogs, ...opex].reduce((s, x) => s.plus(x.amount), ZERO());
  return { cogs, opex, total };
}

export async function getPnlLogic(tenantId: string, query: PnlQuery, reach: BranchReach): Promise<Pnl> {
  const scoped = narrowReach(reach, query.branchIds);
  // Side by side: neither needs the other (2026-10-01, dashboard speed).
  const [rows, sections] = await Promise.all([
    getBranchCostSummaryLogic(tenantId, { from: query.from, to: query.to }, scoped),
    opexBySectionFor(tenantId, query.from, query.to, scoped),
  ]);
  return consolidate(rows, sections, query.from, query.to);
}

// ------------------------------------------------------------
// The series behind the dashboard's charts
// ------------------------------------------------------------

export interface RevenuePoint {
  businessDate: Date;
  branchId: string;
  net: Prisma.Decimal;
}

/**
 * Revenue per branch per day — the same rows and the same filter as /sales
 * (`supersededAt: null`: a replaced import is history, not sales).
 */
export async function getRevenueByDayLogic(
  tenantId: string,
  query: PnlQuery,
  reach: BranchReach,
  branchIds: readonly string[]
): Promise<RevenuePoint[]> {
  const scoped = narrowReach(reach, query.branchIds);
  const ids = scoped.allBranches ? [...branchIds] : branchIds.filter((id) => scoped.allowedBranchIds.includes(id));
  if (ids.length === 0) return [];
  const rows = await withTenantContext(tenantId, (tx) =>
    tx.salesLine.groupBy({
      by: ["businessDate", "branchId"],
      where: {
        tenantId,
        supersededAt: null,
        branchId: { in: ids },
        businessDate: { gte: query.from, lte: query.to },
      },
      _sum: { netAmount: true },
      orderBy: { businessDate: "asc" },
    })
  );
  return rows.map((r) => ({
    businessDate: r.businessDate,
    branchId: r.branchId,
    net: r._sum.netAmount ?? ZERO(),
  }));
}

// ------------------------------------------------------------
// The monthly trend on the dashboard (Part 35, Kong's sample "Finance
// Dashboard": revenue vs expense bars with a net-profit line)
// ------------------------------------------------------------

export interface MonthlyPnlPoint {
  key: string;
  revenue: Prisma.Decimal | null;
  expenses: Prisma.Decimal | null;
  netProfit: Prisma.Decimal | null;
  unknownReason: PnlUnknownReason | null;
}

/**
 * One full P&L per month — the same getPnlLogic, so every bar agrees with the
 * cards when that month is picked. Each month is a FIFO replay (measured
 * ~1 s from Bangkok, far less on Fly beside the database), so they run in
 * parallel and the caller streams this behind its own Suspense.
 *
 * `expenses` is cost of goods sold + operating expenses, and is null when
 * the cost of goods sold is unknown — a bar of rent alone would pretend the
 * food was free (rule PL5).
 */
export async function getMonthlyPnlLogic(
  tenantId: string,
  months: { key: string; from: Date; to: Date }[],
  branchIds: readonly string[],
  reach: BranchReach
): Promise<MonthlyPnlPoint[]> {
  // One ledger fetch for all the months, cut per month in memory, instead of
  // six full P&Ls each fetching the whole history (2026-10-01). Same figures:
  // getBranchCostSummariesLogic answers what the single-period read would
  // (K17), and each month's spend breakdown is its own small read.
  const scoped = narrowReach(reach, branchIds);
  const [rowsByMonth, sectionsByMonth] = await Promise.all([
    getBranchCostSummariesLogic(tenantId, months.map((m) => ({ from: m.from, to: m.to })), scoped),
    Promise.all(months.map((m) => opexBySectionFor(tenantId, m.from, m.to, scoped))),
  ]);
  const all = months.map((m, i) => consolidate(rowsByMonth[i], sectionsByMonth[i], m.from, m.to));
  return all.map((p, i) => ({
    key: months[i].key,
    revenue: p.revenue,
    expenses: p.cogs !== null ? p.cogs.plus(p.opex) : null,
    netProfit: p.netProfit,
    unknownReason: p.unknownReason,
  }));
}
