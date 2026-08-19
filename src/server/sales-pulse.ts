// ============================================================
// Mise — daily pulse logic (Sprint 4 Part 20a L3, ADR 0020)
// ============================================================
// One number per branch per day, and the two things that make it worth keeping:
//
//   * **It freezes once a detail file lands** (Q2/rule P28). Up to that moment it
//     is the figure people read and it should be correctable. After it, its job
//     is to be the evidence the file gets checked against — and a pulse anyone
//     could edit to silence a warning is no evidence at all.
//   * **It is compared like with like** (Q1/rule P27). The pulse is what the
//     customer paid; the detail's equivalent is `net + vat + service_charge`.
//     Comparing it against revenue instead would raise a mismatch every single
//     day, and a warning that fires daily is worse than no warning, because it
//     also covers the one that mattered.
//
// Nothing here stores a difference. Reconciliation is computed at read, the rule
// ADR 0016 Q5 set for recurring costs and ADR 0014 set for cost itself: a stored
// difference is stale the moment a day is re-imported.
// ============================================================

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { isPulseMismatch, pulseMismatchThreshold } from "@/lib/validations/sales-pulse";

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const ZERO = () => new Prisma.Decimal(0);

// ------------------------------------------------------------
// Typed errors
// ------------------------------------------------------------

/**
 * The day already has imported sales, so its pulse is now evidence rather than a
 * working figure (Q2).
 *
 * Carries both numbers, because the honest reply to "why can I not fix this?" is
 * to show what the two say — the shop's next move is usually to look at the file,
 * not at the pulse.
 */
export class SalesPulseLockedError extends Error {
  constructor(
    public readonly businessDate: Date,
    public readonly pulseAmount: Prisma.Decimal | null,
    public readonly detailAmount: Prisma.Decimal
  ) {
    super(`Pulse for ${businessDate.toISOString().slice(0, 10)} is locked by imported sales`);
    this.name = "SalesPulseLockedError";
  }
}

