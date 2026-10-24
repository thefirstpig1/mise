// ============================================================
// Mise — ปิดร้านประจำวัน (daily close add-on, ADR 0042)
// ============================================================
// One sheet per branch per business day. The till total and the guest count
// live on `sales_day` (ADR 0020's row); the cash count, the customer-type
// estimate, the issues and the comments live here.
//
// Figures are stored as typed and every blank is NULL (Q2). Cash short/over is
// computed at read, never stored. A sheet is editable until midnight at the
// end of the NEXT day (Q5); after that only comments and "จัดการแล้ว" move.
// ============================================================

import { Prisma } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import { addDays, computeBangkokToday } from "@/lib/bangkok-date";
import { assertRefBelongsToTenant } from "@/server/product";
import { recordSalesPulseInTx } from "@/server/sales-pulse";
import { MAX_CUSTOMER_TYPES, type SaveDailyCloseInput } from "@/lib/validations/daily-close";

const BKK_MS = 7 * 3_600_000;
const num = (d: Prisma.Decimal | null | undefined) => (d === null || d === undefined ? null : Number(d));
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const nameOf = (u: { name: string | null; email: string | null } | null) => (u ? (u.name ?? u.email ?? "") : null);

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

export class DailyCloseDisabledError extends Error {
  constructor() {
    super("The daily close add-on is not enabled for this shop");
    this.name = "DailyCloseDisabledError";
  }
}

/** Q5: past midnight at the end of the next day, the sheet is evidence. */
export class DailyCloseLockedError extends Error {
  constructor(public readonly businessDate: Date) {
    super(`Daily close for ${isoDate(businessDate)} can no longer be edited`);
    this.name = "DailyCloseLockedError";
  }
}

export class DailyCloseFutureDateError extends Error {
  constructor(public readonly businessDate: Date) {
    super(`Cannot close ${isoDate(businessDate)}: it has not happened yet`);
    this.name = "DailyCloseFutureDateError";
  }
}

/** Q2: the one required figure, unless a POS file already locked it. */
export class PulseRequiredError extends Error {
  constructor() {
    super("The till total is required to close the day");
    this.name = "PulseRequiredError";
  }
}

