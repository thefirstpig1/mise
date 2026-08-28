// ============================================================
// Mise — staff meal reads (Sprint 5 Part 26 L3c, ADR 0028)
// ============================================================
// Four reads, and two of them exist to say something the writer refuses to
// enforce.
//
// The quota and the price ceiling are REPORTED here and blocked nowhere: the
// food is already eaten by the time anyone types it in, so refusing the record
// does not put the pork back — it makes the stock wrong and hides that anybody
// went over. That decision lives in staff-meal.ts's header; this file is where
// it becomes visible, which is the half that makes it honest rather than
// merely permissive.
// ============================================================

import { Prisma } from "@prisma/client";
import type { StaffMealPriceSource } from "@prisma/client";
import { withTenantContext } from "@/lib/db";
import type {
  GetStaffMealQuery,
  GetStaffMembersQuery,
} from "@/lib/validations/staff-meal";

const ZERO = new Prisma.Decimal(0);

/** One page of history is a month of a busy branch, not a year. */
export const MAX_STAFF_MEAL_ROWS = 200;

// ------------------------------------------------------------
// The roster
// ------------------------------------------------------------

export type StaffMemberRow = {
  id: string;
  name: string;
  branchId: string;
  branchName: string;
  dailyQuotaAmount: Prisma.Decimal | null;
  isActive: boolean;
};

/**
 * `includeInactive` is required by the query schema, not defaulted — Part 27's
 * `includeRetired` pattern, so every caller has to have an opinion about whether
 * someone who has left belongs in its list. A picker for RECORDING a meal today
 * wants only the active; a REPORT of last month wants everybody, because
 * dropping them would move a figure by pressing a button today (rule S7).
 */
export async function getStaffMembersLogic(
  tenantId: string,
  query: GetStaffMembersQuery
): Promise<StaffMemberRow[]> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.staffMember.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        branchId: true,
        dailyQuotaAmount: true,
        isActive: true,
        branch: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      branchId: r.branchId,
      branchName: r.branch.name,
      dailyQuotaAmount: r.dailyQuotaAmount,
      isActive: r.isActive,
    }));
  });
}

// ------------------------------------------------------------
// History
// ------------------------------------------------------------

export type StaffMealRow = {
  id: string;
  businessDate: Date;
  branchId: string;
  branchName: string;
  /** Null for a pot the kitchen cooked for everybody. */
  staffMemberId: string | null;
  staffMemberName: string | null;
  /** True when that person no longer works here — a label, never a filter. */
  staffMemberRetired: boolean;
  menuId: string | null;
  menuName: string | null;
  servings: Prisma.Decimal;
  /** The SELLING price frozen at entry, per serving. Never a cost. */
  unitPrice: Prisma.Decimal | null;
  priceSource: StaffMealPriceSource;
  /** `unitPrice × servings`, or null when there is no price to multiply. */
  value: Prisma.Decimal | null;
  itemCount: number;
  recordedByName: string | null;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
};

export type StaffMealHistory = {
  rows: StaffMealRow[];
  /**
   * What the meals in this list were WORTH at selling price — the control
   * figure, and emphatically not what they cost the shop (rule S1).
   *
   * Rows whose price is NONE contribute nothing and are counted separately, so
   * the total is never quietly read as complete when part of it is unpriceable.
   */
  totalValue: Prisma.Decimal;
  unpricedCount: number;
  truncated: boolean;
};

export async function getStaffMealsLogic(
  tenantId: string,
  query: GetStaffMealQuery
): Promise<StaffMealHistory> {
  return withTenantContext(tenantId, async (tx) => {
    const rows = await tx.staffMeal.findMany({
      where: {
        tenantId,
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.staffMemberId ? { staffMemberId: query.staffMemberId } : {}),
        ...(query.from || query.to
          ? {
              businessDate: {
                ...(query.from ? { gte: query.from } : {}),
                ...(query.to ? { lte: query.to } : {}),
              },
            }
          : {}),
        ...(query.includeVoided ? {} : { voidedAt: null }),
      },
      orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
      take: MAX_STAFF_MEAL_ROWS + 1,
      select: {
        id: true,
        businessDate: true,
        branchId: true,
        staffMemberId: true,
        menuId: true,
        servings: true,
        frozenUnitPrice: true,
        priceSource: true,
        recordedByName: true,
        notes: true,
        voidedAt: true,
        voidReason: true,
        branch: { select: { name: true } },
        // A retired member is LABELLED, never filtered — the whole of rule S7.
        staffMember: { select: { name: true, isActive: true } },
        menu: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });

    const truncated = rows.length > MAX_STAFF_MEAL_ROWS;
    const page = truncated ? rows.slice(0, MAX_STAFF_MEAL_ROWS) : rows;

    let totalValue = ZERO;
    let unpricedCount = 0;

    const mapped: StaffMealRow[] = page.map((r) => {
      const value =
        r.frozenUnitPrice === null
          ? null
          : r.frozenUnitPrice.times(r.servings).toDecimalPlaces(2);
      // A voided meal is shown but does not count towards what was consumed —
      // it is a record of a mistake and its correction, not a meal.
      if (r.voidedAt === null) {
        if (value === null) unpricedCount += 1;
        else totalValue = totalValue.plus(value);
      }
      return {
        id: r.id,
        businessDate: r.businessDate,
        branchId: r.branchId,
        branchName: r.branch.name,
        staffMemberId: r.staffMemberId,
        staffMemberName: r.staffMember?.name ?? null,
        staffMemberRetired: r.staffMember ? !r.staffMember.isActive : false,
        menuId: r.menuId,
        menuName: r.menu?.name ?? null,
        servings: r.servings,
        unitPrice: r.frozenUnitPrice,
        priceSource: r.priceSource,
        value,
        itemCount: r._count.items,
        recordedByName: r.recordedByName,
        notes: r.notes,
        voidedAt: r.voidedAt,
        voidReason: r.voidReason,
      };
    });

    return { rows: mapped, totalValue, unpricedCount, truncated };
  });
}