export class BranchNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Branch "${id}" does not exist for this tenant`);
    this.name = "BranchNotFoundError";
  }
}

// ------------------------------------------------------------
// The customer-paid total, from the detail
// ------------------------------------------------------------

/**
 * What the till would have said, reconstructed from imported lines.
 *
 * `net` is revenue (excl VAT, excl service charge — ADR 0019 Q10), so putting
 * both back is what makes the comparison meaningful. Any code that compares a
 * pulse against `net` alone is wrong by up to about 17%.
 */
export async function customerPaidByDayLogic(
  tx: Tx,
  tenantId: string,
  branchId: string,
  days: readonly Date[]
): Promise<Map<number, Prisma.Decimal>> {
  const out = new Map<number, Prisma.Decimal>();
  if (days.length === 0) return out;

  const rows = await tx.salesLine.groupBy({
    by: ["businessDate"],
    where: {
      tenantId,
      branchId,
      supersededAt: null,
      businessDate: { in: [...days] },
    },
    _sum: { netAmount: true, vatAmount: true, serviceChargeAmount: true },
  });

  for (const r of rows) {
    const total = (r._sum.netAmount ?? ZERO())
      .plus(r._sum.vatAmount ?? ZERO())
      .plus(r._sum.serviceChargeAmount ?? ZERO());
    out.set(r.businessDate.getTime(), total);
  }
  return out;
}

// ------------------------------------------------------------
// Recording
// ------------------------------------------------------------

export interface RecordSalesPulseInputForServer {
  branchId: string;
  businessDate: Date;
  amount: number;
  note: string | null;
}

export interface RecordSalesPulseResult {
  salesDayId: string;
  businessDate: Date;
  amount: Prisma.Decimal;
  /** True when this replaced a figure somebody had already entered. */
  replacedPrevious: boolean;
}

export async function recordSalesPulseLogic(
  tenantId: string,
  userId: string,
  input: RecordSalesPulseInputForServer
): Promise<RecordSalesPulseResult> {
  return withTenantContext(tenantId, async (tx) => {
    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) throw new BranchNotFoundError(input.branchId);

    const existing = await tx.salesDay.findUnique({
      where: {
        branchId_businessDate: {
          branchId: input.branchId,
          businessDate: input.businessDate,
        },
      },
      select: { id: true, pulseAmount: true },
    });

    // --- the lock (Q2) ---
    // Checked against LIVE lines rather than against `current_batch_id`, because
    // a batch that was superseded and left the day empty should not keep the
    // pulse frozen: what locks it is the presence of detail, not the history of
    // an import.
    if (existing) {
      const liveLines = await tx.salesLine.count({
        where: { salesDayId: existing.id, supersededAt: null },
      });
      if (liveLines > 0) {
        const paid = await customerPaidByDayLogic(tx, tenantId, input.branchId, [
          input.businessDate,
        ]);
        throw new SalesPulseLockedError(
          input.businessDate,
          existing.pulseAmount,
          paid.get(input.businessDate.getTime()) ?? ZERO()
        );
      }
    }

    const amount = new Prisma.Decimal(input.amount);
    const now = new Date();

    const saved = await tx.salesDay.upsert({
      where: {
        branchId_businessDate: {
          branchId: input.branchId,
          businessDate: input.businessDate,
        },
      },
      create: {
        tenantId,
        branchId: input.branchId,
        businessDate: input.businessDate,
        pulseAmount: amount,
        pulseSource: "MANUAL",
        pulseRecordedBy: userId,
        pulseRecordedAt: now,
        pulseNote: input.note,
      },
      update: {
        pulseAmount: amount,
        pulseSource: "MANUAL",
        pulseRecordedBy: userId,
        pulseRecordedAt: now,
        pulseNote: input.note,
      },
      select: { id: true },
    });

    return {
      salesDayId: saved.id,
      businessDate: input.businessDate,
      amount,
      replacedPrevious: existing?.pulseAmount != null,
    };
  });
}

// ------------------------------------------------------------
// Reconciliation — computed at read, stored nowhere
// ------------------------------------------------------------

export interface PulseReconciliation {
  businessDate: Date;
  pulseAmount: Prisma.Decimal;
  detailAmount: Prisma.Decimal;
  /** detail − pulse. Negative means the file is short of what the till said. */
  difference: Prisma.Decimal;
  threshold: Prisma.Decimal;
  isMismatch: boolean;
  pulseNote: string | null;
}

/**
 * Compare a set of days against their pulses.
 *
 * Days with no pulse are simply absent from the result — there is nothing to
 * compare, and inventing a zero to compare against would manufacture a mismatch
 * out of an ordinary gap.
 */
export async function reconcilePulsesLogic(
  tenantId: string,
  branchId: string,
  days: readonly Date[],
  client?: Tx
): Promise<PulseReconciliation[]> {
  const run = async (tx: Tx): Promise<PulseReconciliation[]> => {
    if (days.length === 0) return [];

    const salesDays = await tx.salesDay.findMany({
      where: {
        tenantId,
        branchId,
        businessDate: { in: [...days] },
        pulseAmount: { not: null },
      },
      select: { businessDate: true, pulseAmount: true, pulseNote: true },
    });
    if (salesDays.length === 0) return [];

    const paid = await customerPaidByDayLogic(
      tx,
      tenantId,
      branchId,
      salesDays.map((d) => d.businessDate)
    );

    return salesDays
      .map((d) => {
        const pulseAmount = d.pulseAmount ?? ZERO();
        const detailAmount = paid.get(d.businessDate.getTime()) ?? ZERO();
        return {
          businessDate: d.businessDate,
          pulseAmount,
          detailAmount,
          difference: detailAmount.minus(pulseAmount),
          threshold: new Prisma.Decimal(pulseMismatchThreshold(detailAmount.toNumber())),
          isMismatch: isPulseMismatch(pulseAmount.toNumber(), detailAmount.toNumber()),
          pulseNote: d.pulseNote,
        };
      })
      .sort((a, b) => a.businessDate.getTime() - b.businessDate.getTime());
  };

  return client ? run(client) : withTenantContext(tenantId, run);
}

// ------------------------------------------------------------
// The dashboard
// ------------------------------------------------------------

/** Where a figure on the dashboard came from. Never omitted (rules C10, W4). */
export type PulseFigureSource = "DETAIL" | "PULSE";

export interface PulseDayFigure {
  businessDate: Date;
  amount: Prisma.Decimal | null;
  source: PulseFigureSource | null;
  note: string | null;
}

export interface BranchPulseRow {
  branchId: string;
  branchName: string;
  today: PulseDayFigure;
  yesterday: PulseDayFigure;
  /** Last 7 days INCLUDING today, and how many of them have any figure at all. */
  last7Total: Prisma.Decimal;
  last7DaysWithFigure: number;
  /** Drives the entry box: nothing recorded and nothing imported yet. */
  todayNeedsPulse: boolean;
}

export interface PulseDashboard {
  branches: BranchPulseRow[];
  /** An EXPLICIT roll-up, never a silent total (CONTEXT.md, Tenant). */
  todayTotal: Prisma.Decimal;
  yesterdayTotal: Prisma.Decimal;
  last7Total: Prisma.Decimal;
  /** Branches with no figure for today — what the roll-up is missing. */
  branchesMissingToday: number;
}

export const PULSE_WINDOW_DAYS = 7;

export async function getPulseDashboardLogic(
  tenantId: string,
  opts: { branchId?: string } = {}
): Promise<PulseDashboard> {
  return withTenantContext(tenantId, async (tx) => {
    const today = computeBangkokToday();
    const yesterday = addDays(today, -1);
    const windowStart = addDays(today, -(PULSE_WINDOW_DAYS - 1));
    const windowDays = Array.from({ length: PULSE_WINDOW_DAYS }, (_, i) =>
      addDays(windowStart, i)
    );

    const branches = await tx.branch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        ...(opts.branchId ? { id: opts.branchId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (branches.length === 0) {
      return {
        branches: [],
        todayTotal: ZERO(),
        yesterdayTotal: ZERO(),
        last7Total: ZERO(),
        branchesMissingToday: 0,
      };
    }

    const branchIds = branches.map((b) => b.id);

    const [pulseRows, detailRows] = await Promise.all([
      tx.salesDay.findMany({
        where: {
          tenantId,
          branchId: { in: branchIds },
          businessDate: { gte: windowStart, lte: today },
          pulseAmount: { not: null },
        },
        select: { branchId: true, businessDate: true, pulseAmount: true, pulseNote: true },
      }),
      tx.salesLine.groupBy({
        by: ["branchId", "businessDate"],
        where: {
          tenantId,
          branchId: { in: branchIds },
          supersededAt: null,
          businessDate: { gte: windowStart, lte: today },
        },
        _sum: { netAmount: true, vatAmount: true, serviceChargeAmount: true },
      }),
    ]);

    const key = (branchId: string, d: Date) => `${branchId}|${d.getTime()}`;

    const pulseBy = new Map<string, { amount: Prisma.Decimal; note: string | null }>();
    for (const p of pulseRows) {
      pulseBy.set(key(p.branchId, p.businessDate), {
        amount: p.pulseAmount ?? ZERO(),
        note: p.pulseNote,
      });
    }

    const detailBy = new Map<string, Prisma.Decimal>();
    for (const d of detailRows) {
      detailBy.set(
        key(d.branchId, d.businessDate),
        (d._sum.netAmount ?? ZERO())
          .plus(d._sum.vatAmount ?? ZERO())
          .plus(d._sum.serviceChargeAmount ?? ZERO())
      );
    }

    // Detail wins where it exists; the pulse fills the gap. Both say which they
    // are, because a figure that hides its provenance gets trusted past the point
    // it has earned.
    const figureFor = (branchId: string, d: Date): PulseDayFigure => {
      const k = key(branchId, d);
      const detail = detailBy.get(k);
      if (detail !== undefined) {
        return { businessDate: d, amount: detail, source: "DETAIL", note: null };
      }
      const pulse = pulseBy.get(k);
      if (pulse !== undefined) {
        return { businessDate: d, amount: pulse.amount, source: "PULSE", note: pulse.note };
      }
      return { businessDate: d, amount: null, source: null, note: null };
    };

    const rows: BranchPulseRow[] = branches.map((b) => {
      const todayFigure = figureFor(b.id, today);
      let last7Total = ZERO();
      let last7DaysWithFigure = 0;
      for (const d of windowDays) {
        const f = figureFor(b.id, d);
        if (f.amount === null) continue;
        last7Total = last7Total.plus(f.amount);
        last7DaysWithFigure += 1;
      }
      return {
        branchId: b.id,
        branchName: b.name,
        today: todayFigure,
        yesterday: figureFor(b.id, yesterday),
        last7Total,
        last7DaysWithFigure,
        todayNeedsPulse: todayFigure.amount === null,
      };
    });

    return {
      branches: rows,
      todayTotal: rows.reduce((sum, r) => sum.plus(r.today.amount ?? ZERO()), ZERO()),
      yesterdayTotal: rows.reduce((sum, r) => sum.plus(r.yesterday.amount ?? ZERO()), ZERO()),
      last7Total: rows.reduce((sum, r) => sum.plus(r.last7Total), ZERO()),
      branchesMissingToday: rows.filter((r) => r.today.amount === null).length,
    };
  });
}