export class DailyCloseNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Daily close or issue "${id}" not found`);
    this.name = "DailyCloseNotFoundError";
  }
}

export class CustomerTypeLimitError extends Error {
  constructor() {
    super(`A shop may keep at most ${MAX_CUSTOMER_TYPES} customer types`);
    this.name = "CustomerTypeLimitError";
  }
}

// ------------------------------------------------------------
// The edit window (Q5)
// ------------------------------------------------------------

/** The instant the sheet for `businessDate` freezes: 00:00 Bangkok of D+2. */
export function editableUntil(businessDate: Date): Date {
  return new Date(addDays(businessDate, 2).getTime() - BKK_MS);
}

export function isEditable(businessDate: Date, now = new Date()): boolean {
  return now.getTime() < editableUntil(businessDate).getTime() && businessDate.getTime() <= computeBangkokToday().getTime();
}

// ------------------------------------------------------------
// Reading one day
// ------------------------------------------------------------

export type DailyCloseDay = {
  branchId: string;
  businessDate: string;
  editable: boolean;
  editableUntil: string;
  /** sales_day */
  pulseAmount: number | null;
  /** A POS file holds live lines for the day — the till total is frozen (ADR 0020 Q2). */
  pulseLocked: boolean;
  /** Revenue after discount, excl VAT & SC (the /sales figure); null = no file. */
  netRevenue: number | null;
  plates: number | null;
  guestCount: number | null;
  guestCountSource: "MANUAL" | "POS" | null;
  close: {
    id: string;
    cashFloat: number | null;
    cashSales: number | null;
    cashCounted: number | null;
    cashNote: string | null;
    closedBy: string | null;
    closedAt: string;
    updatedAt: string;
  } | null;
  mix: { customerTypeId: string; parts: number }[];
  issues: {
    id: string;
    category: string;
    body: string;
    followUp: boolean;
    resolvedAt: string | null;
    resolvedBy: string | null;
    createdBy: string | null;
    createdAt: string;
  }[];
  comments: { id: string; body: string; author: string | null; createdAt: string }[];
  /** Types offered on the form: active ones, plus archived ones this sheet already uses. */
  customerTypes: { id: string; name: string; archived: boolean }[];
  /** Things the system knows about the day, shown not typed. */
  auto: { wasteCount: number; staffMealCount: number; consumptionPosted: boolean | null };
};

export async function getDailyCloseDayLogic(tenantId: string, branchId: string, businessDate: Date): Promise<DailyCloseDay> {
  const dayStart = new Date(businessDate.getTime() - BKK_MS);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  return withTenantContext(tenantId, async (tx) => {
    const [salesDay, close, types, waste, meals, run] = await Promise.all([
      tx.salesDay.findUnique({
        where: { branchId_businessDate: { branchId, businessDate } },
        select: { id: true, pulseAmount: true, guestCount: true, guestCountSource: true },
      }),
      tx.dailyClose.findUnique({
        where: { branchId_businessDate: { branchId, businessDate } },
        include: {
          closedByUser: { select: { name: true, email: true } },
          mix: { select: { customerTypeId: true, parts: true } },
          issues: {
            orderBy: { createdAt: "asc" },
            include: { createdByUser: { select: { name: true, email: true } }, resolvedByUser: { select: { name: true, email: true } } },
          },
          comments: { orderBy: { createdAt: "asc" }, include: { authorUser: { select: { name: true, email: true } } } },
        },
      }),
      tx.customerType.findMany({ where: { tenantId }, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, archivedAt: true } }),
      tx.wasteLog.count({ where: { tenantId, branchId, reversalOfId: null, voidedAt: null, occurredAt: { gte: dayStart, lt: dayEnd } } }),
      tx.staffMeal.count({ where: { tenantId, branchId, voidedAt: null, businessDate } }),
      tx.salesConsumptionRun.findFirst({ where: { tenantId, branchId, businessDate, voidedAt: null }, select: { id: true } }),
    ]);
    const lines = salesDay
      ? await tx.salesLine.aggregate({ where: { salesDayId: salesDay.id, supersededAt: null }, _sum: { netAmount: true, qty: true }, _count: { _all: true } })
      : null;
    const hasFile = (lines?._count._all ?? 0) > 0;
    const used = new Set(close?.mix.map((m) => m.customerTypeId) ?? []);
    return {
      branchId,
      businessDate: isoDate(businessDate),
      editable: isEditable(businessDate),
      editableUntil: editableUntil(businessDate).toISOString(),
      pulseAmount: num(salesDay?.pulseAmount),
      pulseLocked: hasFile,
      netRevenue: hasFile ? num(lines!._sum.netAmount) : null,
      plates: hasFile ? num(lines!._sum.qty) : null,
      guestCount: salesDay?.guestCount ?? null,
      guestCountSource: salesDay?.guestCountSource ?? null,
      close: close && {
        id: close.id,
        cashFloat: num(close.cashFloat),
        cashSales: num(close.cashSales),
        cashCounted: num(close.cashCounted),
        cashNote: close.cashNote,
        closedBy: nameOf(close.closedByUser),
        closedAt: close.closedAt.toISOString(),
        updatedAt: close.updatedAt.toISOString(),
      },
      mix: close?.mix ?? [],
      issues: (close?.issues ?? []).map((i) => ({
        id: i.id,
        category: i.category,
        body: i.body,
        followUp: i.followUp,
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
        resolvedBy: nameOf(i.resolvedByUser),
        createdBy: nameOf(i.createdByUser),
        createdAt: i.createdAt.toISOString(),
      })),
      comments: (close?.comments ?? []).map((c) => ({ id: c.id, body: c.body, author: nameOf(c.authorUser), createdAt: c.createdAt.toISOString() })),
      customerTypes: types.filter((t) => t.archivedAt === null || used.has(t.id)).map((t) => ({ id: t.id, name: t.name, archived: t.archivedAt !== null })),
      auto: { wasteCount: waste, staffMealCount: meals, consumptionPosted: hasFile ? run !== null : null },
    };
  });
}

// ------------------------------------------------------------
// Saving
// ------------------------------------------------------------

export async function saveDailyCloseLogic(tenantId: string, userId: string, input: SaveDailyCloseInput): Promise<{ id: string }> {
  const { branchId, businessDate } = input;
  if (businessDate.getTime() > computeBangkokToday().getTime()) throw new DailyCloseFutureDateError(businessDate);
  if (!isEditable(businessDate)) throw new DailyCloseLockedError(businessDate);

  return withTenantContext(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { dailyCloseEnabled: true } });
    if (!tenant.dailyCloseEnabled) throw new DailyCloseDisabledError();
    await assertRefBelongsToTenant(tx, tenantId, "branch", branchId);

    // --- the till total (Q2): required unless a file locked it ---
    const day = await tx.salesDay.findUnique({ where: { branchId_businessDate: { branchId, businessDate } }, select: { id: true } });
    const locked = day ? (await tx.salesLine.count({ where: { salesDayId: day.id, supersededAt: null } })) > 0 : false;
    if (!locked) {
      if (input.pulseAmount === null) throw new PulseRequiredError();
      await recordSalesPulseInTx(tx, tenantId, userId, { branchId, businessDate, amount: input.pulseAmount, note: null });
    }

    // --- the guest count sits beside it (Q3); a POS-sourced count is not overwritten ---
    const sd = await tx.salesDay.upsert({
      where: { branchId_businessDate: { branchId, businessDate } },
      create: { tenantId, branchId, businessDate, guestCount: input.guestCount, guestCountSource: input.guestCount === null ? null : "MANUAL" },
      update: {},
      select: { id: true, guestCountSource: true },
    });
    if (sd.guestCountSource !== "POS") {
      await tx.salesDay.update({
        where: { id: sd.id },
        data: { guestCount: input.guestCount, guestCountSource: input.guestCount === null ? null : "MANUAL" },
      });
    }

    const dec = (n: number | null) => (n === null ? null : new Prisma.Decimal(n));
    const close = await tx.dailyClose.upsert({
      where: { branchId_businessDate: { branchId, businessDate } },
      create: {
        tenantId,
        branchId,
        businessDate,
        cashFloat: dec(input.cashFloat),
        cashSales: dec(input.cashSales),
        cashCounted: dec(input.cashCounted),
        cashNote: input.cashNote,
        closedBy: userId,
      },
      update: { cashFloat: dec(input.cashFloat), cashSales: dec(input.cashSales), cashCounted: dec(input.cashCounted), cashNote: input.cashNote },
      select: { id: true },
    });

    // --- the estimate (Q3): replaced whole; zero parts are simply absent ---
    const parts = input.mix.filter((m) => m.parts > 0);
    if (parts.length > 0) {
      const ok = await tx.customerType.count({ where: { tenantId, id: { in: parts.map((m) => m.customerTypeId) } } });
      if (ok !== new Set(parts.map((m) => m.customerTypeId)).size) throw new DailyCloseNotFoundError("customer_type");
    }
    await tx.dailyCloseMix.deleteMany({ where: { dailyCloseId: close.id } });
    if (parts.length > 0) {
      await tx.dailyCloseMix.createMany({ data: parts.map((m) => ({ tenantId, dailyCloseId: close.id, customerTypeId: m.customerTypeId, parts: m.parts })) });
    }

    // --- issues: the form's list is the list (inside the window only) ---
    const existing = await tx.dailyIssue.findMany({ where: { dailyCloseId: close.id }, select: { id: true } });
    const keep = new Set(input.issues.flatMap((i) => (i.id ? [i.id] : [])));
    const gone = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (gone.length > 0) await tx.dailyIssue.deleteMany({ where: { id: { in: gone }, dailyCloseId: close.id } });
    for (const i of input.issues) {
      if (i.id && existing.some((e) => e.id === i.id)) {
        await tx.dailyIssue.update({ where: { id: i.id }, data: { category: i.category, body: i.body, followUp: i.followUp } });
      } else {
        await tx.dailyIssue.create({ data: { tenantId, dailyCloseId: close.id, category: i.category, body: i.body, followUp: i.followUp, createdBy: userId } });
      }
    }
    return { id: close.id };
  });
}

// ------------------------------------------------------------
// After the window: comments and "จัดการแล้ว" (Q4, Q6)
// ------------------------------------------------------------

/** The branch a close or issue belongs to — the caller asserts reach on it. */
export async function branchOfCloseLogic(tenantId: string, ref: { closeId?: string; issueId?: string }): Promise<string | null> {
  return withTenantContext(tenantId, async (tx) => {
    if (ref.closeId) return (await tx.dailyClose.findFirst({ where: { id: ref.closeId, tenantId }, select: { branchId: true } }))?.branchId ?? null;
    if (ref.issueId)
      return (await tx.dailyIssue.findFirst({ where: { id: ref.issueId, tenantId }, select: { dailyClose: { select: { branchId: true } } } }))?.dailyClose.branchId ?? null;
    return null;
  });
}

export async function addDailyCommentLogic(tenantId: string, userId: string, input: { dailyCloseId: string; body: string }) {
  return withTenantContext(tenantId, async (tx) => {
    const close = await tx.dailyClose.findFirst({ where: { id: input.dailyCloseId, tenantId }, select: { id: true } });
    if (!close) throw new DailyCloseNotFoundError(input.dailyCloseId);
    return tx.dailyComment.create({ data: { tenantId, dailyCloseId: close.id, body: input.body, author: userId }, select: { id: true } });
  });
}

export async function resolveDailyIssueLogic(tenantId: string, userId: string, issueId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const issue = await tx.dailyIssue.findFirst({ where: { id: issueId, tenantId }, select: { id: true, resolvedAt: true } });
    if (!issue) throw new DailyCloseNotFoundError(issueId);
    if (issue.resolvedAt) return issue; // pressing twice is not an error
    return tx.dailyIssue.update({ where: { id: issueId }, data: { resolvedAt: new Date(), resolvedBy: userId }, select: { id: true, resolvedAt: true } });
  });
}

// ------------------------------------------------------------
// The month (ย้อนหลัง)
// ------------------------------------------------------------

export type DailyCloseMonthRow = {
  date: string;
  closed: boolean;
  netRevenue: number | null;
  guestCount: number | null;
  perHead: number | null;
  cashDiff: number | null;
  issuesOpen: number;
  issuesResolved: number;
  issuesNoted: number;
  comments: number;
};

export type DailyCloseMonth = {
  rows: DailyCloseMonthRow[];
  /** Customer types with their share, weighted by each day's guest count (Q3). */
  mix: { customerTypeId: string; name: string; share: number }[];
  mixDays: number;
};

export async function getDailyCloseMonthLogic(tenantId: string, branchId: string, from: Date, to: Date): Promise<DailyCloseMonth> {
  return withTenantContext(tenantId, async (tx) => {
    const [closes, days, revenue, types] = await Promise.all([
      tx.dailyClose.findMany({
        where: { tenantId, branchId, businessDate: { gte: from, lte: to } },
        select: {
          businessDate: true,
          cashFloat: true,
          cashSales: true,
          cashCounted: true,
          mix: { select: { customerTypeId: true, parts: true } },
          issues: { select: { followUp: true, resolvedAt: true } },
          _count: { select: { comments: true } },
        },
      }),
      tx.salesDay.findMany({ where: { tenantId, branchId, businessDate: { gte: from, lte: to } }, select: { businessDate: true, guestCount: true } }),
      tx.salesLine.groupBy({ by: ["businessDate"], where: { tenantId, branchId, supersededAt: null, businessDate: { gte: from, lte: to } }, _sum: { netAmount: true } }),
      tx.customerType.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    ]);
    const guests = new Map(days.map((d) => [isoDate(d.businessDate), d.guestCount]));
    const net = new Map(revenue.map((r) => [isoDate(r.businessDate), num(r._sum.netAmount)]));
    const byDate = new Map(closes.map((c) => [isoDate(c.businessDate), c]));

    const rows: DailyCloseMonthRow[] = [];
    for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
      const k = isoDate(d);
      const c = byDate.get(k);
      const g = guests.get(k) ?? null;
      const n = net.get(k) ?? null;
      if (!c && n === null && g === null) continue;
      const diff =
        c && c.cashFloat !== null && c.cashSales !== null && c.cashCounted !== null
          ? Math.round((Number(c.cashCounted) - Number(c.cashFloat) - Number(c.cashSales)) * 100) / 100
          : null;
      rows.push({
        date: k,
        closed: !!c,
        netRevenue: n,
        guestCount: g,
        perHead: n !== null && g ? Math.round((n / g) * 10) / 10 : null,
        cashDiff: diff,
        issuesOpen: c?.issues.filter((i) => i.followUp && !i.resolvedAt).length ?? 0,
        issuesResolved: c?.issues.filter((i) => i.resolvedAt).length ?? 0,
        issuesNoted: c?.issues.filter((i) => !i.followUp && !i.resolvedAt).length ?? 0,
        comments: c?._count.comments ?? 0,
      });
    }

    // Weighted share: each day's tenths become fractions of that day's guests
    // (or of 1 when the guest count is missing), then summed (rule DC-MIX).
    const weight = new Map<string, number>();
    let total = 0;
    let mixDays = 0;
    for (const c of closes) {
      if (c.mix.length === 0) continue;
      mixDays++;
      const w = guests.get(isoDate(c.businessDate)) || 1;
      for (const m of c.mix) {
        weight.set(m.customerTypeId, (weight.get(m.customerTypeId) ?? 0) + (m.parts / 10) * w);
      }
      total += w * (c.mix.reduce((t, m) => t + m.parts, 0) / 10);
    }
    const name = new Map(types.map((t) => [t.id, t.name]));
    const mix = [...weight.entries()]
      .map(([id, v]) => ({ customerTypeId: id, name: name.get(id) ?? "", share: total > 0 ? v / total : 0 }))
      .sort((a, b) => b.share - a.share);
    return { rows: rows.reverse(), mix, mixDays };
  });
}

/** Open "ต้องตามต่อ" issues across the given branches — the dashboard line. */
export async function countOpenIssuesLogic(tenantId: string, branchIds: string[]): Promise<number> {
  if (branchIds.length === 0) return 0;
  return withTenantContext(tenantId, (tx) =>
    tx.dailyIssue.count({ where: { tenantId, followUp: true, resolvedAt: null, dailyClose: { branchId: { in: branchIds } } } })
  );
}

// ------------------------------------------------------------
// Shop settings: the add-on switch and the customer types
// ------------------------------------------------------------

export async function getDailyCloseSettingsLogic(tenantId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const [tenant, types] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { dailyCloseEnabled: true } }),
      tx.customerType.findMany({
        where: { tenantId, archivedAt: null },
        orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, _count: { select: { mix: true } } },
      }),
    ]);
    return { enabled: tenant.dailyCloseEnabled, types: types.map((t) => ({ id: t.id, name: t.name, used: t._count.mix > 0 })) };
  });
}

/** The four types the mockup showed, offered the first time a shop switches it on. */
const STARTER_TYPES = ["พนักงานออฟฟิศ", "ครอบครัว", "ขาประจำ", "นักท่องเที่ยว"];

export async function setDailyCloseEnabledLogic(tenantId: string, enabled: boolean) {
  return withTenantContext(tenantId, async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { dailyCloseEnabled: enabled } });
    if (enabled && (await tx.customerType.count({ where: { tenantId } })) === 0) {
      await tx.customerType.createMany({ data: STARTER_TYPES.map((name, i) => ({ tenantId, name, displayOrder: i })) });
    }
  });
}

export async function addCustomerTypeLogic(tenantId: string, name: string) {
  return withTenantContext(tenantId, async (tx) => {
    const n = await tx.customerType.count({ where: { tenantId, archivedAt: null } });
    if (n >= MAX_CUSTOMER_TYPES) throw new CustomerTypeLimitError();
    return tx.customerType.create({ data: { tenantId, name, displayOrder: n }, select: { id: true } });
  });
}

/** A type already used in an estimate is archived, never deleted (Consequence 4). */
export async function removeCustomerTypeLogic(tenantId: string, id: string) {
  return withTenantContext(tenantId, async (tx) => {
    const t = await tx.customerType.findFirst({ where: { id, tenantId }, select: { id: true, _count: { select: { mix: true } } } });
    if (!t) throw new DailyCloseNotFoundError(id);
    if (t._count.mix > 0) await tx.customerType.update({ where: { id }, data: { archivedAt: new Date() } });
    else await tx.customerType.delete({ where: { id } });
  });
}

export async function isDailyCloseEnabledLogic(tenantId: string): Promise<boolean> {
  return withTenantContext(tenantId, async (tx) => (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { dailyCloseEnabled: true } })).dailyCloseEnabled);
}