// ------------------------------------------------------------
// The quota, which reports and never refuses
// ------------------------------------------------------------

export type StaffMealQuotaStatus = {
  staffMemberId: string;
  staffMemberName: string;
  /** Null = this shop has set no quota at all. Not "zero". */
  quota: Prisma.Decimal | null;
  /** Where that figure came from, so the screen can say whose rule it is. */
  quotaSource: "PERSON" | "TENANT" | "NONE";
  /** Selling-price value of this person's live meals on this day. */
  used: Prisma.Decimal;
  /**
   * Meals on this day whose price could not be worked out. `used` is therefore a
   * FLOOR, not a total, and the screen must not print "฿120 / ฿150" as if it
   * were complete when this is non-zero.
   */
  unpricedCount: number;
  over: boolean;
};

export async function getStaffMealQuotaLogic(
  tenantId: string,
  params: { staffMemberId: string; businessDate: Date }
): Promise<StaffMealQuotaStatus> {
  return withTenantContext(tenantId, async (tx) => {
    const [member, tenant, meals] = await Promise.all([
      tx.staffMember.findFirst({
        where: { id: params.staffMemberId, tenantId },
        select: { id: true, name: true, dailyQuotaAmount: true },
      }),
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { staffMealDailyQuota: true },
      }),
      tx.staffMeal.findMany({
        where: {
          tenantId,
          staffMemberId: params.staffMemberId,
          businessDate: params.businessDate,
          voidedAt: null,
        },
        select: { frozenUnitPrice: true, servings: true },
      }),
    ]);

    const quota = member?.dailyQuotaAmount ?? tenant.staffMealDailyQuota ?? null;
    const quotaSource =
      member?.dailyQuotaAmount != null
        ? ("PERSON" as const)
        : tenant.staffMealDailyQuota != null
          ? ("TENANT" as const)
          : ("NONE" as const);

    let used = ZERO;
    let unpricedCount = 0;
    for (const m of meals) {
      if (m.frozenUnitPrice === null) unpricedCount += 1;
      else used = used.plus(m.frozenUnitPrice.times(m.servings));
    }
    used = used.toDecimalPlaces(2);

    return {
      staffMemberId: params.staffMemberId,
      staffMemberName: member?.name ?? "",
      quota,
      quotaSource,
      used,
      unpricedCount,
      // Over only when there IS a quota. A shop that has set none has not set
      // zero, and a warning it never asked for is noise it will learn to ignore.
      over: quota !== null && used.greaterThan(quota),
    };
  });
}

// ------------------------------------------------------------
// The warning that stops the food being deducted twice
// ------------------------------------------------------------

export type ZeroPriceTag = {
  /** Exactly as the POS file wrote it. Null when the file carried no tag. */
  discountReason: string | null;
  lines: number;
  /** What the dishes on those lines would have been worth at full price. */
  grossAmount: Prisma.Decimal;
};

export type ZeroPriceWarning = {
  /** Live, positive-quantity sales lines on this day that collected nothing. */
  totalLines: number;
  tags: ZeroPriceTag[];
};

/**
 * A shop whose POS rings staff meals as a 100% discount is ALREADY having them
 * posted as CONSUMPTION by Part 22 — correctly as stock, wrongly as cost of
 * goods sold. If that shop also types them in here, the food is deducted TWICE,
 * and every row in the ledger looks perfectly ordinary.
 *
 * This is the only defence, and it is a warning rather than a block (Q6). It
 * does not decide: it shows the discount tags the file carried and lets a person
 * read the Thai. A blunt `net = 0` count could not — it lumps a staff meal in
 * with a giveaway, a voucher and a comped dish, which is the objection that
 * bought `sales_line.discount_reason` in the first place.
 *
 * Cancelled bills are excluded by `qty > 0`: a negative line is a bill coming
 * back, not a dish going out for nothing.
 */
export async function getZeroPriceSalesWarningLogic(
  tenantId: string,
  params: { branchId: string; businessDate: Date }
): Promise<ZeroPriceWarning> {
  return withTenantContext(tenantId, async (tx) => {
    const grouped = await tx.salesLine.groupBy({
      by: ["discountReason"],
      where: {
        tenantId,
        branchId: params.branchId,
        businessDate: params.businessDate,
        supersededAt: null,
        netAmount: 0,
        qty: { gt: 0 },
      },
      _count: { _all: true },
      _sum: { grossAmount: true },
    });

    const tags: ZeroPriceTag[] = grouped
      .map((g) => ({
        discountReason: g.discountReason,
        lines: g._count._all,
        grossAmount: g._sum.grossAmount ?? ZERO,
      }))
      .sort((a, b) => b.lines - a.lines);

    return {
      totalLines: tags.reduce((n, t) => n + t.lines, 0),
      tags,
    };
  });
}
